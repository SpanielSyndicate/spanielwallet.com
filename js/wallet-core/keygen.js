// Spaniel Wallet — ed25519 keypair generation.
//
// Solana keypairs are ed25519. Our internal representation matches the
// Solana convention:
//
//   secretKey  — 64 bytes (32-byte seed + 32-byte public key)
//   seed       — 32-byte seed (also called 'private key')
//   publicKey  — 32 bytes
//   pubkeyBase58 — Solana address string
//
// Implementations:
//   - browser/Node 22+: use vendored @noble/curves/ed25519 (tiny, audited).
//   - WebCrypto for crypto.getRandomValues() seed entropy.
//
// All callers MUST treat seed/secretKey as a secret. The vault encrypts
// the seed only; we recompute the public key on unlock.

import { ed25519 } from '../../vendor/noble.mjs';
import { encodeBase58 } from './base58.js';
import { UnsupportedEnvironmentError, InvalidAccountError } from './wallet-errors.js';

export const SEED_BYTES = 32;
export const SECRET_KEY_BYTES = 64;
export const PUBLIC_KEY_BYTES = 32;

function requireCrypto() {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new UnsupportedEnvironmentError('crypto.getRandomValues');
  }
  return crypto;
}

export function randomSeed() {
  const c = requireCrypto();
  const seed = new Uint8Array(SEED_BYTES);
  c.getRandomValues(seed);
  return seed;
}

export function keypairFromSeed(seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== SEED_BYTES) {
    throw new InvalidAccountError(`seed must be ${SEED_BYTES} bytes`);
  }
  const publicKey = ed25519.getPublicKey(seed);
  const secretKey = new Uint8Array(SECRET_KEY_BYTES);
  secretKey.set(seed, 0);
  secretKey.set(publicKey, SEED_BYTES);
  return {
    seed,
    secretKey,
    publicKey,
    pubkeyBase58: encodeBase58(publicKey)
  };
}

export function generateKeypair() {
  return keypairFromSeed(randomSeed());
}

export function publicKeyFromSeed(seed) {
  return keypairFromSeed(seed).publicKey;
}

export function pubkeyBase58FromSeed(seed) {
  return keypairFromSeed(seed).pubkeyBase58;
}

/**
 * Parse a Solana-style 64-byte secretKey (seed||pubkey) and return the
 * canonical keypair. Used during the "import existing wallet" flow.
 */
export function keypairFromSecretKey(secretKey) {
  if (!(secretKey instanceof Uint8Array) || secretKey.length !== SECRET_KEY_BYTES) {
    throw new InvalidAccountError(`secretKey must be ${SECRET_KEY_BYTES} bytes`);
  }
  const seed = secretKey.slice(0, SEED_BYTES);
  const kp = keypairFromSeed(seed);
  // Sanity check: caller-supplied pubkey tail must match derived pubkey.
  for (let i = 0; i < PUBLIC_KEY_BYTES; i++) {
    if (kp.publicKey[i] !== secretKey[SEED_BYTES + i]) {
      throw new InvalidAccountError('secretKey tail does not match derived public key');
    }
  }
  return kp;
}
