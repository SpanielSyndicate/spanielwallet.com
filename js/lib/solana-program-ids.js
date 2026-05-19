// Well-known Solana program ids — single source of truth.
//
// Every reference to these addresses across the public repo, the
// Cloudflare Worker (via vendor sync), the Spaniel Wallet PWA, and
// the ops devnet scripts MUST import from this module. NEVER inline
// the literal strings in handler code, test fixtures, or scripts —
// the literal is a hidden coupling and an audit hazard.
//
// All identifiers below are wire-format constants of the Solana
// ecosystem — they are the SAME bytes on devnet, testnet, and
// mainnet. Per-cluster RPC URLs and per-deploy Series 1 / SpanielCoin
// addresses live in `solana-networks.js` and `runtime-config.json`
// respectively.
//
// Provenance for each id:
//   System Program        — anchored in solana-program-library; null pubkey.
//   Sysvar: Instructions  — solana-sdk/src/sysvar/instructions.rs.
//   Sysvar: Rent          — solana-sdk/src/sysvar/rent.rs.
//   Sysvar: Clock         — solana-sdk/src/sysvar/clock.rs.
//   Ed25519 SigVerify     — solana-sdk/src/ed25519_instruction.rs.
//   SPL Token             — spl-token crate v4 (legacy SPL Token mint).
//   SPL Token-2022        — spl-token-2022 crate (Token Extensions).
//   SPL Associated Token  — spl-associated-token-account crate v3.
//   SPL Noop              — spl-noop crate (used by Bubblegum log_wrapper).
//   SPL Account Compression — spl-account-compression crate.
//   Metaplex Core         — mpl-core 0.12.0 src/generated/programs.rs.
//   Metaplex Bubblegum    — mpl-bubblegum 3.0.0 src/generated/programs.rs.
//
// The Rust program mirrors these constants:
//   - SYSTEM_PROGRAM_ID / SYSVAR_INSTRUCTIONS_ID / ED25519_PROGRAM_ID
//     in programs/spaniel_series1/src/state.rs
//   - SPL_TOKEN_PROGRAM_ID via pinocchio_token::ID in
//     programs/spaniel_series1/src/spanielcoin.rs
//   - MPL_CORE_PROGRAM_ID in programs/spaniel_series1/src/asset.rs
// Any change here MUST be mirrored in those files and the relevant
// host tests refreshed.

Object.freeze(globalThis.__noop ??= {});

// ── Core Solana ───────────────────────────────────────────────────
export const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
export const SYSVAR_INSTRUCTIONS_ID =
  'Sysvar1nstructions1111111111111111111111111';
export const SYSVAR_RENT_ID =
  'SysvarRent111111111111111111111111111111111';
export const SYSVAR_CLOCK_ID =
  'SysvarC1ock11111111111111111111111111111111';
export const ED25519_PROGRAM_ID =
  'Ed25519SigVerify111111111111111111111111111';
export const SECP256K1_PROGRAM_ID =
  'KeccakSecp256k11111111111111111111111111111';

// ── SPL Token family ──────────────────────────────────────────────
export const SPL_TOKEN_PROGRAM_ID =
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const SPL_TOKEN_2022_PROGRAM_ID =
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const SPL_ASSOCIATED_TOKEN_PROGRAM_ID =
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';

// ── Metaplex (NFT standards) ──────────────────────────────────────
export const METAPLEX_CORE_PROGRAM_ID =
  'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
export const METAPLEX_BUBBLEGUM_PROGRAM_ID =
  'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';
export const METAPLEX_TOKEN_METADATA_PROGRAM_ID =
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';

// ── Compressed-NFT infrastructure ─────────────────────────────────
export const SPL_NOOP_PROGRAM_ID =
  'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV';
export const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID =
  'cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK';

// ── Lamport / decimals constants ──────────────────────────────────
export const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Set of every well-known program id this module exports. Useful for
 * tests that assert no string literal of a program id leaks into
 * handler code (e.g. grep guards in CI).
 */
export const ALL_WELL_KNOWN_PROGRAM_IDS = Object.freeze(new Set([
  SYSTEM_PROGRAM_ID,
  SYSVAR_INSTRUCTIONS_ID,
  SYSVAR_RENT_ID,
  SYSVAR_CLOCK_ID,
  ED25519_PROGRAM_ID,
  SECP256K1_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  SPL_TOKEN_2022_PROGRAM_ID,
  SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
  METAPLEX_CORE_PROGRAM_ID,
  METAPLEX_BUBBLEGUM_PROGRAM_ID,
  METAPLEX_TOKEN_METADATA_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
]));

/** Every id is a 32-byte base58 pubkey — length 32..44 chars. */
export function isLikelyBase58Pubkey(s) {
  return (
    typeof s === 'string' &&
    s.length >= 32 &&
    s.length <= 44 &&
    /^[1-9A-HJ-NP-Za-km-z]+$/.test(s)
  );
}
