// WHAT PEOPLE HOLD: the tools and arms in their hands -- items (items.js, assets/items/**) built once per kind and
// drawn as plain LOW-POLY meshes, not SDF parts (a long thin shaft in the one-quad composite engine stretches that
// person's quad across the screen and smears into streaks). One InstancedMesh per kind and material (a sword's
// steel, its grip's leather, its guard's brass), each copy placed every frame at a person's hand, read back from the
// posed skeleton (composite herd.ends) -- so the working swing (people.js GESTURES) carries it.
//
// Every item says where the hand closes on it (its `hold`: the grip, the handle's line, which way its face looks,
// how it is carried -- items.js holdMatrix), so a kind is moved into the HAND'S FRAME once, at build, and placing
// it is one matrix: origin at the hand, +y up, +x where the forearm points across the ground (forward), +z to the
// right -- tilted forward by the share of the forearm's lift the item's hold `follow`s (see place).
import * as THREE from "three";
import { stoneMaterial } from "./shell.js";   // a statue's item: carved
import { ASSETS } from "./catalogue.js";
import { buildItem, holdMatrix, transformGroups } from "./items.js";
import { itemGeometry, itemMaterial } from "./architecture.js";
import { litMaterial } from "./light.js";   // (painted items: the colour in the vertices, the sun on them)
import { PALETTES } from "./patterns.js";   // (a palette named, not written out: "gold", "silver")

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// (the old pieces helpers -- rod, plate, piecesGeometry -- went with the arrow they built: it is an item now)

// A BUILT ITEM AS ONE PAINTED GEOMETRY: its colours in the vertices (each group's first paint), its normals (`flat`:
// the roles shaded by each triangle's own normal -- a face's lips), for one draw call lit by light.js litMaterial
// (the arrows) or heads.js faceMaterial (the faces)
// `strands`: roles drawn as HAIR -- their vertices keep their uv (v runs along the hair: the strand, the cap's and a
// sheet's height) and a `hairMask` of 1, for a material that shades along it (heads.js faceMaterial: Kajiya-Kay)
// (recolor: { "#hex": "#hex" } -- a group painted in one colour is painted in another: a head cached in placeholder
//  colours wearing its person's skin and hair, heads.js)
export function paintedGeometry(built, { flat = [], strands = null, wet = null, recolor = null } = {}) {
  const pos = [], col = [], nor = [], uvs = [], mask = [], wets = [], c = new THREE.Color();   // (wet: { role: how wet } -- the eyes, the lips: a sharp highlight, heads.js)
  for (const g of built.groups) {
    const pal = g.material.palette;
    // (its colour: the palette's first -- written out, or a named one: "gold", "bronze"; a tan where there is none)
    const named = typeof pal === "string" && !pal.startsWith("#") ? PALETTES[pal] : null;
    const hex0 = Array.isArray(pal) ? pal[0] : named ? named[0] : typeof pal === "string" && pal.startsWith("#") ? pal : "#c8a080";
    c.set(recolor?.[hex0] ?? hex0);
    const P = g.pos, N = g.nor, I = g.idx, isFlat = flat.some((r) => g.roles?.has(r)), U = g.uv, hairy = !!strands && strands.some((r) => g.roles?.has(r));
    const wv = wet ? Math.max(0, ...[...(g.roles ?? [])].map((r) => wet[r] ?? 0)) : 0;
    for (let i = 0; i < I.length; i++) {
      const a = I[i] * 3;
      pos.push(P[a], P[a + 1], P[a + 2]);
      let nx = N[a], ny = N[a + 1], nz = N[a + 2];
      if (isFlat) {
        const t = i - i % 3, A = I[t] * 3, B = I[t + 1] * 3, Cc = I[t + 2] * 3;
        const ux = P[B] - P[A], uy = P[B + 1] - P[A + 1], uz = P[B + 2] - P[A + 2], vx = P[Cc] - P[A], vy = P[Cc + 1] - P[A + 1], vz = P[Cc + 2] - P[A + 2];
        let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx; const l = Math.hypot(fx, fy, fz) || 1;
        fx /= l; fy /= l; fz /= l; if (fx * nx + fy * ny + fz * nz < 0) { fx = -fx; fy = -fy; fz = -fz; }   // (the way the vertices say)
        nx = fx; ny = fy; nz = fz;
      }
      nor.push(nx, ny, nz);
      col.push(c.r, c.g, c.b);
      if (strands) { uvs.push(hairy && U ? U[I[i] * 2] : 0, hairy && U ? U[I[i] * 2 + 1] : 0); mask.push(hairy ? 1 : 0); }
      if (wet) wets.push(wv);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  if (strands) { geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2)); geo.setAttribute("hairMask", new THREE.Float32BufferAttribute(mask, 1)); }
  if (wet) geo.setAttribute("wetMask", new THREE.Float32BufferAttribute(wets, 1));
  return geo;
}

// which of a person's parts carry the tool: the hand and the forearm that gives its direction -- the rig's "R" by default,
// which is the figure's LEFT (its sides are mirrored: "L" sits at +z, the right hand; index.html's guards hold their
// weapon there)
// AN ITEM IN MANY COPIES, ONE DRAW: its colours painted into the vertices (paintedGeometry: each material's first
// colour -- right for things of plain colours, a flower, not for a patterned one), lit by the sun (light.js), one
// InstancedMesh. -> { root, built, set(i, matrix), commit() } as architecture.js itemInstanced
export function paintedInstanced(path, count, { seed = 1, params = {}, bank = ASSETS, lib = bank.get("items/materials")?.materials ?? {} } = {}) {
  const built = buildItem(path, bank, lib, { seed, params });
  const im = new THREE.InstancedMesh(paintedGeometry(built), litMaterial(), count);
  im.frustumCulled = false; im.name = built.name ?? path;
  return { root: im, built, set(i, m) { im.setMatrixAt(i, m); }, commit() { im.instanceMatrix.needsUpdate = true; } };
}
export const handIndex = (def, side = "R") => [def.parts.findIndex((p) => p.id === "hand" + side), def.parts.findIndex((p) => p.id === "fore" + side)];

// WHICH ITEM a person holds: a name the village has always used ("scythe", "sword"), an item's path
// ("items/weapons/falchion"), either with "#seed" for one of its kind ("items/shields/heater#3": its drawn sizes,
// shapes and heraldry -- items.js pickKit gives them so)
export const TOOL_ITEMS = {
  scythe: "items/tools/scythe", spade: "items/tools/spade", hoe: "items/tools/hoe", hammer: "items/tools/hammer",
  rod: "items/tools/fishing-rod", cleaver: "items/tools/cleaver", saw: "items/tools/saw", lute: "items/tools/lute",
  sword: "items/weapons/arming-sword", spear: "items/weapons/spear", bow: "items/weapons/longbow", shield: "items/shields/round",
};
export function toolItem(tool) {
  const [name, s] = String(tool).split("#");
  return { path: TOOL_ITEMS[name] ?? name, seed: s ? +s || 1 : 1 };
}

// opts: { cap (copies of a kind), bank (path -> definition: the game's catalogue; the viewer its own), lib (the
// materials library: the bank's items/materials) }
export function createTools(scene, { cap = 64, bank = ASSETS, lib = bank.get("items/materials")?.materials ?? {} } = {}) {
  const kinds = new Map();   // tool -> { meshes, follow, n } | null (no such item)
  const kindOf = (tool) => {
    if (kinds.has(tool)) return kinds.get(tool);
    // (`@stone<m>` after it: the item CARVED -- a statue's sword, shield, book -- in that stone, shell.js stoneMaterial)
    const [tk, sm] = String(tool).split("@stone"), stone = sm ? +sm : 0;
    const { path, seed } = toolItem(tk);
    let k = null;
    if (bank.has(path)) {
      const built = buildItem(path, bank, lib, { seed });
      const groups = transformGroups(built.groups, holdMatrix(built.hold));
      const meshes = groups.map((g) => {
        const m = new THREE.InstancedMesh(itemGeometry(g), stone ? stoneMaterial(stone) : itemMaterial(g.material), cap);
        m.count = 0; m.frustumCulled = false;
        scene.add(m);
        return m;
      });
      // how much of the forearm's lift it takes: a hoe's .7 by default; a spear and a shield stay upright in a
      // raised hand (0), a guard's sword leans a little (.35). An item that RESTS ON THE GROUND (a spear, a halberd,
      // an ordered musket: `rest: "ground"`, and upright) stands on its butt wherever the hand is, the hand sliding
      // along it: how far its ends reach below and above the hand, kept to stand it on the feet
      let lo = 0, hi = 0;
      for (const g of groups) for (let i = 1; i < g.pos.length; i += 3) { lo = Math.min(lo, g.pos[i]); hi = Math.max(hi, g.pos[i]); }
      k = { meshes, follow: built.hold?.follow ?? .7, ground: built.hold?.rest === "ground" ? [lo, hi] : null, n: 0 };
    } else console.warn(`tools: no item "${path}" (for "${tool}")`);
    kinds.set(tool, k);
    return k;
  };
  const SC = V(1, 1, 1), M = new THREE.Matrix4(), R = new THREE.Matrix4(), X = V(0, 0, 0), Y = V(0, 0, 0), Z = V(0, 0, 0), H = V(0, 0, 0), E = V(0, 0, 0), D = V(0, 0, 0);
  return {
    // made now rather than on the first frame it is held (its tiles drawn, its triangles built)
    prepare(tools) { for (const t of tools) if (t) kindOf(t); },
    // groups: [[herd, holders], ...] -- every composite herd with tools in hand this frame, after its update();
    // holders: [{ an, tool, hand: handIndex(def[, "L"]), scale? }]
    place(groups) {
      for (const k of kinds.values()) if (k) k.n = 0;
      for (const [herd, holders] of groups) for (const { an, tool, hand: [hi, fi], scale = 1 } of holders) {   // (scale: a colossus's sword is as big as it is)
        const k = tool && kindOf(tool);
        if (!k || k.n >= cap || an.hidden) continue;
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
        R.makeRotationZ(k.follow * Math.acos(Math.max(-1, Math.min(1, -D.y))));
        M.makeBasis(X, Y, Z).multiply(R);
        if (scale !== 1) M.scale(SC.set(scale, scale, scale));
        M.setPosition(H);
        if (k.ground) M.elements[13] = Math.max(H.y - k.ground[1] * scale, Math.min(H.y - k.ground[0] * scale, an.position.y - k.ground[0] * scale));   // (the butt on the feet's level; the hand stays on it)
        for (const m of k.meshes) m.setMatrixAt(k.n, M);
        k.n++;
      }
      for (const k of kinds.values()) if (k) for (const m of k.meshes) { m.count = k.n; m.instanceMatrix.needsUpdate = true; }
    },
    dispose() {
      for (const k of kinds.values()) if (k) for (const m of k.meshes) { scene.remove(m); m.geometry.dispose(); m.dispose(); }
      kinds.clear();
    },
  };
}
