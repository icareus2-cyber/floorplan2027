/*
 * About (click the plan name, or the logo, at the top left)
 * A small panel under the plan name with the program's name, version, MIT copyright notice and contact address.
 * The plan name stays editable: the panel opens while you type a new name, and closes on Esc, Enter or a click elsewhere.
 * The version and copyright holder are written here (APP); the licence text is read from the LICENSE file at the
 * project root, so it is written in one place only (the copy below is used only when LICENSE cannot be read, e.g.
 * when index.html is opened straight from the disk).
 */
(function () {
  'use strict';
  const APP = {
    name: 'Floor Plan 2027',
    version: '1.0.0',
    year: '2026',
    holder: 'Maxtron Lab',
    email: 'maxtronusa@outlook.com',
  };
  window.FP_APP = APP;
  const esc = window.FP_ESC || ((s) => String(s));
  const $ = (s) => document.querySelector(s);
  const title = $('#planTitle'), brand = $('.brand');
  if (!title || !brand) return;

  const MIT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;

  const pop = document.createElement('div');
  pop.id = 'aboutPop'; pop.className = 'about-pop'; pop.hidden = true;
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-labelledby', 'aboutName');
  pop.innerHTML = `
    <p class="about-rename">Type to rename this plan · <kbd>Enter</kbd> when done</p>
    <div class="about-head">
      <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true"><path d="M3 3h18v18H3z M3 10h8 M11 3v11 M15 21v-6h6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>
      <div><h3 id="aboutName">${esc(APP.name)}</h3><span class="about-ver">Version ${esc(APP.version)}</span></div>
    </div>
    <p>Design a house as a 2D floor plan and see it in 3D, right in your browser.</p>
    <p class="about-copy">Copyright © ${esc(APP.year)} ${esc(APP.holder)}.<br>Released under the <b>MIT License</b>.</p>
    <details class="about-lic"><summary>Read the licence</summary><pre id="aboutLicense">${esc(MIT)}</pre>
      <p class="about-third">The 3D view uses three.js (r128), © three.js authors, MIT License.</p></details>
    <p class="about-contact">Contact: <a href="mailto:${esc(APP.email)}">${esc(APP.email)}</a></p>
    <p class="about-launch"><a href="#" id="aboutLaunch">Show the launch screen</a> <span id="aboutLaunchNote" hidden>— it will show the next time the app starts.</span></p>`;
  document.body.appendChild(pop);
  // "Don't show this at start" on the launch screen can be undone here (js/launch.js keeps the setting)
  pop.querySelector('#aboutLaunch').addEventListener('click', (e) => {
    e.preventDefault();
    try { localStorage.removeItem('floorplan2027.launch'); } catch (err) { /* storage unavailable */ }
    pop.querySelector('#aboutLaunchNote').hidden = false;
  });

  // the licence as written in LICENSE (falls back to the copy above)
  let licenceLoaded = false;
  function loadLicence() {
    if (licenceLoaded) return;
    licenceLoaded = true;
    fetch('LICENSE', { cache: 'no-store' }).then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((t) => { if (/MIT License/i.test(t)) $('#aboutLicense').textContent = t.trim(); })
      .catch(() => { licenceLoaded = false; });
  }
  pop.querySelector('.about-lic').addEventListener('toggle', (e) => { if (e.target.open) loadLicence(); });

  function place() {
    const r = title.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.round(r.left - 4))}px`;
    pop.style.top = `${Math.round(r.bottom + 8)}px`;
  }
  function show() { place(); pop.hidden = false; }
  function hide() { pop.hidden = true; }

  title.title = 'Plan name — click to rename it and see About';
  title.addEventListener('focus', show);
  title.addEventListener('click', show);
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape') { hide(); title.blur(); }
  });
  // the logo opens (or closes) the panel too
  const logo = brand.querySelector('svg');
  if (logo) {
    logo.classList.add('about-logo');
    logo.setAttribute('role', 'button'); logo.setAttribute('tabindex', '0'); logo.setAttribute('aria-label', `About ${APP.name}`);
    const toggle = () => (pop.hidden ? show() : hide());
    logo.addEventListener('click', toggle);
    logo.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  }
  document.addEventListener('pointerdown', (e) => {
    if (pop.hidden) return;
    if (pop.contains(e.target) || e.target === title || (logo && logo.contains(e.target))) return;
    hide();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) hide(); });
  window.addEventListener('resize', () => { if (!pop.hidden) place(); });
})();
