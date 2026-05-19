// Tiny shared hash helpers.
//
// FNV-1a-32 is used by the visual renderer (pixel-background.js) and
// the personality / backstory generator (personality.js). Both call
// sites need identical output to keep deterministic card content
// stable, so the implementation lives here as a single source of
// truth. Renaming, re-tuning, or changing the seed constants is a
// breaking change and would invalidate every manifest commitment
// that has been generated.

const FNV32_OFFSET = 0x811c9dc5;
const FNV32_PRIME = 0x01000193;

/**
 * FNV-1a 32-bit hash over a UTF-16-like string. Matches the spec
 * exactly. Returns an unsigned 32-bit number.
 */
export function fnv32(input) {
  const str = String(input ?? '');
  let h = FNV32_OFFSET >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i) & 0xff;
    h = Math.imul(h, FNV32_PRIME) >>> 0;
  }
  return h;
}

export { FNV32_OFFSET, FNV32_PRIME };

// ─── sha256 over ASCII / UTF-8 text ─────────────────────────────
//
// Used by the For Keeps rules-hash and commit-reveal helpers.
// Async because we route through WebCrypto's subtle.digest, which is
// available in browsers, Cloudflare Workers, and Node 19+. Output is
// 64 lowercase hex chars.

const TEXT_ENC = new TextEncoder();
const SUBTLE = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;

function bytesToHexLower(bytes) {
  const out = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i].toString(16).padStart(2, '0');
  }
  return out.join('');
}

/**
 * SHA-256 over UTF-8 bytes of `input`, returning 64 lowercase hex
 * chars. Both frontend and Worker use this for the rules hash so
 * the values agree byte-for-byte.
 *
 * @param {string} input
 * @returns {Promise<string>}
 */
export async function sha256HexAscii(input) {
  if (typeof input !== 'string') throw new TypeError('sha256HexAscii: input must be string');
  if (!SUBTLE) throw new Error('SubtleCrypto unavailable');
  const buf = await SUBTLE.digest('SHA-256', TEXT_ENC.encode(input));
  return bytesToHexLower(new Uint8Array(buf));
}

/**
 * SHA-256 over Uint8Array bytes, returning 64 lowercase hex chars.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function sha256HexBytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('sha256HexBytes: input must be Uint8Array');
  if (!SUBTLE) throw new Error('SubtleCrypto unavailable');
  const buf = await SUBTLE.digest('SHA-256', bytes);
  return bytesToHexLower(new Uint8Array(buf));
}
