import { speech, listenOnce, recognitionAvailable, Recorder } from './speech.js';
import { buildLevels, gradeSpelling, gradeSpoken, PASS_MARK } from './levels.js';
import {
  getProgress,
  recordLevel,
  isUnlocked,
  challengeComplete,
  resetChallenge,
} from './progress.js';
import { readDocument } from './documents.js';
import { extractPack, getKey, setKey, getModel, setModel, listModels } from './gemini.js';
import { normalisePack } from './pack.js';
import {
  saveChallenge,
  loadChallenge,
  listChallenges,
  deleteChallenge,
  encodeShare,
  decodeShare,
  downloadPack,
} from './store.js';

/* ------------------------------ tiny helpers ----------------------------- */

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const setScreen = (node) => {
  document.getElementById('app').replaceChildren(node);
  window.scrollTo({ top: 0 });
};

/* -------------------------------- state --------------------------------- */

const state = { id: null, pack: null, levels: [], voice: null };

function chooseVoice() {
  if (state.pack) state.voice = speech.selectVoice(state.pack.language);
}

speech.onReady(() => {
  if (!state.pack) return;
  const before = state.voice && state.voice.quality;
  chooseVoice();
  if (before !== (state.voice && state.voice.quality)) {
    document.querySelectorAll('[data-voice-badge]').forEach((node) => node.replaceWith(voiceBadge()));
  }
});

async function say(text, { slow = false } = {}) {
  if (!state.voice || !state.voice.voice) return false;
  try {
    await speech.speak(text, state.voice, { slow });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------ shared bits ------------------------------ */

function voiceBadge() {
  const quality = state.voice ? state.voice.quality : 'none';
  const label = state.voice ? state.voice.label : 'Checking available voices…';
  return el('div', { class: `voice-badge voice-${quality}`, 'data-voice-badge': '' }, [
    el('span', { class: 'voice-dot' }),
    el('span', { text: label }),
  ]);
}

function speakButton(text, { label = 'Play', big = false } = {}) {
  const available = Boolean(state.voice && state.voice.voice);
  const button = el(
    'button',
    {
      class: `speak ${big ? 'speak-big' : ''}`,
      type: 'button',
      disabled: !available,
      title: available ? 'Play' : 'No suitable voice installed for this language',
      'aria-label': `${label}: ${text}`,
    },
    [el('span', { class: 'speak-icon', text: '🔊' }), big ? el('span', { text: label }) : null]
  );

  button.addEventListener('click', async () => {
    button.classList.add('is-playing');
    await say(text);
    button.classList.remove('is-playing');
  });

  return button;
}

function slowButton(text) {
  return el(
    'button',
    {
      class: 'speak speak-slow',
      type: 'button',
      disabled: !(state.voice && state.voice.voice),
      title: 'Play slowly',
      'aria-label': `Play slowly: ${text}`,
      onclick: () => say(text, { slow: true }),
    },
    [el('span', { class: 'speak-icon', text: '🐢' })]
  );
}

function header() {
  return el('header', { class: 'top' }, [
    el('a', { class: 'brand', href: '#/' }, [
      el('span', { class: 'brand-mark', text: 'L' }),
      el('span', {}, [
        el('strong', { text: 'Lekgotla' }),
        el('span', { class: 'brand-sub', text: 'isiZulu & Sepedi, from your own worksheets' }),
      ]),
    ]),
    el('a', { class: 'back', href: '#/settings', text: '⚙ Settings' }),
  ]);
}

/* -------------------------------- routing -------------------------------- */

const navigate = (hash) => {
  if (window.location.hash === hash) route();
  else window.location.hash = hash;
};

window.addEventListener('hashchange', () => route());

async function route() {
  const hash = window.location.hash.replace(/^#/, '') || '/';

  const shared = hash.match(/^\/s\/(.+)$/);
  if (shared) return showShared(shared[1]);

  const challenge = hash.match(/^\/c\/([A-Za-z0-9_-]+)$/);
  if (challenge) return showChallenge(challenge[1]);

  if (hash === '/settings') return showSettings();

  return showHome();
}

/* ------------------------------- settings -------------------------------- */

function showSettings() {
  state.pack = null;

  const keyInput = el('input', {
    class: 'text-input',
    type: 'password',
    value: getKey(),
    placeholder: 'AIza…',
    autocomplete: 'off',
    spellcheck: 'false',
  });

  const modelSelect = el('select', { class: 'text-input' }, [
    el('option', { value: '', text: 'Checking which models your key can use…' }),
  ]);

  const status = el('div', { class: 'status', 'aria-live': 'polite' });

  const refreshModels = async () => {
    const key = keyInput.value.trim();
    if (!key) {
      modelSelect.replaceChildren(el('option', { value: '', text: 'Add a key first' }));
      return;
    }

    modelSelect.replaceChildren(el('option', { value: '', text: 'Checking…' }));

    try {
      const models = await listModels(key);
      const current = getModel();

      modelSelect.replaceChildren(
        ...models.map((model, index) =>
          el('option', {
            value: model.id,
            text: `${model.label}${index === 0 ? ' — recommended' : ''}`,
            selected: current ? current === model.id : index === 0,
          })
        )
      );

      if (!current && models.length) setModel(models[0].id);

      status.className = 'status status-ok';
      status.replaceChildren(el('span', { text: `Key works. ${models.length} models available.` }));
    } catch (error) {
      modelSelect.replaceChildren(el('option', { value: '', text: 'Could not list models' }));
      status.className = 'status status-error';
      status.replaceChildren(el('span', { text: error.message }));
    }
  };

  const save = el('button', { class: 'primary', type: 'submit', text: 'Save' });

  const form = el('form', { class: 'upload-form' }, [
    el('label', { class: 'field' }, [
      el('span', { text: 'Your Google AI Studio API key' }),
      keyInput,
    ]),
    el('label', { class: 'field' }, [el('span', { text: 'Model' }), modelSelect]),
    el('div', { class: 'row' }, [
      save,
      el('button', {
        class: 'ghost',
        type: 'button',
        text: 'Test key',
        onclick: refreshModels,
      }),
      getKey()
        ? el('button', {
            class: 'ghost subtle',
            type: 'button',
            text: 'Forget my key',
            onclick: () => {
              setKey('');
              setModel('');
              navigate('#/settings');
            },
          })
        : null,
    ]),
    status,
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setKey(keyInput.value);
    if (modelSelect.value) setModel(modelSelect.value);
    status.className = 'status status-ok';
    status.replaceChildren(el('span', { text: 'Saved. You can create challenges now.' }));
  });

  modelSelect.addEventListener('change', () => setModel(modelSelect.value));

  setScreen(
    el('div', { class: 'page' }, [
      header(),
      el('section', { class: 'hero' }, [
        el('h1', { text: 'Settings' }),
        el('p', {
          class: 'lede',
          text: 'This site has no server, so it uses your own free Google AI Studio key to read documents. You only need to do this once.',
        }),
      ]),
      el('section', { class: 'how' }, [
        el('h2', { text: 'Getting a free key' }),
        el('ol', { class: 'steps' }, [
          el('li', {}, [
            'Open ',
            el('a', {
              href: 'https://aistudio.google.com/apikey',
              target: '_blank',
              rel: 'noopener',
              text: 'aistudio.google.com/apikey',
            }),
            ' and sign in with a Google account.',
          ]),
          el('li', { text: 'Click "Create API key". No card is needed for the free tier.' }),
          el('li', { text: 'Paste it below and press Save.' }),
        ]),
        el('p', { class: 'caveat' }, [
          'Two things worth knowing. The key is stored in this browser only — never sent anywhere but Google — and you can erase it with "Forget my key". And on Google’s free tier, the documents you upload may be used to improve their products, so think before uploading material you do not have the right to share.',
        ]),
      ]),
      form,
    ])
  );

  if (getKey()) refreshModels();
  else modelSelect.replaceChildren(el('option', { value: '', text: 'Add a key first' }));
}

/* --------------------------------- home ---------------------------------- */

function showHome() {
  state.pack = null;

  const hasKey = Boolean(getKey());

  const fileInput = el('input', {
    type: 'file',
    id: 'file',
    accept: '.pdf,.docx,.txt,.md,application/pdf',
    class: 'visually-hidden',
  });

  const fileName = el('p', { class: 'drop-file', text: 'No file chosen yet' });
  const status = el('div', { class: 'status', 'aria-live': 'polite' });
  const submit = el('button', {
    class: 'primary',
    type: 'submit',
    disabled: true,
    text: 'Create the challenge',
  });

  const drop = el('label', { class: 'drop', for: 'file' }, [
    el('div', { class: 'drop-icon', text: '📄' }),
    el('p', { class: 'drop-lead', text: 'Drop a worksheet here, or click to choose' }),
    el('p', { class: 'drop-hint', text: 'PDF, Word .docx, or plain text — lecture slides work well' }),
    fileName,
  ]);

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    fileName.textContent = file ? file.name : 'No file chosen yet';
    drop.classList.toggle('has-file', Boolean(file));
    submit.disabled = !file || !getKey();
  });

  ['dragenter', 'dragover'].forEach((event) =>
    drop.addEventListener(event, (e) => {
      e.preventDefault();
      drop.classList.add('is-over');
    })
  );
  ['dragleave', 'drop'].forEach((event) =>
    drop.addEventListener(event, (e) => {
      e.preventDefault();
      drop.classList.remove('is-over');
    })
  );
  drop.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event('change'));
  });

  const form = el('form', { class: 'upload-form' }, [drop, fileInput, submit, status]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;

    submit.disabled = true;
    const step = (message) => {
      status.className = 'status status-busy';
      status.replaceChildren(el('span', { class: 'spinner' }), el('span', { text: message }));
    };

    try {
      step('Reading your document…');
      const doc = await readDocument(file);

      step(
        doc.needsVision
          ? 'No text layer found, so the pages are being read visually. This takes a little longer.'
          : `Read ${doc.pagesRead ? `${doc.pagesRead} pages` : 'the document'}. Building the levels…`
      );

      const raw = await extractPack(doc, { key: getKey(), model: getModel() || 'gemini-2.5-flash' });
      const pack = normalisePack(raw, {
        filename: doc.filename,
        pagesRead: doc.pagesRead,
        totalPages: doc.totalPages,
        truncated: doc.truncated,
        needsVision: doc.needsVision,
      });

      const saved = saveChallenge(pack);
      if (!saved.stored) {
        // Storage full — the challenge still plays, it just will not be here
        // after a reload unless it is exported.
        window.alert(
          'This browser is out of storage, so the challenge could not be saved. It will still play now — use "Download challenge file" to keep it.'
        );
      }
      navigate(`#/c/${saved.id}`);
    } catch (error) {
      status.className = 'status status-error';
      status.replaceChildren(el('span', { text: error.message }));
      submit.disabled = false;
    }
  });

  /* import a challenge file someone shared */
  const importInput = el('input', {
    type: 'file',
    accept: '.json,application/json',
    class: 'visually-hidden',
    id: 'import',
  });

  importInput.addEventListener('change', async () => {
    const file = importInput.files && importInput.files[0];
    if (!file) return;
    try {
      const pack = normalisePack(JSON.parse(await file.text()), { filename: file.name });
      const saved = saveChallenge(pack);
      navigate(`#/c/${saved.id}`);
    } catch (error) {
      status.className = 'status status-error';
      status.replaceChildren(el('span', { text: `That file is not a challenge. ${error.message}` }));
    }
  });

  const challenges = listChallenges();

  setScreen(
    el('div', { class: 'page' }, [
      header(),
      el('section', { class: 'hero' }, [
        el('h1', { text: 'Turn your language worksheet into a challenge you can hear' }),
        el('p', {
          class: 'lede',
          text: 'Upload an isiZulu or Sepedi lesson and it becomes five levels — listening, meaning, spelling, speaking, and a final gauntlet. Nothing is preloaded: the words you practise are the words on your page.',
        }),
      ]),
      !hasKey
        ? el('div', { class: 'banner banner-setup' }, [
            el('span', { text: 'One-time setup: this site needs your own free Google AI key to read documents.' }),
            el('a', { class: 'primary', href: '#/settings', text: 'Set it up' }),
          ])
        : null,
      form,
      el('section', { class: 'how' }, [
        el('h2', { text: 'How it works' }),
        el('ol', { class: 'steps' }, [
          el('li', {}, [el('strong', { text: 'Upload' }), ' your worksheet, slides, or notes.']),
          el('li', {}, [
            el('strong', { text: 'Your browser reads the page' }),
            ' and pulls out the vocabulary, dialogues and pronunciation rules — only what is actually there.',
          ]),
          el('li', {}, [
            el('strong', { text: 'Work through five levels' }),
            ` — each one needs ${PASS_MARK}% before the next unlocks.`,
          ]),
          el('li', {}, [
            el('strong', { text: 'Share the link' }),
            ' so classmates can attempt the same challenge without needing a key of their own.',
          ]),
        ]),
      ]),
      el('section', { class: 'recent' }, [
        el('div', { class: 'row spread' }, [
          el('h2', { text: challenges.length ? 'Your challenges' : 'No challenges yet' }),
          el('label', { class: 'ghost as-button', for: 'import' }, ['Import a challenge file']),
        ]),
        importInput,
        challenges.length
          ? el(
              'div',
              { class: 'card-grid' },
              challenges.map((challenge) =>
                el('a', { class: 'challenge-card', href: `#/c/${challenge.id}` }, [
                  el('span', {
                    class: `pill pill-${challenge.pack.language.code}`,
                    text: challenge.pack.language.name,
                  }),
                  el('h3', { text: challenge.pack.title }),
                  el('p', {
                    class: 'muted',
                    text: `${challenge.pack.counts.vocab} words · ${challenge.pack.counts.dialogues} dialogues · ${challenge.pack.counts.rules} rules`,
                  }),
                ])
              )
            )
          : el('p', {
              class: 'muted',
              text: 'Challenges you create are kept in this browser. Nothing is uploaded to a server, because there isn’t one.',
            }),
      ]),
    ])
  );
}

/* ---------------------------- a shared challenge -------------------------- */

async function showShared(encoded) {
  setScreen(
    el('div', { class: 'page' }, [
      header(),
      el('div', { class: 'loading' }, [el('span', { class: 'spinner' }), ' Opening shared challenge…']),
    ])
  );

  try {
    const pack = normalisePack(await decodeShare(encoded), {});
    const saved = saveChallenge(pack);
    navigate(`#/c/${saved.id}`);
  } catch (error) {
    setScreen(
      el('div', { class: 'page' }, [
        header(),
        el('div', { class: 'status status-error' }, [
          `That shared link could not be opened. ${error.message}`,
        ]),
        el('p', {}, [el('a', { href: '#/', text: '← Back to the start' })]),
      ])
    );
  }
}

/* ------------------------------- challenge ------------------------------- */

function showChallenge(id) {
  const record = loadChallenge(id);

  if (!record) {
    setScreen(
      el('div', { class: 'page' }, [
        header(),
        el('div', { class: 'status status-error' }, [
          'That challenge is not in this browser. Challenges are stored on the device that made them — ask for the share link or the challenge file.',
        ]),
        el('p', {}, [el('a', { href: '#/', text: '← Back to the start' })]),
      ])
    );
    return;
  }

  state.id = id;
  state.pack = record.pack;
  state.levels = buildLevels(record.pack);
  chooseVoice();
  renderMap();
}

function renderMap() {
  const { pack, levels, id } = state;
  const progress = getProgress(id);
  const levelIds = levels.map((level) => level.id);
  const done = challengeComplete(progress, levelIds);

  const levelCards = levels.map((level, index) => {
    const unlocked = isUnlocked(progress, index, levelIds);
    const record = progress.levels[level.id];
    const passed = record && record.passed;

    return el(
      'button',
      {
        class: `level-card ${unlocked ? '' : 'is-locked'} ${passed ? 'is-passed' : ''}`,
        type: 'button',
        disabled: !unlocked,
        onclick: () => unlocked && startLevel(level),
      },
      [
        el('div', { class: 'level-number' }, [unlocked ? level.icon : '🔒']),
        el('div', { class: 'level-body' }, [
          el('h3', { text: `Level ${level.number} · ${level.name}` }),
          el('p', { class: 'muted', text: level.blurb }),
          record
            ? el('p', {
                class: `level-score ${passed ? 'ok' : 'warn'}`,
                text: `Best ${record.best}% over ${record.attempts} attempt${record.attempts === 1 ? '' : 's'}${passed ? ' · passed' : ` · ${PASS_MARK}% to pass`}`,
              })
            : null,
          !unlocked ? el('p', { class: 'muted small', text: `Pass level ${level.number - 1} to unlock this.` }) : null,
        ]),
      ]
    );
  });

  const vocabList = el(
    'div',
    { class: 'study-grid' },
    pack.vocab.map((item) =>
      el('div', { class: 'study-item' }, [
        el('div', { class: 'study-row' }, [
          el('span', { class: 'target', text: item.target }),
          speakButton(item.target),
          slowButton(item.target),
        ]),
        el('span', { class: 'english', text: item.english }),
        item.note ? el('span', { class: 'note', text: item.note }) : null,
        item.category ? el('span', { class: 'chip', text: item.category }) : null,
      ])
    )
  );

  const rulesList = pack.rules.length
    ? el('div', { class: 'rules' }, [
        el('h2', { text: 'What this lesson teaches' }),
        ...pack.rules.map((rule) =>
          el('details', { class: 'rule' }, [
            el('summary', { text: rule.title }),
            el('p', { text: rule.detail }),
            rule.examples.length
              ? el(
                  'ul',
                  { class: 'examples' },
                  rule.examples.map((example) =>
                    el('li', {}, [el('span', { text: example }), speakButton(example)])
                  )
                )
              : null,
          ])
        ),
      ])
    : null;

  const dialogueList = pack.dialogues.length
    ? el('div', { class: 'rules' }, [
        el('h2', { text: 'Conversations' }),
        ...pack.dialogues.map((dialogue) =>
          el('details', { class: 'rule' }, [
            el('summary', { text: dialogue.title }),
            dialogue.context ? el('p', { class: 'muted', text: dialogue.context }) : null,
            el(
              'div',
              { class: 'dialogue' },
              dialogue.lines.map((line) =>
                el('div', { class: 'dialogue-line' }, [
                  line.speaker ? el('span', { class: 'speaker', text: line.speaker }) : null,
                  el('div', {}, [
                    el('div', { class: 'dialogue-target' }, [
                      el('span', { text: line.target }),
                      speakButton(line.target),
                    ]),
                    line.english ? el('span', { class: 'english', text: line.english }) : null,
                  ]),
                ])
              )
            ),
          ])
        ),
      ])
    : null;

  const shareButton = el('button', { class: 'ghost', type: 'button', text: 'Copy share link' });
  shareButton.addEventListener('click', async () => {
    shareButton.disabled = true;
    const encoded = await encodeShare(pack);

    if (!encoded) {
      shareButton.textContent = 'Too big for a link — downloading file instead';
      downloadPack(pack, `${pack.title.replace(/[^\w -]/g, '')}.json`);
      setTimeout(() => {
        shareButton.textContent = 'Copy share link';
        shareButton.disabled = false;
      }, 2600);
      return;
    }

    const url = `${window.location.origin}${window.location.pathname}#/s/${encoded}`;
    try {
      await navigator.clipboard.writeText(url);
      shareButton.textContent = 'Link copied';
    } catch {
      shareButton.textContent = 'Copy failed — use the file instead';
    }
    setTimeout(() => {
      shareButton.textContent = 'Copy share link';
      shareButton.disabled = false;
    }, 1800);
  });

  setScreen(
    el('div', { class: 'page' }, [
      header(),
      el('section', { class: 'challenge-head' }, [
        el('a', { class: 'back', href: '#/', text: '← All challenges' }),
        el('span', { class: `pill pill-${pack.language.code}`, text: pack.language.name }),
        el('h1', { text: pack.title }),
        pack.summary ? el('p', { class: 'lede', text: pack.summary }) : null,
        el('p', {
          class: 'muted small',
          text: `${pack.counts.vocab} words · ${pack.counts.phrases} phrases · ${pack.counts.dialogues} dialogues · ${pack.counts.rules} rules — all taken from ${pack.source.filename || 'your document'}${pack.source.truncated ? ' (long document, read in part)' : ''}.`,
        }),
        voiceBadge(),
        state.voice && state.voice.quality !== 'native'
          ? el('p', { class: 'caveat' }, [
              state.voice.quality === 'none'
                ? 'Without a suitable voice the listening and speaking levels lean on the written notes instead. Installing a language pack for this language in your operating system will switch playback on.'
                : 'Treat the audio as a guide, not a model speaker. Where the document gives a pronunciation note, trust the note.',
            ])
          : null,
        el('div', { class: 'row' }, [
          shareButton,
          el('button', {
            class: 'ghost',
            type: 'button',
            text: 'Download challenge file',
            onclick: () => downloadPack(pack, `${pack.title.replace(/[^\w -]/g, '')}.json`),
          }),
          done
            ? el('button', {
                class: 'ghost',
                type: 'button',
                text: 'Reset my progress',
                onclick: () => {
                  resetChallenge(id);
                  renderMap();
                },
              })
            : null,
          el('button', {
            class: 'ghost subtle',
            type: 'button',
            text: 'Delete',
            onclick: () => {
              if (!window.confirm('Delete this challenge from this browser? The file and any share link still work.')) return;
              deleteChallenge(id);
              resetChallenge(id);
              navigate('#/');
            },
          }),
        ]),
      ]),
      done
        ? el('div', { class: 'banner banner-win' }, [
            `🎉 Challenge complete — ${progress.xp} XP, best streak ${progress.bestStreak}. Every level passed.`,
          ])
        : el('div', { class: 'xp-strip' }, [
            el('span', { text: `${progress.xp} XP` }),
            el('span', {
              text: `${levelIds.filter((levelId) => progress.levels[levelId] && progress.levels[levelId].passed).length} of ${levels.length} levels passed`,
            }),
          ]),
      el('section', { class: 'levels' }, levelCards),
      el('section', { class: 'study' }, [
        el('h2', { text: 'Word list' }),
        el('p', { class: 'muted', text: 'Listen through these before you start, or come back between levels.' }),
        vocabList,
      ]),
      rulesList,
      dialogueList,
    ])
  );
}

/* ------------------------------ level runner ----------------------------- */

function startLevel(level) {
  const rounds = level.build();
  if (!rounds.length) {
    renderMap();
    return;
  }

  renderRound({
    level,
    rounds,
    index: 0,
    score: 0,
    total: rounds.reduce((sum, round) => sum + (round.points || 1), 0),
    streak: 0,
    bestStreak: 0,
    answered: false,
  });
}

function renderRound(session) {
  const round = session.rounds[session.index];
  const percent = Math.round((session.index / session.rounds.length) * 100);

  // The guard below stops a question being scored twice. It belongs to the
  // question, not the level, so it has to be cleared on every render.
  session.answered = false;

  const body = el('div', { class: 'round-body' });
  const feedback = el('div', { class: 'feedback', 'aria-live': 'polite' });
  const footer = el('div', { class: 'round-footer' });

  const advance = () => {
    session.index += 1;
    if (session.index >= session.rounds.length) renderResults(session);
    else renderRound(session);
  };

  const settle = (correct, points, message, tone) => {
    if (session.answered) return;
    session.answered = true;

    if (correct) {
      session.score += points;
      session.streak += 1;
      session.bestStreak = Math.max(session.bestStreak, session.streak);
    } else {
      session.streak = 0;
    }

    const heading = correct
      ? pickPraise(session.streak)
      : tone === 'near'
        ? 'Almost'
        : 'Not this time';

    feedback.className = `feedback ${tone || (correct ? 'good' : 'bad')}`;
    feedback.replaceChildren(
      el('strong', { text: heading }),
      message ? el('span', { text: message }) : null
    );

    footer.replaceChildren(
      el('button', {
        class: 'primary',
        type: 'button',
        text: session.index === session.rounds.length - 1 ? 'See results' : 'Next',
        onclick: advance,
      })
    );
    footer.querySelector('button').focus();
  };

  renderRoundBody(round, body, settle);

  setScreen(
    el('div', { class: 'page play' }, [
      el('div', { class: 'play-top' }, [
        el('button', {
          class: 'back',
          type: 'button',
          text: '← Leave level',
          onclick: () => {
            speech.cancel();
            renderMap();
          },
        }),
        el('span', { class: 'play-title', text: `Level ${session.level.number} · ${session.level.short}` }),
        el('span', { class: 'play-count', text: `${session.index + 1} / ${session.rounds.length}` }),
      ]),
      el('div', { class: 'bar' }, [el('div', { class: 'bar-fill', style: `width:${percent}%` })]),
      session.streak > 1 ? el('div', { class: 'streak', text: `🔥 ${session.streak} in a row` }) : null,
      body,
      feedback,
      footer,
    ])
  );
}

const PRAISE = ['Correct', 'Yebo!', 'Ke gona!', 'Sharp', 'That is it', 'Gabotse!'];
const pickPraise = (streak) => {
  const word = PRAISE[Math.floor(Math.random() * PRAISE.length)];
  return streak >= 4 ? `${word} — ${streak} straight!` : word;
};

function renderRoundBody(round, body, settle) {
  if (round.type === 'match') return renderMatch(round, body, settle);
  if (round.type === 'choice') return renderChoice(round, body, settle);
  if (round.type === 'spell') return renderSpell(round, body, settle);
  if (round.type === 'speak') return renderSpeak(round, body, settle);
  if (round.type === 'cloze') return renderCloze(round, body, settle);
  if (round.type === 'fact') return renderFact(round, body, settle);
  return null;
}

/* --- level 1: listen and match --- */

function renderMatch(round, body, settle) {
  let selected = null;
  let matched = 0;
  let firstTryHits = 0;
  const attempted = new Set();
  const leftNodes = new Map();

  const check = () => {
    if (matched !== round.pairs.length) return;
    const passed = firstTryHits >= Math.ceil(round.pairs.length * 0.8);
    settle(
      passed,
      firstTryHits,
      `${firstTryHits} of ${round.pairs.length} paired first time.`,
      passed ? 'good' : 'bad'
    );
  };

  const pickRight = (item, node) => {
    if (!selected || node.classList.contains('is-done')) return;

    if (selected.item.id === item.id) {
      matched += 1;
      if (!attempted.has(item.id)) firstTryHits += 1;
      node.classList.add('is-done');
      selected.node.classList.add('is-done');
      selected.node.classList.remove('is-selected');
      selected = null;
      check();
      return;
    }

    attempted.add(selected.item.id);
    node.classList.add('is-wrong');
    selected.node.classList.add('is-wrong');
    const previous = selected;
    setTimeout(() => {
      node.classList.remove('is-wrong');
      previous.node.classList.remove('is-wrong', 'is-selected');
    }, 550);
    selected = null;
  };

  const left = el(
    'div',
    { class: 'match-col' },
    round.left.map((item) => {
      const node = el('button', { class: 'match-item', type: 'button' }, [
        el('span', { class: 'target', text: item.target }),
        el('span', { class: 'speak-icon', text: '🔊' }),
      ]);
      node.addEventListener('click', () => {
        if (node.classList.contains('is-done')) return;
        say(item.target);
        leftNodes.forEach((other) => other.classList.remove('is-selected'));
        node.classList.add('is-selected');
        selected = { item, node };
      });
      leftNodes.set(item.id, node);
      return node;
    })
  );

  const right = el(
    'div',
    { class: 'match-col' },
    round.right.map((item) => {
      const node = el('button', { class: 'match-item match-english', type: 'button', text: item.english });
      node.addEventListener('click', () => pickRight(item, node));
      return node;
    })
  );

  body.replaceChildren(
    el('h2', { class: 'prompt', text: 'Tap a word to hear it, then tap its meaning' }),
    el('div', { class: 'match' }, [left, right])
  );
}

/* --- level 2 and gauntlet: multiple choice --- */

function renderChoice(round, body, settle) {
  const toEnglish = round.direction === 'target-to-english';

  const options = el(
    'div',
    { class: 'options' },
    round.options.map((option, index) => {
      const node = el('button', { class: 'option', type: 'button' }, [
        el('span', { text: option }),
        round.speakOptions ? speakButton(option) : null,
      ]);

      node.addEventListener('click', (event) => {
        if (event.target.closest('.speak')) return;
        const correct = index === round.answerIndex;
        node.classList.add(correct ? 'is-correct' : 'is-wrong');
        if (!correct) options.children[round.answerIndex].classList.add('is-correct');
        options.querySelectorAll('.option').forEach((other) => (other.disabled = true));
        say(round.item.target);
        settle(correct, round.points, correct ? '' : `“${round.item.target}” means “${round.item.english}”.`);
      });

      return node;
    })
  );

  if (round.speakPrompt) say(round.speakPrompt);

  body.replaceChildren(
    el('h2', { class: 'prompt', text: round.question }),
    el('div', { class: 'prompt-block' }, [
      el('span', { class: toEnglish ? 'big-target' : 'big-english', text: round.prompt }),
      round.speakPrompt ? speakButton(round.speakPrompt, { big: true, label: 'Hear it' }) : null,
      round.speakPrompt ? slowButton(round.speakPrompt) : null,
    ]),
    options
  );
}

/* --- level 3: spell what you hear --- */

function renderSpell(round, body, settle) {
  const language = state.pack.language;

  const input = el('input', {
    class: 'text-input spell-input',
    type: 'text',
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    placeholder: 'Type what you hear',
  });

  const charBar = language.specialChars.length
    ? el(
        'div',
        { class: 'char-bar' },
        language.specialChars.map((char) =>
          el('button', {
            class: 'char',
            type: 'button',
            text: char,
            onclick: () => {
              const start = input.selectionStart;
              const end = input.selectionEnd;
              input.value = input.value.slice(0, start) + char + input.value.slice(end);
              input.focus();
              input.setSelectionRange(start + char.length, start + char.length);
            },
          })
        )
      )
    : null;

  const submit = el('button', { class: 'primary', type: 'submit', text: 'Check' });
  const form = el('form', { class: 'spell-form' }, [input, charBar, submit]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = gradeSpelling(input.value, round.answer, language);
    if (result.kind === 'empty') return;

    input.disabled = true;
    submit.disabled = true;
    input.classList.add(result.correct ? 'is-correct' : 'is-wrong');
    say(round.answer);
    settle(result.correct, round.points, result.message, result.kind === 'diacritic' ? 'near' : undefined);
  });

  say(round.answer);

  body.replaceChildren(
    el('h2', { class: 'prompt', text: 'Spell the word you hear' }),
    el('div', { class: 'prompt-block' }, [
      speakButton(round.answer, { big: true, label: 'Play again' }),
      slowButton(round.answer),
    ]),
    el('p', { class: 'muted', text: `Meaning: ${round.hint}` }),
    form
  );

  setTimeout(() => input.focus(), 50);
}

/* --- level 4: say it out loud --- */

function renderSpeak(round, body, settle) {
  const language = state.pack.language;
  const canRecognise = recognitionAvailable && Boolean(language.recognition);

  const status = el('p', { class: 'muted', 'aria-live': 'polite' });
  const playback = el('div', { class: 'playback' });
  const controls = el('div', { class: 'row centered' });

  // A recogniser trained on connected speech will misjudge isolated words, and
  // for Sepedi there is no recogniser at all. Neither may block a learner who
  // knows they said it right.
  const override = el('button', {
    class: 'ghost',
    type: 'button',
    text: 'I said it correctly',
    onclick: () => settle(true, round.points, 'Marked correct by you.'),
  });

  const giveUp = el('button', {
    class: 'ghost subtle',
    type: 'button',
    text: 'Skip this word',
    onclick: () => settle(false, round.points, `The word was “${round.answer}”.`),
  });

  if (canRecognise) {
    const listen = el('button', { class: 'primary', type: 'button', text: '🎙️ Record my attempt' });
    listen.addEventListener('click', async () => {
      listen.disabled = true;
      listen.textContent = '🎙️ Listening…';
      status.textContent = 'Say the word clearly, once.';

      try {
        const result = gradeSpoken(await listenOnce(language.recognition), round.answer);

        if (result.correct) {
          settle(true, round.points, `Heard “${result.transcript}”.`);
          return;
        }

        listen.disabled = false;
        listen.textContent = '🎙️ Try again';
        status.textContent = result.transcript
          ? `Heard “${result.transcript}” — ${result.close ? 'close, try once more' : 'that is not quite it'}. If you know you said it right, mark it yourself.`
          : 'Nothing was picked up. Check your microphone, or mark it yourself.';
      } catch (error) {
        listen.disabled = false;
        listen.textContent = '🎙️ Record my attempt';
        status.textContent =
          error.message === 'not-allowed'
            ? 'Microphone access was blocked. You can still mark yourself.'
            : 'Speech recognition is unavailable right now — mark yourself instead.';
      }
    });
    controls.append(listen);
  } else if (Recorder.available) {
    const recorder = new Recorder();
    let recording = false;

    const record = el('button', { class: 'primary', type: 'button', text: '🎙️ Record my attempt' });
    record.addEventListener('click', async () => {
      if (!recording) {
        try {
          await recorder.start();
          recording = true;
          record.textContent = '⏹ Stop';
          record.classList.add('is-recording');
          status.textContent = 'Recording — say the word, then stop.';
        } catch {
          status.textContent = 'Microphone access was blocked. You can still mark yourself.';
        }
        return;
      }

      const url = await recorder.stop();
      recording = false;
      record.textContent = '🎙️ Record again';
      record.classList.remove('is-recording');
      status.textContent = 'Play them back one after the other, then judge yourself.';

      playback.replaceChildren(
        el('div', { class: 'row centered' }, [
          speakButton(round.answer, { big: true, label: 'The model' }),
          el('audio', { controls: '', src: url, class: 'audio' }),
        ])
      );
    });

    controls.append(record);
    status.textContent = `There is no speech recogniser for ${language.name}, so record yourself and compare — which is the better way to fix a sound anyway.`;
  } else {
    status.textContent =
      'This browser cannot reach the microphone. Say the word out loud against the model, then mark yourself.';
  }

  controls.append(override, giveUp);

  body.replaceChildren(
    el('h2', { class: 'prompt', text: 'Say this word out loud' }),
    el('div', { class: 'prompt-block' }, [
      el('span', { class: 'big-target', text: round.answer }),
      speakButton(round.answer, { big: true, label: 'Hear it' }),
      slowButton(round.answer),
    ]),
    el('p', { class: 'muted', text: `Meaning: ${round.item.english}` }),
    round.item.note ? el('p', { class: 'note-line', text: `Note from your worksheet: ${round.item.note}` }) : null,
    status,
    playback,
    controls
  );
}

/* --- gauntlet: fill the gap in a conversation --- */

function renderCloze(round, body, settle) {
  const options = el(
    'div',
    { class: 'options' },
    round.options.map((option, index) => {
      const node = el('button', { class: 'option', type: 'button', text: option });
      node.addEventListener('click', () => {
        const correct = index === round.answerIndex;
        node.classList.add(correct ? 'is-correct' : 'is-wrong');
        if (!correct) options.children[round.answerIndex].classList.add('is-correct');
        options.querySelectorAll('.option').forEach((other) => (other.disabled = true));
        say(round.full);
        settle(correct, round.points, `The full line is “${round.full}”.`);
      });
      return node;
    })
  );

  body.replaceChildren(
    el('h2', { class: 'prompt', text: 'Complete the line' }),
    round.context ? el('p', { class: 'muted', text: round.context }) : null,
    el('div', { class: 'prompt-block' }, [
      round.speaker ? el('span', { class: 'speaker', text: round.speaker }) : null,
      el('span', { class: 'big-target', text: round.sentence }),
    ]),
    round.english ? el('p', { class: 'muted', text: `It should mean: ${round.english}` }) : null,
    options
  );
}

/* --- gauntlet: rules from the lesson --- */

function renderFact(round, body, settle) {
  const options = el(
    'div',
    { class: 'options' },
    round.options.map((option, index) => {
      const node = el('button', { class: 'option', type: 'button', text: option });
      node.addEventListener('click', () => {
        const correct = index === round.answerIndex;
        node.classList.add(correct ? 'is-correct' : 'is-wrong');
        if (!correct) options.children[round.answerIndex].classList.add('is-correct');
        options.querySelectorAll('.option').forEach((other) => (other.disabled = true));
        settle(correct, round.points, round.explanation || '');
      });
      return node;
    })
  );

  body.replaceChildren(
    el('h2', { class: 'prompt', text: 'From the lesson' }),
    el('div', { class: 'prompt-block' }, [el('span', { class: 'question-text', text: round.question })]),
    options
  );
}

/* -------------------------------- results -------------------------------- */

function renderResults(session) {
  const percent = session.total ? Math.round((session.score / session.total) * 100) : 0;
  const passed = percent >= PASS_MARK;

  const progress = recordLevel(state.id, session.level.id, {
    score: session.score,
    total: session.total,
    streak: session.bestStreak,
  });

  const index = state.levels.findIndex((level) => level.id === session.level.id);
  const next = state.levels[index + 1];

  setScreen(
    el('div', { class: 'page play' }, [
      el('div', { class: `result ${passed ? 'result-pass' : 'result-fail'}` }, [
        el('div', { class: 'result-emoji', text: passed ? '🏆' : '💪' }),
        el('h1', { text: passed ? 'Level passed' : 'Not through yet' }),
        el('p', { class: 'result-score', text: `${percent}%` }),
        el('p', {
          class: 'muted',
          text: `${session.score} of ${session.total} correct · best streak ${session.bestStreak} · ${progress.xp} XP total`,
        }),
        !passed
          ? el('p', { class: 'muted', text: `You need ${PASS_MARK}% to unlock the next level. Your best score is kept.` })
          : null,
        el('div', { class: 'row centered' }, [
          el('button', {
            class: passed ? 'ghost' : 'primary',
            type: 'button',
            text: passed ? 'Play again' : 'Try again',
            onclick: () => startLevel(session.level),
          }),
          passed && next
            ? el('button', {
                class: 'primary',
                type: 'button',
                text: `Next: ${next.short}`,
                onclick: () => startLevel(next),
              })
            : null,
          el('button', { class: 'ghost', type: 'button', text: 'Back to levels', onclick: renderMap }),
        ]),
      ]),
    ])
  );
}

route();
