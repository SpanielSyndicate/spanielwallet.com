// Spaniel Syndicate — deterministic personality, backstory, generic
// design name, and mythic-insert flavor generator.
//
// Pure functions of the public card identity. No LLM. No user input.
// Identical output for identical inputs forever. Used by the canonical
// Spaniel Asset Engine to fill the trading-card-back text fields when
// the caller does not supply a richer `opts.lore` from the private
// ops-side engine (engine/lore.cjs).
//
// The procedural style is intentional: the standard set has 309M
// cards and the generic-common set has 690M; we cannot author 1B
// strings. Per-mythic strings live in mythic-lore.js (49 currently
// authored; 20 more required before final manifest generation).

import { isMythicDogId, isStandardDogId, isValidGenericDesignId } from './series1.js';
import { fnv32 } from './util-hash.js';

export const PERSONALITY_VERSION = 'personality-v1';

function pick(arr, hashSeed) {
  return arr[hashSeed % arr.length];
}

// ────────────────────────────────────────────────────────────────────
// Personality tags (4 per standard Spaniel)
// ────────────────────────────────────────────────────────────────────
//
// The tag pools are organised by trait axis. The cardKey hash picks
// one tag per axis; the four-tag tuple is deterministic and stable.

const TAG_TEMPERAMENT = Object.freeze([
  'loyal', 'aloof', 'goofy', 'serious', 'shy', 'bold', 'mellow', 'wired',
  'curious', 'patient', 'restless', 'gentle', 'stubborn', 'eager'
]);

const TAG_ENERGY = Object.freeze([
  'high-energy', 'low-key', 'zoomies-prone', 'nap-loyalist', 'walk-pacer',
  'sprint-fan', 'lap-curler', 'window-watcher', 'porch-philosopher'
]);

const TAG_HABIT = Object.freeze([
  'treat-locator', 'ball-obsessed', 'sock-thief', 'rug-burrower',
  'shoe-inspector', 'leaf-chaser', 'puddle-strider', 'snow-rolling',
  'sunbeam-tracker', 'doorbell-announcer'
]);

const TAG_VOICE = Object.freeze([
  'quiet-watcher', 'soft-howler', 'porch-barker', 'sigh-sayer',
  'whisper-whiner', 'song-of-evening', 'silent-side-eye', 'half-bark-half-mumble'
]);

// ────────────────────────────────────────────────────────────────────
// Backstory templates (standard Spaniel)
// ────────────────────────────────────────────────────────────────────
//
// 8 templates × deterministic per-card slot picks. The templates are
// intentionally short, kennel-toned, family-friendly, and free of
// investment / yield / passive-income language (CLAUDE.md §0).

const BACKSTORY_TEMPLATES = Object.freeze([
  (n, t) => `Spaniel #${n} grew up ${t.habit}; the kennel knew them first by their ${t.voice}.`,
  (n, t) => `Found ${t.habit}, kept ${t.temperament}. The papers said little; the porch knew everything.`,
  (n, t) => `${cap(t.temperament)} on Mondays, ${t.energy} by Friday. Spaniel #${n} runs the calendar.`,
  (n, t) => `Spaniel #${n} writes their day in three chapters: ${t.energy}, ${t.habit}, ${t.voice}.`,
  (n, t) => `The Syndicate ledger marks #${n} as ${t.temperament}; the dog-park ledger insists on ${t.energy}.`,
  (n, t) => `Reads a room ${t.temperament}, leaves it ${t.energy}. Spaniel #${n} keeps no other timetable.`,
  (n, t) => `Trained nobody. Taught everyone. Spaniel #${n} — ${t.habit} by choice, ${t.voice} by craft.`,
  (n, t) => `If you've heard a ${t.voice} carry across the kennel after dark, you've heard #${n}.`
]);

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function tagsForStandardSpaniel(cardKey) {
  const h1 = fnv32(`spaniel:temperament:${cardKey}`);
  const h2 = fnv32(`spaniel:energy:${cardKey}`);
  const h3 = fnv32(`spaniel:habit:${cardKey}`);
  const h4 = fnv32(`spaniel:voice:${cardKey}`);
  return {
    temperament: pick(TAG_TEMPERAMENT, h1),
    energy: pick(TAG_ENERGY, h2),
    habit: pick(TAG_HABIT, h3),
    voice: pick(TAG_VOICE, h4)
  };
}

/**
 * Deterministic personality tag tuple for a standard Spaniel card.
 *
 * @param {string} cardKey
 * @param {number} dogId
 * @returns {{ temperament: string, energy: string, habit: string, voice: string, tags: string[] }}
 */
export function personalityForStandardSpaniel(cardKey, dogId) {
  if (!isStandardDogId(dogId)) {
    throw new Error(`personalityForStandardSpaniel: dogId ${dogId} is not a standard dog`);
  }
  const t = tagsForStandardSpaniel(cardKey);
  return { ...t, tags: [t.temperament, t.energy, t.habit, t.voice] };
}

/**
 * Deterministic short backstory for a standard Spaniel card.
 *
 * @param {string} cardKey
 * @param {number} dogId
 * @returns {string}
 */
export function backstoryForStandardSpaniel(cardKey, dogId) {
  if (!isStandardDogId(dogId)) {
    throw new Error(`backstoryForStandardSpaniel: dogId ${dogId} is not a standard dog`);
  }
  const t = tagsForStandardSpaniel(cardKey);
  const templateIdx = fnv32(`spaniel:backstory:${cardKey}`) % BACKSTORY_TEMPLATES.length;
  return BACKSTORY_TEMPLATES[templateIdx](dogId, t);
}

// ────────────────────────────────────────────────────────────────────
// Generic-common design names (420 entries, deterministic from id)
// ────────────────────────────────────────────────────────────────────
//
// Generic commons mimic a physical trading-card pack's "common-object"
// inserts: Dog Treat, Tennis Ball, Squeaky Toy, Leash, Collar, etc.
// Per CLAUDE.md §2.1 the design count is 420; we pick one of 21
// concept families and tag the design slot with a deterministic
// modifier so {Dog Treat I, Dog Treat II, ...} read like a checklist.

const GENERIC_CONCEPT_FAMILIES = Object.freeze([
  'Dog Treat',
  'Tennis Ball',
  'Squeaky Toy',
  'Leash',
  'Collar',
  'Chewed Shoe',
  'Tug Rope',
  'Frisbee',
  'Kibble Bag',
  'Water Bowl',
  'Food Bowl',
  'Kennel Key',
  'Plush Toy',
  'Bone',
  'Brush',
  'Travel Bag',
  'Pillow Bed',
  'Window Pillow',
  'Porch Mat',
  'Park Map',
  'Walk Pass'
]);

const GENERIC_MODIFIERS = Object.freeze([
  '— Standard',
  '— Worn',
  '— Glossy',
  '— Reissue',
  '— Foil-Stamped',
  '— Limited Print',
  '— Park Edition',
  '— Kennel Edition',
  '— Holiday Edition',
  '— Showroom Edition',
  '— Field Edition',
  '— Pup-Sized',
  '— Vintage',
  '— Vault Pull',
  '— Signed Sleeve',
  '— Loyalty Series',
  '— Treat Series',
  '— Splash Series',
  '— Backyard Series',
  '— Squad Series'
]);

const GENERIC_FLAVOR_TEMPLATES = Object.freeze([
  (n) => `${n}. Useful in your kennel. Common, but never wasted.`,
  (n) => `${n}. Spaniel-approved. Stack three of these to round out a deck.`,
  (n) => `${n}. The kennel has a hundred of these; you only need one.`,
  (n) => `${n}. Common, common, common — until the day you reach for it.`,
  (n) => `${n}. Standard issue. Every kennel ledger lists it first.`,
  (n) => `${n}. Earned, not bought — pulled from the pack like every other common.`
]);

export const GENERIC_CONCEPT_FAMILY_COUNT = GENERIC_CONCEPT_FAMILIES.length; // 21
export const GENERIC_MODIFIER_COUNT = GENERIC_MODIFIERS.length;             // 20

/**
 * Deterministic concept name for a generic-common design id.
 *
 * 420 design ids × 21 concept families × 20 modifiers = enough headroom
 * for the full Series 1 generic-common roster without collisions.
 *
 * @param {number} designId 1..420
 * @returns {string} e.g. "Dog Treat — Standard"
 */
export function genericDesignName(designId) {
  const id = Number(designId);
  if (!isValidGenericDesignId(id)) {
    throw new Error(`genericDesignName: invalid designId ${designId}`);
  }
  const familyIdx = (id - 1) % GENERIC_CONCEPT_FAMILIES.length;
  const modifierIdx = Math.floor((id - 1) / GENERIC_CONCEPT_FAMILIES.length) % GENERIC_MODIFIERS.length;
  return `${GENERIC_CONCEPT_FAMILIES[familyIdx]} ${GENERIC_MODIFIERS[modifierIdx]}`;
}

/**
 * Deterministic flavor text for a generic-common design id.
 *
 * @param {number} designId 1..420
 * @returns {string}
 */
export function genericDesignFlavor(designId) {
  const id = Number(designId);
  if (!isValidGenericDesignId(id)) {
    throw new Error(`genericDesignFlavor: invalid designId ${designId}`);
  }
  const name = genericDesignName(id);
  const t = GENERIC_FLAVOR_TEMPLATES[(id - 1) % GENERIC_FLAVOR_TEMPLATES.length];
  return t(name);
}

// ────────────────────────────────────────────────────────────────────
// Mythic-insert flavor (351 entries, deterministic from insertId)
// ────────────────────────────────────────────────────────────────────
//
// Mythic-class inserts are 1/1 "anomaly" cards with no dogId. Each one
// gets a deterministic short flavor line until the operator authors
// the final per-insert lore catalog. Final flavor lives in the manifest
// generator under ops/manifests/private/<seriesId>/.

const INSERT_CATEGORIES = Object.freeze([
  'Lore Artifact',
  'Rescue Miracle',
  'Anomaly',
  'Kennel Relic',
  'Field Witness',
  'Vault Echo',
  'Syndicate Sigil',
  'Daybreak Token',
  'Nightwatch Token',
  'Stray Map'
]);

const INSERT_FLAVOR_TEMPLATES = Object.freeze([
  (cat, id) => `${cat} #${id}. 1/1. Filed under the kennel oddities ledger.`,
  (cat, id) => `${cat} #${id}. 1/1. Authored by the manifest, witnessed by the porch.`,
  (cat, id) => `${cat} #${id}. 1/1. Anomaly recorded; no further copies exist.`,
  (cat, id) => `${cat} #${id}. 1/1. The Syndicate's quiet flex — not for everyone, but for someone.`,
  (cat, id) => `${cat} #${id}. 1/1. Pull this and the binder rearranges itself around it.`
]);

/**
 * Deterministic short flavor for a mythic-insert card.
 *
 * @param {number} insertId 1..351
 * @returns {string}
 */
export function mythicInsertFlavor(insertId) {
  const id = Number(insertId);
  if (!Number.isInteger(id) || id < 1 || id > 351) {
    throw new Error(`mythicInsertFlavor: invalid insertId ${insertId}`);
  }
  const cat = INSERT_CATEGORIES[(id - 1) % INSERT_CATEGORIES.length];
  const t = INSERT_FLAVOR_TEMPLATES[(id - 1) % INSERT_FLAVOR_TEMPLATES.length];
  return t(cat, String(id).padStart(3, '0'));
}

/**
 * Deterministic display name for a mythic-insert card.
 *
 * @param {number} insertId
 * @returns {string}
 */
export function mythicInsertName(insertId) {
  const id = Number(insertId);
  if (!Number.isInteger(id) || id < 1 || id > 351) {
    throw new Error(`mythicInsertName: invalid insertId ${insertId}`);
  }
  const cat = INSERT_CATEGORIES[(id - 1) % INSERT_CATEGORIES.length];
  return `${cat} #${String(id).padStart(3, '0')}`;
}

// ────────────────────────────────────────────────────────────────────
// True mythic Spaniel name fallback
// ────────────────────────────────────────────────────────────────────
//
// When a true mythic dogId has no entry in MYTHIC_LORE (the 20
// not-yet-authored slots), the engine still needs a stable display
// label. We deliberately mark these as "Reserved" so the UI never
// presents a placeholder as canonical lore.

/**
 * Fallback display name for a true mythic dog whose lore is not yet
 * authored. Used by the canonical engine; the QA audit reports these
 * as a known gap.
 *
 * @param {number} dogId
 * @returns {string}
 */
export function reservedMythicName(dogId) {
  if (!isMythicDogId(dogId)) {
    throw new Error(`reservedMythicName: dogId ${dogId} is not in the authored mythic set`);
  }
  return `Mythic Spaniel #${dogId} (Reserved)`;
}

export const ALL_TAG_AXES = Object.freeze({
  temperament: TAG_TEMPERAMENT,
  energy: TAG_ENERGY,
  habit: TAG_HABIT,
  voice: TAG_VOICE
});
