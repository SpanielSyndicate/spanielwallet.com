// Spaniel Wallet — import-existing-wallet flow.
//
// Two-step:
//   1. SECRET     — paste a BIP-39 mnemonic OR a hex/base58 secret.
//                   Live-validation: known-format / checksum check
//                   BEFORE asking for a passphrase.
//   2. PASSPHRASE — strength-gated, same UX as the create flow.
//
// On success the imported wallet is encrypted to disk and the shell
// renders the unlocked wallet pane.

import { importVault, saveVaultEnvelope, saveMeta } from '/js/wallet-core/vault.js';
import { describeMnemonicProblem } from '/js/wallet-core/mnemonic.js';
import { scorePassphrase, scoreLabel } from '/js/wallet-core/passphrase-strength.js';
import { attachRevealToggle } from './reveal-toggle.js';

const STEPS = ['Paste', 'Passphrase', 'Done'];

/**
 * @param {HTMLElement} target
 * @param {object} ctx
 * @param {() => Promise<void>} onComplete
 */
export async function mountImportFlow(target, ctx, onComplete) {
  const state = { secret: null, pass: null };
  let step = 0;
  render();

  function render() {
    target.innerHTML = `
      <h1 class="app-title">Import an existing wallet</h1>
      <p class="create-step-label">Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}</p>
      <ul class="create-stepper">
        ${STEPS.map((_, i) => `<li data-active="${i === step ? '1' : '0'}" data-done="${i < step ? '1' : '0'}"></li>`).join('')}
      </ul>
      <section class="app-section" data-step-content></section>
    `;
    const content = target.querySelector('[data-step-content]');
    if (step === 0) renderSecret(content);
    else if (step === 1) renderPassphrase(content);
    else if (step === 2) renderDone(content);
  }

  function renderSecret(content) {
    content.innerHTML = `
      <h2 class="app-section-title">Paste your recovery phrase or private key</h2>
      <p style="color: var(--muted); font-size: 13px; line-height: 1.5">Accepts either:</p>
      <ul style="color: var(--muted); font-size: 13px; line-height: 1.5; margin: 6px 0 12px 18px">
        <li>A 12 / 15 / 18 / 21 / 24 word BIP-39 recovery phrase (e.g. Phantom export).</li>
        <li>A 32-byte raw seed in hex (64 chars), or a 64-byte secret key in hex (128 chars) or base58 (≈88 chars).</li>
      </ul>
      <div class="srp-warn">
        <strong>Never paste your recovery phrase from a random text snippet.</strong>
        If you came here from a link in chat or email and the destination wasn't <code>https://spanielsyndicate.com/</code> or <code>https://spanielwallet.com/</code>, close this tab and try again.
      </div>
      <label class="app-label" for="impSecret">Recovery phrase or private key</label>
      <textarea class="app-input" id="impSecret" rows="3" autocomplete="off" spellcheck="false" autocapitalize="off" data-1p-ignore data-lpignore="true" data-form-type="other"></textarea>
      <p class="strength-meter-problem" data-secret-problem hidden></p>
      <p class="strength-meter-caption" data-secret-caption></p>
      <div class="app-btn-row" style="margin-top: 12px">
        <button class="app-btn app-btn-primary" data-next disabled type="button">Next: passphrase</button>
      </div>
    `;
    const ta = content.querySelector('#impSecret');
    const problem = content.querySelector('[data-secret-problem]');
    const caption = content.querySelector('[data-secret-caption]');
    const next = content.querySelector('[data-next]');
    function refresh() {
      const v = ta.value.trim();
      if (!v) { problem.hidden = true; caption.textContent = ''; next.disabled = true; return; }
      if (/\s/.test(v)) {
        const issue = describeMnemonicProblem(v);
        if (issue) {
          problem.hidden = false; problem.textContent = issue;
          caption.textContent = ''; next.disabled = true; return;
        }
        problem.hidden = true;
        caption.textContent = `Looks like a valid ${v.split(/\s+/).length}-word BIP-39 recovery phrase.`;
        next.disabled = false; return;
      }
      // Length-based hint for hex/base58.
      if (/^[0-9a-fA-F]+$/.test(v) && (v.length === 64 || v.length === 128)) {
        problem.hidden = true;
        caption.textContent = v.length === 64 ? 'Looks like a 32-byte seed (hex).' : 'Looks like a 64-byte secret key (hex).';
        next.disabled = false; return;
      }
      if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(v) && v.length >= 32 && v.length <= 90) {
        problem.hidden = true;
        caption.textContent = 'Looks like a base58 secret key.';
        next.disabled = false; return;
      }
      problem.hidden = false;
      problem.textContent = 'Doesn\'t look like a recovery phrase or a hex/base58 key.';
      caption.textContent = '';
      next.disabled = true;
    }
    ta.addEventListener('input', refresh);
    refresh();
    next.addEventListener('click', () => { state.secret = ta.value.trim(); step = 1; render(); });
  }

  function renderPassphrase(content) {
    content.innerHTML = `
      <h2 class="app-section-title">Set a passphrase to encrypt the wallet on this device</h2>
      <p style="color: var(--muted); font-size: 13px; line-height: 1.5">This passphrase is separate from your recovery phrase. It only encrypts the on-disk vault on THIS device — if you wipe + restore from your recovery phrase elsewhere, you'll set a new one.</p>
      <label class="app-label" for="impPass">Passphrase</label>
      <input class="app-input" id="impPass" type="password" autocomplete="new-password">
      <div class="strength-meter" data-strength-meter data-score="0">
        ${[0,1,2,3,4].map(() => '<div class="strength-meter-bar"></div>').join('')}
      </div>
      <p class="strength-meter-caption" data-strength-caption></p>
      <p class="strength-meter-problem" data-strength-problem hidden></p>
      <label class="app-label" for="impPass2" style="margin-top: 12px">Confirm passphrase</label>
      <input class="app-input" id="impPass2" type="password" autocomplete="new-password">
      <p class="strength-meter-problem" data-confirm-problem hidden></p>
      <label class="onboard-confirm">
        <input type="checkbox" data-diceware>
        <span>I'm using a 5+ word diceware passphrase.</span>
      </label>
      <p class="strength-meter-problem" data-import-error hidden></p>
      <div class="app-btn-row" style="margin-top: 12px">
        <button class="app-btn" data-back type="button">Back</button>
        <button class="app-btn app-btn-primary" data-next disabled type="button">Import</button>
      </div>
    `;
    const pass = content.querySelector('#impPass');
    const pass2 = content.querySelector('#impPass2');
    attachRevealToggle(pass);
    attachRevealToggle(pass2);
    const diceware = content.querySelector('[data-diceware]');
    const next = content.querySelector('[data-next]');
    const back = content.querySelector('[data-back]');
    const meter = content.querySelector('[data-strength-meter]');
    const caption = content.querySelector('[data-strength-caption]');
    const problemEl = content.querySelector('[data-strength-problem]');
    const confirmProblemEl = content.querySelector('[data-confirm-problem]');
    const importError = content.querySelector('[data-import-error]');
    function refresh() {
      const pw = pass.value; const pw2 = pass2.value;
      const r = scorePassphrase(pw, { acceptDiceware: diceware.checked });
      meter.dataset.score = String(r.score);
      caption.textContent = pw ? `Strength: ${scoreLabel(r.score)} · ${r.crackTimeOffline} to crack offline.` : '';
      caption.dataset.state = r.score >= 3 ? 'strong' : (r.score <= 1 ? 'weak' : '');
      if (r.problems.length) { problemEl.hidden = false; problemEl.textContent = r.problems[0]; }
      else { problemEl.hidden = true; }
      let confirmOk = true;
      if (pw && pw2 && pw !== pw2) {
        confirmProblemEl.hidden = false; confirmProblemEl.textContent = 'Passphrases do not match.';
        confirmOk = false;
      } else { confirmProblemEl.hidden = true; }
      next.disabled = !(r.passedHardFloors && r.score >= 3 && confirmOk && pw === pw2 && pw.length > 0);
    }
    pass.addEventListener('input', refresh);
    pass2.addEventListener('input', refresh);
    diceware.addEventListener('change', refresh);
    refresh();
    back.addEventListener('click', () => { step = 0; render(); });
    next.addEventListener('click', async () => {
      importError.hidden = true;
      next.disabled = true;
      try {
        const result = await importVault({ passphrase: pass.value, secret: state.secret });
        await saveVaultEnvelope(ctx.storage, result.envelope);
        await saveMeta(ctx.storage, result.meta);
        ctx.setEnvelope(result.envelope);
        ctx.setMeta(result.meta);
        ctx.setUnlocked(result.unlocked);
        // Wipe the in-memory secret immediately.
        state.secret = null; pass.value = ''; pass2.value = '';
        step = 2; render();
      } catch (e) {
        importError.hidden = false;
        importError.textContent = `Import failed: ${e?.message || 'unknown error'}`;
        next.disabled = false;
      }
    });
  }

  function renderDone(content) {
    content.innerHTML = `
      <h2 class="app-section-title">Wallet imported</h2>
      <p style="color: var(--muted); font-size: 14px; line-height: 1.5">Your wallet is encrypted on this device and unlocked.</p>
      <div class="app-btn-row" style="margin-top: 12px">
        <button class="app-btn app-btn-primary" data-go type="button">Open my wallet</button>
      </div>
    `;
    content.querySelector('[data-go]').addEventListener('click', () => {
      onComplete().catch((e) => console.warn('post-import render failed', e));
    });
  }
}
