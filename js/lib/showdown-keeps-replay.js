// Spaniel Showdown — For Keeps replay envelope + verifier.
//
// One canonical replay format the engine, the Worker, the Fun-Mode
// match UI, and (eventually) the on-chain audit replay all agree on.
//
// envelope shape:
//
//   {
//     version: 'showdown-for-keeps-replay-v1',
//     matchId, rulesHash, matchSize, prizeRule,
//     hostWallet?, guestWallet?,            // For Keeps mode only
//     lineupA: [{ cardKey, abilityId, displayStats }],
//     lineupB: [{ cardKey, abilityId, displayStats }],
//     rounds:  [...round records...],
//     winner: 'A'|'B'|null,
//     status: 'active'|'completed'|'forfeited'|'timed_out'|...,
//     forfeitedBy: 'A'|'B'|null,
//     timedOut: boolean,
//     prizeCardKey?, prizeTo?,              // For Keeps claim only
//   }
//
// The verifier walks the rounds in order through `initEngineState +
// resolveRound` and checks that the recorded action sequence
// reproduces the recorded round records byte-for-byte. Any drift
// (tampered actions, totals, damage, KO flags, winner, missing or
// extra rounds, wrong rulesHash) returns `{ ok: false, code, ... }`.

import {
  initEngineState,
  resolveRound,
  forfeitMatch
} from './showdown-keeps-engine.js';

export const KEEPS_REPLAY_VERSION = 'showdown-for-keeps-replay-v1';

// ─── envelope builders ────────────────────────────────────────

/**
 * Serialize an engine state into the canonical replay envelope. Used
 * by Fun Mode (no wallets / no claim) and by the Worker (after a
 * completed/claimed match — caller supplies the extra For Keeps
 * fields).
 *
 * @param {object} state    engine state from initEngineState/resolveRound
 * @param {object} [extras] optional For Keeps extras:
 *   - hostWallet, guestWallet, prizeCardKey, prizeTo
 * @returns {object} envelope
 */
export function engineToReplay(state, extras = {}) {
  if (!state || typeof state !== 'object') throw new Error('engineToReplay: state required');
  return {
    version: KEEPS_REPLAY_VERSION,
    matchId: state.matchId,
    rulesHash: state.rulesHash,
    matchSize: state.matchSize,
    prizeRule: state.prizeRule,
    hostWallet: extras.hostWallet || null,
    guestWallet: extras.guestWallet || null,
    lineupA: state.lineupA.map(serializeCard),
    lineupB: state.lineupB.map(serializeCard),
    rounds: state.rounds.map(serializeRound),
    winner: state.winner,
    status: state.status,
    forfeitedBy: state.forfeitedBy || null,
    timedOut: !!state.timedOut,
    prizeCardKey: extras.prizeCardKey || null,
    prizeTo: extras.prizeTo || null
  };
}

function serializeCard(c) {
  return {
    cardKey: c.cardKey,
    abilityId: c.abilityId || null,
    displayStats: {
      spirit: c.displayStats.spirit,
      bark: c.displayStats.bark,
      bite: c.displayStats.bite,
      zoom: c.displayStats.zoom,
      charm: c.displayStats.charm
    }
  };
}

function serializeRound(r) {
  return {
    index: r.index,
    actionA: r.actionA,
    actionB: r.actionB,
    cardA: r.cardA,
    cardB: r.cardB,
    statA: r.statA,
    statB: r.statB,
    triangleAdvantageA: r.triangleAdvantageA,
    triangleAdvantageB: r.triangleAdvantageB,
    abilityModifierA: r.abilityModifierA,
    abilityModifierB: r.abilityModifierB,
    totalA: r.totalA,
    totalB: r.totalB,
    roundWinner: r.roundWinner,
    tiebreaker: r.tiebreaker,
    damageA: r.damageA,
    damageB: r.damageB,
    spiritAfterA: r.spiritAfterA,
    spiritAfterB: r.spiritAfterB,
    koA: !!r.koA,
    koB: !!r.koB
  };
}

// ─── verifier ────────────────────────────────────────────────

/**
 * Replay verifier. Given an envelope, re-runs the engine with the
 * recorded action sequence and checks every round field plus the
 * final winner/status match.
 *
 * @param {object} envelope replay envelope (engineToReplay output)
 * @param {object} [opts]
 * @param {string} [opts.expectedRulesHash]  if provided, compared to envelope.rulesHash
 * @returns {{ ok: boolean, code?: string, message?: string, atRound?: number, field?: string }}
 */
export function verifyReplay(envelope, opts = {}) {
  if (!envelope || typeof envelope !== 'object') {
    return { ok: false, code: 'NULL_ENVELOPE', message: 'envelope required' };
  }
  if (envelope.version !== KEEPS_REPLAY_VERSION) {
    return { ok: false, code: 'BAD_VERSION', message: `expected ${KEEPS_REPLAY_VERSION}, got ${envelope.version}` };
  }
  if (typeof envelope.rulesHash !== 'string' || !/^[0-9a-f]{64}$/.test(envelope.rulesHash)) {
    return { ok: false, code: 'BAD_RULES_HASH', message: 'rulesHash must be 64 hex chars' };
  }
  if (opts.expectedRulesHash && opts.expectedRulesHash !== envelope.rulesHash) {
    return { ok: false, code: 'RULES_HASH_MISMATCH', message: `expected ${opts.expectedRulesHash}, got ${envelope.rulesHash}` };
  }
  if (!Array.isArray(envelope.lineupA) || !Array.isArray(envelope.lineupB)) {
    return { ok: false, code: 'BAD_LINEUPS', message: 'lineupA + lineupB must be arrays' };
  }
  if (!Array.isArray(envelope.rounds)) {
    return { ok: false, code: 'BAD_ROUNDS', message: 'rounds must be an array' };
  }

  let state;
  try {
    state = initEngineState({
      matchId: envelope.matchId,
      rulesHash: envelope.rulesHash,
      matchSize: envelope.matchSize,
      prizeRule: envelope.prizeRule,
      lineupA: envelope.lineupA,
      lineupB: envelope.lineupB
    });
  } catch (e) {
    return { ok: false, code: 'INIT_FAILED', message: e?.message || 'init failed' };
  }

  for (let i = 0; i < envelope.rounds.length; i++) {
    const recorded = envelope.rounds[i];
    if (recorded.index !== i) {
      return { ok: false, code: 'ROUND_INDEX', atRound: i, message: `round index drift (got ${recorded.index})` };
    }
    if (state.status !== 'active') {
      return { ok: false, code: 'EXTRA_ROUND', atRound: i, message: 'round recorded after match ended' };
    }
    let resolved;
    try {
      resolved = resolveRound(state, { actionA: recorded.actionA, actionB: recorded.actionB });
    } catch (e) {
      return { ok: false, code: 'RESOLVE_FAILED', atRound: i, message: e?.message || 'resolve failed' };
    }
    const driftField = compareRoundRecords(resolved.round, recorded);
    if (driftField) {
      return { ok: false, code: 'ROUND_FIELD_MISMATCH', atRound: i, field: driftField,
        message: `round ${i} field "${driftField}" differs from recorded` };
    }
    state = resolved.state;
  }

  // Apply terminal status if the recorded envelope ended via forfeit
  // or timeout (no rounds may have been played in those cases).
  if (envelope.status === 'forfeited' || envelope.status === 'timed_out') {
    if (state.status === 'active') {
      try {
        state = forfeitMatch(state, {
          forfeitingSeat: envelope.forfeitedBy || 'A',
          reason: envelope.status === 'timed_out' ? 'commit_timeout' : 'voluntary_quit'
        });
      } catch (e) {
        return { ok: false, code: 'FORFEIT_REPLAY_FAILED', message: e?.message || 'forfeit replay failed' };
      }
    }
  }

  if (state.status !== envelope.status) {
    return { ok: false, code: 'STATUS_MISMATCH', message: `recorded status ${envelope.status}, replay got ${state.status}` };
  }
  if (state.winner !== envelope.winner) {
    return { ok: false, code: 'WINNER_MISMATCH', message: `recorded winner ${envelope.winner}, replay got ${state.winner}` };
  }

  return { ok: true };
}

const ROUND_FIELDS = Object.freeze([
  'actionA', 'actionB',
  'cardA', 'cardB',
  'statA', 'statB',
  'triangleAdvantageA', 'triangleAdvantageB',
  'abilityModifierA', 'abilityModifierB',
  'totalA', 'totalB',
  'roundWinner', 'tiebreaker',
  'damageA', 'damageB',
  'spiritAfterA', 'spiritAfterB',
  'koA', 'koB'
]);

function compareRoundRecords(replay, recorded) {
  for (const f of ROUND_FIELDS) {
    const a = replay[f];
    const b = recorded[f];
    if (typeof a === 'boolean' || typeof b === 'boolean') {
      if (Boolean(a) !== Boolean(b)) return f;
    } else if (a !== b) {
      return f;
    }
  }
  return null;
}
