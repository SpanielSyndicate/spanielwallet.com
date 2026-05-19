// Spaniel Syndicate — trading-card composite renderer (front + back).
//
// THE FRONT OF A CARD IS ART ONLY.
//
// Title, card key, variant, serial, rarity, role, stats, ability,
// Rescue/Affiliate weights, CTA, authenticity tag — all of those
// live on the BACK (card-back.js). The front is a 2.5:3.5 pixel-art
// extrapolation of the dog's original 24×24 scene; it is built by
// `renderCardFrontArtSvg` in card-front-art.js and re-exported here
// under the canonical `renderCardFrontSvg` name so existing engine
// callers (spaniel-engine.js, card-page.js, the ops exporter) keep
// working.
//
// CLAUDE.md anchors:
//   §0 — no rounded corners, no UI on the front, no glassmorphism
//   §2.16 — metadata schema (back, not front)

import { normalizeParsedCardKey } from './card-key.js';
import { getVariant } from './series1.js';
import { CARD_W, CARD_H } from './card-frame.js';
import {
  renderCardFrontArtSvg,
  CARD_FRONT_ART_VERSION
} from './card-front-art.js';
import { renderCardBackSvg } from './card-back.js';

export const CARD_RENDERING_VERSION = 'card-rendering-v2';

/**
 * Build the front-side SVG. Art only.
 *
 * @param {string|object} cardKey — string OR a normalized parsed object
 * @param {object} [opts]
 * @param {string} [opts.artDataUri] — base64 PNG data URI for the 24×24 dog
 * @param {object} [opts.scene] — { bgColor, bgKind, bgSeed } from the
 *                                 ops-side pixel engine token
 * @returns {string}
 */
export function renderCardFrontSvg(cardKey, opts = {}) {
  return renderCardFrontArtSvg(cardKey, opts);
}

/**
 * Build the full card composite (front + back + dimensions).
 *
 * @param {string|object} cardKey
 * @param {object} [opts] — see renderCardFrontSvg + renderCardBackSvg
 * @returns {{ cardKey: string, variant: string, rarityGroup: string|null,
 *             frontSvg: string, backSvg: string,
 *             dimensions: { width: number, height: number } }}
 */
export function renderCardComposite(cardKey, opts = {}) {
  const parsed = normalizeParsedCardKey(cardKey);
  if (!parsed) throw new Error('renderCardComposite: invalid cardKey');
  return {
    cardKey: parsed.cardKey,
    variant: parsed.variant,
    rarityGroup: getVariant(parsed.variant)?.rarityGroup ?? null,
    frontSvg: renderCardFrontSvg(parsed, opts),
    backSvg: renderCardBackSvg(parsed, opts),
    dimensions: { width: CARD_W, height: CARD_H }
  };
}

export { renderCardBackSvg, CARD_W, CARD_H, CARD_FRONT_ART_VERSION };
