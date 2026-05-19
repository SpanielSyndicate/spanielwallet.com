// Solana network configuration — clusters, default RPC endpoints,
// explorer links, faucet URLs, refusal patterns.
//
// Per CLAUDE.md §0: SpanielSyndicate is devnet-only until the
// operator explicitly enables mainnet. All scripts and the PWA wallet
// MUST refuse to operate against a mainnet RPC unless the caller
// passes an explicit allow flag. Mainnet host patterns are listed
// once here so that drift in detection logic is impossible.
//
// Helper API:
//   - assertNotMainnetRpc(rpcUrl, { allowMainnet?: false })
//   - clusterFromRpcUrl(rpcUrl) → 'devnet' | 'testnet' | 'mainnet-beta' | 'localnet' | 'custom'
//   - defaultRpcForCluster(cluster) → string URL
//   - getExplorerTxLink(signature, cluster)
//   - getExplorerAccountLink(address, cluster)
//
// Every RPC URL we ship as a default is the canonical Solana
// Foundation endpoint. The operator may override with a faster /
// rate-limit-friendly RPC via runtime-config.json or env vars.

/**
 * Canonical Solana cluster names. Match the values the explorer
 * accepts in its `cluster` query parameter.
 */
export const CLUSTERS = Object.freeze({
  MAINNET_BETA: 'mainnet-beta',
  DEVNET: 'devnet',
  TESTNET: 'testnet',
  LOCALNET: 'localnet',
  CUSTOM: 'custom',
});

/**
 * Foundation-default RPC endpoint per cluster. Operators routinely
 * override these with Helius / Triton / Alchemy URLs via env vars.
 */
export const FOUNDATION_RPC_URLS = Object.freeze({
  [CLUSTERS.MAINNET_BETA]: 'https://api.mainnet-beta.solana.com',
  [CLUSTERS.DEVNET]:       'https://api.devnet.solana.com',
  [CLUSTERS.TESTNET]:      'https://api.testnet.solana.com',
  [CLUSTERS.LOCALNET]:     'http://localhost:8899',
});

/** Public faucet (devnet only). */
export const SOLANA_FAUCET_URL = 'https://faucet.solana.com';

/** Solana Explorer base URL — appended with /tx/<sig> or /address/<addr>. */
export const SOLANA_EXPLORER_BASE = 'https://explorer.solana.com';

/**
 * Host substrings that mean "mainnet" for refusal logic. Match by
 * `host.includes(substring)`. Add to this list — never short-circuit
 * around it.
 */
export const MAINNET_HOST_PATTERNS = Object.freeze([
  'api.mainnet-beta.solana.com',
  'mainnet.helius-rpc.com',
  'rpc.ankr.com/solana',
  'solana-mainnet.g.alchemy.com',
  'solana-mainnet.rpc.extrnode.com',
  'mainnet.solana.rpcpool.com',
  // Triton / Quicknode etc. typically expose mainnet under a
  // custom domain — the operator must explicitly opt in via
  // runtime-config.allowMainnetCustomRpc when using one.
]);

/**
 * Patterns that signal an RPC URL is bundled with a credential we
 * should refuse to ship to the public repo. Used by
 * `write-runtime-config-devnet.mjs` to fail-loud if the operator
 * tries to embed a secret-bearing endpoint in the public file.
 */
export const RPC_URL_FORBIDDEN_SUBSTRINGS = Object.freeze([
  'api-key=',
  'apikey=',
  'token=',
  'secret',
  'auth=',
  'access-token',
]);

/** Refuse mainnet unless `{ allowMainnet: true }` is set explicitly. */
export function assertNotMainnetRpc(rpcUrl, { allowMainnet = false } = {}) {
  if (typeof rpcUrl !== 'string' || rpcUrl.length === 0) {
    throw new Error('assertNotMainnetRpc: rpcUrl is required');
  }
  let parsed;
  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error(`assertNotMainnetRpc: invalid rpcUrl ${rpcUrl}`);
  }
  // Some patterns (e.g. `rpc.ankr.com/solana`) carry a path segment
  // — match against host+pathname so they hit correctly. `parsed.host`
  // alone would miss path-qualified patterns.
  const hostPath = parsed.host + parsed.pathname;
  for (const pat of MAINNET_HOST_PATTERNS) {
    if (hostPath.includes(pat) && !allowMainnet) {
      throw new Error(
        `refusing mainnet RPC ${parsed.host} — devnet-only until explicit opt-in`
      );
    }
  }
}

/** Pure-host detector — does NOT throw. */
export function clusterFromRpcUrl(rpcUrl) {
  if (typeof rpcUrl !== 'string') return CLUSTERS.CUSTOM;
  let host = '';
  try { host = new URL(rpcUrl).host; } catch { return CLUSTERS.CUSTOM; }
  for (const pat of MAINNET_HOST_PATTERNS) {
    if (host.includes(pat)) return CLUSTERS.MAINNET_BETA;
  }
  if (host.includes('devnet')) return CLUSTERS.DEVNET;
  if (host.includes('testnet')) return CLUSTERS.TESTNET;
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
    return CLUSTERS.LOCALNET;
  }
  return CLUSTERS.CUSTOM;
}

export function defaultRpcForCluster(cluster) {
  return FOUNDATION_RPC_URLS[cluster] || null;
}

export function getExplorerTxLink(signature, cluster = CLUSTERS.DEVNET) {
  if (typeof signature !== 'string' || !signature.length) {
    throw new Error('getExplorerTxLink: signature required');
  }
  if (cluster === CLUSTERS.MAINNET_BETA) {
    return `${SOLANA_EXPLORER_BASE}/tx/${encodeURIComponent(signature)}`;
  }
  return `${SOLANA_EXPLORER_BASE}/tx/${encodeURIComponent(signature)}?cluster=${encodeURIComponent(cluster)}`;
}

export function getExplorerAccountLink(address, cluster = CLUSTERS.DEVNET) {
  if (typeof address !== 'string' || !address.length) {
    throw new Error('getExplorerAccountLink: address required');
  }
  if (cluster === CLUSTERS.MAINNET_BETA) {
    return `${SOLANA_EXPLORER_BASE}/address/${encodeURIComponent(address)}`;
  }
  return `${SOLANA_EXPLORER_BASE}/address/${encodeURIComponent(address)}?cluster=${encodeURIComponent(cluster)}`;
}

/**
 * True if the rpc URL contains any of `RPC_URL_FORBIDDEN_SUBSTRINGS`.
 * Used by config-sync to refuse to publish a secret-bearing URL.
 */
export function rpcUrlHasForbiddenSubstring(rpcUrl) {
  if (typeof rpcUrl !== 'string') return false;
  const lower = rpcUrl.toLowerCase();
  for (const s of RPC_URL_FORBIDDEN_SUBSTRINGS) {
    if (lower.includes(s)) return s;
  }
  return null;
}
