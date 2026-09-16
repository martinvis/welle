// TABLEWARE: the mugs and jugs you can drink from and the food on the
// plates you can eat -- and every vessel with WATER in it (the fountain's
// buckets, a farmyard's trough), the same way. Buildings export them as data (`vessels`: kind mug |
// jug, x, y (the table top), z site-local, fill 0..1, drink ale | wine;
// `dishes`: food bread | cheese | sausage, x, y, z) -- not as building parts,
// since these change. A vessel is an OPEN stoneware shell (double-sided: you
// see into it) with a floor, and the drink inside as a disc at its level --
// 90%, 60% or 30% of the way up, or none at all when it is empty; the disc
// is as wide as the vessel's inside at that height. "Drink" takes it one
// level down; "eat" takes the food off its plate. Both go to peers
// (ops "drink", "eat"), like a picked flower.
import * as THREE from "three";

const LEVELS = [.9, .6, .3, 0];
const DRINKS = { ale: 0xa8741f, wine: 0x5a1822, water: 0x5a8a96 };   // (water: the fountain pool's colour)
// the vessels' shapes: round ones by their walls (open cylinders, bottom radius r2, top r1, stacked from the base up) and
// the floor's thickness; box ones (a trough) by outer width x height x depth, wall t and floor thickness
const SHAPES = {
  mug: { color: 0x8b6a4a, floor: .008, walls: [{ r2: .045, r1: .045, h: .12 }] },
  jug: { color: 0x6f5a46, floor: .008, walls: [{ r2: .065, r1: .085, h: .15 }, { r2: .085, r1: .075, h: .1 }] },   // a belly, then a mouth wider than the foot
  bucket: { color: 0x6b4a2c, floor: .02, walls: [{ r2: .11, r1: .13, h: .3 }] },                                     // the fountain's wooden buckets
  trough: { color: 0x9a917f, pat: "ashlar", box: { w: 2.2, h: .5, d: .7, t: .09, floor: .12 } },                     // a stone water trough
};
const FOODS = {
  bread: { shape: "sphere", size: { r: .085 }, scale: [1.4, .6, .9], pos: [0, .06, 0], color: 0xb8803e },
  cheese: { shape: "wedge", size: [.15, .05, .12], pos: [-.06, .04, .05], color: 0xf0c95a },
  sausage: { shape: "cyl", size: { r1: .02, r2: .02, h: .19, seg: 6 }, pos: [0, .035, 0], rot: [0, 0, 90], color: 0x8a3a2a },
};
const WALL = .005;

export function createTableware(scene, { buildBuilding }) {
  const vessels = [], dishes = [];
  const discGeo = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2), rectGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const height = (sh) => sh.box ? sh.box.h : sh.walls.reduce((a, w) => a + w.h, 0), floorOf = (sh) => sh.box ? sh.box.floor : sh.floor;
  const innerR = (sh, y) => {   // the inside radius at height y above the floor of the vessel
    let y0 = 0;
    for (const w of sh.walls) { if (y <= y0 + w.h) return w.r2 + (w.r1 - w.r2) * (y - y0) / w.h - WALL; y0 += w.h; }
    return sh.walls[sh.walls.length - 1].r1 - WALL;
  };
  function level(v) {   // the drink's surface at the vessel's fill (hidden when empty): a disc as wide as the inside, or the trough's rectangle
    const sh = SHAPES[v.kind], H = height(sh), F = floorOf(sh), y = F + v.fill * (H - F);
    v.disc.visible = v.fill > 0;
    v.disc.position.y = y;
    if (sh.box) v.disc.scale.set(sh.box.w - 2 * sh.box.t, 1, sh.box.d - 2 * sh.box.t);
    else v.disc.scale.setScalar(innerR(sh, y));
  }
  function vesselParts(sh) {   // the shell, open at the top (seen into), and its floor
    if (sh.box) {
      const { w, h, d, t, floor } = sh.box, m = { color: sh.color, pat: sh.pat, outline: false };
      return [{ shape: "box", size: [w, floor, d], pos: [0, floor / 2, 0], ...m },
              ...[1, -1].map((s) => ({ shape: "box", size: [w, h, t], pos: [0, h / 2, s * (d - t) / 2], ...m })),
              ...[1, -1].map((s) => ({ shape: "box", size: [t, h, d - 2 * t], pos: [s * (w - t) / 2, h / 2, 0], ...m }))];
    }
    let y = 0;
    const parts = sh.walls.map((w) => { const p = { shape: "cyl", size: { r1: w.r1, r2: w.r2, h: w.h, seg: 10, open: true }, pos: [0, y + w.h / 2, 0], color: sh.color, side: "double", outline: false }; y += w.h; return p; });
    parts.push({ shape: "cyl", size: { r1: sh.walls[0].r2, r2: sh.walls[0].r2, h: sh.floor, seg: 10 }, pos: [0, sh.floor / 2, 0], color: sh.color, outline: false });
    return parts;
  }
  return {
    vessels, dishes,
    // a site's tableware, placed at its world offset (sites stand 1cm up)
    addSite(def, ox, oz) {
      for (const d of def.vessels ?? []) {
        const sh = SHAPES[d.kind] ?? SHAPES.mug;
        const grp = buildBuilding({ name: d.kind, parts: vesselParts(sh) });
        grp.position.set(ox + d.x, d.y + .01, oz + d.z);
        if (d.yaw) grp.rotation.y = d.yaw * Math.PI / 180;
        const disc = new THREE.Mesh(sh.box ? rectGeo : discGeo, new THREE.MeshBasicMaterial({ color: DRINKS[d.drink] ?? DRINKS.ale }));
        grp.add(disc);
        scene.add(grp);
        const v = { ...d, grp, disc, wx: ox + d.x, wy: d.y + .01, wz: oz + d.z, reach: sh.box ? Math.max(sh.box.w, sh.box.d) / 2 : 0 };
        vessels.push(v);
        level(v);
      }
      for (const d of def.dishes ?? []) {
        const grp = buildBuilding({ name: d.food, parts: [{ ...FOODS[d.food], outline: false }] });
        grp.position.set(ox + d.x, d.y + .01, oz + d.z);
        scene.add(grp);
        dishes.push({ ...d, grp, eaten: false, wx: ox + d.x, wy: d.y + .01, wz: oz + d.z });
      }
    },
    // what a click would do here: drink from a vessel with something in it, or eat what lies on a plate -- within reach
    // (standing or seated at the table) and looked at. send: to peers
    nearest(pos, fx, fz, standY, send) {
      let best = null, bd = 1e9;
      const look = (x, y, z, reach = 0) => {   // (reach: a trough's half-length -- drunk from anywhere along it)
        const dx = x - pos.x, dz = z - pos.z, d = Math.hypot(dx, dz);
        if (d > 1.25 + reach || d - reach > bd || y < standY - .3 || y > standY + 1.4) return -1;
        return d < .15 + reach || (dx * fx + dz * fz) / d > .7 - (reach ? .4 : 0) ? Math.max(0, d - reach) : -1;
      };
      vessels.forEach((v, i) => { if (v.fill > 0) { const d = look(v.wx, v.wy, v.wz, v.reach); if (d >= 0) { bd = d; best = { label: `click to drink the ${v.drink}`, act: () => { this.drink(i); send?.({ k: "drink", i, f: v.fill }); } }; } } });
      dishes.forEach((e, i) => { if (!e.eaten) { const d = look(e.wx, e.wy, e.wz); if (d >= 0) { bd = d; best = { label: `click to eat the ${e.food}`, act: () => { this.eat(i); send?.({ k: "eat", i }); } }; } } });
      return best;
    },
    drink(i, to) {   // one level down (or to a peer's level)
      const v = vessels[i];
      if (!v) return;
      v.fill = to ?? (LEVELS.find((l) => l < v.fill - 1e-3) ?? 0);
      level(v);
    },
    eat(i) { const e = dishes[i]; if (e) { e.eaten = true; e.grp.visible = false; } },
    apply(op) { if (op.k === "drink") this.drink(op.i, op.f); else if (op.k === "eat") this.eat(op.i); },   // (a peer's)
  };
}
