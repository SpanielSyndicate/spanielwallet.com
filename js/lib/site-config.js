// Site-config — resolves the product-split URLs (marketing site vs.
// wallet app) from the public runtime-config.json shape.
//
// The split exists so the wallet product can later be served at its
// own domain (spanielwallet.com) without rebuilding the marketing
// site, while continuing to work under spanielsyndicate.com/app during
// development.
//
// Public-facing fields on runtime-config.json:
//
//   publicSiteOrigin    e.g. "https://spanielsyndicate.com"  (marketing)
//   walletSiteOrigin    e.g. "https://spanielwallet.com"     (PWA host)
//   appBasePath         e.g. "/app"                          (under walletSiteOrigin)
//   apiBaseUrl          e.g. "https://rpc.spanielsyndicate.com"
//
// Backwards compatibility:
//   `siteOrigin` (singular) — older field name; treated as
//   `publicSiteOrigin` if `publicSiteOrigin` is absent. Removing
//   `siteOrigin` from runtime-config is a breaking change for older
//   browser caches; keep it accepted on the read side.
//
// Hard rules (CLAUDE.md §0):
//   * Reject URLs that carry an api-key / secret / token query
//     parameter (defense-in-depth against operator paste mistakes).
//   * Never return a value that pretends a particular origin is the
//     live wallet host when runtime-config hasn't claimed it; callers
//     should respect `walletSiteIsLive(cfg)` before advertising
//     `spanielwallet.com` as the canonical surface.
//
// This module is pure: no fetch, no DOM, no top-level await. It is
// imported by both the public homepage (via js/config.js) and the
// PWA shell (via js/spaniel-wallet/runtime-config.js), and is unit-
// tested in tests/site-config.test.mjs.

const SECRET_URL_PATTERN = /(?:^|[?&])(?:api[_-]?key|apikey|secret|token)=/i;

/** Strip trailing slash, return canonical origin form. */
function normalizeOrigin(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (SECRET_URL_PATTERN.test(trimmed)) {
    throw new Error(
      'site-config: refusing to use an origin that embeds a credential ' +
      '(?api-key/secret/token=). Strip the secret before serving.'
    );
  }
  return trimmed.replace(/\/+$/, '');
}

/** Force a leading slash; allow `''` for root-served wallets. */
function normalizeBasePath(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return '';
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+$/, '');
}

/**
 * Resolve the marketing/showcase origin (spanielsyndicate.com today).
 * Falls back to '' when runtime-config doesn't carry one — callers
 * should treat empty as "use the current document origin".
 */
export function resolvePublicSiteOrigin(cfg) {
  if (!cfg || typeof cfg !== 'object') return '';
  return normalizeOrigin(cfg.publicSiteOrigin ?? cfg.siteOrigin ?? '');
}

/**
 * Resolve the wallet/app product origin. When runtime-config has no
 * `walletSiteOrigin`, the wallet is served from the same origin as the
 * marketing site (e.g. spanielsyndicate.com/app during development).
 */
export function resolveWalletSiteOrigin(cfg) {
  if (!cfg || typeof cfg !== 'object') return '';
  const wallet = normalizeOrigin(cfg.walletSiteOrigin ?? '');
  if (wallet) return wallet;
  return resolvePublicSiteOrigin(cfg);
}

/**
 * Resolve the wallet app's base path under its origin. Defaults to
 * `/app` (current syndicate-hosted layout). For a wallet served at
 * the root of spanielwallet.com, set `appBasePath: ""`.
 */
export function resolveAppBasePath(cfg) {
  if (!cfg || typeof cfg !== 'object') return '/app';
  return normalizeBasePath(cfg.appBasePath, '/app');
}

/** True when runtime-config explicitly claims a distinct wallet host. */
export function walletSiteIsLive(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  const wallet = normalizeOrigin(cfg.walletSiteOrigin ?? '');
  const site = normalizeOrigin(cfg.publicSiteOrigin ?? cfg.siteOrigin ?? '');
  return !!wallet && wallet !== site;
}

/**
 * Compute a launch URL for a PWA route. When the wallet is served at
 * the same origin as the marketing site, returns an origin-relative
 * URL (`/app/wallet/`); when a distinct wallet origin is configured,
 * returns the absolute origin form (`https://spanielwallet.com/wallet/`).
 *
 * `subPath` is appended verbatim and must start with `/`.
 */
export function walletLaunchUrl(cfg, subPath = '/') {
  if (typeof subPath !== 'string') subPath = '/';
  if (!subPath.startsWith('/')) subPath = `/${subPath}`;
  const base = resolveAppBasePath(cfg);
  const path = `${base}${subPath}`.replace(/\/+/g, '/');
  if (walletSiteIsLive(cfg)) {
    return `${resolveWalletSiteOrigin(cfg)}${path}`;
  }
  return path;
}

/** Resolve the API base URL (Cloudflare Worker), if configured. */
export function resolveApiBaseUrl(cfg) {
  if (!cfg || typeof cfg !== 'object') return '';
  return normalizeOrigin(cfg.apiBaseUrl ?? '');
}

/** All URL-shaped fields that should be screened for secrets. */
export const URLISH_FIELDS = Object.freeze([
  'rpcUrl',
  'wsUrl',
  'workerOrigin',
  'apiBase',
  'apiBaseUrl',
  'apiOrigin',
  'siteOrigin',
  'publicSiteOrigin',
  'walletSiteOrigin',
]);

/**
 * Throw if any URL-shaped field in `cfg` carries a credential. The
 * regex is shared with `normalizeOrigin` so the two surfaces stay
 * consistent.
 */
export function assertNoSecretInUrlFields(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  for (const key of URLISH_FIELDS) {
    const v = cfg[key];
    if (typeof v === 'string' && SECRET_URL_PATTERN.test(v)) {
      throw new Error(
        `runtime-config rejected: field "${key}" appears to carry a credential ` +
        `(?api-key/secret/token=). Strip the secret before serving.`
      );
    }
  }
}
