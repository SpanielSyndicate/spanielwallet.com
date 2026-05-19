// ─── SHARED WALLET ADAPTER ──────────────────────────────────────────
// Single source of truth for wallet discovery, selection, signing,
// disconnect. Used by buy.js (VersionedTransaction) and mint.js
// (legacy Transaction + signAllTransactions). Same Wallet Standard
// discovery in both places — no duplicate state, no two-copies-of-
// getWallets() drift.

import { Transaction, VersionedTransaction, PublicKey } from '../vendor/web3.mjs';
import { getWallets } from '../vendor/wallet-standard.mjs';

const WALLET_PICK_KEY = 'spaniel.walletPick';
const SOLANA_CHAIN = 'solana:mainnet';

const _registry = {
  inited: false,
  wallets: [],
  selectedName: null,
};

const _listeners = new Set();
function notifyChange() {
  for (const cb of _listeners) {
    try { cb(); } catch (e) { console.error('wallet listener failed:', e); }
  }
}

export function onWalletChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

function isSolanaStandardWallet(w) {
  const isSolanaChain = (c) => typeof c === 'string' && c.startsWith('solana:');
  if (Array.isArray(w.chains) && w.chains.some(isSolanaChain)) return true;
  const f = w.features;
  if (f && (f['solana:signTransaction'] || f['solana:signAndSendTransaction'])) return true;
  return false;
}

function adaptStandardWallet(w) {
  return {
    _isStandard: true,
    _wallet: w,
    name: w.name,
    icon: w.icon,
    get publicKey() {
      const acct = w.accounts?.[0];
      try { return acct ? new PublicKey(acct.address) : null; }
      catch { return null; }
    },
    get isConnected() {
      return Array.isArray(w.accounts) && w.accounts.length > 0;
    },
    async connect() {
      const feat = w.features?.['standard:connect'];
      if (!feat) throw new Error(`${w.name} does not expose standard:connect`);
      await feat.connect();
    },
    async signTransaction(tx) {
      const feat = w.features?.['solana:signTransaction'];
      if (!feat) throw new Error(`${w.name} does not expose solana:signTransaction`);
      const acct = w.accounts?.[0];
      if (!acct) throw new Error(`No connected account on ${w.name} — connect first`);
      const isVersioned = typeof tx.version !== 'undefined';
      const serialized = isVersioned
        ? tx.serialize()
        : tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      const results = await feat.signTransaction({
        transaction: serialized,
        account: acct,
        chain: SOLANA_CHAIN,
      });
      const signedBytes = results?.[0]?.signedTransaction;
      if (!signedBytes) throw new Error(`${w.name} returned no signed transaction`);
      return isVersioned
        ? VersionedTransaction.deserialize(signedBytes)
        : Transaction.from(signedBytes);
    },
    // signAllTransactions support for the mint flow's commit + reveal
    // bundle. Some wallets implement this as a batch under the same
    // feature; others fall back to N individual signTransaction calls.
    async signAllTransactions(txs) {
      // Some wallets expose signAllTransactions via feature; most via
      // a method on the standard wallet. Try both.
      if (typeof w.signAllTransactions === 'function') {
        return w.signAllTransactions(txs);
      }
      // Sequential fallback. Slower (N popups) but always works.
      const signed = [];
      for (const tx of txs) {
        signed.push(await this.signTransaction(tx));
      }
      return signed;
    },
    // Sign-In-With-Solana over an arbitrary UTF-8 message. Used by the
    // Worker auth flow (/api/auth/nonce → sign → /api/auth/verify).
    // Returns the 64-byte ed25519 signature as Uint8Array.
    async signMessage(message) {
      const bytes = typeof message === 'string' ? new TextEncoder().encode(message) : message;
      const feat = w.features?.['solana:signMessage'];
      if (!feat) throw new Error(`${w.name} does not expose solana:signMessage`);
      const acct = w.accounts?.[0];
      if (!acct) throw new Error(`No connected account on ${w.name} — connect first`);
      const results = await feat.signMessage({ message: bytes, account: acct });
      const sig = results?.[0]?.signature;
      if (!sig) throw new Error(`${w.name} returned no signature`);
      return sig instanceof Uint8Array ? sig : new Uint8Array(sig);
    },
  };
}

function initStandardRegistry() {
  if (_registry.inited) return;
  _registry.inited = true;
  try {
    const api = getWallets();
    const refresh = () => {
      _registry.wallets = api.get()
        .filter(isSolanaStandardWallet)
        .map(adaptStandardWallet);
      notifyChange();
    };
    refresh();
    api.on('register', refresh);
    api.on('unregister', refresh);
    try {
      _registry.selectedName = localStorage.getItem(WALLET_PICK_KEY);
    } catch { /* localStorage disabled — fine */ }
  } catch (e) {
    console.warn('Wallet Standard init failed; falling back to window globals only:', e);
  }
}
initStandardRegistry();

function detectLegacyProvider() {
  if (window.solana && window.solana.isPhantom) return Object.assign(window.solana, { name: window.solana.name || 'Phantom' });
  if (window.phantom?.solana) return Object.assign(window.phantom.solana, { name: 'Phantom' });
  if (window.solflare && window.solflare.isSolflare) return Object.assign(window.solflare, { name: 'Solflare' });
  if (window.backpack) return Object.assign(window.backpack, { name: 'Backpack' });
  if (window.solana) return Object.assign(window.solana, { name: window.solana.name || 'Solana wallet' });
  return null;
}

export function detectAllProviders() {
  const out = [..._registry.wallets];
  const haveNames = new Set(out.map(w => (w.name || '').toLowerCase()));
  const legacy = detectLegacyProvider();
  if (legacy && !haveNames.has((legacy.name || '').toLowerCase())) {
    out.push(legacy);
  }
  return out;
}

export function detectProvider() {
  const all = detectAllProviders();
  if (all.length === 0) return null;
  if (_registry.selectedName) {
    const picked = all.find(w => (w.name || '').toLowerCase() === _registry.selectedName.toLowerCase());
    if (picked) return picked;
  }
  return all[0];
}

export function pickWallet(name) {
  _registry.selectedName = name || null;
  try {
    if (name) localStorage.setItem(WALLET_PICK_KEY, name);
    else localStorage.removeItem(WALLET_PICK_KEY);
  } catch { /* localStorage disabled */ }
  notifyChange();
}

export async function disconnectWallet() {
  const p = detectProvider();
  if (!p) return;
  if (typeof p.disconnect === 'function') {
    try { await p.disconnect(); } catch (_) {}
  }
  if (p._isStandard) {
    const feat = p._wallet?.features?.['standard:disconnect'];
    if (feat) { try { await feat.disconnect(); } catch (_) {} }
  }
  notifyChange();
}

// Exposed for legacy inline onclick handlers in the nav badge.
window.__spanielPickWallet = pickWallet;
window.__spanielDisconnectWallet = disconnectWallet;
