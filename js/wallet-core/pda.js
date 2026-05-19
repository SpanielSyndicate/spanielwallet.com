// Spaniel Wallet — Program-Derived Address (PDA) derivation.
//
// Pure JS implementation of Solana's `findProgramAddress`. Mirrors
// the on-chain Pubkey::find_program_address algorithm:
//
//   for bump in (255 .. 0):
//       candidate = sha256(seeds || bump || program_id || "ProgramDerivedAddress")
//       if not on_curve(candidate):
//           return (candidate, bump)
//
// "on_curve" means decodable as a valid ed25519 compressed public
// key — i.e. the 32 bytes correspond to a real curve point. A PDA
// is intentionally off the curve so no private key can ever exist.
//
// We use the vendored @noble/curves/ed25519 to test curve membership:
// the `Point.fromHex(bytes)` call throws on off-curve input.
//
// Performance: each iteration is ONE sha256 + a single point-decode
// attempt. In practice ~1–2 iterations suffice for a random seed
// set; we hard-cap at 256 attempts.

import { ed25519, sha256 } from '../../vendor/noble.mjs';
import { decodeBase58, encodeBase58, isValidBase58Pubkey } from './base58.js';
import { InvalidAccountError } from './wallet-errors.js';

const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');
const PDA_MARKER_LEN = PDA_MARKER.length;
const MAX_SEED_LEN = 32;
const MAX_SEED_COUNT = 16;

function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function toBytes(seed, index) {
  if (seed instanceof Uint8Array) return seed;
  if (typeof seed === 'string') {
    // Treat strings as UTF-8 seed material (matches Rust b"..").
    return new TextEncoder().encode(seed);
  }
  throw new InvalidAccountError(`seed[${index}] must be Uint8Array or string`);
}

function isOnEd25519Curve(bytes32) {
  try {
    // `Point.fromHex` validates the y-coordinate against the curve
    // equation; if the bytes don't decode to a valid point it throws.
    ed25519.Point.fromHex(bytes32);
    return true;
  } catch {
    return false;
  }
}

function programIdToBytes(programId) {
  if (programId instanceof Uint8Array) {
    if (programId.length !== 32) {
      throw new InvalidAccountError('programId bytes must be length 32');
    }
    return programId;
  }
  if (typeof programId === 'string') {
    if (!isValidBase58Pubkey(programId)) {
      throw new InvalidAccountError('programId must be a valid base58 pubkey');
    }
    return decodeBase58(programId);
  }
  throw new InvalidAccountError('programId must be base58 string or 32 bytes');
}

/**
 * Find a Program-Derived Address.
 *
 * @param {Array<Uint8Array|string>} seeds
 * @param {Uint8Array|string} programId  base58 or 32 bytes
 * @returns {{ pubkey: Uint8Array, pubkeyBase58: string, bump: number }}
 */
export function findProgramAddress(seeds, programId) {
  if (!Array.isArray(seeds)) {
    throw new InvalidAccountError('seeds must be an array');
  }
  if (seeds.length > MAX_SEED_COUNT) {
    throw new InvalidAccountError(`too many seeds (max ${MAX_SEED_COUNT})`);
  }
  const seedBytes = seeds.map((s, i) => {
    const b = toBytes(s, i);
    if (b.length > MAX_SEED_LEN) {
      throw new InvalidAccountError(`seed[${i}] longer than ${MAX_SEED_LEN}`);
    }
    return b;
  });
  const programIdBytes = programIdToBytes(programId);

  for (let bump = 255; bump >= 0; bump--) {
    const parts = [
      ...seedBytes,
      Uint8Array.of(bump),
      programIdBytes,
      PDA_MARKER,
    ];
    const hash = sha256(concatBytes(parts));
    if (!isOnEd25519Curve(hash)) {
      return {
        pubkey: hash,
        pubkeyBase58: encodeBase58(hash),
        bump,
      };
    }
  }
  // Statistically impossible — every seed combo has off-curve bumps.
  throw new InvalidAccountError('findProgramAddress: no off-curve bump found');
}

/**
 * Promise-shaped wrapper so callers that follow the
 * `(seeds, programIdBytes) => Promise<{pubkey, bump}>` contract used
 * by `js/lib/series1-program.js::deriveSpanielCoinAuthorityPda` work
 * directly. Always sync under the hood.
 */
export async function findProgramAddressAsync(seeds, programIdBytes) {
  return findProgramAddress(seeds, programIdBytes);
}

// Internal exports for testing.
export const _internal = {
  PDA_MARKER,
  PDA_MARKER_LEN,
  MAX_SEED_LEN,
  MAX_SEED_COUNT,
  isOnEd25519Curve,
};
