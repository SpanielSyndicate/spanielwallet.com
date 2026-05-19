// Spaniel Syndicate — card frame chrome (front-side).
//
// Trading-card frame styling per variant. The 24×24 pixel dog art
// stays the centerpiece; the frame surrounds it with a variant-
// specific border, background gradient, foil treatment, and stamp.
//
// We render as a self-contained SVG string. The frame is fully
// deterministic from the variant slug + a few inputs (cardKey,
// rarityGroup, serial, stamp, plate) so every wallet renders the
// same image for the same card.
//
// Card geometry (2.5 × 3.5 trading-card ratio):
//
//   --card-w: 750px
//   --card-h: 1050px
//   --art-w / art-h: 480x480 (24x24 dog upscaled 20×, nearest-neighbor)
//   --art-x / art-y: centered with extra top margin for nameplate

import { getVariant, VARIANTS } from './series1.js';

export const CARD_FRAME_VERSION = 'card-frame-v1';

export const CARD_W = 750;
export const CARD_H = 1050;
export const ART_W = 480;
export const ART_H = 480;
export const ART_X = (CARD_W - ART_W) / 2;
export const ART_Y = 220;

// Per-variant theme. Colors are intentional dark/jewel palette to
// match the existing site CSS.
const VARIANT_THEMES = Object.freeze({
  generic:        { bg: '#1d1b25', border: '#665b48', foil: 'matte',     accent: '#bca56f' },
  base:           { bg: '#181621', border: '#5b5468', foil: 'matte',     accent: '#cfc9d8' },
  bronze:         { bg: '#2a1d10', border: '#8a5a2b', foil: 'metal',     accent: '#c98a48' },
  silver:         { bg: '#1c1d20', border: '#9aa1ad', foil: 'metal',     accent: '#d9d9d9' },
  refractor:      { bg: '#0e1430', border: '#c87dff', foil: 'rainbow',   accent: '#5fd4ff' },
  holo:           { bg: '#101b29', border: '#5fd4ff', foil: 'holo',      accent: '#a8e2ff' },
  holiday:        { bg: '#1c1320', border: '#ff7d9e', foil: 'matte',     accent: '#ffd9a0' },
  sparkle:        { bg: '#1c1825', border: '#f5df88', foil: 'sparkle',   accent: '#fff7e2' },
  plate:          { bg: '#0a0a0a', border: '#ffffff', foil: 'plate',     accent: '#ffffff' },
  gold:           { bg: '#251a07', border: '#f5b500', foil: 'gold',      accent: '#fff0a8' },
  error:          { bg: '#22070a', border: '#f06262', foil: 'matte',     accent: '#ff95a0' },
  black:          { bg: '#000000', border: '#cfcfcf', foil: 'matte',     accent: '#ffffff' },
  mythic:         { bg: '#0e0a1e', border: '#c87dff', foil: 'mythic',    accent: '#f5df88' },
  mythic_insert:  { bg: '#1e0a18', border: '#ff7d9e', foil: 'mythic',    accent: '#c87dff' }
});

const PLATE_COLOR_FILL = Object.freeze({
  cyan:    '#00b6e3',
  magenta: '#e000a8',
  yellow:  '#f5d400',
  key:     '#0a0a0a'
});

export function themeForCard(parsed) {
  if (!parsed || !parsed.variant) return VARIANT_THEMES.base;
  if (parsed.variant === 'plate' && parsed.plateColor) {
    const base = VARIANT_THEMES.plate;
    return { ...base, border: PLATE_COLOR_FILL[parsed.plateColor] || base.border };
  }
  return VARIANT_THEMES[parsed.variant] || VARIANT_THEMES.base;
}

export const VARIANT_THEMES_DEFS = VARIANT_THEMES;
