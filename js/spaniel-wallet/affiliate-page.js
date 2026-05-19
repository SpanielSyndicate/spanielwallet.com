// Spaniel Wallet PWA — /affiliate page.
//
// Lets a marketer create a free Barklink right inside the wallet,
// then displays the resulting referral URL + dashboard pointer.

import { ensureSiwsSession } from './siws.js';
import { loadRuntimeConfig } from './runtime-config.js';
import { apiUrl } from './api-url.js';

function hostFromUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try { return new URL(value).host; } catch { return null; }
}

function originFromUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try { return new URL(value).origin; } catch { return null; }
}

function siwsBindingForRuntime(runtime) {
  const hosts = new Set();
  const origins = new Set();
  if (typeof location !== 'undefined' && location.host) hosts.add(location.host);
  if (typeof location !== 'undefined' && location.origin) origins.add(location.origin);
  for (const v of [runtime?.publicSiteOrigin, runtime?.siteOrigin, runtime?.walletSiteOrigin]) {
    const h = hostFromUrl(v); if (h) hosts.add(h);
    const o = originFromUrl(v); if (o) origins.add(o);
  }
  return { allowedHosts: Array.from(hosts), allowedUriOrigins: Array.from(origins) };
}

export async function mount(target, ctx) {
  const pubkey = ctx.unlocked?.activePubkey;
  target.innerHTML = `
    <h1 class="app-title">Affiliate</h1>
    <p class="app-subtitle">Create a free Barklink. Share it. Earn affiliate commission on every primary buyer payment and every official marketplace fee that comes through your link. Active referrals only — no passive yield.</p>

    <section class="app-section">
      <h2 class="app-section-title">Your Barklink</h2>
      ${pubkey
        ? `<button class="app-btn app-btn-primary" id="createBtn">Create or fetch my Barklink</button><pre id="barkOut" class="app-pre" hidden></pre>`
        : '<p class="app-pending">Unlock the Spaniel Wallet to create a Barklink.</p>'}
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Tier mechanic</h2>
      <p>Holding Spaniels and Series 1 cards raises your direct affiliate rate from 6.9% (base) up to 69% at 1,000,000 Affiliate Weight. This is compensation for active referrals; it is not a yield or distribution.</p>
      <p>Packline sponsor overrides pay your upstream referrer at L2 4%, L3 3%, L4 2%, L5 1% — paid by the project, not deducted from anyone else's commission.</p>
      <p><a class="app-btn" href="/affiliate.html">Open full Affiliate dashboard</a></p>
    </section>
  `;

  const btn = target.querySelector('#createBtn');
  btn?.addEventListener('click', async () => {
    const out = target.querySelector('#barkOut');
    out.hidden = false;
    out.textContent = 'Working…';
    try {
      const res = await fetch(apiUrl('/api/affiliate/me'), { credentials: 'include' });
      if (res.ok) {
        const body = await res.json();
        out.textContent = JSON.stringify(body, null, 2);
        return;
      }
      // /api/affiliate/create requires an authenticated SIWS session
      // (Worker handler calls requireSession). Sign in BEFORE issuing
      // the create request so a fresh unlock doesn't 401.
      const account = ctx.unlocked?.accounts?.find((a) => a.pubkeyBase58 === pubkey)
        || ctx.unlocked?.accounts?.[0];
      if (!account || !(account.seed instanceof Uint8Array)) {
        out.textContent = 'Wallet not unlocked — cannot sign Barklink create.';
        return;
      }
      const runtime = await loadRuntimeConfig().catch(() => ({}));
      const binding = siwsBindingForRuntime(runtime);
      out.textContent = 'Signing in to create Barklink…';
      await ensureSiwsSession({
        wallet: pubkey,
        seed: account.seed,
        allowedHosts: binding.allowedHosts,
        allowedUriOrigins: binding.allowedUriOrigins,
      });
      out.textContent = 'Creating Barklink…';
      const create = await fetch(apiUrl('/api/affiliate/create'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallet: pubkey })
      });
      const body = await create.json();
      out.textContent = JSON.stringify(body, null, 2);
    } catch (e) {
      out.textContent = 'Worker unavailable: ' + (e?.message || 'unknown error');
    }
  });
}
