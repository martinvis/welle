// Carts and wagons: the highway's haulage, at real dimensions.
//
// A cart is two things. Its BODY -- bed, sides, axles, bolsters, driver's
// board and the casks and sacks it carries -- is an ITEM (assets/items/
// components/cart-*, tools/propgen.py) and moves as one rigid group. Its
// WHEELS are shared instanced copies of items/components/cart-wheel: three
// real wheel sizes serve the whole fleet, rolled by matrix per frame. Its
// TEAM -- the draft animals with yoke, bows, pole/traces or shafts -- and its
// DRIVER are banner skeletons in an instanced herd like every other
// creature, so oxen trot, tails swish and heads turn for free. Every
// dimension is meters from period sources: a two-wheel cart on 1.5m wheels,
// a farm wagon, a heavy freight wagon behind up to three pairs.
import { SPECIES, gaitBase, bodyProbe } from "./species.js";
import { makePerson } from "./people.js";
import "./architecture.js";   // (it registers the catalogue's items with the assembler: before the sizes are read below)
import { itemOf } from "./arch/assemble.js";   // (the bodies and wheels are items: assets/items/components/cart-*)

const DARK = 0x4e3a24, IRON = 0x3e3a38;

// the three carts are ASSETS (tools/propgen.py -> items/components/cart-small, -medium, -large): their bodies with the
// five loads each, origin on the ground under the bed's centre, +x forward; the wheels items/components/cart-wheel.
// What the fleet needs to drive them -- the bed, its floor, the axles and wheel sizes (4-wheelers steer on smaller
// front wheels), the driver's board -- is read from the bodies' own params, so the numbers live in one place.
const CART_ITEM = (size) => `items/components/cart-${size}`;
const TEAMS = { small: [1], medium: [1, 2], large: [2, 4, 6] };   // one animal between shafts; a pair; two or three pairs
export const CART_SIZES = Object.fromEntries(Object.keys(TEAMS).map((size) => {
  const P = itemOf({ path: CART_ITEM(size) }).params;
  const wheels = [1, 2].filter((i) => P[`axle${i}X`] !== undefined).map((i) => ({ x: P[`axle${i}X`], r: P[`wheel${i}R`] }));
  return [size, { bedL: P.bedL, bedW: P.bedW, floor: P.floor, side: P.side, seatX: P.seatX, seatTop: P.seatTop, wheels, teams: TEAMS[size] }];
}));
export const LOAD_VARIANTS = 5;   // (the bodies' `load` 0..4: casks lying, standing casks, kegs, sacks in two courses, mixed; -1 empty)

// the cart body: its item, the load drawn, the driver's board
export function cartBody(size, { seed = 1, variant = 0 } = {}) {
  const S = CART_SIZES[size];
  return { name: `cart-${size}`, item: CART_ITEM(size), seed, params: { load: variant }, seatTop: S.seatTop, seatX: S.seatX };
}
// a spoked wheel r in radius (items/components/cart-wheel): more spokes the bigger it is
export const wheelParams = (r) => ({ r, n: r < .5 ? 8 : r < .7 ? 10 : 12 });

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
