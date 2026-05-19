// Input validation helpers shared by the /rip page.
//
// Kept in a separate module from rip-page.js so the helpers can be
// unit-tested under Node without dragging in the page-level
// /js/lib/* browser-absolute imports.

// MAX_BATCH_PER_PURCHASE is defined in js/config.js. The constant is
// duplicated here as a literal so this module can be imported under
// Node (config.js does a top-level fetch). Keep in sync.
export const MAX_BATCH_PER_PURCHASE = 25;

/**
 * Clamp a user-supplied quantity to `[1, MAX_BATCH_PER_PURCHASE]`.
 * Non-numeric / negative / NaN inputs fall back to 1. The Worker
 * also rejects out-of-range quantities; this prevents pasted bogus
 * input from ever reaching the network round-trip.
 */
export function clampQuantity(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 1;
  if (n < 1) return 1;
  if (n > MAX_BATCH_PER_PURCHASE) return MAX_BATCH_PER_PURCHASE;
  return n;
}
