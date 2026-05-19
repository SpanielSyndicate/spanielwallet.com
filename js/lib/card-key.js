// Spaniel Syndicate — card key parsing & formatting.
//
// Stable identifier format for Series 1 card NFTs. Used as the public
// key for marketplace listings, offer predicates, dog/card pages, and
// the canonical manifest. Determined entirely by card class + identity,
// never re-mapped after launch.
//
// Card classes:
//
//   generic_common     — repeated commons, no dogId, designId 1..420
//                        s1-generic-<DDD>-<NNNNNNN>of<MMMMMMM>
//
//   standard_spaniel   — standard dog + variant + serial
//                        s1-dog-<DDDDD>-<variant>-<serialPart>
//
//   true_mythic_spaniel — 1/1 custom-art mythic dog
//                        s1-mythic-dog-<DDDDD>-1of1
//
//   mythic_insert       — 1/1 insert/relic/anomaly (no dogId), id 1..351
//                         s1-mythic-insert-<III>-1of1
//
// Where DDDDD is the 5-digit zero-padded dogId in 1..69420, DDD is
// the 3-digit zero-padded genericDesignId in 1..420, III is the
// 3-digit zero-padded mythicInsertId in 1..351, and the serial in
// generic + standard 'single' modes is zero-padded to len(printCount).
//
// Examples:
//   s1-generic-001-0000037of1643189
//   s1-dog-00214-base-0037of3812
//   s1-dog-00420-gold-2of3
//   s1-dog-01031-black-1of1
//   s1-dog-01225-holiday-halloween-1of1
//   s1-dog-00069-plate-cyan-1of1
//   s1-mythic-dog-00069-1of1
//   s1-mythic-insert-042-1of1

import {
  SERIES_ID,
  CANONICAL_DOG_COUNT,
  GENERIC_DESIGN_COUNT,
  MYTHIC_INSERT_COUNT,
  HOLIDAY_STAMPS,
  PLATE_COLORS,
  VARIANTS,
  isMythicDogId,
  isStandardDogId,
  isValidDogId,
  isValidVariantSlug,
  isValidStampType,
  isValidPlateColor,
  isValidGenericDesignId,
  isValidMythicInsertId,
  genericDesignPrintCount,
  getVariant
} from './series1.js';

const DOG_ID_PAD = String(CANONICAL_DOG_COUNT).length;        // 5
const GENERIC_ID_PAD = String(GENERIC_DESIGN_COUNT).length;    // 3
const MYTHIC_INSERT_ID_PAD = String(MYTHIC_INSERT_COUNT).length; // 3

export const STANDARD_PREFIX = `${SERIES_ID}-dog-`;
export const MYTHIC_PREFIX = `${SERIES_ID}-mythic-dog-`;
export const GENERIC_PREFIX = `${SERIES_ID}-generic-`;
export const MYTHIC_INSERT_PREFIX = `${SERIES_ID}-mythic-insert-`;

function padDogId(dogId) {
  return String(dogId).padStart(DOG_ID_PAD, '0');
}

function padGenericId(designId) {
  return String(designId).padStart(GENERIC_ID_PAD, '0');
}

function padMythicInsertId(id) {
  return String(id).padStart(MYTHIC_INSERT_ID_PAD, '0');
}

function padSerial(serial, printCount) {
  const width = String(printCount).length;
  return String(serial).padStart(width, '0');
}

/**
 * Format a card key from its component parts.
 *
 * @param {object} parts
 * @param {string} [parts.cardClass] — optional explicit class override; inferred otherwise
 * @param {string} parts.variant — slug from VARIANTS (e.g. 'base', 'generic', 'mythic', 'mythic_insert')
 * @param {number} [parts.dogId] — required for standard + true mythic
 * @param {number} [parts.genericDesignId] — required for generic
 * @param {number} [parts.mythicInsertId] — required for mythic_insert
 * @param {number} [parts.serial] — required for single-serial and generic variants
 * @param {string} [parts.stampType] — required for holiday variant
 * @param {string} [parts.plateColor] — required for plate variant
 * @returns {string} card key
 */
export function formatCardKey(parts) {
  const { variant } = parts;
  if (!isValidVariantSlug(variant)) throw new Error(`invalid variant: ${variant}`);
  const v = getVariant(variant);

  switch (v.cardClass) {
    case 'generic_common': {
      const designId = Number(parts.genericDesignId);
      if (!isValidGenericDesignId(designId)) {
        throw new Error(`invalid genericDesignId: ${parts.genericDesignId}`);
      }
      const printCount = genericDesignPrintCount(designId);
      const serial = Number(parts.serial);
      if (!Number.isInteger(serial) || serial < 1 || serial > printCount) {
        throw new Error(
          `generic variant requires serial 1..${printCount}, got ${parts.serial}`
        );
      }
      return `${GENERIC_PREFIX}${padGenericId(designId)}-${padSerial(serial, printCount)}of${printCount}`;
    }

    case 'true_mythic_spaniel': {
      const dogId = Number(parts.dogId);
      if (!isValidDogId(dogId)) throw new Error(`invalid dogId: ${parts.dogId}`);
      if (!isMythicDogId(dogId)) {
        throw new Error(`dog ${dogId} is not in the authored mythic set (variant=mythic)`);
      }
      return `${MYTHIC_PREFIX}${padDogId(dogId)}-1of1`;
    }

    case 'mythic_insert': {
      const insertId = Number(parts.mythicInsertId);
      if (!isValidMythicInsertId(insertId)) {
        throw new Error(`invalid mythicInsertId: ${parts.mythicInsertId}`);
      }
      return `${MYTHIC_INSERT_PREFIX}${padMythicInsertId(insertId)}-1of1`;
    }

    case 'standard_spaniel': {
      const dogId = Number(parts.dogId);
      if (!isValidDogId(dogId)) throw new Error(`invalid dogId: ${parts.dogId}`);
      if (!isStandardDogId(dogId)) {
        throw new Error(`dog ${dogId} is mythic — only the mythic variant is valid for it`);
      }
      const padded = padDogId(dogId);
      switch (v.serialMode) {
        case 'single': {
          const serial = Number(parts.serial);
          if (!Number.isInteger(serial) || serial < 1 || serial > v.perStandardDog) {
            throw new Error(
              `variant "${variant}" requires serial 1..${v.perStandardDog}, got ${parts.serial}`
            );
          }
          return `${STANDARD_PREFIX}${padded}-${variant}-${padSerial(serial, v.perStandardDog)}of${v.perStandardDog}`;
        }
        case 'perStampType': {
          const stamp = parts.stampType;
          if (!isValidStampType(stamp)) {
            throw new Error(`holiday variant requires valid stampType, got ${stamp}`);
          }
          return `${STANDARD_PREFIX}${padded}-${variant}-${stamp}-1of1`;
        }
        case 'perPlateColor': {
          const color = parts.plateColor;
          if (!isValidPlateColor(color)) {
            throw new Error(`plate variant requires valid plateColor, got ${color}`);
          }
          return `${STANDARD_PREFIX}${padded}-${variant}-${color}-1of1`;
        }
        default:
          throw new Error(`unsupported standard serialMode: ${v.serialMode}`);
      }
    }

    default:
      throw new Error(`unsupported cardClass for variant ${variant}: ${v.cardClass}`);
  }
}

const DOG_RE = /^(\d{5})$/;
const GENERIC_ID_RE = /^(\d{3})$/;
const INSERT_ID_RE = /^(\d{3})$/;

/**
 * Parse a card key into its components.
 * Returns null on malformed input.
 *
 * @param {string} key
 * @returns {object|null}
 */
export function parseCardKey(key) {
  if (typeof key !== 'string') return null;

  // Mythic insert: s1-mythic-insert-<III>-1of1
  if (key.startsWith(MYTHIC_INSERT_PREFIX)) {
    const rest = key.slice(MYTHIC_INSERT_PREFIX.length);
    const m = rest.match(/^(\d{3})-1of1$/);
    if (!m) return null;
    const id = Number(m[1]);
    if (!isValidMythicInsertId(id)) return null;
    return {
      seriesId: SERIES_ID,
      cardClass: 'mythic_insert',
      mythicInsertId: id,
      dogId: null,
      genericDesignId: null,
      variant: 'mythic_insert',
      serial: 1,
      printCount: 1,
      stampType: null,
      plateColor: null,
      mythic: true
    };
  }

  // True mythic Spaniel: s1-mythic-dog-<DDDDD>-1of1
  if (key.startsWith(MYTHIC_PREFIX)) {
    const rest = key.slice(MYTHIC_PREFIX.length);
    const m = rest.match(/^(\d{5})-1of1$/);
    if (!m) return null;
    const dogId = Number(m[1]);
    if (!isMythicDogId(dogId)) return null;
    return {
      seriesId: SERIES_ID,
      cardClass: 'true_mythic_spaniel',
      dogId,
      genericDesignId: null,
      mythicInsertId: null,
      variant: 'mythic',
      serial: 1,
      printCount: 1,
      stampType: null,
      plateColor: null,
      mythic: true
    };
  }

  // Generic common: s1-generic-<DDD>-<NNN..>of<MMM..>
  if (key.startsWith(GENERIC_PREFIX)) {
    const rest = key.slice(GENERIC_PREFIX.length);
    const m = rest.match(/^(\d{3})-(\d+)of(\d+)$/);
    if (!m) return null;
    const designId = Number(m[1]);
    if (!isValidGenericDesignId(designId)) return null;
    const serial = Number(m[2]);
    const printCount = Number(m[3]);
    const expectedCount = genericDesignPrintCount(designId);
    if (printCount !== expectedCount) return null;
    if (!Number.isInteger(serial) || serial < 1 || serial > printCount) return null;
    // Canonical zero-padded serial width
    if (m[2].length !== String(printCount).length) return null;
    return {
      seriesId: SERIES_ID,
      cardClass: 'generic_common',
      genericDesignId: designId,
      dogId: null,
      mythicInsertId: null,
      variant: 'generic',
      serial,
      printCount,
      stampType: null,
      plateColor: null,
      mythic: false
    };
  }

  // Standard Spaniel: s1-dog-<DDDDD>-<variant>...
  if (!key.startsWith(STANDARD_PREFIX)) return null;
  const rest = key.slice(STANDARD_PREFIX.length);
  const dashIdx = rest.indexOf('-');
  if (dashIdx !== 5) return null;
  const dogStr = rest.slice(0, 5);
  if (!DOG_RE.test(dogStr)) return null;
  const dogId = Number(dogStr);
  if (!isStandardDogId(dogId)) return null;

  const tail = rest.slice(6);
  const variantMatch = tail.match(/^([a-z_]+)-(.+)$/);
  if (!variantMatch) return null;
  const variant = variantMatch[1];
  const suffix = variantMatch[2];
  if (!isValidVariantSlug(variant)) return null;
  const v = getVariant(variant);
  if (v.cardClass !== 'standard_spaniel') return null;

  const base = {
    seriesId: SERIES_ID,
    cardClass: 'standard_spaniel',
    dogId,
    genericDesignId: null,
    mythicInsertId: null,
    variant,
    mythic: false
  };

  switch (v.serialMode) {
    case 'single': {
      const m = suffix.match(/^(\d+)of(\d+)$/);
      if (!m) return null;
      const serial = Number(m[1]);
      const printCount = Number(m[2]);
      if (printCount !== v.perStandardDog) return null;
      if (!Number.isInteger(serial) || serial < 1 || serial > printCount) return null;
      if (m[1].length !== String(printCount).length) return null;
      return {
        ...base,
        serial,
        printCount,
        stampType: null,
        plateColor: null
      };
    }
    case 'perStampType': {
      const m = suffix.match(/^([a-z_]+)-1of1$/);
      if (!m) return null;
      const stampType = m[1];
      if (!isValidStampType(stampType)) return null;
      return {
        ...base,
        serial: 1,
        printCount: 1,
        stampType,
        plateColor: null
      };
    }
    case 'perPlateColor': {
      const m = suffix.match(/^([a-z]+)-1of1$/);
      if (!m) return null;
      const plateColor = m[1];
      if (!isValidPlateColor(plateColor)) return null;
      return {
        ...base,
        serial: 1,
        printCount: 1,
        stampType: null,
        plateColor
      };
    }
    default:
      return null;
  }
}

export function isValidCardKey(key) {
  return parseCardKey(key) !== null;
}

/**
 * Tolerant card-key parser. Accepts either a card-key string OR an
 * already-parsed object (one that already carries `.cardKey` and
 * `.variant`). Returns the normalized parsed shape, or `null` for
 * invalid input. Used by every renderer + the spaniel engine so the
 * caller doesn't have to remember whether they hold a string or a
 * pre-parsed object.
 *
 * @param {string|object|null|undefined} input
 * @returns {object|null}
 */
export function normalizeParsedCardKey(input) {
  if (input && typeof input === 'object' && typeof input.cardKey === 'string' && input.variant) {
    return input;
  }
  if (typeof input !== 'string') return null;
  const parsed = parseCardKey(input);
  if (!parsed) return null;
  return { ...parsed, cardKey: input };
}

/**
 * Enumerate every possible Spaniel-checklist card key for a dogId.
 *
 * Returns 4,468 keys for standard dogs and 1 key for mythic dogs.
 * Useful for dog-page checklists. Does NOT include generic-common
 * or mythic-insert cards (those don't belong to a dogId).
 *
 * @param {number} dogId
 * @returns {string[]}
 */
export function enumerateCardKeysForDog(dogId) {
  if (!isValidDogId(dogId)) throw new Error(`invalid dogId: ${dogId}`);
  const padded = padDogId(dogId);

  if (isMythicDogId(dogId)) {
    return [`${MYTHIC_PREFIX}${padded}-1of1`];
  }

  const keys = [];
  for (const slug of Object.keys(VARIANTS)) {
    const v = VARIANTS[slug];
    if (!v.standard) continue;
    switch (v.serialMode) {
      case 'single':
        for (let s = 1; s <= v.perStandardDog; s++) {
          keys.push(`${STANDARD_PREFIX}${padded}-${slug}-${padSerial(s, v.perStandardDog)}of${v.perStandardDog}`);
        }
        break;
      case 'perStampType':
        for (const stamp of HOLIDAY_STAMPS) {
          keys.push(`${STANDARD_PREFIX}${padded}-${slug}-${stamp}-1of1`);
        }
        break;
      case 'perPlateColor':
        for (const color of PLATE_COLORS) {
          keys.push(`${STANDARD_PREFIX}${padded}-${slug}-${color}-1of1`);
        }
        break;
      default:
        throw new Error(`unsupported serialMode: ${v.serialMode}`);
    }
  }
  return keys;
}

/**
 * Number of distinct Spaniel-checklist card keys for a dogId.
 * (Not including generic commons or mythic inserts.)
 *
 * @param {number} dogId
 * @returns {number}
 */
export function cardKeyCountForDog(dogId) {
  if (!isValidDogId(dogId)) throw new Error(`invalid dogId: ${dogId}`);
  if (isMythicDogId(dogId)) return 1;
  return 4_468;
}
