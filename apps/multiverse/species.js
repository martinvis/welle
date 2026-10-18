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

import { catRig, CAT_COATS, eyeMark } from "./mammals.js";
import "./winged.js";   // (registers the winged people's kind with creatures.js: assets/creatures/monsters/angel.json)
import { buildCreature } from "./creatures.js";
import { CATALOGUE, ASSETS } from "./catalogue.js";
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

export { batWing, birdWing } from "./mammals.js";   // (the wing lives with the rig now: a component a definition asks for by name)

// (the butterflies are assets now: assets/butterflies, drawn by butterflies.js)

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

// ---- THE DEFINITIONS (assets/creatures/**.json, creatures.js). Everything that is an animal is written out
// there -- a frame it stands on, its size, its colours, what it carries -- and built here into the part lists
// the engines draw. The catalogue (catalogue.js) is loaded before this module runs, so every importer of SPECIES
// sees a world that is ready (a module with a top-level await is awaited by whoever imports it).
const built = new Map();
// (by the NAME the definition gives itself, not by its file: a frame is called horse too, and is not a horse)
const byName = new Map([...ASSETS.values()].filter((d) => d?.name).map((d) => [d.name, d]));
export const A = (name) => {          // a species by name, built once
  if (built.has(name)) return built.get(name);
  const def = byName.get(name);
  if (!def) throw new Error(`species: no definition for "${name}" (assets/index.json)`);
  const made = buildCreature(def, ASSETS);
  built.set(name, made);
  return made;
};
export const assetCatalogue = () => ({ index: CATALOGUE, bank: ASSETS });
const RIG = new Proxy({}, { get: (_, k) => A(String(k)) });   // (RIG.horse, as it always was)
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
  // (its HEAD is the person's mesh face, heads.js -- found by part index: the person's indices moved past the animal's,
  //  as a fused rider's are; without it the man had no head at all)
  const face = man.face ? { ...man.face, head: parts.length + man.face.head, gaze: parts.length + man.face.gaze } : null;
  return { ...rest, name, monster: true, call, parts: [...parts, ...human], ...(face ? { face } : {}) };
}

// ---- beast-men: the human rig (people.js makePerson) with an animal's head -- the species' own rig head (its
// head sphere and everything hung on it: muzzle, ears, eye marks, nose, horns, tusks, fangs), scaled to a
// human-sized head -- in the animal's hide, with its tail and, for the hoofed, hooves; they call as the animal;
// outfit: what it wears over the bare hide (makePerson's: a kilt, a tunic, breeches... -- the wardrobe's kit of its
// name, assets/clothes/wardrobe.json `outfits`)
function beastman(name, rig, { seed, height, build = 1.2, hoof = false, headScale, eye, call, outfit } = {}) {
  const head = rig.parts.find((p) => p.id === "head"), body = rig.parts.find((p) => p.id === "body");
  const beast = { hide: body.color, build, hoof, headScale, eye, foot: rig.parts.find((p) => p.id.startsWith("foot"))?.color ?? body.color,
    head: { r: head.size.r, color: head.color, pat: head.pat, parts: subtree(rig.parts, "head") },
    tail: rig.parts.filter((p) => /^tail/.test(p.id) && p.parent === "body").flatMap((p) => [p, ...subtree(rig.parts, p.id)]) };
  return { ...makePerson({ seed, kind: "man", height, beast, outfit }), name, monster: true, call: call ?? rig.name };
}


// THE WORLD'S CAST, in the order the demo grid lays them out (small to large). Every one of them is a
// DEFINITION now -- assets/creatures/**.json, built by creatures.js -- except the hybrids below, which are a
// person and an animal put together and so are built from both.
export const SPECIES = [
  A("chicken"),
  A("parrot"),
  A("owl"),
  A("hare"),
  A("cat"),
  A("fox"),
  A("eagle"),
  A("dog"),
  A("sheep"),
  A("ram"),
  A("pig"),
  A("wolf"),
  A("deer"),
  A("reindeer"),
  A("oryx"),
  A("cervicapra"),
  A("tiger"),
  A("lion"),
  A("leopard"),
  A("smilodon"),
  A("cow"),
  A("ox"),
  A("zebra"),
  A("horse"),
  A("bear"),
  A("hippo"),
  A("giraffe"),
  A("elephant"),
  A("rhinoceros"),
  A("snake"),
  A("rat"),
  A("boar"),
  A("swan"),
  A("flamingo"),
  A("duck"),
  A("peacock"),
  A("crocodile"),
  A("frog"),
  A("turtle"),
  A("hedgehog"),
  A("scorpion"),
  A("spider"),
  A("beaver"),
  A("camel"),
  A("bactrian"),
  A("bat"),
  A("unicorn"),
  tauric("centaur", A("horse"), { at: [.5, 1.45, 0], drop: ["mane"], seed: 11, kind: "man", height: 2.2, outfit: { bare: true, hair: "long" } }),
  tauric("drider", A("spider"), { scale: 25, at: [.28, .95, 0], seed: 31, kind: "woman", height: 1.8, outfit: { named: "drider", hair: "long" } }),
  tauric("sphinx", A("lion"), { at: [.5, 1.0, 0], drop: ["mane"], call: "lion", seed: 41, kind: "man", height: 1.9, outfit: { bare: true, hair: "bob" } }),
  A("angel"),
  A("demon"),
  beastman("minotaur", A("ox"), { seed: 5, height: 2.45, build: 1.3, hoof: true, eye: 0xb03a2a, call: "minotaur", outfit: { named: "minotaur" } }),
  beastman("wolfman", A("wolf"), { seed: 21, height: 2.1, build: 1.1, outfit: { named: "wolfman" } }),
  beastman("boarman", A("boar"), { seed: 22, height: 1.9, build: 1.35, hoof: true, outfit: { named: "boarman" } }),
  beastman("catman", A("cat"), { seed: 23, height: 1.75, build: .95, outfit: { named: "catman" } }),
  beastman("foxman", A("fox"), { seed: 24, height: 1.8, build: .95, outfit: { named: "foxman" } }),
  beastman("bearman", A("bear"), { seed: 25, height: 2.35, build: 1.45, outfit: { named: "bearman" } }),
  beastman("ramman", A("ram"), { seed: 26, height: 2.0, build: 1.15, hoof: true, outfit: { named: "ramman" } }),
  beastman("smilodonman", A("smilodon"), { seed: 27, height: 2.2, build: 1.25, outfit: { named: "smilodonman" } }),
  A("manticore"),
  A("dragon"),
  A("hydra"),
  A("tyrannosaur"),
  A("triceratops"),
  A("styracosaurus"),
  A("stegosaurus"),
  A("ankylosaurus"),
  A("diplodocus"),
  A("parasaurolophus"),
];
