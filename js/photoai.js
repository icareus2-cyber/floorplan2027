/*
 * Photo → House (top bar → Photo)
 * The user picks an AI service (Claude, OpenAI, or any OpenAI-compatible API), enters their own API key and uploads
 * photos of a property: outside views, a floor plan, rooms, an aerial view. The AI looks at them and answers the
 * House Building Wizard's questions (size, storeys, rooms, walls, roof, floors, extras) — it never draws the plan
 * itself: the Wizard's own rules (js/wizard.js) design and build the house from the answers, so the result is always
 * a valid plan. The AI may also say the photos are not enough ("need_more", with the photos it would like to see)
 * or refuse them ("refuse": no property in them, or not suitable). Either way the user decides what happens next.
 *
 * Privacy: the photos go only to the provider the user chose, straight from this browser; nothing else is sent.
 * The key stays in memory unless "Remember the key in this browser" is ticked (then localStorage, this browser only).
 */
(function () {
  'use strict';
  const FP = window.FP, WIZ = window.FP_WIZARD, WM = window.FP_WALLMATS, MATS = window.FP_MATERIALS, esc = window.FP_ESC;
  if (!FP || !WIZ) return;
  const $ = (s, r = document) => r.querySelector(s);
  const STORE = 'floorplan2027.photoai';
  const MAX_IMAGES = 6, MIN_SIDE = 320, MAX_SIDE = 1568, TIMEOUT = 120000;

  const PROVIDERS = {
    claude: { name: 'Claude (Anthropic)', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'],
      endpoint: 'https://api.anthropic.com/v1/messages', keyHint: 'sk-ant-…', keyUrl: 'https://console.anthropic.com/settings/keys' },
    openai: { name: 'OpenAI', models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'],
      endpoint: 'https://api.openai.com/v1/responses', keyHint: 'sk-…', keyUrl: 'https://platform.openai.com/api-keys' },
    custom: { name: 'Other (OpenAI-compatible)', models: [],
      endpoint: '', keyHint: 'your key', keyUrl: '' },
    // an image model running in this browser (ONNX, js/photolocal.js): no key, the photos stay on this computer
    local: { name: 'On this computer — ONNX (experimental, no key)', models: ['Xenova/clip-vit-base-patch32', 'Xenova/clip-vit-base-patch16'],
      endpoint: '', keyHint: '', keyUrl: '', local: true },
  };

  /* ───────────────────────── settings (provider, models, key) ───────────────────────── */
  let S = { provider: 'claude', models: {}, endpoint: '', remember: false, keys: {} };
  try { S = { ...S, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch (e) { /* none kept */ }
  const sessionKeys = { ...(S.keys || {}) };
  const keep = () => {
    const out = { provider: S.provider, models: S.models, endpoint: S.endpoint, remember: S.remember, keys: S.remember ? sessionKeys : {} };
    try { localStorage.setItem(STORE, JSON.stringify(out)); } catch (e) { /* storage unavailable */ }
  };
  const model = () => (S.models[S.provider] || PROVIDERS[S.provider].models[0] || '').trim();
  const key = () => (sessionKeys[S.provider] || '').trim();

  /* ───────────────────────── photos ───────────────────────── */
  // each: { name, url (preview), data (base64 JPEG, downscaled), w, h, kind (from the AI) }
  let photos = [];
  let busy = null;      // AbortController of the running request
  let last = null;      // the last parsed reply

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
      img.src = url;
    });
  }
  // shrink to at most MAX_SIDE px on the long side (what vision models use anyway) and send as JPEG: smaller, cheaper
  function toJpeg(img) {
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // transparent PNGs get a white background
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }
  async function addFiles(list) {
    const problems = [];
    for (const f of list) {
      if (photos.length >= MAX_IMAGES) { problems.push(`At most ${MAX_IMAGES} photos — “${f.name}” was not added.`); continue; }
      if (!/^image\//.test(f.type) && !/\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(f.name)) { problems.push(`“${f.name}” is not an image.`); continue; }
      try {
        const { img, url } = await loadImage(f);
        if (Math.min(img.naturalWidth, img.naturalHeight) < MIN_SIDE) {
          URL.revokeObjectURL(url);
          problems.push(`“${f.name}” is too small (${img.naturalWidth} × ${img.naturalHeight} px). Use a photo at least ${MIN_SIDE} px on each side.`);
          continue;
        }
        photos.push({ name: f.name, url, data: toJpeg(img), w: img.naturalWidth, h: img.naturalHeight, kind: '' });
      } catch (e) {
        problems.push(/\.(heic|heif)$/i.test(f.name)
          ? `“${f.name}” is a HEIC photo, which this browser cannot open. Save it as JPG (on an iPhone: Settings → Camera → Formats → Most Compatible) and try again.`
          : `“${f.name}” could not be opened as an image.`);
      }
    }
    last = null;
    renderPhotos(); renderResult(); refresh();
    if (problems.length) status(problems.join(' '), 'warn');
  }

  /* ───────────────────────── what the AI is asked ───────────────────────── */
  function allowed() {
    const o = WIZ.options();
    const named = (ids, tbl) => ids.map((id) => (tbl && tbl[id] ? `${id} (${tbl[id].name})` : String(id))).join(', ');
    const roofNames = Object.fromEntries(Object.values(FP.byId).filter((ic) => ic.roof).map((ic) => [ic.roof, { name: ic.name }]));
    return [
      `name: short text, a name for the house (e.g. "Brick cottage")`,
      `ground (surroundings): ${o.ground.join(', ')}  [grass = lawn; trees = lawn with trees; street(-trees) = a street in front; paving; gravel]`,
      `w: width of the FRONT (entrance side) in metres, outside measurement, ${o.w.min}–${o.w.max}`,
      `d: depth front-to-back in metres, outside measurement, ${o.d.min}–${o.d.max}`,
      `shape (footprint, seen from above; w × d is the whole outline): ${(o.shape || ['rect']).join(', ')}  [rect = one rectangle; l-left / l-right = a wing at the back left / right (an L); t = a wing behind the middle; u = two back wings round a courtyard; side-left / side-right = a set-back wing at the side; offset = two overlapping, staggered blocks]`,
      `floors: storeys above ground, one of ${o.floors.join(', ')} (2 or 3 need w ≥ 10 and d ≥ 7)`,
      `storeyH: floor-to-floor height in metres, ${o.storeyH.min}–${o.storeyH.max} (usually 2.8–3.3)`,
      `bedrooms: ${o.bedrooms.join(', ')}`, `baths: ${o.baths.join(', ')}`,
      `kitchen (one storey only): ${o.kitchen.join(', ')}  [open = open-plan with the living room]`,
      `wallMat (outside walls): ${named(o.wallMat, WM.MATS)}`,
      `wallColor: outside wall colour as #rrggbb`, `inColor: inside wall colour as #rrggbb`,
      `roof (style): ${named(o.roof, roofNames)}`,
      `pitch (roof angle, degrees): ${o.pitch.join(', ')}`,
      `roofMat (covering): ${named(o.roofMat, WM.ROOF_MATS)}`,
      `roofColor: #rrggbb, only if clearly different from the covering's usual colour`,
      `flLiving / flBed / flWet (floor finishes: living rooms / bedrooms / kitchen and bathrooms): ${named(o.flLiving, MATS)}`,
      `balcony, furniture, trees, pool, car (parking place), linings: true or false`,
    ].join('\n');
  }
  function prompt(note) {
    return `You analyse photos of a residential property for "Floor Plan 2027", a house-design app.
Your ONLY job is to answer the questions of the app's House Building Wizard; the Wizard then designs and builds the house itself.
Reply with ONE JSON object and nothing else (no Markdown, no code fence).

Decide "status" first:
- "refuse": none of the images shows a building, its floor plan or its rooms (for example people, pets, food, landscapes without a house, screenshots, unrelated documents), or the images are unsuitable or offensive. Put a short, polite explanation in "message" and say which photos would work. Leave "answers" empty.
- "need_more": the images do show a property, but too little to judge the main answers (width, depth, storeys, roof): for example only a close-up of a door, one corner of a room, or a photo that is very dark or blurred. Fill in whatever you can, and in "requests" ask for 1–3 specific photos that would help most (e.g. "the whole front of the house, from across the street").
- "ok": enough to fill in the main answers. Leave out any answer you cannot judge — the Wizard's defaults are used for those.

How to estimate:
- Use known sizes for scale: a front door is about 0.9 m wide and 2.1 m high, a storey about 3 m, a window about 1.2 m wide, a car about 4.5 m long.
- The width is the front (entrance) side. If the depth cannot be seen, estimate it from the roof shape and the house's proportions, and give it "low" confidence.
- From a floor plan, read room labels and any printed dimensions, and count bedrooms and bathrooms.
- From interior photos, judge the floor finishes and wall colours.
- Colours: the main colour you see, as #rrggbb.
- Do not describe or identify people, and do not guess the address.

Allowed answers (use exactly these keys and values):
${allowed()}

Reply format:
{"status":"ok"|"need_more"|"refuse",
 "image_kinds":["exterior"|"floor_plan"|"interior"|"aerial"|"other", … one per image, in order],
 "message":"one or two sentences for the user",
 "requests":["…"],
 "answers":{ …only the keys above… },
 "confidence":{ "<key>":"high"|"medium"|"low", … one per answer },
 "notes":["short observations the user should check, e.g. 'the back of the house was not visible'"]}
Write "message", "requests" and "notes" in the language of the user's note below, or in English if there is none.
${note ? `\nThe user's note: """${note.slice(0, 1000)}"""` : ''}
There ${photos.length === 1 ? 'is 1 image' : `are ${photos.length} images`}.`;
  }

  /* ───────────────────────── calling the provider ───────────────────────── */
  async function callAI(text, signal) {
    const p = S.provider, m = model(), k = key();
    let url, headers, body;
    if (p === 'claude') {
      url = PROVIDERS.claude.endpoint;
      headers = { 'content-type': 'application/json', 'x-api-key': k, 'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true' };
      body = { model: m, max_tokens: 2000, messages: [{ role: 'user', content: [
        ...photos.map((ph) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: ph.data } })),
        { type: 'text', text }] }] };
    } else if (p === 'openai') {
      url = PROVIDERS.openai.endpoint;
      headers = { 'content-type': 'application/json', authorization: `Bearer ${k}` };
      body = { model: m, max_output_tokens: 2000, input: [{ role: 'user', content: [
        ...photos.map((ph) => ({ type: 'input_image', image_url: `data:image/jpeg;base64,${ph.data}`, detail: 'auto' })),
        { type: 'input_text', text }] }] };
    } else {
      url = (S.endpoint || '').trim();
      headers = { 'content-type': 'application/json', authorization: `Bearer ${k}` };
      body = { model: m, max_tokens: 2000, messages: [{ role: 'user', content: [
        ...photos.map((ph) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${ph.data}` } })),
        { type: 'text', text }] }] };
    }
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      throw new Error(p === 'custom'
        ? 'Could not reach that address. Check the endpoint URL, your internet connection, and that the service allows requests from a web page (CORS).'
        : 'Could not reach the AI service. Check your internet connection and try again.');
    }
    const raw = await res.text();
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { /* not JSON */ }
    if (!res.ok) {
      const msg = (data && (data.error && (data.error.message || data.error.type) || data.message)) || raw.slice(0, 200) || res.statusText;
      if (res.status === 401 || res.status === 403) throw new Error(`The AI service did not accept the key (${res.status}). Check that you pasted the whole key, for the provider selected. (${msg})`);
      if (res.status === 404) throw new Error(`Model or address not found (404). Check the model name “${m}”. (${msg})`);
      if (res.status === 429) throw new Error(`The AI service is busy or your account has reached its limit (429). Wait a moment, or check your plan and credit. (${msg})`);
      if (res.status === 413) throw new Error('The photos are too large for this service. Remove one or two and try again.');
      throw new Error(`The AI service returned an error (${res.status}): ${msg}`);
    }
    if (!data) throw new Error('The AI service sent a reply this app cannot read.');
    if (p === 'claude') return (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    if (p === 'openai') return data.output_text || (data.output || []).flatMap((o) => o.content || []).filter((c) => c.type === 'output_text' || c.type === 'text').map((c) => c.text).join('');
    return ((data.choices || [])[0] || {}).message ? data.choices[0].message.content : '';
  }
  function parseReply(text) {
    const s = String(text || ''), a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('The AI did not answer in the expected format. Try again, or try another model.');
    let j;
    try { j = JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error('The AI\'s answer could not be read (invalid JSON). Try again, or try another model.'); }
    if (!['ok', 'need_more', 'refuse'].includes(j.status)) j.status = j.answers && Object.keys(j.answers).length ? 'ok' : 'need_more';
    j.answers = j.answers && typeof j.answers === 'object' ? j.answers : {};
    j.confidence = j.confidence && typeof j.confidence === 'object' ? j.confidence : {};
    j.requests = Array.isArray(j.requests) ? j.requests.map(String).slice(0, 5) : [];
    j.notes = Array.isArray(j.notes) ? j.notes.map(String).slice(0, 8) : [];
    j.image_kinds = Array.isArray(j.image_kinds) ? j.image_kinds : [];
    if (j.status === 'refuse') j.answers = {};
    return j;
  }
  // which answers the Wizard will accept (the same rules as FP_WIZARD.setAnswers, without changing anything)
  function usable(ans) {
    const o = WIZ.options(), out = {};
    for (const [k, v] of Object.entries(ans)) {
      const r = o[k];
      if (r === undefined || v === null || v === undefined || v === '') continue;
      if (Array.isArray(r)) { if (r.some((x) => String(x).toLowerCase() === String(v).toLowerCase())) out[k] = v; }
      else if (r === 'colour') { if (/^#[0-9a-f]{6}$/i.test(String(v))) out[k] = v; }
      else if (r === 'text') { if (String(v).trim()) out[k] = String(v).trim().slice(0, 60); }
      else if (r === 'bool') { if (typeof v === 'boolean') out[k] = v; }
      else if (isFinite(parseFloat(v))) out[k] = parseFloat(v);
    }
    return out;
  }

  async function analyse() {
    if (busy) return;
    const why = missing();
    if (why) return status(why, 'warn');
    busy = new AbortController();
    const local = !!PROVIDERS[S.provider].local;
    const timer = local ? null : setTimeout(() => busy && busy.abort(), TIMEOUT); // (a first local run downloads the model: no time limit)
    last = null; renderResult(); refresh();
    status(local ? 'Starting the image model on this computer…' : `Sending ${photos.length} photo${photos.length > 1 ? 's' : ''} to ${PROVIDERS[S.provider].name} (${model()})… this usually takes 10–40 seconds.`, 'busy');
    try {
      if (local) {
        if (!window.FP_LOCALAI) throw new Error('The local image model (js/photolocal.js) is missing.');
        const t0 = performance.now();
        last = await window.FP_LOCALAI.analyse(photos, (msg) => status(msg, 'busy'), busy.signal, model());
        last.notes.push(`Took ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
      } else last = parseReply(await callAI(prompt($('#paNote').value.trim()), busy.signal));
      photos.forEach((ph, i) => { ph.kind = String(last.image_kinds[i] || ''); });
      status('', '');
    } catch (e) {
      status(e.name === 'AbortError' ? 'Stopped. (The request was cancelled or took longer than two minutes.)' : e.message, 'error');
    } finally {
      if (timer) clearTimeout(timer);
      busy = null;
      renderPhotos(); renderResult(); refresh();
    }
  }

  function apply() {
    if (!last) return;
    const done = WIZ.setAnswers(usable(last.answers));
    close();
    WIZ.open(WIZ.lastStep);
    FP.toast(done.length
      ? `${done.length} answer${done.length > 1 ? 's' : ''} filled in from the photos. Check them on the left, then click “Build the house”.`
      : 'The AI could not fill in any answers — the Wizard opens with its usual answers.');
  }

  /* ───────────────────────── the dialog ───────────────────────── */
  const LABELS = { name: 'Name', ground: 'Surroundings', w: 'Width (front)', d: 'Depth', shape: 'Shape', floors: 'Storeys', storeyH: 'Storey height',
    bedrooms: 'Bedrooms', baths: 'Bathrooms', kitchen: 'Kitchen', wallMat: 'Outside walls', wallColor: 'Wall colour', inColor: 'Inside colour',
    roof: 'Roof', pitch: 'Roof pitch', roofMat: 'Roof covering', roofColor: 'Roof colour', flLiving: 'Floor: living', flBed: 'Floor: bedrooms',
    flWet: 'Floor: kitchen & baths', balcony: 'Balcony', furniture: 'Furniture', trees: 'Trees', pool: 'Pool', car: 'Parking', linings: 'Linings' };
  const GROUNDS = { grass: 'Lawn', trees: 'Lawn with trees', street: 'Street', 'street-trees': 'Street with trees', paving: 'Paved', gravel: 'Gravel' };
  const KINDS = { exterior: 'outside', floor_plan: 'floor plan', interior: 'room', aerial: 'aerial', other: 'not used' };
  function show(k, v) {
    const roof = Object.values(FP.byId).find((ic) => ic.roof === v);
    if (k === 'wallMat' && WM.MATS[v]) return WM.MATS[v].name;
    if (k === 'roofMat' && WM.ROOF_MATS[v]) return WM.ROOF_MATS[v].name;
    if (/^fl/.test(k) && MATS[v]) return MATS[v].name;
    if (k === 'roof' && roof) return roof.name;
    if (k === 'ground' && GROUNDS[v]) return GROUNDS[v];
    if (k === 'kitchen') return v === 'open' ? 'Open-plan' : 'Separate';
    if (/Color$/.test(k)) return `<i class="pa-sw" style="background:${esc(v)}"></i>${esc(v)}`;
    if (k === 'w' || k === 'd' || k === 'storeyH') return `${v} m`;
    if (k === 'pitch') return `${v}°`;
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    return esc(String(v));
  }

  function mount() {
    if ($('#photoAi')) return;
    const el = document.createElement('div');
    el.id = 'photoAi'; el.className = 'modal'; el.hidden = true;
    el.innerHTML = `<div class="modal-box pa-box" role="dialog" aria-labelledby="paTitle">
      <div class="pa-head"><h2 id="paTitle">Photo → House</h2><button type="button" class="wz-x" data-pa="close" aria-label="Close" title="Close (Esc)">×</button></div>
      <ol class="pa-guide">
        <li data-g="key"><b>Choose an AI and enter your key.</b> Pick Claude, OpenAI or another service, and paste your API key from that service.</li>
        <li data-g="photo"><b>Upload photos of the property.</b> The whole front of the house works best; add the sides, a floor plan or rooms if you have them (up to ${MAX_IMAGES}).</li>
        <li data-g="go"><b>Click Analyse.</b> The AI fills in the Wizard's answers. If the photos are not enough it asks for more, and it refuses photos that do not show a property. You check the answers, then build the house.</li>
      </ol>
      <section class="pa-sec">
        <h3>1 · AI service</h3>
        <div class="pa-grid">
          <label>Service<select id="paProvider">${Object.entries(PROVIDERS).map(([id, p]) => `<option value="${id}">${esc(p.name)}</option>`).join('')}</select></label>
          <label>Model<input id="paModel" list="paModels" spellcheck="false" autocomplete="off"/><datalist id="paModels"></datalist></label>
          <label class="pa-wide" id="paEndRow">Endpoint (chat completions URL)<input id="paEndpoint" spellcheck="false" placeholder="https://…/v1/chat/completions"/></label>
          <label class="pa-wide" id="paKeyRow">API key<span class="pa-keyrow"><input id="paKey" type="password" spellcheck="false" autocomplete="off"/><button type="button" data-pa="eye" title="Show or hide the key">Show</button></span></label>
        </div>
        <label class="pa-check" id="paRememberRow"><input type="checkbox" id="paRemember"/> Remember the key in this browser (otherwise it is forgotten when you close the page)</label>
        <p class="np-hint" id="paKeyHint"></p>
      </section>
      <section class="pa-sec">
        <h3>2 · Photos</h3>
        <div class="pa-drop" id="paDrop" tabindex="0" role="button" aria-label="Add photos">
          <input type="file" id="paFile" accept="image/*" multiple hidden/>
          <div class="pa-thumbs" id="paThumbs"></div>
          <p class="pa-drop-hint"><b>Click to choose photos</b>, or drop them here · JPG, PNG or WebP · at least ${MIN_SIDE} px</p>
        </div>
        <label class="pa-wide pa-note">Anything the AI should know? <small>(optional)</small><textarea id="paNote" rows="2" placeholder="e.g. three bedrooms upstairs; the garden is behind the house"></textarea></label>
      </section>
      <div class="pa-status" id="paStatus" hidden></div>
      <div class="pa-result" id="paResult" hidden></div>
      <p class="np-hint pa-privacy" id="paPrivacy">Your photos are sent only to the AI service you chose, directly from this browser, and each analysis uses your account with that service (a few cents at most). The AI's answers are estimates — always check them.</p>
      <div class="modal-btns"><button type="button" data-pa="close">Close</button><button type="button" class="primary" data-pa="go" id="paGo">Analyse</button></div>
    </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    $('#paProvider').addEventListener('change', (e) => { S.provider = e.target.value; keep(); fillService(); refresh(); });
    $('#paModel').addEventListener('input', (e) => { S.models[S.provider] = e.target.value; keep(); refresh(); });
    $('#paEndpoint').addEventListener('input', (e) => { S.endpoint = e.target.value; keep(); refresh(); });
    $('#paKey').addEventListener('input', (e) => { sessionKeys[S.provider] = e.target.value.trim(); keep(); refresh(); });
    $('#paRemember').addEventListener('change', (e) => { S.remember = e.target.checked; keep(); });
    $('#paFile').addEventListener('change', (e) => { addFiles([...e.target.files]); e.target.value = ''; });
    const drop = $('#paDrop');
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#paFile').click(); } });
    drop.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]); });
  }
  function fillService() {
    const p = PROVIDERS[S.provider];
    $('#paProvider').value = S.provider;
    $('#paModel').value = S.models[S.provider] || p.models[0] || '';
    $('#paModel').placeholder = p.models[0] || 'model name';
    $('#paModels').innerHTML = p.models.map((m) => `<option value="${esc(m)}"></option>`).join('');
    $('#paEndRow').hidden = S.provider !== 'custom';
    $('#paEndpoint').value = S.endpoint || '';
    $('#paKey').value = sessionKeys[S.provider] || '';
    $('#paKey').placeholder = p.keyHint;
    $('#paRemember').checked = !!S.remember;
    const local = !!p.local;
    $('#paKeyRow').hidden = local; $('#paRememberRow').hidden = local;
    $('#paPrivacy').textContent = local
      ? 'The photos stay on this computer: an image model runs in this browser (ONNX Runtime Web). Its library and model are downloaded once from cdn.jsdelivr.net and huggingface.co, then kept by the browser. It is a test: it reads the storeys, roof, walls, colours and a few extras from outside photos — less reliable than a cloud AI. Always check the answers.'
      : 'Your photos are sent only to the AI service you chose, directly from this browser, and each analysis uses your account with that service (a few cents at most). The AI\'s answers are estimates — always check them.';
    if (local) { $('#paKeyHint').innerHTML = `No key needed. The first analysis downloads the model (CLIP, about 150–350 MB depending on the browser) — later ones start at once. ${navigator.gpu ? 'This browser can use the graphics card (WebGPU): fast.' : 'This browser has no WebGPU, so it runs on the processor: slower (a minute or so per photo).'}`; return; }
    $('#paKeyHint').innerHTML = p.keyUrl
      ? `No key yet? Create one at <a href="${p.keyUrl}" target="_blank" rel="noopener">${esc(p.keyUrl.replace(/^https:\/\//, ''))}</a>. Model names change over time — if one is not found, check your provider's current model list.`
      : 'Any service with an OpenAI-style chat completions API and image input (for example a local model server). It must allow requests from a web page.';
  }
  function renderPhotos() {
    $('#paThumbs').innerHTML = photos.map((ph, i) => `<figure class="pa-th${ph.kind === 'other' ? ' unused' : ''}">
      <img src="${ph.url}" alt="${esc(ph.name)}"/><button type="button" data-rm="${i}" title="Remove this photo" aria-label="Remove">×</button>
      <figcaption>${ph.kind ? esc(KINDS[ph.kind] || ph.kind) : `${ph.w} × ${ph.h}`}</figcaption></figure>`).join('');
    $('#paDrop').classList.toggle('has', photos.length > 0);
  }
  function renderResult() {
    const box = $('#paResult');
    if (!last) { box.hidden = true; box.innerHTML = ''; return; }
    const ans = usable(last.answers), keys = Object.keys(ans);
    const ignored = Object.keys(last.answers).filter((k) => !(k in ans));
    const table = keys.length ? `<table class="pa-ans">${keys.map((k) => {
      const c = String(last.confidence[k] || '').toLowerCase();
      return `<tr><th>${esc(LABELS[k] || k)}</th><td>${show(k, ans[k])}</td><td>${c ? `<span class="pa-conf ${esc(c)}">${esc(c)}</span>` : ''}</td></tr>`;
    }).join('')}</table>` : '';
    const notes = last.notes.length ? `<ul class="pa-notes">${last.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
    const msg = last.message ? `<p>${esc(last.message)}</p>` : '';
    let html;
    if (last.status === 'refuse') {
      html = `<div class="pa-card refuse"><h4>These photos can't be used</h4>${msg || '<p>The AI did not find a property in these photos.</p>'}
        <p class="np-hint">Remove them (× on each photo) and add photos of the house: the front from across the street works best.</p></div>`;
    } else if (last.status === 'need_more') {
      html = `<div class="pa-card more"><h4>The AI needs more to go on</h4>${msg}
        ${last.requests.length ? `<p><b>Please add:</b></p><ul>${last.requests.map((q) => `<li>${esc(q)}</li>`).join('')}</ul>` : ''}
        ${keys.length ? `<p class="np-hint">What it could tell so far:</p>${table}` : ''}${notes}
        <div class="pa-actions"><button type="button" data-pa="add" class="primary">Add photos</button>${keys.length ? '<button type="button" data-pa="apply">Use what it found anyway</button>' : ''}</div></div>`;
    } else {
      html = `<div class="pa-card ok"><h4>What the AI found</h4>${msg}${table || '<p>No answers could be read — the Wizard\'s usual answers will be used.</p>'}${notes}
        ${ignored.length ? `<p class="np-hint">Ignored (not a value the Wizard understands): ${ignored.map((k) => esc(k)).join(', ')}.</p>` : ''}
        <p class="np-hint">Answers not listed keep the Wizard's usual values. “Low” means a rough guess — worth checking.</p>
        <div class="pa-actions"><button type="button" data-pa="apply" class="primary">Open in the Wizard</button><button type="button" data-pa="go">Analyse again</button></div></div>`;
    }
    box.innerHTML = html; box.hidden = false;
  }
  function missing() {
    if (!model()) return 'Enter a model name.';
    if (PROVIDERS[S.provider].local) return photos.length ? '' : 'Add at least one photo of the property first (step 2).';
    if (S.provider === 'custom' && !/^https?:\/\//.test((S.endpoint || '').trim())) return 'Enter the endpoint address of the service (starting with https://).';
    if (!key()) return `Enter your ${PROVIDERS[S.provider].name} API key first (step 1).`;
    if (!photos.length) return 'Add at least one photo of the property first (step 2).';
    return '';
  }
  function refresh() {
    const keyOk = (PROVIDERS[S.provider].local || !!key()) && !!model() && (S.provider !== 'custom' || /^https?:\/\//.test((S.endpoint || '').trim()));
    $('#photoAi [data-g="key"]').classList.toggle('done', keyOk);
    $('#photoAi [data-g="photo"]').classList.toggle('done', photos.length > 0);
    $('#photoAi [data-g="go"]').classList.toggle('done', !!last && last.status === 'ok');
    const go = $('#paGo');
    go.disabled = !!busy || !!missing();
    go.textContent = busy ? 'Analysing…' : (last ? 'Analyse again' : 'Analyse');
    go.title = missing() || 'Send the photos to the AI';
  }
  function status(text, kind) {
    const s = $('#paStatus');
    s.hidden = !text; s.className = `pa-status ${kind || ''}`;
    s.innerHTML = text ? `${kind === 'busy' ? '<span class="pa-spin"></span>' : ''}${esc(text)}${kind === 'busy' ? ' <button type="button" data-pa="stop">Stop</button>' : ''}` : '';
  }
  function onClick(e) {
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.stopPropagation(); const [ph] = photos.splice(+rm.dataset.rm, 1); if (ph) URL.revokeObjectURL(ph.url); last = null; renderPhotos(); renderResult(); refresh(); return; }
    if (e.target.id === 'paFile') return;
    if (e.target.closest('#paDrop') && !e.target.closest('button')) return $('#paFile').click();
    const b = e.target.closest('[data-pa]');
    if (!b) { if (e.target.id === 'photoAi') close(); return; }
    const a = b.dataset.pa;
    if (a === 'close') close();
    if (a === 'go') analyse();
    if (a === 'stop' && busy) busy.abort();
    if (a === 'apply') apply();
    if (a === 'add') $('#paFile').click();
    if (a === 'eye') { const k = $('#paKey'); k.type = k.type === 'password' ? 'text' : 'password'; b.textContent = k.type === 'password' ? 'Show' : 'Hide'; }
  }
  function open() {
    mount(); fillService(); renderPhotos(); renderResult(); refresh();
    $('#photoAi').hidden = false;
    (key() ? $('#paDrop') : $('#paKey')).focus();
  }
  function close() { const m = $('#photoAi'); if (m) m.hidden = true; }

  const btn = $('#btnPhotoAi');
  if (btn) btn.addEventListener('click', open);
  window.FP_PHOTOAI = { open, close };
})();
