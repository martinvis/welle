// Mirrors (examples/mirrors_lab_v3's idea, in three.js terms): a planar
// reflection -- the world drawn again from the camera reflected in the
// glass, clipped at its plane -- into a texture laid on the glass (three's
// Reflector, projective: each pixel of glass looks up where it is on the
// screen). The reflection through a plane is the SAME for every mirror on
// that plane, so all mirrors sharing a wall are one Reflector over their
// merged panes: one extra draw of the scene lights every mirror of the Hall
// of Mirrors at once. Planes reflect on a budget (the MIRRORS.planes largest on
// screen, in view, within MIRRORS.reach); a plane out of it shows still glass of
// the same dull tone. A mirror may name its ROOM (a box): its wall reflects
// only while the camera is inside it -- never through the walls that hide it
// (a mirror merely facing you from behind a facade costs a whole draw). One
// bounce only: mirrors on one wall never see each other. The reflection is drawn at half the canvas's resolution (a quarter
// of the pixels), dulled like old glass; during it the composite engine
// draws its figures in full (the half-resolution split belongs to the main
// camera).
import * as THREE from "three";
import { reflector, uniform, vec3 } from "three/tsl";
import { beginSecondaryView, endSecondaryView } from "./composite.js";

export const MIRRORS = { planes: 2, reach: 60 };   // how many wall planes reflect at once, and within how many metres (index.html sets them from config.json)

// list: [{ x, y, z (world centre), w, h, n: [nx, 0, nz] (facing into the room) }]
export function createMirrors(scene, list, renderer) {
  if (!list.length) return { update() {}, hide() {}, active: () => 0, count: 0, planes: 0, list };   // (a world with no mirrors answers the same questions)
  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  const still = new THREE.MeshBasicMaterial({ color: 0x7d8488 });   // old silvered glass, unlit: the dull tone the reflections have too
  let inside = false;
  // the planes: mirrors grouped by facing and by distance of their wall from the origin
  const groups = new Map();
  for (const m of list) {
    const key = `${m.n[0].toFixed(3)},${m.n[2].toFixed(3)},${(m.n[0] * m.x + m.n[2] * m.z).toFixed(2)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  // ALL THE STILL GLASS IS ONE MESH. Every pane in the world carries the same dull silver and none of them
  // ever moves or is hidden on its own (the reflection is drawn over them), so a mesh apiece was a draw call
  // apiece -- sixteen of them, two triangles each. They are baked into one geometry here.
  const stillPos = [];
  const planes = [...groups.values()].map((ms) => {
    const o = ms[0], yaw = Math.atan2(o.n[0], o.n[2]), rx = Math.cos(yaw), rz = -Math.sin(yaw);   // the wall's own x axis (a plane's local +z turned by yaw faces n)
    const pos = [];
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    for (const m of ms) {   // every pane as a quad in the plane's frame (origin: the first mirror's centre)
      const lx = (m.x - o.x) * rx + (m.z - o.z) * rz, ly = m.y - o.y, hw = m.w / 2, hh = m.h / 2;
      pos.push(lx - hw, ly - hh, 0, lx + hw, ly - hh, 0, lx + hw, ly + hh, 0, lx - hw, ly - hh, 0, lx + hw, ly + hh, 0, lx - hw, ly + hh, 0);
      // ...and the same quad in the world, for the one still-glass mesh (a plane's local +x turned by yaw)
      for (const [ux, uy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, -hh], [hw, hh], [-hw, hh]])
        stillPos.push(m.x + ux * ca, m.y + uy, m.z - ux * sa);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    // half size (a quarter of the pixels); dull, grey-tinted like old glass. The mirrored camera, its target
    // and the projective lookup are TSL's reflector; bounces off means mirrors on one wall never see each other.
    const target = new THREE.Object3D();
    target.position.set(o.x + o.n[0] * .005, o.y, o.z + o.n[2] * .005);
    target.rotation.y = yaw;
    scene.add(target);
    const rNode = reflector({ target, resolutionScale: .5, bounces: false });
    const reflMat = new THREE.MeshBasicNodeMaterial();
    reflMat.colorNode = rNode.rgb.mul(vec3(0x8c / 255, 0x92 / 255, 0x96 / 255));
    const refl = new THREE.Mesh(geo, reflMat);
    refl.userData.noMerge = true;           // ...and so is the reflecting plane
    refl.position.copy(target.position); refl.rotation.y = yaw;
    refl.visible = false;
    // the composite engine draws its figures in full while a secondary view is being rendered (its
    // half-resolution split belongs to the main camera)
    const base = rNode.reflector;
    const draw = base.updateBefore.bind(base);
    base.updateBefore = (frame) => {
      if (inside) return;
      inside = true; beginSecondaryView();
      try { draw(frame); } finally { endSecondaryView(); inside = false; }
    };
    scene.add(refl);
    return { ms, refl, n: new THREE.Vector3(o.n[0], 0, o.n[2]), cs: ms.map((m) => new THREE.Vector3(m.x, m.y, m.z)), rooms: ms.map((m) => m.room).filter(Boolean) };
  });
  if (stillPos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(stillPos, 3));
    g.computeBoundingSphere();
    const glass = new THREE.Mesh(g, still);
    glass.name = "mirror glass";
    glass.userData.noMerge = true;
    scene.add(glass);
  }
  const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), frustum = new THREE.Frustum(), sphere = new THREE.Sphere();
  return {
    count: list.length,
    planes: planes.length,
    hide() { for (const P of planes) P.refl.visible = false; },   // (while something else draws the scene: the paintings)
    active: () => planes.filter((P) => P.refl.visible).length,   // (checks) walls reflecting this frame
    list,   // (checks) the mirrors in world coordinates
    // each frame before rendering: which planes reflect -- the MIRRORS.planes whose panes show largest on screen,
    // counting only panes in view, facing the camera, within MIRRORS.reach
    update(camera) {
      const cp = camera.position, ranked = [];
      frustum.setFromProjectionMatrix(_m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      for (const P of planes) {
        P.refl.visible = false;
        if (P.rooms.length && !P.rooms.some(([x0, x1, y0, y1, z0, z1]) => cp.x > x0 && cp.x < x1 && cp.y > y0 && cp.y < y1 && cp.z > z0 && cp.z < z1)) continue;   // not in its room: unseen
        let score = 0;
        P.ms.forEach((m, i) => {
          _v.subVectors(cp, P.cs[i]);
          const d = _v.length(), facing = _v.dot(P.n) / Math.max(d, 1e-3);
          if (d > MIRRORS.reach || facing < .02) return;   // too far, or seen from behind
          if (!frustum.intersectsSphere(sphere.set(P.cs[i], Math.hypot(m.w, m.h) / 2))) return;   // not in view
          score += (m.w * m.h * facing) / (d * d);   // its apparent size (solid angle, roughly)
        });
        if (score > 0) ranked.push([score, P]);
      }
      ranked.sort((a, b) => b[0] - a[0]);
      for (let i = 0; i < Math.min(MIRRORS.planes, ranked.length); i++) ranked[i][1].refl.visible = true;
    },
  };
}
