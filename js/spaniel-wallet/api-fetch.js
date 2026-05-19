// Spaniel Wallet PWA — Worker JSON fetch helpers.
//
// Every PWA page that talks to the Worker was hand-rolling the same
// fetch(apiUrl(...), { credentials, headers, ... }) + if(!res.ok)
// throw + res.json() pattern. Consolidate into two helpers so a
// future change (e.g. wiring SIWS auth headers, retry on 5xx,
// per-request abort signal plumbing, error telemetry) lives in one
// place.
//
// Helpers:
//   apiGetJson(path, opts?)        → parsed JSON
//   apiPostJson(path, body, opts?) → parsed JSON (or null on 204)
//
// Errors throw `ApiHttpError` (carries path, status, parsed body)
// so callers can branch on `err.status === 404` / err.body.code etc.
//
// Routes still using raw `fetch(apiUrl(...))` are not wrong — this
// helper is opt-in. Page modules with bespoke status handling
// (e.g. affiliate-page's "try /me, if 404 then create") may stay
// raw; everyone else can collapse to one line.

import { apiUrl } from './api-url.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export class ApiHttpError extends Error {
  /**
   * @param {string} path           the requested path (NOT the full URL — keeps logs clean)
   * @param {number} status         HTTP status code
   * @param {object|null} body      parsed JSON body, if available
   */
  constructor(path, status, body) {
    const code = body?.code || `HTTP_${status}`;
    const msg = body?.error || body?.message || `${path} returned ${status}`;
    super(`${code}: ${msg}`);
    this.name = 'ApiHttpError';
    this.path = path;
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

/**
 * @typedef {object} FetchOpts
 * @property {AbortSignal} [signal]
 * @property {Record<string, string>} [headers]
 * @property {number} [timeoutMs]                default 30_000
 * @property {RequestCredentials} [credentials]  default 'include'
 */

/**
 * GET an /api/... endpoint and return the parsed JSON body.
 *
 * @param {string} path
 * @param {FetchOpts} [opts]
 * @returns {Promise<any>}
 */
export async function apiGetJson(path, opts = {}) {
  return jsonFetch(path, { method: 'GET' }, opts);
}

/**
 * POST a JSON body to an /api/... endpoint. `body` is stringified
 * automatically unless it's already a string.
 *
 * @param {string} path
 * @param {object|string|null} body
 * @param {FetchOpts} [opts]
 * @returns {Promise<any|null>}  null when the server returned 204
 */
export async function apiPostJson(path, body, opts = {}) {
  const init = { method: 'POST' };
  if (body != null) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return jsonFetch(path, init, opts, /* json= */ true);
}

async function jsonFetch(path, init, opts, withJsonContentType = false) {
  const headers = {
    Accept: 'application/json',
    ...(withJsonContentType ? { 'Content-Type': 'application/json' } : {}),
    ...(opts.headers || {}),
  };
  const credentials = opts.credentials || 'include';
  // Per-request timeout: chain any caller-provided signal with our
  // own AbortController so callers can still cancel early.
  let abortCtrl = null;
  let timeoutId = null;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signals = [];
  if (opts.signal) signals.push(opts.signal);
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    abortCtrl = new AbortController();
    timeoutId = setTimeout(() => abortCtrl.abort(new DOMException('timeout', 'AbortError')), timeoutMs);
    signals.push(abortCtrl.signal);
  }
  const finalSignal = signals.length === 1 ? signals[0] : anySignal(signals);

  let res;
  try {
    res = await fetch(apiUrl(path), { ...init, headers, credentials, signal: finalSignal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // Network / CORS / DNS — re-throw with a path hint so the catch
    // path in callers can render "Worker unreachable" copy.
    throw new ApiHttpError(path, 0, { code: 'NETWORK_ERROR', error: err?.message || 'fetch failed' });
  } finally {
    if (timeoutId != null) clearTimeout(timeoutId);
  }

  if (res.status === 204) return null;

  let body = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try { body = await res.json(); } catch { body = null; }
  }
  if (!res.ok) throw new ApiHttpError(path, res.status, body);
  return body;
}

/**
 * Tiny polyfill for AbortSignal.any() (Safari 17+ has it; older
 * browsers don't). Aborts the returned signal when ANY input
 * signal aborts.
 */
function anySignal(signals) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    return AbortSignal.any(signals);
  }
  const ctrl = new AbortController();
  const onAbort = (ev) => ctrl.abort(ev?.target?.reason);
  for (const s of signals) {
    if (s.aborted) { ctrl.abort(s.reason); return ctrl.signal; }
    s.addEventListener('abort', onAbort, { once: true });
  }
  return ctrl.signal;
}
