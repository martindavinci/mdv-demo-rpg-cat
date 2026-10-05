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
let R = rng(4071);   // gameplay randomness; the checks reseed it for repeatable runs
const reseed = (n) => { R = rng(n); };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const shade = (c, k) => (Math.min(255, Math.round((c >> 16 & 255) * k)) << 16) | (Math.min(255, Math.round((c >> 8 & 255) * k)) << 8) | Math.min(255, Math.round((c & 255) * k));

// settings are preferences only (never game content): language, frame-rate cap, shadows, shake, music and sound volume (0–3)
const SETTINGS_KEY = 'mdv-rpg-cat-settings';   // mdv-allow-storage: preferences
const settings = Object.assign({ lang: (navigator.language || 'en').toLowerCase().startsWith('it') ? 'it' : 'en', fps: 60, shadows: true, shake: true, music: 2, sound: 2 },
  (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } })());
if (typeof settings.sound === 'boolean') settings.sound = settings.sound ? 2 : 0;   // the first builds stored on/off
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
    const chest = DEFS.find((d) => d.key === 'chest'); if (chest) DEFS.push({ key: 'chest_open', name: 'chest_open', sheet: chest.sheet, pic: openChest(chest.pic) });
  });
}

const crop = (S, r) => { const out = new Uint8ClampedArray(r.w * r.h * 4); for (let y = 0; y < r.h; y++) out.set(S.px.subarray(((r.y + y) * S.w + r.x) * 4, ((r.y + y) * S.w + r.x + r.w) * 4), y * r.w * 4); return out; };
const b64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

// an open chest, drawn from the closed one (no art was made for it): the body (rows 11 down) stays; the lid's lower band
// becomes the front lip of the opening, with the dark inside above it; the lid's dome, in 8 rows, stands at
// the back, swung open, seen from behind: no lock, and much darker (45 %), since it faces away from the light. Row numbers fit the
// chest of props-1 (24 × 21, lid rows 0-10); the sheet's manifest names it, so a redrawn chest needs a fresh look here.
function openChest(p) {
  const { w, h } = p, LID = 8, GAP = 3, SEAM = 10, top = h - (h - SEAM - 1) - GAP - LID, n = w * h;
  const c = new Int32Array(n).fill(-1), f = new Int8Array(n), b = new Int8Array(n), fl = new Uint8Array(n);
  const at = (x, y) => y * w + x, on = (x, y) => x >= 0 && x < w && p.c[at(x, y)] >= 0;
  const set = (x, y, col, fr, bk, g) => { const i = at(x, y); c[i] = col; f[i] = fr; b[i] = Math.min(bk, fr - 1); fl[i] = g || 0; };
  const dark = (col, k) => (Math.round((col >> 16 & 255) * k) << 16) | (Math.round((col >> 8 & 255) * k) << 8) | Math.round((col & 255) * k);
  for (let y = SEAM + 1; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) { const i = at(x, y); set(x, y, p.c[i], p.f[i], p.b[i], p.fl[i]); }   // the body
  const lipY = top + LID + GAP - 1, backB = (x) => p.b[at(x, SEAM + 1)];
  for (let x = 0; x < w; x++) if (on(x, SEAM)) { const i = at(x, SEAM); set(x, lipY, p.c[i], p.f[i], p.f[i] - 2); }   // the front lip: a thin rim, so from above the mouth shows dark
  for (let k = 0; k < GAP - 1; k++) for (let x = 0; x < w; x++) {   // the inside, darkest at the back; its side walls in the band's colour
    if (!on(x, SEAM)) continue; const side = !on(x - 1, SEAM) || !on(x + 1, SEAM) || x < 2 || x > w - 3, i = at(x, SEAM);
    // above luminance 42: darker pixels lend their sides and tops the nearest bright colour (Spr.finish), which here was gold
    const col = side ? dark(p.c[i], .8) : ((60 + k * 12) << 16) | ((40 + k * 8) << 8) | (30 + k * 4);
    set(x, top + LID + k, col, side ? p.f[i] : p.f[i] - 2, backB(x));
  }
  for (let y = 0; y < LID; y++) {   // the lid, standing at the back
    const src = Math.round(y * (SEAM - 1) / (LID - 1));
    for (let x = 0; x < w; x++) {
      if (!on(x, src)) continue; const lock = x >= 9 && x <= 14 && src >= 6, i = at(lock ? (x < 12 ? 5 : 18) : x, src);   // the lock, covered with plain plank
      if (p.c[i] < 0) continue; const bb = backB(x) || p.b[i]; set(x, top + y, dark(p.c[i], .45), bb + 3, bb);
    }
  }
  return { w, h, d: p.d, c, f, b, fl };
}

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
  cripta: { sun: 0x8a90c0, sunI: .12, az: -.4, el: 1.2, sky: 0x40405a, gnd: 0x141018, hemiI: .4, glow: 1, lamp: 1.8, top: 0x07060a, bot: 0x120e16, stars: 0, aur: 0 },
  interno: { sun: 0xffd9a0, sunI: .35, az: -.4, el: 1.1, sky: 0x9a7a5a, gnd: 0x3a2a20, hemiI: .62, glow: .9, lamp: 1.3, top: 0x0e0a0c, bot: 0x221816, stars: 0, aur: 0 },
  notte: { sun: 0x9cb6ff, sunI: .45, az: .6, el: 1.0, sky: 0x6a8cbc, gnd: 0x283654, hemiI: .5, glow: 1, lamp: 1.5, top: 0x04070f, bot: 0x101a30, stars: 1, aur: 0 },
};
let tod = 1, lamps = [];   // lamps: halo sprites of the current area
const TODS = ['alba', 'giorno', 'tramonto', 'notte', 'interno', 'cripta'].map((label) => {
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
const minV = () => 13 / aspect;   // a phone held upright still sees 13 units across
function camGoal(vv) {
  if (A.W > 48 || A.D > 40) {   // the open world: follow the cat, but never show past the map's edge
    const k = aspect < .8 ? vv * .12 : 0;   // upright phones: the cat sits above the thumbs
    const x = player.x + Math.sin(yaw) * k, z = player.z - (A.camNorth || 1.5) + Math.cos(yaw) * k;
    const hz = vv / Math.sin(PITCH) / 2, hx = vv * aspect / 2, c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw)), ex = hx * c + hz * sn, ez = hz * c + hx * sn;
    return [clamp(x, Math.min(ex, A.W / 2), Math.max(A.W - ex, A.W / 2)), clamp(z, Math.min(ez, A.D / 2), Math.max(A.D - ez, A.D / 2))];
  }
  const W = A.W, D = A.D, f = clamp(1.45 - vv / 26, .4, .9); return [W / 2 + (player.x - W / 2) * f, D / 2 - (A.camNorth || 1.5) + (player.z - D / 2) * f * .6]; }
// the ground the view covers, as a box in world x/z: [x0, z0, x1, z1]. In view terms it grows by side units left and
// right, far units away from the camera and near units toward it (a tall tree standing below the view's bottom edge
// still reaches into it: a 7-unit tree up to 10 units out).
function viewFoot(side, far, near) {
  const vv = Math.max(Vz, VT, minV()), hz = vv / Math.sin(PITCH) / 2, hx = vv * aspect / 2;
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), tx = Math.sin(yaw), tz = Math.cos(yaw);   // screen right; toward the camera
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const a of [-(hx + side), hx + side]) for (const b of [-(hz + far), hz + near]) {
    const x = camT.x + rx * a + tx * b, z = camT.z + rz * a + tz * b; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return [x0, z0, x1, z1];
}
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
//        lamps: [[x, y, z, r, k]], exits: [{ rect: [x0, z0, x1, z1], to, at, face }], solids, start, tod, camNorth,
//        keep: build every chunk on entry and keep the area built while the cat is elsewhere (no streaming, no hitch) }
const AREAS = {};
let A = null;   // the current area

function openArea(def) {
  const T0 = performance.now(), cell = def.cell || 2, cellPx = cell * PPU, rows = def.map.length, cols = def.map[0].length;
  const W = cols * cell, D = rows * cell, PXW = cols * cellPx, PXD = rows * cellPx;
  const keys = Object.keys(def.legend), GT = keys.map((k) => Object.assign({ h: 0 }, def.legend[k], { tex: TILES[def.legend[k].tile] }));
  for (const g of GT) if (!g.tex) throw new Error(`area ${def.id}: tile "${g.tile}" is not in the art`);
  const typeOf = new Map(keys.map((k, i) => [k, i]));
  // the map's cell types and heights as flat arrays: these are read for every ground pixel, many times over
  const cellT = new Uint8Array(cols * rows), cellH = new Int16Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const t = typeOf.get(def.map[r][c]); cellT[r * cols + c] = t === undefined ? 0 : t; cellH[r * cols + c] = GT[cellT[r * cols + c]].h; }
  const cellIdx = (x, z) => { let c = Math.floor(x / cellPx), r = Math.floor(z / cellPx); c = c < 0 ? 0 : c >= cols ? cols - 1 : c; r = r < 0 ? 0 : r >= rows ? rows - 1 : r; return r * cols + c; };
  const cellType = (c, r) => cellT[clamp(r, 0, rows - 1) * cols + clamp(c, 0, cols - 1)];
  const tyPx = (x, z) => cellT[cellIdx(x, z)];
  const hPx = (x, z) => cellH[cellIdx(x, z)];
  const groundY = (x, z) => hPx(Math.floor(x * PPU), Math.floor(z * PPU)) * P;
  const isWater = (x, z) => !!GT[tyPx(Math.floor(x * PPU), Math.floor(z * PPU))].water;
  const tilePx = (g, x, z) => { const tw = g.tex.w, th = g.tex.h, o = ((((z % th) + th) % th) * tw + (((x % tw) + tw) % tw)) * 4, p = g.tex.px; return (p[o] << 16) | (p[o + 1] << 8) | p[o + 2]; };
  const avg = (g) => { if (g.avg !== undefined) return g.avg; let r = 0, gg = 0, b = 0; const p = g.tex.px, n = p.length / 4; for (let o = 0; o < p.length; o += 4) { r += p[o]; gg += p[o + 1]; b += p[o + 2]; } return (g.avg = (Math.round(r / n) << 16) | (Math.round(gg / n) << 8) | Math.round(b / n)); };
  const nearOther = (x, z, test) => test(tyPx(x - 1, z)) || test(tyPx(x + 1, z)) || test(tyPx(x, z - 1)) || test(tyPx(x, z + 1));

  /* lamps, solids, things, doors and places to look at: global, computed once */
  const lampSpots = (def.lamps || []).map(([x, y, z, r, k]) => ({ x, y, z, r: r || 2.4, k: k || 1, halo: true }));
  function lampLight(x, y, z, nx, ny, nz, list) {
    let L = 0;
    for (const p of list || lampSpots) { const lx = p.x - x, ly = p.y - y, lz = p.z + .3 - z, d = Math.hypot(lx, ly, lz); if (d >= 6.5 || d < 1e-4) continue; const ndl = (nx * lx + ny * ly + nz * lz) / d; if (ndl > 0) L += Math.pow(1 - d / 6.5, 1.6) * ndl * p.k; }
    return L;
  }
  const solids = [], acts = [], exits = (def.exits || []).slice(), things = [];
  const solid = (x0, z0, x1, z1) => solids.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });
  for (const [key, x, z, hx0, hz0, o0] of def.things || []) {
    if (o0 && o0.when && !o0.when()) continue;   // a thing that exists only in some states of the story (a closed gate)
    const s = sp[key]; if (!s) throw new Error(`area ${def.id}: sprite "${key}" is not in the art`);
    const o = Object.assign({}, o0 || {}), d = AP.sprites[key].d || 8;
    let hx = hx0, hz = hz0; if (hx === undefined) { hx = Math.max(.1, s.w * P / 2 - .15); hz = Math.max(.1, d * P / 2 - .15); }
    const px = Math.round(x * PPU) / PPU, pz = Math.round(z * PPU) / PPU;
    if (hx) { const sw = (o.rot || 0) % 2 ? [hz, hx] : [hx, hz]; solid(px - sw[0], pz - sw[1], px + sw[0], pz + sw[1]); }
    if (o.door) { const fz = pz + d * P / 2; exits.push({ rect: [px - .9, fz, px + .9, fz + .7], to: o.door.to, at: o.door.at, face: o.door.face || [0, -1], need: o.door.need }); }
    if (o.look) acts.push({ x: px, z: pz + d * P / 2 + .6, r: 1.4, label: o.look.label, name: o.look.name, lines: o.look.lines });
    things.push({ s, x, z, o });
  }
  for (const [x0, z0, x1, z1] of def.solids || []) solid(x0, z0, x1, z1);

  // walking: map edges, solids, water (not for fliers) and steps higher than def.step art pixels block
  const STEP = (def.step || 3.5) * P;
  const inSolid = (x, z, r) => { for (const s of solids) if (x > s.x0 - r && x < s.x1 + r && z > s.z0 - r && z < s.z1 + r) return true; return false; };
  function blocked(x, z, fromX, fromZ, fly) {
    const r = .3; if (x < r || z < r || x > W - r || z > D - r) return true;
    if (inSolid(x, z, r)) return true;
    for (const [a, b] of [[-.22, 0], [.22, 0], [0, -.18], [0, .18]]) { if (!fly && isWater(x + a, z + b)) return true; if (fromX !== undefined && Math.abs(groundY(x + a, z + b) - groundY(fromX, fromZ)) > STEP) return true; }
    return false;
  }
  // a blow or a look passes between two points unless a wall, a step up or a solid thing stands between them
  function clear(x0, z0, x1, z1) {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / .25), y0 = groundY(x0, z0);
    for (let i = 1; i < n; i++) { const x = lerp(x0, x1, i / n), z = lerp(z0, z1, i / n); if (groundY(x, z) - y0 > STEP || inSolid(x, z, 0)) return false; }
    return true;
  }

  /* one chunk: ground texture and mesh, walls, the things standing in it, baked light, halos */
  const [ccw, cch] = def.chunk || [cols, rows], CW = ccw * cellPx, CH = cch * cellPx, NI = Math.ceil(cols / ccw), NJ = Math.ceil(rows / cch);
  const wallCol = (t, a, y) => { const g = GT[t]; if (g.cliff) return edgeCol(t, a, y, g.h); const c = g.wall !== undefined ? g.wall : shade(avg(g), .62); return (Math.floor(y / 4) + Math.floor(a / 8)) % 2 ? c : shade(c, .9); };
  const STRATA = [0x6b4a32, 0x5e4230, 0x6f5238, 0x52392a];
  const edgeCol = (t, k, y, top) => top - y <= 2 ? shade(avg(GT[t]), .8) : STRATA[Math.floor((top - y + (k % 7)) / 7) % STRATA.length];
  // every drop too tall to walk is drawn on the ground: a light lip along the top, a dark line at the foot. From the
  // default view the cliff faces turned away from the camera cannot be seen, and both levels wear the same grass.
  const DROP = STEP * PPU, N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const mix = (c, d, k) => (Math.round((c >> 16 & 255) * (1 - k) + (d >> 16 & 255) * k) << 16) | (Math.round((c >> 8 & 255) * (1 - k) + (d >> 8 & 255) * k) << 8) | Math.round((c & 255) * (1 - k) + (d & 255) * k);
  const edgeShade = (gx, gz, c) => {
    const ex = ((gx % cellPx) + cellPx) % cellPx, ez = ((gz % cellPx) + cellPx) % cellPx;
    if (ex > 2 && ex < cellPx - 3 && ez > 2 && ez < cellPx - 3) return c;   // heights change only between cells
    const hh = hPx(gx, gz); let lip = 0, foot = 0;
    for (const [a, b] of N4) for (let d = 1; d <= 3; d++) {
      const nx = gx + a * d, nz = gz + b * d, n = hPx(nx, nz);
      if (d <= 2 && hh - n > DROP && !GT[tyPx(nx, nz)].water) lip = Math.max(lip, 3 - d);   // 2 at the edge, 1 a pixel in
      if (n - hh > DROP) foot = Math.max(foot, 4 - d);                                        // 3 at the foot, fading out
    }
    if (lip) return lip === 2 ? mix(c, 0xf2eeb4, .6) : mix(c, 0xf2eeb4, .28);
    return foot ? shade(c, [1, .8, .62, .42][foot]) : c;
  };
  function buildChunk(ci, cj) {
    const x0 = ci * CW, z0 = cj * CH, w = Math.min(CW, PXW - x0), h = Math.min(CH, PXD - z0);
    const group = new THREE.Group(); scene.add(group);
    // only the lamps that reach into this chunk (a lamp lights 6.5 units; things may lean a few units out of the chunk)
    const near = lampSpots.filter((p) => p.x > x0 * P - 10 && p.x < (x0 + w) * P + 10 && p.z > z0 * P - 10 && p.z < (z0 + h) * P + 10);
    const chunkLight = near.length ? (x, y, z, nx, ny, nz) => lampLight(x, y, z, nx, ny, nz, near) : () => 0;
    const prevS = S, prevB = B; S = new SlabBuilder(8000); B = new Builder(8000);
    // ground pixels
    const gCan = document.createElement('canvas'); gCan.width = w; gCan.height = h;
    const gCtx = gCan.getContext('2d'), gImg = gCtx.createImageData(w, h), water = [], foam = new Uint8Array(w * h);
    const put1 = (i, c) => { gImg.data[i * 4] = c >> 16 & 255; gImg.data[i * 4 + 1] = c >> 8 & 255; gImg.data[i * 4 + 2] = c & 255; gImg.data[i * 4 + 3] = 255; };
    const waterColor = (i, tick) => { const x = x0 + i % w, z = z0 + ((i / w) | 0); return foam[i] && (x + z + tick) % 3 ? 0xd8eef0 : tilePx(GT[tyPx(x, z)], x + tick, z); };
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      const i = z * w + x, gx = x0 + x, gz = z0 + z, g = GT[cellT[((gz / cellPx) | 0) * cols + ((gx / cellPx) | 0)]];   // inside the map: no clamping
      if (g.water) { water.push(i); if (nearOther(gx, gz, (k) => !GT[k].water) && hash2(gx * 3, gz * 7) < .7) foam[i] = 1; put1(i, waterColor(i, 0)); }
      else put1(i, edgeShade(gx, gz, tilePx(g, gx, gz)));
    }
    gCtx.putImageData(gImg, 0, 0);
    // walls: each face belongs to the higher pixel; the map's outer edges get the diorama's earth sides
    const rgb = (c) => [c >> 16 & 255, c >> 8 & 255, c & 255], cols2 = new Map();
    const bands = (y0, y1, colorAt) => { const out = []; let s = y0, c = colorAt(y0); for (let y = y0 + 1; y <= y1; y++) { const cy = y < y1 ? colorAt(y) : -2; if (cy !== c) { out.push(s, y, c); s = y; c = cy; } } return out; };
    const col = (dir, line, pos, y0, y1, colorAt) => { if (y1 <= y0) return; const key = dir + '|' + line; let L = cols2.get(key); if (!L) cols2.set(key, L = []); L.push({ pos, b: bands(y0, y1, colorAt) }); };
    for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) {
      const ex = x % cellPx, ez = z % cellPx; if (ex && ex !== cellPx - 1 && ez && ez !== cellPx - 1) continue;   // a wall stands only on a cell's edge
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
    // things whose foot stands in this chunk (chests are not baked: they are props, see propMesh)
    for (const th of things) { const px = th.x * PPU, pz = th.z * PPU; if (th.o.chest || px < x0 || px >= x0 + w || pz < z0 || pz >= z0 + h) continue; const o = Object.assign({}, th.o); if (o.y === undefined) o.y = groundY(th.x, th.z) + (o.dy || 0); put(th.s, th.x, th.z, o); }
    // baked light, meshes
    B.bakeLamps(chunkLight); S.bakeLamps(chunkLight);
    const gPack = new Uint8Array(w * h * 2);
    if (near.length) for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) gPack[(z * w + x) * 2 + 1] = Math.min(255, Math.round(chunkLight((x0 + x + .5) * P, hPx(x0 + x, z0 + z) * P, (z0 + z + .5) * P, 0, 1, 0) * 127.5));
    const gTex = nearest(new THREE.CanvasTexture(gCan)); gTex.flipY = false; gTex.encoding = THREE.sRGBEncoding;
    const hTex = nearest(new THREE.DataTexture(gPack, w, h, THREE.LuminanceAlphaFormat, THREE.UnsignedByteType)); hTex.unpackAlignment = 1; hTex.needsUpdate = true;
    groundTex = gTex; heightTex = hTex; const matGround = voxelMaterial('ground');
    // chunks are culled against the view (one kept off screen costs nothing); the bounds are padded a little
    const cull = (m) => { const g = m.geometry; if (!g.attributes.position || !g.attributes.position.count) { m.visible = false; return m; } g.computeBoundingSphere(); g.boundingSphere.radius += 1; return m; };
    const staticMesh = cull(new THREE.Mesh(B.geometry(), matStatic)); staticMesh.castShadow = staticMesh.receiveShadow = true; group.add(staticMesh);
    const slabMesh = cull(new THREE.Mesh(S.geometry(), matSlab)); slabMesh.castShadow = slabMesh.receiveShadow = true; slabMesh.customDepthMaterial = slabDepth; group.add(slabMesh);
    const pos = [], uv = [], idx = [], open = new Map(), rects = [];
    // flat rectangles of equal height, merged cell by cell (a chunk starts on a cell boundary), then sized in pixels
    const cw = Math.ceil(w / cellPx), chh = Math.ceil(h / cellPx), cx0 = x0 / cellPx, cz0 = z0 / cellPx, ch = (x, z) => cellH[(cz0 + z) * cols + cx0 + x];
    for (let z = 0; z < chh; z++) {
      const seen = new Map(); let x = 0;
      while (x < cw) { const hh = ch(x, z); let e = x + 1; while (e < cw && ch(e, z) === hh) e++; const key = x + ',' + e + ',' + hh, r = open.get(key); if (r && r.z1 === z) { r.z1 = z + 1; seen.set(key, r); } else { const n = { x0: x, x1: e, z0: z, z1: z + 1, h: hh }; rects.push(n); seen.set(key, n); } x = e; }
      open.clear(); for (const [k, v] of seen) open.set(k, v);
    }
    for (const r of rects) { r.x0 *= cellPx; r.z0 *= cellPx; r.x1 = Math.min(w, r.x1 * cellPx); r.z1 = Math.min(h, r.z1 * cellPx); }
    for (const r of rects) { const v = pos.length / 3, y = r.h * P; pos.push((x0 + r.x0) * P, y, (z0 + r.z1) * P, (x0 + r.x1) * P, y, (z0 + r.z1) * P, (x0 + r.x1) * P, y, (z0 + r.z0) * P, (x0 + r.x0) * P, y, (z0 + r.z0) * P); uv.push(r.x0 / w, r.z1 / h, r.x1 / w, r.z1 / h, r.x1 / w, r.z0 / h, r.x0 / w, r.z0 / h); idx.push(v, v + 1, v + 2, v, v + 2, v + 3); }
    const gg = new THREE.BufferGeometry(), nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    gg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gg.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); gg.setIndex(idx);
    const gm = cull(new THREE.Mesh(gg, matGround)); gm.receiveShadow = true; group.add(gm);
    const halos = lampSpots.filter((p) => p.x * PPU >= x0 && p.x * PPU < x0 + w && p.z * PPU >= z0 && p.z * PPU < z0 + h).map((p) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: def.halo || 0xff9440, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })); s.position.set(p.x, p.y, p.z); s.scale.setScalar(p.r); group.add(s); return s; });
    const tris = B.tris + S.tris + idx.length / 3;
    S = prevS; B = prevB;
    return {
      ci, cj, group, halos, tris, meshes: [staticMesh, slabMesh, gm],
      water(tick) { if (!water.length) return; for (const i of water) put1(i, waterColor(i, tick)); gCtx.putImageData(gImg, 0, 0); gTex.needsUpdate = true; },
      dispose() { scene.remove(group); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material && o.material !== matStatic && o.material !== matSlab) o.material.dispose(); }); gTex.dispose(); hTex.dispose(); matGround.dispose(); },
    };
  }

  /* streaming: the chunks under the view and around the cat stay built (one new chunk per frame); far ones are freed */
  const chunks = new Map(), ckey = (i, j) => i + ',' + j;
  const area = { def, id: def.id, name: def.name, W, D, camNorth: def.camNorth, solids, acts, exits, groundY, isWater, blocked, clear, lampLight, tris: 0, buildMs: 0, chunkMs: 0, chunks };
  const cwu = ccw * cell, chu = cch * cell;
  const span = ([x0, z0, x1, z1]) => [clamp(Math.floor(x0 / cwu), 0, NI - 1), clamp(Math.floor(z0 / chu), 0, NJ - 1), clamp(Math.floor(x1 / cwu), 0, NI - 1), clamp(Math.floor(z1 / chu), 0, NJ - 1)];
  const want = (x, z) => {
    const pi = Math.floor(x / cwu), pj = Math.floor(z / chu), [i0, j0, i1, j1] = span(viewFoot(3, 1, 9)), out = [];
    for (let j = Math.min(j0, pj); j <= Math.max(j1, pj); j++) for (let i = Math.min(i0, pi); i <= Math.max(i1, pi); i++) if (i >= 0 && j >= 0 && i < NI && j < NJ) out.push([i, j, Math.abs(i - pi) + Math.abs(j - pj)]);
    return out.sort((a, b) => a[2] - b[2]);
  };
  const sync = () => { lamps = [...chunks.values()].flatMap((c) => c.halos); area.allTris = [...chunks.values()].reduce((a, c) => a + c.tris, 0); };
  area.stream = (x, z, all) => {
    if (def.keep) { if (chunks.size < NI * NJ) { for (let j = 0; j < NJ; j++) for (let i = 0; i < NI; i++) if (!chunks.has(ckey(i, j))) chunks.set(ckey(i, j), buildChunk(i, j)); sync(); } return; }
    let built = 0;
    for (const [i, j] of want(x, z)) { const k = ckey(i, j); if (chunks.has(k)) continue; const t0 = performance.now(); chunks.set(k, buildChunk(i, j)); area.chunkMs = Math.max(area.chunkMs, performance.now() - t0); built++; if (!all) break; }
    const [i0, j0, i1, j1] = span(viewFoot(20, 20, 26));
    for (const [k, c] of chunks) if (c.ci < i0 || c.ci > i1 || c.cj < j0 || c.cj > j1) { c.dispose(); chunks.delete(k); built++; }
    if (built) sync();
  };
  let waterT = 0, waterTick = 0, sunX = -1e9, sunZ = -1e9;
  area.update = (dt, x, z) => {
    area.stream(x, z, false);
    if (def.keep) {   // all built: draw (and shadow) only the chunks under the view
      const [i0, j0, i1, j1] = span(viewFoot(3, 1, 9));
      for (const c of chunks.values()) c.group.visible = c.ci >= i0 && c.ci <= i1 && c.cj >= j0 && c.cj <= j1;
    }
    waterT += dt; if (waterT >= .4 && !reduceMotion) { waterT = 0; waterTick++; for (const c of chunks.values()) c.water(waterTick); }
    // the shadow box follows the view in steps of a few shadow texels, so shadows do not shimmer
    const snap = 2 * SHADOW_HALF / 2048 * 8, sx = Math.round(camT.x / snap) * snap, sz = Math.round(camT.z / snap) * snap;
    if (sx !== sunX || sz !== sunZ) { sunX = sx; sunZ = sz; area.sunX = sx; area.sunZ = sz; sun.target.position.set(sx, 0, sz); shadowHold = 3; }
  };
  // triangles the view draws (main pass): the chunk meshes inside the camera's frustum
  const meshTris = (m) => { const g = m.geometry; return g.index ? g.index.count / 3 : g.attributes.position ? g.attributes.position.count / 3 : 0; };
  area.visibleTris = (frustum) => { let n = 0; for (const c of chunks.values()) if (c.group.visible) for (const m of c.meshes) if (m.visible && frustum.intersectsObject(m)) n += meshTris(m); return n; };
  area.dispose = () => { for (const c of chunks.values()) c.dispose(); chunks.clear(); lamps = []; };
  // a kept area is hidden, not freed, while the cat is elsewhere; what the area file adds later (villagers, chests) is
  // cut back to what the map itself made, so populating it again does not stack copies
  const base = { solids: solids.length, acts: acts.length };
  area.hide = () => { for (const c of chunks.values()) c.group.visible = false; lamps = []; };
  area.show = () => { for (const c of chunks.values()) c.group.visible = true; solids.length = base.solids; acts.length = base.acts; sync(); };
  area.sig = (def.things || []).filter((th) => th[5] && th[5].when).map((th) => th[5].when() ? 1 : 0).join('');   // which conditional things it was built with
  area.sunX = W / 2; area.sunZ = D / 2;
  Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 160 }); sun.shadow.camera.updateProjectionMatrix();
  area.open = (x, z) => { const fresh = !chunks.size; area.stream(x, z, true); if (fresh) area.buildMs = Math.round(performance.now() - T0); };
  return area;
}
const SHADOW_HALF = 30;

// things outside the baked ground, as one small mesh: for things that change in play (chests that open).
// items: [[key, x, z, o]]
function propMesh(items) {
  const prevS = S, prevB = B; S = new SlabBuilder(256); B = new Builder(256);
  for (const [key, x, z, o] of items) { const oo = Object.assign({}, o || {}); if (oo.y === undefined) oo.y = A.groundY(x, z); put(sp[key], x, z, oo); }
  B.bakeLamps(A.lampLight); S.bakeLamps(A.lampLight);
  const group = new THREE.Group();
  for (const [bld, mat, depth] of [[B, matStatic], [S, matSlab, slabDepth]]) {
    const g = bld.geometry(); if (!g.attributes.position || !g.attributes.position.count) continue;
    const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; if (depth) m.customDepthMaterial = depth; group.add(m);
  }
  S = prevS; B = prevB; scene.add(group); shadowHold = 3;
  return { group, dispose() { scene.remove(group); group.traverse((m) => { if (m.geometry) m.geometry.dispose(); }); } };
}

// halo texture for lamps: built once
const haloTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();

// ---- engine/50-actors.js
/* ---------- actors: flat figures from a frame atlas, always facing the camera, feet on the ground ---------- */
// views: { down, up, side } row names of a frames sheet (side faces right; left is the side view mirrored)
// anims: { name: [frames] or { down: [..], up: [..], side: [..] } }; a frame is a name inside the view's row or a full
// 'row.frame'. idle and walk are required; a.anim (with a.at, seconds into it, and a.fps) plays any other one.
const actors = [];
const casterMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });

function sheetActor(sheet, views, anims, o) {
  const SH = SHEETS[sheet]; if (!SH) throw new Error('actor: sheet "' + sheet + '" is not in the art');
  const idle0 = Array.isArray(anims.idle) ? anims.idle[0] : anims.idle.down[0], first = SH.meta.sprites[idle0.includes('.') ? idle0 : views.down + '.' + idle0];
  if (!first) throw new Error(`actor: frame "${views.down}.${idle0}" missing in ${sheet}`);
  const cw = first.w, ch = first.h, [L, U] = first.anchor || [Math.floor(cw / 2), ch];
  const a = Object.assign({ x: 0, z: 0, fx: 0, fz: 1, step: 0, moving: false, anim: null, at: 0, fps: 10, lift: 0, blink: false, size: 1, probe: new THREE.Vector3(), lampL: { value: 0 } }, o || {});
  a.tex = nearest(new THREE.CanvasTexture(SH.canvas)); a.tex.encoding = THREE.sRGBEncoding;
  const g = new THREE.PlaneGeometry(cw * P, ch * P); g.translate((cw / 2 - L) * P, (U - ch / 2) * P, 0);   // the anchor (feet) at the origin
  const gl = g.clone(), n = gl.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);   // normal up: light does not change when the view turns
  a.mesh = new THREE.Mesh(gl, voxelMaterial('sprite', { map: a.tex, probe: a.probe, lampL: a.lampL, row: new THREE.Vector2(SPR_Y * P, P) }));
  a.mesh.material.side = THREE.DoubleSide; a.mesh.receiveShadow = true;
  a.caster = new THREE.Mesh(g, casterMat); a.caster.castShadow = true;
  a.caster.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: a.tex, alphaTest: .5, side: THREE.DoubleSide });
  scene.add(a.mesh); scene.add(a.caster);

  const frame = (row, name) => SH.meta.sprites[name.includes('.') ? name : row + '.' + name] || first;
  const listOf = (name, view) => { const L = anims[name]; return !L ? null : Array.isArray(L) ? L : L[view]; };
  a.pose = () => {
    const side = a.fx * Math.cos(yaw) - a.fz * Math.sin(yaw), toward = a.fx * Math.sin(yaw) + a.fz * Math.cos(yaw);
    const sideView = Math.abs(side) > Math.abs(toward), view = sideView ? 'side' : toward > 0 ? 'down' : 'up', row = views[view], flip = sideView && side < 0;
    const own = a.anim && listOf(a.anim, view), list = own || listOf(a.moving ? 'walk' : 'idle', view);
    const i = own ? Math.min(list.length - 1, Math.floor(a.at * a.fps)) : Math.floor(a.step) % list.length, r = frame(row, list[i]);
    a.tex.repeat.set(r.w / SH.w, r.h / SH.h); a.tex.offset.set(r.x / SH.w, 1 - (r.y + r.h) / SH.h);
    const y = A.groundY(a.x, a.z), sx = Math.sin(cur.az), sz = Math.cos(cur.az), k = a.size;
    a.mesh.visible = !a.blink; a.mesh.position.set(a.x, y + a.lift, a.z); a.mesh.rotation.y = yaw; a.mesh.scale.set((flip ? -1 : 1) * k, SPR_Y * k, k);
    a.caster.position.set(a.x, y + a.lift, a.z); a.caster.rotation.y = cur.az; a.caster.scale.set((flip ? -1 : 1) * k, k, k);
    a.probe.set(a.x + sx * .2, y, a.z + sz * .2); a.lampL.value = A.lampLight(a.x, y + .6, a.z, 0, 1, 0);
  };
  a.dispose = () => { scene.remove(a.mesh); scene.remove(a.caster); a.mesh.geometry.dispose(); a.mesh.material.dispose(); a.caster.customDepthMaterial.dispose(); a.tex.dispose(); actors.splice(actors.indexOf(a), 1); };
  actors.push(a);
  return a;
}

// ---- engine/52-flat.js
/* ---------- flat cards: effects and pickups as camera-facing pictures from any sheet; floating numbers in HTML ---------- */
// flat(sheet, frames, x, z, o): frames are sprite names in the sheet; o = { y, size, fps, loop, life, flipX, bob, glow }
// One texture per sheet is shared; a card changes frame by rewriting its own four UVs.
const flats = [], flatTex = {};
const flatMat = (sheet) => {
  if (flatTex[sheet]) return flatTex[sheet];
  const t = nearest(new THREE.CanvasTexture(SHEETS[sheet].canvas)); t.encoding = THREE.sRGBEncoding;
  return (flatTex[sheet] = new THREE.MeshBasicMaterial({ map: t, alphaTest: .5, side: THREE.DoubleSide }));
};

function flat(sheet, frames, x, z, o) {
  const SH = SHEETS[sheet]; if (!SH) throw new Error('flat: sheet "' + sheet + '" is not in the art');
  const rs = frames.map((n) => { const r = SH.meta.sprites[n]; if (!r) throw new Error(`flat: "${n}" missing in ${sheet}`); return r; });
  const f = Object.assign({ x, z, y: null, size: 1, fps: 14, loop: false, life: 0, t: 0, flipX: false, bob: 0, alive: true, i: -1 }, o || {});
  const r0 = rs[0], [L, U] = r0.anchor || [r0.w / 2, r0.h];
  const g = new THREE.PlaneGeometry(r0.w * P * f.size, r0.h * P * f.size); g.translate((r0.w / 2 - L) * P * f.size, (U - r0.h / 2) * P * f.size, 0);
  f.mesh = new THREE.Mesh(g, flatMat(sheet)); f.mesh.renderOrder = 2; scene.add(f.mesh);
  f.frame = (i) => {
    if (i === f.i) return; f.i = i; const r = rs[i], uv = g.attributes.uv, u0 = r.x / SH.w, u1 = (r.x + r.w) / SH.w, v0 = 1 - (r.y + r.h) / SH.h, v1 = 1 - r.y / SH.h;
    const [a, b] = f.flipX ? [u1, u0] : [u0, u1]; uv.setXY(0, a, v1); uv.setXY(1, b, v1); uv.setXY(2, a, v0); uv.setXY(3, b, v0); uv.needsUpdate = true;
  };
  f.n = rs.length; f.frame(0);
  f.dispose = () => { f.alive = false; scene.remove(f.mesh); g.dispose(); };
  flats.push(f);
  return f;
}
// one-shot effect from the fx sheet: fx('slash', x, z, { y, size, flipX })
const fx = (row, x, z, o) => { const SH = SHEETS['fx-1'], names = Object.keys(SH.meta.sprites).filter((k) => k.startsWith(row + '.')).sort(); return flat('fx-1', names, x, z, o); };

function flatsDraw(dt) {
  for (let k = flats.length - 1; k >= 0; k--) {
    const f = flats[k];
    if (!f.alive) { flats.splice(k, 1); continue; }
    f.t += dt; const i = Math.floor(f.t * f.fps);
    if (!f.loop && i >= f.n && !f.life) { f.dispose(); flats.splice(k, 1); continue; }
    if (f.life && f.t >= f.life) { f.dispose(); flats.splice(k, 1); continue; }
    f.frame(f.loop || f.life ? i % f.n : i);
    const y = (f.y === null ? A.groundY(f.x, f.z) : f.y) + (f.bob ? (Math.sin(f.t * 4) * .5 + .5) * f.bob : 0);
    f.mesh.position.set(f.x, y, f.z); f.mesh.rotation.y = yaw; f.mesh.scale.y = SPR_Y;
  }
}
const clearFlats = () => { for (const f of flats) f.dispose(); flats.length = 0; };

/* floating numbers and words over the world (damage, coins, "level up") */
const floats = [];
function floatText(text, x, y, z, cls) {
  const el = document.createElement('span'); el.className = 'float ' + (cls || ''); el.textContent = text; $('floats').appendChild(el);
  floats.push({ el, x: x + (R() - .5) * .3, y, z, t: 0 });
}
const _v = new THREE.Vector3();
function floatsDraw(dt) {
  const r = canvas.getBoundingClientRect();
  for (let k = floats.length - 1; k >= 0; k--) {
    const f = floats[k]; f.t += dt;
    if (f.t > .9) { f.el.remove(); floats.splice(k, 1); continue; }
    _v.set(f.x, f.y + f.t * 1.1, f.z).project(cam);
    f.el.style.transform = `translate(${((_v.x + 1) / 2 * r.width).toFixed(1)}px,${((1 - _v.y) / 2 * r.height).toFixed(1)}px) translate(-50%,-100%)`;
    f.el.style.opacity = String(Math.min(1, (0.9 - f.t) * 4));
  }
}
const clearFloats = () => { for (const f of floats) f.el.remove(); floats.length = 0; };

// ---- engine/54-game.js
/* ---------- the game state: what a save holds, the level rules, items, the save and the save code ---------- */
// G = { v, area, x, z, hp, ink, xp, level, coins, inv: { id: count }, eq: { weapon, armour, charm }, quests: { id: step },
//       flags: { name: true }, opened: { chestId: true }, seen: { areaId: true } }
const ITEMS = {};        // content: id → { slot?: 'weapon' | 'armour' | 'charm', atk, def, hp, ink, use?: { hp, ink }, price, key? }
const LEVEL_XP = [0, 0, 20, 50, 95, 160];   // XP to reach level n (1…5)
const SAVE_KEY = 'mdv-rpg-cat-save', SAVE_V = 1;
let G = null;

function newGame() {
  G = { v: SAVE_V, area: START.area, x: null, z: null, hp: 1, ink: 0, xp: 0, level: 1, coins: 0, inv: {}, eq: { weapon: 'quill_sword', armour: null, charm: null }, quests: {}, flags: {}, opened: {}, seen: {} };
  G.hp = stats().hp; G.ink = stats().ink;
}
function stats() {
  const L = G.level - 1, eq = Object.values(G.eq).filter(Boolean).map((k) => ITEMS[k] || {});
  const sum = (f) => eq.reduce((a, i) => a + (i[f] || 0), 0);
  return { hp: 24 + L * 6 + sum('hp'), ink: 30 + sum('ink'), atk: 5 + L * 2 + sum('atk'), def: 1 + L + sum('def') };
}
const xpToNext = () => G.level >= 5 ? 0 : LEVEL_XP[G.level + 1] - G.xp;
function gainXp(n) {
  G.xp += n;
  while (G.level < 5 && G.xp >= LEVEL_XP[G.level + 1]) {
    G.level++; const s = stats(); G.hp = s.hp; G.ink = s.ink;
    floatText(t('fx.level', { n: G.level }), player.x, 2.4, player.z, 'gold'); sfx('level'); toast(t('toast.level', { n: G.level }));
  }
}
const has = (id, n) => (G.inv[id] || 0) >= (n || 1) || Object.values(G.eq).includes(id);
function addItem(id, n) { if (id === 'coin') { G.coins += n || 1; return; } G.inv[id] = (G.inv[id] || 0) + (n || 1); }
function takeItem(id, n) { G.inv[id] = (G.inv[id] || 0) - (n || 1); if (G.inv[id] <= 0) delete G.inv[id]; }
function equip(id) {
  const it = ITEMS[id]; if (!it || !it.slot || !G.inv[id]) return false;
  const old = G.eq[it.slot]; takeItem(id); if (old) addItem(old); G.eq[it.slot] = id;
  const s = stats(); G.hp = Math.min(G.hp, s.hp); G.ink = Math.min(G.ink, s.ink); sfx('item'); return true;
}
function useItem(id) {
  const it = ITEMS[id]; if (!it || !it.use || !G.inv[id]) return false;
  const s = stats(); if (it.use.hp && G.hp >= s.hp && !it.use.ink) return false;
  if (it.use.hp) G.hp = Math.min(s.hp, G.hp + it.use.hp); if (it.use.ink) G.ink = Math.min(s.ink, G.ink + it.use.ink);
  takeItem(id); sfx('item'); if (player) floatText('+' + (it.use.hp || it.use.ink), player.x, 2, player.z, it.use.hp ? 'heal' : 'ink'); return true;
}

/* the save: the browser keeps one slot; the code carries the same data as text a person can copy */
function snapshot() { const s = JSON.parse(JSON.stringify(G)); if (player && A) { s.area = A.def.id; s.x = +player.x.toFixed(2); s.z = +player.z.toFixed(2); } return s; }
function saveGame() { if (!G) return false; try { localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot())); return true; } catch (e) { return false; } }
function loadSave() { try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); return checkSave(s); } catch (e) { return null; } }
const hasSave = () => !!loadSave();
function checkSave(s) {
  if (!s || typeof s !== 'object' || typeof s.v !== 'number' || s.v > SAVE_V || !AREAS[s.area]) return null;
  const base = { inv: {}, eq: { weapon: 'quill_sword', armour: null, charm: null }, quests: {}, flags: {}, opened: {}, seen: {}, coins: 0, xp: 0, level: 1 };
  return Object.assign(base, s);   // older saves miss newer fields; the defaults fill them
}

// code: JSON → UTF-8 → base32 (no look-alike letters) with a CRC-32, in groups of five
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function crc32(bytes) { let c = ~0; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; } return ~c >>> 0; }
function saveCode() {
  const s = snapshot(), compact = [s.v, s.area, s.x, s.z, s.hp, s.ink, s.xp, s.level, s.coins, s.inv, s.eq, s.quests, Object.keys(s.flags), Object.keys(s.opened), Object.keys(s.seen)];
  const data = new TextEncoder().encode(JSON.stringify(compact)), crc = crc32(data), bytes = new Uint8Array(data.length + 4);
  bytes.set(data); bytes.set([crc >>> 24, crc >>> 16 & 255, crc >>> 8 & 255, crc & 255], data.length);
  let bits = 0, acc = 0, out = '';
  for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { out += B32[(acc >>> (bits - 5)) & 31]; bits -= 5; } acc &= (1 << bits) - 1; }
  if (bits) out += B32[(acc << (5 - bits)) & 31];
  return out.match(/.{1,5}/g).join('-');
}
function readCode(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length < 16) return { error: 'code.short' };
  const bytes = []; let bits = 0, acc = 0;
  for (const ch of clean) { const v = B32.indexOf(ch); if (v < 0) return { error: 'code.char', ch }; acc = (acc << 5) | v; bits += 5; if (bits >= 8) { bytes.push((acc >>> (bits - 8)) & 255); bits -= 8; acc &= (1 << bits) - 1; } }
  const data = Uint8Array.from(bytes.slice(0, -4)), c = bytes.slice(-4), crc = crc32(data);
  if (((c[0] << 24 | c[1] << 16 | c[2] << 8 | c[3]) >>> 0) !== crc) return { error: 'code.crc' };
  try {
    const [v, area, x, z, hp, ink, xp, level, coins, inv, eq, quests, flags, opened, seen] = JSON.parse(new TextDecoder().decode(data));
    const set = (a) => Object.fromEntries((a || []).map((k) => [k, true]));
    const s = checkSave({ v, area, x, z, hp, ink, xp, level, coins, inv, eq, quests, flags: set(flags), opened: set(opened), seen: set(seen) });
    return s ? { save: s } : { error: 'code.version' };
  } catch (e) { return { error: 'code.crc' }; }
}

// ---- engine/56-combat.js
/* ---------- combat: the cat's quill combo, dodge and two ink skills; enemies on one shared behaviour; drops ---------- */
// Enemy types are data (content fills ENEMIES); every strike shows its tell first, and a hit during the tell cancels it.
const ENEMIES = {};   // type → { sheet, row, hp, atk, def, speed, sight, reach, windup, strike, recover, xp, coins: [min, max], r, move, fly?, shield? }
const enemies = [], pickups = [];
const SWINGS = [
  { reach: 1.35, arc: 2.1, dmg: 1, push: 3, dur: .24, hit: .06, sfx: 'swing' },
  { reach: 1.35, arc: 2.1, dmg: 1, push: 3, dur: .24, hit: .06, sfx: 'swing' },
  { reach: 1.65, arc: 2.8, dmg: 1.6, push: 8, dur: .34, hit: .1, sfx: 'swing3' },
];
const SKILLS = { dash: { ink: 10 }, well: { ink: 15 } };
const hero = { swing: -1, st: 0, queued: false, grace: 0, last: -1, hitSet: null, dodge: 0, cd: 0, dx: 0, dz: 0, dash: false, inv: 0, hurt: 0, kx: 0, kz: 0, dead: 0 };
let shakeT = 0, combatT = 0;
const INK_REGEN = 2;
const POISE_CD = 1.2;   // seconds after a stagger before the next one   // ink per second while nothing is fighting the cat

const dmgRoll = (atk, def, mult) => Math.max(1, Math.round((atk * (mult || 1) - def) * (.9 + R() * .2)));
const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function resetHero() { Object.assign(hero, { swing: -1, st: 0, queued: false, grace: 0, last: -1, dodge: 0, cd: 0, inv: 0, hurt: 0, kx: 0, kz: 0, dead: 0, dash: false }); if (player) player.anim = null; }

/* the cat */
function heroAttack() {
  if (hero.dead || hero.dodge > 0 || hero.hurt > 0) return;
  if (hero.swing >= 0) { hero.queued = true; return; }   // remembered: the next swing starts when this one ends
  startSwing(hero.grace > 0 && hero.last < 2 ? hero.last + 1 : 0);
}
function startSwing(i) {
  const [ix, iy] = moveVector();
  if (Math.hypot(ix, iy) > .3) { const [mx, mz] = screenToWorld(ix, iy); const l = Math.hypot(mx, mz); player.fx = mx / l; player.fz = mz / l; }
  else { const e = nearestEnemy(2.4); if (e) { const l = near(e, player) || 1; player.fx = (e.x - player.x) / l; player.fz = (e.z - player.z) / l; } }
  Object.assign(hero, { swing: i, st: 0, queued: false, hitSet: new Set() });
  player.anim = 'attack' + (i + 1); player.at = 0; player.fps = 3 / SWINGS[i].dur; sfx(SWINGS[i].sfx);
}
function heroDodge(skill) {
  if (hero.dead || hero.hurt > 0 || hero.dodge > 0 || (!skill && hero.cd > 0)) return;
  if (skill) {
    if (!G.flags['skill_' + skill]) { toast(t('toast.locked')); sfx('no'); return; }
    if (G.ink < SKILLS[skill].ink) { floatText(t('fx.noink'), player.x, 1.8, player.z, 'ink'); sfx('no'); return; }
    G.ink -= SKILLS[skill].ink;
    if (skill === 'well') { inkwell(); return; }
  }
  const [ix, iy] = moveVector(); let dx = player.fx, dz = player.fz;
  if (Math.hypot(ix, iy) > .3) { const [mx, mz] = screenToWorld(ix, iy), l = Math.hypot(mx, mz); dx = mx / l; dz = mz / l; player.fx = dx; player.fz = dz; }
  const dash = skill === 'dash';
  Object.assign(hero, { swing: -1, queued: false, dodge: dash ? .32 : .2, dx, dz, dash, hitSet: new Set(), sx: player.x, sz: player.z });
  hero.inv = Math.max(hero.inv, dash ? .4 : .28);
  player.anim = 'dodge'; player.at = 0; player.fps = 10;
  fx(dash ? 'ink_splash' : 'dust', player.x, player.z, { size: .8 }); sfx(dash ? 'dash' : 'dodge');
}
function inkwell() {
  fx('ink_splash', player.x, player.z, { size: 2.2, fps: 9 }); sfx('well'); shake(.15);
  const s = stats();
  for (const e of enemies) if (e.hp > 0 && near(e, player) < 3.4) { e.slow = 4; hitEnemy(e, dmgRoll(s.atk, e.T.def, .7), 4, false); }
}
function hurtHero(atk, fromX, fromZ) {
  if (hero.inv > 0 || hero.dead || !G) return;
  const d = dmgRoll(atk, stats().def); G.hp = Math.max(0, G.hp - d);
  const l = Math.hypot(player.x - fromX, player.z - fromZ) || 1;
  Object.assign(hero, { swing: -1, queued: false, dodge: 0, hurt: .28, inv: 1.1, kx: (player.x - fromX) / l * 7, kz: (player.z - fromZ) / l * 7 });
  player.anim = 'hurt'; player.at = 0; floatText('-' + d, player.x, 1.8, player.z, 'bad'); sfx('hurt'); shake(.25);
  if (G.hp <= 0) { hero.dead = 1.4; sfx('over'); }
}
const shake = (s) => { if (settings.shake) shakeT = Math.max(shakeT, s); };

// screen-space stick → world direction (the same turn the walk uses)
const screenToWorld = (ix, iy) => [Math.cos(yaw) * ix - Math.sin(yaw) * iy, -Math.sin(yaw) * ix - Math.cos(yaw) * iy];

function heroStep(dt) {
  const s = stats();
  hero.inv = Math.max(0, hero.inv - dt); hero.cd = Math.max(0, hero.cd - dt); hero.grace = Math.max(0, hero.grace - dt);
  if (combatT <= 0 && !hero.dead && G.ink < s.ink) G.ink = Math.min(s.ink, G.ink + dt * INK_REGEN);   // ink seeps back out of combat, so a dash is never out of reach for good
  player.blink = hero.inv > 0 && hero.dodge <= 0 && Math.floor(hero.inv * 16) % 2 === 1;
  if (player.anim) player.at += dt;
  const go = (vx, vz) => { const nx = player.x + vx * dt, nz = player.z + vz * dt; if (!A.blocked(nx, player.z, player.x, player.z)) player.x = nx; if (!A.blocked(player.x, nz, player.x, player.z)) player.z = nz; };
  if (hero.dead) { hero.dead -= dt; player.moving = false; if (hero.dead <= 0) gameOver(); return; }
  if (hero.hurt > 0) {
    hero.hurt -= dt; go(hero.kx, hero.kz); hero.kx *= Math.pow(.02, dt); hero.kz *= Math.pow(.02, dt); player.moving = false;
    if (hero.hurt <= 0) player.anim = null; return;
  }
  if (hero.dodge > 0) {
    hero.dodge -= dt; const v = hero.dash ? 19 : 15; player.moving = false;
    if (hero.dash) { const nx = player.x + hero.dx * v * dt, nz = player.z + hero.dz * v * dt; if (!A.blocked(nx, nz, player.x, player.z, true)) { player.x = nx; player.z = nz; } } else go(hero.dx * v, hero.dz * v);
    if (hero.dash) for (const e of enemies) if (e.hp > 0 && !hero.hitSet.has(e) && near(e, player) < e.T.r + .6) { hero.hitSet.add(e); hitEnemy(e, dmgRoll(s.atk, e.T.def, 1.3), 5, true); }
    if (hero.dodge <= 0) {
      player.anim = null; hero.cd = hero.dash ? .3 : .45;
      if (hero.dash && A.blocked(player.x, player.z)) { player.x = hero.sx; player.z = hero.sz; floatText(t('fx.short'), player.x, 1.8, player.z, 'ink'); }   // the dash fell short: back to the bank
    }
    return;
  }
  if (hero.swing >= 0) {
    const sw = SWINGS[hero.swing]; hero.st += dt; player.moving = false;
    if (hero.st < sw.hit + .04 && !nearestEnemy(sw.reach * .8)) go(player.fx * 3.2, player.fz * 3.2);   // a short step into the swing
    if (hero.st >= sw.hit) for (const e of enemies) {
      if (e.hp <= 0 || hero.hitSet.has(e)) continue;
      const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz);
      if (d > sw.reach + e.T.r) continue;
      const ang = Math.acos(clamp((dx * player.fx + dz * player.fz) / (d || 1), -1, 1));
      if (d > .7 && ang > sw.arc / 2) continue;
      if (!A.clear(player.x, player.z, e.x, e.z)) continue;
      hero.hitSet.add(e);
      const back = e.T.shield && (dx * e.fx + dz * e.fz) < 0;   // a shielded enemy takes full damage only from behind
      hitEnemy(e, back ? 1 : dmgRoll(s.atk, e.T.def, sw.dmg), sw.push, true, back);
    }
    if (hero.st >= sw.dur) {
      hero.last = hero.swing; const next = hero.queued && hero.swing < 2 ? hero.swing + 1 : -1;
      hero.swing = -1; player.anim = null; hero.grace = hero.last < 2 ? .16 : 0;
      if (next >= 0) startSwing(next); else if (hero.last === 2) hero.cd = .1;
    }
    return;
  }
  // walking
  const [ix, iy] = moveVector(), il = Math.hypot(ix, iy);
  if (il > .15 && !dlg) {
    const [mx, mz] = screenToWorld(ix, iy); go(mx * 9.6, mz * 9.6);   // the owner asked for 3x the first 3.2 units/s
    const l = Math.hypot(mx, mz); player.fx = mx / l; player.fz = mz / l; player.step += dt * 18 * Math.min(1, il); player.moving = true;
  } else { player.moving = false; player.step = 0; }
}

function hitEnemy(e, d, push, inkGain, blocked) {
  e.hp -= d; const l = near(e, player) || 1;
  if (!e.T.poise) { e.kx = (e.x - player.x) / l * push; e.kz = (e.z - player.z) / l * push; }
  floatText(blocked ? t('fx.block') : String(d), e.x, 1.4 + (e.T.fly || 0), e.z, blocked ? 'dim' : '');
  fx('hit_spark', e.x, e.z, { y: A.groundY(e.x, e.z) + .5 + (e.T.fly || 0), size: .9 }); sfx(blocked ? 'no' : 'hit'); shake(.08);
  if (inkGain && !blocked) G.ink = Math.min(stats().ink, G.ink + 3);
  if (e.hp <= 0) { setState(e, 'defeat', .55); e.a.anim = 'defeat'; sfx('defeat'); return; }
  // a stagger (which also cancels a tell) leaves the enemy unstaggerable for POISE_CD: hits still hurt, but pressing
  // Hit without pause no longer stun-locks it (tools/fair-check.mjs: mashing beat timing on every enemy before)
  if (!e.T.poise && simTime - (e.staggerAt ?? -9) >= POISE_CD && (!blocked || e.state === 'windup')) { setState(e, 'hurt', .24); e.staggerAt = simTime; }
  e.aware = true; if (e.T.onHit) e.T.onHit(e);
}

/* enemies: wander → notice → chase → windup (the tell) → strike → recover */
function spawnEnemy(type, x, z, o) {
  const T = ENEMIES[type]; if (!T) throw new Error('no enemy type "' + type + '"');
  const row = T.row, a = sheetActor(T.sheet, { down: row, up: row, side: row }, T.anims || { idle: ['walk1'], walk: ['walk1', 'walk2'], windup: ['windup'], attack: ['attack'], hurt: ['hurt'], defeat: ['defeat'] });
  if (T.size) a.size = T.size;
  const e = Object.assign({ type, T, a, x, z, hx: x, hz: z, hp: T.hp, fx: 1, fz: 0, state: 'wander', st: 1 + R() * 2, kx: 0, kz: 0, slow: 0, aware: false, tx: x, tz: z, sx: x, sz: z, done: false, id: null }, o || {});
  a.x = x; a.z = z; a.lift = T.fly || 0; enemies.push(e); return e;
}
function setState(e, s, time) { e.state = s; e.st = time; e.t0 = time; e.a.anim = null; e.a.at = 0; }
function nearestEnemy(r) { let best = null, bd = r; for (const e of enemies) { if (e.hp <= 0) continue; const d = near(e, player); if (d < bd) { bd = d; best = e; } } return best; }
function clearEnemies() { for (const e of enemies) e.a.dispose(); enemies.length = 0; for (const p of pickups) p.f.dispose(); pickups.length = 0; hazards.length = 0; }

function enemiesStep(dt) {
  let engaged = false;
  for (let k = enemies.length - 1; k >= 0; k--) {
    const e = enemies[k], T = e.T, a = e.a, dist = near(e, player), sp = T.speed * (e.slow > 0 ? .45 : 1);
    if (dist > 40 && e.state !== 'defeat') { a.mesh.visible = false; continue; }
    e.slow = Math.max(0, e.slow - dt); e.st -= dt; if (a.anim) a.at += dt;
    const move = (vx, vz) => { const nx = e.x + vx * dt, nz = e.z + vz * dt; if (!A.blocked(nx, e.z, e.x, e.z, T.fly)) e.x = nx; else return false; if (!A.blocked(e.x, nz, e.x, e.z, T.fly)) e.z = nz; else return false; return true; };
    const face = (x, z) => { const l = Math.hypot(x - e.x, z - e.z); if (l > 1e-3) { e.fx = (x - e.x) / l; e.fz = (z - e.z) / l; } };
    const sees = dist < T.sight && A.clear(e.x, e.z, player.x, player.z) && !hero.dead;
    if (e.kx || e.kz) { move(e.kx, e.kz); e.kx *= Math.pow(.01, dt); e.kz *= Math.pow(.01, dt); if (Math.abs(e.kx) + Math.abs(e.kz) < .05) e.kx = e.kz = 0; }
    a.moving = false;
    if (T.ai && e.state !== 'defeat') { engaged = T.ai(e, dt, dist, move, face) || engaged; a.x = e.x; a.z = e.z; a.fx = e.fx; a.fz = e.fz; a.step += dt * 4; a.mesh.visible = true; continue; }
    switch (e.state) {
      case 'wander':
        if (sees || e.aware) { setState(e, 'notice', .35); face(player.x, player.z); floatText('!', e.x, 1.5 + (T.fly || 0), e.z, 'gold'); sfx('notice'); break; }
        if (e.st <= 0) { const ang = R() * Math.PI * 2, r = 1 + R() * 2.5; e.tx = e.hx + Math.cos(ang) * r; e.tz = e.hz + Math.sin(ang) * r; e.st = 2 + R() * 2.5; }
        if (Math.hypot(e.tx - e.x, e.tz - e.z) > .2) { face(e.tx, e.tz); a.moving = move(e.fx * sp * .45, e.fz * sp * .45); }
        break;
      case 'notice': engaged = true; if (e.st <= 0) setState(e, 'chase', 0); break;
      case 'chase': {
        engaged = true; face(player.x, player.z);
        if (Math.hypot(e.x - e.hx, e.z - e.hz) > 16 || dist > T.sight * 1.8 || hero.dead) { setState(e, 'return', 0); e.aware = false; break; }
        if (dist <= T.reach && A.clear(e.x, e.z, player.x, player.z)) { setState(e, 'windup', T.windup * (e.slow > 0 ? 1.4 : 1)); a.anim = 'windup'; e.sx = e.x; e.sz = e.z; e.tx = player.x; e.tz = player.z; break; }
        if (dist > .9) a.moving = move(e.fx * sp, e.fz * sp);
        break;
      }
      case 'windup': engaged = true; if (T.move !== 'smash') face(e.tx, e.tz); if (e.st <= 0) { setState(e, 'strike', T.strike); a.anim = 'attack'; e.hit = 0; e.sx = e.x; e.sz = e.z; } break;
      case 'strike': {
        engaged = true; a.anim = 'attack'; const p = 1 - Math.max(0, e.st) / T.strike;
        if (T.move === 'hop') {   // a hop to where the cat stood when the tell began, then a slam on landing
          const l = Math.hypot(e.tx - e.sx, e.tz - e.sz), k = Math.min(1, T.reach / (l || 1)), gx = e.sx + (e.tx - e.sx) * k, gz = e.sz + (e.tz - e.sz) * k;
          const nx = lerp(e.sx, gx, p), nz = lerp(e.sz, gz, p); if (!A.blocked(nx, nz, e.x, e.z)) { e.x = nx; e.z = nz; } a.lift = Math.sin(p * Math.PI) * .9;
          if (e.st <= 0) { a.lift = 0; fx('ink_splash', e.x, e.z, { size: 1.1 }); sfx('slam'); if (near(e, player) < .95 + T.r) hurtHero(T.atk, e.x, e.z); }
        } else if (T.move === 'lunge') {   // a straight dive along the line the tell pointed at
          const v = T.reach * 1.25 / T.strike; if (!move(e.fx * v, e.fz * v)) e.st = 0;
          a.lift = (T.fly || 0) * (1 - Math.sin(p * Math.PI) * .7);
          if (!e.hit && near(e, player) < T.r + .45) { e.hit = 1; hurtHero(T.atk, e.x, e.z); }
        } else if (T.move === 'smash') {   // two blows in front, half the strike apart
          for (const [n, when] of [[1, 0], [2, .5]]) if (e.hit < n && p >= when) {
            e.hit = n; fx('dust', e.x + e.fx * 1.1, e.z + e.fz * 1.1, { size: 1.3 }); sfx('slam'); shake(.12);
            const dx = player.x - e.x, dz = player.z - e.z, d = Math.hypot(dx, dz);
            if (d < T.reach + .3 && (dx * e.fx + dz * e.fz) / (d || 1) > .2) hurtHero(T.atk, e.x, e.z);
          }
        }
        if (e.st <= 0) { a.lift = T.fly || 0; setState(e, 'recover', T.recover); }
        break;
      }
      case 'recover': engaged = true; a.anim = null; if (e.st <= 0) setState(e, 'chase', 0); break;
      case 'hurt': engaged = true; a.anim = 'hurt'; a.lift = T.fly || 0; if (e.st <= 0) setState(e, 'chase', 0); break;
      case 'return':
        face(e.hx, e.hz); if (sees && dist < T.sight * .7) { setState(e, 'chase', 0); break; }
        if (Math.hypot(e.hx - e.x, e.hz - e.z) < .4 || !move(e.fx * sp, e.fz * sp)) { setState(e, 'wander', 1); e.hp = T.hp; }
        else a.moving = true;
        break;
      case 'defeat':
        a.anim = 'defeat'; a.blink = e.st < .25 && Math.floor(e.st * 20) % 2 === 0;
        if (e.st <= 0) { enemyDefeated(e); a.dispose(); enemies.splice(k, 1); continue; }
        break;
    }
    // keep a little room between enemies and around the cat
    for (const o of enemies) if (o !== e && o.hp > 0) { const dx = e.x - o.x, dz = e.z - o.z, d = Math.hypot(dx, dz), m = T.r + o.T.r; if (d < m && d > 1e-3) { const push = (m - d) * .5; if (!A.blocked(e.x + dx / d * push, e.z + dz / d * push, e.x, e.z, T.fly)) { e.x += dx / d * push; e.z += dz / d * push; } } }
    if (e.state !== 'strike' && dist < T.r + .3 && dist > 1e-3) { const push = (T.r + .3 - dist); if (!A.blocked(e.x + (e.x - player.x) / dist * push, e.z + (e.z - player.z) / dist * push, e.x, e.z, T.fly)) { e.x += (e.x - player.x) / dist * push; e.z += (e.z - player.z) / dist * push; } }
    a.x = e.x; a.z = e.z; a.fx = e.fx; a.fz = e.fz; a.step += dt * 6; a.mesh.visible = true;
    if (e.state === 'wander' || e.state === 'return' || e.state === 'chase') a.lift = (T.fly || 0) + (T.fly ? Math.sin(time * 5 + e.hx) * .12 : 0);
  }
  if (engaged) combatT = 2.5; else combatT = Math.max(0, combatT - dt);
}
function enemyDefeated(e) {
  gainXp(e.T.xp);
  const [lo, hi] = e.T.coins || [0, 0], n = lo + Math.floor(R() * (hi - lo + 1));
  for (let i = 0; i < n; i++) drop('coin', e.x + (R() - .5) * 1.2, e.z + (R() - .5) * 1.2, 1);
  if (e.T.drops) for (const [id, chance] of e.T.drops) if (R() < chance) drop(id, e.x, e.z + .3, 1);
  if (e.onDefeat) e.onDefeat(e);
  questEvent('defeat', e.type);
}

/* pickups: coins and items on the ground; they drift to the cat when it is close */
function drop(id, x, z, n) {
  let px = x, pz = z; if (A.blocked(px, pz)) { px = player.x; pz = player.z; }
  const f = flat('items-1', [id], px, pz, { size: id === 'coin' ? .32 : .4, loop: true, bob: .25, fps: 1 });
  pickups.push({ id, n: n || 1, x: px, z: pz, f, t: 0 });
}
function pickupsStep(dt) {
  for (let k = pickups.length - 1; k >= 0; k--) {
    const p = pickups[k]; p.t += dt; const d = near(p, player);
    if (p.t > .4 && d < 2.4 && !hero.dead) { const v = Math.min(d, dt * 12); p.x += (player.x - p.x) / d * v; p.z += (player.z - p.z) / d * v; }
    p.f.x = p.x; p.f.z = p.z;
    if (p.t > .4 && d < .5) {
      addItem(p.id, p.n); sfx(p.id === 'coin' ? 'coin' : 'item');
      floatText(p.id === 'coin' ? '+' + p.n : t('item.' + p.id), p.x, 1.4, p.z, 'gold'); if (p.id !== 'coin') questEvent('collect', p.id);
      p.f.dispose(); pickups.splice(k, 1);
    }
  }
}

/* hazards: ink marks on the floor that burst after a delay (the boss's lines and rain); the mark is the tell */
const hazards = [];
function hazard(x, z, delay, r, atk) { const f = fx('rain_mark', x, z, { loop: true, life: delay + .25, size: 1.4, fps: 6 }); hazards.push({ x, z, t: delay, r, atk, f }); }
function hazardsStep(dt) {
  for (let k = hazards.length - 1; k >= 0; k--) {
    const h = hazards[k]; h.t -= dt;
    if (h.t <= 0) { fx('ink_splash', h.x, h.z, { size: 1.1 }); if (Math.hypot(player.x - h.x, player.z - h.z) < h.r) hurtHero(h.atk, h.x, h.z); hazards.splice(k, 1); }
  }
}

// ---- engine/58-audio.js
/* ---------- audio: four voices like an old console (two pulses, a triangle, noise); effects and looping tracks ---------- */
// Everything is made here in code; nothing is loaded. Audio starts on the first input (the mobile rule); any error turns
// sound off and the game goes on.
let AU = null;   // { ctx, fx, mus, layer, waves, noise }
const MUSIC = {};   // content: name → { bpm, voices: { p1, p2, p3, tri, drums } }
const VOL = [0, .35, .7, 1];

function audioInit() {
  if (AU || (!settings.sound && !settings.music)) return AU;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(), out = ctx.createDynamicsCompressor(); out.connect(ctx.destination);
    const fxG = ctx.createGain(), mus = ctx.createGain(); fxG.connect(out); mus.connect(out);
    const pulse = (duty) => { const n = 32, re = new Float32Array(n), im = new Float32Array(n); for (let k = 1; k < n; k++) im[k] = 2 / (k * Math.PI) * Math.sin(k * Math.PI * duty); return ctx.createPeriodicWave(re, im); };
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    AU = { ctx, fx: fxG, mus, waves: { p1: pulse(.5), p2: pulse(.25), p3: pulse(.125) }, noise: nb, track: null };
    audioVolumes();
  } catch (e) { settings.sound = settings.music = 0; AU = null; }
  return AU;
}
function audioVolumes() { if (!AU) return; AU.fx.gain.value = VOL[+settings.sound || 0] * .5; AU.mus.gain.value = VOL[+settings.music || 0] * .32; }

// one note: a voice ('p1' | 'p2' | 'p3' | 'tri' | 'sine'), frequency (optionally sliding to f1), at, length, volume
function tone(dest, wave, f0, f1, at, len, vol) {
  const c = AU.ctx, o = c.createOscillator(), g = c.createGain();
  if (wave === 'tri' || wave === 'sine') o.type = wave === 'tri' ? 'triangle' : 'sine'; else o.setPeriodicWave(AU.waves[wave]);
  o.frequency.setValueAtTime(f0, at); if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + len);
  g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(vol, at + .004); g.gain.setValueAtTime(vol, at + len * .6); g.gain.exponentialRampToValueAtTime(.0001, at + len);
  o.connect(g); g.connect(dest); o.start(at); o.stop(at + len + .02);
}
function hiss(dest, at, len, vol, freq, q) {
  const c = AU.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  s.buffer = AU.noise; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q || 1;
  g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(.0001, at + len);
  s.connect(f); f.connect(g); g.connect(dest); s.start(at, Math.random() * .5); s.stop(at + len + .02);
}

const SFX = {
  swing: (a, d) => hiss(d, a, .09, .5, 2400, .7),
  swing3: (a, d) => { hiss(d, a, .14, .6, 1600, .7); tone(d, 'p2', 300, 160, a, .1, .12); },
  hit: (a, d) => { tone(d, 'p1', 220, 90, a, .08, .3); hiss(d, a, .06, .5, 3000); },
  ehurt: (a, d) => tone(d, 'p2', 520, 260, a, .1, .2),
  defeat: (a, d) => { tone(d, 'p2', 400, 80, a, .3, .22); hiss(d, a + .05, .25, .3, 900); },
  hurt: (a, d) => { tone(d, 'p1', 330, 110, a, .2, .3); hiss(d, a, .12, .3, 1200); },
  dodge: (a, d) => hiss(d, a, .14, .35, 1800, .5),
  dash: (a, d) => { hiss(d, a, .26, .45, 900, .6); tone(d, 'p3', 200, 600, a, .2, .12); },
  well: (a, d) => { tone(d, 'tri', 160, 60, a, .4, .5); hiss(d, a, .35, .4, 500); },
  notice: (a, d) => tone(d, 'p2', 880, 1320, a, .08, .12),
  slam: (a, d) => { tone(d, 'sine', 120, 45, a, .2, .6); hiss(d, a, .12, .3, 400); },
  coin: (a, d) => { tone(d, 'p2', 988, 0, a, .06, .14); tone(d, 'p2', 1319, 0, a + .06, .14, .14); },
  item: (a, d) => [523, 659, 784].forEach((f, i) => tone(d, 'p2', f, 0, a + i * .07, .1, .14)),
  level: (a, d) => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(d, 'p1', f, 0, a + i * .09, .12, .16)),
  chest: (a, d) => { tone(d, 'tri', 196, 0, a, .1, .4); [659, 784, 988].forEach((f, i) => tone(d, 'p2', f, 0, a + .12 + i * .08, .12, .14)); },
  door: (a, d) => { hiss(d, a, .2, .3, 300, 2); tone(d, 'tri', 110, 90, a, .16, .4); },
  blip: (a, d, f) => tone(d, 'p2', f || 330, 0, a, .05, .08),
  move: (a, d) => tone(d, 'p2', 660, 0, a, .04, .08),
  ok: (a, d) => { tone(d, 'p2', 660, 0, a, .05, .1); tone(d, 'p2', 990, 0, a + .05, .08, .1); },
  save: (a, d) => [784, 988, 1175, 1568].forEach((f, i) => tone(d, 'p3', f, 0, a + i * .07, .1, .12)),
  quest: (a, d) => [392, 523, 659, 784, 1047].forEach((f, i) => tone(d, 'p1', f, 0, a + i * .1, .16, .16)),
  over: (a, d) => [392, 330, 262, 196].forEach((f, i) => tone(d, 'p1', f, f * .97, a + i * .22, .26, .18)),
  no: (a, d) => tone(d, 'p2', 180, 140, a, .12, .14),
};
function sfx(name, arg) {
  if (!settings.sound || !audioInit()) return;
  try { if (AU.ctx.state === 'suspended') AU.ctx.resume(); SFX[name](AU.ctx.currentTime + .005, AU.fx, arg); } catch (e) { /* a lost voice is not worth a crash */ }
}
const blip = (f) => sfx('blip', f);

/* music: tracks are step patterns; '.' rests, '-' holds the previous note, drums use k (kick), s (snare), h (hat) */
const NOTE = { c: 0, 'c#': 1, d: 2, 'd#': 3, e: 4, f: 5, 'f#': 6, g: 7, 'g#': 8, a: 9, 'a#': 10, b: 11 };
const freq = (tok) => { const m = /^([a-g]#?)(\d)$/.exec(tok); return m ? 440 * Math.pow(2, (NOTE[m[1]] + (+m[2] + 1) * 12 - 69) / 12) : 0; };
const parseVoice = (s) => (s || '').replace(/\|/g, ' ').trim().split(/\s+/).filter(Boolean);
function playTrack(name) {
  if (!audioInit() || (AU.track && AU.track.name === name)) return;
  const c = AU.ctx, old = AU.track;
  if (old) { old.gain.gain.setTargetAtTime(0, c.currentTime, .3); setTimeout(() => old.gain.disconnect(), 1500); }
  const T = MUSIC[name]; if (!T) { AU.track = null; return; }
  const gain = c.createGain(); gain.connect(AU.mus);
  gain.gain.setValueAtTime(0, c.currentTime); gain.gain.setTargetAtTime(1, c.currentTime, .4);
  const v = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, s]) => [k, parseVoice(s)]));
  AU.track = { name, T, gain, voices: v(T.voices), step: 0, next: c.currentTime + .1, dur: 60 / T.bpm / 4 };
}
function musicTick() {
  if (!AU || !AU.track || !settings.music) return;
  const tr = AU.track, c = AU.ctx; if (c.state === 'suspended') return;
  if (tr.next < c.currentTime - .5) tr.next = c.currentTime + .05;   // after a pause: start again, do not race to catch up
  while (tr.next < c.currentTime + .25) {
    const dest = tr.gain;
    for (const [k, notes] of Object.entries(tr.voices)) {
      if (!notes.length) continue; const tok = notes[tr.step % notes.length];
      if (k === 'drums') { if (tok === 'k') tone(dest, 'sine', 140, 45, tr.next, .12, .7); else if (tok === 's') hiss(dest, tr.next, .1, .45, 1800, .8); else if (tok === 'h') hiss(dest, tr.next, .03, .25, 8000, 1); continue; }
      const f = freq(tok); if (!f) continue;
      let len = 1; while (notes[(tr.step + len) % notes.length] === '-' && len < 16) len++;
      tone(dest, k === 'tri' ? 'tri' : k === 'p2' ? 'p2' : k === 'p3' ? 'p3' : 'p1', f, 0, tr.next, len * tr.dur * .95, k === 'tri' ? .34 : .12);
    }
    tr.step++; tr.next += tr.dur;
  }
}

// ---- engine/60-input.js
/* ---------- input: keyboard, touch (stick + buttons) and gamepad feed one set of actions ---------- */
// move: a vector; pressed actions (attack, dodge, skill1, skill2, interact, menu, rotateL, rotateR) are queued once per
// press, never repeated by a held key
const input = { keys: new Set(), stickX: 0, stickY: 0, padX: 0, padY: 0, queue: [], padPrev: {} };
const KEYMAP = { ' ': 'interact', enter: 'interact', escape: 'menu', tab: 'menu', q: 'rotateL', e: 'rotateR', j: 'attack', z: 'attack', k: 'dodge', x: 'dodge', shift: 'dodge', l: 'skill1', c: 'skill1', u: 'skill2', v: 'skill2' };

function inputSetup() {
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (isTyping(e) && e.key !== 'Escape')) return;
    const k = e.key.toLowerCase();
    if (k === 'tab' && ui.screen !== 'game') return;   // Tab moves focus in menus; in play it opens the menu
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k) && ui.screen === 'game') e.preventDefault();
    if (e.repeat) return;   // a held key acts once
    input.keys.add(k);
    const act = KEYMAP[k];
    if (act && !(act === 'interact' && document.activeElement && /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName))) input.queue.push(act);
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
  // touch buttons act on press, not on release, so a combo keeps its rhythm
  document.querySelectorAll('[data-action]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { e.preventDefault(); input.queue.push(b.dataset.action); } });
    b.addEventListener('click', (e) => { if (e.detail === 0 || !coarse) input.queue.push(b.dataset.action); });
  });
}
const isTyping = (e) => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

// gamepad: left stick moves; A hits (or talks), B dodges, X and Y are the skills, Start opens the menu, shoulders turn the view
function pollPad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : []; const p = pads && [...pads].find(Boolean);
  input.padX = input.padY = 0; if (!p) return;
  const dz = (v) => Math.abs(v) < .2 ? 0 : v;
  input.padX = dz(p.axes[0] || 0); input.padY = -dz(p.axes[1] || 0);
  const edge = (i, act) => { const on = !!(p.buttons[i] && p.buttons[i].pressed); if (on && !input.padPrev[i]) input.queue.push(act); input.padPrev[i] = on; };
  edge(0, 'attack'); edge(1, 'dodge'); edge(2, 'skill1'); edge(3, 'skill2'); edge(9, 'menu'); edge(4, 'rotateL'); edge(5, 'rotateR');
}

// the move vector in screen terms: x right, y up
function moveVector() {
  let x = input.stickX + input.padX, y = input.stickY + input.padY; const k = input.keys;
  if (k.has('a') || k.has('arrowleft')) x -= 1; if (k.has('d') || k.has('arrowright')) x += 1;
  if (k.has('w') || k.has('arrowup')) y += 1; if (k.has('s') || k.has('arrowdown')) y -= 1;
  const l = Math.hypot(x, y); return l > 1 ? [x / l, y / l] : [x, y];
}

// ---- engine/62-world.js
/* ---------- the living world: quests, villagers, chests, reading desks, spawns and scripted moments ---------- */
// QUESTS (content): id → { name, main?, steps: [{ text, on: [event, what, count?], then?() }], reward?: { xp, coins, item } }
//   events: 'talk' (npc id), 'collect' (item id), 'defeat' (enemy type), 'reach' (area id), 'flag' (flag name)
// NPCS (content): id → { sheet, row, name, pic, talk() → { lines, after?, shop? } }
// SPEAKERS (content): id → { name, pic } — who a ['speaker', 'key'] dialogue line belongs to
const QUESTS = {}, NPCS = {}, SPEAKERS = {}, AREA_HOOKS = {};
const CHAPTER = {};   // content: { intro?() } — what happens the first time a new game starts
const npcs = [];

// tips: def.tips = [{ rect: [x0, z0, x1, z1], text: () => key }]; shown once per visit when the cat steps into the rect
let tipsShown = new Set();
function tipsStep() {
  if (!A.def.tips || dlg) return;
  for (const tip of A.def.tips) {
    const [x0, z0, x1, z1] = tip.rect, inside = player.x >= x0 && player.x <= x1 && player.z >= z0 && player.z <= z1;
    if (inside && !tipsShown.has(tip)) { tipsShown.add(tip); toast(t(tip.text())); }
    else if (!inside && tipsShown.has(tip) && Math.min(player.x - x0, x1 - player.x, player.z - z0, z1 - player.z) < -3) tipsShown.delete(tip);   // well away: may show again
  }
}

const qState = (id) => G.quests[id] || null;                      // { s: step, n: count } or null (not started)
const qStep = (id) => { const q = qState(id); return q ? q.s : -1; };
const qDone = (id) => !!QUESTS[id] && qStep(id) >= QUESTS[id].steps.length;
function startQuest(id) { if (qState(id)) return; G.quests[id] = { s: 0, n: 0 }; sfx('quest'); toast(t('toast.quest', { q: t(QUESTS[id].name) })); questEvent('flag', null); }
function setFlag(f) { if (G.flags[f]) return; G.flags[f] = true; questEvent('flag', f); }
function questEvent(type, what) {
  if (!G) return;
  for (const [id, Q] of Object.entries(QUESTS)) {
    const q = qState(id); if (!q || q.s >= Q.steps.length) continue;
    const st = Q.steps[q.s], [ev, w, n] = st.on;
    const match = ev === 'check' && w() || ev === type && (w === what || w === '*') || (ev === 'flag' && G.flags[w]) || (ev === 'collect' && has(w, n || 1)) || (ev === 'reach' && A && A.def.id === w);
    if (!match) continue;
    if (ev === 'defeat' && ++q.n < (n || 1)) { toast(t('toast.count', { n: q.n, of: n })); continue; }
    q.s++; q.n = 0; if (st.then) st.then();
    if (q.s >= Q.steps.length) {
      const r = Q.reward || {}; if (r.coins) G.coins += r.coins; if (r.item) addItem(r.item); if (r.xp) gainXp(r.xp);
      sfx('quest'); toast(t('toast.questdone', { q: t(Q.name) }));
    } else toast(t('toast.questnext', { q: t(Q.name) }));
    saveGame(); questEvent(type === 'flag' ? 'flag' : 'none', null);   // a finished step may already satisfy the next one
  }
}

/* villagers: stand where the area puts them, turn to the cat when it talks to them */
function spawnNpc(id, x, z, face) {
  const N = NPCS[id]; if (!N) throw new Error('no npc "' + id + '"');
  const row = N.row, a = sheetActor(N.sheet || 'villagers', { down: row, up: row, side: row },
    { idle: { down: ['down_idle'], up: ['up_idle'], side: ['side_idle'] }, walk: { down: ['down_walk1', 'down_walk2'], up: ['up_idle'], side: ['side_walk1', 'side_walk2'] } });
  a.x = x; a.z = z; if (face) { a.fx = face[0]; a.fz = face[1]; }
  const n = { id, N, a, x, z, home: face || [0, 1] };
  A.solids.push({ x0: x - .35, z0: z - .3, x1: x + .35, z1: z + .3 });
  A.acts.push({ x, z, r: 1.7, label: 'act.talk', npc: n, name: N.name });
  npcs.push(n); return n;
}
/* chests: kept out of the baked ground, all of an area's chests in one mesh (rebuilt when one opens: a few chests,
   a millisecond); a closed chest shows a faint sparkle while something is inside, an opened one its open sprite */
const chests = new Map(); let chestMesh = null;
function chestProp(id, key, x, z, o) {
  const sparkle = G.opened[id] ? null : fx('sparkle', x, z, { loop: true, size: .7, fps: 3, y: A.groundY(x, z) + 1.5 });
  if (sparkle && player) sparkle.mesh.visible = Math.hypot(x - player.x, z - player.z) < 14;
  chests.set(id, { id, key, x, z, o, sparkle });
}
function chestsBuild() {
  if (chestMesh) chestMesh.dispose(); chestMesh = null; if (!chests.size) return;
  chestMesh = propMesh([...chests.values()].map((c) => [G.opened[c.id] ? 'chest_open' : c.key, c.x, c.z, { rot: c.o.rot, flip: c.o.flip }]));
}
function openChestProp(id) {
  const c = chests.get(id); if (!c) return;
  if (c.sparkle) { c.sparkle.dispose(); c.sparkle = null; } chestsBuild();
  fx('sparkle', c.x, c.z, { size: 1.2, fps: 8, y: A.groundY(c.x, c.z) + 1 });
}
function clearChests() { if (chestMesh) chestMesh.dispose(); chestMesh = null; chests.clear(); }
function clearNpcs() { for (const n of npcs) n.a.dispose(); npcs.length = 0; }
function npcsStep(dt) {
  for (const c of chests.values()) if (c.sparkle) c.sparkle.mesh.visible = Math.hypot(c.x - player.x, c.z - player.z) < 14;   // sparkles only near the cat: each one is a draw call
  for (const n of npcs) {
    const d = near(n, player);
    if (d < 2.6) { const l = d || 1; n.a.fx = (player.x - n.x) / l; n.a.fz = (player.z - n.z) / l; } else { n.a.fx = n.home[0]; n.a.fz = n.home[1]; }
  }
}

/* what Space does next to something */
function interact(act) {
  if (act.npc) {
    const n = act.npc, r = n.N.talk();
    questEvent('talk', n.id);
    openDialogue({ name: n.N.name, pic: n.N.pic, lines: r.lines, voice: n.N.voice, after: () => { if (r.after) r.after(); if (r.shop) openShop(r.shop); } });
    return;
  }
  if (act.chest) {
    const c = act.chest; if (G.opened[c.id]) { openDialogue({ name: 'act.chest', lines: ['chest.empty'] }); return; }
    if (c.need && !has(c.need)) { sfx('no'); openDialogue({ name: 'act.chest', lines: [c.needLine || 'chest.locked'] }); return; }
    G.opened[c.id] = true; addItem(c.item, c.n || 1); sfx('chest'); if (c.flag) G.flags[c.flag] = true; openChestProp(c.id);
    const found = [t('chest.found', { item: c.item === 'coin' ? t('item.coins', { n: c.n }) : t('item.' + c.item) })].concat((c.lines || []).map((k) => t(k)));
    openDialogue({ name: 'act.chest', lines: found, raw: true, after: () => { questEvent('collect', c.item); if (c.flag) questEvent('flag', c.flag); saveGame(); } });
    return;
  }
  if (act.desk) {
    G.hp = stats().hp; G.ink = stats().ink;
    const ok = saveGame(); sfx(ok ? 'save' : 'no');
    openDialogue({ name: 'act.desk', lines: [ok ? 'desk.saved' : 'desk.failed'], after: act.after });
    return;
  }
  if (act.run) { act.run(); return; }
  openDialogue(act);
}

/* the area's living layer: villagers, enemies, chests, desks, hooks; called after the ground is built */
function populate(def) {
  clearEnemies(); clearNpcs(); clearFlats(); clearFloats(); clearChests();
  A.show && A.show();
  for (const [key, x, z, , , o] of def.things || []) {
    if (!o || (o.when && !o.when())) continue;
    const d = AP.sprites[key].d || 8, front = z + d * P / 2 + .5;
    if (o.chest) { A.acts.push({ x, z: front, r: 1.4, label: 'act.open', chest: o.chest, name: 'act.chest', when: () => !G.opened[o.chest.id] }); chestProp(o.chest.id, key, x, z, o); }
    if (o.desk) A.acts.push({ x, z: front, r: 1.4, label: 'act.read', desk: true, name: 'act.desk' });
    if (o.act) A.acts.push(Object.assign({ x, z: front, r: 1.4 }, o.act));
  }
  chestsBuild();
  for (const [id, x, z, face, when] of def.npcs || []) if (!when || when()) spawnNpc(id, x, z, face);
  tipsShown = new Set();
  for (const [type, x, z, when] of def.spawns || []) if (!when || when()) spawnEnemy(type, x, z);
  if (AREA_HOOKS[def.id]) AREA_HOOKS[def.id]();
  if (G) { G.seen[def.id] = true; questEvent('reach', def.id); }
}

// ---- engine/70-ui.js
/* ---------- ui: dialogue with portraits, hint, toast, HUD, fade (HTML over the canvas) ---------- */
let dlg = null, nearAct = null;
const ui = { screen: 'title' };   // title | game | menu | menu-title | shop | over

/* portraits: drawn from the portraits sheet into a small canvas */
function drawPic(el, sheet, name) {
  const SH = SHEETS[sheet], r = SH && name && SH.meta.sprites[name]; el.hidden = !r; if (!r) return;
  el.width = r.w; el.height = r.h; const x = el.getContext('2d'); x.imageSmoothingEnabled = false; x.clearRect(0, 0, r.w, r.h); x.drawImage(SH.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
}

/* dialogue: a line is a language key, or [speaker, key, vars?]; text scrolls with a blip, a press shows the rest, the next goes on */
function showPage() {
  const L = dlg.lines[dlg.i], page = L.text, n = Math.min(page.length, Math.floor(dlg.n));
  if (dlg.shown !== dlg.i) {
    dlg.shown = dlg.i; const sp = L.who ? SPEAKERS[L.who] || {} : {};
    $('dWho').textContent = t(sp.name || dlg.name); drawPic($('dPic'), 'portraits-1', L.who ? sp.pic : dlg.pic);
  }
  $('dText').textContent = page.slice(0, n); $('dMore').hidden = n < page.length || (dlg.choices && dlg.i === dlg.lines.length - 1);
  // choices: buttons under the last page, once its text is all out
  const box = $('dChoices'), want = dlg.choices && dlg.i === dlg.lines.length - 1 && n >= page.length;
  if (want && !box.childElementCount) {
    for (const [key, then] of dlg.choices) { const b = document.createElement('button'); b.type = 'button'; b.textContent = t(key); b.onclick = (e) => { e.stopPropagation(); sfx('ok'); box.textContent = ''; dlg = null; $('dialog').hidden = true; then(); }; box.append(b); }
    box.hidden = false; box.firstChild.focus({ preventScroll: true });
  } else if (!want && box.childElementCount) { box.textContent = ''; box.hidden = true; }
}
function openDialogue(a) {
  const raw = (typeof a.lines === 'function' ? a.lines() : a.lines);
  const lines = raw.map((l) => Array.isArray(l) ? { who: l[0], text: t(l[1], l[2]) } : { text: a.raw ? l : t(l) });
  dlg = { lines, i: 0, n: reduceMotion ? 1e9 : 0, voice: a.voice || 330, last: 0, name: a.name, pic: a.pic, after: a.after, shown: -1, choices: a.choices };
  $('dChoices').textContent = ''; $('dChoices').hidden = true; $('dialog').hidden = false; showPage(); if (player) player.moving = false;
}
function advance() {
  if (!dlg) { if (nearAct) interact(nearAct); return; }
  const page = dlg.lines[dlg.i].text;
  if (dlg.n < page.length) dlg.n = page.length;
  else if (dlg.choices && dlg.i === dlg.lines.length - 1) return;   // a choice must be picked
  else if (++dlg.i < dlg.lines.length) dlg.n = reduceMotion ? 1e9 : 0;
  else { const after = dlg.after; dlg = null; $('dialog').hidden = true; if (after) after(); return; }
  showPage();
}
function tickDialogue(dt) {
  if (!dlg) return; const page = dlg.lines[dlg.i].text;
  if (dlg.n < page.length) { dlg.n += dt * 42; const n = Math.floor(dlg.n); if (n !== dlg.last) { dlg.last = n; if (n % 2 === 0 && page[n - 1] !== ' ') blip(dlg.voice); showPage(); } }
}

let hintState = null;
function setHint(a) {
  const key = a ? 'z:' + a.label : 'base';
  if (key === hintState) return; hintState = key;
  $('hint').textContent = a ? t(coarse ? 'hint.act.touch' : 'hint.act', { what: t(a.label) }) : t(coarse ? 'hint.touch' : 'hint.keys');
  $('bAtk').textContent = t(a ? 'btn.talk' : 'btn.atk');
}

let toastT = 0;
function toast(text) { const el = $('toast'); el.textContent = text; el.hidden = false; toastT = 2.6; }
function toastTick(dt) { if (toastT > 0 && (toastT -= dt) <= 0) $('toast').hidden = true; }

/* HUD: health, ink, level, coins; the DOM is touched only when a number changes */
let hudKey = '';
function hudDraw() {
  if (!G) return; const s = stats(), ink = Math.floor(G.ink), key = [G.hp, s.hp, ink, s.ink, G.level, G.coins, G.flags.skill_dash, G.flags.skill_well, settings.lang].join();
  if (key === hudKey) return; hudKey = key;
  $('hpBar').style.width = (100 * G.hp / s.hp).toFixed(1) + '%'; $('inkBar').style.width = (100 * ink / s.ink).toFixed(1) + '%';
  $('hpNum').textContent = G.hp + '/' + s.hp; $('inkNum').textContent = ink + '/' + s.ink;
  $('hLv').textContent = t('hud.lv', { n: G.level }); $('hCoins').textContent = t('hud.coins', { n: G.coins });
  $('bDash').hidden = !G.flags.skill_dash; $('bWell').hidden = !G.flags.skill_well;
}

/* the boss's health, across the top while a boss (T.boss: its name key) is alive; the mark is where its second phase starts */
let bossKey = '';
function bossDraw() {
  const b = enemies.find((e) => e.T.boss && e.hp > 0);
  const key = b ? Math.ceil(b.hp) + '/' + settings.lang : '';
  if (key === bossKey) return; bossKey = key; $('bossBar').hidden = !b; if (!b) return;
  $('bossName').textContent = t(b.T.boss); $('bossFill').style.width = (100 * Math.max(0, b.hp) / b.T.hp).toFixed(1) + '%';
  $('bossBar').setAttribute('aria-valuenow', String(Math.round(100 * b.hp / b.T.hp)));
}

/* fade between areas: out, swap, in */
function fade(to) { const f = $('fade'); f.style.opacity = to; return new Promise((ok) => setTimeout(ok, reduceMotion ? 0 : 260)); }

// ---- engine/72-menus.js
/* ---------- menus: title, pause menu (items, equipment, quests, map, options, save code), shop, load code, game over ---------- */
const TABS = ['items', 'equip', 'quests', 'map', 'options', 'code'];
let menuTab = 'items', pick = null;

function showScreen(id) {
  document.body.classList.toggle('playing', !id || id === 'menu' && ui.screen === 'menu' || id === 'shop');
  for (const s of ['title', 'menu', 'shop', 'over', 'codeBox', 'end']) $(s).hidden = s !== id;
  const first = id && $(id).querySelector('button:not([hidden]):not([disabled]), textarea');
  if (first) first.focus({ preventScroll: true }); else canvas.focus({ preventScroll: true });
}
const iconCanvas = (id) => { const c = document.createElement('canvas'); c.className = 'icon'; drawPic(c, 'items-1', id); return c; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const btn = (text, on, cls) => { const b = el('button', cls, text); b.type = 'button'; b.onclick = () => { sfx('ok'); on(); }; return b; };

/* pause menu */
function openMenu(on, onlyOptions) {
  if (!on) { showScreen(null); ui.screen = ui.screen === 'menu-title' ? 'title' : 'game'; if (ui.screen === 'title') showScreen('title'); return; }
  ui.screen = onlyOptions ? 'menu-title' : 'menu'; menuTab = onlyOptions ? 'options' : menuTab;
  document.querySelectorAll('#tabs button').forEach((b) => { b.hidden = onlyOptions && b.dataset.tab !== 'options'; });
  showScreen('menu'); renderTab(); sfx('ok');
}
function renderTab() {
  document.querySelectorAll('#tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === menuTab)));
  for (const k of TABS) $('tab-' + k).hidden = k !== menuTab;
  const box = $('tab-' + menuTab);
  if (menuTab === 'items') renderItems(box); else if (menuTab === 'equip') renderEquip(box); else if (menuTab === 'quests') renderQuests(box);
  else if (menuTab === 'map') renderMap(box); else if (menuTab === 'code') renderCode(box);
}
function renderItems(box) {
  box.textContent = ''; const ids = Object.keys(G.inv);
  const head = el('p', 'line', t('menu.coins', { n: G.coins })); box.append(head);
  if (!ids.length) { box.append(el('p', 'dim', t('menu.noitems'))); return; }
  const grid = el('div', 'grid'), info = el('div', 'info');
  for (const id of ids) {
    const b = el('button', 'cell'); b.type = 'button'; b.append(iconCanvas(id), el('span', 'n', G.inv[id] > 1 ? '×' + G.inv[id] : ''));
    b.setAttribute('aria-label', t('item.' + id) + (G.inv[id] > 1 ? ' ×' + G.inv[id] : ''));
    b.onclick = () => { pick = id; sfx('move'); showInfo(info, id); }; grid.append(b);
  }
  box.append(grid, info); if (pick && G.inv[pick]) showInfo(info, pick);
}
function showInfo(info, id) {
  const it = ITEMS[id] || {}; info.textContent = '';
  info.append(el('b', '', t('item.' + id)), el('p', '', t('desc.' + id)));
  const bonus = ['atk', 'def', 'hp', 'ink'].filter((k) => it[k]).map((k) => t('stat.' + k) + ' +' + it[k]).join(' · '); if (bonus) info.append(el('p', 'dim', bonus));
  const row = el('div', 'row');
  if (it.use) row.append(btn(t('menu.use'), () => { if (!useItem(id)) { sfx('no'); toast(t('toast.full')); } renderTab(); }));
  if (it.slot) row.append(btn(t('menu.equip'), () => { equip(id); renderTab(); }));
  info.append(row);
}
function renderEquip(box) {
  box.textContent = ''; const s = stats();
  box.append(el('p', 'line', t('menu.stats', { lv: G.level, hp: s.hp, ink: s.ink, atk: s.atk, def: s.def })), el('p', 'dim', G.level >= 5 ? t('menu.maxlv') : t('menu.xp', { xp: G.xp, next: xpToNext() })));
  for (const slot of ['weapon', 'armour', 'charm']) {
    const id = G.eq[slot], row = el('div', 'slot'); row.append(el('span', 'dim', t('slot.' + slot)));
    if (id) row.append(iconCanvas(id), el('span', '', t('item.' + id))); else row.append(el('span', 'dim', '—'));
    const spare = Object.keys(G.inv).filter((k) => (ITEMS[k] || {}).slot === slot);
    for (const k of spare) row.append(btn(t('menu.swap', { item: t('item.' + k) }), () => { equip(k); renderTab(); }, 'small'));
    box.append(row);
  }
}
function renderQuests(box) {
  box.textContent = ''; const ids = Object.keys(G.quests).sort((a, b) => (QUESTS[b].main ? 1 : 0) - (QUESTS[a].main ? 1 : 0));
  if (!ids.length) { box.append(el('p', 'dim', t('menu.noquests'))); return; }
  for (const id of ids) {
    const Q = QUESTS[id], s = qStep(id), done = s >= Q.steps.length, d = el('div', 'quest' + (done ? ' done' : ''));
    d.append(el('b', '', t(Q.name) + (Q.main ? ' · ' + t('menu.main') : '')), el('p', '', done ? t('menu.qdone') : t(Q.steps[s].text)));
    box.append(d);
  }
}
function renderMap(box) {
  box.textContent = ''; const def = AREAS.overworld, rows = def.map.length, cols = def.map[0].length, k = 5;
  const c = document.createElement('canvas'); c.width = cols * k; c.height = rows * k; c.className = 'map'; const x = c.getContext('2d');
  const col = {}; for (const [ch, g] of Object.entries(def.legend)) { const T = TILES[g.tile], p = T.px; let r = 0, gg = 0, b = 0; for (let o = 0; o < p.length; o += 4) { r += p[o]; gg += p[o + 1]; b += p[o + 2]; } const n = p.length / 4; col[ch] = `rgb(${r / n * (g.h > 20 ? .6 : 1) | 0},${gg / n * (g.h > 20 ? .6 : 1) | 0},${b / n * (g.h > 20 ? .6 : 1) | 0})`; }
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) { x.fillStyle = col[def.map[r][q]]; x.fillRect(q * k, r * k, k, k); }
  x.fillStyle = '#2a2030'; for (const [key, tx, tz] of def.things) if (['library', 'bakery', 'shop', 'house_a', 'house_b', 'church', 'windmill'].includes(key)) x.fillRect(tx / 2 * k - 6, tz / 2 * k - 6, 12, 8);
  const inside = A && A.def.id !== 'overworld';
  const door = inside && def.things.find((th) => th[5] && th[5].door && th[5].door.to === A.def.id), [px, pz] = inside ? (door ? [door[1], door[2]] : [-99, -99]) : [player.x, player.z];
  x.fillStyle = '#ffb85c'; x.fillRect(px / 2 * k - 3, pz / 2 * k - 3, 6, 6); x.strokeStyle = '#000'; x.strokeRect(px / 2 * k - 3.5, pz / 2 * k - 3.5, 7, 7);
  box.append(c, el('p', 'dim', inside ? t('menu.inside', { area: t(A.def.name) }) : t('menu.here')));
}
function renderCode(box) {
  box.textContent = ''; const code = saveCode(), ta = el('textarea', 'code'); ta.readOnly = true; ta.value = code; ta.rows = 4; ta.setAttribute('aria-label', t('menu.code'));
  box.append(el('p', 'dim', t('menu.codehelp')), ta, btn(t('menu.copy'), () => { ta.select(); try { navigator.clipboard.writeText(code).then(() => toast(t('toast.copied'))); } catch (e) { document.execCommand('copy'); } }));
}

/* options: language, frame-rate cap, shadows, screen shake, music, sound; stored as preferences */
function optionsSetup() {
  const seg = (id, val, apply) => document.querySelectorAll(`#${id} button`).forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.v === String(val())));
    b.onclick = () => { apply(b.dataset.v); saveSettings(); sfx('move'); document.querySelectorAll(`#${id} button`).forEach((o) => o.setAttribute('aria-pressed', String(o === b))); };
  });
  seg('optLang', () => settings.lang, (v) => { settings.lang = v; applyLang(); hintState = null; hudKey = ''; if (A) $('areaName').textContent = t(A.name); if (ui.screen === 'menu') renderTab(); });
  seg('optFps', () => settings.fps, (v) => { settings.fps = +v; });
  seg('optShadows', () => settings.shadows ? 'on' : 'off', (v) => { settings.shadows = v === 'on'; sun.castShadow = settings.shadows; shadowHold = 3; });
  seg('optShake', () => settings.shake ? 'on' : 'off', (v) => { settings.shake = v === 'on'; });
  seg('optMusic', () => settings.music, (v) => { settings.music = +v; audioInit(); audioVolumes(); if (A && player) playTrack(areaTrack()); });
  seg('optSound', () => settings.sound, (v) => { settings.sound = +v; audioInit(); audioVolumes(); });
  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => { menuTab = b.dataset.tab; sfx('move'); renderTab(); }; });
  // arrow keys move along the tab row
  $('tabs').addEventListener('keydown', (e) => {
    const vis = [...document.querySelectorAll('#tabs button:not([hidden])')], i = vis.indexOf(document.activeElement); if (i < 0) return;
    const j = e.key === 'ArrowRight' ? (i + 1) % vis.length : e.key === 'ArrowLeft' ? (i + vis.length - 1) % vis.length : -1;
    if (j >= 0) { e.preventDefault(); vis[j].focus(); vis[j].click(); }
  });
  $('bResume').onclick = () => openMenu(false);
}

/* shop: buy with coins; a shop is a list of item ids */
let shopList = null;
function openShop(list) { shopList = list; ui.screen = 'shop'; renderShop(); showScreen('shop'); }
function renderShop() {
  const box = $('shopList'); box.textContent = ''; $('shopCoins').textContent = t('menu.coins', { n: G.coins });
  for (const id of shopList) {
    const it = ITEMS[id], row = el('div', 'slot'), owned = it.slot && has(id);
    row.append(iconCanvas(id), el('span', '', t('item.' + id)), el('span', 'dim', t('desc.' + id)));
    const b = btn(owned ? t('shop.owned') : t('shop.buy', { n: it.price }), () => {
      if (G.coins < it.price) { sfx('no'); toast(t('toast.poor')); return; }
      G.coins -= it.price; addItem(id); sfx('coin'); toast(t('toast.bought', { item: t('item.' + id) })); renderShop();
    }, 'small');
    b.disabled = owned; row.append(b); box.append(row);
  }
}

/* load code (from the title) */
function openCodeBox() { $('codeIn').value = ''; $('codeErr').textContent = ''; ui.screen = 'code'; showScreen('codeBox'); }
function submitCode() {
  const r = readCode($('codeIn').value);
  if (r.error) { $('codeErr').textContent = t(r.error, { ch: r.ch }); sfx('no'); return; }
  G = r.save; saveGame(); beginPlay();
}

// ---- engine/80-loop.js
/* ---------- loop: simulation at a fixed 120 Hz, drawing capped at the chosen 30 / 60 / 120 fps ---------- */
const SIM = 1 / 120;
let frozen = false;
const kept = {};   // areas kept built while the cat is elsewhere (def.keep)
const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4();
let simTime = 0;   // the simulation's own clock (time below is the drawing clock)
let player = null, shadowHold = 8, time = 0, intro = 1, transitioning = false;
let last = performance.now(), acc = 0, drawAcc = 0, frames = 0, fpsT = 0, fps = 0, calls = 0;
const rotate = (d) => { yawT = Math.round(yawT / (Math.PI / 2)) * (Math.PI / 2) + d * Math.PI / 2; };

function enterArea(name, at, face) {
  const def = AREAS[name]; if (!def) throw new Error('no area "' + name + '"');
  if (A) { if (A.def.keep) A.hide(); else A.dispose(); }
  // a kept area (the open world) is reused unless a conditional thing on it changed (a gate opened)
  const old = kept[name], sig = (def.things || []).filter((th) => th[5] && th[5].when).map((th) => th[5].when() ? 1 : 0).join('');
  if (old && old.sig !== sig) { old.dispose(); delete kept[name]; }
  A = kept[name] || openArea(def); if (def.keep) kept[name] = A;
  player.x = at ? at[0] : def.start[0]; player.z = at ? at[1] : def.start[1];
  const [tx, tz] = camGoal(Math.max(VT, minV())); camT.set(tx, A.groundY(player.x, player.z) * .5, tz);
  A.open(player.x, player.z);
  if (face) { player.fx = face[0]; player.fz = face[1]; }
  tod = Math.max(0, TODS.findIndex((x) => x.label === (def.tod || 'giorno'))); applyTod(1);
  $('areaName').textContent = t(def.name); hintState = null; shadowHold = 8; dlg = null; $('dialog').hidden = true;
  if (G) G.area = name;
  populate(def); unstick(def); playTrack(areaTrack());
}
// a save from an older layout (or any arrival) may put the cat inside something that moved there since: step out to
// the nearest free spot, searched in rings of a quarter unit out to 8 units; failing that, the area's start
function unstick(def) {
  if (!A.blocked(player.x, player.z)) return;
  const y0 = A.groundY(player.x, player.z);
  for (let r = .25; r <= 8; r += .25) for (let k = 0, n = Math.ceil(r * 8); k < n; k++) {
    const a = k / n * Math.PI * 2, x = player.x + Math.cos(a) * r, z = player.z + Math.sin(a) * r;
    const inExit = A.exits.some(({ rect: [x0, z0, x1, z1] }) => x >= x0 - .4 && x <= x1 + .4 && z >= z0 - .4 && z <= z1 + .4);
    if (!A.blocked(x, z) && !inExit && Math.abs(A.groundY(x, z) - y0) < .25) { player.x = x; player.z = z; return; }   // same level, not in a doorway
  }
  player.x = def.start[0]; player.z = def.start[1];
}
async function goTo(exit) {
  transitioning = true; player.moving = false; sfx('door');
  await fade(1); enterArea(exit.to, exit.at, exit.face); saveGame(); await fade(0);
  transitioning = false;
}

// the zone's track, or the battle track while an enemy has noticed the cat (and for a moment after); the boss keeps its own
const areaTrack = () => {
  const zone = typeof A.def.music === 'function' ? A.def.music(player.x, player.z) : A.def.music || 'village';
  return combatT > 0 && zone !== 'boss' && MUSIC.battle ? 'battle' : zone;
};

function step(dt) {
  simTime += dt;
  while (input.queue.length) {
    const act = input.queue.shift();
    if (act === 'menu') {
      if (ui.screen === 'game' && !dlg) openMenu(true);
      else if (ui.screen === 'menu' || ui.screen === 'menu-title') openMenu(false);
      else if (ui.screen === 'shop') closeShop();
      else if (ui.screen === 'code') { ui.screen = 'title'; showScreen('title'); }
      continue;
    }
    if (ui.screen !== 'game' || transitioning) continue;
    if (act === 'interact') { if (dlg || nearAct) advance(); }
    else if (act === 'attack') { if (dlg) advance(); else if (nearAct && !nearestEnemy(4)) advance(); else heroAttack(); }
    else if (act === 'dodge') { if (!dlg) heroDodge(); }
    else if (act === 'skill1') { if (!dlg) heroDodge('dash'); }
    else if (act === 'skill2') { if (!dlg) heroDodge('well'); }
    else if (act === 'rotateL') rotate(-1); else if (act === 'rotateR') rotate(1);
  }
  if (ui.screen !== 'game' || transitioning || !A) { if (player) player.moving = false; return; }
  if (!dlg) { heroStep(dt); enemiesStep(dt); hazardsStep(dt); pickupsStep(dt); npcsStep(dt); tipsStep(); } else player.moving = false;
  if (!hero.dead && !dlg) for (const ex of A.exits) { if (ex.when && !ex.when()) continue; const [x0, z0, x1, z1] = ex.rect; if (player.x >= x0 && player.x <= x1 && player.z >= z0 && player.z <= z1) {
    if (ex.need && !has(ex.need)) { player.z += z1 - player.z + .25; sfx('no'); toast(t('toast.door', { item: t('item.' + ex.need) })); break; }   // a locked door pushes the cat back
    goTo(ex); break;
  } }
  nearAct = null; let best = 1e9;
  if (!hero.dead) for (const a of A.acts) { if (a.when && !a.when()) continue; const d = Math.hypot(a.x - player.x, a.z - player.z); if (d < a.r && d < best) { best = d; nearAct = a; } }
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
  _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)); A.tris = A.visibleTris(_frustum);
  if (shakeT > 0) { shakeT = Math.max(0, shakeT - dt); const k = shakeT * .9; cam.position.x += (R() - .5) * k; cam.position.y += (R() - .5) * k; cam.updateMatrixWorld(); }
  for (const a of actors) a.pose();
  applyTod(1 - Math.exp(-dt * 2.2));
  A.update(dt, player.x, player.z); if (G && ui.screen === 'game') playTrack(areaTrack()); flatsDraw(dt); floatsDraw(dt); hudDraw(); bossDraw(); toastTick(dt); musicTick();
  if (player.moving || enemies.length || pickups.length || player.anim || dlg || Math.abs(yaw - yawT) > 1e-3 || Math.abs(cur.az - TODS[tod].az) + Math.abs(cur.el - TODS[tod].el) > 1e-4) shadowHold = 3;
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
  if (document.hidden || frozen) return;   // frozen: a check drives the simulation itself
  pollPad();
  acc += real; let n = 0; while (acc >= SIM && n < 30) { step(SIM); acc -= SIM; n++; } if (n === 30) acc = 0;
  // the cap keeps its phase: on a 144 Hz screen a 60 cap draws 60 times a second, not every third refresh
  drawAcc += real; const budget = 1 / settings.fps; if (drawAcc + .002 < budget) return; drawAcc = Math.max(0, drawAcc - budget); if (drawAcc > budget) drawAcc = 0;
  draw(budget);
  frames++; fpsT += budget;
  if (fpsT >= .5) { fps = frames / fpsT; frames = 0; fpsT = 0; if (!$('menu').hidden) $('diag').textContent = t('diag', { fps: Math.round(fps), ms: (1000 / Math.max(1, fps)).toFixed(1), tris: Math.round((A ? A.tris : 0) / 1000), calls: calls + 1, build: A ? A.buildMs : 0 }); }
}

// ---- content/chapter1/areas/crypt.js
/* ---------- the crypt under the church: an ink pool crossed with the dash, three levers, the arch to the Scribe ---------- */
// legend: W walls, V low walls (the front, and walls across the room the camera must see past), o floor, w the ink pool
const CRYPT_LEGEND = { o: { tile: 'crypt_floor' }, W: { tile: 'crypt_floor', h: 52, wall: 0x4a4250 }, V: { tile: 'crypt_floor', h: 6, wall: 0x4a4250 }, w: { tile: 'water', water: true, h: -3 } };
AREAS.crypt_in = {
  id: 'crypt_in', name: 'area.crypt', cell: 2, tod: 'cripta', start: [16, 45.4], camNorth: 1, music: 'crypt', halo: 0x8fa8ff,
  legend: CRYPT_LEGEND,
  map: [
    'WWWWWWWWWWWWWWWW',
    'WooooooooooooooW',   // the arch room: the way to the Scribe, the Inkwell in a chest
    'WooooooooooooooW',
    'WooooooooooooooW',
    'WooooooooooooooW',
    'VVVVVVooooVVVVVV',   // the lever gate (inner walls are low, so the camera sees over them)
    'WooooooooooooooW',   // the lever room
    'WooooooooooooooW',
    'WooooooooooooooW',
    'WooooooooooooooW',
    'VVVVVVooooVVVVVV',
    'WwwwwwwwwwwwwwwW',   // the ink pool: too wide to walk, short enough to dash
    'WwwwwwwwwwwwwwwW',
    'WooooooooooooooW',   // the first hall
    'WooooooooooooooW',
    'WooooooooooooooW',
    'WooooooooooooooW',
    'WooooooooooooooW',
    'WooooooooooooooW',
    'WooooooooooooooW',
    'WooooooooooooooW',
    'WooooooooooooooW',
    'WooooooooooooooW',
    'VVVVVVVooVVVVVVV',
  ],
  things: [
    ['crypt_arch', 16, 4, 2.6, .8, { door: { to: 'crypt_boss', at: [14, 21.4], face: [0, -1] } }],
    ['chest', 5, 6.4, undefined, undefined, { chest: { id: 'crypt_well', item: 'ink_potion', n: 2, flag: 'skill_well', lines: ['chest.well', 'chest.well2'] } }],
    ['sarcophagus', 25.5, 5.8],
    ['crypt_wall', 16, 10.6, 4.2, .8, { when: () => !G.flags.crypt_gate }],
    ['lever', 5, 15.4, .3, .3, { act: { label: 'act.pull', name: 'act.lever', run: () => cryptLever(1) } }],
    ['lever', 27, 15.4, .3, .3, { act: { label: 'act.pull', name: 'act.lever', run: () => cryptLever(2) } }],
    ['lever', 22.4, 18.6, .3, .3, { act: { label: 'act.pull', name: 'act.lever', run: () => cryptLever(3) } }],
    ['signpost', 9.6, 18.4, undefined, undefined, { look: { label: 'act.read', name: 'act.plaque', lines: ['plaque.1', 'plaque.2'] } }],
    ['sarcophagus', 7, 32], ['sarcophagus', 25, 32], ['barrel', 3.4, 42.4], ['crate', 28.6, 42.6],
  ],
  lamps: [[3, 3, 3, 2.6, 1.3], [29, 3, 3, 2.6, 1.3], [3, 3, 13, 2.4, 1.2], [29, 3, 13, 2.4, 1.2], [3, 3, 28, 2.4, 1.2], [29, 3, 28, 2.4, 1.2], [3, 3, 40, 2.4, 1.2], [29, 3, 40, 2.4, 1.2]],
  spawns: [['bookworm', 10, 36], ['bookworm', 22, 38], ['wax_golem', 16, 16.4], ['wax_golem', 22, 7.6, () => !G.flags.boss_done]],
  exits: [{ rect: [14, 47.2, 18, 48], to: 'overworld', at: [45, 25.2], face: [0, 1] }],
  // at the pool's edge, from either side: how to cross
  tips: [{ rect: [2, 25.6, 30, 28.6], text: poolTip }, { rect: [12, 19, 20, 22], text: poolTip }],
};

// the Scribe's chamber
AREAS.crypt_boss = {
  id: 'crypt_boss', name: 'area.boss', cell: 2, tod: 'cripta', start: [14, 21.4], camNorth: 1, music: () => G.flags.boss_done ? 'crypt' : 'boss', halo: 0x8fa8ff,
  legend: CRYPT_LEGEND,
  map: [
    'WWWWWWWWWWWWWW',
    'WooooooooooooW',
    'WooooooooooooW',
    'WooooooooooooW',
    'WooooooooooooW',
    'WooooooooooooW',
    'WooooooooooooW',
    'WooooooooooooW',
    'WooooooooooooW',
    'WooooooooooooW',
    'WooooooooooooW',
    'VVVVVVooVVVVVV',
  ],
  things: [['sarcophagus', 5, 4.4], ['sarcophagus', 23, 4.4]],
  lamps: [[3, 3, 3, 2.8, 1.4], [25, 3, 3, 2.8, 1.4], [3, 3, 18, 2.6, 1.2], [25, 3, 18, 2.6, 1.2]],
  exits: [
    { rect: [12, 23.2, 16, 24], to: 'crypt_in', at: [16, 6.8], face: [0, 1], when: () => !G.flags.boss_done },
    { rect: [12, 23.2, 16, 24], to: 'overworld', at: [45, 25.2], face: [0, 1], when: () => !!G.flags.boss_done },
  ],
};

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
  things: [['reading_desk', 13, 7.6, undefined, undefined, { desk: true }], ['statue', 5, 4.6], ['chest', 19.6, 5, undefined, undefined, { chest: { id: 'library', item: 'milk', n: 2 } }], ['crate', 4.4, 11.6], ['barrel', 19.8, 11.4], ['bench', 13, 4.4]],
  npcs: [['librarian', 17.5, 8.4, [0, 1]]], music: 'library',
  lamps: [[6, 3, 8, 3, 1.2], [18, 3, 8, 3, 1.2]],
  exits: [{ rect: [10, 15.2, 16, 16], to: 'overworld', at: [32, 35.6], face: [0, 1] }],
};

// the bakery: barrels of flour, the counter (a market stall indoors)
AREAS.bakery_in = {
  id: 'bakery_in', name: 'area.bakery', cell: 2, tod: 'interno', start: [11, 11.4], camNorth: 1,
  legend: INTERIOR_LEGEND, map: room(10, 7, 5),
  things: [['market_stall', 11, 6], ['barrel', 4, 4.6], ['barrel', 5.6, 4.6], ['crate', 16, 9.6], ['chest', 16, 4.6, undefined, undefined, { chest: { id: 'bakery', item: 'coin', n: 12 } }]],
  npcs: [['baker', 11, 8.6, [0, 1]]], music: 'library',
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
    ['church', 45, 21, undefined, undefined, { door: { to: 'crypt_in', at: [16, 45.4], face: [0, -1], need: 'crypt_key' } }],
    ['chest', 101, 30.6, undefined, undefined, { chest: { id: 'mill', item: 'hinge' } }],
    // the fenced garden south of the road (x 96–104, z 48–56); its gate opens by the lever
    ['fence', 97.3, 48], ['fence', 102.5, 48], ['fence', 99.9, 48, 1.3, .25, { when: () => !G.flags.gate_open }],
    ['fence', 97.3, 56], ['fence', 99.9, 56], ['fence', 102.5, 56],
    ['fence', 96, 49.3, undefined, undefined, { rot: 1 }], ['fence', 96, 51.9, undefined, undefined, { rot: 1 }], ['fence', 96, 54.5, undefined, undefined, { rot: 1 }],
    ['fence', 104, 49.3, undefined, undefined, { rot: 1 }], ['fence', 104, 51.9, undefined, undefined, { rot: 1 }], ['fence', 104, 54.5, undefined, undefined, { rot: 1 }],
    ['lever', 92.6, 46.6, .3, .3, { act: { label: 'act.pull', name: 'act.lever', run: roadLever } }],
    ['chest', 98.5, 51, undefined, undefined, { chest: { id: 'garden_page', item: 'page_2' } }],
    ['chest', 101.6, 51, undefined, undefined, { chest: { id: 'garden_key', item: 'crypt_key', lines: ['chest.cryptkey'] } }],
    ['statue', 86, 47.2, undefined, undefined, { act: { label: 'act.read', name: 'who.statue', run: statueRiddle } }],
    ['windmill', 101, 25], ['vine_row', 78, 26], ['vine_row', 88, 26], ['vine_row', 78, 31.5], ['vine_row', 88, 31.5],
    ['well', 44, 44], ['market_stall', 53, 47], ['bench', 36, 48.5], ['reading_desk', 37.5, 36.6, undefined, undefined, { desk: true }],
    ['lamp_post', 38, 39, .2, .2], ['lamp_post', 50, 39, .2, .2], ['lamp_post', 38, 51, .2, .2], ['lamp_post', 50, 51, .2, .2],
    ['signpost', 62, 38.6, undefined, undefined, { look: { label: 'act.read', name: 'act.sign', lines: ['sign.1'] } }], ['barrel', 59.4, 37.6], ['crate', 60.8, 38.2],
    ['fence', 72, 36.6], ['fence', 74.6, 36.6], ['fence', 77.2, 36.6], ['fence', 92, 36.6], ['fence', 94.6, 36.6],
  ];
  const busy = [[90, 44, 110, 60], [26, 26, 64, 56], [36, 14, 56, 30], [70, 18, 108, 38], [58, 38, 112, 46], [52, 56, 80, 76], [14, 34, 30, 58], [18, 38, 28, 44]];
  const free = (x, z) => !busy.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
  // an olive is ten thousand triangles, a cypress fourteen hundred (tools/budget-check.mjs): no olives in the scatter,
  // the plateau rims get cypresses and bushes
  const pickTree = (v, list) => { let acc = 0; for (const [k, w] of list) { acc += w; if (v < acc) return k; } return list[0][0]; };
  const LOW = [['oak', .3], ['cypress', .45], ['bush', .25]], RIM = [['cypress', .7], ['bush', .25], ['oak', .05]];
  for (let r = 1; r < RW - 1; r++) for (let c = 1; c < C - 1; c++) {
    const ch = map[r][c], x = c * 2 + 1, z = r * 2 + 1, h = hash2(c * 13, r * 29);
    if ((ch === 'g' || ch === 'f') && h > .962 && free(x, z)) { const k = pickTree(hash2(c, r * 7), LOW); things.push([k, x, z, k === 'bush' ? undefined : .6, k === 'bush' ? undefined : .5]); }
    else if (ch === 'X' && h > .93) { const inner = Math.min(c, C - 1 - c, r, RW - 1 - r) >= 6; if (inner) things.push([pickTree(hash2(c * 3, r), RIM), x, z, 0, 0]); }
  }
  return {
    id: 'overworld', name: 'area.village', cell: 2, chunk: [12, 9], keep: true, tod: 'giorno', start: [44, 49], camNorth: 1.5, music: (x) => x > 64 ? 'road' : 'village',
    legend: { g: { tile: 'grass' }, f: { tile: 'grass_flowers' }, c: { tile: 'cobblestone' }, p: { tile: 'dirt_path' }, a: { tile: 'farmland' },
      w: { tile: 'water', water: true, h: -3 }, X: { tile: 'grass', h: 56, cliff: true }, Y: { tile: 'grass_flowers', h: 56, cliff: true } },
    map, things,
    npcs: [['shopkeeper', 53, 49.6, [0, 1]], ['child', 47.6, 45.2, [0, 1]], ['guard', 41.4, 26.2, [0, 1]]],
    spawns: [['blot', 70, 42], ['blot', 80, 43.6], ['blot', 100, 36], ['inkfly', 88, 41.5], ['inkfly', 93, 44.5], ['inkfly', 97, 31.5], ['blot', 76, 38.4]],
    lamps: [[38, 2.6, 39], [50, 2.6, 39], [38, 2.6, 51], [50, 2.6, 51]],
  };
})();

// ---- content/chapter1/enemies.js
/* ---------- the inky creatures of Chapter 1 (spec §10): every strike has a tell of at least 0.35 s ---------- */
Object.assign(ENEMIES, {
  // a puddle of ink with two eyes: squashes flat (the tell), hops to where the cat stood, slams
  blot: { sheet: 'enemies-1', row: 'blot', hp: 30, atk: 6, def: 0, speed: 2.4, sight: 7, reach: 2.2, windup: .5, strike: .38, recover: .8, xp: 4, coins: [0, 2], r: .5, move: 'hop', drops: [['milk', .12]] },
  // a fat drop with paper wings: hovers, stops and shivers (the tell), dives in a line
  inkfly: { sheet: 'enemies-1', row: 'inkfly', hp: 24, atk: 7, def: 0, speed: 3.1, sight: 9, reach: 4.2, windup: .55, strike: .42, recover: 1, xp: 5, coins: [1, 2], r: .45, move: 'lunge', fly: .8, drops: [['ink_potion', .15]] },
  // a long worm of stacked pages: shivers in the dust (the tell), charges straight
  bookworm: { sheet: 'enemies-2', row: 'bookworm', hp: 38, atk: 9, def: 2, speed: 2, sight: 9, reach: 5.5, windup: .65, strike: .6, recover: 1.2, xp: 9, coins: [1, 3], r: .6, move: 'lunge', drops: [['bread', .2]] },
  // a candle-wax brute: raises both arms (the tell), smashes twice; its front is shielded, its back is not
  wax_golem: { sheet: 'enemies-2', row: 'wax_golem', hp: 60, atk: 12, def: 3, speed: 1.5, sight: 7, reach: 1.9, windup: .75, strike: .5, recover: 1.3, xp: 15, coins: [2, 5], r: .7, move: 'smash', shield: true, drops: [['fish', .3]] },
});

/* the Blot Scribe: phase 1 sweeps its quill and draws ink lines; below half health it splits off Blots and calls ink rain.
   Every attack is announced: the quill drawn back, ink marks on the floor 0.6 s before they burst. */
ENEMIES.blot_scribe = {
  sheet: 'boss', row: 'blot_scribe', hp: 900, atk: 13, def: 3, speed: 1.6, sight: 30, reach: 3.4, xp: 60, coins: [8, 12], r: 1.1, poise: true, size: 1, boss: 'who.scribe',
  anims: { idle: ['idle1', 'idle2'], walk: ['idle1', 'idle2'], windup: ['sweep_windup'], attack: ['sweep'], cast: ['blot_scribe_b.rain_cast'], split: ['blot_scribe_b.split'], hurt: ['blot_scribe_b.hurt'], defeat: ['blot_scribe_b.defeat'] },
  onHit(e) { if (!e.phase2 && e.hp < e.T.hp / 2) { e.phase2 = true; e.state = 'split'; e.st = .9; e.a.anim = 'split'; e.a.at = 0; toast(t('toast.boss2')); shake(.3); } },
  ai(e, dt, dist, move, face) {
    const T = e.T, a = e.a; e.cool = (e.cool || 1.5) - dt; a.at += dt;
    switch (e.state) {
      case 'wander': case 'notice': case 'chase': {
        a.anim = null; face(player.x, player.z);
        if (dist > T.reach * .8) a.moving = move(e.fx * T.speed, e.fz * T.speed);
        if (e.cool <= 0) {
          const pick = e.phase2 ? (R() < .5 ? 'rain' : dist < T.reach ? 'sweep' : 'lines') : (dist < T.reach ? 'sweep' : 'lines');
          if (pick === 'sweep') { e.state = 'windup'; e.st = .65; a.anim = 'windup'; a.at = 0; }
          else { e.state = pick; e.st = .9; a.anim = 'cast'; a.at = 0; e.done = false; }
        }
        break;
      }
      case 'windup': e.st -= dt; face(player.x, player.z); if (e.st <= 0) { e.state = 'sweep'; e.st = .4; a.anim = 'attack'; a.at = 0; e.hit = 0; sfx('swing3'); } break;
      case 'sweep': {   // a half-circle in front, quill's length
        e.st -= dt;
        if (!e.hit) { e.hit = 1; fx('slash', e.x + e.fx * 1.6, e.z + e.fz * 1.6, { size: 2.4, y: A.groundY(e.x, e.z) + .6 }); const dx = player.x - e.x, dz = player.z - e.z, d = Math.hypot(dx, dz); if (d < T.reach + .4 && (dx * e.fx + dz * e.fz) / (d || 1) > -.1) hurtHero(T.atk, e.x, e.z); }
        if (e.st <= 0) { e.state = 'chase'; e.cool = e.phase2 ? 1.2 : 1.7; }
        break;
      }
      case 'lines': {   // a line of marks from the Scribe toward the cat
        e.st -= dt;
        if (!e.done && e.st < .6) { e.done = true; const l = dist || 1, ux = (player.x - e.x) / l, uz = (player.z - e.z) / l; for (let i = 1; i <= 6; i++) hazard(e.x + ux * i * 1.3, e.z + uz * i * 1.3, .6 + i * .07, .8, T.atk - 2); }
        if (e.st <= 0) { e.state = 'chase'; e.cool = 1.6; }
        break;
      }
      case 'rain': {   // marks around and under the cat
        e.st -= dt;
        if (!e.done && e.st < .6) { e.done = true; hazard(player.x, player.z, .7, .9, T.atk - 2); for (let i = 0; i < 6; i++) { const an = R() * Math.PI * 2, r = 1.5 + R() * 3.5; hazard(player.x + Math.cos(an) * r, player.z + Math.sin(an) * r, .6 + R() * .5, .9, T.atk - 2); } }
        if (e.st <= 0) { e.state = 'chase'; e.cool = 1.4; }
        break;
      }
      case 'split': {   // phase 2 and then every so often: two Blots, never more than four
        e.st -= dt; a.anim = 'split';
        if (e.st <= 0) { if (enemies.filter((o) => o.type === 'blot' && o.hp > 0).length < 4) for (const s of [-1, 1]) { const b = spawnEnemy('blot', e.x + s * 1.6, e.z + 1.2); b.aware = true; b.T = Object.assign({}, b.T, { coins: [0, 0], xp: 1, drops: [] }); } e.state = 'chase'; e.cool = 1.2; e.splitT = 9; }
        break;
      }
    }
    if (e.phase2 && e.state === 'chase' && (e.splitT = (e.splitT || 9) - dt) <= 0) { e.state = 'split'; e.st = .8; a.anim = 'split'; a.at = 0; }
    return true;
  },
};

// ---- content/chapter1/items.js
/* ---------- items of Chapter 1: three quills, three coats, three charms, four things to eat or drink, story items ---------- */
// names and descriptions are language keys item.<id> and desc.<id>
Object.assign(ITEMS, {
  quill_sword: { slot: 'weapon', atk: 0, price: 0 },
  steel_quill: { slot: 'weapon', atk: 3, price: 60 },
  gold_quill: { slot: 'weapon', atk: 6, price: 0 },
  scarf: { slot: 'armour', def: 1, hp: 4, price: 30 },
  vest: { slot: 'armour', def: 2, price: 55 },
  cloak: { slot: 'armour', def: 3, hp: 6, price: 0 },
  bell_charm: { slot: 'charm', ink: 10, price: 40 },
  clover_charm: { slot: 'charm', hp: 8, price: 0 },
  owl_charm: { slot: 'charm', atk: 2, def: 1, price: 0 },
  milk: { use: { hp: 10 }, price: 6 },
  fish: { use: { hp: 22 }, price: 14 },
  bread: { use: { hp: 15 }, price: 9 },
  ink_potion: { use: { ink: 20 }, price: 12 },
  page_1: { key: true }, page_2: { key: true }, page_3: { key: true },
  bronze_key: { key: true }, crypt_key: { key: true }, glasses_case: { key: true }, letter: { key: true }, flour_sack: { key: true }, hinge: { key: true },
});

// ---- content/chapter1/music.js
/* ---------- the music of Chapter 1: step patterns, one step = a sixteenth; '.' rests, '-' holds; drums k / s / h ---------- */
// A voice loops on its own length. The battle track replaces the zone's track while an enemy is after the cat.
const bars = (...b) => b.join(' | '), rep = (s, n) => Array(n).fill(s).join(' ');
Object.assign(MUSIC, {
  village: {   // C major, a walk through the square
    bpm: 100,
    voices: {
      p1: bars('e5 - - - g5 - c6 - b5 - a5 - g5 - - -', 'a5 - - - c6 - e6 - d6 - c6 - a5 - - -', 'f5 - - - a5 - c6 - a5 - g5 - f5 - - -', 'g5 - - - b5 - d6 - b5 - a5 - g5 - - .',
        'e5 - g5 - e5 - d5 - c5 - - - d5 - e5 -', 'a4 - c5 - e5 - c5 - a4 - - - . . . .', 'f4 - a4 - c5 - f5 - e5 - d5 - c5 - a4 -', 'g4 - b4 - d5 - g5 - - - . . . . . .'),
      p2: bars('c4 . e4 . g4 . e4 . c4 . e4 . g4 . e4 .', 'a3 . c4 . e4 . c4 . a3 . c4 . e4 . c4 .', 'f3 . a3 . c4 . a3 . f3 . a3 . c4 . a3 .', 'g3 . b3 . d4 . b3 . g3 . b3 . d4 . b3 .'),
      tri: bars('c3 - - - . . c3 . g2 - - - . . g2 .', 'a2 - - - . . a2 . e2 - - - . . e2 .', 'f2 - - - . . f2 . c3 - - - . . c3 .', 'g2 - - - . . g2 . d3 - - - b2 - - -'),
    },
  },
  road: {   // G major, brisker, out among the vines
    bpm: 116,
    voices: {
      p1: bars('d5 - g5 - b5 - a5 g5 f#5 - g5 - a5 - - -', 'e5 - g5 - c6 - b5 a5 g5 - e5 - g5 - - -', 'b4 - e5 - g5 - f#5 e5 d5 - e5 - g5 - - -', 'a4 - d5 - f#5 - e5 d5 e5 - f#5 - a5 - - -'),
      p2: bars('. g4 . b4 . g4 . b4 . g4 . b4 . g4 . b4', '. e4 . g4 . e4 . g4 . e4 . g4 . e4 . g4', '. e4 . g4 . e4 . g4 . e4 . g4 . e4 . g4', '. f#4 . a4 . f#4 . a4 . f#4 . a4 . f#4 . a4'),
      tri: bars('g2 . g2 . d3 . g2 . g2 . d3 . g2 . b2 .', 'c3 . c3 . g2 . c3 . c3 . g2 . c3 . e3 .', 'e2 . e2 . b2 . e2 . e2 . b2 . e2 . g2 .', 'd2 . d2 . a2 . d2 . d2 . a2 . d3 . c3 .'),
      drums: 'k . h . s . h . k . h . s . h h',
    },
  },
  library: {   // the same tune as the village, slower and softer, for rooms
    bpm: 84,
    voices: {
      p3: bars('e5 - - - g5 - c6 - b5 - a5 - g5 - - -', 'a5 - - - c6 - e6 - d6 - c6 - a5 - - -', 'f5 - - - a5 - c6 - a5 - g5 - f5 - - -', 'g5 - - - b5 - d6 - b5 - a5 - g5 - - .'),
      tri: bars('c3 - - - - - - - g2 - - - - - - -', 'a2 - - - - - - - e2 - - - - - - -', 'f2 - - - - - - - c3 - - - - - - -', 'g2 - - - - - - - d3 - - - - - - -'),
    },
  },
  crypt: {   // A minor, slow, a drone under a sparse line
    bpm: 80,
    voices: {
      p3: bars('a4 - - - - - c5 - b4 - - - g#4 - - -', 'a4 - - - e5 - - - d5 - c5 - b4 - - -', 'f4 - - - - - a4 - g4 - - - e4 - - -', 'e4 - - - g#4 - - - b4 - - - - - - -'),
      p2: bars('a3 . c4 . e4 . . . a3 . c4 . e4 . . .', 'a3 . c4 . e4 . . . a3 . c4 . e4 . . .', 'f3 . a3 . c4 . . . f3 . a3 . c4 . . .', 'e3 . g#3 . b3 . . . e3 . g#3 . b3 . . .'),
      tri: bars('a2 - - - - - - - - - - - - - - -', 'a2 - - - - - - - - - - - - - - -', 'f2 - - - - - - - - - - - - - - -', 'e2 - - - - - - - - - - - - - - -'),
    },
  },
  battle: {   // E minor, quick: any fight outside the boss's chamber
    bpm: 150,
    voices: {
      p1: bars('e5 . e5 g5 . e5 b5 . a5 g5 . f#5 e5 . d5 .', 'e5 . e5 g5 . e5 b5 . c6 b5 . a5 g5 . a5 .', 'c5 . c5 e5 . c5 g5 . f#5 e5 . d5 c5 . b4 .', 'b4 . b4 d#5 . f#5 b5 . a5 . g5 . f#5 . d#5 .'),
      p2: bars(rep('e4 b4', 8), rep('e4 b4', 8), rep('c4 g4', 8), rep('b3 f#4', 8)),
      tri: bars(rep('e2 . e3 .', 4), rep('e2 . e3 .', 4), rep('c2 . c3 .', 4), rep('b1 . b2 .', 4)),
      drums: 'k . h . s . h k k . h . s . s h',
    },
  },
  boss: {   // D minor, fast
    bpm: 144,
    voices: {
      p1: bars('d5 d5 . d5 f5 . e5 d5 c5 . a4 . c5 d5 . .', 'd5 d5 . d5 f5 . g5 f5 e5 . c5 . e5 f5 . .', 'a#4 a#4 . a#4 d5 . c5 a#4 a4 . f4 . a4 a#4 . .', 'a4 a4 . a4 c#5 . e5 c#5 a4 . e5 . c#5 a4 . .'),
      p2: bars('d4 . a4 . d4 . a4 . d4 . a4 . d4 . a4 .', 'c4 . g4 . c4 . g4 . c4 . g4 . c4 . g4 .', 'a#3 . f4 . a#3 . f4 . a#3 . f4 . a#3 . f4 .', 'a3 . e4 . a3 . e4 . a3 . c#4 . e4 . a4 .'),
      tri: bars('d2 d3 d2 d3 d2 d3 d2 d3 d2 d3 d2 d3 d2 d3 d2 d3', 'c2 c3 c2 c3 c2 c3 c2 c3 c2 c3 c2 c3 c2 c3 c2 c3', 'a#1 a#2 a#1 a#2 a#1 a#2 a#1 a#2 a#1 a#2 a#1 a#2 a#1 a#2 a#1 a#2', 'a1 a2 a1 a2 a1 a2 a1 a2 a1 a2 a1 a2 c#2 c#3 e2 e3'),
      drums: 'k . h . s . h k k . h . s . s h',
    },
  },
});

// ---- content/chapter1/people.js
/* ---------- the people of Inkwell village and what they say; every line is a language key ---------- */
Object.assign(SPEAKERS, {
  cat: { name: 'who.cat', pic: 'cat_neutral' }, cat_happy: { name: 'who.cat', pic: 'cat_happy' }, cat_worried: { name: 'who.cat', pic: 'cat_worried' },
  librarian: { name: 'who.librarian', pic: 'librarian' }, baker: { name: 'who.baker', pic: 'baker' }, shopkeeper: { name: 'who.shopkeeper', pic: 'shopkeeper' },
  child: { name: 'who.child', pic: 'child' }, guard: { name: 'who.guard', pic: 'guard' }, scribe: { name: 'who.scribe', pic: 'blot_scribe' },
});
const pages = () => ['page_1', 'page_2', 'page_3'].filter((p) => has(p)).length;

Object.assign(NPCS, {
  librarian: {
    row: 'librarian', name: 'who.librarian', pic: 'librarian', voice: 260,
    talk() {
      const s = qStep('main');
      if (s <= 0) return { lines: [['librarian', 'l.intro1'], ['cat_worried', 'l.intro2'], ['librarian', 'l.intro3'], ['librarian', 'l.intro4'], ['cat', 'l.intro5']] };
      if (s === 1) return { lines: [['librarian', 'l.blots']] };
      if (s === 2) {
        const hint = !has('page_1') ? 'l.hint1' : !has('page_2') ? 'l.hint2' : 'l.hint3';
        return { lines: [['librarian', 'l.pieces', { n: pages() }], ['librarian', hint]] };
      }
      if (s === 3) return { lines: [['librarian', 'l.end1'], ['cat_happy', 'l.end2'], ['librarian', 'l.end3'], ['librarian', 'l.end4']], after: showEnding };
      return { lines: [['librarian', 'l.after']] };
    },
  },
  baker: {
    row: 'baker', name: 'who.baker', pic: 'baker', voice: 300,
    talk() {
      const s = qStep('flap');
      if (s < 0) return { lines: [['baker', 'b.hello1'], ['baker', 'b.hello2'], ['cat', 'b.hello3']], after: () => startQuest('flap') };
      if (s === 0) return { lines: [['baker', 'b.wait']], shop: ['bread', 'milk'] };
      if (s === 1) return { lines: [['baker', 'b.thanks1'], ['baker', 'b.thanks2'], ['cat_happy', 'b.thanks3']] };
      return { lines: [['baker', 'b.after']], shop: ['bread', 'milk'] };
    },
  },
  shopkeeper: {
    row: 'shopkeeper', name: 'who.shopkeeper', pic: 'shopkeeper', voice: 220,
    talk: () => ({ lines: [['shopkeeper', G.flags.met_shop ? 's.again' : 's.hello']], after: () => { G.flags.met_shop = true; }, shop: ['milk', 'fish', 'ink_potion', 'scarf', 'vest', 'steel_quill', 'bell_charm'] }),
  },
  guard: {
    row: 'guard', name: 'who.guard', pic: 'guard', voice: 200,
    talk() {
      const s = qStep('glasses');
      if (s < 0) return { lines: [['guard', 'g.hello1'], ['guard', 'g.hello2']], after: () => startQuest('glasses') };
      if (s === 0) return { lines: [['guard', 'g.wait']] };
      if (s === 1) return { lines: [['guard', 'g.thanks1'], ['guard', 'g.thanks2']] };
      return { lines: [['guard', has('crypt_key') || G.flags.boss_done ? 'g.crypt2' : 'g.crypt']] };
    },
  },
  child: {
    row: 'child', name: 'who.child', pic: 'child', voice: 420,
    talk() {
      const k = qStep('main') <= 1 ? 'c.1' : !G.flags.skill_dash ? 'c.2' : !G.flags.skill_well ? 'c.3' : 'c.4';
      return { lines: [['child', k]] };
    },
  },
});

// ---- content/chapter1/story.js
/* ---------- Chapter 1, The Missing Page: quests, the intro, the statue's riddle, levers, the boss, the ending ---------- */
Object.assign(QUESTS, {
  main: {
    name: 'q.main', main: true,
    steps: [
      { text: 'q.main.0', on: ['talk', 'librarian'] },
      { text: 'q.main.1', on: ['defeat', 'blot', 2] },
      { text: 'q.main.2', on: ['check', () => has('page_1') && has('page_2') && has('page_3')] },
      { text: 'q.main.3', on: ['talk', 'librarian'] },
    ],
    reward: { xp: 30 },
  },
  flap: {
    name: 'q.flap',
    steps: [
      { text: 'q.flap.0', on: ['collect', 'hinge'] },
      { text: 'q.flap.1', on: ['talk', 'baker'], then: () => takeItem('hinge') },
    ],
    reward: { item: 'page_1', coins: 15, xp: 12 },
  },
  glasses: {
    name: 'q.glasses',
    steps: [
      { text: 'q.glasses.0', on: ['collect', 'glasses_case'] },
      { text: 'q.glasses.1', on: ['talk', 'guard'], then: () => takeItem('glasses_case') },
    ],
    reward: { item: 'clover_charm', xp: 10 },
  },
});

CHAPTER.intro = () => openDialogue({ name: 'who.cat', lines: [['cat_worried', 'i.1'], ['cat', 'i.2']], after: () => startQuest('main') });

// build the current area again (a gate opened): a short fade, the cat stays where it is
async function reopen() {
  transitioning = true; await fade(1); enterArea(A.def.id, [player.x, player.z]); saveGame(); await fade(0); transitioning = false;
}

/* the road's statue: a riddle; the right answer teaches the Ink dash */
function statueRiddle() {
  if (G.flags.skill_dash) { openDialogue({ name: 'who.statue', lines: ['st.done'] }); return; }
  const wrong = () => { sfx('no'); openDialogue({ name: 'who.statue', lines: ['st.wrong'] }); };
  openDialogue({ name: 'who.statue', lines: ['st.1', 'st.2'], choices: [['st.a1', wrong], ['st.a2', () => {
    setFlag('skill_dash'); sfx('level'); toast(t('toast.skill', { s: t('skill.dash') }));
    openDialogue({ name: 'who.statue', lines: ['st.right', coarse ? 'st.how.touch' : 'st.how'] });
  }], ['st.a3', wrong]] });
}

/* the lever by the walled garden on the road opens its gate */
function roadLever() {
  if (G.flags.gate_open) { openDialogue({ name: 'act.lever', lines: ['lever.done'] }); return; }
  sfx('door'); setFlag('gate_open'); toast(t('toast.gate')); reopen();
}

/* the crypt's three levers: the plaque gives the order; a wrong pull resets them and wakes a bookworm */
const LEVER_ORDER = [3, 1, 2];
let leverDone = [];
function cryptLever(n) {
  if (G.flags.crypt_gate) { openDialogue({ name: 'act.lever', lines: ['lever.done'] }); return; }
  if (leverDone.includes(n)) { sfx('no'); return; }
  if (LEVER_ORDER[leverDone.length] !== n) {
    leverDone = []; sfx('no'); toast(t('toast.levers.wrong')); shake(.2);
    if (enemies.filter((e) => e.hp > 0).length < 3) { const w = spawnEnemy('bookworm', 12, 14); w.aware = true; }
    return;
  }
  leverDone.push(n); sfx('door'); toast(t('toast.levers', { n: leverDone.length }));
  if (leverDone.length === 3) { setFlag('crypt_gate'); leverDone = []; reopen(); }
}

// what the cat thinks at the crypt's ink pool
function poolTip() { return !G.flags.skill_dash ? 'tip.pool.nodash' : coarse ? 'tip.pool.touch' : 'tip.pool'; }   // a declaration: the crypt's area file is read before this one

/* hooks run each time an area is built */
Object.assign(AREA_HOOKS, {
  overworld() {
    if (qStep('glasses') === 0 && !has('glasses_case')) drop('glasses_case', 104, 31.4);
    if (qStep('main') === 1) for (const [x, z] of [[40, 50.5], [48, 50.5]]) spawnEnemy('blot', x, z);
  },
  crypt_in() { leverDone = []; },
  crypt_boss() {
    if (G.flags.boss_done) return;
    const b = spawnEnemy('blot_scribe', 14, 7);
    b.onDefeat = () => { setFlag('boss_done'); drop('page_3', b.x, b.z + 1); toast(t('toast.boss.done')); };
    setTimeout(() => { if (A && A.def.id === 'crypt_boss' && !dlg) openDialogue({ name: 'who.scribe', lines: [['scribe', 'sc.1'], ['cat_worried', 'sc.2'], ['scribe', 'sc.3']] }); }, 700);
  },
});

/* the ending: the page is mended; the world stays open afterwards */
function showEnding() {
  setFlag('chapter_done'); saveGame(); sfx('quest'); playTrack('village');
  ui.screen = 'end'; showScreen('end');
}

// ---- engine/90-boot.js
/* ---------- boot: art, atlas, materials, title screen; play starts from New game, Continue or a save code ---------- */
const START = { area: 'library_in', at: null };

const CAT_ANIMS = {
  idle: ['idle'], walk: ['walk1', 'walk2', 'walk3', 'walk4', 'walk5'], attack1: ['attack1'], attack2: ['attack2'], attack3: ['attack3'],
  hurt: { down: ['cat_extra.hurt_down'], up: ['cat_extra.hurt_up'], side: ['cat_extra.hurt_side'] },
  dodge: { down: ['cat_extra.dodge_down'], up: ['cat_extra.dodge_up'], side: ['cat_extra.dodge_side'] },
};
function beginPlay() {
  ui.screen = 'game'; showScreen(null); $('hud').hidden = false; $('touch').hidden = false;
  if (!player) player = sheetActor('cat', { down: 'cat_down', up: 'cat_up', side: 'cat_side' }, CAT_ANIMS);
  if (G.hp <= 0) G.hp = stats().hp;
  resetHero(); hudKey = ''; audioInit();
  enterArea(G.area, G.x !== null && G.x !== undefined ? [G.x, G.z] : null);
  intro = reduceMotion ? 1 : 0;
  canvas.focus({ preventScroll: true });
  if (!G.flags.intro && CHAPTER.intro) { G.flags.intro = true; setTimeout(CHAPTER.intro, reduceMotion ? 50 : 2200); }
}
function startGame() { newGame(); beginPlay(); }
function continueGame() { const s = loadSave(); if (!s) { refreshTitle(); return; } G = s; beginPlay(); }
function gameOver() { ui.screen = 'over'; showScreen('over'); }
function toTitle() { ui.screen = 'title'; clearEnemies(); clearNpcs(); refreshTitle(); showScreen('title'); $('hud').hidden = true; $('touch').hidden = true; }
function refreshTitle() { $('bContinue').hidden = !hasSave(); }
function closeShop() { ui.screen = 'game'; showScreen(null); }

(async function boot() {
  applyLang();
  if (!renderer) { $('fallback').hidden = false; return; }
  inputSetup(); optionsSetup();
  try { await loadArt(); } catch (e) { $('fallback').textContent = e.message; $('fallback').hidden = false; return; }
  buildSprites(); makeAtlasTextures(); makeMaterials();
  new ResizeObserver(resize).observe(canvas); resize();
  drawPic($('titleArt'), 'title', 'title');
  $('bStart').onclick = () => { sfx('ok'); startGame(); };
  $('bContinue').onclick = () => { sfx('ok'); continueGame(); };
  $('bLoad').onclick = () => { sfx('ok'); openCodeBox(); };
  $('bOptions').onclick = () => openMenu(true, true);
  $('bCodeOk').onclick = submitCode; $('bCodeCancel').onclick = () => { ui.screen = 'title'; showScreen('title'); };
  $('codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitCode(); } });
  $('bShopClose').onclick = closeShop;
  $('bRetry').onclick = () => { const s = loadSave(); if (s) G = s; else newGame(); G.hp = stats().hp; beginPlay(); };
  $('bToTitle').onclick = toTitle; $('bEndTitle').onclick = toTitle;
  $('bKeep').onclick = () => { ui.screen = 'game'; showScreen(null); };
  $('dialog').addEventListener('click', () => input.queue.push('interact'));
  // audio may start only after a person acts (the mobile rule)
  const wake = () => { audioInit(); if (AU && AU.ctx.state === 'suspended') AU.ctx.resume(); };
  addEventListener('pointerdown', wake, { once: true }); addEventListener('keydown', wake, { once: true });
  document.addEventListener('visibilitychange', () => { if (AU) document.hidden ? AU.ctx.suspend() : AU.ctx.resume(); });
  // drag turns the view, the wheel zooms (as in the dioramas)
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX }; canvas.setPointerCapture(e.pointerId); canvas.focus({ preventScroll: true }); });
  canvas.addEventListener('pointermove', (e) => { if (!drag || drag.id !== e.pointerId) return; const dx = e.clientX - drag.x; drag.x = e.clientX; yawT -= dx * .007; yaw = yawT; });
  const endDrag = (e) => { if (drag && drag.id === e.pointerId) { drag = null; yawT = Math.round(yawT / (Math.PI / 2)) * (Math.PI / 2); } };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); VT = clamp(VT * Math.exp(e.deltaY * .0012), 7, 26); }, { passive: false });
  addEventListener('pagehide', () => { if (ui.screen === 'game' && G && !hero.dead) saveGame(); });
  refreshTitle(); ui.screen = 'title'; showScreen('title');
  requestAnimationFrame(frame);
  // hooks for the headless checks
  window.__game = {
    state: () => ({ screen: ui.screen, area: A && A.def.id, x: player && player.x, z: player && player.z, fps, tris: A && A.tris, buildMs: A && A.buildMs, sprites: SPRITES.length,
      calls, chunkMs: A && Math.round(A.chunkMs), hp: G && G.hp, ink: G && Math.floor(G.ink), xp: G && G.xp, level: G && G.level, coins: G && G.coins, enemies: enemies.map((e) => [e.type, e.state, e.hp, +e.x.toFixed(1), +e.z.toFixed(1)]), dlg: !!dlg, near: nearAct && nearAct.label, quests: G && G.quests }),
    start: () => startGame(),
    place: (x, z) => { player.x = x; player.z = z; },
    walk: (x, y) => { input.stickX = x; input.stickY = y; },
    act: (a) => input.queue.push(a),
    spawn: (type, x, z) => { spawnEnemy(type, x, z); },
    flag: (f) => setFlag(f),
    spriteTris: () => Object.fromEntries(SPRITES.map((s) => [s.key, 2 * (s.layF.length + s.layB.length + s.strips.length)])),
    G: () => G, code: () => saveCode(), read: (c) => readCode(c), enter: (n, at) => enterArea(n, at),
    area: () => A,
    // for the checks: stop the frame loop, reseed, and run the 120 Hz simulation by hand (bot is called before each step)
    freeze: (on) => { frozen = !!on; if (!on) last = performance.now(); },
    reseed: (n) => reseed(n),
    sim: (secs, bot) => { const n = Math.round(secs / SIM); for (let i = 0; i < n; i++) { if (bot && bot(i * SIM) === false) return i * SIM; step(SIM); flatsDraw(SIM); } return secs; },
    clearEnemies: () => clearEnemies(),
    internals: () => ({ enemies, hazards, hero, player, ENEMIES, AREAS, stats, combatT, settings, input, ui, resetHero, SWINGS, DEFS }),
    view: (y) => { yaw = yawT = y; intro = 1; },
    zoom: (v) => { VT = Vz = v; },
    draw: () => draw(1 / 60),
  };
})();
})();
