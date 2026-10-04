(function () {
'use strict';
// ---- engine/00-core.js
/* ---------- core: constants, small helpers, settings, language ---------- */
const $ = (id) => document.getElementById(id);
const PPU = 16, P = 1 / PPU;                        // 16 art pixels per world unit, as in the diorama kit
const PITCH = 0.62, SPR_Y = 1 / Math.cos(PITCH);    // figures stand upright; stretched by 1/cos so pixels stay square on screen
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const F_ROOF = 1, F_GLOW = 2, F_WRAP = 4, F_TEXTOP = 8, F_TEXALL = 16, F_OWN = 32;
const GLOW = 0xffe7a0;                              // the prompts' night-glow colour

function hash2(x, y) { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function rng(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(4071);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const shade = (c, k) => (Math.min(255, Math.round((c >> 16 & 255) * k)) << 16) | (Math.min(255, Math.round((c >> 8 & 255) * k)) << 8) | Math.min(255, Math.round((c & 255) * k));

// settings are preferences only (never game content): language, frame-rate cap, shadows, sound
const SETTINGS_KEY = 'mdv-rpg-cat-settings';   // mdv-allow-storage: preferences
const settings = Object.assign({ lang: (navigator.language || 'en').toLowerCase().startsWith('it') ? 'it' : 'en', fps: 60, shadows: true, sound: true },
  (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } })());
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* private mode: keep in memory */ } };

// every visible string comes from lang/<code>.json by key
function t(key, vars) {
  const L = window.LANG || {}, s = (L[settings.lang] || {})[key] ?? (L.en || {})[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m) : s;
}
function applyLang() {
  document.documentElement.lang = settings.lang;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-t-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.tAria)));
  document.title = t('title');
}

// ---- engine/10-art.js
/* ---------- art: the pipeline's atlases (window.ART, built by build.mjs) turned into pixels ---------- */
// ART = { <sheet>: { meta: { kind, sprites: { name: { x, y, w, h, depth?, anchor? } } }, png: 'data:image/png;base64,…' } }
const SHEETS = {};     // sheet name → { meta, canvas, px (RGBA of the whole atlas), w, h }
const DEFS = [];       // depth sprites for the extruder: { key, name, pic: { w, h, c, f, b, fl } }
const TILES = {};      // tile name → { w, h, px }

function loadArt() {
  const names = Object.keys(window.ART || {});
  return Promise.all(names.map((name) => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      SHEETS[name] = { meta: window.ART[name].meta, canvas: c, px: x.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
      ok();
    };
    img.onerror = () => fail(new Error('art sheet not decodable: ' + name));
    img.src = window.ART[name].png;
  }))).then(() => {
    for (const [sheet, S] of Object.entries(SHEETS)) {
      for (const [key, r] of Object.entries(S.meta.sprites)) {
        if (S.meta.kind === 'tiles') TILES[key] = { w: r.w, h: r.h, px: crop(S, r) };
        else if (r.depth) DEFS.push({ key, name: key, sheet, pic: depthPic(S, r) });
      }
    }
  });
}

const crop = (S, r) => { const out = new Uint8ClampedArray(r.w * r.h * 4); for (let y = 0; y < r.h; y++) out.set(S.px.subarray(((r.y + y) * S.w + r.x) * 4, ((r.y + y) * S.w + r.x + r.w) * 4), y * r.w * 4); return out; };
const b64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

// the pipeline gives depth from the front (0 = front face, growing backward); the extruder wants signed depths
// around the sprite's plane, front > back, in −64…63
function depthPic(S, r) {
  const n = r.w * r.h, zf = b64(r.depth.zf), zb = b64(r.depth.zb), mid = Math.round(r.depth.d / 2);
  const c = new Int32Array(n).fill(-1), f = new Int8Array(n), b = new Int8Array(n), fl = new Uint8Array(n);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const i = y * r.w + x, o = ((r.y + y) * S.w + r.x + x) * 4; if (S.px[o + 3] < 128) continue;
    const col = (S.px[o] << 16) | (S.px[o + 1] << 8) | S.px[o + 2];
    c[i] = col; f[i] = clamp(mid - zf[i], -63, 63); b[i] = clamp(mid - zb[i], -64, 62);
    if (Math.abs((col >> 16) - (GLOW >> 16)) + Math.abs((col >> 8 & 255) - (GLOW >> 8 & 255)) + Math.abs((col & 255) - (GLOW & 255)) < 30) fl[i] |= F_GLOW;
  }
  return { w: r.w, h: r.h, d: r.depth.d, c, f, b, fl };
}

// ---- engine/20-sprites.js
/* ---------- sprites: every depth sprite packed in one atlas at boot, then extruded per pixel (from the diorama kit) ---------- */
// AW: atlas width; the atlas is two halves (colours | side colours) plus an aux table (front layer, back layer, glow)
let AW = 512, AW2 = 1024, AH = 0, AP = { sprites: {} }, propsPx, zfPl, zbPl, flPl, atlasPx, auxPx;
const ROOF_F = [0, Math.SQRT1_2, Math.SQRT1_2], ROOF_B = [0, Math.SQRT1_2, -Math.SQRT1_2], TILE_N = 5;

function buildSprites() {
  AW = Math.max(512, ...DEFS.map((d) => d.pic.w + 2)); AW2 = AW * 2;
  const order = DEFS.slice().sort((a, b) => b.pic.h - a.pic.h || (a.key < b.key ? -1 : 1));
  let x = 1, y = 1, rowH = 0;
  for (const d of order) { if (x + d.pic.w + 1 > AW) { x = 1; y += rowH + 1; rowH = 0; } d.ax = x; d.ay = y; x += d.pic.w + 1; rowH = Math.max(rowH, d.pic.h); }
  AH = y + rowH + 1;
  for (const d of DEFS) AP.sprites[d.key] = { name: d.name, r: [d.ax, d.ay, d.pic.w, d.pic.h], d: d.pic.d };
  propsPx = new Uint8ClampedArray(AW * AH * 4); zfPl = new Uint8Array(AW * AH); zbPl = new Uint8Array(AW * AH); flPl = new Uint8Array(AW * AH);
  for (const d of DEFS) { const p = d.pic; for (let yy = 0; yy < p.h; yy++) for (let xx = 0; xx < p.w; xx++) { const i = yy * p.w + xx; if (p.c[i] < 0) continue; const q = (d.ay + yy) * AW + d.ax + xx, c = p.c[i]; propsPx[q * 4] = c >> 16 & 255; propsPx[q * 4 + 1] = c >> 8 & 255; propsPx[q * 4 + 2] = c & 255; propsPx[q * 4 + 3] = 255; zfPl[q] = p.f[i] + 64; zbPl[q] = p.b[i] + 64; flPl[q] = p.fl[i]; } }
  atlasPx = new Uint8Array(AW2 * AH * 4); auxPx = new Uint8Array(AW2 * AH * 4);
  for (const key in AP.sprites) new Spr(key);
}

/* ---------- sprite 2D: un ritaglio del foglio, con due profondità per pixel (davanti e dietro) già disegnate insieme ai colori ---------- */
const SPRITES = [], sp = {};
class Spr {
  constructor(key) {
    const meta = AP.sprites[key], [ax, ay, w, h] = meta.r, n = w * h;
    Object.assign(this, { key, name: meta.name, ax, ay, w, h, base: h, px: meta.px === undefined ? Math.round(w / 2) : meta.px, count: 0, texKey: meta.tex, gable: meta.gable, cross: !!meta.cross, tileN: meta.tex ? 16 : TILE_N });
    this.data = new Uint8ClampedArray(n * 4); this.glow = new Uint8Array(n); this.fl = new Uint8Array(n);
    this.zf = new Int8Array(n); this.zb = new Int8Array(n); this.cls = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, q = (ay + y) * AW + ax + x, k = q * 4; if (propsPx[k + 3] < 128) continue;
      this.data[i * 4] = propsPx[k]; this.data[i * 4 + 1] = propsPx[k + 1]; this.data[i * 4 + 2] = propsPx[k + 2]; this.data[i * 4 + 3] = 255;
      const f = flPl[q]; this.fl[i] = f; this.cls[i] = f & F_ROOF; this.glow[i] = f & F_GLOW ? 1 : 0; this.zf[i] = zfPl[q] - 64; this.zb[i] = zbPl[q] - 64; this.count++;
    }
    SPRITES.push(this); sp[key] = this; this.finish();
  }
  on(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.data[(y * this.w + x) * 4 + 3] > 0; }
  each(fn) { const w = this.w, d = this.data; for (let y = 0; y < this.h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (d[i * 4 + 3]) fn(x, y, i); } }
  finish() {
    const w = this.w, h = this.h, n = w * h, d = this.data;
    // colore dei fianchi: quello del pixel, ma il contorno scuro prende il colore del vicino più prossimo
    const sc = this.sc = new Uint8Array(n * 3), dist = new Int8Array(n).fill(-1), q = [];
    this.each((x, y, i) => { sc[i * 3] = d[i * 4]; sc[i * 3 + 1] = d[i * 4 + 1]; sc[i * 3 + 2] = d[i * 4 + 2]; if (d[i * 4] * .3 + d[i * 4 + 1] * .59 + d[i * 4 + 2] * .11 >= 42) { dist[i] = 0; q.push(i); } });
    for (let k = 0; k < q.length; k++) { const i = q[k], x = i % w, y = (i / w) | 0; if (dist[i] >= 3) continue; for (const [a, b] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) { if (!this.on(a, b)) continue; const j = b * w + a; if (dist[j] >= 0) continue; dist[j] = dist[i] + 1; sc[j * 3] = sc[i * 3]; sc[j * 3 + 1] = sc[i * 3 + 1]; sc[j * 3 + 2] = sc[i * 3 + 2]; q.push(j); } }
    // tabella degli strati e colori, scritti nell'atlante; i pixel vuoti prendono il colore del vicino, così un fianco non resta mai bucato
    const cf = new Uint8Array(n), cb = new Uint8Array(n), near = new Int32Array(n).fill(-1), fq = [];
    this.each((x, y, i) => { if (this.zf[i] <= this.zb[i]) this.zf[i] = this.zb[i] + 1; cf[i] = this.zf[i] + 64 + this.cls[i] * 128; cb[i] = this.zb[i] + 64 + this.cls[i] * 128; near[i] = i; fq.push(i); });
    for (let k = 0; k < fq.length; k++) { const i = fq[k], x = i % w, y = (i / w) | 0; for (const [a, b] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) { if (a < 0 || b < 0 || a >= w || b >= h) continue; const j = b * w + a; if (near[j] >= 0) continue; near[j] = near[i]; fq.push(j); } }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, j = near[i], on = j === i, kl = ((this.ay + y) * AW2 + this.ax + x) * 4, kr = kl + AW * 4;
      if (j < 0) continue;
      atlasPx[kl] = d[j * 4]; atlasPx[kl + 1] = d[j * 4 + 1]; atlasPx[kl + 2] = d[j * 4 + 2]; atlasPx[kl + 3] = 255;
      atlasPx[kr] = sc[j * 3]; atlasPx[kr + 1] = sc[j * 3 + 1]; atlasPx[kr + 2] = sc[j * 3 + 2]; atlasPx[kr + 3] = 255;
      if (on) { auxPx[kl] = cf[i]; auxPx[kl + 1] = cb[i]; auxPx[kl + 2] = auxPx[kr + 2] = this.glow[i] ? 255 : 0; }
    }
    this.layF = this.layers(cf); this.layB = this.layers(cb);
    this.sides();
    return this;
  }
  // pixel con la stessa profondità = uno strato; ogni strato si copre con rettangoli di 16 pixel al massimo
  layers(codes) {
    const m = new Map();
    this.each((x, y, i) => { const key = codes[i] * 64 + (y >> 4); let L = m.get(key); if (!L) m.set(key, L = { code: codes[i], y0: y, y1: y, cells: new Set() }); if (y < L.y0) L.y0 = y; if (y > L.y1) L.y1 = y; L.cells.add(x >> 4); });
    const out = []; for (const L of m.values()) for (const c of L.cells) out.push([L.code, c * 16, L.y0, Math.min(this.w, c * 16 + 16), L.y1 + 1]);
    return out;
  }
  /* Fianchi. Ogni pixel espone una faccia dove il vicino manca o è meno profondo. Le facce in fila sulla stessa retta si fondono in strisce
     che leggono il colore dall'atlante: il pixel stesso (facce strette), la facciata che gira l'angolo (muri), o poche righe ripetute (tetti). */
  sides() {
    const s = this, w = s.w, h = s.h, base = s.base, px = s.px, N = s.tileN, patch = s.texKey ? sp[s.texKey] : null, open = new Map(), segs = [];
    const add = (dir, line, pos, d0, d1, tA, tB, half, sn, row) => {
      if (row !== undefined) { segs.push({ dir, line, p0: pos, p1: pos + 1, d0, d1, tA, tB, half, sn, row }); return; }   // ritaglio di tetto o di telo: non si fonde con i vicini
      const key = dir + '|' + line + '|' + d0 + '|' + d1 + '|' + tA + '|' + tB + '|' + half + '|' + (sn ? sn.join() : ''), g = open.get(key);
      if (g && g.p1 === pos && pos - g.p0 < 16) g.p1 = pos + 1; else { const o = { dir, line, p0: pos, p1: pos + 1, d0, d1, tA, tB, half, sn }; open.set(key, o); segs.push(o); }
    };
    s.each((x, y, i) => {
      const zf = s.zf[i], zb = s.zb[i], f = s.fl[i];
      for (let k = 0; k < 4; k++) {
        const nx = k === 0 ? -1 : k === 1 ? 1 : 0, ny = k === 2 ? 1 : k === 3 ? -1 : 0, X = x + nx, Y = y - ny;
        if (ny < 0 && Y >= base) continue;                      // la base poggia a terra
        const sn = (f & F_TEXALL) && s.gable !== undefined ? [x + .5 < s.gable ? -.6 : .6, .8, 0] : null, ov = sn && nx * sn[0] + ny * sn[1] > 0 ? sn : null, roof = ny > 0 && (f & F_ROOF);
        const line = nx ? x : y, pos = nx ? y : x, size = nx ? w : h, g = (nx < 0 || ny > 0) ? 1 : -1;   // g: verso in cui si entra nello sprite
        const flat = (a, b, o) => add(k, line, pos, a, b, line + .5, line + .5, 1, o);
        const run = (a, b) => {
          if (b <= a) return;
          if (roof) { if (a >= 0) flat(a, b, ROOF_F); else if (b <= 0) flat(a, b, ROOF_B); else { flat(0, b, ROOF_F); flat(a, 0, ROOF_B); } return; }
          const wrap = nx !== 0 && (f & F_WRAP) !== 0;
          if (b - a < 6 || (f & F_OWN)) { flat(a, b, ov); return; }   // facce strette, o pixel che chiedono il proprio colore
          // tetti piani e teli: il colore viene da un ritaglio a parte dell'atlante, ripetuto lungo la profondità
          const tex = patch && ((ny > 0 && (f & F_TEXTOP)) || (ny >= 0 && (f & F_TEXALL))) ? [patch.ax - 1, patch.ay + ((ny > 0 ? x : y) % patch.h)] : null;
          const dB = Math.floor((zf - 1 + zb) / 2) + 1;           // fin qui è più vicina la faccia dietro, poi quella davanti
          const piece = (d0, d1, back) => {
            if (d1 <= d0) return; let T;
            if (wrap && !tex) T = (dd) => { const t = back ? dd - zb : zf - dd; return g > 0 ? line + t : line + 1 - t; };
            else { const kk = back ? Math.floor((d0 - zb) / N) : Math.floor((zf - d0 - 1) / N), l = tex ? tex[0] : line, gg = tex ? 1 : g; T = (dd) => { const t = (back ? dd - zb : zf - dd) - kk * N; return gg > 0 ? l + 1 + t : l - t; }; }
            const tA = T(d0), tB = T(d1);
            if (tex) add(k, line, pos, d0, d1, tA, tB, 1, ov, tex[1]); else if (Math.min(tA, tB) < 0 || Math.max(tA, tB) > size) flat(d0, d1, ov); else add(k, line, pos, d0, d1, tA, tB, wrap ? 0 : 1, ov);
          };
          const cut = (d0, d1, back) => {
            const wr = wrap && !tex; let c = d0;
            while (c < d1) { let nxt; if (wr) nxt = c + 16; else if (back) nxt = zb + (Math.floor((c - zb) / N) + 1) * N; else { const m = zf - c; nxt = zf - Math.floor((m - 1) / N) * N; } nxt = Math.min(nxt, d1); piece(c, nxt, back); c = nxt; }
          };
          cut(a, Math.min(b, dB), true); cut(Math.max(a, dB), b, false);
        };
        if (!s.on(X, Y)) run(zb, zf);
        else { const j = Y * w + X, zfn = s.zf[j], zbn = s.zb[j]; if (zfn < zf) run(Math.max(zfn, zb), zf); if (zbn > zb) run(zb, Math.min(zbn, zf)); }
      }
    });
    // strisce in coordinate dello sprite: quattro angoli, normale, coordinate nell'atlante
    const NRM = [[-1, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0]];
    s.strips = segs.map((q) => {
      const fix = q.row !== undefined, r = q.row, n = NRM[q.dir], uo = (fix ? 0 : s.ax) + q.half * AW, vo = fix ? 0 : s.ay; let P_, uv;
      if (q.dir < 2) { const Xp = (q.dir === 0 ? q.line : q.line + 1) - px, Yt = base - q.p0, Yb = base - q.p1; P_ = [Xp, Yb, q.d0, Xp, Yt, q.d0, Xp, Yt, q.d1, Xp, Yb, q.d1]; uv = fix ? [q.tA, r + 1, q.tA, r, q.tB, r, q.tB, r + 1] : [q.tA, q.p1, q.tA, q.p0, q.tB, q.p0, q.tB, q.p1]; }
      else { const Yp = q.dir === 2 ? base - q.line : base - q.line - 1, X0 = q.p0 - px, X1 = q.p1 - px; P_ = [X0, Yp, q.d0, X1, Yp, q.d0, X1, Yp, q.d1, X0, Yp, q.d1]; uv = fix ? [q.tA, r + .5, q.tA, r + .5, q.tB, r + .5, q.tB, r + .5] : [q.p0, q.tA, q.p1, q.tA, q.p1, q.tB, q.p0, q.tB]; }
      for (let k = 0; k < 4; k++) { uv[k * 2] = (uo + uv[k * 2]) / AW2; uv[k * 2 + 1] = (vo + uv[k * 2 + 1]) / AH; }
      return { p: P_, n, sn: q.sn || n, uv };
    });
  }
}

/* ---------- costruttori di geometria ---------- */
class Buf { constructor(T, cap) { this.T = T; this.a = new T(cap); this.n = 0; } need(k) { if (this.n + k > this.a.length) { const b = new this.T(Math.max(this.a.length * 2, this.n + k)); b.set(this.a); this.a = b; } } done() { return this.a.slice(0, this.n); } }
const flipped = (p, nx, ny, nz) => { const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2], vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2]; return ((uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz) < 0; };
// fianchi del terreno: un rettangolo colorato per faccia
class Builder {
  constructor(cap) { this.pos = new Buf(Float32Array, cap * 12); this.nrm = new Buf(Int8Array, cap * 12); this.col = new Buf(Uint8Array, cap * 16); this.idx = new Buf(Uint32Array, cap * 6); this.v = 0; }
  quad(p, nx, ny, nz, r, g, b, gl, sx, sy, sz) {
    const order = flipped(p, nx, ny, nz) ? [0, 3, 2, 1] : [0, 1, 2, 3]; if (sx === undefined) { sx = nx; sy = ny; sz = nz; }
    this.pos.need(12); this.nrm.need(12); this.col.need(16); this.idx.need(6);
    const pa = this.pos.a, na = this.nrm.a, ca = this.col.a, ia = this.idx.a; let pn = this.pos.n, nn = this.nrm.n, cn = this.col.n;
    for (let k = 0; k < 4; k++) { const o = order[k] * 3; pa[pn++] = p[o]; pa[pn++] = p[o + 1]; pa[pn++] = p[o + 2]; na[nn++] = sx * 127; na[nn++] = sy * 127; na[nn++] = sz * 127; ca[cn++] = r; ca[cn++] = g; ca[cn++] = b; ca[cn++] = gl ? 255 : 0; }
    this.pos.n = pn; this.nrm.n = nn; this.col.n = cn;
    const v = this.v, i = this.idx.n; ia[i] = v; ia[i + 1] = v + 1; ia[i + 2] = v + 2; ia[i + 3] = v; ia[i + 4] = v + 2; ia[i + 5] = v + 3; this.idx.n += 6; this.v += 4;
  }
  // luce dei lampioni calcolata una volta per faccia al caricamento, invece che per ogni pixel a ogni frame
  bakeLamps(light) {
    const n = this.v, out = new Uint8Array(n), p = this.pos.a, nr = this.nrm.a;
    for (let v = 0; v < n; v += 4) {
      let x = 0, y = 0, z = 0; for (let k = 0; k < 4; k++) { x += p[(v + k) * 3]; y += p[(v + k) * 3 + 1]; z += p[(v + k) * 3 + 2]; }
      const b = Math.min(255, Math.round(light(x / 4, y / 4, z / 4, nr[v * 3] / 127, nr[v * 3 + 1] / 127, nr[v * 3 + 2] / 127) * 127.5));
      out[v] = out[v + 1] = out[v + 2] = out[v + 3] = b;
    }
    this.lamp = out;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.done(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.done(), 3, true));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col.done(), 4, true));
    g.setAttribute('aLamp', new THREE.BufferAttribute(this.lamp || new Uint8Array(this.v), 1, true));
    g.setIndex(new THREE.BufferAttribute(this.v > 65535 ? this.idx.done() : new Uint16Array(this.idx.done()), 1));
    g.computeBoundingSphere();
    return g;
  }
  get tris() { return this.idx.n / 3; }
}
// facce davanti e dietro: rettangoli che leggono colore e strato dall'atlante
class SlabBuilder {
  constructor(cap) { this.pos = new Buf(Float32Array, cap * 12); this.nrm = new Buf(Int8Array, cap * 12); this.uv = new Buf(Float32Array, cap * 8); this.lay = new Buf(Float32Array, cap * 4); this.idx = new Buf(Uint32Array, cap * 6); this.v = 0; }
  quad(p, nx, ny, nz, uv, layer, sx, sy, sz) {
    const order = flipped(p, nx, ny, nz) ? [0, 3, 2, 1] : [0, 1, 2, 3];
    this.pos.need(12); this.nrm.need(12); this.uv.need(8); this.lay.need(4); this.idx.need(6);
    const pa = this.pos.a, na = this.nrm.a, ua = this.uv.a, la = this.lay.a, ia = this.idx.a; let pn = this.pos.n, nn = this.nrm.n, un = this.uv.n, ln = this.lay.n;
    for (let k = 0; k < 4; k++) { const o = order[k]; pa[pn++] = p[o * 3]; pa[pn++] = p[o * 3 + 1]; pa[pn++] = p[o * 3 + 2]; na[nn++] = sx * 127; na[nn++] = sy * 127; na[nn++] = sz * 127; ua[un++] = uv[o * 2]; ua[un++] = uv[o * 2 + 1]; la[ln++] = layer; }
    this.pos.n = pn; this.nrm.n = nn; this.uv.n = un; this.lay.n = ln;
    const v = this.v, i = this.idx.n; ia[i] = v; ia[i + 1] = v + 1; ia[i + 2] = v + 2; ia[i + 3] = v; ia[i + 4] = v + 2; ia[i + 5] = v + 3; this.idx.n += 6; this.v += 4;
  }
  bakeLamps(light) {
    const n = this.v, out = new Uint8Array(n), p = this.pos.a, nr = this.nrm.a;
    for (let v = 0; v < n; v++) out[v] = Math.min(255, Math.round(light(p[v * 3], p[v * 3 + 1], p[v * 3 + 2], nr[v * 3] / 127, nr[v * 3 + 1] / 127, nr[v * 3 + 2] / 127) * 127.5));
    this.lamp = out;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.done(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm.done(), 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.done(), 2));
    g.setAttribute('aLayer', new THREE.BufferAttribute(this.lay.done(), 1));
    g.setAttribute('aLamp', new THREE.BufferAttribute(this.lamp || new Uint8Array(this.v), 1, true));
    g.setIndex(new THREE.BufferAttribute(this.v > 65535 ? this.idx.done() : new Uint16Array(this.idx.done()), 1));
    g.computeBoundingSphere();
    return g;
  }
  get tris() { return this.idx.n / 3; }
}

/* ---------- extrusion: a prepared sprite set down in the world (the current area's builders S and B) ---------- */
let tally = { px: 0 }, S = null, B = null;
function put(s, x, z, o) {
  o = o || {};
  const rot = (((o.rot || 0) % 4) + 4) % 4, fl = o.flip ? -1 : 1, e = o.eps || 0, base = s.base, px = s.px;
  const ox = Math.round(x * PPU) / PPU, oz = Math.round(z * PPU) / PPU, oy = o.y || 0;
  const pts = new Array(12), g3 = [0, 0, 0], s3 = [0, 0, 0];
  const tp = (X, Y, Z, k) => { let a = X * fl, c = Z; for (let r = 0; r < rot; r++) { const m = a; a = c; c = -m; } pts[k] = ox + e + a * P; pts[k + 1] = oy + e * .7 + Y * P; pts[k + 2] = oz + e + c * P; };
  const tn = (v, out) => { let a = v[0] * fl, c = v[2]; for (let r = 0; r < rot; r++) { const m = a; a = c; c = -m; } out[0] = a; out[1] = v[1]; out[2] = c; };
  const slab = (L, front) => {
    const code = L[0], x0 = L[1], y0 = L[2], x1 = L[3], y1 = L[4], zz = (code & 127) - 64, sg = front ? 1 : -1;
    tp(x0 - px, base - y1, zz, 0); tp(x1 - px, base - y1, zz, 3); tp(x1 - px, base - y0, zz, 6); tp(x0 - px, base - y0, zz, 9);
    const u0 = (s.ax + x0) / AW2, u1 = (s.ax + x1) / AW2, v0 = (s.ay + y0) / AH, v1 = (s.ay + y1) / AH;
    tn([0, 0, sg], g3); tn(code > 127 ? (front ? ROOF_F : ROOF_B) : [0, 0, sg], s3);
    S.quad(pts, g3[0], g3[1], g3[2], [u0, v1, u1, v1, u1, v0, u0, v0], sg * code, s3[0], s3[1], s3[2]);
  };
  for (const L of s.layF) slab(L, true); for (const L of s.layB) slab(L, false);
  for (const q of s.strips) { for (let k = 0; k < 4; k++) tp(q.p[k * 3], q.p[k * 3 + 1], q.p[k * 3 + 2], k * 3); tn(q.n, g3); tn(q.sn, s3); S.quad(pts, g3[0], g3[1], g3[2], q.uv, 0, s3[0], s3[1], s3[2]); }
  tally.px += s.count;
  return { x: ox, z: oz };
}

// ---- engine/30-render.js
/* ---------- render: renderer, lights, materials, post pass, camera, time of day (from the diorama kit) ---------- */
const canvas = $('gl');
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' }); } catch (e) { renderer = null; }
const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, .6); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1); sun.castShadow = settings.shadows;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.autoUpdate = false; sun.shadow.bias = -0.0004;
scene.add(sun); scene.add(sun.target);
if (renderer) { renderer.setPixelRatio(1); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.BasicShadowMap; renderer.info.autoReset = false; }

const nearest = (t) => { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t; };
let groundTex = null, heightTex = null, atlasTex = null, auxTex = null;   // ground: per area; atlas: once at boot
function makeAtlasTextures() {
  atlasTex = nearest(new THREE.DataTexture(atlasPx, AW2, AH, THREE.RGBAFormat, THREE.UnsignedByteType)); atlasTex.encoding = THREE.sRGBEncoding; atlasTex.needsUpdate = true;
  auxTex = nearest(new THREE.DataTexture(auxPx, AW2, AH, THREE.RGBAFormat, THREE.UnsignedByteType)); auxTex.needsUpdate = true;
}

/* Materiale: colore per pixel, bagliore, e ombre lette al centro della cella da 1/16 (ombre a scalini sulla griglia) */
const uGlow = { value: 0 }, uLampCol = { value: new THREE.Vector3() }, diag = { flat: false }, allMats = [];
const LIGHTS = THREE.ShaderChunk.lights_fragment_begin.split('vDirectionalShadowCoord[ i ]').join('vxShadowCoord');
const LAYER_TEST = 'vec4 vxA = texture2D(uAux, vUv); if (abs(vLayer) > 0.5 && abs((vLayer < 0.0 ? vxA.g : vxA.r) * 255.0 - abs(vLayer)) > 0.5) discard;';
function voxelMaterial(kind, o) {
  const ground = kind === 'ground', sprite = kind === 'sprite', slab = kind === 'slab';
  const m = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0x000000, shininess: 0, map: ground ? groundTex : sprite ? o.map : slab ? atlasTex : null, alphaTest: sprite ? .5 : 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uShadowMat = { value: sun.shadow.matrix };
    sh.uniforms.uGlow = uGlow;
    sh.uniforms.uLampCol = uLampCol;
    if (ground) sh.uniforms.uHeightTex = { value: heightTex };
    if (slab) sh.uniforms.uAux = { value: auxTex };
    if (sprite) { sh.uniforms.uProbe = { value: o.probe }; sh.uniforms.uRow = { value: o.row }; sh.uniforms.uLampL = o.lampL; }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;\n' + (ground || sprite ? '' : slab ? 'attribute float aLayer; varying float vLayer; attribute float aLamp; varying float vLamp;' : 'attribute vec4 aCol; varying vec4 vCol; attribute float aLamp; varying float vLamp;'))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * normal);\n' + (ground || sprite ? '' : slab ? 'vLayer = aLayer; vLamp = aLamp;' : 'vCol = aCol; vLamp = aLamp;'));
    let f = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm; uniform mat4 uShadowMat; uniform float uGlow; uniform vec3 uLampCol;\n' + (ground ? 'uniform sampler2D uHeightTex;' : sprite ? 'uniform vec3 uProbe; uniform vec2 uRow; uniform float uLampL;' : slab ? 'uniform sampler2D uAux; varying float vLayer; varying float vLamp;' : 'varying vec4 vCol; varying float vLamp;'));
    f = f.replace('void main() {', 'void main() {\n' + (ground ? 'float vxLamp = texture2D(uHeightTex, vUv).a * 2.0;' : sprite ? 'float vxLamp = uLampL;' : slab ? LAYER_TEST + ' float vxLamp = vLamp * 2.0;' : 'float vxLamp = vLamp * 2.0;'));
    if (slab) f = f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vxA.b * uGlow * 1.5;');
    else if (ground) f = f.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * texture2D(uHeightTex, vUv).r * uGlow * 1.6;');
    else if (!ground && !sprite) f = f.replace('#include <color_fragment>', '#include <color_fragment>\nvec3 vxBase = pow(vCol.rgb, vec3(2.2)); diffuseColor.rgb *= vxBase;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vxBase * vCol.a * uGlow * 1.5;');
    const coord = sprite
      ? 'vec4 vxShadowCoord = uShadowMat * vec4(uProbe.x, uProbe.y + (floor((vWPos.y - uProbe.y) / uRow.x) + 0.5) * uRow.y, uProbe.z, 1.0);\n'
      : 'vec3 vxP = vWPos + normalize(vWNrm) * 0.03125;\nvec4 vxShadowCoord = uShadowMat * vec4((floor(vxP * 16.0) + 0.5) * 0.0625, 1.0);\n';
    sh.fragmentShader = diag.flat
      ? f.replace('#include <lights_fragment_begin>', '').replace('#include <lights_fragment_maps>', '').replace('#include <lights_fragment_end>', '').replace(/vec3 outgoingLight = [^;]+;/, 'vec3 outgoingLight = diffuseColor.rgb * 0.8 + totalEmissiveRadiance;')
      : f.replace('#include <lights_fragment_begin>', coord + LIGHTS).replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directDiffuse += material.diffuseColor * uLampCol * vxLamp;');
  };
  m.customProgramCacheKey = () => 'vx-' + kind + (diag.flat ? '-flat' : '');
  allMats.push(m);
  return m;
}
let matStatic = null, matSlab = null, slabDepth = null;
function makeMaterials() {
  matStatic = voxelMaterial('static'); matSlab = voxelMaterial('slab');
  slabDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlasTex });
  slabDepth.onBeforeCompile = (sh) => {
    sh.uniforms.uAux = { value: auxTex };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLayer; varying float vLayer;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLayer = aLayer;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uAux; varying float vLayer;').replace('void main() {', 'void main() {\n' + LAYER_TEST);
  };
}

/* ---------- passata finale: sfondo, antialias leggero, vignettatura ---------- */
const rt = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, stencilBuffer: false });
rt.texture.encoding = THREE.sRGBEncoding; rt.texture.generateMipmaps = false;
const postU = { tColor: { value: rt.texture }, uTexel: { value: new THREE.Vector2() }, uSpread: { value: 1 }, uAspect: { value: 1 }, uTime: { value: 0 }, uStars: { value: 0 }, uAur: { value: 0 }, uAurT: { value: 0 }, uBgTop: { value: new THREE.Vector3() }, uBgBot: { value: new THREE.Vector3() } };
const postMat = new THREE.ShaderMaterial({
  uniforms: postU, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    precision highp float;
    uniform sampler2D tColor; uniform vec2 uTexel; uniform float uSpread, uAspect, uTime, uStars, uAur, uAurT;
    uniform vec3 uBgTop, uBgBot; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec4 tap(vec2 o){ vec4 s = texture2D(tColor, vUv + o * uSpread * uTexel); vec3 c = s.a > 0.001 ? min(s.rgb / s.a, vec3(1.0)) : vec3(0.0); return vec4(c * c * s.a, s.a); }
    void main(){
      vec4 acc = (tap(vec2(0.0)) * 2.0 + tap(vec2(0.375, 0.125)) + tap(vec2(-0.125, 0.375)) + tap(vec2(-0.375, -0.125)) + tap(vec2(0.125, -0.375))) / 6.0;
      vec2 q = vUv - 0.5;
      vec3 bg = mix(uBgBot, uBgTop, smoothstep(0.05, 0.95, vUv.y));
      bg += mix(uBgBot, uBgTop, 0.5) * 0.35 * exp(-dot(q, q) * 5.0);
      float h = hash(floor(vUv * vec2(uAspect, 1.0) * 170.0));
      bg += uStars * step(0.991, h) * (0.55 + 0.45 * sin(uTime * 1.6 + h * 90.0)) * vec3(0.8, 0.88, 1.0) * 0.7;
      vec3 col = acc.rgb + (1.0 - acc.a) * bg;
      col *= 1.0 - 0.5 * smoothstep(0.42, 1.0, length(q * vec2(1.0, 1.12)) * 1.25);
      gl_FragColor = vec4(sqrt(max(col, 0.0)), 1.0);
    }`
});
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
{ const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat); m.frustumCulled = false; postScene.add(m); }

/* ---------- time of day ---------- */
/* ---------- ore del giorno: alba, giorno, tramonto, notte (ogni borgo può ritoccarle) ---------- */
const lin = (h) => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255].map((v) => v * v);
const TOD_BASE = {
  alba: { sun: 0xffb08a, sunI: .85, az: 1.35, el: .24, sky: 0xc9b4d8, gnd: 0x7a6a72, hemiI: .55, glow: .45, lamp: .55, top: 0x4e5f9c, bot: 0xf4b49a, stars: .3, aur: 0 },
  giorno: { sun: 0xfff0d8, sunI: 1.0, az: -.6, el: .85, sky: 0xcfe0ff, gnd: 0xb8b0a0, hemiI: .6, glow: 0, lamp: 0, top: 0x5d9be0, bot: 0xd8e8f6, stars: 0, aur: 0 },
  tramonto: { sun: 0xff9a60, sunI: 1.15, az: -1.3, el: .3, sky: 0xc8a2c8, gnd: 0x806a70, hemiI: .56, glow: .8, lamp: .9, top: 0x2a2a66, bot: 0xf0905e, stars: .2, aur: 0 },
  interno: { sun: 0xffd9a0, sunI: .35, az: -.4, el: 1.1, sky: 0x9a7a5a, gnd: 0x3a2a20, hemiI: .62, glow: .9, lamp: 1.3, top: 0x0e0a0c, bot: 0x221816, stars: 0, aur: 0 },
  notte: { sun: 0x9cb6ff, sunI: .45, az: .6, el: 1.0, sky: 0x6a8cbc, gnd: 0x283654, hemiI: .5, glow: 1, lamp: 1.5, top: 0x04070f, bot: 0x101a30, stars: 1, aur: 0 },
};
let tod = 1, lamps = [];   // lamps: halo sprites of the current area
const TODS = ['alba', 'giorno', 'tramonto', 'notte', 'interno'].map((label) => {
  const o = Object.assign({}, TOD_BASE[label], null || {});
  for (const k of ['sun', 'sky', 'gnd', 'top', 'bot']) o[k] = lin(o[k]);
  o.label = label; return o;
});
const cur = JSON.parse(JSON.stringify(TODS[tod]));
function applyTod(k) {
  const T = TODS[tod];
  for (const key of ['sunI', 'az', 'el', 'hemiI', 'glow', 'lamp', 'stars', 'aur']) cur[key] = lerp(cur[key], T[key], k);
  for (const key of ['sun', 'sky', 'gnd', 'top', 'bot']) for (let i = 0; i < 3; i++) cur[key][i] = lerp(cur[key][i], T[key][i], k);
  sun.color.setRGB(cur.sun[0], cur.sun[1], cur.sun[2]); sun.intensity = cur.sunI;
  const ce = Math.cos(cur.el); sun.position.set(A.sunX + Math.sin(cur.az) * ce * 48, Math.sin(cur.el) * 48, A.sunZ + Math.cos(cur.az) * ce * 48);
  hemi.color.setRGB(cur.sky[0], cur.sky[1], cur.sky[2]); hemi.groundColor.setRGB(cur.gnd[0], cur.gnd[1], cur.gnd[2]); hemi.intensity = cur.hemiI;
  uGlow.value = cur.glow;
  uLampCol.value.set(cur.lamp, cur.lamp * .663, cur.lamp * .353);
  for (const h of lamps) h.material.opacity = Math.min(1, cur.lamp * .3);
}

/* ---------- camera: orthographic, pitched, follows the player inside the current area ---------- */
const CD = 60, cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 140), camT = new THREE.Vector3();
let yaw = 0, yawT = 0, Vz = 15, VT = 15, aspect = 1;
const minV = () => 9.5 / aspect;
function camGoal(vv) {
  if (A.W > 48 || A.D > 40) return [player.x, player.z - (A.camNorth || 1.5)];   // the open world: follow the cat
  const W = A.W, D = A.D, f = clamp(1.45 - vv / 26, .4, .9); return [W / 2 + (player.x - W / 2) * f, D / 2 - (A.camNorth || 1.5) + (player.z - D / 2) * f * .6]; }
function setCamera() {
  const cp = Math.cos(PITCH), spn = Math.sin(PITCH), v = Math.max(Vz, minV());
  cam.position.set(camT.x + Math.sin(yaw) * cp * CD, camT.y + spn * CD, camT.z + Math.cos(yaw) * cp * CD); cam.lookAt(camT);
  cam.top = v / 2; cam.bottom = -v / 2; cam.right = v / 2 * aspect; cam.left = -cam.right; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
}

let quality = 1, bw = 0, bh = 0;
function resize() {
  if (!renderer) return;
  const r = canvas.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * quality; bw = Math.max(2, Math.round(r.width * dpr)); bh = Math.max(2, Math.round(r.height * dpr));
  const ss = dpr >= 1.5 ? 1.5 / dpr : 1.25; renderer.setSize(bw, bh, false); rt.setSize(Math.max(2, Math.round(bw * ss)), Math.max(2, Math.round(bh * ss)));
  aspect = r.width / r.height; postU.uTexel.value.set(1 / rt.width, 1 / rt.height); postU.uAspect.value = aspect; postU.uSpread.value = Math.max(ss, .75);
}

// ---- engine/40-area.js
/* ---------- areas: a map is built in chunks around the cat (the open world) or as one piece (an interior) ---------- */
// def: { id, name, cell (world units per map cell, default 2 = one 32 px tile), map: rows of legend chars,
//        legend: { ch: { tile, h (art px), water, wall (colour), cliff (earth strata) } }, chunk: [cols, rows] per chunk (default: the whole map),
//        things: [[key, x, z, hx?, hz?, opts?]] (opts.door: { to, at, face } makes a doorway in front of it),
//        lamps: [[x, y, z, r, k]], exits: [{ rect: [x0, z0, x1, z1], to, at, face }], solids, start, tod, camNorth }
const AREAS = {};
let A = null;   // the current area

function openArea(def) {
  const T0 = performance.now(), cell = def.cell || 2, cellPx = cell * PPU, rows = def.map.length, cols = def.map[0].length;
  const W = cols * cell, D = rows * cell, PXW = cols * cellPx, PXD = rows * cellPx;
  const keys = Object.keys(def.legend), GT = keys.map((k) => Object.assign({ h: 0 }, def.legend[k], { tex: TILES[def.legend[k].tile] }));
  for (const g of GT) if (!g.tex) throw new Error(`area ${def.id}: tile "${g.tile}" is not in the art`);
  const typeOf = new Map(keys.map((k, i) => [k, i]));
  const cellType = (c, r) => { const row = def.map[clamp(r, 0, rows - 1)]; const t = typeOf.get(row[clamp(c, 0, cols - 1)]); return t === undefined ? 0 : t; };
  const tyPx = (x, z) => cellType(Math.floor(x / cellPx), Math.floor(z / cellPx));
  const hPx = (x, z) => GT[tyPx(x, z)].h;
  const groundY = (x, z) => hPx(Math.floor(x * PPU), Math.floor(z * PPU)) * P;
  const isWater = (x, z) => !!GT[tyPx(Math.floor(x * PPU), Math.floor(z * PPU))].water;
  const tilePx = (g, x, z) => { const tw = g.tex.w, th = g.tex.h, o = ((((z % th) + th) % th) * tw + (((x % tw) + tw) % tw)) * 4, p = g.tex.px; return (p[o] << 16) | (p[o + 1] << 8) | p[o + 2]; };
  const avg = (g) => { if (g.avg !== undefined) return g.avg; let r = 0, gg = 0, b = 0; const p = g.tex.px, n = p.length / 4; for (let o = 0; o < p.length; o += 4) { r += p[o]; gg += p[o + 1]; b += p[o + 2]; } return (g.avg = (Math.round(r / n) << 16) | (Math.round(gg / n) << 8) | Math.round(b / n)); };
  const nearOther = (x, z, test) => test(tyPx(x - 1, z)) || test(tyPx(x + 1, z)) || test(tyPx(x, z - 1)) || test(tyPx(x, z + 1));

  /* lamps, solids, things, doors and places to look at: global, computed once */
  const lampSpots = (def.lamps || []).map(([x, y, z, r, k]) => ({ x, y, z, r: r || 2.4, k: k || 1, halo: true }));
  function lampLight(x, y, z, nx, ny, nz) {
    let L = 0;
    for (const p of lampSpots) { const lx = p.x - x, ly = p.y - y, lz = p.z + .3 - z, d = Math.hypot(lx, ly, lz); if (d >= 6.5 || d < 1e-4) continue; const ndl = (nx * lx + ny * ly + nz * lz) / d; if (ndl > 0) L += Math.pow(1 - d / 6.5, 1.6) * ndl * p.k; }
    return L;
  }
  const solids = [], acts = [], exits = (def.exits || []).slice(), things = [];
  const solid = (x0, z0, x1, z1) => solids.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });
  for (const [key, x, z, hx0, hz0, o0] of def.things || []) {
    const s = sp[key]; if (!s) throw new Error(`area ${def.id}: sprite "${key}" is not in the art`);
    const o = Object.assign({}, o0 || {}), d = AP.sprites[key].d || 8;
    let hx = hx0, hz = hz0; if (hx === undefined) { hx = Math.max(.1, s.w * P / 2 - .15); hz = Math.max(.1, d * P / 2 - .15); }
    const px = Math.round(x * PPU) / PPU, pz = Math.round(z * PPU) / PPU;
    if (hx) { const sw = (o.rot || 0) % 2 ? [hz, hx] : [hx, hz]; solid(px - sw[0], pz - sw[1], px + sw[0], pz + sw[1]); }
    if (o.door) { const fz = pz + d * P / 2; exits.push({ rect: [px - .9, fz, px + .9, fz + .7], to: o.door.to, at: o.door.at, face: o.door.face || [0, -1] }); }
    if (o.look) acts.push({ x: px, z: pz + d * P / 2 + .6, r: 1.4, label: o.look.label, name: o.look.name, lines: o.look.lines });
    things.push({ s, x, z, o });
  }
  for (const [x0, z0, x1, z1] of def.solids || []) solid(x0, z0, x1, z1);

  // walking: map edges, solids, water and steps higher than def.step art pixels block
  const STEP = (def.step || 3.5) * P;
  function blocked(x, z, fromX, fromZ) {
    const r = .3; if (x < r || z < r || x > W - r || z > D - r) return true;
    for (const s of solids) if (x > s.x0 - r && x < s.x1 + r && z > s.z0 - r && z < s.z1 + r) return true;
    for (const [a, b] of [[-.22, 0], [.22, 0], [0, -.18], [0, .18]]) { if (isWater(x + a, z + b)) return true; if (fromX !== undefined && Math.abs(groundY(x + a, z + b) - groundY(fromX, fromZ)) > STEP) return true; }
    return false;
  }

  /* one chunk: ground texture and mesh, walls, the things standing in it, baked light, halos */
  const [ccw, cch] = def.chunk || [cols, rows], CW = ccw * cellPx, CH = cch * cellPx, NI = Math.ceil(cols / ccw), NJ = Math.ceil(rows / cch);
  const wallCol = (t, a, y) => { const g = GT[t]; if (g.cliff) return edgeCol(t, a, y, g.h); const c = g.wall !== undefined ? g.wall : shade(avg(g), .62); return (Math.floor(y / 4) + Math.floor(a / 8)) % 2 ? c : shade(c, .9); };
  const STRATA = [0x6b4a32, 0x5e4230, 0x6f5238, 0x52392a];
  const edgeCol = (t, k, y, top) => top - y <= 2 ? shade(avg(GT[t]), .8) : STRATA[Math.floor((top - y + (k % 7)) / 7) % STRATA.length];
  function buildChunk(ci, cj) {
    const x0 = ci * CW, z0 = cj * CH, w = Math.min(CW, PXW - x0), h = Math.min(CH, PXD - z0);
    const group = new THREE.Group(); scene.add(group);
    const prevS = S, prevB = B; S = new SlabBuilder(8000); B = new Builder(8000);
    // ground pixels
    const gCan = document.createElement('canvas'); gCan.width = w; gCan.height = h;
    const gCtx = gCan.getContext('2d'), gImg = gCtx.createImageData(w, h), water = [], foam = new Uint8Array(w * h);
    const put1 = (i, c) => { gImg.data[i * 4] = c >> 16 & 255; gImg.data[i * 4 + 1] = c >> 8 & 255; gImg.data[i * 4 + 2] = c & 255; gImg.data[i * 4 + 3] = 255; };
    const waterColor = (i, tick) => { const x = x0 + i % w, z = z0 + ((i / w) | 0); return foam[i] && (x + z + tick) % 3 ? 0xd8eef0 : tilePx(GT[tyPx(x, z)], x + tick, z); };
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      const i = z * w + x, gx = x0 + x, gz = z0 + z, g = GT[tyPx(gx, gz)];
      if (g.water) { water.push(i); if (nearOther(gx, gz, (k) => !GT[k].water) && hash2(gx * 3, gz * 7) < .7) foam[i] = 1; put1(i, waterColor(i, 0)); }
      else put1(i, tilePx(g, gx, gz));
    }
    gCtx.putImageData(gImg, 0, 0);
    // walls: each face belongs to the higher pixel; the map's outer edges get the diorama's earth sides
    const rgb = (c) => [c >> 16 & 255, c >> 8 & 255, c & 255], cols2 = new Map();
    const bands = (y0, y1, colorAt) => { const out = []; let s = y0, c = colorAt(y0); for (let y = y0 + 1; y <= y1; y++) { const cy = y < y1 ? colorAt(y) : -2; if (cy !== c) { out.push(s, y, c); s = y; c = cy; } } return out; };
    const col = (dir, line, pos, y0, y1, colorAt) => { if (y1 <= y0) return; const key = dir + '|' + line; let L = cols2.get(key); if (!L) cols2.set(key, L = []); L.push({ pos, b: bands(y0, y1, colorAt) }); };
    for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) {
      const hh = hPx(x, z), t = tyPx(x, z);
      if (x > 0 && hPx(x - 1, z) < hh) col(0, x, z, hPx(x - 1, z), hh, (y) => wallCol(t, z, y));
      if (x < PXW - 1 && hPx(x + 1, z) < hh) col(1, x + 1, z, hPx(x + 1, z), hh, (y) => wallCol(t, z, y));
      if (z > 0 && hPx(x, z - 1) < hh) col(2, z, x, hPx(x, z - 1), hh, (y) => wallCol(t, x, y));
      if (z < PXD - 1 && hPx(x, z + 1) < hh) col(3, z + 1, x, hPx(x, z + 1), hh, (y) => wallCol(t, x, y));
    }
    const side = (dir, line, pos, x, z, k) => { const top = hPx(x, z), t = tyPx(x, z); col(dir, line, pos, -24, top, (y) => edgeCol(t, k, y, top)); };
    if (z0 === 0) for (let x = x0; x < x0 + w; x++) side(2, 0, x, x, 0, x);
    if (z0 + h === PXD) for (let x = x0; x < x0 + w; x++) side(3, PXD, x, x, PXD - 1, x + 900);
    if (x0 === 0) for (let z = z0; z < z0 + h; z++) side(0, 0, z, 0, z, z + 2000);
    if (x0 + w === PXW) for (let z = z0; z < z0 + h; z++) side(1, PXW, z, PXW - 1, z, z + 3100);
    const NX = [-1, 1, 0, 0], NZ = [0, 0, -1, 1];
    for (const [key, L] of cols2) {
      const [dir, line] = key.split('|').map(Number); L.sort((p, q) => p.pos - q.pos);
      let k = 0;
      while (k < L.length) {
        const sig = L[k].b.join(','); let e = k + 1; while (e < L.length && L[e].pos === L[e - 1].pos + 1 && L[e].b.join(',') === sig) e++;
        const p0 = L[k].pos, p1 = L[e - 1].pos + 1, bb = L[k].b;
        for (let j = 0; j < bb.length; j += 3) {
          const y0 = bb[j] * P, y1 = bb[j + 1] * P, [r, g, bl] = rgb(bb[j + 2]), l = line * P, a = p0 * P, c = p1 * P;
          B.quad(dir < 2 ? [l, y0, a, l, y0, c, l, y1, c, l, y1, a] : [a, y0, l, c, y0, l, c, y1, l, a, y1, l], NX[dir], 0, NZ[dir], r, g, bl, 0);
        }
        k = e;
      }
    }
    // things whose foot stands in this chunk
    for (const th of things) { const px = th.x * PPU, pz = th.z * PPU; if (px < x0 || px >= x0 + w || pz < z0 || pz >= z0 + h) continue; const o = Object.assign({}, th.o); if (o.y === undefined) o.y = groundY(th.x, th.z) + (o.dy || 0); put(th.s, th.x, th.z, o); }
    // baked light, meshes
    B.bakeLamps(lampLight); S.bakeLamps(lampLight);
    const gPack = new Uint8Array(w * h * 2);
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) gPack[(z * w + x) * 2 + 1] = Math.min(255, Math.round(lampLight((x0 + x + .5) * P, hPx(x0 + x, z0 + z) * P, (z0 + z + .5) * P, 0, 1, 0) * 127.5));
    const gTex = nearest(new THREE.CanvasTexture(gCan)); gTex.flipY = false; gTex.encoding = THREE.sRGBEncoding;
    const hTex = nearest(new THREE.DataTexture(gPack, w, h, THREE.LuminanceAlphaFormat, THREE.UnsignedByteType)); hTex.unpackAlignment = 1; hTex.needsUpdate = true;
    groundTex = gTex; heightTex = hTex; const matGround = voxelMaterial('ground');
    const staticMesh = new THREE.Mesh(B.geometry(), matStatic); staticMesh.castShadow = staticMesh.receiveShadow = true; staticMesh.frustumCulled = false; group.add(staticMesh);
    const slabMesh = new THREE.Mesh(S.geometry(), matSlab); slabMesh.castShadow = slabMesh.receiveShadow = true; slabMesh.frustumCulled = false; slabMesh.customDepthMaterial = slabDepth; group.add(slabMesh);
    const pos = [], uv = [], idx = [], open = new Map(), rects = [];
    for (let z = 0; z < h; z++) {
      const seen = new Map(); let x = 0;
      while (x < w) { const hh = hPx(x0 + x, z0 + z); let e = x + 1; while (e < w && hPx(x0 + e, z0 + z) === hh) e++; const key = x + ',' + e + ',' + hh, r = open.get(key); if (r && r.z1 === z) { r.z1 = z + 1; seen.set(key, r); } else { const n = { x0: x, x1: e, z0: z, z1: z + 1, h: hh }; rects.push(n); seen.set(key, n); } x = e; }
      open.clear(); for (const [k, v] of seen) open.set(k, v);
    }
    for (const r of rects) { const v = pos.length / 3, y = r.h * P; pos.push((x0 + r.x0) * P, y, (z0 + r.z1) * P, (x0 + r.x1) * P, y, (z0 + r.z1) * P, (x0 + r.x1) * P, y, (z0 + r.z0) * P, (x0 + r.x0) * P, y, (z0 + r.z0) * P); uv.push(r.x0 / w, r.z1 / h, r.x1 / w, r.z1 / h, r.x1 / w, r.z0 / h, r.x0 / w, r.z0 / h); idx.push(v, v + 1, v + 2, v, v + 2, v + 3); }
    const gg = new THREE.BufferGeometry(), nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); gg.setIndex(idx);
    const gm = new THREE.Mesh(gg, matGround); gm.receiveShadow = true; gm.frustumCulled = false; group.add(gm);
    const halos = lampSpots.filter((p) => p.x * PPU >= x0 && p.x * PPU < x0 + w && p.z * PPU >= z0 && p.z * PPU < z0 + h).map((p) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: def.halo || 0xff9440, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })); s.position.set(p.x, p.y, p.z); s.scale.setScalar(p.r); group.add(s); return s; });
    const tris = B.tris + S.tris + idx.length / 3;
    S = prevS; B = prevB;
    return {
      ci, cj, group, halos, tris,
      water(tick) { if (!water.length) return; for (const i of water) put1(i, waterColor(i, tick)); gCtx.putImageData(gImg, 0, 0); gTex.needsUpdate = true; },
      dispose() { scene.remove(group); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== matStatic && o.material !== matSlab) o.material.dispose(); }); gTex.dispose(); hTex.dispose(); matGround.dispose(); },
    };
  }

  /* streaming: the 3 × 3 chunks around the cat stay built (one new chunk per frame), chunks two away are freed */
  const chunks = new Map(), ckey = (i, j) => i + ',' + j;
  const area = { def, id: def.id, name: def.name, W, D, camNorth: def.camNorth, solids, acts, exits, groundY, isWater, blocked, lampLight, tris: 0, buildMs: 0, chunks };
  const want = (x, z) => { const pi = Math.floor(x / (ccw * cell)), pj = Math.floor(z / (cch * cell)), out = []; for (let j = pj - 1; j <= pj + 1; j++) for (let i = pi - 1; i <= pi + 1; i++) if (i >= 0 && j >= 0 && i < NI && j < NJ) out.push([i, j, Math.abs(i - pi) + Math.abs(j - pj)]); return out.sort((a, b) => a[2] - b[2]); };
  const sync = () => { lamps = [...chunks.values()].flatMap((c) => c.halos); area.tris = [...chunks.values()].reduce((a, c) => a + c.tris, 0); };
  area.stream = (x, z, all) => {
    let built = 0;
    for (const [i, j] of want(x, z)) { const k = ckey(i, j); if (chunks.has(k)) continue; chunks.set(k, buildChunk(i, j)); built++; if (!all) break; }
    const pi = Math.floor(x / (ccw * cell)), pj = Math.floor(z / (cch * cell));
    for (const [k, c] of chunks) if (Math.abs(c.ci - pi) > 2 || Math.abs(c.cj - pj) > 2) { c.dispose(); chunks.delete(k); built++; }
    if (built) sync();
  };
  let waterT = 0, waterTick = 0, sunX = -1e9, sunZ = -1e9;
  area.update = (dt, x, z) => {
    area.stream(x, z, false);
    waterT += dt; if (waterT >= .4 && !reduceMotion) { waterT = 0; waterTick++; for (const c of chunks.values()) c.water(waterTick); }
    // the shadow box follows the view in steps of a few shadow texels, so shadows do not shimmer
    const snap = 2 * SHADOW_HALF / 2048 * 8, sx = Math.round(camT.x / snap) * snap, sz = Math.round(camT.z / snap) * snap;
    if (sx !== sunX || sz !== sunZ) { sunX = sx; sunZ = sz; area.sunX = sx; area.sunZ = sz; sun.target.position.set(sx, 0, sz); shadowHold = 3; }
  };
  area.dispose = () => { for (const c of chunks.values()) c.dispose(); chunks.clear(); lamps = []; };
  area.sunX = W / 2; area.sunZ = D / 2;
  Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 160 }); sun.shadow.camera.updateProjectionMatrix();
  area.open = (x, z) => { area.stream(x, z, true); area.buildMs = Math.round(performance.now() - T0); };
  return area;
}
const SHADOW_HALF = 30;

// halo texture for lamps: built once
const haloTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();

// ---- engine/50-actors.js
/* ---------- actors: flat figures from a frame atlas, always facing the camera, feet on the ground ---------- */
// views: { down, up, side } row names of a frames sheet (side faces right; left is the side view mirrored)
// anims: { idle: [frame], walk: [frames] } frame names inside each row
const actors = [];
const casterMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });

function sheetActor(sheet, views, anims, o) {
  const SH = SHEETS[sheet]; if (!SH) throw new Error('actor: sheet "' + sheet + '" is not in the art');
  const first = SH.meta.sprites[views.down + '.' + anims.idle[0]]; if (!first) throw new Error(`actor: frame "${views.down}.${anims.idle[0]}" missing in ${sheet}`);
  const cw = first.w, ch = first.h, [L, U] = first.anchor || [Math.floor(cw / 2), ch];
  const a = Object.assign({ x: 0, z: 0, fx: 0, fz: 1, step: 0, moving: false, probe: new THREE.Vector3(), lampL: { value: 0 } }, o || {});
  a.tex = nearest(new THREE.CanvasTexture(SH.canvas)); a.tex.encoding = THREE.sRGBEncoding;
  const g = new THREE.PlaneGeometry(cw * P, ch * P); g.translate((cw / 2 - L) * P, (U - ch / 2) * P, 0);   // the anchor (feet) at the origin
  const gl = g.clone(), n = gl.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);   // normal up: light does not change when the view turns
  a.mesh = new THREE.Mesh(gl, voxelMaterial('sprite', { map: a.tex, probe: a.probe, lampL: a.lampL, row: new THREE.Vector2(SPR_Y * P, P) }));
  a.mesh.material.side = THREE.DoubleSide; a.mesh.receiveShadow = true;
  a.caster = new THREE.Mesh(g, casterMat); a.caster.castShadow = true;
  a.caster.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: a.tex, alphaTest: .5, side: THREE.DoubleSide });
  scene.add(a.mesh); scene.add(a.caster);

  const frame = (row, name) => SH.meta.sprites[row + '.' + name] || SH.meta.sprites[row + '.' + anims.idle[0]];
  a.pose = () => {
    const side = a.fx * Math.cos(yaw) - a.fz * Math.sin(yaw), toward = a.fx * Math.sin(yaw) + a.fz * Math.cos(yaw);
    const sideView = Math.abs(side) > Math.abs(toward), row = sideView ? views.side : toward > 0 ? views.down : views.up, flip = sideView && side < 0;
    const list = a.moving ? anims.walk : anims.idle, r = frame(row, list[Math.floor(a.step) % list.length]);
    a.tex.repeat.set(r.w / SH.w, r.h / SH.h); a.tex.offset.set(r.x / SH.w, 1 - (r.y + r.h) / SH.h);
    const y = A.groundY(a.x, a.z), sx = Math.sin(cur.az), sz = Math.cos(cur.az);
    a.mesh.position.set(a.x, y, a.z); a.mesh.rotation.y = yaw; a.mesh.scale.set(flip ? -1 : 1, SPR_Y, 1);
    a.caster.position.set(a.x, y, a.z); a.caster.rotation.y = cur.az; a.caster.scale.set(flip ? -1 : 1, 1, 1);
    a.probe.set(a.x + sx * .2, y, a.z + sz * .2); a.lampL.value = A.lampLight(a.x, y + .6, a.z, 0, 1, 0);
  };
  a.dispose = () => { scene.remove(a.mesh); scene.remove(a.caster); a.mesh.geometry.dispose(); a.mesh.material.dispose(); a.caster.customDepthMaterial.dispose(); a.tex.dispose(); actors.splice(actors.indexOf(a), 1); };
  actors.push(a);
  return a;
}

// ---- engine/60-input.js
/* ---------- input: keyboard, touch (stick + buttons) and gamepad feed one set of actions ---------- */
// move: a vector; pressed actions (interact, menu, rotateL, rotateR) are queued once per press, never repeated by a held key
const input = { keys: new Set(), stickX: 0, stickY: 0, padX: 0, padY: 0, queue: [], padPrev: {} };
const KEYMAP = { ' ': 'interact', enter: 'interact', escape: 'menu', q: 'rotateL', e: 'rotateR' };

function inputSetup() {
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k) && !isTyping(e)) e.preventDefault();
    if (e.repeat) return;   // a held key acts once
    input.keys.add(k);
    const act = KEYMAP[k];
    if (act && !(act === 'interact' && document.activeElement && /^(BUTTON|A|INPUT|SELECT)$/.test(document.activeElement.tagName))) input.queue.push(act);
  });
  addEventListener('keyup', (e) => input.keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => { input.keys.clear(); input.stickX = input.stickY = 0; });
  // touch stick
  const st = $('stick'), kn = $('knob'); let id = null;
  const mv = (e) => { const r = st.getBoundingClientRect(); let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2); const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } input.stickX = x; input.stickY = -y; kn.style.transform = `translate(${x * 30}px,${y * 30}px)`; };
  const up = () => { id = null; input.stickX = input.stickY = 0; kn.style.transform = ''; };
  st.addEventListener('pointerdown', (e) => { id = e.pointerId; st.setPointerCapture(id); mv(e); });
  st.addEventListener('pointermove', (e) => { if (e.pointerId === id) mv(e); });
  st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
  document.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', () => input.queue.push(b.dataset.action)));
}
const isTyping = (e) => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

// gamepad: left stick moves; A interacts, Start opens the menu, shoulders turn the view (edge-triggered)
function pollPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : []; const p = pads && [...pads].find(Boolean);
  input.padX = input.padY = 0; if (!p) return;
  const dz = (v) => Math.abs(v) < .2 ? 0 : v;
  input.padX = dz(p.axes[0] || 0); input.padY = -dz(p.axes[1] || 0);
  const edge = (i, act) => { const on = !!(p.buttons[i] && p.buttons[i].pressed); if (on && !input.padPrev[i]) input.queue.push(act); input.padPrev[i] = on; };
  edge(0, 'interact'); edge(9, 'menu'); edge(4, 'rotateL'); edge(5, 'rotateR');
}

// the move vector in screen terms: x right, y up
function moveVector() {
  let x = input.stickX + input.padX, y = input.stickY + input.padY; const k = input.keys;
  if (k.has('a') || k.has('arrowleft')) x -= 1; if (k.has('d') || k.has('arrowright')) x += 1;
  if (k.has('w') || k.has('arrowup')) y += 1; if (k.has('s') || k.has('arrowdown')) y -= 1;
  const l = Math.hypot(x, y); return l > 1 ? [x / l, y / l] : [x, y];
}

// ---- engine/70-ui.js
/* ---------- ui: title, options, dialogue, hint, fade (HTML over the canvas) ---------- */
let dlg = null, actx = null, nearAct = null;
const ui = { screen: 'title' };   // title | game | menu

function blip(f) {
  if (!settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain(), tt = actx.currentTime;
    o.type = 'square'; o.frequency.value = f; g.gain.setValueAtTime(.025, tt); g.gain.exponentialRampToValueAtTime(.0001, tt + .05);
    o.connect(g); g.connect(actx.destination); o.start(tt); o.stop(tt + .06);
  } catch (e) { settings.sound = false; }
}

/* dialogue: lines are language keys; text scrolls with a blip, a press shows the rest, the next press goes on */
function showPage() { const page = dlg.lines[dlg.i], n = Math.min(page.length, Math.floor(dlg.n)); $('dText').textContent = page.slice(0, n); $('dMore').hidden = n < page.length; }
function openDialogue(a) {
  dlg = { lines: (typeof a.lines === 'function' ? a.lines() : a.lines).map((k) => t(k)), i: 0, n: reduceMotion ? 1e9 : 0, voice: a.voice || 330, last: 0 };
  $('dWho').textContent = t(a.name); $('dialog').hidden = false; showPage();
}
function advance() {
  if (!dlg) { if (nearAct) openDialogue(nearAct); return; }
  const page = dlg.lines[dlg.i];
  if (dlg.n < page.length) dlg.n = page.length; else if (++dlg.i < dlg.lines.length) dlg.n = reduceMotion ? 1e9 : 0; else { dlg = null; $('dialog').hidden = true; return; }
  showPage();
}
function tickDialogue(dt) {
  if (!dlg) return; const page = dlg.lines[dlg.i];
  if (dlg.n < page.length) { dlg.n += dt * 42; const n = Math.floor(dlg.n); if (n !== dlg.last) { dlg.last = n; if (n % 2 === 0 && page[n - 1] !== ' ') blip(dlg.voice); showPage(); } }
}

let hintState = null;
function setHint(a) {
  const key = a ? 'z:' + a.label : 'base';
  if (key === hintState) return; hintState = key;
  $('hint').textContent = a ? t(coarse ? 'hint.act.touch' : 'hint.act', { what: t(a.label) }) : t(coarse ? 'hint.touch' : 'hint.keys');
}

/* options: language, frame-rate cap, shadows, sound; stored as preferences */
function optionsSetup() {
  const seg = (id, val, apply) => document.querySelectorAll(`#${id} button`).forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.v === String(val())));
    b.onclick = () => { apply(b.dataset.v); saveSettings(); document.querySelectorAll(`#${id} button`).forEach((o) => o.setAttribute('aria-pressed', String(o === b))); };
  });
  seg('optLang', () => settings.lang, (v) => { settings.lang = v; applyLang(); hintState = null; if (A) $('areaName').textContent = t(A.name); });
  seg('optFps', () => settings.fps, (v) => { settings.fps = +v; });
  seg('optShadows', () => settings.shadows ? 'on' : 'off', (v) => { settings.shadows = v === 'on'; sun.castShadow = settings.shadows; shadowHold = 3; });
  seg('optSound', () => settings.sound ? 'on' : 'off', (v) => { settings.sound = v === 'on'; });
}
function openMenu(on) {
  ui.screen = on ? 'menu' : 'game'; $('menu').hidden = !on;
  if (on) { const f = $('menu').querySelector('button'); if (f) f.focus({ preventScroll: true }); } else canvas.focus({ preventScroll: true });
}

/* fade between areas: out, swap, in */
function fade(to) { const f = $('fade'); f.style.opacity = to; return new Promise((ok) => setTimeout(ok, reduceMotion ? 0 : 260)); }

// ---- engine/80-loop.js
/* ---------- loop: simulation at a fixed 120 Hz, drawing capped at the chosen 30 / 60 / 120 fps ---------- */
const SIM = 1 / 120;
let player = null, shadowHold = 8, time = 0, intro = 1, transitioning = false;
let last = performance.now(), acc = 0, drawAcc = 0, frames = 0, fpsT = 0, fps = 0, calls = 0;
const rotate = (d) => { yawT = Math.round(yawT / (Math.PI / 2)) * (Math.PI / 2) + d * Math.PI / 2; };

function enterArea(name, at, face) {
  const def = AREAS[name]; if (!def) throw new Error('no area "' + name + '"');
  if (A) A.dispose();
  A = openArea(def);
  player.x = at ? at[0] : def.start[0]; player.z = at ? at[1] : def.start[1];
  A.open(player.x, player.z);
  if (face) { player.fx = face[0]; player.fz = face[1]; }
  tod = Math.max(0, TODS.findIndex((x) => x.label === (def.tod || 'giorno'))); applyTod(1);
  const [tx, tz] = camGoal(Math.max(VT, minV())); camT.set(tx, A.groundY(player.x, player.z) * .5, tz);
  $('areaName').textContent = t(def.name); hintState = null; shadowHold = 8; dlg = null; $('dialog').hidden = true;
}
async function goTo(exit) {
  transitioning = true; player.moving = false;
  await fade(1); enterArea(exit.to, exit.at, exit.face); await fade(0);
  transitioning = false;
}

function step(dt) {
  while (input.queue.length) {
    const act = input.queue.shift();
    if (act === 'menu') { if (ui.screen === 'game') openMenu(true); else if (ui.screen === 'menu') openMenu(false); continue; }
    if (ui.screen !== 'game' || transitioning) continue;
    if (act === 'interact') advance(); else if (act === 'rotateL') rotate(-1); else if (act === 'rotateR') rotate(1);
  }
  if (ui.screen !== 'game' || transitioning || !A) { if (player) player.moving = false; return; }
  const [ix, iy] = moveVector(), il = Math.hypot(ix, iy);
  if (il > .15 && !dlg) {
    const mx = Math.cos(yaw) * ix - Math.sin(yaw) * iy, mz = -Math.sin(yaw) * ix - Math.cos(yaw) * iy, spd = 9.6 * dt;   // the owner asked for 3x the first 3.2 units/s
    if (!A.blocked(player.x + mx * spd, player.z, player.x, player.z)) player.x += mx * spd;
    if (!A.blocked(player.x, player.z + mz * spd, player.x, player.z)) player.z += mz * spd;
    const l = Math.hypot(mx, mz); player.fx = mx / l; player.fz = mz / l; player.step += dt * 18 * Math.min(1, il); player.moving = true;
  } else { player.moving = false; player.step = 0; }
  for (const ex of A.exits) { const [x0, z0, x1, z1] = ex.rect; if (player.x >= x0 && player.x <= x1 && player.z >= z0 && player.z <= z1) { goTo(ex); break; } }
  nearAct = null; let best = 1e9;
  for (const a of A.acts) { const d = Math.hypot(a.x - player.x, a.z - player.z); if (d < a.r && d < best) { best = d; nearAct = a; } }
  tickDialogue(dt);
}

function draw(dt) {
  time += dt;
  if (!A) { renderer.setRenderTarget(null); renderer.setClearColor(0x17121c, 1); renderer.clear(); return; }
  setHint(dlg ? null : nearAct);
  if (intro < 1) { intro = Math.min(1, intro + dt / 2.8); const e = 1 - Math.pow(1 - intro, 3); yaw = yawT + (1 - e) * -1.05; Vz = lerp(28, VT, e); }
  else { yaw += (yawT - yaw) * (1 - Math.exp(-dt * 9)); Vz += (VT - Vz) * (1 - Math.exp(-dt * 8)); }
  const vv = Math.max(Vz, minV()), [tx, tz] = camGoal(vv), kf = 1 - Math.exp(-dt * 5);
  camT.x += (tx - camT.x) * kf; camT.z += (tz - camT.z) * kf; camT.y += (A.groundY(player.x, player.z) * .5 - camT.y) * kf;
  setCamera();
  for (const a of actors) a.pose();
  applyTod(1 - Math.exp(-dt * 2.2));
  A.update(dt, player.x, player.z);
  if (player.moving || dlg || Math.abs(yaw - yawT) > 1e-3 || Math.abs(cur.az - TODS[tod].az) + Math.abs(cur.el - TODS[tod].el) > 1e-4) shadowHold = 3;
  if (shadowHold > 0) { shadowHold--; sun.shadow.needsUpdate = true; }
  postU.uTime.value = time; postU.uStars.value = cur.stars; postU.uBgTop.value.set(cur.top[0], cur.top[1], cur.top[2]); postU.uBgBot.value.set(cur.bot[0], cur.bot[1], cur.bot[2]);
  renderer.info.reset();
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam);
  calls = renderer.info.render.calls;
  renderer.setRenderTarget(null); renderer.render(postScene, postCam);
}

function frame(now) {
  requestAnimationFrame(frame);
  const real = Math.min(.25, (now - last) / 1000); last = now;
  if (document.hidden) return;
  pollPad();
  acc += real; let n = 0; while (acc >= SIM && n < 30) { step(SIM); acc -= SIM; n++; } if (n === 30) acc = 0;
  // the cap keeps its phase: on a 144 Hz screen a 60 cap draws 60 times a second, not every third refresh
  drawAcc += real; const budget = 1 / settings.fps; if (drawAcc + .002 < budget) return; drawAcc = Math.max(0, drawAcc - budget); if (drawAcc > budget) drawAcc = 0;
  draw(budget);
  frames++; fpsT += budget;
  if (fpsT >= .5) { fps = frames / fpsT; frames = 0; fpsT = 0; if (!$('menu').hidden) $('diag').textContent = t('diag', { fps: Math.round(fps), ms: (1000 / Math.max(1, fps)).toFixed(1), tris: Math.round((A ? A.tris : 0) / 1000), calls: calls + 1, build: A ? A.buildMs : 0 }); }
}

// ---- content/chapter1/areas/interiors.js
/* ---------- interiors: separate scenes entered through a door; a low front wall lets the camera look in ---------- */
// legend: W = back and side walls (tall), V = the front wall (low), o = floor; the doorway is a gap in the front wall
const room = (cols, rows, door) => Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => {
  if (r === rows - 1) return Math.abs(c - door) <= 1 ? 'o' : 'V';
  return c === 0 || c === cols - 1 || r === 0 ? 'W' : 'o';
}).join(''));
const INTERIOR_LEGEND = { o: { tile: 'wood_planks' }, W: { tile: 'crypt_floor', h: 48, wall: 0x6e5a48 }, V: { tile: 'crypt_floor', h: 6, wall: 0x6e5a48 } };

// the library: shelves of the cat's own codex, the reading desk where the page went missing
AREAS.library_in = {
  id: 'library_in', name: 'area.library', cell: 2, tod: 'interno', start: [13, 13.4], camNorth: 1,
  legend: INTERIOR_LEGEND, map: room(12, 8, 6),
  things: [['reading_desk', 13, 7.6], ['statue', 5, 4.6], ['chest', 19.6, 5], ['crate', 4.4, 11.6], ['barrel', 19.8, 11.4], ['bench', 13, 4.4]],
  lamps: [[6, 3, 8, 3, 1.2], [18, 3, 8, 3, 1.2]],
  exits: [{ rect: [10, 15.2, 16, 16], to: 'overworld', at: [32, 35.6], face: [0, 1] }],
};

// the bakery: barrels of flour, the counter (a market stall indoors)
AREAS.bakery_in = {
  id: 'bakery_in', name: 'area.bakery', cell: 2, tod: 'interno', start: [11, 11.4], camNorth: 1,
  legend: INTERIOR_LEGEND, map: room(10, 7, 5),
  things: [['market_stall', 11, 6], ['barrel', 4, 4.6], ['barrel', 5.6, 4.6], ['crate', 16, 9.6], ['chest', 16, 4.6]],
  lamps: [[10, 3, 7, 3, 1.3]],
  exits: [{ rect: [8, 13.2, 14, 14], to: 'overworld', at: [45, 35.6], face: [0, 1] }],
};

// ---- content/chapter1/areas/overworld.js
/* ---------- the open world of Chapter 1: one map ringed by cliff plateaus, built in chunks around the cat ---------- */
// 64 × 48 cells of 2 units (one 32 px tile each): the village square with the library, bakery and shop, the church
// to the north, the road east to the vineyards and the windmill, a pond to the south.
AREAS.overworld = (() => {
  const C = 64, RW = 48, m = Array.from({ length: RW }, () => Array(C).fill('g'));
  const fill = (c0, r0, c1, r1, ch) => { for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (r >= 0 && c >= 0 && r < RW && c < C) m[r][c] = ch; };
  // grass with patches of flowers
  for (let r = 0; r < RW; r++) for (let c = 0; c < C; c++) if (hash2(c >> 1, r >> 1) > .82 && hash2(c * 5, r * 3) > .35) m[r][c] = 'f';
  // the cliff plateaus all around, a little uneven, so the view never reaches the edge of the world
  const band = (side, k) => 8 + Math.round(hash2(side * 17 + (k >> 2), side) * 2);   // each side's depth wavers every 4 cells
  for (let r = 0; r < RW; r++) for (let c = 0; c < C; c++)
    if (r < band(0, c) || RW - 1 - r < band(1, c) || c < band(2, r) || C - 1 - c < band(3, r)) m[r][c] = hash2(c * 7, r * 3) > .8 ? 'Y' : 'X';
  fill(14, 15, 29, 26, 'c');                 // the village square
  fill(19, 10, 26, 13, 'c'); fill(21, 13, 22, 14, 'c');   // the church plaza and its steps down
  fill(30, 20, 54, 21, 'p');                 // the road east
  fill(36, 11, 46, 17, 'a');                 // the vineyard fields
  fill(10, 20, 13, 21, 'p');                 // a path west, toward the houses
  for (let r = 29; r <= 37; r++) for (let c = 27; c <= 39; c++) if (((c - 33) / 5) ** 2 + ((r - 33) / 3.6) ** 2 < 1) m[r][c] = 'w';   // the pond
  const map = m.map((r) => r.join(''));

  // trees: a few on the grass, more on the plateau tops; never on roads, water or near buildings
  const things = [
    ['library', 32, 31.5, undefined, undefined, { door: { to: 'library_in', at: [13, 13.4], face: [0, -1] } }],
    ['bakery', 45, 31.5, undefined, undefined, { door: { to: 'bakery_in', at: [11, 11.4], face: [0, -1] } }],
    ['shop', 56.5, 31.5],
    ['house_a', 22, 37], ['house_b', 20, 50.5],
    ['church', 45, 21],
    ['windmill', 101, 25], ['vine_row', 78, 26], ['vine_row', 88, 26], ['vine_row', 78, 31.5], ['vine_row', 88, 31.5],
    ['well', 44, 44], ['market_stall', 53, 47], ['bench', 36, 48.5], ['reading_desk', 37.5, 36.6],
    ['lamp_post', 38, 39, .2, .2], ['lamp_post', 50, 39, .2, .2], ['lamp_post', 38, 51, .2, .2], ['lamp_post', 50, 51, .2, .2],
    ['signpost', 62, 38.6], ['barrel', 59.4, 37.6], ['crate', 60.8, 38.2], ['statue', 44, 27.6],
    ['fence', 72, 36.6], ['fence', 74.6, 36.6], ['fence', 77.2, 36.6], ['fence', 92, 36.6], ['fence', 94.6, 36.6],
  ];
  const busy = [[26, 26, 64, 56], [36, 14, 56, 30], [70, 18, 108, 38], [58, 38, 112, 46], [52, 56, 80, 76], [14, 34, 30, 58], [18, 38, 28, 44]];
  const free = (x, z) => !busy.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
  const kinds = ['oak', 'olive', 'cypress', 'bush'];
  for (let r = 1; r < RW - 1; r++) for (let c = 1; c < C - 1; c++) {
    const ch = map[r][c], x = c * 2 + 1, z = r * 2 + 1, h = hash2(c * 13, r * 29);
    if ((ch === 'g' || ch === 'f') && h > .955 && free(x, z)) { const k = kinds[Math.floor(hash2(c, r * 7) * 4)]; things.push([k, x, z, k === 'bush' ? undefined : .6, k === 'bush' ? undefined : .5]); }
    else if (ch === 'X' && h > .9) { const inner = Math.min(c, C - 1 - c, r, RW - 1 - r) >= 6; if (inner) things.push([hash2(c * 3, r) > .5 ? 'cypress' : 'olive', x, z, 0, 0]); }
  }
  return {
    id: 'overworld', name: 'area.village', cell: 2, chunk: [16, 12], tod: 'giorno', start: [44, 49], camNorth: 1.5,
    legend: { g: { tile: 'grass' }, f: { tile: 'grass_flowers' }, c: { tile: 'cobblestone' }, p: { tile: 'dirt_path' }, a: { tile: 'farmland' },
      w: { tile: 'water', water: true, h: -3 }, X: { tile: 'grass', h: 56, cliff: true }, Y: { tile: 'grass_flowers', h: 56, cliff: true } },
    map, things,
    lamps: [[38, 2.6, 39], [50, 2.6, 39], [38, 2.6, 51], [50, 2.6, 51]],
  };
})();

// ---- engine/90-boot.js
/* ---------- boot: art, atlas, materials, title screen; the game starts on New game ---------- */
const START = { area: 'overworld', at: null };

function startGame() {
  $('title').hidden = true; ui.screen = 'game';
  if (!player) player = sheetActor('cat', { down: 'cat_down', up: 'cat_up', side: 'cat_side' }, { idle: ['idle'], walk: ['walk1', 'walk2', 'walk3', 'walk4', 'walk5'] });
  enterArea(START.area, START.at);
  intro = reduceMotion ? 1 : 0;
  canvas.focus({ preventScroll: true });
}

(async function boot() {
  applyLang();
  if (!renderer) { $('fallback').hidden = false; return; }
  inputSetup(); optionsSetup();
  try { await loadArt(); } catch (e) { $('fallback').textContent = e.message; $('fallback').hidden = false; return; }
  buildSprites(); makeAtlasTextures(); makeMaterials();
  new ResizeObserver(resize).observe(canvas); resize();
  $('bStart').onclick = startGame;
  $('bOptions').onclick = () => { $('menu').hidden = false; ui.screen = 'menu-title'; $('menu').querySelector('button').focus({ preventScroll: true }); };
  $('bResume').onclick = () => { if (ui.screen === 'menu-title') { $('menu').hidden = true; ui.screen = 'title'; $('bStart').focus({ preventScroll: true }); } else openMenu(false); };
  // drag turns the view, the wheel zooms (as in the dioramas)
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX }; canvas.setPointerCapture(e.pointerId); canvas.focus({ preventScroll: true }); });
  canvas.addEventListener('pointermove', (e) => { if (!drag || drag.id !== e.pointerId) return; const dx = e.clientX - drag.x; drag.x = e.clientX; yawT -= dx * .007; yaw = yawT; });
  const endDrag = (e) => { if (drag && drag.id === e.pointerId) { drag = null; yawT = Math.round(yawT / (Math.PI / 2)) * (Math.PI / 2); } };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); VT = clamp(VT * Math.exp(e.deltaY * .0012), 7, 26); }, { passive: false });
  $('title').hidden = false; $('bStart').focus({ preventScroll: true });
  requestAnimationFrame(frame);
  // read-only hooks for the headless checks
  window.__game = {
    state: () => ({ screen: ui.screen, area: A && A.def.id, x: player && player.x, z: player && player.z, fps, tris: A && A.tris, buildMs: A && A.buildMs, sprites: SPRITES.length }),
    start: () => startGame(),
    place: (x, z) => { player.x = x; player.z = z; },
    walk: (x, y) => { input.stickX = x; input.stickY = y; },
    area: () => A,
  };
})();
})();
