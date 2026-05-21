import { COMMON_WORDS_RANK, COMMON_WORDS_COUNT } from './common-words.js';
import { LEAKED_PASSWORDS_RANK, LEAKED_PASSWORDS, LEAKED_PASSWORDS_COUNT } from './common-passwords.js';

// Spaniel Wallet — passphrase strength estimator + hard floors.
//
// Estimates "guesses to crack" on an offline GPU farm at 1e10 H/s.
// We do not pull a 150 KB npm dep (CLAUDE.md §0); the algorithm
// follows zxcvbn in spirit but uses our own shipped corpora:
//
//   * COMMON_WORDS_RANK   — ~9.8k top English words (Google 10k clean)
//   * LEAKED_PASSWORDS    — top 10k breached passwords (SecLists)
//
// We scan for matches (raw, l33t-normalized, reversed) AND keyboard
// row/diagonal walks, take the longest match at each position, and
// give each match an entropy cost of log2(rank × 2) instead of the
// length × log2(charset) we'd give a random string. Uncovered
// characters keep the full charset entropy. This is what kills the
// embarrassing "whatever bro → 6000 years" estimate that pure
// length × charset math produces.
//
// Hard floors block submit regardless of score:
//   * length >= 12
//   * at least one lowercase OR uppercase letter
//   * at least one digit OR symbol  (alpha-only requires diceware-shape)
//   * not in COMMON_TOP_50 (exact match)
//   * not in LEAKED_PASSWORDS (exact match) ← new
//   * reversed not in LEAKED_PASSWORDS (exact match) ← new
//   * not in SPANIEL_BLOCKLIST (substring)
//
// scoreLabel + scoreColor are exported for the meter UI.

const HARD_MIN_LENGTH = 12;

// Top-50 leaked passwords kept as a literal exact-match list for
// the "Common Top 50" problem message wording. The full 10,000
// entry LEAKED_PASSWORDS set is consulted separately and produces
// a different message ("appears on the top-10k breached list").
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

const SPANIEL_BLOCKLIST = Object.freeze([
  'spaniel', 'syndicate', 'spanielsyndicate', 'spanielwallet',
  'spcn', 'spanielcoin', 'rescue', 'barklink',
  'solana', 'phantom', 'metamask', 'wallet', 'crypto', 'bitcoin',
  'ethereum', 'passphrase', 'mnemonic', 'seed', 'recovery',
]);

// Score thresholds calibrated to OFFLINE crack-time at 1e10 H/s:
//   < 1 minute        → 0 unusable
//   < 1 day           → 1 weak
//   < 1 year          → 2 fair
//   < 1000 years      → 3 strong
//   >= 1000 years     → 4 excellent
const SCORE_THRESHOLDS = [6e11, 8.64e14, 3.15e17, 3.15e20];

// ── L33t substitution table ─────────────────────────────────────
// One canonical de-l33t mapping per char. Ambiguous chars resolve
// to the MOST common substitution (e.g. '1' → 'i', not 'l') — we
// then also try a second pass with the alternate when relevant.
const LEET_MAP_PRIMARY = {
  '@': 'a', '4': 'a',
  '8': 'b',
  '(': 'c', '{': 'c', '[': 'c',
  '3': 'e',
  '6': 'g',
  '#': 'h',
  '1': 'i', '!': 'i', '|': 'i',
  '0': 'o',
  '$': 's', '5': 's',
  '7': 't', '+': 't',
  '2': 'z',
};
const LEET_MAP_SECONDARY = {
  '1': 'l',  // 1 → l (alternate)
  '|': 'l',  // pipe → l (alternate)
  '5': 'b',  // 5 → b (rare alt)
  '6': 'b',  // 6 → b (alternate)
};

function delettize(s, alt = false) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (alt && LEET_MAP_SECONDARY[c]) out += LEET_MAP_SECONDARY[c];
    else if (LEET_MAP_PRIMARY[c]) out += LEET_MAP_PRIMARY[c];
    else out += c.toLowerCase();
  }
  return out;
}

// ── Keyboard pattern set ─────────────────────────────────────────
const KEYBOARD_ROWS = [
  'qwertyuiop', 'asdfghjkl', 'zxcvbnm',
  '1234567890',
  // Diagonal walks (column drops, common shortcuts):
  '1qaz', '2wsx', '3edc', '4rfv', '5tgb', '6yhn', '7ujm', '8ik', '9ol', '0p',
  'qazwsxedcrfvtgbyhnujmik', // diagonal cascade
];
const KEYBOARD_PATTERNS = (() => {
  const s = new Set();
  for (const row of KEYBOARD_ROWS) {
    for (let i = 0; i < row.length; i++) {
      for (let len = 3; len <= row.length - i; len++) {
        const fwd = row.slice(i, i + len);
        s.add(fwd);
        s.add(fwd.split('').reverse().join(''));
      }
    }
  }
  return s;
})();
const KEYBOARD_PATTERN_COUNT = KEYBOARD_PATTERNS.size;

// ── Match lookup: try raw, l33t-primary, l33t-secondary, reversed ──
// Returns the best (lowest-rank) match found across all normalizations.
// The "rank" returned drives the entropy contribution.

function lookupMatch(sub) {
  // Raw English-words
  const lower = sub.toLowerCase();
  let bestRank = COMMON_WORDS_RANK.get(lower) || Infinity;
  let bestKind = bestRank < Infinity ? 'word' : null;

  const leakRank = LEAKED_PASSWORDS_RANK.get(lower);
  if (leakRank && leakRank < bestRank) {
    bestRank = leakRank;
    bestKind = 'leaked';
  }

  // L33t-normalized (primary mapping)
  const leet1 = delettize(lower, false);
  if (leet1 !== lower) {
    const r = COMMON_WORDS_RANK.get(leet1);
    if (r && r < bestRank) { bestRank = r; bestKind = 'leet-word'; }
    const rl = LEAKED_PASSWORDS_RANK.get(leet1);
    if (rl && rl < bestRank) { bestRank = rl; bestKind = 'leet-leaked'; }
  }

  // L33t-normalized (secondary mapping — e.g. 1→l)
  const leet2 = delettize(lower, true);
  if (leet2 !== lower && leet2 !== leet1) {
    const r = COMMON_WORDS_RANK.get(leet2);
    if (r && r < bestRank) { bestRank = r; bestKind = 'leet-word'; }
    const rl = LEAKED_PASSWORDS_RANK.get(leet2);
    if (rl && rl < bestRank) { bestRank = rl; bestKind = 'leet-leaked'; }
  }

  // Reversed
  const reversed = lower.split('').reverse().join('');
  if (reversed !== lower) {
    const r = COMMON_WORDS_RANK.get(reversed);
    if (r && r < bestRank) { bestRank = r; bestKind = 'reversed-word'; }
    const rl = LEAKED_PASSWORDS_RANK.get(reversed);
    if (rl && rl < bestRank) { bestRank = rl; bestKind = 'reversed-leaked'; }
  }

  // Keyboard pattern
  if (KEYBOARD_PATTERNS.has(lower)) {
    // Keyboard patterns are tiny entropy: there are only ~300 of them,
    // so each contributes ~log2(300) ≈ 8 bits regardless of length.
    if (KEYBOARD_PATTERN_COUNT < bestRank) {
      bestRank = KEYBOARD_PATTERN_COUNT;
      bestKind = 'keyboard';
    }
  }

  return bestRank < Infinity ? { rank: bestRank, kind: bestKind } : null;
}

/**
 * Score a password.
 *
 * @param {string} passphrase
 * @param {object} [opts]
 * @param {string[]} [opts.userInputs] — wallet label, address, etc.;
 *   any substring containment counts as a hard-floor problem.
 * @param {boolean} [opts.acceptDiceware] — relax the digit/symbol
 *   requirement for proper diceware-shape (5+ alpha-only words).
 * @returns {{
 *   score: 0|1|2|3|4,
 *   guesses: number,
 *   crackTimeOffline: string,
 *   passedHardFloors: boolean,
 *   problems: string[],
 *   suggestions: string[],
 *   matches: Array<{ start:number, len:number, rank:number, kind:string }>,
 * }}
 */
export function scorePassphrase(passphrase, opts = {}) {
  const pw = typeof passphrase === 'string' ? passphrase : '';
  const userInputs = Array.isArray(opts.userInputs) ? opts.userInputs : [];
  const acceptDiceware = opts.acceptDiceware === true;

  const problems = [];
  const suggestions = [];
  const matches = [];

  if (pw.length === 0) {
    return {
      score: 0,
      guesses: 0,
      crackTimeOffline: 'instant',
      passedHardFloors: false,
      problems: ['Enter a password.'],
      suggestions: [],
      matches: [],
    };
  }

  // ── Hard floors ────────────────────────────────────────────────
  if (pw.length < HARD_MIN_LENGTH) {
    problems.push(`Password must be at least ${HARD_MIN_LENGTH} characters (you have ${pw.length}).`);
  }
  const hasLower = /[a-z]/.test(pw);
  const hasUpper = /[A-Z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);
  const looksLikeDiceware = /^[a-zA-Z]+([\s\-_][a-zA-Z]+){4,}$/.test(pw);
  if (!hasLower && !hasUpper) {
    problems.push('Password must contain at least one letter.');
  }
  if (!hasDigit && !hasSymbol) {
    if (!(acceptDiceware && looksLikeDiceware)) {
      problems.push('Add a number or symbol — or turn it into a 5+ word phrase (e.g. "three-cats-eating-quiet-pizza") and the all-letter form is fine.');
    }
  }
  if (COMMON_TOP_50.includes(pw.toLowerCase())) {
    problems.push('That is one of the most common leaked passwords. Pick something else.');
  } else if (LEAKED_PASSWORDS.has(pw.toLowerCase())) {
    problems.push("That password is on the top-10,000 breached-passwords list — it'll be guessed in under a second.");
  } else if (LEAKED_PASSWORDS.has(pw.toLowerCase().split('').reverse().join(''))) {
    problems.push('Reversing a common password does not help — that reversed form is also on the breached list.');
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
      problems.push(`Don't include your wallet label or address ("${u}") in the password.`);
      break;
    }
  }

  // ── Charset for residual entropy ────────────────────────────────
  let charset = 0;
  if (hasLower) charset += 26;
  if (hasUpper) charset += 26;
  if (hasDigit) charset += 10;
  if (hasSymbol) charset += 33;
  if (charset === 0) charset = 1;
  const log2Charset = Math.log2(charset);

  // ── Dictionary / leaked / l33t / keyboard / reversed scan ───────
  // Greedy left-to-right longest-match: at each position, try the
  // longest possible substring first; if any normalization hits the
  // dictionary or leaked corpora, take it, mark those chars covered,
  // and advance past the match.
  const lowered = pw.toLowerCase();
  const covered = new Uint8Array(pw.length);
  for (let i = 0; i < lowered.length; i++) {
    let best = null;
    const maxLen = Math.min(lowered.length - i, 24);
    for (let len = maxLen; len >= 2; len--) {
      const sub = lowered.slice(i, i + len);
      const m = lookupMatch(sub);
      if (m) { best = { start: i, len, rank: m.rank, kind: m.kind, word: sub }; break; }
    }
    if (best) {
      for (let j = best.start; j < best.start + best.len; j++) covered[j] = 1;
      matches.push(best);
      i += best.len - 1;
    }
  }

  // ── Entropy from matches + residual ─────────────────────────────
  let entropyBits = 0;
  for (const m of matches) entropyBits += Math.log2(Math.max(m.rank, 1) * 2);
  for (let i = 0; i < pw.length; i++) if (!covered[i]) entropyBits += log2Charset;

  // ── Pattern penalties on the residual ──────────────────────────
  // Runs of identical adjacent chars: "aaaa" / "111" cheaper than random.
  let runs = 0;
  for (let i = 1; i < pw.length; i++) if (!covered[i] && pw[i] === pw[i - 1]) runs++;
  entropyBits -= runs * (log2Charset - 1);

  // Ascending / descending numeric or alpha sequences (abc / 123 / cba / 321).
  let seq = 0;
  for (let i = 2; i < pw.length; i++) {
    if (covered[i]) continue;
    const a = pw.charCodeAt(i - 2), b = pw.charCodeAt(i - 1), c = pw.charCodeAt(i);
    if ((b - a === 1 && c - b === 1) || (a - b === 1 && b - c === 1)) seq++;
  }
  entropyBits -= seq * (log2Charset - 1);

  // Repeating short tokens: "abcabcabc" cheaper than 9 random chars.
  for (let chunk = 2; chunk <= 4; chunk++) {
    if (pw.length < chunk * 2) continue;
    let repeats = 0;
    for (let i = 0; i + chunk * 2 <= pw.length; i += chunk) {
      if (pw.slice(i, i + chunk) === pw.slice(i + chunk, i + chunk * 2)) repeats++;
    }
    entropyBits -= repeats * chunk * (log2Charset - 1);
  }

  // 4-digit year patterns ("1990", "2023") — only ~150 plausible
  // years, so a 4-digit run that parses as a recent year contributes
  // ~7 bits instead of 4 × log2(10) = 13.3.
  const yearPenalty = countYearTokens(pw) * (4 * log2Charset - 7);
  entropyBits -= yearPenalty;

  if (entropyBits < 0) entropyBits = 0;
  const guesses = Math.pow(2, entropyBits);

  // ── Score from guesses ─────────────────────────────────────────
  let score = 4;
  for (let i = 0; i < SCORE_THRESHOLDS.length; i++) {
    if (guesses < SCORE_THRESHOLDS[i]) { score = i; break; }
  }

  // ── Annotated suggestions ──────────────────────────────────────
  if (problems.length === 0) {
    annotateSuggestions(matches, score, suggestions, { hasSymbol, hasDigit, pwLen: pw.length, runs, seq });
  }

  return {
    score,
    guesses,
    crackTimeOffline: humanCrackTime(guesses),
    passedHardFloors: problems.length === 0,
    problems,
    suggestions,
    matches,
  };
}

function countYearTokens(pw) {
  // Count 4-digit substrings that look like years 1900..2099.
  let n = 0;
  const re = /\b(19\d\d|20\d\d)\b/g;
  // \b doesn't fully work for embedded digits; do it manually:
  for (let i = 0; i + 4 <= pw.length; i++) {
    const sub = pw.slice(i, i + 4);
    if (!/^\d{4}$/.test(sub)) continue;
    const year = parseInt(sub, 10);
    if (year >= 1900 && year <= 2099) n++;
  }
  void re; // unused but kept for documentation of intent
  return n;
}

function annotateSuggestions(matches, score, suggestions, ctx) {
  // Build a human-readable "why this is weak" hint, capped at 1
  // suggestion (the most actionable). Match order preserves left-
  // to-right scan; the lowest-rank match is the heaviest-weighted
  // attack vector.
  const sorted = [...matches].sort((a, b) => a.rank - b.rank);
  const top = sorted[0];
  if (score < 3 && top) {
    if (top.kind === 'leaked' || top.kind === 'leet-leaked') {
      suggestions.push(`Contains "${top.word}" which is on the top-10k breached list. Pick something not derived from a common password.`);
    } else if (top.kind === 'reversed-leaked' || top.kind === 'reversed-word') {
      suggestions.push(`Spelling "${top.word}" backwards doesn't add real entropy. Use unrelated words.`);
    } else if (top.kind === 'leet-word') {
      suggestions.push(`Letter swaps like @ for a, 0 for o, 3 for e don't fool a cracker — "${top.word}" still scans as a dictionary word.`);
    } else if (top.kind === 'keyboard') {
      suggestions.push(`"${top.word}" is a keyboard walk (qwerty / asdf / 12345) — top-100 guess for every cracker.`);
    } else if (top.kind === 'word') {
      suggestions.push(`Common word "${top.word}" — try mixing in less common words or a sentence.`);
    }
    return;
  }

  if (score < 4 && ctx.pwLen < 16) suggestions.push('Add a few more characters.');
  if (score < 3 && !ctx.hasSymbol) suggestions.push('Mixing in a symbol (e.g. ! @ $ -) raises the bar.');
  if (score < 3 && ctx.runs > 0) suggestions.push('Avoid runs of repeated letters or digits.');
  if (score < 3 && ctx.seq > 0) suggestions.push('Avoid sequences like 1234 or qwerty.');
  if (score < 3) suggestions.push('Or try a 5+ word memorable phrase — long phrases beat short complex strings.');
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
    case 0: return '#b30000';
    case 1: return '#c5380c';
    case 2: return '#b88600';
    case 3: return '#3a8a2e';
    case 4: return '#2a6b1d';
    default: return '#7a7a7a';
  }
}

export { HARD_MIN_LENGTH, COMMON_TOP_50, SPANIEL_BLOCKLIST };
