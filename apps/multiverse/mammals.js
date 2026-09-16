// The mammal rig: one builder that turns a compact, root-space description
// of a quadruped into the ordinary part list every engine consumes.
//
// Authored in ROOT space: metres, x forward, y up from the GROUND (the feet
// stand on y = 0), z to the animal's left. The root part is the rear body
// lobe (a capsule along x, like every classic species, so riders, collision
// circles and terrain probes keep reading `body` as before); everything
// else hangs off it in parent-local coordinates the builder works out.
//
// What the rig adds over the classic capsule animals:
//   - a body of TWO lobes (rump and chest) and a head of two (skull and
//     muzzle), each pair melting into one shape -- the composite engine
//     smooth-unions parts by their `k` (blend radius), so withers, neck and
//     cheeks read as one silhouette instead of stacked pills
//   - legs of two bones each, upper and lower, with a hoof or paw: the knee
//     comes from two-bone IK every frame (skeleton.js), so a lifted foot
//     folds the leg and a planted one straightens it; `kneeF`/`kneeH` say
//     which way each pair bends (+1 forward, -1 backward -- the hock)
//   - a curved tail: an arc of n tapered links chained through their own
//     frames, swaying about the body's x axis as one; a cat's curl, a
//     horse's hanging sweep and a pig's corkscrew are just different angles
//   - walk and run parameter sets (foot phase offsets, stride, lift, bob),
//     defaulting from the leg length; a wanderer walks, a ridden animal runs
//
// Field reference (all in root space):
//   rear, front: body lobes [cx, cy, cz, sx, sy, sz] -- ellipsoid semi-axes; drawn as the capsule along the long axis
//   neck: [ax, ay, az, bx, by, bz, rA, rB] tapered pill from the chest into the head, or null
//   head: [cx, cy, cz, r]   muzzle: ellipsoid like a lobe   ears: [ax, ay, az, bx, by, bz, rBase, rTip] (the left; mirrored)
//   eyes: [x, y, z, r] (mirrored)   nose: [x, y, z, r] or null
//   legs: { front: [hipX, hipY, hipZ, upper], hind: [...], radii: [hip, knee, foot], foot: [sx, sy, sz], kneeF, kneeH, thigh }
//         thigh (default 1.35) widens the hind hip; kneeF/kneeH (+1 forward, -1 back) say which way each pair folds
//         toe: how far the foot's centre sits forward of the ankle (default .02: a hoof or pillar right under it;
//         a theropod's long three-toed foot reaches forward, the ankle at its heel)
//         toes: { n, len, r: [base, tip], spread (radians between toes), color } -- tapered toes fanning forward
//         from the foot's heel on its sole, the middle one longest (a theropod's splayed three); the foot is then its pad
//         the lower bone is whatever reaches the foot joint at rest; the foot ellipsoid's sole stands on the ground
//   tail: { c: [cx, cy], R, a0, a1, r1, r2, n, tuft, tuftColor, sway, speed, phase, z, zEnd } arc from angle a0 to a1 (radians, xy plane at z, drifting to zEnd);
//         start it ON the rump's rear edge (a root inside the rump hides the tail's first span in the body's silhouette)
//   extras: pills { id, parent, from, to, r1, r2, color, mirror, k, anim, pat }, ellipsoids { id, parent, ell, color, mirror, k },
//           arcs { id, parent, arc: { same fields as tail, axis } } (a trunk), or ready parts { raw, at } (parent-local part whose
//           root-space position `at` is converted for it)
//   c: colours { body, front, neck, head, muzzle, ear, eye, nose, leg, foot, tail, tuft }   pat / patOn: shader pattern + which pieces
//   k: { body, limb } blend radii (default from the rump's height)   headTurn: idle head yaw in degrees
//   gaits: { walk: { offsets, stride, lift, bob }, run: {...} } overrides (leg order FL, FR, HL, HR)
//   biped: true -- the hind pair only (a theropod: arms are extras); the legs alternate at a walk and a run alike

import { aim, vSub } from "./geom.js";

const P = vSub;   // a root-space point relative to a parent's origin
const rotX = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const rotZ = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
const mul = (A, B) => A.map((r) => [0, 1, 2].map((j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const mulT = (A, v) => [0, 1, 2].map((j) => A[0][j] * v[0] + A[1][j] * v[1] + A[2][j] * v[2]);   // A^T v

// an ellipsoid [cx, cy, cz, sx, sy, sz] as the capsule along its longest
// semi-axis (a sphere when it is round) -- the silhouette the banner
// engines draw for scaled spheres anyway, but without a scale that
// children would inherit
function ellPart(id, parent, e, origin, color, extra = {}) {
  const semi = [e[3], e[4], e[5]], dom = semi.indexOf(Math.max(...semi));
  const [p, q] = [0, 1, 2].filter((i) => i !== dom);
  const r = (semi[p] + semi[q]) / 2, h = semi[dom] - r;
  const base = { id, parent, pos: P(e, origin), color, edge: 0, ...extra };
  if (h < .004) return { ...base, shape: "sphere", size: { r: (r * 2 + semi[dom]) / 3 } };
  return { ...base, shape: "capsule", size: { r, len: 2 * h }, geomRot: dom === 0 ? [0, 0, 90] : dom === 2 ? [90, 0, 0] : undefined };
}
// a tapered pill from A to B (radius rA at A, rB at B), growing out of A
function pillPart(id, parent, A, B, rA, rB, origin, color, extra = {}) {
  const { len, rot } = aim([B[0] - A[0], B[1] - A[1], B[2] - A[2]]);
  return { id, parent, shape: "capsule", size: { r: rB, r2: rA, len }, pos: P(A, origin), rot, pivot: [0, len / 2, 0], color, edge: 0, ...extra };
}
const mirrorZ = (v) => [v[0], v[1], -v[2]];
const darken = (hex, f) => (Math.round(((hex >> 16) & 255) * f) << 16) | (Math.round(((hex >> 8) & 255) * f) << 8) | Math.round((hex & 255) * f);
// an eye as a FACE MARK (the composite paints it onto its parent sphere's surface; no SDF part): a short pill
// whose two ends are the eye's corners on the sphere (centre H, radius R), either side (about the vertical) of
// where the direction to E meets it, r its half-height -- round, the iris filling it inside a darker rim, a
// pupil round, a bar (grazers) or a slit (small cats, reptiles). One maker for the rig and the classic species
export function eyeMark(id, parent, H, R, E, r, iris, { pupil = "round" } = {}) {
  const e = vSub(E, H), l = Math.hypot(...e) || 1, d = e.map((v) => v / l), half = Math.min(.6, r / R);
  const at = (a) => [H[0] + R * (d[0] * Math.cos(a) + d[2] * Math.sin(a)), H[1] + R * d[1], H[2] + R * (d[2] * Math.cos(a) - d[0] * Math.sin(a))];
  return pillPart(id, parent, at(half), at(-half), r, r, H, darken(iris, .35), { dot: { iris, pupil, round: true, role: "eye" } });
}

// An arc of n chained tapered links from angle a0 to a1 on the circle
// (c, R) in the xy plane (z offset optional), each link a child of the one
// before, expressed in that link's own frame so the whole chain turns as
// one when the first link's `anim` swings it: `axis` "x" sways it sideways
// (tails), "z" swings it fore and aft (a trunk). `tuft` ends it in a ball.
// fold: [first, rest] degrees -- struck down (combat.js), the first link turns so much about the arc's bending axis and every
// later link so much more: the chain curls in close to the body (a hydra's necks)
// The arc as TUBES, not a chain of pills: one quadratic Bezier per ARC_SEG of turn, its control where the
// arc's end tangents cross (R / cos(half the angle)) -- which reproduces a circular arc to well under a
// millimetre at this size. A tail that was five pills and a tuft is one tube and a tuft. The links never bent
// against each other anyway (only the first carried the sway, the rest were rigid), so the motion is the one
// it always was. Each segment keeps the PILLS' OWN FRAME -- aimed with +y along its chord, its far end at
// [0, len, 0] -- so anything that hung on a link still hangs where it did.
// `links: true` keeps the caller's n segments because things are PARENTED to them by id and posed in their
// frames (a dragon's tail spades on the last link, a stegosaur's plates and thagomizer down the tail);
// everywhere else n is ignored and the curve decides.
const ARC_SEG = 1.2;                                  // radians of arc per tube (~70 degrees)
const arcControl = (R, dA) => R / Math.cos(dA / 2);   // where the arc's end tangents cross
function arcChain(id, parent, origin, { c: [cx, cy], R, a0, a1, r1, r2, n = 5, links = false, tuft = 0, tuftColor, sway = 12, speed = .6, phase = 0, z = 0, zEnd = z, axis = "x", color, pat, k, fold }) {
  const pt = (a, rr = R) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a), z + (zEnd - z) * (a - a0) / (a1 - a0)];   // zEnd: the arc drifts sideways (a hydra's necks splay)
  const nSeg = links ? n : Math.max(1, Math.ceil(Math.abs(a1 - a0) / ARC_SEG)), dA = (a1 - a0) / nSeg;
  const out = [];
  let par = parent, M = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], lastLen = 0;
  for (let i = 0; i < nSeg; i++) {
    const t0 = a0 + dA * i, A = pt(t0), B = pt(t0 + dA), C = pt(t0 + dA / 2, arcControl(R, dA));
    const rA = r1 + (r2 - r1) * i / nSeg, rB = r1 + (r2 - r1) * (i + 1) / nSeg;
    const { len, rx, rz, rot } = aim(mulT(M, vSub(B, A)));
    const Mi = mul(rotX(rx), rotZ(rz));                      // this segment's own rotation inside its parent's frame
    const lid = i ? `${id}${i}` : id;
    out.push({ id: lid, parent: par, shape: "tube",
               size: { a: [0, 0, 0], b: [0, len, 0], c: mulT(Mi, mulT(M, vSub(C, A))), r1: rA, r2: rB },
               pos: i ? [0, lastLen, 0] : P(A, origin), rot, color, pat, k, edge: 0,
               anim: i ? undefined : { axis, deg: sway, speed, phase }, fold: fold ? [0, 0, i ? fold[1] : fold[0]] : undefined });
    M = mul(M, Mi);
    par = lid; lastLen = len;
  }
  if (tuft) out.push({ id: `${id}Tuft`, parent: par, shape: "sphere", size: { r: tuft }, pos: [0, lastLen, 0], color: tuftColor ?? color, k, edge: 0 });
  return out;
}

const FURRY = /^(body|front|neck|head|snout|ear[LR]|leg(FL|FR|HL|HR)[ul]|tail\d*|tailTuft|mane[LR]?)$/;
export function mammal(o) {
  const { name, rear, front, neck = null, head = null, muzzle = null, ears = null, eyes = null, nose = null, legs, tail = null,
          extras = [], c, pat, patOn = ["body", "front", "neck", "leg"], gaits = {}, k = {}, headTurn = 14, pupil = "round", fur = !o.dinosaur, ...flags } = o;
  const R = [rear[0], rear[1], rear[2]];
  const kB = k.body ?? rear[4] * .55, kL = k.limb ?? rear[4] * .2;
  const col = (key, fb) => c[key] ?? fb;
  const cBody = c.body, cHead = col("head", cBody), cLeg = col("leg", cBody);
  const cols = { front: col("front", cBody), neck: col("neck", cBody), head: cHead, muzzle: col("muzzle", cHead), ear: col("ear", cHead),
                 eye: col("eye", 0x241812), nose: col("nose", 0x1a1410), leg: cLeg, foot: col("foot", cLeg), tail: col("tail", cBody), tuft: col("tuft", 0x3a2a18) };
  const patFor = (key) => (pat && patOn.includes(key)) ? pat : undefined;
  const H = head ? [head[0], head[1], head[2]] : null;
  const origins = { body: R, head: H, front: front ? [front[0], front[1], front[2]] : null, muzzle: muzzle ? [muzzle[0], muzzle[1], muzzle[2]] : null };

  // ---- the torso: two lobes, the neck, the head and its muzzle
  const rr = (rear[4] + rear[5]) / 2;
  const parts = [
    { id: "body", parent: null, shape: "capsule", size: { r: rr, len: Math.max(2 * (rear[3] - rr), .01) }, geomRot: [0, 0, 90], pos: R, color: cBody,
      pat: patFor("body"), frame: "body", k: kB, edge: 0, bob: true },   // frame "body": the coat pattern is one solid texture over rump, chest, neck and head
    ellPart("front", "body", front, R, cols.front, { k: kB, pat: patFor("front"), frame: "body" }),
  ];
  if (neck) parts.push(pillPart("neck", "body", neck.slice(0, 3), neck.slice(3, 6), neck[6], neck[7], R, cols.neck, { k: kB * .8, pat: patFor("neck"), frame: "body" }));
  if (head) {
    parts.push({ id: "head", parent: "body", shape: "sphere", size: { r: head[3] }, pos: P(H, R), color: cHead, k: kB * .5, edge: 0, pat: patFor("head"), frame: "body",
                 anim: { axis: "y", deg: headTurn, speed: .3, phase: 0 } });
    if (muzzle) parts.push(ellPart("snout", "head", muzzle, H, cols.muzzle, { k: Math.min(.08, kB * .4), pat: patFor("muzzle"), frame: "body" }));
    if (ears) for (const s of [1, -1]) {
      const a = [ears[0], ears[1], ears[2] * s], b = [ears[3], ears[4], ears[5] * s];
      parts.push(pillPart(s > 0 ? "earL" : "earR", "head", a, b, ears[6], ears[7], H, cols.ear, { k: kL * .5 }));
    }
    if (eyes) for (const s of [1, -1])   // face marks (painted on the head, no SDF): round, the species' pupil
      parts.push(eyeMark(s > 0 ? "eyeL" : "eyeR", "head", H, head[3], [eyes[0], eyes[1], eyes[2] * s], eyes[3], cols.eye, { pupil }));
    if (nose) parts.push({ id: "nose", parent: "head", shape: "sphere", size: { r: nose[3] }, pos: P(nose, H), color: cols.nose, edge: 0 });
  }

  // ---- legs: upper bone (IK driver), lower bone (follows), foot
  const L = legs, foot = L.foot, footY = foot[1] + .02;
  const [rHip0, rKnee, rFoot] = L.radii, thigh = L.thigh ?? 1.35;   // the hind upper bone is the thigh: wider at the hip
  let legLen = 0;
  [["FL", L.front, 1, L.kneeF ?? 1], ["FR", L.front, -1, L.kneeF ?? 1], ["HL", L.hind, 1, L.kneeH ?? -1], ["HR", L.hind, -1, L.kneeH ?? -1]].forEach(([tag, d, sz, side], i) => {
    if (flags.biped && i < 2) return;   // two legs: the hind pair carries it
    const [hx, hy, hz, upper] = d, lower = hy - upper - footY, rHip = i < 2 ? rHip0 : rHip0 * thigh;
    if (lower <= .01) throw new Error(`${name}: leg ${tag}: upper bone ${upper} leaves no lower bone (hip ${hy}, foot ${footY})`);
    if (i === (flags.biped ? 2 : 0)) legLen = upper + lower;
    parts.push(
      { id: `leg${tag}u`, parent: "body", shape: "capsule", size: { r: rHip, r2: rKnee, len: upper }, pos: [hx - R[0], hy - R[1], hz * sz - R[2]],
        pivot: [0, -upper / 2, 0], color: cLeg, pat: patFor("leg"), k: kL, edge: 0, ik: { leg: i, upper, lower, side, foot: footY - R[1], phase: 0 } },
      { id: `leg${tag}l`, parent: `leg${tag}u`, shape: "capsule", size: { r: rKnee, r2: rFoot, len: lower }, pos: [0, -upper, 0],
        pivot: [0, -lower / 2, 0], color: cLeg, pat: patFor("leg"), k: kL, edge: 0, ik: { leg: i, follow: true } },
      ellPart(`foot${tag}`, `leg${tag}l`, [L.toe ?? .02, -lower - .02, 0, foot[0], foot[1], foot[2]], [0, 0, 0], cols.foot, { k: kL * .5 }));
    if (L.toes) {   // in the foot's frame: origin at its centre, the sole at -foot[1]
      const { n = 3, len, r: [r0, r1] = [.08, .04], spread = .45, color } = L.toes, x0 = -foot[0] * .4, mid = (n - 1) / 2;
      for (let j = 0; j < n; j++) {
        const th = (j - mid) * spread, l = len * (j === mid ? 1 : .8);
        parts.push(pillPart(`toe${tag}${j}`, `foot${tag}`, [x0, r0 - foot[1], 0], [x0 + l * Math.cos(th), r1 - foot[1], l * Math.sin(th)], r0, r1, [0, 0, 0], color ?? cols.foot, { k: kL * .3 }));
      }
    }
  });

  // ---- tail: an arc of chained tapered links
  if (tail) parts.push(...arcChain("tail", "body", R, { ...tail, color: cols.tail, pat: patFor("tail"), k: kL, axis: "x", tuftColor: tail.tuftColor ?? cols.tuft }));

  // ---- extras: horns, manes, humps, tusks, wings, a rider's torso...
  for (const x of extras) {
    const origin = origins[x.parent ?? "body"] ?? R;
    const sides = x.mirror ? [1, -1] : [1];
    for (const s of sides) {
      const id = x.mirror ? x.id + (s > 0 ? "L" : "R") : x.id;
      const extra = { k: x.k ?? 0, pat: x.pat, anim: x.anim && x.mirror ? { ...x.anim, deg: x.anim.deg * s } : x.anim };
      if (x.raw) parts.push({ ...x.raw, pos: x.at ? P(x.at, origin) : x.raw.pos });
      else if (x.arc) parts.push(...arcChain(id, x.parent ?? "body", origin, { ...x.arc, color: x.color, k: x.k ?? kL, tuftColor: x.arc.tuftColor ?? x.color }));
      else if (x.ell) { const e = x.ell.slice(); e[2] *= s; parts.push(ellPart(id, x.parent ?? "body", e, origin, x.color, extra)); }
      else parts.push(pillPart(id, x.parent ?? "body", s > 0 ? x.from : mirrorZ(x.from), s > 0 ? x.to : mirrorZ(x.to), x.r1, x.r2 ?? x.r1, origin, x.color, extra));
    }
  }

  // ---- gaits: lateral-sequence walk, rotary-ish run; stride, lift and bob scale with the leg
  const Lg = legLen;
  // FUR (composite: a strand texture over whatever colour or pattern): the coat's pieces -- trunk, neck, head, ears,
  // legs, tail, mane -- never horns, hooves, eyes; fur: false for the hairless hides and the reptiles
  if (fur) for (const p of parts) if (FURRY.test(p.id)) p.fur = true;
  const two = !!flags.biped;   // a biped's body dips over each stride, and its run is still left-right
  const walk = { offsets: [Math.PI / 2, 3 * Math.PI / 2, 0, Math.PI], stride: .32 * Lg, lift: .12 * Lg, bob: two ? .03 * Lg : 0, ...(gaits.walk ?? {}) };
  const run = { offsets: two ? [0, 0, 0, Math.PI] : [0, .6, Math.PI + .4, Math.PI + 1.0], stride: .48 * Lg, lift: .3 * Lg, bob: .06 * Lg, ...(gaits.run ?? {}) };
  const noseX = Math.max(front[0] + front[3], muzzle ? muzzle[0] + muzzle[3] : 0, head ? head[0] + head[3] : 0);
  return { name, ...flags, rig: true, gaits: { walk, run }, probe: (noseX - (rear[0] - rear[3])) / 2, legLen: Lg, parts };
}

// ============ families ==========================================================
// the horse frame at scale s (1 = a 1.6m horse), recoloured per species
function horseLike(s, c, { extras = [], pat, patOn, mane = true, head = true, ...flags } = {}) {
  const m = (v) => v.map((x) => x * s);
  return mammal({
    rear: m([-.45, 1.2, 0, .55, .42, .34]), front: m([.35, 1.22, 0, .58, .44, .35]),
    neck: head ? m([.75, 1.35, 0, 1.35, 1.95, 0, .2, .14]) : null,
    head: head ? m([1.45, 2.0, 0, .19]) : null, muzzle: head ? m([1.75, 1.88, 0, .24, .12, .11]) : null,
    ears: head ? m([1.4, 2.16, .08, 1.36, 2.36, .14, .045, .015]) : null, eyes: head ? m([1.58, 2.08, .14, .035]) : null,
    legs: { front: m([.62, 1.05, .22, .5]), hind: m([-.62, 1.08, .24, .55]), radii: m([.1, .07, .05]), foot: m([.08, .05, .07]) },
    tail: { c: m([-2.18, 1.45]), R: 1.2 * s, a0: 0, a1: -.62, r1: .06 * s, r2: .05 * s, n: 4, sway: 10, speed: .5 },
    extras: [...(mane && head ? [{ id: "mane", parent: "body", from: m([.78, 1.55, 0]), to: m([1.32, 2.1, 0]), r1: .07 * s, r2: .06 * s, color: c.mane ?? c.tail, k: .3 * s }] : []), ...extras],
    c, pat, patOn, pupil: "bar", ...flags,
  });
}
// the big-cat frame at scale s (1 = a 1.1m tiger)
function catLike(s, c, { extras = [], pat, patOn, tuft = .06, tailSway = 14, ...flags } = {}) {
  const m = (v) => v.map((x) => x * s);
  return mammal({
    rear: m([-.4, .72, 0, .5, .36, .3]), front: m([.28, .74, 0, .5, .37, .31]),
    neck: m([.62, .82, 0, .88, 1.0, 0, .22, .18]),
    head: m([.98, 1.05, 0, .23]), muzzle: m([1.15, .98, 0, .15, .1, .12]), nose: m([1.28, 1.0, 0, .03]),
    ears: m([.92, 1.24, .1, .9, 1.36, .15, .07, .03]), eyes: m([1.13, 1.13, .11, .028]),
    legs: { front: m([.42, .58, .2, .28]), hind: m([-.42, .6, .22, .3]), radii: m([.12, .09, .07]), foot: m([.09, .05, .08]) },
    tail: { c: m([-1.4, 1.2]), R: .6 * s, a0: -.59, a1: -1.7, r1: .05 * s, r2: .04 * s, n: 5, tuft: tuft * s, sway: tailSway, speed: .8 },
    extras, c, pat, patOn, ...flags,
  });
}

// the sheep frame at scale s (1 = a ewe, back ~.95m): wool body and cap, a dark face; extras for a ram's horns
function sheepLike(s, c, { extras = [], ...flags } = {}) {
  const m = (v) => v.map((x) => x * s);
  return mammal({ pupil: "bar",
    rear: m([-.25, .65, 0, .38, .3, .28]), front: m([.2, .66, 0, .36, .3, .27]),
    neck: m([.48, .75, 0, .62, .88, 0, .13, .11]), head: m([.68, .9, 0, .15]), muzzle: m([.82, .85, 0, .12, .08, .09]),
    ears: m([.68, .92, .12, .66, .9, .27, .045, .03]), eyes: m([.78, .95, .1, .025]),
    legs: { front: m([.28, .45, .16, .2]), hind: m([-.28, .45, .17, .22]), radii: m([.055, .045, .035]), foot: m([.055, .035, .05]) },
    tail: { c: m([-.89, .72]), R: .28 * s, a0: 0, a1: -.8, r1: .05 * s, r2: .035 * s, n: 3, sway: 16, speed: .8 },
    extras: [{ id: "wool", parent: "head", ell: m([.62, 1.0, 0, .14, .1, .13]), color: c.wool ?? c.body, k: .1 * s }, ...extras],
    c, ...flags });
}

// the deer frame at scale s (1 = a red deer, back ~1.2m); bulk thickens body, neck and legs (a reindeer's
// stockiness); antlers and horns come as extras
function deerLike(s, c, { bulk = 1, extras = [], ...flags } = {}) {
  const m = (v) => v.map((x) => x * s), lobe = (v) => [v[0] * s, v[1] * s, 0, v[3] * s, v[4] * s * bulk, v[5] * s * bulk];
  return mammal({ pupil: "bar", headTurn: 18,
    rear: lobe([-.5, .87, 0, .5, .36, .29]), front: lobe([.22, .89, 0, .5, .38, .28]),
    neck: [...m([.65, 1.05, 0, .92, 1.55, 0]), .15 * s * bulk, .11 * s * bulk], head: m([.98, 1.62, 0, .17]), muzzle: m([1.2, 1.55, 0, .2, .1, .1]), nose: m([1.4, 1.54, 0, .035]),
    ears: m([.92, 1.75, .09, .87, 1.98, .24, .06, .018]), eyes: m([1.1, 1.68, .13, .03]),
    legs: { front: m([.35, .82, .18, .45]), hind: m([-.5, .85, .2, .48]), radii: m([.07, .045, .035]).map((r) => r * bulk), foot: m([.06, .04, .05]) },
    tail: { c: m([-1.23, 1.05]), R: .25 * s, a0: 0, a1: -.7, r1: .045 * s, r2: .03 * s, n: 3, sway: 12, speed: .8 },
    extras, c, ...flags });
}
// a ram's horn: a spiral of four smooth curved tubes -- each a quarter turn and a bit, the arc's ends with the
// crossing of their tangents as the control -- from the crown back, down and forward round the ear, drifting
// outward and tapering, ridged (the twist pattern); points in the head's frame (the sheep frame at scale s)
function curlHorn(id, sd, s) {
  const H = [.68 * s, .9 * s, 0], R = .17 * s, a0 = 1.4, a1 = a0 + 4.4, root = [.64 * s, 1.04 * s], n = 4, dA = (a1 - a0) / n;
  const c = [root[0] - R * Math.cos(a0), root[1] - R * Math.sin(a0)], z0 = .1 * s * sd, z1 = .22 * s * sd, r0 = .06 * s, r1 = .02 * s;
  const at = (a, rr = R) => [c[0] + rr * Math.cos(a) - H[0], c[1] + rr * Math.sin(a) - H[1], z0 + (z1 - z0) * (a - a0) / (a1 - a0)];
  return Array.from({ length: n }, (_, i) => { const ta = a0 + i * dA;
    return { raw: { id: id + i, parent: "head", shape: "tube", size: { a: at(ta), c: at(ta + dA / 2, R / Math.cos(dA / 2)), b: at(ta + dA), r1: r0 + (r1 - r0) * i / n, r2: r0 + (r1 - r0) * (i + 1) / n },
                    pos: [0, 0, 0], color: 0xc9b48e, pat: "twist", k: .02 } }; });
}

// a spiral horn pair (a blackbuck's): ONE tapering horn a side, its corkscrew drawn by the `twist` pattern
// (ridges spiralling round the axis -- the same one the ram's curls wear) instead of built out of nine short
// pills wobbling along the line. A helix is not planar, so no tube could hold it either; and the wobble was
// only a couple of centimetres, which is what a pattern is for. 18 parts a pair became 2.
function spiralHorns(id, s, base, tip, { turns, r = .025, color }) {   // (turns: what the pills used to wind; the twist pattern's pitch is the horn's own girth)
  return [1, -1].map((sd) => {
    const B = [base[0] * s, base[1] * s, base[2] * s * sd], T = [tip[0] * s, tip[1] * s, tip[2] * s * sd];
    return { id: `${id}${sd > 0 ? "L" : "R"}`, parent: "head", from: B, to: T, r1: r * s, r2: r * s * .25, color, k: .004, pat: "twist" };
  });
}

// house cats: one frame, several coats (species.js makeCat picks one per cat)
export const CAT_COATS = [
  { body: 0xc77b3a, muzzle: 0xdba573, ear: 0xb06f34, leg: 0xb06f34, tail: 0xb06f34, eye: 0x8fa03a, nose: 0xd67c88 },   // ginger
  { body: 0x232020, muzzle: 0x2c2727, ear: 0x1b1818, leg: 0x1b1818, tail: 0x1b1818, eye: 0xc9b23a, nose: 0x3a2e2e },   // black
  { body: 0xece8e0, muzzle: 0xf5f2eb, ear: 0xdcc4c0, leg: 0xe4e0d8, tail: 0xe4e0d8, eye: 0x6fa0c8, nose: 0xe39aa6 },   // white
  { body: 0x8a8580, muzzle: 0xb5b0a8, ear: 0x6a6662, leg: 0x7a7570, tail: 0x6a6662, eye: 0x9fb04a, nose: 0x5a4a4a },   // grey
  { body: 0x222020, muzzle: 0xf0ece4, ear: 0x1c1a1a, leg: 0xf0ece4, tail: 0x1c1a1a, eye: 0xa8b848, nose: 0xd89aa0 },   // tuxedo: white face and socks
  { body: 0xe2c9a0, muzzle: 0xefe0c4, ear: 0xd4b58a, leg: 0xd4b58a, tail: 0xd4b58a, eye: 0xc99a3a, nose: 0xd8909a },   // cream
  { body: 0x6e5238, muzzle: 0xa88a6a, ear: 0x55402c, leg: 0x5e4630, tail: 0x55402c, eye: 0x8fa03a, nose: 0x5a3a30 },   // brown
  { body: 0xf0ebe2, head: 0xc77b3a, front: 0x2a2424, muzzle: 0xf0ebe2, ear: 0x2a2424, leg: 0xf0ebe2, tail: 0xc77b3a, eye: 0xb0a040, nose: 0xe39aa6 },   // calico patches
];
export const catRig = (c = CAT_COATS[0]) => mammal({ name: "cat",   // back ~.3m, curled-up tail
      rear: [-.12, .2, 0, .14, .09, .085], front: [.08, .2, 0, .13, .09, .08],
      neck: [.18, .24, 0, .26, .3, 0, .06, .055], head: [.3, .32, 0, .08], muzzle: [.36, .29, 0, .05, .035, .045], nose: [.405, .3, 0, .012],
      ears: [.28, .38, .04, .27, .46, .055, .025, .006], eyes: [.35, .34, .04, .015],
      legs: { front: [.12, .2, .05, .08], hind: [-.12, .2, .055, .085], radii: [.03, .025, .02], foot: [.03, .02, .028] },
      tail: { c: [-.38, .3], R: .13, a0: -.43, a1: 1.9, r1: .022, r2: .015, n: 6, sway: 20, speed: .9 },
      c, headTurn: 22, pupil: "slit" });

// the rigged mammals; `batWing` comes from species.js (shared with the dragon and hydra)
export function rigSpecies({ batWing }) {
  const PACE = { walk: { offsets: [0, Math.PI, .4, Math.PI + .4] } };   // giraffe and camel pace: both legs of a side together
  return [
    catRig(),   // the ginger one
    mammal({ name: "fox", pupil: "slit",   // back ~.4m, narrow pale snout, brush tail with a white tip
      rear: [-.14, .3, 0, .18, .13, .11], front: [.1, .31, 0, .17, .13, .11],
      neck: [.22, .36, 0, .34, .44, 0, .07, .06], head: [.4, .45, 0, .09], muzzle: [.5, .41, 0, .11, .045, .045], nose: [.6, .405, 0, .016],
      ears: [.37, .52, .045, .36, .64, .06, .035, .008], eyes: [.46, .48, .05, .016],
      legs: { front: [.16, .25, .07, .11], hind: [-.16, .25, .08, .12], radii: [.045, .035, .025], foot: [.04, .025, .035] },
      tail: { c: [-.55, .6], R: .4, a0: -.81, a1: -1.85, r1: .06, r2: .05, n: 5, tuft: .05, tuftColor: 0xe8e0d5, sway: 14, speed: .7 },
      c: { body: 0xc2571f, muzzle: 0xd9c8b8, ear: 0x53331c, leg: 0x53331c, eye: 0xc08326 }, headTurn: 20 }),
    mammal({ name: "dog",   // labrador-ish: back ~.6m, floppy ears, tail curved up
      rear: [-.2, .4, 0, .25, .17, .14], front: [.14, .41, 0, .24, .18, .15],
      neck: [.3, .47, 0, .45, .6, 0, .1, .08], head: [.5, .62, 0, .12], muzzle: [.62, .58, 0, .12, .06, .06], nose: [.735, .585, 0, .025],
      ears: [.46, .68, .09, .43, .55, .16, .05, .035], eyes: [.58, .66, .065, .02],
      legs: { front: [.2, .32, .1, .15], hind: [-.2, .33, .11, .17], radii: [.06, .045, .035], foot: [.05, .03, .045] },
      tail: { c: [-.5, .2], R: .35, a0: 1.33, a1: 2.4, r1: .03, r2: .025, n: 5, sway: 25, speed: 1.3 },
      c: { body: 0x9a6b3a, muzzle: 0xc9a06a, ear: 0x6b4423, leg: 0x86592e, eye: 0x4a2f1a }, headTurn: 20 }),
    mammal({ name: "wolf",  // back ~.8m, grey, pointed ears, tail hanging straighter
      rear: [-.27, .55, 0, .34, .23, .19], front: [.19, .56, 0, .32, .24, .2],
      neck: [.42, .64, 0, .62, .8, 0, .13, .1], head: [.68, .83, 0, .15], muzzle: [.84, .78, 0, .16, .075, .07], nose: [.995, .785, 0, .03],
      ears: [.63, .93, .07, .61, 1.1, .1, .05, .01], eyes: [.78, .89, .085, .025],
      legs: { front: [.28, .44, .13, .2], hind: [-.28, .45, .14, .22], radii: [.075, .055, .04], foot: [.06, .035, .055] },
      tail: { c: [-.9, 1.0], R: .6, a0: -.89, a1: -1.75, r1: .06, r2: .045, n: 5, sway: 14, speed: .9 },
      c: { body: 0x8c8c90, muzzle: 0xa8a8ac, ear: 0x5a5a60, leg: 0x6e6e73, tail: 0x6e6e73, eye: 0xb99a3a }, headTurn: 18 }),
    sheepLike(1, { body: 0xe6e0d4, neck: 0xe6e0d4, head: 0x4a4038, muzzle: 0x4a4038, ear: 0x4a4038, leg: 0x3f3831, tail: 0xe6e0d4, eye: 0xb98a3a },
      { name: "sheep", mount: { h: 1.75, speed: 1.05 } }),   // back ~.95m: wool body, dark face under a wool cap
    // the ram: the sheep frame a size up, a pale face, and the great horns -- each four curved tubes spiralling out
    // from the crown, back, down and forward round the ear, ridged
    sheepLike(1.1, { body: 0xd8cfbe, neck: 0xd8cfbe, head: 0xc4b49c, muzzle: 0xb4a48c, ear: 0xb4a48c, leg: 0x8a7a68, tail: 0xd8cfbe, eye: 0xb98a3a },
      { name: "ram", mount: { h: 1.9, speed: 1.1 },
        extras: [1, -1].flatMap((sd) => curlHorn(sd > 0 ? "hornL" : "hornR", sd, 1.1)) }),
    mammal({ name: "pig", mount: { h: 1.6, speed: 1.1 },   // back ~.9m: snout disc, flopped ears, corkscrew tail
      rear: [-.25, .55, 0, .4, .33, .3], front: [.22, .55, 0, .38, .32, .29],
      neck: null, head: [.7, .55, 0, .22], muzzle: [.9, .5, 0, .16, .11, .12], nose: [1.06, .5, 0, .06],
      ears: [.66, .74, .1, .78, .82, .17, .06, .02], eyes: [.85, .62, .1, .022],
      legs: { front: [.3, .35, .18, .16], hind: [-.3, .36, .18, .17], radii: [.07, .05, .04], foot: [.05, .03, .05] },
      tail: { c: [-.71, .7], R: .07, a0: 0, a1: 5.2, r1: .018, r2: .012, n: 6, sway: 20, speed: 1.8 },
      c: { body: 0xdba193, muzzle: 0xc98f80, ear: 0xc98f80, leg: 0xc98f80, tail: 0xc98f80, eye: 0x2e2019, nose: 0xb8776a } }),
    mammal({ name: "boar", mount: { h: 1.5, speed: 1.3 },   // ~.9m at the shoulder, bristle mane, tusks
      rear: [-.3, .6, 0, .42, .32, .27], front: [.22, .62, 0, .4, .33, .28], pat: "bark", patOn: ["body", "front"],
      neck: null, head: [.7, .55, 0, .2], muzzle: [.92, .47, 0, .17, .1, .1], nose: [1.1, .46, 0, .05],
      ears: [.68, .7, .12, .66, .82, .2, .05, .015], eyes: [.85, .62, .11, .022],
      legs: { front: [.32, .38, .17, .17], hind: [-.32, .4, .17, .19], radii: [.06, .045, .035], foot: [.05, .03, .045] },
      tail: { c: [-.94, .72], R: .24, a0: 0, a1: -1.1, r1: .018, r2: .012, n: 3, sway: 25, speed: 1.2 },
      extras: [{ id: "mane", parent: "body", ell: [-.05, .9, 0, .38, .07, .06], color: 0x2e2419, k: .05 },
               { id: "tusk", parent: "head", from: [.98, .38, .07], to: [1.05, .5, .11], r1: .02, r2: .008, color: 0xe8e0cc, mirror: true }],
      c: { body: 0x4a3a2c, muzzle: 0x3a2d22, ear: 0x3a2d22, leg: 0x2e2419, tail: 0x2e2419, eye: 0x1a1210, nose: 0x6a5548 } }),
    deerLike(1, { body: 0xa5713d, muzzle: 0x8a5c30, ear: 0x8a5c30, leg: 0x8a5c30, foot: 0x2b211a, tail: 0xe0d6c6, eye: 0x241812 },
      { name: "deer", mount: { h: 1.95, speed: 1.7 },   // back ~1.2m: slim legs, antlers, pale stub tail
      extras: [{ id: "antlerA", parent: "head", from: [.9, 1.75, .07], to: [.78, 2.15, .2], r1: .03, r2: .02, color: 0x8a7a64, mirror: true },
               { id: "antlerB", parent: "head", from: [.83, 1.95, .13], to: [.98, 2.15, .17], r1: .022, r2: .015, color: 0x8a7a64, mirror: true },
               { id: "antlerC", parent: "head", from: [.8, 2.08, .18], to: [.66, 2.28, .3], r1: .02, r2: .012, color: 0x8a7a64, mirror: true }] }),
    // the reindeer: the deer frame stocky (bulk), grey-brown with a pale shaggy throat, great branched antlers
    // sweeping back and up, a brow tine reaching forward over the face; ~1.1m at the shoulder
    deerLike(.95, { body: 0x7a6a58, front: 0x86765f, neck: 0xd8d0c0, head: 0x8a7a66, muzzle: 0x9a8a76, ear: 0x6a5a48, leg: 0x5a4a3a, foot: 0x2b241c, tail: 0xe0d8c8, eye: 0x241812 },
      { name: "reindeer", bulk: 1.25, mount: { h: 1.95, speed: 1.5 },
        extras: [
          { id: "mane", parent: "body", ell: [.72, 1.02, 0, .24, .19, .17], color: 0xe0d8c8, k: .1 },
          ...[[[.9, 1.75, .07], [.7, 2.2, .3], .036, .026], [[.7, 2.2, .3], [.8, 2.62, .38], .026, .014], [[.77, 2.03, .2], [.98, 2.22, .16], .018, .01],
              [[.73, 2.38, .33], [.92, 2.52, .3], .017, .009], [[.9, 1.8, .08], [1.14, 1.9, .05], .02, .012]]
            .map(([a, b, r1, r2], i) => ({ id: "antler" + i, parent: "head", from: a.map((v) => v * .95), to: b.map((v) => v * .95), r1, r2, color: 0xb8a88a, mirror: true })),
        ] }),
    // the oryx (gemsbok): ~1.2m at the shoulder, a sandy coat, the white face with its dark lower half, and horns
    // near a metre long, straight and swept back over the neck
    deerLike(1.08, { body: 0xc8b8a0, front: 0xc8b8a0, neck: 0xc0b098, head: 0xece6da, muzzle: 0x2a2420, ear: 0xc8b8a0, leg: 0xd0c6b4, foot: 0x2a2420, tail: 0x2a2420, eye: 0x241812 },
      { name: "oryx", bulk: 1.15, mount: { h: 2.0, speed: 1.6 },
        extras: [{ id: "horn", parent: "head", from: [.93 * 1.08, 1.76 * 1.08, .05], to: [.55 * 1.08, 2.62 * 1.08, .13], r1: .032, r2: .008, color: 0x2a2420, mirror: true }] }),
    // the blackbuck (Antilope cervicapra): ~.8m at the shoulder, slender, a dark coat, a pale chin, and the long
    // spiralled horns rising in a V
    deerLike(.7, { body: 0x3a2a22, front: 0x3a2a22, neck: 0x3a2a22, head: 0x4a3a30, muzzle: 0xe8e0d4, ear: 0x3a2a22, leg: 0xd8cfc0, foot: 0x2a2420, tail: 0x2a2420, eye: 0x241812 },
      { name: "cervicapra", bulk: .9, extras: spiralHorns("horn", .7, [.95, 1.78, .05], [.76, 2.55, .22], { turns: 3, color: 0x2a2420 }) }),
    catLike(1, { body: 0xd0772b, muzzle: 0xe8d7b8, ear: 0xb35f1e, leg: 0xc46c24, eye: 0xc08d3a, nose: 0xd67c88, tuft: 0x2b2118 },
      { name: "tiger", mount: { h: 2.0, speed: 1.8 }, pat: "stripes", patOn: ["body", "front", "neck", "leg", "tail"] }),   // ~1.1m shoulder, shader stripes
    // the smilodon: the big-cat frame at ~1m at the shoulder, tawny, a bob tail and the two sabre fangs (~20cm)
    catLike(.92, { body: 0xb08a56, muzzle: 0xd8c09a, ear: 0x8a6a40, leg: 0xa07a48, eye: 0xc08d3a, nose: 0x3a2a20, tuft: 0x6a4a2a },
      { name: "smilodon", mount: { h: 1.9, speed: 1.6 },
        tail: { c: [-.707, .589], R: .35, a0: 1.9, a1: 2.6, r1: .06, r2: .04, n: 3, sway: 10, speed: .8 },   // the bob tail: from the rump's top edge, drooping back
        extras: [{ id: "fang", parent: "head", from: [1.17 * .92, .95 * .92, .045], to: [1.2 * .92, .72 * .92, .05], r1: .024, r2: .006, color: 0xefe6cf, mirror: true }] }),
    // the leopard: the big-cat frame at ~.65m at the shoulder, golden, spotted all over, the long tail
    catLike(.6, { body: 0xd9a44a, muzzle: 0xeedcb4, ear: 0xb88a3a, leg: 0xd09a44, eye: 0xc9b23a, nose: 0xc27a6a, tuft: 0xd9a44a },
      { name: "leopard", pat: "rosettes", patOn: ["body", "front", "neck", "head", "leg", "tail"] }),
    catLike(1.08, { body: 0xc9a227, muzzle: 0xe0c17a, ear: 0x8a5a1c, leg: 0xb8941f, eye: 0xc08d3a, nose: 0x5a3a2a, tuft: 0x3a2a18 },
      { name: "lion", mount: { h: 2.0, speed: 1.7 }, tuft: .09,
        extras: [{ id: "mane", parent: "body", ell: [.86, 1.1, 0, .36, .36, .34], color: 0x8a5a1c, k: .12 }] }),   // ~1.2m shoulder, the mane round the neck
    mammal({ name: "cow", pupil: "bar", mount: { h: 2.25, speed: 1.2 },   // back ~1.45m: horns, dark patches, rope tail
      rear: [-.5, 1.0, 0, .62, .48, .38], front: [.4, 1.02, 0, .6, .47, .38],
      neck: [.9, 1.15, 0, 1.15, 1.25, 0, .28, .22], head: [1.28, 1.28, 0, .27], muzzle: [1.5, 1.18, 0, .2, .13, .15],
      ears: [1.26, 1.4, .2, 1.24, 1.42, .48, .07, .04], eyes: [1.42, 1.42, .22, .03],
      legs: { front: [.6, .66, .3, .3], hind: [-.62, .68, .3, .32], radii: [.11, .08, .06], foot: [.09, .05, .08] },
      tail: { c: [-1.6, 1.25], R: .5, a0: 0, a1: -1.3, r1: .04, r2: .03, n: 4, tuft: .07, tuftColor: 0x3a2e22, sway: 10, speed: .6 },
      extras: [{ id: "horn", parent: "head", from: [1.3, 1.5, .13], to: [1.34, 1.72, .32], r1: .035, r2: .012, color: 0xd8cbb0, mirror: true },
               { id: "patch1", parent: "body", ell: [-.15, 1.28, .4, .2, .13, .06], color: 0x4a3828 },
               { id: "patch2", parent: "body", ell: [.45, .82, -.4, .18, .12, .06], color: 0x4a3828 }],
      c: { body: 0xe8e2d0, muzzle: 0xcfc6ae, ear: 0xcfc6ae, leg: 0xd8cbb0, foot: 0x3a2e22, tail: 0xcfc6ae, eye: 0x2b1b10 }, headTurn: 12 }),
    mammal({ name: "ox", pupil: "bar", mount: { h: 2.35, speed: 1.1 }, draft: { yokeX: .8, yokeY: 1.5, zSp: .78, shaftY: .85, spacing: 2.9, back: 2.2, single: 1.9, speed: .85 },
      rear: [-.53, 1.07, 0, .66, .5, .4], front: [.42, 1.09, 0, .64, .5, .4],   // ~1.55m: a cow's frame, heavier, long curving horns
      neck: [.95, 1.24, 0, 1.22, 1.33, 0, .3, .24], head: [1.36, 1.36, 0, .28], muzzle: [1.6, 1.25, 0, .21, .14, .16],
      ears: [1.34, 1.48, .21, 1.32, 1.5, .5, .07, .04], eyes: [1.5, 1.5, .23, .03],
      legs: { front: [.64, .7, .32, .32], hind: [-.66, .72, .32, .34], radii: [.12, .085, .065], foot: [.1, .055, .09] },
      tail: { c: [-1.67, 1.33], R: .5, a0: 0, a1: -1.35, r1: .04, r2: .03, n: 4, tuft: .07, tuftColor: 0x2e2018, sway: 10, speed: .6 },
      extras: [{ id: "horn", parent: "head", from: [1.38, 1.58, .14], to: [1.3, 1.9, .55], r1: .045, r2: .015, color: 0xe2d6bc, mirror: true }],
      c: { body: 0x7a4527, muzzle: 0xc9b394, ear: 0x8f5a3a, leg: 0x6a3b20, foot: 0x2b1b10, tail: 0x6a3b20, eye: 0x2b1b10 }, headTurn: 10 }),
    horseLike(.85, { body: 0xe4e1d6, muzzle: 0x4a453e, ear: 0xd6d3c8, leg: 0xe4e1d6, foot: 0x2c2620, tail: 0xe4e1d6, mane: 0x2c2620, eye: 0x2a1a10, tuft: 0x2c2620 },
      { name: "zebra", mount: { h: 2.3, speed: 1.8 }, pat: "bands", patOn: ["body", "front", "neck", "head", "leg"] }),   // ~1.35m shoulder, shader bands
    horseLike(1, { body: 0x8a5a33, muzzle: 0x76492a, ear: 0x76492a, leg: 0x6e452a, foot: 0x2b211a, tail: 0x3a2a1c, mane: 0x3a2a1c, eye: 0x2a1a10 },
      { name: "horse", mount: { h: 2.35, speed: 2 }, draft: { yokeX: .62, yokeY: 1.56, zSp: .7, shaftY: .95, spacing: 2.8, back: 2.1, single: 1.7, speed: 1.25 } }),   // 1.6m withers
    mammal({ name: "camel", pupil: "bar", mount: { h: 2.9, speed: 1.6 },   // dromedary: 1.9m at the hump, S-neck, pacing gait
      rear: [-.45, 1.32, 0, .55, .42, .33], front: [.35, 1.35, 0, .55, .43, .34],
      neck: [.75, 1.3, 0, 1.25, 1.75, 0, .17, .14], head: [1.55, 2.38, 0, .16], muzzle: [1.78, 2.3, 0, .2, .1, .11],
      ears: [1.48, 2.5, .09, 1.45, 2.6, .12, .035, .012], eyes: [1.65, 2.44, .12, .03],
      legs: { front: [.55, 1.15, .22, .55], hind: [-.55, 1.17, .23, .6], radii: [.09, .06, .05], foot: [.1, .05, .09] },
      tail: { c: [-1.88, 1.55], R: .9, a0: 0, a1: -.55, r1: .035, r2: .03, n: 3, tuft: .06, tuftColor: 0x6a4a2a, sway: 10, speed: .5 },
      extras: [{ id: "hump", parent: "body", ell: [-.05, 1.72, 0, .38, .3, .3], color: 0xbb9460, k: .18 },
               { id: "neck2", parent: "body", from: [1.25, 1.75, 0], to: [1.48, 2.32, 0], r1: .14, r2: .12, color: 0xc6a06a, k: .16 }],
      c: { body: 0xc6a06a, muzzle: 0xb08a58, ear: 0xb08a58, leg: 0xb08a58, foot: 0x6a4a2a, tail: 0xb08a58, eye: 0x2a1a10 }, gaits: PACE }),
    mammal({ name: "bactrian", pupil: "bar", mount: { h: 3.0, speed: 1.5 },   // the two-humped camel of the steppes: ~2.1m at the humps, darker, shaggy throat and hump tops
      rear: [-.45, 1.3, 0, .58, .44, .36], front: [.35, 1.33, 0, .56, .45, .37],
      neck: [.75, 1.3, 0, 1.2, 1.7, 0, .19, .15], head: [1.5, 2.3, 0, .16], muzzle: [1.73, 2.22, 0, .2, .1, .11],
      ears: [1.43, 2.42, .09, 1.4, 2.52, .12, .035, .012], eyes: [1.6, 2.36, .12, .03],
      legs: { front: [.55, 1.12, .22, .52], hind: [-.55, 1.14, .23, .57], radii: [.1, .065, .055], foot: [.11, .05, .1] },
      tail: { c: [-1.93, 1.52], R: .9, a0: 0, a1: -.55, r1: .035, r2: .03, n: 3, tuft: .07, tuftColor: 0x3a2a1a, sway: 10, speed: .5 },
      extras: [{ id: "humpA", parent: "body", ell: [-.5, 1.8, 0, .27, .32, .25], color: 0x7a5535, k: .16 },
               { id: "humpB", parent: "body", ell: [.38, 1.83, 0, .27, .34, .26], color: 0x7a5535, k: .16 },
               { id: "neck2", parent: "body", from: [1.2, 1.7, 0], to: [1.44, 2.24, 0], r1: .15, r2: .13, color: 0x8a6440, k: .16 },
               { id: "beard", parent: "body", ell: [1.0, 1.42, 0, .14, .3, .13], color: 0x5a3e26, k: .08 }],   // the winter mane under the throat
      c: { body: 0x8a6440, muzzle: 0x76553a, ear: 0x76553a, leg: 0x7a5838, foot: 0x3a2a1a, tail: 0x76553a, eye: 0x2a1a10 }, gaits: PACE }),
    mammal({ name: "bear", mount: { h: 2.15, speed: 1.4 },   // ~1.4m at the shoulder hump, big paws, stub tail
      rear: [-.42, .95, 0, .58, .48, .4], front: [.35, 1.0, 0, .58, .5, .42],
      neck: [.8, 1.1, 0, 1.05, 1.22, 0, .3, .22], head: [1.15, 1.27, 0, .25], muzzle: [1.36, 1.2, 0, .16, .1, .12], nose: [1.5, 1.22, 0, .04],
      ears: [1.08, 1.47, .13, 1.07, 1.53, .17, .08, .06], eyes: [1.3, 1.36, .11, .025],
      legs: { front: [.5, .55, .28, .25], hind: [-.5, .58, .28, .28], radii: [.17, .13, .1], foot: [.12, .06, .11] },
      tail: { c: [-1.13, 1.05], R: .15, a0: 0, a1: -.9, r1: .06, r2: .04, n: 2, sway: 10, speed: .5 },
      c: { body: 0x6b4a2e, muzzle: 0xa07850, ear: 0x59391f, leg: 0x59391f, tail: 0x59391f, eye: 0x241812 }, headTurn: 12 }),
    mammal({ name: "hippo", fur: false, mount: { h: 2.2, speed: 1.3 },   // ~1.5m: huge low body, stubby legs, eyes and ears high on the head
      rear: [-.55, .95, 0, .75, .55, .5], front: [.45, .95, 0, .75, .55, .52],
      neck: null, head: [1.4, .95, 0, .38], muzzle: [1.75, .82, 0, .3, .24, .3],
      ears: [1.42, 1.3, .2, 1.42, 1.4, .24, .06, .04], eyes: [1.6, 1.28, .3, .03],
      legs: { front: [.95, .55, .38, .25], hind: [-.62, .56, .38, .25], radii: [.18, .15, .12], foot: [.14, .06, .13] },   // front legs under the chest's front, close behind the head
      tail: { c: [-1.58, 1.15], R: .3, a0: 0, a1: -.9, r1: .05, r2: .035, n: 3, sway: 24, speed: 1.6 },
      c: { body: 0x8a8a86, muzzle: 0x9a9a94, ear: 0x74746e, leg: 0x767672, eye: 0x3a251a }, headTurn: 10 }),
    // the rhinoceros (white rhino): ~1.9m at the shoulder, ~4.2m long -- a massive barrel on pillar legs, the long
    // head carried low on a short thick neck, a wide square muzzle, two horns (~.6m and ~.25m), a wrinkled mottle
    mammal({ name: "rhinoceros", fur: false, mount: { h: 2.7, speed: 1.3 }, pat: "leaf", patOn: ["body", "front", "neck"],
      rear: [-.7, 1.2, 0, .95, .72, .62], front: [.55, 1.25, 0, .9, .75, .64],
      neck: [1.3, 1.35, 0, 1.62, 1.18, 0, .45, .38], head: [1.85, 1.05, 0, .36], muzzle: [2.2, .9, 0, .34, .24, .26],
      ears: [1.72, 1.4, .18, 1.68, 1.58, .22, .07, .03], eyes: [2.0, 1.12, .3, .025],
      legs: { front: [.8, .85, .38, .45], hind: [-.95, .88, .38, .48], radii: [.2, .16, .14], foot: [.16, .07, .15], kneeH: 1 },
      tail: { c: [-1.66, 1.3], R: .3, a0: 0, a1: -.9, r1: .05, r2: .035, n: 3, tuft: .05, sway: 20, speed: 1.2 },
      extras: [{ id: "horn", parent: "head", from: [2.35, 1.08, 0], to: [2.5, 1.68, 0], r1: .12, r2: .015, color: 0x6a6258 },
               { id: "horn2", parent: "head", from: [2.05, 1.2, 0], to: [2.1, 1.45, 0], r1: .09, r2: .015, color: 0x6a6258 }],
      c: { body: 0x8e8a82, front: 0x908c84, muzzle: 0x8a867e, ear: 0x7a766e, leg: 0x7e7a72, foot: 0x5a564e, eye: 0x2a2018 }, headTurn: 8 }),
    mammal({ name: "giraffe", pupil: "bar", mount: { h: 3.5, speed: 1.4 },   // back ~2.8m, head at ~4.4m, patches, ossicones, pacing gait
      rear: [-.55, 2.2, 0, .6, .5, .36], front: [.4, 2.35, 0, .62, .55, .38], pat: "spots", patOn: ["body", "front", "neck", "leg"],
      neck: [.85, 2.7, 0, 1.75, 4.15, 0, .22, .13], head: [1.85, 4.25, 0, .2], muzzle: [2.12, 4.17, 0, .22, .11, .1],
      ears: [1.78, 4.38, .1, 1.7, 4.55, .3, .06, .02], eyes: [2.0, 4.32, .15, .035],
      legs: { front: [.5, 1.9, .26, 1.0], hind: [-.55, 1.85, .28, 1.0], radii: [.1, .07, .05], foot: [.1, .06, .09] },
      tail: { c: [-2.33, 2.5], R: 1.2, a0: 0, a1: -.75, r1: .04, r2: .03, n: 4, tuft: .08, tuftColor: 0x3a2a18, sway: 10, speed: .6 },
      extras: [{ id: "ossicone", parent: "head", from: [1.84, 4.42, .07], to: [1.82, 4.68, .09], r1: .035, r2: .045, color: 0x9c6b28, mirror: true },
               { id: "mane", parent: "body", from: [.9, 2.85, 0], to: [1.72, 4.3, 0], r1: .06, r2: .04, color: 0x5c4630, k: .1 }],
      c: { body: 0xd2a04a, muzzle: 0xc0913f, ear: 0xc0913f, leg: 0xc0913f, foot: 0x3a2c22, tail: 0xc0913f, eye: 0x241812 }, headTurn: 12, gaits: PACE }),
    mammal({ name: "elephant", fur: false, mount: { h: 3.7, speed: 1.3 },   // ~3m at the shoulder: fan ears, hanging trunk, tusks; hind knees bend forward
      rear: [-.9, 2.0, 0, 1.2, 1.0, .85], front: [.8, 2.05, 0, 1.15, 1.0, .88],
      neck: null, head: [2.4, 2.45, 0, .72], muzzle: [2.85, 2.2, 0, .45, .35, .4],
      ears: null, eyes: [2.9, 2.75, .5, .035],
      legs: { front: [1.5, 1.35, .5, .7], hind: [-1.1, 1.3, .5, .7], radii: [.3, .25, .22], foot: [.3, .12, .28], kneeH: 1 },   // front pillars under the shoulder, just behind the head
      tail: { c: [-3.08, 2.55], R: 1.0, a0: 0, a1: -.85, r1: .06, r2: .04, n: 4, tuft: .07, tuftColor: 0x3a2e22, sway: 12, speed: .7 },
      extras: [{ id: "ear", parent: "head", ell: [2.25, 2.6, .8, .35, .65, .12], color: 0x8a847e, mirror: true, k: .1 },
               // the trunk: hangs from the face on an arc whose centre lies ahead, so the tip curls forward; swings fore and aft as it walks
               { id: "trunk", parent: "head", color: 0x9a938c, k: .1, arc: { c: [4.6, 2.2], R: 1.6, a0: Math.PI, a1: Math.PI + .85, r1: .17, r2: .09, n: 5, sway: 9, speed: .4, axis: "z" } },
               { id: "tusk", parent: "head", from: [2.95, 1.9, .3], to: [3.5, 1.6, .38], r1: .06, r2: .02, color: 0xe8e2d2, mirror: true }],
      c: { body: 0x9a938c, muzzle: 0x9a938c, leg: 0x8a847e, tail: 0x8a847e, eye: 0x54371f }, headTurn: 8 }),
    horseLike(.95, { body: 0xeceae2, muzzle: 0xdcd8cc, ear: 0xdcd8cc, leg: 0xe2dfd4, foot: 0x9a8f80, tail: 0xc8d4ea, mane: 0xc8d4ea, eye: 0x3a5a8e },
      { name: "unicorn", mount: { h: 2.35, speed: 1.9 }, monster: true,
        extras: [{ id: "horn", parent: "head", from: [1.5, 2.12, 0], to: [1.75, 2.55, 0], r1: .035, r2: .008, color: 0xd9c06a }] }),
    // manticore: a red lion with bat wings and a club tail; the wings are the shared batWing parts, placed at the shoulders
    catLike(.9, { body: 0x8e3b28, head: 0xa04a30, muzzle: 0xc27a52, ear: 0x5a2418, leg: 0x7a3222, eye: 0xd9a520, nose: 0x3a1a14, tuft: 0x3a2a20 },
      { name: "manticore", monster: true, mount: { h: 2.7, speed: 1.7, fly: true }, tuft: .14, tailSway: 18,
        extras: [{ id: "mane", parent: "body", ell: [.78, 1.0, 0, .32, .32, .3], color: 0x5a2418, k: .1 },
                 ...[1, -1].flatMap((s) => batWing(s, { k: .76, x: -.08, y: 1.05, z: .24, bone: 0x4a2a3a, deg: 14, speed: .5 })
                   .map((p) => p.parent === "body" ? { raw: p, at: p.pos } : { raw: p }))] }),
    dragon(batWing),
    hydra(),
    tyrannosaur(),
    triceratops(),
    styracosaurus(),
    stegosaurus(),
    ankylosaurus(),
    mammal({ name: "squirrel", climber: true,   // red squirrel: a 20cm body, a bushy tail as long again curled up over the back, tufted ears; lives in the trees (squirrels.js)
      rear: [-.05, .1, 0, .08, .06, .055], front: [.05, .11, 0, .07, .055, .05],
      neck: [.09, .13, 0, .12, .16, 0, .035, .03], head: [.145, .18, 0, .045], muzzle: [.18, .17, 0, .03, .022, .025], nose: [.21, .172, 0, .008],
      ears: [.13, .215, .025, .122, .25, .03, .013, .004], eyes: [.172, .19, .028, .01],
      legs: { front: [.06, .085, .03, .035], hind: [-.07, .095, .035, .045], radii: [.018, .012, .009], foot: [.018, .008, .012] },
      tail: { c: [-.2, .17], R: .099, a0: -Math.PI / 4, a1: 2.6, r1: .024, r2: .045, n: 6, tuft: .045, sway: 16, speed: .7 },
      c: { body: 0x9a4f2a, muzzle: 0xc98a5a, ear: 0x8a4424, leg: 0x8a4424, foot: 0x6a3418, tail: 0xa85a30, tuft: 0xa85a30, eye: 0x141010, nose: 0x2a1a14 }, headTurn: 30 }),
  ];
}

// the hydra: a squat, heavy lizard body on bent legs, three slender necks rising
// from the chest and splaying apart (the side ones drift outward as they rise)
// -- each an arc chain swaying on its own clock, ending in its head
// (the chain's tuft) with a snout and eyes hung in the head's own frame (+y
// along the neck's tip, +x down) -- and a drooping tail
function hydra() {
  const skin = 0x3f6b5a, headC = 0x4c7d68, snoutC = 0x5c8d76, eye = 0xc9d94a;
  const neck = (id, z, zEnd, R, a1, r, speed, phase) => [
    { id, parent: "body", color: skin, k: .04, arc: { c: [1.15 + R, 1.8], R, a0: Math.PI, a1, r1: .19, r2: .12, n: 6, tuft: r, tuftColor: headC, sway: 9, speed, phase, z, zEnd, fold: [-60, -20] } },   // (fold: struck down, the neck bows forward to the ground)
    { raw: { id: id + "Snout", parent: id + "Tuft", shape: "capsule", size: { r: .45 * r, len: 1.1 * r }, pos: [.12 * r, 1.05 * r, 0], color: snoutC, k: .04 } },
    ...[1, -1].map((s) => ({ raw: { id: id + (s > 0 ? "EyeL" : "EyeR"), parent: id + "Tuft", shape: "sphere", size: { r: .14 * r }, pos: [-.38 * r, .62 * r, s * .6 * r], color: eye } })),
  ];
  return mammal({ name: "hydra", monster: true, fur: false, mount: { h: 2.85, speed: 1.5 },
    rear: [-.6, 1.4, 0, .9, .7, .65], front: [.5, 1.45, 0, .85, .72, .66],
    legs: { front: [.7, 1.0, .5, .5], hind: [-.8, 1.02, .52, .55], radii: [.24, .18, .14], foot: [.24, .1, .2] },
    tail: { c: [-1.5, -1.2], R: 2.6, a0: Math.PI / 2, a1: Math.PI / 2 + .75, r1: .3, r2: .06, n: 5, sway: 10, speed: .4 },
    extras: [...neck("neckA", 0, 0, 1.15, Math.PI / 2 - .3, .23, .3, 0), ...neck("neckB", .4, 1.25, .85, Math.PI / 2 + .3, .21, .35, 2), ...neck("neckC", -.4, -1.25, .85, Math.PI / 2 + .3, .21, .32, 4)],
    c: { body: skin, front: 0x4a7a64, leg: 0x36584b, foot: 0x2a4238, tail: skin } });
}

// the dragon: ~2.9m at the back, ~9.5m nose to tail -- the rig's two lobes and
// IK legs, a long raised neck, two pairs of horns and a frill, spines on the
// rump and the neck (none where the rider sits), a long sweeping tail ending
// in a spade, and the shared bat wings at the shoulders
function dragon(batWing) {
  const tail = { c: [-2.2, -2.5], R: 4.4, a0: Math.PI / 2, a1: Math.PI / 2 + .9, n: 7, links: true };   // links: the spades hang on the last one
  const link = 2 * tail.R * Math.sin((tail.a1 - tail.a0) / (2 * tail.n));   // each tail link's length: the spade hangs on the last
  const ridge = 0x3a5a33, horn = 0xd8cbb0;
  const spine = (id, [x, y], [dx, dy], r) => ({ id, parent: "body", from: [x, y, 0], to: [x + dx, y + dy, 0], r1: r, r2: .02, color: ridge, k: .04 });
  return mammal({ name: "dragon", pupil: "slit", fur: false, monster: true, mount: { h: 3.6, speed: 1.8, fly: true },
    rear: [-.9, 1.9, 0, 1.3, .9, .8], front: [.7, 2.0, 0, 1.2, .92, .85],
    neck: [1.6, 2.4, 0, 2.75, 3.75, 0, .5, .3], head: [2.95, 3.85, 0, .42], muzzle: [3.45, 3.72, 0, .5, .22, .26], nose: [3.93, 3.78, 0, .06],
    ears: [2.72, 4.02, .26, 2.42, 4.08, .46, .1, .02], eyes: [3.2, 4.02, .24, .065],
    legs: { front: [1.0, 1.6, .6, .8], hind: [-1.3, 1.65, .65, .9], radii: [.3, .22, .16], foot: [.3, .12, .24] },
    tail: { ...tail, r1: .42, r2: .1, sway: 8, speed: .4 },
    extras: [
      { id: "horn", parent: "head", from: [2.8, 4.15, .2], to: [2.25, 4.7, .38], r1: .09, r2: .015, color: horn, mirror: true },
      { id: "hornB", parent: "head", from: [2.95, 4.22, .1], to: [2.65, 4.5, .15], r1: .06, r2: .012, color: horn, mirror: true },
      spine("spineA", [-1.55, 2.62], [-.25, .32], .12), spine("spineB", [-2.05, 2.4], [-.28, .26], .1),
      spine("spineC", [1.61, 3.09], [-.36, .26], .1), spine("spineD", [2.0, 3.46], [-.32, .24], .08),
      ...[1, -1].map((s) => ({ raw: { id: s > 0 ? "tailSpadeL" : "tailSpadeR", parent: `tail${tail.n - 1}`, shape: "tri",
                                      size: { a: [0, 0, 0], b: [s * .34, .42, 0], c: [0, .85, 0], r: .03 }, pos: [0, link, 0], color: ridge } })),
      ...[1, -1].flatMap((s) => batWing(s, { k: 1.6, x: .3, y: 2.55, z: .55, bone: 0x3a5232, mem: 0x35492e, deg: 11, speed: .35 })
        .map((p) => p.parent === "body" ? { raw: p, at: p.pos } : { raw: p })),
    ],
    c: { body: 0x4a7040, front: 0x55794a, head: 0x568049, muzzle: 0x5a8050, ear: ridge, eye: 0xd9a520, nose: 0x1a2416, leg: 0x3f6136, foot: 0x2e3a28, tail: 0x4a7040 },
    headTurn: 10 });
}

// ============ dinosaurs =========================================================
// (the rig's `dinosaur` flag: a group of their own, kept in the monster pen)
//
// the tyrannosaur: Tyrannosaurus rex at real size -- ~12.7m nose to tail,
// hips at ~3.3m, the back ~4.3m, a 1.6m skull. The dragon's principles on
// two legs (`biped`): a horizontal trunk of two lobes balanced over the
// hips, a short thick S of a neck, a deep skull with a pale lower jaw, brow
// bosses, knees folding FORWARD (a bird's), three-toed feet, the famous
// tiny two-fingered arms under the chest, and a long straight tail held out
// as the counterweight (an arc of 7 links, barely drooping)
function tyrannosaur() {
  const hide = 0x5d5638, pale = 0xb0a07a, dark = 0x3b3524;
  const arm = (id, from, to, r1, r2) => ({ id, parent: "front", from, to, r1, r2, color: 0x575034, mirror: true, k: .06 });
  return mammal({ name: "tyrannosaur", dinosaur: true, biped: true, mount: { h: 5.1, speed: 1.6 },
    rear: [-.4, 3.4, 0, 1.6, .92, .8], front: [1.5, 3.3, 0, 1.3, .95, .76],
    neck: [2.45, 3.7, 0, 3.4, 4.25, 0, .62, .5], head: [3.85, 4.35, 0, .55],
    eyes: [4.1, 4.58, .36, .07],
    legs: { front: [0, 1, 0, .5], hind: [-.2, 3.25, .72, 1.4], radii: [.42, .26, .16], foot: [.3, .12, .2], toe: .15, toes: { n: 3, len: .75, r: [.1, .045], spread: .45 }, kneeH: 1, thigh: 1.35 },   // the ankle at the heel; three toes splayed ~.65m wide, reaching ~.8m ahead
    tail: { c: [-2.37, -10.444], R: 14, a0: 1.5408, a1: 1.9265, r1: .72, r2: .07, n: 7, sway: 7, speed: .3 },
    extras: [
      { id: "snout", parent: "head", from: [3.95, 4.4, 0], to: [5.3, 4.12, 0], r1: .5, r2: .28, color: 0x6a6040, k: .14, pat: "scales" },   // deep at the eyes, tapering to the nose
      { id: "jaw", parent: "head", ell: [4.45, 3.9, 0, .85, .2, .32], color: pale, k: .08 },
      { id: "brow", parent: "head", from: [3.95, 4.8, .3], to: [4.3, 4.78, .3], r1: .11, r2: .05, color: 0x4f4930, mirror: true, k: .04 },
      arm("arm", [2.3, 2.75, .6], [2.5, 2.3, .66], .11, .08), arm("fore", [2.5, 2.3, .66], [2.85, 2.38, .6], .08, .05),
    ],
    c: { body: hide, front: 0x6a6242, neck: hide, head: 0x625a3c, muzzle: 0x6a6040, eye: 0xd9a520, leg: 0x534c32, foot: dark, tail: 0x57503a },
    pat: "scales", patOn: ["body", "front", "neck", "head", "muzzle", "leg", "tail"], headTurn: 12 });
}

// THE CERATOPSIANS: one frame -- the triceratops' at s = 1 (9.1m nose to
// tail, hips at ~2.9m) -- scaled, each with its own horns and frill. A broad
// barrel of a body, the legs set out at its flanks: pillar hind legs with
// forward knees (the elephant's), shorter front legs; a short neck into a
// massive skull -- a deep, boxy face (the snout barely tapers; a deep cheek
// and jaw under it) ending in a heavy hooked beak; the bony frill swept up
// and back (three flat triangles fanned into a shallow dish), optionally
// crowned with spikes round its upper rim; a thick tail held out level.
//   brow, nose: [from, to, r] horn pills (root space at s = 1)
//   spikes: lengths of the rim spikes, left to right along the rim (at s = 1)
function ceratopsian(s, { name, mount, brow, nose, spikes = [], c }) {
  const m = (v) => v.map((x) => x * s), horn = 0xe0d4b8;
  const A = m([-2.55, 2.1]), R = 5 * s, a0 = Math.PI / 2 - .1;   // the tail: from the rump's rear edge, a gentle arc 2.5m (at s = 1) back
  const OFF = [-.25, .25, 0], H = [2.8, 1.65, 0];   // the frill plates' offset in the head frame; the head's centre
  const plate = (id, a, b, cc) => ({ raw: { id, parent: "head", shape: "tri", size: { a: m(a), b: m(b), c: m(cc), r: .07 * s }, pos: m(OFF), color: c.frill, k: .05 * s } });
  const BL = [0, 0, .5], BR = [0, 0, -.5], TL = [-.45, 1.0, 1.0], TR = [-.45, 1.0, -1.0], TC = [-.85, 1.3, 0];   // the frill's corners, head frame: the sides brought forward, a shallow dish
  // the rim spikes: points spread along TL -> TC -> TR, each pointing out from the frill's middle across it, a little back
  const rim = spikes.map((len, i) => {
    const u = (i + .5) / spikes.length, [P0, P1, t] = u < .5 ? [TL, TC, u * 2] : [TC, TR, u * 2 - 1];
    const p = P0.map((v, k) => v + (P1[k] - v) * t), d = p.map((v, k) => v - [-.45, .55, 0][k] + [-.35, 0, 0][k]), dl = Math.hypot(...d);
    const from = p.map((v, k) => H[k] + OFF[k] + v), to = from.map((v, k) => v + d[k] / dl * len);
    return { id: "spike" + i, parent: "head", from: m(from), to: m(to), r1: .1 * s, r2: .015 * s, color: horn, k: .03 * s };
  });
  const hornPill = (id, [from, to, r], mirror) => ({ id, parent: "head", from: m(from), to: m(to), r1: r * s, r2: .02 * s, color: horn, mirror });
  return mammal({ name, dinosaur: true, mount,
    rear: m([-1.0, 2.0, 0, 1.6, 1.1, 1.1]), front: m([.85, 1.8, 0, 1.35, 1.0, 1.0]),
    neck: m([2.0, 1.8, 0, 2.5, 1.7, 0, .75, .6]), head: m([...H, .6]), eyes: m([3.05, 1.95, .38, .06]),
    legs: { front: m([1.35, 1.35, .82, .6]), hind: m([-1.2, 1.55, .82, .75]), radii: m([.36, .28, .23]), foot: m([.3, .13, .3]), kneeH: 1 },
    tail: { c: [A[0] - R * Math.cos(a0), A[1] - R * Math.sin(a0)], R, a0, a1: a0 + .5, r1: .65 * s, r2: .09 * s, n: 6, sway: 9, speed: .35 },
    extras: [
      { id: "snout", parent: "head", from: m([2.9, 1.65, 0]), to: m([3.85, 1.4, 0]), r1: .5 * s, r2: .34 * s, color: c.head, k: .14 * s, pat: "scales" },   // deep to the end: no anteater taper
      { id: "cheek", parent: "head", from: m([2.85, 1.3, 0]), to: m([3.75, 1.08, 0]), r1: .42 * s, r2: .26 * s, color: c.cheek, k: .14 * s, pat: "scales" },   // the deep jaw under it
      { id: "beak", parent: "head", ell: m([4.05, 1.22, 0, .24, .24, .17]), color: 0x2e2a22, k: .06 * s },
      hornPill("brow", brow, true), hornPill("noseHorn", nose),
      plate("frillC", BL, BR, TC), plate("frillL", BL, TL, TC), plate("frillR", BR, TR, TC),
      ...rim,
    ],
    c, pat: "scales", patOn: ["body", "front", "neck", "head", "leg", "tail"], headTurn: 10 });
}
// the triceratops: two metre-long brow horns and a stub on the nose (its three horns), a plain frill
const triceratops = () => ceratopsian(1, { name: "triceratops", mount: { h: 3.9, speed: 1.3 },
  brow: [[2.85, 2.05, .3], [3.75, 2.5, .42], .12], nose: [[3.6, 1.72, 0], [3.78, 2.08, 0], .11],
  c: { body: 0x6f6a4e, front: 0x77714f, neck: 0x77714f, head: 0x7a7352, cheek: 0x736c4c, frill: 0x8a5a3a, eye: 0x2a2014, leg: 0x625d44, foot: 0x3e3a2c, tail: 0x6a654a } });
// the styracosaurus: Styracosaurus albertensis, ~5.5m (the frame at .6) -- one long nose horn (~.6m), stubs
// for brow horns, and the frill's crown of long spikes, the middle ones longest
const styracosaurus = () => ceratopsian(.6, { name: "styracosaurus", mount: { h: 2.5, speed: 1.4 },
  brow: [[2.85, 2.05, .3], [2.98, 2.22, .34], .1], nose: [[3.55, 1.72, 0], [3.9, 2.8, 0], .17],
  spikes: [.55, .85, 1.0, 1.0, .85, .55],
  c: { body: 0x7a6446, front: 0x826b4b, neck: 0x826b4b, head: 0x86704e, cheek: 0x7c6748, frill: 0x9a4a2a, eye: 0x2a2014, leg: 0x6a5840, foot: 0x3e3226, tail: 0x756044 } });

// the stegosaurus: Stegosaurus at real size -- ~9.1m nose to tail, hips at
// ~2m and the back ~3m above them, falling to a small head carried low on
// short front legs; two rows of alternating plates (flat triangles) from the
// neck along the back -- the biggest over the hips -- and on down the tail,
// where they ride on its links and sway with it; the tail's end carries the
// four spikes (the thagomizer), splayed out, up and back
function stegosaurus() {
  const plateC = 0x9a6a3a, spikeC = 0xd8cbb0;
  const A = [-2.25, 2.35], R = 5.5, a0 = Math.PI / 2 - .05, n = 7, a1 = a0 + .6;
  const link = 2 * R * Math.sin((a1 - a0) / (2 * n)), tr = (i) => .6 + (.08 - .6) * i / n;   // a tail link's length; its radius at its start
  // the top line of the back (root space), for seating the plates on it
  const TOP = [[2.7, 1.6], [2.2, 2.0], [1.6, 2.45], [1.1, 2.62], [.4, 2.78], [-.2, 2.9], [-.55, 2.95], [-1.35, 2.92], [-2.0, 2.72]];
  const topY = (x) => { for (let i = 1; i < TOP.length; i++) if (x >= TOP[i][0]) { const [x0, y0] = TOP[i - 1], [x1, y1] = TOP[i]; return y1 + (y0 - y1) * (x - x1) / (x0 - x1); } return TOP[TOP.length - 1][1]; };
  const extras = [];
  // back plates [x, height, length], alternating rows: each its own flat triangle (no blend -- neighbours overlap at their
  // bases, so a blend would melt them together), leaning back a little and out to its own side
  [[2.55, .2, .3], [2.25, .28, .35], [1.9, .38, .45], [1.5, .48, .55], [1.05, .58, .6], [.6, .68, .7], [.15, .75, .75], [-.3, .8, .8],
   [-.75, .78, .8], [-1.2, .7, .75], [-1.6, .6, .65], [-1.95, .5, .55]].forEach(([x, h, len], i) =>
    extras.push({ raw: { id: "plate" + i, parent: "body", shape: "tri", size: { a: [len / 2, 0, 0], b: [-len / 2, 0, 0], c: [-len * .15, h, (i % 2 ? 1 : -1) * .14], r: .025 }, color: plateC, k: 0 },
                  at: [x, topY(x) - .06, i % 2 ? .1 : -.1] }));
  // tail plates on the first links (a link's frame: +y along the tail, +x up), shrinking
  [.45, .35, .25, .15].forEach((h, i) => { const rr = tr(i) * .8;
    extras.push({ raw: { id: "tplate" + i, parent: i ? "tail" + i : "tail", shape: "tri", size: { a: [rr, .05, 0], b: [rr, .8 * link, 0], c: [rr + h, .3 * link, (i % 2 ? -1 : 1) * .08], r: .02 }, pos: [0, 0, i % 2 ? -.08 : .08], color: plateC, k: 0 } }); });
  // the thagomizer: two pairs of spikes on the last link, ~.85m, splayed out and up at ~45 degrees, a little back
  for (const [j, yb] of [[0, .05], [1, .3]]) for (const sd of [1, -1])
    extras.push({ raw: { id: `spike${j}${sd > 0 ? "L" : "R"}`, parent: "tail" + (n - 1), shape: "tri", size: { a: [.02, yb, sd * .04], b: [.02, yb + .16, sd * .04], c: [.62, yb + .3, sd * .55], r: .045 }, pos: [0, 0, 0], color: spikeC, k: .01 } });
  return mammal({ name: "stegosaurus", dinosaur: true,
    rear: [-.55, 2.05, 0, 1.6, 1.0, .85], front: [.9, 1.8, 0, 1.3, .85, .8],   // (one line from the hips down to the shoulders: no step)
    neck: [2.05, 1.7, 0, 2.95, 1.3, 0, .42, .26], head: [3.2, 1.22, 0, .22], eyes: [3.33, 1.31, .17, .035],   // the head carried low but level
    legs: { front: [1.35, 1.2, .55, .55], hind: [-.9, 2.0, .6, 1.0], radii: [.3, .22, .18], foot: [.24, .11, .24], kneeH: 1 },
    tail: { c: [A[0] - R * Math.cos(a0), A[1] - R * Math.sin(a0)], R, a0, a1, r1: .6, r2: .08, n, links: true, sway: 8, speed: .3 },   // links: the plates and the thagomizer ride them
    extras: [
      { id: "snout", parent: "head", from: [3.25, 1.2, 0], to: [3.7, 1.14, 0], r1: .19, r2: .1, color: 0x72784f, k: .06, pat: "scales" },
      { id: "beak", parent: "head", ell: [3.76, 1.12, 0, .08, .07, .07], color: 0x2e2a22, k: .02 },
      ...extras,
    ],
    c: { body: 0x6d7250, front: 0x6d7250, neck: 0x72784f, head: 0x72784f, eye: 0x2a2014, leg: 0x5f6446, foot: 0x3c3e2e, tail: 0x676c4b },
    pat: "scales", patOn: ["body", "front", "neck", "head", "muzzle", "leg", "tail"], headTurn: 12 });
}

// the ankylosaurus: Ankylosaurus magniventris, ~8.2m -- low and very broad
// (~1.9m across, the back ~1.75m up): the rig's lobes are round, so a pair
// of lobes either side of them makes the body wide and flat, all under a
// shell of scutes (the shader's dark-edged cells, pattern "scutes") with spikes along the flanks;
// a broad low head with horns at the skull's back corners and on the cheeks;
// short stout legs; a stiff tail held straight out, ending in the club
// (a ball with a knob either side)
function ankylosaurus() {
  const armour = 0x6e6650, spike = 0xcfc2a2, club = 0x7a725c;   // grey-olive-brown under dark-edged scutes
  const A = [-1.85, 1.25], R = 12, a0 = Math.PI / 2 - .02, n = 6, a1 = a0 + 3.2 / R;
  const link = 2 * R * Math.sin((a1 - a0) / (2 * n));
  const side = (id, e) => ({ id, parent: "body", ell: e, color: armour, mirror: true, k: .25, pat: "scutes" });
  const flank = [1.3, .65, 0, -.65, -1.3].map((x, i) => ({ id: "flankSpike" + i, parent: "body", from: [x, 1.1, .82], to: [x - .12, 1.02, 1.18], r1: .08, r2: .015, color: spike, mirror: true }));
  return mammal({ name: "ankylosaurus", dinosaur: true, mount: { h: 2.5, speed: 1.1 },
    rear: [-.5, 1.2, 0, 1.4, .55, .55], front: [.9, 1.12, 0, 1.0, .5, .5],
    neck: [1.75, 1.15, 0, 2.1, 1.05, 0, .36, .3], head: [2.3, 1.0, 0, .36], eyes: [2.52, 1.1, .28, .035],
    legs: { front: [1.25, .8, .55, .35], hind: [-.95, .95, .6, .45], radii: [.26, .2, .18], foot: [.24, .1, .24], kneeH: 1 },
    tail: { c: [A[0] - R * Math.cos(a0), A[1] - R * Math.sin(a0)], R, a0, a1, r1: .38, r2: .12, n, links: true, tuft: .3, tuftColor: club, sway: 6, speed: .3 },   // links: the club's two lobes ride the last one
    extras: [
      side("flank", [-.5, 1.2, .42, 1.35, .5, .5]), side("shoulder", [.9, 1.12, .38, .95, .46, .46]),   // the width
      { id: "snout", parent: "head", from: [2.35, .97, 0], to: [2.8, .88, 0], r1: .3, r2: .2, color: 0x7a6c50, k: .08 },
      { id: "beak", parent: "head", ell: [2.9, .86, 0, .1, .1, .12], color: 0x2e2a22, k: .03 },
      { id: "cornerHorn", parent: "head", from: [2.1, 1.2, .3], to: [1.85, 1.2, .58], r1: .1, r2: .02, color: spike, mirror: true },
      { id: "cheekHorn", parent: "head", from: [2.25, .85, .3], to: [2.1, .72, .55], r1: .08, r2: .02, color: spike, mirror: true },
      ...flank,
      ...[1, -1].map((sd) => ({ raw: { id: sd > 0 ? "clubL" : "clubR", parent: "tail" + (n - 1), shape: "sphere", size: { r: .24 }, pos: [0, link, sd * .26], color: club, k: .06 } })),   // the club: ~.9m across
    ],
    c: { body: armour, front: armour, neck: 0x75674c, head: 0x7a6c50, eye: 0x2a2014, leg: 0x5e5240, foot: 0x3a3226, tail: armour },
    pat: "scutes", patOn: ["body", "front", "tail"], headTurn: 10 });
}
