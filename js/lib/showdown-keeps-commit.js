// Spaniel Showdown — For Keeps commit-reveal helpers.
//
// A round commit is sha256 of a canonical string:
//
//   ${rulesHash}|${matchId}|${roundIndex}|${wallet}|${activeCardId}|${action}|${salt}
//
// Both the player's client and the Worker compute the same hex.
// On reveal, the Worker re-hashes the disclosed inputs and refuses
// to advance if it does not match the stored commit.
//
// `salt` is a 32-character lowercase-hex string (128 bits of entropy)
// chosen by the player; the same salt MUST be used on reveal.
// `activeCardId` is the cardKey of the player's active card at the
// time of commit — if the player's lineup advances mid-commit (e.g.
// active card gets knocked out before reveal lands), the reveal
// rejects.

import { sha256HexAscii } from './util-hash.js';
import { isValidKeepsAction } from './showdown-keeps-actions.js';

export const KEEPS_COMMIT_VERSION = 'showdown-for-keeps-commit-v1';

export const KEEPS_SALT_LENGTH_HEX = 32; // 16 bytes / 128 bits

const SALT_RE = /^[0-9a-f]{32}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

/**
 * Canonical string the commit hashes over. Exposed for tests + the
 * Worker so both sides verify against an identical input.
 */
export function canonicalCommitInput({ rulesHash, matchId, roundIndex, wallet, activeCardId, action, salt }) {
  if (typeof rulesHash !== 'string' || !HEX64_RE.test(rulesHash)) {
    throw new Error('rulesHash must be 64 hex chars');
  }
  if (typeof matchId !== 'string' || !matchId) {
    throw new Error('matchId required');
  }
  if (!Number.isInteger(roundIndex) || roundIndex < 0) {
    throw new Error(`roundIndex must be a non-negative integer (got ${roundIndex})`);
  }
  if (typeof wallet !== 'string' || !wallet) {
    throw new Error('wallet required');
  }
  if (typeof activeCardId !== 'string' || !activeCardId) {
    throw new Error('activeCardId required');
  }
  if (!isValidKeepsAction(action)) {
    throw new Error(`invalid action: ${action}`);
  }
  if (typeof salt !== 'string' || !SALT_RE.test(salt)) {
    throw new Error(`salt must be ${KEEPS_SALT_LENGTH_HEX} hex chars`);
  }
  return `${rulesHash}|${matchId}|${roundIndex}|${wallet}|${activeCardId}|${action}|${salt}`;
}

/**
 * Compute the round commit hex.
 *
 * @returns {Promise<string>} 64 lowercase hex chars
 */
export async function commitActionHex(args) {
  return sha256HexAscii(canonicalCommitInput(args));
}

/**
 * Verify a reveal against a stored commit hex. Returns true on match.
 *
 * @returns {Promise<boolean>}
 */
export async function verifyCommit({ commitHex, ...inputs }) {
  if (typeof commitHex !== 'string' || !HEX64_RE.test(commitHex)) {
    throw new Error('commitHex must be 64 hex chars');
  }
  const recomputed = await commitActionHex(inputs);
  // Constant-time-ish: hex strings are equal length; bail early only
  // on missing bytes (rare). Compare each char.
  let diff = 0;
  for (let i = 0; i < 64; i++) {
    diff |= commitHex.charCodeAt(i) ^ recomputed.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Generate a random salt suitable for a commit. Uses Web Crypto's
 * `getRandomValues`, available in browsers, Workers, and Node 19+.
 *
 * @returns {string} 32 lowercase hex chars
 */
export function randomSaltHex() {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues unavailable');
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const out = new Array(16);
  for (let i = 0; i < 16; i++) out[i] = bytes[i].toString(16).padStart(2, '0');
  return out.join('');
}

export { HEX64_RE };

// ─── lineup commit ──────────────────────────────────────────────
//
// The lineup commit hashes the ORDERED list of cardKeys plus the
// rulesHash, matchId, wallet, and a per-lineup salt. Order matters:
// lineup position determines fight order, so the same set of cards
// in a different order must produce a different commit.

/**
 * @returns {Promise<string>} 64 lowercase hex chars
 */
export async function lineupCommitHex({ rulesHash, matchId, wallet, lineupCardKeys, salt }) {
  if (typeof rulesHash !== 'string' || !HEX64_RE.test(rulesHash)) {
    throw new Error('rulesHash must be 64 hex chars');
  }
  if (typeof matchId !== 'string' || !matchId) throw new Error('matchId required');
  if (typeof wallet !== 'string' || !wallet) throw new Error('wallet required');
  if (!Array.isArray(lineupCardKeys) || lineupCardKeys.some((k) => typeof k !== 'string' || !k)) {
    throw new Error('lineupCardKeys must be non-empty strings');
  }
  if (typeof salt !== 'string' || !SALT_RE.test(salt)) {
    throw new Error(`salt must be ${KEEPS_SALT_LENGTH_HEX} hex chars`);
  }
  const canonical = `lineup|${rulesHash}|${matchId}|${wallet}|${lineupCardKeys.join(',')}|${salt}`;
  return sha256HexAscii(canonical);
}
