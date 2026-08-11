/**
 * Speech for isiZulu and Sepedi in a browser that was not built with either in
 * mind.
 *
 * The honest situation: Chrome sometimes ships an isiZulu voice, and almost
 * never a Sepedi one. When no native voice exists we fall back to a voice whose
 * vowels are closest — Afrikaans, Swahili, Italian — and never to English,
 * whose vowel set turns "dumela" into something a Sepedi speaker would not
 * recognise. The UI always says which voice it ended up using, because an
 * approximation presented as authoritative is how people learn wrong habits.
 */

const RATE = 0.82;
const PITCH = 1;

/**
 * Substitutions applied only when a non-native voice is doing the reading.
 * Deliberately conservative: each one exists because the fallback voice has no
 * grapheme for the sound and would otherwise fall silent or spell it out.
 */
const RESPELL = {
  // Latin-vowel voices (Italian, Spanish, Portuguese, Afrikaans, Swahili) read
  // these five vowels close to their Zulu and Sepedi values already, so the
  // work here is only to remove marks the engine cannot interpret.
  generic: [
    [/š/g, 'sh'],
    [/Š/g, 'Sh'],
    [/ê/g, 'e'],
    [/Ê/g, 'E'],
    [/ô/g, 'o'],
    [/Ô/g, 'O'],
    // Tone marks are meaningful to a reader but no TTS engine renders them.
    [/[̀́]/g, ''],
  ],
  // Italian has no "sh" digraph; "sc" before a front vowel is its nearest.
  'it': [
    [/sh(?=[ei])/gi, 'sc'],
    [/sh/gi, 'sci'],
  ],
  // Spanish has neither "sh" nor a reliable "h"; "ch" is the closest available.
  'es': [
    [/sh/gi, 'ch'],
  ],
};

const normaliseLang = (lang) => String(lang || '').replace('_', '-').toLowerCase();

class SpeechEngine {
  constructor() {
    this.voices = [];
    this.ready = false;
    this.listeners = new Set();
    this.supported =
      typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

    if (this.supported) this._loadVoices();
  }

  _loadVoices() {
    const load = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length) {
        this.voices = voices;
        this.ready = true;
        this.listeners.forEach((fn) => fn());
      }
    };

    load();
    window.speechSynthesis.addEventListener('voiceschanged', load);
    // Safari populates the list lazily and never fires the event on first load.
    let tries = 0;
    const poll = setInterval(() => {
      load();
      if (this.ready || ++tries > 20) clearInterval(poll);
    }, 150);
  }

  onReady(fn) {
    this.listeners.add(fn);
    if (this.ready) fn();
    return () => this.listeners.delete(fn);
  }

  /**
   * Choose the best available voice for a language pack, and describe how good
   * the match actually is so the interface can be honest about it.
   */
  selectVoice(language) {
    if (!this.supported || !this.voices.length) {
      return {
        voice: null,
        quality: 'none',
        label: `No speech voices are available in this browser, so ${language.name} cannot be read aloud here. Chrome or Safari on a desktop usually has them.`,
      };
    }

    const wanted = (language.voiceFallbacks || []).map(normaliseLang);
    const native = normaliseLang(language.bcp47).split('-')[0];

    for (let i = 0; i < wanted.length; i += 1) {
      const target = wanted[i];
      const base = target.split('-')[0];

      const exact = this.voices.find((voice) => normaliseLang(voice.lang) === target);
      const loose = this.voices.find((voice) => normaliseLang(voice.lang).split('-')[0] === base);
      const voice = exact || loose;
      if (!voice) continue;

      const isNative = base === native && native;
      return {
        voice,
        quality: isNative ? 'native' : 'approximate',
        label: isNative
          ? `Native ${language.name} voice (${voice.name})`
          : `Approximate — no ${language.name} voice installed, using ${voice.name}`,
        respellKey: isNative ? null : base,
      };
    }

    // Nothing suitable. An English voice would actively mislead, so refuse it
    // and let the interface fall back to the written pronunciation notes.
    return {
      voice: null,
      quality: 'none',
      label: `No suitable voice for ${language.name} is installed. Reading it aloud would teach the wrong sounds, so playback is off.`,
    };
  }

  _respell(text, key) {
    if (!key) return text;
    let out = text;
    for (const [pattern, replacement] of RESPELL.generic) out = out.replace(pattern, replacement);
    for (const [pattern, replacement] of RESPELL[key] || []) out = out.replace(pattern, replacement);
    return out;
  }

  cancel() {
    if (this.supported) window.speechSynthesis.cancel();
  }

  /**
   * Speak a word. Resolves when playback finishes, rejects if it cannot speak.
   */
  speak(text, selection, { rate = RATE, slow = false } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.supported || !selection || !selection.voice) {
        reject(new Error('no-voice'));
        return;
      }

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(
        this._respell(text, selection.respellKey)
      );
      utterance.voice = selection.voice;
      utterance.lang = selection.voice.lang;
      utterance.rate = slow ? Math.max(0.55, rate - 0.25) : rate;
      utterance.pitch = PITCH;

      let settled = false;
      const finish = (fn) => (value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };

      utterance.onend = finish(resolve);
      utterance.onerror = finish(() => reject(new Error('speech-failed')));

      window.speechSynthesis.speak(utterance);

      // Chrome occasionally drops utterances silently; do not hang the UI.
      setTimeout(finish(resolve), Math.max(4000, text.length * 220));
    });
  }
}

/* ---------------------------------------------------------------------- */

/** Strip diacritics and case for comparing what was heard to what was meant. */
export function loosen(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z ]/g, '')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** 0 to 1, where 1 is identical once diacritics and case are set aside. */
export function similarity(a, b) {
  const left = loosen(a);
  const right = loosen(b);
  if (!left && !right) return 1;
  const longest = Math.max(left.length, right.length);
  if (!longest) return 0;
  return 1 - levenshtein(left, right) / longest;
}

/* ---------------------------------------------------------------------- */

const Recognition =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

export const recognitionAvailable = Boolean(Recognition);

/**
 * Listen for one spoken attempt.
 *
 * Even where a recogniser exists for the language it is trained on connected
 * speech, not isolated words, so callers must treat a low score as "try again"
 * rather than "you were wrong" — and must always offer a manual override.
 */
export function listenOnce(lang, { timeout = 6000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!Recognition) {
      reject(new Error('unsupported'));
      return;
    }

    const recogniser = new Recognition();
    recogniser.lang = lang;
    recogniser.interimResults = false;
    recogniser.maxAlternatives = 5;
    recogniser.continuous = false;

    let settled = false;
    const done = (fn) => (value) => {
      if (settled) return;
      settled = true;
      try {
        recogniser.stop();
      } catch {
        /* already stopped */
      }
      fn(value);
    };

    const finish = done(resolve);
    const fail = done(reject);

    recogniser.onresult = (event) => {
      const alternatives = [];
      for (const result of event.results) {
        for (let i = 0; i < result.length; i += 1) {
          alternatives.push({
            transcript: result[i].transcript,
            confidence: result[i].confidence,
          });
        }
      }
      finish(alternatives);
    };

    recogniser.onerror = (event) => fail(new Error(event.error || 'recognition-failed'));
    recogniser.onend = () => finish([]);

    try {
      recogniser.start();
    } catch (error) {
      fail(error);
      return;
    }

    setTimeout(() => finish([]), timeout);
  });
}

/**
 * Record from the microphone so the learner can play their attempt back against
 * the model word. This is the fallback wherever recognition does not exist, and
 * it is the more useful tool of the two for shaping pronunciation.
 */
export class Recorder {
  constructor() {
    this.chunks = [];
    this.recorder = null;
    this.stream = null;
  }

  static get available() {
    return Boolean(
      typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        navigator.mediaDevices.getUserMedia &&
        typeof MediaRecorder !== 'undefined'
    );
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) this.chunks.push(event.data);
    };
    this.recorder.start();
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.recorder) {
        resolve(null);
        return;
      }
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' });
        this.stream.getTracks().forEach((track) => track.stop());
        this.recorder = null;
        this.stream = null;
        resolve(URL.createObjectURL(blob));
      };
      this.recorder.stop();
    });
  }
}

export const speech = new SpeechEngine();
