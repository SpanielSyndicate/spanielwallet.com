// Spaniel Wallet PWA — /rip page.
//
// End-to-end devnet rip flow:
//   1. Load runtime-config.json (rpcUrl, series1ProgramId, cluster).
//   2. Refuse mainnet RPC unless explicitly enabled.
//   3. Fetch product quote from /api/products/quote.
//   4. Build the 17-account buy_product_with_quote tx (real bytes,
//      via js/spaniel-wallet/series1-buy.js).
//   5. Sign locally with the unlocked Spaniel Wallet seed.
//   6. Submit via sendRawTransaction; poll confirmSignature.
//   7. POST /api/products/record AFTER the tx confirms.
//   8. Refresh binder counters.
//
// Gates honestly:
//   - Without `series1ProgramId` set in runtime-config: surface
//     PROGRAM_PENDING and disable submit. Quote preview still works.
//   - Without `spanielCoinSplMint` from the Worker: surface
//     SPCN_MINT_PENDING and disable submit.
//   - Without `quoteSignerPubkey` / `signatureHex` in the response:
//     surface QUOTE_UNSIGNED and disable submit (dev environments
//     without the QUOTE_SIGNER_SECRET secret).
//   - On tx failure: surface the actual error/logs, never fake success.
//
// The Worker /api/products/record path is called only AFTER the
// submitted tx is confirmed by the RPC; never speculatively.

import { spanielCoinIssuanceForProductPurchase } from '/js/lib/spanielcoin.js';
import { clampQuantity } from './rip-input.js';
import { loadRuntimeConfig } from './runtime-config.js';
import { apiUrl, ensureRuntimeConfig } from './api-url.js';
import { makeRpcClient, assertNotProductionRpc } from './rpc.js';
import { getExplorerTxLink, CLUSTERS } from '../lib/solana-networks.js';
import { SYSTEM_PROGRAM_ID } from '../lib/solana-program-ids.js';
import { buildBuyProductMessage, signBuyProductTransaction } from './series1-buy.js';
import { ensureSiwsSession } from './siws.js';
import {
  buildReceiptSuccessHtml,
  buildReceiptGatedHtml,
  buildReceiptErrorHtml,
} from './rip-receipt.js';

function hostFromUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try { return new URL(value).host; } catch { return null; }
}

function originFromUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  try { return new URL(value).origin; } catch { return null; }
}

function hostsAllowedForSiws(runtime) {
  const out = new Set();
  if (typeof location !== 'undefined' && location.host) out.add(location.host);
  const sites = [
    runtime?.publicSiteOrigin,
    runtime?.siteOrigin,
    runtime?.walletSiteOrigin,
  ];
  for (const v of sites) {
    const host = hostFromUrl(v);
    if (host) out.add(host);
  }
  return Array.from(out);
}

function originsAllowedForSiws(runtime) {
  const out = new Set();
  if (typeof location !== 'undefined' && location.origin) out.add(location.origin);
  const sites = [
    runtime?.publicSiteOrigin,
    runtime?.siteOrigin,
    runtime?.walletSiteOrigin,
  ];
  for (const v of sites) {
    const origin = originFromUrl(v);
    if (origin) out.add(origin);
  }
  return Array.from(out);
}

function spcnPreview(productType, quantity, hasAffiliate) {
  try {
    return spanielCoinIssuanceForProductPurchase({
      productType,
      quantity: Math.max(1, quantity | 0),
      hasValidDirectAffiliate: !!hasAffiliate,
    });
  } catch {
    return {
      buyerAmount: 0n,
      treasuryMatchAmount: 0n,
      directAffiliateAmount: 0n,
      totalIssued: 0n,
    };
  }
}

export async function mount(target, ctx) {
  const runtimePromise = loadRuntimeConfig().catch((e) => ({ _error: e.message }));
  target.innerHTML = `
    <h1 class="app-title">Rip</h1>
    <p class="app-subtitle">Rip a Single, Pack, Box, Crate, or Vault from the Series 1 inventory.</p>

    <section class="app-section" id="rip-network">
      <h2 class="app-section-title">Network</h2>
      <div class="app-row"><span class="app-row-label">Cluster</span><span class="app-row-value" id="rip-cluster">loading…</span></div>
      <div class="app-row"><span class="app-row-label">RPC</span><span class="app-row-value" style="font-family:'DM Mono',monospace;font-size:12px;word-break:break-all" id="rip-rpc">loading…</span></div>
      <div class="app-row"><span class="app-row-label">Series 1 Program</span><span class="app-row-value" style="font-family:'DM Mono',monospace;font-size:12px;word-break:break-all" id="rip-program">loading…</span></div>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Pick a product</h2>
      <form id="quoteForm">
        <label class="app-label" for="productType">Product</label>
        <select class="app-input" id="productType">
          <option value="single">Single Card Pull — 1 draw slot</option>
          <option value="pack">Pack — 10 draw slots</option>
          <option value="box" selected>Box — 240 draw slots (6.9% bundle discount)</option>
          <option value="crate">Crate — 2,400 draw slots (10% bundle discount)</option>
          <option value="vault">Vault — 24,000 draw slots (16.9% bundle discount)</option>
        </select>
        <label class="app-label" for="quantity" style="margin-top: 8px">Quantity</label>
        <input class="app-input" id="quantity" type="number" min="1" max="100" value="1">
        <label class="app-checkbox" style="display:block; margin-top:8px">
          <input type="checkbox" id="hasAffiliate"> Using a Barklink referral
        </label>
        <div id="spcnPreview" class="app-preview" style="margin-top: 8px; font-size: 13px"></div>
        <div style="height: 12px"></div>
        <div class="app-btn-row">
          <button class="app-btn" type="submit" ${ctx.unlocked ? '' : 'disabled'}>Request signed quote</button>
          <button class="app-btn app-btn-primary" type="button" id="rip-submit" disabled>Sign &amp; submit to devnet</button>
        </div>
      </form>
      ${ctx.unlocked ? '' : '<p class="app-pending" style="margin-top: 8px">Unlock the Spaniel Wallet to request a quote.</p>'}
      <p class="app-pending" style="margin-top: 8px">Paid Series 1 cards earn SpanielCoin. Redemption draws do not. Maximum possible SpanielCoin supply is 3,000,000,000.</p>
    </section>

    <section class="app-section" id="quoteOut" hidden>
      <h2 class="app-section-title">Signed quote</h2>
      <pre id="quotePre" class="app-pre"></pre>
    </section>

    <section class="app-section" id="rip-gate" hidden>
      <h2 class="app-section-title">Devnet readiness</h2>
      <p class="app-pending" id="rip-gate-msg"></p>
    </section>

    <section class="app-section" id="rip-preview" hidden>
      <h2 class="app-section-title">Transaction preview</h2>
      <pre id="rip-preview-pre" class="app-pre"></pre>
    </section>

    <section class="app-section" id="rip-tx" hidden>
      <h2 class="app-section-title">Submission</h2>
      <p id="rip-tx-status" class="app-pending"></p>
      <p id="rip-tx-link"></p>
    </section>

    <section class="app-section" id="rip-receipt" hidden>
      <h2 class="app-section-title">Receipt</h2>
      <div id="rip-receipt-body"></div>
    </section>
  `;

  const productEl = target.querySelector('#productType');
  const quantityEl = target.querySelector('#quantity');
  const affiliateEl = target.querySelector('#hasAffiliate');
  const previewEl = target.querySelector('#spcnPreview');
  const quoteOut = target.querySelector('#quoteOut');
  const quotePre = target.querySelector('#quotePre');
  const submitBtn = target.querySelector('#rip-submit');
  const gateSection = target.querySelector('#rip-gate');
  const gateMsg = target.querySelector('#rip-gate-msg');
  const previewSection = target.querySelector('#rip-preview');
  const previewPre = target.querySelector('#rip-preview-pre');
  const txSection = target.querySelector('#rip-tx');
  const txStatus = target.querySelector('#rip-tx-status');
  const txLink = target.querySelector('#rip-tx-link');
  const receiptSection = target.querySelector('#rip-receipt');
  const receiptBody = target.querySelector('#rip-receipt-body');

  function setGate(message) {
    if (!message) {
      gateSection.hidden = true;
      gateMsg.textContent = '';
      return;
    }
    gateSection.hidden = false;
    gateMsg.textContent = message;
  }

  let lastQuote = null;
  let rpcClient = null;
  let runtime = null;
  let cluster = '?';

  function refreshPreview() {
    const t = productEl.value;
    const qty = clampQuantity(quantityEl.value);
    const hasAff = !!affiliateEl.checked;
    const issuance = spcnPreview(t, qty, hasAff);
    const affiliateLine = hasAff
      ? `<li>Direct affiliate receives <strong>${issuance.directAffiliateAmount.toString()}</strong> SpanielCoin (Barklink referral).</li>`
      : `<li>No direct affiliate — no Direct Affiliate Coin minted.</li>`;
    previewEl.innerHTML = `
      <p style="margin: 0 0 6px 0"><strong>SpanielCoin issuance preview</strong> (per paid primary purchase):</p>
      <ul style="margin: 0; padding-left: 18px">
        <li>Buyer receives <strong>${issuance.buyerAmount.toString()}</strong> SpanielCoin (1 per draw slot).</li>
        <li>Treasury Match unlocks <strong>${issuance.treasuryMatchAmount.toString()}</strong> SpanielCoin under the project’s treasury policy.</li>
        ${affiliateLine}
      </ul>
      <p style="margin: 6px 0 0 0; color: var(--muted)">Total minted on this purchase: ${issuance.totalIssued.toString()} SpanielCoin. Redemption draws, secondary trades, and offer accepts mint 0 SpanielCoin.</p>
    `;
  }
  productEl.addEventListener('change', refreshPreview);
  quantityEl.addEventListener('input', refreshPreview);
  affiliateEl.addEventListener('change', refreshPreview);
  refreshPreview();

  // Network panel: bind once.
  runtime = await runtimePromise;
  if (runtime && runtime._error) {
    target.querySelector('#rip-cluster').textContent = '?';
    target.querySelector('#rip-rpc').textContent = `runtime-config.json load failed: ${runtime._error}`;
    target.querySelector('#rip-program').textContent = '—';
    setGate('runtime-config.json failed to load — buy disabled.');
    runtime = null;
  } else if (runtime) {
    cluster = runtime.cluster || (runtime.rpcUrl?.includes('devnet') ? 'devnet' : '?');
    target.querySelector('#rip-cluster').textContent = cluster;
    target.querySelector('#rip-rpc').textContent = runtime.rpcUrl || '<unset>';
    target.querySelector('#rip-program').textContent = runtime.series1ProgramId || 'not deployed';
    try {
      assertNotProductionRpc(runtime.rpcUrl, { allowMainnet: false });
      if (runtime.rpcUrl) rpcClient = makeRpcClient(runtime.rpcUrl);
    } catch (e) {
      setGate(`Refusing live submit: ${e.message}`);
    }
    if (runtime.pendingProgramDeployment) {
      setGate('Series 1 Program deployment pending (runtime-config.pendingProgramDeployment=true). Submit disabled.');
    } else if (!runtime.series1ProgramId) {
      setGate('Series 1 Program id missing in runtime-config.json. Submit disabled.');
    }
  }

  target.querySelector('#quoteForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!ctx.unlocked) return;
    submitBtn.disabled = true;
    const productType = productEl.value;
    const quantity = clampQuantity(quantityEl.value);
    quoteOut.hidden = false;
    quotePre.textContent = 'Requesting quote…';
    previewSection.hidden = true;
    txSection.hidden = true;
    try {
      const body = { buyerWallet: ctx.unlocked.activePubkey, productType, quantity };
      // Resolve the Worker base from runtime-config so the fetch works
      // regardless of which origin serves this page (same-origin /app,
      // a future spanielwallet.com host, or a devnet/staging Worker
      // under its own subdomain).
      await ensureRuntimeConfig(loadRuntimeConfig).catch(() => null);
      const res = await fetch(apiUrl('/api/products/quote'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      quotePre.textContent = JSON.stringify(data, null, 2);
      if (!res.ok || data.gated) {
        const reason = data?.reason || data?.code || `HTTP ${res.status}`;
        setGate(`Quote not usable: ${reason}`);
        lastQuote = null;
        return;
      }
      lastQuote = data;
      // Try to derive a preview now; if the builder rejects (e.g.
      // PROGRAM_PENDING), surface the gate but keep the quote shown.
      // The preview path uses `buildBuyProductMessage` (no signing)
      // — feeding a placeholder seed through `signBuyProductTransaction`
      // here would compute a real (but useless) ed25519 signature on
      // the all-zeros seed and waste cycles. The submit path below
      // does the actual signing with the buyer's seed.
      try {
        const built = buildBuyProductMessage({
          runtimeConfig: runtime || {},
          quote: lastQuote,
          buyerWallet: ctx.unlocked.activePubkey,
          // Recent-blockhash placeholder; we don't submit this preview.
          // The fee-payer signature is never produced — only the
          // structural account list + canonical bytes are surfaced.
          recentBlockhashBase58: SYSTEM_PROGRAM_ID,
        });
        previewSection.hidden = false;
        previewPre.textContent = JSON.stringify(serializePreviewFromBuilt(built), null, 2);
        // Real submission requires a live blockhash and a real RPC.
        if (rpcClient) {
          submitBtn.disabled = false;
          setGate('');
        } else {
          setGate('RPC unavailable — submit disabled.');
        }
      } catch (e) {
        previewSection.hidden = true;
        setGate(`Buy disabled: ${e.message || 'unknown'} (code=${e.code || 'unknown'}).`);
      }
    } catch (e) {
      quotePre.textContent = 'Worker unavailable: ' + (e?.message || 'unknown error');
    }
  });

  submitBtn.addEventListener('click', async () => {
    if (!ctx.unlocked || !lastQuote || !rpcClient) return;
    submitBtn.disabled = true;
    txSection.hidden = false;
    txStatus.textContent = 'fetching recent blockhash…';
    txLink.textContent = '';
    try {
      const active = ctx.unlocked.accounts.find((a) => a.pubkeyBase58 === ctx.unlocked.activePubkey)
        || ctx.unlocked.accounts[0];
      const { blockhash } = await rpcClient.getLatestBlockhash();
      txStatus.textContent = 'building and signing transaction…';
      const signed = signBuyProductTransaction({
        runtimeConfig: runtime,
        quote: lastQuote,
        account: active,
        recentBlockhashBase58: blockhash,
      });
      txStatus.textContent = 'submitting to devnet RPC…';
      const sig = await rpcClient.sendRawTransaction(signed.txBase58, { encoding: 'base58' });
      txStatus.innerHTML = `submitted: <code>${escapeHtml(sig)}</code> · awaiting confirmation…`;
      txLink.innerHTML = `<a href="${escapeHtml(getExplorerTxLink(sig, cluster))}" target="_blank" rel="noopener">explorer ↗</a>`;
      const conf = await rpcClient.confirmSignature(sig, { timeoutMs: 90_000 });
      if (!conf.confirmed) {
        txStatus.innerHTML = `not confirmed within 90s (${escapeHtml(JSON.stringify(conf.err))}). The signature is still on the network — see explorer.`;
        return;
      }
      txStatus.innerHTML = `confirmed at slot ${conf.slot}. signing in to record purchase…`;
      try {
        // SIWS: ensure the buyer wallet has an authenticated session
        // BEFORE calling /api/products/record. The Worker rejects
        // unauthenticated record calls with 403 (S-1 hardening).
        //
        // Domain-binding: assert the SIWS message host matches the
        // current document host AND the configured marketing-site
        // origin (the Worker's `cfg.publicSiteUrl`). Both are
        // accepted because the wallet can legitimately be served at
        // a different origin than the site that requested sign-in.
        const session = await ensureSiwsSession({
          wallet: active.pubkeyBase58,
          seed: active.seed,
          allowedHosts: hostsAllowedForSiws(runtime),
          allowedUriOrigins: originsAllowedForSiws(runtime),
        });
        const authVerb = session.reused ? 'reused session' : 'signed in';
        txStatus.innerHTML = `confirmed at slot ${conf.slot}. ${authVerb}; recording with Worker…`;
      } catch (e) {
        txStatus.innerHTML += `<br>SIWS sign-in failed: ${escapeHtml(e.message || 'unknown')}. Purchase landed on-chain but the Worker record could not be written.`;
        return;
      }
      try {
        const recRes = await fetch(apiUrl('/api/products/record'), {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'prod',
            txSignature: sig,
            quoteNonce: lastQuote.quoteNonce,
          }),
        });
        const recBody = await recRes.json();
        if (!recRes.ok) {
          txStatus.innerHTML += `<br>worker record HTTP ${recRes.status}: ${escapeHtml(recBody?.reason || recBody?.code || 'unknown')}.`;
          renderReceiptError(receiptSection, receiptBody, lastQuote, sig, cluster, recBody);
        } else if (recBody.gated) {
          txStatus.innerHTML += `<br>worker record gated: ${escapeHtml(recBody.reason || recBody.code || 'unknown')}.`;
          renderReceiptGated(receiptSection, receiptBody, lastQuote, sig, cluster, recBody);
        } else {
          txStatus.innerHTML += `<br>recorded purchase <code>${escapeHtml(recBody.purchaseId)}</code>.`;
          renderReceiptSuccess(receiptSection, receiptBody, lastQuote, sig, cluster, recBody);
          // Tell the rest of the PWA (wallet/binder pages) to refresh.
          window.dispatchEvent(new CustomEvent('spaniel:purchase-recorded', {
            detail: {
              wallet: active.pubkeyBase58,
              txSignature: sig,
              purchaseId: recBody.purchaseId,
              cluster,
            },
          }));
        }
      } catch (e) {
        txStatus.innerHTML += `<br>worker record failed: ${escapeHtml(e.message || 'unknown')}.`;
      }
    } catch (e) {
      txStatus.textContent = `submit failed: ${e.message || 'unknown'}`;
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ─── helpers ────────────────────────────────────────────────────

function serializePreviewFromBuilt(built) {
  // Avoid dumping internal Uint8Array fields.
  return {
    productType: built.productType,
    quantity: built.quantity,
    startDrawSlot: built.startDrawSlot,
    endDrawSlot: built.endDrawSlot,
    drawSlotsConsumed: built.drawSlotsConsumed,
    accountCount: Array.isArray(built.compiled?.accountKeysB58)
      ? built.compiled.accountKeysB58.length
      : 0,
    seriesStatePda: built.derived?.seriesStatePda,
    spanielCoinAuthorityPda: built.derived?.spanielCoinAuthorityPda,
    buyerSpanielCoinAta: built.derived?.buyerSpanielCoinAta,
    treasurySpanielCoinAta: built.derived?.treasurySpanielCoinAta,
    affiliateSpanielCoinAta: built.derived?.affiliateSpanielCoinAta,
    productStatePda: built.productStatePda,
    sealedWrapper: !!built.productStatePda,
    instructionCount: Array.isArray(built.instructions) ? built.instructions.length : 0,
    spanielCoinIssued: built.spanielCoinIssued,
    serializedTxSize: built.serializedTxSize,
  };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Receipt rendering ─────────────────────────────────────────────
// Three states routed through pure helpers in rip-receipt.js. The
// helpers return HTML strings; we bind them to the DOM here.

function renderReceiptSuccess(section, body, quote, sig, cluster, rec) {
  section.hidden = false;
  body.innerHTML = buildReceiptSuccessHtml({ quote, txSignature: sig, cluster, rec });
}

function renderReceiptGated(section, body, quote, sig, cluster, rec) {
  section.hidden = false;
  body.innerHTML = buildReceiptGatedHtml({ quote, txSignature: sig, cluster, rec });
}

function renderReceiptError(section, body, quote, sig, cluster, rec) {
  section.hidden = false;
  body.innerHTML = buildReceiptErrorHtml({ quote, txSignature: sig, cluster, rec });
}
