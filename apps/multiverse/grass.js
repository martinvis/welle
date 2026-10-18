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
import { wgslFn, uniform, texture, positionWorld, positionView, positionGeometry, screenCoordinate, vec4 } from "three/tsl";
import { OCC_LAYER, onSecondaryView, occluderScene } from "./composite.js";

// a 1 x 1 stand-in so the fringe's texture node exists before the mask buffer does
let _blankMask = null;
function blankMask() {
  if (!_blankMask) { _blankMask = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); _blankMask.needsUpdate = true; }
  return _blankMask;
}

export const FRINGE = { on: true, scale: .5, height: .20, cells: 50, cover: .30, fade: 32, bladePx: 1.6, debug: false,
                        // the mask's three draws render flat lists of the objects they need instead of walking
                        // the whole world three times (see update). ?maskflat=0 goes back to the full scene:
                        // there to tell a mask bug from a list bug, in one reload.
                        flat: true };
// height: a stalk's reach in metres (.20 = knee-high meadow). cells: roots per metre, and a blade is one cell
// wide -- 50 is 2cm, about three pixels at four metres. cover: the share of roots that grow one.
// fade: the metres by which the fringe is gone -- past a few metres a blade falls under a pixel and a per-pixel
// decision would shimmer, and it has nothing to do out there: the tile's own blades carry the far field, and they
// are mipmapped, which is what keeps distance quiet. debug: ?fringe=mask / ?fringe=raw show the mask itself.
export const GRASS_LAYER = 4;    // the ground opts in (index.html); the world's occluders sit on OCC_LAYER
// Layer 6 is kept free for the water: the mask never learns about it (markGroundProp marks only what is
// OPAQUE, and you can see the ground through water), which is why stalks can still be painted over a lake.
// Two attempts to stamp it into the mask are written up in docs/engines.md -- neither held, and the reason is
// not yet understood, so neither is in the code.
export const MASK_BLOCK_LAYER = 6;
export const NOGRASS_LAYER = 5;  // flat things laid ON the ground that are not grass -- a track, a yard: they hide the
                                 // ground under them from the mask, so nothing grows through them. They draw with their
                                 // OWN material (MASK_MODE tells it to write the mask instead of its colour), because
                                 // what is really path and what is the ragged edge beside it is that shader's own business.
export const MASK_MODE = { value: 0 };

// HOLES IN THE GROUND: where a building has a floor of its own at or below its ground floor -- its rooms, a cellar and
// the stair down to it -- the ground is cut away under it, so no lawn shows through a stairwell and no grass grows in a
// cellar or over a floor. One r8 texture over the area that has any (255: cut), set by the world once its buildings
// stand (index.html); `box` is its rectangle on the plan (x0, z0, x1, z1). Both the ground's own material and the
// grass mask's ground pass ask groundHole, so what is cut from the one is cut from the other.
// ...and `rects`: up to 16 OPEN RECTANGLES anywhere in the world (a texture of RGBA floats, one rectangle a texel: x0, z0,
// x1, z1; a texel with x1 <= x0 is none) -- the landmarks' `site.dig`: a pyramid's passage going down under the ground
export const DIG_RECTS = new Float32Array(16 * 4);
const rectTex = new THREE.DataTexture(DIG_RECTS, 16, 1, THREE.RGBAFormat, THREE.FloatType);
rectTex.needsUpdate = true;
export const GROUND_HOLES = { tex: texture(blankMask()), box: uniform(new THREE.Vector4(0, 0, 1, 1)), rects: texture(rectTex), rectTex };

// THE WATER'S SURFACE, where grass must not grow under it: a grown map's water is no one level (a river falls, a stream
// falls faster, a lake has its own), so its surface is an r32f height texture over `box` (x0, z0, x1, z1; -1e9: dry),
// set by the world (index.html); outside the box the one level given to the fringe's update (the old world's)
let _flatLevel = null;
function flatLevel() {
  if (!_flatLevel) { _flatLevel = new THREE.DataTexture(new Float32Array([-1e9]), 1, 1, THREE.RedFormat, THREE.FloatType); _flatLevel.needsUpdate = true; }
  return _flatLevel;
}
export const WATER_LEVEL = { tex: texture(flatLevel()), box: uniform(new THREE.Vector4(0, 0, 0, 0)) };
export const waterHere = wgslFn(`
  fn waterHere(wp: vec3<f32>, lv: texture_2d<f32>, box: vec4<f32>, flat: f32) -> f32 {
    let u = (wp.xz - box.xy) / max(box.zw - box.xy, vec2<f32>(1e-6));
    if (u.x < 0.0 || u.y < 0.0 || u.x >= 1.0 || u.y >= 1.0) { return flat; }
    let dim = vec2<f32>(textureDimensions(lv));
    return textureLoad(lv, vec2<i32>(u * dim), 0).r;
  }
`);
export const groundHole = wgslFn(`
  fn groundHole(wp: vec3<f32>, holes: texture_2d<f32>, box: vec4<f32>, rects: texture_2d<f32>) -> f32 {
    for (var i: i32 = 0; i < 16; i = i + 1) {
      let r = textureLoad(rects, vec2<i32>(i, 0), 0);
      if (r.z <= r.x) { break; }
      if (wp.x > r.x && wp.x < r.z && wp.z > r.y && wp.z < r.w) { return 1.0; }
    }
    let u = (wp.xz - box.xy) / (box.zw - box.xy);
    if (u.x < 0.0 || u.y < 0.0 || u.x >= 1.0 || u.y >= 1.0) { return 0.0; }
    let dim = vec2<f32>(textureDimensions(holes));
    return textureLoad(holes, vec2<i32>(u * dim), 0).r;
  }
`);

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
// The lawn's colour, shared by the ground (index.html), the baked tile and the fringe below -- one definition,
// so a stalk and the grass it grows out of can never be two different greens.
export const GRASS_COLOR_WGSL = /* wgsl */ `
  fn grassGrade(y: f32) -> f32 { return clamp(y / ${GRADE.span.toFixed(2)} + 0.5, 0.0, 1.0); }   // 0 lush .. 1 dry
  fn grassGround(t: f32, band: f32, mottle: f32) -> vec3<f32> {
    var c = mix(${hex(GRADE.mid)}, ${hex(GRADE.hi)}, (t - 0.5) * 2.0);
    if (t < 0.5) { c = mix(${hex(GRADE.lo)}, ${hex(GRADE.mid)}, t * 2.0); }
    return c * select(0.96, 1.05, band > 0.5) * (0.94 + 0.09 * mottle);
  }
  // a blade over the ground it grows from: dark at the root, catching the light at the tip, its own tone
  fn grassBlade(base: vec3<f32>, tip: f32, tone: f32) -> vec3<f32> {
    return base * mix(vec3<f32>(0.6, 0.74, 0.5), vec3<f32>(1.26, 1.28, 1.02), tip) * (0.88 + 0.24 * tone);
  }
`;
export const grassGrade = wgslFn(`
  fn grassGrade(y: f32) -> f32 { return clamp(y / ${GRADE.span.toFixed(2)} + 0.5, 0.0, 1.0); }
`);
// built when the fringe is (createGrassFringe), so a period's ground colours set into GRADE before it count
const grassGround = () => wgslFn(`
  fn grassGround(t: f32, band: f32, mottle: f32) -> vec3<f32> {
    var c = mix(${hex(GRADE.mid)}, ${hex(GRADE.hi)}, (t - 0.5) * 2.0);
    if (t < 0.5) { c = mix(${hex(GRADE.lo)}, ${hex(GRADE.mid)}, t * 2.0); }
    return c * select(0.96, 1.05, band > 0.5) * (0.94 + 0.09 * mottle);
  }
`);
export const grassBlade = wgslFn(`
  fn grassBlade(base: vec3<f32>, tip: f32, tone: f32) -> vec3<f32> {
    return base * mix(vec3<f32>(0.6, 0.74, 0.5), vec3<f32>(1.26, 1.28, 1.02), tip) * (0.88 + 0.24 * tone);
  }
`);

// The WIND, one definition for both halves: two slow waves crossing the meadow, so gusts travel over it
// instead of the whole field pulsing. -1 bent one way .. +1 the other, at a world point and a time.
export const grassWind = wgslFn(`
  fn grassWind(p: vec2<f32>, t: f32) -> f32 {
    return sin(dot(p, vec2<f32>(0.31, 0.95)) * 0.35 - t * 1.35) + 0.5 * sin(dot(p, vec2<f32>(-0.8, 0.6)) * 0.17 - t * 0.85)
         + 0.35 * sin(dot(p, vec2<f32>(0.62, -0.78)) * 0.9 - t * 2.4);   // a third, quicker ripple: a gust with texture, not just a swell
  }
`);

const gHash = wgslFn(`
  fn gHash(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
`);

// what the mask stores: is this grass, and how far away is it. -1 in alpha: discarded (no stalks out of water).
const maskFrag = wgslFn(`
  fn maskFrag(wp: vec3<f32>, dist: f32, far: f32, water: f32, hole: f32) -> vec4<f32> {
    if (wp.y < water + 0.02 || hole > 0.5) { discard; }
    let d = clamp(dist / far, 0.0, 1.0);
    return vec4<f32>(grassGrade(wp.y), floor(d * 255.0) / 255.0, fract(d * 255.0), 1.0);
  }
`, [grassGrade]);

// the occluders: nothing but that one bit -- 0 where they stand higher than a stalk can reach,
// .5 where they are not grass but low enough for a stalk to cross
const highFrag = wgslFn(`
  fn highFrag(up: f32, height: f32) -> vec4<f32> {
    return vec4<f32>(0.0, 0.0, 0.0, select(0.5, 0.0, up > height));
  }
`);

// THE FRINGE: walk down the screen, find the ground, ask whether a stalk rooted there reaches this high.
// Returns (rgb, alpha) with the depth in a second call (fringeDepth) -- one walk, read twice.
const FRINGE_BODY = `
    let uv = frag / res;
    if (debug > 4.5) {   // ?fringe=alpha: the mask's ALPHA alone -- 0 nothing may be painted, .5 crossable, 1 grass
      let a = maskAt(mask, uv, maskRes).a;
      return mat4x4<f32>(vec4<f32>(a, a, a, 1.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
    }
    if (debug > 1.5) { return mat4x4<f32>(vec4<f32>(maskAt(mask, uv, maskRes).rgb, 1.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0)); }
    if (debug > 0.5) {
      let m = maskAt(mask, uv, maskRes);
      return mat4x4<f32>(vec4<f32>(select(0.0, 1.0, m.a < 0.5), m.r, 0.0, 1.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
    }
    // its own surface stands higher off the ground than a stalk reaches
    if (maskAt(mask, uv, maskRes).a < 0.25) { discard; }
    let stepUv = 1.0 / maskRes.y;
    let stepPx = res.y / maskRes.y;
    // every step down is NEARER ground, so its stalks are taller: a step that grows nothing never ends the
    // search -- only a stalk that covers this pixel does.
    for (var k: i32 = 1; k <= 10; k = k + 1) {
      let kk = f32(k);
      let off = kk * (1.0 + kk * 0.22);                    // 1, 3, 5, 7, 10, 14, 18, 22, 27, 32 texels down
      // DOWN the screen is +y here: WebGPU's screen coordinate counts from the TOP, where gl_FragCoord
      // counted from the bottom
      // DOWN the screen is +y: WebGPU's screen coordinate counts from the TOP, where gl_FragCoord counted
      // from the bottom
      let sUv = uv + vec2<f32>(0.0, off * stepUv);
      if (sUv.y > 1.0) { break; }
      let m = maskAt(mask, sUv, maskRes);
      if (m.a < 0.75) { continue; }                        // not grass (a track, a roof, the sky): nothing rooted there
      // ...and neither is a "this is not grass" mark. The engines that cut their own silhouette write it
      // themselves in their own shaders (instanced.js, foliage.js, paths.js: black, through MASK_MODE), which
      // lands in the mask as colour 0 at distance 0 -- and distance 0 means a root AT THE EYE, whose stalk is
      // infinitely tall and whose colour, read back from the grade, is black. That is what drew the long black
      // wedges spreading from every animal and tree across the meadow.
      if (m.g + m.b <= 0.0) { continue; }
      let zv = -(m.g + m.b / 255.0) * far;                 // the root's view depth (negative, into the screen)
      let hPx = height * pxPerM / -zv;                     // its tallest stalk, in pixels: far grass is short
      let near = 1.0 - smoothstep(fade * 0.55, fade, -zv); // gone by fade metres (the tile's blades take over)
      if (near < 0.02) { continue; }
      let upPx = off * stepPx;
      if (upPx > hPx) { continue; }
      // the root in the world, so a stalk is anchored there and does not swim when the camera moves. The DEPTH
      // comes from the mask texel below us, the sideways position from this pixel's own column: which blade
      // grows where is decided per screen pixel, so a blade can be one pixel wide instead of the mask's two.
      // ...and its clip space runs y UP and z from 0 (the near plane) to 1, so the unprojection is not GL's
      // ...and its clip space runs y UP and z from 0 (the near plane) to 1, so this is not GL's unprojection
      let h = invProj * vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - 2.0 * sUv.y, 0.0, 1.0);
      let dv = normalize(h.xyz / h.w);
      let gp = (invView * vec4<f32>(dv * (zv / dv.z), 1.0)).xyz;
      if (debug > 3.5) {   // ?fringe=root: the world point the stalk is rooted at, so two builds can be compared
        return mat4x4<f32>(vec4<f32>(fract(gp.x), fract(gp.z), 0.5, 1.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
      }
      let t = upPx / max(hPx, 0.001);                      // 0 at the root .. 1 at the tallest reach
      let wind = grassWind(gp.xz, time);
      // the blade LEANS: the further up it you are the further it has swung, so the root stays planted while
      // the tip travels. Its identity comes from the ROOT cell, so a gust bends each blade instead of
      // reshuffling them.
      let lean = vec2<f32>(0.31, 0.95) * (wind * 0.22 * t * t);
      // and no blade is ever drawn thinner than bladePx: the root grid coarsens with distance to hold that,
      // which is what lets the fringe reach far without boiling (a 2cm blade is half a pixel at 30m).
      let cellsN = min(cells, pxPerM / (max(-zv, 0.5) * bladePx));
      let cell = floor((gp.xz + lean) * cellsN);
      let r1 = gHash(cell);
      let r2 = gHash(cell + 19.0);
      let r3 = gHash(cell + 41.0);
      if (r1 > cover) { continue; }
      let tall = (0.45 + 0.75 * r2) * (1.0 - 0.32 * abs(wind));   // a blade bows lower the harder the gust leans it
      if (t > tall) { continue; }
      let f = t / tall;
      // the lawn's OWN colour at that spot -- graded by elevation, banded, patched, exactly as the ground
      // shades itself -- then bladed. That is what makes the stalks and the lawn behind them one field.
      let bandY = floor(gp.y / ${GRADE.band});
      let base = grassGround(m.r, bandY - 2.0 * floor(bandY / 2.0), gHash(floor(gp.xz * 1.4) + 9.0));
      let col = grassBlade(base, f, r3) * (1.0 + 0.06 * wind);
      // ITS OWN DEPTH: the stalk stands at its root (a hand's breadth of lean toward the eye at the tip), so
      // the world's z-buffer decides what covers it. A figure, a tree, a cart in front of the root hides the
      // stalk; ground nearer than them grows over their feet. WebGPU's clip space is already 0..1, so there is
      // none of GL's .5 + .5 * here.
      let zs = zv + height * f;
      let depth = (p22 * zs + p32) / -zs;
      return mat4x4<f32>(vec4<f32>(col, min(1.0, (1.0 - f * f) * 2.2) * near), vec4<f32>(depth, 0.0, 0.0, 0.0), vec4<f32>(0.0), vec4<f32>(0.0));
    }
    discard;
    return mat4x4<f32>(vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0), vec4<f32>(0.0));
`;
// the mask is read texel by texel (it is a NEAREST buffer: its channels are packed data, never to be blended)
const maskAt = wgslFn(`
  fn maskAt(mask: texture_2d<f32>, uv: vec2<f32>, maskRes: vec2<f32>) -> vec4<f32> {
    let px = vec2<i32>(clamp(uv * maskRes, vec2<f32>(0.0), maskRes - 1.0));
    return textureLoad(mask, px, 0);
  }
`);

const fringeFn = () => wgslFn(`
  fn fringeFn(mask: texture_2d<f32>, frag: vec2<f32>, res: vec2<f32>, maskRes: vec2<f32>,
              far: f32, time: f32, pxPerM: f32, height: f32, cells: f32, cover: f32, debug: f32,
              p22: f32, p32: f32, fade: f32, bladePx: f32,
              invProj: mat4x4<f32>, invView: mat4x4<f32>) -> mat4x4<f32> {
${FRINGE_BODY}
  }
`, [grassWind, grassGround(), grassBlade, gHash, maskAt]);

// The figures need nothing of their own. The fringe writes its OWN depth (its root's), so the world's z-buffer
// decides what covers it: a pig, a tree, a cart in front of a stalk's root hides it, and ground nearer than they
// are grows over their feet. That also settles the phantom ground -- lawn recorded BEHIND a figure is farther
// than the figure, so its stalks fail the depth test instead of climbing it. No proxy, no box, no bald rectangle.

// The pass. update() runs before the world is drawn (it needs the camera, nothing else);
// the quad rides in the scene, drawn after everything.
export function createGrassFringe() {
  const fringe = fringeFn();
  // the ground's own mask: is this grass, and how far away (the material every ground mesh is drawn with)
  const uFar = uniform(500), uWater = uniform(-1e9), uHeight = uniform(FRINGE.height);
  const maskMat = new THREE.MeshBasicNodeMaterial({ depthWrite: false });
  {
    const out = maskFrag({ wp: positionWorld, dist: positionView.z.negate(), far: uFar,
                           water: waterHere({ wp: positionWorld, lv: WATER_LEVEL.tex, box: WATER_LEVEL.box, flat: uWater }),
                           hole: groundHole({ wp: positionWorld, holes: GROUND_HOLES.tex, box: GROUND_HOLES.box, rects: GROUND_HOLES.rects }) });
    maskMat.colorNode = out.xyz;
    maskMat.opacityNode = out.w;
    maskMat.transparent = true;
    maskMat.blending = THREE.NoBlending;   // the channels are DATA, never blended
  }
  // the world's occluders: their depth, and the one bit saying how high off the ground each pixel of them is.
  // positionGeometry.y is the LOCAL height: a prop stands with its base on the ground, and an InstancedMesh
  // copy (a barrel, a shutter) is still the same prop.
  const highMat = new THREE.MeshBasicNodeMaterial();
  {
    const out = highFrag({ up: positionGeometry.y, height: uHeight });
    highMat.colorNode = out.xyz;
    highMat.opacityNode = out.w;
    highMat.transparent = true;
    highMat.blending = THREE.NoBlending;
  }

  // the fringe itself: one full-screen quad, its own depth per pixel
  const uMask = texture(blankMask());
  const uRes = uniform(new THREE.Vector2(1, 1)), uMaskRes = uniform(new THREE.Vector2(1, 1));
  const uT = uniform(0), uPxPerM = uniform(800), uCells = uniform(FRINGE.cells), uCover = uniform(FRINGE.cover);
  const uDebug = uniform(0), uP22 = uniform(0), uP32 = uniform(0), uFade = uniform(FRINGE.fade), uBladePx = uniform(FRINGE.bladePx);
  const uInvProj = uniform(new THREE.Matrix4()), uInvView = uniform(new THREE.Matrix4());
  const fringeMat = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthTest: true, depthWrite: false,   // it writes its OWN depth: the world covers it wherever the world is in front
  });
  {
    const out = fringe({
      mask: uMask, frag: screenCoordinate, res: uRes, maskRes: uMaskRes, far: uFar, time: uT,
      pxPerM: uPxPerM, height: uHeight, cells: uCells, cover: uCover, debug: uDebug, p22: uP22, p32: uP32,
      fade: uFade, bladePx: uBladePx, invProj: uInvProj, invView: uInvView,
    });
    fringeMat.vertexNode = vec4(positionGeometry.xy, 0.0, 1.0);
    fringeMat.colorNode = out.element(0).xyz;
    fringeMat.opacityNode = out.element(0).w;
    fringeMat.depthNode = out.element(1).x;
  }
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), fringeMat);
  quad.userData.screen = true;      // a screen-space overlay, not a thing in the world (the geometry view skips it)
  quad.frustumCulled = false;
  quad.renderOrder = 9999;   // after the world: it paints over what the stalks stand in front of
  quad.visible = FRINGE.on;
  let rt = null, size = new THREE.Vector2(), secondary = false, kids = -1;
  // THE MASK'S OWN SCENES. Each of the three draws below is a full renderer.render(), and three walks the
  // WHOLE graph for every one of them -- world matrices, visibility, frustum tests, render list -- before it
  // draws anything. In this world that is eleven hundred objects a pass, to draw about eight hundred, then
  // six, then one. So the mask keeps three flat lists of the very same objects (no hierarchy to recurse, and
  // nothing in them that will not be drawn) and renders those instead. They are gathered with
  // traverseVisible, so a hidden group is not in them; and re-gathered when the world gains or loses
  // something, or twice a second, which is soon enough for a mask that only decides where stalks may stand.
  // (the occluders are the same set stage 3b draws, so that list lives in composite.js and is shared)
  const flatScene = () => { const s = new THREE.Scene(); s.matrixWorldAutoUpdate = false; return s; };
  const nogScene = flatScene(), groundScene = flatScene();
  let listT = -1e9;
  const gather = (scene) => {
    const nog = [], gnd = [];
    scene.traverseVisible((o) => {
      if (!(o.isMesh || o.isInstancedMesh || o.isPoints || o.isLine)) return;
      if (o.layers.isEnabled(NOGRASS_LAYER)) nog.push(o);
      if (o.layers.isEnabled(GRASS_LAYER)) gnd.push(o);
    });
    nogScene.children = nog; groundScene.children = gnd;
  };
  const _clear = new THREE.Color();
  // a mirror's or a painting's view is a different camera: the mask belongs to the main one, so the fringe sits out
  onSecondaryView((on) => { secondary = on; quad.visible = FRINGE.on && !on; });

  return {
    quad,
    // what the three mask draws are actually given (the probe prints it: a list that should not be empty is
    // how a mask bug announces itself)
    lists: () => ({ nograss: nogScene.children.length, ground: groundScene.children.length }),
    // stage 3b's occluder depth, free: the mask's first pass drew exactly those objects (null when the fringe
    // is off, and composite.js then runs its own pass as before)
    occluderDepth: () => (FRINGE.on && !secondary && rt ? rt.depthTexture : null),
    // before the world: the ground's own mask (its depth tested against the world, so hidden ground grows nothing)
    update(renderer, scene, camera, t, waterLevel = -1e9) {
      quad.visible = FRINGE.on && !secondary;
      if (!FRINGE.on) return;
      // EVERY solid thing in the world is an occluder, not a list of the ones somebody remembered to mark: a wall
      // the mask cannot see is a wall the ground shows through, and then the grass climbs it to the roof (each of
      // its pixels finds "grass" one texel below and paints, all the way up). Re-run whenever the scene gains or
      // loses something; markGroundProp itself skips glass, cut-out cards and the figures.
      if (scene.children.length !== kids) { kids = scene.children.length; markGroundProp(scene); listT = -1e9; }
      if (FRINGE.flat && t - listT > .5) { listT = t; gather(scene); }   // the flat lists, kept current (see above)
      renderer.getDrawingBufferSize(size);
      const w = Math.max(8, Math.round(size.x * FRINGE.scale)), h = Math.max(8, Math.round(size.y * FRINGE.scale));
      if (!rt || rt.width !== w || rt.height !== h) {
        if (rt) rt.dispose();
        // the mask's own depth is kept as a texture: it is the occluders' depth at half resolution, and the
        // figures' engine used to borrow it rather than draw the same set again (that test went with the SDF).
        rt = new THREE.RenderTarget(w, h, { depthBuffer: true, depthTexture: new THREE.DepthTexture(w, h),
                                            minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
        rt.depthTexture.minFilter = rt.depthTexture.magFilter = THREE.NearestFilter;   // depth must not blend across an edge
        uMask.value = rt.texture;
      }
      uFar.value = camera.far;
      uWater.value = waterLevel;
      const mask = camera.layers.mask, tgt = renderer.getRenderTarget();
      const cc = renderer.getClearColor(_clear).clone(), ca = renderer.getClearAlpha(), auto = renderer.autoClear;
      // The mask is built in three draws into ONE buffer. Two things would otherwise wipe it between them:
      // autoClear, and -- less obviously -- a scene BACKGROUND, which three paints over the target at the start
      // of EVERY render(), autoClear or not. With the sky's blue left in, the mask read .62 in red wherever
      // nothing was drawn, and .62 is over the "this is grass" threshold: the mask called the sky, and every
      // wall and roof in front of it, grass -- which is exactly what put stalks up the walls, and why the
      // occluder depth never survived to hide anything. The three flat scenes above carry no background of
      // their own, so there is nothing left to guard against here.
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
      uHeight.value = FRINGE.height;
      const occScene = FRINGE.flat ? occluderScene(scene) : scene;
      occScene.overrideMaterial = highMat;
      renderer.render(occScene, camera);
      occScene.overrideMaterial = null;
      // 2. the flat not-grass surfaces, in their own materials: a track's depth, so the ground under it is hidden
      MASK_MODE.value = 1;
      camera.layers.set(NOGRASS_LAYER);
      renderer.render(FRINGE.flat ? nogScene : scene, camera);
      MASK_MODE.value = 0;
      // 3. the ground alone, tested against that depth
      camera.layers.set(GRASS_LAYER);
      const gScene = FRINGE.flat ? groundScene : scene;
      gScene.overrideMaterial = maskMat;
      renderer.render(gScene, camera);
      gScene.overrideMaterial = null;
      if (FRINGE.debug > 2) {   // ?fringe=count: what each of the three mask draws actually drew
        const r = renderer.info.render;
        console.warn(`grass mask: ${r.drawCalls} draws, ${r.triangles} tris this frame`);
      }
      renderer.setRenderTarget(tgt);
      camera.layers.mask = mask;
      renderer.setClearColor(cc, ca);
      renderer.autoClear = auto;
      uRes.value.copy(size);
      uMaskRes.value.set(w, h);
      uT.value = t;
      uCells.value = FRINGE.cells; uCover.value = FRINGE.cover; uFade.value = FRINGE.fade;
      uBladePx.value = FRINGE.bladePx; uDebug.value = +FRINGE.debug || 0;
      uPxPerM.value = camera.projectionMatrix.elements[5] * .5 * size.y;   // metres at one metre away -> pixels
      uP22.value = camera.projectionMatrix.elements[10]; uP32.value = camera.projectionMatrix.elements[14];
      uInvProj.value.copy(camera.projectionMatrixInverse);
      uInvView.value.copy(camera.matrixWorld);
    },
  };
}
