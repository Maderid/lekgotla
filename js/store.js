/**
 * Challenge storage without a server.
 *
 * Challenges live in this browser. Sharing works two ways, both free: a link
 * carrying the whole challenge compressed into the URL, and a downloadable
 * .json file for when a pack is too big for a link.
 */

const STORAGE = 'lekgotla.challenges.v1';

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE)) || {};
  } catch {
    return {};
  }
}

function writeAll(all) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(all));
    return true;
  } catch {
    // Usually the 5 MB quota. The challenge still works for this session.
    return false;
  }
}

const newId = () => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(36).padStart(2, '0')).join('').slice(0, 10);
};

export function saveChallenge(pack, id = newId()) {
  const all = readAll();
  all[id] = { id, createdAt: all[id] ? all[id].createdAt : new Date().toISOString(), pack };
  const stored = writeAll(all);
  return { id, pack, stored };
}

export function loadChallenge(id) {
  return readAll()[id] || null;
}

export function listChallenges() {
  return Object.values(readAll()).sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );
}

export function deleteChallenge(id) {
  const all = readAll();
  delete all[id];
  writeAll(all);
}

/* ------------------------------- sharing --------------------------------- */

const toBase64Url = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (value) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

async function gzip(text) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * Encode a pack for a URL. Returns null when the result would make a link too
 * long to survive being pasted around, in which case the caller offers the
 * file download instead.
 */
export async function encodeShare(pack) {
  const json = JSON.stringify(pack);
  const compressed = await gzip(json);
  if (!compressed) return null;

  const encoded = toBase64Url(compressed);
  return encoded.length > 12000 ? null : encoded;
}

export async function decodeShare(encoded) {
  const json = await gunzip(fromBase64Url(encoded));
  return JSON.parse(json);
}

export function downloadPack(pack, filename) {
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
