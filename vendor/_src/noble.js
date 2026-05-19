// Noble crypto re-exports for the Spaniel Wallet PWA.
//
// Re-exports `ed25519` (curve membership + sign/verify) and `sha256`
// (PDA derivation) so the browser does not need an import map to
// resolve `@noble/curves/ed25519` and `@noble/hashes/sha256`. Bundled
// to `vendor/noble.mjs` via esbuild — see `vendor/README.md`.

export { ed25519 } from '@noble/curves/ed25519';
export { sha256 } from '@noble/hashes/sha256';
