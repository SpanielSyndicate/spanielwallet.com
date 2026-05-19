// Series 1 Program — Spaniel Showdown For Keeps surface.
//
// Discriminators + PDA seeds for the keeps_* handlers (disc 20..29).
// Mirrors `programs/spaniel_series1/src/state.rs` and
// `programs/spaniel_series1/src/lib.rs` — any drift between this file
// and the Rust source MUST surface as a failing test.
//
// PDA derivation here is dependency-injected: callers supply a
// `findProgramAddress(seeds, programIdBytes)` function so this module
// stays free of crypto/curve imports (the Worker uses
// `worker/src/lib/pda-derive.js`; the Wallet PWA uses
// `js/spaniel-wallet/findProgramAddress.js`).
//
// Account-shape descriptors live alongside the existing Series 1
// shapes in series1-program.js. The Series 1 Program escrow CPI is
// gated behind `SettlementCpiPending` (101) in every handler, so
// callers MUST treat lock/claim transactions as "build but never
// submit" until the gate flips.

const SERIES_ID_DEFAULT = 's1';

// ── Discriminators (matches programs/spaniel_series1/src/lib.rs) ──
export const SERIES1_KEEPS_IX = Object.freeze({
  KEEPS_CREATE_MATCH:   20,
  KEEPS_JOIN_MATCH:     21,
  KEEPS_LOCK_LINEUP:    22,
  KEEPS_CANCEL:         23,
  KEEPS_COMMIT_ROUND:   24,
  KEEPS_REVEAL_ROUND:   25,
  KEEPS_RESOLVE_ROUND:  26,
  KEEPS_CLAIM_PRIZE:    27,
  KEEPS_FORFEIT_TIMEOUT:28,
  KEEPS_CLOSE_MATCH:    29
});

// ── PDA seeds (matches programs/spaniel_series1/src/state.rs) ────
export const SERIES1_KEEPS_SEEDS = Object.freeze({
  /** PDA seed for the per-match MatchState account. */
  KEEPS_MATCH: new TextEncoder().encode('keeps_match'),
  /** PDA seed for the per-card escrow account (multiple per match). */
  KEEPS_ESCROW: new TextEncoder().encode('keeps_escrow')
});

/** Account-tag byte stored at offset 0 of every MatchState account. */
export const ACCOUNT_TAG_KEEPS_MATCH = 4;

/** Bytes the program writes into MatchState at init time. */
export const KEEPS_MATCH_STATE_SIZE = 256;

/** Status byte values written into MatchState.status (offset 3). */
export const KEEPS_MATCH_STATUS_BYTE = Object.freeze({
  CREATED:   0,
  JOINED:    1,
  LOCKED:    2,
  ACTIVE:    3,
  COMPLETED: 4,
  CLAIMED:   5,
  CANCELLED: 6,
  FORFEITED: 7,
  TIMED_OUT: 8
});

/** Prize-rule byte values written into MatchState.prize_rule (offset 5). */
export const KEEPS_PRIZE_RULE_BYTE = Object.freeze({
  WINNER_PICK_ONE: 0
});

// ─── PDA derivation helpers ──────────────────────────────────────

function toBytesUtf8(s) {
  if (s instanceof Uint8Array) return s;
  return new TextEncoder().encode(String(s));
}

function matchIdSeedBytes(matchId) {
  if (matchId instanceof Uint8Array) {
    if (matchId.length !== 16) {
      throw new Error(`matchId bytes must be 16 (got ${matchId.length})`);
    }
    return matchId;
  }
  if (typeof matchId !== 'string') {
    throw new Error('matchId must be string (uuid) or 16-byte Uint8Array');
  }
  // Accept either 16 raw hex (32 hex chars no dashes) or canonical
  // 36-char uuid with dashes. The Worker stores matchId as a uuidv4
  // string today — both forms decode to the same 16 bytes on-chain.
  const hex = matchId.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error('matchId must be a uuid (32 hex chars after stripping dashes)');
  }
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function programIdBytesOrThrow(programId, findProgramAddress) {
  if (typeof findProgramAddress !== 'function') {
    throw new Error('deriveKeepsMatchPda: findProgramAddress fn required');
  }
  if (!programId) throw new Error('programId required');
}

/**
 * Derive the MatchState PDA for a given matchId.
 *
 * Seeds (mirrors `programs/spaniel_series1/src/state.rs` KEEPS_MATCH_SEED):
 *   [ b"keeps_match", matchId(16 bytes) ]
 *
 * @param {object} args
 * @param {string|Uint8Array} args.programId   Series 1 Program id (base58 or 32 bytes)
 * @param {string|Uint8Array} args.matchId     uuid string OR 16 raw bytes
 * @param {Function}          args.findProgramAddress  (seeds, programIdBytes) → { pubkey, bump }
 * @returns {{ pubkey: Uint8Array, pubkeyBase58?: string, bump: number }}
 */
export function deriveKeepsMatchPda({ programId, matchId, findProgramAddress }) {
  programIdBytesOrThrow(programId, findProgramAddress);
  const idBytes = matchIdSeedBytes(matchId);
  const seeds = [SERIES1_KEEPS_SEEDS.KEEPS_MATCH, idBytes];
  return findProgramAddress(seeds, programId);
}

/**
 * Derive a per-card escrow PDA. Multiple escrow PDAs share a match —
 * one per locked card. Seeds:
 *   [ b"keeps_escrow", matchId(16 bytes), seat(1 byte), lineupPosition(1 byte) ]
 *
 * `seat` is 0 for A (host), 1 for B (guest). `lineupPosition` is
 * 0..(matchSize-1).
 *
 * The on-chain handler (`keeps_lock_lineup`) verifies the bump
 * against this derivation, so wrong seeds → AccountAddressMismatch.
 *
 * @param {object} args
 * @param {string|Uint8Array} args.programId
 * @param {string|Uint8Array} args.matchId
 * @param {'A'|'B'|number}    args.seat
 * @param {number}            args.lineupPosition
 * @param {Function}          args.findProgramAddress
 * @returns {{ pubkey: Uint8Array, pubkeyBase58?: string, bump: number }}
 */
export function deriveKeepsEscrowPda({ programId, matchId, seat, lineupPosition, findProgramAddress }) {
  programIdBytesOrThrow(programId, findProgramAddress);
  const idBytes = matchIdSeedBytes(matchId);
  const seatByte = seatToByte(seat);
  if (!Number.isInteger(lineupPosition) || lineupPosition < 0 || lineupPosition > 0xff) {
    throw new Error(`lineupPosition must be 0..255 (got ${lineupPosition})`);
  }
  const seeds = [
    SERIES1_KEEPS_SEEDS.KEEPS_ESCROW,
    idBytes,
    Uint8Array.of(seatByte),
    Uint8Array.of(lineupPosition)
  ];
  return findProgramAddress(seeds, programId);
}

function seatToByte(seat) {
  if (seat === 'A' || seat === 0) return 0;
  if (seat === 'B' || seat === 1) return 1;
  throw new Error(`seat must be 'A'|'B'|0|1 (got ${seat})`);
}

// ─── ESCROW_CPI_PENDING response envelope ────────────────────────
//
// Until the asset-transfer CPI lands in the Series 1 Program, the
// Worker's keeps lock + claim handlers MUST return a structured
// "not yet" payload instead of pretending the on-chain side succeeded.
// The envelope below is what the Worker emits and the PWA renders.

export const KEEPS_ESCROW_CPI_PENDING_CODE = 'KEEPS_ESCROW_CPI_PENDING';

/**
 * Build the standard "not yet" envelope for any keeps endpoint whose
 * on-chain leg is still gated. Callers pass the expected PDAs +
 * any context the UI should display so the player understands what
 * will happen once the gate flips.
 *
 * @param {object} args
 * @param {string} args.action      'lock' | 'claim'
 * @param {string} args.matchId
 * @param {Array}  args.expected    list of { name, pubkeyBase58 } accounts
 * @param {string} [args.message]
 * @returns {object}
 */
export function buildEscrowCpiPendingPayload({ action, matchId, expected, message }) {
  return {
    code: KEEPS_ESCROW_CPI_PENDING_CODE,
    action,
    matchId,
    expectedAccounts: Array.isArray(expected) ? expected.slice() : [],
    message: message ||
      'Series 1 Program asset-transfer CPI not yet shipped — no cards moved on chain.'
  };
}

export { SERIES_ID_DEFAULT };
