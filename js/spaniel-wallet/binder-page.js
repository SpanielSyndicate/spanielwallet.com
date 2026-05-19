// Spaniel Wallet PWA — /binder page.
//
// Shows the connected wallet's revealed cards. Uses the existing
// /api/binder/:wallet/cards endpoint when the Worker is online. Each
// card thumbnail renders via the shared SVG renderer.
//
// Also surfaces the Redemption Draw builder: pick cards (+/- sealed
// products) and SpanielCoin to burn → preview burn unit, cardUnits /
// coinUnits split, expected redemption draws (cards set the base;
// coins can boost up to 2x), and warnings. Destructive actions
// require explicit confirmation; severe-warning items must be
// acknowledged before record.

import { renderCardFrontSvg } from '/js/lib/card-rendering.js';
import { apiUrl } from './api-url.js';
import { loadRuntimeConfig } from './runtime-config.js';
import { makeRpcClient } from './rpc.js';
import { ensureSiwsSession } from './siws.js';
import { getExplorerTxLink } from '/js/lib/solana-networks.js';
import {
  checkOpenReadiness,
  buildSignedOpenProductTransaction,
} from './series1-open.js';
import { findProgramAddress } from '/js/wallet-core/pda.js';
import { SERIES1_SEEDS } from '/js/lib/series1-program.js';

function hostFromUrl(v) { try { return new URL(v).host; } catch { return null; } }
function originFromUrl(v) { try { return new URL(v).origin; } catch { return null; } }
function hostsAllowedForSiws(runtime) {
  const out = new Set();
  if (typeof location !== 'undefined' && location.host) out.add(location.host);
  for (const v of [runtime?.publicSiteOrigin, runtime?.siteOrigin, runtime?.walletSiteOrigin]) {
    const h = hostFromUrl(v); if (h) out.add(h);
  }
  return Array.from(out);
}
function originsAllowedForSiws(runtime) {
  const out = new Set();
  if (typeof location !== 'undefined' && location.origin) out.add(location.origin);
  for (const v of [runtime?.publicSiteOrigin, runtime?.siteOrigin, runtime?.walletSiteOrigin]) {
    const o = originFromUrl(v); if (o) out.add(o);
  }
  return Array.from(out);
}

function deriveSeriesStatePda(programId, seriesId = 's1') {
  const seriesBytes = new Uint8Array(4);
  for (let i = 0; i < Math.min(seriesId.length, 4); i++) seriesBytes[i] = seriesId.charCodeAt(i) & 0xff;
  return findProgramAddress([SERIES1_SEEDS.SERIES, seriesBytes], programId).pubkeyBase58;
}

export async function mount(target, ctx) {
  const pubkey = ctx.unlocked?.activePubkey;
  if (!pubkey) {
    target.innerHTML = `
      <h1 class="app-title">Binder</h1>
      <p class="app-subtitle">Your revealed Series 1 cards will appear here, rendered as full trading cards.</p>
      <section class="app-section">
        <p class="app-pending">Unlock your Spaniel Wallet to load your binder. You can also paste an external wallet address below to view its binder (read-only).</p>
        <label class="app-label" for="externalAddr">External wallet</label>
        <input class="app-input" id="externalAddr" type="text" placeholder="Paste a Solana address">
        <div style="height: 8px"></div>
        <button class="app-btn" id="extBtn">Load external binder</button>
      </section>
      <div id="binderList"></div>
    `;
    target.querySelector('#extBtn').addEventListener('click', () => {
      const a = target.querySelector('#externalAddr').value.trim();
      if (a) loadBinder(target, a, 'external');
    });
    return;
  }

  target.innerHTML = `
    <h1 class="app-title">Binder</h1>
    <p class="app-subtitle">Cards and sealed products owned by <code>${shortHtml(pubkey)}</code>.</p>

    <section class="app-section">
      <h2 class="app-section-title">Sealed products</h2>
      <div id="sealedList" aria-live="polite"><p class="app-loading">Loading sealed products…</p></div>
      <p class="app-pending" style="margin-top: 8px">Open mints one Bubblegum cNFT per click on the configured devnet tree. Pack/Box/Crate drain one card at a time — click Open again to reveal the next slot.</p>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Burn cards + SpanielCoin to rip again</h2>
      <div id="redemptionPanel" aria-live="polite">
        <p class="app-loading">Loading redemption configuration…</p>
      </div>
      <p class="app-pending" style="margin-top: 8px">Burned cards are permanently retired. Redemption draws do not mint SpanielCoin. Cards set your base redemption units; extra SpanielCoin can boost output up to 2x. There is no 4x / 8x tier and no quadratic curve.</p>
    </section>

    <section class="app-section">
      <h2 class="app-section-title">Revealed cards</h2>
      <div id="binderList"><p class="app-loading">Loading…</p></div>
    </section>
  `;
  await Promise.all([
    loadSealedProducts(target, pubkey, ctx),
    loadRedemptionPanel(target, pubkey),
    loadBinder(target, pubkey, 'self'),
  ]);

  // Refresh sealed list + revealed cards after a successful purchase.
  // The rip page dispatches `spaniel:purchase-recorded` on the window.
  const onPurchaseRecorded = (ev) => {
    if (ev?.detail?.wallet && ev.detail.wallet !== pubkey) return;
    loadSealedProducts(target, pubkey, ctx);
    loadBinder(target, pubkey, 'self');
  };
  window.addEventListener('spaniel:purchase-recorded', onPurchaseRecorded);
}

// ─── Sealed products ─────────────────────────────────────────────
//
// /api/binder/:wallet/products returns the wallet's currently-held
// sealed products. Each row now carries an "Open" action that posts
// /api/products/open/quote to learn whether the Bubblegum tree is
// configured for this cluster. When it is, the row builds + submits
// a real open_product tx (one Single per click — Pack/Box opens
// batch one tx per card; see ASSET_CPI_PLAN.md §"Transaction-size
// envelope"). When the tree (or program) is missing, the row shows
// a gated badge and the Open button stays disabled.

async function loadSealedProducts(target, wallet, ctx) {
  const panel = target.querySelector('#sealedList');
  if (!panel) return;
  try {
    const res = await fetch(apiUrl(`/api/binder/${encodeURIComponent(wallet)}/products`), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`worker returned ${res.status}`);
    const body = await res.json();
    const products = Array.isArray(body.products) ? body.products : [];
    if (products.length === 0) {
      panel.innerHTML = '<p class="app-pending">No sealed products owned by this wallet yet. Rip a Pack/Box/Crate/Vault on the Rip page.</p>';
      return;
    }
    const rows = products.map((p) => {
      const sealedLabel = p.state === 'sealed' ? 'sealed' : escapeHtml(p.state);
      const canOpen = p.state === 'sealed' || p.state === 'opening';
      const openBtn = canOpen
        ? `<button class="app-btn" data-open-id="${escapeHtml(p.id)}" style="margin-top:6px">Open</button>`
        : '';
      return `
        <div class="app-sealed-row" data-sealed-id="${escapeHtml(p.id)}" style="display: grid; gap: 4px; padding: 8px 0; border-bottom: 1px solid var(--rule)">
          <div class="app-row"><span class="app-row-label">Product</span><span class="app-row-value" style="font-family:'DM Mono',monospace">${escapeHtml(String(p.product_type)).toUpperCase()}</span></div>
          <div class="app-row"><span class="app-row-label">State</span><span class="app-row-value">${sealedLabel}</span></div>
          <div class="app-row"><span class="app-row-label">Draws</span><span class="app-row-value">${escapeHtml(String(p.draw_slot_count))} slots starting at ${escapeHtml(String(p.draw_slot_start))}</span></div>
          <div class="app-row"><span class="app-row-label">Asset id</span><span class="app-row-value" style="font-family:'DM Mono',monospace;font-size:12px;word-break:break-all"><code>${escapeHtml(p.asset_id || '')}</code></span></div>
          <div class="app-row"><span class="app-row-label">Sealed product id</span><span class="app-row-value" style="font-family:'DM Mono',monospace;font-size:12px;word-break:break-all"><code>${escapeHtml(p.id)}</code></span></div>
          ${openBtn}
          <div class="app-open-status" data-open-status-for="${escapeHtml(p.id)}" style="font-size:12px;color:var(--muted);margin-top:4px"></div>
        </div>
      `;
    }).join('');
    panel.innerHTML = rows;
    // Bind Open click handlers. Each Single click runs the full
    // open quote → build → submit → record pipeline. Pack/Box runs
    // one batch per click (the Worker open quote handles batch_index
    // bookkeeping via `batch_size` defaulting to the product cap).
    panel.querySelectorAll('button[data-open-id]').forEach((btn) => {
      btn.addEventListener('click', () => onOpenClicked(panel, target, wallet, ctx, {
        sealedProductId: btn.getAttribute('data-open-id'),
        button: btn,
      }));
    });
  } catch (e) {
    panel.innerHTML = `<p class="app-pending">Sealed products unavailable: ${escapeHtml(e.message || 'unknown error')}.</p>`;
  }
}

async function onOpenClicked(panel, target, wallet, ctx, { sealedProductId, button }) {
  const statusEl = panel.querySelector(`[data-open-status-for="${cssEscape(sealedProductId)}"]`);
  function setStatus(html, isError = false) {
    if (!statusEl) return;
    statusEl.innerHTML = html;
    statusEl.style.color = isError ? 'var(--danger, #c00)' : 'var(--muted)';
  }
  button.disabled = true;
  try {
    const active = ctx?.unlocked?.accounts?.find((a) => a.pubkeyBase58 === wallet)
      || ctx?.unlocked?.accounts?.[0];
    if (!active?.seed) {
      setStatus('Open requires an unlocked Spaniel Wallet.', true);
      return;
    }

    setStatus('fetching open quote…');
    const qres = await fetch(apiUrl('/api/products/open/quote'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sealedProductId,
        openerWallet: wallet,
        mode: 'prod',
        // Match OPEN_PRODUCT_MAX_CARDS_PER_TX on chain; Pack/Box drain
        // by repeated clicks with successive batchIndex.
        batchSize: 1,
      }),
    });
    const openQuote = await qres.json();
    if (openQuote.gated) {
      setStatus(`Open gated: <code>${escapeHtml(openQuote.code || 'GATED')}</code>${openQuote.reason ? ` — ${escapeHtml(openQuote.reason)}` : ''}`, true);
      return;
    }
    const runtime = await loadRuntimeConfig();
    const readiness = checkOpenReadiness({ runtimeConfig: runtime, openQuote });
    if (!readiness.ready) {
      setStatus(`Open not ready: <code>${escapeHtml(readiness.code || 'NOT_READY')}</code>${readiness.reason ? ` — ${escapeHtml(readiness.reason)}` : ''}`, true);
      return;
    }

    setStatus('building open tx…');
    const seriesStatePda = deriveSeriesStatePda(runtime.series1ProgramId, openQuote.cards?.[0]?.cardKey?.startsWith('s1') ? 's1' : 's1');
    const rpcClient = makeRpcClient(runtime.rpcUrl);
    const { blockhash } = await rpcClient.getLatestBlockhash();
    const signed = buildSignedOpenProductTransaction({
      programId: runtime.series1ProgramId,
      quoteSignerBase58: runtime.quoteSignerPubkey,
      openQuote,
      accountsArgs: {
        openerWallet: wallet,
        seriesStatePda,
        productStatePda: openQuote.sealedProductAsset,
        treeConfigPda: openQuote.cnft.treeAuthority,
        merkleTree: openQuote.cnft.treeAddress,
      },
      openerSeed: active.seed,
      recentBlockhash: blockhash,
    });

    setStatus('submitting to devnet RPC…');
    const sig = await rpcClient.sendRawTransaction(signed.signedTxBase58, { encoding: 'base58' });
    const cluster = runtime.cluster || (runtime.rpcUrl?.includes('devnet') ? 'devnet' : 'mainnet-beta');
    const explorerHtml = `<a href="${escapeHtml(getExplorerTxLink(sig, cluster))}" target="_blank" rel="noopener">explorer ↗</a>`;
    setStatus(`submitted <code>${escapeHtml(sig)}</code> — awaiting confirmation… ${explorerHtml}`);

    const conf = await rpcClient.confirmSignature(sig, { timeoutMs: 90_000 });
    if (!conf.confirmed) {
      setStatus(`not confirmed within 90s (${escapeHtml(JSON.stringify(conf.err))}). ${explorerHtml}`, true);
      return;
    }
    setStatus(`confirmed slot ${conf.slot}. signing in to record reveal… ${explorerHtml}`);

    await ensureSiwsSession({
      wallet,
      seed: active.seed,
      allowedHosts: hostsAllowedForSiws(runtime),
      allowedUriOrigins: originsAllowedForSiws(runtime),
    });

    const recRes = await fetch(apiUrl('/api/products/open/record'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'prod',
        sealedProductId,
        openerWallet: wallet,
        txSignature: sig,
        batchIndex: 0,
        batchSize: 1,
      }),
    });
    const recBody = await recRes.json();
    if (!recRes.ok) {
      setStatus(`record HTTP ${recRes.status}: ${escapeHtml(recBody?.reason || recBody?.code || 'unknown')}. ${explorerHtml}`, true);
      return;
    }
    if (recBody.gated) {
      setStatus(`record gated: ${escapeHtml(recBody.reason || recBody.code || 'unknown')}. ${explorerHtml}`, true);
      return;
    }
    setStatus(
      `opened — revealed <code>${escapeHtml(recBody.bestCardKey || 'card')}</code>${recBody.bestVariant ? ' (' + escapeHtml(recBody.bestVariant) + ')' : ''}. ${explorerHtml}`
    );
    // Refresh sealed list + revealed cards.
    loadSealedProducts(target, wallet, ctx);
    loadBinder(target, wallet, 'self');
  } catch (e) {
    setStatus(`Open failed: ${escapeHtml(e.message || 'unknown error')}`, true);
  } finally {
    button.disabled = false;
  }
}

function cssEscape(s) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s);
  }
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c);
}

async function loadRedemptionPanel(target, wallet) {
  const panel = target.querySelector('#redemptionPanel');
  if (!panel) return;
  try {
    const [configRes, balanceRes] = await Promise.all([
      fetch(apiUrl('/api/redemptions/config'), { headers: { Accept: 'application/json' } }),
      fetch(apiUrl(`/api/spanielcoin/balance/${encodeURIComponent(wallet)}`), { headers: { Accept: 'application/json' } })
    ]);
    if (!configRes.ok) throw new Error(`config returned ${configRes.status}`);
    const config = await configRes.json();
    const balance = balanceRes.ok ? await balanceRes.json() : { balance: '0', symbol: 'SPCN' };
    const burnUnit = config.burnUnit ?? '8';
    const maxBoost = config.maxCoinBoostMultiplier ?? 2;
    // Quick worked examples calibrated to the current burnUnit so the
    // user can see the cards/coins split before submitting.
    const burnUnitNum = Number(burnUnit) || 8;
    const example1Cards = burnUnitNum;
    const example1Coins = burnUnitNum;
    const example2Cards = burnUnitNum * 2;
    const example2Coins = burnUnitNum * 2;
    const example3Cards = burnUnitNum * 2;
    const example3Coins = burnUnitNum * 4;
    panel.innerHTML = `
      <div class="app-row">
        <span class="app-row-label">Current burn unit</span>
        <span class="app-row-value" style="font-family: 'DM Mono', monospace">${escapeHtml(burnUnit)} cards = 1 cardUnit (and ${escapeHtml(burnUnit)} SpanielCoin = 1 coinUnit)</span>
      </div>
      <div class="app-row">
        <span class="app-row-label">Current draw price (USD)</span>
        <span class="app-row-value" style="font-family: 'DM Mono', monospace">$${escapeHtml((config.currentDrawPriceUsd ?? 0).toFixed(6))}</span>
      </div>
      <div class="app-row">
        <span class="app-row-label">Redemption draws</span>
        <span class="app-row-value">= min(cardUnits × ${escapeHtml(String(maxBoost))}, coinUnits)</span>
      </div>
      <div class="app-row">
        <span class="app-row-label">Coin boost ceiling</span>
        <span class="app-row-value">cards set the base; extra SpanielCoin can boost output up to ${escapeHtml(String(maxBoost))}x</span>
      </div>
      <div class="app-row">
        <span class="app-row-label">Per-transaction cap</span>
        <span class="app-row-value">${escapeHtml(String(config.maxRedemptionDrawsPerTx))} redemption draws</span>
      </div>
      <div class="app-row">
        <span class="app-row-label">Your SpanielCoin</span>
        <span class="app-row-value" style="font-family: 'DM Mono', monospace">${escapeHtml(balance.balance ?? '0')} ${escapeHtml(balance.symbol ?? 'SPCN')}</span>
      </div>
      <details style="margin-top: 8px">
        <summary>Examples at the current burnUnit</summary>
        <ul style="margin: 6px 0 0 0; padding-left: 18px; font-family: 'DM Mono', monospace; font-size: 12px">
          <li>${example1Cards} cards + ${example1Coins} SpanielCoin = 1 redemption draw</li>
          <li>${example1Cards} cards + ${example1Coins * 2} SpanielCoin = 2 redemption draws</li>
          <li>${example2Cards} cards + ${example2Coins} SpanielCoin = 2 redemption draws (NOT 4)</li>
          <li>${example3Cards} cards + ${example3Coins} SpanielCoin = 4 redemption draws</li>
        </ul>
      </details>
      <form id="redemptionForm" style="margin-top: 8px">
        <label class="app-label" for="redemptionCards">Card instance ids or card keys (one per line)</label>
        <textarea class="app-input" id="redemptionCards" rows="4" placeholder="paste burnable card ids — common duplicates are safest"></textarea>
        <label class="app-label" for="redemptionCoins" style="margin-top: 8px">SpanielCoin to burn</label>
        <input class="app-input" id="redemptionCoins" type="number" min="0" step="1" value="0">
        <label class="app-checkbox" style="display:block; margin-top:8px">
          <input type="checkbox" id="severeAck"> I understand burned cards are permanently retired and cannot be recovered.
        </label>
        <div style="height: 8px"></div>
        <button class="app-btn app-btn-primary" type="submit">Preview redemption</button>
      </form>
      <pre id="redemptionPreview" class="app-pre" hidden style="margin-top: 12px"></pre>
      <p class="app-pending" style="margin-top: 8px">${escapeHtml(config.copy?.noSpanielCoinNotice ?? 'Redemption draws do not mint SpanielCoin. Only paid primary draws do.')}</p>
      ${config.pendingProgramDeployment ? '<p class="app-gated" style="margin-top: 8px">Series 1 Program asset burn/mint CPI not yet deployed — production redemption stays gated. Preview works against the mock manifest only.</p>' : ''}
    `;
    panel.querySelector('#redemptionForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await previewRedemption(target, wallet);
    });
  } catch (e) {
    panel.innerHTML = `<p class="app-pending">Redemption config unavailable: ${escapeHtml(e.message || 'unknown error')}.</p>`;
  }
}

async function previewRedemption(target, wallet) {
  const out = target.querySelector('#redemptionPreview');
  out.hidden = false;
  out.textContent = 'Requesting redemption quote…';
  const cards = target.querySelector('#redemptionCards').value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const coins = (target.querySelector('#redemptionCoins').value || '0').toString();
  try {
    const res = await fetch(apiUrl('/api/redemptions/quote'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        wallet,
        burnItems: cards.map((id) => ({ assetType: 'card', assetId: id })),
        spanielCoinOffered: coins
      })
    });
    const body = await res.json();
    if (!res.ok) {
      const reasonCode = body?.details?.redemptionCode || body?.code || 'BAD_REQUEST';
      const friendly = redemptionRejectionMessage(reasonCode);
      out.textContent = friendly + '\n\n' + JSON.stringify(body, null, 2);
      return;
    }
    const lines = [
      `Burn unit            : ${body.burnUnit} (cards = ${body.burnUnit}, coins = ${body.burnUnit} per unit)`,
      `Cards offered        : ${body.cardsBurned} = ${body.cardUnits} cardUnits`,
      `SpanielCoin offered  : ${body.spanielCoinOffered} = ${body.coinUnits} coinUnits`,
      `Coin boost           : ${body.coinBoostMultiplier}x (max ${body.maxCoinBoostMultiplier}x)`,
      `Redemption draws     : ${body.redemptionDraws}  (draw slots ${body.drawSlotStart}..${body.drawSlotEnd})`,
      `SpanielCoin minted   : ${body.spanielCoinIssued} (redemption draws do not mint SpanielCoin)`
    ];
    out.textContent = lines.join('\n') + '\n\n' + JSON.stringify(body, null, 2);
  } catch (e) {
    out.textContent = 'Worker unavailable: ' + (e?.message || 'unknown error');
  }
}

function redemptionRejectionMessage(code) {
  switch (code) {
    case 'INSUFFICIENT_SPANIELCOIN_BALANCE':
      return 'You do not hold enough SpanielCoin to burn the requested amount.';
    case 'INSUFFICIENT_BURN_MATERIAL':
      return 'Not enough cards to make even 1 cardUnit at the current burn unit.';
    case 'INSUFFICIENT_SPANIELCOIN_BOOST':
      return 'You need at least as many coinUnits as cardUnits to redeem. Add more SpanielCoin or remove cards.';
    case 'COIN_OVERBURN':
      return 'Too much SpanielCoin: coins can boost up to 2x the card base — anything beyond that is wasted.';
    case 'CARD_LEFTOVER':
      return 'Cards offered is not a whole multiple of the burn unit — submit cards in burn-unit batches to avoid retiring more than needed.';
    case 'COIN_LEFTOVER':
      return 'SpanielCoin offered is not a whole multiple of the burn unit — round it to the nearest burn unit.';
    case 'REDEMPTION_BATCH_TOO_LARGE':
      return 'Burn batch too large — split it into multiple redemptions under the 420-draw cap.';
    default:
      return 'Redemption rejected.';
  }
}

async function loadBinder(target, wallet, kind) {
  const list = target.querySelector('#binderList');
  list.innerHTML = '<p class="app-loading">Loading binder…</p>';
  try {
    const res = await fetch(apiUrl(`/api/binder/${encodeURIComponent(wallet)}/cards`), {
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`worker returned ${res.status}`);
    const body = await res.json();
    const cards = body.cards || [];
    if (cards.length === 0) {
      list.innerHTML = '<p class="app-pending">No revealed cards yet for this wallet. Rip a pack to see your first cards.</p>';
      return;
    }
    list.innerHTML = `<div class="app-card-list">${cards.map((c) => `
      <a class="app-card-thumb" href="/card.html?cardKey=${encodeURIComponent(c.card_key)}">
        ${safeRenderThumb(c.card_key)}
      </a>
    `).join('')}</div>`;
  } catch (e) {
    list.innerHTML = `<p class="app-pending">Worker unavailable; binder list is unreachable from this build. (${escapeHtml(e.message)})</p>`;
  }
}

// Wrap the renderer so a single malformed cardKey can't break the
// whole binder grid. We still log it for diagnostics.
function safeRenderThumb(cardKey) {
  try {
    return renderCardFrontSvg(cardKey);
  } catch (e) {
    console.warn('binder: failed to render', cardKey, e);
    return `<p style="padding: 8px; color: var(--muted); font-size: 12px">${escapeHtml(cardKey || '—')}</p>`;
  }
}

function shortHtml(s) {
  if (!s) return '';
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
}
