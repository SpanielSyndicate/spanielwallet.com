// Spaniel Showdown — binder lineup picker.
//
// Fetches GET /api/binder/:wallet/cards, filters eligible cards
// (revealed, not sealed, not duplicate-selected), and lets the player
// build an ordered lineup of `matchSize` cards. Returns a handle the
// caller can read once the player is done (isComplete, getLineup).
//
// Engine-ready output: each card carries cardKey + cardClass +
// variant + abilityId + displayStats with the five visible stats so
// the canonical For Keeps engine can validate the lineup without
// re-deriving anything.
//
// The picker is presentational. It does NOT call /api/showdown/keeps/*
// — locking + commit + reveal happens in the For Keeps tab once the
// player has finalized the lineup.

import { apiUrl } from '/js/spaniel-wallet/api-url.js';
import { abilityLineFor } from '/js/lib/card-game-stats.js';
import {
  isValidKeepsMatchSize,
  assertValidKeepsMatchSize
} from '/js/lib/showdown-keeps-formats.js';
import { filterEligibleCards } from '/js/lib/showdown-keeps-lineup.js?v=20260518-keeps';

// Re-export so the picker module remains the single import for PWA
// callers, and tests can still import the pure filter from this file
// if they prefer (via the shared module path).
export { filterEligibleCards };

/**
 * Mount the picker. Returns a handle with:
 *   - getLineup()    → array of engine-ready cards, in order
 *   - isComplete()   → true when getLineup().length === matchSize
 *   - reset()        → clears the selection
 *   - destroy()      → removes event listeners
 *
 * @param {HTMLElement} target
 * @param {object} opts
 * @param {string|null} opts.wallet     SIWS-unlocked wallet (null → demo CTA only)
 * @param {number}     opts.matchSize   2 | 4 | 8 | 16
 * @param {string}     [opts.modeLabel] header label
 * @param {Function}   [opts.onChange]  fires on every selection change
 */
export function mountKeepsLineupPicker(target, opts) {
  const wallet = opts?.wallet || null;
  const matchSize = Number(opts?.matchSize);
  assertValidKeepsMatchSize(matchSize);
  const modeLabel = opts?.modeLabel || 'Lineup';
  const onChange = typeof opts?.onChange === 'function' ? opts.onChange : () => {};

  target.innerHTML = renderShell({ matchSize, modeLabel, wallet });
  const status = target.querySelector('#keepsPickerStatus');
  const grid = target.querySelector('#keepsPickerGrid');
  const tray = target.querySelector('#keepsPickerTray');
  const summary = target.querySelector('#keepsPickerSummary');

  /** @type {Array<object>} engine-ready cards, owned by this wallet */
  let pool = [];
  /** @type {Array<string>} ordered cardKeys */
  let selected = [];

  function isSelected(cardKey) {
    return selected.includes(cardKey);
  }

  function selectAdd(cardKey) {
    if (isSelected(cardKey)) return;
    if (selected.length >= matchSize) return;
    selected.push(cardKey);
    rerenderSelections();
    onChange();
  }

  function selectRemove(cardKey) {
    const i = selected.indexOf(cardKey);
    if (i < 0) return;
    selected.splice(i, 1);
    rerenderSelections();
    onChange();
  }

  function selectMove(cardKey, delta) {
    const i = selected.indexOf(cardKey);
    if (i < 0) return;
    const j = i + delta;
    if (j < 0 || j >= selected.length) return;
    [selected[i], selected[j]] = [selected[j], selected[i]];
    rerenderSelections();
    onChange();
  }

  function rerenderSelections() {
    summary.textContent = `${selected.length} / ${matchSize} selected`;
    tray.innerHTML = renderTray(selected, pool);
    // Update grid disabled/selected classes
    for (const card of grid.querySelectorAll('[data-card-key]')) {
      const key = card.dataset.cardKey;
      const sel = isSelected(key);
      card.classList.toggle('is-selected', sel);
      const full = selected.length >= matchSize && !sel;
      card.classList.toggle('is-disabled', full);
    }
  }

  grid.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-card-key]');
    if (!btn) return;
    const key = btn.dataset.cardKey;
    if (isSelected(key)) selectRemove(key);
    else selectAdd(key);
  });

  tray.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-tray-action]');
    if (!btn) return;
    const key = btn.dataset.cardKey;
    const action = btn.dataset.trayAction;
    if (action === 'remove') selectRemove(key);
    else if (action === 'up') selectMove(key, -1);
    else if (action === 'down') selectMove(key, +1);
  });

  // ── load ──────────────────────────────────────────────────────
  if (!wallet) {
    status.textContent = 'No wallet — switch to Demo cards to play.';
    grid.innerHTML = '';
    return {
      getLineup() { return []; },
      isComplete() { return false; },
      reset() { selected = []; rerenderSelections(); },
      destroy() { /* noop */ }
    };
  }

  status.textContent = 'Loading binder…';
  loadBinder(wallet).then((cards) => {
    const elig = filterEligibleCards(cards);
    pool = elig;
    if (pool.length === 0) {
      status.innerHTML = `No revealed cards in your binder. <a href="/app">Rip a Pack</a> to get cards. Demo mode uses sample cards.`;
      grid.innerHTML = '';
      return;
    }
    if (pool.length < matchSize) {
      status.textContent = `Need ${matchSize} cards but binder has ${pool.length}. Rip more, or pick a smaller match size.`;
    } else {
      status.textContent = `${pool.length} eligible cards loaded.`;
    }
    grid.innerHTML = renderGrid(pool);
    rerenderSelections();
  }).catch((e) => {
    status.textContent = `Could not load binder: ${e?.message || 'unknown error'}`;
  });

  return {
    getLineup() {
      const map = new Map(pool.map((c) => [c.cardKey, c]));
      return selected.map((k) => map.get(k)).filter(Boolean);
    },
    isComplete() {
      return selected.length === matchSize;
    },
    reset() {
      selected = [];
      rerenderSelections();
      onChange();
    },
    destroy() { /* listeners cleared with innerHTML wipe */ }
  };
}

// ─── data load + filter ──────────────────────────────────────

async function loadBinder(wallet) {
  const url = apiUrl(`/api/binder/${encodeURIComponent(wallet)}/cards?limit=500`);
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const body = await res.json();
  return Array.isArray(body?.cards) ? body.cards : [];
}

// ─── render ─────────────────────────────────────────────────

function renderShell({ matchSize, modeLabel, wallet }) {
  return `
    <p class="keeps-lineup-title">${escapeHtml(modeLabel)} — pick ${matchSize} cards</p>
    <p id="keepsPickerStatus" class="app-pending"></p>
    <div id="keepsPickerGrid" class="keeps-picker-grid"></div>
    <p id="keepsPickerSummary" style="margin-top: 8px; font-weight: 600">0 / ${matchSize} selected</p>
    <ol id="keepsPickerTray" class="app-pre" style="list-style: decimal; padding-left: 28px; margin: 0;"></ol>
  `;
}

function renderGrid(pool) {
  return pool.map((c) => {
    return `
      <button type="button" class="keeps-picker-card" data-card-key="${escapeHtml(c.cardKey)}">
        <div style="font-family: var(--font-mono, monospace); font-size: 11px; word-break: break-all">${escapeHtml(c.cardKey)}</div>
        <div style="font-size: 11px; color: var(--muted); margin-top: 2px">${escapeHtml(c.variant)}${c.isMythic ? ' · MYTHIC' : ''}</div>
        <div class="keeps-stat-row" style="margin-top: 4px">
          <span class="keeps-stat" title="SPIRIT">♥ <strong>${c.displayStats.spirit}</strong></span>
          <span class="keeps-stat">BARK <strong>${c.displayStats.bark}</strong></span>
          <span class="keeps-stat">BITE <strong>${c.displayStats.bite}</strong></span>
          <span class="keeps-stat">ZOOM <strong>${c.displayStats.zoom}</strong></span>
          <span class="keeps-stat">CHARM <strong>${c.displayStats.charm}</strong></span>
        </div>
        ${c.abilityId ? `<div style="font-size: 11px; color: var(--muted); margin-top: 4px; font-style: italic">${escapeHtml(abilityLineFor(c.abilityId) || c.abilityId)}</div>` : ''}
      </button>
    `;
  }).join('');
}

function renderTray(selected, pool) {
  if (selected.length === 0) {
    return '';
  }
  const map = new Map(pool.map((c) => [c.cardKey, c]));
  return selected.map((key, i) => {
    const c = map.get(key);
    const name = c ? `${c.cardKey} (${c.variant})` : key;
    return `
      <li style="margin-bottom: 4px">
        <span style="font-family: var(--font-mono, monospace); font-size: 11px">${escapeHtml(name)}</span>
        <span style="margin-left: 8px">
          <button type="button" class="app-btn" data-tray-action="up" data-card-key="${escapeHtml(key)}" ${i === 0 ? 'disabled' : ''} aria-label="move up">↑</button>
          <button type="button" class="app-btn" data-tray-action="down" data-card-key="${escapeHtml(key)}" ${i === selected.length - 1 ? 'disabled' : ''} aria-label="move down">↓</button>
          <button type="button" class="app-btn app-btn-danger" data-tray-action="remove" data-card-key="${escapeHtml(key)}" aria-label="remove">✕</button>
        </span>
      </li>
    `;
  }).join('');
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
