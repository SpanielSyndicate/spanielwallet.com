// Spaniel Syndicate — art-only card-front renderer.
//
// The FRONT of a Series 1 card is ART. No name, no card key, no chip,
// no stat strip, no footer, no UI framing, no inner portrait panel,
// no horizon shelf line — every label and number lives on the back
// (card-back.js) or in the surrounding card-page DOM. The front
// exists to make the dog read instantly as part of a full-card pixel-
// art scene:
//
//   - 2.5:3.5 aspect, sharp pixel-art geometry, no rounded corners
//   - Logical 75×105 pixel canvas, 10× nearest-neighbor scaling
//   - The original 24×24 dog sprite is rendered at 2× (48×48 logical)
//     and centered with its feet near y=80
//   - The dog's OWN wall colour + atmosphere is extended across the
//     full canvas via pixel-background.js, then the **foreground-only**
//     dog sprite (background-masked, transparent everywhere except
//     the dog body) is composited on top — there is no visible 24×24
//     wall block around the sprite.
//   - Variant treatments are scattered pixel-art (sparkles, foil
//     flecks, scanline rows, error misregistration) — never text and
//     never a rectangle that traces the dog's logical bounds.
//
// Deterministic. Pure function of the parsed card + optional scene
// + optional artDataUri. Same inputs ⇒ byte-identical SVG.
//
// CLAUDE.md anchors:
//   §0 — sharp pixel geometry, no UI on the front, no rounded corners
//   §2.1 — variant catalog (parallels, holiday stamps, plates, etc.)
//   §2.16 — metadata schema lives on the back/metadata, not here.

import { normalizeParsedCardKey } from './card-key.js';
import { CARD_W, CARD_H } from './card-frame.js';
import {
  PIXEL_BACKGROUND_VERSION,
  CARD_FRONT_LOGICAL_W,
  CARD_FRONT_LOGICAL_H,
  CARD_FRONT_PIXEL_SCALE,
  DOG_LOGICAL_W,
  DOG_LOGICAL_H,
  DOG_LOGICAL_X,
  DOG_LOGICAL_Y,
  DOG_FEET_LINE_Y,
  resolveScene,
  atmosphericPixels,
  footShadow,
  fnv32,
  lcg,
  pickInt,
  px,
  rectPx
} from './pixel-background.js';
import {
  sceneCategoryForMythicDog,
  renderScene as renderMythicScene
} from './card-scenes.js';

export const CARD_FRONT_ART_VERSION = 'card-front-art-v4';

// Variants that ship a coloured 1-px logical outer edge, keyed to their
// accent colour. Base/generic ship NO frame — the artwork breathes.
// The earlier v1 also painted an inner accent rectangle one pixel
// inside the outer frame; that traced a panel boundary inside the
// card and read as UI. v2 drops the inner rectangle entirely. Corner
// pips remain because they're discrete 2×2 squares, not a rectangle.
const FRAME_PALETTES = Object.freeze({
  base:      null,
  generic:   null,
  bronze:    { color: '#c98a48', pips: 2 },
  silver:    { color: '#d9d9d9', pips: 2 },
  refractor: { color: '#c87dff', pips: 0 },
  holo:      { color: '#5fd4ff', pips: 0 },
  holiday:   { color: '#ff7d9e', pips: 0 },
  sparkle:   { color: '#f5df88', pips: 0 },
  plate:     { color: '#ffffff', pips: 4 },
  gold:      { color: '#f5b500', pips: 4 },
  error:     { color: '#f06262', pips: 0 },
  black:     { color: '#cfcfcf', pips: 4 },
  mythic:    { color: '#f5df88', pips: 4 },
  mythic_insert: { color: '#ff7d9e', pips: 4 }
});

const HOLIDAY_MOTIF = Object.freeze({
  valentine: { color: '#f071a8', spark: '#fff7e2' },
  spring:    { color: '#53c96c', spark: '#f5df88' },
  solana_summer: { color: '#9945ff', spark: '#14f195' },
  halloween: { color: '#dd8a3e', spark: '#1c1320' },
  winter:    { color: '#cfd8e8', spark: '#fff7e2' },
  new_year:  { color: '#f5df88', spark: '#fff7e2' }
});

const PLATE_TINT = Object.freeze({
  cyan:    '#00b6e3',
  magenta: '#e000a8',
  yellow:  '#f5d400',
  key:     '#0a0a0a'
});

// ─── Public renderer ─────────────────────────────────────────────

/**
 * Build the art-only front SVG for a card.
 *
 * The sprite passed in `opts.artDataUri` MUST be foreground-only —
 * background masked to fully transparent. Ops/exporter callers should
 * use `spaniel-engine.cjs::renderForegroundPNG()` so the dog has no
 * 24×24 wall block around it. The Worker should serve the same
 * masked sprite on the public metadata endpoint.
 *
 * @param {string|object} cardKey — string OR a normalized parsed object
 * @param {object} [opts]
 * @param {string} [opts.artDataUri] — base64 PNG data URI of the FOREGROUND
 *                                     dog sprite (transparent bg)
 * @param {object} [opts.scene]      — { bgColor, bgKind, bgSeed } (from the
 *                                      ops-side pixel engine token)
 * @returns {string} SVG string
 */
export function renderCardFrontArtSvg(cardKey, opts = {}) {
  const parsed = normalizeParsedCardKey(cardKey);
  if (!parsed) throw new Error('renderCardFrontArtSvg: invalid cardKey');

  const scene = resolveScene(opts.scene, parsed);
  const variant = parsed.variant;
  const seedBase = fnv32(`front::${parsed.cardKey}::${variant}`);

  // True mythic dogs route through the per-anchor scene system
  // (card-scenes.js). Standard/generic/insert cards continue to use
  // the dog's own wall colour + atmospheric extension. The scene
  // category drives an entire painted world behind the dog (gradient
  // bands, distant silhouette, halo, foreground motifs, atmosphere)
  // so the front feels like a pixel-art scene the dog stands in,
  // not a sprite on flat paper.
  const sceneCategory = parsed.cardClass === 'true_mythic_spaniel'
    ? sceneCategoryForMythicDog(parsed.dogId)
    : null;

  const layers = [];

  // Layer 1 — solid background fill (one rectangle covering the whole
  // logical canvas). For the `black` variant the fill is true black
  // so the dog reads against the void. For scene-driven mythics the
  // scene's gradient bands repaint this completely; we still emit
  // the base fill so any tiny gap between band rows reads as the
  // scene's mid-tone rather than the dog's bg colour.
  const baseBg = variant === 'black'
    ? '#000000'
    : (sceneCategory ? '#0a0810' : scene.bgColor);
  layers.push(rectPx(0, 0, CARD_FRONT_LOGICAL_W, CARD_FRONT_LOGICAL_H, baseBg));

  // Layer 2a — premium scene composition for mythic dogs with an
  // assigned scene category. Includes its own gradient bands,
  // distant silhouette, halo behind dog, foreground motifs, and
  // atmosphere — replaces the generic atmosphericPixels for these
  // cards.
  if (sceneCategory && variant !== 'plate') {
    layers.push(...renderMythicScene(sceneCategory, scene, seedBase, parsed.dogId));
  } else if (variant !== 'plate') {
    // Layer 2b — atmospheric extension (stars/grid/holo shimmer for
    // the bg kind the engine token carried). Plate variant skips
    // this so the CMYK separation reads pure.
    layers.push(...atmosphericPixels(scene));
  }

  // Layer 3 — plate tint overlay (CMYK separation feel).
  if (variant === 'plate') {
    layers.push(...plateTintLayer(parsed, scene));
  }

  // Layer 4 — variant under-layer (rainbow refractor flecks, sparkle
  // bursts, holo scanlines below the dog, mythic atmospheric pixels
  // when no scene is assigned). None of these trace the dog's
  // logical bounds.
  layers.push(...variantUnderlay(parsed, scene, seedBase, sceneCategory));

  // Layer 5 — small foot shadow blobs directly under the dog's feet.
  // Three discrete shadow blobs (not a full-card horizontal row) so
  // the dog reads as "standing in the scene" without painting a
  // shelf line.
  layers.push(...footShadow(scene));

  // Layer 6 — the foreground dog sprite. The exporter / Worker MUST
  // supply a background-masked PNG (alpha = 0 on wall pixels) so the
  // 24×24 sprite has no visible inner square. When no art is supplied
  // (engine self-render or audit sweep without art), the dog layer is
  // simply omitted — there is no silhouette fallback. The shipping
  // surfaces (showcase exporter, Worker /api/cards/:k/image, card
  // page) are enforced by audit-card-visuals which asserts an
  // <image> tag is present.
  if (opts.artDataUri && typeof opts.artDataUri === 'string') {
    layers.push(
      `<image x="${DOG_LOGICAL_X}" y="${DOG_LOGICAL_Y}" width="${DOG_LOGICAL_W}" height="${DOG_LOGICAL_H}" href="${escapeUri(opts.artDataUri)}" style="image-rendering: pixelated; image-rendering: crisp-edges;"/>`
    );
  }

  // Layer 7 — variant overlay (gold corner ornaments, error
  // misregistration, holo scanlines on top of the dog, mythic
  // sparkles). Same rule — no rectangle that traces the dog footprint.
  layers.push(...variantOverlay(parsed, scene, seedBase));

  // Layer 8 — outermost frame. Sharp single-pixel-logical outer edge
  // for rarer variants + corner pips. The earlier inner-accent line
  // is removed — it traced a panel inside the card and read as UI.
  layers.push(...framePixels(parsed));

  return wrapSvg(parsed, layers, sceneCategory);
}

function wrapSvg(parsed, layers, sceneCategory) {
  // ViewBox stays at the canonical card pixel dimensions (CARD_W ×
  // CARD_H = 750 × 1050) so master sheets can position cards via
  // <g transform="translate(...)"> against the same coordinate
  // system every other surface uses. Internally we work in the
  // logical 75×105 pixel grid, then scale up uniformly by
  // CARD_FRONT_PIXEL_SCALE (10) — this preserves crisp 1:1 pixel
  // boundaries at the 750×1050 output.
  const sceneAttr = sceneCategory
    ? ` data-scene="${escapeAttr(sceneCategory)}"`
    : '';
  // The scene attribute is mirrored on both the outer <svg> and the
  // inner <g> so it survives master-sheet inlining (the exporter
  // strips the <svg> wrapper when composing the multi-card sheet —
  // the inner <g> survives the strip and keeps the scene marker
  // visible to the visual audit).
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}" class="spaniel-card spaniel-card-front" data-card-key="${escapeAttr(parsed.cardKey)}" data-variant="${escapeAttr(parsed.variant)}"${sceneAttr} preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" style="image-rendering: pixelated; image-rendering: crisp-edges;">`,
    `<g transform="scale(${CARD_FRONT_PIXEL_SCALE})"${sceneAttr}>`,
    layers.join(''),
    `</g>`,
    `</svg>`
  ].join('');
}

// ─── Variant under-layer ──────────────────────────────────────────

function variantUnderlay(parsed, scene, seedBase, sceneCategory) {
  switch (parsed.variant) {
    case 'refractor':  return refractorPixels(scene, seedBase);
    case 'sparkle':    return sparklePixels(scene, seedBase);
    case 'holo':       return holoScanlines(scene, 'under');
    case 'mythic':
      // When a scene category is assigned (true_mythic_spaniel with
      // an authored anchor), the scene composition already supplies
      // the gold/purple atmosphere — skip the generic mythicAtmosphere
      // scatter so the scene reads cleanly instead of double-painted.
      return sceneCategory ? [] : mythicAtmosphere(scene, seedBase);
    case 'mythic_insert': return mythicInsertBurst(scene, seedBase);
    case 'gold':       return goldAtmosphere(scene, seedBase);
    case 'holiday':    return holidayMotifPixels(parsed, scene, seedBase);
    case 'error':      return errorBands(scene, seedBase);
    default:           return [];
  }
}

function variantOverlay(parsed, scene, seedBase) {
  switch (parsed.variant) {
    case 'gold':    return goldCornerOrnaments(scene);
    case 'mythic':  return mythicSparkleOverlay(scene, seedBase);
    case 'mythic_insert': return mythicInsertCornerPips(scene);
    case 'holo':    return holoScanlines(scene, 'over');
    case 'error':   return errorMisregistration(scene, seedBase);
    case 'sparkle': return sparkleStarOverlay(scene, seedBase);
    default:        return [];
  }
}

function refractorPixels(scene, seedBase) {
  const rainbow = ['#ff7d9e', '#ffd966', '#9be36b', '#5fd4ff', '#c87dff'];
  const rng = lcg(seedBase ^ 0xa1b2);
  const out = [];
  // Eight rainbow flecks scattered above and around (no chevron stripe).
  let placed = 0;
  let safety = 60;
  while (placed < 8 && safety-- > 0) {
    const x = pickInt(rng, CARD_FRONT_LOGICAL_W);
    const y = pickInt(rng, CARD_FRONT_LOGICAL_H);
    if (inDog(x, y)) continue;
    out.push(px(x, y, rainbow[placed % rainbow.length]));
    placed++;
  }
  return out;
}

function sparklePixels(scene, seedBase) {
  const rng = lcg(seedBase ^ 0x5e5e);
  const gold = '#f5df88';
  const out = [];
  // Four sparkle plus-signs — disciplined, not a sparkle storm.
  let placed = 0;
  let safety = 40;
  while (placed < 4 && safety-- > 0) {
    const cx = 4 + pickInt(rng, CARD_FRONT_LOGICAL_W - 8);
    const cy = 4 + pickInt(rng, CARD_FRONT_LOGICAL_H - 8);
    if (inDog(cx, cy)) continue;
    out.push(px(cx, cy, gold));
    out.push(px(cx - 1, cy, gold));
    out.push(px(cx + 1, cy, gold));
    out.push(px(cx, cy - 1, gold));
    out.push(px(cx, cy + 1, gold));
    placed++;
  }
  return out;
}

function sparkleStarOverlay(scene, seedBase) {
  const rng = lcg(seedBase ^ 0x55aa);
  const out = [];
  const accent = '#fff7e2';
  // Two accent dots — quiet finish.
  let placed = 0;
  let safety = 20;
  while (placed < 2 && safety-- > 0) {
    const x = 4 + pickInt(rng, CARD_FRONT_LOGICAL_W - 8);
    const y = 4 + pickInt(rng, CARD_FRONT_LOGICAL_H - 8);
    if (inDog(x, y)) continue;
    out.push(px(x, y, accent));
    placed++;
  }
  return out;
}

function holoScanlines(scene, layer) {
  const out = [];
  const cool = '#7dd9ff';
  const warm = '#ffd1f5';
  const start = layer === 'under' ? 1 : 2;
  for (let y = start; y < CARD_FRONT_LOGICAL_H - 1; y += 4) {
    out.push(rectPx(1, y, CARD_FRONT_LOGICAL_W - 2, 1, layer === 'under' ? cool : warm));
  }
  return out;
}

// Mythic atmosphere — only used when no scene category is assigned.
// Four discrete corner-anchor sparkles plus four gold flecks. No
// scatter storm.
function mythicAtmosphere(scene, seedBase) {
  const rng = lcg(seedBase ^ 0xd0e0);
  const halo = '#f5df88';
  const accent = '#fff7e2';
  const out = [];
  // Four gold flecks in the upper band only.
  let placed = 0;
  let safety = 40;
  while (placed < 4 && safety-- > 0) {
    const x = 4 + pickInt(rng, CARD_FRONT_LOGICAL_W - 8);
    const y = 4 + pickInt(rng, Math.max(1, DOG_LOGICAL_Y - 4));
    if (inDog(x, y)) continue;
    out.push(px(x, y, placed % 3 === 0 ? accent : halo));
    placed++;
  }
  return out;
}

function mythicSparkleOverlay(scene, seedBase) {
  const rng = lcg(seedBase ^ 0xfeed);
  const accent = '#fff7e2';
  const out = [];
  // Two restrained sparkle dots in the upper canvas.
  let placed = 0;
  let safety = 20;
  while (placed < 2 && safety-- > 0) {
    const x = 4 + pickInt(rng, CARD_FRONT_LOGICAL_W - 8);
    const y = 4 + pickInt(rng, Math.max(1, DOG_LOGICAL_Y - 4));
    if (inDog(x, y)) continue;
    out.push(px(x, y, accent));
    placed++;
  }
  return out;
}

function mythicInsertBurst(scene, seedBase) {
  const out = [];
  const inner = '#ff7d9e';
  const outer = '#c87dff';
  // Two concentric diamond rims, not a filled burst. The diamond
  // shape never reads as a portrait frame around the dog because
  // it's rotated 45° to the canvas axes. Two thin rims keep the
  // motif iconic without painting half the canvas.
  const cx = Math.floor(CARD_FRONT_LOGICAL_W / 2);
  const cy = Math.floor(CARD_FRONT_LOGICAL_H / 2);
  for (const [r, color] of [[14, inner], [22, outer]]) {
    for (let i = -r; i <= r; i++) {
      const j = r - Math.abs(i);
      out.push(px(cx + i, cy - j, color));
      out.push(px(cx + i, cy + j, color));
    }
  }
  return out;
}

function mythicInsertCornerPips(scene) {
  const accent = '#fff7e2';
  return [
    px(2, 2, accent),
    px(CARD_FRONT_LOGICAL_W - 3, 2, accent),
    px(2, CARD_FRONT_LOGICAL_H - 3, accent),
    px(CARD_FRONT_LOGICAL_W - 3, CARD_FRONT_LOGICAL_H - 3, accent)
  ];
}

// Gold atmosphere — six gold flecks in the upper sky band. Quiet.
function goldAtmosphere(scene, seedBase) {
  const out = [];
  const gold = '#f5b500';
  const goldHi = '#fff0a8';
  const rng = lcg(seedBase ^ 0xb011);
  let placed = 0;
  let safety = 40;
  while (placed < 6 && safety-- > 0) {
    const x = 2 + pickInt(rng, CARD_FRONT_LOGICAL_W - 4);
    const y = 2 + pickInt(rng, Math.max(1, DOG_LOGICAL_Y - 4));
    if (inDog(x, y)) continue;
    out.push(px(x, y, placed % 3 === 0 ? goldHi : gold));
    placed++;
  }
  return out;
}

function goldCornerOrnaments(scene) {
  const gold = '#f5b500';
  const out = [];
  // 3×3 L-shaped ornament in each corner (filigree feel).
  const corners = [
    [1, 1, +1, +1],
    [CARD_FRONT_LOGICAL_W - 2, 1, -1, +1],
    [1, CARD_FRONT_LOGICAL_H - 2, +1, -1],
    [CARD_FRONT_LOGICAL_W - 2, CARD_FRONT_LOGICAL_H - 2, -1, -1]
  ];
  for (const [cx, cy, dx, dy] of corners) {
    out.push(px(cx, cy, gold));
    out.push(px(cx + dx, cy, gold));
    out.push(px(cx + dx * 2, cy, gold));
    out.push(px(cx, cy + dy, gold));
    out.push(px(cx, cy + dy * 2, gold));
  }
  return out;
}

function holidayMotifPixels(parsed, scene, seedBase) {
  const motif = HOLIDAY_MOTIF[parsed.stampType] || HOLIDAY_MOTIF.valentine;
  const out = [];
  const rng = lcg(seedBase ^ 0x4011d);
  // Six motif pixels in the upper sky band — restrained.
  let placed = 0;
  let safety = 40;
  while (placed < 6 && safety-- > 0) {
    const x = 2 + pickInt(rng, CARD_FRONT_LOGICAL_W - 4);
    const y = 2 + pickInt(rng, Math.max(1, DOG_LOGICAL_Y - 4));
    if (inDog(x, y)) continue;
    out.push(px(x, y, placed % 3 === 0 ? motif.spark : motif.color));
    placed++;
  }
  return out;
}

function errorBands(scene, seedBase) {
  const rng = lcg(seedBase ^ 0xe770);
  const out = [];
  const cyan = '#00b6e3';
  const magenta = '#e000a8';
  // Two misregistered 1-px coloured bands across the canvas.
  for (let i = 0; i < 2; i++) {
    const y = 4 + pickInt(rng, CARD_FRONT_LOGICAL_H - 8);
    out.push(rectPx(0, y, CARD_FRONT_LOGICAL_W, 1, i ? magenta : cyan));
  }
  return out;
}

function errorMisregistration(scene, seedBase) {
  const rng = lcg(seedBase ^ 0xe772);
  const out = [];
  const offsets = ['#00b6e3', '#e000a8'];
  // Four small misregistered 2×1 ghost rectangles near the dog
  // outline — implies the lithography slipped.
  for (let i = 0; i < 4; i++) {
    const x = DOG_LOGICAL_X - 1 + pickInt(rng, DOG_LOGICAL_W + 2);
    const y = DOG_LOGICAL_Y - 1 + pickInt(rng, DOG_LOGICAL_H + 2);
    out.push(rectPx(x, y, 2, 1, offsets[i % 2]));
  }
  return out;
}

function plateTintLayer(parsed, scene) {
  const tint = PLATE_TINT[parsed.plateColor] || '#ffffff';
  const out = [];
  // Single-channel cyan/magenta/yellow/key plate vertical band — the
  // halftone plate aesthetic without any rounded geometry.
  for (let y = 0; y < CARD_FRONT_LOGICAL_H; y++) {
    if (y % 2 === 0) {
      out.push(rectPx(0, y, CARD_FRONT_LOGICAL_W, 1, tint));
    }
  }
  return out;
}

// ─── Outer card edge + corner pips ───────────────────────────────

function framePixels(parsed) {
  const variant = parsed.variant;
  const palette = FRAME_PALETTES[variant];
  if (!palette) return [];
  // Sharp 1-pixel-logical OUTER edge only. No inner accent rectangle
  // (v1 traced a frame inside the card — too "UI", too "panel-like").
  // Variants that earned them get discrete 2×2 corner pips, which
  // never form a continuous boundary.
  const w = CARD_FRONT_LOGICAL_W;
  const h = CARD_FRONT_LOGICAL_H;
  const out = [
    rectPx(0, 0, w, 1, palette.color),
    rectPx(0, h - 1, w, 1, palette.color),
    rectPx(0, 0, 1, h, palette.color),
    rectPx(w - 1, 0, 1, h, palette.color)
  ];
  if (palette.pips >= 2) {
    out.push(rectPx(3, 3, 2, 2, palette.color));
    out.push(rectPx(w - 5, 3, 2, 2, palette.color));
  }
  if (palette.pips >= 4) {
    out.push(rectPx(3, h - 5, 2, 2, palette.color));
    out.push(rectPx(w - 5, h - 5, 2, 2, palette.color));
  }
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────

function inDog(x, y) {
  return x >= DOG_LOGICAL_X
    && x < DOG_LOGICAL_X + DOG_LOGICAL_W
    && y >= DOG_LOGICAL_Y
    && y < DOG_LOGICAL_Y + DOG_LOGICAL_H;
}

function escapeAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeUri(s) {
  // Data URIs are already safe-ish (base64 + ASCII), but enforce
  // quote escaping for the href attribute.
  return String(s ?? '').replace(/"/g, '&quot;');
}

export {
  CARD_FRONT_LOGICAL_W,
  CARD_FRONT_LOGICAL_H,
  CARD_FRONT_PIXEL_SCALE,
  DOG_LOGICAL_W,
  DOG_LOGICAL_H,
  DOG_LOGICAL_X,
  DOG_LOGICAL_Y,
  DOG_FEET_LINE_Y,
  PIXEL_BACKGROUND_VERSION
};
