// Banner engine: same species part-list -> hierarchy of camera-facing quads.
// Each part is ONE 2-triangle quad ("banner"); the fragment shader draws a
// mathematically perfect silhouette -- circle for spheres, pill for capsules,
// uneven pill for cones -- as a 2D signed-distance function, filled flat,
// with an optional 1px outline. No lighting, no tessellation, no outline mesh.
// A polygon mesh would take ~600 triangles x2 meshes per part vs 2 triangles x1 here.
//
// How a part becomes a banner: its primitive is reduced to a canonical
// SEGMENT (two local endpoints A,B plus end radii r1,r2). The vertex shader
// transforms A,B to view space, flattens them onto the camera plane through
// their midpoint, and stretches the quad to cover the projected shape -- so
// a capsule seen side-on is a long pill, and the same capsule seen end-on
// collapses to a circle, exactly like the real solid's silhouette. Depth is
// the (constant) midpoint depth, so parts of one animal still sort against
// each other and against other animals with the ordinary z-buffer.
import * as THREE from "three";
import { wgslFn, uniform, positionGeometry, modelViewMatrix, modelWorldMatrix, cameraWorldMatrix,
         cameraProjectionMatrix, varying, vec4 } from "three/tsl";
import * as LIB from "./banner_wgsl.js";
export { animateSpecies } from "./anim.js";

import { OUTLINE, OUTLINE_COLOR, QUADS } from "./outline.js";
export { OUTLINE };
export const BORDER = { color: OUTLINE_COLOR };
// The outline switch (outline.js) is shared by every banner material as one
// uniform object: 0 = flat fills only, 1 = a one-pixel dark band along each
// silhouette, measured with screen-space derivatives so it stays one pixel
// wide at any distance. Off by default; Shift+O toggles it.

const QUAD = new THREE.PlaneGeometry(2, 2);   // position.xy in [-1,1] -> extent multipliers

// 2D uneven capsule (iq): distance to the hull of two circles (pa,ra),(pb,rb).
// Shared with instanced.js so the silhouette math cannot diverge.
// The SDF library itself lives in banner_wgsl.js now, shared by every engine; the GLSL it was ported from is
// kept outside the repo as the parity reference (examples/webgpu_parity.html, docs/webgpu.md).

// ---- the shaders, in WGSL (docs/webgpu.md). The maths is banner_wgsl.js, shared with the instanced and
// composite engines; what lives here is the single-part plumbing: one quad, its segment in uniforms.

// The quad in the camera-parallel plane at the segment's midpoint depth. Flattening each endpoint onto it
// must be perspective-correct -- scale its xy AND radius by (plane depth / own depth) -- so the drawn
// silhouette lands exactly where the true 3D projection would. Without this, depth-slanted parts shift by
// different amounts and gaps open at joints that genuinely overlap in 3D. A slanted capsule correctly becomes
// an uneven pill: near cap fatter, far cap thinner.
//   returns (p.xy, zc, the radius multiplier) -- the view matrix is rigid, so the column lengths of modelView
//   are the accumulated world scale, and their mean is the (approximate) radius multiplier
const quadPlane = wgslFn(`
  fn quadPlane(corner: vec3<f32>, A: vec3<f32>, B: vec3<f32>, r1: f32, r2: f32, mv: mat4x4<f32>) -> vec4<f32> {
    let a = (mv * vec4<f32>(A, 1.0)).xyz;
    let b = (mv * vec4<f32>(B, 1.0)).xyz;
    let s = (length(mv[0].xyz) + length(mv[1].xyz) + length(mv[2].xyz)) / 3.0;
    let zc = (a.z + b.z) * 0.5;
    let ka = zc / min(a.z, -1e-2);
    let kb = zc / min(b.z, -1e-2);
    let pa = a.xy * ka;
    let pb = b.xy * kb;
    let rad = vec2<f32>(r1 * ka, r2 * kb) * s;
    let ab = pb - pa;
    let l = length(ab);
    var u = vec2<f32>(1.0, 0.0);
    if (l > 1e-5) { u = ab / l; }
    let v = vec2<f32>(-u.y, u.x);
    let R = max(rad.x, rad.y) + 0.01;
    let p = (pa + pb) * 0.5 + u * (corner.x * (l * 0.5 + R)) + v * (corner.y * R);
    return vec4<f32>(p, zc, s);
  }
`);

// the projected segment the fragment cuts: (pa.xy, pb.xy) and the radii in the plane
const quadShape = wgslFn(`
  fn quadShape(A: vec3<f32>, B: vec3<f32>, r1: f32, r2: f32, mv: mat4x4<f32>) -> mat2x2<f32> {
    let a = (mv * vec4<f32>(A, 1.0)).xyz;
    let b = (mv * vec4<f32>(B, 1.0)).xyz;
    let s = (length(mv[0].xyz) + length(mv[1].xyz) + length(mv[2].xyz)) / 3.0;
    let zc = (a.z + b.z) * 0.5;
    let ka = zc / min(a.z, -1e-2);
    let kb = zc / min(b.z, -1e-2);
    return mat2x2<f32>(a.xy * ka, b.xy * kb);
  }
`);

const viewPoint = wgslFn(`
  fn viewPoint(p: vec3<f32>, mv: mat4x4<f32>) -> vec3<f32> { return (mv * vec4<f32>(p, 1.0)).xyz; }
`);

const worldPoint = wgslFn(`
  fn worldPoint(p: vec3<f32>, model: mat4x4<f32>) -> vec3<f32> { return (model * vec4<f32>(p, 1.0)).xyz; }
`);

// THE CAPSULE BANNER'S FRAGMENT: the silhouette, the true surface along this pixel's ray (which costs early-z
// but buys exact intersection curves where parts interpenetrate, and gives the patterns their 3D surface
// point), the pattern, the shading and the depth. Returns (rgb, depth) -- depth < 0: discard.
const bannerFrag = wgslFn(`
  fn bannerFrag(P: vec4<f32>, shape: mat2x2<f32>, Aw: vec3<f32>, Bw: vec3<f32>, Av: vec3<f32>, Bv: vec3<f32>,
                r1: f32, r2: f32, pat: f32, fill: vec3<f32>, borderCol: vec3<f32>, outline: f32, quads: f32, q: vec2<f32>,
                invView: mat4x4<f32>, proj: mat4x4<f32>, pixelDepth: f32) -> vec4<f32> {
    let sc = P.w;
    let rad = vec2<f32>(r1 * (P.z / min((Av).z, -1e-2)), r2 * (P.z / min((Bv).z, -1e-2))) * sc;
    let d = sdUnevenCapsule(P.xy, shape[0], shape[1], rad.x, rad.y);
    let fw = abs(dpdx(d)) + abs(dpdy(d));
    // OUTSIDE THE SHAPE: nothing, normally -- or, in the geometry view, the CARD itself at its own plane depth, so that
    // what is a flat quad with a shape drawn on it can be told from what is triangles (outline.js QUADS, T in the game)
    if (d > 0.0) {
      // THE CARD'S EDGE, in the geometry view: a thin blue line round the quad the shape is drawn on, and nothing
      // inside it -- a filled card hides whatever it covers, and one quad with a bad extent hides the whole screen.
      if (quads > 0.5) {
        let qe = 1.0 - max(abs(q.x), abs(q.y));
        let qw = max(abs(dpdx(qe)) + abs(dpdy(qe)), 1e-7) * 1.5;
        if (qe < qw) { let cd = viewDepth(proj, vec3<f32>(P.xy, P.z)); if (cd >= 0.0) { return vec4<f32>(0.12, 0.45, 0.95, cd); } }
      }
      return vec4<f32>(0.0, 0.0, 0.0, -1.0);
    }
    // the band is one pixel of distance, capped at half the smallest radius so a thin tail keeps its fill
    let border = outline > 0.5 && d > -min(fw, 0.5 * min(rad.x, rad.y));
    var col = select(fill, borderCol, border);
    let rw = vec2<f32>(r1, r2) * sc;
    let rd = normalize(vec3<f32>(P.xy, P.z));
    let pv = rd * surfaceT(rd, Av, Bv, rw.x, rw.y);
    let zv = min(pv.z, -0.01);
    if (!border) {
      let pw = (invView * vec4<f32>(pv, 1.0)).xyz;
      if (pat > 0.5) { col = patternAt(col, pat, partLocal(pw, Aw, Bw), max(rw.x, rw.y), 0.0, 0.0); }
      col = col * shadeOf(capsuleNormal(pw, Aw, Bw));
    }
    if (pixelDepth < 0.5) { return vec4<f32>(col, 0.0); }        // the quad's own depth stands
    let fd = viewDepth(proj, vec3<f32>(P.xy, P.z) * (zv / P.z));
    if (fd < 0.0) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
    return vec4<f32>(col, fd);
  }
`, [LIB.sdUnevenCapsule, LIB.surfaceT, LIB.partLocal, LIB.capsuleNormal, LIB.shadeOf, LIB.patternAt, LIB.viewDepth]);

// TRIANGLE BANNERS: three points flattened onto their mean-depth plane (perspective-correct like the capsule
// path), the quad stretched over the projected triangle's bounding box, flat depth (skins have no bulge).
const triPlane = wgslFn(`
  fn triPlane(corner: vec3<f32>, A: vec3<f32>, B: vec3<f32>, C: vec3<f32>, r1: f32, mv: mat4x4<f32>) -> vec3<f32> {
    let a = (mv * vec4<f32>(A, 1.0)).xyz;
    let b = (mv * vec4<f32>(B, 1.0)).xyz;
    let c = (mv * vec4<f32>(C, 1.0)).xyz;
    let zc = (a.z + b.z + c.z) / 3.0;
    let pa = a.xy * (zc / min(a.z, -1e-2));
    let pb = b.xy * (zc / min(b.z, -1e-2));
    let pc = c.xy * (zc / min(c.z, -1e-2));
    let pad = r1 + 0.03;
    let lo = min(pa, min(pb, pc)) - pad;
    let hi = max(pa, max(pb, pc)) + pad;
    return vec3<f32>(mix(lo, hi, corner.xy * 0.5 + 0.5), zc);
  }
`);

const triShape = wgslFn(`
  fn triShape(A: vec3<f32>, B: vec3<f32>, C: vec3<f32>, mv: mat4x4<f32>) -> mat3x3<f32> {
    let a = (mv * vec4<f32>(A, 1.0)).xyz;
    let b = (mv * vec4<f32>(B, 1.0)).xyz;
    let c = (mv * vec4<f32>(C, 1.0)).xyz;
    let zc = (a.z + b.z + c.z) / 3.0;
    return mat3x3<f32>(vec3<f32>(a.xy * (zc / min(a.z, -1e-2)), 0.0),
                       vec3<f32>(b.xy * (zc / min(b.z, -1e-2)), 0.0),
                       vec3<f32>(c.xy * (zc / min(c.z, -1e-2)), 0.0));
  }
`);

const triFrag = wgslFn(`
  fn triFrag(P: vec3<f32>, shape: mat3x3<f32>, Aw: vec3<f32>, Bw: vec3<f32>, Cw: vec3<f32>, r1: f32, pat: f32,
             fill: vec3<f32>, borderCol: vec3<f32>, outline: f32, quads: f32, q: vec2<f32>,
             invView: mat4x4<f32>, proj: mat4x4<f32>, pixelDepth: f32) -> vec4<f32> {
    let d = sdTri(P.xy, shape[0].xy, shape[1].xy, shape[2].xy) - r1;
    let fw = abs(dpdx(d)) + abs(dpdy(d));
    if (d > 0.0) {
      // THE CARD'S EDGE, in the geometry view: a thin blue line round the quad the shape is drawn on, and nothing
      // inside it -- a filled card hides whatever it covers, and one quad with a bad extent hides the whole screen.
      if (quads > 0.5) {
        let qe = 1.0 - max(abs(q.x), abs(q.y));
        let qw = max(abs(dpdx(qe)) + abs(dpdy(qe)), 1e-7) * 1.5;
        if (qe < qw) { let cd = viewDepth(proj, vec3<f32>(P.xy, P.z)); if (cd >= 0.0) { return vec4<f32>(0.12, 0.45, 0.95, cd); } }
      }
      return vec4<f32>(0.0, 0.0, 0.0, -1.0);
    }
    let border = outline > 0.5 && d > -fw;
    var col = select(fill, borderCol, border);
    if (!border) {   // membranes are flat: the plane point is the surface point
      let pw = (invView * vec4<f32>(P, 1.0)).xyz;
      if (pat > 0.5) { col = patternAt(col, pat, partLocal(pw, Aw, Bw), r1, 0.0, 0.0); }
      let m3 = mat3x3<f32>(invView[0].xyz, invView[1].xyz, invView[2].xyz);
      col = col * shadeOf(triNormal(Aw, Bw, Cw, m3 * normalize(P)));
    }
    if (pixelDepth < 0.5) { return vec4<f32>(col, 0.0); }
    let fd = viewDepth(proj, P);
    if (fd < 0.0) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
    return vec4<f32>(col, fd);
  }
`, [LIB.sdTri, LIB.partLocal, LIB.triNormal, LIB.shadeOf, LIB.patternAt, LIB.viewDepth]);

// the two switches every banner material reads, made ONCE for the file instead of once per part: three pays for a
// live uniform per DRAW, and a part with its own copies pays again for every draw of every part (composite.js says
// what that measured). Everything else a material holds -- its ends, its radii, its colour -- is its own and static.
const uOutline = uniform(0).onRenderUpdate(() => OUTLINE.value);
const uQuads = uniform(0).onRenderUpdate(() => QUADS.value);

const insideOf = wgslFn(`fn insideOf(v: f32) -> f32 { if (v < 0.0) { return 0.0; } return 1.0; }`);

// Reduce a part's primitive to the canonical segment in the quad's rigid
// local space (the part's own non-uniform `scale` is baked in here and
// cancelled on the scene-graph side, see holder below).
export function segmentFor(part) {
  const s = part.scale ?? [1, 1, 1];
  const { shape, size } = part;
  // flat triangular membrane: three local corner points + corner rounding;
  // r2 = -1 flags the shape for the shaders
  if (shape === "tri") return { a: size.a, b: size.b, c: size.c, r1: size.r ?? .03, r2: -1 };
  // tube: a curved, profiled limb -- centreline a -> (control c) -> b, radius r1 -> r2 plus a middle bulge
  // (the composite engine draws it exactly; the other banner engines fall back to the capsule a-b)
  if (shape === "tube") return { a: size.a, b: size.b, c: size.c, r1: size.r1, r2: size.r2 ?? size.r1, bulge: size.bulge ?? 0, tube: true };
  if (shape === "sphere") {
    // sphere x non-uniform scale = ellipsoid; approximate it as a capsule
    // along its longest semi-axis (good enough for squashed ears/patches)
    const semi = s.map((k) => size.r * k);
    const dom = semi.indexOf(Math.max(...semi));
    const [p, q] = [0, 1, 2].filter((i) => i !== dom);
    const r = (semi[p] + semi[q]) / 2;
    const h = Math.max(semi[dom] - r, 0);
    const a = [0, 0, 0], b = [0, 0, 0];
    a[dom] = h; b[dom] = -h;
    return { a, b, r1: r, r2: r };
  }
  // capsule/cone axis is local +Y, optionally re-aimed by geomRot (degrees)
  const dir = new THREE.Vector3(0, 1, 0);
  if (part.geomRot) {
    const [x, y, z] = part.geomRot.map(THREE.MathUtils.degToRad);
    dir.applyEuler(new THREE.Euler(x, y, z));
  }
  const rMul = (s[0] + s[1] + s[2]) / 3;
  const half = shape === "cone" ? size.h / 2 : size.len / 2;
  const a = [dir.x * half * s[0], dir.y * half * s[1], dir.z * half * s[2]];
  const b = a.map((v) => -v);
  // a capsule may taper: size.r is its +y end, size.r2 (optional) its -y end
  return shape === "cone"
    ? { a: b, b: a, r1: size.r * rMul, r2: Math.max(size.r * .12, .008) * rMul }  // round base -> near-point apex
    : { a, b, r1: size.r * rMul, r2: (size.r2 ?? size.r) * rMul };
}

// the patterns rebuild each pixel's world point from the camera: every banner material keeps the camera's world matrix current

function bannerMesh(part, pixelDepth) {
  const seg = segmentFor(part);
  const uA = uniform(new THREE.Vector3(...seg.a)), uB = uniform(new THREE.Vector3(...seg.b));
  const uR1 = uniform(seg.r1);
  const uFill = uniform(new THREE.Color(part.color));
  const uBorder = uniform(new THREE.Color(BORDER.color));

  const uPixelDepth = uniform(pixelDepth ? 1 : 0);
  const mv = modelViewMatrix, model = modelWorldMatrix, invView = cameraWorldMatrix, proj = cameraProjectionMatrix;
  const mat = new THREE.MeshBasicNodeMaterial();

  if (part.shape === "tri") {
    const uC = uniform(new THREE.Vector3(...seg.c));
    const uPat = uniform(part.pat === "wingspots" ? 6 : 0);
    const plane = triPlane({ corner: positionGeometry, A: uA, B: uB, C: uC, r1: uR1, mv });
    const frag = triFrag({
      P: varying(plane, "vTriP"), shape: varying(triShape({ A: uA, B: uB, C: uC, mv }), "vTriS"),
      Aw: varying(worldPoint({ p: uA, model }), "vAw"), Bw: varying(worldPoint({ p: uB, model }), "vBw"),
      Cw: varying(worldPoint({ p: uC, model }), "vCw"),
      r1: uR1, pat: uPat, fill: uFill, borderCol: uBorder, outline: uOutline, quads: uQuads, q: varying(positionGeometry.xy, "vQuad"), invView, proj, pixelDepth: uPixelDepth,
    });
    mat.vertexNode = proj.mul(vec4(plane.xy, plane.z, 1.0));
    mat.colorNode = frag.xyz;
    mat.opacityNode = insideOf({ v: frag.w });
    mat.alphaTest = .5;
    if (pixelDepth) mat.depthNode = frag.w.max(0.0);
  } else {
    const uR2 = uniform(seg.r2);
    const uPat = uniform(part.pat === "spots" ? 5 : part.pat === "bands" ? 4 : part.pat === "stripes" ? 3
                       : part.pat === "bark" ? 2 : part.pat === "barkH" ? 20 : part.pat === "leaf" ? 1 : 0);
    const plane = quadPlane({ corner: positionGeometry, A: uA, B: uB, r1: uR1, r2: uR2, mv });
    const frag = bannerFrag({
      P: varying(plane, "vQuadP"), shape: varying(quadShape({ A: uA, B: uB, r1: uR1, r2: uR2, mv }), "vQuadS"),
      Aw: varying(worldPoint({ p: uA, model }), "vAw"), Bw: varying(worldPoint({ p: uB, model }), "vBw"),
      Av: varying(viewPoint({ p: uA, mv }), "vAv"), Bv: varying(viewPoint({ p: uB, mv }), "vBv"),
      r1: uR1, r2: uR2, pat: uPat, fill: uFill, borderCol: uBorder, outline: uOutline, quads: uQuads, q: varying(positionGeometry.xy, "vQuad"), invView, proj,
      pixelDepth: uPixelDepth,
    });
    mat.vertexNode = proj.mul(vec4(plane.xy, plane.z, 1.0));
    mat.colorNode = frag.xyz;
    mat.opacityNode = insideOf({ v: frag.w });
    mat.alphaTest = .5;
    if (pixelDepth) mat.depthNode = frag.w.max(0.0);
  }
  const mesh = new THREE.Mesh(QUAD, mat);
  mesh.frustumCulled = false;   // the shader repositions vertices; the plane's bounds are meaningless
  return mesh;
}

export function buildSpecies(def, { pixelDepth = true } = {}) {
  const root = new THREE.Group();
  root.name = def.name;
  const nodes = { };
  for (const part of def.parts) {
    const group = new THREE.Group();
    group.name = part.id;
    group.position.set(...(part.pos ?? [0, 0, 0]));
    const [rx, ry, rz] = (part.rot ?? [0, 0, 0]).map(THREE.MathUtils.degToRad);
    group.rotation.set(rx, ry, rz);
    if (part.scale) group.scale.set(...part.scale);   // children inherit it

    // holder: sits at the pivot and cancels the group's own non-uniform scale,
    // so the quad's local frame stays rigid (its scale is baked into A/B/r)
    const holder = new THREE.Group();
    holder.position.set(...(part.pivot ?? [0, 0, 0]));
    if (part.scale) holder.scale.set(1 / part.scale[0], 1 / part.scale[1], 1 / part.scale[2]);
    holder.add(bannerMesh(part, pixelDepth));
    group.add(holder);

    group.userData.baseRot = { x: rx, y: ry, z: rz };
    group.userData.anim = part.anim ?? null;
    group.userData.ik = part.ik ?? null;
    group.userData.bob = !!part.bob;
    group.userData.baseY = group.position.y;

    nodes[part.id] = group;
    (part.parent ? nodes[part.parent] : root).add(group);
  }
  root.userData.gaits = def.gaits ?? null;
  return root;
}
