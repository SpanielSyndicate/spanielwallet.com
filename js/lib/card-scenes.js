// Spaniel Syndicate — disciplined pixel-art scene composition for premium card fronts.
//
// Bauhaus / pixel-poster restraint: each mythic dog resolves to a
// scene category that paints a FULL-CARD pixel-art world the dog
// stands in. Every scene is a strict composition of:
//
//   A) background field   — 2 or 3 large geometric color bands
//   B) secondary field    — optional horizon band / panel block
//   C) one iconic motif   — throne, planet, sun, moon, UFO, trophy,
//                            suit-pip, stage cone, neon arch, bamboo
//                            screen, trail. ONE strong silhouette.
//   D) very restrained particle pass (≤ 8 atmosphere pixels) and a
//      compact mythic gold + purple corner accent
//
// What this is NOT, on purpose:
//   - no halo rings around the dog
//   - no ring spam
//   - no decorative confetti
//   - no busy scene-density thresholds
//   - no matrix rain, no scanline storms
//   - no clutter masquerading as detail
//
// The dog reads as the hero. The scene supports the dog. The card
// reads at a glance.
//
// SVG-only emission. No <text>, no rx/ry, no foreignObject, no
// scripts. Deterministic: same dogId + same seed ⇒ byte-identical
// fragment array.
//
// CLAUDE.md anchors:
//   §0 — sharp pixel geometry, no UI on the front, no rounded corners
//   §2.16 — metadata schema lives on the back; the front is art only

import {
  CARD_FRONT_LOGICAL_W,
  CARD_FRONT_LOGICAL_H,
  DOG_LOGICAL_W,
  DOG_LOGICAL_H,
  DOG_LOGICAL_X,
  DOG_LOGICAL_Y,
  lcg,
  pickInt,
  px,
  rectPx
} from './pixel-background.js';

export const CARD_SCENES_VERSION = 'card-scenes-v3';

const DOG_CENTER_X = DOG_LOGICAL_X + Math.floor(DOG_LOGICAL_W / 2);  // 38

// Universal mythic accents (gold + purple). Each scene weaves these
// into its composition (a motif tint, a star highlight, a horizon
// pop) so the gold + purple palette invariant — asserted by
// tests/mythic-showcase-qa.test.mjs — holds regardless of category.
// The pre-v3 renderer painted a literal corner pip in each corner;
// the front no longer carries chrome of any kind, so corner pixels
// are gone. Every scene emits at least one gold pixel and one purple
// pixel inside the composition itself.
const MYTHIC_GOLD = '#f5df88';
const MYTHIC_PURPLE = '#c87dff';
const MYTHIC_ACCENT = '#fff7e2';

// Soft particle cap. No scene emits more than this number of single-
// pixel scatter dots, no matter how busy the previous version was.
// Composition discipline > clutter.
const MAX_PARTICLES = 8;

// ─── Scene categories ───────────────────────────────────────────

export const SCENE_CATEGORIES = Object.freeze([
  'royal_chamber',
  'cosmic_void',
  'casino_table',
  'hacker_den',
  'holiday_moon',
  'bamboo_night',
  'stage_night',
  'apocalypse_green',
  'trophy_wall',
  'divine_light',
  'underground_club',
  'wishing_sky',
  'genesis_dawn',
  'friday_horror',
  'arcade_glow'
]);

// Deterministic mapping: mythic dogId → scene category.
const SCENE_FOR_DOG_ID = Object.freeze({
  // Royal / wealth / Chinese fortune
  69:   'royal_chamber', 88:   'royal_chamber', 808:  'royal_chamber',
  6969: 'royal_chamber', 8888: 'royal_chamber',

  // Cosmos / sci-fi
  3:    'cosmic_void',   42:   'cosmic_void',   137:  'cosmic_void',
  412:  'cosmic_void',   720:  'cosmic_void',   1138: 'cosmic_void',
  1701: 'cosmic_void',   2049: 'cosmic_void',   9000: 'cosmic_void',

  // Gambling
  7:    'casino_table',  21:   'casino_table',

  // Hacking / digital culture
  256:   'hacker_den',   404:   'hacker_den',   1337:  'hacker_den',
  1984:  'hacker_den',   31337: 'hacker_den',   69420: 'hacker_den',

  // Holiday calendar
  14:    'holiday_moon', 101:   'holiday_moon', 214:   'holiday_moon',
  520:   'holiday_moon', 1031:  'holiday_moon', 1212:  'holiday_moon',
  1225:  'holiday_moon', 1488:  'holiday_moon',

  // Bamboo / samurai
  47:    'bamboo_night',

  // Stage / music
  27:    'stage_night',  1969:  'stage_night',  1979:  'stage_night',

  // Apocalypse / weird
  420:   'apocalypse_green', 666: 'apocalypse_green',

  // Trophy / champion
  23:    'trophy_wall',

  // Divine
  777:   'divine_light',

  // Crime / underground
  187:   'underground_club', 221:   'underground_club',
  911:   'underground_club', 1066:  'underground_club',

  // Wishing / luck
  108:   'wishing_sky',  1111:  'wishing_sky',  1313:  'wishing_sky',
  42069: 'wishing_sky',

  // Genesis / first light
  1:     'genesis_dawn',

  // Horror
  13:    'friday_horror',

  // Arcade / vapor
  314:   'arcade_glow'
});

/**
 * Resolve a mythic dogId to a scene category (or null).
 */
export function sceneCategoryForMythicDog(dogId) {
  const n = Number(dogId);
  if (!Number.isInteger(n)) return null;
  return SCENE_FOR_DOG_ID[n] || null;
}

// ─── Pixel-art primitives ───────────────────────────────────────

function band(y, h, fill) {
  return rectPx(0, y, CARD_FRONT_LOGICAL_W, h, fill);
}

function gradientBands(stops) {
  return stops.map((s) => band(s.y, s.h, s.color));
}

function inDog(x, y) {
  return x >= DOG_LOGICAL_X
    && x < DOG_LOGICAL_X + DOG_LOGICAL_W
    && y >= DOG_LOGICAL_Y
    && y < DOG_LOGICAL_Y + DOG_LOGICAL_H;
}

// Native-pixel grid. The dog sprite is 24×24 native pixels upscaled
// 2× into the 75×105 logical canvas; one native dog pixel = 2 logical
// units = 20 device pixels at the 10× canvas scale. Every visible
// pixel on the card face MUST be drawn at this resolution so the bg
// and the dog read at the same pixel density.
const NATIVE = 2;
function snap(n) { return Math.floor(n / NATIVE) * NATIVE; }

// Paint a single native-resolution pixel (2×2 logical block).
function np(x, y, fill) {
  return rectPx(snap(x), snap(y), NATIVE, NATIVE, fill);
}

// Paint a native-resolution rect — coords snapped, dimensions rounded
// up to the next even integer so the cell aligns with the dog's
// native pixel grid.
function nrect(x, y, w, h, fill) {
  const wn = Math.max(NATIVE, Math.ceil(w / NATIVE) * NATIVE);
  const hn = Math.max(NATIVE, Math.ceil(h / NATIVE) * NATIVE);
  return rectPx(snap(x), snap(y), wn, hn, fill);
}

// Filled pixel disk at the dog's native resolution. Emits 2-logical-
// pixel-tall horizontal strips so each disc "step" is one native
// pixel tall, matching the dog sprite.
function pixelDisk(cx, cy, radius, fill) {
  const out = [];
  // Operate in native-pixel units so the disc reads as chunky pixel
  // art at the dog's resolution, never half-pixel-thick rings.
  const ncx = Math.round(cx / NATIVE);
  const ncy = Math.round(cy / NATIVE);
  const nr  = Math.max(1, Math.round(radius / NATIVE));
  const r2 = nr * nr;
  for (let dy = -nr; dy <= nr; dy++) {
    const dx2 = r2 - dy * dy;
    if (dx2 < 0) continue;
    const dx = Math.floor(Math.sqrt(dx2));
    out.push(rectPx(
      (ncx - dx) * NATIVE,
      (ncy + dy) * NATIVE,
      (dx * 2 + 1) * NATIVE,
      NATIVE,
      fill
    ));
  }
  return out;
}

// Sparse atmospheric scatter — emits native-pixel blocks, never sub-
// pixel dots.
function scatter(rng, count, palette, opts = {}) {
  const xMin = opts.xMin ?? 4;
  const xMax = opts.xMax ?? CARD_FRONT_LOGICAL_W - 4;
  const yMin = opts.yMin ?? 4;
  const yMax = opts.yMax ?? CARD_FRONT_LOGICAL_H - 4;
  const skipDog = opts.skipDog !== false;
  const target = Math.min(count, MAX_PARTICLES);
  const out = [];
  let safety = target * 6;
  let placed = 0;
  while (placed < target && safety-- > 0) {
    const x = snap(xMin + pickInt(rng, Math.max(1, xMax - xMin)));
    const y = snap(yMin + pickInt(rng, Math.max(1, yMax - yMin)));
    if (skipDog && inDog(x, y)) continue;
    out.push(np(x, y, palette[placed % palette.length]));
    placed++;
  }
  return out;
}

// Mythic palette tag — a single canonical gold native-pixel and a
// single canonical purple native-pixel high in the sky. Satisfies
// the gold/purple palette invariant at the same pixel resolution as
// the dog sprite.
function mythicPaletteTag() {
  return [
    np(4,                            4, MYTHIC_GOLD),
    np(CARD_FRONT_LOGICAL_W - 6,     4, MYTHIC_PURPLE)
  ];
}

// ─── Scene dispatcher ───────────────────────────────────────────

/**
 * Render the scene composition layers for a mythic card.
 *
 * @param {string} category — one of SCENE_CATEGORIES
 * @param {object} scene
 * @param {number} seedBase
 * @param {number} [dogId] — used by category-internal per-id palette
 *                           branches (e.g. hacker_den distinguishes
 *                           The Elite / The Closer / Leet Zombie).
 */
export function renderScene(category, scene, seedBase, _dogId) {
  switch (category) {
    case 'royal_chamber':    return renderRoyalChamber();
    case 'cosmic_void':      return renderCosmicVoid(scene, seedBase);
    case 'casino_table':     return renderCasinoTable();
    case 'hacker_den':       return renderHackerDen();
    case 'holiday_moon':     return renderHolidayMoon(scene);
    case 'bamboo_night':     return renderBambooNight();
    case 'stage_night':      return renderStageNight();
    case 'apocalypse_green': return renderApocalypseGreen();
    case 'trophy_wall':      return renderTrophyWall();
    case 'divine_light':     return renderDivineLight();
    case 'underground_club': return renderUndergroundClub();
    case 'wishing_sky':      return renderWishingSky();
    case 'genesis_dawn':     return renderGenesisDawn();
    case 'friday_horror':    return renderFridayHorror(scene);
    case 'arcade_glow':      return renderArcadeGlow();
    default:                 return [];
  }
}

// Luminance check — pick a motif palette that contrasts with the
// dog's own wall colour. Each dog has its own engine-curated bg
// colour; the scene category adds at most ONE small motif on top.
function isLightBg(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  // Relative luminance, sRGB approximation.
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

// Pick a high-contrast inkColor (used for the motif outline) and a
// high-contrast accent (used for the mythic palette tag).
function motifInk(bgColor) {
  return isLightBg(bgColor) ? '#1a0e22' : '#fff7e2';
}

// ─── royal_chamber ──────────────────────────────────────────────
// Gold Don, Capo, Double Fortune, Diamond Visor, Triple-Eight.
// The dog already wears a crown — we don't double up. Single
// contrasting gem in the upper corner is the entire scene motif.
// All mythic scenes share the same minimal shape: the dog's own
// engine-curated wall colour fills the canvas (handled by the front
// renderer), and the scene contributes at most ONE simple motif at
// native-pixel resolution. Operator: "remove them if they look like
// garbage and make them simpler — we'll improve them later." So the
// junkier motifs (terminal windows, UFO rings, neon arches, trophy
// silhouettes, music notes, shooting-star tails) are gone for now;
// what survives is the simplest primitives — moons, sun discs, the
// occasional star, a heart pip, the gold/purple palette tag.

// Reusable simple-moon helper: a full disc minus an offset disc,
// drawn in native pixel units. Good for crescent and full moons.
function moon(cx, cy, r, color, bgColor, offsetX = 0, offsetY = 0) {
  const out = [...pixelDisk(cx, cy, r, color)];
  if (offsetX || offsetY) {
    out.push(...pixelDisk(cx + offsetX, cy + offsetY, r - NATIVE, bgColor));
  }
  return out;
}

// ─── royal_chamber ──────────────────────────────────────────────
// Gold Don, Capo, Double Fortune, Diamond Visor, Triple-Eight. The
// dog already wears a crown — the scene is intentionally bare.
function renderRoyalChamber() {
  return mythicPaletteTag();
}

// ─── cosmic_void ────────────────────────────────────────────────
// The Magus, Hitchhiker, Physicist, Cosmonaut. One small moon disc
// upper-right + a few stars.
function renderCosmicVoid(scene, seedBase) {
  const rng = lcg(seedBase ^ 0xc051);
  const ink = motifInk(scene.bgColor);
  return [
    ...pixelDisk(60, 14, 5, ink),
    ...scatter(rng, 3, [ink], { yMax: 20 }),
    ...mythicPaletteTag()
  ];
}

// ─── casino_table ───────────────────────────────────────────────
// Lucky Seven, Card Counter. One small red heart pip.
function renderCasinoTable() {
  const hx = DOG_CENTER_X;
  return [
    nrect(hx - 4, 10, 4, 4, '#c11e2a'),
    nrect(hx + 2, 10, 4, 4, '#c11e2a'),
    nrect(hx - 4, 14, 10, 2, '#c11e2a'),
    nrect(hx - 2, 16, 6, 2, '#c11e2a'),
    nrect(hx, 18, 2, 2, '#c11e2a'),
    ...mythicPaletteTag()
  ];
}

// ─── hacker_den ─────────────────────────────────────────────────
// Programmer, Leet Zombie, The Closer, etc. Just the palette tag —
// the terminal-window motif looked clunky at native pixel size.
function renderHackerDen() {
  return mythicPaletteTag();
}

// ─── holiday_moon ───────────────────────────────────────────────
// Valentine, Christmas, Halloween, New Year. ONE crescent moon.
function renderHolidayMoon(scene) {
  return [
    ...moon(60, 14, 6, '#fff7e2', scene.bgColor, 2, -2),
    ...mythicPaletteTag()
  ];
}

// ─── bamboo_night ───────────────────────────────────────────────
// 47 Ronin. ONE moon, upper-left.
function renderBambooNight() {
  return [
    ...pixelDisk(18, 14, 5, '#e6efce'),
    ...mythicPaletteTag()
  ];
}

// ─── stage_night ────────────────────────────────────────────────
// 27 Club, Werewolves of London, Summer of Love. Just the palette
// tag — the music-note motif looked clunky at native pixel size.
function renderStageNight() {
  return mythicPaletteTag();
}

// ─── apocalypse_green ───────────────────────────────────────────
// Alien Kush, The Beast. Just the palette tag — the UFO motif
// looked clunky at native pixel size.
function renderApocalypseGreen() {
  return mythicPaletteTag();
}

// ─── trophy_wall ────────────────────────────────────────────────
// The Goat. Just the palette tag — the trophy motif looked clunky
// at native pixel size.
function renderTrophyWall() {
  return mythicPaletteTag();
}

// ─── divine_light ───────────────────────────────────────────────
// Holy Ghost. ONE sun arc peeking from the top edge.
function renderDivineLight() {
  return [
    ...pixelDisk(DOG_CENTER_X, 0, 12, '#fff7c8'),
    ...pixelDisk(DOG_CENTER_X, 0, 8,  MYTHIC_ACCENT),
    ...mythicPaletteTag()
  ];
}

// ─── underground_club ───────────────────────────────────────────
// Made Spaniel, Detective, First Responder, Conqueror. Just the
// palette tag — the neon-arch motif looked clunky at native pixel
// size.
function renderUndergroundClub() {
  return mythicPaletteTag();
}

// ─── wishing_sky ────────────────────────────────────────────────
// Wishing Star, Bad Moon Howler, Ascended, Zen Spaniel. ONE star
// cross upper-left.
function renderWishingSky() {
  // Plus-shaped star at native-pixel resolution.
  const sx = 14, sy = 12;
  return [
    np(sx, sy - 2, MYTHIC_GOLD),
    np(sx - 2, sy, MYTHIC_GOLD),
    np(sx, sy, MYTHIC_ACCENT),
    np(sx + 2, sy, MYTHIC_GOLD),
    np(sx, sy + 2, MYTHIC_GOLD),
    ...mythicPaletteTag()
  ];
}

// ─── genesis_dawn ───────────────────────────────────────────────
// The First. ONE rising sun disc above the horizon.
function renderGenesisDawn() {
  return [
    ...pixelDisk(DOG_CENTER_X, 18, 8, '#fff5d4'),
    ...pixelDisk(DOG_CENTER_X, 18, 4, MYTHIC_ACCENT),
    ...mythicPaletteTag()
  ];
}

// ─── friday_horror ──────────────────────────────────────────────
// Triskaidekaphobia. ONE crescent moon, upper-right.
function renderFridayHorror(scene) {
  return [
    ...moon(60, 16, 7, '#cad2dc', scene.bgColor, 2, -2),
    ...mythicPaletteTag()
  ];
}

// ─── arcade_glow ────────────────────────────────────────────────
// Pi Day, vapor mythics. ONE pink sunset disc above the dog.
function renderArcadeGlow() {
  return [
    ...pixelDisk(DOG_CENTER_X, 18, 8, '#ff7ce0'),
    ...pixelDisk(DOG_CENTER_X, 18, 4, MYTHIC_ACCENT),
    ...mythicPaletteTag()
  ];
}
