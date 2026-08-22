/* ============================================================
   MAP — canvas renderer + camera + interaction
   ============================================================ */
const cv = document.getElementById('map');
const ctx = cv.getContext('2d');
const stage = document.getElementById('stage');

const MAP = {
  cx: 0.5, cy: 0.46, z: 900,
  tcx: 0.5, tcy: 0.46, tz: 900,
  W: 0, H: 0, dpr: 1,
  hover: null, sel: null,
  colorFor: () => null,          // app supplies
  strokeFor: () => null,
  onHover: () => {}, onClick: () => {},
  compare: null,                 // {c, lon, lat, dragging}
  pins: true,
  labels: true,
  anim: false
};

function resize() {
  const r = stage.getBoundingClientRect();
  MAP.dpr = Math.min(window.devicePixelRatio || 1, 2);
  MAP.W = r.width; MAP.H = r.height;
  cv.width = Math.round(r.width * MAP.dpr);
  cv.height = Math.round(r.height * MAP.dpr);
  cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  clampCam();
  draw();
}
new ResizeObserver(resize).observe(stage);

function minZoom() { return Math.min(MAP.W / 0.99, MAP.H / 0.70); }
const wrap1 = v => ((v % 1) + 1) % 1;
function clampZ(z) { const mz = minZoom() * 0.78; return Math.max(mz, Math.min(mz * 320, z)); }
function clampY(cy, z) {
  const halfH = MAP.H / 2 / z;
  const lo = Math.min(0.5, halfH), hi = Math.max(0.5, 1 - halfH);
  return Math.max(lo, Math.min(hi, cy));
}
/* each of the two cameras (live and target) is clamped against its OWN zoom,
   so flying to a small country isn't vetoed by the wide-angle limits */
function clampCam() {
  MAP.z = clampZ(MAP.z);   MAP.cy = clampY(MAP.cy, MAP.z);
  MAP.tz = clampZ(MAP.tz); MAP.tcy = clampY(MAP.tcy, MAP.tz);
}

/* ---- camera helpers ---- */
function s2w(sx, sy) {
  return [(sx - MAP.W / 2) / MAP.z + MAP.cx, (sy - MAP.H / 2) / MAP.z + MAP.cy];
}
function w2s(wx, wy) {
  let dx = wx - wrap1(MAP.cx);
  dx -= Math.round(dx);                       // shortest way round the globe
  return [dx * MAP.z + MAP.W / 2, (wy - MAP.cy) * MAP.z + MAP.H / 2];
}
function easeTo(cx, cy, z, instant) {
  MAP.tcx = cx; MAP.tcy = cy; MAP.tz = z;
  // take the shortest way round the globe rather than scrolling across it
  MAP.cx = wrap1(MAP.cx);
  if (Math.abs(MAP.tcx - MAP.cx) > 0.5) MAP.tcx += MAP.tcx < MAP.cx ? 1 : -1;
  clampCam();
  if (instant) { MAP.cx = wrap1(MAP.tcx); MAP.tcx = MAP.cx; MAP.cy = MAP.tcy; MAP.z = MAP.tz; draw(); }
  else startAnim();
}
function startAnim() {
  if (MAP.anim) return;
  MAP.anim = true;
  const step = () => {
    const k = 0.19;
    MAP.cx += (MAP.tcx - MAP.cx) * k;
    MAP.cy += (MAP.tcy - MAP.cy) * k;
    MAP.z *= Math.pow(MAP.tz / MAP.z, k);
    const done = Math.abs(MAP.tcx - MAP.cx) < 1e-5 && Math.abs(MAP.tcy - MAP.cy) < 1e-5 && Math.abs(1 - MAP.tz / MAP.z) < 1e-3;
    if (done) {
      MAP.cx = MAP.tcx = wrap1(MAP.tcx);
      MAP.cy = MAP.tcy; MAP.z = MAP.tz; MAP.anim = false; draw();
    }
    else { draw(); requestAnimationFrame(step); }
  };
  requestAnimationFrame(step);
}
function flyTo(c, pad) {
  if (!c) return;
  if (!c.bbox || c.micro) { easeTo(c.cx, c.cy, minZoom() * 34); return; }
  const x0 = mx(c.bbox[0]), x1 = mx(c.bbox[2]);
  const y0 = my(c.bbox[3]), y1 = my(c.bbox[1]);
  const w = Math.max(x1 - x0, 0.004), h = Math.max(y1 - y0, 0.004);
  const p = pad || 0.55;
  const z = Math.min(MAP.W / w * p, MAP.H / h * p);
  easeTo((x0 + x1) / 2, (y0 + y1) / 2, Math.max(minZoom() * 0.8, z));
}

/* ---- drawing ---- */
function setT(k) {
  const d = MAP.dpr, z = MAP.z, cx = wrap1(MAP.cx);
  ctx.setTransform(z * d, 0, 0, z * d,
    (MAP.W / 2 - cx * z + k * z) * d, (MAP.H / 2 - MAP.cy * z) * d);
}

function graticule() {
  const z = MAP.z;
  let step = 30;
  if (z > minZoom() * 3) step = 10;
  if (z > minZoom() * 10) step = 5;
  if (z > minZoom() * 30) step = 1;
  ctx.save();
  ctx.setTransform(MAP.dpr, 0, 0, MAP.dpr, 0, 0);
  ctx.strokeStyle = 'rgba(78,169,201,.075)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let lat = -80; lat <= 80; lat += step) {
    const y = w2s(0, my(lat))[1];
    if (y < -20 || y > MAP.H + 20) continue;
    ctx.moveTo(0, y); ctx.lineTo(MAP.W, y);
  }
  for (let lon = -180; lon < 180; lon += step) {
    const x = w2s(mx(lon), 0)[0];
    if (x < -20 || x > MAP.W + 20) continue;
    ctx.moveTo(x, 0); ctx.lineTo(x, MAP.H);
  }
  ctx.stroke();
  // equator + prime meridian slightly stronger
  ctx.strokeStyle = 'rgba(78,169,201,.16)';
  ctx.beginPath();
  const ey = w2s(0, my(0))[1];
  ctx.moveTo(0, ey); ctx.lineTo(MAP.W, ey);
  const px = w2s(mx(0), 0)[0];
  ctx.moveTo(px, 0); ctx.lineTo(px, MAP.H);
  ctx.stroke();
  ctx.restore();
}

function draw() {
  if (!MAP.W) return;
  const d = MAP.dpr;
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, MAP.W, MAP.H);
  ctx.fillStyle = '#080D13';
  ctx.fillRect(0, 0, MAP.W, MAP.H);
  graticule();

  const lw = 0.9 / MAP.z;
  const copies = MAP.z * 1 < MAP.W * 1.6 ? [-1, 0, 1] : [0];

  for (const k of copies) {
    setT(k);
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#16222D';
    for (const g of CONTEXT) ctx.fill(g.path);
    for (const c of LIST) {
      if (!c.path || c.micro) continue;
      const f = MAP.colorFor(c);
      if (f === null) continue;
      ctx.fillStyle = f;
      ctx.fill(c.path);
    }
    // borders on top so fills never bleed into each other
    ctx.lineWidth = lw;
    for (const c of LIST) {
      if (!c.path || c.micro) continue;
      const s = MAP.strokeFor(c);
      if (!s) continue;
      ctx.strokeStyle = s[0];
      ctx.lineWidth = (s[1] || 0.9) / MAP.z;
      ctx.stroke(c.path);
    }
    if (MAP.compare) drawCompare(k);
  }

  ctx.setTransform(d, 0, 0, d, 0, 0);
  if (MAP.pins) drawPins();
  drawLabels();
  updateScale();
}

function comparePath() {
  const cmp = MAP.compare;
  const p = new Path2D();
  for (const r of cmp.rings) {
    let started = false, prev = null;
    for (const pt of r) {
      if (prev && Math.abs(pt[0] - prev[0]) > 180) started = false;
      const X = mx(pt[0]), Y = my(pt[1]);
      if (!started) { p.moveTo(X, Y); started = true; } else p.lineTo(X, Y);
      prev = pt;
    }
    p.closePath();
  }
  return p;
}
function insideCompare(sx, sy) {
  if (!MAP.compare) return false;
  const p = comparePath(), d = MAP.dpr;
  for (const k of [0, -1, 1]) {
    setT(k);
    if (ctx.isPointInPath(p, sx * d, sy * d)) { ctx.setTransform(d, 0, 0, d, 0, 0); return true; }
  }
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return false;
}
function drawCompare(k) {
  const cmp = MAP.compare;
  const rings = cmp.rings;
  ctx.beginPath();
  for (const r of rings) {
    let started = false, prev = null;
    for (const p of r) {
      if (prev && Math.abs(p[0] - prev[0]) > 180) started = false;
      const X = mx(p[0]), Y = my(p[1]);
      if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
      prev = p;
    }
    ctx.closePath();
  }
  ctx.fillStyle = 'rgba(232,163,61,.42)';
  ctx.fill();
  ctx.strokeStyle = '#F5CE86';
  ctx.lineWidth = 1.6 / MAP.z;
  ctx.stroke();
}

function drawPins() {
  for (const c of LIST) {
    if (!c.micro) continue;
    const col = MAP.colorFor(c);
    if (col === null) continue;
    const [x, y] = w2s(c.cx, c.cy);
    if (x < -14 || x > MAP.W + 14 || y < -14 || y > MAP.H + 14) continue;
    const r = MAP.sel === c ? 6.5 : (MAP.hover === c ? 5.6 : 4.2);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fillStyle = col === '#31485A' ? '#68889D' : col;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(8,13,19,.9)';
    ctx.stroke();
  }
}

function drawLabels() {
  const z = MAP.z, base = minZoom();
  if (!MAP.labels || z < base * 1.4) return;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const shown = [];
  const cands = LIST.filter(c => c.bbox && !c.micro).sort((a, b) => (b.area || 0) - (a.area || 0));
  for (const c of cands) {
    const w = (mx(c.bbox[2]) - mx(c.bbox[0])) * z;
    if (w < 46) continue;
    const [x, y] = w2s(c.cx, c.cy);
    if (x < 0 || x > MAP.W || y < 0 || y > MAP.H) continue;
    const size = Math.max(10, Math.min(14, w / 7));
    ctx.font = `500 ${size}px ${getComputedStyle(document.body).getPropertyValue('--f-ui')}`;
    const tw = ctx.measureText(c.n).width;
    if (tw > w * 1.05) continue;
    let clash = false;
    for (const s of shown) if (Math.abs(s[0] - x) < (s[2] + tw) / 2 + 6 && Math.abs(s[1] - y) < 15) { clash = true; break; }
    if (clash) continue;
    shown.push([x, y, tw]);
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,13,19,.85)';
    ctx.strokeText(c.n, x, y);
    ctx.fillStyle = 'rgba(230,238,243,.9)';
    ctx.fillText(c.n, x, y);
  }
}

function updateScale() {
  const lat = unMy(MAP.cy);
  const kmPerPx = 40075 * Math.cos(lat * Math.PI / 180) / MAP.z;
  let target = kmPerPx * 90;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const nice = [1, 2, 5, 10].map(m => m * pow).find(v => v >= target) || pow * 10;
  const px = nice / kmPerPx;
  const el = document.getElementById('scale-bar');
  el.style.width = Math.round(px) + 'px';
  document.getElementById('scale-label').textContent =
    (nice >= 1 ? nice.toLocaleString() : nice) + ' km';
}

/* ---- hit testing ---- */
function pick(sx, sy) {
  const d = MAP.dpr;
  // micro-state pins first (they sit on top)
  let bestPin = null, bestD = 9;
  for (const c of LIST) {
    if (!c.micro) continue;
    const [x, y] = w2s(c.cx, c.cy);
    const dd = Math.hypot(x - sx, y - sy);
    if (dd < bestD) { bestD = dd; bestPin = c; }
  }
  if (bestPin) return bestPin;
  const px = sx * d, py = sy * d;
  for (const k of [0, -1, 1]) {
    setT(k);
    for (const c of LIST) {
      if (!c.path || c.micro) continue;
      if (ctx.isPointInPath(c.path, px, py)) { ctx.setTransform(d, 0, 0, d, 0, 0); return c; }
    }
  }
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return null;
}

/* ---- interaction ---- */
let drag = null, moved = false, pointers = new Map(), pinchStart = null;

cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (pointers.size === 2) {
    const p = [...pointers.values()];
    pinchStart = { d: Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]), z: MAP.z };
    drag = null; return;
  }
  if (MAP.compare && insideCompare(e.offsetX, e.offsetY)) {
    MAP.compare.dragging = true; moved = false; return;
  }
  drag = { x: e.offsetX, y: e.offsetY, cx: MAP.cx, cy: MAP.cy };
  moved = false;
  cv.classList.add('dragging');
});

cv.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.offsetX, e.offsetY]);
  if (pointers.size === 2 && pinchStart) {
    const p = [...pointers.values()];
    const nd = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]);
    MAP.tz = MAP.z = pinchStart.z * (nd / pinchStart.d);
    clampCam(); draw(); return;
  }
  if (MAP.compare && MAP.compare.dragging) {
    const [wx, wy] = s2w(e.offsetX, e.offsetY);
    MAP.compare.lon = unMx(((wx % 1) + 1) % 1);
    MAP.compare.lat = unMy(Math.max(0.001, Math.min(0.999, wy)));
    MAP.compare.rings = trueSizeRings(MAP.compare.c, MAP.compare.lon, MAP.compare.lat);
    moved = true; draw(); if (MAP.onCompareMove) MAP.onCompareMove();
    return;
  }
  if (drag) {
    const dx = (e.offsetX - drag.x) / MAP.z, dy = (e.offsetY - drag.y) / MAP.z;
    if (Math.abs(e.offsetX - drag.x) + Math.abs(e.offsetY - drag.y) > 3) moved = true;
    MAP.cx = MAP.tcx = drag.cx - dx;
    MAP.cy = MAP.tcy = drag.cy - dy;
    clampCam(); draw();
    return;
  }
  const c = pick(e.offsetX, e.offsetY);
  if (c !== MAP.hover) { MAP.hover = c; MAP.onHover(c, e.offsetX, e.offsetY); draw(); }
  else if (c) MAP.onHover(c, e.offsetX, e.offsetY, true);
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  cv.classList.remove('dragging');
  if (MAP.compare && MAP.compare.dragging) { MAP.compare.dragging = false; return; }
  if (drag && !moved) {
    const c = pick(e.offsetX, e.offsetY);
    MAP.onClick(c, e);
  }
  drag = null;
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', () => { if (MAP.hover) { MAP.hover = null; MAP.onHover(null); draw(); } });

cv.addEventListener('wheel', e => {
  e.preventDefault();
  const [wx, wy] = s2w(e.offsetX, e.offsetY);
  const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016));
  const nz = MAP.z * f;
  MAP.z = MAP.tz = nz;
  clampCam();
  // keep the point under the cursor fixed
  MAP.cx = MAP.tcx = wx - (e.offsetX - MAP.W / 2) / MAP.z;
  MAP.cy = MAP.tcy = wy - (e.offsetY - MAP.H / 2) / MAP.z;
  clampCam(); draw();
}, { passive: false });

cv.addEventListener('dblclick', e => {
  const [wx, wy] = s2w(e.offsetX, e.offsetY);
  easeTo(wx, wy, MAP.z * 2.1);
});

document.getElementById('z-in').onclick = () => easeTo(MAP.cx, MAP.cy, MAP.z * 1.7);
document.getElementById('z-out').onclick = () => easeTo(MAP.cx, MAP.cy, MAP.z / 1.7);
document.getElementById('z-home').onclick = () => easeTo(0.5, 0.46, minZoom());
