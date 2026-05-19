// Packline sponsor override math — single source of truth.
//
// Same module imported by the public frontend (for display) and by
// the Cloudflare Worker (for signed quotes). Diverging behaviour is
// a bug.
//
// Packline is a five-level sponsor override system on top of the
// existing direct affiliate program (Barklink). Level 1 is the
// direct affiliate (their existing 6.9%–69% commission applies).
// Levels 2–5 are upstream sponsor overrides paid from the post-
// rescue residual when an actual product sale or marketplace/offer
// fee is paid.
//
// Strict rules:
//   - Packline pays ONLY on actual product purchases / marketplace
//     trades / accepted offers. Never on signup, never on creating
//     a Barklink, never on holding.
//   - Packline overrides come out of the Spaniel treasury share —
//     not from the buyer, not from the seller, not from the Rescue
//     Pool, not from the direct affiliate commission.
//   - Missing ancestor at a level → that level's amount stays with
//     treasury (the bps is not redistributed up the chain).
//   - No direct affiliate → no Packline overrides at all.
//   - Packline rights are NOT marketplace-tradeable. Account
//     transfer/recovery exists for wallet safety only.
//
// Public-safe copy mirrors docs/PACKLINE.md:
//   "Packline sponsor overrides reward promoters whose buyers later
//    become successful promoters. No one earns for signups alone.
//    Packline pays only when actual Spaniel products are purchased
//    or traded."

import { BPS_DENOMINATOR } from './bps.js';
import { formatSolLamports } from './format-sol.js';

export const PACKLINE_LEVEL_2_BPS = 400;  // 4.00%
export const PACKLINE_LEVEL_3_BPS = 300;  // 3.00%
export const PACKLINE_LEVEL_4_BPS = 200;  // 2.00%
export const PACKLINE_LEVEL_5_BPS = 100;  // 1.00%
export const PACKLINE_TOTAL_OVERRIDE_BPS = 1000; // 10.00%
export const PACKLINE_MAX_DEPTH = 5;
export const PACKLINE_UPSTREAM_DEPTH = 4;
export const PACKLINE_BPS_DENOMINATOR = BPS_DENOMINATOR;

/** Frozen [level, bps] table for the four upstream override levels. */
export const PACKLINE_LEVEL_BPS = Object.freeze([
  Object.freeze({ level: 2, bps: PACKLINE_LEVEL_2_BPS }),
  Object.freeze({ level: 3, bps: PACKLINE_LEVEL_3_BPS }),
  Object.freeze({ level: 4, bps: PACKLINE_LEVEL_4_BPS }),
  Object.freeze({ level: 5, bps: PACKLINE_LEVEL_5_BPS })
]);

/**
 * Look up the bps for an upstream Packline level (2..5). Returns 0
 * for level 1 (the direct affiliate is paid by its own bps formula,
 * not by this table) and for any level outside 2..5.
 *
 * @param {number} level
 * @returns {number}
 */
export function packlineBpsForLevel(level) {
  switch (level) {
    case 2: return PACKLINE_LEVEL_2_BPS;
    case 3: return PACKLINE_LEVEL_3_BPS;
    case 4: return PACKLINE_LEVEL_4_BPS;
    case 5: return PACKLINE_LEVEL_5_BPS;
    default: return 0;
  }
}

/**
 * Compute Packline override amounts from a base lamport pool.
 *
 * The base pool is:
 *   - primary sale: postRescueLamports
 *   - marketplace fee: postRescueMarketFeeLamports
 *   - offer fee: postRescueMarketFeeLamports (same shape)
 *
 * Ancestors is the ordered upstream sponsor chain, level-2 first.
 * Each entry should be either:
 *   - null/undefined — slot is empty (treasury keeps the amount)
 *   - { wallet: string }
 *
 * Missing ancestors at any level cause that level's lamports to
 * remain with treasury (the bps is not bumped up to fill).
 *
 * @param {object} args
 * @param {bigint} args.baseLamports
 * @param {Array<null|undefined|{wallet:string}>} [args.ancestors]
 * @returns {{
 *   overrides: Array<{ level:number, wallet:string|null, bps:number, lamports:bigint }>,
 *   totalLamports: bigint
 * }}
 */
export function computePacklineOverrides({ baseLamports, ancestors }) {
  if (typeof baseLamports !== 'bigint') {
    throw new Error('baseLamports must be a BigInt');
  }
  if (baseLamports < 0n) {
    throw new Error('baseLamports must be non-negative');
  }
  const list = Array.isArray(ancestors) ? ancestors : [];
  const overrides = [];
  let total = 0n;
  for (let i = 0; i < PACKLINE_UPSTREAM_DEPTH; i++) {
    const level = i + 2; // levels 2..5
    const bps = packlineBpsForLevel(level);
    const ancestor = list[i] ?? null;
    let wallet = null;
    let lamports = 0n;
    if (ancestor && typeof ancestor.wallet === 'string' && ancestor.wallet.length > 0) {
      wallet = ancestor.wallet;
      lamports = (baseLamports * BigInt(bps)) / BigInt(PACKLINE_BPS_DENOMINATOR);
      total += lamports;
    }
    overrides.push({ level, wallet, bps, lamports });
  }
  return { overrides, totalLamports: total };
}

/**
 * Render an empty Packline split for the "no direct affiliate" or
 * "no ancestor chain" cases. Returns four placeholder rows so quote
 * shapes stay constant regardless of chain depth.
 *
 * @returns {{
 *   overrides: Array<{ level:number, wallet:null, bps:number, lamports:bigint }>,
 *   totalLamports: bigint
 * }}
 */
export function emptyPacklineOverrides() {
  return {
    overrides: PACKLINE_LEVEL_BPS.map(({ level, bps }) => ({
      level,
      wallet: null,
      bps,
      lamports: 0n
    })),
    totalLamports: 0n
  };
}

/**
 * Normalize a list of up to four upstream ancestor wallets into the
 * shape consumed by computePacklineOverrides.
 *
 * Accepts an array of wallet strings (or nulls) and truncates to
 * PACKLINE_UPSTREAM_DEPTH.
 *
 * @param {Array<string|null|undefined>} wallets
 */
export function ancestorsFromWalletList(wallets) {
  const list = Array.isArray(wallets) ? wallets.slice(0, PACKLINE_UPSTREAM_DEPTH) : [];
  return list.map((w) =>
    typeof w === 'string' && w.length > 0 ? { wallet: w } : null
  );
}

/**
 * Throw if a proposed Packline ancestor chain would self-sponsor or
 * cycle. Caller passes the buyer/new affiliate wallet plus the
 * proposed chain (level-2 sponsor first, then their sponsor, …).
 *
 * Pure check; does not mutate. Returns true on success.
 *
 * @param {string} selfWallet
 * @param {Array<string|null|undefined>} chain  upstream sponsors, level-2 first
 */
export function assertNoSelfOrCycle(selfWallet, chain) {
  if (typeof selfWallet !== 'string' || selfWallet.length === 0) {
    throw new Error('selfWallet must be a non-empty string');
  }
  const seen = new Set([selfWallet]);
  const list = Array.isArray(chain) ? chain : [];
  for (const w of list) {
    if (w == null || w === '') continue;
    if (typeof w !== 'string') {
      throw new Error('sponsor chain entries must be strings or null');
    }
    if (seen.has(w)) {
      throw new Error(`Packline cycle/self-sponsor rejected at wallet ${w}`);
    }
    seen.add(w);
  }
  return true;
}

/**
 * Format a Packline overrides breakdown for display.
 *
 * @param {{overrides: Array, totalLamports: bigint}} split
 */
export function formatPacklineBreakdown(split) {
  const fmt = (l) => `${formatSolLamports(l, 6, { padZeros: true })} SOL`;
  return {
    overrides: split.overrides.map((o) => ({
      level: o.level,
      wallet: o.wallet,
      bps: o.bps,
      pct: `${(o.bps / 100).toFixed(2)}%`,
      lamports: fmt(o.lamports)
    })),
    total: fmt(split.totalLamports)
  };
}
