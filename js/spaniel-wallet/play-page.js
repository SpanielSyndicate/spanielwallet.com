// Spaniel Wallet PWA — /play page.
//
// Two tabs:
//   - For Keeps (primary): escrowed 2/4/8/16-card matches. Surfaces
//     the canonical rulesHash, the gate status, the acknowledgement
//     gate, the lineup picker (binder + demo fallback), and the
//     ESCROW_CPI_PENDING gate. Real Worker calls; no fake transfer.
//   - Fun Mode: deterministic local sandbox. Uses the SAME canonical
//     For Keeps engine + the same 2/4/8/16 sizes + the same display
//     stats, but no escrow, no NFT transfer, no SOL transfer, no
//     Worker writes, no leaderboard impact. Practice only.
//
// For Keeps is intentionally the default tab so the player always
// sees the rules + gate status first. Fun Mode is one click away.

import { mountKeeps } from '/js/spaniel-wallet/play-keeps.js?v=20260518-keeps';
import { mountFunMode } from '/js/spaniel-wallet/play-fun.js?v=20260518-keeps';

const TABS = Object.freeze([
  { id: 'keeps', label: 'For Keeps' },
  { id: 'fun',   label: 'Fun Mode (Practice)' }
]);

export async function mount(target, ctx) {
  target.innerHTML = renderShell();
  const slot = target.querySelector('#playTabSlot');
  const tabRow = target.querySelector('#playTabRow');

  let current = 'keeps';
  async function activate(id) {
    current = id;
    for (const btn of tabRow.querySelectorAll('[data-tab]')) {
      btn.classList.toggle('app-btn-primary', btn.dataset.tab === id);
    }
    slot.innerHTML = '';
    if (id === 'keeps') {
      await mountKeeps(slot, ctx);
    } else {
      await mountFunMode(slot, ctx);
    }
  }

  tabRow.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-tab]');
    if (!btn) return;
    activate(btn.dataset.tab);
  });

  await activate(current);
}

function renderShell() {
  return `
    <h1 class="app-title">Spaniel Showdown</h1>
    <p class="app-subtitle">Pick 2, 4, 8, or 16 cards. Bark beats Zoom. Zoom beats Bite. Bite beats Bark. Charm breaks ties.</p>
    <div id="playTabRow" style="display: flex; gap: 8px; margin-bottom: 12px">
      ${TABS.map((t) => `<button class="app-btn" data-tab="${t.id}">${t.label}</button>`).join('')}
    </div>
    <div id="playTabSlot"></div>
  `;
}
