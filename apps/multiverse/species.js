// Abstract animal definitions -- pure data, no rendering-engine imports.
// Any engine (banner.js SDF quads, instanced.js, composite.js)
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

import { rigSpecies, catRig, CAT_COATS, eyeMark } from "./mammals.js";
import { makePerson } from "./people.js";
import { scalePart } from "./geom.js";

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
  // what stands proud of the head where an eye looks out (an owl's face disc, a parrot's cheek patch): the eye
  // goes on that outer surface -- the farthest exit along its direction through the head's round children
  const shells = parts.filter((p) => p.parent === "head" && p.shape === "sphere" && !p.id.startsWith("eye"));
  const outer = (d) => shells.reduce((R, p) => {
    const sc = p.scale ?? [1, 1, 1], c = p.pos.map((v, i) => v / hs[i]), r = p.size.r;   // |(t d - c) / sc| = r
    const A = d.reduce((a, v, i) => a + (v / sc[i]) ** 2, 0), B = -2 * d.reduce((a, v, i) => a + v * c[i] / sc[i] ** 2, 0);
    const C = c.reduce((a, v, i) => a + (v / sc[i]) ** 2, 0) - r * r, disc = B * B - 4 * A * C;
    return disc < 0 ? R : Math.max(R, (-B + Math.sqrt(disc)) / (2 * A));
  }, head.size.r);
  return parts.map((p) => {   // (a classic eye -- a sphere on the head -- becomes a face mark on the outer surface: mammals.js eyeMark)
    if (p.parent !== "head" || !p.id.startsWith("eye") || p.shape !== "sphere") return p;
    const E = p.pos.map((v, i) => v / hs[i]), l = Math.hypot(...E) || 1;
    return eyeMark(p.id, "head", [0, 0, 0], outer(E.map((v) => v / l)), E, p.size.r, p.color);
  });
}

function scaleParts(parts, f) {
  return snapEyes(parts.map((p) => {
    const q = scalePart(p, f);
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
      anim: { axis: "x", deg: s * deg, speed, phase: 0, wing: true },
      fold: [s * 118, 0, 70] },   // (struck down: the arm swept back and a little down along the flank, the membrane up over it, flat)
    // arm frame: shoulder-elbow-flank lobe, then elbow-flank-D closing back to the hinge point
    { id: `wMemA${S}`, parent: `wArm${S}`, shape: "tri",
      size: { a: [0, .02 * k, 0], b: [0, E - .02 * k, 0], c: [-1.05 * k, -.2 * k, 0], r: .03 * k },
      pos: [0, 0, 0], color: mem },
    { id: `wMemA2${S}`, parent: `wArm${S}`, shape: "tri",
      size: { a: [0, E - .02 * k, 0], b: [-1.05 * k, -.2 * k, 0], c: [-1.0 * k, E, 0], r: .03 * k },
      pos: [0, 0, 0], color: mem },
    { id: `wHand${S}`, parent: `wArm${S}`, shape: "capsule", size: { r: .05 * k, len: 1.0 * k },
      pos: [0, E, 0], rot: [s * 42, 0, 0], pivot: [0, .5 * k, 0], color: bone,
      anim: { axis: "x", deg: s * deg * 1.6, speed, phase: .6, wing: true }, fold: [-s * 42, 0, 0] },   // (struck down: straight on from the arm)
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
    // the body: one straight tube with a bulge -- a spindle, pointed at both ends (tail end first: its forward runs a -> b)
    { id: "body", parent: null, shape: "tube", size: { a: [-.1 * k, 0, 0], c: [0, .004 * k, 0], b: [.1 * k, 0, 0], r1: .014 * k, r2: .012 * k, bulge: .04 * k }, pos: [0, 0, 0], color: v.b },
    { id: "tail", parent: "body", shape: "tri", pos: [-.11 * k, 0, 0],
      size: { a: [0, 0, 0], b: [-.09 * k, .06 * k, 0], c: [-.09 * k, -.05 * k, 0], r: .012 * k }, color: v.t,
      anim: { axis: "y", deg: 28, speed: 3, phase: 0 } },
    { id: "fin", parent: "body", shape: "tri", pos: [0, .05 * k, 0],
      size: { a: [-.05 * k, 0, 0], b: [.04 * k, 0, 0], c: [-.05 * k, .05 * k, 0], r: .008 * k }, color: v.t },
    { id: "eyeL", parent: "body", shape: "sphere", size: { r: .009 * k }, pos: [.07 * k, .012 * k, .026 * k], color: 0x101418 },
    { id: "eyeR", parent: "body", shape: "sphere", size: { r: .009 * k }, pos: [.07 * k, .012 * k, -.026 * k], color: 0x101418 },
  ] };
}

// The lake's big swimmers. Same swimmer plumbing as the fish; real sizes
// (dolphin ~2.4m, shark ~3.2m). The dolphin's tail pitches (axis z), the
// shark's sweeps sideways (axis y) -- true to how each actually swims.
export function makeDolphin() {
  const c = 0x728696, dark = 0x64788a;
  return { name: "dolphin", fly: { alt: [.6, 1.8], speed: [1.5, 3.2], hz: 1.1 }, parts: [
    // a spindle body (a bulged tube, fattest just ahead of the middle), the melon, a tapering beak
    { id: "body", parent: null, shape: "tube", size: { a: [-.95, .02, 0], c: [-.1, .04, 0], b: [.8, 0, 0], r1: .09, r2: .17, bulge: .14 }, pos: [0, 0, 0], color: c },
    { id: "melon", parent: "body", shape: "sphere", size: { r: .18 }, pos: [.8, .05, 0], color: c },
    { id: "snout", parent: "body", shape: "tube", size: { a: [0, 0, 0], c: [.15, 0, 0], b: [.32, -.03, 0], r1: .09, r2: .045 }, pos: [.9, -.02, 0], color: 0x82929f },
    { id: "dorsal", parent: "body", shape: "tri", size: { a: [-.18, .2, 0], b: [.18, .22, 0], c: [-.3, .6, 0], r: .03 }, pos: [.05, 0, 0], color: dark },
    { id: "pectL", parent: "body", shape: "tri", size: { a: [0, 0, 0], b: [-.3, -.24, .3], c: [-.05, -.26, .12], r: .02 }, pos: [.45, -.14, .16], color: dark },
    { id: "pectR", parent: "body", shape: "tri", size: { a: [0, 0, 0], b: [-.3, -.24, -.3], c: [-.05, -.26, -.12], r: .02 }, pos: [.45, -.14, -.16], color: dark },
    { id: "tailStock", parent: "body", shape: "tube", size: { a: [0, 0, 0], c: [-.28, .03, 0], b: [-.55, .04, 0], r1: .1, r2: .045 }, pos: [-.9, .02, 0], color: c,
      anim: { axis: "z", deg: 15, speed: 1.1, phase: 0 } },   // pitches: the flukes beat up and down
    { id: "flukeL", parent: "tailStock", shape: "tri", size: { a: [-.46, .04, .02], b: [-.82, .07, .46], c: [-.64, .05, .1], r: .02 }, pos: [0, 0, 0], color: dark },
    { id: "flukeR", parent: "tailStock", shape: "tri", size: { a: [-.46, .04, -.02], b: [-.82, .07, -.46], c: [-.64, .05, -.1], r: .02 }, pos: [0, 0, 0], color: dark },
    { id: "eyeL", parent: "body", shape: "sphere", size: { r: .03 }, pos: [.82, .08, .16], color: 0x14181c },
    { id: "eyeR", parent: "body", shape: "sphere", size: { r: .03 }, pos: [.82, .08, -.16], color: 0x14181c },
  ] };
}
export function makeShark() {
  const c = 0x74828c, dark = 0x5d6a74;
  return { name: "shark", fly: { alt: [.4, 1.4], speed: [1.2, 2.4], hz: .7 }, parts: [
    // a spindle body and a pointed snout: two tubes where a pill and a cone were
    { id: "body", parent: null, shape: "tube", size: { a: [-1.2, .02, 0], c: [0, .05, 0], b: [1.0, 0, 0], r1: .11, r2: .2, bulge: .17 }, pos: [0, 0, 0], color: c },
    { id: "snout", parent: "body", shape: "tube", size: { a: [0, 0, 0], c: [.28, .01, 0], b: [.55, -.05, 0], r1: .2, r2: .04 }, pos: [1.0, -.02, 0], color: c },
    { id: "dorsal", parent: "body", shape: "tri", size: { a: [-.22, .28, 0], b: [.26, .3, 0], c: [-.14, .88, 0], r: .03 }, pos: [-.05, 0, 0], color: dark },
    { id: "pectL", parent: "body", shape: "tri", size: { a: [0, 0, 0], b: [-.42, -.3, .42], c: [-.08, -.32, .14], r: .02 }, pos: [.5, -.18, .22], color: dark },
    { id: "pectR", parent: "body", shape: "tri", size: { a: [0, 0, 0], b: [-.42, -.3, -.42], c: [-.08, -.32, -.14], r: .02 }, pos: [.5, -.18, -.22], color: dark },
    { id: "tailStock", parent: "body", shape: "tube", size: { a: [0, 0, 0], c: [-.3, .02, 0], b: [-.6, .03, 0], r1: .12, r2: .05 }, pos: [-1.15, 0, 0], color: c,
      anim: { axis: "y", deg: 18, speed: .7, phase: 0 } },   // sweeps: the tail beats side to side
    { id: "tailUp", parent: "tailStock", shape: "tri", size: { a: [-.42, .03, 0], b: [-.85, .56, 0], c: [-.68, .12, 0], r: .02 }, pos: [0, 0, 0], color: dark },
    { id: "tailDn", parent: "tailStock", shape: "tri", size: { a: [-.44, 0, 0], b: [-.7, -.3, 0], c: [-.6, -.05, 0], r: .02 }, pos: [0, 0, 0], color: dark },
    { id: "eyeL", parent: "body", shape: "sphere", size: { r: .032 }, pos: [1.05, .1, .17], color: 0x14181c },
    { id: "eyeR", parent: "body", shape: "sphere", size: { r: .032 }, pos: [1.05, .1, -.17], color: 0x14181c },
  ] };
}

// The rigged mammals (mammals.js): two-lobe bodies, IK legs, arc tails.
// Built here so they can share batWing with the dragon and hydra.
const RIG = Object.fromEntries(rigSpecies({ batWing }).map((d) => [d.name, d]));
// a house cat in one of the coats (mammals.js CAT_COATS), picked by seed
export const makeCat = ({ seed = 1 } = {}) => catRig(CAT_COATS[((seed * 2654435761) >>> 0) % CAT_COATS.length]);
export const SQUIRREL = RIG.squirrel;   // not a wanderer: it lives in the trees (squirrels.js)

// natural travel speed for a body: one unit of the gait clock per this many
// metres, so a cat's legs flicker while an elephant strides. Rig legs
// (two bones, IK) take .8 of their length per unit, classic swinging
// capsules 1.3 of theirs (tuned for the 24-degree trot)
export function gaitBase(def) {
  // rig legs (mammals, people): the walk's own stride -- a foot sweeps
  // 2 x stride per stance, half a cycle, and a clock unit is CYCLES (.8,
  // skeleton.js) cycles, so 4 x .8 x stride metres per unit keep it planted
  if (def.gaits?.walk?.stride) return Math.max(.08, 3.2 * def.gaits.walk.stride);
  if (def.legLen) return Math.max(.1, .8 * def.legLen);
  const lg = def.parts.find((q) => q.id.startsWith("leg"));
  return lg ? Math.max(.15, 1.3 * (lg.size.len + lg.size.r)) : 1;
}
// walk or run at this speed? Legged animals change gait at a Froude number
// v^2 / (g L) of about .5 whatever their size (a cat trots where a horse
// still walks); the base is ~ the leg length for rig legs
export const runs = (speed, base) => speed * speed > 4.8 * base;
// Where a rider sits on a mount -- ONE point for every rider (the player's
// camera, peers, the trotting riders, Shift+D copies): a third of the way
// from the rump lobe to the chest lobe, just behind the withers, on the
// back. rootX in the animal's root space (x forward); bodyX/bodyY in the
// body part's own frame, where fused riders' parts hang.
export function saddle(def) {
  const body = def.parts.find((q) => q.id === "body") ?? def.parts[0], front = def.parts.find((q) => q.id === "front" && q.parent === "body");
  const bx = body.pos?.[0] ?? 0, rootX = front ? bx + front.pos[0] * 2 / 3 : bx + .08;
  return { rootX, bodyX: rootX - bx, bodyY: (partExtent(body).r || .4) + .05 };
}
// a part's girth and length, whatever its shape -- the ONE reader of body sizes (probes, colliders,
// swimmers' depth): a tube's fattest radius and its end-to-end length, a capsule's r and len
export function partExtent(p) {
  const z = p.size ?? {};
  if (p.shape === "tube") return { r: Math.max(z.r1, z.r2 ?? z.r1) + (z.bulge ?? 0), len: Math.hypot(z.b[0] - z.a[0], z.b[1] - z.a[1], z.b[2] - z.a[2]) };
  return { r: z.r ?? 0, len: z.len ?? z.h ?? 0 };
}
// half the body length: where the nose and tail meet the ground
export function bodyProbe(def) {
  if (def.probe) return def.probe;
  const b = def.parts.find((q) => q.id === "body" || q.id === "torso");
  if (!b) return .4;
  const e = partExtent(b);
  return e.len / 2 + e.r;
}

const SPIDER = { // ---- spider: a tarantula -- a 7cm body (cephalothorax and a rounder abdomen), hairy, eight legs to a
    // ~14cm span. Each leg: an undrawn coxa bone at the body's side, yawed out (it sweeps the leg fore and aft),
    // the femur rising 30 degrees to the knee (it lifts the leg on the forward swing), the tibia splaying down (55 degrees) to the ground; the
    // legs step in two alternating sets of four (L1 R2 L3 R4 / R1 L2 R3 L4)
    name: "spider",
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .011, len: .012 }, geomRot: [0, 0, 90], pos: [0, .024, 0], color: 0x4a3526, fur: true },
      { id: "head", parent: "body", shape: "sphere", size: { r: .009 }, scale: [1, .8, 1], pos: [.009, .002, 0], color: 0x4a3526, fur: true },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .0016 }, pos: [.004, .008, .0025], color: 0x0a0806 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .0016 }, pos: [.004, .008, -.0025], color: 0x0a0806 },
      { id: "eye2L", parent: "head", shape: "sphere", size: { r: .0011 }, pos: [.006, .006, .005], color: 0x0a0806 },
      { id: "eye2R", parent: "head", shape: "sphere", size: { r: .0011 }, pos: [.006, .006, -.005], color: 0x0a0806 },
      { id: "abdomen", parent: "body", shape: "sphere", size: { r: .017 }, scale: [1.2, .95, 1], pos: [-.03, .005, 0], color: 0x3a2a1e, fur: true,
        anim: { axis: "z", deg: 3, speed: .4, phase: 0 } },
      ...[1, -1].flatMap((s) => [
        { id: "fang" + (s > 0 ? "L" : "R"), parent: "head", shape: "sphere", size: { r: .0035 }, pos: [.008, -.004, s * .003], color: 0x1a1210 },
        { id: "palp" + (s > 0 ? "L" : "R"), parent: "head", shape: "capsule", size: { r: .0028, r2: .0022, len: .02 }, pos: [.007, -.002, s * .005],
          rot: [-s * 35, 0, 110], pivot: [0, -.01, 0], color: 0x3a2a20, fur: true, anim: { axis: "z", deg: 8, speed: .8, phase: s > 0 ? 0 : 3.14 } },
      ]),
      ...[1, -1].flatMap((s) => [35, 70, 110, 145].flatMap((a, k) => {
        const t = k + (s > 0 ? "L" : "R"), ph = (k + (s > 0 ? 0 : 1)) % 2 * 3.14, f = k === 0 || k === 3 ? 1.1 : 1, lf = .035 * f, lt = .05 * f;
        return [
          { id: "coxa" + t, parent: "body", shape: "capsule", size: { r: .003, len: .002 }, bone: true, pos: [.006 - k * .005, 0, s * .009], rot: [0, -s * a, 0],
            anim: { axis: "y", deg: 14, speed: .8, phase: ph } },
          { id: "femur" + t, parent: "coxa" + t, shape: "capsule", size: { r: .0046, r2: .004, len: lf }, pos: [0, 0, 0], rot: [0, 0, 120], pivot: [0, -lf / 2, 0],
            color: 0x3a2a20, fur: true, fold: [0, 0, 45], anim: { axis: "z", deg: 6, speed: .8, phase: ph + s * 1.57 } },
          { id: "tibia" + t, parent: "femur" + t, shape: "capsule", size: { r: .0038, r2: .0026, len: lt }, pos: [0, -lf, 0], rot: [0, 0, -85], pivot: [0, -lt / 2, 0],
            color: 0x46342a, fur: true, fold: [0, 0, -70] },   // (fold: struck down, the legs curl in -- the femur up over the body, the tibia tucked under)
        ];
      })),
    ], 1),
  };

// every part hung (at any depth) under part `id`
function subtree(parts, id) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return parts.filter((p) => { for (let q = p; q; q = byId.get(q.parent)) if (q.parent === id) return true; return false; });
}

// ---- tauric beasts (the centaur's kind): an animal's trunk, legs and tail -- its rig or classic def without the
// head (and all on it), the neck and `drop` (a mane), scaled by `scale` (for a def whose gait is its parts' own
// anims: a rig's gait strides are in metres) -- and a person's upper body (people.js makePerson, upper: the torso
// pill and all above it) standing on its chest: the pelvis bone hung from the animal's root at `at` (figure
// coordinates after scaling), low enough that the torso grows out of it. The rest: makePerson's options
function tauric(name, base, { scale = 1, at, drop = [], call, ...person }) {
  if (scale !== 1 && base.gaits) throw new Error(`${name}: a rig's gaits do not scale`);
  const gone = new Set(["head", "neck", ...drop, ...subtree(base.parts, "head").map((p) => p.id)]);
  const parts = base.parts.filter((p) => !gone.has(p.id)).map((p) => scale === 1 ? p : { ...scalePart(p, scale), k: p.k && p.k * scale });
  const root = parts.find((p) => !p.parent), man = makePerson({ upper: true, ...person });
  const human = man.parts.map((p) => p.id === "pelvis" ? { ...p, parent: root.id, bob: false, pos: at.map((v, i) => v - (root.pos?.[i] ?? 0)) } : p);
  const { mount, draft, climber, ...rest } = base;   // (no saddle, yoke or trees for them)
  return { ...rest, name, monster: true, call, parts: [...parts, ...human] };
}

// ---- beast-men: the human rig (people.js makePerson) with an animal's head -- the species' own rig head (its
// head sphere and everything hung on it: muzzle, ears, eye marks, nose, horns, tusks, fangs), scaled to a
// human-sized head -- in the animal's hide, with its tail and, for the hoofed, hooves; they call as the animal;
// outfit: what it wears (makePerson's, over the bare hide: a kilt, a tunic, breeches...)
function beastman(name, rig, { seed, height, build = 1.2, hoof = false, headScale, eye, call, outfit } = {}) {
  const head = rig.parts.find((p) => p.id === "head"), body = rig.parts.find((p) => p.id === "body");
  const beast = { hide: body.color, build, hoof, headScale, eye, foot: rig.parts.find((p) => p.id.startsWith("foot"))?.color ?? body.color,
    head: { r: head.size.r, color: head.color, pat: head.pat, parts: subtree(rig.parts, "head") },
    tail: rig.parts.filter((p) => /^tail/.test(p.id) && p.parent === "body").flatMap((p) => [p, ...subtree(rig.parts, p.id)]) };
  return { ...makePerson({ seed, kind: "man", height, beast, outfit }), name, monster: true, call: call ?? rig.name };
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
      { id: "wingL", parent: "body", shape: "sphere", size: { r: .16 }, scale: [.75, .1, 1.6], pos: [0, .03, .05], pivot: [0, 0, .15], color: 0x2857b0, anim: { axis: "x", deg: 45, speed: 1.3, phase: 0, wing: true } },
      { id: "wingR", parent: "body", shape: "sphere", size: { r: .16 }, scale: [.75, .1, 1.6], pos: [0, .03, -.05], pivot: [0, 0, -.15], color: 0x2857b0, anim: { axis: "x", deg: -45, speed: 1.3, phase: 0, wing: true } },
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
      { id: "wingL", parent: "body", shape: "sphere", size: { r: .3 }, scale: [.7, .09, 1.5], pos: [0, .04, .08], pivot: [0, 0, .28], color: 0x7a6753, pat: "leaf", anim: { axis: "x", deg: 38, speed: .6, phase: 0, wing: true } },
      { id: "wingR", parent: "body", shape: "sphere", size: { r: .3 }, scale: [.7, .09, 1.5], pos: [0, .04, -.08], pivot: [0, 0, -.28], color: 0x7a6753, pat: "leaf", anim: { axis: "x", deg: -38, speed: .6, phase: 0, wing: true } },
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
  RIG.cat,
  RIG.fox,
  { // ---- eagle: golden eagle, ~2.2m span -- soars with slow wingbeats ------
    name: "eagle", fly: { alt: [20, 155], speed: [4, 8], hz: .4 }, active: "day",   // up to the cathedral spires
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .11, len: .4 }, geomRot: [0, 0, 90], pos: [0, .4, 0], color: 0x4b3520 },
      { id: "head", parent: "body", shape: "sphere", size: { r: .095 }, pos: [.28, .08, 0], color: 0x9a7a42 },
      { id: "beak", parent: "head", shape: "cone", size: { r: .03, h: .085 }, pos: [.09, -.01, 0], rot: [0, 0, -105], color: 0xd9b04a },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .02 }, pos: [.06, .03, .05], color: 0xd9a520 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .02 }, pos: [.06, .03, -.05], color: 0xd9a520 },
      { id: "tail", parent: "body", shape: "sphere", size: { r: .14 }, scale: [1.7, .18, 1], pos: [-.34, 0, 0], rot: [0, 0, 10], color: 0x5a4128 },
      { id: "wingL", parent: "body", shape: "sphere", size: { r: .42 }, scale: [.62, .08, 1.5], pos: [0, .05, .08], pivot: [0, 0, .35], color: 0x5a4128, anim: { axis: "x", deg: 35, speed: .4, phase: 0, wing: true } },
      { id: "wingR", parent: "body", shape: "sphere", size: { r: .42 }, scale: [.62, .08, 1.5], pos: [0, .05, -.08], pivot: [0, 0, -.35], color: 0x5a4128, anim: { axis: "x", deg: -35, speed: .4, phase: 0, wing: true } },
    ], 1),
  },
  RIG.dog,
  RIG.sheep,
  RIG.ram,
  RIG.pig,
  RIG.wolf,
  RIG.deer,
  RIG.reindeer,
  RIG.oryx,
  RIG.cervicapra,
  RIG.tiger,
  RIG.lion,
  RIG.leopard,
  RIG.smilodon,
  RIG.cow,
  RIG.ox,
  RIG.zebra,
  RIG.horse,
  RIG.bear,
  RIG.hippo,
  RIG.giraffe,
  RIG.elephant,
  RIG.rhinoceros,
  { // ---- snake: grass snake, 1.4m of chained segments slithering in a wave --
    // each segment hangs off the one before and swings about y a little
    // out of phase with it, so a sine travels down the body as it moves
    name: "snake",
    // four curved tubes (a body and three segments) where there were seven pills: each bends a little
    // the other way, hangs off the one before and swings about y out of phase with it -- the sine
    // still travels down the body, now as one smooth, tapering line
    parts: scaleParts([
      { id: "body", parent: null, shape: "tube", size: { a: [-.35, 0, 0], c: [-.12, 0, .05], b: [.1, 0, 0], r1: .032, r2: .034 }, pos: [0, .035, 0], color: 0x6b7a3a },
      { id: "head", parent: "body", shape: "sphere", size: { r: .036 }, scale: [1.5, .7, 1.1], pos: [.15, .005, 0], color: 0x6b7a3a, anim: { axis: "y", deg: 12, speed: .8, phase: 0 } },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.03, .012, .03], color: 0xd9a520 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.03, .012, -.03], color: 0xd9a520 },
      { id: "tongue", parent: "head", shape: "cone", size: { r: .004, h: .05 }, pos: [.06, -.005, 0], rot: [0, 0, -90], color: 0xb03030, anim: { axis: "y", deg: 15, speed: 2.5, phase: 0 } },
      ...[[.45, -.06, .032, .026], [.42, .05, .026, .017], [.34, -.035, .017, .005]].map(([len, bend, r1, r2], i) => ({ id: "seg" + (i + 1), parent: i ? "seg" + i : "body",
        shape: "tube", size: { a: [0, 0, 0], c: [-len / 2, 0, bend], b: [-len, 0, 0], r1, r2 }, pos: [i === 0 ? -.35 : -[.45, .42][i - 1], 0, 0],
        color: i % 2 ? 0x6b7a3a : 0x5f6e33, anim: { axis: "y", deg: 22, speed: .8, phase: (i + 1) * 1.4 } })),
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
  RIG.boar,
  { // ---- swan: mute swan, 1.5m, S-neck, floats half-submerged on the lake --
    name: "swan", swim: { depth: .18 },
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .22, len: .5 }, geomRot: [0, 0, 90], pos: [0, .2, 0], color: 0xf4f2ec },
      { id: "wingL", parent: "body", shape: "sphere", size: { r: .3 }, scale: [1.2, .55, .35], pos: [-.05, .14, .16], rot: [-18, 0, 0], color: 0xf4f2ec },
      { id: "wingR", parent: "body", shape: "sphere", size: { r: .3 }, scale: [1.2, .55, .35], pos: [-.05, .14, -.16], rot: [18, 0, 0], color: 0xf4f2ec },
      { id: "tail", parent: "body", shape: "cone", size: { r: .07, h: .22 }, pos: [-.38, .1, 0], rot: [0, 0, 110], color: 0xf4f2ec },
      // the S-neck: two curved tubes -- out of the breast bowing forward, then up bowing back to the head
      { id: "neck", parent: "body", shape: "tube", size: { a: [0, 0, 0], c: [.2, .16, 0], b: [.1, .4, 0], r1: .065, r2: .045 }, pos: [.3, .12, 0], color: 0xf4f2ec, anim: { axis: "z", deg: 5, speed: .3, phase: 0 } },
      { id: "neck2", parent: "neck", shape: "tube", size: { a: [0, 0, 0], c: [-.1, .2, 0], b: [.02, .36, 0], r1: .045, r2: .038 }, pos: [.1, .4, 0], color: 0xf4f2ec, anim: { axis: "z", deg: 6, speed: .3, phase: 1 } },
      { id: "head", parent: "neck2", shape: "sphere", size: { r: .055 }, scale: [1.5, .9, .9], pos: [.07, .38, 0], color: 0xf4f2ec, anim: { axis: "y", deg: 14, speed: .3, phase: 0 } },
      { id: "beak", parent: "head", shape: "cone", size: { r: .028, h: .09 }, pos: [.1, -.01, 0], rot: [0, 0, -90], color: 0xe0782a },
      { id: "knob", parent: "head", shape: "sphere", size: { r: .018 }, pos: [.065, .02, 0], color: 0x1a1210 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.04, .02, .045], color: 0x1a1210 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .012 }, pos: [.04, .02, -.045], color: 0x1a1210 },
    ], 1),
  },
  { // ---- flamingo: greater flamingo, ~1.4m standing -- a pink body high on stilt legs, the S-neck of two
    // curved tubes (the swan's way), a small head and the bent beak, white with a black tip; wades at the shore
    name: "flamingo", shore: true,
    parts: scaleParts([
      { id: "body", parent: null, shape: "capsule", size: { r: .13, len: .22 }, geomRot: [0, 0, 90], pos: [0, .88, 0], color: 0xf2a0a8 },
      { id: "wingL", parent: "body", shape: "sphere", size: { r: .16 }, scale: [1.3, .45, .45], pos: [-.05, .05, .08], rot: [-15, 0, 0], color: 0xe8788a },
      { id: "wingR", parent: "body", shape: "sphere", size: { r: .16 }, scale: [1.3, .45, .45], pos: [-.05, .05, -.08], rot: [15, 0, 0], color: 0xe8788a },
      { id: "tail", parent: "body", shape: "cone", size: { r: .05, h: .14 }, pos: [-.26, .02, 0], rot: [0, 0, 100], color: 0x2a1a1a },
      { id: "neck", parent: "body", shape: "tube", size: { a: [0, 0, 0], c: [.14, .12, 0], b: [.04, .27, 0], r1: .034, r2: .026 }, pos: [.22, .06, 0], color: 0xf4b0b6, anim: { axis: "z", deg: 6, speed: .3, phase: 0 } },
      { id: "neck2", parent: "neck", shape: "tube", size: { a: [0, 0, 0], c: [-.11, .12, 0], b: [.04, .22, 0], r1: .026, r2: .022 }, pos: [.04, .27, 0], color: 0xf4b0b6, anim: { axis: "z", deg: 7, speed: .3, phase: 1 } },
      { id: "head", parent: "neck2", shape: "sphere", size: { r: .04 }, scale: [1.3, 1, 1], pos: [.05, .23, 0], color: 0xf6c0c4, anim: { axis: "y", deg: 14, speed: .3, phase: 0 } },
      { id: "beak", parent: "head", shape: "cone", size: { r: .022, h: .07 }, pos: [.07, -.01, 0], rot: [0, 0, -110], color: 0xf0e0d8 },
      { id: "beakTip", parent: "beak", shape: "cone", size: { r: .016, h: .05 }, pos: [0, .06, 0], rot: [0, 0, -40], color: 0x1a1414 },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .008 }, pos: [.025, .015, .03], color: 0xe0b020 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .008 }, pos: [.025, .015, -.03], color: 0xe0b020 },
      { id: "legL", parent: "body", shape: "capsule", size: { r: .012, len: .77 }, pos: [0, -.1, .05], pivot: [0, -.385, 0], color: 0xe87a88, anim: { axis: "z", deg: 22, speed: .6, phase: 0 } },
      { id: "legR", parent: "body", shape: "capsule", size: { r: .012, len: .77 }, pos: [0, -.1, -.05], pivot: [0, -.385, 0], color: 0xe87a88, anim: { axis: "z", deg: 22, speed: .6, phase: 3.14 } },
      { id: "footL", parent: "legL", shape: "sphere", size: { r: .03 }, scale: [1.6, .4, 1], pos: [.03, -.77, 0], color: 0xe87a88 },
      { id: "footR", parent: "legR", shape: "sphere", size: { r: .03 }, scale: [1.6, .4, 1], pos: [.03, -.77, 0], color: 0xe87a88 },
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
    // three tubes where the pills were: a spindle body, the long tapering head over its paler jaw, a
    // curving tail in two (it sways in a wave); low on its splayed legs
    parts: scaleParts([
      { id: "body", parent: null, shape: "tube", size: { a: [-.7, 0, 0], c: [0, .03, 0], b: [.7, 0, 0], r1: .17, r2: .18, bulge: .12 }, pos: [0, .26, 0], color: 0x4f5c3a, pat: "bark" },
      { id: "belly", parent: "body", shape: "capsule", size: { r: .2, len: 1.1 }, geomRot: [0, 0, 90], pos: [0, -.1, 0], color: 0x9a9a6a },
      { id: "head", parent: "body", shape: "tube", size: { a: [0, 0, 0], c: [.35, .03, 0], b: [.75, -.04, 0], r1: .17, r2: .06 }, pos: [.7, .02, 0], color: 0x4f5c3a, anim: { axis: "y", deg: 8, speed: .25, phase: 0 } },
      { id: "jawLow", parent: "head", shape: "tube", size: { a: [.05, 0, 0], c: [.38, -.04, 0], b: [.72, -.03, 0], r1: .12, r2: .05 }, pos: [0, -.06, 0], color: 0x8a8a5a },
      { id: "eyeL", parent: "head", shape: "sphere", size: { r: .035 }, pos: [.14, .13, .09], color: 0xc9a520 },
      { id: "eyeR", parent: "head", shape: "sphere", size: { r: .035 }, pos: [.14, .13, -.09], color: 0xc9a520 },
      { id: "tail", parent: "body", shape: "tube", size: { a: [0, 0, 0], c: [-.4, 0, .06], b: [-.8, .02, 0], r1: .18, r2: .1 }, pos: [-.7, 0, 0], color: 0x4f5c3a, pat: "bark", anim: { axis: "y", deg: 12, speed: .5, phase: 0 } },
      { id: "tail2", parent: "tail", shape: "tube", size: { a: [0, 0, 0], c: [-.4, 0, -.08], b: [-.85, .02, 0], r1: .1, r2: .02 }, pos: [-.8, .02, 0], color: 0x46523a, anim: { axis: "y", deg: 16, speed: .5, phase: 1.2 } },
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
  SPIDER,
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
  RIG.camel,
  RIG.bactrian,
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
  RIG.unicorn,
  // ---- tauric beasts: the centaur (a horse), the drider (a spider at 25x: a 1.7m body, legs spanning ~3.5m), the sphinx (a lion)
  tauric("centaur", RIG.horse, { at: [.5, 1.45, 0], drop: ["mane"], seed: 11, kind: "man", height: 2.2, outfit: { top: "none", hat: "none", hair: "long", belt: false } }),
  tauric("drider", SPIDER, { scale: 25, at: [.28, .95, 0], seed: 31, kind: "woman", height: 1.8, outfit: { top: "long", hat: "none", hair: "long", belt: false, apron: false } }),
  tauric("sphinx", RIG.lion, { at: [.5, 1.0, 0], drop: ["mane"], call: "lion", seed: 41, kind: "man", height: 1.9, outfit: { top: "none", hat: "none", hair: "bob", belt: false } }),
  // ---- beast-men (beastman): the minotaur (an ox's head, red-eyed, its own bellow), then the others
  beastman("minotaur", RIG.ox, { seed: 5, height: 2.45, build: 1.3, hoof: true, eye: 0xb03a2a, call: "minotaur", outfit: { bottom: "skirt", belt: true, mats: { skirt: [0x5c3b22, 0x3a2414, "leather", 20], belt: [0x2e2118, 0xc9a15a, "solid", 1] } } }),
  beastman("wolfman", RIG.wolf, { seed: 21, height: 2.1, build: 1.1, outfit: { top: "short", bottom: "trousers", belt: true, mats: { shirt: [0xc9bb98, 0x9a8a6a, "weave", 40], legs: [0x3a3430, 0x55504a, "solid", 12], belt: [0x3a2a1c, 0x8a8378, "solid", 1] } } }),
  beastman("boarman", RIG.boar, { seed: 22, height: 1.9, build: 1.35, hoof: true, outfit: { top: "tunic", belt: true, mats: { shirt: [0x6b4a2a, 0x4a3018, "leather", 22], belt: [0x2e2118, 0xc9a15a, "solid", 1] } } }),
  beastman("catman", RIG.cat, { seed: 23, height: 1.75, build: .95, outfit: { top: "long", bottom: "trousers", belt: true, mats: { shirt: [0x6b4a86, 0x9a7ab0, "vstripes", 10], legs: [0x3e4a5e, 0x5a667a, "solid", 12], belt: [0x3a2a1c, 0xc9a15a, "solid", 1] } } }),
  beastman("foxman", RIG.fox, { seed: 24, height: 1.8, build: .95, outfit: { top: "tunic", bottom: "trousers", belt: true, mats: { shirt: [0x3f6b46, 0x2a4a30, "weave", 40], legs: [0x5c4a32, 0x7a6a50, "solid", 12], belt: [0x3a2a1c, 0xc9a15a, "solid", 1] } } }),
  beastman("bearman", RIG.bear, { seed: 25, height: 2.35, build: 1.45, outfit: { bottom: "trousers", belt: true, mats: { legs: [0x4a2f1d, 0x2e1c10, "leather", 20], belt: [0x2e2118, 0x8a8378, "solid", 1] } } }),
  beastman("ramman", RIG.ram, { seed: 26, height: 2.0, build: 1.15, hoof: true, outfit: { top: "tunic", belt: true, mats: { shirt: [0xd9cfb6, 0xa89a7a, "weave", 40], belt: [0x5c3b22, 0xc9a15a, "solid", 1] } } }),
  beastman("smilodonman", RIG.smilodon, { seed: 27, height: 2.2, build: 1.25, outfit: { bottom: "skirt", belt: true, mats: { skirt: [0x8a6a40, 0x5a4020, "leather", 16], belt: [0x3a2a1c, 0xe8e0cc, "solid", 1] } } }),
  RIG.manticore,
  RIG.dragon,
  RIG.hydra,
  // ---- dinosaurs: the rig on two legs (mammals.js `biped`), real sizes
  RIG.tyrannosaur,
  RIG.triceratops,
  RIG.styracosaurus,
  RIG.stegosaurus,
  RIG.ankylosaurus,
];
