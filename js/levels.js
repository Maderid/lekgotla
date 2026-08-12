/**
 * Level construction. Every question here is built from the uploaded document
 * and nothing else — if the worksheet did not teach it, it cannot be asked.
 */

import { similarity, loosen } from './speech.js';

export const PASS_MARK = 80;

/**
 * What a question is worth, by how many tries it took.
 *
 * Getting there on the fourth attempt is still worth something — a learner who
 * works a word out is learning it, just less securely than one who knew it. The
 * gap between 10 and 1 is wide enough that guessing is never as good as knowing,
 * and wide enough that improving a score means actually improving.
 */
export const ATTEMPT_POINTS = [10, 6, 3, 1];

/** Full marks for one question, used as the denominator everywhere. */
export const QUESTION_VALUE = ATTEMPT_POINTS[0];

/** Points for a correct answer on the given 1-based attempt. */
export function pointsForAttempt(attempt) {
  if (attempt < 1) return 0;
  return ATTEMPT_POINTS[Math.min(attempt, ATTEMPT_POINTS.length) - 1];
}

/**
 * How many tries a typed or spoken question allows before the answer is shown.
 * Multiple choice is bounded by its own options instead.
 */
export const MAX_OPEN_ATTEMPTS = ATTEMPT_POINTS.length;

/** Every level is marked out of this, whatever number of questions it built. */
export const LEVEL_TOTAL = 100;

/**
 * A level's score, normalised so a level that happened to generate six
 * questions is worth exactly as much as one that generated eight. Without this,
 * challenge totals would drift between runs.
 */
export function levelScore(earned, max) {
  if (!max) return 0;
  return Math.round((earned / max) * LEVEL_TOTAL);
}

const shuffle = (items) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const sample = (items, count) => shuffle(items).slice(0, count);

/**
 * Wrong answers drawn from the same worksheet, preferring the same category —
 * confusing "leihlo" with "tsebe" is a real mistake worth making, confusing it
 * with a random word from another lesson is not.
 */
function distractorsFor(item, pool, field, count = 3) {
  const correct = loosen(item[field]);
  const eligible = pool.filter((other) => loosen(other[field]) !== correct);

  const sameCategory = eligible.filter(
    (other) => item.category && other.category === item.category
  );

  const picked = [];
  const seen = new Set([correct]);

  for (const candidate of [...shuffle(sameCategory), ...shuffle(eligible)]) {
    const key = loosen(candidate[field]);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(candidate[field]);
    if (picked.length === count) break;
  }

  return picked;
}

function optionsFrom(correct, distractors) {
  const options = shuffle([correct, ...distractors]);
  return { options, answerIndex: options.indexOf(correct) };
}

/* ----------------------------- round builders ---------------------------- */

function buildMatchRounds(vocab) {
  const groupSize = Math.min(5, Math.max(3, Math.floor(vocab.length / 2)));
  const pool = shuffle(vocab);
  const rounds = [];

  // Two words glossed "Be greeted / good day" and "Be greeted, all of you" are
  // a fair thing to teach and an unfair thing to ask someone to match, because
  // both columns read the same. Keep near-identical glosses in separate rounds.
  const tooAlike = (item, group) =>
    group.some(
      (other) =>
        similarity(item.english, other.english) > 0.6 ||
        similarity(item.target, other.target) > 0.7
    );

  while (pool.length && rounds.length < 3) {
    const group = [];

    for (let i = 0; i < pool.length && group.length < groupSize; ) {
      if (tooAlike(pool[i], group)) {
        i += 1;
        continue;
      }
      group.push(pool.splice(i, 1)[0]);
    }

    // A final group of one or two pairs is trivially solvable, so stop rather
    // than serve it.
    if (group.length < 3) break;

    rounds.push({
      type: 'match',
      pairs: group,
      left: shuffle(group),
      right: shuffle(group),
      value: group.length * QUESTION_VALUE,
    });
  }

  // A word list where everything means roughly the same thing cannot make a
  // clean matching round; fall back to one round rather than none.
  if (!rounds.length) {
    const group = sample(vocab, Math.min(groupSize, vocab.length));
    rounds.push({
      type: 'match',
      pairs: group,
      left: shuffle(group),
      right: shuffle(group),
      value: group.length * QUESTION_VALUE,
    });
  }

  return rounds;
}

function buildChoiceRounds(vocab, count) {
  return sample(vocab, count).map((item, index) => {
    // Alternate direction so the learner has to produce the target language
    // too, not only recognise it.
    const toEnglish = index % 2 === 0;
    const field = toEnglish ? 'english' : 'target';
    const correct = item[field];
    const { options, answerIndex } = optionsFrom(correct, distractorsFor(item, vocab, field));

    return {
      type: 'choice',
      item,
      direction: toEnglish ? 'target-to-english' : 'english-to-target',
      prompt: toEnglish ? item.target : item.english,
      speakPrompt: toEnglish ? item.target : null,
      speakOptions: !toEnglish,
      question: toEnglish ? 'What does this mean?' : 'Which word is this?',
      options,
      answerIndex,
      value: QUESTION_VALUE,
    };
  });
}

function buildSpellRounds(vocab, count) {
  // Very long entries are phrases in disguise; typing them tests patience, not
  // spelling.
  const spellable = vocab.filter((item) => item.target.length <= 22);
  return sample(spellable.length >= 4 ? spellable : vocab, count).map((item) => ({
    type: 'spell',
    item,
    hint: item.english,
    answer: item.target,
    value: QUESTION_VALUE,
  }));
}

function buildSpeakRounds(vocab, count) {
  return sample(vocab, count).map((item) => ({
    type: 'speak',
    item,
    answer: item.target,
    value: QUESTION_VALUE,
  }));
}

function buildClozeRounds(dialogues, vocab, count) {
  const candidates = [];

  for (const dialogue of dialogues) {
    for (const line of dialogue.lines) {
      const words = line.target.split(/\s+/).filter((word) => word.replace(/[^\p{L}]/gu, '').length > 2);
      if (words.length < 2) continue;

      const target = words[Math.floor(Math.random() * words.length)];
      const bare = target.replace(/[^\p{L}]/gu, '');
      if (!bare) continue;

      candidates.push({
        type: 'cloze',
        dialogue: dialogue.title,
        context: dialogue.context,
        speaker: line.speaker,
        english: line.english,
        sentence: line.target.replace(target, '␣'.repeat(Math.min(8, bare.length))),
        full: line.target,
        answer: bare,
        value: QUESTION_VALUE,
      });
    }
  }

  return sample(candidates, count).map((round) => {
    const pool = vocab
      .map((item) => item.target.split(/\s+/)[0].replace(/[^\p{L}]/gu, ''))
      .filter((word) => word && loosen(word) !== loosen(round.answer));

    const { options, answerIndex } = optionsFrom(round.answer, sample([...new Set(pool)], 3));
    return { ...round, options, answerIndex };
  });
}

function buildFactRounds(factQuestions, count) {
  return sample(factQuestions, count).map((item) => ({
    type: 'fact',
    question: item.question,
    options: item.options,
    answerIndex: item.answerIndex,
    explanation: item.explanation,
    value: QUESTION_VALUE,
  }));
}

/* -------------------------------- levels -------------------------------- */

/**
 * Level names in the language being learned, so the interface itself teaches a
 * few words. Each set is the target language's own verb, not a translation of
 * an English label.
 */
const LEVEL_NAMES = {
  nso: {
    match: 'Theetša',   // listen
    choice: 'Kgetha',   // choose
    spell: 'Ngwala',    // write
    speak: 'Bolela',    // speak
    boss: 'Teko',       // test
  },
  zu: {
    match: 'Lalela',       // listen
    choice: 'Khetha',      // choose
    spell: 'Bhala',        // write
    speak: 'Khuluma',      // speak
    boss: 'Isivivinyo',    // test
  },
};

export function buildLevels(pack) {
  const { vocab, dialogues, factQuestions } = pack;
  const questionCount = Math.min(8, Math.max(5, vocab.length));

  const names = LEVEL_NAMES[pack.language.code] || {};
  const label = (id, english) => (names[id] ? `${names[id]} — ${english}` : english);

  return [
    {
      id: 'match',
      number: 1,
      name: label('match', 'Listen and match'),
      short: 'Listen & match',
      blurb: 'Hear each word, then pair it with its meaning. Nothing to type yet.',
      icon: '🔊',
      build: () => buildMatchRounds(vocab),
    },
    {
      id: 'choice',
      number: 2,
      name: label('choice', 'Choose the meaning'),
      short: 'Multiple choice',
      blurb: 'Both directions: meaning from the word, and the word from its meaning.',
      icon: '🎯',
      build: () => buildChoiceRounds(vocab, questionCount),
    },
    {
      id: 'spell',
      number: 3,
      name: label('spell', 'Spell what you hear'),
      short: 'Spell it',
      blurb: 'Type the word from its sound. Diacritics count.',
      icon: '⌨️',
      build: () => buildSpellRounds(vocab, questionCount),
    },
    {
      id: 'speak',
      number: 4,
      name: label('speak', 'Say it out loud'),
      short: 'Speak it',
      blurb: 'Say each word yourself and compare it against the model.',
      icon: '🎙️',
      build: () => buildSpeakRounds(vocab, Math.min(6, vocab.length)),
    },
    {
      id: 'boss',
      number: 5,
      name: label('boss', 'The gauntlet'),
      short: 'Gauntlet',
      blurb: 'Everything at once, plus the lesson’s grammar and pronunciation rules.',
      icon: '👑',
      build: () => {
        const rounds = [
          ...buildChoiceRounds(vocab, 3),
          ...buildSpellRounds(vocab, 2),
          ...buildClozeRounds(dialogues, vocab, 3),
          ...buildFactRounds(factQuestions, 3),
        ];
        // A pack with no dialogues or rules still needs a full-length finale.
        if (rounds.length < 8) rounds.push(...buildChoiceRounds(vocab, 8 - rounds.length));
        return shuffle(rounds);
      },
    },
  ];
}

/* ------------------------------- grading -------------------------------- */

/**
 * Grade a typed spelling. Diacritics are treated as part of the word, not
 * decoration — the Sepedi notes are explicit that dropping the caron on š is a
 * spelling error — but a learner who got everything else right deserves to be
 * told exactly that rather than a flat "wrong".
 */
export function gradeSpelling(input, answer, language) {
  const typed = String(input || '').trim();
  if (!typed) return { correct: false, kind: 'empty', message: 'Nothing typed yet.' };

  if (typed === answer) return { correct: true, kind: 'exact', message: 'Exactly right.' };

  if (typed.toLowerCase() === answer.toLowerCase()) {
    return { correct: true, kind: 'case', message: `Correct — the usual capitalisation is “${answer}”.` };
  }

  if (loosen(typed) === loosen(answer)) {
    const marks = (language.specialChars || []).filter((char) => answer.includes(char));
    const missing = marks.length ? marks.join(', ') : 'a diacritic';
    return {
      correct: false,
      kind: 'diacritic',
      message: `So close — every letter is right, but “${answer}” carries ${missing}. In ${language.name} that mark is part of the spelling, not decoration.`,
    };
  }

  const score = similarity(typed, answer);
  return {
    correct: false,
    kind: score > 0.6 ? 'near' : 'wrong',
    message: score > 0.6 ? `Not quite — the word is “${answer}”.` : `The word is “${answer}”.`,
  };
}

/**
 * Grade a spoken attempt against every alternative the recogniser offered.
 * Recognisers for these languages are weak on isolated words, so the threshold
 * is forgiving and the caller must always offer a manual override.
 */
export function gradeSpoken(alternatives, answer) {
  let best = { transcript: '', score: 0 };

  for (const alternative of alternatives || []) {
    const score = similarity(alternative.transcript, answer);
    if (score > best.score) best = { transcript: alternative.transcript, score };
  }

  return {
    ...best,
    correct: best.score >= 0.7,
    close: best.score >= 0.45 && best.score < 0.7,
  };
}
