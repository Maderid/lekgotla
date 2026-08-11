/**
 * The model is instructed carefully but it is still a model, so nothing it
 * returns reaches the browser unchecked. This module is the gate: it trims,
 * drops malformed entries, dedupes, and refuses packs too thin to play.
 */

export const MIN_VOCAB = 6;

export const LANGUAGES = {
  zu: {
    code: 'zu',
    name: 'isiZulu',
    bcp47: 'zu-ZA',
    // Voices whose vowel values are closest to isiZulu when no zu voice
    // exists. English is deliberately absent — it mangles these languages.
    voiceFallbacks: ['zu-ZA', 'xh-ZA', 'sw-KE', 'sw-TZ', 'af-ZA', 'it-IT', 'es-ES', 'pt-PT'],
    recognition: 'zu-ZA',
    specialChars: [],
  },
  nso: {
    code: 'nso',
    name: 'Sepedi',
    bcp47: 'nso-ZA',
    voiceFallbacks: ['nso-ZA', 'st-ZA', 'tn-ZA', 'sw-KE', 'sw-TZ', 'af-ZA', 'it-IT', 'es-ES', 'pt-PT'],
    // Chrome has no Sepedi recogniser. Null means the speaking level falls
    // back to record-and-compare instead of failing the learner.
    recognition: null,
    specialChars: ['š', 'ê', 'ô', 'Š', 'Ê', 'Ô'],
  },
  other: {
    code: 'other',
    name: 'the target language',
    bcp47: '',
    voiceFallbacks: ['sw-KE', 'af-ZA', 'it-IT', 'es-ES'],
    recognition: null,
    specialChars: [],
  },
};

const clean = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\s+/g, ' ')
    // Strip leading bullets, dashes and numbering the slide text leaves behind.
    .replace(/^[\s•·\-–—*\d.)\]]+/, '')
    .replace(/[\s:;,]+$/, '')
    .trim();
};

const isUsable = (value, max = 200) => value.length > 0 && value.length <= max;

function normaliseVocab(raw) {
  const seen = new Set();
  const out = [];

  for (const item of Array.isArray(raw) ? raw : []) {
    const target = clean(item && item.target);
    const english = clean(item && item.english);
    if (!isUsable(target, 80) || !isUsable(english, 160)) continue;

    // A "vocab" entry whose target is identical to its English gloss is almost
    // always a parsing slip rather than a real word.
    if (target.toLowerCase() === english.toLowerCase()) continue;

    const key = target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      id: `v${out.length}`,
      target,
      english,
      category: clean(item.category) || null,
      note: clean(item.note) || null,
    });
  }

  return out;
}

function normalisePhrases(raw) {
  const seen = new Set();
  const out = [];

  for (const item of Array.isArray(raw) ? raw : []) {
    const target = clean(item && item.target);
    const english = clean(item && item.english);
    if (!isUsable(target, 200) || !isUsable(english, 240)) continue;
    if (target.toLowerCase() === english.toLowerCase()) continue;

    const key = target.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      id: `p${out.length}`,
      target,
      english,
      literal: clean(item.literal) || null,
    });
  }

  return out;
}

function normaliseDialogues(raw) {
  const out = [];

  for (const item of Array.isArray(raw) ? raw : []) {
    const lines = [];
    for (const line of Array.isArray(item && item.lines) ? item.lines : []) {
      const target = clean(line && line.target);
      const english = clean(line && line.english);
      if (!isUsable(target, 240)) continue;
      lines.push({
        speaker: clean(line.speaker) || null,
        target,
        english: isUsable(english, 240) ? english : null,
      });
    }
    if (lines.length < 2) continue;

    out.push({
      id: `d${out.length}`,
      title: clean(item.title) || 'Conversation',
      context: clean(item.context) || null,
      lines,
    });
  }

  return out;
}

function normaliseRules(raw) {
  const out = [];

  for (const item of Array.isArray(raw) ? raw : []) {
    const title = clean(item && item.title);
    const detail = clean(item && item.detail);
    if (!isUsable(title, 160) || !isUsable(detail, 800)) continue;

    out.push({
      id: `r${out.length}`,
      title,
      detail,
      examples: (Array.isArray(item.examples) ? item.examples : [])
        .map(clean)
        .filter((example) => isUsable(example, 200))
        .slice(0, 6),
    });
  }

  return out;
}

function normaliseFactQuestions(raw) {
  const out = [];

  for (const item of Array.isArray(raw) ? raw : []) {
    const question = clean(item && item.question);
    if (!isUsable(question, 300)) continue;

    const options = (Array.isArray(item.options) ? item.options : [])
      .map((option) => clean(option))
      .filter((option) => isUsable(option, 200));

    // Duplicate options make a question unanswerable, so drop the whole item.
    const unique = new Set(options.map((option) => option.toLowerCase()));
    if (options.length < 3 || unique.size !== options.length) continue;

    const answerIndex = Number(item.answerIndex);
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) continue;

    out.push({
      id: `f${out.length}`,
      question,
      options,
      answerIndex,
      explanation: clean(item.explanation) || null,
    });
  }

  return out;
}

/**
 * Validate and normalise a raw model response into a playable lesson pack.
 * Throws a 422 if the document simply did not contain enough to play with.
 */
export function normalisePack(raw, meta = {}) {
  const languageCode = LANGUAGES[raw && raw.languageCode] ? raw.languageCode : 'other';
  const language = LANGUAGES[languageCode];

  const vocab = normaliseVocab(raw && raw.vocab);
  const phrases = normalisePhrases(raw && raw.phrases);
  const dialogues = normaliseDialogues(raw && raw.dialogues);
  const rules = normaliseRules(raw && raw.rules);
  const factQuestions = normaliseFactQuestions(raw && raw.factQuestions);

  if (vocab.length < MIN_VOCAB) {
    throw new Error(
      `This document only yielded ${vocab.length} usable word${vocab.length === 1 ? '' : 's'}, and a challenge needs at least ${MIN_VOCAB}. Try a worksheet with a vocabulary list or a glossed dialogue.`
    );
  }

  return {
    version: 1,
    title: clean(raw && raw.title) || meta.filename || 'Untitled challenge',
    summary: clean(raw && raw.summary) || null,
    language: {
      code: language.code,
      name: clean(raw && raw.languageName) || language.name,
      bcp47: language.bcp47,
      voiceFallbacks: language.voiceFallbacks,
      recognition: language.recognition,
      specialChars: language.specialChars,
    },
    vocab,
    phrases,
    dialogues,
    rules,
    factQuestions,
    source: {
      filename: meta.filename || null,
      pagesRead: meta.pagesRead || null,
      totalPages: meta.totalPages || null,
      truncated: Boolean(meta.truncated),
      readMode: meta.needsVision ? 'pages' : 'text',
    },
    counts: {
      vocab: vocab.length,
      phrases: phrases.length,
      dialogues: dialogues.length,
      rules: rules.length,
      factQuestions: factQuestions.length,
    },
  };
}
