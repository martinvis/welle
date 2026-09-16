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
import { SDF_GLSL, BORDER, OUTLINE } from "./banner.js";
import { PARALLAX } from "./textures.js";
import { compileDef, writeAnimal, easeGait } from "./skeleton.js";

const VERT = /* glsl */ `
  attribute vec3 aA, aB, aC;
  attribute vec2 aRad;
  attribute vec3 aFill;
  attribute float aPat;
  varying vec2 vP, vA, vB, vC;
  varying vec2 vRad;
  varying vec3 vFill, vAw, vBw, vCw, vAv, vBv;
  varying float vZc, vPat;
  varying vec2 vRw;
  void main() {
    vAw = aA; vBw = aB; vCw = aC; vRw = aRad;
    vec3 a = (viewMatrix * vec4(aA, 1.0)).xyz;
    vec3 b = (viewMatrix * vec4(aB, 1.0)).xyz;
    vAv = a; vBv = b;
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
  uniform float uOutline, uMaskMode;
  uniform vec3 uBorder;
  uniform mat4 projectionMatrix, uInvView;
  varying vec2 vP, vA, vB, vC;
  varying vec2 vRad;
  varying vec3 vFill, vAw, vBw, vCw, vAv, vBv;
  varying float vZc, vPat;
  varying vec2 vRw;
#if POM
  uniform float uPomFar;
#endif

  ${SDF_GLSL}

  void main() {
    bool tri = vRad.y < -0.5;
    float d = tri ? sdTri(vP, vA, vB, vC) - vRad.x
                  : sdUnevenCapsule(vP, vA, vB, vRad.x, vRad.y);
    if (d > 0.0) discard;
    // optional 1px outline (see banner.js); thin parts keep their fill color
    bool border = uOutline > 0.5 && d > -(tri ? fwidth(d) : min(fwidth(d), 0.5 * min(vRad.x, vRad.y)));
    vec3 col = border ? uBorder : vFill;
    // see banner.js: the exact ray hit on the 3D capsule for depth and the
    // pattern's surface point; membranes are flat skins at plane depth
    vec3 rd = normalize(vec3(vP, vZc));
    vec3 pv = tri ? vec3(vP, vZc) : rd * surfaceT(rd, vAv, vBv, vRw.x, vRw.y);
    float zv = min(pv.z, -0.01);
    if (!border) {
      vec3 pw = (uInvView * vec4(pv, 1.0)).xyz, pl = partLocal(pw, vAw, vBw);
      vec3 nw = tri ? triNormal(vAw, vBw, vCw, mat3(uInvView) * rd) : capsuleNormal(pw, vAw, vBw);
      float sh = shadeOf(nw), r = max(vRw.x, abs(vRw.y));
    #if POM
      // BARK PARALLAX (trunks and boughs; the relief: barkHeight): the view ray walked down into the bark over the
      // cylinder -- along the axis and round it by arc length -- in POM_STEPS layers to a fifth of the radius (2.5cm at
      // most; twigs stay smooth), refined between the last two; there the relief's slope tilts the normal (lit by the
      // same shading, 1.8x), POM_SHADOW reads toward the shading's light give the ridges short shadows, the furrows go
      // darker and the bark's colour is taken where the ray met it. Fades out toward uPomFar metres
      if (!tri && (abs(vPat - 2.0) < .5 || abs(vPat - 20.0) < .5) && r > .035) {
        vec3 V = uInvView[3].xyz - pw;
        float dist = length(V), fade = 1.0 - smoothstep(.65 * uPomFar, uPomFar, dist);
        vec3 ax = normalize(vBw - vAw), tn = normalize(cross(nw, ax)), vd = V / max(dist, 1e-4);   // along the axis; round it (the unwrap's +)
        float dn = dot(vd, nw), rr = max(length(pl.yz), 1e-3);
        if (fade > .01 && dn > .06) {
          float depth = min(.2 * r, .025) * fade;
          vec2 s = vec2(pl.x, atan(pl.z, pl.y) * r), ds = -vec2(dot(vd, ax), dot(vd, tn)) / dn * depth / float(POM_STEPS);
          float layer = 1.0, h = barkHeight(vPat, s, r), hPrev = h;
          for (int i = 0; i < POM_STEPS; i++) {
            if (h >= layer) break;
            hPrev = h; layer -= 1.0 / float(POM_STEPS); s += ds; h = barkHeight(vPat, s, r);
          }
          float after = h - layer, before = hPrev - (layer + 1.0 / float(POM_STEPS));
          s -= ds * clamp(after / max(after - before, 1e-5), 0.0, 1.0);
          float h0 = barkHeight(vPat, s, r), e = .003;
          vec2 slope = vec2(barkHeight(vPat, s + vec2(e, 0.0), r) - h0, barkHeight(vPat, s + vec2(0.0, e), r) - h0) / e * depth;
          vec3 np = normalize(nw - ax * slope.x - tn * slope.y);
          sh += 1.8 * dot(np - nw, vec3(.1, .2, .06));
        #if POM_SHADOW > 0
          vec3 Lw = normalize(vec3(.1, .2, .06)), lt = vec3(dot(Lw, ax), dot(Lw, tn), dot(Lw, nw));
          if (lt.z > .05 && h0 < .98) {
            float occ = 0.0;
            for (int i = 1; i <= POM_SHADOW; i++) {
              float up = (1.0 - h0) * float(i) / float(POM_SHADOW);
              occ = max(occ, barkHeight(vPat, s + lt.xy / lt.z * depth * up, r) - (h0 + up));
            }
            sh *= 1.0 - .45 * smoothstep(0.0, .12, occ);
          }
        #endif
          float th = s.y / r;
          pl = vec3(s.x, rr * cos(th), rr * sin(th));   // the colour where the ray met the bark
          col *= 1.0 - .28 * (1.0 - h0) * fade;
        }
      }
    #endif
      if (vPat > .5) col = patternAt(col, vPat, pl, r);
      col *= sh;
    }
    gl_FragColor = vec4(col, 1.0);
    // the grass mask (grass.js): a trunk, a bough, a bush is not grass and nothing may be painted over it --
    // written here, in the banner's own shader, because its silhouette is a cut-out no override material knows
    if (uMaskMode > .5) { gl_FragColor = vec4(0.0); }
    #include <colorspace_fragment>
  #ifdef PIXEL_DEPTH
    { float fd = viewDepth(projectionMatrix, vec3(vP, vZc) * (zv / vZc)); if (fd < 0.0) discard; gl_FragDepth = fd; }
  #endif
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
    defines: { ...(pixelDepth ? { PIXEL_DEPTH: "" } : {}), POM: PARALLAX.on ? 1 : 0, POM_STEPS: PARALLAX.steps, POM_SHADOW: PARALLAX.shadowSteps },   // POM: bark parallax
    uniforms: {
      uMaskMode: MASK_MODE,
      uOutline: OUTLINE,
      uBorder: { value: new THREE.Color(BORDER.color) },
      uInvView: { value: new THREE.Matrix4() },
      uPomFar: { value: PARALLAX.far },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  }));
  mesh.frustumCulled = false;
  mesh.userData.sdf = true;   // banners are cut out in the shader: never an occluder through an override material
  mesh.layers.enable(NOGRASS_LAYER);   // ...it writes the grass mask itself instead (MASK_MODE, above)
  mesh.onBeforeRender = (renderer, scene, camera) => { mesh.material.uniforms.uInvView.value.copy(camera.matrixWorld); };

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
      for (const an of animals) { easeGait(an, dt); writeAnimal(an, t, fA, fB, fC); }
      attrA.needsUpdate = attrB.needsUpdate = attrC.needsUpdate = true;
    },
  };
}
