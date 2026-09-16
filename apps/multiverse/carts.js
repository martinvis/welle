// Carts and wagons: the highway's haulage, at real dimensions.
//
// A cart is two things. Its BODY -- bed, sides, axles, bolsters, driver's
// board and the barrels and sacks it carries -- is boxes and cylinders, so
// it goes through architecture.js (merged per material, orientation-shaded,
// outlined) and moves as one rigid group. Its WHEELS are shared
// InstancedMesh copies: three real wheel sizes serve the whole fleet, each
// size one draw call per material, rolled by matrix per frame. Its TEAM --
// the draft animals with yoke, bows, pole/traces or shafts -- and its
// DRIVER are banner skeletons in an instanced herd like every other
// creature, so oxen trot, tails swish and heads turn for free. Every
// dimension is meters from period sources: a two-wheel cart on 1.5m wheels,
// a farm wagon, a heavy freight wagon behind up to three pairs.
import { SPECIES, gaitBase, bodyProbe } from "./species.js";
import { makePerson } from "./people.js";
import { rng } from "./flora.js";
import { BARRELS, barrel, sack } from "./architecture.js";
export { BARRELS, barrel, sack };

const WOODS = [0x7a5a36, 0x6f5433, 0x846040, 0x6a4a2c];
const DARK = 0x4e3a24, IRON = 0x3e3a38;

// the three carts. All body-local, origin on the ground under the bed's
// center, +x forward. floor = bed height, wheels = axle x and radius
// (4-wheelers steer on smaller front wheels), seatX = the driver's board.
export const CART_SIZES = {
  // two-wheeled cart, one animal between shafts: 1.5m wheels, the bed
  // balanced just ahead of the axle
  small:  { bedL: 1.6, bedW: 1.05, floor: .8, side: .35, seatX: .5,
            wheels: [{ x: -.1, r: .75 }], teams: [1] },
  // farm wagon: 2.8m bed, one pair (or a single animal in shafts)
  medium: { bedL: 2.8, bedW: 1.4, floor: .85, side: .45, seatX: 1.05,
            wheels: [{ x: 1.05, r: .45 }, { x: -1.05, r: .6 }], teams: [1, 2] },
  // heavy freight wagon: 4.2m bed, high sides, two or three pairs
  large:  { bedL: 4.2, bedW: 1.7, floor: .95, side: .6, seatX: 1.75,
            wheels: [{ x: 1.55, r: .6 }, { x: -1.55, r: .75 }], teams: [2, 4, 6] },
};

// loads per size, five variants each: rows of big barrels lying across
// the bed (chocked pyramids -- the way casks were actually stacked),
// standing casks, kegs filling the gaps, and grain sacks laid across the
// bed in two courses, sometimes mixed with casks
export const LOAD_VARIANTS = 5;
function load(size, variant, floor) {
  const B = BARRELS.big, K = BARRELS.keg, out = [];
  if (variant < 0) return out;   // an empty bed: the freight carts carry live goods instead
  const bigLying = (xs, y = floor + B.belly) => xs.forEach((x) => out.push(...barrel("big", [x, y, 0], "z")));
  const pyramidTop = floor + B.belly + B.belly * Math.sqrt(3);   // nested on two below
  const kegsUp = (pts) => pts.forEach(([x, z]) => out.push(...barrel("keg", [x, floor + K.h / 2, z], "up")));
  const bigUp = (pts) => pts.forEach(([x, z]) => out.push(...barrel("big", [x, floor + B.h / 2, z], "up")));
  // sacks lie across the bed .52m apart; a second course sits in the hollows
  const sacks = (xs, course = 0) => xs.forEach((x) => out.push(...sack([x, floor + .24 + course * .4, 0], "z")));
  if (size === "small") {
    if (variant === 0) { bigLying([-.15]); kegsUp([[.5, 0]]); }
    else if (variant === 1) kegsUp([[-.45, .25], [-.45, -.25], [.05, .25], [.05, -.25], [.5, 0]]);
    else if (variant === 2) bigUp([[-.35, 0], [.4, 0]]);
    else if (variant === 3) { sacks([-.55, -.03, .49]); sacks([-.29, .23], 1); }
    else { bigLying([-.3]); sacks([.35]); }
  } else if (size === "medium") {
    if (variant === 0) { bigLying([-.95, -.2, .55]); bigLying([-.575, .175], pyramidTop); }
    else if (variant === 1) { bigUp([[-.85, 0], [-.1, 0]]); kegsUp([[.55, .4], [.55, 0], [.55, -.4]]); }
    else if (variant === 2) kegsUp([[-1, .45], [-1, 0], [-1, -.45], [-.55, .45], [-.55, 0], [-.55, -.45], [-.1, .45], [-.1, 0], [-.1, -.45], [.35, .2], [.35, -.2]]);
    else if (variant === 3) { sacks([-1.15, -.63, -.11, .41, .93]); sacks([-.89, -.37, .15, .67], 1); }
    else { bigLying([-.95, -.2]); sacks([.45, .97]); }
  } else {
    if (variant === 0) { bigLying([-1.6, -.85, -.1, .65]); bigLying([-1.225, -.475, .275], pyramidTop); kegsUp([[1.3, .45], [1.3, -.45]]); }
    else if (variant === 1) bigUp([[-1.5, .38], [-1.5, -.38], [-.75, .38], [-.75, -.38], [0, .38], [0, -.38], [.75, .38], [.75, -.38]]);
    else if (variant === 2) { bigLying([-1.6, -.85, -.1]); kegsUp([[.55, .55], [.55, 0], [.55, -.55], [1.0, .55], [1.0, 0], [1.0, -.55]]); }
    else if (variant === 3) { const xs = [-1.82, -1.3, -.78, -.26, .26, .78, 1.3, 1.82]; sacks(xs); sacks(xs.slice(0, -1).map((x) => x + .26), 1); }
    else { bigLying([-1.6, -.85, -.1]); bigLying([-1.225, -.475], pyramidTop); sacks([.6, 1.12, 1.64]); sacks([.86, 1.38], 1); }
  }
  return out;
}

// the cart body as an architecture-style parts def
export function cartBody(size, { seed = 1, variant = 0 } = {}) {
  const S = CART_SIZES[size], r = rng(seed * 313 + 7);
  const wood = WOODS[Math.floor(r() * WOODS.length)];
  const { bedL, bedW, floor, side } = S;
  const parts = [
    { shape: "box", size: [bedL, .06, bedW], pos: [0, floor - .03, 0], color: wood },                   // bed planks
    { shape: "box", size: [bedL, side, .05], pos: [0, floor + side / 2, bedW / 2 + .025], color: wood },  // sides
    { shape: "box", size: [bedL, side, .05], pos: [0, floor + side / 2, -bedW / 2 - .025], color: wood },
    { shape: "box", size: [.05, side, bedW + .1], pos: [bedL / 2 + .025, floor + side / 2, 0], color: wood },   // headboard
    { shape: "box", size: [.05, side, bedW + .1], pos: [-bedL / 2 - .025, floor + side / 2, 0], color: wood },  // tailboard
    { shape: "box", size: [.42, .05, bedW - .1], pos: [S.seatX, floor + .44, 0], color: DARK },          // driver's board
    { shape: "box", size: [.05, .42, .06], pos: [S.seatX, floor + .21, bedW / 2 - .1], color: DARK },
    { shape: "box", size: [.05, .42, .06], pos: [S.seatX, floor + .21, -bedW / 2 + .1], color: DARK },
    { shape: "box", size: [.36, .04, bedW - .2], pos: [bedL / 2 + .2, floor + .08, 0], color: DARK },     // footboard
  ];
  for (const w of S.wheels) {   // axle across, bolster block up to the bed
    parts.push({ shape: "cyl", size: { r1: .05, r2: .05, h: bedW + .5, seg: 8 }, pos: [w.x, w.r, 0], rot: [90, 0, 0], color: DARK });
    parts.push({ shape: "box", size: [.16, Math.max(.04, floor - .06 - w.r), bedW * .8], pos: [w.x, (floor - .06 + w.r) / 2, 0], color: DARK });
  }
  if (S.wheels.length > 1)   // the reach beam tying both axles
    parts.push({ shape: "box", size: [bedL - .4, .08, .12], pos: [0, floor - .11, 0], color: DARK });
  parts.push(...load(size, variant, floor));
  return { name: `cart-${size}`, parts, seatTop: floor + .465, seatX: S.seatX };
}

// a spoked wheel, axis along z, centered on its axle: hub, radial spokes
// and the felloe ring segments (iron-shod, dark)
export function wheelDef(r) {
  const n = r < .5 ? 8 : r < .7 ? 10 : 12, rf = r - .04, parts = [];
  parts.push({ shape: "cyl", size: { r1: .1, r2: .1, h: .24, seg: 10 }, pos: [0, 0, 0], rot: [90, 0, 0], color: DARK });
  for (let i = 0; i < n; i++) {
    const a = i * 360 / n, ar = a * Math.PI / 180, rc = (.08 + rf - .035) / 2;
    parts.push({ shape: "box", size: [rf - .035 - .08, .04, .04], pos: [Math.cos(ar) * rc, Math.sin(ar) * rc, 0],
                 rot: [0, 0, a], color: WOODS[2], outline: false });
    const b = (i + .5) * 360 / n, br = b * Math.PI / 180;
    parts.push({ shape: "box", size: [2 * rf * Math.tan(Math.PI / n) + .015, .08, .06], pos: [Math.cos(br) * rf, Math.sin(br) * rf, 0],
                 rot: [0, 0, b + 90], color: DARK });
  }
  return { name: `wheel-${r}`, parts };
}

const prefixed = (parts, pre, dz, phase) => parts.map((p) => ({
  ...p, id: pre + p.id, parent: p.parent ? pre + p.parent : null,
  pos: p.parent ? p.pos : [p.pos[0], p.pos[1], p.pos[2] + dz],
  anim: p.anim && phase ? { ...p.anim, phase: (p.anim.phase || 0) + phase } : p.anim,
  ik: p.ik && phase && !p.ik.follow ? { ...p.ik, phase: (p.ik.phase || 0) + phase } : p.ik,   // rig legs are phased apart the same way
}));

// The team as ONE banner skeleton: a single animal between two shafts, or
// a pair under a yoke. `back` = distance from the team's origin to what it
// pulls (the cart's front edge for pair 0 / the single, the pair ahead's
// yoke for the rest). Pair 0 carries the pole, later pairs the trace chain.
export function teamDef(kind, { pair = false, index = 0 } = {}) {
  const sp = SPECIES.find((s) => s.name === kind), D = sp.draft;
  const gait = gaitBase(sp);
  const bodyR = sp.parts[0].size.r;
  let parts, back;
  if (!pair) {
    back = D.single;
    const len = back + 1.0;
    parts = [...sp.parts];
    for (const s of [1, -1])   // shafts along the flanks, from the breast back to the cart
      parts.push({ id: "shaft" + s, parent: null, shape: "capsule", size: { r: .035, len }, geomRot: [0, 0, 90],
                   pos: [(1.0 - back) / 2, D.shaftY, s * (bodyR + .14)], color: DARK });
  } else {
    back = index ? D.spacing : D.back;
    parts = [...prefixed(sp.parts, "L_", D.zSp, 0), ...prefixed(sp.parts, "R_", -D.zSp, 1.1)];
    parts.push({ id: "yoke", parent: null, shape: "capsule", size: { r: kind === "ox" ? .06 : .04, len: 2 * D.zSp + .8 },
                 geomRot: [90, 0, 0], pos: [D.yokeX, D.yokeY, 0], color: DARK });
    if (kind === "ox")   // ox bows: the U under each neck, seen as its two uprights outside the body
      for (const z of [D.zSp + bodyR + .05, D.zSp - bodyR - .05, -D.zSp + bodyR + .05, -D.zSp - bodyR - .05])
        parts.push({ id: "bow" + z, parent: null, shape: "capsule", size: { r: .028, len: .4 }, pos: [D.yokeX, D.yokeY - .25, z], color: DARK });
    if (!index) parts.push({ id: "pole", parent: null, shape: "capsule", size: { r: .05, len: back + D.yokeX }, geomRot: [0, 0, 90],
                             pos: [(D.yokeX - back) / 2, D.yokeY - .55, 0], color: DARK });
    else parts.push({ id: "trace", parent: null, shape: "capsule", size: { r: .022, len: back }, geomRot: [0, 0, 90],
                      pos: [D.yokeX - back / 2, D.yokeY - .4, 0], color: IRON });
  }
  return { name: pair ? `pair-${kind}` : `single-${kind}`, parts, gait, gaits: sp.gaits, legLen: sp.legLen, back, speed: D.speed,
           halfLen: bodyProbe(sp) };
}

// a whole cart: body def, wheel placements, team defs (nearest the cart
// first) and the driver, plus the offsets that place them along the road
export function makeCart({ size = "medium", kind = "ox", animals = 2, seed = 1, variant = 0 } = {}) {
  const S = CART_SIZES[size];
  const body = cartBody(size, { seed, variant });
  const team = [];
  let off = S.bedL / 2;   // arc-length ahead of the cart's center
  if (animals === 1) { const t = teamDef(kind); off += t.back; team.push({ def: t, off }); }
  else for (let i = 0; i < animals / 2; i++) { const t = teamDef(kind, { pair: true, index: i }); off += t.back; team.push({ def: t, off }); }
  const driver = makePerson({ seed: seed * 17 + 5, pose: "sit", still: true, adult: true });
  const D = SPECIES.find((s) => s.name === kind).draft;
  return {
    size, kind, body, team, driver,
    wheels: S.wheels.flatMap((w) => [1, -1].map((s) => ({ x: w.x, r: w.r, z: s * (S.bedW / 2 + .16) }))),
    seat: [body.seatX, driver.sitAt(body.seatTop), 0],   // the driver's origin on the box (people.js sitAt: resting on the board)
    floor: S.floor, bedL: S.bedL, bedW: S.bedW,
    capacity: size === "small" ? 2 : size === "medium" ? 3 : 5,   // live goods a freight cart takes
    speed: D.speed,
    // ground probes for pitching the body: both axles, or the axle and the
    // shaft tips for the two-wheeler (its animal holds the bed level)
    probes: S.wheels.length > 1 ? [S.wheels[0].x, S.wheels[1].x] : [S.bedL / 2 + 1.2, S.wheels[0].x],
    frontLen: off + team[team.length - 1].def.halfLen,   // nose of the lead animal
    rearLen: S.bedL / 2,
  };
}

// the fleet mix that cycles along the highway
export const FLEET = [
  { size: "small", kind: "ox", animals: 1 }, { size: "medium", kind: "horse", animals: 2 },
  { size: "large", kind: "ox", animals: 4 }, { size: "small", kind: "horse", animals: 1 },
  { size: "large", kind: "horse", animals: 6 }, { size: "medium", kind: "ox", animals: 2 },
  { size: "large", kind: "horse", animals: 4 }, { size: "medium", kind: "horse", animals: 1 },
  { size: "large", kind: "ox", animals: 6 }, { size: "small", kind: "ox", animals: 1 },
];
