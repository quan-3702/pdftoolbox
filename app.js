// PDF Toolbox – merge, split, organize, compress and sign PDFs fully in the browser (offline)
const $ = (id) => document.getElementById(id);
const { PDFDocument, degrees, rgb, StandardFonts } = PDFLib;
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

const docs = new Map(); // id -> { id, name, kind: 'pdf'|'image', bytes, pdfjs?, img? }
const pages = []; // { id, docId, index, rot, sel, sig: {fx, fy, fw} | null, w, h, baseRot }
let nextId = 1;
let dragId = null;
let signature = null; // { url, bytes (PNG), aspect }

// ---------- Pro (Microsoft Store add-on via Digital Goods API) ----------
const FREE_FILES = 3;
const STORE_BILLING = 'https://store.microsoft.com/billing';
const PRO_SKU = 'pdftoolbox_pro';
const PRO_IDS = [PRO_SKU];
const STORE_URL = 'https://apps.microsoft.com/detail/9NPWMMZ1NPPV';
let proAvailable = false; // Pro limits apply only when the Store actually sells the add-on
let proSku = PRO_SKU;
let isPro = false;
try { isPro = localStorage.getItem('pdftoolbox-pro') === '1'; } catch (_) {}
const unlocked = () => isPro || !proAvailable;

async function billing() {
  if (!('getDigitalGoodsService' in window)) return null;
  try { return await window.getDigitalGoodsService(STORE_BILLING); } catch (_) { return null; }
}

function setPro(v) {
  isPro = v;
  try { localStorage.setItem('pdftoolbox-pro', v ? '1' : '0'); } catch (_) {}
  document.body.classList.toggle('is-pro', v);
  document.body.classList.toggle('pro-off', !proAvailable && !v);
  const b = $('proBtn');
  b.textContent = v ? '★ Pro' : '★ Get Pro';
  b.classList.toggle('is-pro', v);
  b.hidden = !proAvailable && !v;
  [...$('compress').options].forEach((o) => { o.textContent = o.textContent.replace(' ★ Pro', '') + (unlocked() || ['none', 'medium'].includes(o.value) ? '' : ' ★ Pro'); });
}

async function checkPro() {
  const svc = await billing();
  if (!svc) return false;
  try {
    const details = await svc.getDetails(PRO_IDS).catch(() => []);
    proAvailable = details.length > 0;
    if (details[0]) { proSku = details[0].itemId; if (!PRO_IDS.includes(proSku)) PRO_IDS.push(proSku); }
    const list = await svc.listPurchases();
    const owned = list.some((p) => PRO_IDS.includes(p.itemId));
    setPro(owned);
    return owned;
  } catch (_) { return isPro; }
}

function proMessage(text) { const m = $('proMsg'); m.hidden = !text; m.textContent = text || ''; }

async function openPro(reason) {
  proMessage(reason || '');
  const svc = await billing();
  if (!svc) {
    $('buyBtn').textContent = 'Get PDF Toolbox on Microsoft Store';
    $('restoreBtn').hidden = true;
  } else {
    $('restoreBtn').hidden = false;
    try {
      const [d] = await svc.getDetails([proSku]);
      const price = d && d.price ? new Intl.NumberFormat(undefined, { style: 'currency', currency: d.price.currency }).format(Number(d.price.value)) : '';
      $('buyBtn').textContent = price ? `Unlock Pro – ${price}` : 'Unlock Pro';
    } catch (_) { $('buyBtn').textContent = 'Unlock Pro'; }
  }
  if (!$('proDialog').open) $('proDialog').showModal();
}

async function buyPro() {
  const svc = await billing();
  if (!svc) { window.open(STORE_URL, '_blank'); return; }
  const methods = [{ supportedMethods: STORE_BILLING, data: { sku: proSku } }];
  try {
    let req;
    try { req = new PaymentRequest(methods); }
    catch (_) { req = new PaymentRequest(methods, { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } }); }
    const res = await req.show();
    await res.complete('success');
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    proMessage('Purchase could not be completed: ' + (e.message || e));
    return;
  }
  if (await checkPro()) {
    proMessage('Thank you! Pro is unlocked. ★');
    setTimeout(() => $('proDialog').close(), 1500);
  }
}

function needsPro(list, o) {
  if (unlocked()) return false;
  const files = new Set(list.map((p) => p.docId)).size;
  const used = [];
  if (files > FREE_FILES) used.push(`merging more than ${FREE_FILES} files`);
  if (list.some((p) => p.sig)) used.push('signatures');
  if (['strong', '1024', '2048', '5120'].includes(o.compress)) used.push('strong compression');
  if (o.wm) used.push('watermark');
  if (o.pageNums) used.push('page numbers');
  if (!used.length) return false;
  openPro(`This needs Pro: ${used.join(', ')}. Unlock Pro, or turn ${used.length > 1 ? 'them' : 'it'} off to continue for free.`);
  return true;
}

// ---------- helpers ----------
function fmtBytes(n) { return n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / 1024 / 1024).toFixed(2) + ' MB'; }
function download(bytes, name, type = 'application/pdf') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  return blob.size;
}
function baseName() { return ($('fname').value.trim() || 'document').replace(/[\\/:*?"<>|]+/g, '_').replace(/\.pdf$/i, ''); }
function showSummary(html, err) { const s = $('summary'); s.hidden = false; s.classList.toggle('err', !!err); s.innerHTML = html; }
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let workerReady = null;
function pdfjs() {
  if (!workerReady) {
    workerReady = fetch(PDFJS_WORKER).then((r) => r.blob()).then((b) => {
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(b);
    }).catch(() => { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; });
  }
  return workerReady.then(() => pdfjsLib);
}

// ---------- loading files ----------
async function addFiles(list) {
  const files = [...list].filter((f) => f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name) || /^image\/(png|jpeg)$/.test(f.type)));
  if (!files.length) return;
  $('count').textContent = 'Opening files…';
  const errors = [];
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const id = nextId++;
      if (file.type.startsWith('image/')) {
        const url = URL.createObjectURL(file);
        const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
        const k = Math.min(1, 842 / Math.max(img.naturalWidth * 0.75, img.naturalHeight * 0.75));
        docs.set(id, { id, name: file.name, kind: 'image', bytes, img, url, type: file.type });
        pages.push({ id: nextId++, docId: id, index: 0, rot: 0, sel: false, sig: null, w: img.naturalWidth * 0.75 * k, h: img.naturalHeight * 0.75 * k, baseRot: 0 });
      } else {
        const lib = await pdfjs();
        let pdf;
        try { pdf = await lib.getDocument({ data: bytes.slice() }).promise; }
        catch (e) {
          if (e && e.name === 'PasswordException') throw new Error(`${file.name} is password-protected`);
          throw new Error(`${file.name} could not be opened`);
        }
        docs.set(id, { id, name: file.name, kind: 'pdf', bytes, pdfjs: pdf });
        for (let i = 0; i < pdf.numPages; i++) {
          const pg = await pdf.getPage(i + 1);
          const vp = pg.getViewport({ scale: 1 });
          pages.push({ id: nextId++, docId: id, index: i, rot: 0, sel: false, sig: null, w: vp.width, h: vp.height, baseRot: pg.rotate });
        }
      }
    } catch (e) { errors.push(e.message || String(e)); }
  }
  render();
  if (errors.length) showSummary('⚠ ' + errors.map(esc).join('<br>⚠ '), true);
  if (!$('fname').dataset.touched && docs.size) {
    const first = docs.values().next().value;
    $('fname').value = first.name.replace(/\.[^.]+$/, '') + (docs.size > 1 ? '-merged' : '-edited');
  }
}

// ---------- thumbnails ----------
const thumbCache = new Map(); // page id -> canvas/img
let thumbQueue = Promise.resolve();
function thumbFor(p) {
  if (thumbCache.has(p.id)) return thumbCache.get(p.id);
  const d = docs.get(p.docId);
  let el;
  if (d.kind === 'image') { el = new Image(); el.src = d.url; }
  else {
    el = document.createElement('canvas');
    el.width = 10; el.height = 14;
    thumbQueue = thumbQueue.then(async () => {
      try {
        const pg = await d.pdfjs.getPage(p.index + 1);
        const vp0 = pg.getViewport({ scale: 1 });
        const vp = pg.getViewport({ scale: 260 / Math.max(vp0.width, vp0.height) });
        el.width = Math.ceil(vp.width); el.height = Math.ceil(vp.height);
        const ctx = el.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, el.width, el.height);
        await pg.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise; // 'print' also renders in background tabs
      } catch (_) {}
    });
  }
  thumbCache.set(p.id, el);
  return el;
}

function move(from, to) {
  if (from === to || to < 0 || to >= pages.length) return;
  const [p] = pages.splice(from, 1);
  pages.splice(to, 0, p);
  render();
}

function render() {
  const grid = $('grid');
  grid.innerHTML = '';
  const multi = docs.size > 1;
  pages.forEach((p, i) => {
    const d = docs.get(p.docId);
    const li = document.createElement('li');
    li.className = 'page' + (p.sel ? ' sel' : '');
    li.draggable = true;
    li.innerHTML = `<span class="num">${i + 1}</span>${p.sig ? '<span class="sigmark" title="Signed">✍</span>' : ''}
      <div class="thumb"></div><div class="pname"></div>
      <div class="tools">
        <button class="icon" data-a="rot" title="Rotate 90°">⟳</button>
        <button class="icon" data-a="sign" title="Place signature">✍</button>
        <button class="icon" data-a="rm" title="Delete page">✕</button>
      </div>`;
    const t = thumbFor(p);
    t.style.transform = `rotate(${p.rot}deg)`;
    t.classList.toggle('turned', p.rot % 180 !== 0);
    li.querySelector('.thumb').appendChild(t);
    li.querySelector('.pname').textContent = multi ? `${d.name} · p${p.index + 1}` : `Page ${p.index + 1}`;
    li.querySelector('[data-a="rot"]').onclick = (e) => { e.stopPropagation(); p.rot = (p.rot + 90) % 360; if (p.sig) p.sig = null; render(); };
    li.querySelector('[data-a="rm"]').onclick = (e) => { e.stopPropagation(); pages.splice(i, 1); render(); };
    li.querySelector('[data-a="sign"]').onclick = (e) => { e.stopPropagation(); startPlace(p); };
    li.onclick = () => { p.sel = !p.sel; render(); };
    li.addEventListener('dragstart', (e) => { dragId = p.id; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
    li.addEventListener('dragend', () => { dragId = null; li.classList.remove('dragging'); });
    li.addEventListener('dragover', (e) => { if (dragId !== null) { e.preventDefault(); li.classList.add('target'); } });
    li.addEventListener('dragleave', () => li.classList.remove('target'));
    li.addEventListener('drop', (e) => {
      if (dragId === null) return;
      e.preventDefault(); e.stopPropagation(); li.classList.remove('target');
      move(pages.findIndex((x) => x.id === dragId), i);
    });
    grid.appendChild(li);
  });
  const n = pages.length, s = pages.filter((p) => p.sel).length;
  const files = new Set(pages.map((p) => p.docId)).size;
  let label = n ? `${n} page${n > 1 ? 's' : ''}${files > 1 ? ` from ${files} files` : ''}${s ? ` · ${s} selected` : ''}` : 'No pages yet';
  if (files > FREE_FILES && !unlocked()) label += ` · free version merges up to ${FREE_FILES} files`;
  $('count').textContent = label;
  $('empty').hidden = n > 0;
  ['selAll', 'selNone', 'clear', 'saveAll', 'split'].forEach((id) => { $(id).disabled = !n; });
  ['rotSel', 'delSel', 'saveSel'].forEach((id) => { $(id).disabled = !s; });
}

// ---------- signature ----------
const pad = $('sigPad');
const padCtx = pad.getContext('2d');
let drawing = false, drawn = false, sigMode = 'draw';
function padPos(e) { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; }
function clearPad() { padCtx.clearRect(0, 0, pad.width, pad.height); drawn = false; }
pad.addEventListener('pointerdown', (e) => { if (sigMode !== 'draw') return; drawing = true; pad.setPointerCapture(e.pointerId); const [x, y] = padPos(e); padCtx.beginPath(); padCtx.moveTo(x, y); });
pad.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const [x, y] = padPos(e);
  padCtx.strokeStyle = $('sigColor').value; padCtx.lineWidth = 3.2; padCtx.lineCap = 'round'; padCtx.lineJoin = 'round';
  padCtx.lineTo(x, y); padCtx.stroke(); drawn = true;
});
['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => pad.addEventListener(ev, () => { drawing = false; }));
function typeSig() {
  clearPad();
  const t = $('sigText').value.trim();
  if (!t) return;
  let fs = 110;
  const font = (s) => `italic ${s}px "Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive`;
  padCtx.font = font(fs);
  while (padCtx.measureText(t).width > pad.width - 40 && fs > 20) { fs -= 4; padCtx.font = font(fs); }
  padCtx.fillStyle = $('sigColor').value; padCtx.textAlign = 'center'; padCtx.textBaseline = 'middle';
  padCtx.fillText(t, pad.width / 2, pad.height / 2);
  drawn = true;
}
function setSigMode(m) {
  sigMode = m;
  $('sigDrawTab').classList.toggle('seg-on', m === 'draw');
  $('sigTypeTab').classList.toggle('seg-on', m === 'type');
  $('sigTypeBox').hidden = m !== 'type';
  clearPad();
  if (m === 'type') { $('sigText').focus(); typeSig(); }
}
// Crop transparent borders of the pad and keep a PNG
async function captureSignature() {
  const d = padCtx.getImageData(0, 0, pad.width, pad.height).data;
  let x0 = pad.width, y0 = pad.height, x1 = 0, y1 = 0;
  for (let y = 0; y < pad.height; y++) for (let x = 0; x < pad.width; x++) {
    if (d[(y * pad.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) return null;
  const m = 6; x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(pad.width - 1, x1 + m); y1 = Math.min(pad.height - 1, y1 + m);
  const c = document.createElement('canvas');
  c.width = (x1 - x0 + 1) * 2; c.height = (y1 - y0 + 1) * 2;
  c.getContext('2d').drawImage(pad, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return { url: URL.createObjectURL(blob), bytes: new Uint8Array(await blob.arrayBuffer()), aspect: c.height / c.width };
}

function openSignature() {
  if (!unlocked()) { openPro('Signing PDFs is a Pro feature.'); return; }
  $('sigDialog').showModal();
  setSigMode(sigMode);
}

// ---------- place signature on a page ----------
let placing = null; // { page, fx, fy, fw }
async function renderPageTo(canvas, p, maxW) {
  const d = docs.get(p.docId);
  const ctx = canvas.getContext('2d');
  if (d.kind === 'image') {
    const turned = p.rot % 180 !== 0;
    const k = maxW / (turned ? p.h : p.w);
    const w = p.w * k, h = p.h * k;
    canvas.width = Math.round(turned ? h : w); canvas.height = Math.round(turned ? w : h);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(p.rot * Math.PI / 180);
    ctx.drawImage(d.img, -w / 2, -h / 2, w, h);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return;
  }
  const pg = await d.pdfjs.getPage(p.index + 1);
  const rotation = (pg.rotate + p.rot) % 360;
  const vp1 = pg.getViewport({ scale: 1, rotation });
  const vp = pg.getViewport({ scale: maxW / vp1.width, rotation });
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pg.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise; // 'print' also renders in background tabs
}

async function startPlace(p) {
  if (!unlocked()) { openPro('Signing PDFs is a Pro feature.'); return; }
  if (!signature) { openSignature(); $('sigDialog').dataset.then = p.id; return; }
  placing = { page: p, ...(p.sig || { fx: 0.55, fy: 0.78, fw: 0.3 }) };
  const cv = $('placeCanvas');
  await renderPageTo(cv, p, Math.min(820, window.innerWidth - 120));
  $('placeSig').src = signature.url;
  $('placeSize').value = Math.round(placing.fw * 100);
  $('placeTitle').textContent = `Place signature · page ${pages.indexOf(p) + 1}`;
  $('placeRemove').hidden = !p.sig;
  $('placeDialog').showModal();
  layoutSig();
}
function layoutSig() {
  const cv = $('placeCanvas'), s = $('placeSig');
  const W = cv.clientWidth, H = cv.clientHeight;
  const w = placing.fw * W, h = w * signature.aspect;
  placing.fx = Math.min(Math.max(0, placing.fx), Math.max(0, 1 - w / W));
  placing.fy = Math.min(Math.max(0, placing.fy), Math.max(0, 1 - h / H));
  s.style.left = placing.fx * W + 'px'; s.style.top = placing.fy * H + 'px'; s.style.width = w + 'px';
}
(() => {
  const s = $('placeSig');
  let start = null;
  s.addEventListener('pointerdown', (e) => { s.setPointerCapture(e.pointerId); start = { x: e.clientX, y: e.clientY, fx: placing.fx, fy: placing.fy }; e.preventDefault(); });
  s.addEventListener('pointermove', (e) => {
    if (!start) return;
    const cv = $('placeCanvas');
    placing.fx = start.fx + (e.clientX - start.x) / cv.clientWidth;
    placing.fy = start.fy + (e.clientY - start.y) / cv.clientHeight;
    layoutSig();
  });
  ['pointerup', 'pointercancel'].forEach((ev) => s.addEventListener(ev, () => { start = null; }));
  $('placeCanvas').addEventListener('click', (e) => {
    const r = e.target.getBoundingClientRect();
    const w = placing.fw * r.width, h = w * signature.aspect;
    placing.fx = (e.clientX - r.left - w / 2) / r.width; placing.fy = (e.clientY - r.top - h / 2) / r.height;
    layoutSig();
  });
  $('placeSize').addEventListener('input', () => { placing.fw = Number($('placeSize').value) / 100; layoutSig(); });
})();

// ---------- building PDFs ----------
function watermarkPng(text) {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 1200;
  const ctx = c.getContext('2d');
  ctx.translate(600, 600); ctx.rotate(-Math.PI / 5);
  let fs = 200;
  const font = (s) => `700 ${s}px "Segoe UI", system-ui, sans-serif`;
  ctx.font = font(fs);
  while (ctx.measureText(text).width > 1500 && fs > 20) { fs -= 8; ctx.font = font(fs); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(120, 120, 120, 0.32)';
  ctx.fillText(text, 0, 0);
  return new Promise((r) => c.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/png'));
}

// Map a point given in the displayed (rotated) page, top-left origin, to PDF user space
function viewToPdf(box, R, vx, vy) {
  const W = box.width, H = box.height;
  let x, y;
  if (R === 90) { x = vy; y = vx; }
  else if (R === 180) { x = W - vx; y = vy; }
  else if (R === 270) { x = W - vy; y = H - vx; }
  else { x = vx; y = H - vy; }
  return { x: x + box.x, y: y + box.y };
}

async function buildPdf(list, o, onProgress = () => {}) {
  const out = await PDFDocument.create();
  const srcCache = new Map(), imgCache = new Map();
  const sigImg = list.some((p) => p.sig) && signature ? await out.embedPng(signature.bytes) : null;
  const wmImg = o.wm ? await out.embedPng(await watermarkPng(o.wm)) : null;
  const font = o.pageNums ? await out.embedFont(StandardFonts.Helvetica) : null;
  for (let i = 0; i < list.length; i++) {
    onProgress(i);
    const p = list[i], d = docs.get(p.docId);
    let page;
    if (d.kind === 'pdf') {
      if (!srcCache.has(d.id)) {
        try { srcCache.set(d.id, await PDFDocument.load(d.bytes)); }
        catch (e) { throw new Error(/encrypt/i.test(e.message) ? `${d.name} is protected and can't be edited` : `${d.name}: ${e.message}`); }
      }
      [page] = await out.copyPages(srcCache.get(d.id), [p.index]);
      out.addPage(page);
      page.setRotation(degrees((((page.getRotation().angle + p.rot) % 360) + 360) % 360));
    } else {
      if (!imgCache.has(d.id)) imgCache.set(d.id, d.type === 'image/png' ? await out.embedPng(d.bytes) : await out.embedJpg(d.bytes));
      page = out.addPage([p.w, p.h]);
      page.drawImage(imgCache.get(d.id), { x: 0, y: 0, width: p.w, height: p.h });
      page.setRotation(degrees(p.rot));
    }
    const R = ((page.getRotation().angle % 360) + 360) % 360;
    const box = page.getMediaBox();
    const Vw = R % 180 ? box.height : box.width, Vh = R % 180 ? box.width : box.height;
    if (wmImg) {
      const s = Math.min(Vw, Vh) * 0.9;
      const a = viewToPdf(box, R, (Vw - s) / 2, (Vh + s) / 2);
      page.drawImage(wmImg, { x: a.x, y: a.y, width: s, height: s, rotate: degrees(R) });
    }
    if (p.sig && sigImg) {
      const w = p.sig.fw * Vw, h = w * signature.aspect;
      const a = viewToPdf(box, R, p.sig.fx * Vw, p.sig.fy * Vh + h);
      page.drawImage(sigImg, { x: a.x, y: a.y, width: w, height: h, rotate: degrees(R) });
    }
    if (font) {
      const label = `${i + 1} / ${list.length}`, size = 10;
      const tw = font.widthOfTextAtSize(label, size);
      const a = viewToPdf(box, R, (Vw - tw) / 2, Vh - 16);
      page.drawText(label, { x: a.x, y: a.y, size, font, color: rgb(0.35, 0.35, 0.35), rotate: degrees(R) });
    }
  }
  let bytes = await out.save();
  if (o.compress !== 'none') bytes = await compressPdf(bytes, o.compress, onProgress);
  return bytes;
}

// Re-render every page as a JPEG image (works best for scans and photos)
async function rasterize(bytes, dpi, quality, onProgress) {
  const lib = await pdfjs();
  const src = await lib.getDocument({ data: bytes.slice() }).promise;
  const out = await PDFDocument.create();
  for (let i = 1; i <= src.numPages; i++) {
    onProgress(i - 1, true);
    const pg = await src.getPage(i);
    const vp1 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: dpi / 72 });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp, intent: 'print' }).promise; // 'print' also renders in background tabs
    const jpg = await new Promise((r) => c.toBlob(async (b) => r(new Uint8Array(await b.arrayBuffer())), 'image/jpeg', quality));
    const img = await out.embedJpg(jpg);
    const page = out.addPage([vp1.width, vp1.height]);
    page.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    pg.cleanup();
  }
  src.destroy();
  return out.save();
}

async function compressPdf(bytes, mode, onProgress) {
  if (mode === 'medium' || mode === 'strong') {
    const res = mode === 'medium' ? await rasterize(bytes, 150, 0.7, onProgress) : await rasterize(bytes, 100, 0.55, onProgress);
    if (res.length < bytes.length) return res;
    bytes.keptOriginal = true; // text PDFs are often already smaller than any image version
    return bytes;
  }
  const target = Number(mode) * 1024;
  if (bytes.length <= target) return bytes;
  let dpi = 150, q = 0.7, best = null;
  for (let pass = 0; pass < 7; pass++) {
    const res = await rasterize(bytes, dpi, q, onProgress);
    if (!best || res.length < best.length) best = res;
    if (res.length <= target) return res;
    const ratio = target / res.length;
    if (q > 0.5 && ratio > 0.6) q = Math.max(0.45, q - 0.15);
    else dpi = Math.max(45, Math.floor(dpi * Math.sqrt(ratio) * 0.9));
    if (dpi <= 45 && q <= 0.45) break;
  }
  best.tooBig = true;
  return best;
}

function options() {
  return { compress: $('compress').value, wm: $('wmText').value.trim(), pageNums: $('pageNums').checked };
}

async function run(btnId, label, fn) {
  const btn = $(btnId), old = btn.textContent;
  document.querySelectorAll('.panel button').forEach((b) => { b.dataset.was = b.disabled; b.disabled = true; });
  try { await fn((t) => { btn.textContent = t; }); }
  catch (e) { showSummary('⚠ ' + esc(e.message || e), true); }
  finally {
    btn.textContent = old;
    document.querySelectorAll('.panel button').forEach((b) => { b.disabled = b.dataset.was === 'true'; });
    render();
  }
}

async function saveList(list, suffix, btnId) {
  const o = options();
  if (!list.length || needsPro(list, o)) return;
  await run(btnId, '', async (set) => {
    const bytes = await buildPdf(list, o, (i, raster) => set(`${raster ? 'Compressing' : 'Building'} page ${i + 1}/${list.length}…`));
    const name = baseName() + suffix + '.pdf';
    const size = download(bytes, name);
    showSummary(`<strong>${esc(name)}</strong> · ${list.length} page${list.length > 1 ? 's' : ''} · ${fmtBytes(size)}` +
      (bytes.keptOriginal ? ' · already compact, kept the original quality' : '') +
      (bytes.tooBig ?` · couldn't get under ${esc($('compress').selectedOptions[0].textContent.replace(' ★ Pro', ''))} – try removing pages` : ''));
  });
}

async function splitAll() {
  const o = options();
  if (!pages.length || needsPro(pages, o)) return;
  const mode = $('splitMode').value;
  const groups = [];
  if (mode === 'file') {
    const byDoc = new Map();
    pages.forEach((p) => { if (!byDoc.has(p.docId)) byDoc.set(p.docId, []); byDoc.get(p.docId).push(p); });
    byDoc.forEach((list, id) => groups.push({ list, name: docs.get(id).name.replace(/\.[^.]+$/, '') }));
  } else {
    const n = Number(mode);
    for (let i = 0; i < pages.length; i += n) {
      const list = pages.slice(i, i + n);
      groups.push({ list, name: `${baseName()}-${n === 1 ? `p${i + 1}` : `p${i + 1}-${i + list.length}`}` });
    }
  }
  await run('split', '', async (set) => {
    const zip = new JSZip();
    const used = new Set();
    for (let g = 0; g < groups.length; g++) {
      set(`Creating file ${g + 1}/${groups.length}…`);
      const bytes = await buildPdf(groups[g].list, o);
      let name = groups[g].name, k = 2;
      while (used.has(name)) name = `${groups[g].name}-${k++}`;
      used.add(name);
      zip.file(name + '.pdf', bytes);
    }
    set('Zipping…');
    const blob = await zip.generateAsync({ type: 'blob' });
    const name = baseName() + '-split.zip';
    download(blob, name);
    showSummary(`<strong>${esc(name)}</strong> · ${groups.length} PDF files · ${fmtBytes(blob.size)}`);
  });
}

// ---------- wire up UI ----------
const drop = $('drop');
['dragenter', 'dragover'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((e) => drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (ev) => addFiles(ev.dataTransfer.files));
drop.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') $('picker').click(); });
$('picker').addEventListener('change', (ev) => { addFiles(ev.target.files); ev.target.value = ''; });
document.addEventListener('dragover', (e) => { if (dragId === null) e.preventDefault(); });
document.addEventListener('drop', (e) => { if (dragId === null && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });

$('selAll').onclick = () => { pages.forEach((p) => { p.sel = true; }); render(); };
$('selNone').onclick = () => { pages.forEach((p) => { p.sel = false; }); render(); };
$('rotSel').onclick = () => { pages.forEach((p) => { if (p.sel) { p.rot = (p.rot + 90) % 360; p.sig = null; } }); render(); };
$('delSel').onclick = () => { for (let i = pages.length - 1; i >= 0; i--) if (pages[i].sel) pages.splice(i, 1); render(); };
$('clear').onclick = () => {
  pages.length = 0;
  docs.forEach((d) => { if (d.pdfjs) d.pdfjs.destroy(); if (d.url) URL.revokeObjectURL(d.url); });
  docs.clear(); thumbCache.clear(); $('summary').hidden = true; delete $('fname').dataset.touched; render();
};
$('saveAll').onclick = () => saveList(pages.slice(), '', 'saveAll');
$('saveSel').onclick = () => saveList(pages.filter((p) => p.sel), '-selected', 'saveSel');
$('split').onclick = splitAll;
$('fname').addEventListener('input', () => { $('fname').dataset.touched = '1'; });
$('compress').addEventListener('change', () => {
  const v = $('compress').value;
  $('compressHint').hidden = v === 'none';
  if (!unlocked() && !['none', 'medium'].includes(v)) { openPro('Strong compression and compressing under a size are Pro features.'); $('compress').value = 'medium'; }
});
$('wmText').addEventListener('change', () => { if ($('wmText').value.trim() && !unlocked()) openPro('Watermarks are a Pro feature.'); });
$('pageNums').addEventListener('change', () => { if ($('pageNums').checked && !unlocked()) { openPro('Page numbers are a Pro feature.'); $('pageNums').checked = false; } });

// signature dialog
$('sigBtn').onclick = openSignature;
$('sigDrawTab').onclick = () => setSigMode('draw');
$('sigTypeTab').onclick = () => setSigMode('type');
$('sigText').addEventListener('input', typeSig);
$('sigColor').addEventListener('change', () => { if (sigMode === 'type') typeSig(); });
$('sigClear').onclick = () => { clearPad(); $('sigText').value = ''; };
$('sigCancel').onclick = () => $('sigDialog').close();
$('sigOk').onclick = async () => {
  if (!drawn) return;
  const s = await captureSignature();
  if (!s) return;
  if (signature) URL.revokeObjectURL(signature.url);
  signature = s;
  $('sigDialog').close();
  $('sigBtn').textContent = '✍ Change signature';
  $('sigHint').textContent = 'Click ✍ on any page to place your signature.';
  const then = $('sigDialog').dataset.then;
  delete $('sigDialog').dataset.then;
  const p = then && pages.find((x) => String(x.id) === then);
  if (p) startPlace(p);
};
// place dialog
$('placeOk').onclick = () => { placing.page.sig = { fx: placing.fx, fy: placing.fy, fw: placing.fw }; $('placeDialog').close(); render(); };
$('placeCancel').onclick = () => $('placeDialog').close();
$('placeRemove').onclick = () => { placing.page.sig = null; $('placeDialog').close(); render(); };
window.addEventListener('resize', () => { if ($('placeDialog').open) layoutSig(); });

// Pro UI
$('proBtn').addEventListener('click', () => { if (!isPro) openPro(); });
$('buyBtn').addEventListener('click', buyPro);
$('restoreBtn').addEventListener('click', async () => {
  proMessage('Checking your purchases…');
  proMessage((await checkPro()) ? 'Pro restored. ★' : 'No Pro purchase found on this Microsoft account.');
});
$('closePro').addEventListener('click', () => $('proDialog').close());

// "Open with PDF Toolbox" from File Explorer
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async (params) => {
    if (params.files && params.files.length) addFiles(await Promise.all(params.files.map((h) => h.getFile())));
  });
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
setPro(isPro);
checkPro().then(render);
render();
