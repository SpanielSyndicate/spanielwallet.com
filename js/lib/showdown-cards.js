// Spaniel Showdown — card-level game classification.
//
// Wraps deriveCardStats with the canonical gameType, ability id, and
// support effect id (for non-Pup gameTypes). Used by the renderer,
// the deck validator, and the engine round resolver.
//
// Abilities + effects are deterministic from card identity. The lore
// names below are intentionally short — the full ability rules live
// in showdown-effects.js.

import { deriveCardStats, gameTypeForCard } from './showdown-stats.js';
import { getVariant, isValidCardClass } from './series1.js';

export const SHOWDOWN_CARDS_VERSION = 'showdown-cards-v1';

// ─────────────────────────────────────────────────────────────────────
// Ability registry (Pup + Anomaly)
// ─────────────────────────────────────────────────────────────────────
//
// Pup abilities scale with the dog's rarityGroup. Anomaly (mythic-
// insert) abilities are wholly unique: the ability id includes the
// insertId so each of the 351 inserts can carry its own rules text
// (stored in the manifest at generation time).

const PUP_ABILITY_BY_RARITY = Object.freeze({
  common:   'bonus.bark',
  uncommon: 'shield.morale',
  rare:     'critical.zoom',
  ultra:    'rebound.heart',
  mythic:   'mythic.aura'
});

// ─────────────────────────────────────────────────────────────────────
// Support effect registry (Trick / Toy / Treat / Gear / Rescue)
// ─────────────────────────────────────────────────────────────────────
//
// Generic commons are spread across the 5 non-Pup, non-Anomaly types
// by `(genericDesignId - 1) % 5`. The effect id is derived from
// genericDesignId; the rules text lives in showdown-effects.js.

export function effectIdForGenericDesign(genericDesignId) {
  const id = Number(genericDesignId);
  if (!Number.isInteger(id) || id < 1) return null;
  const gameType = ['trick', 'toy', 'treat', 'gear', 'rescue'][(id - 1) % 5];
  const slot = ((id - 1) / 5 | 0) % EFFECT_SLOTS[gameType].length;
  return `${gameType}.${EFFECT_SLOTS[gameType][slot]}`;
}

const EFFECT_SLOTS = Object.freeze({
  trick: ['feint', 'misdirect', 'snap', 'fakeout'],
  toy:   ['squeak', 'fetch', 'spin', 'tug'],
  treat: ['biscuit', 'jerky', 'kibble', 'gravy'],
  gear:  ['collar', 'leash', 'tag', 'harness'],
  rescue:['paw', 'patch', 'shelter', 'rally']
});

// ─────────────────────────────────────────────────────────────────────
// Public surface
// ─────────────────────────────────────────────────────────────────────

export function abilityIdForCard(cardMeta) {
  const cls = cardMeta.cardClass;
  if (cls === 'standard_spaniel' || cls === 'true_mythic_spaniel') {
    const rarityGroup = getVariant(cardMeta.variant).rarityGroup;
    return PUP_ABILITY_BY_RARITY[rarityGroup] || 'pup.basic';
  }
  if (cls === 'mythic_insert') {
    const id = Number(cardMeta.mythicInsertId);
    return `anomaly.insert.${String(id).padStart(3, '0')}`;
  }
  if (cls === 'generic_common') {
    return effectIdForGenericDesign(cardMeta.genericDesignId);
  }
  throw new Error(`unknown cardClass: ${cls}`);
}

export function gameRoleForCard(cardMeta) {
  return gameTypeForCard(cardMeta);
}

/**
 * Full game-card descriptor used by the renderer + engine.
 */
export function describeGameCard(cardMeta) {
  if (!isValidCardClass(cardMeta.cardClass)) {
    throw new Error(`invalid cardClass: ${cardMeta.cardClass}`);
  }
  const stats = deriveCardStats(cardMeta);
  return {
    version: SHOWDOWN_CARDS_VERSION,
    cardKey: cardMeta.cardKey,
    cardClass: cardMeta.cardClass,
    variant: cardMeta.variant,
    rarityGroup: stats.rarityGroup,
    gameType: stats.gameType,
    abilityId: abilityIdForCard(cardMeta),
    stats: {
      combat: stats.combat,
      support: stats.support,
      derived: stats.derived
    },
    displayStats: stats.displayStats
  };
}

export {
  EFFECT_SLOTS,
  PUP_ABILITY_BY_RARITY
};
