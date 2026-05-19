// Spaniel Syndicate — Spaniel Asset Engine (canonical facade).
//
// Single entry point that resolves any Series 1 card identity to its
// full asset record:
//
//   drawSlot ────────► cardInstanceIdx ────────► cardDefinition
//                                                 │
//                                                 ├─► front SVG
//                                                 ├─► back SVG
//                                                 ├─► metadata JSON
//                                                 ├─► game stats
//                                                 ├─► ability text
//                                                 └─► official-page data
//
// Supports all 4 Series 1 card classes:
//
//   generic_common      — 690,139,312 cards (420 designs)
//   standard_spaniel    — 309,860,268 cards (69,351 dogs × 11 variants)
//   true_mythic_spaniel — 69 cards (1/1, custom art)
//   mythic_insert       — 351 cards (1/1, no dogId)
//
// VIRTUAL by design. Never materialize a billion records. All resolves
// are pure functions; small fixture batches are exported by the ops
// repo's scripts/generate-series1-fixtures.mjs.
//
// CLAUDE.md anchors:
//   §0 — sharp pixel/card geometry, no investment language
//   §2.1 — print run, variant table
//   §2.12 — virtual manifest commitment
//   §2.16 — metadata schema
//   §3 — engineering rules: shared math, BigInt money, server quote

import {
  SERIES_ID,
  VARIANTS,
  STANDARD_VARIANT_SLUGS,
  HOLIDAY_STAMPS,
  PLATE_COLORS,
  RARITY_GROUPS,
  CARDS_PER_STANDARD_DOG,
  CARD_CLASSES,
  isStandardDogId,
  isMythicDogId,
  isValidDogId,
  isValidGenericDesignId,
  isValidMythicInsertId,
  getVariant,
  genericDesignPrintCount
} from './series1.js';
import {
  parseCardKey,
  formatCardKey,
  isValidCardKey,
  enumerateCardKeysForDog,
  normalizeParsedCardKey
} from './card-key.js';
import {
  drawSlotToInstanceIndex,
  instanceIndexToCard,
  INSTANCE_RANGES,
  MANIFEST_ALGORITHM_VERSION
} from './manifest.js';
import {
  renderCardFrontSvg,
  renderCardComposite,
  CARD_RENDERING_VERSION,
  CARD_W,
  CARD_H
} from './card-rendering.js';
import { renderCardBackSvg, CARD_BACK_VERSION } from './card-back.js';
import { themeForCard } from './card-frame.js';
import { gameStatsFor, abilityLineFor } from './card-game-stats.js';
import {
  RESCUE_WEIGHT_PER_REVEALED_CARD,
  AFFILIATE_WEIGHT_PER_REVEALED_CARD
} from './showdown-stats.js';
import { mythicLoreFor } from './mythic-lore.js';
import {
  personalityForStandardSpaniel,
  backstoryForStandardSpaniel,
  genericDesignName,
  genericDesignFlavor,
  mythicInsertName,
  mythicInsertFlavor,
  reservedMythicName
} from './personality.js';

export const SPANIEL_ENGINE_VERSION = 'spaniel-engine-v1';

const SITE_ORIGIN = 'https://spanielsyndicate.com';

// ────────────────────────────────────────────────────────────────────
// Resolver: cardKey → parsed (with cardKey field)
// ────────────────────────────────────────────────────────────────────

/**
 * Parse a card key into a normalized parsed object that always carries
 * the cardKey field. Returns null for invalid keys.
 *
 * @param {string} cardKey
 * @returns {object|null}
 */
export function resolveCardKey(cardKey) {
  if (typeof cardKey !== 'string') return null;
  const parsed = parseCardKey(cardKey);
  if (!parsed) return null;
  return { ...parsed, cardKey };
}

/**
 * Resolve a draw slot to a card definition.
 *
 * @param {number} slot draw slot in 1..TOTAL_DRAW_SLOTS
 * @param {object} args
 * @param {string} [args.entropySeedHex] — 16-char (64-bit) hex seed for
 *                  the Feistel permutation. Required to get the real
 *                  hidden draw order; omit only for dev test paths.
 * @param {number[]} [args.mythicDogIdOrder] — final 69-id mythic list
 * @param {number[]} [args.standardDogIdOrder] — final 69,351-id list
 * @returns {{ cardKey: string, definition: object, instanceIndex: number }}
 */
export function resolveDrawSlot(slot, args = {}) {
  const seedHex = typeof args.entropySeedHex === 'string'
    ? args.entropySeedHex
    : '0'.repeat(16); // dev identity seed (NOT for final mode)
  const instanceIndex = drawSlotToInstanceIndex(slot, seedHex);
  const record = instanceIndexToCard(instanceIndex, args);
  const cardKey = cardKeyFromRecord(record);
  const parsed = resolveCardKey(cardKey);
  return {
    cardKey,
    instanceIndex,
    definition: definitionFor(parsed)
  };
}

function cardKeyFromRecord(record) {
  switch (record.cardClass) {
    case 'generic_common':
      return formatCardKey({
        variant: 'generic',
        genericDesignId: record.genericDesignId,
        serial: record.serial
      });
    case 'standard_spaniel':
      if (record.stampType) {
        return formatCardKey({
          variant: record.variant,
          dogId: record.dogId,
          stampType: record.stampType
        });
      }
      if (record.plateColor) {
        return formatCardKey({
          variant: record.variant,
          dogId: record.dogId,
          plateColor: record.plateColor
        });
      }
      return formatCardKey({
        variant: record.variant,
        dogId: record.dogId,
        serial: record.serial
      });
    case 'true_mythic_spaniel':
      return formatCardKey({ variant: 'mythic', dogId: record.dogId });
    case 'mythic_insert':
      return formatCardKey({ variant: 'mythic_insert', mythicInsertId: record.mythicInsertId });
    default:
      throw new Error(`cardKeyFromRecord: unknown cardClass ${record.cardClass}`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Card definition (canonical record returned to UI + worker)
// ────────────────────────────────────────────────────────────────────

/**
 * Build the canonical card definition for an already-parsed card.
 *
 * Pure deterministic function of the card identity. Does not call out
 * to D1, Helius, or any network resource. Caller may merge in
 * dynamic fields (currentOwnerWallet, revealedAt, drawPosition) for
 * the page-level shape.
 *
 * @param {string|object} parsedOrKey
 * @returns {object}
 */
export function cardDefinitionFor(parsedOrKey) {
  const parsed = normalizeParsedCardKey(parsedOrKey);
  if (!parsed) throw new Error('cardDefinitionFor: invalid card key');
  return definitionFor(parsed);
}

function definitionFor(parsed) {
  const variant = getVariant(parsed.variant);
  const rarityGroup = variant.rarityGroup;
  const naming = nameFor(parsed);
  const game = gameStatsFor(parsed);
  const lore = loreFor(parsed);

  return Object.freeze({
    engineVersion: SPANIEL_ENGINE_VERSION,
    seriesId: parsed.seriesId,
    cardKey: parsed.cardKey,
    cardClass: parsed.cardClass,
    variant: parsed.variant,
    variantLabel: variant.label,
    rarityGroup,
    rarityLabel: rarityGroup.charAt(0).toUpperCase() + rarityGroup.slice(1),
    dogId: parsed.dogId,
    genericDesignId: parsed.genericDesignId,
    mythicInsertId: parsed.mythicInsertId,
    serial: parsed.serial,
    printCount: parsed.printCount,
    stampType: parsed.stampType,
    plateColor: parsed.plateColor,
    mythic: parsed.mythic,
    name: naming.name,
    subtitle: naming.subtitle,
    title: naming.title,
    lore: Object.freeze(lore),
    gameType: game.gameType,
    abilityId: game.abilityId,
    abilityLine: game.abilityLine,
    stats: Object.freeze({
      combat: Object.freeze({ ...game.stats.combat }),
      support: Object.freeze({ ...game.stats.support }),
      derived: Object.freeze({ ...game.stats.derived })
    }),
    displayStats: Object.freeze({ ...game.displayStats }),
    weights: Object.freeze({
      rescueWeight: RESCUE_WEIGHT_PER_REVEALED_CARD,
      affiliateWeight: AFFILIATE_WEIGHT_PER_REVEALED_CARD
    }),
    paths: pathsFor(parsed),
    metadataVersion: 'series1-metadata-v1'
  });
}

// ────────────────────────────────────────────────────────────────────
// Per-class naming
// ────────────────────────────────────────────────────────────────────

function nameFor(parsed) {
  switch (parsed.cardClass) {
    case 'true_mythic_spaniel': {
      const lore = mythicLoreFor(parsed.dogId);
      const baseName = lore ? `${lore.name} — Mythic Spaniel #${parsed.dogId}` : reservedMythicName(parsed.dogId);
      return {
        name: baseName,
        subtitle: 'Mythic 1/1',
        title: `${baseName} · Mythic 1/1`
      };
    }
    case 'mythic_insert': {
      const insertName = mythicInsertName(parsed.mythicInsertId);
      return {
        name: insertName,
        subtitle: 'Mythic Insert 1/1',
        title: `${insertName} · Mythic Insert 1/1`
      };
    }
    case 'generic_common': {
      const designName = genericDesignName(parsed.genericDesignId);
      return {
        name: designName,
        subtitle: `${parsed.serial}/${parsed.printCount}`,
        title: `${designName} · ${parsed.serial}/${parsed.printCount}`
      };
    }
    case 'standard_spaniel': {
      const base = `Spaniel #${parsed.dogId}`;
      const variant = getVariant(parsed.variant);
      let qualifier = variant.label;
      if (parsed.stampType) qualifier = `${variant.label} — ${prettyStamp(parsed.stampType)}`;
      else if (parsed.plateColor) qualifier = `${variant.label} — ${prettyPlate(parsed.plateColor)}`;
      const subtitle = parsed.serial && parsed.printCount > 1
        ? `${parsed.serial}/${parsed.printCount}`
        : '1/1';
      return {
        name: `${base} — ${qualifier}`,
        subtitle,
        title: `${base} — ${qualifier} · ${subtitle}`
      };
    }
    default:
      throw new Error(`nameFor: unknown cardClass ${parsed.cardClass}`);
  }
}

function prettyStamp(s) {
  switch (s) {
    case 'valentine':     return "Valentine's Stamp";
    case 'spring':        return 'Spring Stamp';
    case 'solana_summer': return 'Solana Summer Stamp';
    case 'halloween':     return 'Halloween Stamp';
    case 'winter':        return 'Winter Stamp';
    case 'new_year':      return "New Year's Stamp";
    default:              return s;
  }
}

function prettyPlate(c) {
  switch (c) {
    case 'cyan':    return 'Cyan Plate';
    case 'magenta': return 'Magenta Plate';
    case 'yellow':  return 'Yellow Plate';
    case 'key':     return 'Key (Black) Plate';
    default:        return c;
  }
}

// ────────────────────────────────────────────────────────────────────
// Per-class lore (name + anchor/flavor + personality + backstory)
// ────────────────────────────────────────────────────────────────────

function loreFor(parsed) {
  switch (parsed.cardClass) {
    case 'true_mythic_spaniel': {
      const lore = mythicLoreFor(parsed.dogId);
      if (!lore) {
        return {
          kind: 'mythic_reserved',
          name: reservedMythicName(parsed.dogId),
          anchor: null,
          flavor: 'Authored lore arrives before final manifest generation.',
          missing: true
        };
      }
      return {
        kind: 'mythic_authored',
        name: lore.name,
        anchor: lore.anchor,
        flavor: lore.anchor,
        missing: false
      };
    }
    case 'mythic_insert':
      return {
        kind: 'mythic_insert',
        name: mythicInsertName(parsed.mythicInsertId),
        flavor: mythicInsertFlavor(parsed.mythicInsertId),
        mythicInsertId: parsed.mythicInsertId,
        missing: false
      };
    case 'generic_common':
      return {
        kind: 'generic_common',
        name: genericDesignName(parsed.genericDesignId),
        flavor: genericDesignFlavor(parsed.genericDesignId),
        genericDesignId: parsed.genericDesignId,
        missing: false
      };
    case 'standard_spaniel': {
      const personality = personalityForStandardSpaniel(parsed.cardKey, parsed.dogId);
      const backstory = backstoryForStandardSpaniel(parsed.cardKey, parsed.dogId);
      return {
        kind: 'standard_spaniel',
        name: `Spaniel #${parsed.dogId}`,
        personality: personality.tags.join(', '),
        personalityTags: personality.tags,
        backstory,
        missing: false
      };
    }
    default:
      throw new Error(`loreFor: unknown cardClass ${parsed.cardClass}`);
  }
}

// ────────────────────────────────────────────────────────────────────
// Per-class canonical paths
// ────────────────────────────────────────────────────────────────────

function pathsFor(parsed) {
  return Object.freeze({
    cardPage: `${SITE_ORIGIN}/card.html?cardKey=${encodeURIComponent(parsed.cardKey)}`,
    cardPageShort: `${SITE_ORIGIN}/card/${encodeURIComponent(parsed.cardKey)}`,
    dogPage: parsed.dogId ? `${SITE_ORIGIN}/dog.html?dogId=${parsed.dogId}` : null,
    metadata: `${SITE_ORIGIN}/api/cards/${encodeURIComponent(parsed.cardKey)}/metadata`,
    binder: `${SITE_ORIGIN}/app/binder/`
  });
}

// ────────────────────────────────────────────────────────────────────
// Per-class on-chain-style metadata JSON
// ────────────────────────────────────────────────────────────────────

/**
 * Build the canonical card metadata JSON per CLAUDE.md §2.16.
 *
 * Caller may merge in dynamic fields:
 *   opts.image          — pre-rendered card image URL (front face)
 *   opts.manifestCommitment — manifest commitment hash (added at reveal)
 *   opts.cardDefinitionMerkleRoot — merkle leaf for this card
 *   opts.drawPosition   — draw position (added at reveal)
 *   opts.cardInstanceId — virtual manifest instance index
 *
 * @param {string|object} parsedOrKey
 * @param {object} [opts]
 * @returns {object}
 */
export function cardMetadataFor(parsedOrKey, opts = {}) {
  const parsed = normalizeParsedCardKey(parsedOrKey);
  if (!parsed) throw new Error('cardMetadataFor: invalid card key');
  const def = definitionFor(parsed);
  const attributes = attributesFor(def);
  const properties = propertiesFor(def, opts);
  return {
    name: def.name,
    description: descriptionFor(def),
    image: opts.image || `${SITE_ORIGIN}/drops/cards/${parsed.cardKey}.png`,
    external_url: def.paths.cardPage,
    attributes,
    properties
  };
}

function attributesFor(def) {
  const attrs = [
    { trait_type: 'Series', value: '1' },
    { trait_type: 'Card Class', value: humanCardClass(def.cardClass) },
    { trait_type: 'Variant', value: def.variantLabel },
    { trait_type: 'Rarity Group', value: def.rarityLabel },
    { trait_type: 'Serial', value: String(def.serial) },
    { trait_type: 'Print Count', value: String(def.printCount) },
    { trait_type: 'Mythic', value: def.mythic ? 'true' : 'false' }
  ];
  if (def.dogId != null) attrs.push({ trait_type: 'Dog ID', value: String(def.dogId) });
  if (def.dogId != null && def.lore.kind === 'standard_spaniel') {
    attrs.push({ trait_type: 'Dog Name', value: def.lore.name });
  }
  if (def.dogId != null && def.lore.kind === 'mythic_authored') {
    attrs.push({ trait_type: 'Dog Name', value: def.lore.name });
    attrs.push({ trait_type: 'Anchor', value: def.lore.anchor });
  }
  if (def.dogId != null && def.lore.kind === 'mythic_reserved') {
    attrs.push({ trait_type: 'Dog Name', value: def.lore.name });
  }
  if (def.genericDesignId != null) {
    attrs.push({ trait_type: 'Generic Design ID', value: String(def.genericDesignId) });
    attrs.push({ trait_type: 'Generic Design', value: def.lore.name });
  }
  if (def.mythicInsertId != null) {
    attrs.push({ trait_type: 'Mythic Insert ID', value: String(def.mythicInsertId) });
    attrs.push({ trait_type: 'Insert Name', value: def.lore.name });
  }
  if (def.stampType) attrs.push({ trait_type: 'Stamp Type', value: prettyStamp(def.stampType) });
  if (def.plateColor) attrs.push({ trait_type: 'Plate Color', value: prettyPlate(def.plateColor) });
  if (def.lore.kind === 'standard_spaniel' && def.lore.personality) {
    attrs.push({ trait_type: 'Personality', value: def.lore.personality });
  }
  attrs.push({ trait_type: 'Game Role', value: def.gameType.toUpperCase() });
  attrs.push({ trait_type: 'Ability', value: def.abilityId });
  // Visible 5-stat model (the only stats shown on the card back).
  attrs.push({ trait_type: 'Spirit', value: String(def.displayStats.spirit) });
  attrs.push({ trait_type: 'Bark',   value: String(def.displayStats.bark) });
  attrs.push({ trait_type: 'Bite',   value: String(def.displayStats.bite) });
  attrs.push({ trait_type: 'Zoom',   value: String(def.displayStats.zoom) });
  attrs.push({ trait_type: 'Charm',  value: String(def.displayStats.charm) });
  return attrs;
}

function propertiesFor(def, opts) {
  return {
    cardKey: def.cardKey,
    cardClass: def.cardClass,
    cardInstanceId: opts.cardInstanceId ?? null,
    drawPosition: opts.drawPosition ?? null,
    manifestCommitment: opts.manifestCommitment ?? null,
    cardDefinitionMerkleRoot: opts.cardDefinitionMerkleRoot ?? null,
    artRecipeHash: opts.artRecipeHash ?? null,
    rescueWeight: def.weights.rescueWeight,
    affiliateWeight: def.weights.affiliateWeight,
    gameStats: {
      combat: def.stats.combat,
      support: def.stats.support,
      derived: def.stats.derived
    },
    displayStats: def.displayStats,
    abilityId: def.abilityId,
    abilityLine: def.abilityLine
  };
}

function humanCardClass(cls) {
  switch (cls) {
    case 'generic_common':      return 'Generic Common';
    case 'standard_spaniel':    return 'Standard Spaniel';
    case 'true_mythic_spaniel': return 'True Mythic Spaniel';
    case 'mythic_insert':       return 'Mythic Insert';
    default:                    return cls;
  }
}

function descriptionFor(def) {
  switch (def.cardClass) {
    case 'true_mythic_spaniel':
      return def.lore.anchor
        ? `${def.lore.name}. ${def.lore.anchor} Spaniel Syndicate Series 1 mythic 1/1.`
        : `${def.lore.name}. Spaniel Syndicate Series 1 mythic 1/1 — lore committed at final manifest generation.`;
    case 'mythic_insert':
      return `${def.lore.name}. ${def.lore.flavor} Spaniel Syndicate Series 1 mythic-class insert 1/1.`;
    case 'generic_common':
      return `${def.lore.name}. ${def.lore.flavor} Spaniel Syndicate Series 1 generic common (${def.serial}/${def.printCount}).`;
    case 'standard_spaniel':
      return `Spaniel #${def.dogId} — ${def.variantLabel}. ${def.lore.backstory} Spaniel Syndicate Series 1 (${def.serial}/${def.printCount}).`;
    default:
      return 'Spaniel Syndicate Series 1 card.';
  }
}

// ────────────────────────────────────────────────────────────────────
// Composite renderer (front + back SVG, plus the definition + metadata)
// ────────────────────────────────────────────────────────────────────

/**
 * Render the full trading-card composite (front + back) for any card.
 *
 * @param {string|object} parsedOrKey
 * @param {object} [opts]
 * @param {string} [opts.artDataUri] — base64 PNG data URI for the 24×24 dog
 * @param {object} [opts.scene] — { bgColor, bgKind, bgSeed } scene info
 *                                 from the ops-side pixel engine token,
 *                                 used by the art-only front renderer
 *                                 to extrapolate the dog's background
 *                                 across the full card canvas.
 * @returns {{ cardKey: string, definition: object, metadata: object,
 *             frontSvg: string, backSvg: string, dimensions: object }}
 */
export function cardCompositeFor(parsedOrKey, opts = {}) {
  const parsed = normalizeParsedCardKey(parsedOrKey);
  if (!parsed) throw new Error('cardCompositeFor: invalid card key');
  const def = definitionFor(parsed);
  const renderOpts = { ...opts, name: def.name, lore: def.lore };
  const frontSvg = renderCardFrontSvg(parsed, renderOpts);
  const backSvg = renderCardBackSvg(parsed, renderOpts);
  return {
    cardKey: parsed.cardKey,
    definition: def,
    metadata: cardMetadataFor(parsed, opts),
    frontSvg,
    backSvg,
    dimensions: { width: CARD_W, height: CARD_H }
  };
}

// ────────────────────────────────────────────────────────────────────
// Official card page shape (for /card/<cardKey>)
// ────────────────────────────────────────────────────────────────────

/**
 * Page-shaped record for the public card detail page.
 *
 * @param {string|object} parsedOrKey
 * @param {object} [opts] — see cardCompositeFor + cardMetadataFor opts
 * @returns {object}
 */
export function cardOfficialPageFor(parsedOrKey, opts = {}) {
  const composite = cardCompositeFor(parsedOrKey, opts);
  const def = composite.definition;
  return {
    title: def.title,
    description: composite.metadata.description,
    image: composite.metadata.image,
    paths: def.paths,
    fields: {
      cardKey: def.cardKey,
      cardClass: humanCardClass(def.cardClass),
      variant: def.variantLabel,
      rarity: def.rarityLabel,
      serial: def.serial,
      printCount: def.printCount,
      stamp: def.stampType ? prettyStamp(def.stampType) : null,
      plate: def.plateColor ? prettyPlate(def.plateColor) : null,
      gameRole: def.gameType.toUpperCase(),
      ability: def.abilityLine,
      rescueWeight: def.weights.rescueWeight,
      affiliateWeight: def.weights.affiliateWeight
    },
    stats: def.stats,
    lore: def.lore,
    metadata: composite.metadata,
    frontSvg: composite.frontSvg,
    backSvg: composite.backSvg
  };
}

// ────────────────────────────────────────────────────────────────────
// QA audit — sweep a card definition for issues
// ────────────────────────────────────────────────────────────────────

/**
 * Inspect a card definition for missing fields, impossible variants,
 * stale assumptions, or known authoring gaps.
 *
 * Returns an array of `{ severity, code, message }` issues. Empty
 * array = clean.
 *
 * @param {string|object} parsedOrKey
 * @returns {Array<{severity: string, code: string, message: string}>}
 */
export function auditCardDefinition(parsedOrKey) {
  const issues = [];
  const parsed = normalizeParsedCardKey(parsedOrKey);
  if (!parsed) {
    issues.push({ severity: 'error', code: 'INVALID_CARD_KEY', message: `unparseable card key` });
    return issues;
  }
  if (!CARD_CLASSES.includes(parsed.cardClass)) {
    issues.push({ severity: 'error', code: 'UNKNOWN_CARD_CLASS', message: `cardClass ${parsed.cardClass}` });
  }
  const variant = getVariant(parsed.variant);
  if (!variant) {
    issues.push({ severity: 'error', code: 'UNKNOWN_VARIANT', message: `variant ${parsed.variant}` });
    return issues;
  }
  // Mythic dogs must never carry standard variants.
  if (parsed.cardClass === 'standard_spaniel' && parsed.dogId != null && isMythicDogId(parsed.dogId)) {
    issues.push({
      severity: 'error',
      code: 'MYTHIC_DOG_HAS_STANDARD_VARIANT',
      message: `dogId ${parsed.dogId} is mythic but variant is ${parsed.variant}`
    });
  }
  if (parsed.cardClass === 'true_mythic_spaniel' && parsed.dogId != null && !isMythicDogId(parsed.dogId)) {
    issues.push({
      severity: 'error',
      code: 'STANDARD_DOG_HAS_MYTHIC_VARIANT',
      message: `dogId ${parsed.dogId} is not in the authored mythic set but variant is mythic`
    });
  }
  if (parsed.cardClass === 'generic_common' && !isValidGenericDesignId(parsed.genericDesignId)) {
    issues.push({
      severity: 'error',
      code: 'INVALID_GENERIC_DESIGN_ID',
      message: `genericDesignId ${parsed.genericDesignId}`
    });
  }
  if (parsed.cardClass === 'mythic_insert' && !isValidMythicInsertId(parsed.mythicInsertId)) {
    issues.push({
      severity: 'error',
      code: 'INVALID_MYTHIC_INSERT_ID',
      message: `mythicInsertId ${parsed.mythicInsertId}`
    });
  }
  // Mythic-authored vs reserved tracking (known authoring gap, not an error).
  if (parsed.cardClass === 'true_mythic_spaniel' && parsed.dogId != null) {
    const lore = mythicLoreFor(parsed.dogId);
    if (!lore) {
      issues.push({
        severity: 'warn',
        code: 'MYTHIC_LORE_MISSING',
        message: `mythic dogId ${parsed.dogId} has no authored lore yet (one of the 20 reserved mythic slots)`
      });
    }
  }
  // Definition completeness.
  let def;
  try {
    def = definitionFor(parsed);
  } catch (err) {
    issues.push({ severity: 'error', code: 'DEFINITION_THROW', message: String(err.message || err) });
    return issues;
  }
  for (const required of ['name', 'variantLabel', 'rarityGroup', 'gameType', 'abilityId', 'stats']) {
    if (def[required] == null || def[required] === '') {
      issues.push({ severity: 'error', code: 'MISSING_FIELD', message: `definition.${required} is empty` });
    }
  }
  // Game stats sanity (0..99).
  for (const group of ['combat', 'support', 'derived']) {
    const block = def.stats[group];
    for (const [k, v] of Object.entries(block)) {
      if (!Number.isInteger(v) || v < 0 || v > 99) {
        issues.push({
          severity: 'error',
          code: 'STAT_OUT_OF_RANGE',
          message: `${group}.${k} = ${v} (must be 0..99)`
        });
      }
    }
  }
  // Visible 5-stat model sanity (1..99). displayStats is the only
  // stat block surfaced on the card back / binder thumbnail / public
  // card page; if it drifts out of range the front-of-house breaks.
  for (const key of ['spirit', 'bark', 'bite', 'zoom', 'charm']) {
    const v = def.displayStats?.[key];
    if (!Number.isInteger(v) || v < 1 || v > 99) {
      issues.push({
        severity: 'error',
        code: 'DISPLAY_STAT_OUT_OF_RANGE',
        message: `displayStats.${key} = ${v} (must be 1..99)`
      });
    }
  }
  // Render check (front + back must be non-empty SVG).
  try {
    const front = renderCardFrontSvg(parsed, { name: def.name, lore: def.lore });
    const back = renderCardBackSvg(parsed, { name: def.name, lore: def.lore });
    if (!front.startsWith('<svg ')) {
      issues.push({ severity: 'error', code: 'FRONT_RENDER_INVALID', message: 'frontSvg does not start with <svg' });
    }
    if (!back.startsWith('<svg ')) {
      issues.push({ severity: 'error', code: 'BACK_RENDER_INVALID', message: 'backSvg does not start with <svg' });
    }
  } catch (err) {
    issues.push({ severity: 'error', code: 'RENDER_THROW', message: String(err.message || err) });
  }
  return issues;
}

// ────────────────────────────────────────────────────────────────────
// Convenience: enumerate every variant slot for a dog (Spaniel
// checklist). Returns 4,468 keys for standard, 1 for mythic.
// ────────────────────────────────────────────────────────────────────

export function cardKeysForDog(dogId) {
  return enumerateCardKeysForDog(dogId);
}

// ────────────────────────────────────────────────────────────────────
// Re-exports (so consumers can `import * as engine from spaniel-engine`)
// ────────────────────────────────────────────────────────────────────

export {
  SERIES_ID,
  CARD_CLASSES,
  VARIANTS,
  STANDARD_VARIANT_SLUGS,
  HOLIDAY_STAMPS,
  PLATE_COLORS,
  RARITY_GROUPS,
  CARDS_PER_STANDARD_DOG,
  INSTANCE_RANGES,
  MANIFEST_ALGORITHM_VERSION,
  CARD_RENDERING_VERSION,
  CARD_BACK_VERSION,
  CARD_W,
  CARD_H,
  isValidCardKey,
  parseCardKey,
  formatCardKey,
  renderCardFrontSvg,
  renderCardBackSvg,
  renderCardComposite,
  themeForCard,
  gameStatsFor,
  abilityLineFor,
  mythicLoreFor,
  personalityForStandardSpaniel,
  backstoryForStandardSpaniel,
  genericDesignName,
  genericDesignFlavor,
  mythicInsertName,
  mythicInsertFlavor,
  reservedMythicName,
  RESCUE_WEIGHT_PER_REVEALED_CARD,
  AFFILIATE_WEIGHT_PER_REVEALED_CARD
};
