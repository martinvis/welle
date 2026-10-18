// Rain and snow: the falling part of the weather. The weather's state (the
// P / O keys, the network op, the snow on roofs, clouds, sounds) stays with
// the world in index.html; this draws the precipitation for it.
// Three transparent "curtains" billboarded 4/10/22m ahead of the camera,
// DEPTH-TESTED against the scene: walls naturally occlude the rain, so from
// indoors you still see it falling outside a window, and each curtain also
// hides itself when its own anchor point is under a roof (large interiors)
import * as THREE from "three";
import { wgslFn, uniform, uv } from "three/tsl";

// One curtain's worth of falling weather, in WGSL: parallax sublayers of flakes (snow) or streaks (rain),
// the sublayer count and density set by the intensity. Returns (tint, alpha).
const weatherFrag = wgslFn(`
  fn weatherFrag(uvc: vec2<f32>, t: f32, mode: f32, layer: f32, intensity: f32) -> vec4<f32> {
    let uvs = vec2<f32>(uvc.x * 2.6, uvc.y);
    var den = 1.6;
    if (intensity < 0.5) { den = 0.55; } else if (intensity < 1.5) { den = 1.0; }
    var a = 0.0;
    var tint = vec3<f32>(1.0);
    if (mode > 1.5) {                                 // SNOW: flakes drifting, three sublayers
      for (var j: i32 = 0; j < 3; j = j + 1) {
        let fj = f32(j);
        let s = 1.0 + fj * 0.8;
        let q = uvs * 11.0 * s + vec2<f32>(sin(t * 0.4 + fj * 2.1) * 1.1, t * (0.5 + 0.22 * fj) * s);
        let id = floor(q);
        let h = hashW(id + layer * 13.0);
        let c = fract(q) - 0.5 + 0.3 * vec2<f32>(sin(h * 6.28 + t * 1.3), cos(h * 5.0 + t * 0.6));
        a = a + smoothstep(0.10, 0.04, length(c)) * step(h, 0.55 * den) * (0.85 - 0.2 * fj);
      }
    } else {                                          // RAIN: streaks, two sublayers, slanted
      for (var j: i32 = 0; j < 2; j = j + 1) {
        let fj = f32(j);
        let s = 1.0 + fj * 0.9;
        let q = vec2<f32>((uvs.x + uvs.y * 0.16) * 26.0 * s, uvs.y * 3.4 * s + t * (5.5 + 2.5 * fj));
        let id = floor(q);
        let h = hashW(id + layer * 7.0);
        let c = fract(q) - 0.5;
        a = a + (1.0 - smoothstep(0.02, 0.07, abs(c.x))) * smoothstep(0.42, 0.2, abs(c.y)) * step(h, 0.4 * den) * 0.45;
      }
      tint = vec3<f32>(0.72, 0.8, 0.88);
    }
    var k = 1.25;
    if (intensity < 0.5) { k = 0.75; } else if (intensity < 1.5) { k = 1.0; }
    a = a * k;
    return vec4<f32>(tint, min(a, 0.95) * (0.95 - 0.22 * layer));
  }
`, [wgslFn(`fn hashW(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5); }`)]);

const mkWeatherLayer = (d, i) => {
  const h = 2 * d * Math.tan(THREE.MathUtils.degToRad(22.5)) * 1.8;
  const U = { t: uniform(0), mode: uniform(0), layer: uniform(i), intensity: uniform(1) };
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const out = weatherFrag({ uvc: uv(), t: U.t, mode: U.mode, layer: U.layer, intensity: U.intensity });
  mat.colorNode = out.xyz;
  mat.opacityNode = out.w;
  mat.userData.U = U;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(h * 2.6, h), mat);
  m.position.z = -d;
  m.frustumCulled = false;
  m.renderOrder = 5;
  return m;
};

export function createWeather(scene) {
  const group = new THREE.Group();
  const layers = [4, 10, 22].map((d, i) => { const m = mkWeatherLayer(d, i); group.add(m); return { d, m }; });
  group.visible = false;
  scene.add(group);
  const dir = new THREE.Vector3();
  return {
    // every frame. mode: 0 clear, 1 rain, 2 snow; intensity 0..2; roofedAt(x, z, y): the world's roof test
    update(camera, t, mode, intensity, roofedAt) {
      group.visible = mode > 0;
      if (!mode) return;
      group.position.copy(camera.position);
      group.quaternion.copy(camera.quaternion);
      camera.getWorldDirection(dir);
      for (const { d, m } of layers) {
        m.visible = !roofedAt(camera.position.x + dir.x * d, camera.position.z + dir.z * d, camera.position.y + dir.y * d);
        const U = m.material.userData.U;
        U.t.value = t; U.mode.value = mode; U.intensity.value = intensity;
      }
    },
  };
}
