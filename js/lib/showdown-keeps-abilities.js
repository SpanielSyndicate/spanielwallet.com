// Spaniel Showdown — For Keeps ability registry.
//
// The For Keeps engine adds a deterministic 0..5 ability modifier to
// each side's round total (see showdown-keeps-engine.js
// `abilityModifier`). The exact integer is seeded by
// (cardKey, abilityId, action, roundIndex), so two cards with the
// same abilityId can roll different modifiers in the same round —
// the abilityId is one component of the seed.
//
// This registry is the single source of truth for the user-facing
// description of every ability id the system mints onto a card. The
// goal is to keep the visible text honest:
//
//   - If the launch engine implements the effect, the text says what
//     happens and the handler runs.
//   - If the launch engine only contributes the generic 0..5 variance,
//     the text says exactly that.
//   - If the text drifts ahead of the engine (someone writes "+5 Bark
//     on first attack" before the engine handles it), the audit test
//     in this module's test file catches the drift.
//
// All Series 1 launch abilities are kind: 'variance' — no specialized
// handler. The handler hook is wired in so future series can ship
// per-ability behaviors without touching the engine signature.

export const KEEPS_ABILITY_REGISTRY_VERSION = 'showdown-for-keeps-abilities-v1';

/**
 * Possible registry kinds:
 *   - 'variance' : contributes only the engine's generic 0..5 modifier.
 *                  No specialized handler. Most launch abilities.
 *   - 'handler'  : has a deterministic per-round handler defined here.
 *                  RESERVED FOR FUTURE — none ship with launch.
 *   - 'flavor'   : no engine effect at all; pure card-back flavor text.
 *
 * Adding a new ability id requires either an entry here OR a flavor
 * marker; the audit test refuses to merge cards whose abilityId is
 * not in the registry.
 */
export const KEEPS_ABILITY_KINDS = Object.freeze(['variance', 'handler', 'flavor']);

const GENERIC_VARIANCE_TEXT =
  'Adds a small deterministic 0..5 modifier to one of your action totals each round.';

/**
 * Pup abilities (every Spaniel card gets one of these by rarity
 * group). All launch as kind: 'variance' — the engine's generic 0..5
 * modifier is the entire effect at launch. The text below is written
 * to describe that effect honestly; we DO NOT promise per-ability
 * behaviours that the engine does not yet execute.
 */
const PUP_ENTRIES = [
  {
    id: 'bonus.bark',
    name: 'Pup — Bonus Bark',
    text: GENERIC_VARIANCE_TEXT,
    kind: 'variance'
  },
  {
    id: 'shield.morale',
    name: 'Pup — Shield Morale',
    text: GENERIC_VARIANCE_TEXT,
    kind: 'variance'
  },
  {
    id: 'critical.zoom',
    name: 'Pup — Critical Zoom',
    text: GENERIC_VARIANCE_TEXT,
    kind: 'variance'
  },
  {
    id: 'rebound.heart',
    name: 'Pup — Rebound Heart',
    text: GENERIC_VARIANCE_TEXT,
    kind: 'variance'
  },
  {
    id: 'mythic.aura',
    name: 'Mythic — Aura',
    text: GENERIC_VARIANCE_TEXT,
    kind: 'variance'
  }
];

/**
 * Support effects (Trick / Toy / Treat / Gear / Rescue) shipped on
 * generic commons. Every Series 1 generic id maps to one of these
 * via effectIdForGenericDesign. They all launch as kind: 'variance'
 * — same engine treatment as the Pup abilities.
 */
const SUPPORT_ENTRIES = (() => {
  const slots = [
    ['trick',  ['feint', 'misdirect', 'snap', 'fakeout']],
    ['toy',    ['squeak', 'fetch', 'spin', 'tug']],
    ['treat',  ['biscuit', 'jerky', 'kibble', 'gravy']],
    ['gear',   ['collar', 'leash', 'tag', 'harness']],
    ['rescue', ['paw', 'patch', 'shelter', 'rally']]
  ];
  const out = [];
  for (const [family, names] of slots) {
    for (const n of names) {
      out.push({
        id: `${family}.${n}`,
        name: `${cap(family)} — ${cap(n)}`,
        text: GENERIC_VARIANCE_TEXT,
        kind: 'variance'
      });
    }
  }
  return out;
})();

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * Mythic-insert abilities. Each of the 351 inserts has a unique id
 * (`anomaly.insert.NNN`). All launch as kind: 'flavor' — the engine
 * grants the generic 0..5 variance to every ability-bearing card,
 * but the *narrative* effect on the card lore is unique per insert
 * and is NOT a mechanical bonus at launch.
 *
 * Rather than enumerate 351 entries, we expose a predicate
 * (`isMythicInsertAbilityId`) and the registry lookup falls through
 * to a shared "Mythic Insert" entry. Future series can promote
 * specific inserts to kind: 'handler' as their effects are
 * implemented.
 */
const MYTHIC_INSERT_RE = /^anomaly\.insert\.\d{3}$/;

export function isMythicInsertAbilityId(id) {
  return typeof id === 'string' && MYTHIC_INSERT_RE.test(id);
}

const MYTHIC_INSERT_FALLBACK = Object.freeze({
  id: 'anomaly.insert.*',
  name: 'Mythic Insert',
  text: 'Unique 1/1 mythic insert. Adds the same 0..5 round-to-round variance as any ability-bearing card; the card lore is its own.',
  kind: 'variance'
});

// ─── compile registry ────────────────────────────────────────

const REGISTRY = new Map();
for (const e of [...PUP_ENTRIES, ...SUPPORT_ENTRIES]) {
  if (REGISTRY.has(e.id)) throw new Error(`duplicate ability id in registry: ${e.id}`);
  if (!KEEPS_ABILITY_KINDS.includes(e.kind)) {
    throw new Error(`invalid kind for ${e.id}: ${e.kind}`);
  }
  REGISTRY.set(e.id, Object.freeze(e));
}

/**
 * Look up a registry entry by ability id. Returns the canonical
 * frozen entry, or null if the id is unknown to the registry.
 * Mythic inserts fall through to the shared insert entry.
 *
 * @param {string} id
 * @returns {object|null}
 */
export function getKeepsAbility(id) {
  if (typeof id !== 'string' || !id) return null;
  if (REGISTRY.has(id)) return REGISTRY.get(id);
  if (isMythicInsertAbilityId(id)) {
    return Object.freeze({ ...MYTHIC_INSERT_FALLBACK, id });
  }
  return null;
}

/**
 * All known ability ids (in registration order). Mythic insert ids
 * are NOT enumerated here — there are 351 of them and they collapse
 * to a single entry via the predicate above.
 */
export function listKnownKeepsAbilityIds() {
  return [...REGISTRY.keys()];
}

/**
 * Trigger hook (RESERVED FOR FUTURE). Future series can ship
 * handler-kind abilities by adding an entry with kind: 'handler'
 * and a `compute({ card, action, roundIndex, side, state })`
 * function that returns an integer 0..5 to be ADDED to the engine's
 * generic 0..5 modifier (then capped to 0..5 by the engine, see the
 * `maxTriggers` invariant below).
 *
 * At launch this hook returns 0 for every ability. The engine does
 * NOT call it. It exists so future engine versions can wire it in
 * without changing the registry shape.
 *
 * @param {string} id
 * @returns {number}
 */
export function abilityHandlerBonus(/* id, ctx */) {
  // Launch invariant: no handlers wired. Future versions MUST ensure
  // the returned bonus + the engine's variance still fits in 0..5.
  return 0;
}

/**
 * Cap on per-round handler bonus a non-launch ability may add. Even
 * if a future series adds a handler, the engine must not let any
 * single round's ability modifier exceed `ABILITY_MODIFIER_MAX` (5)
 * — the round-damage math depends on the 0..5 bound. Documenting
 * this constant here so future authors don't drift the engine cap.
 */
export const KEEPS_ABILITY_MAX_TRIGGERS_PER_MATCH = 1;
export const KEEPS_ABILITY_HANDLER_BONUS_MAX = 5;
