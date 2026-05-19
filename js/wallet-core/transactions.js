// Spaniel Wallet — Solana transaction primitives.
//
// We deliberately do NOT pull in the full @solana/web3.js bundle in
// wallet-core: it's ~200KB minified and only the SystemProgram
// transfer path is needed at first-party send time. The PWA can
// optionally hand us a compiled message produced by vendor/web3.mjs
// for richer flows (token transfers, Series 1 program calls); we
// just sign whatever bytes were given. The single ground-truth path
// implemented here is a System::Transfer (SOL) tx.
//
// Wire format reference: https://docs.solana.com/developing/programming-model/transactions
//
//   tx bytes layout:
//     [shortVec sig count] [sig_0..sig_n] [message bytes]
//   message bytes (legacy v0 is NOT used here; the legacy v1 shape):
//     [header (3 bytes)]
//       numRequiredSigs (1)
//       numReadonlySignedAccounts (1)
//       numReadonlyUnsignedAccounts (1)
//     [shortVec accountKeys count] [accountKey...32B each]
//     [recentBlockhash (32B)]
//     [shortVec instructions count] [instruction...]
//   instruction:
//     [programIdIndex (1B)]
//     [shortVec accounts count] [accountIndex...]
//     [shortVec data length] [data...]
//
// `shortVec` is Solana's compact-u16 (1–3 bytes). For our small
// transactions (≤3 accounts, ≤32 bytes of data) it's always 1 byte.

import { LAMPORTS_PER_SOL_BIG } from './units.js';
import { decodeBase58, encodeBase58, isValidBase58Pubkey } from './base58.js';
import { signMessage } from './signer.js';
import { InvalidAccountError } from './wallet-errors.js';
import { SYSTEM_PROGRAM_ID as SYSTEM_PROGRAM_ID_B58 } from '../lib/solana-program-ids.js';

const SYSTEM_INSTRUCTION_TRANSFER = 2;

function shortVecEncode(value) {
  // compact-u16
  if (value < 0 || value > 0xffff) throw new Error(`shortVec out of range: ${value}`);
  const out = [];
  let rem = value;
  while (true) {
    let byte = rem & 0x7f;
    rem >>= 7;
    if (rem === 0) {
      out.push(byte);
      break;
    }
    out.push(byte | 0x80);
  }
  return new Uint8Array(out);
}

function decodePubkey(b58) {
  if (!isValidBase58Pubkey(b58)) {
    throw new InvalidAccountError(`invalid pubkey: ${b58}`);
  }
  return decodeBase58(b58);
}

function u64ToLE(n) {
  if (typeof n === 'number') n = BigInt(n);
  if (typeof n !== 'bigint') throw new TypeError('lamports must be bigint or integer number');
  if (n < 0n || n > 0xffffffffffffffffn) throw new RangeError('u64 out of range');
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function concatBytes(...parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Compile a legacy SystemProgram::Transfer transaction message.
 *
 * @param {object} args
 * @param {string} args.fromBase58
 * @param {string} args.toBase58
 * @param {bigint} args.lamports
 * @param {string} args.recentBlockhashBase58 — Solana RPC `getLatestBlockhash` result
 * @returns {{ messageBytes: Uint8Array, accountKeysB58: string[] }}
 */
export function compileTransferMessage({ fromBase58, toBase58, lamports, recentBlockhashBase58 }) {
  if (typeof recentBlockhashBase58 !== 'string') {
    throw new InvalidAccountError('recentBlockhashBase58 must be string');
  }
  const fromKey = decodePubkey(fromBase58);
  const toKey = decodePubkey(toBase58);
  const systemKey = decodePubkey(SYSTEM_PROGRAM_ID_B58);
  const blockhash = decodeBase58(recentBlockhashBase58);
  if (blockhash.length !== 32) {
    throw new InvalidAccountError('recentBlockhash must decode to 32 bytes');
  }

  // Account ordering: [signer, writable_recipient, readonly_program].
  const accountKeys = [fromKey, toKey, systemKey];
  const header = new Uint8Array([1, 0, 1]);
  // numRequiredSigs=1, numReadonlySignedAccounts=0, numReadonlyUnsignedAccounts=1.

  // Transfer instruction: u32(2) little-endian + u64 lamports.
  const ixData = concatBytes(
    new Uint8Array([SYSTEM_INSTRUCTION_TRANSFER, 0, 0, 0]),
    u64ToLE(lamports)
  );

  const ixAccounts = new Uint8Array([0, 1]); // from, to
  const instruction = concatBytes(
    new Uint8Array([2]),               // programIdIndex = 2 (system program)
    shortVecEncode(ixAccounts.length),
    ixAccounts,
    shortVecEncode(ixData.length),
    ixData
  );

  const messageBytes = concatBytes(
    header,
    shortVecEncode(accountKeys.length),
    ...accountKeys,
    blockhash,
    shortVecEncode(1),                  // 1 instruction
    instruction
  );

  return {
    messageBytes,
    accountKeysB58: [fromBase58, toBase58, SYSTEM_PROGRAM_ID_B58]
  };
}

/**
 * Serialize a signed transaction: shortVec(sigs) + sigs + message.
 */
export function serializeSignedTransaction(messageBytes, signatures) {
  if (!Array.isArray(signatures) || signatures.length === 0) {
    throw new InvalidAccountError('signatures array required');
  }
  for (const sig of signatures) {
    if (!(sig instanceof Uint8Array) || sig.length !== 64) {
      throw new InvalidAccountError('each signature must be 64 bytes');
    }
  }
  return concatBytes(
    shortVecEncode(signatures.length),
    ...signatures,
    messageBytes
  );
}

/**
 * High-level convenience: build + sign a single-signer SOL transfer.
 *
 * @param {object} args
 * @param {Uint8Array} args.seed — sender's 32-byte seed
 * @param {string} args.fromBase58
 * @param {string} args.toBase58
 * @param {bigint} args.lamports
 * @param {string} args.recentBlockhashBase58
 * @returns {{ txBytes: Uint8Array, signatureBase58: string }}
 */
export function buildAndSignTransferSol(args) {
  const { messageBytes } = compileTransferMessage(args);
  const sig = signMessage(args.seed, messageBytes);
  const txBytes = serializeSignedTransaction(messageBytes, [sig]);
  return { txBytes, signatureBase58: encodeBase58(sig) };
}

export const TRANSFER_PROGRAM_IDS = Object.freeze({
  system: SYSTEM_PROGRAM_ID_B58
});

export const TRANSACTIONS_INFO = Object.freeze({
  supportedKinds: Object.freeze(['system_transfer']),
  notSupported: Object.freeze([
    // Documented stubs — implemented later or via vendor/web3.mjs.
    'spl_token_transfer',
    'card_transfer',
    'sealed_product_transfer',
    'series1_buy_product_with_quote'
  ])
});

export { LAMPORTS_PER_SOL_BIG };
