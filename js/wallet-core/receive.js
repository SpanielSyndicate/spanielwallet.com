// Spaniel Wallet — receive helpers.
//
// "Receive" is just exposing the active pubkey + a Solana Pay-style
// URI. The PWA UI renders the pubkey, copy button, and a QR encoded
// from `solanaPayUri()`. Token-account derivation for USDC is a stub
// here; the PWA delegates to vendor/web3.mjs when USDC support lands.

import { isValidBase58Pubkey } from './base58.js';
import { InvalidAccountError } from './wallet-errors.js';

/**
 * Build a Solana Pay deep-link URI. `amount` is in SOL and may be
 * omitted for an open-amount QR. See https://docs.solanapay.com/spec.
 */
export function solanaPayUri({ pubkeyBase58, amount = null, label = 'Spaniel Wallet', message = null, memo = null, splToken = null }) {
  if (!isValidBase58Pubkey(pubkeyBase58)) {
    throw new InvalidAccountError('invalid pubkey');
  }
  const url = new URL(`solana:${pubkeyBase58}`);
  if (amount != null) {
    if (typeof amount !== 'number' && typeof amount !== 'string') {
      throw new InvalidAccountError('amount must be number or string');
    }
    url.searchParams.set('amount', String(amount));
  }
  if (label) url.searchParams.set('label', label);
  if (message) url.searchParams.set('message', message);
  if (memo) url.searchParams.set('memo', memo);
  if (splToken) url.searchParams.set('spl-token', splToken);
  return url.toString();
}

export function shortPubkey(pubkeyBase58) {
  if (typeof pubkeyBase58 !== 'string' || pubkeyBase58.length < 8) return pubkeyBase58 ?? '';
  return `${pubkeyBase58.slice(0, 4)}…${pubkeyBase58.slice(-4)}`;
}
