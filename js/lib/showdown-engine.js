// Spaniel Showdown — deterministic match engine.
//
// 12-round head-to-head; each round picks one of 8 challenge types.
// Each player plays exactly one Pup card + optional support card. The
// stat that the challenge keys on, plus support-effect modifiers, is
// deterministic and reproducible from the kennel commits + the seed.
//
// No hidden RNG inside resolution. The engine state can be re-derived
// from (kennelA, kennelB, matchSeedHex, plays[]).
//
// Stakes mode (see showdown-stakes design doc) re-uses this resolver;
// the only difference is the locking layer wrapped around it.

import { describeGameCard } from './showdown-cards.js';
import { getSupportEffect, getPupAbility } from './showdown-effects.js';
import { abilityIdForCard } from './showdown-cards.js';

export const SHOWDOWN_ENGINE_VERSION = 'showdown-engine-v1';

// ─── challenge catalogue ────────────────────────────────────────

export const CHALLENGE_TYPES = Object.freeze([
  'bark_off',
  'zoomies_race',
  'tug_of_war',
  'sniff_search',
  'charm_show',
  'mischief_mayhem',
  'loyalty_check',
  'rescue_run'
]);

// Each challenge keys off a primary combat stat plus a secondary
// tiebreaker. Support effects apply to the primary stat when their
// `stat` matches; otherwise they apply as a flat ability tag.

const CHALLENGE_STATS = Object.freeze({
  bark_off:        { primary: 'bark',     tiebreaker: 'charm' },
  zoomies_race:    { primary: 'zoomies',  tiebreaker: 'mischief' },
  tug_of_war:      { primary: 'grit',     tiebreaker: 'bite' },
  sniff_search:    { primary: 'sniff',    tiebreaker: 'focus' },
  charm_show:      { primary: 'charm',    tiebreaker: 'loyalty' },
  mischief_mayhem: { primary: 'mischief', tiebreaker: 'zoomies' },
  loyalty_check:   { primary: 'loyalty',  tiebreaker: 'heart' },
  rescue_run:      { primary: 'rescue',   tiebreaker: 'loyalty' }
});

export const ROUNDS_PER_MATCH = 12;
export const POINTS_TO_WIN = 7; // best of 12, early termination at 7

// ─── deterministic PRNG / shuffle ──────────────────────────────

const MASK64 = 0xffffffffffffffffn;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME  = 0x100000001b3n;

function fnv1a64(input) {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i) & 0xff);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

function xorshift64(state) {
  let s = state & MASK64;
  s ^= (s << 13n) & MASK64;
  s ^= (s >> 7n);
  s ^= (s << 17n) & MASK64;
  return s & MASK64;
}

function nextU32(prng) {
  prng.state = xorshift64(prng.state);
  return Number(prng.state & 0xffffffffn);
}

function makePrng(seedString) {
  const seed = fnv1a64(seedString);
  return { state: seed === 0n ? 1n : seed };
}

/**
 * Deterministic Fisher–Yates shuffle. Does not mutate input.
 *
 * @param {Array<any>} items
 * @param {string} seedString
 * @returns {Array<any>}
 */
export function deterministicShuffle(items, seedString) {
  if (!Array.isArray(items)) throw new TypeError('items must be array');
  if (typeof seedString !== 'string') throw new TypeError('seed must be string');
  const out = items.slice();
  const prng = makePrng(seedString);
  for (let i = out.length - 1; i > 0; i--) {
    const j = nextU32(prng) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─── challenge sequence ─────────────────────────────────────────

/**
 * Derive the 12-round challenge sequence from match-id + both player
 * pubkeys + both kennel-commit hashes. No PRNG state survives across
 * rounds — every round is a fresh hash.
 */
export function deriveChallengeSequence({ matchSeed, kennelHashA, kennelHashB }) {
  if (typeof matchSeed !== 'string' || matchSeed.length === 0) {
    throw new TypeError('matchSeed required');
  }
  const out = [];
  for (let i = 0; i < ROUNDS_PER_MATCH; i++) {
    const tag = `${matchSeed}|${kennelHashA}|${kennelHashB}|round=${i}`;
    const r = Number(fnv1a64(tag) & 0xffffn);
    out.push(CHALLENGE_TYPES[r % CHALLENGE_TYPES.length]);
  }
  return out;
}

// ─── stat read with support effects ────────────────────────────

function readStat(stats, statKey) {
  // The challenge primary stat may come from `combat`, `support`, or
  // `derived` — we look it up in priority order.
  if (statKey in stats.combat) return stats.combat[statKey];
  if (statKey in stats.support) return stats.support[statKey];
  if (statKey in stats.derived) return stats.derived[statKey];
  return 0;
}

function applyEffectToValue(baseValue, statKey, stats, effect) {
  if (!effect) return { value: baseValue, blocked: false };
  if (effect.kind === 'stat_bonus' && effect.stat === statKey) {
    return { value: baseValue + Number(effect.amount || 0), blocked: false };
  }
  if (effect.kind === 'block' && effect.stat === statKey) {
    return { value: 0, blocked: true };
  }
  if (effect.kind === 'heal') {
    return { value: baseValue + Math.round(Number(effect.amount || 0) / 2), blocked: false };
  }
  if (effect.kind === 'stat_swap' && effect.from === statKey) {
    // Swap: when the challenge keys on `from`, substitute the value
    // of `to` from this card's own stat block. Caller already
    // verified `from === statKey`.
    return { value: readStat(stats, effect.to), blocked: false };
  }
  if (effect.kind === 'tempo_swing') {
    return { value: baseValue + 3, blocked: false }; // small flat boost
  }
  return { value: baseValue, blocked: false };
}

// ─── round resolver ─────────────────────────────────────────────

/**
 * Resolve a single round given the active challenge + both plays.
 *
 * @param {object} round
 * @param {string} round.challenge      - challenge type id
 * @param {object} round.playA          - { pup: cardMeta, support?: cardMeta }
 * @param {object} round.playB          - { pup: cardMeta, support?: cardMeta }
 * @returns {{ winner: 'A'|'B'|'tie', scoreA: number, scoreB: number, log: object }}
 */
export function resolveRound({ challenge, playA, playB }) {
  const def = CHALLENGE_STATS[challenge];
  if (!def) throw new Error(`unknown challenge: ${challenge}`);
  const aDescr = describeGameCard(playA.pup);
  const bDescr = describeGameCard(playB.pup);

  const aSupportEffect = playA.support ? getSupportEffect(abilityIdForCard(playA.support)) : null;
  const bSupportEffect = playB.support ? getSupportEffect(abilityIdForCard(playB.support)) : null;
  const aPupAbility = getPupAbility(aDescr.abilityId);
  const bPupAbility = getPupAbility(bDescr.abilityId);

  // Stack: pup-self-ability + support-effect. We apply to the primary
  // stat first; ties broken by the secondary.
  const aPrimaryBase = readStat(aDescr.stats, def.primary);
  const bPrimaryBase = readStat(bDescr.stats, def.primary);

  let aPrimary = aPrimaryBase;
  let bPrimary = bPrimaryBase;
  let aBlocked = false;
  let bBlocked = false;

  // Apply own pup ability first.
  if (aPupAbility) {
    const r = applyEffectToValue(aPrimary, def.primary, aDescr.stats, aPupAbility);
    aPrimary = r.value;
    aBlocked = aBlocked || r.blocked;
  }
  if (bPupAbility) {
    const r = applyEffectToValue(bPrimary, def.primary, bDescr.stats, bPupAbility);
    bPrimary = r.value;
    bBlocked = bBlocked || r.blocked;
  }

  // Apply support effects. A support effect targeting the *opponent's*
  // stat is treated as a block (kind='block').
  if (aSupportEffect) {
    if (aSupportEffect.kind === 'block' && aSupportEffect.stat === def.primary) {
      // We do NOT block ourselves; if A plays leash (block 'mischief')
      // and the challenge IS mischief_mayhem, A loses on primary
      // automatically. This is a deliberate trade-off — supports cut
      // both ways. Players choose carefully.
      aPrimary = 0; aBlocked = true;
    } else {
      const r = applyEffectToValue(aPrimary, def.primary, aDescr.stats, aSupportEffect);
      aPrimary = r.value;
      aBlocked = aBlocked || r.blocked;
    }
  }
  if (bSupportEffect) {
    if (bSupportEffect.kind === 'block' && bSupportEffect.stat === def.primary) {
      bPrimary = 0; bBlocked = true;
    } else {
      const r = applyEffectToValue(bPrimary, def.primary, bDescr.stats, bSupportEffect);
      bPrimary = r.value;
      bBlocked = bBlocked || r.blocked;
    }
  }

  let winner;
  if (aPrimary > bPrimary) winner = 'A';
  else if (bPrimary > aPrimary) winner = 'B';
  else {
    // Tie on primary → use tiebreaker stat without support modifiers.
    const aT = readStat(aDescr.stats, def.tiebreaker);
    const bT = readStat(bDescr.stats, def.tiebreaker);
    if (aT > bT) winner = 'A';
    else if (bT > aT) winner = 'B';
    else winner = 'tie';
  }

  return {
    winner,
    scoreA: aPrimary,
    scoreB: bPrimary,
    log: {
      challenge,
      primaryStat: def.primary,
      tiebreakerStat: def.tiebreaker,
      a: {
        cardKey: playA.pup.cardKey,
        supportKey: playA.support?.cardKey ?? null,
        primary: aPrimary,
        base: aPrimaryBase,
        blocked: aBlocked
      },
      b: {
        cardKey: playB.pup.cardKey,
        supportKey: playB.support?.cardKey ?? null,
        primary: bPrimary,
        base: bPrimaryBase,
        blocked: bBlocked
      }
    }
  };
}

// ─── full match resolver ───────────────────────────────────────

/**
 * Resolve an entire 12-round match given the deterministic challenge
 * sequence + both players' play lists. Each play list MUST be exactly
 * ROUNDS_PER_MATCH long.
 *
 * @param {object} args
 * @param {object} args.challenges        - sequence from deriveChallengeSequence
 * @param {Array} args.playsA             - [{ pup, support? }, …]
 * @param {Array} args.playsB             - [{ pup, support? }, …]
 * @returns {{ winner: 'A'|'B'|'tie', pointsA: number, pointsB: number, rounds: object[] }}
 */
export function resolveMatch({ challenges, playsA, playsB }) {
  if (!Array.isArray(challenges) || challenges.length !== ROUNDS_PER_MATCH) {
    throw new Error(`challenges must be array of length ${ROUNDS_PER_MATCH}`);
  }
  if (playsA.length !== ROUNDS_PER_MATCH || playsB.length !== ROUNDS_PER_MATCH) {
    throw new Error('each play list must equal ROUNDS_PER_MATCH');
  }
  let pointsA = 0;
  let pointsB = 0;
  const rounds = [];
  for (let i = 0; i < ROUNDS_PER_MATCH; i++) {
    const result = resolveRound({
      challenge: challenges[i],
      playA: playsA[i],
      playB: playsB[i]
    });
    if (result.winner === 'A') pointsA++;
    else if (result.winner === 'B') pointsB++;
    rounds.push(result);
    if (pointsA >= POINTS_TO_WIN || pointsB >= POINTS_TO_WIN) {
      // Match decided early — remaining rounds are forfeit-equivalent
      // and not played. We still emit the round count so replay verifiers
      // can detect early-termination.
      break;
    }
  }
  let winner;
  if (pointsA > pointsB) winner = 'A';
  else if (pointsB > pointsA) winner = 'B';
  else winner = 'tie';
  return { winner, pointsA, pointsB, rounds };
}

export { CHALLENGE_STATS };
