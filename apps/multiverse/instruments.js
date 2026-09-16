// Musical instruments and songs, synthesized -- the village bard's repertoire.
//
// From the instruments lab: songs are public-domain pieces in ABC notation
// (parsed into note events: time, pitch, velocity, duration, voice), and
// every note is rendered offline by one of four physical-ish engines
// (dsp.js samples, played as AudioBuffers):
//   pluck  -- Karplus-Strong string: tuned fractional delay, loop low-pass,
//             pluck-position comb, two detuned strings (courses), a body
//   piano  -- additive stiff string: inharmonic partials, per-partial
//             two-stage decay, velocity brightness, hammer thump, soundboard
//   flute  -- near-sine with breath noise around the pitch, attack chiff,
//             vibrato after a delay
//   violin -- band-limited bowed sawtooth through body resonances, slow
//             attack, vibrato, bow noise
// Any song plays on any instrument: a polyphonic one (strings, keys) plays
// every voice, a melodic one (flute, fiddle) the tune alone; each voice is
// moved by octaves into the instrument's range.
//
//   const s = playSong(ctx, { instrument: "lute", song: "greensleeves", dest });
//   s.end -> AC time the last note dies away; s.stop() fades it out now
//   INSTRUMENTS -> the instrument keys, SONGS -> the song keys

import { SR, clamp, lerp, rnd, midiHz, resonator, lowpass, soundingRms, toBuffer, play } from "./dsp.js";

// ============================================================================
// ABC (subset): headers X T M L Q K, voices V:, notes with ^ _ = accidentals,
// ' and , octaves, lengths (2, /2, 3/2), z rests, [chords], | bars
// ============================================================================
const KEY_ACC = { C: {}, G: { F: 1 }, D: { F: 1, C: 1 }, A: { F: 1, C: 1, G: 1 }, E: { F: 1, C: 1, G: 1, D: 1 }, F: { B: -1 }, Bb: { B: -1, E: -1 }, Eb: { B: -1, E: -1, A: -1 },
  Am: {}, Em: { F: 1 }, Bm: { F: 1, C: 1 }, Dm: { B: -1 }, Gm: { B: -1, E: -1 }, Cm: { B: -1, E: -1, A: -1 } };
const NOTE_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function parseABC(text) {
  const hdr = { L: 1 / 8, Q: 120, K: "C", M: "4/4" }, voices = {}, events = [];
  let cur = "1", inBody = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/%.*$/, "").trim(); if (!line) continue;
    const m = line.match(/^([A-Za-z]):\s*(.*)$/);
    if (m && (!inBody || /^[VKLQM]$/.test(m[1]))) {
      const [, k, v] = m;
      if (k === "L") { const [a, b] = v.split("/").map(Number); hdr.L = a / b; }
      else if (k === "Q") { const q = v.match(/(?:(\d+)\/(\d+)\s*=\s*)?(\d+)/); if (q) { hdr.Q = +q[3]; hdr.Qunit = q[1] ? +q[1] / +q[2] : 1 / 4; } }
      else if (k === "K") { hdr.K = v.trim(); inBody = true; }
      else if (k === "M") hdr.M = v;
      else if (k === "V") { cur = v.trim().split(/\s/)[0]; voices[cur] ||= { t: 0 }; }
      continue;
    }
    if (!inBody) continue;
    const vo = (voices[cur] ||= { t: 0 }), acc = { ...(KEY_ACC[hdr.K] || {}) }, barAcc = {};
    const beat = 60 / hdr.Q * (1 / 4) / (hdr.Qunit || 1 / 4);   // seconds per quarter note
    const unit = hdr.L * 4 * beat;                               // seconds per default note length
    let i = 0;
    const readNote = () => {
      let a = 0;
      while ("^_=".includes(line[i])) { a += line[i] === "^" ? 1 : line[i] === "_" ? -1 : 0; if (line[i] === "=") a = 100; i++; }
      const ch = line[i]; if (!/[A-Ga-g]/.test(ch || "")) return null; i++;
      let pitch = NOTE_BASE[ch.toUpperCase()] + (ch === ch.toLowerCase() ? 72 : 60);
      while (line[i] === "'") { pitch += 12; i++; } while (line[i] === ",") { pitch -= 12; i++; }
      const letter = ch.toUpperCase();
      if (a === 100) { barAcc[letter] = 0; a = 0; } else if (a !== 0) barAcc[letter] = a; else a = barAcc[letter] ?? (acc[letter] || 0);
      return pitch + a;
    };
    const readDur = () => {
      let num = 1, den = 1; const n = line.slice(i).match(/^(\d+)?(\/+)?(\d+)?/);
      if (n && n[0]) { if (n[1]) num = +n[1]; if (n[2]) den = n[3] ? +n[3] : Math.pow(2, n[2].length); i += n[0].length; }
      return num / den;
    };
    while (i < line.length) {
      const ch = line[i];
      if (ch === " ") { i++; continue; }
      if (ch === "|" || ch === ":" || ch === "]" && line[i - 1] === "|") { i++; for (const k in barAcc) delete barAcc[k]; continue; }
      if (ch === "z" || ch === "x") { i++; vo.t += readDur() * unit; continue; }
      if (ch === "[") { i++; const ps = []; let p; while ((p = readNote()) !== null) ps.push(p); if (line[i] === "]") i++; const d = readDur() * unit; for (const pp of ps) events.push({ t: vo.t, pitch: pp, vel: .8, dur: d, voice: cur }); vo.t += d; continue; }
      if ("()-~!\"".includes(ch)) { if (ch === "\"") { const j = line.indexOf("\"", i + 1); i = j < 0 ? line.length : j + 1; } else i++; continue; }
      const p = readNote(); if (p === null) { i++; continue; }
      const d = readDur() * unit; events.push({ t: vo.t, pitch: p, vel: .8, dur: d * .95, voice: cur }); vo.t += d;
    }
  }
  return { events, voices: Object.keys(voices).length ? Object.keys(voices) : ["1"] };
}

// ============================================================================
// SONGS (public domain; short excerpts / simple two-voice arrangements)
// ============================================================================
const SONG_DEFS = {
  twinkle: { title: "Twinkle, Twinkle, Little Star (trad.)", abc: `M:4/4
L:1/4
Q:1/4=104
K:C
V:1
C C G G | A A G2 | F F E E | D D C2 | G G F F | E E D2 | G G F F | E E D2 | C C G G | A A G2 | F F E E | D D C2 |
V:2
C,2 E,2 | F,2 E,2 | D,2 C,2 | G,2 C,2 | C,2 B,,2 | C,2 G,,2 | C,2 B,,2 | C,2 G,,2 | C,2 E,2 | F,2 E,2 | D,2 C,2 | G,2 C,2 |` },
  odetojoy: { title: "Ode to Joy (Beethoven, 1824)", abc: `M:4/4
L:1/4
Q:1/4=112
K:C
V:1
E E F G | G F E D | C C D E | E3/2 D/2 D2 | E E F G | G F E D | C C D E | D3/2 C/2 C2 |
D D E C | D E/2F/2 E C | D E/2F/2 E D | C D G,2 | E E F G | G F E D | C C D E | D3/2 C/2 C2 |
V:2
C,2 G,2 | C,2 G,,2 | C,2 G,2 | C,2 G,,2 | C,2 G,2 | C,2 G,,2 | C,2 G,2 | G,,2 C,2 |
G,,2 C,2 | G,,2 C,2 | G,,2 C,2 | G,,2 G,,2 | C,2 G,2 | C,2 G,,2 | C,2 G,2 | G,,2 C,2 |` },
  minuet: { title: "Minuet in G (Petzold, c. 1725)", abc: `M:3/4
L:1/8
Q:1/4=120
K:G
V:1
d2 GABc | d2 G2 G2 | e2 cdef | g2 G2 G2 | c2 dcBA | B2 cBAG | F2 GABG | A4 z2 |
d2 GABc | d2 G2 G2 | e2 cdef | g2 G2 G2 | c2 dcBA | B2 cBAG | A2 BAGF | G4 z2 |
V:2
G,4 B,2 | A,4 F,2 | C,4 E,2 | B,,4 D,2 | E,4 A,2 | G,2 B,2 D,2 | D,2 D,2 F,2 | D,4 z2 |
G,4 B,2 | A,4 F,2 | C,4 E,2 | B,,4 D,2 | E,4 A,2 | G,2 B,2 D,2 | D,2 D,2 F,2 | G,4 z2 |` },
  furelise: { title: "Für Elise, opening (Beethoven, 1810)", abc: `M:3/8
L:1/16
Q:1/8=140
K:Am
V:1
e^d | e^de^deBdc | A2 z CEA | B2 z E^GB | c2 z Ee^d | e^de^deBdc | A2 z CEA | B2 z EcB | A2 z2 e^d |
e^de^deBdc | A2 z CEA | B2 z E^GB | c2 z Ee^d | e^de^deBdc | A2 z CEA | B2 z EcB | A4 z2 |
V:2
z2 | z6 | A,,E,A, z3 | E,,E,^G, z3 | A,,E,A, z3 | z6 | A,,E,A, z3 | E,,E,^G, z3 | A,,E,A, z3 |
z6 | A,,E,A, z3 | E,,E,^G, z3 | A,,E,A, z3 | z6 | A,,E,A, z3 | E,,E,^G, z3 | A,,4 z2 |` },
  prelude: { title: "Prelude in C, BWV 846, opening (Bach, 1722)", abc: `M:4/4
L:1/16
Q:1/4=72
K:C
V:1
z2 GceGce z2 GceGce | z2 Adf Adf z2 Adf Adf | z2 Gdf Gdf z2 Gdf Gdf | z2 GceGce z2 GceGce |
z2 Aeaea z2 Aeaea | z2 ^Fadad z2 ^Fadad | z2 Gdgdg z2 Gdgdg | z2 Eged z2 Eged |
V:2
C,E,z6 C,E,z6 | C,D,z6 C,D,z6 | B,,D,z6 B,,D,z6 | C,E,z6 C,E,z6 |
C,E,z6 C,E,z6 | C,D,z6 C,D,z6 | B,,D,z6 B,,D,z6 | B,,C,z6 B,,C,z6 |` },
  greensleeves: { title: "Greensleeves (trad., 16th c.)", abc: `M:6/8
L:1/8
Q:1/4=100
K:Am
V:1
A | c2 d e2 f | e2 d B2 G | G2 A B2 c | A2 ^G E2 A | c2 d e2 f | e2 d B2 G | G2 A B2 ^G | A3 A2 z |
g3 g2 f | e2 d B2 G | G2 A B2 c | A2 ^G E3 | g3 g2 f | e2 d B2 G | G2 A B2 ^G | A3 A3 |
V:2
z | A,3 A,3 | G,3 G,3 | C,3 C,3 | A,3 E,3 | A,3 A,3 | G,3 G,3 | C,3 E,3 | A,3 A,3 |
C3 C3 | G,3 G,3 | C,3 C,3 | A,3 E,3 | C3 C3 | G,3 G,3 | C,3 E,3 | A,3 A,3 |` },
  amazinggrace: { title: "Amazing Grace (trad., 1779/1835)", abc: `M:3/4
L:1/8
Q:1/4=76
K:G
V:1
D2 | G4 BG | B4 A2 | G4 E2 | D4 D2 | G4 BG | B4 A2 | d6 | B4 d2 |
d3 BdB | G4 D2 | E4 D2 | G4 BG | B4 A2 | G6 |
V:2
z2 | G,6 | G,6 | C,6 | G,6 | G,6 | D,6 | G,6 | G,6 |
G,6 | G,6 | C,6 | G,6 | D,6 | G,6 |` },
  frerejacques: { title: "Frère Jacques, canon in two voices (trad.)", abc: `M:4/4
L:1/4
Q:1/4=120
K:C
V:1
C D E C | C D E C | E F G2 | E F G2 | G/2A/2G/2F/2 E C | G/2A/2G/2F/2 E C | C G, C2 | C G, C2 | z4 | z4 |
V:2
z4 | z4 | C D E C | C D E C | E F G2 | E F G2 | G/2A/2G/2F/2 E C | G/2A/2G/2F/2 E C | C G, C2 | C G, C2 |` },
  entertainer: { title: "The Entertainer, opening (Joplin, 1902)", abc: `M:2/4
L:1/16
Q:1/4=88
K:C
V:1
d2e2c2 z2 d2e2c2 z2 | d2e2c4 z2 c2d2 | ^d2e2c2d2e2 z2 B2d2 | c4 z4 |
d2e2c2 z2 d2e2c2 z2 | d2e2c4 z2 a2g2 | ^f2a2c'2 z2 e2f2 | e2c2d4 |
V:2
C,4 [E,G,]4 | C,4 [E,G,]4 | G,,4 [D,G,]4 | C,4 [E,G,]4 | C,4 [E,G,]4 | C,4 [E,G,]4 | G,,4 [D,G,]4 | C,4 [E,G,]4 | C,4 [E,G,]4 | C,4 [E,G,]4 | G,,4 [D,G,]4 | C,4 [E,G,]4 | C,4 [E,G,]4 | C,4 [E,G,]4 |` },
  scarborough: { title: "Scarborough Fair (trad.)", abc: `M:3/4
L:1/4
Q:1/4=132
K:Dm
V:1
D2 D | A2 A | E F E | D3 | A c d | d c A | G F E | D3 |
d2 d | c2 A | A G F | E3 | D A A | G F E | D3 | D3 |
V:2
D,3 | D,3 | A,,3 | D,3 | F,3 | A,,3 | G,,3 | D,3 |
D,3 | F,3 | A,,3 | A,,3 | D,3 | G,,3 | D,3 | D,3 |` },
};
export const SONGS = Object.keys(SONG_DEFS);
export const SONG_TITLES = Object.fromEntries(SONGS.map((k) => [k, SONG_DEFS[k].title]));

// ============================================================================
// ENGINES: each renders one note (pitch Hz, velocity 0-1, held duration s)
// into a Float32Array, tail included
// ============================================================================
const body = (freqs, bws, gains) => { const rs = freqs.map(() => resonator()); rs.forEach((r, i) => r.set(freqs[i], bws[i])); return (x) => x * .5 + rs.reduce((s, r, i) => s + r.run(x) * gains[i], 0); };

// plucked string: Karplus-Strong with tuned fractional delay, frequency-dependent decay, pluck-position comb, body resonances
function renderPluck(P, f, vel, dur) {
  const tail = Math.min(P.sustain, P.release * 3 + .3), N = Math.round((dur + tail) * SR), out = new Float32Array(N);
  const delays = [f, f * Math.pow(2, P.detune / 1200)].map((ff) => SR / ff), maxLen = Math.ceil(Math.max(...delays)) + 2;
  const bodyF = body([P.bodyLow, P.bodyLow * 2.3, 1200], [40, 70, 300], [1.2 * P.bodyMix, .6 * P.bodyMix, .3 * P.bodyMix]);
  const strings = delays.map((len) => {
    // excitation: a noise burst low-passed by brightness (velocity opens it), comb-filtered by the pluck position
    const buf = new Float32Array(maxLen), lp = lowpass(); lp.set(400 + (P.brightness * .6 + .4 * vel * P.brightness) * 9000);
    const pl = Math.round(len * P.pluckPos), exc = new Float32Array(Math.ceil(len));
    for (let i = 0; i < exc.length; i++) exc[i] = lp.run(rnd() * 2 - 1);
    for (let i = pl; i < exc.length; i++) exc[i] -= exc[i - pl] * .9;
    for (let i = 0; i < exc.length; i++) buf[i] = exc[i] * vel * 1.5;
    // loop gain per pass for the requested decay time; the loop's own averaging low-pass darkens the tone as it rings
    return { buf, len, idx: 0, gain: Math.pow(10, -3 / (P.sustain * f)), prev: 0 };
  });
  const releaseAt = Math.round(dur * SR), dampK = Math.pow(10, -3 / (P.release * SR));
  let damp = 1, peak = 0, i = 0;
  for (; i < N; i++) {
    if (i > releaseAt) damp *= dampK;   // finger damping after the note
    if ((i & 2047) === 2047) { if (i > releaseAt && peak < 3e-4) break; peak = 0; }   // the string has died away: stop early
    let s = 0;
    for (const st of strings) {
      const L = st.len, i0 = Math.floor(L), frac = L - i0, r0 = (st.idx - i0 + maxLen) % maxLen, r1 = (r0 - 1 + maxLen) % maxLen;
      const delayed = st.buf[r0] * (1 - frac) + st.buf[r1] * frac;
      const y = (delayed + st.prev) * .5 * st.gain * damp; st.prev = delayed;
      st.buf[st.idx] = y; st.idx = (st.idx + 1) % maxLen; s += y;
    }
    out[i] = bodyF(s) * .5; peak = Math.max(peak, Math.abs(s));
  }
  return out.subarray(0, i);
}

// piano: additive with stiff-string inharmonicity, per-partial two-stage decay, velocity brightness, hammer thump, soundboard
function renderPiano(P, f, vel, dur) {
  const decayBase = P.decay * Math.pow(261.6 / f, .7), N = Math.round((dur + P.release * 4 + .05) * SR), out = new Float32Array(N);
  const B = .0002 * P.inharm * Math.pow(f / 261.6, 1.2), n = Math.round(P.partials), slope = lerp(2, .9, clamp(vel * P.hardness + (1 - P.hardness) * .5, 0, 1)) / P.brightness;
  const parts = [];
  for (let k = 1; k <= n; k++) {
    const fk = k * f * Math.sqrt(1 + B * k * k); if (fk > SR * .45) break;
    const w = 2 * Math.PI * fk / SR, ph = rnd() * 6.28;
    parts.push({ c: Math.cos(w), s: Math.sin(w), re: Math.cos(ph), im: Math.sin(ph), a: Math.pow(k, -slope) * (k === 1 ? 1 : .9),
      d1: Math.exp(-1 / (decayBase / (1 + .28 * (k - 1)) * SR)), d2: Math.exp(-1 / (decayBase * .28 / (1 + .5 * (k - 1)) * SR)), e1: .6, e2: .4 });
  }
  const sb = body([180, 420, 900], [60, 120, 300], [.8 * P.soundboard, .5 * P.soundboard, .3 * P.soundboard]), lp = lowpass(); lp.set(1500);
  const releaseAt = Math.round(dur * SR), relK = Math.pow(10, -3 / (P.release * SR));
  let rel = 1, i = 0;
  for (; i < N; i++) {
    const t = i / SR;
    if (i > releaseAt) { rel *= relK; if (rel < 1e-3) break; }
    let s = 0;
    for (const p of parts) { const re = p.re * p.c - p.im * p.s; p.im = p.re * p.s + p.im * p.c; p.re = re; p.e1 *= p.d1; p.e2 *= p.d2; s += p.im * p.a * (p.e1 + p.e2); }
    if (t < .03) s += lp.run(rnd() * 2 - 1) * P.thump * 1.5 * (1 - t / .03) * vel;
    out[i] = sb(s) * vel * rel * .4 * Math.min(1, i / 60);
  }
  return out.subarray(0, i);
}

// flute: near-sine with breath noise around the pitch, attack chiff, a small scoop, vibrato after a delay, velocity brightens
function renderFlute(P, f, vel, dur) {
  const N = Math.round((dur + P.release / 1000) * SR), out = new Float32Array(N), bp = resonator(), bpc = resonator();
  bp.set(f * 1.02, 250 + f * .1); bpc.set(f * 2, 600);
  const bright = .6 + .4 * vel; let ph = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR, att = Math.min(1, t / (P.attack / 1000)), rel = t > dur ? Math.exp(-(t - dur) / (P.release / 3000)) : 1;
    const vib = t > P.vibDelay / 1000 ? Math.min(1, (t - P.vibDelay / 1000) / .3) * P.vibDepth / 1200 * Math.sin(2 * Math.PI * P.vibRate * t) : 0;
    const scoop = t < .06 ? -.006 * (1 - t / .06) : 0;
    ph += f * Math.pow(2, vib + scoop) / SR; const w = 2 * Math.PI * ph;
    let s = Math.sin(w) + P.h2 * bright * Math.sin(2 * w) + P.h3 * bright * bright * Math.sin(3 * w);
    const n = rnd() * 2 - 1; s += bp.run(n) * P.breath * 2.5 * (.7 + .3 * Math.sin(w)) + bpc.run(n) * P.chiff * 4 * Math.exp(-t / .04);
    out[i] = s * att * rel * (.4 + .6 * vel) * .45;
  }
  return out;
}

// violin: bowed string = band-limited sawtooth through body resonances, slow attack, vibrato, bow noise
function renderViolin(P, f, vel, dur) {
  const N = Math.round((dur + P.release / 1000) * SR), out = new Float32Array(N);
  const bodyF = body([280, 460, 700, 1100], [40, 60, 90, 220], [1.4 * P.body, P.body, .6 * P.body, .4 * P.body]), bpN = resonator(); bpN.set(f * 3, 1500);
  const n = Math.min(Math.round(P.harmonics), Math.floor(SR * .45 / f)), amps = [];
  for (let k = 1; k <= n; k++) amps.push(Math.pow(k, -P.rolloff) * (.55 + .45 * vel * Math.pow(k, -.3)));
  let ph = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR, att = Math.pow(Math.min(1, t / (P.attack / 1000)), 1.5), rel = t > dur ? Math.exp(-(t - dur) / (P.release / 3000)) : 1;
    const vib = t > P.vibDelay / 1000 ? Math.min(1, (t - P.vibDelay / 1000) / .25) * P.vibDepth / 1200 * Math.sin(2 * Math.PI * P.vibRate * t) : 0;
    ph += f * Math.pow(2, vib) / SR; const w = 2 * Math.PI * ph;
    let s = 0; for (let k = 1; k <= n; k++) s += Math.sin(k * w) * amps[k - 1];
    s += bpN.run(rnd() * 2 - 1) * P.bowNoise * 1.5 * (1.2 - att);
    out[i] = bodyF(s) * att * rel * (.35 + .65 * vel) * .25;
  }
  return out;
}

// the instruments: an engine, its preset, its playable MIDI range, and
// whether it plays chords and accompaniment (poly) or the tune alone
const INST = {
  guitar:      { name: "Guitar (nylon)", engine: renderPluck, poly: true, range: [40, 84], p: { sustain: 4, brightness: .45, pluckPos: .22, bodyMix: .8, bodyLow: 100, detune: 2, release: .12 } },
  steel:       { name: "Guitar (steel string)", engine: renderPluck, poly: true, range: [40, 86], p: { sustain: 6, brightness: .85, pluckPos: .16, bodyMix: .6, bodyLow: 110, detune: 3, release: .12 } },
  // a lute: paired courses (wider detune), bright near the bridge, a short ring
  lute:        { name: "Lute", engine: renderPluck, poly: true, range: [43, 81], p: { sustain: 2.5, brightness: .55, pluckPos: .18, bodyMix: .9, bodyLow: 130, detune: 5, release: .15 } },
  lyre:        { name: "Lyre", engine: renderPluck, poly: true, range: [48, 84], p: { sustain: 2.2, brightness: .5, pluckPos: .4, bodyMix: .5, bodyLow: 220, detune: 4, release: 2 } },
  harp:        { name: "Harp", engine: renderPluck, poly: true, range: [28, 96], p: { sustain: 9, brightness: .55, pluckPos: .45, bodyMix: .7, bodyLow: 90, detune: 1, release: 3 } },
  piano:       { name: "Piano", engine: renderPiano, poly: true, range: [24, 103], p: { partials: 24, inharm: 1, decay: 5, brightness: 1, hardness: .7, thump: .4, release: .15, soundboard: .6 } },
  harpsichord: { name: "Harpsichord", engine: renderPiano, poly: true, range: [29, 89], p: { partials: 36, inharm: .3, decay: 1.6, brightness: 1.8, hardness: 0, thump: .1, release: .05, soundboard: .4 } },
  flute:       { name: "Flute", engine: renderFlute, poly: false, range: [60, 96], p: { breath: .25, h2: .25, h3: .08, attack: 45, chiff: .35, vibRate: 5.2, vibDepth: 25, vibDelay: 250, release: 80 } },
  // a recorder: breathier and purer than the flute, a hard chiff, almost no vibrato, an octave up
  recorder:    { name: "Recorder", engine: renderFlute, poly: false, range: [72, 98], p: { breath: .35, h2: .12, h3: .03, attack: 30, chiff: .55, vibRate: 5, vibDepth: 8, vibDelay: 400, release: 60 } },
  violin:      { name: "Violin", engine: renderViolin, poly: false, range: [55, 100], p: { attack: 120, harmonics: 18, rolloff: 1, bowNoise: .25, vibRate: 5.5, vibDepth: 35, vibDelay: 200, body: .8, release: 120 } },
  // a fiddle: a rougher bow, more noise, quicker attack, a folk player's lighter vibrato
  fiddle:      { name: "Fiddle", engine: renderViolin, poly: false, range: [55, 93], p: { attack: 70, harmonics: 22, rolloff: .9, bowNoise: .45, vibRate: 6, vibDepth: 18, vibDelay: 300, body: .9, release: 90 } },
};
export const INSTRUMENTS = Object.keys(INST);
export const INSTRUMENT_NAMES = Object.fromEntries(INSTRUMENTS.map((k) => [k, INST[k].name]));

// one note on an instrument, as samples at SR (tests, one-off plucks)
export const renderNote = (instrument, midi, vel = .8, dur = .5) => { const I = INST[instrument]; return I.engine(I.p, midiHz(midi), vel, dur); };

// make-up gain per instrument: its reference note (mf, half a second, in its
// own range) measured once, so every instrument plays at the same loudness
const level = new Map();
const levelOf = (key) => {
  if (!level.has(key)) { const I = INST[key]; level.set(key, .18 / soundingRms(renderNote(key, clamp(64, I.range[0] + 12, I.range[1] - 12), .8, .5))); }
  return level.get(key);
};
const scores = new Map();
const scoreOf = (key) => { if (!scores.has(key)) scores.set(key, parseABC(SONG_DEFS[key].abc)); return scores.get(key); };
const pick = (a) => a[Math.floor(rnd() * a.length)];

// the notes this instrument plays of this song: a melodic instrument takes
// the first voice only; every voice moves by whole octaves until its middle
// sits inside the instrument's range, stray notes fold in by octaves; the
// accompaniment plays softer; a player's timing and touch vary a little
function arrange(sc, I, tempo, transpose) {
  const voices = I.poly ? sc.voices : [sc.voices[0]], notes = [];
  voices.forEach((v, vi) => {
    const evs = sc.events.filter((e) => e.voice === v); if (!evs.length) return;
    const ps = evs.map((e) => e.pitch + transpose).sort((a, b) => a - b), med = ps[ps.length >> 1];
    let shift = 0; while (med + shift < I.range[0] + 5) shift += 12; while (med + shift > I.range[1] - 5) shift -= 12;
    for (const e of evs) {
      let m = e.pitch + transpose + shift; while (m < I.range[0]) m += 12; while (m > I.range[1]) m -= 12;
      notes.push({ t: Math.max(0, e.t / tempo + (rnd() - .5) * .016), m, vel: clamp((vi ? .55 : .85) + (rnd() - .5) * .16, .05, 1), dur: e.dur / tempo });
    }
  });
  return notes.sort((a, b) => a.t - b.t);
}

// Play a song on an instrument (both random if omitted). Notes are rendered
// just ahead of the playhead (3 s lookahead, at most 4 ms of work per 40 ms
// tick), so a long piece costs no stall up front. Returns { end, stop(),
// instrument, song }: `end` is when the last note has died away.
export function playSong(ctx, { instrument = pick(INSTRUMENTS), song = pick(SONGS), dest, at, tempo = 1, transpose = 0, volume = .5 } = {}) {
  const I = INST[instrument], sc = SONG_DEFS[song] && scoreOf(song);
  if (!I || !sc) throw new Error(`playSong: unknown ${I ? "song " + song : "instrument " + instrument}`);
  const notes = arrange(sc, I, tempo, transpose);
  // a gentle compressor: chords and bass lines add up differently on every instrument
  // (the make-up gain goes BEFORE it, so it squeezes every instrument alike)
  const pre = ctx.createGain(); pre.gain.value = levelOf(instrument);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = .005; comp.release.value = .25;
  const out = ctx.createGain(); out.gain.value = volume;
  pre.connect(comp); comp.connect(out); out.connect(dest ?? ctx.destination);
  const t0 = Math.max(at ?? ctx.currentTime + .15, ctx.currentTime + .05), live = new Set();
  const tail = I.engine === renderPluck ? Math.min(I.p.sustain, I.p.release * 3 + .3) : I.engine === renderPiano ? I.p.release * 4 : .5;
  const end = t0 + notes.reduce((a, n) => Math.max(a, n.t + n.dur), 0) + tail;
  let k = 0, stopped = false;
  const pump = () => {
    const budget = performance.now() + 4;
    while (!stopped && k < notes.length && t0 + notes[k].t < ctx.currentTime + 3 && performance.now() < budget) {
      const n = notes[k++], when = t0 + n.t;
      if (when < ctx.currentTime - .03) continue;   // fell behind (a stalled tab): drop the note rather than play it late
      const { src } = play(ctx, toBuffer(I.engine(I.p, midiHz(n.m), n.vel, n.dur)), { dest: pre, at: when });
      live.add(src); src.addEventListener("ended", () => live.delete(src));
    }
    if (k >= notes.length) clearInterval(timer);
  };
  const timer = setInterval(pump, 40); pump();
  const done = setTimeout(() => { pre.disconnect(); comp.disconnect(); out.disconnect(); }, (end - ctx.currentTime + 1) * 1000);
  return {
    end, instrument, song,
    stop() {   // fade, then silence whatever is still scheduled
      if (stopped) return; stopped = true; clearInterval(timer); clearTimeout(done);
      out.gain.setTargetAtTime(0, ctx.currentTime, .06);
      setTimeout(() => { for (const s of live) try { s.stop(); } catch (e) { /* not started yet */ } pre.disconnect(); comp.disconnect(); out.disconnect(); }, 400);
    },
  };
}
