// Spaniel Wallet — generic multi-instruction Solana transaction compiler.
//
// Compiles a legacy-v1 Solana transaction message containing an
// arbitrary list of instructions. The fee payer is the first signer.
//
// Wire format reference: https://docs.solana.com/developing/programming-model/transactions
//
// This is the message-only compiler. Sign the returned `messageBytes`
// with the fee payer's seed, then call `serializeSignedTransaction`
// from `./transactions.js` to produce the wire bytes for
// `sendTransaction`.
//
// Account ordering rules enforced here:
//   1. Each pubkey appears at most once in `accountKeys`.
//   2. Signers come before non-signers.
//   3. Within signers, writable comes before read-only.
//   4. Within non-signers, writable comes before read-only.
//   5. The fee payer is forced into accountKeys[0] (signer, writable).
//   6. Each instruction's `programId` lands as a read-only non-signer.
//
// These rules match Solana's `legacy::Message::compile` so the
// runtime accepts our compiled message.

import { decodeBase58, encodeBase58, isValidBase58Pubkey } from './base58.js';
import { InvalidAccountError } from './wallet-errors.js';
import { signMessage } from './signer.js';

const SHORT_VEC_MAX = 0xffff;

function shortVecEncode(value) {
  if (value < 0 || value > SHORT_VEC_MAX) {
    throw new Error(`shortVec out of range: ${value}`);
  }
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

function concatBytes(parts) {
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

function decodePubkey(b58, label) {
  if (typeof b58 !== 'string' || !isValidBase58Pubkey(b58)) {
    throw new InvalidAccountError(`${label}: not a valid base58 pubkey: ${b58}`);
  }
  return decodeBase58(b58);
}

/**
 * Compile a legacy-v1 Solana transaction message.
 *
 * @param {object} args
 * @param {string} args.feePayerBase58
 * @param {string} args.recentBlockhashBase58
 * @param {Array<{
 *   programIdBase58: string,
 *   accounts: Array<{pubkey: string, isSigner: boolean, isWritable: boolean}>,
 *   data: Uint8Array
 * }>} args.instructions
 *
 * @returns {{
 *   messageBytes: Uint8Array,
 *   accountKeysB58: string[],
 *   header: { numRequiredSigs: number, numReadonlySignedAccounts: number, numReadonlyUnsignedAccounts: number },
 *   signerPubkeysB58: string[]
 * }}
 */
export function compileProgramMessage({ feePayerBase58, recentBlockhashBase58, instructions }) {
  if (typeof feePayerBase58 !== 'string' || !isValidBase58Pubkey(feePayerBase58)) {
    throw new InvalidAccountError('feePayer must be valid base58 pubkey');
  }
  if (typeof recentBlockhashBase58 !== 'string') {
    throw new InvalidAccountError('recentBlockhash must be string');
  }
  const blockhash = decodeBase58(recentBlockhashBase58);
  if (blockhash.length !== 32) {
    throw new InvalidAccountError('recentBlockhash must decode to 32 bytes');
  }
  if (!Array.isArray(instructions) || instructions.length === 0) {
    throw new InvalidAccountError('instructions array must be non-empty');
  }

  // Gather all (pubkey, requiredFlags) tuples. Per-key flags
  // get OR'd across instructions — once a key is a signer or writable
  // in ANY instruction, it stays signer/writable in the compiled
  // message.
  /** @type {Map<string,{isSigner: boolean, isWritable: boolean}>} */
  const flagsByKey = new Map();
  // Fee payer is implicitly signer + writable.
  flagsByKey.set(feePayerBase58, { isSigner: true, isWritable: true });

  for (let i = 0; i < instructions.length; i++) {
    const ix = instructions[i];
    if (typeof ix?.programIdBase58 !== 'string' || !isValidBase58Pubkey(ix.programIdBase58)) {
      throw new InvalidAccountError(`instruction[${i}].programIdBase58 invalid`);
    }
    if (!Array.isArray(ix.accounts)) {
      throw new InvalidAccountError(`instruction[${i}].accounts must be array`);
    }
    if (!(ix.data instanceof Uint8Array)) {
      throw new InvalidAccountError(`instruction[${i}].data must be Uint8Array`);
    }
    for (let j = 0; j < ix.accounts.length; j++) {
      const a = ix.accounts[j];
      if (typeof a?.pubkey !== 'string' || !isValidBase58Pubkey(a.pubkey)) {
        throw new InvalidAccountError(`instruction[${i}].accounts[${j}].pubkey invalid`);
      }
      const cur = flagsByKey.get(a.pubkey) || { isSigner: false, isWritable: false };
      flagsByKey.set(a.pubkey, {
        isSigner: cur.isSigner || !!a.isSigner,
        isWritable: cur.isWritable || !!a.isWritable,
      });
    }
    // The program id is always a read-only non-signer reference
    // (executable accounts are forbidden from being writable).
    if (!flagsByKey.has(ix.programIdBase58)) {
      flagsByKey.set(ix.programIdBase58, { isSigner: false, isWritable: false });
    }
  }

  // Order keys: signers-writable, signers-readonly, nonsigners-writable, nonsigners-readonly.
  // Within each band, fee payer goes first if applicable; otherwise order is insertion order.
  const allKeys = Array.from(flagsByKey.keys());
  const orderedKeys = [];

  function pickBand(predicate, options = {}) {
    for (const k of allKeys) {
      if (orderedKeys.includes(k)) continue;
      const f = flagsByKey.get(k);
      if (predicate(f, k)) orderedKeys.push(k);
    }
  }
  // Fee payer first (signer + writable).
  orderedKeys.push(feePayerBase58);
  pickBand((f) => f.isSigner && f.isWritable);
  pickBand((f) => f.isSigner && !f.isWritable);
  pickBand((f) => !f.isSigner && f.isWritable);
  pickBand((f) => !f.isSigner && !f.isWritable);

  if (orderedKeys.length !== allKeys.length) {
    throw new InvalidAccountError('internal: account ordering missed a key');
  }

  // Sanity: max accounts per legacy-v1 message is 256 (one byte per
  // account index). We need indices to fit into u8 because the
  // instruction body references them as 1-byte indices.
  if (orderedKeys.length > 256) {
    throw new InvalidAccountError(`too many accounts (${orderedKeys.length} > 256)`);
  }

  // Header counts.
  const numRequiredSigs = orderedKeys.filter((k) => flagsByKey.get(k).isSigner).length;
  const numReadonlySignedAccounts = orderedKeys
    .filter((k) => flagsByKey.get(k).isSigner && !flagsByKey.get(k).isWritable).length;
  const numReadonlyUnsignedAccounts = orderedKeys
    .filter((k) => !flagsByKey.get(k).isSigner && !flagsByKey.get(k).isWritable).length;
  if (numRequiredSigs > 255 || numReadonlySignedAccounts > 255 || numReadonlyUnsignedAccounts > 255) {
    throw new InvalidAccountError('header field exceeds u8 range');
  }
  const header = new Uint8Array([
    numRequiredSigs,
    numReadonlySignedAccounts,
    numReadonlyUnsignedAccounts,
  ]);

  const indexByKey = new Map();
  for (let i = 0; i < orderedKeys.length; i++) indexByKey.set(orderedKeys[i], i);
  const accountKeyBytes = orderedKeys.map((k) => decodePubkey(k, 'accountKey'));

  // Compile each instruction.
  const ixBytesList = [];
  for (let i = 0; i < instructions.length; i++) {
    const ix = instructions[i];
    const programIdx = indexByKey.get(ix.programIdBase58);
    if (programIdx === undefined) {
      throw new InvalidAccountError(`instruction[${i}] programId missing from accountKeys`);
    }
    const accountIndices = new Uint8Array(ix.accounts.length);
    for (let j = 0; j < ix.accounts.length; j++) {
      const idx = indexByKey.get(ix.accounts[j].pubkey);
      if (idx === undefined) {
        throw new InvalidAccountError(`instruction[${i}].accounts[${j}] missing from accountKeys`);
      }
      accountIndices[j] = idx;
    }
    const ixBody = concatBytes([
      Uint8Array.of(programIdx),
      shortVecEncode(accountIndices.length),
      accountIndices,
      shortVecEncode(ix.data.length),
      ix.data,
    ]);
    ixBytesList.push(ixBody);
  }

  const messageBytes = concatBytes([
    header,
    shortVecEncode(accountKeyBytes.length),
    ...accountKeyBytes,
    blockhash,
    shortVecEncode(ixBytesList.length),
    ...ixBytesList,
  ]);

  return {
    messageBytes,
    accountKeysB58: orderedKeys.slice(),
    header: {
      numRequiredSigs,
      numReadonlySignedAccounts,
      numReadonlyUnsignedAccounts,
    },
    signerPubkeysB58: orderedKeys.filter((k) => flagsByKey.get(k).isSigner),
  };
}

/**
 * Sign a compiled message with a single fee-payer seed and return
 * the wire-serialized transaction (suitable for
 * `sendTransaction({encoding: 'base58'})`).
 *
 * Only the first signer (the fee payer) is signed here. If the
 * compiled message demands more signers (e.g. an asset mint
 * account), the caller must collect those signatures separately
 * via `signMessage(seed, messageBytes)` and assemble the tx
 * bytes manually.
 */
export function signSingleSignerTransaction({ compiled, payerSeed }) {
  if (!(payerSeed instanceof Uint8Array)) {
    throw new InvalidAccountError('payerSeed must be Uint8Array');
  }
  const { messageBytes, header } = compiled;
  if (header.numRequiredSigs !== 1) {
    throw new InvalidAccountError(
      `signSingleSignerTransaction: message requires ${header.numRequiredSigs} signers — use the multi-signer path`
    );
  }
  const sig = signMessage(payerSeed, messageBytes);
  const txBytes = concatBytes([
    shortVecEncode(1),
    sig,
    messageBytes,
  ]);
  return {
    txBytes,
    txBase58: encodeBase58(txBytes),
    signatureBase58: encodeBase58(sig),
    signature: sig,
  };
}
