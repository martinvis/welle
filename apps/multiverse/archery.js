// ARCHERY: the player's bow and arrows. B takes the bow out (or puts it
// away); holding the mouse draws it (~0.8 s to full draw, the view closing
// in a little), releasing shoots, the right button lowers it. An arrow
// leaves at up to 50 m/s (a light tap ~14) -- about 240m at 45 degrees, as
// a real war bow -- falls under gravity with a little drag, and is traced as a segment every frame -- in steps of at
// most a metre, so it never skips through a thin target -- against, in
// order of cost: the ground, the water, the buildings -- every visible part,
// roofs and arches too (only the sites its path crosses), tree trunks, moving decks (carts, the barge) and
// every figure: first a figure's bounding sphere, then, for the one or two
// it crosses, each of its parts as a capsule. The nearest hit wins and the
// arrow STICKS there, a little way in: a still target keeps it in the
// world; a moving deck or a figure keeps it in its own frame -- the deck's
// transform, or the very part it struck (an animal's neck, a man's arm),
// rebuilt from that part's ends every frame -- so it goes wherever that
// goes. In water it floats a while and is gone. Stuck and fallen arrows can
// be taken back (look at one close by and click). No reactions yet: people
// and animals are struck the same way and carry on.
//
// Arrows are low-poly meshes (tools.js pieces), one InstancedMesh for all of
// them -- flying, stuck and the one on the string -- not SDF parts (a long
// thin shaft smears a composite figure's quad). Sounds are synthesised once
// (the string's twang, a thud in wood, a duller one in a body, earth, a
// splash) and played from where it happens.
import * as THREE from "three";
import { paintedGeometry } from "./tools.js";
import { itemOf } from "./arch/assemble.js";   // (the arrow is an asset: assets/items/weapons/arrow)
import { litMaterial } from "./light.js";
import { SR, toBuffer, play } from "./dsp.js";

const SPEED = 50, MIN_SPEED = 14, DRAW_TIME = .8, QUIVER = 24, MAX_STUCK = 100, MAX_FLY = 30, G = 9.81, DRAG = .012;
const DEPTH = { ground: .16, building: .06, tree: .1, body: .12, mover: .09, goods: .06 };   // how far an arrow sinks in (m)
const FLOAT_TIME = 20, MAX_WOUNDS = 120;   // seconds an arrow floats in the water; blood splats kept

// the arrow (items/weapons/arrow): its tip at the origin, the shaft back along -x -- one painted geometry, lit in the world
const arrowGeometry = () => paintedGeometry(itemOf({ path: "items/weapons/arrow" }));

// ---- geometry helpers: a segment p0 -> p1 against the targets; each returns the entry parameter t in [0, 1] or -1
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4();
const _gi = new THREE.Matrix4(), _ga = new THREE.Vector3(), _gb = new THREE.Vector3();   // (goods: a piece's inverse placement, the segment in its frame)
function slab(ax, ay, az, bx, by, bz, x0, x1, y0, y1, z0, z1) {   // an axis-aligned box; a start inside is no hit
  if (ax > x0 && ax < x1 && ay > y0 && ay < y1 && az > z0 && az < z1) return -1;
  let t0 = 0, t1 = 1;
  for (const [a, b, lo, hi] of [[ax, bx, x0, x1], [ay, by, y0, y1], [az, bz, z0, z1]]) {
    const d = b - a;
    if (Math.abs(d) < 1e-9) { if (a < lo || a > hi) return -1; continue; }
    let ta = (lo - a) / d, tb = (hi - a) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}
function vcyl(ax, ay, az, bx, by, bz, cx, cz, r, y0, y1, sz = 1) {   // an upright cylinder (z scaled by sz: an oval column)
  const ox = ax - cx, oz = (az - cz) / sz, dx = bx - ax, dz = (bz - az) / sz;
  const A = dx * dx + dz * dz, B = 2 * (ox * dx + oz * dz), C = ox * ox + oz * oz - r * r;
  if (C < 0) return -1;   // starts inside
  if (A < 1e-12) return -1;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return -1;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  if (t < 0 || t > 1) return -1;
  const y = ay + (by - ay) * t;
  return y >= y0 && y <= y1 ? t : -1;
}
// a building part (index.html solidOf): is the point (site frame) inside it? -- in the part's own frame (the inverse of
// its placement), each shape exactly as architecture.js builds it
function insideSolid(b, x, y, z) {
  const m = b.inv, lx = m[0] * x + m[4] * y + m[8] * z + m[12], ly = m[1] * x + m[5] * y + m[9] * z + m[13], lz = m[2] * x + m[6] * y + m[10] * z + m[14], S = b.size;
  switch (b.shape) {
    case "box": return Math.abs(lx) <= S[0] / 2 && Math.abs(ly) <= S[1] / 2 && Math.abs(lz) <= S[2] / 2;
    case "cyl": {   // (a cone or a pyramid too: its radius from the bottom's r2 to the top's r1, a polygon when it has few sides)
      if (Math.abs(ly) > S.h / 2) return false;
      const r = S.r2 + (S.r1 - S.r2) * (ly / S.h + .5), n = S.seg ?? 10, d = Math.hypot(lx, lz);
      if (S.open) return Math.abs(d - r) <= .2;   // open (no caps): only its wall, 40cm thick -- the Colosseum's seating rings and bowl, the air inside them free
      if (n > 8) return d <= r;
      const k = 2 * Math.PI / n, a = ((Math.atan2(lx, lz) % k) + k) % k - k / 2;
      return d <= r * Math.cos(k / 2) / Math.cos(a);
    }
    case "sphere": return lx * lx + ly * ly + lz * lz <= S.r * S.r;
    case "capsule": { const cy = Math.max(-S.len / 2, Math.min(S.len / 2, ly)); return lx * lx + (ly - cy) * (ly - cy) + lz * lz <= S.r * S.r; }
    case "arch": return ly >= 0 && lx * lx + ly * ly <= S.r * S.r && Math.abs(lz) <= S.t / 2;
    case "hwall": {
      if (Math.abs(lx) > S.w / 2 || ly < 0 || ly > S.h || Math.abs(lz) > S.t / 2) return false;
      for (const [u, hy, hw, hh] of S.holes ?? []) if (Math.abs(lx - u) < hw / 2 && ly > hy && ly < hy + hh) return false;   // through a door or a window
      return true;
    }
    case "spandrel": return Math.abs(lx) <= S.w / 2 && ly >= 0 && ly <= S.h && Math.abs(lz) <= S.t / 2 && lx * lx + ly * ly >= S.r * S.r;   // the arch bitten out below
    case "wedge": return lx >= 0 && lz >= 0 && lx / S[0] + lz / S[2] <= 1 && Math.abs(ly) <= S[1] / 2;
    default: return ly >= 0 && ly <= S[1] && Math.abs(lz) <= S[2] / 2 && Math.abs(lx) <= S[0] / 2 * (1 - ly / S[1]);   // a gable prism: a roof
  }
}
// the segment (site frame) entering part b: its bounding sphere first, then 5cm steps and a bisection; -1 if it does not
// (or starts inside)
function solidHit(b, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, L2 = dx * dx + dy * dy + dz * dz;
  const cx = b.pos[0], cy = b.pos[1], cz = b.pos[2];
  const u = L2 > 1e-12 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / L2)) : 0;
  if (Math.hypot(ax + dx * u - cx, ay + dy * u - cy, az + dz * u - cz) > b.R + .05) return -1;
  if (insideSolid(b, ax, ay, az)) return -1;
  const n = Math.max(1, Math.ceil(Math.sqrt(L2) / .05));
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    if (!insideSolid(b, ax + dx * t, ay + dy * t, az + dz * t)) continue;
    let lo = (k - 1) / n, hi = t;
    for (let i = 0; i < 6; i++) { const m = (lo + hi) / 2; if (insideSolid(b, ax + dx * m, ay + dy * m, az + dz * m)) hi = m; else lo = m; }
    return hi;
  }
  return -1;
}
// a figure part's frame, rebuilt from its ends: origin at A, e along the part, (s, t) round it -- turned with the figure's heading
// (and its roll: a figure struck down lies on its side, combat.js)
function partFrame(a, b, an, out) {
  const rotY = an.rotY, roll = an.roll ?? 0;
  const e = _d.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (e.lengthSq() < 1e-10) e.set(1, 0, 0); else e.normalize();
  const fx = Math.cos(rotY), fz = -Math.sin(rotY);
  let rx = fx, ry = 0, rz = fz;
  if (Math.abs(e.x * fx + e.z * fz) > .9) { rx = Math.sin(roll) * Math.sin(rotY); ry = Math.cos(roll); rz = Math.sin(roll) * Math.cos(rotY); }   // along the heading (a body's axis): the figure's own up
  const s = new THREE.Vector3(e.y * rz - e.z * ry, e.z * rx - e.x * rz, e.x * ry - e.y * rx).normalize();
  const t = new THREE.Vector3().crossVectors(s, e);
  out.o.set(a[0], a[1], a[2]); out.e.copy(e); out.s.copy(s); out.t.copy(t);
  return out;
}

// world: { camera, groundH(x, z), waterSD(x, z) (< 0: water), WLEVEL, waterY(x, z) (the surface there), colliderSites, treeCols, movers,
//          combat (combat.js: the figures -- its hit test, and striking them down), goods() -> the barrels and sacks (freight.js: each
//          with kind, state and its placement `m`), audio() -> AudioContext, send(op) (multiplayer) }
export function createArchery(scene, world) {
  const { camera, groundH, waterSD, WLEVEL, waterY = () => WLEVEL, colliderSites, treeCols, movers, combat, goods, audio, send } = world;
  const mesh = new THREE.InstancedMesh(arrowGeometry(), litMaterial({ side: THREE.DoubleSide }), MAX_STUCK + MAX_FLY + 1);
  mesh.count = 0; mesh.frustumCulled = false;
  scene.add(mesh);
  const flying = [], stuck = [];
  let out = false, drawing = false, draw = 0, quiver = QUIVER, baseFov = null;
  const hud = document.createElement("div");
  hud.style.cssText = "position:fixed;left:12px;bottom:112px;padding:4px 8px;border-radius:6px;background:rgba(20,16,10,.55);color:#f2e8d0;font:13px system-ui;display:none;pointer-events:none";
  const cross = document.createElement("div");
  cross.style.cssText = "position:fixed;left:50%;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:rgba(255,248,230,.85);box-shadow:0 0 2px #000;display:none;pointer-events:none";
  document.body.append(hud, cross);
  const showHud = () => { hud.style.display = cross.style.display = out ? "block" : "none"; hud.textContent = `bow · ${quiver} arrow${quiver === 1 ? "" : "s"}`; };

  // ---- sounds: made once, played from where they happen
  let sfxBuf = null;
  function sfx(kind, p) {
    const ctx = audio?.();
    if (!ctx) return;
    if (!sfxBuf) {
      const make = (dur, f) => { const n = Math.round(dur * SR), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = f(i / SR); return toBuffer(x); };
      const nz = () => Math.random() * 2 - 1;
      let lp = 0;
      sfxBuf = {
        twang: make(.45, (t) => .6 * Math.exp(-t / .07) * (Math.sin(2 * Math.PI * 105 * t) + .5 * Math.sin(2 * Math.PI * 210 * t + 1) + .25 * Math.sin(2 * Math.PI * 330 * t))
                               + .5 * Math.exp(-t / .004) * nz()),
        wood: make(.16, (t) => .8 * Math.exp(-t / .035) * Math.sin(2 * Math.PI * 190 * t) + .5 * Math.exp(-t / .06) * Math.sin(2 * Math.PI * 95 * t) + .6 * Math.exp(-t / .003) * nz()),
        body: make(.14, (t) => (lp = .9 * lp + .1 * nz(), .9 * Math.exp(-t / .05) * Math.sin(2 * Math.PI * 120 * t) + 2.5 * Math.exp(-t / .03) * lp)),
        ground: make(.14, (t) => (lp = .92 * lp + .08 * nz(), .6 * Math.exp(-t / .045) * Math.sin(2 * Math.PI * 70 * t) + 3 * Math.exp(-t / .035) * lp)),
        splash: make(.4, (t) => (lp = .7 * lp + .3 * nz(), (t < .02 ? t / .02 : Math.exp(-(t - .02) / .09)) * lp * 1.4)),
        whoosh: make(.3, (t) => (lp = (.55 + .4 * Math.sin(Math.PI * t / .3)) * lp + (.45 - .4 * Math.sin(Math.PI * t / .3)) * nz(), Math.sin(Math.PI * t / .3) ** 2 * lp * 1.6)),   // (the sword's swing)
        clang: make(.4, (t) => Math.exp(-t / .09) * (.5 * Math.sin(2 * Math.PI * 1230 * t) + .35 * Math.sin(2 * Math.PI * 2870 * t) + .2 * Math.sin(2 * Math.PI * 4410 * t))),
      };
    }
    const d = camera.position.distanceTo(p);
    if (d > 60) return;
    const g = ctx.createGain(), pan = ctx.createStereoPanner();
    g.gain.value = Math.min(1, 4 / Math.max(d, 1)) * .55;
    const r = _a.set(1, 0, 0).applyQuaternion(camera.quaternion), to = _b.copy(p).sub(camera.position);
    pan.pan.value = Math.max(-1, Math.min(1, to.dot(r) / Math.max(d, 1)));
    g.connect(pan); pan.connect(ctx.destination);
    const { end } = play(ctx, sfxBuf[kind], { dest: g });
    setTimeout(() => pan.disconnect(), (end - ctx.currentTime + .3) * 1000);
  }

  // ---- the flight: segment p -> q against everything; the nearest hit
  function trace(p, q) {
    let best = 1.0001, hit = null;
    const take = (t, h) => { if (t >= 0 && t < best) { best = t; hit = h; } };
    // the ground (a straight line between the two samples: a metre's step)
    const g0 = p.y - groundH(p.x, p.z), g1 = q.y - groundH(q.x, q.z);
    if (g1 < 0 && g0 >= 0) take(g0 / (g0 - g1), { kind: "ground" });
    // the water's surface
    const wl = waterY(p.x, p.z);   // (the water's surface where the flight begins this tick: level enough over one)
    if (q.y < wl && p.y >= wl) { const t = (p.y - wl) / (p.y - q.y), x = p.x + (q.x - p.x) * t, z = p.z + (q.z - p.z) * t; if (waterSD(x, z) < 0) take(t, { kind: "water" }); }
    // buildings: the sites whose footprint the segment's box crosses, then their boxes and columns
    const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x), z0 = Math.min(p.z, q.z), z1 = Math.max(p.z, q.z);
    for (const s of colliderSites) {
      if (x1 < s.x - s.rx || x0 > s.x + s.rx || z1 < s.z - s.rz || z0 > s.z + s.rz) continue;
      const ax = p.x - s.x, az = p.z - s.z, bx = q.x - s.x, bz = q.z - s.z;
      if (s.solids) { for (const b of s.solids) take(solidHit(b, ax, p.y, az, bx, q.y, bz), { kind: "building" }); continue; }   // every visible part
      for (const c of s.cols) {
        if (c.cyl) { take(vcyl(ax, p.y, az, bx, q.y, bz, c.x, c.z, c.r, c.yLo, c.yHi, c.sz), { kind: "building" }); continue; }
        const co = Math.cos(c.yaw), si = Math.sin(c.yaw);
        const pax = (ax - c.x) * co - (az - c.z) * si, paz = (ax - c.x) * si + (az - c.z) * co;
        const pbx = (bx - c.x) * co - (bz - c.z) * si, pbz = (bx - c.x) * si + (bz - c.z) * co;
        take(slab(pax, p.y, paz, pbx, q.y, pbz, -c.hx, c.hx, c.yLo, c.yHi, -c.hz, c.hz), { kind: "building" });
      }
    }
    // tree trunks: upright columns from the ground to 8m
    for (const tc of treeCols) {
      if (tc.x + tc.r < x0 || tc.x - tc.r > x1 || tc.z + tc.r < z0 || tc.z - tc.r > z1) continue;
      const gy = groundH(tc.x, tc.z);
      take(vcyl(p.x, p.y, p.z, q.x, q.y, q.z, tc.x, tc.z, tc.r, gy - .5, gy + 8), { kind: "tree" });
    }
    // moving decks (carts, the barge): their box in their own frame
    for (const k of movers) {
      const b = k.body, c = Math.cos(k.yaw), s = Math.sin(k.yaw);
      const top = b.position.y + k.top, lo = top - 1.2, hi = top + Math.max(k.side ?? 0, .3);
      const pdx = p.x - b.position.x, pdz = p.z - b.position.z, qdx = q.x - b.position.x, qdz = q.z - b.position.z;
      take(slab(pdx * c - pdz * s, p.y, pdx * s + pdz * c, qdx * c - qdz * s, q.y, qdx * s + qdz * c, -k.halfL, k.halfL, lo, hi, -k.halfW, k.halfW), { kind: "mover", mover: k });
    }
    // goods -- barrels and sacks, wherever they are (on the quay, on a cart, in someone's arms): in each one's own frame, a barrel
    // an upright cylinder, a sack the box round its lying ellipsoid
    for (const it of goods?.() ?? []) {
      if (!it.m || it.state === "gone") continue;
      const e = it.m.elements;
      if (Math.abs(e[12] - (p.x + q.x) / 2) > 2 || Math.abs(e[14] - (p.z + q.z) / 2) > 2) continue;
      _gi.copy(it.m).invert();
      const a = _ga.copy(p).applyMatrix4(_gi), b = _gb.copy(q).applyMatrix4(_gi);
      take(it.kind === "barrel" ? vcyl(a.x, a.y, a.z, b.x, b.y, b.z, 0, 0, .35, 0, .95) : slab(a.x, a.y, a.z, b.x, b.y, b.z, -.5, .5, 0, .48, -.25, .25), { kind: "goods", item: it });
    }
    // figures: combat.js's test (a bounding sphere, then each part as a capsule)
    const fh = combat.hitFigure(p, q);
    if (fh) take(fh.t, { kind: "body", herd: fh.herd, an: fh.an, i: fh.i });
    return hit ? { t: best, ...hit } : null;
  }

  // ---- stuck arrows: placed every frame from what holds them
  const _f = { o: new THREE.Vector3(), e: new THREE.Vector3(), s: new THREE.Vector3(), t: new THREE.Vector3() };
  function stick(tip, dir, hit) {
    const depth = DEPTH[hit.kind] ?? .08;
    const P = tip.clone().addScaledVector(dir, depth), D = dir.clone();
    const a = { kind: hit.kind, pos: P, dir: D, take: hit.kind !== "water", until: hit.kind === "water" ? FLOAT_TIME : Infinity };
    if (hit.kind === "water") { a.pos.y = waterY(a.pos.x, a.pos.z) + .01; a.dir.y = 0; a.dir.normalize(); }
    else if (hit.kind === "mover") {
      hit.mover.body.updateMatrixWorld();
      _m.copy(hit.mover.body.matrixWorld).invert();
      a.mover = hit.mover; a.lpos = P.clone().applyMatrix4(_m); a.ldir = D.clone().transformDirection(_m);
    } else if (hit.kind === "goods") {   // in a barrel or a sack: kept in its frame, so it goes where the piece goes (picked up, carted, shipped)
      _gi.copy(hit.item.m).invert();
      a.item = hit.item; a.lpos = P.clone().applyMatrix4(_gi); a.ldir = D.clone().transformDirection(_gi);
    } else if (hit.kind === "body") {
      const [pa, pb] = hit.herd.ends(hit.an, hit.i), f = partFrame(pa, pb, hit.an, _f), rel = P.clone().sub(f.o);
      Object.assign(a, { herd: hit.herd, an: hit.an, i: hit.i, lpos: [rel.dot(f.e), rel.dot(f.s), rel.dot(f.t)], ldir: [D.dot(f.e), D.dot(f.s), D.dot(f.t)] });
      addWound(hit.herd, hit.an, hit.i, tip, D.clone().negate());   // blood round it
      combat.down(hit.herd, hit.an, { dir: D, i: hit.i });           // struck down
    }
    stuck.push(a);
    if (stuck.length > MAX_STUCK) stuck.shift();   // the oldest goes
    sfx(hit.kind === "body" ? "body" : hit.kind === "ground" ? "ground" : hit.kind === "water" ? "splash" : "wood", P);
  }
  function place(a) {   // a stuck arrow's world pose now (false: not shown)
    if (a.item) {
      if (a.item.state === "gone" || !a.item.m) return false;   // (the piece used up: out of sight with it)
      a.pos.copy(a.lpos).applyMatrix4(a.item.m); a.dir.copy(a.ldir).transformDirection(a.item.m);
    } else if (a.mover) {
      a.mover.body.updateMatrixWorld();
      a.pos.copy(a.lpos).applyMatrix4(a.mover.body.matrixWorld); a.dir.copy(a.ldir).transformDirection(a.mover.body.matrixWorld);
    } else if (a.an) {
      if (a.an.hidden) return false;
      const [pa, pb] = a.herd.ends(a.an, a.i), f = partFrame(pa, pb, a.an, _f);
      a.pos.copy(f.o).addScaledVector(f.e, a.lpos[0]).addScaledVector(f.s, a.lpos[1]).addScaledVector(f.t, a.lpos[2]);
      a.dir.set(0, 0, 0).addScaledVector(f.e, a.ldir[0]).addScaledVector(f.s, a.ldir[1]).addScaledVector(f.t, a.ldir[2]).normalize();
    }
    return true;
  }

  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _s1 = new THREE.Vector3(1, 1, 1);
  function setArrow(k, pos, dir) {   // instance k: its tip at pos, pointing along dir
    _x.copy(dir).normalize();
    _z.crossVectors(_x, Math.abs(_x.y) > .99 ? _a.set(1, 0, 0) : _up).normalize();
    _y.crossVectors(_z, _x);
    mesh.setMatrixAt(k, _m.makeBasis(_x, _y, _z).setPosition(pos));
  }
  const fwd = () => _b.set(0, 0, -1).applyQuaternion(camera.quaternion);

  // ---- WOUNDS: a splash of blood where an arrow or the sword went in -- a flat ragged splat on the body, kept in the
  // struck part's frame like a stuck arrow, so it lies wherever the part goes
  const splatGeo = (() => {
    const R = [1, .7, .95, .6, 1.05, .75, .9, .65, 1, .8], n = R.length, pos = [];
    for (let k = 0; k < n; k++) {
      const a0 = k / n * 2 * Math.PI, a1 = (k + 1) / n * 2 * Math.PI, r0 = R[k] * .05, r1 = R[(k + 1) % n] * .05;
      pos.push(0, 0, 0, Math.cos(a1) * r1, 0, Math.sin(a1) * r1, Math.cos(a0) * r0, 0, Math.sin(a0) * r0);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  })();
  const splats = new THREE.InstancedMesh(splatGeo, new THREE.MeshBasicMaterial({ color: 0x5c0707, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), MAX_WOUNDS);
  splats.count = 0; splats.frustumCulled = false;
  scene.add(splats);
  const wounds = [];
  function addWound(herd, an, i, P, N) {   // P: where it went in (world), N: facing out of the body
    const [pa, pb] = herd.ends(an, i), f = partFrame(pa, pb, an, _f), rel = P.clone().sub(f.o);
    wounds.push({ herd, an, i, lpos: [rel.dot(f.e), rel.dot(f.s), rel.dot(f.t)], ln: [N.dot(f.e), N.dot(f.s), N.dot(f.t)] });
    if (wounds.length > MAX_WOUNDS) wounds.shift();
  }
  const _wp = new THREE.Vector3(), _wn = new THREE.Vector3();
  function placeWounds() {
    let k = 0;
    for (const w of wounds) {
      if (w.an.hidden) continue;
      const [pa, pb] = w.herd.ends(w.an, w.i), f = partFrame(pa, pb, w.an, _f);
      _wn.set(0, 0, 0).addScaledVector(f.e, w.ln[0]).addScaledVector(f.s, w.ln[1]).addScaledVector(f.t, w.ln[2]).normalize();
      _wp.copy(f.o).addScaledVector(f.e, w.lpos[0]).addScaledVector(f.s, w.lpos[1]).addScaledVector(f.t, w.lpos[2]).addScaledVector(_wn, .004);
      _y.copy(_wn); _x.crossVectors(_y, Math.abs(_y.y) > .9 ? _a.set(1, 0, 0) : _up).normalize(); _z.crossVectors(_x, _y);
      splats.setMatrixAt(k++, _m.makeBasis(_x, _y, _z).setPosition(_wp));
    }
    splats.count = k; splats.instanceMatrix.needsUpdate = true;
  }

  function spawn(p, v, remote = false) {
    if (flying.length >= MAX_FLY) flying.shift();
    flying.push({ p: new THREE.Vector3(...p), v: new THREE.Vector3(...v) });
    if (!remote) send?.({ k: "arrow", p, v });
  }

  return {
    get out() { return out; }, get drawing() { return drawing; }, get draw() { return draw; }, get quiver() { return quiver; },
    spawn, addWound, sfx,
    toggle() { out = !out; if (!out) this.cancel(); showHud(); },
    setOut(on) { out = !!on; if (!out) this.cancel(); showHud(); },
    startDraw() { if (!out || drawing || quiver < 1) return false; drawing = true; draw = 0; if (baseFov === null) baseFov = camera.fov; return true; },
    cancel() { drawing = false; draw = 0; if (baseFov !== null) { camera.fov = baseFov; camera.updateProjectionMatrix(); } },
    release() {   // loose the arrow (a too-short tap only lowers the bow)
      if (!drawing) return;
      const d = draw;
      this.cancel();
      if (d < .15) return;
      quiver--; showHud();
      const f = fwd().clone(), speed = MIN_SPEED + (SPEED - MIN_SPEED) * Math.sqrt(d);   // (a half draw already carries it well past 100m; a full one ~240m at 45 degrees)
      const o = camera.position.clone().addScaledVector(f, .5).add(_a.set(0, -.06, 0));
      spawn(o.toArray(), f.multiplyScalar(speed).toArray());
      sfx("twang", camera.position);
    },
    // a stuck or fallen arrow within reach and in view (the click's "take the arrow")
    nearest(pos, fx, fz, standY) {
      let best = null, bd = 2.4;
      for (const a of stuck) {
        if (!a.take || (a.an && a.an.hidden)) continue;
        const dx = a.pos.x - pos.x, dz = a.pos.z - pos.z, d = Math.hypot(dx, dz);
        if (d > bd || Math.abs(a.pos.y - (standY + 1)) > 1.6 || (d > .3 && (dx * fx + dz * fz) / d < .5)) continue;
        best = a; bd = d;
      }
      return best;
    },
    take(a) { const i = stuck.indexOf(a); if (i >= 0) { stuck.splice(i, 1); quiver++; showHud(); } },
    debug: () => ({ flying: flying.map((a) => a.p.toArray().map((v) => +v.toFixed(2))), stuck: stuck.map((a) => [a.kind + (a.an ? ":" + a.i : ""), a.pos.toArray().map((v) => +v.toFixed(2))]) }),   // (checks)
    update(dt) {
      dt = Math.min(dt, .1);   // real time even on a slow frame (the flight is traced in steps of a metre at most anyway)
      if (drawing) {
        draw = Math.min(1, draw + dt / DRAW_TIME);
        camera.fov = baseFov - 7 * draw; camera.updateProjectionMatrix();   // the view closes in as you draw
      }
      for (let j = flying.length - 1; j >= 0; j--) {
        const a = flying[j], n = Math.max(1, Math.ceil(a.v.length() * dt / 1));   // steps of a metre at most
        const h = dt / n;
        for (let s = 0; s < n; s++) {
          const q = a.p.clone().addScaledVector(a.v, h); q.y -= .5 * G * h * h;
          const hit = trace(a.p, q);
          if (hit) {
            const tip = a.p.clone().lerp(q, hit.t), dir = a.v.clone().normalize();
            flying.splice(j, 1); stick(tip, dir, hit);
            break;
          }
          a.p.copy(q); a.v.y -= G * h; a.v.multiplyScalar(1 - DRAG * h);
          if (a.p.y < -80) { flying.splice(j, 1); break; }
        }
      }
      for (let j = stuck.length - 1; j >= 0; j--) if ((stuck[j].until -= dt) <= 0) stuck.splice(j, 1);   // floaters sink
      // the instances: flying, stuck, and the one on the string
      let k = 0;
      for (const a of flying) setArrow(k++, a.p, a.v);
      for (const a of stuck) if (place(a)) setArrow(k++, a.pos, a.dir);
      if (drawing) {   // nocked: along the view, below its centre, drawn back as the draw grows
        const f = fwd().clone(), dn = _y.set(0, 1, 0).applyQuaternion(camera.quaternion);
        setArrow(k++, camera.position.clone().addScaledVector(f, .9 - .28 * draw).addScaledVector(dn, -.09), f);
      }
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
      placeWounds();
    },
  };
}
