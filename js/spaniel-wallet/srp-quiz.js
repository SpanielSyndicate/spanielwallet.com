// Spaniel Wallet — SRP backup confirmation quiz.
//
// Pick 3 random positions in [2..N-1] (avoid first + last; they're
// easy to glance). For each, show a single text input asking for
// "word #K of your recovery phrase". Player must type all 3
// correctly. On any wrong answer the form re-shows the SRP for re-
// memorisation and re-randomises the asked positions.
//
// This is the LAST step before a fresh wallet's vault is written to
// disk. No "skip" affordance — too many wallets ship that escape
// hatch and 70% of users skip it. The quiz is annoying ONCE; losing
// funds because you skipped the backup is forever.

import { BIP39_ENGLISH } from '../wallet-core/_bip39-english.js';

/**
 * Pick 3 distinct random positions from [2..N-1] (1-indexed,
 * excludes 1 and N). Returns positions sorted ascending for a
 * predictable display order.
 *
 * Exposed so tests can pin the RNG, and so the quiz UI can call
 * it again on re-shuffle.
 *
 * @param {number} wordCount
 * @param {() => number} [rng=Math.random]
 * @returns {[number, number, number]}
 */
export function pickQuizPositions(wordCount, rng = Math.random) {
  if (wordCount < 6) {
    throw new RangeError(`quiz needs at least 6 words (got ${wordCount})`);
  }
  // Eligible 1-indexed positions: 2..wordCount-1.
  const pool = [];
  for (let i = 2; i <= wordCount - 1; i++) pool.push(i);
  // Fisher-Yates shuffle, take 3.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picks = pool.slice(0, 3).sort((a, b) => a - b);
  return /** @type {[number, number, number]} */ (picks);
}

/**
 * Mount the 3-word quiz. Returns a control object with `onComplete`
 * (called once with `{ passed: true }`) and `onFail` (called every
 * time the user submits a wrong answer).
 *
 * @param {HTMLElement} container
 * @param {object} args
 * @param {readonly string[]} args.words
 * @param {(positions: number[]) => void} [args.onReshuffle]
 * @param {() => void} args.onComplete           called once on success
 * @param {(failedPositions: number[]) => void} [args.onFail]
 * @returns {{ dispose(): void, currentPositions(): number[] }}
 */
export function mountSrpQuiz(container, { words, onReshuffle, onComplete, onFail }) {
  if (!container || container.nodeType !== 1) {
    throw new TypeError('mountSrpQuiz requires an Element');
  }
  if (!Array.isArray(words) || words.length < 6) {
    throw new TypeError('mountSrpQuiz requires words[] of length >= 6');
  }
  if (typeof onComplete !== 'function') {
    throw new TypeError('mountSrpQuiz requires onComplete callback');
  }

  let positions = pickQuizPositions(words.length);

  function render() {
    container.innerHTML = `
      <p class="srp-quiz-prompt">Type the words below to confirm you wrote your recovery phrase down. We're asking 3 random positions — if any are wrong we'll show the phrase again so you can recheck.</p>
      <form class="srp-quiz-form" data-srp-quiz-form>
        ${positions.map((p) => `
          <label class="app-label">Word #${p}</label>
          <input class="app-input srp-quiz-input"
                 data-srp-quiz-pos="${p}"
                 type="text"
                 autocomplete="off"
                 autocapitalize="off"
                 autocorrect="off"
                 spellcheck="false"
                 inputmode="text"
                 data-1p-ignore
                 data-lpignore="true"
                 data-form-type="other"
                 required>
        `).join('')}
        <div style="height: 12px"></div>
        <button class="app-btn app-btn-primary" type="submit">Confirm backup</button>
      </form>
      <p class="srp-quiz-status" data-srp-quiz-status></p>
    `;
    const status = container.querySelector('[data-srp-quiz-status]');
    container.querySelector('[data-srp-quiz-form]').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const wrong = [];
      for (const pos of positions) {
        const input = container.querySelector(`[data-srp-quiz-pos="${pos}"]`);
        const typed = input.value.trim().normalize('NFKD').toLowerCase();
        const expected = words[pos - 1].normalize('NFKD').toLowerCase();
        if (typed !== expected) {
          wrong.push(pos);
          input.classList.add('app-input-error');
        } else {
          input.classList.remove('app-input-error');
        }
      }
      if (wrong.length === 0) {
        status.textContent = 'Backup confirmed.';
        onComplete({ passed: true });
        return;
      }
      status.textContent = `${wrong.length === 1 ? 'One word' : `${wrong.length} words`} did not match. Re-check your phrase — you'll be asked 3 NEW positions next.`;
      if (typeof onFail === 'function') onFail(wrong);
      // Re-randomise positions so the user has to look at the WHOLE
      // phrase again, not just memorise the same 3 slots.
      positions = pickQuizPositions(words.length);
      if (typeof onReshuffle === 'function') onReshuffle(positions);
      // Don't re-render the quiz immediately — the caller is expected
      // to re-show the SRP first and then call render() again via
      // the returned control. But provide a fallback: render after
      // a short pause so even a misuse doesn't soft-lock.
      setTimeout(render, 1500);
    });
  }
  render();

  return {
    dispose() { container.innerHTML = ''; },
    currentPositions() { return positions.slice(); },
  };
}

// Re-export the wordlist for callers who want to build a wordlist-
// constrained autocomplete on top of the quiz inputs (a UX nice-to-
// have we can layer on later).
export { BIP39_ENGLISH };
