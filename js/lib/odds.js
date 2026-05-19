// Spaniel Syndicate — pack/box/crate pull odds.
//
// Static odds derived from the fixed Series 1 print run (1B cards).
// Includes:
//   - generic commons (per-variant 'generic', 690,139,312 total)
//   - standard Spaniel variants (base, bronze, …, black)
//   - mythic-class hits (true mythic + insert)
//
// Approximation: with replacement / Poisson approximation.
//   p_perCard(variant) = variantTotal / TOTAL_CARD_SUPPLY
//   P(≥1 variant in N draws) ≈ 1 - (1 - p)^N
// At Series 1 scale (1B cards), the with/without-replacement
// difference is well below USD-precision for every product size.
//
// NOTE: odds are not guarantees. Until guaranteed-collation slots are
// implemented and audited, boxes/crates have BETTER odds by volume,
// not guaranteed hits. Copy must say "odds" — not "guaranteed".

import {
  TOTAL_CARD_SUPPLY,
  VARIANTS,
  VARIANT_SLUGS,
  RARITY_GROUPS,
  CARD_CLASSES,
  GENERIC_COMMON_TOTAL,
  STANDARD_CARD_TOTAL,
  TRUE_MYTHIC_COUNT,
  MYTHIC_INSERT_COUNT,
  isValidVariantSlug
} from './series1.js';

/**
 * Per-variant per-single-card probability under the initial print run.
 * @returns {Record<string, number>}
 */
export function perVariantProbability() {
  const out = {};
  for (const slug of VARIANT_SLUGS) {
    out[slug] = VARIANTS[slug].total / TOTAL_CARD_SUPPLY;
  }
  return out;
}

/**
 * Per-rarity-group per-single-card probability.
 * @returns {Record<string, number>}
 */
export function perRarityGroupProbability() {
  const perVar = perVariantProbability();
  const out = {};
  for (const [group, slugs] of Object.entries(RARITY_GROUPS)) {
    out[group] = slugs.reduce((acc, slug) => acc + (perVar[slug] ?? 0), 0);
  }
  return out;
}

/**
 * Per-card-class probability under the initial print run.
 * @returns {Record<string, number>}
 */
export function perCardClassProbability() {
  return {
    generic_common: GENERIC_COMMON_TOTAL / TOTAL_CARD_SUPPLY,
    standard_spaniel: STANDARD_CARD_TOTAL / TOTAL_CARD_SUPPLY,
    true_mythic_spaniel: TRUE_MYTHIC_COUNT / TOTAL_CARD_SUPPLY,
    mythic_insert: MYTHIC_INSERT_COUNT / TOTAL_CARD_SUPPLY
  };
}

export function atLeastOneVariantInDraws(variantSlug, n) {
  if (!isValidVariantSlug(variantSlug)) {
    throw new Error(`invalid variant: ${variantSlug}`);
  }
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`n must be a non-negative integer, got ${n}`);
  }
  if (n === 0) return 0;
  const p = VARIANTS[variantSlug].total / TOTAL_CARD_SUPPLY;
  return 1 - Math.pow(1 - p, n);
}

export function atLeastOneRarityGroupInDraws(group, n) {
  if (!RARITY_GROUPS[group]) throw new Error(`invalid rarity group: ${group}`);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`n must be a non-negative integer, got ${n}`);
  }
  if (n === 0) return 0;
  const slugs = RARITY_GROUPS[group];
  const totalForGroup = slugs.reduce((acc, slug) => acc + VARIANTS[slug].total, 0);
  const p = totalForGroup / TOTAL_CARD_SUPPLY;
  return 1 - Math.pow(1 - p, n);
}

export function expectedVariantInDraws(variantSlug, n) {
  if (!isValidVariantSlug(variantSlug)) {
    throw new Error(`invalid variant: ${variantSlug}`);
  }
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`n must be a non-negative integer, got ${n}`);
  }
  return (VARIANTS[variantSlug].total / TOTAL_CARD_SUPPLY) * n;
}

/**
 * Full odds summary for a product opening of `drawCount` cards.
 */
export function oddsSummaryForDraws(drawCount) {
  if (!Number.isInteger(drawCount) || drawCount < 1) {
    throw new Error(`drawCount must be a positive integer, got ${drawCount}`);
  }
  const perVariant = {};
  for (const slug of VARIANT_SLUGS) {
    const total = VARIANTS[slug].total;
    const p = total / TOTAL_CARD_SUPPLY;
    perVariant[slug] = {
      probability: p,
      atLeastOne: 1 - Math.pow(1 - p, drawCount),
      expected: p * drawCount
    };
  }
  const perRarityGroup = {};
  for (const [group, slugs] of Object.entries(RARITY_GROUPS)) {
    const total = slugs.reduce((acc, slug) => acc + VARIANTS[slug].total, 0);
    const p = total / TOTAL_CARD_SUPPLY;
    perRarityGroup[group] = {
      probability: p,
      atLeastOne: 1 - Math.pow(1 - p, drawCount),
      expected: p * drawCount
    };
  }
  const classTotals = {
    generic_common: GENERIC_COMMON_TOTAL,
    standard_spaniel: STANDARD_CARD_TOTAL,
    true_mythic_spaniel: TRUE_MYTHIC_COUNT,
    mythic_insert: MYTHIC_INSERT_COUNT
  };
  const perCardClass = {};
  for (const k of CARD_CLASSES) {
    const total = classTotals[k];
    const p = total / TOTAL_CARD_SUPPLY;
    perCardClass[k] = {
      probability: p,
      atLeastOne: 1 - Math.pow(1 - p, drawCount),
      expected: p * drawCount
    };
  }
  return { drawCount, perVariant, perRarityGroup, perCardClass };
}

export function remainingAdjustedProbability(variantSlug, remaining) {
  if (!isValidVariantSlug(variantSlug)) {
    throw new Error(`invalid variant: ${variantSlug}`);
  }
  if (!remaining || typeof remaining !== 'object') {
    throw new Error('remaining inventory map required');
  }
  let totalRemaining = 0;
  for (const slug of VARIANT_SLUGS) {
    const r = Number(remaining[slug] ?? 0);
    if (!Number.isInteger(r) || r < 0) {
      throw new Error(`remaining[${slug}] must be a non-negative integer, got ${r}`);
    }
    totalRemaining += r;
  }
  if (totalRemaining <= 0) return 0;
  const r = Number(remaining[variantSlug] ?? 0);
  return r / totalRemaining;
}

export function formatOddsSummary(summary) {
  const fmtPct = (p) => {
    if (p === 0) return '0.0000%';
    if (p < 0.01) {
      return `${(p * 100).toFixed(6)}%`;
    }
    return `${(p * 100).toFixed(4)}%`;
  };
  const fmt = (v) => ({
    probability: fmtPct(v.probability),
    atLeastOne: fmtPct(v.atLeastOne),
    expected: v.expected.toFixed(4)
  });
  const perVariant = {};
  for (const [k, v] of Object.entries(summary.perVariant)) {
    perVariant[k] = fmt(v);
  }
  const perRarityGroup = {};
  for (const [k, v] of Object.entries(summary.perRarityGroup)) {
    perRarityGroup[k] = fmt(v);
  }
  const perCardClass = {};
  for (const [k, v] of Object.entries(summary.perCardClass ?? {})) {
    perCardClass[k] = fmt(v);
  }
  return { drawCount: summary.drawCount, perVariant, perRarityGroup, perCardClass };
}
