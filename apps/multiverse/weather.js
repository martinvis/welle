// Rain and snow: the falling part of the weather. The weather's state (the
// P / O keys, the network op, the snow on roofs, clouds, sounds) stays with
// the world in index.html; this draws the precipitation for it.
// Three transparent "curtains" billboarded 4/10/22m ahead of the camera,
// DEPTH-TESTED against the scene: walls naturally occlude the rain, so from
// indoors you still see it falling outside a window, and each curtain also
// hides itself when its own anchor point is under a roof (large interiors)
import * as THREE from "three";

const mkWeatherLayer = (d, i) => {
  const h = 2 * d * Math.tan(THREE.MathUtils.degToRad(22.5)) * 1.8;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uT: { value: 0 }, uMode: { value: 0 }, uI: { value: i }, uInt: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uT, uMode, uI, uInt;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }
      void main() {
        // the original overlay animation, drawn per curtain: multiple
        // parallax sublayers of flakes/streaks; uInt = 0/1/2 intensity
        vec2 uv = vec2(vUv.x * 2.6, vUv.y);
        float den = uInt < .5 ? .55 : uInt < 1.5 ? 1. : 1.6;
        float a = 0.; vec3 tint;
        if (uMode > 1.5) {
          for (int j = 0; j < 3; j++) {
            float s = 1. + float(j) * .8;
            vec2 q = uv * 11. * s + vec2(sin(uT * .4 + float(j) * 2.1) * 1.1, uT * (.5 + .22 * float(j)) * s);
            vec2 id = floor(q);
            float h = hash(id + uI * 13.);
            vec2 c = fract(q) - .5 + .3 * vec2(sin(h * 6.28 + uT * 1.3), cos(h * 5. + uT * .6));
            a += smoothstep(.10, .04, length(c)) * step(h, .55 * den) * (.85 - .2 * float(j));
          }
          tint = vec3(1.);
        } else {
          for (int j = 0; j < 2; j++) {
            float s = 1. + float(j) * .9;
            vec2 q = vec2((uv.x + uv.y * .16) * 26. * s, uv.y * 3.4 * s + uT * (5.5 + 2.5 * float(j)));
            vec2 id = floor(q);
            float h = hash(id + uI * 7.);
            vec2 c = fract(q) - .5;
            a += (1. - smoothstep(.02, .07, abs(c.x))) * smoothstep(.42, .2, abs(c.y)) * step(h, .4 * den) * .45;
          }
          tint = vec3(.72, .8, .88);
        }
        a *= uInt < .5 ? .75 : uInt < 1.5 ? 1. : 1.25;
        gl_FragColor = vec4(tint, min(a, .95) * (.95 - .22 * uI));
      }`,
  });
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
        m.material.uniforms.uT.value = t;
        m.material.uniforms.uMode.value = mode;
        m.material.uniforms.uInt.value = intensity;
      }
    },
  };
}
