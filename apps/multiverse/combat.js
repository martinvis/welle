// COMBAT: people and animals struck down -- by an arrow (archery.js) or the
// sword (sword.js) -- and the one hit test both use. A struck figure goes
// DOWN: it tips over onto its side over about half a second (the skeleton's
// `roll`, about its own forward axis, away from the blow) and comes to rest
// with its lowest side on the floor, bench or ground under it -- worked out
// from its own parts, so a cat and a cow both lie flat; in water it floats
// up belly-up instead. Then it lies still for good: whatever drove it stops
// (a wanderer frozen; villagers, riders and cart teams through their owners'
// hooks), its clock stops (no idle head turns or swishing: `stillT`), its eyes
// go red (faces.js "downed"), it falls silent. Other players' figures are
// never struck (they are not among the targets).
import { expression } from "./faces.js";

// the closest approach of segments p0p1 (vectors) and ab (arrays): [distance, s along p0p1 (0..1)]
export function segSeg(p0, p1, a, b) {
  const d1x = p1.x - p0.x, d1y = p1.y - p0.y, d1z = p1.z - p0.z, d2x = b[0] - a[0], d2y = b[1] - a[1], d2z = b[2] - a[2];
  const rx = p0.x - a[0], ry = p0.y - a[1], rz = p0.z - a[2];
  const A = d1x * d1x + d1y * d1y + d1z * d1z, E = d2x * d2x + d2y * d2y + d2z * d2z, F = d2x * rx + d2y * ry + d2z * rz;
  let s, t;
  if (E < 1e-12) { s = A > 1e-12 ? Math.min(1, Math.max(0, -(d1x * rx + d1y * ry + d1z * rz) / A)) : 0; t = 0; }
  else {
    const C = d1x * rx + d1y * ry + d1z * rz, B = d1x * d2x + d1y * d2y + d1z * d2z, den = A * E - B * B;
    s = den > 1e-12 ? Math.min(1, Math.max(0, (B * F - C * E) / den)) : 0;
    t = (B * s + F) / E;
    if (t < 0) { t = 0; s = A > 1e-12 ? Math.min(1, Math.max(0, -C / A)) : 0; }
    else if (t > 1) { t = 1; s = A > 1e-12 ? Math.min(1, Math.max(0, (B - C) / A)) : 0; }
  }
  const cx = rx + d1x * s - d2x * t, cy = ry + d1y * s - d2y * t, cz = rz + d1z * s - d2z * t;
  return [Math.hypot(cx, cy, cz), s];
}

// world: { groundH(x, z), floorAt(x, z, y) (the floor or bench top under a point), WLEVEL, waterY(x, z) (the surface
//          there), waterSD(x, z) (< 0: water),
//          names() -> [[name, herd]] (the same on every peer: the struck figures' ids), targets() -> the herds that can
//          be struck, ignore() -> figures that cannot (the player, their mount), onStrike(herd, an, i, dir) -> true when
//          an owner handles the blow itself (a rider off a horse), onDown(herd, an) (owners stop what drives it),
//          send(op) (peers), clock() -> the world time }
export function createCombat(world) {
  const { floorAt, WLEVEL, waterY = () => WLEVEL, waterSD, names, targets, ignore, onStrike, onDown, send, clock } = world;
  const falling = [];
  // which side a blow along dir (world) knocks a figure: +1 toward its own +z (its left), -1 toward -z
  const sideOf = (an, dir) => (dir && dir.x * Math.sin(an.rotY) + dir.z * Math.cos(an.rotY) < 0 ? -1 : 1);

  // the nearest figure part a segment p -> q (vectors) meets: { t, herd, an, i } or null -- a bounding sphere per
  // figure first, then, for the few it crosses, each part as a capsule
  function hitFigure(p, q) {
    const skip = ignore(), len = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) || 1e-6;
    let best = null;
    for (const herd of targets()) {
      for (const an of herd.animals) {
        if (an.hidden || skip.includes(an)) continue;
        const cx = an.position.x + (an._bo?.[0] ?? 0), cy = an.position.y + (an._bo?.[1] ?? 1), cz = an.position.z + (an._bo?.[2] ?? 0), R = (an._br ?? 3) + .2;
        const u = Math.max(0, Math.min(1, ((cx - p.x) * (q.x - p.x) + (cy - p.y) * (q.y - p.y) + (cz - p.z) * (q.z - p.z)) / (len * len)));
        if (Math.hypot(p.x + (q.x - p.x) * u - cx, p.y + (q.y - p.y) * u - cy, p.z + (q.z - p.z) * u - cz) > R) continue;
        for (let i = 0; i < an.parts.length; i++) {
          const pt = an.parts[i];
          if (pt.k < 0 || pt.dot || (pt.r2 < -.5 && pt.r2 > -1.5)) continue;   // bones, face marks, flat triangles
          const r = Math.max(pt.r1, pt.r2 > 0 ? pt.r2 : pt.r1);
          if (r < .012) continue;
          const [a, b] = herd.ends(an, i), [dist, sAt] = segSeg(p, q, a, b);
          if (dist >= r) continue;
          const t = Math.max(0, sAt - Math.sqrt(r * r - dist * dist) / len);
          if (!best || t < best.t) best = { t, herd, an, i };
        }
      }
    }
    return best;
  }

  const idOf = (herd, an) => { const n = names().find(([, h]) => h === herd); return n ? [n[0], herd.animals.indexOf(an)] : null; };
  // strike a figure down (i: the part hit, dir: the blow's direction; side: forced by a peer). It stops at once; its fall
  // is worked out from its posed parts, so it waits (pending) until it has been posed again down -- its legs and wings drawn
  // in (skeleton.js fold) -- which also covers a figure added this very frame (the horse of a rider parted by the blow)
  const pending = [];
  function down(herd, an, { dir = null, i = -1, remote = false, side } = {}) {
    if (!an || an.down || an.hidden) return false;
    if (!remote && onStrike?.(herd, an, i, dir)) return true;   // an owner splits it (a rider thrown, or his horse felled)
    const s = side ?? sideOf(an, dir);
    an.down = { waiting: true };
    if (an.w) an.w.frozen = true;
    an.ampT = 0; an.runT = 0; an.pitch = 0; an.stillT = clock(); an.expr = expression("downed");   // (pitch: a squirrel struck on a trunk lies flat)
    onDown?.(herd, an);
    if (!remote) { const id = idOf(herd, an); if (id) send?.({ k: "down", h: id[0], a: id[1], s }); }
    an._posed = false; pending.push([herd, an, s]);   // (re-posed first: its fall measured with its legs and wings drawn in)
    return true;
  }
  function fall(herd, an, s) {   // onto its side (s: which), or belly-up in water
    const c = Math.cos(an.rotY), sn = Math.sin(an.rotY);
    // its parts' reach in its own frame: up (y) and sideways (its +z)
    let yMin = 1e9, yMax = -1e9, zMin = 1e9, zMax = -1e9;
    for (let k = 0; k < an.parts.length; k++) {
      const pt = an.parts[k];
      if (pt.k < 0 || pt.dot) continue;
      const r = Math.max(pt.r1, pt.r2 > 0 ? pt.r2 : pt.r1);
      for (const e of herd.ends(an, k)) {
        const dx = e[0] - an.position.x, dy = e[1] - an.position.y, dz = e[2] - an.position.z, zl = dx * sn + dz * c;
        yMin = Math.min(yMin, dy - r); yMax = Math.max(yMax, dy + r); zMin = Math.min(zMin, zl - r); zMax = Math.max(zMax, zl + r);
      }
    }
    const x = an.position.x, z = an.position.z, floor = floorAt(x, z, an.position.y + Math.max(1, yMax));
    const wl = waterY(x, z), wet = waterSD(x, z) < 0 && an.position.y < wl + .3 && floor < wl;   // (in the water -- not on a deck over it: a boat's bottom)
    let roll, y1;
    if (wet) { roll = Math.PI; y1 = wl + .02 + yMin; }   // belly-up, its underside just out of the water
    else {   // on its side: turned by a quarter about its forward axis, its lowest point that way on the floor
      roll = s * Math.PI / 2;
      y1 = floor + (s > 0 ? zMax : -zMin);
    }
    const h = Math.max(0, an.position.y - y1);
    an.down = { t: 0, T: Math.max(.45, Math.sqrt(2 * h / 9.81)), roll, y0: an.position.y, y1 };   // (a bird falls from the sky for as long as it takes)
    falling.push(an);
  }

  return {
    hitFigure, down, sideOf,
    isDown: (an) => !!an?.down,
    apply(op) {   // a peer struck one down
      const herd = names().find(([n]) => n === op.h)?.[1];
      if (herd) down(herd, herd.animals[op.a], { remote: true, side: op.s });
    },
    update(dt) {   // the falls under way: the roll and the drop, accelerating
      for (let j = pending.length - 1; j >= 0; j--) { const [herd, an, s] = pending[j]; if (an._posed) { pending.splice(j, 1); fall(herd, an, s); } }   // (posed now)
      for (let j = falling.length - 1; j >= 0; j--) {
        const an = falling[j], d = an.down;
        d.t += dt;
        const u = Math.min(1, d.t / d.T), e = u * u;
        an.roll = d.roll * e;
        an.position.y = d.y0 + (d.y1 - d.y0) * e;
        if (u >= 1) falling.splice(j, 1);
      }
    },
  };
}
