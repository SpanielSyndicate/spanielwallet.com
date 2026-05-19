// Spaniel Showdown — match-level state machine + kennel commit.
//
// Match lifecycle:
//
//   1. createMatch        → matchSeed, status='waiting_join'
//   2. joinMatch          → status='waiting_commits'
//   3. commitKennel(A,B)  → both committed; status='waiting_reveals'
//   4. revealKennel(A,B)  → both revealed + verified; status='playing'
//      challengeSequence derived
//   5. playRound          → 12 rounds (or early termination)
//   6. finalizeMatch      → status='settled'
//
// All match state is JSON-serializable so a Worker can persist it to
// D1 and resume on reconnect. No client trust: ownership + kennel
// validity is re-checked in the Worker handler.

import { describeGameCard } from './showdown-cards.js';
import {
  deriveChallengeSequence,
  resolveMatch,
  ROUNDS_PER_MATCH,
  CHALLENGE_TYPES
} from './showdown-engine.js';
import { validateKennel, getFormat } from './showdown-formats.js';

export const SHOWDOWN_MATCH_VERSION = 'showdown-match-v1';

const MASK64 = 0xffffffffffffffffn;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME  = 0x100000001b3n;

function fnv1a64Hex(input) {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i) & 0xff);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * Deterministic kennel commit hash. The commit MUST be derivable
 * client-side so the player can verify the Worker stored the right
 * list at reveal time. We sort the cardKeys before hashing so order
 * inside the kennel does not change the commit.
 */
export function kennelCommit(cardKeys) {
  if (!Array.isArray(cardKeys)) throw new TypeError('cardKeys must be array');
  const sorted = cardKeys.slice().sort();
  return fnv1a64Hex(`kennel|${sorted.join(',')}`);
}

/**
 * Match seed derivation. matchId + both pubkeys give a single seed
 * string suitable for challenge sequence + opening-hand shuffle.
 */
export function matchSeed({ matchId, playerA, playerB }) {
  if (typeof matchId !== 'string') throw new TypeError('matchId required');
  if (typeof playerA !== 'string' || typeof playerB !== 'string') {
    throw new TypeError('playerA / playerB required');
  }
  // Sort player pubkeys so swapping seats does not change the seed.
  const [p1, p2] = [playerA, playerB].sort();
  return fnv1a64Hex(`match|${matchId}|${p1}|${p2}`);
}

// ─── match factory ─────────────────────────────────────────────

export function createMatch({ matchId, hostPubkey, hostKennelCommit, formatId, stakeMode = 'none' }) {
  if (typeof matchId !== 'string') throw new TypeError('matchId required');
  if (typeof hostPubkey !== 'string') throw new TypeError('hostPubkey required');
  if (typeof hostKennelCommit !== 'string') throw new TypeError('hostKennelCommit required');
  if (!getFormat(formatId)) throw new Error(`unknown format: ${formatId}`);

  return {
    version: SHOWDOWN_MATCH_VERSION,
    matchId,
    status: 'waiting_join',
    formatId,
    stakeMode, // 'none' | 'kennel-stake' (gated; never live by default)
    host: hostPubkey,
    guest: null,
    commits: { [hostPubkey]: hostKennelCommit },
    reveals: {},
    challengeSequence: null,
    plays: { A: [], B: [] },
    seats: { A: hostPubkey, B: null },
    matchSeed: null,
    createdAt: nowIso(),
    settledAt: null,
    winner: null,
    pointsA: 0,
    pointsB: 0,
    rounds: []
  };
}

export function joinMatch(match, { guestPubkey, guestKennelCommit }) {
  if (match.status !== 'waiting_join') throw new Error(`cannot join in status ${match.status}`);
  if (typeof guestPubkey !== 'string') throw new TypeError('guestPubkey required');
  if (guestPubkey === match.host) throw new Error('host cannot join their own match');
  if (typeof guestKennelCommit !== 'string') throw new TypeError('guestKennelCommit required');

  return {
    ...match,
    guest: guestPubkey,
    commits: { ...match.commits, [guestPubkey]: guestKennelCommit },
    seats: { A: match.host, B: guestPubkey },
    matchSeed: matchSeed({ matchId: match.matchId, playerA: match.host, playerB: guestPubkey }),
    status: 'waiting_reveals'
  };
}

export function revealKennel(match, { pubkey, kennel }) {
  if (match.status !== 'waiting_reveals') throw new Error(`cannot reveal in status ${match.status}`);
  if (!Array.isArray(kennel)) throw new TypeError('kennel must be array');
  const expectedCommit = match.commits[pubkey];
  if (!expectedCommit) throw new Error('unknown player');
  const cardKeys = kennel.map((c) => c.cardKey);
  const recomputed = kennelCommit(cardKeys);
  if (recomputed !== expectedCommit) {
    throw new Error(`kennel reveal does not match commit for ${pubkey}`);
  }
  const validation = validateKennel({ cards: kennel, formatId: match.formatId });
  if (!validation.valid) {
    throw new Error(`kennel invalid for format ${match.formatId}: ${validation.errors.join('; ')}`);
  }
  const reveals = { ...match.reveals, [pubkey]: { cardKeys, summary: validation.summary } };
  const haveBoth = match.host in reveals && match.guest in reveals;
  if (!haveBoth) {
    return { ...match, reveals };
  }

  const hashA = kennelCommit(reveals[match.host].cardKeys);
  const hashB = kennelCommit(reveals[match.guest].cardKeys);
  const challenges = deriveChallengeSequence({
    matchSeed: match.matchSeed,
    kennelHashA: hashA,
    kennelHashB: hashB
  });
  return {
    ...match,
    reveals,
    challengeSequence: challenges,
    status: 'playing'
  };
}

export function recordPlay(match, { round, playA, playB }) {
  if (match.status !== 'playing') throw new Error(`cannot play in status ${match.status}`);
  if (!Number.isInteger(round) || round < 0 || round >= ROUNDS_PER_MATCH) {
    throw new Error(`round out of range: ${round}`);
  }
  const plays = {
    A: [...match.plays.A],
    B: [...match.plays.B]
  };
  plays.A[round] = playA;
  plays.B[round] = playB;
  return { ...match, plays };
}

export function finalizeMatch(match) {
  if (match.status !== 'playing') throw new Error(`cannot finalize in status ${match.status}`);
  if (!match.challengeSequence) throw new Error('no challenge sequence');
  const playsA = match.plays.A.filter(Boolean);
  const playsB = match.plays.B.filter(Boolean);
  if (playsA.length !== ROUNDS_PER_MATCH || playsB.length !== ROUNDS_PER_MATCH) {
    throw new Error(`incomplete plays (A=${playsA.length}, B=${playsB.length})`);
  }
  const result = resolveMatch({ challenges: match.challengeSequence, playsA, playsB });
  return {
    ...match,
    status: 'settled',
    settledAt: nowIso(),
    winner: result.winner,
    pointsA: result.pointsA,
    pointsB: result.pointsB,
    rounds: result.rounds
  };
}

export function forfeitMatch(match, { forfeitingPubkey }) {
  if (match.status === 'settled') throw new Error('match already settled');
  const winnerSeat = forfeitingPubkey === match.seats.A ? 'B' : 'A';
  return {
    ...match,
    status: 'settled',
    settledAt: nowIso(),
    winner: winnerSeat,
    pointsA: winnerSeat === 'A' ? 1 : 0,
    pointsB: winnerSeat === 'B' ? 1 : 0,
    rounds: match.rounds,
    forfeitedBy: forfeitingPubkey
  };
}

function nowIso() {
  return new Date().toISOString();
}

export { ROUNDS_PER_MATCH, CHALLENGE_TYPES };
