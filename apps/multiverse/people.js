// Generative people for the composite engine -- the mammal rig's ideas
// applied to humans, dressed after the clothing lab (the medieval wardrobe:
// shirts, tunics, dresses, kirtle + surcoat, hose and trousers, skirts,
// hats, hoods, belts, boots, aprons).
//
// BODY: a metaball torso of four lobes (pelvis, hips, belly, chest) that
// the composite engine smooth-unions into one silhouette, a neck pill and a
// head sphere with nose, ears, mouth and eyes; arms of two bones with a
// hand, legs of two bones with a foot. Knees come from the same two-bone IK
// as the mammals' (skeleton.js) on a biped walk and run; feet stay flat
// (`level`); arms, the shoulders' twist, skirts and plaits swing on the
// gait clock and settle when the person stands (`anim.amp`).
//
// CLOTHING, the lab's principle carried over: garments are shells round
// the body. Where a garment covers a whole piece (a sleeve, a trouser leg,
// a bodice) the piece simply wears its colour, a little thicker; where it
// does not (a short sleeve, a boot shaft, a skirt, a hair cap) it is an
// extra part slightly larger than the body under it, and the composite
// engine's "nearest surface wins" puts it on top. The lab cut its shells
// with planes; here a shell may be cut by a SLAB along its own axis
// (`clip: { lo, hi, solid }`, metres from its A end): a skirt is a
// widening round cone cut flat at the waist and the hem, a hair cap a
// sphere cut at the hairline, a hood a sphere with the face cut away, a
// brim a sphere cut to a thin disc. Open shells show their inside (a
// hood's lining); solid ones get flat caps (a belt, a brim, a skirt's
// waistband).
//
// CLOTH: every garment part carries a second colour and a pattern
// (stripes, checks, weave, leather, mail, braid) in its own wrapped frame,
// uneven dye, wear toward a hem, pleat folds on skirts, a trim at hems and
// cuffs (plain band, embroidered, scalloped) and front lacing on a bodice;
// the engine draws a dark seam wherever two colours meet (eyes and mouth
// excepted). Still 2D silhouettes and one closed-form ray hit per part --
// nothing is marched.
//
// Root space: metres, x forward, y up from the ground (feet on y = 0),
// z to the person's left. Heights run 1.02-1.92m by kind.
import { rng } from "./flora.js";
import { hangRot, vNorm, vSub, vDot, scalePart } from "./geom.js";
import { expression } from "./faces.js";

const SKIN = [0xf0c8a0, 0xdfb289, 0xc79668, 0xa9764d, 0x7c5236];
const HAIR = [0x241b14, 0x4a2f18, 0x7a4a22, 0xa87433, 0xd9b96a, 0x99928a, 0xb0502c];
const DYES = [0x8e2f35, 0x2f5d8e, 0x3f6b46, 0xb07d2e, 0x6b4a86, 0x9a5232, 0x4a6b73, 0x8a8378, 0x5d6b35, 0x7a3b52, 0x3e4a5e, 0x9c7a4a];
const UNDYED = [0xd9cfb6, 0xc9bb98, 0xb8ab8a];   // linen and wool as they come
const LEATHER = [0x4a2f1d, 0x3a2a1c, 0x5c3b22, 0x2e2118, 0x6b4a2a];
// the people's options (index.html fills them from config.json): nose -- a nose on human heads (one SDF part each;
// off by default: a face reads without it, and every person saves a part)
export const PEOPLE = { nose: true };
const STRAW = 0xd6b86a, SCLERA = 0xece6da;
// iris colours, weighted roughly as in real life: mostly browns, then blue, hazel, amber, green, grey
const IRIS = [[0x3b2314, 35], [0x5a3a22, 30], [0x3f6f9a, 10], [0x7a6232, 10], [0x8a5a1a, 5], [0x4f6b3a, 5], [0x7a8590, 5]];
// Work gestures by trade (village-life.js picks one by name; skeleton.js swings it on the world clock
// with strength an.work, on top of the pose): per piece -- upper arm, forearm (s: +1 left, -1 right;
// null = that side holds still) and chest -- { axis, bias, deg, speed (cycles/s), phase } in degrees.
// z swings an arm forward (+) and back and bends the chest forward, x takes an arm out to its side
// (outward = -s), y turns the chest.
const G = (axis, bias, deg, speed, phase = 0) => ({ axis, bias, deg, speed, phase });
const alt = (s) => (s > 0 ? 0 : Math.PI);
export const GESTURES = {
  dig:    { arm: () => G("z", 45, 30, .45), fore: () => G("z", 30, 25, .45, .8), chest: G("z", 15, 12, .45) },           // a spade: thrust, lift
  hoe:    { arm: () => G("z", 70, 35, .5), fore: () => G("z", 15, 30, .5, .5), chest: G("z", 10, 10, .5) },              // chop down, draw back
  mow:    { arm: () => G("z", 40, 8, .35, 1.6), fore: () => G("z", 25, 6, .35, 1.6), chest: G("y", 0, 28, .35) },       // the scythe's sweep: the body turns
  hammer: { arm: (s) => (s < 0 ? G("z", 60, 50, 1) : G("z", 40, 5, 1)), fore: (s) => (s < 0 ? G("z", 40, 40, 1, .6) : G("z", 50, 5, 1)) },
  knead:  { arm: (s) => G("z", 50, 12, .8, alt(s)), fore: (s) => G("z", 45, 20, .8, .5 + alt(s)), chest: G("z", 8, 5, 1.6) },
  sell:   { arm: (s) => (s < 0 ? G("z", 30, 25, .35) : G("x", -s * 15, 10, .25)), fore: (s) => (s < 0 ? G("z", 50, 25, .35, 1) : G("z", 30, 10, .25)) },
  fish:   { arm: (s) => (s < 0 ? G("z", 55, 6, .2) : G("z", 40, 4, .2)), fore: (s) => (s < 0 ? G("z", 30, 8, .2) : G("z", 40, 4, .2)) },
  strum:  { arm: (s) => (s < 0 ? G("z", 25, 4, .3) : G("z", 45, 3, .3)), fore: (s) => (s < 0 ? G("z", 60, 18, 2.2) : G("z", 70, 3, .3)) },
  bless:  { arm: (s) => G("x", -s * 25, 12, .15), fore: () => G("z", 40, 10, .15) },
  eat:    { arm: (s) => (s < 0 ? G("z", 30, 10, .25) : G("z", 20, 3, .25)), fore: (s) => (s < 0 ? G("z", 95, 35, .25) : G("z", 60, 5, .25)) },
  pick:   { arm: (s) => (s < 0 ? G("z", 120, 25, .4) : G("z", 60, 20, .4, Math.PI)), fore: (s) => G("z", 25, 20, .4, alt(s)) },
  weave:  { arm: (s) => G("z", 45, 15, .7, alt(s)), fore: (s) => G("z", 40, 20, .7, alt(s)) },
  sew:    { arm: () => G("z", 35, 5, .5), fore: (s) => (s < 0 ? G("z", 60, 25, .9) : G("z", 60, 5, .5)) },
  lift:   { arm: () => G("z", 50, 25, .4), fore: () => G("z", 60, 20, .4, .4), chest: G("z", 10, 10, .4) },
  chop:   { arm: (s) => (s < 0 ? G("z", 70, 45, .8) : G("z", 30, 5, .8)), fore: (s) => (s < 0 ? G("z", 40, 35, .8, .5) : G("z", 50, 5, .8)) },   // the cleaver falls, the other hand holds the meat
  saw:    { arm: (s) => (s < 0 ? G("z", 35, 18, .9) : G("z", 40, 3, .9)), fore: (s) => (s < 0 ? G("z", 55, 28, .9, .4) : G("z", 60, 3, .9)), chest: G("z", 12, 6, .9) },
  tend:   { arm: (s) => G("z", 55, 12, .3, alt(s)), fore: (s) => G("z", 30, 15, .3, alt(s)), chest: G("z", 18, 4, .3) },            // bent over the hives
};
const workOf = (piece, s) => Object.fromEntries(Object.entries(GESTURES).map(([k, g]) => [k, typeof g[piece] === "function" ? g[piece](s) : g[piece]]).filter(([, v]) => v));

// a town guard's kit (a makePerson outfit): a mail shirt to mid-thigh (the tunic), a steel cap, dark breeches, boots and a belt
export const SOLDIER = { top: "tunic", bottom: "trousers", hat: "cap", hair: "short", fringe: false, belt: true, boots: true, barefoot: false, apron: false, trim: "none",
  mats: { shirt: [0x8c9298, 0x5a6066, "mail", 30], hat: [0xa4aab0, 0x70767c, "solid", 1], legs: [0x3e342a, 0x5a4e40, "solid", 12],
          belt: [0x3a2a1c, 0xc9a15a, "solid", 1], boots: [0x2e2118, 0x000000, "leather", 25] } };
export const KINDS = ["man", "woman", "child10", "child5"];
export const SEAT_CLEAR = .08;   // hip joint above a seat top: one thigh radius (see sitAt)
export const TOPS = ["none", "short", "long", "tunic", "dress", "surcoat"];
export const BOTTOMS = ["hose", "trousers", "skirt", "longskirt"];
export const HATS = ["none", "cap", "hood", "brim", "point", "straw"];
export const HAIRS = ["shaved", "short", "bob", "long", "ponytail", "bun", "braid"];
export const TRIMS = ["none", "band", "embroidered", "scallop"];
export const PATTERNS = ["solid", "hstripes", "vstripes", "checks", "weave", "leather", "mail"];

const mixC = (a, b, t) => {
  const ch = (c, s) => (c >> s) & 255;
  return [16, 8, 0].reduce((o, s) => o | (Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s), 0);
};

// A wardrobe drawn from its own seeded stream (so outfits never shift the
// body's draws). Everything here can be overridden: makePerson({ outfit }).
function outfitFor(kind, r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const child = kind.startsWith("child"), female = kind === "woman" || (child && r() < .5);
  const cloth = () => r() < .3 ? pick(UNDYED) : pick(DYES);
  const other = (c) => { let d = pick(DYES); if (d === c) d = DYES[(DYES.indexOf(d) + 5) % DYES.length]; return d; };
  const o = { female };
  o.top = female ? pick(child ? ["dress", "dress", "long", "tunic"] : ["dress", "dress", "surcoat", "long", "short"])
                 : pick(child ? ["short", "long", "tunic", "none"] : ["short", "long", "long", "tunic", "tunic", "surcoat"]);
  o.bottom = female ? pick(["skirt", "longskirt", "longskirt"]) : pick(["hose", "trousers", "trousers"]);
  o.hair = female ? pick(child ? ["long", "braid", "ponytail", "bob"] : ["long", "long", "bun", "bun", "braid", "braid", "ponytail", "bob"])
                  : pick(child ? ["short", "short", "bob"] : ["shaved", "short", "short", "short", "bob", "long", "ponytail"]);
  o.fringe = r() < .3;
  o.hat = r() < (child ? .8 : .5) ? "none" : pick(female ? ["hood", "cap", "straw"] : child ? ["cap", "straw"] : ["cap", "hood", "brim", "point", "straw"]);
  o.belt = r() < .6;
  o.boots = r() < (child ? .2 : .5);
  o.barefoot = !o.boots && r() < .3;
  o.apron = female && !child && r() < .35;
  o.lacing = r() < .5;
  o.trim = pick(["none", "none", "band", "band", "embroidered", "scallop"]);
  o.pleats = 6 + Math.floor(r() * 14);
  o.nose = [.75 + r() * .6, .7 + r() * .7];   // width, length
  r();   // (was the ears' size: no ears are drawn now, but the value is still taken so every later trait keeps its seed)
  // materials: [colour, pattern colour, pattern, scale]
  const shirt = cloth(), skirt = pick(DYES), legs = r() < .75 ? cloth() : pick(LEATHER), hat = o.hat === "straw" ? STRAW : r() < .4 ? pick(LEATHER) : pick(DYES);
  const shirtPat = pick(["solid", "solid", "solid", "weave", "weave", "vstripes", "checks", "hstripes"]);
  const skirtPat = pick(["solid", "solid", "solid", "hstripes", "checks", "weave"]);
  o.mats = {
    shirt: [shirt, shirtPat === "weave" ? mixC(shirt, 0x000000, .3) : other(shirt), shirtPat, shirtPat === "weave" ? 40 : shirtPat === "checks" ? 12 : 10],
    skirt: [skirt, skirtPat === "weave" ? mixC(skirt, 0x000000, .3) : other(skirt), skirtPat, skirtPat === "weave" ? 40 : skirtPat === "checks" ? 8 : 7],
    legs: [legs, mixC(legs, 0xffffff, .25), r() < .15 ? "hstripes" : "solid", 12],
    hat: [hat, mixC(hat, 0x000000, .35), o.hat === "straw" ? "weave" : "leather", o.hat === "straw" ? 60 : 20],
    belt: [pick(LEATHER), 0xc9a15a, "solid", 1],
    boots: [pick(LEATHER), 0x000000, "leather", 25],
    apron: [pick(UNDYED), 0xbfae8f, "solid", 1],
  };
  return o;
}


// pose: undefined = standing/walking; "sit" = thighs forward, shins down for a
// bench (place origin at seatY - hipY); "ride" = legs astride a mount's
// flanks; "carry" = both arms round a load held in front, legs still
// walking; "lie" = flat on the back, head toward +x, back on y = 0; "guard" = at the watch: the weapon arm (the
// figure's right) lifted, the forearm forward; "draw" = drawing a bow, the legs still walking.
// still: strip every swing and the leg IK so the figure holds perfectly still.
// kind: "man" | "woman" | "child10" | "child5" -- drawn from the seed unless
// given (adult: true keeps to men and women). It sets height, build, hair,
// clothes and the children's proportions (bigger heads, shorter legs), and it
// is what the voice follows: a woman's voice on a woman, a child's on a child.
// outfit: overrides for the drawn wardrobe (any key of outfitFor's result).
// beast: an animal-headed man (species.js beastman: the minotaur, the wolfman...) -- the same frame, heavier,
// in the animal's hide: its own head parts scaled to a human-sized head, its tail, hooves or paws; no clothes,
// hair or hat. { hide, foot, hoof, build, headScale, eye, head: { r, color, pat, parts (head-local) }, tail: [parts] }
// upper: the upper body alone -- the torso pill and all above it on the pelvis bone, no legs, skirts or
// gait (a centaur's: mammals.js hangs it on the horse's chest); pelvisY reports where the bone sits.
export function makePerson({ seed = 1, height, pose, still, kind, adult, outfit, beast = null, upper = false } = {}) {
  const r = rng(seed * 771 + 13);
  const kr = r();
  if (!kind) kind = adult ? (kr < .5 ? "man" : "woman") : kr < .4 ? "man" : kr < .8 ? "woman" : kr < .9 ? "child10" : "child5";
  const isChild = kind.startsWith("child");
  const h = height ?? (kind === "man" ? 1.68 + r() * .24 : kind === "woman" ? 1.55 + r() * .18 : kind === "child10" ? 1.32 + r() * .14 : 1.02 + r() * .12);
  const skinDrawn = SKIN[Math.floor(r() * SKIN.length)], skin = beast ? beast.hide : skinDrawn;   // (drawn either way: the seed's stream stays put)
  const hairC = HAIR[Math.floor(r() * HAIR.length)];
  const build = (kind === "woman" ? .92 : isChild ? .88 : 1) * (.92 + r() * .18) * (beast?.build ?? 1);   // widths
  const headPh = r() * 3;
  const drawn = outfitFor(kind, rng(seed * 313 + 7));
  const o = { ...drawn, ...outfit, mats: { ...drawn.mats, ...(outfit?.mats ?? {}) } };
  if (beast) {   // a beast, not a man: the hide all over, the legs too -- then what it wears (outfit, over these), but never
    // human hair, a hat (horns and ears) or footwear (hooves, paws)
    Object.assign(o, { top: "none", bottom: "hose", belt: false, apron: false, trim: "none" }, outfit ?? {}, { hair: "shaved", hat: "none", boots: false, barefoot: true });
    o.mats = { ...o.mats, legs: [skin, skin, "solid", 1], ...(outfit?.mats ?? {}) };
  }
  if (pose === "ride" && (o.top === "dress" || o.top === "surcoat" || o.bottom.includes("skirt"))) {   // astride: breeches, not skirts
    o.top = o.top === "dress" || o.top === "surcoat" ? "long" : o.top; o.bottom = "trousers"; o.apron = false;
  }
  const female = !!o.female;

  // ---- proportions (children: bigger heads, shorter legs)
  const S = h / 1.75, S0 = 1;   // S0: the adult reference scale (seat depth)
  const shW = female ? .9 : 1, hipW = female ? 1.12 : 1;
  const hr = h * (kind === "child5" ? .1 : kind === "child10" ? .085 : .069);
  const hipY = h * (kind === "child5" ? .45 : kind === "child10" ? .49 : .525);
  const shY = h - 2 * hr - .045 * h, T = shY - hipY;
  const pelY = hipY + .06 * T, waistY = hipY + .25 * T, headY = h - hr;
  const rChest = .108 * S * build, rBelly = .105 * S * build, rHip = .1 * S * build, rPel = .105 * S * build;
  const spanCh = .088 * S * build * shW, spanHip = .06 * S * build * hipW;
  const chestY = shY - .115 * S * build;
  const armU = .17 * h, armF = .155 * h, rArmU = .026 * h * build, rArmF = .022 * h * build, rHand = .024 * h;
  const ankY = .045 * h, legU = (hipY - ankY) * .5, legLo = hipY - ankY - legU;
  const rThigh = .042 * h * build * (female ? 1.05 : 1), rKnee = .032 * h * build, rAnk = .023 * h, rFoot = .026 * h;
  const hipZ = .085 * S * build * hipW, shZ = spanCh + rChest * .62;   // the shoulder joint inside the chest's rounded end: no cap sticking out
  const TH = .012 * S;   // cloth thickness over the body
  // a beast's animal parts (head and tail): scaled so its head sphere is a man's, a little over (the muzzle adds length)
  const bf = beast ? hr * (beast.headScale ?? 1.1) / beast.head.r : 1;
  const beastPart = (p) => { const q = scalePart(p, bf); if (q.k) q.k *= bf; if (beast.eye && q.dot) q.dot = { ...q.dot, iris: beast.eye }; return q; };

  // ---- materials
  const M = o.mats;
  const mat = (m, cloth = {}) => m ? { color: m[0], color2: m[1], pat: m[2] === "solid" ? undefined : m[2], cloth: { scale: m[3], wear: 1, ...cloth } } : { color: skin };
  const skirted = o.top === "dress" || o.top === "surcoat" || o.bottom === "skirt" || o.bottom === "longskirt";
  const topM = o.top === "none" ? null : o.top === "dress" ? M.skirt : M.shirt;       // chest, belly, sleeves
  const lowM = o.top === "tunic" || o.top === "surcoat" ? M.shirt : o.top === "dress" || skirted ? M.skirt : M.legs;   // pelvis and hips
  const legsM = M.legs;
  const trimCloth = { trim: TRIMS.indexOf(o.trim) };
  const mouthC = mixC(skin, 0xb8323a, .82);   // lips: clearly red

  const parts = [];
  const add = (p) => { const q = { edge: 0, seam: true, ...p }; parts.push(q); return q; };
  // a bone hanging from `pos` along direction dir: its A end (radius rA) at pos
  const bone = (id, parent, pos, dir, len, rA, rB, extra = {}) => {
    if (Math.abs(rA - rB) >= len) console.warn(`person: ${id}: radii ${rA.toFixed(3)}/${rB.toFixed(3)} over ${len.toFixed(3)}m make no round cone (one sphere swallows the other)`);
    return add({ id, parent, shape: "capsule", size: { r: rA, r2: rB, len }, pos, rot: hangRot(dir), pivot: [0, -len / 2, 0], ...extra });
  };
  // a sphere of radius R at c with an axis n (a capsule of 1cm along it), cut by the slab
  // [lo, hi] along n measured from c; lo from a point P0 on the cutting plane
  const ball = (id, parent, c, R, n, P0, extra = {}) => {
    n = vNorm(n);
    const lo = P0 ? vDot(vSub(P0, c), n) : -1e4;
    return bone(id, parent, c, n, .01, R, R, { ...extra, clip: { lo, hi: 1e4, ...(extra.clip ?? {}) } });
  };

  // ---- the torso: ONE flattened pill (composite `flat`) from the hips to the shoulders -- its depth .58 of
  // its width, the shoulders its rounded top -- on the pelvis (the root, an x-capsule: the "body frame" of the
  // coat and the figure's forward; an undrawn bone). It replaced four lobes (pelvis, hips, belly, chest):
  // two shapes fewer per person, ~5-7% cheaper; the waist and the bust went with them
  const kT = .05 * S;
  add({ id: "pelvis", parent: null, shape: "capsule", size: { r: rPel + (lowM ? TH : 0), len: .04 * S }, geomRot: [0, 0, 90], pos: [0, pelY, 0], bob: true, bone: true,   // the root: posed (its x axis is the body's forward), not drawn -- the hips take its girth
        frame: "body", k: kT, ...mat(lowM) });
  const pRt = spanCh + rChest, pRb = spanHip + Math.max(rHip, rPel), pYt = shY + .02 * S - pRt, pYb = pelY;   // the pill: shoulder and hip half-widths, its two centres
  // (its frame -- neck, head, arms and hair hang on it -- has its origin at the pelvis, chestO: a working bend or a
  // twist turns the torso about its bottom, the hips, so it never swings its belly off the legs)
  const chestO = pelY;
  const chestPart = add({ id: "chest", parent: "pelvis", shape: "capsule", pos: [0, chestO - pelY, 0], frame: "body", k: kT,
        size: { r: pRt + (topM ? TH : 0), r2: pRb + (topM ? TH : 0), len: pYt - pYb }, pivot: [0, (pYt + pYb) / 2 - chestO, 0], flat: .58,
        anim: { axis: "y", deg: 4, speed: .8, phase: Math.PI, amp: true, work: workOf("chest", 1) }, ...mat(topM, { lace: o.lacing && (o.top === "dress" || o.top === "surcoat") ? 1 : 0 }) });
  let surcoatPart = null;   // (a belt is painted onto it too)
  const neckBot = chestY + .5 * rChest, neckTop = headY - .4 * hr;
  add({ id: "neck", parent: "chest", shape: "capsule", size: { r: hr * (isChild ? .3 : beast ? .6 : .37), len: neckTop - neckBot }, pos: [0, (neckTop + neckBot) / 2 - chestO, 0], color: skin, k: .03 * S });
  // The head is an OVOID, not a ball: a round cone standing on its own axis -- the CRANIUM is the sphere it
  // always was (its top cap centre sits at the part's own origin, so the hair, the hats and the eyes keep
  // exactly the places they had), and below it the head runs on for hL and narrows to hJaw: a jaw and a chin.
  // That, not a symmetric stretch, is what makes a head read as a head -- the stretch hides under the hair,
  // the jaw is the part a face shows. (Round about its axis: it cannot also be narrower across than deep.)
  const hL = beast ? 0 : .40 * hr, hJaw = .74 * hr;
  const headPart = add({ id: "head", parent: "chest", shape: "capsule", size: { r: hr, r2: hJaw, len: hL }, pivot: [0, -hL / 2, 0],
        pos: [.01 * S, headY - chestO, 0], color: skin, k: .02 * S,
        anim: { axis: "y", deg: 14, speed: .22, phase: headPh } });

  // ---- the face (head-local, in head radii)
  const H = (x, y, z = 0) => [x * hr, y * hr, z * hr];
  // ON THE HEAD: where the ray from the head's origin in direction d leaves the ovoid. Inside a round cone is
  // "within the tapered radius of some point of its axis", so this bisects on that -- to well under a
  // millimetre, at build time, once. It keeps every feature's ANGLE, so the face's layout is the one the
  // sphere gave; without it a mark placed at hr would sit a centimetre inside the skin at the chin and the
  // composite, which paints a mark only within a hair of its own plane, would silently drop it (the mouth first).
  const onHead = (d) => {
    const n = vNorm(d);
    const inside = (t) => {
      const p = n.map((c) => c * t);
      for (let i = 0; i <= 48; i++) {   // down the axis: origin (the cranium's centre) to hL below it
        const u = i / 48;
        if (Math.hypot(p[0], p[1] + hL * u, p[2]) <= hr + (hJaw - hr) * u) return true;
      }
      return false;
    };
    let lo = 0, hi = hr + hL + .01;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (inside(m)) lo = m; else hi = m; }
    return n.map((c) => c * lo);
  };
  // a face mark (composite FACE MARKS: drawn flat on the head, no SDF): centred where direction d meets the
  // head, its corners half-angle `half` (radians) to either side about the vertical, half-height h
  const rotYv = (v, a) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
  const mark = (id, d, half, h, color, iris, style = {}) => {
    const c1 = onHead(rotYv(d, half)), c2 = onHead(rotYv(d, -half)), w = vSub(c2, c1);
    return bone(id, "head", c1, w, Math.hypot(...w), h, h, { color, dot: iris !== undefined ? { iris, ...style } : { ...style } });
  };
  const iris = (() => { const e = rng(seed * 577 + 29)(); let a = 0, tot = IRIS.reduce((t, [, w]) => t + w, 0); for (const [c, w] of IRIS) if ((a += w / tot) >= e) return c; return IRIS[0][0]; })();   // (its own stream: every other trait keeps its seed)
  const eR = Math.max(.012, .15 * hr);
  if (beast) {   // the beast's head: the animal's own -- its head sphere's children (muzzle, ears, eye marks, nose, horns, tusks) -- man-sized
    Object.assign(headPart, { shape: "sphere", size: { r: beast.head.r * bf }, color: beast.head.color, pat: beast.head.pat, fur: true });
    for (const p of beast.head.parts) parts.push(beastPart(p));
  } else {
  for (const s of [1, -1]) {
    const d = vNorm([.87, .16, .4 * s]);
    mark(s > 0 ? "eyeL" : "eyeR", d, .95 * eR / hr, .42 * eR, SCLERA, iris, { role: "eye", side: s, reach: 1.9 });   // white, its iris and pupil; the socket sinks round it (reach)
    // an eyebrow: a thin dark lens above it -- and the BROW RIDGE it lies on, which the head sphere has no shape for:
    // relief 1 gives the forehead its break in the light alone, out to four times the lens's own half-height
    mark(s > 0 ? "browL" : "browR", vNorm([.86, .34, .42 * s]), 1.15 * eR / hr, .13 * eR, mixC(hairC, 0x000000, .35), undefined, { role: "brow", side: s, relief: 1, reach: 4 });
  }
  const [noseW, noseL] = o.nose;
  if (PEOPLE.nose) bone("nose", "head", onHead([.875, .29, 0]), [.29 * noseL, -.46, 0], hr * Math.hypot(.29 * noseL, .46), .09 * hr * noseW, .14 * hr * noseW, { color: skin, k: .01 * S });
  mark("mouth", vNorm([.87, -.5, 0]), .24, .07 * hr, mouthC, undefined, { role: "mouth" });   // the lips: a lens
  }

  // ---- hair: a cap cut at the hairline, plus the style's volumes. The caps are SOLID cuts, not open shells:
  // a shell shows the far wall's inside at the cut (darkened), which at the hairline reads as a gap between the
  // hair and the skin -- hollow hair. Solid, the cut is a filled face and the hair meets the skin along an edge.
  const hairM = { color: hairC, color2: mixC(hairC, 0x000000, .38), pat: "hair", cloth: { scale: 110, wear: 0 } };   // strands (composite pattern 16), darker between them
  const capPlane = (F, N) => { const d = vSub(N, F); let n = [-d[1], d[0], 0]; if (n[1] < 0) n = n.map((c) => -c); return n; };
  if (o.hair !== "shaved") {
    const F = o.fringe ? H(.87, .5) : H(.7, .72),   // the hairline in front: a forelock ends just above the brows, else higher -- a forehead
          N = o.hair === "short" ? H(-.92, -.5) : H(-.95, -.15);
    ball("hairC", "head", H(-.02, .02), hr * (o.hair === "short" ? 1.07 : 1.1), capPlane(F, N), F, { ...hairM, clip: { solid: true } });
  }
  if (o.hair === "bob" || o.hair === "long")   // down to the jaw at the back and sides, the face open
    ball("hairB", "head", H(-.12, -.1), hr * (o.hair === "bob" ? 1.22 : 1.18), [-1, -.1, 0], H(.28, 0), { ...hairM, clip: { solid: true } });
  if (o.hair === "long") {   // a fall of hair: ONE curved surface like a skirt -- a round-cone shell
    // from the back of the head down to the shoulder blades, tilted back a little and cut open at
    // the front (clip.back: nothing more than 4cm in front of its top, which sits at the head's
    // centre), so it wraps the back of the head and shoulders and leaves the face and chest free
    // (wide enough at the bottom that the shoulder blades stay under it, not poking past its edges)
    const top = [.01 * S - .05 * hr, headY - chestO + .05 * hr, 0], yB = chestY - chestO - .5 * rChest, len = top[1] - yB;
    bone("hairL", "chest", top, [-.05, -1, 0], len, 1.12 * hr, (spanCh + rChest) * .95,
         { ...hairM, clip: { lo: 0, hi: len, back: -.04 * S }, anim: { axis: "z", deg: 3, speed: .8, phase: -.9, amp: true } });
  }
  if (o.hair === "ponytail")
    bone("hairT", "head", H(-.92, .15), [-.35, -1, 0], 2.2 * hr, .32 * hr, .18 * hr, { ...hairM, anim: { axis: "z", deg: 7, speed: .8, phase: -.9, amp: true } });
  if (o.hair === "bun") add({ id: "hairN", parent: "head", shape: "sphere", size: { r: .45 * hr }, pos: H(-.85, .5), ...hairM });
  if (o.hair === "braid")
    bone("hairP", "head", H(-.95, -.25), [-.12, -1, 0], 3.3 * hr, .26 * hr, .15 * hr,
         { color: hairC, color2: mixC(hairC, 0x000000, .4), pat: "braid", cloth: { scale: Math.round(1 / (.5 * hr)) }, anim: { axis: "z", deg: 6, speed: .8, phase: -.9, amp: true } });

  // ---- hats (head-local; cut shells, discs and cones)
  const hatM = mat(M.hat);
  if (o.hat === "cap")
    ball("hat", "head", H(-.12, .22), 1.2 * hr, capPlane(H(1.0, .38), H(-1.05, -.15)), H(1.0, .38), hatM);
  else if (o.hat === "hood") {
    ball("hat", "head", H(-.12, .05), 1.38 * hr, [-1, -.3, 0], H(.55, 0), hatM);
    const y0 = shY + .05 * S, y1 = shY - .2 * S;   // the capelet over the shoulders
    bone("hatCape", "chest", [-.01 * S, y0 - chestO, 0], [0, -1, 0], y0 - y1, .1 * S, .27 * S * shW, { ...hatM, clip: { lo: 0, hi: y0 - y1 } });
  } else if (o.hat === "brim" || o.hat === "straw") {
    const top = o.hat === "straw" ? .8 : .95;
    bone("hat", "head", H(0, top), [0, -1, 0], (top - .25) * hr, .98 * hr, 1.08 * hr, { ...hatM, clip: { lo: 0, hi: (top - .25) * hr, solid: true } });
    ball("hatBrim", "head", H(0, .3), (o.hat === "straw" ? 2.8 : 2.4) * hr, [0, -1, 0], null, { ...hatM, clip: { lo: -.05 * hr, hi: .05 * hr, solid: true } });
  } else if (o.hat === "point") {
    ball("hat", "head", H(-.08, .15), 1.15 * hr, capPlane(H(1.0, .3), H(-1.05, -.2)), H(1.0, .3), hatM);
    bone("hatTip", "head", H(-.1, .45), [-.12, 1, 0], 2.1 * hr, 1.0 * hr, .06 * hr, { ...hatM, clip: { lo: 0, hi: 1e4, solid: true } });
  }

  // ---- arms: upper (swings on the gait), forearm (bends more as it swings forward), hand
  // (the shoulder joint just under the torso's top: where the pill's sloping top is at shZ)
  const armY = pYt + Math.sqrt(Math.max(pRt * pRt - shZ * shZ, 0)) - .35 * rArmU;
  const longSleeves = o.top === "long" || o.top === "tunic" || o.top === "dress" || o.top === "surcoat";
  const sleeveM = longSleeves ? (o.top === "dress" ? M.skirt : M.shirt) : null;
  for (const [s, tag] of [[1, "L"], [-1, "R"]]) {
    const ph = s > 0 ? Math.PI : 0;   // the left arm swings forward with the right leg
    add({ id: "arm" + tag, parent: "chest", shape: "capsule", size: { r: rArmU + (sleeveM ? TH : 0), r2: rArmU * .9 + (sleeveM ? TH : 0), len: armU },
          pos: [0, armY - chestO, s * shZ], rot: [-s * 7, 0, 0], pivot: [0, -armU / 2, 0], k: .025 * S,   // its top level with the torso's, blended in
          anim: { axis: "z", deg: 20, speed: .8, phase: ph, amp: true, work: workOf("arm", s) }, ...mat(sleeveM) });
    add({ id: "fore" + tag, parent: "arm" + tag, shape: "capsule", size: { r: rArmF + (sleeveM ? TH : 0), r2: rArmF * .8 + (sleeveM ? TH : 0), len: armF },
          pos: [0, -armU, 0], rot: [s * 3, 0, 12], pivot: [0, -armF / 2, 0], k: .01 * S,
          anim: { axis: "z", deg: 9, speed: .8, phase: ph, amp: true, work: workOf("fore", s) }, ...mat(sleeveM, sleeveM ? trimCloth : {}) });
    add({ id: "hand" + tag, parent: "fore" + tag, shape: "sphere", size: { r: rHand }, pos: [0, -armF - rHand * .45, 0], color: skin, k: .008 * S });
    if (o.top === "short")   // a short sleeve: a shell over the top half of the upper arm
      bone("sleeve" + tag, "arm" + tag, [0, 0, 0], [0, -1, 0], armU * .45, rArmU + 2 * TH, rArmU * .95 + 1.6 * TH, mat(M.shirt));
  }

  // ---- legs: thigh (IK driver), shin (follows), foot (kept flat)
  const legTh = o.bottom === "trousers" && !skirted ? TH : .004 * S;
  for (const [s, tag, i] of [[1, "L", 0], [-1, "R", 1]]) {
    add({ id: "leg" + tag, parent: "pelvis", shape: "capsule", size: { r: rThigh + legTh, r2: rKnee + legTh, len: legU }, pos: [0, hipY - pelY, s * hipZ],
          pivot: [0, -legU / 2, 0], k: .02 * S, ik: { leg: i, upper: legU, lower: legLo, side: 1, foot: ankY - pelY, phase: 0 },
          ...mat(legsM, { wear: 1 }) });
    add({ id: "shin" + tag, parent: "leg" + tag, shape: "capsule", size: { r: rKnee + legTh, r2: rAnk + legTh, len: legLo }, pos: [0, -legU, 0],
          pivot: [0, -legLo / 2, 0], k: .01 * S, ik: { leg: i, follow: true }, ...mat(legsM, { wear: 2 }) });
    const footM = o.boots ? mat(M.boots) : o.barefoot ? { color: beast ? beast.foot : skin } : mat(M.belt);   // boots, shoes or bare feet
    const fl = .24 * S * (isChild ? .9 : 1);
    if (beast?.hoof)   // a hoof, not a foot: a round horn cone from the ankle down to the ground, widening to the tread
      bone("foot" + tag, "shin" + tag, [0, -legLo, 0], [0, -1, 0], ankY * .95, rAnk * 1.15, rAnk * 1.6, { ...footM, level: true, k: .008 * S });
    else add({ id: "foot" + tag, parent: "shin" + tag, shape: "capsule", size: { r: rFoot, len: fl - 2 * rFoot }, geomRot: [0, 0, 90],
          pos: [.055 * S, -legLo + rFoot - ankY, 0], level: true, k: .008 * S, ...footM });
    if (o.boots)   // the shaft: a shell over the lower shin
      bone("boot" + tag, "shin" + tag, [0, -legLo * .42, 0], [0, -1, 0], legLo * .58, rKnee * .45 + rAnk * .55 + 2 * TH, rAnk + 1.5 * TH, mat(M.boots));
  }

  if (beast?.tail?.length) {   // the animal's own tail (its arc of links, a tuft), scaled with the head, from the rump
    const [first, ...rest] = beast.tail.map(beastPart);
    parts.push({ ...first, parent: "pelvis", pos: [-rPel * .95, .02 * S, 0] }, ...rest);
  }
  if (beast) for (const p of parts) if (p.color === skin && !p.dot) p.fur = true;   // the hide is a coat

  // ---- skirts: round cones from the waist, cut flat at waist and hem (solid,
  // so the waist shows a band, not the inside); they swing a little behind the stride
  // A skirt is two pieces, as a gathered skirt is cut: a YOKE from the
  // waist, flush with the bodice there (no ledge), widening over the hips,
  // and the skirt proper from the hip line to the hem, swinging behind the
  // stride. layer 1 = an over-skirt, a little larger (the surcoat over the kirtle).
  // Both take their pattern in the person's frame, so stripes run on across the join.
  const skirts = [];
  const skirt = (id, m, hemY, hemR, extra = {}, layer = 0) => {
    const yokeLen = waistY - pelY + .02 * S;
    const wTop = rBelly + TH * (1 + 1.2 * layer) + .002 * S, hipR = spanHip + rHip + TH * (1.6 + layer);
    const len = Math.max(waistY - yokeLen - hemY, .06 * S), cloth = extra.cloth ?? { pleats: o.pleats, wear: 2, ...trimCloth };
    const hemRs = Math.min(hemR * S * hipW, hipR + len * .85);   // a short skirt (a child's tunic) flares no more than its length allows
    bone(id + "Yoke", "pelvis", [0, waistY - pelY, 0], [0, -1, 0], yokeLen, wTop, hipR, {
      ...mat(m, { ...cloth, pleats: 0, trim: 0, wear: 1 }), clip: { lo: 0, hi: yokeLen, solid: true }, frame: "body" });
    return skirts[skirts.length] = bone(id, "pelvis", [0, waistY - yokeLen - pelY, 0], [0, -1, 0], len, hipR, hemRs, {
      ...mat(m, cloth), clip: { lo: 0, hi: len, solid: true }, frame: "body",
      anim: { axis: "z", deg: 4, speed: .8, phase: -.7, amp: true }, ...extra, cloth: { scale: m[3], ...cloth } });
  };
  let skirtPart = null;
  if (o.top === "tunic") skirtPart = skirt("tunic", M.shirt, .41 * h, .26);
  else if (o.top === "dress") skirtPart = skirt("skirt", M.skirt, .057 * h, .4);
  else if (o.top === "surcoat") {   // a kirtle (sleeves, the long under-skirt) and a sleeveless surcoat over it
    skirt("kirtle", M.shirt, (female ? .055 : .3) * h, .38, { cloth: { wear: 2 } });
    skirtPart = skirt("skirt", M.skirt, (female ? .13 : .36) * h, .42, {}, 1);
    // the surcoat: the torso's own flat pill, a layer thicker all round (no arm holes: a flat part cannot be cut yet)
    const sR = pRt + 2.2 * TH, sF = (.58 * pRt + 2.2 * TH) / sR;
    surcoatPart = add({ id: "surcoat", parent: "chest", shape: "capsule", size: { r: sR, r2: pRb + 2.2 * TH, len: pYt - pYb }, pivot: [0, (pYt + pYb) / 2 - chestO, 0], pos: [0, 0, 0], flat: sF,
          frame: "body", ...mat(M.skirt, { lace: o.lacing ? 1 : 0 }) });
  } else if (o.bottom === "skirt") skirtPart = skirt("skirt", M.skirt, .286 * h, .33);
  else if (o.bottom === "longskirt") skirtPart = skirt("skirt", M.skirt, .06 * h, .38);
  if (o.belt) {   // the belt: a band PAINTED round the torso pill (and a surcoat over it), just above a skirt's waistband -- no shape of its own (composite `band`)
    const bw = .045 * S, band = { at: pYt - (waistY + (skirtPart ? bw / 2 : 0)), width: bw, color: M.belt[0] };   // (at: down the pill's axis from its top centre)
    chestPart.band = band;
    if (surcoatPart) surcoatPart.band = band;
  }
  // ---- legs under skirts: what a skirt covers is not drawn at all (the lab
  // kept only the leg below the hem), so a knee swinging forward never pokes
  // through the cloth -- a thigh under a skirt to the knee is cut away
  // entirely, a shin under a long skirt down to its last few centimetres
  const hemY = o.top === "surcoat" ? (female ? .055 : .3) * h : o.top === "dress" ? .057 * h : o.top === "tunic" ? .41 * h
             : o.bottom === "skirt" ? .286 * h : o.bottom === "longskirt" ? .06 * h : null;
  if (hemY !== null) for (const [t] of [["L"], ["R"]]) {
    const th = parts.find((p) => p.id === "leg" + t), sh = parts.find((p) => p.id === "shin" + t);
    if (hemY < hipY - legU * .8) Object.assign(th, { clip: { lo: 1e3, hi: 1e3 }, k: 0 });
    if (hemY < ankY + legLo * .5) Object.assign(sh, { clip: { lo: legLo + ankY - hemY - .03 * S, hi: 1e4, solid: true }, k: 0 });
  }

  // ---- poses
  const byId = (id) => parts.find((p) => p.id === id);
  const sides = [["L", 1], ["R", -1]];
  if (pose === "carry")   // arms round a load held in front of the belly
    for (const [t, s] of sides) {
      Object.assign(byId("arm" + t), { rot: [-s * 12, 0, 32] }); delete byId("arm" + t).anim;
      Object.assign(byId("fore" + t), { rot: [s * 28, 0, 52] }); delete byId("fore" + t).anim;
    }
  if (pose === "guard") {   // the weapon arm lifted -- the figure's RIGHT, the rig's "L" (its L/R are mirrored: "L" sits at +z) --
    // the upper arm a little forward, the forearm raised about 60 degrees from hanging
    Object.assign(byId("armL"), { rot: [-8, 0, 15] }); delete byId("armL").anim;
    Object.assign(byId("foreL"), { rot: [4, 0, 45] }); delete byId("foreL").anim;
    Object.assign(byId("armR"), { rot: [8, 0, 8] }); delete byId("armR").anim;     // the shield arm: the forearm raised too, the hand at the shield's grip
    Object.assign(byId("foreR"), { rot: [-4, 0, 40] }); delete byId("foreR").anim;
  }
  if (pose === "draw") {   // drawing a bow (the player's own body, archery.js): the bow arm -- the figure's LEFT, the rig's "R" (its L/R are
    // mirrored) -- straight out ahead at shoulder height, the string hand (the right, "L") drawn back to the cheek; the legs still walk
    Object.assign(byId("armR"), { rot: [4, 0, 86] }); delete byId("armR").anim;
    Object.assign(byId("foreR"), { rot: [0, 0, 4] }); delete byId("foreR").anim;
    Object.assign(byId("armL"), { rot: [-55, 0, 80] }); delete byId("armL").anim;
    Object.assign(byId("foreL"), { rot: [20, 0, -125] }); delete byId("foreL").anim;
  }
  if (pose === "sit" || pose === "ride") {
    for (const [t, s] of sides) {
      // NOTE the x-rotation sign: NEGATIVE side swings a hanging capsule
      // toward its own +z side, so the left leg goes left, right goes right
      if (pose === "sit") {
        byId("leg" + t).rot = [-s * 5, 0, 86];                      // thighs FORWARD onto the bench
        byId("shin" + t).rot = [0, 0, -86];                         // shins straight down
        byId("arm" + t).rot = [-s * 4, 0, 14]; byId("fore" + t).rot = [0, 0, 52];   // hands on the thighs
      } else {                                                     // astride: thighs down the mount's flanks, shins back
        byId("leg" + t).rot = [-s * 34, 0, 28];
        byId("leg" + t).pos[2] = s * .12 * S;
        byId("shin" + t).rot = [s * 36, 0, -42];
        byId("arm" + t).rot = [s * 6, 0, 34]; byId("fore" + t).rot = [s * 10, 0, 48];   // hands forward, toward the mount's neck
      }
    }
    // seated: a short skirt lies along the thighs as a lap ending round at the
    // knees; a long one stays ONE piece, tilted forward from the waist so it
    // drapes over the knees and falls to the floor in front of the shins
    if (pose === "sit") for (const sk of skirts) {
      const len = sk.size.len, rT = sk.size.r, rH = sk.size.r2;
      if (len <= legU * 1.2) {
        const lap = Math.min(legU + rKnee, len), rK = Math.min(rT + (rH - rT) * lap / len, .2 * S * hipW);
        Object.assign(sk, { rot: [0, 0, 84], size: { r: rT, r2: rK, len: lap }, pivot: [0, -lap / 2, 0], clip: { lo: 0, hi: 1e4, solid: true } });
      } else {
        const tilt = 36, drop = pelY + sk.pos[1] - (hipY - legLo - ankY) - .04 * S, L2 = drop / Math.cos(tilt * Math.PI / 180);   // skirt top down to the seated soles
        const r2 = Math.max(rH, rT + L2 * .45);
        Object.assign(sk, { rot: [0, 0, tilt], size: { r: rT, r2, len: L2 }, pivot: [0, -L2 / 2, 0], clip: { lo: 0, hi: L2, solid: true } });
        sk.seatedLong = true;
      }
      for (const t of ["L", "R"]) { byId("leg" + t).clip = { lo: 1e3, hi: 1e3 }; byId("leg" + t).k = 0; }   // the skirt hides the thighs
    }
    // the thigh sets how deep a person sits: the hips go where an adult's
    // (40cm thigh) would, pushed forward by what a shorter thigh lacks, so a
    // child sits near the front edge with the knees over it
    if (pose === "sit") byId("pelvis").pos[0] += Math.max(-.03, .4 * S0 - legU);
  }
  // ---- the apron: PAINTED on the skirt (composite `panel`), not two membranes hung in front of it. A width
  // and a height is all it ever was -- a sector about the figure's forward, from just under the waist down to
  // .72 of the skirt -- and paint rides the skirt's swing exactly, so no knee can poke through it and it lies
  // on the folds instead of floating 2cm off them. Its half-angle is the one the old panel's half-width made
  // at the waist, so it keeps its width.
  if (o.apron && skirtPart && (pose !== "sit" || skirtPart.seatedLong))
    skirtPart.panel = { color: M.apron[0], half: Math.asin(Math.min(.95, .14 * S / skirtPart.size.r)), from: .02, to: .72 };

  if (pose === "lie") {   // flat on the back along +x, the back on y = 0; feet follow the shins (toes up)
    const root = byId("pelvis");
    root.pos = [pelY, rChest + TH + .01, 0];
    root.rot = [180, 0, -90];
    for (const p of parts) { delete p.anim; delete p.ik; delete p.level; }
  }
  if (still || pose === "sit" || pose === "ride" || pose === "lie") for (const p of parts) {
    delete p.ik;
    if (pose === "sit" && !still && p.anim?.work) p.anim = { ...p.anim, deg: 0 };   // seated hands still work (a potter, a guest eating): only the gait swing goes
    else delete p.anim;
  }

  if (upper) {
    const lower = /^(leg|shin|foot|boot)[LR]$|^tail|Yoke$|^(tunic|skirt|kirtle)$/;
    return { name: "person", kind, parts: parts.filter((p) => !lower.test(p.id)), pelvisY: pelY, outfit: o };
  }

  // ---- the biped walk and run: legs in antiphase; the hips drop at double support (bob phase)
  const L = legU + legLo;
  const moving = parts.some((p) => p.ik);
  const sk = hemY !== null && hemY < hipY;   // a skirt keeps the stride short (the lab: 60%)
  const gaits = moving ? {
    walk: { offsets: [0, Math.PI, 0, 0], stride: (sk ? .24 : .34) * L, lift: (sk ? .09 : .14) * L, bob: .03 * L, bobPh: Math.PI / 2 },
    run: { offsets: [0, Math.PI, 0, 0], stride: .58 * L, lift: .4 * L, bob: .05 * L, bobPh: Math.PI / 2 },
  } : null;
  // Where the figure's origin goes -- ONE rule for every caller (pews, the
  // cart box, the boat's thwart, a seated player's avatar and copies):
  // sitAt(seatTop) puts the hip joint SEAT_CLEAR above the seat, with hipY
  // reported so the LOWEST seated point (pelvis, hips or thighs, whichever
  // hangs furthest below the joint) rests just on the board; rideAt(backTop)
  // puts the hips on a mount's back (in the mount's frame).
  const drop = Math.max(rPel + (lowM ? TH : 0) - .06 * T, rHip + (lowM ? TH : 0) - .06 * T, rThigh + legTh) + .012;
  const hipOut = pose === "sit" ? hipY - (drop - SEAT_CLEAR) : hipY;
  return { name: "person", kind, parts, expr: pose === "lie" ? expression("asleep") : null, hipY: hipOut,   // expr: the face they rest in (faces.js)
           eyeAt: [.01 * S + .9 * hr, headY + .16 * hr],   // where the eyes are, standing: forward of the feet and up (a player's own body: index.html updateSelf)
           sitAt: (top) => top + SEAT_CLEAR - hipOut, rideAt: (back) => back - hipOut,
           gaits, legLen: L, probe: .25, outfit: o };
}
