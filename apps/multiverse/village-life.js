// Village life: the villagers' day. Every villager has a HOME -- a house and
// a place in one of its beds (the houses export `beds`; two to a bed, as
// families slept) -- and a JOB: a work spot some building exports
// (folkSpots with role "work": the miller, the inn's keeper, the market's
// vendors, baker, potter, smith, weaver, spinner, tailor, the priest, a
// fisher on the jetty), or carrying sacks between home and the mill (wheat
// there, or back with flour), or -- everyone else -- farming: a place in a
// field, the orchard or the currant rows.
//
// The day (night is the world's N switch, the hours the real clock's bell):
//   night   home to bed, asleep -- but the keeper keeps the inn, and some go
//           to the inn to eat first (if a seat is free), then home
//   hours   when the bell strikes, half of those awake go to church and sit
//           (or stand at the back) ten minutes, then go on
//   work    at their spot, arms busy (a gesture by trade: hoeing, selling,
//           kneading...); now and then an outing -- to the inn to eat (a seat
//           free), to the market or a shop to buy -- then back to work
//   errand  a carrier walks sacks between home and the mill
//   inn     never empty: at least MIN_INN guests, day and night -- one whose
//           meal is over waits until someone new has come in and sat down
//   bard    the fountain's musician (a work spot flagged `bard`): the demo
//           plays their songs while they stand there (bards())
// Walking: out of the door (down the stairs first, from an upstairs bed),
// the path network's shortest way (paths.js routeGraph), in at the door,
// to the spot; doors open as they pass. Each villager is one person in four
// poses (walking, seated, lying, carrying a sack) -- four composite
// entries, one shown -- moved on the world's fixed tick by its own seeded
// stream (deterministic, like every wanderer) and drawn between ticks by the
// shared tracks.
import { rng } from "./flora.js";
import { laneFrom } from "./paths.js";
import { handIndex } from "./tools.js";

const CHURCH = 600, EAT = [240, 420], SHOP = [100, 200], WORK = [60, 150], WAIT = [30, 90], HANDOVER = [20, 40];   // seconds
const HOME = /^(cottage|farmhouse)/, FARM = /Field$|^berries$|^orchard$/;
// farm work by what grows there (people.js GESTURES; the tool rides in the right hand)
const FARMWORK = (key) => (/^(rye|barley)/.test(key) ? ["mow", "scythe"] : /^soil/.test(key) ? ["dig", "spade"] : /Field$/.test(key) ? ["hoe", "hoe"] : ["pick", null]);
const MIN_INN = 3;

// world: { sites (the village's and hamlet's), BUILDINGS, siteZ, supportAt, router (routeGraph), makePerson,
//          gaitBase, herd (a composite), track, talkers, isNight(), bellHour(), doors, count }
export function createVillageLife(world) {
  const { sites, BUILDINGS, siteZ, supportAt, router, makePerson, gaitBase, herd, track, talkers, isNight, bellHour, doors = [], count = 32 } = world;
  const toW = (s, x, z) => [s.x + x, siteZ(s) + z];
  const doorOf = new Map(sites.map((s) => {
    const d = BUILDINGS[s.key].doors?.[0];
    if (!d) return [s, null];
    const alongZ = Math.abs(Math.abs(d.yaw ?? 0) - 90) < 1;   // a doorway spanning z sits in a wall facing x
    const nx = alongZ ? -Math.sign(d.x || 1) : 0, nz = alongZ ? 0 : -Math.sign(d.z || 1);   // inward: toward the middle
    return [s, { inn: toW(s, d.x + nx * 1.0, d.z + nz * 1.0), out: toW(s, d.x - nx * 1.3, d.z - nz * 1.3) }];
  }));
  // a place to be: where (x, y the floor or seat top, z), facing h, in what pose, reached through the
  // site's door and `via` (inside the house), `goal` the last step (a bed's foot); `by` who has it
  const spot = (s, x, y, z, o = {}) => { const [wx, wz] = toW(s, x, z); return { s, x: wx, y, z: wz, h: 0, pose: "stand", via: [], goal: [wx, wz], door: doorOf.get(s), by: null, ...o }; };
  const WORKS = [], EATS = [], SHOPS = [], PEWS = [], FIELDS = [], BEDS = [];
  let MILL = null;
  for (const s of sites) {
    const def = BUILDINGS[s.key];
    for (const sp of def.folkSpots ?? []) {
      const q = spot(s, sp.x, sp.pose === "sit" ? sp.y : sp.y + .01, sp.z, { h: sp.h, pose: sp.pose === "sit" ? "sit" : "stand", bard: !!sp.bard,
                     gesture: sp.gesture ?? (sp.role === "work" ? "sell" : s.key === "tavern" && sp.pose === "sit" ? "eat" : null), tool: sp.tool ?? null });
      (sp.role === "work" ? WORKS : s.key === "tavern" ? EATS : s.key === "church" ? PEWS : SHOPS).push(q);
    }
    if (def.drop) MILL = spot(s, def.drop.x, 0, def.drop.z, { shared: true, door: null, h: Math.PI / 2 });
    if (FARM.test(s.key)) {   // a few places spread over the field, each facing its own way
      const [fw, fd] = def.footprint, r = rng(s.x * 7 + 11), [gesture, tool] = FARMWORK(s.key);
      for (const [a, b] of [[-.3, -.25], [.3, .25], [-.3, .3], [.3, -.3]]) {
        const x = a * (fw - 3), z = b * (fd - 3);
        FIELDS.push(spot(s, x, supportAt(s.x + x, siteZ(s) + z, 1e9), z, { h: r() * Math.PI * 2, door: null, gesture, tool }));
      }
    }
    if (HOME.test(s.key) && def.beds) {
      const up = (def.ways?.up ?? []).map(([x, z]) => toW(s, x, z));
      def.beds.forEach((b, i) => { for (const o of [-.38, .38]) {   // two sleepers to a bed, side by side
        const q = spot(s, b.x + o, b.y + .05, b.z, { pose: "lie", h: Math.PI / 2, via: b.storey ? up : [], goal: toW(s, b.x + o, b.foot[1]) });
        q.slot = i * 2 + (o > 0); BEDS.push(q);
      } });
    }
  }
  // the church's back, for those the pews cannot seat: standing a step inside the door
  const church = sites.find((s) => s.key === "church"), cd = church && doorOf.get(church);
  if (cd) for (let k = 0; k < 10; k++) {
    const [ix, iz] = cd.inn, [ox, oz] = cd.out, nx = (ix - ox) / 2.3, nz = (iz - oz) / 2.3;   // inward unit (door in/out are 2.3m apart)
    const u = (k % 5 - 2) * .75, w = .4 + Math.floor(k / 5) * .8;
    PEWS.push({ s: church, x: ix + nx * w - nz * u, y: supportAt(ix, iz, 1e9) + .01, z: iz + nz * w + nx * u, h: Math.atan2(-nz, nx), pose: "stand", via: [], goal: null, door: cd, by: null, back: true });
    PEWS[PEWS.length - 1].goal = [PEWS[PEWS.length - 1].x, PEWS[PEWS.length - 1].z];
  }
  // field places round the fields: every field's first place, then every second place... -- the farmers
  // spread over all the crops (grain, vegetables, the plowed field, the fruit) before any field gets two
  FIELDS.forEach((q, i) => { q.slot = i - FIELDS.findIndex((p) => p.s === q.s); });
  FIELDS.sort((a, b) => a.slot - b.slot);
  // beds house by house, slot by slot: villagers fill every house before any bed takes a second sleeper
  BEDS.sort((a, b) => a.slot - b.slot);
  const n = Math.min(count, BEDS.length);

  // ---- the villagers
  const vs = [];
  const keeperSpot = WORKS.find((q) => q.s.key === "tavern");
  const jobs = [...WORKS, ...(MILL ? ["carry", "carry"] : [])];
  for (let i = 0; i < n; i++) {
    const seed = 500 + i * 13, r = rng(seed * 31 + 7);
    const walkDef = makePerson({ seed, adult: true }), sitDef = makePerson({ seed, adult: true, pose: "sit" });
    const lieDef = makePerson({ seed, adult: true, pose: "lie" }), carryDef = makePerson({ seed, adult: true, pose: "carry" });
    const S = walkDef.hipY / .919, tall = walkDef.hipY / .525;   // the body's scale and height (people.js: hips at .525 of the height)
    carryDef.parts.push({ id: "load", parent: "pelvis", shape: "capsule", size: { r: .16 * S, len: .22 * S }, geomRot: [90, 0, 0], pos: [.3 * S, .3 * S, 0], color: 0xcbb68c, edge: 0 });   // the sack in the arms
    const job = jobs[i] ?? "farm";
    const workSpot = job === "farm" ? FIELDS[(i - jobs.length) % Math.max(1, FIELDS.length)] : typeof job === "string" ? null : job;
    const vr = { walk: herd.add(walkDef), sit: herd.add(sitDef), lie: herd.add(lieDef), carry: herd.add(carryDef) };
    const bed = BEDS[i], house = bed.s, hd = doorOf.get(house);
    const v = { id: i, r, vr, sitAt: sitDef.sitAt, tall, hand: handIndex(walkDef), base: gaitBase(walkDef), speed: 1.1 + r() * .4, bed, house, job, trip: 0, load: false,
                work: workSpot,
                keeper: job === keeperSpot, homeStand: { s: house, x: hd.inn[0], y: .16, z: hd.inn[1], h: 0, pose: "stand", via: [], goal: hd.inn, door: hd, by: null, shared: true },
                pos: [0, 0, 0], h: 0, animT: r() * 10, at: null, lane: null, s: 0, goal: null, until: 0, night: null };
    if (v.work && typeof job !== "string" && job !== "farm") v.work.by = v;
    vs.push(v);
    // (figure: the pose shown now -- its face is the one that changes; asleep: in bed, where only a cough or a sneeze comes)
    talkers.push({ p: vr.walk, seed, kind: walkDef.kind, figure: () => Object.values(vr).find((an) => !an.hidden) ?? vr.walk, asleep: () => v.at === v.bed && !v.lane });
    track(() => [v.pos[0], v.pos[1], v.pos[2], v.h, v.animT], (a) => place(v, a), { angles: [3] });
  }
  const rand = (v, [a, b]) => a + v.r() * (b - a);
  const show = (v, k) => { for (const key in v.vr) v.vr[key].hidden = key !== k; };
  function place(v, a) { if (v.down) return; for (const key in v.vr) { const an = v.vr[key]; an.position.set(a[0], a[1], a[2]); an.rotY = a[3]; an.animT = a[4]; } }
  const free = (list, v) => { const f = list.filter((q) => !q.by || q.by === v); return f.length ? f[Math.floor(v.r() * f.length)] : null; };

  // ---- walking: from where they are to a spot
  const exitOf = (sp) => (sp.door ? [...[...sp.via].reverse(), sp.door.inn, sp.door.out] : []);
  const entryOf = (sp) => (sp.door ? [sp.door.out, sp.door.inn, ...sp.via] : []);
  function pathTo(v, sp) {
    const from = [v.pos[0], v.pos[2]], at = v.at;
    let pts;
    if (at && at.s === sp.s && sp.door && at.door === sp.door) pts = [from, ...[...at.via].reverse(), sp.door.inn, ...sp.via];   // within one house
    else {
      const out = at ? exitOf(at) : [], inn = entryOf(sp);
      const a = out.length ? out[out.length - 1] : from, b = inn.length ? inn[0] : sp.goal;
      pts = [from, ...out, ...router.route(a, b), ...inn];
    }
    pts.push(sp.goal);
    return pts.filter((p, i) => !i || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > .05);
  }
  function go(v, sp, t, dur, onArrive) {
    const pts = pathTo(v, sp);
    if (v.at && !v.at.shared && v.at.by === v) v.at.by = null;
    if (!sp.shared) sp.by = v;
    Object.assign(v, { at: null, goal: sp, dur, onArrive, s: 0, lane: pts.length > 1 ? laneFrom(pts) : null });
    show(v, v.load ? "carry" : "walk");
    for (const key in v.vr) v.vr[key].work = 0;
    v.vr.walk.ampT = v.vr.carry.ampT = 1;
    if (!v.lane) arrive(v, t);
  }
  function arrive(v, t) {
    const sp = v.goal, cb = v.onArrive;
    v.lane = null; v.onArrive = null;
    cb?.();
    settle(v, sp);
    v.until = t + v.dur;
    if (v.pending) { const [q, d] = v.pending; v.pending = null; go(v, q, t, d); }
  }
  function settle(v, sp) {   // arrived: take the spot's pose
    v.at = sp; v.h = sp.h;
    let k;
    if (sp.pose === "lie") { k = "lie"; v.pos = [sp.x, sp.y, sp.z + v.tall * .47]; }   // the lying figure runs from its origin (the feet) along +x: head to the headboard (-z)
    else if (sp.pose === "sit") { k = "sit"; v.pos = [sp.x, v.sitAt(sp.y), sp.z]; }
    else { k = v.load ? "carry" : "walk"; v.pos = [sp.x, sp.y, sp.z]; }
    show(v, k);
    for (const key in v.vr) v.vr[key].work = 0;
    if (sp.gesture && !v.load) Object.assign(v.vr[k], { gesture: sp.gesture, work: 1 });   // hands busy: the spot's trade (or a guest's meal)
    v.vr.walk.ampT = v.vr.carry.ampT = 0;
    place(v, [...v.pos, v.h, v.animT]);
  }

  // ---- the inn: never fewer than MIN_INN guests (seated, or on their way in)
  const lifeR = rng(4711);
  const inInn = (v) => EATS.includes(v.lane ? v.goal : v.at);
  const guests = () => vs.reduce((n, v) => n + inInn(v), 0);
  function recruit(t) {   // someone idle comes in to eat: the awake first; by night, if need be, one gets up again
    const idle = vs.filter((v) => !v.lane && !v.keeper && v.job !== "carry" && !inInn(v) && !PEWS.includes(v.at));
    const awake = idle.filter((v) => v.at !== v.bed), pool = awake.length ? awake : idle;
    const q = pool.length && free(EATS, pool[0]);
    if (!q) return;
    const v = pool[Math.floor(lifeR() * pool.length)];
    v.ate = true;   // (by night: back to bed after the meal)
    go(v, q, t, rand(v, EAT));
  }

  // ---- what next
  function decide(v, t) {
    const night = isNight();
    if (night !== v.night) { v.night = night; v.ate = false; v.eatTonight = v.r() < .25; }
    if (EATS.includes(v.at)) {   // the meal is over -- but nobody leaves an inn that would drop below MIN_INN
      if (guests() - 1 < MIN_INN) recruit(t);
      if (vs.filter((u) => u !== v && EATS.includes(u.at)).length < MIN_INN) { v.until = t + 10; return; }   // stay till the newcomer sits
    }
    if (night && !v.keeper) {
      if (v.eatTonight && !v.ate && v.at?.s.key !== "tavern") { const q = free(EATS, v); v.ate = true; if (q) return go(v, q, t, rand(v, EAT)); }
      if (v.at === v.bed) { v.until = t + 20; return; }   // asleep
      return go(v, v.bed, t, 20);
    }
    if (v.job === "carry") {   // trips alternate: wheat carried to the mill, or flour carried home
      if (v.at === MILL) { v.load = v.trip % 2 === 1; return go(v, v.homeStand, t, rand(v, WAIT), () => { v.load = false; v.trip++; }); }
      v.load = v.trip % 2 === 0;
      return go(v, MILL, t, rand(v, HANDOVER), () => { v.load = false; });
    }
    if (v.at === v.work) {   // at work: now and then an outing
      const u = v.r();
      if (u < .06 && !v.keeper) { const q = free(EATS, v); if (q) return go(v, q, t, rand(v, EAT)); }
      else if (u < .14 && !v.keeper) { const q = free(SHOPS, v); if (q) return go(v, q, t, rand(v, SHOP)); }
      v.until = t + rand(v, WORK);
      return;
    }
    return go(v, v.work, t, rand(v, WORK));
  }
  // the bell: half of those awake (a different half each hour) to church for ten minutes
  function bell(t, hour) {
    for (const v of vs) {
      if (v.down) continue;   // (struck down, combat.js)
      if ((v.id + hour) % 2 || v.at === v.bed || v.goal === v.bed || v.keeper) continue;
      const q = free(PEWS.filter((p) => !p.back), v) ?? free(PEWS, v);
      if (!q) continue;
      q.by = v;
      if (v.lane) v.pending = [q, CHURCH];   // on their way somewhere: church once they get there
      else { v.load = false; go(v, q, t, CHURCH); }
    }
  }
  // doors swing open as they pass (and shut behind them): only doors of the village's own buildings
  const ours = doors.filter((d) => !d.win && sites.some((s) => { const f = BUILDINGS[s.key].footprint; return Math.abs(d.wx - s.x) < f[0] / 2 + 1 && Math.abs(d.wz - siteZ(s)) < f[1] / 2 + 1; }));
  function doorsTick() {
    for (const d of ours) {
      const near = vs.some((v) => v.lane && Math.abs(v.pos[0] - d.wx) < 1.7 && Math.abs(v.pos[2] - d.wz) < 1.7 && Math.abs(v.pos[1] - d.wy) < 1.6);
      if (near && !d.open) { d.open = true; d.byLife = true; }
      else if (!near && d.byLife) { d.open = false; d.byLife = false; }
    }
  }

  let started = false, lastHour = -1;
  function start(t) {   // at their places when the world begins: in bed by night, at work by day
    const night = isNight();
    for (const v of vs) {
      if (v.down) continue;   // (struck down, combat.js)
      v.night = night; v.eatTonight = false;
      const sp = night && !v.keeper ? v.bed : v.job === "carry" ? v.homeStand : v.work;
      if (!sp.shared) sp.by = v;
      settle(v, sp);
      v.until = t + v.r() * 60;
    }
    // the inn starts with its company already seated: farmers off work for a meal
    for (const v of vs.filter((u) => u.job === "farm").slice(0, MIN_INN)) {
      const q = free(EATS, v); if (!q) break;
      v.at.by = null; q.by = v; settle(v, q); v.until = t + rand(v, EAT);
    }
    started = true;
  }
  function step(t) {   // one fixed tick of the world
    if (!started) start(t);
    const hr = bellHour();
    if (hr >= 0 && hr !== lastHour) { if (lastHour !== -2) bell(t, hr); lastHour = hr; }
    const dt = world.TICK ?? .05;
    for (const v of vs) {
      if (v.down) continue;   // (struck down, combat.js)
      if (v.lane) {
        v.s = Math.min(v.lane.total, v.s + v.speed * dt);
        const [x, z] = v.lane.at(v.s);
        v.h = v.lane.heading(v.s);
        v.pos = [x, supportAt(x, z, v.pos[1] + .6) + .01, z];
        v.animT += v.speed * dt / v.base;
        if (v.s >= v.lane.total - 1e-6) arrive(v, t);
      } else if (t >= v.until) decide(v, t);
    }
    if (guests() < MIN_INN) recruit(t);
    doorsTick();
  }
  const where = (v) => (v.lane ? "walking to " + (v.goal === v.bed ? "bed" : v.goal.s.key) : v.at === v.bed ? "asleep" : (v.at?.s.key ?? "?") + (v.at === v.work ? " (work)" : ""));
  return {
    step, villagers: vs,
    bell: (hour = 12, t) => bell(t ?? vs[0]?.until ?? 0, hour),   // (checks: ring it now)
    census: () => vs.map((v) => ({ id: v.id, job: typeof v.job === "string" ? v.job : v.job.s.key, home: v.house.key, where: where(v), load: v.load, pos: v.pos.map((c) => +c.toFixed(2)) })),
    router, pathTo, guests,   // (checks)
    // who holds a tool now (at their work spot, standing, hands free): for tools.js to put it in their hand
    holders: () => vs.filter((v) => !v.down && !v.lane && v.at === v.work && v.work?.tool && !v.load).map((v) => ({ an: v.vr.walk, tool: v.work.tool, hand: v.hand })),
    bards: () => vs.filter((v) => v.at?.bard).map((v) => ({ id: v.id, seed: 500 + v.id * 13, pos: v.pos })),   // who is playing at their pitch now
    // one of a villager's figures struck down (combat.js): they lie where they fell, their day over, their spot freed
    strike(an) {
      const v = vs.find((u) => Object.values(u.vr).includes(an));
      if (!v || v.down) return false;
      v.down = true; v.lane = null;
      if (v.at && !v.at.shared && v.at.by === v) v.at.by = null;
      if (v.work?.by === v) v.work.by = null;
      return true;
    },
    places: { works: WORKS.length, eats: EATS.length, shops: SHOPS.length, pews: PEWS.length, fields: FIELDS.length, beds: BEDS.length, mill: !!MILL },
  };
}
