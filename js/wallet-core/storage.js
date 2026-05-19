// Spaniel Wallet — encrypted-vault storage adapters.
//
// Adapters share a tiny KV interface:
//   { get(key), put(key, value), del(key), keys() }
//
// `value` is always a JSON-serializable envelope (encryption.js) or
// metadata. We never serialize anything sensitive in cleartext —
// only AES-256-GCM envelopes, the active-account pubkey, and a
// non-secret metadata blob (account labels, etc.).
//
// Three adapters ship here:
//
//   memoryStorage()       — for tests + the "no-IndexedDB" fallback.
//   indexedDbStorage(db)  — for the browser PWA (factory: openWalletDb).
//   sessionStorage()      — short-lived "unlocked secret cache" for the
//                            current tab. Used by the PWA only with an
//                            explicit user toggle ("remember for this
//                            tab session"). NEVER persisted to disk.
//
// localStorage is intentionally NOT supported; per project guardrails
// we never store secrets there.

import { UnsupportedEnvironmentError, VaultNotFoundError } from './wallet-errors.js';

export const VAULT_KEY = 'spaniel.wallet.vault.v1';
export const META_KEY = 'spaniel.wallet.meta.v1';
export const ACTIVE_KEY = 'spaniel.wallet.activePubkey.v1';

export function memoryStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    name: 'memory',
    async get(key) {
      return store.has(key) ? clone(store.get(key)) : null;
    },
    async put(key, value) {
      store.set(key, clone(value));
    },
    async del(key) {
      store.delete(key);
    },
    async keys() {
      return [...store.keys()];
    },
    async clear() {
      store.clear();
    }
  };
}

function clone(v) {
  return v == null ? v : JSON.parse(JSON.stringify(v));
}

// ─────────────────────────────────────────────────────────────────────
// IndexedDB adapter
// ─────────────────────────────────────────────────────────────────────

const DB_NAME = 'spaniel-wallet';
const DB_VERSION = 1;
const STORE = 'kv';

function requireIdb() {
  if (typeof indexedDB === 'undefined') {
    throw new UnsupportedEnvironmentError('IndexedDB');
  }
}

export function openWalletDb() {
  requireIdb();
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function indexedDbStorage(db) {
  requireIdb();
  function tx(mode) {
    return db.transaction(STORE, mode).objectStore(STORE);
  }
  function run(store, op) {
    return new Promise((resolve, reject) => {
      const req = op(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return {
    name: 'indexeddb',
    async get(key) {
      const val = await run(tx('readonly'), (s) => s.get(key));
      return val === undefined ? null : val;
    },
    async put(key, value) {
      await run(tx('readwrite'), (s) => s.put(value, key));
    },
    async del(key) {
      await run(tx('readwrite'), (s) => s.delete(key));
    },
    async keys() {
      return run(tx('readonly'), (s) => s.getAllKeys());
    },
    async clear() {
      await run(tx('readwrite'), (s) => s.clear());
    }
  };
}

// ─────────────────────────────────────────────────────────────────────
// Lightweight default-storage factory
// ─────────────────────────────────────────────────────────────────────

export async function defaultStorage() {
  if (typeof indexedDB !== 'undefined') {
    try {
      const db = await openWalletDb();
      return indexedDbStorage(db);
    } catch (e) {
      // Private browsing or storage-blocked context; fall back to memory.
      // We deliberately do NOT touch localStorage.
      console.warn('Spaniel Wallet: IndexedDB unavailable, using volatile in-memory storage', e);
      return memoryStorage();
    }
  }
  return memoryStorage();
}

export async function loadVaultEnvelope(storage) {
  const v = await storage.get(VAULT_KEY);
  if (!v) throw new VaultNotFoundError();
  return v;
}

export async function saveVaultEnvelope(storage, envelope) {
  await storage.put(VAULT_KEY, envelope);
}

export async function loadMeta(storage) {
  return (await storage.get(META_KEY)) ?? { accounts: [], activePubkey: null, createdAt: null };
}

export async function saveMeta(storage, meta) {
  await storage.put(META_KEY, meta);
}

export async function wipeWallet(storage) {
  await storage.del(VAULT_KEY);
  await storage.del(META_KEY);
  await storage.del(ACTIVE_KEY);
}
