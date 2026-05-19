// Spaniel Syndicate — pixel-art background extrapolation.
//
// The 24×24 dog art carries its own background. To build a full
// 2.5:3.5 trading-card image we extend that background across a
// low-resolution logical pixel canvas (CARD_FRONT_LOGICAL_W ×
// CARD_FRONT_LOGICAL_H) and then composite the dog sprite on top.
//
// Pure deterministic SVG-rect emission. No text. No rounded
// geometry. Same inputs → byte-identical output.
//
// CLAUDE.md anchors:
//   §0 — sharp pixel/card geometry, no UI on the front
//   §2.16 — metadata schema (the back, not the front, carries text)

export const PIXEL_BACKGROUND_VERSION = 'pixel-background-v1';

// Logical pixel canvas — 5:7 ratio = the canonical trading-card 2.5:3.5
// proportion at integer scale. Each logical pixel renders to a 10×10
// block at the 750×1050 SVG output, so the bg is crisp at
// image-rendering: pixelated.
export const CARD_FRONT_LOGICAL_W = 75;
export const CARD_FRONT_LOGICAL_H = 105;
export const CARD_FRONT_PIXEL_SCALE = 10;
export const CARD_FRONT_OUTPUT_W = CARD_FRONT_LOGICAL_W * CARD_FRONT_PIXEL_SCALE; // 750
export const CARD_FRONT_OUTPUT_H = CARD_FRONT_LOGICAL_H * CARD_FRONT_PIXEL_SCALE; // 1050

// Dog sprite placement inside the logical canvas. The native 24×24
// sprite is rendered at 2× to 48×48 logical pixels and centered
// horizontally with the feet line at y=80 (about 76% down) so the
// extrapolated floor/atmosphere reads naturally.
export const DOG_LOGICAL_W = 48;
export const DOG_LOGICAL_H = 48;
export const DOG_LOGICAL_X = Math.round((CARD_FRONT_LOGICAL_W - DOG_LOGICAL_W) / 2); // 14
export const DOG_FEET_LINE_Y = 80;
export const DOG_LOGICAL_Y = DOG_FEET_LINE_Y - DOG_LOGICAL_H; // 32

// FNV-1a-32 lives in util-hash.js — single source of truth for the
// deterministic seeding used by both the renderer and the personality
// generator. Re-exported below for callers that already import it
// from this module.
import { fnv32 } from './util-hash.js';

function lcg(seed) {
  let s = seed >>> 0;
  return function next() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
}

function pickInt(rng, max) {
  return rng() % Math.max(1, max | 0);
}

// ─── Scene resolution ─────────────────────────────────────────────

const KNOWN_ATMOSPHERIC_BG_IDS = new Set(['nightwall', 'gridwall', 'holowall']);

/**
 * Normalize a caller-supplied scene into a renderable scene object.
 * Falls back to a deterministic scene derived from the cardKey when
 * the caller has no engine token in hand.
 *
 * scene shape:
 *   { bgColor: '#rrggbb',      // solid wall color
 *     bgKind:  'flat'|'nightwall'|'gridwall'|'holowall',
 *     bgSeed:  uint32 }
 *
 * @param {object|null|undefined} scene
 * @param {object} parsed — normalized parsed card object (must carry cardKey)
 * @returns {{ bgColor: string, bgKind: string, bgSeed: number }}
 */
export function resolveScene(scene, parsed) {
  const fallback = fallbackSceneFor(parsed);
  if (!scene || typeof scene !== 'object') return fallback;
  const bgKind = typeof scene.bgKind === 'string' && KNOWN_ATMOSPHERIC_BG_IDS.has(scene.bgKind)
    ? scene.bgKind
    : 'flat';
  const bgColor = isHexColor(scene.bgColor) ? scene.bgColor : fallback.bgColor;
  const bgSeed = Number.isFinite(scene.bgSeed) ? (scene.bgSeed >>> 0) : fallback.bgSeed;
  return { bgColor, bgKind, bgSeed };
}

function isHexColor(s) {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}

// Deterministic fallback scene for cards we don't have engine token
// data for (worker render path, public card page without a baked
// art sidecar). The dog's own 24×24 bg patch sits on top of this
// fallback, so the patch may look like a sticker for non-engine
// callers — that's acceptable until the worker grows a scene
// sidecar endpoint.
const FALLBACK_BG_PALETTE = [
  { id: 'powder',    color: '#8db0e8', kind: 'flat' },
  { id: 'mint',      color: '#bfe8c8', kind: 'flat' },
  { id: 'parchment', color: '#f0dfb9', kind: 'flat' },
  { id: 'peach',     color: '#efbd9f', kind: 'flat' },
  { id: 'lilac',     color: '#cfc0ef', kind: 'flat' },
  { id: 'aqua',      color: '#a6dfdc', kind: 'flat' },
  { id: 'sand',      color: '#d7c19a', kind: 'flat' },
  { id: 'sky',       color: '#a8d7e5', kind: 'flat' },
  { id: 'nightwall', color: '#1c2649', kind: 'nightwall' },
  { id: 'holowall',  color: '#dcd3ee', kind: 'holowall' },
  { id: 'gridwall',  color: '#3a234e', kind: 'gridwall' }
];

function fallbackSceneFor(parsed) {
  const seed = fnv32(`scene::${parsed.cardKey || ''}`);
  const pick = FALLBACK_BG_PALETTE[seed % FALLBACK_BG_PALETTE.length];
  return { bgColor: pick.color, bgKind: pick.kind, bgSeed: seed };
}

// ─── Pixel emission helpers ───────────────────────────────────────

function px(x, y, fill) {
  return `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
}

function rectPx(x, y, w, h, fill) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}

// ─── Atmospheric extension ────────────────────────────────────────

/**
 * Emit the per-bgKind atmospheric pixel layer (stars, grid, holo
 * shimmer) painted on top of the solid bg fill.
 *
 * @param {{ bgKind: string, bgSeed: number }} scene
 * @returns {string[]} array of SVG fragments
 */
export function atmosphericPixels(scene) {
  switch (scene.bgKind) {
    case 'nightwall': return nightStars(scene.bgSeed);
    case 'gridwall':  return vaporGrid(scene.bgSeed);
    case 'holowall':  return holoShimmer(scene.bgSeed);
    default:          return [];
  }
}

function nightStars(seed) {
  const rng = lcg(seed ^ 0xa11e5);
  const out = [];
  const starHi = '#fff7e2';
  const starMid = '#cfd8e8';
  const starLow = '#7c8aa8';
  // Stars in the "sky" band (y < dog top) and a few in the upper
  // half of the floor band. Keep clear of the dog's body area
  // (x∈[14,62), y∈[32,80)) so the dog reads cleanly against bg.
  const candidates = [];
  for (let y = 1; y < 30; y++) {
    for (let x = 1; x < CARD_FRONT_LOGICAL_W - 1; x++) {
      candidates.push([x, y]);
    }
  }
  // 28 stars sprinkled deterministically.
  const TARGET = 28;
  const seen = new Set();
  for (let i = 0; i < TARGET; i++) {
    const idx = pickInt(rng, candidates.length);
    const key = `${candidates[idx][0]},${candidates[idx][1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const [x, y] = candidates[idx];
    const tier = i % 6;
    const color = tier < 2 ? starHi : tier < 4 ? starMid : starLow;
    out.push(px(x, y, color));
  }
  return out;
}

function vaporGrid(seed) {
  const rng = lcg(seed ^ 0x91d10);
  const out = [];
  const line = '#6e3fb0';
  const accent = '#ff7ce0';
  // Horizon line at y=58 — the canonical vaporwave grid horizon.
  out.push(rectPx(0, 58, CARD_FRONT_LOGICAL_W, 1, line));
  // Receding horizontal grid lines (perspective).
  for (let i = 1; i <= 4; i++) {
    const y = 58 + i * 4;
    if (y >= CARD_FRONT_LOGICAL_H - 1) break;
    out.push(rectPx(0, y, CARD_FRONT_LOGICAL_W, 1, line));
  }
  // Receding vertical grid columns (perspective ⇒ converging on cx).
  const cx = Math.floor(CARD_FRONT_LOGICAL_W / 2);
  for (let i = 1; i <= 6; i++) {
    const dx = i * 5;
    out.push(rectPx(cx - dx, 58, 1, CARD_FRONT_LOGICAL_H - 58, line));
    out.push(rectPx(cx + dx, 58, 1, CARD_FRONT_LOGICAL_H - 58, line));
  }
  // Accent star above the horizon.
  for (let i = 0; i < 4; i++) {
    const x = 4 + pickInt(rng, CARD_FRONT_LOGICAL_W - 8);
    const y = 4 + pickInt(rng, 24);
    out.push(px(x, y, accent));
  }
  return out;
}

function holoShimmer(seed) {
  const rng = lcg(seed ^ 0xd1bbed);
  const out = [];
  const palette = ['#f0c4ff', '#c4e1ff', '#fff7e2', '#bff5e0', '#fce0c4'];
  // Sprinkle 24 shimmer pixels across the bg, biased to corners.
  for (let i = 0; i < 24; i++) {
    const x = pickInt(rng, CARD_FRONT_LOGICAL_W);
    const y = pickInt(rng, CARD_FRONT_LOGICAL_H);
    // Skip the dog sprite footprint.
    if (x >= DOG_LOGICAL_X && x < DOG_LOGICAL_X + DOG_LOGICAL_W
      && y >= DOG_LOGICAL_Y && y < DOG_LOGICAL_Y + DOG_LOGICAL_H) {
      continue;
    }
    const color = palette[pickInt(rng, palette.length)];
    out.push(px(x, y, color));
  }
  return out;
}

// ─── Foot shadow ──────────────────────────────────────────────────

/**
 * Tiny shadow blob directly under the dog's feet — three soft pixel
 * blobs, one per foot column, kept well inside the dog's horizontal
 * footprint so the shadow reads as "dog grounding" rather than a
 * full-card horizon line. The earlier full-row floorBand created a
 * visible shelf/ground line that made the card feel like a framed
 * portrait; this replaces it with discrete pixel shadows.
 *
 * @param {{ bgColor: string }} scene
 * @returns {string[]}
 */
export function footShadow(scene) {
  const shadow = darken(scene.bgColor, 0.32);
  const halo   = darken(scene.bgColor, 0.18);
  const y = DOG_FEET_LINE_Y;
  // Three foot blobs spread under the dog torso (matching the
  // canonical 24×24 dog: feet roughly at sprite x ∈ {6, 11, 17}).
  // After 2× upscale and the DOG_LOGICAL_X=14 offset, these land at
  // ~26, 36, 48 in the logical 75-wide grid.
  const feet = [26, 36, 48];
  const out = [];
  for (const fx of feet) {
    out.push(rectPx(fx - 1, y, 3, 1, shadow));
    out.push(px(fx - 2, y, halo));
    out.push(px(fx + 2, y, halo));
  }
  return out;
}

// Helper — darken a hex color by a 0..1 fraction.
function darken(hex, frac) {
  const [r, g, b] = parseHex(hex);
  const f = 1 - Math.max(0, Math.min(1, frac));
  return rgbToHex(Math.round(r * f), Math.round(g * f), Math.round(b * f));
}

function lighten(hex, frac) {
  const [r, g, b] = parseHex(hex);
  const f = Math.max(0, Math.min(1, frac));
  return rgbToHex(
    Math.round(r + (255 - r) * f),
    Math.round(g + (255 - g) * f),
    Math.round(b + (255 - b) * f)
  );
}

function parseHex(hex) {
  const h = (hex || '#000000').replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) | 0,
    parseInt(h.slice(2, 4), 16) | 0,
    parseInt(h.slice(4, 6), 16) | 0
  ];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b]
    .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
    .join('');
}

export { fnv32, lcg, pickInt, px, rectPx, darken, lighten, parseHex, rgbToHex };
