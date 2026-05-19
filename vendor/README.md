# Vendored browser dependencies

Self-contained ESM bundles of the Solana libraries the frontend needs
at runtime. Each is bundled from the official npm package via esbuild
on a trusted local machine and committed here so the deployed site has
zero runtime CDN dependencies. No `esm.sh`, no `jsdelivr`, no other
third party in the supply chain.

## Versions

| Bundle                 | Package                | Version | Notes |
|------------------------|------------------------|---------|---|
| `web3.mjs`             | `@solana/web3.js`      | 1.98.4  | Single-file bundle via esbuild. |
| `spl-token.mjs`        | `@solana/spl-token`    | 0.4.14  | Marks web3 as external; patched at bundle time to import `./web3.mjs`. |
| `wallet-standard.mjs`  | `@wallet-standard/app` | 1.1.0   | Single-file bundle via esbuild. |
| `noble.mjs`            | `@noble/curves` + `@noble/hashes` | 1.9.7 / 1.8.0 | `ed25519` + `sha256` for the Spaniel Wallet PWA (`js/wallet-core/{keygen,signer,pda}.js`). |
| `anchor.mjs`           | `@coral-xyz/anchor`    | 0.30.1  | **Pending — see "Rebuilding" below.** Needed by `js/mint.js` for building program instructions via IDL. |

`spl-token.mjs` is built with `@solana/web3.js` marked as `external`
and its import is patched to `./web3.mjs`, so the two bundles share
one runtime copy of web3 — single `PublicKey` class, no `instanceof`
drift, no duplicate bytes shipped to the browser.

## Why this exists

GitHub Pages serves these from the same origin as the rest of the site,
so:

- Zero new third-party in the network panel.
- Same cache headers as everything else (no surprise CDN max-age).
- One less DNS/TLS connection on cold-load.
- If `esm.sh` or any other transform CDN ever has a bad cache, our
  site is unaffected.
- Supply chain attack surface is reduced to: did we trust the npm
  publisher when we bundled? (Same trust model as any `npm install`.)

The tradeoff is bundle size (~600 KB across four files when anchor is
included). Cached after the first load.

## Rebuilding

Source entry files live in `_src/`. To rebuild after a dependency bump:

```bash
npm install --save-dev \
  @solana/web3.js@<version> \
  @solana/spl-token@<version> \
  @wallet-standard/app@<version> \
  @coral-xyz/anchor@<version>

# web3.js and wallet-standard: simple single-file bundle.
node_modules/.bin/esbuild vendor/_src/web3.js \
  --bundle --format=esm --platform=browser --target=es2020 \
  --minify --legal-comments=none --outfile=vendor/web3.mjs

node_modules/.bin/esbuild vendor/_src/wallet-standard.js \
  --bundle --format=esm --platform=browser --target=es2020 \
  --minify --legal-comments=none --outfile=vendor/wallet-standard.mjs

# noble: ed25519 + sha256 for the Spaniel Wallet PWA. Bundled together
# so wallet-core has one vendor file to import (`../../vendor/noble.mjs`).
node_modules/.bin/esbuild vendor/_src/noble.js \
  --bundle --format=esm --platform=browser --target=es2020 \
  --minify --legal-comments=none --outfile=vendor/noble.mjs

# spl-token: web3.js marked external; the import string is then patched
# to point at the vendored sibling.
node_modules/.bin/esbuild vendor/_src/spl-token.js \
  --bundle --format=esm --platform=browser --target=es2020 \
  --minify --legal-comments=none \
  --external:@solana/web3.js \
  --outfile=vendor/spl-token.mjs
sed -i 's|@solana/web3.js|./web3.mjs|g' vendor/spl-token.mjs

# anchor: web3.js + spl-token marked external; both imports patched
# to point at the vendored siblings. Anchor's `Program` class needs
# both, and we want one copy of each across the page.
node_modules/.bin/esbuild vendor/_src/anchor.js \
  --bundle --format=esm --platform=browser --target=es2020 \
  --minify --legal-comments=none \
  --external:@solana/web3.js --external:@solana/spl-token \
  --outfile=vendor/anchor.mjs
sed -i 's|@solana/web3.js|./web3.mjs|g; s|@solana/spl-token|./spl-token.mjs|g' vendor/anchor.mjs
```

After rebuilding, refresh the SHA-384 table below and bump the cache-
bust `V` in `index.html` + `js/main.js`.

## SHA-384 hashes

Recompute with:

```bash
for f in vendor/web3.mjs vendor/spl-token.mjs vendor/wallet-standard.mjs vendor/anchor.mjs; do
  hash=$(openssl dgst -sha384 -binary "$f" | base64)
  echo "$f → sha384-$hash"
done
```

(Hashes populated after the first deploy.)
