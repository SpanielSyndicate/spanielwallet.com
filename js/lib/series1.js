// Spaniel Syndicate — Series 1 print run.
//
// Single source of truth for the fixed Series 1 card release.
// Imported by the public frontend (for display) and by the
// Cloudflare Worker (for signed-quote settlement, manifest
// validation, and offer matching).
//
// Print run (locked 2026-05-17):
//   69,420 canonical Spaniel checklist identities.
//      69   true mythic Spaniel identities (1/1 custom-art only).
//      69,351 standard Spaniel identities (4,468 cards each).
//   420  mythic-class 1/1 hits in total:
//      69  true mythic Spaniels (above) +
//      351 mythic-class insert/relic/anomaly 1/1 cards (no dogId).
//   420  generic common designs (Dog Treat, Tennis Ball, etc.):
//      352 designs print 1,643,189 copies each
//      68  designs print 1,643,188 copies each
//      → 690,139,312 generic commons total.
//
// Grand total:
//   690,139,312 generic commons
// + 309,860,268 standard Spaniel cards
// +       420   mythic-class 1/1 hits
// = 1,000,000,000 Series 1 card NFTs.
//
// Sealed products (Pack/Box/Crate/Vault) are wrappers; they do NOT
// inflate the fixed card supply. Each draw slot maps to exactly one
// underlying card NFT.
//
// `MYTHIC_DOG_IDS` lists the 49 mythic identities that already have
// finalized custom art/lore. The remaining 20 true mythic slots
// (TRUE_MYTHIC_COUNT - existingMythicCount) must be supplied before
// final manifest generation. Dev mode tolerates the placeholder gap.

import { ELABORATE_VISUAL_IDS } from './elaborate-ids.js';

// ────────────────────────────────────────────────────────────────────
// Identity & supply
// ────────────────────────────────────────────────────────────────────

export const SERIES_ID = 's1';
export const CANONICAL_DOG_COUNT = 69_420;

// True mythic Spaniels (1/1 custom-art, no parallels).
export const TRUE_MYTHIC_COUNT = 69;
export const EXISTING_MYTHIC_COUNT = 49; // currently authored mythics
export const ADDITIONAL_MYTHICS_REQUIRED = TRUE_MYTHIC_COUNT - EXISTING_MYTHIC_COUNT; // 20

// Mythic-class insert/relic/anomaly 1/1 hits not tied to a dogId.
export const MYTHIC_INSERT_COUNT = 351;
// Total mythic-class 1/1s (true mythics + inserts).
export const TOTAL_MYTHIC_CLASS_COUNT = TRUE_MYTHIC_COUNT + MYTHIC_INSERT_COUNT; // 420

export const STANDARD_DOG_COUNT = CANONICAL_DOG_COUNT - TRUE_MYTHIC_COUNT; // 69,351
export const CARDS_PER_STANDARD_DOG = 4_468;
export const CARDS_PER_MYTHIC_DOG = 1;
export const STANDARD_CARD_TOTAL = STANDARD_DOG_COUNT * CARDS_PER_STANDARD_DOG; // 309,860,268

// Generic common designs (Dog Treat, Tennis Ball, etc.).
export const GENERIC_DESIGN_COUNT = 420;
export const GENERIC_HIGH_DESIGN_COUNT = 352;       // print 1,643,189 copies each
export const GENERIC_LOW_DESIGN_COUNT  = 68;        // print 1,643,188 copies each
export const GENERIC_HIGH_PRINTS_PER_DESIGN = 1_643_189;
export const GENERIC_LOW_PRINTS_PER_DESIGN  = 1_643_188;
export const GENERIC_COMMON_TOTAL =
  GENERIC_HIGH_DESIGN_COUNT * GENERIC_HIGH_PRINTS_PER_DESIGN +
  GENERIC_LOW_DESIGN_COUNT  * GENERIC_LOW_PRINTS_PER_DESIGN; // 690,139,312

export const TOTAL_CARD_SUPPLY = 1_000_000_000;
export const TOTAL_DRAW_SLOTS = TOTAL_CARD_SUPPLY;

// The 49 mythic identities currently authored. The Series 1 product
// is locked at TRUE_MYTHIC_COUNT (69); the remaining 20 must be added
// before final manifest generation will succeed.
export const MYTHIC_DOG_IDS = Object.freeze(
  [...ELABORATE_VISUAL_IDS].sort((a, b) => a - b)
);
const MYTHIC_SET = new Set(MYTHIC_DOG_IDS);

// ────────────────────────────────────────────────────────────────────
// Card class taxonomy
// ────────────────────────────────────────────────────────────────────
//
// Every card belongs to exactly one class:
//   generic_common      — repeated common card, no dogId.
//   standard_spaniel    — 1 of 69,351 standard dogs, has variant + serial.
//   true_mythic_spaniel — 1 of 69 true mythic dogs, 1/1 custom art.
//   mythic_insert       — 1 of 351 mythic-class insert/relic/anomaly 1/1s.

export const CARD_CLASSES = Object.freeze([
  'generic_common',
  'standard_spaniel',
  'true_mythic_spaniel',
  'mythic_insert'
]);

export function isValidCardClass(c) {
  return typeof c === 'string' && CARD_CLASSES.includes(c);
}

// ────────────────────────────────────────────────────────────────────
// Holiday stamps & printing plates
// ────────────────────────────────────────────────────────────────────

export const HOLIDAY_STAMPS = Object.freeze([
  'valentine',
  'spring',
  'solana_summer',
  'halloween',
  'winter',
  'new_year'
]);

export const PLATE_COLORS = Object.freeze(['cyan', 'magenta', 'yellow', 'key']);

// ────────────────────────────────────────────────────────────────────
// Rarity groups
// ────────────────────────────────────────────────────────────────────

export const RARITY_GROUPS = Object.freeze({
  common:    Object.freeze(['generic', 'base', 'bronze']),
  uncommon:  Object.freeze(['silver', 'refractor', 'holo', 'holiday', 'sparkle']),
  rare:      Object.freeze(['plate', 'gold']),
  ultra:     Object.freeze(['error', 'black']),
  mythic:    Object.freeze(['mythic', 'mythic_insert'])
});

// ────────────────────────────────────────────────────────────────────
// Variant catalog
// ────────────────────────────────────────────────────────────────────
//
// Per-standard-dog totals (locked):
//   3,812 base + 420 bronze + 100 silver + 69 refractor + 42 holo
//     + 6 holiday (one per stamp) + 10 sparkle + 4 plate (one per color)
//     + 3 gold + 1 error + 1 black = 4,468 cards/dog.

export const VARIANTS = Object.freeze({
  generic: Object.freeze({
    slug: 'generic',
    label: 'Generic Common',
    perStandardDog: 0,
    perGenericDesign: null,        // varies per design (1,643,188 or 1,643,189)
    total: GENERIC_COMMON_TOTAL,   // 690,139,312
    rarityGroup: 'common',
    serialMode: 'genericSerial',
    cardClass: 'generic_common',
    standard: false,
    mythicOnly: false
  }),
  base: Object.freeze({
    slug: 'base',
    label: 'Base',
    perStandardDog: 3_812,
    total: 3_812 * STANDARD_DOG_COUNT,
    rarityGroup: 'common',
    serialMode: 'single',
    cardClass: 'standard_spaniel',
    standard: true,
    mythicOnly: false
  }),
  bronze: Object.freeze({
    slug: 'bronze',
    label: 'Bronze',
    perStandardDog: 420,
    total: 420 * STANDARD_DOG_COUNT,
    rarityGroup: 'common',
    serialMode: 'single',
    cardClass: 'standard_spaniel',
    standard: true,
    mythicOnly: false
  }),
  silver: Object.freeze({
    slug: 'silver',
    label: 'Silver',
    perStandardDog: 100,
    total: 100 * STANDARD_DOG_COUNT,
    rarityGroup: 'uncommon',
    serialMode: 'single',
    cardClass: 'standard_spaniel',
    standard: true,
    mythicOnly: false
  }),
  refractor: Object.freeze({
    slug: 'refractor',
    label: 'Rainbow Refractor',
    perStandardDog: 69,
    total: 69 * STANDARD_DOG_COUNT,
    rarityGroup: 'uncommon',
    serialMode: 'single',
    cardClass: 'standard_spaniel',
    standard: true,
    mythicOnly: false
  }),
  holo: Object.freeze({
    slug: 'holo',
    label: 'Holo',
    perStandardDog: 42,
    total: 42 * STANDARD_DOG_COUNT,
    rarityGroup: 'uncommon',
    serialMode: 'single',
    cardClass: 'standard_spaniel',
    standard: true,
    mythicOnly: false
  }),
  holiday: Object.freeze({
    slug: 'holiday',
    label: 'Holiday Stamp',
    perStandardDog: 6,
    total: 6 * STANDARD_DOG_COUNT,
    rarityGroup: 'uncommon',
    serialMode: 'perStampType',
    cardClass: 'standard_spaniel',
    standard: true,
    mythicOnly: false,
    stampTypes: HOLIDAY_STAMPS
  }),
  sparkle: Object.freeze({
    slug: 'sparkle',
    label: 'Sparkle',
    perStandardDog: 10,
    total: 10 * STANDARD_DOG_COUNT,
    rarityGroup: 'uncommon',
    serialMode: 'single',
    cardClass: 'standard_spaniel',
    standard: true,
    mythicOnly: false
  }),
  plate: Object.freeze({
    slug: 'plate',
    label: 'Printing Plate',
    perStandardDog: 4,
    total: 4 * STANDARD_DOG_COUNT,
    rarityGroup: 'rare',
    serialMode: 'perPlateColor',
    cardClass: 'standard_spaniel',
    standard: true,
    mythicOnly: false,
    plateColors: PLATE_COLORS
  }),
  gold: Object.freeze({
    slug: 'gold',
    label: 'Gold',
    perStandardDog: 3,
    total: 3 * STANDARD_DOG_COUNT,
    rarityGroup: 'rare',
    serialMode: 'single',
    cardClass: 'standard_spaniel',
    standard: true,
    mythicOnly: false
  }),
  error: Object.freeze({
    slug: 'error',
    label: 'Error',
    perStandardDog: 1,
    total: 1 * STANDARD_DOG_COUNT,
    rarityGroup: 'ultra',
    serialMode: 'single',
    cardClass: 'standard_spaniel',
    standard: true,
    mythicOnly: false
  }),
  black: Object.freeze({
    slug: 'black',
    label: 'Black 1/1',
    perStandardDog: 1,
    total: 1 * STANDARD_DOG_COUNT,
    rarityGroup: 'ultra',
    serialMode: 'single',
    cardClass: 'standard_spaniel',
    standard: true,
    mythicOnly: false
  }),
  mythic: Object.freeze({
    slug: 'mythic',
    label: 'Mythic Custom 1/1',
    perStandardDog: 0,
    total: TRUE_MYTHIC_COUNT, // 69
    rarityGroup: 'mythic',
    serialMode: 'oneOfOne',
    cardClass: 'true_mythic_spaniel',
    standard: false,
    mythicOnly: true
  }),
  mythic_insert: Object.freeze({
    slug: 'mythic_insert',
    label: 'Mythic Insert / Relic / Anomaly',
    perStandardDog: 0,
    total: MYTHIC_INSERT_COUNT, // 351
    rarityGroup: 'mythic',
    serialMode: 'oneOfOne',
    cardClass: 'mythic_insert',
    standard: false,
    mythicOnly: false
  })
});

export const VARIANT_SLUGS = Object.freeze(Object.keys(VARIANTS));
export const STANDARD_VARIANT_SLUGS = Object.freeze(
  VARIANT_SLUGS.filter((s) => VARIANTS[s].standard)
);

// ────────────────────────────────────────────────────────────────────
// Generic-common design distribution
// ────────────────────────────────────────────────────────────────────
//
// genericDesignId in [1..GENERIC_DESIGN_COUNT]. Designs 1..352 print
// GENERIC_HIGH_PRINTS_PER_DESIGN copies; designs 353..420 print
// GENERIC_LOW_PRINTS_PER_DESIGN copies. Suggested concept names below
// are advisory — the final design names live in the ops manifest.

export const GENERIC_DESIGN_CONCEPT_HINTS = Object.freeze([
  'Dog Treat', 'Tennis Ball', 'Squeaky Toy', 'Leash', 'Collar',
  'Chewed Shoe', 'Belly Rub', 'Walkies', 'Rescue Paw', 'Kennel Key',
  'Cone of Shame', 'Good Dog', 'Bad Dog', 'Adoption Form', 'Vet Visit',
  'Soggy Tennis Ball', 'Spaniel Snack', 'Dog Park Pass'
]);

export function isValidGenericDesignId(id) {
  const n = Number(id);
  return Number.isInteger(n) && n >= 1 && n <= GENERIC_DESIGN_COUNT;
}

export function genericDesignPrintCount(designId) {
  if (!isValidGenericDesignId(designId)) {
    throw new Error(`invalid genericDesignId: ${designId}`);
  }
  return designId <= GENERIC_HIGH_DESIGN_COUNT
    ? GENERIC_HIGH_PRINTS_PER_DESIGN
    : GENERIC_LOW_PRINTS_PER_DESIGN;
}

export function isValidMythicInsertId(id) {
  const n = Number(id);
  return Number.isInteger(n) && n >= 1 && n <= MYTHIC_INSERT_COUNT;
}

// ────────────────────────────────────────────────────────────────────
// Public catalog (frozen)
// ────────────────────────────────────────────────────────────────────

export const SERIES_1 = Object.freeze({
  seriesId: SERIES_ID,
  canonicalDogCount: CANONICAL_DOG_COUNT,
  trueMythicCount: TRUE_MYTHIC_COUNT,
  existingMythicCount: EXISTING_MYTHIC_COUNT,
  additionalMythicsRequired: ADDITIONAL_MYTHICS_REQUIRED,
  mythicInsertCount: MYTHIC_INSERT_COUNT,
  totalMythicClassCount: TOTAL_MYTHIC_CLASS_COUNT,
  standardDogCount: STANDARD_DOG_COUNT,
  cardsPerStandardDog: CARDS_PER_STANDARD_DOG,
  cardsPerMythicDog: CARDS_PER_MYTHIC_DOG,
  standardCardTotal: STANDARD_CARD_TOTAL,
  genericDesignCount: GENERIC_DESIGN_COUNT,
  genericCommonTotal: GENERIC_COMMON_TOTAL,
  totalCardSupply: TOTAL_CARD_SUPPLY,
  totalDrawSlots: TOTAL_DRAW_SLOTS,
  variants: VARIANTS,
  rarityGroups: RARITY_GROUPS,
  holidayStamps: HOLIDAY_STAMPS,
  plateColors: PLATE_COLORS,
  mythicDogIds: MYTHIC_DOG_IDS,
  cardClasses: CARD_CLASSES
});

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

export function isMythicDogId(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return false;
  return MYTHIC_SET.has(n);
}

export function isStandardDogId(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return false;
  if (n < 1 || n > CANONICAL_DOG_COUNT) return false;
  return !MYTHIC_SET.has(n);
}

export function isValidDogId(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return false;
  return n >= 1 && n <= CANONICAL_DOG_COUNT;
}

export function cardsForDog(dogId) {
  if (!isValidDogId(dogId)) {
    throw new Error(`invalid dogId: ${dogId}`);
  }
  return isMythicDogId(dogId) ? CARDS_PER_MYTHIC_DOG : CARDS_PER_STANDARD_DOG;
}

export function getVariant(slug) {
  return VARIANTS[slug] ?? null;
}

export function isValidVariantSlug(slug) {
  return typeof slug === 'string' && Object.prototype.hasOwnProperty.call(VARIANTS, slug);
}

export function isValidStampType(stamp) {
  return typeof stamp === 'string' && HOLIDAY_STAMPS.includes(stamp);
}

export function isValidPlateColor(color) {
  return typeof color === 'string' && PLATE_COLORS.includes(color);
}

export function rarityGroupForVariant(slug) {
  const v = getVariant(slug);
  return v ? v.rarityGroup : null;
}

export function variantsInRarityGroup(group) {
  return RARITY_GROUPS[group] ?? null;
}

// ────────────────────────────────────────────────────────────────────
// Print-run invariants
// ────────────────────────────────────────────────────────────────────
//
// Validate the entire print run adds up. Throws on any drift; safe to
// call repeatedly. Authored-mythic-list size is enforced separately
// (it's allowed to be < TRUE_MYTHIC_COUNT during dev; final manifest
// generation refuses to ship without the full 69).

export function validatePrintRun() {
  // Standard / canonical relationship.
  if (STANDARD_DOG_COUNT + TRUE_MYTHIC_COUNT !== CANONICAL_DOG_COUNT) {
    throw new Error(
      `series1: standard ${STANDARD_DOG_COUNT} + true mythic ${TRUE_MYTHIC_COUNT} != canonical ${CANONICAL_DOG_COUNT}`
    );
  }
  if (TRUE_MYTHIC_COUNT + MYTHIC_INSERT_COUNT !== TOTAL_MYTHIC_CLASS_COUNT) {
    throw new Error(
      `series1: ${TRUE_MYTHIC_COUNT} + ${MYTHIC_INSERT_COUNT} != ${TOTAL_MYTHIC_CLASS_COUNT}`
    );
  }
  // Per-standard-dog total.
  const perDog = STANDARD_VARIANT_SLUGS.reduce(
    (acc, slug) => acc + VARIANTS[slug].perStandardDog,
    0
  );
  if (perDog !== CARDS_PER_STANDARD_DOG) {
    throw new Error(
      `series1: per-standard-dog total ${perDog} != CARDS_PER_STANDARD_DOG ${CARDS_PER_STANDARD_DOG}`
    );
  }
  // Standard cards grand total.
  const standardTotal = STANDARD_VARIANT_SLUGS.reduce((acc, slug) => acc + VARIANTS[slug].total, 0);
  if (standardTotal !== STANDARD_CARD_TOTAL) {
    throw new Error(
      `series1: standard variant totals ${standardTotal} != ${STANDARD_CARD_TOTAL}`
    );
  }
  // Mythic + insert totals.
  if (VARIANTS.mythic.total !== TRUE_MYTHIC_COUNT) {
    throw new Error(
      `series1: mythic variant total ${VARIANTS.mythic.total} != ${TRUE_MYTHIC_COUNT}`
    );
  }
  if (VARIANTS.mythic_insert.total !== MYTHIC_INSERT_COUNT) {
    throw new Error(
      `series1: mythic_insert total ${VARIANTS.mythic_insert.total} != ${MYTHIC_INSERT_COUNT}`
    );
  }
  // Generic-design distribution.
  if (GENERIC_HIGH_DESIGN_COUNT + GENERIC_LOW_DESIGN_COUNT !== GENERIC_DESIGN_COUNT) {
    throw new Error(
      `series1: generic high+low (${GENERIC_HIGH_DESIGN_COUNT}+${GENERIC_LOW_DESIGN_COUNT}) != ${GENERIC_DESIGN_COUNT}`
    );
  }
  const genericComputed =
    GENERIC_HIGH_DESIGN_COUNT * GENERIC_HIGH_PRINTS_PER_DESIGN +
    GENERIC_LOW_DESIGN_COUNT * GENERIC_LOW_PRINTS_PER_DESIGN;
  if (genericComputed !== GENERIC_COMMON_TOTAL) {
    throw new Error(`series1: generic computed ${genericComputed} != ${GENERIC_COMMON_TOTAL}`);
  }
  if (VARIANTS.generic.total !== GENERIC_COMMON_TOTAL) {
    throw new Error(`series1: variant.generic.total mismatch`);
  }
  // Grand total.
  const grand = standardTotal + VARIANTS.mythic.total + VARIANTS.mythic_insert.total + VARIANTS.generic.total;
  if (grand !== TOTAL_CARD_SUPPLY) {
    throw new Error(
      `series1: grand total ${grand} != TOTAL_CARD_SUPPLY ${TOTAL_CARD_SUPPLY}`
    );
  }
  // Holiday stamp & plate color counts must match printed variant counts.
  if (HOLIDAY_STAMPS.length !== VARIANTS.holiday.perStandardDog) {
    throw new Error(
      `series1: HOLIDAY_STAMPS length ${HOLIDAY_STAMPS.length} != holiday perStandardDog ${VARIANTS.holiday.perStandardDog}`
    );
  }
  if (PLATE_COLORS.length !== VARIANTS.plate.perStandardDog) {
    throw new Error(
      `series1: PLATE_COLORS length ${PLATE_COLORS.length} != plate perStandardDog ${VARIANTS.plate.perStandardDog}`
    );
  }
  // Currently-authored mythic asset count check (informational).
  if (MYTHIC_DOG_IDS.length !== EXISTING_MYTHIC_COUNT) {
    throw new Error(
      `series1: MYTHIC_DOG_IDS length ${MYTHIC_DOG_IDS.length} != EXISTING_MYTHIC_COUNT ${EXISTING_MYTHIC_COUNT}`
    );
  }
  return true;
}

/**
 * Verify the mythic asset set is complete for final manifest generation.
 * Throws if the authored mythic-id list has not yet been extended to
 * TRUE_MYTHIC_COUNT.
 *
 * @param {object} args
 * @param {ReadonlyArray<number>} args.finalMythicDogIds — full list of 69 dog ids
 * @param {ReadonlyArray<number>} [args.mythicInsertIds] — full list of 351 insert ids
 */
export function validateFinalMythicAssets(args) {
  const { finalMythicDogIds, mythicInsertIds } = args ?? {};
  if (!Array.isArray(finalMythicDogIds)) {
    throw new Error('validateFinalMythicAssets: finalMythicDogIds must be an array');
  }
  if (finalMythicDogIds.length !== TRUE_MYTHIC_COUNT) {
    throw new Error(
      `final manifest requires ${TRUE_MYTHIC_COUNT} true mythic dog ids, got ${finalMythicDogIds.length}`
    );
  }
  const seen = new Set();
  for (const id of finalMythicDogIds) {
    if (!isValidDogId(id)) {
      throw new Error(`finalMythicDogIds: invalid dogId ${id}`);
    }
    if (seen.has(id)) {
      throw new Error(`finalMythicDogIds: duplicate dogId ${id}`);
    }
    seen.add(id);
  }
  // Pre-authored mythics must be a subset of the final list.
  for (const id of MYTHIC_DOG_IDS) {
    if (!seen.has(id)) {
      throw new Error(`finalMythicDogIds: existing mythic ${id} missing from final list`);
    }
  }
  if (mythicInsertIds !== undefined) {
    if (!Array.isArray(mythicInsertIds) || mythicInsertIds.length !== MYTHIC_INSERT_COUNT) {
      throw new Error(
        `final manifest requires ${MYTHIC_INSERT_COUNT} mythic insert ids, got ${mythicInsertIds?.length}`
      );
    }
    const insertSet = new Set();
    for (const id of mythicInsertIds) {
      if (!isValidMythicInsertId(id)) {
        throw new Error(`mythicInsertIds: invalid id ${id}`);
      }
      if (insertSet.has(id)) {
        throw new Error(`mythicInsertIds: duplicate id ${id}`);
      }
      insertSet.add(id);
    }
  }
  return true;
}
