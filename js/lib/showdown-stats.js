// Spaniel Showdown — deterministic card stats.
//
// Every Series 1 card has a fixed set of game stats derived purely
// from its public identity (cardKey, cardClass, variant, rarityGroup,
// serial). No hidden RNG, no server discretion, no per-pull adjustments.
// Stats are committed by the card metadata at manifest generation.
//
// THE PUBLIC GAME MODEL IS 5 VISIBLE NUMBERS PER CARD:
//
//   SPIRIT — HP-like durability; the card's staying power in a match.
//   BARK   — presence, command, intimidation (challenge stat).
//   BITE   — attack, force, chaos (challenge stat).
//   ZOOM   — speed, initiative, agility (challenge stat).
//   CHARM  — luck, magic, social power (challenge stat).
//
// Plus exactly one ability line. That's the entire user-facing game
// surface. Match flow is Pokémon-readable: each round flips a
// challenge stat (Bark/Bite/Zoom/Charm), each player plays a card,
// higher number wins the round; the ability can swing once per
// match under its triggering condition.
//
// The deeper internal stats (combat, support, derived) are kept for
// the existing Showdown engine math and replay-verification path,
// but they are NEVER shown on the card back, the binder thumbnail,
// or the card-page UI. The card back exposes only `displayStats`
// (spirit + 4 challenge stats) and the single ability line.
//
// Stats are 0..99 integers (cheap to render, easy to compare). We
// reserve 100+ for future expansion. Variant + rarity scale the cap
// of each base stat; rarer cards have higher absolute ceilings, but
// deck-construction limits prevent auto-win — a 100-card kennel
// can't hold more than 10 mythics.
//
// Deterministic derivation: FNV-1a-64 hash of `${cardClass}|${cardKey}`
// seeds a small xorshift64 PRNG; we draw stat-by-stat with a
// per-stat rarity-scaled cap. `displayStats` is a pure deterministic
// function of the internal stats — same cardKey ⇒ same numbers,
// across runs and across surfaces (front end / Worker / engine
// audit).

import { isValidVariantSlug, getVariant } from './series1.js';

export const SHOWDOWN_STATS_VERSION = 'showdown-stats-v1';

// ─────────────────────────────────────────────────────────────────────
// Stat keys (frozen, ordered)
// ─────────────────────────────────────────────────────────────────────

export const COMBAT_STAT_KEYS = Object.freeze([
  'bark', 'bite', 'zoomies', 'loyalty', 'mischief', 'sniff', 'charm', 'grit'
]);
export const SUPPORT_STAT_KEYS = Object.freeze([
  'treats', 'toys', 'focus', 'rescue'
]);
export const DERIVED_STAT_KEYS = Object.freeze([
  'power', 'control', 'tempo', 'heart'
]);
export const ALL_STAT_KEYS = Object.freeze([
  ...COMBAT_STAT_KEYS, ...SUPPORT_STAT_KEYS, ...DERIVED_STAT_KEYS
]);

// ─────────────────────────────────────────────────────────────────────
// Rarity-scaled stat caps
// ─────────────────────────────────────────────────────────────────────
//
// Higher rarity raises the stat ceiling, not the floor. A perfectly-
// rolled common can match the average of a mythic; what changes is
// the *expected* output.

const RARITY_GROUP_CAPS = Object.freeze({
  common:   { min: 16, max: 64 },
  uncommon: { min: 20, max: 72 },
  rare:     { min: 24, max: 80 },
  ultra:    { min: 30, max: 88 },
  mythic:   { min: 40, max: 99 }
});

// ─────────────────────────────────────────────────────────────────────
// gameType assignment
// ─────────────────────────────────────────────────────────────────────
//
// Standard + mythic Spaniels are Pups. Generic commons are split
// evenly across Trick/Toy/Treat/Gear/Rescue/Anomaly so deck-builders
// always have access to a mix. Mythic inserts are Anomalies.

export const GAME_TYPES = Object.freeze([
  'pup', 'trick', 'toy', 'treat', 'gear', 'rescue', 'anomaly'
]);

const NON_PUP_GENERIC_TYPES = Object.freeze([
  'trick', 'toy', 'treat', 'gear', 'rescue'
  // anomaly is reserved for mythic inserts.
]);

export function gameTypeForCard(cardMeta) {
  const cls = cardMeta.cardClass;
  if (cls === 'standard_spaniel' || cls === 'true_mythic_spaniel') return 'pup';
  if (cls === 'mythic_insert') return 'anomaly';
  if (cls === 'generic_common') {
    const id = Number(cardMeta.genericDesignId ?? 0);
    return NON_PUP_GENERIC_TYPES[(id - 1) % NON_PUP_GENERIC_TYPES.length];
  }
  throw new Error(`unknown cardClass for gameType: ${cls}`);
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic PRNG seeded by cardKey
// ─────────────────────────────────────────────────────────────────────

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

function fnv1a64(input) {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i) & 0xff);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

function xorshift64Step(state) {
  let s = state & MASK64;
  s ^= (s << 13n) & MASK64;
  s ^= (s >> 7n);
  s ^= (s << 17n) & MASK64;
  return s & MASK64;
}

function nextU16(prng) {
  prng.state = xorshift64Step(prng.state);
  return Number(prng.state & 0xffffn);
}

function makePrng(seedString) {
  const seed = fnv1a64(seedString);
  return { state: seed === 0n ? 1n : seed };
}

function inRange(prng, min, max) {
  if (max < min) [min, max] = [max, min];
  const range = max - min + 1;
  return min + (nextU16(prng) % range);
}

// ─────────────────────────────────────────────────────────────────────
// Per-card stat derivation
// ─────────────────────────────────────────────────────────────────────

/**
 * Derive the canonical stat block for a card.
 *
 * @param {object} cardMeta
 * @param {string} cardMeta.cardKey
 * @param {string} cardMeta.cardClass
 * @param {string} cardMeta.variant
 * @param {number} [cardMeta.serial]
 * @param {number} [cardMeta.dogId]
 * @param {number} [cardMeta.genericDesignId]
 * @param {number} [cardMeta.mythicInsertId]
 * @returns {object}
 */
export function deriveCardStats(cardMeta) {
  if (!cardMeta || typeof cardMeta !== 'object') {
    throw new TypeError('cardMeta required');
  }
  if (typeof cardMeta.cardKey !== 'string' || !cardMeta.cardKey.length) {
    throw new Error('cardMeta.cardKey required');
  }
  if (!isValidVariantSlug(cardMeta.variant)) {
    throw new Error(`unknown variant: ${cardMeta.variant}`);
  }
  const variant = getVariant(cardMeta.variant);
  const rarityGroup = variant.rarityGroup;
  const caps = RARITY_GROUP_CAPS[rarityGroup];
  if (!caps) throw new Error(`unknown rarityGroup: ${rarityGroup}`);

  const seedStr = `${cardMeta.cardClass}|${cardMeta.cardKey}`;
  const prng = makePrng(seedStr);

  const combat = {};
  for (const key of COMBAT_STAT_KEYS) combat[key] = inRange(prng, caps.min, caps.max);

  const support = {};
  for (const key of SUPPORT_STAT_KEYS) support[key] = inRange(prng, caps.min, caps.max);

  // Derived stats are simple weighted sums of the rolled stats —
  // deterministic from combat+support, no extra entropy. Capped to 99.
  const power = clamp99(Math.round((combat.bark + combat.bite + combat.grit + support.toys) / 4));
  const control = clamp99(Math.round((combat.sniff + combat.charm + combat.loyalty + support.focus) / 4));
  const tempo = clamp99(Math.round((combat.zoomies + combat.mischief + support.toys + support.treats) / 4));
  const heart = clamp99(Math.round((combat.loyalty + combat.grit + support.rescue + support.treats) / 4));

  // displayStats — the only stat block the card BACK shows. Five
  // numbers: SPIRIT (HP-like) + BARK / BITE / ZOOM / CHARM
  // (challenge stats). Derived as deterministic functions of the
  // internal stats so the public game model never disagrees with
  // the engine math.
  const displayStats = deriveDisplayStats({ combat, support, derived: { power, control, tempo, heart } }, rarityGroup);

  return {
    version: SHOWDOWN_STATS_VERSION,
    cardKey: cardMeta.cardKey,
    cardClass: cardMeta.cardClass,
    variant: cardMeta.variant,
    rarityGroup,
    gameType: gameTypeForCard(cardMeta),
    combat: Object.freeze(combat),
    support: Object.freeze(support),
    derived: Object.freeze({ power, control, tempo, heart }),
    displayStats: Object.freeze(displayStats)
  };
}

// ─────────────────────────────────────────────────────────────────────
// Visible 5-stat model (SPIRIT + BARK/BITE/ZOOM/CHARM)
// ─────────────────────────────────────────────────────────────────────

export const DISPLAY_STAT_KEYS = Object.freeze([
  'spirit', 'bark', 'bite', 'zoom', 'charm'
]);

// Minimum SPIRIT per rarity — keeps even common cards usable as
// blockers in a Pokémon-readable match (no 0-HP cards). Max scales
// with rarity; mythics top out at 99 to mirror the legendary HP
// pools.
const DISPLAY_SPIRIT_RANGE = Object.freeze({
  common:   { min: 32, max: 70 },
  uncommon: { min: 40, max: 78 },
  rare:     { min: 48, max: 84 },
  ultra:    { min: 55, max: 90 },
  mythic:   { min: 70, max: 99 }
});

function clampRange(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Derive the five visible stats from the full internal stat block.
 *
 * SPIRIT = heart, clamped into the rarity-specific HP window so even
 *          rolled-low cards stay playable.
 * BARK   = bark (1:1 from internal).
 * BITE   = bite (1:1 from internal).
 * ZOOM   = zoomies (renamed to fit the visible stat label).
 * CHARM  = charm (1:1 from internal).
 *
 * @param {object} stats — { combat, support, derived }
 * @param {string} rarityGroup
 * @returns {{ spirit: number, bark: number, bite: number, zoom: number, charm: number }}
 */
export function deriveDisplayStats(stats, rarityGroup) {
  const { combat, derived } = stats;
  const range = DISPLAY_SPIRIT_RANGE[rarityGroup] || DISPLAY_SPIRIT_RANGE.common;
  return {
    spirit: clampRange(derived.heart, range.min, range.max),
    bark:   clamp99(combat.bark),
    bite:   clamp99(combat.bite),
    zoom:   clamp99(combat.zoomies),
    charm:  clamp99(combat.charm)
  };
}

function clamp99(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 99) return 99;
  return Math.round(n);
}

// ─────────────────────────────────────────────────────────────────────
// Rescue Weight contribution
// ─────────────────────────────────────────────────────────────────────
//
// Rescue weight from owning a revealed card is 1 per card (per
// rescue.js). We re-export the per-card unit here so the showdown
// UI can show it inline. The canonical constant lives in rescue.js
// as RESCUE_WEIGHT_PER_CARD; this is just a re-export under the
// showdown-side display name.

import { RESCUE_WEIGHT_PER_CARD } from './rescue.js';
export const RESCUE_WEIGHT_PER_REVEALED_CARD = RESCUE_WEIGHT_PER_CARD;

// ─────────────────────────────────────────────────────────────────────
// Affiliate Weight contribution
// ─────────────────────────────────────────────────────────────────────
//
// Affiliate Weight is the same unit count as Rescue Weight: revealed
// cards weigh 1 each. Sealed-product weights live in rescue.js.

export const AFFILIATE_WEIGHT_PER_REVEALED_CARD = 1;
