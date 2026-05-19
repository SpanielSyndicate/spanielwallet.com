// Spaniel Wallet — multi-step create flow.
//
// Steps (cannot be skipped or rearranged):
//
//   1. PASSPHRASE     — pick + confirm, blocked by strength gate.
//   2. INTERSTITIAL   — three short "what is a recovery phrase" cards
//                       behind explicit acknowledgement checkboxes.
//   3. REVEAL         — generate the wallet, show the 12-word phrase
//                       under the anti-shoulder-surfing reveal UX.
//   4. QUIZ           — 3 random words; wrong = re-show + re-quiz.
//   5. DONE           — persist the encrypted envelope, hand back to
//                       the caller via onComplete.
//
// The wallet is generated in memory at step 3 and held there until
// step 5 commits. If the user closes the tab during the quiz the
// fresh wallet is NEVER written to disk — preventing the "I closed
// it before backing up and now I'm locked out" failure mode.

import { createVault, saveVaultEnvelope, saveMeta } from '/js/wallet-core/vault.js';
import { scorePassphrase, scoreLabel } from '/js/wallet-core/passphrase-strength.js';
import { mountSrpReveal } from './srp-reveal.js';
import { mountSrpQuiz } from './srp-quiz.js';

const STEPS = ['Passphrase', 'Learn', 'Reveal', 'Confirm', 'Done'];

/**
 * Mount the create-flow into `target`. The shell-supplied `ctx`
 * provides storage + setters; on successful completion we persist
 * the vault and call `ctx.setEnvelope`/`setMeta`/`setUnlocked` so
 * the shell can re-render the unlocked wallet pane.
 *
 * @param {HTMLElement} target
 * @param {object} ctx               shell context (see app/app.js)
 * @param {() => Promise<void>} onComplete  called once after persist
 */
export async function mountCreateFlow(target, ctx, onComplete) {
  /** @type {{ pass: string|null, generated: any }} */
  const state = { pass: null, generated: null };
  let step = 0;
  render();

  function render() {
    target.innerHTML = `
      <h1 class="app-title">Create your Spaniel Wallet</h1>
      <p class="create-step-label">Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}</p>
      <ul class="create-stepper">
        ${STEPS.map((_, i) => `<li data-active="${i === step ? '1' : '0'}" data-done="${i < step ? '1' : '0'}"></li>`).join('')}
      </ul>
      <section class="app-section" data-step-content></section>
    `;
    const content = target.querySelector('[data-step-content]');
    if (step === 0) renderPassphrase(content);
    else if (step === 1) renderInterstitial(content);
    else if (step === 2) renderReveal(content);
    else if (step === 3) renderQuiz(content);
    else if (step === 4) renderDone(content);
  }

  // ── Step 1: passphrase ───────────────────────────────────────
  function renderPassphrase(content) {
    content.innerHTML = `
      <h2 class="app-section-title">Pick a passphrase</h2>
      <p style="color: var(--muted); font-size: 13px; line-height: 1.5">This passphrase encrypts your wallet on THIS device. Spaniel Syndicate cannot reset it. Pick something memorable and hard to guess.</p>

      <label class="app-label" for="newPass">Passphrase</label>
      <input class="app-input" id="newPass" name="pass" type="password" autocomplete="new-password">
      <div class="strength-meter" data-strength-meter data-score="0">
        ${[0,1,2,3,4].map(() => '<div class="strength-meter-bar"></div>').join('')}
      </div>
      <p class="strength-meter-caption" data-strength-caption></p>
      <p class="strength-meter-problem" data-strength-problem hidden></p>
      <p class="strength-meter-suggestion" data-strength-suggestion hidden></p>

      <label class="app-label" for="newPass2" style="margin-top: 12px">Confirm passphrase</label>
      <input class="app-input" id="newPass2" name="pass2" type="password" autocomplete="new-password">
      <p class="strength-meter-problem" data-confirm-problem hidden></p>

      <label class="onboard-confirm">
        <input type="checkbox" data-diceware>
        <span>I'm using a 5+ word "diceware" passphrase (allows all-letter phrases longer than 30 characters).</span>
      </label>

      <label class="onboard-confirm">
        <input type="checkbox" data-ack-irrecoverable>
        <span>I understand Spaniel Syndicate <strong>cannot</strong> reset this passphrase. If I lose it I must restore the wallet from the 12-word recovery phrase I'm about to write down.</span>
      </label>

      <div class="app-btn-row" style="margin-top: 12px">
        <button class="app-btn app-btn-primary" data-next disabled type="button">Next: recovery phrase</button>
      </div>
    `;
    const passEl = content.querySelector('#newPass');
    const pass2El = content.querySelector('#newPass2');
    const dicewareEl = content.querySelector('[data-diceware]');
    const ackEl = content.querySelector('[data-ack-irrecoverable]');
    const nextBtn = content.querySelector('[data-next]');
    const meter = content.querySelector('[data-strength-meter]');
    const caption = content.querySelector('[data-strength-caption]');
    const problemEl = content.querySelector('[data-strength-problem]');
    const suggEl = content.querySelector('[data-strength-suggestion]');
    const confirmProblemEl = content.querySelector('[data-confirm-problem]');

    function refresh() {
      const pw = passEl.value;
      const pw2 = pass2El.value;
      const diceware = dicewareEl.checked;
      const ack = ackEl.checked;
      const r = scorePassphrase(pw, { acceptDiceware: diceware });
      meter.dataset.score = String(r.score);
      caption.textContent = pw
        ? `Strength: ${scoreLabel(r.score)} · would take ${r.crackTimeOffline} to crack offline.`
        : '';
      caption.dataset.state = r.score >= 3 ? 'strong' : (r.score <= 1 ? 'weak' : '');
      if (r.problems.length) {
        problemEl.hidden = false; problemEl.textContent = r.problems[0];
      } else { problemEl.hidden = true; }
      if (r.suggestions.length) {
        suggEl.hidden = false; suggEl.textContent = r.suggestions[0];
      } else { suggEl.hidden = true; }
      let confirmOk = true;
      if (pw && pw2 && pw !== pw2) {
        confirmProblemEl.hidden = false;
        confirmProblemEl.textContent = 'The two passphrases do not match.';
        confirmOk = false;
      } else {
        confirmProblemEl.hidden = true;
      }
      nextBtn.disabled = !(r.passedHardFloors && r.score >= 3 && confirmOk && pw === pw2 && pw.length > 0 && ack);
    }
    passEl.addEventListener('input', refresh);
    pass2El.addEventListener('input', refresh);
    dicewareEl.addEventListener('change', refresh);
    ackEl.addEventListener('change', refresh);
    refresh();

    nextBtn.addEventListener('click', () => {
      state.pass = passEl.value;
      step = 1;
      render();
    });
  }

  // ── Step 2: educational interstitial ─────────────────────────
  function renderInterstitial(content) {
    content.innerHTML = `
      <h2 class="app-section-title">Before we show your recovery phrase</h2>

      <div class="onboard-card">
        <h3>It is the wallet.</h3>
        <p>The 12-word recovery phrase IS your wallet. Anyone who has it has every cent in this wallet — instantly, permanently, anywhere in the world. We can't reverse a theft.</p>
      </div>
      <div class="onboard-card">
        <h3>Write it on paper. Never on a screen.</h3>
        <p>Pen and paper. Two copies. Different physical locations. Don't take a photo of it. Don't type it into anything other than this wallet's import screen. Don't paste it into a chat, email, password manager, note, or AI chatbot.</p>
      </div>
      <div class="onboard-card">
        <h3>We will not ask you for it again.</h3>
        <p>Spaniel Syndicate, support staff, social media accounts, "verified" Discord moderators — none of them will EVER ask for your recovery phrase. If someone asks, they are stealing from you.</p>
      </div>

      <label class="onboard-confirm">
        <input type="checkbox" data-ack-paper>
        <span>I will write the phrase down on paper before continuing.</span>
      </label>
      <label class="onboard-confirm">
        <input type="checkbox" data-ack-share>
        <span>I will never share the phrase with anyone, ever — including anyone claiming to be Spaniel Syndicate support.</span>
      </label>

      <div class="app-btn-row" style="margin-top: 12px">
        <button class="app-btn" data-back type="button">Back</button>
        <button class="app-btn app-btn-primary" data-next disabled type="button">I understand — show the phrase</button>
      </div>
    `;
    const next = content.querySelector('[data-next]');
    const back = content.querySelector('[data-back]');
    const acks = content.querySelectorAll('[data-ack-paper], [data-ack-share]');
    function refresh() { next.disabled = !Array.from(acks).every((c) => c.checked); }
    acks.forEach((c) => c.addEventListener('change', refresh));
    refresh();
    back.addEventListener('click', () => { step = 0; render(); });
    next.addEventListener('click', async () => {
      // Generate the wallet NOW (it's the only place we can show
      // words to the user). Hold in memory; do not persist yet.
      try {
        state.generated = await createVault({ passphrase: state.pass });
      } catch (e) {
        content.innerHTML += `<p class="strength-meter-problem">Wallet generation failed: ${escapeHtml(e?.message || 'unknown')}</p>`;
        return;
      }
      step = 2; render();
    });
  }

  // ── Step 3: reveal ───────────────────────────────────────────
  function renderReveal(content) {
    content.innerHTML = `
      <h2 class="app-section-title">Your recovery phrase</h2>
      <div data-srp-host></div>
      <div class="app-btn-row" style="margin-top: 12px">
        <button class="app-btn app-btn-primary" data-next type="button">I wrote them down — confirm</button>
      </div>
    `;
    mountSrpReveal(content.querySelector('[data-srp-host]'), {
      words: state.generated.words,
      mnemonic: state.generated.mnemonic,
    });
    content.querySelector('[data-next]').addEventListener('click', () => {
      step = 3; render();
    });
  }

  // ── Step 4: quiz ─────────────────────────────────────────────
  function renderQuiz(content) {
    content.innerHTML = `
      <h2 class="app-section-title">Confirm your recovery phrase</h2>
      <div data-quiz-host></div>
      <div class="app-btn-row" style="margin-top: 12px">
        <button class="app-btn" data-back type="button">Show the phrase again</button>
      </div>
    `;
    const back = content.querySelector('[data-back]');
    back.addEventListener('click', () => { step = 2; render(); });
    mountSrpQuiz(content.querySelector('[data-quiz-host]'), {
      words: state.generated.words,
      onFail: () => { /* the quiz UI handles re-prompt; we re-show the SRP automatically */ setTimeout(() => { step = 2; render(); }, 1200); },
      onComplete: async () => {
        try {
          await saveVaultEnvelope(ctx.storage, state.generated.envelope);
          await saveMeta(ctx.storage, state.generated.meta);
          ctx.setEnvelope(state.generated.envelope);
          ctx.setMeta(state.generated.meta);
          ctx.setUnlocked(state.generated.unlocked);
        } catch (e) {
          content.innerHTML = `<p class="strength-meter-problem">Failed to save wallet: ${escapeHtml(e?.message || 'unknown')}. Refresh and try again.</p>`;
          return;
        }
        step = 4; render();
        // Drop the in-memory mnemonic after persist. The user can
        // re-reveal from the Security page once the envelope is on
        // disk — no reason to hold it in the page state any longer.
        if (state.generated) {
          state.generated.mnemonic = '';
          if (Array.isArray(state.generated.words)) {
            // best-effort clear (frozen, so we can't mutate; but we
            // drop the reference so GC can reclaim).
            state.generated.words = null;
          }
        }
      },
    });
  }

  // ── Step 5: done ─────────────────────────────────────────────
  function renderDone(content) {
    content.innerHTML = `
      <h2 class="app-section-title">Wallet ready</h2>
      <p style="color: var(--muted); font-size: 14px; line-height: 1.5">Your Spaniel Wallet is unlocked. Your recovery phrase is encrypted on this device — you can re-reveal it any time from the Security tab.</p>
      <div class="app-btn-row" style="margin-top: 12px">
        <button class="app-btn app-btn-primary" data-go type="button">Open my wallet</button>
      </div>
    `;
    content.querySelector('[data-go]').addEventListener('click', () => {
      onComplete().catch((e) => console.warn('post-create render failed', e));
    });
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}
