// SWORD: the player's second weapon (V takes it out or puts it away; the
// mouse wheel runs through none / bow / sword). It is DRAWN FLAT over the
// view, as a game draws the weapon in hand: a 3D blade that close to the eye
// would be cut away by the camera's near plane. Held ready in the lower
// right; a click swings it (~0.35 s, a sweep across the view from right to
// left with a faint trail, then back to the ready), half a second between
// swings. At the swing's middle
// five short lines fan out across ~100 degrees ahead, 1.6 m from just below
// the eye, and the nearest figure they meet is struck down (combat.js), a
// wound left where the blade met it (archery.js wounds); every swing a whoosh.
import * as THREE from "three";

const REACH = 1.6, FAN = [-.8, -.4, 0, .4, .8], HIT_AT = .15, SWING = .4, COOLDOWN = .5;
const UP = new THREE.Vector3(0, 1, 0);

export function createSword({ camera, combat, archery }) {
  let out = false, swingT = -1, cool = 0, struck = false;
  const hud = document.createElement("div");
  hud.style.cssText = "position:fixed;left:12px;bottom:112px;padding:4px 8px;border-radius:6px;background:rgba(20,16,10,.55);color:#f2e8d0;font:13px system-ui;display:none;pointer-events:none";
  hud.textContent = "sword";
  // the sword in the hand: an SVG laid over the view -- blade (a ridge down its middle), crossguard, wrapped grip, pommel
  const view = document.createElement("div");
  view.style.cssText = "position:fixed;right:9vw;bottom:-6vh;width:13vh;height:44vh;pointer-events:none;display:none;transform-origin:50% 90%;z-index:4";
  view.innerHTML = '<svg viewBox="0 0 100 320" width="100%" height="100%">'
    + '<defs><linearGradient id="swBlade" x1="0" x2="1"><stop offset="0" stop-color="#7d848b"/><stop offset=".46" stop-color="#e8edf1"/>'
    + '<stop offset=".54" stop-color="#b3bac1"/><stop offset="1" stop-color="#666d74"/></linearGradient></defs>'
    + '<polygon points="50,4 63,32 61,228 39,228 37,32" fill="url(#swBlade)" stroke="#454b51" stroke-width="1.5"/>'
    + '<line x1="50" y1="16" x2="50" y2="222" stroke="#8f969d" stroke-width="1.3"/>'
    + '<rect x="12" y="225" width="76" height="13" rx="5" fill="#3e3a38" stroke="#221e1b" stroke-width="1.5"/>'
    + '<rect x="42" y="238" width="16" height="54" rx="4" fill="#5a3a22"/>'
    + '<g stroke="#34200f" stroke-width="3">' + [246, 257, 268, 279].map((y) => `<line x1="42" y1="${y}" x2="58" y2="${y + 5}"/>`).join("") + '</g>'
    + '<circle cx="50" cy="302" r="11" fill="#4a4644" stroke="#221e1b" stroke-width="1.5"/></svg>';
  // the swing's trail: a pale arc across the view, fading in and out with the sweep
  const trail = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  trail.setAttribute("viewBox", "0 0 100 100"); trail.setAttribute("preserveAspectRatio", "none");
  trail.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;opacity:0;z-index:3";
  trail.innerHTML = '<path d="M 88 42 Q 52 16 14 60" stroke="rgba(255,255,255,.7)" stroke-width="1.6" fill="none" stroke-linecap="round"/>';
  document.body.append(hud, view, trail);
  let back = 0;   // seconds left of the return to the ready after a swing
  const SWEEP = .35, RETURN = .2;
  const pose = (u) => {   // u 0: ready (lower right, leaning a little left) .. 1: the swing's end (low on the left, blade over flat)
    const e = u * u * (3 - 2 * u);
    return `translate(${-54 * e}vw, ${-9 * Math.sin(Math.PI * e)}vh) rotate(${-16 - 100 * e}deg)`;
  };
  function draw() {
    if (!out) return;
    if (swingT >= 0) {
      const u = Math.min(1, swingT / SWEEP);
      view.style.transform = pose(u);
      trail.style.opacity = u > .12 && u < .9 ? (.75 * Math.sin(Math.PI * (u - .12) / .78)).toFixed(3) : "0";
    } else {
      view.style.transform = pose(back > 0 ? back / RETURN : 0);
      trail.style.opacity = "0";
    }
  }

  function strike() {   // the fan of lines at the swing's middle; the nearest figure hit goes down
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion), eye = camera.position.clone().add(new THREE.Vector3(0, -.25, 0));
    let best = null, at = null, dir = null;
    for (const a of FAN) {
      const d = f.clone().applyAxisAngle(UP, a).normalize(), q = eye.clone().addScaledVector(d, REACH), h = combat.hitFigure(eye, q);
      if (h && (!best || h.t < best.t)) { best = h; at = eye.clone().lerp(q, h.t); dir = d; }
    }
    if (!best) return;
    archery.addWound(best.herd, best.an, best.i, at, dir.clone().negate());
    combat.down(best.herd, best.an, { dir, i: best.i });
    archery.sfx("body", at);
  }

  return {
    get out() { return out; },
    get swinging() { return swingT >= 0; },
    get phase() { return swingT; },   // seconds into the swing (-1: none) -- the body's slash follows it
    setOut(on) { out = !!on; hud.style.display = view.style.display = out ? "block" : "none"; if (!out) trail.style.opacity = "0"; swingT = -1; back = 0; draw(); },
    swing() {
      if (!out || cool > 0) return;
      swingT = 0; cool = COOLDOWN; struck = false;
      archery.sfx("whoosh", camera.position);
    },
    update(dt) {
      cool = Math.max(0, cool - dt);
      if (swingT >= 0) {
        swingT += dt;
        if (!struck && swingT >= HIT_AT) { struck = true; strike(); }
        if (swingT >= SWING) { swingT = -1; back = RETURN; }
      } else back = Math.max(0, back - dt);
      draw();
    },
  };
}
