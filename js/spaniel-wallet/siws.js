// Spaniel Wallet PWA — Sign-In-With-Solana helper.
//
// Drives the Worker SIWS dance using the unlocked Spaniel Wallet
// seed. Mirrors the ops-side rehearsal helper byte-for-byte so the
// PWA + the rehearsal exercise the same auth path.
//
// Flow:
//   1. ensureSiwsSession({ wallet, seed, fetchImpl? })
//      - GET /api/auth/me → 200 with matching wallet → reuse session.
//      - else: POST /api/auth/nonce, ed25519-sign the message with
//        `seed`, POST /api/auth/verify; the Worker sets an HttpOnly
//        spaniel_session cookie which the browser carries on
//        subsequent fetches (credentials: 'include' is required).
//
// Notes:
//   - The seed never leaves the wallet-core boundary; this helper
//     uses signer.signMessage which does ed25519 in-memory.
//   - The cookie-based path is preferred for browsers; the
//     sessionToken in the verify response is captured for callers
//     that need a Bearer header.
//   - No retry / exponential backoff; the caller decides.
//
// This module is pure JS — no DOM access. Easy to unit-test.

import { signMessage } from '../wallet-core/signer.js';
import { encodeBase58 } from '../wallet-core/base58.js';
import { apiUrl } from './api-url.js';

const enc = new TextEncoder();

const EXPECTED_STATEMENT =
  'Sign in to Spaniel Syndicate to manage your Barklink and dashboard.';

/**
 * Parse a SIWS message text into its structured fields. The Worker
 * produces a known shape (see worker/src/handlers/auth.js::buildMessage):
 *
 *   <host> wants you to sign in with your Solana account:
 *   <wallet>
 *   <blank>
 *   <statement>
 *   <blank>
 *   URI: <uri>
 *   Version: 1
 *   Chain ID: solana
 *   Nonce: <nonce>
 *   Issued At: <iso>
 *   Expiration Time: <iso>
 *   Resources:
 *   - <resource>
 */
export function parseSiwsMessage(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const lines = text.split('\n');
  if (lines.length < 8) return null;
  const headerMatch = /^([^\s]+) wants you to sign in with your Solana account:$/.exec(lines[0]);
  if (!headerMatch) return null;
  const host = headerMatch[1];
  const wallet = lines[1];
  const statement = lines[3];
  const getLine = (prefix) => {
    const line = lines.find((l) => l.startsWith(prefix));
    return line ? line.slice(prefix.length) : null;
  };
  const uri = getLine('URI: ');
  const nonce = getLine('Nonce: ');
  const issuedAt = getLine('Issued At: ');
  const expirationTime = getLine('Expiration Time: ');
  return { host, wallet, statement, uri, nonce, issuedAt, expirationTime };
}

/**
 * Compare the SIWS message against the binding the wallet expects to
 * see (host + uri origin + statement). Throws a WALLET_SIWS_BINDING
 * error if any field is missing or mismatched.
 *
 * `allowedHosts` and `allowedUriOrigins` are arrays of strings; the
 * empty array means "accept whatever the message claims". Pass
 * `location.host` as the only entry to lock to the current document
 * host.
 */
export function assertSiwsBinding(parsed, { allowedHosts, allowedUriOrigins, expectedStatement }) {
  if (!parsed) {
    throw siwsError('SIWS message could not be parsed');
  }
  if (Array.isArray(allowedHosts) && allowedHosts.length > 0) {
    if (!allowedHosts.includes(parsed.host)) {
      throw siwsError(
        `SIWS message host "${parsed.host}" is not in the allowed-host list ` +
        `(${allowedHosts.join(', ')})`
      );
    }
  }
  if (Array.isArray(allowedUriOrigins) && allowedUriOrigins.length > 0) {
    let origin = null;
    try {
      origin = parsed.uri ? new URL(parsed.uri).origin : null;
    } catch {
      origin = null;
    }
    if (!origin || !allowedUriOrigins.includes(origin)) {
      throw siwsError(
        `SIWS message URI "${parsed.uri || '<missing>'}" is not in the allowed-origin list ` +
        `(${allowedUriOrigins.join(', ')})`
      );
    }
  }
  if (typeof expectedStatement === 'string' && expectedStatement.length > 0) {
    if (parsed.statement !== expectedStatement) {
      throw siwsError(
        `SIWS message statement does not match the expected literal. ` +
        `Got: "${parsed.statement || '<missing>'}"`
      );
    }
  }
  return true;
}

function siwsError(message) {
  const err = new Error(message);
  err.code = 'WALLET_SIWS_BINDING';
  return err;
}

function defaultAllowedHosts() {
  if (typeof location === 'undefined' || !location.host) return [];
  return [location.host];
}

function defaultAllowedUriOrigins() {
  if (typeof location === 'undefined' || !location.origin) return [];
  return [location.origin];
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

/**
 * Probe /api/auth/me. Returns the wallet on the session or null.
 *
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{wallet: string, sessionExpiresAt: string}|null>}
 */
export async function currentSiwsWallet({ fetchImpl } = {}) {
  const f = fetchImpl || globalThis.fetch;
  try {
    const res = await f(apiUrl('/api/auth/me'), { credentials: 'include' });
    if (!res.ok) return null;
    const body = await safeJson(res);
    if (!body || typeof body.wallet !== 'string') return null;
    return body;
  } catch {
    return null;
  }
}

/**
 * Make sure the browser has an authenticated SIWS session for the
 * given wallet. If a matching session is already present this is a
 * single GET; otherwise it runs the full nonce → sign → verify dance.
 *
 * Returns a small descriptor describing what happened — useful for
 * UI status copy ("signing in to record purchase…").
 *
 * @param {object} params
 * @param {string} params.wallet     active Spaniel Wallet pubkey (base58)
 * @param {Uint8Array} params.seed   active account seed (32 bytes)
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<{ wallet: string, reused: boolean, sessionExpiresAt: string, sessionToken?: string }>}
 */
export async function ensureSiwsSession({
  wallet,
  seed,
  fetchImpl,
  allowedHosts,
  allowedUriOrigins,
  expectedStatement = EXPECTED_STATEMENT,
}) {
  if (typeof wallet !== 'string' || wallet.length === 0) {
    throw new Error('ensureSiwsSession: wallet required');
  }
  if (!(seed instanceof Uint8Array) || seed.length !== 32) {
    throw new Error('ensureSiwsSession: seed must be a 32-byte Uint8Array');
  }
  const f = fetchImpl || globalThis.fetch;
  const hostList = Array.isArray(allowedHosts) ? allowedHosts : defaultAllowedHosts();
  const uriOriginList = Array.isArray(allowedUriOrigins)
    ? allowedUriOrigins
    : defaultAllowedUriOrigins();

  // Reuse an existing session if it matches the requested wallet.
  const existing = await currentSiwsWallet({ fetchImpl: f });
  if (existing && existing.wallet === wallet) {
    return {
      wallet,
      reused: true,
      sessionExpiresAt: existing.sessionExpiresAt,
    };
  }

  // Fresh login.
  const nonceRes = await f(apiUrl('/api/auth/nonce'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet }),
  });
  if (!nonceRes.ok) {
    const b = await safeJson(nonceRes);
    const detail = (b && (b.error || b.code)) || `HTTP ${nonceRes.status}`;
    throw new Error(`SIWS nonce failed: ${detail}`);
  }
  const noncePayload = await nonceRes.json();
  if (!noncePayload || typeof noncePayload.message !== 'string') {
    throw new Error('SIWS nonce response missing message');
  }

  // Defense-in-depth: parse the Worker-supplied SIWS message and
  // assert it binds the host/URI we expect BEFORE asking the wallet
  // to sign it. A compromised Worker (or a phisher with a real cert)
  // would otherwise hand us a SIWS message bound to an attacker
  // origin; the signature could then be replayed against another
  // SIWS site that doesn't double-check the domain.
  const parsed = parseSiwsMessage(noncePayload.message);
  assertSiwsBinding(parsed, {
    allowedHosts: hostList,
    allowedUriOrigins: uriOriginList,
    expectedStatement,
  });
  if (parsed.wallet !== wallet) {
    throw siwsError(
      `SIWS message wallet "${parsed.wallet}" does not match active wallet "${wallet}"`
    );
  }

  const messageBytes = enc.encode(noncePayload.message);
  const sigBytes = signMessage(seed, messageBytes);
  const signatureBase58 = encodeBase58(sigBytes);

  const verifyRes = await f(apiUrl('/api/auth/verify'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wallet,
      nonce: noncePayload.nonce,
      signatureBase58,
    }),
  });
  if (!verifyRes.ok) {
    const b = await safeJson(verifyRes);
    const detail = (b && (b.error || b.code)) || `HTTP ${verifyRes.status}`;
    throw new Error(`SIWS verify failed: ${detail}`);
  }
  const verifyPayload = await verifyRes.json();
  return {
    wallet,
    reused: false,
    sessionExpiresAt: verifyPayload.sessionExpiresAt,
    sessionToken: verifyPayload.sessionToken,
  };
}
