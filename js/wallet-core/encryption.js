// Spaniel Wallet — vault encryption.
//
// Uses WebCrypto AES-256-GCM with a PBKDF2-SHA-256-derived key. The
// PBKDF2 iteration count is configurable so we can raise it over
// time without breaking older vaults (each envelope stores its own
// iteration count).
//
// Envelope shape (JSON-serializable):
//   {
//     v:    1,                            // envelope version
//     alg:  'AES-256-GCM',
//     kdf:  { name: 'PBKDF2', hash: 'SHA-256', iterations: N, saltB64 },
//     ivB64,                              // 12-byte AES-GCM IV
//     ctB64                               // ciphertext+tag
//   }
//
// We never use localStorage for vault data; the PWA stores the
// envelope in IndexedDB. Tests use an in-memory adapter (see
// storage.js) — encryption itself is environment-agnostic.

import {
  UnsupportedEnvironmentError,
  VaultCorruptError,
  InvalidPassphraseError
} from './wallet-errors.js';

const VAULT_VERSION = 1;
const DEFAULT_ITERATIONS = 600_000;
const ALG = 'AES-256-GCM';
const HASH = 'SHA-256';
const IV_BYTES = 12;
const SALT_BYTES = 16;

function requireSubtle() {
  const sub = (typeof crypto !== 'undefined' && crypto.subtle) ? crypto.subtle : null;
  if (!sub) throw new UnsupportedEnvironmentError('crypto.subtle');
  return sub;
}

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return typeof btoa === 'function'
    ? btoa(s)
    : Buffer.from(bytes).toString('base64');
}

function b64ToBytes(b64) {
  if (typeof atob === 'function') {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(passphrase, salt, iterations) {
  const subtle = requireSubtle();
  const pwKey = await subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: HASH },
    pwKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a UTF-8 plaintext under the passphrase.
 * @param {string} plaintext
 * @param {string} passphrase
 * @param {{ iterations?: number, salt?: Uint8Array, iv?: Uint8Array }} [opts]
 * @returns {Promise<object>} envelope
 */
export async function encryptVault(plaintext, passphrase, opts = {}) {
  if (typeof plaintext !== 'string') throw new TypeError('plaintext must be string');
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new TypeError('passphrase must be non-empty string');
  }
  const subtle = requireSubtle();
  const iterations = opts.iterations ?? DEFAULT_ITERATIONS;
  const salt = opts.salt ?? randomBytes(SALT_BYTES);
  const iv = opts.iv ?? randomBytes(IV_BYTES);

  const key = await deriveKey(passphrase, salt, iterations);
  const ctBuf = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return {
    v: VAULT_VERSION,
    alg: ALG,
    kdf: { name: 'PBKDF2', hash: HASH, iterations, saltB64: bytesToB64(salt) },
    ivB64: bytesToB64(iv),
    ctB64: bytesToB64(new Uint8Array(ctBuf))
  };
}

/**
 * Decrypt an envelope. Throws InvalidPassphraseError on bad password.
 * @returns {Promise<string>}
 */
export async function decryptVault(envelope, passphrase) {
  if (!envelope || typeof envelope !== 'object') {
    throw new VaultCorruptError('envelope is not an object');
  }
  if (envelope.v !== VAULT_VERSION) {
    throw new VaultCorruptError(`unknown envelope version ${envelope.v}`);
  }
  if (envelope.alg !== ALG) {
    throw new VaultCorruptError(`unsupported alg ${envelope.alg}`);
  }
  if (!envelope.kdf || envelope.kdf.name !== 'PBKDF2' || envelope.kdf.hash !== HASH) {
    throw new VaultCorruptError('unsupported KDF');
  }
  const iterations = Number(envelope.kdf.iterations);
  if (!Number.isFinite(iterations) || iterations < 10_000) {
    throw new VaultCorruptError('iteration count out of range');
  }

  let salt, iv, ct;
  try {
    salt = b64ToBytes(envelope.kdf.saltB64);
    iv = b64ToBytes(envelope.ivB64);
    ct = b64ToBytes(envelope.ctB64);
  } catch (e) {
    throw new VaultCorruptError('base64 decode failed');
  }

  const subtle = requireSubtle();
  const key = await deriveKey(passphrase, salt, iterations);
  let ptBuf;
  try {
    ptBuf = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  } catch {
    // AES-GCM auth failure ⇒ wrong passphrase or tampering. We can't
    // distinguish; the user-facing error is identical in either case.
    throw new InvalidPassphraseError();
  }
  return dec.decode(new Uint8Array(ptBuf));
}

function randomBytes(n) {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new UnsupportedEnvironmentError('crypto.getRandomValues');
  }
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export const ENCRYPTION_INFO = Object.freeze({
  version: VAULT_VERSION,
  alg: ALG,
  kdf: 'PBKDF2',
  hash: HASH,
  defaultIterations: DEFAULT_ITERATIONS,
  ivBytes: IV_BYTES,
  saltBytes: SALT_BYTES
});
