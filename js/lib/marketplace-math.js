// Marketplace fee math — single source of truth.
//
// The official Spaniel Syndicate marketplace charges a 2% platform
// fee on every sale. Of that 2%:
//   - 6.90% goes to the Rescue Pool (community-directed monthly).
//   - The remaining 93.10% (post-rescue fee) is split:
//     - With a valid direct referral attribution: 50% to that direct
//       referrer; Packline override slots (levels 2–5) are carved
//       from the post-rescue fee on top; treasury keeps the rest.
//     - With no direct referral: treasury 100%, no Packline.
//
// Sellers pay only the 2% platform fee — the Rescue Pool cut and
// the Packline overrides are both carved out of the platform fee,
// not added on top.
//
// Holder-tier affiliate rate does NOT affect this split. The
// secondary referrer share is always 50% of the post-rescue
// marketplace fee. Primary mint and secondary marketplace are
// separate fee systems.
//
// The fee is a platform fee, not a royalty. Metaplex Core royalties
// remain at 0%.

import { splitMarketFeeRescue, RESCUE_POOL_BPS } from './rescue.js';
import {
  computePacklineOverrides,
  emptyPacklineOverrides
} from './packline.js';
import { BPS_DENOMINATOR } from './bps.js';
import { formatSolLamports } from './format-sol.js';

export const MARKETPLACE_FEE_BPS = 200;          // 2.00%
export const MARKETPLACE_REFERRER_SHARE_BPS = 5000; // 50.00% of post-rescue fee
export { BPS_DENOMINATOR };

/**
 * Compute the marketplace fee split.
 *
 * @param {object} args
 * @param {bigint} args.salePriceLamports
 * @param {boolean} args.hasValidReferral — true iff there is a valid
 *   direct marketplace referrer attribution.
 * @param {Array<string|null|undefined>} [args.packlineAncestors]
 *   Upstream Packline sponsor wallets (level-2 first), at most 4.
 *   Missing slots receive 0 and remain with treasury. Ignored when
 *   hasValidReferral=false.
 * @returns {{
 *   salePriceLamports: bigint,
 *   marketFeeLamports: bigint,
 *   rescuePoolBps: number,
 *   rescueContributionLamports: bigint,
 *   postRescueMarketFeeLamports: bigint,
 *   referralFeeLamports: bigint,
 *   packlineOverrides: Array<{level:number,wallet:string|null,bps:number,lamports:bigint}>,
 *   packlineTotalLamports: bigint,
 *   treasuryFeeLamports: bigint,
 *   sellerReceivesLamports: bigint
 * }}
 */
export function computeMarketplaceFee({
  salePriceLamports,
  hasValidReferral,
  packlineAncestors
}) {
  if (typeof salePriceLamports !== 'bigint') {
    throw new Error('salePriceLamports must be a BigInt');
  }
  if (salePriceLamports < 0n) {
    throw new Error('salePriceLamports must be non-negative');
  }

  const marketFeeLamports =
    (salePriceLamports * BigInt(MARKETPLACE_FEE_BPS)) / BigInt(BPS_DENOMINATOR);
  const sellerReceivesLamports = salePriceLamports - marketFeeLamports;

  // Carve Rescue Pool out of the 2% platform fee.
  const { rescueContributionLamports, postRescueMarketFeeLamports } =
    splitMarketFeeRescue(marketFeeLamports);

  let referralFeeLamports;
  let packline = emptyPacklineOverrides();
  let treasuryFeeLamports;
  if (hasValidReferral) {
    referralFeeLamports =
      (postRescueMarketFeeLamports * BigInt(MARKETPLACE_REFERRER_SHARE_BPS)) / BigInt(BPS_DENOMINATOR);
    packline = computePacklineOverrides({
      baseLamports: postRescueMarketFeeLamports,
      ancestors: Array.isArray(packlineAncestors)
        ? packlineAncestors.map((w) =>
            typeof w === 'string' && w.length > 0 ? { wallet: w } : null
          )
        : []
    });
    treasuryFeeLamports =
      postRescueMarketFeeLamports - referralFeeLamports - packline.totalLamports;
  } else {
    referralFeeLamports = 0n;
    treasuryFeeLamports = postRescueMarketFeeLamports;
  }

  if (treasuryFeeLamports < 0n) {
    throw new Error(
      `treasuryFeeLamports went negative: postRescue=${postRescueMarketFeeLamports} ref=${referralFeeLamports} packline=${packline.totalLamports}`
    );
  }

  return {
    salePriceLamports,
    marketFeeLamports,
    rescuePoolBps: RESCUE_POOL_BPS,
    rescueContributionLamports,
    postRescueMarketFeeLamports,
    referralFeeLamports,
    packlineOverrides: packline.overrides,
    packlineTotalLamports: packline.totalLamports,
    treasuryFeeLamports,
    sellerReceivesLamports
  };
}

/**
 * Format the marketplace fee breakdown for display.
 * @param {object} split — return value of computeMarketplaceFee
 * @returns {object} string-formatted lamport amounts
 */
export function formatMarketplaceFeeBreakdown(split) {
  const fmt = (lamports) => `${formatSolLamports(lamports, 4, { padZeros: true })} SOL`;
  return {
    salePrice: fmt(split.salePriceLamports),
    marketFee: fmt(split.marketFeeLamports),
    rescueContribution: fmt(split.rescueContributionLamports),
    postRescueMarketFee: fmt(split.postRescueMarketFeeLamports),
    referralFee: fmt(split.referralFeeLamports),
    packlineOverrides: (split.packlineOverrides ?? []).map((o) => ({
      level: o.level,
      wallet: o.wallet,
      bps: o.bps,
      pct: `${(o.bps / 100).toFixed(2)}%`,
      lamports: fmt(o.lamports)
    })),
    packlineTotal: fmt(split.packlineTotalLamports ?? 0n),
    treasuryFee: fmt(split.treasuryFeeLamports),
    sellerReceives: fmt(split.sellerReceivesLamports)
  };
}
