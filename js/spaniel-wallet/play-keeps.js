// Spaniel Wallet PWA — Spaniel Showdown For Keeps tab.
//
// Mounts the "For Keeps" play surface. Responsibilities:
//   1. Fetch GET /api/showdown/keeps/rules and render the gate +
//      rules-hash + match-size buttons.
//   2. Render the match-create form behind an explicit
//      acknowledgement checkbox.
//   3. Build the binder lineup picker (only kicks in once cards
//      are listed; not implemented in v1 — copy clearly states so).
//   4. NEVER pretend a lock/commit/reveal happened if the Worker
//      reported the gate as off.
//
// The on-chain settlement (Series 1 Program disc 20..29) is gated
// behind SettlementCpiPending. Even when the Worker says ENABLED,
// this UI surfaces the on-chain status separately so the player is
// never misled about whether the card actually moved.

import { apiUrl } from '/js/spaniel-wallet/api-url.js';
import { KEEPS_MATCH_SIZES } from '/js/lib/showdown-keeps-formats.js?v=20260518-keeps';
import {
  KEEPS_RULES_VERSION,
  KEEPS_ACKNOWLEDGEMENT_VERSION,
  KEEPS_ACKNOWLEDGEMENT_TEXT
} from '/js/lib/showdown-keeps-rules.js?v=20260518-keeps';
import { mountKeepsLineupPicker } from '/js/spaniel-wallet/keeps-lineup-picker.js?v=20260518-keeps';
import { KEEPS_ESCROW_CPI_PENDING_CODE } from '/js/lib/series1-keeps-program.js?v=20260518-keeps';

export async function mountKeeps(target, ctx) {
  const wallet = ctx?.unlocked?.activePubkey || null;
  target.innerHTML = renderShell();
  const status = target.querySelector('#keepsStatus');
  const form = target.querySelector('#keepsCreateForm');
  let selectedSize = null;
  let rulesPayload = null;

  // Fetch rules + gate.
  try {
    const res = await fetch(apiUrl('/api/showdown/keeps/rules'), { credentials: 'include' });
    rulesPayload = await res.json();
    if (!res.ok) {
      status.textContent = `Could not load For Keeps rules (HTTP ${res.status}).`;
      return;
    }
  } catch (e) {
    status.textContent = 'Could not reach the Worker for For Keeps rules.';
    return;
  }

  const gate = rulesPayload.gate;
  target.querySelector('#keepsRulesVersion').textContent = rulesPayload.rulesVersion;
  target.querySelector('#keepsRulesHash').textContent = rulesPayload.rulesHash;
  target.querySelector('#keepsAckText').textContent = rulesPayload.ackText || KEEPS_ACKNOWLEDGEMENT_TEXT;
  target.querySelector('#keepsRulesText').textContent = rulesPayload.rulesText;

  // Lineup picker — populated when the player selects a match size.
  const lineupSlot = target.querySelector('#keepsLineupSlot');
  let pickerHandle = null;
  function rerenderPicker(size) {
    if (!size) {
      lineupSlot.innerHTML = '';
      pickerHandle = null;
      return;
    }
    lineupSlot.innerHTML = '';
    pickerHandle = mountKeepsLineupPicker(lineupSlot, {
      wallet,
      matchSize: size,
      modeLabel: 'For Keeps lineup',
      onChange: () => updateCreateBtn()
    });
  }
  function updateCreateBtn() {
    const btn = form.querySelector('button[type="submit"]');
    if (!btn) return;
    const ackOk = form.querySelector('#keepsAck')?.checked;
    const lineupOk = !pickerHandle || pickerHandle.isComplete();
    btn.disabled = !gate.enabled || !wallet || !selectedSize || !ackOk || !lineupOk;
  }

  // Render gate banner.
  const banner = target.querySelector('#keepsGateBanner');
  if (gate.enabled) {
    banner.className = 'app-section';
    banner.innerHTML = `
      <strong>For Keeps is enabled in this environment.</strong>
      The on-chain escrow CPI is still gated behind
      <code>SettlementCpiPending</code> in the Series 1 Program;
      no card will move until that adapter ships.`;
  } else {
    const envReasons = gate.reasons?.env || [];
    const dbReasons = gate.reasons?.db || [];
    banner.className = 'app-section app-pending';
    banner.innerHTML = `
      <strong>For Keeps is currently disabled.</strong>
      <div style="margin-top: 6px">
        Environment gate: <code>${envReasons.length ? envReasons.join(', ') : 'open'}</code>
      </div>
      <div>
        Database gate: <code>${dbReasons.length ? dbReasons.join(', ') : 'open'}</code>
      </div>
      <div style="margin-top: 8px">
        Fun Mode (Dog Park) remains available for practice — switch to that tab.
      </div>`;
  }

  // Render match-size buttons (only 2/4/8/16).
  const sizeBtnRow = target.querySelector('#keepsSizeRow');
  sizeBtnRow.innerHTML = (rulesPayload.matchSizes || KEEPS_MATCH_SIZES)
    .map((n) => `<button type="button" class="app-btn" data-size="${n}">${n}</button>`).join(' ');
  sizeBtnRow.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-size]');
    if (!btn) return;
    selectedSize = Number(btn.dataset.size);
    for (const b of sizeBtnRow.querySelectorAll('button')) {
      b.classList.toggle('app-btn-primary', Number(b.dataset.size) === selectedSize);
    }
    target.querySelector('#keepsSelectedSize').textContent = `${selectedSize}-card lineup`;
    rerenderPicker(selectedSize);
    updateCreateBtn();
  });

  form.querySelector('#keepsAck')?.addEventListener('change', updateCreateBtn);

  // Disable form when gate off or no wallet.
  if (!gate.enabled) {
    form.querySelector('button[type="submit"]').disabled = true;
  }
  if (!wallet) {
    target.querySelector('#keepsWalletWarning').hidden = false;
    form.querySelector('button[type="submit"]').disabled = true;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!selectedSize) {
      status.textContent = 'Pick a match size first (2, 4, 8, or 16).';
      return;
    }
    if (!form.querySelector('#keepsAck').checked) {
      status.textContent = 'You must acknowledge the rules before creating a match.';
      return;
    }
    if (!wallet) {
      status.textContent = 'Connect + SIWS-unlock your wallet first.';
      return;
    }
    status.textContent = `Creating ${selectedSize}-card For Keeps match…`;
    try {
      const res = await fetch(apiUrl('/api/showdown/keeps/matches/create'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchSize: selectedSize,
          rulesHash: rulesPayload.rulesHash,
          acknowledgement: {
            acceptedRulesVersion: KEEPS_RULES_VERSION,
            acceptedAckVersion: KEEPS_ACKNOWLEDGEMENT_VERSION,
            acceptedAt: new Date().toISOString()
          }
        })
      });
      const body = await res.json();
      if (!res.ok) {
        const code = body?.error?.code || `HTTP_${res.status}`;
        status.textContent = `Match create failed: ${code}` +
          (body?.error?.message ? ` — ${body.error.message}` : '');
        return;
      }
      status.innerHTML = `
        Match created. ID <code>${escapeHtml(body.match.matchId)}</code>.
        <br><strong>Escrow CPI pending — no cards locked yet.</strong>
        Lineup-lock + escrow is gated until the Series 1 Program
        asset-transfer CPI (code <code>${escapeHtml(KEEPS_ESCROW_CPI_PENDING_CODE)}</code>) ships.
        Share this match ID with your opponent — the join flow will
        pause at the lock step until lock goes live.`;
    } catch (e) {
      status.textContent = `Match create error: ${e?.message || 'unknown'}`;
    }
  });
}

function renderShell() {
  return `
    <h2 class="app-section-title">For Keeps — Winner's Pick</h2>
    <p class="app-subtitle">
      Bring 2, 4, 8, or 16 cards. Bark beats Zoom, Zoom beats Bite,
      Bite beats Bark. Spirit keeps your dog standing. Charm breaks
      ties. The winner chooses one card from the loser's locked
      lineup.
    </p>

    <div id="keepsGateBanner" class="app-section app-pending">Loading For Keeps status…</div>

    <section class="app-section">
      <h3 class="app-section-title">Rules</h3>
      <p>
        Rules version:
        <code id="keepsRulesVersion">loading…</code>
        <br>
        Rules hash:
        <code id="keepsRulesHash" style="word-break: break-all">loading…</code>
      </p>
      <details>
        <summary>Show full rules text</summary>
        <pre id="keepsRulesText" class="app-pre"></pre>
      </details>
    </section>

    <section class="app-section">
      <h3 class="app-section-title">Match size</h3>
      <p>Launch supports exactly 2, 4, 8, or 16 cards. Other sizes (1 / 3 / 32 / 64 / 100) are not accepted.</p>
      <div id="keepsSizeRow" style="display: flex; gap: 8px; flex-wrap: wrap"></div>
      <p style="margin-top: 8px">Selected: <span id="keepsSelectedSize">— pick a size —</span></p>
    </section>

    <section class="app-section">
      <h3 class="app-section-title">Lineup</h3>
      <p>Pick your lineup from cards in your wallet. Need cards? <a href="/app">Rip a Pack</a>. Practice the matchups in <strong>Fun Mode</strong> first — no cards transfer there.</p>
      <div id="keepsLineupSlot"></div>
    </section>

    <section class="app-section">
      <h3 class="app-section-title">Acknowledgement</h3>
      <p>Read the plain-language rules before creating a match.</p>
      <pre id="keepsAckText" class="app-pre"></pre>
      <form id="keepsCreateForm">
        <label class="app-label">
          <input type="checkbox" id="keepsAck" required>
          I understand and accept the For Keeps rules.
        </label>
        <p id="keepsWalletWarning" class="app-pending" hidden>
          Connect and unlock your wallet (SIWS) to create a For Keeps match.
        </p>
        <div style="height: 12px"></div>
        <button class="app-btn app-btn-primary" type="submit">Create For Keeps match</button>
      </form>
      <p id="keepsStatus" class="app-pre" style="white-space: pre-wrap"></p>
    </section>

    <section class="app-section">
      <h3 class="app-section-title">What this does NOT do (yet)</h3>
      <ul style="margin: 0; padding-left: 18px">
        <li>Lock cards into the Series 1 Program escrow — gated on the program's asset-transfer CPI adapter (code <code>KEEPS_ESCROW_CPI_PENDING</code>).</li>
        <li>Submit commit-reveal rounds on-chain — gated on the same.</li>
        <li>Transfer a prize card on claim — gated on the same.</li>
      </ul>
      <p>
        Until those land, "Create match" registers the match terms
        with the Worker (when enabled), the lineup picker is fully
        live, and the round engine is fully live in Fun Mode — but
        the on-chain leg stops honestly at the escrow gate. No card
        moves on chain.
      </p>
    </section>
  `;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
