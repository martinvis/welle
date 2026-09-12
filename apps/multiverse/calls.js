// Animal calls, synthesized on Web Audio -- the world's other voices.
//
// Standalone like speech.js: give it an AudioContext and a species name.
// Every call is a recipe of NOTES; a note is one sound event with a
// source (saw = a buzzing voice, pulse = a rougher one, sine = a pure
// tone, noise), a pitch glide, a resonance (bandpass) standing in for
// the animal's mouth, an envelope, and optional vibrato, tremolo or
// roughness (fast amplitude wobble). Repeats with gaps make barks,
// clucks, grunts and quacks. `loud` scales how far the call carries.
//
//   animalCall(ctx, "cow", { dest: gainNode })  -> ends at (seconds)
//   CALLS[species] -> the recipe, or undefined for the silent ones

// a note: src saw|pulse|sine|noise; f = [start, mid, end] Hz (or [start,
// end]); res = the mouth: [[Hz, Q, gain], ...] parallel resonances; a/r
// attack/release; g level; at offset; n repeats with gap; vib [rate,
// depth]; trem [rate, depth] (bleat) or rough Hz (growl); sat 0..1 soft
// saturation; breath = noise mixed into the voice before the mouth;
// res2 = a second mouth shape the resonances glide to (from 30% of the
// note to its end) -- a vowel change, which is what a "mee-ow" is.
// What keeps a voice from sounding like a game bleep is CHAOS, so every
// voiced note gets it by default: jit = random pitch jitter (fraction),
// chaos = random loudness flicker (fraction), sub = a subharmonic (the
// voice pulsing at half its pitch, the period-doubling of growls).
const N = (o) => ({ src: "saw", f: [200, 200], dur: .3, res: [[900, 3, 1]], a: .02, r: .1, g: .5, at: 0, n: 1, gap: .1, sat: 0, breath: 0, jit: .05, chaos: .3, ...o });
// mouths: resonance sets by size of animal (F1/F2/F3-like)
const BIG = [[330, 3, 1], [780, 3.5, .55], [1700, 4, .22]], MID = [[600, 3, 1], [1400, 3.5, .5], [2700, 4, .2]], SMALL = [[900, 3, 1], [2100, 4, .5], [3400, 5, .22]];
// the big cats' roar: a powerful, fairly TONAL blast with a slow waver and a
// breathy edge (a growl is a different thing -- see the bear)
const roar = (f, dur, extra = {}) => [
  N({ src: "saw", f, dur, res: BIG, a: .12, r: .45, g: .9, vib: [6, .03], rough: 11, sat: .75, breath: .2, sub: .5, jit: .08, chaos: .4, ...extra }),
  N({ src: "noise", dur, res: [[900, .6, 1]], a: .2, r: .35, g: .18, ...extra }),
];
export const CALLS = {
  // a moo: a closed nasal hum that opens into a rounded "oo" and widens to "aw" as the pitch sags, on a
  // slightly saturated voice through a broad mouth
  cow:      { loud: 1.4, level: 1.05, notes: [N({ src: "sine", f: [105, 115, 120], dur: .22, res: [[250, 2, 1]], a: .08, r: .05, g: .5 }),
                                 N({ f: [118, 142, 85], dur: 1.3, res: [[360, 1.3, 1], [720, 1.5, .5], [1500, 1.8, .2]], res2: [[560, 1.3, 1], [950, 1.5, .6], [1700, 1.8, .25]], a: .1, r: .4, g: .85, at: .16, vib: [5.5, .025], sat: .45, breath: .15 })] },
  ox:       { loud: 1.5, level: 0.98, notes: [N({ src: "sine", f: [85, 92, 95], dur: .25, res: [[220, 2, 1]], a: .1, r: .05, g: .5 }),
                                 N({ f: [95, 115, 68], dur: 1.5, res: [[320, 1.3, 1], [650, 1.5, .5], [1400, 1.8, .2]], res2: [[500, 1.3, 1], [880, 1.5, .6], [1600, 1.8, .25]], a: .12, r: .45, g: .9, at: .18, vib: [5, .025], sat: .55, breath: .15 })] },
  sheep:    { loud: 1, level: 3.5, notes: [N({ f: [300, 280, 240], dur: .8, res: [[950, 4, 1], [1900, 5, .5], [2900, 6, .25]], a: .05, r: .15, g: .75, trem: [26, .8], sat: .2 })] },
  // a pig: two short snorting grunts (noise through the nose, then a rough low voice in a nasal mouth), then an "oink" that rises and closes nasally
  pig:      { loud: .9, level: 0.92, notes: [N({ src: "noise", dur: .08, res: [[600, .8, 1]], a: .004, r: .05, g: .5, n: 2, gap: .2 }),
                                 N({ f: [110, 130, 90], dur: .13, res: [[350, 1.2, 1], [900, 1.4, .6], [1800, 1.6, .3]], a: .01, r: .05, g: .8, rough: 32, sat: .8, breath: .5, n: 2, gap: .15 }),
                                 N({ f: [260, 520, 430], dur: .22, res: [[500, 1.3, 1], [1500, 1.5, .6], [2600, 1.8, .25]], res2: [[350, 1.3, 1], [900, 1.5, .5], [2200, 1.8, .2]], a: .015, r: .06, g: .6, at: .62, sat: .5, breath: .2 })] },
  boar:     { loud: 1.1, level: 2.66, notes: [N({ src: "pulse", f: [70, 85, 55], dur: .3, res: [[400, 2.5, 1], [900, 3, .4]], a: .02, r: .08, g: .9, rough: 26, sat: .6, breath: .35, n: 3, gap: .22 })] },
  // a bark: an abrupt noisy attack, a rough saturated "wo-uf" whose pitch jumps and drops while the mouth closes, three in a row
  dog:      { loud: 1.2, level: 0.58, notes: [N({ src: "noise", dur: .06, res: [[1800, .6, 1]], a: .003, r: .04, g: .5, n: 3, gap: .32 }),
                                 N({ f: [380, 640, 280], dur: .16, res: [[620, 1.3, 1], [1350, 1.6, .6], [2600, 2, .3]], res2: [[440, 1.3, 1], [900, 1.6, .5], [2200, 2, .2]], a: .006, r: .07, g: .95, rough: 55, sat: .7, breath: .4, n: 3, gap: .22 })] },
  // a howl: a quick rising bark, then a strong held tone that wavers and falls away (a slow soft swell is a ghost, not a wolf)
  // a howl: a quick bark, then a long tone that rises and holds, its mouth opening from "oo" to "aw" and
  // closing again as it falls -- broad resonances so it is a voice, not a siren; a slow waver on top
  wolf:     { loud: 1.6, level: 0.49, notes: [N({ f: [380, 520, 480], dur: .18, res: [[700, 1.5, 1], [1500, 2, .5]], a: .01, r: .06, g: .9, sat: .5, breath: .3 }),
                                 N({ f: [350, 620, 560], dur: .9, res: [[400, 1.6, 1], [850, 2, .5], [2500, 2.5, .15]], res2: [[680, 1.6, 1], [1250, 2, .6], [2600, 2.5, .2]], a: .12, r: .05, g: .85, at: .2, vib: [5, .02], sat: .4, breath: .12 }),
                                 N({ f: [560, 520, 300], dur: 1.2, res: [[680, 1.6, 1], [1250, 2, .6], [2600, 2.5, .2]], res2: [[380, 1.6, 1], [800, 2, .5], [2400, 2.5, .15]], a: .02, r: .6, g: .85, at: 1.1, vib: [5, .025], sat: .4, breath: .15 })] },
  // a meow: a closed "m" onset, then "ee" (high second resonance) opening into "ow" (low, rounded) as the pitch rises and falls
  cat:      { loud: .6, level: 0.72, notes: [N({ src: "sine", f: [520, 540, 560], dur: .09, res: [[300, 2, 1]], a: .03, r: .03, g: .5 }),
                                 N({ f: [540, 820, 380], dur: .85, res: [[480, 1.4, 1], [2500, 1.6, .65], [3500, 2, .25]], res2: [[760, 1.4, 1], [1100, 1.6, .75], [2600, 2, .2]], a: .04, r: .25, g: .7, at: .07, sat: .35, vib: [7, .03], breath: .1 })] },
  fox:      { loud: 1.2, level: 0.93, notes: [N({ f: [900, 1400, 1100], dur: .5, res: [[1500, 3, 1], [2800, 4, .3]], a: .04, r: .15, g: .7, rough: 40, sat: .3, breath: .3 })] },
  // a neigh: a high squeal WARBLED in pitch (~12 Hz, wide), stepping down, then a low pulsed nicker
  // a whinny: a harsh squeal (saturated saw, BROAD resonances so its harmonics all come through) pulsed
  // ~11 times a second in both loudness and pitch, tumbling down through two phrases into a low nicker
  // a whinny: a harsh squeal whose pitch RIPPLES deeply (~9 Hz, a quarter of its height) while it slowly
  // falls -- frequency modulation, not a loudness flutter -- through a broad mouth, ending in a pulsed nicker
  horse:    { loud: 1.3, level: 0.45, notes: [N({ f: [1150, 1300, 850], dur: 1.0, res: [[1400, 1.0, 1], [2800, 1.2, .6], [4600, 1.4, .3]], a: .05, r: .05, g: .85, vib: [9, .28], sat: .8, breath: .3 }),
                                 N({ f: [850, 620, 400], dur: .6, res: [[1000, 1.0, 1], [2100, 1.2, .55], [3600, 1.4, .25]], a: .01, r: .2, g: .8, at: .98, vib: [8, .22], sat: .7, breath: .25 }),
                                 N({ f: [95, 90, 70], dur: .14, res: [[350, 1.5, 1], [800, 2, .5]], a: .01, r: .05, g: .7, at: 1.62, rough: 30, sat: .8, breath: .4, n: 3, gap: .1 })] },
  unicorn:  { loud: 1.3, level: 0.45, notes: [N({ f: [1500, 1700, 1100], dur: 1.0, res: [[1700, 1.0, 1], [3400, 1.2, .5], [5400, 1.4, .12]], a: .05, r: .05, g: .75, vib: [9, .28], sat: .4, breath: .25 }),
                                 N({ f: [1100, 800, 520], dur: .6, res: [[1200, 1.0, 1], [2500, 1.2, .55]], a: .01, r: .22, g: .7, at: .98, vib: [8, .22], sat: .5 })] },
  // a zebra brays in rough breathy "kwa-ha" pairs, like a barking donkey: a harsh saturated bark, then a higher aspirated "ha", four times
  zebra:    { loud: 1.3, level: 0.69, notes: [N({ f: [420, 620, 340], dur: .17, res: [[700, 1.2, 1], [1500, 1.4, .6], [2800, 1.8, .3]], res2: [[500, 1.2, 1], [1000, 1.4, .5], [2400, 1.8, .2]], a: .008, r: .06, g: .9, rough: 45, sat: .85, breath: .5, n: 4, gap: .33 }),
                                 N({ f: [700, 900, 620], dur: .16, res: [[900, 1.2, 1], [2000, 1.5, .5]], a: .02, r: .06, g: .55, at: .2, sat: .5, breath: .9, n: 4, gap: .34 }),
                                 N({ src: "noise", dur: .14, res: [[1600, .7, 1]], a: .01, r: .06, g: .35, at: .21, n: 4, gap: .36 })] },
  deer:     { loud: 1.1, level: 0.72, notes: [N({ f: [520, 700, 380], dur: .13, res: MID, a: .006, r: .06, g: .9, rough: 45, sat: .5, breath: .4 })] },
  // the lion: a long HARSH roar -- a pulsed, saturated, very rough voice with a lot of breath over a broad
  // chest resonance, rising and holding, then the string of falling grunts
  lion:     { loud: 2.2, level: 1.7, notes: [N({ src: "pulse", f: [70, 115, 62], dur: 1.9, res: [[300, 2, 1], [750, 2.5, .7], [1500, 3, .4]], a: .18, r: .45, g: .95, rough: 28, sat: .9, breath: .5, sub: .6, jit: .1, chaos: .45 }),
                                 N({ src: "saw", f: [140, 230, 124], dur: 1.9, res: [[750, 2.5, 1], [1500, 3, .5]], a: .18, r: .45, g: .4, rough: 28, sat: .9 }),
                                 N({ src: "noise", dur: 1.9, res: [[700, .5, 1]], a: .25, r: .4, g: .35, rough: 28 }),
                                 N({ src: "pulse", f: [72, 70, 52], dur: .28, res: [[300, 2.5, 1], [700, 3, .5]], a: .02, r: .1, g: .8, rough: 24, sat: .85, breath: .4, at: 2.05, n: 5, gap: .32 })] },
  tiger:    { loud: 2, level: 2.4, notes: [...roar([105, 130, 75], 1.2), N({ src: "noise", dur: .18, res: [[700, .8, 1]], a: .01, r: .08, g: .45, at: 1.35, n: 2, gap: .15 })] },   // ends in a chuff
  manticore:{ loud: 2, level: 2.29, notes: roar([85, 105, 60], 1.5) },
  // a bear: a throaty growl-roar -- low, very rough, chesty and breathy, opening with a huff, closing in a grumble
  bear:     { loud: 1.7, level: 1.8, notes: [N({ src: "noise", dur: .25, res: [[600, .7, 1]], a: .02, r: .1, g: .5 }),
                                 N({ f: [90, 120, 68], dur: 1.3, res: [[300, 1.3, 1], [700, 1.5, .6], [1400, 1.8, .3], [2600, 2, .12]], a: .06, r: .4, g: .85, at: .15, rough: 21, sat: .95, breath: .5, sub: .6, jit: .1, chaos: .45 }),
                                 N({ f: [68, 64, 52], dur: .5, res: [[260, 1.3, 1], [600, 1.5, .4]], a: .05, r: .25, g: .6, at: 1.5, rough: 17, sat: .9, breath: .35 })] },
  // a trumpet: a BRASSY blast (hard saturation, bright mouth), sweeping up and back down with a slight vibrato, an octave below it a faint rumble
  // a trumpet: a blaring, rattling brass blast -- hard saturation through a VERY broad mouth so every harmonic
  // blares, a ~40 Hz rattle, rising fast and sagging back, with air noise
  elephant: { loud: 2.4, level: 0.62, notes: [N({ f: [450, 900, 560], dur: 1.3, res: [[900, .9, 1], [1800, 1.0, .8], [3200, 1.2, .5], [5000, 1.5, .25]], a: .1, r: .3, g: .6, rough: 42, vib: [6, .04], sat: .95, breath: .3 }),
                                 N({ src: "noise", dur: 1.3, res: [[2500, .6, 1]], a: .15, r: .3, g: .18, rough: 42 })] },
  hippo:    { loud: 1.8, level: 3.09, notes: [N({ src: "pulse", f: [65, 70, 50], dur: .28, res: BIG, a: .02, r: .1, g: .9, rough: 24, sat: .6, breath: .2, n: 4, gap: .28 })] },
  camel:    { loud: 1.4, level: 3.5, notes: [N({ f: [160, 140, 105], dur: 1.0, res: [[550, 3, 1], [1300, 3.5, .5], [2400, 4, .2]], a: .1, r: .3, g: .8, rough: 18, sat: .5, breath: .25 })] },
  minotaur: { loud: 2, level: 2.43, notes: [N({ src: "pulse", f: [90, 105, 60], dur: 1.3, res: BIG, a: .15, r: .4, g: .9, vib: [5, .03], rough: 20, sat: .7, breath: .15 })] },
  chicken:  { loud: .7, level: 1.43, notes: [N({ f: [620, 560, 420], dur: .09, res: SMALL, a: .006, r: .04, g: .7, sat: .2, n: 5, gap: .19 }), N({ f: [700, 1100, 600], dur: .2, res: SMALL, a: .02, r: .1, g: .5, at: 1.0, sat: .2 })] },
  duck:     { loud: .9, level: 3.5, notes: [N({ f: [260, 280, 230], dur: .18, res: [[1500, 3, 1], [2600, 4, .4]], a: .01, r: .06, g: .8, trem: [24, .6], sat: .4, breath: .2, n: 3, gap: .28 })] },
  swan:     { loud: .8, level: 1.5, notes: [N({ src: "noise", dur: .7, res: [[2600, .8, 1]], a: .05, r: .2, g: .7 }), N({ f: [230, 240, 210], dur: .3, res: [[700, 3, 1], [1500, 4, .4]], a: .05, r: .1, g: .3, at: .8, sat: .3 })] },
  peacock:  { loud: 1.5, level: 0.74, notes: [N({ f: [1250, 1600, 900], dur: .8, res: [[1800, 3, 1], [3200, 4, .4]], a: .04, r: .2, g: .8, sat: .3, breath: .2 })] },
  frog:     { loud: .7, level: 3.5, notes: [N({ src: "pulse", f: [130, 140, 110], dur: .32, res: [[700, 2.5, 1], [1400, 3, .4]], a: .02, r: .08, g: .7, rough: 26, sat: .5, n: 3, gap: .38 })] },
  owl:      { loud: .9, level: 0.77, notes: [N({ src: "sine", f: [420, 400, 350], dur: .32, res: [[500, 1.5, 1]], a: .06, r: .12, g: .9, n: 2, gap: .42, breath: .06 }), N({ src: "sine", f: [400, 380, 330], dur: .55, res: [[500, 1.5, 1]], a: .06, r: .25, g: .9, at: 1.25, breath: .06 })] },   // (a hoot is nearly a pure tone, but a breathed one)
  eagle:    { loud: 1.3, level: 1.02, notes: [N({ f: [2300, 2000, 1500], dur: .55, res: [[2800, 2.5, 1], [4200, 3, .3]], a: .02, r: .15, g: .7, vib: [9, .04], sat: .2, breath: .25 })] },
  parrot:   { loud: 1.1, level: 1.43, notes: [N({ f: [900, 1500, 800], dur: .34, res: [[2000, 2.5, 1], [3400, 3, .25]], a: .01, r: .08, g: .8, rough: 50, sat: .4, breath: .3 })] },
  snake:    { loud: .5, level: 1.17, notes: [N({ src: "noise", dur: .9, res: [[4200, 1, 1]], a: .1, r: .3, g: .8 })] },
  rat:      { loud: .4, level: 0.8, notes: [N({ src: "sine", f: [3800, 5200, 4500], dur: .09, res: [[4500, 2, 1]], a: .005, r: .04, g: .8, n: 3, gap: .13 })] },
  crocodile:{ loud: 1.6, level: 2.57, notes: [N({ src: "pulse", f: [60, 65, 45], dur: 1.1, res: [[250, 2.5, 1], [600, 3, .4]], a: .1, r: .4, g: .9, rough: 22, sat: .8, breath: .3, sub: .5, jit: .08 })] },
  dragon:   { loud: 3, level: 1.93, notes: [...roar([62, 80, 42], 2.2, { rough: 16, sat: .9 }), N({ src: "noise", dur: 2.0, res: [[1800, .5, 1]], a: .3, r: .6, g: .15 })] },
  hydra:    { loud: 2.2, level: 1.45, notes: [N({ src: "noise", dur: .6, res: [[3800, 1, 1]], a: .05, r: .15, g: .55 }), ...roar([110, 130, 80], 1.2, { at: .5 })] },
};

const noiseBufs = new WeakMap();
const noiseBuffer = (ctx) => {
  if (!noiseBufs.has(ctx)) {
    const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBufs.set(ctx, b);
  }
  return noiseBufs.get(ctx);
};
const shapers = new Map();   // soft saturation curves by strength
const shaper = (ctx, sat) => {
  const k = Math.round(sat * 10);
  if (!shapers.has(k)) {
    const c = new Float32Array(1024), drive = 1 + 7 * k / 10;
    for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(x * drive) / Math.tanh(drive); }
    shapers.set(k, c);
  }
  const w = ctx.createWaveShaper(); w.curve = shapers.get(k); return w;
};

// An outdoor space: a light, dark-tailed reverb (a generated impulse) with
// a dry path. Feed calls into `input`; it goes to `dest` (default speakers).
export function makeSpace(ctx, { wet = .3, size = 1.3, dest } = {}) {
  const n = Math.ceil(ctx.sampleRate * size), ir = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c); let lp = 0;
    for (let i = 0; i < n; i++) { lp += (Math.random() * 2 - 1 - lp) * .25; d[i] = lp * Math.pow(1 - i / n, 2.2) * (i < 40 ? i / 40 : 1); }
  }
  const input = ctx.createGain(), conv = ctx.createConvolver(), wg = ctx.createGain(), dg = ctx.createGain();
  conv.buffer = ir; wg.gain.value = wet; dg.gain.value = 1;
  input.connect(dg); dg.connect(dest ?? ctx.destination);
  input.connect(conv); conv.connect(wg); wg.connect(dest ?? ctx.destination);
  return { input };
}

// play one species' call; `pitch` scales every frequency (an individual's
// size), `dest` is where it goes (default the speakers). Every call is a
// little different (pitch and timing vary a few percent). Returns the end time.
export function animalCall(ctx, species, { dest, at, pitch = 1, volume = .5 } = {}) {
  const rec = CALLS[species];
  if (!rec) return ctx.currentTime;
  const t0 = Math.max(at ?? ctx.currentTime + .02, ctx.currentTime + .01);
  // `level` (per recipe) is the measured make-up gain that brings every species' call to about the same
  // loudness at the source (-18 dB RMS while it sounds, at volume .5): a sheep's narrow mouth swallowed
  // 12 dB, a horse's broad one gave 7 dB back. `loud` then says how far each carries.
  const out = ctx.createGain(); out.gain.value = volume * (rec.level ?? 1); out.connect(dest ?? ctx.destination);
  const pv = pitch * (.95 + Math.random() * .1), dv = .93 + Math.random() * .14;
  let end = t0;
  for (const nt of rec.notes) { let tk = t0 + nt.at * dv; for (let k = 0; k < nt.n; k++) {
    // every repeat its own: a little shorter or longer, a shade higher or lower, the gap uneven (three barks
    // stamped from one die are a sound effect; a dog never barks the same bark twice)
    const pk = pv * (.96 + Math.random() * .08), dur = nt.dur * dv * (.93 + Math.random() * .14), ts = tk, te = ts + dur;
    tk = te + nt.gap * dv * (.85 + Math.random() * .3);
    let src;
    const mix = ctx.createGain();
    if (nt.src === "noise") { src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx); src.loop = true; src.connect(mix); }
    else {
      // "pulse" = a hard-driven sawtooth: a square wave has only odd harmonics, a hollow clarinet tone no animal makes
      src = ctx.createOscillator(); src.type = nt.src === "pulse" ? "sawtooth" : nt.src;
      const f = nt.f.length === 3 ? nt.f : [nt.f[0], (nt.f[0] + nt.f[1]) / 2, nt.f[1]];
      src.frequency.setValueAtTime(Math.max(20, f[0] * pk), ts);
      src.frequency.exponentialRampToValueAtTime(Math.max(20, f[1] * pk), ts + dur * .45);
      src.frequency.exponentialRampToValueAtTime(Math.max(20, f[2] * pk), te);
      if (nt.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = nt.vib[0] * (.92 + Math.random() * .16); lg.gain.value = f[0] * pk * nt.vib[1]; l.connect(lg); lg.connect(src.frequency); l.start(ts); l.stop(te + .01); }
      if (nt.jit) {   // pitch jitter: lowpassed noise shakes the frequency (fast) and wanders it (slow)
        // (white noise through a 22 Hz lowpass keeps ~.026 of its amplitude, through 3 Hz only ~.01: the
        // scale factors make the fast shake ~.4% and the slow wander ~1% RMS at jit .05 -- measured; the
        // wander was 10x too small before and every contour was the same smooth slide)
        for (const [cut, depth, k] of [[22, nt.jit, 3], [3, nt.jit * .6, 30]]) {
          const nz = ctx.createBufferSource(); nz.buffer = noiseBuffer(ctx); nz.loop = true;
          const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = cut;
          const jg = ctx.createGain(); jg.gain.value = f[1] * pk * depth * k;
          nz.connect(lp); lp.connect(jg); jg.connect(src.frequency); nz.start(ts); nz.stop(te + .02);
        }
      }
      if (nt.sub) {   // subharmonic: the voice pulses at half its own pitch
        const sg = ctx.createGain(); sg.gain.value = 1 - nt.sub * .5;
        const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.setValueAtTime(f[0] * pk / 2, ts);
        l.frequency.exponentialRampToValueAtTime(Math.max(10, f[2] * pk / 2), te); lg.gain.value = nt.sub * .5;
        l.connect(lg); lg.connect(sg.gain); l.start(ts); l.stop(te + .01);
        src.connect(sg); sg.connect(mix);
      } else src.connect(mix);
      if (nt.breath) { const nz = ctx.createBufferSource(); nz.buffer = noiseBuffer(ctx); nz.loop = true; const ng = ctx.createGain(); ng.gain.value = nt.breath; nz.connect(ng); ng.connect(mix); nz.start(ts); nz.stop(te + .02); }
    }
    let voice = mix;
    const sat = nt.src === "pulse" ? Math.min(1, nt.sat + .2) : nt.sat;
    if (sat) { const w = shaper(ctx, sat); mix.connect(w); voice = w; }
    if (nt.chaos && nt.src !== "noise") {   // loudness flicker: lowpassed noise wobbles the level
      const cg = ctx.createGain(); cg.gain.value = 1 - nt.chaos * .5;
      const nz = ctx.createBufferSource(); nz.buffer = noiseBuffer(ctx); nz.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 40;
      const fg = ctx.createGain(); fg.gain.value = nt.chaos * 2.5;
      nz.connect(lp); lp.connect(fg); fg.connect(cg.gain); nz.start(ts); nz.stop(te + .02);
      voice.connect(cg); voice = cg;
    }
    const env = ctx.createGain(); env.gain.setValueAtTime(0, ts);
    env.gain.linearRampToValueAtTime(nt.g, ts + nt.a);
    env.gain.setValueAtTime(nt.g, Math.max(ts + nt.a, te - nt.r));
    env.gain.linearRampToValueAtTime(0, te);
    nt.res.forEach(([fr, q, gn], ri) => {   // the mouth: parallel resonances, scaled a little with the individual's size
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = fr * Math.sqrt(pk); bp.Q.value = q;
      if (nt.res2) {   // vowel change: glide each resonance to its second shape
        bp.frequency.setValueAtTime(fr * Math.sqrt(pk), ts + dur * .3);
        bp.frequency.linearRampToValueAtTime(nt.res2[ri][0] * Math.sqrt(pk), te);
      }
      const bg = ctx.createGain(); bg.gain.value = gn;
      voice.connect(bp); bp.connect(bg); bg.connect(env);
    });
    let tail = env;
    const wob = nt.trem ?? (nt.rough ? [nt.rough, .55] : null);   // tremolo (bleat) or roughness (growl): the same wobble, faster
    if (wob) {
      const m = ctx.createGain(); m.gain.value = 1 - wob[1] / 2;
      const l = ctx.createOscillator(), lg = ctx.createGain(); l.type = wob[0] > 20 ? "square" : "sine"; l.frequency.value = wob[0]; lg.gain.value = wob[1] / 2;
      l.connect(lg); lg.connect(m.gain); l.start(ts); l.stop(te + .01);
      // the wobble's rate itself wanders ~15% (4 Hz lowpassed noise, RMS ~.011): a fixed-rate chop is a
      // motor, a growl's rattle and a bleat's flutter speed up and slow down
      const rn = ctx.createBufferSource(); rn.buffer = noiseBuffer(ctx); rn.loop = true;
      const rl = ctx.createBiquadFilter(); rl.type = "lowpass"; rl.frequency.value = 4;
      const rg = ctx.createGain(); rg.gain.value = wob[0] * 14;
      rn.connect(rl); rl.connect(rg); rg.connect(l.frequency); rn.start(ts); rn.stop(te + .02);
      env.connect(m); tail = m;
    }
    tail.connect(out);
    src.start(ts); src.stop(te + .02);
    end = Math.max(end, te);
  } }
  setTimeout(() => out.disconnect(), (end - ctx.currentTime + .3) * 1000);
  return end;
}
