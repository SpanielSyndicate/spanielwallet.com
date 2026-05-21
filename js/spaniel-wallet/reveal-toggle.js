// Show/hide toggle for password inputs.
//
// Wraps an existing <input type="password"> with a sibling button
// that flips type between "password" and "text". The input keeps
// autocomplete="new-password" (or "current-password") so browsers
// won't save the visible text to autofill history when toggled.
//
// Usage:
//   import { attachRevealToggle } from './reveal-toggle.js';
//   attachRevealToggle(document.getElementById('newPass'));
//
// The function is idempotent — calling it twice on the same input
// is a no-op.

const EYE_SHOW = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_HIDE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

/**
 * Wrap a password input with a show/hide toggle button.
 *
 * @param {HTMLInputElement} input
 * @returns {() => void} detach handle — removes the wrap and restores
 *   the original parent/order. Rarely needed; safe to ignore.
 */
export function attachRevealToggle(input) {
  if (!input || input.dataset.revealAttached === '1') return () => {};
  input.dataset.revealAttached = '1';

  const wrap = document.createElement('div');
  wrap.className = 'app-input-wrap';

  const parent = input.parentNode;
  parent.insertBefore(wrap, input);
  wrap.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'app-input-reveal';
  btn.setAttribute('aria-label', 'Show password');
  btn.setAttribute('aria-pressed', 'false');
  btn.innerHTML = EYE_SHOW;
  wrap.appendChild(btn);

  let revealed = false;
  btn.addEventListener('click', () => {
    revealed = !revealed;
    input.type = revealed ? 'text' : 'password';
    btn.setAttribute('aria-pressed', String(revealed));
    btn.setAttribute('aria-label', revealed ? 'Hide password' : 'Show password');
    btn.innerHTML = revealed ? EYE_HIDE : EYE_SHOW;
  });

  return () => {
    parent.insertBefore(input, wrap);
    wrap.remove();
    delete input.dataset.revealAttached;
  };
}
