// Paintings: the palace's frames hold views of the world itself. Once, soon
// after the start (and once the ground has arrived), the scene is drawn from a
// handful of lookouts -- the towers of the town wall and the palisade, high,
// with the village spread below -- and the pictures hang in the frames as their
// canvases. Nothing is read back: the canvases sample the render target itself.
//
// ONE TARGET, ONE MESH, ONE DRAW. The pictures used to be a render target each and the canvases a mesh each:
// seventeen draw calls of two triangles apiece, every frame, for the sake of seventeen little pictures. They
// share ONE atlas target now -- each view rendered into its own cell of it, through the viewport -- and the
// canvases are a single merged mesh whose UVs point at the cells. Their frames never move, so the merge bakes
// the placements into the vertices and the gallery is one draw whatever it holds.
import * as THREE from "three";
import { farHide } from "./farhide.js";

// frames: [{ x, y, z (world centre of the canvas), w, h, n: [nx, 0, nz] (facing the room) }]
export const PAINTINGS = { width: 640, height: 480 };   // the pictures' size (index.html sets it from config.json)

export function createPaintings(scene, frames) {
  // (one group for the lot, so the world can switch a gallery off from afar: farhide.js)
  const hall = new THREE.Group(); hall.name = "paintings"; scene.add(hall);
  if (frames.length) {
    const c = frames.reduce((a, f) => [a[0] + f.x / frames.length, a[1] + f.y / frames.length, a[2] + f.z / frames.length], [0, 0, 0]);
    farHide(hall, c, 70 + Math.max(...frames.map((f) => Math.hypot(f.x - c[0], f.z - c[2]))));
  }
  //   A RENDER TARGET READS FROM THE TOP on WebGPU, and a plane's own v runs from the bottom, so a picture
  // hung straight on one comes out UPSIDE DOWN (it did not on WebGL, whose textures are bottom-up -- the same
  // flip that turned the baked pattern tiles over, docs/webgpu.md). The canvas takes flipped UVs, once, here.
  // THE ATLAS: as square a grid as the pictures will make, one cell per view.
  const cellsOf = (n) => { const c = Math.ceil(Math.sqrt(Math.max(1, n))); return { cols: c, rows: Math.ceil(n / c) }; };
  let atlas = null, one = null, grid = { cols: 1, rows: 1 }, taken = 0;
  const canvasMat = new THREE.MeshBasicMaterial({ color: 0x4a4030 });   // primed, until the first picture lands
  // one mesh for the lot: each frame's quad in world space, its UVs cut to the cell its picture will fill
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), canvasMat);
  mesh.userData.noMerge = true;   // its material is swapped once the atlas exists
  mesh.frustumCulled = false;
  hall.add(mesh);
  const layout = (n) => {
    grid = cellsOf(n);
    const pos = [], uvs = [], idx = [];
    frames.forEach((f, i) => {
      const cell = i % Math.max(1, n), cx = cell % grid.cols, cy = Math.floor(cell / grid.cols);
      const yaw = Math.atan2(f.n[0], f.n[2]), ca = Math.cos(yaw), sa = Math.sin(yaw);
      const hw = f.w / 2, hh = f.h / 2, v = pos.length / 3;
      for (const [lx, ly] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]])
        pos.push(f.x + lx * ca, f.y + ly, f.z - lx * sa);
      // v runs DOWN the target (a render target's rows start at the top on WebGPU: docs/webgpu.md)
      const u0 = cx / grid.cols, u1 = (cx + 1) / grid.cols, v0 = cy / grid.rows, v1 = (cy + 1) / grid.rows;
      uvs.push(u0, v1, u1, v1, u1, v0, u0, v0);   // (v runs down the picture: a target's rows start at the top)
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = g;
  };
  layout(1);
  const pictures = [];
  return {
    count: frames.length, pictures, frames, mesh,   // (checks) where the canvases hang, and the one mesh they are
    get atlas() { return atlas; },                 // (checks) the one target every picture is a cell of
    // views: [{ eye: [x, y, z], at: [x, y, z] }] -- each drawn once into its own picture; the frames take
    // them in turn. before/after wrap the draws (the demo pauses its mirrors and half-resolution pass)
    // ONE VIEW PER CALL, and the caller comes back next frame for the next. Drawing all ten in a single frame
    // meant ten whole renders of the world between two vsyncs -- a spike that an integrated GPU can answer by
    // resetting its driver, which the browser reports as a lost device. Returns true when there is nothing
    // left to take.
    capture(renderer, views, { before, after } = {}) {
      if (!frames.length || !views.length) return true;
      if (taken >= views.length) return true;
      if (!atlas) {   // the one target, made to fit every view, and the canvases cut to its cells
        grid = cellsOf(views.length);
        atlas = new THREE.RenderTarget(PAINTINGS.width * grid.cols, PAINTINGS.height * grid.rows);
        one = new THREE.RenderTarget(PAINTINGS.width, PAINTINGS.height, { samples: 4 });
        canvasMat.map = atlas.texture;
        canvasMat.color.set(0xffffff);
        canvasMat.needsUpdate = true;
        layout(views.length);
      }
      const v = views[taken], cell = taken;
      const cam = new THREE.PerspectiveCamera(50, PAINTINGS.width / PAINTINGS.height, .3, 2500), prev = renderer.getRenderTarget();
      before?.();
      cam.position.set(...v.eye); cam.lookAt(...v.at); cam.updateMatrixWorld();
      // DRAWN ON ITS OWN, THEN COPIED INTO ITS CELL. Rendering straight into a corner of the atlas is the
      // obvious thing and it does not work: a render target carries its own viewport and scissor, the
      // renderer's are ignored while it draws into one, and the whole target is cleared for every view --
      // so the pictures wiped each other out and the canvases came up black. One view-sized target with its
      // multisampling, copied into place, keeps every picture and still leaves the gallery ONE draw.
      renderer.setRenderTarget(one);
      renderer.render(scene, cam);
      renderer.setRenderTarget(prev);
      const cx = cell % grid.cols, cy = Math.floor(cell / grid.cols);
      renderer.copyTextureToTexture(one.texture, atlas.texture, null,
                                    new THREE.Vector2(cx * PAINTINGS.width, cy * PAINTINGS.height));
      after?.();
      pictures.push(atlas);
      taken++;
      return taken >= views.length;
    },
  };
}
