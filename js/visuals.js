// ─── VISUALS GALLERY — virtualized grid of all 69,420 visuals ────────
//
// Renders the full visual set as a grid of clickable tiles. The naive
// approach — 69,420 <img> elements — locks the browser for several
// seconds at mount and burns hundreds of MB of resident memory.
// Virtualization renders only the rows currently in (or near) the
// viewport and recycles DOM nodes as the user scrolls.
//
// The art shown here is the visual set itself, in numeric order. The
// on-chain mapping from token id to visual is decided post-mint by
// verifiable randomness (provenance hash committed before mint,
// starting_index drawn from ORAO VRF after mint — see provenance.html
// for the full protocol). That is: tile #1 in this gallery is visual
// #1, but holders of NFT #1 will receive whichever visual the rotation
// lands them on.
//
// Why a custom virtualizer instead of a library: zero deps. The page
// is static and there are no other JS frameworks loaded. A 200-line
// scroll-based recycler is small enough to inline and easy to audit.

import { ELABORATE_VISUAL_IDS } from './lib/elaborate-ids.js';

(function () {
  'use strict';

  const SUPPLY = 69420;

  // Visuals known to carry decorative treatments — sourced from the
  // canonical list in js/lib/elaborate-ids.js. Listed here only to
  // highlight them in the grid with a quiet accent ring; they are
  // NOT on-chain rare.
  const DECORATED = new Set(ELABORATE_VISUAL_IDS);

  // Layout knobs. Tile geometry is computed from container width and a
  // minimum-tile-size — at desktop the grid lands on ~16 columns of
  // ~64 px, at phones it shrinks to ~5–6 columns of ~56 px.
  const MIN_TILE_PX = 56;
  const TARGET_TILE_PX = 64;
  const ROW_GAP_PX = 0;

  // How many extra rows to render above + below the viewport. Larger
  // = smoother scroll, more DOM. 4 keeps a comfortable buffer for
  // medium-speed scrolling without inflating the DOM.
  const OVERSCAN_ROWS = 4;

  // Throttle scroll handling with requestAnimationFrame so the
  // virtualization math runs at most once per paint.
  let _pendingFrame = false;

  // Cached layout state — recomputed on resize.
  let _cols = 16;
  let _tilePx = TARGET_TILE_PX;
  let _rowHeight = TARGET_TILE_PX + ROW_GAP_PX;
  let _totalRows = Math.ceil(SUPPLY / _cols);

  // Last rendered row range — short-circuits if scroll is still inside
  // the existing rendered window.
  let _renderedFirstRow = -1;
  let _renderedLastRow = -1;

  // Map: row-index → <div class="visuals-row"> currently in DOM. We
  // recycle these rather than create-and-destroy, which keeps GC quiet
  // and avoids layout thrash.
  const _rowPool = new Map();

  // Elements (looked up once at boot).
  const stage = document.getElementById('visualsStage');
  const spacer = document.getElementById('visualsSpacer');
  const viewport = document.getElementById('visualsViewport');
  const jumpInput = document.getElementById('visualsJumpInput');
  const rangeFromEl = document.getElementById('visualsRangeFrom');
  const rangeToEl = document.getElementById('visualsRangeTo');

  if (!stage || !spacer || !viewport) {
    // The gallery markup is missing — bail. Either the script was
    // loaded on the wrong page or the DOM was rewritten.
    return;
  }

  // ── Layout math ────────────────────────────────────────────────

  function recomputeLayout() {
    // Container width tells us how many columns of MIN_TILE_PX fit.
    // We aim for ~TARGET_TILE_PX per tile but accept slightly larger
    // when the grid would otherwise leave an awkward sliver. The
    // computed `cols` is then used to derive actual tile px (the grid
    // is auto-fill / 1fr so tiles share remaining space evenly).
    const containerW = stage.clientWidth || document.documentElement.clientWidth;
    const cols = Math.max(2, Math.floor(containerW / MIN_TILE_PX));
    const tilePx = Math.floor(containerW / cols);
    const rowHeight = tilePx + ROW_GAP_PX;
    const totalRows = Math.ceil(SUPPLY / cols);

    const changed =
      cols !== _cols ||
      tilePx !== _tilePx ||
      rowHeight !== _rowHeight ||
      totalRows !== _totalRows;

    _cols = cols;
    _tilePx = tilePx;
    _rowHeight = rowHeight;
    _totalRows = totalRows;

    // Set the spacer to the total scrollable height. Anything inside
    // the spacer is absolute-positioned, so this is the sole source
    // of scroll height for the gallery.
    spacer.style.height = totalRows * rowHeight + 'px';

    return changed;
  }

  // ── Row construction ───────────────────────────────────────────

  function ensureRow(rowIdx) {
    // Reuse an existing pool entry or build a new <div>.
    let row = _rowPool.get(rowIdx);
    if (row) return row;

    row = document.createElement('div');
    row.className = 'visuals-row';
    row.style.gridTemplateColumns = `repeat(${_cols}, 1fr)`;
    row.style.position = 'absolute';
    row.style.top = rowIdx * _rowHeight + 'px';
    row.style.left = '0';
    row.style.right = '0';
    row.style.height = _rowHeight + 'px';
    row.dataset.row = String(rowIdx);

    const startId = rowIdx * _cols + 1;
    const endId = Math.min(startId + _cols - 1, SUPPLY);
    for (let id = startId; id <= endId; id++) {
      row.appendChild(buildTile(id));
    }
    // Pad the final partial row with empty placeholders so the grid
    // gap stays consistent. (No <img> mounted in the padding.)
    for (let pad = endId + 1; pad <= startId + _cols - 1; pad++) {
      const placeholder = document.createElement('span');
      placeholder.setAttribute('aria-hidden', 'true');
      placeholder.style.display = 'block';
      row.appendChild(placeholder);
    }
    return row;
  }

  function buildTile(id) {
    const a = document.createElement('a');
    a.className = 'visuals-tile';
    if (DECORATED.has(id)) a.classList.add('is-decorated');
    // Per-Spaniel checklist page. Each tile links to the Series 1
    // dog page at /dog/<id>, which lists every variant on that
    // Spaniel's checklist.
    a.href = `/dog/${id}`;
    a.title = `Spaniel #${id}`;
    a.setAttribute('aria-label', `Spaniel ${id}`);

    const img = document.createElement('img');
    img.src = `/drops/art/${id}.png`;
    img.alt = `Spaniel visual ${id}`;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.width = 384;
    img.height = 384;
    // If a PNG happens to be missing (provenance check would already
    // have caught it before deploy), let the tile fall back to its
    // background skeleton rather than the browser's broken-image icon.
    img.addEventListener('error', () => {
      img.style.visibility = 'hidden';
    }, { once: true });
    a.appendChild(img);

    const label = document.createElement('span');
    label.className = 'visuals-tile-label';
    label.textContent = '#' + id;
    a.appendChild(label);

    return a;
  }

  // ── Render pass ────────────────────────────────────────────────

  function renderVisibleRows(force) {
    // Determine which rows fall inside [scrollY - overscan,
    // scrollY + viewportH + overscan].
    const stageRect = stage.getBoundingClientRect();
    const viewportH = window.innerHeight;
    // Scroll position relative to the stage's top in document coords.
    // stageRect.top is in client coords; we want how many px above the
    // stage the user has scrolled. Negative if the stage is below
    // the fold; positive once the stage's top is above the viewport.
    const scrollOffset = -stageRect.top;
    const firstVisibleRow = Math.max(0, Math.floor(scrollOffset / _rowHeight));
    const lastVisibleRow = Math.min(
      _totalRows - 1,
      Math.ceil((scrollOffset + viewportH) / _rowHeight)
    );
    const firstRow = Math.max(0, firstVisibleRow - OVERSCAN_ROWS);
    const lastRow = Math.min(_totalRows - 1, lastVisibleRow + OVERSCAN_ROWS);

    if (!force && firstRow === _renderedFirstRow && lastRow === _renderedLastRow) {
      return;
    }

    // Remove rows now outside [firstRow, lastRow].
    for (const [rowIdx, row] of _rowPool) {
      if (rowIdx < firstRow || rowIdx > lastRow) {
        row.remove();
        _rowPool.delete(rowIdx);
      }
    }

    // Add rows now inside [firstRow, lastRow]. The fragment minimizes
    // intermediate reflow.
    const frag = document.createDocumentFragment();
    for (let r = firstRow; r <= lastRow; r++) {
      if (_rowPool.has(r)) continue;
      const row = ensureRow(r);
      _rowPool.set(r, row);
      frag.appendChild(row);
    }
    if (frag.childNodes.length) viewport.appendChild(frag);

    _renderedFirstRow = firstRow;
    _renderedLastRow = lastRow;

    // Update the "X–Y of 69,420" counter to reflect the visible band.
    const firstId = firstVisibleRow * _cols + 1;
    const lastId = Math.min(SUPPLY, (lastVisibleRow + 1) * _cols);
    if (rangeFromEl) rangeFromEl.textContent = firstId.toLocaleString();
    if (rangeToEl) rangeToEl.textContent = lastId.toLocaleString();
  }

  function scheduleRender() {
    if (_pendingFrame) return;
    _pendingFrame = true;
    requestAnimationFrame(() => {
      _pendingFrame = false;
      renderVisibleRows(false);
    });
  }

  // ── Resize handling ───────────────────────────────────────────

  function onResize() {
    const changed = recomputeLayout();
    if (changed) {
      // Wipe the pool — geometry is stale; rows would render at the
      // wrong top offset and wrong column count.
      for (const [, row] of _rowPool) row.remove();
      _rowPool.clear();
      _renderedFirstRow = -1;
      _renderedLastRow = -1;
    }
    renderVisibleRows(true);
  }

  // ── Jump-to logic ──────────────────────────────────────────────

  function jumpTo(id) {
    if (!Number.isFinite(id)) return;
    const clamped = Math.max(1, Math.min(SUPPLY, Math.round(id)));
    const rowIdx = Math.floor((clamped - 1) / _cols);
    // Center the target row in the viewport when possible. Account
    // for the sticky controls bar so the row doesn't land under it.
    const targetY = stage.offsetTop + rowIdx * _rowHeight - 140;
    window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
    // Brief focus flash on the target tile so the user sees where
    // they landed. Wait for the row to render, then attach focus
    // (focus implicitly scrolls, but we already scrolled, so the
    // browser's adjustment is a no-op).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const row = _rowPool.get(rowIdx);
        if (!row) return;
        const col = (clamped - 1) % _cols;
        const tile = row.children[col];
        if (tile && typeof tile.focus === 'function') {
          tile.focus({ preventScroll: true });
        }
      });
    });
  }

  window.__visualsJump = function () {
    const raw = jumpInput && jumpInput.value;
    const id = parseInt(raw, 10);
    if (!Number.isFinite(id)) return;
    jumpTo(id);
  };

  // ── Keyboard paging ────────────────────────────────────────────
  //
  // Arrow keys page by half a viewport. Home/End jump to first/last
  // visual. Only fires when focus isn't in an input field, so the
  // jump-to input keeps its normal arrow-key behaviour.
  function onKey(e) {
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) {
      return;
    }
    let handled = false;
    const viewportH = window.innerHeight;
    const pageStep = Math.max(_rowHeight * 2, viewportH * 0.85);
    if (e.key === 'ArrowDown' || e.key === 'PageDown') {
      window.scrollBy({ top: pageStep, behavior: 'smooth' });
      handled = true;
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
      window.scrollBy({ top: -pageStep, behavior: 'smooth' });
      handled = true;
    } else if (e.key === 'Home') {
      window.scrollTo({ top: stage.offsetTop - 140, behavior: 'smooth' });
      handled = true;
    } else if (e.key === 'End') {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      handled = true;
    }
    if (handled) e.preventDefault();
  }

  // ── Deep-link support: ?id=N or #N scrolls on load ────────────
  function handleDeepLink() {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('id');
    let id = null;
    if (fromQuery && /^\d+$/.test(fromQuery)) {
      id = parseInt(fromQuery, 10);
    } else if (window.location.hash) {
      const m = window.location.hash.match(/^#?(\d+)$/);
      if (m) id = parseInt(m[1], 10);
    }
    if (id && id >= 1 && id <= SUPPLY) {
      // Defer so layout + initial render have settled.
      requestAnimationFrame(() => jumpTo(id));
    }
  }

  // ── Boot ───────────────────────────────────────────────────────

  recomputeLayout();
  renderVisibleRows(true);
  handleDeepLink();

  window.addEventListener('scroll', scheduleRender, { passive: true });
  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKey);

  // Validate the jump input as the user types so the Go button only
  // submits a value in range. The HTML min/max attrs cover most of
  // this; the JS keeps weird locales from accepting decimals etc.
  if (jumpInput) {
    jumpInput.addEventListener('input', () => {
      const v = parseInt(jumpInput.value, 10);
      if (!Number.isFinite(v)) return;
      if (v < 1) jumpInput.value = '1';
      else if (v > SUPPLY) jumpInput.value = String(SUPPLY);
    });
  }

  // Expose for debugging / future hooks.
  window.__visualsGallery = {
    jumpTo,
    rerender: () => onResize(),
    state: () => ({
      cols: _cols,
      tilePx: _tilePx,
      rowHeight: _rowHeight,
      totalRows: _totalRows,
      renderedRows: [_renderedFirstRow, _renderedLastRow],
    }),
  };
})();
