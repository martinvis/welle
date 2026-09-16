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
// cascade of up to six formant resonators with a nasal pole/zero pair, plus
// a parallel noise path for frication and bursts. The result plays as an
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
export const PHONEMES = {
  // vowels
  i: V(280, 2250, 2900, 110), I: V(400, 1900, 2550, 90), e: V(400, 2100, 2650, 110), E: V(550, 1800, 2500, 100), "{": V(690, 1660, 2450, 130),
  a: V(750, 1300, 2500, 110), A: V(730, 1090, 2440, 120), O: V(570, 840, 2410, 120), o: V(450, 800, 2400, 110), U: V(440, 1020, 2240, 90),
  u: V(310, 870, 2250, 110), "@": V(500, 1400, 2500, 70), V: V(640, 1190, 2390, 100), "3": V(490, 1350, 1700, 130), "6": V(600, 1300, 2500, 70),
  y: V(270, 1900, 2200, 110), Y: V(350, 1700, 2200, 90), "2": V(400, 1550, 2200, 110), "9": V(500, 1450, 2300, 100), "1": V(350, 1500, 2400, 100), "7": V(500, 1150, 2500, 110),
  "E~": V(600, 1600, 2500, 140, { nasal: 1 }), "A~": V(650, 1000, 2400, 140, { nasal: 1 }), "O~": V(450, 850, 2400, 140, { nasal: 1 }), "9~": V(500, 1400, 2300, 140, { nasal: 1 }),
  OY: V(570, 840, 2410, 170, { glideTo: "Y" }),
  // stops (vot: voice onset time ms; voiced: a voice bar through the closure)
  p: { type: "stop", place: "bilabial", voiced: 0, closure: 60, vot: 55 }, b: { type: "stop", place: "bilabial", voiced: 1, closure: 60, vot: 5 },
  t: { type: "stop", place: "alveolar", voiced: 0, closure: 55, vot: 60 }, d: { type: "stop", place: "alveolar", voiced: 1, closure: 55, vot: 8 },
  k: { type: "stop", place: "velar", voiced: 0, closure: 60, vot: 70 },    g: { type: "stop", place: "velar", voiced: 1, closure: 60, vot: 12 },
  // fricatives: fric = [centre Hz, bandwidth Hz, gain] for up to two band-passes on white noise (gains relative to a vowel)
  f: { type: "fric", place: "labiodental", voiced: 0, dur: 95, fric: [[3500, 4000, .16], [7000, 3000, .10]] },
  v: { type: "fric", place: "labiodental", voiced: 1, dur: 70, fric: [[3500, 4000, .10], [7000, 3000, .06]] },
  T: { type: "fric", place: "dental", voiced: 0, dur: 90, fric: [[4500, 3500, .18], [7500, 3000, .10]] },
  D: { type: "fric", place: "dental", voiced: 1, dur: 60, fric: [[4500, 3500, .10], [7500, 3000, .06]] },
  s: { type: "fric", place: "alveolar", voiced: 0, dur: 100, fric: [[6300, 1400, .55], [8500, 2500, .30]] },
  z: { type: "fric", place: "alveolar", voiced: 1, dur: 75, fric: [[6300, 1400, .35], [8500, 2500, .18]] },
  S: { type: "fric", place: "postalveolar", voiced: 0, dur: 100, fric: [[2900, 900, .50], [4300, 1500, .35]] },
  Z: { type: "fric", place: "postalveolar", voiced: 1, dur: 75, fric: [[2900, 900, .32], [4300, 1500, .22]] },
  x: { type: "fric", place: "velar", voiced: 0, dur: 90, fric: [[1600, 900, .35], [3200, 2000, .18]] },
  C: { type: "fric", place: "palatal", voiced: 0, dur: 90, fric: [[3600, 1000, .40], [5500, 2000, .22]] },
  h: { type: "fric", place: "glottal", voiced: 0, dur: 70, asp: 1 },   // noise through the vowel formants
  S_j: { type: "fric", place: "palatal", voiced: 0, dur: 110, fric: [[3400, 900, .50], [5400, 1600, .30]] },
  Z_j: { type: "fric", place: "palatal", voiced: 1, dur: 80, fric: [[3400, 900, .32], [5400, 1600, .20]] },
  s_j: { type: "fric", place: "palatal", voiced: 0, dur: 100, fric: [[4300, 1200, .50], [6500, 2000, .28]] },   // Polish ś: between s and ʃ
  z_j: { type: "fric", place: "palatal", voiced: 1, dur: 75, fric: [[4300, 1200, .32], [6500, 2000, .18]] },
  rz: { type: "fric", place: "alveolar", voiced: 1, dur: 80, fric: [[3800, 1600, .40], [6500, 2200, .22]], trillNoise: 26 },   // Czech ř: a voiced fricative trill
  B: { type: "fric", place: "bilabial", voiced: 1, dur: 55, approximant: 1 },   // Spanish approximants: weak, voiced, formant-like
  G: { type: "fric", place: "velar", voiced: 1, dur: 55, approximant: 1 }, J: { type: "fric", place: "palatal", voiced: 1, dur: 60, approximant: 1 },
  R: { type: "fric", place: "uvular", voiced: 1, dur: 70, fric: [[1100, 600, .22], [2200, 1200, .10]], approximant: 1 },
  // nasals (anti: the antiformant)
  m: { type: "nasal", place: "bilabial", dur: 75, anti: 1000 }, n: { type: "nasal", place: "alveolar", dur: 70, anti: 1700 },
  N: { type: "nasal", place: "velar", dur: 80, anti: 3000 }, ny: { type: "nasal", place: "palatal", dur: 80, anti: 2300 },
  // liquids, glides, tap, trill (formant-defined)
  l: { type: "liquid", place: "alveolar", dur: 65, F1: 380, F2: 1100, F3: 2700 }, r: { type: "liquid", place: "alveolar", dur: 70, F1: 400, F2: 1150, F3: 1600 },
  "4": { type: "tap", place: "alveolar", dur: 28, F1: 350, F2: 1500, F3: 2500 }, rr: { type: "trill", place: "alveolar", dur: 90, F1: 350, F2: 1450, F3: 2500, rate: 28 },
  j: { type: "glide", place: "palatal", dur: 60, F1: 280, F2: 2200, F3: 2900 }, w: { type: "glide", place: "bilabial", dur: 60, F1: 320, F2: 750, F3: 2300 },
  H: { type: "glide", place: "palatal", dur: 60, F1: 290, F2: 1900, F3: 2200 },
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
  twang: 0, onset: 20, finalRise: 0, breathFinal: 0, drift: 1, tremor: 0, tremorRate: 5.5, creak: 0 };
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
  child10:      { name: "Child (~10 years)", kind: "child10", set: { f0: 245, f0Range: 44, formantScale: 1.3, tilt: -10, breath: .3, jitter: 1.1, shimmer: 5, rate: .98, precision: .93, bw: 1.15, stressF0: 28 } },
  child:        { name: "Child (~7 years)", kind: "child", set: { f0: 280, f0Range: 48, formantScale: 1.36, tilt: -10, breath: .35, jitter: 1.3, shimmer: 6, rate: .95, precision: .9, bw: 1.2, stressF0: 30 } },
  child5:       { name: "Child (~5 years)", kind: "child5", set: { f0: 305, f0Range: 52, formantScale: 1.42, tilt: -10, breath: .38, jitter: 1.5, shimmer: 7, rate: .9, precision: .85, bw: 1.25, stressF0: 32 } },
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
function locusFor(entry, vowel, pal) {   // the formants a consonant pulls its neighbouring vowel toward
  const pl = PLACES[entry.place] || PLACES.alveolar;
  const F2 = pal ? Math.max(pl.k * vowel.F2 + pl.c, 1950) : pl.k * vowel.F2 + pl.c;
  return { F1: entry.type === "nasal" ? 250 : 220, F2, F3: vowel.F3 + pl.f3 };
}

function plan(tokens, lang, G) {
  const rate = 1 / G.rate, tonal = !!LANGS[lang]?.tonal, PAUSE = { type: "pause" };
  // expand affricates, attach resolved entries (pauses become silence)
  const phs = [];
  for (const tk of tokens) {
    if (tk.pause) { phs.push({ ...tk, e: PAUSE }); continue; }
    const e = resolve(tk.sym, lang, tk.pal); if (!e) continue;
    if (e.type === "affr") {
      phs.push({ ...tk, sym: e.stop, e: { ...resolve(e.stop, lang), closure: 40 }, affr: 1 });
      phs.push({ ...tk, sym: e.fric, e: { ...resolve(e.fric, lang), dur: 65 }, stress: false });
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
  const segs = [];
  phs.forEach((p, i) => {
    const e = p.e, prev = phs[i - 1], nx = phs[i + 1] && phs[i + 1].e.type !== "pause" ? phs[i + 1] : null;
    if (e.type === "pause") { segs.push({ kind: "silence", dur: p.pause, av: 0 }); return; }
    const isLast = i === phs.length - 1;
    const stretch = (isLast || i === lastVowel && lastVowel >= phs.length - 2 ? G.finalLen : 1) * (p.long ? 1.6 : 1) * rate;
    const stress = p.stress ? 1.3 : 1;
    const base = { ph: i, sym: p.sym, pal: p.pal, stress: p.stress, syl: p.syl, tone: p.tone };
    if (p.asp) { e.vot = 85; if (e.type === "fric") e.dur = (e.dur || 80) * 1.2; }
    if (e.type === "vowel") {
      // unstressed vowels drift toward schwa by (1 - precision): a real tongue does not always arrive
      const prec = p.stress ? 1 : G.precision, tgt = { F1: lerp(SCHWA.F1, e.F1, prec), F2: lerp(SCHWA.F2, e.F2, prec), F3: lerp(SCHWA.F3, e.F3, prec) };
      const s = { ...base, kind: "vowel", dur: e.dur * stress * stretch * (p.toneDur || 1), av: p.stress ? 1 : .85, finalSyl: p.finalSyl, F: tgt, nasal: e.nasal || 0, transIn: 45, transOut: 45 };
      if (e.glideTo) { const g = resolve(e.glideTo, lang); s.F2nd = { F1: g.F1, F2: g.F2, F3: g.F3 }; }
      segs.push(s);
    } else if (e.type === "stop") {
      const locIn = locusFor(e, vowelNear(i, -1), p.pal), locOut = locusFor(e, vowelNear(i, 1), p.pal), burst = PLACES[e.place].burst;
      segs.push({ ...base, kind: e.voiced ? "voicebar" : "closure", dur: e.closure * rate, av: e.voiced ? .3 : 0, F: locIn, Fend: locOut });
      segs.push({ ...base, kind: "burst", dur: 8, af: burst[2] * (e.voiced ? .5 : 1) * (nx ? 1 : .5), fric: [[burst[0], burst[1], 1]], F: locOut });
      if (e.vot > 10 && nx) segs.push({ ...base, kind: "aspiration", dur: e.vot, ah: .7, F: locOut });
    } else if (e.type === "fric") {
      const vBefore = vowelNear(i, -1), vAfter = vowelNear(i, 1), loc = locusFor(e, prev && vowels[i - 1] ? vBefore : vAfter, p.pal);
      if (e.approximant) segs.push({ ...base, kind: "approx", dur: e.dur * rate, av: .55, F: { F1: 330, F2: loc.F2, F3: loc.F3 }, af: e.fric ? .25 : 0, fric: e.fric || [] });
      else if (e.asp) segs.push({ ...base, kind: "aspiration", dur: e.dur * rate, ah: .9, F: vAfter });
      else segs.push({ ...base, kind: "fric", dur: e.dur * rate, af: 1, av: e.voiced ? .45 : 0, fric: e.fric, F: loc, Fend: locusFor(e, vAfter, p.pal), trillNoise: e.trillNoise || 0 });
    } else if (e.type === "nasal") {
      const loc = locusFor(e, vowelNear(i, prev && vowels[i - 1] ? -1 : 1), p.pal);
      segs.push({ ...base, kind: "nasal", dur: e.dur * stretch, av: .6, F: { F1: 250, F2: loc.F2, F3: 2500 }, nasal: 1, anti: e.anti, transIn: 35, transOut: 35 });
    } else if (e.type === "liquid" || e.type === "glide") {
      segs.push({ ...base, kind: e.type, dur: e.dur * stretch, av: .8, F: { F1: e.F1, F2: p.pal ? Math.max(e.F2, 1950) : e.F2, F3: e.F3 }, transIn: 50, transOut: 50 });
    } else if (e.type === "tap") {
      segs.push({ ...base, kind: "tap", dur: e.dur, av: .4, F: { F1: e.F1, F2: e.F2, F3: e.F3 }, transIn: 25, transOut: 25 });
    } else if (e.type === "trill") {
      segs.push({ ...base, kind: "trill", dur: e.dur * rate, av: .7, F: { F1: e.F1, F2: e.F2, F3: e.F3 }, rate: e.rate, transIn: 25, transOut: 25 });
    }
    if (p.pal && e.type !== "vowel" && nx && nx.e.type === "vowel")   // the palatal off-glide into the vowel
      segs.push({ ...base, kind: "glide", dur: 30, av: .8, F: { F1: 300, F2: 2100, F3: 2800 }, transIn: 15, transOut: 30, offglide: 1 });
  });
  segs.unshift({ kind: "silence", dur: 60, av: 0 }); segs.push({ kind: "silence", dur: 80, av: 0 });
  return framesFrom(segs, G, tonal);
}

function framesFrom(segs, G, tonal) {
  let t = 0; for (const s of segs) { s.t0 = t; t += s.dur; s.t1 = t; }
  const total = t, n = Math.ceil(total / FRAME_MS), fs = G.formantScale, ts = G.transScale;
  // formant keyframes: the steady parts of formant-bearing segments, the loci at obstruent edges
  const keys = [];
  for (const s of segs) {
    if (!s.F) continue;
    if (["vowel", "nasal", "liquid", "glide", "tap", "trill", "approx"].includes(s.kind)) {
      const tin = Math.min((s.transIn || 40) * ts, s.dur * .45), tout = Math.min((s.transOut || 40) * ts, s.dur * .45);
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
    let f = G.f0 * (1 + (G.f0Range / 100) * .45 * (1 - 2 * tm / total));
    for (const s of stressed) { const c = s.t0 + s.dur * .35, w = s.dur * .6 + 60, d = (tm - c) / w; f *= 1 + (G.stressF0 / 100) * Math.exp(-d * d * 3); }
    return f;
  };
  if (tonal) {   // lexical tones: one contour per syllable, mild declination on top
    const syls = {};
    for (const s of segs) {
      if (s.syl === undefined || !s.tone) continue;
      const y = (syls[s.syl] ||= { t0: s.t0, t1: s.t1, tone: s.tone, final: s.finalSyl });
      y.t0 = Math.min(y.t0, s.t0); y.t1 = Math.max(y.t1, s.t1); if (s.finalSyl) y.final = true;
    }
    const list = Object.values(syls).sort((a, b) => a.t0 - b.t0), octaves = (G.f0Range / 100) * 2.2;
    const levelF0 = (L, tm) => G.f0 * Math.pow(2, (L - 3) / 4 * octaves) * (1 - .06 * tm / total);
    f0At = (tm) => {
      let y = list.find((s) => tm >= s.t0 && tm <= s.t1);
      if (!y) { let best = null; for (const s of list) { const d = Math.min(Math.abs(tm - s.t0), Math.abs(tm - s.t1)); if (!best || d < best.d) best = { d, s }; } y = best && best.s; }
      if (!y) return G.f0;
      const T = TONE_SHAPES[y.tone], c = (y.tone === 3 && y.final && T.final) ? T.final : T.c, u = clamp((tm - y.t0) / (y.t1 - y.t0), 0, 1);
      return levelF0(u < .5 ? lerp(c[0], c[1], u * 2) : lerp(c[1], c[2], (u - .5) * 2), tm);
    };
  }
  const frames = [];
  let si = 0;
  for (let i = 0; i < n; i++) {
    const tm = i * FRAME_MS;
    while (si < segs.length - 1 && tm >= segs[si].t1) si++;
    const s = segs[si], F = fAt(tm);
    frames.push({ t: tm, seg: s, f0: f0At(tm), av: s.av || 0, ah: s.ah || 0, af: s.af || 0,
      nasal: s.kind === "vowel" ? Math.max(s.nasal || 0, G.twang) : (s.nasal || 0), anti: s.anti || (G.twang > 0 ? 1600 : 0),
      F: [F.F1 * fs * G.f1Scale, F.F2 * fs * G.f2Scale, F.F3 * fs, G.f4 * fs, G.f5 * fs, 5500 * fs], fric: s.fric || [], trill: s.kind === "trill" ? s.rate : 0, voicebar: s.kind === "voicebar" });
  }
  // speaker habits: slow pitch drift, phrase-final rise or fall, sibilant colour, voice onset hardness, breath at the end
  const dph = rnd() * 6.28;
  for (const f of frames) f.f0 *= 1 + (G.drift / 100) * (.6 * Math.sin(2 * Math.PI * .7 * f.t / 1000 + dph) + .4 * Math.sin(2 * Math.PI * 1.9 * f.t / 1000));
  const lastV = [...segs].reverse().find((s) => s.kind === "vowel");
  if (!tonal && G.finalRise && lastV) for (const f of frames) if (f.t > lastV.t0) f.f0 *= 1 + (G.finalRise / 100) * clamp((f.t - lastV.t0) / Math.max(60, lastV.dur), 0, 1);
  for (const f of frames) if (f.fric.length && f.seg.kind === "fric" && f.fric[0][0] > 2500) f.fric = f.fric.map((r) => [r[0] * (1 + G.sibShift / 100), r[1], r[2] * G.sibLevel]);
  const onsetFrames = Math.max(1, Math.round(G.onset / FRAME_MS));
  for (let i = 1; i < frames.length; i++) if (frames[i].av > .05 && frames[i - 1].av <= .05) for (let k = 0; k < onsetFrames && i + k < frames.length; k++) frames[i + k].av *= (k + 1) / (onsetFrames + 1);
  if (G.breathFinal > 0) { const lv = [...segs].reverse().find((s) => s.av > .3); if (lv) for (const f of frames) if (f.t > lv.t1 - 140 && f.t < lv.t1 + 60) f.ah = Math.max(f.ah, G.breathFinal * .6 * clamp((f.t - (lv.t1 - 140)) / 100, 0, 1)); }
  // level smoothing: voicing, aspiration and frication ramp over ~25 ms at every boundary
  for (const k of ["av", "ah", "af"]) {
    const a = frames.map((f) => f[k]);
    for (let i = 0; i < a.length; i++) { let s = 0, c = 0; for (let j = -2; j <= 2; j++) { const v = a[i + j]; if (v !== undefined) { s += v; c++; } } frames[i][k] = s / c; }
  }
  return { frames, segs, total };
}

// frames -> samples: cascade formants for voicing and aspiration, parallel resonators for frication and bursts; a
// frame may also carry pop (a broadband blast straight out), rumble (low chest noise), creak (vocal fry) and jit (extra
// jitter, %) -- the non-verbal sounds' -- and P.normAll levels on the whole signal (a blast may be the loudest part)
function render(P, G) {
  const N = Math.ceil(P.total / 1000 * SR), out = new Float32Array(N), spf = SR * FRAME_MS / 1000, fr = P.frames, last = fr.length - 1;
  const nf = G.formants, casc = Array.from({ length: 6 }, resonator), nasalPole = resonator(), nasalZero = antiresonator();
  const par = [bandpass(100), bandpass(100)], bwBase = [60, 90, 150, 200, 250, 300];
  const tiltA = Math.exp(-2 * Math.PI * Math.min(8000 * Math.pow(2, (G.tilt + 9) / 4), SR * .45) / SR);   // spectral tilt: a one-pole on the source
  nasalPole.set(270 * G.formantScale, 120);
  let phase = 1, period = SR / G.f0, cycAmp = 1, lastV = 0, tiltY = 0, lpY = 0, rmY = 0, popY = 0;
  for (let i = 0; i < N; i++) {
    const fi = i / spf, k = Math.min(last, Math.floor(fi)), u = fi - k, a = fr[k], b = fr[Math.min(k + 1, last)];
    const f0 = lerp(a.f0, b.f0, u), av = lerp(a.av, b.av, u), ah = lerp(a.ah, b.ah, u), af = lerp(a.af, b.af, u), nasal = lerp(a.nasal, b.nasal, u);
    // voice source: a Rosenberg pulse per cycle, jitter/shimmer per cycle; tremor and a phrase-final creak (pitch drops, cycles go irregular)
    phase += 1 / period;
    if (phase >= 1) {
      phase -= 1;
      const trem = 1 + G.tremor / 100 * Math.sin(2 * Math.PI * G.tremorRate * i / SR), creak = Math.max(G.creak * clamp((i / N - .7) / .3, 0, 1), a.creak || 0);
      period = Math.max(2, SR / (f0 * trem * (1 - .35 * creak)) * (1 + ((G.jitter + (a.jit || 0)) / 100 + creak * .12) * gauss()));
      cycAmp = (1 + G.shimmer / 100 * gauss()) * (1 - creak * .25 * rnd());
    }
    const pulse = phase < .4 ? .5 * (1 - Math.cos(Math.PI * phase / .4)) : phase < .6 ? Math.cos(Math.PI * (phase - .4) / .4) : 0;
    let voice = (pulse - lastV) * 40; lastV = pulse;   // differentiated pulse ~ glottal flow derivative
    tiltY = tiltA * tiltY + (1 - tiltA) * voice; voice = tiltY;
    const trill = a.trill ? .5 + .5 * Math.cos(2 * Math.PI * a.trill * i / SR) : 1;
    let src = voice * av * cycAmp * trill;
    if (a.voicebar) { lpY = .985 * lpY + .015 * src; src = lpY * 6; }   // closed lips: only the lowest frequencies leak
    const noise = rnd() * 2 - 1;
    src += noise * (ah * .35 + G.breath * av * .12);   // aspiration and breathiness go through the cascade
    if ((i & 7) === 0) {   // filter coefficients at 4 kHz control rate (formants glide over tens of ms)
      for (let f = 0; f < nf; f++) casc[f].set(lerp(a.F[f], b.F[f], u), bwBase[f] * G.bw);
      if (nasal > .01) nasalZero.set(lerp(a.anti || 1500, b.anti || 1500, u) * G.formantScale, 300);
      if (af > .001) { const burst = a.seg.kind === "burst"; a.fric.forEach((r, j) => { if (j < 2) par[j].set(r[0] * (burst ? 1 : G.formantScale), r[1]); }); }
    }
    let x = src;
    for (let f = 0; f < nf; f++) x = casc[f].run(x);
    if (nasal > .01) x = lerp(x, nasalZero.run(nasalPole.run(x)) * .8, nasal * G.nasalMix);
    let y = 0;   // the parallel noise path
    if (af > .001 && a.fric.length) {
      const burst = a.seg.kind === "burst", gain = (burst ? G.burstGain * .9 : G.fricGain * .28) * af;
      let mod = av > .05 ? .45 + .55 * pulse : 1;   // voiced fricatives: the noise pulses with the glottis
      if (a.seg.trillNoise) mod *= .5 + .5 * Math.cos(2 * Math.PI * a.seg.trillNoise * i / SR);
      for (let j = 0; j < Math.min(2, a.fric.length); j++) y += par[j].run(noise) * a.fric[j][2] * gain * mod;
    }
    if (a.pop || b.pop) { popY = .6 * popY + .4 * noise; y += popY * lerp(a.pop || 0, b.pop || 0, u) * 1.2; }   // a blast straight out of the mouth, its hiss rolled off above ~2.6 kHz (a cough, not static)
    if (a.rumble || b.rumble) { rmY = .97 * rmY + .03 * noise; x += rmY * lerp(a.rumble || 0, b.rumble || 0, u) * 9; }   // the chest behind it (~150 Hz)
    out[i] = x * .9 + y;
  }
  let peak = 1e-6;   // normalise on voiced frames only (a burst must not set the level) -- or on everything (normAll)
  for (let i = 0; i < N; i++) if (P.normAll || fr[Math.min(last, Math.floor(i / spf))].av > .3) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < N; i++) out[i] = clamp(out[i] * .8 / peak, -1, 1);
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
  G.f0 *= M.pitch * (.97 + rnd() * .06);   // this utterance's own key: repeats never sound stamped out
  G.f0Range *= M.range; G.tilt += M.tilt; G.breath *= M.breath; G.precision *= M.precision ?? 1;
  if (mark === "?") G.finalRise = Math.max(G.finalRise, 30);   // a question lifts at the end
  else if (mark === "!") { G.stressF0 *= 1.35; G.finalRise -= 8; }
  return G;
}
// a sentence: lexicon words by key, anything else read as IPA; , . ? ! shape the melody
function textTokens(text, lang) {
  const L = LANGS[lang] ?? LANGS.en; let mark;
  const ipa = text.trim().split(/\s+/).map((tok) => {
    const m = tok.match(/^(.*?)([,.?!]*)$/), w = L.words[m[1].toLowerCase()];
    if (/[.?!]/.test(m[2])) mark = m[2].includes("?") ? "?" : m[2].includes("!") ? "!" : ".";
    return (w ?? m[1]) + (m[2].includes(",") ? "," : "");
  }).join(" ");
  return { tokens: tokenize(ipa, lang), mark };
}
const synth = (tokens, lang, G) => render(plan(tokens, lang, G), G);

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
    sayIPA: (ipa, lang = "en", at, mood) => schedule(tokenize(ipa, lang), lang, at, mood),
    vocal: (kind, at) => dead ? ctx.currentTime : queue(vocalSamples(kind, base), at, VOCAL_GAIN[kind] ?? 1),   // a laugh, a cry, a cough, a sneeze (VOCALS)
    get busyUntil() { return busyUntil; },
    stop() {   // fade first: a buffer cut at full level clicks
      dead = true; out.gain.setTargetAtTime(0, ctx.currentTime, .02);
      setTimeout(() => { for (const s of live) try { s.stop(); } catch (e) { /* not started yet */ } out.disconnect(); }, 120);
    },
    node: out,
  };
}

// Render speech to samples / a buffer without a live context (tests, previews).
export const renderText = (text, lang = "en", voice, mood = "normal") => { const { tokens, mark } = textTokens(text, lang); return synth(tokens, lang, speaking(voiceParams(voice), lang, mood, mark, 1)); };
export async function renderWord(word, lang = "en", voice) { return toBuffer(renderText(word, lang, voice)); }
export const renderVocal = (kind, voice) => vocalSamples(kind, voiceParams(voice));
