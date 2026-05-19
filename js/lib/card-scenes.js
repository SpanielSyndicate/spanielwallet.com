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

export const CARD_SCENES_VERSION = 'card-scenes-v2';

const DOG_CENTER_X = DOG_LOGICAL_X + Math.floor(DOG_LOGICAL_W / 2);  // 38

// Universal mythic accents (gold + purple). Every mythic scene
// closes with a small corner pop of these so the gold+purple palette
// invariant — asserted by tests/mythic-showcase-qa.test.mjs — holds
// regardless of category. We keep this to four discrete corner
// pixels, never a sparkle storm.
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

// Filled pixel disk — used for moons / suns / planets / UFOs.
function pixelDisk(cx, cy, radius, fill) {
  const out = [];
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    const dx2 = r2 - dy * dy;
    if (dx2 < 0) continue;
    const dx = Math.floor(Math.sqrt(dx2));
    out.push(rectPx(cx - dx, cy + dy, dx * 2 + 1, 1, fill));
  }
  return out;
}

// Sparse atmospheric scatter — strictly capped at MAX_PARTICLES.
function scatter(rng, count, palette, opts = {}) {
  const xMin = opts.xMin ?? 2;
  const xMax = opts.xMax ?? CARD_FRONT_LOGICAL_W - 2;
  const yMin = opts.yMin ?? 2;
  const yMax = opts.yMax ?? CARD_FRONT_LOGICAL_H - 2;
  const skipDog = opts.skipDog !== false;
  const target = Math.min(count, MAX_PARTICLES);
  const out = [];
  let safety = target * 6;
  let placed = 0;
  while (placed < target && safety-- > 0) {
    const x = xMin + pickInt(rng, Math.max(1, xMax - xMin));
    const y = yMin + pickInt(rng, Math.max(1, yMax - yMin));
    if (skipDog && inDog(x, y)) continue;
    out.push(px(x, y, palette[placed % palette.length]));
    placed++;
  }
  return out;
}

// Compact mythic signature — four discrete corner pixels carrying
// the gold + purple invariant. Strictly Bauhaus: no sparkle storm,
// no decorative ring.
function mythicSignature() {
  return [
    px(3, 3, MYTHIC_GOLD),
    px(CARD_FRONT_LOGICAL_W - 4, 3, MYTHIC_GOLD),
    px(3, CARD_FRONT_LOGICAL_H - 4, MYTHIC_PURPLE),
    px(CARD_FRONT_LOGICAL_W - 4, CARD_FRONT_LOGICAL_H - 4, MYTHIC_PURPLE)
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
export function renderScene(category, scene, seedBase, dogId) {
  switch (category) {
    case 'royal_chamber':    return renderRoyalChamber(seedBase);
    case 'cosmic_void':      return renderCosmicVoid(seedBase);
    case 'casino_table':     return renderCasinoTable(seedBase);
    case 'hacker_den':       return renderHackerDen(seedBase, dogId);
    case 'holiday_moon':     return renderHolidayMoon(seedBase);
    case 'bamboo_night':     return renderBambooNight(seedBase);
    case 'stage_night':      return renderStageNight(seedBase);
    case 'apocalypse_green': return renderApocalypseGreen(seedBase);
    case 'trophy_wall':      return renderTrophyWall(seedBase);
    case 'divine_light':     return renderDivineLight(seedBase);
    case 'underground_club': return renderUndergroundClub(seedBase);
    case 'wishing_sky':      return renderWishingSky(seedBase);
    case 'genesis_dawn':     return renderGenesisDawn(seedBase);
    case 'friday_horror':    return renderFridayHorror(seedBase);
    case 'arcade_glow':      return renderArcadeGlow(seedBase);
    default:                 return [];
  }
}

// Two-field layout helper — upper field + lower field with a horizon
// line at y. The horizon doubles as a quiet shelf the dog can stand on
// without painting a literal floor band.
function twoField(upper, lower, horizonY) {
  return [
    band(0, horizonY, upper),
    band(horizonY, CARD_FRONT_LOGICAL_H - horizonY, lower)
  ];
}

// ─── royal_chamber ──────────────────────────────────────────────
// Gold Don, Capo, Double Fortune, Diamond Visor, Triple-Eight.
// Deep burgundy field, simple throne block behind dog, subtle
// crown accent — no candles, no rug, no halo rings.
function renderRoyalChamber(seedBase) {
  const rng = lcg(seedBase ^ 0xc40a);
  const out = [];
  out.push(...twoField('#3d0b18', '#1a0408', 64));
  // Throne block centered behind the dog — one disciplined rectangle.
  const tx = DOG_CENTER_X - 12;
  out.push(rectPx(tx, 24, 24, 56, '#5e1424'));
  // Crown crest above the throne (three squared pips, never letters).
  out.push(rectPx(tx + 3,  20, 18, 2, MYTHIC_GOLD));
  out.push(rectPx(tx + 4,  16, 2, 4, MYTHIC_GOLD));
  out.push(rectPx(tx + 11, 14, 2, 6, MYTHIC_GOLD));
  out.push(rectPx(tx + 18, 16, 2, 4, MYTHIC_GOLD));
  // A few quiet gold flecks in the sky.
  out.push(...scatter(rng, 4, [MYTHIC_GOLD, '#fff0a8'], { yMax: 18 }));
  out.push(...mythicSignature());
  return out;
}

// ─── cosmic_void ────────────────────────────────────────────────
// The Magus, Hitchhiker, Physicist, Cosmonaut, etc.
// Deep navy void, one planet disk, a small handful of stars.
function renderCosmicVoid(seedBase) {
  const rng = lcg(seedBase ^ 0xc051);
  const out = [];
  out.push(...twoField('#04061c', '#020416', 78));
  // One planet disk in the upper-right sky.
  out.push(...pixelDisk(58, 16, 8, '#3a52d4'));
  out.push(...pixelDisk(58, 16, 6, '#5872e5'));
  out.push(px(56, 14, MYTHIC_ACCENT));
  // Six restrained stars.
  out.push(...scatter(rng, 6, ['#a5b5ff', MYTHIC_ACCENT], { yMax: 24 }));
  out.push(...mythicSignature());
  return out;
}

// ─── casino_table ───────────────────────────────────────────────
// Lucky Seven, Card Counter. Green felt field with a deep wood
// horizon, and ONE big suit pip (a heart) high in the sky.
function renderCasinoTable(seedBase) {
  const rng = lcg(seedBase ^ 0xca51);
  const out = [];
  out.push(...twoField('#0e5028', '#2b160a', 82));
  // One big heart pip high in the sky — the iconic motif.
  const hx = DOG_CENTER_X;
  out.push(rectPx(hx - 4, 12, 3, 4, '#c11e2a'));
  out.push(rectPx(hx + 2, 12, 3, 4, '#c11e2a'));
  out.push(rectPx(hx - 4, 16, 9, 2, '#c11e2a'));
  out.push(rectPx(hx - 3, 18, 7, 1, '#c11e2a'));
  out.push(rectPx(hx - 2, 19, 5, 1, '#c11e2a'));
  out.push(rectPx(hx - 1, 20, 3, 1, '#c11e2a'));
  out.push(px(hx, 21, '#c11e2a'));
  // Highlight on the heart.
  out.push(px(hx - 2, 14, '#ff7080'));
  // Sparse warm flecks.
  out.push(...scatter(rng, 4, [MYTHIC_GOLD, '#fff0a8'], { yMin: 28, yMax: 60 }));
  out.push(...mythicSignature());
  return out;
}

// ─── hacker_den ─────────────────────────────────────────────────
// Leet Zombie, The Elite, The Closer, Programmer, Phantom, Big
// Brother. The same disciplined idea — dark void + ONE simplified
// terminal panel high in the sky — but with explicit per-mythic
// palette divergence so the iconic ids feel distinct at a glance.
// No matrix rain, no scanlines, no flank windows.
function renderHackerDen(seedBase, dogId) {
  const out = [];
  const variant = hackerVariantForDogId(dogId);
  out.push(...twoField(variant.upper, variant.lower, 76));
  // One terminal panel centered above the dog (large, simplified).
  const px0 = DOG_CENTER_X - 14;
  out.push(rectPx(px0,      10, 28, 16, variant.panel));
  out.push(rectPx(px0,      10, 28, 2,  variant.bar));
  // Two square pips on the title bar so it reads as a window, never
  // as a label.
  out.push(rectPx(px0 + 2,  11, 2, 1, variant.panel));
  out.push(rectPx(px0 + 6,  11, 2, 1, variant.panel));
  // A single bright cursor pixel in the body.
  out.push(px(px0 + 22, 22, variant.cursor));
  out.push(...mythicSignature());
  return out;
}

// Per-mythic palette branches. Explicit so each iconic id feels
// distinct without relying on seed hash quirks.
function hackerVariantForDogId(dogId) {
  switch (Number(dogId)) {
    case 31337: // The Elite — boss-room
      return { upper: '#080010', lower: '#010005', panel: '#1a0830', bar: '#c87dff', cursor: '#fff7e2' };
    case 69420: // The Closer — luxe gold/green
      return { upper: '#0a0218', lower: '#03000a', panel: '#1a2a14', bar: MYTHIC_GOLD, cursor: '#a8ffa8' };
    case 1337:  // Leet Zombie — canonical neon green
      return { upper: '#000200', lower: '#020908', panel: '#013014', bar: '#3fd163', cursor: '#9bff9b' };
    case 1984:  // Big Brother — surveillance cyan/red
      return { upper: '#0a0204', lower: '#04020a', panel: '#1c0a0a', bar: '#ff5454', cursor: '#fff7e2' };
    case 404:   // Phantom — washed grey/blue
      return { upper: '#020812', lower: '#01040a', panel: '#0a1320', bar: '#5872e5', cursor: '#a5b5ff' };
    case 256:   // Programmer — clean cyan terminal
    default:
      return { upper: '#010812', lower: '#000308', panel: '#0a1c28', bar: '#5fd4ff', cursor: '#fff7e2' };
  }
}

// ─── holiday_moon ───────────────────────────────────────────────
// Valentine, Christmas, Halloween, New Year — pink/dark gradient,
// ONE moon disk, ONE pixel heart accent. No 4-heart cluster.
function renderHolidayMoon(seedBase) {
  const rng = lcg(seedBase ^ 0x8011d);
  const out = [];
  out.push(...twoField('#3a1230', '#0e040e', 78));
  // One crescent moon high-right.
  out.push(...pixelDisk(58, 14, 7, '#fff7e2'));
  out.push(...pixelDisk(60, 12, 5, '#3a1230'));
  // One big heart left of center.
  const hx = 18, hy = 18;
  out.push(rectPx(hx,     hy,     2, 2, '#f071a8'));
  out.push(rectPx(hx + 4, hy,     2, 2, '#f071a8'));
  out.push(rectPx(hx,     hy + 2, 6, 2, '#f071a8'));
  out.push(rectPx(hx + 1, hy + 4, 4, 1, '#f071a8'));
  out.push(px(hx + 2, hy + 5, '#f071a8'));
  // Sparse pink sky pixels.
  out.push(...scatter(rng, 4, ['#f071a8', MYTHIC_ACCENT], { yMax: 14 }));
  out.push(...mythicSignature());
  return out;
}

// ─── bamboo_night ───────────────────────────────────────────────
// 47 Ronin. Two muted forest greens, ONE moon, two slim bamboo
// stalks (one per flank). No falling leaves storm.
function renderBambooNight(seedBase) {
  const out = [];
  out.push(...twoField('#0a1a14', '#040a08', 80));
  // One pale moon high-left.
  out.push(...pixelDisk(20, 14, 5, '#e6efce'));
  // Two thin bamboo stalks, one per flank.
  out.push(rectPx(5,  18, 1, CARD_FRONT_LOGICAL_H - 24, '#1f5a3c'));
  out.push(rectPx(CARD_FRONT_LOGICAL_W - 6, 18, 1, CARD_FRONT_LOGICAL_H - 24, '#1f5a3c'));
  // Two simple joints per stalk.
  for (const cx of [5, CARD_FRONT_LOGICAL_W - 6]) {
    out.push(rectPx(cx - 1, 40, 3, 1, '#2e7a4f'));
    out.push(rectPx(cx - 1, 64, 3, 1, '#2e7a4f'));
  }
  out.push(...mythicSignature());
  return out;
}

// ─── stage_night ────────────────────────────────────────────────
// 27 Club, Werewolves of London, Summer of Love. ONE warm-amber
// spotlight cone from upper-center. No floor planks, no full
// curtain bands, no flank pleat columns.
function renderStageNight(seedBase) {
  const out = [];
  out.push(...twoField('#070504', '#000000', 80));
  // One triangular spotlight cone — widens from a tight tip near
  // y=0 down to the dog's torso. Strictly Bauhaus: just a triangle.
  for (let y = 0; y < 60; y++) {
    const half = Math.min(22, 2 + Math.floor(y / 3));
    const fill = y < 30 ? '#3a2818' : '#604020';
    out.push(rectPx(DOG_CENTER_X - half, y, half * 2, 1, fill));
  }
  // One thin warm rim where the cone lands.
  out.push(rectPx(DOG_CENTER_X - 18, 60, 36, 1, '#f5d488'));
  out.push(...mythicSignature());
  return out;
}

// ─── apocalypse_green ───────────────────────────────────────────
// Alien Kush, The Beast. Toxic-green field, ONE UFO disc with a
// thin tractor beam. No alien plants, no halo rings.
function renderApocalypseGreen(seedBase) {
  const rng = lcg(seedBase ^ 0xa90c);
  const out = [];
  out.push(...twoField('#02180c', '#011004', 76));
  // One UFO disc upper center.
  const ux = DOG_CENTER_X;
  out.push(rectPx(ux - 11,  8, 22, 2, '#1a8a3c'));
  out.push(rectPx(ux - 8,   6, 16, 2, '#3acf52'));
  out.push(rectPx(ux - 5,   5, 10, 1, '#a8ffa8'));
  out.push(rectPx(ux - 11, 10, 22, 1, '#0e5c20'));
  // A thin vertical tractor beam.
  for (let y = 12; y < 30; y += 2) {
    out.push(rectPx(ux - 1, y, 2, 1, '#3acf52'));
  }
  // Sparse green flecks.
  out.push(...scatter(rng, 4, ['#3acf52', '#a8ffa8'], { yMax: 22 }));
  out.push(...mythicSignature());
  return out;
}

// ─── trophy_wall ────────────────────────────────────────────────
// The Goat. Warm wood field with one simplified trophy silhouette
// (cup + stem + base, geometric). No hanging banners.
function renderTrophyWall(seedBase) {
  const out = [];
  out.push(...twoField('#4a2812', '#1a0c04', 84));
  // One trophy silhouette centered behind the dog.
  const tx = DOG_CENTER_X - 9;
  out.push(rectPx(tx, 16, 18, 8, '#3a1c0a'));
  // Cup rim highlight (gold).
  out.push(rectPx(tx, 16, 18, 1, MYTHIC_GOLD));
  // Stem.
  out.push(rectPx(tx + 7, 24, 4, 6, '#3a1c0a'));
  // Base.
  out.push(rectPx(tx + 2, 30, 14, 3, '#2a140a'));
  out.push(rectPx(tx + 2, 30, 14, 1, MYTHIC_GOLD));
  out.push(...mythicSignature());
  return out;
}

// ─── divine_light ───────────────────────────────────────────────
// Holy Ghost. Pale gold field with ONE sun arc — half a disc
// peeking down from the top edge. No diagonal light beams.
function renderDivineLight(seedBase) {
  const out = [];
  out.push(...twoField('#fff5d4', '#9b7a3e', 70));
  // One soft sun arc — disc centered just above the canvas top, so
  // only the bottom half reads as a glowing arc.
  out.push(...pixelDisk(DOG_CENTER_X, 0, 12, '#fff7c8'));
  out.push(...pixelDisk(DOG_CENTER_X, 0, 9,  MYTHIC_ACCENT));
  // A pale mid horizon to anchor the dog.
  out.push(rectPx(0, 60, CARD_FRONT_LOGICAL_W, 1, '#c9a868'));
  out.push(...mythicSignature());
  return out;
}

// ─── underground_club ───────────────────────────────────────────
// Made Spaniel, Detective, First Responder, Conqueror. Deep
// magenta-purple field with ONE neon arch overhead.
function renderUndergroundClub(seedBase) {
  const out = [];
  out.push(...twoField('#1e0830', '#040108', 80));
  // One neon arch — symmetric, tip-up at center.
  for (let dx = 0; dx <= 24; dx++) {
    const y = 12 + Math.floor(dx * dx / 36);
    if (y >= 28) continue;
    out.push(px(DOG_CENTER_X - dx, y, '#e040c9'));
    out.push(px(DOG_CENTER_X + dx, y, '#e040c9'));
  }
  out.push(...mythicSignature());
  return out;
}

// ─── wishing_sky ────────────────────────────────────────────────
// Wishing Star, Bad Moon Howler, Ascended, Zen Spaniel. Deep navy
// field with ONE big diagonal shooting-star trail.
function renderWishingSky(seedBase) {
  const out = [];
  out.push(...twoField('#0a1438', '#020410', 80));
  // One shooting-star diagonal trail upper-left → mid.
  for (let i = 0; i < 10; i++) {
    out.push(px(6 + i * 2, 4 + i, MYTHIC_ACCENT));
    out.push(px(6 + i * 2 + 1, 4 + i, '#a5b5ff'));
  }
  // The star head — a 3×3 plus.
  const sx = 6 + 10 * 2;
  const sy = 4 + 10;
  out.push(px(sx, sy, MYTHIC_ACCENT));
  out.push(px(sx - 1, sy, MYTHIC_GOLD));
  out.push(px(sx + 1, sy, MYTHIC_GOLD));
  out.push(px(sx, sy - 1, MYTHIC_GOLD));
  out.push(px(sx, sy + 1, MYTHIC_GOLD));
  out.push(...mythicSignature());
  return out;
}

// ─── genesis_dawn ───────────────────────────────────────────────
// The First. Three clean horizontal dawn bands and ONE rising sun
// disc on the horizon. No mountain silhouettes, no birds.
function renderGenesisDawn(seedBase) {
  const out = [];
  // Three disciplined bands — night, dawn, gold floor.
  out.push(...gradientBands([
    { y: 0,  h: 30, color: '#1a1a4a' },
    { y: 30, h: 22, color: '#a64048' },
    { y: 52, h: CARD_FRONT_LOGICAL_H - 52, color: '#f0b864' }
  ]));
  // One sun disc on the horizon at y=52.
  out.push(...pixelDisk(DOG_CENTER_X, 52, 12, '#fff5d4'));
  out.push(...pixelDisk(DOG_CENTER_X, 52, 9,  MYTHIC_ACCENT));
  out.push(...mythicSignature());
  return out;
}

// ─── friday_horror ──────────────────────────────────────────────
// Triskaidekaphobia. Black field with ONE jagged crescent moon.
// No dead-tree silhouettes, no blood drips.
function renderFridayHorror(seedBase) {
  const out = [];
  out.push(...twoField('#0a0c14', '#000000', 80));
  // One jagged moon: full disc minus an offset disc — high-right.
  out.push(...pixelDisk(58, 18, 8, '#cad2dc'));
  out.push(...pixelDisk(60, 14, 6, '#0a0c14'));
  out.push(...mythicSignature());
  return out;
}

// ─── arcade_glow ────────────────────────────────────────────────
// Pi Day, vapor mythics. Hot pink upper, deep purple lower,
// ONE sunset disc and ONE cyan horizon line. No grid spam.
function renderArcadeGlow(seedBase) {
  const out = [];
  out.push(...twoField('#28063c', '#06010c', 64));
  // One sunset disc behind the dog's head.
  out.push(...pixelDisk(DOG_CENTER_X, 32, 12, '#ff7ce0'));
  out.push(...pixelDisk(DOG_CENTER_X, 32, 9,  '#ffb0e8'));
  out.push(...pixelDisk(DOG_CENTER_X, 32, 6,  MYTHIC_ACCENT));
  // One cyan horizon line — disciplined, no receding grid.
  out.push(rectPx(0, 64, CARD_FRONT_LOGICAL_W, 1, '#5fd4ff'));
  out.push(...mythicSignature());
  return out;
}
