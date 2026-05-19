// Spaniel Wallet — BIP-39 mnemonic + SLIP-10 ed25519 HD derivation.
//
// Implemented from scratch per CLAUDE.md §0 ("No third-party npm
// runtime crypto dependencies. EVER."). Uses only:
//   * WebCrypto (`subtle.deriveBits`, `subtle.sign`, `subtle.digest`)
//   * vendored noble sha256 (vendor/noble.mjs)
//   * the canonical BIP-39 English wordlist (_bip39-english.js,
//     pinned by SHA-256)
//
// Specs followed:
//   BIP-39  https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki
//   SLIP-10 https://github.com/satoshilabs/slips/blob/master/slip-0010.md
//   BIP-44  https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki
//
// Official test vectors are checked into tests/mnemonic.test.mjs.

import { sha256 } from '../../vendor/noble.mjs';
import { BIP39_ENGLISH } from './_bip39-english.js';
import { UnsupportedEnvironmentError, InvalidAccountError } from './wallet-errors.js';

const enc = new TextEncoder();

const VALID_ENTROPY_BITS = Object.freeze([128, 160, 192, 224, 256]);
const VALID_WORD_COUNTS = Object.freeze([12, 15, 18, 21, 24]);

/** Phantom / Solflare-compatible Solana derivation path. */
export const SOLANA_BIP44_PATH = "m/44'/501'/0'/0'";

function requireSubtle() {
  const sub = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  if (!sub) throw new UnsupportedEnvironmentError('crypto.subtle');
  return sub;
}

function requireRandom() {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new UnsupportedEnvironmentError('crypto.getRandomValues');
  }
  return crypto;
}

// ─── Wordlist lookup ────────────────────────────────────────────────

// Pre-build a Map for O(1) word→index, since validateMnemonic is in
// the hot path of every wallet-unlock and every import attempt. The
// wordlist is frozen at module load; map never changes.
const WORD_TO_INDEX = (() => {
  const m = new Map();
  for (let i = 0; i < BIP39_ENGLISH.length; i++) m.set(BIP39_ENGLISH[i], i);
  return m;
})();

if (BIP39_ENGLISH.length !== 2048) {
  throw new Error(`BIP-39 wordlist must be exactly 2048 words (got ${BIP39_ENGLISH.length})`);
}

// ─── BIP-39: entropy ↔ mnemonic ─────────────────────────────────────

/**
 * Generate a fresh BIP-39 mnemonic.
 *
 * @param {object} [opts]
 * @param {12|15|18|21|24} [opts.wordCount=12]  number of words. 12
 *   gives 128 bits of entropy — the Phantom default. 24 gives 256
 *   bits, Ledger default.
 * @returns {{ mnemonic: string, words: readonly string[], entropy: Uint8Array }}
 */
export function generateMnemonic({ wordCount = 12 } = {}) {
  if (!VALID_WORD_COUNTS.includes(wordCount)) {
    throw new InvalidAccountError(`wordCount must be one of ${VALID_WORD_COUNTS.join(', ')}`);
  }
  const entropyBits = (wordCount * 11) - (wordCount / 3);
  const entropyBytes = entropyBits / 8;
  const c = requireRandom();
  const entropy = new Uint8Array(entropyBytes);
  c.getRandomValues(entropy);
  return entropyToMnemonic(entropy);
}

/**
 * Convert raw entropy bytes to a mnemonic. Length must be a multiple
 * of 4 bytes between 16 and 32.
 *
 * @param {Uint8Array} entropy
 * @returns {{ mnemonic: string, words: readonly string[], entropy: Uint8Array }}
 */
export function entropyToMnemonic(entropy) {
  if (!(entropy instanceof Uint8Array)) {
    throw new InvalidAccountError('entropy must be a Uint8Array');
  }
  const entBits = entropy.length * 8;
  if (!VALID_ENTROPY_BITS.includes(entBits)) {
    throw new InvalidAccountError(`entropy must be 16/20/24/28/32 bytes (${entropy.length} given)`);
  }
  const checksumBits = entBits / 32;
  const totalBits = entBits + checksumBits;
  // SHA-256(entropy), keep the top `checksumBits` bits.
  const hash = sha256(entropy);
  const bits = bytesToBitString(entropy) + bytesToBitString(hash).slice(0, checksumBits);
  if (bits.length !== totalBits) {
    throw new Error(`internal: expected ${totalBits} bits, got ${bits.length}`);
  }
  const wordCount = totalBits / 11;
  const words = new Array(wordCount);
  for (let i = 0; i < wordCount; i++) {
    const idx = parseInt(bits.slice(i * 11, i * 11 + 11), 2);
    words[i] = BIP39_ENGLISH[idx];
  }
  return {
    mnemonic: words.join(' '),
    words: Object.freeze(words),
    entropy,
  };
}

/**
 * Recover the original entropy from a mnemonic. Throws if the
 * mnemonic is malformed, contains an unknown word, or the checksum
 * doesn't match. Pass the same value back through `entropyToMnemonic`
 * to round-trip.
 *
 * @param {string} mnemonic
 * @returns {Uint8Array}
 */
export function mnemonicToEntropy(mnemonic) {
  const words = normalizeMnemonic(mnemonic).split(' ');
  if (!VALID_WORD_COUNTS.includes(words.length)) {
    throw new InvalidAccountError(`mnemonic must be ${VALID_WORD_COUNTS.join('/')} words (got ${words.length})`);
  }
  // Word → 11-bit index.
  let bits = '';
  for (const w of words) {
    const i = WORD_TO_INDEX.get(w);
    if (i === undefined) throw new InvalidAccountError(`unknown BIP-39 word: "${w}"`);
    bits += i.toString(2).padStart(11, '0');
  }
  const totalBits = bits.length;
  const checksumBits = totalBits % 32;
  const entBits = totalBits - checksumBits;
  if (entBits / 32 !== checksumBits) {
    throw new InvalidAccountError(`invalid mnemonic length: ${totalBits} bits`);
  }
  const entropy = bitsToBytes(bits.slice(0, entBits));
  const expectedChecksum = bytesToBitString(sha256(entropy)).slice(0, checksumBits);
  const actualChecksum = bits.slice(entBits);
  if (actualChecksum !== expectedChecksum) {
    throw new InvalidAccountError('mnemonic checksum failed — phrase has at least one wrong word');
  }
  return entropy;
}

/**
 * Cheap validity check used by the import-flow live feedback. Returns
 * `null` if the mnemonic is valid, otherwise a short user-facing
 * error string.
 *
 * @param {string} mnemonic
 * @returns {string|null}
 */
export function describeMnemonicProblem(mnemonic) {
  if (typeof mnemonic !== 'string' || mnemonic.trim().length === 0) {
    return 'Enter your 12 or 24 word recovery phrase.';
  }
  const words = normalizeMnemonic(mnemonic).split(' ');
  if (!VALID_WORD_COUNTS.includes(words.length)) {
    return `Recovery phrases are ${VALID_WORD_COUNTS.join(', ')} words. You typed ${words.length}.`;
  }
  for (const w of words) {
    if (!WORD_TO_INDEX.has(w)) return `"${w}" is not a BIP-39 word. Check spelling and lowercase.`;
  }
  try {
    mnemonicToEntropy(mnemonic);
  } catch (e) {
    return e?.message || 'Recovery phrase failed checksum.';
  }
  return null;
}

/** Normalize for BIP-39: NFKD + lowercase + single spaces. */
function normalizeMnemonic(mnemonic) {
  if (typeof mnemonic !== 'string') {
    throw new InvalidAccountError('mnemonic must be a string');
  }
  return mnemonic.normalize('NFKD').toLowerCase().trim().replace(/\s+/g, ' ');
}

// ─── BIP-39: mnemonic → 64-byte seed ────────────────────────────────

/**
 * Derive the BIP-39 seed from a mnemonic. Spec:
 *   PBKDF2-HMAC-SHA512(
 *     password = NFKD(mnemonic_words_joined_with_single_space),
 *     salt     = NFKD("mnemonic" + passphrase),
 *     c        = 2048,
 *     dkLen    = 64 bytes
 *   )
 *
 * The optional BIP-39 passphrase ("25th word") is supported but the
 * Spaniel Wallet UX defaults to empty — a BIP-39 passphrase is a
 * separate concept from the vault encryption passphrase that
 * protects the on-disk envelope, and conflating them confuses users
 * recovering elsewhere.
 *
 * @param {string} mnemonic
 * @param {string} [bip39Passphrase='']
 * @returns {Promise<Uint8Array>} 64-byte seed
 */
export async function mnemonicToSeed(mnemonic, bip39Passphrase = '') {
  const subtle = requireSubtle();
  const mn = normalizeMnemonic(mnemonic);
  const pw = enc.encode(mn);
  const salt = enc.encode('mnemonic' + (bip39Passphrase || '').normalize('NFKD'));
  const key = await subtle.importKey('raw', pw, { name: 'PBKDF2' }, false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 2048, hash: 'SHA-512' },
    key,
    64 * 8,
  );
  return new Uint8Array(bits);
}

// ─── SLIP-10 ed25519 HD derivation ──────────────────────────────────

const SLIP10_ED25519_DOMAIN = enc.encode('ed25519 seed');
const HARDENED_OFFSET = 0x80000000;

async function hmacSha512(key, data) {
  const subtle = requireSubtle();
  const k = await subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  return new Uint8Array(await subtle.sign('HMAC', k, data));
}

async function masterFromSeed(seed64) {
  if (!(seed64 instanceof Uint8Array) || seed64.length !== 64) {
    throw new InvalidAccountError('seed must be 64 bytes (BIP-39 output)');
  }
  const I = await hmacSha512(SLIP10_ED25519_DOMAIN, seed64);
  return { key: I.slice(0, 32), chainCode: I.slice(32, 64) };
}

async function childHardenedEd25519(parent, index) {
  // SLIP-10 ed25519 only supports hardened derivation: index >= 2^31.
  // Data = 0x00 || parent.key (32) || ser32(index | 0x80000000)
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(parent.key, 1);
  const idx = index >>> 0;
  data[33] = (idx >>> 24) & 0xff;
  data[34] = (idx >>> 16) & 0xff;
  data[35] = (idx >>> 8) & 0xff;
  data[36] = idx & 0xff;
  const I = await hmacSha512(parent.chainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32, 64) };
}

/**
 * Parse a BIP-44-style path string (e.g. `m/44'/501'/0'/0'`) into the
 * sequence of hardened indices for SLIP-10 ed25519. Every segment
 * must end with `'` — ed25519 only supports hardened derivation.
 *
 * @param {string} path
 * @returns {number[]}
 */
export function parseDerivationPath(path) {
  if (typeof path !== 'string') {
    throw new InvalidAccountError('derivation path must be a string');
  }
  const trimmed = path.trim();
  if (!/^m(\/\d+'?)*$/.test(trimmed)) {
    throw new InvalidAccountError(`invalid derivation path: ${path}`);
  }
  if (trimmed === 'm') return [];
  const parts = trimmed.slice(2).split('/');
  const out = [];
  for (const part of parts) {
    if (!part.endsWith("'")) {
      throw new InvalidAccountError(
        `ed25519 supports only hardened derivation — every segment must end with ' (got "${part}")`,
      );
    }
    const n = Number(part.slice(0, -1));
    if (!Number.isInteger(n) || n < 0 || n >= HARDENED_OFFSET) {
      throw new InvalidAccountError(`derivation index out of range: ${part}`);
    }
    out.push(n | HARDENED_OFFSET);
  }
  return out;
}

/**
 * Derive an ed25519 32-byte seed from a 64-byte BIP-39 seed under
 * the given SLIP-10 path (typically `m/44'/501'/0'/0'` for Solana).
 *
 * @param {Uint8Array} seed64  the 64-byte BIP-39 seed
 * @param {string} [path='m/44'/501'/0'/0''] derivation path
 * @returns {Promise<Uint8Array>} 32-byte ed25519 seed (NOT the
 *   secret key — feed into keypairFromSeed for the full keypair)
 */
export async function deriveEd25519SeedFromBip39Seed(seed64, path = SOLANA_BIP44_PATH) {
  const indices = parseDerivationPath(path);
  let node = await masterFromSeed(seed64);
  for (const idx of indices) {
    // parseDerivationPath already OR'd HARDENED_OFFSET; pass through.
    node = await childHardenedEd25519(node, idx);
  }
  return node.key;
}

// ─── helpers ───────────────────────────────────────────────────────

function bytesToBitString(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(2).padStart(8, '0');
  }
  return s;
}

function bitsToBytes(bits) {
  if (bits.length % 8 !== 0) {
    throw new Error(`bitsToBytes: ${bits.length} bits not a multiple of 8`);
  }
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return out;
}
