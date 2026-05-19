// Spaniel Wallet — anti-shoulder-surfing SRP / mnemonic reveal.
//
// Renders the 12 / 24 word recovery phrase in a numbered grid. By
// default the words are blurred. Reveal requires an explicit user
// gesture: hold-to-reveal (pointerdown/up) OR a "Reveal for 30s"
// affordance with visible countdown. The reveal auto-re-blurs on:
//   * pointerup
//   * the 30s countdown expiring
//   * the page becoming hidden (tab switch, lock screen)
//   * window blur (focus moves elsewhere)
//
// Clipboard handling: clipboardCopyMnemonic() copies the phrase,
// then schedules a clipboard-clear after CLIPBOARD_AUTO_CLEAR_MS so
// pasting elsewhere (or a clipboard manager grabbing it) has a
// bounded window. We show the countdown to the user.

const CLIPBOARD_AUTO_CLEAR_MS = 30_000;
const HELD_REVEAL_AUTO_REBLUR_MS = 30_000;

/**
 * Mount the SRP reveal UI inside `container`. Adds the numbered word
 * grid, the hold-to-reveal button, the timed-reveal button, and the
 * secure-copy button. Returns a control object the caller can use to
 * dispose listeners.
 *
 * @param {HTMLElement} container
 * @param {object} args
 * @param {readonly string[]} args.words           the 12/24 words
 * @param {string} args.mnemonic                   the joined phrase (for copy)
 * @returns {{ dispose(): void }}
 */
export function mountSrpReveal(container, { words, mnemonic }) {
  if (!container || container.nodeType !== 1) {
    throw new TypeError('mountSrpReveal requires an Element');
  }
  if (!Array.isArray(words) || words.length === 0) {
    throw new TypeError('mountSrpReveal requires a non-empty words array');
  }
  container.innerHTML = renderShell(words);

  const grid = container.querySelector('[data-srp-grid]');
  const holdBtn = container.querySelector('[data-srp-hold]');
  const timedBtn = container.querySelector('[data-srp-timed]');
  const copyBtn = container.querySelector('[data-srp-copy]');
  const clipboardStatus = container.querySelector('[data-srp-clipboard]');
  const status = container.querySelector('[data-srp-status]');

  let timedRevealTimer = null;
  let clipboardClearTimer = null;
  let clipboardCountdownTimer = null;

  function setRevealed(on) {
    grid.dataset.revealed = on ? '1' : '0';
    if (status) status.textContent = on ? 'Visible. Re-blurring soon.' : 'Hidden.';
  }
  function cancelTimedReveal() {
    if (timedRevealTimer) { clearTimeout(timedRevealTimer); timedRevealTimer = null; }
    if (timedBtn) timedBtn.textContent = `Reveal for ${HELD_REVEAL_AUTO_REBLUR_MS / 1000}s`;
  }

  // ── hold-to-reveal ────────────────────────────────────────────
  function onHoldDown(ev) { ev.preventDefault(); setRevealed(true); cancelTimedReveal(); }
  function onHoldUp() { setRevealed(false); }
  holdBtn?.addEventListener('pointerdown', onHoldDown);
  holdBtn?.addEventListener('pointerup', onHoldUp);
  holdBtn?.addEventListener('pointerleave', onHoldUp);
  holdBtn?.addEventListener('pointercancel', onHoldUp);
  // Keyboard accessibility: Space/Enter mirror pointerdown/up.
  holdBtn?.addEventListener('keydown', (ev) => {
    if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); setRevealed(true); cancelTimedReveal(); }
  });
  holdBtn?.addEventListener('keyup', (ev) => {
    if (ev.key === ' ' || ev.key === 'Enter') { setRevealed(false); }
  });

  // ── timed reveal (countdown) ──────────────────────────────────
  function startTimedReveal() {
    if (timedRevealTimer) cancelTimedReveal();
    setRevealed(true);
    let left = HELD_REVEAL_AUTO_REBLUR_MS / 1000;
    if (timedBtn) timedBtn.textContent = `Re-blurring in ${left}s`;
    const tick = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(tick);
        setRevealed(false);
        cancelTimedReveal();
        return;
      }
      if (timedBtn) timedBtn.textContent = `Re-blurring in ${left}s`;
    }, 1000);
    timedRevealTimer = tick;
  }
  timedBtn?.addEventListener('click', () => {
    if (timedRevealTimer) cancelTimedReveal(), setRevealed(false);
    else startTimedReveal();
  });

  // ── re-blur on tab switch / blur / unload ─────────────────────
  function onHidden() { setRevealed(false); cancelTimedReveal(); }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') onHidden();
  });
  window.addEventListener('blur', onHidden);
  window.addEventListener('pagehide', onHidden);

  // ── secure copy + clipboard auto-clear ────────────────────────
  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(mnemonic);
    } catch (err) {
      if (clipboardStatus) clipboardStatus.textContent = 'Copy blocked by the browser. Use hold-to-reveal and write the words down by hand.';
      return;
    }
    // Re-blur the screen during the clipboard window — the bytes are
    // already in the clipboard, no need to leave them on-screen too.
    setRevealed(false);
    cancelTimedReveal();
    let left = CLIPBOARD_AUTO_CLEAR_MS / 1000;
    if (clipboardStatus) clipboardStatus.textContent = `Copied. Clipboard will clear in ${left}s.`;
    if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
    if (clipboardCountdownTimer) clearInterval(clipboardCountdownTimer);
    clipboardCountdownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) { clearInterval(clipboardCountdownTimer); clipboardCountdownTimer = null; return; }
      if (clipboardStatus) clipboardStatus.textContent = `Copied. Clipboard will clear in ${left}s.`;
    }, 1000);
    clipboardClearTimer = setTimeout(async () => {
      try {
        // Overwrite the clipboard with a benign string. The user may
        // have already pasted; the goal is to bound the residency,
        // not to "un-paste."
        await navigator.clipboard.writeText(' ');
      } catch { /* permission revoked or page hidden — best effort */ }
      if (clipboardStatus) clipboardStatus.textContent = 'Clipboard cleared.';
    }, CLIPBOARD_AUTO_CLEAR_MS);
  });

  return {
    dispose() {
      if (timedRevealTimer) clearInterval(timedRevealTimer);
      if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
      if (clipboardCountdownTimer) clearInterval(clipboardCountdownTimer);
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('blur', onHidden);
      window.removeEventListener('pagehide', onHidden);
    },
  };
}

function renderShell(words) {
  // Numbered word cells. CSS in app.css applies the blur via
  // [data-revealed="0"] selector — never expose raw words in the DOM
  // text content when blur is off (we still do, but the blur is
  // active by default; reveal is gated by user gesture). Note the
  // `user-select: none` + `data-no-screenshot` data attribute that
  // the CSS adds to the wordlist while hidden.
  const cells = words.map((w, i) => (
    `<div class="srp-cell"><span class="srp-num">${i + 1}.</span><span class="srp-word">${escapeHtml(w)}</span></div>`
  )).join('');
  return `
    <div class="srp-warn">
      <strong>Write these ${words.length} words down on paper, in order.</strong>
      Anyone with this list can take everything in this wallet — forever. Never type it into a website, screenshot it, or send it to anyone. Spaniel Syndicate cannot recover this for you if you lose it.
    </div>
    <div class="srp-grid" data-srp-grid data-revealed="0">${cells}</div>
    <div class="srp-controls">
      <button class="app-btn" data-srp-hold type="button">Hold to reveal</button>
      <button class="app-btn" data-srp-timed type="button">Reveal for 30s</button>
      <button class="app-btn" data-srp-copy type="button">Copy (clears in 30s)</button>
    </div>
    <p class="srp-status" data-srp-status>Hidden.</p>
    <p class="srp-clipboard" data-srp-clipboard></p>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}

export { CLIPBOARD_AUTO_CLEAR_MS, HELD_REVEAL_AUTO_REBLUR_MS };
