// send-confirm — pre-submit confirmation prompt for SOL send.
//
// The /wallet page calls this BEFORE `sendRawTransaction` so the
// user sees recipient + amount + network + base/priority fees in a
// single dialog. A typo paste shouldn't be irreversible.
//
// Pure formatting is exported separately so it can be unit-tested
// without spinning up jsdom — the confirm() dialog itself is opaque.

const LAMPORTS_PER_SOL = 1_000_000_000n;

function formatSol(lamports, decimals = 9) {
  // BigInt-safe SOL display. Splits into integer + fractional parts
  // so we never need to round a JS number that is past safe-int
  // range. Default decimals=9 (lamport precision) trims trailing
  // zeros, so 1 SOL prints as "1" and 1 lamport as "0.000000001".
  const n = typeof lamports === 'bigint' ? lamports : BigInt(lamports);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / LAMPORTS_PER_SOL;
  const frac = abs % LAMPORTS_PER_SOL;
  if (decimals <= 0) {
    return (negative ? '-' : '') + whole.toString();
  }
  const fracStr = frac.toString().padStart(9, '0').slice(0, Math.min(9, decimals));
  const trimmed = fracStr.replace(/0+$/, '');
  if (!trimmed) return (negative ? '-' : '') + whole.toString();
  return (negative ? '-' : '') + whole.toString() + '.' + trimmed;
}

/**
 * Build the human-readable confirmation text for a SOL send.
 *
 * @param {object} args
 * @param {string} args.fromBase58
 * @param {string} args.toBase58
 * @param {bigint} args.lamports
 * @param {bigint} [args.baseFeeLamports]
 * @param {bigint} [args.priorityFeeLamports]
 * @param {string} [args.cluster]
 */
export function formatSendConfirmation({
  fromBase58,
  toBase58,
  lamports,
  baseFeeLamports = 5000n,
  priorityFeeLamports = 0n,
  cluster = '?',
}) {
  const totalFee = BigInt(baseFeeLamports) + BigInt(priorityFeeLamports);
  const lines = [
    'Send SOL?',
    '',
    `Network: ${cluster}`,
    `From:    ${fromBase58}`,
    `To:      ${toBase58}`,
    `Amount:  ${formatSol(lamports)} SOL (${lamports.toString()} lamports)`,
    `Fee:     ~${formatSol(totalFee)} SOL`,
    '',
    'Tap OK to sign and submit. This action is irreversible.',
  ];
  return lines.join('\n');
}

/**
 * Show the confirmation prompt (browser confirm dialog). Returns true
 * if the user confirmed, false otherwise. In Node tests, callers pass
 * an explicit `promptFn`.
 */
export function confirmSendSol(args, promptFn) {
  const prompt = promptFn
    || (typeof globalThis !== 'undefined' && globalThis.confirm
      ? globalThis.confirm.bind(globalThis)
      : null);
  const text = formatSendConfirmation(args);
  if (!prompt) {
    // No confirm UI available — refuse rather than send silently.
    return false;
  }
  return !!prompt(text);
}

export { formatSol };
