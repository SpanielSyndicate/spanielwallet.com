// Spaniel Showdown — lineup-eligibility filter.
//
// Pure JS: take /api/binder/:wallet/cards rows and turn them into
// engine-ready lineup cards (cardKey + cardClass + variant +
// abilityId + displayStats). Anything sealed, unparseable, or whose
// stats can't be derived is dropped.
//
// Shared between the PWA picker (browser, absolute imports) and the
// node tests (Node, relative imports). The picker mount lives in
// js/spaniel-wallet/keeps-lineup-picker.js.

import { parseCardKey } from './card-key.js';
import { deriveCardStats } from './showdown-stats.js';
import { abilityIdForCard } from './showdown-cards.js';

// Variants we never accept as lineup entries. Sealed-product wrappers
// (pack/box/crate/vault) live in their own tables and never appear in
// /api/binder/:wallet/cards, but we belt-and-brace anyway.
const SEALED_VARIANT_RE = /sealed|pack|box|crate|vault/i;

/**
 * Turn /api/binder rows into engine-ready cards. Drops sealed rows,
 * unparseable card keys, and anything whose displayStats cannot be
 * derived.
 *
 * @param {Array<object>|null|undefined} rows
 * @returns {Array<object>}
 */
export function filterEligibleCards(rows) {
  const out = [];
  for (const row of rows || []) {
    if (!row || typeof row.card_key !== 'string') continue;
    const variant = String(row.variant || '');
    if (SEALED_VARIANT_RE.test(variant)) continue;
    const parsed = parseCardKey(row.card_key);
    if (!parsed) continue;
    let stats;
    try {
      stats = deriveCardStats({ ...parsed, cardKey: row.card_key });
    } catch {
      continue;
    }
    if (!stats?.displayStats) continue;
    const abilityId = abilityIdForCard({ ...parsed, cardKey: row.card_key });
    out.push({
      cardKey: row.card_key,
      cardClass: parsed.cardClass,
      variant: parsed.variant,
      dogId: parsed.dogId,
      serial: parsed.serial,
      abilityId: abilityId || null,
      displayStats: { ...stats.displayStats },
      isMythic: !!row.is_mythic
    });
  }
  return out;
}

export { SEALED_VARIANT_RE };
