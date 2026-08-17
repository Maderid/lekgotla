'use strict';

/**
 * Generates the test PDFs.
 *
 * The suite needs realistic documents — multi-page, with a text layer, tables,
 * and the diacritics that carry meaning in these languages. It must NOT need
 * real lecture notes: those are copyrighted, and committing them to a public
 * repository publishes someone else's material.
 *
 * So the fixtures are written here from scratch. The vocabulary is ordinary
 * dictionary material, laid out the way a lecture deck lays it out, which is
 * what the parser actually has to cope with.
 *
 *   node tools/make-fixtures.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'fixtures');

const SEPEDI = [
  ['Dumela', 'be greeted, good day'],
  ['Dumelang', 'be greeted, all of you'],
  ['Agee', 'hi'],
  ['Thobela', 'be greeted'],
  ['šala gabotse', 'keep well'],
  ['Sepela gabotse', 'go well'],
  ['Gabotse', 'good, fine, well'],
  ['O kae?', 'how are you?'],
  ['Ke gona', 'I am fine'],
  ['Le kae?', 'how are you, all of you?'],
  ['Re gona', 'we are fine'],
  ['Morena', 'sir'],
  ['Mohumagadi', 'madam'],
  ['Morutiši', 'a male teacher'],
  ['Baithuti', 'students'],
  ['Ngwanaka', 'my child'],
  ['Bana', 'children'],
  ['Mogwera', 'a friend'],
  ['Ee', 'yes'],
  ['Aowa', 'no'],
  ['Ke a leboga', 'thank you'],
  ['šoma', 'to work'],
  ['thôma', 'to start'],
  ['êma', 'to wait'],
  ['pula', 'rain'],
  ['noka', 'a river'],
  ['molala', 'a neck'],
  ['leihlo', 'an eye'],
  ['tsebe', 'an ear'],
  ['hlogo', 'a head'],
];

const ZULU = [
  ['Sawubona', 'hello'],
  ['Sanibonani', 'hello, all of you'],
  ['Unjani?', 'how are you?'],
  ['Ngiyaphila', 'I am well'],
  ['Ngikhona', 'I am here'],
  ['Hamba kahle', 'go well'],
  ['Sala kahle', 'stay well'],
  ['Ngiyabonga', 'thank you'],
  ['Yebo', 'yes'],
  ['Cha', 'no'],
  ['idada', 'a duck'],
  ['ubaba', 'father'],
  ['umama', 'mother'],
  ['ugogo', 'grandmother'],
  ['ikhanda', 'a head'],
  ['isisu', 'a stomach'],
  ['inyoni', 'a bird'],
  ['ingane', 'a child'],
  ['umuzi', 'a homestead'],
  ['itiye', 'tea'],
  ['bhala', 'to write'],
  ['funda', 'to read, to learn'],
  ['hamba', 'to go'],
  ['hlala', 'to sit, to reside'],
  ['dlala', 'to play'],
  ['cula', 'to sing'],
  ['qala', 'to begin'],
  ['xoxa', 'to chat'],
  ['thatha', 'to take'],
  ['pheka', 'to cook'],
];

/** One slide-like page. Tables and two columns are what the parser must survive. */
function page(index, total, title, rows, note) {
  const cells = rows
    .map(
      ([target, english]) =>
        `<tr><td class="t">${target}</td><td class="e">${english}</td></tr>`
    )
    .join('');

  return `
    <section>
      <h2>${title}</h2>
      <table>${cells}</table>
      ${note ? `<p class="note">${note}</p>` : ''}
      <footer>Generated fixture — page ${index} of ${total}</footer>
    </section>`;
}

function document({ heading, subtitle, words, pages }) {
  const perPage = 6;
  const body = [];

  body.push(`
    <section class="cover">
      <h1>${heading}</h1>
      <p>${subtitle}</p>
      <p class="note">This is a generated test document. It contains no course material.</p>
    </section>`);

  for (let i = 2; i <= pages; i += 1) {
    const start = ((i - 2) * perPage) % words.length;
    const rows = [];
    for (let j = 0; j < perPage; j += 1) rows.push(words[(start + j) % words.length]);
    body.push(
      page(
        i,
        pages,
        i % 3 === 0 ? `Tlotlontšu / Vocabulary ${i}` : `Practise these ${i}`,
        rows,
        i % 4 === 0 ? 'Note: the diacritics are part of the spelling, not decoration.' : ''
      )
    );
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, 'Times New Roman', serif; }
  section {
    width: 297mm; height: 209mm; padding: 18mm 20mm;
    page-break-after: always; display: flex; flex-direction: column;
  }
  h1 { font-size: 34pt; margin: 0 0 8mm; }
  h2 { font-size: 22pt; margin: 0 0 6mm; color: #b8452a; }
  p { font-size: 13pt; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 2.4mm 3mm; border-bottom: 1px solid #ddd; font-size: 14pt; }
  td.t { font-weight: bold; width: 42%; }
  td.e { color: #333; }
  .note { font-size: 11pt; color: #9a6212; margin-top: 5mm; }
  footer { margin-top: auto; font-size: 9pt; color: #888; }
  .cover { justify-content: center; text-align: center; }
</style></head><body>${body.join('')}</body></html>`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const page_ = await browser.newPage();

  const targets = [
    {
      file: 'sepedi-greetings.pdf',
      pages: 20,
      html: document({
        heading: 'Sepedi practice set',
        subtitle: 'Greetings and everyday words — Madume le mantšu',
        words: SEPEDI,
        pages: 20,
      }),
    },
    {
      file: 'sepedi-pronunciation.pdf',
      pages: 15,
      html: document({
        heading: 'Sepedi pronunciation practice set',
        subtitle: 'Ditumanoši le ditumammogo',
        words: SEPEDI.slice().reverse(),
        pages: 15,
      }),
    },
    {
      file: 'zulu-notes.pdf',
      pages: 94,
      html: document({
        heading: 'isiZulu practice set',
        subtitle: 'Greetings, nouns and verbs',
        words: ZULU,
        pages: 94,
      }),
    },
  ];

  for (const target of targets) {
    await page_.setContent(target.html, { waitUntil: 'load' });
    const file = path.join(OUT, target.file);
    await page_.pdf({ path: file, printBackground: true, preferCSSPageSize: true });
    const { size } = fs.statSync(file);
    console.log(`${target.file} — ${target.pages} pages, ${Math.round(size / 1024)} KB`);
  }

  await browser.close();
})();
