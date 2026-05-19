// Spaniel Syndicate — card → game stats facade.
//
// Thin shim that the renderer + the PWA pages import so they don't
// have to know about the showdown-stats internals. Returns a normal-
// ized stat block plus a one-line "ability line" for the card-back
// stats panel.
//
// The ability-line text comes from the canonical For Keeps ability
// registry (`showdown-keeps-abilities.js`). Keeping the text in one
// place means the visible card-back line cannot drift away from the
// engine's actual behavior.

import { deriveCardStats } from './showdown-stats.js';
import { describeGameCard, abilityIdForCard, gameRoleForCard } from './showdown-cards.js';
import { getSupportEffect, getPupAbility } from './showdown-effects.js';
import { getKeepsAbility, isMythicInsertAbilityId } from './showdown-keeps-abilities.js';

export function abilityLineFor(abilityId) {
  if (typeof abilityId !== 'string') return '';
  const entry = getKeepsAbility(abilityId);
  if (entry) return entry.text || '';
  if (isMythicInsertAbilityId(abilityId)) {
    // Defensive fallback — getKeepsAbility already handles inserts.
    return `Mythic Insert #${abilityId.replace('anomaly.insert.', '')} — unique 1/1 card.`;
  }
  return '';
}

export function gameStatsFor(parsed) {
  const desc = describeGameCard(parsed);
  const abilityId = abilityIdForCard(parsed);
  return {
    gameType: gameRoleForCard(parsed),
    abilityId,
    abilityLine: abilityLineFor(abilityId),
    stats: desc.stats,
    displayStats: desc.displayStats,
    rarityGroup: desc.rarityGroup
  };
}

export { deriveCardStats, describeGameCard, abilityIdForCard };
