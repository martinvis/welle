// Paintings: the palace's frames hold views of the world itself. Once, soon
// after the start, the scene is drawn from a handful of lookouts (the towers
// of the town wall and the palisade -- high, with the village spread below)
// into 640 x 480 pictures, which then hang in the frames as their canvases
// (plain textures: each render target's image, nothing read back).
import * as THREE from "three";

// frames: [{ x, y, z (world centre of the canvas), w, h, n: [nx, 0, nz] (facing the room) }]
export const PAINTINGS = { width: 640, height: 480 };   // the pictures' size (index.html sets it from config.json)

export function createPaintings(scene, frames) {
  const blank = new THREE.MeshBasicMaterial({ color: 0x4a4030 });   // primed canvas, until the pictures are taken
  const canvases = frames.map((f) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(f.w, f.h), blank);
    m.position.set(f.x, f.y, f.z); m.rotation.y = Math.atan2(f.n[0], f.n[2]);
    scene.add(m);
    return m;
  });
  const pictures = [];
  return {
    count: canvases.length, pictures, frames,   // (checks) where the canvases hang
    // views: [{ eye: [x, y, z], at: [x, y, z] }] -- each drawn once into its own picture; the frames take
    // them in turn. before/after wrap the draws (the demo pauses its mirrors and half-resolution pass)
    capture(renderer, views, { before, after } = {}) {
      if (!canvases.length || !views.length) return;
      const cam = new THREE.PerspectiveCamera(50, PAINTINGS.width / PAINTINGS.height, .3, 2500), prev = renderer.getRenderTarget();
      before?.();
      for (const v of views) {
        const rt = new THREE.WebGLRenderTarget(PAINTINGS.width, PAINTINGS.height, { samples: 4 });
        cam.position.set(...v.eye); cam.lookAt(...v.at); cam.updateMatrixWorld();
        renderer.setRenderTarget(rt);
        renderer.render(scene, cam);
        pictures.push(rt);
      }
      renderer.setRenderTarget(prev);
      after?.();
      canvases.forEach((m, i) => { m.material = new THREE.MeshBasicMaterial({ map: pictures[i % pictures.length].texture }); });
    },
  };
}
