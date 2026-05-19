// Spaniel Wallet PWA — router + shell.
//
// The shell loads the page module for the current route, exposes a
// simple `mount(target, ctx)` contract, and tracks the unlocked vault
// state. Vault unlock state is held in memory only; navigation
// between tabs does not re-unlock.

import { defaultStorage, loadMeta, loadVaultEnvelope, wipeWallet } from '/js/wallet-core/storage.js?v=20260518-split';
import { shortPubkey } from '/js/wallet-core/receive.js?v=20260518-split';
import { lockUnlocked, startIdleAutoLock } from '/js/wallet-core/lock.js?v=20260518-split';
// IMPORTANT: do NOT add a `?v=…` cache-bust query to these imports.
// The page modules below (`market:`, `rescue:`, etc.) import
// `./api-url.js` and `./runtime-config.js` without a query, and ESM
// treats `api-url.js` and `api-url.js?v=…` as DIFFERENT module
// instances with separate `_cachedBase` state. Sharing the cache
// across importers requires sharing the URL — keep these plain.
import { ensureRuntimeConfig } from '/js/spaniel-wallet/api-url.js';
import { loadRuntimeConfig } from '/js/spaniel-wallet/runtime-config.js';

// ─── route → page module map ─────────────────────────────────────

const ROUTE_LOADERS = {
  wallet:    () => import('/js/spaniel-wallet/wallet-page.js?v=20260518-split'),
  binder:    () => import('/js/spaniel-wallet/binder-page.js?v=20260518-split'),
  rip:       () => import('/js/spaniel-wallet/rip-page.js?v=20260518-split'),
  market:    () => import('/js/spaniel-wallet/market-page.js?v=20260518-split'),
  rescue:    () => import('/js/spaniel-wallet/rescue-page.js?v=20260518-split'),
  affiliate: () => import('/js/spaniel-wallet/affiliate-page.js?v=20260518-split'),
  play:      () => import('/js/spaniel-wallet/play-page.js?v=20260518-split'),
  security:  () => import('/js/spaniel-wallet/security-page.js?v=20260518-split')
};

const APP_STATE = {
  storage: null,
  meta: null,
  envelope: null,
  unlocked: null,
  lastError: null
};

export async function mountAppRouter() {
  // Register the runtime-config with the apiUrl() helper once, so
  // every page module can call apiUrl('/api/…') and get the Worker
  // base URL without each page wiring it up separately. Kicked off
  // in parallel with the IndexedDB vault probe — they have no data
  // dependency, and the page modules need both done before render.
  // Best-effort — if runtime-config.json fails to load, pages fall
  // back to same-origin paths and surface their own "Worker
  // unavailable" copy.
  const runtimeConfigPromise = ensureRuntimeConfig(loadRuntimeConfig).catch((err) => {
    console.warn('Spaniel Wallet: runtime-config registration failed', err);
  });
  APP_STATE.storage = await defaultStorage();
  await reloadStateFromStorage();
  await runtimeConfigPromise;
  window.addEventListener('popstate', () => renderRoute());
  document.addEventListener('click', interceptInternalLinks);
  startIdleAutoLock({
    getUnlocked: () => APP_STATE.unlocked,
    lock: () => {
      if (!APP_STATE.unlocked) return;
      lockUnlocked(APP_STATE.unlocked);
      APP_STATE.unlocked = null;
      paintWalletPill();
      renderRoute();
    },
  });
  await renderRoute();
  paintWalletPill();
}

async function reloadStateFromStorage() {
  APP_STATE.meta = await loadMeta(APP_STATE.storage);
  try {
    APP_STATE.envelope = await loadVaultEnvelope(APP_STATE.storage);
  } catch (e) {
    // The wallet-core throws `VaultNotFoundError` (a `WalletError`
    // subclass) when storage is empty — the expected first-visit
    // state. We catch by `.code` rather than `instanceof` because the
    // shell and storage import wallet-errors.js via different URL
    // queries, which ES modules treat as distinct class identities.
    if (e && e.code === 'WALLET_VAULT_NOT_FOUND') {
      APP_STATE.envelope = null;
    } else {
      throw e;
    }
  }
}

function currentRoute() {
  const path = location.pathname.replace(/\/+$/, '');
  const tail = path.split('/').filter(Boolean);
  // /app or /  → wallet (default)
  if (tail.length === 0) return 'wallet';
  const candidate = tail[0];
  return candidate in ROUTE_LOADERS ? candidate : 'wallet';
}

function setActiveTab(route) {
  for (const a of document.querySelectorAll('.app-tab')) {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

async function renderRoute() {
  const route = currentRoute();
  setActiveTab(route);
  const main = document.getElementById('appMain');
  main.innerHTML = '<p class="app-loading">Loading…</p>';
  try {
    const mod = await ROUTE_LOADERS[route]();
    await mod.mount(main, buildPageCtx());
  } catch (err) {
    console.error(`Spaniel Wallet: failed to render ${route}`, err);
    main.innerHTML = `<p class="app-loading">Failed to render <code>${route}</code>. <a href="/" style="color: var(--accent)">Back to wallet</a>.</p>`;
  }
  paintWalletPill();
}

function buildPageCtx() {
  return {
    storage: APP_STATE.storage,
    meta: APP_STATE.meta,
    envelope: APP_STATE.envelope,
    unlocked: APP_STATE.unlocked,
    navigate: (route) => {
      const url = `/${route}/`;
      history.pushState({}, '', url);
      renderRoute();
    },
    setUnlocked(unlocked) {
      APP_STATE.unlocked = unlocked;
      paintWalletPill();
    },
    setEnvelope(envelope) {
      APP_STATE.envelope = envelope;
      paintWalletPill();
    },
    setMeta(meta) {
      APP_STATE.meta = meta;
      paintWalletPill();
    },
    refresh: async () => {
      await reloadStateFromStorage();
      paintWalletPill();
    },
    async wipe() {
      await wipeWallet(APP_STATE.storage);
      APP_STATE.unlocked = null;
      APP_STATE.envelope = null;
      APP_STATE.meta = null;
      await reloadStateFromStorage();
      paintWalletPill();
    }
  };
}

function paintWalletPill() {
  const pill = document.getElementById('appWalletPill');
  if (!pill) return;
  if (APP_STATE.unlocked) {
    pill.dataset.state = 'unlocked';
    pill.textContent = `Unlocked · ${shortPubkey(APP_STATE.unlocked.activePubkey)}`;
    return;
  }
  if (APP_STATE.envelope) {
    pill.dataset.state = 'locked';
    pill.textContent = 'Locked';
    return;
  }
  pill.dataset.state = 'missing';
  pill.textContent = 'No wallet';
}

function interceptInternalLinks(ev) {
  const a = ev.target.closest && ev.target.closest('a.app-tab, a[data-route]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/')) return;
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
  ev.preventDefault();
  history.pushState({}, '', href);
  renderRoute();
}
