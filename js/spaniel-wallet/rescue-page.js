// Spaniel Wallet PWA — /rescue page.
//
// Shows the Rescue Pool summary and the current epoch tally. Vote
// setting is gated on the Worker auth flow being available.

import { apiGetJson } from './api-fetch.js';

export async function mount(target, ctx) {
  target.innerHTML = `
    <h1 class="app-title">Rescue Pool</h1>
    <p class="app-subtitle">6.9% of every primary buyer payment and 6.9% of every official marketplace/offer fee flows into the Rescue Pool. Each month, up to 10% of the balance is distributed to the address chosen by one-wallet-one-vote of eligible Series 1 collectors.</p>

    <section class="app-section" id="summary">
      <h2 class="app-section-title">Pool summary</h2>
      <div id="summaryBody"><p class="app-loading">Loading…</p></div>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Current epoch</h2>
      <div id="epochBody"><p class="app-loading">Loading…</p></div>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Your vote</h2>
      <p style="color: var(--muted); font-size: 13px">Rescue Weight ≥ 1,024 makes you eligible to vote. One wallet, one vote per epoch.</p>
      <div id="voteBody">
        ${ctx.unlocked
          ? '<p class="app-pending">Connect via the Wallet auth flow to set a vote. Worker auth wiring is in progress.</p>'
          : '<p class="app-pending">Unlock the Spaniel Wallet first.</p>'}
      </div>
    </section>

    <p class="app-pending">The Rescue Pool is <strong>community-directed</strong>. Spaniel Syndicate does not represent purchases as tax-deductible, and any valid Solana address may receive a distribution.</p>
  `;
  await Promise.all([loadSummary(target), loadEpoch(target)]);
}

async function loadSummary(target) {
  try {
    const body = await apiGetJson('/api/rescue/summary');
    target.querySelector('#summaryBody').innerHTML = `
      <div class="app-row"><span class="app-row-label">Pool balance (lamports)</span><span class="app-row-value">${escapeHtml(String(body.balanceLamports ?? body.balance_lamports ?? '—'))}</span></div>
      <div class="app-row"><span class="app-row-label">Lifetime contributed</span><span class="app-row-value">${escapeHtml(String(body.lifetimeContributionsLamports ?? body.lifetime_contributions_lamports ?? '—'))}</span></div>
      <div class="app-row"><span class="app-row-label">Lifetime distributed</span><span class="app-row-value">${escapeHtml(String(body.lifetimeDistributionsLamports ?? body.lifetime_distributions_lamports ?? '—'))}</span></div>
    `;
  } catch (e) {
    target.querySelector('#summaryBody').innerHTML = `<p class="app-pending">Worker unavailable: ${escapeHtml(e.message)}</p>`;
  }
}

async function loadEpoch(target) {
  try {
    const body = await apiGetJson('/api/rescue/epoch/current');
    target.querySelector('#epochBody').innerHTML = `<pre class="app-pre">${escapeHtml(JSON.stringify(body, null, 2))}</pre>`;
  } catch (e) {
    target.querySelector('#epochBody').innerHTML = `<p class="app-pending">Worker unavailable: ${escapeHtml(e.message)}</p>`;
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}
