// Spaniel Wallet — idle-lock + seed zeroization helpers.
//
// Background: the unlocked-vault state object holds a 32-byte `seed`
// Uint8Array (and the 64-byte ed25519 secretKey derived from it).
// Both are live in V8 heap memory for as long as the user keeps the
// PWA unlocked. JavaScript cannot guarantee zeroization of GC-managed
// memory — the language has no `memset` for non-typed arrays, and any
// short-lived String created from the seed (Hex/Base58) lives in the
// interned string table forever. We do what we CAN:
//
//   * `lockUnlocked(unlocked)` fills every `seed` / `secretKey` buffer
//     in the unlocked-state object with zeros, then drops the
//     reference. After this call the vault is "locked" and the
//     PWA shell repaints the lock screen.
//   * `startIdleAutoLock({ getUnlocked, lock, idleMs })` starts an
//     idle-timeout watcher. Any pointer/keyboard/visibility activity
//     resets the timer; once idle exceeds `idleMs` the watcher calls
//     `lock()`. Visibility-hidden + a configurable grace also triggers
//     an immediate lock so a closed laptop doesn't keep the wallet
//     warm.
//
// Limits:
//   * GC heap copies of the seed (e.g. inside Uint8Array slice paths
//     under @noble) cannot be wiped. The vault encryption is the only
//     defense-in-depth against a process-snapshot attacker.
//   * Hex strings produced by exportActiveSecret cannot be zeroized;
//     this module does NOT try.

const DEFAULT_IDLE_MS = 5 * 60 * 1000;        // 5 min
const DEFAULT_HIDDEN_GRACE_MS = 30 * 1000;    // 30 s after hide

/**
 * Zero-fill every Uint8Array we control inside the unlocked-vault
 * descriptor, then forget the references. Always safe to call;
 * idempotent.
 */
export function lockUnlocked(unlocked) {
  if (!unlocked || typeof unlocked !== 'object') return;
  if (Array.isArray(unlocked.accounts)) {
    for (const a of unlocked.accounts) {
      if (a && a.seed instanceof Uint8Array) a.seed.fill(0);
      if (a && a.secretKey instanceof Uint8Array) a.secretKey.fill(0);
      if (a) {
        a.seed = null;
        a.secretKey = null;
      }
    }
  }
  if (unlocked.passphraseKey && typeof unlocked.passphraseKey === 'object') {
    // Non-extractable WebCrypto CryptoKey is opaque; null it out for
    // sanity but do not try to dig into private fields.
    unlocked.passphraseKey = null;
  }
  unlocked.activePubkey = null;
  unlocked.locked = true;
}

/**
 * Start the idle-lock watcher. Returns a `dispose()` function that
 * detaches every listener and clears the timer.
 *
 * @param {object} opts
 * @param {() => any} opts.getUnlocked   pull the current unlocked state
 * @param {() => void} opts.lock         locker callback (PWA shell)
 * @param {number} [opts.idleMs]         idle threshold, default 5 min
 * @param {number} [opts.hiddenGraceMs]  grace after visibilitychange
 *                                       to hidden, default 30 s
 * @param {Document} [opts.doc]          test override
 * @param {Window} [opts.win]            test override
 */
export function startIdleAutoLock({
  getUnlocked,
  lock,
  idleMs = DEFAULT_IDLE_MS,
  hiddenGraceMs = DEFAULT_HIDDEN_GRACE_MS,
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null,
} = {}) {
  if (typeof getUnlocked !== 'function' || typeof lock !== 'function') {
    throw new TypeError('startIdleAutoLock requires { getUnlocked, lock }');
  }
  let idleTimer = null;
  let hiddenTimer = null;
  let disposed = false;

  function clearAllTimers() {
    if (idleTimer) clearTimeout(idleTimer);
    if (hiddenTimer) clearTimeout(hiddenTimer);
    idleTimer = null;
    hiddenTimer = null;
  }

  function trigger() {
    clearAllTimers();
    if (disposed) return;
    if (!getUnlocked()) return;
    lock();
  }

  function resetIdle() {
    if (disposed) return;
    if (!getUnlocked()) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(trigger, idleMs);
  }

  function onVisibility() {
    if (disposed) return;
    if (!doc) return;
    if (doc.visibilityState === 'hidden') {
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = setTimeout(trigger, hiddenGraceMs);
    } else if (hiddenTimer) {
      clearTimeout(hiddenTimer);
      hiddenTimer = null;
      resetIdle();
    }
  }

  const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
  if (doc) {
    for (const ev of activityEvents) doc.addEventListener(ev, resetIdle, { passive: true });
    doc.addEventListener('visibilitychange', onVisibility);
  }
  if (win) {
    win.addEventListener('blur', () => {
      // Browser lost focus — start the hidden-grace timer so a closed
      // laptop / sleeping tab locks too.
      if (disposed) return;
      if (hiddenTimer) clearTimeout(hiddenTimer);
      hiddenTimer = setTimeout(trigger, hiddenGraceMs);
    });
    win.addEventListener('focus', () => {
      if (hiddenTimer) { clearTimeout(hiddenTimer); hiddenTimer = null; }
      resetIdle();
    });
  }
  resetIdle();

  return {
    reset: resetIdle,
    fire: trigger,
    dispose() {
      disposed = true;
      clearAllTimers();
      if (doc) {
        for (const ev of activityEvents) doc.removeEventListener(ev, resetIdle, { passive: true });
        doc.removeEventListener('visibilitychange', onVisibility);
      }
    },
  };
}

export { DEFAULT_IDLE_MS, DEFAULT_HIDDEN_GRACE_MS };
