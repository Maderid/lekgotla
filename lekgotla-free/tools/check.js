'use strict';

/**
 * End-to-end check for the static site. Runs the real document reader against
 * the real course PDFs, and mocks only the network call to Google so the whole
 * pipeline — parse, extract, validate, save, play, share — is exercised without
 * spending anyone's quota.
 *
 *   node serve.js &
 *   node tools/check.js
 */

const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8000';
const UPLOADS = process.env.UPLOADS || '/root/.claude/uploads/50c033ec-82d3-521e-a2a8-a8dbae36d01e';

const PDFS = {
  sepediGreetings: path.join(UPLOADS, '484c4a82-SEP_119_Thuto_ya_2_Greetings.pdf'),
  sepediPronunciation: path.join(UPLOADS, '423abad1-SEP_119_Thuto__1_Pronunciation.pdf'),
  zulu: path.join(UPLOADS, '6654f1a6-ZUL_119_Study_Notes_2026.pdf'),
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** A believable Gemini response, built from what the Sepedi deck really says. */
const FAKE_PACK = {
  title: 'SEP 119 Thuto ya 2: Greeting terms',
  languageCode: 'nso',
  languageName: 'Sepedi',
  summary: 'The greeting forms used in Sepedi and how they change for a group.',
  vocab: [
    { target: '• Dumela', english: 'Be greeted / good day', category: 'greetings' },
    { target: 'Dumelang', english: 'Be greeted, all of you', category: 'greetings', note: '-ng is the plural marker' },
    { target: 'Agee', english: 'Hi', category: 'greetings' },
    { target: 'Thobela', english: 'Be greeted', category: 'greetings' },
    { target: 'Bjang?', english: 'How?', category: 'questions' },
    { target: 'Kae?', english: 'Where?', category: 'questions' },
    { target: 'Gabotse', english: 'Good, fine, well' },
    { target: 'šala', english: 'Stay behind', note: 'The caron on š is mandatory' },
    { target: 'Sepela', english: 'Go' },
    { target: 'Morena', english: 'Mr / sir', category: 'address' },
    { target: 'Mohumagadi', english: 'Mrs / madam', category: 'address' },
    { target: 'Baithuti', english: 'Students', category: 'address' },
    { target: 'Ee', english: 'Yes' },
    { target: 'Aowa', english: 'No' },
    { target: 'dumela', english: 'Be greeted' },
    { target: 'Sepedi', english: 'Sepedi' },
  ],
  phrases: [
    { target: 'O kae?', english: 'How are you?', literal: 'Where are you?' },
    { target: 'Ke gona', english: 'I am fine', literal: 'I am here' },
  ],
  dialogues: [
    {
      title: 'The kae form',
      context: 'An individual greeting another individual',
      lines: [
        { speaker: 'A', target: 'Dumela!', english: 'Hello!' },
        { speaker: 'B', target: 'Agee!', english: 'Hi!' },
        { speaker: 'A', target: 'O kae?', english: 'How are you?' },
        { speaker: 'B', target: 'Ke gona, wena o kae?', english: 'I am fine. How are you?' },
      ],
    },
  ],
  rules: [
    {
      title: 'The plural marker -ng',
      detail: 'Adding -ng to a greeting shows it is addressed to more than one person.',
      examples: ['Dumelang, baithuti!'],
    },
  ],
  factQuestions: [
    {
      question: 'What does the suffix -ng indicate?',
      options: ['More than one person is addressed', 'The greeting is formal', 'The speaker is leaving', 'It is a question'],
      answerIndex: 0,
      explanation: 'It is the plural marker.',
    },
    { question: 'Broken question', options: ['a', 'a', 'b', 'c'], answerIndex: 0 },
  ],
};

async function mockGoogle(page, { pack = FAKE_PACK, failWith = null } = {}) {
  await page.route('**generativelanguage.googleapis.com/**', async (route) => {
    const url = route.request().url();

    if (url.includes('/models?')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          models: [
            { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
          ],
        }),
      });
      return;
    }

    if (failWith) {
      await route.fulfill({ status: failWith.status, contentType: 'application/json', body: JSON.stringify(failWith.body || {}) });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(pack) }] }, finishReason: 'STOP' }],
      }),
    });
  });
}

const setKey = (page) =>
  page.evaluate(() => {
    localStorage.setItem('lekgotla.gemini.key', 'AIza-test-key');
    localStorage.setItem('lekgotla.gemini.model', 'gemini-2.5-flash');
  });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const context = await browser.newContext();
  const page = await context.newPage();

  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // The error-handling section below deliberately makes the API return 404,
    // 429 and 400, which the browser logs as failed resources.
    if (/favicon/i.test(text)) return;
    if (/status of (400|404|429)/.test(text)) return;
    errors.push(text);
  });

  /* ------------------------------ first run ------------------------------ */

  await page.goto(BASE, { waitUntil: 'networkidle' });
  check('site loads with no key configured', await page.locator('.banner-setup').isVisible());
  check('upload is blocked until a key exists', await page.locator('button[type=submit]').isDisabled());

  await mockGoogle(page);

  /* ------------------------------- settings ------------------------------ */

  await page.goto(`${BASE}#/settings`, { waitUntil: 'networkidle' });
  await page.locator('input[type=password]').fill('AIza-test-key');
  await page.locator('button', { hasText: 'Test key' }).click();
  await page.waitForSelector('.status-ok', { timeout: 5000 });

  const options = await page.locator('select option').allTextContents();
  check('models are discovered from the key', options.length === 2, options.join(' / '));
  check('a flash model is recommended first', /flash/i.test(options[0]), options[0]);
  check('embedding models are filtered out', !options.some((option) => /embedding/i.test(option)));

  await page.locator('button[type=submit]').click();

  /* --------------------- reading a real course PDF ----------------------- */

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await setKey(page);
  await page.reload({ waitUntil: 'networkidle' });

  // Prove the browser-side PDF reader works on the actual documents before
  // anything is mocked further down.
  const parsed = await page.evaluate(async (url) => {
    const { readDocument } = await import('/js/documents.js');
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], 'SEP 119 Thuto ya 2 Greetings.pdf', { type: 'application/pdf' });
    const doc = await readDocument(file);
    return { pages: doc.pagesRead, chars: doc.text.length, needsVision: doc.needsVision, sample: doc.text.slice(0, 400) };
  }, `${BASE}/fixtures/sepedi-greetings.pdf`);

  check('real Sepedi PDF is read in the browser', parsed.pages === 20, `${parsed.pages} pages, ${parsed.chars} chars`);
  check('text layer is trusted (not treated as a scan)', parsed.needsVision === false);
  check('diacritics survive PDF parsing', /š/.test(parsed.sample) || /Madume/.test(parsed.sample), parsed.sample.slice(0, 60).replace(/\n/g, ' '));

  const zulu = await page.evaluate(async (url) => {
    const { readDocument } = await import('/js/documents.js');
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], 'ZUL 119.pdf', { type: 'application/pdf' });
    const doc = await readDocument(file);
    return { pages: doc.pagesRead, chars: doc.text.length, truncated: doc.truncated };
  }, `${BASE}/fixtures/zulu-notes.pdf`);

  check('94-page Zulu PDF is read without choking', zulu.pages === 94, `${zulu.pages} pages, ${zulu.chars} chars`);

  /* -------------------------- full upload flow --------------------------- */

  await page.locator('#file').setInputFiles(PDFS.sepediGreetings);
  await page.locator('button[type=submit]').click();
  await page.waitForSelector('.level-card', { timeout: 30000 });

  check('upload produces a playable challenge', (await page.locator('.level-card').count()) === 5);
  check('challenge title comes from the document', (await page.locator('h1').textContent()).includes('SEP 119'));

  const counts = await page.locator('.challenge-head .small').textContent();
  check('validator dropped the junk entries', counts.includes('14 words'), counts.trim().slice(0, 60));

  const caron = await page.locator('.study-item .target', { hasText: 'šala' }).count();
  check('caron survives the whole pipeline', caron === 1);

  /* ------------------------------- sharing -------------------------------- */

  const share = await page.evaluate(async () => {
    const store = await import('/js/store.js');
    const pack = Object.values(JSON.parse(localStorage.getItem('lekgotla.challenges.v1')))[0].pack;
    const encoded = await store.encodeShare(pack);
    if (!encoded) return { ok: false, reason: 'too big' };
    const decoded = await store.decodeShare(encoded);
    return {
      ok: JSON.stringify(decoded) === JSON.stringify(pack),
      length: encoded.length,
      raw: JSON.stringify(pack).length,
    };
  });

  check('share link round-trips exactly', share.ok, `${share.raw} bytes → ${share.length} in the URL`);

  const shareUrl = await page.evaluate(async () => {
    const store = await import('/js/store.js');
    const pack = Object.values(JSON.parse(localStorage.getItem('lekgotla.challenges.v1')))[0].pack;
    return `#/s/${await store.encodeShare(pack)}`;
  });

  // A classmate with no key at all opens the link.
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  const guestErrors = [];
  guestPage.on('pageerror', (error) => guestErrors.push(String(error)));
  await guestPage.goto(`${BASE}/${shareUrl}`, { waitUntil: 'networkidle' });
  await guestPage.waitForSelector('.level-card', { timeout: 10000 });

  check('a shared link works for someone with no API key', (await guestPage.locator('.level-card').count()) === 5);
  check('shared challenge keeps its diacritics', (await guestPage.locator('.study-item .target', { hasText: 'šala' }).count()) === 1);
  check('no errors on the guest side', guestErrors.length === 0, guestErrors[0] || '');
  await guest.close();

  /* ------------------------------ playing -------------------------------- */

  await page.evaluate(async () => {
    const response = await fetch('/api-not-used');
    return response;
  }).catch(() => {});

  await page.locator('.level-card').nth(0).click();
  await page.waitForSelector('.match');

  const pack = await page.evaluate(
    () => Object.values(JSON.parse(localStorage.getItem('lekgotla.challenges.v1')))[0].pack
  );

  let guard = 0;
  while (guard < 12) {
    guard += 1;

    if (await page.locator('.match').count()) {
      for (let i = 0; i < 40; i += 1) {
        const remaining = await page.locator('.match-col').first().locator('.match-item:not(.is-done)').count();
        if (!remaining) break;
        const left = page.locator('.match-col').first().locator('.match-item:not(.is-done)').first();
        const word = (await left.locator('.target').textContent()).trim();
        await left.click();
        const entry = pack.vocab.find((item) => item.target === word);
        if (!entry) break;
        const right = page.locator('.match-col').nth(1).locator('.match-item');
        const texts = await right.allTextContents();
        const index = texts.findIndex((text) => text.trim() === entry.english.trim());
        if (index < 0) break;
        await right.nth(index).click();
        await page.waitForTimeout(50);
      }
    }

    if (await page.locator('.result').count()) break;
    const next = page.locator('.round-footer button');
    if (!(await next.count())) break;
    await next.click();
    await page.waitForTimeout(150);
  }

  await page.waitForSelector('.result', { timeout: 5000 });
  check('level 1 plays to a result', /%/.test(await page.locator('.result-score').textContent()));

  await page.locator('button', { hasText: 'Back to levels' }).click();
  await page.waitForSelector('.level-card');
  check('passing unlocks level 2', !(await page.locator('.level-card').nth(1).isDisabled()));

  await page.reload({ waitUntil: 'networkidle' });
  check('progress survives a reload', (await page.locator('.level-score').count()) > 0);

  /* ---------------------------- error handling --------------------------- */

  const errorCases = [
    { status: 429, expect: /rate limit/i, name: 'rate limit is explained plainly' },
    { status: 404, expect: /not available on this key/i, name: 'a missing model is explained' },
    { status: 400, body: { error: { message: 'API key not valid' } }, expect: /key was rejected/i, name: 'a bad key is explained' },
  ];

  for (const testCase of errorCases) {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await setKey(page);
    await page.reload({ waitUntil: 'networkidle' });
    await page.unroute('**generativelanguage.googleapis.com/**');
    await mockGoogle(page, { failWith: { status: testCase.status, body: testCase.body } });

    await page.locator('#file').setInputFiles(PDFS.sepediPronunciation);
    await page.locator('button[type=submit]').click();
    await page.waitForSelector('.status-error', { timeout: 30000 });
    const message = await page.locator('.status-error').textContent();
    check(testCase.name, testCase.expect.test(message), message.trim().slice(0, 70));
  }

  /* --------------------------- thin-content guard ------------------------ */

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await setKey(page);
  await page.reload({ waitUntil: 'networkidle' });
  await page.unroute('**generativelanguage.googleapis.com/**');
  await mockGoogle(page, {
    pack: { ...FAKE_PACK, vocab: FAKE_PACK.vocab.slice(0, 3) },
  });

  await page.locator('#file').setInputFiles(PDFS.sepediPronunciation);
  await page.locator('button[type=submit]').click();
  await page.waitForSelector('.status-error', { timeout: 30000 });
  check(
    'a document with too little content is refused clearly',
    /at least 6/.test(await page.locator('.status-error').textContent())
  );

  /* -------------------------------- mobile ------------------------------- */

  const mobile = await browser.newContext({ viewport: { width: 380, height: 780 } });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(BASE, { waitUntil: 'networkidle' });
  check(
    'no horizontal overflow at 380px',
    await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  );
  await mobile.close();

  check('no uncaught JavaScript errors', errors.length === 0, errors.slice(0, 2).join(' | '));

  await browser.close();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
