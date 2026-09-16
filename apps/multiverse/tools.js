// Tools in people's hands as plain LOW-POLY meshes -- not SDF parts: a long
// thin shaft in the one-quad composite engine stretches that person's quad
// across the screen and smears into streaks. One InstancedMesh per kind
// (scythe, spade, hoe, hammer, fishing rod, lute; a guard's sword, spear and
// shield -- the shield in the left hand), each copy placed every frame at a
// person's hand, read back from the posed skeleton
// (composite herd.ends): the grip at the hand, the tool's frame turned with
// the forearm -- so the working swing (people.js GESTURES) carries it.
//
// The tool's frame: origin at the hand, +y up, +x where the forearm points
// across the ground (forward), +z to the right -- tilted forward by most of
// the forearm's lift (see place). Shading is the world's
// light-free orientation term, baked into the vertex colours.
import * as THREE from "three";

const WOOD = 0x8a6a42, DARK = 0x6a4a2a, IRON = 0x7a7f84, STEEL = 0xb8bcc0, LINE = 0xdcdcd0, LUTE = 0x9a6a3a, SHIELD = 0x8e2f35, BOW = 0x6a4a28;
export const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _q = new THREE.Quaternion(), _up = V(0, 1, 0);

// a round rod from `from` along dir, len long (5 sides: it is thin)
export function rod(from, dir, len, r, color, sides = 5) {
  const g = new THREE.CylinderGeometry(r, r, len, sides, 1);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(_q.setFromUnitVectors(_up, dir.clone().normalize()));
  g.translate(from.x, from.y, from.z);
  return [g, color];
}
// a flat blade: triangles given as corner lists
export function plate(tris, color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(2), 3));
  g.computeVertexNormals();
  return [g, color];
}
export const at = (g, x, y, z) => { g.translate(x, y, z); return g; };

// [geometry, colour] pieces per tool, in the hand's frame
const TOOLS = {
  scythe: () => { const d = V(.35, -1, .15).normalize(), e = d.clone().multiplyScalar(1.45);
    return [rod(V(0, 0, 0), d, 1.45, .018, WOOD), plate([[e.toArray(), [e.x + .07, e.y + .02, e.z + .62], [e.x + .14, e.y - .02, e.z + .22]]], STEEL)]; },
  spade: () => { const d = V(.2, -1, 0).normalize(), e = d.clone().multiplyScalar(.95), f = e.clone().addScaledVector(d, .28);
    return [rod(V(0, 0, 0), d, .95, .018, WOOD),
            plate([[[e.x, e.y, -.11], [f.x, f.y, -.11], [f.x, f.y, .11]], [[e.x, e.y, -.11], [f.x, f.y, .11], [e.x, e.y, .11]]], IRON)]; },
  hoe: () => { const d = V(.35, -1, 0).normalize(), e = d.clone().multiplyScalar(1.3);
    return [rod(V(0, 0, 0), d, 1.3, .018, WOOD),
            plate([[[e.x, e.y, -.08], [e.x + .18, e.y - .02, -.08], [e.x + .18, e.y - .02, .08]], [[e.x, e.y, -.08], [e.x + .18, e.y - .02, .08], [e.x, e.y, .08]]], IRON)]; },
  hammer: () => { const d = V(.15, -1, 0).normalize(), e = d.clone().multiplyScalar(.34);
    return [rod(V(0, 0, 0), d, .34, .016, WOOD), [at(new THREE.BoxGeometry(.07, .07, .13), e.x, e.y, e.z), IRON]]; },
  rod: () => { const d = V(1, .65, 0).normalize(), e = d.clone().multiplyScalar(2.4);
    return [rod(V(0, 0, 0), d, 2.4, .012, WOOD, 4), rod(e, V(0, -1, 0), 1.5, .004, LINE, 3)]; },
  cleaver: () => { const d = V(.1, -1, 0).normalize(), e = d.clone().multiplyScalar(.16), f = e.clone().addScaledVector(d, .2), x = V(.1, 0, 0);
    return [rod(V(0, 0, 0), d, .16, .015, WOOD), plate([[e.toArray(), f.toArray(), f.clone().add(x).toArray()], [e.toArray(), f.clone().add(x).toArray(), e.clone().add(x).toArray()]], STEEL)]; },
  saw: () => { const d = V(.25, -1, 0).normalize(), e = d.clone().multiplyScalar(.12), f = d.clone().multiplyScalar(.75), x = V(.11, 0, 0), x2 = V(.05, 0, 0);
    return [rod(V(0, 0, 0), d, .12, .02, WOOD), plate([[e.toArray(), f.toArray(), f.clone().add(x2).toArray()], [e.toArray(), f.clone().add(x2).toArray(), e.clone().add(x).toArray()]], STEEL)]; },
  lute: () => [[at(new THREE.SphereGeometry(.13, 8, 6).scale(1, 1.15, .5).rotateY(Math.PI / 2), .06, .02, .14), LUTE],
               rod(V(.06, .05, .26), V(.1, .45, 1), .45, .022, DARK, 4)],
  // arms (a guard at rest, the arm hanging): the sword held upright, the blade tapering to its point; the spear
  // grounded beside the foot, its head well over the head; the round shield before the left thigh, facing out (-z: outward
  // from the left hand)
  sword: () => { const d = V(.12, 1, 0).normalize(), g = d.clone().multiplyScalar(.1), b = d.clone().multiplyScalar(.78), t = d.clone().multiplyScalar(.92), w = .025;
    return [rod(d.clone().multiplyScalar(-.1), d, .2, .016, DARK), [at(new THREE.BoxGeometry(.03, .03, .2), g.x, g.y, g.z), IRON],
            plate([[[g.x, g.y, -w], [b.x, b.y, -w], [b.x, b.y, w]], [[g.x, g.y, -w], [b.x, b.y, w], [g.x, g.y, w]], [[b.x, b.y, -w], [t.x, t.y, 0], [b.x, b.y, w]]], STEEL)]; },
  spear: () => [rod(V(0, -.78, 0), V(0, 1, 0), 2.28, .018, WOOD), plate([[[0, 1.46, -.04], [0, 1.78, 0], [0, 1.46, .04]]], STEEL)],
  // (the shield's face turned 45 degrees outward, off the body; its centre just in front of the gripping hand, along its normal)
  // a longbow held upright at its grip: two limbs bending back toward the archer (-x) to their tips, the string between them
  bow: () => {
    const pt = (s, t) => V(-.16 * t * t, s * .74 * t, 0), limb = (s) => [1, 2, 3, 4].map((i) => {
      const a = pt(s, (i - 1) / 4), b = pt(s, i / 4);
      return rod(a, b.clone().sub(a), a.distanceTo(b), .015 - .0025 * i, BOW, 5);
    });
    return [...limb(1), ...limb(-1), rod(pt(-1, 1), V(0, 1, 0), 1.48, .0018, LINE, 3), [at(new THREE.BoxGeometry(.04, .12, .04), 0, 0, 0), DARK]];
  },
  shield: () => { const n = V(Math.SQRT1_2, 0, -Math.SQRT1_2), c = n.clone().multiplyScalar(.035).add(V(0, .02, 0)), o = c.clone().addScaledVector(n, .015);
    return [[at(new THREE.CylinderGeometry(.3, .3, .025, 14).rotateZ(Math.PI / 2).rotateY(Math.PI / 4), c.x, c.y, c.z), SHIELD],
            [at(new THREE.SphereGeometry(.055, 8, 5), o.x, o.y, o.z), IRON]]; },
};
export const TOOL_KINDS = Object.keys(TOOLS);

// one geometry from [geometry, colour] pieces, merged, each vertex coloured and shaded by its facing (the tools; archery.js's arrows)
export function piecesGeometry(pieces) {
  const pos = [], col = [], c = new THREE.Color();
  for (const [g0, hex] of pieces) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    c.set(hex);
    for (let i = 0; i < p.length; i += 3) {
      pos.push(p[i], p[i + 1], p[i + 2]);
      const k = .82 + .2 * n[i + 1] + .1 * n[i] + .06 * n[i + 2];
      col.push(c.r * k, c.g * k, c.b * k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
}

// which of a person's parts carry the tool: the hand (right, or "L"), and the forearm that gives its direction
export const handIndex = (def, side = "R") => [def.parts.findIndex((p) => p.id === "hand" + side), def.parts.findIndex((p) => p.id === "fore" + side)];

export function createTools(scene, cap = 64) {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const meshes = {};
  for (const k of TOOL_KINDS) {
    const m = new THREE.InstancedMesh(piecesGeometry(TOOLS[k]()), mat, cap);
    m.count = 0; m.frustumCulled = false;
    scene.add(m);
    meshes[k] = m;
  }
  const M = new THREE.Matrix4(), R = new THREE.Matrix4(), X = V(0, 0, 0), Y = V(0, 0, 0), Z = V(0, 0, 0), H = V(0, 0, 0), E = V(0, 0, 0), D = V(0, 0, 0);
  const FOLLOW = { spear: 0, shield: 0, sword: .35, bow: 0 };   // how much of the forearm's lift the tool takes (.7; a spear and a shield stay upright in a raised hand, a guard's sword leans a little)
  return {
    // groups: [[herd, holders], ...] -- every composite herd with tools in hand this frame, after its update();
    // holders: [{ an, tool, hand: handIndex(def[, "L"]) }]
    place(groups) {
      for (const k of TOOL_KINDS) meshes[k].count = 0;
      for (const [herd, holders] of groups) for (const { an, tool, hand: [hi, fi] } of holders) {
        const m = meshes[tool];
        if (!m || m.count >= cap || an.hidden) continue;
        const [h] = herd.ends(an, hi), [a, b] = herd.ends(an, fi);
        H.fromArray(h);
        E.fromArray(Math.hypot(a[0] - h[0], a[1] - h[1], a[2] - h[2]) > Math.hypot(b[0] - h[0], b[1] - h[1], b[2] - h[2]) ? a : b);   // the elbow: the far end
        D.subVectors(H, E).normalize();                                                  // down the forearm, through the hand
        // an upright frame, not the forearm's own (a tool along a raised forearm juts out like a lance): it
        // faces where the forearm points across the ground (the person's forward while the arm hangs) and
        // tilts forward by part of the forearm's lift -- so the spade digs, the scythe sweeps, the hammer rises
        X.set(D.x, 0, D.z);
        if (X.length() < .25) X.set(Math.cos(an.rotY), 0, -Math.sin(an.rotY));
        X.normalize(); Y.set(0, 1, 0); Z.crossVectors(X, Y);
        R.makeRotationZ((FOLLOW[tool] ?? .7) * Math.acos(Math.max(-1, Math.min(1, -D.y))));
        m.setMatrixAt(m.count++, M.makeBasis(X, Y, Z).multiply(R).setPosition(H));
      }
      for (const k of TOOL_KINDS) meshes[k].instanceMatrix.needsUpdate = true;
    },
  };
}
