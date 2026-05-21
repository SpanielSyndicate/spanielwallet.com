// Spaniel Syndicate — trading-card back-side renderer.
//
// THE BACK CARRIES THE METADATA + RARITY MARKER. The front is pure
// art (see card-front-art.js); the back is where you find:
//
//   - SERIES 1 ribbon + big card number
//   - card name
//   - variant + rarity + serial + cardKey
//   - lore / anchor / backstory (full body, not truncated)
//   - SPIRIT (HP-like; the card's staying power)
//   - 4 challenge stats: BARK / BITE / ZOOM / CHARM
//   - one ability line
//   - RESCUE + AFFILIATE weight + SERIES 1 · AUTHENTICATED
//   - canonical CTA: "Buy a fake dog. Help a real one."
//   - outer frame in the variant's accent + corner pips (rarity marker)
//
// The back uses a 150×210 logical grid at 5× nearest-neighbor scaling
// to the canonical 750×1050 card output — twice the linear pixel
// density of the front (75×105 @ 10×). The denser grid is exactly
// what the lore body needs to fit without truncation. Same square-
// pixel aesthetic, half the apparent pixel size on the back. The
// front stays on its coarser grid because the 24×24 dog sprite is
// built for that resolution.
//
// SVG-only emission. No rounded rx/ry anywhere. Deterministic
// function of cardKey + (optional) lore.
//
// CLAUDE.md anchors:
//   §0 — sharp pixel geometry, no investment language
//   §2.16 — metadata schema; the back is the on-card surface for it.

import { normalizeParsedCardKey } from './card-key.js';
import { getVariant } from './series1.js';
import { themeForCard, CARD_W, CARD_H } from './card-frame.js';
import { gameStatsFor } from './card-game-stats.js';
import {
  AFFILIATE_WEIGHT_PER_REVEALED_CARD,
  RESCUE_WEIGHT_PER_REVEALED_CARD
} from './showdown-stats.js';
import { mythicLoreFor } from './mythic-lore.js';
import { darken, rectPx } from './pixel-background.js';
import {
  pixelText,
  pixelTextMetrics,
  wrapPixelText
} from './pixel-text.js';
import {
  personalityForStandardSpaniel,
  backstoryForStandardSpaniel,
  genericDesignName,
  genericDesignFlavor,
  mythicInsertName,
  mythicInsertFlavor,
  reservedMythicName
} from './personality.js';

export const CARD_BACK_VERSION = 'card-back-v5';

// Back-only logical grid. The front is pinned to the dog sprite's
// 24×24 native resolution (75×105 logical @ 10×); the back has no
// sprite to align with, so we go twice as dense for readable text.
const BACK_LOGICAL_W = 150;
const BACK_LOGICAL_H = 210;
const BACK_PIXEL_SCALE = 5;
const L_MARGIN = 6;
const L_CONTENT_W = BACK_LOGICAL_W - L_MARGIN * 2;

// Vertical layout anchors. The header band (SERIES 1 ribbon, big
// number, name, meta, cardKey, lore title) is fixed at the top; the
// footer (RESCUE / AFFILIATE row + CTA) is fixed at the bottom. The
// middle (lore body, SPIRIT, CHALLENGE STATS, ABILITY) flows from
// the lore start downward — long lore pushes the middle down,
// short lore lets it ride up. No giant empty gaps.
const Y_TOP_STRIPE_H        = 3;
const Y_SERIES_LABEL        = 6;
const Y_BIG_NUMBER          = 5;
const Y_NAME_PRIMARY        = 24;
const Y_META_LINE           = 46;
const Y_CARDKEY_LINE        = 52;
const Y_META_DIVIDER        = 58;
const Y_LORE_TITLE          = 61;
const Y_LORE_BODY_START     = 68;
const LORE_LINE_HEIGHT      = 6;
// Longest authored mythic anchor = 86 chars (~3 lines at 34 char/line).
// Longest sampled standard backstory = 166 chars (~5 lines). 6 lines
// gives one line of buffer; the flowing layout absorbs short lore
// by collapsing the gap below it.
const LORE_MAX_LINES        = 6;
const SPIRIT_PANEL_H        = 17;
const STATS_ROW_HEIGHT      = 7;
const ABILITY_LINE_HEIGHT   = 6;
const Y_FOOTER_DIVIDER      = 189;
const Y_FOOTER_ROW          = 192;
const Y_CTA                 = 200;

// Which variants get a 2×2 corner pip in addition to the 1-px outer
// frame. The frame is universal across every variant on the back; the
// pips are the premium-rarity marker.
const CORNER_PIPS_VARIANTS = new Set([
  'mythic', 'mythic_insert', 'gold', 'black', 'plate', 'silver', 'bronze'
]);

function svgEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Public entry ────────────────────────────────────────────────

export function renderCardBackSvg(cardKey, opts = {}) {
  const parsed = normalizeParsedCardKey(cardKey);
  if (!parsed) throw new Error('renderCardBackSvg: invalid cardKey');
  const theme = themeForCard(parsed);
  const lore = opts.lore || hydrateLore(parsed);
  const game = gameStatsFor(parsed);
  const display = game.displayStats;

  const layers = [];
  layers.push(...backPlate(theme));
  layers.push(...backHeader(parsed, theme));
  layers.push(...backName(parsed, lore));
  layers.push(...backMeta(parsed, theme));
  // The middle band (lore body, SPIRIT, stats, ability) flows from
  // the lore-body start downward. Each section returns its end-y,
  // which becomes the next section's start-y.
  let y = Y_LORE_BODY_START;
  const loreBlock = backLore(parsed, lore, theme, y);
  layers.push(...loreBlock.layers);
  y = loreBlock.endY + 3;
  layers.push(rectPx(L_MARGIN, y, L_CONTENT_W, 1, theme.border));
  y += 3;
  const spiritBlock = backSpirit(display, theme, y);
  layers.push(...spiritBlock.layers);
  y = spiritBlock.endY + 2;
  layers.push(rectPx(L_MARGIN, y, L_CONTENT_W, 1, theme.border));
  y += 3;
  const statsBlock = backChallengeStats(display, theme, y);
  layers.push(...statsBlock.layers);
  y = statsBlock.endY + 2;
  layers.push(rectPx(L_MARGIN, y, L_CONTENT_W, 1, theme.border));
  y += 3;
  layers.push(...backAbility(game, theme, y));
  layers.push(...backFooter(parsed, theme));
  layers.push(...backFrame(theme, parsed));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}" class="spaniel-card spaniel-card-back" data-card-key="${svgEscape(parsed.cardKey)}" data-variant="${svgEscape(parsed.variant)}" data-lore="${svgEscape(loreCopy(parsed, lore))}" data-sections="LORE SPIRIT CHALLENGE STATS ABILITY RESCUE AFFILIATE" data-cta="Buy a fake dog. Help a real one." shape-rendering="crispEdges" style="image-rendering: pixelated; image-rendering: crisp-edges;">`,
    `<g transform="scale(${BACK_PIXEL_SCALE})">`,
    layers.join(''),
    `</g>`,
    `</svg>`
  ].join('');
}

// ─── Layer 1 — background plate ──────────────────────────────────

function backPlate(theme) {
  const out = [];
  const bg = theme.bg;
  const bg2 = darken(bg, 0.12);
  // Full-canvas base fill.
  out.push(rectPx(0, 0, BACK_LOGICAL_W, BACK_LOGICAL_H, bg));
  // Inset panel — slightly darker, leaves a 2-pixel logical margin
  // for the outer frame and accent stripes.
  out.push(rectPx(2, 2, BACK_LOGICAL_W - 4, BACK_LOGICAL_H - 4, bg2));
  return out;
}

// ─── Layer 2 — header ribbon (SERIES 1 + big card number) ────────

function backHeader(parsed, theme) {
  const out = [];
  // Top accent stripe — variant accent colour, 3 px tall.
  out.push(rectPx(0, 0, BACK_LOGICAL_W, Y_TOP_STRIPE_H, theme.accent));
  // SERIES 1 ribbon — tiny font, scale 1, on the left.
  out.push(pixelText('SERIES 1', L_MARGIN, Y_SERIES_LABEL, {
    font: 'tiny',
    scale: 1,
    fill: theme.accent
  }));
  // Big card number — standard font, scale 2 if it fits, else 1.
  const num = bigNumberFor(parsed);
  const fitsScale2 = pixelTextMetrics(num, { font: 'standard', scale: 2 }).width <= L_CONTENT_W - 56;
  out.push(pixelTextRight(num, BACK_LOGICAL_W - L_MARGIN, Y_BIG_NUMBER, {
    font: 'standard',
    scale: fitsScale2 ? 2 : 1,
    fill: '#fff7e2'
  }));
  return out;
}

// ─── Layer 3 — card name (big) ───────────────────────────────────

function backName(parsed, lore) {
  const out = [];
  const name = titleFromLore(parsed, lore).toUpperCase();
  // Try standard scale 3 first (each glyph 15×21), drop to 2, then
  // to a wrapped scale-1 layout if even scale 2 won't fit on a
  // single line.
  for (const scale of [3, 2]) {
    const w = pixelTextMetrics(name, { font: 'standard', scale }).width;
    if (w <= L_CONTENT_W) {
      out.push(pixelText(name, L_MARGIN, Y_NAME_PRIMARY, {
        font: 'standard',
        scale,
        fill: '#fff7e2'
      }));
      return out;
    }
  }
  // Wrap at scale 1, at most two lines.
  const lines = wrapPixelText(name, L_CONTENT_W, 1, 2, 1, 'standard');
  for (let i = 0; i < lines.length; i++) {
    out.push(pixelText(lines[i], L_MARGIN, Y_NAME_PRIMARY + i * 9, {
      font: 'standard',
      scale: 1,
      fill: '#fff7e2'
    }));
  }
  return out;
}

// ─── Layer 4 — meta row (variant · rarity · serial · cardKey) ────

function backMeta(parsed, theme) {
  const out = [];
  const metaA = compactMetaLine(parsed);
  out.push(pixelText(metaA, L_MARGIN, Y_META_LINE, {
    font: 'tiny',
    scale: 1,
    fill: theme.accent
  }));
  out.push(pixelText(parsed.cardKey, L_MARGIN, Y_CARDKEY_LINE, {
    font: 'tiny',
    scale: 1,
    fill: '#cfc9d8'
  }));
  out.push(rectPx(L_MARGIN, Y_META_DIVIDER, L_CONTENT_W, 1, theme.border));
  return out;
}

// ─── Layer 5 — LORE body ─────────────────────────────────────────

function backLore(parsed, lore, theme, startY) {
  const layers = [];
  layers.push(sectionTitle('LORE', Y_LORE_TITLE, theme));
  const loreText = loreCopy(parsed, lore);
  const lines = wrapPixelText(loreText, L_CONTENT_W, 1, LORE_MAX_LINES, 1, 'tiny');
  for (let i = 0; i < lines.length; i++) {
    layers.push(pixelText(lines[i], L_MARGIN, startY + i * LORE_LINE_HEIGHT, {
      font: 'tiny',
      scale: 1,
      fill: '#e6dfd0'
    }));
  }
  // 5-pixel-tall tiny glyph plus 1 px breathing room.
  const endY = startY + Math.max(1, lines.length) * LORE_LINE_HEIGHT;
  return { layers, endY };
}

// ─── Layer 6 — SPIRIT panel (HP-like hero number) ────────────────

function backSpirit(display, theme, startY) {
  const layers = [];
  const value = display.spirit;
  const y = startY;
  layers.push(rectPx(L_MARGIN, y, L_CONTENT_W, SPIRIT_PANEL_H, darken(theme.bg, 0.06)));
  layers.push(pixelText('SPIRIT', L_MARGIN + 3, y + 3, {
    font: 'standard',
    scale: 1,
    fill: theme.accent
  }));
  layers.push(pixelTextRight(String(value), BACK_LOGICAL_W - L_MARGIN - 3, y + 2, {
    font: 'standard',
    scale: 2,
    fill: '#fff7e2'
  }));
  const barX = L_MARGIN + 3;
  const barY = y + SPIRIT_PANEL_H - 3;
  const barMax = L_CONTENT_W - 6;
  const fillW = Math.max(1, Math.round((value / 99) * barMax));
  layers.push(rectPx(barX, barY, barMax, 2, darken(theme.bg, 0.4)));
  layers.push(rectPx(barX, barY, fillW, 2, theme.accent));
  return { layers, endY: y + SPIRIT_PANEL_H };
}

// ─── Layer 7 — CHALLENGE STATS (Bark/Bite/Zoom/Charm) ────────────

function backChallengeStats(display, theme, startY) {
  const layers = [];
  layers.push(sectionTitle('CHALLENGE STATS', startY, theme));
  // Keep label casing as written. The pixel-text renderer normalises
  // to upper-case glyphs on the way out, but the original source
  // string lives on data-text for QA / metadata.
  const rows = [
    ['Bark', display.bark],
    ['Bite', display.bite],
    ['Zoom', display.zoom],
    ['Charm', display.charm]
  ];
  const rowStart = startY + 8;
  for (let i = 0; i < rows.length; i++) {
    const [label, value] = rows[i];
    const y = rowStart + i * STATS_ROW_HEIGHT;
    layers.push(pixelText(label, L_MARGIN, y, {
      font: 'tiny',
      scale: 1,
      fill: '#fff7e2'
    }));
    layers.push(pixelTextRight(String(value), BACK_LOGICAL_W - L_MARGIN, y, {
      font: 'tiny',
      scale: 1,
      fill: theme.accent
    }));
    const barX = L_MARGIN + 24;
    const barY = y + 5;
    const barMax = L_CONTENT_W - 24 - 14;
    const fillW = Math.max(1, Math.round((value / 99) * barMax));
    layers.push(rectPx(barX, barY, barMax, 1, darken(theme.bg, 0.42)));
    layers.push(rectPx(barX, barY, fillW, 1, theme.accent));
  }
  return { layers, endY: rowStart + rows.length * STATS_ROW_HEIGHT };
}

// ─── Layer 8 — ABILITY ───────────────────────────────────────────

function backAbility(game, theme, startY) {
  const out = [];
  out.push(sectionTitle('ABILITY', startY, theme));
  const role = String(game.gameType || '').toUpperCase().replace(/_/g, ' ');
  out.push(pixelTextRight(role, BACK_LOGICAL_W - L_MARGIN, startY, {
    font: 'tiny',
    scale: 1,
    fill: theme.accent
  }));
  const ability = String(game.abilityLine || 'No effect.');
  // Wrap up to enough lines to fit between the title and the footer
  // divider, given variable layout above. At ABILITY_LINE_HEIGHT=6 the
  // available room is (Y_FOOTER_DIVIDER - 4) - (startY + 7) = how many
  // 6-px lines fit. Cap at 3 lines so the footer is never crushed.
  const available = Math.max(1, Y_FOOTER_DIVIDER - 4 - (startY + 7));
  const maxAbilityLines = Math.min(3, Math.max(1, Math.floor(available / ABILITY_LINE_HEIGHT)));
  const lines = wrapPixelText(ability, L_CONTENT_W, 1, maxAbilityLines, 1, 'tiny');
  for (let i = 0; i < lines.length; i++) {
    out.push(pixelText(lines[i], L_MARGIN, startY + 7 + i * ABILITY_LINE_HEIGHT, {
      font: 'tiny',
      scale: 1,
      fill: '#fff7e2'
    }));
  }
  return out;
}

// ─── Layer 9 — Footer (RESCUE / AFFILIATE / AUTH + CTA) ──────────

function backFooter(parsed, theme) {
  const out = [];
  out.push(rectPx(L_MARGIN, Y_FOOTER_DIVIDER, L_CONTENT_W, 1, theme.border));
  out.push(pixelText(`RESCUE ${RESCUE_WEIGHT_PER_REVEALED_CARD}`, L_MARGIN, Y_FOOTER_ROW, {
    font: 'tiny',
    scale: 1,
    fill: theme.accent
  }));
  out.push(pixelText(`AFFILIATE ${AFFILIATE_WEIGHT_PER_REVEALED_CARD}`, L_MARGIN + 38, Y_FOOTER_ROW, {
    font: 'tiny',
    scale: 1,
    fill: theme.accent
  }));
  out.push(pixelTextRight('SERIES 1 AUTH', BACK_LOGICAL_W - L_MARGIN, Y_FOOTER_ROW, {
    font: 'tiny',
    scale: 1,
    fill: theme.accent
  }));
  // Canonical CTA — centered, tiny scale 1.
  const cta = 'Buy a fake dog. Help a real one.';
  const ctaMetrics = pixelTextMetrics(cta, { font: 'tiny', scale: 1 });
  out.push(pixelText(cta, Math.floor((BACK_LOGICAL_W - ctaMetrics.width) / 2), Y_CTA, {
    font: 'tiny',
    scale: 1,
    fill: '#fff7e2'
  }));
  return out;
}

// ─── Layer 10 — outer frame + corner pips (rarity marker) ────────

function backFrame(theme, parsed) {
  const out = [];
  const w = BACK_LOGICAL_W;
  const h = BACK_LOGICAL_H;
  const c = theme.border;
  // 1-pixel-logical outer edge ring.
  out.push(rectPx(0, 0, w, 1, c));
  out.push(rectPx(0, h - 1, w, 1, c));
  out.push(rectPx(0, 0, 1, h, c));
  out.push(rectPx(w - 1, 0, 1, h, c));
  // 2×2 corner pips for premium variants — in the accent colour so
  // they pop against the border.
  if (CORNER_PIPS_VARIANTS.has(parsed.variant)) {
    out.push(rectPx(3, 3, 2, 2, theme.accent));
    out.push(rectPx(w - 5, 3, 2, 2, theme.accent));
    out.push(rectPx(3, h - 5, 2, 2, theme.accent));
    out.push(rectPx(w - 5, h - 5, 2, 2, theme.accent));
  }
  return out;
}

// ─── Section title helper ────────────────────────────────────────

function sectionTitle(title, y, theme) {
  // No left accent bar — the bar alone was reading as a glyph (e.g.
  // " | LORE" → "ILORE"). The title alone plus the surrounding
  // dividers carries enough hierarchy.
  return pixelText(title, L_MARGIN, y, {
    font: 'tiny',
    scale: 1,
    fill: theme.accent
  });
}

// ─── Pixel-text helpers ──────────────────────────────────────────

function pixelTextRight(text, rightX, y, opts) {
  const w = pixelTextMetrics(text, opts).width;
  return pixelText(text, rightX - w, y, opts);
}

function clampPixelLine(text, maxW, scale, font) {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (pixelTextMetrics(normalized, { font, scale }).width <= maxW) return normalized;
  let out = normalized;
  while (out.length > 4 && pixelTextMetrics(`${out}...`, { font, scale }).width > maxW) {
    out = out.slice(0, -1).trim();
  }
  return `${out}...`;
}

function compactMetaLine(parsed) {
  const serial = parsed.mythic ? '1/1' : `${parsed.serial}/${parsed.printCount}`;
  // For 1/1 cards (mythic + mythic_insert) the variant label already
  // tells you it's a 1-of-1 — no separate rarity column, no "MYTHIC
  // MYTH" duplication.
  if (parsed.cardClass === 'true_mythic_spaniel') return `MYTHIC 1/1`;
  if (parsed.cardClass === 'mythic_insert')      return `INSERT 1/1`;
  if (parsed.cardClass === 'generic_common')     return `GENERIC ${serial}`;
  const variant = compactVariantLabel(parsed);
  const rarity = compactRarityLabel(getVariant(parsed.variant)?.rarityGroup || '');
  const line = `${variant} ${rarity} ${serial}`;
  return clampPixelLine(line, L_CONTENT_W, 1, 'tiny');
}

function compactVariantLabel(parsed) {
  if (parsed.variant === 'holiday' && parsed.stampType) {
    return parsed.stampType.replace(/_/g, ' ').toUpperCase();
  }
  if (parsed.variant === 'plate' && parsed.plateColor) {
    return `${parsed.plateColor.toUpperCase()} PLATE`;
  }
  const variantLabel = getVariant(parsed.variant)?.label || parsed.variant;
  return String(variantLabel || '').replace(/1\/1/g, '').trim().toUpperCase();
}

function compactRarityLabel(rarity) {
  const r = String(rarity || '').toUpperCase();
  if (r === 'UNCOMMON') return 'UNCOM';
  if (r === 'MYTHIC') return 'MYTH';
  return r;
}

function titleFromLore(parsed, lore) {
  if (parsed.cardClass === 'true_mythic_spaniel') {
    if (lore?.name) return lore.name;
    return reservedMythicName(parsed.dogId);
  }
  if (parsed.cardClass === 'mythic_insert') {
    return (lore && lore.name) || mythicInsertName(parsed.mythicInsertId);
  }
  if (parsed.cardClass === 'generic_common') {
    return (lore && lore.name) || genericDesignName(parsed.genericDesignId);
  }
  return `Spaniel #${pad5(parsed.dogId)}`;
}

function bigNumberFor(parsed) {
  if (parsed.cardClass === 'true_mythic_spaniel') return `#${pad5(parsed.dogId)}`;
  if (parsed.cardClass === 'mythic_insert')      return `Insert ${pad3(parsed.mythicInsertId)}`;
  if (parsed.cardClass === 'generic_common')     return `Design ${pad3(parsed.genericDesignId)}`;
  return `#${pad5(parsed.dogId)}`;
}

function pad5(n) { return String(n).padStart(5, '0'); }
function pad3(n) { return String(n).padStart(3, '0'); }

// ─── Lore copy ───────────────────────────────────────────────────

function loreCopy(parsed, lore) {
  if (!lore) return '';
  if (parsed.cardClass === 'true_mythic_spaniel') {
    if (lore.anchor) return lore.anchor;
    return lore.flavor || 'Mythic identity reserved — authored lore arrives before final manifest generation.';
  }
  if (parsed.cardClass === 'mythic_insert') {
    return lore.flavor || '1/1 Mythic Insert. No dog identity. Unique effect committed at manifest generation.';
  }
  if (parsed.cardClass === 'generic_common') {
    return lore.flavor || 'Generic common card. Useful in your kennel.';
  }
  const personality = lore.personality || (lore.personalityTags || []).join(', ');
  const backstory = lore.backstory || '';
  if (personality && backstory) return `${personality}. ${backstory}`;
  return personality || backstory || '';
}

// ─── Lore hydration (only when caller did not pass opts.lore) ────

function hydrateLore(parsed) {
  switch (parsed.cardClass) {
    case 'true_mythic_spaniel': {
      const lore = mythicLoreFor(parsed.dogId);
      if (lore) {
        return { kind: 'mythic_authored', name: lore.name, anchor: lore.anchor, flavor: lore.anchor };
      }
      return {
        kind: 'mythic_reserved',
        name: reservedMythicName(parsed.dogId),
        anchor: null,
        flavor: 'Authored lore arrives before final manifest generation.'
      };
    }
    case 'mythic_insert':
      return {
        kind: 'mythic_insert',
        name: mythicInsertName(parsed.mythicInsertId),
        flavor: mythicInsertFlavor(parsed.mythicInsertId)
      };
    case 'generic_common':
      return {
        kind: 'generic_common',
        name: genericDesignName(parsed.genericDesignId),
        flavor: genericDesignFlavor(parsed.genericDesignId)
      };
    case 'standard_spaniel': {
      const personality = personalityForStandardSpaniel(parsed.cardKey, parsed.dogId);
      const backstory = backstoryForStandardSpaniel(parsed.cardKey, parsed.dogId);
      return {
        kind: 'standard_spaniel',
        name: `Spaniel #${parsed.dogId}`,
        personality: personality.tags.join(', '),
        backstory
      };
    }
    default:
      return null;
  }
}

export { themeForCard, CARD_W, CARD_H };
