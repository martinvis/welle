// Small vector maths shared by the generators (mammals.js, people.js,
// flora.js): plain [x, y, z] arrays and no engine import, so the species
// and flora data stay engine-free. One copy of each helper -- the
// generators used to carry their own, and three spelled out the same
// "turn a part toward a direction" rotation.
export const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vSc = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const vDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vNorm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return vSc(a, 1 / l); };
// a unit vector square to d
export const vPerp = (d) => vNorm(vCross(d, Math.abs(d[1]) < .9 ? [0, 1, 0] : [1, 0, 0]));
// v turned by ang about an axis (Rodrigues)
export function vRot(v, axis, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), k = vNorm(axis), d = v[0] * k[0] + v[1] * k[1] + v[2] * k[2];
  return vAdd(vAdd(vSc(v, c), vSc(vCross(k, v), s)), vSc(k, d * (1 - c)));
}

// The rotation that turns a part's local +y onto direction d, as the Euler
// [rx, 0, rz] in degrees that the part lists take (three's XYZ order:
// M = Rx * Rz, so M * y = (-sin rz, cos rz cos rx, cos rz sin rx)); also
// the two angles in radians and the length of d.
export function aim(d) {
  const len = Math.hypot(d[0], d[1], d[2]);
  const rz = Math.atan2(-d[0], Math.hypot(d[1], d[2])), rx = Math.atan2(d[2], d[1]);
  return { len, rx, rz, rot: [rx * 180 / Math.PI, 0, rz * 180 / Math.PI] };
}
export const aimRot = (d) => aim(d).rot;                           // a capsule growing along d from its -y end
export const hangRot = (d) => aim([-d[0], -d[1], -d[2]]).rot;     // a part hanging from its joint (local -y) along d

// a part scaled by f about its parent's origin: sizes, position, pivot, IK lengths, triangle and tube corners
// (species.js scaleParts for the classic species, people.js for a beast-man's animal head and tail)
export function scalePart(p, f) {
  const q = { ...p, size: { ...p.size } };
  for (const k of ["r", "r1", "r2", "len", "h", "bulge"]) if (q.size[k] !== undefined) q.size[k] *= f;
  if (q.ik) { q.ik = { ...q.ik }; for (const k of ["upper", "lower", "foot"]) if (q.ik[k] !== undefined) q.ik[k] *= f; }
  for (const k of ["a", "b", "c"]) if (q.size[k]) q.size[k] = q.size[k].map((v) => v * f);   // triangle / tube corners
  if (q.pos) q.pos = q.pos.map((v) => v * f);
  if (q.pivot) q.pivot = q.pivot.map((v) => v * f);
  return q;
}
