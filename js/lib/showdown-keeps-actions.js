// Spaniel Showdown — For Keeps round actions + triangle.
//
// Three actions: Bark, Bite, Zoom.
//   Bark beats Zoom.
//   Zoom beats Bite.
//   Bite beats Bark.
//   Same action = neither side gets the triangle bonus.
//
// `selectedStat` is read off the active card's displayStats with the
// same key as the action name (`bark`, `bite`, or `zoom`). CHARM is
// not an action — it's the round tiebreaker.

export const KEEPS_ACTIONS_VERSION = 'showdown-for-keeps-actions-v1';

export const KEEPS_ACTIONS = Object.freeze(['bark', 'bite', 'zoom']);

/** Triangle bonus added to the side whose action beats the opponent. */
export const KEEPS_TRIANGLE_BONUS = 10;

/** Hard per-round damage cap; prevents one-shotting at huge stat gaps. */
export const KEEPS_MAX_ROUND_DAMAGE = 40;

/** Base damage applied to the round loser before margin/ability mods. */
export const KEEPS_BASE_DAMAGE = 10;

/** Mutual Spirit damage on a CHARM-tie (no-winner) round. */
export const KEEPS_TIE_DAMAGE = 5;

/**
 * @param {string} action
 * @returns {boolean}
 */
export function isValidKeepsAction(action) {
  return typeof action === 'string' && KEEPS_ACTIONS.includes(action);
}

/**
 * Does `a` beat `b` under the triangle?
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function actionBeats(a, b) {
  if (!isValidKeepsAction(a) || !isValidKeepsAction(b)) return false;
  if (a === b) return false;
  if (a === 'bark' && b === 'zoom') return true;
  if (a === 'zoom' && b === 'bite') return true;
  if (a === 'bite' && b === 'bark') return true;
  return false;
}

/**
 * Compute triangle outcome for a pair of actions.
 *
 * @param {string} actionA
 * @param {string} actionB
 * @returns {{ winner: 'A'|'B'|'none', advantageA: number, advantageB: number }}
 */
export function triangleResult(actionA, actionB) {
  if (!isValidKeepsAction(actionA) || !isValidKeepsAction(actionB)) {
    throw new Error(`invalid action: ${actionA} vs ${actionB}`);
  }
  if (actionBeats(actionA, actionB)) {
    return { winner: 'A', advantageA: KEEPS_TRIANGLE_BONUS, advantageB: 0 };
  }
  if (actionBeats(actionB, actionA)) {
    return { winner: 'B', advantageA: 0, advantageB: KEEPS_TRIANGLE_BONUS };
  }
  return { winner: 'none', advantageA: 0, advantageB: 0 };
}
