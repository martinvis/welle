// Generative people for the figure engine -- the mammal rig's ideas applied
// to humans, dressed from the medieval wardrobe (assets/clothes: shirts and
// chemises, tunics, kirtles, surcoats, houppelandes, hose, cloaks, hoods,
// hats, belts, boots, aprons).
//
// BODY (the unisex canon, assets/people/body.json): ONE torso -- three
// flattened cuts swept as a single lathe through the shoulders' rim, the
// chest, the waist and the hips, its top a low squared cap that is the
// shoulders -- a neck and an ovoid head with nose, mouth and eyes; arms of two
// bones and a hand, hung BESIDE the torso (never through it); legs of two
// bones with a foot. Knees come from the same two-bone IK
// as the mammals' (skeleton.js) on a biped walk and run; feet stay flat
// (`level`); arms, the shoulders' twist, skirts and plaits swing on the
// gait clock and settle when the person stands (`anim.amp`).
//
// CLOTHING is the tailor's (clothes.js, docs/clothes.md): garments cut from
// flat sheets of cloth, each laid on a HOST of the body between two landmarks
// -- worn ON the body's own parts as layers of fabric (a bodice, a sleeve,
// hose), or standing off it as shells of their own (a skirt, a cloak, a hood,
// a hat) -- in fabrics of the pattern language, dyed by the wardrobe. This
// file builds the body and hands the tailor a FORM of it: its hosts, their
// parts, landmarks and girths.
//
// Root space: metres, x forward, y up from the ground (feet on y = 0),
// z to the person's left. Heights run 1.02-1.92m by kind.
import { rng } from "./flora.js";
import { hangRot, vNorm, vSub, vDot, scalePart } from "./geom.js";
import { expression } from "./faces.js";
import { fetchAsset } from "./creatures.js";
import { tailor, drawOutfit, namedOutfit, garmentDef, WARDROBE, outerSurface } from "./clothes.js";
import { neckFit, setCanonNeck } from "./jewelry.js";

// THE CANON (assets/people/body.json): what a person's proportions ARE, as fractions of the stature. Loaded
// before this module is done, so every importer of makePerson sees it (a module with a top-level await is
// awaited by whoever imports it). The asset viewer edits this file and the people change with it.
export const BODY = await fetchAsset("people/body");
// THE JOINTS (assets/people/joints.json, joints.js): where and how far a person bends -- here, the elbow's rest
export const JOINTS = await fetchAsset("people/joints");
// WHAT IS WORN ON TOP (assets/items/jewelry/wear.json): by style of dress and kind of person, a few looks and how often
// -- a necklace (or none), something on the head, earrings -- each a pick of jewelry items
export const JEWEL_WEAR = await fetchAsset("items/jewelry/wear");

const SKIN = [0xf0c8a0, 0xdfb289, 0xc79668, 0xa9764d, 0x7c5236];
const HAIR = [0x241b14, 0x4a2f18, 0x7a4a22, 0xa87433, 0xd9b96a, 0x99928a, 0xb0502c];
// the people's options (index.html fills them from config.json): nose -- a nose on human heads (one SDF part each;
// off by default: a face reads without it, and every person saves a part)
export const PEOPLE = { nose: true, face: true };   // face: the MESH head (face.js, heads.js) instead of the SDF marks and nose
const SCLERA = 0xece6da;
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
  play:   { arm: (s) => G("z", 30, 4, .6, alt(s)), fore: (s) => G("z", 80, 6, 1.1, alt(s)), chest: G("z", 6, 3, .3) },              // at a keyboard: forearms out over the keys, the hands running
};
const workOf = (piece, s) => Object.fromEntries(Object.entries(GESTURES).map(([k, g]) => [k, typeof g[piece] === "function" ? g[piece](s) : g[piece]]).filter(([, v]) => v));

// a town guard's kit (a makePerson outfit): the wardrobe's "soldier" -- gambeson, mail, tabard, steel cap, boots
export const SOLDIER = { named: "soldier", hair: "short", fringe: false };
export const KINDS = ["man", "woman", "child10", "child5"];
export const SEAT_CLEAR = .08;   // hip joint above a seat top: one thigh radius (see sitAt)
export const HAIRS = ["shaved", "short", "bob", "long", "ponytail", "bun", "braid"];
export const GARMENTS = Object.keys(WARDROBE.garments);   // every garment the tailor knows (assets/clothes)

const mixC = (a, b, t) => {
  const ch = (c, s) => (c >> s) & 255;
  return [16, 8, 0].reduce((o, s) => o | (Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t) << s), 0);
};

// A person's looks and what they wear, drawn from their own seeded stream (so outfits never shift the body's
// draws): sex (a child's), hair, fringe, nose -- and an outfit from the wardrobe (clothes.js drawOutfit).
// Everything can be overridden: makePerson({ outfit }).
function outfitFor(kind, r, style, seed = 1) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const child = kind.startsWith("child"), female = kind === "woman" || (child && r() < .5);
  const o = { female };
  o.hair = female ? pick(child ? ["long", "braid", "ponytail", "bob"] : ["long", "long", "bun", "bun", "braid", "braid", "ponytail", "bob"])
                  : pick(child ? ["short", "short", "bob"] : ["shaved", "short", "short", "short", "bob", "long", "ponytail"]);
  // (a style's own hair -- wardrobe.json styles.<style>.hair: { man, woman, child } lists of assets/items/hair: the
  //  Egyptian's, the Chinese topknot -- drawn from its own stream, so the rest of the looks stay as they were)
  const hs = style && WARDROBE.styles?.[style]?.hair, hl = hs && (child ? hs.child ?? (female ? hs.woman : hs.man) : female ? hs.woman : hs.man);
  if (hl?.length) { const hr = rng(seed * 523 + 29); o.hair = hl[Math.floor(hr() * hl.length)]; o.styled = true; }
  o.fringe = r() < .3;
  o.nose = [.75 + r() * .6, .7 + r() * .7];   // width, length
  const worn = drawOutfit(kind, r, { female, style });
  o.wear = worn.wear; o.style = worn.name;
  o.jewelry = drawJewelry(kind, female, style, seed);
  return o;
}
// THE PERIOD'S DRESS (index.html, assets/world/periods.json `dress`: a style by weight, "" the village's own): who is
// given no style of their own wears it, drawn from their seed -- the same person always dresses alike
let PERIOD_DRESS = null;
export const setPeriodDress = (weights) => { PERIOD_DRESS = weights && Object.keys(weights).length ? weights : null; };
function periodDress(seed) {
  if (!PERIOD_DRESS) return null;
  const ks = Object.keys(PERIOD_DRESS), r = rng(seed * 389 + 11);
  let x = r() * ks.reduce((t, k) => t + PERIOD_DRESS[k], 0);
  for (const k of ks) if ((x -= PERIOD_DRESS[k]) < 0) return k || null;
  return ks[ks.length - 1] || null;
}
// JEWELRY from the jewelry wardrobe, by the style and the kind (a girl's are a child's list); its own seeded stream,
// drawn after everything else, so an outfit never shifts for it -> { neck: [paths], head: path | null, ears: path | null }
function drawJewelry(kind, female, style, seed) {
  const r = rng(seed * 977 + 5), lists = JEWEL_WEAR.styles?.[style ?? "village"] ?? JEWEL_WEAR.styles?.village ?? {};
  const key = kind.startsWith("child") ? kind + (female ? "f" : "m") : kind, looks = lists[key] ?? lists[kind] ?? [];
  const total = looks.reduce((s, l) => s + (l.weight ?? 1), 0);
  let x = r() * total, look = null;
  for (const l of looks) { x -= l.weight ?? 1; if (x <= 0) { look = l; break; } }
  const pick = (a) => Array.isArray(a) ? a[Math.floor(r() * a.length)] ?? null : a ?? null;
  return { neck: [pick(look?.neck)].filter(Boolean), head: pick(look?.head), ears: pick(look?.ears) };
}
// what a garment covers, by its definition (assets/clothes): the head (a hood, a cap, a hat), the feet (shoes)
const wornOnHead = (w) => !!garmentDef(w.garment)?.head, wornOnFeet = (w) => !!garmentDef(w.garment)?.feet;

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
// style: another time and place's dress, drawn from the wardrobe's `styles` (greek, roman, chinese, gothic) by kind.
// outfit: overrides for the drawn looks and wardrobe -- hair, fringe; `wear`: the garments ([{ garment, fabrics:
// { slot: { pattern, palette | colors } }, params }], clothes.js); `named`: a kit of the wardrobe's (a guard's, a
// beast-man's); `bare`: nothing at all (the canon); `hat: "none"`: nothing on the head.
// beast: an animal-headed man (species.js beastman: the minotaur, the wolfman...) -- the same frame, heavier,
// in the animal's hide: its own head parts scaled to a human-sized head, its tail, hooves or paws; no clothes,
// hair or hat. { hide, foot, hoof, build, headScale, eye, head: { r, color, pat, parts (head-local) }, tail: [parts] }
// upper: the upper body alone -- the torso pill and all above it on the pelvis bone, no legs, skirts or
// gait (a centaur's: mammals.js hangs it on the horse's chest); pelvisY reports where the bone sits.
export function makePerson({ seed = 1, height, pose, still, kind, adult, outfit, beast = null, upper = false, body = null, style = null, skin: skinAs = null } = {}) {
  const B = body ?? BODY;   // `body`: another canon than the world's (the asset viewer, editing it live)
  const r = rng(seed * 771 + 13);
  const kr = r();
  if (!kind) kind = adult ? (kr < .5 ? "man" : "woman") : kr < .4 ? "man" : kr < .8 ? "woman" : kr < .9 ? "child10" : "child5";
  const isChild = kind.startsWith("child");
  const st = B.stature[kind] ?? B.stature.man;
  const h = height ?? st[0] + r() * st[1];
  const skinDrawn = SKIN[Math.floor(r() * SKIN.length)], skin = skinAs ?? (beast ? beast.hide : skinDrawn);   // (skinAs: a demon's red)   // (drawn either way: the seed's stream stays put)
  const hairC = HAIR[Math.floor(r() * HAIR.length)];
  const bs = B.build;
  const build = (isChild ? bs.child : 1) * (bs.spread[0] + r() * bs.spread[1]) * (beast?.build ?? 1);   // widths
  const headPh = r() * 3;
  style ??= outfit?.named || outfit?.bare || beast ? null : periodDress(seed);   // (one given no style of its own: the period's)
  const drawn = outfitFor(kind, rng(seed * 313 + 7), style, seed);
  const o = { ...drawn, ...(outfit ?? {}) };
  if (outfit?.named) o.wear = namedOutfit(outfit.named).wear;
  if (outfit?.bare || (beast && !outfit?.named && !outfit?.wear)) o.wear = [];
  if (o.hat === "none") o.wear = o.wear.filter((w) => !wornOnHead(w));
  // a beast, not a man: the hide all over -- then what it wears, but never human hair, a hat (horns and ears) or
  // footwear (hooves, paws)
  if (beast) { o.hair = "shaved"; o.wear = o.wear.filter((w) => !wornOnHead(w) && !wornOnFeet(w)); }
  // ASTRIDE: no long skirts -- a gown is ridden in as a tunic of the same cloth, and hose go on under it
  if (pose === "ride") {
    o.wear = o.wear.map((w) => (garmentDef(w.garment)?.skirted ? { ...w, garment: "tunic", params: {} } : w)).filter((w) => w.garment !== "apron");
    if (!o.wear.some((w) => w.garment === "hose" || w.garment === "breeches")) o.wear.unshift({ garment: "hose", fabrics: { main: { pattern: "fabrics/plain", palette: "russet" } } });
  }
  const female = !!o.female;

  // ---- proportions: assets/people/body.json, every measure a fraction of the stature (children: bigger
  // heads, shorter legs). The numbers are THERE, not here -- this is the body they describe.
  const Bt = B.torso, Bh = B.head, Ba = B.arm, Bl = B.leg;
  const S = h / 1.75, S0 = 1;   // S0: the adult reference scale (seat depth)
  const sx = female ? bs.sex.female : bs.sex.male;   // the few widths a person's sex moves
  const hr = h * (kind === "child5" ? Bh.r.child5 : kind === "child10" ? Bh.r.child10 : Bh.r.adult);
  const hipY = h * (kind === "child5" ? Bt.hip.child5 : kind === "child10" ? Bt.hip.child10 : Bt.hip.adult);
  const shY = h - Bt.shoulder.heads * hr - Bt.shoulder.fromCrown * h, T = shY - hipY;
  const pelY = hipY + Bt.pelvis * T, waistY = hipY + Bt.waist * T, headY = h - hr;
  // THE TORSO: one shape flattened front to back, through four rings -- the shoulders' rim (sW across), the chest
  // under the armpits (tW), the natural waist (wW), the hips (hW) -- its top a low squared cap up to the collar,
  // the shoulders, and its bottom a rounder one down to the crotch
  const HW = Bt.halfWidth, wid = h * build;
  const sW = HW.shoulder * wid * sx.shoulders, tW = HW.chest * wid * sx.shoulders, wW = HW.waist * wid * sx.waist, hW = HW.hip * wid * sx.hips;
  const rimY = shY - Bt.rim * h, pitY = shY - Bt.armpit * h, collarY = shY + Bt.collar * h, baseY = hipY + Bt.base * h, crotchY = hipY - Bt.crotch * h;
  const torsoFlat = Bt.depth * sx.bust;
  const RINGS = [[rimY, sW], [pitY, tW], [waistY, wW], [baseY, hW]];
  const torsoHalf = (y) => {   // its half-width at a height: over the shoulders' cap, and between the rings
    if (y >= collarY) return 0;
    if (y >= RINGS[0][0]) { const u = (y - rimY) / (collarY - rimY), p = Bt.capSquare; return sW * Math.pow(Math.max(0, 1 - Math.pow(u, p)), 1 / p); }
    for (let i = 1; i < RINGS.length; i++) if (y >= RINGS[i][0]) { const [y0, r0] = RINGS[i - 1], [y1, r1] = RINGS[i]; return r1 + (r0 - r1) * (y - y1) / (y0 - y1); }
    return hW;
  };
  const armU = Ba.upper * h, armF = Ba.fore * h, rArmU = Ba.rUpper * h * build, rElbow = Ba.rElbow * h * build, rArmF = Ba.rFore * h * build, rWrist = Ba.rWrist * h * build;
  // THE HAND, not a fist. A ball on the wrist left every arm a tenth of a body short: a real hand is .11 of
  // the stature long (the wrist sits at .49 h, the fingertips at .38), as wide as it is thick is thin. It is
  // a flattened pill down the forearm -- no fingers at this scale, a mitten, which is what the coat sleeves
  // and gloves of the period look like anyway.
  const rHand = Ba.rHand * h, handL = Ba.hand * h;
  const ankY = Bl.ankle * h, legU = (hipY - ankY) * Bl.upperShare, legLo = hipY - ankY - legU;
  const rThigh = Bl.rThigh * h * build * sx.thighs, rKnee = Bl.rKnee * h * build, rAnk = Bl.rAnkle * h, rFoot = Bl.rFoot * h;
  const hipZ = Bl.hipZ * h * build * sx.hips;
  // THE ARMS HANG BESIDE THE TORSO, not in it: the shoulder joint a little under the rim and clear of the side
  // by the arm's own girth, the arm leaning out by `abduction` -- so it never enters the chest or the hips, and a
  // sleeve and a bodice are two sheets that meet at the shoulder instead of one passing through the other
  const armY = rimY - Ba.drop * h, shZ = tW + rArmU + Ba.gap * h;   // (clear of the chest; the shoulders' flare covers the joint)
  // a beast's animal parts (head and tail): scaled so its head sphere is a man's, a little over (the muzzle adds length)
  const bf = beast ? hr * (beast.headScale ?? 1.1) / beast.head.r : 1;
  const beastPart = (p) => { const q = scalePart(p, bf); if (q.k) q.k *= bf; if (beast.eye && q.dot) q.dot = { ...q.dot, iris: beast.eye }; return q; };

  const mouthC = mixC(skin, 0xb8323a, .82);   // lips: clearly red

  const parts = [];
  const add = (p) => { const q = { edge: 0, seam: true, ...p }; parts.push(q); return q; };
  // a bone hanging from `pos` along direction dir: its A end (radius rA) at pos
  const bone = (id, parent, pos, dir, len, rA, rB, extra = {}) => {
    // (a round cone needs its radii to differ by less than its length -- except a garment's CUT shell, which is swept
    //  as a plain cone between its cuts and may be as flat as a cape over the shoulders)
    if (Math.abs(rA - rB) >= len && !extra.clip) console.warn(`person: ${id}: radii ${rA.toFixed(3)}/${rB.toFixed(3)} over ${len.toFixed(3)}m make no round cone (one sphere swallows the other)`);
    return add({ id, parent, shape: "capsule", size: { r: rA, r2: rB, len }, pos, rot: hangRot(dir), pivot: [0, -len / 2, 0], ...extra });
  };
  // a sphere of radius R at c with an axis n (a capsule of 1cm along it), cut by the slab
  // [lo, hi] along n measured from c; lo from a point P0 on the cutting plane
  const ball = (id, parent, c, R, n, P0, extra = {}) => {
    n = vNorm(n);
    const lo = P0 ? vDot(vSub(P0, c), n) : -1e4;
    return bone(id, parent, c, n, .01, R, R, { ...extra, clip: { lo, hi: 1e4, ...(extra.clip ?? {}) } });
  };

  // ---- the torso: ONE flattened round cone (composite `flat`) from the hips to the shoulders -- its depth a
  // share of its width, the shoulders its low squared top cap (`caps`), the crotch its bottom one -- on the pelvis
  // (the root, an x-capsule: the "body frame" of the coat and the figure's forward; an undrawn bone). It stands
  // for four lobes (pelvis, hips, belly, chest) and the yoke that once lay across its top: one shape.
  const kT = .05 * S;
  add({ id: "pelvis", parent: null, shape: "capsule", size: { r: hW, len: .04 * S }, geomRot: [0, 0, 90], pos: [0, pelY, 0], bob: true, bone: true,   // the root: posed (its x axis is the body's forward), not drawn -- the torso takes its girth
        frame: "body", k: kT, color: skin });
  // (its frame -- neck, head, arms and hair hang on it -- has its origin at the pelvis, chestO: a working bend or a
  // twist turns the torso about its bottom, the hips, so it never swings its belly off the legs)
  const chestO = pelY;
  // three cuts laid end to end, SWEPT AS ONE (shell.js: flat `spine` parts chain): the shoulders down to the
  // armpits, the chest down to the waist, the hips below. The first carries the figure's twist and the work
  // gestures; the other two hang on it, so the torso bends about the hips as one piece.
  const cut = (id, parent, [yA, rA], [yB, rB], extra = {}) => add({ id, parent, shape: "capsule", pos: [0, 0, 0], frame: "body", k: kT, spine: true,
        size: { r: rA, r2: rB, len: yA - yB }, pivot: [0, (yA + yB) / 2 - chestO, 0], flat: torsoFlat, color: skin, ...extra });
  cut("chest", "pelvis", RINGS[0], RINGS[1], { caps: { a: (collarY - rimY) / sW, b: 1, p: Bt.capSquare },
        anim: { axis: "y", deg: 4, speed: .8, phase: Math.PI, amp: true, work: workOf("chest", 1) } });
  cut("belly", "chest", RINGS[1], RINGS[2]);
  cut("hips", "chest", RINGS[2], RINGS[3], { caps: { a: 1, b: (baseY - crotchY) / hW, p: 2 } });
  // THE NECK STARTS UNDER THE JAW, not inside the skull. The shell engine sweeps a part and its neighbour as
  // ONE LATHE where they meet, share a colour and run the same way -- head and neck do all three -- and the
  // neck's top used to sit ABOVE the chin, so that lathe doubled back on itself and came out as one long
  // smooth funnel from the cranium to the shoulders. That, not the length of anything, is what made every
  // person look long-necked: there was no jaw in the drawn surface at all. Started just inside the jaw's own
  // ball, the sweep runs straight down and the radius steps from jaw to neck in three centimetres -- a
  // jawline.
  const hL = beast ? 0 : Bh.jawLength * hr, hJaw = Bh.jawRadius * hr;
  const neckBot = collarY - .02 * h, neckTop = headY - hL - hJaw * .4;   // (its foot inside the shoulders' cap)
  const neckR = hr * (isChild ? Bh.neckRadius.child : beast ? Bh.neckRadius.beast : Bh.neckRadius.adult);
  add({ id: "neck", parent: "chest", shape: "capsule", size: { r: neckR, len: neckTop - neckBot }, pos: [0, (neckTop + neckBot) / 2 - chestO, 0], color: skin, k: .03 * S });
  // The head is an OVOID, not a ball: a round cone standing on its own axis -- the CRANIUM is the sphere it
  // always was (its top cap centre sits at the part's own origin, so the hair, the hats and the eyes keep
  // exactly the places they had), and below it the head runs on for hL and narrows to hJaw: a jaw and a chin.
  // That, not a symmetric stretch, is what makes a head read as a head -- the stretch hides under the hair,
  // the jaw is the part a face shows. (Round about its axis: it cannot also be narrower across than deep.)
  // (hL, hJaw: the jaw, declared above the neck that hangs under it)
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
  const meshFace = PEOPLE.face && !beast;
  if (beast) {   // the beast's head: the animal's own -- its head sphere's children (muzzle, ears, eye marks, nose, horns, tusks) -- man-sized
    Object.assign(headPart, { shape: "sphere", size: { r: beast.head.r * bf }, color: beast.head.color, pat: beast.head.pat, fur: true });
    for (const p of beast.head.parts) parts.push(beastPart(p));
  } else if (meshFace) {
    // THE MESH HEAD (face.js: a low-poly head on the anatomy, drawn by heads.js at this head part every frame): the
    // SDF head shrinks to a pin (it stays the parent of the hair and the hat, and the frame the mesh is placed in),
    // and a pin of a nose stays as the GAZE -- the direction the face looks, read back with the head's ends
    // -- both as BONES of the rig (k = -1): posed, never drawn, no shell (the geometry view showed them as a spike)
    headPart.size = { r: .004, r2: .004, len: hL }; headPart.bone = true;
    bone("nose", "head", H(.1, 0), [1, 0, 0], .4 * hr, .002, .002, { color: skin, bone: true });   // (inside the skull: only its direction is read)
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
  // UNDER A HAT THE HAIR LIES FLAT. The cap is a little wider than the skull, and a hat's crown is drawn to
  // fit the skull -- so as SOLIDS the hair came out through the hat all round its brim and over its top. (The
  // SDF never showed it: among the parts covering a pixel it drew the NEAREST surface, which was the hat.)
  const hatOn = o.wear.some(wornOnHead);
  // the MESH HEAD wears its hair as strands (hair.js, assets/items/hair): the SDF hair below is the capsule head's
  const MESH_HAIR = { shaved: "none", short: "short", bob: "bob", long: "long", ponytail: "ponytail", bun: "bun", braid: "braid" };
  // (a woman's long hair: straight, wavy or drawn in locks by her seed, her bob either way, a man's short hair now and
  //  then in locks; any other word an item hairstyle by its own name -- assets/items/hair)
  const meshHair = !meshFace ? null : hatOn ? (o.hair === "shaved" ? "none" : "flat")
    : o.styled ? MESH_HAIR[o.hair] ?? o.hair   // (a style's own hair: as it says -- no manga variant in another time)
    : o.hair === "long" && female ? ["long", "long-wavy", "manga-long"][seed % 3]
    : o.hair === "bob" && female && seed % 2 ? "manga-bob"
    : o.hair === "short" && !female && seed % 4 === 3 ? "manga-short"
    : MESH_HAIR[o.hair] ?? o.hair ?? "short";
  if (!meshFace && o.hair !== "shaved") {
    const F = o.fringe ? H(.87, .5) : H(.7, .72),   // the hairline in front: a forelock ends just above the brows, else higher -- a forehead
          N = o.hair === "short" ? H(-.92, -.5) : H(-.95, -.15);
    const cap = hatOn ? 1.015 : (o.hair === "short" ? 1.07 : 1.1);
    ball("hairC", "head", H(-.02, .02), hr * cap, capPlane(F, N), F, { ...hairM, clip: { solid: true } });
  }
  if (!meshFace && (o.hair === "bob" || o.hair === "long"))   // down to the jaw at the back and sides, the face open
    ball("hairB", "head", H(-.12, -.1), hr * (hatOn ? 1.04 : o.hair === "bob" ? 1.22 : 1.18), [-1, -.1, 0], H(.44, 0), { ...hairM, clip: { solid: true } });
  if (!meshFace && o.hair === "long") {   // a fall of hair: ONE curved surface like a skirt -- a round-cone shell
    // from the back of the head down to the shoulder blades, tilted back a little and cut open at
    // the front (clip.back: nothing more than 4cm in front of its top, which sits at the head's
    // centre), so it wraps the back of the head and shoulders and leaves the face and chest free
    // (wide enough at the bottom that the shoulder blades stay under it, not poking past its edges)
    const top = [.01 * S - .05 * hr, headY - chestO + .05 * hr, 0], yB = shY - .1 * h - chestO, len = top[1] - yB;
    bone("hairL", "chest", top, [-.05, -1, 0], len, 1.06 * hr, sW * .95,
         { ...hairM, clip: { lo: 0, hi: len, back: -.26 * hr }, anim: { axis: "z", deg: 3, speed: .8, phase: -.9, amp: true } });
  }
  if (!meshFace && o.hair === "ponytail")
    bone("hairT", "head", H(-.92, .15), [-.35, -1, 0], 2.2 * hr, .32 * hr, .18 * hr, { ...hairM, anim: { axis: "z", deg: 7, speed: .8, phase: -.9, amp: true } });
  if (!meshFace && o.hair === "bun") add({ id: "hairN", parent: "head", shape: "sphere", size: { r: .45 * hr }, pos: H(-.85, .5), ...hairM });
  if (!meshFace && o.hair === "braid")
    bone("hairP", "head", H(-.95, -.25), [-.12, -1, 0], 3.3 * hr, .26 * hr, .15 * hr,
         { color: hairC, color2: mixC(hairC, 0x000000, .4), pat: "braid", cloth: { scale: Math.round(1 / (.5 * hr)) }, anim: { axis: "z", deg: 6, speed: .8, phase: -.9, amp: true } });

  // ---- arms: upper (swings on the gait), forearm (bends more as it swings forward), hand -- hung beside the
  // torso (armY, shZ: the proportions above)
  for (const [s, tag] of [[1, "L"], [-1, "R"]]) {
    const ph = s > 0 ? Math.PI : 0;   // the left arm swings forward with the right leg
    add({ id: "arm" + tag, parent: "chest", shape: "capsule", size: { r: rArmU, r2: rElbow, len: armU },
          pos: [0, armY - chestO, s * shZ], rot: [-s * Ba.abduction, 0, 0], pivot: [0, -armU / 2, 0], k: .025 * S, color: skin,
          anim: { axis: "z", deg: 20, speed: .8, phase: ph, amp: true, work: workOf("arm", s) } });
    add({ id: "fore" + tag, parent: "arm" + tag, shape: "capsule", size: { r: rArmF, r2: rWrist, len: armF },
          pos: [0, -armU, 0], rot: [0, 0, JOINTS.joints.elbow.rest.flexion], pivot: [0, -armF / 2, 0], k: .01 * S, color: skin,
          anim: { axis: "z", deg: 9, speed: .8, phase: ph, amp: true, work: workOf("fore", s) } });
    add({ id: "hand" + tag, parent: "fore" + tag, shape: "capsule", size: { r: rHand * .95, r2: rHand, len: handL }, flat: .5,
          pos: [0, -armF, 0], pivot: [0, -handL / 2, 0], color: skin, k: .008 * S });
  }

  // ---- legs: thigh (IK driver), shin (follows), foot (kept flat)
  for (const [s, tag, i] of [[1, "L", 0], [-1, "R", 1]]) {
    add({ id: "leg" + tag, parent: "pelvis", shape: "capsule", size: { r: rThigh, r2: rKnee, len: legU }, pos: [0, hipY - pelY, s * hipZ],
          pivot: [0, -legU / 2, 0], k: .02 * S, ik: { leg: i, upper: legU, lower: legLo, side: 1, foot: ankY - pelY, phase: 0 }, color: skin });
    add({ id: "shin" + tag, parent: "leg" + tag, shape: "capsule", size: { r: rKnee, r2: rAnk, len: legLo }, pos: [0, -legU, 0],
          pivot: [0, -legLo / 2, 0], k: .01 * S, ik: { leg: i, follow: true }, color: skin });
    const fl = Bl.foot * h;
    if (beast?.hoof)   // a hoof, not a foot: a round horn cone from the ankle down to the ground, widening to the tread
      bone("foot" + tag, "shin" + tag, [0, -legLo, 0], [0, -1, 0], ankY * .95, rAnk * 1.15, rAnk * 1.6, { color: beast.foot, level: true, k: .008 * S });
    // (its frame's origin at the ANKLE, the joint it turns in; the foot itself drawn forward of and below it, on the ground)
    else add({ id: "foot" + tag, parent: "shin" + tag, shape: "capsule", size: { r: rFoot, len: fl - 2 * rFoot }, geomRot: [0, 0, 90],
          pos: [0, -legLo, 0], pivot: [.055 * S, rFoot - ankY, 0], level: true, k: .008 * S, color: beast ? beast.foot : skin });
  }

  if (beast?.tail?.length) {   // the animal's own tail (its arc of links, a tuft), scaled with the head, from the rump
    const [first, ...rest] = beast.tail.map(beastPart);
    parts.push({ ...first, parent: "pelvis", pos: [-hW * torsoFlat * .95, .02 * S, 0] }, ...rest);
  }
  if (beast) for (const p of parts) if (p.color === skin && !p.dot) p.fur = true;   // the hide is a coat

  // ---- CLOTHES: the tailor (clothes.js) lays the outfit on the body. It is told the body's FORM -- its hosts (the
  // torso, the arms, the legs, the feet, the neck, the head), the parts each is made of, their landmarks and girths --
  // and it dresses the parts that follow the body (layers of sheet: `dress`) and adds the pieces that stand off it
  // (a skirt, a cloak, a hood, a hat: shells of their own)
  const byId = (id) => parts.find((p) => p.id === id);
  const kneeY = ankY + legLo, handY = armY - armU - armF - handL;
  const abd = Math.sin(Ba.abduction * Math.PI / 180);
  const armR = (d) => d < armU ? rArmU + (rElbow - rArmU) * d / armU : d < armU + armF ? rArmF + (rWrist - rArmF) * (d - armU) / armF : rHand;
  const ellipse = (a, b) => { const q = ((a - b) / (a + b)) ** 2; return Math.PI * (a + b) * (1 + 3 * q / (10 + Math.sqrt(4 - 3 * q))); };
  const form = {
    h, S, pose,
    torso: {
      parts: [{ id: "chest", top: rimY, bottom: pitY }, { id: "belly", top: pitY, bottom: waistY }, { id: "hips", top: waistY, bottom: baseY }],
      collar: collarY, bottom: crotchY, half: torsoHalf, flat: torsoFlat, circumference: ellipse(tW, tW * torsoFlat),
      // (with the arms: the torso's half-width, or the arms' outer edge where they hang beside it -- what a cloak clears)
      halfArms: (y) => Math.max(torsoHalf(y), (y > armY + rArmU ? 0 : y > armY ? shZ + Math.sqrt(Math.max(0, rArmU * rArmU - (y - armY) ** 2)) : shZ + (armY - y) * abd + armR(armY - y)) + .008 * S),
      hands: handY,
      marks: { collar: collarY, armtop: armY + rArmU, shoulder: rimY, armpit: pitY, chest: pitY - .03 * h, waist: waistY, hip: baseY, crotch: crotchY,
               thigh: (crotchY + kneeY) / 2, knee: kneeY, calf: kneeY - .3 * legLo, ankle: ankY, floor: 0 },
      hangFrom: "pelvis", upperFrom: "chest", hangY: pelY,   // (the chest's frame IS the pelvis's at rest: its origin there too)
    },
    arms: [["L"], ["R"]].map(([t]) => ({ side: t, parts: [{ id: "arm" + t, len: armU }, { id: "fore" + t, len: armF }, { id: "hand" + t, len: handL }],
      marks: { shoulder: 0, biceps: armU * .5, elbow: armU, forearm: armU + armF * .5, wrist: armU + armF, knuckles: armU + armF + handL },
      r: rArmU, radius: armR })),
    legs: [["L"], ["R"]].map(([t]) => ({ side: t, parts: [{ id: "leg" + t, len: legU }, { id: "shin" + t, len: legLo }],
      marks: { hip: 0, thigh: legU * .5, knee: legU, calf: legU + legLo * .3, ankle: legU + legLo, sole: hipY },
      r: rThigh })),
    feet: beast?.hoof ? [] : ["footL", "footR"], neck: { id: "neck", r: neckR, top: neckTop, k: Math.max(.03 * S, kT) }, head: { id: "head", hr },
  };
  const worn = tailor(form, o, { add, bone });
  // THE NECK'S FIT for what is worn on top (jewelry.js): the outermost surface the body and its clothes make, made when
  // first asked (a person with no necklace never pays for it)
  let fit0 = null;
  const fitNeck = () => fit0 ??= neckFit(form, outerSurface(form, worn));
  for (const [id, layers] of worn.dress) { const p = byId(id); if (p) p.dress = { standing: false, layers }; }
  const skirts = worn.skirts;
  // ---- legs under skirts: what a skirt covers is not drawn at all (the lab
  // kept only the leg below the hem), so a knee swinging forward never pokes
  // through the cloth -- a thigh under a skirt to the knee is cut away
  // entirely, a shin under a long skirt down to its last few centimetres
  const hemY = worn.legsUnder;
  if (hemY !== null) for (const [t] of [["L"], ["R"]]) {
    const th = byId("leg" + t), sh = byId("shin" + t);
    if (hemY < hipY - legU * .8) Object.assign(th, { clip: { lo: 1e3, hi: 1e3 }, k: 0 });
    if (hemY < ankY + legLo * .5) Object.assign(sh, { clip: { lo: legLo + ankY - hemY - .03 * S, hi: 1e4, solid: true }, k: 0 });
  }

  // ---- poses
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
      let L2 = len;
      if (len <= legU * 1.2) {
        const lap = Math.min(legU + rKnee, len), rK = Math.min(rT + (rH - rT) * lap / len, .2 * S * sx.hips);
        Object.assign(sk, { rot: [0, 0, 84], size: { r: rT, r2: rK, len: lap }, pivot: [0, -lap / 2, 0], clip: { lo: 0, hi: 1e4, lid: true } });
        L2 = lap;
      } else {
        const tilt = 36, drop = pelY + sk.pos[1] - (hipY - legLo - ankY) - .04 * S;   // skirt top down to the seated soles
        L2 = drop / Math.cos(tilt * Math.PI / 180);
        const r2 = Math.max(rH, rT + L2 * .45);
        Object.assign(sk, { rot: [0, 0, tilt], size: { r: rT, r2, len: L2 }, pivot: [0, -L2 / 2, 0], clip: { lo: 0, hi: L2, lid: true } });
      }
      for (const Lr of sk.dress.layers) if (Lr.width) Lr.s0 = L2 - Lr.width;   // (its hem band moves with its hem)
      for (const t of ["L", "R"]) { byId("leg" + t).clip = { lo: 1e3, hi: 1e3 }; byId("leg" + t).k = 0; }   // the skirt hides the thighs
    }
    // the thigh sets how deep a person sits: the hips go where an adult's
    // (40cm thigh) would, pushed forward by what a shorter thigh lacks, so a
    // child sits near the front edge with the knees over it
    if (pose === "sit") byId("pelvis").pos[0] += Math.max(-.03, .4 * S0 - legU);
  }
  if (pose === "lie") {   // flat on the back along +x, the back on y = 0; feet follow the shins (toes up)
    const root = byId("pelvis");
    root.pos = [pelY, torsoFlat * hW + .02 * S, 0];   // (the back on the ground: half the torso's depth under its axis, and its cloth)
    root.rot = [180, 0, -90];
    for (const p of parts) { delete p.anim; delete p.ik; delete p.level; }
  }
  if (still || pose === "sit" || pose === "ride" || pose === "lie") for (const p of parts) {
    delete p.ik;
    if (pose === "sit" && !still && p.anim?.work) p.anim = { ...p.anim, deg: 0 };   // seated hands still work (a potter, a guest eating): only the gait swing goes
    else delete p.anim;
  }

  // THE MESH HEAD on a list of this person's parts (heads.js finds it by index): the whole person's, or the upper body's
  const hex = (c) => "#" + c.toString(16).padStart(6, "0");
  const faceOf = (list) => meshFace ? { kind: female ? "woman" : isChild ? "child" : "man", seed, skin: hex(skin), hair: hex(hairC), hr, style: meshHair, fringe: o.fringe ? 1 : 0,
                                        headwear: hatOn ? null : o.jewelry?.head ?? null, ears: o.jewelry?.ears ?? null,
                                        head: list.findIndex((p) => p.id === "head"), gaze: list.findIndex((p) => p.id === "nose") } : null;
  // what hangs round the neck (jewels.js): the items, the fit they lie on, the parts that carry it (the chest, and the
  // root whose axis is the figure's forward -- the frame the torso is drawn in)
  const neckHidden = o.wear.some((w) => (JEWEL_WEAR.hidesNeck ?? []).includes(w.garment));   // (a hood's cape over it)
  const jewelOf = (list) => o.jewelry?.neck?.length && !beast && !neckHidden ? { pieces: o.jewelry.neck.map((path, k) => ({ path, seed: seed + k })), fit: fitNeck(),
                                         chest: list.findIndex((p) => p.id === "chest"), root: list.findIndex((p) => p.id === "pelvis") } : null;
  if (upper) {   // (a centaur's man: his upper body -- and his head, the mesh face, or he had none)
    const lower = /^(leg|shin|foot)[LR]$|^tail/, hung = new Set(skirts.map((p) => p.id));
    const kept = parts.filter((p) => !lower.test(p.id) && !hung.has(p.id));
    return { name: "person", kind, parts: kept, pelvisY: pelY, outfit: o, face: faceOf(kept), jewelry: jewelOf(kept), fitNeck };
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
  const drop = Math.max(hipY - crotchY, rThigh) + .012 + .004 * S;
  const hipOut = pose === "sit" ? hipY - (drop - SEAT_CLEAR) : hipY;
  const face = faceOf(parts);
  return { name: "person", kind, parts, expr: pose === "lie" ? expression("asleep") : null, hipY: hipOut,   // expr: the face they rest in (faces.js)
           forwardFrom: "chest",   // (the trunk's frame turns the figure's forward: skeleton.js -- a twist at the waist turns the flat torso)
           face,   // the mesh head to stand on the head part (heads.js), or none
           jewelry: jewelOf(parts), fitNeck,   // what hangs round the neck (jewels.js), and the fit it lies on
           eyeAt: [.01 * S + .9 * hr, headY + .16 * hr],   // where the eyes are, standing: forward of the feet and up (a player's own body: index.html updateSelf)
           sitAt: (top) => top + SEAT_CLEAR - hipOut, rideAt: (back) => back - hipOut,
           gaits, legLen: L, probe: .25, outfit: o,
           // what the JOINTS need (joints.js): the head turns about the top of the neck, not the skull's centre (in the
           // head's frame); the skirts, which hang from the hips and drape over the thighs as they rise
           motion: { pivots: { neck: [-.01 * S, neckTop - headY, 0] }, skirts: skirts.map((p) => p.id), handLen: handL } };
}

// the CANON NECK (a woman's, bare): what a necklace lies on when it is seen without a body (jewelry.js)
setCanonNeck(() => makePerson({ kind: "woman", seed: 3, still: true, outfit: { bare: true, jewelry: { neck: [], head: null, ears: null } } }).fitNeck());
