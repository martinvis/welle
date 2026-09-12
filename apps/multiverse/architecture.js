// Architecture engine: buildings composed from real architectural layers.
// Where the animals are round (and get the banner/SDF treatment), buildings
// are overwhelmingly cubic -- so honest low-poly geometry IS the cheap path:
// a box is 12 triangles, an 10-gon column 40. Parts are pure data
// ({shape, size, pos, color}) in METERS, generated layer by layer the way
// the real buildings are composed, so one generator covers a whole family
// (every Greek peripteral temple is the same five layers with different
// numbers plugged in: crepidoma -> peristyle -> entablature -> roof -> cella).
//
// Outlines reuse the flat-fill-plus-dark-border look: the outline copy is
// built by RE-GENERATING the primitive slightly larger (exact for boxes and
// cylinders, where scaling tricks would distort), drawn backface-only.
import * as THREE from "three";

const OUTLINE = { color: 0x201812, t: .03 };

// deterministic orientation shading: a face's brightness comes purely from
// which way it points (all six directions distinct), so same-colored walls
// meeting at a corner -- or a floor against a wall -- always read as
// separate planes, outdoors and indoors alike, independent of any lights
const PAT_IDS = { ashlar: 1, brick: 2, grooves: 3, stars: 4, marble: 5, tiles: 6, scroll: 7, gothic: 8, checker: 9, ornament: 10, parquet: 11, wood: 12,
                  rye: 13, barley: 14, beans: 15, garlic: 16, berries: 17, fruit: 18, cherries: 19 };   // 13-16 are cut-outs (transparent between the plants), 17-19 dots

// Shared weather uniform: 0..1 snow cover. Every archMaterial references
// this same object, so the demo flips all buildings at once.
export const SNOW = { value: 0 };

// `local`: pattern in the part's own space instead of world space -- for
// things that move (a swinging door keeps its grain)
function archMaterial(color, side, pat, accent, local = false) {
  // pat: mathematically-defined surface patterns in world space --
  //  ashlar: large stone courses, staggered joints   brick: tight running bond
  //  marble: hairline joints + soft veining (Greek precision masonry)
  //  grooves: vertical channels in an accent color (triglyphs)
  //  stars: a dot grid in an accent color (painted tympana, rosette bands)
  return new THREE.ShaderMaterial({
    defines: { PAT: PAT_IDS[pat] ?? 0, LOCAL_PAT: local ? 1 : 0 },
    uniforms: { uC: { value: new THREE.Color(color) }, uC2: { value: new THREE.Color(accent ?? 0xffffff) }, uSnow: SNOW },
    vertexShader: /* glsl */ `
      varying vec3 vN, vW, vL;
      void main() {
        vL = position;
        // the same material serves InstancedMesh copies (cart wheels): three
        // defines USE_INSTANCING and supplies instanceMatrix for those
      #ifdef USE_INSTANCING
        mat4 mm = modelMatrix * instanceMatrix;
      #else
        mat4 mm = modelMatrix;
      #endif
        vN = normalize(mat3(mm) * normal);
        vW = (mm * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uC, uC2;
      uniform float uSnow;
      varying vec3 vN, vW, vL;
      void main() {
        vec3 n = normalize(vN);
        vec3 col = uC;
        float k = .82 + .2 * n.y + .1 * n.x + .06 * n.z;
        float u = abs(n.x) > abs(n.z) ? vW.z : vW.x;          // coordinate along the face
      #if PAT == 1 || PAT == 2
        float ch = PAT == 2 ? .27 : .8;
        float bw = PAT == 2 ? .56 : 1.6;
        float row = floor(vW.y / ch);
        float m = step(fract(vW.y / ch), PAT == 2 ? .1 : .045);
        m = max(m, step(fract(u / bw + mod(row, 2.0) * .5), PAT == 2 ? .06 : .028));
        k *= 1.0 - m * (PAT == 2 ? .16 : .09);
      #elif PAT == 3
        col = mix(col, uC2, step(.62, fract(u * 6.0)));
      #elif PAT == 4
        vec2 cell = fract(vec2(u, vW.y) / .55) - .5;
        col = mix(col, uC2, smoothstep(.19, .13, length(cell)));
      #elif PAT == 5
        float row5 = floor(vW.y / 1.1);
        float m5 = step(fract(vW.y / 1.1), .015);
        m5 = max(m5, step(fract(u / 2.3 + mod(row5, 2.0) * .5), .0075));
        k *= 1.0 - m5 * .05;
        k *= 1.0 - .035 * (.5 + .5 * sin(vW.x * .8 + vW.y * 2.3 + vW.z * 1.1));
      #elif PAT == 6
        float rowT = floor(vW.y / .36);                       // scalloped tile courses
        float tu = fract(u / .32 + mod(rowT, 2.0) * .5) - .5;
        float m6 = step(fract(vW.y / .36), .14 + .2 * (1.0 - 2.0 * abs(tu)));
        m6 = max(m6 * .8, step(abs(tu), .03) * .5);
        k *= 1.0 - m6 * .2;
      #elif PAT == 7
        // flowing scrollwork: interfering waves curl into gilded tendrils
        vec2 s7 = vec2(u, vW.y) * 1.9;
        float w1 = sin(s7.x * 1.7 + sin(s7.y * 2.3 + s7.x * .8) * 1.6);
        float w2 = sin(s7.y * 2.1 + sin(s7.x * 1.3 - s7.y * .7) * 1.8 + 1.2);
        float m7 = smoothstep(.55, .8, w1 * w2);
        float e7 = smoothstep(.38, .55, w1 * w2) - m7;   // fine drawn outline
        col = mix(col, uC2, m7 + e7 * .45);
        col = mix(col, vec3(.05, .045, .04), smoothstep(.55, .82, -(w1 * w2)) * .9);   // black counter-figures
      #elif PAT == 9
        // checkerboard floor tiles (1.1m marble squares) with thin joints
        float ch9 = mod(floor(vW.x / 1.1) + floor(vW.z / 1.1), 2.0);
        col = mix(col, uC2, ch9 * .8);
        vec2 j9 = min(fract(vW.xz / 1.1), 1.0 - fract(vW.xz / 1.1));
        k *= 1.0 - .12 * step(min(j9.x, j9.y), .012);
      #elif PAT == 10
        // simple wall ornament: a diamond-lattice band with center bosses
        vec2 o10 = vec2(u, vW.y) / .85;
        vec2 f10 = abs(fract(o10) - .5);
        col = mix(col, uC2, smoothstep(.06, .02, abs(f10.x + f10.y - .5)) * .55);
        col = mix(col, uC2, smoothstep(.11, .05, length(fract(o10) - .5)) * .6);
      #elif PAT == 12
        // wood grain, slight: streaks along the board -- lengthwise on
        // horizontal faces, vertical on upright ones -- wandering a little
      #if LOCAL_PAT
        vec3 P = vL;
      #else
        vec3 P = vW;
      #endif
        float upF = step(.5, abs(n.y));
        float along = mix(P.y, P.x, upF);
        float across = mix(abs(n.x) > abs(n.z) ? P.z : P.x, P.z, upF);
        float g = sin(across * 42.0 + sin(along * 1.9 + across * 3.0) * 2.4 + sin(across * 8.5) * 1.1);
        k *= 1.0 - .075 * smoothstep(.25, .95, g) - .03 * smoothstep(.6, 1.0, sin(along * 23.0 + across * 15.0));
      #elif PAT == 11
        // parquet floor: .14m boards in 1.2m lengths, joints staggered by
        // half a board per row, each board its own warm tone
        float prw = floor(vW.z / .14);
        float pjx = fract(vW.x / 1.2 + mod(prw, 2.0) * .5);
        float pj = max(step(fract(vW.z / .14), .06), step(pjx, .02));
        float ptone = fract(sin(prw * 12.99 + floor(vW.x / 1.2 + mod(prw, 2.0) * .5) * 78.23) * 437.58);
        k *= (1.0 - pj * .22) * (.9 + .16 * ptone);
      #elif PAT == 8
        // gothic wall articulation, readable from a distance: recessed
        // pilaster strips with a lit carved edge every 3m, string courses,
        // fine blind-tracery lines in the upper bays, faint ashlar joints
        float du8 = min(fract(u / 3.0), 1.0 - fract(u / 3.0)) * 3.0;   // meters to the bay edge
        k *= 1.0 - .22 * smoothstep(.14, .05, du8);
        k *= 1.0 + .1 * (smoothstep(.3, .17, du8) - smoothstep(.14, .05, du8));
        float by8 = fract(vW.y / 6.5);
        k *= 1.0 - .16 * step(by8, .05);
        k *= 1.0 + .08 * step(.05, by8) * step(by8, .1);
        k *= 1.0 - .08 * step(.92, fract(u / .75)) * step(.45, by8);
        k *= 1.0 - .05 * step(fract(vW.y / .8), .06);
      #elif PAT >= 13 && PAT <= 16
        // crops as cut-outs: a thin see-through slab carries a row of plants
        // -- rye/barley stalks with ears, bean poles with leaves, garlic
        // leaf-fans -- and is discarded between them, so a field of thousands
        // of plants costs a few dozen boxes. Heights count from the soil top (.13m).
        float hgt = vW.y - .13;
      #if PAT == 13 || PAT == 14
        float H = PAT == 13 ? 1.15 : .85, cw = .07, earL = PAT == 13 ? .16 : .12, earW = PAT == 13 ? .026 : .034;
        float id = floor(u / cw), fu = fract(u / cw) - .5;
        float hs = fract(sin(id * 127.1) * 43758.5);
        float top = H * (.78 + .27 * hs);
        float dx = abs(fu * cw - (hs - .5) * .1 * hgt / H);   // a slight lean, each its own way
        if (hgt > top || hgt < 0.0) discard;
        if (hgt > top - earL) { if (dx > earW) discard; col = uC2; k *= .9 + .2 * hs; }
        else { if (dx > .011) discard; k *= .85 + .3 * hs; }
      #elif PAT == 15
        float cw = .5, id = floor(u / cw), fu = fract(u / cw) - .5;
        float hs = fract(sin(id * 91.7) * 43758.5);
        float top = 1.7 * (.85 + .2 * hs);
        if (hgt > top || hgt < 0.0) discard;
        float dx = fu * cw;
        float row = floor(hgt / .17), fr = fract(hgt / .17) - .5;
        float sd = mod(row + floor(hs * 2.0), 2.0) * 2.0 - 1.0;   // leaves alternate sides up the pole
        float lj = fract(sin(id * 31.3 + row * 17.1) * 43758.5);
        vec2 lc = vec2(dx - sd * (.07 + .05 * lj), fr * .17);
        float leaf = step(length(lc * vec2(1.0, 1.6)), .085);
        float pole = step(abs(dx), .014);
        if (leaf < .5 && pole < .5) discard;
        col = leaf > .5 ? uC2 : uC; k *= .85 + .3 * lj;
      #else
        float cw = .3, id = floor(u / cw), fu = fract(u / cw) - .5;
        float hs = fract(sin(id * 57.3) * 43758.5);
        float top = .45 * (.8 + .35 * hs);
        if (hgt > top || hgt < 0.0) discard;
        float dx = fu * cw, keep = 0.0;
        for (int i = -1; i <= 1; i++) {   // three leaves fanning out from the bulb
          float lx = float(i) * (.05 + .04 * hs) * hgt / .45 + (hs - .5) * .04;
          keep = max(keep, step(abs(dx - lx), .012 * (1.0 - .5 * hgt / top)));
        }
        if (keep < .5) discard;
        k *= .85 + .3 * hs;
      #endif
      #elif PAT >= 17 && PAT <= 19
        // currants (17, ~1cm), apples (18, ~8cm) and cherries (19, ~2.5cm): sharp dots of the accent color scattered over a crown
        float c = PAT == 17 ? .065 : PAT == 18 ? .25 : .08, rr = PAT == 17 ? .005 : PAT == 18 ? .04 : .0125;
        vec3 cell = floor(vW / c), f = fract(vW / c);
        vec3 jit = fract(sin(vec3(dot(cell, vec3(127.1, 311.7, 74.7)), dot(cell, vec3(269.5, 183.3, 246.1)), dot(cell, vec3(113.5, 271.9, 124.6)))) * 43758.5) * .5 + .25;
        float show = step(fract(sin(dot(cell, vec3(12.9, 78.2, 37.7))) * 4375.5), PAT == 17 ? .9 : PAT == 18 ? .75 : .85);   // a heavy crop
        col = mix(col, uC2, step(length((f - jit) * c), rr) * show);
      #endif
        vec3 shaded = col * k;
        // snow settles on upward-facing surfaces well above the ground
        // (roofs, cornices, the stands) -- walls and columns stay bare
        // the ramp starts near 0 so even steep spires collect snow;
        // true verticals (walls, columns) still stay bare
        shaded = mix(shaded, vec3(.93, .94, .97),
                     uSnow * smoothstep(.06, .45, n.y) * smoothstep(3.2, 5.5, vW.y));
        gl_FragColor = vec4(shaded, 1.0);
        #include <colorspace_fragment>
      }`,
    side: side === "double" ? THREE.DoubleSide : THREE.FrontSide,
  });
}

// wood with grain in the object's own space: door and window panels the demo hinges
export const woodMaterial = (color) => archMaterial(color, undefined, "wood", undefined, true);

// ---- primitives -----------------------------------------------------------

// triangular prism, ridge along Z, origin at the base-rectangle center --
// one of these is a whole gable roof: the sloped planes plus both pediment
// triangles as its end caps
function gablePrism(w, h, len) {
  const hw = w / 2, hl = len / 2;
  const A0 = [-hw, 0, -hl], B0 = [hw, 0, -hl], C0 = [0, h, -hl];
  const A1 = [-hw, 0, hl], B1 = [hw, 0, hl], C1 = [0, h, hl];
  const tris = [
    A1, B1, C1,                      // front pediment (+z)
    B0, A0, C0,                      // back pediment (-z)
    A0, B0, B1, A0, B1, A1,          // underside
    B0, C0, C1, B0, C1, B1,          // right slope
    A0, A1, C1, A0, C1, C0,          // left slope
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(), 3));
  geo.computeVertexNormals();        // non-indexed -> flat faces
  return geo;
}

const geoCache = new Map();
function geoFor(shape, size, inflate = 0) {
  const key = shape + inflate + JSON.stringify(size);
  if (geoCache.has(key)) return geoCache.get(key);
  let g;
  if (shape === "box") g = new THREE.BoxGeometry(size[0] + 2 * inflate, size[1] + 2 * inflate, size[2] + 2 * inflate);
  else if (shape === "cyl") g = new THREE.CylinderGeometry(size.r1 + inflate, size.r2 + inflate, size.h + 2 * inflate, size.seg ?? 10, 1, !!size.open);
  else if (shape === "sphere") g = new THREE.SphereGeometry(size.r + inflate, 10, 8);
  else if (shape === "capsule") g = new THREE.CapsuleGeometry(size.r + inflate, size.len, 3, 8);   // { r, len }: len = the straight middle, as in the species rigs
  else if (shape === "arch") {
    // half-cylinder, flat side down, thickness along z -- a Roman arch top
    g = new THREE.CylinderGeometry(size.r + inflate, size.r + inflate, size.t + 2 * inflate, 10, 1, false, 0, Math.PI);
    g.rotateX(Math.PI / 2);
    g.rotateZ(Math.PI / 2);
  } else if (shape === "hwall") {
    // a wall with real rectangular openings (windows, doors) cut through it:
    // one extruded mesh regardless of hole count. Origin at the wall's base
    // center; size { w, h, t, holes: [[u, y, hw, hh], ...] }.
    const w2 = size.w / 2 + inflate, top = size.h + inflate, y0 = -inflate;
    const s = new THREE.Shape();
    s.moveTo(-w2, y0); s.lineTo(w2, y0); s.lineTo(w2, top); s.lineTo(-w2, top);
    for (const [u, y, hw, hh] of size.holes ?? []) {
      const a = Math.max(.05, hw / 2 - inflate), c = Math.max(.05, hh - 2 * inflate);
      const hp = new THREE.Path();
      hp.moveTo(u - a, y + inflate); hp.lineTo(u - a, y + inflate + c);
      hp.lineTo(u + a, y + inflate + c); hp.lineTo(u + a, y + inflate);
      s.holes.push(hp);
    }
    const dep = size.t + 2 * inflate;
    g = new THREE.ExtrudeGeometry(s, { depth: dep, bevelEnabled: false });
    g.translate(0, 0, -dep / 2);
  } else if (shape === "spandrel") {
    // wall panel with a PERFECT semicircular arch bitten out of its underside
    // (origin at the arch spring line), extruded to real wall depth -- the
    // opening is a true arc you see and walk through, and the inflated
    // outline copy's smaller bite draws the dark rim around the curve
    const w2 = size.w / 2 + inflate, top = size.h + inflate, r = Math.max(.05, size.r - inflate), y0 = -inflate;
    const s = new THREE.Shape();
    s.moveTo(-w2, y0);
    s.lineTo(-r, y0);
    s.absarc(0, y0, r, Math.PI, 0, true);
    s.lineTo(w2, y0);
    s.lineTo(w2, top);
    s.lineTo(-w2, top);
    const d = size.t + 2 * inflate;
    g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 24 });
    g.translate(0, 0, -d / 2);
  } else if (shape === "wedge") {
    // flat right-triangle plate: legs along +x and +z from the origin
    // corner, size = [legX, height, legZ]
    const lx = size[0] + inflate, lz = size[2] + inflate, hh = size[1] + 2 * inflate;
    const s = new THREE.Shape();
    s.moveTo(-inflate, inflate); s.lineTo(lx, inflate); s.lineTo(-inflate, -lz);
    g = new THREE.ExtrudeGeometry(s, { depth: hh, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -hh / 2, 0);
  } else g = gablePrism(size[0] + 3 * inflate, size[1] + 2 * inflate, size[2] + 2 * inflate);
  geoCache.set(key, g);
  return g;
}

export function buildBuilding(def) {
  const root = new THREE.Group();
  root.name = def.name;
  const outlineMat = new THREE.MeshBasicMaterial({ color: OUTLINE.color, side: THREE.BackSide });
  const glassMats = new Map();
  const glassFor = (c) => {
    if (!glassMats.has(c)) glassMats.set(c, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: .38,
                                                                          depthWrite: false, side: THREE.DoubleSide }));
    return glassMats.get(c);
  };
  // stained glass: a world-space diamond lattice, each cell hash-picking a
  // color from the classic palette, with near-opaque lead lines between
  const stainedMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vW, vN;
      void main() {
        vW = (modelMatrix * vec4(position, 1.0)).xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vW, vN;
      void main() {
        float u = abs(vN.x) > abs(vN.z) ? vW.z : vW.x;
        vec2 q = vec2(u + vW.y, u - vW.y) / .62;
        float h = fract(sin(dot(floor(q), vec2(127.1, 311.7))) * 43758.5);
        vec3 col = h < .3 ? vec3(.14, .24, .55) : h < .5 ? vec3(.55, .12, .15)
                 : h < .68 ? vec3(.72, .55, .16) : h < .86 ? vec3(.16, .4, .24) : vec3(.38, .2, .5);
        vec2 f = abs(fract(q) - .5);
        float lead = step(.43, max(f.x, f.y));
        col = mix(col, vec3(.07, .06, .05), lead);
        gl_FragColor = vec4(col, mix(.55, .92, lead));
        #include <colorspace_fragment>
      }`,
  });
  // MERGED static geometry: a building never moves, so every part sharing a
  // material collapses into ONE BufferGeometry/draw call (a cathedral goes
  // from ~1000 draws to ~40), and every outline hull merges into a single
  // draw. World-space patterns and orientation shading read baked positions
  // and normals identically, so nothing changes visually.
  const buckets = new Map();   // material -> [transformed geometries]
  const fillMats = new Map();
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e2 = new THREE.Euler(),
        _vp = new THREE.Vector3(), _vs = new THREE.Vector3();
  const addTo = (mat, geo, p) => {
    const g2 = geo.index ? geo.toNonIndexed() : geo.clone();
    const [rx, ry, rz] = (p.rot ?? [0, 0, 0]).map((d) => d * Math.PI / 180);
    _m4.compose(_vp.set(...p.pos), _q.setFromEuler(_e2.set(rx, ry, rz)), _vs.set(...(p.scale ?? [1, 1, 1])));
    g2.applyMatrix4(_m4);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(g2);
  };
  def.parts.forEach((p, pi) => {
    if (p.render === false) return;   // collider-only parts (a solid stand-in under a pitched handrail)
    const mk = p.color + (p.side ?? "") + (p.pat ?? "") + (p.accent ?? "");
    if (!fillMats.has(mk)) fillMats.set(mk, archMaterial(p.color, p.side, p.pat, p.accent));
    // per-part inflation, 1.2-10.8mm cycling with the part index: two parts
    // authored on the same plane end up a few mm apart instead of
    // z-fighting, and flush neighbors overlap rather than gap
    const eps = p.glass ? 0 : (pi % 9 + 1) * .0012;
    addTo(p.glass === "stained" ? stainedMat : p.glass ? glassFor(p.color) : fillMats.get(mk),
          geoFor(p.shape, p.size, eps), p);
    if (p.outline !== false && !p.glass)           // glass must NOT get the hull outline: its dark
      addTo(outlineMat, geoFor(p.shape, p.size, OUTLINE.t + eps), p);   // backside would show through
  });
  for (const [mat, geos] of buckets) {
    let total = 0;
    for (const g of geos) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
    let o = 0;
    for (const g of geos) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      o += g.attributes.position.count;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    merged.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    root.add(new THREE.Mesh(merged, mat));
  }
  return root;
}

// The same merged-material build, but as InstancedMesh copies: one draw
// call per material for `count` identical, independently placed objects
// (every cart wheel of one size across the whole fleet). set(i, matrix)
// places copy i; commit() uploads after a batch of sets.
export function buildInstanced(def, count) {
  const built = buildBuilding(def);
  const root = new THREE.Group();
  root.name = def.name;
  const meshes = [];
  for (const m of built.children) {
    const im = new THREE.InstancedMesh(m.geometry, m.material, count);
    im.frustumCulled = false;   // copies roam the whole world
    root.add(im);
    meshes.push(im);
  }
  return {
    root,
    set(i, mat) { for (const im of meshes) im.setMatrixAt(i, mat); },
    commit() { for (const im of meshes) im.instanceMatrix.needsUpdate = true; },
  };
}

// ---- generic Greek peripteral temple --------------------------------------
// All lengths in meters; y=0 is the ground. `width`/`length` describe the
// stylobate (the top platform the columns stand on).

const linspace = (a, b, k) => Array.from({ length: k }, (_, i) => a + (b - a) * i / (k - 1));

// ---- stairs -----------------------------------------------------------------
// Real staircases (0.25m risers) replacing the old ramps: boxes stacked into
// a sawtooth. stairSteps emits geometry for a straight flight along z;
// stairY is the matching walk height -- the top of the step underfoot at
// progress t in [0,1] -- used by the generators' floorY samplers so movement
// climbs step by step (each riser is well under the 0.5m climb limit).
// The last meter of every flight is a flat landing at full height, so the
// climb is steeper but arrival on the floor is eased.
// Real proportions: ~0.3m treads, so the flight is compact and anchored at
// the landing (z1) end -- the walker crosses flat floor to the first step.
// `rail`: +1/-1 = the x side of the flight that is open (no wall) -- the
// flight gets a balustrade: a baluster per step (close enough that the
// walker's .5m circle cannot slip between) and a sloped handrail. The top
// landing is left open, so nothing blocks stepping off. Stairs against a
// wall pass no rail.
export function stairSteps(parts, { x, w, y0, rise, z0, z1, color, rail = 0 }) {
  const run = Math.abs(z1 - z0), dir = Math.sign(z1 - z0);
  const n = Math.max(2, Math.round(rise / .25)), dy = rise / n;
  const plat = Math.min(1, run * .35);
  const climb = Math.min(n * .3, run - plat);
  const dz = dir * climb / n, zs = z1 - dir * (plat + climb);
  for (let i = 0; i < n; i++)
    parts.push({ shape: "box", size: [w, dy + .06, Math.abs(dz) + .04],
                 pos: [x, y0 + (i + 1) * dy - (dy + .06) / 2 + .03, zs + (i + .5) * dz], color });
  parts.push({ shape: "box", size: [w, .14, plat + .06],
               pos: [x, y0 + rise - .04, z1 - dir * plat / 2], color });
  if (rail) {
    const xr = x + rail * (w / 2 + .05), dark = 0x3e2c1a;
    for (let i = 0; i < n; i++)
      parts.push({ shape: "box", size: [.08, .95, .08], pos: [xr, y0 + (i + 1) * dy + .475, zs + (i + .5) * dz], color: dark, outline: false });
    // the landing at the top stays open on every side: that is where you step off
    const L = Math.hypot(climb, rise), th = Math.atan2(rise, climb) * 180 / Math.PI;
    parts.push({ shape: "box", size: [.07, .07, L], pos: [xr, y0 + rise / 2 + .95, zs + dir * climb / 2], rot: [-dir * th, 0, 0], color: dark });   // handrail (pitched: visual)
  }
}
// Balustrade around a stairwell opening in a floor slab. {x0,x1,z0,z1} is
// the hole, y the slab top, `side` the open x side (the other side is the
// wall the flight hugs), `landAt` the z end where the flight arrives: the
// landing's stretch on the open side stays free (that is where you step
// off, either sideways or straight ahead), the far end is a drop over the
// flight below and gets railed, and the landing end is slab and needs none.
export function wellRail(parts, { x0, x1, z0, z1, y, side, landAt, plat = 1.05 }) {
  const dark = 0x3e2c1a;
  const post = (x, z) => parts.push({ shape: "box", size: [.08, .95, .08], pos: [x, y + .475, z], color: dark, outline: false });
  const xo = side > 0 ? x1 : x0;
  const [za, zb] = landAt === "z0" ? [z0 + plat, z1] : [z0, z1 - plat];   // the open side minus the landing
  if (zb - za > .2) {
    const n = Math.max(1, Math.round((zb - za) / .45));
    for (let i = 0; i <= n; i++) post(xo, za + (zb - za) * i / n);
    parts.push({ shape: "box", size: [.07, .07, zb - za + .08], pos: [xo, y + .95, (za + zb) / 2], color: dark });
  }
  const zd = landAt === "z0" ? z1 : z0;   // the drop end
  const n2 = Math.max(1, Math.round((x1 - x0) / .45));
  for (let i = 1; i < n2; i++) post(x0 + (x1 - x0) * i / n2, zd);
  parts.push({ shape: "box", size: [x1 - x0 + .08, .07, .07], pos: [(x0 + x1) / 2, y + .95, zd], color: dark });
}
export const stairY = (y0, rise, t, run = 8) => {
  const n = Math.max(2, Math.round(rise / .25));
  const plat = Math.min(1, run * .35);
  const climb = Math.min(n * .3, run - plat);
  const tc = (Math.max(0, t) * run - (run - plat - climb)) / climb;   // progress within the flight itself
  if (tc <= 0) return y0;
  return y0 + Math.min(n, Math.floor(tc * n) + 1) * (rise / n);
};

// Polychromy presets -- best-guess reconstructions of how the temples were
// painted. Pick per building so not every temple looks alike.
export const GREEK_PAINT = {
  festival: { triglyph: 0x2e4f6e, metope: 0x9e3c2c, tympanum: 0x8a3325 },   // blue triglyphs, red ochre fields
  aegean:   { triglyph: 0x274a63, metope: 0xc8b795, tympanum: 0x35566b },   // blue on cream, deep blue pediment
};

export function greekTemple({
  name,
  width, length,                     // stylobate
  columnsFront, columnsSide,         // peripteral ring, corners counted in both
  columnH, columnD,                  // full column height / lower shaft diameter
  steps = 3, stepH = .3, stepOut = .33,
  entablatureH = columnH * .29,
  pedimentH = width * .125,
  colonnadeRows = 1,                 // 2 = dipteral (a second ring inside the first)
  roof = true,                       // false = hypaethral: entablature but open sky (Didyma)
  paint = null,                      // a GREEK_PAINT preset: painted frieze + tympanum
  cella = true,
  stone = 0xd8d2c2, stoneDark = 0xc2b9a6, stoneShadow = 0xa89f8c,
}) {
  const parts = [];

  // 1) crepidoma: the stepped platform, each step protruding stepOut further
  const baseY = steps * stepH;
  for (let i = 0; i < steps; i++) {
    const out = 2 * stepOut * (steps - 1 - i);
    parts.push({ shape: "box", size: [width + out, stepH, length + out],
                 pos: [0, i * stepH + stepH / 2, 0], color: i === steps - 1 ? stone : stoneDark, pat: "marble" });
  }

  // 2) peristyle: ring of Doric columns (tapered shaft, echinus flare, abacus)
  const r = columnD / 2;
  const inset = columnD * .8;                    // stylobate edge -> column axis
  const capH = Math.min(.5, columnH * .085), echH = capH * .45, abaH = capH * .55;
  const shaftH = columnH - capH;
  const topR = r * .78, abaW = columnD * .96;
  for (let row = 0; row < colonnadeRows; row++) {
    const rowIn = inset + row * columnD * 2.2;
    const xs = linspace(-(width / 2 - rowIn), width / 2 - rowIn, columnsFront);
    const zs = linspace(-(length / 2 - rowIn), length / 2 - rowIn, columnsSide);
    for (let xi = 0; xi < xs.length; xi++) for (let zi = 0; zi < zs.length; zi++) {
      if (xi > 0 && xi < xs.length - 1 && zi > 0 && zi < zs.length - 1) continue;   // perimeter only
      const [x, z] = [xs[xi], zs[zi]];
      parts.push({ shape: "cyl", size: { r1: topR, r2: r, h: shaftH }, pos: [x, baseY + shaftH / 2, z], color: stone, pat: "marble" });
      parts.push({ shape: "cyl", size: { r1: abaW * .46, r2: topR, h: echH }, pos: [x, baseY + shaftH + echH / 2, z], color: stone });
      parts.push({ shape: "box", size: [abaW, abaH, abaW], pos: [x, baseY + shaftH + echH + abaH / 2, z], color: stone });
    }
  }

  // 3) entablature: architrave + frieze band + protruding cornice. Under a
  // roof solid slabs are fine (invisible from below the gable); a hypaethral
  // temple needs a true RING beam over the colonnade, open to the sky inside
  const entW = width - 2 * inset + columnD;      // flush with the column bases
  const entL = length - 2 * inset + columnD;
  const entY = baseY + columnH;
  const archH = entablatureH * .42, friezeH = entablatureH * .42, cornH = entablatureH * .16;
  const bands = [[archH, 0, 0, stone], [friezeH, archH, 0, paint ? paint.metope : stoneDark], [cornH, archH + friezeH, .5, stone]];
  const bandPat = (c) => paint && c === paint.metope ? { pat: "stars", accent: 0xd9c27a } : { pat: "marble" };
  if (roof) {
    for (const [h, y0, pad, c] of bands)
      parts.push({ shape: "box", size: [entW + pad, h, entL + pad], pos: [0, entY + y0 + h / 2, 0], color: c, ...bandPat(c) });
  } else {
    const bw = columnD * (colonnadeRows > 1 ? 4.4 : 1.9);   // beam deep enough to cover every column row
    for (const [h, y0, pad, c] of bands) {
      const y = entY + y0 + h / 2;
      for (const sz of [-1, 1]) {
        parts.push({ shape: "box", size: [entW + pad, h, bw], pos: [0, y, sz * (entL + pad - bw) / 2], color: c, ...bandPat(c) });
        parts.push({ shape: "box", size: [bw, h, entL + pad - 2 * bw], pos: [sz * (entW + pad - bw) / 2, y, 0], color: c, ...bandPat(c) });
      }
    }
  }

  // painted frieze: blue triglyphs marching over the colored metope band --
  // two per intercolumniation plus one over each column, all four sides
  if (paint) {
    const ty = entY + archH + friezeH / 2, th = friezeH * .8;
    for (const x of linspace(-(entW / 2 - .9), entW / 2 - .9, 2 * columnsFront - 1))
      for (const sz of [-1, 1])
        parts.push({ shape: "box", size: [.85, th, .5], pos: [x, ty, sz * (entL / 2 - .1)], color: paint.triglyph, pat: "grooves", accent: 0x18293c });
    for (const z of linspace(-(entL / 2 - .9), entL / 2 - .9, 2 * columnsSide - 1))
      for (const sx of [-1, 1])
        parts.push({ shape: "box", size: [.5, th, .85], pos: [sx * (entW / 2 - .1), ty, z], color: paint.triglyph, pat: "grooves", accent: 0x18293c });
  }

  // 4) roof: a single gable prism is the two slopes AND both pediments;
  // when painted, a slightly longer inset gable shows the colored tympanum
  // triangle inside the marble frame at both ends
  if (roof) parts.push({ shape: "gable", size: [entW + .5, pedimentH, entL + .5],
                         pos: [0, entY + entablatureH, 0], color: stone, pat: "marble" });
  if (roof && paint) parts.push({ shape: "gable", size: [entW * .86, pedimentH * .78, entL + .56],
                                  pos: [0, entY + entablatureH + .1, 0], color: paint.tympanum, outline: false, pat: "scroll", accent: 0xd9b54a });

  // 5) cella: a real room -- side and back walls, a doorway up front, ceiling
  if (cella) {
    const cw = width * .5, cl = length * .62, ch = columnH * .96, t = .9;
    const doorW = Math.min(3.2, cw * .3), doorH = ch * .62;
    const wall = (sz, pos) => parts.push({ shape: "box", size: sz, pos, color: stoneShadow, pat: "marble" });
    wall([t, ch, cl], [-(cw - t) / 2, baseY + ch / 2, 0]);
    wall([t, ch, cl], [(cw - t) / 2, baseY + ch / 2, 0]);
    wall([cw, ch, t], [0, baseY + ch / 2, -(cl - t) / 2]);
    const jamb = (cw - doorW) / 2;
    wall([jamb, ch, t], [-(doorW + jamb) / 2, baseY + ch / 2, (cl - t) / 2]);
    wall([jamb, ch, t], [(doorW + jamb) / 2, baseY + ch / 2, (cl - t) / 2]);
    wall([doorW, ch - doorH, t], [0, doorH + baseY + (ch - doorH) / 2, (cl - t) / 2]);
    if (roof) wall([cw, .5, cl], [0, baseY + ch + .25, 0]);   // hypaethral cella: open court
  }

  // walking up the crepidoma raises you step by step onto the stylobate
  const floorY = (x, z) => {
    let h = 0;
    for (let i = 0; i < steps; i++) {
      const out = stepOut * (steps - 1 - i);
      if (Math.abs(x) <= width / 2 + out && Math.abs(z) <= length / 2 + out) h = (i + 1) * stepH;
    }
    return h;
  };

  const spread = 2 * stepOut * (steps - 1);    // the bottom step is the true footprint
  return { name, parts, footprint: [width + spread, length + spread], floorY };
}

// ---- generic Roman amphitheatre -------------------------------------------
// An elliptical arcade wall: stacked stories of pier-arch-pier rings around
// a dark inner drum, topped by a solid attic. Openings are composed
// positively: stone piers + a stone spandrel panel over each bay, with a
// dark half-cylinder "void" whose flat base tops the see-through gap -- so
// every opening reads as an arch without any real hole-cutting. Circular
// rings become ellipses by squashing z (built at radius outerA, scaled by
// outerB/outerA), so outline thickness stays honest.

export function romanAmphitheatre({
  name,
  outerA, outerB,                    // semi-axes of the outer ellipse
  stories = 3, storyH = 10.7, atticH = 13.5,
  arches = 40,                       // arcade bays per ring (the original: 80)
  wallT = 3, bandH = 1.1, plinthH = 1.5,
  stone = 0xd9cdb4, stoneDark = 0xc2b598, voidDark = 0x453f34,
}) {
  const parts = [];
  const ratio = outerB / outerA;
  const squash = [1, 1, ratio];
  const ring = (r, h, y, color, extra = {}) =>
    parts.push({ shape: "cyl", size: { r1: r, r2: r, h, seg: 72, open: extra.open }, pos: [0, y, 0], scale: squash, color, ...extra });

  // collide: false -- these are walk-ON platforms; a closed cylinder would
  // otherwise become a solid DISC collider trapping anyone below its top
  ring(outerA + 1.2, plinthH, plinthH / 2, stoneDark, { collide: false });
  ring(outerA + 4, .7, .35, stoneDark, { collide: false });   // broad lower step of the entrance approach
  const wallH = stories * storyH;

  // cavea: the seating bowl as one open funnel surface sloping from the
  // ambulatory rim down to the arena -- walkable (the floor field follows
  // the slope), visible from both sides, no caps so the arena stays open
  const arenaA = outerA * .42;
  const bowlOut = outerA - 10;
  const bowlTop = 18.9;
  // the whole bowl sits ON the plinth (whose disc top, at plinthH, is the
  // true visible ground everywhere inside) -- sand, slope and seating all
  // measure from there, so nothing stands buried in the platform
  parts.push({ shape: "cyl", size: { r1: bowlOut, r2: arenaA, h: bowlTop, seg: 72, open: true },
               pos: [0, plinthH + bowlTop / 2, 0], scale: squash, color: stoneDark, side: "double", outline: false });
  for (let i = 1; i <= 8; i++) {           // seating rows resting on the slope
    const rr = arenaA + (bowlOut - arenaA) * i / 8.5;
    const hy = plinthH + .3 + (rr - arenaA) / (bowlOut - arenaA) * bowlTop;
    parts.push({ shape: "cyl", size: { r1: rr, r2: rr, h: .55, seg: 72, open: true },
                 pos: [0, hy, 0], scale: squash, color: stone, side: "double", outline: false });
  }
  ring(arenaA, .3, plinthH + .15, 0xcbb98a, { collide: false });   // the sand of the arena, on the plinth

  // two STRAIGHT staircases from the ambulatory up to the bowl rim, like
  // the real vomitoria: each a solid ascending mass of treads, walled on
  // both sides, slanting inward from the outer arcades to the rim
  const bowlTopF = plinthH + .3 + bowlTop;
  const stRise = bowlTopF - plinthH;
  const stairChords = [];
  for (const t0 of [0, Math.PI]) {
    const th0 = t0 + .12, th1 = t0 + .40;
    const ax = (outerA - 2.5) * Math.cos(th0), az = (outerA - 2.5) * ratio * Math.sin(th0);
    const bx2 = (bowlOut + 1.2) * Math.cos(th1), bz2 = (bowlOut + 1.2) * ratio * Math.sin(th1);
    const len = Math.hypot(bx2 - ax, bz2 - az);
    const ux = (bx2 - ax) / len, uz = (bz2 - az) / len;
    stairChords.push({ ax, az, ux, uz, len });
    const ry = Math.atan2(ux, uz) * 57.29578;
    const at = (lz, lx) => [ax + ux * lz + uz * lx, az + uz * lz - ux * lx];
    const n = Math.max(2, Math.round(stRise / .25));
    const plat = Math.min(1, len * .35);
    const climb = Math.min(n * .3, len - plat);
    const dz = climb / n, zc0 = len - plat - climb;
    for (let k = 0; k < n; k++) {
      const [wx2, wz2] = at(zc0 + (k + .5) * dz, 0);
      const th2 = (k + 1) * (stRise / n) + .06;
      parts.push({ shape: "box", size: [4.6, th2, dz + .04], rot: [0, ry, 0], outline: false,
                   pos: [wx2, plinthH + th2 / 2 - .03, wz2], color: stoneDark });
    }
    const [lxp, lzp] = at(len - plat / 2, 0);
    parts.push({ shape: "box", size: [4.6, stRise + .1, plat + .06], rot: [0, ry, 0],
                 pos: [lxp, plinthH + (stRise + .1) / 2 - .05, lzp], color: stoneDark });
    for (const s2 of [-2.55, 2.55]) {                // flanking walls: nothing to fall off
      const [wx2, wz2] = at(len / 2, s2);
      parts.push({ shape: "box", size: [.4, stRise + 1.2, len + .8], rot: [0, ry, 0],
                   pos: [wx2, plinthH + (stRise + 1.2) / 2, wz2], color: stone, pat: "ashlar" });
    }
  }

  // radial spoke walls with arched passages between the bowl and the outer
  // arcades -- the plan of the real substructure, walkable straight through
  const spokeR0 = bowlOut + .5, spokeR1 = outerA - wallT / 2;
  for (let i = 0; i < arches / 2; i++) {
    const a = 2 * Math.PI * (i + .5) / (arches / 2);
    const near = (t0) => { const d = ((a - t0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); return d < .55 || d > 2 * Math.PI - .1; };
    if (near(0) || near(Math.PI)) continue;   // keep clear of the two staircases
    const mid = (spokeR0 + spokeR1) / 2;
    parts.push({ shape: "hwall", size: { w: spokeR1 - spokeR0, h: 7.5, t: .9, holes: [[0, 0, 3.2, 4.6]] },
                 pos: [mid * Math.cos(a), plinthH, mid * ratio * Math.sin(a)],
                 rot: [0, -a * 57.29578, 0], color: stone, pat: "ashlar" });
  }

  // arcade proportions per bay
  const perim = Math.PI * (3 * (outerA + outerB) - Math.sqrt((3 * outerA + outerB) * (outerA + 3 * outerB)));
  const bay = perim / arches;
  const pierW = bay * .42, openW = bay * .55, archR = openW / 2, spandrelH = 1.2;
  const openRectH = storyH - bandH - archR - spandrelH;
  const rMidA = outerA - wallT / 2, rMidB = outerB - wallT / 2;
  const at = (t) => [rMidA * Math.cos(t), rMidB * Math.sin(t)];
  const facing = (t) => [0, Math.atan2(outerB * Math.cos(t), outerA * Math.sin(t)) * 180 / Math.PI, 0];

  for (let s = 0; s < stories; s++) {
    const y0 = plinthH + s * storyH;
    for (let i = 0; i < arches; i++) {
      const tp = 2 * Math.PI * i / arches, tg = tp + Math.PI / arches;
      const [px, pz] = at(tp), [gx, gz] = at(tg);
      parts.push({ shape: "box", size: [pierW, storyH - bandH, wallT], pos: [px, y0 + (storyH - bandH) / 2, pz], rot: facing(tp), color: stone, pat: "ashlar" });
      parts.push({ shape: "spandrel", size: { w: openW + .4, h: archR + spandrelH, r: archR * .98, t: wallT * .9 },
                   pos: [gx, y0 + openRectH, gz], rot: facing(tg), color: stone, pat: "ashlar" });
      // restrained polychromy, as the reconstructions suggest: marble statues
      // in the second-story arches, red-painted plaster in the third
      if (s === 1 && i % 2 === 0) {
        parts.push({ shape: "cyl", size: { r1: .45, r2: .62, h: 3.1, seg: 8 }, pos: [gx, y0 + 1.85, gz], color: 0xd8d0bd });
        parts.push({ shape: "sphere", size: { r: .42 }, pos: [gx, y0 + 3.75, gz], color: 0xd8d0bd });
      }
      if (s === 2 && i % 2 === 1)
        parts.push({ shape: "box", size: [openW * .75, openRectH * .85, .4], pos: [gx, y0 + openRectH * .48, gz], rot: facing(tg), color: 0x8e3f2e, outline: false });
    }
    ring(outerA + .3, bandH, y0 + storyH - bandH / 2, stoneDark, { open: true, side: "double" });   // the cornice between stories
  }

  // attic: solid ring with small dark openings, crowned by a cornice
  const atticY = plinthH + wallH;
  ring(outerA, atticH, atticY + atticH / 2, stone, { open: true, side: "double" });
  ring(outerA + .35, 1.1, atticY + atticH * .78, 0x9a4a34, { open: true, side: "double" });   // painted fresco band
  for (let i = 0; i < arches; i += 2) {
    const t = 2 * Math.PI * (i + .5) / arches;
    const [wx, wz] = [(outerA + .2) * Math.cos(t), (outerB + .2) * Math.sin(t)];
    parts.push({ shape: "box", size: [2, 2.6, .5], pos: [wx, atticY + atticH * .55, wz], rot: facing(t), color: voidDark, outline: false });
  }
  ring(outerA + .6, .9, atticY + atticH + .45, stoneDark, { open: true, side: "double" });

  const floorY = (x, z) => {
    const r = Math.hypot(x, z / ratio);
    if (r > outerA + 1.2)                                                   // ramped entrance approach
      return r < outerA + 6 ? Math.max(0, plinthH * (outerA + 6 - r) / 4.8) : 0;
    if (r > bowlOut) {                                                      // ambulatory + the two straight stairs
      for (const st of stairChords) {
        const qx = x - st.ax, qz = z - st.az;
        const t = qx * st.ux + qz * st.uz;
        if (t > -.5 && t < st.len + .5 && Math.abs(qx * st.uz - qz * st.ux) < 2.35)
          return [plinthH, stairY(plinthH, stRise, Math.max(0, Math.min(1, t / st.len)), st.len)];
      }
      return plinthH;
    }
    if (r > arenaA) {
      const slope = plinthH + .3 + (r - arenaA) / (bowlOut - arenaA) * bowlTop;   // the sloping stands...
      return [plinthH, slope];                                              // ...and the passage beneath them
    }
    return plinthH + .3;                                                    // arena sand
  };

  // the publicum: spectators seated on the cavea rings, facing the arena
  const folkSpots = [];
  for (let i = 1; i <= 8; i++) {
    const rr = arenaA + (bowlOut - arenaA) * i / 8.5;
    const hy = plinthH + .3 + (rr - arenaA) / (bowlOut - arenaA) * bowlTop;
    const nSeats = 14 + i * 2;
    for (let k = 0; k < nSeats; k++) {
      if ((i * 5 + k * 3) % 7 < 3) continue;                 // scattered crowd, not a sold-out house
      const a = 2 * Math.PI * (k + (i % 3) * .33) / nSeats;
      const sx2 = rr * Math.cos(a), sz2 = rr * ratio * Math.sin(a);
      folkSpots.push({ x: sx2, y: hy, z: sz2, h: Math.atan2(sz2, -sx2), pose: "sit" });   // y = the seat (step top)
    }
  }

  return { name, parts, footprint: [2 * outerA + 3, 2 * outerB + 3], floorY, folkSpots,
           arena: { r: arenaA, y: plinthH + .3 } };   // the demo stages beasts and gladiators on the sand
}

// ---- generic Gothic cathedral ---------------------------------------------
// The classic massing, layer by layer: low aisle block + tall clerestory nave
// + steep great roof; transept crossing it; twin west towers with pyramid
// spires and corner pinnacles; polygonal apse closing the east end; a fleche
// over the crossing; buttress rows along the flanks; portal, rose window and
// lancets as dark inset panels. Facade faces +z, apse -z.

export function gothicCathedral({
  name,
  length, bodyW,                     // overall length / nave-plus-aisles width
  naveW, naveH, ridgeH, aisleH,      // clerestory width, eaves height, roof ridge
  aisles = 3, aisleH2 = aisleH * 1.3,   // 5 = double aisles: four pier rows, ceilings stepping up to the nave
  towers = true,                     // false: tower-less west front (Milan), gable facade instead
  towerW = 0, towerH = 0, spireH = 0,   // the west towers (spireH 0 = flat-topped)
  transeptW = 0, transeptD = 20, transeptZ = 0,
  apse = true, fleche = true, flecheH = 40, buttressEvery = 9,
  pinnacleEvery = 0,                 // >0: a forest of small spires along the aisle cornices
  stone = 0x8a867c, stoneDark = 0x6e6a61, roofC = 0x565b59,
  glassC = 0x33415c,                 // stained glass, as a colored panel rather than a hole
  doorC = 0x4c3a28,                  // wooden doors
}) {
  const parts = [];
  const L2 = length / 2;
  const roofH = ridgeH - naveH;

  // hollow nave body -- same massing outside, a walkable church inside:
  // outer aisle walls (split open at the transept crossing), clerestory
  // walls carried on arcade pier rows, flat ceiling slabs under the
  // exterior roofs, a sealed east wall behind the apse
  const bodyL = towers ? length - towerW : length;
  const zc = towers ? -towerW / 2 : 0;
  const T = 1.2;                                       // wall thickness
  const zA = zc - bodyL / 2, zB = zc + bodyL / 2;
  const gapA = transeptZ - transeptD / 2, gapB = transeptZ + transeptD / 2;
  const innerA = aisles >= 5 ? aisleH2 : aisleH;      // ceiling of the aisle beside the nave
  const x2 = (naveW / 2 + bodyW / 2) / 2;             // the outer arcade when double-aisled
  const winZs = [];                                   // one window bay between each pair of buttresses
  for (let z = zA + 3 + buttressEvery / 2; z < zB - 3; z += buttressEvery)
    if (!(transeptW && z > gapA - 1.5 && z < gapB + 1.5)) winZs.push(z);
  const aWinH = aisleH * .45, aWinY = aisleH * .55 - aWinH / 2;
  const sideWall = (x, z0, z1) => {                   // aisle wall with its windows truly cut out
    if (z1 - z0 < .1) return;
    const mid = (z0 + z1) / 2;
    const holes = winZs.filter((z) => z > z0 + 1.6 && z < z1 - 1.6).map((z) => [z - mid, aWinY, 2.2, aWinH]);
    parts.push({ shape: "hwall", size: { w: z1 - z0, h: aisleH, t: T, holes }, pos: [x, 0, mid], rot: [0, -90, 0], color: stone, pat: "gothic" });
    // ornamental dado band lining the wall's INNER face
    parts.push({ shape: "box", size: [.1, 3.4, z1 - z0 - .5], pos: [x - Math.sign(x) * (T / 2 + .06), 1.7, mid],
                 color: 0x9d937e, pat: "ornament", accent: 0x77644a, outline: false });
  };
  for (const sx of [-1, 1]) {
    const wx = sx * (bodyW - T) / 2;
    if (transeptW) { sideWall(wx, zA, gapA); sideWall(wx, gapB, zB); }
    else sideWall(wx, zA, zB);
    parts.push({ shape: "hwall", size: { w: bodyL, h: naveH - innerA, t: T,
                 holes: winZs.map((z) => [z - zc, (naveH - innerA) * .3, 2.2, (naveH - innerA) * .5]) },
                 pos: [sx * (naveW - T) / 2, innerA, zc], rot: [0, -90, 0], color: stone, pat: "gothic" });
    for (let z = zA + 3; z < zB - 2; z += buttressEvery) {
      parts.push({ shape: "box", size: [1.8, innerA, 1.8], pos: [sx * (naveW - T) / 2, innerA / 2, z], color: stone, pat: "ornament", accent: 0x8d7a4f });
      if (aisles >= 5) parts.push({ shape: "box", size: [1.5, aisleH, 1.5], pos: [sx * x2, aisleH / 2, z], color: stone, pat: "ornament", accent: 0x8d7a4f });
    }
    if (aisles >= 5) {
      // stepped double aisles: outer aisle low, inner aisle taller on its own arcade
      parts.push({ shape: "box", size: [T, aisleH2 - aisleH, bodyL], pos: [sx * x2, (aisleH + aisleH2) / 2, zc], color: stone });
      parts.push({ shape: "box", size: [bodyW / 2 - x2, .5, bodyL], pos: [sx * (x2 + bodyW / 2) / 2, aisleH - .25, zc], color: stoneDark });
      parts.push({ shape: "box", size: [x2 - naveW / 2, .5, bodyL], pos: [sx * (naveW / 2 + x2) / 2, aisleH2 - .25, zc], color: stoneDark });
    } else {
      parts.push({ shape: "box", size: [(bodyW - naveW) / 2, .5, bodyL], pos: [sx * (bodyW + naveW) / 4, aisleH - .25, zc], color: stoneDark });
    }
  }
  parts.push({ shape: "box", size: [naveW, .5, bodyL], pos: [0, naveH - .25, zc], color: stoneDark });
  // cornice of the inner-aisle step: edge STRIPS, not a slab -- a slab at
  // chest height walls off the entire walkable terrace beneath it
  if (aisles >= 5) for (const sxc of [-1, 1])
    parts.push({ shape: "box", size: [1.0, .8, bodyL], pos: [sxc * x2, aisleH2 + .4, zc], color: stoneDark });
  parts.push({ shape: "box", size: [bodyW, aisleH, T], pos: [0, aisleH / 2, zA + T / 2], color: stone });
  if (aisles >= 5) parts.push({ shape: "box", size: [2 * x2, aisleH2 - aisleH, T], pos: [0, (aisleH + aisleH2) / 2, zA + T / 2], color: stone });
  parts.push({ shape: "box", size: [naveW, naveH - innerA, T], pos: [0, (naveH + innerA) / 2, zA + T / 2], color: stone });
  // the outer eaves cornice, likewise as edge strips clear of the terrace
  for (const sxc of [-1, 1])
    parts.push({ shape: "box", size: [1.0, .8, bodyL], pos: [sxc * (bodyW / 2 - .1), aisleH + .4, zc], color: stoneDark });
  parts.push({ shape: "gable", size: [naveW + 1.5, roofH, bodyL], pos: [0, naveH, zc], color: roofC, pat: "tiles" });

  // translucent stained-glass panes standing in the real openings
  for (const z of winZs) for (const sx of [-1, 1]) {
    parts.push({ shape: "box", size: [.12, aWinH + .15, 2.35], pos: [sx * (bodyW - T) / 2, aisleH * .55, z], color: glassC, glass: "stained" });
    parts.push({ shape: "box", size: [.12, (naveH - innerA) * .5 + .15, 2.35], pos: [sx * (naveW - T) / 2, innerA + (naveH - innerA) * .55, z], color: glassC, glass: "stained" });
  }

  // hollow transept arms, fully open toward the crossing
  if (transeptW) {
    for (const sx of [-1, 1]) {
      const a0 = bodyW / 2 - T, a1 = transeptW / 2;
      const mid = sx * (a0 + a1) / 2, aw = a1 - a0;
      parts.push({ shape: "box", size: [aw, naveH, T], pos: [mid, naveH / 2, gapA + T / 2], color: stone });
      parts.push({ shape: "box", size: [aw, naveH, T], pos: [mid, naveH / 2, gapB - T / 2], color: stone });
      parts.push({ shape: "hwall", size: { w: transeptD, h: naveH, t: T,
                   holes: [[0, naveH * .55 - naveH * .21, transeptD * .35, naveH * .42]] },
                   pos: [sx * (a1 - T / 2), 0, transeptZ], rot: [0, -90, 0], color: stone, pat: "gothic" });
      parts.push({ shape: "box", size: [aw, .5, transeptD], pos: [mid, naveH - .25, transeptZ], color: stoneDark });
      parts.push({ shape: "box", size: [.12, naveH * .44, transeptD * .37], pos: [sx * (a1 - T / 2), naveH * .55, transeptZ], color: glassC, glass: "stained" });   // great transept window
    }
    parts.push({ shape: "gable", size: [transeptD + 1.5, roofH, transeptW + 1], pos: [0, naveH, transeptZ], rot: [0, 90, 0], color: roofC, pat: "tiles" });
  }

  // west front: either twin towers with a central bay, or a tower-less
  // gable facade (the nave roof's own pediment triangle) with three portals
  const towerX = naveW / 2 + towerW / 2 - 2;
  const towerZ = L2 - towerW / 2;
  const lifts = [];   // shortcut spots: bottom/top of each tower stair
  // a real tight spiral: wide treads wind around a fat newel, 14 per turn,
  // 3.5m rise per turn; each box tread overlaps the next angularly so there
  // are NO gaps anywhere on the climb, and an enclosure wall rings the
  // outer edge so nobody falls off
  const spiralR = 2.15, spiralDA = Math.PI * 2 / 14, spiralOut = 3.8;
  if (towers) {
    const TT = 1.1;
    for (const sx of [-1, 1]) {
      // hollow tower shell: the front and outer walls carry REAL window
      // openings (hwall holes) with stained panes set into them, matching
      // how every other building treats its windows
      const bWin = [0, towerH * .51, towerW * .35, towerH * .22];   // belfry
      const lWin = [0, towerH * .27, towerW * .3, towerH * .14];    // lower window
      parts.push({ shape: "hwall", size: { w: towerW, h: towerH, t: TT, holes: [bWin, lWin] },
                   pos: [sx * towerX, 0, L2 - TT / 2], color: stone, pat: "gothic" });
      parts.push({ shape: "hwall", size: { w: towerW, h: towerH, t: TT, holes: [[0, towerH * .51, towerW * .32, towerH * .2]] },
                   pos: [sx * (towerX + towerW / 2 - TT / 2), 0, towerZ], rot: [0, -90, 0], color: stone, pat: "gothic" });
      // back wall carries a REAL door into the tower: the spiral stair
      // inside climbs all the way to the roof deck
      parts.push({ shape: "hwall", size: { w: towerW, h: towerH, t: TT, holes: [[0, 0, 1.8, 2.8]] },
                   pos: [sx * towerX, 0, towerZ - towerW / 2 + TT / 2], color: stone, pat: "gothic" });
      parts.push({ shape: "box", size: [TT, towerH, towerW], pos: [sx * (towerX - towerW / 2 + TT / 2), towerH / 2, towerZ], color: stone, pat: "gothic" });
      // roof deck: a full slab whose shaft opening sits just inside the
      // stair's outer edge -- stepping off the top tread lands ON the deck
      // with no moat, and the square hole stays inside the round enclosure
      const hole = 7.0, strip = (towerW - hole) / 2;
      for (const [sw, sd, ox, oz] of [
        [towerW, strip, 0, hole / 2 + strip / 2], [towerW, strip, 0, -(hole / 2 + strip / 2)],
        [strip, hole, hole / 2 + strip / 2, 0], [strip, hole, -(hole / 2 + strip / 2), 0]])
        parts.push({ shape: "box", size: [sw, .4, sd], pos: [sx * towerX + ox, towerH - .2, towerZ + oz], color: stone });
      // triangular plates over the square opening's corners (which poke past
      // the round tread circle): same cover, less footprint, fewer polygons
      for (const [ox, oz, ry] of [[3.5, 3.5, 180], [-3.5, 3.5, 90], [-3.5, -3.5, 0], [3.5, -3.5, 270]])
        parts.push({ shape: "wedge", size: [2.15, .4, 2.15], rot: [0, ry, 0], outline: false,
                     pos: [sx * towerX + ox, towerH - .2, towerZ + oz], color: stone });
      // the spiral: wedge-overlapping treads around a stone newel. Phased so
      // the stair's entry slot faces the nave door (-z): you walk straight
      // from the door, down a short corridor, onto tread 0.
      const a0 = 4.71239 - spiralDA / 2;
      parts.push({ shape: "cyl", size: { r1: 1.0, r2: 1.0, h: towerH, seg: 10 }, pos: [sx * towerX, towerH / 2, towerZ], color: stone });
      const nSteps = Math.round(towerH / .25);
      for (let i = 0; i < nSteps; i++) {
        const a = a0 + i * spiralDA;
        parts.push({ shape: "box", size: [2.6, .29, 1.7], rot: [0, -a * 57.29578, 0], outline: false,
                     pos: [sx * towerX + Math.cos(a) * spiralR, i * .25 + .145, towerZ + Math.sin(a) * spiralR], color: stoneDark });
      }
      // enclosure wall around the stair's outer edge -- 14 chord segments
      // to the deck's underside; the segment over the entry starts 3m up
      for (let i = 0; i < 14; i++) {
        const a = a0 + (i + .5) * spiralDA;
        const entry = i === 0;
        const wh = (towerH - .4) - (entry ? 3 : 0);
        parts.push({ shape: "box", size: [1.9, wh, .3], rot: [0, -(a * 57.29578 + 90), 0], outline: false,
                     pos: [sx * towerX + Math.cos(a) * spiralOut, (entry ? 3 : 0) + wh / 2, towerZ + Math.sin(a) * spiralOut],
                     color: stone, pat: "ashlar" });
      }
      // the tower's own floor slab -- the portal slab only spans between
      // the towers, so without this the outer half showed bare ground
      parts.push({ shape: "box", size: [towerW, .25, towerW], pos: [sx * towerX, .125, towerZ], color: 0xd3cab6, pat: "checker", accent: 0x4c463e });
      // corridor from the nave door straight to the stair entry; its walls
      // seal off the dead ring space between the stair and the tower shell
      const corrL = towerW / 2 - TT - spiralOut + .4;
      for (const cx2 of [-1.15, 1.15])
        parts.push({ shape: "box", size: [.3, 3, corrL], pos: [sx * towerX + cx2, 1.5, towerZ - towerW / 2 + TT + corrL / 2], color: stone, pat: "ashlar" });
      lifts.push({ bx: sx * towerX, bz: towerZ - towerW / 2 + 2.6, by: .25,
                   tx: sx * towerX, tz: towerZ - (hole / 2 + strip / 2), ty: towerH });
      // open-air railing around the deck: 1m -- high enough to stop a fall,
      // low enough to see the whole world over it
      for (const [sw, sd, ox, oz] of [
        [towerW, .3, 0, towerW / 2 - .15], [towerW, .3, 0, -(towerW / 2 - .15)],
        [.3, towerW - .6, towerW / 2 - .15, 0], [.3, towerW - .6, -(towerW / 2 - .15), 0]])
        parts.push({ shape: "box", size: [sw, 1.0, sd], pos: [sx * towerX + ox, towerH + .5, towerZ + oz], color: stone });
      for (const [u, y, hw, hh] of [bWin, lWin])
        parts.push({ shape: "box", size: [hw, hh, .15], pos: [sx * towerX + u, y + hh / 2, L2 - TT - .12], color: glassC, glass: "stained" });
      parts.push({ shape: "box", size: [.15, towerH * .2, towerW * .32],
                   pos: [sx * (towerX + towerW / 2 - TT - .12), towerH * .61, towerZ], color: glassC, glass: "stained" });
      // outline: false -- the deck sits INSIDE the spire's base, and the
      // inverted-hull outline would wrap the viewer in darkness up there
      if (spireH) parts.push({ shape: "cyl", size: { r1: 0, r2: towerW * .52, h: spireH, seg: 4, open: true }, pos: [sx * towerX, towerH + spireH / 2, towerZ], rot: [0, 45, 0], color: stoneDark, outline: false });
      for (const [cx, cz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]])
        parts.push({ shape: "cyl", size: { r1: 0, r2: 1.5, h: 8, seg: 4, open: true }, pos: [sx * towerX + cx * (towerW / 2 - 1), towerH + 4, towerZ + cz * (towerW / 2 - 1)], rot: [0, 45, 0], color: stone });
    }
    // central bay with a REAL portal: a doorway tunnel between the towers
    const bayW = 2 * (towerX - towerW / 2);
    const doorW = Math.min(6, bayW * .55), doorH = 11, jambW = (bayW - doorW) / 2;
    for (const sx of [-1, 1])
      parts.push({ shape: "box", size: [jambW, naveH, towerW], pos: [sx * (doorW + jambW) / 2, naveH / 2, L2 - towerW / 2], color: stone });
    parts.push({ shape: "box", size: [doorW, naveH - doorH, towerW], pos: [0, doorH + (naveH - doorH) / 2, L2 - towerW / 2], color: stone });
    parts.push({ shape: "box", size: [Math.min(4.8, bayW * .45), 7.5, .6], pos: [0, doorH + 5, L2 + .3], color: glassC });                                // great window over the portal
    parts.push({ shape: "cyl", size: { r1: bayW * .38, r2: bayW * .38, h: .6, seg: 12 }, pos: [0, naveH * .68, L2 + .3], rot: [90, 0, 0], color: glassC });   // rose window
  } else {
    // full-width west wall with a real central doorway; side portals painted
    const doorW = Math.min(5, naveW * .4), doorH = 10, jambW = (bodyW - doorW) / 2;
    for (const sx of [-1, 1])
      parts.push({ shape: "box", size: [jambW, aisleH, T], pos: [sx * (doorW + jambW) / 2, aisleH / 2, L2 - T / 2], color: stone });
    parts.push({ shape: "box", size: [doorW, aisleH - doorH, T], pos: [0, doorH + (aisleH - doorH) / 2, L2 - T / 2], color: stone });
    parts.push({ shape: "box", size: [naveW, naveH - aisleH, T], pos: [0, (naveH + aisleH) / 2, L2 - T / 2], color: stone });
    for (const sx of [-1, 1])
      parts.push({ shape: "box", size: [5, 9, .8], pos: [sx * bodyW * .28, 4.5, L2 + .4], color: doorC });                                                 // side portal doors
    parts.push({ shape: "box", size: [naveW * .35, aisleH * .3, .6], pos: [0, aisleH * .66, L2 + .3], color: glassC });                                    // great west window
    for (const sx of [-1, 1]) {
      parts.push({ shape: "box", size: [4, aisleH * .27, .6], pos: [sx * bodyW * .28, aisleH * .56, L2 + .3], color: glassC });                            // over the side portals
      parts.push({ shape: "box", size: [3, aisleH * .22, .6], pos: [sx * bodyW * .14, aisleH * .5, L2 + .3], color: glassC });                             // inner aisle windows
    }
    parts.push({ shape: "cyl", size: { r1: naveW * .28, r2: naveW * .28, h: .6, seg: 12 }, pos: [0, naveH * .72, L2 + .3], rot: [90, 0, 0], color: glassC });   // rose window
    // six facade buttress piers, each crowned by a spire, stepping taller
    // toward the central gable -- the corners are just the outermost pair
    const cornerX = bodyW / 2 - 2.2;
    const xs = linspace(-cornerX, cornerX, 6);
    for (let i = 0; i < 6; i++) {
      const rank = Math.floor(Math.abs(i - 2.5));    // 0 innermost pair .. 2 corners
      const th = aisleH + 26 - rank * 5;
      const w = rank === 2 ? 4 : 2.6;
      parts.push({ shape: "box", size: [w, th, w], pos: [xs[i], th / 2, L2 - 1.2], color: stone });
      parts.push({ shape: "cyl", size: { r1: 0, r2: rank === 2 ? 2.4 : 1.6, h: rank === 2 ? 16 : 12, seg: 4 },
                   pos: [xs[i], th + (rank === 2 ? 8 : 6), L2 - 1.2], rot: [0, 45, 0], color: stone });
    }
  }

  // pinnacle forest along the aisle cornices (plus the facade corners)
  if (pinnacleEvery)
    for (let z = -L2 + 3; z <= L2 - 2; z += pinnacleEvery)
      for (const sx of [-1, 1])
        parts.push({ shape: "cyl", size: { r1: 0, r2: 1.3, h: 10, seg: 4 }, pos: [sx * (bodyW / 2 - .8), aisleH + 5, z], rot: [0, 45, 0], color: stone });

  // apse: polygonal east end + half-cone roof
  if (apse) {
    parts.push({ shape: "cyl", size: { r1: naveW / 2 + 1, r2: naveW / 2 + 1, h: naveH, seg: 8 }, pos: [0, naveH / 2, -L2], color: stone });
    parts.push({ shape: "cyl", size: { r1: 0, r2: naveW / 2 + 2, h: roofH, seg: 8 }, pos: [0, naveH, -L2], color: roofC, pat: "tiles" });
  }

  // fleche over the crossing
  if (fleche) {
    parts.push({ shape: "box", size: [5, 7, 5], pos: [0, ridgeH + 1, transeptZ], color: stoneDark });
    parts.push({ shape: "cyl", size: { r1: 0, r2: 3.4, h: flecheH, seg: 4 }, pos: [0, ridgeH + 4.5 + flecheH / 2, transeptZ], rot: [0, 45, 0], color: roofC });
  }

  // buttress rows along the nave flanks
  for (let z = -L2 + 6; z < L2 - towerW - 3; z += buttressEvery)
    for (const sx of [-1, 1])
      parts.push({ shape: "box", size: [1.4, aisleH + 6, 2.8], pos: [sx * (bodyW / 2 + .7), (aisleH + 6) / 2, z], color: stoneDark });

  // pews: two banks flanking the central aisle in the nave west of the
  // crossing, every row facing the altar; length follows the nave width
  const pewLen = (naveW - 3.4) / 2;
  const pz0 = (transeptW ? gapB : zA + 10) + 4;
  const pz1 = Math.min(pz0 + 38, zB - 8);
  for (let z = pz0; z < pz1; z += 2.3)
    for (const sx of [-1, 1])
      for (const p of furniture("pew", { len: pewLen }))
        parts.push({ ...p, pos: [sx * (pewLen / 2 + 1.1) + p.pos[0], .25 + p.pos[1], z + p.pos[2]] });

  // the high altar at the chancel entrance, just east of the crossing --
  // not deep in the apse, where long choirs would swallow it
  const altarZ = transeptW ? gapA - 6 : zA + 12;
  for (const p of furniture("altar"))
    parts.push({ ...p, pos: [p.pos[0], .25 + p.pos[1], altarZ + p.pos[2]] });

  // where people belong: scattered worshippers on the pews (facing the
  // altar) and a few clergy standing behind it, exported for the demo to
  // populate with static figures
  const folkSpots = [];
  let si = 0;
  for (let zz = pz0; zz < pz1; zz += 2.3)
    for (const sx of [-1, 1]) {
      si++;
      if (si % 3 === 0) continue;                        // some rows stay empty
      for (let k = 0, kn = 1 + (si % 2); k < kn; k++) {
        const u = (((si * 7 + k * 13) % 10) / 10 - .5) * (pewLen - .9);
        folkSpots.push({ x: sx * (pewLen / 2 + 1.1) + u, y: .505, z: zz - .02, h: Math.PI / 2, pose: "sit" });   // y = the pew seat top
      }
    }
  for (const dx of [-1.6, .2, 1.7]) folkSpots.push({ x: dx, y: .25, z: altarZ - 2.4, h: -Math.PI / 2, pose: "stand" });

  // stone floor throughout (nave, transept, and the portal passage)
  // one continuous checkerboard: nave, the transept wings, and the portal
  // passage all share the same floor treatment
  parts.push({ shape: "box", size: [bodyW, .25, bodyL], pos: [0, .125, zc], color: 0xd3cab6, pat: "checker", accent: 0x4c463e });
  if (transeptW) parts.push({ shape: "box", size: [transeptW, .25, transeptD], pos: [0, .125, transeptZ], color: 0xd3cab6, pat: "checker", accent: 0x4c463e });
  if (towers) parts.push({ shape: "box", size: [2 * towerX, .25, towerW], pos: [0, .125, L2 - towerW / 2], color: 0xd3cab6, pat: "checker", accent: 0x4c463e });

  // walkable aisle-roof terraces (Milan's famous ones -- every cathedral
  // gets the floor levels), ringed by a parapet along the outer eaves
  const turret = !towers ? { x: bodyW / 2 + 3.3, z: zB - 4.5 } : null;
  for (const sx of [-1, 1]) {
    const segs = (turret && sx > 0) ? [[zA, turret.z - 2.3], [turret.z + 2.3, zB]] : [[zA, zB]];
    for (const [z0, z1] of segs)
      if (z1 - z0 > .5)
        parts.push({ shape: "box", size: [.3, 1.0, z1 - z0], pos: [sx * (bodyW / 2 - .15), aisleH + .5, (z0 + z1) / 2], color: stone });
  }
  if (turret) {
    // Milan's roof-access stair turret: the same enclosed spiral, standing
    // against the south-west flank, opening onto the outer terrace
    const topH = aisleH;
    parts.push({ shape: "cyl", size: { r1: 1.0, r2: 1.0, h: topH + 1.6, seg: 10 }, pos: [turret.x, (topH + 1.6) / 2, turret.z], color: stone });
    for (let i = 0, nS = Math.round(topH / .25); i < nS; i++) {
      const a = i * spiralDA;
      parts.push({ shape: "box", size: [2.6, .29, 1.7], rot: [0, -a * 57.29578, 0], outline: false,
                   pos: [turret.x + Math.cos(a) * spiralR, i * .25 + .145, turret.z + Math.sin(a) * spiralR], color: stoneDark });
    }
    for (let i = 0; i < 14; i++) {
      const a = (i + .5) * spiralDA;
      const entry = i === 0;                     // ground-level way in, from the churchyard
      const exitSide = Math.cos(a) < -.5;        // faces the church: open above the roof line
      const wh = (exitSide ? topH : topH + 1.6) - (entry ? 3 : 0);
      parts.push({ shape: "box", size: [1.9, wh, .3], rot: [0, -(a * 57.29578 + 90), 0], outline: false,
                   pos: [turret.x + Math.cos(a) * spiralOut, (entry ? 3 : 0) + wh / 2, turret.z + Math.sin(a) * spiralOut],
                   color: stone, pat: "ashlar" });
    }
    lifts.push({ bx: turret.x + 2.6, bz: turret.z, by: 0, tx: bodyW / 2 - 2.2, tz: turret.z, ty: aisleH });
  }

  const floorY = (x, z) => {
    if (turret) {
      const rx = x - turret.x, rz = z - turret.z;
      if (Math.hypot(rx, rz) < 3.6 && x > bodyW / 2 + .1) {   // inside the turret shaft
        const lv = [0];
        if (Math.hypot(rx, rz) < 1.05) lv.push(aisleH + 1.6);   // the turret newel's top
        if (Math.hypot(rx, rz) > .85) {
          let th = Math.atan2(rz, rx);
          if (th < 0) th += Math.PI * 2;
          for (let k = 0; ; k++) {
            const h = (th / (Math.PI * 2) + k) * 3.5;
            if (h > aisleH + .1) break;
            lv.push(Math.floor(h / .25) * .25 + .29);
          }
        }
        return lv;
      }
    }
    if (towers) for (const sx of [-1, 1]) {   // inside a tower: the spiral stair + the roof deck
      const rx = x - sx * towerX, rz = z - towerZ;
      // the zone spans the WHOLE tower plan, wall tops included -- the deck
      // level must exist over the wall band too, or its top face is a pit
      if (Math.abs(rx) >= towerW / 2 + .2 || Math.abs(rz) >= towerW / 2 + .2) continue;
      const lv = [.25];
      const rr = Math.hypot(rx, rz);
      if (rr > .85 && rr < 3.5) {   // on the spiral treads around the newel
        let th = Math.atan2(rz, rx) - (4.71239 - spiralDA / 2);   // same phase as the treads
        th = ((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        const risePerTurn = Math.PI * 2 / spiralDA * .25;   // 3.5m
        for (let k = 0; ; k++) {
          const h = (th / (Math.PI * 2) + k) * risePerTurn;
          if (h > towerH + .1) break;
          lv.push(Math.floor(h / .25) * .25 + .29);
        }
      }
      if (Math.max(Math.abs(rx), Math.abs(rz)) > 3.45 ||
          Math.abs(rx) + Math.abs(rz) > 4.85) lv.push(towerH);   // deck + the triangular corner plates
      if (rr < 1.05) lv.push(towerH);   // the newel's flat top -- not a chute
      return lv;
    }
    if (Math.abs(x) <= 2.3 && Math.abs(z - altarZ) <= 1.7) return .61;   // the altar's predella
    if (Math.abs(x) <= bodyW / 2 && z >= zA && z <= L2) {
      const ax2 = Math.abs(x), lv = [.25];
      if (z <= zB && ax2 >= naveW / 2 + .5)   // the aisle-roof terraces overhead
        lv.push(aisles >= 5 && ax2 < x2 ? aisleH2 : aisleH);
      return lv;
    }
    if (transeptW && Math.abs(x) <= transeptW / 2 && z >= gapA && z <= gapB) return .25;
    return 0;
  };

  const facadeW = towers ? 2 * towerX + towerW : bodyW;
  return { name, parts, footprint: [Math.max(bodyW, transeptW, facadeW), length], floorY, folkSpots, lifts };
}

// ---- generic Egyptian temple (Ptolemaic style) ----------------------------
// Flat-roofed sandstone mass: a pronaos facade of columns linked by
// half-height screen walls under a fat cavetto cornice, a hypostyle forest
// of columns behind it, then the lower, darker inner temple with its naos.
// Fully walkable: in through the open central bay, between the columns,
// through the inner door, around the sanctuary.

export function egyptianTemple({
  name,
  width, length,
  hallH,                             // hypostyle hall / facade height
  innerH = hallH * .7,               // the rear temple block sits lower
  hallDepth = length * .32,
  columnH = hallH * .85, columnD = 2.2,
  colsFront = 6, hypoRows = 4,
  screenH = hallH * .4,
  sand = 0xc9b283, sandDark = 0xb09a6d, sandShadow = 0x8f7c55,
}) {
  const parts = [];
  const T = 1.2, L2 = length / 2, baseY = .5;
  parts.push({ shape: "box", size: [width + 2, .5, length + 2], pos: [0, .25, 0], color: sandDark });

  // column: gently tapered shaft + Hathor block capital + abacus
  const col = (x, z) => {
    const r = columnD / 2, h = columnH;
    parts.push({ shape: "cyl", size: { r1: r * .88, r2: r, h: h - 2.4 }, pos: [x, baseY + (h - 2.4) / 2, z], color: sand });
    parts.push({ shape: "box", size: [columnD * 1.15, 1.6, columnD * 1.15], pos: [x, baseY + h - 1.6, z], color: sandDark });
    parts.push({ shape: "box", size: [columnD * .9, .8, columnD * .9], pos: [x, baseY + h - .4, z], color: sand });
  };

  // pronaos: front columns joined by screen walls, the central bay open
  const xs = linspace(-(width / 2 - columnD), width / 2 - columnD, colsFront);
  const zF = L2 - columnD;
  for (const x of xs) col(x, zF);
  for (let i = 0; i < xs.length - 1; i++) {
    if (i === colsFront / 2 - 1) continue;
    parts.push({ shape: "box", size: [xs[i + 1] - xs[i] - columnD * .8, screenH, 1], pos: [(xs[i] + xs[i + 1]) / 2, baseY + screenH / 2, zF], color: sand });
  }
  // hypostyle rows behind the facade (the central file stays clear)
  const rowGap = (hallDepth - 5) / hypoRows;
  for (let rz = 1; rz < hypoRows; rz++) for (const x of xs) col(x, zF - rz * rowGap);

  // hall enclosure: side walls, roof slab, cavetto cornice over the facade
  for (const sx of [-1, 1])
    parts.push({ shape: "box", size: [T, hallH, hallDepth], pos: [sx * (width - T) / 2, baseY + hallH / 2, L2 - hallDepth / 2], color: sand, pat: "ashlar" });
  parts.push({ shape: "box", size: [width, .8, hallDepth], pos: [0, baseY + hallH + .4, L2 - hallDepth / 2], color: sandDark });
  parts.push({ shape: "box", size: [width + 1.6, 1.7, 2], pos: [0, baseY + hallH + .85, L2 - 1], color: sand });

  // inner temple: lower block, entered by an axial door; the naos at the rear
  const innerDepth = length - hallDepth, ziC = -L2 + innerDepth / 2, zin = L2 - hallDepth + T / 2;
  for (const sx of [-1, 1])
    parts.push({ shape: "box", size: [T, innerH, innerDepth], pos: [sx * (width - T) / 2, baseY + innerH / 2, ziC], color: sand, pat: "ashlar" });
  parts.push({ shape: "box", size: [width, innerH, T], pos: [0, baseY + innerH / 2, -L2 + T / 2], color: sand });
  const doorW = 3.4, doorH = Math.min(6, innerH - 2), jw = (width - doorW) / 2;
  for (const sx of [-1, 1])
    parts.push({ shape: "box", size: [jw, innerH, T], pos: [sx * (doorW + jw) / 2, baseY + innerH / 2, zin], color: sand });
  parts.push({ shape: "box", size: [doorW, innerH - doorH, T], pos: [0, baseY + doorH + (innerH - doorH) / 2, zin], color: sand });
  parts.push({ shape: "box", size: [width, .8, innerDepth], pos: [0, baseY + innerH + .4, ziC], color: sandDark });
  parts.push({ shape: "box", size: [6, 6, 8], pos: [0, baseY + 3, -L2 + 7], color: sandShadow });         // the naos
  parts.push({ shape: "box", size: [2.2, 3.6, .5], pos: [0, baseY + 1.8, -L2 + 11.2], color: 0x2e2a22, outline: false });   // its dark doorway

  const floorY = (x, z) => Math.abs(x) <= width / 2 + 1 && Math.abs(z) <= L2 + 1 ? .5 : 0;
  return { name, parts, footprint: [width + 2, length + 2], floorY };
}

// ---- generic medieval house -----------------------------------------------
// Half-timbered town house: stone ground floor (a hollow room with a real
// door), jettied plaster upper storeys laced with timber, steep gable roof,
// chimney. Sized by parameters so a street can mix widths and heights.

export function medievalHouse({
  name = "House",
  width = 6.5, depth = 8.5, storeys = 2, floorH = 2.9,
  roofH,
  stone = 0x9a917f, plaster = 0xd9cfba, timber = 0x5b4326, roofC = 0x8a5a35, glassC = 0x40474d,
}) {
  const parts = [];
  const T = .4, D2 = depth / 2;
  const doorW = 1.4, doorH = 2.2, jw = (width - doorW) / 2;
  parts.push({ shape: "box", size: [width, .15, depth], pos: [0, .075, 0], color: stone });   // floor slab
  for (const sx of [-1, 1])                                                                   // ground room side walls
    parts.push({ shape: "box", size: [T, floorH, depth], pos: [sx * (width - T) / 2, floorH / 2, 0], color: stone, pat: "ashlar" });
  parts.push({ shape: "hwall", size: { w: width, h: floorH, t: T, holes: [[0, 0, doorW, doorH], [-width * .28, 1.1, 1.1, 1]] },
               pos: [0, 0, D2 - T / 2], color: stone, pat: "ashlar" });                        // front: real door + window openings
  parts.push({ shape: "box", size: [width, floorH, T], pos: [0, floorH / 2, -D2 + T / 2], color: stone });
  // the ground-floor front window is a DYNAMIC pane (openable, exported
  // below), so no static glass part here

  // jettied upper storeys: HOLLOW rooms (walls + floor slab with a hole over
  // the ramp), timber framing and windows outside
  const stairW = 1.7, zRun0 = D2 - .8, zRun1 = -D2 + .8, run = zRun0 - zRun1;
  const winsOut = [{ x: -width * .28, y: 1.6, z: D2 - T / 2, w: 1.25, h: 1.15 }];   // every front window opens
  let w = width;
  for (let s = 1; s < storeys; s++) {
    w = width + s;
    const y0 = s * floorH, d = depth + .6;
    const holeSide = (s - 1) % 2 ? -1 : 1;   // where the flight below arrives
    const hsx = holeSide * (width / 2 - stairW / 2 - .2);
    const x0 = hsx - stairW / 2 - .2, x1 = hsx + stairW / 2 + .2;      // stairwell strip, centered on the ramp
    const hzA = holeSide > 0 ? zRun1 : zRun0 - run * .78;              // headroom: a 2m walker on the flight below
    const hzB = holeSide > 0 ? zRun1 + run * .78 : zRun0;              // must clear this slab the whole climb
    parts.push({ shape: "box", size: [x0 + w / 2, .18, d], pos: [(x0 - w / 2) / 2, y0 + .09, 0], color: timber });
    parts.push({ shape: "box", size: [w / 2 - x1, .18, d], pos: [(x1 + w / 2) / 2, y0 + .09, 0], color: timber });
    parts.push({ shape: "box", size: [x1 - x0, .18, hzA + d / 2], pos: [(x0 + x1) / 2, y0 + .09, (hzA - d / 2) / 2], color: timber });
    parts.push({ shape: "box", size: [x1 - x0, .18, d / 2 - hzB], pos: [(x0 + x1) / 2, y0 + .09, (hzB + d / 2) / 2], color: timber });
    wellRail(parts, { x0, x1, z0: hzA, z1: hzB, y: y0 + .18, side: -holeSide, landAt: holeSide > 0 ? "z0" : "z1" });
    for (const sx of [-1, 1]) parts.push({ shape: "box", size: [T, floorH, d], pos: [sx * (w - T) / 2, y0 + floorH / 2, 0], color: plaster });
    parts.push({ shape: "hwall", size: { w, h: floorH, t: T, holes: [[-w * .22, floorH * .55 - .55, .9, 1.1], [w * .22, floorH * .55 - .55, .9, 1.1]] },
                 pos: [0, y0, (d - T) / 2], color: plaster });                                 // front wall with window openings
    parts.push({ shape: "box", size: [w, floorH, T], pos: [0, y0 + floorH / 2, -(d - T) / 2], color: plaster });
    for (const sz of [-1, 1]) parts.push({ shape: "box", size: [w + .15, .25, .3], pos: [0, y0 + .1, sz * (d - .1) / 2], color: timber });   // jetty beams:
    for (const sx of [-1, 1]) parts.push({ shape: "box", size: [.3, .25, d + .15], pos: [sx * (w - .1) / 2, y0 + .1, 0], color: timber });   // a frame, not a slab
    for (const sz of [-1, 1]) for (let k = 0; k < 4; k++)                                                   // studs, front & back
      parts.push({ shape: "box", size: [.2, floorH, .12], pos: [(k / 3 - .5) * w * .9, y0 + floorH / 2, sz * (d / 2 + .04)], color: timber });
    for (const sx of [-1, 1])   // upper-storey front windows: dynamic, openable panes
      winsOut.push({ x: sx * w * .22, y: y0 + floorH * .55, z: (d - T) / 2, w: 1.05, h: 1.25 });
  }
  parts.push({ shape: "box", size: [w, .18, depth + .6], pos: [0, storeys * floorH + .09, 0], color: timber });   // attic floor under the roof
  // a real staircase per storey, hugging alternating side walls
  for (let s = 0; s < storeys - 1; s++) {
    const side = s % 2 ? -1 : 1;
    const sxp = side * (width / 2 - stairW / 2 - .2);
    stairSteps(parts, { x: sxp, w: stairW, y0: s * floorH + .15, rise: floorH, rail: -side,
                        z0: side > 0 ? zRun0 : zRun1, z1: side > 0 ? zRun1 : zRun0, color: 0x74582f });
  }
  // furnishings: table, chairs and a bench below; bed + wardrobe upstairs.
  // Everything keeps to the half away from that storey's ramp strip and
  // stairwell hole (they alternate sides, see holeSide/side above).
  const fx = -width * .18;
  placeFurniture(parts, "table", fx, .15, .6);
  placeFurniture(parts, "chair", fx, .15, 1.6, 2);
  placeFurniture(parts, "chair", fx + 1.15, .15, -.4, 1);
  placeFurniture(parts, "sofa", -width * .1, .15, -D2 + T + .65);
  for (let s = 1; s < storeys; s++) {
    const y0 = s * floorH + .18, ws = width + s, ds = depth + .6;
    placeFurniture(parts, "bed", 0, y0, -ds / 2 + T + 1.4);
    placeFurniture(parts, "wardrobe", ws * .25, y0, ds / 2 - T - .5, 2);
    placeFurniture(parts, "chair", -ws * .15, y0, ds / 2 - T - .85, 2);
  }

  const rh = roofH ?? w * .6;
  parts.push({ shape: "gable", size: [w + .7, rh, depth + 1], pos: [0, storeys * floorH, 0], color: roofC, pat: "tiles" });
  parts.push({ shape: "box", size: [.9, rh + 1.6, .9], pos: [w * .25, storeys * floorH + (rh + 1.6) / 2 - .8, -depth * .2], color: stone });

  const floorY = (x, z) => {
    if (Math.abs(x) > (width + storeys - 1) / 2 + .3 || Math.abs(z) > D2 + .3) return 0;
    const lv = [.15];
    for (let s = 1; s < storeys; s++) {              // slabs, minus the cutout over each ramp's arrival
      const side = (s - 1) % 2 ? -1 : 1;
      const sxp = side * (width / 2 - stairW / 2 - .2);
      const hzA = side > 0 ? zRun1 : zRun0 - run * .78;
      const hzB = side > 0 ? zRun1 + run * .78 : zRun0;
      if (!(Math.abs(x - sxp) <= stairW / 2 + .2 && z >= hzA && z <= hzB)) lv.push(s * floorH + .18);
    }
    for (let s = 0; s < storeys - 1; s++) {          // the staircases themselves
      const side = s % 2 ? -1 : 1;
      const sxp = side * (width / 2 - stairW / 2 - .2);
      if (Math.abs(x - sxp) <= stairW / 2 + .1) {
        const t = side > 0 ? (zRun0 - z) / run : (z - zRun1) / run;
        if (t >= 0 && t <= 1) lv.push(stairY(s * floorH + .15, floorH, t, run));
      }
    }
    return lv;
  };
  // the front doorway and ground-floor window, exported so the demo can
  // hang clickable door/window panels in them
  return { name, parts, footprint: [width + 2, depth + 2], floorY,
           doors: [{ x: 0, z: D2 - T / 2, w: doorW, h: doorH }],
           windows: winsOut,
           cobwebs: [{ x: -(width - T) / 2, y: floorH, z: -D2 + T, sx: 1, sz: 1, d: .6 },       // the back corners of the ground room
                     { x: (width - T) / 2, y: floorH, z: -D2 + T, sx: -1, sz: 1, d: .5 },
                     { x: (width + 1 - T) / 2, y: 2 * floorH + .18, z: -(depth + .6) / 2 + T, sx: -1, sz: 1, d: .5 }] };
}

// ---- English medieval castle (Caerphilly) -----------------------------------
// A concentric water castle: the island plinth carries a low outer curtain
// and a high inner ward with four drum towers (the south-east one famously
// leaning), a twin-towered gatehouse, a great hall, straight stairs up to
// the wall-walk, and lift spots onto the tower decks. The moat ring around
// the island is exported (`moat`) -- the demo carves the water around it
// and lays the bridge deck across.

export function englishCastle({ name = "Caerphilly Castle" } = {}) {
  const parts = [], lifts = [];
  const IW = 17, ID = 13;            // inner ward half extents
  const OW = 29, OD = 25;            // outer curtain half extents
  const HW = 34, HD = 30;            // island half extents
  const MW = 13;                     // moat width
  const wallH = 9, wallT = 2.2, outH = 5.5, outT = 1.5, towerR = 5.2, towerH = 14.5;
  const stone = 0xa9a294, dark = 0x8e887b, wood = 0x4c3a26;
  const walkY = .4 + wallH, deckY = .4 + towerH;

  parts.push({ shape: "box", size: [2 * HW, .4, 2 * HD], pos: [0, .2, 0], color: dark, collide: false });   // the island

  // outer curtain: low ring with front and rear gates, corner turrets
  for (const sz of [1, -1])
    parts.push({ shape: "hwall", size: { w: 2 * OW, h: outH, t: outT, holes: [[0, 0, 4.2, 4.4]] },
                 pos: [0, .4, sz * (OD - outT / 2)], color: stone, pat: "ashlar" });
  for (const sx of [-1, 1])
    parts.push({ shape: "box", size: [outT, outH, 2 * OD], pos: [sx * (OW - outT / 2), .4 + outH / 2, 0], color: stone, pat: "ashlar" });
  // battlements on every tower top: a low parapet ring (walkers cannot
  // step over it) carrying merlons ~1m wide with ~.6m embrasures between,
  // the classic 13th-century proportion; boxes stand tangent to the drum
  const crenellate = (cx, topY, cz, r, seg) => {
    const rp = r - .2, n = Math.max(6, Math.round(2 * Math.PI * rp / 1.55));
    for (let i = 0; i < seg; i++) {   // parapet: one box per drum facet, .75m high
      const a = (i + .5) * 2 * Math.PI / seg;
      parts.push({ shape: "box", size: [2 * rp * Math.tan(Math.PI / seg) + .05, .75, .36], rot: [0, -a * 57.29578 - 90, 0], outline: false,
                   pos: [cx + Math.cos(a) * rp, topY + .375, cz + Math.sin(a) * rp], color: stone });
    }
    for (let i = 0; i < n; i++) {     // merlons
      const a = i * 2 * Math.PI / n;
      parts.push({ shape: "box", size: [.95, .95, .38], rot: [0, -a * 57.29578 - 90, 0],
                   pos: [cx + Math.cos(a) * rp, topY + .75 + .475, cz + Math.sin(a) * rp], color: stone });
    }
  };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push({ shape: "cyl", size: { r1: 1.9, r2: 1.9, h: outH + 2.4, seg: 10 }, pos: [sx * OW, .4 + (outH + 2.4) / 2, sz * OD], color: stone, pat: "ashlar" });
    crenellate(sx * OW, .4 + outH + 2.4, sz * OD, 1.9, 10);
  }

  // inner ward: high curtain with a wall-walk and parapets both sides
  for (const sz of [1, -1])
    parts.push({ shape: "hwall", size: { w: 2 * IW, h: wallH, t: wallT, holes: [[0, 0, 3.6, 4.4]] },
                 pos: [0, .4, sz * ID], color: stone, pat: "ashlar" });
  for (const sx of [-1, 1])
    parts.push({ shape: "box", size: [wallT, wallH, 2 * ID], pos: [sx * IW, .4 + wallH / 2, 0], color: stone, pat: "ashlar" });
  for (const sz of [-1, 1]) for (const o of [-1, 1])
    parts.push({ shape: "box", size: [2 * IW + wallT, 1.15, .3], pos: [0, walkY + .57, sz * ID + o * (wallT / 2 - .15)], color: stone });
  for (const sx of [-1, 1]) {
    parts.push({ shape: "box", size: [.3, 1.15, 2 * ID], pos: [sx * IW + sx * (wallT / 2 - .15), walkY + .57, 0], color: stone });
    // the INNER parapet leaves a gap where the stair lands on the walk
    parts.push({ shape: "box", size: [.3, 1.15, ID + 5.6], pos: [sx * IW - sx * (wallT / 2 - .15), walkY + .57, (-ID + 5.6) / 2], color: stone });
    parts.push({ shape: "box", size: [.3, 1.15, ID - 8.7], pos: [sx * IW - sx * (wallT / 2 - .15), walkY + .57, (8.7 + ID) / 2], color: stone });
  }

  // four straight drum towers, each with a crenellated deck and a lift spot
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push({ shape: "cyl", size: { r1: towerR, r2: towerR, h: towerH, seg: 14 },
                 pos: [sx * IW, .4 + towerH / 2, sz * ID], color: stone, pat: "ashlar" });
    crenellate(sx * IW, deckY, sz * ID, towerR, 14);
    lifts.push({ bx: sx * IW, bz: sz * (ID - towerR - 1.4), by: walkY,
                 tx: sx * IW, tz: sz * ID, ty: deckY });
  }

  // twin-towered gatehouse over the front gate
  for (const sx of [-1, 1]) {
    parts.push({ shape: "cyl", size: { r1: 3.1, r2: 3.1, h: 12, seg: 12 }, pos: [sx * 4.5, .4 + 6, ID + 1.2], color: stone, pat: "ashlar" });
    crenellate(sx * 4.5, .4 + 12, ID + 1.2, 3.1, 12);
  }
  parts.push({ shape: "box", size: [10.4, 3.4, 6.2], pos: [0, .4 + 7.2, ID + .8], color: stone, pat: "ashlar" });
  // (the gate leaf is a real openable door, exported below)

  // the great hall against the rear wall
  parts.push({ shape: "hwall", size: { w: 15, h: 5.5, t: 1, holes: [[-4, 0, 1.6, 2.6], [2, 1.4, 1.6, 1.8], [5.2, 1.4, 1.6, 1.8]] },
               pos: [-1, .4, -ID + 7], color: stone, pat: "ashlar" });
  for (const sx of [-1, 1])
    parts.push({ shape: "box", size: [1, 5.5, 6.5], pos: [-1 + sx * 7.5, .4 + 2.75, -ID + 3.75], color: stone, pat: "ashlar" });
  parts.push({ shape: "gable", size: [16.5, 3.4, 8], pos: [-1, .4 + 5.5, -ID + 3.6], color: 0x6b6f68, pat: "tiles" });
  const windows = [{ x: 1, y: .4 + 2.3, z: -ID + 7.5, w: 1.5, h: 1.7 }];   // the hall window opens
  placeFurniture(parts, "table", -3, .4, -ID + 4);
  placeFurniture(parts, "chair", -3, .4, -ID + 5.2, 2);
  placeFurniture(parts, "chair", -1.6, .4, -ID + 3.2, 1);

  // straight stairs from the ward up to the wall-walk, hugging both side walls
  for (const sx of [-1, 1])
    stairSteps(parts, { x: sx * (IW - 1.9), w: 1.8, y0: .4, rise: wallH, z0: -6.5, z1: 8, color: dark, rail: -sx });

  // the bridge over the moat to the front gates: deck runs from the road's
  // end onto the island, with an apron step so the walk on is fluent
  parts.push({ shape: "box", size: [4.6, .5, MW + 8], pos: [0, .2, HD + MW / 2 + 2], color: wood, collide: false });
  parts.push({ shape: "box", size: [4.6, .3, 3], pos: [0, .15, HD + MW + 6.5], color: wood, collide: false });
  for (const sx of [-1, 1])
    parts.push({ shape: "box", size: [.3, 1.1, MW + 8], pos: [sx * 2.15, 1.0, HD + MW / 2 + 2], color: wood });
  for (const bz of [HD + 3.5, HD + MW - 3.5])   // piers stay fully below the deck
    parts.push({ shape: "cyl", size: { r1: .8, r2: .9, h: 4, seg: 8 }, pos: [0, -1.85, bz], color: dark });

  const floorY = (x, z) => {
    if (Math.abs(x) < 2.3 && z > HD - 1 && z <= HD + MW + 5) return .45;          // the bridge deck
    if (Math.abs(x) < 2.3 && z > HD + MW + 5 && z <= HD + MW + 8.2) return .3;    // the apron step down to the road
    if (Math.abs(x) > HW || Math.abs(z) > HD) return 0;
    const lv = [.4];
    for (const sx of [-1, 1]) for (const sz of [-1, 1])                            // tower decks
      if (Math.hypot(x - sx * IW, z - sz * ID) < towerR - .2) return [deckY];
    if (Math.abs(Math.abs(z) - ID) < wallT / 2 + .2 && Math.abs(x) < IW + 1) lv.push(walkY);   // wall-walk
    if (Math.abs(Math.abs(x) - IW) < wallT / 2 + .2 && Math.abs(z) < ID + 1) lv.push(walkY);
    for (const sx of [-1, 1])                                                      // the stairs
      if (Math.abs(x - sx * (IW - 1.9)) < 1.1 && z > -6.7 && z < 8.2)
        lv.push(stairY(.4, wallH, (z + 6.5) / 14.5, 14.5));
    return lv;
  };

  const cobwebs = [{ x: -8, y: .4 + 5.5, z: -ID + 6.5, sx: 1, sz: -1, d: .7 }, { x: 6, y: .4 + 5.5, z: -ID + .9, sx: -1, sz: 1, d: .6 }];   // the great hall's corners
  return { name, parts, footprint: [2 * (HW + MW) + 4, 2 * (HD + MW) + 4], floorY, lifts, windows, cobwebs,
           moat: { hw: HW, hd: HD, w: MW, depth: 4.4 },   // 2.2m of water at the shared water level
           doors: [{ x: 0, z: ID, w: 3.4, h: 4.2 },          // the inner gate leaf
                   { x: -5, z: -ID + 7, w: 1.6, h: 2.6 }] }; // the great hall door
}

// ---- windmill ---------------------------------------------------------------
// A tapered stone tower mill under a conical cap. The rotating sail cross is
// NOT part of the static build: its hub position is exported as `sailAt` and
// the demo hangs a live, world-clock-driven cross there.

export function windmill({ name = "Windmill", h = 11, r0 = 4.2, r1 = 2.6,
                           stone = 0xcfc4ae, roofC = 0x7a5a38, wood = 0x4c3a26 } = {}) {
  const parts = [
    { shape: "cyl", size: { r1, r2: r0, h, seg: 12 }, pos: [0, h / 2, 0], color: stone, pat: "ashlar" },
    { shape: "cyl", size: { r1: .25, r2: r1 + .5, h: 3.6, seg: 12 }, pos: [0, h + 1.8, 0], color: roofC, pat: "tiles" },
    { shape: "box", size: [1.3, 2.2, .4], pos: [0, 1.1, r0 - .5], color: wood },                    // door
  ];
  return { name, parts, footprint: [2 * r0 + 2, 2 * r0 + 2], floorY: () => 0,
           windows: [{ x: 0, y: h * .55, z: (r0 + r1) / 2 - .35, w: .9, h: 1.0 }, { x: r0 * .82, y: h * .32, z: 0, w: .9, h: .9, yaw: 90 }],
           sailAt: [0, h + .9, r1 + 1.3], sailR: 6.8 };
}

// ---- goods: what travels on carts and gets stored in mills -------------------
// real cooperage: the workhorse ~225 l barrique most wine, ale and flour
// travelled in, and the ~40 l firkin/keg for everything sold by the small
// measure -- belly, head and hoop positions from the actual staves
export const BARRELS = {
  big: { h: .95, belly: .35, head: .29, hoops: [.06, .3, .65, .89] },
  keg: { h: .55, belly: .21, head: .17, hoops: [.04, .275, .51] },
};
const STAVE = 0x9a7040, HOOP = 0x4a4644;

// a barrel as parts, centered at `pos`: two stacked frustums meeting at the
// bilge, iron hoops riding the stave curve. orient: "up" standing on its
// head, "z" lying across a bed, "x" lying along it
export function barrel(kind, [x, y, z], orient = "up") {
  const b = BARRELS[kind], hh = b.h / 2;
  const rAt = (t) => b.head + (b.belly - b.head) * (1 - Math.abs(t - hh) / hh);
  const pieces = [
    { shape: "cyl", size: { r1: b.belly, r2: b.head, h: hh, seg: 12 }, t: hh / 2, color: STAVE },
    { shape: "cyl", size: { r1: b.head, r2: b.belly, h: hh, seg: 12 }, t: hh * 1.5, color: STAVE },
    ...b.hoops.map((t) => ({ shape: "cyl", size: { r1: rAt(t) + .012, r2: rAt(t) + .012, h: .045, seg: 12 },
                              t, color: HOOP, outline: false })),
  ];
  return pieces.map(({ t, ...p }) => {
    const d = t - hh;   // signed offset from the barrel's center along its axis
    return orient === "up" ? { ...p, pos: [x, y + d, z] }
         : orient === "z" ? { ...p, pos: [x, y, z + d], rot: [90, 0, 0] }
         : { ...p, pos: [x - d, y, z], rot: [0, 0, 90] };
  });
}

// a full grain sack (~1m long, ~.5m across: the 60-80 kg sack a man could
// still shoulder): a plump ellipsoid with the tied neck. axis "x"/"z" =
// lying along that axis, "up" = standing on its bottom; pos = its center.
// Standing: .9 tall (center y = floor + .45); lying: .48 tall (floor + .24).
export const SACK = { len: 1.0, w: .5 };
export function sack([x, y, z], axis = "x", color = 0xc4a672) {
  const R = .3;
  const sc = axis === "up" ? [.8, 1.5, .8] : axis === "x" ? [1.65, .8, .95] : [.95, .8, 1.65];
  const neck = axis === "up" ? [0, R * 1.5 + .03, 0] : axis === "x" ? [R * 1.65 + .03, .04, 0] : [0, .04, R * 1.65 + .03];
  return [
    { shape: "sphere", size: { r: R }, scale: sc, pos: [x, y, z], color },
    { shape: "sphere", size: { r: .09 }, pos: [x + neck[0], y + neck[1], z + neck[2]], color: 0x9c8258 },
  ];
}

// ---- water mill --------------------------------------------------------------
// An undershot water wheel, axis along z, centered on its axle: two felloe
// rims joined by radial paddle boards, spokes, hub, and the axle running
// back into the mill (with the pit wheel on it) -- the whole thing turns
// as one group, driven by the demo at flow speed / radius.
export function waterWheel({ r = 3.05, w = 1.2, axleBack = 5.2, axleFwd = .95 } = {}) {
  const dark = 0x4e3a24, plank = 0x7a5a36, parts = [];
  const n = r > 2.6 ? 14 : 12, rf = r - .08;
  parts.push({ shape: "cyl", size: { r1: .22, r2: .22, h: w + .3, seg: 10 }, pos: [0, 0, 0], rot: [90, 0, 0], color: dark });
  parts.push({ shape: "cyl", size: { r1: .14, r2: .14, h: axleBack + axleFwd, seg: 8 },
               pos: [0, 0, (axleFwd - axleBack) / 2], rot: [90, 0, 0], color: dark });
  parts.push({ shape: "cyl", size: { r1: 1.05, r2: 1.05, h: .16, seg: 16 }, pos: [0, 0, -axleBack + .3], rot: [90, 0, 0], color: plank });   // pit wheel, just inside the wall
  for (const sz of [-1, 1]) for (let i = 0; i < 14; i++) {   // two rims
    const b = (i + .5) * 360 / 14, br = b * Math.PI / 180;
    parts.push({ shape: "box", size: [2 * rf * Math.tan(Math.PI / 14) + .02, .16, .1], pos: [Math.cos(br) * rf, Math.sin(br) * rf, sz * w / 2],
                 rot: [0, 0, b + 90], color: dark });
    if (i % 2 === 0) {   // seven spokes per rim
      const a = i * 360 / 14, ar = a * Math.PI / 180, rc = (rf - .08 + .2) / 2;
      parts.push({ shape: "box", size: [rf - .08 - .2, .1, .08], pos: [Math.cos(ar) * rc, Math.sin(ar) * rc, sz * w / 2],
                   rot: [0, 0, a], color: plank, outline: false });
    }
  }
  for (let i = 0; i < n; i++) {   // paddle boards, set radially between the rims
    const a = i * 360 / n, ar = a * Math.PI / 180, rc = r - .32;
    parts.push({ shape: "box", size: [.6, .05, w - .12], pos: [Math.cos(ar) * rc, Math.sin(ar) * rc, 0], rot: [0, 0, a], color: plank });
  }
  return { name: "water wheel", parts };
}

// The mill house on the river bank: a 9 x 6.5 m stone building (real
// village mills ran 8-12 m long) with the door on the -z side and the wheel
// standing off the +z wall in the stream on a piled frame. Inside, the
// axle's pit wheel drives a wallower on the upright shaft, which turns the
// runner stone over the bedstone on the hurst frame; a hopper feeds the
// eye, the meal runs down a chute. Wheat arrives in sacks, flour leaves in
// barrels -- both stacked where they would be. Floor is walkable.
export function watermill({ name = "Water mill" } = {}) {
  const W = 9, D = 6.5, H = 3.4, T = .5, F = .15;
  const stone = 0xb8ad98, dark = 0x8e887b, wood = 0x6a5236, darkWood = 0x4e3a24, parts = [];
  // The wheel: 6.1m across, its axle only .5m above the floor -- the water
  // is 2.35m below the floor, so this is the only way paddles reach the
  // stream (the medieval answer: a big low wheel). Inside, the pit wheel on
  // that axle turns in a fenced PIT cut through the floor.
  const AX = .5, pitZ = D / 2 - .9, pitZ0 = pitZ - 1.05, pitZ1 = D / 2 - T;
  const FLOOR = { color: dark, pat: "checker", accent: 0x7c7468 };
  parts.push({ shape: "box", size: [W, .3, pitZ0 + D / 2], pos: [0, 0, (pitZ0 - D / 2) / 2], ...FLOOR });   // floor slab, top at F, minus the pit
  for (const sx of [-1, 1]) parts.push({ shape: "box", size: [W / 2 - .7, .3, D / 2 - pitZ0], pos: [sx * (W / 2 + .7) / 2, 0, (pitZ0 + D / 2) / 2], ...FLOOR });
  parts.push({ shape: "box", size: [1.4, .1, pitZ1 - pitZ0], pos: [0, -1.55, (pitZ0 + pitZ1) / 2], color: 0x5a544c });   // pit floor
  for (const sx of [-1, 1]) parts.push({ shape: "box", size: [.12, 1.65, pitZ1 - pitZ0], pos: [sx * .76, -.7, (pitZ0 + pitZ1) / 2], color: stone, pat: "ashlar" });
  parts.push({ shape: "box", size: [1.64, 1.65, .12], pos: [0, -.7, pitZ0 - .06], color: stone, pat: "ashlar" });
  for (const [x, z] of [[-.85, pitZ0 - .1], [.85, pitZ0 - .1], [-.85, pitZ1 - .1], [.85, pitZ1 - .1]])   // the rail around the pit
    parts.push({ shape: "box", size: [.07, .95, .07], pos: [x, F + .475, z], color: darkWood });
  parts.push({ shape: "box", size: [1.8, .06, .06], pos: [0, F + .92, pitZ0 - .1], color: darkWood });
  for (const sx of [-1, 1]) parts.push({ shape: "box", size: [.06, .06, pitZ1 - pitZ0], pos: [sx * .85, F + .92, (pitZ0 + pitZ1) / 2 - .1], color: darkWood });
  parts.push({ shape: "hwall", size: { w: W, h: H, t: T, holes: [[-2.5, 1.3, .9, 1.0]] }, pos: [0, 0, -D / 2 + T / 2], color: stone, pat: "ashlar" });   // north wall: window
  parts.push({ shape: "hwall", size: { w: W, h: H, t: T, holes: [[0, AX - .2, .6, .4], [3.0, 1.3, .9, 1.0]] }, pos: [0, 0, D / 2 - T / 2], color: stone, pat: "ashlar" });   // river wall: axle hole + window
  parts.push({ shape: "hwall", size: { w: D, h: H, t: T, holes: [[0, 0, 1.3, 2.3]] }, pos: [W / 2 - T / 2, 0, 0], rot: [0, -90, 0], color: stone, pat: "ashlar" });   // east wall: the door, onto the riverside street
  parts.push({ shape: "hwall", size: { w: D, h: H, t: T, holes: [[0, 1.3, .9, 1.0]] }, pos: [-(W / 2 - T / 2), 0, 0], rot: [0, -90, 0], color: stone, pat: "ashlar" });
  const windows = [[3.0, D / 2 - T / 2], [-2.5, -D / 2 + T / 2], [-(W / 2 - T / 2), 0]]   // openable panes
    .map(([x, z]) => ({ x, y: 1.8, z, w: .9, h: 1.0, yaw: z === 0 ? 90 : 0 }));
  parts.push({ shape: "gable", size: [W + .8, 2.8, D + .8], pos: [0, H, 0], color: 0x6b5a48, pat: "tiles" });
  parts.push({ shape: "box", size: [W + 1.0, .25, D + 1.0], pos: [0, H - .1, 0], color: darkWood });   // eaves plate

  // the wheel frame in the stream: two piles and the bearing beam the axle rests on
  const wheelZ = D / 2 + 4.6;
  for (const sx of [-1, 1])
    parts.push({ shape: "cyl", size: { r1: .18, r2: .2, h: 5.6, seg: 8 }, pos: [sx * .6, -1.9, wheelZ + .95], color: darkWood });
  parts.push({ shape: "box", size: [1.8, .28, .32], pos: [0, AX - .28, wheelZ + .95], color: darkWood });

  // the drive: pit wheel (on the axle, in the pit) -> wallower on the upright shaft -> the stones on the hurst frame
  const sz = pitZ - 1.05 - .35;   // upright shaft z: the wallower meshes with the pit wheel's rim
  parts.push({ shape: "box", size: [2.6, .75, 1.6], pos: [0, F + .375, sz - .5], color: wood, solid: true, pat: "wood" });   // hurst frame
  parts.push({ shape: "cyl", size: { r1: .12, r2: .12, h: 2.9, seg: 8 }, pos: [0, F + 1.3, sz], color: darkWood });   // upright shaft
  parts.push({ shape: "cyl", size: { r1: .33, r2: .33, h: .18, seg: 12 }, pos: [0, AX, sz], color: wood });          // wallower
  parts.push({ shape: "cyl", size: { r1: .72, r2: .72, h: .22, seg: 16 }, pos: [0, F + .75 + .11, sz], color: 0xa8a29a });   // bedstone
  parts.push({ shape: "cyl", size: { r1: .72, r2: .72, h: .22, seg: 16 }, pos: [0, F + .75 + .33, sz], color: 0x9d9790 });   // runner stone
  parts.push({ shape: "cyl", size: { r1: .8, r2: .8, h: .35, seg: 16, open: true }, pos: [0, F + .75 + .45, sz], color: wood, side: "double", outline: false });   // the tun
  for (const sx of [-1, 1])
    parts.push({ shape: "box", size: [.08, 1.1, .08], pos: [sx * .5, F + 1.85, sz], color: darkWood });   // hopper frame
  parts.push({ shape: "cyl", size: { r1: .55, r2: .18, h: .7, seg: 8 }, pos: [0, F + 2.35, sz], color: wood });   // hopper
  parts.push({ shape: "box", size: [.35, .12, 1.4], pos: [0, F + .95, sz - 1.6], rot: [-22, 0, 0], color: wood, collide: false });   // meal chute
  // wheat in, flour out
  const wheat = 0xc4a672;
  for (const [x, z, ax] of [[2.9, -1.6, "x"], [2.9, -1.05, "x"], [2.9, -.5, "x"], [2.9, -1.33, "x"], [2.9, -.78, "x"], [1.7, -2.4, "up"], [3.2, -2.5, "up"]])
    parts.push(...sack([x, F + (ax === "up" ? .45 : .24) + (Math.abs(z + 1.33) < .01 || Math.abs(z + .78) < .01 ? .4 : 0), z], ax, wheat));
  parts.push(...sack([0, F + .24, sz - 2.45], "z", wheat));   // one open at the chute's foot
  for (const x of [-3.6, -2.85, -2.1]) parts.push(...barrel("big", [x, F + BARRELS.big.h / 2, 2.2], "up"));
  for (const x of [-3.6, -2.9]) parts.push(...barrel("keg", [x, F + BARRELS.keg.h / 2, 1.3], "up"));
  parts.push(...barrel("big", [-3.6, F + BARRELS.big.belly, -1.6], "z"));
  for (const [x, z] of [[W / 2 + 1.6, -1.9], [W / 2 + 1.6, -2.5]]) parts.push(...sack([x, .24, z], "z", wheat));   // waiting outside the door

  const floorY = (x, z) => (Math.abs(x) < W / 2 && Math.abs(z) < D / 2 ? F : 0);
  return { name, parts, footprint: [W + 2, D + 2], floorY,
           doors: [{ x: W / 2 - T / 2, z: 0, w: 1.3, h: 2.3, yaw: 90 }], windows,
           cobwebs: [{ x: -(W / 2 - T), y: H, z: -(D / 2 - T), sx: 1, sz: 1, d: .6 }, { x: W / 2 - T, y: H, z: -(D / 2 - T), sx: -1, sz: 1, d: .5 }],
           wheelAt: [0, AX, wheelZ], wheel: { r: 3.05, w: 1.2, axleBack: wheelZ - pitZ + .3, axleFwd: .95 } };
}

// ---- tavern ------------------------------------------------------------------
// A riverside inn at real village-inn size: a 14 x 9 m stone taproom under
// a jettied, timber-framed guest floor. Downstairs: the bar along the back
// wall with the keeper behind it and casks on tap, a hearth on the east
// gable with a cook-pot hanging over the fire, four trestle tables with
// benches where guests sit over mugs, jugs and plates of bread, cheese
// and sausage. A straight stair up the west wall reaches a corridor and
// three guest rooms, each with a bed to sleep in, a chair and a chest or
// wardrobe. The door opens to +z (the riverside street); folkSpots seat the
// company and stand the keeper.
export function tavern({ name = "The Mill Inn" } = {}) {
  const W = 14, D = 9, H0 = 3.2, H1 = 2.7, T = .4, F = .15, D2 = D / 2, W2 = W / 2;
  const stone = 0x9a917f, plaster = 0xd9cfba, timber = 0x5b4326, wood = 0x6b4a2c, dark = 0x4a3520, roofC = 0x7d5433;
  const raw = [], folkSpots = [];
  const parts = { push: (...ps) => raw.push(...ps.map((p) => ((p.color === wood || p.color === dark) && p.shape === "box" && !p.pat ? { ...p, pat: "wood" } : p))) };
  const y1 = H0, ceil = y1 + .18;   // upper slab bottom / top

  // ---- shell ----
  parts.push({ shape: "box", size: [W, .15, D], pos: [0, .075, 0], color: 0x8b8578, pat: "checker", accent: 0x6f6960 });   // flagstone floor
  parts.push({ shape: "hwall", size: { w: W, h: H0, t: T, holes: [[0, 0, 1.4, 2.2], [-3.4, 1.1, 1.2, 1.1], [3.6, 1.1, 1.2, 1.1]] },
               pos: [0, 0, D2 - T / 2], color: stone, pat: "ashlar" });                                  // front: door + two windows
  parts.push({ shape: "hwall", size: { w: W, h: H0, t: T, holes: [[-4.2, 1.3, 1.0, .9]] }, pos: [0, 0, -D2 + T / 2], color: stone, pat: "ashlar" });
  parts.push({ shape: "hwall", size: { w: D, h: H0, t: T, holes: [[1.5, 1.2, 1.0, 1.0]] }, pos: [-(W2 - T / 2), 0, 0], rot: [0, -90, 0], color: stone, pat: "ashlar" });
  parts.push({ shape: "box", size: [T, H0, D], pos: [W2 - T / 2, H0 / 2, 0], color: stone, pat: "ashlar" });   // east gable wall carries the hearth
  const windows = [[-3.4, D2 - T / 2, 1], [3.6, D2 - T / 2, 1], [-4.2, -D2 + T / 2, 1], [-(W2 - T / 2), 1.5, 0]]   // all openable
    .map(([x, z, along]) => ({ x, y: 1.7, z, w: along ? 1.2 : 1.0, h: along ? 1.1 : 1.0, yaw: along ? 0 : 90 }));
  // the guest floor: slab with the stairwell cut out, jettied .5m all round in timber framing
  const stairX = -(W2 - T - .85), stairW = 1.5, zBot = D2 - T - .3, zTop = -D2 + T + .3, run = zBot - zTop;
  const hx0 = stairX - stairW / 2 - .2, hx1 = stairX + stairW / 2 + .2;
  const hz0 = zTop - .2, hz1 = zTop + run * .62;   // headroom over the upper 62% of the climb (a 2m walker under a 3.2m storey)
  const w1 = W + 1, d1 = D + 1;   // the jetty: the guest floor overhangs .5m all round
  const iw0 = -w1 / 2 + T, iw1 = w1 / 2 - T, id0 = -d1 / 2 + T, id1 = d1 / 2 - T;   // slab reaches the jettied walls
  parts.push({ shape: "box", size: [hx0 - iw0, .18, id1 - id0], pos: [(hx0 + iw0) / 2, y1 + .09, 0], color: timber, pat: "parquet" });
  parts.push({ shape: "box", size: [iw1 - hx1, .18, id1 - id0], pos: [(hx1 + iw1) / 2, y1 + .09, 0], color: timber, pat: "parquet" });
  parts.push({ shape: "box", size: [hx1 - hx0, .18, hz0 - id0], pos: [(hx0 + hx1) / 2, y1 + .09, (hz0 + id0) / 2], color: timber, pat: "parquet" });
  parts.push({ shape: "box", size: [hx1 - hx0, .18, id1 - hz1], pos: [(hx0 + hx1) / 2, y1 + .09, (hz1 + id1) / 2], color: timber, pat: "parquet" });
  for (let x = -W2 + T + .6; x < W2 - T; x += 1.2)   // exposed ceiling joists under the guest floor
    if (x < hx0 - .1 || x > hx1 + .1) parts.push({ shape: "box", size: [.16, .22, D - 2 * T], pos: [x, y1 - .11, 0], color: dark, collide: false });
  parts.push({ shape: "hwall", size: { w: w1, h: H1, t: T, holes: [[-4.5, .9, 1.0, 1.1], [-.5, .9, 1.0, 1.1], [3.7, .9, 1.0, 1.1]] },
               pos: [0, ceil, (d1 - T) / 2], color: plaster });
  parts.push({ shape: "box", size: [w1, H1, T], pos: [0, ceil + H1 / 2, -(d1 - T) / 2], color: plaster });
  for (const sx of [-1, 1]) parts.push({ shape: "box", size: [T, H1, d1], pos: [sx * (w1 - T) / 2, ceil + H1 / 2, 0], color: plaster });
  for (const x of [-4.5, -.5, 3.7]) windows.push({ x, y: ceil + 1.45, z: (d1 - T) / 2, w: 1.1, h: 1.2 });
  for (const sz of [-1, 1]) parts.push({ shape: "box", size: [w1 + .2, .28, .3], pos: [0, ceil + .1, sz * (d1 - .1) / 2], color: timber });
  for (const sx of [-1, 1]) parts.push({ shape: "box", size: [.3, .28, d1 + .2], pos: [sx * (w1 - .1) / 2, ceil + .1, 0], color: timber });
  for (const sz of [-1, 1]) for (let k = 0; k < 7; k++)   // studs, and diagonal braces between them
    parts.push({ shape: "box", size: [.2, H1, .12], pos: [(k / 6 - .5) * w1 * .92, ceil + H1 / 2, sz * (d1 / 2 + .04)], color: timber });
  for (const sx of [-1, 1]) for (let k = 0; k < 4; k++)
    parts.push({ shape: "box", size: [.12, H1, .2], pos: [sx * (w1 / 2 + .04), ceil + H1 / 2, (k / 3 - .5) * d1 * .85], color: timber });
  parts.push({ shape: "box", size: [w1, .18, d1], pos: [0, ceil + H1 + .09, 0], color: timber });   // attic floor
  const rh = 4.6;
  parts.push({ shape: "gable", size: [w1 + .8, rh, d1 + 1.2], pos: [0, ceil + H1, 0], color: roofC, pat: "tiles" });
  parts.push({ shape: "box", size: [1.1, ceil + H1 + rh - .6, 1.6], pos: [W2 + .55, (ceil + H1 + rh - .6) / 2 + .2, 0], color: stone, pat: "ashlar" });   // chimney stack outside the gable, ground to above the ridge
  // the inn sign on a bracket beside the door, and a bench under the front windows
  parts.push({ shape: "box", size: [.08, .08, 1.1], pos: [1.6, 2.65, D2 + .5], color: dark });
  parts.push({ shape: "box", size: [.06, .55, .85], pos: [1.6, 2.25, D2 + .75], color: 0xb0453a, pat: "stars", accent: 0xe4c25a });
  parts.push({ shape: "box", size: [2.4, .06, .38], pos: [-3.4, .45, D2 + .55], color: wood, sit: true });
  for (const x of [-4.4, -2.4]) parts.push({ shape: "box", size: [.08, .42, .34], pos: [x, .21, D2 + .55], color: wood });
  parts.push(...barrel("keg", [4.6, BARRELS.keg.h / 2, D2 + .7], "up"));
  parts.push(...barrel("big", [5.6, BARRELS.big.h / 2, D2 + .8], "up"));

  // ---- the stair up the west wall ----
  stairSteps(parts, { x: stairX, w: stairW, y0: F, rise: H0 + .03, z0: zBot, z1: zTop, color: 0x74582f, rail: 1 });
  wellRail(parts, { x0: hx0, x1: hx1, z0: hz0, z1: hz1, y: ceil, side: 1, landAt: "z0" });   // balustrade around the stairwell

  // ---- the bar along the back wall, kegs behind it, the keeper ----
  parts.push({ shape: "box", size: [5.2, 1.0, .65], pos: [3.4, F + .5, -D2 + T + 1.15], color: wood, solid: true });
  parts.push({ shape: "box", size: [5.5, .07, .85], pos: [3.4, F + 1.03, -D2 + T + 1.15], color: dark });
  parts.push({ shape: "box", size: [4.4, .06, .5], pos: [3.4, F + .7, -D2 + T + .35], color: wood });   // back shelf on trestles
  for (const x of [1.5, 5.3]) parts.push({ shape: "box", size: [.08, .64, .45], pos: [x, F + .35, -D2 + T + .35], color: wood });
  for (const x of [2.4, 4.4]) parts.push(...barrel("keg", [x, F + .73 + BARRELS.keg.belly, -D2 + T + .35], "x"));   // casks on tap, lying
  parts.push(...barrel("big", [.7, F + BARRELS.big.h / 2, -D2 + T + .5], "up"));
  parts.push({ shape: "box", size: [.02, .12, .04], pos: [1.02, F + .5, -D2 + T + .5], color: 0x8a7a5a });   // the tap
  folkSpots.push({ x: 3.6, y: F, z: -D2 + T + .45, h: -Math.PI / 2, pose: "stand" });   // the keeper, facing the room
  folkSpots.push({ x: 2.2, y: F, z: -D2 + T + 1.95, h: Math.PI / 2, pose: "stand" });   // a guest at the bar
  const mug = (x, y, z) => parts.push({ shape: "cyl", size: { r1: .045, r2: .045, h: .12, seg: 8 }, pos: [x, y + .06, z], color: 0x8b6a4a });   // a straight stoneware mug
  const jug = (x, y, z) => {   // a pitcher: belly, and a mouth wider than the foot
    parts.push({ shape: "cyl", size: { r1: .085, r2: .065, h: .15, seg: 8 }, pos: [x, y + .075, z], color: 0x6f5a46 });
    parts.push({ shape: "cyl", size: { r1: .075, r2: .085, h: .1, seg: 8 }, pos: [x, y + .2, z], color: 0x6f5a46 });
  };
  const plate = (x, y, z, food) => {
    parts.push({ shape: "cyl", size: { r1: .13, r2: .11, h: .014, seg: 10 }, pos: [x, y + .007, z], color: 0xe8e0d0, outline: false });
    if (food === "bread") parts.push({ shape: "sphere", size: { r: .085 }, scale: [1.4, .6, .9], pos: [x, y + .06, z], color: 0xb8803e });
    else if (food === "cheese") parts.push({ shape: "wedge", size: [.15, .05, .12], pos: [x - .06, y + .04, z + .05], color: 0xf0c95a });
    else parts.push({ shape: "cyl", size: { r1: .02, r2: .02, h: .19, seg: 6 }, pos: [x, y + .035, z], rot: [0, 0, 90], color: 0x8a3a2a });   // sausage
  };
  mug(2.6, F + 1.065, -D2 + T + 1.15); mug(3.1, F + 1.065, -D2 + T + 1.15); jug(4.6, F + 1.065, -D2 + T + 1.2);
  plate(1.6, F + 1.065, -D2 + T + 1.15, "bread");

  // ---- the hearth on the east gable: firebox, fire, pot on its chain ----
  const hxw = W2 - T;   // wall inner face
  parts.push({ shape: "box", size: [1.0, .1, 2.6], pos: [hxw - .5, F + .05, 0], color: 0x6f6960 });          // stone hearth slab
  for (const sz of [-1, 1]) parts.push({ shape: "box", size: [.75, 1.55, .32], pos: [hxw - .375, F + .78, sz * 1.0], color: stone, pat: "ashlar" });   // cheeks
  parts.push({ shape: "box", size: [.75, .55, 2.32], pos: [hxw - .375, F + 1.8, 0], color: stone, pat: "ashlar" });   // lintel
  parts.push({ shape: "box", size: [.75, H0 - F - 2.1, 2.32], pos: [hxw - .375, F + 2.07 + (H0 - F - 2.1) / 2, 0], color: stone, pat: "ashlar" });   // breast up to the ceiling
  for (const [z, a] of [[-.2, 20], [.2, -25], [0, 70]])   // logs
    parts.push({ shape: "cyl", size: { r1: .06, r2: .06, h: .65, seg: 6 }, pos: [hxw - .4, F + .16, z], rot: [90 + a, 0, 0], color: 0x3a2a1c });
  const fires = [{ x: hxw - .4, y: F + .2, z: 0, r: .22, h: .6 }];   // the live fire (the demo animates it)
  parts.push({ shape: "box", size: [.06, .06, 2.0], pos: [hxw - .4, F + 1.5, 0], color: 0x3e3a38 });                     // crossbar
  parts.push({ shape: "cyl", size: { r1: .012, r2: .012, h: .5, seg: 4 }, pos: [hxw - .4, F + 1.22, 0], color: 0x3e3a38 });   // chain
  parts.push({ shape: "cyl", size: { r1: .2, r2: .24, h: .3, seg: 10 }, pos: [hxw - .4, F + .83, 0], color: 0x2a2624 });     // the pot
  parts.push({ shape: "cyl", size: { r1: .17, r2: .17, h: .02, seg: 10 }, pos: [hxw - .4, F + .985, 0], color: 0x8a6a3a, outline: false });   // stew
  parts.push({ shape: "box", size: [.04, .04, .5], pos: [hxw - .4, F + 1.02, 0], color: 0x3e3a38 });                        // bail handle

  // ---- tables with benches, the company, and what is on the tables ----
  const benchTop = F + .47;
  const table = (tx, tz, seats, fare) => {
    placeFurniture(parts, "table", tx, F, tz);
    const top = F + .79;
    for (const s of [-1, 1]) {   // benches either side, along x
      parts.push({ shape: "box", size: [1.8, .06, .32], pos: [tx, benchTop - .03, tz + s * .8], color: wood, solid: true, sit: true });
      for (const dx of [-.75, .75]) parts.push({ shape: "box", size: [.08, .41, .28], pos: [tx + dx, F + .205, tz + s * .8], color: wood });
    }
    seats.forEach(([dx, s]) => folkSpots.push({ x: tx + dx, y: benchTop, z: tz + s * .8, h: s > 0 ? Math.PI / 2 : -Math.PI / 2, pose: "sit" }));
    seats.forEach(([dx, s]) => mug(tx + dx + .18, top, tz + s * .32));   // mugs at the guest's edge, plates on the center line: never overlapping
    jug(tx - .7, top, tz);
    fare.forEach(([dx, , f]) => plate(tx + dx, top, tz, f));
  };
  table(-3.2, 2.3, [[-.45, 1], [.45, 1], [-.45, -1]], [[-.45, .05, "bread"], [.45, -.05, "cheese"]]);
  table(1.2, 2.3, [[-.45, 1], [.45, -1]], [[.4, .05, "sausage"], [-.45, -.05, "bread"]]);
  table(-3.2, -1.4, [[-.45, -1], [.45, -1], [.45, 1]], [[0, 0, "cheese"], [.45, .2, "sausage"]]);
  table(2.6, -.6, [[-.45, 1]], [[-.45, -.1, "bread"]]);
  placeFurniture(parts, "chandelier", -1, y1 - .05, .5);

  // ---- upstairs: corridor along the back, three guest rooms along the front ----
  const cz = -D2 + T + 1.6;    // corridor wall z (rooms are south of it)
  const pT = .15, rx = [-5.0, -1.4, 2.2, W2 - T];
  const PLANK = { color: 0xc9b58e, pat: "grooves", accent: 0x8f7650 };   // planked partitions
  const wallBox = (x0, x1, z, h = H1) => x1 - x0 > .05 && parts.push({ shape: "box", size: [x1 - x0, h, pT], pos: [(x0 + x1) / 2, ceil + h / 2, z], ...PLANK });
  for (let x = -w1 / 2 + T + .9; x < w1 / 2 - T; x += 1.5)   // interior studs on the long walls: the frame shows inside too
    for (const z of [-d1 / 2 + T + .06, d1 / 2 - T - .06]) parts.push({ shape: "box", size: [.14, H1, .12], pos: [x, ceil + H1 / 2, z], color: timber });
  const roomDoors = [];   // real hinged doors into the guest rooms (exported with their storey height)
  for (let i = 0; i < 3; i++) {
    const x0 = rx[i], x1 = rx[i + 1], cx = (x0 + x1) / 2;
    wallBox(x0, cx - .45, cz); wallBox(cx + .45, x1, cz);                              // corridor wall with a doorway per room
    parts.push({ shape: "box", size: [.9, H1 - 2.0, pT], pos: [cx, ceil + 2.0 + (H1 - 2.0) / 2, cz], ...PLANK });   // lintel
    roomDoors.push({ x: cx, z: cz, y: ceil, w: .9, h: 2.0 });
    if (i < 2) parts.push({ shape: "box", size: [pT, H1, id1 - cz], pos: [x1, ceil + H1 / 2, (cz + id1) / 2], ...PLANK });   // party wall
    placeFurniture(parts, "bed", cx + (i === 1 ? .9 : -.6), ceil, id1 - 1.4, 1);                   // bed along the front wall
    placeFurniture(parts, "chair", cx + (i === 1 ? -1.2 : 1.2), ceil, cz + 1.0, i === 1 ? 1 : 3);
    if (i === 2) placeFurniture(parts, "wardrobe", x1 - .5, ceil, cz + 1.4, 3);
    else parts.push({ shape: "box", size: [.9, .5, .5], pos: [x0 + .6, ceil + .25, cz + .6], color: dark });   // a chest
    parts.push({ shape: "box", size: [.45, .02, .45], pos: [cx + (i === 1 ? -1.2 : 1.2), ceil + .7, id1 - .5], color: wood });   // bedside board
    mug(cx + (i === 1 ? -1.2 : 1.2), ceil + .71, id1 - .5);
  }
  wallBox(rx[0], rx[0] + .05, cz);   // (closes the wall at the stairwell edge)
  parts.push({ shape: "box", size: [pT, H1, id1 - cz], pos: [rx[0], ceil + H1 / 2, (cz + id1) / 2], ...PLANK });   // west room wall beside the stairwell

  const floorY = (x, z) => {
    if (Math.abs(x) > W2 + .3 || Math.abs(z) > D2 + .3) return 0;
    const lv = [F];
    if (!(x >= hx0 && x <= hx1 && z >= hz0 && z <= hz1)) lv.push(ceil);
    if (Math.abs(x - stairX) <= stairW / 2 + .1) {
      const t = (zBot - z) / run;
      if (t >= 0 && t <= 1) lv.push(stairY(F, H0 + .03, t, run));
    }
    return lv;
  };
  return { name, parts: raw, footprint: [W + 2, D + 2], floorY, folkSpots, fires, windows,
           doors: [{ x: 0, z: D2 - T / 2, w: 1.4, h: 2.2 }, ...roomDoors],
           cobwebs: [{ x: -(W2 - T), y: y1, z: -(D2 - T), sx: 1, sz: 1, d: .7 }, { x: -(W2 - T), y: y1, z: D2 - T, sx: 1, sz: -1, d: .5 },
                     { x: W2 - T, y: y1, z: D2 - T, sx: -1, sz: -1, d: .55 }, { x: w1 / 2 - T, y: ceil + H1, z: d1 / 2 - T, sx: -1, sz: -1, d: .5 }] };
}

// ---- river landing and barge --------------------------------------------------
// The landing: a gravel yard on the quay top (the storage rows and the
// carts' turning place), a plank deck on piles reaching 2m out over the
// bank line, stairs down to a floating stage at barge-deck height with
// mooring bollards. The barge moors alongside the stage. Everything the
// dock hands walk is exported as waypoints (local coordinates).
export function landing({ name = "Landing" } = {}) {
  const W = 20, D = 12, parts = [];
  const plank = 0x7a5a36, dark = 0x4e3a24;
  parts.push({ shape: "box", size: [W, .1, D], pos: [0, 0, 0], color: 0x8a8070, collide: false });                   // gravel apron
  parts.push({ shape: "box", size: [12, .16, 5.2], pos: [0, .1, 6.5], color: plank, pat: "wood", collide: false });   // the deck, z 4..9
  for (const x of [-5.5, -2, 2, 5.5]) for (const z of [4.6, 8.6]) parts.push({ shape: "cyl", size: { r1: .16, r2: .18, h: 5, seg: 8 }, pos: [x, -2.3, z], color: dark });
  parts.push({ shape: "box", size: [8, .14, 4], pos: [0, -1.3, 11], color: plank, pat: "wood", collide: false });     // the stage, z 9..13, at -1.3
  for (const x of [-3.6, 0, 3.6]) for (const z of [9.5, 12.6]) parts.push({ shape: "cyl", size: { r1: .16, r2: .18, h: 4, seg: 8 }, pos: [x, -3.2, z], color: dark });
  stairSteps(parts, { x: 5.2, w: 1.4, y0: -1.23, rise: 1.41, z0: 13.2, z1: 9.2, color: 0x74582f, rail: 1 });       // down to the stage, east side
  for (const x of [-6, -4, -2, 0, 2, 4]) parts.push({ shape: "box", size: [.08, .95, .08], pos: [x, .65, 9.05], color: dark });   // rail along the deck's edge
  parts.push({ shape: "box", size: [10.1, .06, .06], pos: [-1, 1.1, 9.05], color: dark });
  for (const x of [-3, 3]) parts.push({ shape: "cyl", size: { r1: .12, r2: .14, h: .7, seg: 8 }, pos: [x, -.95, 12.7], color: dark });   // bollards
  const floorY = (x, z) => {
    const lv = [];
    if (Math.abs(x) <= 6.2 && z >= 3.8 && z <= 9.15) lv.push(.18);
    if (Math.abs(x) <= 4.1 && z >= 8.9 && z <= 13.1) lv.push(-1.23);
    if (Math.abs(x - 5.2) <= .8 && z >= 9.1 && z <= 13.3) lv.push(stairY(-1.23, 1.41, (13.2 - z) / 4, 4));
    if (!lv.length && Math.abs(x) <= W / 2 && Math.abs(z) <= D / 2) return .05;
    return lv.length ? lv : 0;
  };
  const quaySlots = [];   // where goods are stacked on the quay top
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) quaySlots.push([-5 + i * 2, .05, -4.6 + r * 2.2]);
  return { name, parts, footprint: [W + 2, D + 2], floorY, quaySlots,
           // the hands' way from the stage edge (where the barge's plank lands) up to the quay
           way: [[.6, -1.23, 12.8], [5.2, -1.23, 12.8], [5.2, .18, 9.5], [3.0, .18, 4.6]],
           bargeZ: 15.5 };   // the moored barge's centerline, local z
}

// A river barge, 11 x 3.5m: raked bow and stern, plank deck .6m above the
// water, gunwales, a stern cabin with the tiller, ten cargo places on
// deck, and a gangplank off the north side that lands on the stage when
// moored. Origin at the waterline amidships, forward = +x.
export function barge({ name = "Barge" } = {}) {
  const hull = 0x3e2e1e, plank = 0x7a5a36, dark = 0x4e3a24, parts = [];
  parts.push({ shape: "box", size: [11, 1.4, 3.5], pos: [0, -.1, 0], color: hull, pat: "wood", collide: false });
  parts.push({ shape: "box", size: [2.4, 1.1, 3.2], pos: [6.0, .05, 0], rot: [0, 0, 32], color: hull, pat: "wood" });    // bow, raked up
  parts.push({ shape: "box", size: [2.0, 1.1, 3.2], pos: [-6.0, .05, 0], rot: [0, 0, -28], color: hull, pat: "wood" });  // stern
  parts.push({ shape: "box", size: [10.8, .06, 3.3], pos: [0, .6, 0], color: plank, pat: "wood", collide: false });      // deck
  for (const sz of [-1, 1]) parts.push({ shape: "box", size: [11, .35, .12], pos: [0, .8, sz * 1.7], color: dark, pat: "wood" });   // gunwales
  parts.push({ shape: "box", size: [2.2, 1.5, 2.2], pos: [-4.0, 1.38, 0], color: plank, pat: "wood" });                  // cabin
  parts.push({ shape: "box", size: [2.5, .1, 2.5], pos: [-4.0, 2.18, 0], color: dark });
  parts.push({ shape: "box", size: [1.8, .08, .08], pos: [-5.6, 1.15, 0], rot: [0, 0, -20], color: dark });               // tiller
  for (const x of [-2.5, 2.5]) parts.push({ shape: "cyl", size: { r1: .1, r2: .12, h: .5, seg: 8 }, pos: [x, .85, -1.55], color: dark });   // bollards
  // (the gangplank is the demo's: hinged at the north gunwale, raised under way, lowered when moored)
  const holdSlots = [];   // cargo places on deck
  for (let i = 0; i < 10; i++) holdSlots.push([-2.5 + (i % 5) * 1.3, .63, i < 5 ? -.75 : .75]);
  return { name, parts, holdSlots, deckY: .63, halfL: 5.4, halfW: 1.7, plankEnd: [-.5, .63, -4.1] };
}

// ---- furniture --------------------------------------------------------------
// Basic pieces as part lists, origin on the floor (the chandelier hangs from
// its origin instead). Reusable anywhere: append with an offset.

// Drop a piece into a part list at (x,y,z), rotated q quarter-turns about y.
// Pieces are axis-aligned boxes, so a quarter-turn is a position swizzle plus
// swapped x/z extents -- no rotation matrices needed.
export function placeFurniture(parts, kind, x, y, z, q = 0, o) {
  for (const p of furniture(kind, o)) {
    let [px, py, pz] = p.pos, s = Array.isArray(p.size) ? [...p.size] : p.size;
    for (let k = 0; k < q; k++) { [px, pz] = [pz, -px]; if (Array.isArray(s)) s = [s[2], s[1], s[0]]; }
    parts.push({ ...p, size: s, pos: [x + px, y + py, z + pz] });
  }
}

export function furniture(kind, o = {}) {
  return furnitureParts(kind, o).map((p) => (p.color === 0x6b4a2c && !p.pat ? { ...p, pat: "wood" } : p));   // grain on every wooden piece
}
function furnitureParts(kind, o = {}) {
  const wood = 0x6b4a2c, cloth = 0x8e2f35, gold = 0xc9a13b, linen = 0xe8dfc9;
  switch (kind) {
    case "altar": return [              // stepped predella, mensa, cloth, candles, cross
      // `solid`: the mensa blocks walking like a wall (the low predella
      // steps stay walk-up-able -- they sit under the step-height band)
      { shape: "box", size: [4.6, .18, 3.4], pos: [0, .09, 0], color: 0xcfc8b8, pat: "marble" },
      { shape: "box", size: [3.6, .18, 2.6], pos: [0, .27, 0], color: 0xcfc8b8, pat: "marble" },
      { shape: "box", size: [2.4, .95, 1.15], pos: [0, .84, 0], color: 0xdfd8ca, pat: "marble", solid: true },
      { shape: "box", size: [2.6, .07, 1.3], pos: [0, 1.35, 0], color: 0xf0ead8 },
      { shape: "cyl", size: { r1: .05, r2: .07, h: .55, seg: 6 }, pos: [-.9, 1.66, -.35], color: gold },
      { shape: "cyl", size: { r1: .05, r2: .07, h: .55, seg: 6 }, pos: [.9, 1.66, -.35], color: gold },
      { shape: "box", size: [.07, .85, .07], pos: [0, 1.82, -.42], color: gold },
      { shape: "box", size: [.42, .07, .07], pos: [0, 2.02, -.42], color: gold },
    ];
    case "pew": {                       // church bench; o.len sets its width
      const L = o.len ?? 2.4;
      return [   // `solid`: benches block walking -- you go around, not through
        { shape: "box", size: [L, .07, .48], pos: [0, .47, 0], color: wood, solid: true, sit: true },
        { shape: "box", size: [L, .6, .08], pos: [0, .75, .26], color: wood, solid: true },
        { shape: "box", size: [L, .12, .4], pos: [0, .2, .02], color: wood, outline: false },
      ];
    }
    case "table": return [
      { shape: "box", size: [1.8, .08, .95], pos: [0, .75, 0], color: wood },
      ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) =>
        ({ shape: "box", size: [.09, .72, .09], pos: [a * .8, .36, b * .38], color: wood })),
    ];
    case "chair": return [
      { shape: "box", size: [.46, .07, .46], pos: [0, .46, 0], color: cloth, sit: true },
      { shape: "box", size: [.46, .55, .07], pos: [0, .77, -.2], color: wood },
      ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) =>
        ({ shape: "box", size: [.05, .44, .05], pos: [a * .19, .22, b * .19], color: wood })),
    ];
    case "wardrobe": return [
      { shape: "box", size: [1.6, 2.3, .65], pos: [0, 1.25, 0], color: wood },
      { shape: "box", size: [1.72, .14, .74], pos: [0, 2.46, 0], color: wood },
      { shape: "box", size: [.04, 1.9, .06], pos: [0, 1.2, .34], color: gold },
    ];
    case "bed": return [
      { shape: "box", size: [1.7, .35, 2.15], pos: [0, .3, 0], color: wood },
      { shape: "box", size: [1.6, .22, 2.05], pos: [0, .58, 0], color: linen, lie: true },
      { shape: "box", size: [1.7, 1.0, .09], pos: [0, .8, -1.05], color: wood },
      { shape: "box", size: [1.2, .16, .5], pos: [0, .74, -.7], color: 0xf2ece0 },
    ];
    case "sofa": return [
      { shape: "box", size: [2.1, .42, .85], pos: [0, .35, 0], color: cloth, sit: true },
      { shape: "box", size: [2.1, .55, .18], pos: [0, .82, -.33], color: cloth },
      { shape: "box", size: [.18, .38, .85], pos: [-.96, .73, 0], color: cloth },
      { shape: "box", size: [.18, .38, .85], pos: [.96, .73, 0], color: cloth },
    ];
    case "chandelier": return [
      { shape: "cyl", size: { r1: .035, r2: .035, h: 1.0, seg: 6 }, pos: [0, -.5, 0], color: gold },
      { shape: "cyl", size: { r1: .58, r2: .3, h: .28, seg: 10 }, pos: [0, -1.12, 0], color: gold },
      { shape: "cyl", size: { r1: .6, r2: .6, h: .07, seg: 10 }, pos: [0, -.96, 0], color: gold },
      { shape: "sphere", size: { r: .14 }, pos: [0, -1.35, 0], color: gold },
    ];
  }
  return [];
}

// ---- generic baroque palace -------------------------------------------------
// A plan of rectangular blocks, each a hollow three-storey shell with the
// endlessly repeated baroque bay (arched ground window, tall piano-nobile
// window between pilasters, square attic window), cornice lines, a flat roof
// behind a balustrade. Blocks connect through ground-floor doors; ramps stand
// in for the grand stairs; floors are walkable throughout.

export function baroquePalace({
  name,
  blocks,                      // {x, z, w, d, door: [[face, offset]...], ramp, plain: [faces]}
  storeys = [5.2, 7.8, 5.5],   // ground / piano nobile / attic heights
  bay = 5.5, T = 1, roomEvery = 11,
  furnish = true,
  stone = 0xdfcda4, stoneDark = 0xc3b28c, glassC = 0x39424e, gold = 0xd4a437, roofC = 0x5e6672,
  brick = 0xa2543f,            // blocks flagged `brick` wear the old chateau's red
}) {
  const parts = [];
  const lv = [0];
  for (const h of storeys) lv.push(lv[lv.length - 1] + h);
  const H = lv[storeys.length];
  const doorW = 3.4, doorH = 4.2, rampW = 2;

  // face helpers: n/s = short-z sides, e/w = short-x sides
  const FACES = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
  const faceLen = (b, f) => (f === "n" || f === "s") ? b.w : b.d;
  const at = (b, f, u, out) => {   // tangent offset u along the face, `out` from the wall centerline
    const [nx, nz] = FACES[f];
    const px = b.x + nx * (b.w / 2 - T / 2 + out * 0), pz = b.z + nz * (b.d / 2 - T / 2 + 0);
    return f === "n" || f === "s"
      ? [b.x + u, b.z + nz * (b.d / 2 - T / 2 + out)]
      : [b.x + nx * (b.w / 2 - T / 2 + out), b.z + u];
  };
  const fsz = (f, along, thick) => (f === "n" || f === "s") ? [along, thick] : [thick, along];
  const fbox = (b, f, u, out, along, h, y, thick, color, extra) => {
    const [x, z] = at(b, f, u, out);
    const [sx, sz] = fsz(f, along, thick);
    parts.push({ shape: "box", size: [sx, h, sz], pos: [x, y, z], color, ...extra });
  };

  const slabHoles = [];    // remembered for floorY
  const doorsOut = [];     // real clickable doors for every cut doorway
  const windowsOut = [];   // openable ground-floor window panes
  // Where two blocks stand face to face, the shared plane is a party wall:
  // it gets no windows (they would stare into the neighbour's masonry) and
  // no facade trim, and a passage through it is ONE doorway -- the later
  // block snaps its doorway onto the earlier block's and leaves the door
  // panel to it, so no double doors meet in the wall.
  const OPP = { n: "s", s: "n", e: "w", w: "e" };
  const contacts = (b, f) => {
    const [nx, nz] = FACES[f], out = [];
    const along = f === "n" || f === "s";
    for (const o of blocks) {
      if (o === b) continue;
      const mine = along ? b.z + nz * b.d / 2 : b.x + nx * b.w / 2;
      const theirs = along ? o.z - nz * o.d / 2 : o.x - nx * o.w / 2;
      if (Math.abs(mine - theirs) > .05) continue;
      const u0 = along ? Math.max(b.x - b.w / 2, o.x - o.w / 2) - b.x : Math.max(b.z - b.d / 2, o.z - o.d / 2) - b.z;
      const u1 = along ? Math.min(b.x + b.w / 2, o.x + o.w / 2) - b.x : Math.min(b.z + b.d / 2, o.z + o.d / 2) - b.z;
      if (u1 - u0 > .5) out.push({ u0, u1, o });
    }
    return out;
  };
  for (const b of blocks) {
    const doors = b.door ?? [];
    const plain = b.plain ?? [];
    const wallC = b.brick ? brick : stone;
    for (const f of ["n", "s", "e", "w"]) {
      const L = faceLen(b, f);
      const along = f === "n" || f === "s";
      const cts = contacts(b, f);
      const inContact = (u, half) => cts.find((c) => u + half > c.u0 - .3 && u - half < c.u1 + .3);
      const fdoors = doors.filter(([df]) => df === f).map(([, u]) => {
        const c = inContact(u, doorW / 2);
        if (!c || blocks.indexOf(c.o) > blocks.indexOf(b)) return { u, panel: true };
        const theirs = (c.o.door ?? []).filter(([df]) => df === OPP[f])
          .map(([, ou]) => along ? c.o.x + ou - b.x : c.o.z + ou - b.z);   // their doorway, in my face coordinate
        const near = theirs.find((ou) => Math.abs(ou - u) < 3.5);
        return near === undefined ? null : { u: near, panel: false };   // no doorway opposite: the passage would end in their wall
      }).filter(Boolean);
      const isPlain = plain.includes(f);
      const nb = Math.max(1, Math.round(L / bay) - 1);
      const us = (isPlain ? [] : (nb === 1 ? [0] : linspace(-(L / 2 - bay * .8), L / 2 - bay * .8, nb)))
        .filter((u) => !inContact(u, 1.3));
      // one wall per face with every opening truly cut out (doors + windows),
      // then thin translucent panes in the window openings
      const wins = [];
      for (const u of us) for (const [wy, ww, wh] of [[1.15, 1.7, 3.6], [lv[1] + 1, 1.9, 4.8], [lv[2] + .9, 1.4, 2.1]]) {   // ground sills at 1.15m: reachable with a jump
        if (wy < lv[1] && fdoors.some((d) => Math.abs(u - d.u) < doorW / 2 + 1.2)) continue;
        wins.push([u, wy, ww, wh]);
      }
      const [wx, wz] = at(b, f, 0, 0);
      parts.push({ shape: "hwall", size: { w: L, h: H, t: T, holes: [...fdoors.map((d) => [d.u, 0, doorW, doorH]), ...wins] },
                   pos: [wx, 0, wz], rot: (f === "e" || f === "w") ? [0, -90, 0] : null, color: wallC, pat: b.brick ? "brick" : "ashlar" });
      for (const d of fdoors) {
        if (!d.panel) continue;
        const [dxw, dzw] = at(b, f, d.u, 0);
        doorsOut.push({ x: dxw, z: dzw, w: doorW, h: doorH, yaw: (f === "e" || f === "w") ? 90 : 0 });
      }
      for (const [u, wy, ww, wh] of wins) {   // every window is a DYNAMIC openable pane
        const [px, pz] = at(b, f, u, 0);
        windowsOut.push({ x: px, z: pz, y: wy + wh / 2, w: ww + .15, h: wh + .15,
                          yaw: (f === "e" || f === "w") ? 90 : 0 });
      }
      if (isPlain) continue;
      for (const u of us) {
        if (b.gilt) {   // gilded lintel and sill on the piano nobile windows
          fbox(b, f, u, T / 2 + .18, 2.3, .18, lv[1] + 6.05, .14, gold, { outline: false });
          fbox(b, f, u, T / 2 + .18, 2.3, .14, lv[1] + .85, .14, gold, { outline: false });
        }
        if (u !== us[us.length - 1]) {
          fbox(b, f, u + bay / 2, T / 2 + .12, .55, storeys[1] - .6, lv[1] + storeys[1] / 2, .3, stone, { outline: false });
          fbox(b, f, u + bay / 2, .1, .16, .85, H + .5, .16, stone, { outline: false });   // balustrade post
        }
      }
      for (const y of [lv[1], lv[2]]) fbox(b, f, 0, .25, L + .4, .5, y, T + .5,
        b === blocks[0] && y === lv[2] ? gold : stoneDark);
      fbox(b, f, 0, .25, L + .4, .6, H, T + .5, stoneDark);           // crowning cornice
      fbox(b, f, 0, .1, L + .3, .18, H + .95, .2, b.gilt ? gold : stone, { outline: false });   // balustrade rail
    }
    // roof and interior floors
    parts.push({ shape: "box", size: [b.w, .4, b.d], pos: [b.x, H + .2, b.z], color: roofC });
    parts.push({ shape: "box", size: [b.w - 2 * T, .12, b.d - 2 * T], pos: [b.x, H - .07, b.z], color: 0x8a6a48, pat: "wood" });   // boarded attic ceiling
    const FLOOR0 = { color: 0xd8d0be, pat: "checker", accent: 0x8a8070 };   // marble flags downstairs
    const FLOOR1 = { color: 0x9c6b3e, pat: "parquet" };                       // parquet on the upper floors
    parts.push({ shape: "box", size: [b.w - 2 * T, .2, b.d - 2 * T], pos: [b.x, .1, b.z], ...FLOOR0 });
    const zR0 = b.z + b.d / 2 - 2.6, zR1 = b.z - b.d / 2 + 2.6, run = zR0 - zR1;
    const rampX = [b.x - b.w / 2 + T + 1.3, b.x + b.w / 2 - T - 1.3];
    for (let s = 1; s <= 2; s++) {
      const y = lv[s] + .15;
      if (!b.ramp) { parts.push({ shape: "box", size: [b.w - 2 * T, .3, b.d - 2 * T], pos: [b.x, y, b.z], ...FLOOR1 }); continue; }
      // slab with a stairwell hole over the arriving flight
      const side = s - 1, hx = rampX[side];
      const hz0 = side === 0 ? zR1 : zR0 - run * .5, hz1 = side === 0 ? zR1 + run * .5 : zR0;   // headroom for a 2m walker
      const x0 = hx - rampW / 2 - .2, x1 = hx + rampW / 2 + .2;
      const iw0 = b.x - b.w / 2 + T, iw1 = b.x + b.w / 2 - T, id0 = b.z - b.d / 2 + T, id1 = b.z + b.d / 2 - T;
      parts.push({ shape: "box", size: [x0 - iw0, .3, id1 - id0], pos: [(x0 + iw0) / 2, y, b.z], ...FLOOR1 });
      parts.push({ shape: "box", size: [iw1 - x1, .3, id1 - id0], pos: [(x1 + iw1) / 2, y, b.z], ...FLOOR1 });
      parts.push({ shape: "box", size: [x1 - x0, .3, hz0 - id0], pos: [(x0 + x1) / 2, y, (hz0 + id0) / 2], ...FLOOR1 });
      parts.push({ shape: "box", size: [x1 - x0, .3, id1 - hz1], pos: [(x0 + x1) / 2, y, (hz1 + id1) / 2], ...FLOOR1 });
      slabHoles.push({ b, level: lv[s] + .3, hx, hz0, hz1 });
      wellRail(parts, { x0, x1, z0: hz0, z1: hz1, y: y + .15, side: side === 0 ? 1 : -1, landAt: side === 0 ? "z0" : "z1" });
      // the flight itself: a real staircase
      const rise = s === 1 ? lv[1] + .1 : storeys[1];
      const y0f = s === 1 ? .2 : lv[1] + .3;
      stairSteps(parts, { x: hx, w: rampW, y0: y0f, rise, rail: side === 0 ? 1 : -1,
                          z0: side === 0 ? zR0 : zR1, z1: side === 0 ? zR1 : zR0, color: stoneDark });
    }

    // interior partitions: rooms along the long axis with an enfilade of
    // aligned doorways; `gallery` keeps the piano nobile's garden half as
    // one long hall behind a doored longitudinal wall
    const longX = b.w >= b.d;
    const pT = .4, pdW = 2.4;
    // partitions are paneled: marble-lined downstairs, ornament lattice
    // (gilded in the gilt blocks) on the piano nobile
    const PANEL0 = { color: 0xe6dcc6, pat: "marble" };
    const PANEL1 = { color: 0xe9e0cc, pat: "ornament", accent: b.gilt ? gold : 0xcdbfa2 };
    const axisLen = longX ? b.w : b.d;
    const p0 = (longX ? b.x : b.z) - axisLen / 2;
    const nRooms = Math.floor(axisLen / roomEvery);
    const pwall = (pos, y0p, hgt, s0, s1, doorU) => {
      const PANEL = y0p < lv[1] ? PANEL0 : PANEL1;
      const mk = (a2, b2) => b2 - a2 > .25 && parts.push(longX
        ? { shape: "box", size: [pT, hgt, b2 - a2], pos: [pos, y0p + hgt / 2, (a2 + b2) / 2], ...PANEL }
        : { shape: "box", size: [b2 - a2, hgt, pT], pos: [(a2 + b2) / 2, y0p + hgt / 2, pos], ...PANEL });
      mk(s0, doorU - pdW / 2); mk(doorU + pdW / 2, s1);
      const lh = hgt - 3.2;
      if (lh > .1) parts.push(longX
        ? { shape: "box", size: [pT, lh, pdW], pos: [pos, y0p + 3.2 + lh / 2, doorU], ...PANEL }
        : { shape: "box", size: [pdW, lh, pT], pos: [doorU, y0p + 3.2 + lh / 2, pos], ...PANEL });
    };
    const s0 = (longX ? b.z - b.d / 2 : b.x - b.w / 2) + T;
    const s1 = (longX ? b.z + b.d / 2 : b.x + b.w / 2) - T;
    for (let i = 1; i < nRooms; i++) {
      const pos = p0 + i * roomEvery;
      if (b.ramp && rampX.some((rx) => Math.abs(pos - rx) < 2.8)) continue;
      pwall(pos, .2, lv[1] - .2, s0, s1, s0 + 2);
      if (b.gallery) pwall(pos, lv[1] + .3, storeys[1] - .3, b.z + 1.7, s1, b.z + 3.2);
      else pwall(pos, lv[1] + .3, storeys[1] - .3, s0, s1, s0 + 2);
    }
    if (b.gallery) {
      const gz = b.z + 1.5, gy = lv[1] + .3, gh = storeys[1] - .3;
      let xa = b.x - b.w / 2 + T + 3.2;
      const xbEnd = b.x + b.w / 2 - T - 3.2;
      for (let i = 0; i < nRooms; i++) {
        const dx2 = p0 + (i + .5) * roomEvery;
        if (dx2 - 1.2 - xa > .3) parts.push({ shape: "box", size: [dx2 - 1.2 - xa, gh, pT], pos: [(xa + dx2 - 1.2) / 2, gy + gh / 2, gz], ...PANEL1 });
        parts.push({ shape: "box", size: [2.4, gh - 3.2, pT], pos: [dx2, gy + 3.2 + (gh - 3.2) / 2, gz], ...PANEL1 });
        xa = dx2 + 1.2;
      }
      if (xbEnd - xa > .3) parts.push({ shape: "box", size: [xbEnd - xa, gh, pT], pos: [(xa + xbEnd) / 2, gy + gh / 2, gz], ...PANEL1 });
    }
  }

  // furnishings: chandeliers and salon groups in the first block's piano
  // nobile, bedrooms along the outer blocks' ground floors
  if (furnish && blocks.length) {
    const addF = (kind, x, y, z, q = 0) => placeFurniture(parts, kind, x, y, z, q);
    const b0 = blocks[0];
    const nR0 = Math.floor(b0.w / roomEvery);
    for (let i = 0; i < nR0; i++) {
      const rc = b0.x - b0.w / 2 + (i + .5) * roomEvery;   // room centers, clear of partitions
      addF("chandelier", rc, lv[2] - .05, b0.z - 4);       // gallery lane on the garden side
      addF("chandelier", rc, lv[1] - .05, b0.z);
      if (i % 2 === 0) {
        addF("table", rc, lv[1] + .3, b0.z - 4);
        addF("chair", rc - 1.5, lv[1] + .3, b0.z - 4, 1);
        addF("chair", rc + 1.5, lv[1] + .3, b0.z - 4, 3);
        addF("sofa", rc, lv[1] + .3, b0.z - 7, 2);
      }
    }
    for (const bw of blocks.slice(3)) {
      const nRw = Math.floor(bw.w / roomEvery);
      for (let i = 0; i < nRw; i += 2) {
        const rc = bw.x - bw.w / 2 + (i + .5) * roomEvery;
        addF("bed", rc, .2, bw.z + 1.5, 0);
        addF("wardrobe", rc + 3, .2, bw.z - bw.d / 2 + T + .45, 0);
      }
    }
  }

  const walk1 = lv[1] + .3, walk2 = lv[2] + .3;
  const floorY = (x, z) => {
    for (const b of blocks) {
      if (Math.abs(x - b.x) > b.w / 2 + .5 || Math.abs(z - b.z) > b.d / 2 + .5) continue;
      const out = [.2];
      for (const s of [1, 2]) {
        const level = s === 1 ? walk1 : walk2;
        const hole = slabHoles.find((hh) => hh.b === b && hh.level === level);
        if (!(hole && Math.abs(x - hole.hx) <= rampW / 2 + .2 && z >= hole.hz0 && z <= hole.hz1)) out.push(level);
      }
      if (b.ramp) {
        const zR0 = b.z + b.d / 2 - 2.6, zR1 = b.z - b.d / 2 + 2.6, run = zR0 - zR1;
        const rampX = [b.x - b.w / 2 + T + 1.3, b.x + b.w / 2 - T - 1.3];
        for (const s of [0, 1]) {
          if (Math.abs(x - rampX[s]) > rampW / 2 + .1) continue;
          const t = s === 0 ? (zR0 - z) / run : (z - zR1) / run;
          if (t >= 0 && t <= 1) out.push(s === 0 ? stairY(.2, walk1 - .2, t, run) : stairY(walk1, walk2 - walk1, t, run));
        }
      }
      return out;
    }
    return 0;
  };

  const xs = blocks.flatMap((b) => [b.x - b.w / 2, b.x + b.w / 2]);
  const zs = blocks.flatMap((b) => [b.z - b.d / 2, b.z + b.d / 2]);
  const cobwebs = blocks.slice(3).flatMap((b) => [   // the outer wings' ground-floor corners
    { x: b.x - b.w / 2 + T, y: lv[1], z: b.z - b.d / 2 + T, sx: 1, sz: 1, d: .8 }, { x: b.x + b.w / 2 - T, y: lv[1], z: b.z + b.d / 2 - T, sx: -1, sz: -1, d: .7 }]);
  return { name, parts, footprint: [Math.max(...xs) - Math.min(...xs) + 2, Math.max(...zs) - Math.min(...zs) + 2], floorY, doors: doorsOut, windows: windowsOut, cobwebs };
}

// ---- the catalogue --------------------------------------------------------

export const BUILDINGS = {
  // a village water mill (placed by the demo on the river bank, not in the facade row)
  watermill: watermill(),
  tavern: tavern(),
  landing: landing(),
  // Temple of Hephaestus, Athens (~449 BC). Doric peripteral, 6 x 13 columns,
  // stylobate 13.71 x 31.78m, columns 5.71m tall, ~10m to the ridge.
  hephaestus: greekTemple({
    name: "Temple of Hephaestus",
    width: 13.71, length: 31.78,
    columnsFront: 6, columnsSide: 13,
    columnH: 5.71, columnD: 1.02,
    entablatureH: 1.68, pedimentH: 1.7,
    paint: GREEK_PAINT.festival,
  }),
  // Parthenon, Athens (447-432 BC). Doric octastyle, 8 x 17 columns (46, like
  // the original), stylobate 30.88 x 69.5m, columns 10.43m, famously oversized
  // 0.55m steps, ~15.7m to the ridge. Pentelic marble reads a touch warmer.
  parthenon: greekTemple({
    name: "Parthenon",
    width: 30.88, length: 69.5,
    columnsFront: 8, columnsSide: 17,
    columnH: 10.43, columnD: 1.91,
    steps: 3, stepH: .5, stepOut: .7,   // real: .55m -- trimmed to stay under the .5m climb limit

    entablatureH: 3.29, pedimentH: 3.5,
    stone: 0xded8c6, stoneDark: 0xc9c0ac, stoneShadow: 0xafa691,
    paint: GREEK_PAINT.aegean,
  }),
  // Palace of Versailles, garden front and court (simplified plan, real
  // scale): 100m corps central flanked by 115m wings on a continuous ~330m
  // garden facade, court arms embracing the Cour Royale, three storeys
  // (ground, piano nobile, attic) to a balustraded flat roofline at ~18.5m.
  // The court opens toward +z; enter there or from the garden side.
  versailles: baroquePalace({
    name: "Palace of Versailles",
    blocks: [
      { x: 0, z: -21, w: 100, d: 24, ramp: true, gallery: true, gilt: true,
        door: [["s", 0], ["s", -41], ["s", 41], ["n", 0], ["w", -1.5], ["e", -1.5]] },
      { x: -41, z: 12, w: 18, d: 42, brick: true, gilt: true, door: [["e", 0], ["n", 0]], plain: ["n"] },
      { x: 41, z: 12, w: 18, d: 42, brick: true, gilt: true, door: [["w", 0], ["n", 0]], plain: ["n"] },
      { x: -107.5, z: -22.5, w: 115, d: 21, ramp: true, door: [["s", 0], ["e", 0]], plain: ["e"] },
      { x: 107.5, z: -22.5, w: 115, d: 21, ramp: true, door: [["s", 0], ["w", 0]], plain: ["w"] },
    ],
  }),
  // Temple of Hathor, Dendera (Ptolemaic, ~54 BC). Pronaos of six Hathor
  // columns behind screen walls, 24-column hypostyle in four rows, the lower
  // inner temple with its naos. ~81m long, facade ~34m wide, ~17m tall.
  dendera: egyptianTemple({
    name: "Temple of Hathor, Dendera",
    width: 34, length: 81,
    hallH: 17, columnH: 15,
    colsFront: 6, hypoRows: 4,
    innerH: 12,
  }),
  // Generic medieval townhouses in two sizes -- parameters, not landmarks.
  house: medievalHouse({ name: "Town House" }),
  bighouse: medievalHouse({ name: "Merchant House", width: 9, depth: 12, storeys: 3 }),
  windmill: windmill({}),
  caerphilly: englishCastle({}),
  // Temple of Apollo, Didyma (begun ~300 BC). Dipteral: a DOUBLE ring of
  // columns, 10 x 21 in each, nearly 20m tall on a seven-step platform --
  // and hypaethral: the huge adyton court stood open to the sky.
  didyma: greekTemple({
    name: "Temple of Apollo, Didyma",
    width: 51.13, length: 109.34,
    columnsFront: 10, columnsSide: 21,
    columnH: 19.7, columnD: 1.98,
    steps: 7, stepH: .45, stepOut: .45,
    entablatureH: 4.3,
    colonnadeRows: 2, roof: false,
    stone: 0xd6cfc0, stoneDark: 0xc2baa9, stoneShadow: 0xa39a87,
  }),
  // Colosseum, Rome (80 AD), as built. Ellipse 189 x 156m, ~48m tall:
  // three arcade stories plus the attic. Travertine.
  colosseum: romanAmphitheatre({
    name: "Colosseum",
    outerA: 94.5, outerB: 78,
    stories: 3, storyH: 10.7, atticH: 13.5,
    arches: 40,
  }),
  // Cologne Cathedral (completed form, 1880). 144.5m long, twin 157m west
  // spires, great roof ridge at 61m. The famously darkened grey stone.
  cologne: gothicCathedral({
    name: "Cologne Cathedral",
    length: 144.5, bodyW: 45,
    naveW: 14, naveH: 42, ridgeH: 61, aisleH: 19, aisles: 5, aisleH2: 21.5,   // five-aisled: four pier rows inside
    towerW: 22, towerH: 100, spireH: 57,
    transeptW: 86, transeptD: 20, transeptZ: -20,
    stone: 0x6f6a60, stoneDark: 0x5a554c, roofC: 0x4f5654,   // the soot-blackened grey it is famous for
  }),
  // Notre-Dame de Paris (with Viollet-le-Duc's fleche). 128m long, flat-topped
  // 69m twin towers, ridge at 43m, fleche to ~96m. Paler Lutetian limestone,
  // lead-grey roof.
  notredame: gothicCathedral({
    name: "Notre-Dame de Paris",
    length: 128, bodyW: 40,
    naveW: 13, naveH: 34, ridgeH: 43, aisleH: 14, aisles: 5, aisleH2: 16.5,   // five-aisled double ambulatory plan
    towerW: 15, towerH: 69, spireH: 0,
    transeptW: 48, transeptD: 14, transeptZ: 5,
    flecheH: 48,
    stone: 0xc3bba8, stoneDark: 0xa79f8d, roofC: 0x6d7a80,
  }),
  // Milan Cathedral. No west towers: a wide gable marble facade, a forest of
  // pinnacles along the flanks, and the Madonnina spire to 108.5m over the
  // crossing. 158.6m long, transept 92m.
  milan: gothicCathedral({
    name: "Milan Cathedral",
    length: 158.6, bodyW: 66,
    naveW: 19, naveH: 38, ridgeH: 45, aisleH: 22, aisles: 5, aisleH2: 30,   // the famously steep five-aisle step-up
    towers: false,
    transeptW: 92, transeptD: 22, transeptZ: -15,
    flecheH: 58, pinnacleEvery: 9,
    // bright white-pink Candoglia marble, roof terraces of the same stone
    stone: 0xeae4d9, stoneDark: 0xd8d0c3, roofC: 0xe1dacd,
  }),
};
