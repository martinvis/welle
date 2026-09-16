// The farm village on the river's south bank -- everything a small
// medieval hamlet needs beyond the houses (which are architecture.js's
// medievalHouse): a three-arch stone bridge a barge can pass under, a
// bakery where the mill's flour becomes bread, fenced yards with a pigsty
// and a hen house, tilled fields of rye, barley, cabbage, beans and
// garlic, three rows of currant bushes, and an apple-and-cherry orchard (grown by flora.js like the woods).
// Each is a building definition in the same part vocabulary (real sizes,
// merged into a few draw calls by buildBuilding); the demo places them by
// x along the bank like the riverside street's buildings.
import { placeFurniture, sack, barrel } from "./architecture.js";
import { rng } from "./flora.js";

// ---- the stone bridge ---------------------------------------------------------
// Three semicircular arches on two piers: the middle span clears a barge
// (crown ~4.3m over the water), the side spans reach the banks. The deck
// rises 2.9m over the banks, with earth ramps 14m long at either end. The
// bridge runs along local z (across the river); x is along the river.
export function stoneBridge({ name = "Stone bridge", water = -2.21, deckW = 4.4, hw = 10.8 } = {}) {
  const stone = 0x8e8678, dark = 0x746c60, cap = 0x9d968a, parts = [];
  const spring = water + .3;                    // the arches spring .3m above the water
  const rMid = 4.3, pierT = 1.2, wallT = .5;
  const halfL = hw + .7;                        // the abutments' outer faces, .7m onto the banks: where the ramps start
  const zAbut = halfL - .6;                     // abutment centers (1.2 thick)
  const zPier = rMid + pierT / 2;               // pier centers: 4.9
  const rSide = Math.max(1.6, (zAbut - .6 - (zPier + pierT / 2)) / 2);   // the side spans fill what is left to the abutments
  const zSide = zPier + pierT / 2 + rSide;      // side arch centers
  const bed = water - 2.5;                      // footing below the riverbed
  const deckTop = spring + rMid + .5, deckBot = deckTop - .4;
  const ramp = 14, rise = deckTop;
  // spandrel walls: a panel per span with the arch bitten out, one on each face of the bridge
  for (const sx of [-1, 1]) {
    const x = sx * (deckW / 2 - wallT / 2);
    parts.push({ shape: "spandrel", size: { w: 2 * rMid + pierT, h: deckBot - spring, r: rMid, t: wallT }, pos: [x, spring, 0], rot: [0, 90, 0], color: stone, pat: "ashlar" });
    for (const sz of [-1, 1])
      parts.push({ shape: "spandrel", size: { w: 2 * rSide + pierT + 1.2, h: deckBot - spring, r: rSide, t: wallT }, pos: [x, spring, sz * zSide], rot: [0, 90, 0], color: stone, pat: "ashlar" });
  }
  // piers and abutments: footing to deck, full width (they also fill the hollow between the two walls)
  for (const sz of [-1, 1]) {
    parts.push({ shape: "box", size: [deckW, spring - bed, pierT + .3], pos: [0, (spring + bed) / 2, sz * zPier], color: dark, pat: "ashlar" });
    parts.push({ shape: "box", size: [deckW - wallT, deckBot - spring, pierT], pos: [0, (deckBot + spring) / 2, sz * zPier], color: stone });
    parts.push({ shape: "box", size: [deckW + .3, deckBot - bed, 1.2], pos: [0, (deckBot + bed) / 2, sz * zAbut], color: dark, pat: "ashlar" });
    // cutwaters: pointed noses on the piers, up- and downstream
    for (const sx of [-1, 1])
      parts.push({ shape: "box", size: [1.1, spring - bed + .4, 1.1], pos: [sx * (deckW / 2 + .2), (spring + bed) / 2 + .2, sz * zPier], rot: [0, 45, 0], color: dark, pat: "ashlar" });
  }
  // the deck and its parapets
  parts.push({ shape: "box", size: [deckW, .4, 2 * halfL], pos: [0, deckTop - .2, 0], color: cap, pat: "checker", accent: 0x8a8378 });
  for (const sx of [-1, 1]) {
    parts.push({ shape: "box", size: [.35, .95, 2 * halfL], pos: [sx * (deckW / 2 - .175), deckTop + .475, 0], color: stone, pat: "ashlar" });
    parts.push({ shape: "box", size: [.45, .1, 2 * halfL + .1], pos: [sx * (deckW / 2 - .175), deckTop + .99, 0], color: cap });   // coping
  }
  // the ramps: earth banks faced in stone, sloping 11.7 degrees to the ground
  const slopeL = Math.hypot(ramp, rise), ang = Math.atan2(rise, ramp) * 180 / Math.PI;
  for (const sz of [-1, 1]) {
    const zc = sz * (halfL + ramp / 2);
    parts.push({ shape: "box", size: [deckW, .4, slopeL], pos: [0, rise / 2 - .2, zc], rot: [sz * ang, 0, 0], color: 0x9a8f7c, pat: "checker", accent: 0x8a7f6e });
    for (const sx of [-1, 1])   // low ramp walls, following the slope
      parts.push({ shape: "box", size: [.3, .6, slopeL], pos: [sx * (deckW / 2 - .15), rise / 2 + .1, zc], rot: [sz * ang, 0, 0], color: stone, pat: "ashlar" });
  }
  const floorY = (x, z) => {
    if (Math.abs(x) > deckW / 2 + .15) return 0;
    const az = Math.abs(z);
    if (az <= halfL) return deckTop;
    if (az <= halfL + ramp) return deckTop * (1 - (az - halfL) / ramp) || .001;
    return 0;
  };
  return { name, parts, footprint: [deckW + 2, 2 * (halfL + ramp) + 2], floorY, deckTop, halfL, ramp, doors: [], windows: [] };
}

// ---- the bakery ---------------------------------------------------------------
// A 9 x 8m stone bakehouse: brick oven with a live fire under its dome and a
// chimney through the ridge, the kneading table with dough and a flour
// heap, racks of loaves along the west wall, the mill's sacks stacked in
// the corner. The baker works at the table; a customer waits by the door.
export function bakery({ name = "Bakery" } = {}) {
  const W = 9, D = 8, H0 = 3.1, T = .4, F = .15, W2 = W / 2, D2 = D / 2;
  const stone = 0x9a917f, plaster = 0xe0d6c2, timber = 0x5b4326, wood = 0x6b4a2c, brick = 0x9a5a3c, roofC = 0x7d5433;
  const raw = [], folkSpots = [];
  const parts = { push: (...ps) => raw.push(...ps.map((p) => (p.color === wood && p.shape === "box" && !p.pat ? { ...p, pat: "wood" } : p))) };
  // ---- shell: flagstone floor, front with door and two windows, one window each side, blind east wall for the oven ----
  parts.push({ shape: "box", size: [W, .15, D], pos: [0, .075, 0], color: 0x8b8578, pat: "checker", accent: 0x6f6960 });
  parts.push({ shape: "hwall", size: { w: W, h: H0, t: T, holes: [[0, 0, 1.4, 2.2], [-2.6, 1.1, 1.2, 1.1], [2.4, 1.1, 1.2, 1.1]] }, pos: [0, 0, D2 - T / 2], color: stone, pat: "ashlar" });
  parts.push({ shape: "hwall", size: { w: W, h: H0, t: T, holes: [[-2.0, 1.3, 1.0, .9]] }, pos: [0, 0, -D2 + T / 2], color: stone, pat: "ashlar" });
  parts.push({ shape: "hwall", size: { w: D, h: H0, t: T, holes: [[1.2, 1.2, 1.0, 1.0]] }, pos: [-(W2 - T / 2), 0, 0], rot: [0, -90, 0], color: stone, pat: "ashlar" });
  parts.push({ shape: "box", size: [T, H0, D], pos: [W2 - T / 2, H0 / 2, 0], color: stone, pat: "ashlar" });
  const windows = [{ x: -2.6, y: 1.7, z: D2 - T / 2, w: 1.2, h: 1.1 }, { x: 2.4, y: 1.7, z: D2 - T / 2, w: 1.2, h: 1.1 },
                   { x: -2.0, y: 1.75, z: -D2 + T / 2, w: 1.0, h: .9 }, { x: -(W2 - T / 2), y: 1.7, z: 1.2, w: 1.0, h: 1.0, yaw: 90 }];
  // plastered inner faces read as a lime-washed room
  parts.push({ shape: "box", size: [W - 2 * T, .18, D - 2 * T], pos: [0, H0 + .09, 0], color: timber, pat: "wood" });   // boarded ceiling
  for (let x = -W2 + T + .7; x < W2 - T; x += 1.4) parts.push({ shape: "box", size: [.16, .2, D - 2 * T], pos: [x, H0 - .1, 0], color: timber, collide: false });   // joists
  const rh = 3.6;
  parts.push({ shape: "gable", size: [W + .8, rh, D + 1.0], pos: [0, H0 + .18, 0], color: roofC, pat: "tiles" });
  // ---- the oven on the east wall: brick base, domed top, a mouth toward the room, the fire inside, a chimney through the ridge ----
  const ox = W2 - T - 1.05;
  // the block behind, a front slab with the MOUTH cut through it toward the room, the firebox between them
  // (floor, cheeks, lintel, sooted back) with the fire burning inside, seen through the mouth
  parts.push({ shape: "box", size: [1.45, 1.0, 2.0], pos: [ox + .325, F + .5, 0], color: brick, pat: "brick" });
  parts.push({ shape: "hwall", size: { w: 2.0, h: 1.0, t: .3, holes: [[0, .45, .8, .5]] }, pos: [ox - .9, F, 0], rot: [0, 90, 0], color: brick, pat: "brick" });
  parts.push({ shape: "box", size: [.35, .45, 2.0], pos: [ox - .575, F + .225, 0], color: brick, pat: "brick" });                    // firebox floor
  for (const a of [-1, 1]) parts.push({ shape: "box", size: [.35, .55, .6], pos: [ox - .575, F + .725, a * .7], color: brick, pat: "brick" });   // cheeks
  parts.push({ shape: "box", size: [.35, .05, 2.0], pos: [ox - .575, F + .975, 0], color: brick, pat: "brick" });                    // lintel
  parts.push({ shape: "box", size: [.02, .5, .8], pos: [ox - .41, F + .7, 0], color: 0x1a120c, collide: false, outline: false });    // the sooted back
  parts.push({ shape: "sphere", size: { r: 1.0 }, scale: [1.05, .72, 1.0], pos: [ox, F + 1.0, 0], color: brick, pat: "brick" });
  parts.push({ shape: "box", size: [.9, .06, 1.0], pos: [ox - 1.35, F + .42, 0], color: 0x6f6960 });                  // the hearth step in front
  const fires = [{ x: ox - .6, y: F + .45, z: 0, r: .2, h: .46 }];   // inside the firebox
  parts.push({ shape: "box", size: [.9, H0 + rh + .6 - 1.7, .9], pos: [ox, F + 1.7 + (H0 + rh + .6 - 1.7) / 2, 0], color: brick, pat: "brick" });   // chimney
  parts.push({ shape: "cyl", size: { r1: .025, r2: .025, h: 1.7, seg: 6 }, pos: [W2 - T - .24, F + .85, -1.7], rot: [0, 0, -8], color: 0x4a3a2a });   // the peel, leaning against the wall beside the oven
  parts.push({ shape: "box", size: [.02, .42, .3], pos: [W2 - T - .09, F + 1.9, -1.7], rot: [0, 0, -8], color: 0x4a3a2a });
  // ---- the kneading table with dough, a flour heap and rolling pin ----
  const tx = -.2, tz = .3, top = F + .79;
  placeFurniture(raw, "table", tx, F, tz);
  for (const [dx, dz] of [[-.55, -.2], [-.25, .15], [.1, -.15], [.42, .1]])
    parts.push({ shape: "sphere", size: { r: .085 }, scale: [1.2, .8, 1], pos: [tx + dx, top + .065, tz + dz], color: 0xe9dcbf });   // dough
  parts.push({ shape: "sphere", size: { r: .22 }, scale: [1.4, .25, 1.1], pos: [tx - .55, top + .04, tz + .25], color: 0xf2ece0, outline: false });   // flour
  parts.push({ shape: "cyl", size: { r1: .03, r2: .03, h: .45, seg: 6 }, pos: [tx + .5, top + .03, tz + .3], rot: [90, 0, 25], color: 0xa8865a });     // rolling pin
  folkSpots.push({ x: tx, y: F, z: tz + 1.0, h: Math.PI / 2, role: "work", gesture: "knead", pose: "stand" });       // the baker, facing the table (and the oven beyond)
  folkSpots.push({ x: 1.6, y: F, z: D2 - T - 1.1, h: Math.PI / 2, pose: "stand" });   // a customer just inside the door
  // ---- loaf racks along the west wall ----
  const rx = -(W2 - T) + .25;
  for (const sy of [F + .85, F + 1.3, F + 1.75]) {
    parts.push({ shape: "box", size: [.4, .04, 3.4], pos: [rx, sy, -.6], color: wood });
    for (let k = 0; k < 6; k++) {
      const z = -2.05 + k * .58;
      if ((k + Math.round(sy * 10)) % 2) parts.push({ shape: "sphere", size: { r: .11 }, scale: [.8, .6, 1.7], pos: [rx, sy + .085, z], color: 0xb8803e });   // long loaf
      else parts.push({ shape: "sphere", size: { r: .13 }, scale: [1, .65, 1], pos: [rx, sy + .1, z], color: 0xa96f30 });                                  // round loaf
    }
  }
  for (const sz of [-1, 1]) parts.push({ shape: "box", size: [.06, 1.9, .06], pos: [rx + .15, F + .95, -.6 + sz * 1.7], color: wood });   // rack posts
  // ---- the flour: sacks from the mill, stacked in the north-west corner ----
  for (const [x, z] of [[-3.5, -3.0], [-2.7, -3.0], [-3.5, -2.2]]) raw.push(...sack([x, F, z], "up"));
  raw.push(...sack([-3.1, F + .9, -2.6], "x"));
  raw.push(...sack([-1.9, F, -3.0], "z"));
  // a bench under the front windows outside, and the sign: a golden pretzel-ish ring on a bracket
  parts.push({ shape: "box", size: [1.8, .06, .4], pos: [-2.6, .5, D2 + .5], color: wood });
  for (const dx of [-.7, .7]) parts.push({ shape: "box", size: [.08, .47, .3], pos: [-2.6 + dx, .235, D2 + .5], color: wood });
  parts.push({ shape: "box", size: [.06, .06, .7], pos: [1.3, 2.7, D2 + .35], color: 0x3e3a38 });
  parts.push({ shape: "cyl", size: { r1: .3, r2: .3, h: .06, seg: 12, open: true }, pos: [1.3, 2.3, D2 + .7], rot: [0, 0, 90], color: 0xc9a227 });
  parts.push({ shape: "cyl", size: { r1: .17, r2: .17, h: .08, seg: 12 }, pos: [1.3, 2.3, D2 + .7], rot: [0, 0, 90], color: 0xe0c060 });
  const floorY = (x, z) => (Math.abs(x) <= W2 && Math.abs(z) <= D2 ? F : 0);
  return { name, parts: raw, footprint: [W + 2, D + 2], floorY, folkSpots, fires, windows,
           doors: [{ x: 0, z: D2 - T / 2, w: 1.4, h: 2.2 }],
           cobwebs: [{ x: -(W2 - T), y: H0, z: -(D2 - T), sx: 1, sz: 1, d: .6 }, { x: W2 - T, y: H0, z: D2 - T, sx: -1, sz: -1, d: .5 }] };
}

// ---- fenced farmyards: post-and-rail fence, gate open to the street, a shed for the animals ----
// kind "pigs": a pigsty (three walls, lean-to roof, trough, wallow) --
// kind "hens": a hen house on legs with a ladder plank and a water bowl.
// `pen` is the animals' range (local): the yard inside the fence, minus the
// shed walls they would otherwise walk through.
export function farmyard({ name = "Farmyard", kind = "pigs", w = 20, d = 15 } = {}) {
  const wood = 0x6b4a2c, dark = 0x4a3520, parts = [], vessels = [], W2 = w / 2, D2 = d / 2;   // vessels: water to drink (tableware.js)
  const post = (x, z) => parts.push({ shape: "cyl", size: { r1: .07, r2: .08, h: 1.15, seg: 6 }, pos: [x, .575, z], color: dark });
  const rails = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(-(z1 - z0), x1 - x0) * 180 / Math.PI;
    for (const y of [.5, .95]) parts.push({ shape: "box", size: [len, .09, .07], pos: [(x0 + x1) / 2, y, (z0 + z1) / 2], rot: [0, yaw, 0], color: wood, pat: "wood" });
  };
  const gateW = 1.6, gx = -W2 + 3.5;   // the gate: on the north side (toward the street), 3.5m from the west corner
  const sides = [[[-W2, -D2], [W2, -D2]], [[W2, -D2], [W2, D2]], [[W2, D2], [-W2, D2]], [[-W2, D2], [-W2, -D2]]];
  for (const [[ax, az], [bx, bz]] of sides) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.ceil(len / 2.0);
    for (let k = 0; k <= n; k++) post(ax + (bx - ax) * k / n, az + (bz - az) * k / n);
    for (let k = 0; k < n; k++) {
      const x0 = ax + (bx - ax) * k / n, z0 = az + (bz - az) * k / n, x1 = ax + (bx - ax) * (k + 1) / n, z1 = az + (bz - az) * (k + 1) / n;
      if (az === -D2 && bz === -D2 && Math.max(x0, x1) > gx - gateW / 2 && Math.min(x0, x1) < gx + gateW / 2) {   // the gap for the gate
        if (x0 < gx - gateW / 2) rails(x0, z0, gx - gateW / 2, z0);
        if (x1 > gx + gateW / 2) rails(gx + gateW / 2, z0, x1, z0);
      } else rails(x0, z0, x1, z1);
    }
  }
  post(gx - gateW / 2, -D2); post(gx + gateW / 2, -D2);
  rails(gx + gateW / 2, -D2, gx + gateW / 2, -D2 + gateW);   // the gate leaf, swung open into the yard
  const blocks = [];   // local rects the animals keep out of
  if (kind === "pigs") {
    // the sty in the south-east corner, open to the north; a trough beside it; a wallow in the middle
    const sx = W2 - 2.3, sz = D2 - 1.9, sw = 3.4, sd = 2.6, sh = 1.5, rise = .5;   // lean-to: .5m higher at the open front
    parts.push({ shape: "box", size: [sw, .05, sd], pos: [sx, .025, sz], color: 0x5a4632, collide: false });
    parts.push({ shape: "box", size: [sw, sh, .15], pos: [sx, sh / 2, sz + sd / 2 - .075], color: wood, pat: "wood" });   // back wall (the low side)
    for (const s of [-1, 1]) {   // side walls: a box up to the back wall's height, topped by a wedge that rises to the front eave
      parts.push({ shape: "box", size: [.15, sh, sd], pos: [sx + s * (sw / 2 - .075), sh / 2, sz], color: wood, pat: "wood" });
      parts.push({ shape: "wedge", size: [rise, .15, sd], pos: [sx + s * (sw / 2 - .075), sh, sz - sd / 2], rot: [0, 0, 90], color: wood, pat: "wood", collide: false });
      parts.push({ shape: "box", size: [.15, sh + rise, .15], pos: [sx + s * (sw / 2 - .075), (sh + rise) / 2, sz - sd / 2 + .075], color: dark });   // front posts
    }
    const ang = Math.atan2(rise, sd) * 180 / Math.PI, rl = Math.hypot(sd + .8, rise * (sd + .8) / sd);
    parts.push({ shape: "box", size: [sw + .4, .1, rl], pos: [sx, sh + rise / 2 + .05, sz], rot: [ang, 0, 0], color: 0x7a5a3a, pat: "wood" });   // the roof lies on the walls: front eave at sh+rise, back at sh
    parts.push({ shape: "box", size: [1.4, .32, .45], pos: [sx - sw / 2 - 1.2, .16, sz + .6], color: dark, pat: "wood" });                         // trough
    parts.push({ shape: "box", size: [1.25, .03, .32], pos: [sx - sw / 2 - 1.2, .31, sz + .6], color: 0x8a7a50, outline: false });                  // slop
    parts.push({ shape: "box", size: [4.5, .04, 3.2], pos: [-1, .02, .5], rot: [0, 20, 0], color: 0x5a4632, collide: false });                       // the wallow
    blocks.push({ x0: sx - sw / 2, x1: sx + sw / 2, z0: sz - sd / 2 + .3, z1: sz + sd / 2 });
  } else if (kind === "horses") {
    // the stable block along the south fence: stone plinth, boarded walls, tiled gable roof, four
    // 3m stalls opening north onto the paddock through half-doors (upper halves open, hay inside);
    // a water trough, a hitching rail and stacked hay bales in the yard
    const bw = 12, bd = 5, bh = 2.6, bx = -W2 + 1 + bw / 2, bz = D2 - 1 - bd / 2, fz = bz - bd / 2;   // fz: the stall front
    const stone = 0x9a917f;
    parts.push({ shape: "box", size: [bw, .12, bd], pos: [bx, .06, bz], color: 0x8b8578, collide: false });                        // cobbled floor
    parts.push({ shape: "box", size: [bw, .6, .3], pos: [bx, .3, bz + bd / 2 - .15], color: stone, pat: "ashlar" });               // back wall: plinth, boards above
    parts.push({ shape: "box", size: [bw, bh - .6, .25], pos: [bx, .6 + (bh - .6) / 2, bz + bd / 2 - .125], color: wood, pat: "wood" });
    for (const s of [-1, 1]) {   // end walls
      parts.push({ shape: "box", size: [.3, .6, bd], pos: [bx + s * (bw / 2 - .15), .3, bz], color: stone, pat: "ashlar" });
      parts.push({ shape: "box", size: [.25, bh - .6, bd], pos: [bx + s * (bw / 2 - .125), .6 + (bh - .6) / 2, bz], color: wood, pat: "wood" });
    }
    parts.push({ shape: "box", size: [bw, .25, .25], pos: [bx, bh - .125, fz + .125], color: dark });                            // front lintel beam
    parts.push({ shape: "gable", size: [bw + .8, 2.2, bd + .9], pos: [bx, bh, bz], color: 0x7d5433, pat: "tiles" });
    for (let i = 0; i <= 4; i++) parts.push({ shape: "box", size: [.22, bh, .22], pos: [bx - bw / 2 + i * 3, bh / 2, fz + .11], color: dark });   // stall posts
    for (let i = 0; i < 4; i++) {
      const cx = bx - bw / 2 + 1.5 + i * 3;
      parts.push({ shape: "box", size: [2.7, 1.25, .08], pos: [cx, .625, fz + .12], color: wood, pat: "wood" });                     // the half-door (lower half)
      parts.push({ shape: "box", size: [2.7, bh - 1.5, .05], pos: [cx, 1.25 + (bh - 1.5) / 2, fz + .8], color: 0x120d08, collide: false, outline: false });   // the dark stall beyond the open upper half
      parts.push({ shape: "sphere", size: { r: .55 }, scale: [1.6, .7, 1], pos: [cx, 1.05, fz + 1.0], color: 0xc9b56a, collide: false });   // hay showing over the door
      if (i < 3) parts.push({ shape: "box", size: [.08, bh - .3, bd - .5], pos: [cx + 1.5, .15 + (bh - .3) / 2, bz + .1], color: wood, pat: "wood", collide: false });   // the partition between stalls, seen edge-on over the doors
    }
    // the stone water trough: a water vessel (tableware.js: open, the water at its level) -- and an unseen solid box you cannot walk through
    vessels.push({ kind: "trough", x: bx - bw / 2 - 1.8, y: 0, z: fz - 1.4, fill: .6, drink: "water" });
    parts.push({ shape: "box", size: [2.2, .5, .7], pos: [bx - bw / 2 - 1.8, .25, fz - 1.4], color: stone, render: false });
    parts.push({ shape: "box", size: [3.6, .1, .1], pos: [bx, 1.05, fz - 2.4], color: dark });                                                // hitching rail
    for (const x of [bx - 1.5, bx + 1.5]) parts.push({ shape: "box", size: [.12, 1.1, .12], pos: [x, .55, fz - 2.4], color: dark });
    for (const [x, y, z] of [[bx + 4.6, .6, fz - 1.6], [bx + 5.9, .6, fz - 1.6], [bx + 5.25, 1.8, fz - 1.6]])                                // hay bales, two and one on top
      parts.push({ shape: "cyl", size: { r1: .6, r2: .6, h: 1.2, seg: 10 }, pos: [x, y, z], rot: [0, 0, 90], color: 0xd4bd6c });
    blocks.push({ x0: bx - bw / 2 - .3, x1: bx + bw / 2 + .3, z0: fz - .4, z1: bz + bd / 2 + .3 });
    blocks.push({ x0: bx - bw / 2 - 3.2, x1: bx - bw / 2 - .4, z0: fz - 2.0, z1: fz - .8 });   // the trough
    blocks.push({ x0: bx + 3.7, x1: bx + 6.8, z0: fz - 2.4, z1: fz - .8 });                    // the bales
  } else {
    // the hen house on legs in the south-west corner: boarded box, little gabled roof, pop-hole with a ladder plank
    const hx = -W2 + 2.6, hz = D2 - 2.2, hw = 1.9, hd = 1.5, legH = .55, bh = 1.1;
    for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) parts.push({ shape: "cyl", size: { r1: .05, r2: .05, h: legH, seg: 6 }, pos: [hx + a * (hw / 2 - .15), legH / 2, hz + b * (hd / 2 - .15)], color: dark });
    parts.push({ shape: "box", size: [hw, bh, hd], pos: [hx, legH + bh / 2, hz], color: wood, pat: "wood" });
    parts.push({ shape: "gable", size: [hw + .3, .55, hd + .3], pos: [hx, legH + bh, hz], color: 0x7a5a3a, pat: "wood" });
    parts.push({ shape: "box", size: [.36, .42, .04], pos: [hx - .4, legH + .3, hz - hd / 2 - .01], color: 0x1a120c, collide: false });   // the pop-hole
    parts.push({ shape: "box", size: [.34, .04, 1.3], pos: [hx - .4, legH / 2 + .05, hz - hd / 2 - .6], rot: [-25, 0, 0], color: 0x7a5a3a, collide: false });   // the ladder plank, rising toward the pop-hole
    for (let k = 0; k < 5; k++) parts.push({ shape: "box", size: [.34, .03, .03], pos: [hx - .4, legH / 2 + .07 + (k - 2) * .115, hz - hd / 2 - .6 + (k - 2) * .245], color: dark, collide: false });
    parts.push({ shape: "cyl", size: { r1: .22, r2: .18, h: .1, seg: 10 }, pos: [1.5, .05, 1.0], color: 0x7a7a70 });                    // water bowl
    parts.push({ shape: "cyl", size: { r1: .18, r2: .18, h: .02, seg: 10 }, pos: [1.5, .095, 1.0], color: 0x6f8ea0, outline: false });   // water
    parts.push({ shape: "sphere", size: { r: .35 }, scale: [1.6, .3, 1.2], pos: [-1.5, .04, -1.2], color: 0xc9b56a, outline: false });   // scattered grain
    blocks.push({ x0: hx - hw / 2 - .2, x1: hx + hw / 2 + .2, z0: hz - hd / 2 - .2, z1: hz + hd / 2 + .2 });
  }
  const pen = { x0: -W2 + .7, x1: W2 - .7, z0: -D2 + .7, z1: D2 - .7, blocks };
  return { name, parts, footprint: [w + 1.6, d + 1.6], pen, kind, vessels, doors: [], windows: [] };
}

// ---- crop fields --------------------------------------------------------------
// A tilled plot (furrowed soil slab, 12cm high) planted in rows. Every plant
// is a few boxes/spheres; a field is a few thousand parts merged into one
// draw call per color. Nothing here obstructs walking.
const CROPS = {
  rye:     { dx: .5, dz: .45, soil: 0x5b4634 },
  barley:  { dx: .5, dz: .45, soil: 0x5f4a36 },
  cabbage: { dx: .7, dz: .65, soil: 0x4e3c2c },
  beans:   { dx: .5, dz: 1.0, soil: 0x53412f },
  garlic:  { dx: .32, dz: .4, soil: 0x5a4736 },
};
export function cropField({ name, crop = "rye", w = 14, d = 12, seed = 1 } = {}) {
  const C = CROPS[crop] ?? CROPS.rye, r = rng(seed * 131 + 7), parts = [], W2 = w / 2, D2 = d / 2;
  parts.push({ shape: "box", size: [w, .12, d], pos: [0, .06, 0], color: C.soil, collide: false });
  if (crop === "soil") {   // plowed and not yet sown: furrow ridges across the plot, the spade's work
    for (let z = -D2 + .5; z <= D2 - .5; z += .55) parts.push({ shape: "box", size: [w - .8, .1, .24], pos: [0, .17, z], color: 0x5a4028, collide: false, outline: false });
  } else if (crop === "cabbage") {   // heads: one sphere each
    for (let x = -W2 + .5; x <= W2 - .5; x += C.dx) for (let z = -D2 + .5; z <= D2 - .5; z += C.dz) {
      const px = x + (r() - .5) * .12, pz = z + (r() - .5) * .12, R = .19 * (.85 + r() * .3);
      parts.push({ shape: "sphere", size: { r: R }, scale: [1, .9, 1], pos: [px, .12 + R * .85, pz], color: r() < .5 ? 0x86ad62 : 0x7aa35a, collide: false });
    }
  } else {
    // the plants are a shader pattern on thin see-through slabs (architecture.js
    // PAT 13-16): rows across the plot both ways, so the field reads from
    // every side, a few dozen boxes instead of thousands of stalks
    const H = { rye: 1.15, barley: .85, beans: 1.7, garlic: .45 }[crop], gap = crop === "beans" ? 1.0 : .5;
    const [c0, c1] = { rye: [0xb2a05a, 0xa89050], barley: [0xc9b66c, 0xd6c27a], beans: [0x6a5236, 0x3f8a3a], garlic: [0x7fb06a, 0x7fb06a] }[crop];
    const slab = { color: c0, accent: c1, pat: crop, side: "double", collide: false, outline: false };
    // (flat panels, not thin boxes: a box's 2cm end and top faces took the pattern across the row -- as the wind
    // shifted the stalks a whole end face turned into one stalk, a thin long yellow line; 8% taller than the plants
    // so the tallest ears are never cut)
    const Hp = H * 1.08;
    for (let z = -D2 + .6; z <= D2 - .6; z += gap) parts.push({ shape: "panel", size: [w - 1, Hp], pos: [0, .12 + Hp / 2, z], ...slab });
    for (let x = -W2 + .6; x <= W2 - .6; x += gap) parts.push({ shape: "panel", size: [d - 1, Hp], pos: [x, .12 + Hp / 2, 0], rot: [0, 90, 0], ...slab });
  }
  const floorY = (x, z) => (Math.abs(x) <= W2 && Math.abs(z) <= D2 ? .12 : 0);
  return { name: name ?? `${crop} field`, parts, footprint: [w + 1, d + 1], floorY, crop, doors: [], windows: [] };
}

// ---- berry rows: red, white and black currant bushes ----
// The bushes and the orchard's trees are PLANTS, not building parts: the
// site only says where they grow (`plants`, site-local), and the flora
// builder (index.html buildFlora) grows them with the same makeBush /
// makeTree and draws them in the same herd and foliage mesh as the woods --
// only the species differ (currants, apple, cherry, with their fruit cards).
export function berryRows({ name = "Currant bushes", w = 14, d = 9, seed = 3 } = {}) {
  const r = rng(seed * 61 + 3), plants = [], W2 = w / 2, D2 = d / 2;
  const kinds = ["currant", "whitecurrant", "blackcurrant"];   // a row of each
  const rows = 3, per = Math.floor((w - 1) / 1.7);
  for (let row = 0; row < rows; row++) for (let k = 0; k < per; k++) {
    const x = -W2 + .9 + k * 1.7 + (r() - .5) * .2, z = -D2 + 1.2 + row * ((d - 2.4) / (rows - 1)), s = .85 + r() * .3;
    plants.push({ kind: "bush", fruit: kinds[row], x, z, seed: seed * 1000 + row * 50 + k, height: 1.15 * s, rotY: r() * 6.2832 });
  }
  return { name, parts: [], plants, footprint: [w + 1, d + 1], doors: [], windows: [] };
}

// ---- the orchard: apple and cherry trees on a 5m grid (plants, see above) ----
export function orchard({ name = "Orchard", w = 22, d = 16, seed = 5 } = {}) {
  const r = rng(seed * 17 + 1), plants = [], W2 = w / 2, D2 = d / 2;
  const nx = Math.floor((w - 2) / 5), nz = Math.floor((d - 2) / 5);
  for (let i = 0; i <= nx; i++) for (let j = 0; j <= nz; j++) {
    const x = -W2 + 1 + i * 5 + (r() - .5) * .6, z = -D2 + 1 + j * 5 + (r() - .5) * .6, cherry = (i + j) % 2 === 1, s = .9 + r() * .25;
    plants.push({ kind: "tree", species: cherry ? "cherry" : "apple", x, z, seed: seed * 1000 + i * 20 + j, height: (cherry ? 5.6 : 4.8) * s, rotY: r() * 6.2832 });
  }
  return { name, parts: [], plants, footprint: [w + 1, d + 1], doors: [], windows: [] };
}

// ---- the fisherman's hut: a 5 x 4m boarded hut on the bank, nets and a drying rack, a plank jetty and a rowing boat ----
export function fisherHut({ name = "Fisherman's hut", water = -2.21 } = {}) {
  const W = 5, D = 4, H = 2.4, T = .3, F = .12, W2 = W / 2, D2 = D / 2;
  const wood = 0x6b4a2c, dark = 0x4a3520, plank = 0x7a5a36, parts = [], folkSpots = [];
  parts.push({ shape: "box", size: [W, .12, D], pos: [0, .06, 0], color: 0x8b8578 });
  parts.push({ shape: "hwall", size: { w: W, h: H, t: T, holes: [[0, 0, 1.1, 2.0], [1.6, 1.1, .8, .8]] }, pos: [0, 0, D2 - T / 2], color: wood, pat: "wood" });
  parts.push({ shape: "hwall", size: { w: W, h: H, t: T, holes: [[-1.2, 1.1, .8, .8]] }, pos: [0, 0, -D2 + T / 2], color: wood, pat: "wood" });
  for (const s of [-1, 1]) parts.push({ shape: "box", size: [T, H, D], pos: [s * (W2 - T / 2), H / 2, 0], color: wood, pat: "wood" });
  parts.push({ shape: "box", size: [W - 2 * T, .12, D - 2 * T], pos: [0, H + .06, 0], color: dark, pat: "wood" });
  parts.push({ shape: "gable", size: [W + .8, 1.9, D + .8], pos: [0, H + .12, 0], color: 0x8a7a4a });   // reed thatch
  const windows = [{ x: 1.6, y: 1.5, z: D2 - T / 2, w: .8, h: .8 }, { x: -1.2, y: 1.5, z: -D2 + T / 2, w: .8, h: .8 }];
  // inside: a plank table with the catch in a basket, a stool, a cot
  parts.push({ shape: "box", size: [1.2, .06, .6], pos: [-1.3, F + .72, .8], color: wood, pat: "wood" });
  for (const [a, b] of [[-1, -1], [1, 1]]) parts.push({ shape: "box", size: [.08, .7, .08], pos: [-1.3 + a * .5, F + .35, .8 + b * .22], color: wood });
  parts.push({ shape: "cyl", size: { r1: .2, r2: .16, h: .16, seg: 10 }, pos: [-1.3, F + .83, .8], color: 0xb8965a });
  for (const dx of [-.08, .06]) parts.push({ shape: "capsule", size: { r: .035, len: .22 }, pos: [-1.3 + dx, F + .95, .8], rot: [0, 0, 90], color: 0x9aa6ae, collide: false });
  parts.push({ shape: "cyl", size: { r1: .18, r2: .16, h: .45, seg: 8 }, pos: [-.3, F + .225, 1.0], color: wood });   // stool
  parts.push({ shape: "box", size: [1.9, .35, .8], pos: [1.3, F + .3, -1.2], color: wood, pat: "wood" });           // the cot
  parts.push({ shape: "box", size: [1.8, .12, .7], pos: [1.3, F + .53, -1.2], color: 0x8a8a70 });
  // outside: nets hung on the west wall, a drying rack with fish on the east side
  parts.push({ shape: "box", size: [.04, 1.3, 1.6], pos: [-W2 - .04, 1.3, .2], color: 0x8a8a70, pat: "stars", accent: 0x6a6a55, collide: false });
  parts.push({ shape: "box", size: [.04, .9, 1.0], pos: [-W2 - .08, 1.5, -1.0], color: 0x7a7a60, pat: "stars", accent: 0x5a5a48, collide: false });
  for (const z of [-1.2, 1.2]) parts.push({ shape: "cyl", size: { r1: .05, r2: .06, h: 1.9, seg: 6 }, pos: [W2 + 1.0, .95, z], color: dark });
  parts.push({ shape: "box", size: [.06, .06, 2.6], pos: [W2 + 1.0, 1.85, 0], color: dark });
  for (let k = 0; k < 6; k++) parts.push({ shape: "capsule", size: { r: .04, len: .26 }, pos: [W2 + 1.0, 1.62, -1.0 + k * .4], color: k % 2 ? 0x9aa6ae : 0x8a9a8a, collide: false });
  // the jetty: planks on posts out over the bank line (at local z = -4) into the river; the boat moored alongside
  const jx = 1.2, jz0 = -3.4, jz1 = -9.0, jy = .25;
  parts.push({ shape: "box", size: [1.4, .08, jz0 - jz1], pos: [jx, jy, (jz0 + jz1) / 2], color: plank, pat: "wood", collide: false });
  for (const z of [-4.6, -6.8, -8.8]) for (const s of [-1, 1]) parts.push({ shape: "cyl", size: { r1: .1, r2: .1, h: 4.6, seg: 6 }, pos: [jx + s * .6, jy - 2.3, z], color: dark, collide: false });
  parts.push({ shape: "cyl", size: { r1: .08, r2: .1, h: .5, seg: 6 }, pos: [jx + .6, jy + .25, -8.6], color: dark });   // mooring post
  folkSpots.push({ x: jx - .2, y: jy + .04, z: jz1 + .7, h: Math.PI / 2, pose: "stand", role: "work", gesture: "fish", tool: "rod" });   // a fisher at the jetty's end, facing the river
  // (the boat and the fisherman are the demo's: `fisherBoat` below, moored at boatDock when not out fishing)
  const floorY = (x, z) => {
    if (Math.abs(x) <= W2 && Math.abs(z) <= D2) return F;
    if (Math.abs(x - jx) <= .75 && z <= jz0 + .1 && z >= jz1 - .1) return jy + .04;
    return 0;
  };
  return { name, parts, footprint: [W + 2, D + 2], floorY, folkSpots, windows, doors: [{ x: 0, z: D2 - T / 2, w: 1.1, h: 2.0 }],
           boatDock: [jx + 1.75, water + .28, -7.2],
           cobwebs: [{ x: -(W2 - T), y: H, z: -(D2 - T), sx: 1, sz: 1, d: .5 }] };
}

// The rowing boat (3.6 x 1.5m, bow along +x, origin at the waterline center),
// its two oars (each hinged at the gunwale, blade along +z for the left oar),
// the rod with its line, and the fish that comes up on it. Separate builds so
// the demo can row, ship the oars, cast and haul.
export function fisherBoat() {
  const hull = 0x4e3a24, plank = 0x7a5a36, parts = [];
  parts.push({ shape: "box", size: [3.6, .55, 1.5], pos: [0, 0, 0], color: hull, pat: "wood", collide: false });
  parts.push({ shape: "box", size: [1.0, .5, 1.3], pos: [2.0, .12, 0], rot: [0, 0, 30], color: hull, pat: "wood", collide: false });    // bow, raked up
  parts.push({ shape: "box", size: [.8, .45, 1.3], pos: [-1.9, .08, 0], rot: [0, 0, -22], color: hull, pat: "wood", collide: false });  // stern
  parts.push({ shape: "box", size: [3.2, .04, 1.2], pos: [0, .02, 0], color: 0x3a2a18, collide: false, outline: false });               // the bilge
  for (const x of [-.7, .6]) parts.push({ shape: "box", size: [.25, .05, 1.4], pos: [x, .3, 0], color: plank, collide: false });        // thwarts
  parts.push({ shape: "box", size: [.5, .3, .6], pos: [1.2, .3, .3], color: 0xb8965a, collide: false });                                  // creel
  return { name: "boat", parts };
}
export function oar(side) {   // hinged at the origin (the gunwale): handle inboard, loom and blade outboard along side*z
  return { name: "oar", parts: [
    { shape: "cyl", size: { r1: .025, r2: .025, h: 2.6, seg: 6 }, pos: [0, 0, side * .9], rot: [90, 0, 0], color: 0x7a5a36, collide: false },
    { shape: "box", size: [.14, .03, .5], pos: [0, 0, side * 2.0], color: 0x6a4a2c, collide: false },
  ] };
}
export function fishingRod() {   // along +y from the origin (the hand), 2.4m; the demo tilts it out over the side
  return { name: "rod", parts: [{ shape: "cyl", size: { r1: .006, r2: .014, h: 2.4, seg: 5 }, pos: [0, 1.2, 0], color: 0x8a6a3a, collide: false }] };
}
export function fishingLine() {   // hangs from the origin (the rod tip) to the water
  return { name: "line", parts: [{ shape: "cyl", size: { r1: .004, r2: .004, h: 1.8, seg: 3 }, pos: [0, -.9, 0], color: 0xd8d8d0, collide: false, outline: false }] };
}
export function caughtFish() {
  return { name: "fish", parts: [
    { shape: "capsule", size: { r: .045, len: .22 }, pos: [0, 0, 0], color: 0x9aa6ae, collide: false },
    { shape: "box", size: [.02, .12, .1], pos: [0, -.2, 0], color: 0x7a8a8a, collide: false, outline: false },   // tail fin
  ] };
}

// ---- the trade sign, the tavern's idiom: a bracket out from the wall over the door, a painted board hanging
// from it edge-on to the street, the trade's emblem on both faces. `dir` +1 for a front on +z, -1 on -z ----
export function hangingSign(parts, { x, z, dir = 1, color, pat, accent, emblem }) {
  parts.push({ shape: "box", size: [.08, .08, 1.1], pos: [x, 2.65, z + dir * .5], color: 0x4a3520 });
  parts.push({ shape: "box", size: [.06, .55, .85], pos: [x, 2.25, z + dir * .75], color, pat, accent });
  const bz = z + dir * .75;
  for (const f of [-1, 1]) {
    const fx = x + f * .045;
    if (emblem === "shuttle") parts.push({ shape: "box", size: [.03, .1, .55], pos: [fx, 2.25, bz], color: 0xe8dcc0, collide: false, outline: false });
    else if (emblem === "shears") for (const a of [-1, 1]) parts.push({ shape: "box", size: [.03, .05, .44], pos: [fx, 2.25, bz], rot: [a * 25, 0, 0], color: 0xd8d8d0, collide: false, outline: false });
    else if (emblem === "jug") { parts.push({ shape: "cyl", size: { r1: .1, r2: .13, h: .03, seg: 8 }, pos: [fx, 2.2, bz], rot: [0, 0, 90], color: 0xb56b45, collide: false, outline: false }); parts.push({ shape: "cyl", size: { r1: .06, r2: .06, h: .03, seg: 8 }, pos: [fx, 2.36, bz], rot: [0, 0, 90], color: 0xb56b45, collide: false, outline: false }); }
    else if (emblem === "horseshoe") parts.push({ shape: "cyl", size: { r1: .16, r2: .16, h: .03, seg: 10, open: true }, pos: [fx, 2.25, bz], rot: [0, 0, 90], color: 0xa8a8b0, collide: false, outline: false });
  }
}

// ---- the pottery: a 7 x 6m workshop with the kick wheel, shelves of pots, and a kiln beside the door ----
export function pottery({ name = "Pottery" } = {}) {
  const W = 7, D = 6, H = 2.8, T = .35, F = .15, W2 = W / 2, D2 = D / 2;
  const stone = 0x9a917f, wood = 0x6b4a2c, dark = 0x4a3520, clay = 0xb56b45, glaze = 0x4f7a8a, brick = 0x9a5a3c, parts = [], folkSpots = [];
  parts.push({ shape: "box", size: [W, .15, D], pos: [0, .075, 0], color: 0x8b8578, pat: "checker", accent: 0x6f6960 });
  parts.push({ shape: "hwall", size: { w: W, h: H, t: T, holes: [[-1.2, 0, 1.3, 2.1], [1.8, 1.1, 1.1, 1.0]] }, pos: [0, 0, D2 - T / 2], color: stone, pat: "ashlar" });
  parts.push({ shape: "box", size: [W, H, T], pos: [0, H / 2, -D2 + T / 2], color: stone, pat: "ashlar" });
  parts.push({ shape: "hwall", size: { w: D, h: H, t: T, holes: [[.5, 1.1, 1.0, 1.0]] }, pos: [-(W2 - T / 2), 0, 0], rot: [0, -90, 0], color: stone, pat: "ashlar" });
  parts.push({ shape: "box", size: [T, H, D], pos: [W2 - T / 2, H / 2, 0], color: stone, pat: "ashlar" });
  const windows = [{ x: 1.8, y: 1.6, z: D2 - T / 2, w: 1.1, h: 1.0 }, { x: -(W2 - T / 2), y: 1.6, z: .5, w: 1.0, h: 1.0, yaw: 90 }];
  parts.push({ shape: "box", size: [W - 2 * T, .15, D - 2 * T], pos: [0, H + .075, 0], color: dark, pat: "wood" });
  parts.push({ shape: "gable", size: [W + .8, 2.6, D + .9], pos: [0, H + .15, 0], color: 0x7d5433, pat: "tiles" });
  // the kick wheel: flywheel low, shaft, wheel head with a pot rising on it; the potter beside it
  const kx = 1.2, kz = -.6;
  parts.push({ shape: "cyl", size: { r1: .42, r2: .42, h: .08, seg: 12 }, pos: [kx, F + .16, kz], color: dark });
  parts.push({ shape: "cyl", size: { r1: .04, r2: .04, h: .75, seg: 6 }, pos: [kx, F + .5, kz], color: dark });
  parts.push({ shape: "cyl", size: { r1: .17, r2: .17, h: .04, seg: 12 }, pos: [kx, F + .84, kz], color: 0x5a4a3a });
  parts.push({ shape: "cyl", size: { r1: .1, r2: .13, h: .22, seg: 10 }, pos: [kx, F + .97, kz], color: clay });
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push({ shape: "box", size: [.08, .6, .08], pos: [kx + a * .5, F + .3, kz + b * .5], color: wood });   // the frame
  parts.push({ shape: "box", size: [.5, .06, .5], pos: [kx - .8, F + .45, kz], color: wood });   // the potter's seat
  for (const [a, b] of [[-1, -1], [1, 1]]) parts.push({ shape: "box", size: [.06, .42, .06], pos: [kx - .8 + a * .2, F + .21, kz + b * .2], color: wood });
  folkSpots.push({ x: kx - .8, y: F + .48, z: kz, h: 0, role: "work", gesture: "knead", pose: "sit" });   // the potter, seated at the wheel facing +x
  parts.push({ shape: "sphere", size: { r: .4 }, scale: [1.4, .55, 1.2], pos: [-1.6, F + .2, -1.9], color: 0x8a5a3a, collide: false });   // the clay heap
  // shelves of pots along the back wall: jugs and bowls, raw clay and glazed
  const sy = [F + .55, F + 1.1, F + 1.65], sz = -D2 + T + .22;
  for (const y of sy) {
    parts.push({ shape: "box", size: [W - 2 * T - .4, .04, .42], pos: [0, y, sz], color: wood, pat: "wood" });
    for (let k = 0; k < 9; k++) {
      const x = -2.6 + k * .65, gl = (k + Math.round(y * 3)) % 3 === 0;
      if (k % 2) parts.push({ shape: "cyl", size: { r1: .08, r2: .11, h: .3, seg: 8 }, pos: [x, y + .17, sz], color: gl ? glaze : clay });        // jug
      else parts.push({ shape: "cyl", size: { r1: .15, r2: .09, h: .11, seg: 10 }, pos: [x, y + .075, sz], color: gl ? glaze : clay });          // bowl
    }
  }
  for (const s of [-1, 1]) parts.push({ shape: "box", size: [.06, 1.8, .06], pos: [s * (W2 - T - .3), F + .95, sz + .18], color: wood });
  // the kiln outside, right of the door: brick chamber, domed, its mouth toward the street and a fire in it
  const qx = 2.4, qz = D2 + 1.6;
  // the chamber: the block behind, a front slab with the MOUTH cut through it, and between them the firebox
  // (floor, cheeks, lintel, a sooted back) with the fire burning inside where the mouth shows it
  parts.push({ shape: "box", size: [1.7, 1.0, 1.05], pos: [qx, .5, qz - .325], color: brick, pat: "brick" });
  parts.push({ shape: "hwall", size: { w: 1.7, h: 1.0, t: .3, holes: [[0, .3, .5, .45]] }, pos: [qx, 0, qz + .7], color: brick, pat: "brick" });
  parts.push({ shape: "box", size: [1.7, .3, .35], pos: [qx, .15, qz + .375], color: brick, pat: "brick" });                       // firebox floor
  for (const a of [-1, 1]) parts.push({ shape: "box", size: [.6, 1.0, .35], pos: [qx + a * .55, .5, qz + .375], color: brick, pat: "brick" });   // cheeks
  parts.push({ shape: "box", size: [1.7, .25, .35], pos: [qx, .875, qz + .375], color: brick, pat: "brick" });                    // lintel
  parts.push({ shape: "box", size: [.5, .45, .02], pos: [qx, .525, qz + .21], color: 0x1a120c, collide: false, outline: false });   // the sooted back of the firebox
  parts.push({ shape: "sphere", size: { r: .85 }, scale: [1, .7, 1], pos: [qx, 1.0, qz], color: brick, pat: "brick" });
  parts.push({ shape: "cyl", size: { r1: .16, r2: .2, h: 1.0, seg: 8 }, pos: [qx, 1.9, qz], color: brick, pat: "brick" });
  const fires = [{ x: qx, y: .3, z: qz + .38, r: .13, h: .32 }];   // inside the firebox, seen through the mouth
  // finished ware on a bench by the door
  parts.push({ shape: "box", size: [1.6, .06, .5], pos: [-2.4, .5, D2 + .5], color: wood, pat: "wood" });
  for (const dx of [-.6, .6]) parts.push({ shape: "box", size: [.08, .47, .4], pos: [-2.4 + dx, .235, D2 + .5], color: wood });
  for (let k = 0; k < 4; k++) parts.push({ shape: "cyl", size: { r1: .09, r2: .12, h: .32, seg: 8 }, pos: [-3.0 + k * .4, .69, D2 + .5], color: k % 2 ? glaze : clay });
  hangingSign(parts, { x: .35, z: D2, dir: 1, color: 0x4f7a8a, pat: "stars", accent: 0xe0c060, emblem: "jug" });   // the sign: a jug on a glaze-blue board
  folkSpots.push({ x: -1.2, y: F, z: D2 - T - 1.0, h: Math.PI / 2, pose: "stand" });   // a customer inside the door
  const floorY = (x, z) => (Math.abs(x) <= W2 && Math.abs(z) <= D2 ? F : 0);
  return { name, parts, footprint: [W + 2, D + 4], floorY, folkSpots, fires, windows, doors: [{ x: -1.2, z: D2 - T / 2, w: 1.3, h: 2.1 }],
           cobwebs: [{ x: W2 - T, y: H, z: -(D2 - T), sx: -1, sz: 1, d: .5 }] };
}

// ---- the smithy: an 8 x 6m forge open to the street through a wide bay; hearth with its fire and hood,
// anvil on its stump, bellows, quench barrel, tool rack and a stack of iron ----
export function smithy({ name = "Smithy" } = {}) {
  const W = 8, D = 6, H = 3.0, T = .4, F = .15, W2 = W / 2, D2 = D / 2;
  const stone = 0x8e8678, wood = 0x6b4a2c, dark = 0x4a3520, iron = 0x3a3a40, parts = [], folkSpots = [];
  parts.push({ shape: "box", size: [W, .15, D], pos: [0, .075, 0], color: 0x6f6960, pat: "checker", accent: 0x5a554c });
  parts.push({ shape: "hwall", size: { w: W, h: H, t: T, holes: [[-.6, 0, 3.8, 2.6]] }, pos: [0, 0, D2 - T / 2], color: stone, pat: "ashlar" });   // the wide bay, always open
  parts.push({ shape: "box", size: [W, H, T], pos: [0, H / 2, -D2 + T / 2], color: stone, pat: "ashlar" });
  parts.push({ shape: "hwall", size: { w: D, h: H, t: T, holes: [[0, 1.2, 1.1, .9]] }, pos: [-(W2 - T / 2), 0, 0], rot: [0, -90, 0], color: stone, pat: "ashlar" });
  parts.push({ shape: "box", size: [T, H, D], pos: [W2 - T / 2, H / 2, 0], color: stone, pat: "ashlar" });
  const windows = [{ x: -(W2 - T / 2), y: 1.65, z: 0, w: 1.1, h: .9, yaw: 90 }];
  parts.push({ shape: "box", size: [W - 2 * T, .15, D - 2 * T], pos: [0, H + .075, 0], color: dark, pat: "wood" });
  parts.push({ shape: "gable", size: [W + .8, 2.8, D + .9], pos: [0, H + .15, 0], color: 0x6f5a3a, pat: "tiles" });
  // the hearth on the back wall: stone block, coals and the fire on top, a hood narrowing into the chimney
  const hx = 1.6, hz = -D2 + T + .65;
  parts.push({ shape: "box", size: [2.0, .95, 1.3], pos: [hx, F + .475, hz], color: stone, pat: "ashlar" });
  parts.push({ shape: "box", size: [1.4, .1, .8], pos: [hx, F + 1.0, hz], color: 0x1a120c, collide: false });   // the coal bed
  const fires = [{ x: hx, y: F + 1.02, z: hz + .1, r: .2, h: .45 }];
  parts.push({ shape: "box", size: [2.2, .5, 1.5], pos: [hx, F + 2.2, hz], color: stone, pat: "ashlar" });        // hood
  parts.push({ shape: "box", size: [1.0, H + 2.8 - 2.45, 1.0], pos: [hx, F + 2.45 + (H + 2.8 - 2.45) / 2, hz], color: 0x9a5a3c, pat: "brick" });   // chimney through the ridge
  parts.push({ shape: "box", size: [.55, .4, .9], pos: [hx + 1.4, F + .75, hz], color: 0x6a4a3a });               // the bellows
  parts.push({ shape: "box", size: [1.1, .05, .05], pos: [hx + 1.4, F + 1.1, hz + .3], rot: [0, 0, 20], color: wood });
  // the anvil on its stump, mid-room; the smith at it
  const ax = -.4, az = -.3;
  parts.push({ shape: "cyl", size: { r1: .24, r2: .28, h: .6, seg: 8 }, pos: [ax, F + .3, az], color: dark, pat: "wood" });
  parts.push({ shape: "box", size: [.7, .22, .26], pos: [ax, F + .71, az], color: iron });
  parts.push({ shape: "cyl", size: { r1: .02, r2: .1, h: .32, seg: 8 }, pos: [ax + .5, F + .74, az], rot: [0, 0, -90], color: iron });   // the horn
  parts.push({ shape: "box", size: [.12, .05, .3], pos: [ax - .1, F + .85, az], color: 0xc85a20, collide: false });                  // hot iron on the face
  parts.push({ shape: "cyl", size: { r1: .02, r2: .02, h: .4, seg: 6 }, pos: [ax + .2, F + .86, az + .25], rot: [0, 0, 90], color: wood, collide: false });   // hammer
  parts.push({ shape: "box", size: [.09, .06, .1], pos: [ax + .38, F + .87, az + .25], color: iron, collide: false });
  folkSpots.push({ x: ax, y: F, z: az + .9, h: Math.PI / 2, role: "work", gesture: "hammer", tool: "hammer", pose: "stand" });   // the smith, facing the anvil
  // quench barrel, tool rack on the west wall, iron stock and horseshoes
  parts.push({ shape: "cyl", size: { r1: .32, r2: .3, h: .8, seg: 10 }, pos: [-2.6, F + .4, -1.4], color: 0x5a4a3a, pat: "wood" });
  parts.push({ shape: "cyl", size: { r1: .28, r2: .28, h: .02, seg: 10 }, pos: [-2.6, F + .79, -1.4], color: 0x4f6f7a, outline: false });
  parts.push({ shape: "box", size: [.06, .08, 2.6], pos: [-(W2 - T) + .12, F + 1.5, .4], color: wood });
  for (let k = 0; k < 6; k++) {
    parts.push({ shape: "cyl", size: { r1: .015, r2: .015, h: .5, seg: 4 }, pos: [-(W2 - T) + .12, F + 1.2, -.7 + k * .42], color: wood, collide: false });
    parts.push({ shape: "box", size: [.07, .12, .06], pos: [-(W2 - T) + .12, F + .9, -.7 + k * .42], color: iron, collide: false });
  }
  for (let k = 0; k < 5; k++) parts.push({ shape: "box", size: [.05, .05, 1.6], pos: [W2 - T - .3, F + .05 + k * .06, .9 + (k % 2) * .06], color: iron, collide: false });   // bar stock
  for (let k = 0; k < 4; k++) parts.push({ shape: "cyl", size: { r1: .12, r2: .12, h: .03, seg: 8, open: true }, pos: [-1.8 + k * .3, F + .8, 2.1], rot: [90, 0, 0], color: iron, collide: false });   // horseshoes on a board
  parts.push({ shape: "box", size: [1.4, .05, .4], pos: [-1.35, F + .78, 2.1], color: wood, pat: "wood" });
  for (const dx of [-.55, .55]) parts.push({ shape: "box", size: [.08, .75, .3], pos: [-1.35 + dx, F + .375, 2.1], color: wood });
  hangingSign(parts, { x: 2.6, z: D2, dir: 1, color: 0x2e2e34, pat: "stars", accent: 0xc85a20, emblem: "horseshoe" });   // the sign: a horseshoe on an iron-dark board
  folkSpots.push({ x: 1.8, y: F, z: D2 - T - .9, h: Math.PI / 2, pose: "stand" });   // a customer in the bay
  const floorY = (x, z) => (Math.abs(x) <= W2 && Math.abs(z) <= D2 ? F : 0);
  return { name, parts, footprint: [W + 2, D + 2], floorY, folkSpots, fires, windows, doors: [],
           cobwebs: [{ x: -(W2 - T), y: H, z: -(D2 - T), sx: 1, sz: 1, d: .55 }] };
}

// ---- the village church: an 18 x 9m nave with a west tower and spire, round-arched windows, pews and altar.
// Its door is on the -z side (the street), so it stands SOUTH of the street; `front: -1` tells the demo ----
export function villageChurch({ name = "Village church" } = {}) {
  const L = 18, W = 9, H = 5.5, T = .5, F = .2, L2 = L / 2, W2 = W / 2, TW = 4.6, TH = 13;
  const stone = 0x9a917f, roofC = 0x6f4a3a, wood = 0x6b4a2c, dark = 0x4a3520, parts = [], folkSpots = [];
  const xo = TW / 2;   // the nave shifted east so nave + tower center on the footprint
  const P = (p) => { p.pos = [p.pos[0] + xo, p.pos[1], p.pos[2]]; parts.push(p); };
  P({ shape: "box", size: [L, .2, W], pos: [0, .1, 0], color: 0x8b8578, pat: "checker", accent: 0x6f6960 });
  const winHoles = [-5, -1.5, 2, 5.5].map((u) => [u, 1.7, 1.1, 2.4]);
  P({ shape: "hwall", size: { w: L, h: H, t: T, holes: [[-2.5, 0, 1.6, 2.6], ...winHoles.filter((h) => h[0] > -1)] }, pos: [0, 0, -W2 + T / 2], color: stone, pat: "ashlar" });   // the front (street) wall
  P({ shape: "hwall", size: { w: L, h: H, t: T, holes: winHoles }, pos: [0, 0, W2 - T / 2], color: stone, pat: "ashlar" });
  P({ shape: "hwall", size: { w: W, h: H, t: T, holes: [[0, 2.0, 1.4, 2.6]] }, pos: [L2 - T / 2, 0, 0], rot: [0, 90, 0], color: stone, pat: "ashlar" });   // east end, the chancel window
  P({ shape: "box", size: [T, H, W], pos: [-L2 + T / 2, H / 2, 0], color: stone, pat: "ashlar" });                                                        // west end, against the tower
  const windows = [];
  for (const h of winHoles) { if (h[0] > -1) windows.push({ x: h[0] + xo, y: 2.9, z: -W2 + T / 2, w: 1.1, h: 2.4 }); windows.push({ x: h[0] + xo, y: 2.9, z: W2 - T / 2, w: 1.1, h: 2.4 }); }
  windows.push({ x: L2 - T / 2 + xo, y: 3.3, z: 0, w: 1.4, h: 2.6, yaw: 90 });
  P({ shape: "box", size: [L - 2 * T, .2, W - 2 * T], pos: [0, H + .1, 0], color: dark, pat: "wood" });   // boarded ceiling
  P({ shape: "gable", size: [W + 1.2, 3.4, L + .8], pos: [0, H + .2, 0], rot: [0, 90, 0], color: roofC, pat: "tiles" });
  for (const sz of [-1, 1]) P({ shape: "box", size: [L + .6, .35, .4], pos: [0, H + .17, sz * (W2 + .1)], color: stone });   // eaves course
  // the tower at the west end: square, a door to the nave, bell openings, a pyramid spire and a cross
  const tx = -L2 - TW / 2 + .1;
  P({ shape: "box", size: [TW, TH, TW], pos: [tx, TH / 2, 0], color: stone, pat: "ashlar" });
  for (const [dx, dz, r] of [[1, 0, 90], [-1, 0, 90], [0, 1, 0], [0, -1, 0]])   // bell openings on all four faces, and the bell in one
    P({ shape: "box", size: r ? [.1, 1.8, 1.0] : [1.0, 1.8, .1], pos: [tx + dx * (TW / 2 + .02), TH - 1.9, dz * (TW / 2 + .02)], color: 0x1a120c, collide: false });
  P({ shape: "cyl", size: { r1: .26, r2: .38, h: .5, seg: 10 }, pos: [tx, TH - 2.0, -TW / 2 + .35], color: 0x6a5a30, collide: false });
  P({ shape: "cyl", size: { r1: .05, r2: TW * .72, h: 5.5, seg: 4 }, pos: [tx, TH + 2.75, 0], rot: [0, 45, 0], color: roofC, pat: "tiles" });
  P({ shape: "box", size: [.08, 1.2, .08], pos: [tx, TH + 6.0, 0], color: 0xc9a227 });
  P({ shape: "box", size: [.6, .08, .08], pos: [tx, TH + 6.2, 0], color: 0xc9a227 });
  P({ shape: "box", size: [.15, .7, .04], pos: [tx - 1.0, 4.0, -TW / 2 - .02], color: 0x1a120c, collide: false });   // slit window
  P({ shape: "box", size: [.15, .7, .04], pos: [tx - 1.0, 8.0, -TW / 2 - .02], color: 0x1a120c, collide: false });
  // pews: two blocks of five, an aisle between, all facing the altar (+x)
  for (const sz of [-1, 1]) for (let k = 0; k < 5; k++) {
    const px = -5.5 + k * 1.6, pz = sz * 2.3;
    P({ shape: "box", size: [.42, .06, 3.2], pos: [px, F + .47, pz], color: wood, pat: "wood" });          // seat
    P({ shape: "box", size: [.06, .55, 3.2], pos: [px - .22, F + .72, pz], color: wood, pat: "wood" });    // back
    for (const s of [-1, 1]) P({ shape: "box", size: [.44, .44, .08], pos: [px, F + .22, pz + s * 1.56], color: wood });   // ends
    if (k % 2 === 0) for (const dz of [-1.0, .2]) folkSpots.push({ x: px + xo, y: F + .5, z: pz + dz, h: 0, pose: "sit" });
  }
  // the chancel: altar on a step, candles, the cross on the east wall, the priest before it
  P({ shape: "box", size: [3.6, .2, W - 2 * T], pos: [L2 - T - 1.8, F + .1, 0], color: 0x9a9488 });
  P({ shape: "box", size: [1.0, 1.0, 2.2], pos: [L2 - T - 1.2, F + .7, 0], color: stone, pat: "ashlar" });
  P({ shape: "box", size: [1.1, .04, 2.3], pos: [L2 - T - 1.2, F + 1.22, 0], color: 0xf0ead8 });
  for (const dz of [-.8, .8]) {
    P({ shape: "cyl", size: { r1: .05, r2: .06, h: .3, seg: 8 }, pos: [L2 - T - 1.2, F + 1.39, dz], color: 0xc9a227, collide: false });
    P({ shape: "cyl", size: { r1: .02, r2: .02, h: .25, seg: 6 }, pos: [L2 - T - 1.2, F + 1.66, dz], color: 0xf0ead8, collide: false });
  }
  P({ shape: "box", size: [.06, 1.6, .1], pos: [L2 - T - .06, 3.2, 0], color: 0xc9a227, collide: false });
  P({ shape: "box", size: [.06, .1, .9], pos: [L2 - T - .06, 3.5, 0], color: 0xc9a227, collide: false });
  folkSpots.push({ x: L2 - T - 2.6 + xo, y: F + .2, z: 0, h: Math.PI, role: "work", gesture: "bless", pose: "stand" });   // the priest, facing the pews
  const floorY = (x, z) => (Math.abs(x - xo) <= L2 && Math.abs(z) <= W2 ? (x - xo > L2 - T - 3.6 ? F + .2 : F) : 0);
  return { name, parts, footprint: [L + TW + 2, W + 2], floorY, folkSpots, windows, glazed: true, front: -1,   // glazed: a church could pay for glass
           doors: [{ x: -2.5 + xo, z: -W2 + T / 2, w: 1.6, h: 2.6 }],
           cobwebs: [{ x: -L2 + T + xo, y: H, z: -(W2 - T), sx: 1, sz: 1, d: .6 }, { x: L2 - T + xo, y: H, z: W2 - T, sx: -1, sz: -1, d: .5 }] };
}

// ---- the marketplace: a cobbled 14 x 12m square open to the street on its +z side, a market cross in the
// middle and eight awninged stalls round the other three sides, each with its wares and its vendor ----
export function marketplace({ name = "Market" } = {}) {
  const W = 14, D = 12, W2 = W / 2, D2 = D / 2, wood = 0x6b4a2c, parts = [], folkSpots = [];
  parts.push({ shape: "box", size: [W, .1, D], pos: [0, .05, 0], color: 0x8b8578, pat: "checker", accent: 0x777168, collide: false });
  // the market cross: two steps, a column and a gilt cross
  parts.push({ shape: "cyl", size: { r1: 1.1, r2: 1.2, h: .25, seg: 12 }, pos: [0, .225, 0], color: 0x9a9488 });
  parts.push({ shape: "cyl", size: { r1: .7, r2: .8, h: .25, seg: 12 }, pos: [0, .475, 0], color: 0x9a9488 });
  parts.push({ shape: "cyl", size: { r1: .16, r2: .2, h: 2.6, seg: 8 }, pos: [0, 1.9, 0], color: 0x9a917f });
  parts.push({ shape: "box", size: [.1, .9, .1], pos: [0, 3.6, 0], color: 0xc9a227 });
  parts.push({ shape: "box", size: [.5, .1, .1], pos: [0, 3.75, 0], color: 0xc9a227 });
  const top = .95;
  // a stall: counter toward the square, four posts, a striped awning pitched down toward the front, the vendor behind
  const stall = (cx, cz, dir, awn, wares) => {
    const ax = dir[0], az = dir[1], px = ax ? 0 : 1, pz = ax ? 1 : 0;   // px/pz: the stall's width axis
    parts.push({ shape: "box", size: ax ? [.8, .06, 2.4] : [2.4, .06, .8], pos: [cx + ax * .5, top - .03, cz + az * .5], color: wood, pat: "wood" });
    for (const a of [-1, 1]) parts.push({ shape: "box", size: [.08, top - .06, .08], pos: [cx + ax * .5 + px * a * 1.1, (top - .06) / 2, cz + az * .5 + pz * a * 1.1], color: wood });
    for (const a of [-1, 1]) for (const b of [-1, 1]) parts.push({ shape: "cyl", size: { r1: .05, r2: .06, h: 2.3, seg: 6 }, pos: [cx + ax * b * .9 + px * a * 1.3, 1.15, cz + az * b * .9 + pz * a * 1.3], color: wood });
    parts.push({ shape: "box", size: ax ? [2.2, .05, 2.9] : [2.9, .05, 2.2], pos: [cx, 2.35, cz], rot: [14 * az, 0, -14 * ax], color: awn, pat: "grooves", accent: 0xf0ece0, collide: false });
    folkSpots.push({ x: cx - ax * .6, y: .1, z: cz - az * .6, h: Math.atan2(-az, ax), role: "work", gesture: "sell", pose: "stand" });
    wares(cx + ax * .5, top, cz + az * .5, px, pz);
  };
  const W2i = W2 - 1.4, D2i = D2 - 1.4;   // stall centers, 1.4m in from the edge
  const pot = (x, y, z, k) => parts.push({ shape: "cyl", size: k ? { r1: .07, r2: .1, h: .26, seg: 8 } : { r1: .13, r2: .08, h: .1, seg: 10 }, pos: [x, y + (k ? .13 : .05), z], color: k ? 0x4f7a8a : 0xb56b45, collide: false });
  const basket = (x, y, z) => parts.push({ shape: "cyl", size: { r1: .2, r2: .16, h: .16, seg: 10 }, pos: [x, y + .08, z], color: 0xb8965a, collide: false });
  const ball = (x, y, z, r, c) => parts.push({ shape: "sphere", size: { r }, pos: [x, y + r, z], color: c, collide: false, outline: r < .04 ? false : undefined });
  const loaf = (x, y, z, k) => parts.push(k ? { shape: "sphere", size: { r: .1 }, scale: [1.7, .6, .9], pos: [x, y + .06, z], color: 0xb8803e, collide: false }
                                          : { shape: "sphere", size: { r: .12 }, scale: [1, .65, 1], pos: [x, y + .08, z], color: 0xa96f30, collide: false });
  // west side (facing +x): pottery, vegetables, fish
  stall(-W2i, -3.6, [1, 0], 0xb84a3a, (x, y, z) => { for (let k = 0; k < 5; k++) pot(x, y, z - .9 + k * .45, k % 2); });
  stall(-W2i, 0, [1, 0], 0x4a7a4a, (x, y, z) => {
    for (let k = 0; k < 3; k++) ball(x - .15, y, z - .8 + k * .4, .11, 0x86ad62);   // cabbages
    basket(x + .2, y, z + .6); for (let k = 0; k < 5; k++) ball(x + .2 + (k % 3 - 1) * .08, y + .12, z + .6 + (k % 2 - .5) * .1, .045, 0xf0ead8);   // turnips
    for (let k = 0; k < 6; k++) parts.push({ shape: "cyl", size: { r1: .012, r2: .03, h: .2, seg: 6 }, pos: [x + .2, y + .03, z - .8 + k * .09], rot: [0, 0, 90], color: 0xe07818, collide: false, outline: false });   // carrots
  });
  stall(-W2i, 3.6, [1, 0], 0x4a6a9a, (x, y, z) => { for (let k = 0; k < 6; k++) parts.push({ shape: "capsule", size: { r: .045, len: .3 }, pos: [x + (k % 2) * .3 - .15, y + .05, z - 1.0 + k * .4], rot: [0, 0, 90], color: k % 3 ? 0x9aa6ae : 0x7a8a7a, collide: false }); basket(x - .2, y, z + .9); });
  // east side (facing -x): meat, eggs, bread
  stall(W2i, -3.6, [-1, 0], 0x8a3a2a, (x, y, z) => {
    for (const dz of [-.7, .7]) parts.push({ shape: "capsule", size: { r: .1, len: .3 }, pos: [x, 1.85, z + dz], color: 0x8a3a2a, collide: false });   // hams hanging
    parts.push({ shape: "box", size: [.45, .12, .7], pos: [x, y + .06, z], color: 0xa83a30, collide: false });
    for (let k = 0; k < 4; k++) parts.push({ shape: "cyl", size: { r1: .02, r2: .02, h: .22, seg: 6 }, pos: [x + .25, y + .03, z - .6 + k * .12], rot: [0, 0, 90], color: 0x8a3a2a, collide: false, outline: false });   // sausages
  });
  stall(W2i, 0, [-1, 0], 0xe0c890, (x, y, z) => { for (const dz of [-.6, .1, .8]) { basket(x, y, z + dz); for (let k = 0; k < 7; k++) ball(x + (k % 3 - 1) * .07, y + .1, z + dz + (Math.floor(k / 3) - 1) * .07, .028, 0xf2ecd8); } });
  stall(W2i, 3.6, [-1, 0], 0xc9a227, (x, y, z) => { for (let k = 0; k < 6; k++) loaf(x + (k % 2) * .3 - .15, y, z - 1.0 + k * .4, k % 2); });
  // north side (facing +z): fruit, cheese
  stall(-2.2, -D2i, [0, 1], 0xd85a3a, (x, y, z) => {
    basket(x - .6, y, z); for (let k = 0; k < 7; k++) ball(x - .6 + (k % 3 - 1) * .07, y + .1, z + (Math.floor(k / 3) - 1) * .07, .04, 0xc8302a);   // apples
    basket(x + .5, y, z); for (let k = 0; k < 5; k++) ball(x + .5 + (k % 3 - 1) * .07, y + .1, z + (k % 2 - .5) * .08, .04, 0xd8c040);              // pears
    for (let k = 0; k < 5; k++) ball(x - .05 + k * .04, y, z + .25, .012, 0x8a1020);                                                                // cherries
  });
  stall(2.2, -D2i, [0, 1], 0xe8d8a0, (x, y, z) => {
    for (let k = 0; k < 3; k++) parts.push({ shape: "cyl", size: { r1: .17, r2: .17, h: .09, seg: 12 }, pos: [x - .7 + k * .55, y + .045 + (k === 1 ? .09 : 0), z], color: k === 2 ? 0xe8c060 : 0xf0d070, collide: false });
    parts.push({ shape: "wedge", size: [.3, .08, .25], pos: [x + .6, y + .04, z + .1], color: 0xf0c95a, collide: false });
  });
  for (const [x, z, h] of [[-2.5, 1.5, .4], [2.8, -1.2, 2.6], [.5, 3.6, -1.2]]) folkSpots.push({ x, y: .1, z, h, pose: "stand" });   // shoppers
  const floorY = (x, z) => (Math.abs(x) <= W2 && Math.abs(z) <= D2 ? .1 : 0);
  return { name, parts, footprint: [W + 2, D + 2], floorY, folkSpots, doors: [], windows: [] };
}

// ---- enclosures ----------------------------------------------------------------
// Both take WORLD coordinates and are placed by the demo at a site of (0, 0):
// they are open toward the river, so a rectangle of three sides. `blocks`
// lists the bands the wall actually occupies (for tree and people exclusion:
// the footprint would otherwise empty the whole village).
//
// Both stand on land: `land(x, z)` is the signed distance to open water (+ on
// land; the demo's waterSD). fitRing fits the three sides to it. Each outer
// side keeps the dry stretch of its band -- every offset in `band` across the
// line, outward +, at least CLEAR from the water -- that holds its corner
// with the middle side; where the line would run on into the river or a lake
// it stops `pad` short (room for the end tower), the water closing the ring as
// the river does along the open side, and a side whose corner is already wet
// is left out. The middle side keeps its longest dry stretch. A gate slides
// along its side until its works ([before, after] about the gate) fit on the
// stretch, or is left out.
const CLEAR = .5;
function fitRing(segs, land, band, pad, gates, [before, after]) {
  const runsOf = (lo, hi, dry) => {   // the dry stretches of [lo, hi], sampled every .5m
    const n = Math.max(1, Math.ceil((hi - lo) / .5)), at = (i) => lo + (hi - lo) * i / n, rs = [];
    let a = null;
    for (let i = 0; i <= n; i++) {
      if (dry(at(i))) { if (a === null) a = at(i); if (i === n) rs.push([a, hi]); }
      else if (a !== null) { rs.push([a, at(i - 1)]); a = null; }
    }
    return rs;
  };
  const sides = segs.map((sg, i) => {
    const alongX = sg.a[1] === sg.b[1], k = alongX ? 0 : 1;
    const lo = Math.min(sg.a[k], sg.b[k]), hi = Math.max(sg.a[k], sg.b[k]);
    const c = alongX ? sg.a[1] : sg.a[0], o = alongX ? sg.out[1] : sg.out[0];
    const dry = (u) => band.every((off) => land(...(alongX ? [u, c + o * off] : [c + o * off, u])) >= CLEAR);
    return { ...sg, alongX, lo, hi, c, dry, corners: [sg.a[k], sg.b[k]], rs: runsOf(lo, hi, dry), middle: i === 1 };
  });
  for (const sd of sides.filter((q) => !q.middle)) {   // an outer side: from its corner with the middle side toward the open water
    const corner = sd === sides[0] ? sd.corners[1] : sd.corners[0], atLo = corner === sd.lo;
    const r = sd.rs.find((q) => (atLo ? q[0] === sd.lo : q[1] === sd.hi));
    sd.span = r && (atLo ? [sd.lo, r[1] - pad] : [r[0] + pad, sd.hi]);
  }
  const mid = sides[1], joined = [sides[0].span ? mid.corners[0] : null, sides[2].span ? mid.corners[1] : null];
  const best = mid.rs.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
  mid.span = best && best.map((e, j) => (joined.includes(e) ? e : e + (j ? -pad : pad)));   // a free end leaves room for its tower
  return sides.filter((sd) => sd.span && sd.span[1] - sd.span[0] > 2 * pad).map((sd) => {
    const [lo, hi] = sd.span;
    const gs = gates.filter((g) => g.side === sd.side).map((g) => Math.min(Math.max(g.at, lo + before), hi - after)).filter((g) => g - before >= lo - 1e-6);
    return { ...sd, lo, hi, gs: gs.sort((a, b) => a - b) };
  });
}

// A curtain wall in stone, 4.5m to a walkway you can patrol: parapet with
// merlons on the outside, a kerb inside, towers projecting outward every
// ~40m and at the corners, gatehouses (arched passage between two taller
// towers) where the street crosses, with a solid stair up beside each gate.
export function stoneWall({ name = "Town wall", x0, x1, zS, zN0, zN1, gates = [], every = 40, land = () => 1e9 } = {}) {
  const H = 4.5, T = 1.8, stone = 0x8e8678, dark = 0x746c60, timber = 0x5b4326, parts = [], walks = [], stairs = [], blocks = [], towers = [], lookouts = [], guards = [];
  const segs = [{ a: [x0, zN0], b: [x0, zS], out: [-1, 0], side: "w" }, { a: [x0, zS], b: [x1, zS], out: [0, 1], side: "s" }, { a: [x1, zS], b: [x1, zN1], out: [1, 0], side: "e" }];
  const tower = ([px, pz], out, h) => {
    if (towers.some(([qx, qz]) => Math.hypot(qx - px, qz - pz) < 3)) return;
    towers.push([px, pz]);
    const cx = px + out[0] * 2.6, cz = pz + out[1] * 2.6;   // projecting outward from the parapet line
    lookouts.push([cx, h + 3.6, cz]);   // a view from the top (just over the roof's peak): for the palace's paintings
    parts.push({ shape: "box", size: [4, h + 2, 4], pos: [cx, (h - 2) / 2, cz], color: stone, pat: "ashlar" });   // (2m below grade: nothing floats over a dip)
    for (const [sx, sz] of [[2.05, 0], [-2.05, 0], [0, 2.05], [0, -2.05]])
      parts.push({ shape: "box", size: sx ? [.3, .5, 4.4] : [4.4, .5, .3], pos: [cx + sx, h + .25, cz + sz], color: stone });   // the crown's merlon rim
    parts.push({ shape: "cyl", size: { r1: .05, r2: 2.95, h: 2.6, seg: 4 }, pos: [cx, h + 1.7, cz], rot: [0, 45, 0], color: 0x6f4a3a, pat: "tiles" });   // pyramid roof
    for (const y of [h * .4, h * .72]) parts.push({ shape: "box", size: out[0] ? [.04, .8, .16] : [.16, .8, .04], pos: [cx + out[0] * 2.02, y, cz + out[1] * 2.02], color: 0x1a120c, collide: false });   // arrow slits
  };
  // across the band, outward +: the stair's inner edge .. the towers' roofs; along: an end tower's half; about a gate: its towers .. the stair's landing
  for (const sg of fitRing(segs, land, [-(T / 2 + 1.4), -1, 0, 1, 2.5, 4, 2.6 + 3], 2.3, gates, [7.5, 15.5])) {
    const { alongX, lo, hi, c, gs } = sg;                       // the side as fitted to the land: c its fixed coordinate, lo..hi its span
    const P = (u, off, y) => (alongX ? [u, y, c + off] : [c + off, y, u]);   // world position from along/offset
    const S = (len, h, t) => (alongX ? [len, h, t] : [t, h, len]);
    const o = alongX ? sg.out[1] : sg.out[0];                   // outward sign
    // a timber handrail along the walk's inner edge (posts every 2m), broken where a stair's landing arrives
    const rails = (u0, u1, skip) => {
      const spans = skip && skip[0] < u1 && skip[1] > u0 ? [[u0, skip[0]], [skip[1], u1]] : [[u0, u1]];
      for (const [a, b] of spans) {
        if (b - a < .3) continue;
        parts.push({ shape: "box", size: S(b - a, .07, .07), pos: P((a + b) / 2, -o * .8, H + 1.0), color: timber });   // (solid: the rail is what keeps you on the walk)
        for (let v = a + .15; v < b; v += 2.0) parts.push({ shape: "box", size: [.1, 1.0, .1], pos: P(Math.min(v, b - .15), -o * .8, H + .5), color: timber });
        parts.push({ shape: "box", size: [.1, 1.0, .1], pos: P(b - .15, -o * .8, H + .5), color: timber });
      }
    };
    const body = (u0, u1, skip) => {
      if (u1 - u0 < .2) return;
      const len = u1 - u0, m = (u0 + u1) / 2;
      parts.push({ shape: "box", size: S(len, H + 2, T), pos: P(m, 0, (H - 2) / 2), color: stone, pat: "ashlar" });
      parts.push({ shape: "box", size: S(len, .9, .3), pos: P(m, o * .75, H + .45), color: stone, pat: "ashlar" });          // parapet
      for (let v = u0 + .6; v < u1 - .4; v += 1.4) parts.push({ shape: "box", size: S(.7, .5, .3), pos: P(v, o * .75, H + 1.15), color: stone });   // merlons
      rails(u0, u1, skip);
      walks.push(alongX ? { x0: u0, x1: u1, z0: c - T / 2, z1: c + T / 2 } : { x0: c - T / 2, x1: c + T / 2, z0: u0, z1: u1 });
    };
    let u = lo, skip = null;
    for (const g of gs) {
      body(u, g - 3, skip);
      // the gate: piers, the arch over a 4.4m passage, walkway and parapet continuing above, two taller towers, a stair inside
      for (const s of [-1, 1]) parts.push({ shape: "box", size: S(.8, 4.3, T), pos: P(g + s * 2.6, 0, .15), color: stone, pat: "ashlar" });
      parts.push({ shape: "spandrel", size: { w: 6, h: H - 2.3, r: 2.2, t: T }, pos: P(g, 0, 2.3), rot: [0, alongX ? 0 : 90, 0], color: stone, pat: "ashlar" });
      parts.push({ shape: "box", size: S(6, .9, .3), pos: P(g, o * .75, H + .45), color: stone, pat: "ashlar" });
      for (let v = g - 2.4; v <= g + 2.4; v += 1.2) parts.push({ shape: "box", size: S(.7, .5, .3), pos: P(v, o * .75, H + 1.15), color: stone });
      rails(g - 3, g + 3);
      walks.push(alongX ? { x0: g - 3, x1: g + 3, z0: c - T / 2, z1: c + T / 2 } : { x0: c - T / 2, x1: c + T / 2, z0: g - 3, z1: g + 3 });
      for (const s of [-1, 1]) tower(alongX ? [g + s * 5.3, c] : [c, g + s * 5.3], sg.out, 11);
      // the watch (a gate's `guards`: their arms, one to each side): outside the passage, flanking its mouth, facing out
      const gate = gates.filter((q) => q.side === sg.side).sort((a, b) => Math.abs(a.at - g) - Math.abs(b.at - g))[0];
      (gate?.guards ?? []).forEach((arms, i) => {
        const [x, , z] = P(g + (i % 2 ? 1.8 : -1.8), o * (T / 2 + .9), 0);
        guards.push({ x, z, h: Math.atan2(-sg.out[1], sg.out[0]), arms });   // (h: a person's heading, forward = (cos h, 0, -sin h))
      });
      // the stair: 18 solid steps of .25 rising along the inner face, starting 8m past the gate, a 1.4m
      // landing at the top level with the walkway, and a timber handrail down the open side
      const s0 = g + 8, n = 18, run = .32, ins = -o * (T / 2 + .7), L = run * n;
      for (let k = 0; k < n; k++) parts.push({ shape: "box", size: S(run, .25 * (k + 1) + 2, 1.3), pos: P(s0 + run * (k + .5), ins, .125 * (k + 1) - 1), color: dark, pat: "ashlar" });
      parts.push({ shape: "box", size: S(1.4, H + 2, 1.3), pos: P(s0 + L + .7, ins, (H - 2) / 2), color: dark, pat: "ashlar" });   // the landing block
      const rail = -o * .62, ang = Math.atan2(H, L) * 180 / Math.PI, wood = timber;
      for (let k = 0; k <= n; k += 3) parts.push({ shape: "box", size: [.1, 1.0, .1], pos: P(s0 + run * Math.min(k, n - .5), ins + rail, .25 * k + .5), color: wood });
      parts.push({ shape: "box", size: S(Math.hypot(L, H), .07, .07), pos: P(s0 + L / 2, ins + rail, H / 2 + 1.0), rot: alongX ? [0, 0, ang] : [-ang, 0, 0], color: wood, collide: false });   // the sloped handrail (pitched: never a collider)
      for (let k = 0; k < 6; k++)   // ...so its solidity comes from six unseen level stand-ins stepping up under it, one per three steps
        parts.push({ shape: "box", size: S(L / 6, .07, .07), pos: P(s0 + L * (k + .5) / 6, ins + rail, H * (k + .5) / 6 + 1.0), color: wood, render: false });
      for (let k = 0; k <= 1; k++) parts.push({ shape: "box", size: [.1, 1.0, .1], pos: P(s0 + L + .2 + k * 1.0, ins + rail, H + .5), color: wood });
      parts.push({ shape: "box", size: S(1.5, .07, .07), pos: P(s0 + L + .7, ins + rail, H + 1.0), color: wood });   // rail round the landing's open side
      parts.push({ shape: "box", size: S(.07, .07, 1.3), pos: P(s0 + L + 1.4, ins, H + 1.0), color: wood });          // and its end
      stairs.push({ alongX, c: c + ins, u0: s0, u1: s0 + L + 1.4, n, L });
      u = g + 3; skip = [s0 + L - .1, s0 + L + 1.5];   // the next stretch's handrail leaves the landing open
    }
    body(u, hi, skip);
    const nT = Math.max(1, Math.round((hi - lo) / every));
    for (let k = 0; k <= nT; k++) { const v = lo + (hi - lo) * k / nT; if (!gs.some((g) => Math.abs(g - v) < 9)) tower(alongX ? [v, c] : [c, v], sg.out, 9); }
    blocks.push(alongX ? { x0: lo - 3, x1: hi + 3, z0: c - 3, z1: c + 7.5 } : { x0: c - (o < 0 ? 7.5 : 3), x1: c + (o < 0 ? 3 : 7.5), z0: lo - 3, z1: hi + 3 });
  }
  const floorY = (x, z) => {
    const lv = [];
    for (const w of walks) if (x >= w.x0 - .1 && x <= w.x1 + .1 && z >= w.z0 - .1 && z <= w.z1 + .1) { lv.push(H); break; }
    for (const s of stairs) {
      const u = s.alongX ? x : z, v = s.alongX ? z : x;
      if (Math.abs(v - s.c) <= .7 && u >= s.u0 - .05 && u <= s.u1 + .05) lv.push(Math.min(H, Math.ceil(Math.max(0, u - s.u0) / s.L * s.n) * .25));   // steps, then the landing at H
    }
    return lv;
  };
  const span = Math.max(Math.abs(x0), Math.abs(x1)), spanZ = Math.max(Math.abs(zS), Math.abs(zN0), Math.abs(zN1));
  return { name, parts, footprint: [2 * span + 12, 2 * spanZ + 12], floorY, blocks, lookouts, guards, doors: [], windows: [], enclosure: true };   // enclosure: roofless -- its footprint is the whole town; guards: world x, z, heading, arms
}

// A timber palisade, 4m of sharpened logs on a rail, with post-frame towers
// (platform, cabin, hip roof) at the corners and every ~35m, and gatehouses
// -- a gallery over the passage between two towers -- where roads cross.
// The towers stand INSIDE the line, hard against it: the watch looks out
// over the stakes, and the ladder and hatch face the yard, so a tower is
// climbed from within the village.
export function palisade({ name = "Palisade", x0, x1, zN, zS0, zS1, gates = [], every = 35, land = () => 1e9 } = {}) {
  const H = 4.0, wood = 0x6b4a2c, dark = 0x4a3520, parts = [], blocks = [], towers = [], plats = [], lifts = [], lookouts = [];
  const segs = [{ a: [x0, zS0], b: [x0, zN], out: [-1, 0], side: "w" }, { a: [x0, zN], b: [x1, zN], out: [0, -1], side: "n" }, { a: [x1, zN], b: [x1, zS1], out: [1, 0], side: "e" }];
  const tower = ([px, pz], out, h = 7) => {
    if (towers.some(([qx, qz]) => Math.hypot(qx - px, qz - pz) < 3)) return;
    towers.push([px, pz]);
    const cx = px - out[0] * 2.3, cz = pz - out[1] * 2.3;   // wholly INSIDE the line of logs, hard against it
    lookouts.push([cx, h + 2.2, cz]);   // a view from over its roof
    const pfY = h - 2.3 + .075;                             // the platform top: the watch stands here
    for (const a of [-1, 1]) for (const b of [-1, 1]) parts.push({ shape: "cyl", size: { r1: .15, r2: .17, h: h + 2, seg: 6 }, pos: [cx + a * 1.55, (h - 2) / 2, cz + b * 1.55], color: dark });   // posts sunk 2m
    parts.push({ shape: "box", size: [3.5, .15, 3.5], pos: [cx, h - 2.3, cz], color: wood, pat: "wood", collide: false });      // platform
    // the cabin: four boarded walls, a lookout opening in each, a hatchway in the one facing the yard where the ladder comes up
    for (const [sx, sz] of [[1.7, 0], [-1.7, 0], [0, 1.7], [0, -1.7]]) {
      const inner = Math.abs(sx + out[0] * 1.7) < .01 && Math.abs(sz + out[1] * 1.7) < .01;
      parts.push({ shape: "hwall", size: { w: 3.5, h: 2.0, t: .1, holes: inner ? [[0, 0, .9, 1.7]] : [[0, .9, 1.4, .7]] }, pos: [cx + sx, pfY, cz + sz], rot: [0, sx ? 90 : 0, 0], color: wood, pat: "wood" });
    }
    parts.push({ shape: "cyl", size: { r1: .05, r2: 2.9, h: 1.6, seg: 4 }, pos: [cx, h + .6, cz], rot: [0, 45, 0], color: 0x7a5a3a, pat: "wood" });   // hip roof
    // the ladder up the yard side: two stiles and rungs from the ground to the hatch
    const lx = cx - out[0] * 1.85, lz = cz - out[1] * 1.85;
    for (const s of [-1, 1]) parts.push({ shape: "box", size: out[0] ? [.06, pfY + .3, .06] : [.06, pfY + .3, .06], pos: [lx + (out[0] ? 0 : s * .25), (pfY + .3) / 2, lz + (out[0] ? s * .25 : 0)], color: dark, collide: false });
    for (let k = 0; k < Math.floor(pfY / .35); k++) parts.push({ shape: "box", size: out[0] ? [.04, .04, .5] : [.5, .04, .04], pos: [lx, .35 + k * .35, lz], color: dark, collide: false });
    plats.push({ x: cx, z: cz, y: pfY });
    lifts.push({ bx: cx - out[0] * 2.5, bz: cz - out[1] * 2.5, by: 0,   // at the ladder's foot, in the yard
                  tx: cx, tz: cz, ty: pfY, up: "climb the ladder", down: "climb down the ladder", rad: 2.0 });
  };
  // across the band, outward +: the towers' roofs and the ladders' feet (inside) .. the gallery's gable; along: an end tower's half; about a gate: its towers
  for (const sg of fitRing(segs, land, [-(2.3 + 2.95), -4, -2.5, -1, 0, 1.5], 2.3, gates, [7.3, 7.3])) {
    const { alongX, lo, hi, c, gs } = sg;
    const P = (u, off, y) => (alongX ? [u, y, c + off] : [c + off, y, u]);
    const S = (len, h, t) => (alongX ? [len, h, t] : [t, h, len]);
    const o = alongX ? sg.out[1] : sg.out[0];
    const body = (u0, u1) => {
      if (u1 - u0 < .2) return;
      const len = u1 - u0, m = (u0 + u1) / 2;
      parts.push({ shape: "box", size: S(len, H + 2, .4), pos: P(m, 0, (H - 2) / 2), color: wood, pat: "wood" });        // the log wall, sunk 2m so no dip shows under it
      for (let v = u0 + .2; v < u1; v += .42) parts.push({ shape: "cyl", size: { r1: .03, r2: .2, h: .6, seg: 6 }, pos: P(v, 0, H + .28), color: dark, collide: false, outline: false });   // sharpened tops
      for (let v = u0 + 1; v < u1; v += 2.4) parts.push({ shape: "cyl", size: { r1: .16, r2: .18, h: H + 1.7, seg: 6 }, pos: P(v, -o * .35, (H - 2.3) / 2), color: dark });   // inner posts
      parts.push({ shape: "box", size: S(len, .14, .12), pos: P(m, -o * .33, 2.7), color: dark, collide: false });        // the rail binding them
    };
    let u = lo;
    for (const g of gs) {
      body(u, g - 2.6);
      for (const s of [-1, 1]) parts.push({ shape: "cyl", size: { r1: .26, r2: .3, h: 8.6, seg: 8 }, pos: P(g + s * 2.75, 0, 2.3), color: dark });   // gate posts
      parts.push({ shape: "box", size: S(6.4, 1.7, 2.4), pos: P(g, 0, 5.35), color: wood, pat: "wood" });                                                  // the gallery over the passage
      parts.push({ shape: "gable", size: alongX ? [6.9, 1.3, 3.0] : [3.0, 1.3, 6.9], pos: P(g, 0, 6.2), color: 0x7a5a3a, pat: "wood" });
      for (const s of [-1, 1]) parts.push({ shape: "box", size: alongX ? [.9, .5, .04] : [.04, .5, .9], pos: P(g + s * 1.6, o * 1.22, 5.4), color: 0x1a120c, collide: false });   // gallery slots
      for (const s of [-1, 1]) tower(alongX ? [g + s * 5.2, c] : [c, g + s * 5.2], sg.out, 7.5);
      u = g + 2.6;
    }
    body(u, hi);
    const nT = Math.max(1, Math.round((hi - lo) / every));
    for (let k = 0; k <= nT; k++) { const v = lo + (hi - lo) * k / nT; if (!gs.some((g) => Math.abs(g - v) < 8)) tower(alongX ? [v, c] : [c, v], sg.out); }
    const b0 = c + Math.min(o * 2.5, -o * 6), b1 = c + Math.max(o * 2.5, -o * 6);   // 2.5m outside the line, 6m in (the towers and their ladders)
    blocks.push(alongX ? { x0: lo - 2.5, x1: hi + 2.5, z0: b0, z1: b1 } : { x0: b0, x1: b1, z0: lo - 2.5, z1: hi + 2.5 });
  }
  const span = Math.max(Math.abs(x0), Math.abs(x1)), spanZ = Math.max(Math.abs(zN), Math.abs(zS0), Math.abs(zS1));
  const floorY = (x, z) => { const lv = []; for (const p of plats) if (Math.abs(x - p.x) <= 1.75 && Math.abs(z - p.z) <= 1.75) lv.push(p.y); return lv; };
  return { name, parts, footprint: [2 * span + 12, 2 * spanZ + 12], floorY, blocks, lifts, lookouts, doors: [], windows: [], enclosure: true };   // enclosure: roofless -- its footprint is the whole village
}

// ---- the weaver's: a 7 x 6m workshop with the door on the STREET (-z) side, so it stands south of the
// street (`front: -1`). A treadle loom with its warp running back to the beam and the cloth rolling up in
// front, the weaver on the bench; a spinning wheel with the spinner; baskets of wool, shelves of dyed
// bolts, and dyed cloth drying on a line along the west side ----
export function weaver({ name = "Weaver's" } = {}) {
  const W = 7, D = 6, H = 2.8, T = .35, F = .15, W2 = W / 2, D2 = D / 2;
  const stone = 0x9a917f, wood = 0x6b4a2c, dark = 0x4a3520, cream = 0xe8dcc0, parts = [], folkSpots = [];
  const DYES = [0x8a3a2a, 0x35507a, 0xc8a83a, 0xe3d8c0, 0x4f6a3a, 0x6a4a2c];   // madder, woad, weld, undyed, green, walnut
  parts.push({ shape: "box", size: [W, .15, D], pos: [0, .075, 0], color: 0x7a6a4a, pat: "wood" });
  parts.push({ shape: "hwall", size: { w: W, h: H, t: T, holes: [[-1.5, 0, 1.3, 2.1], [1.6, 1.1, 1.2, 1.0]] }, pos: [0, 0, -(D2 - T / 2)], color: stone, pat: "ashlar" });   // the street front
  parts.push({ shape: "box", size: [W, H, T], pos: [0, H / 2, D2 - T / 2], color: stone, pat: "ashlar" });
  parts.push({ shape: "hwall", size: { w: D, h: H, t: T, holes: [[.3, 1.1, 1.0, 1.0]] }, pos: [-(W2 - T / 2), 0, 0], rot: [0, -90, 0], color: stone, pat: "ashlar" });
  parts.push({ shape: "box", size: [T, H, D], pos: [W2 - T / 2, H / 2, 0], color: stone, pat: "ashlar" });
  const windows = [{ x: 1.6, y: 1.6, z: -(D2 - T / 2), w: 1.2, h: 1.0 }, { x: -(W2 - T / 2), y: 1.6, z: .3, w: 1.0, h: 1.0, yaw: 90 }];
  parts.push({ shape: "box", size: [W - 2 * T, .15, D - 2 * T], pos: [0, H + .075, 0], color: dark, pat: "wood" });
  parts.push({ shape: "gable", size: [W + .8, 2.6, D + .9], pos: [0, H + .15, 0], color: 0x6f5a3a, pat: "tiles" });
  // the loom: four posts and rails, the warp beam high at the back, the cloth beam low in front, the warp
  // sloping between them through the heddle frame and the beater; the weaver on the bench facing it
  const kx = 1.0, kz = .7;
  for (const a of [-1, 1]) for (const b of [-1, 1]) parts.push({ shape: "box", size: [.1, 1.7, .1], pos: [kx + a * .95, F + .85, kz + b * 1.0], color: dark });
  for (const a of [-1, 1]) for (const y of [.45, 1.62]) parts.push({ shape: "box", size: [.08, .08, 2.0], pos: [kx + a * .95, F + y, kz], color: dark });
  parts.push({ shape: "cyl", size: { r1: .08, r2: .08, h: 1.9, seg: 8 }, pos: [kx, F + 1.45, kz + 1.0], rot: [0, 0, 90], color: wood });   // warp beam
  parts.push({ shape: "cyl", size: { r1: .09, r2: .09, h: 1.9, seg: 8 }, pos: [kx, F + .85, kz - 1.0], rot: [0, 0, 90], color: wood });   // cloth beam
  parts.push({ shape: "cyl", size: { r1: .15, r2: .15, h: 1.6, seg: 10 }, pos: [kx, F + .85, kz - 1.0], rot: [0, 0, 90], color: DYES[0], collide: false });   // the woven cloth rolled on it
  const slope = -Math.atan2(1.45 - .9, 2.0) * 180 / Math.PI;   // (a negative x rotation lifts the +z end)
  for (let k = 0; k < 15; k++) parts.push({ shape: "box", size: [.014, .012, 2.05], pos: [kx - .77 + k * .11, F + 1.175, kz], rot: [slope, 0, 0], color: cream, collide: false, outline: false });   // the warp
  parts.push({ shape: "box", size: [1.7, .5, .035], pos: [kx, F + 1.25, kz + .25], color: dark, collide: false });    // heddle frame
  parts.push({ shape: "box", size: [1.75, .35, .05], pos: [kx, F + 1.1, kz - .35], rot: [12, 0, 0], color: wood, collide: false });   // the beater
  parts.push({ shape: "box", size: [1.6, .02, .5], pos: [kx, F + .96, kz - .7], rot: [slope, 0, 0], color: DYES[0], collide: false, outline: false });   // cloth on its way to the beam
  for (const a of [-1, 1]) parts.push({ shape: "box", size: [.5, .04, .14], pos: [kx + a * .3, F + .12, kz - .2], rot: [0, 0, a * 8], color: wood, collide: false });   // treadles
  parts.push({ shape: "box", size: [1.0, .06, .35], pos: [kx, F + .47, kz - 1.55], color: wood });   // the bench
  for (const a of [-1, 1]) parts.push({ shape: "box", size: [.07, .44, .3], pos: [kx + a * .42, F + .22, kz - 1.55], color: wood });
  folkSpots.push({ x: kx, y: F + .5, z: kz - 1.55, h: -Math.PI / 2, role: "work", gesture: "weave", pose: "sit" });   // the weaver, facing the loom (+z)
  // the spinning wheel: rim, hub and spokes standing on a bench with the flyer, the spinner on a stool
  const sx = -1.9, sz = -.2;
  parts.push({ shape: "box", size: [1.0, .05, .3], pos: [sx, F + .55, sz], color: wood, pat: "wood" });
  for (const a of [-.4, .4]) parts.push({ shape: "box", size: [.06, .52, .06], pos: [sx + a, F + .26, sz], color: wood });
  parts.push({ shape: "cyl", size: { r1: .4, r2: .4, h: .05, seg: 16, open: true }, pos: [sx + .2, F + 1.0, sz], rot: [90, 0, 0], color: dark, collide: false });   // the rim
  parts.push({ shape: "cyl", size: { r1: .05, r2: .05, h: .1, seg: 8 }, pos: [sx + .2, F + 1.0, sz], rot: [90, 0, 0], color: dark, collide: false });
  for (let k = 0; k < 4; k++) parts.push({ shape: "box", size: [.02, .78, .02], pos: [sx + .2, F + 1.0, sz], rot: [0, 0, k * 45], color: dark, collide: false });   // spokes
  parts.push({ shape: "box", size: [.06, .45, .06], pos: [sx + .2, F + .8, sz], color: wood, collide: false });   // the upright
  parts.push({ shape: "cyl", size: { r1: .05, r2: .07, h: .18, seg: 8 }, pos: [sx - .35, F + .75, sz], rot: [0, 0, 90], color: cream, collide: false });   // the flyer's bobbin
  parts.push({ shape: "box", size: [.06, .2, .06], pos: [sx - .35, F + .65, sz], color: wood, collide: false });
  parts.push({ shape: "box", size: [.4, .04, .4], pos: [sx - .3, F + .45, sz + 1.0], color: wood });   // the stool
  for (const [a, b] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) parts.push({ shape: "box", size: [.05, .43, .05], pos: [sx - .3 + a * .15, F + .215, sz + 1.0 + b * .15], color: wood, collide: false });
  folkSpots.push({ x: sx - .3, y: F + .47, z: sz + 1.0, h: Math.PI / 2, role: "work", gesture: "weave", pose: "sit" });   // the spinner, facing the wheel (-z)
  for (const [bx, bz] of [[-2.4, 2.0], [-1.6, 2.2]]) {   // baskets of wool
    parts.push({ shape: "cyl", size: { r1: .28, r2: .24, h: .32, seg: 10 }, pos: [bx, F + .16, bz], color: 0x9a7a4a, collide: false });
    parts.push({ shape: "sphere", size: { r: .26 }, scale: [1, .55, 1], pos: [bx, F + .36, bz], color: 0xf0e8d8, collide: false });
  }
  // shelves of dyed bolts along the east wall
  const shx = W2 - T - .24;
  for (const [i, y] of [.55, 1.1, 1.65].entries()) {
    parts.push({ shape: "box", size: [.46, .04, 4.6], pos: [shx, F + y, 0], color: wood, pat: "wood" });
    for (let k = 0; k < 7; k++) parts.push({ shape: "cyl", size: { r1: .09, r2: .09, h: .44, seg: 8 }, pos: [shx, F + y + .11, -1.95 + k * .65], rot: [0, 0, 90], color: DYES[(k + i * 2) % DYES.length], collide: false });
  }
  for (const a of [-1, 1]) parts.push({ shape: "box", size: [.06, 1.8, .06], pos: [shx - .2, F + .95, a * 2.4], color: wood });
  // the drying line along the west side: two posts, a rope, three cloths
  const lx = -W2 - 1.1;
  for (const a of [-1, 1]) parts.push({ shape: "box", size: [.1, 2.3, .1], pos: [lx, 1.15, a * 1.6], color: dark });
  parts.push({ shape: "box", size: [.02, .02, 3.3], pos: [lx, 2.15, 0], color: 0xc8b898, collide: false, outline: false });
  for (const [k, z] of [-1.0, 0, 1.0].entries()) parts.push({ shape: "box", size: [.03, .95, .75], pos: [lx, 1.65, z], color: DYES[k], collide: false });
  hangingSign(parts, { x: .2, z: -D2, dir: -1, color: DYES[1], pat: "checker", accent: 0x4a6a9a, emblem: "shuttle" });   // the sign: a shuttle on a woven blue board
  folkSpots.push({ x: 1.6, y: F, z: -(D2 - T) + 1.0, h: -Math.PI / 2, pose: "stand" });   // a customer inside the door, looking in
  const floorY = (x, z) => (Math.abs(x) <= W2 && Math.abs(z) <= D2 ? F : 0);
  return { name, parts, footprint: [W + 4, D + 2], floorY, folkSpots, windows, front: -1, doors: [{ x: -1.5, z: -(D2 - T / 2), w: 1.3, h: 2.1 }],
           cobwebs: [{ x: W2 - T, y: H, z: D2 - T, sx: -1, sz: -1, d: .5 }] };
}

// ---- the tailor's: a 7 x 6m shop, door and a wide shop window on the street (-z, `front: -1`). A cutting
// table with cloth and shears mid-room, the tailor at it; a dress form; a rail of finished tunics along the
// back wall; shelves of folded cloth; a counter under the window with a customer before it ----
export function tailor({ name = "Tailor's" } = {}) {
  const W = 7, D = 6, H = 2.8, T = .35, F = .15, W2 = W / 2, D2 = D / 2;
  const stone = 0x9a917f, wood = 0x6b4a2c, dark = 0x4a3520, iron = 0x3a3a40, parts = [], folkSpots = [];
  const CLOTH = [0x35507a, 0x8a3a2a, 0x4f6a3a, 0xc8a83a, 0xe3d8c0, 0x5a3a5a];
  parts.push({ shape: "box", size: [W, .15, D], pos: [0, .075, 0], color: 0x7a6a4a, pat: "wood" });
  parts.push({ shape: "hwall", size: { w: W, h: H, t: T, holes: [[1.5, 0, 1.3, 2.1], [-1.4, .9, 1.8, 1.3]] }, pos: [0, 0, -(D2 - T / 2)], color: stone, pat: "ashlar" });   // the street front: door and shop window
  parts.push({ shape: "box", size: [W, H, T], pos: [0, H / 2, D2 - T / 2], color: stone, pat: "ashlar" });
  parts.push({ shape: "box", size: [T, H, D], pos: [-(W2 - T / 2), H / 2, 0], color: stone, pat: "ashlar" });
  parts.push({ shape: "hwall", size: { w: D, h: H, t: T, holes: [[.3, 1.1, 1.0, 1.0]] }, pos: [W2 - T / 2, 0, 0], rot: [0, 90, 0], color: stone, pat: "ashlar" });
  const windows = [{ x: -1.4, y: 1.55, z: -(D2 - T / 2), w: 1.8, h: 1.3 }, { x: W2 - T / 2, y: 1.6, z: .3, w: 1.0, h: 1.0, yaw: 90 }];
  parts.push({ shape: "box", size: [W - 2 * T, .15, D - 2 * T], pos: [0, H + .075, 0], color: dark, pat: "wood" });
  parts.push({ shape: "gable", size: [W + .8, 2.6, D + .9], pos: [0, H + .15, 0], color: 0x7a4f3a, pat: "tiles" });
  // the cutting table mid-room with a length of cloth spread on it, shears and a folded pile; the tailor behind it
  const tx = -.2, tz = .5;
  parts.push({ shape: "box", size: [2.3, .06, 1.05], pos: [tx, F + .82, tz], color: wood, pat: "wood" });
  for (const [a, b] of [[-1, -1], [1, 1], [-1, 1], [1, -1]]) parts.push({ shape: "box", size: [.08, .8, .08], pos: [tx + a * 1.05, F + .4, tz + b * .44], color: wood, collide: false });
  parts.push({ shape: "box", size: [1.7, .025, .85], pos: [tx - .15, F + .865, tz], color: CLOTH[0], collide: false, outline: false });
  for (const a of [-1, 1]) parts.push({ shape: "box", size: [.34, .015, .04], pos: [tx + .75, F + .885, tz - .25], rot: [0, a * 22, 0], color: iron, collide: false, outline: false });   // the shears
  for (let k = 0; k < 3; k++) parts.push({ shape: "box", size: [.5, .07, .38], pos: [tx + .75, F + .89 + k * .07, tz + .25], color: CLOTH[k + 1], collide: false });
  folkSpots.push({ x: tx, y: F, z: tz + 1.15, h: Math.PI / 2, role: "work", gesture: "sew", pose: "stand" });   // the tailor, facing the table (and the street beyond)
  // the dress form: a tunic on a padded torso on its post
  const dx = 2.3, dz = 1.0;
  parts.push({ shape: "cyl", size: { r1: .32, r2: .32, h: .05, seg: 10 }, pos: [dx, F + .025, dz], color: dark, collide: false });
  parts.push({ shape: "box", size: [.06, 1.0, .06], pos: [dx, F + .55, dz], color: dark, collide: false });
  parts.push({ shape: "cyl", size: { r1: .17, r2: .21, h: .6, seg: 10 }, pos: [dx, F + 1.3, dz], color: CLOTH[1], collide: false });
  parts.push({ shape: "sphere", size: { r: .07 }, pos: [dx, F + 1.66, dz], color: 0x9a8a6a, collide: false });
  // a rail of finished tunics along the back wall
  parts.push({ shape: "box", size: [4.6, .04, .04], pos: [0, F + 2.1, D2 - T - .32], color: wood });
  for (const a of [-1, 1]) parts.push({ shape: "box", size: [.05, .05, .35], pos: [a * 2.2, F + 2.1, D2 - T - .17], color: dark, collide: false });
  for (let k = 0; k < 6; k++) {
    const x = -2.0 + k * .8, c = CLOTH[(k + 2) % CLOTH.length];
    parts.push({ shape: "box", size: [.5, .8, .12], pos: [x, F + 1.65, D2 - T - .32], color: c, collide: false });
    for (const a of [-1, 1]) parts.push({ shape: "box", size: [.17, .5, .11], pos: [x + a * .33, F + 1.8, D2 - T - .32], color: c, collide: false });   // sleeves
  }
  // shelves of folded cloth on the west wall
  const shx = -(W2 - T - .24);
  for (const [i, y] of [.55, 1.15, 1.75].entries()) {
    parts.push({ shape: "box", size: [.46, .04, 3.6], pos: [shx, F + y, .4], color: wood, pat: "wood" });
    for (let k = 0; k < 5; k++) for (let j = 0; j < 3; j++) parts.push({ shape: "box", size: [.42, .07, .5], pos: [shx, F + y + .055 + j * .07, -1.0 + k * .7], color: CLOTH[(k + j + i) % CLOTH.length], collide: false });
  }
  // the counter under the shop window, a bolt on it, the customer before it
  parts.push({ shape: "box", size: [2.2, .9, .55], pos: [-1.4, F + .45, -(D2 - T) + .5], color: wood, pat: "wood" });
  parts.push({ shape: "cyl", size: { r1: .1, r2: .1, h: .7, seg: 8 }, pos: [-1.6, F + 1.0, -(D2 - T) + .5], rot: [0, 0, 90], color: CLOTH[3], collide: false });
  folkSpots.push({ x: -1.4, y: F, z: -(D2 - T) + 1.4, h: Math.PI / 2, pose: "stand" });   // the customer, facing the counter (-z)
  hangingSign(parts, { x: .2, z: -D2, dir: -1, color: 0x5a3a2a, pat: "stars", accent: 0xc9a227, emblem: "shears" });   // the sign: shears on a dark red board
  const floorY = (x, z) => (Math.abs(x) <= W2 && Math.abs(z) <= D2 ? F : 0);
  return { name, parts, footprint: [W + 2, D + 2], floorY, folkSpots, windows, front: -1, doors: [{ x: 1.5, z: -(D2 - T / 2), w: 1.3, h: 2.1 }],
           cobwebs: [{ x: -(W2 - T), y: H, z: D2 - T, sx: 1, sz: -1, d: .5 }] };
}

// ---- the public fountain: a paved square opening onto the street, an octagonal basin (eight wall
// segments, so it is solid to walk against) on a step, a column with an upper bowl and four spouts whose
// jets fall into the pool; buckets on the rim and villagers fetching water ----
export function fountain({ name = "Fountain" } = {}) {
  const stone = 0x9a9488, light = 0xb0aa9c, water = 0x5a8a96, parts = [], folkSpots = [];
  const R = 1.6, side = 2 * R * Math.tan(Math.PI / 8), wallH = .75, step = .18, base = .1;
  parts.push({ shape: "box", size: [8, base, 8], pos: [0, base / 2, 0], color: 0x8b8578, pat: "checker", accent: 0x777168, collide: false });   // the square's paving
  parts.push({ shape: "cyl", size: { r1: 2.45, r2: 2.55, h: step, seg: 8 }, pos: [0, base + step / 2, 0], rot: [0, 22.5, 0], color: stone, collide: false });   // the step
  const y0 = base + step;
  for (let k = 0; k < 8; k++) {   // the basin wall: an octagon of boxes, each face square to its radius
    const a = k * Math.PI / 4, cx = Math.cos(a) * (R + .15), cz = Math.sin(a) * (R + .15);
    parts.push({ shape: "box", size: [.3, wallH, side + .2], pos: [cx, y0 + wallH / 2, cz], rot: [0, -k * 45, 0], color: stone, pat: "ashlar" });
  }
  for (let k = 0; k < 8; k++) {   // the rim: an octagon of coping stones (a solid disc would lid the pool)
    const a = k * Math.PI / 4;
    parts.push({ shape: "box", size: [.5, .12, side + .35], pos: [Math.cos(a) * (R + .15), y0 + wallH + .06, Math.sin(a) * (R + .15)], rot: [0, -k * 45, 0], color: light, collide: false });
  }
  const wy = y0 + wallH - .12, flows = [{ kind: "pool", x: 0, y: wy, z: 0, r: R, seg: 8 }];   // the pool (live water, see `flows`)
  parts.push({ shape: "cyl", size: { r1: .2, r2: .28, h: 1.7, seg: 8 }, pos: [0, y0 + .85, 0], color: stone, pat: "ashlar" });   // the column
  // the small basin round the column, a step above the pool, where the jets land (and spill over into the pool)
  parts.push({ shape: "cyl", size: { r1: .95, r2: .85, h: .08, seg: 8 }, pos: [0, y0 + .64, 0], rot: [0, 22.5, 0], color: light });   // its floor
  const ms = 2 * .9 * Math.tan(Math.PI / 8);
  for (let k = 0; k < 8; k++) {   // its wall and coping, octagons of boxes open to the water inside
    const a = k * Math.PI / 4, cx = Math.cos(a) * .9, cz = Math.sin(a) * .9;
    parts.push({ shape: "box", size: [.12, .3, ms + .1], pos: [cx, y0 + .75, cz], rot: [0, -k * 45, 0], color: light });
    parts.push({ shape: "box", size: [.24, .08, ms + .2], pos: [cx, y0 + .94, cz], rot: [0, -k * 45, 0], color: light, collide: false });
  }
  const my = y0 + .86; flows.push({ kind: "pool", x: 0, y: my, z: 0, r: .8, seg: 8 });
  parts.push({ shape: "cyl", size: { r1: .6, r2: .38, h: .22, seg: 8 }, pos: [0, y0 + 1.81, 0], rot: [0, 22.5, 0], color: light });   // the upper bowl
  const bs = 2 * .56 * Math.tan(Math.PI / 8);
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; parts.push({ shape: "box", size: [.08, .16, bs + .08], pos: [Math.cos(a) * .56, y0 + 2.0, Math.sin(a) * .56], rot: [0, -k * 45, 0], color: light, collide: false }); }   // its brim, open inside
  flows.push({ kind: "pool", x: 0, y: y0 + 1.95, z: 0, r: .52, seg: 8 });
  parts.push({ shape: "cyl", size: { r1: .08, r2: .12, h: .3, seg: 8 }, pos: [0, y0 + 2.07, 0], color: light, collide: false });
  parts.push({ shape: "sphere", size: { r: .16 }, pos: [0, y0 + 2.32, 0], color: light, collide: false });   // the finial
  const sy = y0 + 1.55;   // the four spouts under the bowl; from each lip the water falls STRAIGHT down into the small basin
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, ux = Math.cos(a), uz = Math.sin(a);
    parts.push({ shape: "cyl", size: { r1: .035, r2: .035, h: .45, seg: 6 }, pos: [ux * .45, sy, uz * .45], rot: k % 2 ? [90, 0, 0] : [0, 0, 90], color: 0x3a3a40, collide: false });
    flows.push({ kind: "jet", x: ux * .66, y: my - .02, z: uz * .66, r: .04, h: sy - .02 - my + .02 });
  }
  // buckets on the rim: water vessels (tableware.js -- open, the water at its level, drinkable), not building parts
  const vessels = [[R + .2, -.9, .9], [-.7, R + .25, .6]].map(([x, z, fill]) => ({ kind: "bucket", x, y: y0 + wallH + .12, z, fill, drink: "water" }));
  folkSpots.push({ x: R + .6, y: y0, z: -.9, h: Math.PI, pose: "stand" });   // fetching water: on the step, facing the basin
  folkSpots.push({ x: -.7, y: y0, z: R + .75, h: Math.PI / 2, pose: "stand" });
  folkSpots.push({ x: -(R + 2.3), y: base, z: -1.3, h: 0, pose: "stand", role: "work", gesture: "strum", tool: "lute", bard: true });   // the bard's pitch on the open paving, facing the fountain
  folkSpots.push({ x: -2.9, y: base, z: -2.6, h: -Math.PI / 4, pose: "stand" });   // a neighbour stopped to talk, off the step
  const floorY = (x, z) => { const r = Math.hypot(x, z); return r < 2.5 ? y0 : Math.abs(x) <= 4 && Math.abs(z) <= 4 ? base : 0; };
  return { name, parts, footprint: [9, 9], floorY, folkSpots, flows, vessels, square: 4, doors: [], windows: [] };   // square: the paving's half-width, for the path from the street
}

// ---- the hamlet's trades by the quay: carpenter, cooper, butcher --------------
// All three work under one kind of roof: an open-fronted shed -- floor, back
// and side walls, two posts at the open front (+z, onto the quay), a pitched
// roof -- the trade is what stands inside.
function shed(parts, { W, D, H = 3.0, T = .3, wall = 0x6b4a2c, wallPat = "wood", roof = 0x6f5a3a, floor = 0x7a6a52 }) {
  const W2 = W / 2, D2 = D / 2;
  parts.push({ shape: "box", size: [W, .15, D], pos: [0, .075, 0], color: floor });
  parts.push({ shape: "box", size: [W, H, T], pos: [0, H / 2, -D2 + T / 2], color: wall, pat: wallPat });
  for (const s of [-1, 1]) parts.push({ shape: "box", size: [T, H, D], pos: [s * (W2 - T / 2), H / 2, 0], color: wall, pat: wallPat });
  for (const s of [-1, 1]) parts.push({ shape: "box", size: [.25, H, .25], pos: [s * (W2 - .3), H / 2, D2 - .2], color: 0x4a3520 });
  parts.push({ shape: "box", size: [W, .25, .3], pos: [0, H - .12, D2 - .2], color: 0x4a3520 });   // the lintel beam over the open front
  parts.push({ shape: "gable", size: [W + .8, 2.2, D + .9], pos: [0, H, 0], color: roof, pat: "tiles" });
  return { F: .15, floorY: (x, z) => (Math.abs(x) <= W2 && Math.abs(z) <= D2 ? .15 : 0) };
}

// the carpenter: a workbench with a plank under the saw, a sawhorse, stacked boards and logs
export function carpenter({ name = "Carpenter's" } = {}) {
  const W = 9, D = 7, D2 = D / 2, parts = [], folkSpots = [], wood = 0x6b4a2c, board = 0xb08a5a;
  const { F, floorY } = shed(parts, { W, D });
  parts.push({ shape: "box", size: [2.4, .08, .8], pos: [0, F + .84, -.7], color: wood, pat: "wood" });   // the bench
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) parts.push({ shape: "box", size: [.09, .8, .09], pos: [a * 1.1, F + .4, -.7 + b * .32], color: wood });
  parts.push({ shape: "box", size: [1.8, .04, .3], pos: [.1, F + .9, -.65], color: board, pat: "wood", collide: false });   // the plank being sawn
  for (const x of [2.4, 3.4]) for (const s of [-1, 1]) parts.push({ shape: "box", size: [.07, .75, .07], pos: [x, F + .36, 1.0 + s * .22], rot: [s * 14, 0, 0], color: wood });   // the sawhorse
  parts.push({ shape: "box", size: [1.3, .08, .1], pos: [2.9, F + .72, 1.0], color: wood });
  for (let k = 0; k < 7; k++) parts.push({ shape: "box", size: [3.4, .05, .3], pos: [-2.4, F + .03 + k * .055, -D2 + .75 + (k % 2) * .05], color: board, pat: "wood", collide: false });   // boards stacked by the back wall
  for (const z of [1.6, 2.1]) parts.push({ shape: "cyl", size: { r1: .2, r2: .22, h: 2.6, seg: 8 }, pos: [-2.6, F + .22, z], rot: [0, 0, 90], color: 0x6a5140, pat: "wood" });   // logs
  folkSpots.push({ x: 0, y: F, z: -.05, h: Math.PI / 2, role: "work", gesture: "saw", tool: "saw", pose: "stand" });   // the carpenter at the bench
  folkSpots.push({ x: 3.0, y: F, z: D2 - 1.0, h: Math.PI / 2, pose: "stand" });   // a customer
  return { name, parts, footprint: [W + 2, D + 2], floorY, folkSpots, doors: [], windows: [] };
}
// the cooper: finished casks, one half-raised (its staves splayed in a hoop), a block to work at
export function cooper({ name = "Cooper's" } = {}) {
  const W = 9, D = 7, D2 = D / 2, parts = [], folkSpots = [];
  const { F, floorY } = shed(parts, { W, D, wall: 0x7a6248 });
  for (const [x, z] of [[-3.2, -2.4], [-2.4, -2.4], [-3.2, -1.6], [3.3, -2.4]]) parts.push(...barrel("big", [x, F + .45, z], "up"));
  parts.push(...barrel("big", [-2.8, F + .45 + .9, -2.0], "up"));   // one on the stack
  const bx = .2, bz = -.9;   // the cask being raised: splayed staves round a hoop
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * Math.PI * 2;
    parts.push({ shape: "box", size: [.1, .8, .03], pos: [bx + Math.cos(a) * .28, F + .4, bz + Math.sin(a) * .28], rot: [Math.sin(a) * 8, -a * 180 / Math.PI + 90, Math.cos(a) * -8], color: 0x9a7040, collide: false });
  }
  parts.push({ shape: "cyl", size: { r1: .33, r2: .33, h: .05, seg: 12, open: true }, pos: [bx, F + .72, bz], color: 0x4a4644, collide: false });
  parts.push({ shape: "cyl", size: { r1: .3, r2: .32, h: .5, seg: 8 }, pos: [2.2, F + .25, .6], color: 0x5a4636, pat: "wood" });   // the block
  for (let k = 0; k < 5; k++) parts.push({ shape: "cyl", size: { r1: .36, r2: .36, h: .03, seg: 12, open: true }, pos: [3.4, F + 1.2 + k * .12, -D2 + .35], rot: [90, 0, 0], color: 0x4a4644, collide: false });   // hoops on the wall
  folkSpots.push({ x: bx, y: F, z: bz + .75, h: Math.PI / 2, role: "work", gesture: "hammer", tool: "hammer", pose: "stand" });   // the cooper, driving the hoop down
  folkSpots.push({ x: 3.0, y: F, z: D2 - 1.0, h: Math.PI / 2, pose: "stand" });
  return { name, parts, footprint: [W + 2, D + 2], floorY, folkSpots, doors: [], windows: [] };
}
// the butcher: stone walls, a counter across the open front, hams hanging from a rail, the block
export function butcher({ name = "Butcher's" } = {}) {
  const W = 8, D = 6, D2 = D / 2, parts = [], folkSpots = [], wood = 0x6b4a2c;
  const { F, floorY } = shed(parts, { W, D, wall: 0x9a917f, wallPat: "ashlar", floor: 0x8b8578 });
  parts.push({ shape: "box", size: [3.6, .9, .6], pos: [0, F + .45, D2 - .9], color: wood, pat: "wood" });   // the counter
  parts.push({ shape: "box", size: [3.4, .05, .5], pos: [0, F + .92, D2 - .9], color: 0xe2dccc, collide: false });   // its board
  for (let k = 0; k < 3; k++) parts.push({ shape: "capsule", size: { r: .07, len: .18 }, pos: [-1 + k * .8, F + 1.02, D2 - .9], rot: [0, 0, 90], color: 0xa04a3a, collide: false });   // cuts on the board
  parts.push({ shape: "box", size: [W - 1, .06, .06], pos: [0, 2.35, -.6], color: 0x3e3a38 });   // the rail
  for (let k = 0; k < 6; k++) parts.push({ shape: "capsule", size: { r: .11, r2: .07, len: .3 }, pos: [-2.6 + k * 1.0, 1.95, -.6], color: k % 2 ? 0x8a3a30 : 0x9a4a38, collide: false });   // hams
  parts.push({ shape: "cyl", size: { r1: .34, r2: .36, h: .8, seg: 10 }, pos: [-2.2, F + .4, .6], color: 0x6a5140, pat: "wood" });   // the chopping block
  folkSpots.push({ x: 0, y: F, z: D2 - 1.75, h: -Math.PI / 2, role: "work", gesture: "chop", tool: "cleaver", pose: "stand" });   // the butcher behind the counter, facing the quay
  folkSpots.push({ x: -.6, y: 0, z: D2 + .6, h: Math.PI / 2, pose: "stand" });   // a customer before the counter
  return { name, parts, footprint: [W + 2, D + 2], floorY, folkSpots, doors: [], windows: [] };
}

// ---- the beekeeper's garden: straw skeps on stands in two rows, a wattle fence, a bench ----
export function apiary({ name = "Beekeeper's garden" } = {}) {
  const W = 10, D = 8, W2 = W / 2, D2 = D / 2, parts = [], folkSpots = [], straw = 0xc9a24a, wood = 0x6b4a2c;
  for (const [x0, z0, x1, z1] of [[-W2, -D2, W2, -D2], [-W2, -D2, -W2, D2], [W2, -D2, W2, D2], [-W2, D2, -1, D2], [1, D2, W2, D2]]) {   // the fence, a gap in the front
    const len = Math.hypot(x1 - x0, z1 - z0);
    parts.push({ shape: "box", size: x0 === x1 ? [.08, .7, len] : [len, .7, .08], pos: [(x0 + x1) / 2, .35, (z0 + z1) / 2], color: 0x7a6040, pat: "wood" });
  }
  for (const z of [-2, .8]) for (let k = 0; k < 4; k++) {   // skeps: a coiled-straw dome on a stand, its entrance at the foot
    const x = -3.3 + k * 2.2;
    parts.push({ shape: "box", size: [.55, .4, .55], pos: [x, .2, z], color: wood });
    parts.push({ shape: "cyl", size: { r1: .3, r2: .27, h: .22, seg: 10 }, pos: [x, .51, z], color: straw });
    parts.push({ shape: "cyl", size: { r1: .27, r2: .1, h: .26, seg: 10 }, pos: [x, .75, z], color: 0xbf9840 });
    parts.push({ shape: "sphere", size: { r: .1 }, pos: [x, .88, z], color: straw });
    parts.push({ shape: "box", size: [.12, .06, .04], pos: [x, .43, z + .29], color: 0x2a2010, collide: false });
  }
  parts.push({ shape: "box", size: [1.6, .06, .4], pos: [3.2, .46, 2.9], color: wood, pat: "wood" });   // the bench, a smoker and a comb frame on it
  for (const dx of [-.65, .65]) parts.push({ shape: "box", size: [.08, .44, .34], pos: [3.2 + dx, .22, 2.9], color: wood });
  parts.push({ shape: "cyl", size: { r1: .08, r2: .1, h: .22, seg: 8 }, pos: [2.8, .6, 2.9], color: 0x5a5550 });
  parts.push({ shape: "box", size: [.4, .3, .03], pos: [3.5, .64, 2.9], color: 0xd9a92a, collide: false });
  folkSpots.push({ x: -2.2, y: 0, z: -.6, h: Math.PI / 2, role: "work", gesture: "tend", pose: "stand" });   // the beekeeper among the hives
  return { name, parts, footprint: [W + 2, D + 2], floorY: () => 0, folkSpots, doors: [], windows: [] };
}

export const VILLAGE = {
  carpenter: carpenter(),
  cooper: cooper(),
  butcher: butcher(),
  apiary: apiary(),   // (the bridge and the two enclosures are built by the demo to the river and the village as laid out)
  fisherHut: fisherHut(),
  pottery: pottery(),
  smithy: smithy(),
  weaver: weaver(),
  tailor: tailor(),
  fountain: fountain(),
  church: villageChurch(),
  market: marketplace(),
  bakery: bakery(),
  pigYard: farmyard({ name: "Pig yard", kind: "pigs", w: 20, d: 15 }),
  henYard: farmyard({ name: "Hen yard", kind: "hens", w: 15, d: 12 }),
  stableYard: farmyard({ name: "Stable yard", kind: "horses", w: 22, d: 16 }),
  ryeField: cropField({ crop: "rye", w: 14, d: 12, seed: 1 }),
  barleyField: cropField({ crop: "barley", w: 14, d: 12, seed: 2 }),
  cabbageField: cropField({ crop: "cabbage", w: 12, d: 10, seed: 3 }),
  beanField: cropField({ crop: "beans", w: 12, d: 10, seed: 4 }),
  garlicField: cropField({ crop: "garlic", w: 10, d: 8, seed: 5 }),
  soilField: cropField({ name: "Plowed field", crop: "soil", w: 12, d: 10, seed: 6 }),
  berries: berryRows(),
  orchard: orchard(),
};
