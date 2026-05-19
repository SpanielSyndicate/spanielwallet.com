// Spaniel Syndicate — SpanielCoin issuance math (Series 1 ecosystem token).
//
// SpanielCoin is a Series 1 ecosystem / utility token. It is issued
// only on paid primary Series 1 card draws and is burned during
// redemption draws.
//
// ISSUANCE RULES (locked 2026-05-17):
//
//   Per paid primary draw slot consumed:
//     1. Buyer Coin           — 1 SPANIEL to the buyer wallet.
//     2. Treasury Match       — 1 SPANIEL to the Spaniel Treasury wallet.
//     3. Direct Affiliate     — 1 SPANIEL to the direct Barklink affiliate
//                                if (and only if) a valid direct
//                                affiliate is attached to the draw.
//
//   No affiliate ⇒ no direct-affiliate allocation. Missing affiliate
//   coins are NOT rerouted to the treasury.
//
//   Self-referral is allowed. If the buyer is also the direct affiliate
//   the same wallet receives both Buyer Coin AND Direct Affiliate Coin.
//   The ledger uses (event_type, source_type, source_id, wallet,
//   allocation_type) as its idempotency key so that pair of rows does
//   not collide.
//
//   Maximum possible SpanielCoin supply is 3,000,000,000 (3B) — that
//   bound is only reached if all 1,000,000,000 paid primary draws have
//   a valid direct affiliate. The realistic ceiling is below 3B.
//
//   Per Series 1 paid draw, total minted in [2, 3]:
//     unaffiliated paid draw → 2 SPANIEL (buyer + treasury)
//     affiliated   paid draw → 3 SPANIEL (buyer + treasury + affiliate)
//
// NEVER MINTED ON:
//
//   - redemption draws
//   - secondary marketplace trades
//   - offer accepts
//   - Packline ancestor payouts
//   - Rescue Pool distributions
//   - admin actions (other than transparent `correction` ledger rows)
//
// PUBLIC COPY must avoid "free money", "yield", "passive income",
// "investment", "ROI", "guaranteed value", etc. Use "SpanielCoin",
// "Buyer Coin", "Treasury Match", "Direct Affiliate Coin",
// "SpanielCoin balance", "SpanielCoin burn", or generic descriptors.
// See CLAUDE.md §0 + §4.
//
// Production target: SPL mint with the Series 1 Program as mint
// authority. Until that ships the Worker projects balances in D1
// (`spanielcoin_accounts`, `spanielcoin_ledger`) and the public site
// labels balances as dev/mock.

import { PRODUCTS, isValidProductType, getProduct } from './products.js';

// ────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────

// Per paid draw slot, per allocation type. Each allocation type mints
// at most 1 SPANIEL per draw slot.
export const SPANIELCOIN_PER_PAID_DRAW = 1;

// Maximum possible SpanielCoin supply if every paid draw across the
// entire Series 1 inventory has a valid direct affiliate (1B draws ×
// 3 allocations × 1 SPANIEL).
export const SPANIELCOIN_MAX_POSSIBLE_SUPPLY = 3_000_000_000n;

export const SPANIELCOIN_NAME = 'SpanielCoin';
export const SPANIELCOIN_SYMBOL = 'SPCN';
export const SPANIELCOIN_DECIMALS = 0;

// Placeholder mint address — flagged as dev/mock until the SPL mint
// is deployed under the Series 1 Program mint authority.
export const SPANIELCOIN_PLACEHOLDER_MINT = 'SpanielCoinDevMint11111111111111111111111111';
export const SPANIELCOIN_IS_LIVE = false;

// Allocation types accepted by the ledger. Buyer + Treasury Match +
// Direct Affiliate are issued on paid primary draws. Redemption Burn
// is the burn path. Correction is for transparent ledger adjustments
// (never issued as "compensation"; logged as audit trail).
export const SPANIELCOIN_ALLOCATION_TYPES = Object.freeze([
  'buyer',
  'treasury_match',
  'direct_affiliate',
  'redemption_burn',
  'correction'
]);

// Allocation types that are minted on paid primary draws.
export const SPANIELCOIN_PAID_DRAW_ALLOCATIONS = Object.freeze([
  'buyer',
  'treasury_match',
  'direct_affiliate'
]);

export function isValidSpanielCoinAllocationType(t) {
  return typeof t === 'string' && SPANIELCOIN_ALLOCATION_TYPES.includes(t);
}

// Allowed event/source enums for the spanielcoin ledger.
export const SPANIELCOIN_EVENT_TYPES = Object.freeze([
  'paid_draw_issuance',
  'redemption_burn',
  'correction'
]);

export const SPANIELCOIN_SOURCE_TYPES = Object.freeze([
  'product_purchase',
  'redemption',
  'admin'
]);

export function isValidSpanielCoinEventType(t) {
  return typeof t === 'string' && SPANIELCOIN_EVENT_TYPES.includes(t);
}

export function isValidSpanielCoinSourceType(t) {
  return typeof t === 'string' && SPANIELCOIN_SOURCE_TYPES.includes(t);
}

// ────────────────────────────────────────────────────────────────────
// Issuance math
// ────────────────────────────────────────────────────────────────────

function totalDrawSlots(productType, quantity) {
  if (!isValidProductType(productType)) {
    throw new Error(`unknown productType: ${productType}`);
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(`quantity must be a positive integer, got ${quantity}`);
  }
  return BigInt(PRODUCTS[productType].drawSlots) * BigInt(quantity);
}

/**
 * Buyer Coin minted for a paid primary product purchase. Always equals
 * total draw slots consumed (1 SPANIEL per draw slot).
 *
 * @param {string} productType
 * @param {number} quantity
 * @returns {bigint}
 */
export function spanielCoinBuyerForProduct(productType, quantity) {
  return totalDrawSlots(productType, quantity);
}

/**
 * Treasury Match minted for a paid primary product purchase. Always
 * equals total draw slots consumed.
 *
 * Treasury coins are described as "Spaniel Treasury Match inventory
 * used under the project's treasury policy" — never as "free money",
 * "founder mint", or "investment".
 *
 * @param {string} productType
 * @param {number} quantity
 * @returns {bigint}
 */
export function spanielCoinTreasuryMatchForProduct(productType, quantity) {
  return totalDrawSlots(productType, quantity);
}

/**
 * Direct Affiliate Coin minted for a paid primary product purchase.
 * Returns 0 when no valid direct affiliate exists.
 *
 * Packline ancestor wallets never receive SpanielCoin via this path —
 * only the direct (L1) Barklink affiliate does.
 *
 * @param {string} productType
 * @param {number} quantity
 * @param {{ hasValidDirectAffiliate?: boolean }} [opts]
 * @returns {bigint}
 */
export function spanielCoinDirectAffiliateForProduct(productType, quantity, opts) {
  // Validate the catalog inputs first so a malformed call still
  // raises whether or not an affiliate is attached.
  totalDrawSlots(productType, quantity);
  if (!opts || opts.hasValidDirectAffiliate !== true) return 0n;
  return totalDrawSlots(productType, quantity);
}

/**
 * Full per-product SpanielCoin issuance breakdown. Returns BigInts so
 * downstream BigInt arithmetic stays exact.
 *
 * Self-referral (buyer wallet == direct affiliate wallet) is allowed
 * and surfaces as `selfReferral: true`. The buyer + affiliate
 * allocations remain separate rows — collapsing them is the consumer
 * (ledger) responsibility, but the ledger uses allocation_type to
 * keep both rows uniquely keyed even for the same wallet.
 *
 * @param {object} args
 * @param {string} args.productType
 * @param {number} args.quantity
 * @param {boolean} [args.hasValidDirectAffiliate]
 * @param {string}  [args.buyerWallet]
 * @param {string|null} [args.directAffiliateWallet]
 * @param {string}  [args.treasuryWallet]
 * @returns {{
 *   buyerAmount:           bigint,
 *   treasuryMatchAmount:   bigint,
 *   directAffiliateAmount: bigint,
 *   totalIssued:           bigint,
 *   buyerWallet:           string|null,
 *   directAffiliateWallet: string|null,
 *   treasuryWallet:        string|null,
 *   selfReferral:          boolean,
 *   note:                  string
 * }}
 */
export function spanielCoinIssuanceForProductPurchase(args) {
  const {
    productType,
    quantity,
    hasValidDirectAffiliate = false,
    buyerWallet = null,
    directAffiliateWallet = null,
    treasuryWallet = null
  } = args ?? {};

  const buyerAmount = spanielCoinBuyerForProduct(productType, quantity);
  const treasuryMatchAmount = spanielCoinTreasuryMatchForProduct(productType, quantity);
  const directAffiliateAmount = spanielCoinDirectAffiliateForProduct(
    productType,
    quantity,
    { hasValidDirectAffiliate }
  );

  const selfReferral =
    !!buyerWallet &&
    !!directAffiliateWallet &&
    buyerWallet === directAffiliateWallet &&
    directAffiliateAmount > 0n;

  return {
    buyerAmount,
    treasuryMatchAmount,
    directAffiliateAmount,
    totalIssued: buyerAmount + treasuryMatchAmount + directAffiliateAmount,
    buyerWallet,
    directAffiliateWallet: directAffiliateAmount > 0n ? directAffiliateWallet : null,
    treasuryWallet,
    selfReferral,
    note: 'Redemption draws do not mint SpanielCoin. Only paid primary draws do.'
  };
}

/**
 * SpanielCoin minted for a redemption draw. Always 0 — redemption
 * draws never mint SpanielCoin.
 * @returns {bigint}
 */
export function spanielCoinIssuedForRedemption() {
  return 0n;
}

/**
 * SpanielCoin minted for a secondary marketplace trade. Always 0.
 * @returns {bigint}
 */
export function spanielCoinIssuedForMarketTrade() {
  return 0n;
}

/**
 * SpanielCoin minted for an offer accept. Always 0.
 * @returns {bigint}
 */
export function spanielCoinIssuedForOfferAccept() {
  return 0n;
}

/**
 * SpanielCoin minted for a Packline ancestor payout. Always 0.
 * Packline ancestors do not receive SpanielCoin.
 * @returns {bigint}
 */
export function spanielCoinIssuedForPacklineOverride() {
  return 0n;
}

/**
 * SpanielCoin minted for a Rescue Pool distribution. Always 0.
 * The Rescue Pool receives no SpanielCoin.
 * @returns {bigint}
 */
export function spanielCoinIssuedForRescueDistribution() {
  return 0n;
}

/**
 * Whether an event kind is eligible to issue SpanielCoin.
 * Only `paid_draw_issuance` issues; everything else returns false.
 *
 * @param {string} eventType
 * @returns {boolean}
 */
export function isSpanielCoinIssuanceEligible(eventType) {
  return eventType === 'paid_draw_issuance';
}

/**
 * Returns false — redemption draws are explicitly never eligible.
 * Kept as a named helper so handler code can document intent.
 * @returns {boolean}
 */
export function isRedemptionDrawSpanielCoinEligible() {
  return false;
}

/**
 * Per-product issuance preview, suitable for catalog UIs.
 * Returns the SpanielCoin minted by a single unit of each product,
 * broken out by allocation type.
 *
 * @returns {{
 *   type: string,
 *   label: string,
 *   drawSlots: number,
 *   buyerAmount: string,
 *   treasuryMatchAmount: string,
 *   directAffiliateAmountIfAttached: string,
 *   totalIssuedUnaffiliated: string,
 *   totalIssuedAffiliated: string
 * }[]}
 */
export function spanielCoinIssuancePreview() {
  return Object.keys(PRODUCTS).map((type) => {
    const p = getProduct(type);
    const unaff = spanielCoinIssuanceForProductPurchase({
      productType: type,
      quantity: 1,
      hasValidDirectAffiliate: false
    });
    const aff = spanielCoinIssuanceForProductPurchase({
      productType: type,
      quantity: 1,
      hasValidDirectAffiliate: true
    });
    return {
      type,
      label: p.label,
      drawSlots: p.drawSlots,
      buyerAmount: unaff.buyerAmount.toString(),
      treasuryMatchAmount: unaff.treasuryMatchAmount.toString(),
      directAffiliateAmountIfAttached: aff.directAffiliateAmount.toString(),
      totalIssuedUnaffiliated: unaff.totalIssued.toString(),
      totalIssuedAffiliated: aff.totalIssued.toString()
    };
  });
}

/**
 * Public copy contract — public surfaces MUST use this CTA / language.
 * Helps catch regressions if a future PR drifts into "free money" copy.
 */
export const SPANIELCOIN_COPY = Object.freeze({
  shortName: 'SpanielCoin',
  longName: 'SpanielCoin — Series 1 ecosystem token',
  tagline: 'Paid Series 1 cards earn SpanielCoin. Redemption draws do not.',
  burnTagline: 'Burn cards + SpanielCoin to rip again.',
  boostTagline:
    'Cards set your base redemption units. Extra SpanielCoin can boost output up to 2x.',
  buyerLabel: 'Buyer Coin',
  treasuryLabel: 'Treasury Match',
  affiliateLabel: 'Direct Affiliate Coin',
  treasuryDescription:
    'Spaniel Treasury Match inventory used under the project’s treasury policy.',
  notInvestment:
    'SpanielCoin is a Series 1 utility token. It is not an investment ' +
    'product, does not represent equity, and is not guaranteed to have ' +
    'market value. Redemption draws never mint SpanielCoin.'
});

// Forbidden phrases that must never appear in user-facing SpanielCoin
// copy. Exported so a doc/static check can grep build artifacts.
export const SPANIELCOIN_FORBIDDEN_PHRASES = Object.freeze([
  'free money',
  'guaranteed returns',
  'guaranteed value',
  'passive income',
  'yield',
  'apy',
  'dividend',
  'investment',
  'roi',
  'staking rewards',
  'floor support',
  'tax-deductible',
  'tax deductible',
  'charity donation',
  'founder mint'
]);
