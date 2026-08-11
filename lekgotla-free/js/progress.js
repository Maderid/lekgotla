/**
 * Progress lives in the browser. There are no accounts on this site, so a
 * learner's XP and unlocked levels belong to the device they study on.
 */

const KEY = 'lekgotla.progress.v1';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function writeAll(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private browsing, quota, or storage disabled. Progress simply will not
    // persist; the session itself still plays fine.
  }
}

const blank = () => ({ levels: {}, xp: 0, bestStreak: 0, lastPlayed: null });

export function getProgress(challengeId) {
  const all = readAll();
  return { ...blank(), ...(all[challengeId] || {}) };
}

/**
 * Record the outcome of a level. Scores only ever move up, so a bad rerun
 * never takes away a level you have already earned.
 */
export function recordLevel(challengeId, levelId, { score, total, streak = 0 }) {
  const all = readAll();
  const entry = { ...blank(), ...(all[challengeId] || {}) };
  const percent = total > 0 ? Math.round((score / total) * 100) : 0;
  const previous = entry.levels[levelId] || { best: 0, attempts: 0, passed: false };

  entry.levels[levelId] = {
    best: Math.max(previous.best, percent),
    attempts: previous.attempts + 1,
    passed: previous.passed || percent >= 80,
    lastScore: percent,
  };

  entry.xp += score * 10 + (percent >= 80 ? 50 : 0);
  entry.bestStreak = Math.max(entry.bestStreak, streak);
  entry.lastPlayed = new Date().toISOString();

  all[challengeId] = entry;
  writeAll(all);
  return entry;
}

export function isUnlocked(progress, levelIndex, levelIds) {
  if (levelIndex === 0) return true;
  const previous = progress.levels[levelIds[levelIndex - 1]];
  return Boolean(previous && previous.passed);
}

export function challengeComplete(progress, levelIds) {
  return levelIds.every((id) => progress.levels[id] && progress.levels[id].passed);
}

/** Every challenge this device has touched, for the home screen. */
export function playedChallenges() {
  const all = readAll();
  return Object.entries(all)
    .map(([id, entry]) => ({ id, ...entry }))
    .sort((a, b) => String(b.lastPlayed).localeCompare(String(a.lastPlayed)));
}

export function resetChallenge(challengeId) {
  const all = readAll();
  delete all[challengeId];
  writeAll(all);
}
