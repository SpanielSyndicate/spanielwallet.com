// Spaniel Wallet PWA — /wallet page.
//
// Three states:
//
//   1. No vault on disk          → "Create a Spaniel Wallet" + "Import"
//   2. Vault on disk, locked     → passphrase prompt
//   3. Unlocked                  → account list, balance, send/receive,
//                                  Series 1 action stubs

import {
  unlockVault,
  saveVaultEnvelope,
  saveMeta
} from '/js/wallet-core/vault.js';
import { solanaPayUri } from '/js/wallet-core/receive.js';
import { prepareSendSol } from '/js/wallet-core/send.js';
import { confirmSendSol } from './send-confirm.js';
import { isValidBase58Pubkey } from '/js/wallet-core/base58.js';
import { InvalidPassphraseError, WalletError } from '/js/wallet-core/wallet-errors.js';
import { makeRpcClient, assertNotProductionRpc } from './rpc.js';
import { loadRuntimeConfig } from './runtime-config.js';
import { getExplorerTxLink, CLUSTERS } from '../lib/solana-networks.js';
import { mountCreateFlow } from './wallet-create-flow.js';
import { mountImportFlow } from './wallet-import-flow.js';
import { attachRevealToggle } from './reveal-toggle.js';
import { watchCapsLock } from './caps-lock-watch.js';
import { ensureSiwsSession } from './siws.js';
import { apiGetJson, ApiHttpError } from './api-fetch.js';

export async function mount(target, ctx) {
  // SIWS hand-off: public-site pages (affiliate.html, etc.) link
  // /wallet/?siws=1&next=URL to ask the Spaniel Wallet to
  // authenticate the user. When the SIWS dance finishes the Worker
  // sets a session cookie scoped to its origin; every page on
  // spanielsyndicate.com that subsequently calls /api/* (with
  // credentials: 'include') shares it.
  const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
  const siwsRedirect = params.get('siws') === '1' ? params.get('next') : null;
  if (siwsRedirect && isSafeRedirect(siwsRedirect)) {
    return renderSiwsHandoff(target, ctx, siwsRedirect);
  }
  if (!ctx.envelope) return renderCreatePane(target, ctx);
  if (!ctx.unlocked) return renderUnlockPane(target, ctx);
  return renderWalletPane(target, ctx);
}

/**
 * Only allow same-origin redirects. An attacker who can set
 * `?next=https://evil.example` would otherwise hand the user back to
 * a phishing page that mimics affiliate.html — same browser, same
 * cookie, but rendered by attacker JS.
 */
function isSafeRedirect(next) {
  if (typeof next !== 'string' || next.length === 0) return false;
  try {
    const url = new URL(next, location.origin);
    return url.origin === location.origin;
  } catch {
    return false;
  }
}

function renderSiwsHandoff(target, ctx, next) {
  const siwsBanner = `
    <div class="srp-warn">
      Sign in with your Spaniel Wallet to continue to <code>${escapeHtml(next)}</code>.
    </div>
  `;
  // Case A: no vault — invite create/import, banner explains why.
  if (!ctx.envelope) {
    renderCreatePane(target, ctx);
    target.insertAdjacentHTML('afterbegin', siwsBanner);
    return;
  }
  // Case B: vault locked — show unlock; on success, sign + redirect.
  if (!ctx.unlocked) {
    renderUnlockPane(target, ctx);
    target.insertAdjacentHTML('afterbegin', siwsBanner);
    return;
  }
  // Case C: unlocked — run SIWS now and bounce.
  renderSiwsSigning(target, ctx, next);
}

async function renderSiwsSigning(target, ctx, next) {
  target.innerHTML = `
    <h1 class="app-title">Sign in</h1>
    <p class="app-subtitle">Signing you in to <code>${escapeHtml(next)}</code> with your Spaniel Wallet…</p>
    <section class="app-section">
      <p class="app-loading" id="siwsStatus">Building sign-in message…</p>
    </section>
  `;
  const status = target.querySelector('#siwsStatus');
  try {
    const active = ctx.unlocked.accounts.find((a) => a.pubkeyBase58 === ctx.unlocked.activePubkey)
      || ctx.unlocked.accounts[0];
    if (!active?.seed) throw new Error('No active account seed in unlocked vault');
    status.textContent = 'Signing the SIWS message…';
    await ensureSiwsSession({
      wallet: active.pubkeyBase58,
      seed: active.seed,
    });
    status.textContent = 'Signed in. Redirecting…';
    // Strip the query params before navigating so a refresh of the
    // destination doesn't replay the SIWS flow.
    setTimeout(() => { location.assign(next); }, 400);
  } catch (e) {
    target.innerHTML = `
      <h1 class="app-title">Sign in failed</h1>
      <section class="app-section">
        <p class="app-pending" style="color: #e08484">${escapeHtml(e?.message || 'Unknown error')}</p>
        <div class="app-btn-row" style="margin-top: 12px">
          <a class="app-btn" href="/wallet/">Back to wallet</a>
          <a class="app-btn" href="${escapeHtml(next)}">Back to ${escapeHtml(new URL(next, location.origin).host)}</a>
        </div>
      </section>
    `;
  }
}

// ─── Create / import pane ────────────────────────────────────────

function renderCreatePane(target, ctx) {
  // Landing pane: choose Create or Import. Each opens a dedicated
  // multi-step flow (see wallet-create-flow.js / wallet-import-flow.js).
  target.innerHTML = `
    <h1 class="app-title">Spaniel Wallet</h1>
    <p class="app-subtitle">A free, non-custodial Solana wallet that lives on this device. The server never sees your recovery phrase or password. Spaniel Syndicate cannot recover either one for you — back up your recovery phrase the moment you create the wallet.</p>

    <section class="app-section">
      <h2 class="app-section-title">Create a new wallet</h2>
      <p style="color: var(--muted); font-size: 13px; line-height: 1.5">Generates a fresh 12-word BIP-39 recovery phrase. You'll write it down, confirm a few words, and pick a password that encrypts the wallet on this device.</p>
      <div class="app-btn-row" style="margin-top: 12px">
        <button class="app-btn app-btn-primary" data-action="create" type="button">Create wallet</button>
      </div>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Import an existing wallet</h2>
      <p style="color: var(--muted); font-size: 13px; line-height: 1.5">Paste a BIP-39 recovery phrase (e.g. from Phantom or Solflare) or a raw ed25519 secret. Your wallet is re-derived at <code>m/44'/501'/0'/0'</code> — the same path Phantom uses by default.</p>
      <div class="app-btn-row" style="margin-top: 12px">
        <button class="app-btn" data-action="import" type="button">Import wallet</button>
      </div>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Compare to other wallets</h2>
      <ul style="color: var(--muted); font-size: 13px; line-height: 1.6; padding-left: 18px">
        <li><strong>BIP-39 + SLIP-10 ed25519</strong> at <code>m/44'/501'/0'/0'</code> — fully compatible with Phantom, Solflare, Backpack, Ledger.</li>
        <li><strong>AES-256-GCM + PBKDF2-SHA-256 600k iterations</strong> per-vault salt — modern KDF, on the same standard as MetaMask and Backpack.</li>
        <li><strong>Strength-gated password</strong> with hard floors, project-word blocklist, and a 30-second anti-shoulder-surfing reveal — stricter than MetaMask's 8-character minimum.</li>
        <li><strong>Forced 3-word backup quiz</strong> before the vault is written to disk. No skip button.</li>
      </ul>
    </section>
  `;
  target.querySelector('[data-action="create"]').addEventListener('click', () => {
    mountCreateFlow(target, ctx, async () => { await mount(target, ctx); });
  });
  target.querySelector('[data-action="import"]').addEventListener('click', () => {
    mountImportFlow(target, ctx, async () => { await mount(target, ctx); });
  });
}

// ─── Unlock pane ────────────────────────────────────────────────

function renderUnlockPane(target, ctx) {
  target.innerHTML = `
    <h1 class="app-title">Unlock wallet</h1>
    <p class="app-subtitle">Your encrypted wallet lives on this device. Enter your password to unlock it.</p>
    <section class="app-section">
      <form id="unlockForm">
        <label class="app-label" for="unlockPass">Password</label>
        <input class="app-input" id="unlockPass" name="pass" type="password" autocomplete="current-password" required>
        <div style="height: 12px"></div>
        <button class="app-btn app-btn-primary" type="submit">Unlock</button>
      </form>
      <p id="unlockError" class="app-pending" hidden></p>
    </section>
    <section class="app-section">
      <h2 class="app-section-title">Forgot your password?</h2>
      <p style="color: var(--muted); font-size: 13px">Spaniel Wallet has no recovery service. If you've lost your password, your only option is to wipe this wallet and restore from your 12-word recovery phrase (or another wallet you've already exported) on the Security page.</p>
      <a class="app-btn app-btn-danger" href="/security/">Open Security</a>
    </section>
  `;
  attachRevealToggle(target.querySelector('#unlockPass'));
  watchCapsLock(target.querySelector('#unlockPass'));
  target.querySelector('#unlockForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = target.querySelector('#unlockError');
    err.hidden = true;
    try {
      const unlocked = await unlockVault({
        envelope: ctx.envelope,
        passphrase: target.querySelector('#unlockPass').value
      });
      ctx.setUnlocked(unlocked);
      // Re-mount so ?siws=1&next= (if present) routes through the
      // SIWS hand-off branch; otherwise we just land on the wallet
      // pane as before.
      await mount(target, ctx);
    } catch (e) {
      err.hidden = false;
      err.textContent = friendlyError(e);
    }
  });
}

// ─── Unlocked wallet pane ──────────────────────────────────────

async function renderWalletPane(target, ctx) {
  const active = ctx.unlocked.accounts.find((a) => a.pubkeyBase58 === ctx.unlocked.activePubkey)
    || ctx.unlocked.accounts[0];
  const uri = solanaPayUri({
    pubkeyBase58: active.pubkeyBase58,
    label: active.label || 'Spaniel Wallet'
  });

  // Load runtime config (rpcUrl, cluster, etc.). If the load fails,
  // the wallet still renders but with the RPC-dependent panels in
  // an explicit "offline" state — never fake a balance.
  let runtime = null;
  let rpcClient = null;
  let rpcStatus = 'loading';
  let rpcStatusMessage = '';
  try {
    runtime = await loadRuntimeConfig();
    if (runtime && typeof runtime.rpcUrl === 'string') {
      assertNotProductionRpc(runtime.rpcUrl, { allowMainnet: false });
      rpcClient = makeRpcClient(runtime.rpcUrl);
      rpcStatus = 'ok';
    } else {
      rpcStatus = 'no-rpc';
      rpcStatusMessage = 'runtime-config.json missing rpcUrl';
    }
  } catch (e) {
    rpcStatus = 'error';
    rpcStatusMessage = e.message || 'unknown';
  }

  const cluster = (runtime?.cluster || (runtime?.rpcUrl?.includes('devnet') ? 'devnet' : '?')) || '?';

  target.innerHTML = `
    <h1 class="app-title">Wallet</h1>
    <p class="app-subtitle">Send and receive SOL on Solana. Use this address to receive affiliate payouts, Rescue Pool distributions, or any Solana asset.</p>

    <section class="app-section">
      <h2 class="app-section-title">Network</h2>
      <div class="app-row">
        <span class="app-row-label">Cluster</span>
        <span class="app-row-value">${escapeHtml(cluster)}</span>
      </div>
      <div class="app-row">
        <span class="app-row-label">RPC</span>
        <span class="app-row-value" style="font-family: 'DM Mono', monospace; font-size: 12px; word-break: break-all">${escapeHtml(runtime?.rpcUrl || '<unset>')}</span>
      </div>
      <div class="app-row">
        <span class="app-row-label">Status</span>
        <span class="app-row-value" id="rpcStatusValue">${escapeHtml(rpcStatusBadge(rpcStatus, rpcStatusMessage))}</span>
      </div>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Active account</h2>
      <div class="app-row">
        <span class="app-row-label">Label</span>
        <span class="app-row-value">${escapeHtml(active.label || 'Account 1')}</span>
      </div>
      <div class="app-row">
        <span class="app-row-label">Address</span>
        <span class="app-row-value" style="font-family: 'DM Mono', monospace; font-size: 12px">${escapeHtml(active.pubkeyBase58)}</span>
      </div>
      <div class="app-row">
        <span class="app-row-label">SOL balance</span>
        <span class="app-row-value" id="solBalance" style="font-family: 'DM Mono', monospace">loading…</span>
      </div>
      <div class="app-btn-row" style="margin-top: 12px">
        <button class="app-btn" id="copyAddress">Copy address</button>
        <button class="app-btn" id="copyUri">Copy Solana Pay link</button>
        <button class="app-btn" id="refreshBalance">Refresh balance</button>
        ${cluster === 'devnet' ? '<button class="app-btn" id="requestAirdrop">Request 1 SOL devnet airdrop</button>' : ''}
      </div>
      <p id="airdropStatus" class="app-pending" hidden></p>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Receive</h2>
      <p style="color: var(--muted); font-size: 13px">Share your address or scan this Solana Pay link from a sender's wallet.</p>
      <pre class="app-pre" style="word-break: break-all">${escapeHtml(uri)}</pre>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Send SOL</h2>
      <form id="sendForm">
        <label class="app-label" for="sendTo">Recipient address</label>
        <input class="app-input" id="sendTo" name="to" type="text" autocomplete="off" required>
        <label class="app-label" for="sendAmount" style="margin-top: 8px">Amount (SOL)</label>
        <input class="app-input" id="sendAmount" name="amount" type="number" inputmode="decimal" min="0" step="0.000000001" required>
        <div style="height: 12px"></div>
        <button class="app-btn app-btn-primary" type="submit" ${rpcStatus !== 'ok' ? 'disabled' : ''}>${rpcStatus === 'ok' ? 'Send' : 'Send (RPC unavailable)'}</button>
      </form>
      <p id="sendStatus" class="app-pending" hidden></p>
      <pre id="sendPreview" class="app-pre" hidden></pre>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Series 1 product purchase</h2>
      <p class="app-pending">The 17-account buy_product_with_quote transaction (with SpanielCoin SPL accounts) is constructed by the /rip page and submitted from there. This panel is for receive-and-send only.</p>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">SpanielCoin balance</h2>
      <div id="spanielCoinPanel" aria-live="polite">
        <p class="app-loading">Loading SpanielCoin balance…</p>
      </div>
      <p class="app-pending" style="margin-top: 8px">SpanielCoin is the Series 1 ecosystem token. Paid Series 1 cards earn SpanielCoin: 1 to the buyer and 1 to a direct Barklink affiliate if attached. Redemption draws do not mint SpanielCoin. SpanielCoin is not an investment, does not pay yield or dividends, and is not guaranteed to have market value.</p>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">USDC, NFTs, and cards</h2>
      <p class="app-pending">USDC transfers and Series 1 card/sealed-product transfers require token-account derivation + the Series 1 Program. Both are scaffolded but not live. Track progress on the Security page.</p>
    </section>
  `;
  loadSpanielCoinPanel(target, active.pubkeyBase58);

  target.querySelector('#copyAddress').addEventListener('click', () => copyText(active.pubkeyBase58));
  target.querySelector('#copyUri').addEventListener('click', () => copyText(uri));

  // Refresh SOL + SpanielCoin after a successful purchase recorded
  // on /rip. Listen on `window` (the rip page dispatches a
  // CustomEvent there) and only refresh when the event is for the
  // currently-active account.
  const onPurchaseRecorded = (ev) => {
    if (ev?.detail?.wallet && ev.detail.wallet !== active.pubkeyBase58) return;
    refreshBalance();
    loadSpanielCoinPanel(target, active.pubkeyBase58);
  };
  window.addEventListener('spaniel:purchase-recorded', onPurchaseRecorded);

  async function refreshBalance() {
    const el = target.querySelector('#solBalance');
    if (!el) return;
    if (!rpcClient) {
      el.textContent = 'no RPC';
      return;
    }
    el.textContent = 'loading…';
    try {
      const { lamports, solApprox } = await rpcClient.getBalance(active.pubkeyBase58);
      el.textContent = `${solApprox.toFixed(9)} SOL (${lamports.toString()} lamports)`;
    } catch (e) {
      el.textContent = `error: ${e.message || 'unknown'}`;
    }
  }
  refreshBalance();
  target.querySelector('#refreshBalance')?.addEventListener('click', refreshBalance);

  const airdropBtn = target.querySelector('#requestAirdrop');
  if (airdropBtn) {
    airdropBtn.addEventListener('click', async () => {
      const st = target.querySelector('#airdropStatus');
      st.hidden = false;
      st.textContent = 'requesting 1 SOL airdrop from devnet faucet…';
      try {
        const sig = await rpcClient.requestAirdrop(active.pubkeyBase58, 1_000_000_000);
        st.innerHTML = `airdrop signature: <code>${escapeHtml(sig)}</code> · <a href="${escapeHtml(getExplorerTxLink(sig, CLUSTERS.DEVNET))}" target="_blank" rel="noopener">explorer</a> · awaiting confirmation…`;
        const conf = await rpcClient.confirmSignature(sig, { timeoutMs: 30_000 });
        if (conf.confirmed) {
          st.innerHTML += '<br>confirmed.';
          await refreshBalance();
        } else {
          st.innerHTML += `<br>not confirmed (${escapeHtml(JSON.stringify(conf.err))}). The faucet may be rate-limited; retry shortly.`;
        }
      } catch (e) {
        st.textContent = `airdrop failed: ${e.message || 'unknown'}`;
      }
    });
  }

  target.querySelector('#sendForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const status = target.querySelector('#sendStatus');
    const preview = target.querySelector('#sendPreview');
    status.hidden = true;
    preview.hidden = true;
    const to = target.querySelector('#sendTo').value.trim();
    const amount = parseFloat(target.querySelector('#sendAmount').value);
    if (!isValidBase58Pubkey(to)) {
      status.hidden = false;
      status.textContent = 'Recipient address is not a valid Solana pubkey.';
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      status.hidden = false;
      status.textContent = 'Amount must be a positive number of SOL.';
      return;
    }
    if (!rpcClient) {
      status.hidden = false;
      status.textContent = 'RPC client is unavailable — cannot submit.';
      return;
    }
    try {
      status.hidden = false;
      status.textContent = 'fetching recent blockhash…';
      const { blockhash } = await rpcClient.getLatestBlockhash();
      const prepared = prepareSendSol({
        account: active,
        toBase58: to,
        amount,
        recentBlockhashBase58: blockhash,
      });
      preview.hidden = false;
      preview.textContent = JSON.stringify({
        from: prepared.fromBase58,
        to: prepared.toBase58,
        lamports: prepared.lamports.toString(),
        recentBlockhash: blockhash,
        signature: prepared.signatureBase58,
      }, null, 2);
      const ok = confirmSendSol({
        fromBase58: prepared.fromBase58,
        toBase58: prepared.toBase58,
        lamports: BigInt(prepared.lamports),
        cluster,
      });
      if (!ok) {
        status.textContent = 'send cancelled.';
        return;
      }
      status.textContent = 'submitting transaction…';
      const sig = await rpcClient.sendRawTransaction(prepared.txBase58, { encoding: 'base58' });
      status.innerHTML = `submitted: <code>${escapeHtml(sig)}</code> · <a href="${escapeHtml(getExplorerTxLink(sig, cluster))}" target="_blank" rel="noopener">explorer</a> · awaiting confirmation…`;
      const conf = await rpcClient.confirmSignature(sig, { timeoutMs: 60_000 });
      if (conf.confirmed) {
        status.innerHTML += '<br>confirmed.';
        await refreshBalance();
      } else {
        status.innerHTML += `<br>not confirmed within 60s (${escapeHtml(JSON.stringify(conf.err))}). The signature is still on the network — check the explorer link.`;
      }
    } catch (e) {
      status.hidden = false;
      status.textContent = `send failed: ${friendlyError(e)}`;
    }
  });
}

function rpcStatusBadge(status, message) {
  switch (status) {
    case 'ok': return 'connected';
    case 'loading': return 'loading…';
    case 'no-rpc': return `no RPC configured${message ? ' — ' + message : ''}`;
    case 'error': return `error: ${message}`;
    default: return status;
  }
}

// ─── helpers ──────────────────────────────────────────────────

function copyText(s) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(s).catch(() => {});
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function friendlyError(e) {
  if (e instanceof InvalidPassphraseError) return 'Wrong password.';
  if (e instanceof WalletError) return e.message;
  return e?.message || 'Something went wrong.';
}

async function loadSpanielCoinPanel(target, pubkey) {
  const panel = target.querySelector('#spanielCoinPanel');
  if (!panel) return;
  try {
    const body = await apiGetJson(`/api/spanielcoin/balance/${encodeURIComponent(pubkey)}`, { credentials: 'omit' });
    const liveBadge = body.isLive
      ? '<span class="app-pending" style="display:inline-block; margin-left: 8px">SPL mint live</span>'
      : '<span class="app-pending" style="display:inline-block; margin-left: 8px">dev/mock — SPL mint not deployed</span>';
    // Buyer + Direct Affiliate Coin both credit this wallet; Treasury
    // Match is minted to the treasury wallet, NOT this user wallet,
    // so we surface buyer_earned and direct_affiliate_earned but omit
    // treasury_match_earned (it is always 0 for non-treasury wallets).
    panel.innerHTML = `
      <div class="app-row">
        <span class="app-row-label">Balance</span>
        <span class="app-row-value" style="font-family: 'DM Mono', monospace">${escapeHtml(body.balance)} ${escapeHtml(body.symbol || 'SPCN')}${liveBadge}</span>
      </div>
      <div class="app-row">
        <span class="app-row-label">Buyer Coin earned</span>
        <span class="app-row-value" style="font-family: 'DM Mono', monospace">${escapeHtml(body.buyerEarned ?? '0')}</span>
      </div>
      <div class="app-row">
        <span class="app-row-label">Direct Affiliate Coin earned</span>
        <span class="app-row-value" style="font-family: 'DM Mono', monospace">${escapeHtml(body.directAffiliateEarned ?? '0')}</span>
      </div>
      <div class="app-row">
        <span class="app-row-label">Lifetime earned (total)</span>
        <span class="app-row-value" style="font-family: 'DM Mono', monospace">${escapeHtml(body.totalEarned)}</span>
      </div>
      <div class="app-row">
        <span class="app-row-label">Lifetime burned</span>
        <span class="app-row-value" style="font-family: 'DM Mono', monospace">${escapeHtml(body.totalBurned)}</span>
      </div>
      <p class="app-pending" style="margin-top: 8px">${escapeHtml(body.notice || 'SpanielCoin is tracked in dev/mock until the SPL mint deploys.')}</p>
    `;
  } catch (e) {
    panel.innerHTML = `<p class="app-pending">SpanielCoin balance unavailable: ${escapeHtml(e.message || 'unknown error')}.</p>`;
  }
}
