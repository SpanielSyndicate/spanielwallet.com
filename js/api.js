// Worker REST client.
//
// Wraps every endpoint in docs/WORKER_API_CONTRACT.md. The frontend
// imports `api` from here for every backend call; no other module
// should fetch the Worker directly.
//
// All monetary fields come back as decimal strings (lamports) and
// must be parsed to BigInt at the call site. The wrapper does NOT
// auto-parse — it returns the server response as-is so consumers
// can decide.

import { API_BASE_URL } from './config.js';

// ────────────────────────────────────────────────────────────────────
// Error normalisation
// ────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor({ code, message, details, status, endpoint }) {
    super(message || code);
    this.name = 'ApiError';
    this.code = code || 'UNKNOWN';
    this.details = details || null;
    this.status = status;
    this.endpoint = endpoint;
  }
}

export class ApiNetworkError extends Error {
  constructor(endpoint, cause) {
    super(`network error calling ${endpoint}: ${cause?.message || cause}`);
    this.name = 'ApiNetworkError';
    this.endpoint = endpoint;
    this.cause = cause;
  }
}

// ────────────────────────────────────────────────────────────────────
// Core request helper
// ────────────────────────────────────────────────────────────────────

async function request(endpoint, { method = 'GET', body, headers, signal, credentials = 'include' } = {}) {
  if (!API_BASE_URL) {
    // No API base configured (likely placeholder runtime-config). Throw
    // a structured network error so callers can render an offline state.
    throw new ApiNetworkError(endpoint, new Error('API_BASE_URL not configured'));
  }
  const url = `${API_BASE_URL}${endpoint}`;
  const init = {
    method,
    credentials,
    signal,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(headers || {})
    }
  };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiNetworkError(endpoint, err);
  }

  // No content (DELETE, 204, etc.)
  if (res.status === 204) return null;

  let payload = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
  } else {
    payload = await res.text();
  }

  if (!res.ok) {
    const errEnv = payload?.error || {};
    throw new ApiError({
      code: errEnv.code || `HTTP_${res.status}`,
      message: errEnv.message || res.statusText,
      details: errEnv.details || null,
      status: res.status,
      endpoint
    });
  }

  return payload;
}

// ────────────────────────────────────────────────────────────────────
// Health + config
// ────────────────────────────────────────────────────────────────────

export function health() {
  return request('/api/health');
}

export function getPublicConfig() {
  return request('/api/config/public');
}

// ────────────────────────────────────────────────────────────────────
// Auth (sign-in-with-Solana)
// ────────────────────────────────────────────────────────────────────

export function authNonce(wallet) {
  return request('/api/auth/nonce', { method: 'POST', body: { wallet } });
}

export function authVerify({ wallet, nonce, signatureBase58 }) {
  return request('/api/auth/verify', {
    method: 'POST',
    body: { wallet, nonce, signatureBase58 }
  });
}

export function authMe() {
  return request('/api/auth/me');
}

export function authLogout() {
  return request('/api/auth/logout', { method: 'POST' });
}

// ────────────────────────────────────────────────────────────────────
// Affiliate
// ────────────────────────────────────────────────────────────────────

export function affiliateCreate() {
  return request('/api/affiliate/create', { method: 'POST' });
}

export function affiliateMe() {
  return request('/api/affiliate/me');
}

export function affiliateLookup(referralId) {
  return request(`/api/affiliate/${encodeURIComponent(referralId)}`);
}

export function affiliateRefreshHolderCount() {
  return request('/api/affiliate/refresh-holder-count', { method: 'POST' });
}

// ────────────────────────────────────────────────────────────────────
// Referral attribution
// ────────────────────────────────────────────────────────────────────

export function referralClick({ referralId, route, sessionId, campaign, referrerHeader }) {
  return request('/api/referral/click', {
    method: 'POST',
    body: { referralId, route, sessionId, campaign, referrerHeader }
  });
}

export function referralSessionUpdate({ sessionId, walletConnected }) {
  return request('/api/referral/session', {
    method: 'POST',
    body: { sessionId, walletConnected }
  });
}

export function referralSessionGet(sessionId) {
  const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  return request(`/api/referral/session${qs}`);
}

// ────────────────────────────────────────────────────────────────────
// Traffic + stats
// ────────────────────────────────────────────────────────────────────

export function trafficEvent({ eventType, route, sessionId, walletConnected, referralId, metadata }) {
  return request('/api/traffic/event', {
    method: 'POST',
    body: { eventType, route, sessionId, walletConnected, referralId, metadata }
  });
}

export function trafficHeartbeat({ sessionId, route, referralId }) {
  return request('/api/traffic/heartbeat', {
    method: 'POST',
    body: { sessionId, route, referralId }
  });
}

export function statsLive() {
  return request('/api/stats/live');
}

export function statsHomepage() {
  return request('/api/stats/homepage');
}

export function statsActivity({ limit } = {}) {
  const qs = limit ? `?limit=${encodeURIComponent(limit)}` : '';
  return request(`/api/stats/activity${qs}`);
}

// ────────────────────────────────────────────────────────────────────
// Mint
// ────────────────────────────────────────────────────────────────────

export function mintQuote({ buyerWallet, quantity, referralId, clientNonce }) {
  return request('/api/mint/quote', {
    method: 'POST',
    body: { buyerWallet, quantity, referralId, clientNonce }
  });
}

export function mintRecord({ txSignature }) {
  return request('/api/mint/record', { method: 'POST', body: { txSignature } });
}

export function mintProgress() {
  return request('/api/mint/progress');
}

export function mintCurve() {
  return request('/api/mint/curve');
}

// ────────────────────────────────────────────────────────────────────
// Leaderboards
// ────────────────────────────────────────────────────────────────────

export function leaderboardReferrers({ metric = 'mints', limit = 50 } = {}) {
  return request(`/api/leaderboards/referrers?metric=${encodeURIComponent(metric)}&limit=${limit}`);
}

export function leaderboardHolders({ limit = 50 } = {}) {
  return request(`/api/leaderboards/holders?limit=${limit}`);
}

export function leaderboardMints({ metric = 'recent', limit = 50 } = {}) {
  return request(`/api/leaderboards/mints?metric=${encodeURIComponent(metric)}&limit=${limit}`);
}

export function leaderboardMarket({ metric = 'top_referrers', limit = 50 } = {}) {
  return request(`/api/leaderboards/market?metric=${encodeURIComponent(metric)}&limit=${limit}`);
}

// ────────────────────────────────────────────────────────────────────
// Marketplace
// ────────────────────────────────────────────────────────────────────

export function marketConfig() {
  return request('/api/market/config');
}

export function marketListings({ sort, min, max, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (sort) params.set('sort', sort);
  if (min !== undefined) params.set('min', String(min));
  if (max !== undefined) params.set('max', String(max));
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/market/listings${qs}`);
}

export function marketListing(listingId) {
  return request(`/api/market/listings/${encodeURIComponent(listingId)}`);
}

export function marketMyAssets(wallet) {
  return request(`/api/market/my-assets?wallet=${encodeURIComponent(wallet)}`);
}

export function marketListQuote({ assetId, priceLamports }) {
  return request('/api/market/list/quote', {
    method: 'POST',
    body: { assetId, priceLamports: String(priceLamports) }
  });
}

export function marketList({ quoteNonce, orderSignatureBase58, priceLamports }) {
  return request('/api/market/list', {
    method: 'POST',
    body: { quoteNonce, orderSignatureBase58, priceLamports: String(priceLamports) }
  });
}

export function marketDelistQuote({ listingId }) {
  return request('/api/market/delist/quote', { method: 'POST', body: { listingId } });
}

export function marketDelist({ listingId, signatureBase58 }) {
  return request('/api/market/delist', {
    method: 'POST',
    body: { listingId, signatureBase58 }
  });
}

export function marketChangePriceQuote({ listingId, priceLamports }) {
  return request('/api/market/change-price/quote', {
    method: 'POST',
    body: { listingId, priceLamports: String(priceLamports) }
  });
}

export function marketChangePrice({ quoteNonce, orderSignatureBase58, priceLamports }) {
  return request('/api/market/change-price', {
    method: 'POST',
    body: { quoteNonce, orderSignatureBase58, priceLamports: String(priceLamports) }
  });
}

export function marketBuyQuote({ listingId, buyerWallet, referralId }) {
  return request('/api/market/buy/quote', {
    method: 'POST',
    body: { listingId, buyerWallet, referralId }
  });
}

export function marketBuyRecord({ txSignature }) {
  return request('/api/market/buy/record', { method: 'POST', body: { txSignature } });
}

export function marketActivity({ limit } = {}) {
  const qs = limit ? `?limit=${encodeURIComponent(limit)}` : '';
  return request(`/api/market/activity${qs}`);
}

export function marketStats() {
  return request('/api/market/stats');
}

// ────────────────────────────────────────────────────────────────────
// Helpers for callers
// ────────────────────────────────────────────────────────────────────

/**
 * Wrap an async API call so errors are returned as a result tuple
 * instead of thrown. Useful for UI code that prefers to handle errors
 * declaratively.
 *
 * @example
 *   const { data, error } = await tryApi(() => api.statsLive());
 */
export async function tryApi(fn) {
  try {
    const data = await fn();
    return { data, error: null };
  } catch (err) {
    return { data: null, error: err };
  }
}

/**
 * Parse a lamport string from the API into a BigInt safely.
 * @param {unknown} val
 * @returns {bigint}
 */
export function lamports(val) {
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number') return BigInt(Math.trunc(val));
  if (typeof val === 'string') return BigInt(val);
  throw new Error(`cannot parse lamports from ${typeof val}: ${val}`);
}

// ────────────────────────────────────────────────────────────────────
// Series 1 — series / products / cards / dogs / binder / offers
// ────────────────────────────────────────────────────────────────────

export function seriesCurrent() {
  return request('/api/series/current');
}
export function seriesManifest(id = 's1') {
  return request(`/api/series/${encodeURIComponent(id)}/manifest`);
}
export function seriesOdds(id = 's1') {
  return request(`/api/series/${encodeURIComponent(id)}/odds`);
}
export function seriesCurve(id = 's1') {
  return request(`/api/series/${encodeURIComponent(id)}/curve`);
}
export function seriesStats(id = 's1') {
  return request(`/api/series/${encodeURIComponent(id)}/stats`);
}

export function productsCatalog() {
  return request('/api/products/catalog');
}
export function productsQuote({ buyerWallet, productType, quantity = 1, referralId }) {
  return request('/api/products/quote', {
    method: 'POST',
    body: { buyerWallet, productType, quantity, referralId }
  });
}
export function productsRecord({ quoteNonce, txSignature, mode }) {
  return request('/api/products/record', {
    method: 'POST',
    body: { quoteNonce, txSignature, mode }
  });
}
export function getProduct(id) {
  return request(`/api/products/${encodeURIComponent(id)}`);
}
export function getProductContents(id) {
  return request(`/api/products/${encodeURIComponent(id)}/contents`);
}
export function productsOpenQuote({ sealedProductId, openerWallet, batchIndex, batchSize, mode }) {
  return request('/api/products/open/quote', {
    method: 'POST',
    body: { sealedProductId, openerWallet, batchIndex, batchSize, mode }
  });
}
export function productsOpenRecord({ sealedProductId, openerWallet, txSignature, batchIndex, batchSize, mode }) {
  return request('/api/products/open/record', {
    method: 'POST',
    body: { sealedProductId, openerWallet, txSignature, batchIndex, batchSize, mode }
  });
}

export function getCard(cardKey) {
  return request(`/api/cards/${encodeURIComponent(cardKey)}`);
}
export function searchCards({ dogId, variant, rarityGroup, owner, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (dogId !== undefined) params.set('dogId', String(dogId));
  if (variant) params.set('variant', variant);
  if (rarityGroup) params.set('rarityGroup', rarityGroup);
  if (owner) params.set('owner', owner);
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/cards/search${qs}`);
}
export function recentCards({ limit } = {}) {
  const qs = limit ? `?limit=${encodeURIComponent(limit)}` : '';
  return request(`/api/cards/recent${qs}`);
}
export function cardHighlights() {
  return request('/api/cards/highlights');
}
export function cardOffers(cardKey) {
  return request(`/api/cards/${encodeURIComponent(cardKey)}/offers`);
}

export function getDog(dogId) {
  return request(`/api/dogs/${encodeURIComponent(dogId)}`);
}
export function getDogCards(dogId) {
  return request(`/api/dogs/${encodeURIComponent(dogId)}/cards`);
}
export function getDogOffers(dogId) {
  return request(`/api/dogs/${encodeURIComponent(dogId)}/offers`);
}
export function getDogActivity(dogId) {
  return request(`/api/dogs/${encodeURIComponent(dogId)}/activity`);
}

export function getBinder(wallet) {
  return request(`/api/binder/${encodeURIComponent(wallet)}`);
}
export function getBinderCards(wallet, { limit, offset } = {}) {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/binder/${encodeURIComponent(wallet)}/cards${qs}`);
}
export function getBinderMissing(wallet, { dogId } = {}) {
  const qs = dogId !== undefined ? `?dogId=${encodeURIComponent(dogId)}` : '';
  return request(`/api/binder/${encodeURIComponent(wallet)}/missing${qs}`);
}
export function getBinderDuplicates(wallet) {
  return request(`/api/binder/${encodeURIComponent(wallet)}/duplicates`);
}
export function getBinderProducts(wallet) {
  return request(`/api/binder/${encodeURIComponent(wallet)}/products`);
}
export function getBinderOffers(wallet) {
  return request(`/api/binder/${encodeURIComponent(wallet)}/offers`);
}

export function listOffers({ state = 'active', variant, dogId, isMythic, rarityGroup, limit, offset } = {}) {
  const params = new URLSearchParams();
  if (state) params.set('state', state);
  if (variant) params.set('variant', variant);
  if (dogId !== undefined) params.set('dogId', String(dogId));
  if (isMythic !== undefined) params.set('isMythic', String(isMythic));
  if (rarityGroup) params.set('rarityGroup', rarityGroup);
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  const qs = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/offers${qs}`);
}
export function getOffer(offerId) {
  return request(`/api/offers/${encodeURIComponent(offerId)}`);
}
export function offerCreateQuote({ offerMakerWallet, predicate, offerPriceLamports, referralId, expiresAt, mode }) {
  return request('/api/offers/create/quote', {
    method: 'POST',
    body: { offerMakerWallet, predicate, offerPriceLamports, referralId, expiresAt, mode }
  });
}
export function offerCreate({ offerMakerWallet, predicate, offerPriceLamports, referralId, expiresAt, txSignature, escrowPda, signatureBase58, mode }) {
  return request('/api/offers/create', {
    method: 'POST',
    body: { offerMakerWallet, predicate, offerPriceLamports, referralId, expiresAt, txSignature, escrowPda, signatureBase58, mode }
  });
}
export function offerCancel({ offerId, offerMakerWallet, txSignature }) {
  return request('/api/offers/cancel', {
    method: 'POST',
    body: { offerId, offerMakerWallet, txSignature }
  });
}
export function offerAcceptQuote({ offerId, cardKey, sellerWallet, mode }) {
  return request('/api/offers/accept/quote', {
    method: 'POST',
    body: { offerId, cardKey, sellerWallet, mode }
  });
}
export function offerAccept({ offerId, cardKey, sellerWallet, txSignature, mode }) {
  return request('/api/offers/accept', {
    method: 'POST',
    body: { offerId, cardKey, sellerWallet, txSignature, mode }
  });
}
