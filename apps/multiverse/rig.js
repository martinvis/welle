// Generic engine: species part-list -> THREE.Object3D hierarchy.
// Every part is one primitive mesh (sphere/capsule/cone) in its own Group,
// plus a slightly-larger backface-only "outline" copy riding along with it
// (the inverted-hull trick) -- so same-color touching parts still read as
// separate shapes without needing real lighting to reveal the seam.
// Toon shading (a 3-step gradient map) stands in for full lighting: cheap,
// and closer to the flat-fill-plus-stroke look this is aiming for anyway.
import * as THREE from "three";

const SEG = 18;

function makeGeometry(part) {
  const s = part.size;
  if (part.shape === "tri") {
    // flat membrane: the triangle with both windings so it shows from both sides
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(
      [...s.a, ...s.b, ...s.c, ...s.a, ...s.c, ...s.b], 3));
    g.computeVertexNormals();
    return g;
  }
  const geo = part.shape === "sphere" ? new THREE.SphereGeometry(s.r, SEG, SEG)
            : part.shape === "cone" ? new THREE.ConeGeometry(s.r, s.h, SEG)
            : new THREE.CapsuleGeometry(s.r, s.len, Math.max(4, SEG / 2), SEG);
  if (part.geomRot) {
    const [x, y, z] = part.geomRot.map(THREE.MathUtils.degToRad);
    geo.rotateX(x); geo.rotateY(y); geo.rotateZ(z);
  }
  return geo;
}

let sharedGradient = null;
export function toonGradient() {
  if (sharedGradient) return sharedGradient;
  const steps = 4, canvas = document.createElement("canvas");
  canvas.width = steps; canvas.height = 1;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < steps; i++) {
    const v = Math.round(80 + 175 * (i + 1) / steps);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillRect(i, 0, 1, 1);
  }
  sharedGradient = new THREE.CanvasTexture(canvas);
  sharedGradient.magFilter = THREE.NearestFilter;
  sharedGradient.minFilter = THREE.NearestFilter;
  return sharedGradient;
}

const OUTLINE_WORLD_THICKNESS = .022;   // constant absolute thickness -- NOT a % of the shape's own size,
                                         // so a big body and a tiny ear get the same visual line weight
function outlineMesh(geo) {
  // inflate along the vertex normals: exact constant-thickness hull. (The
  // classic uniform-scale trick overshoots badly on thin-but-long capsules --
  // a 4cm-radius tail scaled by 1+t/r gets 55% LONGER too, leaving a dark
  // ghost tail sticking out past both ends.)
  const g = geo.clone();
  const pos = g.attributes.position, nor = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i,
      pos.getX(i) + nor.getX(i) * OUTLINE_WORLD_THICKNESS,
      pos.getY(i) + nor.getY(i) * OUTLINE_WORLD_THICKNESS,
      pos.getZ(i) + nor.getZ(i) * OUTLINE_WORLD_THICKNESS);
  }
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x201812, side: THREE.BackSide }));
}

export function buildSpecies(def) {
  const root = new THREE.Group();
  root.name = def.name;
  const nodes = { };
  for (const part of def.parts) {
    const group = new THREE.Group();
    group.name = part.id;
    group.position.set(...(part.pos ?? [0, 0, 0]));
    const [rx, ry, rz] = (part.rot ?? [0, 0, 0]).map(THREE.MathUtils.degToRad);
    group.rotation.set(rx, ry, rz);
    if (part.scale) group.scale.set(...part.scale);

    const geo = makeGeometry(part);
    const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color: part.color, gradientMap: toonGradient() }));
    mesh.position.set(...(part.pivot ?? [0, 0, 0]));
    const outline = outlineMesh(geo);
    outline.position.copy(mesh.position);
    group.add(mesh, outline);

    group.userData.baseRot = { x: rx, y: ry, z: rz };
    group.userData.anim = part.anim ?? null;

    nodes[part.id] = group;
    (part.parent ? nodes[part.parent] : root).add(group);
  }
  return root;
}

export { animateSpecies } from "./anim.js";
