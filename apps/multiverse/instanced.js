// Instanced banner engine: the whole herd in ONE draw call.
// Same silhouette math as banner.js, but instead of one Mesh (= one draw
// call + one uniform upload) per body part, every part everywhere becomes a
// row in instanced buffers: world-space segment endpoints, end radii, fill
// color. The GPU stamps the shared 2-triangle quad once per row.
//
// The scene graph disappears for the animals: herd.update(t) walks each
// animal's skeleton as plain matrix math (the same T*R*S chain the Groups
// performed, including the per-part `anim` swing), writes final world-space
// endpoints into one big Float32Array, and uploads it -- one buffer upload
// per frame instead of thousands of uniform sets. Radii and colors never
// change, so those buffers are written once at add() time.
//
// Draw order inside the single call is arbitrary, and that is fine: banners
// are opaque cutouts (discard, no blending), each writing its midpoint
// depth, so the z-buffer sorts every pixel regardless of order.
import * as THREE from "three";
import { MASK_MODE, NOGRASS_LAYER } from "./grass.js";
import { POSE, touch } from "./composite.js";
import * as LIB from "./banner_wgsl.js";
import { syncBannerUniforms } from "./banner_wgsl.js";
import { wgslFn, attribute, varying, uniform, positionGeometry, cameraViewMatrix, cameraWorldMatrix, cameraProjectionMatrix, vec4 } from "three/tsl";
import { PARALLAX } from "./textures.js";
import { compileDef, writeAnimal, easeGait } from "./skeleton.js";

// ---- the shaders, in WGSL through three's node materials (see docs/webgpu.md). The maths is banner_wgsl.js,
// shared with every other engine; what lives here is the instanced plumbing: a row per part, a quad per row.

// The quad corner's point in the camera-parallel plane through the segment (perspective-correct, see the
// banner.js commentary): returns (p.xy, zc). One function serves both shapes -- a triangle banner (rad.y < -0.5)
// flattens three points onto their mean-depth plane, a capsule two onto their midpoint's.
const bannerPlane = wgslFn(`
  fn bannerPlane(corner: vec3<f32>, aw: vec3<f32>, bw: vec3<f32>, cw: vec3<f32>, rad: vec2<f32>, view: mat4x4<f32>) -> vec3<f32> {
    let a = (view * vec4<f32>(aw, 1.0)).xyz;
    let b = (view * vec4<f32>(bw, 1.0)).xyz;
    if (rad.y < -0.5) {
      let c = (view * vec4<f32>(cw, 1.0)).xyz;
      let zc = (a.z + b.z + c.z) / 3.0;
      let pa = a.xy * (zc / min(a.z, -1e-2));
      let pb = b.xy * (zc / min(b.z, -1e-2));
      let pc = c.xy * (zc / min(c.z, -1e-2));
      let pad = rad.x + 0.03;
      let lo = min(pa, min(pb, pc)) - pad;
      let hi = max(pa, max(pb, pc)) + pad;
      return vec3<f32>(mix(lo, hi, corner.xy * 0.5 + 0.5), zc);
    }
    let zc = (a.z + b.z) * 0.5;
    let ka = zc / min(a.z, -1e-2);
    let kb = zc / min(b.z, -1e-2);
    let pa = a.xy * ka;
    let pb = b.xy * kb;
    let radp = vec2<f32>(rad.x * ka, rad.y * kb);
    let ab = pb - pa;
    let l = length(ab);
    var u = vec2<f32>(1.0, 0.0);
    if (l > 1e-5) { u = ab / l; }
    let v = vec2<f32>(-u.y, u.x);
    let R = max(radp.x, radp.y) + 0.01;
    return vec3<f32>((pa + pb) * 0.5 + u * (corner.x * (l * 0.5 + R)) + v * (corner.y * R), zc);
  }
`);

// the same flattening, giving the SHAPE the fragment cuts: (pa.xy, pb.xy) and (pc.xy, the projected radii).
// Carried as varyings because they are constant over the quad -- the fragment must not redo them per pixel.
const bannerShapeA = wgslFn(`
  fn bannerShapeA(aw: vec3<f32>, bw: vec3<f32>, cw: vec3<f32>, rad: vec2<f32>, view: mat4x4<f32>) -> vec4<f32> {
    let a = (view * vec4<f32>(aw, 1.0)).xyz;
    let b = (view * vec4<f32>(bw, 1.0)).xyz;
    var zc = (a.z + b.z) * 0.5;
    if (rad.y < -0.5) {
      let c = (view * vec4<f32>(cw, 1.0)).xyz;
      zc = (a.z + b.z + c.z) / 3.0;
    }
    return vec4<f32>(a.xy * (zc / min(a.z, -1e-2)), b.xy * (zc / min(b.z, -1e-2)));
  }
`);

const bannerShapeB = wgslFn(`
  fn bannerShapeB(aw: vec3<f32>, bw: vec3<f32>, cw: vec3<f32>, rad: vec2<f32>, view: mat4x4<f32>) -> vec4<f32> {
    let a = (view * vec4<f32>(aw, 1.0)).xyz;
    let b = (view * vec4<f32>(bw, 1.0)).xyz;
    if (rad.y < -0.5) {
      let c = (view * vec4<f32>(cw, 1.0)).xyz;
      let zc = (a.z + b.z + c.z) / 3.0;
      return vec4<f32>(c.xy * (zc / min(c.z, -1e-2)), rad);       // a membrane keeps its own (unprojected) radii
    }
    let zc = (a.z + b.z) * 0.5;
    return vec4<f32>(0.0, 0.0, rad.x * (zc / min(a.z, -1e-2)), rad.y * (zc / min(b.z, -1e-2)));
  }
`);

const viewPoint = wgslFn(`
  fn viewPoint(pw: vec3<f32>, view: mat4x4<f32>) -> vec3<f32> { return (view * vec4<f32>(pw, 1.0)).xyz; }
`);

// BARK PARALLAX (trunks and boughs; the relief is barkHeight): the view ray walked down into the bark over the
// cylinder -- along the axis and round it by arc length -- in POM_STEPS layers to a fifth of the radius (2.5cm
// at most; twigs stay smooth), refined between the last two. There the relief's slope tilts the normal, reads
// toward the light give the ridges short shadows, the furrows go darker, and the bark's colour is taken where
// the ray met it. Fades out toward uPomFar metres. Written into the fragment source as text because WGSL has
// no preprocessor: the step counts are baked in, exactly as the GLSL #defines baked them.
const pomBlock = (steps, shadow) => `
    if (!tri && (abs(pat - 2.0) < 0.5 || abs(pat - 20.0) < 0.5) && r > 0.035) {
      let V = invView[3].xyz - pw;
      let dist = length(V);
      let fade = 1.0 - smoothstep(0.65 * pomFar, pomFar, dist);
      let ax = normalize(bw - aw);
      let tn = normalize(cross(nw, ax));
      let vd = V / max(dist, 1e-4);
      let dn = dot(vd, nw);
      let rr = max(length(pl.yz), 1e-3);
      if (fade > 0.01 && dn > 0.06) {
        let depth = min(0.2 * r, 0.025) * fade;
        var s = vec2<f32>(pl.x, atan2(pl.z, pl.y) * r);
        let ds = -vec2<f32>(dot(vd, ax), dot(vd, tn)) / dn * depth / ${steps}.0;
        var layer = 1.0;
        var h = barkHeight(pat, s, r);
        var hPrev = h;
        for (var i: i32 = 0; i < ${steps}; i = i + 1) {
          if (h >= layer) { break; }
          hPrev = h;
          layer = layer - 1.0 / ${steps}.0;
          s = s + ds;
          h = barkHeight(pat, s, r);
        }
        let after = h - layer;
        let before = hPrev - (layer + 1.0 / ${steps}.0);
        s = s - ds * clamp(after / max(after - before, 1e-5), 0.0, 1.0);
        let h0 = barkHeight(pat, s, r);
        let e = 0.003;
        let slope = vec2<f32>(barkHeight(pat, s + vec2<f32>(e, 0.0), r) - h0,
                              barkHeight(pat, s + vec2<f32>(0.0, e), r) - h0) / e * depth;
        let np = normalize(nw - ax * slope.x - tn * slope.y);
        sh = sh + 1.8 * dot(np - nw, vec3<f32>(0.1, 0.2, 0.06));
${shadow > 0 ? `
        let Lw = normalize(vec3<f32>(0.1, 0.2, 0.06));
        let lt = vec3<f32>(dot(Lw, ax), dot(Lw, tn), dot(Lw, nw));
        if (lt.z > 0.05 && h0 < 0.98) {
          var occ = 0.0;
          for (var i: i32 = 1; i <= ${shadow}; i = i + 1) {
            let up = (1.0 - h0) * f32(i) / ${shadow}.0;
            occ = max(occ, barkHeight(pat, s + lt.xy / lt.z * depth * up, r) - (h0 + up));
          }
          sh = sh * (1.0 - 0.45 * smoothstep(0.0, 0.12, occ));
        }` : ""}
        let th = s.y / r;
        pl = vec3<f32>(s.x, rr * cos(th), rr * sin(th));        // the colour where the ray met the bark
        col = col * (1.0 - 0.28 * (1.0 - h0) * fade);
      }
    }
`;

// THE FRAGMENT, in one function: the silhouette cut, the exact surface, the pattern, the shading and the
// pixel's own depth. It returns (rgb, depth), with depth < 0 meaning "not on this part" -- the material reads
// that one result three ways (colour, opacity against alphaTest, depth), and the node graph evaluates it once.
// the cut itself: a node material has no discard, so "is this pixel on the part" becomes an opacity the
// material tests against alphaTest
const insideOf = wgslFn(`
  fn insideOf(v: f32) -> f32 { if (v < 0.0) { return 0.0; } return 1.0; }
`);

const bannerFragSource = (pom) => `
  fn bannerFrag(P: vec3<f32>, sa: vec4<f32>, sb: vec4<f32>, av: vec3<f32>, bv: vec3<f32>,
                aw: vec3<f32>, bw: vec3<f32>, cw: vec3<f32>, rw: vec2<f32>, fill: vec3<f32>, pat: f32,
                invView: mat4x4<f32>, proj: mat4x4<f32>,
                outline: f32, quads: f32, q: vec2<f32>, borderCol: vec3<f32>, maskMode: f32, pomFar: f32) -> vec4<f32> {
    let pa = sa.xy;
    let pb = sa.zw;
    let pc = sb.xy;
    let radp = sb.zw;
    let tri = radp.y < -0.5;
    var d = sdUnevenCapsule(P.xy, pa, pb, radp.x, radp.y);
    if (tri) { d = sdTri(P.xy, pa, pb, pc) - radp.x; }
    // the derivatives must be taken BEFORE the silhouette discards anything: WGSL gives no guarantee about
    // them once the control flow has stopped being uniform
    let fw = abs(dpdx(d)) + abs(dpdy(d));
    // outside the shape: nothing -- or, in the geometry view, the CARD, at its own plane depth (outline.js QUADS)
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
    var edge = min(fw, 0.5 * min(radp.x, radp.y));
    if (tri) { edge = fw; }
    let border = outline > 0.5 && d > -edge;      // thin parts keep their fill colour
    var col = fill;
    if (border) { col = borderCol; }

    // the exact ray hit on the 3D capsule, for depth and for the pattern's surface point; membranes are flat
    // skins at plane depth
    let rd = normalize(vec3<f32>(P.xy, P.z));
    var pv = vec3<f32>(P.xy, P.z);
    if (!tri) { pv = rd * surfaceT(rd, av, bv, rw.x, rw.y); }
    let zv = min(pv.z, -0.01);

    if (!border) {
      let pw = (invView * vec4<f32>(pv, 1.0)).xyz;
      var pl = partLocal(pw, aw, bw);
      let m3 = mat3x3<f32>(invView[0].xyz, invView[1].xyz, invView[2].xyz);
      var nw = capsuleNormal(pw, aw, bw);
      if (tri) { nw = triNormal(aw, bw, cw, m3 * rd); }
      var sh = shadeOf(nw);
      let r = max(rw.x, abs(rw.y));
${pom}
      if (pat > 0.5) { col = patternAt(col, pat, pl, r, 0.0, 0.0); }
      col = col * sh;
    }
    // the grass mask (grass.js): a trunk, a bough, a bush is not grass and nothing may be painted over it --
    // written here, in the banner's own shader, because its silhouette is a cut-out no override material knows
    if (maskMode > 0.5) { col = vec3<f32>(0.0); }
    let fd = viewDepth(proj, vec3<f32>(P.xy, P.z) * (zv / P.z));
    if (fd < 0.0) { return vec4<f32>(0.0, 0.0, 0.0, -1.0); }
    return vec4<f32>(col, fd);
  }
`;

// capacity = total banner count (sum of parts over all animals to be added)
export function createHerd(capacity, { pixelDepth = true } = {}) {
  const quad = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute("position", quad.getAttribute("position"));
  const fA = new Float32Array(capacity * 3);
  const fB = new Float32Array(capacity * 3);
  const fC = new Float32Array(capacity * 3);
  const fRad = new Float32Array(capacity * 2);
  const fFill = new Float32Array(capacity * 3);
  const fPat = new Float32Array(capacity);
  // (NOT DynamicDrawUsage: that flag makes three re-upload the whole buffer on every draw, whether or not
  //  anything changed -- the forest's three megabytes went up the wire every frame for trees that stand
  //  still. The endpoints are sent by `touch` below instead, once a frame and only as far as they are used.)
  const attrA = new THREE.InstancedBufferAttribute(fA, 3);
  const attrB = new THREE.InstancedBufferAttribute(fB, 3);
  const attrC = new THREE.InstancedBufferAttribute(fC, 3);
  geo.setAttribute("aA", attrA);
  geo.setAttribute("aB", attrB);
  geo.setAttribute("aC", attrC);
  geo.setAttribute("aRad", new THREE.InstancedBufferAttribute(fRad, 2));
  geo.setAttribute("aFill", new THREE.InstancedBufferAttribute(fFill, 3));
  geo.setAttribute("aPat", new THREE.InstancedBufferAttribute(fPat, 1));
  geo.instanceCount = 0;

  // the material: every per-part row reaches the shaders as an instanced attribute, and the fragment's one
  // WGSL call is read three ways -- colour, the silhouette cut (opacity against alphaTest, which is how a
  // node material discards) and the pixel's own depth
  const A = attribute("aA", "vec3"), B = attribute("aB", "vec3"), C = attribute("aC", "vec3");
  const RAD = attribute("aRad", "vec2"), FILL = attribute("aFill", "vec3"), PAT = attribute("aPat", "float");
  const view = cameraViewMatrix, invView = cameraWorldMatrix;
  const plane = bannerPlane({ corner: positionGeometry, aw: A, bw: B, cw: C, rad: RAD, view });
  const vPlane = varying(plane, "vPlane");
  const vShapeA = varying(bannerShapeA({ aw: A, bw: B, cw: C, rad: RAD, view }), "vShapeA");
  const vShapeB = varying(bannerShapeB({ aw: A, bw: B, cw: C, rad: RAD, view }), "vShapeB");
  const vAv = varying(viewPoint({ pw: A, view }), "vAv");
  const vBv = varying(viewPoint({ pw: B, view }), "vBv");

  const bannerFrag = wgslFn(bannerFragSource(PARALLAX.on ? pomBlock(PARALLAX.steps, PARALLAX.shadowSteps) : ""),
    [LIB.sdUnevenCapsule, LIB.sdTri, LIB.surfaceT, LIB.partLocal, LIB.capsuleNormal, LIB.triNormal,
     LIB.shadeOf, LIB.patternAt, LIB.barkHeight, LIB.viewDepth]);
  const frag = bannerFrag({
    P: vPlane, sa: vShapeA, sb: vShapeB, av: vAv, bv: vBv, aw: A, bw: B, cw: C, rw: RAD, fill: FILL, pat: PAT,
    invView, proj: cameraProjectionMatrix,
    outline: LIB.U.outline, quads: LIB.U.quads, q: varying(positionGeometry.xy, "vQuad"), borderCol: LIB.U.border, maskMode: LIB.U.mask, pomFar: uniform(PARALLAX.far),
  });

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.vertexNode = cameraProjectionMatrix.mul(vec4(plane.xy, plane.z, 1.0));
  mat.colorNode = frag.xyz;
  mat.opacityNode = insideOf({ v: frag.w });      // depth < 0: off the silhouette, or before the near plane
  mat.alphaTest = 0.5;
  if (pixelDepth) mat.depthNode = frag.w.max(0.0);
  mat.transparent = false;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.userData.sdf = true;   // banners are cut out in the shader: never an occluder through an override material
  mesh.layers.enable(NOGRASS_LAYER);   // ...it writes the grass mask itself instead (the maskMode argument, above)
  mesh.onBeforeRender = () => syncBannerUniforms(MASK_MODE);   // the outline switch and the grass mask pass

  const animals = [];
  let used = 0, lastT = null;
  return {
    mesh,
    animals,
    add(def) {
      const parts = compileDef(def);
      if (used + parts.length > capacity) throw new Error("herd capacity exceeded");
      const animal = { parts, base: used, position: new THREE.Vector3(), rotY: 0 };
      for (let i = 0; i < parts.length; i++) {
        fRad[(used + i) * 2] = parts[i].r1;
        if (parts[i].r2 < -1.5) {   // a tube: drawn here as the capsule between its ends at its mean girth (the composite engine draws the true curve)
          const v = -parts[i].r2 - 2, bu = Math.floor(v / 4096 + 1e-4), r2 = (v - bu * 4096) * .001, m = (parts[i].r1 + r2) / 2 + bu * .001 * .7;
          fRad[(used + i) * 2] = m; fRad[(used + i) * 2 + 1] = m;
        } else fRad[(used + i) * 2 + 1] = parts[i].r2;
        fPat[used + i] = parts[i].pat;
        parts[i].color.toArray(fFill, (used + i) * 3);
      }
      used += parts.length;
      geo.instanceCount = used;
      animals.push(animal);
      return animal;
    },
    update(t) {
      const dt = lastT === null ? 0 : Math.min(Math.max(t - lastT, 0), .1); lastT = t;   // t is the world clock in seconds
      for (const an of animals) { easeGait(an, dt); writeAnimal(an, t, fA, fB, fC); POSE.figures++; POSE.parts += an.parts?.length ?? an.def?.parts?.length ?? 0; }
      touch(attrA, used); touch(attrB, used); touch(attrC, used);
    },
  };
}
