// Spaniel Wallet — high-level send helpers.
//
// `prepareSendSol` packages a tx envelope ready for submission. The
// adapter caller (the PWA shell) is responsible for fetching the
// recent blockhash and submitting the resulting bytes to its RPC.
//
// We deliberately keep RPC concerns OUT of wallet-core so tests
// remain hermetic (no network).

import {
  buildAndSignTransferSol,
  compileTransferMessage,
  serializeSignedTransaction
} from './transactions.js';
import { encodeBase58 } from './base58.js';
import { solToLamports } from './units.js';
import { InvalidAccountError } from './wallet-errors.js';

/**
 * Build + sign a SOL transfer. The caller passes the active account
 * (seed + pubkey) and the destination. Lamports may be a bigint, a
 * number-of-SOL float, or an explicit `{ lamports: bigint }` object.
 */
export function prepareSendSol({ account, toBase58, amount, recentBlockhashBase58, memo = null }) {
  if (!account || !(account.seed instanceof Uint8Array)) {
    throw new InvalidAccountError('account.seed required');
  }
  if (typeof toBase58 !== 'string' || !toBase58.length) {
    throw new InvalidAccountError('toBase58 required');
  }
  const lamports = normalizeAmount(amount);
  const result = buildAndSignTransferSol({
    seed: account.seed,
    fromBase58: account.pubkeyBase58,
    toBase58,
    lamports,
    recentBlockhashBase58
  });
  return {
    fromBase58: account.pubkeyBase58,
    toBase58,
    lamports,
    txBase58: encodeBase58(result.txBytes),
    txBytes: result.txBytes,
    signatureBase58: result.signatureBase58,
    memo
  };
}

function normalizeAmount(amount) {
  if (typeof amount === 'bigint') return amount;
  if (typeof amount === 'number') return solToLamports(amount);
  if (amount && typeof amount === 'object') {
    if (typeof amount.lamports === 'bigint') return amount.lamports;
    if (typeof amount.sol === 'number') return solToLamports(amount.sol);
  }
  throw new InvalidAccountError('amount must be bigint, number (SOL), or { lamports } / { sol }');
}

// NOTE: a `signOpaqueMessage` byte-oracle previously lived here. It
// was removed because (1) no production caller used it and (2) signing
// arbitrary bytes with the wallet seed is a tx-forgery hazard — a
// caller persuaded to "sign a message" could be handed a serialized
// transaction message under the same signing key. For off-chain
// messages, use `signMessage` from signer.js with an explicit domain
// tag prefix; for Solana transactions, use `signSingleSignerTransaction`
// from program-transaction.js, which enforces a one-signer header.

export { serializeSignedTransaction, compileTransferMessage };
