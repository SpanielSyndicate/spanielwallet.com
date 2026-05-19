// Spaniel Wallet — signing.
//
// Pure ed25519 signing for messages and serialized transactions.
// Callers MUST hand us the canonical seed (32 bytes) and the bytes
// to sign; we never touch transaction-shape logic here. Higher-level
// builders live in transactions.js / send.js.
//
// Public surface:
//   - signMessage(seed, message: Uint8Array|string) → 64-byte signature
//   - verifyMessage(pubkey, message, signature) → boolean
//   - signTransactionBytes(seed, txMessageBytes) → signature for the
//     transaction's compiled message (see transactions.js for the
//     legacy-tx framing this is dropped into)
//
// Worker auth flow ("Sign-In-With-Solana") uses signMessage with a
// short randomly-generated nonce; the Worker verifies on receive.

import { ed25519 } from '../../vendor/noble.mjs';
import { InvalidAccountError } from './wallet-errors.js';
import { SEED_BYTES, PUBLIC_KEY_BYTES } from './keygen.js';

const enc = new TextEncoder();

function toBytes(input, name) {
  if (input instanceof Uint8Array) return input;
  if (typeof input === 'string') return enc.encode(input);
  throw new InvalidAccountError(`${name} must be Uint8Array or string`);
}

export function signMessage(seed, message) {
  if (!(seed instanceof Uint8Array) || seed.length !== SEED_BYTES) {
    throw new InvalidAccountError(`seed must be ${SEED_BYTES} bytes`);
  }
  const msg = toBytes(message, 'message');
  return ed25519.sign(msg, seed);
}

export function verifyMessage(publicKey, message, signature) {
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== PUBLIC_KEY_BYTES) {
    throw new InvalidAccountError(`publicKey must be ${PUBLIC_KEY_BYTES} bytes`);
  }
  if (!(signature instanceof Uint8Array) || signature.length !== 64) {
    throw new InvalidAccountError('signature must be 64 bytes');
  }
  const msg = toBytes(message, 'message');
  try {
    return ed25519.verify(signature, msg, publicKey);
  } catch {
    return false;
  }
}

export function signTransactionBytes(seed, messageBytes) {
  if (!(messageBytes instanceof Uint8Array)) {
    throw new InvalidAccountError('messageBytes must be Uint8Array');
  }
  return signMessage(seed, messageBytes);
}
