// Spaniel Showdown — For Keeps match formats.
//
// For Keeps launches with exactly four allowed match sizes:
//
//   2  — beginner-friendly best-of-a-few
//   4  — quick lunch-break match
//   8  — meaningful tournament size
//  16  — launch cap; complex but not brain-melting
//
// Sizes 1 / 3 / 5 / 6 / 12 / 32 / 64 / 100 are rejected. Validation
// is shared by frontend, Worker, and (eventually) the on-chain
// MatchState init handler.

export const KEEPS_FORMATS_VERSION = 'showdown-for-keeps-formats-v1';

/** Allowed match sizes (ordered ascending). */
export const KEEPS_MATCH_SIZES = Object.freeze([2, 4, 8, 16]);

/** Hard upper bound enforced at construction time and on the wire. */
export const KEEPS_MATCH_SIZE_MAX = 16;

/**
 * @param {number} n
 * @returns {boolean}
 */
export function isValidKeepsMatchSize(n) {
  if (!Number.isInteger(n)) return false;
  return KEEPS_MATCH_SIZES.includes(n);
}

/**
 * @param {number} n
 * @throws {Error} if the size is not on the launch allow-list
 */
export function assertValidKeepsMatchSize(n) {
  if (!isValidKeepsMatchSize(n)) {
    throw new Error(
      `For Keeps match size must be one of ${KEEPS_MATCH_SIZES.join('/')} ` +
      `(got ${typeof n === 'number' ? n : typeof n})`
    );
  }
}

/**
 * Prize rule enum. Launch ships exactly one rule (`winner_pick_one`)
 * — winner chooses one card from the loser's locked lineup. The
 * other enum variants are reserved for future formats and are NOT
 * accepted by validation at launch.
 */
export const KEEPS_PRIZE_RULES = Object.freeze({
  winner_pick_one: 'winner_pick_one'
  // winner_takes_all: 'winner_takes_all' — intentionally NOT shipped at launch
});

export const DEFAULT_KEEPS_PRIZE_RULE = KEEPS_PRIZE_RULES.winner_pick_one;

/**
 * @param {string} rule
 * @returns {boolean}
 */
export function isValidKeepsPrizeRule(rule) {
  return Object.prototype.hasOwnProperty.call(KEEPS_PRIZE_RULES, rule);
}

/**
 * @param {string} rule
 */
export function assertValidKeepsPrizeRule(rule) {
  if (!isValidKeepsPrizeRule(rule)) {
    throw new Error(`unknown For Keeps prize rule: ${rule}`);
  }
}

// ─── slot timing defaults ──────────────────────────────────────
//
// Solana mainnet slots are ~400ms. 150 slots ≈ 60s — a tight but
// human window. Devnet matches use the same defaults; if the
// operator wants longer windows for testing, they pass override
// values into the match-create call (Worker still caps to MAX).

export const KEEPS_COMMIT_DEADLINE_SLOTS_DEFAULT = 150;
export const KEEPS_REVEAL_DEADLINE_SLOTS_DEFAULT = 150;
export const KEEPS_DEADLINE_SLOTS_MAX = 600; // ~4 min cap, hard ceiling
