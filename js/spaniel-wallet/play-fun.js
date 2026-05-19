// Spaniel Showdown — Fun Mode (practice) tab.
//
// Runs the canonical For Keeps engine locally against a deterministic
// opponent. Same rules, same triangle, same five visible stats, same
// 2/4/8/16-card sizes. Differences vs. For Keeps:
//
//   - No escrow / no card transfer / no SOL transfer.
//   - No Worker writes (we never touch /api/showdown/keeps/*).
//   - No leaderboard impact (no /api/showdown/keeps/claim).
//   - Demo cards by default; binder cards if the player has any.
//
// The mount uses the shared `mountKeepsMatch` UI so Fun Mode and For
// Keeps look and play identically once For Keeps is unlocked.

import { rulesHashHex } from '/js/lib/showdown-keeps-rules.js?v=20260518-keeps';
import {
  KEEPS_MATCH_SIZES,
  isValidKeepsMatchSize,
  DEFAULT_KEEPS_PRIZE_RULE
} from '/js/lib/showdown-keeps-formats.js?v=20260518-keeps';
import {
  buildDemoLineup,
  opponentAction,
  KEEPS_DEMO_OPPONENT_IDS,
  KEEPS_DEMO_OPPONENT_LABELS,
  isValidKeepsDemoOpponentId
} from '/js/lib/showdown-keeps-demo.js?v=20260518-keeps';
import { mountKeepsLineupPicker } from '/js/spaniel-wallet/keeps-lineup-picker.js?v=20260518-keeps';
import { mountKeepsMatch } from '/js/spaniel-wallet/keeps-match-ui.js?v=20260518-keeps';

const DEFAULT_SIZE = 2;
const DEFAULT_OPPONENT = 'deterministic_bot';

export async function mountFunMode(target, ctx) {
  const wallet = ctx?.unlocked?.activePubkey || null;
  target.innerHTML = renderShell({ wallet });
  const status = target.querySelector('#funStatus');
  const startBtn = target.querySelector('#funStartBtn');
  const sizeSel = target.querySelector('#funSizeSel');
  const opponentSel = target.querySelector('#funOpponentSel');
  const seedInp = target.querySelector('#funSeedInp');
  const pickerSlot = target.querySelector('#funPickerSlot');
  const matchSlot = target.querySelector('#funMatchSlot');
  const sourceRow = target.querySelector('#funSourceRow');

  let source = 'demo';
  let pickerHandle = null;
  function rerenderPicker(size) {
    pickerSlot.innerHTML = '';
    if (source !== 'binder') {
      pickerHandle = null;
      return;
    }
    pickerHandle = mountKeepsLineupPicker(pickerSlot, {
      wallet,
      matchSize: size,
      // Fun Mode allows duplicate cards across A and B (lineup is
      // local) — but the engine still rejects within-lineup dups.
      modeLabel: 'Fun Mode lineup',
      onChange: () => {
        startBtn.disabled = !canStart();
      }
    });
  }

  function canStart() {
    if (source === 'demo') return true;
    if (!pickerHandle) return false;
    return pickerHandle.isComplete();
  }

  function onSourceChange(ev) {
    const btn = ev.target.closest('button[data-source]');
    if (!btn) return;
    source = btn.dataset.source;
    for (const b of sourceRow.querySelectorAll('button')) {
      b.classList.toggle('app-btn-primary', b.dataset.source === source);
    }
    if (source === 'binder' && !wallet) {
      status.textContent = 'Connect + unlock your wallet to use binder cards.';
      source = 'demo';
      for (const b of sourceRow.querySelectorAll('button')) {
        b.classList.toggle('app-btn-primary', b.dataset.source === 'demo');
      }
      return;
    }
    rerenderPicker(Number(sizeSel.value));
    startBtn.disabled = !canStart();
  }

  sourceRow.addEventListener('click', onSourceChange);
  sizeSel.addEventListener('change', () => {
    const n = Number(sizeSel.value);
    if (isValidKeepsMatchSize(n)) rerenderPicker(n);
  });

  startBtn.addEventListener('click', async () => {
    const matchSize = Number(sizeSel.value);
    const opponentId = String(opponentSel.value);
    const seed = (seedInp.value || '').trim() || `fun-${Date.now()}`;
    if (!isValidKeepsMatchSize(matchSize)) {
      status.textContent = `Match size must be one of ${KEEPS_MATCH_SIZES.join(', ')}.`;
      return;
    }
    if (!isValidKeepsDemoOpponentId(opponentId)) {
      status.textContent = `Unknown opponent: ${opponentId}`;
      return;
    }
    let lineupA;
    if (source === 'binder') {
      if (!pickerHandle || !pickerHandle.isComplete()) {
        status.textContent = 'Pick a full lineup first.';
        return;
      }
      lineupA = pickerHandle.getLineup();
    } else {
      lineupA = buildDemoLineup({ matchSize, seed: `${seed}|playerDemo`, seat: 'A' });
    }
    const lineupB = buildDemoLineup({ matchSize, seed, seat: 'B' });
    const rulesHash = await rulesHashHex();
    const matchId = `fun-${seed}-${matchSize}`;
    status.textContent = '';
    matchSlot.innerHTML = '';
    mountKeepsMatch(matchSlot, {
      matchId,
      rulesHash,
      matchSize,
      prizeRule: DEFAULT_KEEPS_PRIZE_RULE,
      lineupA,
      lineupB,
      opponentMove: async (_state, playerAction, { roundIndex }) => {
        const history = _state.rounds.map((r) => r.actionA);
        return opponentAction({
          opponentId,
          seed,
          roundIndex,
          playerAction,
          history
        });
      },
      labels: {
        playerLabel: source === 'binder' ? 'Your binder lineup' : 'Your demo lineup',
        opponentLabel: KEEPS_DEMO_OPPONENT_LABELS[opponentId],
        modeLabel: 'Fun Mode (Practice)'
      }
    });
  });

  // Initial UI state.
  rerenderPicker(DEFAULT_SIZE);
  startBtn.disabled = !canStart();
}

function renderShell({ wallet }) {
  const sizes = KEEPS_MATCH_SIZES;
  const opponents = KEEPS_DEMO_OPPONENT_IDS;
  return `
    <section class="app-section">
      <h2 class="app-section-title">Fun Mode — Practice</h2>
      <p>
        Practice. No escrow. No cards transfer. No SOL transfer. No
        leaderboard. Uses the exact same For Keeps engine and 2/4/8/16
        match sizes so the practice carries over to a real For Keeps
        match.
      </p>

      <div style="display: grid; gap: 8px; max-width: 520px">
        <label class="app-label">Card source
          <div id="funSourceRow" class="app-btn-row">
            <button type="button" class="app-btn app-btn-primary" data-source="demo">Demo cards</button>
            <button type="button" class="app-btn" data-source="binder" ${wallet ? '' : 'title="Unlock wallet to use binder cards"'}>Binder cards</button>
          </div>
        </label>
        <label class="app-label" for="funSizeSel">Match size
          <select id="funSizeSel" class="app-input">
            ${sizes.map((n) => `<option value="${n}" ${n === DEFAULT_SIZE ? 'selected' : ''}>${n} cards</option>`).join('')}
          </select>
        </label>
        <label class="app-label" for="funOpponentSel">Opponent
          <select id="funOpponentSel" class="app-input">
            ${opponents.map((id) => `<option value="${id}" ${id === DEFAULT_OPPONENT ? 'selected' : ''}>${escapeHtml(KEEPS_DEMO_OPPONENT_LABELS[id] || id)}</option>`).join('')}
          </select>
        </label>
        <label class="app-label" for="funSeedInp">Seed (optional)
          <input id="funSeedInp" class="app-input" placeholder="random per click">
        </label>
      </div>
      <div style="height: 8px"></div>
      <button type="button" id="funStartBtn" class="app-btn app-btn-primary">Start practice match</button>
      <p id="funStatus" class="app-pending" style="margin-top: 8px"></p>
    </section>

    <section class="app-section">
      <h3 class="app-section-title">Lineup picker (binder cards)</h3>
      <p>
        Switch the source above to <strong>Binder cards</strong> to pick a lineup
        from cards in your wallet. Demo mode uses sample cards.
      </p>
      <div id="funPickerSlot"></div>
    </section>

    <div id="funMatchSlot"></div>
  `;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
