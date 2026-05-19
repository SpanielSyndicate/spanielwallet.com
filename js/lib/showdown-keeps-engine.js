// Spaniel Showdown — For Keeps deterministic engine.
//
// Pure, immutable, replayable. Given the same lineups and the same
// action sequence, every call site (frontend, Worker, audit replay)
// produces the same final state and the same round logs.
//
// The engine knows nothing about ownership, escrow, timeouts, or
// transactions. It only knows lineups, displayStats, and the per-
// round action triangle. The match state machine in
// `showdown-keeps-match.js` wraps this engine with the lifecycle
// (created → joined → locked → active → completed → claimed).
//
// Rules summary (canonical: `docs/SHOWDOWN_FOR_KEEPS_RULES.md`):
//
//   1. Each player has a fixed-order lineup of 2/4/8/16 cards.
//   2. Each round, both players choose Bark / Bite / Zoom.
//   3. Triangle: Bark beats Zoom, Zoom beats Bite, Bite beats Bark.
//   4. Round total = selectedStat + triangleAdvantage + abilityModifier.
//   5. Ties go to higher CHARM; double-CHARM-tie = 5 mutual damage, no winner.
//   6. Damage = min(40, 10 + floor(max(0, margin) / 10)).
//   7. Spirit → 0 = knockout; next card enters at full Spirit.
//   8. Match ends when one side has no active card; winner picks one
//      card from loser's locked lineup.

import { fnv32 } from './util-hash.js';
import { assertValidKeepsMatchSize } from './showdown-keeps-formats.js';
import {
  KEEPS_ACTIONS,
  isValidKeepsAction,
  triangleResult,
  KEEPS_BASE_DAMAGE,
  KEEPS_MAX_ROUND_DAMAGE,
  KEEPS_TIE_DAMAGE
} from './showdown-keeps-actions.js';

export const KEEPS_ENGINE_VERSION = 'showdown-for-keeps-engine-v1';

// ─── ability modifier ──────────────────────────────────────────
//
// Each card contributes a deterministic 0..5 ability modifier per
// round per action. The modifier is a function of (cardKey, abilityId,
// action, roundIndex) so the same card scoring with the same action
// in different rounds produces a small but bounded variance. This
// keeps the meta from being a pure stat-comparison: an ability-bearing
// card occasionally swings a round it should have lost. Cards with no
// ability return 0.

const ABILITY_MODIFIER_MAX = 5;

/**
 * @param {object} card  – lineup card meta with cardKey + optional abilityId
 * @param {string} action – one of KEEPS_ACTIONS
 * @param {number} roundIndex – non-negative integer
 * @returns {number} 0..5 inclusive
 */
export function abilityModifier(card, action, roundIndex) {
  if (!card || typeof card.cardKey !== 'string') return 0;
  const abilityId = typeof card.abilityId === 'string' ? card.abilityId : '';
  if (!abilityId) return 0;
  if (!isValidKeepsAction(action)) return 0;
  if (!Number.isInteger(roundIndex) || roundIndex < 0) return 0;
  const seed = `${card.cardKey}|${abilityId}|${action}|${roundIndex}`;
  const h = fnv32(seed);
  return h % (ABILITY_MODIFIER_MAX + 1); // 0..5
}

// ─── lineup validation ────────────────────────────────────────

const REQUIRED_DISPLAY_STAT_KEYS = ['spirit', 'bark', 'bite', 'zoom', 'charm'];

function validateLineupCard(card, idx) {
  if (!card || typeof card !== 'object') {
    throw new Error(`lineup card #${idx} not an object`);
  }
  if (typeof card.cardKey !== 'string' || !card.cardKey) {
    throw new Error(`lineup card #${idx} missing cardKey`);
  }
  const ds = card.displayStats;
  if (!ds || typeof ds !== 'object') {
    throw new Error(`lineup card #${idx} missing displayStats`);
  }
  for (const k of REQUIRED_DISPLAY_STAT_KEYS) {
    const v = ds[k];
    if (!Number.isInteger(v) || v < 0 || v > 99) {
      throw new Error(`lineup card #${idx} displayStats.${k} must be int 0..99 (got ${v})`);
    }
  }
  if (ds.spirit === 0) {
    throw new Error(`lineup card #${idx} has 0 spirit — knocked out before match start`);
  }
}

function validateLineup(lineup, matchSize, label) {
  if (!Array.isArray(lineup)) throw new Error(`lineup${label} must be an array`);
  if (lineup.length !== matchSize) {
    throw new Error(`lineup${label} must have ${matchSize} cards (got ${lineup.length})`);
  }
  const seen = new Set();
  for (let i = 0; i < lineup.length; i++) {
    validateLineupCard(lineup[i], i);
    if (seen.has(lineup[i].cardKey)) {
      throw new Error(`lineup${label} duplicate cardKey at index ${i}: ${lineup[i].cardKey}`);
    }
    seen.add(lineup[i].cardKey);
  }
}

/**
 * Reject any cardKey present in BOTH lineups. Shared between
 * `initEngineState` and the Worker's match-create handler.
 *
 * @param {Array<object>} lineupA
 * @param {Array<object>} lineupB
 */
export function assertNoCrossLineupCollision(lineupA, lineupB) {
  const a = new Set(lineupA.map((c) => c.cardKey));
  for (const c of lineupB) {
    if (a.has(c.cardKey)) {
      throw new Error(`card ${c.cardKey} appears in BOTH lineups`);
    }
  }
}

// ─── initial state ────────────────────────────────────────────

/**
 * Build the initial engine state. Throws if anything about the
 * lineups is malformed.
 */
export function initEngineState({
  matchId,
  rulesHash,
  matchSize,
  prizeRule,
  lineupA,
  lineupB
}) {
  if (typeof matchId !== 'string' || !matchId) throw new Error('matchId required');
  if (typeof rulesHash !== 'string' || !/^[0-9a-f]{64}$/.test(rulesHash)) {
    throw new Error('rulesHash must be 64 hex chars');
  }
  assertValidKeepsMatchSize(matchSize);
  if (typeof prizeRule !== 'string' || !prizeRule) throw new Error('prizeRule required');
  validateLineup(lineupA, matchSize, 'A');
  validateLineup(lineupB, matchSize, 'B');
  assertNoCrossLineupCollision(lineupA, lineupB);

  return {
    version: KEEPS_ENGINE_VERSION,
    matchId,
    rulesHash,
    matchSize,
    prizeRule,
    lineupA: lineupA.map(freezeCard),
    lineupB: lineupB.map(freezeCard),
    spiritA: lineupA.map((c) => c.displayStats.spirit),
    spiritB: lineupB.map((c) => c.displayStats.spirit),
    activeA: 0,
    activeB: 0,
    koA: 0,
    koB: 0,
    rounds: [],
    status: 'active',
    winner: null,
    forfeitedBy: null,
    timedOut: false
  };
}

function freezeCard(c) {
  return Object.freeze({
    cardKey: c.cardKey,
    cardClass: c.cardClass || null,
    variant: c.variant || null,
    abilityId: c.abilityId || null,
    displayStats: Object.freeze({ ...c.displayStats })
  });
}

// ─── round resolution ──────────────────────────────────────────

/**
 * Resolve one round. Returns the next state + the round log.
 *
 * @param {object} state
 * @param {{ actionA: string, actionB: string }} args
 * @returns {{ state: object, round: object }}
 */
export function resolveRound(state, { actionA, actionB }) {
  if (state.status !== 'active') {
    throw new Error(`cannot resolve round: match status is ${state.status}`);
  }
  if (!isValidKeepsAction(actionA)) throw new Error(`invalid actionA: ${actionA}`);
  if (!isValidKeepsAction(actionB)) throw new Error(`invalid actionB: ${actionB}`);

  const roundIndex = state.rounds.length;
  const cardA = state.lineupA[state.activeA];
  const cardB = state.lineupB[state.activeB];

  const tri = triangleResult(actionA, actionB);
  const abilA = abilityModifier(cardA, actionA, roundIndex);
  const abilB = abilityModifier(cardB, actionB, roundIndex);
  const statA = cardA.displayStats[actionA];
  const statB = cardB.displayStats[actionB];
  const totalA = statA + tri.advantageA + abilA;
  const totalB = statB + tri.advantageB + abilB;

  let roundWinner = null;
  let tiebreaker = null;
  let damageA = 0;
  let damageB = 0;

  if (totalA > totalB) {
    roundWinner = 'A';
    damageB = computeDamage(totalA, totalB);
  } else if (totalB > totalA) {
    roundWinner = 'B';
    damageA = computeDamage(totalB, totalA);
  } else {
    // Total tie → CHARM tiebreak.
    const charmA = cardA.displayStats.charm;
    const charmB = cardB.displayStats.charm;
    if (charmA > charmB) {
      roundWinner = 'A';
      tiebreaker = 'charm';
      damageB = computeDamage(totalA, totalB);
    } else if (charmB > charmA) {
      roundWinner = 'B';
      tiebreaker = 'charm';
      damageA = computeDamage(totalB, totalA);
    } else {
      // Double CHARM tie → mutual small damage, no winner.
      roundWinner = null;
      tiebreaker = 'draw';
      damageA = KEEPS_TIE_DAMAGE;
      damageB = KEEPS_TIE_DAMAGE;
    }
  }

  const spiritA = state.spiritA.slice();
  const spiritB = state.spiritB.slice();
  spiritA[state.activeA] = Math.max(0, spiritA[state.activeA] - damageA);
  spiritB[state.activeB] = Math.max(0, spiritB[state.activeB] - damageB);

  let activeA = state.activeA;
  let activeB = state.activeB;
  let koA = state.koA;
  let koB = state.koB;
  let koEventA = false;
  let koEventB = false;
  if (spiritA[activeA] === 0) {
    koEventA = true;
    koA += 1;
    activeA += 1;
  }
  if (spiritB[activeB] === 0) {
    koEventB = true;
    koB += 1;
    activeB += 1;
  }

  const round = Object.freeze({
    index: roundIndex,
    actionA,
    actionB,
    cardA: cardA.cardKey,
    cardB: cardB.cardKey,
    statA,
    statB,
    triangleAdvantageA: tri.advantageA,
    triangleAdvantageB: tri.advantageB,
    triangleWinner: tri.winner,
    abilityModifierA: abilA,
    abilityModifierB: abilB,
    totalA,
    totalB,
    roundWinner,
    tiebreaker,
    damageA,
    damageB,
    spiritAfterA: spiritA[state.activeA],
    spiritAfterB: spiritB[state.activeB],
    koA: koEventA,
    koB: koEventB
  });

  let nextStatus = 'active';
  let winner = state.winner;
  if (koA >= state.matchSize && koB >= state.matchSize) {
    // Simultaneous full wipe — pick a winner deterministically.
    winner = deterministicDoubleKoWinner(state);
    nextStatus = 'completed';
  } else if (koA >= state.matchSize) {
    winner = 'B';
    nextStatus = 'completed';
  } else if (koB >= state.matchSize) {
    winner = 'A';
    nextStatus = 'completed';
  }

  const next = {
    ...state,
    spiritA,
    spiritB,
    activeA,
    activeB,
    koA,
    koB,
    rounds: state.rounds.concat([round]),
    status: nextStatus,
    winner
  };
  return { state: next, round };
}

function computeDamage(winnerTotal, loserTotal) {
  const margin = Math.max(0, winnerTotal - loserTotal);
  const marginDamage = Math.floor(margin / 10);
  return Math.min(KEEPS_MAX_ROUND_DAMAGE, KEEPS_BASE_DAMAGE + marginDamage);
}

/**
 * Simultaneous full-knockout tiebreaker. Rules text guarantees no
 * draw for a completed match, so we resolve as follows:
 *   1. Side that knocked out the OPPONENT's last card with strictly
 *      higher round total wins; if both reached 0 from the same
 *      round, fall through.
 *   2. Higher accumulated CHARM across full lineup wins.
 *   3. Side A wins (deterministic fallback).
 *
 * Step 1 is implicit — if both totals were equal in the final round,
 * we wouldn't be here (a CHARM tiebreaker on totals would have
 * forced single damage). So in practice this branch covers the rare
 * double-KO where both losing actives were already 1-shot away and
 * the round was a total tie with the same CHARM — i.e. step 3 fires.
 */
function deterministicDoubleKoWinner(state) {
  const charmA = state.lineupA.reduce((s, c) => s + c.displayStats.charm, 0);
  const charmB = state.lineupB.reduce((s, c) => s + c.displayStats.charm, 0);
  if (charmA > charmB) return 'A';
  if (charmB > charmA) return 'B';
  return 'A';
}

// ─── forfeit + timeout ────────────────────────────────────────

/**
 * Apply a forfeit. The forfeiting seat loses the match; the other
 * seat becomes the winner. `reason` is recorded for the replay.
 *
 * @param {object} state
 * @param {{ forfeitingSeat: 'A'|'B', reason: string }} args
 * @returns {object}
 */
export function forfeitMatch(state, { forfeitingSeat, reason }) {
  if (state.status !== 'active') throw new Error(`cannot forfeit from status ${state.status}`);
  if (forfeitingSeat !== 'A' && forfeitingSeat !== 'B') {
    throw new Error(`forfeitingSeat must be 'A' or 'B' (got ${forfeitingSeat})`);
  }
  const winner = forfeitingSeat === 'A' ? 'B' : 'A';
  const isTimeout = typeof reason === 'string' && /timeout/i.test(reason);
  return {
    ...state,
    status: isTimeout ? 'timed_out' : 'forfeited',
    winner,
    forfeitedBy: forfeitingSeat,
    timedOut: isTimeout,
    forfeitReason: reason || null
  };
}

// ─── inspection helpers ──────────────────────────────────────

export function isMatchOver(state) {
  return state.status !== 'active';
}

export function winnerSeat(state) {
  return state.winner;
}

/**
 * Loser seat ('A'|'B') for a completed/forfeited/timed_out match,
 * or null if still active.
 */
export function loserSeat(state) {
  if (!state.winner) return null;
  return state.winner === 'A' ? 'B' : 'A';
}

/**
 * Card keys eligible for the Winner's-Pick prize selection (the
 * loser's full locked lineup, including knocked-out cards).
 */
export function loserPrizeEligibleCardKeys(state) {
  const loser = loserSeat(state);
  if (!loser) return [];
  const lineup = loser === 'A' ? state.lineupA : state.lineupB;
  return lineup.map((c) => c.cardKey);
}

export { KEEPS_ACTIONS };
