/* ===== OTAFF Flashcard App - app.js ===== */
'use strict';

const CATEGORIES = [
  { key: 'all',                 label: 'すべて',      file: null },
  { key: 'hygiene',             label: '衛生',        file: 'hygiene.json' },
  { key: 'safety',              label: '安全',        file: 'safety.json' },
  { key: 'haccp',               label: 'HACCP',       file: 'haccp.json' },
  { key: 'procedure',           label: '手順',        file: 'procedure.json' },
  { key: 'food-processing',     label: '食品加工',    file: 'food-processing.json' },
  { key: 'ingredients',         label: '原材料',      file: 'ingredients.json' },
  { key: 'machinery',           label: '機械',        file: 'machinery.json' },
  { key: 'tools',               label: '器具',        file: 'tools.json' },
  { key: 'cleaning',            label: '清掃',        file: 'cleaning.json' },
  { key: 'emergency',           label: '緊急',        file: 'emergency.json' },
  { key: 'warning',             label: '警告',        file: 'warning.json' },
  { key: 'ppe',                 label: 'PPE',         file: 'ppe.json' },
  { key: 'packaging',           label: '包装',        file: 'packaging.json' },
  { key: 'storage',             label: '保管',        file: 'storage.json' },
  { key: 'production',          label: '生産',        file: 'production.json' },
  { key: 'quality-control',     label: '品質管理',    file: 'quality-control.json' },
  { key: 'regulations',         label: '規制',        file: 'regulations.json' },
  { key: 'temperature-control', label: '温度管理',    file: 'temperature-control.json' },
  { key: 'work-actions',        label: '作業動詞',    file: 'work-actions.json' },
  { key: 'factory',             label: '工場',        file: 'factory.json' },
];

const state = {
  allVocab: [], categoryVocab: {}, filteredVocab: [],
  currentIndex: 0, isFlipped: false,
  activeCategory: 'all', mode: 'study',
  searchQuery: '', favorites: new Set(), seenSet: new Set(),
  // touch
  touchStartX: 0, touchStartY: 0,
  touchMoved: false, isDragging: false, dragX: 0,
  // write mode
  writeMode: false, canvas: null, ctx: null,
  drawing: false, lastX: 0, lastY: 0,
};

const $ = id => document.getElementById(id);
const $qa = sel => [...document.querySelectorAll(sel)];

const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ─── Load data ────────────────────────────────────────────────────────────────
async function loadAllData() {
  const cats = CATEGORIES.filter(c => c.file);
  const res = await Promise.all(cats.map(cat =>
    fetch(`./data/${cat.file}`).then(r => r.ok ? r.json() : []).then(arr => ({ key: cat.key, data: arr })).catch(() => ({ key: cat.key, data: [] }))
  ));
  res.forEach(({ key, data }) => {
    state.categoryVocab[key] = data;
    data.forEach(v => state.allVocab.push({ ...v, _cat: key }));
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  state.favorites = new Set(LS.get('otaff_fav', []));
  state.seenSet   = new Set(LS.get('otaff_seen', []));
  state.activeCategory = LS.get('otaff_cat', 'all');
  state.mode = LS.get('otaff_mode', 'study');

  await loadAllData();
  buildTabs();
  buildModeBar();
  bindControls();
  bindNav();
  bindSwipe();
  bindKeyboard();
  applyFilter();
  renderStatsBar();
  updateHeader();

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(() => {});

  setTimeout(() => {
    $('loading').classList.add('hidden');
    $('app').classList.add('visible');
    renderCard();
  }, 1600);
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
function buildTabs() {
  const c = $('tabsContainer');
  c.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const count = cat.key === 'all' ? state.allVocab.length : (state.categoryVocab[cat.key] || []).length;
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (cat.key === state.activeCategory ? ' active' : '');
    btn.dataset.cat = cat.key;
    btn.innerHTML = `${cat.label} <span class="tab-count">${count}</span>`;
    btn.addEventListener('click', () => selectCategory(cat.key));
    c.appendChild(btn);
  });
}

function buildModeBar() {
  const modes = [
    { key: 'study', label: '順番学習' },
    { key: 'random', label: 'ランダム' },
    { key: 'favorites', label: '★ お気に入り' },
    { key: 'list', label: '一覧リスト' },
  ];
  const bar = $('modeBar');
  bar.innerHTML = '';
  modes.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'mode-btn' + (state.mode === m.key ? ' active' : '');
    btn.textContent = m.label;
    btn.addEventListener('click', () => selectMode(m.key));
    bar.appendChild(btn);
  });
}

// ─── Category / Mode ─────────────────────────────────────────────────────────
function selectCategory(key) {
  state.activeCategory = key;
  state.currentIndex = 0;
  state.isFlipped = false;
  LS.set('otaff_cat', key);
  $qa('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === key));
  applyFilter();
  renderCard();
  renderStatsBar();
  updateHeader();
}

function selectMode(key) {
  state.mode = key;
  state.currentIndex = 0;
  state.isFlipped = false;
  LS.set('otaff_mode', key);
  $qa('.mode-btn').forEach((b, i) => b.classList.toggle('active', ['study','random','favorites','list'][i] === key));
  $qa('.bnav-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === key));

  if (key === 'random') shuffleFiltered(); else applyFilter();

  const listView = $('listView'), cardArea = $('cardArea'), cardNav = $('cardNav');
  if (key === 'list') {
    listView.classList.add('active');
    cardArea.style.display = 'none';
    cardNav.style.display = 'none';
    renderList();
  } else {
    listView.classList.remove('active');
    cardArea.style.display = '';
    cardNav.style.display = '';
    renderCard();
  }
  updateProgress();
}

// ─── Filter ───────────────────────────────────────────────────────────────────
function applyFilter() {
  let src;
  if (state.mode === 'favorites') {
    src = state.allVocab.filter(v => state.favorites.has(fk(v)));
  } else if (state.activeCategory === 'all') {
    src = [...state.allVocab];
  } else {
    src = (state.categoryVocab[state.activeCategory] || []).map(v => ({ ...v, _cat: state.activeCategory }));
  }
  const q = state.searchQuery.trim().toLowerCase();
  if (q) src = src.filter(v => v.jp.includes(q) || v.reading.includes(q) || v.id.toLowerCase().includes(q));
  state.filteredVocab = src;
}

function shuffleFiltered() {
  applyFilter();
  for (let i = state.filteredVocab.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [state.filteredVocab[i], state.filteredVocab[j]] = [state.filteredVocab[j], state.filteredVocab[i]];
  }
}

// ─── Render card ──────────────────────────────────────────────────────────────
function renderCard() {
  const area = $('cardArea');
  const vocab = state.filteredVocab;

  if (!vocab.length) {
    area.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      <p>${state.searchQuery ? '検索結果なし' : 'カードがありません'}</p></div>`;
    updateProgress(); return;
  }

  const v = vocab[state.currentIndex];
  state.isFlipped = false;
  state.seenSet.add(fk(v));
  LS.set('otaff_seen', [...state.seenSet]);

  const isFav = state.favorites.has(fk(v));
  const catLabel = CATEGORIES.find(c => c.key === (v._cat || state.activeCategory))?.label || '';

  area.innerHTML = `
    <div class="card-stack">
      <div class="card-ghost card-ghost-2"></div>
      <div class="card-ghost card-ghost-1"></div>
      <div class="flashcard entering" id="flashcard">
        <div class="card-face card-front">
          <span class="card-category-badge">${catLabel}</span>
          <button class="card-fav-btn ${isFav?'starred':''}" id="favBtn">
            ${starSVG()}
          </button>
          <div class="card-jp">${esc(v.jp)}</div>
          <div class="card-reading">${esc(v.reading)}</div>
          <div class="card-flip-hint">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
            タップして答えを見る
          </div>
          <span class="card-index">${state.currentIndex+1} / ${vocab.length}</span>
        </div>
        <div class="card-face card-back">
          <span class="card-category-badge">${catLabel}</span>
          <button class="card-fav-btn ${isFav?'starred':''}" id="favBtn2">${starSVG()}</button>
          <div class="card-id-label">インドネシア語</div>
          <div class="card-id">${esc(v.id)}</div>
          <div class="card-jp-small">${esc(v.jp)}</div>
          <button class="write-btn" id="writeBtn">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"/></svg>
            書いて練習
          </button>
          <span class="card-index">${state.currentIndex+1} / ${vocab.length}</span>
        </div>
      </div>
      <div class="swipe-hint left" id="hintLeft">✗ SKIP</div>
      <div class="swipe-hint right" id="hintRight">✓ OK</div>
    </div>`;

  // ── bind tap to flip using pointerup (no double-fire) ──
  const card = $('flashcard');
  let pointerMoved = false;

  card.addEventListener('pointerdown', () => { pointerMoved = false; });
  card.addEventListener('pointermove', () => { pointerMoved = true; });
  card.addEventListener('pointerup', e => {
    if (pointerMoved) return;
    if (e.target.closest('.card-fav-btn') || e.target.closest('.write-btn')) return;
    flipCard();
  });

  // fav buttons
  [$('favBtn'), $('favBtn2')].forEach(btn => {
    if (!btn) return;
    btn.addEventListener('pointerup', e => {
      e.stopPropagation();
      toggleFav(v);
    });
  });

  // write button
  const wb = $('writeBtn');
  if (wb) wb.addEventListener('pointerup', e => { e.stopPropagation(); openWriteModal(v); });

  updateProgress();
  updateNavBtns();
}

function starSVG() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/>
  </svg>`;
}

function flipCard() {
  const card = $('flashcard');
  if (!card) return;
  state.isFlipped = !state.isFlipped;
  card.classList.toggle('flipped', state.isFlipped);
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function goNext() {
  if (state.currentIndex >= state.filteredVocab.length - 1) return;
  animateOut('left', () => { state.currentIndex++; state.isFlipped = false; renderCard(); });
}
function goPrev() {
  if (state.currentIndex <= 0) return;
  animateOut('right', () => { state.currentIndex--; state.isFlipped = false; renderCard(); });
}
function animateOut(dir, cb) {
  const card = $('flashcard');
  if (!card) { cb(); return; }
  card.classList.add(dir === 'left' ? 'swipe-left' : 'swipe-right');
  setTimeout(cb, 350);
}
function updateNavBtns() {
  const prev = $('btnPrev'), next = $('btnNext');
  if (prev) prev.disabled = state.currentIndex <= 0;
  if (next) next.disabled = state.currentIndex >= state.filteredVocab.length - 1;
}
function updateProgress() {
  const total = state.filteredVocab.length;
  const cur = total ? state.currentIndex + 1 : 0;
  const pct = total ? Math.round(cur / total * 100) : 0;
  const fill = $('progressFill'), label = $('progressLabel'), pctEl = $('progressPct');
  if (fill) fill.style.width = pct + '%';
  if (label) label.textContent = `${cur} / ${total}`;
  if (pctEl) pctEl.textContent = pct + '%';
}

// ─── Swipe (touch) ────────────────────────────────────────────────────────────
function bindSwipe() {
  let sx = 0, sy = 0, moved = false;

  document.addEventListener('touchstart', e => {
    const card = e.target.closest('.flashcard');
    if (!card) return;
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    moved = false;
    state.isDragging = true;
    state.dragX = 0;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!state.isDragging) return;
    const card = $('flashcard');
    if (!card) return;
    const dx = e.touches[0].clientX - sx;
    const dy = e.touches[0].clientY - sy;
    if (Math.abs(dy) > Math.abs(dx) * 1.4) { state.isDragging = false; return; }
    e.preventDefault();
    moved = true;
    state.dragX = dx;
    const rot = dx * 0.05;
    card.style.transition = 'none';
    card.style.transform = state.isFlipped
      ? `rotateY(180deg) translateX(${-dx}px) rotate(${-rot}deg)`
      : `translateX(${dx}px) rotate(${rot}deg)`;
    card.style.opacity = 1 - Math.min(Math.abs(dx) / 320, 0.45);
    const hL = $('hintLeft'), hR = $('hintRight');
    if (hL) hL.style.opacity = dx < -40 ? Math.min((-dx-40)/80,1) : 0;
    if (hR) hR.style.opacity = dx > 40  ? Math.min((dx-40)/80,1)  : 0;
  }, { passive: false });

  document.addEventListener('touchend', e => {
    if (!state.isDragging) return;
    state.isDragging = false;
    const card = $('flashcard');
    if (!card) return;
    const dx = state.dragX;
    card.style.transition = '';
    card.style.opacity = '';
    const hL = $('hintLeft'), hR = $('hintRight');
    if (hL) hL.style.opacity = 0;
    if (hR) hR.style.opacity = 0;

    if (!moved) return; // tap handled by pointerup

    if (dx < -80 && state.currentIndex < state.filteredVocab.length - 1) {
      goNext();
    } else if (dx > 80 && state.currentIndex > 0) {
      goPrev();
    } else {
      card.style.transform = state.isFlipped ? 'rotateY(180deg)' : '';
    }
  }, { passive: true });
}

// ─── Keyboard ─────────────────────────────────────────────────────────────────
function bindKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if ($('writeModal') && !$('writeModal').classList.contains('hidden')) return;
    switch (e.key) {
      case 'ArrowRight': case 'l': goNext(); break;
      case 'ArrowLeft':  case 'h': goPrev(); break;
      case ' ': case 'f': e.preventDefault(); flipCard(); break;
    }
  });
}

// ─── Controls ─────────────────────────────────────────────────────────────────
function bindControls() {
  let t;
  $('searchInput').addEventListener('input', e => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.searchQuery = e.target.value;
      state.currentIndex = 0;
      applyFilter();
      state.mode === 'list' ? renderList() : renderCard();
      updateProgress();
    }, 200);
  });
  $('btnShuffle').addEventListener('click', () => {
    state.currentIndex = 0;
    shuffleFiltered();
    renderCard();
    showToast('シャッフルしました 🔀');
  });
  $('btnFavFilter').addEventListener('click', () => selectMode('favorites'));
}

function bindNav() {
  $('btnPrev').addEventListener('click', goPrev);
  $('btnNext').addEventListener('click', goNext);
  $qa('.bnav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $qa('.bnav-btn').forEach(b => b.classList.toggle('active', b === btn));
      selectMode(btn.dataset.mode);
    });
  });
}

// ─── Favorites ────────────────────────────────────────────────────────────────
function fk(v) { return v.jp + '|' + v.reading; }

function toggleFav(v) {
  const k = fk(v);
  const adding = !state.favorites.has(k);
  if (adding) state.favorites.add(k); else state.favorites.delete(k);
  LS.set('otaff_fav', [...state.favorites]);
  [$('favBtn'), $('favBtn2')].forEach(btn => {
    if (btn) btn.classList.toggle('starred', adding);
  });
  showToast(adding ? '★ お気に入りに追加' : 'お気に入りを削除');
  updateHeader(); renderStatsBar();
}

// ─── Write modal ──────────────────────────────────────────────────────────────
function openWriteModal(v) {
  const modal = $('writeModal');
  modal.classList.remove('hidden');
  $('writeTarget').textContent = v.jp;
  $('writeReading').textContent = v.reading;
  $('writeMeaning').textContent = v.id;
  $('writeAnswerOverlay').textContent = v.jp;

  const canvas = $('writeCanvas');
  const ctx = canvas.getContext('2d');

  // resize canvas to actual display size
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    drawGrid(ctx, rect.width, rect.height);
  }
  resizeCanvas();

  state.canvas = canvas;
  state.ctx = ctx;
  state.drawing = false;

  // Clear
  $('writeClear').onclick = () => {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid(ctx, rect.width, rect.height);
  };

  // Close
  $('writeClose').onclick = () => modal.classList.add('hidden');
  $('writeModalBg').onclick = () => modal.classList.add('hidden');

  // Show answer toggle
  let showAnswer = false;
  $('writeShowAnswer').onclick = () => {
    showAnswer = !showAnswer;
    $('writeAnswerOverlay').style.opacity = showAnswer ? '1' : '0';
    $('writeShowAnswer').textContent = showAnswer ? '非表示' : '答えを見る';
  };
  $('writeAnswerOverlay').style.opacity = '0';
  $('writeShowAnswer').textContent = '答えを見る';

  bindCanvasEvents(canvas, ctx);
}

function drawGrid(ctx, w, h) {
  ctx.strokeStyle = 'rgba(124,106,247,0.15)';
  ctx.lineWidth = 1;
  // outer box
  ctx.strokeRect(1, 1, w - 2, h - 2);
  // cross lines
  ctx.beginPath();
  ctx.moveTo(w/2, 0); ctx.lineTo(w/2, h);
  ctx.moveTo(0, h/2); ctx.lineTo(w, h/2);
  ctx.stroke();
  // diagonal guides
  ctx.strokeStyle = 'rgba(124,106,247,0.07)';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(w, h);
  ctx.moveTo(w, 0); ctx.lineTo(0, h);
  ctx.stroke();
}

function bindCanvasEvents(canvas, ctx) {
  const rect = () => canvas.getBoundingClientRect();
  const pos = (e, r) => {
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left), y: (src.clientY - r.top) };
  };

  function start(e) {
    e.preventDefault();
    state.drawing = true;
    const r = rect(), p = pos(e, r);
    state.lastX = p.x; state.lastY = p.y;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#e8e8f0';
    ctx.fill();
  }
  function move(e) {
    e.preventDefault();
    if (!state.drawing) return;
    const r = rect(), p = pos(e, r);
    ctx.beginPath();
    ctx.moveTo(state.lastX, state.lastY);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = '#e8e8f0';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    state.lastX = p.x; state.lastY = p.y;
  }
  function end(e) { e.preventDefault(); state.drawing = false; }

  // remove old listeners by cloning
  const fresh = canvas.cloneNode(true);
  canvas.parentNode.replaceChild(fresh, canvas);
  fresh.id = 'writeCanvas';
  state.canvas = fresh;
  state.ctx = fresh.getContext('2d');
  const r2 = fresh.getBoundingClientRect();
  fresh.width = r2.width * window.devicePixelRatio;
  fresh.height = r2.height * window.devicePixelRatio;
  state.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  drawGrid(state.ctx, r2.width, r2.height);

  fresh.addEventListener('mousedown',  start, { passive: false });
  fresh.addEventListener('mousemove',  move,  { passive: false });
  fresh.addEventListener('mouseup',    end,   { passive: false });
  fresh.addEventListener('touchstart', start, { passive: false });
  fresh.addEventListener('touchmove',  move,  { passive: false });
  fresh.addEventListener('touchend',   end,   { passive: false });

  $('writeClear').onclick = () => {
    const r = fresh.getBoundingClientRect();
    state.ctx.clearRect(0, 0, fresh.width, fresh.height);
    drawGrid(state.ctx, r.width, r.height);
  };
}

// ─── List view ────────────────────────────────────────────────────────────────
function renderList() {
  const lv = $('listView');
  const vocab = state.filteredVocab;
  if (!vocab.length) {
    lv.innerHTML = `<div class="fav-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg><p>${state.mode==='favorites'?'まだお気に入りがありません':'結果なし'}</p></div>`;
    return;
  }
  lv.innerHTML = vocab.map((v, i) => `
    <div class="list-item" data-idx="${i}">
      <div class="list-item-jp">${esc(v.jp)}</div>
      <div class="list-item-reading">${esc(v.reading)}</div>
      <div class="list-item-id">${esc(v.id)}</div>
      <button class="list-item-star ${state.favorites.has(fk(v))?'starred':''}" data-idx="${i}">
        ${starSVG()}
      </button>
    </div>`).join('');

  $qa('.list-item-star').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const v = vocab[+btn.dataset.idx];
    toggleFav(v);
    btn.classList.toggle('starred', state.favorites.has(fk(v)));
  }));
  $qa('.list-item').forEach(item => item.addEventListener('click', e => {
    if (e.target.closest('.list-item-star')) return;
    state.currentIndex = +item.dataset.idx;
    state.isFlipped = false;
    selectMode('study');
  }));
}

// ─── Stats / Header ───────────────────────────────────────────────────────────
function renderStatsBar() {
  $('statsBar').innerHTML = `
    <div class="stat-pill"><div class="stat-dot accent"></div><span class="stat-label">総語彙</span><span class="stat-val">${state.allVocab.length}</span></div>
    <div class="stat-pill"><div class="stat-dot gold"></div><span class="stat-label">お気に入り</span><span class="stat-val">${state.favorites.size}</span></div>
    <div class="stat-pill"><div class="stat-dot green"></div><span class="stat-label">学習済み</span><span class="stat-val">${state.seenSet.size}</span></div>
    <div class="stat-pill"><span class="stat-label">カテゴリ</span><span class="stat-val">20</span></div>`;
}
function updateHeader() {
  const el = $('headerCount');
  if (el) el.textContent = (state.mode==='favorites' ? state.favorites.size : state.filteredVocab.length) + ' 語';
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const wrap = $('toastWrap');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('DOMContentLoaded', init);
