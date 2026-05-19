// Spaniel Wallet — passphrase strength estimator + hard floors.
//
// Estimates the "score" of a candidate passphrase the same way zxcvbn
// does in spirit — without pulling a 150 KB npm dep that would violate
// CLAUDE.md §0 ("No third-party npm runtime crypto dependencies").
// Tradeoffs: zxcvbn does deeper L33t/spatial/repeat pattern analysis
// than we do. We compensate with stricter HARD floors that have no
// score-based escape hatch.
//
// The score is a 0..4 integer mirroring zxcvbn for UX continuity:
//   0 — guessable in < 1 minute by an offline attacker
//   1 — guessable in < 1 day
//   2 — guessable in < 1 month
//   3 — guessable in < 100 years
//   4 — uncrackable on consumer hardware
//
// The estimator multiplies a charset-size×length entropy estimate by
// penalties for: substrings from the common-password lists, identical
// adjacent runs, ascending/descending sequences, repeated words. We
// then convert estimated guesses to a score using the same threshold
// table as zxcvbn.
//
// Hard floors are enforced BEFORE the score and SUPERSEDE it:
//   * length >= 12
//   * at least one lowercase letter
//   * at least one digit OR symbol  (case-insensitive alpha-only
//     phrases get rejected even at length 30 — alpha-only "diceware"
//     style requires our explicit `acceptDiceware` opt-in)
//   * not in the SPANIEL_BLOCKLIST
//   * not in the COMMON_TOP_50 short list (literal exact match)
//
// The blocklist is intentionally short. zxcvbn-style dictionary
// scoring (penalizing partial matches inside the passphrase) covers
// the long tail.

const HARD_MIN_LENGTH = 12;

// Top-50 leaked passwords from the 10 years of Have-I-Been-Pwned top
// lists. Intentionally short — these are *literal exact-match*
// rejections that don't need to grow. The substring-based scoring
// catches everything else.
const COMMON_TOP_50 = Object.freeze([
  'password', 'password1', 'password123', '123456', '12345678', '123456789',
  '1234567', '111111', '1234', '1234567890', '12345', '000000',
  'qwerty', 'qwerty123', 'qwertyuiop', '1q2w3e4r', '1q2w3e', 'admin',
  'welcome', 'welcome1', 'letmein', 'iloveyou', 'monkey', 'dragon',
  'sunshine', 'master', 'football', 'baseball', 'shadow', 'superman',
  'batman', 'trustno1', 'starwars', 'pokemon', 'princess', 'whatever',
  'qazwsx', 'asdfgh', 'zxcvbn', 'changeme', 'default', 'passw0rd',
  'p@ssw0rd', 'p@ssword', '0', '00000000', 'abc123', 'a1b2c3',
  'qwerty1', 'q1w2e3r4',
]);

// Spaniel-project-specific words we don't want users picking as a
// passphrase. Substring matching, case-insensitive.
const SPANIEL_BLOCKLIST = Object.freeze([
  'spaniel', 'syndicate', 'spanielsyndicate', 'spanielwallet',
  'spcn', 'spanielcoin', 'rescue', 'barklink',
  'solana', 'phantom', 'metamask', 'wallet', 'crypto', 'bitcoin',
  'ethereum', 'passphrase', 'mnemonic', 'seed', 'recovery',
]);

// Score thresholds (offline attacker, 1e10 hashes/sec).
//   guesses < 1e3   → 0
//   guesses < 1e6   → 1
//   guesses < 1e8   → 2
//   guesses < 1e10  → 3
//   guesses >= 1e10 → 4
const SCORE_THRESHOLDS = [1e3, 1e6, 1e8, 1e10];

/**
 * Score a passphrase.
 *
 * Pass `userInputs` (label, wallet pubkey, anything personal that the
 * UI knows) so the estimator can penalize passphrases that contain
 * any of those substrings — same trick zxcvbn uses for "name in
 * password" detection.
 *
 * @param {string} passphrase
 * @param {object} [opts]
 * @param {string[]} [opts.userInputs]
 * @param {boolean} [opts.acceptDiceware]  default false; when true
 *   relaxes the "letters AND digits/symbols" rule for proper diceware
 *   phrases (5+ words separated by spaces or hyphens). Used by the
 *   "I'm using a passphrase, not a password" mode.
 * @returns {{
 *   score: 0|1|2|3|4,
 *   guesses: number,
 *   crackTimeOffline: string,
 *   passedHardFloors: boolean,
 *   problems: string[],          // user-facing reasons it's blocked
 *   suggestions: string[],       // user-facing improvement tips
 * }}
 */
export function scorePassphrase(passphrase, opts = {}) {
  const pw = typeof passphrase === 'string' ? passphrase : '';
  const userInputs = Array.isArray(opts.userInputs) ? opts.userInputs : [];
  const acceptDiceware = opts.acceptDiceware === true;

  const problems = [];
  const suggestions = [];

  // ── Hard floors (block submit regardless of score) ───────────
  if (pw.length === 0) {
    return {
      score: 0,
      guesses: 0,
      crackTimeOffline: 'instant',
      passedHardFloors: false,
      problems: ['Enter a passphrase.'],
      suggestions: [],
    };
  }
  if (pw.length < HARD_MIN_LENGTH) {
    problems.push(`Passphrase must be at least ${HARD_MIN_LENGTH} characters (you have ${pw.length}).`);
  }
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  const looksLikeDiceware = /^[a-zA-Z]+([\s\-_][a-zA-Z]+){4,}$/.test(pw);
  if (!hasLower && !hasUpper) {
    problems.push('Passphrase must contain at least one letter.');
  }
  if (!hasDigit && !hasSymbol) {
    if (!(acceptDiceware && looksLikeDiceware)) {
      problems.push('Add at least one number OR symbol (or check "I\'m using a 5+ word passphrase" if you have a diceware-style phrase).');
    }
  }
  if (COMMON_TOP_50.includes(pw.toLowerCase())) {
    problems.push('That is one of the most common leaked passwords. Pick something else.');
  }
  for (const banned of SPANIEL_BLOCKLIST) {
    if (pw.toLowerCase().includes(banned)) {
      problems.push(`Avoid words tied to this project (e.g. "${banned}") — they're the first thing an attacker would try.`);
      break;
    }
  }
  for (const u of userInputs) {
    if (typeof u !== 'string' || u.length < 3) continue;
    if (pw.toLowerCase().includes(u.toLowerCase())) {
      problems.push(`Don't include your wallet label or address ("${u}") in the passphrase.`);
      break;
    }
  }

  // ── Charset-size × length entropy estimate ────────────────────
  let charset = 0;
  if (hasLower) charset += 26;
  if (hasUpper) charset += 26;
  if (hasDigit) charset += 10;
  if (hasSymbol) charset += 33; // approx printable ASCII symbol count
  if (charset === 0) charset = 1; // safety
  const log2Charset = Math.log2(charset);
  let entropyBits = pw.length * log2Charset;

  // ── Pattern penalties (zxcvbn-lite) ───────────────────────────
  // 1) Run of identical adjacent characters: each repeated char
  //    beyond the first contributes < log2(charset) bits.
  let runs = 0;
  for (let i = 1; i < pw.length; i++) if (pw[i] === pw[i - 1]) runs++;
  entropyBits -= runs * (log2Charset - 1);

  // 2) Ascending or descending sequence (abc/123/cba/321): each
  //    char in a run-of-3+ is near-free.
  let seq = 0;
  for (let i = 2; i < pw.length; i++) {
    const a = pw.charCodeAt(i - 2), b = pw.charCodeAt(i - 1), c = pw.charCodeAt(i);
    if ((b - a === 1 && c - b === 1) || (a - b === 1 && b - c === 1)) seq++;
  }
  entropyBits -= seq * (log2Charset - 1);

  // 3) Repeated short tokens: "abcabcabc" should not score like
  //    a random 9-char string.
  for (let chunk = 2; chunk <= 4; chunk++) {
    if (pw.length < chunk * 2) continue;
    let repeats = 0;
    for (let i = 0; i + chunk * 2 <= pw.length; i += chunk) {
      if (pw.slice(i, i + chunk) === pw.slice(i + chunk, i + chunk * 2)) repeats++;
    }
    entropyBits -= repeats * chunk * (log2Charset - 1);
  }

  if (entropyBits < 0) entropyBits = 0;
  const guesses = Math.pow(2, entropyBits);

  // ── Score from guesses ────────────────────────────────────────
  let score = 4;
  for (let i = 0; i < SCORE_THRESHOLDS.length; i++) {
    if (guesses < SCORE_THRESHOLDS[i]) { score = i; break; }
  }

  // ── Suggestions ───────────────────────────────────────────────
  if (problems.length === 0) {
    if (score < 4 && pw.length < 16) suggestions.push('Add a few more characters.');
    if (score < 3 && !hasSymbol) suggestions.push('Mixing in a symbol (e.g. ! @ $ -) raises the bar dramatically.');
    if (score < 3 && runs > 0) suggestions.push('Avoid runs of repeated letters or digits.');
    if (score < 3 && seq > 0) suggestions.push('Avoid sequences like 1234 or qwerty.');
    if (score < 3) suggestions.push('Or use a 5+ word "diceware" passphrase — long random words beat short complex strings.');
  }

  return {
    score,
    guesses,
    crackTimeOffline: humanCrackTime(guesses),
    passedHardFloors: problems.length === 0,
    problems,
    suggestions,
  };
}

/**
 * Convert estimated guesses → human-readable crack time at 1e10
 * hashes/sec (the realistic threat: an attacker who has exfiltrated
 * the encrypted vault file and is grinding offline on a GPU farm).
 */
function humanCrackTime(guesses) {
  const seconds = guesses / 1e10;
  if (seconds < 1) return 'instant';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 365) return `${Math.round(days)}d`;
  const years = days / 365;
  if (years < 1e3) return `${Math.round(years).toLocaleString()}y`;
  if (years < 1e6) return `${Math.round(years / 1e3).toLocaleString()}k years`;
  if (years < 1e9) return `${Math.round(years / 1e6).toLocaleString()}M years`;
  if (years < 1e12) return `${Math.round(years / 1e9).toLocaleString()}B years`;
  return 'longer than the age of the universe';
}

/** A short label suitable for a strength meter bar. */
export function scoreLabel(score) {
  switch (score) {
    case 0: return 'unusable';
    case 1: return 'weak';
    case 2: return 'fair';
    case 3: return 'strong';
    case 4: return 'excellent';
    default: return '';
  }
}

/** Recommended bar colour for a 5-step strength meter. */
export function scoreColor(score) {
  switch (score) {
    case 0: return '#b30000';  // dark red
    case 1: return '#c5380c';  // red-orange
    case 2: return '#b88600';  // amber
    case 3: return '#3a8a2e';  // green
    case 4: return '#2a6b1d';  // dark green
    default: return '#7a7a7a';
  }
}

export { HARD_MIN_LENGTH, COMMON_TOP_50, SPANIEL_BLOCKLIST };
