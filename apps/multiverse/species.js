// Abstract animal definitions -- pure data, no rendering-engine imports.
// Any engine (rig.js polygon meshes, banner.js SDF quads, instanced.js)
// consumes the same part lists; a species is nothing but proportions,
// colors and hierarchy expressed in the shared primitive vocabulary
// (sphere, capsule, cone). Each part names its parent by id (root: null).
//
// UNITS: 1 = 1 meter. Species are authored either directly in meters
// (factor 1) or at a convenient working scale and run through scaleParts()
// with a factor that brings them to roughly real-world size, so an elephant
// genuinely dwarfs a cat and leg/head/body ratios stay plausible. The one
// deliberate cheat: eyes get a minimum radius (EYE_MIN_R) so they stay
// readable on small animals (now just a tiny safety floor: real sizes rule).
//
// NOTE: a leg's own foot reaches dropY - (len + r) below the body's local
// origin (capsule geometry extends len/2+r past its own center each way,
// and pivot=[0,-len/2,0] re-centers that onto the drop point) -- so for feet
// to land on the ground, body.pos[1] must equal -dropY + len + r. Uniform
// scaling preserves this invariant. The same pivot trick makes any part
// hang from its attach point (tails, trunk) or grow out of it (hare ears).
//
// Ordering: SPECIES is sorted small -> large so the demo's grid puts small
// animals in the front rows.

const EYE_MIN_R = .012;

// Eyes must actually sit ON the head sphere: an eye authored (or pushed by
// the EYE_MIN_R boost) too close to the head center is swallowed once depth
// is computed per pixel. Push each eye outward along its own direction until
// it protrudes about half its radius -- its angular position on the head
// (and thus how it rides head rotation) is unchanged. Head scale (hippo) is
// accounted for by measuring in the head's squashed local frame.
function snapEyes(parts) {
  const head = parts.find((p) => p.id === "head");
  if (!head || head.shape !== "sphere") return parts;
  const hs = head.scale ?? [1, 1, 1];
  return parts.map((p) => {
    if (p.parent !== "head" || !p.id.startsWith("eye")) return p;
    const len = Math.hypot(...p.pos.map((v, i) => v / hs[i]));
    const want = head.size.r + p.size.r * .45;
    return len >= want ? p : { ...p, pos: p.pos.map((v) => v * want / len) };
  });
}

function scaleParts(parts, f) {
  return snapEyes(parts.map((p) => {
    const q = { ...p, size: { ...p.size } };
    for (const k of ["r", "len", "h"]) if (q.size[k] !== undefined) q.size[k] *= f;
    for (const k of ["a", "b", "c"]) if (q.size[k]) q.size[k] = q.size[k].map((v) => v * f);   // triangle corners
    if (q.pos) q.pos = q.pos.map((v) => v * f);
    if (q.pivot) q.pivot = q.pivot.map((v) => v * f);
    if (q.id.startsWith("eye")) q.size.r = Math.max(q.size.r, EYE_MIN_R);
    return q;
  }));
}

// a real trot gait: diagonal pairs (FL+BR, FR+BL) swing in sync, half a
// cycle apart, with a proper ~24-degree stride. Cadence is uniform (.8
// cycles/s at gait-clock rate 1); the wanderer scales the clock by actual
// travel speed over leg length, so a cat's legs flicker while an elephant
// strides -- and every leg passes neutral together, letting stops settle
// square. (The old per-species speed/deg tuning is superseded.)
function legs({ len, r, spreadX, spreadZ, dropY, color, pat }) {
  const at = [["legFL", spreadX, spreadZ, 0], ["legFR", spreadX, -spreadZ, Math.PI],
              ["legBL", -spreadX, spreadZ, Math.PI], ["legBR", -spreadX, -spreadZ, 0]];
  return at.map(([id, x, z, phase]) => ({
    id, parent: "body", shape: "capsule", size: { r, len },
    pos: [x, dropY, z], pivot: [0, -len / 2, 0], color, pat,
    anim: { axis: "z", deg: 24, speed: .8, phase },
  }));
}

// A two-boned bat wing for the winged monsters: humerus rising from the
// shoulder, finger spar carrying on outward, one closed membrane skin
// behind them, and a wingtip claw. Flapping animates both bones about x --
// the spar swings wider and slightly out of phase, so the wing folds like
// a hinge instead of see-sawing as one slab. s = +1 for the left (+z)
// wing, -1 for the right; k scales the whole wing. Wing anims carry
// `wing: true`: a mount in flight beats them on their own clock while the
// legs hang still.
//
// The skin is four flat triangle banners, two per bone, and every seam is
// exact at every instant of the flap: the arm's lobes share the arm frame,
// the spar's lobes share the spar frame, and the one seam that crosses
// frames runs from the elbow straight back along the spar's HINGE AXIS
// (the arm-frame x direction) to corner D -- points on a hinge axis do not
// move when the hinge turns, so both frames agree on that edge always.
function batWing(s, { k = 1, x = -.2, y = .5, z = .4, bone = 0x4a2a3a, mem = bone, deg = 12, speed = .5 } = {}) {
  const S = s > 0 ? "L" : "R";
  const E = 1.08 * k;   // the elbow: where the spar hangs on the arm
  return [
    { id: `wArm${S}`, parent: "body", shape: "capsule", size: { r: .07 * k, len: 1.1 * k },
      pos: [x, y, s * z], rot: [s * 62, 0, 0], pivot: [0, .55 * k, 0], color: bone,
      anim: { axis: "x", deg: s * deg, speed, phase: 0, wing: true } },
    // arm frame: shoulder-elbow-flank lobe, then elbow-flank-D closing back to the hinge point
    { id: `wMemA${S}`, parent: `wArm${S}`, shape: "tri",
      size: { a: [0, .02 * k, 0], b: [0, E - .02 * k, 0], c: [-1.05 * k, -.2 * k, 0], r: .03 * k },
      pos: [0, 0, 0], color: mem },
    { id: `wMemA2${S}`, parent: `wArm${S}`, shape: "tri",
      size: { a: [0, E - .02 * k, 0], b: [-1.05 * k, -.2 * k, 0], c: [-1.0 * k, E, 0], r: .03 * k },
      pos: [0, 0, 0], color: mem },
    { id: `wHand${S}`, parent: `wArm${S}`, shape: "capsule", size: { r: .05 * k, len: 1.0 * k },
      pos: [0, E, 0], rot: [s * 42, 0, 0], pivot: [0, .5 * k, 0], color: bone,
      anim: { axis: "x", deg: s * deg * 1.6, speed, phase: .6, wing: true } },
    // spar frame: elbow-tip-trailing lobe, then elbow-trailing-D (D = the same hinge point, seen from here)
    { id: `wMemB${S}`, parent: `wHand${S}`, shape: "tri",
      size: { a: [0, .02 * k, 0], b: [0, 1.02 * k, 0], c: [-1.0 * k, .25 * k, 0], r: .03 * k },
      pos: [0, 0, 0], color: mem },
    { id: `wMemB2${S}`, parent: `wHand${S}`, shape: "tri",
      size: { a: [0, .02 * k, 0], b: [-1.0 * k, .25 * k, 0], c: [-1.0 * k, 0, 0], r: .03 * k },
      pos: [0, 0, 0], color: mem },
    { id: `wClaw${S}`, parent: `wHand${S}`, shape: "cone", size: { r: .045 * k, h: .24 * k },
      pos: [0, 1.06 * k, 0], color: bone },
  ];
}

// Generative butterflies: sized like the largest real butterflies
// (~30-40cm span) so they stay visible up close, wings as flat triangle
// banners in bright two-tone variants, some with spot patterns. Fliers:
// they flutter .5-5m above the ground and glide when "standing".
const BFLY = [
  { f: 0xe07818, h: 0xc86410, pat: "wingspots" },   // monarch orange
  { f: 0x3a78e0, h: 0x2c5cc0 },                     // morpho blue
  { f: 0xe8d44a, h: 0xd8bc32, pat: "wingspots" },   // swallowtail yellow
  { f: 0x38302e, h: 0xc23028 },                     // red admiral
  { f: 0xeae6d8, h: 0xd0ccba, pat: "wingspots" },   // cabbage white
  { f: 0x7a52b8, h: 0x5c3a9c },                     // purple emperor
];
export function makeButterfly({ seed = 1 } = {}) {
  let s = (seed * 2654435761) >>> 0 || 1;                      // tiny LCG: keeps this file import-free
  const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const v = BFLY[Math.floor(r() * BFLY.length)];
  const k = .85 + r() * .45;
  const dark = 0x241c14;
  const parts = [
    { id: "body", parent: null, shape: "capsule", size: { r: .013 * k, len: .07 * k }, geomRot: [0, 0, 90], pos: [0, 0, 0], color: dark },
    { id: "head", parent: "body", shape: "sphere", size: { r: .015 * k }, pos: [.05 * k, .006 * k, 0], color: dark },
    { id: "antL", parent: "head", shape: "capsule", size: { r: .003 * k, len: .045 * k }, pos: [.012 * k, .012 * k, .006 * k], rot: [28, 0, -55], pivot: [0, .022 * k, 0], color: dark },
    { id: "antR", parent: "head", shape: "capsule", size: { r: .003 * k, len: .045 * k }, pos: [.012 * k, .012 * k, -.006 * k], rot: [-28, 0, -55], pivot: [0, .022 * k, 0], color: dark },
  ];
  for (const sd of [1, -1]) {
    const S = sd > 0 ? "L" : "R";
    const m = (p) => [p[0] * k, p[1] * k, p[2] * k * sd];
    const anim = { axis: "x", deg: 58 * sd, speed: 4, phase: 0 };   // flap about the body axis
    parts.push(
      { id: `foreW${S}`, parent: "body", shape: "tri", pos: [0, .008 * k, 0],
        size: { a: m([.015, 0, .01]), b: m([.11, .015, .17]), c: m([-.025, 0, .14]), r: .012 * k },
        color: v.f, pat: v.pat, anim },
      { id: `hindW${S}`, parent: "body", shape: "tri", pos: [0, .006 * k, 0],
        size: { a: m([-.005, 0, .01]), b: m([-.035, .005, .15]), c: m([-.105, 0, .085]), r: .015 * k },
        color: v.h, pat: v.pat, anim },
    );
  }
  return { name: "butterfly", parts, fly: { alt: [.5, 5], speed: [.8, 2.2], hz: 4 } };
}

// Generative dragonflies, 7-8cm long with a 10cm span: a long thin abdomen,
// big eyes, four narrow glassy wings beating fast. They dart low and only
// over water (the demo keeps them to the lake shore and the river).
const DFLY = [
  { b: 0x2f6fd8, t: 0x1f4fa8 },   // blue emperor
  { b: 0x3aa07a, t: 0x2a7a5a },   // green darner
  { b: 0xc83028, t: 0x8a2018 },   // ruddy darter
  { b: 0x9a8a2a, t: 0x6a5a1a },   // brown hawker
];
export function makeDragonfly({ seed = 1 } = {}) {
  let s = (seed * 2246822519) >>> 0 || 1;
  const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const v = DFLY[Math.floor(r() * DFLY.length)], k = .9 + r() * .3;
  const wing = 0xdfe8ee, dark = 0x1a1a20;
  const parts = [
    { id: "body", parent: null, shape: "capsule", size: { r: .006 * k, len: .05 * k }, geomRot: [0, 0, 90], pos: [0, 0, 0], color: v.b },       // abdomen
    { id: "thorax", parent: "body", shape: "sphere", size: { r: .009 * k }, scale: [1.4, 1, 1], pos: [.03 * k, .001, 0], color: v.t },
    { id: "head", parent: "thorax", shape: "sphere", size: { r: .007 * k }, pos: [.014 * k, .001, 0], color: v.t },
    { id: "eyeL", parent: "head", shape: "sphere", size: { r: .005 * k }, pos: [.002 * k, .002 * k, .005 * k], color: dark },
    { id: "eyeR", parent: "head", shape: "sphere", size: { r: .005 * k }, pos: [.002 * k, .002 * k, -.005 * k], color: dark },
    { id: "tail", parent: "body", shape: "capsule", size: { r: .004 * k, len: .03 * k }, geomRot: [0, 0, 90], pos: [-.038 * k, 0, 0], color: v.t },
  ];
  for (const sd of [1, -1]) {
    const S = sd > 0 ? "L" : "R", m = (p) => [p[0] * k, p[1] * k, p[2] * k * sd];
    const anim = { axis: "x", deg: 22 * sd, speed: 7, phase: 0, wing: true };
    parts.push(
      { id: `foreW${S}`, parent: "thorax", shape: "tri", pos: [.004 * k, .006 * k, 0],
        size: { a: m([.004, 0, .004]), b: m([.012, .002, .052]), c: m([-.006, 0, .05]), r: .004 * k }, color: wing, anim },
      { id: `hindW${S}`, parent: "thorax", shape: "tri", pos: [-.006 * k, .005 * k, 0],
        size: { a: m([.004, 0, .004]), b: m([.006, .002, .05]), c: m([-.012, 0, .046]), r: .0045 * k }, color: wing, anim: { ...anim, phase: .5 } },
    );
  }
  return { name: "dragonfly", parts, fly: { alt: [.3, 2.2], speed: [1.6, 3.6], hz: 7 } };
}

// Generative pond fish, ~0.25-0.45m: capsule body, flat triangle tail and
// dorsal fin, tail wiggling as they cruise. Swimmers ride the flier
// plumbing: constant motion, `alt` = height above the lake floor.
const FISHC = [
  { b: 0x8a9aa6, t: 0x6d7d8a },     // silver
  { b: 0x5c6e4e, t: 0x49583e },     // olive carp
  { b: 0xc9702e, t: 0xa85a20 },     // koi orange
  { b: 0x4e5d78, t: 0x3c4a63 },     // blue-grey
];
export function makeFish({ seed = 1 } = {}) {
  let s = (seed * 2246822519) >>> 0 || 1;
  const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const v = FISHC[Math.floor(r() * FISHC.length)];
  const k = .8 + r() * .7;
  return { name: "fish", fly: { alt: [.3, 1.1], speed: [.4, 1.2], hz: 3 }, parts: [
    { id: "body", parent: null, shape: "capsule", size: { r: .05 * k, len: .16 * k }, geomRot: [0, 0, 90], pos: [0, 0, 0], color: v.b },
    { id: "tail", parent: "body", shape: "tri", pos: [-.11 * k, 0, 0],
      size: { a: [0, 0, 0], b: [-.09 * k, .06 * k, 0], c: [-.09 * k, -.05 * k, 0], r: .012 * k }, color: v.t,
      anim: { axis: "y", deg: 28, speed: 3, phase: 0 } },
    { id: "fin", parent: "body", shape: "tri", pos: [0, .05 * k, 0],
      size: { a: [-.05 * k, 0, 0], b: [.04 * k, 0, 0], c: [-.05 * k, .05 * k, 0], r: .008 * k }, color: v.t },
    { id: "eyeL", parent: "body", shape: "sphere", size: { r: .009 * k }, pos: [.09 * k, .012 * k, .028 * k], color: 0x101418 },
    { id: "eyeR", parent: "body", shape: "sphere", size: { r: .009 * k }, pos: [.09 * k, .012 * k, -.028 * k], color: 0x101418 },
  ] };
}

// The lake's big swimmers. Same swimmer plumbing as the fish; real sizes
// (dolphin ~2.4m, shark ~3.2m). The dolphin's tail pitches (axis z), the
// shark's sweeps sideways (axis y) -- true to how each actually swims.
export function makeDolphin() {
  const c = 0x728696, dark = 0x64788a;
  return { name: "dolphin", fly: { alt: [.6, 1.8], speed: [1.5, 3.2], hz: 1.1 }, parts: [
    { id: "body", parent: null, shape: "capsule", size: { r: .26, len: 1.5 }, geomRot: [0, 0, 90], pos: [0, 0, 0], color: c },
    { id: "melon", parent: "body", shape: "sphere", size: { r: .2 }, pos: [.8, .05, 0], color: c },
    { id: "snout", parent: "body", shape: "capsule", size: { r: .08, len: .32 }, pos: [1.0, -.02, 0], rot: [0, 0, -80], pivot: [0, .16, 0], color: 0x82929f },
    { id: "dorsal", parent: "body", shape: "tri", size: { a: [-.18, .2, 0], b: [.18, .22, 0], c: [-.3, .6, 0], r: .03 }, pos: [.05, 0, 0], color: dark },
    { id: "pectL", parent: "body", shape: "tri", size: { a: [0, 0, 0], b: [-.3, -.24, .3], c: [-.05, -.26, .12], r: .02 }, pos: [.45, -.14, .16], color: dark },
    { id: "pectR", parent: "body", shape: "tri", size: { a: [0, 0, 0], b: [-.3, -.24, -.3], c: [-.05, -.26, -.12], r: .02 }, pos: [.45, -.14, -.16], color: dark },
    { id: "tailStock", parent: "body", shape: "capsule", size: { r: .09, len: .5 }, pos: [-1.0, .02, 0], rot: [0, 0, 82], pivot: [0, .25, 0], color: c,
      anim: { axis: "z", deg: 15, speed: 1.1, phase: 0 } },
    { id: "flukeL", parent: "tailStock", shape: "tri", size: { a: [0, .4, .02], b: [0, .74, .46], c: [0, .62, .1], r: .02 }, pos: [0, 0, 0], color: dark },
    { id: "flukeR", parent: "tailStock", shape: "tri", size: { a: [0, .4, -.02], b: [0, .74, -.46], c: [0, .62, -.1], r: .02 }, pos: [0, 0, 0], color: dark },
    { id: "eyeL", parent: "body", shape: "sphere", size: { r: .03 }, pos: [.82, .08, .16], color: 0x14181c },
    { id: "eyeR", parent: "body", shape: "sphere", size: { r: .03 }, pos: [.82, .08, -.16], color: 0x14181c },
  ] };
}
export function makeShark() {
  const c = 0x74828c, dark = 0x5d6a74;
  return { name: "shark", fly: { alt: [.4, 1.4], speed: [1.2, 2.4], hz: .7 }, parts: [
    { id: "body", parent: null, shape: "capsule", size: { r: .32, len: 2.0 }, geomRot: [0, 0, 90], pos: [0, 0, 0], color: c },
    { id: "snout", parent: "body", shape: "cone", size: { r: .28, h: .6 }, pos: [1.25, -.02, 0], rot: [0, 0, -90], color: c },
    { id: "dorsal", parent: "body", shape: "tri", size: { a: [-.22, .28, 0], b: [.26, .3, 0], c: [-.14, .88, 0], r: .03 }, pos: [-.05, 0, 0], color: dark },
    { id: "pectL", parent: "body", shape: "tri", size: { a: [0, 0, 0], b: [-.42, -.3, .42], c: [-.08, -.32, .14], r: .02 }, pos: [.5, -.18, .22], color: dark },
    { id: "pectR", parent: "body", shape: "tri", size: { a: [0, 0, 0], b: [-.42, -.3, -.42], c: [-.08, -.32, -.14], r: .02 }, pos: [.5, -.18, -.22], color: dark },
    { id: "tailStock", parent: "body", shape: "capsule", size: { r: .11, len: .6 }, pos: [-1.25, 0, 0], rot: [0, 0, 82], pivot: [0, .3, 0], color: c,
      anim: { axis: "y", deg: 18, speed: .7, phase: 0 } },
    { id: "tailUp", parent: "tailStock", shape: "tri", size: { a: [.02, .42, 0], b: [.55, .82, 0], c: [.1, .68, 0], r: .02 }, pos: [0, 0, 0], color: dark },
    { id: "tailDn", parent: "tailStock", shape: "tri", size: { a: [-.02, .44, 0], b: [-.3, .66, 0], c: [-.05, .6, 0], r: .02 }, pos: [0, 0, 0], color: dark },
    { id: "eyeL", parent: "body", shape: "sphere", size: { r: .032 }, pos: [1.05, .1, .17], color: 0x14181c },
    { id: "eyeR", parent: "body", shape: "sphere", size: { r: .032 }, pos: [1.05, .1, -.17], color: 0x14181c },
  ] };
}

export const SPECIES = [
  { // ---- chicken: the biped -- two legs authored by hand, comb+wattle ------
    // 1:1 -> ~0.5m to the top of the head
    name: "chicken",
    parts: scaleParts([
      { id: "body", parent: null, shape: "sphere", size: { r: .14 }, scale: [1.2, 1.05, .95], pos: [0, .235, 0], color: 0xd8d3c8 },
      { id: "tailFan", parent: "body", shape: "sphere", size: { r: .07 }, scale: [.9, 1.1, .5], pos: [-.16, .09, 0], rot: [0, 0, 35], color: 0xb8b2a4 },
      { id: "head", parent: "body", shape: "sphere", size: { r: .085 }, pos: [.13, .19, 0], color: 0xd8d3c8, anim: { axis: "y", deg: 25, speed: .6, phase: 0 } },
      { id: "beak", parent: "head", shape: "cone", size: { r: .025, h: .06 }, pos: [.09, 0, 0], rot: [0, 0, -90], color: 0xd9a03c },
      { id: "comb", parent: "head", shape: "sphere", size: { r: .035 }, scale: [1.2, 1, .35], pos: [0, .085, 0], color: 0xc0392b },
      { id: "wattle", parent: "head", shape: "sphere", size: { r: .02 }, scale: [1, 1.3, .5], pos: [.07, -.05, 0], color: 0xc0392b },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .01 }, pos: [.045, .03, .055], color: 0xc06a20 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .01 }, pos: [.045, .03, -.055], color: 0xc06a20 },
      { id: "legL", parent: "body", shape: "capsule", size: { r: .015, len: .12 }, pos: [.02, -.1, .06], pivot: [0, -.06, 0], color: 0xd9a03c, anim: { axis: "z", deg: 28, speed: .8, phase: 0 } },
      { id: "legR", parent: "body", shape: "capsule", size: { r: .015, len: .12 }, pos: [.02, -.1, -.06], pivot: [0, -.06, 0], color: 0xd9a03c, anim: { axis: "z", deg: 28, speed: .8, phase: 3.14 } },
    ], 1),
  },
  { // ---- parrot: scarlet macaw -- a flier: wings beat, legs tucked away ----
    name: "parrot", fly: { alt: [3, 60], speed: [3, 6], hz: 1.3 }, active: "day",
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .055, len: .17 }, geomRot: [0, 0, 90], pos: [0, .3, 0], color: 0xd03028 },
      { id: "head", parent: "body", shape: "sphere", size: { r: .055 }, pos: [.13, .05, 0], color: 0xd03028 },
      { id: "beak", parent: "head", shape: "cone", size: { r: .022, h: .05 }, pos: [.055, -.005, 0], rot: [0, 0, -115], color: 0x2b2b2b },
      { id: "patchL", parent: "head", shape: "sphere", size: { r: .026 }, scale: [.7, 1, .5], pos: [.035, .012, .04], color: 0xece7dc },
      { id: "patchR", parent: "head", shape: "sphere", size: { r: .026 }, scale: [.7, 1, .5], pos: [.035, .012, -.04], color: 0xece7dc },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.045, .018, .048], color: 0x201a14 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.045, .018, -.048], color: 0x201a14 },
      { id: "tail", parent: "body", shape: "cone", size: { r: .03, h: .33 }, pos: [-.12, -.02, 0], rot: [0, 0, 100], color: 0x2857b0 },
      { id: "wingL", parent: "body", shape: "sphere", size: { r: .16 }, scale: [.75, .1, 1.6], pos: [0, .03, .05], pivot: [0, 0, .15], color: 0x2857b0, anim: { axis: "x", deg: 45, speed: 1.3, phase: 0 } },
      { id: "wingR", parent: "body", shape: "sphere", size: { r: .16 }, scale: [.75, .1, 1.6], pos: [0, .03, -.05], pivot: [0, 0, -.15], color: 0x2857b0, anim: { axis: "x", deg: -45, speed: 1.3, phase: 0 } },
    ], 1),
  },
  { // ---- owl: round head, pale face disc, mottled feathers -- a flier ------
    name: "owl", fly: { alt: [3, 45], speed: [2.5, 5], hz: .6 }, active: "night",
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .1, len: .2 }, geomRot: [0, 0, 90], pos: [0, .35, 0], color: 0x8a7663, pat: "leaf" },
      { id: "head", parent: "body", shape: "sphere", size: { r: .115 }, pos: [.15, .09, 0], color: 0x9a8672 },
      { id: "face", parent: "head", shape: "sphere", size: { r: .09 }, scale: [.45, 1, 1], pos: [.075, .01, 0], color: 0xd8cfc0 },
      { id: "tuftL", parent: "head", shape: "cone", size: { r: .025, h: .055 }, pos: [-.02, .105, .06], rot: [20, 0, 0], color: 0x7a6753 },
      { id: "tuftR", parent: "head", shape: "cone", size: { r: .025, h: .055 }, pos: [-.02, .105, -.06], rot: [-20, 0, 0], color: 0x7a6753 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .028 }, pos: [.1, .025, .042], color: 0xe0a91c },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .028 }, pos: [.1, .025, -.042], color: 0xe0a91c },
      { id: "beak", parent: "head", shape: "cone", size: { r: .015, h: .035 }, pos: [.107, -.025, 0], rot: [0, 0, -105], color: 0x3a332c },
      { id: "tail", parent: "body", shape: "sphere", size: { r: .08 }, scale: [1.5, .25, .8], pos: [-.24, -.02, 0], rot: [0, 0, 15], color: 0x7a6753 },
      { id: "wingL", parent: "body", shape: "sphere", size: { r: .3 }, scale: [.7, .09, 1.5], pos: [0, .04, .08], pivot: [0, 0, .28], color: 0x7a6753, pat: "leaf", anim: { axis: "x", deg: 38, speed: .6, phase: 0 } },
      { id: "wingR", parent: "body", shape: "sphere", size: { r: .3 }, scale: [.7, .09, 1.5], pos: [0, .04, -.08], pivot: [0, 0, -.28], color: 0x7a6753, pat: "leaf", anim: { axis: "x", deg: -38, speed: .6, phase: 0 } },
    ], 1),
  },
  { // ---- hare: long upright ears (capsules growing up), white bob tail -----
    // 1:1 -> back ~0.26m, ~0.38m long
    name: "hare",
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .1, len: .18 }, geomRot: [0, 0, 90], pos: [0, .16, 0], color: 0x9b8468 },
      { id: "head", parent: "body", shape: "sphere", size: { r: .08 }, pos: [.17, .08, 0], color: 0x9b8468, anim: { axis: "y", deg: 16, speed: .5, phase: 0 } },
      { id: "snout", parent: "head", shape: "sphere", size: { r: .035 }, pos: [.06, -.01, 0], color: 0xb59f85 },
      { id: "earL", parent: "head", shape: "capsule", size: { r: .022, len: .15 }, pos: [-.03, .06, .035], rot: [10, 0, -15], pivot: [0, .075, 0], color: 0x7d6950 },
      { id: "earR", parent: "head", shape: "capsule", size: { r: .022, len: .15 }, pos: [-.03, .06, -.035], rot: [-10, 0, -15], pivot: [0, .075, 0], color: 0x7d6950 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .015 }, pos: [.05, .03, .04], color: 0x2c1c12 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .015 }, pos: [.05, .03, -.04], color: 0x2c1c12 },
      { id: "tail", parent: "body", shape: "sphere", size: { r: .04 }, pos: [-.17, .03, 0], color: 0xe8e0d5 },
      ...legs({ len: .08, r: .025, spreadX: .1, spreadZ: .05, dropY: -.055, color: 0x7d6950, speed: .9, deg: 8 }),
    ], 1),
  },
  { // ---- cat: small, up-curled tail, pointy ears ---------------------------
    // 1:1 -> back ~0.3m, ~0.5m long (tabby)
    name: "cat",
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .1, len: .3 }, geomRot: [0, 0, 90], pos: [0, .2, 0], color: 0xc77b3a },
      { id: "head", parent: "body", shape: "sphere", size: { r: .09 }, pos: [.24, .08, 0], color: 0xc77b3a, anim: { axis: "y", deg: 22, speed: .4, phase: 0 } },
      { id: "snout", parent: "head", shape: "sphere", size: { r: .045 }, pos: [.07, -.02, 0], color: 0xdba573 },
      { id: "earL", parent: "head", shape: "cone", size: { r: .035, h: .07 }, pos: [-.02, .075, .05], rot: [18, 0, 0], color: 0xb06f34 },
      { id: "earR", parent: "head", shape: "cone", size: { r: .035, h: .07 }, pos: [-.02, .075, -.05], rot: [-18, 0, 0], color: 0xb06f34 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .017 }, pos: [.06, .035, .045], color: 0x8fa03a },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .017 }, pos: [.06, .035, -.045], color: 0x8fa03a },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .025, len: .28 }, pos: [-.24, .05, 0], rot: [0, 0, 35], pivot: [0, .14, 0], color: 0xb06f34, anim: { axis: "z", deg: 18, speed: .9, phase: 0 } },
      ...legs({ len: .09, r: .03, spreadX: .13, spreadZ: .06, dropY: -.08, color: 0xb06f34, speed: .8, deg: 7 }),
    ], 1),
  },
  { // ---- fox: big brush tail with white tip, narrow pale snout -------------
    // 1:1 -> back ~0.46m
    name: "fox",
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .13, len: .38 }, geomRot: [0, 0, 90], pos: [0, .33, 0], color: 0xc2571f },
      { id: "head", parent: "body", shape: "sphere", size: { r: .1 }, pos: [.28, .09, 0], color: 0xc2571f, anim: { axis: "y", deg: 20, speed: .4, phase: .2 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .04, len: .14 }, pos: [.08, -.02, 0], rot: [0, 0, -78], pivot: [0, .07, 0], color: 0xd9c8b8 },
      { id: "earL", parent: "head", shape: "cone", size: { r: .045, h: .1 }, pos: [-.02, .09, .05], rot: [15, 0, 0], color: 0x53331c },
      { id: "earR", parent: "head", shape: "cone", size: { r: .045, h: .1 }, pos: [-.02, .09, -.05], rot: [-15, 0, 0], color: 0x53331c },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .018 }, pos: [.07, .045, .05], color: 0xc08326 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .018 }, pos: [.07, .045, -.05], color: 0xc08326 },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .06, len: .3 }, pos: [-.28, .03, 0], rot: [0, 0, 80], pivot: [0, .15, 0], color: 0xc2571f, anim: { axis: "z", deg: 14, speed: .7, phase: 0 } },
      { id: "tailTip", parent: "tail", shape: "sphere", size: { r: .055 }, pos: [0, .3, 0], color: 0xe8e0d5 },
      ...legs({ len: .17, r: .04, spreadX: .17, spreadZ: .08, dropY: -.12, color: 0x53331c, speed: .75, deg: 7 }),
    ], 1),
  },
  { // ---- eagle: golden eagle, ~2.2m span -- soars with slow wingbeats ------
    name: "eagle", fly: { alt: [20, 155], speed: [4, 8], hz: .4 }, active: "day",   // up to the cathedral spires
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .11, len: .4 }, geomRot: [0, 0, 90], pos: [0, .4, 0], color: 0x4b3520 },
      { id: "head", parent: "body", shape: "sphere", size: { r: .095 }, pos: [.28, .08, 0], color: 0x9a7a42 },
      { id: "beak", parent: "head", shape: "cone", size: { r: .03, h: .085 }, pos: [.09, -.01, 0], rot: [0, 0, -105], color: 0xd9b04a },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .02 }, pos: [.06, .03, .05], color: 0xd9a520 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .02 }, pos: [.06, .03, -.05], color: 0xd9a520 },
      { id: "tail", parent: "body", shape: "sphere", size: { r: .14 }, scale: [1.7, .18, 1], pos: [-.34, 0, 0], rot: [0, 0, 10], color: 0x5a4128 },
      { id: "wingL", parent: "body", shape: "sphere", size: { r: .42 }, scale: [.62, .08, 1.5], pos: [0, .05, .08], pivot: [0, 0, .35], color: 0x5a4128, anim: { axis: "x", deg: 35, speed: .4, phase: 0 } },
      { id: "wingR", parent: "body", shape: "sphere", size: { r: .42 }, scale: [.62, .08, 1.5], pos: [0, .05, -.08], pivot: [0, 0, -.35], color: 0x5a4128, anim: { axis: "x", deg: -35, speed: .4, phase: 0 } },
    ], 1),
  },
  { // ---- dog: leaner, floppy ears, narrow snout, up-curved tail -----------
    // x0.5 -> back ~0.59m, length ~0.85m (medium dog, labrador-ish)
    name: "dog",
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .36, len: .95 }, geomRot: [0, 0, 90], pos: [0, .81, 0], color: 0x9a6b3a },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .2, len: .3 }, pos: [.42, .15, 0], rot: [0, 0, -45], pivot: [0, .15, 0], color: 0x9a6b3a },
      { id: "head", parent: "neck", shape: "sphere", size: { r: .24 }, pos: [0, .3, 0], color: 0x9a6b3a, anim: { axis: "y", deg: 20, speed: .35, phase: .4 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .11, len: .3 }, pos: [.15, .04, 0], rot: [0, 0, -80], pivot: [0, .15, 0], color: 0xc9a06a },
      { id: "earL", parent: "head", shape: "sphere", size: { r: .12 }, pos: [-.08, .18, .2], scale: [.6, 1.4, .5], rot: [0, 0, 20], color: 0x6b4423 },
      { id: "earR", parent: "head", shape: "sphere", size: { r: .12 }, pos: [-.08, .18, -.2], scale: [.6, 1.4, .5], rot: [0, 0, 20], color: 0x6b4423 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .04 }, pos: [.18, .14, .11], color: 0x4a2f1a },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .04 }, pos: [.18, .14, -.11], color: 0x4a2f1a },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .055, len: .5 }, pos: [-.42, .12, 0], rot: [0, 0, 75], pivot: [0, .25, 0], color: 0x9a6b3a, anim: { axis: "z", deg: 20, speed: 1.3, phase: 0 } },
      ...legs({ len: .46, r: .11, spreadX: .34, spreadZ: .26, dropY: -.24, color: 0x86592e, speed: .7, deg: 6 }),
    ], .5),
  },
  { // ---- sheep: wool body + wool cap on a dark head, stub tail -------------
    // 1:1 -> back ~1.0m
    name: "sheep", mount: { h: 1.75, speed: 1.05 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .35, len: .6 }, geomRot: [0, 0, 90], pos: [0, .66, 0], color: 0xe6e0d4 },
      { id: "head", parent: "body", shape: "sphere", size: { r: .16 }, pos: [.62, .14, 0], color: 0x4a4038, anim: { axis: "y", deg: 14, speed: .3, phase: 0 } },
      { id: "wool", parent: "head", shape: "sphere", size: { r: .12 }, pos: [-.05, .1, 0], color: 0xe6e0d4 },
      { id: "earL", parent: "head", shape: "sphere", size: { r: .06 }, pos: [0, .02, .15], scale: [.9, .55, .35], color: 0x4a4038 },
      { id: "earR", parent: "head", shape: "sphere", size: { r: .06 }, pos: [0, .02, -.15], scale: [.9, .55, .35], color: 0x4a4038 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .025 }, pos: [.1, .06, .08], color: 0xb98a3a },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .025 }, pos: [.1, .06, -.08], color: 0xb98a3a },
      { id: "tail", parent: "body", shape: "sphere", size: { r: .07 }, pos: [-.62, .1, 0], color: 0xe6e0d4 },
      ...legs({ len: .35, r: .06, spreadX: .3, spreadZ: .18, dropY: -.25, color: 0x3f3831, speed: .5, deg: 5 }),
    ], 1),
  },
  { // ---- pig: flat snout disc, forward-flopped ears, twiggy tail ----------
    // 1:1 -> back ~0.89m, ~1.24m long
    name: "pig", mount: { h: 1.6, speed: 1.1 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .32, len: .6 }, geomRot: [0, 0, 90], pos: [0, .57, 0], color: 0xdba193 },
      { id: "head", parent: "body", shape: "sphere", size: { r: .22 }, pos: [.6, .06, 0], color: 0xdba193, anim: { axis: "y", deg: 14, speed: .3, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .09, len: .05 }, pos: [.19, -.02, 0], rot: [0, 0, -85], pivot: [0, .025, 0], color: 0xc98f80 },
      { id: "earL", parent: "head", shape: "cone", size: { r: .07, h: .13 }, pos: [-.02, .17, .11], rot: [-20, 0, -35], color: 0xc98f80 },
      { id: "earR", parent: "head", shape: "cone", size: { r: .07, h: .13 }, pos: [-.02, .17, -.11], rot: [20, 0, -35], color: 0xc98f80 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .022 }, pos: [.13, .08, .09], color: 0x2e2019 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .022 }, pos: [.13, .08, -.09], color: 0x2e2019 },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .02, len: .16 }, pos: [-.6, .12, 0], rot: [0, 0, -35], pivot: [0, -.08, 0], color: 0xc98f80, anim: { axis: "z", deg: 25, speed: 1.8, phase: 0 } },
      ...legs({ len: .28, r: .07, spreadX: .38, spreadZ: .2, dropY: -.22, color: 0xc98f80, speed: .5, deg: 5 }),
    ], 1),
  },
  { // ---- wolf: dog silhouette, grey coat, pointed ears, straighter tail ----
    // x0.68 -> back ~0.8m
    name: "wolf",
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .36, len: .95 }, geomRot: [0, 0, 90], pos: [0, .81, 0], color: 0x8c8c90 },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .2, len: .3 }, pos: [.42, .15, 0], rot: [0, 0, -45], pivot: [0, .15, 0], color: 0x8c8c90 },
      { id: "head", parent: "neck", shape: "sphere", size: { r: .24 }, pos: [0, .3, 0], color: 0x8c8c90, anim: { axis: "y", deg: 18, speed: .32, phase: .8 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .11, len: .3 }, pos: [.15, .04, 0], rot: [0, 0, -80], pivot: [0, .15, 0], color: 0xa8a8ac },
      { id: "earL", parent: "head", shape: "cone", size: { r: .09, h: .17 }, pos: [-.05, .24, .12], rot: [15, 0, 0], color: 0x5a5a60 },
      { id: "earR", parent: "head", shape: "cone", size: { r: .09, h: .17 }, pos: [-.05, .24, -.12], rot: [-15, 0, 0], color: 0x5a5a60 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .032 }, pos: [.18, .14, .11], color: 0xb99a3a },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .032 }, pos: [.18, .14, -.11], color: 0xb99a3a },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .075, len: .5 }, pos: [-.42, .1, 0], rot: [0, 0, 55], pivot: [0, .25, 0], color: 0x6e6e73, anim: { axis: "z", deg: 14, speed: .9, phase: 0 } },
      ...legs({ len: .46, r: .11, spreadX: .34, spreadZ: .26, dropY: -.24, color: 0x6e6e73, speed: .65, deg: 6 }),
    ], .68),
  },
  { // ---- deer: slim legs, antlers, pale stub tail --------------------------
    // 1:1 -> back ~1.19m
    name: "deer", mount: { h: 1.95, speed: 1.7 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .28, len: .8 }, geomRot: [0, 0, 90], pos: [0, .91, 0], color: 0xa5713d },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .11, len: .4 }, pos: [.42, .2, 0], rot: [0, 0, -35], pivot: [0, .2, 0], color: 0xa5713d },
      { id: "head", parent: "neck", shape: "sphere", size: { r: .14 }, pos: [0, .42, 0], color: 0xa5713d, anim: { axis: "y", deg: 18, speed: .35, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .06, len: .16 }, pos: [.1, -.01, 0], rot: [0, 0, -72], pivot: [0, .08, 0], color: 0x8a5c30 },
      { id: "earL", parent: "head", shape: "cone", size: { r: .055, h: .13 }, pos: [-.04, .11, .09], rot: [35, 0, 0], color: 0x8a5c30 },
      { id: "earR", parent: "head", shape: "cone", size: { r: .055, h: .13 }, pos: [-.04, .11, -.09], rot: [-35, 0, 0], color: 0x8a5c30 },
      { id: "antlerL", parent: "head", shape: "cone", size: { r: .028, h: .34 }, pos: [-.06, .12, .05], rot: [28, 0, -15], color: 0x8a7a64 },
      { id: "antlerR", parent: "head", shape: "cone", size: { r: .028, h: .34 }, pos: [-.06, .12, -.05], rot: [-28, 0, -15], color: 0x8a7a64 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .028 }, pos: [.09, .07, .08], color: 0x241812 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .028 }, pos: [.09, .07, -.08], color: 0x241812 },
      { id: "tail", parent: "body", shape: "sphere", size: { r: .05 }, pos: [-.42, .12, 0], color: 0xe0d6c6 },
      ...legs({ len: .55, r: .06, spreadX: .32, spreadZ: .18, dropY: -.3, color: 0x8a5c30, speed: .6, deg: 6 }),
    ], 1),
  },
  { // ---- tiger: lion's build, orange with SHADER stripes, white muzzle -----
    // x0.75 -> back ~1.1m (real Bengal tiger)
    name: "tiger", mount: { h: 2.0, speed: 1.8 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .48, len: 1.3 }, geomRot: [0, 0, 90], pos: [0, 1.0, 0], color: 0xd0772b, pat: "stripes" },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .24, len: .4 }, pos: [.55, .18, 0], rot: [0, 0, -50], pivot: [0, .2, 0], color: 0xd0772b, pat: "stripes" },
      { id: "head", parent: "neck", shape: "sphere", size: { r: .3 }, pos: [0, .38, 0], color: 0xd0772b, anim: { axis: "y", deg: 16, speed: .3, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .14, len: .22 }, pos: [.14, .02, 0], rot: [0, 0, -85], pivot: [0, .11, 0], color: 0xe8d7b8 },
      { id: "earL", parent: "head", shape: "cone", size: { r: .1, h: .16 }, pos: [-.08, .25, .11], rot: [22, 0, 0], color: 0xb35f1e },
      { id: "earR", parent: "head", shape: "cone", size: { r: .1, h: .16 }, pos: [-.08, .25, -.11], rot: [-22, 0, 0], color: 0xb35f1e },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .033 }, pos: [.21, .2, .13], color: 0xc08d3a },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .033 }, pos: [.21, .2, -.13], color: 0xc08d3a },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .05, len: .75 }, pos: [-.55, .15, 0], rot: [0, 0, 110], pivot: [0, .37, 0], color: 0xd0772b, pat: "stripes", anim: { axis: "z", deg: 14, speed: .8, phase: 0 } },
      { id: "tailTip", parent: "tail", shape: "sphere", size: { r: .07 }, pos: [0, .75, 0], color: 0x2b2118 },
      ...legs({ len: .55, r: .16, spreadX: .42, spreadZ: .34, dropY: -.29, color: 0xc46c24 }).map((p) => ({ ...p, pat: "stripes" })),
    ], .75),
  },
  { // ---- lion: neck+mane, tuft tail, rounded ears -------------------------
    // x0.75 -> back ~1.2m, body+head ~1.7m (real: 1.1-1.25m shoulder)
    name: "lion", mount: { h: 2.0, speed: 1.7 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .5, len: 1.15 }, geomRot: [0, 0, 90], pos: [0, 1.06, 0], color: 0xc9a227 },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .26, len: .48 }, pos: [.5, .2, 0], rot: [0, 0, -50], pivot: [0, .24, 0], color: 0xc9a227 },
      { id: "mane", parent: "neck", shape: "sphere", size: { r: .36 }, pos: [0, .28, 0], color: 0x8a5a1c },
      { id: "head", parent: "neck", shape: "sphere", size: { r: .33 }, pos: [0, .46, 0], color: 0xc9a227, anim: { axis: "y", deg: 16, speed: .3, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .15, len: .28 }, pos: [.16, .06, 0], rot: [0, 0, -88], pivot: [0, .14, 0], color: 0xe0c17a },
      { id: "earL", parent: "head", shape: "cone", size: { r: .12, h: .2 }, pos: [-.1, .28, .12], rot: [22, 0, 0], color: 0x8a5a1c },
      { id: "earR", parent: "head", shape: "cone", size: { r: .12, h: .2 }, pos: [-.1, .28, -.12], rot: [-22, 0, 0], color: 0x8a5a1c },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .033 }, pos: [.23, .27, .15], color: 0xc08d3a },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .033 }, pos: [.23, .27, -.15], color: 0xc08d3a },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .055, len: .7 }, pos: [-.5, .15, 0], rot: [0, 0, 115], pivot: [0, .35, 0], color: 0xc9a227, anim: { axis: "z", deg: 14, speed: .8, phase: 0 } },
      { id: "tailTuft", parent: "tail", shape: "sphere", size: { r: .15 }, pos: [0, .7, 0], color: 0x3a2a18 },
      ...legs({ len: .58, r: .16, spreadX: .4, spreadZ: .36, dropY: -.32, color: 0xb8941f }),
    ], .75),
  },
  { // ---- cow: no neck (head straight on body), horns, patches -------------
    // x0.95 -> back ~1.44m, length ~2.3m (real: ~1.4m shoulder)
    name: "cow", mount: { h: 2.25, speed: 1.2 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .58, len: 1.25 }, geomRot: [0, 0, 90], pos: [0, .935, 0], color: 0xe8e2d0 },
      { id: "patch1", parent: "body", shape: "sphere", size: { r: .16 }, pos: [.35, .3, .48], scale: [.85, .6, .3], color: 0x4a3828 },
      { id: "patch2", parent: "body", shape: "sphere", size: { r: .14 }, pos: [-.25, -.05, -.5], scale: [.9, .65, .3], color: 0x4a3828 },
      { id: "head", parent: "body", shape: "sphere", size: { r: .34 }, pos: [1.02, .28, 0], color: 0xe8e2d0, anim: { axis: "y", deg: 12, speed: .28, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .17, len: .22 }, pos: [.28, -.08, 0], rot: [0, 0, -80], pivot: [0, .11, 0], color: 0xcfc6ae },
      { id: "earL", parent: "head", shape: "cone", size: { r: .1, h: .16 }, pos: [0, .12, .32], rot: [90, 0, 20], color: 0xcfc6ae },
      { id: "earR", parent: "head", shape: "cone", size: { r: .1, h: .16 }, pos: [0, .12, -.32], rot: [-90, 0, 20], color: 0xcfc6ae },
      { id: "hornL", parent: "head", shape: "cone", size: { r: .035, h: .22 }, pos: [.05, .32, .16], rot: [40, 0, -10], color: 0xd8cbb0 },
      { id: "hornR", parent: "head", shape: "cone", size: { r: .035, h: .22 }, pos: [.05, .32, -.16], rot: [-40, 0, -10], color: 0xd8cbb0 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .032 }, pos: [.15, .18, .28], color: 0x2b1b10 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .032 }, pos: [.15, .18, -.28], color: 0x2b1b10 },
      // tail hangs from the TOP REAR of the body (hip), reaching hock height --
      // attaching it low/central left it swallowed by the body silhouette
      { id: "tail", parent: "body", shape: "capsule", size: { r: .045, len: .75 }, pos: [-1.05, .3, 0], rot: [0, 0, 12], pivot: [0, -.375, 0], color: 0xcfc6ae, anim: { axis: "z", deg: 10, speed: .6, phase: 0 } },
      { id: "tailTuft", parent: "tail", shape: "sphere", size: { r: .1 }, pos: [0, -.75, 0], color: 0x3a2e22 },
      ...legs({ len: .44, r: .155, spreadX: .46, spreadZ: .4, dropY: -.34, color: 0xd8cbb0, speed: .45, deg: 4 }),
    ], .95),
  },
  { // ---- ox: the draft animal -- a cow's frame, heavier, red-brown, with ---
    // long outward-curving horns (the yoke bears on the neck behind them);
    // 1:1 -> back ~1.55m, ~2.5m long (real draft oxen: 1.4-1.6m shoulder)
    name: "ox", mount: { h: 2.35, speed: 1.1 }, draft: { yokeX: .8, yokeY: 1.5, zSp: .78, shaftY: .85, spacing: 2.9, back: 2.2, single: 1.9, speed: .85 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .6, len: 1.3 }, geomRot: [0, 0, 90], pos: [0, .97, 0], color: 0x7a4527 },
      { id: "head", parent: "body", shape: "sphere", size: { r: .35 }, pos: [1.06, .24, 0], color: 0x7a4527, anim: { axis: "y", deg: 10, speed: .26, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .18, len: .22 }, pos: [.29, -.09, 0], rot: [0, 0, -80], pivot: [0, .11, 0], color: 0xc9b394 },
      { id: "earL", parent: "head", shape: "cone", size: { r: .1, h: .17 }, pos: [0, .1, .33], rot: [90, 0, 20], color: 0x8f5a3a },
      { id: "earR", parent: "head", shape: "cone", size: { r: .1, h: .17 }, pos: [0, .1, -.33], rot: [-90, 0, 20], color: 0x8f5a3a },
      { id: "hornL", parent: "head", shape: "cone", size: { r: .045, h: .46 }, pos: [.04, .3, .17], rot: [62, 0, -14], color: 0xe2d6bc },
      { id: "hornR", parent: "head", shape: "cone", size: { r: .045, h: .46 }, pos: [.04, .3, -.17], rot: [-62, 0, -14], color: 0xe2d6bc },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .032 }, pos: [.15, .17, .29], color: 0x2b1b10 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .032 }, pos: [.15, .17, -.29], color: 0x2b1b10 },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .045, len: .8 }, pos: [-1.08, .3, 0], rot: [0, 0, 12], pivot: [0, -.4, 0], color: 0x6a3b20, anim: { axis: "z", deg: 10, speed: .6, phase: 0 } },
      { id: "tailTuft", parent: "tail", shape: "sphere", size: { r: .1 }, pos: [0, -.8, 0], color: 0x2e2018 },
      ...legs({ len: .46, r: .16, spreadX: .48, spreadZ: .4, dropY: -.36, color: 0x6a3b20 }),
    ], 1),
  },
  { // ---- zebra: horse's build, white with SHADER stripes, dark mane --------
    // x0.9 -> shoulder ~1.35m
    name: "zebra", mount: { h: 2.3, speed: 1.8 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .4, len: 1.1 }, geomRot: [0, 0, 90], pos: [0, 1.125, 0], color: 0xe4e1d6, pat: "bands" },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .15, len: .5 }, pos: [.55, .26, 0], rot: [0, 0, -38], pivot: [0, .25, 0], color: 0xe4e1d6, pat: "bands" },
      { id: "mane", parent: "neck", shape: "capsule", size: { r: .06, len: .45 }, pos: [-.12, .05, 0], rot: [0, 0, 8], color: 0x2c2620 },
      { id: "head", parent: "neck", shape: "sphere", size: { r: .17 }, pos: [0, .56, 0], color: 0xe4e1d6, pat: "bands", anim: { axis: "y", deg: 14, speed: .3, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .085, len: .26 }, pos: [.12, -.02, 0], rot: [0, 0, -70], pivot: [0, .13, 0], color: 0x4a453e },
      { id: "earL", parent: "head", shape: "cone", size: { r: .045, h: .12 }, pos: [-.04, .17, .07], rot: [13, 0, 0], color: 0xd6d3c8 },
      { id: "earR", parent: "head", shape: "cone", size: { r: .045, h: .12 }, pos: [-.04, .17, -.07], rot: [-13, 0, 0], color: 0xd6d3c8 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .032 }, pos: [.11, .09, .09], color: 0x2a1a10 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .032 }, pos: [.11, .09, -.09], color: 0x2a1a10 },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .045, len: .5 }, pos: [-.95, .28, 0], rot: [0, 0, -15], pivot: [0, -.25, 0], color: 0xe4e1d6, anim: { axis: "z", deg: 8, speed: .5, phase: 0 } },
      { id: "tailTuft", parent: "tail", shape: "sphere", size: { r: .07 }, pos: [0, -.5, 0], color: 0x2c2620 },
      ...legs({ len: .68, r: .085, spreadX: .5, spreadZ: .2, dropY: -.36, color: 0xe4e1d6 }).map((p) => ({ ...p, pat: "bands" })),
    ], .9),
  },
  { // ---- horse: long legs, arched neck, mane strip, swishing tail ---------
    // 1:1 -> back ~1.61m, ~2.1m long
    name: "horse", mount: { h: 2.35, speed: 2 }, draft: { yokeX: .62, yokeY: 1.56, zSp: .7, shaftY: .95, spacing: 2.8, back: 2.1, single: 1.7, speed: 1.25 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .42, len: 1.3 }, geomRot: [0, 0, 90], pos: [0, 1.19, 0], color: 0x8a5a33 },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .17, len: .55 }, pos: [.62, .28, 0], rot: [0, 0, -38], pivot: [0, .27, 0], color: 0x8a5a33 },
      { id: "mane", parent: "neck", shape: "capsule", size: { r: .07, len: .5 }, pos: [-.14, .05, 0], rot: [0, 0, 8], color: 0x3a2a1c },
      { id: "head", parent: "neck", shape: "sphere", size: { r: .19 }, pos: [0, .62, 0], color: 0x8a5a33, anim: { axis: "y", deg: 14, speed: .3, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .095, len: .3 }, pos: [.14, -.02, 0], rot: [0, 0, -70], pivot: [0, .15, 0], color: 0x76492a },
      { id: "earL", parent: "head", shape: "cone", size: { r: .05, h: .13 }, pos: [-.05, .19, .08], rot: [15, 0, 0], color: 0x76492a },
      { id: "earR", parent: "head", shape: "cone", size: { r: .05, h: .13 }, pos: [-.05, .19, -.08], rot: [-15, 0, 0], color: 0x76492a },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .035 }, pos: [.12, .1, .1], color: 0x2a1a10 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .035 }, pos: [.12, .1, -.1], color: 0x2a1a10 },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .06, len: .65 }, pos: [-1.0, .3, 0], rot: [0, 0, -18], pivot: [0, -.32, 0], color: 0x3a2a1c, anim: { axis: "z", deg: 8, speed: .5, phase: 0 } },
      ...legs({ len: .75, r: .09, spreadX: .55, spreadZ: .22, dropY: -.35, color: 0x6e452a, speed: .5, deg: 5 }),
    ], 1),
  },
  { // ---- bear: bulky, round ears, stub tail, big paws (thick legs) --------
    // 1:1 -> back ~1.4m, ~2m long
    name: "bear", mount: { h: 2.15, speed: 1.4 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .48, len: 1.0 }, geomRot: [0, 0, 90], pos: [0, .92, 0], color: 0x6b4a2e },
      { id: "head", parent: "body", shape: "sphere", size: { r: .26 }, pos: [.92, .3, 0], color: 0x6b4a2e, anim: { axis: "y", deg: 12, speed: .28, phase: .5 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .11, len: .16 }, pos: [.18, -.04, 0], rot: [0, 0, -75], pivot: [0, .08, 0], color: 0xa07850 },
      { id: "earL", parent: "head", shape: "sphere", size: { r: .09 }, pos: [-.04, .22, .15], color: 0x59391f },
      { id: "earR", parent: "head", shape: "sphere", size: { r: .09 }, pos: [-.04, .22, -.15], color: 0x59391f },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .025 }, pos: [.15, .12, .11], color: 0x241812 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .025 }, pos: [.15, .12, -.11], color: 0x241812 },
      { id: "tail", parent: "body", shape: "sphere", size: { r: .09 }, pos: [-.98, -.05, 0], color: 0x59391f },
      ...legs({ len: .42, r: .15, spreadX: .42, spreadZ: .3, dropY: -.35, color: 0x59391f, speed: .4, deg: 4 }),
    ], 1),
  },
  { // ---- hippo: no neck, huge low-slung body, stubby legs, eyes+ears high --
    // 1:1 -> back ~1.48m, nose-to-tail ~3.5m (real: 1.5m / 3-4m)
    name: "hippo", mount: { h: 2.2, speed: 1.3 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .6, len: 1.9 }, geomRot: [0, 0, 90], pos: [0, .88, 0], color: 0x8a8a86 },
      { id: "head", parent: "body", shape: "sphere", size: { r: .42 }, pos: [1.5, .1, 0], scale: [1.15, .85, 1.1], color: 0x8a8a86, anim: { axis: "y", deg: 10, speed: .25, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .25, len: .1 }, pos: [.3, -.12, 0], rot: [0, 0, -80], pivot: [0, .05, 0], scale: [1, 1, 1.15], color: 0x9a9a94 },
      { id: "earL", parent: "head", shape: "sphere", size: { r: .075 }, pos: [.04, .33, .2], scale: [.8, .8, .4], color: 0x74746e },
      { id: "earR", parent: "head", shape: "sphere", size: { r: .075 }, pos: [.04, .33, -.2], scale: [.8, .8, .4], color: 0x74746e },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .03 }, pos: [.16, .33, .26], color: 0x3a251a },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .03 }, pos: [.16, .33, -.26], color: 0x3a251a },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .05, len: .28 }, pos: [-1.5, .12, 0], rot: [0, 0, 100], pivot: [0, .14, 0], color: 0x8a8a86, anim: { axis: "z", deg: 24, speed: 1.6, phase: 0 } },
      ...legs({ len: .4, r: .17, spreadX: .78, spreadZ: .38, dropY: -.31, color: 0x767672, speed: .4, deg: 4 }),
    ], 1),
  },
  { // ---- giraffe: towering neck, ossicones, patches, tufted rope tail -----
    // 1:1 -> back ~2.76m, head at ~4.3m
    name: "giraffe", mount: { h: 3.5, speed: 1.4 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .55, len: 1.1 }, geomRot: [0, 0, 90], pos: [0, 2.21, 0], color: 0xd2a04a, pat: "spots" },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .16, len: 1.5 }, pos: [.8, .42, 0], rot: [0, 0, -20], pivot: [0, .75, 0], color: 0xd2a04a, pat: "spots", anim: { axis: "z", deg: 4, speed: .2, phase: 0 } },
      { id: "head", parent: "neck", shape: "sphere", size: { r: .2 }, pos: [0, 1.62, 0], color: 0xd2a04a, anim: { axis: "y", deg: 12, speed: .25, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .1, len: .22 }, pos: [.13, -.02, 0], rot: [0, 0, -70], pivot: [0, .11, 0], color: 0xc0913f },
      { id: "ossiL", parent: "head", shape: "cone", size: { r: .035, h: .13 }, pos: [-.02, .19, .07], rot: [8, 0, 0], color: 0x9c6b28 },
      { id: "ossiR", parent: "head", shape: "cone", size: { r: .035, h: .13 }, pos: [-.02, .19, -.07], rot: [-8, 0, 0], color: 0x9c6b28 },
      { id: "earL", parent: "head", shape: "cone", size: { r: .05, h: .12 }, pos: [-.08, .13, .13], rot: [75, 0, 15], color: 0xc0913f },
      { id: "earR", parent: "head", shape: "cone", size: { r: .05, h: .12 }, pos: [-.08, .13, -.13], rot: [-75, 0, 15], color: 0xc0913f },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .035 }, pos: [.12, .1, .13], color: 0x241812 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .035 }, pos: [.12, .1, -.13], color: 0x241812 },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .04, len: .9 }, pos: [-1.05, .35, 0], rot: [0, 0, 15], pivot: [0, -.45, 0], color: 0xc0913f, anim: { axis: "z", deg: 10, speed: .6, phase: 0 } },
      { id: "tailTuft", parent: "tail", shape: "sphere", size: { r: .07 }, pos: [0, -.9, 0], color: 0x3a2a18 },
      ...legs({ len: 1.6, r: .11, spreadX: .5, spreadZ: .3, dropY: -.5, color: 0xc0913f, pat: "spots", speed: .35, deg: 4 }),
    ], 1),
  },
  { // ---- elephant: fan ears, hanging trunk, tusks, rope tail --------------
    // 1:1 -> back ~3m, ~4.3m body length (real: 2.7-3.3m shoulder)
    name: "elephant", mount: { h: 3.7, speed: 1.3 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: 1.05, len: 2.2 }, geomRot: [0, 0, 90], pos: [0, 1.93, 0], color: 0x9a938c },
      { id: "head", parent: "body", shape: "sphere", size: { r: .75 }, pos: [2.05, .55, 0], color: 0x9a938c, anim: { axis: "y", deg: 8, speed: .2, phase: 0 } },
      { id: "earL", parent: "head", shape: "sphere", size: { r: .58 }, pos: [-.12, .18, .64], scale: [.28, 1.1, .95], color: 0x8a847e },
      { id: "earR", parent: "head", shape: "sphere", size: { r: .58 }, pos: [-.12, .18, -.64], scale: [.28, 1.1, .95], color: 0x8a847e },
      { id: "trunk", parent: "head", shape: "capsule", size: { r: .15, len: 1.2 }, pos: [.62, -.25, 0], rot: [0, 0, -25], pivot: [0, -.6, 0], color: 0x9a938c, anim: { axis: "x", deg: 10, speed: .4, phase: 0 } },
      { id: "tuskL", parent: "head", shape: "cone", size: { r: .055, h: .5 }, pos: [.5, -.45, .28], rot: [0, 0, -140], color: 0xe8e2d2 },
      { id: "tuskR", parent: "head", shape: "cone", size: { r: .055, h: .5 }, pos: [.5, -.45, -.28], rot: [0, 0, -140], color: 0xe8e2d2 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .03 }, pos: [.42, .28, .5], color: 0x54371f },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .03 }, pos: [.42, .28, -.5], color: 0x54371f },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .05, len: .8 }, pos: [-2.05, .5, 0], rot: [0, 0, 10], pivot: [0, -.4, 0], color: 0x8a847e, anim: { axis: "z", deg: 12, speed: .7, phase: 0 } },
      ...legs({ len: 1.1, r: .28, spreadX: .72, spreadZ: .5, dropY: -.55, color: 0x8a847e, speed: .3, deg: 3 }),
    ], 1),
  },
  { // ---- snake: grass snake, 1.4m of chained segments slithering in a wave --
    // each segment hangs off the one before and swings about y a little
    // out of phase with it, so a sine travels down the body as it moves
    name: "snake",
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .032, len: .2 }, geomRot: [0, 0, 90], pos: [0, .035, 0], color: 0x6b7a3a },
      { id: "head", parent: "body", shape: "sphere", size: { r: .036 }, scale: [1.5, .7, 1.1], pos: [.15, .005, 0], color: 0x6b7a3a, anim: { axis: "y", deg: 12, speed: .8, phase: 0 } },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.03, .012, .03], color: 0xd9a520 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.03, .012, -.03], color: 0xd9a520 },
      { id: "tongue", parent: "head", shape: "cone", size: { r: .004, h: .05 }, pos: [.06, -.005, 0], rot: [0, 0, -90], color: 0xb03030, anim: { axis: "y", deg: 15, speed: 2.5, phase: 0 } },
      // the body capsule is centered on its origin, so its cylinder ends at
      // x = -.1: the first segment hangs there; every later one hangs at the
      // previous segment's far end (-.2 in its frame, whose origin is its front)
      ...[1, 2, 3, 4, 5, 6].map((i) => ({ id: "seg" + i, parent: i === 1 ? "body" : "seg" + (i - 1), shape: "capsule",
        size: { r: .032 - i * .003, len: .2 }, geomRot: [0, 0, 90], pos: [i === 1 ? -.1 : -.2, 0, 0], pivot: [-.1, 0, 0], color: i % 2 ? 0x5f6e33 : 0x6b7a3a,
        anim: { axis: "y", deg: 22, speed: .8, phase: i * 1.1 } })),
    ], 1),
  },
  { // ---- rat: brown rat, 25cm body + 20cm naked tail, 8cm at the shoulder ---
    name: "rat",
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .045, len: .14 }, geomRot: [0, 0, 90], pos: [0, .07, 0], color: 0x6b5a4a },
      { id: "head", parent: "body", shape: "sphere", size: { r: .04 }, scale: [1.3, .9, .9], pos: [.11, .015, 0], color: 0x6b5a4a, anim: { axis: "y", deg: 20, speed: .6, phase: 0 } },
      { id: "snout", parent: "head", shape: "cone", size: { r: .018, h: .04 }, pos: [.05, -.008, 0], rot: [0, 0, -90], color: 0xd9b8a8 },
      { id: "earL", parent: "head", shape: "sphere", size: { r: .016 }, scale: [.6, 1, 1], pos: [-.01, .035, .025], color: 0xc9a090 },
      { id: "earR", parent: "head", shape: "sphere", size: { r: .016 }, scale: [.6, 1, 1], pos: [-.01, .035, -.025], color: 0xc9a090 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.03, .015, .028], color: 0x1a1210 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.03, .015, -.028], color: 0x1a1210 },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .007, len: .2 }, pos: [-.1, -.01, 0], rot: [0, 0, -80], pivot: [0, -.1, 0], color: 0xc9a090, anim: { axis: "y", deg: 20, speed: .7, phase: 0 } },   // trails behind, nearly level
      ...legs({ len: .05, r: .012, spreadX: .06, spreadZ: .035, dropY: -.03, color: 0xc9a090 }),
    ], 1),
  },
  { // ---- wild boar: 1.5m long, .9m at the shoulder, bristle mane, tusks ------
    name: "boar", mount: { h: 1.5, speed: 1.3 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .32, len: .8 }, geomRot: [0, 0, 90], pos: [0, .62, 0], color: 0x4a3a2c, pat: "bark" },
      { id: "mane", parent: "body", shape: "capsule", size: { r: .07, len: .7 }, geomRot: [0, 0, 90], pos: [.05, .3, 0], color: 0x2e2419 },
      { id: "head", parent: "body", shape: "sphere", size: { r: .24 }, scale: [1.3, .9, .85], pos: [.62, -.05, 0], color: 0x4a3a2c, anim: { axis: "y", deg: 10, speed: .35, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .09, len: .16 }, pos: [.3, -.1, 0], rot: [0, 0, -75], pivot: [0, .08, 0], color: 0x3a2d22 },
      { id: "nose", parent: "snout", shape: "sphere", size: { r: .06 }, scale: [.6, 1, 1], pos: [0, .17, 0], color: 0x6a5548 },
      { id: "tuskL", parent: "head", shape: "cone", size: { r: .02, h: .1 }, pos: [.26, -.14, .09], rot: [30, 0, 20], color: 0xe8e0cc },
      { id: "tuskR", parent: "head", shape: "cone", size: { r: .02, h: .1 }, pos: [.26, -.14, -.09], rot: [-30, 0, 20], color: 0xe8e0cc },
      { id: "earL", parent: "head", shape: "cone", size: { r: .06, h: .12 }, pos: [-.02, .18, .16], rot: [50, 0, 10], color: 0x3a2d22 },
      { id: "earR", parent: "head", shape: "cone", size: { r: .06, h: .12 }, pos: [-.02, .18, -.16], rot: [-50, 0, 10], color: 0x3a2d22 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .022 }, pos: [.17, .08, .17], color: 0x1a1210 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .022 }, pos: [.17, .08, -.17], color: 0x1a1210 },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .02, len: .25 }, pos: [-.7, .15, 0], rot: [0, 0, -20], pivot: [0, -.12, 0], color: 0x2e2419, anim: { axis: "z", deg: 25, speed: 1.2, phase: 0 } },
      ...legs({ len: .35, r: .06, spreadX: .38, spreadZ: .18, dropY: -.22, color: 0x2e2419 }),
    ], 1),
  },
  { // ---- swan: mute swan, 1.5m, S-neck, floats half-submerged on the lake --
    name: "swan", swim: { depth: .18 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .22, len: .5 }, geomRot: [0, 0, 90], pos: [0, .2, 0], color: 0xf4f2ec },
      { id: "wingL", parent: "body", shape: "sphere", size: { r: .3 }, scale: [1.2, .55, .35], pos: [-.05, .14, .16], rot: [-18, 0, 0], color: 0xf4f2ec },
      { id: "wingR", parent: "body", shape: "sphere", size: { r: .3 }, scale: [1.2, .55, .35], pos: [-.05, .14, -.16], rot: [18, 0, 0], color: 0xf4f2ec },
      { id: "tail", parent: "body", shape: "cone", size: { r: .07, h: .22 }, pos: [-.38, .1, 0], rot: [0, 0, 110], color: 0xf4f2ec },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .05, len: .32 }, pos: [.3, .18, 0], rot: [0, 0, -30], pivot: [0, .16, 0], color: 0xf4f2ec, anim: { axis: "z", deg: 5, speed: .3, phase: 0 } },
      { id: "neck2", parent: "neck", shape: "capsule", size: { r: .045, len: .3 }, pos: [0, .34, 0], rot: [0, 0, 40], pivot: [0, .15, 0], color: 0xf4f2ec, anim: { axis: "z", deg: 6, speed: .3, phase: 1 } },
      { id: "head", parent: "neck2", shape: "sphere", size: { r: .055 }, scale: [1.5, .9, .9], pos: [.04, .32, 0], color: 0xf4f2ec, anim: { axis: "y", deg: 14, speed: .3, phase: 0 } },
      { id: "beak", parent: "head", shape: "cone", size: { r: .028, h: .09 }, pos: [.1, -.01, 0], rot: [0, 0, -90], color: 0xe0782a },
      { id: "knob", parent: "head", shape: "sphere", size: { r: .018 }, pos: [.065, .02, 0], color: 0x1a1210 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.04, .02, .045], color: 0x1a1210 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.04, .02, -.045], color: 0x1a1210 },
    ], 1),
  },
  { // ---- duck: mallard drake, 55cm, green head, white collar, curled tail ---
    name: "duck", swim: { depth: .07 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .1, len: .22 }, geomRot: [0, 0, 90], pos: [0, .09, 0], color: 0x8a7f6e },
      { id: "breast", parent: "body", shape: "sphere", size: { r: .09 }, scale: [.8, .9, 1], pos: [.1, -.01, 0], color: 0x5a3d2e },
      { id: "wingL", parent: "body", shape: "sphere", size: { r: .13 }, scale: [1.1, .4, .3], pos: [-.02, .06, .08], color: 0x6f665a },
      { id: "wingR", parent: "body", shape: "sphere", size: { r: .13 }, scale: [1.1, .4, .3], pos: [-.02, .06, -.08], color: 0x6f665a },
      { id: "tail", parent: "body", shape: "cone", size: { r: .035, h: .1 }, pos: [-.17, .05, 0], rot: [0, 0, 125], color: 0x2a2622 },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .035, len: .06 }, pos: [.15, .08, 0], rot: [0, 0, -25], pivot: [0, .03, 0], color: 0xf0ede4 },
      { id: "head", parent: "neck", shape: "sphere", size: { r: .055 }, scale: [1.2, 1, .9], pos: [.01, .09, 0], color: 0x2e6b3a, anim: { axis: "y", deg: 18, speed: .5, phase: 0 } },
      { id: "beak", parent: "head", shape: "cone", size: { r: .022, h: .06 }, pos: [.065, -.01, 0], rot: [0, 0, -90], color: 0xd9b83c },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.035, .015, .045], color: 0x1a1210 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.035, .015, -.045], color: 0x1a1210 },
    ], 1),
  },
  { // ---- peacock: 1m bird, iridescent neck, crest, a 1.2m fan of eyed plumes
    name: "peacock",
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .13, len: .3 }, geomRot: [0, 0, 90], pos: [0, .38, 0], color: 0x1f7a4a },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .045, len: .3 }, pos: [.15, .1, 0], rot: [0, 0, -18], pivot: [0, .15, 0], color: 0x1c3f9a, anim: { axis: "z", deg: 5, speed: .4, phase: 0 } },
      { id: "head", parent: "neck", shape: "sphere", size: { r: .05 }, scale: [1.3, .9, .9], pos: [.02, .32, 0], color: 0x1c3f9a, anim: { axis: "y", deg: 22, speed: .5, phase: 0 } },
      { id: "beak", parent: "head", shape: "cone", size: { r: .018, h: .05 }, pos: [.06, -.01, 0], rot: [0, 0, -90], color: 0x9a9080 },
      { id: "crestStalk", parent: "head", shape: "capsule", size: { r: .004, len: .06 }, pos: [0, .06, 0], color: 0x1c3f9a },
      { id: "crest", parent: "crestStalk", shape: "sphere", size: { r: .022 }, scale: [1.4, .6, 1], pos: [0, .045, 0], color: 0x2a6fd0 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.035, .015, .04], color: 0x1a1210 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.035, .015, -.04], color: 0x1a1210 },
      // the train: seven flat plumes fanned about x behind the tail, leaning back, eyespots in the shader
      ...[-3, -2, -1, 0, 1, 2, 3].map((k) => ({ id: "plume" + (k + 3), parent: "body", shape: "tri",
        size: { a: [0, 0, 0], b: [-.35, 1.15, .16], c: [-.35, 1.15, -.16], r: .025 },
        pos: [-.22, .02, 0], rot: [k * 24, 0, 32], color: k % 2 ? 0x1f7a4a : 0x2a8a52, pat: "wingspots" })),
      { id: "legL", parent: "body", shape: "capsule", size: { r: .012, len: .24 }, pos: [.02, -.14, .05], pivot: [0, -.12, 0], color: 0x8a8070, anim: { axis: "z", deg: 26, speed: .8, phase: 0 } },
      { id: "legR", parent: "body", shape: "capsule", size: { r: .012, len: .24 }, pos: [.02, -.14, -.05], pivot: [0, -.12, 0], color: 0x8a8070, anim: { axis: "z", deg: 26, speed: .8, phase: 3.14 } },
    ], 1),
  },
  { // ---- crocodile: 3.5m, low and flat, long jaws, tail swaying -- on the shore
    name: "crocodile", shore: true,
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .28, len: 1.3 }, geomRot: [0, 0, 90], scale: [1, .62, 1.15], pos: [0, .26, 0], color: 0x4f5c3a, pat: "bark" },
      { id: "belly", parent: "body", shape: "capsule", size: { r: .2, len: 1.2 }, geomRot: [0, 0, 90], pos: [0, -.1, 0], color: 0x9a9a6a },
      { id: "head", parent: "body", shape: "sphere", size: { r: .2 }, scale: [1.2, .55, 1], pos: [.85, .03, 0], color: 0x4f5c3a, anim: { axis: "y", deg: 8, speed: .25, phase: 0 } },
      { id: "jaw", parent: "head", shape: "capsule", size: { r: .13, len: .5 }, pos: [.3, -.02, 0], rot: [0, 0, -88], pivot: [0, .25, 0], scale: [1, 1, 1.1], color: 0x4f5c3a },
      { id: "jawLow", parent: "jaw", shape: "capsule", size: { r: .1, len: .45 }, pos: [.02, .02, 0], color: 0x8a8a5a },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .035 }, pos: [.05, .1, .12], color: 0xc9a520 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .035 }, pos: [.05, .1, -.12], color: 0xc9a520 },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .19, len: .7 }, pos: [-.85, 0, 0], rot: [0, 0, 90], pivot: [0, .35, 0], color: 0x4f5c3a, pat: "bark", anim: { axis: "y", deg: 12, speed: .5, phase: 0 } },
      { id: "tail2", parent: "tail", shape: "capsule", size: { r: .1, len: .8 }, pos: [0, .72, 0], pivot: [0, .4, 0], color: 0x46523a, anim: { axis: "x", deg: 16, speed: .5, phase: 1.2 } },
      ...legs({ len: .22, r: .07, spreadX: .55, spreadZ: .29, dropY: -.06, color: 0x46523a }),   // hips inside the flattened belly (the body is only ~.2 wide that low)
    ], 1),
  },
  { // ---- frog: edible frog, 10cm, bulging eyes, folded hind legs --------------
    name: "frog", shore: true, hop: { period: .9, h: .16 },   // travels in hops: ~.5m long, .16m high, always landing before a rest
    parts: scaleParts([
      { id: "body", parent: null, shape: "sphere", size: { r: .05 }, scale: [1.35, .8, 1], pos: [0, .045, 0], color: 0x5a9a3a },
      { id: "stripe", parent: "body", shape: "capsule", size: { r: .008, len: .09 }, geomRot: [0, 0, 90], pos: [0, .038, 0], color: 0xa8d060 },
      { id: "eyeL", parent: "body", shape: "sphere", size: { r: .014 }, pos: [.045, .04, .028], color: 0x2a1a08 },
      { id: "eyeR", parent: "body", shape: "sphere", size: { r: .014 }, pos: [.045, .04, -.028], color: 0x2a1a08 },
      { id: "thighL", parent: "body", shape: "capsule", size: { r: .014, len: .06 }, pos: [-.03, -.02, .045], rot: [0, 0, 70], pivot: [0, -.03, 0], color: 0x4a8a30, anim: { axis: "z", deg: 30, speed: .8, phase: 0 } },
      { id: "thighR", parent: "body", shape: "capsule", size: { r: .014, len: .06 }, pos: [-.03, -.02, -.045], rot: [0, 0, 70], pivot: [0, -.03, 0], color: 0x4a8a30, anim: { axis: "z", deg: 30, speed: .8, phase: 0 } },
      { id: "shinL", parent: "thighL", shape: "capsule", size: { r: .01, len: .06 }, pos: [0, -.06, 0], rot: [0, 0, -120], pivot: [0, -.03, 0], color: 0x4a8a30 },
      { id: "shinR", parent: "thighR", shape: "capsule", size: { r: .01, len: .06 }, pos: [0, -.06, 0], rot: [0, 0, -120], pivot: [0, -.03, 0], color: 0x4a8a30 },
      { id: "legFL", parent: "body", shape: "capsule", size: { r: .008, len: .04 }, pos: [.04, -.03, .035], pivot: [0, -.02, 0], color: 0x4a8a30, anim: { axis: "z", deg: 24, speed: .8, phase: 3.14 } },
      { id: "legFR", parent: "body", shape: "capsule", size: { r: .008, len: .04 }, pos: [.04, -.03, -.035], pivot: [0, -.02, 0], color: 0x4a8a30, anim: { axis: "z", deg: 24, speed: .8, phase: 3.14 } },
    ], 1),
  },
  { // ---- turtle: pond turtle, 25cm shell, stubby legs, head on a short neck --
    name: "turtle", shore: true,
    parts: scaleParts([
      { id: "body", parent: null, shape: "sphere", size: { r: .12 }, scale: [1.2, .55, 1], pos: [0, .085, 0], color: 0x4a5a2e, pat: "scutes" },
      { id: "plastron", parent: "body", shape: "sphere", size: { r: .1 }, scale: [1.2, .3, .95], pos: [0, -.04, 0], color: 0xb8a878 },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .022, len: .06 }, pos: [.13, -.01, 0], rot: [0, 0, -80], pivot: [0, .03, 0], color: 0x6a7a3a },
      { id: "head", parent: "neck", shape: "sphere", size: { r: .03 }, scale: [1.3, .9, .9], pos: [0, .07, 0], color: 0x6a7a3a, anim: { axis: "y", deg: 18, speed: .3, phase: 0 } },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.02, .012, .022], color: 0x1a1210 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.02, .012, -.022], color: 0x1a1210 },
      { id: "tail", parent: "body", shape: "cone", size: { r: .015, h: .05 }, pos: [-.14, -.03, 0], rot: [0, 0, 100], color: 0x6a7a3a },
      ...legs({ len: .05, r: .02, spreadX: .09, spreadZ: .09, dropY: -.04, color: 0x6a7a3a }),
    ], 1),
  },
  { // ---- hedgehog: 25cm, a ball of spines on short legs, pale pointed snout --
    name: "hedgehog",
    parts: scaleParts([
      { id: "body", parent: null, shape: "sphere", size: { r: .1 }, scale: [1.3, .9, 1], pos: [0, .09, 0], color: 0x5a4a3c, pat: "bark" },
      ...Array.from({ length: 14 }, (_, i) => {   // spines: cones bristling over the back
        const a = (i % 7) / 6 * Math.PI - Math.PI / 2, row = i < 7 ? .04 : -.05;
        return { id: "spine" + i, parent: "body", shape: "cone", size: { r: .012, h: .05 },
                 pos: [row, .06 * Math.cos(a) + .02, .08 * Math.sin(a)], rot: [-a * 57.3 * .8, 0, (i < 7 ? 15 : -15)], color: 0xd9cdb0 };
      }),
      { id: "head", parent: "body", shape: "cone", size: { r: .045, h: .1 }, pos: [.13, -.03, 0], rot: [0, 0, -95], color: 0x9a8a78 },
      { id: "nose", parent: "head", shape: "sphere", size: { r: .012 }, pos: [0, .1, 0], color: 0x1a1210 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.02, .05, .028], color: 0x1a1210 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.02, .05, -.028], color: 0x1a1210 },
      ...legs({ len: .04, r: .012, spreadX: .07, spreadZ: .06, dropY: -.055, color: 0x6a5a4a }),
    ], 1),
  },
  { // ---- scorpion: emperor scorpion, 20cm, pincers ahead, tail curled over --
    name: "scorpion",
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .025, len: .07 }, geomRot: [0, 0, 90], pos: [0, .03, 0], color: 0x1e1a1a },
      { id: "head", parent: "body", shape: "sphere", size: { r: .022 }, scale: [1.2, .7, 1.1], pos: [.05, 0, 0], color: 0x1e1a1a },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.008, .012, .012], color: 0x3a3030 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.008, .012, -.012], color: 0x3a3030 },
      ...[1, -1].map((s) => ({ id: "arm" + (s > 0 ? "L" : "R"), parent: "head", shape: "capsule", size: { r: .008, len: .06 }, pos: [.02, -.005, s * .025], rot: [0, s * -35, -70], pivot: [0, .03, 0], color: 0x1e1a1a, anim: { axis: "y", deg: 10, speed: .6, phase: s } })),
      ...[1, -1].map((s) => ({ id: "claw" + (s > 0 ? "L" : "R"), parent: "arm" + (s > 0 ? "L" : "R"), shape: "sphere", size: { r: .02 }, scale: [1.5, .6, 1], pos: [0, .07, 0], color: 0x2a2222 })),
      // the tail: five spheres in a rising arc that curls forward over the back, then the sting
      ...[1, 2, 3, 4, 5].map((i) => ({ id: "tail" + i, parent: i === 1 ? "body" : "tail" + (i - 1), shape: "sphere", size: { r: .016 - i * .001 },
        pos: i === 1 ? [-.055, .015, 0] : [-.018 + i * .006, .022, 0], color: 0x1e1a1a, anim: { axis: "z", deg: 4, speed: .5, phase: i * .6 } })),
      { id: "sting", parent: "tail5", shape: "cone", size: { r: .008, h: .03 }, pos: [.015, .008, 0], rot: [0, 0, -50], color: 0x6a2a1a },
      ...[1, -1].flatMap((s) => [0, 1, 2, 3].map((k) => ({ id: "leg" + k + (s > 0 ? "L" : "R"), parent: "body", shape: "capsule", size: { r: .005, len: .05 },
        pos: [.03 - k * .022, -.01, s * .025], rot: [s * 60, 0, 0], pivot: [0, -.025, 0], color: 0x2a2222,
        anim: { axis: "z", deg: 20, speed: .8, phase: (k + (s > 0 ? 0 : 1)) % 2 * 3.14 } }))),
    ], 1),
  },
  { // ---- beaver: 1m with the paddle tail, 30cm tall, orange incisors -- shore
    name: "beaver", shore: true,
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .16, len: .35 }, geomRot: [0, 0, 90], pos: [0, .19, 0], color: 0x4a3222 },
      { id: "head", parent: "body", shape: "sphere", size: { r: .11 }, scale: [1.2, .9, 1], pos: [.3, .04, 0], color: 0x4a3222, anim: { axis: "y", deg: 16, speed: .4, phase: 0 } },
      { id: "snout", parent: "head", shape: "sphere", size: { r: .06 }, scale: [1.1, .8, 1], pos: [.1, -.03, 0], color: 0x5a4030 },
      { id: "nose", parent: "snout", shape: "sphere", size: { r: .02 }, pos: [.06, .01, 0], color: 0x1a1210 },
      { id: "toothL", parent: "snout", shape: "cone", size: { r: .008, h: .035 }, pos: [.05, -.03, .012], rot: [0, 0, 180], color: 0xe08a30 },
      { id: "toothR", parent: "snout", shape: "cone", size: { r: .008, h: .035 }, pos: [.05, -.03, -.012], rot: [0, 0, 180], color: 0xe08a30 },
      { id: "earL", parent: "head", shape: "sphere", size: { r: .022 }, pos: [-.02, .09, .07], color: 0x3a2618 },
      { id: "earR", parent: "head", shape: "sphere", size: { r: .022 }, pos: [-.02, .09, -.07], color: 0x3a2618 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .014 }, pos: [.07, .04, .075], color: 0x1a1210 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .014 }, pos: [.07, .04, -.075], color: 0x1a1210 },
      // the paddle: a flat scaled sphere hinged at the rump, swinging side to side
      // (the pivot is scaled with the paddle, so its center sits .2 behind the hinge: the near end tucks under the rump)
      { id: "tail", parent: "body", shape: "sphere", size: { r: .16 }, scale: [1.7, .2, .9], pos: [-.34, -.08, 0], pivot: [-.12, 0, 0], color: 0x2e2018, pat: "diamond", anim: { axis: "y", deg: 12, speed: .5, phase: 0 } },
      ...legs({ len: .1, r: .035, spreadX: .2, spreadZ: .12, dropY: -.11, color: 0x3a2618 }),
    ], 1),
  },
  { // ---- camel: dromedary, 1.9m at the hump, 3m long, long legs and neck --
    name: "camel", mount: { h: 2.9, speed: 1.6 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .42, len: 1.2 }, geomRot: [0, 0, 90], pos: [0, 1.35, 0], color: 0xc6a06a },
      { id: "hump", parent: "body", shape: "sphere", size: { r: .34 }, scale: [1.1, 1, .9], pos: [-.05, .38, 0], color: 0xbb9460 },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .16, len: .5 }, pos: [.6, -.05, 0], rot: [0, 0, -55], pivot: [0, .25, 0], color: 0xc6a06a },
      { id: "neck2", parent: "neck", shape: "capsule", size: { r: .14, len: .55 }, pos: [0, .5, 0], rot: [0, 0, 40], pivot: [0, .27, 0], color: 0xc6a06a, anim: { axis: "z", deg: 5, speed: .3, phase: 0 } },
      { id: "head", parent: "neck2", shape: "sphere", size: { r: .17 }, scale: [1.5, .85, .9], pos: [.06, .58, 0], color: 0xc6a06a, anim: { axis: "y", deg: 14, speed: .3, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .09, len: .2 }, pos: [.2, -.04, 0], rot: [0, 0, -75], pivot: [0, .1, 0], color: 0xb08a58 },
      { id: "earL", parent: "head", shape: "cone", size: { r: .035, h: .09 }, pos: [-.06, .13, .1], rot: [20, 0, 0], color: 0xb08a58 },
      { id: "earR", parent: "head", shape: "cone", size: { r: .035, h: .09 }, pos: [-.06, .13, -.1], rot: [-20, 0, 0], color: 0xb08a58 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .03 }, pos: [.1, .06, .12], color: 0x2a1a10 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .03 }, pos: [.1, .06, -.12], color: 0x2a1a10 },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .035, len: .5 }, pos: [-.95, .2, 0], rot: [0, 0, -10], pivot: [0, -.25, 0], color: 0xb08a58, anim: { axis: "z", deg: 10, speed: .5, phase: 0 } },
      { id: "tailTuft", parent: "tail", shape: "sphere", size: { r: .06 }, pos: [0, -.5, 0], color: 0x6a4a2a },
      ...legs({ len: .95, r: .09, spreadX: .5, spreadZ: .22, dropY: -.4, color: 0xb08a58 }),
    ], 1),
  },
  { // ---- bat: a common bat, 50cm span, out only at night, jinking low over the fields
    name: "bat", fly: { alt: [2, 9], speed: [3, 6], hz: 5 }, active: "night",   // low, at roof height, where it can be seen
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .022, len: .05 }, geomRot: [0, 0, 90], pos: [0, .2, 0], color: 0x000000 },
      { id: "head", parent: "body", shape: "sphere", size: { r: .02 }, pos: [.04, .008, 0], color: 0x000000 },
      { id: "earL", parent: "head", shape: "cone", size: { r: .007, h: .022 }, pos: [-.005, .018, .01], rot: [15, 0, 5], color: 0x000000 },
      { id: "earR", parent: "head", shape: "cone", size: { r: .007, h: .022 }, pos: [-.005, .018, -.01], rot: [-15, 0, 5], color: 0x000000 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.014, .005, .011], color: 0x000000 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.014, .005, -.011], color: 0x000000 },
      // wings: flat membrane triangles from the shoulder, flapping fast about x
      { id: "wingL", parent: "body", shape: "tri", size: { a: [0, 0, 0], b: [.02, 0, .15], c: [-.06, 0, .12], r: .008 }, pos: [0, .01, .015], rot: [0, 0, 0], color: 0x000000, anim: { axis: "x", deg: 40, speed: 5, phase: 0, wing: true } },
      { id: "wingR", parent: "body", shape: "tri", size: { a: [0, 0, 0], b: [.02, 0, -.15], c: [-.06, 0, -.12], r: .008 }, pos: [0, .01, -.015], rot: [0, 0, 0], color: 0x000000, anim: { axis: "x", deg: -40, speed: 5, phase: 0, wing: true } },
    ], 1.67),   // 50cm span
  },
  { // ================= MONSTERS =================
    // ---- unicorn: pale horse, golden horn, blue eyes ----------------------
    name: "unicorn", mount: { h: 2.35, speed: 1.9 }, monster: true,
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .42, len: 1.15 }, geomRot: [0, 0, 90], pos: [0, 1.18, 0], color: 0xeceae2 },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .16, len: .55 }, pos: [.58, .28, 0], rot: [0, 0, -40], pivot: [0, .27, 0], color: 0xeceae2 },
      { id: "mane", parent: "neck", shape: "capsule", size: { r: .065, len: .5 }, pos: [-.13, .05, 0], rot: [0, 0, 8], color: 0xc8d4ea },
      { id: "head", parent: "neck", shape: "sphere", size: { r: .18 }, pos: [0, .62, 0], color: 0xeceae2, anim: { axis: "y", deg: 14, speed: .3, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .09, len: .28 }, pos: [.13, -.02, 0], rot: [0, 0, -70], pivot: [0, .14, 0], color: 0xdcd8cc },
      { id: "horn", parent: "head", shape: "cone", size: { r: .035, h: .5 }, pos: [.08, .15, 0], rot: [0, 0, -30], color: 0xd9c06a },
      { id: "earL", parent: "head", shape: "cone", size: { r: .045, h: .12 }, pos: [-.05, .17, .07], rot: [14, 0, 0], color: 0xdcd8cc },
      { id: "earR", parent: "head", shape: "cone", size: { r: .045, h: .12 }, pos: [-.05, .17, -.07], rot: [-14, 0, 0], color: 0xdcd8cc },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .033 }, pos: [.12, .09, .1], color: 0x3a5a8e },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .033 }, pos: [.12, .09, -.1], color: 0x3a5a8e },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .06, len: .6 }, pos: [-1.0, .3, 0], rot: [0, 0, -18], pivot: [0, -.3, 0], color: 0xc8d4ea, anim: { axis: "z", deg: 8, speed: .5, phase: 0 } },
      ...legs({ len: .75, r: .09, spreadX: .55, spreadZ: .22, dropY: -.34, color: 0xe2dfd4 }),
    ], .95),
  },
  { // ---- centaur: horse body, human torso, arms swinging with the gait -----
    name: "centaur", monster: true,
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .38, len: 1.0 }, geomRot: [0, 0, 90], pos: [0, 1.055, 0], color: 0x8a5a33 },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .05, len: .55 }, pos: [-.85, .25, 0], rot: [0, 0, -18], pivot: [0, -.27, 0], color: 0x3a2a1c, anim: { axis: "z", deg: 8, speed: .5, phase: 0 } },
      { id: "torso", parent: "body", shape: "capsule", size: { r: .16, len: .55 }, pos: [.5, .42, 0], color: 0xc79668 },
      { id: "armL", parent: "torso", shape: "capsule", size: { r: .05, len: .5 }, pos: [0, .24, .2], rot: [-10, 0, 0], pivot: [0, -.25, 0], color: 0xc79668, anim: { axis: "z", deg: 16, speed: .8, phase: 3.14 } },
      { id: "armR", parent: "torso", shape: "capsule", size: { r: .05, len: .5 }, pos: [0, .24, -.2], rot: [10, 0, 0], pivot: [0, -.25, 0], color: 0xc79668, anim: { axis: "z", deg: 16, speed: .8, phase: 0 } },
      { id: "head", parent: "torso", shape: "sphere", size: { r: .12 }, pos: [0, .48, 0], color: 0xc79668, anim: { axis: "y", deg: 16, speed: .25, phase: 0 } },
      { id: "hair", parent: "head", shape: "sphere", size: { r: .125 }, scale: [1, .72, 1], pos: [-.012, .045, 0], color: 0x3a2a1a },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .02 }, pos: [.1, .02, .046], color: 0x2a1a10 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .02 }, pos: [.1, .02, -.046], color: 0x2a1a10 },
      ...legs({ len: .7, r: .085, spreadX: .48, spreadZ: .2, dropY: -.27, color: 0x6e452a }),
    ], 1),
  },
  { // ---- minotaur: bull-headed biped, ~2.5m, red-eyed ----------------------
    name: "minotaur", monster: true,
    parts: scaleParts([
      { id: "legL", parent: null, shape: "capsule", size: { r: .11, len: .8 }, pos: [0, .95, .14], pivot: [0, -.42, 0], color: 0x4a2f1c, anim: { axis: "z", deg: 24, speed: .8, phase: 0 } },
      { id: "legR", parent: null, shape: "capsule", size: { r: .11, len: .8 }, pos: [0, .95, -.14], pivot: [0, -.42, 0], color: 0x4a2f1c, anim: { axis: "z", deg: 24, speed: .8, phase: 3.14 } },
      { id: "torso", parent: null, shape: "capsule", size: { r: .3, len: .75 }, pos: [0, 1.5, 0], color: 0x6b4226 },
      { id: "armL", parent: "torso", shape: "capsule", size: { r: .09, len: .7 }, pos: [0, .3, .36], rot: [-14, 0, 0], pivot: [0, -.35, 0], color: 0x5a3820, anim: { axis: "z", deg: 17, speed: .8, phase: 3.14 } },
      { id: "armR", parent: "torso", shape: "capsule", size: { r: .09, len: .7 }, pos: [0, .3, -.36], rot: [14, 0, 0], pivot: [0, -.35, 0], color: 0x5a3820, anim: { axis: "z", deg: 17, speed: .8, phase: 0 } },
      { id: "head", parent: "torso", shape: "sphere", size: { r: .22 }, pos: [.05, .62, 0], color: 0x54331d, anim: { axis: "y", deg: 12, speed: .25, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .11, len: .14 }, pos: [.15, -.06, 0], rot: [0, 0, -85], pivot: [0, .07, 0], color: 0x8a6a4c },
      { id: "hornL", parent: "head", shape: "cone", size: { r: .05, h: .35 }, pos: [.02, .14, .18], rot: [55, 0, -15], color: 0xd8cbb0 },
      { id: "hornR", parent: "head", shape: "cone", size: { r: .05, h: .35 }, pos: [.02, .14, -.18], rot: [-55, 0, -15], color: 0xd8cbb0 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .024 }, pos: [.17, .06, .1], color: 0xb03a2a },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .024 }, pos: [.17, .06, -.1], color: 0xb03a2a },
    ], 1),
  },
  { // ---- manticore: red lion, dark bat wings, club tail --------------------
    name: "manticore", monster: true, mount: { h: 2.7, speed: 1.7, fly: true },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .5, len: 1.2 }, geomRot: [0, 0, 90], pos: [0, 1.06, 0], color: 0x8e3b28 },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .26, len: .45 }, pos: [.52, .2, 0], rot: [0, 0, -50], pivot: [0, .22, 0], color: 0x8e3b28 },
      { id: "mane", parent: "neck", shape: "sphere", size: { r: .34 }, pos: [0, .28, 0], color: 0x5a2418 },
      { id: "head", parent: "neck", shape: "sphere", size: { r: .3 }, pos: [0, .44, 0], color: 0xa04a30, anim: { axis: "y", deg: 14, speed: .3, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .13, len: .22 }, pos: [.15, .02, 0], rot: [0, 0, -85], pivot: [0, .11, 0], color: 0xc27a52 },
      { id: "earL", parent: "head", shape: "cone", size: { r: .09, h: .15 }, pos: [-.08, .24, .11], rot: [22, 0, 0], color: 0x5a2418 },
      { id: "earR", parent: "head", shape: "cone", size: { r: .09, h: .15 }, pos: [-.08, .24, -.11], rot: [-22, 0, 0], color: 0x5a2418 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .03 }, pos: [.2, .18, .13], color: 0xd9a520 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .03 }, pos: [.2, .18, -.13], color: 0xd9a520 },
      ...batWing(1, { k: .95, x: -.1, y: .4, z: .3, bone: 0x4a2a3a, deg: 14, speed: .5 }),
      ...batWing(-1, { k: .95, x: -.1, y: .4, z: .3, bone: 0x4a2a3a, deg: 14, speed: .5 }),
      { id: "tail", parent: "body", shape: "capsule", size: { r: .06, len: .9 }, pos: [-.55, .18, 0], rot: [0, 0, 125], pivot: [0, .45, 0], color: 0x8e3b28, anim: { axis: "z", deg: 18, speed: .7, phase: 0 } },
      { id: "tailClub", parent: "tail", shape: "sphere", size: { r: .14 }, pos: [0, .9, 0], color: 0x3a2a20 },
      ...legs({ len: .58, r: .17, spreadX: .42, spreadZ: .36, dropY: -.31, color: 0x7a3222 }),
    ], .8),
  },
  { // ---- dragon: ~2.5m at the shoulder, ~9m nose to tail -------------------
    name: "dragon", monster: true, mount: { h: 3.6, speed: 1.8, fly: true },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .8, len: 2.6 }, geomRot: [0, 0, 90], pos: [0, 1.7, 0], color: 0x4a7040 },
      { id: "neck", parent: "body", shape: "capsule", size: { r: .35, len: 1.1 }, pos: [1.5, .5, 0], rot: [0, 0, -45], pivot: [0, .55, 0], color: 0x4a7040 },
      { id: "head", parent: "neck", shape: "sphere", size: { r: .38 }, scale: [1.3, .85, .9], pos: [0, 1.15, 0], color: 0x568049, anim: { axis: "y", deg: 10, speed: .2, phase: 0 } },
      { id: "snout", parent: "head", shape: "capsule", size: { r: .17, len: .5 }, pos: [.3, -.05, 0], rot: [0, 0, -80], pivot: [0, .25, 0], color: 0x5a8050 },
      { id: "hornL", parent: "head", shape: "cone", size: { r: .06, h: .4 }, pos: [-.05, .28, .16], rot: [30, 0, 25], color: 0xd8cbb0 },
      { id: "hornR", parent: "head", shape: "cone", size: { r: .06, h: .4 }, pos: [-.05, .28, -.16], rot: [-30, 0, 25], color: 0xd8cbb0 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .045 }, pos: [.27, .17, .21], color: 0xd9a520 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .045 }, pos: [.27, .17, -.21], color: 0xd9a520 },
      ...batWing(1, { k: 1.55, x: -.2, y: .65, z: .45, bone: 0x3a5232, mem: 0x35492e, deg: 11, speed: .35 }),
      ...batWing(-1, { k: 1.55, x: -.2, y: .65, z: .45, bone: 0x3a5232, mem: 0x35492e, deg: 11, speed: .35 }),
      { id: "tail", parent: "body", shape: "capsule", size: { r: .3, len: 1.6 }, pos: [-1.6, .1, 0], rot: [0, 0, 80], pivot: [0, .8, 0], color: 0x4a7040, anim: { axis: "z", deg: 8, speed: .4, phase: 0 } },
      { id: "tailTip", parent: "tail", shape: "cone", size: { r: .18, h: 1.2 }, pos: [0, 1.9, 0], rot: [0, 0, 8], color: 0x3f6136 },
      ...legs({ len: .8, r: .26, spreadX: .9, spreadZ: .55, dropY: -.64, color: 0x3f6136 }),
    ], 1),
  },
  { // ---- hydra: three swaying necks, three heads, one grudge ---------------
    name: "hydra", monster: true, mount: { h: 3.2, speed: 1.5 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .7, len: 2.0 }, geomRot: [0, 0, 90], pos: [0, 1.42, 0], color: 0x3f6b5a },
      { id: "neckA", parent: "body", shape: "capsule", size: { r: .22, len: 1.5 }, pos: [1.05, .4, 0], rot: [0, 0, -55], pivot: [0, .75, 0], color: 0x3f6b5a, anim: { axis: "z", deg: 8, speed: .3, phase: 0 } },
      // side necks: with rotation order XYZ the yaw must be NEGATIVE to splay
      // a forward-leaning capsule toward +z (and vice versa) -- same-sign yaw
      // crosses the necks over each other
      { id: "neckB", parent: "body", shape: "capsule", size: { r: .22, len: 1.5 }, pos: [.9, .42, .5], rot: [0, -38, -58], pivot: [0, .75, 0], color: 0x3f6b5a, anim: { axis: "z", deg: 9, speed: .35, phase: 2 } },
      { id: "neckC", parent: "body", shape: "capsule", size: { r: .22, len: 1.5 }, pos: [.9, .42, -.5], rot: [0, 38, -58], pivot: [0, .75, 0], color: 0x3f6b5a, anim: { axis: "z", deg: 9, speed: .32, phase: 4 } },
      { id: "headA", parent: "neckA", shape: "sphere", size: { r: .27 }, scale: [1.25, .8, .85], pos: [0, 1.5, 0], color: 0x4c7d68, anim: { axis: "y", deg: 14, speed: .25, phase: 0 } },
      { id: "headB", parent: "neckB", shape: "sphere", size: { r: .25 }, scale: [1.25, .8, .85], pos: [0, 1.5, 0], color: 0x4c7d68, anim: { axis: "y", deg: 14, speed: .28, phase: 2 } },
      { id: "headC", parent: "neckC", shape: "sphere", size: { r: .25 }, scale: [1.25, .8, .85], pos: [0, 1.5, 0], color: 0x4c7d68, anim: { axis: "y", deg: 14, speed: .3, phase: 4 } },
      { id: "snoutA", parent: "headA", shape: "capsule", size: { r: .11, len: .3 }, pos: [.22, -.04, 0], rot: [0, 0, -80], pivot: [0, .15, 0], color: 0x5c8d76 },
      { id: "snoutB", parent: "headB", shape: "capsule", size: { r: .1, len: .28 }, pos: [.2, -.04, 0], rot: [0, 0, -80], pivot: [0, .14, 0], color: 0x5c8d76 },
      { id: "snoutC", parent: "headC", shape: "capsule", size: { r: .1, len: .28 }, pos: [.2, -.04, 0], rot: [0, 0, -80], pivot: [0, .14, 0], color: 0x5c8d76 },
      { id: "eyeAL", parent: "headA", shape: "sphere", size: { r: .038 }, pos: [.19, .12, .15], color: 0xc9d94a },
      { id: "eyeAR", parent: "headA", shape: "sphere", size: { r: .038 }, pos: [.19, .12, -.15], color: 0xc9d94a },
      { id: "eyeBL", parent: "headB", shape: "sphere", size: { r: .035 }, pos: [.18, .11, .14], color: 0xc9d94a },
      { id: "eyeBR", parent: "headB", shape: "sphere", size: { r: .035 }, pos: [.18, .11, -.14], color: 0xc9d94a },
      { id: "eyeCL", parent: "headC", shape: "sphere", size: { r: .035 }, pos: [.18, .11, .14], color: 0xc9d94a },
      { id: "eyeCR", parent: "headC", shape: "sphere", size: { r: .035 }, pos: [.18, .11, -.14], color: 0xc9d94a },
      { id: "tail", parent: "body", shape: "capsule", size: { r: .26, len: 1.4 }, pos: [-1.25, .1, 0], rot: [0, 0, 80], pivot: [0, .7, 0], color: 0x3f6b5a, anim: { axis: "z", deg: 10, speed: .4, phase: 0 } },
      { id: "tailTip", parent: "tail", shape: "cone", size: { r: .15, h: 1.0 }, pos: [0, 1.6, 0], rot: [0, 0, 10], color: 0x36584b },
      ...legs({ len: .7, r: .24, spreadX: .75, spreadZ: .5, dropY: -.48, color: 0x36584b }),
    ], 1),
  },
];
