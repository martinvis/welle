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
import { ASSETS } from "./catalogue.js";
import { itemGroup } from "./architecture.js";
import { farHide } from "./farhide.js";

const LEVELS = [.9, .6, .3, 0];
const DRINKS = { ale: 0xa8741f, wine: 0x5a1822, water: 0x5a8a96 };   // (water: the fountain pool's colour)
// THE VESSELS ARE ITEMS (assets/items/tableware/<kind>: tools/propgen.py), and their shape is read from them: a round
// one's inside from its `walls` lathe (the profile, [radius, height] from the base up) and its `floor` param, a box one
// (the trough) from its w x h x d, wall t and floor params -- so the drink fills whatever the item is drawn as
const shapeOf = (kind) => {
  const path = `items/tableware/${ASSETS.has(`items/tableware/${kind}`) ? kind : "mug"}`, doc = ASSETS.get(path), P = doc.params ?? {};
  const walls = doc.parts.find((q) => q.id === "walls");
  return walls ? { path, floor: P.floor, profile: walls.profile } : { path, floor: P.floor, box: { w: P.w, h: P.h, d: P.d, t: P.t } };
};
const SHAPES = new Map();
const SHAPE = (kind) => { if (!SHAPES.has(kind)) SHAPES.set(kind, shapeOf(kind)); return SHAPES.get(kind); };
// the food on a plate: items too (assets/items/food)
const FOODS = { bread: "items/food/plain-loaf", cheese: "items/food/cheese-slice", sausage: "items/food/sausage" };
const WALL = .005;

export function createTableware(scene) {
  const vessels = [], dishes = [];
  const discGeo = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2), rectGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // one material per DRINK, not per vessel: there are three or four drinks in the world and seventy vessels,
  // and a material apiece was seventy shaders and seventy pipeline switches for a disc of sixteen triangles
  const drinkMats = new Map();
  const drinkMat = (c) => {
    if (!drinkMats.has(c)) drinkMats.set(c, new THREE.MeshBasicMaterial({ color: c }));
    return drinkMats.get(c);
  };
  const height = (sh) => sh.box ? sh.box.h : sh.profile[sh.profile.length - 1][1];
  const innerR = (sh, y) => {   // the inside radius at height y above the vessel's base: along its walls' profile
    const pr = sh.profile;
    for (let i = 1; i < pr.length; i++) if (y <= pr[i][1]) return pr[i - 1][0] + (pr[i][0] - pr[i - 1][0]) * (y - pr[i - 1][1]) / (pr[i][1] - pr[i - 1][1]) - WALL;
    return pr[pr.length - 1][0] - WALL;
  };
  function level(v) {   // the drink's surface at the vessel's fill (hidden when empty): a disc as wide as the inside, or the trough's rectangle
    const sh = SHAPE(v.kind), H = height(sh), F = sh.floor, y = F + v.fill * (H - F);
    v.disc.visible = v.fill > 0;
    v.disc.position.y = y;
    if (sh.box) v.disc.scale.set(sh.box.w - 2 * sh.box.t, 1, sh.box.d - 2 * sh.box.t);
    else v.disc.scale.setScalar(innerR(sh, y));
  }
  return {
    vessels, dishes,
    // a site's tableware, placed at its world offset (sites stand 1cm up)
    addSite(def, ox, oz) {
      // one group per site for everything on its tables: the world switches it off from afar (farhide.js), and it is
      // one top-level node instead of one per mug. The pieces keep their world coordinates: the group stays at the origin.
      const n = (def.vessels?.length ?? 0) + (def.dishes?.length ?? 0); if (!n) return;
      const site = new THREE.Group(); site.name = "tableware"; scene.add(site);
      let sx = 0, sy = 0, sz = 0, far = 0;
      for (const d of [...(def.vessels ?? []), ...(def.dishes ?? [])]) { sx += d.x / n; sy += d.y / n; sz += d.z / n; }
      for (const d of [...(def.vessels ?? []), ...(def.dishes ?? [])]) far = Math.max(far, Math.hypot(d.x - sx, d.z - sz));
      farHide(site, [ox + sx, sy, oz + sz], 45 + far);
      for (const d of def.vessels ?? []) {
        const sh = SHAPE(d.kind), grp = itemGroup(sh.path);
        grp.position.set(ox + d.x, d.y + .01, oz + d.z);
        if (d.yaw) grp.rotation.y = d.yaw * Math.PI / 180;
        const disc = new THREE.Mesh(sh.box ? rectGeo : discGeo, drinkMat(DRINKS[d.drink] ?? DRINKS.ale));
        grp.add(disc);
        site.add(grp);
        const v = { ...d, grp, disc, wx: ox + d.x, wy: d.y + .01, wz: oz + d.z, reach: sh.box ? Math.max(sh.box.w, sh.box.d) / 2 : 0 };
        vessels.push(v);
        level(v);
      }
      for (const d of def.dishes ?? []) {
        const grp = itemGroup(FOODS[d.food] ?? FOODS.bread);
        grp.position.set(ox + d.x, d.y + .01, oz + d.z);
        site.add(grp);
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
