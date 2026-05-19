// Spaniel Wallet — error classes.
//
// Wallet-core code throws typed errors so the PWA shell can render
// a meaningful message and decide whether to ask for a passphrase
// retry, prompt a wipe, etc. All errors carry a stable `.code` so
// UI strings can be looked up without parsing `.message`.

export class WalletError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'WalletError';
    this.code = code;
    if (details) this.details = details;
  }
}

export class InvalidPassphraseError extends WalletError {
  constructor() {
    super('WALLET_INVALID_PASSPHRASE', 'passphrase did not unlock the vault');
  }
}

export class VaultCorruptError extends WalletError {
  constructor(reason) {
    super('WALLET_VAULT_CORRUPT', `vault payload is corrupt: ${reason}`);
  }
}

export class VaultNotFoundError extends WalletError {
  constructor() {
    super('WALLET_VAULT_NOT_FOUND', 'no vault present in storage');
  }
}

export class VaultLockedError extends WalletError {
  constructor() {
    super('WALLET_VAULT_LOCKED', 'vault is locked — unlock with passphrase first');
  }
}

export class UnsupportedEnvironmentError extends WalletError {
  constructor(missing) {
    super('WALLET_UNSUPPORTED_ENVIRONMENT', `required capability missing: ${missing}`);
  }
}

export class InvalidAccountError extends WalletError {
  constructor(reason) {
    super('WALLET_INVALID_ACCOUNT', `invalid account: ${reason}`);
  }
}
