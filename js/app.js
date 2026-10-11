/* ==========================================================================
   Passport Photo Maker & Print — application logic
   Everything runs locally on the device. No network, no uploads.
   ========================================================================== */
(() => {
'use strict';

/* ---------------------------------------------------------------- helpers */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const mmToPx = (mm, dpi) => Math.round((mm / 25.4) * dpi);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const toastEl = $('#toast');
let toastTimer;
function toast(msg, ms = 2000) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/* ------------------------------------------------------------------ sizes */
const SIZES = [
  { id: 'passport-in',  name: 'Passport — India',      wmm: 51,   hmm: 51,   cat: 'passport', note: 'Indian passport and many countries' },
  { id: 'passport-us',  name: 'Passport — US',         wmm: 50.8, hmm: 50.8, cat: 'passport', note: '2 × 2 inch — United States' },
  { id: 'passport-uk',  name: 'Passport — UK',         wmm: 35,   hmm: 45,   cat: 'passport', note: 'United Kingdom' },
  { id: 'visa-schengen',name: 'Visa — Schengen',       wmm: 35,   hmm: 45,   cat: 'visa',     note: 'Schengen area' },
  { id: 'visa-us',      name: 'Visa — US',             wmm: 50.8, hmm: 50.8, cat: 'visa',     note: '2 × 2 inch — United States' },
  { id: 'visa-ca',      name: 'Visa — Canada',         wmm: 35,   hmm: 45,   cat: 'visa',     note: 'Canada' },
  { id: 'dl-in',        name: 'Driving licence — India',wmm: 30,  hmm: 40,   cat: 'id',       note: 'Indian driving licence' },
  { id: 'pan-in',       name: 'PAN card — India',      wmm: 25,   hmm: 35,   cat: 'id',       note: 'Indian PAN card' },
  { id: 'aadhaar-in',   name: 'Aadhaar — India',       wmm: 35,   hmm: 45,   cat: 'id',       note: 'Aadhaar related documents' },
  { id: 'student',      name: 'Student ID',            wmm: 25,   hmm: 30,   cat: 'id',       note: 'School / college ID' },
  { id: 'custom',       name: 'Custom size',           wmm: 35,   hmm: 45,   cat: 'custom',   note: 'Set your own width, height and DPI' },
];
const sizeById = id => SIZES.find(s => s.id === id) || SIZES[0];

const PAPER = {
  '4R':     { w: 1200, h: 1800, label: '4R (4 × 6 in)' },
  'A4':     { w: 2480, h: 3508, label: 'A4 (210 × 297 mm)' },
  'Letter': { w: 2550, h: 3300, label: 'Letter (8.5 × 11 in)' },
};

/* ------------------------------------------------------------------ state */
const S = {
  source: null, srcW: 0, srcH: 0, name: 'photo',
  rot: 0, flip: false, zoom: 1, offX: 0, offY: 0,
  adj: { brightness: 0, contrast: 0, saturation: 0 },
  bg: 'keep', tol: 32,
  sizeId: 'passport-in', dpi: 300,
  copies: 6, paper: '4R', margin: 8, spacing: 4, cutlines: false,
  resultFull: null,        // full-resolution canvas of the finished photo
  view: 'home',
};

const prefs = Object.assign(
  { theme: 'auto', defSize: 'passport-in', defPaper: '4R', dpi: 300 },
  JSON.parse(localStorage.getItem('ppm.prefs') || '{}')
);
const savePrefs = () => localStorage.setItem('ppm.prefs', JSON.stringify(prefs));

const size = () => sizeById(S.sizeId);
const targetPx = (sz = size(), dpi = S.dpi) => ({ w: mmToPx(sz.wmm, dpi), h: mmToPx(sz.hmm, dpi) });
/** Working resolution for live editing — capped so dragging stays smooth. */
function workingPx(sz = size()) {
  const t = targetPx(sz, S.dpi);
  const m = Math.max(t.w, t.h);
  const k = m > 900 ? 900 / m : 1;
  return { w: Math.max(1, Math.round(t.w * k)), h: Math.max(1, Math.round(t.h * k)) };
}

/* --------------------------------------------------------------- rendering */
/** Draw the current photo into a W×H canvas honouring crop, zoom, rotation,
 *  flip and colour adjustments. Resolution independent. */
function renderPhoto(W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (!S.source) return c;

  const rad = (S.rot * Math.PI) / 180;
  const sw = S.srcW, sh = S.srcH;
  // bounding box of the rotated source
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const rw = sw * cos + sh * sin;
  const rh = sw * sin + sh * cos;
  const scale = Math.max(W / rw, H / rh) * S.zoom;   // "cover" fit

  const b = 1 + S.adj.brightness / 100;
  const ct = 1 + S.adj.contrast / 100;
  const st = 1 + S.adj.saturation / 100;

  ctx.save();
  ctx.translate(W / 2 + S.offX * W, H / 2 + S.offY * H);
  ctx.rotate(rad);
  ctx.scale(S.flip ? -scale : scale, scale);
  ctx.filter = `brightness(${b}) contrast(${ct}) saturate(${st})`;
  ctx.drawImage(S.source, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
  ctx.filter = 'none';
  return c;
}

/* ------------------------------------------------- background replacement */
/** Flood-fill from the border and repaint the matched region with `color`,
 *  with a soft feathered edge. Works well on plain, evenly lit backgrounds. */
function replaceBackground(canvas, color, tol) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data, n = W * H;

  // seed colour = the dominant colour cluster along the border, so that a
  // subject touching the edge does not drag the reference colour toward itself
  const buckets = new Map();
  const add = p => {
    const i = p * 4;
    const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
    let b = buckets.get(key);
    if (!b) { b = { r: 0, g: 0, b: 0, c: 0 }; buckets.set(key, b); }
    b.r += d[i]; b.g += d[i + 1]; b.b += d[i + 2]; b.c++;
  };
  for (let x = 0; x < W; x++) { add(x); add((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { add(y * W); add(y * W + W - 1); }
  let best = null;
  for (const b of buckets.values()) if (!best || b.c > best.c) best = b;
  const sr = best.r / best.c, sg = best.g / best.c, sb = best.b / best.c;

  const t = tol * tol * 3;
  const mask = new Uint8Array(n);
  const stack = [];
  const seed = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const p = y * W + x;
    if (mask[p]) return;
    const i = p * 4;
    const dr = d[i] - sr, dg = d[i + 1] - sg, db = d[i + 2] - sb;
    if (dr * dr + dg * dg + db * db <= t) { mask[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
  for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }
  while (stack.length) {
    const p = stack.pop(), x = p % W, y = (p - x) / W;
    seed(x + 1, y); seed(x - 1, y); seed(x, y + 1); seed(x, y - 1);
  }

  // mask -> canvas
  const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
  const mctx = mc.getContext('2d');
  const md = mctx.createImageData(W, H);
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    md.data[i] = 255; md.data[i + 1] = 255; md.data[i + 2] = 255;
    md.data[i + 3] = mask[p] ? 255 : 0;   // alpha is what destination-in reads
  }
  mctx.putImageData(md, 0, 0);

  // colour layer, shaped by the (blurred) mask for a soft edge
  const lc = document.createElement('canvas'); lc.width = W; lc.height = H;
  const lctx = lc.getContext('2d');
  lctx.fillStyle = color; lctx.fillRect(0, 0, W, H);
  lctx.globalCompositeOperation = 'destination-in';
  lctx.filter = 'blur(2px)';
  lctx.drawImage(mc, 0, 0);

  ctx.drawImage(lc, 0, 0);
}

/** Produce the finished photo: render at the given resolution and optionally
 *  apply the background replacement. */
function buildResult(dpi = S.dpi) {
  const { w, h } = targetPx(size(), dpi);
  const c = renderPhoto(w, h);
  if (S.bg !== 'keep' && S.source) {
    try { replaceBackground(c, S.bg, S.tol); }
    catch (e) { console.warn('background replacement failed', e); }
  }
  return c;
}

/* --------------------------------------------------------------- analysis */
function analyse(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const d = ctx.getImageData(0, 0, W, H).data;
  const lum = i => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

  // border uniformity — sample the left and right side strips, which is where
  // the background actually sits in an ID photo (the head usually meets the top)
  let sum = 0, sum2 = 0, n = 0;
  const scan = p => { const l = lum(p * 4); sum += l; sum2 += l * l; n++; };
  const stripW = Math.max(2, Math.round(W * 0.07));
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < stripW; x++) { scan(y * W + x); scan(y * W + (W - 1 - x)); }
  }
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));

  // centre brightness (roughly the face area)
  let cs = 0, cn = 0;
  const x0 = Math.floor(W * 0.3), x1 = Math.floor(W * 0.7);
  const y0 = Math.floor(H * 0.25), y1 = Math.floor(H * 0.6);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { cs += lum((y * W + x) * 4); cn++; }
  const face = cs / Math.max(1, cn);

  // how much the source is being stretched
  const rad = (S.rot * Math.PI) / 180;
  const rw = S.srcW * Math.abs(Math.cos(rad)) + S.srcH * Math.abs(Math.sin(rad));
  const rh = S.srcW * Math.abs(Math.sin(rad)) + S.srcH * Math.abs(Math.cos(rad));
  const scale = Math.max(W / rw, H / rh) * S.zoom;

  return { sd, face, scale, mean };
}

/* -------------------------------------------------------- minimal PDF writer */
/** Build a one-page PDF with an embedded JPEG. No dependencies. */
function buildPdf(jpegBytes, pxW, pxH) {
  const ptW = (pxW * 72) / 300, ptH = (pxH * 72) / 300;
  const enc = new TextEncoder();
  const parts = []; let len = 0; const off = [];
  const raw = s => { const b = enc.encode(s); parts.push(b); len += b.length; };
  const bin = b => { parts.push(b); len += b.length; };
  const obj = (n, body) => { off[n] = len; raw(n + ' 0 obj\n' + body + '\nendobj\n'); };

  raw('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW.toFixed(2)} ${ptH.toFixed(2)}] ` +
         `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  off[4] = len;
  raw(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
  bin(jpegBytes);
  raw('\nendstream\nendobj\n');
  const content = `q ${ptW.toFixed(2)} 0 0 ${ptH.toFixed(2)} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  raw('xref\n0 6\n0000000000 65535 f \n');
  for (let i = 1; i <= 5; i++) raw(String(off[i]).padStart(10, '0') + ' 00000 n \n');
  raw(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(len);
  let p = 0; for (const b of parts) { out.set(b, p); p += b.length; }
  return out;
}
const dataUrlToBytes = url => {
  const b64 = url.split(',')[1];
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const slug = s => (s || 'photo').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ------------------------------------------------------------------ storage */
const DB_NAME = 'passport-photo-maker', DB_STORE = 'photos';
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(DB_STORE)) {
        const st = d.createObjectStore(DB_STORE, { keyPath: 'id' });
        st.createIndex('createdAt', 'createdAt');
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(DB_STORE, mode);
    const st = t.objectStore(DB_STORE);
    const out = fn(st);
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
  });
}
const storeAdd   = rec => tx('readwrite', st => st.put(rec));
const storeAll   = () => tx('readonly',  st => st.getAll());
const storeDel   = id => tx('readwrite', st => st.delete(id));
const storeClear = () => tx('readwrite', st => st.clear());

/* ------------------------------------------------------------------- router */
const VIEW_META = {
  home:     { title: 'Passport Photo Maker', sub: 'Perfect ID photos, ready in minutes', back: null,      tab: 'home' },
  camera:   { title: 'Camera',               sub: 'Position your face in the frame',     back: 'home',    tab: null },
  editor:   { title: 'Crop & adjust',        sub: '',                                    back: 'home',    tab: null },
  preview:  { title: 'Preview',              sub: '',                                    back: 'editor',  tab: null },
  sizes:    { title: 'ID photo sizes',       sub: 'Choose a document size',              back: 'home',    tab: null },
  print:    { title: 'Print sheet',          sub: '',                                    back: 'preview', tab: 'print' },
  photos:   { title: 'My photos',            sub: 'Saved on this device',                back: null,      tab: 'photos' },
  settings: { title: 'Settings',             sub: 'App preferences',                     back: null,      tab: 'settings' },
};
const views = $$('.view');
function go(view) {
  const meta = VIEW_META[view] || VIEW_META.home;
  S.view = view;
  views.forEach(v => v.classList.toggle('active', v.dataset.view === view));
  $('#appTitle').childNodes[0].nodeValue = meta.title;
  $('#appSub').textContent = view === 'editor' || view === 'preview' || view === 'print'
    ? size().name : meta.sub;
  $('#backBtn').classList.toggle('hidden', !meta.back);
  // the camera is immersive: its shutter sits where the floating tab bar would be
  $('#tabbar').classList.toggle('hidden', view === 'camera');
  $$('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.goto === meta.tab));
  const host = $(`.view[data-view="${view}"]`);
  if (host) host.scrollTop = 0;
  onEnter(view);
}
function onEnter(view) {
  if (view === 'camera') startCamera();
  else stopCamera();
  if (view === 'editor') { renderStage(); }
  if (view === 'preview') { refreshPreview(); }
  if (view === 'print') { refreshSheet(); }
  if (view === 'photos') { renderGallery(); }
  if (view === 'settings') { refreshSettings(); }
  if (view === 'home') { renderHome(); }
}

/* ------------------------------------------------------------------ editor */
const stage = $('#stage'), stageCanvas = $('#stageCanvas');
let stageRatio = 1;   // canvas px per css px

function renderStage() {
  if (!S.source) return;
  const { w, h } = workingPx();
  const c = renderPhoto(w, h);
  stageCanvas.width = w; stageCanvas.height = h;
  stageCanvas.getContext('2d').drawImage(c, 0, 0);
  // apply background preview on the working copy
  if (S.bg !== 'keep') { try { replaceBackground(stageCanvas, S.bg, S.tol); } catch (e) {} }
  stageRatio = w / Math.max(1, stage.clientWidth);
  $('#zoomOut').textContent = S.zoom.toFixed(1) + '×';
  $('#zoomRange').value = Math.round(S.zoom * 100);
  paintRange($('#zoomRange'));
}

function resetTransform() {
  S.rot = 0; S.flip = false; S.zoom = 1; S.offX = 0; S.offY = 0;
  S.adj = { brightness: 0, contrast: 0, saturation: 0 };
  S.bg = 'keep'; S.tol = 32;
  $$('[data-adj]').forEach(r => { r.value = 0; const o = r.parentElement.querySelector('[data-out]'); if (o) o.textContent = '0'; paintRange(r); });
  $('#tolRange').value = 32; $('#tolOut').textContent = '32'; paintRange($('#tolRange'));
  $$('#swatches .swatch').forEach((s, i) => s.classList.toggle('active', i === 0));
}

/* drag / pinch */
let drag = null;
stage.addEventListener('pointerdown', e => {
  if (!S.source) return;
  stage.setPointerCapture(e.pointerId);
  stage.classList.add('grabbing');
  drag = { x: e.clientX, y: e.clientY, ox: S.offX, oy: S.offY, moved: false };
});
stage.addEventListener('pointermove', e => {
  if (!drag) return;
  const r = stage.getBoundingClientRect();
  const dx = (e.clientX - drag.x) / r.width;
  const dy = (e.clientY - drag.y) / r.height;
  if (Math.abs(dx) + Math.abs(dy) > 0.002) drag.moved = true;
  S.offX = drag.ox + dx;
  S.offY = drag.oy + dy;
  renderStage();
});
const endDrag = () => { drag = null; stage.classList.remove('grabbing'); };
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('wheel', e => {
  if (!S.source) return;
  e.preventDefault();
  S.zoom = clamp(S.zoom * (e.deltaY > 0 ? 0.94 : 1.06), 1, 4);
  renderStage();
}, { passive: false });

/* ---------------------------------------------------------------- preview */
function refreshPreview() {
  if (!S.source) { toast('No photo yet — take or choose one first'); go('home'); return; }
  S.resultFull = buildResult(S.dpi);
  const rc = $('#resultCanvas');
  const { w, h } = workingPx();
  rc.width = w; rc.height = h;
  rc.getContext('2d').drawImage(S.resultFull, 0, 0, w, h);

  const sz = size();
  const t = targetPx(sz, S.dpi);
  $('#resultCaption').textContent = `${sz.name} · ${sz.wmm} × ${sz.hmm} mm`;
  $('#specSize').textContent = `${sz.wmm} × ${sz.hmm} mm`;
  $('#specPx').textContent = `${t.w} × ${t.h} px @ ${S.dpi} DPI`;
  $('#specBg').textContent = S.bg === 'keep' ? 'Original' : S.bg;

  // checks
  const a = analyse(S.resultFull);
  const checks = [];
  if (a.scale <= 1.05) checks.push(['ok', 'Resolution', `Source ${S.srcW}×${S.srcH} — enough detail for ${t.w}×${t.h} px`]);
  else if (a.scale <= 1.4) checks.push(['warn', 'Resolution', `Slightly upscaled (${a.scale.toFixed(2)}×) — acceptable but a larger photo is better`]);
  else checks.push(['bad', 'Resolution', `Heavily upscaled (${a.scale.toFixed(2)}×) — may look soft when printed`]);

  if (a.sd < 26) checks.push(['ok', 'Background', 'Plain and evenly lit']);
  else if (a.sd < 55) checks.push(['warn', 'Background', 'Some texture or shadow behind you']);
  else checks.push(['bad', 'Background', 'Busy background — try a plain wall or replace it']);

  if (a.face > 95 && a.face < 195) checks.push(['ok', 'Lighting', 'Face is well exposed']);
  else if (a.face <= 95) checks.push(['warn', 'Lighting', 'Face looks dark — raise brightness or add light']);
  else checks.push(['warn', 'Lighting', 'Face looks bright — reduce brightness or move from direct light']);

  $('#checks').innerHTML = checks.map(([k, t2, d]) => {
    const icon = k === 'ok'
      ? '<path d="M4 12l5 5 11-11"/>'
      : k === 'warn' ? '<path d="M12 8v5M12 16h.01"/>' : '<path d="M6 6l12 12M18 6L6 18"/>';
    return `<div class="check"><div class="dot ${k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></div><div><b>${t2}</b><small>${d}</small></div></div>`;
  }).join('');
}

/* ------------------------------------------------------------------ sheet */
let sheetCache = null;
function composeSheet() {
  const p = PAPER[S.paper];
  const c = document.createElement('canvas');
  c.width = p.w; c.height = p.h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, p.w, p.h);
  if (!S.source) return c;

  const photo = S.resultFull || buildResult(S.dpi);
  const sz = size();
  const pw = mmToPx(sz.wmm, 300), ph = mmToPx(sz.hmm, 300);
  const mg = mmToPx(S.margin, 300), sp = mmToPx(S.spacing, 300);
  const availW = p.w - 2 * mg, availH = p.h - 2 * mg;
  const cols = Math.max(1, Math.floor((availW + sp) / (pw + sp)));
  const rows = Math.max(1, Math.floor((availH + sp) / (ph + sp)));
  const capacity = cols * rows;
  const count = Math.min(S.copies, capacity);

  const totalW = cols * pw + (cols - 1) * sp;
  const totalH = rows * ph + (rows - 1) * sp;
  const startX = Math.round((p.w - totalW) / 2);
  const startY = Math.round((p.h - totalH) / 2);

  for (let i = 0; i < count; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    const x = startX + col * (pw + sp);
    const y = startY + row * (ph + sp);
    ctx.drawImage(photo, x, y, pw, ph);
    if (S.cutlines) {
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.lineWidth = Math.max(1, Math.round(300 / 300));
      ctx.strokeRect(x + 0.5, y + 0.5, pw - 1, ph - 1);
    }
  }
  sheetCache = { canvas: c, cols, rows, count, capacity };
  return c;
}
function refreshSheet() {
  const c = composeSheet();
  const sc = $('#sheetCanvas');
  const k = 600 / c.width;
  sc.width = 600; sc.height = Math.round(c.height * k);
  sc.getContext('2d').drawImage(c, 0, 0, sc.width, sc.height);
  if (sheetCache) {
    $('#sheetCaption').textContent =
      `${sheetCache.count} ${sheetCache.count === 1 ? 'copy' : 'copies'} · ` +
      `${sheetCache.cols} × ${sheetCache.rows} grid on ${PAPER[S.paper].label} · 300 DPI`;
    if (S.copies > sheetCache.capacity) {
      $('#sheetCaption').textContent += ` (max ${sheetCache.capacity} on this paper)`;
    }
  }
}

/* ---------------------------------------------------------------- gallery */
function renderGallery() {
  storeAll().then(recs => {
    recs = (recs || []).sort((a, b) => b.createdAt - a.createdAt);
    const filtered = recs.filter(r => galFilter === 'all' || r.cat === galFilter);
    const g = $('#gallery');
    g.innerHTML = '';
    $('#galEmpty').classList.toggle('hidden', filtered.length > 0);
    filtered.forEach(r => {
      const el = document.createElement('div');
      el.className = 'pcard';
      el.innerHTML = `<div class="ph" style="background-image:url('${r.thumb}')"><span class="badge">${r.sizeName}</span></div>
        <div class="meta"><b>${r.sizeName}</b><small>${r.wmm} × ${r.hmm} mm · ${new Date(r.createdAt).toLocaleDateString()}</small></div>`;
      el.addEventListener('click', () => openPhoto(r));
      g.appendChild(el);
    });
  }).catch(() => toast('Could not read saved photos'));
}
let galFilter = 'all';
function openPhoto(r) {
  showModal(`<img src="${r.full}" alt="${r.sizeName} photo">
    <h3>${r.sizeName}</h3>
    <p>${r.wmm} × ${r.hmm} mm · saved ${new Date(r.createdAt).toLocaleString()}</p>
    <div class="btns">
      <button class="btn" id="mDownload">Download</button>
      <button class="btn" id="mShare">Share</button>
    </div>
    <button class="btn btn-danger" style="margin-top:12px" id="mDelete">Delete photo</button>`);
  $('#mDownload').onclick = () => {
    fetch(r.full).then(x => x.blob()).then(b => download(b, `${slug(r.sizeName)}.jpg`));
    toast('Downloading');
  };
  $('#mShare').onclick = () => shareDataUrl(r.full, `${slug(r.sizeName)}.jpg`);
  $('#mDelete').onclick = () => {
    storeDel(r.id).then(() => { closeModal(); renderGallery(); refreshSettings(); toast('Photo deleted'); });
  };
}

/* ------------------------------------------------------------- modal + share */
const scrim = $('#scrim'), modal = $('#modal');
function showModal(html) { modal.innerHTML = html; scrim.classList.add('show'); }
function closeModal() { scrim.classList.remove('show'); }
scrim.addEventListener('click', e => { if (e.target === scrim) closeModal(); });

async function shareDataUrl(dataUrl, filename) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: blob.type || 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Passport photo' });
      return;
    }
    if (navigator.share) { await navigator.share({ title: 'Passport photo', text: 'My ID photo' }); return; }
    download(blob, filename); toast('Sharing not supported — downloaded instead');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast('Could not share on this device');
  }
}

/* ------------------------------------------------------------------ camera */
const video = $('#video');
let stream = null, facing = 'user';
async function startCamera() {
  if (stream) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast('Camera not available — use Gallery instead', 3200);
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    $('#camTip').textContent = 'Keep your face in the frame';
  } catch (e) {
    stopCamera();
    const msg = e && e.name === 'NotAllowedError'
      ? 'Camera permission denied. You can still choose a photo from your gallery.'
      : 'Could not start the camera. Try choosing a photo from your gallery.';
    showModal(`<h3>Camera unavailable</h3><p>${msg}</p>
      <div class="btns"><button class="btn" id="mGallery">Open gallery</button>
      <button class="btn btn-primary" id="mOk">OK</button></div>`);
    $('#mOk').onclick = closeModal;
    $('#mGallery').onclick = () => { closeModal(); $('#fileInput').click(); };
  }
}
function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  video.srcObject = null;
}
async function capture() {
  if (!video.videoWidth) { toast('Camera is not ready yet'); return; }
  const w = video.videoWidth, h = video.videoHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(video, 0, 0, w, h);
  stopCamera();
  setSource(c, 'camera');
  toast('Captured');
}

/* ------------------------------------------------------------ source loading */
function setSource(src, name) {
  S.source = src;
  S.srcW = src.width; S.srcH = src.height;
  S.name = name || 'photo';
  resetTransform();
  stage.clientWidth; // force layout
  renderStage();
  go('editor');
}
async function loadFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('That file is not an image'); return; }
  try {
    let src;
    if (window.createImageBitmap) {
      try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
      catch (e) { src = await loadViaImg(file); }
    } else {
      src = await loadViaImg(file);
    }
    setSource(src, file.name);
  } catch (e) {
    toast('Could not open that image');
  }
}
function loadViaImg(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 2000); };
    img.onerror = rej;
    img.src = url;
  });
}

/* -------------------------------------------------------------------- home */
function renderHome() {
  // size chips
  const host = $('#homeSizes');
  host.innerHTML = '';
  SIZES.filter(s => s.cat !== 'custom').slice(0, 6).forEach(s => {
    const el = document.createElement('div');
    el.className = 'chip' + (s.id === S.sizeId ? ' active' : '');
    el.textContent = `${s.name.replace(' — ', ' ')}`;
    el.onclick = () => { setSize(s.id); };
    host.appendChild(el);
  });
  // recent
  storeAll().then(recs => {
    recs = (recs || []).sort((a, b) => b.createdAt - a.createdAt).slice(0, 2);
    const h = $('#homeRecent');
    if (!recs.length) { h.innerHTML = '<div class="empty" style="padding:26px 10px">Nothing saved yet — your recent photos will appear here.</div>'; return; }
    h.innerHTML = '';
    recs.forEach(r => {
      const el = document.createElement('div');
      el.className = 'rowlist';
      el.innerHTML = `<div class="thumb" style="background-image:url('${r.thumb}');background-size:cover"></div>
        <div class="txt"><b>${r.sizeName}</b><small>${new Date(r.createdAt).toLocaleDateString()} · ${r.wmm} × ${r.hmm} mm</small></div>
        <span class="dim">›</span>`;
      el.onclick = () => openPhoto(r);
      h.appendChild(el);
    });
  }).catch(() => {});
}
function setSize(id) {
  S.sizeId = id;
  if (S.source) { renderStage(); }
  toast(size().name + ' selected');
  renderHome(); renderSizeList();
}

/* ------------------------------------------------------------------- sizes */
let sizeFilter = 'all', sizeQuery = '';
function renderSizeList() {
  const host = $('#sizeList');
  host.innerHTML = '';
  const list = SIZES.filter(s => (sizeFilter === 'all' || s.cat === sizeFilter) &&
    (sizeQuery === '' || (s.name + ' ' + s.note).toLowerCase().includes(sizeQuery)));
  if (!list.length) { host.innerHTML = '<div class="empty">No sizes match your search.</div>'; return; }
  list.forEach(s => {
    const el = document.createElement('div');
    el.className = 'rowlist';
    const t = targetPx(s, 300);
    el.innerHTML = `<div class="thumb">${s.wmm}<br>×<br>${s.hmm}</div>
      <div class="txt"><b>${s.name}</b><small>${s.note}</small><small style="display:block;margin-top:3px">${t.w} × ${t.h} px @ 300 DPI</small></div>
      <span class="dim">${s.wmm}×${s.hmm}</span>`;
    el.onclick = () => { setSize(s.id); go(S.source ? 'editor' : 'home'); };
    host.appendChild(el);
  });
}

/* ---------------------------------------------------------------- settings */
function refreshSettings() {
  $('#themeSel').value = prefs.theme;
  $('#defPaperSel').value = prefs.defPaper;
  $('#dpiSel').value = String(prefs.dpi);
  const ds = $('#defSizeSel');
  ds.innerHTML = SIZES.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  ds.value = prefs.defSize;
  storeAll().then(r => { $('#storageCount').textContent = (r || []).length + ' photos'; }).catch(() => {});
}
function applyTheme() {
  document.documentElement.setAttribute('data-theme', prefs.theme === 'auto' ? '' : prefs.theme);
  if (prefs.theme === 'auto') document.documentElement.removeAttribute('data-theme');
}

/* ------------------------------------------------------------- range paint */
function paintRange(r) {
  if (!r) return;
  const p = ((r.value - r.min) / (r.max - r.min)) * 100;
  r.style.setProperty('--p', p + '%');
}

/* ------------------------------------------------------------------ events */
// navigation
document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto]');
  if (g) { go(g.dataset.goto); return; }
});
$('#backBtn').onclick = () => go((VIEW_META[S.view] && VIEW_META[S.view].back) || 'home');
$('#goCamera').onclick = () => go('camera');
$('#goGallery').onclick = () => $('#fileInput').click();
$('#camGallery').onclick = () => $('#fileInput').click();
$('#fileInput').onchange = e => { loadFile(e.target.files[0]); e.target.value = ''; };
$('#camFlip').onclick = async () => { facing = facing === 'user' ? 'environment' : 'user'; stopCamera(); await startCamera(); toast(facing === 'user' ? 'Front camera' : 'Rear camera'); };
$('#shutter').onclick = capture;
$('#flashBtn').onclick = () => {
  const t = stream && stream.getVideoTracks()[0];
  const caps = t && t.getCapabilities ? t.getCapabilities() : null;
  if (caps && caps.torch) {
    const on = !(t.getSettings().torch);
    t.applyConstraints({ advanced: [{ torch: on }] }).then(() => toast('Torch ' + (on ? 'on' : 'off'))).catch(() => toast('Torch not supported'));
  } else toast('Flash not supported on this camera');
};
$('#gridBtn').onclick = () => { $('#cropGrid').classList.toggle('hidden'); toast('Guide grid toggled'); };

// editor panels
$('#editorSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-panel]'); if (!b) return;
  $$('#editorSeg button').forEach(x => x.classList.toggle('active', x === b));
  $$('[data-panelbody]').forEach(p => p.classList.toggle('hidden', p.dataset.panelbody !== b.dataset.panel));
});
$('#rotL').onclick = () => { S.rot = (S.rot + 90) % 360; renderStage(); toast('Rotated 90°'); };
$('#flipBtn').onclick = () => { S.flip = !S.flip; renderStage(); toast(S.flip ? 'Flipped' : 'Flip off'); };
$('#resetBtn').onclick = () => { resetTransform(); renderStage(); toast('Reset to original'); };
$('#zoomRange').addEventListener('input', e => { S.zoom = e.target.value / 100; renderStage(); paintRange(e.target); });
$$('[data-adj]').forEach(r => r.addEventListener('input', () => {
  S.adj[r.dataset.adj] = +r.value;
  const o = r.parentElement.querySelector('[data-out]');
  o.textContent = (r.value > 0 ? '+' : '') + r.value;
  paintRange(r); renderStage();
}));
$('#autoAdjust').onclick = () => {
  if (!S.source) return;
  const probe = renderPhoto(...Object.values(workingPx()));
  const a = analyse(probe);
  const b = clamp(Math.round((150 - a.face) / 2.2), -30, 40);
  S.adj.brightness = b;
  S.adj.contrast = 8;
  S.adj.saturation = 4;
  const set = (k, v) => { const r = $(`[data-adj="${k}"]`); r.value = v; r.parentElement.querySelector('[data-out]').textContent = (v > 0 ? '+' : '') + v; paintRange(r); };
  set('brightness', b); set('contrast', 8); set('saturation', 4);
  renderStage();
  toast('Auto enhanced');
};
$('#swatches').addEventListener('click', e => {
  const sw = e.target.closest('[data-bg]'); if (!sw) return;
  $$('#swatches .swatch').forEach(s => s.classList.toggle('active', s === sw));
  S.bg = sw.dataset.bg;
  renderStage();
  toast(S.bg === 'keep' ? 'Keeping original background' : 'Background replaced');
});
$('#tolRange').addEventListener('input', e => {
  S.tol = +e.target.value; $('#tolOut').textContent = S.tol; paintRange(e.target);
  if (S.bg !== 'keep') renderStage();
});
$('#editorDone').onclick = () => { if (!S.source) { toast('Take or choose a photo first'); return; } go('preview'); };

// preview actions
$('#backToEdit').onclick = () => go('editor');
$('#goPrint').onclick = () => go('print');
$('#exportJpg').onclick = () => {
  if (!S.source) return;
  const c = buildResult(S.dpi);
  c.toBlob(b => download(b, `${slug(size().name)}-${size().wmm}x${size().hmm}mm.jpg`), 'image/jpeg', 0.95);
  toast('Exported JPG');
};
$('#shareBtn').onclick = () => {
  if (!S.source) return;
  const url = buildResult(S.dpi).toDataURL('image/jpeg', 0.95);
  shareDataUrl(url, `${slug(size().name)}.jpg`);
};
$('#savePhoto').onclick = async () => {
  if (!S.source) return;
  const full = buildResult(S.dpi);
  const thumb = document.createElement('canvas');
  const k = 220 / Math.max(full.width, full.height);
  thumb.width = Math.max(1, Math.round(full.width * k));
  thumb.height = Math.max(1, Math.round(full.height * k));
  thumb.getContext('2d').drawImage(full, 0, 0, thumb.width, thumb.height);
  const sz = size();
  const rec = {
    id: 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name: S.name, sizeId: sz.id, sizeName: sz.name, wmm: sz.wmm, hmm: sz.hmm,
    dpi: S.dpi, cat: sz.cat, createdAt: Date.now(),
    thumb: thumb.toDataURL('image/jpeg', 0.7),
    full: full.toDataURL('image/jpeg', 0.92),
  };
  try {
    await storeAdd(rec);
    toast('Saved to My Photos');
    refreshSettings();
  } catch (e) { toast('Could not save — storage may be full'); }
};

// sizes
$('#sizeSearch').addEventListener('input', e => { sizeQuery = e.target.value.trim().toLowerCase(); renderSizeList(); });
$('#sizeTabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if (!t) return;
  $$('#sizeTabs .tab').forEach(x => x.classList.toggle('active', x === t));
  sizeFilter = t.dataset.filter; renderSizeList();
});

// print
const repaint = () => { refreshSheet(); };
$('#paperSel').addEventListener('change', e => { S.paper = e.target.value; repaint(); });
$('#plus').onclick = () => { S.copies = clamp(S.copies + 1, 1, 60); $('#copies').textContent = S.copies; repaint(); };
$('#minus').onclick = () => { S.copies = clamp(S.copies - 1, 1, 60); $('#copies').textContent = S.copies; repaint(); };
$('#margin').addEventListener('change', e => { S.margin = clamp(+e.target.value || 0, 0, 40); repaint(); });
$('#spacing').addEventListener('change', e => { S.spacing = clamp(+e.target.value || 0, 0, 30); repaint(); });
$('#cutlines').addEventListener('change', e => { S.cutlines = e.target.checked; repaint(); });
$('#dlSheetJpg').onclick = () => {
  if (!S.source) { toast('Make a photo first'); return; }
  const c = composeSheet();
  c.toBlob(b => download(b, `print-sheet-${S.paper}-300dpi.jpg`), 'image/jpeg', 0.95);
  toast('Sheet saved as JPG');
};
$('#dlSheetPdf').onclick = () => {
  if (!S.source) { toast('Make a photo first'); return; }
  try {
    const c = composeSheet();
    const url = c.toDataURL('image/jpeg', 0.95);
    const bytes = dataUrlToBytes(url);
    const pdf = buildPdf(bytes, c.width, c.height);
    download(new Blob([pdf], { type: 'application/pdf' }), `print-sheet-${S.paper}-300dpi.pdf`);
    toast('Sheet saved as PDF');
  } catch (e) { toast('Could not build the PDF'); }
};
$('#printNow').onclick = () => {
  if (!S.source) { toast('Make a photo first'); return; }
  const c = composeSheet();
  const url = c.toDataURL('image/jpeg', 0.95);
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to print, or save the PDF instead'); return; }
  w.document.write(`<!doctype html><title>Print sheet</title>
    <style>@page{margin:0}html,body{margin:0}img{width:100%;display:block}</style>
    <img src="${url}" onload="window.focus();window.print();">`);
  w.document.close();
  toast('Opening print dialog');
};

// gallery tabs
$('#galTabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if (!t) return;
  $$('#galTabs .tab').forEach(x => x.classList.toggle('active', x === t));
  galFilter = t.dataset.gal; renderGallery();
});

// settings
$('#themeSel').addEventListener('change', e => { prefs.theme = e.target.value; savePrefs(); applyTheme(); });
$('#defSizeSel').addEventListener('change', e => { prefs.defSize = e.target.value; savePrefs(); });
$('#defPaperSel').addEventListener('change', e => { prefs.defPaper = e.target.value; savePrefs(); });
$('#dpiSel').addEventListener('change', e => { prefs.dpi = +e.target.value; savePrefs(); S.dpi = prefs.dpi; });
$('#clearAll').onclick = () => {
  showModal(`<h3>Delete all saved photos?</h3><p>This permanently removes every photo stored on this device. It cannot be undone.</p>
    <div class="btns"><button class="btn" id="mCancel">Cancel</button>
    <button class="btn btn-danger" id="mConfirm">Delete all</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mConfirm').onclick = async () => {
    await storeClear(); closeModal(); renderGallery(); refreshSettings(); toast('All photos deleted');
  };
};
$('#themeBtn').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const dark = cur === 'dark' || (!cur && matchMedia('(prefers-color-scheme: dark)').matches);
  prefs.theme = dark ? 'light' : 'dark';
  savePrefs(); applyTheme(); $('#themeSel').value = prefs.theme;
  toast(prefs.theme === 'dark' ? 'Dark mode' : 'Light mode');
};

/* -------------------------------------------------------------------- init */
function init() {
  applyTheme();
  S.sizeId = prefs.defSize;
  S.paper = prefs.defPaper;
  S.dpi = prefs.dpi;
  $('#paperSel').value = S.paper;
  $('#copies').textContent = S.copies;
  renderSizeList();
  renderHome();
  go('home');
  // service worker (only over http/https)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();

// expose a little surface for testing / debugging
window.__ppm = { S, go, setSource, loadFile, buildResult, composeSheet, buildPdf, renderGallery, size, targetPx };
})();
