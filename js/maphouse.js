/*
 * Map → House (top bar → Map)
 * Type an address (or "lat, lon"): OpenStreetMap's Nominatim finds the place, the Overpass API returns the building
 * outlines mapped around it, and the user picks the building. Its outline becomes the outer walls at their real size
 * — squared up (straight walls, right angles) and, if wished, turned to line up with the plan — with a floor slab and
 * floor on every storey, the storeys and roof shape that OpenStreetMap records (or the user's choice), and a roof where
 * the outline is a rectangle or an L. It is built the way the Wizard builds a house (FP.demoBuild, step by step);
 * "Keep this house" makes it the plan. Inner walls, doors and windows are not in the map data: the user draws them.
 *
 * Only the typed address and the location's coordinates are sent (to openstreetmap.org and the Overpass API), from
 * this browser. Map data © OpenStreetMap contributors, under the Open Database Licence (ODbL): the dialog and the
 * build steps say so.
 */
(function () {
  'use strict';
  const FP = window.FP, esc = window.FP_ESC || ((s) => String(s));
  if (!FP || !FP.demoBuild) return;
  const $ = (s, r = document) => r.querySelector(s);
  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  /* Public Overpass servers (wiki.openstreetmap.org/wiki/Overpass_API). The main one is often overloaded, so all are
     asked at once and the first good answer wins (the others are stopped). When none answers, the outline of the
     building at the address comes from Nominatim itself (without its neighbours). */
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
  const RADIUS = 80;          // m round the place: the buildings offered
  const TIMEOUT = 20000;

  /* ───────────────────────── geometry: an outline in lat/lon → walls in cm ───────────────────────── */
  const DEG = Math.PI / 180;
  // lat/lon → cm east (x) and south (y) of an origin (an equirectangular projection: exact enough for one building)
  function project(pts, lat0, lon0) {
    const kx = Math.cos(lat0 * DEG) * 111320 * 100, ky = 110540 * 100;
    return pts.map(([lat, lon]) => [(lon - lon0) * kx, -(lat - lat0) * ky]);
  }
  const area = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const centroid = (P) => {
    let x = 0, y = 0, A = 0;
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], c = a[0] * b[1] - b[0] * a[1]; A += c; x += (a[0] + b[0]) * c; y += (a[1] + b[1]) * c; }
    return Math.abs(A) < 1e-9 ? P[0] : [x / (3 * A), y / (3 * A)];
  };
  function inside(P, x, y) {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const [xi, yi] = P[i], [xj, yj] = P[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  const rot = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
  // Douglas–Peucker on a closed ring: drops points less than tol off the line through their neighbours
  function simplify(P, tol) {
    if (P.length <= 4) return P;
    const dl = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / L; };
    const rec = (pts) => {
      let im = 0, dm = 0;
      for (let i = 1; i < pts.length - 1; i++) { const d = dl(pts[i], pts[0], pts[pts.length - 1]); if (d > dm) { dm = d; im = i; } }
      return dm > tol ? rec(pts.slice(0, im + 1)).slice(0, -1).concat(rec(pts.slice(im))) : [pts[0], pts[pts.length - 1]];
    };
    // split at the point farthest from the first
    let far = 0, fd = 0;
    P.forEach((p, i) => { const d = Math.hypot(p[0] - P[0][0], p[1] - P[0][1]); if (d > fd) { fd = d; far = i; } });
    const a = rec(P.slice(0, far + 1)), b = rec(P.slice(far).concat([P[0]]));
    const out = a.slice(0, -1).concat(b.slice(0, -1));
    return out.length >= 3 ? out : P;
  }
  // the main direction of the walls (0 … 90°), the edges weighted by their length
  function mainAngle(P) {
    let c = 0, s = 0;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), t = Math.atan2(b[1] - a[1], b[0] - a[0]);
      c += L * Math.cos(4 * t); s += L * Math.sin(4 * t);
    }
    return Math.atan2(s, c) / 4;
  }
  // remove repeated and in-line points
  function tidy(P, minLen = 5) {
    let Q = P.slice();
    for (let pass = 0; pass < 4; pass++) {
      const R = [];
      for (let i = 0; i < Q.length; i++) {
        const a = R.length ? R[R.length - 1] : Q[Q.length - 1], b = Q[i], c = Q[(i + 1) % Q.length];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minLen) continue;
        const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(cr) / ((Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1])) || 1) < 0.02) continue; // straight on
        R.push(b);
      }
      if (R.length === Q.length || R.length < 3) { Q = R.length >= 3 ? R : Q; break; }
      Q = R;
    }
    return Q;
  }
  /* Square up an outline whose walls run along x and y (after turning): edges within 12° of an axis are made exactly
     horizontal or vertical (each at the average of its ends), the others kept as they are; the corners are where the
     neighbouring walls meet. Two neighbours along the same axis at different heights get a short wall between them. */
  function squareUp(P) {
    const lines = P.map((a, i) => {
      const b = P[(i + 1) % P.length], t = Math.atan2(b[1] - a[1], b[0] - a[0]) / DEG, m = ((t % 180) + 180) % 180;
      if (m < 12 || m > 168) return { k: 'h', y: (a[1] + b[1]) / 2, a, b };
      if (Math.abs(m - 90) < 12) return { k: 'v', x: (a[0] + b[0]) / 2, a, b };
      return { k: 'd', a, b };
    });
    const meet = (l1, l2, p) => {
      if (l1.k === 'h' && l2.k === 'v') return [[l2.x, l1.y]];
      if (l1.k === 'v' && l2.k === 'h') return [[l1.x, l2.y]];
      if (l1.k === 'h' && l2.k === 'h') return Math.abs(l1.y - l2.y) < 1 ? [] : [[p[0], l1.y], [p[0], l2.y]];
      if (l1.k === 'v' && l2.k === 'v') return Math.abs(l1.x - l2.x) < 1 ? [] : [[l1.x, p[1]], [l2.x, p[1]]];
      // with a sloping wall: where the two lines cross
      const L = (l) => (l.k === 'h' ? [[0, l.y], [1, 0]] : l.k === 'v' ? [[l.x, 0], [0, 1]] : [l.a, [l.b[0] - l.a[0], l.b[1] - l.a[1]]]);
      const [p1, d1] = L(l1), [p2, d2] = L(l2), den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) < 1e-6) return [p];
      const t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den;
      return [[p1[0] + d1[0] * t, p1[1] + d1[1] * t]];
    };
    const out = [];
    for (let i = 0; i < P.length; i++) out.push(...meet(lines[(i - 1 + P.length) % P.length], lines[i], P[i]));
    return tidy(out);
  }
  // the outline moved in by d all round (each wall's line moved in, corners where they meet)
  function inset(P, d) {
    const s = area(P) > 0 ? 1 : -1; // y runs down: a positive area is clockwise on screen; inwards is to the right
    const L = P.map((a, i) => {
      const b = P[(i + 1) % P.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n = [(-(b[1] - a[1]) / len) * s, ((b[0] - a[0]) / len) * s];
      return { p: [a[0] + n[0] * d, a[1] + n[1] * d], v: [b[0] - a[0], b[1] - a[1]] };
    });
    return P.map((q, i) => {
      const l1 = L[(i - 1 + P.length) % P.length], l2 = L[i], den = l1.v[0] * l2.v[1] - l1.v[1] * l2.v[0];
      if (Math.abs(den) < 1e-9) return l2.p;
      const t = ((l2.p[0] - l1.p[0]) * l2.v[1] - (l2.p[1] - l1.p[1]) * l2.v[0]) / den;
      return [l1.p[0] + l1.v[0] * t, l1.p[1] + l1.v[1] * t];
    });
  }
  // a point well inside (for the slab and the floor): the centroid when it is clear of the walls, else the best of a grid
  function innerPoint(P) {
    const distEdge = (x, y) => Math.min(...P.map((a, i) => {
      const b = P[(i + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2));
      return Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
    }));
    const c = centroid(P);
    if (inside(P, c[0], c[1]) && distEdge(c[0], c[1]) > 60) return c;
    const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    let best = c, bd = -1;
    for (let i = 1; i < 30; i++) for (let j = 1; j < 30; j++) {
      const x = x0 + ((x1 - x0) * i) / 30, y = y0 + ((y1 - y0) * j) / 30;
      if (!inside(P, x, y)) continue;
      const d = distEdge(x, y);
      if (d > bd) { bd = d; best = [x, y]; }
    }
    return best;
  }
  const r1 = (v) => Math.round(v * 10) / 10;
  const bboxOf = (P) => { const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; };
  const isOrtho = (P) => P.every((a, i) => { const b = P[(i + 1) % P.length]; return Math.abs(a[0] - b[0]) < 0.5 || Math.abs(a[1] - b[1]) < 0.5; });

  /* An outline (cm, x east / y south) → its shape for building: the outer face squared up, in a frame where its walls
     run along x and y (turned by `turn` radians from the map), and what kind of shape it is. */
  function shapeOf(P0, opt) {
    let P = tidy(simplify(P0, 20));
    const turn = mainAngle(P);
    let Q = P.map((p) => rot(p, -turn));          // walls along x and y
    if (opt.square) Q = squareUp(Q);
    if (Q.length < 3 || Math.abs(area(Q)) < 4e4) return null; // under 4 m²: not a house
    // the outline's own corner at (0, 0)
    const b0 = bboxOf(Q);
    Q = Q.map((p) => [p[0] - b0.x, p[1] - b0.y]);
    const b = bboxOf(Q), ortho = isOrtho(Q);
    let kind = 'other', L = null;
    if (ortho && Q.length === 4) kind = 'rect';
    if (ortho && Q.length === 6) {
      // an L: the bounding box less one corner; the reflex corner says how much
      const corners = { tl: [0, 0], tr: [b.w, 0], br: [b.w, b.h], bl: [0, b.h] };
      const miss = Object.entries(corners).find(([, c]) => !Q.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < 1));
      if (miss) {
        const [k, c] = miss, s = area(Q) > 0 ? 1 : -1;
        const reflex = Q.find((p, i) => { const a = Q[(i - 1 + Q.length) % Q.length], n = Q[(i + 1) % Q.length]; return ((p[0] - a[0]) * (n[1] - p[1]) - (p[1] - a[1]) * (n[0] - p[0])) * s < 0; });
        if (reflex) { kind = 'L'; L = { corner: k, cutW: Math.abs(c[0] - reflex[0]), cutD: Math.abs(c[1] - reflex[1]) }; }
      }
    }
    // (toShape: a projected map point → this frame; mapTurn: how far the frame is turned from the map)
    return { outer: Q, box: b, turn: opt.align ? 0 : turn, mapTurn: turn, toShape: (p) => { const q = rot(p, -turn); return [q[0] - b0.x, q[1] - b0.y]; },
      kind, L, ortho, area: Math.abs(area(Q)) / 1e4 };
  }

  /* ───────────────────────── OpenStreetMap tags → the house ───────────────────────── */
  const ROOF_OF = { gabled: 'gable', hipped: 'hip', 'half-hipped': 'hip', pyramidal: 'hip', flat: 'flat', skillion: 'shed', lean_to: 'shed',
    gambrel: 'gambrel', mansard: 'mansard', butterfly: 'butterfly', saltbox: 'saltbox' };
  const WALL_OF = { brick: 'brick', stone: 'stone', concrete: 'concrete', wood: 'wood-boards', timber_framing: 'wood-frame', plaster: 'plaster',
    render: 'stucco', stucco: 'stucco', metal: 'metal-siding', cement_block: 'concrete', glass: 'plaster' };
  const ROOFMAT_OF = { roof_tiles: 'clay-tiles', tile: 'clay-tiles', tiles: 'clay-tiles', slate: 'slate', metal: 'standing-seam', metal_sheet: 'corrugated',
    concrete: 'concrete-tiles', asphalt_shingle: 'shingles', shingle: 'shingles', grass: 'green-roof', plants: 'green-roof', tar_paper: 'membrane', wood: 'wood-shakes' };
  const KIND_NAME = { house: 'House', detached: 'Detached house', semidetached_house: 'Semi-detached house', terrace: 'Terraced house', residential: 'Residential building',
    apartments: 'Apartment building', bungalow: 'Bungalow', garage: 'Garage', shed: 'Shed', barn: 'Barn', farm: 'Farmhouse', cabin: 'Cabin',
    commercial: 'Commercial building', retail: 'Shop', office: 'Office building', church: 'Church', school: 'School', industrial: 'Industrial building', yes: 'Building' };
  function fromTags(t = {}) {
    let storeys = parseInt(t['building:levels'], 10);
    if (!(storeys > 0) && parseFloat(t.height) > 0) storeys = Math.max(1, Math.round((parseFloat(t.height) - (t['roof:height'] ? parseFloat(t['roof:height']) : 0)) / 3));
    return {
      storeys: storeys > 0 ? storeys : null,
      roof: ROOF_OF[t['roof:shape']] || null,
      wallMat: WALL_OF[t['building:material']] || null,
      roofMat: ROOF_MATS_OK(ROOFMAT_OF[t['roof:material']]),
      wallColor: /^#[0-9a-f]{6}$/i.test(t['building:colour'] || '') ? t['building:colour'] : null,
      kind: KIND_NAME[t.building] || (t.building ? t.building.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Building'),
      underground: parseInt(t['building:levels:underground'], 10) > 0,
      name: t.name || [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || '',
    };
  }
  function ROOF_MATS_OK(m) { return m && window.FP_WALLMATS && window.FP_WALLMATS.ROOF_MATS[m] ? m : null; }

  /* An outline with only right angles cut into as few rectangles as it takes (strips one way or the other, whichever
     gives fewer; neighbouring strips with the same span joined) — one roof over each. */
  function rectsOf(Q) {
    const strips = (P) => {
      const xs = [...new Set(P.map((p) => Math.round(p[0] * 10) / 10))].sort((u, v) => u - v), out = [], open = [];
      for (let i = 0; i + 1 < xs.length; i++) {
        const xm = (xs[i] + xs[i + 1]) / 2, ys = [];
        P.forEach((q, k) => { const r = P[(k + 1) % P.length]; if (Math.abs(q[1] - r[1]) < 0.5 && Math.min(q[0], r[0]) < xm && Math.max(q[0], r[0]) > xm) ys.push(q[1]); });
        ys.sort((u, v) => u - v);
        for (let k = 0; k + 1 < ys.length; k += 2) {
          const prev = open.find((o) => Math.abs(o.x1 - xs[i]) < 0.5 && Math.abs(o.y0 - ys[k]) < 0.5 && Math.abs(o.y1 - ys[k + 1]) < 0.5);
          if (prev) prev.x1 = xs[i + 1];
          else { const o = { x0: xs[i], x1: xs[i + 1], y0: ys[k], y1: ys[k + 1] }; open.push(o); out.push(o); }
        }
      }
      return out.map((o) => ({ x: o.x0, y: o.y0, w: o.x1 - o.x0, h: o.y1 - o.y0 }));
    };
    const a = strips(Q), b = strips(Q.map(([x, y]) => [y, x])).map((r) => ({ x: r.y, y: r.x, w: r.h, h: r.w }));
    return b.length < a.length ? b : a;
  }
  /* Which wall the front door goes in (index of an outline edge, and how far along it), from the map: a mapped
     entrance on the outline; else the wall facing the nearest street; else the wall facing south. */
  function frontOf(sh, extra, place) {
    const Q = sh.outer, n = Q.length, s = area(Q) > 0 ? 1 : -1, P0 = (pt) => sh.toShape(project([pt], place.lat, place.lon)[0]);
    const edge = (i) => { const a = Q[i], b = Q[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      return { i, a, b, L, u, out: [u[1] * s, -u[0] * s], mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; };
    const E = Q.map((_, i) => edge(i)), ok = E.filter((e) => e.L >= 230);
    if (!ok.length) return null;
    // a mapped entrance (the main one first) within 1.5 m of the outline
    const ents = (extra.entrances || []).map((en) => ({ p: P0(en.at), main: en.tags.entrance === 'main' })).sort((x, y) => (y.main ? 1 : 0) - (x.main ? 1 : 0));
    for (const en of ents) {
      let best = null;
      for (const e of ok) {
        const d = [en.p[0] - e.a[0], en.p[1] - e.a[1]], al = d[0] * e.u[0] + d[1] * e.u[1], off = Math.abs(d[0] * e.out[0] + d[1] * e.out[1]);
        if (al < 0 || al > e.L || off > 150) continue;
        if (!best || off < best.off) best = { e, al, off };
      }
      if (best) return { i: best.e.i, along: best.al / best.e.L, why: `the entrance mapped on it${en.main ? ' (main entrance)' : ''}` };
    }
    // the street: the wall whose middle is nearest a road lying in front of it
    const roads = (extra.roads || []).map((r) => ({ name: r.name, pts: r.pts.map(P0) }));
    let best = null;
    for (const e of ok) for (const r of roads) for (let k = 0; k + 1 < r.pts.length; k++) {
      const a = r.pts[k], b = r.pts[k + 1], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((e.mid[0] - a[0]) * dx + (e.mid[1] - a[1]) * dy) / L2)), q = [a[0] + dx * t, a[1] + dy * t];
      const v = [q[0] - e.mid[0], q[1] - e.mid[1]], d = Math.hypot(v[0], v[1]) || 1;
      if ((v[0] * e.out[0] + v[1] * e.out[1]) / d < 0.5) continue; // the road is not in front of this wall
      const score = d - e.L * 0.05;
      if (!best || score < best.score) best = { e, score, name: r.name };
    }
    if (best) return { i: best.e.i, along: 0.5, why: `the wall facing ${best.name ? esc(best.name) : 'the street'}` };
    // the wall facing most to the south (on the map), the longer one on a tie
    const south = ok.map((e) => ({ e, v: rot(e.out, sh.mapTurn)[1] + e.L / 1e5 })).sort((x, y) => y.v - x.v)[0];
    return { i: south.e.i, along: 0.5, why: 'the south side (no entrance or street is mapped next to it)' };
  }

  /* The building steps (ops as in js/demo.js) for a shape and the choices made in the dialog. */
  function design(sh, o) {
    const n = Math.max(1, Math.min(5, o.storeys | 0)), H = Math.round(Math.max(240, Math.min(450, o.storeyH)) / 5) * 5, t = o.t;
    const BH = 250, base = !!o.basement;
    const turn = sh.turn, c0 = [sh.box.w / 2, sh.box.h / 2], deg = (turn * 180) / Math.PI;
    // back from the squared frame to the plan: turned by `turn` about the outline's middle (when not lined up)
    const toPlan = (p) => { const q = rot([p[0] - c0[0], p[1] - c0[1]], turn); return [r1(q[0] + c0[0]), r1(q[1] + c0[1])]; };
    const centre = inset(sh.outer, t / 2), loop = centre.map(toPlan);
    const ip = toPlan(innerPoint(centre)), at = [r1(ip[0]), r1(ip[1])];
    const names = n === 1 ? ['Ground floor'] : ['Ground floor', ...Array.from({ length: n - 1 }, (_, i) => ['First floor', 'Second floor', 'Third floor', 'Fourth floor'][i])];
    const levels = names.map((name, i) => ({ id: 'L' + i, name, elev: i * H, wallH: H }));
    if (base) levels.unshift({ id: 'B1', name: 'Basement', elev: -BH, wallH: BH });
    const wm = o.wallMat || 'plaster', paint = [{ op: 'paint', side: 'out', wmat: wm, wcol: o.wallColor || undefined }, { op: 'paint', side: 'in', wmat: 'plaster', wcol: '#f4f1ec' }];
    const m = (v) => (v / 100).toFixed(2).replace(/\.?0+$/, '');
    const lc = (x) => x.charAt(0).toLowerCase() + x.slice(1);

    // the walls (centrelines, in the squared frame) with their direction and the way into the house
    const sg = area(centre) > 0 ? 1 : -1;
    const walls = centre.map((a, i) => {
      const b = centre[(i + 1) % centre.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      const nin = rot([-u[1] * sg, u[0] * sg], turn); // inwards, on the plan
      return { i, a, b, L, u, r: r1((Math.atan2(-nin[0], nin[1]) * 180) / Math.PI), dir: r1(Math.atan2(u[1], u[0]) * 180 / Math.PI + deg), inw: [-u[1] * sg, u[0] * sg] };
    });
    const ptOn = (w, s, off = 0) => toPlan([w.a[0] + w.u[0] * s + w.inw[0] * off, w.a[1] + w.u[1] * s + w.inw[1] * off]);
    const notes = [];

    // doors: the front one where the map says, a back one on the wall facing most the other way
    const DW = 90, doors = [];
    if (o.door !== 'none' && o.front) {
      const w = walls[o.front.i], s0 = Math.max(70 + DW / 2, Math.min(w.L - 70 - DW / 2, w.L * o.front.along));
      doors.push({ w, s: s0 });
      if (o.door === 'front-back') {
        const back = walls.filter((x) => x.L >= 230 && x !== w).sort((x, y) => (x.u[0] * w.u[0] + x.u[1] * w.u[1]) - (y.u[0] * w.u[0] + y.u[1] * w.u[1]) || y.L - x.L)[0];
        if (back) doors.push({ w: back, s: back.L / 2 });
      }
    }
    // stairs (straight, along the longest wall without the front door), when there is more than one storey
    const storeys = levels.length, stairLen = Math.ceil(Math.max(H, base ? BH : 0) / 17.5) * 28 + 40;
    let stair = null;
    if (o.stairs && storeys > 1) {
      const w = walls.filter((x) => !doors.some((d) => d.w === x)).sort((x, y) => y.L - x.L)[0];
      if (w && w.L >= stairLen + 140) stair = { w, s: w.L / 2, at: ptOn(w, w.L / 2, t / 2 + 50) };
      else notes.push('The stairs did not fit along a wall (too short): add them yourself from Stairs.');
    }
    // windows along every wall of a storey, clear of the corners, the doors and the stairs
    const WIN = { none: 0, few: 450, normal: 300, many: 220 }[o.windows || 'normal'];
    const windowsOn = (ground, type, ww, spacing) => {
      const list = [];
      if (!spacing) return list;
      for (const w of walls) {
        const no = [];
        if (ground) for (const d of doors) if (d.w === w) no.push([d.s - DW / 2 - 50, d.s + DW / 2 + 50]);
        if (stair && stair.w === w) no.push([stair.s - stairLen / 2 - 30, stair.s + stairLen / 2 + 30]);
        let segs = [[70, w.L - 70]];
        for (const [x0, x1] of no) segs = segs.flatMap(([p, q]) => [[p, Math.min(q, x0)], [Math.max(p, x1), q]]).filter(([p, q]) => q - p > 1);
        for (const [p, q] of segs) {
          const len = q - p;
          let k = Math.floor((len + spacing * 0.3) / spacing);
          if (!k && len >= ww + 40 && spacing < 450) k = 1;
          for (let j = 0; j < k; j++) { const c = ptOn(w, p + (len * (j + 0.5)) / k); list.push([type, c[0], c[1], w.r, { w: ww }]); }
        }
      }
      return list;
    };
    const winW = o.windows === 'many' ? 100 : 120;

    const steps = [];
    const nm = (id) => (storeys === 1 ? '' : `${levels.find((l) => l.id === id).name}: `);
    if (base) {
      const ops = [{ op: 'level', id: 'B1' }, { op: 'loop', t, pts: loop }, { op: 'paint', side: 'out', wmat: 'concrete' }, { op: 'paint', side: 'in', wmat: 'plaster', wcol: '#f4f1ec' },
        { op: 'slab', at, kind: 'concrete' }];
      const bw = windowsOn(false, 'window-basement', 80, WIN ? Math.max(WIN, 400) : 0);
      if (bw.length) ops.push({ op: 'place', list: bw });
      steps.push({ title: 'Basement', text: `A basement ${m(BH)} m deep under the whole house: concrete walls on its outline, a slab${bw.length ? ' and small basement windows' : ''}.`, ops });
    }
    steps.push({ title: `${nm('L0')}Outer walls`, text: `The outline of ${o.label} from OpenStreetMap (© OpenStreetMap contributors, ODbL): ${m(sh.box.w)} × ${m(sh.box.h)} m outside, about ${Math.round(sh.area)} m². The outer walls go up on it, ${t} cm thick and ${m(H)} m high${o.square ? ', squared up' : ''}.`,
      ops: [{ op: 'level', id: 'L0' }, { op: 'loop', t, pts: loop }, ...paint] });
    steps.push({ title: 'Ground slab', text: 'A concrete slab is poured inside the outer walls.', ops: [{ op: 'slab', at, kind: 'concrete' }] });
    // doors and windows of the ground floor
    const gw = windowsOn(true, 'window', winW, WIN), dl = doors.map((d) => { const c = ptOn(d.w, d.s); return ['door', c[0], c[1], d.w.r]; });
    if (dl.length || gw.length) steps.push({ title: `${nm('L0')}Doors and windows`, text: `${doors.length ? `The front door goes in ${o.frontWhy || 'the front wall'}${doors.length > 1 ? ', a back door opposite' : ''}. ` : ''}${gw.length ? `${gw.length} windows are spaced along the walls.` : ''}`,
      ops: [{ op: 'place', list: [...dl, ...gw] }] });
    for (let i = 1; i < n; i++) {
      const id = 'L' + i, ww = windowsOn(false, 'window', winW, WIN);
      steps.push({ title: `${levels.find((l) => l.id === id).name}: slab, walls and windows`, text: `The ${lc(levels.find((l) => l.id === id).name)} slab is laid on the walls below, and the outer walls go up again${ww.length ? ` with ${ww.length} windows` : ''}.`,
        ops: [{ op: 'level', id }, { op: 'slab', at, kind: 'concrete' }, { op: 'loop', t, pts: loop }, ...paint, ...(ww.length ? [{ op: 'place', list: ww }] : [])] });
    }
    // floors on every storey (before the stairs, which then stand on them)
    const fl = [];
    for (const L of levels) fl.push({ op: 'level', id: L.id }, { op: 'floor', at: [[at[0], at[1], L.id === 'B1' ? 'concrete' : L.id === 'L0' ? 'stone' : 'wood']] });
    steps.push({ title: 'Floors', text: `Floors are laid on every storey${base ? ': concrete in the basement, stone on the ground floor' : ''}.`, ops: fl });
    // stairs on every storey but the top one, stacked over each other
    if (stair) {
      const ops = [];
      for (const L of levels.slice(0, -1)) ops.push({ op: 'level', id: L.id }, { op: 'add', list: [['stairs-h', stair.at[0], stair.at[1], stair.w.dir]] });
      // then a stairwell in each floor above, cut to the stairs under it, with a railing
      for (const L of levels.slice(1)) ops.push({ op: 'level', id: L.id }, { op: 'add', list: [['slab-opening', stair.at[0], stair.at[1], stair.w.dir, { matchStairs: true, rail: '3' }]] });
      steps.push({ title: 'Stairs', text: `Straight stairs along the ${m(stair.w.L)} m wall connect the storeys${base ? ', from the basement up' : ''}; their steps are worked out from the storey height, and each floor above gets a stairwell with a railing.`, ops });
    }
    // the roof: one over a rectangle (its ridge along the longer side), an L-shaped hip roof over an L, else one over
    // each rectangle the outline can be cut into
    let roofNote = '';
    const roof = o.roof;
    if (roof && roof !== 'none') {
      const top = levels[levels.length - 1].id, ops = [{ op: 'level', id: top }];
      const over = (B, style) => {
        const cc = toPlan([B.x + B.w / 2, B.y + B.h / 2]), along = B.w >= B.h, w = along ? B.w : B.h, h = along ? B.h : B.w;
        const op = { op: 'roof', type: 'roof-' + style, x: r1(cc[0] - w / 2), y: r1(cc[1] - h / 2), w: r1(w), h: r1(h), r: r1(deg + (along ? 0 : 90)), pitch: o.pitch };
        if (o.roofMat) op.roofMat = o.roofMat;
        return op;
      };
      const B = sh.box, rname = lc((FP.byId['roof-' + roof] || { name: 'roof' }).name);
      if (sh.kind === 'rect') { ops.push(over({ x: 0, y: 0, w: B.w, h: B.h }, roof)); roofNote = `A ${rname} covers the house.`; }
      else if (sh.kind === 'L' && roof === 'hip') {
        const cc = toPlan([B.w / 2, B.h / 2]);
        ops.push({ op: 'roof', type: 'roof-hip-l', x: r1(cc[0] - B.w / 2), y: r1(cc[1] - B.h / 2), w: r1(B.w), h: r1(B.h), r: r1(deg), pitch: o.pitch, roofMat: o.roofMat || undefined,
          extra: { lCorner: sh.L.corner, lCutW: r1(sh.L.cutW), lCutD: r1(sh.L.cutD) } });
        roofNote = 'An L-shaped hip roof covers the house.';
      } else if (sh.ortho) {
        const rs = rectsOf(sh.outer);
        rs.forEach((R) => ops.push(over(R, roof)));
        roofNote = `${rs.length} ${rname}s cover the house, one over each rectangular part (where they meet they are trimmed into each other).`;
      }
      if (ops.length > 1) steps.push({ title: 'Roof', text: `${roofNote} ${o.pitch && roof !== 'flat' ? `Pitch ${o.pitch}°. ` : ''}It rests on the walls of the top storey.`, ops });
      else notes.push('This outline has slanted walls, so no roof was added: put roofs over its parts from the Roofs icons.');
    }
    // the last step says what is left to do
    const last = steps[steps.length - 1];
    last.text = `${last.text} ${notes.join(' ')} The map has no rooms: draw the inner walls and inner doors yourself (Walls & Structure, Doors).`.replace(/ +/g, ' ');
    last.ops.push({ op: 'level', id: 'L0' });
    return { id: 'map', name: o.label, blurb: `From OpenStreetMap: ${o.label}.`, ground: 'grass', levels, wallH: H, steps };
  }

  /* ───────────────────────── OpenStreetMap requests ───────────────────────── */
  async function getJSON(url, init, outer) {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), TIMEOUT);
    if (outer) outer.addEventListener('abort', () => ctl.abort());
    try {
      const r = await fetch(url, { ...init, signal: ctl.signal });
      if (!r.ok) throw new Error(r.status === 429 ? 'too many requests — wait a minute and try again' : `the server answered ${r.status}`);
      return await r.json();
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('no answer in time');
      throw e;
    } finally { clearTimeout(tm); }
  }
  async function search(q) {
    const ll = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (ll) return [{ lat: +ll[1], lon: +ll[2], label: `${(+ll[1]).toFixed(6)}, ${(+ll[2]).toFixed(6)}`, short: 'This location' }];
    const lang = (navigator.language || 'en').split('-')[0];
    // (with the place's own outline and tags: the fallback when no Overpass server answers)
    const res = await getJSON(`${NOMINATIM}/search?format=jsonv2&limit=5&polygon_geojson=1&extratags=1&q=${encodeURIComponent(q)}&accept-language=${encodeURIComponent(lang)}`);
    return (res || []).map((r) => ({ lat: +r.lat, lon: +r.lon, label: r.display_name, short: r.display_name.split(',').slice(0, 2).join(',').trim(),
      osm: r.osm_type === 'way' || r.osm_type === 'relation' ? `${r.osm_type}/${r.osm_id}` : null, own: ownBuilding(r) }));
  }
  /* A Nominatim result that is a building (a way or relation with an outline) → { id, ring, tags, holes }, else null */
  function ownBuilding(r) {
    const g = r && r.geojson, x = r && r.extratags || {};
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return null;
    if (r.category !== 'building' && !x.building && r.type !== 'house') return null;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const outer = polys.map((p) => p[0]).sort((a, b) => b.length - a.length)[0];
    if (!outer || outer.length < 4) return null;
    const tags = { ...x, building: x.building || (r.category === 'building' ? r.type : 'yes') };
    if (r.name && !tags.name) tags.name = r.name;
    return { id: `${r.osm_type}/${r.osm_id}`, ring: outer.map(([lon, lat]) => [lat, lon]), tags, holes: polys[0].length - 1 };
  }
  // the building at a point, from Nominatim's reverse lookup (when the address search found only an address point)
  async function reverseBuilding(lat, lon) {
    const r = await getJSON(`${NOMINATIM}/reverse?format=jsonv2&zoom=18&polygon_geojson=1&extratags=1&lat=${lat}&lon=${lon}`);
    return ownBuilding(r);
  }
  // the first of several requests to answer well (the others are stopped)
  function firstOf(urls, init) {
    const stop = new AbortController();
    return Promise.any(urls.map((u) => getJSON(u, init, stop.signal))).then((v) => { stop.abort(); return v; },
      (agg) => { throw (agg.errors && agg.errors[0]) || new Error('no answer'); });
  }
  // the building outlines round a point: [{ id, ring: [[lat, lon]], tags, holes }]
  async function buildings(lat, lon) {
    // (and the entrances mapped round it, and the streets — the front door goes on the side they show)
    const q = `[out:json][timeout:25];(way["building"](around:${RADIUS},${lat},${lon});relation["building"]["type"="multipolygon"](around:${RADIUS},${lat},${lon});` +
      `node["entrance"](around:${RADIUS},${lat},${lon});way["highway"]["highway"!~"^(footway|path|steps|cycleway|corridor|bridleway|track|proposed|construction)$"](around:${RADIUS + 40},${lat},${lon}););out geom tags;`;
    const init = { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
    const res = await firstOf(OVERPASS, init);
    const out = [];
    out.extra = { entrances: [], roads: [] };
    for (const el of res.elements || []) {
      const tg = el.tags || {};
      if (el.type === 'node' && tg.entrance) { out.extra.entrances.push({ at: [el.lat, el.lon], tags: tg }); continue; }
      if (el.type === 'way' && tg.highway && !tg.building) { if (el.geometry) out.extra.roads.push({ name: tg.name || '', pts: el.geometry.map((g) => [g.lat, g.lon]) }); continue; }
      if (el.type === 'way' && el.geometry && el.geometry.length >= 4) out.push({ id: `way/${el.id}`, ring: el.geometry.map((g) => [g.lat, g.lon]), tags: el.tags || {}, holes: 0 });
      if (el.type === 'relation' && el.members) {
        const outers = el.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry.map((g) => [g.lat, g.lon]));
        const ring = joinWays(outers);
        if (ring) out.push({ id: `relation/${el.id}`, ring, tags: el.tags || {}, holes: el.members.filter((m) => m.role === 'inner').length });
      }
    }
    return out;
  }
  // a multipolygon's outer ways joined end to end into one ring (the largest one when there are several)
  function joinWays(ways) {
    const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
    const rest = ways.map((w) => w.slice()), rings = [];
    while (rest.length) {
      let cur = rest.shift();
      for (let guard = 0; !same(cur[0], cur[cur.length - 1]) && guard < 500; guard++) {
        const k = rest.findIndex((w) => same(w[0], cur[cur.length - 1]) || same(w[w.length - 1], cur[cur.length - 1]));
        if (k < 0) break;
        const w = rest.splice(k, 1)[0];
        cur = cur.concat((same(w[0], cur[cur.length - 1]) ? w : w.slice().reverse()).slice(1));
      }
      if (same(cur[0], cur[cur.length - 1]) && cur.length >= 4) rings.push(cur);
    }
    return rings.sort((a, b) => b.length - a.length)[0] || null;
  }

  /* ───────────────────────── the dialog ───────────────────────── */
  const S = { results: [], place: null, list: [], pick: null, busy: false, step: 0 };
  const opts = { storeys: 1, storeyH: 300, t: 20, roof: 'gable', pitch: 30, roofMat: null, wallMat: 'plaster', wallColor: null,
    basement: false, door: 'front', windows: 'normal', stairs: true, square: true, align: true };
  const WM = window.FP_WALLMATS;

  /* ── little pictures for the choices (viewBox 0 0 120 70; the ground at y = 62) ── */
  const svg = (inner, label = '') => `<svg viewBox="0 0 120 70" aria-hidden="true">${inner}</svg>${label}`;
  const GROUND = '<rect x="0" y="62" width="120" height="8" fill="#7fb069"/>';
  const WALL = '#d9d3c7', WIN = '#a9d8f2', ROOFC = '#a5452f';
  function roofSketch(style, x, y, w, h) { // a small front view of a roof over the wall top x..x+w at y (as in the Wizard)
    const L = x, R = x + w, T = y - h, m = x + w / 2, f = 'fill="currentColor"';
    switch (style) {
      case 'flat': return `<rect x="${L - 2}" y="${y - 5}" width="${w + 4}" height="5" ${f}/>`;
      case 'shed': return `<path d="M${L - 4} ${y}L${R + 4} ${y - h * 0.6}L${R + 4} ${y - h * 0.6 + 5}L${L - 4} ${y + 5}Z" ${f}/>`;
      case 'hip': return `<path d="M${L - 4} ${y}L${L + w * 0.25} ${T}L${R - w * 0.25} ${T}L${R + 4} ${y}Z" ${f}/>`;
      case 'mansard': return `<path d="M${L - 3} ${y}L${L + 6} ${y - h * 0.65}L${L + w * 0.3} ${T}L${R - w * 0.3} ${T}L${R - 6} ${y - h * 0.65}L${R + 3} ${y}Z" ${f}/>`;
      case 'gambrel': return `<path d="M${L - 3} ${y}L${L + 8} ${y - h * 0.6}L${m} ${T}L${R - 8} ${y - h * 0.6}L${R + 3} ${y}Z" ${f}/>`;
      case 'butterfly': return `<path d="M${L - 4} ${y - h * 0.5}L${m} ${y - 4}L${R + 4} ${y - h * 0.5}L${R + 4} ${y - h * 0.5 + 5}L${m} ${y + 1}L${L - 4} ${y - h * 0.5 + 5}Z" ${f}/>`;
      case 'saltbox': case 'clerestory': return `<path d="M${L - 4} ${y}L${L + w * 0.62} ${T}L${R + 4} ${y - h * 0.35}L${R + 4} ${y}Z" ${f}/>`;
      case 'none': return '';
      default: return `<path d="M${L - 4} ${y}L${m} ${T}L${R + 4} ${y}Z" ${f}/>`; // gable, box gable: the gable end
    }
  }
  // a house front: n storeys, windows on each, a roof
  function front(n, { roof = opts.roof, wins = 2, x = 30, w = 60, sh = Math.min(13, 44 / n), door = true, roofH = 16 } = {}) {
    let g = GROUND, top = 62 - n * sh;
    g += `<rect x="${x}" y="${top}" width="${w}" height="${n * sh}" fill="${WALL}" stroke="#0003"/>`;
    for (let i = 0; i < n; i++) {
      const y0 = 62 - (i + 1) * sh;
      for (let k = 0; k < wins; k++) { const wx = x + ((k + 0.5) * w) / wins - 4; if (!(i === 0 && door && k === Math.floor(wins / 2))) g += `<rect x="${wx}" y="${y0 + sh * 0.28}" width="8" height="${sh * 0.42}" fill="${WIN}"/>`; }
      if (i) g += `<line x1="${x}" y1="${y0 + sh}" x2="${x + w}" y2="${y0 + sh}" stroke="#0002"/>`;
    }
    if (door) g += `<rect x="${x + w / 2 - 4}" y="${62 - sh * 0.8}" width="8" height="${sh * 0.8}" fill="#7a5a3c"/>`;
    g += `<g style="color:${ROOFC}">${roofSketch(roof === 'none' ? 'flat' : roof, x, top, w, roofH)}</g>`;
    return g;
  }
  const pics = {
    storeys: (n) => svg(front(n)),
    basement: (on) => svg(front(2, { sh: 12 }).replace(GROUND, '') + `<rect x="0" y="62" width="120" height="8" fill="#7fb069"/>` +
      (on ? `<rect x="30" y="62" width="60" height="8" fill="#b8b2a6" stroke="#5f5a52" stroke-dasharray="3 2"/><rect x="40" y="63" width="8" height="3" fill="${WIN}"/><rect x="72" y="63" width="8" height="3" fill="${WIN}"/>` : '')),
    wallT: (t) => { const k = t * 0.45; return svg(`<rect x="0" y="0" width="120" height="70" fill="#f4f1ec"/><path d="M20 12H100V${12 + k}H${20 + k}V60H20Z" fill="#5c6168"/><text x="62" y="46" font-size="11" fill="#555" text-anchor="middle">${t} cm</text>`); },
    roof: (st) => svg(`<g style="color:${ROOFC}">${roofSketch(st, 10, 50, 100, 30)}</g><rect x="22" y="50" width="76" height="12" fill="${WALL}" stroke="#0003"/>${GROUND}`),
    pitch: (p) => { const r = (p * Math.PI) / 180, h = Math.tan(r) * 50; return svg(`<path d="M10 58L60 ${58 - h}L110 58Z" fill="${ROOFC}"/><path d="M28 58A18 18 0 0 0 ${10 + 18 * Math.cos(r)} ${58 - 18 * Math.sin(r)}" fill="none" stroke="#fff" stroke-width="1.5"/><text x="60" y="66" font-size="9" fill="currentColor" text-anchor="middle">${p}°</text>`); },
    windows: (d) => { const n = { none: 0, few: 2, normal: 3, many: 5 }[d]; return svg(front(1, { wins: n, sh: 30, door: false, roofH: 14 })); },
  };
  // the building's own outline, small, with the doors marked on it (front: red, back: amber)
  function doorPic(mode) {
    const b = S.pick, sh = b && shapeOf(b.pts, opts);
    if (!sh) return svg('');
    const B = sh.box, k = Math.min(100 / B.w, 56 / B.h), ox = (120 - B.w * k) / 2, oy = (70 - B.h * k) / 2;
    const P = (p) => [ox + p[0] * k, oy + p[1] * k];
    let g = `<polygon points="${sh.outer.map((p) => P(p).join(',')).join(' ')}" fill="${WALL}" stroke="#5c6168" stroke-width="2.5"/>`;
    if (mode !== 'none') {
      const f = frontOf(sh, S.extra || {}, S.place), Q = sh.outer, n = Q.length;
      const mark = (i, t, col) => { const a = P(Q[i]), c = P(Q[(i + 1) % n]); const x = a[0] + (c[0] - a[0]) * t, y = a[1] + (c[1] - a[1]) * t; return `<circle cx="${x}" cy="${y}" r="5" fill="${col}" stroke="#fff" stroke-width="1.5"/>`; };
      if (f) {
        g += mark(f.i, f.along, '#dc2626');
        if (mode === 'front-back') {
          const u = (i) => { const a = Q[i], c = Q[(i + 1) % n], L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; return [(c[0] - a[0]) / L, (c[1] - a[1]) / L, L]; };
          const fu = u(f.i), back = Q.map((_, i) => i).filter((i) => i !== f.i && u(i)[2] >= 230).sort((i, j) => (u(i)[0] * fu[0] + u(i)[1] * fu[1]) - (u(j)[0] * fu[0] + u(j)[1] * fu[1]))[0];
          if (back != null) g += mark(back, 0.5, '#d97706');
        }
      }
    }
    return svg(g);
  }
  const card = (key, v, pic, label, sub = '', on = String(opts[key]) === String(v)) =>
    `<button type="button" class="mh-card${on ? ' on' : ''}" data-mh-set="${key}" data-v="${esc(String(v))}">${pic}<b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
  const fromMap = (cond) => (cond ? 'from the map' : '');

  /* ── the steps: one choice at a time, each with pictures ── */
  const STEPS = [
    { id: 'storeys', title: 'Storeys', sum: () => `${opts.storeys} × ${(opts.storeyH / 100).toFixed(2)} m`,
      body: () => { const I = S.pick.info; return `<p class="wz-lead">How many storeys does the house have?${I.storeys ? ` The map says <b>${I.storeys}</b>.` : ' The map does not say — count them on a photo of the house.'}</p>
        <div class="mh-cards">${[1, 2, 3, 4, 5].map((n) => card('storeys', n, pics.storeys(n), `${n} storey${n > 1 ? 's' : ''}`, fromMap(I.storeys === n))).join('')}</div>
        <h4>Height of each storey (floor to floor)</h4>
        <div class="wz-choices">${[260, 270, 280, 300, 320, 350].map((v) => `<button type="button" data-mh-set="storeyH" data-v="${v}" class="${opts.storeyH === v ? 'on' : ''}"><b>${(v / 100).toFixed(2)} m</b></button>`).join('')}</div>`; } },
    { id: 'basement', title: 'Basement', sum: () => (opts.basement ? 'yes, 2.50 m' : 'none'),
      body: () => { const u = S.pick.info.underground; return `<p class="wz-lead">Is there a basement under the house?${u ? ' The map records levels below ground.' : ''}</p>
        <div class="mh-cards">${card('basement', false, pics.basement(false), 'No basement', fromMap(!u))}${card('basement', true, pics.basement(true), 'Basement', `2.50 m deep, with small windows${u ? ' · from the map' : ''}`)}</div>`; } },
    { id: 'walls', title: 'Walls', sum: () => `${opts.t} cm · ${(WM.MATS[opts.wallMat] || { name: 'plaster' }).name.toLowerCase()}`,
      body: () => { const mm = S.pick.info.wallMat; return `<p class="wz-lead">How thick are the outer walls, and what are they made of?</p>
        <div class="mh-cards">${[15, 20, 25, 30, 36].map((t) => card('t', t, pics.wallT(t), `${t} cm`, { 15: 'timber frame', 20: 'usual', 25: 'brick', 30: 'solid / insulated', 36: 'thick stone' }[t])).join('')}</div>
        <h4>Outside of the walls${mm ? ` <small class="mh-k">(${esc(WM.MATS[mm].name.toLowerCase())} on the map)</small>` : ''}</h4>
        <div class="wz-mats">${Object.entries(WM.MATS).map(([id, m]) => `<button type="button" data-mh-set="wallMat" data-v="${id}" class="${opts.wallMat === id ? 'on' : ''}" title="${esc(m.name)}"><img src="${WM.swatch(id)}" alt=""/><span>${esc(m.name)}</span></button>`).join('')}</div>`; } },
    { id: 'roof', title: 'Roof', sum: () => (opts.roof === 'none' ? 'none' : `${(FP.byId['roof-' + opts.roof] || { name: opts.roof }).name.toLowerCase()}${opts.roof === 'flat' ? '' : `, ${opts.pitch}°`} · ${(WM.ROOF_MATS[opts.roofMat || 'clay-tiles'] || { name: '' }).name.toLowerCase()}`),
      body: () => { const I = S.pick.info, sh = shapeOf(S.pick.pts, opts);
        const note = !sh ? '' : sh.kind === 'L' ? (opts.roof === 'hip' ? 'An L-shaped hip roof covers the whole L.' : 'Two roofs, one over each arm of the L, meeting where they cross.')
          : sh.kind === 'other' ? (sh.ortho ? `${rectsOf(sh.outer).length} roofs, one over each rectangular part of the outline.` : 'This outline has slanted walls: no roof can be added (put roofs over its parts yourself).') : 'One roof over the whole house, its ridge along the longer side.';
        return `<p class="wz-lead">Which roof?${I.roof ? ` The map says <b>${esc(I.roof)}</b>.` : ''}</p>
        <div class="wz-roofs mh-roofs">${[...window.FP_ROOFS.styles, ['none', 'No roof']].map(([st, name]) => card('roof', st, pics.roof(st), name, fromMap(I.roof === st))).join('')}</div>
        <p class="wz-note">${note}</p>
        ${opts.roof === 'flat' || opts.roof === 'none' ? '' : `<h4>Pitch (slope)</h4><div class="mh-cards small">${[15, 20, 25, 30, 35, 40, 45].map((v) => card('pitch', v, pics.pitch(v), `${v}°`)).join('')}</div>`}
        ${opts.roof === 'none' ? '' : `<h4>Covering${I.roofMat ? ` <small class="mh-k">(${esc(WM.ROOF_MATS[I.roofMat].name.toLowerCase())} on the map)</small>` : ''}</h4>
        <div class="wz-mats">${Object.entries(WM.ROOF_MATS).map(([id, m]) => `<button type="button" data-mh-set="roofMat" data-v="${id}" class="${(opts.roofMat || 'clay-tiles') === id ? 'on' : ''}" title="${esc(m.name)}"><img src="${WM.roofSwatch(id)}" alt=""/><span>${esc(m.name)}</span></button>`).join('')}</div>`}`; } },
    { id: 'doors', title: 'Doors', sum: () => ({ front: 'front door', 'front-back': 'front and back door', none: 'none' }[opts.door]),
      body: () => { const sh = shapeOf(S.pick.pts, opts), f = sh && frontOf(sh, S.extra || {}, S.place);
        return `<p class="wz-lead">Which outside doors? ${f ? `The front door goes in ${f.why} <span class="mh-dotr"></span>.` : 'No wall is long enough for a door.'}</p>
        <div class="mh-cards">${card('door', 'front', doorPic('front'), 'Front door')}${card('door', 'front-back', doorPic('front-back'), 'Front and back door', 'the back door opposite')}${card('door', 'none', doorPic('none'), 'No doors', 'add them yourself')}</div>`; } },
    { id: 'windows', title: 'Windows', sum: () => opts.windows,
      body: () => `<p class="wz-lead">How many windows? They are spaced evenly along every outer wall of every storey, clear of the corners, the doors and the stairs.</p>
        <div class="mh-cards">${[['none', 'None', 'add them yourself'], ['few', 'Few', 'about every 4.5 m'], ['normal', 'Normal', 'about every 3 m'], ['many', 'Many', 'about every 2.2 m']].map(([v, n, sub]) => card('windows', v, pics.windows(v), n, sub)).join('')}</div>` },
    { id: 'shape', title: 'Stairs & shape', sum: () => [opts.stairs ? 'stairs' : 'no stairs', opts.square ? 'squared up' : 'as mapped', opts.align ? 'lined up with the grid' : 'north up'].join(' · '),
      body: () => `<p class="wz-lead">A few last choices.</p>
        <h4>Stairs between the storeys</h4>
        <div class="mh-cards">${card('stairs', true, svg(`${GROUND}<path d="M25 62H40V52H52V42H64V32H76V22H95" fill="none" stroke="#7a5a3c" stroke-width="4"/>`), 'Stairs', 'straight, with an opening in the floor above')}${card('stairs', false, svg(`${GROUND}<rect x="25" y="20" width="70" height="42" fill="none" stroke="#5c6168" stroke-width="2" stroke-dasharray="4 3"/>`), 'No stairs', 'add them yourself')}</div>
        <h4>The outline</h4>
        <div class="mh-cards">${card('square', true, svg('<path d="M25 15H95V55H25Z" fill="#d9d3c7" stroke="#5c6168" stroke-width="2.5"/>'), 'Square it up', 'straight walls, right angles')}${card('square', false, svg('<path d="M24 16L96 13L94 56L27 54Z" fill="#d9d3c7" stroke="#5c6168" stroke-width="2.5"/>'), 'As mapped', 'the outline exactly as drawn on the map')}</div>
        <div class="mh-cards">${card('align', true, svg('<path d="M25 18H95V52H25Z" fill="#d9d3c7" stroke="#5c6168" stroke-width="2.5"/><path d="M8 62H112" stroke="#9aa" stroke-dasharray="3 3"/>'), 'Line up with the grid', 'easiest to edit')}${card('align', false, svg('<path d="M32 10L100 30L90 62L22 42Z" fill="#d9d3c7" stroke="#5c6168" stroke-width="2.5"/><text x="8" y="14" font-size="10" fill="currentColor">N↑</text>'), 'North at the top', 'turned as on the map')}</div>` },
    { id: 'build', title: 'Build', sum: () => '',
      body: () => `<p class="wz-lead">Ready. Click <b>Build house</b>: it is built on the plan step by step — <b>Next</b>, <b>Previous</b> or <b>Play</b> to follow it, <b>Keep this house</b> to make it your plan, <b>✎ Change answers</b> to come back here.</p>
        <div class="mh-review">${svg(front(opts.storeys, { wins: { none: 0, few: 2, normal: 3, many: 4 }[opts.windows], door: opts.door !== 'none', sh: Math.min(12, 40 / opts.storeys) }).replace(`fill="${WALL}"`, `fill="${(WM.MATS[opts.wallMat] || {}).color || WALL}"`) +
          (opts.basement ? '<rect x="30" y="62" width="60" height="8" fill="#b8b2a6" stroke="#5f5a52" stroke-dasharray="3 2"/>' : ''))}</div>
        <ul class="wz-summary">${STEPS.slice(0, -1).map((st, k) => `<li><button type="button" data-mh-step="${k}">${esc(st.title)}</button><span>${esc(st.sum())}</span></li>`).join('')}</ul>` },
  ];
  function renderStep() {
    const sec = $('#mhOptSec');
    if (!S.pick) { sec.hidden = true; return; }
    sec.hidden = false;
    const k = S.step = Math.max(0, Math.min(STEPS.length - 1, S.step)), st = STEPS[k];
    $('#mhSteps').innerHTML = STEPS.map((x, i) => `<button type="button" data-mh-step="${i}" class="${i === k ? 'on' : i < k ? 'done' : ''}" title="${esc(x.title)}${x.sum() ? ': ' + esc(x.sum()) : ''}"><i>${i + 1}</i>${esc(x.title)}</button>`).join('');
    $('#mhStepTitle').textContent = `3 · ${st.title} — step ${k + 1} of ${STEPS.length}`;
    $('#mhStepBody').innerHTML = st.body();
    $('#mhBack').hidden = k === 0;
    $('#mhGo').textContent = k === STEPS.length - 1 ? 'Build house' : 'Next →';
    $('#mhGo').disabled = !shapeOf(S.pick.pts, opts);
  }

  function mount() {
    if ($('#mapHouse')) return;
    const el = document.createElement('div');
    el.id = 'mapHouse'; el.className = 'modal'; el.hidden = true;
    el.innerHTML = `<div class="modal-box pa-box mh-box" role="dialog" aria-labelledby="mhTitle">
      <div class="pa-head"><h2 id="mhTitle">Map → House</h2><button type="button" class="wz-x" data-mh="close" aria-label="Close" title="Close (Esc)">×</button></div>
      <ol class="pa-guide">
        <li><b>Type an address</b> (or a location as “latitude, longitude”) and click Find.</li>
        <li><b>Pick the building.</b> The outlines mapped around it are shown; the one at the address is chosen for you — click another to change it.</li>
        <li><b>Go through the choices</b> — storeys, basement, walls, roof, doors, windows, stairs — each with pictures, what the map says already picked. Then <b>Build house</b>: its outline becomes the outer walls at their real size. The map has no rooms: you draw the inner walls.</li>
      </ol>
      <section class="pa-sec">
        <h3>1 · Address</h3>
        <form class="mh-search" id="mhForm"><input id="mhQ" type="search" placeholder="e.g. 10 Downing Street, London" autocomplete="street-address" spellcheck="false"/><button type="submit" class="primary" id="mhFind">Find</button></form>
        <div class="mh-results" id="mhResults" hidden></div>
      </section>
      <section class="pa-sec" id="mhBuildSec" hidden>
        <h3>2 · Building</h3>
        <div class="mh-pick"><svg id="mhMap" class="mh-map" role="img" aria-label="Building outlines round the address"></svg><div class="mh-info" id="mhInfo"></div></div>
      </section>
      <section class="pa-sec" id="mhOptSec" hidden>
        <h3 id="mhStepTitle">3 · House</h3>
        <nav class="mh-steps" id="mhSteps" aria-label="Choices"></nav>
        <div class="mh-step" id="mhStepBody"></div>
      </section>
      <div class="pa-status" id="mhStatus" hidden></div>
      <p class="np-hint pa-privacy">Addresses and building outlines: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> (ODbL), found with Nominatim and the Overpass API. Only the address you type and its location are sent to them, from this browser. Mapped outlines and storeys can be missing or rough — check the result.</p>
      <div class="modal-btns"><button type="button" data-mh="close">Close</button><button type="button" data-mh="back" id="mhBack" hidden>← Back</button><button type="button" class="primary" data-mh="go" id="mhGo" disabled>Next →</button></div>
    </div>`;
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    $('#mhForm').addEventListener('submit', (e) => { e.preventDefault(); find(); });
  }
  function status(text, kind = '') {
    const s = $('#mhStatus');
    s.hidden = !text; s.className = 'pa-status' + (kind ? ' ' + kind : ''); s.innerHTML = text || '';
  }
  async function find() {
    const q = $('#mhQ').value.trim();
    if (!q || S.busy) return;
    S.busy = true; $('#mhFind').disabled = true; status('Looking up the address…');
    $('#mhBuildSec').hidden = $('#mhOptSec').hidden = true; $('#mhGo').disabled = true; S.pick = null;
    try {
      S.results = await search(q);
      if (!S.results.length) { $('#mhResults').hidden = true; status('No place found for that address. Check the spelling, add the town or country, or type the location as “latitude, longitude”.', 'warn'); return; }
      const box = $('#mhResults');
      box.hidden = S.results.length < 2;
      box.innerHTML = S.results.map((r, i) => `<button type="button" data-mh-r="${i}" class="${i === 0 ? 'on' : ''}">${esc(r.label)}</button>`).join('');
      await choosePlace(0);
    } catch (e) {
      status(/busy/.test(e.message || '') ? `Could not fetch the building outlines: ${esc(e.message)}.` : `Could not reach OpenStreetMap (${esc(e.message || e)}). Check the internet connection and try again.`, 'error');
    } finally { S.busy = false; $('#mhFind').disabled = false; }
  }
  async function choosePlace(i) {
    S.place = S.results[i];
    document.querySelectorAll('#mhResults [data-mh-r]').forEach((b) => b.classList.toggle('on', +b.dataset.mhR === i));
    status('Fetching the building outlines round it… (the map servers can take up to 20 seconds)');
    $('#mhGo').disabled = true;
    const P = S.place;
    let list, busy = null;
    S.extra = { entrances: [], roads: [] };
    try { list = await buildings(P.lat, P.lon); S.extra = list.extra; } catch (e) {
      // no outline server answered: the building at the address alone, from Nominatim
      busy = e;
      let own = P.own;
      if (!own) { await new Promise((r) => setTimeout(r, 1100)); own = await reverseBuilding(P.lat, P.lon).catch(() => null); } // (Nominatim: one request a second)
      if (!own) throw new Error(`the building-outline servers are busy (${e.message || e}) — wait a minute and try again`);
      list = [own];
    }
    S.list = list.map((b) => {
      const pts = project(b.ring.slice(0, -1), P.lat, P.lon);
      return { ...b, pts, info: fromTags(b.tags), a: Math.abs(area(pts)) / 1e4, inside: inside(pts, 0, 0), dist: Math.hypot(...centroid(pts)) };
    }).filter((b) => b.a >= 4);
    if (!S.list.length) {
      $('#mhBuildSec').hidden = $('#mhOptSec').hidden = true;
      status(`No building outline is mapped within ${RADIUS} m of this place. Try the exact house address, or another building nearby — or draw the house yourself.`, 'warn');
      return;
    }
    // the building at the address: the one the search found, else the one the point lies in, else the nearest
    const pick = S.list.find((b) => P.osm && b.id === P.osm) || S.list.find((b) => b.inside) || S.list.slice().sort((a, b) => a.dist - b.dist)[0];
    status(busy ? 'The building-outline servers are busy, so only the building at the address is shown (from the address search). Search again later to see the buildings round it.' : '', busy ? 'warn' : '');
    $('#mhBuildSec').hidden = false;
    choose(pick);
  }
  // a building picked: what the map says about it becomes the first choice of every step
  function choose(b) {
    S.pick = b;
    const I = b.info;
    opts.storeys = Math.min(5, I.storeys || 1);
    opts.roof = I.roof || (I.kind === 'Garage' || I.kind === 'Shed' ? 'shed' : 'gable');
    opts.basement = !!I.underground;
    opts.wallMat = I.wallMat || 'plaster'; opts.wallColor = I.wallColor || null;
    opts.roofMat = I.roofMat || null;
    S.step = 0;
    drawMap(); showInfo(); renderStep();
  }
  function showInfo() {
    const b = S.pick;
    if (!b) return;
    const I = b.info, sh = shapeOf(b.pts, opts);
    if (!sh) { $('#mhInfo').innerHTML = 'This outline is too small for a house.'; $('#mhGo').disabled = true; return; }
    const m = (v) => (v / 100).toFixed(1);
    const shapeName = sh.kind === 'rect' ? 'a rectangle' : sh.kind === 'L' ? 'an L shape' : `${sh.outer.length} corners`;
    $('#mhInfo').innerHTML = `<b>${esc(I.name || I.kind)}</b>${I.name ? ` <span class="mh-k">${esc(I.kind)}</span>` : ''}
      <ul><li>${m(sh.box.w)} × ${m(sh.box.h)} m outside · about ${Math.round(sh.area)} m² · ${shapeName}</li>
      <li>Storeys: ${I.storeys ? `<b>${I.storeys}</b> (from the map)` : 'not mapped'}${I.underground ? ' · a basement' : ''}</li>
      <li>Roof: ${I.roof ? `<b>${esc(I.roof)}</b> (from the map)` : 'not mapped'}</li>
      ${b.holes ? `<li>Its ${b.holes} inner courtyard${b.holes > 1 ? 's are' : ' is'} left out.</li>` : ''}
      ${sh.area > 1500 ? '<li class="mh-warn">A very large building — the plan may be slow.</li>' : ''}</ul>
      <p class="np-hint">${S.list.length > 1 ? `${S.list.length} buildings round the address — click one on the map to choose it.` : ''}</p>`;
  }
  // the outlines round the place, north up, the chosen one filled; the address as a dot
  function drawMap() {
    const el = $('#mhMap');
    if (!S.list.length) { el.innerHTML = ''; return; }
    const all = S.list.flatMap((b) => b.pts).concat([[0, 0]]), B = bboxOf(all), pad = 300;
    const vb = [B.x - pad, B.y - pad, B.w + 2 * pad, B.h + 2 * pad];
    el.setAttribute('viewBox', vb.join(' '));
    const sw = Math.max(vb[2], vb[3]) / 260;
    el.innerHTML = S.list.map((b, i) => `<polygon data-mh-b="${i}" points="${b.pts.map((p) => p.map(r1).join(',')).join(' ')}" class="${b === S.pick ? 'on' : ''}" style="stroke-width:${sw}"><title>${esc(b.info.name || b.info.kind)} · ${Math.round(b.a)} m²</title></polygon>`).join('') +
      `<circle cx="0" cy="0" r="${sw * 3.2}" class="mh-dot"/>` +
      `<text x="${vb[0] + sw * 4}" y="${vb[1] + sw * 12}" style="font-size:${sw * 10}px" class="mh-n">N ↑</text>`;
  }
  function onClick(e) {
    const r = e.target.closest('[data-mh-r]');
    if (r) { choosePlace(+r.dataset.mhR).catch((err) => status(`Could not fetch the building outlines: ${esc(err.message || err)}.`, 'error')); return; }
    const b = e.target.closest('[data-mh-b]');
    if (b) { choose(S.list[+b.dataset.mhB]); return; }
    const set = e.target.closest('[data-mh-set]');
    if (set) {
      const k = set.dataset.mhSet, v = set.dataset.v;
      opts[k] = v === 'true' ? true : v === 'false' ? false : /^\d+(\.\d+)?$/.test(v) ? +v : v;
      if (k === 'wallMat') opts.wallColor = null; // the material's own colour
      if (k === 'square' || k === 't') showInfo();
      renderStep();
      return;
    }
    const st = e.target.closest('[data-mh-step]');
    if (st) { S.step = +st.dataset.mhStep; renderStep(); return; }
    const a = e.target.closest('[data-mh]');
    if (!a) return;
    if (a.dataset.mh === 'close') close();
    if (a.dataset.mh === 'back') { S.step--; renderStep(); }
    if (a.dataset.mh === 'go') { if (S.step < STEPS.length - 1) { S.step++; renderStep(); $('#mhOptSec').scrollIntoView({ block: 'nearest' }); } else build(); }
  }
  function build() {
    const b = S.pick;
    if (!b) return;
    const sh = shapeOf(b.pts, opts);
    if (!sh) return;
    const I = b.info, label = I.name || (S.place && S.place.short) || I.kind;
    const front = frontOf(sh, S.extra || {}, S.place);
    const house = design(sh, { ...opts, label, front, frontWhy: front && front.why });
    close();
    FP.demoBuild(house, () => { open(); S.step = STEPS.length - 1; renderStep(); });
  }
  function open() {
    mount();
    $('#mapHouse').hidden = false;
    if (S.pick) renderStep(); else $('#mhQ').focus();
  }
  function close() { const m = $('#mapHouse'); if (m) m.hidden = true; }

  const btn = $('#btnMapHouse');
  if (btn) btn.addEventListener('click', open);
  window.FP_MAPHOUSE = { open, close, shapeOf, design, project, fromTags, joinWays, rectsOf, frontOf };
})();
