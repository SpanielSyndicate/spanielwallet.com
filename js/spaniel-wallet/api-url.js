// Wallet-side helper for resolving a path against the Worker's
// apiBaseUrl.
//
// The PWA pages historically used relative `/api/...` URLs, which
// work fine when the wallet is served from the same origin as the
// Worker but break in:
//
//   * the production GitHub Pages + Cloudflare Worker split (wallet
//     on `spanielsyndicate.com/`, Worker on
//     `rpc.spanielsyndicate.com`).
//   * the planned `spanielwallet.com` cross-origin host.
//   * any devnet/staging Worker deployed under a separate
//     subdomain.
//
// `apiUrl(path)` resolves the right absolute Worker URL using the
// `apiBaseUrl` from `runtime-config.json`. When `apiBaseUrl` is
// empty (truly same-origin dev) it returns the path unchanged. The
// helper accepts already-absolute URLs and passes them through.
//
// All wallet pages SHOULD call this for `/api/...` fetches — the
// helper is forgiving so an incremental migration is safe (mixed
// callers don't break each other).

import { resolveApiBaseUrl } from '../lib/site-config.js';

let _cachedBase = null;

/**
 * Set the runtime config so the helper can resolve api URLs without
 * fetching. Call after `loadRuntimeConfig()`. Optional — the helper
 * falls back to same-origin paths if no config is registered.
 */
export function registerRuntimeConfig(cfg) {
  _cachedBase = resolveApiBaseUrl(cfg || {});
}

/** Reset the cache (tests). */
export function _resetApiUrlCache() {
  _cachedBase = null;
}

/**
 * Build a fetch-ready URL for the Worker.
 *
 *   apiUrl('/api/products/quote')
 *
 * Behaviour:
 *   * `path` is already absolute (`http://` / `https://`) → returned
 *     verbatim.
 *   * `apiBaseUrl` is configured (via `registerRuntimeConfig`) →
 *     `${apiBaseUrl}${path}`.
 *   * otherwise → `path` (same-origin fallback).
 *
 * The registration is intentionally permanent for the page session.
 * apiBaseUrl is baked into the deploy and never changes mid-session
 * without a redeploy + reload — a TTL-based expiry would silently
 * make `apiUrl()` return the wrong (same-origin) value once the
 * window closed, breaking every PWA API call from then on.
 */
export function apiUrl(path) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new TypeError('apiUrl: path must be a non-empty string');
  }
  if (/^https?:\/\//i.test(path)) return path;
  if (!_cachedBase) {
    // No registration → same-origin behaviour. Lets the helper drop
    // into modules that boot before the wallet shell wires up
    // ensureRuntimeConfig (e.g. a test harness without a runtime-config).
    return path;
  }
  // Tolerate either form: path starts with `/` or doesn't.
  const sep = path.startsWith('/') ? '' : '/';
  return `${_cachedBase}${sep}${path}`;
}

/**
 * One-call convenience: load runtime-config and register it. Wallet
 * pages can call this at boot to avoid threading the cfg through
 * every fetch.
 *
 * Pass the loader function (typically `loadRuntimeConfig` from
 * `./runtime-config.js`) so this helper stays free of circular
 * imports.
 */
export async function ensureRuntimeConfig(loader) {
  if (typeof loader !== 'function') {
    throw new TypeError('ensureRuntimeConfig: loader must be a function');
  }
  const cfg = await loader();
  registerRuntimeConfig(cfg || {});
  return cfg;
}
