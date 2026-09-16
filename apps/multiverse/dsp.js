// Shared DSP for the synthesized sound engines -- the one copy of the filters
// every engine uses (calls.js, speech.js, environment.js, instruments.js).
//
// All four engines work the same way: they RENDER offline, sample by sample,
// into a Float32Array at SR, and the result is played as an AudioBuffer (the
// context resamples it). Per-sample JS gives what a Web Audio node graph
// cannot: pitch-synchronous glottal pulses, jitter per cycle, formants that
// move every sample, Karplus-Strong strings, hundreds of rain drops. 32 kHz
// keeps everything the engines make (a bird's 7 kHz whistle and its octave,
// an /s/ peaking near 8 kHz) and costs a third less than 48 kHz.
//
//   const out = new Float32Array(n); ...; loudnorm(out);
//   play(ctx, toBuffer(out), { dest, at, rate })   -> { src, end }

export const SR = 32000;
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
export const rnd = Math.random;
export const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.63;   // ~unit-variance, cheap
export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// a breakpoint curve [[t, v], ...] (t 0..1 normalised time) read at t, linearly
export function contour(pts, t) {
  if (!pts || !pts.length) return 0;
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return lerp(a[1], b[1], (t - a[0]) / Math.max(1e-6, b[0] - a[0])); }
  return pts[pts.length - 1][1];
}

// ---- filters: small closures, set(...) then run(x) per sample -------------------
// Klatt two-pole resonator, unity gain at DC (what a formant cascade needs)
export function resonator() {
  let y1 = 0, y2 = 0, c = 0, r2 = 0;
  return {
    set(f, bw) { const r = Math.exp(-Math.PI * bw / SR); c = 2 * r * Math.cos(2 * Math.PI * clamp(f, 30, SR * .45) / SR); r2 = r * r; },
    run(x) { const y = x * (1 - c + r2) + c * y1 - r2 * y2; y2 = y1; y1 = y; return y; },
  };
}
// band-pass for noise: zeros at DC and Nyquist (lows and highs really gone),
// gain normalised to 1 at the centre; fMin is the lowest centre it accepts
export function bandpass(fMin = 20) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, c = 0, r2 = 0, g = 1;
  return {
    set(f, bw) {
      const r = Math.exp(-Math.PI * bw / SR), w = 2 * Math.PI * clamp(f, fMin, SR * .45) / SR; c = 2 * r * Math.cos(w); r2 = r * r;
      const num = Math.hypot(1 - Math.cos(2 * w), Math.sin(2 * w)), den = Math.hypot(1 - c * Math.cos(w) + r2 * Math.cos(2 * w), -c * Math.sin(w) + r2 * Math.sin(2 * w));
      g = den / Math.max(num, 1e-6);
    },
    run(x) { const y = (x - x2) * g + c * y1 - r2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; },
  };
}
// two-zero anti-resonator (the nasal zero), unity gain at DC
export function antiresonator() {
  let x1 = 0, x2 = 0, c = 0, r2 = 0, g = 1;
  return {
    set(f, bw) { const r = Math.exp(-Math.PI * bw / SR); c = 2 * r * Math.cos(2 * Math.PI * f / SR); r2 = r * r; g = 1 / (1 - c + r2); },
    run(x) { const y = (x - c * x1 + r2 * x2) * g; x2 = x1; x1 = x; return y; },
  };
}
export function lowpass() {   // one pole
  let y = 0, a = 0;
  return { set(fc) { a = Math.exp(-2 * Math.PI * clamp(fc, 5, SR * .45) / SR); }, run(x) { y = a * y + (1 - a) * x; return y; } };
}
export function highpass() { const lp = lowpass(); return { set(fc) { lp.set(fc); }, run(x) { return x - lp.run(x); } }; }
// -1..1, wandering smoothly at about rateHz (gusts, drifting centres)
export function slowRandom(rateHz) {
  let y = 0, target = 0, count = 0; const step = Math.max(1, Math.round(SR / rateHz)), a = Math.exp(-2 * Math.PI * rateHz / SR);
  return () => { if (count-- <= 0) { target = rnd() * 2 - 1; count = step; } y = a * y + (1 - a) * target; return y; };
}

// ---- buffers ------------------------------------------------------------------------
export function concat(parts) {
  const all = new Float32Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}
export function normalize(out, peak = .85) {
  let p = 1e-6; for (let i = 0; i < out.length; i++) p = Math.max(p, Math.abs(out[i]));
  for (let i = 0; i < out.length; i++) out[i] *= peak / p;
  return out;
}
// loudness, not peak: scale so the SOUNDING part (20 ms blocks within 20 dB of
// the loudest) has RMS `target`, then soft-limit with tanh. Peak normalising
// makes a click-train as loud as a moo and a roar with one spike quiet; this
// makes every call, bed and note the same loudness before the caller's gain.
export function soundingRms(out) {
  const B = Math.round(SR * .02), n = Math.max(1, Math.floor(out.length / B)), e = new Float32Array(n);
  let mx = 1e-12;
  for (let b = 0; b < n; b++) { let s = 0; for (let i = b * B; i < Math.min(out.length, (b + 1) * B); i++) s += out[i] * out[i]; e[b] = s / B; mx = Math.max(mx, e[b]); }
  let s = 0, c = 0; for (let b = 0; b < n; b++) if (e[b] > mx * .01) { s += e[b]; c++; }
  return Math.sqrt(c ? s / c : mx);
}
export function loudnorm(out, target = .2) {
  const g = target / soundingRms(out);
  for (let i = 0; i < out.length; i++) out[i] = Math.tanh(out[i] * g);
  return out;
}
// a seamless loop: `out` holds n + xf samples; its last xf are crossfaded
// (equal power) into its first xf, and the loop is the first n
export function fold(out, xf) {
  const n = out.length - xf;
  for (let i = 0; i < xf; i++) { const u = i / xf; out[i] = out[i] * Math.sin(u * Math.PI / 2) + out[n + i] * Math.cos(u * Math.PI / 2); }
  return out.subarray(0, n);
}
export function toBuffer(samples) {
  const b = new AudioBuffer({ length: Math.max(1, samples.length), sampleRate: SR, numberOfChannels: 1 });
  b.copyToChannel(samples, 0);
  return b;
}
// play a buffer once: `rate` scales pitch and speed together; returns the
// source and the end time (AC seconds); the source disconnects itself
export function play(ctx, buffer, { dest, at, rate = 1, gain = 1, loop = false, offset = 0 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = buffer; src.playbackRate.value = rate; src.loop = loop;
  let head = src;
  if (gain !== 1) { const g = ctx.createGain(); g.gain.value = gain; src.connect(g); head = g; }
  head.connect(dest ?? ctx.destination);
  const t0 = Math.max(at ?? ctx.currentTime + .02, ctx.currentTime + .005);
  src.start(t0, offset);
  src.onended = () => { src.disconnect(); if (head !== src) head.disconnect(); };
  return { src, end: t0 + buffer.duration / rate };
}
