// The path network: the lanes the carts and riders drive (arc-length
// samplers), the town's highway with its lane loop, every track of the
// world laid out and kept OUT OF THE WATER, and the one track mesh.
//
// index.html only hands over the world it needs (buildPathNetwork(world));
// everything about tracks -- their layout, the dry routing, the ribbons --
// lives here, once.
import * as THREE from "three";
import { MASK_MODE, NOGRASS_LAYER } from "./grass.js";

// a closed lane: arc-length sampler over a polyline (wrapping), plus the
// arc length of each vertex (`cum`) so stops can be placed by vertex
export function laneFrom(lane) {
  const cum = [0];
  for (let i = 1; i < lane.length; i++) cum.push(cum[i - 1] + Math.hypot(lane[i][0] - lane[i - 1][0], lane[i][1] - lane[i - 1][1]));
  const total = cum[cum.length - 1];
  return { total, cum,
    at(s) {   // arc length (wrapping) -> [x, z]
      s = ((s % total) + total) % total;
      let lo = 0, hi = cum.length - 2;
      while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m + 1] < s) lo = m + 1; else hi = m; }
      const t = (s - cum[lo]) / Math.max(1e-6, cum[lo + 1] - cum[lo]);
      return [lane[lo][0] + (lane[lo + 1][0] - lane[lo][0]) * t, lane[lo][1] + (lane[lo + 1][1] - lane[lo][1]) * t];
    },
    heading(s) {   // travel direction at arc length s, as a world yaw (where the lane doubles back, the way in)
      const a = this.at(s - .5);
      let b = this.at(s + .5);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-3) b = this.at(s);
      return Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    } };
}

// A wanderer's route, planned once instead of steering every tick: a loop of n waypoints inside its
// range f (a rectangle x0..x1 z0..z1, kept `margin` in from the edge, or the shaped range's own
// f.inside), each within `reach` of the one before, every leg checked every 2m to stay inside; closed
// back to the start when that leg is clear too, else walked back the way it came. The wanderer then
// only advances along it (laneFrom): no range tests, no terrain probes per step (see wanderStep).
export function wanderLoop(f, start, rng, { n = 10 } = {}) {
  const size = Math.min(f.x1 - f.x0, f.z1 - f.z0), margin = Math.min(3, size * .15), reach = Math.max(2, Math.min(30, size * .5));
  const ok = (x, z) => (f.inside ? f.inside(x, z) : x > f.x0 + margin && x < f.x1 - margin && z > f.z0 + margin && z < f.z1 - margin);
  const legOk = (a, b) => {
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2));
    for (let i = 1; i <= k; i++) if (!ok(a[0] + (b[0] - a[0]) * i / k, a[1] + (b[1] - a[1]) * i / k)) return false;
    return true;
  };
  const pts = [start];
  for (let i = 1; i < n; i++) {
    const p = pts[pts.length - 1];
    for (let k = 0; k < 24; k++) {
      const a = rng() * Math.PI * 2, d = reach * (.3 + .7 * rng()), q = [p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d];
      if (ok(q[0], q[1]) && legOk(p, q)) { pts.push(q); break; }
    }
  }
  if (pts.length < 2) return [start, [start[0] + .3, start[1]], start];   // nowhere to go (a tiny pen): a step to and fro
  if (legOk(pts[pts.length - 1], start)) pts.push(start);
  else for (let i = pts.length - 2; i >= 0; i--) pts.push(pts[i]);
  return pts;
}

// A router over the whole network, for people walking from door to door: the
// dry lines (rt.path) as one graph -- every vertex a node, every segment an
// edge -- with each route's two ends tied to the nearest point of any other
// route within 3m (a spur meets the street mid-segment: the street is split
// there); `links` join what no drawn track does (the bridge deck between its
// ramp feet). route(a, b) -> [a, ...the shortest way's nodes..., b], from the
// node nearest a to the node nearest b (Dijkstra).
export function routeGraph(pathRoutes, links = []) {
  const nodes = [], adj = [];
  const node = ([x, z]) => { nodes.push([x, z]); adj.push([]); return nodes.length - 1; };
  const link = (i, j) => { const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]); adj[i].push([j, d]); adj[j].push([i, d]); };
  const lines = pathRoutes.map((rt) => rt.path);
  const ties = [];
  lines.forEach((A, a) => [0, A.length - 1].forEach((ei) => {
    const [ex, ez] = A[ei];
    let best = null;
    lines.forEach((B, b) => {
      if (b === a) return;
      for (let k = 0; k + 1 < B.length; k++) {
        const [ax, az] = B[k], dx = B[k + 1][0] - ax, dz = B[k + 1][1] - az;
        const t = Math.max(0, Math.min(1, ((ex - ax) * dx + (ez - az) * dz) / (dx * dx + dz * dz || 1e-9)));
        const d = Math.hypot(ax + dx * t - ex, az + dz * t - ez);
        if (d < 3 && (!best || d < best.d)) best = { b, k, t, d, p: [ax + dx * t, az + dz * t] };
      }
    });
    if (best) ties.push({ a, ei, ...best });
  }));
  const ends = lines.map((L, li) => {   // each line's nodes in order, the tie points spliced in; its two end nodes
    const pts = L.map((p, k) => ({ k, t: 0, p }));
    for (const ti of ties) if (ti.b === li) pts.push({ k: ti.k, t: ti.t || 1e-6, p: ti.p, tie: ti });
    pts.sort((u, v) => u.k - v.k || u.t - v.t);
    const ids = pts.map((q) => { const id = node(q.p); if (q.tie) q.tie.node = id; return id; });
    for (let i = 0; i + 1 < ids.length; i++) link(ids[i], ids[i + 1]);
    return [ids[pts.findIndex((q) => q.k === 0 && !q.tie)], ids[pts.map((q) => q.k === L.length - 1 && !q.tie).lastIndexOf(true)]];
  });
  for (const ti of ties) link(ends[ti.a][ti.ei ? 1 : 0], ti.node);
  const nearestOf = (ids, [x, z]) => { let bi = ids[0], bd = Infinity; for (const i of ids) { const d = (nodes[i][0] - x) ** 2 + (nodes[i][1] - z) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; };
  const all = nodes.map((_, i) => i);
  for (const [a, b] of links) link(nearestOf(all, a), nearestOf(all, b));
  // walkers join the network only where it is ONE: the largest connected part (a stray spur a dry-route
  // detour cut loose, a track that meets nothing, never swallows a walker into a dead end)
  const comp = new Int32Array(nodes.length).fill(-1), sizes = [];
  for (let s = 0; s < nodes.length; s++) if (comp[s] < 0) {
    const c = sizes.length, stack = [s]; comp[s] = c; sizes.push(0);
    while (stack.length) { const i = stack.pop(); sizes[c]++; for (const [j] of adj[i]) if (comp[j] < 0) { comp[j] = c; stack.push(j); } }
  }
  const mainC = sizes.indexOf(Math.max(...sizes)), main = all.filter((i) => comp[i] === mainC);
  const nearest = (p) => nearestOf(main, p);
  function route(a, b) {
    const s0 = nearest(a), s1 = nearest(b), n = nodes.length;
    const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), heap = [[0, s0]];
    dist[s0] = 0;
    while (heap.length) {   // a binary heap on distance
      const [d, i] = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; for (let j = 0; ;) { const l = 2 * j + 1, r = l + 1; let m = j; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === j) break; [heap[j], heap[m]] = [heap[m], heap[j]]; j = m; } }
      if (d > dist[i]) continue;
      if (i === s1) break;
      for (const [j, w] of adj[i]) if (d + w < dist[j]) {
        dist[j] = d + w; prev[j] = i; heap.push([d + w, j]);
        for (let c = heap.length - 1; c > 0; ) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; }
      }
    }
    if (!Number.isFinite(dist[s1])) return [a, b];
    const way = [];
    for (let i = s1; i >= 0; i = prev[i]) { way.push(nodes[i]); if (i === s0) break; }
    return [a, ...way.reverse(), b];
  }
  // edges(): every edge as [[x, z], [x, z]] (checks: nothing may cross the water but the bridge link)
  const edges = () => adj.flatMap((es, i) => es.filter(([j]) => j > i).map(([j]) => [nodes[i], nodes[j]]));
  return { route, edges, nodes: nodes.length, parts: sizes.length, main: main.length };
}

// world: { scene, town, BUILDINGS, frontZ, extent, hasLake, LAKE, waterSD (+ on land), riverZ, BASIN,
//          MILL, RIVERSIDE, quayZ, VILLAGE_X, vStreet, wallX, groundH }
// -> { pathRoutes (each { w, pts, path }: path is the dry line), highway (the carts' lane loop),
//      hwGeom (the highway's geometry), dryKeep, links (walkable joins no track draws: the bridge deck) }
export function buildPathNetwork(world) {
  const { scene, town, BUILDINGS, frontZ, extent, hasLake, LAKE, waterSD, riverZ, BASIN, MILL, RIVERSIDE, quayZ, VILLAGE_X, vStreet, wallX, groundH } = world;
  const pathRoutes = [], links = [];
  let highway = null, hwGeom = null;
  // medieval tracks: packed-earth ribbons draped over the terrain, with wheel
  // ruts, stone specks and ragged grassy edges -- one merged mesh, one call.
  // The town's spine is a 6m HIGHWAY (a Roman via: two 3.5m-spaced lanes,
  // right-hand traffic) running the whole facade line, ending in a 9m-radius
  // turning loop past the last building at each end so wagons never have to
  // reverse -- `highway` is the closed lane loop the carts drive.
  // No track runs through the lake or the river. A route is densified; where
  // it would enter the water it follows the SHORE instead -- the contour at
  // the track's half width plus a margin from open water -- from the last dry
  // point before the water to the first dry point after it, whichever way
  // round is shorter, and rejoins its own line as soon as the straight way
  // there is dry. A route that starts or ends in the water just has those
  // points pushed ashore. Only the bridge's own approaches may come to the
  // water (`dryKeep`: points whose surroundings are left as laid). Riders
  // ride the corrected line too (route.path).
  const dryKeep = [];
  function dryRoute(pts, w) {
    const need = w / 2 + .8, e = .5;
    const kept = (q) => dryKeep.some(([kx, kz]) => Math.hypot(q[0] - kx, q[1] - kz) < 6);
    const wet = (q) => !kept(q) && waterSD(q[0], q[1]) < need;
    const grad = (q) => { const gx = waterSD(q[0] + e, q[1]) - waterSD(q[0] - e, q[1]), gz = waterSD(q[0], q[1] + e) - waterSD(q[0], q[1] - e), l = Math.hypot(gx, gz) || 1; return [gx / l, gz / l]; };
    const toContour = (q) => { for (let i = 0; i < 8; i++) { const d = waterSD(q[0], q[1]); if (Math.abs(d - need) < .05) break; const g = grad(q); q[0] += g[0] * (need - d); q[1] += g[1] * (need - d); } return q; };
    const pushOut = (q) => { if (!kept(q) && waterSD(q[0], q[1]) < need) toContour(q); return q; };
    const dryLine = (a, b) => { const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]))); for (let k = 1; k < n; k++) if (wet([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n])) return false; return true; };
    const shoreWalk = (E, X) => {   // along the contour from E toward X, both ways round; the shorter arrival wins
      let best = null;
      for (const side of [1, -1]) {
        const way = [];
        let q = toContour([E[0], E[1]]);
        for (let i = 0; i < 700 && (!best || way.length < best.length); i++) {
          if (dryLine(q, X)) { if (!best || way.length < best.length) best = way.slice(); break; }
          const g = grad(q);
          q = toContour([q[0] - g[1] * side * 1.5, q[1] + g[0] * side * 1.5]);
          way.push([q[0], q[1]]);
        }
      }
      return best;
    };
    const out = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5));
      for (let k = i ? 1 : 0; k <= n; k++) out.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]);
    }
    const res = [];
    for (let i = 0; i < out.length; ) {
      if (!wet(out[i])) { res.push(out[i]); i++; continue; }
      let j = i;
      while (j < out.length && wet(out[j])) j++;
      const E = res[res.length - 1], X = out[j];
      const around = E && X ? shoreWalk(E, X) : null;
      if (around) res.push(...around);
      else for (let k = i; k < j; k++) res.push(pushOut([out[k][0], out[k][1]]));   // an end in the water: ashore
      i = j;
    }
    return res;
  }
  if (town.length) {
    const routes = pathRoutes;
    const roadZ = frontZ + 7;
    const xW = Math.min(...town.map((s) => s.x - BUILDINGS[s.key].footprint[0] / 2)) - 16;
    const xE = Math.max(...town.map((s) => s.x + BUILDINGS[s.key].footprint[0] / 2)) + 16;
    const LR = 9, LANE = 1.75;
    routes.push({ w: 6, pts: [[xW + LR - 3, roadZ], [xE - LR + 3, roadZ]] });
    for (const s of town) routes.push({ w: 1.5, pts: [[s.x, roadZ], [s.x, frontZ + .6]] });
    routes.push({ w: 1.9, pts: [[0, roadZ], [3, roadZ + 12], [-2, roadZ + 24], [1, 6]] });
    if (hasLake) routes.push({ w: 1.5, pts: [[1, 6], [8, extent + 12], [LAKE.x, LAKE.z]] });   // through the C's opening to the lagoon heart
    const arc = (cx, t0, t1, n) => Array.from({ length: n + 1 }, (_, i) =>
      [cx + Math.cos(t0 + (t1 - t0) * i / n) * LR, roadZ + Math.sin(t0 + (t1 - t0) * i / n) * LR]);
    const LAND = RIVERSIDE.find((s) => s.key === "landing");
    if (LAND) routes.push({ w: 4, pts: [[BASIN.x, roadZ], [BASIN.x, LAND.z - 8]] });   // the freight road: highway to the landing yard
    hwGeom = { roadZ, xW, xE, LR, LANE, arc };
    routes.push({ w: 6, pts: arc(xE, 0, Math.PI * 2, 40) }, { w: 6, pts: arc(xW, 0, Math.PI * 2, 40) });   // the turning loops
    if (MILL) {   // the riverside street: from the lake path west along the shore, then along the bank to the mill door
      const xE = Math.max(...RIVERSIDE.map((s) => s.x + BUILDINGS[s.key].footprint[0] / 2)) + 12;
      const xM = MILL.x + BUILDINGS.watermill.footprint[0] / 2 + 1.5;
      const quay = [];
      for (let x = xE; x > xM; x -= 6) quay.push([x, quayZ(x)]);
      routes.push({ w: 1.5, pts: [[8, extent + 12], [-40, extent + 26], [xE + 20, quayZ(xE) - 22], ...quay, [xM, MILL.z]] });
      for (const s of RIVERSIDE) if (s !== MILL && !s.bank)   // each building's own spur from the street to its door
        routes.push({ w: 1.2, pts: [[s.x, quayZ(s.x)], [s.x, s.z + BUILDINGS[s.key].footprint[1] / 2 - .4]] });
      if (VILLAGE_X !== null) {   // the bridge road: quay -> round the landing yard -> north ramp; south ramp -> the village street, with spurs to doors and gates
        const xb = VILLAGE_X, BR = BUILDINGS.bridge, LAND = RIVERSIDE.find((s) => s.key === "landing"), lfp = BUILDINGS.landing.footprint;
        const xe = LAND.x + lfp[0] / 2 + 2, xw = LAND.x - lfp[0] / 2 - 2, zN = LAND.z - lfp[1] / 2 - 2;
        const footN = riverZ(xb) - BR.halfL - BR.ramp;   // the north ramp's foot: the road must arrive there from beyond it, not run in under the ramp
        dryKeep.push([xb, footN], [xb, riverZ(xb) + BR.halfL + BR.ramp]);   // the bridge's ramp feet: the only place a track meets the water
        links.push([[xb, footN + .5], [xb, riverZ(xb) + BR.halfL + BR.ramp]]);   // ...and the deck between them joins the two roads for walkers
        routes.push({ w: 2.2, pts: [[xM, quayZ(xM)], [xe, quayZ(xe)], [xe, zN], [xw, zN], [xw, Math.min(quayZ(xw), footN - 4)], [xb + 6, footN - 3], [xb, footN - 2], [xb, footN + .5]] });
        const street = []; for (let x = wallX[0] - 10; x <= wallX[1] + 10; x += 6) street.push([x, vStreet(x)]);   // gate to gate and a little beyond
        routes.push({ w: 2.2, pts: [[xb, riverZ(xb) + BR.halfL + BR.ramp], [xb, vStreet(xb)]] }, { w: 2.2, pts: street });
        for (const s of RIVERSIDE) if (s.bank === "south") {
          const d = BUILDINGS[s.key], fp = d.footprint;
          if (d.pen) { const gx = s.x - (fp[0] - 1.6) / 2 + 3.5; routes.push({ w: 1.2, pts: [[gx, vStreet(gx)], [gx, s.z - fp[1] / 2 + 1.6]] }); }   // to the gate
          else if (d.doors?.length) { const dx = s.x + (d.doors[0].x ?? 0), fr = d.front ?? 1; routes.push({ w: 1.2, pts: [[dx, vStreet(dx)], [dx, s.z + fr * (fp[1] / 2 - .4)]] }); }   // to the door (front: -1 faces the street from the south)
          else if (d.square) routes.push({ w: 2.0, pts: [[s.x, vStreet(s.x)], [s.x, s.z - d.square + .3]] });   // to the fountain square's paving
        }
      }
    }
    {   // the lane loop: eastbound on the south lane, round the east loop, back west, round the west loop
      const a0 = Math.asin(LANE / LR), xc = Math.sqrt(LR * LR - LANE * LANE);
      const lane = [[xW + xc, roadZ + LANE], [xE - xc, roadZ + LANE],
                    ...arc(xE, Math.PI - a0, -(Math.PI - a0), 48).slice(1, -1),
                    [xE - xc, roadZ - LANE], [xW + xc, roadZ - LANE],
                    ...arc(xW, -a0, -(2 * Math.PI - a0), 48).slice(1, -1)];
      lane.push(lane[0]);
      highway = laneFrom(lane);
      hwGeom.xc = xc; hwGeom.a0 = a0;
    }
    const pos = [], uvs = [], idx = [];
    for (const rt of routes) rt.path = dryRoute(rt.pts, rt.w);
    for (const rt of routes) {
      // resample every ~1.5m, then one continuous strip whose cross-bars follow
      // the local tangent -- bends (the turning loops) stay clean instead of
      // wedging open at every polyline vertex
      const smp = [];
      let dist = 0;
      for (let s2 = 0; s2 + 1 < rt.path.length; s2++) {
        const [ax, az] = rt.path[s2], [bx, bz] = rt.path[s2 + 1];
        const len2 = Math.hypot(bx - ax, bz - az), steps2 = Math.max(1, Math.ceil(len2 / 1.5));
        for (let i = s2 ? 1 : 0; i <= steps2; i++) {
          const t = i / steps2;
          smp.push([ax + (bx - ax) * t, az + (bz - az) * t, dist + t * len2]);
        }
        dist += len2;
      }
      for (let i = 0; i < smp.length; i++) {
        const [x, z, d] = smp[i], q = smp[Math.max(0, i - 1)], nq = smp[Math.min(smp.length - 1, i + 1)];
        const tl = Math.hypot(nq[0] - q[0], nq[1] - q[1]) || 1;
        const px = -(nq[1] - q[1]) / tl, pz = (nq[0] - q[0]) / tl;   // unit perpendicular to the local tangent
        const y = groundH(x, z) + .12, hw = rt.w / 2;   // above the ground mesh's interpolation error
        const vi = pos.length / 3;
        pos.push(x - px * hw, y, z - pz * hw, x + px * hw, y, z + pz * hw);
        uvs.push(-1, d, 1, d);
        if (i) idx.push(vi - 2, vi - 1, vi, vi - 1, vi + 1, vi);
      }
    }
    const pgeo = new THREE.BufferGeometry();
    pgeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    pgeo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    pgeo.setIndex(idx);
    const track = new THREE.Mesh(pgeo, new THREE.ShaderMaterial({
      uniforms: { uMaskMode: MASK_MODE },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vW;
        void main() { vUv = uv; vW = (modelMatrix * vec4(position, 1.0)).xyz;
                      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uMaskMode;
        varying vec2 vUv; varying vec3 vW;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
        void main() {
          // ragged edges: the track width breathes along its length
          float edge = .78 + .2 * (hash(floor(vec2(vUv.y * .7, 3.))) - .5);
          if (abs(vUv.x) > edge) discard;
          // the grass mask (grass.js): where a track really is, it is not grass -- and only this shader knows
          // where that is, which is why the mask draws the track in its own material and not an override
          if (uMaskMode > .5) { gl_FragColor = vec4(0.0, 0.0, 0.0, .5); return; }   // .5: not grass, but flat enough for a stalk beside it to cross
          float n = hash(floor(vW.xz * 2.1));
          vec3 col = mix(vec3(.54, .44, .31), vec3(.42, .34, .24), smoothstep(.25, .75, n));
          col *= 1. - .16 * smoothstep(.14, .03, abs(abs(vUv.x) - .5));   // wheel ruts
          float st = hash(floor(vW.xz * 4.7) + 7.);
          col = mix(col, vec3(.62, .6, .55), step(.94, st) * .8);         // stone specks
          col *= .92 + .12 * hash(floor(vW.xz * .9) + 3.);                // large-scale tone patches
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    }));
    track.userData.cut = true;   // its ragged edge is a discard: it writes the mask in its own material instead
    track.layers.enable(NOGRASS_LAYER);
    scene.add(track);
  }
  return { pathRoutes, highway, hwGeom, dryKeep, links };
}
