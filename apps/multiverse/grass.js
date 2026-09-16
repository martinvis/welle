// GRASS -- two halves of one thing, sharing one wind.
//
// 1. BLADES IN THE TILE (textures.js, the ground's overlay in index.html): three tiles of the same blades
//    leaning three ways, the ground blending the two that bracket the wind where it stands. That draws the
//    lawn itself -- everything below the horizon of a blade -- for one extra texture sample and no geometry.
//    What a texture cannot do is stand UP: no blade ever rises over the cart parked in the grass, or breaks
//    the skyline.
//
// 2. THE FRINGE (this module): one pass after the world, which does exactly that. For each pixel it looks a
//    few pixels DOWN; if it finds visible ground there, a stalk rooted in that ground may reach up this far,
//    and the pixel is painted the colour of a blade. That is right far more often than it sounds, because on
//    a ground plane seen from above, DOWN THE SCREEN IS NEARER: grass found below a cart is grass in front of
//    the cart, and a stalk rising over its wheels is what really happens. The one case that inverts -- a far
//    lawn seen below a near ridge -- is settled by perspective, which we want anyway: a stalk's height in
//    PIXELS is its height in metres over the distance of the ground it grows from, so far grass fringes
//    shrink to nothing.
//
// It costs one small pass (the world's depth, then the ground alone, at a fraction of the canvas) and one
// blended full-screen quad that takes a handful of taps. It needs no copy of the frame: the only depth it
// reads is the GROUND's, which its own pass writes.
//
// The mask: R = the ground's elevation GRADE where grass is visible (so a stalk is the colour of the lawn it
// rises from), GB = that ground's distance from the eye (16-bit, over uFar), A = what may happen here:
//   0 nothing may be painted (too high off the ground, or sky) . 0.5 paintable, but not grass . 1 grass.
// depth-tested against the world, so ground hidden behind a building grows nothing over it. A is the one bit
// that says whether this pixel's own surface may be painted over at all: a stalk reaches a hand's breadth off
// the ground, so it may cover a cart's wheel or a wall's footing but never climb them. The bit is cleared to
// 1 (paintable) and only the world's occluders write 0, where they stand higher than a stalk reaches -- so
// the SDF figures, which cannot go through an override material, keep the grass over their boots. The height
// needs no terrain lookup: a building, a cart, a barrel is placed with its base on the ground, so the mesh's
// own LOCAL Y is already its height above it.
import * as THREE from "three";
import { OCC_LAYER, onSecondaryView } from "./composite.js";

export const FRINGE = { on: true, scale: .5, height: .20, cells: 50, cover: .30, fade: 32, bladePx: 1.6, debug: false };
// height: a stalk's reach in metres (.20 = knee-high meadow). cells: roots per metre, and a blade is one cell
// wide -- 50 is 2cm, about three pixels at four metres. cover: the share of roots that grow one.
// fade: the metres by which the fringe is gone -- past a few metres a blade falls under a pixel and a per-pixel
// decision would shimmer, and it has nothing to do out there: the tile's own blades carry the far field, and they
// are mipmapped, which is what keeps distance quiet. debug: ?fringe=mask / ?fringe=raw show the mask itself.
export const GRASS_LAYER = 4;    // the ground opts in (index.html); the world's occluders sit on OCC_LAYER
export const NOGRASS_LAYER = 5;  // flat things laid ON the ground that are not grass -- a track, a yard: they hide the
                                 // ground under them from the mask, so nothing grows through them. They draw with their
                                 // OWN material (MASK_MODE tells it to write the mask instead of its colour), because
                                 // what is really path and what is the ragged edge beside it is that shader's own business.
export const MASK_MODE = { value: 0 };

// Anything SOLID that stands on the ground opts in with this: its depth hides the ground under it from the
// mask (so nothing grows through a floor or a deck), and its own local Y -- the height above its base, since
// props are placed base-on-ground -- says which of its pixels a stalk may still cover. Only real surfaces:
// never an SDF figure (its shader writes its own gl_FragDepth, so an override material would give back its
// whole quad), never a leaf card or anything else whose shape lives in a discard, and never glass.
export function markGroundProp(obj) {
  obj.traverse((o) => {
    const m = o.material, clear = Array.isArray(m) ? m.some((x) => x.transparent || x.alphaTest > 0) : (m?.transparent || m?.alphaTest > 0);
    if (o.isMesh && !clear && !o.userData.sdf && !o.userData.cut) o.layers.enable(OCC_LAYER);
  });
}

// THE COLOUR OF GRASS, one definition for both halves. The ground is graded by elevation (lush valleys, dry
// crests) with faint contour bands; a blade is that same colour, darker at its root and catching the light at its
// tip. The fringe must use exactly this or its stalks would be a different green from the lawn they rise out of,
// and the seam where they fade out would show. GRADE's numbers are shared with the CPU that colours the ground's
// vertices (index.html), so the two cannot drift.
export const GRADE = { lo: 0x527e43, mid: 0x7fa864, hi: 0xa6b264, span: 9.6, band: 1.1 };
const hex = (h) => `vec3(${(h >> 16 & 255) / 255}, ${(h >> 8 & 255) / 255}, ${(h & 255) / 255})`;
export const GRASS_COLOR_GLSL = /* glsl */ `
  float grassGrade(float y) { return clamp(y / ${GRADE.span.toFixed(2)} + .5, 0.0, 1.0); }   // 0 lush .. 1 dry
  vec3 grassGround(float t, float band, float mottle) {   // (mottle, not the obvious name: that one is reserved in GLSL ES 3.00)
    vec3 c = t < .5 ? mix(${hex(GRADE.lo)}, ${hex(GRADE.mid)}, t * 2.0) : mix(${hex(GRADE.mid)}, ${hex(GRADE.hi)}, (t - .5) * 2.0);
    return c * (band > .5 ? 1.05 : .96) * (.94 + .09 * mottle);
  }
  // a blade over the ground it grows from: dark at the root, catching the light at the tip, its own tone
  vec3 grassBlade(vec3 base, float tip, float tone) {
    return base * mix(vec3(.6, .74, .5), vec3(1.26, 1.28, 1.02), tip) * (.88 + .24 * tone);
  }
`;

// The WIND, one definition for both halves: two slow waves crossing the meadow, so gusts travel over it
// instead of the whole field pulsing. -1 bent one way .. +1 the other, at a world point and a time.
export const GRASS_WIND_GLSL = /* glsl */ `
  float grassWind(vec2 p, float t) {
    return sin(dot(p, vec2(.31, .95)) * .35 - t * 1.35) + .5 * sin(dot(p, vec2(-.8, .6)) * .17 - t * .85)
         + .35 * sin(dot(p, vec2(.62, -.78)) * .9 - t * 2.4);   // a third, quicker ripple: a gust with texture, not just a swell
  }
`;

const MASK_VERT = /* glsl */ `
  varying vec3 vWp;
  varying float vDist;   // view DEPTH (-z), not the radial distance: it is what the projection and gl_FragDepth both use
  varying float vUp;
  void main() {
    vUp = position.y;            // local: a prop stands with its base on the ground, so this IS its height above it
    vec4 p = vec4(position, 1.0);
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;    // (a building's repeated pieces are InstancedMesh copies -- architecture.js buildInstanced)
    #endif
    vec4 wp = modelMatrix * p;
    vWp = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vDist = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
// the occluders: nothing but that one bit -- 0 where they stand higher than a stalk can reach
const HIGH_FRAG = /* glsl */ `
  precision highp float;
  uniform float uHeight;
  varying float vUp;
  void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, vUp > uHeight ? 0.0 : .5); }`;   // .5: not grass, but low enough for a stalk to cross
// what the mask stores: is this grass, and how far away is it
const MASK_FRAG = /* glsl */ `
  precision highp float;
  ${GRASS_COLOR_GLSL}
  uniform float uFar, uWater;
  varying vec3 vWp;
  varying float vDist;
  varying float vUp;
  void main() {
    if (vWp.y < uWater + .02) discard;                    // no stalks out of the water
    float d = clamp(vDist / uFar, 0.0, 1.0);
    gl_FragColor = vec4(grassGrade(vWp.y), floor(d * 255.0) / 255.0, fract(d * 255.0), 1.0);
  }`;

// The fringe itself: walk down, find the ground, ask whether a stalk rooted there reaches this high.
const FRINGE_FRAG = /* glsl */ `
  precision highp float;
  out vec4 fragColor;
  uniform sampler2D uMask;
  uniform vec2 uRes, uMaskRes;
  uniform float uFar, uT, uPxPerM, uHeight, uCells, uCover, uDebug, uP22, uP32, uFade, uBladePx;
  uniform mat4 uInvProj, uInvView;
  uniform vec3 uEye;
  ${GRASS_WIND_GLSL}
  ${GRASS_COLOR_GLSL}
  float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec2 uv = gl_FragCoord.xy / uRes;
    if (uDebug > 1.5) { fragColor = vec4(texture(uMask, uv).rgb, 1.0); gl_FragDepth = 0.0; return; }
    if (uDebug > .5) { vec4 m = texture(uMask, uv); fragColor = vec4(m.a < .5 ? 1.0 : 0.0, m.r, 0.0, 1.0); gl_FragDepth = 0.0; return; }
    if (texture(uMask, uv).a < .25) discard;   // its own surface stands higher off the ground than a stalk reaches
    float stepUv = 1.0 / uMaskRes.y, stepPx = uRes.y / uMaskRes.y;
    // every step down is NEARER ground, so its stalks are taller: a step that grows nothing never ends the
    // search -- only a stalk that covers this pixel does
    for (int k = 1; k <= 10; k++) {
      float kk = float(k), off = kk * (1.0 + kk * .22);   // 1, 3, 5, 7, 10, 14, 18, 22, 27, 32 texels down
      vec2 s = uv - vec2(0.0, off * stepUv);
      if (s.y < 0.0) break;
      vec4 m = texture(uMask, s);
      if (m.a < .75) continue;   // not grass (a track, a roof, the sky): no stalk is rooted there
      float zv = -(m.g + m.b / 255.0) * uFar;                  // the root's view depth (negative, into the screen)
      float hPx = uHeight * uPxPerM / -zv;                     // its tallest stalk, in pixels: far grass is short
      float near = 1.0 - smoothstep(uFade * .55, uFade, -zv);   // gone by uFade metres (the tile's blades take over)
      if (near < .02) continue;
      float upPx = off * stepPx;
      if (upPx > hPx) continue;
      // the root in the world, so a stalk is anchored there and does not swim when the camera moves
      // the DEPTH comes from the mask texel below us, the sideways position from this pixel's own column: which
      // blade grows where is decided per screen pixel, so a blade can be one pixel wide instead of the mask's two
      vec4 h = uInvProj * vec4(vec2(uv.x, s.y) * 2.0 - 1.0, -1.0, 1.0);
      vec3 dv = normalize(h.xyz / h.w);
      vec3 gp = (uInvView * vec4(dv * (zv / dv.z), 1.0)).xyz;
      float t = upPx / max(hPx, .001);                          // 0 at the root .. 1 at the tallest reach
      float wind = grassWind(gp.xz, uT);
      // WIND: the blades LEAN with the gust, and the higher up the blade you are the further it has swung --
      // so the pattern of roots is looked up shifted along the wind by t, which bends the whole field in waves
      // the blade LEANS: the further up it you are the further it has swung, so the root stays planted while the
      // tip travels. Its identity comes from the ROOT cell, so a gust bends each blade instead of reshuffling them.
      vec2 lean = vec2(.31, .95) * (wind * .22 * t * t);
      // and no blade is ever drawn thinner than uBladePx: the root grid coarsens with distance to hold that, which
      // is what lets the fringe reach far without boiling (a 2cm blade is half a pixel at 30m). Same idea as a mip.
      float cells = min(uCells, uPxPerM / (max(-zv, .5) * uBladePx));
      vec2 cell = floor((gp.xz + lean) * cells);
      float r1 = gHash(cell), r2 = gHash(cell + 19.0), r3 = gHash(cell + 41.0);
      if (r1 > uCover) continue;
      float tall = (.45 + .75 * r2) * (1.0 - .32 * abs(wind));  // a blade bows lower the harder the gust leans it
      if (t > tall) continue;
      float f = t / tall;
      // the lawn's OWN colour at that spot -- graded by elevation, banded, patched, exactly as the ground shades
      // itself -- then bladed. That is what makes the stalks and the lawn behind them one field.
      vec3 base = grassGround(m.r, mod(floor(gp.y / ${GRADE.band}), 2.0), gHash(floor(gp.xz * 1.4) + 9.0));
      vec3 col = grassBlade(base, f, r3) * (1.0 + .06 * wind);
      fragColor = vec4(col, min(1.0, (1.0 - f * f) * 2.2) * near);
      // ITS OWN DEPTH: the stalk stands at its root (a hand's breadth of lean toward the eye at the tip), so the
      // world's z-buffer decides what covers it. A figure, a tree, a cart in front of the root hides the stalk;
      // ground nearer than them grows over their feet. No proxy, no box, no rectangle cut out of the field.
      float zs = zv + uHeight * f;
      gl_FragDepth = .5 + .5 * (uP22 * zs + uP32) / -zs;
      return;
    }
    discard;
  }`;
// The figures need nothing of their own. The fringe writes its OWN depth (its root's), so the world's z-buffer
// decides what covers it: a pig, a tree, a cart in front of a stalk's root hides it, and ground nearer than they
// are grows over their feet. That also settles the phantom ground -- lawn recorded BEHIND a figure is farther
// than the figure, so its stalks fail the depth test instead of climbing it. No proxy, no box, no bald rectangle.

// The pass. update() runs before the world is drawn (it needs the camera, nothing else);
// the quad rides in the scene, drawn after everything.
export function createGrassFringe() {
  const maskMat = new THREE.ShaderMaterial({
    uniforms: { uFar: { value: 500 }, uWater: { value: -1e9 } },
    vertexShader: MASK_VERT, fragmentShader: MASK_FRAG, depthWrite: false,
  });
  // the world's occluders: their depth, and the one bit saying how high off the ground each pixel of them is
  const highMat = new THREE.ShaderMaterial({ uniforms: { uHeight: { value: FRINGE.height } }, vertexShader: MASK_VERT, fragmentShader: HIGH_FRAG });
  const U = {
    uMask: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uMaskRes: { value: new THREE.Vector2(1, 1) },
    uFar: { value: 500 }, uT: { value: 0 }, uPxPerM: { value: 800 }, uHeight: { value: FRINGE.height },
    uCells: { value: FRINGE.cells }, uCover: { value: FRINGE.cover }, uDebug: { value: 0 },
    uP22: { value: 0 }, uP32: { value: 0 }, uFade: { value: FRINGE.fade }, uBladePx: { value: FRINGE.bladePx },   // the projection's depth row: the stalk writes its own gl_FragDepth from it
    uInvProj: { value: new THREE.Matrix4() }, uInvView: { value: new THREE.Matrix4() }, uEye: { value: new THREE.Vector3() },
  };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: U, vertexShader: `void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: FRINGE_FRAG,
    glslVersion: THREE.GLSL3,
    transparent: true, depthTest: true, depthWrite: false,   // it writes its OWN depth: the world covers it wherever the world is in front
  }));
  quad.frustumCulled = false;
  quad.renderOrder = 9999;   // after the world: it paints over what the stalks stand in front of
  quad.visible = FRINGE.on;
  let rt = null, size = new THREE.Vector2(), secondary = false, kids = -1;
  const _clear = new THREE.Color();
  // a mirror's or a painting's view is a different camera: the mask belongs to the main one, so the fringe sits out
  onSecondaryView((on) => { secondary = on; quad.visible = FRINGE.on && !on; });

  return {
    quad,
    // before the world: the ground's own mask (its depth tested against the world, so hidden ground grows nothing)
    update(renderer, scene, camera, t, waterLevel = -1e9) {
      quad.visible = FRINGE.on && !secondary;
      if (!FRINGE.on) return;
      // EVERY solid thing in the world is an occluder, not a list of the ones somebody remembered to mark: a wall
      // the mask cannot see is a wall the ground shows through, and then the grass climbs it to the roof (each of
      // its pixels finds "grass" one texel below and paints, all the way up). Re-run whenever the scene gains or
      // loses something; markGroundProp itself skips glass, cut-out cards and the SDF figures.
      if (scene.children.length !== kids) { kids = scene.children.length; markGroundProp(scene); }
      renderer.getDrawingBufferSize(size);
      const w = Math.max(8, Math.round(size.x * FRINGE.scale)), h = Math.max(8, Math.round(size.y * FRINGE.scale));
      if (!rt || rt.width !== w || rt.height !== h) {
        if (rt) rt.dispose();
        rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
        U.uMask.value = rt.texture;
      }
      maskMat.uniforms.uFar.value = U.uFar.value = camera.far;
      maskMat.uniforms.uWater.value = waterLevel;
      const mask = camera.layers.mask, over = scene.overrideMaterial, tgt = renderer.getRenderTarget();
      const cc = renderer.getClearColor(_clear).clone(), ca = renderer.getClearAlpha(), auto = renderer.autoClear;
      const bg = scene.background;
      // The mask is built in four draws into ONE buffer. Two things would otherwise wipe it between them:
      // autoClear, and -- less obviously -- scene.background, which three paints over the target at the start of
      // EVERY render(), autoClear or not (WebGLBackground forces a clear when the background is a colour). With the
      // sky's blue left in, the mask read .62 in red wherever nothing was drawn, and .62 is over the "this is grass"
      // threshold: the mask called the sky, and every wall and roof in front of it, grass -- which is exactly what
      // put stalks up the walls. It is also why the occluder depth never survived to hide anything.
      scene.background = null;
      renderer.autoClear = false;
      renderer.setRenderTarget(rt);
      renderer.setClearColor(0x000000, 0);   // black: R < .5 is "no ground" (the sky's own clear colour would read as ground everywhere)
      renderer.clear(true, true, false);
      // 1. the world that can HIDE grass, depth only (the same layer the occlusion cull uses: the buildings and
      //    the ground itself). The SDF figures are not in it -- their materials write their own gl_FragDepth and
      //    an override material would give their whole quad's depth instead -- so a figure standing in grass does
      //    not stop the ground behind it growing a fringe. Those stalks are farther, hence shorter; and grass over
      //    someone's feet is what should happen anyway.
      camera.layers.set(OCC_LAYER);
      highMat.uniforms.uHeight.value = FRINGE.height;
      scene.overrideMaterial = highMat;
      renderer.render(scene, camera);
      // 2. the flat not-grass surfaces, in their own materials: a track's depth, so the ground under it is hidden
      MASK_MODE.value = 1;
      camera.layers.set(NOGRASS_LAYER);
      scene.overrideMaterial = null;
      renderer.render(scene, camera);
      MASK_MODE.value = 0;
      // 3. the ground alone, tested against that depth
      camera.layers.set(GRASS_LAYER);
      scene.overrideMaterial = maskMat;
      renderer.render(scene, camera);
      renderer.setRenderTarget(tgt);
      scene.overrideMaterial = over;
      camera.layers.mask = mask;
      renderer.setClearColor(cc, ca);
      renderer.autoClear = auto;
      scene.background = bg;
      U.uRes.value.copy(size);
      U.uMaskRes.value.set(w, h);
      U.uT.value = t;
      U.uHeight.value = FRINGE.height; U.uCells.value = FRINGE.cells; U.uCover.value = FRINGE.cover; U.uFade.value = FRINGE.fade; U.uBladePx.value = FRINGE.bladePx; U.uDebug.value = +FRINGE.debug || 0;
      U.uPxPerM.value = camera.projectionMatrix.elements[5] * .5 * size.y;   // metres at one metre away -> pixels
      U.uP22.value = camera.projectionMatrix.elements[10]; U.uP32.value = camera.projectionMatrix.elements[14];
      U.uInvProj.value.copy(camera.projectionMatrixInverse);
      U.uInvView.value.copy(camera.matrixWorld);
      U.uEye.value.setFromMatrixPosition(camera.matrixWorld);
    },
  };
}
