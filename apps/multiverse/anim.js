// Shared pose animation, engine-independent: walks the Object3D hierarchy
// that either renderer built (rig.js meshes or banner.js quads) and drives
// the per-part `anim` spec stored in userData. Pure math, no THREE import --
// it only needs nodes exposing .traverse/.rotation/.userData, which both
// engines provide by building the same Group-per-part skeleton.
export function animateSpecies(root, t) {
  root.traverse((obj) => {
    const anim = obj.userData?.anim;
    if (!anim) return;
    const base = obj.userData.baseRot;
    const delta = (anim.deg * Math.PI / 180) * Math.sin(t * anim.speed * Math.PI * 2 + (anim.phase || 0));
    obj.rotation[anim.axis] = base[anim.axis] + delta;
  });
}
