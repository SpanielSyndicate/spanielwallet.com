// Series 1 Program — instruction builders (public contract).
//
// Builds the on-chain instruction shapes the Series 1 Program
// expects: discriminator, account order, signer/writable flags, PDA
// derivation. The Worker signs the canonical quote bytes; this
// module wraps the result in an `Ed25519SigVerify` precompile
// instruction + a Series 1 Program instruction, ready to feed into
// a Transaction the wallet signs.
//
// Public-contract only — no settlement/reveal logic lives here.
// The deployed program id is supplied by `runtime-config.json
// .series1ProgramId` (or the older `mintProgramId` alias during
// migration).
//
// Account orders MUST stay in sync with
// `programs/spaniel_series1/src/handlers/*.rs` — every drift surfaces
// as a runtime `InvalidAccountCount` / `InvalidAccountAddress`
// revert.

// ── Discriminators (matches programs/spaniel_series1/src/lib.rs) ──
export const SERIES1_IX = Object.freeze({
  INITIALIZE_SERIES: 0,
  BUY_PRODUCT_WITH_QUOTE: 10,
  OPEN_PRODUCT: 11,
  MARKET_BUY: 12,
  CREATE_OFFER: 13,
  CANCEL_OFFER: 14,
  ACCEPT_OFFER: 15,
  PAUSE_SERIES: 16,
  UNPAUSE_SERIES: 17,
  REDEMPTION_DRAW: 18,
  CREATE_SEALED_PRODUCT: 19,
});

// ── PDA seeds ─────────────────────────────────────────────────────
export const SERIES1_SEEDS = Object.freeze({
  SERIES: new TextEncoder().encode('series'),
  PRODUCT: new TextEncoder().encode('product'),
  OFFER: new TextEncoder().encode('offer'),
  // SpanielCoin SPL mint-authority PDA (matches
  // programs/spaniel_series1/src/spanielcoin.rs::SPCN_SEED).
  SPANIELCOIN: new TextEncoder().encode('spanielcoin'),
});

// ── Solana well-known program ids (re-exported from the single
// ── source of truth; never inline these literals).
import {
  SPL_TOKEN_PROGRAM_ID as _SPL_TOKEN_PROGRAM_ID,
  SPL_ASSOCIATED_TOKEN_PROGRAM_ID as _SPL_ATA_PROGRAM_ID,
  SYSTEM_PROGRAM_ID as _SYSTEM_PROGRAM_ID,
  SYSVAR_INSTRUCTIONS_ID as _SYSVAR_INSTRUCTIONS_ID,
  ED25519_PROGRAM_ID as _ED25519_PROGRAM_ID,
} from './solana-program-ids.js';
export const SPL_TOKEN_PROGRAM_ID = _SPL_TOKEN_PROGRAM_ID;
export const SPL_ASSOCIATED_TOKEN_PROGRAM_ID = _SPL_ATA_PROGRAM_ID;

// ── Canonical quote sizes (mirror of worker/src/lib/borsh.js) ────
// Packline override tail (4 × (Pubkey + u64) = 160 bytes) is appended
// to the product / market-buy / offer-accept layouts; open + offer-
// create stay unchanged.
export const SERIES1_QUOTE_LEN = Object.freeze({
  PRODUCT: 361,
  PRODUCT_OPEN: 142,
  MARKET_BUY: 413,
  OFFER_CREATE: 150,
  OFFER_ACCEPT: 444,
});

// ── Solana well-known program ids (re-export only; source of truth
// ── lives in solana-program-ids.js).
export const SYSTEM_PROGRAM_ID = _SYSTEM_PROGRAM_ID;
export const SYSVAR_INSTRUCTIONS_ID = _SYSVAR_INSTRUCTIONS_ID;
export const ED25519_PROGRAM_ID = _ED25519_PROGRAM_ID;

// ── Ed25519 precompile data layout ────────────────────────────────
// Per solana-sdk/src/ed25519_instruction.rs — single signature, all
// offsets self-contained in this instruction's data.
const ED25519_INSTRUCTION_INDEX_NONE = 0xFFFF;
const ED25519_PUBKEY_LEN = 32;
const ED25519_SIGNATURE_LEN = 64;
const ED25519_HEADER_LEN = 14;

/**
 * Build the data field for an `Ed25519SigVerify` precompile
 * instruction. Returns a Uint8Array suitable as `data` on a
 * TransactionInstruction whose `programId` is ED25519_PROGRAM_ID.
 *
 * @param {Uint8Array} signature 64-byte ed25519 signature
 * @param {Uint8Array} publicKey 32-byte ed25519 public key
 * @param {Uint8Array} message  canonical quote bytes
 */
export function buildEd25519PrecompileData(signature, publicKey, message) {
  if (!(signature instanceof Uint8Array) || signature.length !== ED25519_SIGNATURE_LEN) {
    throw new Error(`ed25519 signature must be ${ED25519_SIGNATURE_LEN} bytes`);
  }
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== ED25519_PUBKEY_LEN) {
    throw new Error(`ed25519 pubkey must be ${ED25519_PUBKEY_LEN} bytes`);
  }
  if (!(message instanceof Uint8Array) || message.length === 0 || message.length > 0xFFFF) {
    throw new Error('ed25519 message must be a non-empty Uint8Array up to 65535 bytes');
  }
  const headerStart = 2;
  const sigOffset = headerStart + ED25519_HEADER_LEN;
  const pkOffset = sigOffset + ED25519_SIGNATURE_LEN;
  const msgOffset = pkOffset + ED25519_PUBKEY_LEN;
  const total = msgOffset + message.length;
  const out = new Uint8Array(total);
  out[0] = 1; // num_signatures
  out[1] = 0; // padding
  const dv = new DataView(out.buffer);
  dv.setUint16(headerStart + 0, sigOffset, true);
  dv.setUint16(headerStart + 2, ED25519_INSTRUCTION_INDEX_NONE, true);
  dv.setUint16(headerStart + 4, pkOffset, true);
  dv.setUint16(headerStart + 6, ED25519_INSTRUCTION_INDEX_NONE, true);
  dv.setUint16(headerStart + 8, msgOffset, true);
  dv.setUint16(headerStart + 10, message.length, true);
  dv.setUint16(headerStart + 12, ED25519_INSTRUCTION_INDEX_NONE, true);
  out.set(signature, sigOffset);
  out.set(publicKey, pkOffset);
  out.set(message, msgOffset);
  return out;
}

/**
 * Build the byte payload for a Series 1 Program instruction:
 * `[discriminator (1)] || canonical_quote_bytes`.
 *
 * Used by the long-form handlers (open_product, market_buy,
 * create_offer, accept_offer, redemption_draw) that still ship the
 * full signed quote inline. The tx-size-fix handlers
 * (buy_product_with_quote, create_sealed_product) build their
 * instruction data via [`buildBuySeries1IxData`] /
 * [`buildCreateSealedSeries1IxData`] instead — those carry only the
 * sysvar indices the handler needs to locate the canonical bytes in
 * the prefacing Ed25519SigVerify instruction.
 *
 * @param {number} discriminator one of SERIES1_IX
 * @param {Uint8Array} canonicalQuoteBytes signed quote payload
 */
export function buildSeries1IxData(discriminator, canonicalQuoteBytes) {
  if (typeof discriminator !== 'number' || discriminator < 0 || discriminator > 0xff) {
    throw new Error(`bad discriminator: ${discriminator}`);
  }
  const body = canonicalQuoteBytes instanceof Uint8Array ? canonicalQuoteBytes : new Uint8Array();
  const out = new Uint8Array(1 + body.length);
  out[0] = discriminator;
  out.set(body, 1);
  return out;
}

/**
 * Build the buy_product_with_quote (disc=10) instruction data.
 * Tiny — only the dispatcher disc + the prefacing Ed25519SigVerify
 * instruction's index in the same transaction. The Series 1 Program
 * loads the signed canonical quote bytes from that ed25519 ix via the
 * instructions sysvar (see `programs/spaniel_series1/src/ed25519.rs`
 * `load_canonical_quote_into`).
 *
 * @param {number} ed25519IxIndex u16 index of the ed25519 precompile ix
 * @returns {Uint8Array} 3 bytes: [10, ix_index_lo, ix_index_hi]
 */
export function buildBuySeries1IxData(ed25519IxIndex) {
  if (
    !Number.isInteger(ed25519IxIndex) ||
    ed25519IxIndex < 0 ||
    ed25519IxIndex > 0xffff
  ) {
    throw new Error(`ed25519IxIndex must be a u16 (got ${ed25519IxIndex})`);
  }
  const out = new Uint8Array(3);
  out[0] = SERIES1_IX.BUY_PRODUCT_WITH_QUOTE;
  out[1] = ed25519IxIndex & 0xff;
  out[2] = (ed25519IxIndex >> 8) & 0xff;
  return out;
}

/**
 * Build the create_sealed_product (disc=19) instruction data. Carries
 * both the ed25519 ix index AND the matching buy_product_with_quote
 * ix index in the same tx. Without the buy-ix cross-reference, this
 * handler could mint a wrapper PDA from a signed quote without any
 * SOL moving on chain.
 *
 * @param {number} ed25519IxIndex u16 index of the ed25519 precompile ix
 * @param {number} buyIxIndex u16 index of the buy_product_with_quote ix
 * @returns {Uint8Array} 5 bytes: [19, ed_lo, ed_hi, buy_lo, buy_hi]
 */
export function buildCreateSealedSeries1IxData(ed25519IxIndex, buyIxIndex) {
  for (const [name, v] of [
    ['ed25519IxIndex', ed25519IxIndex],
    ['buyIxIndex', buyIxIndex],
  ]) {
    if (!Number.isInteger(v) || v < 0 || v > 0xffff) {
      throw new Error(`${name} must be a u16 (got ${v})`);
    }
  }
  const out = new Uint8Array(5);
  out[0] = SERIES1_IX.CREATE_SEALED_PRODUCT;
  out[1] = ed25519IxIndex & 0xff;
  out[2] = (ed25519IxIndex >> 8) & 0xff;
  out[3] = buyIxIndex & 0xff;
  out[4] = (buyIxIndex >> 8) & 0xff;
  return out;
}

/**
 * Account-shape descriptor — exactly what each handler expects in
 * `accounts: &mut [AccountView]`.
 *
 * Each entry is `{ name, signer, writable }`. The frontend resolves
 * `name → Pubkey` from the wallet + Worker-supplied context (series,
 * treasury, rescue_pool, affiliate/referrer/maker/asset addresses).
 */
export const SERIES1_ACCOUNT_SHAPES = Object.freeze({
  initializeSeries: [
    { name: 'authority', signer: true, writable: true },
    { name: 'seriesState', signer: false, writable: true },
    { name: 'treasury', signer: false, writable: false },
    { name: 'rescuePool', signer: false, writable: false },
    { name: 'systemProgram', signer: false, writable: false },
  ],
  buyProductWithQuote: [
    { name: 'buyer', signer: true, writable: true },
    { name: 'seriesState', signer: false, writable: true },
    { name: 'treasury', signer: false, writable: true },
    { name: 'rescuePool', signer: false, writable: true },
    { name: 'affiliate', signer: false, writable: true },
    // Packline upstream sponsor accounts (level-2 first). Absent
    // ancestors are passed as the system program id with the signed
    // quote attesting zero lamports for that slot.
    { name: 'packlineL2', signer: false, writable: true },
    { name: 'packlineL3', signer: false, writable: true },
    { name: 'packlineL4', signer: false, writable: true },
    { name: 'packlineL5', signer: false, writable: true },
    { name: 'instructionsSysvar', signer: false, writable: false },
    { name: 'systemProgram', signer: false, writable: false },
    // SpanielCoin SPL accounts (added 2026-05-17 — pinocchio-token CPI).
    { name: 'splTokenProgram', signer: false, writable: false },
    { name: 'spanielCoinMint', signer: false, writable: true },
    { name: 'spanielCoinAuthorityPda', signer: false, writable: false },
    { name: 'buyerSpanielCoinAta', signer: false, writable: true },
    { name: 'treasurySpanielCoinAta', signer: false, writable: true },
    // For unaffiliated purchases this MUST be the system program id
    // (no minting happens to it); for affiliated purchases this is
    // the direct affiliate's SpanielCoin ATA.
    { name: 'affiliateSpanielCoinAta', signer: false, writable: true },
  ],
  openProduct: [
    { name: 'opener', signer: true, writable: true },
    { name: 'seriesState', signer: false, writable: true },
    { name: 'productState', signer: false, writable: true },
    { name: 'instructionsSysvar', signer: false, writable: false },
    { name: 'systemProgram', signer: false, writable: false },
    // Bubblegum cNFT CPI accounts (added 2026-05-19 reveal landing).
    // Mirrors programs/spaniel_series1/src/handlers/open_product.rs.
    { name: 'mplBubblegumProgram', signer: false, writable: false },
    { name: 'splAccountCompressionProgram', signer: false, writable: false },
    { name: 'splNoopProgram', signer: false, writable: false },
    { name: 'treeConfig', signer: false, writable: true },
    { name: 'merkleTree', signer: false, writable: true },
  ],
  marketBuy: [
    { name: 'buyer', signer: true, writable: true },
    { name: 'seller', signer: false, writable: true },
    { name: 'seriesState', signer: false, writable: false },
    { name: 'treasury', signer: false, writable: true },
    { name: 'rescuePool', signer: false, writable: true },
    { name: 'referrer', signer: false, writable: true },
    { name: 'packlineL2', signer: false, writable: true },
    { name: 'packlineL3', signer: false, writable: true },
    { name: 'packlineL4', signer: false, writable: true },
    { name: 'packlineL5', signer: false, writable: true },
    { name: 'asset', signer: false, writable: true },
    { name: 'instructionsSysvar', signer: false, writable: false },
    { name: 'systemProgram', signer: false, writable: false },
  ],
  createOffer: [
    { name: 'maker', signer: true, writable: true },
    { name: 'seriesState', signer: false, writable: false },
    { name: 'offerState', signer: false, writable: true },
    { name: 'instructionsSysvar', signer: false, writable: false },
    { name: 'systemProgram', signer: false, writable: false },
  ],
  cancelOffer: [
    { name: 'maker', signer: true, writable: true },
    { name: 'offerState', signer: false, writable: true },
  ],
  acceptOffer: [
    { name: 'seller', signer: true, writable: true },
    { name: 'maker', signer: false, writable: false },
    { name: 'seriesState', signer: false, writable: false },
    { name: 'offerState', signer: false, writable: true },
    { name: 'treasury', signer: false, writable: true },
    { name: 'rescuePool', signer: false, writable: true },
    { name: 'referrer', signer: false, writable: true },
    { name: 'packlineL2', signer: false, writable: true },
    { name: 'packlineL3', signer: false, writable: true },
    { name: 'packlineL4', signer: false, writable: true },
    { name: 'packlineL5', signer: false, writable: true },
    { name: 'asset', signer: false, writable: true },
    { name: 'instructionsSysvar', signer: false, writable: false },
    { name: 'systemProgram', signer: false, writable: false },
  ],
  createSealedProduct: [
    { name: 'buyer', signer: true, writable: true },
    { name: 'seriesState', signer: false, writable: false },
    { name: 'productState', signer: false, writable: true },
    { name: 'instructionsSysvar', signer: false, writable: false },
    { name: 'systemProgram', signer: false, writable: false },
  ],
  // disc=18 — RedemptionDraw. Account count is a *minimum* (8): the
  // tail is reserved for the per-burn-item account chain that the
  // Bubblegum / Core asset-burn CPI will consume once it ships. The
  // first 8 slots match `programs/spaniel_series1/src/handlers/
  // redemption_draw.rs::REDEMPTION_DRAW_MIN_ACCOUNT_COUNT`.
  redemptionDraw: [
    { name: 'wallet', signer: true, writable: true },
    { name: 'seriesState', signer: false, writable: true },
    { name: 'spanielCoinMint', signer: false, writable: true },
    { name: 'spanielCoinAuthorityPda', signer: false, writable: false },
    { name: 'walletSpanielCoinAta', signer: false, writable: true },
    { name: 'splTokenProgram', signer: false, writable: false },
    { name: 'instructionsSysvar', signer: false, writable: false },
    { name: 'systemProgram', signer: false, writable: false },
  ],
});

/**
 * Lower-level builder — takes raw bytes for both signer pubkey and
 * signature. Caller is responsible for base58 decoding.
 *
 * Use the named-handler builders below (e.g. buildBuyProductTransaction)
 * for typical flows — this raw builder is here for tests + the
 * rehearsal script.
 *
 * For long-form handlers (open_product, market_buy, create_offer,
 * accept_offer) the Series 1 instruction data is
 * `[disc] || canonical_quote_bytes`. For the tx-size-fix handlers
 * (buy_product_with_quote, create_sealed_product) the Series 1
 * instruction data is just `[disc] || sysvar_indices`; the canonical
 * bytes live only in the prefacing Ed25519SigVerify ix.
 *
 * @param {object} params
 * @param {string} params.programId base58 Series 1 Program id
 * @param {Uint8Array} params.signerPubkeyBytes 32 bytes
 * @param {Uint8Array} params.signature 64 bytes
 * @param {Uint8Array} params.canonicalQuoteBytes
 * @param {number} params.discriminator
 * @param {Array<{pubkey:string,isSigner:boolean,isWritable:boolean}>} params.accounts
 * @param {Uint8Array} [params.series1Data] override the Series 1 ix data
 *   (used by the tx-size-fix handlers to ship a small sysvar-index
 *   payload instead of the full canonical quote bytes)
 */
export function buildSeries1InstructionsRaw({
  programId,
  signerPubkeyBytes,
  signature,
  canonicalQuoteBytes,
  discriminator,
  accounts,
  series1Data,
}) {
  if (!programId) throw new Error('series1ProgramId required');
  if (!(signerPubkeyBytes instanceof Uint8Array) || signerPubkeyBytes.length !== 32) {
    throw new Error('signerPubkeyBytes must be 32 bytes');
  }
  if (!(signature instanceof Uint8Array) || signature.length !== 64) {
    throw new Error('signature must be 64 bytes');
  }
  if (!(canonicalQuoteBytes instanceof Uint8Array)) {
    throw new Error('canonicalQuoteBytes must be Uint8Array');
  }
  const ed25519Data = buildEd25519PrecompileData(
    signature,
    signerPubkeyBytes,
    canonicalQuoteBytes
  );
  const resolvedSeries1Data = series1Data instanceof Uint8Array
    ? series1Data
    : buildSeries1IxData(discriminator, canonicalQuoteBytes);
  return {
    ed25519: {
      programId: ED25519_PROGRAM_ID,
      accounts: [],
      data: ed25519Data,
    },
    series1: {
      programId,
      accounts,
      data: resolvedSeries1Data,
    },
  };
}

/**
 * Named per-handler builders. Each accepts a `signedQuote` (with
 * `canonicalQuoteBytes`, `signature`, `signerPubkeyBytes`) plus the
 * resolved accounts in handler-defined order, and returns the
 * `{ ed25519, series1 }` instruction pair ready for the wallet.
 *
 * Every builder shares this contract:
 *   - throws if `programId` is missing/empty (Series 1 Program not yet
 *     deployed; caller should gate UI on PENDING_PROGRAM_DEPLOYMENT)
 *   - throws if `signedQuote.canonicalQuoteBytes` length is wrong
 *   - throws if `accounts` length / order doesn't match the canonical
 *     shape declared in `SERIES1_ACCOUNT_SHAPES`
 *   - optional `nowUnix` arg gates expired quotes pre-build (when
 *     supplied + `signedQuote.expiresAtUnix` is supplied)
 */

function assertSignedQuote(signedQuote, expectedLen) {
  if (!signedQuote || typeof signedQuote !== 'object') {
    throw new Error('signedQuote required');
  }
  const { canonicalQuoteBytes, signature, signerPubkeyBytes } = signedQuote;
  if (!(canonicalQuoteBytes instanceof Uint8Array) ||
      canonicalQuoteBytes.length !== expectedLen) {
    throw new Error(
      `signedQuote.canonicalQuoteBytes must be ${expectedLen} bytes, got ${canonicalQuoteBytes?.length}`
    );
  }
  if (!(signature instanceof Uint8Array) || signature.length !== 64) {
    throw new Error('signedQuote.signature must be a 64-byte Uint8Array');
  }
  if (!(signerPubkeyBytes instanceof Uint8Array) || signerPubkeyBytes.length !== 32) {
    throw new Error('signedQuote.signerPubkeyBytes must be a 32-byte Uint8Array');
  }
  return { canonicalQuoteBytes, signature, signerPubkeyBytes };
}

function assertNotExpired(signedQuote, nowUnix) {
  if (typeof nowUnix === 'number' && typeof signedQuote.expiresAtUnix === 'number') {
    if (signedQuote.expiresAtUnix <= nowUnix) {
      throw new Error(
        `quote expired at ${signedQuote.expiresAtUnix} (now ${nowUnix})`
      );
    }
  }
}

function namedBuilder(shape, discriminator, expectedQuoteLen) {
  return function build({ programId, signedQuote, accounts, nowUnix } = {}) {
    if (!programId || typeof programId !== 'string') {
      throw new Error('series1ProgramId required');
    }
    const sq = assertSignedQuote(signedQuote, expectedQuoteLen);
    assertNotExpired(signedQuote, nowUnix);
    const resolved = validateAccountsAgainstShape(shape, accounts);
    return buildSeries1InstructionsRaw({
      programId,
      signerPubkeyBytes: sq.signerPubkeyBytes,
      signature: sq.signature,
      canonicalQuoteBytes: sq.canonicalQuoteBytes,
      discriminator,
      accounts: resolved,
    });
  };
}

/**
 * buy_product_with_quote (disc 10) builder for the tx-size-fix shape.
 * The Series 1 instruction data is only 3 bytes
 * (`[10, ed25519_ix_idx_lo, ed25519_ix_idx_hi]`); the full signed
 * canonical quote bytes live in the prefacing Ed25519SigVerify ix.
 *
 * Caller must position the Ed25519SigVerify ix at the supplied
 * `ed25519IxIndex` in the same transaction; the handler reverts if
 * the ix at that index isn't the signature precompile signed by the
 * series quote signer over the canonical product quote bytes.
 *
 * @param {object} params
 * @param {string} params.programId
 * @param {object} params.signedQuote  { canonicalQuoteBytes, signature, signerPubkeyBytes, expiresAtUnix? }
 * @param {Array} params.accounts
 * @param {number} params.ed25519IxIndex u16 index of the prefacing ed25519 ix
 * @param {number} [params.nowUnix] optional pre-expiry check
 */
export function buildBuyProductTransaction({ programId, signedQuote, accounts, ed25519IxIndex, nowUnix } = {}) {
  if (!programId || typeof programId !== 'string') {
    throw new Error('series1ProgramId required');
  }
  const sq = assertSignedQuote(signedQuote, SERIES1_QUOTE_LEN.PRODUCT);
  assertNotExpired(signedQuote, nowUnix);
  const resolved = validateAccountsAgainstShape('buyProductWithQuote', accounts);
  const series1Data = buildBuySeries1IxData(ed25519IxIndex);
  return buildSeries1InstructionsRaw({
    programId,
    signerPubkeyBytes: sq.signerPubkeyBytes,
    signature: sq.signature,
    canonicalQuoteBytes: sq.canonicalQuoteBytes,
    discriminator: SERIES1_IX.BUY_PRODUCT_WITH_QUOTE,
    accounts: resolved,
    series1Data,
  });
}

/**
 * open_product (disc 11) builder. The Series 1 instruction data is
 * `[disc] || canonical_open_quote_bytes || per_card_mint_payload_tail`.
 *
 * Per-card payload format (repeated `card_count` times, LE):
 *   u16 name_len (<= 64) || name bytes || u16 uri_len (<= 192) || uri bytes
 *
 * Caller supplies `cardMintPayloads` from the Worker open quote
 * response (each entry has `{ name, uri }`); this builder serializes
 * them into the trailing bytes the Series 1 Program reads when
 * issuing the Bubblegum mint_v1 CPI.
 *
 * Callers may omit `cardMintPayloads` when the open quote is
 * mock-mode-only (devnet sandbox) — the trailing bytes are then
 * empty and the program rejects the tx (which is fine for those
 * code paths because they never submit).
 *
 * @param {object} params
 * @param {string} params.programId
 * @param {object} params.signedQuote
 * @param {Array} params.accounts        Resolved openProduct shape (10 accounts).
 * @param {Array<{name:string,uri:string}>} [params.cardMintPayloads]
 * @param {number} [params.nowUnix]
 */
export function buildOpenProductTransaction({
  programId,
  signedQuote,
  accounts,
  cardMintPayloads,
  nowUnix,
} = {}) {
  if (!programId || typeof programId !== 'string') {
    throw new Error('series1ProgramId required');
  }
  const sq = assertSignedQuote(signedQuote, SERIES1_QUOTE_LEN.PRODUCT_OPEN);
  assertNotExpired(signedQuote, nowUnix);
  const resolved = validateAccountsAgainstShape('openProduct', accounts);
  const tail = serializeOpenProductCardTail(cardMintPayloads);
  // open_product handler data shape: [disc] || canonical_open_quote_bytes || tail
  const data = new Uint8Array(1 + sq.canonicalQuoteBytes.length + tail.length);
  data[0] = SERIES1_IX.OPEN_PRODUCT;
  data.set(sq.canonicalQuoteBytes, 1);
  data.set(tail, 1 + sq.canonicalQuoteBytes.length);
  return buildSeries1InstructionsRaw({
    programId,
    signerPubkeyBytes: sq.signerPubkeyBytes,
    signature: sq.signature,
    canonicalQuoteBytes: sq.canonicalQuoteBytes,
    discriminator: SERIES1_IX.OPEN_PRODUCT,
    accounts: resolved,
    series1Data: data,
  });
}

function serializeOpenProductCardTail(cardMintPayloads) {
  if (!Array.isArray(cardMintPayloads) || cardMintPayloads.length === 0) {
    return new Uint8Array(0);
  }
  const encoder = new TextEncoder();
  const parts = [];
  let total = 0;
  for (const c of cardMintPayloads) {
    if (typeof c?.name !== 'string') throw new Error('cardMintPayloads[].name must be a string');
    if (typeof c?.uri !== 'string')  throw new Error('cardMintPayloads[].uri must be a string');
    const name = encoder.encode(c.name);
    const uri = encoder.encode(c.uri);
    if (name.length > 64)  throw new Error(`cardMintPayloads[].name byte length ${name.length} > 64`);
    if (uri.length > 192)  throw new Error(`cardMintPayloads[].uri byte length ${uri.length} > 192`);
    parts.push({ name, uri });
    total += 2 + name.length + 2 + uri.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const { name, uri } of parts) {
    out[o++] = name.length & 0xff;
    out[o++] = (name.length >> 8) & 0xff;
    out.set(name, o); o += name.length;
    out[o++] = uri.length & 0xff;
    out[o++] = (uri.length >> 8) & 0xff;
    out.set(uri, o); o += uri.length;
  }
  return out;
}
export const buildMarketBuyTransaction = namedBuilder(
  'marketBuy', SERIES1_IX.MARKET_BUY, SERIES1_QUOTE_LEN.MARKET_BUY
);
export const buildCreateOfferTransaction = namedBuilder(
  'createOffer', SERIES1_IX.CREATE_OFFER, SERIES1_QUOTE_LEN.OFFER_CREATE
);
export const buildAcceptOfferTransaction = namedBuilder(
  'acceptOffer', SERIES1_IX.ACCEPT_OFFER, SERIES1_QUOTE_LEN.OFFER_ACCEPT
);

/**
 * create_sealed_product (disc 19) builder. Ships 5 bytes of Series 1
 * instruction data: `[19, ed_lo, ed_hi, buy_lo, buy_hi]`. The signed
 * canonical quote bytes are shared with the buy ix via the prefacing
 * Ed25519SigVerify instruction (single ed25519 ix at the top of the
 * tx covers both handlers). The matching buy_product_with_quote
 * instruction at `buyIxIndex` is required by the handler so the
 * wrapper PDA can't be minted without SOL actually moving.
 *
 * @param {object} params
 * @param {string} params.programId
 * @param {object} params.signedQuote
 * @param {Array} params.accounts
 * @param {number} params.ed25519IxIndex u16 index of the prefacing ed25519 ix
 * @param {number} params.buyIxIndex u16 index of the matching buy ix
 * @param {number} [params.nowUnix] optional pre-expiry check
 */
export function buildCreateSealedProductTransaction({ programId, signedQuote, accounts, ed25519IxIndex, buyIxIndex, nowUnix } = {}) {
  if (!programId || typeof programId !== 'string') {
    throw new Error('series1ProgramId required');
  }
  const sq = assertSignedQuote(signedQuote, SERIES1_QUOTE_LEN.PRODUCT);
  assertNotExpired(signedQuote, nowUnix);
  const resolved = validateAccountsAgainstShape('createSealedProduct', accounts);
  const series1Data = buildCreateSealedSeries1IxData(ed25519IxIndex, buyIxIndex);
  return buildSeries1InstructionsRaw({
    programId,
    signerPubkeyBytes: sq.signerPubkeyBytes,
    signature: sq.signature,
    canonicalQuoteBytes: sq.canonicalQuoteBytes,
    discriminator: SERIES1_IX.CREATE_SEALED_PRODUCT,
    accounts: resolved,
    series1Data,
  });
}

/**
 * Cancel offer has no canonical quote — it's an on-chain authority
 * check against the OfferState. Build the bare Series 1 instruction
 * with just the discriminator + 16-byte offer_id payload.
 *
 * @param {object} params
 * @param {string} params.programId
 * @param {Uint8Array} params.offerId 16 bytes
 * @param {Array<{pubkey:string,isSigner:boolean,isWritable:boolean}>} params.accounts
 */
export function buildCancelOfferTransaction({ programId, offerId, accounts } = {}) {
  if (!programId || typeof programId !== 'string') {
    throw new Error('series1ProgramId required');
  }
  if (!(offerId instanceof Uint8Array) || offerId.length !== 16) {
    throw new Error('offerId must be a 16-byte Uint8Array');
  }
  const resolved = validateAccountsAgainstShape('cancelOffer', accounts);
  const data = new Uint8Array(1 + 16);
  data[0] = SERIES1_IX.CANCEL_OFFER;
  data.set(offerId, 1);
  return {
    series1: {
      programId,
      accounts: resolved,
      data,
    },
  };
}

/**
 * Resolve the SpanielCoin mint-authority PDA for a given Series 1
 * Program id and 4-byte ASCII series id. Returns `{ pubkey, bump }`.
 *
 * Mirrors the Rust seeds: `[b"spanielcoin", series_id_ascii(4)]`.
 *
 * @param {string|Uint8Array} programId  base58 or 32-byte raw bytes
 * @param {string|Uint8Array} seriesId   "s1" / "s2" or 4 ASCII bytes
 * @param {Function} findProgramAddress  caller supplies a function
 *   `(seeds: Uint8Array[], programIdBytes: Uint8Array) => Promise<{pubkey: Uint8Array, bump: number}>`
 *   so this module stays free of crypto dependencies.
 */
export async function deriveSpanielCoinAuthorityPda(programId, seriesId, findProgramAddress) {
  if (typeof findProgramAddress !== 'function') {
    throw new Error('deriveSpanielCoinAuthorityPda: pass a findProgramAddress function');
  }
  const programIdBytes = programId instanceof Uint8Array
    ? programId
    : base58ToBytes(programId);
  const seriesIdBytes = seriesId instanceof Uint8Array
    ? padTo4(seriesId)
    : ascii4(String(seriesId));
  const seeds = [SERIES1_SEEDS.SPANIELCOIN, seriesIdBytes];
  return findProgramAddress(seeds, programIdBytes);
}

/**
 * Derive an Associated Token Account address.
 *
 * SPL ATA derivation: PDA owned by the SPL Associated Token Account
 * program (`SPL_ASSOCIATED_TOKEN_PROGRAM_ID` from solana-program-ids.js)
 * with seeds `[wallet, SPL_TOKEN_PROGRAM_ID, mint]`.
 *
 * @param {string|Uint8Array} walletPubkey
 * @param {string|Uint8Array} mintPubkey
 * @param {Function} findProgramAddress see deriveSpanielCoinAuthorityPda
 * @returns {Promise<{pubkey: Uint8Array, bump: number}>}
 */
export async function deriveAssociatedTokenAddress(walletPubkey, mintPubkey, findProgramAddress) {
  if (typeof findProgramAddress !== 'function') {
    throw new Error('deriveAssociatedTokenAddress: pass a findProgramAddress function');
  }
  const wallet = walletPubkey instanceof Uint8Array ? walletPubkey : base58ToBytes(walletPubkey);
  const mint = mintPubkey instanceof Uint8Array ? mintPubkey : base58ToBytes(mintPubkey);
  const tokenProgram = base58ToBytes(SPL_TOKEN_PROGRAM_ID);
  const ata = base58ToBytes(SPL_ASSOCIATED_TOKEN_PROGRAM_ID);
  return findProgramAddress([wallet, tokenProgram, mint], ata);
}

/** 4-byte ASCII padding for series ids ("s1" → [b's', b'1', 0, 0]). */
function ascii4(s) {
  const out = new Uint8Array(4);
  for (let i = 0; i < Math.min(s.length, 4); i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function padTo4(u8) {
  if (u8.length >= 4) return u8.slice(0, 4);
  const out = new Uint8Array(4);
  out.set(u8, 0);
  return out;
}

/** Minimal base58 → bytes. Used only by the PDA derivation helpers.
 *
 * Exported on `_internal` for property tests (leading-zero handling
 * for the System Program "all 1s" base58 form). Do not consume from
 * outside this module — production callers use the wallet-core
 * `decodeBase58` which has matching semantics.
 */
function base58ToBytes(s) {
  if (typeof s !== 'string' || s.length === 0) {
    throw new Error('base58ToBytes: empty input');
  }
  const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const c of s) {
    const v = ALPHA.indexOf(c);
    if (v < 0) throw new Error(`base58ToBytes: invalid char ${c}`);
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  // Each leading '1' in the input maps to a leading zero byte.
  for (const c of s) {
    if (c !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/**
 * Validate an accounts array matches the canonical shape for a
 * handler. Returns the resolved account array or throws on drift.
 *
 * @param {string} shapeName one of SERIES1_ACCOUNT_SHAPES keys
 * @param {Array<{pubkey:string}>} accounts
 */
export function validateAccountsAgainstShape(shapeName, accounts) {
  const shape = SERIES1_ACCOUNT_SHAPES[shapeName];
  if (!shape) throw new Error(`unknown shape: ${shapeName}`);
  if (!Array.isArray(accounts) || accounts.length !== shape.length) {
    throw new Error(
      `${shapeName}: expected ${shape.length} accounts, got ${accounts?.length}`
    );
  }
  for (let i = 0; i < shape.length; i++) {
    if (!accounts[i] || typeof accounts[i].pubkey !== 'string') {
      throw new Error(`${shapeName}: account[${i}] missing pubkey`);
    }
  }
  return shape.map((s, i) => ({
    pubkey: accounts[i].pubkey,
    isSigner: s.signer,
    isWritable: s.writable,
  }));
}

/** Internal helpers exported for property tests only. */
export const _internal = Object.freeze({ base58ToBytes });
