// ─── SHARED DATA LAYER ───────────────────────────────────────────────
//
// RETIRED — legacy PFP/ORAO path. Not used by Series 1 in production.
// The Drop PDA layout, starting_index reveal, and visual_id rotation
// described below all target the retired asm fair-launch crate. The
// Series 1 Program (see docs/ONCHAIN_MINT_REQUIREMENTS.md) replaces
// every on-chain piece of this and the hidden draw order is now a
// deterministic Feistel permutation seeded by 32 bytes of entropy
// (see docs/MANIFEST_COMMITMENT.md).
//
// Kept for now because:
//   * main.js still calls `refreshMints()` to populate the homepage's
//     `Recently Minted` panel from the legacy mints.json feed.
//   * the homepage curve preview reads `mintedCount` for its
//     remaining-supply display.
//
// Single source of truth for:
//   1. mints.json fetch cache (TTL'd)
//   2. RPC Connection singleton (one per page)
//   3. Drop on-chain state (committed_count, starting_index,
//      reveal_deadline_slot, orao_vrf_account, provenance_hash)
//   4. visual_id mapping = (token_id - 1 + starting_index) mod 69_420 + 1
//
// Failure mode: failed fetches leave the previous cache in place.

import { Connection, PublicKey } from '../vendor/web3.mjs';
import { RPC_URL, PROGRAM_ID_STR, MAX_SUPPLY } from './config.js';

const TTL_MS = 10_000;

const _state = (globalThis.__spanielData ||= {
  mints: { entries: [], lastFetch: 0, inflight: null },
  conn: null,
  dropState: new Map(),         // dropId → { committedCount, …, ts }
  dropStateInflight: new Map(),
});

async function _fetchMints() {
  const bucket = _state.mints;
  if (Date.now() - bucket.lastFetch < TTL_MS && bucket.entries.length > 0) {
    return bucket.entries;
  }
  if (bucket.inflight) return bucket.inflight;
  bucket.inflight = (async () => {
    try {
      const res = await fetch('./drops/mints.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data && Array.isArray(data.entries)) bucket.entries = data.entries;
      bucket.lastFetch = Date.now();
    } catch (_) {
      // Keep stale on failure.
    } finally {
      bucket.inflight = null;
    }
    return bucket.entries;
  })();
  return bucket.inflight;
}

export async function refreshMints() {
  return _fetchMints();
}

export function getMints() {
  return _state.mints.entries;
}

export function getConnection() {
  if (_state.conn) return _state.conn;
  // Pre-launch (placeholder config) ships with an empty rpcUrl.
  // web3.js's Connection constructor refuses empty strings and throws
  // "Endpoint URL must start with `http:` or `https:`." which spreads
  // through every caller. Substitute a sentinel that's a valid URL
  // shape but unreachable — any actual network call will fail and
  // each caller's existing try/catch handles it cleanly.
  const url = RPC_URL || 'https://localhost.invalid';
  _state.conn = new Connection(url, 'confirmed');
  return _state.conn;
}

/**
 * Drop PDA derivation. Matches the program's
 * [b"drop", drop_id.to_le_bytes()] seed.
 */
export function deriveDropPda(dropId) {
  const programId = new PublicKey(PROGRAM_ID_STR);
  const seedTag = new TextEncoder().encode('drop');
  const dropIdLe = new Uint8Array(8);
  new DataView(dropIdLe.buffer).setBigUint64(0, BigInt(dropId), true);
  return PublicKey.findProgramAddressSync([seedTag, dropIdLe], programId);
}

// ─── Drop PDA reader ────────────────────────────────────────────────
// 352-byte repr(C) layout, mirrored from the deployed program's Drop
// account. Account tag at offset 0 is 1 for Drop; refuse anything else.

const ACCOUNT_TAG_DROP = 1;
const DROP_SIZE = 352;

const OFF_BUMP = 1;
const OFF_REVOKED = 3;
const OFF_DROP_ID = 8;
const OFF_COMMITTED_COUNT = 16;
const OFF_AUTHORITY = 40;
const OFF_TREASURY = 72;
const OFF_COLLECTION = 104;
const OFF_METADATA_BASE_URI_LEN = 168;
const OFF_METADATA_BASE_URI = 169;
const OFF_PROVENANCE_HASH = 272;
const OFF_STARTING_INDEX = 304;
const OFF_REVEAL_DEADLINE_SLOT = 312;
const OFF_ORAO_VRF_ACCOUNT = 320;

/**
 * Parse a Drop PDA's raw bytes into a structured object. Throws if
 * the account isn't a Drop or is undersize.
 *
 * Returns:
 *   {
 *     bump: number,
 *     revoked: boolean,
 *     dropId: bigint,
 *     committedCount: bigint,
 *     authority: PublicKey,
 *     treasury: PublicKey,
 *     collection: PublicKey,
 *     metadataBaseUri: string,
 *     provenanceHash: Uint8Array,    // 32 bytes
 *     startingIndex: bigint,         // 0 = unrevealed
 *     revealDeadlineSlot: bigint,
 *     oraoVrfAccount: Uint8Array,    // 32 bytes; all zero until requested
 *   }
 */
export function parseDropState(buf) {
  if (!buf || buf.length < DROP_SIZE) {
    throw new Error(`Drop account undersize: ${buf?.length || 0} < ${DROP_SIZE}`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint8(0) !== ACCOUNT_TAG_DROP) {
    throw new Error('Not a Drop account');
  }
  const uriLen = view.getUint8(OFF_METADATA_BASE_URI_LEN);
  const uri = new TextDecoder().decode(
    buf.slice(OFF_METADATA_BASE_URI, OFF_METADATA_BASE_URI + uriLen),
  );
  return {
    bump: view.getUint8(OFF_BUMP),
    revoked: view.getUint8(OFF_REVOKED) === 1,
    dropId: view.getBigUint64(OFF_DROP_ID, true),
    committedCount: view.getBigUint64(OFF_COMMITTED_COUNT, true),
    authority: new PublicKey(buf.slice(OFF_AUTHORITY, OFF_AUTHORITY + 32)),
    treasury: new PublicKey(buf.slice(OFF_TREASURY, OFF_TREASURY + 32)),
    collection: new PublicKey(buf.slice(OFF_COLLECTION, OFF_COLLECTION + 32)),
    metadataBaseUri: uri,
    provenanceHash: buf.slice(OFF_PROVENANCE_HASH, OFF_PROVENANCE_HASH + 32),
    startingIndex: view.getBigUint64(OFF_STARTING_INDEX, true),
    revealDeadlineSlot: view.getBigUint64(OFF_REVEAL_DEADLINE_SLOT, true),
    oraoVrfAccount: buf.slice(OFF_ORAO_VRF_ACCOUNT, OFF_ORAO_VRF_ACCOUNT + 32),
  };
}

/**
 * Compute the visual_id for a given token_id once the drop has been
 * revealed. Returns `null` if `startingIndex == 0` (drop is still in
 * the blind-mint phase — render the placeholder image).
 *
 * The formula is the starting_index rotation:
 *
 *     visual_id = ((token_id - 1 + starting_index) mod N) + 1
 *
 * with N = MAX_SUPPLY = 69,420. A rotation of {1..N} is a permutation,
 * so the mapping is bijective by construction.
 *
 * Accepts BigInt or Number for either arg.
 */
export function computeVisualId(tokenId, startingIndex) {
  const idx = BigInt(startingIndex);
  if (idx === 0n) return null;
  const tid = BigInt(tokenId);
  if (tid < 1n) return null;
  const n = BigInt(MAX_SUPPLY);
  const v = ((tid - 1n + idx) % n) + 1n;
  // Safe-Number range: 1..69_420 fits easily inside 53 bits.
  return Number(v);
}
