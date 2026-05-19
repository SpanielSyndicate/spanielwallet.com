// Spaniel Syndicate — standing offer predicate matching.
//
// Standing offers can be placed on cards that have not yet been minted
// or revealed. An offer carries a predicate: a JSON object describing
// the set of card instances the offer is willing to accept.
//
// Predicates are validated server-side; only the documented fields are
// honoured. Unknown fields raise a validation error to prevent silent
// drift.
//
// Match semantics:
//   - If `exactCardKey` is set, no other criteria are evaluated — a
//     card matches iff its key equals exactly.
//   - Otherwise, every defined predicate field must agree with the
//     card. Undefined predicate fields are wildcards.
//   - `seriesId` is required to scope the offer to a specific series.
//   - `onlyUnminted` is a display/filter hint, NOT a match criterion.
//     Once a matching card is minted, the offer remains acceptable.

import {
  SERIES_ID,
  VARIANTS,
  VARIANT_SLUGS,
  RARITY_GROUPS,
  HOLIDAY_STAMPS,
  PLATE_COLORS,
  isValidDogId,
  isValidVariantSlug,
  isMythicDogId,
  isValidStampType,
  isValidPlateColor
} from './series1.js';
import { isValidCardKey, parseCardKey } from './card-key.js';

// ────────────────────────────────────────────────────────────────────
// Variant rank — 1 = most common, 12 = rarest.
// ────────────────────────────────────────────────────────────────────
//
// Used by minVariantRank/maxVariantRank predicates. Ranking is by
// fixed initial print count (lower count == rarer == higher rank).
// Ties are broken alphabetically so the table is deterministic.

export const VARIANT_RANK = (() => {
  const sorted = [...VARIANT_SLUGS].sort((a, b) => {
    const da = VARIANTS[a].total - VARIANTS[b].total;
    if (da !== 0) return -da; // larger total → lower rank
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const out = {};
  sorted.forEach((slug, i) => {
    out[slug] = i + 1;
  });
  return Object.freeze(out);
})();

export const MIN_VARIANT_RANK = 1;
export const MAX_VARIANT_RANK = VARIANT_SLUGS.length;

const ALLOWED_PREDICATE_KEYS = new Set([
  'seriesId',
  'dogId',
  'variant',
  'rarityGroup',
  'serialNumber',
  'printCount',
  'stampType',
  'plateColor',
  'isMythic',
  'exactCardKey',
  'minVariantRank',
  'maxVariantRank',
  'onlyUnminted'
]);

// ────────────────────────────────────────────────────────────────────
// Predicate validation
// ────────────────────────────────────────────────────────────────────

/**
 * Validate a predicate. Throws on any violation. Returns the normalized
 * predicate (unknown keys removed; numeric fields coerced).
 *
 * @param {object} predicate
 * @returns {object}
 */
export function validateOfferPredicate(predicate) {
  if (!predicate || typeof predicate !== 'object') {
    throw new Error('predicate must be an object');
  }
  for (const k of Object.keys(predicate)) {
    if (!ALLOWED_PREDICATE_KEYS.has(k)) {
      throw new Error(`unknown predicate key: ${k}`);
    }
  }
  if (predicate.seriesId !== SERIES_ID) {
    throw new Error(`predicate seriesId must be "${SERIES_ID}", got ${predicate.seriesId}`);
  }

  const out = { seriesId: SERIES_ID };

  if (predicate.exactCardKey !== undefined) {
    if (!isValidCardKey(predicate.exactCardKey)) {
      throw new Error(`predicate exactCardKey invalid: ${predicate.exactCardKey}`);
    }
    out.exactCardKey = predicate.exactCardKey;
    // exactCardKey supersedes other fields, but we still record the
    // implied dogId/variant for indexing.
    const parsed = parseCardKey(predicate.exactCardKey);
    out.dogId = parsed.dogId;
    out.variant = parsed.variant;
    out.serialNumber = parsed.serial;
    if (parsed.stampType) out.stampType = parsed.stampType;
    if (parsed.plateColor) out.plateColor = parsed.plateColor;
    out.isMythic = parsed.mythic;
    return out;
  }

  if (predicate.dogId !== undefined) {
    if (!isValidDogId(predicate.dogId)) {
      throw new Error(`predicate dogId invalid: ${predicate.dogId}`);
    }
    out.dogId = Number(predicate.dogId);
  }
  if (predicate.variant !== undefined) {
    if (!isValidVariantSlug(predicate.variant)) {
      throw new Error(`predicate variant invalid: ${predicate.variant}`);
    }
    out.variant = predicate.variant;
  }
  if (predicate.rarityGroup !== undefined) {
    if (!RARITY_GROUPS[predicate.rarityGroup]) {
      throw new Error(`predicate rarityGroup invalid: ${predicate.rarityGroup}`);
    }
    out.rarityGroup = predicate.rarityGroup;
  }
  if (predicate.serialNumber !== undefined) {
    const s = Number(predicate.serialNumber);
    if (!Number.isInteger(s) || s < 1) {
      throw new Error(`predicate serialNumber must be a positive integer, got ${predicate.serialNumber}`);
    }
    out.serialNumber = s;
  }
  if (predicate.printCount !== undefined) {
    const pc = Number(predicate.printCount);
    if (!Number.isInteger(pc) || pc < 1) {
      throw new Error(`predicate printCount must be a positive integer, got ${predicate.printCount}`);
    }
    out.printCount = pc;
  }
  if (predicate.stampType !== undefined) {
    if (!isValidStampType(predicate.stampType)) {
      throw new Error(`predicate stampType invalid: ${predicate.stampType}`);
    }
    out.stampType = predicate.stampType;
  }
  if (predicate.plateColor !== undefined) {
    if (!isValidPlateColor(predicate.plateColor)) {
      throw new Error(`predicate plateColor invalid: ${predicate.plateColor}`);
    }
    out.plateColor = predicate.plateColor;
  }
  if (predicate.isMythic !== undefined) {
    if (typeof predicate.isMythic !== 'boolean') {
      throw new Error(`predicate isMythic must be boolean, got ${typeof predicate.isMythic}`);
    }
    out.isMythic = predicate.isMythic;
  }
  if (predicate.minVariantRank !== undefined) {
    const r = Number(predicate.minVariantRank);
    if (!Number.isInteger(r) || r < MIN_VARIANT_RANK || r > MAX_VARIANT_RANK) {
      throw new Error(`predicate minVariantRank must be in [${MIN_VARIANT_RANK}, ${MAX_VARIANT_RANK}], got ${predicate.minVariantRank}`);
    }
    out.minVariantRank = r;
  }
  if (predicate.maxVariantRank !== undefined) {
    const r = Number(predicate.maxVariantRank);
    if (!Number.isInteger(r) || r < MIN_VARIANT_RANK || r > MAX_VARIANT_RANK) {
      throw new Error(`predicate maxVariantRank must be in [${MIN_VARIANT_RANK}, ${MAX_VARIANT_RANK}], got ${predicate.maxVariantRank}`);
    }
    out.maxVariantRank = r;
  }
  if (out.minVariantRank !== undefined && out.maxVariantRank !== undefined) {
    if (out.minVariantRank > out.maxVariantRank) {
      throw new Error(`minVariantRank ${out.minVariantRank} > maxVariantRank ${out.maxVariantRank}`);
    }
  }
  if (predicate.onlyUnminted !== undefined) {
    if (typeof predicate.onlyUnminted !== 'boolean') {
      throw new Error(`predicate onlyUnminted must be boolean, got ${typeof predicate.onlyUnminted}`);
    }
    out.onlyUnminted = predicate.onlyUnminted;
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
// Match
// ────────────────────────────────────────────────────────────────────

/**
 * Canonical card descriptor used by matchOffer.
 *
 * Shape:
 *   {
 *     seriesId: 's1',
 *     dogId: number,
 *     variant: string,
 *     serial: number,
 *     printCount: number,
 *     stampType: string|null,
 *     plateColor: string|null,
 *     mythic: boolean,
 *     cardKey: string
 *   }
 *
 * Helper to construct one from a parseCardKey result is below.
 */

export function cardFromKey(key) {
  const parsed = parseCardKey(key);
  if (!parsed) throw new Error(`invalid card key: ${key}`);
  return {
    seriesId: parsed.seriesId,
    dogId: parsed.dogId,
    variant: parsed.variant,
    serial: parsed.serial,
    printCount: parsed.printCount,
    stampType: parsed.stampType,
    plateColor: parsed.plateColor,
    mythic: parsed.mythic,
    cardKey: key
  };
}

/**
 * Does `card` satisfy `predicate`?
 *
 * @param {object} card
 * @param {object} predicate — already-validated predicate
 * @returns {boolean}
 */
export function matchOffer(card, predicate) {
  if (!card || typeof card !== 'object') return false;
  if (!predicate || typeof predicate !== 'object') return false;
  if (card.seriesId !== predicate.seriesId) return false;

  if (predicate.exactCardKey !== undefined) {
    return card.cardKey === predicate.exactCardKey;
  }

  if (predicate.dogId !== undefined && card.dogId !== predicate.dogId) return false;
  if (predicate.variant !== undefined && card.variant !== predicate.variant) return false;
  if (predicate.rarityGroup !== undefined) {
    const slugs = RARITY_GROUPS[predicate.rarityGroup];
    if (!slugs || !slugs.includes(card.variant)) return false;
  }
  if (predicate.serialNumber !== undefined && card.serial !== predicate.serialNumber) return false;
  if (predicate.printCount !== undefined && card.printCount !== predicate.printCount) return false;
  if (predicate.stampType !== undefined && card.stampType !== predicate.stampType) return false;
  if (predicate.plateColor !== undefined && card.plateColor !== predicate.plateColor) return false;
  if (predicate.isMythic !== undefined && card.mythic !== predicate.isMythic) return false;
  if (predicate.minVariantRank !== undefined) {
    const r = VARIANT_RANK[card.variant];
    if (r === undefined || r < predicate.minVariantRank) return false;
  }
  if (predicate.maxVariantRank !== undefined) {
    const r = VARIANT_RANK[card.variant];
    if (r === undefined || r > predicate.maxVariantRank) return false;
  }
  return true;
}

/**
 * Human-readable summary of the predicate. Used for display in
 * marketplace listings and offer history rows.
 *
 * @param {object} predicate
 * @returns {string}
 */
export function describePredicate(predicate) {
  if (predicate.exactCardKey) return `exact: ${predicate.exactCardKey}`;
  const parts = [];
  if (predicate.dogId !== undefined) {
    parts.push(`dog #${predicate.dogId}${isMythicDogId(predicate.dogId) ? ' (mythic)' : ''}`);
  }
  if (predicate.variant !== undefined) {
    parts.push(`variant ${VARIANTS[predicate.variant]?.label ?? predicate.variant}`);
  }
  if (predicate.rarityGroup !== undefined) parts.push(`${predicate.rarityGroup} tier`);
  if (predicate.serialNumber !== undefined) parts.push(`serial #${predicate.serialNumber}`);
  if (predicate.stampType !== undefined) parts.push(`${predicate.stampType} stamp`);
  if (predicate.plateColor !== undefined) parts.push(`${predicate.plateColor} plate`);
  if (predicate.isMythic !== undefined) parts.push(predicate.isMythic ? 'mythic only' : 'non-mythic');
  if (predicate.minVariantRank !== undefined || predicate.maxVariantRank !== undefined) {
    const min = predicate.minVariantRank ?? MIN_VARIANT_RANK;
    const max = predicate.maxVariantRank ?? MAX_VARIANT_RANK;
    parts.push(`variant rank ${min}..${max}`);
  }
  if (parts.length === 0) return `any card in series ${predicate.seriesId}`;
  return parts.join(', ');
}

// Inventory totals supported by a predicate. Useful for showing
// "covers N possible cards" on offer creation. Returns an upper-bound
// estimate (assumes all serials match if the predicate doesn't pin one).
export function predicateCoverageEstimate(predicate) {
  if (predicate.exactCardKey) return 1;
  let total = 0;
  for (const slug of VARIANT_SLUGS) {
    const v = VARIANTS[slug];
    if (predicate.variant !== undefined && predicate.variant !== slug) continue;
    if (predicate.rarityGroup !== undefined) {
      const slugs = RARITY_GROUPS[predicate.rarityGroup];
      if (!slugs.includes(slug)) continue;
    }
    if (predicate.isMythic !== undefined) {
      const variantIsMythicClass = slug === 'mythic' || slug === 'mythic_insert';
      if (predicate.isMythic !== variantIsMythicClass) continue;
    }
    const rank = VARIANT_RANK[slug];
    if (predicate.minVariantRank !== undefined && rank < predicate.minVariantRank) continue;
    if (predicate.maxVariantRank !== undefined && rank > predicate.maxVariantRank) continue;

    let variantTotal = v.total;

    // Stamp/plate narrow only apply to those variants.
    if (predicate.stampType !== undefined) {
      if (slug !== 'holiday') continue;
      variantTotal = variantTotal / HOLIDAY_STAMPS.length;
    }
    if (predicate.plateColor !== undefined) {
      if (slug !== 'plate') continue;
      variantTotal = variantTotal / PLATE_COLORS.length;
    }

    // dogId narrowing: only standard_spaniel + true_mythic_spaniel variants
    // are tied to a dogId. Mythic inserts and generic commons have no
    // dogId, so a dogId predicate excludes them entirely.
    if (predicate.dogId !== undefined) {
      if (v.cardClass === 'generic_common' || v.cardClass === 'mythic_insert') continue;
      const dogIsMythic = isMythicDogId(predicate.dogId);
      const variantIsTrueMythic = v.cardClass === 'true_mythic_spaniel';
      if (variantIsTrueMythic !== dogIsMythic) continue;
      variantTotal = variantIsTrueMythic ? 1 : v.perStandardDog;
      if (predicate.stampType !== undefined) variantTotal = 1;
      if (predicate.plateColor !== undefined) variantTotal = 1;
    }
    // serial narrows to 1 (assuming serial valid).
    if (predicate.serialNumber !== undefined) variantTotal = Math.min(variantTotal, 1);
    total += variantTotal;
  }
  return Math.floor(total);
}
