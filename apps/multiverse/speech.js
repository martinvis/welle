// Formant speech synthesis -- the world's own voice.
//
// Standalone: no engine imports, no DOM (dsp.js only). The engine is the
// formant lab's (v8): a word becomes phoneme tokens, the tokens become
// SEGMENTS (vowel, closure/voice bar + burst + aspiration, fricative,
// nasal, liquid, glide, tap, trill, approximant) with formant targets and
// consonant loci from locus equations per place of articulation; the
// segments become PARAMETER CURVES at 5 ms frames (formants, F0 with
// declination and stress accents or lexical tones, voicing, aspiration,
// frication); the frames are RENDERED sample by sample: a Rosenberg glottal
// pulse with jitter, shimmer, tremor and creak, spectral tilt, through a
// cascade of up to six formant resonators (F1-F3 from the sound, F4/F5 from the voice and bent by the sound, each
// with a bandwidth that follows its frequency and the sound), ANTIFORMANTS where a side cavity makes one -- the nasal
// branch with its sinuses, a lateral's pocket, the piriform sinuses, the trachea -- plus a parallel noise path of
// band-passes (and a zero below the hiss) for frication and bursts. The result plays as an
// AudioBuffer; utterances from one speaker queue one after the other.
//
// A voice is the lab's speaker model (VOICES): pitch and range, formant
// scale (throat length), tilt, breathiness, jitter/shimmer, tremor, creak,
// articulation precision and more -- age and character, not just pitch.
// The lexicon is IPA (the shared WORDS in eight languages), converted to
// the engine's phoneme symbols; anything that is not a lexicon word is
// read as IPA.
//
//   const sp = createSpeaker(ctx, { voice: voiceFor("woman", rng), dest });
//   sp.sayText("hello, beer please!", "de", undefined, "excited")  -> end time
//   sp.vocal("laugh")  -> end time (VOCALS: laugh, cry, cough, sneeze)
//   sp.say("beer", "fr");  sp.stop();
//   WORDS -> the shared word keys; LANGS[l].words -> that language's IPA

import { SR, clamp, lerp, rnd, gauss, resonator, bandpass, antiresonator, toBuffer, play } from "./dsp.js";

// ============================================================================
// PHONEME TABLE (male reference voice; formants Hz, durations ms). Symbols
// are the lab's X-SAMPA-like names; vowels carry F1-F3, consonants a place
// (for the loci) and a source recipe.
// ============================================================================
// place -> F2 locus equation (F2onset = k * F2vowel + c), F3 offset, burst [centre, bw, gain]
const PLACES = {
  bilabial:     { k: .60, c: 250,  f3: -250, burst: [1000, 1600, .40] },
  labiodental:  { k: .62, c: 300,  f3: -200, burst: [1200, 1800, .25] },
  dental:       { k: .42, c: 900,  f3: 0,    burst: [3800, 1600, .65] },
  alveolar:     { k: .40, c: 1050, f3: 100,  burst: [4200, 1600, .75] },
  postalveolar: { k: .35, c: 1350, f3: 100,  burst: [2800, 900,  .7] },
  palatal:      { k: .30, c: 1650, f3: 200,  burst: [2600, 800,  .6] },
  velar:        { k: .55, c: 900,  f3: -250, burst: [1900, 700,  .7] },
  uvular:       { k: .45, c: 750,  f3: -300, burst: [1200, 600,  .5] },
  glottal:      { k: 1.0, c: 0,    f3: 0,    burst: [1500, 3000, .2] },
};
const V = (F1, F2, F3, dur, extra) => ({ type: "vowel", F1, F2, F3, dur, ...extra });
// A sound's COLOUR ABOVE F3 and its DAMPING are part of what it is, not of who says it:
//   f4, f5   the voice's fourth and fifth formants, times this (1 = where the voice keeps them). Rounding the lips
//            lengthens the tract and pulls them down (u o y w); a bunched or curled tongue drags F4 down after F3 (ɹ ɝ);
//            a high front tongue lifts F4 (i j).
//   bw       [B1, B2, B3] times the bandwidth rule. A close vowel loses more at the walls at its low F1, an open one
//            at the lips; a nasalised vowel leaks F1 into the nose; a murmur or a lateral is damped all the way up.
//   zero     [Hz, bandwidth]: an ANTIFORMANT of the sound's own -- the pocket of air a lateral leaves behind the
//            tongue tip, or the cavity behind a fricative's constriction, which takes out what is below the hiss.
export const PHONEMES = {
  // vowels
  i: V(280, 2250, 2900, 110, { f4: 1.06, f5: 1.03, bw: [1.25, 1, 1] }), I: V(400, 1900, 2550, 90, { f4: 1.03 }), e: V(400, 2100, 2650, 110, { f4: 1.04 }), E: V(550, 1800, 2500, 100), "{": V(690, 1660, 2450, 130, { bw: [1.1, 1, 1] }),
  a: V(750, 1300, 2500, 110, { bw: [1.15, 1, 1] }), A: V(730, 1090, 2440, 120, { f4: .98, bw: [1.15, 1, 1] }), O: V(570, 840, 2410, 120, { f4: .95, f5: .97 }), o: V(450, 800, 2400, 110, { f4: .93, f5: .96 }), U: V(440, 1020, 2240, 90, { f4: .95, f5: .97 }),
  u: V(310, 870, 2250, 110, { f4: .92, f5: .95, bw: [1.3, 1.1, 1] }), "@": V(500, 1400, 2500, 70, { bw: [1.1, 1.1, 1.1] }), V: V(640, 1190, 2390, 100), "3": V(490, 1350, 1700, 130, { f4: .88, f5: .96, bw: [1, 1, .8] }), "6": V(600, 1300, 2500, 70, { bw: [1.1, 1.1, 1.1] }),
  y: V(270, 1900, 2200, 110, { f4: .95, f5: .96, bw: [1.25, 1, 1] }), Y: V(350, 1700, 2200, 90, { f4: .96, f5: .97 }), "2": V(400, 1550, 2200, 110, { f4: .95, f5: .96 }), "9": V(500, 1450, 2300, 100, { f4: .96, f5: .97 }), "1": V(350, 1500, 2400, 100), "7": V(500, 1150, 2500, 110),
  "E~": V(600, 1600, 2500, 140, { nasal: 1, bw: [1.6, 1.2, 1] }), "A~": V(650, 1000, 2400, 140, { nasal: 1, bw: [1.6, 1.2, 1] }), "O~": V(450, 850, 2400, 140, { nasal: 1, f4: .94, f5: .97, bw: [1.6, 1.2, 1] }), "9~": V(500, 1400, 2300, 140, { nasal: 1, bw: [1.6, 1.2, 1] }),
  OY: V(570, 840, 2410, 170, { glideTo: "Y", f4: .95, f5: .97 }),
  // stops (vot: voice onset time ms; voiced: a voice bar through the closure)
  p: { type: "stop", place: "bilabial", voiced: 0, closure: 60, vot: 55 }, b: { type: "stop", place: "bilabial", voiced: 1, closure: 60, vot: 5 },
  t: { type: "stop", place: "alveolar", voiced: 0, closure: 55, vot: 60 }, d: { type: "stop", place: "alveolar", voiced: 1, closure: 55, vot: 8 },
  k: { type: "stop", place: "velar", voiced: 0, closure: 60, vot: 70 },    g: { type: "stop", place: "velar", voiced: 1, closure: 60, vot: 12 },
  // fricatives: fric = [centre Hz, bandwidth Hz, gain] band-passes on white noise (gains relative to a vowel): two, and
  // a third that the `fricZeros` switch adds with the sound's zero -- a two-pole band has gentle skirts, so without the
  // zero every hiss carries a fuzz of low noise under it that no mouth makes: a real /s/ falls off a cliff below ~4 kHz
  f: { type: "fric", place: "labiodental", voiced: 0, dur: 95, fric: [[3500, 4000, .08], [7000, 3000, .05], [1500, 2500, .03]] },
  v: { type: "fric", place: "labiodental", voiced: 1, dur: 70, fric: [[3500, 4000, .05], [7000, 3000, .03], [1500, 2500, .02]] },
  T: { type: "fric", place: "dental", voiced: 0, dur: 90, fric: [[4500, 3500, .10], [7500, 3000, .06], [1800, 2500, .03]] },
  D: { type: "fric", place: "dental", voiced: 1, dur: 60, fric: [[4500, 3500, .06], [7500, 3000, .035], [1800, 2500, .02]] },
  s: { type: "fric", place: "alveolar", voiced: 0, dur: 100, fric: [[5000, 1500, .55], [6800, 2500, .32], [9500, 3000, .10]], zero: [2900, 900] },
  z: { type: "fric", place: "alveolar", voiced: 1, dur: 75, fric: [[5000, 1500, .35], [6800, 2500, .19], [9500, 3000, .06]], zero: [2900, 900] },
  S: { type: "fric", place: "postalveolar", voiced: 0, dur: 100, fric: [[2600, 1400, .50], [4000, 1600, .40], [6000, 2500, .10]], zero: [1200, 500] },
  Z: { type: "fric", place: "postalveolar", voiced: 1, dur: 75, fric: [[2600, 1400, .32], [4000, 1600, .25], [6000, 2500, .06]], zero: [1200, 500] },
  x: { type: "fric", place: "velar", voiced: 0, dur: 90, fric: [[1600, 900, .35], [3200, 2000, .18], [5200, 2500, .07]] },
  C: { type: "fric", place: "palatal", voiced: 0, dur: 90, fric: [[2800, 600, .80], [3900, 1300, .26], [5200, 2000, .08]], zero: [2100, 500] },
  h: { type: "fric", place: "glottal", voiced: 0, dur: 70, asp: 1 },   // noise through the vowel formants
  S_j: { type: "fric", place: "palatal", voiced: 0, dur: 110, fric: [[3000, 900, .50], [4400, 1600, .32], [6200, 2200, .10]], zero: [1700, 500] },
  Z_j: { type: "fric", place: "palatal", voiced: 1, dur: 80, fric: [[3000, 900, .32], [4400, 1600, .20], [6200, 2200, .06]], zero: [1700, 500] },
  s_j: { type: "fric", place: "palatal", voiced: 0, dur: 100, fric: [[3800, 1200, .50], [5600, 2000, .30], [7800, 2600, .10]], zero: [2300, 650] },   // Polish ś: between s and ʃ
  z_j: { type: "fric", place: "palatal", voiced: 1, dur: 75, fric: [[3800, 1200, .32], [5600, 2000, .19], [7800, 2600, .06]], zero: [2300, 650] },
  rz: { type: "fric", place: "alveolar", voiced: 1, dur: 80, fric: [[3800, 1600, .40], [6500, 2200, .22]], trillNoise: 26 },   // Czech ř: a voiced fricative trill
  B: { type: "fric", place: "bilabial", voiced: 1, dur: 55, approximant: 1 },   // Spanish approximants: weak, voiced, formant-like
  G: { type: "fric", place: "velar", voiced: 1, dur: 55, approximant: 1 }, J: { type: "fric", place: "palatal", voiced: 1, dur: 60, approximant: 1 },
  R: { type: "fric", place: "uvular", voiced: 1, dur: 70, fric: [[1100, 600, .22], [2200, 1200, .10]], approximant: 1 },
  // nasals (anti: the antiformant)
  m: { type: "nasal", place: "bilabial", dur: 75, anti: 1000, bw: [1.4, 1.6, 1.4] }, n: { type: "nasal", place: "alveolar", dur: 70, anti: 1700, bw: [1.4, 1.6, 1.4] },
  N: { type: "nasal", place: "velar", dur: 80, anti: 3000, bw: [1.4, 1.6, 1.4] }, ny: { type: "nasal", place: "palatal", dur: 80, anti: 2300, bw: [1.4, 1.6, 1.4] },
  // liquids, glides, tap, trill (formant-defined)
  l: { type: "liquid", place: "alveolar", dur: 65, F1: 380, F2: 1100, F3: 2700, zero: [2050, 260], bw: [1.1, 1.4, 1.4] },
  r: { type: "liquid", place: "alveolar", dur: 70, F1: 400, F2: 1150, F3: 1600, f4: .86, f5: .95, bw: [1, 1, .8] },
  "4": { type: "tap", place: "alveolar", dur: 28, F1: 350, F2: 1500, F3: 2500 }, rr: { type: "trill", place: "alveolar", dur: 90, F1: 350, F2: 1450, F3: 2500, rate: 28 },
  j: { type: "glide", place: "palatal", dur: 60, F1: 280, F2: 2200, F3: 2900, f4: 1.06, f5: 1.03, bw: [1.3, 1, 1] }, w: { type: "glide", place: "bilabial", dur: 60, F1: 320, F2: 750, F3: 2300, f4: .9, f5: .95, bw: [1.3, 1.2, 1] },
  H: { type: "glide", place: "palatal", dur: 60, F1: 290, F2: 1900, F3: 2200, f4: .95, f5: .96, bw: [1.3, 1, 1] },
  // affricates = stop + fricative
  ts: { type: "affr", stop: "t", fric: "s" }, tS: { type: "affr", stop: "t", fric: "S" }, dZ: { type: "affr", stop: "d", fric: "Z" }, pf: { type: "affr", stop: "p", fric: "f" },
  tS_j: { type: "affr", stop: "t", fric: "S_j" }, dZ_j: { type: "affr", stop: "d", fric: "Z_j" },
};
// per-language phoneme overrides (the accent in the consonants: VOT, dental stops, approximants)
const LANG_OVERRIDE = {
  de: { t: { vot: 50 }, k: { vot: 60 }, p: { vot: 45 } },
  es: { p: { vot: 12 }, t: { vot: 12, place: "dental" }, k: { vot: 20 }, d: { place: "dental" }, D: { approximant: 1, fric: null, dur: 55 } },
  fr: { p: { vot: 15 }, t: { vot: 18, place: "dental" }, k: { vot: 25 }, d: { place: "dental" } },
  ru: { p: { vot: 15 }, t: { vot: 18, place: "dental" }, k: { vot: 25 }, d: { place: "dental" }, "@": { F1: 480, F2: 1450, dur: 55 } },
  cs: { p: { vot: 12 }, t: { vot: 14, place: "dental" }, k: { vot: 22 }, d: { place: "dental" }, E: { F1: 520, F2: 1850 }, o: { F1: 480, F2: 900 }, u: { F1: 330, F2: 800 } },
  pl: { p: { vot: 12 }, t: { vot: 14, place: "dental" }, k: { vot: 22 }, d: { place: "dental" }, E: { F1: 520, F2: 1850 }, o: { F1: 480, F2: 900 }, "1": { F1: 400, F2: 1600 } },
  // Mandarin: b d g voiceless unaspirated, p t k (with ʰ) aspirated; the apical vowel via ɨ
  zh: { b: { voiced: 0, vot: 12 }, d: { voiced: 0, vot: 14, place: "dental" }, g: { voiced: 0, vot: 22 }, p: { vot: 12 }, t: { vot: 14, place: "dental" }, k: { vot: 22 },
        r: { F1: 350, F2: 1400, F3: 1800 }, "1": { F1: 380, F2: 1450, F3: 2600, dur: 100 }, e: { F1: 450, F2: 1950 }, o: { F1: 480, F2: 900 } },
};
// Mandarin tone contours on the five-level Chao scale (start, middle, end) and duration factors
const TONE_SHAPES = { 1: { c: [5, 5, 5], dur: 1 }, 2: { c: [3, 3.2, 5], dur: 1.05 }, 3: { c: [2, 1, 1.5], dur: 1.25, final: [2.1, 1, 4] }, 4: { c: [5, 4, 1], dur: .9 }, 5: { c: [3, 2.5, 2], dur: .55 } };

// ============================================================================
// IPA -> tokens. Longest match first; ˈ stresses the next vowel, ː
// lengthens, ʲ palatalises, ʰ aspirates, a digit 1-5 is a Mandarin tone on
// the syllable just written, a space is a word gap, a comma a pause.
// A value "x_j" is the symbol x palatalised (S_j, tS_j, t_j ...).
// ============================================================================
const IPA_SYM = {
  "t͡ʃ": "tS", "tʃ": "tS", "d͡ʒ": "dZ", "dʒ": "dZ", "t͡s": "ts", "ts": "ts", "pf": "pf", "tɕ": "tS_j", "dʑ": "dZ_j", "tʂ": "tS",
  "aɪ": "a I", "aʊ": "a U", "eɪ": "e I", "oʊ": "o U", "ɔɪ": "O I", "ɔʏ": "OY", "ɑ̃": "A~", "ɛ̃": "E~", "ɔ̃": "O~", "œ̃": "9~", "r̝": "rz",
  "i": "i", "ɪ": "I", "e": "e", "ɛ": "E", "æ": "{", "a": "a", "ɑ": "A", "ɒ": "A", "ɔ": "O", "o": "o", "ʊ": "U", "u": "u", "ə": "@", "ʌ": "V",
  "ɜ": "3", "ɐ": "6", "y": "y", "ʏ": "Y", "ø": "2", "œ": "9", "ɨ": "1", "ɤ": "7", "ɯ": "1",
  "p": "p", "b": "b", "t": "t", "d": "d", "k": "k", "g": "g", "ɡ": "g", "f": "f", "v": "v", "θ": "T", "ð": "D", "s": "s", "z": "z",
  "ʃ": "S", "ʒ": "Z", "ʂ": "S", "ʐ": "Z", "x": "x", "χ": "x", "ç": "C", "h": "h", "ɦ": "h", "m": "m", "n": "n", "ŋ": "N", "ɲ": "ny",
  "l": "l", "ɫ": "l", "ʎ": "J", "ɹ": "r", "r": "rr", "ɾ": "4", "ʁ": "R", "ʀ": "R", "j": "j", "w": "w", "ɥ": "H", "β": "B", "ɣ": "G",
  "ʝ": "J", "ɕ": "S_j", "ʑ": "Z_j", "c": "t_j", "ɟ": "d_j",
};
const IPA_LANG = { pl: { "ɕ": "s_j", "ʑ": "z_j" }, zh: { "ʐ": "r" } };   // Polish ś/ź sit between s and ʃ; Mandarin r is an approximant
const ipaKeys = new Map();
const keysFor = (lang) => {
  if (!ipaKeys.has(lang)) {
    const map = { ...IPA_SYM, ...(IPA_LANG[lang] || {}) };
    ipaKeys.set(lang, { map, keys: Object.keys(map).map((k) => [...k]).sort((a, b) => b.length - a.length) });
  }
  return ipaKeys.get(lang);
};
export function tokenize(ipa, lang = "en") {
  const { map, keys } = keysFor(lang), chars = [...ipa.normalize("NFC")], out = [];
  let stress = false;
  for (let i = 0; i < chars.length;) {
    const c = chars[i], last = out[out.length - 1];
    if (c === "ˈ" || c === "'") { stress = true; i++; continue; }
    if (c === " " || c === ",") {   // a word gap is a brief dip, a comma a real pause
      if (last?.pause) { if (c === ",") last.pause = 220; } else if (out.length) out.push({ pause: c === "," ? 220 : 40 });
      i++; continue;
    }
    if (c === "ː" || c === ":") { if (last && !last.pause) last.long = true; i++; continue; }
    if (c === "ʲ") { if (last && !last.pause) last.pal = true; i++; continue; }
    if (c === "ʰ") { if (last && !last.pause) last.asp = true; i++; continue; }
    if (c >= "1" && c <= "5") { if (last && !last.pause) last.tone = +c; i++; continue; }
    const key = keys.find((k) => k.every((ch, j) => chars[i + j] === ch));
    if (!key) { i++; continue; }   // unknown marks (ˌ . ‿ ...) are dropped
    for (const s of map[key.join("")].split(" ")) {
      const pal = s.endsWith("_j"), sym = pal ? s.slice(0, -2) : s, ph = { sym, pal, stress: false, long: false };
      if (stress && PHONEMES[sym]?.type === "vowel") { ph.stress = true; stress = false; }
      out.push(ph);
    }
    i += key.length;
  }
  while (out.length && out[out.length - 1].pause) out.pop();
  return out;
}

// ============================================================================
// LANGUAGES: the shared lexicon (IPA) and a little prosody -- rate, how far
// stressed syllables rise, phrase-final lengthening and rise
// ============================================================================
export const WORDS = ["hello", "please", "thanks", "goodbye", "beer", "water", "meat", "fish", "egg", "soup",
                      "horse", "dragon", "good", "bad", "church", "castle", "house", "river"];
export const LANGS = {
  en: { name: "English", prosody: {},
    words: { hello: "həˈloʊ", please: "pliːz", thanks: "θæŋks", goodbye: "ɡʊdˈbaɪ", beer: "bɪɹ", water: "ˈwɔːtəɹ",
             meat: "miːt", fish: "fɪʃ", egg: "ɛɡ", soup: "suːp", horse: "hɔːɹs", dragon: "ˈdɹæɡən", good: "ɡʊd",
             bad: "bæd", church: "tʃɜːɹtʃ", castle: "ˈkɑːsəl", house: "haʊs", river: "ˈɹɪvəɹ" } },
  de: { name: "Deutsch", prosody: { rate: .97 },
    words: { hello: "haˈloː", please: "ˈbɪtə", thanks: "ˈdaŋkə", goodbye: "aʊf ˈviːdɐzeːən", beer: "biːɐ", water: "ˈvasɐ",
             meat: "flaɪʃ", fish: "fɪʃ", egg: "aɪ", soup: "ˈzʊpə", horse: "pfeːɐt", dragon: "ˈdʁaxə", good: "ɡuːt",
             bad: "ʃlɛçt", church: "ˈkɪʁçə", castle: "bʊʁk", house: "haʊs", river: "flʊs" } },
  // syllable-timed: almost no stress bump, the last syllable lengthens and lifts a touch
  fr: { name: "Français", prosody: { rate: 1.05, stress: .45, finalLen: 1.15, finalRise: 6 },
    words: { hello: "bɔ̃ˈʒuʁ", please: "sil vu ˈplɛ", thanks: "mɛʁˈsi", goodbye: "o ʁəˈvwaʁ", beer: "bjɛʁ", water: "o",
             meat: "vjɑ̃d", fish: "pwaˈsɔ̃", egg: "œf", soup: "sup", horse: "ʃəˈval", dragon: "dʁaˈɡɔ̃", good: "bɔ̃",
             bad: "moˈvɛ", church: "eˈɡliz", castle: "ʃɑˈto", house: "mɛˈzɔ̃", river: "ʁiˈvjɛʁ" } },
  es: { name: "Español", prosody: { rate: 1.12, stress: .9 },
    words: { hello: "ˈola", please: "poɾ faˈβoɾ", thanks: "ˈɡɾaθjas", goodbye: "aˈðjos", beer: "θeɾˈβeθa", water: "ˈaɣwa",
             meat: "ˈkaɾne", fish: "pesˈkaðo", egg: "ˈweβo", soup: "ˈsopa", horse: "kaˈβaʎo", dragon: "dɾaˈɣon", good: "ˈbweno",
             bad: "ˈmalo", church: "iˈɣlesja", castle: "kasˈtiʎo", house: "ˈkasa", river: "ˈri.o" } },
  // syllable-timed like Spanish, but with long consonants and a long stressed vowel in an open syllable
  it: { name: "Italiano", prosody: { rate: 1.08, stress: .95, finalLen: 1.2 },
    words: { hello: "ˈtʃaːo", please: "per faˈvoːre", thanks: "ˈɡratːsje", goodbye: "arːiveˈdertʃi", beer: "ˈbirːa", water: "ˈakːwa",
             meat: "ˈkarne", fish: "ˈpeʃːe", egg: "ˈwɔːvo", soup: "ˈdzupːa", horse: "kaˈvalːo", dragon: "ˈdraːɡo", good: "ˈbwɔːno",
             bad: "kaˈtːiːvo", church: "ˈkjɛːza", castle: "kaˈstɛlːo", house: "ˈkaːza", river: "ˈfjuːme" } },
  // heavy stress, reduced vowels around it, palatalised consonants (ʲ)
  ru: { name: "Русский", prosody: { stress: 1.2 },
    words: { hello: "prʲɪˈvʲet", please: "pɐˈʐalustə", thanks: "spɐˈsʲibə", goodbye: "də svʲɪˈdanʲɪjə", beer: "ˈpʲivə", water: "vɐˈda",
             meat: "ˈmʲasə", fish: "ˈrɨbə", egg: "jɪjˈtso", soup: "sup", horse: "ˈloʂətʲ", dragon: "drɐˈkon", good: "xərɐˈʂo",
             bad: "ˈploxə", church: "ˈtserkəfʲ", castle: "ˈzamək", house: "dom", river: "rʲɪˈka" } },
  cs: { name: "Čeština", prosody: { rate: 1.05, stress: .8 },
    words: { hello: "ˈahoj", please: "ˈprosiːm", thanks: "ˈɟɛkuju", goodbye: "ˈnasxlɛdanou", beer: "ˈpivo", water: "ˈvoda",
             meat: "ˈmaso", fish: "ˈrɪba", egg: "ˈvajiːtʃko", soup: "ˈpolɛvka", horse: "kuːɲ", dragon: "drak", good: "ˈdobriː",
             bad: "ˈʃpatniː", church: "ˈkostɛl", castle: "hrat", house: "duːm", river: "ˈr̝ɛka" } },
  pl: { name: "Polski", prosody: { rate: 1.05, stress: .9 },
    words: { hello: "ˈtʃɛɕtɕ", please: "ˈprɔʂɛ", thanks: "dʑɛŋˈkujɛ", goodbye: "dɔ vʲiˈdzɛɲa", beer: "ˈpʲivɔ", water: "ˈvɔda",
             meat: "ˈmʲɛsɔ", fish: "ˈrɨba", egg: "ˈjajkɔ", soup: "ˈzupa", horse: "kɔɲ", dragon: "smɔk", good: "ˈdɔbrɨ",
             bad: "zwɨ", church: "ˈkɔɕtɕuw", castle: "ˈzamɛk", house: "dɔm", river: "ˈʐɛka" } },
  // tonal: every syllable carries its own pitch contour (the digit after it)
  zh: { name: "中文", tonal: true, prosody: {},
    words: { hello: "ni3xao3", please: "tɕʰiŋ3", thanks: "ɕie4ɕie5", goodbye: "tsai4tɕien4", beer: "pʰi2tɕiou3", water: "ʂuei3",
             meat: "ʐou4", fish: "y2", egg: "tɕi1tan4", soup: "tʰaŋ1", horse: "ma3", dragon: "luŋ2", good: "xao3",
             bad: "xuai4", church: "tɕiao4tʰaŋ2", castle: "tʂʰɤŋ2pao3", house: "faŋ2tsɨ5", river: "xɤ2" } },
};

// ---- moods: the same words said three ways ----------------------------------
// A mood scales one utterance: key (pitch), melodic range, rate, how hard
// stressed syllables rise, tilt (tenser = brighter), breath and loudness.
export const MOODS = {
  normal:  { pitch: 1, range: 1, rate: 1, stress: 1, tilt: 0, breath: 1, vol: 1 },
  excited: { pitch: 1.15, range: 1.35, rate: 1.1, stress: 1.3, tilt: 1.5, breath: 1, vol: 1.15 },           // higher, lively, wide
  angry:   { pitch: .93, range: 1.2, rate: 1.15, stress: 1.6, tilt: 4, breath: .5, vol: 1.35, precision: 1.08 },   // lower key, clipped, hard stresses
  // MEASURED on an actress (voices/spr08, one woman, ten sentences per emotion) against her own neutral takes:
  //            median pitch   spread   syllables/s   H1-A3 (tilt)   H1-H2   cepstral peak
  //   anger       x1.40        x1.08      x1.08        -12.5 dB      -1.5      +1.0      loud and PRESSED: the spectrum flattens by 12dB
  //   joy         x1.21        x1.13      x1.05         -7.5 dB      -0.2      +1.3
  //   fear        x1.34        x0.88      x1.16         -4.5 dB      +7.6      -1.9      high, fast, flat -- and breathy
  //   boredom     x0.88        x1.00      x0.82         +2.4 dB      -0.7      +0.7
  //   sadness     x0.77        x0.82      x0.53         +1.4 dB      +3.0      -3.8      half speed (pauses included), breathy and creaky
  // `angry` above is COLD anger (a lowered voice); `furious` is what she did.
  furious: { pitch: 1.42, range: 1.1, rate: 1.08, stress: 1.5, tilt: 17, breath: .5, vol: 1.4, precision: 1.08, fundamental: -2 },
  joyful:  { pitch: 1.24, range: 1.15, rate: 1.05, stress: 1.25, tilt: 11, breath: .9, vol: 1.15 },
  afraid:  { pitch: 1.38, range: .9, rate: 1.16, stress: .9, tilt: 9, breath: 1.6, vol: 1, fundamental: 6, jitter: 1.5 },
  bored:   { pitch: .88, range: 1, rate: .82, stress: .8, tilt: -2, breath: 1, vol: .9, precision: .92 },
  sad:     { pitch: .78, range: .8, rate: .62, stress: .7, tilt: -1.5, breath: 2.2, vol: .8, precision: .9, fundamental: 3, creak: .5, jitter: 2.2 },
};

// ============================================================================
// VOICES: the speaker model. GLOBALS is the reference male voice; a preset
// lists what differs. Formant scale follows vocal-tract length, F0 the fold
// length; breathiness, jitter/shimmer, tremor, creak and precision carry age
// and voice quality. `kind` is who may get it (voiceFor), `old` marks the
// aged ones, `special` keeps a preset out of the random pools.
// ============================================================================
const GLOBALS = { f0: 118, f0Range: 30, formantScale: 1, tilt: -9, breath: .15, jitter: .8, shimmer: 4, rate: 1, precision: 1, transScale: 1, bw: 1,
  nasalMix: .6, fricGain: 1, burstGain: 1, formants: 5, stressF0: 22, finalLen: 1.35, f1Scale: 1, f2Scale: 1, f4: 3500, f5: 4500, sibShift: 0, sibLevel: 1,
  twang: 0, sinus: 1, onset: 20, finalRise: 0, breathFinal: 0, drift: 1, tremor: 0, tremorRate: 5.5, creak: 0 };
// (the children's f0 is what they were HEARD at and judged believable, before the contour was centred on the
// nominal pitch -- they ran ~19% above it, so their numbers were raised to keep the sound that convinced)
export const VOICES = {
  man:          { name: "Man (reference)", kind: "man", set: {} },
  deep:         { name: "Deep man", kind: "man", set: { f0: 95, f0Range: 26, formantScale: .95, tilt: -7, breath: .06, jitter: .5, shimmer: 2.5, bw: .9, precision: 1.05 } },
  baritone:     { name: "Deep baritone, slow and precise", kind: "man", set: { f0: 92, f0Range: 22, formantScale: .97, f1Scale: .96, f2Scale: .95, f4: 3100, f5: 4100, tilt: -6, breath: .08, jitter: .5, shimmer: 2.5, rate: .85, precision: 1.12, creak: .45, onset: 30, sibLevel: .9, drift: .6 } },
  warmbaritone: { name: "Warm relaxed baritone", kind: "man", set: { f0: 108, f0Range: 30, formantScale: .99, f2Scale: .97, f4: 3300, tilt: -10, breath: .22, jitter: .7, shimmer: 3.5, rate: .9, precision: .95, creak: .25, onset: 14, drift: 1.4, finalRise: -5 } },
  gravelly:     { name: "Gravelly low man", kind: "man", set: { f0: 100, f0Range: 26, formantScale: .98, f4: 3200, tilt: -5, breath: .15, jitter: 2.4, shimmer: 8, bw: 1.25, rate: .9, precision: .9, creak: .7, onset: 8, sibLevel: .8, drift: 1.2 } },
  tenor:        { name: "Light quick tenor", kind: "man", set: { f0: 145, f0Range: 46, formantScale: 1.03, f2Scale: 1.05, f4: 3700, tilt: -8, breath: .12, jitter: .8, shimmer: 3, rate: 1.15, precision: 1.05, stressF0: 30, onset: 12, sibShift: 6, drift: .8 } },
  nasalman:     { name: "Nasal high man", kind: "man", set: { f0: 138, f0Range: 38, formantScale: 1.02, f1Scale: 1.06, f4: 3600, tilt: -7, twang: .3, breath: .1, jitter: 1, shimmer: 4, rate: 1.05, sibLevel: 1.15, onset: 10 } },
  youngman:     { name: "Youthful uptalking man", kind: "man", set: { f0: 130, f0Range: 44, formantScale: 1.04, f4: 3600, tilt: -9, breath: .18, jitter: .9, shimmer: 4, rate: 1.1, precision: .92, stressF0: 28, creak: .35, finalRise: 30, drift: 1.2 } },
  oldman:       { name: "Old man", kind: "man", old: true, set: { f0: 135, f0Range: 22, tilt: -12, breath: .35, jitter: 2.2, shimmer: 9, rate: .8, precision: .85, bw: 1.3, tremor: 4, tremorRate: 5.5, creak: .5 } },
  woman:        { name: "Woman (neutral)", kind: "woman", set: { f0: 205, f0Range: 40, formantScale: 1.17, tilt: -11, breath: .3, jitter: .7, shimmer: 4, bw: 1.1 } },
  softwoman:    { name: "Woman, soft and melodic", kind: "woman", set: { f0: 192, f0Range: 58, formantScale: 1.16, tilt: -14, breath: .45, jitter: .45, shimmer: 2.5, rate: .88, bw: 1.15, stressF0: 34, finalLen: 1.55, precision: 1.02, nasalMix: .5, creak: .15 } },
  brightwoman:  { name: "Bright animated woman", kind: "woman", set: { f0: 222, f0Range: 62, formantScale: 1.18, f2Scale: 1.04, f4: 3900, f5: 4900, tilt: -9, breath: .22, jitter: .7, shimmer: 3.5, rate: 1.1, precision: 1.05, stressF0: 42, creak: .3, onset: 10, sibShift: 8, sibLevel: 1.2, drift: 1.2, finalRise: 10 } },
  breathywoman: { name: "Soft breathy woman", kind: "woman", set: { f0: 196, f0Range: 34, formantScale: 1.16, f1Scale: .97, f4: 3700, tilt: -14, breath: .5, jitter: .5, shimmer: 3, bw: 1.15, rate: .9, precision: .98, onset: 35, sibShift: -12, sibLevel: .7, breathFinal: .6 } },
  huskywoman:   { name: "Husky low woman", kind: "woman", set: { f0: 162, f0Range: 30, formantScale: 1.12, f1Scale: .95, tilt: -9, breath: .32, jitter: 1.6, shimmer: 6, bw: 1.2, rate: .95, precision: .98, creak: .55, onset: 22, sibLevel: .85, drift: 1.5 } },
  maturewoman:  { name: "Warm mature woman", kind: "woman", set: { f0: 184, f0Range: 36, formantScale: 1.15, f4: 3700, tilt: -11, breath: .3, jitter: .9, shimmer: 4, rate: .95, stressF0: 26, creak: .2, onset: 18, drift: 1.6, finalRise: -4 } },
  crispwoman:   { name: "Crisp precise woman", kind: "woman", set: { f0: 205, f0Range: 30, formantScale: 1.17, f2Scale: 1.03, f4: 3800, tilt: -10, breath: .15, jitter: .6, shimmer: 2.5, bw: .9, precision: 1.18, onset: 8, sibShift: 10, sibLevel: 1.35 } },
  alto:         { name: "Dark velvety alto", kind: "woman", set: { f0: 170, f0Range: 26, formantScale: 1.1, f1Scale: .94, f2Scale: .96, f4: 3300, f5: 4300, tilt: -12, breath: .28, jitter: .6, shimmer: 3, bw: 1.1, rate: .88, onset: 28, sibLevel: .75, drift: .9, creak: .3 } },
  oldwoman:     { name: "Old woman", kind: "woman", old: true, set: { f0: 170, f0Range: 25, formantScale: 1.14, tilt: -12, breath: .42, jitter: 2.2, shimmer: 9, rate: .8, precision: .85, bw: 1.3, tremor: 4, tremorRate: 5, creak: .35 } },
  child10:      { name: "Child (~10 years)", kind: "child10", set: { f0: 304, f0Range: 44, formantScale: 1.3, tilt: -10, breath: .3, jitter: 1.1, shimmer: 5, rate: .98, precision: .93, bw: 1.15, stressF0: 28 } },
  child:        { name: "Child (~7 years)", kind: "child", set: { f0: 348, f0Range: 48, formantScale: 1.36, tilt: -10, breath: .35, jitter: 1.3, shimmer: 6, rate: .95, precision: .9, bw: 1.2, stressF0: 30 } },
  child5:       { name: "Child (~5 years)", kind: "child5", set: { f0: 377, f0Range: 52, formantScale: 1.42, tilt: -10, breath: .38, jitter: 1.5, shimmer: 7, rate: .9, precision: .85, bw: 1.25, stressF0: 32 } },
  // FITTED TO RECORDINGS: each of these is a coordinate descent over the source and tract parameters against one
  // studio speaker (CMU Arctic), scored by voice_analysis.js on the long-term spectrum, H1-H2, H1-A3, cepstral
  // peak prominence and level dynamics. They are not imitations of those people -- prosody and articulation are
  // still the engine's -- they are what the engine's knobs read when its spectrum and phonation match a person's.
  clearwoman:   { name: "Clear bright woman (fitted to a recording)", kind: "woman", set: { f0: 188, f0Range: 38, formantScale: 1.17, oq: .62, ra: .004, rk: .34, fundamental: 6, f1Scale: 1.12, f2Scale: .95, bw: 1.25, bwHi: 1, breath: .3, jitter: 1.1, shimmer: 3.5, f4: 3400, f5: 3800, rate: 1.06, stressF0: 30 } },
  softvoiced:   { name: "Soft-voiced woman, strong fundamental (fitted)", kind: "woman", set: { f0: 184, f0Range: 45, formantScale: 1.17, oq: .76, ra: .007, rk: .34, fundamental: 10, f1Scale: 1.25, f2Scale: .95, bw: 1.5, bwHi: 1.7, breath: .34, airLevel: 2, jitter: .2, shimmer: 3.5, f4: 3400, f5: 3800, rate: .94, stressF0: 22 } },
  ringingman:   { name: "Resonant man with ring at 3kHz (fitted)", kind: "man", set: { f0: 125, f0Range: 44, oq: .48, ra: .003, rk: .22, fundamental: 6, f1Scale: 1.18, bw: .75, bwHi: .6, breath: .04, airLevel: .25, jitter: .7, shimmer: 3.5, f4: 3400, f5: 3400, rate: .99, stressF0: 34 } },
  plainman:     { name: "Low plain-spoken man (fitted)", kind: "man", set: { f0: 95, f0Range: 42, formantScale: .98, oq: .48, ra: .004, rk: .46, fundamental: 0, f1Scale: 1.25, f2Scale: .95, bwHi: 1, breath: .15, airLevel: .5, jitter: .7, shimmer: 3.5, f4: 3100, f5: 3400, rate: 1.05, stressF0: 32 } },
  actress:      { name: "Expressive German woman (fitted to a labelled corpus)", kind: "woman", set: { f0: 224, f0Range: 150, formantScale: 1.17, oq: .6, ra: .014, rk: .34, fundamental: 3, bw: 1, bwHi: 1, breath: .3, airLevel: 1.5, fricGain: 1.7, jitter: .7, shimmer: 5, f4: 3100, f5: 4200, rate: 1, stressF0: 24 } },
  soft:         { name: "Soft / intimate", kind: "man", special: true, set: { f0: 110, f0Range: 18, tilt: -15, breath: .6, jitter: .6, shimmer: 3, rate: .9, bw: 1.2 } },
  tense:        { name: "Tense / angry", kind: "man", special: true, set: { f0: 150, f0Range: 55, tilt: -4, breath: .03, jitter: 1, shimmer: 3, rate: 1.15, precision: 1.15, bw: .85, stressF0: 40 } },
};
// A voice for a person of this kind ("man" | "woman" | "child10" | "child" |
// "child5"): a random preset of that kind -- an adult is old with chance
// `old` -- with a few percent of individual pitch and throat on top. Pass a
// seeded rng and the same person always gets the same voice. The result is a
// voice parameter object for createSpeaker({ voice }) (`key` names its preset).
export function voiceFor(kind = "man", rng = Math.random, { old = .18 } = {}) {
  const pool = Object.keys(VOICES).filter((v) => VOICES[v].kind === kind && !VOICES[v].special);
  const olds = pool.filter((v) => VOICES[v].old), young = pool.filter((v) => !VOICES[v].old);
  const list = olds.length && rng() < old ? olds : young.length ? young : ["man"];
  const key = list[Math.floor(rng() * list.length)], s = VOICES[key].set;
  return { ...s, key, f0: (s.f0 ?? GLOBALS.f0) * (.94 + rng() * .12), formantScale: (s.formantScale ?? 1) * (.98 + rng() * .04) };
}

// ============================================================================
// ENGINE: plan() tokens -> segments -> frames (5 ms); render() frames -> samples
// ============================================================================
const FRAME_MS = 5, SCHWA = { F1: 500, F2: 1400, F3: 2500 };
function resolve(sym, lang, pal) {   // base entry + the language's override
  if (pal && PHONEMES[sym + "_j"]) sym += "_j";
  const base = PHONEMES[sym]; if (!base) return null;
  return { ...base, ...((LANG_OVERRIDE[lang] || {})[sym] || {}) };
}
function locusFor(entry, vowel, pal, pair) {   // the formants a consonant pulls its neighbouring vowel toward
  const pl = PLACES[entry.place] || PLACES.alveolar, MS = MODEL.segments;
  const F2 = pal ? Math.max(pl.k * vowel.F2 + pl.c, MS.palatalGlide.minF2) : pl.k * vowel.F2 + pl.c;
  const o = pair && MODEL.pairs[pair];             // one pair's own boundary, where the rule is not good enough
  return { F1: entry.type === "nasal" ? MS.locusF1.nasal : MS.locusF1.other, F2: o?.F2 ?? F2, F3: o?.F3 ?? vowel.F3 + pl.f3 };
}

function plan(tokens, lang, G) {
  // FITTED TO RECORDINGS (speech.html?fit=...): four studio speakers reading the same eight sentences took
  // 19-22s where the synthesiser took 26-30, and each fit independently asked for a rate of 1.23-1.38. The
  // phoneme table's durations are citation forms -- words said one at a time -- and nobody talks like that.
  const MS = MODEL.segments, MD = MODEL.durations;
  const rate = 1 / (G.rate * (SOURCE.measured ? MODEL.pace.measuredRate : 1)), tonal = !!LANGS[lang]?.tonal, PAUSE = { type: "pause" };
  // expand affricates, attach resolved entries (pauses become silence)
  const phs = [];
  for (const tk of tokens) {
    if (tk.pause) { phs.push({ ...tk, e: PAUSE }); continue; }
    const e = resolve(tk.sym, lang, tk.pal); if (!e) continue;
    if (e.type === "affr") {
      phs.push({ ...tk, sym: e.stop, e: { ...resolve(e.stop, lang), closure: MS.affricateClosureMs }, affr: 1 });
      phs.push({ ...tk, sym: e.fric, e: { ...resolve(e.fric, lang), dur: MS.affricateFricMs }, stress: false });
    } else phs.push({ ...tk, e });
  }
  // tonal languages: group phonemes into syllables (a tone digit closes the vowel part; a nasal not followed
  // by a vowel is the coda); tone sandhi 3 + 3 -> 2 + 3
  if (tonal) {
    let syl = 0, toned = false; const tones = [];
    phs.forEach((p, i) => {
      const isV = p.e.type === "vowel", nx = phs[i + 1];
      if (!isV && toned && !(p.e.type === "nasal" && !(nx && nx.e.type === "vowel"))) { syl++; toned = false; }
      p.syl = syl; if (p.tone) { toned = true; tones[syl] = p.tone; }
    });
    for (let s = 0; s < tones.length - 1; s++) if (tones[s] === 3 && tones[s + 1] === 3) tones[s] = 2;
    for (const p of phs) { p.tone = tones[p.syl]; p.stress = false; p.finalSyl = p.syl === tones.length - 1; if (p.e.type === "vowel" && p.tone) p.toneDur = TONE_SHAPES[p.tone].dur; }
  }
  const vowels = phs.map((p) => p.e.type === "vowel"), lastVowel = vowels.lastIndexOf(true);
  const vowelNear = (i, dir) => {
    for (let j = i + dir; j >= 0 && j < phs.length; j += dir) if (vowels[j]) return phs[j].e;
    for (let j = i - dir; j >= 0 && j < phs.length; j -= dir) if (vowels[j]) return phs[j].e;
    return SCHWA;
  };
  // KLATT'S DURATION RULES. A segment's length is not a property of the segment: it is set by the word and the
  // neighbours it finds itself among, and the ear is far more sensitive to this than to any spectrum.
  //   - a vowel is LONGER before a voiced consonant and shorter before a voiceless one ("bead" / "beat") --
  //     in English that ratio carries more of the voicing contrast than the consonant itself does;
  //   - vowels shorten as the word gets longer, and before a cluster; consonants shorten inside one;
  //   - a one-syllable word with no stress on it is a function word, and is said in passing.
  const durK = phs.map(() => 1);
  if (SOURCE.durations && !tonal) {
    const words = []; let w0 = 0;
    phs.forEach((p, i) => { if (p.e.type === "pause") { if (i > w0) words.push([w0, i]); w0 = i + 1; } });
    if (w0 < phs.length) words.push([w0, phs.length]);
    for (const [a, b] of words) {
      const nSyl = vowels.slice(a, b).filter(Boolean).length, stressedWord = phs.slice(a, b).some((p) => p.stress);
      for (let i = a; i < b; i++) {
        const e = phs[i].e; let k = 1;
        if (e.type === "vowel") {
          if (nSyl >= 3) k *= MD.threeSyllables; else if (nSyl === 2) k *= MD.twoSyllables;
          if (nSyl === 1 && !stressedWord) k *= MD.functionWord;
          let j = i + 1, cons = 0, first = null;
          while (j < b && phs[j].e.type !== "vowel") { first ??= phs[j].e; cons++; j++; }
          if (first && (first.type === "stop" || first.type === "fric")) k *= first.voiced ? MD.beforeVoiced : MD.beforeVoiceless;
          if (cons >= 2) k *= MD.beforeCluster;
        } else if ((e.type === "nasal" || e.type === "liquid") && i > a && !vowels[i - 1] && (i + 1 >= b || !vowels[i + 1])) k *= MD.syllabic;   // [ˈlapm̩] [ˈzaːɡŋ̩]: the nasal IS the syllable
        else if ((i > a && !vowels[i - 1]) || (i + 1 < b && !vowels[i + 1])) k *= MD.inCluster;
        durK[i] = k;
      }
    }
  }
  const reduce = SOURCE.reduction && !tonal ? (MODEL.reduction.byLanguage[lang] ?? MODEL.reduction.otherLanguages) : 0;
  const segs = [];
  phs.forEach((p, i) => {
    const e = p.e, prev = phs[i - 1], nx = phs[i + 1] && phs[i + 1].e.type !== "pause" ? phs[i + 1] : null;
    if (e.type === "pause") { segs.push({ kind: "silence", dur: p.pause, av: 0 }); return; }
    const isLast = i === phs.length - 1;
    const stretch = (isLast || i === lastVowel && lastVowel >= phs.length - 2 ? G.finalLen : 1) * (p.long ? MS.longDur : 1) * rate;
    const stress = p.stress ? MS.stressDur : 1;
    // (only a sound with a tract shape of its own has a colour; an obstruent's is whatever its neighbours hand it)
    const own = ["vowel", "nasal", "liquid", "glide", "tap", "trill"].includes(e.type);
    const base = { ph: i, sym: p.sym, pal: p.pal, stress: p.stress, syl: p.syl, tone: p.tone, colour: own ? [e.f4 ?? 1, e.f5 ?? 1, ...(e.bw ?? [1, 1, 1])] : null, lat: own && e.zero || null };
    const pairIn = prev && prev.sym ? prev.sym + ">" + p.sym : null, pairOut = nx ? p.sym + ">" + nx.sym : null;   // MODEL.pairs keys
    if (p.asp) { e.vot = MS.aspiratedVotMs; if (e.type === "fric") e.dur = (e.dur || MS.fricDefaultMs) * MS.aspiratedFricScale; }
    if (e.type === "vowel") {
      // unstressed vowels drift toward schwa by (1 - precision): a real tongue does not always arrive
      const prec = p.stress ? 1 : G.precision, tgt = { F1: lerp(SCHWA.F1, e.F1, prec), F2: lerp(SCHWA.F2, e.F2, prec), F3: lerp(SCHWA.F3, e.F3, prec) };
      // reduction: the unstressed vowel's target itself falls toward schwa (a long vowel resists; a careful speaker resists a little)
      const red = p.stress ? 0 : reduce * (p.long ? MODEL.reduction.longVowel : 1) / Math.max(MODEL.reduction.precisionFloor, G.precision);
      if (red > 0) { tgt.F1 = lerp(tgt.F1, SCHWA.F1, red); tgt.F2 = lerp(tgt.F2, SCHWA.F2, red); tgt.F3 = lerp(tgt.F3, SCHWA.F3, red); }
      const s = { ...base, kind: "vowel", dur: e.dur * stress * stretch * (p.toneDur || 1), av: p.stress ? MS.vowel.avStressed : MS.vowel.avUnstressed, finalSyl: p.finalSyl, F: tgt, nasal: e.nasal || 0,
                  transIn: MODEL.pairs[pairIn]?.transMs ?? MS.vowel.transInMs, transOut: MODEL.pairs[pairOut]?.transMs ?? MS.vowel.transOutMs };
      if (e.glideTo) { const g = resolve(e.glideTo, lang); s.F2nd = { F1: g.F1, F2: g.F2, F3: g.F3 }; }
      segs.push(s);
    } else if (e.type === "stop") {
      const locIn = locusFor(e, vowelNear(i, -1), p.pal, pairIn), locOut = locusFor(e, vowelNear(i, 1), p.pal, pairOut), burst = PLACES[e.place].burst;
      segs.push({ ...base, kind: e.voiced ? "voicebar" : "closure", dur: e.closure * rate * (p.long ? MS.longDur : 1), av: e.voiced ? MS.stop.voicebarAv : 0, F: locIn, Fend: locOut });   // a geminate is one long closure, not two stops
      segs.push({ ...base, kind: "burst", dur: MS.stop.burstMs, af: burst[2] * (e.voiced ? MS.stop.voicedBurstScale : 1) * (nx ? 1 : MS.stop.finalBurstScale), fric: [[burst[0], burst[1], 1]], F: locOut });
      if (e.vot > MS.stop.votMinMs && nx) segs.push({ ...base, kind: "aspiration", dur: e.vot, ah: MS.stop.aspirationAh, F: locOut });
    } else if (e.type === "fric") {
      const vBefore = vowelNear(i, -1), vAfter = vowelNear(i, 1), loc = locusFor(e, prev && vowels[i - 1] ? vBefore : vAfter, p.pal, prev && vowels[i - 1] ? pairIn : pairOut);
      if (e.approximant) segs.push({ ...base, kind: "approx", dur: e.dur * rate, av: MS.approx.av, F: { F1: MS.approx.F1, F2: loc.F2, F3: loc.F3 }, af: e.fric ? MS.approx.af : 0, fric: e.fric || [] });
      // /h/ BETWEEN VOICED SOUNDS is not voiceless: the folds keep swinging while they stand apart -- breathy voice [ɦ]
      else if (e.asp && SOURCE.voicedH && prev && nx && prev.e.type !== "pause" && ["vowel", "nasal", "liquid", "glide"].includes(prev.e.type) && nx.e.type === "vowel")
        segs.push({ ...base, kind: "aspiration", dur: e.dur * rate, ah: MODEL.voicing.hAh, av: MODEL.voicing.hAv, breathy: 1, F: vAfter });
      else if (e.asp) segs.push({ ...base, kind: "aspiration", dur: e.dur * rate, ah: MS.fric.hAh, F: vAfter });
      else segs.push({ ...base, kind: "fric", dur: e.dur * rate * (p.long ? MS.longDur : 1), af: 1, av: e.voiced ? MS.fric.voicedAv : 0, fric: e.fric, fz: e.zero || null, F: loc, Fend: locusFor(e, vAfter, p.pal, pairOut), trillNoise: e.trillNoise || 0 });
    } else if (e.type === "nasal") {
      const loc = locusFor(e, vowelNear(i, prev && vowels[i - 1] ? -1 : 1), p.pal, prev && vowels[i - 1] ? pairIn : pairOut);
      segs.push({ ...base, kind: "nasal", dur: e.dur * stretch, av: MS.nasal.av, F: { F1: MS.nasal.F1, F2: loc.F2, F3: MS.nasal.F3 }, nasal: 1, anti: e.anti, transIn: MS.nasal.transMs, transOut: MS.nasal.transMs });
    } else if (e.type === "liquid" || e.type === "glide") {
      segs.push({ ...base, kind: e.type, dur: e.dur * stretch, av: MS.liquid.av, F: { F1: e.F1, F2: p.pal ? Math.max(e.F2, MS.palatalGlide.minF2) : e.F2, F3: e.F3 }, transIn: MS.liquid.transMs, transOut: MS.liquid.transMs });
    } else if (e.type === "tap") {
      segs.push({ ...base, kind: "tap", dur: e.dur, av: MS.tap.av, F: { F1: e.F1, F2: e.F2, F3: e.F3 }, transIn: MS.tap.transMs, transOut: MS.tap.transMs });
    } else if (e.type === "trill") {
      segs.push({ ...base, kind: "trill", dur: e.dur * rate, av: MS.trill.av, F: { F1: e.F1, F2: e.F2, F3: e.F3 }, rate: e.rate, transIn: MS.trill.transMs, transOut: MS.trill.transMs });
    }
    if (p.pal && e.type !== "vowel" && nx && nx.e.type === "vowel")   // the palatal off-glide into the vowel
      { const pg = MS.palatalGlide; segs.push({ ...base, kind: "glide", dur: pg.ms, av: MS.liquid.av, F: { F1: pg.F1, F2: pg.F2, F3: pg.F3 }, transIn: pg.transInMs, transOut: pg.transOutMs, offglide: 1 }); }
  });
  for (const sg of segs) if (sg.ph !== undefined && sg.kind !== "burst" && sg.kind !== "aspiration") sg.dur *= durK[sg.ph];   // a burst is an event, not a length
  segs.unshift({ kind: "silence", dur: MODEL.pace.leadSilenceMs, av: 0 }); segs.push({ kind: "silence", dur: MODEL.pace.tailSilenceMs, av: 0 });
  return framesFrom(segs, G, tonal);
}

function framesFrom(segs, G, tonal) {
  let t = 0; for (const s of segs) { s.t0 = t; t += s.dur; s.t1 = t; }
  const total = t, n = Math.ceil(total / FRAME_MS), fs = G.formantScale, ts = G.transScale;
  const sF = SOURCE.vowelSpace ? adultFemale(fs) : 0, MI = MODEL.intonation, MT = MODEL.tract;
  const sT = SOURCE.femaleTract ? adultFemale(fs) : 0, FT = MT.femaleTract, t1 = 1 + FT.f1 * sT, t3 = 1 + FT.f3 * sT, tU = 1 + FT.upper * sT;
  // formant keyframes: the steady parts of formant-bearing segments, the loci at obstruent edges
  const keys = [];
  for (const s of segs) {
    if (!s.F) continue;
    if (["vowel", "nasal", "liquid", "glide", "tap", "trill", "approx"].includes(s.kind)) {
      const TR = MODEL.transitions, tin = Math.min((s.transIn || TR.defaultMs) * ts, s.dur * TR.maxShareOfSegment), tout = Math.min((s.transOut || TR.defaultMs) * ts, s.dur * TR.maxShareOfSegment);
      keys.push({ t: s.t0 + tin, F: s.F }); keys.push({ t: s.t1 - tout, F: s.F2nd || s.F });
    } else { keys.push({ t: s.t0, F: s.F }); keys.push({ t: s.t1, F: s.Fend || s.F }); }
  }
  keys.sort((a, b) => a.t - b.t);
  if (!keys.length) keys.push({ t: 0, F: SCHWA });
  let kk = 0;
  const fAt = (tm) => {   // (frames are read in time order, so the key cursor only moves forward)
    if (tm <= keys[0].t) return keys[0].F;
    if (tm >= keys[keys.length - 1].t) return keys[keys.length - 1].F;
    while (keys[kk + 1].t < tm) kk++;
    const a = keys[kk], b = keys[kk + 1], u = b.t === a.t ? 0 : (tm - a.t) / (b.t - a.t);
    return { F1: lerp(a.F.F1, b.F.F1, u), F2: lerp(a.F.F2, b.F.F2, u), F3: lerp(a.F.F3, b.F.F3, u) };
  };
  // F0: declination across the whole utterance plus an accent on every stressed vowel
  const stressed = segs.filter((s) => s.kind === "vowel" && s.stress);
  let f0At = (tm) => {
    const C = MI.classic; let f = G.f0 * (1 + (G.f0Range / 100) * C.declination * (1 - 2 * tm / total));
    // an accent rises faster than it falls, and each one in a phrase is set out from a lower ceiling than the
    // last (downstep) -- a row of equal peaks is the sound of a machine reading a list
    for (let i = 0; i < stressed.length; i++) {
      const s = stressed[i], c = s.t0 + s.dur * C.accentCentre, w = s.dur * C.accentWidthShare + C.accentWidthMs, e = tm - c;
      const d = SOURCE.microprosody ? e / (e < 0 ? w * C.riseShare : w * C.fallShare) : e / w;
      const step = SOURCE.microprosody ? Math.pow(C.downstep, i) : 1;
      f *= 1 + (G.stressF0 / 100) * step * Math.exp(-d * d * C.sharpness);
    }
    return f;
  };
  if (tonal) {   // lexical tones: one contour per syllable, mild declination on top
    const syls = {};
    for (const s of segs) {
      if (s.syl === undefined || !s.tone) continue;
      const y = (syls[s.syl] ||= { t0: s.t0, t1: s.t1, tone: s.tone, final: s.finalSyl });
      y.t0 = Math.min(y.t0, s.t0); y.t1 = Math.max(y.t1, s.t1); if (s.finalSyl) y.final = true;
    }
    const list = Object.values(syls).sort((a, b) => a.t0 - b.t0), octaves = (G.f0Range / 100) * MI.tonal.octavesPerRange;
    const levelF0 = (L, tm) => G.f0 * Math.pow(2, (L - 3) / 4 * octaves) * (1 - MI.tonal.declination * tm / total);
    f0At = (tm) => {
      let y = list.find((s) => tm >= s.t0 && tm <= s.t1);
      if (!y) { let best = null; for (const s of list) { const d = Math.min(Math.abs(tm - s.t0), Math.abs(tm - s.t1)); if (!best || d < best.d) best = { d, s }; } y = best && best.s; }
      if (!y) return G.f0;
      const T = TONE_SHAPES[y.tone], c = (y.tone === 3 && y.final && T.final) ? T.final : T.c, u = clamp((tm - y.t0) / (y.t1 - y.t0), 0, 1);
      return levelF0(u < .5 ? lerp(c[0], c[1], u * 2) : lerp(c[1], c[2], (u - .5) * 2), tm);
    };
  }
  // FUJISAKI'S MODEL. The tune of a sentence is two kinds of command passed through two damped systems, summed
  // in the LOG of F0: a PHRASE command is an impulse that lifts the whole phrase and lets it sink (that is
  // declination -- it is not a line drawn across the utterance, it is a muscle relaxing), and an ACCENT command
  // is a step on and a step off over each stressed syllable, rounded by the larynx's own response. The shapes
  // are right because they are made the way a throat makes them; the Gaussian bumps they replace were drawn.
  if (SOURCE.fujisaki && !tonal) {
    // (amplitudes tuned against the measured pitch spread: at .55/.85 a statement carried 1.7 semitones, under
    // the 2-4 a person uses)
    const FJ = MI.fujisaki, Ap = Math.log(1 + (G.f0Range / 100) * FJ.phraseGain), Aa = Math.log(1 + G.stressF0 / 100) * FJ.accentGain;
    const Fb = G.f0 * Math.exp(-FJ.baseDrop * Ap), al = FJ.alpha, be = FJ.beta, th = FJ.ceiling;
    const Gp = (t) => t > 0 ? al * t * Math.exp(1 - al * t) : 0;
    const Ga = (t) => t > 0 ? Math.min(1 - (1 + be * t) * Math.exp(-be * t), th) / th : 0;
    const phrases = [segs.find((sg) => sg.kind !== "silence")?.t0 ?? 0];
    for (const sg of segs) if (sg.kind === "silence" && sg.dur >= FJ.phrasePauseMs && sg.t1 < total - FJ.phraseTailMs) phrases.push(sg.t1);
    f0At = (tm) => {
      const t = tm / 1000; let ln = Math.log(Fb);
      for (const p of phrases) ln += Ap * Gp(t - (p - FJ.phraseLeadMs) / 1000);      // the command leads the phrase it lifts
      for (let i = 0; i < stressed.length; i++) {
        const sg = stressed[i];
        ln += Aa * Math.pow(FJ.downstep, i) * (Ga(t - (sg.t0 - FJ.accentLeadMs) / 1000) - Ga(t - (sg.t1 + FJ.accentLagMs) / 1000));
      }
      return Math.exp(ln);
    };
  }
  const flHz = MT.f1Floor.hz * fs * t1, floorF1 = (f1, kind) => SOURCE.f1Floor && f1 < flHz && (kind === "vowel" || kind === "glide" || kind === "liquid") ? f1 + MT.f1Floor.share * (flHz - f1) : f1;
  const frames = [];
  let si = 0;
  for (let i = 0; i < n; i++) {
    const tm = i * FRAME_MS;
    while (si < segs.length - 1 && tm >= segs[si].t1) si++;
    const s = segs[si], F = fAt(tm);
    frames.push({ t: tm, seg: s, f0: f0At(tm), av: s.av || 0, ah: s.ah || 0, af: s.af || 0,
      nasal: s.kind === "vowel" ? Math.max(s.nasal || 0, G.twang) : (s.nasal || 0), anti: s.anti || (G.twang > 0 ? MT.nasal.twangZeroHz : 0),
      // NON-UNIFORM SCALING (Fant). Against measured female vowels a flat x1.17 leaves front-vowel F2 about 6%
      // low and back-vowel F2 about 7% high -- a COMPRESSED vowel space, where a larger and more dispersed one
      // is itself one of the things that says "woman". So F2 is pushed away from the middle of the space and
      // F1 opened on open vowels, in proportion to how female the tract is.
      F: [floorF1(F.F1 * fs * t1 * G.f1Scale * (1 + MT.vowelSpace.f1 * sF * (F.F1 - MT.vowelSpace.f1Centre) / MT.vowelSpace.f1Centre), s.kind),
          F.F2 * fs * G.f2Scale * (1 + MT.vowelSpace.f2 * sF * (F.F2 - MT.vowelSpace.f2Centre) / MT.vowelSpace.f2Centre),
          F.F3 * fs * t3, G.f4 * fs * tU, G.f5 * fs * tU, MT.f6 * fs * tU], fric: s.fric || [], fz: s.fz || null, trill: s.kind === "trill" ? s.rate : 0, voicebar: s.kind === "voicebar" });
  }
  // EACH SOUND'S OWN COLOUR. f4/f5 and the bandwidth factors are properties of the sound (PHONEMES), so they are
  // tracks like the formants: held through a sound that declares them, carried across the obstruents between,
  // and eased from one to the next, because lips do not round in a frame.
  if (SOURCE.upperFormants || SOURCE.phonemeBw || SOURCE.lateral) {
    const n5 = frames.length, tgt = frames.map((f) => f.seg.colour || null), known = []; tgt.forEach((c, i) => { if (c) known.push(i); });
    let kc = 0;
    const at = (i) => {
      if (!known.length) return [1, 1, 1, 1, 1];
      if (i <= known[0]) return tgt[known[0]]; if (i >= known[known.length - 1]) return tgt[known[known.length - 1]];
      while (known[kc + 1] < i) kc++;
      const a = known[kc], b = known[kc + 1], u = b === a ? 0 : (i - a) / (b - a); return tgt[a].map((x, j) => lerp(x, tgt[b][j], u));
    };
    const keep = Math.exp(-FRAME_MS / MT.colourTauMs), lead = Math.round(MT.colourTauMs * MT.tauLead / FRAME_MS);
    let y = null, lat = 0, latZ = null;
    const latAt = (i) => frames[Math.min(i, n5 - 1)].seg.lat;
    for (let i = 0; i < n5; i++) {
      const x = at(Math.min(i + lead, n5 - 1)); y = y ? y.map((v, j) => keep * v + (1 - keep) * x[j]) : x.slice();
      const f = frames[i];
      if (SOURCE.upperFormants) { f.F[3] *= y[0]; f.F[4] *= y[1]; }
      if (SOURCE.phonemeBw) f.B = [y[2], y[3], y[4]];
      if (SOURCE.lateral) { const z = latAt(i + lead); if (z) latZ = z; lat = keep * lat + (1 - keep) * (z ? 1 : 0); if (latZ && lat > .01) { f.lat = lat; f.latZ = latZ; } }
    }
  }
  // ARTICULATORS HAVE MASS. The tracks above reach every target exactly and hold it flat, which is the most
  // synthetic thing a formant synthesiser does. A real tongue chases its target like a critically damped
  // spring and, when the segment is short, never arrives -- UNDERSHOOT, which is why fast speech blurs and
  // slow speech does not, and why a vowel's colour depends on how long you had to say it. The target is read
  // a little ahead of each frame so that chasing it does not drag the sound behind the segment it belongs to.
  if (SOURCE.undershoot) {
    const dt = FRAME_MS / 1000, prec = Math.max(MT.precisionFloor, G.precision);
    for (let k = 0; k < 3; k++) {
      const tau = MT.tauMs[k] / 1000 * (G.transScale || 1) / prec, w = 1 / tau;
      const lead = Math.round(tau * 1000 * MT.tauLead / FRAME_MS), X = frames.map((f) => f.F[k]);
      let y = X[0] ?? MODEL.schwa.F1, v = 0;
      for (let i = 0; i < frames.length; i++) {
        const x = X[Math.min(i + lead, X.length - 1)];
        v += (w * w * (x - y) - 2 * w * v) * dt; y += v * dt;
        frames[i].F[k] = clamp(y, MT.formantMin, MT.formantMax);
      }
    }
  }
  // F0 MICROPROSODY. A vowel after a voiced obstruent starts a few per cent low and climbs back over ~60ms;
  // after a voiceless one it starts high and falls. Every speaker does it, nobody hears themselves doing it,
  // and speech without it sounds ironed flat.
  if (SOURCE.microprosody) {
    const voicedKinds = ["vowel", "nasal", "liquid", "glide", "approx", "tap", "trill"];
    for (let ci = 0; ci < segs.length; ci++) {
      const c = segs[ci], nxt = segs[ci + 1];
      // only the LAST piece of an obstruent counts: a stop is a closure, a burst and an aspiration, a cluster is
      // several of those, and letting each one push the pitch stacked them into a jump no larynx makes
      if (voicedKinds.includes(c.kind) || !nxt || !voicedKinds.includes(nxt.kind)) continue;
      const MP = MI.microprosody, k = (c.av || 0) > MP.voicedAv || c.kind === "voicebar" ? MP.afterVoiced : MP.afterVoiceless;
      for (const f of frames) {
        const d = f.t - c.t1;
        if (d >= 0 && d < MP.windowMs && f.av > MODEL.envelope.voicedAv) f.f0 *= 1 + k * Math.exp(-d / MP.decayMs);
      }
    }
  }
  if (SOURCE.intrinsicPitch && !tonal) {
    const IP = MI.intrinsic; let cur = 0;
    for (const f of frames) {
      const e = f.seg.kind === "vowel" && PHONEMES[f.seg.sym], st = e ? clamp(IP.semitones * (IP.centreF1 - e.F1) / IP.perHz, -IP.max, IP.max) : 0;
      cur += (st - cur) * .25; f.f0 *= Math.pow(2, cur / 12);           // eased over ~20ms: a larynx is pulled, not switched
    }
  }
  if (SOURCE.voicingTails) {
    const VT = MODEL.voicing; let since = Infinity, lastAv = 0;
    for (const f of frames) {
      if (f.av > MODEL.envelope.voicedAv) { since = 0; lastAv = f.av; continue; }
      since += FRAME_MS;
      if (since <= VT.tailMs && f.seg.kind !== "silence" && f.seg.kind !== "burst") { const k = 1 - since / VT.tailMs; f.av = lastAv * VT.tailAv * k * k; f.tail = 1; }
    }
  }
  // speaker habits: slow pitch drift, phrase-final rise or fall, sibilant colour, voice onset hardness, breath at the end
  const dph = rnd() * 6.28;
  { const D = MI.drift; for (const f of frames) f.f0 *= 1 + (G.drift / 100) * (D.slowShare * Math.sin(2 * Math.PI * D.slowHz * f.t / 1000 + dph) + D.fastShare * Math.sin(2 * Math.PI * D.fastHz * f.t / 1000)); }
  const lastV = [...segs].reverse().find((s) => s.kind === "vowel");
  if (!tonal && G.finalRise && lastV) for (const f of frames) if (f.t > lastV.t0) f.f0 *= 1 + (G.finalRise / 100) * clamp((f.t - lastV.t0) / Math.max(MI.finalRiseMinMs, lastV.dur), 0, 1);
  // PHONATION IS NOT A CONSTANT. Measured on recordings, how periodic a voice is (cepstral peak prominence)
  // swings by +-5dB within a sentence; the synthesiser's swung by 2, because it closed its folds the same way
  // on every syllable. A person leans on a stressed syllable -- folds firm, closure abrupt, the spectrum bright
  // and clean -- lets the unstressed ones go slack, and runs out of breath and effort toward the end of each
  // phrase, where the voice turns breathy or creaks. `lax` is that, per frame: below zero firm, above it slack.
  if (SOURCE.phonation) {
    const PH = MODEL.phonation;
    const ends = segs.filter((sg) => sg.kind === "silence" && sg.dur >= PH.phrasePauseMs).map((sg) => sg.t0).concat([total - PH.tailMs]).sort((p, q) => p - q);
    const ph = rnd() * 6.28;
    for (const f of frames) {
      const kd = f.seg.kind;
      let lax = kd === "vowel" ? (f.seg.stress ? PH.stressed : PH.unstressed) : kd === "nasal" || kd === "liquid" ? PH.sonorant : PH.other;   // voiced fricatives and approximants are the leakiest
      const end = ends.find((e) => e >= f.t) ?? total, toEnd = end - f.t;
      if (toEnd < PH.finalMs) lax += PH.finalLax * (1 - toEnd / PH.finalMs);
      if (f.tail || f.seg.breathy) lax += MODEL.voicing.tailLax;
      f.lax = lax + PH.wander * Math.sin(2 * Math.PI * PH.wanderHz * f.t / 1000 + ph);
    }
  }
  // THE VOICE'S PITCH IS THE MIDDLE OF ITS TUNE, NOT THE FLOOR. Accents and the phrase arc only ever add to the
  // base, so every voice ran 15-35% above the f0 it was given: a man at 144Hz is still a man and a child at
  // 334Hz is still a child, but a woman set to 205Hz came out at 263-277Hz, which is a twelve-year-old. The
  // contour is shifted, in the log domain where pitch is heard, so that its voiced mean is the pitch asked for.
  if (SOURCE.centrePitch) {
    let sum = 0, cnt = 0;
    for (const f of frames) if (f.av > MI.centreOnAv) { sum += Math.log(f.f0); cnt++; }
    if (cnt) { const k = G.f0 / Math.exp(sum / cnt); for (const f of frames) f.f0 *= k; }
  }
  for (const f of frames) if (f.fric.length && f.seg.kind === "fric" && f.fric[0][0] > MODEL.consonants.sibilantAboveHz) { f.fric = f.fric.map((r) => [r[0] * (1 + G.sibShift / 100), r[1], r[2] * G.sibLevel]); if (f.fz) f.fz = [f.fz[0] * (1 + G.sibShift / 100), f.fz[1]]; }
  const onsetFrames = Math.max(1, Math.round(G.onset / FRAME_MS));
  for (let i = 1; i < frames.length; i++) if (frames[i].av > MODEL.envelope.voicedAv && frames[i - 1].av <= MODEL.envelope.voicedAv) for (let k = 0; k < onsetFrames && i + k < frames.length; k++) frames[i + k].av *= (k + 1) / (onsetFrames + 1);
  if (G.breathFinal > 0) { const E = MODEL.envelope, lv = [...segs].reverse().find((s) => s.av > E.breathFinalOnAv); if (lv) for (const f of frames) if (f.t > lv.t1 - E.breathFinalBeforeMs && f.t < lv.t1 + E.breathFinalAfterMs) f.ah = Math.max(f.ah, G.breathFinal * E.breathFinalGain * clamp((f.t - (lv.t1 - E.breathFinalBeforeMs)) / E.breathFinalRampMs, 0, 1)); }
  // level smoothing: voicing, aspiration and frication ramp over ~25 ms at every boundary
  for (const k of ["av", "ah", "af"]) {
    const a = frames.map((f) => f[k]);
    for (let i = 0; i < a.length; i++) { let s = 0, c = 0; for (let j = -MODEL.envelope.smoothFrames; j <= MODEL.envelope.smoothFrames; j++) { const v = a[i + j]; if (v !== undefined) { s += v; c++; } } frames[i][k] = s / c; }
  }
  return { frames, segs, total };
}

// THE VOICE SOURCE, in three parts that can each be turned off to hear what it is doing. All three are
// differences WITHIN one larynx -- which is the point: two tracks of the same voice sum to two people or,
// worse, to a comb filter, where a real voice varies cycle to cycle and stays one voice.
//   aspiration     breath noise pulses with the glottis instead of running flat under it
//   openQuotient   how long the folds stay open varies per cycle, and with how breathy the voice is
//   diplophonia    creak as two interleaved pulse trains -- alternate cycles long and quiet -- not as noise
export const SOURCE = {
  aspiration: true, openQuotient: true, diplophonia: true,               // the glottal source
  undershoot: true, interaction: true, bandwidths: true, effort: true,   // the tract
  lf: true, trachea: true, piriform: true,                               // the source's own shape
  durations: true, reduction: true, fujisaki: true,                      // rhythm and tune
  centrePitch: true, vowelSpace: true, chink: true,                      // what makes a woman not a small man
  phonation: true,                                                       // how cleanly the folds close, syllable by syllable
  measured: true,                                                        // defaults fitted to recordings: pace, closure, consonant level
  microprosody: true, breathIn: true, air: true,                         // the speaker
  upperFormants: true, phonemeBw: true, lateral: true, fricZeros: true, sinuses: true,   // each sound's own colour, damping and antiformants
  sineVoicing: true, femaleTract: true, f1Floor: true, anchoredClosure: true, correlatedJitter: true, voicedH: true, voicingTails: true, trachea2: true, intrinsicPitch: true,   // fitted against recorded women
};

// VOWEL REDUCTION, by language. An unstressed vowel is not a short stressed one: its TARGET moves toward the
// middle of the mouth. English, Russian and German do it heavily (it is most of their rhythm); French, Spanish
// and Italian barely at all, which is a large part of why they sound "clear" to an English ear.
const REDUCE = { en: .42, ru: .46, de: .30, nl: .30, pt: .35, fr: .06, es: .05, it: .05 };

// HOW MUCH OF AN ADULT WOMAN'S TRACT A VOICE HAS, 0-1, read off its formant scale: nothing for a man (1.0), all
// of it around 1.15-1.2, and fading out again toward a child (1.3+). A woman is not a man scaled by 1.17 -- her
// pharynx is shorter in proportion to her mouth, her folds do not close along their whole length -- and a child
// is not a small woman either; uniform scaling is roughly TRUE of a child, which is why that voice already
// convinced and these did not.
const adultFemale = (fs) => { const a = MODEL.tract.adultFemale; return clamp((fs - a.from) / a.riseOver, 0, 1) * clamp((a.until - fs) / a.fallOver, 0, 1); };

// how fast an articulator chases its target, ms: the tongue body (F2) is the slowest thing in the mouth
const TAU_F = [45, 58, 40];
// BANDWIDTHS FOLLOW THEIR FORMANT. A resonance loses more as it rises, so one fixed table rings: it gives an
// /i/'s 280Hz F1 the same 60Hz width as an /a/'s 750Hz one. [constant, per Hz]
// (F3 upward were first set at twice this; fitted against recorded speakers the search drove them to its floor.
// Real brightness is HARMONIC -- narrow upper formants ringing on an abruptly closing source -- not wide ones.)
const BW = [[45, .060], [50, .045], [40, .028], [60, .024], [70, .024], [80, .024]];
// ============================================================================
// THE MODEL: every number the engine used to carry inline, in one place and by
// name. Nothing here is a voice -- a voice is a set of GLOBALS -- these are the
// engine's own constants: how long a burst lasts, how far a vowel shortens
// before a voiceless consonant, the time constants of the intonation model,
// the shape of the phonation track. They are plain data: getConfig() returns
// them with every table, setConfig() lays an edited copy back over them, and
// speech.html edits them live. (FRAME_MS and the sample rate are not here:
// they are the grid the renderer is built on, not properties of speech.)
// ============================================================================
export const MODEL = {
  schwa: SCHWA,
  pace: { measuredRate: 1.3, leadSilenceMs: 60, tailSilenceMs: 80 },
  segments: {
    stressDur: 1.3, longDur: 1.6, aspiratedVotMs: 85, aspiratedFricScale: 1.2, fricDefaultMs: 80,
    affricateClosureMs: 40, affricateFricMs: 65,
    vowel: { avStressed: 1, avUnstressed: .85, transInMs: 45, transOutMs: 45 },
    stop: { voicebarAv: .3, burstMs: 8, voicedBurstScale: .5, finalBurstScale: .5, votMinMs: 10, aspirationAh: .7 },
    fric: { voicedAv: .45, hAh: .9 },
    approx: { av: .55, F1: 330, af: .25 },
    nasal: { av: .6, F1: 250, F3: 2500, transMs: 35 },
    liquid: { av: .8, transMs: 50 },
    tap: { av: .4, transMs: 25 },
    trill: { av: .7, transMs: 25 },
    palatalGlide: { ms: 30, F1: 300, F2: 2100, F3: 2800, transInMs: 15, transOutMs: 30, minF2: 1950 },
    locusF1: { nasal: 250, other: 220 },
  },
  durations: { threeSyllables: .86, twoSyllables: .94, functionWord: .82, beforeVoiced: 1.18, beforeVoiceless: .86, beforeCluster: .9, inCluster: .85,
               syllabic: 1.45 },   // (measured on a labelled German speaker: nasals ran 80ms where the rules gave 55 -- a third of them were whole syllables)
  reduction: { byLanguage: REDUCE, otherLanguages: .2, longVowel: .3, precisionFloor: .8 },
  transitions: { defaultMs: 40, maxShareOfSegment: .45 },
  intonation: {
    classic: { declination: .45, accentCentre: .35, accentWidthShare: .6, accentWidthMs: 60, riseShare: .55, fallShare: 1.3, downstep: .87, sharpness: 3 },
    tonal: { octavesPerRange: 2.2, declination: .06 },
    fujisaki: { phraseGain: .7, accentGain: 1.05, baseDrop: .42, alpha: 2.2, beta: 18, ceiling: .9, phrasePauseMs: 150, phraseTailMs: 100,
                phraseLeadMs: 120, accentLeadMs: 30, accentLagMs: 20, downstep: .92 },
    // INTRINSIC PITCH: a high vowel is said about a semitone above a low one by every speaker of every language --
    // the tongue pulls on the larynx. Semitones per `perHz` of F1 away from `centreF1`, within +-`max`.
    intrinsic: { semitones: .7, perHz: 250, centreF1: 500, max: 1.1 },
    microprosody: { afterVoiced: -.055, afterVoiceless: .045, windowMs: 110, decayMs: 45, voicedAv: .2 },
    drift: { slowHz: .7, slowShare: .6, fastHz: 1.9, fastShare: .4 },
    finalRiseMinMs: 60, centreOnAv: .3,
    utterance: { keyFloor: .97, keySpread: .06, questionRise: 30, exclaimStress: 1.35, exclaimFall: 8 },
  },
  tract: {
    f6: 5500, tauMs: TAU_F, tauLead: .8, precisionFloor: .5, formantMin: 90, formantMax: 5200,
    bandwidths: BW, legacyBandwidths: [60, 90, 150, 200, 250, 300],
    vowelSpace: { f1: .05, f1Centre: 500, f2: .12, f2Centre: 1400 },
    adultFemale: { from: 1, riseOver: .15, until: 1.32, fallOver: .1 },
    interaction: { b1Hz: 130, f1Share: .012 },
    breathB1: .5, chinkB1: .5, chinkUpper: .12,
    nasal: { poleHz: 270, poleBw: 120, zeroHz: 1500, zeroBw: 300, gain: .8, twangZeroHz: 1600,
             // the maxillary and sphenoid SINUSES hang off the nasal passage as side cavities: each is a zero with a pole
             // just above it, fixed for a given head whatever is being said -- they are what makes one person's /m/ theirs
             sinuses: [{ zeroHz: 620, zeroBw: 90, poleHz: 710, poleBw: 110 }, { zeroHz: 1320, zeroBw: 140, poleHz: 1440, poleBw: 160 }] },
    // an adult woman's tract is not a man's times 1.17: the pharynx is shorter in proportion, so F1 sits higher than
    // the uniform scale puts it and F3 upward lower (measured vowels: F1 x1.22-1.28, F2 x1.17, F3 x1.12)
    femaleTract: { f1: .06, f3: -.04, upper: -.04 },
    // NOBODY SAYS A 280Hz /i/ in running speech. The table's close vowels are citation forms; measured speakers keep
    // F1 above ~350 (men) / ~440 (women) / ~470 (children) -- partly because a formant below the second harmonic has
    // nothing to ring on. A soft floor: a vowel or glide whose scaled F1 is under hz x scale is lifted `share` of the way.
    f1Floor: { hz: 400, share: .65 },
    colourTauMs: 38,                                   // how fast f4/f5, the bandwidth factors and a lateral's zero come and go
    // (a side branch is a zero AND a pole just above it; the pair is levelled half way between its gain below and above)
    lateral: { depth: .85, poleRatio: 1.2, poleBw: 240 },
    // (a fricative's zero is a NOTCH -- a pole at the same frequency, poleBwRatio times as wide, levels everything away
    // from it. A bare zero climbs 12dB an octave above itself: it turned sh into a thin hiss at 8kHz.)
    fricZero: { depth: .9, poleBwRatio: 5 },
    piriform: { hz: 4500, bw: 420, depth: .75 },
    trachea: { poleHz: 640, poleBw: 280, zeroHz: 1450, zeroBw: 340, mix: .35, breathBase: .35, max: .5,
               // (trachea2) the next resonance up, and a shorter windpipe for a woman: 640/1450/2100 -> ~740/1670/2400
               pole2Hz: 2100, pole2Bw: 350, zero2Hz: 2400, zero2Bw: 420, female: .15 },
  },
  source: {
    oq: { base: .58, perBreath: .22, breathCentre: .2, female: .24, femaleLegacy: .08, min: .46, max: .88, jitter: .04, loudness: .05, loudnessCentre: .7,
          cycleMin: .4, cycleMax: .9, rosenberg: .6 },
    ra: { reference: .003, referenceLegacy: .014, tiltPerOctave: 5, perBreath: .8, effort: 2.2, laxUp: 1.6, laxDown: .55 },
    rk: { man: .22, female: .14, legacy: .34 },
    // A LARYNX HAS MEMORY. Jitter and shimmer drawn afresh every cycle are white noise on the pitch: the rough edge of a
    // hoarse voice. In a healthy one most of the irregularity is slow -- muscle tension and breath pressure wandering
    // over tens of cycles -- so each cycle resembles the last. `slowShare` of the variance moves into a process that
    // keeps `correlation` of itself from one cycle to the next (.9 ~ a memory of ten cycles); the total stays the same.
    perturbation: { correlation: .9, slowShare: .75 },
    // SINUSOIDAL VOICING (Klatt's AVS): dB added to the pulse's own fundamental. Folds that never quite meet let air
    // through all cycle long, and that flow swells and sinks once per cycle -- a strong first harmonic that costs
    // neither brightness nor periodicity, which no open quotient can give: measured, a recorded woman had H1-H2 of
    // 7dB WITH a bright spectrum and a clean voice, and the LF pulse could reach any two of the three
    sine: { db: 4, female: 0, perBreath: 0, maxDb: 12 },
    effort: { centreAv: .85, oq: .3, tiltDb: 16 },
    creak: { fromShare: .7, overShare: .3, f0Drop: .35, jitter: .12, amp: .25, oq: .25, altPeriod: .22, altAmp: .3 },
    aspiration: { floor: .3, swing: .7, gain: 1.75, ahGain: .35, breathGain: .12, voicedAv: .05 },
    chinkNoise: { hz: 2000, gain: .3 },
    air: { hz: 4500, base: .05, perBreath: .16, ah: .5, av: .3 },
    tilt: { cutoffHz: 8000, dbPerOctave: 4, referenceDb: 9, rosenbergGain: 40 },
    voicebar: { keep: .985, take: .015, gain: 6 },
    outputGain: .9, normaliseTo: .8, normaliseOnAv: .3,
  },
  // (voicing does not stop dead at a voiceless consonant: the folds are still swinging as they part. tailMs of it, breathy)
  voicing: { tailMs: 18, tailAv: .25, tailLax: 1.2, hAv: .45, hAh: .6 },
  phonation: { stressed: -.45, unstressed: .35, sonorant: .1, other: .5, finalMs: 380, finalLax: .8, wander: .22, wanderHz: .9, phrasePauseMs: 150, tailMs: 80,
               noiseUp: 4, noiseDown: .9, jitter: 1.6, jitterMin: .5, jitterMax: 3, oq: .07 },
  consonants: { fricGain: .28, burstGain: .9, measuredBoost: 2.8, voicedFloor: .45, voicedSwing: .55, sibilantAboveHz: 2500,
                pop: { keep: .6, take: .4, gain: 1.2 }, rumble: { keep: .97, take: .03, gain: 9 } },
  envelope: { voicedAv: .05, breathFinalBeforeMs: 140, breathFinalAfterMs: 60, breathFinalGain: .6, breathFinalRampMs: 100, breathFinalOnAv: .3, smoothFrames: 2 },
  inhale: { minMs: 240, varMs: 90, gapMs: 45, minLineMs: 1200, lowHz: 620, lowBw: 900, highHz: 2400, highBw: 2000, lowGain: 2.2, highGain: .5,
            base: .05, perBreath: .09, shape: 1.6, tail: .85 },
  // PAIRS: what a diphone table is in a rule-based engine. The engine derives every consonant-vowel boundary
  // from the consonant's place (PLACES: a locus equation) and the segment's transition time; an entry here
  // overrides that for ONE pair, written "k>i" (the k before an i) or "a>n". Fields, all optional: F2, F3
  // (the locus the vowel is pulled to at that boundary, Hz) and transMs (how long the vowel takes over it).
  pairs: {},
};
const bwOf = (k, f) => BW[k][0] + BW[k][1] * f;


// ============================================================================
// THE LF SOURCE (Liljencrants-Fant). The Rosenberg pulse above is a shape with
// no physics in it: opening, closing, silence, and a separate filter afterwards
// to make it dark or bright. The LF model is the glottal flow DERIVATIVE itself,
// and its RETURN PHASE -- how abruptly the folds finish closing, `ta` -- is the
// single parameter that separates pressed from modal from breathy and loud from
// soft. With it the spectral tilt is not filtered on afterwards; it falls out of
// the shape, which is why a voice modelled this way changes colour the way a
// person does when they lean on a word.
//
// Fant's Rd collapses the four LF parameters into one "shape" number: about 0.4
// is pressed, 1 modal, 2.5 lax and breathy. The rest is arithmetic -- eps solved
// so the return phase lands at zero, alpha so the pulse has no net flow over the
// cycle (a glottis cannot pump air one way). Both are solved once per distinct
// Rd and cached; per sample it is an exponential and a sine.
// ============================================================================
const LF_CACHE = new Map();
// The pulse is set by THREE numbers, not one. Fant's Rd is a regression line through a population -- it ties how
// long the folds stay open to how abruptly they shut, so a strong fundamental always costs the high harmonics.
// Measured against recordings, real voices do not sit on that line: a woman has a strong fundamental AND a
// bright upper spectrum (folds open long, but snapping shut), which no value of Rd can produce. So:
//   oq   the instant of closure as a share of the cycle -- how long the folds are open; sets H1 against H2
//   ra   the return phase as a share of the cycle -- how abruptly they finish closing. Its corner frequency is
//        f0 / (2 pi ra): 1.5% on a 200Hz voice keeps the harmonics up to 2kHz, 4% loses them from 800Hz
//   rk   the skew of the open phase (how much longer opening takes than closing)
function lfShape(oq, ra, rk = .34) {
  const te = clamp(oq, .3, .9), ta = clamp(ra, .002, Math.min(.12, (1 - te) * .8));
  const key = Math.round(te * 200) + "|" + Math.round(ta * 2000) + "|" + Math.round(rk * 50);
  const hit = LF_CACHE.get(key);
  if (hit) return hit;
  const tp = te / (1 + rk), wg = Math.PI / tp;
  let eps = 1 / ta;                                    // eps*ta = 1 - exp(-eps*(1-te))
  for (let i = 0; i < 8; i++) { const ex = Math.exp(-eps * (1 - te)); eps -= (eps * ta - 1 + ex) / (ta + (1 - te) * ex); }
  const exT = Math.exp(-eps * (1 - te));
  const areaRet = -(1 / (eps * ta)) * ((1 - exT) / eps - (1 - te) * exT);
  const sinTe = Math.sin(wg * te), cosTe = Math.cos(wg * te);
  const area = (al) => {
    const E0 = -1 / (Math.exp(al * te) * sinTe);
    return E0 * (Math.exp(al * te) * (al * sinTe - wg * cosTe) + wg) / (al * al + wg * wg) + areaRet;
  };
  let lo = -40, hi = 80, alpha = 0;                    // alpha by bisection: no net flow over the cycle
  if (area(lo) * area(hi) < 0) {
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (area(lo) * area(m) <= 0) hi = m; else lo = m; }
    alpha = (lo + hi) / 2;
  }
  const v = { alpha, wg, te, ta, eps, exT, E0: -1 / (Math.exp(alpha * te) * sinTe), c1: 0, s1: 0 };
  { const n = 512; let c = 0, q = 0;                     // the pulse's own first harmonic, so that sinusoidal voicing adds to it in phase
    for (let i = 0; i < n; i++) { const ph = (i + .5) / n, y = ph < te ? v.E0 * Math.exp(alpha * ph) * Math.sin(wg * ph) : -(1 / (eps * ta)) * (Math.exp(-eps * (ph - te)) - exT);
      c += y * Math.cos(2 * Math.PI * ph); q += y * Math.sin(2 * Math.PI * ph); }
    v.c1 = 2 * c / n; v.s1 = 2 * q / n; }
  if (LF_CACHE.size > 4000) LF_CACHE.clear();
  LF_CACHE.set(key, v);
  return v;
}

// frames -> samples: cascade formants for voicing and aspiration, parallel resonators for frication and bursts; a
// frame may also carry pop (a broadband blast straight out), rumble (low chest noise), creak (vocal fry) and jit (extra
// jitter, %) -- the non-verbal sounds' -- and P.normAll levels on the whole signal (a blast may be the loudest part)
function render(P, G) {
  const N = Math.ceil(P.total / 1000 * SR), out = new Float32Array(N), spf = SR * FRAME_MS / 1000, fr = P.frames, last = fr.length - 1;
  const nf = G.formants, casc = Array.from({ length: 6 }, resonator), nasalPole = resonator(), nasalZero = antiresonator();
  // the model's numbers, read once: this loop runs 32,000 times a second and should not go looking for them
  const MS_ = MODEL.source, MT = MODEL.tract, PH = MODEL.phonation, MC = MODEL.consonants;
  const OQ = MS_.oq, RA = MS_.ra, EF = MS_.effort, CR = MS_.creak, AS = MS_.aspiration, AIR = MS_.air, TL = MS_.tilt, VB = MS_.voicebar, TC = MT.trachea, IA = MT.interaction;
  const voicedAv = AS.voicedAv, outGain = MS_.outputGain, pirDepth = MT.piriform.depth, nasalGain = MT.nasal.gain, nasalZeroHz = MT.nasal.zeroHz, nasalZeroBw = MT.nasal.zeroBw;
  const tiltCut = (db) => Math.exp(-2 * Math.PI * Math.min(TL.cutoffHz * Math.pow(2, (db + TL.referenceDb) / TL.dbPerOctave), SR * .45) / SR);
  const nBands = SOURCE.fricZeros ? 3 : 2, par = [bandpass(100), bandpass(100), bandpass(100)], bwBase = MT.legacyBandwidths;
  const latZero = antiresonator(), latPole = resonator(), latGain = 1 / MT.lateral.poleRatio, fricZero = antiresonator(), fricPole = resonator(), latDepth = MT.lateral.depth, fzDepth = MT.fricZero.depth;
  const sinus = SOURCE.sinuses ? MT.nasal.sinuses.map((c) => { const z = antiresonator(), q = resonator(), k = G.formantScale * (G.sinus ?? 1); z.set(c.zeroHz * k, c.zeroBw); q.set(c.poleHz * k, c.poleBw); return { z, q, g: c.zeroHz / c.poleHz }; }) : [];
  let fzOn = false;
  let tiltA = tiltCut(G.tilt);   // spectral tilt: a one-pole on the source, re-cut per frame with effort
  nasalPole.set(MT.nasal.poleHz * G.formantScale, MT.nasal.poleBw);
  // OPEN QUOTIENT: the share of the cycle the folds are open. A breathy voice holds them open longer and
  // closes them more gently, which is most of what "soft" means in a voice; a pressed one snaps them shut.
  // .6 is the value the pulse was hard-coded to, and is what a voice of ordinary breathiness still gets.
  // (women fitted at the top of the range, .88, men at .48-.62: her folds are open for most of the cycle)
  const oqBase = G.oq ?? clamp(OQ.base + OQ.perBreath * (G.breath - OQ.breathCentre) + (SOURCE.measured ? OQ.female : OQ.femaleLegacy) * adultFemale(G.formantScale), OQ.min, OQ.max);
  const hpA = Math.exp(-2 * Math.PI * AIR.hz / SR);              // the air path: a one-pole high pass on the noise
  // the subglottal system, coupled in through the open glottis, and the piriform sinuses beside the larynx
  const trachP = resonator(), trachZ = antiresonator(), pir = antiresonator();
  const tK = SOURCE.trachea2 ? 1 + TC.female * adultFemale(G.formantScale) : 1, trachP2 = resonator(), trachZ2 = antiresonator();
  trachP.set(TC.poleHz * tK, TC.poleBw); trachZ.set(TC.zeroHz * tK, TC.zeroBw); trachP2.set(TC.pole2Hz * tK, TC.pole2Bw); trachZ2.set(TC.zero2Hz * tK, TC.zero2Bw);
  const SV = MS_.sine, sineDb = SOURCE.sineVoicing ? clamp(G.fundamental ?? SV.db + SV.female * adultFemale(G.formantScale) + SV.perBreath * G.breath, 0, SV.maxDb) : 0, sineK = Math.pow(10, sineDb / 20) - 1; pir.set(MT.piriform.hz * G.formantScale, MT.piriform.bw);
  let lf = lfShape(.6, .015);
  // the return phase from the voice's tilt and breath: -9 is the reference (1.4% of the cycle), a soft -15 is
  // about 3%, a tense -4 about 0.7%. A voice may simply state `ra`.
  // (the reference was first guessed at 1.4%; three of four recorded speakers fitted at 0.2-0.3%, with the search
  // pinned against its floor until the floor was lowered. People shut their folds far more abruptly than the
  // textbook "modal" figure suggests, and that abruptness is where the brightness of a real voice comes from.)
  const raRef = SOURCE.measured ? RA.reference : RA.referenceLegacy;
  const raBase = G.ra ?? raRef * Math.pow(2, -(G.tilt + TL.referenceDb) / RA.tiltPerOctave) * (1 + RA.perBreath * G.breath);
  const rkBase = G.rk ?? (SOURCE.measured ? MS_.rk.man + MS_.rk.female * adultFemale(G.formantScale) : MS_.rk.legacy);   // men's pulses fitted more skewed than women's
  // and the consonants: with the fricatives in, the recordings carry 5-8dB more above 4kHz than the synthesiser
  // did in every one of the four fits -- no voice parameter touches that, the noise paths were simply too quiet
  const consK = SOURCE.measured ? MC.measuredBoost : 1;
  // THE GLOTTAL CHINK. A woman's folds typically do not close at the back, so air leaks through the whole cycle:
  // the first formant is damped much more than a man's (wider B1 -- which is also what stops a single harmonic
  // ringing on it and the vowel whistling as the pitch moves), and her breathiness is NOISE replacing the upper
  // harmonics over a reasonably firm pulse, not a lax pulse. Putting it in the pulse made her dark and flutey,
  // which is right for a child and wrong for an adult.
  const sC = SOURCE.chink ? adultFemale(G.formantScale) : 0;
  const hp2A = Math.exp(-2 * Math.PI * MS_.chinkNoise.hz / SR), chinkGain = MS_.chinkNoise.gain;
  let hp2X = 0, hp2Y = 0;
  // (see model.source.perturbation) -- one slow process each for the period, the amplitude and the open quotient
  const PT = MS_.perturbation, slow = [0, 0, 0], kSlow = Math.sqrt(PT.slowShare), kFast = Math.sqrt(1 - PT.slowShare), keepP = PT.correlation, drive = Math.sqrt(1 - keepP * keepP);
  const wander = SOURCE.correlatedJitter ? (i, g) => { slow[i] = keepP * slow[i] + drive * g; return kFast * g + kSlow * slow[i]; } : (i, g) => g;
  let cycShift = 0;
  let phase = 1, period = SR / G.f0, cycAmp = 1, lastV = 0, tiltY = 0, lpY = 0, rmY = 0, popY = 0, cyc = 0, oq = oqBase;
  let hpX = 0, hpY = 0;
  for (let i = 0; i < N; i++) {
    const fi = i / spf, k = Math.min(last, Math.floor(fi)), u = fi - k, a = fr[k], b = fr[Math.min(k + 1, last)];
    const f0 = lerp(a.f0, b.f0, u), av = lerp(a.av, b.av, u), ah = lerp(a.ah, b.ah, u), af = lerp(a.af, b.af, u), nasal = lerp(a.nasal, b.nasal, u);
    // voice source: a Rosenberg pulse per cycle, jitter/shimmer per cycle; tremor and a phrase-final creak (pitch drops, cycles go irregular)
    phase += 1 / period;
    if (phase >= 1) {
      phase -= 1;
      const trem = 1 + G.tremor / 100 * Math.sin(2 * Math.PI * G.tremorRate * i / SR), creak = Math.max(G.creak * clamp((i / N - CR.fromShare) / CR.overShare, 0, 1), a.creak || 0);
      // DIPLOPHONIA. Vocal fry is not a noisy voice, it is two interleaved pulse trains: every other cycle
      // runs long and comes out quieter, which is the rattle you hear at the end of a relaxed phrase. Random
      // jitter alone only makes a voice sound rough.
      cyc++;
      const alt = SOURCE.diplophonia && (cyc & 1) ? 1 : 0;
      const laxJ = SOURCE.phonation ? clamp(1 + PH.jitter * (a.lax || 0), PH.jitterMin, PH.jitterMax) : 1;      // and a slack one is less regular too
      const gJ = wander(0, gauss()), gS = wander(1, gauss());
      period = Math.max(2, SR / (f0 * trem * (1 - CR.f0Drop * creak)) * (1 + ((G.jitter * laxJ + (a.jit || 0)) / 100 + creak * CR.jitter) * gJ)
                           * (1 + creak * CR.altPeriod * alt));
      cycAmp = (1 + G.shimmer * laxJ / 100 * gS) * (1 - creak * CR.amp * rnd()) * (1 - creak * CR.altAmp * alt);
      // the folds do not open the same amount twice; louder cycles are pressed a little harder
      const oqJ = OQ.jitter * wander(2, gauss());
      oq = SOURCE.openQuotient ? clamp(oqBase * (1 + oqJ) * (1 - OQ.loudness * (av - OQ.loudnessCentre)), OQ.cycleMin, OQ.cycleMax) : OQ.rosenberg;
      // the LF shape for this cycle. Effort presses the folds (shorter open phase) and snaps them shut (shorter
      // return); creak does the first without the second.
      if (SOURCE.lf) {
        const eff = SOURCE.effort ? av - EF.centreAv : 0, lax = a.lax || 0;
        lf = lfShape(oq * (1 - EF.oq * eff) * (1 - CR.oq * creak) * (1 + PH.oq * lax),
                     raBase * (1 - RA.effort * eff) * (lax > 0 ? 1 + RA.laxUp * lax : 1 + RA.laxDown * lax), rkBase);
        // THE CLOSURE KEEPS TIME, THE OPENING WANDERS. The cycle is excited where the folds snap shut; letting the
        // open phase vary from the START of the cycle moved that instant by the same 4% -- five times the voice's
        // jitter, hidden in a parameter that was meant to vary the pulse's shape. Measured: it cost 2dB of cepstral
        // peak in every voice. So a longer-open cycle opens earlier, and a shorter one later.
        cycShift = SOURCE.anchoredClosure && SOURCE.openQuotient ? lf.te * (1 / (1 + oqJ) - 1) : 0;
      }
    }
    // the Rosenberg pulse over its open phase: a raised cosine opening for two thirds of it, a quarter-cosine
    // closing for the last third (the abrupt closure is where the source's high harmonics come from)
    const op = oq * (2 / 3);
    // `pulse` is how OPEN the glottis is (what the noise paths and the tract interaction ride on); `voice` is
    // the flow's derivative, which is the sound. The LF model gives the second one directly.
    const lp = phase - cycShift;                         // (where this cycle is in ITS pulse: see cycShift)
    const pulse = SOURCE.lf
      ? (lp < 0 ? 0 : lp < lf.te ? .5 * (1 - Math.cos(Math.PI * lp / lf.te)) : 0)
      : phase < op ? .5 * (1 - Math.cos(Math.PI * phase / op))
      : phase < oq ? Math.cos(Math.PI / 2 * (phase - op) / (oq - op)) : 0;
    let voice;
    if (SOURCE.lf) {
      voice = lp < 0 ? 0 : lp < lf.te ? lf.E0 * Math.exp(lf.alpha * lp) * Math.sin(lf.wg * lp)
                     : -(1 / (lf.eps * lf.ta)) * (Math.exp(-lf.eps * (lp - lf.te)) - lf.exT);
      lastV = pulse;                                   // no separate tilt filter: the return phase IS the tilt
    } else {
      voice = (pulse - lastV) * TL.rosenbergGain; lastV = pulse;     // differentiated pulse ~ glottal flow derivative
      tiltY = tiltA * tiltY + (1 - tiltA) * voice; voice = tiltY;
    }
    // THE TRACHEA. While the folds are open the tract sees past them into the airway below, which adds its own
    // resonance and an antiresonance above it. It is the hollow note in a breathy voice, and it comes and goes
    // once per cycle -- the other half of the source-filter interaction.
    if (sineK > 0 && lf) voice += sineK * (lf.c1 * Math.cos(2 * Math.PI * phase) + lf.s1 * Math.sin(2 * Math.PI * phase));   // more of its own fundamental
    let trach = trachZ.run(trachP.run(voice)); if (SOURCE.trachea2) trach = trachZ2.run(trachP2.run(trach)) * (TC.pole2Hz / TC.zero2Hz);
    if (SOURCE.trachea) voice = lerp(voice, trach, Math.min(TC.max, TC.mix * pulse * (TC.breathBase + G.breath)));
    const trill = a.trill ? .5 + .5 * Math.cos(2 * Math.PI * a.trill * i / SR) : 1;
    let src = voice * av * cycAmp * trill;
    if (a.voicebar) { lpY = VB.keep * lpY + VB.take * src; src = lpY * VB.gain; }   // closed lips: only the lowest frequencies leak
    const noise = rnd() * 2 - 1;
    // ASPIRATION PULSES WITH THE GLOTTIS. Turbulence at the folds is made as the air goes through them, so
    // breath noise swells on the open phase and all but stops while they are shut; flat noise under a vowel
    // is the hiss that makes a synthetic voice sound like a synthetic voice. 1.75 keeps the noise's power
    // where it was, so this changes the texture and not the level. Unvoiced /h/ has no glottis to pulse with.
    // a slack glottis leaks far more air and a firm one hardly any: recorded voices swing ~10dB in how periodic
    // they are between a stressed vowel and a phrase end, and noise is most of that swing
    const laxU = lerp(a.lax || 0, b.lax || 0, u), laxN = laxU > 0 ? 1 + PH.noiseUp * laxU : 1 + PH.noiseDown * laxU;
    const aspMod = (SOURCE.aspiration && av > voicedAv ? (AS.floor + AS.swing * pulse) * AS.gain : 1) * laxN;
    src += noise * (ah * AS.ahGain + G.breath * av * AS.breathGain) * aspMod;   // aspiration and breathiness go through the cascade
    if (sC > 0) { hp2Y = hp2A * (hp2Y + noise - hp2X); hp2X = noise; src += hp2Y * G.breath * av * chinkGain * sC * aspMod; }   // ...and above 2kHz, where hers lives
    // AIR. Everything above the top formant leaves the cascade at nothing -- measured, a vowel here had 86dB
    // less energy in 5-8kHz than in the whole band, and a deep male voice 126dB, which is silence. A real
    // voice has breath noise up there the whole time it is speaking; it is most of what "presence" means, and
    // its absence is what makes a synthetic voice sound like it is behind glass. Straight out, past the tract.
    if (SOURCE.air) { hpY = hpA * (hpY + noise - hpX); hpX = noise; }
    if ((i & 7) === 0) {   // filter coefficients at 4 kHz control rate (formants glide over tens of ms)
      for (let f = 0; f < nf; f++) {
        let Ff = lerp(a.F[f], b.F[f], u);
        let Bf = (SOURCE.bandwidths ? bwOf(f, Ff) : bwBase[f]) * G.bw * (f === 0 ? (1 + MT.breathB1 * G.breath) * (1 + MT.chinkB1 * sC) : 1 + MT.chinkUpper * sC)
               * (f >= 2 ? (G.bwHi ?? 1) : 1) * (f < 3 && a.B && b.B ? lerp(a.B[f], b.B[f], u) : 1);
        // SOURCE-FILTER INTERACTION. While the folds are open the trachea is coupled to the tract through
        // them and the first formant leaks into it: B1 widens by something like a hundred Hz and F1 dips, once
        // per glottal cycle. Nothing in a classic cascade moves within the cycle -- which is a good part of
        // why one sounds like a filter rather than a throat.
        if (f === 0 && SOURCE.interaction && av > voicedAv) { const o = pulse * av; Bf += IA.b1Hz * o; Ff *= 1 - IA.f1Share * o; }
        casc[f].set(Ff, Bf);
      }
      // EFFORT. A loud syllable is not a quiet one turned up: the folds shut harder and the source itself gets
      // brighter. A single fixed tilt gives every syllable in the sentence the same colour.
      const eff = SOURCE.effort ? (av - EF.centreAv) * EF.tiltDb : 0;
      tiltA = tiltCut(G.tilt + eff);
      if (nasal > .01) nasalZero.set(lerp(a.anti || nasalZeroHz, b.anti || nasalZeroHz, u) * G.formantScale, nasalZeroBw);
      if (af > .001) { const burst = a.seg.kind === "burst"; a.fric.forEach((r, j) => { if (j < nBands) par[j].set(r[0] * (burst ? 1 : G.formantScale), r[1]); });
        fzOn = SOURCE.fricZeros && !!a.fz; if (fzOn) { fricZero.set(a.fz[0] * G.formantScale, a.fz[1]); fricPole.set(a.fz[0] * G.formantScale, a.fz[1] * MT.fricZero.poleBwRatio); } }
      if (a.latZ || b.latZ) { const z = a.latZ || b.latZ; latZero.set(z[0] * G.formantScale, z[1]); latPole.set(z[0] * MT.lateral.poleRatio * G.formantScale, MT.lateral.poleBw); }
    }
    let x = src;
    for (let f = 0; f < nf; f++) x = casc[f].run(x);
    // A LATERAL'S ZERO: the air goes round the sides of the tongue and the pocket behind the tip takes a bite out
    // of the spectrum near 2 kHz -- without it an /l/ is only a vowel with odd formants
    if (a.lat || b.lat) x = lerp(x, latPole.run(latZero.run(x)) * latGain, lerp(a.lat || 0, b.lat || 0, u) * latDepth);
    if (nasal > .01) { let nz = nasalZero.run(nasalPole.run(x)); for (const c of sinus) nz = c.q.run(c.z.run(nz)) * c.g; x = lerp(x, nz * nasalGain, nasal * G.nasalMix); }
    // THE PIRIFORM SINUSES: two pear-shaped recesses either side of the larynx that every human spectrum has a
    // notch from, around 4-5kHz, and no formant synthesiser has unless you put it there.
    const pirY = pir.run(x);
    if (SOURCE.piriform) x = lerp(x, pirY, pirDepth);
    let y = 0;   // the parallel noise path
    if (af > .001 && a.fric.length) {
      const burst = a.seg.kind === "burst", gain = (burst ? G.burstGain * MC.burstGain : G.fricGain * MC.fricGain) * af * consK;
      let mod = av > voicedAv ? MC.voicedFloor + MC.voicedSwing * pulse : 1;   // voiced fricatives: the noise pulses with the glottis
      if (a.seg.trillNoise) mod *= .5 + .5 * Math.cos(2 * Math.PI * a.seg.trillNoise * i / SR);
      for (let j = 0; j < Math.min(nBands, a.fric.length); j++) y += par[j].run(noise) * a.fric[j][2] * gain * mod;
      if (fzOn) y = lerp(y, fricPole.run(fricZero.run(y)), fzDepth);
    }
    if (a.pop || b.pop) { popY = MC.pop.keep * popY + MC.pop.take * noise; y += popY * lerp(a.pop || 0, b.pop || 0, u) * MC.pop.gain; }   // a blast straight out of the mouth, its hiss rolled off above ~2.6 kHz (a cough, not static)
    if (a.rumble || b.rumble) { rmY = MC.rumble.keep * rmY + MC.rumble.take * noise; x += rmY * lerp(a.rumble || 0, b.rumble || 0, u) * MC.rumble.gain; }   // the chest behind it (~150 Hz)
    if (SOURCE.air) y += hpY * (AIR.base + AIR.perBreath * G.breath) * (ah * AIR.ah + av * AIR.av) * aspMod * (G.airLevel ?? 1);
    out[i] = x * outGain + y;
  }
  let peak = 1e-6;   // normalise on voiced frames only (a burst must not set the level) -- or on everything (normAll)
  for (let i = 0; i < N; i++) if (P.normAll || fr[Math.min(last, Math.floor(i / spf))].av > MS_.normaliseOnAv) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < N; i++) out[i] = clamp(out[i] * MS_.normaliseTo / peak, -1, 1);
  return out;
}

// ============================================================================
// NON-VERBAL SOUNDS in the speaker's own voice: a laugh, a crying fit, a cough,
// a sneeze -- built straight as the 5 ms frames plan() makes from phonemes and
// rendered by the same render(), so they carry the voice's pitch, throat and grain
// ============================================================================
export const VOCALS = ["laugh", "cry", "cough", "sneeze"];
// What makes each one recognisable -- and so what is modelled:
//   LAUGH: a very regular train of breath pulses, ~5 a second ("ha": a loud h, then a short open vowel with a sharp
//     attack and a falling tail), the pitch about twice the speaking voice, every call a little lower, softer and
//     later than the one before (the breath running out); then the tell-tale breath back in -- a noisy, high,
//     wavering inhaled voice -- and often a second, softer bout
//   CRY: a high wail through a stuffed nose, shaking (6-7 Hz tremolo in pitch and level), a voice break, sinking into
//     a creak; a stuttering breath out ("hu-hu-hu"); two or three convulsive gasps in, strangled and each cut off
//     dead by the glottis; sniffs
//   COUGH: a quick breath in; the glottis shut (silence) while the pressure builds; the blast -- a broadband crack,
//     air roaring through the open tract, the chest rumbling behind it -- then a rough, low voiced "uh" as the folds
//     close; two to four in a bout, each weaker
//   SNEEZE: two or three jerky breaths in, higher and louder each time ("ah... ah... AAH", the last cut off), a held
//     silence, then the explosion: a crack, a hiss through the teeth ("TSCH"), a voiced "oo" falling away; a sniff
const VA = { F1: 760, F2: 1260, F3: 2600 }, VE = { F1: 620, F2: 1350, F3: 2500 }, VU = { F1: 340, F2: 870, F3: 2350 }, VI = { F1: 330, F2: 2150, F3: 2900 }, VO = { F1: 560, F2: 1000, F3: 2450 };
const mixF = (a, b, u) => ({ F1: lerp(a.F1, b.F1, u), F2: lerp(a.F2, b.F2, u), F3: lerp(a.F3, b.F3, u) });
const SEG = { vowel: { kind: "vowel" }, fric: { kind: "fric" }, burst: { kind: "burst" } };
function vocalFrames(kind, G) {
  const frames = [], fs = G.formantScale, R = (a, b) => a + rnd() * (b - a), f0 = G.f0;
  // a stretch of ms: formants F (or u => formants), pitch f0 (Hz, [from, to] or u => Hz), voicing av, aspiration ah
  // (through the tract), frication af (through the `fric` bands [Hz, bw, gain]), pop, rumble, creak, jit (render),
  // nasal (a stuffed nose), level g, shaped by env(u)
  const piece = (ms, o) => {
    const n = Math.max(1, Math.round(ms / FRAME_MS)), g = o.g ?? 1;
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 0, e = (o.env ? o.env(u) : 1) * g;
      const f = typeof o.f0 === "function" ? o.f0(u) : Array.isArray(o.f0) ? lerp(o.f0[0], o.f0[1], u) : o.f0 ?? f0;
      const F = typeof o.F === "function" ? o.F(u) : o.F ?? SCHWA;
      frames.push({ t: frames.length * FRAME_MS, seg: SEG[o.seg ?? "vowel"], f0: f, av: (o.av ?? 0) * e, ah: (o.ah ?? 0) * e, af: (o.af ?? 0) * e,
        pop: (o.pop ?? 0) * e, rumble: (o.rumble ?? 0) * e, creak: o.creak ?? 0, jit: o.jit ?? 0, nasal: o.nasal ?? 0, anti: o.nasal ? 1100 : 0,
        F: [F.F1 * fs * G.f1Scale, F.F2 * fs * G.f2Scale, F.F3 * fs, G.f4 * fs, G.f5 * fs, 5500 * fs], fric: o.fric ?? [], trill: 0, voicebar: false });
    }
  };
  const rest = (ms, breath = 0) => piece(ms, { ah: breath });
  const pulse = (att, fall = 3.2) => (u) => (u < att ? u / att : Math.exp(-(u - att) * fall));   // a pulse of breath: sharp in, dying away
  const sniff = (g) => piece(R(160, 240), { seg: "fric", af: .9, ah: .15, nasal: 1, g, fric: [[1900, 1800, 1], [4200, 3000, .5]],
                                            env: (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), .7) * (u > .9 ? (1 - u) * 10 : 1) });
  if (kind === "laugh") {
    const bout = (n, hi, g0) => {
      let ioi = R(185, 215);
      for (let k = 0; k < n; k++) {
        const d = k / Math.max(1, n - 1), f = hi * (1 - .28 * d) * R(.95, 1.05), g = g0 * (1 - .45 * d), V = mixF(VA, VE, R(0, .7));
        const hMs = R(28, 45), vMs = R(65, 100);
        piece(hMs, { F: V, ah: 1.1, g, env: (u) => .5 + .5 * u });   // the h: breath rushing out through the open mouth
        piece(vMs, { F: V, av: 1, ah: .45, g, jit: 2 + 3 * d, creak: d > .7 ? .4 : 0, f0: (u) => f * (1 + .06 * Math.sin(Math.PI * u) - .1 * u), env: pulse(.12) });
        rest(Math.max(20, ioi - hMs - vMs), .05 * g);
        ioi *= R(1.03, 1.08);   // slowing as the breath runs out
      }
    };
    bout(5 + Math.floor(rnd() * 5), f0 * R(1.9, 2.2), 1);
    piece(R(280, 420), { F: (u) => mixF(VI, VE, u), ah: .9, av: .28, jit: 6, g: .75, f0: (u) => f0 * 2.3 * (1 + .08 * Math.sin(u * 9)), env: (u) => Math.pow(Math.sin(Math.PI * u), .6) });   // the breath back in
    if (rnd() < .55) { rest(R(60, 140)); bout(2 + Math.floor(rnd() * 3), f0 * R(1.6, 1.8), .7); }   // a few more, softer
  } else if (kind === "cry") {
    sniff(.5); rest(R(80, 140));
    const cycles = rnd() < .6 ? 2 : 1;
    for (let c = 0; c < cycles; c++) {
      const f = f0 * R(1.55, 1.85), ms = R(700, 1100) * (c ? .8 : 1), brk = R(.45, .7), V0 = c % 2 ? VO : VA, trem = (u) => Math.sin(2 * Math.PI * 6.5 * u * ms / 1000);
      // the wail: up, held trembling, a voice break down, then sinking into a creak
      piece(ms, { F: (u) => mixF(V0, VU, u * u), av: .95, ah: .5, nasal: .35, jit: 5,
                  f0: (u) => f * (1 + .18 * Math.min(1, u * 6) - .3 * Math.max(0, u - .6)) * (u > brk ? .82 : 1) * (1 + .06 * trem(u)),
                  env: (u) => Math.min(1, u * 8) * (1 - .5 * u) * (1 + .35 * trem(u)) });
      piece(ms * .18, { F: VU, av: .6, ah: .5, nasal: .35, creak: .8, jit: 6, f0: [f * .7, f * .55], env: (u) => 1 - u });
      rest(R(50, 90));
      const st = 3 + Math.floor(rnd() * 2);   // the stuttering breath out: "hu-hu-hu"
      for (let k = 0; k < st; k++) { piece(R(55, 75), { F: VE, av: .55, ah: .7, nasal: .3, jit: 5, g: .8, f0: f * (.9 - .05 * k), env: pulse(.2) }); rest(R(45, 70)); }
      const sb = 2 + Math.floor(rnd() * 2);   // the sobs: gasps in -- mostly breath, a strangled rough voice under it -- each cut off by a catch
      for (let k = 0; k < sb; k++) {
        piece(R(80, 110), { F: VI, ah: 1.2, av: .25, jit: 12, g: .85, f0: f * R(1.15, 1.35), env: (u) => Math.min(1, u * 5) });
        piece(10, { seg: "burst", pop: .35, F: VI, g: .85 });   // the catch: the glottis snapping shut
        rest(R(60, 100));
      }
      if (rnd() < .5) sniff(.45);
      rest(R(120, 220));
    }
  } else if (kind === "cough") {
    piece(R(120, 200), { F: VE, ah: .45, g: .5, env: (u) => Math.sin(Math.PI * u) });   // the quick breath in
    const n = 2 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const g = 1 - .22 * k;
      rest(R(60, 110));   // the glottis shut, the pressure building
      piece(R(25, 40), { seg: "burst", F: VA, pop: 1.1, ah: 1.4, rumble: 1, af: .5, fric: [[1500, 2500, 1], [3200, 3000, .6]], g, env: (u) => Math.exp(-u * 2.5) });   // the blast
      piece(R(80, 130), { F: (u) => mixF(VA, VE, u), ah: 1, rumble: .5, g, env: (u) => Math.exp(-u * 2.2) });   // air roaring out
      piece(R(60, 110), { F: VE, av: .55, ah: .5, creak: .7, jit: 4, f0: [f0 * .85, f0 * .7], g: g * .8, env: (u) => Math.pow(1 - u, 1.3) });   // the folds closing: a rough "uh"
      rest(R(140, 300));
    }
  } else if (kind === "sneeze") {
    const nIn = 2 + Math.floor(rnd() * 2);   // the build-up: jerky breaths in, deeper, higher and louder each time
    for (let k = 0; k < nIn; k++) {
      const d = (k + 1) / nIn, ms = R(150, 220) + 180 * d, f = f0 * (1.3 + .5 * d);
      piece(ms, { F: VA, ah: .9, av: .3 + .3 * d, jit: 6, f0: [f, f * 1.18], g: .35 + .35 * d, env: (u) => Math.min(1, u * 4) * (k === nIn - 1 && u > .92 ? 0 : 1) });
      if (k < nIn - 1) rest(R(110, 190));
    }
    rest(R(110, 190));   // held: the glottis locked
    piece(18, { seg: "burst", pop: 1.6, ah: 1.2, af: 1.2, F: VE, fric: [[3200, 2500, 1], [6200, 3000, .9]], g: 1.3 });   // the crack
    piece(R(120, 170), { seg: "fric", F: VU, af: 1.4, ah: .8, fric: [[3000, 1800, 1], [5800, 3000, .8]], g: 1.2, env: (u) => Math.exp(-u * 1.1) });   // "TSCH"
    piece(R(170, 260), { F: (u) => mixF(VU, VE, u), av: .9, ah: .55, jit: 3, g: .9, f0: [f0 * 1.7, f0 * .95], env: (u) => Math.pow(1 - u, 1.4) });   // "oo", falling away
    if (rnd() < .4) { rest(R(250, 400)); sniff(.4); }
  } else throw new Error(`speech: no non-verbal sound "${kind}"`);
  return { frames, segs: [], total: frames.length * FRAME_MS, normAll: true };
}
const VOCAL_GAIN = { laugh: 1, cry: .9, cough: 1.1, sneeze: 1.2 };
// the voice for them: rougher and breathier than for words, none of speech's slow drift or phrase-final habits
const vocalSamples = (kind, base) => {
  const G = { ...base, f0: base.f0 * (.97 + rnd() * .06), jitter: base.jitter * 1.5, shimmer: base.shimmer * 1.6, breath: Math.max(base.breath, kind === "cry" ? .45 : .3),
              drift: 0, finalRise: 0, creak: 0, tremor: 0 };
  return render(vocalFrames(kind, G), G);
};

// ============================================================================
// the speaker
// ============================================================================
// voice parameters from createSpeaker's options: a VOICES key, a parameter
// object (voiceFor), or the legacy { pitch Hz, scale, breath 0-1, tilt dB }
// mapped onto the nearest preset
function voiceParams(voice, { pitch, scale, breath, tilt } = {}) {
  if (voice && typeof voice === "object") return { ...GLOBALS, ...voice };
  if (typeof voice === "string") return { ...GLOBALS, ...(VOICES[voice]?.set ?? {}) };
  const f0 = pitch ?? GLOBALS.f0, G = { ...GLOBALS, ...VOICES[f0 < 160 ? "man" : f0 < 245 ? "woman" : "child"].set, f0 };
  if (scale !== undefined) G.formantScale = scale;
  if (breath !== undefined) G.breath = clamp(breath * .6 + .05, 0, 1);   // old aspiration level -> breathiness (man .25 -> .2, woman .6 -> .41)
  if (tilt !== undefined) G.tilt = -9 + (tilt - 7) * .5;                  // old shelf lift -> source tilt (man 7 -> -9, woman 3 -> -11)
  return G;
}
// one utterance's parameters: the voice, the language's prosody, the mood, the sentence mark
function speaking(base, lang, mood, mark, rate) {
  const pr = (LANGS[lang] ?? LANGS.en).prosody, M = MOODS[mood] ?? MOODS.normal, G = { ...base };
  G.rate *= rate * (pr.rate ?? 1) * M.rate; G.stressF0 *= (pr.stress ?? 1) * M.stress;
  G.finalLen *= pr.finalLen ?? 1; G.finalRise += pr.finalRise ?? 0;
  G.f0 *= M.pitch * (MODEL.intonation.utterance.keyFloor + rnd() * MODEL.intonation.utterance.keySpread);   // this utterance's own key: repeats never sound stamped out
  G.f0Range *= M.range; G.tilt += M.tilt; G.breath *= M.breath; G.precision *= M.precision ?? 1;
  if (G.ra !== undefined && M.tilt) G.ra *= Math.pow(2, -M.tilt / MODEL.source.ra.tiltPerOctave);   // (a voice with its return phase pinned still presses or slackens with the mood)
  if (M.fundamental) G.fundamental = (G.fundamental ?? MODEL.source.sine.db) + M.fundamental;
  if (M.creak) G.creak = Math.max(G.creak, M.creak);
  if (M.jitter) G.jitter *= M.jitter;
  if (mark === "?") G.finalRise = Math.max(G.finalRise, MODEL.intonation.utterance.questionRise);   // a question lifts at the end
  else if (mark === "!") { G.stressF0 *= MODEL.intonation.utterance.exclaimStress; G.finalRise -= MODEL.intonation.utterance.exclaimFall; }
  return G;
}
// a sentence: lexicon words by key, anything else read as IPA; , . ? ! shape the melody
function textTokens(text, lang) {
  const L = LANGS[lang] ?? LANGS.en; let mark;
  const ipa = text.trim().split(/\s+/).map((tok) => {
    const m = tok.match(/^(.*?)([,.?!]*)$/), w = L.words[m[1].toLowerCase()];
    if (/[.?!]/.test(m[2])) mark = m[2].includes("?") ? "?" : m[2].includes("!") ? "!" : ".";
    // (a word from the lexicon is a CONTENT word: written without a stress mark -- ʃlɛçt, haʊs -- it is stressed all the
    // same, or the duration rules take it for a function word and say it in passing)
    const said = w !== undefined && !w.includes("ˈ") && !L.tonal ? "ˈ" + w : w;
    return (said ?? m[1]) + (m[2].includes(",") ? "," : "");
  }).join(" ");
  return { tokens: tokenize(ipa, lang), mark };
}
// A BREATH IN. People take one before a long line and the ear expects it; it is the cheapest humanising
// sound there is. Filtered noise with a slow swell, well under the voice, a moment before it starts -- and
// only before a line long enough to have needed the air.
function withInhale(speech, G) {
  const IN = MODEL.inhale, ms = IN.minMs + rnd() * IN.varMs, n = Math.round(SR * ms / 1000), gap = Math.round(SR * IN.gapMs / 1000);
  const lo = bandpass(1), hi = bandpass(1);
  lo.set(IN.lowHz * (G.formantScale || 1), IN.lowBw); hi.set(IN.highHz, IN.highBw);
  const amp = IN.base + IN.perBreath * G.breath, out = new Float32Array(n + gap + speech.length);
  for (let i = 0; i < n; i++) {
    const u = i / n, env = Math.pow(Math.sin(Math.PI * u), IN.shape) * (u < .5 ? 1 : IN.tail), w = rnd() * 2 - 1;
    out[i] = (lo.run(w) * IN.lowGain + hi.run(w) * IN.highGain) * env * amp;
  }
  out.set(speech, n + gap);
  return out;
}
const synth = (tokens, lang, G) => {
  const P = plan(tokens, lang, G), out = render(P, G);
  return SOURCE.breathIn && P.total > MODEL.inhale.minLineMs ? withInhale(out, G) : out;
};

// A voice that speaks into `dest` (default the speakers). Options: `voice`
// (VOICES key or a voiceFor() object) or the legacy pitch/scale/breath/tilt;
// `rate` scales speed, `volume` the level. Utterances queue: each say*
// returns the AC time it ends, and the next waits for it.
export function createSpeaker(ctx, { voice, pitch, scale, breath, tilt, rate = 1, volume = .5, dest, flutter } = {}) {
  const base = voiceParams(voice, { pitch, scale, breath, tilt });
  if (flutter !== undefined) { base.jitter *= flutter / .7; base.drift *= flutter / .7; }   // legacy: how much the pitch wanders
  const out = ctx.createGain(); out.gain.value = volume; out.connect(dest ?? ctx.destination);
  const live = new Set(); let busyUntil = 0, dead = false;
  function schedule(tokens, lang, at, mood = "normal", mark) {
    if (dead || !tokens.length) return ctx.currentTime;
    return queue(synth(tokens, lang, speaking(base, lang, mood, mark, rate)), at, (MOODS[mood] ?? MOODS.normal).vol);
  }
  function queue(samples, at, gain) {
    const start = Math.max(at ?? ctx.currentTime + .02, busyUntil, ctx.currentTime + .01);
    const { src, end } = play(ctx, toBuffer(samples), { dest: out, at: start, gain });
    live.add(src); src.addEventListener("ended", () => live.delete(src));
    busyUntil = end + .05;
    return end;
  }
  return {
    say: (word, lang = "en", at, mood) => { const w = LANGS[lang]?.words[word]; return w ? schedule(tokenize(w, lang), lang, at, mood) : ctx.currentTime; },
    sayText: (text, lang = "en", at, mood) => { const { tokens, mark } = textTokens(text, lang); return schedule(tokens, lang, at, mood, mark); },
    sayIPA: (ipa, lang = "en", at, mood, mark) => schedule(tokenize(ipa, lang), lang, at, mood, mark),   // mark: "." "?" "!" (see ./lexicon.js for written text -> IPA)
    vocal: (kind, at) => dead ? ctx.currentTime : queue(vocalSamples(kind, base), at, VOCAL_GAIN[kind] ?? 1),   // a laugh, a cry, a cough, a sneeze (VOCALS)
    get busyUntil() { return busyUntil; },
    stop() {   // fade first: a buffer cut at full level clicks
      dead = true; out.gain.setTargetAtTime(0, ctx.currentTime, .02);
      setTimeout(() => { for (const s of live) try { s.stop(); } catch (e) { /* not started yet */ } out.disconnect(); }, 120);
    },
    node: out,
  };
}

// ============================================================================
// CONFIGURATION: the whole engine as data. Every table and every constant is a
// plain object that the code reads LIVE, so a profile can change any of it:
//
//   getConfig()              a deep copy of everything, JSON-safe
//   setConfig(patch, opts)   lay a (partial) config over the live one; { replace: true } makes each section
//                            given EXACTLY what was passed, so an entry left out of a table is removed
//   resetConfig()            back to what the file shipped with
//   applyProfile(json)       a saved profile: any of the sections, plus `voice` -- registered under its name
//   VOICE_SCHEMA, MODEL_DOC  what each number means and its sensible range, for an editor to be built from
//
// Sections: switches (SOURCE), model (MODEL, including model.pairs -- the diphone overrides), places (the locus
// equations), phonemes, languageOverrides, tones, ipa, ipaByLanguage, languages (lexicon + prosody), moods,
// voiceDefaults (the reference voice every preset is laid over), voices (the presets).
// ============================================================================
export const CONFIG = { switches: SOURCE, model: MODEL, places: PLACES, phonemes: PHONEMES, languageOverrides: LANG_OVERRIDE, tones: TONE_SHAPES,
                        ipa: IPA_SYM, ipaByLanguage: IPA_LANG, languages: LANGS, moods: MOODS, voiceDefaults: GLOBALS, voices: VOICES };
export const PROFILE_FORMAT = "bannerfield-speech/1";
const clone = (v) => JSON.parse(JSON.stringify(v));
const SHIPPED = clone(CONFIG);
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
function layOver(target, src, replace, path) {
  if (replace) for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  for (const [k, v] of Object.entries(src)) {
    const at = path + "." + k;
    if (typeof v === "number" && !Number.isFinite(v)) throw new Error(`${at} is not a finite number`);
    if (k in target && target[k] !== null && v !== null && typeof target[k] !== typeof v && typeof target[k] !== "undefined")
      throw new Error(`${at} should be a ${typeof target[k]}, not a ${typeof v}`);
    if (isObj(v) && isObj(target[k])) layOver(target[k], v, replace, at);
    else if (Array.isArray(v) && Array.isArray(target[k])) { target[k].length = 0; target[k].push(...clone(v)); }
    else target[k] = isObj(v) || Array.isArray(v) ? clone(v) : v;
  }
}
export const getConfig = () => ({ format: PROFILE_FORMAT, ...clone(CONFIG) });
export const getShippedConfig = () => ({ format: PROFILE_FORMAT, ...clone(SHIPPED) });
export function setConfig(patch, { replace = false } = {}) {
  for (const [sec, v] of Object.entries(patch ?? {})) {
    if (["format", "name", "kind", "voice", "notes"].includes(sec)) continue;   // a profile's own fields, not sections of the engine
    if (!(sec in CONFIG)) throw new Error(`"${sec}" is not a section of the speech configuration (${Object.keys(CONFIG).join(", ")})`);
    // the model's sub-tables that are keyed by the user (pairs, reduction by language) are replaced whole on a
    // replace; the model's own structure never is -- a profile cannot delete a constant the engine reads
    if (sec === "model") { layOver(MODEL, v, false, "model"); if (replace && v.pairs) { for (const k of Object.keys(MODEL.pairs)) if (!(k in v.pairs)) delete MODEL.pairs[k]; } }
    else if (sec === "switches" || sec === "voiceDefaults") layOver(CONFIG[sec], v, false, sec);
    else layOver(CONFIG[sec], v, replace, sec);
  }
  ipaKeys.clear();                                     // the IPA matcher is built from the tables it was given
}
export const resetConfig = () => setConfig(SHIPPED, { replace: true });
// a saved profile: sections as above, and `voice` -- the parameters of one speaker, registered as a preset
export function applyProfile(json, { replace = false } = {}) {
  if (json.format && json.format !== PROFILE_FORMAT) throw new Error(`this is a "${json.format}" file; the engine reads "${PROFILE_FORMAT}"`);
  setConfig(json, { replace });
  if (json.voice) {
    const key = (json.name ?? "custom").toLowerCase().replace(/[^a-z0-9]+/g, "") || "custom";
    VOICES[key] = { name: json.name ?? key, kind: json.kind ?? (json.voice.f0 > 245 ? "child" : json.voice.f0 > 160 ? "woman" : "man"), custom: true, set: clone(json.voice) };
    return key;
  }
  return null;
}
// what a profile for ONE voice looks like: that voice's parameters, fully spelt out over the defaults
export const voiceProfile = (key, name) => ({ format: PROFILE_FORMAT, name: name ?? VOICES[key]?.name ?? key, kind: VOICES[key]?.kind,
                                             voice: { ...clone(GLOBALS), ...clone(VOICES[key]?.set ?? {}) } });

// WHAT EACH VOICE PARAMETER IS. [label, min, max, step, what it does]; `auto` marks the ones that are normally
// left for the engine to derive (from tilt, breath and the size of the tract) and only set to pin them.
export const VOICE_SCHEMA = {
  f0: ["Pitch", 60, 420, 1, "Hz. The MIDDLE of the speaker's tune (the contour is centred on it), not its floor."],
  f0Range: ["Pitch range", 0, 90, 1, "% -- how far the phrase arc lifts the pitch. A flat reader 15, an animated one 60."],
  stressF0: ["Accent height", 0, 70, 1, "% -- how far a stressed syllable rises above the phrase."],
  finalRise: ["Final rise", -30, 50, 1, "% on the last vowel: negative falls (a statement), positive lifts (uptalk, a question adds its own)."],
  drift: ["Pitch drift", 0, 3, .1, "slow wander of the pitch over a sentence, in units of about 1%."],
  formantScale: ["Tract size", .8, 1.5, .01, "scales every formant: 1 a man, ~1.17 a woman, 1.3-1.4 a child. Above ~1.05 the female tract model (vowel space, glottal chink) fades in, and out again toward a child."],
  f1Scale: ["F1 scale", .85, 1.2, .01, "opens or closes the jaw of the whole voice."],
  f2Scale: ["F2 scale", .85, 1.2, .01, "fronts or backs the whole voice."],
  f4: ["F4", 2500, 4500, 10, "Hz before tract scaling. Pull F4 and F5 together near 3kHz and the voice gets a 'ring' (a fitted trained male voice sat at 3100/3400)."],
  f5: ["F5", 3000, 5500, 10, "Hz before tract scaling."],
  formants: ["Formants", 3, 6, 1, "how many cascade resonators run."],
  bw: ["Bandwidth", .5, 2, .01, "scales every formant's bandwidth: narrow rings and buzzes, wide is dull and damped."],
  bwHi: ["Upper bandwidth", .3, 2.5, .01, "the same for F3 upward only.", "auto"],
  tilt: ["Source tilt", -18, 0, .5, "dB. -9 is the reference; -15 soft and dark, -4 tense and bright. Sets how abruptly the folds close unless `ra` pins it."],
  breath: ["Breathiness", 0, 1, .01, "aspiration noise under the voice; also widens F1 and relaxes the closure."],
  oq: ["Open quotient", .3, .9, .01, "share of each cycle the folds are open. Sets the first harmonic against the second: ~.5 a man, .8+ a woman.", "auto"],
  ra: ["Return phase", .002, .06, .001, "share of the cycle the folds take to finish closing. THE brightness control: .003 crisp and bright, .03 soft and breathy.", "auto"],
  rk: ["Pulse skew", .15, .7, .01, "how much longer the folds take to open than to close: low is skewed and buzzy, high symmetric and flutey.", "auto"],
  airLevel: ["Air", 0, 6, .05, "level of the breath noise above the top formant -- 'presence'.", "auto"],
  jitter: ["Jitter", 0, 4, .05, "% cycle-to-cycle pitch irregularity. Healthy .3-.8, rough 2+."],
  shimmer: ["Shimmer", 0, 12, .1, "% cycle-to-cycle loudness irregularity."],
  tremor: ["Tremor", 0, 8, .1, "% slow pitch wobble of an old or frightened voice."],
  tremorRate: ["Tremor rate", 3, 9, .1, "Hz."],
  creak: ["Creak", 0, 1, .01, "vocal fry toward the end of each line: alternate cycles long and quiet."],
  breathFinal: ["Breath at the end", 0, 1, .01, "the voice dissolving into breath on its last sound."],
  onset: ["Voice onset", 0, 60, 1, "ms for voicing to swell at the start: 8 hard, 35 soft."],
  rate: ["Pace", .5, 2, .01, "this speaker's own pace, over the language's and the mood's."],
  precision: ["Precision", .6, 1.3, .01, "how fully the tongue reaches its targets: below 1 slurs unstressed vowels, above 1 articulates fast and clean."],
  transScale: ["Transitions", .5, 2, .01, "scales every formant transition and the articulators' time constants."],
  finalLen: ["Final lengthening", 1, 2.2, .01, "how much the last syllable of a line stretches."],
  nasalMix: ["Nasal coupling", 0, 1, .01, "how strongly nasals and nasal vowels go through the nose."],
  twang: ["Twang", 0, 1, .01, "permanent nasality on every vowel."],
  fundamental: ["Fundamental boost", 0, 12, .1, "dB of sinusoidal voicing added to the first harmonic: the soft strong fundamental of folds that do not fully close.", "auto"],
  sinus: ["Sinus size", .8, 1.25, .01, "scales the fixed sinus antiformants of the nasal branch: the part of a nasal that is the head, not the word."],
  fricGain: ["Fricative level", 0, 3, .01, "loudness of s, f, sh..."],
  burstGain: ["Burst level", 0, 3, .01, "loudness of the release of p, t, k..."],
  sibShift: ["Sibilant colour", -30, 30, 1, "% -- shifts s/sh up (thin, lispy) or down (dark)."],
  sibLevel: ["Sibilant level", 0, 2.5, .01, "loudness of s and sh alone."],
};
// what each switch turns on, for the editor
export const SWITCH_DOC = {
  lf: "LF glottal pulse (oq / ra / rk) instead of the Rosenberg pulse and a separate tilt filter.",
  trachea: "Couples the airway below the glottis into the tract while the folds are open.",
  piriform: "The antiresonance near 4.5kHz that every human spectrum has.",
  aspiration: "Breath noise pulses with the glottis instead of running flat under the voice.",
  openQuotient: "The open quotient varies cycle to cycle and with breathiness (Rosenberg path; the LF path always uses it).",
  diplophonia: "Creak as alternate long/quiet cycles rather than as random roughness.",
  undershoot: "Formants chase their targets like damped springs and miss them when the segment is short.",
  interaction: "F1's bandwidth opens and its frequency dips while the glottis is open, once per cycle.",
  bandwidths: "Bandwidths follow their formant's frequency (model.tract.bandwidths) instead of a fixed table.",
  effort: "Loud syllables are brighter and more pressed at the source, not just louder.",
  durations: "Klatt's duration rules (model.durations).",
  reduction: "Unstressed vowels' targets fall toward schwa, by language (model.reduction).",
  fujisaki: "Fujisaki phrase/accent intonation instead of the declining line with Gaussian accents.",
  centrePitch: "The voice's f0 is the middle of its contour rather than its floor.",
  vowelSpace: "Non-uniform formant scaling for an adult female tract: a more dispersed vowel space.",
  chink: "Female glottal chink: wider F1, breathiness as noise above 2kHz.",
  phonation: "How firmly the folds close varies with stress and toward the end of each phrase (model.phonation).",
  measured: "Defaults fitted to recordings: pace x1.3, abrupt closure, louder consonants, higher female open quotient.",
  microprosody: "Consonants perturb the pitch of the vowel after them; accents rise faster than they fall; downstep.",
  breathIn: "An audible breath before a line longer than model.inhale.minLineMs.",
  air: "Breath noise above the top formant, straight out past the tract.",
  upperFormants: "F4 and F5 move with the sound (phonemes: f4, f5): down for rounded vowels and ɹ, up for i and j.",
  phonemeBw: "Each sound scales the bandwidth rule (phonemes: bw [B1,B2,B3]): close, open and nasalised vowels, murmurs, laterals.",
  lateral: "The antiformant of a lateral (phonemes: zero on l), model.tract.lateral.depth deep.",
  fricZeros: "Fricatives get their third noise band and the zero below the hiss (phonemes: fric[2], zero).",
  sineVoicing: "Sinusoidal voicing: dB added to the pulse's own fundamental (model.source.sine, or the voice's `fundamental`).",
  femaleTract: "An adult woman's F1 sits higher and F3-F6 lower than uniform scaling puts them (model.tract.femaleTract).",
  correlatedJitter: "Most of the jitter, shimmer and open-quotient variation is slow (each cycle resembles the last) instead of fresh noise every cycle (model.source.perturbation).",
  anchoredClosure: "The open quotient's cycle-to-cycle variation moves the opening, not the closure: the excitation keeps time.",
  f1Floor: "Close vowels keep their F1 above a floor that scales with the voice (model.tract.f1Floor).",
  voicedH: "An /h/ between voiced sounds is breathy-voiced, not voiceless (model.voicing).",
  voicingTails: "Voicing dies away breathily over model.voicing.tailMs into a voiceless consonant instead of stopping dead.",
  trachea2: "A second tracheal resonance, and a shorter windpipe for a woman (model.tract.trachea).",
  intrinsicPitch: "High vowels are said higher than low ones (model.intonation.intrinsic).",
  sinuses: "Two fixed pole-zero pairs in the nasal branch (model.tract.nasal.sinuses), scaled by the voice's `sinus`.",
};
// what each group of the model is, for the editor
export const MODEL_DOC = {
  "schwa": "The neutral vowel: where unstressed vowels fall toward, and where a formant goes when nothing else claims it.",
  "pace": "measuredRate is the factor four recorded speakers asked for over the phoneme table's citation-form durations. The silences pad every line.",
  "segments": "How each kind of sound is built: its voicing level (av), its noise levels (ah aspiration, af frication), and how long its formant transitions take.",
  "durations": "Klatt's rules: what a segment's neighbours and its word do to its length. beforeVoiced / beforeVoiceless is the 'bead / beat' effect.",
  "reduction": "How far an unstressed vowel's TARGET falls toward schwa, by language.",
  "transitions": "Default transition time, and the most of a segment a transition may take.",
  "intonation.classic": "The older tune: a declining line with a Gaussian bump on each stress. Used when the Fujisaki switch is off.",
  "intonation.fujisaki": "Phrase commands (impulses, alpha) and accent commands (steps, beta) through damped responses, summed in log F0.",
  "intonation.microprosody": "What the consonant before a vowel does to its pitch for a few tens of ms.",
  "intonation.utterance": "Per-line: the random key each line is said in, and what ? and ! do.",
  "tract": "The filter: articulator time constants (tauMs, F1/F2/F3), bandwidths as [constant, per Hz] per formant, the female tract, the nasal branch with its sinuses, a lateral's and a fricative's zero depth, colourTauMs (how fast f4/f5 and bandwidth factors move), the piriform notch and the trachea.",
  "source": "The glottis. oq/ra/rk are the LF pulse (see the voice parameters of the same names, which override these derivations); aspiration, air and chinkNoise are its three noise paths.",
  "voicing": "Where voicing goes that a segment table would not put it: the breathy tail into a voiceless consonant (tailMs, tailAv of the vowel's level, tailLax) and the breathy-voiced /h/ between voiced sounds (hAv, hAh).",
  "phonation": "The 'lax' track: how firmly the folds close, syllable by syllable. Negative is firm (stressed), positive slack (unstressed, phrase-final).",
  "consonants": "Levels of the parallel noise path, and measuredBoost -- the 6dB the recordings showed was missing.",
  "envelope": "Thresholds and ramps on the voicing and noise envelopes.",
  "inhale": "The breath taken before a line longer than minLineMs.",
  "pairs": "DIPHONE OVERRIDES. The engine derives each consonant-vowel boundary from PLACES; a key like \"k>i\" or \"a>n\" overrides one pair: { F2, F3 (Hz the vowel is pulled to), transMs }.",
};

// Render speech to samples / a buffer without a live context (tests, previews).
export const renderText = (text, lang = "en", voice, mood = "normal") => { const { tokens, mark } = textTokens(text, lang); return synth(tokens, lang, speaking(voiceParams(voice), lang, mood, mark, 1)); };
// the PLAN of an utterance without rendering it: every segment with its sound, kind and length in ms -- what a
// comparison against labelled recordings needs (a stop is its closure/voicebar, burst and aspiration, all with the stop's `ph`)
export const planText = (text, lang = "en", voice, mood = "normal") => { const { tokens, mark } = textTokens(text, lang);
  return plan(tokens, lang, speaking(voiceParams(voice), lang, mood, mark, 1)).segs.map((g) => ({ sym: g.sym, kind: g.kind, ph: g.ph, dur: g.dur, stress: !!g.stress })); };
export const renderIPA = (ipa, lang = "en", voice, mood = "normal", mark) => synth(tokenize(ipa, lang), lang, speaking(voiceParams(voice), lang, mood, mark, 1));   // no lexicon lookup: every word is IPA
export async function renderWord(word, lang = "en", voice) { return toBuffer(renderText(word, lang, voice)); }
export const renderVocal = (kind, voice) => vocalSamples(kind, voiceParams(voice));
