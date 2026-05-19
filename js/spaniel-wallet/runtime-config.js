// Runtime-config loader — fetches /runtime-config.json with a small
// hold-to-cache window so the PWA bootstrap doesn't refetch it on
// every navigation. The JSON itself is non-sensitive (it carries
// only PUBLIC pubkeys + cluster URL); it just shouldn't be cached
// past a deploy boundary.
//
// Usage:
//   import { loadRuntimeConfig } from '/js/spaniel-wallet/runtime-config.js';
//   const cfg = await loadRuntimeConfig();
//   console.log(cfg.rpcUrl);

import { assertNoSecretInUrlFields } from '../lib/site-config.js';

let _cached = null;
let _inflight = null;

const CACHE_TTL_MS = 60_000;

// Defense-in-depth: refuse to load a runtime-config that carries a
// secret in any URL-shaped field. The published JSON should only ever
// contain PUBLIC values. The public repo's CI lints commits with
// .github/workflows/check-runtime-config.yml; this runtime check
// catches deploy-time mistakes (operator pasting a paid Helius URL
// with `?api-key=…` into wrangler). The screened field list (which
// now also covers walletSiteOrigin / publicSiteOrigin) lives in
// js/lib/site-config.js so the marketing site and the PWA shell
// share one source of truth.

export async function loadRuntimeConfig({ force = false } = {}) {
  if (!force && _cached && Date.now() - _cached.fetchedAt < CACHE_TTL_MS) {
    return _cached.cfg;
  }
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      // Cache-buster on first load + every TTL window.
      const res = await fetch(`/runtime-config.json?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`runtime-config: ${res.status}`);
      }
      const cfg = await res.json();
      assertNoSecretInUrlFields(cfg);
      _cached = { cfg, fetchedAt: Date.now() };
      return cfg;
    } catch (e) {
      // Surface a clear error rather than a partial config.
      throw new Error(`loadRuntimeConfig: ${e.message}`);
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** Reset the cache (for tests). */
export function _resetCache() {
  _cached = null;
  _inflight = null;
}
