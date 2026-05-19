// Spaniel Syndicate — Rescue Pool math + branding.
//
// The Rescue Pool is a community-directed pool funded by:
//   - 6.90% of buyer payments on primary product sales
//     (after bundle and referral buyer discounts)
//   - 6.90% of the official 2% marketplace fee on every
//     secondary trade and accepted offer
//
// Endowment-style distribution:
//   - Each month, AT MOST 10% of the Rescue Pool balance at snapshot
//     may be distributed. Undistributed balance carries forward.
//   - Repeated 10% monthly distributions can drain almost all of the
//     pool over time but never instantly.
//
// Community-directed selection — one wallet, one vote:
//   - Every primary purchase + marketplace fee contributes to the pool.
//   - Only wallets at or above RESCUE_VOTE_THRESHOLD Rescue Weight at
//     the monthly snapshot direct the recipient.
//   - One eligible wallet = one vote. Holding more does not increase
//     vote count.
//   - Rescue Weight is in draw-slot units:
//       revealed card  = 1
//       sealed Single  = 1
//       sealed Pack    = 10
//       sealed Box     = 240
//       sealed Crate   = 2,400
//       sealed Vault   = 24,000  (if enabled)
//
// This file is the single source of truth for:
//   - the Rescue Pool basis points (RESCUE_POOL_BPS)
//   - the monthly distribution cap basis points
//     (RESCUE_MONTHLY_DISTRIBUTION_CAP_BPS)
//   - the per-wallet vote eligibility threshold
//     (RESCUE_VOTE_THRESHOLD)
//   - the display name (RESCUE_POOL_NAME)
//   - the primary marketing CTA (RESCUE_CTA)
//   - helpers that split a buyer-paid lamport amount or marketplace
//     fee into rescue + post-rescue portions
//   - the helper that applies the 10% monthly distribution cap
//   - the helper that computes Rescue Weight + vote eligibility
//
// Used by frontend (display) and Worker (signed quotes, ledger,
// snapshot). Diverging behaviour is a bug.

import { BPS_DENOMINATOR } from './bps.js';

export const RESCUE_POOL_BPS = 690;
export const RESCUE_POOL_NAME = 'Rescue Pool';
export const RESCUE_CTA = 'Buy a fake dog. Help a real one.';
export { BPS_DENOMINATOR };

// Endowment cap: max % of pool balance that may be distributed per month.
export const RESCUE_MONTHLY_DISTRIBUTION_CAP_BPS = 1000; // 10.00%

// Vote eligibility threshold. One wallet ≥ this Rescue Weight = one vote.
export const RESCUE_VOTE_THRESHOLD = 1024;

// Rescue Weight per sealed product (draw-slot units).
export const RESCUE_WEIGHT_PER_PRODUCT = Object.freeze({
  single: 1,
  pack: 10,
  box: 240,
  crate: 2_400,
  vault: 24_000
});

// Rescue Weight per revealed card (always 1, regardless of class).
export const RESCUE_WEIGHT_PER_CARD = 1;

// Long-form disclosure rendered next to Rescue Pool figures. Kept
// here so frontend + worker + docs render the same copy.
export const RESCUE_POOL_DISCLOSURE =
  'The Rescue Pool is community-directed. 6.9% of every buyer payment ' +
  'and 6.9% of every official marketplace/offer fee flow into the pool. ' +
  'At most 10% of the pool balance can be distributed each month — ' +
  'undistributed balance remains in the pool. Wallets with 1,024+ ' +
  'Rescue Weight at the monthly snapshot direct the recipient; one ' +
  'eligible wallet equals one vote. Any valid Solana address may be ' +
  'selected. The project encourages directing the pool to legitimate ' +
  'animal rescues and shelters; suggested recipients are advisory and ' +
  'not guaranteed to be verified non-profits. The Rescue Pool does ' +
  'not represent purchases as tax-deductible.';

/**
 * Carve the Rescue Pool contribution out of a buyer-paid primary
 * lamport amount. The remainder (`postRescueLamports`) is what
 * affiliate commission + treasury split.
 *
 * @param {bigint} buyerPaysLamports
 * @returns {{ rescueContributionLamports: bigint, postRescueLamports: bigint }}
 */
export function splitPrimaryRescue(buyerPaysLamports) {
  if (typeof buyerPaysLamports !== 'bigint') {
    throw new Error('buyerPaysLamports must be a BigInt');
  }
  if (buyerPaysLamports < 0n) {
    throw new Error('buyerPaysLamports must be non-negative');
  }
  const rescueContributionLamports =
    (buyerPaysLamports * BigInt(RESCUE_POOL_BPS)) / BigInt(BPS_DENOMINATOR);
  const postRescueLamports = buyerPaysLamports - rescueContributionLamports;
  return { rescueContributionLamports, postRescueLamports };
}

/**
 * Carve the Rescue Pool contribution out of an already-computed
 * marketplace fee. The remainder (`postRescueMarketFeeLamports`) is
 * what referrer + treasury split.
 *
 * @param {bigint} marketFeeLamports
 * @returns {{ rescueContributionLamports: bigint, postRescueMarketFeeLamports: bigint }}
 */
export function splitMarketFeeRescue(marketFeeLamports) {
  if (typeof marketFeeLamports !== 'bigint') {
    throw new Error('marketFeeLamports must be a BigInt');
  }
  if (marketFeeLamports < 0n) {
    throw new Error('marketFeeLamports must be non-negative');
  }
  const rescueContributionLamports =
    (marketFeeLamports * BigInt(RESCUE_POOL_BPS)) / BigInt(BPS_DENOMINATOR);
  const postRescueMarketFeeLamports = marketFeeLamports - rescueContributionLamports;
  return { rescueContributionLamports, postRescueMarketFeeLamports };
}

/**
 * Compute the monthly distribution cap for a given pool balance.
 *
 * @param {bigint} balanceLamports
 * @returns {bigint}
 */
export function monthlyDistributionCap(balanceLamports) {
  if (typeof balanceLamports !== 'bigint') {
    throw new Error('balanceLamports must be a BigInt');
  }
  if (balanceLamports < 0n) {
    throw new Error('balanceLamports must be non-negative');
  }
  return (balanceLamports * BigInt(RESCUE_MONTHLY_DISTRIBUTION_CAP_BPS)) / BigInt(BPS_DENOMINATOR);
}

/**
 * Validate that a proposed monthly distribution does not exceed the
 * 10% cap of the current balance. Throws Error if it does.
 *
 * @param {bigint} proposedLamports
 * @param {bigint} balanceLamports
 */
export function enforceMonthlyDistributionCap(proposedLamports, balanceLamports) {
  if (typeof proposedLamports !== 'bigint') {
    throw new Error('proposedLamports must be a BigInt');
  }
  if (proposedLamports < 0n) {
    throw new Error('proposedLamports must be non-negative');
  }
  const cap = monthlyDistributionCap(balanceLamports);
  if (proposedLamports > cap) {
    throw new Error(
      `proposed ${proposedLamports} exceeds monthly distribution cap ${cap} (10% of balance ${balanceLamports})`
    );
  }
  return true;
}

/**
 * Compute Rescue Weight for a collection of owned sealed products and
 * revealed cards. Weight is an integer; opening a product does not
 * change the total Rescue Weight contributed by a wallet (a sealed
 * pack = 10 weight; the 10 revealed cards underneath = 10 × 1).
 *
 * @param {object} args
 * @param {number} [args.revealedCardCount]
 * @param {{ productType: string, quantity?: number }[]} [args.sealedProducts]
 * @returns {{ weight: number, eligible: boolean, threshold: number }}
 */
export function computeRescueWeight(args) {
  const { revealedCardCount = 0, sealedProducts = [] } = args ?? {};
  if (!Number.isInteger(revealedCardCount) || revealedCardCount < 0) {
    throw new Error('revealedCardCount must be a non-negative integer');
  }
  let weight = revealedCardCount * RESCUE_WEIGHT_PER_CARD;
  for (const sp of sealedProducts) {
    const type = sp?.productType;
    const qty = sp?.quantity ?? 1;
    if (!Number.isInteger(qty) || qty < 1) {
      throw new Error(`sealedProducts: quantity must be positive integer, got ${qty}`);
    }
    const w = RESCUE_WEIGHT_PER_PRODUCT[type];
    if (!Number.isInteger(w) || w < 1) {
      throw new Error(`sealedProducts: unknown productType ${type}`);
    }
    weight += w * qty;
  }
  return {
    weight,
    eligible: weight >= RESCUE_VOTE_THRESHOLD,
    threshold: RESCUE_VOTE_THRESHOLD
  };
}

/**
 * Whether a given Rescue Weight makes a wallet eligible to vote.
 * @param {number|bigint} weight
 */
export function isVoteEligible(weight) {
  const n = typeof weight === 'bigint' ? Number(weight) : Number(weight);
  if (!Number.isFinite(n) || n < 0) return false;
  return n >= RESCUE_VOTE_THRESHOLD;
}

/**
 * Solana base58 pubkey shape check. Accepts standard 32-byte base58
 * strings; rejects empty/short/long/illegal-character values.
 *
 * @param {string} address
 * @returns {boolean}
 */
export function isValidSolanaAddress(address) {
  if (typeof address !== 'string') return false;
  if (address.length < 32 || address.length > 44) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
}

/**
 * Canonical scope kinds for legacy rescue preferences. The active
 * monthly selection mechanism is per-wallet votes; preferences below
 * are retained for historical reads only.
 */
export const RESCUE_SCOPE_TYPES = Object.freeze(['wallet_default', 'sealed_product', 'card']);

export function isValidRescueScopeType(s) {
  return RESCUE_SCOPE_TYPES.includes(s);
}

/**
 * Verification status vocabulary for recommended recipients.
 */
export const RESCUE_RECIPIENT_STATUSES = Object.freeze([
  'unverified',
  'community_suggested',
  'operator_suggested',
  'externally_verified',
  'deprecated'
]);

export function isValidRescueRecipientStatus(s) {
  return RESCUE_RECIPIENT_STATUSES.includes(s);
}
