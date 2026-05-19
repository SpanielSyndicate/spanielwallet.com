// Spaniel Syndicate — trading-card back-side renderer.
//
// THE BACK CARRIES THE METADATA. The front is art (see card-front-
// art.js); the back is where you find:
//
//   - card name + big card number
//   - card key
//   - variant + rarity + serial
//   - lore / anchor / backstory
//   - SPIRIT (HP-like; the card's staying power in a match)
//   - 4 challenge stats: BARK / BITE / ZOOM / CHARM
//   - one ability line
//   - Rescue Weight + Affiliate Weight
//   - Series 1 authenticity footer + CTA
//
// Pokémon-readable on purpose. The back exposes the 5-stat displayStats
// model from showdown-stats.js — never the internal 12-stat combat/
// support/derived block. Those values still exist for the deeper game
// engine, but they are NOT shown on the card; a player should be able
// to read every visible number in under 3 seconds.
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
import {
  personalityForStandardSpaniel,
  backstoryForStandardSpaniel,
  genericDesignName,
  genericDesignFlavor,
  mythicInsertName,
  mythicInsertFlavor,
  reservedMythicName
} from './personality.js';

export const CARD_BACK_VERSION = 'card-back-v3.2';

const MARGIN = 60;
const CONTENT_W = CARD_W - MARGIN * 2; // 630
const SECTION_ACCENT_BAR_W = 8;

function svgEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
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
  // 1. Page fill
  layers.push(`<rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="${theme.bg}"/>`);

  // 2. Hairline outer frame (sharp, no rx).
  layers.push(
    `<rect x="0" y="0" width="${CARD_W}" height="${CARD_H}" fill="none" stroke="${theme.border}" stroke-width="6"/>`,
    `<rect x="12" y="12" width="${CARD_W - 24}" height="${CARD_H - 24}" fill="none" stroke="${theme.accent}" stroke-width="2" stroke-opacity="0.45"/>`
  );

  // 3. Header band (variant accent strip at the top).
  layers.push(
    `<rect x="0" y="0" width="${CARD_W}" height="14" fill="${theme.accent}"/>`,
    `<rect x="0" y="14" width="${CARD_W}" height="6" fill="${theme.border}"/>`
  );

  // 4. Header — name, big card number, card key, variant/rarity/serial.
  layers.push(headerBlock(parsed, lore, theme));

  // 5. Lore section. Slightly smaller body, 3 lines max — lore is
  // flavor and must not crowd the hero stats below.
  const loreOriginY = 290;
  layers.push(sectionTitle('LORE', MARGIN, loreOriginY, theme));
  const loreText = loreCopy(parsed, lore);
  const loreNextY = wrapTextLines(layers, loreText, MARGIN, loreOriginY + 38, CONTENT_W, 20, 28, '#e6dfd0', 3);

  // 6. SPIRIT — Pokémon-style HP block, prominent. Big number on the
  // right, big "SPIRIT" label on the left, single horizontal bar.
  const spiritOriginY = Math.max(loreNextY + 32, 470);
  layers.push(...spiritBlock(display, theme, MARGIN, spiritOriginY));

  // 7. Challenge stats — BARK / BITE / ZOOM / CHARM, four big rows.
  const challengeOriginY = spiritOriginY + 100;
  layers.push(sectionTitle('CHALLENGE STATS', MARGIN, challengeOriginY, theme));
  const challengeNextY = challengeStatsBlock(layers, display, theme, MARGIN, challengeOriginY + 36);

  // 8. ABILITY — one ability line; bordered band so it reads as the
  // single hero mechanic.
  const abilityY = challengeNextY + 16;
  layers.push(sectionTitle('ABILITY', MARGIN, abilityY, theme));
  layers.push(...abilityBlock(parsed, game, theme, MARGIN, abilityY + 36));

  // 9. Footer — Rescue Weight, Affiliate Weight, authenticity, CTA.
  layers.push(footerBlock(parsed, theme));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}" class="spaniel-card spaniel-card-back" data-card-key="${svgEscape(parsed.cardKey)}" data-variant="${svgEscape(parsed.variant)}" shape-rendering="crispEdges">`,
    layers.join(''),
    `</svg>`
  ].join('');
}

// ─── Header ──────────────────────────────────────────────────────

function headerBlock(parsed, lore, theme) {
  const out = [];
  const name = titleFromLore(parsed, lore);
  const number = bigNumberFor(parsed);
  const variantLabel = getVariant(parsed.variant)?.label || parsed.variant;
  const rarity = parsed.mythic ? 'Mythic' : titleCase(getVariant(parsed.variant)?.rarityGroup || '');
  const serial = parsed.mythic
    ? '1 / 1'
    : `${parsed.serial} / ${parsed.printCount}`;

  // Top ribbon row — series mark + big number badge.
  out.push(
    `<text x="${MARGIN}" y="68" font-family="Bebas Neue, 'DM Mono', monospace" font-size="22" letter-spacing="3" fill="${theme.accent}">SPANIEL SYNDICATE · SERIES 1</text>`,
    `<text x="${CARD_W - MARGIN}" y="70" text-anchor="end" font-family="Bebas Neue, 'DM Mono', monospace" font-size="44" letter-spacing="2" fill="${theme.accent}">${svgEscape(number)}</text>`
  );
  // Name on its own full-width row. Shrink for the very long mythic
  // anchor names so they don't crowd the badge or wrap.
  const nameSize = nameFontSize(name);
  out.push(
    `<text x="${MARGIN}" y="138" font-family="Bebas Neue, 'DM Sans', sans-serif" font-size="${nameSize}" font-weight="800" letter-spacing="1" fill="#fff7e2">${svgEscape(name)}</text>`
  );
  // Card-key line + variant/rarity/serial
  out.push(
    `<text x="${MARGIN}" y="184" font-family="DM Mono, monospace" font-size="22" fill="#cfc9d8">${svgEscape(parsed.cardKey)}</text>`,
    `<text x="${MARGIN}" y="222" font-family="DM Sans, sans-serif" font-size="22" font-weight="600" fill="#fff7e2">${svgEscape(variantLabel)}</text>`,
    `<text x="${MARGIN + 220}" y="222" font-family="DM Sans, sans-serif" font-size="22" fill="#cfc9d8">${svgEscape(rarity)}</text>`,
    `<text x="${MARGIN + 380}" y="222" font-family="DM Sans, sans-serif" font-size="22" fill="#cfc9d8">${svgEscape(serial)}</text>`
  );
  // Divider line under header
  out.push(`<rect x="${MARGIN}" y="248" width="${CONTENT_W}" height="2" fill="${theme.border}"/>`);
  return out.join('');
}

function nameFontSize(name) {
  const len = String(name).length;
  if (len <= 14) return 60;
  if (len <= 18) return 52;
  if (len <= 22) return 44;
  return 36;
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

function titleCase(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Section title ───────────────────────────────────────────────

function sectionTitle(title, x, y, theme) {
  return [
    `<rect x="${x - 8}" y="${y - 20}" width="${SECTION_ACCENT_BAR_W}" height="28" fill="${theme.accent}"/>`,
    `<text x="${x + 8}" y="${y}" font-family="Bebas Neue, 'DM Mono', monospace" font-size="26" letter-spacing="3" fill="${theme.accent}">${svgEscape(title)}</text>`
  ].join('');
}

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
  // standard_spaniel — pair personality + backstory.
  const personality = lore.personality || (lore.personalityTags || []).join(', ');
  const backstory = lore.backstory || '';
  if (personality && backstory) return `${personality}. ${backstory}`;
  return personality || backstory || '';
}

// ─── Wrapped text helper ─────────────────────────────────────────

function wrapTextLines(layers, text, x, y, maxWidth, fontSize, lineHeight, fill, maxLines) {
  const approxChars = Math.floor(maxWidth / (fontSize * 0.5));
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const w of words) {
    const candidate = current ? current + ' ' + w : w;
    if (candidate.length > approxChars && current) {
      lines.push(current);
      current = w;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  const slice = lines.slice(0, maxLines);
  for (let i = 0; i < slice.length; i++) {
    layers.push(
      `<text x="${x}" y="${y + i * lineHeight}" font-family="DM Sans, sans-serif" font-size="${fontSize}" fill="${fill}">${svgEscape(slice[i])}</text>`
    );
  }
  return y + slice.length * lineHeight;
}

// ─── SPIRIT (HP-like) block ──────────────────────────────────────

function spiritBlock(display, theme, x, y) {
  const out = [];
  const blockH = 86;
  const value = display.spirit;
  // Background panel for the SPIRIT block — slightly elevated tone so
  // the HP number reads as the hero number of the card.
  out.push(
    `<rect x="${x}" y="${y - 28}" width="${CONTENT_W}" height="${blockH}" fill="rgba(255,255,255,0.045)" stroke="${theme.border}" stroke-width="2"/>`
  );
  // Bold "SPIRIT" label on the left, big number on the right, single
  // horizontal HP bar across the bottom of the panel. The earlier
  // "Health · staying power" subtitle was redundant with the SPIRIT
  // label and overlapped the bar — drop it in favour of more
  // breathing room.
  out.push(
    `<text x="${x + 18}" y="${y + 14}" font-family="Bebas Neue, 'DM Mono', monospace" font-size="36" letter-spacing="3" fill="${theme.accent}">SPIRIT</text>`,
    `<text x="${x + CONTENT_W - 28}" y="${y + 28}" text-anchor="end" font-family="Bebas Neue, 'DM Mono', monospace" font-size="64" font-weight="800" fill="#fff7e2">${value}</text>`
  );
  const barX = x + 18;
  const barY = y + 40;
  const barMax = CONTENT_W - 36;
  const fillW = Math.round((value / 99) * barMax);
  out.push(
    `<rect x="${barX}" y="${barY}" width="${barMax}" height="10" fill="rgba(255,255,255,0.08)"/>`,
    `<rect x="${barX}" y="${barY}" width="${fillW}" height="10" fill="${theme.accent}"/>`
  );
  return out;
}

// ─── Challenge stats (Bark/Bite/Zoom/Charm) ──────────────────────

function challengeStatsBlock(layers, display, theme, x, y) {
  const ROW_H = 38;
  const rows = [
    { key: 'bark',  label: 'Bark',  value: display.bark },
    { key: 'bite',  label: 'Bite',  value: display.bite },
    { key: 'zoom',  label: 'Zoom',  value: display.zoom },
    { key: 'charm', label: 'Charm', value: display.charm }
  ];
  for (let i = 0; i < rows.length; i++) {
    drawChallengeRow(layers, rows[i].label, rows[i].value, theme, x, y + i * ROW_H);
  }
  return y + rows.length * ROW_H;
}

function drawChallengeRow(layers, label, value, theme, x, y) {
  const v = Math.max(0, Math.min(99, value | 0));
  const LABEL_W = 130;
  const VALUE_W = 70;
  const barX = x + LABEL_W + VALUE_W;
  const barMax = CONTENT_W - LABEL_W - VALUE_W - 4;
  const fillW = Math.round((v / 99) * barMax);
  layers.push(
    `<text x="${x}" y="${y + 4}" font-family="Bebas Neue, 'DM Mono', monospace" font-size="24" letter-spacing="2" fill="#fff7e2">${svgEscape(label)}</text>`,
    `<text x="${x + LABEL_W + VALUE_W - 8}" y="${y + 6}" text-anchor="end" font-family="Bebas Neue, 'DM Mono', monospace" font-size="28" font-weight="800" fill="${theme.accent}">${v}</text>`,
    `<rect x="${barX}" y="${y - 14}" width="${barMax}" height="20" fill="rgba(255,255,255,0.06)"/>`,
    `<rect x="${barX}" y="${y - 14}" width="${fillW}" height="20" fill="${theme.accent}"/>`
  );
}

// ─── Ability ─────────────────────────────────────────────────────

function abilityBlock(parsed, game, theme, x, y) {
  const out = [];
  const role = (game.gameType || '').toUpperCase();
  const ability = game.abilityLine || 'No effect.';
  // The ability is the single special move. The panel uses the accent
  // colour as a left-edge bar so it reads as the hero mechanic; the
  // ROLE chip is small in the upper-right and never competes with the
  // ability text itself.
  out.push(
    `<rect x="${x}" y="${y - 28}" width="${CONTENT_W}" height="92" fill="rgba(255,255,255,0.05)" stroke="${theme.border}" stroke-width="2"/>`,
    `<rect x="${x}" y="${y - 28}" width="6" height="92" fill="${theme.accent}"/>`,
    `<text x="${x + CONTENT_W - 16}" y="${y - 6}" text-anchor="end" font-family="Bebas Neue, 'DM Mono', monospace" font-size="16" letter-spacing="2" fill="${theme.accent}" fill-opacity="0.75">${svgEscape(role)}</text>`,
    `<text x="${x + 22}" y="${y + 38}" font-family="DM Sans, sans-serif" font-size="28" font-weight="800" fill="#fff7e2">${svgEscape(ability)}</text>`
  );
  return out;
}

// ─── Footer ──────────────────────────────────────────────────────

function footerBlock(parsed, theme) {
  const out = [];
  const y = CARD_H - 122;
  // Divider above footer
  out.push(`<rect x="${MARGIN}" y="${y}" width="${CONTENT_W}" height="1" fill="${theme.border}" fill-opacity="0.55"/>`);
  // Left — compact rescue + affiliate weight pair, small. They are
  // information, not headlines; SPIRIT is the only hero number on the
  // card. Right — authenticity mark + card-key echo. Full-width CTA
  // on the last row, set in the warm accent so it carries the page
  // without shouting.
  out.push(
    `<text x="${MARGIN}" y="${y + 26}" font-family="DM Mono, monospace" font-size="14" letter-spacing="2" fill="${theme.accent}" fill-opacity="0.85">RESCUE ${RESCUE_WEIGHT_PER_REVEALED_CARD}</text>`,
    `<text x="${MARGIN + 130}" y="${y + 26}" font-family="DM Mono, monospace" font-size="14" letter-spacing="2" fill="${theme.accent}" fill-opacity="0.85">AFFILIATE ${AFFILIATE_WEIGHT_PER_REVEALED_CARD}</text>`,
    `<text x="${CARD_W - MARGIN}" y="${y + 26}" text-anchor="end" font-family="DM Mono, monospace" font-size="14" letter-spacing="2" fill="${theme.accent}" fill-opacity="0.85">SERIES 1 · AUTHENTICATED</text>`,
    `<text x="${CARD_W - MARGIN}" y="${y + 52}" text-anchor="end" font-family="DM Mono, monospace" font-size="14" fill="#cfc9d8" fill-opacity="0.75">${svgEscape(parsed.cardKey)}</text>`,
    `<text x="${CARD_W / 2}" y="${y + 96}" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="22" font-weight="700" fill="${theme.accent}">Buy a fake dog. Help a real one.</text>`
  );
  return out.join('');
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
