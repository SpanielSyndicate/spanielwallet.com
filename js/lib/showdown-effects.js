// Spaniel Showdown — support card effect rules.
//
// Effect rule text is purely declarative. Each support-effect id maps
// to a small JSON shape that the engine consumes; no JS callbacks, no
// dynamic dispatch. This keeps replays deterministic and the engine
// auditable from a tx log.
//
// Effect ids match showdown-cards.js:effectIdForGenericDesign, plus
// the per-ability ids in PUP_ABILITY_BY_RARITY + anomaly.insert.*.

export const SHOWDOWN_EFFECTS_VERSION = 'showdown-effects-v1';

// Effect modifier shape:
//   { kind: 'stat_bonus', stat: 'bark', amount: 8 }
//   { kind: 'stat_swap', from: 'mischief', to: 'grit' }
//   { kind: 'block', stat: 'bite' }
//   { kind: 'heal', amount: 4 }
//   { kind: 'tempo_swing', direction: 'forward' }

const SUPPORT_EFFECTS = Object.freeze({
  // Trick — opening/disrupt
  'trick.feint':     { kind: 'stat_bonus', stat: 'sniff',    amount: 8,  category: 'trick' },
  'trick.misdirect': { kind: 'block',      stat: 'bite',                category: 'trick' },
  'trick.snap':      { kind: 'stat_bonus', stat: 'bite',     amount: 6,  category: 'trick' },
  'trick.fakeout':   { kind: 'stat_swap',  from: 'mischief', to: 'grit', category: 'trick' },

  // Toy — bark/zoomies/momentum
  'toy.squeak': { kind: 'stat_bonus', stat: 'bark',    amount: 10, category: 'toy' },
  'toy.fetch':  { kind: 'stat_bonus', stat: 'zoomies', amount: 8,  category: 'toy' },
  'toy.spin':   { kind: 'tempo_swing', direction: 'forward',       category: 'toy' },
  'toy.tug':    { kind: 'stat_bonus', stat: 'grit',    amount: 6,  category: 'toy' },

  // Treat — heart/loyalty/heal
  'treat.biscuit': { kind: 'stat_bonus', stat: 'loyalty', amount: 8,  category: 'treat' },
  'treat.jerky':   { kind: 'stat_bonus', stat: 'bite',    amount: 4,  category: 'treat' },
  'treat.kibble':  { kind: 'heal',       amount: 4,                  category: 'treat' },
  'treat.gravy':   { kind: 'stat_bonus', stat: 'charm',   amount: 6,  category: 'treat' },

  // Gear — persistent shoring up
  'gear.collar':   { kind: 'stat_bonus', stat: 'grit',     amount: 5, category: 'gear' },
  'gear.leash':    { kind: 'block',      stat: 'mischief',           category: 'gear' },
  'gear.tag':      { kind: 'stat_bonus', stat: 'loyalty',  amount: 5, category: 'gear' },
  'gear.harness':  { kind: 'stat_bonus', stat: 'sniff',    amount: 5, category: 'gear' },

  // Rescue — heart, comeback, community
  'rescue.paw':     { kind: 'heal',       amount: 6,                category: 'rescue' },
  'rescue.patch':   { kind: 'heal',       amount: 8,                category: 'rescue' },
  'rescue.shelter': { kind: 'block',      stat: 'mischief',         category: 'rescue' },
  'rescue.rally':   { kind: 'stat_bonus', stat: 'loyalty', amount: 9, category: 'rescue' }
});

const PUP_ABILITIES = Object.freeze({
  'bonus.bark':     { kind: 'stat_bonus',  stat: 'bark',    amount: 6,  scope: 'self' },
  'shield.morale':  { kind: 'block',       stat: 'mischief',           scope: 'self' },
  'critical.zoom':  { kind: 'stat_bonus',  stat: 'zoomies', amount: 10, scope: 'self' },
  'rebound.heart':  { kind: 'heal',        amount: 5,                  scope: 'self' },
  'mythic.aura':    { kind: 'stat_bonus',  stat: 'charm',   amount: 12, scope: 'self' }
});

export function getSupportEffect(id) {
  if (typeof id !== 'string') return null;
  return SUPPORT_EFFECTS[id] || null;
}

export function getPupAbility(id) {
  if (typeof id !== 'string') return null;
  return PUP_ABILITIES[id] || null;
}

export function listSupportEffectIds() {
  return Object.keys(SUPPORT_EFFECTS);
}

export function listPupAbilityIds() {
  return Object.keys(PUP_ABILITIES);
}

export { SUPPORT_EFFECTS, PUP_ABILITIES };
