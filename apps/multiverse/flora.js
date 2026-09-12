// Trees for the banner engines. makeTree() generates a definition in the
// same part vocabulary as the animals -- capsules for trunk and branches,
// sphere/cone banners for the foliage (a crown blob is exactly the "simple
// circle/ellipse" the flat style wants) -- so rig, banner, and instanced all
// draw them, and the instanced herd renders a whole forest in one call.
//
// Species carry real-world height ranges, silhouettes and colors; a seed
// varies every individual (height, lean, branch count and angles, blob
// placement), and deciduous species take an `autumn` blend toward their own
// autumn color (or an explicit `leaf` override for full control).

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

const SPECIES = {
  // Norway spruce: straight spire, layered dark cones nearly to the ground
  spruce: {
    hRange: [24, 38], trunk: 0x6a5140, leaf: 0x2f4a2d, evergreen: true,
    build(r, h, leaf, trunk) {
      const p = [{ id: "t", parent: null, shape: "capsule", size: { r: .012 * h + .12, len: h * .5 }, pos: [0, h * .25, 0], color: trunk }];
      for (let i = 0; i < 3; i++)
        p.push({ id: "c" + i, parent: null, shape: "cone",
          size: { r: h * (.16 - .04 * i) * (1 + .25 * (r() - .5)), h: h * .38 },
          pos: [(r() - .5) * .5, h * (.42 + .2 * i), (r() - .5) * .5], color: leaf });
      for (let i = 0; i < 2 + Math.floor(r() * 2); i++) {         // bare drooping branches low on the trunk
        const len = h * (.05 + r() * .05);
        p.push({ id: "s" + i, parent: "t", shape: "capsule", size: { r: .004 * h + .02, len },
          pos: [0, h * (-.12 + r() * .2), 0], rot: [0, r() * 360, 95 + r() * 20], pivot: [0, len / 2, 0], color: trunk });
      }
      return p;
    },
  },
  // Scots pine: long bare orange-barked trunk, umbrella crown at the top
  pine: {
    hRange: [22, 33], trunk: 0xa26b42, leaf: 0x3a5230, evergreen: true,
    build(r, h, leaf, trunk) {
      const p = [{ id: "t", parent: null, shape: "capsule", size: { r: .013 * h + .1, len: h * .82 },
                   pos: [0, h * .41, 0], rot: [0, 0, (r() - .5) * 8], color: trunk }];
      const n = 4 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {                              // crown branches, each carrying its foliage
        const a = r() * Math.PI * 2, len = h * (.08 + r() * .09);
        p.push({ id: "b" + i, parent: "t", shape: "capsule", size: { r: .006 * h + .04, len },
          pos: [0, h * (.32 + r() * .16), 0], rot: [0, -a * 180 / Math.PI, 55 + r() * 25],
          pivot: [0, len / 2, 0], color: trunk });
        p.push({ id: "f" + i, parent: "b" + i, shape: "sphere",
          size: { r: h * (.06 + r() * .04) }, scale: [1.5, .55, 1.5],
          pos: [0, len * .95, 0], color: leaf });
      }
      for (let i = 0; i < 2 + Math.floor(r() * 2); i++) {        // bare snags on the long trunk
        const len = h * (.05 + r() * .05);
        p.push({ id: "s" + i, parent: "t", shape: "capsule", size: { r: .004 * h + .02, len },
          pos: [0, h * (-.1 + r() * .3), 0], rot: [0, r() * 360, 75 + r() * 30], pivot: [0, len / 2, 0], color: trunk });
      }
      return p;
    },
  },
  // English oak: short massive trunk, spreading limbs, broad billowing crown
  oak: {
    hRange: [18, 30], trunk: 0x5d4a37, leaf: 0x4d6b2e, autumnC: 0xb0692a,
    build(r, h, leaf, trunk) {
      const tr = .026 * h + .15;
      const p = [{ id: "t", parent: null, shape: "capsule", size: { r: tr, len: h * .38 }, pos: [0, h * .19, 0], color: trunk }];
      const n = 8 + Math.floor(r() * 5);                         // a real crown's worth of primary limbs
      for (let i = 0; i < n; i++) {
        const len = h * (.2 + r() * .14);
        p.push({ id: "b" + i, parent: "t", shape: "capsule", size: { r: tr * (.3 + r() * .15), len },
          pos: [0, h * (.05 + r() * .11), 0], rot: [0, (i + r() * .8) * 360 / n, 25 + r() * 40],
          pivot: [0, len / 2, 0], color: trunk });
        p.push({ id: "f" + i, parent: "b" + i, shape: "sphere", size: { r: h * (.08 + r() * .04) },
          scale: [1.25, .85, 1.25], pos: [0, len * .9, 0], color: leaf });
        if (r() < .55) {                                         // secondary branch forking off, with its own tuft
          const sl = len * (.5 + r() * .2);
          p.push({ id: "s" + i, parent: "b" + i, shape: "capsule", size: { r: tr * .2, len: sl },
            pos: [0, len * (.45 + r() * .25), 0], rot: [0, r() * 360, 30 + r() * 30],
            pivot: [0, sl / 2, 0], color: trunk });
          p.push({ id: "g" + i, parent: "s" + i, shape: "sphere", size: { r: h * (.06 + r() * .03) },
            scale: [1.2, .85, 1.2], pos: [0, sl * .85, 0], color: leaf });
        }
      }
      p.push({ id: "f", parent: null, shape: "sphere", size: { r: h * .14 }, scale: [1.3, .9, 1.3], pos: [0, h * .58, 0], color: leaf });
      return p;
    },
  },
  // Silver birch: slim pale trunk, few steep thin branches, light airy crown
  birch: {
    hRange: [14, 22], trunk: 0xd6d3c9, leaf: 0x71903f, autumnC: 0xd7a92f,
    build(r, h, leaf, trunk) {
      const p = [{ id: "t", parent: null, shape: "capsule", size: { r: .011 * h + .07, len: h * .55 },
                   pos: [0, h * .275, 0], rot: [0, 0, (r() - .5) * 6], color: trunk }];
      const n = 6 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const len = h * (.22 + r() * .12);
        p.push({ id: "b" + i, parent: "t", shape: "capsule", size: { r: .006 * h + .025, len },
          pos: [0, h * (.06 + r() * .18), 0], rot: [0, r() * 360, 12 + r() * 22],   // trunk-local: from the upper half
          pivot: [0, len / 2, 0], color: trunk });
        p.push({ id: "f" + i, parent: "b" + i, shape: "sphere", size: { r: h * (.06 + r() * .03) },
          scale: [.9, 1.15, .9], pos: [0, len * .82, 0], color: leaf });
        if (r() < .4) {                                          // fine twig with a small tuft
          const sl = len * .5;
          p.push({ id: "s" + i, parent: "b" + i, shape: "capsule", size: { r: .003 * h + .015, len: sl },
            pos: [0, len * (.4 + r() * .3), 0], rot: [0, r() * 360, 25 + r() * 25],
            pivot: [0, sl / 2, 0], color: trunk });
          p.push({ id: "g" + i, parent: "s" + i, shape: "sphere", size: { r: h * (.04 + r() * .02) },
            scale: [.9, 1.1, .9], pos: [0, sl * .85, 0], color: leaf });
        }
      }
      return p;
    },
  },
};

export const TREE_SPECIES = Object.keys(SPECIES);

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

export function makeTree(species, { seed = 1, height, autumn = 0, leaf } = {}) {
  const s = SPECIES[species];
  const r = rng(seed * 1013 + 7);
  const h = height ?? s.hRange[0] + r() * (s.hRange[1] - s.hRange[0]);
  let leafC = leaf ?? (s.evergreen || !autumn ? s.leaf : lerpC(s.leaf, s.autumnC, Math.min(1, autumn)));
  leafC = lerpC(leafC, r() > .5 ? 0xffffff : 0x101408, .12 * r());   // per-tree shade variation
  // pattern tags: every woody capsule gets bark streaks, every blob/cone leaf mottle
  const parts = s.build(r, h, leafC, s.trunk).map((p) => ({ ...p, pat: p.shape === "capsule" ? "bark" : "leaf" }));
  return { name: species, parts };
}

// ---- undergrowth & sky ------------------------------------------------------

// bushes: a woody stub with 3-5 overlapping leaf lobes, 0.5-1.4m tall
export function makeBush({ seed = 1, autumn = 0 } = {}) {
  const r = rng(seed * 331 + 7);
  const h = 1.6 + r() * 1.6;   // big real shrubs: 1.6-3.2m tall, similar spread
  let green = lerpC(0x41682f, 0x7d9c48, r());
  if (autumn) green = lerpC(green, 0xb06f2c, autumn * (.3 + r() * .7));
  const parts = [{ id: "stem", parent: null, shape: "capsule", size: { r: .03 + h * .025, len: h * .45 },
                   pos: [0, h * .22, 0], color: 0x5b4326, pat: "bark" }];
  const lobes = 4 + Math.floor(r() * 3);
  for (let i = 0; i < lobes; i++) {
    const a = i / lobes * Math.PI * 2 + r();
    const d = h * (.12 + r() * .24);
    parts.push({ id: `lobe${i}`, parent: null, shape: "sphere", size: { r: h * (.3 + r() * .18) },
      scale: [1.1, .75 + r() * .3, 1.1],
      pos: [Math.cos(a) * d, h * (.42 + r() * .3), Math.sin(a) * d],
      color: lerpC(green, r() > .5 ? 0xffffff : 0x101408, .1 * r()), pat: "leaf" });
  }
  return { name: "bush", parts };
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

// flowers: generous real-world sizes (sunflowers chest-high, foxglove
// spikes, palm-sized poppy and tulip cups). The head is a tilted parent
// sphere; petals are flattened spheres ringed in its local plane, so the
// whole bloom faces out at a natural angle instead of flat up.
export const FLOWERS = ["sunflower", "poppy", "daisy", "tulip", "foxglove"];
export function makeFlower({ seed = 1, kind } = {}) {
  const r = rng(seed * 449 + 11);
  const k = kind ?? FLOWERS[Math.floor(r() * FLOWERS.length)];
  const parts = [];
  const stemC = 0x3f6b2f, leafC = 0x4c7a38;
  const stem = (h, rr = .012) => parts.push({ id: "stem", parent: null, shape: "capsule", size: { r: rr, len: h }, pos: [0, h / 2, 0], color: stemC });
  const leaf = (y, a, s = 1) => parts.push({ id: `leaf${a}`, parent: null, shape: "sphere", size: { r: .09 * s },
    scale: [1.7, .2, .7], pos: [Math.cos(a) * .1, y, Math.sin(a) * .1], rot: [0, -a * 57.3, 0], color: leafC });
  const head = (y, tilt, cR, cC) => parts.push({ id: "head", parent: null, shape: "sphere", size: { r: cR },
    pos: [0, y, 0], rot: [0, r() * 360, tilt], color: cC });
  const petals = (n, d, pr, col, sc = [1.7, .22, .6]) => {
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      parts.push({ id: `pet${i}`, parent: "head", shape: "sphere", size: { r: pr }, scale: sc,
        pos: [Math.cos(a) * d, 0, Math.sin(a) * d], rot: [0, -a * 57.3, 0], color: col });
    }
  };
  if (k === "sunflower") {
    const h = 1.3 + r() * .6;
    stem(h, .018); leaf(h * .45, 1); leaf(h * .7, 4);
    head(h, -55, .09, 0x5a3d1e);
    petals(9, .13, .055, 0xe8c227);
  } else if (k === "poppy") {
    const h = .6 + r() * .35;
    stem(h); leaf(h * .3, 2, .7);
    head(h, -35 - r() * 25, .035, 0x2a2320);
    petals(5, .055, .05, [0xc23428, 0xd84a30, 0xb52a3c][Math.floor(r() * 3)], [1.5, .3, .9]);
  } else if (k === "daisy") {
    const h = .45 + r() * .3;
    stem(h);
    head(h, -30 - r() * 30, .04, 0xe0b62a);
    petals(8, .07, .04, 0xf0eee4);
  } else if (k === "tulip") {
    const h = .5 + r() * .3;
    const col = [0xd8342c, 0xe0a01e, 0x9040b0, 0xe66a9a][Math.floor(r() * 4)];
    stem(h); leaf(h * .35, 0, .9);
    head(h + .04, 0, .05, col);
    petals(4, .045, .05, col, [.7, 1.3, .7]);   // upright cup petals
  } else {   // foxglove: a tall spike of bells
    const h = 1.1 + r() * .6;
    stem(h, .014); leaf(h * .2, 3);
    const col = r() > .5 ? 0xb45ac2 : 0xd87ba8;
    for (let i = 0; i < 7; i++) {
      const t = .45 + i / 7 * .5, a = i * 2.4;
      parts.push({ id: `bell${i}`, parent: null, shape: "sphere", size: { r: .038 * (1 - i / 14) }, scale: [1.25, .9, 1.25],
        pos: [Math.cos(a) * .05, h * t, Math.sin(a) * .05], color: col });
    }
  }
  return { name: k, parts };
}
