// Spaniel Showdown — Kennel (deck) format catalogue + validation.
//
// A Kennel is a 100-card deck. Five officially-supported formats ship
// with the no-stakes engine:
//
//   open       — anything goes, default; basis for casual + ratings
//   commons    — generic + base + bronze only
//   mythic     — must contain at least 6 mythic-class cards
//   rescue     — at least 25 'rescue' gameType cards
//   no-mythic  — zero mythic-class cards, no plate/error/black
//
// Card identity inputs:
//   { cardKey, cardClass, variant, rarityGroup, gameType, serial?, mythicInsertId? }
//
// Validation is pure data; it does NOT check ownership (that lives
// in the Worker handler, since it requires Helius/D1).

import { describeGameCard } from './showdown-cards.js';
import { isValidVariantSlug, getVariant, isValidCardClass } from './series1.js';
import { isValidCardKey } from './card-key.js';

export const SHOWDOWN_FORMATS_VERSION = 'showdown-formats-v1';

export const KENNEL_SIZE = 100;
export const MAX_GENERIC_PER_DESIGN = 4;
export const MAX_DUPLICATE_BY_CARDKEY = 1; // every cardKey is unique on-chain

export const SHOWDOWN_FORMATS = Object.freeze({
  open: Object.freeze({
    id: 'open',
    label: 'Open Kennel',
    description: 'Any 100 cards. Generic-design duplicate cap applies.',
    minPup: 40,
    maxSupport: 40,
    maxMythicClass: 10,
    allowMythic: true,
    allowedRarityGroups: ['common', 'uncommon', 'rare', 'ultra', 'mythic'],
    requireGameTypeMin: {}
  }),
  commons: Object.freeze({
    id: 'commons',
    label: 'Commons League',
    description: 'Common-rarity only: generic + base + bronze.',
    minPup: 40,
    maxSupport: 40,
    maxMythicClass: 0,
    allowMythic: false,
    allowedRarityGroups: ['common'],
    allowedVariants: ['generic', 'base', 'bronze'],
    requireGameTypeMin: {}
  }),
  mythic: Object.freeze({
    id: 'mythic',
    label: 'Mythic League',
    description: 'Must field at least 6 mythic-class cards.',
    minPup: 40,
    maxSupport: 40,
    maxMythicClass: 10,
    allowMythic: true,
    allowedRarityGroups: ['common', 'uncommon', 'rare', 'ultra', 'mythic'],
    requireMythicClassMin: 6,
    requireGameTypeMin: {}
  }),
  rescue: Object.freeze({
    id: 'rescue',
    label: 'Rescue League',
    description: 'At least 25 rescue-type cards in the kennel.',
    minPup: 40,
    maxSupport: 60,
    maxMythicClass: 10,
    allowMythic: true,
    allowedRarityGroups: ['common', 'uncommon', 'rare', 'ultra', 'mythic'],
    requireGameTypeMin: { rescue: 25 }
  }),
  'no-mythic': Object.freeze({
    id: 'no-mythic',
    label: 'No-Mythic League',
    description: 'No mythic-class cards. No plate, error, or black 1/1.',
    minPup: 40,
    maxSupport: 40,
    maxMythicClass: 0,
    allowMythic: false,
    disallowedVariants: ['mythic', 'mythic_insert', 'plate', 'error', 'black'],
    allowedRarityGroups: ['common', 'uncommon'],
    requireGameTypeMin: {}
  })
});

export const SHOWDOWN_FORMAT_IDS = Object.freeze(Object.keys(SHOWDOWN_FORMATS));

export function getFormat(formatId) {
  return SHOWDOWN_FORMATS[formatId] || null;
}

// ─────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────

/**
 * Validate a kennel (array of card metas) against a format. Returns
 * { valid, errors, summary }. Does NOT check ownership.
 *
 * @param {object} args
 * @param {Array<object>} args.cards
 * @param {string} args.formatId
 * @returns {{ valid: boolean, errors: string[], summary: object }}
 */
export function validateKennel({ cards, formatId }) {
  const errors = [];
  const fmt = getFormat(formatId);
  if (!fmt) {
    return {
      valid: false,
      errors: [`unknown format: ${formatId}`],
      summary: null
    };
  }
  if (!Array.isArray(cards)) {
    return { valid: false, errors: ['cards must be an array'], summary: null };
  }

  if (cards.length !== KENNEL_SIZE) {
    errors.push(`kennel must contain exactly ${KENNEL_SIZE} cards (got ${cards.length})`);
  }

  const byKey = new Map();
  const byGenericDesign = new Map();
  let pupCount = 0;
  let supportCount = 0;
  let mythicClassCount = 0;
  const gameTypeCounts = {};

  for (const card of cards) {
    if (!card || typeof card !== 'object') {
      errors.push('null card entry');
      continue;
    }
    if (!isValidCardClass(card.cardClass)) {
      errors.push(`invalid cardClass: ${card.cardClass}`);
      continue;
    }
    if (!isValidVariantSlug(card.variant)) {
      errors.push(`invalid variant: ${card.variant}`);
      continue;
    }
    if (typeof card.cardKey !== 'string' || !isValidCardKey(card.cardKey)) {
      errors.push(`invalid cardKey: ${card.cardKey}`);
      continue;
    }
    const variant = getVariant(card.variant);
    const rarityGroup = variant.rarityGroup;

    if (Array.isArray(fmt.allowedRarityGroups) && !fmt.allowedRarityGroups.includes(rarityGroup)) {
      errors.push(`${card.cardKey}: rarity ${rarityGroup} not allowed in format ${fmt.id}`);
    }
    if (Array.isArray(fmt.allowedVariants) && !fmt.allowedVariants.includes(variant.slug)) {
      errors.push(`${card.cardKey}: variant ${variant.slug} not allowed in format ${fmt.id}`);
    }
    if (Array.isArray(fmt.disallowedVariants) && fmt.disallowedVariants.includes(variant.slug)) {
      errors.push(`${card.cardKey}: variant ${variant.slug} disallowed in format ${fmt.id}`);
    }

    const cnt = (byKey.get(card.cardKey) ?? 0) + 1;
    byKey.set(card.cardKey, cnt);
    if (cnt > MAX_DUPLICATE_BY_CARDKEY) {
      errors.push(`duplicate cardKey ${card.cardKey} (each cardKey is unique on-chain)`);
    }

    if (card.cardClass === 'generic_common') {
      const id = Number(card.genericDesignId);
      const c = (byGenericDesign.get(id) ?? 0) + 1;
      byGenericDesign.set(id, c);
      if (c > MAX_GENERIC_PER_DESIGN) {
        errors.push(`generic design ${id}: max ${MAX_GENERIC_PER_DESIGN} copies per kennel`);
      }
    }

    const describe = describeGameCard(card);
    const gt = describe.gameType;
    gameTypeCounts[gt] = (gameTypeCounts[gt] ?? 0) + 1;
    if (gt === 'pup') pupCount++;
    else supportCount++;

    // mythic-class = any card whose rarityGroup is 'mythic' (true
    // mythic Spaniels OR mythic-insert anomalies). A true mythic
    // Spaniel counts toward the pup pool AND the mythic-class cap.
    if (rarityGroup === 'mythic') mythicClassCount++;
  }

  if (pupCount < fmt.minPup) {
    errors.push(`format ${fmt.id} requires at least ${fmt.minPup} Pup cards (got ${pupCount})`);
  }
  if (supportCount > fmt.maxSupport) {
    errors.push(`format ${fmt.id} allows at most ${fmt.maxSupport} support cards (got ${supportCount})`);
  }
  if (mythicClassCount > fmt.maxMythicClass) {
    errors.push(`format ${fmt.id} allows at most ${fmt.maxMythicClass} mythic-class cards (got ${mythicClassCount})`);
  }
  if (typeof fmt.requireMythicClassMin === 'number' && mythicClassCount < fmt.requireMythicClassMin) {
    errors.push(`format ${fmt.id} requires at least ${fmt.requireMythicClassMin} mythic-class cards (got ${mythicClassCount})`);
  }
  for (const [gt, minCount] of Object.entries(fmt.requireGameTypeMin || {})) {
    const have = gameTypeCounts[gt] ?? 0;
    if (have < minCount) {
      errors.push(`format ${fmt.id} requires at least ${minCount} ${gt} cards (got ${have})`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    summary: {
      total: cards.length,
      pupCount,
      supportCount,
      mythicClassCount,
      gameTypeCounts,
      uniqueCardKeys: byKey.size,
      formatId: fmt.id
    }
  };
}
