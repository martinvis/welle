// The CPU skeleton: species part-list -> flat compiled rig -> world-space
// segment endpoints per frame. Shared by the instanced banner engine
// (instanced.js, one quad per part) and the composite engine (composite.js,
// one quad per animal); both consume the same Float32Arrays of A/B/C
// endpoints, so the pose math lives here exactly once.
//
// Besides the per-part `anim` swing (a sine about one axis on the gait,
// wing or movement clock) this walks the mammal rig's legs: a leg is two
// capsules (upper, lower) whose knee comes from two-bone IK every frame --
// the foot follows a gait (stride forward/back, lift on the swing half of
// the cycle), the knee lands where the two bone lengths meet, so the leg
// straightens when the foot is far from the hip and folds when it is
// lifted. Walk and run are two parameter sets per species (`def.gaits`),
// blended by the animal's `run` factor; `amp` fades the whole stride out
// when an animal stands, so a stopped animal settles on straight legs.
import * as THREE from "three";
import { segmentFor } from "./banner.js";

const PAT = { leaf: 1, bark: 2, stripes: 3, bands: 4, spots: 5, wingspots: 6, scutes: 7, diamond: 8, scales: 17, rosettes: 18, twist: 19, barkH: 20,   // (17: after the cloth ids)
              // cloth (composite engine only, see people.js): two colours in the garment's wrapped frame
              hstripes: 9, vstripes: 10, checks: 11, weave: 12, leather: 13, mail: 14, braid: 15, hair: 16 };
export const CYCLES = .8;   // gait cycles per unit of the gait clock (the trot's rate; wanderers scale the clock by travel speed over leg length)

// species def -> flat skeleton: parents come before children in the data,
// so a single forward pass can chain world matrices. Everything static is
// precomputed here: segment endpoints in group-local space (pivot + the
// inverse-scale trick from banner.js baked in) and radii with the ancestor
// mean-scale factor already applied, since the shader never sees matrices.
const compiledCache = new Map();
const PUPILS = { round: 0, bar: 1, slit: 2 };   // a face mark's pupil (composite FACE MARKS)
export function compileDef(def) {
  if (compiledCache.has(def)) return compiledCache.get(def);
  const index = new Map();
  const parts = def.parts.map((part, i) => {
    index.set(part.id, i);
    const seg = segmentFor(part);
    const s = part.scale ?? [1, 1, 1];
    const pivot = part.pivot ?? [0, 0, 0];
    const pA = new THREE.Vector3(...seg.a.map((v, k) => pivot[k] + v / s[k]));
    const pB = new THREE.Vector3(...seg.b.map((v, k) => pivot[k] + v / s[k]));
    const pC = seg.c ? new THREE.Vector3(...seg.c.map((v, k) => pivot[k] + v / s[k])) : pB;   // triangle's third corner (unused otherwise)
    let f = 1;   // ancestor mean-scale factor (the part's own scale is baked in by segmentFor)
    for (let pid = part.parent; pid; ) {
      const anc = def.parts[index.get(pid)];
      if (anc.scale) f *= (anc.scale[0] + anc.scale[1] + anc.scale[2]) / 3;
      pid = anc.parent;
    }
    return {
      parentIdx: part.parent ? index.get(part.parent) : -1,
      pos: part.pos ?? [0, 0, 0],
      baseRot: (part.rot ?? [0, 0, 0]).map((d) => d * Math.PI / 180),
      scale: part.scale ?? null,
      anim: part.anim ?? null,
      // struck down (combat.js): `fold` (degrees, added to the rotation) draws a part in -- a spider's legs curled under it; a wing
      // (anim.wing) without one folds back flat against the flank, its flap stilled (side: which way the wing reaches, +z or -z)
      fold: part.fold ? part.fold.map((d) => d * Math.PI / 180) : null,
      side: Math.sign(((seg.b?.[2] ?? 0) + (seg.c?.[2] ?? 0)) || (part.pos?.[2] ?? 0)) || 1,
      ik: part.ik ?? null,        // mammal rig leg: { leg, upper, lower, side, foot, phase } on the upper bone, { leg, follow: true } on the lower
      bob: !!part.bob,            // the body: rides the gait's vertical bob
      // body motion (head turns, tail swishes, neck sway) follows MOVEMENT in
      // general -- the gait clock, or a mount's own movement clock while it
      // flies with its legs hanging still. Swimmers and fliers keep
      // everything on the gait clock: their tails and wings ARE the locomotion
      idle: !def.fly && /^(head|neck|tail|ear|mane|trunk|snout|hair)/.test(part.id.replace(/^(r_|L_|R_)/, "")),
      pA, pB, pC, r1: seg.r1 * f,
      // r2 = -1 stays the exact triangle flag; a tube packs its end radius and bulge (banner.js tubeUnpack)
      r2: seg.tube ? -2 - (Math.round(seg.r2 * f * 1000) + 4096 * Math.round(seg.bulge * f * 1000)) : seg.r2 < 0 ? -1 : seg.r2 * f,
      pat: PAT[part.pat] ?? 0,
      // bone: posed like any part (what hangs on it, ends() for what rides on it) but never drawn -- a blend
      // radius of -1 marks it and the composite shaders skip it; dot (-2): no SDF either -- a FACE MARK the
      // composite paints onto its parent's surface (eyes, a mouth): { iris, pupil: round|bar|slit, round }
      fur: !!part.fur,          // composite: a strand texture laid over its colour or pattern (mammals' coats)
      // composite: a PANEL painted on the part -- a sector of it in another colour, no shape of its own: an
      // apron on a skirt (half: its half-angle about the figure's forward, radians; from/to: down the part's
      // axis as a fraction of its cut, 0 at A). It takes the cloth's own shading, so it lies on the folds.
      panel: part.panel ? { color: new THREE.Color(part.panel.color), half: part.panel.half, from: part.panel.from, to: part.panel.to } : null,
      flat: part.flat ?? 0,     // composite: a capsule squashed along the figure's forward to this share of its width (a flat torso)
      // composite: a band painted round a flat part (a belt): its centre along the axis from A and width (mm), its colour packed (linear 8-bit)
      band: part.band ? (() => { const c = new THREE.Color(part.band.color); return { cmm: Math.round(part.band.at * 1000), wmm: Math.round(part.band.width * 1000),
              rgb: Math.round(c.r * 255) * 65536 + Math.round(c.g * 255) * 256 + Math.round(c.b * 255) }; })() : null,
      dot: part.dot ? { iris: part.dot.iris !== undefined ? new THREE.Color(part.dot.iris) : null, pupil: PUPILS[part.dot.pupil ?? "round"], round: !!part.dot.round,
                         role: part.dot.role ?? null, side: part.dot.side ?? 0,   // role (eye, brow, mouth) and side (+-1): what an expression does to it (faces.js)
                         // relief: the shape the mark lends the face in the LIGHT alone (composite gRelief) -- 1 a ridge
                         // (a brow over the forehead); an eye's own socket and eyeball come with its iris. reach: how
                         // far out that relief carries, in the mark's own radii, so the cells list it that far
                         relief: part.dot.relief ?? 0, reach: part.dot.reach ?? 1 } : null,
      k: part.bone ? -1 : part.dot ? -2 : (part.k ?? 0) * f,       // composite engine: smooth-union radius into the animal's silhouette (0 = hard union)
      edge: part.edge ?? 1,       // composite engine: 1 = draws its own border band (classic parts), 0 = only the outer outline (rig parts)
      body: part.frame === "body" ? 1 : 0,   // composite engine: pattern in the ANIMAL's frame (torso pieces: stripes run on across seams) instead of the part's
      level: !!part.level,        // keeps the root's orientation whatever its parents do (a foot stays flat on the ground)
      color: new THREE.Color(part.color),
      // composite engine, people's clothing (see people.js): a clip slab
      // along the segment [lo, hi] metres from A, mode 1 = open shell, 2 = solid
      // with flat caps; `back` (shells): also cut away everything more than
      // that many metres in FRONT of A along the animal's forward direction
      // (its root segment) -- a fall of hair open where the face is. Packed
      // into one float: mode + 4 * (the offset in mm + 501), 0 when unused.
      // Then a second colour, pattern scale and cloth flags; seams
      clip: part.clip ? [part.clip.lo ?? -1e4, part.clip.hi ?? 1e4,
                         (part.clip.solid ? 2 : 1) + (part.clip.back !== undefined ? 4 * (Math.round((part.clip.back + .5) * 1000) + 1) : 0)] : null,
      color2: new THREE.Color(part.color2 ?? part.color),
      cloth: part.cloth ?? null,  // { scale, pleats, trim, lace, wear } -- packed by the composite engine
      seam: part.seam ? 1 : 0,    // composite engine: a dark line where this part meets another colour
    };
  });
  parts.gaits = def.gaits ?? null;
  compiledCache.set(def, parts);
  return parts;
}

// Two-bone IK for one leg, in the body's xy plane with the hip at the
// origin. Returns [upper, lower] z rotations (positive = swings the foot
// forward, the convention of a capsule hanging from its pivot).
//   ik: { upper, lower, side (+1 knee bends forward, -1 backward), foot (foot joint y below the body origin) }
//   g: { stride, lift }  ph: this leg's phase  amp: stride amplitude 0..1  bob: the body's current bob
//   hipY: the hip's y in body space
export function legPose(ik, g, ph, amp, bob, hipY) {
  const stride = g.stride * amp, lift = Math.max(0, Math.cos(ph)) * g.lift * amp;
  let dx = stride * Math.sin(ph), dy = ik.foot - hipY + lift - bob;
  let d = Math.hypot(dx, dy);
  const upper = ik.upper, lower = ik.lower, reach = upper + lower - .005;
  if (d > reach) { dx *= reach / d; dy *= reach / d; d = reach; }
  if (d < 1e-6) return [0, 0];
  const a = (upper * upper - lower * lower + d * d) / (2 * d), h = Math.sqrt(Math.max(upper * upper - a * a, 0));
  const ux = dx / d, uy = dy / d;
  const kx = ux * a - uy * h * ik.side, ky = uy * a + ux * h * ik.side;
  const t1 = Math.atan2(kx, -ky);
  const t2 = Math.atan2(dx - kx, -(dy - ky)) - t1;
  return [t1, t2];
}

// the gait parameter set for a run factor 0..1: walk, run, or a blend
const _g = { offsets: [0, 0, 0, 0], stride: 0, lift: 0, bob: 0, bobPh: undefined };
export function gaitFor(gaits, run) {
  if (!gaits) return null;
  const w = gaits.walk, r = gaits.run ?? w;
  if (run <= 0) return w;
  if (run >= 1) return r;
  for (let i = 0; i < 4; i++) _g.offsets[i] = w.offsets[i] + (r.offsets[i] - w.offsets[i]) * run;
  _g.stride = w.stride + (r.stride - w.stride) * run;
  _g.lift = w.lift + (r.lift - w.lift) * run;
  _g.bob = w.bob + (r.bob - w.bob) * run;
  _g.bobPh = w.bobPh;
  return _g;
}

const _mats = [];
const _root = new THREE.Matrix4();
const _pitch = new THREE.Matrix4(), _roll = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _lower = [];   // per part: the lower bone's angle computed with its upper bone

// One animal's pose: walks the compiled skeleton, writes world-space
// endpoints at rows an.base.. of fA/fB/fC.
//   an.animT: gait clock   an.wingT: wing clock   (head, neck, tail, ears, mane: the world clock t)
//   an.amp: stride amplitude (1 = full gait, 0 = standing)   an.run: 0 walk .. 1 run
//   an.gesture / an.work: which working swing (anim.work[gesture]) and how strongly
//   an.hidden: parked out of sight -- posed once when hidden, then skipped until shown again
export function writeAnimal(an, t, fA, fB, fC) {
  if (an.stillT !== undefined) t = an.stillT;   // (a figure struck down, combat.js: its world clock stopped -- no idle motion)
  if (an.hidden && an._parked) return;   // (its parts already lie parked from the frame it was hidden)
  an._parked = !!an.hidden;
  const tt = an.animT !== undefined ? an.animT : t;   // per-animal gait clock (stops when standing)
  const tw = an.wingT !== undefined ? an.wingT : tt;   // wing clock (a flying mount beats wings, not legs)
  const parts = an.parts, g = gaitFor(parts.gaits, an.run ?? 0), amp = an.amp ?? 1;
  // the gait clock counts distance (animT = metres / the walk's stride base);
  // a run covers more ground per stride, so its cycles stretch by the stride
  // ratio -- feet stay planted instead of pedalling at a walker's speed
  let tg = tt;
  if (g) {
    const gs = parts.gaits, stretch = 1 + (an.run ?? 0) * ((gs.run ?? gs.walk).stride / gs.walk.stride - 1);
    tg = an._tg = an._tt === undefined ? tt : an._tg + (tt - an._tt) / stretch;
    an._tt = tt;
  }
  // head, neck, tail, ears, mane (the `idle` parts): the WORLD clock, for every animal in every state --
  // walking, running, flying -- they look about and swish at one calm pace whatever the legs do
  const tm = t;
  const phase = tg * CYCLES * Math.PI * 2;
  const bob = g ? g.bob * amp * Math.sin(phase * 2 + (g.bobPh ?? .5)) : 0;
  _root.makeRotationY(an.rotY);
  if (an.pitch) _root.multiply(_pitch.makeRotationZ(an.pitch));   // an.pitch: the body tipped about its own left axis (+ nose up) -- a squirrel on a trunk
  if (an.roll) _root.multiply(_roll.makeRotationX(an.roll));   // an.roll: turned about its own forward axis (+ toward its +z) -- a figure struck down lying on its side (combat.js)
  _root.setPosition(an.position);
  if (an.hidden) _root.setPosition(an.position.x, -100, an.position.z);   // parked out of sight, position untouched
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    let [rx, ry, rz] = p.baseRot;
    if (an.down) {   // struck down: a part's fold, or a wing folded back and laid flat against the flank (Euler XYZ: the sweep back
      // about y, then turned down about x -- the span along the side, the wing's flat facing out; on its side, it lies over the body)
      if (p.fold) { rx += p.fold[0]; ry += p.fold[1]; rz += p.fold[2]; }
      else if (p.anim?.wing) { ry -= p.side * 1.4; rx += p.side * 1.5; }
    }
    if (p.anim) {
      const a = p.anim;
      // a.amp: the swing belongs to the gait (a person's arms, a skirt) and fades with the stride when standing
      const d = an.down && a.wing ? 0 : (a.deg * Math.PI / 180) * Math.sin((a.wing ? tw : p.idle ? tm : a.amp ? tg : tt) * a.speed * Math.PI * 2 + (a.phase || 0)) * (a.amp ? amp : 1);
      if (a.axis === "x") rx += d; else if (a.axis === "y") ry += d; else rz += d;
      // a.work[an.gesture]: a working swing on the world clock (people.js GESTURES: digging, mowing,
      // hammering...), strength an.work (0 = idle), on its own axis -- bias holds, deg swings about it
      const g = an.work && a.work ? a.work[an.gesture] : null;
      if (g) {
        const w = (g.bias + g.deg * Math.sin(t * g.speed * Math.PI * 2 + (g.phase || 0))) * Math.PI / 180 * an.work;
        if (g.axis === "x") rx += w; else if (g.axis === "y") ry += w; else rz += w;
      }
    }
    if (p.ik && g) {
      if (p.ik.follow) rz += _lower[p.parentIdx] ?? 0;
      else {
        const [t1, t2] = legPose(p.ik, g, phase + g.offsets[p.ik.leg] + (p.ik.phase || 0), amp, bob, p.pos[1]);
        rz += t1; _lower[i] = t2;
      }
    }
    // the body rides the stride's bob; the idle parts hung on it (neck, head, tail) cancel it -- they
    // stay as steady running as they do walking or flying
    const dy = (p.bob ? bob : 0) - (p.idle && p.parentIdx >= 0 && parts[p.parentIdx].bob ? bob : 0);
    if (!p.anim && !(p.ik && g) && !(an.down && p.fold)) {   // a part that never moves in its parent: its local transform built once, cached (only the bob added)
      _local.copy(p._lm ?? (p._lm = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).setPosition(p.pos[0], p.pos[1], p.pos[2])
        .scale(new THREE.Vector3(...(p.scale ?? [1, 1, 1])))));
      _local.elements[13] += dy;
    } else {
      _local.makeRotationFromEuler(_e.set(rx, ry, rz));
      _local.setPosition(p.pos[0], p.pos[1] + dy, p.pos[2]);
      if (p.scale) _local.scale(_v.set(p.scale[0], p.scale[1], p.scale[2]));
    }
    const world = _mats[i] ?? (_mats[i] = new THREE.Matrix4());
    world.multiplyMatrices(p.parentIdx < 0 ? _root : _mats[p.parentIdx], _local);
    if (p.level) {   // placed by the chain, oriented by the root alone
      _v.setFromMatrixPosition(world);
      world.multiplyMatrices(_root, _local).setPosition(_v);
    }
    const j = (an.base + i) * 3;
    _v.copy(p.pA).applyMatrix4(world);
    fA[j] = _v.x; fA[j + 1] = _v.y; fA[j + 2] = _v.z;
    _v.copy(p.pB).applyMatrix4(world);
    fB[j] = _v.x; fB[j + 1] = _v.y; fB[j + 2] = _v.z;
    if (p.r2 < 0) {
      _v.copy(p.pC).applyMatrix4(world);
      fC[j] = _v.x; fC[j + 1] = _v.y; fC[j + 2] = _v.z;
    }
  }
}

// stride amplitude and run factor ease toward their targets (ampT, runT)
// so a stopping animal's legs straighten smoothly instead of snapping
export function easeGait(an, dt) {
  if (an.ampT !== undefined) an.amp = (an.amp ?? 1) + (an.ampT - (an.amp ?? 1)) * Math.min(1, dt * 5);
  if (an.runT !== undefined) an.run = (an.run ?? 0) + (an.runT - (an.run ?? 0)) * Math.min(1, dt * 3);
}
