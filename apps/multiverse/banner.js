// Banner engine: same species part-list -> hierarchy of camera-facing quads.
// Each part is ONE 2-triangle quad ("banner"); the fragment shader draws a
// mathematically perfect silhouette -- circle for spheres, pill for capsules,
// uneven pill for cones -- as a 2D signed-distance function, filled flat with
// a darker border band. No lighting, no tessellation, no second outline mesh.
// Compare rig.js: ~600 triangles x2 meshes per part vs 2 triangles x1 here.
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
export { animateSpecies } from "./anim.js";

export const BORDER = {
  color: 0x201812,
  width: .022,      // meters; constant weight regardless of part size, like rig.js
};

const QUAD = new THREE.PlaneGeometry(2, 2);   // position.xy in [-1,1] -> extent multipliers

// 2D uneven capsule (iq): distance to the hull of two circles (pa,ra),(pb,rb).
// Shared with instanced.js so the silhouette math cannot diverge.
export const SDF_GLSL = /* glsl */ `
  float sdUnevenCapsule(vec2 p, vec2 pa, vec2 pb, float ra, float rb) {
    vec2 d = pb - pa;
    float h = length(d);
    if (h < 1e-5) return length(p - pa) - max(ra, rb);
    vec2 u = d / h;
    vec2 q = vec2(abs(dot(p - pa, vec2(-u.y, u.x))), dot(p - pa, u));
    float b = clamp((ra - rb) / h, -0.999, 0.999);
    float a = sqrt(1.0 - b * b);
    float k = dot(q, vec2(-b, a));
    if (k < 0.0) return length(q) - ra;
    if (k > a * h) return length(q - vec2(0.0, h)) - rb;
    return dot(q, vec2(a, b)) - ra;
  }

  // signed distance to a 2D triangle (iq) -- the "tri" banner shape: flat
  // membrane skins (bat wings) that no capsule silhouette can fake
  float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
    vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
    vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
    vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
    vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
    vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
    float s = sign(e0.x * e2.y - e0.y * e2.x);
    vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                     vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                 vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
    return -sqrt(d.x) * sign(d.y);
  }

  // distance to the nearest border of a jittered voronoi grid: large in a
  // cell's interior, ~0 on the seams -- thresholded, that is the giraffe's
  // coat (pattern 5): wide polygonal patches split by thin cream lines
  float cellBorder(vec2 p) {
    vec2 g = floor(p), f = fract(p);
    float s1 = 8.0, s2 = 8.0;
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
      vec2 o = vec2(float(i), float(j));
      vec2 h = fract(sin(vec2(dot(g + o, vec2(127.1, 311.7)), dot(g + o, vec2(269.5, 183.3)))) * 43758.55);
      float dd = length(o + 0.1 + h * 0.8 - f);
      if (dd < s1) { s2 = s1; s1 = dd; } else { s2 = min(s2, dd); }
    }
    return s2 - s1;
  }
`;

const VERT = /* glsl */ `
  uniform vec3 uA, uB;
  uniform float uR1, uR2;
  varying vec2 vP, vA, vB;
  varying vec2 vRad;
  varying float vZc;
  void main() {
    vec3 a = (modelViewMatrix * vec4(uA, 1.0)).xyz;
    vec3 b = (modelViewMatrix * vec4(uB, 1.0)).xyz;
    // view matrix is rigid, so column lengths of modelView = accumulated world
    // scale; mean of the three is our (approximate) radius multiplier
    float s = (length(modelViewMatrix[0].xyz) + length(modelViewMatrix[1].xyz) + length(modelViewMatrix[2].xyz)) / 3.0;
    // the quad lives in the camera-parallel plane at the segment's midpoint
    // depth; flattening each endpoint onto it must be perspective-correct --
    // scale its xy AND radius by (plane depth / own depth) -- so the drawn
    // silhouette lands exactly where the true 3D projection would. Without
    // this, depth-slanted parts shift by different amounts and gaps open at
    // joints that genuinely overlap in 3D. A slanted capsule correctly
    // becomes an uneven pill: near cap fatter, far cap thinner.
    float zc = (a.z + b.z) * 0.5;
    float ka = zc / min(a.z, -1e-2);
    float kb = zc / min(b.z, -1e-2);
    vec2 pa = a.xy * ka, pb = b.xy * kb;
    vec2 rad = vec2(uR1 * ka, uR2 * kb) * s;
    vec2 ab = pb - pa;
    float l = length(ab);
    vec2 u = l > 1e-5 ? ab / l : vec2(1.0, 0.0);
    vec2 v = vec2(-u.y, u.x);
    float R = max(rad.x, rad.y) + 0.01;
    vec2 p = (pa + pb) * 0.5 + u * (position.x * (l * 0.5 + R)) + v * (position.y * R);
    vP = p; vA = pa; vB = pb; vRad = rad; vZc = zc;
    gl_Position = projectionMatrix * vec4(p, zc, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uBorderW, uPat;
  uniform vec3 uFill, uBorder;
  uniform mat4 projectionMatrix;
  varying vec2 vP, vA, vB;
  varying vec2 vRad;
  varying float vZc;

  ${SDF_GLSL}

  void main() {
    float d = sdUnevenCapsule(vP, vA, vB, vRad.x, vRad.y);
    if (d > 0.0) discard;
    // thin parts (tails) keep at least half their radius as fill color --
    // a full-width border would swallow them into a dark stick
    float bw = min(uBorderW, 0.5 * min(vRad.x, vRad.y));
    vec3 col = d > -bw ? uBorder : uFill;
    if (uPat > .5 && d <= -bw) {
      // mathematical textures anchored to the part: leaf mottle (1),
      // bark streaks (2), or animal stripes across the axis (3)
      vec2 q = (vP - vA) / max(vRad.x, .05);
      if (uPat > 4.5) {
        // giraffe patches: ~0.5m voronoi cells in segment-axis space, filled
        // sharp dark brown; the fill color shows only in the thin seams
        vec2 dseg = vB - vA;
        vec2 dir = dseg / max(length(dseg), 1e-4);
        vec2 pp = vec2(dot(vP - vA, dir), dot(vP - vA, vec2(-dir.y, dir.x)));
        float m = smoothstep(.07, .15, cellBorder(pp / .5));
        col = mix(col, vec3(.36, .19, .07), m * .93);
      } else if (uPat > 2.5) {
        // stripes measured along the SEGMENT axis -> vertical on a horizontal
        // body, rings on legs; 3 = slightly wavy (tiger), 4 = straight (zebra)
        vec2 dseg = vB - vA;
        vec2 dir = dseg / max(length(dseg), 1e-4);
        float along = dot(vP - vA, dir);
        float across = dot(vP - vA, vec2(-dir.y, dir.x));
        float wig = uPat > 3.5 ? 0.0 : sin(across * 9.) * .6;
        float m = smoothstep(.45, .7, sin(along * 35. + wig));
        col = mix(col, vec3(.045, .04, .04), m * .96);
      } else {
        float m = uPat > 1.5
          ? smoothstep(.55, .8, fract(q.x * 1.4 + .3 * sin(q.y * 2.0)))
          : smoothstep(.2, .65, sin(q.x * 12.7 + 1.3) * sin(q.y * 13.9));
        col *= 1.0 - m * .12;
      }
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  #ifdef PIXEL_DEPTH
    // bulge the flat quad into the round solid's actual depth: for a circle
    // of radius r, surface height at sdf distance d is sqrt(-d*(2r+d)).
    // Costs early-z (depth is unknown until after shading), buys correct
    // intersection curves where parts interpenetrate.
    float rr = max(vRad.x, vRad.y);
    float zv = min(vZc + sqrt(max(-d * (2.0 * rr + d), 0.0)), -0.01);
    gl_FragDepth = 0.5 * (projectionMatrix[2][2] * zv + projectionMatrix[3][2]) / -zv + 0.5;
  #endif
  }
`;

// Triangle-banner shaders: three points flattened onto their mean-depth
// plane (perspective-correct like the capsule path), quad stretched over
// the projected triangle's bounding box, flat depth (skins have no bulge).
const VERT_TRI = /* glsl */ `
  uniform vec3 uA, uB, uC;
  uniform float uR1;
  varying vec2 vP, vA, vB, vC;
  varying float vZc;
  void main() {
    vec3 a = (modelViewMatrix * vec4(uA, 1.0)).xyz;
    vec3 b = (modelViewMatrix * vec4(uB, 1.0)).xyz;
    vec3 c = (modelViewMatrix * vec4(uC, 1.0)).xyz;
    float zc = (a.z + b.z + c.z) / 3.0;
    vec2 pa = a.xy * (zc / min(a.z, -1e-2));
    vec2 pb = b.xy * (zc / min(b.z, -1e-2));
    vec2 pc = c.xy * (zc / min(c.z, -1e-2));
    float pad = uR1 + 0.03;
    vec2 lo = min(pa, min(pb, pc)) - pad, hi = max(pa, max(pb, pc)) + pad;
    vec2 p = mix(lo, hi, position.xy * 0.5 + 0.5);
    vP = p; vA = pa; vB = pb; vC = pc; vZc = zc;
    gl_Position = projectionMatrix * vec4(p, zc, 1.0);
  }
`;

const FRAG_TRI = /* glsl */ `
  precision highp float;
  uniform float uBorderW, uR1, uPat;
  uniform vec3 uFill, uBorder;
  uniform mat4 projectionMatrix;
  varying vec2 vP, vA, vB, vC;
  varying float vZc;

  ${SDF_GLSL}

  void main() {
    float d = sdTri(vP, vA, vB, vC) - uR1;
    if (d > 0.0) discard;
    vec3 col = d > -uBorderW ? uBorder : uFill;
    if (uPat > 5.5 && d <= -uBorderW) {
      // wing spots (butterflies): a 5cm grid of soft dark dots
      vec2 sp = fract((vP - vA) / .05) - .5;
      col = mix(col, vec3(.07, .05, .05), smoothstep(.34, .2, length(sp)) * .85);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  #ifdef PIXEL_DEPTH
    float zv = vZc;
    gl_FragDepth = 0.5 * (projectionMatrix[2][2] * zv + projectionMatrix[3][2]) / -zv + 0.5;
  #endif
  }
`;

// Reduce a part's primitive to the canonical segment in the quad's rigid
// local space (the part's own non-uniform `scale` is baked in here and
// cancelled on the scene-graph side, see holder below).
export function segmentFor(part) {
  const s = part.scale ?? [1, 1, 1];
  const { shape, size } = part;
  // flat triangular membrane: three local corner points + corner rounding;
  // r2 = -1 flags the shape for the shaders
  if (shape === "tri") return { a: size.a, b: size.b, c: size.c, r1: size.r ?? .03, r2: -1 };
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
  return shape === "cone"
    ? { a: b, b: a, r1: size.r * rMul, r2: Math.max(size.r * .12, .008) * rMul }  // round base -> near-point apex
    : { a, b, r1: size.r * rMul, r2: size.r * rMul };
}

function bannerMesh(part, pixelDepth) {
  const seg = segmentFor(part);
  if (part.shape === "tri") {
    const mesh = new THREE.Mesh(QUAD, new THREE.ShaderMaterial({
      defines: pixelDepth ? { PIXEL_DEPTH: "" } : {},
      uniforms: {
        uA: { value: new THREE.Vector3(...seg.a) },
        uB: { value: new THREE.Vector3(...seg.b) },
        uC: { value: new THREE.Vector3(...seg.c) },
        uR1: { value: seg.r1 },
        uPat: { value: part.pat === "wingspots" ? 6 : 0 },
        uBorderW: { value: BORDER.width },
        uFill: { value: new THREE.Color(part.color) },
        uBorder: { value: new THREE.Color(BORDER.color) },
      },
      vertexShader: VERT_TRI,
      fragmentShader: FRAG_TRI,
    }));
    mesh.frustumCulled = false;
    return mesh;
  }
  const mesh = new THREE.Mesh(QUAD, new THREE.ShaderMaterial({
    defines: pixelDepth ? { PIXEL_DEPTH: "" } : {},
    uniforms: {
      uA: { value: new THREE.Vector3(...seg.a) },
      uB: { value: new THREE.Vector3(...seg.b) },
      uR1: { value: seg.r1 },
      uR2: { value: seg.r2 },
      uBorderW: { value: BORDER.width },
      uPat: { value: part.pat === "spots" ? 5 : part.pat === "bands" ? 4 : part.pat === "stripes" ? 3 : part.pat === "bark" ? 2 : part.pat === "leaf" ? 1 : 0 },
      uFill: { value: new THREE.Color(part.color) },
      uBorder: { value: new THREE.Color(BORDER.color) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  }));
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
    if (part.scale) group.scale.set(...part.scale);   // children inherit it, exactly like rig.js

    // holder: sits at the pivot and cancels the group's own non-uniform scale,
    // so the quad's local frame stays rigid (its scale is baked into A/B/r)
    const holder = new THREE.Group();
    holder.position.set(...(part.pivot ?? [0, 0, 0]));
    if (part.scale) holder.scale.set(1 / part.scale[0], 1 / part.scale[1], 1 / part.scale[2]);
    holder.add(bannerMesh(part, pixelDepth));
    group.add(holder);

    group.userData.baseRot = { x: rx, y: ry, z: rz };
    group.userData.anim = part.anim ?? null;

    nodes[part.id] = group;
    (part.parent ? nodes[part.parent] : root).add(group);
  }
  return root;
}
