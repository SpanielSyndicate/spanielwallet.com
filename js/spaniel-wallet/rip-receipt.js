// Pure helpers for the /rip receipt block. Extracted from
// rip-page.js so the render path is testable without a DOM. The
// page binds these to the DOM and renders the returned HTML.
//
// The receipt has three shapes:
//   - success: Worker recorded the purchase; show all the deltas
//     plus the SpanielCoin issuance and the sealed-product details.
//   - gated:   the on-chain settlement landed but the Worker
//     verifier was unable to confirm (PROGRAM_PENDING /
//     WRONG_PROGRAM / quote drift). We surface the reason; we do
//     not fake success.
//   - error:   non-200 from the Worker. Show the tx + explorer
//     link so the operator can investigate.
//
// All three render the reveal-gated copy required by CLAUDE.md.

import { getExplorerTxLink } from '../lib/solana-networks.js';
import { formatSolLamports } from '../lib/format-sol.js';

export const REVEAL_GATED_COPY = 'Open/reveal requires cNFT tree + Bubblegum CPI; purchase succeeded.';

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function lamportsToSolDisplay(lamportsString) {
  if (lamportsString == null) return '—';
  try {
    const lam = BigInt(lamportsString);
    // BigInt-safe split + decimal padding preserves the existing 6-dp
    // display contract while staying accurate above 2^53 lamports
    // (curve tail amounts can hit ~6.9 PSOL / 6.9e18 lamports).
    return `${formatSolLamports(lam, 6, { padZeros: true })} SOL (${lam.toString()} lamports)`;
  } catch {
    return String(lamportsString);
  }
}

function explorerHtml(sig, cluster) {
  const url = getExplorerTxLink(sig, cluster);
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">explorer ↗</a>`;
}

function row(label, value, valueStyle = '') {
  return `<div class="app-row"><span class="app-row-label">${escapeHtml(label)}</span><span class="app-row-value"${valueStyle ? ` style="${valueStyle}"` : ''}>${value}</span></div>`;
}

function monoBreak(s) {
  return `<span style="font-family:'DM Mono',monospace;font-size:12px;word-break:break-all">${escapeHtml(s)}</span>`;
}

function mono(s) {
  return `<span style="font-family:'DM Mono',monospace;font-size:12px">${escapeHtml(s)}</span>`;
}

export function renderQuoteRows(quote) {
  if (!quote) return '';
  const rows = [
    ['Buyer paid', lamportsToSolDisplay(quote.buyerPaysLamports)],
    ['Rescue Pool', lamportsToSolDisplay(quote.rescueContributionLamports)],
    ['Treasury', lamportsToSolDisplay(quote.treasuryLamports)],
  ];
  if (quote.hasValidReferral && quote.affiliateCommissionLamports && quote.affiliateCommissionLamports !== '0') {
    rows.push(['Direct affiliate', lamportsToSolDisplay(quote.affiliateCommissionLamports)]);
  }
  if (quote.packlineTotalLamports && quote.packlineTotalLamports !== '0') {
    rows.push(['Packline total (L2..L5)', lamportsToSolDisplay(quote.packlineTotalLamports)]);
  }
  return rows.map(([k, v]) => `<div class="app-row"><span class="app-row-label">${escapeHtml(k)}</span>${mono(v)}</div>`).join('');
}

export function renderSpcRows(spc) {
  if (!spc) return '';
  const out = [
    ['Buyer SpanielCoin', spc.buyerAmount],
    ['Treasury Match SpanielCoin', spc.treasuryMatchAmount],
  ];
  if (spc.directAffiliateAmount && spc.directAffiliateAmount !== '0') {
    out.push(['Direct Affiliate SpanielCoin', spc.directAffiliateAmount]);
  }
  out.push(['Total minted', spc.totalIssued]);
  return out.map(([k, v]) => `<div class="app-row"><span class="app-row-label">${escapeHtml(k)}</span>${mono(String(v))}</div>`).join('');
}

export function renderSealedRows(sealedProducts) {
  if (!Array.isArray(sealedProducts) || sealedProducts.length === 0) {
    return '';
  }
  const inner = sealedProducts.map((sp) => `
    <li>
      <div><span class="app-row-label">Sealed product</span> <code>${escapeHtml(sp.id)}</code></div>
      <div><span class="app-row-label">Asset id</span> <code>${escapeHtml(sp.assetId)}</code></div>
      <div><span class="app-row-label">Draws</span> ${escapeHtml(String(sp.drawSlotCount))} slots starting at ${escapeHtml(String(sp.drawSlotStart))}</div>
    </li>
  `).join('');
  return `<ul style="list-style: none; padding-left: 0; margin: 4px 0; display: grid; gap: 6px">${inner}</ul>`;
}

export function buildReceiptSuccessHtml({ quote, txSignature, cluster, rec }) {
  return `
    ${row('Status', 'recorded')}
    ${row('Purchase id', `<code style="font-family:'DM Mono',monospace;font-size:12px">${escapeHtml(rec.purchaseId)}</code>`)}
    ${row('Tx signature', monoBreak(txSignature))}
    ${row('Explorer', explorerHtml(txSignature, cluster))}
    <h3 class="app-section-title" style="margin-top: 12px">Quote splits</h3>
    ${renderQuoteRows(quote)}
    <h3 class="app-section-title" style="margin-top: 12px">SpanielCoin minted</h3>
    ${renderSpcRows(rec.spanielCoinIssued)}
    ${renderSealedRows(rec.sealedProducts)}
    <p class="app-pending" style="margin-top: 12px">${escapeHtml(REVEAL_GATED_COPY)}</p>
  `;
}

export function buildReceiptGatedHtml({ quote, txSignature, cluster, rec }) {
  return `
    ${row('Status', 'on-chain settlement landed; Worker verifier gated')}
    ${row('Reason', escapeHtml(rec.reason || rec.code || 'unknown'))}
    ${row('Tx signature', monoBreak(txSignature))}
    ${row('Explorer', explorerHtml(txSignature, cluster))}
    <h3 class="app-section-title" style="margin-top: 12px">Quote splits (pre-verification)</h3>
    ${renderQuoteRows(quote)}
    <p class="app-pending" style="margin-top: 12px">${escapeHtml(REVEAL_GATED_COPY)}</p>
  `;
}

export function buildReceiptErrorHtml({ quote, txSignature, cluster, rec }) {
  const reason = (rec && (rec.reason || rec.code || rec.error)) || 'unknown';
  return `
    ${row('Status', 'on-chain settlement landed; Worker record failed')}
    ${row('Error', escapeHtml(reason))}
    ${row('Tx signature', monoBreak(txSignature))}
    ${row('Explorer', explorerHtml(txSignature, cluster))}
    <h3 class="app-section-title" style="margin-top: 12px">Quote splits</h3>
    ${renderQuoteRows(quote)}
    <p class="app-pending" style="margin-top: 12px">${escapeHtml(REVEAL_GATED_COPY)}</p>
  `;
}
