// Affiliate referral math — single source of truth.
//
// Same module is imported by the public frontend (for display) and
// by the Cloudflare Worker (for signed-quote settlement). Diverging
// behaviour is a bug.
//
// All lamport amounts are BigInt. Display numbers can be converted
// to JS `number` at the UI boundary, never in math.
//
// Direct affiliate rate is set by Affiliate Weight — a wallet's
// summed holding across all Spaniel-product surfaces (revealed cards
// + sealed product weight). Series 1 ships 1,000,000,000 cards, so
// the top 69% rate requires serious commitment:
//
//   affiliateWeightClamped = min(max(affiliateWeight, 0), MAX_AFFILIATE_BOOST_WEIGHT)
//   referralBps = BASE_AFFILIATE_BPS + floor(
//     AFFILIATE_BOOST_BPS * affiliateWeightClamped^2 / MAX_AFFILIATE_BOOST_WEIGHT^2
//   )
//
// Affiliate Weight units mirror Rescue Weight (see js/lib/rescue.js):
//   revealed card  = 1, sealed Single = 1, sealed Pack = 10,
//   sealed Box     = 240, sealed Crate = 2,400, sealed Vault = 24,000.
//
// Primary mint split (lamports):
//   With no valid referral:
//     buyerPays            = sticker
//     rescueContribution   = floor(buyerPays * RESCUE_POOL_BPS / 10000)
//     postRescue           = buyerPays - rescueContribution
//     referralCommission   = 0
//     treasury             = postRescue
//   With valid referral:
//     discount             = floor(sticker * BUYER_REFERRAL_DISCOUNT_BPS / 10000)  # 10%
//     buyerPays            = sticker - discount
//     rescueContribution   = floor(buyerPays * RESCUE_POOL_BPS / 10000)            # 6.9%
//     postRescue           = buyerPays - rescueContribution
//     referralCommission   = floor(postRescue * affiliateRateBps / 10000)
//     treasury             = postRescue - referralCommission

import { RESCUE_POOL_BPS, splitPrimaryRescue } from './rescue.js';
import { BPS_DENOMINATOR } from './bps.js';

export const BASE_AFFILIATE_BPS = 690;
export const MAX_AFFILIATE_BPS = 6900;
export const MAX_AFFILIATE_BOOST_WEIGHT = 1_000_000;
export const AFFILIATE_BOOST_BPS = 6210;
export const BUYER_REFERRAL_DISCOUNT_BPS = 1000;
export { BPS_DENOMINATOR };

/**
 * Compute the direct affiliate referral rate in basis points given
 * the affiliate's verified Affiliate Weight.
 *
 * Affiliate Weight is verified server-side via Helius DAS + sealed-
 * product table; never trust client-supplied values.
 *
 * @param {number|bigint} affiliateWeight
 * @returns {number} bps in [BASE_AFFILIATE_BPS, MAX_AFFILIATE_BPS]
 */
export function computeReferralBps(affiliateWeight) {
  // Coerce to integer Number — bps result is always small enough for
  // JS number precision; intermediate computation stays in Number
  // because n^2 maxes at 1e12 (well under Number.MAX_SAFE_INTEGER).
  let n = Number(affiliateWeight);
  if (!Number.isFinite(n)) n = 0;
  n = Math.floor(n);
  if (n < 0) n = 0;
  if (n > MAX_AFFILIATE_BOOST_WEIGHT) n = MAX_AFFILIATE_BOOST_WEIGHT;
  const boost = Math.floor(
    (AFFILIATE_BOOST_BPS * n * n) / (MAX_AFFILIATE_BOOST_WEIGHT * MAX_AFFILIATE_BOOST_WEIGHT)
  );
  return BASE_AFFILIATE_BPS + boost;
}

/**
 * Format a bps value as a human-readable percentage string.
 * @param {number} bps
 * @returns {string} e.g. "6.90%"
 */
export function formatBpsAsPercent(bps) {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Compute the primary-mint money split.
 *
 * @param {object} args
 * @param {bigint} args.stickerLamports — sum of curve prices in lamports
 * @param {boolean} args.hasValidReferral
 * @param {number}  args.affiliateRateBps — ignored when hasValidReferral=false
 * @returns {{
 *   stickerLamports: bigint,
 *   discountLamports: bigint,
 *   buyerPaysLamports: bigint,
 *   rescuePoolBps: number,
 *   rescueContributionLamports: bigint,
 *   postRescueLamports: bigint,
 *   referralCommissionLamports: bigint,
 *   treasuryLamports: bigint,
 *   effectiveAffiliateRateBps: number
 * }}
 */
export function computePrimaryMintSplit({ stickerLamports, hasValidReferral, affiliateRateBps }) {
  if (typeof stickerLamports !== 'bigint') {
    throw new Error('stickerLamports must be a BigInt');
  }
  if (stickerLamports < 0n) {
    throw new Error('stickerLamports must be non-negative');
  }

  if (!hasValidReferral) {
    const buyerPaysLamports = stickerLamports;
    const { rescueContributionLamports, postRescueLamports } = splitPrimaryRescue(buyerPaysLamports);
    return {
      stickerLamports,
      discountLamports: 0n,
      buyerPaysLamports,
      rescuePoolBps: RESCUE_POOL_BPS,
      rescueContributionLamports,
      postRescueLamports,
      referralCommissionLamports: 0n,
      treasuryLamports: postRescueLamports,
      effectiveAffiliateRateBps: 0
    };
  }

  if (!Number.isFinite(affiliateRateBps) || affiliateRateBps < 0 || affiliateRateBps > MAX_AFFILIATE_BPS) {
    throw new Error(`affiliateRateBps out of range: ${affiliateRateBps}`);
  }
  const rateBps = BigInt(Math.floor(affiliateRateBps));
  const discountLamports = (stickerLamports * BigInt(BUYER_REFERRAL_DISCOUNT_BPS)) / BigInt(BPS_DENOMINATOR);
  const buyerPaysLamports = stickerLamports - discountLamports;
  const { rescueContributionLamports, postRescueLamports } = splitPrimaryRescue(buyerPaysLamports);
  const referralCommissionLamports = (postRescueLamports * rateBps) / BigInt(BPS_DENOMINATOR);
  const treasuryLamports = postRescueLamports - referralCommissionLamports;

  return {
    stickerLamports,
    discountLamports,
    buyerPaysLamports,
    rescuePoolBps: RESCUE_POOL_BPS,
    rescueContributionLamports,
    postRescueLamports,
    referralCommissionLamports,
    treasuryLamports,
    effectiveAffiliateRateBps: Number(rateBps)
  };
}

/**
 * Convert SOL (as a decimal number) to lamports as BigInt.
 * Rounds to nearest lamport.
 * @param {number} sol
 * @returns {bigint}
 */
export function solToLamports(sol) {
  if (!Number.isFinite(sol)) throw new Error(`invalid SOL: ${sol}`);
  return BigInt(Math.round(sol * 1e9));
}

/**
 * Convert lamports (BigInt) to SOL (number) for display only.
 * @param {bigint} lamports
 * @returns {number}
 */
export function lamportsToSol(lamports) {
  if (typeof lamports !== 'bigint') throw new Error('lamports must be BigInt');
  // For display: precision loss above 9e15 lamports is acceptable for UI.
  return Number(lamports) / 1e9;
}
