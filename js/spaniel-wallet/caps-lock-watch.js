// Small helper to display a "Caps Lock is on" warning while typing
// into a password input. Browsers expose CapsLock state on every
// keyboard event via getModifierState; we mount a sibling <p> and
// toggle it on keydown / keyup / focus / blur.

/**
 * Watch `input` for Caps Lock changes. Mounts a sibling warning
 * paragraph (className "caps-warn"). Returns a detach handle.
 *
 * @param {HTMLInputElement} input
 * @returns {() => void}
 */
export function watchCapsLock(input) {
  if (!input || input.dataset.capsWatched === '1') return () => {};
  input.dataset.capsWatched = '1';

  const warn = document.createElement('p');
  warn.className = 'caps-warn';
  warn.textContent = '⇪ Caps Lock is on.';
  warn.hidden = true;
  // Sit it right after the input (or its wrap if attachRevealToggle
  // already nested it inside a .app-input-wrap container).
  const anchor = input.closest('.app-input-wrap') || input;
  anchor.parentNode.insertBefore(warn, anchor.nextSibling);

  function refresh(ev) {
    try {
      const on = ev && typeof ev.getModifierState === 'function' && ev.getModifierState('CapsLock');
      warn.hidden = !on;
    } catch { /* old browser — ignore */ }
  }
  function clearOnBlur() { warn.hidden = true; }

  input.addEventListener('keydown', refresh);
  input.addEventListener('keyup', refresh);
  input.addEventListener('focus', refresh);
  input.addEventListener('blur', clearOnBlur);

  return () => {
    input.removeEventListener('keydown', refresh);
    input.removeEventListener('keyup', refresh);
    input.removeEventListener('focus', refresh);
    input.removeEventListener('blur', clearOnBlur);
    warn.remove();
    delete input.dataset.capsWatched;
  };
}
