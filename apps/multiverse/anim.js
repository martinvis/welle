// Shared pose animation, engine-independent: walks the Object3D hierarchy
// that either renderer built (banner.js quads) and drives
// the per-part `anim` spec stored in userData -- and the mammal rig's legs:
// two-bone IK per leg on the gait clock (skeleton.js has the math), the body
// riding the gait's bob. Pure math, no THREE import -- it only needs nodes
// exposing .traverse/.rotation/.position/.userData/.parent, which both
// engines provide by building the same Group-per-part skeleton.
//   root.userData.gaits (walk/run sets), .amp (stride amplitude), .run (0..1)
import { legPose, gaitFor, CYCLES } from "./skeleton.js";

export function animateSpecies(root, t) {
  const g = gaitFor(root.userData.gaits, root.userData.run ?? 0), amp = root.userData.amp ?? 1;
  const phase = t * CYCLES * Math.PI * 2;
  const bob = g ? g.bob * amp * Math.sin(phase * 2 + .5) : 0;
  root.traverse((obj) => {
    const u = obj.userData;
    if (u.bob) obj.position.y = u.baseY + bob;
    const anim = u.anim, base = u.baseRot;
    if (anim) {
      const delta = (anim.deg * Math.PI / 180) * Math.sin(t * anim.speed * Math.PI * 2 + (anim.phase || 0));
      obj.rotation[anim.axis] = base[anim.axis] + delta;
    }
    if (u.ik && g) {
      if (u.ik.follow) obj.rotation.z = base.z + (obj.parent.userData.lowerAngle ?? 0);
      else {
        const [t1, t2] = legPose(u.ik, g, phase + g.offsets[u.ik.leg] + (u.ik.phase || 0), amp, bob, obj.position.y);
        obj.rotation.z = base.z + t1; u.lowerAngle = t2;
      }
    }
  });
}
