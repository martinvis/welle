// Formant speech synthesis on Web Audio -- the world's own voice.
//
// Standalone: no engine imports, no DOM. Feed it an AudioContext and it
// speaks. The method is classic Klatt-style formant synthesis: a glottal
// buzz (sawtooth through a lowpass) and white noise are shaped by three
// parallel bandpass resonators at the vowel formants F1/F2/F3, with a
// separate noise resonator for fricatives and bursts and a low "murmur"
// resonator for nasals. Every phoneme is a row of targets in PHONEMES;
// a word is a string of IPA symbols from the lexicon, turned into a
// timeline of segments whose formant frequencies RAMP between each other
// (the transitions are most of what makes a consonant intelligible), then
// scheduled as Web Audio automation. Pitch follows a declining contour
// with a bump on the stressed syllable.
//
// The phoneme inventory is rich enough for English, German, French,
// Spanish and Russian together; each language lists the subset it uses and
// its own transcription of the shared word list, plus a prosody set (rate,
// stress, final fall) that is most of what an accent is. A voice is a
// pitch and a formant scale (larger throat, smaller throat), seeded per
// person by the caller.
//
//   const sp = createSpeaker(ctx, { pitch: 118, scale: 1, rate: 1 });
//   sp.say("beer", "de");                  // "Bier"
//   sp.say("hello", "fr", ctx.currentTime + 1);
//   sp.sayIPA("ˈkasa", "es");              // any transcription
//   WORDS  -> the shared word keys; LANGS[l].words -> that language's forms

// ---- phoneme table ------------------------------------------------------------
// Vowels: F1/F2/F3 in Hz for a reference adult male throat. Consonants:
// `loc` = the formant loci the neighbouring vowel ramps toward (place of
// articulation), plus what the segment sounds like in itself.
const V = (f1, f2, f3, o = {}) => ({ kind: "v", F: [f1, f2, f3], ...o });
export const PHONEMES = {
  // -- vowels (front to back) --
  "i": V(280, 2250, 2900), "ɪ": V(400, 1950, 2550), "y": V(280, 1750, 2150), "ʏ": V(380, 1650, 2200),
  "e": V(420, 2100, 2650), "ø": V(420, 1550, 2250), "ɛ": V(550, 1850, 2500), "œ": V(520, 1450, 2350),
  "æ": V(710, 1680, 2450), "a": V(750, 1250, 2500), "ɑ": V(720, 1050, 2500), "ɐ": V(650, 1350, 2450),
  "ʌ": V(640, 1200, 2400), "ɜ": V(500, 1400, 2200), "ə": V(500, 1450, 2450), "ɨ": V(330, 1500, 2500),
  // (ɔ is back and rounded: an open ɔ with F2 ~850 and a strong F3 is a dark /l/ -- "water" became "walter")
  "ɔ": V(510, 740, 2200), "o": V(450, 800, 2500), "ɒ": V(600, 900, 2450), "ʊ": V(440, 1000, 2250), "u": V(310, 750, 2250),
  // nasal vowels (French): same tongue, velum open -> murmur added, F1 damped
  "ɑ̃": V(700, 1100, 2450, { nasal: .7 }), "ɛ̃": V(560, 1750, 2500, { nasal: .7 }),
  "ɔ̃": V(520, 850, 2450, { nasal: .7 }), "œ̃": V(520, 1400, 2350, { nasal: .7 }),
  // diphthongs: two targets, glide over the second half
  "aɪ": V(720, 1200, 2500, { to: [400, 1950, 2550] }), "aʊ": V(720, 1200, 2500, { to: [440, 1000, 2250] }),
  "eɪ": V(480, 2000, 2600, { to: [300, 2250, 2900] }), "oʊ": V(480, 900, 2500, { to: [330, 780, 2250] }),
  "ɔɪ": V(560, 850, 2450, { to: [400, 1950, 2550] }),
  // -- glides / liquids: voiced, brief, their own formant shapes --
  // glides are quieter than vowels (rounded/closed) and identified by the
  // LONG formant sweep into the vowel that follows, not by their own shape
  "j": { kind: "g", F: [280, 2250, 2900], dur: .055, amp: .65 }, "w": { kind: "g", F: [280, 700, 2300], dur: .055, amp: .6 },
  "ɥ": { kind: "g", F: [280, 1750, 2150], dur: .055, amp: .6 },
  "l": { kind: "g", F: [380, 1250, 2700], dur: .07, amp: .75 }, "ʎ": { kind: "g", F: [330, 2000, 2800], dur: .09, amp: .7 },
  "ɹ": { kind: "g", F: [400, 1250, 1650], dur: .08, amp: .75 },                          // English r: F3 dives
  "r": { kind: "g", F: [400, 1300, 2200], dur: .09, amp: .7, trill: 3 },                 // apical trill: 3 flaps
  "ɾ": { kind: "g", F: [400, 1400, 2300], dur: .04, amp: .6, trill: 1 },                 // tap
  "ʁ": { kind: "g", F: [450, 1100, 2100], dur: .085, amp: .6, fric: [900, 2, 1.6, 350], trill: 3 },   // uvular r: a rasping voiced friction with a uvular trill (Drache, Burg)
  // -- nasals: murmur through a low resonance, formants damped --
  "m": { kind: "n", loc: [250, 950, 2100], dur: .08 }, "n": { kind: "n", loc: [250, 1700, 2600], dur: .07 },
  "ɲ": { kind: "n", loc: [250, 2100, 2800], dur: .09 }, "ŋ": { kind: "n", loc: [250, 1400, 2300], dur: .08 },
  // -- fricatives: [noise peak Hz, Q, level, highpass corner]; the corner
  // is what separates a sibilant from wind: /s/ has nothing below 4 kHz.
  // Voiced ones add a buzz.
  // f/v: labiodental -- no front cavity, so a flat broadband hiss from ~1 kHz up, quiet but long enough to register
  "f": { kind: "f", loc: [300, 1100, 2400], fric: [6500, .22, .75, 1100], dur: .12 }, "v": { kind: "f", loc: [300, 1100, 2400], fric: [6500, .22, .38, 1100], dur: .08, voiced: .5 },
  "θ": { kind: "f", loc: [300, 1500, 2600], fric: [6500, .35, .5, 2500], dur: .1 }, "ð": { kind: "f", loc: [300, 1500, 2600], fric: [6500, .35, .25, 2500], dur: .06, voiced: .45 },
  // sibilants are INTENSE and peaked (a weak flat one is a lisp): /s/ a sharp peak near 7.5 kHz over a cliff at 5, /ʃ/ a peak near 3.5 kHz
  "s": { kind: "f", loc: [300, 1700, 2600], fric: [7500, .9, 1.5, 5000], dur: .12 }, "z": { kind: "f", loc: [300, 1700, 2600], fric: [7500, .9, .9, 5000], dur: .08, voiced: .45 },
  "ʃ": { kind: "f", loc: [300, 1900, 2500], fric: [3600, .8, 1.6, 2000], dur: .12 }, "ʒ": { kind: "f", loc: [300, 1900, 2500], fric: [3600, .8, 1.0, 2000], dur: .08, voiced: .45 },
  "ʂ": { kind: "f", loc: [300, 1600, 2400], fric: [3200, .5, 1.2, 1500], dur: .12 }, "ʐ": { kind: "f", loc: [300, 1600, 2400], fric: [3200, .5, .65, 1500], dur: .08, voiced: .45 },
  "ç": { kind: "f", loc: [300, 2100, 2800], fric: [4800, .8, 1.2, 2800], dur: .1 },                 // ich-Laut: a bright hiss below /s/
  "x": { kind: "f", loc: [300, 1200, 2400], fric: [1600, 1.2, 1.4, 700], dur: .11, rough: 3 },       // ach-Laut: a strong low rasp, uvular-rough
  "h": { kind: "f", loc: null, fric: [1500, .3, .25, 300], dur: .07, asp: 1.8 },                // h takes the next vowel's shape (breath ~12 dB under it)
  // Spanish soft b/d/g between vowels: approximants -- a brief dip of the
  // voice with almost no friction, shaped away from /l/ (low F3 for the
  // velar); before a glide they merge into it (agua = a-ɣʷa, one gesture)
  "β": { kind: "f", loc: [320, 900, 2300], fric: [1200, .8, .05, 400], dur: .05, voiced: .75, approx: true },
  "ɣ": { kind: "f", loc: [400, 1500, 2150], fric: [1600, .8, .05, 500], dur: .05, voiced: .75, approx: true },
  // -- plosives: closure, then a burst at [center, Q]; voiceless ones aspirate --
  // burst: [center, Q, level, highpass, length]; labials thump low and
  // short, alveolars hiss high, velars sit in the middle and last longest
  // (levels calibrated so a burst peaks about 2 dB under the vowel; voiced stops burst weakly and briefly)
  "p": { kind: "p", loc: [300, 950, 2100], burst: [1500, .3, 3.6, 600, .006], asp: .6 }, "b": { kind: "p", loc: [300, 950, 2100], burst: [900, .5, 1.1, 400, .006], voiced: 1 },
  "t": { kind: "p", loc: [300, 1700, 2600], burst: [4500, .7, 2.6, 2500, .012], asp: .7 }, "d": { kind: "p", loc: [300, 1700, 2600], burst: [3500, .7, 1.0, 1800, .008], voiced: 1 },
  "k": { kind: "p", loc: [300, 1900, 2400], burst: [2300, .9, 3.4, 1200, .02], asp: .7, velar: true }, "ɡ": { kind: "p", loc: [300, 1900, 2400], burst: [2000, .9, 1.4, 1100, .014], voiced: 1, velar: true },
  // -- affricates: a stop released into its fricative --
  "tʃ": { kind: "a", stop: "t", fric: "ʃ" }, "dʒ": { kind: "a", stop: "d", fric: "ʒ" },
  "ts": { kind: "a", stop: "t", fric: "s" }, "tɕ": { kind: "a", stop: "t", fric: "ç" },
  "pf": { kind: "a", stop: "p", fric: "f" },
};
// symbols that are two code points in the table (parsed longest-first)
const MULTI = Object.keys(PHONEMES).filter((k) => [...k].length > 1).sort((a, b) => b.length - a.length);

// ---- languages: subset, lexicon, prosody = the accent -------------------------
export const WORDS = ["hello", "please", "thanks", "goodbye", "beer", "water", "meat", "fish", "egg", "soup",
                      "horse", "dragon", "good", "bad", "church", "castle", "house", "river"];
export const LANGS = {
  en: { name: "English",
    phonemes: "i ɪ ɛ æ ɑ ʌ ɜ ə ɔ ʊ u aɪ aʊ eɪ oʊ ɔɪ j w l ɹ m n ŋ f v θ ð s z ʃ ʒ h p b t d k ɡ tʃ dʒ",
    // stress-timed: unstressed vowels shrink, stressed ones stretch, a firm fall at the end
    prosody: { rate: 1, stressLen: 1.25, unstressLen: .72, stressPitch: 1.22, fall: .78, finalLen: 1.1 },
    words: { hello: "həˈloʊ", please: "pliːz", thanks: "θæŋks", goodbye: "ɡʊdˈbaɪ", beer: "bɪɹ", water: "ˈwɔːtəɹ",
             meat: "miːt", fish: "fɪʃ", egg: "ɛɡ", soup: "suːp", horse: "hɔːɹs", dragon: "ˈdɹæɡən", good: "ɡʊd",
             bad: "bæd", church: "tʃɜːɹtʃ", castle: "ˈkɑːsəl", house: "haʊs", river: "ˈɹɪvəɹ" } },
  de: { name: "Deutsch",
    phonemes: "i ɪ y ʏ e ø ɛ œ a ɐ ə o ɔ ʊ u aɪ aʊ ɔɪ j l ʁ m n ŋ f v s z ʃ ç x h p b t d k ɡ ts pf tʃ",
    // crisp: long/short vowels matter, hard consonants, final devoicing is in the spelling
    prosody: { rate: 1, stressLen: 1.3, unstressLen: .85, stressPitch: 1.18, fall: .8, finalLen: 1.05 },
    words: { hello: "haˈloː", please: "ˈbɪtə", thanks: "ˈdaŋkə", goodbye: "aʊf ˈviːdɐzeːən", beer: "biːɐ", water: "ˈvasɐ",
             meat: "flaɪʃ", fish: "fɪʃ", egg: "aɪ", soup: "ˈzʊpə", horse: "pfeːɐt", dragon: "ˈdʁaxə", good: "ɡuːt",
             bad: "ʃlɛçt", church: "ˈkɪʁçə", castle: "bʊʁk", house: "haʊs", river: "flʊs" } },
  fr: { name: "Français",
    phonemes: "i y e ø ɛ œ a ɑ ə o ɔ u ɑ̃ ɛ̃ ɔ̃ œ̃ j w ɥ l ʁ m n ɲ f v s z ʃ ʒ p b t d k ɡ",
    // syllable-timed: even syllables, no stress bump, the last syllable lengthens and rises a touch
    prosody: { rate: 1.05, stressLen: 1.0, unstressLen: 1.0, stressPitch: 1.0, fall: 1.06, finalLen: 1.4, finalPitch: 1.12, aspirate: .15 },
    words: { hello: "bɔ̃ˈʒuʁ", please: "sil vu ˈplɛ", thanks: "mɛʁˈsi", goodbye: "o ʁəˈvwaʁ", beer: "bjɛʁ", water: "o",
             meat: "vjɑ̃d", fish: "pwaˈsɔ̃", egg: "œf", soup: "sup", horse: "ʃəˈval", dragon: "dʁaˈɡɔ̃", good: "bɔ̃",
             bad: "moˈvɛ", church: "eˈɡliz", castle: "ʃɑˈto", house: "mɛˈzɔ̃", river: "ʁiˈvjɛʁ" } },
  es: { name: "Español",
    phonemes: "i e a o u j w l ʎ r ɾ m n ɲ f θ s x β ð ɣ p b t d k ɡ tʃ",
    // quick and even: five pure vowels, all of similar length, a light stress, soft b/d/g between vowels
    prosody: { rate: 1.12, stressLen: 1.15, unstressLen: .95, stressPitch: 1.15, fall: .85, finalLen: 1.1, aspirate: .15 },
    words: { hello: "ˈola", please: "poɾ faˈβoɾ", thanks: "ˈɡɾaθjas", goodbye: "aˈðjos", beer: "θeɾˈβeθa", water: "ˈaɣwa",
             meat: "ˈkaɾne", fish: "pesˈkaðo", egg: "ˈweβo", soup: "ˈsopa", horse: "kaˈβaʎo", dragon: "dɾaˈɣon", good: "ˈbweno",
             bad: "ˈmalo", church: "iˈɣlesja", castle: "kasˈtiʎo", house: "ˈkasa", river: "ˈri.o" } },
  ru: { name: "Русский",
    phonemes: "i ɨ e ɛ a ɐ ə o u j l r m n f v s z ʂ ʐ x p b t d k ɡ ts tɕ",
    // heavy stress with reduced vowels around it, palatalized consonants (ʲ) carry a j-glide
    prosody: { rate: 1, stressLen: 1.4, unstressLen: .7, stressPitch: 1.25, fall: .75, finalLen: 1.0, aspirate: .15 },
    words: { hello: "prʲɪˈvʲet", please: "pɐˈʐalustə", thanks: "spɐˈsʲibə", goodbye: "də svʲɪˈdanʲɪjə", beer: "ˈpʲivə", water: "vɐˈda",
             meat: "ˈmʲasə", fish: "ˈrɨbə", egg: "jɪjˈtso", soup: "sup", horse: "ˈloʂətʲ", dragon: "drɐˈkon", good: "xərɐˈʂo",
             bad: "ˈploxə", church: "ˈtserkəfʲ", castle: "ˈzamək", house: "dom", river: "rʲɪˈka" } },
};
for (const l of Object.values(LANGS)) l.phonemes = new Set(l.phonemes.split(" "));

// ---- moods: the same words said three ways ------------------------------------
// A mood scales the prosody of one utterance: pitch (key), rate, how far
// stressed syllables rise, how steeply the line falls, and loudness.
export const MOODS = {
  normal:  { pitch: 1, rate: 1, stress: 1, fall: 1, vol: 1, stressLen: 1 },
  excited: { pitch: 1.18, rate: 1.1, stress: 1.22, fall: 1.06, vol: 1.15, stressLen: 1.1 },    // higher, lively, wide
  angry:   { pitch: .9, rate: 1.18, stress: 1.4, fall: .88, vol: 1.35, stressLen: .85 },        // lower key, clipped, hard stresses, falling
};

// ---- transcription -> segment timeline -------------------------------------
// tokens: phoneme symbols (longest match first), ˈ (stress the next
// syllable), ː (long), ʲ (palatalized: a j-glide after), . (syllable
// break), space (pause). Segments carry start-of-segment formant targets
// (`F`), what the vowel path is doing (`voice`, `asp`), the noise path
// (`fric`), the murmur (`nasal`), pitch stress, and duration.
export function tokenize(ipa) {
  const out = [];
  const chars = [...ipa.normalize("NFC")];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "ˈ" || c === "ː" || c === "ʲ" || c === "." || c === " " || c === "ˌ" || c === "," || c === "?" || c === "!") { out.push(c); continue; }
    const two = c + (chars[i + 1] ?? ""), three = two + (chars[i + 2] ?? "");
    const m = MULTI.find((k) => k === three) ?? MULTI.find((k) => k === two);
    if (m) { out.push(m); i += [...m].length - 1; }
    else if (PHONEMES[c]) out.push(c);
    else if (c === "ɡ" || c === "g") out.push("ɡ");
    // unknown marks are dropped
  }
  return out;
}

function timeline(ipa, lang, rate = 1, mood = "normal") {
  const M = MOODS[mood] ?? MOODS.normal, P0 = LANGS[lang]?.prosody ?? LANGS.en.prosody;
  const P = { ...P0, rate: P0.rate * M.rate, stressPitch: 1 + (P0.stressPitch - 1) * M.stress, fall: P0.fall * M.fall, stressLen: P0.stressLen * M.stressLen };
  const toks = tokenize(ipa);
  const segs = [];
  let stressNext = false, nVow = 0, wordStart = true, mark = null;
  const vowelIdx = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === "ˈ") { stressNext = true; continue; }
    if (t === "ˌ") continue;
    if (t === "." || t === "?" || t === "!") { mark = t; continue; }   // the sentence's end mark: shapes its last vowel
    if (t === ",") { segs.push({ kind: "pause", dur: .22, comma: true }); wordStart = true; continue; }
    // words join legato: a brief dip, not a silence -- speech is a stream, not a list
    if (t === " ") { if (segs.length && segs[segs.length - 1].kind !== "pause") segs.push({ kind: "pause", dur: .05 }); wordStart = true; continue; }
    if (t === "ː") {   // length: a long vowel is ~1.7x a plain one; a long (geminate) consonant is held ~2x -- for a stop that is a long closure before the release
      const last = segs[segs.length - 1];
      if (last) { last.dur *= last.kind === "v" ? 1.4 : last.kind === "p" ? 2.2 : 1.9; last.long = true; }
      continue;
    }
    if (t === "ʲ") {   // palatalized: the consonant itself takes a raised-tongue shape (F2/F3 up), and the vowel sweeps out of it
      const last = segs[segs.length - 1];
      if (last && last.F) { last.F = [last.F[0], Math.max(last.F[1], 2050), Math.max(last.F[2], 2750)]; last.pal = true; }
      continue;
    }
    const ph = PHONEMES[t];
    if (!ph) continue;
    if (ph.kind === "v") {
      const stressed = stressNext; stressNext = false;
      const lax = "ɪʏʊɛœɐəʌ".includes(t);   // lax vowels are inherently short (bitte, fish, gut vs. Bier, meat, good); English æ is open AND long (bad)
      segs.push({ kind: "v", F: ph.F, to: ph.to, nasal: ph.nasal ?? 0, dur: .165 * (lax ? .78 : 1) * (stressed ? P.stressLen : P.unstressLen), stressed, wordStart });
      wordStart = false;
      vowelIdx.push(segs.length - 1); nVow++;
    } else if (ph.kind === "g") {
      const prev = PHONEMES[toks[i - 1]], nxt = PHONEMES[toks[i + 1]];
      const seg = { ...ph, dur: ph.dur * (prev && prev.approx ? 1.5 : 1) };
      if (ph.trill === 1 && nxt && nxt.kind !== "v" && nxt.kind !== "g") { seg.dur = .065; seg.trill = 2; }   // a tap before a consonant is a short trill
      segs.push(seg);
    }
    else if (ph.kind === "n") segs.push({ kind: "n", F: ph.loc, dur: ph.dur });
    else if (ph.kind === "f") {
      const nxt = PHONEMES[toks[i + 1]];
      if (ph.approx && nxt && nxt.kind === "g") continue;   // approximant + glide = the glide, a little longer
      segs.push({ kind: "f", F: ph.loc, fric: ph.fric, dur: ph.dur, voiced: ph.voiced ?? 0, asp: ph.asp ?? 0, rough: ph.rough });
    }
    else if (ph.kind === "p") {
      let loc = ph.loc, burst = ph.burst;
      if (ph.velar) {   // velars take their place from the vowel beside them: low locus and burst by a back vowel, high by a front one
        const near = (j, d) => { for (let k = j; k >= 0 && k < toks.length; k += d) { const q = PHONEMES[toks[k]]; if (q && (q.kind === "v" || q.kind === "g")) return q; if (q && q.kind !== undefined) return null; } return null; };
        const v = near(i + 1, 1) ?? near(i - 1, -1);
        const back = v ? v.F[1] < 1350 : false;
        loc = back ? [300, 1100, 2300] : [300, 2200, 2650];
        burst = [back ? burst[0] * .65 : burst[0] * 1.15, burst[1], burst[2] * (back ? 1.5 : 1.15), back ? burst[3] * .6 : burst[3], burst[4]];
      }
      segs.push({ kind: "p", F: loc, burst, voiced: ph.voiced ?? 0, asp: ph.asp ?? 0, dur: ph.voiced ? .055 : .07 });   // lenis stops: a short, faint closure
    }
    else if (ph.kind === "a") {
      const s = PHONEMES[ph.stop], f = PHONEMES[ph.fric];
      segs.push({ kind: "p", F: s.loc, burst: [s.burst[0], s.burst[1], s.burst[2] * .4, s.burst[3], .006], voiced: s.voiced ?? 0, asp: 0, dur: .04 });
      segs.push({ kind: "f", F: f.loc, fric: f.fric, dur: f.dur * .75, voiced: f.voiced ?? 0, asp: 0 });
    }
  }
  // stops aspirate only into a following vowel or glide, never after /s/
  // (spin, not sp-hin) and only faintly at a word end or before a fricative
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.kind !== "p" || !s.asp) continue;
    s.asp *= P.aspirate ?? 1;   // unaspirated languages: only a faint release
    const nx = segs[i + 1], pv = segs[i - 1];
    const intoVowel = nx && (nx.kind === "v" || nx.kind === "g");
    const afterS = pv && pv.kind === "f" && !pv.voiced;
    if (afterS) s.asp = 0; else if (!intoVowel) s.asp *= .25;
  }
  // voice onset time: an aspirated stop is followed by 50-70 ms of breath
  // in the coming vowel's shape BEFORE the voice starts -- without that
  // delay a /p/ is a /b/. The breath becomes its own segment here.
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (s.kind === "p" && s.asp >= .3) {
      // full aspiration only at the onset of a STRESSED syllable (tea, please);
      // into an unstressed one it is a short puff (water, better, bitte)
      const nx = segs[i + 1], strong = nx && nx.kind === "v" ? nx.stressed : true;
      segs.splice(i + 1, 0, { kind: "f", F: null, fric: [1500, .3, 0, 300], dur: strong ? .045 + .04 * s.asp : .022 + .015 * s.asp, voiced: 0, asp: strong ? .8 : .5 });
      s.asp = 0;
    }
  }
  // a vowel is clipped before a voiceless obstruent and stretched before a
  // voiced one -- the main cue that tells "bad" from "bat" at the end of a word
  for (let i = 1; i < segs.length; i++) { const s = segs[i], v = segs[i - 1]; if (v.kind === "v" && (s.kind === "p" || s.kind === "f")) v.dur *= s.voiced ? 1.15 : .85; }
  // a word-final stop: a short closure and a weak release (no vowel to
  // carry it); if palatalized, it releases into a brief soft palatal hiss
  { const i = segs.length - 1, last = segs[i];
    if (last && last.kind === "p") {
      last.dur = .045; last.final = true; last.burst = [last.burst[0], last.burst[1], last.burst[2] * .6, last.burst[3], last.burst[4]];
      if (last.pal) segs.push({ kind: "f", F: PHONEMES["ç"].loc, fric: [4800, .8, .3, 2800], dur: .045, voiced: 0, asp: 0 });
    } }
  // a voiced fricative at the very end of a word loses most of its buzz (English "please", "is")
  { const last = segs[segs.length - 1]; if (last && last.kind === "f" && last.voiced) { last.voiced *= .5; last.dur *= .9; } }
  // no marked stress: stress the first vowel (English/German default) unless syllable-timed
  if (nVow && !segs.some((s) => s.stressed) && P.stressPitch > 1.0) segs[vowelIdx[0]].stressed = true;
  // the last vowel lengthens (phrase-final), pitch falls across the word
  if (vowelIdx.length) segs[vowelIdx[vowelIdx.length - 1]].dur *= P.finalLen;
  // coarticulation: an unstressed short vowel never quite reaches its target -- it is pulled a fifth of the
  // way toward the shapes on either side (a vowel that always arrives, fully formed, is the over-articulated
  // precision of a machine; a real tongue is already on its way to the next sound)
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.kind !== "v" || s.stressed || s.to || s.long) continue;
    const nb = [segs[i - 1], segs[i + 1]].filter((q) => q && q.F && q.kind !== "pause");
    if (!nb.length) continue;
    const m = [0, 1, 2].map((k) => nb.reduce((a, q) => a + q.F[k], 0) / nb.length);
    s.F = s.F.map((v, k) => v + (m[k] - v) * .2);
  }
  // "h" and other shapeless segments borrow the following vowel's formants
  for (let i = 0; i < segs.length; i++) if (!segs[i].F && segs[i].kind !== "pause") {
    const nx = segs.slice(i + 1).find((s) => s.F);
    segs[i].F = nx ? nx.F : [500, 1450, 2450];
  }
  let t = 0;
  const vi = vowelIdx;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    s.dur /= rate * P.rate;
    if (s.kind !== "pause") s.dur *= .93 + Math.random() * .14;   // timing life: nobody says two segments at exactly the same length (a metronome is the other machine tell)
    s.t0 = t; t += s.dur; s.t1 = t;
    // intonation: each vowel gets an onset and an offset pitch. The line
    // declines from 1.12 to `fall` across the word; the stressed vowel RISES
    // through itself to the peak (the accent), unstressed vowels sag a
    // little, and the last vowel falls away (or lifts, where the accent
    // says so). Consonants ride whatever the voice is doing.
    const vk = vi.indexOf(i);
    if (vk >= 0) {
      // the line declines across the WHOLE utterance; every new word steps
      // up a little (the sawtooth of speech); unstressed syllables
      // alternate slightly so nothing is flat; a comma lifts the vowel
      // before it (there is more to come); the end mark shapes the last
      // vowel: a fall for a statement, a deeper one with a higher peak
      // for an exclamation, a rise for a question
      const k = vi.length > 1 ? vk / (vi.length - 1) : 0;
      const d = (1.12 + (P.fall - 1.12) * k) * (s.wordStart && vk > 0 ? 1.06 : 1) * (.985 + Math.random() * .03);   // (each syllable a percent or so off the line)
      const wob = s.stressed ? 1 : (.97 + .02 * (vk % 2 ? 1 : -1));
      // micro-prosody: out of a voiceless consonant the voice starts a little high and settles, out of a
      // voiced one it starts low and rises (the larynx's own physics, heard as consonant "color" on the vowel)
      const pc = segs[i - 1], onset = pc && (pc.kind === "p" || pc.kind === "f") ? (pc.voiced ? .975 : 1.04) : 1;
      s.pitch0 = d * (s.stressed ? 1.0 : wob) * onset;
      s.pitch1 = d * (s.stressed ? P.stressPitch : wob * .96);
      const nx = segs.slice(i + 1).find((q) => q.kind !== "pause" || q.comma);
      if (nx && nx.comma) s.pitch1 *= 1.1;
      if (vk === vi.length - 1) {
        if (mark === "?") { s.pitch1 *= 1.32; s.dur *= 1.25; }
        else if (mark === "!") { s.pitch0 *= 1.1; s.pitch1 *= .72; }
        else s.pitch1 *= P.finalPitch ?? .8;
      }
    }
  }
  return { segs, total: t };
}

// ---- the synthesizer --------------------------------------------------------
// A persistent voice: one graph, automated per utterance. `scale` scales
// every formant (1 = the reference male throat, ~1.15 a female one, ~1.3 a
// child); `pitch` the base f0 in Hz. Utterances queue: say() returns when
// this one ends, and the next one waits for it.
// `breath`: a little aspiration noise under every voiced sound (0..1);
// `tilt`: dB of high-shelf lift on the voice source (less = softer, darker).
// Female voices are higher and breathier with a gentler tilt; that
// difference, more than pitch alone, is what makes them read as female.
// `flutter`: how much the pitch wanders (0..1) -- a perfectly steady buzz
// is what sounds like a machine; real voices drift a few percent slowly,
// jitter a little fast, and carry a faint vibrato.
export function createSpeaker(ctx, { pitch = 115, scale = 1, rate = 1, volume = .5, dest, breath = 0, tilt = 8, flutter = .7 } = {}) {
  const out = ctx.createGain(); out.gain.value = volume;
  const soften = ctx.createBiquadFilter(); soften.type = "lowpass"; soften.frequency.value = 9500; soften.Q.value = .5;   // takes the wire off the buzz; sibilants keep their peak
  // sources
  const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.value = pitch;
  // source spectrum: the sawtooth falls 6 dB/oct; real speech (glottal
  // pulse + lip radiation) is close to that but the upper formants still
  // need lift to be heard, so a shelf raises everything above 1 kHz
  const glottal = ctx.createBiquadFilter(); glottal.type = "highshelf"; glottal.frequency.value = 1000 * scale; glottal.gain.value = tilt - 6;   // (the cascade needs almost no lift; the shelf now only tells voices apart)
  const voice = ctx.createGain(); voice.gain.value = 0;
  osc.connect(glottal); glottal.connect(voice);
  const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource(); noise.buffer = nb; noise.loop = true;
  const asp = ctx.createGain(); asp.gain.value = 0;      // aspiration: noise through the vowel resonators
  const fricG = ctx.createGain(); fricG.gain.value = 0;  // frication: noise through its own resonator
  const fricLevel = ctx.createGain(); fricLevel.gain.value = .09;   // the noise path is ~20 dB hotter than the cascaded voice: calibrated so /s/ sits ~10 dB under a vowel
  // two highpass stages in cascade (24 dB/oct): a sibilant's low edge is a
  // cliff, and a single stage leaves enough 2-4 kHz rumble to dull an /s/
  const fricHP = ctx.createBiquadFilter(); fricHP.type = "highpass"; fricHP.frequency.value = 3000; fricHP.Q.value = .7;
  const fricHP2 = ctx.createBiquadFilter(); fricHP2.type = "highpass"; fricHP2.frequency.value = 3000; fricHP2.Q.value = .7;
  const fricF = ctx.createBiquadFilter(); fricF.type = "bandpass"; fricF.frequency.value = 4000; fricF.Q.value = 1;
  noise.connect(fricHP); fricHP.connect(fricHP2); fricHP2.connect(fricF); fricF.connect(fricG); fricG.connect(fricLevel); fricLevel.connect(out);
  // pitch life: lowpassed noise wanders the frequency (slow drift + fast jitter), a 5 Hz sine adds a light vibrato.
  // NOTE the gains: white noise through a 6 Hz lowpass keeps ~1/40 of its amplitude (RMS ~.013), through an
  // 80 Hz band ~.05 -- so the modulators are scaled by those, for ~1.3% RMS drift and ~.4% cycle jitter, the
  // natural amounts (measured offline: an unmeasured version had .04% and sounded like a machine)
  const drift = ctx.createBiquadFilter(); drift.type = "lowpass"; drift.frequency.value = 6; drift.Q.value = .5;
  const driftG = ctx.createGain(); driftG.gain.value = pitch * 1.0 * flutter;
  noise.connect(drift); drift.connect(driftG); driftG.connect(osc.frequency);
  const jit = ctx.createBiquadFilter(); jit.type = "bandpass"; jit.frequency.value = 40; jit.Q.value = .5;
  const jitG = ctx.createGain(); jitG.gain.value = pitch * .22 * flutter;
  noise.connect(jit); jit.connect(jitG); jitG.connect(osc.frequency);
  const vib = ctx.createOscillator(); vib.frequency.value = 5.3; const vibG = ctx.createGain(); vibG.gain.value = pitch * .005 * flutter;   // (a steady vibrato is singing: kept faint under the drift)
  vib.connect(vibG); vibG.connect(osc.frequency); vib.start();
  // amplitude shimmer: the voice's level flickers a few percent (25 Hz lowpassed noise, RMS ~.027, scaled to ~3%)
  const shim = ctx.createGain(); shim.gain.value = 1;
  const shimN = ctx.createBiquadFilter(); shimN.type = "lowpass"; shimN.frequency.value = 25; shimN.Q.value = .5;
  const shimG = ctx.createGain(); shimG.gain.value = 1.2 * flutter;
  noise.connect(shimN); shimN.connect(shimG); shimG.connect(shim.gain);
  // aspiration is pulsed by the glottis: the breath noise is gated by the voice's own cycle (open phase loud,
  // closed phase quiet), which is what makes breathiness sound like a throat and not a hiss laid on top
  const gate = ctx.createGain(); gate.gain.value = .5;
  const gateD = ctx.createGain(); gateD.gain.value = .5; osc.connect(gateD); gateD.connect(gate.gain);
  noise.connect(gate); gate.connect(asp);
  // the vowel tract: a CASCADE of resonances in series (Klatt's arrangement)
  // -- peaking filters F1..F3 that move, F4/F5 fixed for the throat's
  // upper resonances. In series the formants' relative levels and
  // bandwidths come out the way a real tract makes them (a high F1 is
  // loud, a low F1 leaves the upper formants weaker), instead of three
  // narrow bands each ringing on its own.
  const mix = ctx.createGain(); voice.connect(shim); shim.connect(mix); asp.connect(mix);
  // moderate peaks (15 dB peaks over an unsupported fundamental is what a
  // small radio sounds like), a chest shelf under 250 Hz, and the voice
  // rolled off above ~5.5 kHz -- the hiss path keeps its own top end
  // F1 moderate (a big F1 peak over the fundamental is the radio sound), F2/F3 full: they carry the consonants' place cues
  const F = [[500, 5.5, 12], [1450, 7, 13], [2450, 8, 11]].map(([fr, q, g]) => {
    const f = ctx.createBiquadFilter(); f.type = "peaking"; f.Q.value = q; f.gain.value = g; f.frequency.value = fr * scale; return f;
  });
  const F4 = ctx.createBiquadFilter(); F4.type = "peaking"; F4.frequency.value = 3400 * scale; F4.Q.value = 6; F4.gain.value = 6;
  const F5 = ctx.createBiquadFilter(); F5.type = "peaking"; F5.frequency.value = 4400 * scale; F5.Q.value = 6; F5.gain.value = 4;
  const chest = ctx.createBiquadFilter(); chest.type = "lowshelf"; chest.frequency.value = 250 * scale; chest.gain.value = 2;
  const warm = ctx.createBiquadFilter(); warm.type = "lowpass"; warm.frequency.value = 6500 * scale; warm.Q.value = .6;
  const tractOut = ctx.createGain(); tractOut.gain.value = .3;   // the cascade's peaks add up: bring the tract back to level
  mix.connect(chest); chest.connect(F[0]); F[0].connect(F[1]); F[1].connect(F[2]); F[2].connect(F4); F4.connect(F5); F5.connect(warm); warm.connect(tractOut); tractOut.connect(out);
  // the nasal murmur
  const nasF = ctx.createBiquadFilter(); nasF.type = "bandpass"; nasF.frequency.value = 260 * scale; nasF.Q.value = 3;
  const nasG = ctx.createGain(); nasG.gain.value = 0;
  glottal.connect(nasF); nasF.connect(nasG); nasG.connect(out);
  out.connect(soften); soften.connect(dest ?? ctx.destination);   // `dest`: a node of the caller's (spatial gain, panner)
  osc.start(); noise.start();

  let busyUntil = 0;
  // frequencies glide linearly; gains follow exponential approaches
  // (setTargetAtTime), which never jump and so never click -- the "cutoff"
  // sound of a hard gain step is what these avoid
  const ramp = (param, v, t) => param.linearRampToValueAtTime(v, t);
  const hold = (param, v, t) => param.setValueAtTime(v, t);
  const G = (param, v, t, tau = .014) => param.setTargetAtTime(v, t, tau);
  const setFric = ([fc, q, , hp], t) => {   // the noise band: highpass corner then the peak
    hold(fricHP.frequency, Math.min(9000, (hp ?? fc * .5) * scale), t); hold(fricHP2.frequency, Math.min(9000, (hp ?? fc * .5) * scale), t);
    hold(fricF.frequency, Math.min(10000, fc * scale), t); hold(fricF.Q, q, t);
  };

  function schedule(ipa, lang, at, mood = "normal") {
    const start = Math.max(at ?? ctx.currentTime + .02, busyUntil, ctx.currentTime + .01);
    const M = MOODS[mood] ?? MOODS.normal;
    const { segs, total } = timeline(ipa, lang, rate, mood);
    out.gain.setTargetAtTime(volume * M.vol, start, .03);
    const TR = .045;   // formant transition time at every boundary (glides take longer)
    // initial state: the tract already in the first shape, everything silent
    const first = segs.find((s) => s.F) ?? { F: [500, 1450, 2450] };
    F.forEach((f, i) => hold(f.frequency, first.F[i] * scale, start));
    // A linear ramp starts from wherever the previous automation ended, so
    // without a hold the formants would drift across a whole vowel toward
    // the next consonant. moveF pins the current targets at tStart, then
    // sweeps to the new ones by tEnd: steady vowels, transitions where and
    // only where they belong.
    const curF = first.F.map((v) => v * scale);
    const moveF = (target, tStart, tEnd) => F.forEach((f, i) => {
      hold(f.frequency, curF[i], tStart); curF[i] = target[i] * scale; ramp(f.frequency, curF[i], tEnd);
    });
    for (const p of [voice.gain, asp.gain, fricG.gain, nasG.gain]) G(p, 0, start, .005);
    const mel = (.96 + Math.random() * .08) * M.pitch;   // this utterance's own key (and the mood's): repeats never sound stamped out
    hold(osc.frequency, pitch * 1.05 * mel, start);
    for (const s of segs) {
      const t0 = start + s.t0, t1 = start + s.t1;
      if (s.kind === "pause") { for (const p of [voice.gain, asp.gain, fricG.gain, nasG.gain]) G(p, 0, t0, .03); continue; }
      // formant targets: glide into this segment's shape, diphthongs glide on to their second target
      const pv = segs[segs.indexOf(s) - 1], prevG = pv && (pv.kind === "g" || pv.pal);
      const tr = s.kind === "g" ? .07 : prevG ? .1 : pv?.kind === "p" ? .022 : TR;   // out of a glide the vowel arrives slowly: that sweep IS the glide; out of a stop it snaps (a slow voiced sweep from /b/ is a /w/: "bad" -> "wed")
      // a stop: the voice is cut first, THEN the tract moves to the stop's
      // place inside the silent closure -- a voiced sweep toward it would
      // sound like an /l/ ("water" -> "walter")
      // (every move finishes inside its segment: a ramp still in flight
      // when the next segment pins the value would jump -- an audible cut)
      const nx = segs[segs.indexOf(s) + 1], relMove = s.kind === "p" && nx && nx.F && nx.kind !== "p" && nx.kind !== "pause";
      const relAt = t1 - (s.asp >= .3 || s.voiced ? .02 : .008);   // the release
      if (s.kind === "p") {
        // the tract is in place for the closure, and the RELEASE sweeps it
        // into the next sound within ~25 ms -- the transition is finished
        // by the time the voice is loud (a slow voiced sweep is a /w/: "bad" -> "wed")
        // -- and it is VOICED: the voice comes on 3 ms after the release
        // while the formants are still moving; that voiced ~35 ms rise of F1
        // and F2 is what makes a /b/ a /b/ (unvoiced, it is a click before the vowel)
        const sweep = relMove ? relAt - .002 : t1;
        moveF(s.F, Math.min(t0 + .015, t1 - .01), relMove ? Math.min(t0 + .045, sweep - .003) : Math.min(t0 + .045, t1 - .004));
        if (relMove) { moveF(nx.F, sweep, sweep + .035); nx.swept = true; }   // runs on into the next segment, which must not pin it
      }
      else if (s.swept) { if (s.nasal) moveF([s.F[0] * .85, s.F[1], s.F[2]], t0 + .035, t0 + .035 + TR); }
      else if (s.kind === "f" && !s.voiced) moveF(s.F, Math.min(t0 + .012, t1 - .01), Math.min(t0 + .04, t1 - .004));   // voiceless hiss: the voice is cut first, then the tract moves -- no voiced dental tail (that tail is a lisp)
      else moveF(s.F, t0, Math.min(t0 + tr, t1 - .004));
      if (s.to) moveF(s.to, Math.max(t0 + s.dur * .4, s.swept ? t0 + .04 : 0), t1);   // diphthong: hold the first target, then glide to the second
      if (s.pitch0) {
        ramp(osc.frequency, pitch * s.pitch0 * mel, t0 + .025);
        if (s.stressed && s.pitch1 > s.pitch0) { ramp(osc.frequency, pitch * s.pitch1 * mel, t0 + s.dur * .62); ramp(osc.frequency, pitch * s.pitch1 * .965 * mel, t1); }   // the accent peaks and turns: a rise-fall, not a slide
        else ramp(osc.frequency, pitch * s.pitch1 * mel, t1);
      }
      if (s.kind === "v") {
        G(voice.gain, 1, t0, pv?.kind === "p" ? .006 : .02); G(asp.gain, breath * .1, t0); G(fricG.gain, 0, t0);   // out of a stop the voice arrives abruptly
        G(nasG.gain, s.nasal * .1, t0);
        if (s.nasal && !s.swept) moveF([s.F[0] * .85, s.F[1], s.F[2]], t0, t0 + TR);
      } else if (s.kind === "g") {
        G(voice.gain, s.amp ?? .8, t0, .02); G(asp.gain, breath * .085, t0); G(nasG.gain, 0, t0);
        if (s.fric) { setFric(s.fric, t0); G(fricG.gain, s.fric[2], t0); } else G(fricG.gain, 0, t0);
        if (s.trill) for (let k = 0; k < s.trill; k++) {   // flaps: quick dips of the voice, smoothly
          const tk = t0 + s.dur * (k + .3) / s.trill;
          G(voice.gain, .12, tk, .006); G(voice.gain, s.amp ?? .7, tk + .014, .008);
        }
      } else if (s.kind === "n") {
        G(voice.gain, .1, t0, .02); G(nasG.gain, .22, t0, .02); G(asp.gain, 0, t0); G(fricG.gain, 0, t0);   // the murmur resonator is hot: .22 puts /m/ ~7 dB under a vowel
      } else if (s.kind === "f") {
        setFric(s.fric, t0);
        G(fricG.gain, s.fric[2] * (s.voiced ? 1.7 : 1), t0, s.fric[3] > 3500 ? .03 : .02); G(voice.gain, s.voiced * .55, t0, s.voiced ? .015 : .006); G(nasG.gain, 0, t0);   // voiced: friction over a lighter buzz
        if (s.rough) for (let k = 0; k < s.rough; k++) {   // the uvula flapping in the airstream: dips in the noise
          const tk = t0 + s.dur * (k + .35) / s.rough;
          G(fricG.gain, s.fric[2] * .25, tk, .004); G(fricG.gain, s.fric[2], tk + .012, .006);
        }
        G(asp.gain, s.asp * .42, t0, .02);   // aspiration sits ~10 dB under a vowel (the gate halves its mean: .42 here is the old .25)
      } else if (s.kind === "p") {
        // closure: silence (a voice bar for the voiced ones), then the burst and aspiration on release
        const rel = relAt;   // unaspirated: the burst sits right against the vowel
        G(voice.gain, s.voiced * (s.final ? .3 : segs.indexOf(s) === 0 ? .03 : .1), t0, .006);   // an utterance-initial voiced stop is all but silent in its closure (a hum there is an /m/) G(asp.gain, 0, t0, .01); G(nasG.gain, 0, t0, .01); G(fricG.gain, 0, t0, .01);   // a voice bar through the closure, stronger for a final voiced stop (bad, not bat)
        setFric(s.burst, rel);
        // the burst's fade must END before the next segment starts: an
        // automation event landing inside it would switch that segment's
        // onset off ("thanks" lost its s to the k's fade and became "thant")
        G(fricG.gain, s.burst[2], rel, .003); G(fricG.gain, 0, Math.min(rel + (s.burst[4] ?? .012), t1 - .003), .004);
        if (s.asp) { G(asp.gain, s.asp * .34, rel + .006, .01); G(asp.gain, 0, Math.min(rel + .045, t1 - .002), .015); }
        if (s.voiced) G(voice.gain, s.final ? .25 : .85, rel + .003, .006);   // voicing snaps on at the release (a slow rise is a glide); a final one gets no vowel-like tail
      }
    }
    const end = start + total;
    const lastS = segs[segs.length - 1], endTau = lastS?.kind === "p" ? .012 : .035;   // a breath's fade, not a cut -- but a final stop ends crisply, no "bad-uh"
    for (const p of [voice.gain, asp.gain, fricG.gain, nasG.gain]) G(p, 0, end, endTau);
    busyUntil = end + .12;
    return end + .1;
  }
  // a sentence: words from the lexicon by key, anything else taken as IPA,
  // with , . ? ! shaping the melody ("hello, beer please!")
  const toIPA = (text, lang) => text.trim().split(/\s+/).map((tok) => {
    const m = tok.match(/^(.*?)([,.?!]*)$/), key = m[1], punct = m[2];
    const w = LANGS[lang]?.words[key.toLowerCase()];
    return (w ?? key) + punct;
  }).join(" ");
  return {
    say: (word, lang = "en", at, mood) => { const w = LANGS[lang]?.words[word]; return w ? schedule(w, lang, at, mood) : ctx.currentTime; },
    sayText: (text, lang = "en", at, mood) => schedule(toIPA(text, lang), lang, at, mood),
    sayIPA: (ipa, lang = "en", at, mood) => schedule(ipa, lang, at, mood),
    get busyUntil() { return busyUntil; },
    stop() {   // fade first: a stopped oscillator at full gain clicks
      const t = ctx.currentTime;
      out.gain.setTargetAtTime(0, t, .02);
      setTimeout(() => { try { osc.stop(); noise.stop(); vib.stop(); } catch (e) { /* already stopped */ } out.disconnect(); }, 120);
    },
    node: out,
  };
}

// Render one utterance to a buffer (tests, previews): no live context needed.
export async function renderWord(word, lang, voice = {}, sampleRate = 22050) {
  const ipa = LANGS[lang]?.words[word] ?? word;
  const dur = timeline(ipa, lang, voice.rate ?? 1).total + .3;
  const ctx = new OfflineAudioContext(1, Math.ceil(dur * sampleRate), sampleRate);
  const sp = createSpeaker(ctx, voice);
  sp.sayIPA(ipa, lang, .02);
  return ctx.startRendering();
}
