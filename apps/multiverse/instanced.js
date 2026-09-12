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
import { segmentFor, SDF_GLSL, BORDER } from "./banner.js";

const VERT = /* glsl */ `
  attribute vec3 aA, aB, aC;
  attribute vec2 aRad;
  attribute vec3 aFill;
  attribute float aPat;
  varying vec2 vP, vA, vB, vC;
  varying vec2 vRad;
  varying vec3 vFill;
  varying float vZc, vPat;
  void main() {
    vec3 a = (viewMatrix * vec4(aA, 1.0)).xyz;
    vec3 b = (viewMatrix * vec4(aB, 1.0)).xyz;
    vec2 p;
    float zc;
    if (aRad.y < -0.5) {
      // triangle banner (membrane skin): flatten all three points onto the
      // mean-depth plane, stretch the quad over the projected bounding box
      vec3 c = (viewMatrix * vec4(aC, 1.0)).xyz;
      zc = (a.z + b.z + c.z) / 3.0;
      vec2 pa = a.xy * (zc / min(a.z, -1e-2));
      vec2 pb = b.xy * (zc / min(b.z, -1e-2));
      vec2 pc = c.xy * (zc / min(c.z, -1e-2));
      float pad = aRad.x + 0.03;
      vec2 lo = min(pa, min(pb, pc)) - pad, hi = max(pa, max(pb, pc)) + pad;
      p = mix(lo, hi, position.xy * 0.5 + 0.5);
      vA = pa; vB = pb; vC = pc;
      vRad = aRad;
    } else {
      // perspective-correct flatten onto the midpoint-depth plane (see the
      // banner.js vertex shader for the why)
      zc = (a.z + b.z) * 0.5;
      float ka = zc / min(a.z, -1e-2);
      float kb = zc / min(b.z, -1e-2);
      vec2 pa = a.xy * ka, pb = b.xy * kb;
      vec2 rad = vec2(aRad.x * ka, aRad.y * kb);
      vec2 ab = pb - pa;
      float l = length(ab);
      vec2 u = l > 1e-5 ? ab / l : vec2(1.0, 0.0);
      vec2 v = vec2(-u.y, u.x);
      float R = max(rad.x, rad.y) + 0.01;
      p = (pa + pb) * 0.5 + u * (position.x * (l * 0.5 + R)) + v * (position.y * R);
      vA = pa; vB = pb; vC = vec2(0.0);
      vRad = rad;
    }
    vP = p; vFill = aFill; vZc = zc; vPat = aPat;
    gl_Position = projectionMatrix * vec4(p, zc, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform float uBorderW;
  uniform vec3 uBorder;
  uniform mat4 projectionMatrix;
  varying vec2 vP, vA, vB, vC;
  varying vec2 vRad;
  varying vec3 vFill;
  varying float vZc, vPat;

  ${SDF_GLSL}

  void main() {
    bool tri = vRad.y < -0.5;
    float d = tri ? sdTri(vP, vA, vB, vC) - vRad.x
                  : sdUnevenCapsule(vP, vA, vB, vRad.x, vRad.y);
    if (d > 0.0) discard;
    float bw = tri ? uBorderW : min(uBorderW, 0.5 * min(vRad.x, vRad.y));   // thin parts keep their fill color
    vec3 col = d > -bw ? uBorder : vFill;
    if (vPat > .5 && d <= -bw) {
      vec2 q = (vP - vA) / max(vRad.x, .05);
      if (vPat > 6.5) {
        vec2 dseg = vB - vA;
        vec2 dir = length(dseg) > 1e-4 ? dseg / length(dseg) : vec2(1.0, 0.0);
        vec2 pp = vec2(dot(vP - vA, dir), dot(vP - vA, vec2(-dir.y, dir.x)));
        if (vPat > 7.5) {
          // diamond scales (beaver tail): two diagonal families of black lines, 2.5cm apart
          float m = max(step(.4, abs(fract((pp.x + pp.y) / .025) - .5)), step(.4, abs(fract((pp.x - pp.y) / .025) - .5)));
          col = mix(col, vec3(.03, .02, .02), m * .85);
        } else {
          // scutes (turtle shell): 5.5cm voronoi plates with dark seams
          col *= mix(.5, 1.0, smoothstep(.05, .16, cellBorder(pp / .055)));
        }
      } else if (vPat > 5.5) {
        // wing spots (butterflies): a 5cm grid of soft dark dots
        vec2 sp = fract((vP - vA) / .05) - .5;
        col = mix(col, vec3(.07, .05, .05), smoothstep(.34, .2, length(sp)) * .85);
      } else if (vPat > 4.5) {
        // giraffe patches, see banner.js
        vec2 dseg = vB - vA;
        vec2 dir = dseg / max(length(dseg), 1e-4);
        vec2 pp = vec2(dot(vP - vA, dir), dot(vP - vA, vec2(-dir.y, dir.x)));
        float m = smoothstep(.07, .15, cellBorder(pp / .5));
        col = mix(col, vec3(.36, .19, .07), m * .93);
      } else if (vPat > 2.5) {
        // stripes measured along the SEGMENT axis -> vertical on a horizontal
        // body, rings on legs; 3 = slightly wavy (tiger), 4 = straight (zebra)
        vec2 dseg = vB - vA;
        vec2 dir = dseg / max(length(dseg), 1e-4);
        float along = dot(vP - vA, dir);
        float across = dot(vP - vA, vec2(-dir.y, dir.x));
        float wig = vPat > 3.5 ? 0.0 : sin(across * 9.) * .6;
        float m = smoothstep(.45, .7, sin(along * 35. + wig));
        col = mix(col, vec3(.045, .04, .04), m * .96);
      } else {
        float m = vPat > 1.5
          ? smoothstep(.55, .8, fract(q.x * 1.4 + .3 * sin(q.y * 2.0)))
          : smoothstep(.2, .65, sin(q.x * 12.7 + 1.3) * sin(q.y * 13.9));
        col *= 1.0 - m * .12;
      }
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  #ifdef PIXEL_DEPTH
    // see banner.js: bulge the quad to the round solid's true depth
    // (membranes are flat skins: rr = 0 keeps them at plane depth)
    float rr = tri ? 0.0 : max(vRad.x, vRad.y);
    float zv = min(vZc + sqrt(max(-d * (2.0 * rr + d), 0.0)), -0.01);
    gl_FragDepth = 0.5 * (projectionMatrix[2][2] * zv + projectionMatrix[3][2]) / -zv + 0.5;
  #endif
  }
`;

// species def -> flat skeleton: parents come before children in the data,
// so a single forward pass can chain world matrices. Everything static is
// precomputed here: segment endpoints in group-local space (pivot + the
// inverse-scale trick from banner.js baked in) and radii with the ancestor
// mean-scale factor already applied, since the shader no longer sees any
// matrices to extract scale from.
const compiledCache = new Map();
function compileDef(def) {
  if (compiledCache.has(def)) return compiledCache.get(def);
  const index = new Map();
  const parts = def.parts.map((part, i) => {
    index.set(part.id, i);
    const seg = segmentFor(part);
    const s = part.scale ?? [1, 1, 1];
    const pivot = part.pivot ?? [0, 0, 0];
    const pA = new THREE.Vector3(...seg.a.map((v, k) => pivot[k] + v / s[k]));
    const pB = new THREE.Vector3(...seg.b.map((v, k) => pivot[k] + v / s[k]));
    const pC = seg.c ? new THREE.Vector3(...seg.c.map((v, k) => pivot[k] + v / s[k])) : pB;   // triangle's third corner (unused otherwise)
    let f = 1;   // ancestor mean-scale factor (the part's own scale is baked in by segmentFor)
    for (let pid = part.parent; pid; ) {
      const anc = def.parts[index.get(pid)];
      if (anc.scale) f *= (anc.scale[0] + anc.scale[1] + anc.scale[2]) / 3;
      pid = anc.parent;
    }
    return {
      parentIdx: part.parent ? index.get(part.parent) : -1,
      pos: part.pos ?? [0, 0, 0],
      baseRot: (part.rot ?? [0, 0, 0]).map((d) => d * Math.PI / 180),
      scale: part.scale ?? null,
      anim: part.anim ?? null,
      // body motion (head turns, tail swishes, neck sway) follows MOVEMENT in
      // general -- the gait clock, or a mount's own movement clock while it
      // flies with its legs hanging still. Swimmers and fliers keep
      // everything on the gait clock: their tails and wings ARE the locomotion
      idle: !def.fly && /^(head|neck|tail|ear|mane|trunk|snout|hair)/.test(part.id.replace(/^(r_|L_|R_)/, "")),
      pA, pB, pC, r1: seg.r1 * f, r2: seg.r2 < 0 ? -1 : seg.r2 * f,   // r2 = -1 stays the exact triangle flag
      pat: part.pat === "diamond" ? 8 : part.pat === "scutes" ? 7 : part.pat === "wingspots" ? 6 : part.pat === "spots" ? 5 : part.pat === "bands" ? 4 : part.pat === "stripes" ? 3 : part.pat === "bark" ? 2 : part.pat === "leaf" ? 1 : 0,
      color: new THREE.Color(part.color),
    };
  });
  compiledCache.set(def, parts);
  return parts;
}

const _mats = [];
const _root = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

function writeAnimal(an, t, fA, fB, fC) {
  const tt = an.animT !== undefined ? an.animT : t;   // per-animal gait clock (stops when standing)
  const tw = an.wingT !== undefined ? an.wingT : tt;   // wing clock (a flying mount beats wings, not legs)
  const tm = an.moveT !== undefined ? an.moveT : tt;   // movement clock for head/tail (set only by a flying mount)
  _root.makeRotationY(an.rotY).setPosition(an.position);
  if (an.hidden) _root.setPosition(an.position.x, -100, an.position.z);   // parked out of sight, position untouched
  for (let i = 0; i < an.parts.length; i++) {
    const p = an.parts[i];
    let [rx, ry, rz] = p.baseRot;
    if (p.anim) {
      const a = p.anim;
      const d = (a.deg * Math.PI / 180) * Math.sin((a.wing ? tw : p.idle ? tm : tt) * a.speed * Math.PI * 2 + (a.phase || 0));
      if (a.axis === "x") rx += d; else if (a.axis === "y") ry += d; else rz += d;
    }
    _local.makeRotationFromEuler(_e.set(rx, ry, rz));
    _local.setPosition(p.pos[0], p.pos[1], p.pos[2]);
    if (p.scale) _local.scale(_v.set(p.scale[0], p.scale[1], p.scale[2]));
    const world = _mats[i] ?? (_mats[i] = new THREE.Matrix4());
    world.multiplyMatrices(p.parentIdx < 0 ? _root : _mats[p.parentIdx], _local);
    const j = (an.base + i) * 3;
    _v.copy(p.pA).applyMatrix4(world);
    fA[j] = _v.x; fA[j + 1] = _v.y; fA[j + 2] = _v.z;
    _v.copy(p.pB).applyMatrix4(world);
    fB[j] = _v.x; fB[j + 1] = _v.y; fB[j + 2] = _v.z;
    if (p.r2 < 0) {
      _v.copy(p.pC).applyMatrix4(world);
      fC[j] = _v.x; fC[j + 1] = _v.y; fC[j + 2] = _v.z;
    }
  }
}

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
  const attrA = new THREE.InstancedBufferAttribute(fA, 3).setUsage(THREE.DynamicDrawUsage);
  const attrB = new THREE.InstancedBufferAttribute(fB, 3).setUsage(THREE.DynamicDrawUsage);
  const attrC = new THREE.InstancedBufferAttribute(fC, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aA", attrA);
  geo.setAttribute("aB", attrB);
  geo.setAttribute("aC", attrC);
  geo.setAttribute("aRad", new THREE.InstancedBufferAttribute(fRad, 2));
  geo.setAttribute("aFill", new THREE.InstancedBufferAttribute(fFill, 3));
  geo.setAttribute("aPat", new THREE.InstancedBufferAttribute(fPat, 1));
  geo.instanceCount = 0;

  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    defines: pixelDepth ? { PIXEL_DEPTH: "" } : {},
    uniforms: {
      uBorderW: { value: BORDER.width },
      uBorder: { value: new THREE.Color(BORDER.color) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  }));
  mesh.frustumCulled = false;

  const animals = [];
  let used = 0;
  return {
    mesh,
    animals,
    add(def) {
      const parts = compileDef(def);
      if (used + parts.length > capacity) throw new Error("herd capacity exceeded");
      const animal = { parts, base: used, position: new THREE.Vector3(), rotY: 0 };
      for (let i = 0; i < parts.length; i++) {
        fRad[(used + i) * 2] = parts[i].r1;
        fRad[(used + i) * 2 + 1] = parts[i].r2;
        fPat[used + i] = parts[i].pat;
        parts[i].color.toArray(fFill, (used + i) * 3);
      }
      used += parts.length;
      geo.instanceCount = used;
      animals.push(animal);
      return animal;
    },
    update(t) {
      for (const an of animals) writeAnimal(an, t, fA, fB, fC);
      attrA.needsUpdate = attrB.needsUpdate = attrC.needsUpdate = true;
    },
  };
}
