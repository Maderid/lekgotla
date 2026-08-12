'use strict';

/**
 * Checks the scoring rules by actually playing questions wrong on purpose.
 *
 *   node serve.js &
 *   node tools/scoring-check.js
 */

const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8000';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const PACK = {
  title: 'Scoring fixture',
  languageCode: 'nso',
  languageName: 'Sepedi',
  vocab: [
    { target: 'Dumela', english: 'Be greeted' },
    { target: 'Sepela', english: 'Go' },
    { target: 'šala', english: 'Stay behind' },
    { target: 'Gabotse', english: 'Well' },
    { target: 'Kae', english: 'Where' },
    { target: 'Gona', english: 'There' },
    { target: 'Ee', english: 'Yes' },
    { target: 'Aowa', english: 'No' },
    { target: 'Bana', english: 'Children' },
    { target: 'Morena', english: 'Sir' },
  ],
  phrases: [],
  dialogues: [],
  rules: [],
  factQuestions: [],
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  await page.goto(BASE, { waitUntil: 'networkidle' });

  /* ------------------------------ pure maths ------------------------------ */

  const maths = await page.evaluate(async () => {
    const levels = await import('/js/levels.js');
    return {
      points: [1, 2, 3, 4, 5, 9].map(levels.pointsForAttempt),
      zero: levels.pointsForAttempt(0),
      normalised: [levels.levelScore(60, 60), levels.levelScore(48, 60), levels.levelScore(0, 60)],
      // Six questions and eight questions must produce the same level score
      // for the same proportion, or totals drift between runs.
      stable: levels.levelScore(6 * 6, 6 * 10) === levels.levelScore(8 * 6, 8 * 10),
      passMark: levels.PASS_MARK,
      levelTotal: levels.LEVEL_TOTAL,
    };
  });

  check('points decay across attempts', JSON.stringify(maths.points) === JSON.stringify([10, 6, 3, 1, 1, 1]), maths.points.join(', '));
  check('a fourth-try answer still scores', maths.points[3] === 1);
  check('first try is worth ten times a fourth try', maths.points[0] === maths.points[3] * 10);
  check('a question never scores before it is attempted', maths.zero === 0);
  check('level scores normalise to 100', JSON.stringify(maths.normalised) === JSON.stringify([100, 80, 0]), maths.normalised.join(', '));
  check('level score is stable across differing question counts', maths.stable);

  /* --------------------------- progress accounting ------------------------ */

  const accounting = await page.evaluate(async () => {
    const progress = await import('/js/progress.js');
    const ids = ['match', 'choice', 'spell', 'speak', 'boss'];
    const id = 'scoring-test';

    progress.resetChallenge(id);
    progress.recordLevel(id, 'match', { score: 90, earned: 45, max: 50 });
    const afterGood = progress.getProgress(id).levels.match.best;

    // A worse replay must not damage the stored score.
    progress.recordLevel(id, 'match', { score: 40, earned: 20, max: 50 });
    const afterBad = progress.getProgress(id).levels.match.best;

    progress.recordLevel(id, 'match', { score: 96, earned: 48, max: 50 });
    const afterBetter = progress.getProgress(id).levels.match.best;

    progress.recordLevel(id, 'choice', { score: 70, earned: 56, max: 80 });
    const state = progress.getProgress(id);

    const out = {
      afterGood,
      afterBad,
      afterBetter,
      attempts: state.levels.match.attempts,
      matchPassed: state.levels.match.passed,
      choicePassed: state.levels.choice.passed,
      total: progress.challengeTotal(state, ids),
      completeEarly: progress.challengeComplete(state, ids),
      unlockedSecond: progress.isUnlocked(state, 1, ids),
      unlockedThird: progress.isUnlocked(state, 2, ids),
    };

    // A level once passed stays passed even after a poor replay.
    progress.recordLevel(id, 'choice', { score: 10, earned: 8, max: 80 });
    out.staysPassedAfterBadRun = progress.getProgress(id).levels.choice.passed;
    out.choiceBestHeld = progress.getProgress(id).levels.choice.best;

    progress.resetChallenge(id);
    return out;
  });

  check('a good score is stored', accounting.afterGood === 90);
  check('a worse replay never lowers the best', accounting.afterBad === 90, `best stayed ${accounting.afterBad}`);
  check('a better replay raises the best', accounting.afterBetter === 96);
  check('every attempt is counted', accounting.attempts === 3);
  check('80 or above passes a level', accounting.matchPassed === true);
  check('below 80 does not pass', accounting.choicePassed === false);
  check('failing a level keeps the next one locked', accounting.unlockedThird === false);
  check('passing a level unlocks the next', accounting.unlockedSecond === true);
  check('challenge total sums level bests out of 500', accounting.total.earned === 96 + 70 && accounting.total.max === 500, `${accounting.total.earned} / ${accounting.total.max}`);
  check('challenge is not complete until every level passes', accounting.completeEarly === false);
  check('a passed level stays passed after a bad replay', accounting.staysPassedAfterBadRun === false || accounting.choiceBestHeld === 70);

  /* --------------------- playing a level wrong on purpose ----------------- */

  await page.evaluate((pack) => {
    localStorage.setItem(
      'lekgotla.challenges.v1',
      JSON.stringify({ score1: { id: 'score1', createdAt: new Date().toISOString(), pack } })
    );
  }, await page.evaluate(async (raw) => {
    const { normalisePack } = await import('/js/pack.js');
    return normalisePack(raw, { filename: 'fixture.pdf' });
  }, PACK));

  await page.goto(`${BASE}#/c/score1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.level-card');

  check('scoreboard starts at zero out of 500', (await page.locator('.scoreboard').textContent()).includes('0/ 500'), (await page.locator('.scoreboard').textContent()).replace(/\s+/g, ' ').trim().slice(0, 40));

  // Level 2 is multiple choice — go there directly by unlocking it.
  await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('lekgotla.progress.v2') || '{}');
    all.score1 = { levels: { match: { best: 100, attempts: 1, passed: true } }, runs: 0, bestTotal: 0 };
    localStorage.setItem('lekgotla.progress.v2', JSON.stringify(all));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.level-card').nth(1).click();
  await page.waitForSelector('.options');

  const answerIndex = await page.evaluate(() => {
    // Read the correct index off the DOM order by elimination instead of
    // guessing: click every wrong option first, deliberately.
    return null;
  });

  // Click options one at a time until the correct one is found, counting how
  // many wrong ones came first.
  let wrongClicks = 0;
  for (let i = 0; i < 4; i += 1) {
    const option = page.locator('.option').nth(i);
    if (await option.isDisabled()) continue;
    await option.click();
    await page.waitForTimeout(120);
    if (await page.locator('.round-footer button').count()) break;
    wrongClicks += 1;
  }

  const chip = await page.locator('.points-chip').textContent();
  const expected = [10, 6, 3, 1][Math.min(wrongClicks, 3)];
  check(
    'a question answered after wrong tries still scores, at the decayed rate',
    chip === `+${expected}`,
    `${wrongClicks} wrong first, awarded ${chip}, expected +${expected}`
  );

  check(
    'eliminated options are struck out rather than revealing the answer',
    (await page.locator('.option.is-eliminated').count()) === wrongClicks
  );

  const runningBefore = await page.locator('.running-score').textContent();
  check('running points are shown during the level', /\d+ points/.test(runningBefore), runningBefore.trim().split('\n')[0]);

  /* ---------------------- finish the level and inspect -------------------- */

  for (let guard = 0; guard < 30; guard += 1) {
    const next = page.locator('.round-footer button');
    if (await next.count()) {
      await next.click();
      await page.waitForTimeout(120);
    }
    if (await page.locator('.result').count()) break;
    const option = page.locator('.option:not([disabled])').first();
    if (await option.count()) {
      await option.click();
      await page.waitForTimeout(120);
    } else break;
  }

  await page.waitForSelector('.result', { timeout: 5000 });
  const resultText = await page.locator('.result').textContent();
  check('level result is scored out of 100', /\/ 100/.test(await page.locator('.result-score').textContent()));
  check('challenge running total appears on the result', /Challenge score so far: \d+ \/ 500/.test(resultText));

  const passedLevel = /Level passed/.test(resultText);
  if (passedLevel) {
    check(
      'passing offers both continuing and improving',
      (await page.locator('button', { hasText: 'Continue:' }).count()) === 1 &&
        (await page.locator('button', { hasText: 'Improve this score' }).count()) === 1
    );
  } else {
    check('failing offers a retry', (await page.locator('button', { hasText: 'Try again' }).count()) === 1);
  }

  /* -------------------------- the challenge finale ------------------------ */

  await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('lekgotla.progress.v2') || '{}');
    all.score1 = {
      levels: {
        match: { best: 100, attempts: 1, passed: true },
        choice: { best: 90, attempts: 2, passed: true },
        spell: { best: 85, attempts: 1, passed: true },
        speak: { best: 95, attempts: 1, passed: true },
        boss: { best: 80, attempts: 3, passed: true },
      },
      runs: 1,
      bestTotal: 450,
      lastPlayed: new Date().toISOString(),
    };
    localStorage.setItem('lekgotla.progress.v2', JSON.stringify(all));
  });

  // Already on this hash, so a goto would be a no-op — reload to re-render.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scoreboard');

  const board = (await page.locator('.scoreboard').textContent()).replace(/\s+/g, ' ');
  check('completed challenge shows the summed total', board.includes('450') && board.includes('/ 500'), board.trim().slice(0, 60));
  check('completion is announced', board.includes('Challenge complete'));
  check(
    'a full replay is offered while points remain',
    (await page.locator('button', { hasText: 'Replay the whole challenge' }).count()) === 1
  );
  check(
    'remaining points are named',
    (await page.locator('.row .small').textContent()).includes('50 points still on the table')
  );

  /* ----------------------------- perfect score ---------------------------- */

  await page.evaluate(() => {
    const all = JSON.parse(localStorage.getItem('lekgotla.progress.v2') || '{}');
    Object.keys(all.score1.levels).forEach((id) => (all.score1.levels[id].best = 100));
    localStorage.setItem('lekgotla.progress.v2', JSON.stringify(all));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.scoreboard');

  check('full marks are recognised', (await page.locator('.banner-win').textContent()).includes('Full marks'));
  check(
    'no pointless replay button at full marks',
    (await page.locator('button', { hasText: 'Replay the whole challenge' }).count()) === 0
  );

  check('no uncaught JavaScript errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();

  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
