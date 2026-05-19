// /rip — Worker product quote → Series 1 buy_product_with_quote tx.
//
// Pure pipeline. Reads only the public-shape fields the Worker
// returns from POST /api/products/quote plus the runtime-config
// values (rpc, series1ProgramId, treasuryStr, etc.). Produces a
// signed, base58-encoded legacy-v1 transaction ready for
// sendRawTransaction. Does NO RPC, NO signing, NO storage.
//
// The PWA shell (`rip-page.js`) is responsible for:
//   - fetching `runtime-config.json` and the Worker quote,
//   - calling `getLatestBlockhash` on the configured devnet RPC,
//   - calling this module to build the message,
//   - signing the message with the buyer's wallet seed,
//   - submitting via `sendRawTransaction`,
//   - polling `confirmSignature`,
//   - calling `/api/products/record` after the tx confirms.
//
// All Solana well-known program ids come from `solana-program-ids.js`
// (single source of truth). Series 1 PDA seeds + discriminators come
// from `series1-program.js`.

import {
  SERIES1_IX,
  SERIES1_QUOTE_LEN,
  SERIES1_SEEDS,
  SERIES1_ACCOUNT_SHAPES,
  buildEd25519PrecompileData,
  buildBuySeries1IxData,
  buildCreateSealedSeries1IxData,
} from '../lib/series1-program.js';
import {
  SPL_TOKEN_PROGRAM_ID,
  SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  SYSVAR_INSTRUCTIONS_ID,
  ED25519_PROGRAM_ID,
} from '../lib/solana-program-ids.js';
import { compileProgramMessage, signSingleSignerTransaction } from '../wallet-core/program-transaction.js';
import { findProgramAddress } from '../wallet-core/pda.js';
import { decodeBase58, encodeBase58, isValidBase58Pubkey } from '../wallet-core/base58.js';
import { verifyMessage } from '../wallet-core/signer.js';
import { WalletError } from '../wallet-core/wallet-errors.js';

const SERIES_ID_DEFAULT = 's1';
const SERIES_ID_BYTE_LEN = 4;

function ascii4(s) {
  const out = new Uint8Array(SERIES_ID_BYTE_LEN);
  const src = String(s ?? '');
  for (let i = 0; i < Math.min(src.length, SERIES_ID_BYTE_LEN); i++) {
    out[i] = src.charCodeAt(i) & 0xff;
  }
  return out;
}

function hexToBytes(hex) {
  if (typeof hex !== 'string') throw new TypeError('hex must be a string');
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('invalid hex string');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Resolve the well-known Series 1 PDAs + ATAs the buy_product_with_quote
 * handler expects.
 *
 * @param {object} args
 * @param {string} args.programId       base58 Series 1 Program id
 * @param {string} args.seriesId        'sN' string (default 's1')
 * @param {string} args.buyerWallet     buyer's base58 pubkey
 * @param {string} args.treasuryWallet  series treasury base58 pubkey
 * @param {string|null} args.affiliateWallet  direct affiliate base58 pubkey (null if none)
 * @param {string} args.spanielCoinMint base58 SPL mint
 *
 * @returns {{
 *   seriesStatePda: string,
 *   spanielCoinAuthorityPda: string,
 *   buyerSpanielCoinAta: string,
 *   treasurySpanielCoinAta: string,
 *   affiliateSpanielCoinAta: string,  // SYSTEM_PROGRAM_ID when no affiliate
 *   bumpSeriesState: number,
 *   bumpSpanielCoinAuthority: number
 * }}
 */
export function deriveBuyAccounts({
  programId,
  seriesId = SERIES_ID_DEFAULT,
  buyerWallet,
  treasuryWallet,
  affiliateWallet,
  spanielCoinMint,
}) {
  if (!isValidBase58Pubkey(programId)) {
    throw new Error('programId must be valid base58 pubkey');
  }
  if (!isValidBase58Pubkey(buyerWallet)) {
    throw new Error('buyerWallet must be valid base58 pubkey');
  }
  if (!isValidBase58Pubkey(treasuryWallet)) {
    throw new Error('treasuryWallet must be valid base58 pubkey');
  }
  if (!isValidBase58Pubkey(spanielCoinMint)) {
    throw new Error('spanielCoinMint must be valid base58 pubkey');
  }
  if (affiliateWallet !== null && affiliateWallet !== undefined) {
    if (!isValidBase58Pubkey(affiliateWallet)) {
      throw new Error('affiliateWallet must be valid base58 pubkey or null');
    }
  }
  const seriesBytes = ascii4(seriesId);
  const seriesPda = findProgramAddress(
    [SERIES1_SEEDS.SERIES, seriesBytes],
    programId
  );
  const spcnAuth = findProgramAddress(
    [SERIES1_SEEDS.SPANIELCOIN, seriesBytes],
    programId
  );
  const tokenProgramBytes = decodeBase58(SPL_TOKEN_PROGRAM_ID);
  const mintBytes = decodeBase58(spanielCoinMint);
  function ata(walletBase58) {
    const wallet = decodeBase58(walletBase58);
    return findProgramAddress(
      [wallet, tokenProgramBytes, mintBytes],
      SPL_ASSOCIATED_TOKEN_PROGRAM_ID
    ).pubkeyBase58;
  }
  return {
    seriesStatePda: seriesPda.pubkeyBase58,
    spanielCoinAuthorityPda: spcnAuth.pubkeyBase58,
    buyerSpanielCoinAta: ata(buyerWallet),
    treasurySpanielCoinAta: ata(treasuryWallet),
    affiliateSpanielCoinAta: affiliateWallet ? ata(affiliateWallet) : SYSTEM_PROGRAM_ID,
    bumpSeriesState: seriesPda.bump,
    bumpSpanielCoinAuthority: spcnAuth.bump,
  };
}

/**
 * Build the 17-account `accounts` array for buy_product_with_quote.
 *
 * Each entry is `{ pubkey, isSigner, isWritable }` in the exact
 * order the Rust handler reads. Order MUST match
 * `SERIES1_ACCOUNT_SHAPES.buyProductWithQuote`.
 *
 * Packline ancestor slots use SYSTEM_PROGRAM_ID as the
 * "absent ancestor" placeholder (per the quote contract).
 */
export function buildBuyAccountList({
  buyerWallet,
  seriesStatePda,
  treasuryWallet,
  rescuePoolWallet,
  affiliateWallet,
  packlineL2Wallet,
  packlineL3Wallet,
  packlineL4Wallet,
  packlineL5Wallet,
  spanielCoinMint,
  spanielCoinAuthorityPda,
  buyerSpanielCoinAta,
  treasurySpanielCoinAta,
  affiliateSpanielCoinAta,
}) {
  function present(b58) {
    return typeof b58 === 'string' && isValidBase58Pubkey(b58) ? b58 : SYSTEM_PROGRAM_ID;
  }
  return [
    { pubkey: buyerWallet, isSigner: true, isWritable: true },
    { pubkey: seriesStatePda, isSigner: false, isWritable: true },
    { pubkey: treasuryWallet, isSigner: false, isWritable: true },
    { pubkey: rescuePoolWallet, isSigner: false, isWritable: true },
    { pubkey: present(affiliateWallet), isSigner: false, isWritable: true },
    { pubkey: present(packlineL2Wallet), isSigner: false, isWritable: true },
    { pubkey: present(packlineL3Wallet), isSigner: false, isWritable: true },
    { pubkey: present(packlineL4Wallet), isSigner: false, isWritable: true },
    { pubkey: present(packlineL5Wallet), isSigner: false, isWritable: true },
    { pubkey: SYSVAR_INSTRUCTIONS_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SPL_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: spanielCoinMint, isSigner: false, isWritable: true },
    { pubkey: spanielCoinAuthorityPda, isSigner: false, isWritable: false },
    { pubkey: buyerSpanielCoinAta, isSigner: false, isWritable: true },
    { pubkey: treasurySpanielCoinAta, isSigner: false, isWritable: true },
    { pubkey: affiliateSpanielCoinAta, isSigner: false, isWritable: true },
  ];
}

/**
 * Validate the inputs we need to build a real devnet buy tx. Throws
 * with a clear message on the FIRST missing/wrong field — so the
 * PWA can surface a precise gate without faking success.
 *
 * Returns `{ ok: true }` on success.
 */
export function validateBuyInputs({ runtimeConfig, quote }) {
  if (!runtimeConfig || typeof runtimeConfig !== 'object') {
    throw new Error('runtime-config.json not loaded');
  }
  const programId = runtimeConfig.series1ProgramId;
  if (!programId || !isValidBase58Pubkey(programId)) {
    const err = new Error('Series 1 Program id not configured in runtime-config.json');
    err.code = 'PROGRAM_PENDING';
    throw err;
  }
  if (runtimeConfig.pendingProgramDeployment === true) {
    const err = new Error('Series 1 Program marked as pending deployment in runtime-config.json');
    err.code = 'PROGRAM_PENDING';
    throw err;
  }
  if (!quote || typeof quote !== 'object') {
    throw new Error('Worker quote missing');
  }
  if (quote.gated) {
    const err = new Error(quote.reason || `quote gated: ${quote.code}`);
    err.code = quote.code || 'QUOTE_GATED';
    throw err;
  }
  if (typeof quote.canonicalQuoteHex !== 'string' || quote.canonicalQuoteHex.length === 0) {
    const err = new Error('Worker quote missing canonicalQuoteHex (quote signer not configured)');
    err.code = 'QUOTE_UNSIGNED';
    throw err;
  }
  if (typeof quote.signatureHex !== 'string' || quote.signatureHex.length !== 128) {
    const err = new Error('Worker quote missing signatureHex (or wrong length)');
    err.code = 'QUOTE_UNSIGNED';
    throw err;
  }
  if (typeof quote.quoteSignerPubkey !== 'string' || !isValidBase58Pubkey(quote.quoteSignerPubkey)) {
    throw new Error('Worker quote missing valid quoteSignerPubkey');
  }
  if (typeof quote.spanielCoinSplMint !== 'string' || !isValidBase58Pubkey(quote.spanielCoinSplMint)) {
    const err = new Error('SpanielCoin SPL mint not configured on Worker (SPANIELCOIN_MINT env var)');
    err.code = 'SPCN_MINT_PENDING';
    throw err;
  }
  if (typeof quote.treasuryWallet !== 'string' || !isValidBase58Pubkey(quote.treasuryWallet)) {
    throw new Error('Worker quote missing treasuryWallet');
  }
  if (typeof quote.rescuePoolWallet !== 'string' || !isValidBase58Pubkey(quote.rescuePoolWallet)) {
    throw new Error('Worker quote missing rescuePoolWallet');
  }
  const canonicalBytes = hexToBytes(quote.canonicalQuoteHex);
  if (canonicalBytes.length !== SERIES1_QUOTE_LEN.PRODUCT) {
    throw new Error(
      `canonicalQuoteHex decodes to ${canonicalBytes.length} bytes, expected ${SERIES1_QUOTE_LEN.PRODUCT}`
    );
  }
  return { ok: true };
}

/**
 * Derive the ProductState PDA for a sealed wrapper, using the same
 * seeds the Rust handler `create_sealed_product` uses:
 *   [b"product", series_id_ascii_4, quote_nonce_16]
 *
 * @param {string|Uint8Array} programId
 * @param {string} seriesId  e.g. 's1'
 * @param {string} quoteNonceHex  '0x' + 32 hex chars (16 bytes)
 * @returns {{ pubkey: Uint8Array, pubkeyBase58: string, bump: number }}
 */
export function deriveProductStatePda(programId, seriesId, quoteNonceHex) {
  if (typeof quoteNonceHex !== 'string') {
    throw new Error('quoteNonceHex must be string');
  }
  const nonceBytes = hexToBytes(quoteNonceHex);
  if (nonceBytes.length !== 16) {
    throw new Error(`quote_nonce must be 16 bytes; got ${nonceBytes.length}`);
  }
  const seriesBytes = ascii4(seriesId);
  return findProgramAddress([SERIES1_SEEDS.PRODUCT, seriesBytes, nonceBytes], programId);
}

/**
 * Build (but don't sign) the multi-instruction message for
 * buy_product_with_quote. Returns the compiled message bytes plus
 * a structured preview the PWA can display.
 *
 * Throws via `validateBuyInputs` on any missing field.
 */
export function buildBuyProductMessage({ runtimeConfig, quote, buyerWallet, recentBlockhashBase58, seriesId = SERIES_ID_DEFAULT }) {
  validateBuyInputs({ runtimeConfig, quote });
  if (!isValidBase58Pubkey(buyerWallet)) {
    throw new Error('buyerWallet must be a valid base58 pubkey');
  }
  if (typeof recentBlockhashBase58 !== 'string') {
    throw new Error('recentBlockhashBase58 must be a string from getLatestBlockhash');
  }
  if (quote.buyerWallet !== buyerWallet) {
    throw new Error(
      `quote.buyerWallet (${quote.buyerWallet}) does not match active buyerWallet (${buyerWallet})`
    );
  }

  const canonicalBytes = hexToBytes(quote.canonicalQuoteHex);
  const signatureBytes = hexToBytes(quote.signatureHex);
  const signerPubkeyBytes = decodeBase58(quote.quoteSignerPubkey);
  if (signatureBytes.length !== 64) throw new Error('signatureHex must decode to 64 bytes');
  if (signerPubkeyBytes.length !== 32) throw new Error('quoteSignerPubkey must decode to 32 bytes');

  // Defense-in-depth: verify the Worker signed the canonical quote
  // bytes BEFORE we ask the wallet to sign anything. The Worker is
  // trusted to compute price math, but a compromised Worker that
  // hands us a signed quote routing payment to an attacker's
  // treasury would still pass the buy_product_with_quote handler's
  // signature check on-chain — so an attacker would need to forge
  // the *signature*, not just tamper with the bytes. Verifying
  // here means the user never signs a tx built from a tampered or
  // forged-signature quote.
  if (!verifyMessage(signerPubkeyBytes, canonicalBytes, signatureBytes)) {
    throw new WalletError(
      'WALLET_QUOTE_SIGNATURE_INVALID',
      'Worker quote signature does not verify against quoteSignerPubkey. ' +
      'Refusing to ask the wallet to sign a tampered or forged quote.'
    );
  }

  const programId = runtimeConfig.series1ProgramId;

  const derived = deriveBuyAccounts({
    programId,
    seriesId,
    buyerWallet,
    treasuryWallet: quote.treasuryWallet,
    affiliateWallet: quote.affiliateWallet || null,
    spanielCoinMint: quote.spanielCoinSplMint,
  });

  const packlineWallets = Array.isArray(quote.packlineOverrides) ? quote.packlineOverrides : [];
  const packlineL2 = packlineWallets.find((p) => p.level === 2)?.wallet || null;
  const packlineL3 = packlineWallets.find((p) => p.level === 3)?.wallet || null;
  const packlineL4 = packlineWallets.find((p) => p.level === 4)?.wallet || null;
  const packlineL5 = packlineWallets.find((p) => p.level === 5)?.wallet || null;

  const accounts = buildBuyAccountList({
    buyerWallet,
    seriesStatePda: derived.seriesStatePda,
    treasuryWallet: quote.treasuryWallet,
    rescuePoolWallet: quote.rescuePoolWallet,
    affiliateWallet: quote.affiliateWallet || null,
    packlineL2Wallet: packlineL2,
    packlineL3Wallet: packlineL3,
    packlineL4Wallet: packlineL4,
    packlineL5Wallet: packlineL5,
    spanielCoinMint: quote.spanielCoinSplMint,
    spanielCoinAuthorityPda: derived.spanielCoinAuthorityPda,
    buyerSpanielCoinAta: derived.buyerSpanielCoinAta,
    treasurySpanielCoinAta: derived.treasurySpanielCoinAta,
    affiliateSpanielCoinAta: derived.affiliateSpanielCoinAta,
  });

  // The Series 1 handler expects accounts in handler order — that's
  // the raw account list above. The legacy v1 compiler will dedupe
  // and reorder by signer/writable bands; the per-instruction
  // `accounts` field carries the indices into that compiled list,
  // so the handler still sees the same pubkeys at the same logical
  // positions (the compiler walks ix.accounts in the order we pass).
  //
  // Ix layout in this tx:
  //   index 0: Ed25519SigVerify precompile (carries canonical quote
  //            bytes + signature)
  //   index 1: buy_product_with_quote (disc 10; 3-byte ix data citing
  //            the ed25519 ix index)
  //   index 2: create_sealed_product (disc 19; 5-byte ix data citing
  //            the ed25519 + buy ix indices) — sealed wrappers only
  //
  // Series 1 instruction data NO LONGER duplicates the canonical
  // quote bytes — those live only in the prefacing Ed25519SigVerify
  // ix and the handlers load them via the instructions sysvar.
  const ED25519_IX_INDEX = 0;
  const BUY_IX_INDEX = 1;
  const ed25519IxData = buildEd25519PrecompileData(
    signatureBytes,
    signerPubkeyBytes,
    canonicalBytes
  );
  const series1BuyIxData = buildBuySeries1IxData(ED25519_IX_INDEX);

  const instructions = [
    // Ed25519SigVerify precompile MUST come before the Series 1
    // instruction; the handler reads sysvar instructions to find
    // it. No accounts required.
    { programIdBase58: ED25519_PROGRAM_ID, accounts: [], data: ed25519IxData },
    // The Series 1 buy_product_with_quote instruction.
    { programIdBase58: programId, accounts, data: series1BuyIxData },
  ];

  // Sealed wrappers (Pack/Box/Crate/Vault) get a follow-on
  // create_sealed_product (disc=19) in the SAME transaction. The
  // same canonical quote bytes are re-used (single ed25519 ix at
  // index 0). Singles skip this — they have no sealed wrapper.
  let createSealedAccounts = null;
  let productStatePda = null;
  if (quote.productType && quote.productType !== 'single') {
    productStatePda = deriveProductStatePda(programId, seriesId, quote.quoteNonce).pubkeyBase58;
    createSealedAccounts = [
      { pubkey: buyerWallet, isSigner: true, isWritable: true },
      { pubkey: derived.seriesStatePda, isSigner: false, isWritable: false },
      { pubkey: productStatePda, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_INSTRUCTIONS_ID, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ];
    const createSealedIxData = buildCreateSealedSeries1IxData(
      ED25519_IX_INDEX,
      BUY_IX_INDEX
    );
    instructions.push({
      programIdBase58: programId,
      accounts: createSealedAccounts,
      data: createSealedIxData,
    });
  }

  const compiled = compileProgramMessage({
    feePayerBase58: buyerWallet,
    recentBlockhashBase58,
    instructions,
  });

  // Estimate the serialized legacy-v1 transaction size BEFORE
  // signing. Legacy wire layout = [shortVec(num_sigs)] + [num_sigs ×
  // 64-byte sig] + messageBytes. With a single fee-payer signer
  // that's 1 (shortVec for count=1) + 64 + |messageBytes|.
  // The PWA gates the send on this being <= 1232 so we surface a
  // clean error instead of letting the RPC reject the tx.
  const serializedTxSize = 1 + 64 * compiled.header.numRequiredSigs + compiled.messageBytes.length;

  return {
    compiled,
    instructions,
    accounts,
    derived,
    canonicalBytes,
    signerPubkeyBytes,
    signatureBytes,
    productStatePda,
    createSealedAccounts,
    productType: quote.productType,
    quantity: quote.quantity,
    startDrawSlot: quote.startDrawSlot,
    endDrawSlot: quote.endDrawSlot,
    drawSlotsConsumed: quote.drawSlotsConsumed,
    spanielCoinIssued: quote.spanielCoinIssued || null,
    serializedTxSize,
  };
}

/**
 * Solana legacy-v1 transaction size cap. Wire-level the runtime
 * accepts up to 1232 bytes per packet (PACKET_DATA_SIZE - the IP/UDP
 * overhead); anything larger gets rejected at preflight before it
 * even hits the program.
 */
export const SOLANA_LEGACY_TX_MAX_BYTES = 1232;

/**
 * Convenience: build + single-signer sign in one shot. The PWA shell
 * uses this after fetching the blockhash; it then submits via
 * sendRawTransaction.
 *
 * @param {object} args
 * @param {Uint8Array} args.payerSeed
 * @returns {{
 *   txBytes: Uint8Array,
 *   txBase58: string,
 *   signatureBase58: string,
 *   preview: object
 * }}
 */
export function signBuyProductTransaction({ runtimeConfig, quote, account, recentBlockhashBase58, seriesId = SERIES_ID_DEFAULT }) {
  if (!account || !(account.seed instanceof Uint8Array)) {
    throw new Error('account.seed required');
  }
  if (typeof account.pubkeyBase58 !== 'string') {
    throw new Error('account.pubkeyBase58 required');
  }
  const built = buildBuyProductMessage({
    runtimeConfig,
    quote,
    buyerWallet: account.pubkeyBase58,
    recentBlockhashBase58,
    seriesId,
  });
  if (built.serializedTxSize > SOLANA_LEGACY_TX_MAX_BYTES) {
    const err = new Error(
      `built tx size ${built.serializedTxSize} > Solana legacy-v1 max ${SOLANA_LEGACY_TX_MAX_BYTES}; cannot submit`
    );
    err.code = 'TX_TOO_LARGE';
    err.serializedTxSize = built.serializedTxSize;
    throw err;
  }
  const signed = signSingleSignerTransaction({ compiled: built.compiled, payerSeed: account.seed });
  return {
    ...signed,
    preview: {
      productType: built.productType,
      quantity: built.quantity,
      startDrawSlot: built.startDrawSlot,
      endDrawSlot: built.endDrawSlot,
      drawSlotsConsumed: built.drawSlotsConsumed,
      serializedTxSize: built.serializedTxSize,
      accountKeys: built.compiled.accountKeysB58,
      accounts: built.accounts,
      seriesStatePda: built.derived.seriesStatePda,
      spanielCoinAuthorityPda: built.derived.spanielCoinAuthorityPda,
      buyerSpanielCoinAta: built.derived.buyerSpanielCoinAta,
      treasurySpanielCoinAta: built.derived.treasurySpanielCoinAta,
      affiliateSpanielCoinAta: built.derived.affiliateSpanielCoinAta,
      productStatePda: built.productStatePda,
      sealedWrapper: !!built.productStatePda,
      instructionCount: built.instructions.length,
      spanielCoinIssued: built.spanielCoinIssued,
    },
  };
}
