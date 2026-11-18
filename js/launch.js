/* Launch screen (#launch in index.html): the Japanese teahouse sample at eye level, the app's name and what it does,
   shown while the scripts load. When everything has loaded the button turns to "Start designing"; the screen fades
   away by itself a few seconds later, or at once on a click / Enter / Escape. "Don't show this at start" keeps it away
   (floorplan2027.launch = 'off'; About → Show the launch screen brings it back for the next start). */
(function () {
  'use strict';
  const el = document.getElementById('launch');
  const KEY = 'floorplan2027.launch';
  if (!el) return;
  const btn = document.getElementById('lnGo'), bar = document.getElementById('lnBar'), skip = document.getElementById('lnSkip'), ver = document.getElementById('lnVer');
  const app = window.FP_APP || {};
  if (ver) ver.textContent = `Version ${app.version || ''} · © ${app.year || ''} ${app.holder || ''}`.trim();
  if (bar) bar.style.width = '70%'; // the scripts are in: the rest is the page's pictures and fonts
  let done = false, timer = 0;
  function close() {
    if (done) return;
    done = true; clearTimeout(timer);
    try { if (skip && skip.checked) localStorage.setItem(KEY, 'off'); } catch (e) { /* storage unavailable */ }
    el.classList.add('gone');
    document.removeEventListener('keydown', onKey, true);
    setTimeout(() => el.remove(), 700);
  }
  function onKey(e) { if (['Enter', 'Escape', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); close(); } }
  function ready() {
    if (bar) bar.style.width = '100%';
    if (btn) { btn.disabled = false; btn.textContent = 'Start designing'; btn.focus({ preventScroll: true }); }
    timer = setTimeout(close, 4500);
  }
  // a click anywhere starts — except on the checkbox, which only ticks (and holds the screen a moment longer)
  el.addEventListener('click', (e) => {
    if (e.target.closest('.ln-foot label')) { clearTimeout(timer); timer = setTimeout(close, 6000); return; }
    close();
  });
  document.addEventListener('keydown', onKey, true);
  if (document.readyState === 'complete') ready(); else window.addEventListener('load', ready);
})();
