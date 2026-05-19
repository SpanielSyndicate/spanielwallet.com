// Spaniel Showdown — Fun Mode demo cards + deterministic opponents.
//
// Builds demo lineups so Fun Mode can run without a real binder, and
// provides three deterministic opponent strategies that pick an
// action per round from a seed (no live randomness mid-match):
//
//   mirror         — opponent plays the same action the player chose.
//   random_demo    — opponent picks Bark/Bite/Zoom from a per-round
//                    fnv32 of (seed, roundIndex).
//   deterministic_bot — opponent picks the action that beats the
//                    player's last revealed action; falls back to Bark
//                    on the opening round (no history yet).
//
// The card keys are built via formatCardKey() so they always parse;
// stats and abilities come from the same engine path For Keeps uses.

import { fnv32 } from './util-hash.js';
import {
  KEEPS_ACTIONS,
  isValidKeepsAction,
  actionBeats
} from './showdown-keeps-actions.js';
import {
  isValidKeepsMatchSize,
  assertValidKeepsMatchSize,
  KEEPS_MATCH_SIZE_MAX
} from './showdown-keeps-formats.js';
import { formatCardKey, parseCardKey } from './card-key.js';
import { deriveCardStats } from './showdown-stats.js';
import { abilityIdForCard } from './showdown-cards.js';

export const KEEPS_DEMO_VERSION = 'showdown-for-keeps-demo-v1';

export const KEEPS_DEMO_OPPONENT_IDS = Object.freeze([
  'mirror',
  'random_demo',
  'deterministic_bot'
]);

export const KEEPS_DEMO_OPPONENT_LABELS = Object.freeze({
  mirror:            'Mirror Demo',
  random_demo:       'Random Demo Kennel',
  deterministic_bot: 'Deterministic Bot'
});

export function isValidKeepsDemoOpponentId(id) {
  return typeof id === 'string' && KEEPS_DEMO_OPPONENT_IDS.includes(id);
}

// ─── card-key palette ────────────────────────────────────────────
//
// Each entry is `(dogId, variant)`. dogId is a standard dog (not a
// mythic identity), variant is any single-serial standard variant
// whose `perStandardDog` print count is large enough to give us
// enough serials for a 16-card lineup. Order is stable; the lineup
// builder rotates through the list with a seed offset.

// All dogIds chosen here are standard (NOT mythic) so they roll the
// full variant table. Mythic identities live at 1/3/7/13/.../69420 in
// elaborate-ids.js and only support 1/1 art — they are never valid
// for the multi-variant demo deck.
const PALETTE = Object.freeze([
  { dogId: 100,  variant: 'base'      },
  { dogId: 200,  variant: 'base'      },
  { dogId: 555,  variant: 'base'      },
  { dogId: 1000, variant: 'bronze'    },
  { dogId: 1500, variant: 'bronze'    },
  { dogId: 2000, variant: 'bronze'    },
  { dogId: 2500, variant: 'silver'    },
  { dogId: 3000, variant: 'silver'    },
  { dogId: 4200, variant: 'silver'    },
  { dogId: 5000, variant: 'refractor' },
  { dogId: 7000, variant: 'refractor' },
  { dogId: 1666, variant: 'refractor' },
  { dogId: 9999, variant: 'holo'      },
  { dogId: 12345,variant: 'holo'      },
  { dogId: 21000,variant: 'holo'      },
  { dogId: 30000,variant: 'sparkle'   }
]);

const PALETTE_SIZE = PALETTE.length;

function paletteEntry(idx) {
  // wraparound; idx may exceed PALETTE.length for very large lineups.
  return PALETTE[idx % PALETTE_SIZE];
}

/**
 * Build a single demo card with displayStats + abilityId in the same
 * shape the For Keeps engine expects.
 *
 * @param {number} dogId
 * @param {string} variant   one of: 'base','bronze','silver','refractor','holo','sparkle'
 * @param {number} serial
 * @returns {object} lineup-ready card
 */
export function buildDemoCard(dogId, variant, serial) {
  const cardKey = formatCardKey({ variant, dogId, serial });
  const parsed = parseCardKey(cardKey);
  if (!parsed) throw new Error(`unparseable demo cardKey: ${cardKey}`);
  const stats = deriveCardStats({ ...parsed, cardKey });
  const abilityId = abilityIdForCard({ ...parsed, cardKey });
  return {
    cardKey,
    cardClass: parsed.cardClass,
    variant: parsed.variant,
    dogId: parsed.dogId,
    serial: parsed.serial,
    abilityId,
    displayStats: { ...stats.displayStats }
  };
}

/**
 * Deterministic demo lineup. Uses the palette + a per-seat seed so
 * the same seed produces the same lineup; different seats produce
 * disjoint lineups (no cross-lineup collision).
 *
 * @param {object} args
 * @param {number} args.matchSize    2 | 4 | 8 | 16
 * @param {string} args.seed         arbitrary string
 * @param {'A'|'B'} args.seat        which lineup
 * @returns {Array<object>}
 */
export function buildDemoLineup({ matchSize, seed, seat }) {
  assertValidKeepsMatchSize(matchSize);
  if (typeof seed !== 'string' || !seed) throw new Error('seed required');
  if (seat !== 'A' && seat !== 'B') throw new Error(`seat must be 'A' or 'B' (got ${seat})`);
  const offset = fnv32(`${seed}|${seat}`) % PALETTE_SIZE;
  const lineup = [];
  const used = new Set();
  let cursor = 0;
  while (lineup.length < matchSize && cursor < PALETTE_SIZE * 8) {
    const p = paletteEntry(offset + cursor);
    // Stagger serials per seat so A and B never collide on the same key.
    const baseSerial = seat === 'A' ? 1 : 2;
    const serial = baseSerial + Math.floor(cursor / PALETTE_SIZE);
    const card = buildDemoCard(p.dogId, p.variant, serial);
    if (!used.has(card.cardKey)) {
      lineup.push(card);
      used.add(card.cardKey);
    }
    cursor += 1;
  }
  if (lineup.length !== matchSize) {
    throw new Error(`demo palette exhausted before filling ${matchSize}-card lineup`);
  }
  return lineup;
}

// ─── opponent strategies ─────────────────────────────────────────

/**
 * Pick the opponent's action for `roundIndex` given the player's
 * action plan and a per-match seed. All strategies are deterministic
 * — same inputs produce the same output every time.
 *
 * @param {object} args
 * @param {string} args.opponentId        one of KEEPS_DEMO_OPPONENT_IDS
 * @param {string} args.seed              shared per-match seed
 * @param {number} args.roundIndex        0-based round counter
 * @param {string} args.playerAction      the player's action this round
 * @param {Array<string>} [args.history]  prior player actions (oldest → newest)
 * @returns {string}                      one of KEEPS_ACTIONS
 */
export function opponentAction({ opponentId, seed, roundIndex, playerAction, history = [] }) {
  if (!isValidKeepsDemoOpponentId(opponentId)) {
    throw new Error(`unknown demo opponentId: ${opponentId}`);
  }
  if (!isValidKeepsAction(playerAction)) {
    throw new Error(`invalid playerAction: ${playerAction}`);
  }
  if (!Number.isInteger(roundIndex) || roundIndex < 0) {
    throw new Error('roundIndex must be a non-negative integer');
  }
  switch (opponentId) {
    case 'mirror':
      return playerAction;
    case 'random_demo': {
      const h = fnv32(`${seed}|opp|${roundIndex}`);
      return KEEPS_ACTIONS[h % 3];
    }
    case 'deterministic_bot': {
      // Counter the player's LAST revealed action. If no history yet,
      // play the action that beats the player's current action (the
      // bot reads the opening — Fun Mode reveals are simultaneous so
      // this is fair for a single-player practice mode).
      const last = history.length ? history[history.length - 1] : playerAction;
      for (const cand of KEEPS_ACTIONS) {
        if (actionBeats(cand, last)) return cand;
      }
      return 'bark';
    }
    default:
      return 'bark';
  }
}

// ─── version stamp (test convenience) ────────────────────────────

export { PALETTE as KEEPS_DEMO_PALETTE };
