// Environment sound -- weather, water, fire and unseen wildlife, synthesized.
//
// The environment lab's engine: no pitch and no vocal tract, just noise
// shaped by filters whose settings wander slowly or randomly, plus
// generators of random impacts (drops, crackles, stones), bubbles (plinks,
// brooks), breaking waves and thunder. A SCENE is a stack of such layers as
// a function of a few knobs (intensity, gust, surface...). Continuous
// scenes are rendered once into seamless loops (dsp.js fold) and
// crossfaded as the state changes: light and heavy rain on leaves outside,
// on the roof inside, puddles, soft and strong wind, surf, a brook, a
// hearth fire, crickets at night. Thunder is rendered as a one-shot. The
// wildlife on top -- songbirds by day, owls and a nightingale at night, a
// bee going by -- are calls.js WILD voices played at random places.
//
// Rendering is spread over frames: update() spends at most `budgetMs` per
// call on pending loops, and a loop starts (fading in) when it is ready;
// nothing is rendered until the state first needs it.
//
//   const env = createEnvironment(ctx, { dest });
//   every frame: env.update({ weather: "rain", intensity: .7, wind: .2,
//     night: false, inside: false, water: 30, river: 1e9, fire: 1e9 });
//   env.thunder(2)   // a thunderclap 2 km away (e.g. with a lightning flash)
//
// state: weather "clear" | "rain" | "snow"; intensity 0..1 (of the rain or
// snow); wind 0..1 (a breeze on top of what the weather brings); night;
// inside (under a roof: rain moves onto the roof, the outdoors is muffled);
// water / river / fire = metres to the lake shore, the river bank, the
// nearest hearth (omit or Infinity = none near).
//
// Supersedes in index.html: initAudio()'s noise beds (rainLow, rainHi,
// windGain/windFilter, waveGain), the rain plinks, snow wind and lake wash +
// crest tones in audioTick(), and chirp() with its nextChirp scheduling.
// (Crowd murmur, the church bells, speech and animal calls stay where they are.)

import { SR, clamp, lerp, rnd, gauss, bandpass, lowpass, highpass, slowRandom, loudnorm, normalize, fold, toBuffer } from "./dsp.js";
import { animalCall, renderCall } from "./calls.js";
const MOSQUITO = false;   // the mosquito's whine near water at night: switched off (its voice is kept in calls.js WILD)

const mix = (a, b, I) => lerp(a, b, clamp(I, 0, 1));
const NZ = Math.round(SR * .0009);   // an impact's noisy onset, ~1 ms

// ============================================================================
// layer generators: each returns a function producing the next sample
// ============================================================================
const GEN = {
  // filtered noise with a slowly wandering centre and a gusting level
  band(L) {
    const bp = bandpass(20), wander = slowRandom(L.wanderRate || .3), gust = slowRandom(L.gustRate || .2);
    let i = 0;
    return () => {
      if ((i & 63) === 0) { const w = wander(); bp.set(L.f * (1 + (L.wander || 0) * w), L.bw * (1 + .3 * w)); }
      const g = L.gain * (1 + (L.gust || 0) * gust()) * (L.amRate ? 1 - (L.amDepth || .5) * (.5 + .5 * Math.cos(2 * Math.PI * L.amRate * i / SR)) : 1);
      i++; return bp.run(rnd() * 2 - 1) * g;
    };
  },
  // random impacts (drops, crackles, rattles): Poisson-timed clicks through per-voice resonators
  impacts(L) {
    const voices = Array.from({ length: 48 }, () => ({ t: -1, bp: bandpass(20), env: 0, f: 1000, gain: 1, chirp: 0 }));
    const dec = Math.exp(-1 / (L.decayMs / 1000 * SR));
    let v = 0, i = 0, next = rnd() * SR / L.rate;
    return () => {
      if (i >= next) {
        const vo = voices[v++ % voices.length];
        vo.t = 0; vo.f = L.f * Math.pow(2, (L.spread || 0) / 12 * gauss() * .5); vo.gain = L.gain * (.5 + .5 * rnd()) * (1 + (L.loudSpread || 0) * gauss());
        vo.env = 1; vo.chirp = L.chirp || 0; next = i + SR / L.rate * (.3 + 1.4 * rnd());
      }
      let s = 0;
      for (const vo of voices) {
        if (vo.t < 0) continue;
        const x = vo.t === 0 ? 1 : vo.t < NZ ? (rnd() * 2 - 1) * .4 : 0;
        if (vo.t === 0 || (vo.chirp && (vo.t & 15) === 0)) vo.bp.set(vo.f * Math.pow(2, vo.chirp / 12 * Math.min(1, vo.t / (.05 * SR))), L.bw);
        s += vo.bp.run(x) * vo.env * vo.gain * 6; vo.env *= dec; vo.t++;
        if (vo.env < .002) vo.t = -1;
      }
      i++; return s;
    };
  },
  // bubbles: short sine chirps rising in pitch (streams, puddles, gutter drips)
  chirps(L) {
    const voices = Array.from({ length: 24 }, () => ({ t: -1, f: 0, ph: 0, dur: 1, gain: 1 }));
    let v = 0, i = 0, next = rnd() * SR / L.rate;
    return () => {
      if (i >= next) {
        const vo = voices[v++ % voices.length];
        vo.t = 0; vo.f = mix(L.fMin, L.fMax, rnd()); vo.dur = L.durMs / 1000 * SR * (.6 + .8 * rnd()); vo.gain = L.gain * (.4 + .6 * rnd()); vo.ph = 0;
        next = i + SR / L.rate * (.2 + 1.6 * rnd());
      }
      let s = 0;
      for (const vo of voices) {
        if (vo.t < 0) continue;
        const u = vo.t / vo.dur; if (u >= 1) { vo.t = -1; continue; }
        vo.ph += vo.f * Math.pow(2, (L.rise || 5) / 12 * u) / SR;
        s += Math.sin(2 * Math.PI * vo.ph) * vo.gain * Math.sin(Math.PI * u) * Math.exp(-3 * u); vo.t++;
      }
      i++; return s;
    };
  },
  // one wave after another: a swell of low noise, a bright break, then foam draining with a falling cutoff
  wave(L) {
    const lp = lowpass(), hp = highpass(), tex = bandpass(20), per = () => L.period * SR * (1 + (L.spread || .25) * gauss() * .5);
    let i = 0, cycStart = -rnd() * L.period * SR, period = per(), strength = 1;
    return () => {
      let u = (i - cycStart) / period;
      if (u >= 1) { cycStart = i; period = per(); strength = .5 + .5 * rnd() + L.intensity * .5; u = 0; }
      const swell = Math.pow(clamp(u / .55, 0, 1), 2.2), brk = Math.exp(-Math.pow((u - .58) / .06, 2)), foam = u > .58 ? Math.exp(-(u - .58) / (.22 + .15 * L.intensity)) : 0;
      if ((i & 63) === 0) { lp.set(120 + 600 * swell * L.intensity + 3000 * brk); hp.set(1500 + 1500 * foam); tex.set(2500 + 2500 * L.intensity, 2000); }
      const n = rnd() * 2 - 1; i++;
      return (lp.run(n) * (.6 * swell + 1.5 * brk) * 2.5 + hp.run(n) * foam * .5 * (.6 + .8 * L.intensity) + tex.run(n) * brk * .5 * L.intensity) * L.gain * strength;
    };
  },
  // thunder: a sharp crack, a tearing rip sweeping down, then overlapping low peals with echoes and a
  // falling cutoff; soft-saturated so the rumble sits loud beside the crack instead of being normalised away
  thunder(L) {
    const start = Math.round((L.at || .3) * SR), far = clamp(L.distanceKm / 8, 0, 1), rumble = L.rumbleSec * SR, echoes = Math.round(L.echoes || 3);
    const lpCrack = lowpass(), bpTear = bandpass(20), lpRum = lowpass(), lpRum2 = lowpass(), lpSub = lowpass(), mod = slowRandom(3 + 3 * rnd()), mod2 = slowRandom(.6), tearAm = slowRandom(35);
    const tearLen = (.35 + .6 * (1 - far)) * SR, crackLen = .045 * SR;
    const peals = Array.from({ length: 3 + echoes }, (_, k) => ({ at: (k === 0 ? .05 : .2 + .6 * rnd()) * rumble, gain: k === 0 ? 1 : .35 + .5 * rnd(), dec: (.9 + 1.6 * rnd()) * SR * (.7 + far * .8), att: (.08 + .25 * rnd()) * SR }));
    let i = 0;
    return () => {
      if (i < start) { i++; return 0; }
      const t = i - start, n = rnd() * 2 - 1, u = t / rumble;
      if ((i & 31) === 0) {
        lpCrack.set(mix(6000, 800, far)); bpTear.set(mix(3500, 900, far) * Math.exp(-t / tearLen * 2.2) + 150, 700);
        const fr = mix(260, 100, far) * Math.max(.35, 1 - u * .8) + 35; lpRum.set(fr); lpRum2.set(fr * 1.5); lpSub.set(70);
      }
      let s = 0;
      if (t < crackLen) s += lpCrack.run(n) * Math.exp(-t / (.012 * SR)) * 4 * (1 - far * .9);                            // crack
      if (t < tearLen) s += bpTear.run(n) * (.6 + .4 * tearAm()) * Math.exp(-t / tearLen * 1.5) * 2.2 * (1 - far * .7);   // tearing rip
      let env = 0;
      for (const p of peals) { const te = t - p.at; if (te > 0) env += p.gain * Math.min(1, te / p.att) * Math.exp(-te / p.dec); }
      for (let e = 1; e <= echoes; e++) { const te = t - e * (.45 + .3 * e) * SR * (.6 + far); if (te > 0) env += Math.pow(.5, e) * Math.min(1, te / (.2 * SR)) * Math.exp(-te / (rumble * .6)); }
      const rum = lpRum2.run(lpRum.run(n)) * env * (.55 + .45 * mod()) * (.75 + .25 * mod2()) * 1.6;   // two poles: real rumble has almost nothing above 300 Hz
      s += rum * 7 + lpSub.run(rum) * 6;                                                             // rumble + sub-bass
      i++; return Math.tanh(s * .9) * L.gain * .85;
    };
  },
  // sparse pops (fire crackle, shingle rattle)
  crackle: (L) => GEN.impacts({ rate: L.rate, decayMs: L.decayMs || 6, f: L.f || 3000, spread: L.spread || 18, bw: L.bw || 2500, gain: L.gain, loudSpread: .6 }),
};

// ============================================================================
// SCENES: layers as a function of knobs (the lab's presets), and the knobs' defaults
// ============================================================================
const R = (I, a, b) => mix(a, b, I);
export const SCENES = {
  // countless tiny high drops on foliage, the hiss they merge into, a faint low rumble, gusts over all
  rain: (p) => [{ type: "impacts", rate: R(p.intensity, 12, 500), decayMs: R(p.surface, 30, 10), f: R(p.surface, 1800, 4500), spread: 14, bw: 1800, gain: .5 },
    { type: "band", f: R(p.surface, 3000, 5500), bw: 4000, gain: R(p.intensity, .05, .6) * p.intensity, wander: .1, gust: p.gust, gustRate: .25 },
    { type: "band", f: 250, bw: 350, gain: R(p.intensity, .02, .25), wander: .2, gust: p.gust * .7 }],
  // lower, rounder impacts on a taut roof, gutter drips, a hiss
  roof: (p) => [{ type: "impacts", rate: R(p.intensity, 8, 350), decayMs: 28, f: 900, spread: 10, bw: 700, gain: .7 },
    { type: "band", f: 2500, bw: 3000, gain: R(p.intensity, .03, .45) * p.intensity, gust: p.gust, gustRate: .3 },
    { type: "chirps", rate: R(p.drips, .2, 4), fMin: 2200, fMax: 3600, durMs: 70, rise: 6, gain: .35 * p.drips }],
  // sharp ticks on glass, a hiss, squalls against the pane
  window: (p) => [{ type: "impacts", rate: R(p.intensity, 6, 220), decayMs: 5, f: 2800, spread: 12, bw: 3000, gain: .6 },
    { type: "band", f: 4000, bw: 4000, gain: R(p.intensity, .02, .35) * p.intensity, gust: p.gust, gustRate: .35 }],
  // drops into standing water: rising plinks over a rain hiss
  puddles: (p) => [{ type: "chirps", rate: R(p.intensity, 3, 60), fMin: 1400, fMax: 3200, durMs: 55, rise: 7, gain: .5 },
    { type: "band", f: 4500, bw: 4000, gain: R(p.intensity, .05, .4) * p.intensity, gust: .2 }],
  // a sandy beach: two overlapping wave cycles with random periods and a low sea swell
  waves: (p) => [{ type: "wave", period: p.period, spread: .25, intensity: p.intensity, gain: 1 }, { type: "wave", period: p.period * 1.3, spread: .3, intensity: p.intensity, gain: .6 },
    { type: "band", f: 120, bw: 200, gain: R(p.intensity, .05, .35), wander: .3, wanderRate: .1, gust: .5, gustRate: .08 }],
  // a shingle beach: the same, plus stones rattling in the backwash
  shingle: (p) => [{ type: "wave", period: p.period, spread: .25, intensity: p.intensity, gain: 1 }, { type: "wave", period: p.period * 1.4, spread: .3, intensity: p.intensity, gain: .5 },
    { type: "impacts", rate: R(p.intensity, 15, 120), decayMs: 18, f: 1100, spread: 14, bw: 900, gain: .25 }, { type: "band", f: 120, bw: 200, gain: .15, wander: .3, wanderRate: .1, gust: .5, gustRate: .08 }],
  thunder: (p) => [{ type: "thunder", distanceKm: p.distanceKm, rumbleSec: p.rumbleSec, echoes: p.echoes, at: p.at, gain: 1 }],
  // broad noise, its centre wandering and its level gusting; a thin whistle through gaps when strong
  wind: (p) => [{ type: "band", f: R(p.intensity, 250, 700), bw: R(p.intensity, 300, 900), gain: R(p.intensity, .3, 1), wander: .6, wanderRate: .25, gust: R(p.intensity, .4, .9), gustRate: .2 },
    { type: "band", f: 120, bw: 150, gain: R(p.intensity, .1, .5), wander: .3, gust: .6, gustRate: .15 },
    { type: "band", f: R(p.intensity, 1400, 2200), bw: 40, gain: .25 * p.whistle * p.intensity, wander: .15, wanderRate: .6, gust: 1, gustRate: .4 }],
  // a soft low roar, a hiss, sparse crackles and a few deeper pops
  fire: (p) => [{ type: "band", f: 160, bw: 220, gain: R(p.intensity, .15, .6), wander: .4, wanderRate: .4, gust: .5, gustRate: .5 },
    { type: "band", f: 3500, bw: 4000, gain: R(p.intensity, .03, .2), gust: .5, gustRate: .7 },
    { type: "crackle", rate: R(p.intensity, 3, 40), decayMs: 6, f: 3200, spread: 20, bw: 2500, gain: R(p.intensity, .3, .8) },
    { type: "crackle", rate: R(p.intensity, .5, 6), decayMs: 25, f: 700, spread: 8, bw: 600, gain: .5 }],
  // water over stones: broad splashing, dozens of rising bubbles a second, a low gurgle
  brook: (p) => [{ type: "chirps", rate: R(p.intensity, 15, 90), fMin: 700, fMax: 3500, durMs: 45, rise: 8, gain: .35 },
    { type: "band", f: R(p.intensity, 1200, 2200), bw: 3000, gain: R(p.intensity, .3, .9), wander: .2, wanderRate: .8, gust: .4, gustRate: .6 },
    { type: "band", f: 200, bw: 250, gain: R(p.intensity, .1, .4), wander: .3, wanderRate: .5, gust: .5, gustRate: .4 }],
  // heavy rain, strong wind and a thunderclap together
  storm: (p) => [{ type: "impacts", rate: R(p.intensity, 60, 500), decayMs: 14, f: 3000, spread: 14, bw: 2500, gain: .35 },
    { type: "band", f: 4500, bw: 4000, gain: R(p.intensity, .2, .6), gust: .5, gustRate: .3 },
    { type: "band", f: R(p.intensity, 300, 700), bw: 800, gain: R(p.intensity, .4, 1), wander: .6, wanderRate: .25, gust: .9, gustRate: .2 },
    { type: "thunder", distanceKm: p.distanceKm, rumbleSec: 7, echoes: 3, at: 1.2, gain: 1.2 }],
};
const KNOBS = { rain: { intensity: .5, gust: .3, surface: .7 }, roof: { intensity: .5, gust: .3, drips: .4 }, window: { intensity: .5, gust: .6 }, puddles: { intensity: .4 },
  waves: { intensity: .4, period: 8 }, shingle: { intensity: .4, period: 7 }, thunder: { distanceKm: 1, rumbleSec: 7, echoes: 3, at: .3 }, wind: { intensity: .5, whistle: .3 },
  fire: { intensity: .5 }, brook: { intensity: .5 }, storm: { intensity: .8, distanceKm: 1.5 } };

// a render job: fills `sec` seconds of a scene in slices; step(deadline) returns true when done
function sceneJob(scene, knobs, sec, done) {
  const gens = SCENES[scene]({ ...KNOBS[scene], ...knobs }).map((L) => GEN[L.type](L)), N = Math.round(sec * SR), out = new Float32Array(N);
  let i = 0;
  return { step(deadline) {
    while (i < N) {
      for (const e = Math.min(N, i + 1024); i < e; i++) { let s = 0; for (const g of gens) s += g(); out[i] = s; }
      if (performance.now() > deadline) return false;
    }
    done(out); return true;
  } };
}
// render a scene at once (tests, benches): raw samples, not normalised
export function renderScene(name, knobs = {}, sec = 8) { let r; sceneJob(name, knobs, sec, (o) => { r = o; }).step(Infinity); return r; }

// ============================================================================
// the live environment
// ============================================================================
const XF = .6;   // loop crossfade, seconds
// the looping beds: a scene (or a WILD call) at fixed knobs; `bus` outdoor = muffled under a roof
const BEDS = {
  rainLight:  { scene: "rain", knobs: { intensity: .22, gust: .25 }, sec: 7, bus: "out" },
  rainHeavy:  { scene: "rain", knobs: { intensity: .9, gust: .5 }, sec: 7, bus: "out" },
  roofLight:  { scene: "roof", knobs: { intensity: .22, drips: .5 }, sec: 7, bus: "in" },
  roofHeavy:  { scene: "roof", knobs: { intensity: .9, drips: .3 }, sec: 7, bus: "in" },
  puddles:    { scene: "puddles", knobs: { intensity: .5 }, sec: 7, bus: "out" },
  waves:      { scene: "waves", knobs: { intensity: .35, period: 8 }, sec: 17, bus: "out" },
  brook:      { scene: "brook", knobs: { intensity: .45 }, sec: 8, bus: "out" },
  fire:       { scene: "fire", knobs: { intensity: .45 }, sec: 8, bus: "in" },   // hearths are indoors: never muffled
  bees:       { call: "honeybee", knobs: { dur: 8 + XF, chorus: 5, chorusSpread: 15, flyby: 0 }, sec: 8, bus: "out" },   // the hum round the hives
  crickets:   { call: "cricket", knobs: { dur: 8 + XF, chorus: 4, chorusSpread: 10 }, sec: 8, bus: "out" },
};
const DAY_BIRDS = ["blackbird", "blackbird", "robin", "robin", "greattit", "greattit", "chaffinch", "chaffinch", "woodpigeon", "starling", "cuckoo", "crow", "raven", "yaffle", "drumming"];
const DAY_BUGS = ["honeybee", "bumblebee", "grasshopper"], NIGHT_VOICES = ["tawnyowl", "tawnyowl", "barnowl", "nightingale", "nightingale"];
const pick = (a) => a[Math.floor(rnd() * a.length)];

export function createEnvironment(ctx, { dest, volume = .6, budgetMs = 3 } = {}) {
  const master = ctx.createGain(); master.gain.value = volume; master.connect(dest ?? ctx.destination);
  // the outdoors goes through a "wall": under a roof it is low-passed and quieter
  const muffle = ctx.createBiquadFilter(); muffle.type = "lowpass"; muffle.frequency.value = 16000; muffle.Q.value = .5;
  const outdoor = ctx.createGain(); outdoor.connect(muffle); muffle.connect(master);
  const jobs = [], beds = {};
  for (const [k, def] of Object.entries(BEDS)) {
    const g = ctx.createGain(); g.gain.value = 0; g.connect(def.bus === "out" ? outdoor : master);
    beds[k] = { def, g, state: "idle", level: 0, srcs: [] };
  }
  const startBed = (b, samples) => {   // two reads of one loop, half a loop apart, left and right: stereo width for free
    const buf = toBuffer(samples);
    for (const [pan, off] of [[-.6, 0], [.6, buf.duration / 2]]) {
      const src = ctx.createBufferSource(), p = ctx.createStereoPanner(); src.buffer = buf; src.loop = true; p.pan.value = pan;
      src.connect(p); p.connect(b.g); src.start(ctx.currentTime + .05, off); b.srcs.push(src);
    }
    b.state = "ready";
  };
  const want = (b) => {   // queue a bed's render the first time it is needed
    if (b.state !== "idle") return;
    b.state = "queued";
    const finish = (raw) => startBed(b, fold(loudnorm(raw, .2), Math.round(XF * SR)));
    if (b.def.call) jobs.push({ step() { finish(renderCall(b.def.call, b.def.knobs)); return true; } });
    else jobs.push(sceneJob(b.def.scene, b.def.knobs, b.def.sec + XF, finish));
  };
  // thunder: one clap rendered ahead, played when its time comes
  let thunderBuf = null, thunderQueued = false, nextThunder = Infinity, thunderDist = 3;
  const queueThunder = (km) => {
    if (thunderQueued) return; thunderQueued = true; thunderDist = km;
    const rumbleSec = 4 + 4 * rnd();
    jobs.push(sceneJob("thunder", { distanceKm: km, rumbleSec, echoes: 2 + Math.round(rnd() * 3), at: .1 }, rumbleSec * 1.6 + 2, (o) => { thunderBuf = toBuffer(normalize(o, .9)); thunderQueued = false; }));
  };
  const playThunder = () => {
    const g = ctx.createGain(); g.gain.value = .9 * clamp(1.1 - thunderDist / 10, .25, 1); g.connect(outdoor);
    const src = ctx.createBufferSource(); src.buffer = thunderBuf; src.connect(g); src.start();
    src.onended = () => { src.disconnect(); g.disconnect(); };
    thunderBuf = null;
  };
  const shot = (name, vol) => {   // one wildlife voice from a random direction
    const p = ctx.createStereoPanner(); p.pan.value = (rnd() * 2 - 1) * .85; p.connect(outdoor);
    const end = animalCall(ctx, name, { dest: p, volume: vol, pitch: .97 + rnd() * .06 });
    setTimeout(() => p.disconnect(), (end - ctx.currentTime + .5) * 1000);
  };
  let lastLevels = -1, nextBird = 0, nextBug = 0, nextNight = 0, forced = null;
  const set = (b, v) => {   // a bed's level, smoothed; a bed renders the first time it is audible
    if (v > .001) want(b);
    if (Math.abs(v - b.level) < .003) return;
    b.level = v; b.g.gain.setTargetAtTime(v, ctx.currentTime, .6);
  };

  function update(s = {}) {
    const now = ctx.currentTime;
    // render pending loops within the frame budget
    const deadline = performance.now() + budgetMs;
    while (jobs.length && performance.now() < deadline) if (jobs[0].step(deadline)) jobs.shift();
    if (thunderBuf && forced !== null) { playThunder(); forced = null; }
    if (now - lastLevels < .25) return;   // levels at 4 Hz: every setTargetAtTime is an automation event
    lastLevels = now;
    const I = clamp(s.intensity ?? .5, 0, 1), rain = s.weather === "rain", snow = s.weather === "snow", inside = !!s.inside, night = !!s.night;
    const near = (d, r) => clamp(1 - (d ?? Infinity) / r, 0, 1);
    muffle.frequency.setTargetAtTime(inside ? 700 : 16000, now, .15);
    outdoor.gain.setTargetAtTime(inside ? .45 : 1, now, .15);
    // rain: light and heavy crossfade by intensity; on the leaves outside, on the roof under one
    const rl = rain ? Math.cos(I * Math.PI / 2) * (.25 + .25 * I) : 0, rh = rain ? Math.sin(I * Math.PI / 2) * (.25 + .25 * I) : 0;
    set(beds.rainLight, rl * (inside ? .25 : 1)); set(beds.rainHeavy, rh * (inside ? .25 : 1));
    set(beds.roofLight, inside ? rl * 1.2 : 0); set(beds.roofHeavy, inside ? rh * 1.2 : 0);
    set(beds.puddles, rain && !inside ? .18 * I : 0);
    // (no wind bed: the demo runs without wind -- the scene recipe stays in SCENES for other hosts)
    // water and fire by distance
    // (the village lives on the river bank: the water stays a quiet background, rising only right at the edge)
    set(beds.waves, .22 * near(s.water, 45) ** 2); set(beds.brook, .1 * near(s.river, 25) ** 2); set(beds.fire, .15 * near(s.fire, 12));   // a hearth crackles softly
    set(beds.crickets, night && !rain && !snow ? .12 : 0);
    set(beds.bees, !night && !rain && !snow ? .5 * near(s.hives, 16) : 0);   // bees at their hives, by day in dry weather (s.hives: metres to the nearest)
    // thunder in heavy rain: one rendered ahead, a clap every 25-80 s
    if (rain && I > .5) {
      if (!thunderBuf) queueThunder(.8 + rnd() * 6);
      if (nextThunder === Infinity) nextThunder = now + 8 + rnd() * 15;
      if (now > nextThunder && thunderBuf) { playThunder(); nextThunder = now + (25 + rnd() * 55) / I; }
    } else nextThunder = Infinity;
    // wildlife: songbirds by day (fewer in snow, none in heavy rain), bees in fair weather, owls and the nightingale at night
    const fair = !rain && !snow, calm = !rain || I < .4;
    if (!night && calm && now > nextBird) { nextBird = now + (3 + rnd() * 7) * (snow ? 3 : rain ? 2 : 1); shot(pick(DAY_BIRDS), .12 + rnd() * .25); }
    if (!night && fair && now > nextBug) { if (nextBug) shot(pick(DAY_BUGS), .15 + rnd() * .15); nextBug = now + 30 + rnd() * 60; }
    if (night && calm && now > nextNight) { if (nextNight) shot(pick(NIGHT_VOICES), .12 + rnd() * .2); nextNight = now + 15 + rnd() * 35; }
    if (MOSQUITO && night && fair && near(s.water, 20) > 0 && rnd() < .01) shot("mosquito", .1);   // (off: see MOSQUITO)
  }
  return {
    update,
    thunder(km = 2) { queueThunder(km); forced = km; },   // plays as soon as it is rendered
    node: master,
    get pending() { return jobs.length; },
    get levels() { return Object.fromEntries(Object.entries(beds).map(([k, b]) => [k, `${b.state} ${b.level.toFixed(3)}`])); },   // debugging: each bed's state and level
    stop() { for (const b of Object.values(beds)) for (const src of b.srcs) try { src.stop(); } catch (e) { /* not started */ } master.disconnect(); },
  };
}
