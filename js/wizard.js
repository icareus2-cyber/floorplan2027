/*
 * House Building Wizard (top bar → Wizard)
 * Asks a few questions — size, storeys, rooms, wall colours, roof, floor finishes, extras — and designs a house from
 * the answers with fixed layout rules (no AI needed: every answer is a choice the rules turn into walls and rooms).
 * The house is then built step by step with the demo player (js/app.js "demo houses"), in the format of js/demo.js;
 * "Change answers" there comes back here with every answer kept, and any step can be changed at any time.
 *
 * Layout rules (cm, walls by their centrelines; outer walls 20 cm, partitions 10 cm; the front — entrance — is the
 * bottom edge of the plan):
 *   one storey   back row: living room (+ kitchen, or one open-plan room); front row: bedrooms, the entrance hall and
 *                the bathrooms side by side, each with a door into the back row
 *   2–3 storeys  a 3.6 m stair hall through the middle of every storey (U-shaped stairs on its right, a walkway on its
 *                left); ground floor: living room on the left, kitchen and shower room on the right; upper storeys:
 *                four rooms (bedrooms, bathrooms, a study) round the landing, a stairwell over the stairs below
 */
(function () {
  'use strict';
  const FP = window.FP, WM = window.FP_WALLMATS, MATS = window.FP_MATERIALS, esc = window.FP_ESC;
  if (!FP || !FP.demoBuild) return;
  const $ = (s, r = document) => r.querySelector(s);
  const r10 = (v) => Math.round(v / 10) * 10;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const DEFAULTS = {
    name: 'My house', ground: 'grass', style: FP.defaultStyle ? FP.defaultStyle() : 'western',
    w: 12, d: 9, shape: 'rect', site: 'flat', rise: 1, raise: 0, basement: false, floors: 2, storeyH: 3,
    bedrooms: 3, baths: 2, kitchen: 'separate',
    wallMat: 'plaster', wallColor: '#e4dfd6', inColor: '#f4f1ec',
    roof: 'gable', pitch: 30, roofMat: 'clay-tiles', roofColor: '',
    flLiving: 'wood', flBed: 'carpet', flWet: 'tile',
    balcony: true, linings: false, furniture: true, trees: true, pool: false, car: true,
  };
  // a Japanese default (Settings → Style) starts with the Japanese roof
  if (DEFAULTS.style === 'japanese') Object.assign(DEFAULTS, { roof: 'irimoya', roofMat: 'kawara', pitch: 25 });
  let A = { ...DEFAULTS };
  try { const s = JSON.parse(localStorage.getItem('floorplan2027.wizard') || 'null'); if (s) A = { ...DEFAULTS, ...s }; } catch (e) { /* none kept */ }
  const remember = () => { try { localStorage.setItem('floorplan2027.wizard', JSON.stringify(A)); } catch (e) { /* storage unavailable */ } };

  /* ───────────────────────── the design: answers → rooms and building steps ───────────────────────── */
  function design(a) {
    const n = clamp(+a.floors || 1, 1, 3), H = r10(clamp(+a.storeyH || 3, 2.6, 3.6) * 100);
    let W = r10(clamp(+a.w || 12, 6, 20) * 100), D = r10(clamp(+a.d || 9, 6, 15) * 100);
    const notes = [];
    if (n > 1 && W < 1000) { W = 1000; notes.push('Width set to 10 m — a house with stairs needs room for the stair hall in the middle.'); }
    if (n > 1 && D < 700) { D = 700; notes.push('Depth set to 7 m — the stairs need that much room.'); }
    const names = n === 1 ? ['Ground floor'] : n === 2 ? ['Ground floor', 'Upper floor'] : ['Ground floor', 'First floor', 'Second floor'];
    const levels = names.map((name, i) => ({ id: 'L' + i, name, elev: i * H, wallH: H }));
    // per storey: rooms, partitions, doors, windows, things added like from the picker
    const LV = levels.map(() => ({ rooms: [], walls: [], doors: [], windows: [], adds: [] }));
    const room = (i, name, kind, x, y, w, h) => { const r = { lvl: i, name, kind, x, y, w, h, cx: x + w / 2, cy: y + h / 2 }; LV[i].rooms.push(r); return r; };
    const win = (i, x, y, r, w) => LV[i].windows.push(['window', r10(x), r10(y), r, { w }]);
    let beds = 0, baths = 0, frontDoorX = W / 2, stairs = null;

    if (n === 1) {
      const a1 = r10(D * 0.55); // depth of the back row
      if (a.kitchen === 'separate') {
        const kx = r10(W * 0.62);
        room(0, 'Living room', 'living', 0, 0, kx, a1);
        room(0, 'Kitchen', 'kitchen', kx, 0, W - kx, a1);
        LV[0].walls.push([kx, 0, kx, a1]);
        LV[0].doors.push(['door', kx, r10(a1 * 0.7), 90]);
        win(0, kx / 3, 0, 0, 160); win(0, (kx * 2) / 3, 0, 0, 160); win(0, (kx + W) / 2, 0, 0, 140); win(0, W, a1 / 2, 90, 120);
      } else {
        room(0, 'Living room & kitchen', 'living-kitchen', 0, 0, W, a1);
        win(0, W / 4, 0, 0, 160); win(0, W / 2, 0, 0, 160); win(0, (W * 3) / 4, 0, 0, 140); win(0, W, a1 / 2, 90, 120);
      }
      win(0, 0, a1 / 2, 90, 160);
      LV[0].walls.push([0, a1, W, a1]);
      // the front row: bedrooms, the hall and the bathrooms
      const HALL = 220, BATH = 250, BED = 280;
      let nb = clamp(+a.baths || 1, 1, 2);
      const fit = (b) => Math.floor((W - HALL - b * BATH) / BED);
      let nbed = Math.max(1, Math.min(+a.bedrooms || 1, fit(nb)));
      if (nbed < a.bedrooms && nb > 1) { nb = 1; nbed = Math.max(1, Math.min(+a.bedrooms || 1, fit(1))); }
      const left = Math.ceil(nbed / 2), order = [...Array(left).fill('bed'), 'hall', ...Array(nb).fill('bath'), ...Array(nbed - left).fill('bed')];
      const bedW = r10((W - HALL - nb * BATH) / nbed);
      let x = 0;
      order.forEach((kind, k) => {
        const w = k === order.length - 1 ? W - x : kind === 'bed' ? bedW : kind === 'hall' ? HALL : BATH;
        const leftSide = x + w / 2 < W / 2;
        if (k) LV[0].walls.push([x, a1, x, D]);
        if (kind === 'hall') {
          room(0, 'Entrance hall', 'hall', x, a1, w, D - a1);
          frontDoorX = x + w / 2;
          LV[0].doors.push(['door', r10(x + w / 2), D, 180], ['door', r10(x + w / 2), a1, 0]);
        } else {
          const r = kind === 'bed' ? room(0, beds++ ? `Bedroom ${beds}` : 'Main bedroom', 'bed', x, a1, w, D - a1) : room(0, baths++ ? `Bathroom ${baths}` : 'Bathroom', 'bath', x, a1, w, D - a1);
          LV[0].doors.push(['door', r10(leftSide ? x + w - 60 : x + 60), a1, 0]);
          win(0, r.cx, D, 0, kind === 'bed' ? 120 : 60);
          if (k === 0) win(0, 0, r.cy, 90, kind === 'bed' ? 120 : 60);
          if (k === order.length - 1) win(0, W, r.cy, 90, kind === 'bed' ? 120 : 60);
        }
        x += w;
      });
    } else {
      const HW = 360, h0 = r10((W - HW) / 2), h1 = h0 + HW, mid = r10(D / 2);
      const yN = r10(clamp((mid - 190) / 2, 60, mid - 240)), yS = D - yN; // doors on the right of the hall: clear of the stairs
      stairs = [h1 - 100, mid];
      frontDoorX = h0 + 85;
      // ground floor
      room(0, 'Living room', 'living', 0, 0, h0, D);
      room(0, 'Hall & stairs', 'hall', h0, 0, HW, D);
      room(0, 'Kitchen', 'kitchen', h1, 0, W - h1, mid);
      const wc = room(0, +a.baths > 1 ? 'Shower room' : 'Bathroom', 'bath', h1, mid, W - h1, D - mid); baths++;
      void wc;
      LV[0].walls.push([h0, 0, h0, D], [h1, 0, h1, D], [h1, mid, W, mid]);
      LV[0].doors.push(['door', r10(frontDoorX), D, 180], ['door', h0, mid, 90], ['door', h1, yN, 90], ['door', h1, yS, 90], ['door-sliding', r10(h0 / 2), 0, 0, { w: Math.min(240, r10(h0 * 0.45)) }]);
      win(0, 0, D / 4, 90, 160); win(0, 0, (D * 3) / 4, 90, 160); win(0, h0 / 2, D, 0, 160);
      win(0, (h1 + W) / 2, 0, 0, 140); win(0, W, mid / 2, 90, 120); win(0, W, (mid + D) / 2, 90, 60); win(0, h0 + 90, 0, 0, 80);
      LV[0].adds.push(['stairs-u', stairs[0], stairs[1]]);
      // upper storeys: four rooms round the landing
      let upBaths = Math.max(0, (+a.baths || 1) - 1), toBed = +a.bedrooms || 1;
      for (let i = 1; i < n; i++) {
        room(i, 'Landing', 'hall', h0, 0, HW, D);
        LV[i].walls.push([h0, 0, h0, D], [h1, 0, h1, D], [0, mid, h0, mid], [h1, mid, W, mid]);
        const slots = { LN: [0, 0, h0, mid, [h0, r10(mid / 2)]], LS: [0, mid, h0, D - mid, [h0, r10((mid + D) / 2)]], RN: [h1, 0, W - h1, mid, [h1, yN]], RS: [h1, mid, W - h1, D - mid, [h1, yS]] };
        const kind = {};
        for (const s of ['RS', 'LS']) if (upBaths > 0) { kind[s] = 'bath'; upBaths--; }
        for (const s of ['LN', 'RN', 'LS', 'RS']) if (!kind[s] && toBed > 0) { kind[s] = 'bed'; toBed--; }
        for (const s of ['LN', 'RN', 'LS', 'RS']) {
          const [x, y, w, h, door] = slots[s], k = kind[s] || 'study';
          const r = room(i, k === 'bed' ? (beds++ ? `Bedroom ${beds}` : 'Main bedroom') : k === 'bath' ? (baths++ ? `Bathroom ${baths}` : 'Bathroom') : 'Study', k, x, y, w, h);
          LV[i].doors.push(['door', door[0], door[1], 90]);
          const front = y > 0, sideX = x === 0 ? 0 : W;
          const balconyHere = a.balcony && i === 1 && s === 'LN';
          if (!(front === false && balconyHere)) win(i, r.cx, front ? D : 0, 0, k === 'bath' ? 60 : 140);
          if (k !== 'bath') win(i, sideX, r.cy, 90, 120);
        }
        win(i, h0 + 90, 0, 0, 80);
        if (i < n - 1) LV[i].adds.push(['stairs-u', stairs[0], stairs[1]]);
        if (a.balcony && i === 1) LV[i].adds.push(['balcony', r10(h0 / 2), -80]);
      }
      if (toBed > 0 || upBaths > 0) notes.push(`${toBed > 0 ? `${toBed} bedroom${toBed === 1 ? '' : 's'}` : ''}${toBed > 0 && upBaths > 0 ? ' and ' : ''}${upBaths > 0 ? `${upBaths} bathroom${upBaths === 1 ? '' : 's'}` : ''} did not fit — add a storey for more rooms.`);
    }
    if (n === 1 && beds < a.bedrooms) notes.push(`${beds} bedroom${beds === 1 ? '' : 's'} fit on one storey ${W / 100} m wide — make the house wider, or give it two storeys, for more.`);
    if (n === 1 && baths < a.baths) notes.push(`${baths} bathroom fits beside the bedrooms — make the house wider for a second one.`);
    if (a.style === 'japanese') japanese(a, LV, D, frontDoorX);
    const rooms = LV.flatMap((l) => l.rooms);

    /* ── the building steps (ops as in js/demo.js) ── */
    const steps = [], loop = [[0, 0], [W, 0], [W, D], [0, D]];
    const paint = [{ op: 'paint', side: 'out', wmat: a.wallMat, wcol: a.wallColor }, { op: 'paint', side: 'in', wmat: 'plaster', wcol: a.inColor }];
    const floorOf = (r) => (r.kind === 'washitsu' ? 'tatami' : r.kind === 'bath' || r.kind === 'kitchen' ? a.flWet : r.kind === 'bed' ? a.flBed : r.kind === 'hall' ? (r.lvl ? a.flLiving : 'stone') : a.flLiving);
    const nm = (i) => (n === 1 ? '' : `${levels[i].name}: `);
    const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
    steps.push({ title: `${nm(0)}Outer walls`, text: `The ${W / 100} × ${D / 100} m outline is set out and the outer walls go up: 20 cm thick, ${(H / 100).toFixed(2)} m high.`,
      ops: [{ op: 'loop', t: 20, pts: loop }] });
    steps.push({ title: 'Ground slab', text: 'A concrete slab is poured inside the outer walls.', ops: [{ op: 'slab', at: [W / 4, D / 4], kind: 'concrete' }] });
    steps.push({ title: `${nm(0)}Inner walls`, text: `Partitions make the rooms: ${LV[0].rooms.map((r) => lc(r.name)).join(', ')}. The walls get their colours, outside and in.`,
      ops: [{ op: 'walls', t: 10, list: LV[0].walls }, ...paint] });
    steps.push({ title: `${nm(0)}Doors and windows`, text: 'The front door, the inner doors and the windows are set into the walls.',
      ops: [{ op: 'place', list: [...LV[0].doors, ...LV[0].windows] }] });
    if (n > 1) steps.push({ title: 'Stairs', text: 'U-shaped stairs go up in the stair hall; their steps are worked out from the storey height.', ops: [{ op: 'add', list: LV[0].adds }] });
    for (let i = 1; i < n; i++) {
      steps.push({ title: `${levels[i].name}: floor slab`, text: `The ${lc(levels[i].name)} slab is laid on the walls below, with a stairwell and railing over the stairs.`,
        ops: [{ op: 'level', id: levels[i].id }, { op: 'slab', at: [W / 4, D / 4], kind: 'concrete' },
          { op: 'add', list: [['slab-opening', stairs[0], stairs[1], 0, { matchStairs: true, rail: '3' }]] }] });
      steps.push({ title: `${levels[i].name}: walls`, text: `The walls go up: ${LV[i].rooms.map((r) => lc(r.name)).join(', ')}.`,
        ops: [{ op: 'loop', t: 20, pts: loop }, { op: 'walls', t: 10, list: LV[i].walls }, ...paint] });
      steps.push({ title: `${levels[i].name}: doors and windows`, text: `Doors from the landing into every room, and the windows${LV[i].adds.some((x) => x[0] === 'balcony') ? ' — and a balcony with a glass sliding door' : ''}${LV[i].adds.some((x) => x[0] === 'stairs-u') ? '; stairs on up to the next storey' : ''}.`,
        ops: [{ op: 'place', list: [...LV[i].doors, ...LV[i].windows] }, ...(LV[i].adds.length ? [{ op: 'add', list: LV[i].adds }] : [])] });
    }
    // the roof: its ridge along the longer side
    const roofType = 'roof-' + a.roof, along = W >= D;
    const ro = along ? { x: -10, y: -10, w: W + 20, h: D + 20, r: 0 } : { x: W / 2 - (D + 20) / 2, y: D / 2 - (W + 20) / 2, w: D + 20, h: W + 20, r: 90 };
    steps.push({ title: 'Roof', text: `A ${lc((FP.byId[roofType] || { name: 'roof' }).name)} covers the house${a.roof === 'flat' ? '' : ` (${a.pitch}°)`}, in ${lc((WM.ROOF_MATS[a.roofMat] || { name: 'tiles' }).name)}. It rests on the walls of the top storey.`,
      ops: [{ op: 'level', id: levels[n - 1].id }, { op: 'roof', type: roofType, ...ro, pitch: +a.pitch, roofMat: a.roofMat, color: a.roofColor || undefined }] });
    // finishes, fittings and furniture, storey by storey
    for (let i = 0; i < n; i++) {
      const rs = LV[i].rooms, ops = [{ op: 'level', id: levels[i].id }];
      if (a.linings && rs.some((r) => r.kind === 'bed')) ops.push({ op: 'lining', at: rs.filter((r) => r.kind === 'bed').map((r) => [r.cx, r.cy]) });
      ops.push({ op: 'floor', at: rs.map((r) => [r.cx, r.cy + (r.kind === 'hall' && n > 1 ? r.h * 0.4 : 0), floorOf(r)]) });
      if (a.furniture) ops.push({ op: 'place', list: rs.flatMap((r) => furnish(r, D, i, a)) });
      if (LV[i].extra) ops.push({ op: 'place', list: LV[i].extra }); // (the genkan of a Japanese house)
      steps.push({ title: `${nm(i)}${a.furniture ? 'Floors and furniture' : 'Floors'}`.replace(/^./, (c) => c.toUpperCase()),
        text: `${a.linings ? 'The bedrooms get 10 cm service linings; then ' : ''}${a.linings ? 'f' : 'F'}loors are laid${a.furniture ? ' and the rooms are fitted out and furnished' : ''}: ${rs.map((r) => `${lc(r.name)} (${lc((MATS[floorOf(r)] || { name: '' }).name)})`).join(', ')}.`,
        ops });
    }
    // the plot
    const garden = [];
    if (a.trees) garden.push(['tree', -300, D * 0.3, 0], ['tree', W + 320, D * 0.65, 0], ['tree-conifer', -260, D + 150, 0], ['bush', W + 160, D + 140, 0], ['flowerbed', r10(W * 0.22), D + 120, 0]);
    if (a.pool) garden.push(['pool', r10(W / 2), -360, 0, { w: r10(Math.min(800, W * 0.6)), h: 300 }], ['lounger', r10(W / 2 - Math.min(400, W * 0.3) - 110), -360, 0], ['lounger', r10(W / 2 + Math.min(400, W * 0.3) + 110), -360, 0]);
    if (a.car) garden.push(['gravel-path', r10(frontDoorX), D + 210, 90, { w: 400, h: 120 }], ['car', W - 140, D + 330, 0]);
    if (garden.length) steps.push({ title: 'Garden', text: `Finally the plot: ${[a.trees && 'trees and flowers', a.pool && 'a pool with sun loungers', a.car && 'a path to the front door and a parking place'].filter(Boolean).join(', ')}. The house is complete — open the 3D view to look round it.`,
      ops: [{ op: 'level', id: 'L0' }, { op: 'place', list: garden }] });
    else steps[steps.length - 1].text += ' The house is complete — open the 3D view to look round it.';

    const house = {
      id: 'wizard', name: a.name || 'My house', ground: a.ground, wallH: H, slabT: 30, levels, steps,
      blurb: '', size: `${W / 100} × ${D / 100} m · ${n} storey${n === 1 ? '' : 's'}`, style: a.style === 'japanese' ? 'japanese' : 'western',
    };
    // a Japanese house is counted the Japanese way: rooms besides the LDK (3LDK = three rooms + living, dining, kitchen)
    if (a.style === 'japanese') house.size += ` · ${rooms.filter((r) => ['bed', 'washitsu', 'study'].includes(r.kind)).length}LDK`;
    return { house, rooms, notes, W, D, H, n, levels, LV, frontDoorX, stairs };
  }

  /* ───────────────────────── footprint shapes ─────────────────────────
     The house can be more than one rectangle: a main block (laid out by design() above, with every room, the stairs
     and the front door on its front edge) and one or two wings, all within the width × depth of the Size sliders.
     Wings go at the back or the sides, never in front, so the street side and the front door stay clear. The main
     block's wall where a wing meets it becomes an inner wall with a door; each wing is one room per storey (a family
     room on the ground floor, a bedroom above) with windows round it; every block gets its own roof (the roofs trim
     each other where they meet). */
  const SHAPES = [
    ['rect', 'Rectangle', 'one block'], ['l-left', 'L — wing back left', 'two blocks'], ['l-right', 'L — wing back right', 'two blocks'],
    ['t', 'T — wing behind', 'two blocks'], ['u', 'U — two back wings', 'round a courtyard'], ['side-left', 'Side wing left', 'set back'],
    ['side-right', 'Side wing right', 'set back'], ['offset', 'Staggered', 'two overlapping blocks'],
  ];
  // the blocks of a shape in a W × D box (cm): main and wings [{x, y, w, h}]; null when the box is too small for it
  function blocksOf(shape, W, D, n) {
    const minW = n > 1 ? 1000 : 600, minD = n > 1 ? 700 : 600, WING = 300;
    const R = (x, y, w, h) => ({ x: r10(x), y: r10(y), w: r10(w), h: r10(h) });
    if (shape === 'rect' || !shape) return { main: R(0, 0, W, D), wings: [] };
    if (['l-left', 'l-right', 't', 'u'].includes(shape)) {
      const Dm = clamp(r10(D * 0.6), minD, D - WING), dw = D - Dm;
      if (dw < WING || W < minW) return null;
      const ww = r10(clamp(W * (shape === 'u' ? 0.3 : 0.45), WING, W / 2));
      const main = R(0, dw, W, Dm);
      const at = { 'l-left': [0], 'l-right': [W - ww], t: [(W - ww) / 2], u: [0, W - ww] }[shape];
      return { main, wings: at.map((x) => R(x, 0, ww, dw)) };
    }
    if (shape === 'side-left' || shape === 'side-right') {
      const Wm = clamp(r10(W * 0.65), minW, W - WING), ww = W - Wm, dw = r10(clamp(D * 0.55, WING, D));
      if (ww < WING || D < minD) return null;
      return shape === 'side-left' ? { main: R(ww, 0, Wm, D), wings: [R(0, 0, ww, dw)] } : { main: R(0, 0, Wm, D), wings: [R(Wm, 0, ww, dw)] };
    }
    if (shape === 'offset') {
      const Wm = clamp(r10(W * 0.62), minW, W - WING), Dm = clamp(r10(D * 0.68), minD, D - WING);
      const ww = r10(Math.max(WING, W * 0.55)), dw = r10(Math.max(WING, D * 0.6));
      if (W - Wm < WING / 2 || D - Dm < WING / 2 || Wm + ww <= W || Dm + dw <= D) return null; // they must overlap
      return { main: R(0, D - Dm, Wm, Dm), wings: [R(W - ww, 0, ww, dw)] };
    }
    return null;
  }
  const inRect = (r, x, y, e = 0.5) => x > r.x + e && x < r.x + r.w - e && y > r.y + e && y < r.y + r.h - e;
  // the outline round a union of rectangles (clockwise on the plan, corners only)
  function unionOutline(rects) {
    const xs = [...new Set(rects.flatMap((r) => [r.x, r.x + r.w]))].sort((a, b) => a - b), ys = [...new Set(rects.flatMap((r) => [r.y, r.y + r.h]))].sort((a, b) => a - b);
    const inside = (i, j) => i >= 0 && j >= 0 && i < xs.length - 1 && j < ys.length - 1 && rects.some((r) => inRect(r, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2));
    const next = new Map(), key = (p) => p.join(',');
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
      if (!inside(i, j)) continue;
      const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
      if (!inside(i, j - 1)) next.set(key([x0, y0]), [x1, y0]);
      if (!inside(i + 1, j)) next.set(key([x1, y0]), [x1, y1]);
      if (!inside(i, j + 1)) next.set(key([x1, y1]), [x0, y1]);
      if (!inside(i - 1, j)) next.set(key([x0, y1]), [x0, y0]);
    }
    const start = [...next.keys()].map((k) => k.split(',').map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
    const pts = [start];
    for (let p = next.get(key(start)), g = 0; p && key(p) !== key(start) && g < 1000; p = next.get(key(p)), g++) pts.push(p);
    return pts.filter((p, i) => { const a = pts[(i - 1 + pts.length) % pts.length], c = pts[(i + 1) % pts.length]; return !((a[0] === p[0] && p[0] === c[0]) || (a[1] === p[1] && p[1] === c[1])); });
  }
  // the parts of the main block's edges with the house on both sides: inner walls where a wing meets it
  function jointsOf(main, rects) {
    const inU = (x, y) => rects.some((r) => inRect(r, x, y, 0));
    const edges = [[main.x, main.y, main.x + main.w, main.y, 0, -1], [main.x, main.y + main.h, main.x + main.w, main.y + main.h, 0, 1],
      [main.x, main.y, main.x, main.y + main.h, -1, 0], [main.x + main.w, main.y, main.x + main.w, main.y + main.h, 1, 0]];
    const out = [];
    for (const [x1, y1, x2, y2, nx, ny] of edges) {
      const L = Math.hypot(x2 - x1, y2 - y1), N = Math.round(L / 5);
      let from = null;
      for (let k = 0; k <= N; k++) {
        const t = k / N, x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t, both = k > 0 && k < N && inU(x + nx * 15, y + ny * 15) && inU(x - nx * 15, y - ny * 15);
        if (both && from == null) from = t;
        if ((!both || k === N) && from != null) {
          const t2 = both ? t : (k - 1) / N;
          if ((t2 - from) * L >= 30) out.push([r10(x1 + (x2 - x1) * from), r10(y1 + (y2 - y1) * from), r10(x1 + (x2 - x1) * t2), r10(y1 + (y2 - y1) * t2)]);
          from = null;
        }
      }
    }
    return out;
  }
  // a point on a segment (within tol)?
  const onSeg = (s, x, y, tol = 15) => { const [x1, y1, x2, y2] = s, dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1, t = ((x - x1) * dx + (y - y1) * dy) / L2;
    return t >= -0.01 && t <= 1.01 && Math.hypot(x1 + dx * t - x, y1 + dy * t - y) <= tol; };

  function designShaped(a) {
    const n = clamp(+a.floors || 1, 1, 3), W = r10(clamp(+a.w || 12, 6, 20) * 100), D = r10(clamp(+a.d || 9, 6, 15) * 100);
    const B = (a.shape && a.shape !== 'rect') ? blocksOf(a.shape, W, D, n) : null;
    if (!B || !B.wings.length) {
      const d = design(a);
      if (a.shape && a.shape !== 'rect') d.notes.push(`${W / 100} × ${D / 100} m is too small for the “${(SHAPES.find((x) => x[0] === a.shape) || ['', a.shape])[1]}” shape — built as a rectangle. Make the house bigger for a wing.`);
      return d;
    }
    const m = B.main, d = design({ ...a, w: m.w / 100, d: m.h / 100 });
    const ox = m.x, oy = m.y, rects = [{ ...m, w: d.W, h: d.D }, ...B.wings], main = rects[0];
    // 1. the main block's design moved into place (the garden round the whole house)
    const T = (x, y) => [r10(x + ox), r10(y + oy)];
    const G = (x, y) => [x < 0 ? x : x > main.w ? x - main.w + W : x + ox, y < 0 ? y : y > main.h ? y - main.h + D : y + oy];
    for (const st of d.house.steps) {
      const garden = st.title === 'Garden';
      for (const op of st.ops) {
        if (op.op === 'loop') op.pts = op.pts.map(([x, y]) => T(x, y));
        if (op.op === 'walls') op.list = op.list.map(([x1, y1, x2, y2]) => [...T(x1, y1), ...T(x2, y2)]);
        if (op.op === 'slab') op.at = T(...op.at);
        if (op.op === 'lining') op.at = op.at.map(([x, y]) => T(x, y));
        if (op.op === 'floor') op.at = op.at.map(([x, y, mm]) => [...T(x, y), mm]);
        if (op.op === 'place' || op.op === 'add') op.list = op.list.map(([t, x, y, ...r]) => [t, ...(garden ? G(x, y) : T(x, y)), ...r]);
        if (op.op === 'roof') { op.x += ox; op.y += oy; }
      }
    }
    for (const L of d.LV) {
      for (const r of L.rooms) { r.x += ox; r.y += oy; r.cx += ox; r.cy += oy; }
      for (const list of [L.windows, L.doors, L.adds]) list.forEach((e) => { e[1] += ox; e[2] += oy; }); // (the preview's front view)
    }
    if (d.stairs) d.stairs = T(...d.stairs);
    // 2. the outline of the whole house; the main block's walls where wings meet it become inner walls with doors
    const outline = unionOutline(rects), joints = jointsOf(main, rects);
    let dropped = 0;
    for (const st of d.house.steps) for (const op of st.ops) {
      if (op.op === 'loop') op.pts = outline;
      if (op.op === 'place') op.list = op.list.filter(([t, x, y]) => !(/^window/.test(t) && joints.some((j) => onSeg(j, x, y))));
      // a balcony would hang over a wing: left out
      if (op.op === 'add') op.list = op.list.filter(([t, x, y]) => { const out = t === 'balcony' && B.wings.some((w) => inRect(w, x, y, -60)); if (out) dropped++; return !out; });
    }
    if (dropped) d.notes.push('The balcony would hang over a wing — left out.');
    // 3. the wings: one room per storey (the part of the wing outside the main block), windows round their outer walls
    const pieces = B.wings.map((w) => {
      const xs = [...new Set([w.x, w.x + w.w, main.x, main.x + main.w].filter((v) => v >= w.x && v <= w.x + w.w))].sort((p, q) => p - q);
      const ys = [...new Set([w.y, w.y + w.h, main.y, main.y + main.h].filter((v) => v >= w.y && v <= w.y + w.h))].sort((p, q) => p - q);
      let best = null;
      for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < ys.length; j++) {
        const c = { x: xs[i], y: ys[j], w: xs[i + 1] - xs[i], h: ys[j + 1] - ys[j] };
        if (inRect(main, c.x + c.w / 2, c.y + c.h / 2, 0)) continue;
        if (!best || c.w * c.h > best.w * best.h) best = c;
      }
      return best;
    }).filter(Boolean);
    const segs = outline.map((p, i) => [...p, ...outline[(i + 1) % outline.length]]);
    const wingWins = [];
    for (const s of segs) {
      const [x1, y1, x2, y2] = s, mx = (x1 + x2) / 2, my = (y1 + y2) / 2, L = Math.hypot(x2 - x1, y2 - y1);
      const onMain = onSeg([main.x, main.y, main.x + main.w, main.y], mx, my, 1) || onSeg([main.x, main.y + main.h, main.x + main.w, main.y + main.h], mx, my, 1) ||
        onSeg([main.x, main.y, main.x, main.y + main.h], mx, my, 1) || onSeg([main.x + main.w, main.y, main.x + main.w, main.y + main.h], mx, my, 1);
      if (onMain || L < 180) continue;
      const k = Math.max(1, Math.floor(L / 280)), r = y1 === y2 ? 0 : 90;
      for (let i = 0; i < k; i++) { const t = (i + 0.5) / k; wingWins.push(['window', r10(x1 + (x2 - x1) * t), r10(y1 + (y2 - y1) * t), r, { w: 120 }]); }
    }
    // (one storey: a wing is a bedroom while the main block could not fit all the bedrooms asked for)
    const short = n === 1 ? Math.max(0, (+a.bedrooms || 1) - d.LV[0].rooms.filter((r) => r.kind === 'bed').length) : 0;
    const groundKind = pieces.map((_, k) => (k < short ? 'bed' : 'living'));
    const wingRooms = d.levels.map((L, i) => pieces.map((pc, k) => {
      const kind = i === 0 ? groundKind[k] : 'bed';
      return { lvl: i, name: kind === 'bed' ? `Wing bedroom${pieces.length > 1 ? ` ${k + 1}` : ''}` : (pieces.length > 1 ? `Family room ${k + 1}` : 'Family room'),
        kind, ...pc, cx: pc.x + pc.w / 2, cy: pc.y + pc.h / 2 };
    }));
    if (short && pieces.length >= short) d.notes = d.notes.filter((t) => !/bedroom.* fit on one storey/.test(t)); // every bedroom has found a place
    else if (short) d.notes = d.notes.map((t) => (/bedroom.* fit on one storey/.test(t) ? `${t.replace(/ — .*/, '')}, and ${pieces.length} more in the wing${pieces.length > 1 ? 's' : ''} — make the house bigger, or give it two storeys, for more.` : t));
    wingRooms.forEach((rs, i) => d.LV[i].rooms.push(...rs));
    // doors through the inner walls where none is there yet
    const allDoors = (lvlIdx) => d.house.steps.filter((st) => st.ops.some((o) => o.op === 'level' ? o.id === d.levels[lvlIdx].id : false) || (lvlIdx === 0 && !st.ops.some((o) => o.op === 'level')))
      .flatMap((st) => st.ops.filter((o) => o.op === 'place').flatMap((o) => o.list)).filter(([t]) => /door/.test(t));
    const paint = (d.house.steps.find((st) => st.ops.some((o) => o.op === 'paint')) || { ops: [] }).ops.filter((o) => o.op === 'paint');
    const wingOps = [];
    d.levels.forEach((L, i) => {
      const doors = joints.filter((j) => Math.hypot(j[2] - j[0], j[3] - j[1]) >= 120 && !allDoors(i).some(([, x, y]) => onSeg(j, x, y)))
        .map((j) => ['door', r10((j[0] + j[2]) / 2), r10((j[1] + j[3]) / 2), j[1] === j[3] ? 0 : 90]);
      wingOps.push({ op: 'level', id: L.id }, { op: 'walls', t: 10, list: joints }, ...paint, { op: 'place', list: [...doors, ...wingWins] });
    });
    // insert before the roof
    const ri = d.house.steps.findIndex((st) => st.title === 'Roof');
    const wingName = B.wings.length > 1 ? 'The wings' : 'The wing';
    d.house.steps.splice(ri < 0 ? d.house.steps.length : ri, 0, { title: wingName,
      text: `${wingName} ${B.wings.length > 1 ? 'are' : 'is'} closed off from the main block by inner walls with doors, and ${B.wings.length > 1 ? 'get' : 'gets'} windows round ${B.wings.length > 1 ? 'their' : 'its'} outer walls on every storey.`, ops: wingOps });
    // roofs: one over every block, the ridge along its longer side
    const roofStep = d.house.steps.find((st) => st.title === 'Roof');
    if (roofStep) {
      const base = roofStep.ops.find((o) => o.op === 'roof');
      for (const w of B.wings) {
        const along = w.w >= w.h;
        const ro = along ? { x: w.x - 10, y: w.y - 10, w: w.w + 20, h: w.h + 20, r: 0 } : { x: w.x + w.w / 2 - (w.h + 20) / 2, y: w.y + w.h / 2 - (w.w + 20) / 2, w: w.h + 20, h: w.w + 20, r: 90 };
        roofStep.ops.push({ ...base, ...ro });
      }
      roofStep.text = roofStep.text.replace('covers the house', `covers every block of the house (${rects.length} roofs, trimmed where they meet)`);
    }
    // floors (and furniture) in the wings
    d.levels.forEach((L, i) => {
      const st = d.house.steps.find((x) => x.ops.some((o) => o.op === 'level' && o.id === L.id) && x.ops.some((o) => o.op === 'floor'));
      if (!st) return;
      const fl = st.ops.find((o) => o.op === 'floor');
      for (const r of wingRooms[i]) fl.at.push([r10(r.cx), r10(r.cy), r.kind === 'bed' ? a.flBed : a.flLiving]);
      if (a.furniture) { const pl = st.ops.find((o) => o.op === 'place'); if (pl) pl.list.push(...wingRooms[i].flatMap((r) => furnish(r, D, i, a))); }
    });
    d.house.size = `${W / 100} × ${D / 100} m (${(SHAPES.find((x) => x[0] === a.shape) || ['', ''])[1]}) · ${n} storey${n === 1 ? '' : 's'}`;
    if (a.style === 'japanese') d.house.size += ` · ${d.LV.flatMap((l) => l.rooms).filter((r) => ['bed', 'washitsu', 'study', 'family'].includes(r.kind)).length}LDK`;
    return { ...d, W, D, outline, joints, blocks: rects, rooms: d.LV.flatMap((l) => l.rooms) };
  }
  /* ───────────────────────── the site: a hillside, the house raised, a basement ─────────────────────────
     a.site: 'flat' or a hillside rising to the back / left / right — a Slope item under the house whose ground rises
     by a.rise (m) across the house, from 0 at its low side; a.raise (m): the ground floor above the ground at the
     front (the whole house lifted: FP's "above ground"); a.basement: a storey under the whole outline (concrete
     walls, basement windows on the low side, stairs down). The app is told what holds a raised house up (the
     basement, else a concrete plinth), so the 3D view does not have to ask. */
  const SITES = [['flat', 'Flat ground'], ['hill-back', 'Hillside — rising to the back'], ['hill-left', 'Hillside — rising to the left'], ['hill-right', 'Hillside — rising to the right']];
  function designSite(a) {
    const d = designShaped(a), site = a.site || 'flat', raise = Math.round(clamp(+a.raise || 0, 0, 2) * 100), base = !!a.basement;
    if (site === 'flat' && !raise && !base) return d;
    const H = d.H, W = d.W, D = d.D, steps = d.house.steps, lv = d.house.levels, all = () => steps.flatMap((st) => st.ops);
    const loop = (all().find((o) => o.op === 'loop') || {}).pts || [[0, 0], [W, 0], [W, D], [0, D]];
    const slabAt = (all().find((o) => o.op === 'slab') || {}).at || [W / 4, D / 4];
    // the house lifted: the ground floor (FP's "above ground") and every storey above it
    if (raise) lv.forEach((L) => { if (L.id !== 'L0') L.elev += raise; });
    d.house.aboveGround = raise;
    d.house.support = base ? 'basement' : raise ? 'plinth' : undefined;
    steps[0].ops.unshift({ op: 'level', id: 'L0' });
    const pre = [];
    // the hillside: a slope from 0 at the house's low side, rising a.rise across the house (and on beyond it)
    if (site !== 'flat') {
      const rise = Math.round(clamp(+a.rise || 1, 0.25, 4) * 100), M = 800, S = 600;
      let sl;
      if (site === 'hill-back') sl = ['slope', W / 2, (D - M) / 2, 0, { w: W + 2 * S, h: D + M, slopeH: Math.round((rise * (D + M)) / D) }];
      else if (site === 'hill-right') sl = ['slope', (W + M) / 2, D / 2, 90, { w: D + 2 * S, h: W + M, slopeH: Math.round((rise * (W + M)) / W) }];
      else sl = ['slope', (W - M) / 2, D / 2, 270, { w: D + 2 * S, h: W + M, slopeH: Math.round((rise * (W + M)) / W) }];
      Object.assign(sl[4], { blend: 300, label: 'Hillside' });
      pre.push({ title: 'The hillside', text: `The plot slopes: the ground rises ${(rise / 100).toFixed(2)} m across the house, ${site === 'hill-back' ? 'from the front to the back' : site === 'hill-left' ? 'from the right side to the left' : 'from the left side to the right'}, and on beyond it.`,
        ops: [{ op: 'level', id: 'L0' }, { op: 'add', list: [sl] }] });
    }
    // the basement: the same outline, one storey down, its walls up to the ground floor
    let stair = null;
    if (base) {
      d.house.levels = [{ id: 'B1', name: 'Basement', elev: raise - H, wallH: H - (d.house.slabT || 30) }, ...lv]; // its walls stop under the ground floor slab // (d.levels stays the storeys above ground: the previews follow it)
      const side = { 'hill-back': (s) => s[1] === s[3] && s[1] === Math.max(...loop.map((q) => q[1])), 'hill-left': (s) => s[0] === s[2] && s[0] === Math.max(...loop.map((q) => q[0])),
        'hill-right': (s) => s[0] === s[2] && s[0] === Math.min(...loop.map((q) => q[0])) }[site] || (() => true);
      const wins = [];
      loop.forEach((p, i) => {
        const q = loop[(i + 1) % loop.length], sg = [...p, ...q], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 180 || !side(sg)) return;
        const k = Math.max(1, Math.floor(L / 350));
        for (let j = 0; j < k; j++) { const t = (j + 0.5) / k; wins.push(['window-basement', r10(p[0] + (q[0] - p[0]) * t), r10(p[1] + (q[1] - p[1]) * t), p[1] === q[1] ? 0 : 90]); }
      });
      pre.push({ title: 'Basement', text: `A basement under the whole house, ${(H / 100).toFixed(2)} m floor to floor: concrete walls on the house's outline, a concrete slab and floor${wins.length ? `, and ${wins.length} basement windows${site !== 'flat' ? ' on the low side, where the ground is lowest' : ''}` : ''}.`,
        ops: [{ op: 'level', id: 'B1' }, { op: 'loop', t: 20, pts: loop }, { op: 'paint', side: 'out', wmat: WM.MATS.concrete ? 'concrete' : 'plaster' }, { op: 'paint', side: 'in', wmat: 'plaster', wcol: a.inColor },
          { op: 'slab', at: slabAt, kind: 'concrete' }, { op: 'floor', at: [[slabAt[0], slabAt[1], MATS.concrete ? 'concrete' : 'tile']] }, ...(wins.length ? [{ op: 'place', list: wins }] : [])] });
      // the stairs down: under the stairs of the house (stacked), or — one storey — in a back corner of the living room
      if (d.stairs) stair = d.stairs;
      else {
        const lr = d.LV[0].rooms.find((r) => r.kind === 'living' || r.kind === 'living-kitchen') || d.LV[0].rooms[0];
        stair = [r10(lr.x + 115), r10(lr.y + 175)];
        const box = { x: stair[0] - 125, y: stair[1] - 190, w: 250, h: 380 };
        for (const st of steps) for (const o of st.ops) if (o.op === 'place') o.list = o.list.filter(([t, x, y]) => (FP.byId[t] && FP.byId[t].opening) || !inRect(box, x, y, 0));
      }
      // the ground floor slab lies on the basement walls, out to the house's outline
      for (const st of steps) for (const o of st.ops) if (o.op === 'slab' && st.title === 'Ground slab') { o.outer = true; st.text = 'A concrete slab is poured over the basement, out to the outer faces of its walls; the ground floor walls stand on it.'; }
      const si = steps.findIndex((st) => st.title === 'Ground slab');
      steps.splice(si < 0 ? 1 : si + 1, 0, { title: 'Stairs to the basement', text: 'U-shaped stairs go down to the basement, through an opening in the ground floor slab with a railing round it.',
        ops: [{ op: 'level', id: 'B1' }, { op: 'add', list: [['stairs-u', stair[0], stair[1]]] }, { op: 'level', id: 'L0' }, { op: 'add', list: [['slab-opening', stair[0], stair[1], 0, { matchStairs: true, rail: '3' }]] }] });
    }
    steps.unshift(...pre);
    // the front steps up to a raised front door (they stop at a landing in front of it), the garden moved out past them
    if (raise >= 15) {
      const door = d.LV[0].doors.filter(([t]) => t === 'door').sort((p, q) => q[2] - p[2])[0];
      if (door && Math.abs(door[2] - D) < 2) {
        const len = Math.ceil(raise / 17.5) * 28 + 100, cy = D + 12 + len / 2;
        const gi = steps.findIndex((st) => st.title === 'Garden'), at = gi < 0 ? steps.length : gi;
        steps.splice(at, 0, { title: 'Front steps', text: `Steps up to the front door, ${(raise / 100).toFixed(2)} m above the ground, with a landing in front of it.`,
          ops: [{ op: 'level', id: 'L0' }, { op: 'add', list: [['stairs-h', door[1], r10(cy), 270, { z: 0, topZ: raise, topLanding: true, landingD: 120 }]] }] });
        const g = steps.find((st) => st.title === 'Garden');
        if (g) for (const o of g.ops) if (o.op === 'place') o.list = o.list.map(([t, x, y, ...r]) => [t, x, y > D ? r10(y + len) : y, ...r]);
      }
    }
    d.raise = raise; d.basement = base; d.site = site;
    d.house.size += `${raise ? ` · raised ${(raise / 100).toFixed(2)} m` : ''}${base ? ' · basement' : ''}${site !== 'flat' ? ' · on a hillside' : ''}`;
    return d;
  }
  // a small cross-section of a site, for the Site step
  function sitePic(site) {
    const up = site === 'flat' ? 0 : 14, gy = 52;
    const ground = site === 'flat' ? `M0 ${gy}H120` : site === 'hill-left' ? `M0 ${gy - up - 8}L120 ${gy + 4}` : site === 'hill-right' ? `M0 ${gy + 4}L120 ${gy - up - 8}` : `M0 ${gy + 4}L120 ${gy - up - 8}`;
    const label = site === 'hill-back' ? '<text x="60" y="12" font-size="8" text-anchor="middle" fill="currentColor">seen from the side · front ←</text>' : '<text x="60" y="12" font-size="8" text-anchor="middle" fill="currentColor">seen from the front</text>';
    return `<svg viewBox="0 0 120 70" aria-hidden="true">${label}<path d="${ground}V70H0Z" fill="#7fb069"/><rect x="40" y="${gy - 30}" width="40" height="26" fill="#d9d3c7" stroke="#0004"/><path d="M36 ${gy - 30}L60 ${gy - 42}L84 ${gy - 30}Z" fill="#a5452f"/></svg>`;
  }
  const basePic = (on) => `<svg viewBox="0 0 120 70" aria-hidden="true"><path d="M0 46H120V70H0Z" fill="#7fb069"/><rect x="40" y="${on ? 20 : 20}" width="40" height="26" fill="#d9d3c7" stroke="#0004"/><path d="M36 20L60 8L84 20Z" fill="#a5452f"/>` +
    (on ? '<rect x="40" y="46" width="40" height="20" fill="#b8b2a6" stroke="#5f5a52" stroke-dasharray="3 2"/><rect x="46" y="48" width="8" height="4" fill="#a9d8f2"/><rect x="66" y="48" width="8" height="4" fill="#a9d8f2"/>' : '') + '</svg>';

  // a small picture of a shape (the blocks in the box), for the Size step
  function shapePic(shape) {
    const n = clamp(+A.floors || 1, 1, 3), W = r10(clamp(+A.w, 6, 20) * 100), D = r10(clamp(+A.d, 6, 15) * 100);
    const B = shape === 'rect' ? { main: { x: 0, y: 0, w: W, h: D }, wings: [] } : blocksOf(shape, W, D, n);
    const k = Math.min(100 / W, 56 / D), ox = (120 - W * k) / 2, oy = (66 - D * k) / 2;
    if (!B) return `<svg viewBox="0 0 120 70" aria-hidden="true"><rect x="${ox}" y="${oy}" width="${W * k}" height="${D * k}" fill="none" stroke="currentColor" stroke-dasharray="3 3" opacity=".5"/><text x="60" y="38" font-size="9" text-anchor="middle" fill="currentColor">too small</text></svg>`;
    const pts = unionOutline([B.main, ...B.wings]).map(([x, y]) => `${ox + x * k},${oy + y * k}`).join(' ');
    return `<svg viewBox="0 0 120 70" aria-hidden="true"><rect x="${ox}" y="${oy}" width="${W * k}" height="${D * k}" fill="none" stroke="currentColor" stroke-dasharray="2 3" opacity=".35"/>` +
      `<polygon points="${pts}" fill="currentColor" fill-opacity=".18" stroke="currentColor" stroke-width="2"/>` +
      `<line x1="${ox + W * k * 0.3}" y1="68" x2="${ox + W * k * 0.7}" y2="68" stroke="#16a34a" stroke-width="2"/></svg>`;
  }

  // the furniture of one room (centred, against an outer wall where it can be)
  /* The Japanese style: the living room becomes the LDK, one room (a study, else the last bedroom that is not the
     main one) a washitsu — a tatami room behind fusuma — and the entrance hall gets its genkan inside the front door.
     Changes LV in place (names, kinds, the washitsu's door, the genkan added like from the picker). */
  function japanese(a, LV, D, frontDoorX) {
    const all = LV.flatMap((l) => l.rooms);
    for (const r of all) {
      if (r.kind === 'living') r.name = 'LDK — living & dining';
      if (r.kind === 'living-kitchen') r.name = 'LDK — living, dining & kitchen';
      if (r.kind === 'hall' && r.lvl === 0) r.name = r.name === 'Entrance hall' ? 'Genkan & hall' : 'Genkan, hall & stairs';
    }
    const pick = all.find((r) => r.kind === 'study') || [...all].reverse().find((r) => r.kind === 'bed' && !/Main/.test(r.name));
    if (pick) {
      pick.kind = 'washitsu'; pick.name = 'Washitsu (tatami room)';
      // its door: the one on its outline becomes fusuma (sliding, so it fits where the hinged door was)
      const on = ([, x, y]) => (Math.abs(x - pick.x) < 2 || Math.abs(x - pick.x - pick.w) < 2) && y > pick.y - 1 && y < pick.y + pick.h + 1
        || (Math.abs(y - pick.y) < 2 || Math.abs(y - pick.y - pick.h) < 2) && x > pick.x - 1 && x < pick.x + pick.w + 1;
      const d = LV[pick.lvl].doors.find((x) => x[0] === 'door' && on(x) && !(Math.abs(x[2] - D) < 2 && Math.abs(x[1] - frontDoorX) < 2));
      if (d) { d[0] = 'door-fusuma'; d[3] = d[3] === 180 ? 0 : d[3]; d[4] = { w: 100 }; }
    }
    // the genkan: its stone floor centred on the front door, the shoe cabinet beside it, the step up at its back
    LV[0].extra = [['genkan', r10(frontDoorX + 20), r10(D - 75), 0]];
    void a;
  }
  function furnish(r, D, lvl, a) {
    const { x, y, w, h, cx, cy } = r, back = y < 1, front = y + h > D - 1, out = [];
    const bedY = (len) => (back ? [y + 15 + len / 2, 0] : [y + h - 15 - len / 2, 180]);
    if (r.kind === 'living' || r.kind === 'living-kitchen') {
      out.push(['sofa', x + 60, r10(cy + (r.kind === 'living-kitchen' ? 20 : 0)), 90]);
      out.push([w >= 520 ? 'table-rect6' : 'table-sq4', r10(x + w * (r.kind === 'living-kitchen' ? 0.45 : 0.62)), r10(back ? y + Math.min(h * 0.35, 200) : cy), 0]);
      out.push(['plant', x + 40, y + 40, 0]);
      if (r.kind === 'living-kitchen') out.push(['sink', r10(x + w - 250), y + 52, 0], ['stove', r10(x + w - 150), y + 52, 0], ['fridge', x + w - 55, y + 57, 0]);
    } else if (r.kind === 'kitchen') {
      out.push(['sink', r10(cx), y + 52, 0], ['stove', r10(cx - 100), y + 52, 0]);
      if (w >= 300) out.push(['fridge', x + w - 55, y + 57, 0]);
      if (h >= 380) out.push(['table-sq2', r10(cx), r10(cy + 60), 90]);
    } else if (r.kind === 'bed') {
      const dbl = /Main/.test(r.name), [by, rot] = bedY(200);
      out.push([dbl ? 'bed-double' : 'bed-single', r10(cx), r10(by), rot]);
      out.push(['plant', x + w - 40, back ? y + 40 : y + h - 40, 0]);
    } else if (r.kind === 'bath') {
      out.push(['shower', x + w - 60, front ? y + h - 60 : y + 60, 0]);
      out.push(['toilet', x + w - 38, r10(front ? y + h - 190 : y + 190), 90]);
      if (h >= 400) out.push(['washbasin', x + w - 35, r10(front ? y + h - 300 : y + 300), 90]);
    } else if (r.kind === 'washitsu') {
      out.push(['zataku', r10(cx), r10(cy), 0]);
    } else if (r.kind === 'study') {
      out.push(['desk', r10(cx), back ? y + 50 : y + h - 50, back ? 0 : 180], ['bookshelf', x + 30, r10(cy), 90]);
    }
    void lvl; void a;
    return out.filter((p) => FP.byId[p[0]]);
  }

  /* ───────────────────────── the questions ───────────────────────── */
  const roofStyles = () => Object.values(FP.byId).filter((ic) => ic.cat === 'Roofs' && ic.roof && !ic.hidden && ic.roof !== 'hip-l' && !ic.roofFence)
    .map((ic) => [ic.roof, ic.name]);
  const swatches = (key, list) => `<div class="wz-swatches">${list.map((c) => `<button type="button" data-set="${key}" data-v="${c}" class="${String(A[key]).toLowerCase() === c ? 'on' : ''}" style="background:${c}" title="${c}" aria-label="Colour ${c}"></button>`).join('')}
    <label class="wz-color" title="Any colour"><input type="color" data-a="${key}" value="${A[key] || '#ffffff'}"/> Other…</label></div>`;
  const choice = (key, opts) => `<div class="wz-choices">${opts.map(([v, label, sub]) => `<button type="button" data-set="${key}" data-v="${esc(String(v))}" class="${String(A[key]) === String(v) ? 'on' : ''}"><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`).join('')}</div>`;
  const slider = (key, label, min, max, step, unit) => `<label class="wz-slider"><span>${label}</span>
    <input type="range" data-a="${key}" min="${min}" max="${max}" step="${step}" value="${A[key]}"/>
    <input type="number" data-a="${key}" min="${min}" max="${max}" step="${step}" value="${A[key]}"/><em>${unit}</em></label>`;
  const check = (key, label, sub) => `<label class="wz-check"><input type="checkbox" data-a="${key}" ${A[key] ? 'checked' : ''}/><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span></label>`;
  const matBtns = (key, entries, swatchOf) => `<div class="wz-mats">${entries.map(([id, m]) => `<button type="button" data-set="${key}" data-v="${id}" class="${A[key] === id ? 'on' : ''}" title="${esc(m.name)}">
    <img src="${swatchOf(id)}" alt=""/><span>${esc(m.name)}</span></button>`).join('')}</div>`;
  const matName = (tbl, id) => (tbl[id] ? tbl[id].name : id);

  const STEPS = [
    { id: 'start', title: 'Your house', sum: () => `${A.name}${A.style === 'japanese' ? ' · Japanese' : ''}`,
      body: () => `<p class="wz-lead">Answer a few questions and the house is designed and built for you, step by step. Every answer can be changed later — click any step on the left.</p>
        <label class="wz-field"><span>Name</span><input type="text" data-a="name" value="${esc(A.name)}" maxlength="60"/></label>
        <h4>Style</h4>${choice('style', [['western', 'Western', 'the usual rooms, roofs and furniture'], ['japanese', 'Japanese', 'LDK, a tatami room, a genkan, an irimoya roof in kawara tiles, low furniture']])}
        <h4>Surroundings</h4>${choice('ground', [['grass', 'Lawn'], ['trees', 'Lawn with trees'], ['street', 'Street'], ['street-trees', 'Street with trees'], ['paving', 'Paved'], ['gravel', 'Gravel']])}` },
    { id: 'size', title: 'Size', sum: () => `${A.w} × ${A.d} m${A.shape && A.shape !== 'rect' ? ` · ${(SHAPES.find((x) => x[0] === A.shape) || ['', ''])[1].split(' —')[0]}` : ''}`,
      body: () => `<p class="wz-lead">How big is the house on the ground? (Outside measurements.)</p>
        ${slider('w', 'Width (front)', 6, 20, 0.5, 'm')}${slider('d', 'Depth', 6, 15, 0.5, 'm')}
        <h4>Shape</h4><p class="wz-note" style="margin:0 0 6px">The blocks fill the width × depth above; the front (green line) stays clear for the front door.</p>
        <div class="wz-roofs wz-shapes">${SHAPES.map(([v, name, sub]) => `<button type="button" data-set="shape" data-v="${v}" class="${(A.shape || 'rect') === v ? 'on' : ''}">${shapePic(v)}<span>${esc(name)}</span><small>${esc(sub)}</small></button>`).join('')}</div>
        <h4>Quick sizes</h4>${choice('size', [['8x7', 'Small', '8 × 7 m'], ['12x9', 'Family', '12 × 9 m'], ['15x10', 'Large', '15 × 10 m'], ['18x12', 'Villa', '18 × 12 m']])}` },
    { id: 'site', title: 'Site & basement', sum: () => `${(SITES.find(([v]) => v === (A.site || 'flat')) || SITES[0])[1].replace('Hillside — rising', 'hillside, rising')}${+A.raise ? ` · raised ${(+A.raise).toFixed(2)} m` : ''}${A.basement ? ' · basement' : ''}`,
      body: () => `<p class="wz-lead">Where does the house stand?</p>
        <div class="wz-roofs wz-shapes">${SITES.map(([v, name]) => `<button type="button" data-set="site" data-v="${v}" class="${(A.site || 'flat') === v ? 'on' : ''}">${sitePic(v)}<span>${esc(name)}</span></button>`).join('')}</div>
        ${A.site && A.site !== 'flat' ? slider('rise', 'Ground rises across the house', 0.25, 4, 0.25, 'm') : ''}
        ${slider('raise', 'Ground floor above the ground (front)', 0, 2, 0.05, 'm')}
        <p class="wz-note">${A.site && A.site !== 'flat' ? 'On a hillside the ground rises across the house; with the house raised by the same height, the high side opens straight onto the garden and the low side shows the basement. ' : ''}A raised house gets steps up to the front door; without a basement it stands on a concrete base.</p>
        <h4>Basement</h4>
        <div class="wz-roofs wz-shapes">${[[false, 'No basement'], [true, 'Basement', 'under the whole house, stairs down']].map(([v, name, sub]) => `<button type="button" data-set="basement" data-v="${v}" class="${!!A.basement === v ? 'on' : ''}">${basePic(v)}<span>${esc(name)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`).join('')}</div>` },
    { id: 'floors', title: 'Storeys', sum: () => `${A.floors} storey${A.floors > 1 ? 's' : ''} · ${(+A.storeyH).toFixed(2)} m`,
      body: () => `<p class="wz-lead">How many storeys, and how high is each one (floor to floor)?</p>
        ${choice('floors', [[1, 'One storey', 'a bungalow'], [2, 'Two storeys', 'with U-shaped stairs'], [3, 'Three storeys', 'stairs on every floor']])}
        ${choice('storeyH', [[2.8, '2.80 m', 'compact'], [3, '3.00 m', 'usual'], [3.3, '3.30 m', 'airy']])}
        <p class="wz-note">Two or three storeys need at least 10 × 7 m: a stair hall runs through the middle of the house.</p>` },
    { id: 'rooms', title: 'Rooms', sum: () => `${A.bedrooms} bedroom${A.bedrooms > 1 ? 's' : ''} · ${A.baths} bath${A.baths > 1 ? 's' : ''}${A.floors === 1 ? ` · kitchen ${A.kitchen === 'open' ? 'open-plan' : 'separate'}` : ''}`,
      body: () => `<p class="wz-lead">Which rooms does the house need?</p>
        <h4>Bedrooms</h4>${choice('bedrooms', [1, 2, 3, 4, 5, 6].map((v) => [v, String(v)]))}
        <h4>Bathrooms</h4>${choice('baths', [[1, '1'], [2, '2'], [3, '3']])}
        ${A.floors === 1 ? `<h4>Kitchen</h4>${choice('kitchen', [['separate', 'Separate kitchen'], ['open', 'Open-plan', 'one room with the living room']])}` : '<p class="wz-note">With stairs the kitchen and a shower room are on the ground floor; bedrooms and further bathrooms upstairs.</p>'}` },
    { id: 'walls', title: 'Walls & colours', sum: () => `${matName(WM.MATS, A.wallMat)} · ${A.wallColor}`,
      body: () => `<p class="wz-lead">What do the walls look like?</p>
        <h4>Outside walls</h4>${matBtns('wallMat', Object.entries(WM.MATS), (id) => WM.swatch(id))}
        <h4>Outside colour</h4>${swatches('wallColor', ['#e4dfd6', '#ffffff', '#f2e3c6', '#d9c3a5', '#a4532f', '#7a3b22', '#9aa3ab', '#5f5a52'])}
        <h4>Inside colour</h4>${swatches('inColor', ['#f4f1ec', '#ffffff', '#eef1f4', '#f3ead8', '#e6efe4', '#e9e1ea'])}` },
    { id: 'roof', title: 'Roof', sum: () => `${(roofStyles().find(([s]) => s === A.roof) || ['', A.roof])[1]} · ${matName(WM.ROOF_MATS, A.roofMat)}`,
      body: () => `<p class="wz-lead">Which roof?</p>
        <div class="wz-roofs">${roofStyles().map(([s, name]) => `<button type="button" data-set="roof" data-v="${s}" class="${A.roof === s ? 'on' : ''}"><svg viewBox="0 0 120 60" aria-hidden="true">${roofSketch(s, 10, 50, 100, 30)}<rect x="22" y="50" width="76" height="9" fill="currentColor" opacity=".25"/></svg><span>${esc(name)}</span></button>`).join('')}</div>
        ${A.roof === 'flat' ? '' : `<h4>Pitch</h4>${choice('pitch', [[15, '15°'], [25, '25°'], [30, '30°'], [35, '35°'], [45, '45°']])}`}
        <h4>Covering</h4>${matBtns('roofMat', Object.entries(WM.ROOF_MATS), (id) => WM.roofSwatch(id))}
        <h4>Colour</h4>${swatches('roofColor', ['', '#b5532f', '#7a3b22', '#3f3f46', '#4b5563', '#3f6b4c', '#8a6a4f'].filter(Boolean))}
        <p class="wz-note">${A.roofColor ? `<button type="button" class="wz-link" data-set="roofColor" data-v="">Use the covering's own colour</button>` : 'Now in the covering\'s own colour.'}</p>` },
    { id: 'finish', title: 'Floors', sum: () => `${matName(MATS, A.flLiving)} · ${matName(MATS, A.flBed)} · ${matName(MATS, A.flWet)}`,
      body: () => {
        const indoor = Object.entries(MATS).filter(([id]) => !['grass', 'gravel', 'sand', 'soil', 'mulch', 'water', 'asphalt'].includes(id));
        const pick = (key) => `<div class="wz-mats small">${indoor.map(([id, m]) => `<button type="button" data-set="${key}" data-v="${id}" class="${A[key] === id ? 'on' : ''}" title="${esc(m.name)}"><i style="background:${m.color}"></i><span>${esc(m.name)}</span></button>`).join('')}</div>`;
        return `<p class="wz-lead">Floor finishes, room by room.</p><h4>Living room${A.floors > 1 ? ', landing and study' : ''}</h4>${pick('flLiving')}<h4>Bedrooms</h4>${pick('flBed')}<h4>Kitchen and bathrooms</h4>${pick('flWet')}`;
      } },
    { id: 'extras', title: 'Extras', sum: () => [A.furniture && 'furniture', A.balcony && A.floors > 1 && 'balcony', A.linings && 'linings', A.trees && 'trees', A.pool && 'pool', A.car && 'parking'].filter(Boolean).join(' · ') || 'none',
      body: () => `<p class="wz-lead">What else?</p>
        ${check('furniture', 'Furniture and fittings', 'kitchen, bathroom fittings, beds, sofa, tables')}
        ${A.floors > 1 ? check('balcony', 'Balcony', 'off the main bedroom, with a glass sliding door') : ''}
        ${check('linings', 'Service linings in the bedrooms', '10 cm interior walls for wiring and insulation')}
        ${check('trees', 'Trees and flowers')}${check('pool', 'Swimming pool', 'behind the house')}${check('car', 'Path and parking place', 'a gravel path to the front door and a car')}` },
    { id: 'build', title: 'Build', sum: () => 'review and build',
      body: () => {
        const d = designSite(A);
        return `<p class="wz-lead">Ready. The house is built on the plan step by step — use <b>Next</b> and <b>Previous</b> (or <b>Play</b>) to follow it; <b>Keep this house</b> makes it your plan, and <b>✎ Change answers</b> brings you back here.</p>
          <ul class="wz-summary">${STEPS.slice(0, -1).map((s, k) => `<li><button type="button" data-go="${k}">${esc(s.title)}</button><span>${esc(s.sum())}</span></li>`).join('')}</ul>
          <p class="wz-note">${d.house.steps.length} construction steps · ${d.rooms.filter((r) => r.kind !== 'hall').length} rooms. Your own plan is kept aside until you choose “Keep this house”.</p>`;
      } },
  ];

  /* ───────────────────────── preview: front view and the plan of each storey ───────────────────────── */
  function roofSketch(style, x, y, w, h) {
    // a small front view of a roof over the wall top x..x+w at y (h: its height)
    const L = x, R = x + w, T = y - h, m = x + w / 2;
    const fill = 'fill="currentColor"';
    switch (style) {
      case 'flat': return `<rect x="${L - 2}" y="${y - 5}" width="${w + 4}" height="5" ${fill}/>`;
      case 'shed': return `<path d="M${L - 4} ${y}L${R + 4} ${y - h * 0.6}L${R + 4} ${y - h * 0.6 + 5}L${L - 4} ${y + 5}Z" ${fill}/>`;
      case 'hip': return `<path d="M${L - 4} ${y}L${L + w * 0.25} ${T}L${R - w * 0.25} ${T}L${R + 4} ${y}Z" ${fill}/>`;
      // irimoya from its long side: deep eaves, gently curved, the hipped ends and the ridge between the gables
      case 'irimoya': return `<path d="M${L - 8} ${y + 1}Q${m} ${y - 4} ${R + 8} ${y + 1}L${R - w * 0.16} ${T}L${L + w * 0.16} ${T}Z" ${fill}/><rect x="${L + w * 0.14}" y="${T - 3}" width="${w * 0.72}" height="4" ${fill}/>`;
      case 'mansard': return `<path d="M${L - 3} ${y}L${L + 6} ${y - h * 0.65}L${L + w * 0.3} ${T}L${R - w * 0.3} ${T}L${R - 6} ${y - h * 0.65}L${R + 3} ${y}Z" ${fill}/>`;
      case 'gambrel': return `<path d="M${L - 3} ${y}L${L + 8} ${y - h * 0.6}L${m} ${T}L${R - 8} ${y - h * 0.6}L${R + 3} ${y}Z" ${fill}/>`;
      case 'butterfly': return `<path d="M${L - 4} ${y - h * 0.5}L${m} ${y - 4}L${R + 4} ${y - h * 0.5}L${R + 4} ${y - h * 0.5 + 5}L${m} ${y + 1}L${L - 4} ${y - h * 0.5 + 5}Z" ${fill}/>`;
      case 'saltbox': case 'clerestory': return `<path d="M${L - 4} ${y}L${L + w * 0.62} ${T}L${R + 4} ${y - h * 0.35}L${R + 4} ${y}Z" ${fill}/>`;
      default: return `<path d="M${L - 4} ${y}L${m} ${T}L${R + 4} ${y}Z" ${fill}/>`; // gable, box gable: the gable end
    }
  }
  function preview() {
    const d = designSite(A), { W, D, H, n, LV } = d;
    // front view (the street side), 1 px = S cm
    const S = 300 / Math.max(W, 900), wallH = n * H, rise = A.roof === 'flat' ? 30 : Math.tan((A.pitch * Math.PI) / 180) * Math.min(W, D) / 2;
    // raised and with a basement: the house stands raise above the ground at the front, the basement under it; on a
    // hillside rising to the left or right the ground line slopes across the picture (rising to the back: it does not show)
    const up = (d.raise || 0) * S, bd = d.basement ? H * S : 0, hillUp = d.site === 'hill-left' || d.site === 'hill-right' ? (+A.rise || 1) * 100 * S : 0;
    const vw = 340, vh = 40 + (wallH + rise) * S + Math.max(up, bd) + 20, gx = (vw - W * S) / 2, gy = vh - 18 - Math.max(up, bd), base = gy + up;
    const gAt = (x) => (!hillUp ? 0 : d.site === 'hill-left' ? hillUp * (gx + W * S - x) / (W * S) : hillUp * (x - gx) / (W * S));
    const gpts = [0, gx, gx + W * S, vw].map((x) => `${x},${base - gAt(x)}`).join(' ');
    let front = `<rect x="${gx}" y="${gy}" width="${W * S}" height="${bd || up}" fill="#b8b2a6" stroke="#00000030"/>`;
    front += `<polygon points="${gpts} ${vw},${vh} 0,${vh}" fill="${A.ground === 'paving' || A.ground === 'gravel' ? '#cfc8bb' : '#7fb069'}"/>`;
    if (bd) front += `<rect x="${gx}" y="${gy}" width="${W * S}" height="${bd}" fill="none" stroke="#5f5a52" stroke-dasharray="4 3"/><text x="${gx + W * S / 2}" y="${gy + bd - 8}" font-size="10" text-anchor="middle" fill="#3d3a35">basement</text>`;
    front += `<rect x="${gx}" y="${gy - wallH * S}" width="${W * S}" height="${wallH * S}" fill="${A.wallColor}" stroke="#00000030"/>`;
    // the roof seen from the front: its long side when the ridge runs along the width, else its gable end
    const along = W >= D, style = A.roof;
    const sideOn = along && !['flat', 'butterfly', 'shed'].includes(style) && style !== 'gable' && style !== 'box-gable' ? style : along && (style === 'gable' || style === 'box-gable') ? 'band' : style;
    front += `<g style="color:${A.roofColor || (WM.ROOF_MATS[A.roofMat] || { color: '#a5452f' }).color}">${sideOn === 'band'
      ? `<rect x="${gx - 6}" y="${gy - wallH * S - rise * S}" width="${W * S + 12}" height="${rise * S + 3}" fill="currentColor"/>`
      : roofSketch(sideOn, gx, gy - wallH * S, W * S, rise * S)}</g>`;
    for (let i = 0; i < n; i++) {
      const fy = gy - i * H * S;
      for (const wd of LV[i].windows.concat(LV[i].doors)) {
        if (Math.abs(wd[2] - D) > 1 || wd[3] === 90) continue; // on the front wall only
        const door = /door/.test(wd[0]), ww = (wd[4] && wd[4].w) || (door ? 90 : 100), x = gx + (wd[1] - ww / 2) * S;
        front += door ? `<rect x="${x}" y="${fy - 210 * S}" width="${ww * S}" height="${210 * S}" fill="#7a5a3c"/>`
          : `<rect x="${x}" y="${fy - 210 * S}" width="${ww * S}" height="${120 * S}" fill="#a9d8f2" stroke="#ffffff" stroke-width="1.5"/>`;
      }
      if (!i && up >= 15 * S) for (const dr of LV[0].doors.filter((x) => x[0] === 'door' && Math.abs(x[2] - D) < 2)) {
        const n2 = Math.max(1, Math.round(d.raise / 17.5)), sx = gx + dr[1] * S, sw = 110 * S;
        for (let k = 0; k < n2; k++) front += `<rect x="${sx - sw / 2 - k * 3}" y="${gy + (k * up) / n2}" width="${sw + k * 6}" height="${up / n2}" fill="#9a958c" stroke="#00000025"/>`;
      }
      if (i) front += `<line x1="${gx}" y1="${fy}" x2="${gx + W * S}" y2="${fy}" stroke="#00000022"/>`;
    }
    const svgFront = `<svg class="wz-front" viewBox="0 0 ${vw} ${vh}" role="img" aria-label="Front view">${front}</svg>`;
    // the plans
    const P = 150 / Math.max(W, D);
    const plans = LV.map((l, i) => {
      const rects = l.rooms.map((r) => `<rect x="${r.x * P}" y="${r.y * P}" width="${r.w * P}" height="${r.h * P}" class="wz-room ${r.kind}"/>` +
        (r.w * P > 34 ? `<text x="${r.cx * P}" y="${r.cy * P}" class="wz-rname">${esc(r.kind === 'hall' ? (i ? 'Landing' : 'Hall') : r.name.replace(/^Main bedroom$/, 'Bedroom 1').replace('Living room & kitchen', 'Living+kitchen'))}</text>` : '')).join('');
      const st = d.stairs && i < n - 1 ? `<rect x="${(d.stairs[0] - 95) * P}" y="${(d.stairs[1] - 170) * P}" width="${190 * P}" height="${340 * P}" class="wz-stairs"/>` : '';
      const ol = d.outline ? `<polygon points="${d.outline.map(([x, y]) => `${x * P},${y * P}`).join(' ')}" class="wz-outline"/>` : `<rect x="0" y="0" width="${W * P}" height="${D * P}" class="wz-outline"/>`;
      return `<figure><svg viewBox="-4 -4 ${W * P + 8} ${D * P + 8}" width="${W * P + 8}" height="${D * P + 8}">${ol}${rects}${st}</svg><figcaption>${esc(d.levels[i].name)}</figcaption></figure>`;
    }).join('');
    $('#wzPreview').innerHTML = `${svgFront}<div class="wz-plans">${plans}</div>${d.notes.length ? `<ul class="wz-notes">${d.notes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}`;
  }

  /* ───────────────────────── the dialog ───────────────────────── */
  let cur = 0;
  function mount() {
    if ($('#wizard')) return;
    const el = document.createElement('div');
    el.id = 'wizard'; el.className = 'modal'; el.hidden = true;
    el.innerHTML = `<div class="modal-box wz-box" role="dialog" aria-labelledby="wzTitle">
      <div class="wz-head"><h2 id="wzTitle">House Building Wizard</h2><button type="button" class="wz-x" data-wz="close" aria-label="Close" title="Close (Esc)">×</button></div>
      <div class="wz-main">
        <nav class="wz-nav" id="wzNav" aria-label="Steps"></nav>
        <section class="wz-body"><h3 id="wzStepTitle"></h3><div id="wzStep"></div></section>
        <aside class="wz-preview" id="wzPreview" aria-label="Preview"></aside>
      </div>
      <div class="wz-foot"><button type="button" data-wz="back">◀ Back</button><span class="wz-count" id="wzCount"></span>
        <button type="button" data-wz="build" class="wz-build-now" title="Build the house with the answers so far">Build now</button>
        <button type="button" data-wz="next" class="primary">Next ▶</button></div>
    </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onInput);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  }
  function render() {
    $('#wzNav').innerHTML = STEPS.map((s, k) => `<button type="button" data-go="${k}" class="${k === cur ? 'on' : ''}" ${k === cur ? 'aria-current="step"' : ''}>
      <i>${k + 1}</i><span><b>${esc(s.title)}</b><small>${esc(s.sum())}</small></span></button>`).join('');
    $('#wzStepTitle').textContent = `${cur + 1}. ${STEPS[cur].title}`;
    $('#wzStep').innerHTML = STEPS[cur].body();
    $('#wzCount').textContent = `Step ${cur + 1} of ${STEPS.length}`;
    const last = cur === STEPS.length - 1;
    $('#wizard [data-wz="back"]').disabled = cur === 0;
    $('#wizard [data-wz="next"]').textContent = last ? '🏠 Build the house' : 'Next ▶';
    $('#wizard [data-wz="build"]').hidden = last;
    preview();
  }
  // a changed answer: the summaries on the left and the preview follow (the step itself only when it changes shape)
  function changed(redrawStep) {
    remember();
    if (redrawStep) { const sc = $('#wzStep').scrollTop; $('#wzStep').innerHTML = STEPS[cur].body(); $('#wzStep').scrollTop = sc; }
    $('#wzNav').querySelectorAll('[data-go]').forEach((b) => { const s = STEPS[+b.dataset.go]; b.querySelector('small').textContent = s.sum(); });
    preview();
  }
  function setAnswer(key, v) {
    if (key === 'size') { const [w, d] = v.split('x').map(Number); A.w = w; A.d = d; return changed(true); }
    const num = ['w', 'd', 'floors', 'storeyH', 'bedrooms', 'baths', 'pitch', 'rise', 'raise'];
    // a hillside, picked from flat ground: the house raised 1 m (the ground rising 1 m across it) with a basement
    if (key === 'site' && v !== 'flat' && (A.site || 'flat') === 'flat') { A.raise = 1; A.rise = 1; A.basement = true; }
    A[key] = num.includes(key) ? +v : key === 'basement' ? v === 'true' || v === true : v;
    if (key === 'floors' && A.floors > 1) { A.w = Math.max(A.w, 10); A.d = Math.max(A.d, 7); }
    if (key === 'roofMat') A.roofColor = '';
    if (key === 'style') applyStyleDefaults(v);
    changed(true);
  }
  /* Switching the style brings the roof along (an irimoya roof in kawara tiles at 25° for Japanese; a gable roof in clay
     tiles at 30° back to Western) — only where the answers are still the other style's own defaults. */
  function applyStyleDefaults(v) {
    if (v === 'japanese' && A.roofMat === 'clay-tiles' && A.roof === 'gable' && +A.pitch === 30) Object.assign(A, { roof: 'irimoya', roofMat: 'kawara', pitch: 25, roofColor: '' });
    if (v !== 'japanese' && A.roofMat === 'kawara' && A.roof === 'irimoya' && +A.pitch === 25) Object.assign(A, { roof: 'gable', roofMat: 'clay-tiles', pitch: 30, roofColor: '' });
  }
  function onClick(e) {
    const go = e.target.closest('[data-go]');
    if (go) { cur = +go.dataset.go; return render(); }
    const set = e.target.closest('[data-set]');
    if (set) return setAnswer(set.dataset.set, set.dataset.v);
    const b = e.target.closest('[data-wz]');
    if (!b) { if (e.target.id === 'wizard') close(); return; }
    const a = b.dataset.wz;
    if (a === 'close') close();
    if (a === 'back' && cur > 0) { cur--; render(); }
    if (a === 'next') { if (cur < STEPS.length - 1) { cur++; render(); } else build(); }
    if (a === 'build') build();
  }
  function onInput(e) {
    const t = e.target, key = t.dataset && t.dataset.a;
    if (!key) return;
    if (t.type === 'checkbox') { A[key] = t.checked; return changed(false); }
    if (t.type === 'range' || t.type === 'number') {
      const v = parseFloat(t.value);
      if (!isFinite(v)) return;
      A[key] = clamp(v, +t.min, +t.max);
      // the slider and the number field show the same
      $('#wzStep').querySelectorAll(`[data-a="${key}"]`).forEach((o) => { if (o !== t) o.value = A[key]; });
      // the shape pictures follow the width and depth
      if ((key === 'w' || key === 'd') && $('#wzStep .wz-shapes')) $('#wzStep .wz-shapes').querySelectorAll('[data-v]').forEach((b) => { b.querySelector('svg').outerHTML = shapePic(b.dataset.v); });
      return changed(false);
    }
    A[key] = t.value;
    changed(t.type === 'color' && e.type === 'change');
  }
  function open(at = 0) {
    mount();
    cur = at;
    $('#wizard').hidden = false;
    render();
    const f = $('#wizard [data-wz="next"]'); if (f) f.focus();
  }
  function close() { const w = $('#wizard'); if (w) w.hidden = true; }
  function build() {
    const d = designSite(A);
    close();
    FP.demoBuild(d.house, () => open(STEPS.length - 1));
  }

  /* ── answers from outside (Photo → House, js/photoai.js) ──
     options() lists every allowed value, so a caller (or an AI) can only pick from what the Wizard understands;
     setAnswers() takes any subset, keeps only valid values (numbers clamped to the slider ranges) and returns
     the keys it changed. Unknown keys and invalid values are ignored, never stored. */
  const indoorFloors = () => Object.keys(MATS).filter((id) => !['grass', 'gravel', 'sand', 'soil', 'mulch', 'water', 'asphalt'].includes(id));
  function options() {
    return {
      ground: ['grass', 'trees', 'street', 'street-trees', 'paving', 'gravel'], style: ['western', 'japanese'],
      w: { min: 6, max: 20, step: 0.5 }, d: { min: 6, max: 15, step: 0.5 }, shape: SHAPES.map(([v]) => v),
      site: SITES.map(([v]) => v), rise: { min: 0.25, max: 4, step: 0.25 }, raise: { min: 0, max: 2, step: 0.05 }, basement: 'bool',
      floors: [1, 2, 3], storeyH: { min: 2.6, max: 3.6, step: 0.05 },
      bedrooms: [1, 2, 3, 4, 5, 6], baths: [1, 2, 3], kitchen: ['separate', 'open'],
      wallMat: Object.keys(WM.MATS), roof: roofStyles().map(([s]) => s), pitch: [15, 25, 30, 35, 45],
      roofMat: Object.keys(WM.ROOF_MATS),
      flLiving: indoorFloors(), flBed: indoorFloors(), flWet: indoorFloors(),
      wallColor: 'colour', inColor: 'colour', roofColor: 'colour',
      name: 'text', balcony: 'bool', linings: 'bool', furniture: 'bool', trees: 'bool', pool: 'bool', car: 'bool',
    };
  }
  function setAnswers(src) {
    const opt = options(), done = [];
    for (const [k, v] of Object.entries(src || {})) {
      const o = opt[k];
      if (o === undefined || v === null || v === undefined || v === '') continue;
      let val;
      if (Array.isArray(o)) {
        const hit = o.find((x) => String(x).toLowerCase() === String(v).toLowerCase());
        if (hit === undefined) continue;
        val = hit;
      } else if (o === 'colour') {
        if (!/^#[0-9a-f]{6}$/i.test(String(v))) continue;
        val = String(v).toLowerCase();
      } else if (o === 'text') {
        val = String(v).trim().slice(0, 60);
        if (!val) continue;
      } else if (o === 'bool') {
        if (typeof v !== 'boolean') continue;
        val = v;
      } else {
        const n = parseFloat(v);
        if (!isFinite(n)) continue;
        val = Math.round(clamp(n, o.min, o.max) / o.step) * o.step;
        val = Math.round(val * 100) / 100;
      }
      A[k] = val;
      done.push(k);
    }
    // a style chosen without a roof: the roof follows it (as in the Wizard)
    if (done.includes('style') && !src.roof && !src.roofMat) applyStyleDefaults(A.style);
    // the same rule as choosing two storeys in the Wizard: a stair hall needs at least 10 × 7 m
    if (A.floors > 1) { A.w = Math.max(A.w, 10); A.d = Math.max(A.d, 7); }
    remember();
    if ($('#wizard') && !$('#wizard').hidden) render();
    return done;
  }

  const btn = $('#btnWizard');
  if (btn) btn.addEventListener('click', () => open(0));
  window.FP_WIZARD = { styleDefault: (v) => { A.style = v === 'japanese' ? 'japanese' : 'western'; applyStyleDefaults(A.style); remember(); }, open, design: () => designSite(A), answers: () => ({ ...A }), setAnswers, options, defaults: { ...DEFAULTS },
    lastStep: STEPS.length - 1 };
})();
