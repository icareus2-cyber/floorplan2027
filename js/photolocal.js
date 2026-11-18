/*
 * Photo → House, on this computer (experimental): the photos are looked at by an image model running in this
 * browser — ONNX Runtime Web through Transformers.js — instead of a cloud AI. Nothing leaves the computer and no key
 * is needed; the library and the model (CLIP, zero-shot) are downloaded once from their CDNs the first time and kept
 * by the browser. It is a test of what a small local model can tell: CLIP scores each photo against short
 * descriptions ("a two-storey house", "a house with a hip roof" …) and the best-scoring one wins, with its score as
 * the confidence. Wall and roof colours are measured from the pixels. Size, rooms and floors are not estimated.
 *
 * window.FP_LOCALAI.analyse(photos, onStatus, signal) → a reply shaped like the cloud AI's (see photoai.js
 * parseReply): { status: 'ok' | 'need_more' | 'refuse', answers, confidence, notes, image_kinds, requests, message }.
 * For tests, window.FP_LOCALAI_TEST_PIPELINE(imageUrl, labels) → [{ label, score }] stands in for the model.
 */
(function () {
  'use strict';
  const LIB = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
  const MODEL = 'Xenova/clip-vit-base-patch32';
  const WM = window.FP_WALLMATS;
  let classifier = null, loading = null, device = null;

  /* ── the model: loaded once (WebGPU when the browser has it, else WebAssembly on the processor) ── */
  async function load(model, onStatus) {
    if (window.FP_LOCALAI_TEST_PIPELINE) return window.FP_LOCALAI_TEST_PIPELINE;
    if (classifier && classifier.model === model) return classifier.run;
    if (loading) return loading;
    loading = (async () => {
      onStatus('Loading the ONNX runtime (Transformers.js)…');
      let T;
      try { T = await import(/* webpackIgnore: true */ LIB); } catch (e) {
        throw new Error('Could not load the ONNX library from cdn.jsdelivr.net — this option needs an internet connection the first time.');
      }
      T.env.allowLocalModels = false;
      const files = {};
      const progress = (p) => {
        if (p.status !== 'progress' || !p.total) return;
        files[p.file] = [p.loaded, p.total];
        const got = Object.values(files).reduce((s, f) => s + f[0], 0), all = Object.values(files).reduce((s, f) => s + f[1], 0);
        onStatus(`Downloading the model ${model} — ${Math.round(got / 1048576)} of ${Math.round(all / 1048576)} MB (first time only; the browser keeps it)…`);
      };
      const make = (dev) => T.pipeline('zero-shot-image-classification', model, { device: dev, progress_callback: progress });
      let pipe;
      device = navigator.gpu ? 'webgpu' : 'wasm';
      try { pipe = await make(device); } catch (e) {
        if (device !== 'webgpu') throw e;
        device = 'wasm'; pipe = await make('wasm'); // no usable graphics card: on the processor
      }
      const run = async (url, labels) => {
        const out = await pipe(url, labels, { hypothesis_template: '{}' });
        return Array.isArray(out[0]) ? out[0] : out;
      };
      classifier = { model, run };
      return run;
    })();
    try { return await loading; } finally { loading = null; }
  }

  /* ── what is asked: each question a set of descriptions, the answer the best-scoring one ── */
  const KINDS = {
    exterior: ['a photo of the outside of a house', 'a photo of the front of a house seen from the street', 'a photo of a building'],
    aerial: ['an aerial photo of a house seen from above', 'a satellite view of a roof'],
    floor_plan: ['an architectural floor plan drawing', 'a black and white house plan with rooms'],
    interior: ['a photo of a room inside a house', 'a photo of a kitchen or a living room'],
    other: ['a photo of a person', 'a photo of an animal', 'a photo of food', 'a landscape without buildings', 'a screenshot of text', 'a photo of a car on its own'],
  };
  const has = (tbl, id) => !!(tbl && tbl[id]);
  const ROOF_IDS = () => (window.FP_WIZARD ? window.FP_WIZARD.options().roof : []);
  const QUESTIONS = () => [
    { key: 'floors', opts: [[1, 'a single-storey bungalow'], [2, 'a two-storey house'], [3, 'a three-storey house']] },
    { key: 'roof', opts: [['gable', 'a house with a pitched gable roof'], ['hip', 'a house with a hip roof sloping down on all four sides'], ['flat', 'a modern house with a flat roof'],
      ['shed', 'a house with a single sloping shed roof'], ['gambrel', 'a barn-style house with a gambrel roof'], ['mansard', 'a house with a steep mansard roof']].filter(([id]) => ROOF_IDS().includes(id)) },
    { key: 'wallMat', opts: [['brick', 'a red brick house'], ['stone', 'a house built of natural stone'], ['lap-siding', 'a house with horizontal wood or vinyl siding'],
      ['plaster', 'a house with smooth painted plaster walls'], ['concrete', 'a modern house with bare concrete walls'], ['wood-boards', 'a timber house with wooden board walls']].filter(([id]) => has(WM.MATS, id)) },
    { key: 'roofMat', opts: [['clay-tiles', 'a roof covered with red clay tiles'], ['concrete-tiles', 'a roof covered with grey concrete tiles'], ['slate', 'a dark slate roof'],
      ['shingles', 'a roof with asphalt shingles'], ['standing-seam', 'a metal roof'], ['green-roof', 'a green roof covered with plants']].filter(([id]) => has(WM.ROOF_MATS, id)) },
  ];
  // yes / no questions: set only when the model is fairly sure
  const YESNO = [
    { key: 'trees', yes: 'a house with trees around it', no: 'a house with no trees around it' },
    { key: 'pool', yes: 'a house with a swimming pool', no: 'a house without a swimming pool' },
    { key: 'car', yes: 'a car parked in front of a house', no: 'a house with no car in front' },
    { key: 'balcony', yes: 'a house with a balcony', no: 'a house without a balcony' },
  ];
  const level = (p) => (p >= 0.6 ? 'high' : p >= 0.4 ? 'medium' : 'low');

  /* ── colours from the pixels: the commonest colour of the walls (the middle of the photo) and of the roof (its
     upper part), leaving out sky, plants and deep shadow ── */
  function colours(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const W = 160, H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * 160));
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0, W, H);
        const px = g.getImageData(0, 0, W, H).data;
        const common = (y0, y1) => {
          const bins = new Map();
          for (let y = Math.floor(H * y0); y < H * y1; y++) for (let x = Math.floor(W * 0.2); x < W * 0.8; x++) {
            const k = (y * W + x) * 4, r = px[k], gg = px[k + 1], b = px[k + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
            if (mx < 35) continue;                                  // shadow
            if (b > r + 25 && b > gg + 10 && mx > 120) continue;    // sky
            if (gg > r + 18 && gg > b + 8) continue;                // plants
            const key = `${r >> 5},${gg >> 5},${b >> 5}`, e = bins.get(key) || [0, 0, 0, 0];
            e[0] += r; e[1] += gg; e[2] += b; e[3]++; bins.set(key, e);
            void mn;
          }
          const best = [...bins.values()].sort((p, q) => q[3] - p[3])[0];
          return best && best[3] > 20 ? '#' + [best[0], best[1], best[2]].map((v) => Math.round(v / best[3]).toString(16).padStart(2, '0')).join('') : null;
        };
        resolve({ wall: common(0.45, 0.8), roof: common(0.12, 0.38) });
      };
      img.onerror = () => resolve({});
      img.src = url;
    });
  }

  async function analyse(photos, onStatus, signal, model = MODEL) {
    const stop = () => { if (signal && signal.aborted) { const e = new Error('stopped'); e.name = 'AbortError'; throw e; } };
    const run = await load(model, onStatus);
    stop();
    const urls = photos.map((ph) => `data:image/jpeg;base64,${ph.data}`);
    // 1. what each photo shows
    const kindLabels = Object.entries(KINDS).flatMap(([k, ls]) => ls.map((l) => [k, l]));
    const kinds = [];
    for (let i = 0; i < urls.length; i++) {
      onStatus(`Looking at photo ${i + 1} of ${urls.length} on this computer${device ? ` (${device === 'webgpu' ? 'graphics card' : 'processor'})` : ''}…`);
      const res = await run(urls[i], kindLabels.map(([, l]) => l));
      stop();
      const sum = {};
      for (const r of res) { const k = (kindLabels.find(([, l]) => l === r.label) || ['other'])[0]; sum[k] = (sum[k] || 0) + r.score; }
      kinds.push(Object.entries(sum).sort((a, b) => b[1] - a[1])[0][0]);
    }
    const outside = urls.filter((_, i) => kinds[i] === 'exterior');
    const reply = { status: 'ok', answers: {}, confidence: {}, notes: [], requests: [], image_kinds: kinds, message: '' };
    if (!outside.length) {
      if (kinds.every((k) => k === 'other')) return { ...reply, status: 'refuse', message: 'The local model did not find a house in these photos.' };
      return { ...reply, status: 'need_more', requests: ['A photo of the outside of the house — the front, from across the street, works best.'],
        message: 'The local model can only read the house from an outside photo; these show ' + [...new Set(kinds)].map((k) => k.replace('_', ' ')).join(', ') + '.' };
    }
    // 2. the house from the outside photos (their scores averaged)
    const ask = async (labels) => {
      const tot = new Map(labels.map((l) => [l, 0]));
      for (const u of outside) { for (const r of await run(u, labels)) tot.set(r.label, tot.get(r.label) + r.score / outside.length); stop(); }
      return tot;
    };
    onStatus(`Reading the house from ${outside.length} outside photo${outside.length > 1 ? 's' : ''}…`);
    for (const q of QUESTIONS()) {
      if (q.opts.length < 2) continue;
      const tot = await ask(q.opts.map(([, l]) => l));
      const [label, p] = [...tot.entries()].sort((a, b) => b[1] - a[1])[0];
      const id = q.opts.find(([, l]) => l === label)[0];
      reply.answers[q.key] = id; reply.confidence[q.key] = level(p);
      reply.notes.push(`${q.key}: ${q.opts.map(([oid, l]) => `${oid} ${Math.round(tot.get(l) * 100)}%`).join(' · ')}`);
    }
    for (const q of YESNO) {
      const tot = await ask([q.yes, q.no]), p = tot.get(q.yes);
      if (p >= 0.6 || p <= 0.4) { reply.answers[q.key] = p >= 0.6; reply.confidence[q.key] = level(Math.max(p, 1 - p)); }
      reply.notes.push(`${q.key}: yes ${Math.round(p * 100)}%`);
    }
    // 3. colours from the first outside photo
    const col = await colours(outside[0]);
    if (col.wall) { reply.answers.wallColor = col.wall; reply.confidence.wallColor = 'medium'; }
    if (col.roof && reply.answers.roof !== 'flat') { reply.answers.roofColor = col.roof; reply.confidence.roofColor = 'low'; }
    reply.message = `Read on this computer by ${model} (ONNX${device ? `, ${device === 'webgpu' ? 'graphics card' : 'processor'}` : ''}). The percentages below are its scores for each choice. Size, rooms and floors are not estimated — set them in the Wizard.`;
    return reply;
  }

  window.FP_LOCALAI = { analyse, MODEL, LIB };
})();
