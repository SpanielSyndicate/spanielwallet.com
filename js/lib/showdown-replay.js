// Spaniel Showdown — replay/verification.
//
// Given a final match record and the two card lists (with their
// metadata), re-run the resolver and verify every round + the final
// result match. This is what third parties (and the Worker) use to
// audit a no-stakes match result and what stakes mode will use to
// adjudicate disputes once it ships.

import {
  deriveChallengeSequence,
  resolveMatch,
  ROUNDS_PER_MATCH
} from './showdown-engine.js';
import { kennelCommit, matchSeed } from './showdown-match.js';
import { describeGameCard } from './showdown-cards.js';

export const SHOWDOWN_REPLAY_VERSION = 'showdown-replay-v1';

/**
 * Verify a match record matches what the deterministic engine would
 * produce given the recorded plays + the kennel-card metadata.
 *
 * @param {object} args
 * @param {object} args.match    — the settled match record from showdown-match
 * @param {Array}  args.kennelA  — full meta of A's kennel
 * @param {Array}  args.kennelB  — full meta of B's kennel
 * @returns {{ ok: boolean, reasons: string[], expected: object }}
 */
export function verifyMatchReplay({ match, kennelA, kennelB }) {
  const reasons = [];
  if (!match || match.status !== 'settled') {
    return { ok: false, reasons: ['match is not settled'], expected: null };
  }
  if (!Array.isArray(match.challengeSequence) || match.challengeSequence.length !== ROUNDS_PER_MATCH) {
    return { ok: false, reasons: ['missing or wrong-sized challenge sequence'], expected: null };
  }

  const hashA = kennelCommit(kennelA.map((c) => c.cardKey));
  const hashB = kennelCommit(kennelB.map((c) => c.cardKey));
  if (match.commits[match.host] !== hashA) reasons.push('hostKennelCommit mismatch');
  if (match.commits[match.guest] !== hashB) reasons.push('guestKennelCommit mismatch');

  const expectedSeed = matchSeed({
    matchId: match.matchId,
    playerA: match.host,
    playerB: match.guest
  });
  if (expectedSeed !== match.matchSeed) reasons.push('matchSeed mismatch');

  const expectedChallenges = deriveChallengeSequence({
    matchSeed: expectedSeed,
    kennelHashA: hashA,
    kennelHashB: hashB
  });
  for (let i = 0; i < ROUNDS_PER_MATCH; i++) {
    if (expectedChallenges[i] !== match.challengeSequence[i]) {
      reasons.push(`challenge mismatch at round ${i}`);
    }
  }

  // Re-resolve the match from the plays + verify the rounds match.
  const playsA = match.plays.A;
  const playsB = match.plays.B;
  const expected = resolveMatch({
    challenges: expectedChallenges,
    playsA,
    playsB
  });

  if (expected.winner !== match.winner) reasons.push('winner mismatch');
  if (expected.pointsA !== match.pointsA) reasons.push('pointsA mismatch');
  if (expected.pointsB !== match.pointsB) reasons.push('pointsB mismatch');

  return {
    ok: reasons.length === 0,
    reasons,
    expected
  };
}

/**
 * Build a compact replay envelope suitable for posting to a public
 * URL. Strips per-card metadata down to cardKey + cardClass +
 * variant; full metadata is recoverable from the manifest.
 */
export function buildReplay({ match, kennelA, kennelB }) {
  return {
    version: SHOWDOWN_REPLAY_VERSION,
    matchId: match.matchId,
    host: match.host,
    guest: match.guest,
    formatId: match.formatId,
    stakeMode: match.stakeMode,
    challengeSequence: match.challengeSequence,
    plays: {
      A: match.plays.A.map(stripPlay),
      B: match.plays.B.map(stripPlay)
    },
    winner: match.winner,
    pointsA: match.pointsA,
    pointsB: match.pointsB,
    rounds: match.rounds.map(stripRound),
    kennelKeysA: kennelA.map((c) => c.cardKey),
    kennelKeysB: kennelB.map((c) => c.cardKey)
  };
}

function stripPlay(play) {
  if (!play) return null;
  return {
    pup: { cardKey: play.pup.cardKey, cardClass: play.pup.cardClass, variant: play.pup.variant, dogId: play.pup.dogId ?? null, genericDesignId: play.pup.genericDesignId ?? null, mythicInsertId: play.pup.mythicInsertId ?? null },
    support: play.support
      ? { cardKey: play.support.cardKey, cardClass: play.support.cardClass, variant: play.support.variant, dogId: play.support.dogId ?? null, genericDesignId: play.support.genericDesignId ?? null, mythicInsertId: play.support.mythicInsertId ?? null }
      : null
  };
}

function stripRound(round) {
  if (!round) return null;
  return {
    challenge: round.log.challenge,
    primaryStat: round.log.primaryStat,
    tiebreakerStat: round.log.tiebreakerStat,
    winner: round.winner,
    scoreA: round.scoreA,
    scoreB: round.scoreB,
    cardKeyA: round.log.a.cardKey,
    cardKeyB: round.log.b.cardKey,
    supportKeyA: round.log.a.supportKey,
    supportKeyB: round.log.b.supportKey
  };
}
