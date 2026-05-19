// /binder — Worker open quote → Series 1 open_product tx.
//
// Pure pipeline (mirrors series1-buy.js). Reads only the public-shape
// fields the Worker returns from POST /api/products/open/quote plus
// the runtime-config values (series1ProgramId, cnft block) and
// returns a signed, base58-encoded legacy-v1 transaction ready for
// sendRawTransaction. Does NO RPC, NO signing, NO storage.
//
// The PWA shell (binder-page.js) is responsible for:
//   - fetching the Worker open quote,
//   - calling `getLatestBlockhash` on the configured devnet RPC,
//   - calling this module to build the tx,
//   - signing with the opener's wallet seed,
//   - submitting via `sendRawTransaction`,
//   - polling `confirmSignature`,
//   - calling `/api/products/open/record` after the tx confirms,
//   - refreshing the binder list.
//
// Tree + per-card mint payloads come from the open-quote response —
// the worker is the single source of truth for which Bubblegum tree
// is active in the current cluster.

import {
  SERIES1_IX,
  SERIES1_QUOTE_LEN,
  SERIES1_ACCOUNT_SHAPES,
  buildOpenProductTransaction,
} from '../lib/series1-program.js';
import {
  SYSTEM_PROGRAM_ID,
  SYSVAR_INSTRUCTIONS_ID,
  METAPLEX_BUBBLEGUM_PROGRAM_ID,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
} from '../lib/solana-program-ids.js';
import {
  compileProgramMessage,
  signSingleSignerTransaction,
} from '../wallet-core/program-transaction.js';
import { decodeBase58, encodeBase58, isValidBase58Pubkey } from '../wallet-core/base58.js';
import { WalletError } from '../wallet-core/wallet-errors.js';

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
 * Resolve the 10-account list the open_product handler expects.
 *
 * Mirrors `SERIES1_ACCOUNT_SHAPES.openProduct` 1-to-1; account
 * positions are locked by the on-chain handler at
 * `programs/spaniel_series1/src/handlers/open_product.rs`.
 *
 * @param {object} args
 * @param {string} args.openerWallet
 * @param {string} args.seriesStatePda
 * @param {string} args.productStatePda
 * @param {string} args.treeConfigPda    Bubblegum-derived PDA
 * @param {string} args.merkleTree       Tree state account
 */
export function resolveOpenProductAccounts({
  openerWallet,
  seriesStatePda,
  productStatePda,
  treeConfigPda,
  merkleTree,
}) {
  for (const [name, v] of Object.entries({
    openerWallet, seriesStatePda, productStatePda, treeConfigPda, merkleTree,
  })) {
    if (!isValidBase58Pubkey(v)) {
      throw new WalletError('BAD_PUBKEY', `${name} is not a valid base58 pubkey`);
    }
  }
  return [
    { pubkey: openerWallet,                    isSigner: true,  isWritable: true  },
    { pubkey: seriesStatePda,                  isSigner: false, isWritable: true  },
    { pubkey: productStatePda,                 isSigner: false, isWritable: true  },
    { pubkey: SYSVAR_INSTRUCTIONS_ID,          isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID,               isSigner: false, isWritable: false },
    { pubkey: METAPLEX_BUBBLEGUM_PROGRAM_ID,   isSigner: false, isWritable: false },
    { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SPL_NOOP_PROGRAM_ID,             isSigner: false, isWritable: false },
    { pubkey: treeConfigPda,                   isSigner: false, isWritable: true  },
    { pubkey: merkleTree,                      isSigner: false, isWritable: true  },
  ];
}

/**
 * Decode a Worker openQuote response into the signedQuote shape the
 * builder consumes. Throws if the quote is missing required fields.
 */
function workerQuoteToSignedQuote(openQuote, quoteSignerBase58) {
  if (!openQuote || typeof openQuote !== 'object') {
    throw new WalletError('BAD_QUOTE', 'openQuote must be an object');
  }
  if (openQuote.gated) {
    const code = openQuote.code || 'GATED';
    throw new WalletError(code, `open quote gated: ${code}`);
  }
  const { quoteSignature, expiresAtUnix } = openQuote;
  if (typeof quoteSignature !== 'string' || !quoteSignature) {
    throw new WalletError('NO_QUOTE_SIG', 'open quote missing quoteSignature');
  }
  if (typeof quoteSignerBase58 !== 'string' || !quoteSignerBase58) {
    throw new WalletError('NO_QUOTE_SIGNER', 'runtime-config.quoteSignerPubkey is required');
  }
  // canonicalQuoteBytes is the 142-byte signed-message payload.
  // The Worker returns it via a side helper to keep the JSON small;
  // for the open path we accept either (a) an explicit hex/base64
  // field, or (b) reconstruction from the structured fields when
  // the Worker started shipping the hex. The simplest contract is:
  // worker must ship `canonicalQuoteHex` along with the
  // structured fields. For now we accept either:
  let canonicalQuoteBytes;
  if (typeof openQuote.canonicalQuoteHex === 'string') {
    canonicalQuoteBytes = hexToBytes(openQuote.canonicalQuoteHex);
  } else if (openQuote.canonicalQuoteBytes instanceof Uint8Array) {
    canonicalQuoteBytes = openQuote.canonicalQuoteBytes;
  } else {
    throw new WalletError(
      'NO_CANONICAL_BYTES',
      'open quote missing canonicalQuoteHex (worker must include the 142-byte signed payload)'
    );
  }
  if (canonicalQuoteBytes.length !== SERIES1_QUOTE_LEN.PRODUCT_OPEN) {
    throw new WalletError(
      'BAD_CANONICAL_LEN',
      `canonicalQuoteBytes must be ${SERIES1_QUOTE_LEN.PRODUCT_OPEN} bytes, got ${canonicalQuoteBytes.length}`
    );
  }
  const signature = decodeBase58(quoteSignature);
  if (signature.length !== 64) {
    throw new WalletError('BAD_SIG_LEN', 'quoteSignature must be a 64-byte base58 ed25519 signature');
  }
  const signerPubkeyBytes = decodeBase58(quoteSignerBase58);
  return {
    canonicalQuoteBytes,
    signature,
    signerPubkeyBytes,
    expiresAtUnix,
  };
}

/**
 * Build a fully signed open_product transaction ready for
 * sendRawTransaction.
 *
 * @param {object} params
 * @param {string} params.programId       base58 Series 1 Program id
 * @param {string} params.quoteSignerBase58
 * @param {object} params.openQuote       Worker `/api/products/open/quote` body
 * @param {object} params.accountsArgs    Inputs for resolveOpenProductAccounts
 * @param {Uint8Array} params.openerSeed  32-byte ed25519 seed
 * @param {string} params.recentBlockhash base58 recent blockhash
 * @returns {{
 *   signedTxBase58: string,
 *   signatureBase58: string,
 *   ed25519: object,
 *   series1: object
 * }}
 */
export function buildSignedOpenProductTransaction({
  programId,
  quoteSignerBase58,
  openQuote,
  accountsArgs,
  openerSeed,
  recentBlockhash,
}) {
  if (!programId) throw new WalletError('NO_PROGRAM_ID', 'series1ProgramId required');
  const signedQuote = workerQuoteToSignedQuote(openQuote, quoteSignerBase58);
  const accounts = resolveOpenProductAccounts(accountsArgs);

  const tx = buildOpenProductTransaction({
    programId,
    signedQuote,
    accounts,
    cardMintPayloads: openQuote.cardMintPayloads,
    nowUnix: Math.floor(Date.now() / 1000),
  });

  // Compose: [ed25519 precompile ix, open_product ix]. The builder
  // emits `{ programId, accounts, data }` per ix; compileProgramMessage
  // expects `programIdBase58`. Translate without leaking the field
  // shape to upstream callers.
  const message = compileProgramMessage({
    feePayerBase58: accountsArgs.openerWallet,
    recentBlockhashBase58: recentBlockhash,
    instructions: [
      { programIdBase58: tx.ed25519.programId, accounts: tx.ed25519.accounts, data: tx.ed25519.data },
      { programIdBase58: tx.series1.programId, accounts: tx.series1.accounts, data: tx.series1.data },
    ],
  });
  const signed = signSingleSignerTransaction({ compiled: message, payerSeed: openerSeed });
  return {
    signedTxBase58: signed.txBase58,
    signatureBase58: signed.signatureBase58,
    ed25519: tx.ed25519,
    series1: tx.series1,
  };
}

/**
 * Lightweight sanity guard — exported so the binder UI can render a
 * gated state without trying to build a tx when prerequisites are
 * missing. Returns a `{ ready: bool, code?, reason? }` shape.
 */
export function checkOpenReadiness({ runtimeConfig, openQuote }) {
  if (!runtimeConfig?.series1ProgramId) {
    return { ready: false, code: 'PROGRAM_PENDING', reason: 'Series 1 Program id not configured' };
  }
  if (!openQuote) {
    return { ready: false, code: 'NO_QUOTE', reason: 'open quote not loaded yet' };
  }
  if (openQuote.gated) {
    return { ready: false, code: openQuote.code || 'GATED', reason: openQuote.reason || 'open quote returned a gate' };
  }
  if (!openQuote.cnft?.treeAddress || !openQuote.cnft?.treeAuthority) {
    return { ready: false, code: 'CNFT_TREE_PENDING', reason: 'cNFT tree not configured in the worker for this cluster' };
  }
  if (!openQuote.quoteSignature) {
    return { ready: false, code: 'NO_QUOTE_SIG', reason: 'open quote missing signature (Worker has no signer key)' };
  }
  if (!Array.isArray(openQuote.cardMintPayloads) || openQuote.cardMintPayloads.length === 0) {
    return { ready: false, code: 'NO_CARD_PAYLOADS', reason: 'open quote missing cardMintPayloads' };
  }
  // Sanity: the openProduct shape we built against in series1-program.js
  // must declare exactly 10 accounts; if shape drifts, surface here
  // instead of failing inside the builder.
  if (SERIES1_ACCOUNT_SHAPES.openProduct.length !== 10) {
    return { ready: false, code: 'SHAPE_DRIFT', reason: 'openProduct account shape drifted' };
  }
  return { ready: true };
}

