// Spaniel Wallet PWA — /security page.
//
// Honest about the wallet's posture. Exposes:
//
//   - Export seed (with a giant warning).
//   - Wipe wallet (irreversible).
//   - PWA install hint.
//   - Status of features that are NOT yet wired (USDC send, card
//     transfer, Series 1 Program purchase, etc.).

import { exportActiveSecret } from '/js/wallet-core/vault.js';

export async function mount(target, ctx) {
  target.innerHTML = `
    <h1 class="app-title">Security & status</h1>
    <p class="app-subtitle">Spaniel Wallet is a first-party, non-custodial wallet. Your seed never leaves your device. Read this page before relying on the wallet for real funds.</p>

    <section class="app-section">
      <h2 class="app-section-title">Non-custodial · client-side</h2>
      <ul style="margin: 0; padding-left: 18px; color: var(--ink);">
        <li>Private keys are generated on this device.</li>
        <li>The vault is encrypted with AES-256-GCM under your password (PBKDF2-SHA-256, 600k iterations).</li>
        <li>The Worker / API never receives your seed or your private key.</li>
        <li>Seeds are stored in IndexedDB. localStorage is not used.</li>
        <li>Service worker never caches vault data.</li>
      </ul>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">No audit / no warranty</h2>
      <p>Spaniel Wallet has <strong>not</strong> undergone a third-party security audit. There is no guarantee that the wallet is free of bugs. Use a hardware wallet for large balances. The Spaniel Syndicate team does not custody your funds and cannot recover a lost passphrase.</p>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Status: what's live</h2>
      <ul style="margin: 0; padding-left: 18px;">
        <li>Free wallet creation + import (ed25519 seed).</li>
        <li>Free Barklink creation (Affiliate page).</li>
        <li>Encrypted vault on this device.</li>
        <li>SOL transaction signing (transaction submission to RPC requires an RPC; not yet wired in-PWA).</li>
        <li>Spaniel Showdown deterministic engine + mock matchmaking.</li>
      </ul>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Status: pending plumbing</h2>
      <ul style="margin: 0; padding-left: 18px; color: var(--muted);">
        <li>Series 1 Program is <strong>not yet deployed</strong>. Card purchases, openings, marketplace trades, and offer accepts will execute via signed transactions once the program is live.</li>
        <li>USDC transfer (token-account derivation).</li>
        <li>Series 1 card / sealed product transfer.</li>
        <li>Kennel Stakes mode — gated behind legal review and Series 1 Program escrow support. Not live.</li>
      </ul>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Export seed</h2>
      <p>Reveals your 32-byte seed and your 64-byte Solana secret key. Anyone with these can move your funds. Only do this in a private, trusted environment. The reveal panel auto-hides after 30 seconds.</p>
      <div class="app-btn-row">
        <button class="app-btn app-btn-danger" id="revealBtn" ${ctx.unlocked ? '' : 'disabled'}>Reveal active seed</button>
        <button class="app-btn" id="hideRevealBtn" hidden>Hide</button>
      </div>
      ${ctx.unlocked ? '' : '<p class="app-pending" style="margin-top: 8px">Unlock the wallet first.</p>'}
      <pre id="revealOut" class="app-pre" hidden></pre>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Wipe wallet</h2>
      <p>Delete the encrypted vault and metadata from this device. <strong>Irreversible.</strong> Make sure you have a copy of your seed first.</p>
      <div class="app-btn-row">
        <button class="app-btn app-btn-danger" id="wipeBtn">Wipe wallet from this device</button>
      </div>
      <p id="wipeStatus" class="app-pending" hidden></p>
    </section>
  `;

  let revealTimer = null;
  const revealOut = target.querySelector('#revealOut');
  const hideBtn = target.querySelector('#hideRevealBtn');
  const hideReveal = () => {
    if (revealTimer) { clearTimeout(revealTimer); revealTimer = null; }
    if (revealOut) {
      revealOut.textContent = '';
      revealOut.hidden = true;
    }
    if (hideBtn) hideBtn.hidden = true;
  };

  target.querySelector('#revealBtn').addEventListener('click', () => {
    if (!ctx.unlocked) return;
    const ok = window.confirm('Reveal your seed in cleartext? Anyone watching your screen can copy it. The reveal will auto-hide in 30 seconds.');
    if (!ok) return;
    const exp = exportActiveSecret(ctx.unlocked);
    revealOut.hidden = false;
    revealOut.textContent = JSON.stringify(exp, null, 2);
    if (hideBtn) hideBtn.hidden = false;
    // Wipe the rendered seed material after 30s and on page hide so a
    // walked-away-from screen doesn't keep the secret in the accessibility
    // tree forever.
    revealTimer = setTimeout(hideReveal, 30_000);
  });
  if (hideBtn) hideBtn.addEventListener('click', hideReveal);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hideReveal();
  });

  target.querySelector('#wipeBtn').addEventListener('click', async () => {
    const phrase = window.prompt('Type "wipe" to confirm. This cannot be undone.');
    if (phrase !== 'wipe') return;
    await ctx.wipe();
    target.querySelector('#wipeStatus').hidden = false;
    target.querySelector('#wipeStatus').textContent = 'Wallet wiped from this device.';
    setTimeout(() => ctx.navigate('wallet'), 500);
  });
}
