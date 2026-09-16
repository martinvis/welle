// FACES: what a person's face shows -- an expression on their face marks (people.js: the eyes, the eyebrows, the
// mouth; composite.js paints them: markRows reshapes each mark's frame on the head, the mark shader draws its
// style). This module only decides WHAT a face shows, in two levels:
//   FEATURES (level 1) -- what one kind of mark can do: an eye open, wide or closed; a brow level, raised, knit
//     angry (its inner end down) or sad (its inner end up); a mouth at rest, smiling, frowning, open round or
//     grinning with its teeth. Each is a small recipe the composite applies to the mark: w, h (its width and
//     height, times), lift (up the face, in its half-widths), tilt (radians, the outer end up -- mirrored per
//     side), code (the shader's style: 2 a closed eye, 3 a smile, 4 a frown, 5 an open mouth, 6 teeth, 9 an eye
//     squeezed shut laughing, 10 a red eye -- struck down), tear (a crying eye: code 7 + the tear's phase, its reach grown to the cheek), side (only
//     the mark on that side takes it -- a wink: one eye shut)
//   EMOTIONS (level 2) -- a feature for each kind of mark
// A figure shows `an.expr` (expression(name)); a figure's resting face comes with its def (a sleeper: asleep).
// createFaces: while someone speaks, their face changes now and then.
export const FEATURES = {
  eye: { open: {}, wide: { w: 1.08, h: 1.35 }, closed: { code: 2 }, wink: { code: 2, side: 1 }, squint: { code: 9 }, red: { code: 10 }, crying: { tear: true, reach: 2.6 } },
  brow: { level: {}, raised: { lift: .35 }, angry: { tilt: .38, lift: -.12 }, sad: { tilt: -.32, lift: .12 } },
  mouth: { rest: {}, smile: { code: 3 }, frown: { code: 4 }, open: { code: 5, w: .55, h: 2.4 }, teeth: { code: 6, w: 1.08, h: 1.6 }, laugh: { code: 6, w: 1.18, h: 2.4 } },
};
export const EMOTIONS = {
  neutral: { eye: "open", brow: "level", mouth: "rest" },
  happy: { eye: "open", brow: "level", mouth: "smile" },
  sad: { eye: "open", brow: "sad", mouth: "frown" },
  angry: { eye: "open", brow: "angry", mouth: "rest" },
  surprised: { eye: "wide", brow: "raised", mouth: "open" },
  grin: { eye: "open", brow: "raised", mouth: "teeth" },
  asleep: { eye: "closed", brow: "level", mouth: "rest" },
  crying: { eye: "crying", brow: "sad", mouth: "frown" },
  wink: { eye: "wink", brow: "level", mouth: "smile" },   // (brief: a talker's wink lasts WINK seconds)
  laughing: { eye: "squint", brow: "raised", mouth: "laugh" },
  coughing: { eye: "closed", brow: "sad", mouth: "open" },
  sneezing: { eye: "closed", brow: "raised", mouth: "open" },
  downed: { eye: "red", brow: "level", mouth: "open" },   // struck down (combat.js): red eyes
};
// the face that goes with a non-verbal sound (speech.js VOCALS), held exactly as long as the sound
export const VOCAL_FACES = { laugh: "laughing", cry: "crying", cough: "coughing", sneeze: "sneezing" };
const resolved = new Map();
// an emotion as the composite takes it: { eye, brow, mouth } recipes (shared objects: never edited)
export function expression(name) {
  if (!resolved.has(name)) {
    const e = EMOTIONS[name];
    if (!e) throw new Error(`faces: no emotion "${name}"`);
    resolved.set(name, Object.fromEntries(Object.entries(e).map(([role, f]) => [role, FEATURES[role][f]])));
  }
  return resolved.get(name);
}

// talking: the voice's mood (speech.js) leans which faces they pull
const LEAN = {
  normal: [["neutral", 3], ["happy", 3], ["grin", 1.2], ["surprised", 1], ["sad", 1], ["angry", .6], ["wink", .7]],
  excited: [["happy", 2], ["grin", 3], ["surprised", 3], ["wink", 1]],
  angry: [["angry", 5], ["sad", 1], ["surprised", .6]],
};
const WINK = .4;   // seconds an eye stays shut in a wink; then the smile stays on
const draw = (table) => { let r = Math.random() * table.reduce((t, [, w]) => t + w, 0); for (const [e, w] of table) if ((r -= w) < 0) return e; return table[0][0]; };
// speak(an, seconds, mood): one to three expressions across the utterance and a moment after it, then back to
// the face they rest in; update() once a frame (its own clock: faces keep changing while the world is frozen)
export function createFaces() {
  const live = new Map();   // an -> { rest, seq: [{ until, expr }] }
  const now = () => performance.now() / 1000;
  return {
    speak(an, dur, mood = "normal") {
      if (!an) return;
      const rest = live.get(an)?.rest ?? an.expr ?? null;
      if (rest === expression("asleep")) return;   // a sleeper pulls no faces
      const t0 = now(), span = Math.max(dur, .5) + .8, n = 1 + Math.floor(Math.random() * (dur > 1.5 ? 3 : 2)), seq = [];
      for (let i = 0; i < n; i++) {
        const e = draw(LEAN[mood] ?? LEAN.normal), t1 = t0 + span * i / n;
        if (e === "wink") seq.push({ until: t1 + WINK, expr: expression("wink") }, { until: t0 + span * (i + 1) / n, expr: expression("happy") });
        else seq.push({ until: t0 + span * (i + 1) / n, expr: expression(e) });
      }
      live.set(an, { rest, seq });
    },
    // show(an, name, seconds): that face for exactly so long (a laugh's, a cry's, a sneeze's -- a sleeper's too), then
    // back to the resting face
    show(an, name, dur) {
      if (!an) return;
      const rest = live.get(an)?.rest ?? an.expr ?? null;
      live.set(an, { rest, seq: [{ until: now() + Math.max(dur, .2), expr: expression(name) }] });
    },
    update() {
      const t = now();
      for (const [an, f] of live) {
        if (an.down) { live.delete(an); continue; }   // struck down: its face stays as it fell
        while (f.seq.length && f.seq[0].until <= t) f.seq.shift();
        if (f.seq.length) an.expr = f.seq[0].expr;
        else { an.expr = f.rest; live.delete(an); }
      }
    },
  };
}
