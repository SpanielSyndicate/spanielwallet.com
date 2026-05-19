// Spaniel Syndicate — Series 1 virtual manifest + draw deck.
//
// The Series 1 print run is 1,000,000,000 cards. The manifest never
// materializes a billion rows. Instead it defines:
//
//   1. A canonical card-instance index space `[0, N)` where N = 1B.
//      The instance index uniquely identifies one card — its class,
//      design/dog/variant, and serial — via arithmetic ranges over
//      the locked supply counts. No table lookup is required.
//
//   2. A deterministic seeded permutation `pi(slot) → instanceIndex`
//      mapping draw slot `slot ∈ [1, N]` to a card-instance index in
//      `[0, N)`. We use a cycle-walked Feistel format-preserving
//      permutation: for N that isn't a perfect power of two, build a
//      Feistel permutation over `[0, 2^ceil(log2(N)))` and cycle-walk
//      (re-apply) until the output is < N. The cycle adds at most
//      `2^ceil(log2(N)) / N` extra rounds per call, which for N=1B
//      is ~1.07 — fast in JS, deterministic, and no replacement.
//
//   3. A public commitment ({ algorithmVersion, supplyConstants,
//      curveCommitmentHash, entropySeedHash, cardDefinitionCommitment,
//      generatorVersion, generatedAt }) suitable for `drops/series1-
//      commitment.json`. The hidden draw order is committed via the
//      entropy seed hash and not revealed until launch policy permits.
//
// This file does NOT generate a 1B JSON manifest. It exposes pure
// functions that resolve any draw slot or card-instance index on
// demand. Tests run in microseconds even for boundary slots.

import {
  TOTAL_CARD_SUPPLY,
  STANDARD_CARD_TOTAL,
  TRUE_MYTHIC_COUNT,
  MYTHIC_INSERT_COUNT,
  STANDARD_DOG_COUNT,
  CARDS_PER_STANDARD_DOG,
  GENERIC_DESIGN_COUNT,
  GENERIC_HIGH_DESIGN_COUNT,
  GENERIC_HIGH_PRINTS_PER_DESIGN,
  GENERIC_LOW_PRINTS_PER_DESIGN,
  GENERIC_COMMON_TOTAL,
  STANDARD_VARIANT_SLUGS,
  VARIANTS,
  HOLIDAY_STAMPS,
  PLATE_COLORS,
  isMythicDogId,
  isStandardDogId,
  isValidDogId,
  validateFinalMythicAssets,
  validatePrintRun,
  MYTHIC_DOG_IDS
} from './series1.js';

export const MANIFEST_ALGORITHM_VERSION = 'series1-manifest-v1';

// ────────────────────────────────────────────────────────────────────
// Card-instance index space (deterministic arithmetic ranges)
// ────────────────────────────────────────────────────────────────────
//
// Layout (contiguous, no gaps):
//
//   [0, GENERIC_COMMON_TOTAL)                      → generic commons
//   [GENERIC_COMMON_TOTAL, +STANDARD_CARD_TOTAL)   → standard Spaniels
//   [.. , +TRUE_MYTHIC_COUNT)                      → true mythic Spaniels
//   [.. , +MYTHIC_INSERT_COUNT)                    → mythic inserts
//
// Standard sub-layout is sorted by standardDog ordinal (0..STANDARD_DOG_COUNT)
// then by the CARDS_PER_STANDARD_DOG-slot per-dog variant table.

const GENERIC_RANGE_START = 0;
const GENERIC_RANGE_END = GENERIC_RANGE_START + GENERIC_COMMON_TOTAL; // exclusive

const STANDARD_RANGE_START = GENERIC_RANGE_END;
const STANDARD_RANGE_END = STANDARD_RANGE_START + STANDARD_CARD_TOTAL;

const TRUE_MYTHIC_RANGE_START = STANDARD_RANGE_END;
const TRUE_MYTHIC_RANGE_END = TRUE_MYTHIC_RANGE_START + TRUE_MYTHIC_COUNT;

const MYTHIC_INSERT_RANGE_START = TRUE_MYTHIC_RANGE_END;
const MYTHIC_INSERT_RANGE_END = MYTHIC_INSERT_RANGE_START + MYTHIC_INSERT_COUNT;

if (MYTHIC_INSERT_RANGE_END !== TOTAL_CARD_SUPPLY) {
  // Defensive: misconfiguration should fail loud at module load time.
  throw new Error(
    `manifest: range layout end ${MYTHIC_INSERT_RANGE_END} != TOTAL_CARD_SUPPLY ${TOTAL_CARD_SUPPLY}`
  );
}

export const INSTANCE_RANGES = Object.freeze({
  generic_common:      { start: GENERIC_RANGE_START,        endExclusive: GENERIC_RANGE_END },
  standard_spaniel:    { start: STANDARD_RANGE_START,       endExclusive: STANDARD_RANGE_END },
  true_mythic_spaniel: { start: TRUE_MYTHIC_RANGE_START,    endExclusive: TRUE_MYTHIC_RANGE_END },
  mythic_insert:       { start: MYTHIC_INSERT_RANGE_START,  endExclusive: MYTHIC_INSERT_RANGE_END }
});

// Per-variant cumulative-end inside the standard-per-dog table.
const STANDARD_VARIANT_OFFSETS = (() => {
  const out = [];
  let cum = 0;
  for (const slug of STANDARD_VARIANT_SLUGS) {
    const v = VARIANTS[slug];
    // perStampType / perPlateColor / single all share the same per-dog
    // count (`perStandardDog`). The earlier ternary explicitly
    // branched but both arms equaled `v.perStandardDog`.
    const cap = v.perStandardDog;
    out.push({ slug, start: cum, endExclusive: cum + cap });
    cum += cap;
  }
  if (cum !== CARDS_PER_STANDARD_DOG) {
    throw new Error(
      `manifest: standard variant offsets cum ${cum} != CARDS_PER_STANDARD_DOG ${CARDS_PER_STANDARD_DOG}`
    );
  }
  return out;
})();

// ────────────────────────────────────────────────────────────────────
// Card-instance ↔ identity mapping
// ────────────────────────────────────────────────────────────────────

/**
 * Resolve a card-instance index to its identity record.
 *
 * Cheap: O(log standard-variants) ≈ O(1).
 *
 * @param {number|bigint} instanceIdx in [0, TOTAL_CARD_SUPPLY)
 * @param {object} args
 * @param {number[]} [args.standardDogIdOrder] — length STANDARD_DOG_COUNT;
 *                    canonical sort of non-mythic dog ids ascending. If
 *                    omitted, computed deterministically from MYTHIC_DOG_IDS
 *                    (warning: only the 49 *currently* authored mythics are
 *                    excluded; final manifest mode must supply the full 69).
 * @param {number[]} [args.mythicDogIdOrder] — length TRUE_MYTHIC_COUNT;
 *                    canonical sort of mythic dog ids. Required in
 *                    final mode; defaults to MYTHIC_DOG_IDS in dev.
 */
export function instanceIndexToCard(instanceIdx, args = {}) {
  const idx = Number(instanceIdx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= TOTAL_CARD_SUPPLY) {
    throw new Error(`instanceIdx out of range: ${instanceIdx}`);
  }

  // 1) Generic common.
  if (idx < GENERIC_RANGE_END) {
    return resolveGeneric(idx - GENERIC_RANGE_START);
  }
  // 2) Standard Spaniel.
  if (idx < STANDARD_RANGE_END) {
    return resolveStandard(idx - STANDARD_RANGE_START, args);
  }
  // 3) True mythic.
  if (idx < TRUE_MYTHIC_RANGE_END) {
    return resolveTrueMythic(idx - TRUE_MYTHIC_RANGE_START, args);
  }
  // 4) Mythic insert.
  return resolveMythicInsert(idx - MYTHIC_INSERT_RANGE_START);
}

function resolveGeneric(within) {
  // 352 designs print 1,643,189 each, then 68 designs print 1,643,188 each.
  const HIGH_BLOCK = GENERIC_HIGH_DESIGN_COUNT * GENERIC_HIGH_PRINTS_PER_DESIGN;
  let designId, serial, printCount;
  if (within < HIGH_BLOCK) {
    designId = Math.floor(within / GENERIC_HIGH_PRINTS_PER_DESIGN) + 1;
    serial = (within % GENERIC_HIGH_PRINTS_PER_DESIGN) + 1;
    printCount = GENERIC_HIGH_PRINTS_PER_DESIGN;
  } else {
    const rest = within - HIGH_BLOCK;
    designId = GENERIC_HIGH_DESIGN_COUNT + Math.floor(rest / GENERIC_LOW_PRINTS_PER_DESIGN) + 1;
    serial = (rest % GENERIC_LOW_PRINTS_PER_DESIGN) + 1;
    printCount = GENERIC_LOW_PRINTS_PER_DESIGN;
  }
  return {
    cardClass: 'generic_common',
    variant: 'generic',
    genericDesignId: designId,
    dogId: null,
    mythicInsertId: null,
    serial,
    printCount,
    stampType: null,
    plateColor: null,
    rarityGroup: 'common'
  };
}

/**
 * Compute the deterministic standard-dog id list (length
 * STANDARD_DOG_COUNT, ascending) given an explicit mythic exclusion
 * set. Final manifest mode MUST pass the full 69-id exclusion set —
 * otherwise additional mythics would silently land in the standard
 * stream.
 *
 * Dev/legacy callers can omit `mythicDogIds`, in which case the
 * function falls back to MYTHIC_DOG_IDS (the 49 currently authored
 * mythics). The function no longer caps the scan at
 * `STANDARD_DOG_COUNT + EXISTING_MYTHIC_COUNT`; it walks until it has
 * collected STANDARD_DOG_COUNT non-mythic ids or runs out of canonical
 * dog ids — whichever happens first. With a final (69-id) exclusion
 * set this lands exactly at CANONICAL_DOG_COUNT.
 *
 * @param {ReadonlyArray<number>} [mythicDogIds]
 */
function computeStandardDogIdOrder(mythicDogIds) {
  const exclusion = Array.isArray(mythicDogIds) && mythicDogIds.length > 0
    ? mythicDogIds
    : MYTHIC_DOG_IDS;
  const myth = new Set(exclusion);
  const out = [];
  // Walk through every canonical id (1..CANONICAL_DOG_COUNT). The
  // upper bound used to be `STANDARD_DOG_COUNT + EXISTING_MYTHIC_COUNT`
  // which silently truncated the search space when more mythic ids
  // were excluded than the legacy 49 — final mode would then return
  // a short standard list and downstream code would access undefined
  // dog ids.
  const SCAN_UPPER = 69_420; // CANONICAL_DOG_COUNT — kept literal to avoid circular import.
  for (let id = 1; id <= SCAN_UPPER; id++) {
    if (myth.has(id)) continue;
    out.push(id);
    if (out.length === STANDARD_DOG_COUNT) return out;
  }
  // If we exhausted the canonical id space without collecting enough
  // standard ids, the exclusion set must be wrong (too many mythics,
  // overlapping ids, etc.). Fail loud rather than return a short list.
  throw new Error(
    `computeStandardDogIdOrder: only collected ${out.length} standard dog ids ` +
    `(needed ${STANDARD_DOG_COUNT}) — exclusion set has ${myth.size} mythic ids`
  );
}

function resolveStandard(within, args) {
  const dogIdx = Math.floor(within / CARDS_PER_STANDARD_DOG);
  const inDog = within % CARDS_PER_STANDARD_DOG;
  // Final mode: caller passes `standardDogIdOrder` (precomputed against
  // the full 69-id mythic exclusion). Otherwise: derive from the
  // caller's mythicDogIdOrder if supplied, else fall back to the 49
  // currently-authored set. The fallback is dev-only and will refuse
  // to run in final mode (see assertFinalManifestReady).
  const dogIds =
    args.standardDogIdOrder ??
    computeStandardDogIdOrder(args.mythicDogIdOrder);
  const dogId = dogIds[dogIdx];
  if (!isValidDogId(dogId) || !isStandardDogId(dogId)) {
    throw new Error(`resolveStandard: invalid dogId at index ${dogIdx}`);
  }
  // Find variant slot.
  let variantSlug = null;
  let withinVariant = 0;
  for (const off of STANDARD_VARIANT_OFFSETS) {
    if (inDog < off.endExclusive) {
      variantSlug = off.slug;
      withinVariant = inDog - off.start;
      break;
    }
  }
  if (!variantSlug) throw new Error(`resolveStandard: no variant covers slot ${inDog}`);
  const v = VARIANTS[variantSlug];
  let serial = 1;
  let printCount = v.perStandardDog;
  let stampType = null;
  let plateColor = null;
  switch (v.serialMode) {
    case 'single':
      serial = withinVariant + 1;
      break;
    case 'perStampType':
      stampType = HOLIDAY_STAMPS[withinVariant];
      printCount = 1;
      break;
    case 'perPlateColor':
      plateColor = PLATE_COLORS[withinVariant];
      printCount = 1;
      break;
    default:
      throw new Error(`unsupported serialMode ${v.serialMode}`);
  }
  return {
    cardClass: 'standard_spaniel',
    variant: variantSlug,
    dogId,
    genericDesignId: null,
    mythicInsertId: null,
    serial,
    printCount,
    stampType,
    plateColor,
    rarityGroup: v.rarityGroup
  };
}

function resolveTrueMythic(within, args) {
  const ids = args.mythicDogIdOrder ?? MYTHIC_DOG_IDS;
  if (within >= ids.length) {
    throw new Error(
      `resolveTrueMythic: only ${ids.length} authored mythic ids available — final mode requires ${TRUE_MYTHIC_COUNT}. Provide mythicDogIdOrder.`
    );
  }
  const dogId = ids[within];
  if (!isMythicDogId(dogId) && !isValidDogId(dogId)) {
    throw new Error(`resolveTrueMythic: invalid dogId at index ${within}`);
  }
  return {
    cardClass: 'true_mythic_spaniel',
    variant: 'mythic',
    dogId,
    genericDesignId: null,
    mythicInsertId: null,
    serial: 1,
    printCount: 1,
    stampType: null,
    plateColor: null,
    rarityGroup: 'mythic'
  };
}

function resolveMythicInsert(within) {
  return {
    cardClass: 'mythic_insert',
    variant: 'mythic_insert',
    dogId: null,
    genericDesignId: null,
    mythicInsertId: within + 1,
    serial: 1,
    printCount: 1,
    stampType: null,
    plateColor: null,
    rarityGroup: 'mythic'
  };
}

// ────────────────────────────────────────────────────────────────────
// Deterministic seeded permutation (cycle-walked Feistel FPE)
// ────────────────────────────────────────────────────────────────────
//
// Maps draw slot `slot ∈ [1, TOTAL_CARD_SUPPLY]` to a card-instance
// index in `[0, TOTAL_CARD_SUPPLY)` such that:
//
//   - For a fixed seed, the mapping is a true permutation (bijective,
//     every instance appears exactly once).
//   - Identical seeds + slots produce identical outputs.
//   - Different seeds produce different orderings.
//
// We need an N-bit-ish FPE; 1,000,000,000 fits in 30 bits but isn't a
// power of two. We construct a 32-bit Feistel network (2 × 16-bit
// halves) over the domain [0, 2^32) and cycle-walk into [0, 1e9).
//
// The Feistel round function is SipHash-style mixing of (round, seed,
// half) into 32 bits. Cryptographically weak, but the goal is a
// uniformly-distributed, publicly-committed permutation — not a
// secret. Use the seed commitment for verifiability.

const FEISTEL_DOMAIN_BITS = 30;
const FEISTEL_DOMAIN = 1 << FEISTEL_DOMAIN_BITS; // 2^30 = 1,073,741,824 ≥ 1e9
const FEISTEL_HALF_BITS = FEISTEL_DOMAIN_BITS / 2; // 15 → halves
const FEISTEL_HALF_MASK = (1 << FEISTEL_HALF_BITS) - 1; // 0x7FFF

// 4 rounds is a permutation; for a public commitment we use 6 to push
// the diffusion bias to negligible. Cost: ~600M cycles for 1B passes.
const FEISTEL_ROUNDS = 6;

function mixRound(x, seedHi, seedLo, roundIdx) {
  // 32-bit mixing borrowed from xorshift/SplitMix. Stays inside int32
  // semantics with `>>> 0` so we never escape into JS's float space.
  let v = (x ^ (roundIdx * 0x9e3779b1)) >>> 0;
  v = (v + seedLo) >>> 0;
  v = ((v ^ (v >>> 16)) * 0x85ebca6b) >>> 0;
  v = (v + seedHi) >>> 0;
  v = ((v ^ (v >>> 13)) * 0xc2b2ae35) >>> 0;
  v = (v ^ (v >>> 16)) >>> 0;
  return v & FEISTEL_HALF_MASK;
}

function feistelEncrypt(x, seedHi, seedLo) {
  let L = (x >>> FEISTEL_HALF_BITS) & FEISTEL_HALF_MASK;
  let R = x & FEISTEL_HALF_MASK;
  for (let i = 0; i < FEISTEL_ROUNDS; i++) {
    const F = mixRound(R, seedHi, seedLo, i);
    const newL = R;
    const newR = L ^ F;
    L = newL;
    R = newR;
  }
  return ((L << FEISTEL_HALF_BITS) | R) >>> 0;
}

/**
 * Hash a textual seed into a 64-bit pair (hi, lo) used by the
 * Feistel round function. Deterministic, no crypto dependency.
 *
 * @param {string} seed
 */
export function deriveFeistelSeed(seed) {
  const s = String(seed);
  let hi = 0xcafebabe >>> 0;
  let lo = 0xdeadbeef >>> 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    hi = ((hi ^ c) * 0x01000193) >>> 0;
    lo = ((lo + c) * 0x85ebca6b) >>> 0;
    // cross-mix
    hi = ((hi + (lo >>> 13)) ^ 0xa1b2c3d4) >>> 0;
    lo = ((lo + (hi >>> 17)) ^ 0x5a5a5a5a) >>> 0;
  }
  // final avalanche
  hi = ((hi ^ (hi >>> 16)) * 0xc2b2ae35) >>> 0;
  lo = ((lo ^ (lo >>> 16)) * 0x9e3779b1) >>> 0;
  return { hi, lo };
}

/**
 * Map a draw slot (1-indexed) to a card-instance index (0-indexed)
 * deterministically given a seed. Uses cycle-walked Feistel FPE
 * over [0, 2^30).
 *
 * @param {number} slot in [1, TOTAL_CARD_SUPPLY]
 * @param {string} seed textual entropy
 * @returns {number} instance index in [0, TOTAL_CARD_SUPPLY)
 */
export function drawSlotToInstanceIndex(slot, seed) {
  if (!Number.isInteger(slot) || slot < 1 || slot > TOTAL_CARD_SUPPLY) {
    throw new Error(`slot out of range: ${slot}`);
  }
  const { hi, lo } = deriveFeistelSeed(seed);
  // Cycle-walk: start from slot-1 (0-indexed), encrypt until result < N.
  let x = slot - 1;
  // Worst-case walking iterations are bounded by 2^30 / 1e9 ≈ 1.074.
  // In practice almost every slot terminates in 1 or 2 iterations.
  for (let safety = 0; safety < 64; safety++) {
    const y = feistelEncrypt(x, hi, lo);
    if (y < TOTAL_CARD_SUPPLY) return y;
    x = y; // continue walking; permutation property preserved.
  }
  throw new Error(`drawSlotToInstanceIndex: cycle-walk failed for slot ${slot}`);
}

/**
 * Inverse: given a card-instance index, find the draw slot it maps to
 * under `seed`. Cycle-walks the inverse permutation.
 *
 * This is heavier than the forward direction; intended for diagnostic
 * use, not hot paths.
 *
 * @param {number} instanceIdx
 * @param {string} seed
 * @returns {number} slot in [1, TOTAL_CARD_SUPPLY]
 */
export function instanceIndexToDrawSlot(instanceIdx, seed) {
  if (!Number.isInteger(instanceIdx) || instanceIdx < 0 || instanceIdx >= TOTAL_CARD_SUPPLY) {
    throw new Error(`instanceIdx out of range: ${instanceIdx}`);
  }
  const { hi, lo } = deriveFeistelSeed(seed);
  let y = instanceIdx;
  for (let safety = 0; safety < 64; safety++) {
    const x = feistelDecrypt(y, hi, lo);
    if (x < TOTAL_CARD_SUPPLY) return x + 1;
    y = x;
  }
  throw new Error(`instanceIndexToDrawSlot: cycle-walk failed`);
}

function feistelDecrypt(x, seedHi, seedLo) {
  let L = (x >>> FEISTEL_HALF_BITS) & FEISTEL_HALF_MASK;
  let R = x & FEISTEL_HALF_MASK;
  for (let i = FEISTEL_ROUNDS - 1; i >= 0; i--) {
    const F = mixRound(L, seedHi, seedLo, i);
    const newR = L;
    const newL = R ^ F;
    L = newL;
    R = newR;
  }
  return ((L << FEISTEL_HALF_BITS) | R) >>> 0;
}

// ────────────────────────────────────────────────────────────────────
// Public commitment shape
// ────────────────────────────────────────────────────────────────────

/**
 * Build the public commitment object suitable for
 * drops/series1-commitment.json. The seed itself MUST NOT be public;
 * pass its hash via `entropySeedHash`.
 *
 * @param {object} args
 * @param {string} args.entropySeedHash hex digest of the secret seed
 * @param {string} args.curveCommitmentHash hex digest of config/curve.json
 * @param {string} args.cardDefinitionCommitment merkle/identity hash
 * @param {string} args.generatorVersion
 * @param {string} [args.generatedAt] ISO timestamp
 */
export function buildPublicCommitment(args) {
  const {
    entropySeedHash,
    curveCommitmentHash,
    cardDefinitionCommitment,
    generatorVersion,
    generatedAt
  } = args ?? {};
  if (!entropySeedHash || !curveCommitmentHash || !cardDefinitionCommitment || !generatorVersion) {
    throw new Error('buildPublicCommitment: missing required field');
  }
  validatePrintRun();
  return {
    seriesId: 's1',
    algorithmVersion: MANIFEST_ALGORITHM_VERSION,
    totalCardSupply: TOTAL_CARD_SUPPLY,
    canonicalDogCount: 69_420,
    standardDogCount: STANDARD_DOG_COUNT,
    trueMythicCount: TRUE_MYTHIC_COUNT,
    mythicInsertCount: MYTHIC_INSERT_COUNT,
    genericDesignCount: GENERIC_DESIGN_COUNT,
    genericCommonTotal: GENERIC_COMMON_TOTAL,
    standardCardTotal: STANDARD_CARD_TOTAL,
    instanceRanges: INSTANCE_RANGES,
    curveCommitmentHash,
    cardDefinitionCommitment,
    entropySeedHash,
    generatorVersion,
    generatedAt: generatedAt ?? new Date().toISOString()
  };
}

// ────────────────────────────────────────────────────────────────────
// Final-mode validation
// ────────────────────────────────────────────────────────────────────

/**
 * Refuse final manifest generation unless every requirement is met:
 *   - print run invariants hold
 *   - 69 true mythic dog ids supplied
 *   - 351 mythic insert ids supplied
 *   - entropy seed present (non-empty string)
 *   - curve commitment present
 *
 * @param {object} args
 * @param {ReadonlyArray<number>} args.finalMythicDogIds
 * @param {ReadonlyArray<number>} args.mythicInsertIds
 * @param {string} args.entropySeed
 * @param {string} args.curveCommitmentHash
 */
export function assertFinalManifestReady(args) {
  const { finalMythicDogIds, mythicInsertIds, entropySeed, curveCommitmentHash } = args ?? {};
  validatePrintRun();
  validateFinalMythicAssets({ finalMythicDogIds, mythicInsertIds });
  if (typeof entropySeed !== 'string' || entropySeed.length < 16) {
    throw new Error('assertFinalManifestReady: entropySeed missing or too short');
  }
  if (typeof curveCommitmentHash !== 'string' || !curveCommitmentHash) {
    throw new Error('assertFinalManifestReady: curveCommitmentHash required');
  }
  return true;
}
