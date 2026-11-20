// ---------- NTQ37 – "Rate this app" (menu link + one friendly question after the app has helped a few times) ----------
// <script src="rate.js" data-id="STORE-ID" data-app="AppName"></script>
// Nothing is sent anywhere: the counts stay in this browser. The question is only asked in the installed Store app,
// never while a window/dialog is open or while the person is busy, at most twice, and never again after an answer.
// "Not really" opens the app's own feedback mail link (the one already on the page).
(function () {
  'use strict';
  var me = document.currentScript || document.querySelector('script[src$="rate.js"]');
  if (!me) return;
  var ID = me.getAttribute('data-id'), APP = me.getAttribute('data-app') || document.title.split(/[-–]/)[0].trim();
  if (!ID) return;
  var KEY = 'ntq37-rate-' + ID;
  var isWin = /Windows/i.test(navigator.userAgent);
  var REVIEW = isWin ? 'ms-windows-store://review/?ProductId=' + ID : 'https://apps.microsoft.com/detail/' + ID;
  var installed = function () {
    try { return ['standalone', 'window-controls-overlay', 'minimal-ui', 'fullscreen'].some(function (m) { return matchMedia('(display-mode: ' + m + ')').matches; }); } catch (_) { return false; }
  };

  // ---------- saved state ----------
  function load() { try { var s = JSON.parse(localStorage.getItem(KEY) || '{}'); return s && typeof s === 'object' ? s : {}; } catch (_) { return {}; } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {} }
  var st = load();
  st.saves = +st.saves || 0; st.asks = +st.asks || 0; st.days = Array.isArray(st.days) ? st.days.slice(-20) : [];
  var today = new Date().toISOString().slice(0, 10);
  if (st.days.indexOf(today) < 0) st.days.push(today);
  save(st);

  var origClick = HTMLAnchorElement.prototype.click;
  function go(href, blank) { try { var a = document.createElement('a'); a.href = href; if (blank) { a.target = '_blank'; a.rel = 'noopener'; } a.style.display = 'none'; document.body.appendChild(a); origClick.call(a); a.remove(); } catch (_) { location.href = href; } }
  function openReview() { go(REVIEW, !isWin); }
  function openMail() { var m = document.querySelector('a[href^="mailto:"]'); if (m) go(m.href); }

  // ---------- the link in the menu and next to the feedback note ----------
  function addLinks() {
    var label = '⭐ Rate ' + APP;
    // menu: next to the "Feedback" mail link of a menu / dropdown
    var mails = Array.prototype.slice.call(document.querySelectorAll('a[href^="mailto:"]'));
    var inMenu = mails.filter(function (a) { return !a.closest('.fb-note') && !a.closest('dialog') && a.closest('#menu, .menu, [role="menu"], .dropdown, .menubar, nav, header, .more-menu'); });
    inMenu.slice(0, 1).forEach(function (a) {
      if (a.parentNode.querySelector('.ntq-rate')) return;
      var b = a.cloneNode(false);
      b.removeAttribute('id'); b.className = (a.className ? a.className + ' ' : '') + 'ntq-rate';
      b.href = REVIEW; b.removeAttribute('target'); b.textContent = label;
      b.addEventListener('click', function (e) { e.preventDefault(); done('menu'); openReview(); });
      a.parentNode.insertBefore(b, a);
    });
    // the note on the main screen (not the one in the Pro window)
    var note = Array.prototype.slice.call(document.querySelectorAll('.fb-note')).filter(function (n) { return !n.closest('dialog'); })[0];
    if (note && !note.querySelector('.ntq-rate')) {
      var r = document.createElement('a'); r.className = 'ntq-rate'; r.href = REVIEW; r.textContent = label;
      r.addEventListener('click', function (e) { e.preventDefault(); done('note'); openReview(); });
      var wrap = document.createElement('span'); wrap.style.display = 'block'; wrap.style.marginTop = '6px'; wrap.appendChild(r); note.appendChild(wrap);
    }
  }

  // ---------- "the app helped": a file was saved or a page printed ----------
  HTMLAnchorElement.prototype.click = function () { try { if (this.hasAttribute('download')) helped(); } catch (_) {} return origClick.apply(this, arguments); };
  document.addEventListener('click', function (e) { var a = e.target && e.target.closest && e.target.closest('a[download]'); if (a && e.isTrusted) helped(); }, true);
  window.addEventListener('afterprint', helped);
  if (window.showSaveFilePicker) { var sp = window.showSaveFilePicker; window.showSaveFilePicker = function () { return sp.apply(this, arguments).then(function (h) { helped(); return h; }); }; }
  var lastHelp = 0;
  function helped() { var now = Date.now(); if (now - lastHelp < 4000) return; lastHelp = now; st = load(); st.saves = (+st.saves || 0) + 1; save(st); later(); }

  // ---------- when to ask ----------
  function due() {
    st = load();
    if (st.never || st.asks >= 2 || !installed()) return false;
    var days = (st.days || []).length, saves = +st.saves || 0;
    var ok = saves >= 3 || days >= 5;
    if (st.asks === 1) ok = saves >= (+st.savesAtAsk || 0) + 5 || days >= (+st.daysAtAsk || 0) + 5; // "Not now": much later, once
    if (st.lastAsk && Date.now() - st.lastAsk < 3 * 864e5) ok = false;
    return ok;
  }
  var lastInput = Date.now(), timer = 0, tries = 0;
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (t) { addEventListener(t, function () { lastInput = Date.now(); }, { capture: true, passive: true }); });
  function quiet() {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return false;
    if (document.querySelector('dialog[open]')) return false;
    if (Date.now() - lastInput < 2500) return false;
    // something is still working (progress bars / busy overlays that are shown)
    var busy = document.querySelectorAll('#busy, .busy, #prog, .progress, #progress, [aria-busy="true"]');
    for (var i = 0; i < busy.length; i++) { var b = busy[i]; if (!b.hidden && b.offsetParent !== null && getComputedStyle(b).visibility !== 'hidden') return false; }
    return true;
  }
  function later() { clearTimeout(timer); tries = 0; timer = setTimeout(check, 3000); }
  function check() { if (!due()) return; if (quiet()) { ask(); return; } if (++tries < 24) timer = setTimeout(check, 5000); }

  function done(how) { st = load(); st.never = how || true; save(st); }

  // ---------- the question (own little window, its own styles) ----------
  function ask() {
    st = load(); st.asks = (+st.asks || 0) + 1; st.lastAsk = Date.now(); st.savesAtAsk = st.saves; st.daysAtAsk = (st.days || []).length; save(st);
    var host = document.createElement('div'); host.className = 'ntq-rate-host';
    var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    root.innerHTML = '<style>' +
      ':host{all:initial}dialog{font:15px/1.45 "Segoe UI",system-ui,sans-serif;border:0;border-radius:14px;padding:22px 22px 18px;max-width:380px;width:calc(100% - 40px);background:#fff;color:#1f2937;box-shadow:0 20px 60px rgba(0,0,0,.3)}' +
      'dialog::backdrop{background:rgba(0,0,0,.35)}h2{font-size:18px;margin:0 0 6px}p{margin:0 0 16px;color:#4b5563}' +
      '.b{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;border-radius:9px;padding:9px 14px;cursor:pointer;border:1px solid #d1d5db;background:#f9fafb;color:inherit}' +
      'button.y{background:#7c3aed;border-color:#7c3aed;color:#fff;font-weight:600}.s{display:flex;justify-content:space-between;margin-top:12px}.s button{border:0;background:none;padding:4px 0;color:#6b7280;font-size:13px;text-decoration:underline}' +
      '@media (prefers-color-scheme:dark){dialog{background:#1f2937;color:#f3f4f6}p{color:#d1d5db}button{background:#374151;border-color:#4b5563}button.y{background:#7c3aed;border-color:#7c3aed}.s button{background:none;color:#9ca3af}}' +
      '</style><dialog><h2></h2><p>Your answer takes one click and helps a small developer a lot.</p>' +
      '<div class="b"><button class="y" data-a="love">😊 Yes, I like it</button><button data-a="meh">😕 Not really</button></div>' +
      '<div class="s"><button data-a="later">Not now</button><button data-a="never">Don\'t ask again</button></div></dialog>';
    document.body.appendChild(host);
    var dlg = root.querySelector('dialog');
    dlg.querySelector('h2').textContent = 'Is ' + APP + ' helping you?';
    var close = function () { try { dlg.close(); } catch (_) {} host.remove(); };
    var step2 = function (title, text, yes, act) {
      dlg.querySelector('h2').textContent = title; dlg.querySelector('p').textContent = text;
      var b = dlg.querySelector('.b'); b.innerHTML = '';
      var y = document.createElement('button'); y.className = 'y'; y.textContent = yes; y.onclick = function () { close(); act(); };
      var n = document.createElement('button'); n.textContent = 'No thanks'; n.onclick = close;
      b.appendChild(y); b.appendChild(n);
      var s = dlg.querySelector('.s'); if (s) s.remove();
    };
    dlg.addEventListener('cancel', function () { close(); });
    dlg.addEventListener('click', function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
      if (a === 'love') { done('love'); step2('Thank you! 💜', 'Would you rate ' + APP + ' in the Microsoft Store? It helps other people find it.', '⭐ Rate it', openReview); }
      else if (a === 'meh') { done('meh'); step2('Sorry to hear that', 'Tell me what is not working – I read every message and improve the app.', '✉ Send feedback', openMail); }
      else if (a === 'never') { done('never'); close(); }
      else close(); // not now: asked again much later, once
    });
    try { dlg.showModal(); } catch (_) { dlg.setAttribute('open', ''); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { addLinks(); later(); }); else { addLinks(); later(); }
  setTimeout(addLinks, 1500); // menus that the app builds a little later
  window.ntq37Rate = { ask: ask, state: load, reset: function () { try { localStorage.removeItem(KEY); } catch (_) {} } };
})();
