// The freight chain: goods and what each of their states means, the
// barge that brings them, the landing's dock hands who unload it, the
// freight carts' stops (load at the quay, unload in a yard), and pieces set
// down on moving floors. index.html hands over the world it needs
// (createFreight(world)) and keeps only the player's side (what you carry).
//
// Goods are a pool of barrels and sacks, two instanced meshes; each item
// is somewhere: in the barge's hold, in a hand's arms, on the quay, on a
// cart's bed, in a yard (where it is consumed after a while and returns
// to the pool), on the ground where you dropped it, or in your arms.
import * as THREE from "three";
import { itemGroup, itemInstanced } from "./architecture.js";   // (the casks, sacks, barge and gangplank are items: assets/items)

// world: { scene, BUILDINGS, LANDING, BASIN, freightLane, bargeDef, createComposite, makePerson, gaitBase,
//          talkers, track, movers, cartUnder, carts, riverZ, riverHW, VILLAGE_X, WLEVEL, waterAt(x, z) (the surface there: a
//          grown map's river falls downstream), handHerds }
export function createFreight(world) {
  const { scene, BUILDINGS, LANDING, BASIN, freightLane, bargeDef, createComposite, makePerson, gaitBase,
          talkers, track, movers, cartUnder, carts, riverZ, riverHW, VILLAGE_X, WLEVEL, waterAt = () => WLEVEL, handHerds } = world;
  const goods = [], goodsSets = {};
  // ONE table of what each state of a piece means. Everything that asks --
  // can it be picked up, does it hold a quay slot, what to release when it
  // moves on -- reads this table, and goodsTo() is the only way to change a
  // state (so leaving the barge's hold or a cart's load is always tidied up).
  //   pick: you can pick it up here   quaySlot: it holds (or has reserved) its quay slot   leave: tidy-up on leaving
  const GOODS = {
    gone:    {},                                                            // back in the pool, out of sight
    hold:    { pick: true, leave: (it) => bargeSt.hold.splice(bargeSt.hold.indexOf(it), 1) },   // in the barge's hold
    carried: { quaySlot: true },                                            // in a dock hand's arms, its quay slot reserved
    quay:    { pick: true, quaySlot: true },                                // on a quay slot, waiting for a cart
    cart:    { pick: true, leave: (it) => { for (const k of carts) { const i = k.items.indexOf(it); if (i >= 0) k.items.splice(i, 1); } } },   // on a freight cart's bed
    store:   { pick: true },                                                // in a yard, consumed after a while
    ground:  { pick: true },                                                // where someone put it down
    riding:  { pick: true, leave: (it) => { it.mover = null; } },           // set down on a moving floor, riding it
    player:  {},                                                            // in your arms
  };
  function goodsTo(it, state) {
    if (!GOODS[state]) throw new Error(`goods: no state "${state}"`);
    if (it.state !== state) GOODS[it.state]?.leave?.(it);
    it.state = state;
    return it;
  }
  // (every placement comes here; the item keeps a copy of where it is -- an arrow stuck in it follows it: archery.js)
  const placeItemM = (it, m) => { goodsSets[it.kind].set(it.idx, m); (it.m ??= new THREE.Matrix4()).copy(m); };
  const _im = new THREE.Matrix4();
  const placeItem = (it, x, y, z, rotY = 0) => { _im.makeRotationY(rotY).setPosition(x, y, z); placeItemM(it, _im); it.x = x; it.y = y; it.z = z; };
  // in someone's arms: a barrel as it is, a sack turned upright (long side vertical), both with their bottom at y
  const _iq = new THREE.Quaternion(), _ie = new THREE.Euler(), _it = new THREE.Vector3(), _iu = new THREE.Vector3(1, 1, 1);
  const placeCarried = (it, x, y, z, rotY) => {
    if (it.kind !== "sack") return placeItem(it, x, y, z, rotY);
    _im.compose(_it.set(x, y + .5, z), _iq.setFromEuler(_ie.set(0, rotY, Math.PI / 2, "YZX")), _iu);
    _im.multiply(new THREE.Matrix4().makeTranslation(0, -.24, 0));   // the ellipsoid's center to the pivot, then stood on end
    placeItemM(it, _im); it.x = x; it.y = y; it.z = z;
  };
  const hideItem = (it) => placeItem(it, 0, -100, 0);
  // Put a piece down where you stand. On a moving floor -- the barge's deck, a
  // cart's bed, the lowered plank -- it RIDES: its place and heading are kept
  // in that floor's own frame and it is placed from the floor's transform
  // every frame (placeRiding), so it sails or rolls away with it.
  const _ri = new THREE.Matrix4(), _rv = new THREE.Vector3();
  const yawOfM = (m) => Math.atan2(-m.elements[2], m.elements[0]);
  function putDown(it, x, y, z, yaw) {
    const k = cartUnder(x, z, y);
    if (k) {
      k.body.updateMatrixWorld();
      goodsTo(it, "riding"); it.mover = k;
      it.local = new THREE.Vector3(x, y + .01, z).applyMatrix4(_ri.copy(k.body.matrixWorld).invert());
      it.lyaw = yaw - yawOfM(k.body.matrixWorld);
      placeRiding();
    } else { goodsTo(it, "ground"); placeItem(it, x, y + .01, z, yaw); }
  }
  function placeRiding() {
    for (const it of goods) {
      if (it.state !== "riding") continue;
      const b = it.mover.body;
      b.updateMatrixWorld();
      _rv.copy(it.local).applyMatrix4(b.matrixWorld);
      placeItem(it, _rv.x, _rv.y, _rv.z, yawOfM(b.matrixWorld) + it.lyaw);
    }
  }
  let bargeSt = null, bargeGrp = null, LANDER = null;   // the barge's state and mesh; the landing's world helpers
  const hands = [];
  if (LANDING && freightLane) {
    const N = 14;
    goodsSets.barrel = itemInstanced("items/furniture/cask", N, { params: { r: .35, h: .95, bulge: .171 } });   // (a big cask, stood on its end: its foot at the origin)
    goodsSets.sack = itemInstanced("items/tools/sack", N);
    scene.add(goodsSets.barrel.root); scene.add(goodsSets.sack.root);
    for (let i = 0; i < N; i++) { goods.push({ kind: "barrel", idx: i, state: "gone" }); goods.push({ kind: "sack", idx: i, state: "gone" }); }
    for (const it of goods) hideItem(it);
    const def = BUILDINGS.landing, L = LANDING;
    LANDER = { x: L.x, z: L.z, slots: def.quaySlots.map(([x, y, z]) => [L.x + x, y, L.z + z]),
               way: def.way.map(([x, y, z]) => [L.x + x, y, L.z + z]), bargeZ: L.z + def.bargeZ };
    // the barge: sails in from 120m downriver, moors at the landing, is unloaded, sails out, waits, comes back laden
    const bd = bargeDef();
    bargeGrp = itemGroup(bd.item); scene.add(bargeGrp);
    bargeSt = { x: BASIN.x - 40, moorX: BASIN.x, outX: BASIN.x - 120, speed: 1.6, phase: "in", t: 0, def: bd, hold: [],
                body: bargeGrp, yaw: 0, carry: { dx: 0, dz: 0, dyaw: 0 }, halfL: bd.halfL, halfW: bd.halfW, top: bd.deckY, side: .35, moving: true };
    movers.push(bargeSt);
    const refill = () => { const pool = goods.filter((g) => g.state === "gone"); for (let i = 0; i < bd.holdSlots.length && pool.length; i++) { const it = pool[i % 2 ? 0 : pool.length - 1]; pool.splice(pool.indexOf(it), 1); goodsTo(it, "hold"); it.slot = i; bargeSt.hold.push(it); } };
    refill();
    // two dock hands, banner people in the folk herd's way: their own little herd
    const handHerd = createComposite(5 * 40); scene.add(handHerd.mesh);   // two hands x two rigs, and the boatman
    for (let i = 0; i < 2; i++) {   // each hand is two rigs: walking free, and walking with a load held out in front
      const pd = makePerson({ seed: 900 + i * 3, adult: true }), pc = makePerson({ seed: 900 + i * 3, pose: "carry", adult: true });
      const an = handHerd.add(pd), anC = handHerd.add(pc);
      const start = LANDER.way[3];
      const post = [start[0] + 1.5 + i * 1.6, .05, start[2] - 2.2];   // each hand's own waiting post on the quay
      const h = { an, anC, base: gaitBase(pd), state: "idle", item: null, wp: [], wi: 0, speed: 1.4, seed: 900 + i * 3, post };
      an.position.set(post[0], post[1] + .04, post[2]); an.animT = 0;
      anC.position.set(0, -100, 0); anC.animT = 0;
      hands.push(h); talkers.push({ p: an, seed: h.seed, kind: pd.kind, figure: () => (anC.down ? anC : an) });   // (figure: the one shown -- struck down, it is silent)
      track(() => [an.position.x, an.position.y, an.position.z, an.rotY, an.animT], (v) => { an.position.set(v[0], v[1], v[2]); an.rotY = v[3]; an.animT = v[4]; }, { angles: [3], live: () => !an.down });
    }
    {   // the boatman: stands at the tiller behind the cabin, rides with the barge, talks
      const pb = makePerson({ seed: 907, still: true, adult: true }), an = handHerd.add(pb);
      an.animT = 0; bargeSt.boatman = an; talkers.push({ p: an, seed: 907, kind: pb.kind });
    }
    // the gangplank: hinged at the barge's north gunwale; a moving floor of its own when lowered
    {
      const pg = itemGroup("items/components/gangplank");
      pg.position.set(-.5, bd.deckY, -1.72); pg.rotation.x = -1.35;   // raised, folded up along the gunwale
      bargeGrp.add(pg);
      bargeSt.plank = pg;
      bargeSt.plankMover = { body: { position: new THREE.Vector3() }, yaw: 0, carry: bargeSt.carry, halfL: .6, halfW: 1.35, top: bd.deckY + .03, active: false };
    }
    handHerds.push(handHerd);
  }
  // the barge's pose along the north side of the river, 8.5m out from the bank line
  const bargePose = (x) => {
    // the lane runs 8.5m off the north bank, but for 30m either side of the bridge it eases onto the river's
    // center line and straightens: the barge passes through the middle arch square, clear of both piers
    const zc = (xx) => {
      const zl = riverZ(xx) - riverHW(xx) + 8.5;
      if (VILLAGE_X === null) return zl;
      const d = Math.abs(xx - VILLAGE_X); if (d >= 30) return zl;
      const t = d / 30, w = t * t * (3 - 2 * t);
      return riverZ(VILLAGE_X) * (1 - w) + zl * w;
    };
    return { x, z: zc(x), yaw: Math.atan2(-(zc(x + .5) - zc(x - .5)), 1) };
  };
  const bargeLocal = ([lx, ly, lz]) => {   // a barge-local point in world space, from the SIM pose (the mesh lags a frame)
    const p = bargePose(bargeSt.x), c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
    return [p.x + lx * c + lz * sn, waterAt(p.x, p.z) + ly, p.z - lx * sn + lz * c];
  };
  const bargeHoldWorld = (it) => bargeLocal(bargeSt.def.holdSlots[it.slot]);
  function placeBarge(frac) {
    if (!bargeSt) return;
    const xv = bargeSt.x + (bargeSt.phase === "in" ? bargeSt.speed * frac : bargeSt.phase === "out" ? -bargeSt.speed * frac : 0);
    const p = bargePose(xv);
    bargeSt.carry.dx += p.x - bargeGrp.position.x; bargeSt.carry.dz += p.z - bargeGrp.position.z;
    bargeSt.carry.dyaw += ((p.yaw - bargeSt.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    bargeSt.yaw = p.yaw;
    bargeGrp.position.set(p.x, waterAt(p.x, p.z), p.z); bargeGrp.rotation.y = p.yaw;
    if (bargeSt.boatman) {   // (struck down, combat.js: he lies on the deck and rides on with it -- only his height and turn are his fall's)
      const w = bargeLocal([-5.3, bargeSt.def.deckY + .04, 0]), bm = bargeSt.boatman;
      bm.position.x = w[0]; bm.position.z = w[2];
      if (!bm.down) { bm.position.y = w[1]; bm.rotY = p.yaw; }
    }
    if (bargeSt.plank) {   // lower the plank when moored, raise it under way; as a floor it exists only when down
      const want = bargeSt.phase === "moored" ? 0 : -1.35;
      bargeSt.plank.rotation.x += (want - bargeSt.plank.rotation.x) * Math.min(1, frac * 0 + .08);
      const pm = bargeSt.plankMover, down = bargeSt.plank.rotation.x > -.08;
      if (down && !pm.active) { movers.push(pm); pm.active = true; }
      if (!down && pm.active) { movers.splice(movers.indexOf(pm), 1); pm.active = false; }
      const w = bargeLocal([-.5, 0, -3.05]); pm.body.position.set(w[0], waterAt(p.x, p.z), w[2]); pm.yaw = p.yaw;
    }
    const c = Math.cos(p.yaw), sn = Math.sin(p.yaw);
    for (const it of bargeSt.hold) { const s = bargeSt.def.holdSlots[it.slot]; placeItem(it, p.x + s[0] * c + s[2] * sn, waterAt(p.x, p.z) + s[1], p.z - s[0] * sn + s[2] * c, p.yaw + (it.kind === "sack" ? Math.PI / 2 : 0)); }
  }
  // the hands' way: the barge's plank end (moored), then the landing's waypoints, then a quay slot
  const bargePlankWorld = () => bargeLocal(bargeSt.def.plankEnd);
  const freeQuaySlot = () => LANDER.slots.findIndex((_, i) => !goods.some((g) => GOODS[g.state].quaySlot && g.slot === i));   // carried pieces hold their slot
  function freightStep(dt) {
    if (!bargeSt) return;
    const B = bargeSt;
    B.t += dt;
    if (B.phase === "in") { B.x += B.speed * dt; if (B.x >= B.moorX) { B.x = B.moorX; B.phase = "moored"; B.t = 0; } }
    else if (B.phase === "moored") { if (!B.hold.length && !hands.some((h) => h.item) && B.t > 12) { B.phase = "out"; B.t = 0; } }
    else if (B.phase === "out") { B.x -= B.speed * dt; if (B.x <= B.outX) { B.phase = "away"; B.t = 0; } }
    else if (B.phase === "away" && B.t > 25) { const pool = goods.filter((g) => g.state === "gone"); for (let i = 0; i < B.def.holdSlots.length && pool.length; i++) { const it = pool.shift(); goodsTo(it, "hold"); it.slot = i; B.hold.push(it); } B.phase = "in"; B.t = 0; }
    B.moving = B.phase === "in" || B.phase === "out";
    // the hands
    for (const h of hands) {
      const p = h.an.position;
      if (h.an.down || h.anC.down) {   // struck down (combat.js): the load dropped where they fell, the item they were after given up
        if (!h.fallen) {
          h.fallen = true;
          if (h.target) { delete h.target.claimed; h.target = null; }
          if (h.item) { const it = h.item, q = (h.anC.down ? h.anC : h.an).position; h.item = null; goodsTo(it, "ground"); placeItem(it, q.x + .6, q.y, q.z, 0); }
        }
        continue;
      }
      h.an.ampT = h.anC.ampT = h.state === "idle" ? 0 : 1;   // the stride settles while they wait
      if (h.state === "idle") {
        h.an.animT += (Math.round(h.an.animT * 1.6) / 1.6 - h.an.animT) * Math.min(1, dt * 10);
        if (B.phase === "moored" && B.hold.some((it) => !it.claimed)) {
          const it = B.hold.find((it) => !it.claimed); it.claimed = true; h.target = it;
          h.wp = [...LANDER.way.slice().reverse(), bargePlankWorld(), bargeHoldWorld(it)]; h.wi = 0; h.state = "toHold";
        }
        continue;
      }
      const wp = h.wp[h.wi], dx = wp[0] - p.x, dz = wp[2] - p.z, d = Math.hypot(dx, dz);
      const step = h.speed * dt;
      if (d <= step) {
        p.set(wp[0], wp[1] + .04, wp[2]);
        if (++h.wi >= h.wp.length) {
          if (h.state === "toHold") {   // pick the item up, carry it to a free quay slot
            const it = h.target; goodsTo(it, "carried"); h.item = it; h.target = null;   // (leaving the hold takes it off the manifest)
            const si = freeQuaySlot(); h.slotI = si < 0 ? 0 : si; it.slot = h.slotI;   // reserved now
            h.wp = [bargePlankWorld(), ...LANDER.way, LANDER.slots[h.slotI]]; h.wi = 0; h.state = "toQuay"; h.speed = 1.1;
          } else if (h.state === "toQuay") {   // set it down, then step back to the waiting post
            const it = h.item, sl = LANDER.slots[h.slotI]; goodsTo(it, "quay"); it.slot = h.slotI; delete it.claimed;
            placeItem(it, sl[0], sl[1], sl[2], it.kind === "sack" ? Math.PI / 2 : 0); h.item = null; h.speed = 1.5;
            h.state = "toPost"; h.wp = [h.post]; h.wi = 0;
          } else { h.state = "idle"; h.wp = []; }   // at the post
        }
      } else {
        p.x += dx / d * step; p.z += dz / d * step;
        const t = step / d; p.y += (wp[1] + .04 - p.y) * Math.min(1, t * 1.0 + .02);
        h.an.rotY = Math.atan2(-dz, dx);
        h.an.animT += dt * h.speed / h.base;
      }
    }
    // yards consume: a delivered item is gone after 90s (and the barge will bring it back)
    for (const it of goods) if (it.state === "store") { it.age = (it.age ?? 0) + dt; if (it.age > 90) { goodsTo(it, "gone"); it.age = 0; hideItem(it); } }
  }
  function freightStopStep(k, dt) {   // a freight cart at its stops: load at the quay, unload at a yard
    if (k.halt) {
      k.halt.t += dt;
      const st = k.halt.stop;
      if (k.halt.t >= 3) {
        k.halt.t = 0;
        if (st.kind === "load") {
          const it = goods.find((g) => g.state === "quay");
          if (it && k.items.length < k.c.capacity) { goodsTo(it, "cart"); k.items.push(it); k.halt.idle = 0; }
          else k.halt.idle = (k.halt.idle ?? 0) + 1;
          if (k.items.length >= k.c.capacity || k.halt.idle >= 2) { k.halt = null; k.passed = st; }
        } else {
          const it = k.items.shift();
          if (it) { const y = st.yard, si = y.slots.findIndex((_, i) => !goods.some((g) => g.state === "store" && g.yard === y && g.slot === i));
            if (si >= 0) { const sl = y.slots[si]; goodsTo(it, "store"); it.yard = y; it.slot = si; it.age = 0; placeItem(it, sl[0], sl[1], sl[2], it.kind === "sack" ? Math.PI / 2 : 0); }
            else { goodsTo(it, "gone"); hideItem(it); } }
          if (!k.items.length) { k.halt = null; k.passed = st; }
        }
      }
      return;
    }
    for (const st of k.stops) {
      const d = Math.abs(k.s - st.s);
      if (d > 6 && k.passed === st) k.passed = null;
      if (d < .6 && k.passed !== st) { k.halt = { stop: st, t: 0 }; k.s = st.s; break; }
    }
  }
  return { goods, goodsSets, GOODS, goodsTo, placeItemM, placeCarried, putDown, placeRiding, hands, bargeSt, bargePose, placeBarge, freightStep, freightStopStep };
}
