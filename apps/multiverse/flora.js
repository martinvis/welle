// Flora for the banner engines: trees (grown by recursive branching, with
// leaf cards drawn by foliage.js), mushrooms, bushes, grass and clouds
// (the flowers are polygon items: assets/items/flowers) -- the same part vocabulary as the animals (capsules, spheres,
// cones), so the instanced herd renders a whole forest's wood in one call.
// A seed varies every individual; deciduous species take an `autumn` blend
// toward their own autumn colour (or an explicit `leaf` override).

import { vAdd, vSc, vNorm, vCross, vPerp, vRot, aimRot } from "./geom.js";

export const rng = (seed) => {
  let a = seed | 0;
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
};

const lerpC = (a, b, t) => {
  let out = 0;
  for (const sh of [16, 8, 0]) out |= Math.round((a >> sh & 255) * (1 - t) + (b >> sh & 255) * t) << sh;
  return out;
};

// ---- trees: grown, not assembled ---------------------------------------------
// A tree is GROWN from its seed by recursive branching (after the trees
// lab): a branch is a few straight segments that bend up or droop as they
// go (curvature, wobble), and at its tip it forks by the species' MODE --
//   dichotomous  splits in two            whorled  several round the tip
//   alternate    side branches along it, the leader carrying on
//   random       one to n                 weeping  a strong droop
//   spruce       one straight leader with whorls of near-horizontal
//                branches, shorter toward the top
// -- each child shorter and thinner by the species' ratios, the angles
// jittered. Every segment is one capsule banner in the trunk's bark, out
// to the thinnest twig. The outer
// levels carry LEAF CARDS: quads with a painted cluster of leaves from the
// leaf atlas (textures.js: oval, round, lobed, needles, willow), cut out by
// alpha and drawn by foliage.js in one call for the whole forest. A tree is
// grown in trunk-length units and scaled to its real height at the end;
// card sizes are real metres.
//   depth: branch levels   branches: children per fork   angle: fork angle (deg)   jitter: angle noise
//   lenRatio / radRatio: child vs parent   curve: - lifts, + droops   trunkR: trunk radius / trunk length
//   wobble: segment noise   tilt: max trunk lean (deg)   taper: trunk top vs foot radius (a palm's bole hardly narrows; else radRatio)   whorls: spruce whorls   twigSegs: segments of the thinnest levels
//   whorlLen: spruce whorl branch length (trunk units, at the foot of the crown)
//   cards: { style, density (cards per leafy branch), size (m for a 14m tree; it grows with the tree), levels (leafy levels from the tips), flat (0..1: cards lying level, conifers) }
//   fruit: { style (atlas cell), color, density (fruit cards per leafy branch), size } -- orchard trees, drawn exactly like the leaves
const TREES = {
  oak: { hRange: [16, 26], trunk: 0x5d4a37, leaf: [0x4d6b2e, 0x39561f], autumnC: 0xb0692a,
    mode: "random", depth: 5, branches: 3, angle: 44, jitter: .5, lenRatio: .72, radRatio: .6, curve: -.05, trunkR: .085, wobble: .35, tilt: 4,
    cards: { style: "lobed", density: 6, size: 1.5, levels: 3 } },
  birch: { hRange: [14, 22], trunk: 0xd6d3c9, bark: "barkH", leaf: [0x71903f, 0x587a30], autumnC: 0xd7a92f,
    mode: "alternate", depth: 4, branches: 3, angle: 30, jitter: .4, lenRatio: .62, radRatio: .58, curve: .3, trunkR: .03, wobble: .3, tilt: 5,
    cards: { style: "round", density: 3, size: 1.2, levels: 2 } },
  pine: { hRange: [22, 33], trunk: 0xa26b42, leaf: [0x3a5230, 0x2c4226], evergreen: true,
    mode: "whorled", depth: 3, branches: 5, angle: 52, jitter: .45, lenRatio: .52, radRatio: .5, curve: .08, trunkR: .025, wobble: .3, tilt: 6,
    cards: { style: "needles", density: 7, size: 1.5, levels: 2, flat: .6 } },
  spruce: { hRange: [24, 38], trunk: 0x6a5140, leaf: [0x3a5a36, 0x2c4a2e], evergreen: true,
    mode: "spruce", whorls: 14, depth: 3, branches: 3, angle: 35, jitter: .35, lenRatio: .6, radRatio: .55, curve: .12, trunkR: .016, wobble: .2, tilt: 2, twigSegs: 1,
    whorlLen: .16, cards: { style: "needles", density: 2, size: 1.6, levels: 2, flat: .7 } },
  willow: { hRange: [9, 15], trunk: 0x6b5a45, leaf: [0x8aa25a, 0x6b8a45], autumnC: 0xc9b24a,
    mode: "weeping", depth: 4, branches: 3, angle: 40, jitter: .45, lenRatio: .72, radRatio: .6, curve: .55, trunkR: .075, wobble: .3, tilt: 7,
    cards: { style: "willow", density: 9, size: 1.7, levels: 2 } },
  cypress: { hRange: [11, 19], trunk: 0x5e4a3a, leaf: [0x2f4a2c, 0x24402a], evergreen: true,   // the Italian cypress: a dark flame, branches swept up close round the leader
    mode: "spruce", whorls: 20, depth: 3, branches: 3, angle: -22, jitter: .3, lenRatio: .45, radRatio: .5, curve: -.15, trunkR: .018, wobble: .12, tilt: 1, twigSegs: 1,
    whorlLen: .075, cards: { style: "needles", density: 3, size: 1.1, levels: 2, flat: .2 } },
  maple: { hRange: [12, 22], trunk: 0x5a4636, leaf: [0x5f8f3a, 0x3f6e2a], autumnC: 0xc8401e,
    mode: "dichotomous", depth: 5, branches: 2, angle: 30, jitter: .45, lenRatio: .74, radRatio: .66, curve: -.08, trunkR: .065, wobble: .3, tilt: 4,
    cards: { style: "lobed", density: 6, size: 1.3, levels: 3 } },
  // warm species (not in the wild mix: only where a period asks for them, assets/world/periods.json `trees`)
  palm: { hRange: [9, 16], trunk: 0x8a7458, bark: "barkH", leaf: [0x5f7f36, 0x4a682a], evergreen: true, warm: true,   // the date palm: a bare ringed bole, a crown of arching fronds
    mode: "palm", depth: 2, branches: 18, angle: 58, jitter: .35, lenRatio: .42, radRatio: .12, taper: .75, curve: 1.8, trunkR: .03, wobble: .15, tilt: 9,
    cards: { style: "willow", density: 10, size: 1.5, levels: 1 } },
  // orchard species (the village's orchard; not in the wild mix): low pruned crowns carrying fruit cards
  apple: { hRange: [4, 6], trunk: 0x5a3d24, leaf: [0x4f8a3a, 0x3f7430], autumnC: 0xc09a3a, orchard: true,
    mode: "dichotomous", depth: 4, branches: 2, angle: 42, jitter: .5, lenRatio: .78, radRatio: .66, curve: .08, trunkR: .1, wobble: .35, tilt: 5,
    cards: { style: "oval", density: 7, size: 1.9, levels: 2 }, fruit: { style: "apples", color: 0xc8302a, density: 3, size: 1.0 } },
  cherry: { hRange: [5, 7.5], trunk: 0x5e3a2c, bark: "barkH", leaf: [0x467a34, 0x3a6a2c], autumnC: 0xc0502a, orchard: true,
    mode: "random", depth: 4, branches: 3, angle: 38, jitter: .45, lenRatio: .72, radRatio: .62, curve: .02, trunkR: .085, wobble: .3, tilt: 4,
    cards: { style: "oval", density: 6, size: 1.7, levels: 2 }, fruit: { style: "cherries", color: 0x8a1020, density: 3, size: .8 } },
};
export const TREE_SPECIES = Object.keys(TREES).filter((k) => !TREES[k].orchard && !TREES[k].warm);   // the wild mix
export const WARM_TREES = Object.keys(TREES).filter((k) => TREES[k].warm);
export const FRUIT_TREES = Object.keys(TREES).filter((k) => TREES[k].orchard);
const LEAF_STYLE_IDS = { oval: 0, round: 1, lobed: 2, needles: 3, willow: 4, berries: 5, apples: 6, cherries: 7 };   // the leaf atlas's cells (textures.js LEAF_STYLES)


// one wood segment: a capsule from a (radius ra) to b (rb) in the trunk's bark, never thinner than a hair
const woodPart = (id, a, b, ra, rb, color, pat = "bark") => {   // pat: "bark" furrowed, "barkH" ringed (birch, cherry)
  const d = vAdd(b, vSc(a, -1));
  return { id, parent: null, shape: "capsule", size: { r: Math.max(.01, rb), r2: Math.max(.012, ra), len: Math.max(Math.hypot(d[0], d[1], d[2]), .005) },
           pos: vSc(vAdd(a, b), .5), rot: aimRot(d), color, pat };
};
// a leaf card round axis `ax` (its facing), centre c, size s metres
const cardAt = (c, ax, s) => { const rt = vPerp(ax), up = vCross(ax, rt); return { c, r: vSc(rt, s * .5), u: vSc(up, s * .5) }; };

export function makeTree(species, { seed = 1, height, autumn = 0, leaf } = {}) {
  const P = TREES[species];
  const r = rng(seed * 1013 + 7);
  const h = height ?? P.hRange[0] + r() * (P.hRange[1] - P.hRange[0]);
  const C = P.cards, twigSegs = P.twigSegs ?? 1, cardScale = Math.pow(h / 14, .8);   // a bigger tree carries bigger clumps
  const branches = [], cards = [];
  const segsFor = (level) => level === 1 ? 4 : level === 2 && !P.twigSegs ? 3 : level < P.depth && !P.twigSegs ? 2 : twigSegs;
  const card = (c) => {
    const f = C.flat ?? 0, ax = r() < f ? vNorm([(r() - .5) * .5, 1, (r() - .5) * .5]) : vNorm([r() - .5, r() - .5, r() - .5]);
    cards.push({ c, ax, size: C.size * cardScale * (.7 + .6 * r()), tint: r(), phase: r() * 6.2832 });
  };
  function grow(pos, dir, len, rad, level) {
    if (level > P.depth) return;
    const segs = segsFor(level), step = len / segs, r0 = rad, r1 = rad * (level === P.depth ? .3 : level === 1 && P.taper ? P.taper : P.radRatio);
    let p = pos, d = dir;
    for (let s = 0; s < segs; s++) {
      const q = vAdd(p, vSc(d, step));
      branches.push({ a: p, b: q, r0: r0 + (r1 - r0) * s / segs, r1: r0 + (r1 - r0) * (s + 1) / segs, level });
      p = q;
      // (a trunk bends only a little: a weeping willow droops its branches, not its bole)
      d = vNorm(vAdd(vAdd(d, [0, -P.curve * .25 * (P.mode === "weeping" ? 3 : 1) * (level === 1 ? .15 : 1), 0]), vSc([r() - .5, r() - .5, r() - .5], P.wobble * .25)));
    }
    const tip = p, tipDir = d;
    if (level >= P.depth - C.levels + 1) {
      for (let k = 0; k < C.density; k++) card(vAdd(pos, vSc(vAdd(tip, vSc(pos, -1)), .3 + .7 * r())));
      if (P.fruit) for (let k = 0; k < P.fruit.density; k++)
        cards.push({ c: vAdd(pos, vSc(vAdd(tip, vSc(pos, -1)), .4 + .6 * r())), ax: vNorm([r() - .5, r() - .5, r() - .5]),
                     size: P.fruit.size * cardScale * (.8 + .4 * r()), tint: r(), phase: r() * 6.2832, fruit: true });
    }
    if (level === P.depth) return;
    const n = P.mode === "dichotomous" ? 2 : P.mode === "random" ? 1 + Math.floor(r() * P.branches) : P.mode === "spruce" ? 2 : P.branches;
    const ang = P.angle * Math.PI / 180, u = vPerp(tipDir), base = r() * 6.2832, along = P.mode === "alternate" || P.mode === "spruce";
    for (let i = 0; i < n; i++) {
      const a = ang * (1 + P.jitter * (r() - .5) * 1.5), around = base + i / n * 6.2832 + P.jitter * (r() - .5);
      const nd = vNorm(vAdd(vSc(tipDir, Math.cos(a)), vSc(vRot(u, tipDir, around), Math.sin(a))));
      if (along) grow(vAdd(pos, vSc(vAdd(tip, vSc(pos, -1)), .35 + .6 * i / Math.max(1, n - 1))), nd, len * P.lenRatio, rad * P.radRatio, level + 1);
      else grow(tip, nd, len * P.lenRatio * (.85 + .3 * r()), rad * P.radRatio, level + 1);
    }
    if (along) grow(tip, tipDir, len * P.lenRatio, rad * P.radRatio, level + 1);   // the leader carries on
  }
  const lean = P.tilt * Math.PI / 180 * r(), az = r() * 6.2832;
  const d0 = vNorm([Math.sin(lean) * Math.cos(az), Math.cos(lean), Math.sin(lean) * Math.sin(az)]);
  if (P.mode === "spruce") {   // monopodial: a straight leader in short segments, a ring of near-horizontal branches at each whorl
    const W = P.whorls, r0 = P.trunkR;
    let p = [0, 0, 0], d = d0;
    for (let w = 0; w < W; w++) {
      const t = w / W, t1 = (w + 1) / W, q = vAdd(p, vSc(d, 1 / W));
      branches.push({ a: p, b: q, r0: r0 * (1 - t * .9), r1: r0 * (1 - t1 * .9), level: 1 });
      const n = Math.max(2, P.branches + 1), base = r() * 6.2832, len = ((P.whorlLen ?? .42) * (1 - t) + .02) * (.8 + .4 * r());
      if (w > 0) for (let i = 0; i < n; i++) {
        const side = vRot(vPerp(d), d, base + i / n * 6.2832 + P.jitter * (r() - .5)), a = (P.angle + 40) * Math.PI / 180;
        grow(q, vNorm(vAdd(vSc(d, Math.cos(a)), vSc(side, Math.sin(a)))), len, r0 * .25 * (1 - t * .7), Math.max(2, P.depth - 1));
      }
      p = q; d = vNorm(vAdd(d, vSc([r() - .5, 0, r() - .5], P.wobble * .08)));
    }
    branches.push({ a: p, b: vAdd(p, vSc(d, .12)), r0: r0 * .1, r1: r0 * .03, level: P.depth });   // the tip
    for (let k = 0; k < C.density * 2 + 1; k++) card(vAdd(p, vSc(d, .12 * r())));
  } else grow([0, 0, 0], d0, 1, P.trunkR, 1);

  // to the real height; radii with it, never thinner than a hair
  let top = 0;
  for (const b of branches) top = Math.max(top, b.a[1], b.b[1]);
  const S = h / Math.max(top, 1e-3);
  const parts = branches.map((b, i) => woodPart("w" + i, vSc(b.a, S), vSc(b.b, S), b.r0 * S, b.r1 * S, P.trunk, P.bark));   // one bark, trunk to twig
  // the cards: the species' greens, a per-tree shade, a per-card tint, autumn per card (a mottled turn, not one flat colour)
  const treeShade = r() > .5 ? 0xffffff : 0x101408, treeAmt = .12 * r();
  let cx = 0, cy = 0, cz = 0;
  for (const L of cards) { cx += L.c[0]; cy += L.c[1]; cz += L.c[2]; }
  const cen = cards.length ? [cx / cards.length * S, cy / cards.length * S, cz / cards.length * S] : [0, h * .6, 0];
  let dmax = 1e-3;
  const placed = cards.map((L) => { const c = vSc(L.c, S); dmax = Math.max(dmax, Math.hypot(c[0] - cen[0], c[1] - cen[1], c[2] - cen[2])); return c; });
  const leaves = cards.map((L, i) => {
    let c = placed[i];
    if (L.fruit) {   // fruit hangs on the crown's outside, where it shows: pushed out from the centre a little
      const o = vNorm(vAdd(c, vSc(cen, -1)));
      return { ...cardAt(vAdd(c, vSc(o, .3 * cardScale)), L.ax, L.size), color: lerpC(P.fruit.color, 0xffffff, .1 * L.tint),
               style: LEAF_STYLE_IDS[P.fruit.style], phase: L.phase, sway: .02 + .07 * Math.max(0, c[1] / h), shade: 1 };
    }
    let color = leaf ?? lerpC(P.leaf[0], P.leaf[1], L.tint * .8);
    color = lerpC(color, treeShade, treeAmt);
    if (!P.evergreen && autumn && leaf === undefined) color = lerpC(color, P.autumnC, Math.min(1, autumn * (.55 + .7 * L.tint)));
    const dc = Math.hypot(c[0] - cen[0], c[1] - cen[1], c[2] - cen[2]) / dmax;
    return { ...cardAt(c, L.ax, L.size), color, style: LEAF_STYLE_IDS[C.style], phase: L.phase,
             sway: .02 + .07 * Math.max(0, c[1] / h), shade: .76 + .24 * Math.min(1, dc) };
  });
  // the trunk's centreline (the first chain of segments, foot to crown, as it leans and wobbles) with its
  // radii, in tree space: what climbs it follows the real bole (squirrels.js)
  const trunk = branches.filter((b) => b.level === 1).map((b) => ({ a: vSc(b.a, S), b: vSc(b.b, S), r0: Math.max(.012, b.r0 * S), r1: Math.max(.012, b.r1 * S) }));
  return { name: species, parts, leaves, trunkR: Math.max(.012, P.trunkR * S), height: h, trunk };
}

// mushrooms: tiny understory props (real sizes, 8-20cm), same vocabulary.
// amanita = fly agaric with white spots on the red cap; boletus = fat pale
// stem under a brown bun; chanterelle = low golden button.
export const MUSHROOMS = ["amanita", "boletus", "chanterelle"];

export function makeMushroom(kind, { seed = 1 } = {}) {
  const r = rng(seed * 337 + 5);
  const parts = [];
  if (kind === "amanita") {
    const h = .13 + r() * .08, capR = h * .42;
    parts.push({ id: "s", parent: null, shape: "capsule", size: { r: h * .09, len: h * .55 }, pos: [0, h * .3, 0], color: 0xe8e2d6 });
    parts.push({ id: "c", parent: null, shape: "sphere", size: { r: capR }, scale: [1, .62, 1], pos: [0, h * .68, 0], color: 0xc03325 });
    for (let i = 0; i < 5; i++) {
      const a = r() * Math.PI * 2, d = capR * (.3 + r() * .55);
      parts.push({ id: "d" + i, parent: "c", shape: "sphere", size: { r: capR * .13 },
        pos: [Math.cos(a) * d, Math.sqrt(Math.max(0, capR * capR - d * d)) * .85, Math.sin(a) * d], color: 0xf2ede2 });
    }
  } else if (kind === "boletus") {
    const h = .1 + r() * .06;
    parts.push({ id: "s", parent: null, shape: "capsule", size: { r: h * .16, len: h * .45 }, pos: [0, h * .28, 0], color: 0xd9cbaa });
    parts.push({ id: "c", parent: null, shape: "sphere", size: { r: h * .45 }, scale: [1, .55, 1], pos: [0, h * .62, 0], color: 0x7a4e26 });
  } else {
    const h = .07 + r() * .04;
    parts.push({ id: "s", parent: null, shape: "capsule", size: { r: h * .12, len: h * .5 }, pos: [0, h * .3, 0], color: 0xe0a82c });
    parts.push({ id: "c", parent: null, shape: "sphere", size: { r: h * .42 }, scale: [1, .4, 1], pos: [0, h * .62, 0], color: 0xe8a825 });
  }
  return { name: kind, parts };
}

// ---- undergrowth & sky ------------------------------------------------------

// bushes: big real shrubs, 1.6-3.2m tall and about as wide -- a few stems
// fanning out of the ground in the trunk's bark, and a rounded clump of
// leaf cards (foliage.js), denser toward its outside. About a third are
// fruit bushes: fruit cards (the atlas's berry clusters, in the fruit's own
// colour) sit on the clump's surface alongside the leaves.
export const BUSH_FRUITS = [
  { name: "currant", color: 0xc0282c }, { name: "whitecurrant", color: 0xe9e2d2 }, { name: "blackcurrant", color: 0x1c1224 },
  { name: "blueberry", color: 0x3a4a8a }, { name: "blackberry", color: 0x2a1a2e }, { name: "gooseberry", color: 0x9bbf5a }, { name: "rosehip", color: 0xd24a1e },
];
// fruit: a BUSH_FRUITS name, null for none, undefined to draw one (a third bear);  height: metres (the village's rows are knee-to-waist high)
export function makeBush({ seed = 1, autumn = 0, fruit, height } = {}) {
  const r = rng(seed * 331 + 7);
  const h0 = 1.6 + r() * 1.6, h = height ?? h0, wide = h * (.42 + r() * .2), k = h / 2.4;
  let green = lerpC(0x41682f, 0x7d9c48, r());
  const style = r() < .5 ? LEAF_STYLE_IDS.oval : LEAF_STYLE_IDS.round;
  const F = fruit === undefined ? (r() < .35 ? BUSH_FRUITS[Math.floor(r() * BUSH_FRUITS.length)] : null) : BUSH_FRUITS.find((f) => f.name === fruit) ?? null;
  const bark = 0x5b4326, parts = [], leaves = [];
  const nStems = 4 + Math.floor(r() * 3);
  for (let i = 0; i < nStems; i++) {   // stems out of the ground, each bending a little outward in two segments
    const a = i / nStems * 6.2832 + r() * .8, tilt = .25 + r() * .45, len = h * (.6 + r() * .2);
    const o = [Math.cos(a) * .05, 0, Math.sin(a) * .05];
    const m = vAdd(o, vSc([Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt)], len * .55));
    const t2 = tilt + .25 + r() * .25;
    const e = vAdd(m, vSc([Math.cos(a) * Math.sin(t2), Math.cos(t2), Math.sin(a) * Math.sin(t2)], len * .45));
    const r0 = .025 + h * .01;
    parts.push(woodPart("st" + i, o, m, r0, r0 * .7, bark), woodPart("sb" + i, m, e, r0 * .7, r0 * .35, bark));
  }
  const cen = [0, h * .55, 0], semi = [wide, h * .45, wide];
  const shell = (lo) => {   // a point in the clump, between `lo` and 1 of the way out
    const d = vNorm([r() - .5, r() - .5, r() - .5]), f = lo + (1 - lo) * Math.sqrt(r());
    return { c: [cen[0] + d[0] * semi[0] * f, Math.max(.25, cen[1] + d[1] * semi[1] * f), cen[2] + d[2] * semi[2] * f], f };
  };
  const nLeaf = 26 + Math.floor(r() * 14);
  for (let i = 0; i < nLeaf; i++) {
    const { c, f } = shell(.35);
    let col = lerpC(green, r() > .5 ? 0xffffff : 0x101408, .12 * r());
    if (autumn) col = lerpC(col, 0xb06f2c, Math.min(1, autumn * (.4 + .8 * r())));
    leaves.push({ ...cardAt(c, vNorm([r() - .5, r() - .5, r() - .5]), (.75 + .45 * r()) * k), color: col, style,
                  phase: r() * 6.2832, sway: .01 + .02 * c[1] / h, shade: .74 + .26 * f });
  }
  if (F) for (let i = 0, n = 8 + Math.floor(r() * 8); i < n; i++) {   // the fruit, on the clump's surface
    const { c } = shell(.85);
    leaves.push({ ...cardAt(c, vNorm([r() - .5, r() - .5, r() - .5]), (.35 + .2 * r()) * k), color: lerpC(F.color, 0xffffff, .08 * r()),
                  style: LEAF_STYLE_IDS.berries, phase: r() * 6.2832, sway: .01 + .02 * c[1] / h, shade: 1 });
  }
  return { name: F ? `${F.name} bush` : "bush", parts, leaves, fruit: F?.name ?? null };
}

// grass tufts: a few tilted blades (cones) poking knee-high from the lawn
export function makeGrassTuft({ seed = 1 } = {}) {
  const r = rng(seed * 977 + 3);
  const n = 3 + Math.floor(r() * 3), h = .2 + r() * .25;
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 2;
    const hh = h * (.7 + r() * .6);
    parts.push({ id: `b${i}`, parent: null, shape: "cone", size: { r: .016 + r() * .014, h: hh },
      pos: [Math.cos(a) * .05, hh * .48, Math.sin(a) * .05],
      rot: [Math.sin(a) * (10 + r() * 22), 0, Math.cos(a) * (10 + r() * 22)],
      color: lerpC(0x4d7a35, 0x8fa452, r()) });
  }
  return { name: "grass", parts };
}

// clouds: puffy clusters of flattened white spheres for the sky
export function makeCloud({ seed = 1 } = {}) {
  const r = rng(seed * 613 + 5);
  const tone = r() * r();   // squared: most clouds stay bright, a few hang heavy and grey
  const top = lerpC(0xf3f6f9, 0xaab4c0, tone);
  const belly = lerpC(0xdde5ec, 0x8d99a6, tone);
  const parts = [];
  const n = 5 + Math.floor(r() * 4), spread = 10 + r() * 10;
  for (let i = 0; i < n; i++) {
    const cx = (r() * 2 - 1) * spread, cz = (r() * 2 - 1) * spread * .5;
    const cy = (r() - .3) * 2.5;
    const rad = 4.5 + r() * 6 * (1 - Math.hypot(cx, cz) / (spread * 1.6));
    parts.push({ id: `p${i}`, parent: null, shape: "sphere", size: { r: Math.max(3, rad) },
      scale: [1.5 + r() * .8, .45 + r() * .2, 1.1 + r() * .5],
      pos: [cx, cy, cz],
      color: cy < 0 ? belly : top });   // undersides shade darker, like the real thing
  }
  return { name: "cloud", parts };
}

// (the flowers are items now: assets/items/flowers, tools/flowergen.py -- polygons, placed by index.html buildFlora)
