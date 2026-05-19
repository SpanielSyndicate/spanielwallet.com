// Spaniel Wallet — vault: create/unlock/lock/rotate.
//
// The vault is the user's authoritative store of secret material. Two
// pieces of state live here:
//
//   1. The *envelope* — AES-256-GCM-encrypted JSON blob containing one
//      or more 32-byte ed25519 seeds. The envelope is persisted to
//      IndexedDB via the storage adapter.
//
//   2. The *unlocked state* — only held in memory while the user has
//      typed their passphrase. Held by the caller (PWA shell), not by
//      this module. We return a struct on unlock and accept it back on
//      operations that need to sign.
//
// We deliberately keep no global singleton: the PWA app shell owns the
// unlocked state and clears it on lock/wipe/timeout.
//
// Vault formats:
//   v1 — random 32-byte ed25519 seed; no mnemonic. No recovery path
//        beyond the seed itself. Pre-2026-05-19 vaults.
//   v2 — BIP-39 mnemonic → SLIP-10 m/44'/501'/0'/0' → ed25519 seed.
//        Mnemonic stored inside the encrypted payload so the user
//        can re-reveal from the Security page. Phantom-compatible:
//        users can re-import the same mnemonic into Phantom and see
//        the same address.
//
// unlockVault transparently handles both formats.

import {
  encryptVault,
  decryptVault,
  ENCRYPTION_INFO
} from './encryption.js';
import {
  randomSeed,
  keypairFromSeed,
  keypairFromSecretKey,
  SEED_BYTES
} from './keygen.js';
import {
  loadVaultEnvelope,
  saveVaultEnvelope,
  loadMeta,
  saveMeta,
  wipeWallet
} from './storage.js';
import { encodeBase58, decodeBase58 } from './base58.js';
import {
  InvalidAccountError,
  VaultLockedError
} from './wallet-errors.js';
import {
  generateMnemonic,
  mnemonicToSeed,
  describeMnemonicProblem,
  deriveEd25519SeedFromBip39Seed,
  SOLANA_BIP44_PATH,
} from './mnemonic.js';

const VAULT_FORMAT_V1 = 'spaniel-vault-v1';
const VAULT_FORMAT_V2 = 'spaniel-vault-v2';
const VAULT_FORMAT = VAULT_FORMAT_V2;

function seedToHex(seed) {
  let h = '';
  for (let i = 0; i < seed.length; i++) {
    h += seed[i].toString(16).padStart(2, '0');
  }
  return h;
}

function hexToSeed(hex) {
  if (typeof hex !== 'string' || hex.length !== SEED_BYTES * 2) {
    throw new InvalidAccountError('seed hex must be 64 chars');
  }
  const out = new Uint8Array(SEED_BYTES);
  for (let i = 0; i < SEED_BYTES; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Create a brand-new BIP-39-backed vault. Generates a fresh 12-word
 * mnemonic, derives the ed25519 seed via SLIP-10 at the canonical
 * Solana path m/44'/501'/0'/0' (Phantom-compatible).
 *
 * The mnemonic is stored INSIDE the encrypted vault payload so the
 * user can re-reveal it later from the Security page. It is also
 * returned to the caller so the create flow can guide the user
 * through the one-time backup quiz BEFORE persisting.
 *
 * @param {object} args
 * @param {string} args.passphrase
 * @param {string} [args.label]
 * @param {12|24} [args.wordCount=12]
 * @returns {Promise<{
 *   envelope: object, meta: object, unlocked: object,
 *   mnemonic: string, words: readonly string[],
 * }>}
 */
export async function createVault({ passphrase, label = 'Account 1', wordCount = 12 }) {
  const gen = generateMnemonic({ wordCount });
  const bip39Seed = await mnemonicToSeed(gen.mnemonic);
  const ed25519Seed = await deriveEd25519SeedFromBip39Seed(bip39Seed, SOLANA_BIP44_PATH);
  const kp = keypairFromSeed(ed25519Seed);
  const payload = {
    format: VAULT_FORMAT_V2,
    createdAt: nowIso(),
    mnemonic: gen.mnemonic,
    derivationPath: SOLANA_BIP44_PATH,
    accounts: [{
      pubkeyBase58: kp.pubkeyBase58,
      label,
      seedHex: seedToHex(ed25519Seed),
      derivationPath: SOLANA_BIP44_PATH,
      accountIndex: 0,
      createdAt: nowIso(),
    }],
  };
  const envelope = await encryptVault(JSON.stringify(payload), passphrase);
  const meta = {
    accounts: [{ pubkeyBase58: kp.pubkeyBase58, label, createdAt: payload.accounts[0].createdAt }],
    activePubkey: kp.pubkeyBase58,
    createdAt: payload.createdAt,
  };
  return {
    envelope,
    meta,
    unlocked: {
      accounts: [{ ...kp, label }],
      activePubkey: kp.pubkeyBase58,
      hasMnemonic: true,
    },
    mnemonic: gen.mnemonic,
    words: gen.words,
  };
}

/**
 * Import an existing wallet. Accepts ANY of:
 *   - a 12/15/18/21/24 word BIP-39 mnemonic (e.g. exported from
 *     Phantom). Derived via SLIP-10 at m/44'/501'/0'/0' so the
 *     resulting address matches Phantom's default account.
 *   - a 32-byte raw ed25519 seed (hex)
 *   - a 64-byte ed25519 secret key (hex or base58 — both forms
 *     Phantom exports under "Export Private Key")
 *
 * @param {object} args
 * @param {string} args.passphrase
 * @param {string|Uint8Array} args.secret
 * @param {string} [args.label]
 * @returns {Promise<{
 *   envelope: object, meta: object, unlocked: object,
 *   importedAs: 'mnemonic'|'rawSeed',
 *   mnemonic?: string,
 * }>}
 */
export async function importVault({ passphrase, secret, label = 'Imported account' }) {
  const { seed, mnemonic } = await parseImportedSecretAsync(secret);
  const kp = keypairFromSeed(seed);
  const payload = {
    format: VAULT_FORMAT_V2,
    createdAt: nowIso(),
    ...(mnemonic ? { mnemonic, derivationPath: SOLANA_BIP44_PATH } : {}),
    accounts: [{
      pubkeyBase58: kp.pubkeyBase58,
      label,
      seedHex: seedToHex(seed),
      ...(mnemonic ? { derivationPath: SOLANA_BIP44_PATH, accountIndex: 0 } : {}),
      createdAt: nowIso(),
    }],
  };
  const envelope = await encryptVault(JSON.stringify(payload), passphrase);
  const meta = {
    accounts: [{ pubkeyBase58: kp.pubkeyBase58, label, createdAt: payload.accounts[0].createdAt }],
    activePubkey: kp.pubkeyBase58,
    createdAt: payload.createdAt,
  };
  return {
    envelope,
    meta,
    unlocked: {
      accounts: [{ ...kp, label }],
      activePubkey: kp.pubkeyBase58,
      hasMnemonic: !!mnemonic,
    },
    importedAs: mnemonic ? 'mnemonic' : 'rawSeed',
    ...(mnemonic ? { mnemonic } : {}),
  };
}

async function parseImportedSecretAsync(secret) {
  // A mnemonic always has whitespace (between words). hex/base58 do
  // not. Detect by whitespace and route accordingly.
  if (typeof secret === 'string' && /\s/.test(secret.trim())) {
    const problem = describeMnemonicProblem(secret);
    if (problem) throw new InvalidAccountError(problem);
    const bip39Seed = await mnemonicToSeed(secret);
    const ed25519Seed = await deriveEd25519SeedFromBip39Seed(bip39Seed, SOLANA_BIP44_PATH);
    return {
      seed: ed25519Seed,
      mnemonic: secret.trim().normalize('NFKD').toLowerCase().replace(/\s+/g, ' '),
    };
  }
  return { seed: parseImportedSecret(secret), mnemonic: null };
}

function parseImportedSecret(secret) {
  if (secret instanceof Uint8Array) {
    if (secret.length === 32) return secret;
    if (secret.length === 64) return keypairFromSecretKey(secret).seed;
    throw new InvalidAccountError('secret bytes must be 32 or 64 long');
  }
  if (typeof secret !== 'string') {
    throw new InvalidAccountError('secret must be Uint8Array or string');
  }
  const trimmed = secret.trim();
  // Try hex first.
  if (/^[0-9a-fA-F]+$/.test(trimmed) && (trimmed.length === 64 || trimmed.length === 128)) {
    if (trimmed.length === 64) return hexToSeed(trimmed);
    // 128 hex chars ⇒ 64-byte secret key
    const sk = new Uint8Array(64);
    for (let i = 0; i < 64; i++) sk[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    return keypairFromSecretKey(sk).seed;
  }
  // Try base58 (64-byte secret key form used by Phantom export).
  try {
    const bytes = decodeBase58(trimmed);
    if (bytes.length === 64) return keypairFromSecretKey(bytes).seed;
    if (bytes.length === 32) return bytes;
  } catch {
    // fall through to throw
  }
  throw new InvalidAccountError('unrecognized secret encoding (expected mnemonic, or 32B/64B hex or base58)');
}

/**
 * Unlock an envelope and return the cleartext accounts. Throws
 * InvalidPassphraseError on bad password. Accepts both v1 and v2
 * vault formats.
 */
export async function unlockVault({ envelope, passphrase }) {
  const json = await decryptVault(envelope, passphrase);
  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    throw new InvalidAccountError('vault payload is not JSON');
  }
  if (payload.format !== VAULT_FORMAT_V1 && payload.format !== VAULT_FORMAT_V2) {
    throw new InvalidAccountError(`unknown vault format: ${payload.format}`);
  }
  const accounts = payload.accounts.map((acc) => {
    const seed = hexToSeed(acc.seedHex);
    const kp = keypairFromSeed(seed);
    if (kp.pubkeyBase58 !== acc.pubkeyBase58) {
      throw new InvalidAccountError(`pubkey mismatch on imported seed for ${acc.label}`);
    }
    return { ...kp, label: acc.label };
  });
  return {
    accounts,
    activePubkey: accounts[0]?.pubkeyBase58 ?? null,
    hasMnemonic: typeof payload.mnemonic === 'string' && payload.mnemonic.length > 0,
  };
}

/**
 * Re-decrypt and return ONLY the mnemonic from a v2 vault. Used by
 * the Security page's "reveal recovery phrase" flow. v1 vaults
 * have no mnemonic and this returns null.
 *
 * The mnemonic is returned, not written anywhere. Caller is
 * responsible for the reveal UI (anti-shoulder-surfing blur, auto
 * re-blur, clipboard auto-clear).
 *
 * @param {object} args
 * @param {object} args.envelope
 * @param {string} args.passphrase
 * @returns {Promise<{ mnemonic: string|null, derivationPath: string|null, format: string }>}
 */
export async function revealVaultMnemonic({ envelope, passphrase }) {
  const json = await decryptVault(envelope, passphrase);
  const payload = JSON.parse(json);
  if (payload.format !== VAULT_FORMAT_V1 && payload.format !== VAULT_FORMAT_V2) {
    throw new InvalidAccountError(`unknown vault format: ${payload.format}`);
  }
  return {
    mnemonic: typeof payload.mnemonic === 'string' ? payload.mnemonic : null,
    derivationPath: typeof payload.derivationPath === 'string' ? payload.derivationPath : null,
    format: payload.format,
  };
}

/**
 * Re-encrypt the unlocked accounts under a (possibly new) passphrase.
 * Preserves mnemonic + derivation metadata if the vault had any.
 */
export async function reencryptVault({ unlocked, passphrase, mnemonic = null, derivationPath = null }) {
  if (!unlocked || !Array.isArray(unlocked.accounts) || unlocked.accounts.length === 0) {
    throw new VaultLockedError();
  }
  const payload = {
    format: VAULT_FORMAT_V2,
    createdAt: nowIso(),
    ...(mnemonic ? { mnemonic, derivationPath: derivationPath || SOLANA_BIP44_PATH } : {}),
    accounts: unlocked.accounts.map((acc, i) => ({
      pubkeyBase58: acc.pubkeyBase58,
      label: acc.label,
      seedHex: seedToHex(acc.seed),
      ...(mnemonic && i === 0 ? { derivationPath: derivationPath || SOLANA_BIP44_PATH, accountIndex: 0 } : {}),
      createdAt: nowIso(),
    })),
  };
  return encryptVault(JSON.stringify(payload), passphrase);
}

/**
 * Add a new randomly-generated account to the unlocked vault. Returns
 * the new in-memory unlocked state. Caller is responsible for calling
 * `reencryptVault` + persisting before the page unloads.
 */
export function addAccount(unlocked, label) {
  if (!unlocked) throw new VaultLockedError();
  const seed = randomSeed();
  const kp = keypairFromSeed(seed);
  const account = { ...kp, label: label || `Account ${unlocked.accounts.length + 1}` };
  const accounts = [...unlocked.accounts, account];
  return { ...unlocked, accounts };
}

/**
 * Export the active account's secret material for backup. Caller MUST
 * show a "you've been warned" confirmation before invoking this.
 */
export function exportActiveSecret(unlocked) {
  if (!unlocked) throw new VaultLockedError();
  const active = unlocked.accounts.find((a) => a.pubkeyBase58 === unlocked.activePubkey) ??
    unlocked.accounts[0];
  if (!active) throw new InvalidAccountError('no active account');
  return {
    pubkeyBase58: active.pubkeyBase58,
    seedHex: seedToHex(active.seed),
    secretKeyBase58: encodeBase58(active.secretKey)
  };
}

export {
  loadVaultEnvelope,
  saveVaultEnvelope,
  loadMeta,
  saveMeta,
  wipeWallet,
  seedToHex,
  hexToSeed,
  ENCRYPTION_INFO,
  VAULT_FORMAT,
  VAULT_FORMAT_V1,
  VAULT_FORMAT_V2,
};
