/* ============================================================
   QUIZ — question generators
   ============================================================ */
const rnd = a => a[Math.floor(Math.random() * a.length)];
function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }
const fmtPop = n => n >= 1e9 ? (n / 1e9).toFixed(2) + ' bn' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' m' : n >= 1e3 ? (n / 1e3).toFixed(0) + ' k' : String(n);
const fmtNum = n => (n || 0).toLocaleString('en-US');

/* pick k distractors that differ from `c` on keyFn, preferring same region */
function distract(c, k, keyFn, from) {
  const src = from || STUDY;
  const key = keyFn(c);
  const same = shuffle(src.filter(x => x !== c && keyFn(x) && keyFn(x) !== key && x.reg === c.reg));
  const any = shuffle(src.filter(x => x !== c && keyFn(x) && keyFn(x) !== key && x.reg !== c.reg));
  const out = [];
  const seen = new Set([key]);
  for (const x of same.concat(any)) {
    if (out.length >= k) break;
    if (seen.has(keyFn(x))) continue;
    seen.add(keyFn(x)); out.push(x);
  }
  return out;
}

const opt = (label, ok, extra) => Object.assign({ label, ok: !!ok }, extra || {});

/* ---------- individual generators ---------- */
const GEN = {
  capital(c) {
    if (c.cap === '—') return null;
    const d = distract(c, 3, x => x.cap);
    if (d.length < 3) return null;
    return {
      type: 'capital', c, tag: 'Capitals',
      prompt: `What is the capital of <em>${c.n}</em>?`,
      flagBig: c.fl,
      options: shuffle([opt(c.cap, 1), ...d.map(x => opt(x.cap, 0, { of: x.n }))]),
      after: `${c.cap} is the capital of ${c.n}.`
    };
  },
  capitalRev(c) {
    if (c.cap === '—') return null;
    const d = distract(c, 3, x => x.n);
    if (d.length < 3) return null;
    return {
      type: 'capitalRev', c, tag: 'Capitals',
      prompt: `<em>${c.cap}</em> is the capital of which country?`,
      options: shuffle([opt(c.n, 1, { flag: c.fl }), ...d.map(x => opt(x.n, 0, { flag: x.fl }))]),
      after: `${c.cap} is the capital of ${c.n}.`
    };
  },
  flag(c) {
    const d = distract(c, 3, x => x.n);
    if (d.length < 3) return null;
    return {
      type: 'flag', c, tag: 'Flags',
      prompt: 'Which country flies this flag?',
      flagBig: c.fl,
      options: shuffle([opt(c.n, 1), ...d.map(x => opt(x.n, 0))]),
      after: `${c.fl} is the flag of ${c.n}.`
    };
  },
  flagPick(c) {
    const d = distract(c, 3, x => x.n);
    if (d.length < 3) return null;
    return {
      type: 'flagPick', c, tag: 'Flags',
      prompt: `Pick the flag of <em>${c.n}</em>`,
      options: shuffle([opt(c.fl, 1, { big: 1 }), ...d.map(x => opt(x.fl, 0, { big: 1, of: x.n }))]),
      after: `${c.n} flies ${c.fl}.`
    };
  },
  flagDesc(c) {
    if (!c.fd) return null;
    const d = distract(c, 3, x => x.n).filter(x => x.fd);
    if (d.length < 3) return null;
    return {
      type: 'flagDesc', c, tag: 'Flag geometry',
      prompt: 'Which country\'s flag is being described?',
      desc: c.fd,
      options: shuffle([opt(c.n, 1), ...d.map(x => opt(x.n, 0))]),
      after: `${c.fl} ${c.n}: ${c.fd}`
    };
  },
  shapeDesc(c) {
    if (!c.sh) return null;
    const d = distract(c, 3, x => x.n).filter(x => x.sh);
    if (d.length < 3) return null;
    return {
      type: 'shapeDesc', c, tag: 'Silhouettes',
      prompt: 'Which country has this outline?',
      desc: c.sh,
      options: shuffle([opt(c.n, 1), ...d.map(x => opt(x.n, 0))]),
      after: `${c.n} — ${c.sh}`
    };
  },
  currency(c) {
    if (c.curN === '—') return null;
    const d = distract(c, 3, x => x.curN);
    if (d.length < 3) return null;
    return {
      type: 'currency', c, tag: 'Currency',
      prompt: `Which currency does <em>${c.n}</em> use?`,
      flagBig: c.fl,
      options: shuffle([opt(c.curN, 1), ...d.map(x => opt(x.curN, 0))]),
      after: `${c.n} uses the ${c.curN} (${c.curC}).`
    };
  },
  language(c) {
    if (c.lang === '—') return null;
    const d = distract(c, 3, x => x.lang);
    if (d.length < 3) return null;
    return {
      type: 'language', c, tag: 'Language',
      prompt: `What is the main official language of <em>${c.n}</em>?`,
      flagBig: c.fl,
      options: shuffle([opt(c.lang, 1), ...d.map(x => opt(x.lang, 0))]),
      after: `${c.n} — ${c.langs.join(', ')} (${c.fam}).`
    };
  },
  religion(c) {
    const d = distract(c, 3, x => x.rel);
    if (d.length < 3) return null;
    return {
      type: 'religion', c, tag: 'Religion',
      prompt: `Which faith is most widely followed in <em>${c.n}</em>?`,
      flagBig: c.fl,
      options: shuffle([opt(c.rel, 1), ...d.map(x => opt(x.rel, 0))]),
      after: `${c.n} — predominantly ${c.rel}.`
    };
  },
  neighbour(c) {
    if (!c.nb.length || c.nb.length > 12) return null;
    const nbSet = new Set(c.nb);
    const real = BY3[rnd(c.nb)];
    const fakes = shuffle(STUDY.filter(x => x !== c && !nbSet.has(x.a3) && x.reg === c.reg)).slice(0, 3);
    if (fakes.length < 3 || !real) return null;
    return {
      type: 'neighbour', c, tag: 'Borders',
      prompt: `Which of these shares a land border with <em>${c.n}</em>?`,
      flagBig: c.fl,
      options: shuffle([opt(real.n, 1, { flag: real.fl }), ...fakes.map(x => opt(x.n, 0, { flag: x.fl }))]),
      after: `${c.n} borders ${c.nb.map(a => BY3[a].n).join(', ')}.`
    };
  },
  population(c) {
    const d = distract(c, 3, x => x.n).filter(x => x.pop && Math.abs(Math.log10(x.pop / c.pop)) > 0.18);
    if (d.length < 3 || !c.pop) return null;
    const all = [c, ...d.slice(0, 3)];
    const biggest = all.reduce((a, b) => a.pop > b.pop ? a : b);
    return {
      type: 'population', c, tag: 'Population',
      prompt: 'Which of these countries has the largest population?',
      options: shuffle(all.map(x => opt(x.n, x === biggest, { flag: x.fl }))),
      after: `${biggest.n} — ${fmtNum(biggest.pop)} people.`,
      cOverride: biggest
    };
  },
  /* negative filtering */
  elimination(c) {
    const kinds = shuffle(['lang', 'cur', 'rel', 'reg', 'landlocked', 'fam']);
    for (const kind of kinds) {
      const q = elimBuild(c, kind);
      if (q) return q;
    }
    return null;
  },
  find(c) {
    return { type: 'find', c, tag: 'Locate', mapClick: true, prompt: `Find <em>${c.n}</em> on the map`, flagBig: c.fl, after: `${c.n} — capital ${c.cap}.` };
  }
};

function elimBuild(c, kind) {
  const spec = {
    lang: { key: x => x.lang, label: v => `have <em>${v}</em> as an official language`, bad: '—' },
    cur: { key: x => x.curN, label: v => `use the <em>${v}</em>`, bad: '—' },
    rel: { key: x => x.rel, label: v => `are predominantly <em>${v}</em>`, bad: 'Various' },
    reg: { key: x => x.reg, label: v => `lie in <em>${v}</em>`, bad: '' },
    fam: { key: x => x.fam, label: v => `speak an <em>${v}</em> language`, bad: 'Other families' },
    landlocked: { key: x => x.ll_ ? 'landlocked' : 'coastal', label: v => v === 'landlocked' ? 'are <em>landlocked</em>' : 'have a <em>sea coast</em>', bad: '' }
  }[kind];
  const v = spec.key(c);
  if (!v || v === spec.bad) return null;
  const same = shuffle(STUDY.filter(x => x !== c && spec.key(x) === v));
  if (same.length < 2) return null;
  const odd = rnd(STUDY.filter(x => spec.key(x) && spec.key(x) !== v && spec.key(x) !== spec.bad &&
    (kind === 'reg' ? true : x.reg === c.reg || Math.random() < .4)));
  if (!odd) return null;
  const group = [c, same[0], same[1]];
  const verbTxt = spec.label(v);
  return {
    type: 'elimination', c: odd, tag: 'Elimination',
    prompt: `Three of these four ${verbTxt}. Which one does <em>not</em>?`,
    options: shuffle([...group.map(x => opt(x.n, 0, { flag: x.fl })), opt(odd.n, 1, { flag: odd.fl })]),
    after: `${odd.n} — ${spec.key(odd)}. The other three: ${v}.`,
    highlight: shuffle([...group, odd])
  };
}

/* ---------- matching rounds (cross-data bridging) ---------- */
function buildMatch(kind) {
  const N = 5;
  if (kind === 'flagCurrency') {
    const pool = shuffle(STUDY.filter(c => c.curN !== '—' && c.fl));
    const picked = []; const used = new Set();
    for (const c of pool) { if (picked.length >= N) break; if (used.has(c.curN)) continue; used.add(c.curN); picked.push(c); }
    return {
      kind, title: 'Flag → Currency',
      hint: 'Tap a flag, then the money it buys.',
      left: picked.map(c => ({ id: c.a3, big: c.fl, sub: '' })),
      right: shuffle(picked.map(c => ({ id: c.a3, label: c.curN, sub: c.curC }))),
      reveal: picked.map(c => `${c.fl} ${c.n} → ${c.curN}`)
    };
  }
  // religion ↔ language
  const groups = {};
  STUDY.forEach(c => { if (c.lang !== '—' && c.rel) { const k = c.rel + '|' + c.lang; if (!groups[k]) groups[k] = c; } });
  const picked = []; const usedR = new Set(), usedL = new Set();
  for (const c of shuffle(Object.values(groups))) {
    if (picked.length >= N) break;
    if (usedR.has(c.rel) || usedL.has(c.lang)) continue;
    usedR.add(c.rel); usedL.add(c.lang); picked.push(c);
  }
  return {
    kind: 'religionLanguage', title: 'Faith → Tongue',
    hint: 'Match the dominant religion to the language spoken alongside it.',
    left: picked.map(c => ({ id: c.a3, label: c.rel, sub: '' })),
    right: shuffle(picked.map(c => ({ id: c.a3, label: c.lang, sub: '' }))),
    reveal: picked.map(c => `${c.rel} ↔ ${c.lang} (${c.fl} ${c.n})`)
  };
}

/* ---------- travel route ---------- */
function buildRoute(minHops, maxHops) {
  const adj = {};
  LIST.forEach(c => adj[c.a3] = c.nb);
  const starts = shuffle(STUDY.filter(c => c.nb.length >= 2 && c.pop > 2e6));
  for (const s of starts.slice(0, 60)) {
    // BFS to find a target at the desired distance
    const dist = { [s.a3]: 0 }, prev = {};
    const q = [s.a3];
    const found = [];
    while (q.length) {
      const cur = q.shift();
      if (dist[cur] >= minHops && dist[cur] <= maxHops) found.push(cur);
      if (dist[cur] >= maxHops) continue;
      for (const n of adj[cur]) if (!(n in dist)) { dist[n] = dist[cur] + 1; prev[n] = cur; q.push(n); }
    }
    const cands = found.filter(a => BY3[a].pop > 1e6 && BY3[a].cap !== '—' && dist[a] >= minHops);
    if (!cands.length) continue;
    const tgt = rnd(cands);
    const path = [tgt];
    while (prev[path[0]]) path.unshift(prev[path[0]]);
    if (path.length - 1 < minHops) continue;
    if (path.some(a => BY3[a].cap === '—')) continue;
    return { from: BY3[path[0]], to: BY3[path[path.length - 1]], path: path.map(a => BY3[a]), adj };
  }
  return null;
}

/* ---------- weighted picker ---------- */
function weightOf(c, prog) {
  const p = prog[c.a3];
  if (!p) return 3;
  if (p.st === 2) return 0.7;      // mastered — surfaces rarely
  if (p.st === 1) return 4;        // learning — surfaces most
  return 2.6;
}
function pickCountry(prog, filter) {
  const pool = (filter ? STUDY.filter(filter) : STUDY);
  let total = 0; const ws = pool.map(c => { const w = weightOf(c, prog); total += w; return w; });
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

const QUICK_TYPES = ['capital', 'capitalRev', 'flag', 'flagPick', 'currency', 'language', 'religion', 'neighbour', 'population'];
const ALL_TYPES = QUICK_TYPES.concat(['flagDesc', 'shapeDesc', 'elimination', 'find']);

function makeQuestion(types, prog, filter) {
  for (let i = 0; i < 40; i++) {
    const c = pickCountry(prog, filter);
    const t = rnd(types);
    const q = GEN[t] && GEN[t](c);
    if (q) return q;
  }
  return GEN.flag(rnd(STUDY.slice(0, 80)));
}
