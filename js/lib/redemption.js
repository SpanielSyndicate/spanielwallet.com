// Spaniel Syndicate — dynamic burn redemption math.
//
// Redemption Draws let a Series 1 holder burn (cards | sealed-product
// draw-slot units) + SpanielCoin to consume the next available
// Series 1 draw slot(s) and reveal new card(s). They are the on-ramp
// from "I have a stack of duplicates and SpanielCoin sitting in my
// account" → "rip again, no SOL required."
//
// CORE RULES (locked 2026-05-17):
//
//   Series 1 supply stays at exactly 1,000,000,000 draw slots. A
//   redemption draw consumes the next available draw slot like any
//   other draw — it shrinks the remaining paid-primary inventory.
//
//   Redemption draws NEVER mint SpanielCoin. Only paid primary
//   draws mint SpanielCoin (see spanielcoin.js).
//
//   Burned cards / sealed products are permanently retired (status =
//   'burned'). They cannot be listed, played in Showdown, voted with,
//   or counted as Rescue Weight or Affiliate Weight afterwards.
//
//   Burning rare/mythic-class cards or sealed Box/Crate/Vault is
//   allowed but the UI MUST require explicit confirmation. The math
//   layer flags warnings; the handler/UI gates the destructive action.
//
// BURN UNIT FORMULA (BigInt, micro-USD scaled):
//
//   burnUnit(currentDrawPriceUsd) =
//       max(8, 8 * 2 ^ floor(log2(currentDrawPriceUsd / 0.069)))
//
//   Examples:
//     $0.069 → 8
//     $0.69  → 64
//     $4.20  → 256
//     $69    → 4,096
//     $420   → 32,768
//     $6,942 → 524,288
//     $69,420 → 4,194,304
//     $69,420,000 → 4,294,967,296
//     $6,942,000,000 → 549,755,813,888
//
// REDEMPTION DRAWS:
//
//   cardUnits = floor(cardsBurned / burnUnit)
//   coinUnits = floor(spanielCoinsBurned / burnUnit)
//
//   Validation:
//     - cardsBurned MUST be a multiple of burnUnit (no leftover).
//     - spanielCoinsBurned MUST be a multiple of burnUnit (no leftover).
//     - cardUnits  >= 1            (otherwise INSUFFICIENT_BURN_MATERIAL)
//     - coinUnits  >= cardUnits    (otherwise INSUFFICIENT_SPANIELCOIN_BOOST)
//     - coinUnits  <= cardUnits*2  (otherwise COIN_OVERBURN — exceeds 2x boost)
//     - redemptionDraws <= MAX_REDEMPTION_DRAWS_PER_TX
//
//   Output:
//     redemptionDraws = min(cardUnits * 2, coinUnits)
//
//   The 2× cap is the maximum coin boost — DO NOT add 4× / 8× tiers
//   or a quadratic curve. Cards set the base; extra SpanielCoin can
//   double the output and no more.
//
//   Examples at launch ($0.069, burnUnit = 8):
//     burn  8 cards +  8 coins → 1 redemption draw
//     burn  8 cards + 16 coins → 2 redemption draws
//     burn 16 cards + 16 coins → 2 redemption draws   (NOT 4)
//     burn 16 cards + 32 coins → 4 redemption draws
//     burn 32 cards + 32 coins → 4 redemption draws
//     burn 32 cards + 64 coins → 8 redemption draws

import { batchPriceUsd } from './curve.js';
import { PRODUCTS, isValidProductType } from './products.js';
import { RARITY_GROUPS, VARIANTS, isValidVariantSlug } from './series1.js';
import { spanielCoinIssuedForRedemption } from './spanielcoin.js';

// ────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────

export const REDEMPTION_BASE_BURN = 8;
export const REDEMPTION_BASE_PRICE_USD = 0.069;
// Maximum coin-side boost over the card-side base.
//   redemptionDraws <= cardUnits * REDEMPTION_MAX_COIN_BOOST_MULTIPLIER
// Cards set the base; extra SpanielCoin doubles (and no more).
export const REDEMPTION_MAX_COIN_BOOST_MULTIPLIER = 2;
export const MAX_REDEMPTION_DRAWS_PER_TX = 420;

// micro-USD scaling factor for BigInt safe math (avoid Number / Math.log2
// for any settlement-critical decision).
const MICRO = 1_000_000n;
const BASE_PRICE_MICRO = BigInt(Math.round(REDEMPTION_BASE_PRICE_USD * 1_000_000)); // 69000n

// Burnable asset enum.
export const BURN_ASSET_TYPES = Object.freeze(['card', 'sealed_product']);

export function isValidBurnAssetType(t) {
  return typeof t === 'string' && BURN_ASSET_TYPES.includes(t);
}

// Redemption row status enum.
export const REDEMPTION_STATUSES = Object.freeze([
  'quoted',
  'recorded',
  'revealed',
  'cancelled',
  'failed'
]);

export function isValidRedemptionStatus(s) {
  return typeof s === 'string' && REDEMPTION_STATUSES.includes(s);
}

// Warning levels surfaced by the math layer; the UI/handler gates
// destructive action based on these.
export const REDEMPTION_WARNING_LEVELS = Object.freeze(['info', 'warn', 'severe']);

// Rarity groups (and variant slugs) that require explicit confirmation
// when the user attempts to burn them. Mythics are 1/1; gold/error/
// black are the standard-class extremes.
const SEVERE_BURN_VARIANTS = new Set(['mythic', 'mythic_insert', 'black', 'error', 'gold']);
const SEVERE_BURN_RARITIES = new Set(['rare', 'ultra', 'mythic']);

// Sealed products that warrant a destructive confirmation.
const SEVERE_BURN_SEALED_PRODUCTS = new Set(['box', 'crate', 'vault']);

// ────────────────────────────────────────────────────────────────────
// Card-unit weights
// ────────────────────────────────────────────────────────────────────

/**
 * Card-units burned for a single sealed product of the given type.
 * Mirrors the product draw-slot counts; the burn settles the underlying
 * draw allocation, so a sealed Box = 240 card units even though only
 * one wrapper NFT is destroyed.
 *
 * @param {string} productType
 * @returns {number}
 */
export function cardUnitsForSealedProduct(productType) {
  if (!isValidProductType(productType)) {
    throw new Error(`unknown productType: ${productType}`);
  }
  return PRODUCTS[productType].drawSlots;
}

/**
 * Card-units burned for one revealed card. Always 1 regardless of
 * rarity — the rarity affects the warning level, not the cost.
 * @returns {number}
 */
export function cardUnitsForRevealedCard() {
  return 1;
}

// ────────────────────────────────────────────────────────────────────
// burnUnit math (BigInt, micro-USD scaled)
// ────────────────────────────────────────────────────────────────────

function priceToMicroUsdBigInt(priceUsd) {
  if (typeof priceUsd === 'bigint') {
    if (priceUsd < 0n) throw new Error(`priceUsd must be ≥ 0, got ${priceUsd}`);
    return priceUsd * MICRO;
  }
  const n = Number(priceUsd);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid priceUsd: ${priceUsd}`);
  // Split int + fractional so the multiplication into micro-USD
  // happens in BigInt space — keeps precision for very large late-curve
  // prices (Phase 6 reaches $6.942B per slot).
  const integer = Math.trunc(n);
  const fractional = n - integer;
  const intMicro = BigInt(integer) * MICRO;
  const fracMicro = BigInt(Math.round(fractional * 1e6));
  return intMicro + fracMicro;
}

function bitLengthBigInt(n) {
  // floor(log2(n)) = bit_length(n) - 1 for n ≥ 1.
  let count = 0;
  let v = n;
  while (v > 0n) {
    count++;
    v >>= 1n;
  }
  return count;
}

/**
 * Compute burnUnit (BigInt) for a given current draw price (USD).
 *
 * burnUnit(p) = max(BASE_BURN, BASE_BURN * 2 ^ floor(log2(p / 0.069)))
 *
 * Implemented in BigInt micro-USD space so no Number rounding drives
 * settlement. Always returns ≥ REDEMPTION_BASE_BURN.
 *
 * @param {number|bigint} currentDrawPriceUsd
 * @returns {bigint}
 */
export function burnUnitForPrice(currentDrawPriceUsd) {
  const microUsd = priceToMicroUsdBigInt(currentDrawPriceUsd);
  if (microUsd < BASE_PRICE_MICRO) {
    return BigInt(REDEMPTION_BASE_BURN);
  }
  const ratio = microUsd / BASE_PRICE_MICRO; // BigInt floor division
  if (ratio < 1n) return BigInt(REDEMPTION_BASE_BURN);
  const log2Floor = bitLengthBigInt(ratio) - 1; // floor(log2(ratio))
  const shifted = BigInt(REDEMPTION_BASE_BURN) << BigInt(log2Floor);
  return shifted < BigInt(REDEMPTION_BASE_BURN) ? BigInt(REDEMPTION_BASE_BURN) : shifted;
}

/**
 * Burn unit for the current redemption window — defined as the price
 * the next available draw slot would settle at on the public curve.
 *
 * @param {object} args
 * @param {number} args.nextDrawSlot   1..TOTAL_DRAW_SLOTS
 * @param {object} args.curveConfig
 * @returns {{burnUnit: bigint, currentDrawPriceUsd: number, nextDrawSlot: number}}
 */
export function burnUnitForNextDrawSlot({ nextDrawSlot, curveConfig }) {
  if (!Number.isInteger(nextDrawSlot) || nextDrawSlot < 1) {
    throw new Error(`nextDrawSlot must be a positive integer, got ${nextDrawSlot}`);
  }
  const { totalUsd } = batchPriceUsd(nextDrawSlot, 1, curveConfig);
  return {
    burnUnit: burnUnitForPrice(totalUsd),
    currentDrawPriceUsd: totalUsd,
    nextDrawSlot
  };
}

// ────────────────────────────────────────────────────────────────────
// cardUnits + coinUnits + redemption-draw math
// ────────────────────────────────────────────────────────────────────

function toNonNegBigInt(name, v) {
  let b;
  if (typeof v === 'bigint') b = v;
  else if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0 || !Number.isInteger(v)) {
      throw new Error(`${name} must be a non-negative integer, got ${v}`);
    }
    b = BigInt(v);
  } else if (typeof v === 'string') {
    try { b = BigInt(v); } catch {
      throw new Error(`${name} must be a base-10 integer string, got ${v}`);
    }
  } else {
    throw new Error(`${name} must be a non-negative integer, got ${v}`);
  }
  if (b < 0n) throw new Error(`${name} must be ≥ 0, got ${b}`);
  return b;
}

/**
 * floor(value / burnUnit). Pure BigInt math.
 * @returns {bigint}
 */
export function computeUnits(value, burnUnit) {
  const v = toNonNegBigInt('value', value);
  const u = toNonNegBigInt('burnUnit', burnUnit);
  if (u <= 0n) throw new Error(`burnUnit must be > 0, got ${u}`);
  return v / u;
}

/**
 * cardUnits = floor(cards / burnUnit).
 */
export function computeCardUnits(cards, burnUnit) {
  return computeUnits(cards, burnUnit);
}

/**
 * coinUnits = floor(coins / burnUnit).
 */
export function computeCoinUnits(coins, burnUnit) {
  return computeUnits(coins, burnUnit);
}

/**
 * Final redemption draws under the locked spec:
 *   redemptionDraws = min(cardUnits * 2, coinUnits)
 *
 * Cards set the base; coins can boost up to 2x. coinUnits must be
 * ≥ cardUnits (no shortage). coinUnits must be ≤ cardUnits * 2
 * (callers enforce overburn rejection upstream; this helper just
 * computes the min).
 *
 * @param {bigint|number|string} cardUnits
 * @param {bigint|number|string} coinUnits
 * @returns {bigint}
 */
export function computeRedemptionDraws(cardUnits, coinUnits) {
  const c = toNonNegBigInt('cardUnits', cardUnits);
  const k = toNonNegBigInt('coinUnits', coinUnits);
  const ceiling = c * BigInt(REDEMPTION_MAX_COIN_BOOST_MULTIPLIER);
  return k < ceiling ? k : ceiling;
}

// ────────────────────────────────────────────────────────────────────
// Warnings
// ────────────────────────────────────────────────────────────────────

/**
 * Produce warnings for the assets a user wants to burn. The math layer
 * surfaces these; the handler/UI is responsible for surfacing them and
 * blocking destructive actions until the user explicitly confirms.
 *
 * Each warning shape:
 *   { code, level, assetType, assetId, message }
 */
export function redemptionWarningsForItems(burnItems) {
  if (!Array.isArray(burnItems)) {
    throw new Error('burnItems must be an array');
  }
  const out = [];
  for (const item of burnItems) {
    if (!item || !isValidBurnAssetType(item.assetType)) continue;
    if (item.assetType === 'sealed_product') {
      const pt = item.productType;
      if (pt && SEVERE_BURN_SEALED_PRODUCTS.has(pt)) {
        out.push({
          code: 'BURN_SEALED_HIGH_VALUE',
          level: 'severe',
          assetType: 'sealed_product',
          assetId: item.assetId,
          message:
            `Sealed ${pt} contains ${PRODUCTS[pt].drawSlots} unrevealed draw slots — ` +
            `any hidden rare/mythic cards inside will be permanently retired.`
        });
      } else if (pt === 'pack') {
        out.push({
          code: 'BURN_SEALED_PACK',
          level: 'warn',
          assetType: 'sealed_product',
          assetId: item.assetId,
          message:
            'Sealed pack contains 10 unrevealed draw slots — they will be ' +
            'permanently retired and any hidden hits gone forever.'
        });
      }
      continue;
    }
    // card warnings
    if (item.isMythic === true) {
      out.push({
        code: 'BURN_MYTHIC_CARD',
        level: 'severe',
        assetType: 'card',
        assetId: item.assetId,
        message:
          'This is a 1/1 mythic card. Burning is permanent and the card cannot be recovered.'
      });
      continue;
    }
    if (item.variant && SEVERE_BURN_VARIANTS.has(item.variant)) {
      out.push({
        code: 'BURN_HIGH_VALUE_VARIANT',
        level: 'severe',
        assetType: 'card',
        assetId: item.assetId,
        message: `Burning a ${VARIANTS[item.variant]?.label ?? item.variant} card is permanent.`
      });
      continue;
    }
    if (item.rarityGroup && SEVERE_BURN_RARITIES.has(item.rarityGroup)) {
      out.push({
        code: 'BURN_HIGH_VALUE_RARITY',
        level: 'warn',
        assetType: 'card',
        assetId: item.assetId,
        message: `Burning a ${item.rarityGroup} card is permanent. Confirm before continuing.`
      });
    }
  }
  return out;
}

/**
 * Compute total card units across a list of burn items. Sealed
 * products contribute their draw-slot count; revealed cards contribute 1.
 *
 * @returns {bigint}
 */
export function sumCardUnits(burnItems) {
  if (!Array.isArray(burnItems)) throw new Error('burnItems must be an array');
  let total = 0n;
  for (const item of burnItems) {
    if (!item || !isValidBurnAssetType(item.assetType)) continue;
    if (item.assetType === 'card') {
      total += BigInt(cardUnitsForRevealedCard());
    } else if (item.assetType === 'sealed_product') {
      if (!item.productType || !isValidProductType(item.productType)) {
        throw new Error(`sealed_product missing/invalid productType: ${item.productType}`);
      }
      total += BigInt(cardUnitsForSealedProduct(item.productType));
    }
  }
  return total;
}

// ────────────────────────────────────────────────────────────────────
// Quote
// ────────────────────────────────────────────────────────────────────

function rejectionError(code, message, details) {
  const err = new Error(message);
  err.code = code;
  if (details) err.details = details;
  return err;
}

/**
 * Build a redemption quote under the final spec.
 *
 * Rejections:
 *   - INSUFFICIENT_SPANIELCOIN_BALANCE — offered > balance.
 *   - CARD_LEFTOVER                    — cards not a multiple of burnUnit.
 *   - COIN_LEFTOVER                    — coins not a multiple of burnUnit.
 *   - INSUFFICIENT_BURN_MATERIAL       — cardUnits == 0.
 *   - INSUFFICIENT_SPANIELCOIN_BOOST   — coinUnits < cardUnits.
 *   - COIN_OVERBURN                    — coinUnits > cardUnits * 2.
 *   - REDEMPTION_BATCH_TOO_LARGE       — redemptionDraws > cap.
 *
 * @param {object} args
 * @param {string} args.wallet
 * @param {Array<{
 *   assetType: 'card' | 'sealed_product',
 *   assetId: string,
 *   productType?: string,
 *   variant?: string,
 *   rarityGroup?: string,
 *   isMythic?: boolean
 * }>} args.burnItems
 * @param {bigint|number|string} args.spanielCoinOffered
 * @param {bigint|number|string} args.spanielCoinBalance
 * @param {number} args.nextDrawSlot
 * @param {object} args.curveConfig
 * @returns {object}
 */
export function computeRedemptionQuote(args) {
  const {
    wallet,
    burnItems,
    spanielCoinOffered,
    spanielCoinBalance,
    nextDrawSlot,
    curveConfig
  } = args ?? {};

  if (typeof wallet !== 'string' || wallet.length === 0) {
    throw new Error('wallet required');
  }
  if (!Array.isArray(burnItems) || burnItems.length === 0) {
    throw new Error('burnItems must be a non-empty array');
  }

  const offered = toNonNegBigInt('spanielCoinOffered', spanielCoinOffered);
  const balance = toNonNegBigInt('spanielCoinBalance', spanielCoinBalance);
  if (offered > balance) {
    throw rejectionError(
      'INSUFFICIENT_SPANIELCOIN_BALANCE',
      `insufficient SpanielCoin balance: offered ${offered}, available ${balance}`
    );
  }

  const cardsBurned = sumCardUnits(burnItems);
  const { burnUnit, currentDrawPriceUsd } = burnUnitForNextDrawSlot({ nextDrawSlot, curveConfig });

  // Exact-burn rule: neither cards nor coins may carry a remainder
  // below burnUnit. Anything else risks accidental overburn.
  const cardLeftover = cardsBurned % burnUnit;
  if (cardLeftover !== 0n) {
    throw rejectionError(
      'CARD_LEFTOVER',
      `cards burned ${cardsBurned} is not a multiple of burnUnit ${burnUnit}; leftover ${cardLeftover}`,
      { cardsBurned: cardsBurned.toString(), burnUnit: burnUnit.toString(), leftover: cardLeftover.toString() }
    );
  }
  const coinLeftover = offered % burnUnit;
  if (coinLeftover !== 0n) {
    throw rejectionError(
      'COIN_LEFTOVER',
      `SpanielCoin offered ${offered} is not a multiple of burnUnit ${burnUnit}; leftover ${coinLeftover}`,
      { spanielCoinOffered: offered.toString(), burnUnit: burnUnit.toString(), leftover: coinLeftover.toString() }
    );
  }

  const cardUnits = cardsBurned / burnUnit;
  const coinUnits = offered / burnUnit;

  if (cardUnits === 0n) {
    throw rejectionError(
      'INSUFFICIENT_BURN_MATERIAL',
      `cardUnits must be ≥ 1: cards=${cardsBurned}, burnUnit=${burnUnit}`
    );
  }
  if (coinUnits < cardUnits) {
    throw rejectionError(
      'INSUFFICIENT_SPANIELCOIN_BOOST',
      `SpanielCoin coinUnits ${coinUnits} < cardUnits ${cardUnits}; need at least ${cardUnits * burnUnit} SpanielCoin`,
      { cardUnits: cardUnits.toString(), coinUnits: coinUnits.toString(), needed: (cardUnits * burnUnit).toString() }
    );
  }
  const coinCeilingUnits = cardUnits * BigInt(REDEMPTION_MAX_COIN_BOOST_MULTIPLIER);
  if (coinUnits > coinCeilingUnits) {
    throw rejectionError(
      'COIN_OVERBURN',
      `SpanielCoin coinUnits ${coinUnits} > cardUnits*2 ${coinCeilingUnits}; max boost is ${REDEMPTION_MAX_COIN_BOOST_MULTIPLIER}x`,
      {
        cardUnits: cardUnits.toString(),
        coinUnits: coinUnits.toString(),
        maxCoinUnits: coinCeilingUnits.toString(),
        maxCoinValue: (coinCeilingUnits * burnUnit).toString()
      }
    );
  }

  const redemptionDraws = computeRedemptionDraws(cardUnits, coinUnits);
  if (redemptionDraws > BigInt(MAX_REDEMPTION_DRAWS_PER_TX)) {
    throw rejectionError(
      'REDEMPTION_BATCH_TOO_LARGE',
      `redemptionDraws ${redemptionDraws} exceeds cap ${MAX_REDEMPTION_DRAWS_PER_TX}; reduce burn batch`,
      { redemptionDraws: redemptionDraws.toString(), cap: MAX_REDEMPTION_DRAWS_PER_TX }
    );
  }

  // Effective coin multiplier vs the card base (1.0 ≤ m ≤ 2.0). For
  // display only; the settlement math uses cardUnits/coinUnits directly.
  const coinBoostMultiplier = cardUnits > 0n
    ? Number(coinUnits) / Number(cardUnits)
    : 0;

  const warnings = redemptionWarningsForItems(burnItems);

  return {
    wallet,
    nextDrawSlot,
    currentDrawPriceUsd,
    burnUnit,
    cardsBurned,
    spanielCoinOffered: offered,
    spanielCoinBalance: balance,
    cardUnits,
    coinUnits,
    redemptionDraws,
    coinBoostMultiplier,
    maxCoinBoostMultiplier: REDEMPTION_MAX_COIN_BOOST_MULTIPLIER,
    drawSlotStart: nextDrawSlot,
    drawSlotEnd: nextDrawSlot + Number(redemptionDraws) - 1,
    spanielCoinIssued: spanielCoinIssuedForRedemption(),
    spanielCoinIssuedNotice:
      'Redemption draws do not mint SpanielCoin. Only paid primary draws do.',
    maxRedemptionDrawsPerTx: MAX_REDEMPTION_DRAWS_PER_TX,
    warnings,
    burnItems
  };
}

// ────────────────────────────────────────────────────────────────────
// Public config / constants surface (for /api/redemptions/config)
// ────────────────────────────────────────────────────────────────────

export const REDEMPTION_PUBLIC_CONFIG = Object.freeze({
  baseBurn: REDEMPTION_BASE_BURN,
  basePriceUsd: REDEMPTION_BASE_PRICE_USD,
  maxCoinBoostMultiplier: REDEMPTION_MAX_COIN_BOOST_MULTIPLIER,
  maxRedemptionDrawsPerTx: MAX_REDEMPTION_DRAWS_PER_TX,
  cta: 'Burn cards + SpanielCoin to rip again.',
  boostNotice:
    'Cards set your base redemption units. Extra SpanielCoin can boost output up to 2x.',
  noSpanielCoinNotice:
    'Redemption draws do not mint SpanielCoin. Only paid primary draws do.',
  spanielCoinForbidden:
    'SpanielCoin is a Series 1 utility token, not an investment. ' +
    'Redemption draws retire it permanently.'
});

/**
 * Defensive check used by the handler: refuses to issue SpanielCoin
 * on redemption recording. Always returns 0n. Callers MUST use this
 * (rather than skipping the call) so behavior is explicit and tested.
 *
 * @returns {bigint}
 */
export function spanielCoinForRedemptionRecord() {
  return spanielCoinIssuedForRedemption();
}

/**
 * Validate that a sealed product type is one we accept for burn.
 * @param {string} productType
 */
export function isBurnableSealedProductType(productType) {
  return isValidProductType(productType);
}

/**
 * Validate that a variant slug is one of the canonical Series 1
 * variants — accepted for surface validation; the actual decision
 * about whether the card itself is burnable lives in the handler.
 * @param {string} variant
 */
export function isBurnableVariantSlug(variant) {
  return isValidVariantSlug(variant) || Object.keys(RARITY_GROUPS).includes(variant);
}
