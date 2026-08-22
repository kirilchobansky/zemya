/* ============================================================
   APP — state, panels, modes, badges
   ============================================================ */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

/* ---------- storage (degrades to memory when blocked) ---------- */
const Store = (() => {
  let mem = null, ok = true;
  try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); } catch (e) { ok = false; }
  return {
    get() {
      if (!ok) return mem;
      try { const s = localStorage.getItem('zemya.progress'); return s ? JSON.parse(s) : null; } catch (e) { return mem; }
    },
    set(v) {
      mem = v;
      if (!ok) return;
      try { localStorage.setItem('zemya.progress', JSON.stringify(v)); } catch (e) {}
    }
  };
})();

const freshP = () => ({ v: 1, c: {}, ok: 0, no: 0, best: 0, tag: {}, badges: {}, taBest: 0, routes: 0, maxCombo: 0, deckPeak: 0 });
let P = Object.assign(freshP(), Store.get() || {});
if (!P.c) P = freshP();
const save = () => Store.set(P);
const cp = c => (P.c[c.a3] = P.c[c.a3] || { st: 0, ok: 0, no: 0, str: 0, miss: 0 });

/* ---------- app state ---------- */
const state = {
  mode: 'explore',
  overlay: 'none',
  sel: null,
  q: null, answered: false,
  session: { n: 0, ok: 0, streak: 0 },
  ta: null, route: null, match: null,
  compare: null, compareArm: false,
  hideLabels: false,
  neighbours: true
};

/* ---------- palettes ---------- */
const C_LAND = '#31485A', C_EDGE = '#44607390', C_CTX = '#1A2833';
const C_HOVER = '#456580', C_SEL = '#E8A33D', C_NBR = '#3F8FAB';
const MASTERY = ['#7A4B49', '#8A6A2E', '#2E7A57'];
const MASTERY_BRIGHT = ['#E2544F', '#E8A33D', '#3DD68C'];
const DENS = ['#123846', '#1B5566', '#37757D', '#7F9260', '#C69B45', '#F0B454'];
const FAM_C = {
  'Indo-European': '#4EA9C9', 'Afro-Asiatic': '#E8A33D', 'Sino-Tibetan': '#E2544F',
  'Niger-Congo': '#3DD68C', 'Austronesian': '#B98CE0', 'Turkic': '#F0D264',
  'Austroasiatic': '#6FBF73', 'Tai-Kadai': '#E0855A', 'Japonic / Koreanic': '#7FA8F0',
  'Uralic': '#C0D06A', 'Other families': '#6B8494'
};
const REL_C = {
  'Christianity': '#4EA9C9', 'Islam': '#3DD68C', 'Hinduism': '#E8A33D', 'Buddhism': '#E0855A',
  'Judaism': '#B98CE0', 'Folk / traditional': '#C0D06A', 'Secular / none': '#8FA3B0', 'Other': '#6B8494'
};
const REG_C = { Africa: '#E8A33D', Asia: '#E2544F', Europe: '#4EA9C9', Americas: '#3DD68C', Oceania: '#B98CE0' };

function densBin(c) {
  if (!c.dens) return DENS[0];
  const v = Math.log10(c.dens);
  const i = v < 0.7 ? 0 : v < 1.2 ? 1 : v < 1.7 ? 2 : v < 2.1 ? 3 : v < 2.6 ? 4 : 5;
  return DENS[i];
}

/* ---------- map colouring ---------- */
const hlSet = new Set();     // quiz highlights
MAP.colorFor = c => {
  if (state.compare && state.compare.c === c) return '#1E2E3A';
  if (hlSet.size && hlSet.has(c.a3)) return '#5A4A7A';
  if (state.route) {
    const idx = state.route.chain.findIndex(s => s.c === c);
    if (idx >= 0) return '#2E7A57';
    if (c === state.route.to) return '#8A6A2E';
    if (state.route.cur && state.route.cur.nb.includes(c.a3)) return '#3F7E9E';
  }
  if (MAP.sel === c) return C_SEL;
  if (state.neighbours && MAP.sel && MAP.sel.nb.includes(c.a3)) return C_NBR;
  if (MAP.hover === c) return C_HOVER;
  switch (state.overlay) {
    case 'mastery': return MASTERY[cp(c).st];
    case 'density': return densBin(c);
    case 'language': return FAM_C[c.fam] || FAM_C['Other families'];
    case 'religion': return REL_C[c.relGroup] || REL_C.Other;
    case 'region': return REG_C[c.reg] || C_LAND;
    default: return C_LAND;
  }
};
MAP.strokeFor = c => {
  if (MAP.sel === c) return ['#F5CE86', 1.8];
  if (state.route && state.route.cur === c) return ['#F5CE86', 1.8];
  if (state.neighbours && MAP.sel && MAP.sel.nb.includes(c.a3)) return ['#8FD3EA', 1.2];
  if (MAP.hover === c) return ['#7E9CB0', 1.2];
  return ['rgba(10,16,23,.92)', 1.0];
};

/* ---------- hover tip ---------- */
const tip = $('hover-tip');
MAP.onHover = (c, x, y, moveOnly) => {
  if (!c) { tip.classList.remove('on'); return; }
  if (!moveOnly) {
    const st = cp(c).st;
    tip.querySelector('.ht-dot').style.background = MASTERY_BRIGHT[st];
    tip.querySelector('span').textContent = `${c.fl}  ${c.n}`;
  }
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
  tip.classList.add('on');
};

MAP.onClick = (c, e) => {
  if (state.compareArm) { if (c) startCompare(c); return; }
  if (state.mode === 'route') { routeClick(c); return; }
  if (state.q && state.q.mapClick && !state.answered) { answerFind(c); return; }
  select(c, false);
};

function select(c, fly) {
  state.sel = c; MAP.sel = c;
  if (c) { cp(c); if (fly) flyTo(c); }
  draw();
  if (state.mode === 'explore') renderPanel();
}

/* ---------- toasts ---------- */
function toast(txt, good) {
  const t = document.createElement('div');
  t.className = 'toast ' + (good ? 'good' : 'bad');
  t.textContent = txt;
  $('toast-zone').appendChild(t);
  setTimeout(() => t.remove(), 800);
}

/* ============================================================
   MODES
   ============================================================ */
const MODES = [
  { id: 'explore', ic: '◎', lbl: 'Explore', sub: 'Dossiers & neighbours' },
  { id: 'study', ic: '◈', lbl: 'Study session', sub: 'Adaptive mixed drill' },
  { id: 'review', ic: '↻', lbl: 'Smart review', sub: 'Only what you missed' },
  { id: 'time', ic: '⧗', lbl: 'Time attack', sub: '60 seconds, combo multiplier' },
  { id: 'elim', ic: '⊘', lbl: 'Elimination', sub: 'Find the odd one out' },
  { id: 'route', ic: '⇢', lbl: 'Travel route', sub: 'Cross borders by land' },
  { id: 'match', ic: '⇄', lbl: 'Bridging match', sub: 'Flags, money, faith, tongue' },
  { id: 'shape', ic: '❖', lbl: 'Shape & flag', sub: 'Identify from description' },
  { id: 'trophy', ic: '★', lbl: 'Trophy room', sub: 'Badges & milestones' }
];

$('modes').innerHTML = MODES.map(m =>
  `<button class="mode" data-m="${m.id}"><span class="ic">${m.ic}</span><span class="lbl">${esc(m.lbl)}<span class="sub">${esc(m.sub)}</span></span></button>`
).join('');
$('modes').onclick = e => { const b = e.target.closest('.mode'); if (b) setMode(b.dataset.m); };

function setMode(m) {
  if (state.ta) { clearInterval(state.ta.timer); state.ta = null; }
  $('combo').classList.remove('on');
  state.mode = m; state.q = null; state.route = null; state.match = null;
  hlSet.clear();
  stopCompare();
  state.hideLabels = m !== 'explore';
  MAP.labels = !state.hideLabels;
  [...$('modes').children].forEach(b => b.setAttribute('aria-current', String(b.dataset.m === m)));
  state.session = { n: 0, ok: 0, streak: 0 };
  if (m !== 'explore') { MAP.sel = null; state.sel = null; }
  if (m !== 'explore' && m !== 'route') easeTo(0.5, 0.46, minZoom());
  if (m === 'study') nextQ(ALL_TYPES);
  else if (m === 'review') startReview();
  else if (m === 'time') startTA();
  else if (m === 'elim') nextQ(['elimination']);
  else if (m === 'shape') nextQ(['shapeDesc', 'flagDesc']);
  else if (m === 'route') startRoute();
  else if (m === 'match') startMatch();
  else renderPanel();
  draw();
}

/* ============================================================
   SCORING
   ============================================================ */
function record(c, correct, tag) {
  const p = cp(c);
  if (correct) {
    p.ok++; p.str++; if (p.miss > 0) p.miss--;
    p.st = p.str >= 3 ? 2 : 1;
    P.ok++;
    P.tag[tag] = (P.tag[tag] || 0) + 1;
  } else {
    p.no++; p.str = 0; p.miss = Math.min(4, (p.miss || 0) + 2);
    p.st = p.st === 2 ? 1 : Math.max(p.st, 1);
    P.no++;
  }
  const deck = deckList().length;
  if (deck > (P.deckPeak || 0)) P.deckPeak = deck;
  save(); checkBadges(); renderStats();
}
const deckList = () => LIST.filter(c => (P.c[c.a3] || {}).miss > 0).sort((a, b) => P.c[b.a3].miss - P.c[a.a3].miss);

function renderStats() {
  let n = 0, l = 0, m = 0;
  LIST.forEach(c => { const s = (P.c[c.a3] || {}).st || 0; if (s === 2) m++; else if (s === 1) l++; else n++; });
  $('st-master').textContent = m; $('st-learn').textContent = l; $('st-new').textContent = n;
  const tot = P.ok + P.no;
  $('st-acc').textContent = tot ? Math.round(P.ok / tot * 100) + '%' : '—';
  $('st-streak').textContent = P.best || 0;
  $('st-miss').textContent = deckList().length;
  const T = LIST.length;
  $('progress-bar').innerHTML =
    `<i style="width:${m / T * 100}%;background:var(--master)"></i>` +
    `<i style="width:${l / T * 100}%;background:var(--learn)"></i>`;
}

/* ============================================================
   PANEL
   ============================================================ */
function setHead(eyebrow, title) { $('panel-eyebrow').textContent = eyebrow; $('panel-title').textContent = title; }

function renderPanel() {
  const b = $('panel-body');
  switch (state.mode) {
    case 'explore': return renderDossier(b);
    case 'trophy': return renderTrophies(b);
    case 'match': return renderMatch(b);
    case 'route': return renderRoute(b);
    default: return renderQuiz(b);
  }
}

/* ---------- dossier ---------- */
function renderDossier(b) {
  const c = state.sel;
  if (!c) {
    setHead('Dossier', 'Select a country');
    b.innerHTML = `<div class="empty"><div class="eico">🧭</div>
      <p>Click any country to open its dossier. Its land neighbours light up in blue so you learn the shape of the region, not just the country.</p></div>
      <div class="grp"><h2 class="sub-h">Try one of these</h2><div class="nbr-list">${
        shuffle(STUDY.slice(0, 40)).slice(0, 8).map(x => `<button class="nbr" data-go="${x.a3}">${x.fl} ${esc(x.n)}</button>`).join('')
      }</div></div>`;
    return;
  }
  setHead('Dossier', c.sub || c.reg);
  const p = cp(c);
  const mt = ['mt-new', 'mt-learn', 'mt-master'][p.st];
  const mlbl = ['New', 'Learning', 'Mastered'][p.st];
  b.innerHTML = `
    <div class="dossier-hero">
      <div class="fl">${c.fl}</div>
      <div>
        <h3>${esc(c.n)}</h3>
        <div class="off">${esc(c.off)}</div>
        <span class="mastery-tag ${mt}"><i style="background:${MASTERY_BRIGHT[p.st]}"></i>${mlbl}${p.ok + p.no ? ` · ${p.ok}/${p.ok + p.no}` : ''}</span>
      </div>
    </div>
    ${c.mn ? `<div class="mnemonic"><div class="mn-label">Memory hook</div><p>${esc(c.mn)}</p></div>` : ''}
    <dl class="facts">
      <div class="fact"><dt>Capital</dt><dd>${esc(c.cap)}</dd></div>
      <div class="fact"><dt>Population</dt><dd><span class="num">${fmtNum(c.pop)}</span></dd></div>
      <div class="fact"><dt>Area</dt><dd><span class="num">${fmtNum(c.area)}</span> km²</dd></div>
      <div class="fact"><dt>Density</dt><dd><span class="num">${c.dens ? c.dens.toFixed(1) : '—'}</span> / km²</dd></div>
      <div class="fact"><dt>Currency</dt><dd>${esc(c.curN)} <span class="num">(${esc(c.curC)}${c.curS ? ' ' + esc(c.curS) : ''})</span></dd></div>
      <div class="fact"><dt>Language</dt><dd>${esc(c.langs.join(', ') || '—')}<br><span style="color:var(--ink-3);font-size:11.5px">${esc(c.fam)}</span></dd></div>
      <div class="fact"><dt>Religion</dt><dd>${esc(c.rel)}</dd></div>
      <div class="fact"><dt>Region</dt><dd>${esc(c.sub || c.reg)}</dd></div>
    </dl>
    <div>
      <h3 class="sub-h">Land borders · ${c.nb.length}${c.ll_ ? ' · landlocked' : ''}</h3>
      <div class="nbr-list">${c.nb.length
      ? c.nb.map(a => `<button class="nbr" data-go="${a}">${BY3[a].fl} ${esc(BY3[a].n)}</button>`).join('')
      : '<span style="color:var(--ink-3);font-size:12.5px">Island nation — no land neighbours.</span>'}</div>
    </div>
    ${c.fd ? `<div class="desc-card"><b>Flag</b> — ${esc(c.fd)}</div>` : ''}
    ${c.sh ? `<div class="desc-card"><b>Outline</b> — ${esc(c.sh)}</div>` : ''}
    <div class="act-row">
      <button class="act primary" data-act="zoom">Zoom to country</button>
      <button class="act" data-act="compare">Compare its size</button>
      <button class="act" data-act="quizthis">Quiz me on this</button>
    </div>`;
}

$('panel-body').addEventListener('click', e => {
  const go = e.target.closest('[data-go]');
  if (go) { select(BY3[go.dataset.go], true); return; }
  const act = e.target.closest('[data-act]');
  if (!act) return;
  const a = act.dataset.act;
  if (a === 'zoom') flyTo(state.sel);
  else if (a === 'compare') startCompare(state.sel);
  else if (a === 'quizthis') { setMode('study'); nextQ(ALL_TYPES, state.sel); }
});

/* ============================================================
   QUIZ FLOW
   ============================================================ */
function nextQ(types, forced) {
  state.answered = false;
  hlSet.clear();
  let q;
  if (forced) {
    for (let i = 0; i < 25 && !q; i++) q = GEN[rnd(types)](forced);
  }
  if (!q) q = makeQuestion(types, P.c, state.filter);
  state.q = q;
  if (q.highlight) q.highlight.forEach(x => hlSet.add(x.a3));
  if (q.mapClick) {
    $('map').classList.add('picking');
    MAP.sel = null; state.sel = null;
    easeTo(0.5, 0.46, minZoom());
  } else $('map').classList.remove('picking');
  if (q.highlight) { MAP.sel = null; state.sel = null; fitTo(q.highlight); }
  draw();
  renderQuiz($('panel-body'));
}

function fitTo(list) {
  const xs = [], ys = [];
  list.forEach(c => { if (c.bbox) { xs.push(mx(c.bbox[0]), mx(c.bbox[2])); ys.push(my(c.bbox[1]), my(c.bbox[3])); } });
  if (!xs.length) return;
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (x1 - x0 > 0.75) { easeTo(0.5, 0.46, minZoom()); return; }
  const z = Math.min(MAP.W / Math.max(x1 - x0, .01) * .6, MAP.H / Math.max(y1 - y0, .01) * .6);
  easeTo((x0 + x1) / 2, (y0 + y1) / 2, Math.max(minZoom() * 0.8, Math.min(z, minZoom() * 12)));
}

const MODE_TITLE = {
  study: ['Study session', 'Adaptive drill'], review: ['Smart review', 'Missed questions'],
  time: ['Time attack', '60 seconds'], elim: ['Elimination', 'Odd one out'],
  shape: ['Shape & flag', 'From description']
};

function renderQuiz(b) {
  const q = state.q;
  const t = MODE_TITLE[state.mode] || ['Quiz', ''];
  setHead(t[1], t[0]);
  if (!q) { b.innerHTML = `<div class="empty"><div class="eico">◈</div><p>Loading question…</p></div>`; return; }
  const s = state.session;
  const taBar = state.ta ? `<div id="timer-track"><i style="width:100%"></i></div>` : '';
  b.innerHTML = `
    <div class="qcard">
      <div class="qmeta">
        <span class="pill on">${esc(q.tag)}</span>
        <span class="spacer"></span>
        ${state.ta ? `<span class="score" id="ta-score">${state.ta.score} pts</span>` : `<span class="score">${s.ok}/${s.n} · streak ${s.streak}</span>`}
      </div>
      ${taBar}
      <p class="qprompt">${q.prompt}</p>
      ${q.desc ? `<div class="qdesc">${esc(q.desc)}</div>` : ''}
      ${q.flagBig && !q.desc ? `<div class="qbig">${q.flagBig}</div>` : ''}
      ${q.mapClick ? `<p class="qsub">Click the country on the map.</p>` : `<div class="opts" id="opts">${
        q.options.map((o, i) => `<button class="opt" data-i="${i}">
            <span class="key">${'ABCD'[i]}</span>
            ${o.flag ? `<span class="oflag">${o.flag}</span>` : ''}
            <span class="${o.big ? 'qbig' : ''}" style="${o.big ? 'font-size:30px;padding:0' : ''}">${esc(o.label)}</span>
          </button>`).join('')}</div>`}
      <div id="verdict"></div>
    </div>`;
  const opts = $('opts');
  if (opts) opts.onclick = e => { const bt = e.target.closest('.opt'); if (bt) answer(+bt.dataset.i); };
}

function answer(i) {
  const q = state.q;
  if (!q || state.answered) return;
  state.answered = true;
  const chosen = q.options[i];
  const correct = chosen.ok;
  [...$('opts').children].forEach((el, j) => {
    el.disabled = true;
    if (q.options[j].ok) el.classList.add('correct');
    else if (j === i) el.classList.add('wrong');
    else el.classList.add('dim');
  });
  finishAnswer(correct, q);
}

function answerFind(c) {
  const q = state.q;
  if (!q || state.answered) return;
  state.answered = true;
  const correct = c === q.c;
  MAP.sel = q.c; state.sel = q.c;
  $('map').classList.remove('picking');
  if (!correct && c) toast(c.n, false);
  finishAnswer(correct, q, c ? `You picked ${c.fl} ${c.n}.` : 'You clicked open water.');
  draw();
}

function finishAnswer(correct, q, extra) {
  const target = q.cOverride || q.c;
  record(target, correct, q.tag);
  const s = state.session;
  s.n++; if (correct) { s.ok++; s.streak++; if (s.streak > (P.best || 0)) { P.best = s.streak; } } else s.streak = 0;
  if (state.ta) {
    if (correct) {
      state.ta.combo++;
      const mult = Math.min(5, 1 + Math.floor(state.ta.combo / 3));
      state.ta.score += mult;
      if (state.ta.combo > (P.maxCombo || 0)) P.maxCombo = state.ta.combo;
      showCombo(mult, state.ta.combo);
      toast('+' + mult, true);
    } else { state.ta.combo = 0; showCombo(1, 0); toast('✕', false); }
  } else {
    toast(correct ? '✓' : '✕', correct);
  }
  save();
  const v = $('verdict');
  const mn = target.mn ? `<div class="mnemonic" style="margin-top:9px"><div class="mn-label">Memory hook · ${esc(target.n)}</div><p>${esc(target.mn)}</p></div>` : '';
  v.innerHTML = `<div class="verdict ${correct ? 'good' : 'bad'}">
      <div class="vh">${correct ? 'Correct' : 'Not quite'}</div>
      <p>${extra ? esc(extra) + ' ' : ''}${esc(q.after)}</p>
    </div>${mn}
    <div class="act-row" style="margin-top:11px"><button class="act primary" id="nextq">Next question →</button>
    <button class="act" data-go="${target.a3}">Open dossier</button></div>`;
  $('nextq').onclick = advance;
  $('nextq').focus();
  if (state.ta) setTimeout(advance, 850);
}

function advance() {
  if (state.mode === 'review') { startReview(); return; }
  const types = state.mode === 'elim' ? ['elimination']
    : state.mode === 'shape' ? ['shapeDesc', 'flagDesc']
      : state.mode === 'time' ? QUICK_TYPES : ALL_TYPES;
  nextQ(types);
}

/* ---------- smart review ---------- */
function startReview() {
  const deck = deckList();
  state.filter = null;
  if (!deck.length) {
    state.q = null;
    setHead('Smart review', 'Deck is empty');
    $('panel-body').innerHTML = `<div class="empty"><div class="eico">✦</div>
      <p><b>Nothing to review.</b><br>Every question you have missed has since been answered correctly. Run a study session or time attack to build the deck back up.</p></div>
      <div class="act-row" style="justify-content:center"><button class="act primary" data-m2="study">Start a study session</button></div>`;
    $('panel-body').querySelector('[data-m2]').onclick = () => setMode('study');
    return;
  }
  const set = new Set(deck.map(c => c.a3));
  state.filter = c => set.has(c.a3);
  nextQ(ALL_TYPES);
  state.filter = null;
}

/* ---------- time attack ---------- */
function showCombo(mult, streak) {
  const el = $('combo');
  if (streak < 2) { el.classList.remove('on'); return; }
  el.classList.add('on');
  el.querySelector('b').textContent = '×' + mult;
  el.querySelector('span').textContent = streak + ' in a row';
}
function startTA() {
  state.ta = { score: 0, combo: 0, left: 60, n: 0 };
  nextQ(QUICK_TYPES);
  state.ta.timer = setInterval(() => {
    state.ta.left -= 0.25;
    const tr = $('timer-track');
    if (tr) {
      tr.firstElementChild.style.width = Math.max(0, state.ta.left / 60 * 100) + '%';
      tr.classList.toggle('warn', state.ta.left < 15);
    }
    if (state.ta.left <= 0) endTA();
  }, 250);
}
function endTA() {
  clearInterval(state.ta.timer);
  const sc = state.ta.score;
  state.ta = null; state.q = null;
  $('combo').classList.remove('on');
  if (sc > (P.taBest || 0)) P.taBest = sc;
  save(); checkBadges();
  setHead('Time attack', 'Time!');
  $('panel-body').innerHTML = `<div class="empty" style="padding-top:18px">
      <div style="font-family:var(--f-display);font-size:64px;color:var(--brass-2);line-height:1">${sc}</div>
      <p style="margin-top:6px">points this run · personal best <b style="color:var(--ink)">${P.taBest}</b></p></div>
    <div class="act-row" style="justify-content:center">
      <button class="act primary" id="ta-again">Run it again</button>
      <button class="act" id="ta-rev">Review what you missed</button></div>`;
  $('ta-again').onclick = () => setMode('time');
  $('ta-rev').onclick = () => setMode('review');
}

/* ============================================================
   TRAVEL ROUTE
   ============================================================ */
function startRoute() {
  const r = buildRoute(3, 5);
  if (!r) { setMode('study'); return; }
  state.route = { from: r.from, to: r.to, cur: r.from, chain: [{ c: r.from, ok: true }], pending: null, best: r.path.length - 1 };
  cp(r.from); cp(r.to);
  fitTo([r.from, r.to]);
  renderRoute($('panel-body'));
  draw();
}

function routeClick(c) {
  const R = state.route;
  if (!R || !c || R.done) return;
  if (R.pending) { toast('Name the capital first', false); return; }
  if (c === R.cur) return;
  if (!R.cur.nb.includes(c.a3)) { toast('No land border', false); return; }
  R.pending = c;
  renderRoute($('panel-body'));
  const inp = $('cap-in'); if (inp) inp.focus();
  draw();
}

const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim();

function routeSubmit() {
  const R = state.route, inp = $('cap-in');
  if (!R || !R.pending || !inp) return;
  const guess = norm(inp.value), want = norm(R.pending.cap);
  const ok = guess.length > 1 && (guess === want || want.split(' ').includes(guess) || want.startsWith(guess) && guess.length >= want.length - 2);
  record(R.pending, ok, 'Capitals');
  if (ok) {
    R.chain.push({ c: R.pending, ok: true });
    R.cur = R.pending; R.pending = null;
    toast('✓', true);
    if (R.cur === R.to) {
      R.done = true;
      P.routes = (P.routes || 0) + 1; save(); checkBadges();
      toast('Arrived!', true);
    }
  } else {
    toast(R.pending.cap, false);
    R.wrongCap = R.pending.cap;
    R.pending = null;
  }
  renderRoute($('panel-body'));
  draw();
}

function renderRoute(b) {
  const R = state.route;
  setHead('Travel route', 'Cross by land');
  if (!R) { b.innerHTML = `<div class="empty"><p>Building a route…</p></div>`; return; }
  const chain = R.chain.map((s, i) =>
    `${i ? '<span class="route-arrow">→</span>' : ''}<span class="rstep done">${s.c.fl} ${esc(s.c.n)}</span>`).join('');
  const pend = R.pending ? `<span class="route-arrow">→</span><span class="rstep cur">${R.pending.fl} ${esc(R.pending.n)}?</span>` : '';
  b.innerHTML = `
    <p class="qprompt">Travel from <em>${R.from.fl} ${esc(R.from.n)}</em> to <em>${R.to.fl} ${esc(R.to.n)}</em> — by land only.</p>
    <p class="qsub">Click a bordering country on the map, then name its capital to set foot in it. Shortest possible route: ${R.best} border crossings.</p>
    <div><h3 class="sub-h">Your route · ${R.chain.length - 1} crossings</h3><div class="route-chain">${chain}${pend}</div></div>
    ${R.done ? `<div class="verdict good"><div class="vh">Route complete</div>
        <p>You crossed ${R.chain.length - 1} borders to reach <b>${esc(R.to.n)}</b>${R.chain.length - 1 === R.best ? ' — the shortest path possible.' : `. The shortest possible was ${R.best}.`}</p></div>
      <div class="mnemonic"><div class="mn-label">Memory hook · ${esc(R.to.n)}</div><p>${esc(R.to.mn)}</p></div>
      <div class="act-row"><button class="act primary" id="r-new">New route</button></div>`
      : R.pending ? `<div><h3 class="sub-h">Capital of ${esc(R.pending.n)}</h3>
          <div class="cap-input"><input id="cap-in" placeholder="Type the capital…" autocomplete="off" spellcheck="false">
          <button class="act primary" id="cap-go">Enter</button></div></div>
          <div class="mnemonic"><div class="mn-label">Hook · ${esc(R.pending.n)}</div><p>${esc(R.pending.mn)}</p></div>`
        : `<div class="desc-card">Currently standing in <b>${R.cur.fl} ${esc(R.cur.n)}</b>. Its ${R.cur.nb.length} neighbours are lit on the map.</div>
           ${R.wrongCap ? `<div class="verdict bad"><div class="vh">Missed capital</div><p>That was <b>${esc(R.wrongCap)}</b> — try that neighbour again, or take another road.</p></div>` : ''}
           <div class="act-row"><button class="act" id="r-new">Different route</button></div>`}`;
  const g = $('cap-go'); if (g) g.onclick = routeSubmit;
  const i2 = $('cap-in'); if (i2) i2.onkeydown = e => { if (e.key === 'Enter') routeSubmit(); };
  const nw = $('r-new'); if (nw) nw.onclick = startRoute;
}

/* ============================================================
   BRIDGING MATCH
   ============================================================ */
function startMatch() {
  state.match = buildMatch(Math.random() < .5 ? 'flagCurrency' : 'religionLanguage');
  state.match.solved = new Set(); state.match.pick = null; state.match.tries = 0; state.match.errs = 0;
  renderMatch($('panel-body'));
}

function renderMatch(b) {
  const M = state.match;
  setHead('Bridging match', M ? M.title : '');
  if (!M) { b.innerHTML = '<div class="empty"><p>Dealing tiles…</p></div>'; return; }
  const done = M.solved.size === M.left.length;
  const tile = (s, side) => `<button class="mtile ${M.solved.has(s.id) ? 'done' : ''} ${M.pick && M.pick.side === side && M.pick.id === s.id ? 'picked' : ''}"
      data-side="${side}" data-id="${s.id}" ${M.solved.has(s.id) ? 'disabled' : ''}>
      ${s.big ? `<span class="mfl">${s.big}</span>` : ''}<span>${esc(s.label || '')}${s.sub ? `<br><small style="color:var(--ink-3);font-family:var(--f-mono);font-size:10px">${esc(s.sub)}</small>` : ''}</span></button>`;
  b.innerHTML = `
    <p class="qsub" style="margin-top:0">${esc(M.hint)} The map is deliberately out of the picture — this one is pure association.</p>
    <div class="match-wrap">
      <div class="match-col" id="m-left">${M.left.map(s => tile(s, 'L')).join('')}</div>
      <div class="match-col" id="m-right">${M.right.map(s => tile(s, 'R')).join('')}</div>
    </div>
    <div class="qmeta"><span>${M.solved.size}/${M.left.length} paired</span><span class="spacer"></span><span>${M.errs} misses</span></div>
    ${done ? `<div class="verdict good"><div class="vh">Round complete</div><p>${M.reveal.map(esc).join('<br>')}</p></div>
      <div class="act-row"><button class="act primary" id="m-new">Another round</button></div>` : ''}`;
  b.querySelectorAll('.mtile').forEach(t => t.onclick = () => matchPick(t.dataset.side, t.dataset.id, t));
  const n = $('m-new'); if (n) n.onclick = startMatch;
}

function matchPick(side, id, el) {
  const M = state.match;
  if (!M || M.solved.has(id)) return;
  if (!M.pick) { M.pick = { side, id }; renderMatch($('panel-body')); return; }
  if (M.pick.side === side) { M.pick = { side, id }; renderMatch($('panel-body')); return; }
  const ok = M.pick.id === id;
  const c = BY3[id];
  if (ok) {
    M.solved.add(id);
    record(c, true, M.kind === 'flagCurrency' ? 'Currency' : 'Religion');
    toast('✓', true);
    M.pick = null;
    renderMatch($('panel-body'));
    if (M.solved.size === M.left.length) { P.tag.match = (P.tag.match || 0) + 1; save(); checkBadges(); }
  } else {
    M.errs++;
    record(BY3[M.pick.id] || c, false, M.kind === 'flagCurrency' ? 'Currency' : 'Religion');
    el.classList.add('shake');
    setTimeout(() => { M.pick = null; renderMatch($('panel-body')); }, 320);
  }
}

/* ============================================================
   BADGES
   ============================================================ */
const BADGES = [
  { id: 'afr', ic: '🦁', n: 'Sovereign of Africa', d: 'Master every African country', f: () => regProg('Africa') },
  { id: 'eur', ic: '🏰', n: 'Crown of Europe', d: 'Master every European country', f: () => regProg('Europe') },
  { id: 'asi', ic: '🐉', n: 'Ruler of Asia', d: 'Master every Asian country', f: () => regProg('Asia') },
  { id: 'ame', ic: '🦅', n: 'Lord of the Americas', d: 'Master every country in the Americas', f: () => regProg('Americas') },
  { id: 'oce', ic: '🌊', n: 'Navigator of Oceania', d: 'Master every Oceanian country', f: () => regProg('Oceania') },
  { id: 'poly', ic: '🗣', n: 'Polyglot', d: '30 language questions right', f: () => (P.tag.Language || 0) / 30 },
  { id: 'fisc', ic: '💰', n: 'Fiscal Master', d: '30 currency questions right', f: () => (P.tag.Currency || 0) / 30 },
  { id: 'faith', ic: '🕊', n: 'Keeper of Faiths', d: '30 religion questions right', f: () => (P.tag.Religion || 0) / 30 },
  { id: 'flag', ic: '🏴', n: 'Flag Bearer', d: '50 flag questions right', f: () => ((P.tag.Flags || 0) + (P.tag['Flag geometry'] || 0)) / 50 },
  { id: 'cart', ic: '🧭', n: 'Cartographer', d: '40 countries located on the map', f: () => (P.tag.Locate || 0) / 40 },
  { id: 'bord', ic: '🧱', n: 'Border Scholar', d: '30 border questions right', f: () => (P.tag.Borders || 0) / 30 },
  { id: 'path', ic: '🛤', n: 'Pathfinder', d: 'Complete 5 land routes', f: () => (P.routes || 0) / 5 },
  { id: 'time', ic: '⚡', n: 'Against the Clock', d: 'Score 40 in Time Attack', f: () => (P.taBest || 0) / 40 },
  { id: 'combo', ic: '🔥', n: 'Unbroken', d: 'A 12-answer combo', f: () => (P.maxCombo || 0) / 12 },
  { id: 'cent', ic: '💯', n: 'Centurion', d: 'Master 100 countries', f: () => mastered() / 100 },
  { id: 'grand', ic: '🌍', n: 'Grand Tour', d: 'Master all 196', f: () => mastered() / LIST.length },
  { id: 'clean', ic: '🧹', n: 'Clean Slate', d: 'Empty a review deck of 10+', f: () => (P.deckPeak || 0) >= 10 && deckList().length === 0 ? 1 : Math.min(0.99, (P.deckPeak || 0) / 10 * (deckList().length ? 0.5 : 1)) },
  { id: 'silh', ic: '❖', n: 'Silhouette Reader', d: '25 outlines identified', f: () => (P.tag.Silhouettes || 0) / 25 },
  { id: 'elim', ic: '⊘', n: 'Process of Elimination', d: '25 odd-ones-out found', f: () => (P.tag.Elimination || 0) / 25 },
  { id: 'brdg', ic: '⇄', n: 'Bridge Builder', d: 'Finish 8 matching rounds', f: () => (P.tag.match || 0) / 8 }
];
const mastered = () => LIST.filter(c => (P.c[c.a3] || {}).st === 2).length;
function regProg(r) {
  const all = LIST.filter(c => c.reg === r);
  return all.filter(c => (P.c[c.a3] || {}).st === 2).length / all.length;
}
function checkBadges() {
  let fresh = null;
  BADGES.forEach(b => {
    const v = Math.min(1, b.f());
    if (v >= 1 && !P.badges[b.id]) { P.badges[b.id] = Date.now(); fresh = b; }
  });
  if (fresh) { save(); toast(fresh.ic + ' ' + fresh.n, true); }
}

function renderTrophies(b) {
  setHead('Trophy room', `${Object.keys(P.badges).length} of ${BADGES.length} unlocked`);
  b.innerHTML = `<div class="trophy-grid">${BADGES.map(t => {
    const v = Math.min(1, Math.max(0, t.f() || 0));
    const won = !!P.badges[t.id];
    return `<div class="trophy ${won ? 'won' : 'locked'}">
        <div class="tico">${t.ic}</div><b>${esc(t.n)}</b><small>${esc(t.d)}</small>
        <div class="tprog"><i style="width:${Math.round(v * 100)}%"></i></div>
        <small style="font-family:var(--f-mono);font-size:9.5px">${won ? 'UNLOCKED' : Math.round(v * 100) + '%'}</small>
      </div>`;
  }).join('')}</div>
  <div><h3 class="sub-h">Review deck · ${deckList().length}</h3>
    ${deckList().length ? deckList().slice(0, 14).map(c =>
    `<div class="deck-row" style="margin-bottom:5px"><span class="dfl">${c.fl}</span><span>${esc(c.n)}</span><span class="dmiss">${P.c[c.a3].miss}×</span></div>`).join('')
      : '<div class="desc-card">Empty — nothing outstanding.</div>'}</div>`;
}

/* ============================================================
   OVERLAYS & LEGEND
   ============================================================ */
const OVERLAYS = [
  { id: 'none', n: 'Terrain' }, { id: 'mastery', n: 'Mastery' }, { id: 'density', n: 'Density' },
  { id: 'language', n: 'Language' }, { id: 'religion', n: 'Religion' }, { id: 'region', n: 'Region' }
];
$('ov-chips').innerHTML = OVERLAYS.map(o => `<button class="chip" data-ov="${o.id}" aria-pressed="${o.id === 'none'}">${o.n}</button>`).join('');
$('ov-chips').onclick = e => {
  const b = e.target.closest('[data-ov]'); if (!b) return;
  state.overlay = b.dataset.ov;
  [...$('ov-chips').children].forEach(x => x.setAttribute('aria-pressed', String(x.dataset.ov === state.overlay)));
  legend(); draw();
};

function legend() {
  const L = $('legend');
  const rows = (title, items) => `<div class="leg-title">${title}</div>` +
    items.map(([c, l]) => `<div class="leg-row"><span class="leg-sw" style="background:${c}"></span>${esc(l)}</div>`).join('');
  switch (state.overlay) {
    case 'mastery': L.innerHTML = rows('Mastery', [[MASTERY_BRIGHT[2], 'Mastered — 3 in a row'], [MASTERY_BRIGHT[1], 'Learning'], [MASTERY_BRIGHT[0], 'New / not yet seen']]); break;
    case 'density': L.innerHTML = rows('People per km²', [[DENS[0], 'under 5'], [DENS[1], '5 – 16'], [DENS[2], '16 – 50'], [DENS[3], '50 – 125'], [DENS[4], '125 – 400'], [DENS[5], 'over 400']]); break;
    case 'language': L.innerHTML = rows('Language family', Object.entries(FAM_C).map(([k, v]) => [v, k])); break;
    case 'religion': L.innerHTML = rows('Predominant faith', Object.entries(REL_C).map(([k, v]) => [v, k])); break;
    case 'region': L.innerHTML = rows('Continent', Object.entries(REG_C).map(([k, v]) => [v, k])); break;
    default: L.innerHTML = rows('Selection', [[C_SEL, 'Selected country'], [C_NBR, 'Shares a land border'], [C_LAND, 'Everything else']]);
  }
}

/* ---------- map tool bar ---------- */
const TOOLS = [
  { id: 'compare', n: '⇲ Compare size' },
  { id: 'nbr', n: 'Neighbour glow' },
  { id: 'pins', n: 'Micro-states' }
];
$('overlay-bar').innerHTML = TOOLS.map(t =>
  `<button class="ov" data-tool="${t.id}" aria-pressed="${t.id === 'nbr' || t.id === 'pins'}">${t.n}</button>`).join('');
$('overlay-bar').onclick = e => {
  const b = e.target.closest('[data-tool]'); if (!b) return;
  const t = b.dataset.tool;
  if (t === 'nbr') { state.neighbours = !state.neighbours; b.setAttribute('aria-pressed', String(state.neighbours)); draw(); }
  else if (t === 'pins') { MAP.pins = !MAP.pins; b.setAttribute('aria-pressed', String(MAP.pins)); draw(); }
  else if (t === 'compare') { state.compare ? stopCompare() : armCompare(); }
};

/* ============================================================
   TRUE-SIZE COMPARISON
   ============================================================ */
function armCompare() {
  if (state.sel) { startCompare(state.sel); return; }
  state.compareArm = true;
  $('map').classList.add('picking');
  $('compare-hud').classList.add('on');
  $('compare-hud').innerHTML = `<div class="ch-txt">Click any country to lift its outline off the map.</div>
    <button class="act" id="cmp-x">Cancel</button>`;
  $('cmp-x').onclick = stopCompare;
}
function startCompare(c) {
  if (!c || !c.polys.length) { toast('No outline to lift', false); return; }
  state.compareArm = false;
  $('map').classList.remove('picking');
  state.compare = { c };
  MAP.compare = { c, lon: c.lab[0], lat: c.lab[1], rings: trueSizeRings(c, c.lab[0], c.lab[1]) };
  MAP.onCompareMove = compareHUD;
  document.querySelector('[data-tool="compare"]').setAttribute('aria-pressed', 'true');
  compareHUD();
  draw();
}
function stopCompare() {
  state.compare = null; state.compareArm = false;
  MAP.compare = null;
  $('map').classList.remove('picking');
  $('compare-hud').classList.remove('on');
  const t = document.querySelector('[data-tool="compare"]');
  if (t) t.setAttribute('aria-pressed', 'false');
  draw();
}
function compareHUD() {
  const cm = MAP.compare; if (!cm) return;
  const under = countryAtLonLat(cm.lon, cm.lat);
  const a = cm.c.area || 0;
  let txt = `<b>${cm.c.fl} ${esc(cm.c.n)}</b> — ${fmtNum(a)} km². Drag it anywhere; on a Mercator map its true ground size is preserved.`;
  if (under && under !== cm.c && under.area) {
    const r = a / under.area;
    txt += `<br>Sitting over <b>${esc(under.n)}</b> — ${r >= 1 ? r.toFixed(1) + '× larger' : (1 / r).toFixed(1) + '× smaller'}.`;
  }
  $('compare-hud').classList.add('on');
  $('compare-hud').innerHTML = `<div class="ch-txt">${txt}</div><button class="act" id="cmp-x">Put it back</button>`;
  $('cmp-x').onclick = stopCompare;
}
function countryAtLonLat(lon, lat) {
  const d = MAP.dpr;
  const [sx, sy] = w2s(mx(lon), my(lat));
  return pick(sx, sy);
}

/* ============================================================
   SEARCH
   ============================================================ */
const sIn = $('search'), sBox = $('suggest');
let sIdx = -1, sHits = [];
sIn.addEventListener('input', () => {
  const q = norm(sIn.value);
  if (q.length < 1) { sBox.classList.remove('on'); return; }
  sHits = LIST.filter(c => norm(c.n).includes(q) || norm(c.cap).includes(q) || norm(c.a3) === q)
    .sort((a, b) => (norm(a.n).indexOf(q) - norm(b.n).indexOf(q)) || b.pop - a.pop).slice(0, 8);
  sIdx = -1;
  sBox.innerHTML = sHits.map((c, i) =>
    `<button data-a="${c.a3}"><span class="sg-flag">${c.fl}</span><span>${esc(c.n)}</span><span class="sg-sub">${esc(c.cap)}</span></button>`).join('')
    || `<button disabled style="color:var(--ink-3)">No match</button>`;
  sBox.classList.add('on');
});
sBox.onclick = e => { const b = e.target.closest('[data-a]'); if (b) pickSearch(BY3[b.dataset.a]); };
sIn.addEventListener('keydown', e => {
  if (!sHits.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    sIdx = (sIdx + (e.key === 'ArrowDown' ? 1 : -1) + sHits.length) % sHits.length;
    [...sBox.children].forEach((x, i) => x.classList.toggle('sel', i === sIdx));
  } else if (e.key === 'Enter') { pickSearch(sHits[Math.max(0, sIdx)]); }
  else if (e.key === 'Escape') sBox.classList.remove('on');
});
function pickSearch(c) {
  if (!c) return;
  sBox.classList.remove('on'); sIn.value = ''; sIn.blur();
  if (state.mode !== 'explore') setMode('explore');
  select(c, true);
}
document.addEventListener('click', e => { if (!e.target.closest('#search-wrap')) sBox.classList.remove('on'); });

/* ============================================================
   PROGRESS I/O
   ============================================================ */
$('btn-export').onclick = async () => {
  const s = JSON.stringify(P);
  try { await navigator.clipboard.writeText(s); toast('Copied', true); }
  catch (e) { window.prompt('Copy your progress:', s); }
};
$('btn-import').onclick = () => {
  const s = window.prompt('Paste previously exported progress:');
  if (!s) return;
  try {
    const o = JSON.parse(s);
    if (!o || !o.c) throw 0;
    P = Object.assign(freshP(), o); save();
    renderStats(); renderPanel(); draw(); toast('Restored', true);
  } catch (e) { toast('Not valid progress data', false); }
};
$('btn-reset').onclick = () => {
  if (!confirm('Erase all mastery, badges and review data? This cannot be undone.')) return;
  P = freshP(); save(); renderStats(); renderPanel(); draw();
};

/* ============================================================
   KEYBOARD
   ============================================================ */
document.addEventListener('keydown', e => {
  if (/input|textarea/i.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (state.q && !state.answered && state.q.options && 'abcd'.includes(k)) {
    const i = 'abcd'.indexOf(k);
    if (i < state.q.options.length) { answer(i); e.preventDefault(); }
  } else if ((e.key === 'Enter' || e.key === ' ') && state.answered) { advance(); e.preventDefault(); }
  else if (k === '/') { sIn.focus(); e.preventDefault(); }
  else if (k === 'escape') { stopCompare(); }
});

/* ============================================================
   BOOT
   ============================================================ */
legend();
renderStats();
setMode('explore');
resize();
easeTo(0.5, 0.46, minZoom(), true);
