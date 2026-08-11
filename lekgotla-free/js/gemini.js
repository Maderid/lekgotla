/**
 * The extraction call, made straight from the browser with the learner's own
 * Google AI Studio key.
 *
 * This is why the site costs nothing to run: there is no server in the middle,
 * and each person spends their own free quota rather than the site owner's.
 * The trade is that the key lives in this browser's local storage, so the app
 * says so plainly and offers a way to forget it.
 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const KEY_STORAGE = 'lekgotla.gemini.key';
const MODEL_STORAGE = 'lekgotla.gemini.model';

export function getKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage disabled; the key simply will not persist */
  }
}

export function getModel() {
  try {
    return localStorage.getItem(MODEL_STORAGE) || '';
  } catch {
    return '';
  }
}

export function setModel(model) {
  try {
    if (model) localStorage.setItem(MODEL_STORAGE, model);
    else localStorage.removeItem(MODEL_STORAGE);
  } catch {
    /* ignore */
  }
}

/**
 * Ask Google which models this key can actually use, rather than hard-coding a
 * name that will be retired. Flash models are what the free tier covers, so
 * they sort to the top.
 */
export async function listModels(key) {
  const response = await fetch(`${BASE}/models?key=${encodeURIComponent(key)}&pageSize=200`);

  if (!response.ok) {
    if (response.status === 400 || response.status === 403) {
      throw new Error('That key was rejected. Check you copied all of it from Google AI Studio.');
    }
    throw new Error(`Could not reach the Gemini API (${response.status}).`);
  }

  const data = await response.json();

  const usable = (data.models || [])
    .filter((model) => (model.supportedGenerationMethods || []).includes('generateContent'))
    .filter((model) => !/embedding|aqa|imagen|veo|tts|image|audio/i.test(model.name))
    .map((model) => ({
      id: model.name.replace(/^models\//, ''),
      label: model.displayName || model.name,
    }));

  const score = (model) => {
    let value = 0;
    if (/flash/i.test(model.id)) value += 100;       // free tier lives here
    if (/lite/i.test(model.id)) value -= 20;         // cheaper but weaker at this
    if (/preview|exp/i.test(model.id)) value -= 40;  // less stable
    const version = parseFloat((model.id.match(/(\d+\.\d+|\d+)/) || [])[0] || '0');
    return value + version;
  };

  usable.sort((a, b) => score(b) - score(a));
  return usable;
}

/* --------------------------- the response schema -------------------------- */

const S = {
  string: (description) => ({ type: 'STRING', description }),
};

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: S.string('Short title for this challenge, taken from the document itself.'),
    languageCode: {
      type: 'STRING',
      enum: ['zu', 'nso', 'other'],
      description: 'zu for isiZulu, nso for Sepedi / Sesotho sa Leboa, other if neither.',
    },
    languageName: S.string('Human name of the target language, e.g. "isiZulu" or "Sepedi".'),
    summary: S.string('One or two sentences on what this lesson covers.'),
    vocab: {
      type: 'ARRAY',
      description: 'Every glossed word or short term in the document. Be thorough.',
      items: {
        type: 'OBJECT',
        properties: {
          target: S.string(
            'The word in the target language, spelled EXACTLY as in the document including every diacritic (š, ê, ô). Never strip a diacritic.'
          ),
          english: S.string('The English meaning.'),
          category: S.string('Optional grouping from the document, e.g. "greetings", "body".'),
          note: S.string('Optional teaching note attached to this word, e.g. "silent s", "high tone".'),
        },
        required: ['target', 'english'],
      },
    },
    phrases: {
      type: 'ARRAY',
      description: 'Multi-word expressions and sentences with their meanings.',
      items: {
        type: 'OBJECT',
        properties: {
          target: S.string('The phrase in the target language, spelled exactly as written.'),
          english: S.string('The English meaning.'),
          literal: S.string('The literal word-for-word meaning if the document gives one.'),
        },
        required: ['target', 'english'],
      },
    },
    dialogues: {
      type: 'ARRAY',
      description: 'Conversations from the document, in order.',
      items: {
        type: 'OBJECT',
        properties: {
          title: S.string('Short title for the conversation.'),
          context: S.string('Who is speaking to whom.'),
          lines: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                speaker: S.string('Who says this line.'),
                target: S.string('The line in the target language.'),
                english: S.string('The English meaning of the line.'),
              },
              required: ['target', 'english'],
            },
          },
        },
        required: ['title', 'lines'],
      },
    },
    rules: {
      type: 'ARRAY',
      description: 'Pronunciation and grammar points the document teaches.',
      items: {
        type: 'OBJECT',
        properties: {
          title: S.string('Short name for the rule.'),
          detail: S.string('The rule in learner-facing wording.'),
          examples: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['title', 'detail'],
      },
    },
    factQuestions: {
      type: 'ARRAY',
      description:
        'Four to ten multiple-choice questions about the rules above, not the vocabulary. Every answer must be stated in the document.',
      items: {
        type: 'OBJECT',
        properties: {
          question: S.string('The question.'),
          options: {
            type: 'ARRAY',
            description: 'Exactly four options, one correct, all different.',
            items: { type: 'STRING' },
          },
          answerIndex: { type: 'INTEGER', description: 'Zero-based index of the correct option.' },
          explanation: S.string('Why that answer is right.'),
        },
        required: ['question', 'options', 'answerIndex'],
      },
    },
  },
  required: ['title', 'languageCode', 'languageName', 'vocab'],
};

const SYSTEM_PROMPT = `You turn South African language worksheets into interactive learning challenges. The learner is an English speaker studying isiZulu or Sepedi (Sesotho sa Leboa / Northern Sotho).

Rules you must follow:

1. Ground everything in the document. Never add vocabulary, translations, or grammar claims that are not on the page. If a word appears with no English gloss, leave it out.
2. Reproduce the target language spelling character for character. These languages carry meaning in their diacritics: the caron in "šoma", the circumflex in "thôma", the tone marks in "kè" versus "ké". Dropping one is a spelling error, not a cosmetic difference.
3. The target word goes in "target" and the English goes in "english" — never the other way round, even when the document lists English first.
4. Strip list bullets, slide numbers, and page furniture from the values.
5. Where a document gives several acceptable answers ("Ngikhona / Ngiyaphila / Ngisaphila"), record them as separate entries rather than one entry containing slashes.
6. Fill-in-the-blank exercises often print the answer in small text nearby. Use the answer if it is visible; otherwise skip that item.
7. Aim for breadth. A vocabulary table with thirty words should produce thirty entries.`;

const arrayBufferToBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

/** Turn a read document into a raw pack. Validation happens separately. */
export async function extractPack(doc, { key, model, signal }) {
  const parts = [];

  if (doc.needsVision && doc.kind === 'pdf') {
    // No usable text layer, so let the model read the pages themselves.
    parts.push({
      inline_data: { mime_type: 'application/pdf', data: arrayBufferToBase64(doc.buffer) },
    });
    parts.push({
      text: 'This PDF has little or no text layer, so read the pages directly and build the challenge from what you see.',
    });
  } else {
    parts.push({
      text: `Read this language worksheet and build a challenge from it.${
        doc.truncated ? '\n\nNote: the document was longer than the reading limit and has been truncated. Work with what is here.' : ''
      }\n\n<document name="${doc.filename}">\n${doc.text}\n</document>`,
    });
  }

  const response = await fetch(
    `${BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 16384,
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
        },
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');

    if (response.status === 400 && /API key/i.test(detail)) {
      throw new Error('That key was rejected. Check it in Settings.');
    }
    if (response.status === 403) {
      throw new Error('That key is not allowed to use this model. Try a different model in Settings.');
    }
    if (response.status === 404) {
      throw new Error(`The model "${model}" is not available on this key. Pick another in Settings.`);
    }
    if (response.status === 429) {
      throw new Error(
        'You have hit the free tier rate limit. Wait a minute and try again, or try a smaller document.'
      );
    }
    if (response.status === 413 || /too large|exceeds/i.test(detail)) {
      throw new Error('That document is too large for one request. Split it into separate lessons.');
    }
    throw new Error(`The extraction service returned ${response.status}. Try again in a moment.`);
  }

  const data = await response.json();
  const candidate = (data.candidates || [])[0];

  if (!candidate) {
    const blocked = data.promptFeedback && data.promptFeedback.blockReason;
    throw new Error(
      blocked
        ? `The request was blocked (${blocked}). Try a different document.`
        : 'No challenge came back. Try again.'
    );
  }

  if (candidate.finishReason === 'MAX_TOKENS') {
    throw new Error(
      'The document produced more content than fits in one response. Split it into separate lessons and upload them one at a time.'
    );
  }

  const text = (candidate.content && candidate.content.parts ? candidate.content.parts : [])
    .map((part) => part.text || '')
    .join('');

  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The response could not be read as a challenge. Try again.');
  }
}
