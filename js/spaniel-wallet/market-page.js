// Spaniel Wallet PWA — /market page.
//
// Wires the active wallet to the existing /api/market/* endpoints
// for read-only views. List / buy / offer accept actions require
// the Series 1 Program and remain gated.

import { apiGetJson } from './api-fetch.js';

export async function mount(target, ctx) {
  target.innerHTML = `
    <h1 class="app-title">Market</h1>
    <p class="app-subtitle">Browse standing offers and active listings. Settlement is gated on the Series 1 Program.</p>

    <section class="app-section">
      <h2 class="app-section-title">Recent listings</h2>
      <div id="listingsList"><p class="app-loading">Loading…</p></div>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Standing offers</h2>
      <div id="offersList"><p class="app-loading">Loading…</p></div>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Trade actions</h2>
      <p class="app-gated">List, buy, and accept-offer flows require the Series 1 Program. Both the off-chain order signing and the on-chain settlement are scaffolded; the PWA will not submit invalid transactions.</p>
    </section>
  `;

  await Promise.all([renderListings(target), renderOffers(target)]);
}

async function renderListings(target) {
  const list = target.querySelector('#listingsList');
  try {
    const body = await apiGetJson('/api/market/listings?limit=20');
    const items = body.listings || [];
    if (!items.length) {
      list.innerHTML = '<p class="app-pending">No active listings yet.</p>';
      return;
    }
    list.innerHTML = items.map((l) => `
      <div class="app-row">
        <span class="app-row-label">${escapeHtml(l.card_key || l.cardKey || '—')}</span>
        <span class="app-row-value">${escapeHtml(String(l.price_lamports ?? l.priceLamports ?? '—'))} lamports</span>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = `<p class="app-pending">Worker unavailable: ${escapeHtml(e.message)}</p>`;
  }
}

async function renderOffers(target) {
  const list = target.querySelector('#offersList');
  try {
    const body = await apiGetJson('/api/offers?limit=20');
    const items = body.offers || [];
    if (!items.length) {
      list.innerHTML = '<p class="app-pending">No standing offers yet.</p>';
      return;
    }
    list.innerHTML = items.map((o) => `
      <div class="app-row">
        <span class="app-row-label">${escapeHtml(o.predicate_description || JSON.stringify(o.predicate || {}))}</span>
        <span class="app-row-value">${escapeHtml(String(o.offer_price_lamports ?? '—'))} lamports</span>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = `<p class="app-pending">Worker unavailable: ${escapeHtml(e.message)}</p>`;
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}
