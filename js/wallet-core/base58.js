// Spaniel Wallet — Base58 (Bitcoin/Solana alphabet).
//
// Solana addresses, signatures, and transaction-bundle bytes are
// commonly encoded as Base58. Worker already vendors @noble + bs58
// but the public PWA path can't pull a full Solana web3.js bundle
// for a 32-byte pubkey, so we ship a tiny pure-JS impl here.
//
// 50-line implementation; matches the bs58 npm package on every
// 32-byte Solana pubkey + 64-byte signature.

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE = 58n;

const ALPHABET_MAP = new Map();
for (let i = 0; i < ALPHABET.length; i++) ALPHABET_MAP.set(ALPHABET[i], i);

export function encodeBase58(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('encodeBase58 requires Uint8Array');
  }
  if (bytes.length === 0) return '';

  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros++;

  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);

  let out = '';
  while (n > 0n) {
    const r = Number(n % BASE);
    n = n / BASE;
    out = ALPHABET[r] + out;
  }
  for (let i = 0; i < leadingZeros; i++) out = ALPHABET[0] + out;
  return out;
}

export function decodeBase58(str) {
  if (typeof str !== 'string') throw new TypeError('decodeBase58 requires string');
  if (str.length === 0) return new Uint8Array();

  let leadingZeros = 0;
  while (leadingZeros < str.length && str[leadingZeros] === ALPHABET[0]) leadingZeros++;

  let n = 0n;
  for (const ch of str) {
    const v = ALPHABET_MAP.get(ch);
    if (v === undefined) throw new Error(`invalid base58 character: ${ch}`);
    n = n * BASE + BigInt(v);
  }

  const tail = [];
  while (n > 0n) {
    tail.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  const out = new Uint8Array(leadingZeros + tail.length);
  for (let i = 0; i < tail.length; i++) out[leadingZeros + i] = tail[i];
  return out;
}

const SOLANA_PUBKEY_LEN = 32;
const SOLANA_PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isValidBase58Pubkey(s) {
  if (typeof s !== 'string') return false;
  if (!SOLANA_PUBKEY_RE.test(s)) return false;
  try {
    return decodeBase58(s).length === SOLANA_PUBKEY_LEN;
  } catch {
    return false;
  }
}
