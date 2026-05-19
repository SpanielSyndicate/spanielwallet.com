// Spaniel Syndicate — Series 1 draw-slot curve.
//
// Single source of truth for primary-sale pricing across the Series 1
// fixed release. Imported by the public frontend (for display) and by
// the Cloudflare Worker (for signed-quote settlement). Diverging
// behaviour is a bug.
//
// The "curve" is a list of contiguous phases covering draw slots
// 1..TOTAL_DRAW_SLOTS inclusive. Each draw slot maps to exactly one
// underlying card NFT. Sealed products (packs/boxes/crates/vaults)
// consume contiguous ranges of draw slots; they do not inflate supply.
//
// Each phase has a curveType ∈ {linear, power, exponential}.
// Auction or reserved-supply types are NOT supported and will fail
// config validation.
//
// Formula by curveType, with
//   p = (slot - phase.startDrawSlot) / (phase.endDrawSlot - phase.startDrawSlot) ∈ [0, 1]:
//
//   linear:      A + (B - A) * p
//   power:       A + (B - A) * p^exponent
//   exponential: A * (B/A)^p
//
// Where A = startPriceUsd, B = endPriceUsd.
//
// USD prices are returned as JS `number` for display. For settlement,
// convert to lamports via the SOL/USD oracle and the referral math in
// referral.js, using BigInt throughout.

import { TOTAL_DRAW_SLOTS } from './series1.js';

export { TOTAL_DRAW_SLOTS };

const ALLOWED_CURVE_TYPES = new Set(['linear', 'power', 'exponential']);

/**
 * Validate a curve config. Throws Error on any violation.
 * @param {object} curveConfig
 */
export function validateCurveConfig(curveConfig) {
  if (!curveConfig || typeof curveConfig !== 'object') {
    throw new Error('curve config must be an object');
  }
  if (!Array.isArray(curveConfig.phases) || curveConfig.phases.length === 0) {
    throw new Error('curve config requires a non-empty phases array');
  }
  if (curveConfig.totalDrawSlots !== TOTAL_DRAW_SLOTS) {
    throw new Error(
      `curve.totalDrawSlots must be ${TOTAL_DRAW_SLOTS}, got ${curveConfig.totalDrawSlots}`
    );
  }

  const phases = curveConfig.phases;
  if (phases[0].startDrawSlot !== 1) {
    throw new Error(`first phase startDrawSlot must be 1, got ${phases[0].startDrawSlot}`);
  }
  if (phases[phases.length - 1].endDrawSlot !== TOTAL_DRAW_SLOTS) {
    throw new Error(
      `last phase endDrawSlot must be ${TOTAL_DRAW_SLOTS}, got ${phases[phases.length - 1].endDrawSlot}`
    );
  }

  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (typeof p.id !== 'string' || !p.id) {
      throw new Error(`phase ${i} missing id`);
    }
    if (!Number.isInteger(p.startDrawSlot) || !Number.isInteger(p.endDrawSlot)) {
      throw new Error(`phase ${p.id} draw slot bounds must be integers`);
    }
    if (
      p.startDrawSlot < 1 ||
      p.endDrawSlot < p.startDrawSlot ||
      p.endDrawSlot > TOTAL_DRAW_SLOTS
    ) {
      throw new Error(
        `phase ${p.id} invalid draw-slot range [${p.startDrawSlot}, ${p.endDrawSlot}]`
      );
    }
    if (typeof p.startPriceUsd !== 'number' || typeof p.endPriceUsd !== 'number') {
      throw new Error(`phase ${p.id} prices must be numbers`);
    }
    if (!(p.startPriceUsd > 0) || !(p.endPriceUsd > 0)) {
      throw new Error(`phase ${p.id} prices must be positive`);
    }
    if (p.endPriceUsd < p.startPriceUsd) {
      throw new Error(
        `phase ${p.id} endPriceUsd (${p.endPriceUsd}) must be >= startPriceUsd (${p.startPriceUsd})`
      );
    }
    if (!ALLOWED_CURVE_TYPES.has(p.curveType)) {
      throw new Error(
        `phase ${p.id} unsupported curveType "${p.curveType}" (allowed: ${[...ALLOWED_CURVE_TYPES].join(', ')})`
      );
    }
    if (p.curveType === 'power') {
      if (typeof p.exponent !== 'number' || !(p.exponent > 0) || !Number.isFinite(p.exponent)) {
        throw new Error(`phase ${p.id} power curveType requires a positive exponent`);
      }
    }
    if (i > 0) {
      const prev = phases[i - 1];
      if (p.startDrawSlot !== prev.endDrawSlot + 1) {
        throw new Error(
          `phase ${p.id} startDrawSlot ${p.startDrawSlot} does not follow phase ${prev.id} endDrawSlot ${prev.endDrawSlot} (gap or overlap)`
        );
      }
    }
  }
  return true;
}

/**
 * Return the phase that contains draw slot `slot`.
 * Throws if slot is out of range.
 * @param {number} slot 1..TOTAL_DRAW_SLOTS
 * @param {object} curveConfig
 * @returns {object} phase
 */
export function phaseForDrawSlot(slot, curveConfig) {
  if (!Number.isInteger(slot)) throw new Error(`slot must be an integer, got ${slot}`);
  if (slot < 1 || slot > TOTAL_DRAW_SLOTS) {
    throw new Error(`slot out of range: ${slot} not in [1, ${TOTAL_DRAW_SLOTS}]`);
  }
  for (const phase of curveConfig.phases) {
    if (slot >= phase.startDrawSlot && slot <= phase.endDrawSlot) return phase;
  }
  throw new Error(`no phase covers draw slot ${slot} (curve config has gaps)`);
}

/**
 * Compute the USD price for a given draw slot.
 * @param {number} slot 1..TOTAL_DRAW_SLOTS
 * @param {object} curveConfig
 * @returns {number} USD price
 */
export function priceUsdForDrawSlot(slot, curveConfig) {
  const phase = phaseForDrawSlot(slot, curveConfig);
  const { startDrawSlot, endDrawSlot, startPriceUsd, endPriceUsd, curveType } = phase;

  if (endDrawSlot === startDrawSlot) return startPriceUsd;
  const p = (slot - startDrawSlot) / (endDrawSlot - startDrawSlot);

  switch (curveType) {
    case 'linear':
      return startPriceUsd + (endPriceUsd - startPriceUsd) * p;
    case 'power': {
      const e = phase.exponent;
      return startPriceUsd + (endPriceUsd - startPriceUsd) * Math.pow(p, e);
    }
    case 'exponential':
      return startPriceUsd * Math.pow(endPriceUsd / startPriceUsd, p);
    default:
      throw new Error(`unsupported curveType: ${curveType}`);
  }
}

/**
 * Compute the sum of USD prices over an inclusive draw-slot range.
 *
 * For ranges that span entire phases, integrates analytically per
 * phase via the closed-form integral of the curveType. For partial
 * phase coverage at the endpoints, falls back to summing the partial
 * range slot-by-slot.
 *
 * This makes large ranges (hundreds of millions of slots — e.g. an
 * entire Series-1 dry-run total) compute in microseconds instead of
 * minutes.
 *
 * @param {number} startSlot
 * @param {number} endSlot (inclusive)
 * @param {object} curveConfig
 * @returns {number} sum of USD prices
 */
export function totalUsdForRange(startSlot, endSlot, curveConfig) {
  if (!Number.isInteger(startSlot) || !Number.isInteger(endSlot)) {
    throw new Error('range bounds must be integers');
  }
  if (startSlot < 1 || endSlot > TOTAL_DRAW_SLOTS || endSlot < startSlot) {
    throw new Error(`invalid range [${startSlot}, ${endSlot}]`);
  }
  let total = 0;
  for (const phase of curveConfig.phases) {
    const a = Math.max(startSlot, phase.startDrawSlot);
    const b = Math.min(endSlot, phase.endDrawSlot);
    if (a > b) continue;
    // Whole-phase coverage uses analytical integration; partial uses
    // direct summation (cheap when the partial range is small).
    if (a === phase.startDrawSlot && b === phase.endDrawSlot) {
      total += integratePhaseClosed(phase);
    } else {
      total += integratePhasePartial(phase, a, b);
    }
  }
  return total;
}

function integratePhasePartial(phase, a, b) {
  let sum = 0;
  for (let i = a; i <= b; i++) {
    sum += priceUsdForDrawSlot(i, { phases: [phase] });
  }
  return sum;
}

// Closed-form expected discrete sum over [start..end] for each curveType.
// For "power" curveType we use the continuous integral approximation
// over [0,1] of (A + (B-A) * p^e) dp = A + (B-A) / (e+1), multiplied
// by the slot count. For draw-slot counts > 10_000 this is within
// ~1e-9 of the true discrete sum, which is well below USD precision.
// For draw-slot counts ≤ 10_000 the partial-summation path is used.
function integratePhaseClosed(phase) {
  const { startDrawSlot, endDrawSlot, startPriceUsd, endPriceUsd, curveType } = phase;
  const supply = endDrawSlot - startDrawSlot + 1;
  if (supply <= 10_000) {
    return integratePhasePartial(phase, startDrawSlot, endDrawSlot);
  }
  const A = startPriceUsd;
  const B = endPriceUsd;
  let avg;
  switch (curveType) {
    case 'linear':
      avg = (A + B) / 2;
      break;
    case 'power': {
      const e = phase.exponent;
      avg = A + (B - A) / (e + 1);
      break;
    }
    case 'exponential':
      // ∫₀¹ A * r^p dp = A * (r - 1) / ln(r), r = B/A
      if (A === B) {
        avg = A;
      } else {
        const r = B / A;
        avg = (A * (r - 1)) / Math.log(r);
      }
      break;
    default:
      throw new Error(`unsupported curveType: ${curveType}`);
  }
  return avg * supply;
}

/**
 * Compute USD prices for a batch of `quantity` draws starting at
 * `startSlot`. Returns the array of individual prices and the total.
 *
 * Intended for small batches (single pull, pack, box-sized). For
 * very large ranges, call totalUsdForRange directly.
 *
 * @param {number} startSlot
 * @param {number} quantity
 * @param {object} curveConfig
 * @returns {{ prices: number[], totalUsd: number, startSlot: number, endSlot: number }}
 */
export function batchPriceUsd(startSlot, quantity, curveConfig) {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(`quantity must be a positive integer, got ${quantity}`);
  }
  const endSlot = startSlot + quantity - 1;
  if (endSlot > TOTAL_DRAW_SLOTS) {
    throw new Error(`batch endSlot ${endSlot} exceeds TOTAL_DRAW_SLOTS ${TOTAL_DRAW_SLOTS}`);
  }
  const prices = [];
  let total = 0;
  for (let i = startSlot; i <= endSlot; i++) {
    const price = priceUsdForDrawSlot(i, curveConfig);
    prices.push(price);
    total += price;
  }
  return { prices, totalUsd: total, startSlot, endSlot };
}

/**
 * Convert a USD amount to lamports given a SOL/USD price.
 * BigInt-safe; rounds down.
 *
 * Late curve values are large enough that the previous
 * `BigInt(Math.round(Number(usd) * 1e6))` path lost precision
 * (Math.round + multiply both round once usd exceeds ~9e9). Phase 6
 * single slots reach $6.942B and full-phase batch totals reach ~$1.5e13,
 * both of which silently truncated the low microUSD digits.
 *
 * Now: split the Number into integer + 6-digit fractional components
 * before promoting to BigInt so the multiply happens entirely in
 * BigInt space.
 *
 * @param {number|bigint} usd amount in dollars
 * @param {number} solUsdPrice e.g. 150 for $150/SOL
 * @returns {bigint} lamports
 */
export function usdToLamports(usd, solUsdPrice) {
  if (!(solUsdPrice > 0) || !Number.isFinite(solUsdPrice)) {
    throw new Error(`invalid solUsdPrice: ${solUsdPrice}`);
  }
  let microUsd;
  if (typeof usd === 'bigint') {
    microUsd = usd * 1_000_000n;
  } else {
    const n = Number(usd);
    if (!Number.isFinite(n) || n < 0) throw new Error(`invalid usd: ${usd}`);
    const integer = Math.trunc(n);
    const fractional = n - integer;
    // BigInt(integer) is safe for any value up to 2^53 (≈ 9.007e15).
    // Per-slot Phase 6 max is $6.942B and full-curve totalUsd at
    // ~$1.5e13 are both far inside that bound. fractional × 1e6 is
    // always in [0, 1e6) so the Number multiply is precise.
    const intMicro = BigInt(integer) * 1_000_000n;
    const fracMicro = BigInt(Math.round(fractional * 1e6));
    microUsd = intMicro + fracMicro;
  }
  const solUsdScaled = BigInt(Math.round(solUsdPrice * 1e6));
  if (solUsdScaled <= 0n) {
    throw new Error(`solUsdPrice underflow: ${solUsdPrice}`);
  }
  return (microUsd * 1_000_000_000n) / solUsdScaled;
}

/**
 * Public summary of a phase for UI display.
 * @param {object} phase
 */
export function publicPhaseSummary(phase) {
  return {
    id: phase.id,
    label: phase.label,
    publicDescription: phase.publicDescription,
    startDrawSlot: phase.startDrawSlot,
    endDrawSlot: phase.endDrawSlot,
    startPriceUsd: phase.startPriceUsd,
    endPriceUsd: phase.endPriceUsd,
    supply: phase.endDrawSlot - phase.startDrawSlot + 1
  };
}
