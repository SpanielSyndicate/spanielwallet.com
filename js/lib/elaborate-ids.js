// Single source of truth for the 49 elaborate visual ids.
//
// Frontend consumers (gallery, utils, visuals, bootstrap) and tests
// all import from here. Previously this list was duplicated across
// runtime-config.json + drops/drop.json + js/bootstrap.js +
// js/gallery.js + js/utils.js + js/visuals.js — six copies, easy
// drift target. Now imported in one place.

export const ELABORATE_VISUAL_IDS = Object.freeze([
  1, 3, 7, 13, 14, 21, 23, 27, 42, 47, 69, 88, 101, 108, 137, 187,
  214, 221, 256, 314, 404, 412, 420, 520, 666, 720, 777, 808, 911,
  1031, 1066, 1111, 1138, 1212, 1225, 1313, 1337, 1488, 1701, 1969,
  1979, 1984, 2049, 6969, 8888, 9000, 31337, 42069, 69420
]);

const _set = new Set(ELABORATE_VISUAL_IDS);

export function isElaborateVisualId(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return false;
  return _set.has(n);
}

export const ELABORATE_COUNT = ELABORATE_VISUAL_IDS.length;
