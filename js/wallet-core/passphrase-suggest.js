// Spaniel Wallet — random-passphrase generator.
//
// Uses the EFF Large Diceware wordlist (7,776 hand-curated English
// words). 5 random words = 5 × log2(7776) = ~64.6 bits of entropy —
// enough to resist offline GPU-cluster cracking for centuries.
//
// Random source is crypto.getRandomValues (WebCrypto) — never
// Math.random. Rejection-sampling avoids modulo bias.

import { EFF_LARGE, EFF_LARGE_COUNT } from './diceware-eff-large.js';

/**
 * Generate a random N-word passphrase from the EFF Large wordlist,
 * joined by `separator`. Uses WebCrypto for entropy.
 *
 * @param {number} [wordCount=5]
 * @param {string} [separator='-']
 * @returns {string}
 */
export function generatePassphrase(wordCount = 5, separator = '-') {
  if (!Number.isFinite(wordCount) || wordCount < 1 || wordCount > 16) {
    throw new RangeError('wordCount must be 1..16');
  }
  const out = [];
  for (let i = 0; i < wordCount; i++) {
    out.push(EFF_LARGE[randomIndex(EFF_LARGE_COUNT)]);
  }
  return out.join(separator);
}

// Rejection-sample a uint32 in [0, n). Avoids the modulo bias you'd
// get from `randUint32() % n` when n doesn't divide 2^32 evenly.
function randomIndex(n) {
  const maxAcceptable = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  // The loop almost always exits on the first iteration; the worst-
  // case rejection probability is < 50% for any n.
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < maxAcceptable) return buf[0] % n;
  }
}

export { EFF_LARGE_COUNT };
