// Spaniel Showdown — playable match UI.
//
// Renders a live round-by-round match between two locked lineups
// using the canonical For Keeps engine. Used by Fun Mode today (with
// a deterministic demo opponent); the For Keeps tab will reuse this
// shell once the on-chain commit-reveal + escrow path is live.
//
// The mount function takes both lineups, a matchId, the rulesHash,
// and an opponentMove(state, playerAction, ctx) async function that
// returns the opponent's chosen action for the current round. Local
// modes (Fun Mode) pass a deterministic demo opponent; networked
// modes pass an async function that waits on the opponent's reveal.
//
// This module never calls the Worker or moves real cards. The
// caller controls all transport.

import {
  initEngineState,
  resolveRound,
  forfeitMatch
} from '/js/lib/showdown-keeps-engine.js';
import { KEEPS_ACTIONS, triangleResult } from '/js/lib/showdown-keeps-actions.js';
import { abilityLineFor } from '/js/lib/card-game-stats.js';
import { engineToReplay, verifyReplay, KEEPS_REPLAY_VERSION } from '/js/lib/showdown-keeps-replay.js?v=20260518-keeps';

export { engineToReplay, verifyReplay, KEEPS_REPLAY_VERSION };

const ACTION_LABEL = Object.freeze({
  bark: 'BARK',
  bite: 'BITE',
  zoom: 'ZOOM'
});

/**
 * Mount the match UI inside `target`. Returns a small handle so the
 * caller can read the engine state (replay, winner) once the match
 * ends without re-implementing the mount lifecycle.
 *
 * @param {HTMLElement} target
 * @param {object} opts
 * @param {string}   opts.matchId
 * @param {string}   opts.rulesHash    64-hex canonical rules hash
 * @param {number}   opts.matchSize    2 | 4 | 8 | 16
 * @param {string}   opts.prizeRule    'winner_pick_one'
 * @param {Array}    opts.lineupA      player lineup (engine-shape)
 * @param {Array}    opts.lineupB      opponent lineup (engine-shape)
 * @param {Function} opts.opponentMove async (state, playerAction, ctx) => action
 * @param {object}   [opts.labels]     UI labels { playerLabel, opponentLabel, modeLabel }
 * @param {Function} [opts.onComplete] called with final state when status !== 'active'
 */
export function mountKeepsMatch(target, opts) {
  const {
    matchId,
    rulesHash,
    matchSize,
    prizeRule,
    lineupA,
    lineupB,
    opponentMove,
    labels = {},
    onComplete = null
  } = opts || {};
  if (typeof opponentMove !== 'function') {
    throw new TypeError('mountKeepsMatch: opponentMove fn required');
  }
  let state = initEngineState({ matchId, rulesHash, matchSize, prizeRule, lineupA, lineupB });
  let busy = false;

  target.innerHTML = renderShell({ matchSize, prizeRule, labels });
  const playerLine = target.querySelector('#playerLineupRow');
  const oppLine = target.querySelector('#opponentLineupRow');
  const playerActive = target.querySelector('#playerActiveCard');
  const oppActive = target.querySelector('#opponentActiveCard');
  const actionRow = target.querySelector('#actionRow');
  const status = target.querySelector('#matchStatusLine');
  const log = target.querySelector('#roundLog');
  const winnerBlock = target.querySelector('#winnerBlock');

  function refresh() {
    renderLineupRow(playerLine, state.lineupA, state.spiritA, state.activeA, 'A');
    renderLineupRow(oppLine, state.lineupB, state.spiritB, state.activeB, 'B');
    renderActiveCard(playerActive, state.lineupA[state.activeA], state.spiritA[state.activeA]);
    renderActiveCard(oppActive, state.lineupB[state.activeB], state.spiritB[state.activeB]);
    renderActions(actionRow, state.status === 'active' && !busy);
    if (state.status !== 'active') {
      renderWinner(winnerBlock, state, labels);
      if (typeof onComplete === 'function') onComplete(state);
    } else {
      winnerBlock.innerHTML = '';
    }
  }

  async function play(action) {
    if (busy || state.status !== 'active') return;
    if (!KEEPS_ACTIONS.includes(action)) return;
    busy = true;
    status.textContent = `Waiting for opponent action…`;
    try {
      const oppAction = await opponentMove(state, action, { matchId, roundIndex: state.rounds.length });
      const { state: next, round } = resolveRound(state, { actionA: action, actionB: oppAction });
      state = next;
      appendRoundLog(log, round, state);
      const summary = roundSummary(round, state);
      status.textContent = summary;
    } catch (e) {
      status.textContent = `Round failed: ${e?.message || 'unknown'}`;
    } finally {
      busy = false;
      refresh();
    }
  }

  actionRow.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-action]');
    if (!btn) return;
    play(btn.dataset.action);
  });

  const forfeitBtn = target.querySelector('#forfeitMatchBtn');
  forfeitBtn?.addEventListener('click', () => {
    if (state.status !== 'active') return;
    if (!confirm('Forfeit this match? The opponent wins immediately.')) return;
    state = forfeitMatch(state, { forfeitingSeat: 'A', reason: 'voluntary_quit' });
    appendForfeitLog(log, state);
    refresh();
  });

  refresh();

  return {
    getState: () => state,
    getReplay: () => engineToReplay(state),
    forceForfeit: (seat = 'A') => {
      state = forfeitMatch(state, { forfeitingSeat: seat, reason: 'voluntary_quit' });
      refresh();
    }
  };
}

// ─── render helpers ─────────────────────────────────────────────

function renderShell({ matchSize, prizeRule, labels }) {
  const playerLabel = labels.playerLabel || 'Your lineup';
  const opponentLabel = labels.opponentLabel || 'Opponent lineup';
  const modeLabel = labels.modeLabel || 'Showdown Match';
  return `
    <section class="app-section">
      <h3 class="app-section-title">${escapeHtml(modeLabel)} — ${matchSize}-card</h3>
      <p style="margin: 0 0 8px 0; font-size: 13px">
        Prize rule: <code>${escapeHtml(prizeRule)}</code> ·
        <span class="keeps-triangle-helper">Bark&nbsp;beats&nbsp;Zoom · Zoom&nbsp;beats&nbsp;Bite · Bite&nbsp;beats&nbsp;Bark · Charm&nbsp;breaks&nbsp;ties</span>
      </p>

      <div style="display: grid; gap: 12px; margin-top: 8px">
        <div>
          <div class="keeps-lineup-title">${escapeHtml(opponentLabel)}</div>
          <div id="opponentLineupRow" class="keeps-lineup-row"></div>
          <div id="opponentActiveCard" class="keeps-active-card"></div>
        </div>

        <div>
          <div class="keeps-lineup-title">${escapeHtml(playerLabel)}</div>
          <div id="playerLineupRow" class="keeps-lineup-row"></div>
          <div id="playerActiveCard" class="keeps-active-card"></div>
        </div>
      </div>

      <div id="actionRow" class="app-btn-row" style="margin-top: 10px"></div>
      <p id="matchStatusLine" class="app-pending" style="margin-top: 8px">Choose Bark, Bite, or Zoom to start.</p>
      <button type="button" id="forfeitMatchBtn" class="app-btn app-btn-danger" style="margin-top: 4px">Forfeit match</button>
    </section>

    <section class="app-section" id="winnerBlock"></section>

    <section class="app-section">
      <h3 class="app-section-title">Round log</h3>
      <ol id="roundLog" class="app-pre" style="white-space: pre-wrap; padding-left: 28px; margin: 0; list-style: decimal"></ol>
    </section>
  `;
}

function renderLineupRow(parent, lineup, spirits, activeIdx, seat) {
  parent.innerHTML = lineup.map((c, i) => {
    const sp = spirits[i];
    const ko = sp === 0;
    const isActive = i === activeIdx && !ko;
    const cls = ['keeps-lineup-chip',
      isActive ? 'is-active' : '',
      ko ? 'is-ko' : ''].filter(Boolean).join(' ');
    return `
      <span class="${cls}" title="${escapeHtml(c.cardKey)}">
        <span class="keeps-chip-label">#${i + 1}</span>
        <span class="keeps-chip-key">${escapeHtml(shortCardKey(c.cardKey))}</span>
        <span class="keeps-chip-spirit">${ko ? 'KO' : `♥ ${sp}`}</span>
      </span>`;
  }).join('');
}

function renderActiveCard(parent, card, spirit) {
  if (!card) {
    parent.innerHTML = `<em>No active card.</em>`;
    return;
  }
  const ds = card.displayStats || {};
  const abilityLine = card.abilityId ? abilityLineFor(card.abilityId) : '';
  parent.innerHTML = `
    <div class="keeps-active-inner">
      <div class="keeps-active-name">${escapeHtml(card.cardKey)}</div>
      <div class="keeps-stat-row">
        <span class="keeps-stat" title="SPIRIT">♥ <strong>${spirit}</strong></span>
        <span class="keeps-stat">BARK <strong>${ds.bark ?? '—'}</strong></span>
        <span class="keeps-stat">BITE <strong>${ds.bite ?? '—'}</strong></span>
        <span class="keeps-stat">ZOOM <strong>${ds.zoom ?? '—'}</strong></span>
        <span class="keeps-stat">CHARM <strong>${ds.charm ?? '—'}</strong></span>
      </div>
      ${abilityLine ? `<div class="keeps-active-ability">${escapeHtml(abilityLine)}</div>` : ''}
    </div>
  `;
}

function renderActions(row, enabled) {
  row.innerHTML = KEEPS_ACTIONS.map((a) => {
    return `<button type="button" class="app-btn ${enabled ? 'app-btn-primary' : ''}" data-action="${a}" ${enabled ? '' : 'disabled'}>${ACTION_LABEL[a]}</button>`;
  }).join('');
}

function renderWinner(target, state, labels) {
  if (state.status === 'active') {
    target.innerHTML = '';
    return;
  }
  const w = state.winner;
  const winnerLabel = w === 'A'
    ? (labels.playerLabel || 'Your lineup')
    : (labels.opponentLabel || 'Opponent lineup');
  const closer = state.status === 'forfeited'
    ? 'Forfeit recorded.'
    : (state.status === 'timed_out' ? 'Match timed out.' : 'Match complete.');
  target.innerHTML = `
    <h3 class="app-section-title">Match result</h3>
    <p><strong>Winner:</strong> ${escapeHtml(winnerLabel)} (seat ${escapeHtml(String(w))})</p>
    <p>${escapeHtml(closer)} ${state.rounds.length} round(s) played.</p>
  `;
}

function appendRoundLog(list, round, state) {
  const li = document.createElement('li');
  li.textContent = roundSummary(round, state);
  list.appendChild(li);
}

function appendForfeitLog(list, state) {
  const li = document.createElement('li');
  li.textContent = `Forfeit — seat ${state.forfeitedBy} surrendered. Seat ${state.winner} wins.`;
  list.appendChild(li);
}

function roundSummary(round, state) {
  const aLabel = ACTION_LABEL[round.actionA];
  const bLabel = ACTION_LABEL[round.actionB];
  const tri = triangleResult(round.actionA, round.actionB);
  let head;
  if (round.roundWinner === 'A') {
    head = `Round ${round.index + 1}: ${aLabel} ${triLabelWord(tri.winner === 'A')} ${bLabel}. You deal ${round.damageB}.`;
  } else if (round.roundWinner === 'B') {
    head = `Round ${round.index + 1}: ${bLabel} ${triLabelWord(tri.winner === 'B')} ${aLabel}. Opponent deals ${round.damageA}.`;
  } else {
    head = `Round ${round.index + 1}: ${aLabel} vs ${bLabel} — total tie, no winner. Both take ${round.damageA}.`;
  }
  if (round.tiebreaker === 'charm') {
    head += ' (Charm tiebreak)';
  }
  if (round.koA) head += ` Your card #${state.activeA} KO.`;
  if (round.koB) head += ` Opponent card #${state.activeB} KO.`;
  return head;
}

function triLabelWord(triangleWon) {
  return triangleWon ? 'beats' : 'meets';
}

function shortCardKey(key) {
  if (typeof key !== 'string') return '';
  if (key.length <= 28) return key;
  return key.slice(0, 14) + '…' + key.slice(-12);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

