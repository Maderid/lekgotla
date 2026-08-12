/**
 * Progress lives in the browser. There are no accounts on this site, so a
 * learner's scores belong to the device they study on.
 *
 * The rule that governs everything here: a score never goes down. Replaying a
 * level can only improve it, so there is no risk in trying again — which is the
 * whole point of letting someone retry.
 */

import { LEVEL_TOTAL, PASS_MARK } from './levels.js';

const KEY = 'lekgotla.progress.v2';

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
    // Private browsing, quota, or storage disabled. Progress will not persist;
    // the session itself still plays fine.
  }
}

const blank = () => ({ levels: {}, runs: 0, bestTotal: 0, lastPlayed: null });

export function getProgress(challengeId) {
  const all = readAll();
  return { ...blank(), ...(all[challengeId] || {}) };
}

/**
 * Record a finished level.
 *
 * `earned` and `max` are raw question points; the stored score is normalised to
 * LEVEL_TOTAL so a level that generated six questions counts the same as one
 * that generated eight.
 */
export function recordLevel(challengeId, levelId, { score, earned, max }) {
  const all = readAll();
  const entry = { ...blank(), ...(all[challengeId] || {}) };
  const previous = entry.levels[levelId] || { best: 0, attempts: 0, passed: false };

  entry.levels[levelId] = {
    best: Math.max(previous.best, score),
    lastScore: score,
    lastEarned: earned,
    lastMax: max,
    attempts: previous.attempts + 1,
    passed: previous.passed || score >= PASS_MARK,
    improved: score > previous.best,
  };

  entry.lastPlayed = new Date().toISOString();
  all[challengeId] = entry;
  writeAll(all);
  return entry;
}

/** Mark that a full run through every level has been completed. */
export function recordRun(challengeId, total) {
  const all = readAll();
  const entry = { ...blank(), ...(all[challengeId] || {}) };
  entry.runs += 1;
  entry.bestTotal = Math.max(entry.bestTotal, total);
  all[challengeId] = entry;
  writeAll(all);
  return entry;
}

/**
 * The challenge score: every level's best, added up, out of five hundred.
 */
export function challengeTotal(progress, levelIds) {
  const earned = levelIds.reduce(
    (sum, id) => sum + (progress.levels[id] ? progress.levels[id].best : 0),
    0
  );
  const max = levelIds.length * LEVEL_TOTAL;
  return { earned, max, percent: max ? Math.round((earned / max) * 100) : 0 };
}

export function isUnlocked(progress, levelIndex, levelIds) {
  if (levelIndex === 0) return true;
  const previous = progress.levels[levelIds[levelIndex - 1]];
  return Boolean(previous && previous.passed);
}

export function challengeComplete(progress, levelIds) {
  return levelIds.every((id) => progress.levels[id] && progress.levels[id].passed);
}

export function resetChallenge(challengeId) {
  const all = readAll();
  delete all[challengeId];
  writeAll(all);
}
