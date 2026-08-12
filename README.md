# Lekgotla

Upload an isiZulu or Sepedi worksheet; get back a five-level challenge built
from that document and nothing else. Nothing is preloaded — a challenge only
exists once someone has uploaded the page it came from.

**There is no server and no bill.** The document is read in your browser, and
the extraction runs on the visitor's own free Google AI Studio key. Hosting is
free static hosting. Nothing here costs you anything to keep running, ever.

Built for UP's ZUL 119 and SEP 119 material, but it reads any glossed word
list, dialogue, or set of lecture slides.

---

## Looking at it locally

Browsers refuse to load ES modules from a `file://` URL, so double-clicking
`index.html` will not work. Use the included dev server:

```bash
node serve.js      # then open http://localhost:8000
```

Any static server does the same job (`python3 -m http.server 8000`, `npx serve`).

Then open Settings and paste a key — see below.

---

## Putting it online for free

The whole site is static files. It works on any static host, at a subdirectory
or a root domain, with no build step and no configuration.

**GitHub Pages**, start to finish:

1. Create a repository and upload every file in this folder to it (drag and
   drop into the web interface is fine — there is nothing to compile).
2. In the repository, go to **Settings → Pages**.
3. Under "Build and deployment", set Source to **Deploy from a branch**, pick
   `main` and `/ (root)`, and Save.
4. Wait a minute. Your site is at `https://<your-username>.github.io/<repo>/`.

Cloudflare Pages, Netlify and Vercel all work the same way — point them at the
folder, no build command, no output directory.

Nothing needs a key at deploy time. Each visitor adds their own in Settings.

---

## The API key

The site cannot read a document without one, because reading a worksheet
properly means understanding it.

Getting one is free and takes a minute: open
[aistudio.google.com/apikey](https://aistudio.google.com/apikey), sign in, click
**Create API key**. No card is required for the free tier. Paste it into
Settings; the app then asks Google which models that key can use and picks a
Flash model, so it will not break when model names change.

Two things the Settings screen also tells your visitors, and which you should
know:

- **The key stays in that person's browser.** It is kept in local storage and
  sent only to Google. "Forget my key" erases it. Since each visitor uses their
  own key, your quota is never spent by anyone else.
- **Google's free tier uses submitted content to improve their products.** Your
  ZUL 119 notes carry "COPYRIGHT STRICTLY RESERVED — THIS MATERIAL MAY NOT BE
  REPRODUCED IN ANY WAY". Uploading them for your own study is one thing;
  putting extracted content on a public site with share links is another. I am
  not a lawyer and this is not legal advice, but it is worth a thought before
  you publicise the URL, and worth asking your lecturer about — they may be glad
  to have it, which would settle the question.

---

## How a document becomes a challenge

1. **Read.** PDFs go through `pdf.js` in the browser, rebuilding lines from
   positioned text fragments so tables and bullet lists survive. `.docx` goes
   through `mammoth`. If a PDF's text layer is thin — a scan — the file itself
   is sent to be read visually instead.
2. **Extract.** One schema-constrained call returns vocabulary, phrases,
   dialogues, rules, and multiple-choice questions about those rules. The prompt
   insists on grounding: no vocabulary that is not glossed on the page, and
   diacritics reproduced character for character.
3. **Validate.** `js/pack.js` is the gate. It strips slide bullets and trailing
   punctuation, drops entries whose "translation" is the word itself, removes
   duplicates, discards questions with duplicate options or an out-of-range
   answer, and refuses any document yielding fewer than six usable words.
   Nothing reaches a learner unchecked.
4. **Store.** The challenge is saved in that browser's local storage.

### Sharing, without a server to share through

- **Copy share link** compresses the whole challenge into the URL itself. A
  typical lesson comes to about 1.4 KB of link. Anyone who opens it gets the
  challenge — no key, no account, no upload of their own.
- If a challenge is too big for a link, the button downloads a `.json` file
  instead, which classmates load with **Import a challenge file**.

Because challenges live in the browser that made them, clearing site data
clears them. Download the file for anything you want to keep.

---

## Scoring

Getting something wrong is not the end of a question. Every question can be
retried; what changes is what it is worth.

| Correct on attempt | Points |
| --- | --- |
| 1st | 10 |
| 2nd | 6 |
| 3rd | 3 |
| 4th or later | 1 |

A wrong multiple-choice option is struck out and you pick again — the answer is
never simply handed to you while a choice remains. Typed and spoken questions
allow four tries before the answer is shown. On the matching level each pair is
scored separately, so one stubborn word does not cost you the round.

**Each level is marked out of 100** regardless of how many questions it happened
to generate, so a six-question level counts exactly as much as an eight-question
one and totals stay comparable between runs. **The challenge is out of 500.**

- **80 or above passes a level.** You then choose: continue to the next level,
  or replay this one to push the score higher.
- **A score can never go down.** A worse replay is discarded, so there is no
  risk in trying again — which is the whole point of allowing it.
- **Finishing all five** shows your total with a per-level breakdown, and offers
  a full replay that can only raise it.

## The five levels

Each needs 80 out of 100 to unlock the next.

| # | Level | What it asks |
| --- | --- | --- |
| 1 | Listen and match | Hear a word, pair it with its meaning. No typing. |
| 2 | Choose the meaning | Both directions — meaning from word, word from meaning. |
| 3 | Spell what you hear | Type the word from its sound, diacritics included. |
| 4 | Say it out loud | Speak it, and be judged or judge yourself. |
| 5 | The gauntlet | All of the above, plus the lesson's own rules and dialogue gaps. |

Level names appear in the language being learned — *Theetša, Kgetha, Ngwala,
Bolela, Teko* for Sepedi; *Lalela, Khetha, Bhala, Khuluma, Isivivinyo* for
isiZulu.

Distractors are drawn from the same worksheet and prefer the same category, so
you are asked to tell *leihlo* from *tsebe* rather than from an unrelated word.
Words with near-identical English glosses are kept out of the same matching
round, since both columns would read the same.

---

## About the audio — read this part

This is the honest limitation of the whole project, and the interface says so
rather than hiding it.

**Text to speech.** Browsers ship the voices they ship. Chrome sometimes has an
isiZulu voice; a Sepedi one is rare. When no native voice exists the app falls
back through Xhosa, Swahili, Afrikaans, then Italian, Spanish and Portuguese —
languages whose five-vowel systems land close to the real values. It will
**never** fall back to English, which turns *dumela* into something a Sepedi
speaker would not recognise. If nothing suitable is found, playback is switched
off entirely rather than teaching wrong sounds.

A badge on every challenge says which of the three situations you are in:

- 🟢 **Native voice** — trust it.
- 🟠 **Approximate** — a guide, not a model speaker. Where your worksheet gives a
  pronunciation note, trust the note.
- 🔴 **No suitable voice** — playback off. Installing a system language pack
  turns it on.

When a fallback voice is reading, a small respelling layer runs first: `š` →
`sh`, circumflexes flattened, tone marks stripped, and for Italian and Spanish
voices `sh` mapped to the nearest digraph those languages have.

**Speech recognition.** Chrome recognises isiZulu (`zu-ZA`). There is no Sepedi
recogniser. So:

- **isiZulu** uses the recogniser, forgivingly — it is trained on connected
  speech, not isolated words, so a low score means "try again", not "wrong".
- **Sepedi** falls back to record-and-compare: hear the model, record yourself,
  play them back to back. For fixing a sound this is the better tool anyway.

Either way there is always an **"I said it correctly"** override. A weak
recogniser must never be able to lock someone out of a level.

**What the audio cannot do.** Neither speech engine renders tone, and both
isiZulu and Sepedi are tone languages — `kè mosadi` ("I am a woman") against
`ké mosadi` ("she is a woman") sound identical to a speech engine. Penultimate
lengthening in Zulu is likewise absent, as are the clicks in any non-Nguni
fallback voice. For those, the recordings your lecturers link are the real
source; the app shows every pronunciation note from your document next to the
word for exactly this reason.

---

## Testing

```bash
node serve.js &
node tools/check.js          # 26 checks — the pipeline end to end
node tools/scoring-check.js  # 31 checks — the points system
```

`scoring-check.js` answers questions wrong on purpose to confirm the decay is
real: that a fourth-try answer still scores, that a first try is worth ten times
a fourth, that a worse replay never lowers a stored best, that a level marked
out of 100 gives the same score for six questions as for eight, and that the
challenge total is the five bests added up.

`check.js` is 26 checks in a real browser. It reads the actual SEP 119 and ZUL 119 PDFs
through the real parser — including the 94-page one — and mocks only the call to
Google, so the full pipeline runs without spending anyone's quota. It covers the
upload flow, that the validator drops junk entries, that a caron survives from
PDF to screen, that a share link round-trips exactly and opens for someone with
no key at all, that progress survives a reload, and that rate limits, bad keys
and missing models each produce a message a person can act on.

Two bugs were caught this way and fixed: a guard that froze every level after
its first question, and near-identical glosses landing in the same matching
round.

---

## Layout

```
index.html
serve.js         local dev server only; not needed once deployed
css/app.css      one stylesheet, light and dark
js/
  app.js         routing, screens, level runner
  documents.js   PDF / DOCX / TXT reading in the browser
  gemini.js      the extraction call, key handling, model discovery
  pack.js        validation — the gate everything passes through
  levels.js      level and question construction, grading rules
  speech.js      voice selection, respelling, recognition, similarity scoring
  progress.js    local progress
  store.js       challenge storage, share encoding, import and export
vendor/          pdf.js and mammoth, vendored so no CDN can break the site
tools/check.js   the browser test suite
fixtures/        the course PDFs the tests read
```

---

## Where to take it next

- **Real recordings.** A per-word upload that plays a human voice instead of TTS
  would fix everything in the audio section above. It is the single
  highest-value addition.
- **Spaced repetition** across challenges, so words you keep missing come back.
- **A grammar level** for the later ZUL 119 isifundo — noun classes, concords
  and tenses need sentence-building, not word matching.
- **A rule-based parser** as a fallback, so the site still works for someone who
  will not set up a key at all.
