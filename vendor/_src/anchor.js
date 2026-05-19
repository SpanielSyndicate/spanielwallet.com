// Entry point for the `vendor/anchor.mjs` esbuild bundle.
//
// Re-exports the surface area js/mint.js actually uses. Keeping the
// re-export explicit (vs `export * from "..."`) limits the bundled
// surface to what we need, which shrinks the output and makes it
// trivial to spot when we accidentally pull in something new.

export {
    AnchorProvider,
    Program,
    BN,
    EventParser,
    setProvider,
    workspace,
} from "@coral-xyz/anchor";

// Reuse the vendored web3 + spl-token bundles. esbuild marks these
// as external; the resulting import path is rewritten by the build
// script to `./web3.mjs` and `./spl-token.mjs`.
export {
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
    SYSVAR_SLOT_HASHES_PUBKEY,
} from "@solana/web3.js";

export {
    TOKEN_2022_PROGRAM_ID,
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
