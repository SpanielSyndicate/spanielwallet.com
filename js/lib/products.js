// Spaniel Syndicate — sealed product catalog & quote math.
//
// Products are wrappers that consume contiguous ranges of draw slots
// from the fixed Series 1 card inventory. They do NOT inflate supply:
// the sum of slots consumed by every product ever sold equals the
// total Series 1 card NFT count.
//
// Pricing order (BigInt lamports throughout):
//   1. stickerLamports         = Σ curve price for each consumed draw slot
//   2. bundleDiscount          = stickerLamports * bundleDiscountBps / 10000
//      subtotalLamports        = stickerLamports - bundleDiscount
//   3. referralDiscount        = subtotalLamports * 1000 / 10000     (10%, valid referral only)
//      buyerPaysLamports       = subtotalLamports - referralDiscount
//   4. rescueContribution      = buyerPaysLamports * RESCUE_POOL_BPS / 10000
//      postRescueLamports      = buyerPaysLamports - rescueContribution
//   5. directAffiliateCommission = postRescueLamports * affiliateRateBps / 10000
//      packlineOverrides      = Σ postRescueLamports * level_bps / 10000 (for present ancestors)
//      treasuryLamports        = postRescueLamports - directAffiliateCommission - packlineTotal
//
// With no valid referral: referralDiscount = 0, directAffiliateCommission = 0,
// packlineOverrides = 0, treasury keeps postRescueLamports.
//
// All money math is server-side. Frontend uses these helpers for
// display only; the Worker signs the canonical quote.

import { TOTAL_DRAW_SLOTS, batchPriceUsd, usdToLamports } from './curve.js';
import {
  BUYER_REFERRAL_DISCOUNT_BPS,
  MAX_AFFILIATE_BPS,
  BPS_DENOMINATOR
} from './referral.js';
import { formatSolLamports } from './format-sol.js';
import { RESCUE_POOL_BPS, splitPrimaryRescue } from './rescue.js';
import {
  computePacklineOverrides,
  emptyPacklineOverrides,
  PACKLINE_TOTAL_OVERRIDE_BPS
} from './packline.js';

// ────────────────────────────────────────────────────────────────────
// Product catalog
// ────────────────────────────────────────────────────────────────────

export const PRODUCTS = Object.freeze({
  single: Object.freeze({
    type: 'single',
    label: 'Single Card Pull',
    description: 'Pull one card from the Series 1 inventory.',
    drawSlots: 1,
    bundleDiscountBps: 0,
    sealedWrapper: false
  }),
  pack: Object.freeze({
    type: 'pack',
    label: 'Pack',
    description: 'Sealed 10-card pack. Trade sealed or rip to reveal.',
    drawSlots: 10,
    bundleDiscountBps: 0,
    sealedWrapper: true
  }),
  box: Object.freeze({
    type: 'box',
    label: 'Box',
    description: 'Sealed 24-pack (240-card) box. Bundle discount applies.',
    drawSlots: 240,
    bundleDiscountBps: 690,
    sealedWrapper: true
  }),
  crate: Object.freeze({
    type: 'crate',
    label: 'Crate',
    description: 'Sealed 10-box (2,400-card) crate. Bundle discount applies.',
    drawSlots: 2_400,
    bundleDiscountBps: 1000,
    sealedWrapper: true
  }),
  vault: Object.freeze({
    type: 'vault',
    label: 'Vault',
    description: 'Sealed 10-crate (24,000-card) vault. Bundle discount applies.',
    drawSlots: 24_000,
    bundleDiscountBps: 1690,
    sealedWrapper: true
  })
});

export const PRODUCT_TYPES = Object.freeze(Object.keys(PRODUCTS));

export function isValidProductType(t) {
  return typeof t === 'string' && Object.prototype.hasOwnProperty.call(PRODUCTS, t);
}

export function getProduct(productType) {
  return PRODUCTS[productType] ?? null;
}

/**
 * Total number of draw slots consumed by a product purchase.
 */
export function drawSlotsForPurchase(productType, quantity) {
  const p = getProduct(productType);
  if (!p) throw new Error(`unknown productType: ${productType}`);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(`quantity must be a positive integer, got ${quantity}`);
  }
  return p.drawSlots * quantity;
}

// ────────────────────────────────────────────────────────────────────
// Quote math
// ────────────────────────────────────────────────────────────────────

/**
 * Compute a product-purchase quote.
 *
 * @param {object} args
 * @param {string}  args.productType         single|pack|box|crate|vault
 * @param {number}  args.quantity            number of products (≥ 1)
 * @param {number}  args.startDrawSlot       first draw slot consumed (next-available)
 * @param {object}  args.curveConfig
 * @param {number}  args.solUsdPrice
 * @param {boolean} args.hasValidReferral
 * @param {number}  args.affiliateRateBps    direct affiliate bps; ignored when hasValidReferral=false
 * @param {Array<string|null|undefined>} [args.packlineAncestors]
 *   Upstream sponsor wallets (level-2 first), at most 4 entries.
 *   Slots that are missing/null receive 0 lamports and remain with
 *   treasury. Ignored when hasValidReferral=false.
 *
 * @returns {{
 *   productType: string,
 *   quantity: number,
 *   startDrawSlot: number,
 *   endDrawSlot: number,
 *   drawSlotsConsumed: number,
 *   stickerUsdTotal: number,
 *   stickerLamports: bigint,
 *   bundleDiscountBps: number,
 *   bundleDiscountLamports: bigint,
 *   subtotalLamports: bigint,
 *   referralDiscountBps: number,
 *   referralDiscountLamports: bigint,
 *   buyerPaysLamports: bigint,
 *   rescuePoolBps: number,
 *   rescueContributionLamports: bigint,
 *   postRescueLamports: bigint,
 *   affiliateRateBps: number,
 *   affiliateCommissionLamports: bigint,
 *   packlineOverrides: Array<{level:number,wallet:string|null,bps:number,lamports:bigint}>,
 *   packlineTotalLamports: bigint,
 *   treasuryLamports: bigint,
 *   hasValidReferral: boolean
 * }}
 */
export function computeProductQuote(args) {
  const {
    productType,
    quantity,
    startDrawSlot,
    curveConfig,
    solUsdPrice,
    hasValidReferral,
    affiliateRateBps,
    packlineAncestors
  } = args;

  const p = getProduct(productType);
  if (!p) throw new Error(`unknown productType: ${productType}`);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(`quantity must be a positive integer, got ${quantity}`);
  }
  if (!Number.isInteger(startDrawSlot) || startDrawSlot < 1) {
    throw new Error(`startDrawSlot must be a positive integer, got ${startDrawSlot}`);
  }
  if (typeof solUsdPrice !== 'number' || !(solUsdPrice > 0) || !Number.isFinite(solUsdPrice)) {
    throw new Error(`invalid solUsdPrice: ${solUsdPrice}`);
  }

  const drawSlotsConsumed = p.drawSlots * quantity;
  const endDrawSlot = startDrawSlot + drawSlotsConsumed - 1;
  if (endDrawSlot > TOTAL_DRAW_SLOTS) {
    throw new Error(
      `purchase would exceed TOTAL_DRAW_SLOTS: endDrawSlot ${endDrawSlot} > ${TOTAL_DRAW_SLOTS}`
    );
  }

  const { totalUsd } = batchPriceUsd(startDrawSlot, drawSlotsConsumed, curveConfig);
  const stickerLamports = usdToLamports(totalUsd, solUsdPrice);

  // 1. Bundle discount on sticker.
  const bundleDiscountBps = p.bundleDiscountBps;
  const bundleDiscountLamports =
    (stickerLamports * BigInt(bundleDiscountBps)) / BigInt(BPS_DENOMINATOR);
  const subtotalLamports = stickerLamports - bundleDiscountLamports;

  // 2. Referral buyer discount on subtotal.
  let referralDiscountBps = 0;
  let referralDiscountLamports = 0n;
  let buyerPaysLamports = subtotalLamports;
  if (hasValidReferral) {
    referralDiscountBps = BUYER_REFERRAL_DISCOUNT_BPS;
    referralDiscountLamports =
      (subtotalLamports * BigInt(referralDiscountBps)) / BigInt(BPS_DENOMINATOR);
    buyerPaysLamports = subtotalLamports - referralDiscountLamports;
  }

  // 3. Rescue Pool carved from buyer-paid amount.
  const { rescueContributionLamports, postRescueLamports } =
    splitPrimaryRescue(buyerPaysLamports);

  // 4. Direct affiliate commission on post-rescue amount.
  let effectiveAffiliateRateBps = 0;
  let affiliateCommissionLamports = 0n;
  let packline = emptyPacklineOverrides();
  if (hasValidReferral) {
    if (
      !Number.isFinite(affiliateRateBps) ||
      affiliateRateBps < 0 ||
      affiliateRateBps > MAX_AFFILIATE_BPS
    ) {
      throw new Error(`affiliateRateBps out of range: ${affiliateRateBps}`);
    }
    effectiveAffiliateRateBps = Math.floor(affiliateRateBps);
    affiliateCommissionLamports =
      (postRescueLamports * BigInt(effectiveAffiliateRateBps)) / BigInt(BPS_DENOMINATOR);

    // 5. Packline overrides on post-rescue amount. Only paid when a
    //    direct affiliate exists; missing ancestor levels remain
    //    with the treasury.
    packline = computePacklineOverrides({
      baseLamports: postRescueLamports,
      ancestors: Array.isArray(packlineAncestors)
        ? packlineAncestors.map((w) =>
            typeof w === 'string' && w.length > 0 ? { wallet: w } : null
          )
        : []
    });
  }
  const treasuryLamports =
    postRescueLamports - affiliateCommissionLamports - packline.totalLamports;
  if (treasuryLamports < 0n) {
    throw new Error(
      `treasuryLamports went negative: postRescue=${postRescueLamports} direct=${affiliateCommissionLamports} packline=${packline.totalLamports}`
    );
  }
  // Invariant: directAffiliateBps + actualPacklineOverrideBps ≤ 7900
  const sumBps =
    effectiveAffiliateRateBps +
    packline.overrides.reduce(
      (acc, o) => acc + (o.lamports > 0n ? o.bps : 0),
      0
    );
  if (sumBps > MAX_AFFILIATE_BPS + PACKLINE_TOTAL_OVERRIDE_BPS) {
    throw new Error(
      `direct affiliate + Packline override bps exceeds 7900: ${sumBps}`
    );
  }

  return {
    productType,
    quantity,
    startDrawSlot,
    endDrawSlot,
    drawSlotsConsumed,
    stickerUsdTotal: totalUsd,
    stickerLamports,
    bundleDiscountBps,
    bundleDiscountLamports,
    subtotalLamports,
    referralDiscountBps,
    referralDiscountLamports,
    buyerPaysLamports,
    rescuePoolBps: RESCUE_POOL_BPS,
    rescueContributionLamports,
    postRescueLamports,
    affiliateRateBps: effectiveAffiliateRateBps,
    affiliateCommissionLamports,
    packlineOverrides: packline.overrides,
    packlineTotalLamports: packline.totalLamports,
    treasuryLamports,
    hasValidReferral: !!hasValidReferral
  };
}

/**
 * Format a product quote for display. All lamport amounts rendered
 * as SOL strings; USD totals rendered as $X.XX.
 *
 * @param {object} quote — return value of computeProductQuote
 */
export function formatProductQuote(quote) {
  // BigInt-safe: late-curve totals exceed Number.MAX_SAFE_INTEGER.
  // formatSolLamports splits the BigInt before any float conversion.
  const fmtSol = (l) => `${formatSolLamports(l, 6, { padZeros: true })} SOL`;
  const fmtUsd = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  return {
    productType: quote.productType,
    quantity: quote.quantity,
    drawSlotsConsumed: quote.drawSlotsConsumed.toLocaleString(),
    stickerUsdTotal: fmtUsd(quote.stickerUsdTotal),
    stickerSol: fmtSol(quote.stickerLamports),
    bundleDiscount: fmtSol(quote.bundleDiscountLamports),
    subtotal: fmtSol(quote.subtotalLamports),
    referralDiscount: fmtSol(quote.referralDiscountLamports),
    buyerPays: fmtSol(quote.buyerPaysLamports),
    rescueContribution: fmtSol(quote.rescueContributionLamports),
    postRescue: fmtSol(quote.postRescueLamports),
    affiliateCommission: fmtSol(quote.affiliateCommissionLamports),
    packlineOverrides: (quote.packlineOverrides ?? []).map((o) => ({
      level: o.level,
      wallet: o.wallet,
      bps: o.bps,
      pct: `${(o.bps / 100).toFixed(2)}%`,
      lamports: fmtSol(o.lamports)
    })),
    packlineTotal: fmtSol(quote.packlineTotalLamports ?? 0n),
    treasury: fmtSol(quote.treasuryLamports)
  };
}
