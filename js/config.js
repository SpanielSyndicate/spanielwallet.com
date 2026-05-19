// ─── CONFIG ──────────────────────────────────────────────────────────
//
// Volatile values (RPC endpoint, program ID, treasury, API base, drop
// metadata) come from /runtime-config.json fetched on module load with
// cache:'no-store'. Curve config comes from /config/curve.json — also
// cache:'no-store' so deploys are immediate.
//
// Stable constants (the mpl-core program id, the well-known wrapped
// SOL mint, MAX_SUPPLY) stay in this file.
//
// Top-level await pauses every importer until both fetches resolve, so
// all downstream callers see consistent values.

import { assertSafeRpcUrl } from './config-asserts.js';
import { validateCurveConfig } from './lib/curve.js';
import { CANONICAL_DOG_COUNT } from './lib/series1.js';
import {
  METAPLEX_CORE_PROGRAM_ID,
} from './lib/solana-program-ids.js';
import {
  assertNoSecretInUrlFields,
  resolvePublicSiteOrigin,
  resolveWalletSiteOrigin,
  resolveAppBasePath,
  walletSiteIsLive,
  walletLaunchUrl,
} from './lib/site-config.js';

// ────────────────────────────────────────────────────────────────────
// Runtime config (network + program + treasury + API + drops)
// ────────────────────────────────────────────────────────────────────

async function fetchRuntimeConfig() {
  try {
    const res = await fetch('./runtime-config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const cfg = await res.json();
    const required = ['rpcUrl', 'programIdStr', 'treasuryStr'];
    for (const k of required) {
      if (typeof cfg[k] !== 'string') {
        throw new Error(`runtime-config.json: missing required field "${k}"`);
      }
    }
    assertSafeRpcUrl(cfg.rpcUrl);
    assertNoSecretInUrlFields(cfg);
    if (!Array.isArray(cfg.drops)) cfg.drops = [];
    return cfg;
  } catch (err) {
    // Secret-bearing URL is fatal by design.
    if (/secret-bearing URL/.test(err.message || '')) throw err;
    console.error('runtime-config.json load failed:', err.message);
    return {
      rpcUrl: '',
      apiBaseUrl: '',
      siteOrigin: typeof location !== 'undefined' ? location.origin : '',
      programIdStr: 'SpAn1eLDr0p1111111111111111111111111111111',
      series1ProgramId: null,
      treasuryStr: 'TreasuryAddressGoesHereBeforeDeploy11111111',
      quoteSignerPubkey: null,
      marketplaceFeeBps: 200,
      marketplaceReferrerShareBps: 5000,
      buyerReferralDiscountBps: 1000,
      pendingProgramDeployment: true,
      drops: []
    };
  }
}

async function fetchCurveConfig() {
  try {
    const res = await fetch('./config/curve.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const curve = await res.json();
    validateCurveConfig(curve);
    return curve;
  } catch (err) {
    console.error('curve.json load failed:', err.message);
    return null;
  }
}

const [_cfg, _curve] = await Promise.all([fetchRuntimeConfig(), fetchCurveConfig()]);

// ────────────────────────────────────────────────────────────────────
// Exported network config
// ────────────────────────────────────────────────────────────────────

export const RPC_URL = _cfg.rpcUrl;
export const API_BASE_URL = _cfg.apiBaseUrl || '';

// Product split: the marketing/showcase site (spanielsyndicate.com)
// and the wallet/app product (spanielwallet.com once the DNS is live,
// otherwise spanielsyndicate.com/app). See docs/DEPLOYMENT.md and
// js/lib/site-config.js.
export const SITE_ORIGIN =
  resolvePublicSiteOrigin(_cfg) ||
  (typeof location !== 'undefined' ? location.origin : '');
export const PUBLIC_SITE_ORIGIN = SITE_ORIGIN;
export const WALLET_SITE_ORIGIN =
  resolveWalletSiteOrigin(_cfg) || SITE_ORIGIN;
export const APP_BASE_PATH = resolveAppBasePath(_cfg);
export const WALLET_IS_LIVE_AT_OWN_ORIGIN = walletSiteIsLive(_cfg);

/** Compute a wallet launch URL (origin-relative when same-origin). */
export function buildWalletLaunchUrl(subPath = '/') {
  return walletLaunchUrl(_cfg, subPath);
}

export const PROGRAM_ID_STR = _cfg.programIdStr;
export const SERIES1_PROGRAM_ID = _cfg.series1ProgramId || null;
export const TREASURY_STR = _cfg.treasuryStr;
export const QUOTE_SIGNER_PUBKEY = _cfg.quoteSignerPubkey || null;

export const DROPS = _cfg.drops;
export function activeDrop() {
  return DROPS.length > 0 ? DROPS[DROPS.length - 1] : null;
}

// ────────────────────────────────────────────────────────────────────
// Pricing / fee constants (mirror the on-chain + Worker constants)
// ────────────────────────────────────────────────────────────────────

// `MAX_SUPPLY` here is the canonical Spaniel checklist size (69,420).
// It is NOT the Series 1 card supply (1,000,000,000 = TOTAL_DRAW_SLOTS
// in series1.js). Use this for legacy callers that index into the
// Spaniel-identity rotation (data.js::computeVisualId, bootstrap.js
// preview); use TOTAL_DRAW_SLOTS for the product-purchase math.
export const MAX_SUPPLY = CANONICAL_DOG_COUNT;
export const MARKETPLACE_FEE_BPS = _cfg.marketplaceFeeBps ?? 200;
export const MARKETPLACE_REFERRER_SHARE_BPS = _cfg.marketplaceReferrerShareBps ?? 5000;
export const BUYER_REFERRAL_DISCOUNT_BPS = _cfg.buyerReferralDiscountBps ?? 1000;

// True while the Series 1 Program has not yet been deployed. Used by
// the mint widget + marketplace UI to gate the submit/buy buttons
// behind a clear "Series 1 Program deployment pending" status. See
// CLAUDE.md §0 "No fake live UI".
export const PENDING_PROGRAM_DEPLOYMENT =
  _cfg.pendingProgramDeployment === true || SERIES1_PROGRAM_ID === null;

// ────────────────────────────────────────────────────────────────────
// Curve config
// ────────────────────────────────────────────────────────────────────

export const CURVE_CONFIG = _curve;
export const CURVE_LOADED = _curve !== null;

// ────────────────────────────────────────────────────────────────────
// Placeholders / health
// ────────────────────────────────────────────────────────────────────

export const isPlaceholder = () =>
  PROGRAM_ID_STR.startsWith('SpAn1eLDr0p1111111') ||
  TREASURY_STR.startsWith('TreasuryAddress') ||
  !RPC_URL ||
  !CURVE_LOADED;

// ────────────────────────────────────────────────────────────────────
// Stable Solana constants (not project state)
// ────────────────────────────────────────────────────────────────────

// Wrapped SOL mint — wire-format Solana ecosystem constant. Lives here
// (not in solana-program-ids.js) because it's a *mint*, not a program id.
export const SOL_MINT_STR = 'So11111111111111111111111111111111111111112';
export const MPL_CORE_PROGRAM_ID_STR = METAPLEX_CORE_PROGRAM_ID;

// ────────────────────────────────────────────────────────────────────
// Solana tx fee defaults (for display only)
// ────────────────────────────────────────────────────────────────────

export const BASE_LAMPORTS = 5_000;
export const PRIORITY_LAMPORTS = 10_000;

// Maximum NFTs the user can mint in a single transaction under the
// Series 1 Program. The earlier asm fair-launch crate used
// signAllTransactions to fan out individual mints; the Series 1
// Program supports batch-in-one-tx with quantity in the quote.
export const MAX_BATCH_PER_PURCHASE = 25;

// ────────────────────────────────────────────────────────────────────
// DEPRECATED — flat-price constants retained for backward compatibility
// while js/mint.js and index.html are being refactored. Will be
// removed once the quote-driven mint flow lands.
//
// DO NOT USE in new code. The buyer-pays amount comes from the
// server-signed quote (see js/api.js::requestMintQuote).
// ────────────────────────────────────────────────────────────────────

export const MINT_PRICE_LAMPORTS = 100_000_000;
export const MINT_PRICE_SOL = 0.1;
