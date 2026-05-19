// Spaniel Showdown — For Keeps match state machine.
//
// Lifecycle:
//
//   created       → host has posted match terms (matchSize, rulesHash,
//                   termsVersion, acknowledgement). No opponent yet.
//   joined        → opponent accepted; both wallets present.
//   locked        → both lineups have been committed/escrowed.
//   active        → engine is resolving rounds (commit-reveal flow).
//   completed     → engine reached a winner via knockout sequence.
//   claimed       → winner has selected the prize card from loser's
//                   locked lineup and the transfer has been recorded.
//   cancelled     → host cancelled before opponent joined; cards return.
//   forfeited     → engine forfeit (player-initiated quit).
//   timed_out     → engine forfeit (deadline missed).
//
// State transitions are pure functions. The Worker drives them after
// authenticating each wallet via SIWS, verifying ownership of the
// staked cards, and recording the commit-reveal payloads. The
// underlying card-transfer settlement is on-chain (Series 1 Program
// MatchState/MatchEscrow) and may be gated behind ESCROW_CPI_PENDING.

import {
  KEEPS_MATCH_SIZES,
  assertValidKeepsMatchSize,
  assertValidKeepsPrizeRule,
  DEFAULT_KEEPS_PRIZE_RULE,
  KEEPS_COMMIT_DEADLINE_SLOTS_DEFAULT,
  KEEPS_REVEAL_DEADLINE_SLOTS_DEFAULT
} from './showdown-keeps-formats.js';
import {
  KEEPS_RULES_VERSION,
  KEEPS_ACKNOWLEDGEMENT_VERSION
} from './showdown-keeps-rules.js';
import {
  initEngineState,
  resolveRound as engineResolveRound,
  forfeitMatch as engineForfeit,
  isMatchOver,
  winnerSeat,
  loserSeat,
  loserPrizeEligibleCardKeys
} from './showdown-keeps-engine.js';

export const KEEPS_MATCH_STATE_VERSION = 'showdown-for-keeps-match-v1';

const STATUSES = Object.freeze([
  'created',
  'joined',
  'locked',
  'active',
  'completed',
  'claimed',
  'cancelled',
  'forfeited',
  'timed_out'
]);

function assertStatus(state, allowed) {
  if (!allowed.includes(state.status)) {
    throw new Error(`invalid transition: status=${state.status} expected one of [${allowed.join(',')}]`);
  }
}

function assertAcknowledgement(ack) {
  if (!ack || typeof ack !== 'object') {
    throw new Error('acknowledgement required');
  }
  if (ack.acceptedRulesVersion !== KEEPS_RULES_VERSION) {
    throw new Error(`acknowledgement.acceptedRulesVersion mismatch (got ${ack.acceptedRulesVersion})`);
  }
  if (ack.acceptedAckVersion !== KEEPS_ACKNOWLEDGEMENT_VERSION) {
    throw new Error(`acknowledgement.acceptedAckVersion mismatch (got ${ack.acceptedAckVersion})`);
  }
  if (typeof ack.acceptedAt !== 'string' || !ack.acceptedAt) {
    throw new Error('acknowledgement.acceptedAt required');
  }
}

// ─── createMatch ─────────────────────────────────────────────

/**
 * Host posts the match terms. The opponent has not yet joined.
 * No cards are escrowed at this stage.
 */
export function createMatch({
  matchId,
  hostWallet,
  matchSize,
  rulesHash,
  prizeRule = DEFAULT_KEEPS_PRIZE_RULE,
  acknowledgement,
  commitDeadlineSlots = KEEPS_COMMIT_DEADLINE_SLOTS_DEFAULT,
  revealDeadlineSlots = KEEPS_REVEAL_DEADLINE_SLOTS_DEFAULT,
  createdAt = new Date().toISOString()
}) {
  if (typeof matchId !== 'string' || !matchId) throw new Error('matchId required');
  if (typeof hostWallet !== 'string' || !hostWallet) throw new Error('hostWallet required');
  assertValidKeepsMatchSize(matchSize);
  if (typeof rulesHash !== 'string' || !/^[0-9a-f]{64}$/.test(rulesHash)) {
    throw new Error('rulesHash must be 64 hex chars');
  }
  assertValidKeepsPrizeRule(prizeRule);
  assertAcknowledgement(acknowledgement);

  return {
    version: KEEPS_MATCH_STATE_VERSION,
    matchId,
    matchSize,
    rulesHash,
    rulesVersion: KEEPS_RULES_VERSION,
    ackVersion: KEEPS_ACKNOWLEDGEMENT_VERSION,
    prizeRule,
    commitDeadlineSlots,
    revealDeadlineSlots,
    status: 'created',
    hostWallet,
    guestWallet: null,
    acknowledgement: {
      host: { ...acknowledgement },
      guest: null
    },
    lineupCommit: { host: null, guest: null },
    lineup: { host: null, guest: null },
    escrow: { host: null, guest: null }, // populated by lockLineup
    engine: null,
    pendingRoundCommits: {},
    winnerSeat: null,
    prizeCardKey: null,
    prizeClaimedAt: null,
    createdAt,
    joinedAt: null,
    lockedAt: null,
    completedAt: null,
    cancelledAt: null
  };
}

// ─── joinMatch ───────────────────────────────────────────────

export function joinMatch(state, { guestWallet, acknowledgement, joinedAt = new Date().toISOString() }) {
  assertStatus(state, ['created']);
  if (typeof guestWallet !== 'string' || !guestWallet) throw new Error('guestWallet required');
  if (guestWallet === state.hostWallet) throw new Error('host cannot join their own match');
  assertAcknowledgement(acknowledgement);
  return {
    ...state,
    status: 'joined',
    guestWallet,
    acknowledgement: { ...state.acknowledgement, guest: { ...acknowledgement } },
    joinedAt
  };
}

// ─── cancelBeforeJoin ────────────────────────────────────────

export function cancelBeforeJoin(state, { wallet, cancelledAt = new Date().toISOString() }) {
  assertStatus(state, ['created']);
  if (wallet !== state.hostWallet) throw new Error('only host can cancel before join');
  return { ...state, status: 'cancelled', cancelledAt };
}

// ─── lockLineup ──────────────────────────────────────────────
//
// Each player locks their lineup. We accept the LINEUP COMMIT first
// (a hash over ordered cardKeys) so the lineup itself can be
// withheld until both sides commit. The actual lineup metadata
// (with displayStats) is supplied here too so the engine can
// initialize once both sides lock.

export function lockLineup(state, {
  wallet,
  lineupCommit,
  lineup,
  escrowRef,
  lockedAt = new Date().toISOString()
}) {
  assertStatus(state, ['joined', 'locked']);
  const seat = seatFor(state, wallet);
  if (!seat) throw new Error(`wallet ${wallet} is not a participant`);
  if (typeof lineupCommit !== 'string' || !/^[0-9a-f]{64}$/.test(lineupCommit)) {
    throw new Error('lineupCommit must be 64 hex chars');
  }
  if (!Array.isArray(lineup)) throw new Error('lineup must be an array');
  if (lineup.length !== state.matchSize) {
    throw new Error(`lineup must have ${state.matchSize} cards`);
  }
  const otherSeat = seat === 'host' ? 'guest' : 'host';
  const nextCommits = { ...state.lineupCommit, [seat]: lineupCommit };
  const nextLineups = { ...state.lineup, [seat]: lineup };
  const nextEscrow = { ...state.escrow, [seat]: escrowRef || null };
  const bothLocked = !!nextCommits.host && !!nextCommits.guest;

  let nextStatus = 'locked';
  let engine = state.engine;
  let nextLockedAt = state.lockedAt;
  if (bothLocked) {
    nextLockedAt = state.lockedAt || lockedAt;
    nextStatus = 'active';
    engine = initEngineState({
      matchId: state.matchId,
      rulesHash: state.rulesHash,
      matchSize: state.matchSize,
      prizeRule: state.prizeRule,
      lineupA: nextLineups.host,
      lineupB: nextLineups.guest
    });
  }

  return {
    ...state,
    status: nextStatus,
    lineupCommit: nextCommits,
    lineup: nextLineups,
    escrow: nextEscrow,
    engine,
    lockedAt: nextLockedAt
  };
}

// ─── commitRoundAction ───────────────────────────────────────
//
// Each wallet posts its sha256 commit for the current round. The
// Worker has already validated activeCardId matches the engine's
// current active card for that wallet; we just record the commit.

export function commitRoundAction(state, { wallet, roundIndex, commitHex }) {
  assertStatus(state, ['active']);
  if (typeof commitHex !== 'string' || !/^[0-9a-f]{64}$/.test(commitHex)) {
    throw new Error('commitHex must be 64 hex chars');
  }
  if (state.engine.rounds.length !== roundIndex) {
    throw new Error(`expected round ${state.engine.rounds.length}, got ${roundIndex}`);
  }
  const seat = seatFor(state, wallet);
  if (!seat) throw new Error('wallet not a participant');
  const key = `${roundIndex}:${seat}`;
  const existing = state.pendingRoundCommits[key];
  if (existing && existing.commitHex !== commitHex) {
    throw new Error('commit already posted with a different hash');
  }
  return {
    ...state,
    pendingRoundCommits: { ...state.pendingRoundCommits, [key]: { commitHex, postedAt: new Date().toISOString() } }
  };
}

// ─── revealRoundAction ───────────────────────────────────────
//
// Each wallet reveals its action + salt. Once both reveals are in,
// the engine resolves the round. `verifyFn` is the async commit-hash
// check (in tests we inject a stub; the Worker injects the real one).

export async function revealRoundAction(state, { wallet, roundIndex, action, salt, verifyFn }) {
  assertStatus(state, ['active']);
  if (typeof verifyFn !== 'function') throw new Error('verifyFn required');
  if (state.engine.rounds.length !== roundIndex) {
    throw new Error(`expected round ${state.engine.rounds.length}, got ${roundIndex}`);
  }
  const seat = seatFor(state, wallet);
  if (!seat) throw new Error('wallet not a participant');
  const commitKey = `${roundIndex}:${seat}`;
  const commit = state.pendingRoundCommits[commitKey];
  if (!commit) throw new Error('no commit on file for this round + seat');

  const activeCard = activeCardForSeat(state.engine, seat);
  if (!activeCard) throw new Error('no active card');
  const ok = await verifyFn({
    commitHex: commit.commitHex,
    rulesHash: state.rulesHash,
    matchId: state.matchId,
    roundIndex,
    wallet,
    activeCardId: activeCard.cardKey,
    action,
    salt
  });
  if (!ok) throw new Error('reveal does not match commit');

  const reveals = { ...state.pendingRoundCommits, [commitKey]: { ...commit, action, salt, revealedAt: new Date().toISOString() } };

  const hostReveal = reveals[`${roundIndex}:host`];
  const guestReveal = reveals[`${roundIndex}:guest`];
  const bothRevealed = hostReveal?.action && guestReveal?.action;
  if (!bothRevealed) {
    return { ...state, pendingRoundCommits: reveals };
  }

  // Both revealed — resolve.
  const { state: engineNext } = engineResolveRound(state.engine, {
    actionA: hostReveal.action,
    actionB: guestReveal.action
  });

  let nextStatus = state.status;
  let winnerSeatVal = state.winnerSeat;
  let completedAt = state.completedAt;
  if (isMatchOver(engineNext)) {
    nextStatus = 'completed';
    winnerSeatVal = winnerSeat(engineNext);
    completedAt = new Date().toISOString();
  }
  return {
    ...state,
    pendingRoundCommits: reveals,
    engine: engineNext,
    status: nextStatus,
    winnerSeat: winnerSeatVal,
    completedAt
  };
}

// ─── forfeitTimeout ──────────────────────────────────────────

export function forfeitTimeout(state, { forfeitingWallet, reason = 'commit_timeout' }) {
  assertStatus(state, ['active', 'locked', 'joined']);
  const seat = seatFor(state, forfeitingWallet);
  if (!seat) throw new Error('wallet not a participant');
  const seatLabel = seat === 'host' ? 'A' : 'B';
  // If engine isn't initialized yet, still mark the match timed_out.
  let engineNext = state.engine;
  if (state.engine) {
    engineNext = engineForfeit(state.engine, { forfeitingSeat: seatLabel, reason });
  }
  return {
    ...state,
    status: 'timed_out',
    engine: engineNext,
    winnerSeat: seatLabel === 'A' ? 'B' : 'A',
    completedAt: new Date().toISOString()
  };
}

// ─── claimPrize ──────────────────────────────────────────────

export function claimPrize(state, { winnerWallet, prizeCardKey, claimedAt = new Date().toISOString() }) {
  if (state.status !== 'completed' && state.status !== 'timed_out' && state.status !== 'forfeited') {
    throw new Error(`cannot claim prize from status ${state.status}`);
  }
  if (state.winnerSeat == null) throw new Error('no winner recorded');
  const winnerWalletExpected = state.winnerSeat === 'A' ? state.hostWallet : state.guestWallet;
  if (winnerWallet !== winnerWalletExpected) {
    throw new Error('only the match winner may claim the prize');
  }
  const eligible = loserLineupCardKeys(state);
  if (!eligible.includes(prizeCardKey)) {
    throw new Error(`prizeCardKey not in loser's locked lineup`);
  }
  return {
    ...state,
    status: 'claimed',
    prizeCardKey,
    prizeClaimedAt: claimedAt
  };
}

/**
 * Card keys that belong to the loser and are still escrowed and
 * eligible to be selected as the Winner's Pick prize.
 */
export function loserLineupCardKeys(state) {
  if (!state.winnerSeat) return [];
  if (!state.engine) {
    // Forfeit before lineup lock → no prize set possible.
    return [];
  }
  return loserPrizeEligibleCardKeys(state.engine);
}

/**
 * Card keys to return to each participant after the prize is claimed.
 * - Winner: all of their own locked cards.
 * - Loser: all of their locked cards EXCEPT the prize card.
 *
 * If the match never reached lock (cancelled before join, or timed
 * out before lineup lock), every locked card returns to its original
 * owner.
 */
export function settlementReturnPlan(state) {
  if (state.status === 'cancelled') {
    return {
      hostReturns: state.lineup.host?.map((c) => c.cardKey) || [],
      guestReturns: state.lineup.guest?.map((c) => c.cardKey) || [],
      prizeTo: null,
      prizeCardKey: null
    };
  }
  if (!state.engine || !state.winnerSeat) {
    return {
      hostReturns: state.lineup.host?.map((c) => c.cardKey) || [],
      guestReturns: state.lineup.guest?.map((c) => c.cardKey) || [],
      prizeTo: null,
      prizeCardKey: null
    };
  }
  const winnerSeatVal = state.winnerSeat;
  const loserSeatVal = winnerSeatVal === 'A' ? 'B' : 'A';
  const winnerLineup = winnerSeatVal === 'A' ? state.lineup.host : state.lineup.guest;
  const loserLineup = loserSeatVal === 'A' ? state.lineup.host : state.lineup.guest;
  const prizeKey = state.prizeCardKey;
  const winnerReturns = winnerLineup.map((c) => c.cardKey);
  const loserReturns = loserLineup.map((c) => c.cardKey).filter((k) => k !== prizeKey);
  const prizeTo = winnerSeatVal === 'A' ? state.hostWallet : state.guestWallet;
  return {
    hostReturns: winnerSeatVal === 'A' ? winnerReturns : loserReturns,
    guestReturns: winnerSeatVal === 'B' ? winnerReturns : loserReturns,
    prizeTo: prizeKey ? prizeTo : null,
    prizeCardKey: prizeKey
  };
}

// ─── helpers ─────────────────────────────────────────────────

function seatFor(state, wallet) {
  if (wallet === state.hostWallet) return 'host';
  if (wallet === state.guestWallet) return 'guest';
  return null;
}

function activeCardForSeat(engine, seat) {
  if (seat === 'host') return engine.lineupA[engine.activeA] || null;
  if (seat === 'guest') return engine.lineupB[engine.activeB] || null;
  return null;
}

export { STATUSES as KEEPS_MATCH_STATUSES, KEEPS_MATCH_SIZES };
