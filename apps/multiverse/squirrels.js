// Squirrels: they live in the trees. A dash across the ground to a
// neighbouring trunk, up it head first, a pause up there, down again head
// first, a moment's watch at the foot, the next tree -- round a grove,
// never out on the open grass. On a trunk the body hangs on it: the
// skeleton's root takes a pitch (an.pitch, radians: +pi/2 nose up, the
// belly to the bark), the feet on the trunk's surface. Each squirrel runs
// on the world's fixed tick by its own seeded stream (deterministic, like
// every wanderer) and is drawn between ticks by the shared tracks.
import { rng } from "./flora.js";

const RUN = 3.2, CLIMB = 1.1;   // m/s on the ground, up or down a trunk
const PAUSE_TOP = [2, 7], PAUSE_FOOT = [.6, 2.2];
const FOOT = .12;   // the lowest hold on a trunk (its segments start a little under the ground)

// the trunk at height y above its foot: the axis point, the bark's radius there and the axis direction --
// along the tree's own trunk segments (tr.trunk, world space: it leans and wobbles), else straight up
function trunkAt(tr, y) {
  const T = tr.trunk;
  if (!T?.length) return { c: [tr.x, tr.y0 + y, tr.z], r: tr.r, d: [0, 1, 0] };
  const Y = T[0].a[1] + y;
  for (let i = 0; i < T.length; i++) {
    const g = T[i];
    if (Y > g.b[1] && i < T.length - 1) continue;
    const u = Math.max(0, Math.min(1, (Y - g.a[1]) / Math.max(1e-6, g.b[1] - g.a[1])));
    const d = [g.b[0] - g.a[0], g.b[1] - g.a[1], g.b[2] - g.a[2]], l = Math.hypot(...d) || 1;
    return { c: [g.a[0] + d[0] * u, g.a[1] + d[1] * u, g.a[2] + d[2] * u], r: g.r0 + (g.r1 - g.r0) * u, d: d.map((v) => v / l) };
  }
}
const trunkTop = (tr) => (tr.trunk?.length ? tr.trunk[tr.trunk.length - 1].b[1] - tr.trunk[0].a[1] : tr.h * .5);

// world: { def (the squirrel rig), herd, trees ([{ x, z, r, h, trunk }], the trunks), groundH, gaitBase, track, count, TICK }
export function createSquirrels({ def, herd, trees, groundH, gaitBase, track, count = 14, TICK = .05, seed = 77 }) {
  // the groves: every trunk with a neighbour within a dash (3..18m); squirrels live only there
  const near = trees.map((a) => trees.filter((b) => b !== a && Math.hypot(b.x - a.x, b.z - a.z) > 3 && Math.hypot(b.x - a.x, b.z - a.z) < 18));
  const homes = trees.map((t, i) => i).filter((i) => near[i].length);
  if (!homes.length) return { step() {}, squirrels: [] };
  const base = gaitBase(def), r0 = rng(seed);
  const rand = (s, [a, b]) => a + s.r() * (b - a);
  for (const tr of trees) tr.y0 = groundH(tr.x, tr.z);
  const sq = [];
  for (let i = 0; i < count; i++) {
    const ti = homes[Math.floor(r0() * homes.length)], tr = trees[ti], a = r0() * Math.PI * 2;
    const s = { an: herd.add(def), r: rng(seed * 31 + i * 7919), ti, tr, a, state: "foot", until: r0() * 3, y: FOOT,
                pos: [0, 0, 0], h: 0, pitch: 0, animT: r0() * 10, to: null };
    onTrunk(s, false); s.pitch = 0; s.pos[1] = groundH(s.pos[0], s.pos[2]);
    sq.push(s);
    track(() => [s.pos[0], s.pos[1], s.pos[2], s.h, s.animT, s.pitch], (v) => place(s, v), { angles: [3, 5] });
  }
  function place(s, v) { const an = s.an; if (an.down) return; an.position.set(v[0], v[1], v[2]); an.rotY = v[3]; an.animT = v[4]; an.pitch = v[5]; }   // (struck down, combat.js: it lies where it fell)
  const gait = (s, moving, run) => { s.an.ampT = moving ? 1 : 0; s.an.runT = run ? 1 : 0; };
  // on the trunk at angle a round it, height y above its foot: the feet on the bark (.03 out), the body along
  // the trunk -- head up (facing it) or head down (facing away) -- pitched to the bole's own slant there
  function onTrunk(s, up) {
    const k = trunkAt(s.tr, s.y), ox = Math.cos(s.a), oz = Math.sin(s.a);
    s.pos = [k.c[0] + ox * (k.r + .03), k.c[1], k.c[2] + oz * (k.r + .03)];
    const fx = up ? -ox : ox, fz = up ? -oz : oz, D = up ? k.d : k.d.map((v) => -v);   // forward on the ground plane; the way the body points
    s.h = Math.atan2(-fz, fx);
    s.pitch = Math.atan2(D[1], D[0] * fx + D[2] * fz);
  }

  function step(t) {
    const dt = TICK;
    for (const s of sq) {
      if (s.an.down) continue;   // (struck down, combat.js)
      if (s.state === "run") {   // the dash to the next trunk's foot
        const [tx, tz] = s.to, dx = tx - s.pos[0], dz = tz - s.pos[2], d = Math.hypot(dx, dz), m = Math.min(d, RUN * dt);
        s.h = Math.atan2(-dz, dx);
        s.pos[0] += dx / (d || 1) * m; s.pos[2] += dz / (d || 1) * m; s.pos[1] = groundH(s.pos[0], s.pos[2]);
        s.animT += m / base;
        if (d - m < .02) {   // at the foot: up it, head first, the belly to the bark
          s.y = FOOT; s.top = Math.min(trunkTop(s.tr) - .4, s.tr.h * .45, 2 + s.r() * 4);
          s.state = "up"; onTrunk(s, true);
        }
      } else if (s.state === "up" || s.state === "down") {
        const up = s.state === "up";
        s.y = up ? Math.min(s.top, s.y + CLIMB * dt) : Math.max(FOOT, s.y - CLIMB * dt);
        s.a += (s.r() - .5) * .02;   // a slight spiral as it goes
        onTrunk(s, up);   // down: facing away, nose to the ground
        s.animT += CLIMB * dt / base;
        gait(s, true, false);
        if (up && s.y >= s.top) { s.state = "top"; s.until = t + rand(s, PAUSE_TOP); gait(s, false, false); }
        if (!up && s.y <= FOOT) { s.state = "foot"; s.pitch = 0; s.pos[1] = groundH(s.pos[0], s.pos[2]); s.until = t + rand(s, PAUSE_FOOT); gait(s, false, false); }
      } else if (t >= s.until) {
        if (s.state === "top") { s.state = "down"; onTrunk(s, false); }
        else {   // at the foot, watched enough: a neighbour tree, often back and forth in the grove
          const opts = near[s.ti], nt = opts[Math.floor(s.r() * opts.length)], ti = trees.indexOf(nt);
          const k = trunkAt(nt, FOOT), a = Math.atan2(s.pos[2] - k.c[2], s.pos[0] - k.c[0]);   // arrive on the side it comes from
          s.ti = ti; s.tr = nt; s.a = a; s.to = [k.c[0] + Math.cos(a) * (k.r + .03), k.c[2] + Math.sin(a) * (k.r + .03)];
          s.state = "run"; gait(s, true, true);
        }
      }
    }
  }
  return { step, squirrels: sq };
}
