// Spaniel Showdown — For Keeps rules artifact + canonical hash.
//
// The For Keeps mode has a single, versioned rules document. The
// canonical UTF-8 bytes of `KEEPS_RULES_TEXT` are the input to
// `rulesHashHex()`. Both the frontend (display + match-create form)
// and the Worker (persisted on every match row) must agree on the
// hash; if they disagree, refuse the match.
//
// docs/SHOWDOWN_FOR_KEEPS_RULES.md mirrors this text byte-for-byte
// between the BEGIN/END markers — a test compares the file and the
// const so a doc edit cannot silently drift the hash.

import { sha256HexAscii } from './util-hash.js';

export const KEEPS_RULES_VERSION = 'showdown-for-keeps-rules-v1';

// ─── canonical rules text ───────────────────────────────────────
//
// IMPORTANT: This string is the SOLE input to the rules hash. Any
// change here is a versioned rules bump (KEEPS_RULES_VERSION must
// bump in the same commit). The same text appears verbatim in
// docs/SHOWDOWN_FOR_KEEPS_RULES.md between the BEGIN/END markers.

export const KEEPS_RULES_TEXT = [
  '# Spaniel Showdown — For Keeps Rules v1',
  '',
  'Version: showdown-for-keeps-rules-v1',
  '',
  '## Match sizes',
  'For Keeps matches use exactly 2, 4, 8, or 16 cards per player.',
  'No other sizes are accepted.',
  '',
  '## Lineup',
  'Each player submits a fixed-order lineup of N cards before the',
  'match starts. The lineup is locked into escrow and cannot be',
  'altered. Cards fight in submitted order. The active card is the',
  'first card in the lineup that has not been knocked out.',
  '',
  '## Visible stats',
  'Each card has five visible stats:',
  '- SPIRIT — hit points; the card stays in play until Spirit reaches 0.',
  '- BARK — command / pressure.',
  '- BITE — attack / force.',
  '- ZOOM — speed / initiative.',
  '- CHARM — tiebreaker and ability power.',
  'Plus one ability line.',
  '',
  '## Round flow',
  'Each round, both players secretly commit one action: Bark, Bite,',
  'or Zoom. After both commits are recorded, both players reveal.',
  '',
  'Action triangle:',
  '- Bark beats Zoom.',
  '- Zoom beats Bite.',
  '- Bite beats Bark.',
  '- Same action = no triangle advantage.',
  '',
  '## Round scoring',
  'For each side:',
  '  selectedStat       = activeCard.displayStats[action]',
  '  triangleAdvantage  = 10 if action beats opponent action, else 0',
  '  abilityModifier    = deterministic ability effect (0..+5)',
  '  total              = selectedStat + triangleAdvantage + abilityModifier',
  '',
  '## Tie resolution',
  'If totals are equal, the side with higher CHARM wins the round.',
  'If CHARM is also equal, both active cards take 5 Spirit damage',
  'and the round is recorded as a draw (no triangle damage applied).',
  '',
  '## Damage',
  'On a non-draw round:',
  '  baseDamage    = 10',
  '  marginDamage  = floor(max(0, winnerTotal - loserTotal) / 10)',
  '  damageDealt   = min(40, baseDamage + marginDamage + abilityDamageMod)',
  '  loser.activeCard.spirit = max(0, loser.activeCard.spirit - damageDealt)',
  '',
  '## Knockout',
  'When a card reaches 0 Spirit it is knocked out. The next card in',
  'the lineup enters at full Spirit on the next round.',
  '',
  '## Match end',
  'The match ends when one side has no active card remaining. The',
  'other side is the winner. There is no draw outcome for a',
  'completed match — only a winner or a timeout forfeit.',
  '',
  '## Prize rule — Winner\'s Pick',
  'The winner chooses exactly one card from the loser\'s locked',
  'lineup. That single card transfers to the winner. The winner\'s',
  'cards return to the winner. All other loser cards return to the',
  'loser. Sealed products are not eligible prizes.',
  '',
  '## Commit-reveal',
  'A round commit is sha256(rulesHash || matchId || roundIndex ||',
  'wallet || activeCardId || action || salt). The same hex string',
  'is posted to the Worker AND to the on-chain MatchState. A reveal',
  'must re-produce the commit byte-for-byte; a mismatch is rejected.',
  '',
  '## Timeouts',
  'Match deadlines are measured in Solana slots:',
  '- commit deadline: 150 slots after both lineups are locked, then',
  '  150 slots after each prior round resolves.',
  '- reveal deadline: 150 slots after the second commit is recorded.',
  'If a player fails to commit OR reveal before the deadline, the',
  'match resolves as a forfeit: the opposing player wins and may',
  'claim a prize card per the Winner\'s Pick rule.',
  '',
  '## Cancellation',
  'A host may cancel a match that has not yet been joined; all',
  'locked cards return to the host. After both players have',
  'locked, the only exit paths are completion or timeout-forfeit.',
  '',
  '## Fun Mode',
  'Fun Mode (Dog Park sandbox) is for practice. Fun Mode matches',
  'never transfer cards, do not require a wallet signature, and do',
  'not appear on the For Keeps leaderboard.',
  '',
  '## Irreversibility',
  'For Keeps transfers are final on confirmation. Do not play For',
  'Keeps unless you understand and accept these rules.'
].join('\n') + '\n';

// ─── canonical hash ─────────────────────────────────────────────

/**
 * Compute the canonical rules hash. Both frontend and Worker hash
 * the same bytes; if they disagree the match cannot be created.
 *
 * @returns {Promise<string>} 64 lowercase hex chars
 */
export async function rulesHashHex() {
  return sha256HexAscii(KEEPS_RULES_TEXT);
}

/**
 * Synchronous, deterministic variant used when the caller already
 * has the rules text in hand (e.g. server-side tests). Same result
 * as `await rulesHashHex()`.
 *
 * @param {string} text
 * @returns {Promise<string>}
 */
export async function hashRulesText(text) {
  return sha256HexAscii(text);
}

// ─── plain-language acknowledgement text ────────────────────────
//
// The exact string the UI MUST display before any For Keeps match
// can be created or joined. Worker stores `keeps_terms_accepted_at`
// alongside this version + the rulesHash on match create/join.

export const KEEPS_ACKNOWLEDGEMENT_VERSION = 'showdown-for-keeps-ack-v1';

export const KEEPS_ACKNOWLEDGEMENT_TEXT = [
  'You are locking real NFT cards into escrow.',
  'If you lose, the winner may claim one card from your locked lineup.',
  'If you win, you may claim one card from your opponent\'s locked lineup.',
  'Your unclaimed locked cards are returned after the match.',
  'The match uses deterministic public rules.',
  'Failing to commit or reveal before the slot deadline counts as a forfeit.',
  'Fun Mode exists for practice.',
  'Do not play For Keeps unless you understand and accept these rules.'
].join('\n');
