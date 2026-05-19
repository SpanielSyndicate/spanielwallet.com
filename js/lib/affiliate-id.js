// Affiliate ID generator and validator.
//
// Format: bark_<8 chars from unambiguous alphabet>
// Alphabet: a-z (excluding o, l, i) + 2-9 (excluding 0, 1) = 31 chars.
// Total possible suffixes: 31^8 ≈ 8.5e11.
//
// Rules:
//   - System-generated only. Users cannot pick or edit.
//   - One wallet → one active affiliate ID, permanently.
//   - URL-safe, lowercase only.
//   - Visually unambiguous (no 0/o, 1/l/i).

export const AFFILIATE_ID_PREFIX = 'bark_';
export const AFFILIATE_ID_SUFFIX_LENGTH = 8;
export const AFFILIATE_ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const ALPHABET_LENGTH = AFFILIATE_ID_ALPHABET.length;
const VALID_RE = new RegExp(`^${AFFILIATE_ID_PREFIX}[${AFFILIATE_ID_ALPHABET}]{${AFFILIATE_ID_SUFFIX_LENGTH}}$`);

if (ALPHABET_LENGTH !== 31) {
  throw new Error(`affiliate-id alphabet length must be 31, got ${ALPHABET_LENGTH}`);
}

/**
 * Generate a fresh affiliate ID using cryptographic randomness.
 * @returns {string} e.g. "bark_7g8kq2mx"
 */
export function generateAffiliateId() {
  const suffix = randomSuffix(AFFILIATE_ID_SUFFIX_LENGTH);
  return AFFILIATE_ID_PREFIX + suffix;
}

/**
 * Validate that a string is a properly-formatted affiliate ID.
 * @param {unknown} id
 * @returns {boolean}
 */
export function isValidAffiliateId(id) {
  if (typeof id !== 'string') return false;
  if (id.length !== AFFILIATE_ID_PREFIX.length + AFFILIATE_ID_SUFFIX_LENGTH) return false;
  return VALID_RE.test(id);
}

/**
 * Extract the suffix from an affiliate ID. Returns null on invalid input.
 * @param {string} id
 * @returns {string|null}
 */
export function parseAffiliateIdSuffix(id) {
  if (!isValidAffiliateId(id)) return null;
  return id.slice(AFFILIATE_ID_PREFIX.length);
}

/**
 * Normalize a candidate referral ID from URL/query input. Trims and
 * lowercases. Returns null if it doesn't validate.
 * @param {string} raw
 * @returns {string|null}
 */
export function normalizeReferralId(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  return isValidAffiliateId(trimmed) ? trimmed : null;
}

// ────────────────────────────────────────────────────────────────────
// random suffix — portable (Node, browser, Worker)
// ────────────────────────────────────────────────────────────────────

function randomSuffix(len) {
  const bytes = randomBytes(len * 2);
  let out = '';
  // Use rejection sampling for uniform distribution.
  // ceil(256/31) * 31 = 248. Reject bytes >= 248.
  for (let i = 0; i < bytes.length && out.length < len; i++) {
    const b = bytes[i];
    if (b < 248) {
      out += AFFILIATE_ID_ALPHABET[b % ALPHABET_LENGTH];
    }
  }
  if (out.length < len) {
    // Extremely unlikely: refill and try again. Recursion bounded by
    // ~3% rejection rate, so practically never fires past once.
    return out + randomSuffix(len - out.length);
  }
  return out;
}

function randomBytes(len) {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint8Array(len));
  }
  // Pre-19 Node.js fallback — practically never fires in modern
  // environments (browsers, Workers, Deno, Bun, Node ≥19 all expose
  // `globalThis.crypto`). The Node module is loaded once at module
  // evaluation but wrapped so a missing `node:crypto` (Cloudflare
  // Workers without nodejs_compat) reports a clear failure mode
  // instead of an unhandled rejection in the import graph.
  if (!_nodeRandomBytes) {
    throw new Error(
      'affiliate-id: no CSPRNG available — globalThis.crypto is missing ' +
      'and node:crypto failed to load at module evaluation time.'
    );
  }
  return new Uint8Array(_nodeRandomBytes(len));
}

let _nodeRandomBytes = null;
if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.getRandomValues) {
  try {
    const mod = await import('node:crypto');
    _nodeRandomBytes = mod.randomBytes;
  } catch {
    // Leave _nodeRandomBytes null — randomBytes() will throw the clear
    // diagnostic when invoked, instead of crashing the import graph.
  }
}
