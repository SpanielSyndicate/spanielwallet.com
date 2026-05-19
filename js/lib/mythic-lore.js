// Spaniel Syndicate — public mythic anchor map.
//
// Mirrors the canonical anchor source in
// spanielsyndicate-ops/engine/mythic-lore.cjs (CommonJS). The 49 ids
// listed here are the *currently authored* mythic identities. They are
// already public via js/lib/elaborate-ids.js and the on-chain Series 1
// metadata schema (CLAUDE.md §2.16) attaches `Mythic` + `Anchor`
// attributes to every true mythic card — so the strings below are
// intended to be public.
//
// The Series 1 product specifies 69 true mythic identities. The 20
// additional identities still to author are NOT in this map; the
// canonical engine's QA audit reports any visualId in
// `ELABORATE_VISUAL_IDS` that is missing here as a known gap
// (`MYTHIC_LORE_MISSING`).

export const MYTHIC_LORE = Object.freeze({
  // ── Universal (38) ─────────────────────────────────────────────
  1:     { name: 'The First',             anchor: 'Genesis — the inaugural Spaniel of the Syndicate.' },
  3:     { name: 'The Magus',             anchor: 'Three is the magic number — wizard\'s hat, holy trinity, rule of three.' },
  7:     { name: 'Lucky Seven',           anchor: 'Slot-machine triple-seven jackpot — the universal Western luck digit.' },
  13:    { name: 'Triskaidekaphobia',     anchor: 'Friday the 13th — Western superstition\'s most-feared number.' },
  21:    { name: 'Card Counter',          anchor: 'Blackjack\'s perfect hand — the casino\'s most-banned number.' },
  23:    { name: 'The Goat',              anchor: 'Michael Jordan\'s jersey — the GOAT of the GOATs.' },
  27:    { name: 'The 27 Club',           anchor: 'Cobain, Hendrix, Joplin, Morrison, Winehouse — all died at 27.' },
  42:    { name: 'Hitchhiker',            anchor: 'The answer to life, the universe, and everything (Douglas Adams).' },
  47:    { name: 'The 47 Ronin',          anchor: 'Edo-period samurai loyalty parable — 1701-03 events, national legend.' },
  69:    { name: 'Gold Don',              anchor: 'The eternal yin-yang, the original number — wealth and the elder don.' },
  88:    { name: 'Double Fortune',        anchor: 'Cantonese 八八 (baat-baat) — double prosperity, double luck.' },
  108:   { name: 'Zen Spaniel',           anchor: 'Mala prayer beads — 108 is the sacred number across Hindu/Buddhist/Jain traditions.' },
  137:   { name: 'The Physicist',         anchor: 'The fine-structure constant ≈ 1/137 — Feynman\'s "magic number".' },
  187:   { name: 'Made Spaniel',          anchor: 'California Penal Code §187 — street shorthand for premeditated murder.' },
  221:   { name: 'Detective',             anchor: '221B Baker Street — Sherlock Holmes\' London address.' },
  256:   { name: 'The Programmer',        anchor: '2⁸ — one byte, the foundation of every digital thing.' },
  404:   { name: 'Phantom',               anchor: 'HTTP 404 not found — the web\'s most famous error.' },
  420:   { name: 'Alien Kush',            anchor: 'April 20th — global cannabis culture\'s high holy day.' },
  666:   { name: 'The Beast',             anchor: 'Revelation 13:18 — the number of the beast.' },
  777:   { name: 'Holy Ghost',            anchor: 'Triple-seven divine perfection — the Christian sacred trinity of sevens.' },
  911:   { name: 'First Responder',       anchor: 'Emergency dispatch — firefighters, paramedics, the people who run toward the fire.' },
  1066:  { name: 'The Conqueror',         anchor: 'Battle of Hastings, October 14, 1066 — Norman invasion of England.' },
  1111:  { name: 'Wishing Star',          anchor: '11:11 make-a-wish moment — Western numerology\'s daily synchronicity.' },
  1138:  { name: 'THX',                   anchor: 'THX 1138 — George Lucas\'s 1971 dystopian debut, the codename of every Lucasfilm cameo.' },
  1313:  { name: 'Bad Moon Howler',       anchor: 'Doubled thirteen — CCR\'s "Bad Moon Rising" as lunar-horror.' },
  1337:  { name: 'Leet Zombie',           anchor: 'L33T speak — the founding cipher of internet hacker culture.' },
  1488:  { name: 'Lucky Valentine',       anchor: 'Sino-Western Valentine fusion — Feb 14 plus the Chinese double-fortune 88.' },
  1701:  { name: 'The Captain',           anchor: 'USS Enterprise NCC-1701 — Star Trek\'s first starship.' },
  1969:  { name: 'Summer of Love',        anchor: 'Woodstock and the counterculture peak — peace, tie-dye, Lennon.' },
  1979:  { name: 'Werewolves of London',  anchor: 'Warren Zevon\'s iconic howling single — released late 1978, peaked 1979.' },
  1984:  { name: 'Big Brother',           anchor: 'Orwell\'s surveillance dystopia — the ur-text of modern paranoia.' },
  2049:  { name: 'Replicant',             anchor: 'Blade Runner 2049 — "tears in rain", the synthetic-soul question.' },
  6969:  { name: 'The Capo',              anchor: 'Elder don energy — 69\'s grown-up sibling at the head of the table.' },
  8888:  { name: 'Diamond Visor',         anchor: 'Quadruple-fortune — the apex Chinese-luck number in the Spaniel cluster.' },
  9000:  { name: 'Over Nine Thousand',    anchor: 'Dragon Ball Z — Vegeta\'s scouter reading on Goku, the internet\'s loudest meme.' },
  31337: { name: 'The Elite',             anchor: 'ELEET — leet-speak self-designator of the hacker-scene aristocracy.' },
  42069: { name: 'The Ascended',          anchor: 'The fusion of 42 (the answer) and 69 (the eternal joke) — internet nirvana.' },
  69420: { name: 'The Closer',            anchor: 'Syndicate hard-cap — the final Spaniel, supply locked.' },

  // ── Calendar (11) ─────────────────────────────────────────────
  14:   { name: 'Valentine\'s Night',     anchor: 'Feb 14 after dark — sibling palette to #214, the moonlit Valentine.' },
  101:  { name: 'New Year',               anchor: 'Midnight on January 1st — the first day of the calendar.' },
  214:  { name: 'Valentine\'s Day',       anchor: 'February 14th — the universal Western love-day.' },
  314:  { name: 'Pi Day',                 anchor: 'March 14 — the irrational constant that paves every circle.' },
  412:  { name: 'Cosmonaut Day',          anchor: 'April 12, 1961 — Gagarin\'s first human orbit.' },
  520:  { name: 'Wǒ Ài Nǐ',               anchor: 'May 20 — 5/20 in Mandarin sounds like "I love you".' },
  720:  { name: 'Moon Landing',           anchor: 'July 20, 1969 — Apollo 11, Armstrong\'s first step.' },
  808:  { name: 'Triple-Eight',           anchor: 'August 8 — the Cantonese fortune triple, baat-baat-baat.' },
  1031: { name: 'Halloween',              anchor: 'October 31 — the night the veil thins.' },
  1212: { name: 'Double-12',              anchor: 'December 12 — singles-day variant, snow-day twin.' },
  1225: { name: 'Christmas',              anchor: 'December 25 — the universal Western winter holiday.' }
});

export function mythicLoreFor(dogId) {
  const n = Number(dogId);
  if (!Number.isInteger(n)) return null;
  return MYTHIC_LORE[n] || null;
}

export function hasMythicLore(dogId) {
  return mythicLoreFor(dogId) !== null;
}

export const MYTHIC_LORE_VERSION = 'mythic-lore-v1';
export const MYTHIC_LORE_COUNT = Object.keys(MYTHIC_LORE).length; // 49
