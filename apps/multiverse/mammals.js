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
//           components by name ({ "component": "batWing", k, at, bone, mem, deg, speed }: COMPONENTS below; a wing's lobes
//           share their corners at the joints), an ellipsoid with `thorns`: a mane of thorns round the neck (manes.js),
//           arcs { id, parent, arc: { same fields as tail, axis } } (a trunk), or ready parts { raw, at } (parent-local part whose
//           root-space position `at` is converted for it)
//   c: colours { body, front, neck, head, muzzle, ear, eye, nose, leg, foot, tail, tuft }   pat / patOn: shader pattern + which pieces
//   k: { body, limb } blend radii (default from the rump's height)   headTurn: idle head yaw in degrees
//   gaits: { walk: { offsets, stride, lift, bob }, run: {...} } overrides (leg order FL, FR, HL, HR)
//   biped: true -- the hind pair only (a theropod: arms are extras); the legs alternate at a walk and a run alike

import { aim, vSub } from "./geom.js";
// a plain hex blend, for the torso's own shading from rump colour to chest colour
const mixC = (a, b, t) => {
  if (a === b) return a;
  const ch = (sh) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

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
  const { name, rear, front, neck = null, head: head0 = null, muzzle: muzzle0 = null, ears: ears0 = null, eyes: eyes0 = null, nose: nose0 = null, legs, tail = null,
          extras = [], c, pat, patOn = ["body", "front", "neck", "leg"], gaits = {}, k = {}, headTurn = 14, pupil = "round", fur = !o.dinosaur, headScale = 1, ...flags } = o;
  const R = [rear[0], rear[1], rear[2]];
  // HEAD SIZE. A skull is a sphere plus a muzzle, and both are easy to draw a little large -- measured against
  // real animals most of these heads came out a third to three quarters too long (ref/prop.html). `headScale`
  // shrinks the whole cluster -- skull, muzzle, nose, ears, eyes -- ABOUT THE NECK JOINT, so the head stays
  // seated on its neck and only its size changes. What HANGS on the head (horns, antlers, tusks: extras with
  // parent "head") keeps its own size and simply rides along, since those are measured from the head's centre.
  const hJ = neck ? neck.slice(3, 6) : head0 ? head0.slice(0, 3) : [0, 0, 0];
  const hP = (p) => p.map((v, i) => hJ[i] + (v - hJ[i]) * headScale);           // a point of the cluster
  const hR = (r) => r * headScale;                                             // a radius of it
  const head = head0 && headScale !== 1 ? [...hP(head0.slice(0, 3)), hR(head0[3])] : head0;
  const muzzle = muzzle0 && headScale !== 1 ? [...hP(muzzle0.slice(0, 3)), ...muzzle0.slice(3).map(hR)] : muzzle0;
  const nose = nose0 && headScale !== 1 ? [...hP(nose0.slice(0, 3)), hR(nose0[3])] : nose0;
  const ears = ears0 && headScale !== 1 ? [...hP(ears0.slice(0, 3)), ...hP(ears0.slice(3, 6)), hR(ears0[6]), hR(ears0[7])] : ears0;
  const eyes = eyes0 && headScale !== 1 ? [...hP(eyes0.slice(0, 3)), hR(eyes0[3])] : eyes0;
  const kB = k.body ?? rear[4] * .55, kL = k.limb ?? rear[4] * .2;
  const col = (key, fb) => c[key] ?? fb;
  const cBody = c.body, cHead = col("head", cBody), cLeg = col("leg", cBody);
  const cols = { front: col("front", cBody), neck: col("neck", cBody), head: cHead, muzzle: col("muzzle", cHead), ear: col("ear", cHead),
                 eye: col("eye", 0x241812), nose: col("nose", 0x1a1410), leg: cLeg, foot: col("foot", cLeg), tail: col("tail", cBody), tuft: col("tuft", 0x3a2a18) };
  const patFor = (key) => (pat && patOn.includes(key)) ? pat : undefined;
  const H = head ? [head[0], head[1], head[2]] : null;
  const origins = { body: R, head: H, front: front ? [front[0], front[1], front[2]] : null, muzzle: muzzle ? [muzzle[0], muzzle[1], muzzle[2]] : null };

  // ---- THE TORSO: A SPINE, then the neck, the head and its muzzle.
  //
  // It used to be two lobes: a rump capsule along x and a chest ellipsoid crossing it, overlapping in the
  // middle. As an SDF that melts into one body; as GEOMETRY it is two shapes at right angles, and no sweep can
  // make one lathe of them -- the animals read as two balls stuck together.
  //   The same measurements describe a chain instead. The rump keeps its capsule (it is the root, and every
  // other part hangs off its frame), and from its front end the torso continues as cuts laid END TO END to the
  // front of the chest, each cut's girth the one the two ellipsoids actually have at that station (their
  // union's cross-section). One continuous shape, from the same numbers, for both engines -- the SDF draws the
  // chain as a smooth union exactly as it drew the two lobes.
  const rr = (rear[4] + rear[5]) / 2, rF = (front[4] + front[5]) / 2;
  const ellR = (el, x) => {                      // an ellipsoid's cut at station x, as a radius
    const t = (x - el[0]) / Math.max(el[3], 1e-4);
    return Math.abs(t) >= 1 ? 0 : Math.sqrt(1 - t * t) * (el[4] + el[5]) / 2;
  };
  // a SOFT maximum of the two lobes: a hard one leaves a waist wherever the two ellipsoids both taper, and a
  // barrel-chested animal should not have a wasp waist between its shoulders and its hips. The power sets how
  // full the middle comes out -- at 6 an elephant still had a waist, since its two lobes are far apart and
  // both are tapering hard by the time they meet; at 3 the overlap fills the way the SDF's own blend filled
  // it (a single lobe is untouched either way: (a^p + 0)^(1/p) is a).
  const girth = (x) => {
    const a = ellR(rear, x), b = ellR(front, x);
    return Math.max(Math.cbrt(a * a * a + b * b * b), .02);
  };
  const xB = rear[0] + Math.max(rear[3] - rr, 0);        // where the rump's own capsule ends...
  const xF = front[0] + Math.max(front[3] - rF, 0);      // ...and where the chest's cap begins
  const parts = [
    { id: "body", parent: null, shape: "capsule", size: { r: rr, len: Math.max(2 * (rear[3] - rr), .01) }, geomRot: [0, 0, 90], pos: R, color: cBody,
      pat: patFor("body"), frame: "body", k: kB, edge: 0, bob: true, spine: true },   // frame "body": the coat pattern is one solid texture over rump, chest, neck and head
  ];
  {
    const N = 3, ids = ["body2", "body3", "front"];      // ("front" stays the last one: saddle() looks for it)
    const at = (i) => {                                  // station i: along the axis, drifting to the chest's line
      const f = i / N, x = xB + (xF - xB) * f;
      return [x, rear[1] + (front[1] - rear[1]) * f, rear[2] + (front[2] - rear[2]) * f];
    };
    // WHAT HANGS OFF THE CHEST HANGS OFF THE LAST CUT. `front` used to be the chest ellipsoid, centred on its
    // own middle, and extras with `parent: "front"` are placed relative to that centre -- so when the torso
    // became a spine and `front` became its last segment, everything on it moved with the segment's origin. A
    // tyrannosaur's arms ended up on its back. The origin children are measured from follows the part.
    origins.front = R;   // (extras on the chest hang on the ROOT: see the extras loop)
    for (let i = 0; i < N; i++) {
      const A = at(i), B = at(i + 1), f = (i + 1) / N;
      // (B first: a pillPart's posed axis runs from its second point to its first, and the spine has to run the
      //  same way as the rump capsule it continues, or the two will not read as one chain)
      parts.push(pillPart(ids[i], "body", B, A, girth(B[0]), girth(A[0]), R, mixC(cBody, cols.front, f),
                          { k: kB, pat: patFor(i === N - 1 ? "front" : "body"), frame: "body", spine: true }));
    }
  }
  if (neck) parts.push(pillPart("neck", "body", neck.slice(0, 3), neck.slice(3, 6), neck[6], neck[7], R, cols.neck, { k: kB * .8, pat: patFor("neck"), frame: "body" }));
  if (head) {
    // THE HEAD WEARS ITS COAT IN ITS OWN FRAME, not the figure's. The torso's pieces share one frame so that a
    // coat runs unbroken from rump to neck across their seams -- but the head TURNS on that neck, and a
    // pattern anchored to the body then stays behind while it does: the scales, stripes or spots slide over
    // the face, and the only thing that looks like it moved is the horns and ears hung on it.
    parts.push({ id: "head", parent: "body", shape: "sphere", size: { r: head[3] }, pos: P(H, R), color: cHead, k: kB * .5, edge: 0, pat: patFor("head"),
                 anim: { axis: "y", deg: headTurn, speed: .3, phase: 0 } });
    if (muzzle) parts.push(ellPart("snout", "head", muzzle, H, cols.muzzle, { k: Math.min(.08, kB * .4), pat: patFor("muzzle") }));   // (with the head: it turns too)
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
  for (const x0 of extras) {
    // a soft piece of the head (a sheep's fleece cap): it shrinks WITH the skull, unlike horns, antlers and
    // tusks, which keep their own size and simply ride along on the head that carries them
    let x = x0;
    if (headScale !== 1 && x0.parent === "head") {
      if (x0.headPiece)   // it IS the head: shrink it too
        x = { ...x0, ...(x0.from ? { from: hP(x0.from), to: hP(x0.to), r1: hR(x0.r1), r2: x0.r2 === undefined ? undefined : hR(x0.r2) } : null),
                     ...(x0.ell ? { ell: [...hP(x0.ell.slice(0, 3)), ...x0.ell.slice(3).map(hR)] } : null), k: x0.k === undefined ? undefined : hR(x0.k) };
      else if (x0.from) {   // a horn, a tusk, a fang: its own size, but its ROOT back on the skull it grows from
        const d = hP(x0.from).map((v, i) => v - x0.from[i]);
        x = { ...x0, from: x0.from.map((v, i) => v + d[i]), to: x0.to.map((v, i) => v + d[i]) };
      }
    }
    // ANYTHING HUNG ON THE CHEST HANGS ON THE ROOT INSTEAD. The torso's cuts are pillParts, and a pillPart
    // carries the rotation that aims it -- which its children inherit. The chest used to be an ellipsoid with
    // no rotation of its own, so extras written in the species' own coordinates landed where they were
    // written; through a spine segment they came out turned (a tyrannosaur's arms ended up at its throat).
    // The rump capsule is not aimed, so its frame IS the species' frame: they hang there, unturned.
    const par = (x.parent ?? "body") === "front" ? "body" : (x.parent ?? "body");
    const origin = origins[par] ?? R;
    const sides = x.mirror ? [1, -1] : [1];
    for (const s of sides) {
      const id = x.mirror ? x.id + (s > 0 ? "L" : "R") : x.id;
      const extra = { k: x.k ?? 0, pat: x.pat, anim: x.anim && x.mirror ? { ...x.anim, deg: x.anim.deg * s } : x.anim };
      if (x.raw) parts.push({ ...x.raw, parent: x.raw.parent === "front" ? "body" : x.raw.parent, pos: x.at ? P(x.at, origin) : x.raw.pos });
      // (pat: an extra's arc -- a dinosaur's tail, a hydra's neck -- wears the species' pattern like the rest
      //  of it; it used to be dropped here, so scaled animals had bare tails)
      else if (x.arc) parts.push(...arcChain(id, par, origin, { ...x.arc, color: x.color, k: x.k ?? kL, pat: x.pat ?? patFor("tail"), tuftColor: x.arc.tuftColor ?? x.color }));
      else if (x.ell) { const e = x.ell.slice(); e[2] *= s; parts.push(ellPart(id, par, e, origin, x.color, extra)); }
      else parts.push(pillPart(id, par, s > 0 ? x.from : mirrorZ(x.from), s > 0 ? x.to : mirrorZ(x.to), x.r1, x.r2 ?? x.r1, origin, x.color, extra));
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
  // a MANE OF THORNS (manes.js): an ellipsoid extra with `thorns` -- its part, the body and the head that orient it, its
  // size and colour, and the spikes' numbers -- for the mesh that rides on it
  const tx = extras.find((x) => x.thorns && x.ell), mi = tx ? parts.findIndex((q) => q.id === tx.id) : -1;
  // (it hugs the NECK: the neck's index, its radii at the chest and at the head and its length, the head's radius --
  //  the thorns stand round the neck and the back of the head, placed by the neck as it moves)
  const ni = parts.findIndex((q) => q.id === "neck"), hi = parts.findIndex((q) => q.id === "head");
  const mane = mi >= 0 && ni >= 0 ? { neck: ni, head: hi, r: parts[mi].size.r + (parts[mi].size.len ?? 0) / 2, color: tx.color, thorns: tx.thorns,
                                      neckLen: parts[ni].size.len, rA: parts[ni].size.r2 ?? parts[ni].size.r, rB: parts[ni].size.r, headR: parts[hi]?.size?.r ?? parts[ni].size.r } : null;
  // (the thorns ARE the mane: its soft ball is not drawn -- the part stays, a point at the mane's middle that rides with
  //  the body, for the thorns to be placed by; too small to show, and blended into nothing)
  if (mane) parts[mi] = { ...parts[mi], shape: "sphere", size: { r: .002 }, k: 0, geomRot: undefined };
  return { name, ...flags, rig: true, gaits: { walk, run }, probe: (noseX - (rear[0] - rear[3])) / 2, legLen: Lg, parts, ...(mane ? { mane } : {}) };
}

// ============ families ==========================================================
// the horse frame at scale s (1 = a 1.6m horse), recoloured per species
// ---- WHERE THE SPECIES WENT ------------------------------------------------------------------------------
// They used to be written out below this line, as the arguments of some four hundred lines of calls: the
// frames (horseLike, catLike, sheepLike, deerLike) and then every animal on them. They are DEFINITIONS now --
// assets/creatures/**.json, built by creatures.js, which calls mammal() above with what it reads there. The
// frames are assets/creatures/frames/*.json, every number an expression over the frame's own params.
//   What stays here is the engine: mammal() and the pieces it builds a body out of. And the house cat, which
// is not one animal but a coat picked by seed.
// ---- COMPONENTS: the pieces a definition can ask for by name -----------------------------------------------
// A horn is not a shape, it is a RULE -- a curl of so many links about a centre, a spiral of such a pitch --
// and writing out the tubes it comes to would be writing down the answer instead of the question. A definition
// names the component and gives it its numbers (assets/creatures/mammals/ram.json), and creatures.js expands
// it here, so changing `turns` in the file changes the horn.
//
// a ram's horn: a curl of `links` tube links about a centre behind the ear, once each side
function curlHorn({ id = "horn", sd = 1, s = 1, color = 0xc9b48e, links = 4, sweep = 4.4, r0 = .06, r1 = .02, k = .02 }) {
  const H = [.68 * s, .9 * s, 0], R = .17 * s, a0 = 1.4, a1 = a0 + sweep, root = [.64 * s, 1.04 * s], n = links, dA = (a1 - a0) / n;
  const c = [root[0] - R * Math.cos(a0), root[1] - R * Math.sin(a0)], z0 = .1 * s * sd, z1 = .22 * s * sd;
  const at = (a, rr = R) => [c[0] + rr * Math.cos(a) - H[0], c[1] + rr * Math.sin(a) - H[1], z0 + (z1 - z0) * (a - a0) / (a1 - a0)];
  return Array.from({ length: n }, (_, i) => { const ta = a0 + i * dA;
    return { raw: { id: id + i, parent: "head", shape: "tube",
                    size: { a: at(ta), c: at(ta + dA / 2, R / Math.cos(dA / 2)), b: at(ta + dA),
                            r1: (r0 + (r1 - r0) * i / n) * s, r2: (r0 + (r1 - r0) * (i + 1) / n) * s },
                    pos: [0, 0, 0], color, pat: "twist", k: k * s } }; });
}
// a blackbuck's: one straight taper each side, wound by the twist pattern (whose pitch is the horn's own girth)
function spiralHorn({ id = "horn", s = 1, base, tip, r = .025, color = 0x2a2420, k = .004 }) {
  return [1, -1].map((sd) => {
    const B = [base[0] * s, base[1] * s, base[2] * s * sd], T = [tip[0] * s, tip[1] * s, tip[2] * s * sd];
    return { id: `${id}${sd > 0 ? "L" : "R"}`, parent: "head", from: B, to: T, r1: r * s, r2: r * s * .25, color, k, pat: "twist" };
  });
}
// THE WINGS: a bat's (batWing) and a bird's (birdWing), one each side (s = +1 the left, +z; -1 the right), k scaling
// the whole wing; `lift` (degrees) raises the arm toward the root's forward -- for a beast, its head's way; for an
// upright figure (species.js winged: its root bone turned up the back), the sky. Flapping turns arm and hand about x,
// the hand wider and a little behind, so the wing folds like a hinge. Wing anims carry `wing: true`: a mount in flight
// beats them on their own clock while the legs hang still.
// Every seam is exact at every instant of the flap: panels in one frame share their corners (the joints THEMSELVES --
// 2 cm short of them, a wedge of nothing showed round the elbow), and the one seam that crosses frames runs along the
// hand's HINGE AXIS, whose points do not move when the hinge turns.
export function batWing(s, { k = 1, x = -.2, y = .5, z = .4, bone = 0x4a2a3a, mem = bone, deg = 12, speed = .5, parent = "body", lift = 0, scallop = .22 } = {}) {
  // A BAT'S WING, as a bat's is made (2026-10-04): the arm to the wrist, then the HAND -- three long fingers fanned from
  // the wrist, the skin stretched between them and from the last finger back to the flank. The fingers are fixed in
  // the hand's frame, so every panel between two of them is in ONE frame and shares its corners exactly; the one seam
  // that crosses frames runs from the wrist along the hand's HINGE AXIS (the arm-frame x direction) to corner D, which
  // does not move when the hinge turns. A claw -- the thumb -- at the wrist.
  const S = s > 0 ? "L" : "R";
  const E = 1.08 * k, LD = 1.0 * k;   // the wrist on the arm; D on the hinge axis, LD behind it
  const FING = [[8, 1.12], [38, 1.0], [68, .9]].map(([a, L]) => ({ a, L: L * k, t: [-Math.sin(a * Math.PI / 180) * L * k, Math.cos(a * Math.PI / 180) * L * k, 0] }));
  const tri = (id, par, a, b, c) => ({ id, parent: par, shape: "tri", size: { a, b, c, r: .028 * k }, pos: [0, 0, 0], color: mem, edge: 0 });
  return [
    { id: `wArm${S}`, parent, shape: "capsule", size: { r: .07 * k, len: 1.1 * k },
      pos: [x, y, s * z], rot: [s * 62, 0, -lift], pivot: [0, .55 * k, 0], color: bone, edge: 0,
      anim: { axis: "x", deg: s * deg, speed, phase: 0, wing: true },
      fold: [s * 118, 0, 70] },   // (struck down: the arm swept back and a little down along the flank, the membrane up over it, flat)
    // the arm's frame: shoulder-wrist-flank, then wrist-flank-D, closing back to the hinge
    tri(`wMemA${S}`, `wArm${S}`, [0, 0, 0], [0, E, 0], [-1.05 * k, -.2 * k, 0]),
    tri(`wMemA2${S}`, `wArm${S}`, [0, E, 0], [-1.05 * k, -.2 * k, 0], [-LD, E, 0]),
    { id: `wHand${S}`, parent: `wArm${S}`, shape: "sphere", size: { r: .06 * k }, pos: [0, E, 0], rot: [s * 42, 0, 0], color: bone, edge: 0,
      anim: { axis: "x", deg: s * deg * 1.6, speed, phase: .6, wing: true }, fold: [-s * 42, 0, 0] },   // (the wrist: the hand's frame turns on it)
    // the fingers, fixed in the hand's frame, fanned from straight on (+y) back toward the trailing edge
    ...FING.map((f, i) => ({ id: `wFinger${i}${S}`, parent: `wHand${S}`, shape: "capsule", size: { r: .03 * k, r2: .018 * k, len: f.L }, pos: [0, 0, 0],
                             rot: [0, 0, f.a], pivot: [0, f.L / 2, 0], color: bone, edge: 0 })),
    // the skin between the fingers, and from the last one back to D on the hinge
    // (each panel BETWEEN two fingers has its free edge bowed in toward the wrist, as a bat's skin hangs between them:
    //  two triangles meeting at a point `scallop` of the way in from the edge's middle; the last runs on straight into
    //  the arm's skin, or it would be a notch)
    ...[[FING[0].t, FING[1].t], [FING[1].t, FING[2].t]].flatMap(([P, Q], i) => {
      const M = P.map((v, j) => (v + Q[j]) / 2 * (1 - scallop));
      return [tri(`wMemB${i}${S}`, `wHand${S}`, [0, 0, 0], P, M), tri(`wMemB${i}b${S}`, `wHand${S}`, [0, 0, 0], M, Q)];
    }),
    tri(`wMemB2${S}`, `wHand${S}`, [0, 0, 0], FING[2].t, [-LD, 0, 0]),
    { id: `wClaw${S}`, parent: `wHand${S}`, shape: "cone", size: { r: .04 * k, h: .2 * k }, pos: [.02 * k, .02 * k, 0], rot: [0, 0, -30], color: bone, edge: 0 },
  ];
}

export function birdWing(s, { k = 1, x = -.2, y = .5, z = .4, color = 0xf2efe6, tip = color, bone = color, deg = 14, speed = .45, parent = "body", lift = 0 } = {}) {
  // A BIRD'S WING (2026-10-04: an angel's): the arm to the wrist and the hand beyond it, and the FEATHERS growing from
  // them -- ten primaries ROOTED ON THE HAND's axis, fanned from straight on to back; eight secondaries rooted along
  // the forearm, pointing back; coverts laid over their roots. Every feather is a long thin vane (a flat triangle) whose
  // root lies ON its bone's line, so the feathers follow the wing's own curve and overlap their neighbours into one
  // surface -- not a row laid beside the bone, a gap along it.
  const S = s > 0 ? "L" : "R", E = 1.08 * k, HL = .55 * k, R = .013 * k;
  const vane = (id, par, root, a, L, w, col) => {   // a feather: from `root` at angle `a` (degrees from +y toward -x), L long, its vane w wide on the trailing side
    const d = [-Math.sin(a * Math.PI / 180), Math.cos(a * Math.PI / 180), 0], tr = [-d[1], d[0], 0];   // along it; across, toward the trailing edge
    const tipP = root.map((v, i) => v + d[i] * L), mid = root.map((v, i) => v + d[i] * L * .62 + tr[i] * w);
    return { id, parent: par, shape: "tri", size: { a: root, b: tipP, c: mid, r: R }, pos: [0, 0, 0], color: col, edge: 0 };
  };
  const out = [
    { id: `wArm${S}`, parent, shape: "capsule", size: { r: .045 * k, len: 1.1 * k },
      pos: [x, y, s * z], rot: [s * 62, 0, -lift], pivot: [0, .55 * k, 0], color: bone, edge: 0,
      anim: { axis: "x", deg: s * deg, speed, phase: 0, wing: true }, fold: [s * 118, 0, 70] },
    { id: `wHand${S}`, parent: `wArm${S}`, shape: "capsule", size: { r: .035 * k, r2: .02 * k, len: HL }, pos: [0, E, 0], rot: [s * 25, 0, 0], pivot: [0, HL / 2, 0],
      color: bone, edge: 0, anim: { axis: "x", deg: s * deg * 1.4, speed, phase: .5, wing: true }, fold: [-s * 25, 0, 0] },
  ];
  // primaries: on the hand, the outermost at its tip pointing on, the innermost at the wrist pointing back
  for (let i = 0; i < 10; i++) {
    const f = i / 9, yR = HL * (1 - f) * .95, a = 4 + 70 * f, L = (.8 - .25 * f) * k;
    out.push(vane(`wPrim${i}${S}`, `wHand${S}`, [0, yR, 0], a, L, .16 * k, f < .35 ? tip : color));
  }
  // secondaries: along the forearm (its outer two thirds), pointing back
  for (let i = 0; i < 8; i++) {
    const f = i / 7, yR = E * (1 - .62 * f), a = 78 + 14 * f, L = (.55 - .08 * f) * k;
    out.push(vane(`wSec${i}${S}`, `wArm${S}`, [0, yR, 0], a, L, .14 * k, color));
  }
  // coverts: plates over the feathers' roots, on the arm and on the hand
  out.push({ id: `wCovA${S}`, parent: `wArm${S}`, shape: "tri", size: { a: [0, .3 * E, 0], b: [0, E, 0], c: [-.3 * k, .7 * E, 0], r: R * 1.4 }, pos: [0, 0, 0], color, edge: 0 },
           { id: `wCovA2${S}`, parent: `wArm${S}`, shape: "tri", size: { a: [0, .3 * E, 0], b: [-.3 * k, .7 * E, 0], c: [-.24 * k, .2 * E, 0], r: R * 1.4 }, pos: [0, 0, 0], color, edge: 0 },
           { id: `wCovB${S}`, parent: `wHand${S}`, shape: "tri", size: { a: [0, 0, 0], b: [0, HL * .9, 0], c: [-.22 * k, .2 * k, 0], r: R * 1.4 }, pos: [0, 0, 0], color, edge: 0 });
  return out;
}

export const COMPONENTS = {
  curlHorn: (o) => [1, -1].flatMap((sd) => curlHorn({ ...o, sd, id: (o.id ?? "horn") + (sd > 0 ? "L" : "R") })),
  spiralHorn,
  // a pair of BAT WINGS (a dragon's, a manticore's): `at` the shoulder in the species' own frame (its +z side; mirrored),
  // `k` the size, `bone` and `mem` the colours, `deg` and `speed` the flap
  batWing: (o) => [1, -1].flatMap((s) => batWing(s, o).map((p, i) => (i === 0 && o.at ? { raw: p, at: [o.at[0], o.at[1], s * o.at[2]] } : { raw: p }))),
  // ...and a pair of BIRD WINGS (feathered: an angel's, a griffin's)
  birdWing: (o) => [1, -1].flatMap((s) => birdWing(s, o).map((p, i) => (i === 0 && o.at ? { raw: p, at: [o.at[0], o.at[1], s * o.at[2]] } : { raw: p }))),
};

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
      c, headTurn: 22, pupil: "slit", headScale: .62 });

