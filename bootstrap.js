// Spaniel Wallet PWA — bootstrap entry.
//
// Wires up the router, mounts the active page, registers the service
// worker, and renders the wallet-pill state. All page bundles import
// from /js/wallet-core (non-custodial vault) — the bootstrap script
// does NOT touch secrets directly.

import { mountAppRouter } from './app.js?v=20260518-split';

if ('serviceWorker' in navigator) {
  // Only register in production. Local dev (file://, localhost,
  // *.local) re-registers wastefully.
  const isLocal =
    location.hostname === '127.0.0.1' ||
    location.hostname === 'localhost' ||
    location.hostname.endsWith('.local');
  if (!isLocal) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((e) => {
      console.warn('Spaniel Wallet: service worker registration failed', e);
    });
  }
}

mountAppRouter().catch((err) => {
  console.error('Spaniel Wallet: bootstrap failed', err);
  document.getElementById('appMain').innerHTML =
    '<p class="app-loading">Spaniel Wallet failed to load. <a href="/" style="color: var(--accent)">Reload</a>.</p>';
});
