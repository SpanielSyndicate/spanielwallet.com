// Spaniel Wallet — unit helpers.
//
// SOL is denominated in lamports (1 SOL = 1e9 lamports). All money
// math uses BigInt. Display formatting can use JS number, but only
// AFTER the BigInt computation is final.

export const LAMPORTS_PER_SOL_BIG = 1_000_000_000n;
export const LAMPORTS_PER_SOL_NUM = 1_000_000_000;

export function solToLamports(sol) {
  if (typeof sol === 'bigint') return sol * LAMPORTS_PER_SOL_BIG;
  if (typeof sol === 'number') {
    if (!Number.isFinite(sol)) throw new RangeError('sol must be finite');
    // Avoid float drift: format with 9 dp, parse as BigInt fragments.
    const sign = sol < 0 ? -1n : 1n;
    const abs = Math.abs(sol);
    const intPart = Math.floor(abs);
    const fracStr = (abs - intPart).toFixed(9).slice(2); // '123456789'
    const lamports = BigInt(intPart) * LAMPORTS_PER_SOL_BIG + BigInt(fracStr);
    return sign * lamports;
  }
  throw new TypeError('sol must be bigint or number');
}

export function lamportsToSolNum(lamports) {
  if (typeof lamports !== 'bigint') {
    throw new TypeError('lamports must be bigint');
  }
  // Display only — safe for any human-readable balance below ~9 quadrillion lamports.
  const whole = lamports / LAMPORTS_PER_SOL_BIG;
  const frac = lamports % LAMPORTS_PER_SOL_BIG;
  return Number(whole) + Number(frac) / LAMPORTS_PER_SOL_NUM;
}

export function formatSolLamports(lamports, fractionDigits = 4) {
  return lamportsToSolNum(lamports).toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  });
}
