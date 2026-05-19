// Shared SOL / lamport display helper.
//
// Lamport amounts can grow into the 1e23 range late in the curve
// (post-vault tier and final-4,200-slot spectacle). `Number(lamports)
// / 1e9` then prints "Infinity" or rounded-wrong digits because the
// intermediate Number is past `Number.MAX_SAFE_INTEGER`.
//
// `formatSolLamports` splits the BigInt into integer + fractional
// parts before any float conversion, so display stays accurate to
// the lamport regardless of magnitude.
//
// Used by:
//   * js/lib/products.js — `formatProductQuote`
//   * js/lib/marketplace-math.js — `formatMarketplaceFeeBreakdown`
//   * js/lib/packline.js — `formatPacklineBreakdown`
//   * js/spaniel-wallet/* — page-level formatting
//
// Mirrors `formatSol` in js/spaniel-wallet/send-confirm.js (kept
// separate so the wallet PWA doesn't pull in the full lib pipeline).

const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Format a lamport amount as SOL with trailing-zero trim.
 *
 * @param {bigint|number|string} lamports
 * @param {number} [decimals=9]  digits after the decimal point
 * @returns {string}
 */
export function formatSolLamports(lamports, decimals = 9, opts = {}) {
  if (lamports == null) return '0';
  let n;
  if (typeof lamports === 'bigint') {
    n = lamports;
  } else if (typeof lamports === 'string' || typeof lamports === 'number') {
    n = BigInt(lamports);
  } else {
    throw new TypeError('formatSolLamports: lamports must be bigint | number | string');
  }
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = abs % LAMPORTS_PER_SOL;
  const padZeros = !!opts.padZeros;
  if (decimals <= 0) {
    return (negative ? '-' : '') + whole.toString();
  }
  const fracStr = frac.toString().padStart(9, '0').slice(0, Math.min(9, decimals));
  if (padZeros) {
    return (negative ? '-' : '') + whole.toString() + '.' + fracStr;
  }
  const trimmed = fracStr.replace(/0+$/, '');
  if (!trimmed) return (negative ? '-' : '') + whole.toString();
  return (negative ? '-' : '') + whole.toString() + '.' + trimmed;
}

/** Convenience: format with " SOL" suffix at a fixed precision. */
export function formatSolWithSuffix(lamports, decimals = 6) {
  return `${formatSolLamports(lamports, decimals)} SOL`;
}

export { LAMPORTS_PER_SOL };
