(function () {
'use strict';
// ---- engine/00-core.js
/* ---------- core: constants, small helpers, settings, language ---------- */
const $ = (id) => document.getElementById(id);
const PPU = 16, P = 1 / PPU;                        // 16 art pixels per world unit, as in the diorama kit
const PITCH = 0.62, SPR_Y = 1 / Math.cos(PITCH);    // figures stand upright; stretched by 1/cos so pixels stay square on screen
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const F_ROOF = 1, F_GLOW = 2, F_WRAP = 4, F_TEXTOP = 8, F_TEXALL = 16, F_OWN = 32, F_GHOST = 64, F_NOSIDE = 128;   // F_NOSIDE: extruded without side faces (a smooth part covers its edges)   // F_GHOST: in the atlas only (a smooth part reads it), never extruded
const LP = window.__STYLE === 'lowpoly';            // lowpoly.html: things and figures modelled in code (engine/25-lpkit.js)
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
const settings = Object.assign({ lang: (navigator.language || 'en').toLowerCase().startsWith('it') ? 'it' : 'en', fps: 60, shadows: true, wire: false, flat: false, fig3d: false, shake: true, music: 2, sound: 2 },
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
      // the frames at twice the resolution, when the sheet has them (only lowpoly.html draws with them)
      if (!LP || !window.ART[name].hi) { ok(); return; }
      const hi = new Image(); hi.onload = () => { const c2 = document.createElement('canvas'); c2.width = hi.width; c2.height = hi.height; c2.getContext('2d').drawImage(hi, 0, 0); SHEETS[name].hi = c2; ok(); };
      hi.onerror = () => ok(); hi.src = window.ART[name].hi;
    };
    img.onerror = () => fail(new Error('art sheet not decodable: ' + name));
    img.src = window.ART[name].png;
  }))).then(() => {
    for (const [sheet, S] of Object.entries(SHEETS)) {
      for (const [key, r] of Object.entries(S.meta.sprites)) {
        if (S.meta.kind === 'tiles') TILES[key] = { w: r.w, h: r.h, px: crop(S, r) };
        else if (r.depth) DEFS.push({ key, name: key, sheet, pic: applyDepthRules(key, depthPic(S, r)) });
      }
    }
    if (LP && LP_TILES) Object.assign(TILES, LP_TILES());   // lowpoly.html: the ground painted in code
    // art drawn in code replaces the sheet's drawing of the same key
    // (a building shaped from a spec gets the sheet's drawing it replaces)
    for (const [key, draw] of Object.entries(CODE_ART)) { const k = DEFS.findIndex((d) => d.key === key), old = k >= 0 ? DEFS[k] : null; if (k >= 0) DEFS.splice(k, 1); DEFS.push({ key, name: key, sheet: 'code', pic: draw(old) }); }
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
  // the side view (when the pipeline kept one): its colours colour the side walls; x = depth from the front
  let side = null;
  if (r.side) { const s = r.side; side = { w: s.w, h: s.h, c: new Int32Array(s.w * s.h).fill(-1) }; for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const o = ((s.y + y) * S.w + s.x + x) * 4; if (S.px[o + 3] >= 128) side.c[y * s.w + x] = (S.px[o] << 16) | (S.px[o + 1] << 8) | S.px[o + 2]; } }
  return { w: r.w, h: r.h, d: r.depth.d, c, f, b, fl, side };
}

// ---- engine/12-artkit.js
/* ---------- art drawn in code: every pixel born with its colour, its depth and its flags (the diorama kit's Pic) ---------- */
// CODE_ART (content fills it): key → () => Pic. A code-drawn sprite replaces the sheet sprite of the same key at load.
// A Pic may carry: back (Int32Array, the colours its back faces show), gable (apex column of a roof whose ridge runs
// front to back), tiles (true: its roof steps read the roof tiles drawn in code, see writeTiles).
const CODE_ART = {};
const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1), u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
const jit = (c, x, y, s, a) => shade(c, 1 + (hash2((x | 0) + (s | 0) * 7919, (y | 0) - (s | 0) * 104729) - .5) * a);   // a colour, a little varied per pixel

class Pic {
  constructor(w, h) { this.w = w; this.h = h; const n = w * h; this.c = new Int32Array(n).fill(-1); this.f = new Int8Array(n); this.b = new Int8Array(n); this.fl = new Uint8Array(n); }
  Y(r) { return this.h - 1 - r; }                                   // r: rows up from the ground
  on(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h && this.c[y * this.w + x] >= 0; }
  set(x, y, c, zf, zb, fl) {
    x = Math.floor(x); y = Math.floor(y); if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x; zf = clamp(Math.round(zf), -60, 60); zb = zb === undefined ? -zf : clamp(Math.round(zb), -60, 60); if (zb >= zf) zb = zf - 1;
    this.c[i] = c; this.f[i] = zf; this.b[i] = zb; this.fl[i] = fl || 0;
  }
  // a rectangle by rows from the ground; c may be a function (x, r)
  wall(x, r, w, h, c, zf, zb, fl) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, this.Y(r + j), typeof c === 'function' ? c(x + i, r + j) : c, zf, zb, fl); }
  at(x, r, c, zf, zb, fl) { this.set(x, this.Y(r), c, zf, zb, fl); }
  done() { let lo = 0, hi = 0; for (let i = 0; i < this.c.length; i++) if (this.c[i] >= 0) { hi = Math.max(hi, this.f[i]); lo = Math.min(lo, this.b[i]); } this.d = hi - lo; return this; }
}
const inArch = (i, j, w, ah) => { if (j >= ah) return true; const hw = w / 2, dx = (i + .5 - hw) / hw, dy = (j + .5 - ah) / ah; return dx * dx + dy * dy <= 1; };   // i column, j row from the top

// ---- engine/20-sprites.js
const ROOF_F = [0, Math.SQRT1_2, Math.SQRT1_2], ROOF_B = [0, Math.SQRT1_2, -Math.SQRT1_2], TILE_N = 5;   // the per-pixel extruder (BUILD 'pixel')
/* ---------- sprites: every depth sprite packed in one atlas at boot, then extruded per pixel (from the diorama kit) ---------- */
// AW: atlas width; the atlas is two halves (colours | side colours) plus an aux table (front layer, back layer, glow)
let AW = 512, AW2 = 1024, AH = 0, AP = { sprites: {} }, propsPx, zfPl, zbPl, flPl, atlasPx, auxPx;

function buildSprites() {
  AW = Math.max(512, ...DEFS.map((d) => d.pic.w + 2)); AW2 = AW * 2;
  const order = DEFS.slice().sort((a, b) => b.pic.h - a.pic.h || (a.key < b.key ? -1 : 1));
  let x = 1, y = 1, rowH = 0;
  for (const d of order) { if (x + d.pic.w + 1 > AW) { x = 1; y += rowH + 1; rowH = 0; } d.ax = x; d.ay = y; x += d.pic.w + 1; rowH = Math.max(rowH, d.pic.h); }
  // a sprite with a side view also gets two more regions: the side view (for its side walls) and a plain back
  const extra = DEFS.filter((d) => d.pic.side).flatMap((d) => [{ d, kind: 'side', w: d.pic.side.w, h: d.pic.side.h }, { d, kind: 'back', w: d.pic.w, h: d.pic.h },
    { d, kind: 'roofF', w: d.pic.w, h: d.pic.side.w }, { d, kind: 'roofS', w: d.pic.side.w, h: d.pic.w },
    ...(d.sheet.startsWith('buildings') ? [{ d, kind: 'tiles', w: Math.max(d.pic.w, d.pic.side.w) + 1, h: d.pic.h + Math.ceil(Math.max(d.pic.w, d.pic.side.w) / 2) + 1 }] : [])]);
  // art drawn in code: its own back colours, and roof tiles when it asks for them
  for (const d of DEFS) if (!d.pic.side) { if (d.pic.back) extra.push({ d, kind: 'back', w: d.pic.w, h: d.pic.h }); if (d.pic.tiles) extra.push({ d, kind: 'tiles', w: Math.max(d.pic.w, d.pic.d) + 1, h: d.pic.h + Math.ceil(Math.max(d.pic.w, d.pic.d) / 2) + 1 }); }
  // the chest also gets the underside of its lid (its planks, darker) and the dark of its inside
  const chest = DEFS.find((d) => d.key === CHEST.key); if (chest) extra.push({ d: chest, kind: 'lidIn', w: chest.pic.w, h: CHEST.seam }, { d: chest, kind: 'dark', w: 2, h: 2 });
  for (const e of extra) { if (x + e.w + 1 > AW) { x = 1; y += rowH + 1; rowH = 0; } e.x = x; e.y = y; x += e.w + 1; rowH = Math.max(rowH, e.h); }
  AH = y + rowH + 1;
  for (const d of DEFS) AP.sprites[d.key] = { name: d.name, r: [d.ax, d.ay, d.pic.w, d.pic.h], d: d.pic.d, mid: Math.round(d.pic.d / 2), gable: d.pic.gable !== undefined ? d.pic.gable : ((CURATE[d.key] || {}).depth || {}).gable };
  for (const e of extra) AP.sprites[e.d.key][e.kind] = [e.x, e.y, e.w, e.h];
  propsPx = new Uint8ClampedArray(AW * AH * 4); zfPl = new Uint8Array(AW * AH); zbPl = new Uint8Array(AW * AH); flPl = new Uint8Array(AW * AH);
  for (const d of DEFS) { const p = d.pic; for (let yy = 0; yy < p.h; yy++) for (let xx = 0; xx < p.w; xx++) { const i = yy * p.w + xx; if (p.c[i] < 0) continue; const q = (d.ay + yy) * AW + d.ax + xx, c = p.c[i]; propsPx[q * 4] = c >> 16 & 255; propsPx[q * 4 + 1] = c >> 8 & 255; propsPx[q * 4 + 2] = c & 255; propsPx[q * 4 + 3] = 255; zfPl[q] = p.f[i] + 64; zbPl[q] = p.b[i] + 64; flPl[q] = p.fl[i]; } }
  atlasPx = new Uint8Array(AW2 * AH * 4); auxPx = new Uint8Array(AW2 * AH * 4);
  for (const key in AP.sprites) new Spr(key);
  for (const e of extra) ({ side: writeSide, back: writeBack, lidIn: writeLidIn, dark: writeDark, roofF: writeRoof, roofS: writeRoof, tiles: writeTiles })[e.kind](e);
  for (const d of DEFS) { const s = sp[d.key]; s.pic = d.pic; s.sheet = d.sheet; s.depth = d.pic.side ? d.pic.side.w : d.pic.d; }
  for (const s of SPRITES) s.low = s.pixel ? roofQuads(s) : !s.side ? [] : (BUILD[s.key] || {}).parts ? partsOf(s) : BUILD[s.key] === 'cross' ? crossOf(s) : loftOf(s);   // a pixel-built sprite: its smooth roof, if any
}

// roofs and tops: per column, the first bright pixels under the drawing's top edge (the tiles, not the outline),
// repeated down the region. roofF: the front's columns, one row per pixel of depth; roofS: the side view's columns,
// one row per pixel across the front. A face looking up reads it by (x, depth) or (depth, x)
function writeRoof(e) {
  const p = e.d.pic, src = e.kind === 'roofF' ? { w: p.w, h: p.h, c: p.c } : p.side, lum = (c) => ((c >> 16 & 255) * .3 + (c >> 8 & 255) * .59 + (c & 255) * .11);
  for (let x = 0; x < e.w; x++) {
    const col = []; let top = -1;
    for (let y = 0; y < src.h && col.length < 10; y++) { const c = src.c[y * src.w + x]; if (c < 0) continue; if (top < 0) top = y; if (lum(c) >= 50) col.push(c); }
    if (!col.length) col.push(0x806040);
    for (let y = 0; y < e.h; y++) { atlasSet(e.x + x, e.y + y, col[y % col.length]); auxPx[((e.y + y) * AW2 + e.x + x) * 4] = 1; }
  }
}
// roof tiles drawn in code: courses 4 px tall, tiles 6 px wide and staggered, each lit on top, shaded under, a dark gap
// between tiles, a little colour play per tile. The colour: CURATE roof, else the drawing's commonest terracotta
function roofColour(p, key) {
  const cur = (CURATE[key] || {}).roof; if (cur) return parseInt(cur.slice(1), 16);
  const n = new Map();
  for (let y = 0; y < p.h * .6; y++) for (let x = 0; x < p.w; x++) { const c = p.c[y * p.w + x]; if (c < 0) continue; const r = c >> 16 & 255, g = c >> 8 & 255, b = c & 255; if (r > 140 && r - g > 70 && r - b > 90) n.set(c, (n.get(c) || 0) + 1); }   // terracotta, not ochre plaster
  return n.size ? [...n].sort((a, b) => b[1] - a[1])[0][0] : 0xb4502a;
}
function writeTiles(e) {
  const base = roofColour(e.d.pic, e.d.key);
  for (let v = 0; v < e.h; v++) for (let u = 0; u < e.w; u++) {
    const course = Math.floor(v / 4), ry = v % 4, uu = u + (course % 2) * 3, tx = Math.floor(uu / 6), rx = uu % 6;
    const f = ry === 3 ? .6 : rx === 0 ? .74 : ry === 0 ? 1.16 : rx === 5 ? .88 : rx === 1 ? 1.06 : 1;
    atlasSet(e.x + u, e.y + v, shade(base, f * (.94 + hash2(tx, course) * .12))); auxPx[((e.y + v) * AW2 + e.x + u) * 4] = 1;
  }
}
function writeLidIn(e) { const p = e.d.pic; for (let y = 0; y < e.h; y++) for (let x = 0; x < e.w; x++) { const c = p.c[y * p.w + x]; atlasSet(e.x + x, e.y + y, c >= 0 ? shade(c, .62) : 0x3a2418); auxPx[((e.y + y) * AW2 + e.x + x) * 4] = 1; } }
function writeDark(e) { for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { atlasSet(e.x + x, e.y + y, 0x24160e); auxPx[((e.y + y) * AW2 + e.x + x) * 4] = 1; } }

// a curated back: the wall in the side view's commonest bright colour, as plaster (a calm wash with rare flecks) or
// stone (blocks 7 x 3, staggered, mortar lines), then the pasted rectangles of the front drawing
function writeBackCurated(e, cur) {
  const p = e.d.pic, s = p.side, lum = (c) => ((c >> 16 & 255) * .3 + (c >> 8 & 255) * .59 + (c & 255) * .11), n = new Map();
  for (const c of s.c) if (c >= 0 && lum(c) >= 50) n.set(c, (n.get(c) || 0) + 1);
  const wall = n.size ? [...n].sort((a, b) => b[1] - a[1])[0][0] : 0xc8b090;
  for (let y = 0; y < e.h; y++) for (let x = 0; x < e.w; x++) {
    let c;
    if (cur.wall === 'stone') { const row = Math.floor(y / 3), xx = x + (row % 2) * 3; c = y % 3 === 2 || xx % 7 === 0 ? shade(wall, .78) : shade(wall, .95 + hash2(Math.floor(xx / 7), row) * .1); }
    else { const k = hash2(x >> 1, y >> 1); c = k < .05 ? shade(wall, .9) : k > .97 ? shade(wall, 1.06) : wall; }
    atlasSet(e.x + x, e.y + y, c);
  }
  for (const [sx, sy, w, h, dx, dy] of cur.paste || []) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = p.c[(sy + y) * p.w + sx + x]; if (c >= 0 && dx + x < e.w && dy + y < e.h) atlasSet(e.x + dx + x, e.y + dy + y, c);
  }
  for (let y = 0; y < e.h; y++) for (let x = 0; x < e.w; x++) { const o = ((e.d.ay + y) * AW2 + e.d.ax + x) * 4, q = ((e.y + y) * AW2 + e.x + x) * 4; auxPx[q] = auxPx[o]; auxPx[q + 1] = auxPx[o + 1]; }
}

/* side views and plain backs (no art was made for the back of anything) */
const atlasSet = (x, y, c, k) => { const o = (y * AW2 + x) * 4; for (const h of [0, AW * 4]) { atlasPx[o + h] = c >> 16 & 255; atlasPx[o + h + 1] = c >> 8 & 255; atlasPx[o + h + 2] = c & 255; atlasPx[o + h + 3] = k === undefined ? 255 : k; } };
// a side view's empty pixels take the nearest colour along their row that is not outline (the view and the depth never
// agree to the pixel),
// a row with none at all the front's colour at that height
function sideFilled(p) {
  const s = p.side, out = new Int32Array(s.w * s.h);
  for (let y = 0; y < s.h; y++) {
    let fb = -1; for (let x = 0; x < p.w && fb < 0; x++) fb = p.c[y * p.w + x];
    for (let x = 0; x < s.w; x++) {
      let c = s.c[y * s.w + x];
      // an empty pixel: the nearest colour along the row that is not outline, else the nearest at all
      const ok = (v) => v >= 0 && ((v >> 16 & 255) * .3 + (v >> 8 & 255) * .59 + (v & 255) * .11) >= 42;
      for (let r = 1; c < 0 && r < s.w; r++) { const a = x - r >= 0 ? s.c[y * s.w + x - r] : -1, b = x + r < s.w ? s.c[y * s.w + x + r] : -1; if (ok(a)) c = a; else if (ok(b)) c = b; }
      for (let r = 1; c < 0 && r < s.w; r++) { const a = s.c[y * s.w + x - r], b = s.c[y * s.w + x + r]; if (x - r >= 0 && a >= 0) c = a; else if (x + r < s.w && b >= 0) c = b; }
      out[y * s.w + x] = c >= 0 ? c : fb >= 0 ? fb : 0x806040;
    }
  }
  return out;
}
function writeSide(e) {
  const c = sideFilled(e.d.pic), sc = e.d.pic.side.c;
  for (let y = 0; y < e.h; y++) for (let x = 0; x < e.w; x++) { atlasSet(e.x + x, e.y + y, c[y * e.w + x]); auxPx[((e.y + y) * AW2 + e.x + x) * 4] = sc[y * e.w + x] >= 0 ? 1 : 0; }   // aux r: drawn here (cut-out faces)
}
// the back: each row takes the colours the side view has at that height (the wall's or the roof's material, without
// the doors and windows of the front), skipping its dark outline: its two commonest, so the wall reads plain;
// the depth codes are copied from the front region, which the back faces' layer test reads
function writeBack(e) {
  if (e.d.pic.back) { const p = e.d.pic; for (let y = 0; y < e.h; y++) for (let x = 0; x < e.w; x++) { const c = p.back[y * p.w + x], o = ((e.d.ay + y) * AW2 + e.d.ax + x) * 4, q = ((e.y + y) * AW2 + e.x + x) * 4; atlasSet(e.x + x, e.y + y, c >= 0 ? c : 0); auxPx[q] = auxPx[o]; auxPx[q + 1] = auxPx[o + 1]; } return; }   // drawn in code
  const cur = (CURATE[e.d.key] || {}).back; if (cur) { writeBackCurated(e, cur); return; }
  const p = e.d.pic, s = p.side, lum = (c) => ((c >> 16 & 255) * .3 + (c >> 8 & 255) * .59 + (c & 255) * .11);
  for (let y = 0; y < e.h; y++) {
    let pool = []; for (let x = 0; x < s.w; x++) { const c = s.c[y * s.w + x]; if (c >= 0 && lum(c) >= 50) pool.push(c); }
    if (!pool.length) for (let x = 0; x < p.w; x++) { const c = p.c[y * p.w + x]; if (c >= 0 && lum(c) >= 50) pool.push(c); }   // no side colour at this height: the front's
    if (!pool.length) pool = [0x6a5040];
    // the row's two commonest colours (the material and its shade), 3 to 1: plain, with a little grain
    const n = new Map(); for (const c of pool) n.set(c, (n.get(c) || 0) + 1); const top = [...n].sort((a, b) => b[1] - a[1]).map((q) => q[0]);
    pool = top.length > 1 ? [top[0], top[0], top[0], top[1]] : top;
    for (let x = 0; x < e.w; x++) {
      const i = y * p.w + x, o = ((e.d.ay + y) * AW2 + e.d.ax + x) * 4, q = ((e.y + y) * AW2 + e.x + x) * 4;
      atlasSet(e.x + x, e.y + y, pool[Math.floor(hash2(x >> 1, y) * pool.length)]);   // everywhere: a loft face may reach past the front's outline
      auxPx[q] = auxPx[o]; auxPx[q + 1] = auxPx[o + 1];   // the outline of the front; no glow (its windows are not here)
    }
  }
}

/* ---------- sprite 2D: un ritaglio del foglio, con due profondità per pixel (davanti e dietro) già disegnate insieme ai colori ---------- */
const SPRITES = [], sp = {};
class Spr {
  constructor(key) {
    const meta = AP.sprites[key], [ax, ay, w, h] = meta.r, n = w * h;
    Object.assign(this, { key, name: meta.name, side: meta.side, back: meta.back, mid: meta.mid, ax, ay, w, h, base: h, px: meta.px === undefined ? Math.round(w / 2) : meta.px, count: 0, tiles: meta.tiles, pixel: BUILD[key] === 'pixel', texKey: meta.tex, gable: meta.gable, cross: !!meta.cross, tileN: meta.tex ? 16 : TILE_N });
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
    // empty pixels take the nearest colour that is not outline (luminance 42 and up): a shell a little wider than the
    // drawing then shows the colour just inside its edge, not a smear of the dark outline; drawn pixels keep their own
    const lum = (i) => d[i * 4] * .3 + d[i * 4 + 1] * .59 + d[i * 4 + 2] * .11, src = new Int32Array(n).fill(-1);
    this.each((x, y, i) => { if (this.zf[i] <= this.zb[i]) this.zf[i] = this.zb[i] + 1; cf[i] = this.zf[i] + 64 + this.cls[i] * 128; cb[i] = this.zb[i] + 64 + this.cls[i] * 128; if (lum(i) >= 42) { src[i] = i; fq.push(i); } });
    if (!fq.length) this.each((x, y, i) => { src[i] = i; fq.push(i); });   // all dark: any colour will do
    for (let k = 0; k < fq.length; k++) { const i = fq[k], x = i % w, y = (i / w) | 0; for (const [a, b] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) { if (a < 0 || b < 0 || a >= w || b >= h) continue; const j = b * w + a; if (src[j] >= 0) continue; src[j] = src[i]; fq.push(j); } }
    for (let i = 0; i < n; i++) near[i] = d[i * 4 + 3] ? i : src[i];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, j = near[i], on = j === i, kl = ((this.ay + y) * AW2 + this.ax + x) * 4, kr = kl + AW * 4;
      if (j < 0) continue;
      atlasPx[kl] = d[j * 4]; atlasPx[kl + 1] = d[j * 4 + 1]; atlasPx[kl + 2] = d[j * 4 + 2]; atlasPx[kl + 3] = 255;
      atlasPx[kr] = sc[j * 3]; atlasPx[kr + 1] = sc[j * 3 + 1]; atlasPx[kr + 2] = sc[j * 3 + 2]; atlasPx[kr + 3] = 255;
      if (on) { auxPx[kl] = cf[i]; auxPx[kl + 1] = cb[i]; auxPx[kl + 3] = 255; auxPx[kl + 2] = auxPx[kr + 2] = this.glow[i] ? 255 : 0; }
    }
    // ghosts: colour only. A ghost that is also NOSIDE belongs to a card (engine/24-shapes.js): its card's number k is in its
    // back depth, and its aux alpha becomes 254 - k, which only that card's faces (layer 500 + k) draw
    this.each((x, y, i) => { if (this.fl[i] & F_GHOST) { d[i * 4 + 3] = 0; const kl = ((this.ay + y) * AW2 + this.ax + x) * 4; auxPx[kl] = auxPx[kl + 1] = 0; if (this.fl[i] & F_NOSIDE) auxPx[kl + 3] = 254 - this.zb[i]; } });
    if (this.pixel) { this.layF = this.layers(cf); this.layB = this.layers(cb); this.sides(); }
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
      const zf = s.zf[i], zb = s.zb[i], f = s.fl[i]; if (f & F_NOSIDE) return;
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
          // a roof step's top, in one piece for its whole depth, reading the roof tiles drawn in code along it (row = the
          // tile course, depth = along the course): the tile joints show without cutting the strip
          if ((f & F_OWN) && ny > 0 && s.tiles) { add(k, line, pos, a, b, clamp(s.mid - a, 0, s.tiles[2]), clamp(s.mid - b, 0, s.tiles[2]), 3, ov); return; }
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
        if (!s.on(X, Y) && nx && s.side && !(f & (F_ROOF | F_TEXALL))) { const cl = (v) => clamp(v, 0, s.side[2]); add(k, line, pos, zb, zf, cl(s.mid - zb), cl(s.mid - zf), 2, ov); }   // a side wall: the side view, column = depth from the front
        else if (!s.on(X, Y)) run(zb, zf);
        else { const j = Y * w + X, zfn = s.zf[j], zbn = s.zb[j]; if (zfn < zf) run(Math.max(zfn, zb), zf); if (zbn > zb) run(zb, Math.min(zbn, zf)); }
      }
    });
    // strisce in coordinate dello sprite: quattro angoli, normale, coordinate nell'atlante
    const NRM = [[-1, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0]];
    s.strips = segs.map((q) => {
      const fix = q.row !== undefined, r = q.row, n = NRM[q.dir], sv = q.half === 2, tv = q.half === 3, uo = tv ? s.tiles[0] : sv ? s.side[0] : (fix ? 0 : s.ax) + q.half * AW, vo = tv ? s.tiles[1] : sv ? s.side[1] : fix ? 0 : s.ay; let P_, uv;
      if (q.dir < 2) { const Xp = (q.dir === 0 ? q.line : q.line + 1) - px, Yt = base - q.p0, Yb = base - q.p1; P_ = [Xp, Yb, q.d0, Xp, Yt, q.d0, Xp, Yt, q.d1, Xp, Yb, q.d1]; uv = fix ? [q.tA, r + 1, q.tA, r, q.tB, r, q.tB, r + 1] : [q.tA, q.p1, q.tA, q.p0, q.tB, q.p0, q.tB, q.p1]; }
      else { const Yp = q.dir === 2 ? base - q.line : base - q.line - 1, X0 = q.p0 - px, X1 = q.p1 - px; P_ = [X0, Yp, q.d0, X1, Yp, q.d0, X1, Yp, q.d1, X0, Yp, q.d1]; uv = tv ? [q.tA, q.line + .5, q.tA, q.line + .5, q.tB, q.line + .5, q.tB, q.line + .5] : fix ? [q.tA, r + .5, q.tA, r + .5, q.tB, r + .5, q.tB, r + .5] : [q.p0, q.tA, q.p1, q.tA, q.p1, q.tB, q.p0, q.tB]; }
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
  // a face with its own colour at each corner (the low-poly kit bakes a contact shade into the colours); cols: 12 bytes
  quadC(p, nx, ny, nz, cols, gl, nrms) {   // nrms: 12 numbers, a normal per corner (smooth shading), else the face's
    const order = flipped(p, nx, ny, nz) ? [0, 3, 2, 1] : [0, 1, 2, 3];
    this.pos.need(12); this.nrm.need(12); this.col.need(16); this.idx.need(6);
    const pa = this.pos.a, na = this.nrm.a, ca = this.col.a, ia = this.idx.a; let pn = this.pos.n, nn = this.nrm.n, cn = this.col.n;
    for (let k = 0; k < 4; k++) { const o = order[k]; pa[pn++] = p[o * 3]; pa[pn++] = p[o * 3 + 1]; pa[pn++] = p[o * 3 + 2]; if (nrms) { na[nn++] = nrms[o * 3] * 127; na[nn++] = nrms[o * 3 + 1] * 127; na[nn++] = nrms[o * 3 + 2] * 127; } else { na[nn++] = nx * 127; na[nn++] = ny * 127; na[nn++] = nz * 127; } ca[cn++] = cols[o * 3]; ca[cn++] = cols[o * 3 + 1]; ca[cn++] = cols[o * 3 + 2]; ca[cn++] = gl ? 255 : 0; }
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
let S = null, B = null;   // the current area's builders: S textured quads (things), B coloured quads (ground walls)

/* the per-pixel extruder: a sprite set down in the world (BUILD 'pixel'), as in the diorama kit */
let tally = { px: 0 };
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
    const bx = !front && s.back ? s.back[0] : s.ax, by = !front && s.back ? s.back[1] : s.ay;   // a back face: the plain back, when there is one
    const u0 = (bx + x0) / AW2, u1 = (bx + x1) / AW2, v0 = (by + y0) / AH, v1 = (by + y1) / AH;
    tn([0, 0, sg], g3); tn(code > 127 ? (front ? ROOF_F : ROOF_B) : [0, 0, sg], s3);
    S.quad(pts, g3[0], g3[1], g3[2], [u0, v1, u1, v1, u1, v0, u0, v0], sg * code, s3[0], s3[1], s3[2]);
  };
  for (const L of s.layF) slab(L, true); for (const L of s.layB) slab(L, false);
  for (const q of s.strips) { for (let k = 0; k < 4; k++) tp(q.p[k * 3], q.p[k * 3 + 1], q.p[k * 3 + 2], k * 3); tn(q.n, g3); tn(q.sn, s3); S.quad(pts, g3[0], g3[1], g3[2], q.uv, 0, s3[0], s3[1], s3[2]); }
  tally.px += s.count;
  return { x: ox, z: oz };
}

// ---- engine/21-depth.js
/* ---------- depth by rules: the diorama's catalogue, written per building, instead of depth from the side view ---------- */
// CURATE[key].depth = { gable?: apex column, rules: [...] }, applied in order at load (later rules win). Each rule names
// a rectangle of the front drawing, rect: [x0, y0, x1, y1) in art pixels, and optionally a colour test:
//   dark: true   only pixels darker than luminance 150 (roof tiles, beams; not the plaster)
//   light: true  only pixels of luminance 150 and up
// Depths are art pixels from the sprite's centre plane, toward the camera positive (as in the kit: front f > back b):
//   { box: rect, half }         a solid: f = half, b = -half
//   { slab: rect, f, b }        an explicit interval (a chimney near the back, a sign at the front)
//   { out: rect, k }            the front comes forward by k (a cornice, a plinth); { back: k } moves the back too
//   { recess: rect, k }         the front goes back by k (a door, a shop window)
//   { cloth: rect, f0, step }  the front of each row a step further out than the row above (an awning); the back stays,
//                               since a pixel has one depth interval and the wall behind must not lose it
//   { roof: rect }              a roof: with gable (ridge front to back) its stepped tops tilt toward their side;
//                               without (ridge across) the ROOF flag makes its front faces a slope
// paint: [...] cleans the colours first (see paintRules).
function paintRules(pic, ops) { }
function applyDepthRules(key, pic) {
  const D = (CURATE[key] || {}).depth; if (!D) return pic;
  const { w, h, c, f, b, fl } = pic, lum = (v) => (v >> 16 & 255) * .3 + (v >> 8 & 255) * .59 + (v & 255) * .11;
  paintRules(pic, (CURATE[key] || {}).paint || []);
  const each = (r, fn) => {
    const [x0, y0, x1, y1] = r.box || r.slab || r.out || r.recess || r.cloth || r.roof || [0, 0, w, h];   // the rule's own rectangle
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
      const i = y * w + x; if (c[i] < 0) continue; const l = lum(c[i]);
      if (r.dark && l >= 150) continue; if (r.light && l < 150) continue;
      fn(i, x, y);
    }
  };
  for (const r of D.rules) {
    if (r.box !== undefined) each(r, (i) => { f[i] = r.half; b[i] = -r.half; });
    else if (r.slab !== undefined) each(r, (i) => { f[i] = r.f; b[i] = r.b; });
    else if (r.out !== undefined) each(r, (i) => { f[i] += r.k; if (r.back) b[i] -= r.back; });
    else if (r.recess !== undefined) each(r, (i) => { f[i] -= r.k; });
    else if (r.cloth !== undefined) each(r, (i, x, y) => { f[i] = Math.round(r.f0 + (y - r.cloth[1]) * r.step); });   // the front only: the wall behind stays
    // a roof whose ridge runs front to back: its stepped tops tilt toward their side of the gable (F_TEXALL + gable);
    // a roof seen from the front (ridge across): F_ROOF tilts its front faces into a slope
    else if (r.roof !== undefined) each(r, (i) => { fl[i] |= (D.gable !== undefined ? F_TEXALL : F_ROOF) | (D.roofFlat ? F_OWN : 0); });
  }
  for (let i = 0; i < f.length; i++) { f[i] = clamp(f[i], -63, 63); b[i] = clamp(b[i], -64, f[i] - 1); }
  pic.d = Math.max(...f) - Math.min(...b);
  return pic;
}

// ---- engine/22-lowpoly.js
/* ---------- things in 3D: a few quads per sprite instead of one per pixel ---------- */
// Two builds, chosen per sprite (BUILD; a loft unless it says cross):
//   loft   a shell lofted through the sprite's outline: every second row, the front's x-span and the side view's
//          z-span make a ring; rings are joined by sloped quads, rings on a straight line are dropped. Walls, roofs
//          and crowns come out sloped as drawn, in 40-400 triangles.
//   cross  the front drawing and the side drawing as two crossed cards, both faces (8 triangles): for trees and thin
//          things, whose outline matters more than their volume.
// Every face reads the atlas: the front for faces toward the camera and for faces looking up, the side view for side faces, the plain
// back for faces away. Cards use layer CUT: the material discards what the art left empty, so the outline stays as
// drawn. Lofts are not cut.
// A sprite is built once at load (s.low) in local art pixels: X right of the anchor, Y up from the ground, Z toward
// the camera from the middle of its depth. putLow places a copy in the current area's builder S.
const CUT = 300;
// hand curation per sprite (content/curate.js fills it), applied at load, so a redrawn sheet keeps its fixes:
//   cuts: [{ front: [x0, y0, x1, y1], side: [z0, y0, z1, y1] }]  parts that stand out of the shell (a chimney, a sign):
//         left out of the loft and built as boxes of their own (front rect: x and rows; side rect: depth from the front)
//   back: { wall: 'plaster' | 'stone', paste: [[sx, sy, w, h, dx, dy]] }  the back painted: a wall pattern in the side
//         view's commonest colour, then rectangles of the front drawing pasted on it (a door, the plinth)
//   roof: '#rrggbb'  the roof tiles' colour (default: the drawing's commonest terracotta)
const CURATE = {};
const BUILD = {
  bakery: 'pixel', oak: 'cross', cypress: 'cross', olive: 'cross', bush: 'cross', lamp_post: 'cross', lever: 'cross',
  // things whose shape is known, built from parts by rows of the front drawing (rows from the top, [first, past last]):
  //   loft (depth: px | 'width' for a cube), revolve (a cylinder: each row's width its diameter), card (the drawing cut
  //   to its outline, t px each side of the middle), slope (a panel tilted from front-low to back-high, lift px raised)
  signpost: 'pixel',                                                      // its drawing extruded a few pixels (CURATE depth)
  barrel: { parts: [{ revolve: [0, 25] }] },
  crate: { parts: [{ loft: [0, 17], depth: 'width' }] },
  well: { parts: [{ loft: [0, 13] }, { card: [13, 25], t: 2 }, { revolve: [25, 44] }] },
  reading_desk: { parts: [{ loft: [13, 26], depth: 8 }, { slope: [0, 13], front: 9, back: -9, rise: 9, thick: 2 }, { slope: [1, 10], x: [5, 20], onBoard: true, lift: 1.5, thick: 1 }] },
};   // the statue is a loft: a figure, seen all round
const CHEST = { key: 'chest', seam: 11, open: -105 * Math.PI / 180, inset: 4, time: .35 };   // props-1's chest: rows 0-10 lid, 11-20 body

// atlas coordinates (art pixels) → texture coordinates
const auv = (x, y) => [x / AW2, y / AH];
// a face in object space: x 0…w from the front's left edge, y up from the ground, z 0…d from the back; n its normal
function face(s, pts, region) {
  const u = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]], v = [pts[3][0] - pts[0][0], pts[3][1] - pts[0][1], pts[3][2] - pts[0][2]];
  let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n); if (l < 1e-6) return null; n = n.map((c) => c / l);
  const d = s.depth, h = s.h, side = s.side, back = s.back, A = AP.sprites[s.key];
  // a face looking up (a roof slope, a ledge, a top) takes the roof tiles of the front drawing (roofF), or of the side view
  // when it tilts sideways (roofS); upright faces take the front, the back or the side view by the way they face
  const pick = region || (n[1] > .5 ? (Math.abs(n[0]) > Math.abs(n[2]) ? 'topSide' : 'top') : Math.abs(n[2]) >= Math.abs(n[0]) ? (n[2] > 0 ? 'front' : 'back') : 'side');
  const uv = pts.map(([x, y, z]) => {
    if (pick === 'front') return auv(s.ax + x, s.ay + h - y);
    if (pick === 'back') return auv(back[0] + x, back[1] + h - y);
    if (pick === 'side') return auv(side[0] + (d - z), side[1] + h - y);
    if (A.tiles && pick === 'top') return auv(A.tiles[0] + clamp(x, 0, A.tiles[2]), A.tiles[1] + clamp(h - y + Math.abs(z - d / 2), 0, A.tiles[3]));   // tiled roof: courses along the eaves
    if (A.tiles && pick === 'topSide') return auv(A.tiles[0] + clamp(d - z, 0, A.tiles[2]), A.tiles[1] + clamp(h - y + Math.abs(x - s.w / 2), 0, A.tiles[3]));
    if (pick === 'top') return auv(A.roofF[0] + clamp(x, .5, s.w - .5), A.roofF[1] + clamp(d - z, 0, d));        // the front's roof tiles, across the depth
    if (pick === 'topSide') return auv(A.roofS[0] + clamp(d - z, .5, d - .5), A.roofS[1] + clamp(x, 0, s.w));   // a slope tilted sideways: the side view's
    if (pick === 'lidIn') return auv(A.lidIn[0] + x, A.lidIn[1] + (d - z) / d * CHEST.seam);
    return auv(A.dark[0] + 1, A.dark[1] + 1);                                   // 'dark'
  });
  // a loft's faces are not cut to the drawing's outline: the shell follows the outline every two rows, so a cut only
  // opened windows into the empty shell (the ground showed through); empty pixels take their nearest colour instead
  return { p: pts.map(([x, y, z]) => [x - s.px, y, z - d / 2]), n, uv: uv.flat(), layer: 0 };
}

// the loft of image rows r0…r1 (r1 exclusive). opts: noTop (leave the top open), bottom (close the bottom with region)
function loftOf(s, r0 = 0, r1 = s.h, opts = {}) {
  const pic = s.pic, sd = pic.side, d = s.depth, h = s.h, out = [], rings = [], cuts = (CURATE[s.key] || {}).cuts || [], fixed = opts.depth === 'width' ? null : opts.depth;
  const cutF = (x, r) => cuts.some(({ front: [x0, y0, x1, y1] }) => x >= x0 && x < x1 && r >= y0 && r < y1);
  const cutS = (z, r) => cuts.some(({ side: [z0, y0, z1, y1] }) => z >= z0 && z < z1 && r >= y0 && r < y1);
  const span = (yi) => {
    let x0 = 1e9, x1 = -1, z0 = 1e9, z1 = -1;
    for (let r = Math.max(r0, yi - 1); r <= Math.min(r1 - 1, yi + 1); r++) {
      for (let x = 0; x < s.w; x++) if (pic.c[r * s.w + x] >= 0 && !cutF(x, r)) { if (x < x0) x0 = x; if (x + 1 > x1) x1 = x + 1; }
      for (let z = 0; z < sd.w; z++) if (sd.c[r * sd.w + z] >= 0 && !cutS(z, r)) { if (z < z0) z0 = z; if (z + 1 > z1) z1 = z + 1; }
    }
    if (x1 < 0 || z1 < 0) return null;
    const dz = opts.depth === 'width' ? x1 - x0 : fixed;   // a fixed depth (a cube: as deep as wide), centred
    return dz ? { x0, x1, zf: d / 2 + dz / 2, zb: d / 2 - dz / 2 } : { x0, x1, zf: d - z0, zb: Math.max(0, d - z1) };
  };
  for (let yi = r1; yi >= r0; yi -= 2) { const sp_ = span(Math.min(r1 - 1, yi)); if (sp_) rings.push(Object.assign(sp_, { y: h - yi })); }
  if (rings.length && rings[rings.length - 1].y < h - r0) { const sp_ = span(r0); if (sp_) rings.push(Object.assign(sp_, { y: h - r0 })); }
  if (rings.length < 2) return out;
  const keep = rings.filter((r, i) => { if (i === 0 || i === rings.length - 1) return true; const a = rings[i - 1], b = rings[i + 1], t = (r.y - a.y) / (b.y - a.y); return ['x0', 'x1', 'zf', 'zb'].some((k) => Math.abs(a[k] + (b[k] - a[k]) * t - r[k]) > 1.2); });
  const add = (pts, region) => { const f = face(s, pts, region); if (f) out.push(f); };
  for (let i = 0; i + 1 < keep.length; i++) {
    const a = keep[i], b = keep[i + 1];
    add([[a.x0, a.y, a.zf], [a.x1, a.y, a.zf], [b.x1, b.y, b.zf], [b.x0, b.y, b.zf]]);   // front
    add([[a.x1, a.y, a.zb], [a.x0, a.y, a.zb], [b.x0, b.y, b.zb], [b.x1, b.y, b.zb]]);   // back
    add([[a.x1, a.y, a.zf], [a.x1, a.y, a.zb], [b.x1, b.y, b.zb], [b.x1, b.y, b.zf]]);   // right
    add([[a.x0, a.y, a.zb], [a.x0, a.y, a.zf], [b.x0, b.y, b.zf], [b.x0, b.y, b.zb]]);   // left
  }
  const t = keep[keep.length - 1], f = keep[0];
  if (!opts.noTop) add([[t.x0, t.y, t.zf], [t.x1, t.y, t.zf], [t.x1, t.y, t.zb], [t.x0, t.y, t.zb]], 'top');
  if (opts.bottom) add([[f.x0, f.y, f.zb], [f.x1, f.y, f.zb], [f.x1, f.y, f.zf], [f.x0, f.y, f.zf]], opts.bottom);
  out.ring = (y) => keep.reduce((best, r) => Math.abs(r.y - y) < Math.abs(best.y - y) ? r : best);
  // the cut parts, as boxes: front and back read the front drawing, the sides the side view, the top the front's top row
  if (r0 === 0 && r1 === h) for (const { front: [x0, y0, x1, y1], side: [z0, , z1] } of cuts) {
    const Y0 = h - y1, Y1 = h - y0, Zf = d - z0, Zb = d - z1;
    add([[x0, Y0, Zf], [x1, Y0, Zf], [x1, Y1, Zf], [x0, Y1, Zf]], 'front'); add([[x1, Y0, Zb], [x0, Y0, Zb], [x0, Y1, Zb], [x1, Y1, Zb]], 'front');
    add([[x1, Y0, Zf], [x1, Y0, Zb], [x1, Y1, Zb], [x1, Y1, Zf]], 'side'); add([[x0, Y0, Zb], [x0, Y0, Zf], [x0, Y1, Zf], [x0, Y1, Zb]], 'side');
    add([[x0, Y1, Zf], [x1, Y1, Zf], [x1, Y1, Zb], [x0, Y1, Zb]], 'front');
  }
  return out;
}

// a smooth gable roof over a building drawn in code (pic.roofs: { cx apex column, xl / xr eave columns, yE eave and yR
// ridge height in rows, zf / zb front and back, t thickness }; the ridge runs front to back): two slopes reading the
// roof tiles drawn in code (courses along the eaves, counted down from the ridge), the fascia along the front and back
// edges and the eave ends in the tiles' dark joint colour. A few quads instead of a staircase of 1-pixel steps
function roofQuads(s) {
  const T = AP.sprites[s.key].tiles || [0, 0, 1, 1], out = []; if (!s.pic.roofs && !s.pic.slopes && !s.pic.discs && !s.pic.rings && !s.pic.boxes && !s.pic.hroofs && !s.pic.cones && !s.pic.cyls && !s.pic.cards) return out;
  const uv = (u, v) => [(T[0] + clamp(u, 0, T[2])) / AW2, (T[1] + clamp(v, 0, T[3])) / AH];
  const q = (pts, n, uvs) => out.push({ p: pts.map(([x, y, z]) => [x - s.px, y, z]), n, uv: uvs.flat(), layer: 0 });
  // sloping panels (an awning): the panel reads the sprite's own front pixels by height, the two ends are triangles
  const fuv = (x, y) => [(s.ax + clamp(x, 0, s.w - .01)) / AW2, (s.ay + clamp(s.h - y, 0, s.h - .01)) / AH];
  for (const a of s.pic.slopes || []) {
    const dy = a.yTop - a.yBot, dz = a.zBot - a.zTop, l = Math.hypot(dy, dz), n = [0, dz / l, dy / l];
    q([[a.x0, a.yBot, a.zBot], [a.x1, a.yBot, a.zBot], [a.x1, a.yTop, a.zTop], [a.x0, a.yTop, a.zTop]], n, [fuv(a.x0, a.yBot + .5), fuv(a.x1, a.yBot + .5), fuv(a.x1, a.yTop - .5), fuv(a.x0, a.yTop - .5)]);
    for (const [x, sx, u] of [[a.x0, -1, a.x0 + .5], [a.x1, 1, a.x1 - .5]]) q([[x, a.yTop, a.zTop], [x, a.yBot, a.zBot], [x, a.yBot, a.zTop], [x, a.yBot, a.zTop]], [sx, 0, 0], [fuv(u, a.yTop - .5), fuv(u, a.yBot + .5), fuv(u, a.yBot + .5), fuv(u, a.yBot + .5)]);
  }
  // discs (a round sign): a short cylinder of n sides, axis toward the camera; both caps read the sprite's own front
  // pixels (drawn as F_GHOST), the rim the colour just inside the edge. Caps as fans of quads (two triangles each)
  for (const c of s.pic.discs || []) {
    const n = c.n || 12, P_ = (k, rr) => [c.cx + Math.cos(k / n * Math.PI * 2) * rr, c.cy + Math.sin(k / n * Math.PI * 2) * rr];
    for (const [z, nz] of [[c.zf, 1], [c.zb, -1]]) for (let k = 0; k < n; k += 2) {
      const pts = [[c.cx, c.cy], P_(k, c.r), P_(k + 1, c.r), P_(k + 2, c.r)];
      q(pts.map(([x, y]) => [x, y, z]), [0, 0, nz], pts.map(([x, y]) => fuv(x, y)));
    }
    for (let k = 0; k < n; k++) {
      const [ax, ay] = P_(k, c.r), [bx, by] = P_(k + 1, c.r), m = (k + .5) / n * Math.PI * 2, [ux, uy] = P_(k + .5, c.r - .8);
      q([[ax, ay, c.zf], [bx, by, c.zf], [bx, by, c.zb], [ax, ay, c.zb]], [Math.cos(m), Math.sin(m), 0], [fuv(ux, uy), fuv(ux, uy), fuv(ux, uy), fuv(ux, uy)]);
    }
  }
  // rings (a round window's frame, an arch): an elliptic band in front of the wall, from angle a0 to a1, n segments.
  // Its front at zf, its outer edge down to the wall (zw), its inner edge a tube down to zi (the glass, the door):
  // the curved soffit the pixels drew as steps. All of it in the colour of the drawn frame at radius ru
  // boxes: { x0, x1 columns (x1 past the last), r0, r1 rows from the ground, zf, zb, faces } - a cornice, a chimney,
  // a frame. faces 'all': a solid with 6 faces; 'sides': the 4 side faces only (its front is drawn as pixels); 'in': the
  // 4 faces of a hole looking inward (a recess). Front and back read the front pixels; a side face the drawn row or
  // column along its edge, stretched over its depth. skip: faces left out, 'top' / 'bottom' (a wall sitting on a
  // plinth under a cornice: those faces are inside, and the bottom one fought the plinth's top in the door's recess)
  for (const b of s.pic.boxes || []) {
    const { x0, x1, r0, r1, zf, zb } = b, F = b.faces || 'all', o = F === 'in' ? -1 : 1, e = .02, skip = b.skip || [];
    // b.col: one colour for every face, the back picture at that point (a cap over a wall: its wall's colour)
    const one = b.col && s.back ? [(s.back[0] + clamp(b.col[0], 0, s.w - .01)) / AW2, (s.back[1] + clamp(s.h - b.col[1], 0, s.h - .01)) / AH] : null;
    const side = (pts, n, uvs) => q(pts, n.map((v) => v * o), one ? [one, one, one, one] : uvs);
    const ux0 = F === 'in' ? x0 - .5 : x0 + .5, ux1 = F === 'in' ? x1 + .5 : x1 - .5, vy0 = F === 'in' ? r0 - .5 : r0 + .5, vy1 = F === 'in' ? r1 + .5 : r1 - .5;
    if (b.swatch && s.back) {   // walls of a shaped building: a swatch of the plain wall (the back picture), repeated along the depth
      const [w0, w1] = b.swatch, sw = Math.max(1, w1 - w0), bu = (x, y) => [(s.back[0] + clamp(x, 0, s.w - .01)) / AW2, (s.back[1] + clamp(s.h - y, 0, s.h - .01)) / AH];
      for (let za = zb; za < zf; za += sw) {
        const zz = Math.min(zf, za + sw), ua = w0, ub = w0 + (zz - za);
        side([[x0, r0, zz], [x0, r0, za], [x0, r1, za], [x0, r1, zz]], [-1, 0, 0], [bu(ub, r0 + e), bu(ua, r0 + e), bu(ua, r1 - e), bu(ub, r1 - e)]);
        side([[x1, r0, za], [x1, r0, zz], [x1, r1, zz], [x1, r1, za]], [1, 0, 0], [bu(ua, r0 + e), bu(ub, r0 + e), bu(ub, r1 - e), bu(ua, r1 - e)]);
      }
    } else {
    side([[x0, r0, zf], [x0, r0, zb], [x0, r1, zb], [x0, r1, zf]], [-1, 0, 0], [fuv(ux0, r0 + e), fuv(ux0, r0 + e), fuv(ux0, r1 - e), fuv(ux0, r1 - e)]);
    side([[x1, r0, zb], [x1, r0, zf], [x1, r1, zf], [x1, r1, zb]], [1, 0, 0], [fuv(ux1, r0 + e), fuv(ux1, r0 + e), fuv(ux1, r1 - e), fuv(ux1, r1 - e)]);
    }
    if (!skip.includes('top')) side([[x0, r1, zf], [x1, r1, zf], [x1, r1, zb], [x0, r1, zb]], [0, 1, 0], [fuv(x0 + e, vy1), fuv(x1 - e, vy1), fuv(x1 - e, vy1), fuv(x0 + e, vy1)]);
    if (!skip.includes('bottom')) side([[x0, r0, zb], [x1, r0, zb], [x1, r0, zf], [x0, r0, zf]], [0, -1, 0], [fuv(x0 + e, vy0), fuv(x1 - e, vy0), fuv(x1 - e, vy0), fuv(x0 + e, vy0)]);
    if (F === 'all') for (const [z, nz] of [[zf, 1], [zb, -1]]) q([[x0, r0, z], [x1, r0, z], [x1, r1, z], [x0, r1, z]], [0, 0, nz], one ? [one, one, one, one] : [fuv(x0 + e, r0 + e), fuv(x1 - e, r0 + e), fuv(x1 - e, r1 - e), fuv(x0 + e, r1 - e)]);
  }
  for (const g of s.pic.rings || []) {
    const n = g.n || 12, at = (t, rx, ry) => [g.cx + Math.cos(t) * rx, g.cy + Math.sin(t) * ry];
    for (let k = 0; k < n; k++) {
      const t0 = g.a0 + (g.a1 - g.a0) * k / n, t1 = g.a0 + (g.a1 - g.a0) * (k + 1) / n, tm = (t0 + t1) / 2, c = fuv(...at(tm, g.ru, g.ru * g.ry1 / g.rx1));
      const [o0, o1, i0, i1] = [at(t0, g.rx1, g.ry1), at(t1, g.rx1, g.ry1), at(t0, g.rx0, g.ry0), at(t1, g.rx0, g.ry0)];
      const nO = (() => { const x = Math.cos(tm) / g.rx1, y = Math.sin(tm) / g.ry1, l = Math.hypot(x, y); return [x / l, y / l, 0]; })();
      q([[...o0, g.zf], [...o1, g.zf], [...i1, g.zf], [...i0, g.zf]], [0, 0, 1], [c, c, c, c]);                       // front
      q([[...o0, g.zf], [...o0, g.zw], [...o1, g.zw], [...o1, g.zf]], nO, [c, c, c, c]);                               // outer edge
      q([[...i0, g.zf], [...i1, g.zf], [...i1, g.zi], [...i0, g.zi]], [-nO[0], -nO[1], 0], [c, c, c, c]);             // inner tube
    }
  }
  // roofs of any plan (pic.hroofs, the buildings shaped from a spec): a rectangle x0-x1 by z0 (back) - z1 (front), eaves
  // at row yE, ridge at yR along x or z; hip 0 a gable (its ends are wall triangles in the colour at R.wall), 1 a
  // pyramid, between a hip roof; shed: one slope, high on that side ('x0' 'x1' 'z0' 'z1'). Tiles drawn in code, courses
  // along the eaves; a fascia t thick under every eave and verge. Every face turned out from the roof's middle
  const outward = (pts, c) => {
    const [p0, p1, , p3] = pts, u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], v = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; n = n.map((k) => k / l);
    const m = pts.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4, a[2] + p[2] / 4], [0, 0, 0]);
    return (m[0] - c[0]) * n[0] + (m[1] - c[1]) * n[1] + (m[2] - c[2]) * n[2] < 0 ? n.map((k) => -k) : n;
  };
  const dk = uv(2.5, 1.5);   // fascias and verges: a tile's own colour (the joint colour drew a black line that shimmered)
  for (const R of s.pic.hroofs || []) {
    const alongX = (R.ridge || 'x') === 'x', P = (a, y, b) => alongX ? [a, y, b] : [b, y, a];
    const [a0, a1] = alongX ? [R.x0, R.x1] : [R.z0, R.z1], [b0, b1] = alongX ? [R.z0, R.z1] : [R.x0, R.x1], t = R.t ?? 2;
    const mid = (b0 + b1) / 2, half = (b1 - b0) / 2, rise = R.yR - R.yE, c = [(R.x0 + R.x1) / 2, R.yE - 1, (R.z0 + R.z1) / 2];
    const bk = (x, y) => s.back ? [(s.back[0] + clamp(x, 0, s.w - .01)) / AW2, (s.back[1] + clamp(s.h - y, 0, s.h - .01)) / AH] : fuv(x, y);
    const face = (pts, uvs) => q(pts, outward(pts, c), uvs), wall = R.wall ? (R.wallBack ? bk(R.wall[0], R.wall[1]) : fuv(R.wall[0], R.wall[1])) : dk;
    if (R.shed) {   // one slope, from the low side up to the high one; the high side and the two ends closed by wall
      const inZ = R.shed[0] === 'z', hiEnd = R.shed[1] === '1';
      const [s0, s1] = inZ ? [R.z0, R.z1] : [R.x0, R.x1], [e0, e1] = inZ ? [R.x0, R.x1] : [R.z0, R.z1], lo = hiEnd ? s0 : s1, hi = hiEnd ? s1 : s0;
      const Q = (e, y, sv) => inZ ? [e, y, sv] : [sv, y, e], len = Math.hypot(s1 - s0, rise);
      face([Q(e0, R.yE, lo), Q(e1, R.yE, lo), Q(e1, R.yR, hi), Q(e0, R.yR, hi)], [uv(0, len), uv(e1 - e0, len), uv(e1 - e0, 0), uv(0, 0)]);
      face([Q(e0, R.yE - t, lo), Q(e1, R.yE - t, lo), Q(e1, R.yE, lo), Q(e0, R.yE, lo)], [dk, dk, dk, dk]);
      face([Q(e0, R.yE - t, hi), Q(e1, R.yE - t, hi), Q(e1, R.yR, hi), Q(e0, R.yR, hi)], [wall, wall, wall, wall]);
      for (const e of [e0, e1]) face([Q(e, R.yE - t, lo), Q(e, R.yE - t, hi), Q(e, R.yR, hi), Q(e, R.yE, lo)], [wall, wall, wall, wall]);
      continue;
    }
    let h = (R.hip || 0) * half, aa = a0 + h, ab = a1 - h; if (aa > ab) aa = ab = (a0 + a1) / 2;
    const len = Math.hypot(half, rise);
    face([P(a0, R.yE, b1), P(a1, R.yE, b1), P(ab, R.yR, mid), P(aa, R.yR, mid)], [uv(0, len), uv(a1 - a0, len), uv(ab - a0, 0), uv(aa - a0, 0)]);
    face([P(a1, R.yE, b0), P(a0, R.yE, b0), P(aa, R.yR, mid), P(ab, R.yR, mid)], [uv(0, len), uv(a1 - a0, len), uv(ab - a0, 0), uv(aa - a0, 0)]);
    for (const b of [b0, b1]) face([P(a0, R.yE - t, b), P(a1, R.yE - t, b), P(a1, R.yE, b), P(a0, R.yE, b)], [dk, dk, dk, dk]);   // fascias
    for (const [ae, ai] of [[a0, aa], [a1, ab]]) {
      if (h > 0) {   // a hip: a sloping triangle, and its fascia
        const hl = Math.hypot(h, rise);
        face([P(ae, R.yE, b0), P(ae, R.yE, b1), P(ai, R.yR, mid), P(ai, R.yR, mid)], [uv(0, hl), uv(b1 - b0, hl), uv(half, 0), uv(half, 0)]);
        face([P(ae, R.yE - t, b0), P(ae, R.yE - t, b1), P(ae, R.yE, b1), P(ae, R.yE, b0)], [dk, dk, dk, dk]);
      } else {         // a gable: the wall triangle and the two verges
        const ew = R.endsAt ? (ae === a0 ? R.endsAt[0] : R.endsAt[1]) : ae;   // the wall triangle where the walls are (endsAt), not at the eaves
        face([P(ew, R.yE, b0), P(ew, R.yE, b1), P(ew, R.yR, mid), P(ew, R.yR, mid)], [wall, wall, wall, wall]);
        for (const b of [b0, b1]) face([P(ae, R.yE - t, b), P(ae, R.yE, b), P(ae, R.yR, mid), P(ae, R.yR - t, mid)], [dk, dk, dk, dk]);
      }
    }
  }
  // cards (thin pieces of a building shaped from a spec: a cross, the sails, a vine): a plane at z with a face each way,
  // drawing only its own pixels (layer 500 + its number, see LAYER_TEST)
  for (const C of s.pic.cards || []) {
    const uvs = [fuv(C.x0, C.r0), fuv(C.x1, C.r0), fuv(C.x1, C.r1), fuv(C.x0, C.r1)].map(([u, v]) => [u, v]), lay = 500 + C.k;
    out.push({ p: [[C.x0, C.r0, C.z], [C.x1, C.r0, C.z], [C.x1, C.r1, C.z], [C.x0, C.r1, C.z]].map(([x, y, z]) => [x - s.px, y, z]), n: [0, 0, 1], uv: uvs.flat(), layer: lay });
    out.push({ p: [[C.x1, C.r0, C.z], [C.x0, C.r0, C.z], [C.x0, C.r1, C.z], [C.x1, C.r1, C.z]].map(([x, y, z]) => [x - s.px, y, z]), n: [0, 0, -1], uv: [uvs[1], uvs[0], uvs[3], uvs[2]].flat(), layer: lay });
  }
  // cones (a windmill's cap, a turret): base radius r at row yE around (cx, cz), apex at yR, n segments, tiled
  for (const C of s.pic.cones || []) {
    const n = C.n || 12, c = [C.cx, C.yE - 1, C.cz], len = Math.hypot(C.r, C.yR - C.yE), t = C.t ?? 2;
    for (let k = 0; k < n; k++) {
      const t0 = k / n * Math.PI * 2, t1 = (k + 1) / n * Math.PI * 2, B = (a, y) => [C.cx + Math.sin(a) * C.r, y, C.cz + Math.cos(a) * C.r], A = [C.cx, C.yR, C.cz];
      const pts = [B(t0, C.yE), B(t1, C.yE), A, A]; q(pts, outward(pts, c), [uv(t0 * C.r, len), uv(t1 * C.r, len), uv((t0 + t1) / 2 * C.r, 0), uv((t0 + t1) / 2 * C.r, 0)]);
      const f = [B(t0, C.yE - t), B(t1, C.yE - t), B(t1, C.yE), B(t0, C.yE)]; q(f, outward(f, c), [dk, dk, dk, dk]);
    }
  }
  // cylinders (a windmill's tower): radius r0 at row y0 to r1 at row y1 around (cx, cz), n segments; each segment reads
  // the columns it faces, from the back picture when R.back (the drawing there cleaned of what stands in front: sails)
  for (const C of s.pic.cyls || []) {
    const n = C.n || 16, src = C.back && s.back ? s.back : [s.ax, s.ay], cu = (x, y) => [(src[0] + clamp(x, .5, s.w - .5)) / AW2, (src[1] + clamp(s.h - y, .5, s.h - .5)) / AH];
    const B = (a, r, y) => [C.cx + Math.sin(a) * r, y, C.cz + Math.cos(a) * r], c = [C.cx, (C.y0 + C.y1) / 2, C.cz];
    for (let k = 0; k < n; k++) {
      const t0 = k / n * Math.PI * 2, t1 = (k + 1) / n * Math.PI * 2, u = (r, a) => C.cx + Math.sin(a) * r * .98;
      const pts = [B(t0, C.r0, C.y0), B(t1, C.r0, C.y0), B(t1, C.r1, C.y1), B(t0, C.r1, C.y1)];
      q(pts, outward(pts, c), [cu(u(C.r0, t0), C.y0 + .5), cu(u(C.r0, t1), C.y0 + .5), cu(u(C.r1, t1), C.y1 - .5), cu(u(C.r1, t0), C.y1 - .5)]);
    }
  }
  for (const r of s.pic.roofs || []) {
    const top = (y) => y + 1, d = r.zf - r.zb, dark = 3.5;
    for (const [xe, sgn] of [[r.xl, -1], [r.xr, 1]]) {
      const run = Math.abs(r.cx - xe), rise = r.yR - r.yE, len = Math.hypot(run, rise), n = [sgn * rise / len, run / len, 0];
      q([[xe, top(r.yE), r.zf], [r.cx, top(r.yR), r.zf], [r.cx, top(r.yR), r.zb], [xe, top(r.yE), r.zb]], n, [uv(0, len), uv(0, 0), uv(d, 0), uv(d, len)]);   // the slope
      for (const [z, nz] of [[r.zf, 1], [r.zb, -1]]) q([[xe, top(r.yE) - r.t, z], [r.cx, top(r.yR) - r.t, z], [r.cx, top(r.yR), z], [xe, top(r.yE), z]], [0, 0, nz], [uv(1, dark), uv(len, dark), uv(len, dark), uv(1, dark)]);   // fascia
      q([[xe, top(r.yE) - r.t, r.zb], [xe, top(r.yE) - r.t, r.zf], [xe, top(r.yE), r.zf], [xe, top(r.yE), r.zb]], [sgn, 0, 0], [uv(0, dark), uv(d, dark), uv(d, dark), uv(0, dark)]);   // eave end
    }
  }
  return out;
}

// a thing built from parts by rows (BUILD[key].parts, rows from the top of the front drawing)
function partsOf(s) {
  const out = []; let board = null;
  for (const P of BUILD[s.key].parts) {
    if (P.loft) out.push(...loftOf(s, P.loft[0], P.loft[1], { depth: P.depth, noTop: P.noTop }));
    else if (P.revolve) out.push(...revolveOf(s, P.revolve[0], P.revolve[1], P.n || 12));
    else if (P.card) out.push(...cardOf(s, P.card[0], P.card[1], P.t || 1));
    else if (P.slope) { out.push(...slopeOf(s, P, P.onBoard ? board : null)); if (!P.onBoard) board = P; }
  }
  return out;
}
const rawQuad = (s, pts, n, uvs, layer) => ({ p: pts.map(([x, y, z]) => [x - s.px, y, z - s.depth / 2]), n, uv: uvs.flat(), layer: layer || 0 });
const fpx = (s, x, y) => auv(s.ax + clamp(x, .5, s.w - .5), s.ay + clamp(s.h - y, .5, s.h - .5));   // the front drawing at x, height y
// the x-span of a row of the front drawing (rows from the top)
const rowSpan = (s, r) => { let a = 1e9, b = -1; for (let x = 0; x < s.w; x++) if (s.pic.c[r * s.w + x] >= 0) { a = Math.min(a, x); b = Math.max(b, x + 1); } return b < 0 ? null : [a, b]; };
// a cylinder: rings every second row (each row's width its diameter, its middle the axis), joined by n segments; each
// segment reads the drawing at the column it faces (the back half mirrored), and a cap on top
function revolveOf(s, r0, r1, n) {
  const out = [], rings = [];
  for (let r = r1 - 1; r >= r0; r -= 2) { const sp = rowSpan(s, r); if (sp) rings.push({ y: s.h - r - (r === r1 - 1 ? 1 : 0), cx: (sp[0] + sp[1]) / 2, R: (sp[1] - sp[0]) / 2, r }); }
  const top = rowSpan(s, r0); if (top) rings.push({ y: s.h - r0, cx: (top[0] + top[1]) / 2, R: (top[1] - top[0]) / 2, r: r0 });
  const zc = s.depth / 2, P_ = (g, t) => [g.cx + g.R * Math.sin(t), g.y, zc + g.R * Math.cos(t)];
  // a segment's normal leans up where the shape narrows going up (a barrel's shoulders), down where it widens: a level
  // normal there lit it wrong and read as seen from behind from above
  const nr = (x, y, z) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; };
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i], b = rings[i + 1];
    for (let k = 0; k < n; k++) {
      // each segment spreads the columns of the drawing it covers (x = axis + R sin t): the front half as drawn, the back
      // half mirrored; one column per segment striped the cylinder like a barcode
      const t0 = k / n * Math.PI * 2, t1 = (k + 1) / n * Math.PI * 2, tm = (t0 + t1) / 2, u = (g, t) => g.cx + g.R * Math.sin(t) * .98;
      out.push(rawQuad(s, [P_(a, t0), P_(a, t1), P_(b, t1), P_(b, t0)], nr(Math.sin(tm), (a.R - b.R) / (b.y - a.y), Math.cos(tm)), [fpx(s, u(a, t0), a.y + .5), fpx(s, u(a, t1), a.y + .5), fpx(s, u(b, t1), b.y - .5), fpx(s, u(b, t0), b.y - .5)]));
    }
  }
  const t = rings[rings.length - 1];
  if (t) for (let k = 0; k < n; k += 2) {   // the top: a fan of quads, in the top row's colours
    const pts = [[t.cx, t.y, zc], P_(t, k / n * Math.PI * 2), P_(t, (k + 1) / n * Math.PI * 2), P_(t, (k + 2) / n * Math.PI * 2)];
    out.push(rawQuad(s, pts, [0, 1, 0], pts.map(([x]) => fpx(s, x, t.y - 1.5))));
  }
  return out;
}
// a card: the drawing's rows r0..r1, front and back t px each side of the middle, cut to the outline
function cardOf(s, r0, r1, t) {
  const zc = s.depth / 2, y0 = s.h - r1, y1 = s.h - r0, uv = [fpx(s, 0, y0 + .01), fpx(s, s.w, y0 + .01), fpx(s, s.w, y1 - .01), fpx(s, 0, y1 - .01)];
  const fix = (u) => u.map(([a, b], i) => [i === 1 || i === 2 ? (s.ax + s.w) / AW2 : s.ax / AW2, b]);
  return [rawQuad(s, [[0, y0, zc + t], [s.w, y0, zc + t], [s.w, y1, zc + t], [0, y1, zc + t]], [0, 0, 1], fix(uv), CUT),
          rawQuad(s, [[s.w, y0, zc - t], [0, y0, zc - t], [0, y1, zc - t], [s.w, y1, zc - t]], [0, 0, -1], fix([uv[1], uv[0], uv[3], uv[2]]), CUT)];
}
// a tilted panel (a lectern's board, a book on it): rows r0..r1 of the drawing over columns x, its lower edge front px
// in front of the middle, its upper edge back px; lift raises it along its normal; thick gives it a front edge
function slopeOf(s, P, on) {
  const [r0, r1] = P.slope, sp = P.x || rowSpan(s, Math.floor((r0 + r1) / 2)) || [0, s.w], [x0, x1] = sp, zc = s.depth / 2;
  // its plane: its own (lower edge front px before the middle, upper edge back px, rise px high; default: as drawn), or,
  // with on, the board's plane at the same rows of the drawing (a book lying on a lectern)
  const plane = (B, r) => { const yb0 = s.h - B.slope[1], t = (B.slope[1] - r) / (B.slope[1] - B.slope[0]), rise = B.rise ?? (B.slope[1] - B.slope[0]); return [yb0 + rise * t, zc + B.front + (B.back - B.front) * t]; };
  const [ybG, zb] = plane(on || P, r1), [ytG, zt] = plane(on || P, r0), yb = s.h - r1, yt = s.h - r0;
  const ny = zb - zt, nz = ytG - ybG, l = Math.hypot(ny, nz), n = [0, ny / l, nz / l];
  const L = P.lift || 0, off = (y, z) => [y + n[1] * L, z + n[2] * L], [yb2, zb2] = off(ybG, zb), [yt2, zt2] = off(ytG, zt), T = P.thick || 0;
  const out = [rawQuad(s, [[x0, yb2, zb2], [x1, yb2, zb2], [x1, yt2, zt2], [x0, yt2, zt2]], n, [fpx(s, x0, yb + .5), fpx(s, x1, yb + .5), fpx(s, x1, yt - .5), fpx(s, x0, yt - .5)])];
  if (T) {   // a board thick px: the underside, the front and back edges, the two sides, in the frame's colour
    const c = fpx(s, x0 + 1.5, (yb + yt) / 2), d = [0, -n[1] * T, -n[2] * T];
    out.push(rawQuad(s, [[x0, yt2 + d[1], zt2 + d[2]], [x1, yt2 + d[1], zt2 + d[2]], [x1, yb2 + d[1], zb2 + d[2]], [x0, yb2 + d[1], zb2 + d[2]]], n.map((v) => -v), [c, c, c, c]));
    out.push(rawQuad(s, [[x0, yb2 + d[1], zb2 + d[2]], [x1, yb2 + d[1], zb2 + d[2]], [x1, yb2, zb2], [x0, yb2, zb2]], [0, -n[2], n[1]], [c, c, c, c]));
    out.push(rawQuad(s, [[x1, yt2 + d[1], zt2 + d[2]], [x0, yt2 + d[1], zt2 + d[2]], [x0, yt2, zt2], [x1, yt2, zt2]], [0, n[2], -n[1]], [c, c, c, c]));
    for (const [x, sx] of [[x0, -1], [x1, 1]]) out.push(rawQuad(s, [[x, yb2 + d[1], zb2 + d[2]], [x, yt2 + d[1], zt2 + d[2]], [x, yt2, zt2], [x, yb2, zb2]], [sx, 0, 0], [c, c, c, c]));
  }
  return out;
}

// the cross: the front card through the middle of the depth, the side card through the anchor; each with both faces
function crossOf(s) {
  const d = s.depth, h = s.h, w = s.w, zc = d / 2, xc = s.px, out = [];
  const both = (pts, region) => { for (const q of [pts, [pts[1], pts[0], pts[3], pts[2]]]) { const f = face(s, q, region); if (f) { f.layer = CUT; out.push(f); } } };   // cards: cut to the outline
  both([[0, 0, zc], [w, 0, zc], [w, h, zc], [0, h, zc]], 'front');
  both([[xc, 0, d], [xc, 0, 0], [xc, h, 0], [xc, h, d]], 'side');
  return out;
}

// the 2D style (settings.flat): a thing is its front drawing on one card facing the fixed camera, the same size as in 3D,
// where its 3D front stands: through the middle for a cross (a tree: where it blocks the way), else the front of its
// footprint (the frontmost pixel for one drawn in code). Cut to every drawn pixel (layer
// FLAT reads the aux alpha: also the pixels only coloured for a smooth part, the bakery's sign and chimney)
const FLAT = 400;
function flatOf(s) {
  if (s.flatQ) return s.flatQ;
  let zf = BUILD[s.key] === 'cross' ? 0 : (s.depth || 0) / 2;
  if (s.pixel) { zf = -1e9; s.each((x, y, i) => { zf = Math.max(zf, s.zf[i]); }); }   // drawn in code: its frontmost pixel
  const f = face(s, [[0, 0, 0], [s.w, 0, 0], [s.w, s.h, 0], [0, s.h, 0]], 'front');
  f.layer = FLAT; for (const p of f.p) p[2] = zf;
  return (s.flatQ = [f]);
}

// the chest, closed (lid 0) or open (lid CHEST.open), or anywhere between while it swings: body, inside, lid on its hinge
function chestQuads(s, lid) {
  if (!s.chest) {
    const body = loftOf(s, CHEST.seam, s.h, { noTop: true }), cover = loftOf(s, 0, CHEST.seam, { bottom: 'lidIn' });
    const r = body.ring(s.h - CHEST.seam), x0 = r.x0 + 1, x1 = r.x1 - 1, zf = r.zf - 1, zb = r.zb + 1, top = s.h - CHEST.seam, y = top - CHEST.inset;
    const inside = [[[x0, y, zb], [x1, y, zb], [x1, y, zf], [x0, y, zf]], [[x0, y, zf], [x1, y, zf], [x1, top, zf], [x0, top, zf]], [[x1, y, zb], [x0, y, zb], [x0, top, zb], [x1, top, zb]],
      [[x0, y, zb], [x0, y, zf], [x0, top, zf], [x0, top, zb]], [[x1, y, zf], [x1, y, zb], [x1, top, zb], [x1, top, zf]]].map((q) => face(s, q, 'dark'));
    // the faces of the inside look inward: flip each so its normal points into the box
    for (const q of inside) { q.n = q.n.map((c) => -c); q.flipIn = true; }
    s.chest = { body, cover, inside, hy: top, hz: r.zb - s.depth / 2 };
  }
  const C = s.chest, out = C.body.slice();
  if (lid === 0) return out.concat(C.cover);
  out.push(...C.inside);
  const c = Math.cos(lid), sn = Math.sin(lid), rot = (y, z) => [C.hy + (y - C.hy) * c - (z - C.hz) * sn, C.hz + (y - C.hy) * sn + (z - C.hz) * c];
  for (const q of C.cover) {
    const p = q.p.map(([x, y, z]) => { const [y2, z2] = rot(y, z); return [x, y2, z2]; }), n = [q.n[0], q.n[1] * c - q.n[2] * sn, q.n[1] * sn + q.n[2] * c];
    out.push({ p, n, uv: q.uv, layer: q.layer });
  }
  return out;
}

// a copy of local quads in the current builder S, at (x, z) on the ground o.y, turned by o.rot quarter turns, o.flip
function putLow(quads, x, z, o) {
  o = o || {};
  const rot = (((o.rot || 0) % 4) + 4) % 4, fl = o.flip ? -1 : 1, ox = Math.round(x * PPU) / PPU, oz = Math.round(z * PPU) / PPU, oy = o.y || 0;
  const tf = (X, Z) => { let a = X * fl, c = Z; for (let r = 0; r < rot; r++) { const m = a; a = c; c = -m; } return [a, c]; };
  const pts = new Array(12);
  for (const q of quads) {
    for (let k = 0; k < 4; k++) { const [a, c] = tf(q.p[k][0], q.p[k][2]); pts[k * 3] = ox + a * P; pts[k * 3 + 1] = oy + q.p[k][1] * P; pts[k * 3 + 2] = oz + c * P; }
    const [nx, nz] = tf(q.n[0], q.n[2]);
    S.quad(pts, nx, q.n[1], nz, q.uv, q.layer, nx, q.n[1], nz);
  }
}

// ---- engine/24-shapes.js
/* ---------- buildings shaped from a spec: the sheet's drawing, given the shape of what it is ---------- */
// SHAPES (content fills it): key → { parts: [...] }. Each part says what a piece of the building is, measured on the
// sheet's front drawing (tools/shape-measure.mjs prints it: columns x, rows r from the ground) and its side view
// (depths z from the front). The drawing keeps its pixels and colours; each pixel takes the depth and the flags of the
// last part whose area holds it, and the smooth parts are built from the numbers. Same sheet, same spec, same model.
//   { block: [x0, x1, r0, r1], z: [front, back], roof: { ridge: 'x'|'z', hip: 0-1, yR, over, shed, x: [x0, x1] } }
//       a wall body: its drawing flush on its front, its sides a box; its roof from its top row (r1) up to yR, ridge
//       along x or z (hip 0 a gable, 1 a pyramid; shed: one slope, high on that side). Under a gable seen end on (ridge
//       z) the drawing's gable is wall; any other roof hides the drawing above r1 (its tiles are drawn in code). roof.x:
//       its columns when they are not the walls' (a gable drawn off the middle)
//   { open: [x0, x1, r0, r1], in: k }      a door, a window: set in k, its inner walls a box
//   { ring: [cx, cy, r0, r1], in: k }       a round window or an arch's frame: a ring, its middle set in k
//   { card: [x0, x1, r0, r1], z: front, t } a thin flat piece (a cross, a sail, a sign): t thick, no sides
//   { box: [x0, x1, r0, r1], z: [front, back] }   a solid (a chimney, a cornice): its drawing is colour only
//   { cyl: [cx, r0, r1, y0, y1], z: axis }  a round tower, radius r0 at row y0 to r1 at y1
//   { cone: [cx, r, yE, yR], z: axis }      a conical cap
//   { slope: [x0, x1, r0, r1], out: k }     an awning, a door's canopy: a panel from its top row on the wall out k
//   { sails: { hub: [x, r], arms: [[x, r], ...], w }, z: front, t }   a windmill's sails: the pixels within w/2 of
//       a line from the hub to an arm's tip, a thin card
// A pixel no part holds stays on the main block's front as a thin card (a vine, a lamp on the wall), or joins the sails
// when it lies within 4 pixels of them (their drawn edges).
//   spec.erase: [[x0, x1, r0, r1], ...]  something drawn that is not wanted (an unreadable chimney): what stands above the
//       roof line there goes; the roof under it is the nearest column outside, moved to the same roof line
// The editor's brushes, per pixel "x,r" (applied after the parts, so a hand change wins):
//   spec.paint: { "x,r": "#rrggbb" | "none" }   the front's colour ("none" takes the pixel away), in 3D and in 2D
//   spec.backPaint: { "x,r": "#rrggbb" }        the back's colour
//   spec.relief: { "x,r": [front, back] }       the pixel's depths from the front, by hand (it and its neighbours get
//       their side faces, so a step in or out is closed)
//   spec.flags: { "x,r": { glow, sides, hidden } }   1 or 0 each: lit at night; side faces; colour only (not built)
const SHAPES = {}, SHAPE_EDITS = {};   // SHAPE_EDITS: content/edits/<key>.json, put in by the build (tools/lib/edits.mjs)

function shapeBuilding(src, spec, sheet) {
  const original = src; if (spec.erase) src = eraseFrom(src, spec.erase); if (spec.paint) src = paintFrom(src, spec.paint);
  // depths on whole pixels (an odd depth's half pixel left a seam between the pixels and the wall boxes)
  const W = src.w, H = src.h, D = spec.depth || (src.side ? src.side.w : src.d), hd = Math.floor(D / 2), Z = (zs) => hd - zs;
  const p = new Pic(W, H), own = new Int16Array(W * H).fill(-1), parts = spec.parts;
  const at = (x, r) => (r >= 0 && r < H && x >= 0 && x < W) ? (H - 1 - r) * W + x : -1;
  const inRect = (q, x, r) => x >= q[0] && x <= q[1] && r >= q[2] && r <= q[3];
  const block0 = parts.find((q) => q.block);
  // which part holds each pixel: the last one whose area holds it
  const area = (q, x, r) => {
    if (q.block) { if (inRect(q.block, x, r)) return true; const R = q.roof, sp = R && (R.x || q.block); return !!R && x >= sp[0] - (R.over ?? 2) && x <= sp[1] + (R.over ?? 2) && r > q.block[3]; }
    if (q.open || q.card || q.box) return inRect(q.open || q.card || q.box, x, r);
    if (q.ring) return Math.hypot(x + .5 - q.ring[0], r + .5 - q.ring[1]) <= q.ring[3];
    if (q.cyl) { const [cx, r0, r1, y0, y1] = q.cyl; if (r < y0 || r > y1) return false; const rad = r0 + (r1 - r0) * (r - y0) / Math.max(1, y1 - y0); return Math.abs(x + .5 - cx) <= rad; }
    if (q.cone) { const [cx, rr, yE, yR] = q.cone; return r >= yE && r <= yR && Math.abs(x + .5 - cx) <= rr * (1 - (r - yE) / (yR - yE)) + 1; }
    if (q.slope) return inRect(q.slope, x, r);
    if (q.sails) { const [hx, hr] = q.sails.hub, px = x + .5, pr = r + .5; return q.sails.arms.some(([tx, tr]) => { const dx = tx - hx, dr = tr - hr, l2 = dx * dx + dr * dr, k = clamp(((px - hx) * dx + (pr - hr) * dr) / l2, 0, 1); return Math.hypot(px - hx - k * dx, pr - hr - k * dr) <= q.sails.w / 2; }); }
    return false;
  };
  for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) { const i = at(x, r); if (src.c[i] < 0) continue; for (let k = parts.length - 1; k >= 0; k--) if (area(parts[k], x, r)) { own[i] = k; break; } }
  // a pixel no part holds, near sails: theirs (the drawn sails are wider than their lines at the tips)
  const nearSails = (q, x, r) => { const [hx, hr] = q.sails.hub, px = x + .5, pr = r + .5; return q.sails.arms.some(([tx, tr]) => { const dx = tx - hx, dr = tr - hr, l2 = dx * dx + dr * dr, k = clamp(((px - hx) * dx + (pr - hr) * dr) / l2, 0, 1.15); return Math.hypot(px - hx - k * dx, pr - hr - k * dr) <= q.sails.w / 2 + 4; }); };
  for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) { const i = at(x, r); if (src.c[i] < 0 || own[i] >= 0) continue; const k = parts.findIndex((q) => q.sails && nearSails(q, x, r)); if (k >= 0) own[i] = k; }
  // a pixel no part holds within 2 pixels of a tower or a cap: theirs (the drawing's outline around them; on a
  // card of its own it stood off the tower's round edge like a hanging thread)
  const solid = (k) => k >= 0 && (parts[k].cyl || parts[k].cone);   // (round parts only: beside a block, a bush or a vine keeps its own card)
  for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) {
    const i = at(x, r); if (src.c[i] < 0 || own[i] >= 0) continue;
    let k = -1; for (let d = 1; d <= 2 && k < 0; d++) for (let dy = -d; dy <= d && k < 0; dy++) for (let dx = -d; dx <= d; dx++) { const j = at(x + dx, r + dy); if (j >= 0 && solid(own[j]) && src.c[j] >= 0) { k = own[j]; break; } }
    if (k >= 0) own[i] = k;
  }
  // the block a part stands on: the last block whose rectangle holds the part's middle
  const host = (x, r) => { for (let k = parts.length - 1; k >= 0; k--) if (parts[k].block && inRect(parts[k].block, x, r)) return parts[k]; return block0 || { z: [hd - 1, hd + 1] }; };
  const glow = (i) => src.fl[i] & F_GLOW;
  // the cards: 0 for the pixels no part holds, then one per card or sails part; a card's pixel is a ghost that keeps no
  // sides, its card's number in its back depth (engine/20-sprites.js turns it into its aux mark)
  const cardNo = new Map(); parts.forEach((q) => { if (q.card || q.sails) cardNo.set(q, cardNo.size + 1); });
  const cardPx = (x, r, c, k, g) => p.at(x, r, c, k + 1, k, F_GHOST | F_NOSIDE | g);
  const boxes = p.boxes = [], rings = p.rings = [], hroofs = p.hroofs = [], cyls = p.cyls = [], cones = p.cones = [];
  // the pixels
  for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) {
    const i = at(x, r), c = src.c[i]; if (c < 0) continue;
    const q = parts[own[i]], g = glow(i);
    if (!q) { cardPx(x, r, c, 0, g); continue; }   // card 0: whatever no part holds, just in front of the main wall
    if (q.block) {
      const [x0, x1, , r1] = q.block, zf = Z(q.z[0]), zb = Z(q.z[1]), R = q.roof;
      if (r <= r1 || !R) { p.at(x, r, c, zf, zb, F_NOSIDE | g); continue; }
      // above the eaves: under a gable seen end on, the gable wall up to the roof's underside; anything else is roof
      if (R.ridge === 'z' && !R.shed && !R.hip) { const [s0, s1] = R.x || [x0, x1], cx = (s0 + s1 + 1) / 2, run = cx - s0 + (R.over ?? 2), y = r1 + (R.yR - r1) * (1 - Math.abs(x + .5 - cx) / run); if (r + 1 < y) { p.at(x, r, c, zf, zb, F_NOSIDE | g); continue; } }
      p.at(x, r, c, zf, zb, F_GHOST); continue;
    }
    if (q.open) { const b = host((q.open[0] + q.open[1]) / 2, (q.open[2] + q.open[3]) / 2); p.at(x, r, c, Z(b.z[0]) - q.in, Z(b.z[1]), F_NOSIDE | g); continue; }
    if (q.ring) { const b = host(q.ring[0], q.ring[1]), d = Math.hypot(x + .5 - q.ring[0], r + .5 - q.ring[1]); p.at(x, r, c, d < q.ring[2] ? Z(b.z[0]) - q.in : Z(b.z[0]), Z(b.z[1]), F_NOSIDE | g); continue; }
    if (q.card || q.sails) { cardPx(x, r, c, cardNo.get(q), g); continue; }
    if (q.slope) { const b = host((q.slope[0] + q.slope[1]) / 2, q.slope[2]); p.at(x, r, c, Z(b.z[0]), Z(b.z[1]), F_NOSIDE | g); continue; }
    p.at(x, r, c, Z(0), Z(D), F_GHOST);   // box, cylinder, cone: built whole, the drawing only colours them
  }
  // a block's front is closed: where the drawing leaves a pixel of its rectangle empty (a wall's edge a pixel in), the
  // nearest wall pixel of the row fills it, or the camera looks into the box through the gap
  for (const q of parts) if (q.block) {
    const [x0, x1, r0, r1] = q.block, zf = Z(q.z[0]), zb = Z(q.z[1]);
    for (let r = r0; r <= r1; r++) for (let x = x0; x <= x1; x++) {
      const i = at(x, r); if (i < 0 || p.c[i] >= 0) continue;
      for (let d = 1; d <= x1 - x0; d++) { const a = at(x - d, r), b = at(x + d, r), c = (a >= 0 && x - d >= x0 && src.c[a] >= 0) ? src.c[a] : (b >= 0 && x + d <= x1 && src.c[b] >= 0) ? src.c[b] : -1; if (c >= 0) { p.at(x, r, c, zf, zb, F_NOSIDE); break; } }
    }
  }
  // the brushes: depths by hand, then flags
  const pix = (k) => { const [x, r] = k.split(',').map(Number); const i = at(x, r); return i >= 0 && p.c[i] >= 0 ? [x, r, i] : null; };
  for (const [k, v] of Object.entries(spec.relief || {})) {
    const q = pix(k); if (!q) continue; const [x, r, i] = q;
    p.at(x, r, p.c[i], Z(v[0]), Z(v[1]), p.fl[i] & F_GLOW);
    for (const [a, b] of [[x - 1, r], [x + 1, r], [x, r - 1], [x, r + 1]]) { const j = at(a, b); if (j >= 0 && p.c[j] >= 0 && !(p.fl[j] & F_GHOST)) p.fl[j] &= ~F_NOSIDE; }
  }
  for (const [k, v] of Object.entries(spec.flags || {})) {
    const q = pix(k); if (!q) continue; const i = q[2]; let f = p.fl[i];
    if ('glow' in v) f = v.glow ? f | F_GLOW : f & ~F_GLOW;
    if ('sides' in v) f = v.sides ? f & ~F_NOSIDE : f | F_NOSIDE;
    if ('hidden' in v) f = v.hidden ? (f | F_GHOST) & ~F_NOSIDE : f & ~F_GHOST;   // (ghost and no-sides together mark a card's pixel)
    p.fl[i] = f;
  }
  // the smooth parts
  const front0 = block0 ? Z(block0.z[0]) : hd;
  p.cards = [{ x0: 0, x1: W, r0: 0, r1: H, z: front0 + 1, k: 0 }]; p.front = block0 ? front0 : (parts.find((q) => q.cyl) ? Z(parts.find((q) => q.cyl).z) + parts.find((q) => q.cyl).cyl[1] : hd);   // where the 2D card stands
  for (const q of parts) {
    if (q.card) { const [x0, x1, r0, r1] = q.card; p.cards.push({ x0, x1: x1 + 1, r0, r1: r1 + 1, z: Z(q.z), k: cardNo.get(q) }); }
    if (q.sails) { const pts = [q.sails.hub, ...q.sails.arms], w = q.sails.w; p.cards.push({ x0: Math.max(0, Math.floor(Math.min(...pts.map((a) => a[0])) - w)), x1: Math.min(W, Math.ceil(Math.max(...pts.map((a) => a[0])) + w)), r0: Math.max(0, Math.floor(Math.min(...pts.map((a) => a[1])) - w)), r1: Math.min(H, Math.ceil(Math.max(...pts.map((a) => a[1])) + w)), z: Z(q.z), k: cardNo.get(q) }); }
    if (q.block) {
      const [x0, x1, r0, r1] = q.block, zf = Z(q.z[0]), zb = Z(q.z[1]), R = q.roof;
      boxes.push({ x0, x1: x1 + 1, r0, r1: r1 + 1, zf, zb, faces: 'sides', skip: ['bottom', ...(R ? ['top'] : [])], swatch: q.swatch });
      // a roof narrower than its walls (roof.x) leaves their top open on that side: a cap closes it
      if (R && R.x) { const o = R.over ?? 2; const col = [(x0 + x1) / 2, (r0 + r1) / 2]; if (R.x[0] - o > x0) boxes.push({ x0, x1: R.x[0] - o, r0: r1, r1: r1 + 1, zf, zb, faces: 'all', col }); if (R.x[1] + 1 + o < x1 + 1) boxes.push({ x0: R.x[1] + 1 + o, x1: x1 + 1, r0: r1, r1: r1 + 1, zf, zb, faces: 'all', col }); }
      if (R) { const o = R.over ?? 2, [s0, s1] = R.x || [x0, x1], endOn = R.ridge === 'z' && !R.hip && !R.shed; hroofs.push({ x0: s0 - o, x1: s1 + 1 + o, z0: zb - o, z1: zf + (endOn ? 1 : o), yE: r1 + 1, yR: R.yR + 1, ridge: R.ridge || 'x', hip: R.hip || 0, shed: R.shed, t: R.t ?? 2, wall: [x0 + 2, r1 - 2], endsAt: R.ridge === 'z' && !R.hip && !R.shed ? [zb + 6, zf - 6] : undefined }); }   // a gable seen end on: its triangles inside the drawn gable, behind any opening set into it, closing the attic
    }
    if (q.open) { const [x0, x1, r0, r1] = q.open, b = host((x0 + x1) / 2, (r0 + r1) / 2); boxes.push({ x0, x1: x1 + 1, r0, r1: r1 + 1, zf: Z(b.z[0]), zb: Z(b.z[0]) - q.in, faces: 'in' }); }
    if (q.ring) { const [cx, cy, a, bR] = q.ring, b = host(cx, cy), zf = Z(b.z[0]); rings.push({ cx, cy, rx0: a, ry0: a, rx1: bR, ry1: bR, ru: (a + bR) / 2, a0: 0, a1: Math.PI * 2, n: 16, zf: zf + 1, zw: zf, zi: zf - q.in }); }
    if (q.box) { const [x0, x1, r0, r1] = q.box; boxes.push({ x0, x1: x1 + 1, r0, r1: r1 + 1, zf: Z(q.z[0]), zb: Z(q.z[1]), faces: 'all' }); }
    if (q.cyl) { const [cx, r0, r1, y0, y1] = q.cyl; cyls.push({ cx, cz: Z(q.z), r0, r1, y0, y1: y1 + 1, n: q.n || 16, back: true }); }
    if (q.cone) { const [cx, rr, yE, yR] = q.cone; cones.push({ cx, cz: Z(q.z), r: rr, yE, yR: yR + 1, n: q.n || 16 }); }
    if (q.slope) { const [x0, x1, r0, r1] = q.slope, b = host((x0 + x1) / 2, r0), zf = Z(b.z[0]); (p.slopes = p.slopes || []).push({ x0, x1: x1 + 1, yTop: r1 + 1, yBot: r0, zTop: zf, zBot: zf + q.out }); }
  }
  // the back: the drawing with everything that is not wall (openings, cards, what stands in front of a tower) replaced
  // by the nearest wall pixel of the same row: plain walls behind, a tower's surface without the sails across it
  // (a pixel kept or copied must be plain wall: near the commonest colour its part shows where nothing else comes within
  // 3 pixels, so no frame, shutter, pot or sail edge is smeared across the back or the sides)
  const dom = parts.map((q, k) => {
    if (!(q.block || q.cyl)) return -1; const n = new Map();
    for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) { const i = at(x, r); if (own[i] !== k || src.c[i] < 0) continue; let core = true; for (let dy = -3; dy <= 3 && core; dy++) for (let dx = -3; dx <= 3; dx++) { const j = at(x + dx, r + dy); if (j < 0 || src.c[j] < 0 || own[j] !== k) { core = false; break; } } if (core) n.set(src.c[i], (n.get(src.c[i]) || 0) + 1); }
    return n.size ? [...n].sort((a, b) => b[1] - a[1])[0][0] : -1;
  });
  const dist = (a, b) => Math.abs((a >> 16 & 255) - (b >> 16 & 255)) + Math.abs((a >> 8 & 255) - (b >> 8 & 255)) + Math.abs((a & 255) - (b & 255));
  const back = new Int32Array(W * H).fill(-1), wallish = (i) => { const q = parts[own[i]]; return !!q && (q.block || q.cyl); };
  const plain = (i) => i >= 0 && src.c[i] >= 0 && wallish(i) && dom[own[i]] >= 0 && dist(src.c[i], dom[own[i]]) < 70;
  // each wall part's swatch: the 8 x 8 window of its drawing with the most plain pixels (ties: nearest its middle)
  const swatch = parts.map((q, k) => {
    if (!(q.block || q.cyl)) return null; let best = null;
    for (let r0 = 0; r0 + 8 <= H; r0++) for (let x0 = 0; x0 + 8 <= W; x0++) {
      let n = 0; for (let dy = 0; dy < 8; dy++) for (let dx = 0; dx < 8; dx++) { const j = at(x0 + dx, r0 + dy); if (plain(j) && own[j] === k) n++; }
      if (!best || n > best[0]) best = [n, x0, r0];
    }
    return best && best[0] >= 40 ? best : null;
  });
  // the back: what is plain wall stays; anything else (an opening, a sign, a sail, a smear) takes its wall's swatch, tiled
  for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) {
    const i = at(x, r); if (src.c[i] < 0) continue;
    if (plain(i) || (wallish(i) && parts[own[i]].cyl)) { back[i] = src.c[i]; continue; }   // a tower keeps its drawing: only what crosses it is replaced
    const k = wallish(i) ? own[i] : parts.indexOf(host(x, r)), sw = k >= 0 ? swatch[k] : null;
    if (sw) { const j = at(sw[1] + ((x - sw[1]) % 8 + 8) % 8, sw[2] + ((r - sw[2]) % 8 + 8) % 8); if (plain(j)) { back[i] = src.c[j]; continue; } }
    back[i] = k >= 0 && dom[k] >= 0 ? dom[k] : src.c[i];
  }
  // each block's side walls: the plainest 8 columns of its back (fewest dark, lit or off-colour pixels), repeated along
  // the depth
  const lumC = (c) => (c >> 16 & 255) * .3 + (c >> 8 & 255) * .59 + (c & 255) * .11;
  for (const q of parts) if (q.block) {
    const [x0, x1, r0, r1] = q.block, w = Math.max(2, Math.min(8, Math.floor((x1 - x0 + 1) / 3))); let best = null;
    const tally = new Map(); for (let x = x0; x <= x1; x++) for (let r = r0; r <= r1; r++) { const i = at(x, r); if (i >= 0 && back[i] >= 0) tally.set(back[i], (tally.get(back[i]) || 0) + 1); }
    const dom = tally.size ? [...tally].sort((a, b) => b[1] - a[1])[0][0] : 0, far = (c) => Math.abs((c >> 16 & 255) - (dom >> 16 & 255)) + Math.abs((c >> 8 & 255) - (dom >> 8 & 255)) + Math.abs((c & 255) - (dom & 255)) > 80;   // a shutter, a vine, a pot: not the wall
    for (let a = x0 + 2; a + w <= x1 - 1; a++) {
      let n = 0; for (let x = a; x < a + w; x++) for (let r = r0; r <= r1; r++) { const i = at(x, r); if (i < 0 || back[i] < 0) { n += 2; continue; } if (lumC(back[i]) < 70 || src.fl[i] & F_GLOW || far(back[i])) n++; }
      const score = n * 1000 + Math.abs(a + w / 2 - (x0 + x1) / 2); if (!best || score < best[0]) best = [score, a];
    }
    const box = boxes.find((b) => b.faces === 'sides' && b.x0 === x0 && b.r0 === r0 && b.r1 === r1 + 1); if (box) box.swatch = best ? [best[1], best[1] + w] : [x0, x1 + 1];
    // its roof's gable ends: the swatch's middle, half way up, on the back
    const sw = box && box.swatch, hr = q.roof && hroofs.find((h) => h.yE === r1 + 1 && h.z1 === Z(q.z[0]) + (q.roof.over ?? 2)); if (hr && sw) { hr.wall = [(sw[0] + sw[1]) / 2, (r0 + r1) / 2]; hr.wallBack = true; }
  }
  // pixels added to close a block's front: the wall's colour behind
  for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) { const i = at(x, r); if (p.c[i] >= 0 && back[i] < 0) { const k = parts.indexOf(host(x, r)); back[i] = k >= 0 && dom[k] >= 0 ? dom[k] : p.c[i]; } }
  // each pixel's body front (its block's, a tower's front, a card's plane): the 2D card raises a body set back by how far
  // back it stands, as the camera sees it (engine/34-bake.js)
  const ownZ = new Float32Array(W * H).fill(NaN);
  for (let r = 0; r < H; r++) for (let x = 0; x < W; x++) {
    const i = at(x, r); if (src.c[i] < 0) continue; const q = parts[own[i]];
    const b = !q ? host(x, r) : q.block ? q : q.cyl ? null : (q.card || q.sails) ? null : host(q.open ? (q.open[0] + q.open[1]) / 2 : x, q.open ? (q.open[2] + q.open[3]) / 2 : r);
    ownZ[i] = q && q.cyl ? Z(q.z) + q.cyl[1] : q && (q.card || q.sails) ? Z(q.z) : b && b.z ? Z(b.z[0]) : hd;
  }
  p.ownZ = ownZ;
  for (const [k, v] of Object.entries(spec.backPaint || {})) { const q = pix(k); if (q) back[q[2]] = parseInt(v.slice(1), 16); }
  p.back = back; p.tiles = true; p.source = src; p.original = original; p.sourceSheet = sheet;   // the 2D style shows the sheet's own drawing
  return p.done();
}

// a copy of the drawing with spec.paint's colours ("none": no pixel there)
function paintFrom(src, paint) {
  const c = Int32Array.from(src.c), fl = src.fl ? Uint8Array.from(src.fl) : new Uint8Array(src.w * src.h);
  for (const [k, v] of Object.entries(paint)) {
    const [x, r] = k.split(',').map(Number); if (x < 0 || r < 0 || x >= src.w || r >= src.h) continue;
    const i = (src.h - 1 - r) * src.w + x; if (v === 'none') { c[i] = -1; fl[i] = 0; } else c[i] = parseInt(v.slice(1), 16);
  }
  return Object.assign({}, src, { c, fl });
}
// a copy of the drawing without what spec.erase covers: per column, the pixels above the roof line (interpolated between the
// columns just outside) go, and below it the column takes the nearest outside column's pixels shifted to that line
function eraseFrom(src, rects) {
  const W = src.w, H = src.h, c = Int32Array.from(src.c), fl = src.fl ? Uint8Array.from(src.fl) : new Uint8Array(W * H);
  const top = (x) => { for (let y = 0; y < H; y++) if (c[y * W + x] >= 0) return H - y; return 0; };   // rows above the ground
  for (const [x0, x1, r0, r1] of rects) {
    const L = Math.max(0, x0 - 1), R = Math.min(W - 1, x1 + 1), tL = top(L), tR = top(R);
    for (let x = x0; x <= x1; x++) {
      const line = Math.round(tL + (tR - tL) * (x - L) / Math.max(1, R - L)), from = x - L <= R - x ? L : R, shift = top(from) - line;
      for (let r = r0; r <= r1; r++) {
        const i = (H - 1 - r) * W + x;
        if (r >= line) { c[i] = -1; continue; }
        const rr = r + shift; if (rr < 0 || rr >= H) continue; const j = (H - 1 - rr) * W + from; c[i] = src.c[j]; fl[i] = src.fl ? src.fl[j] : 0;
      }
    }
  }
  return Object.assign({}, src, { c, fl });
}

// ---- engine/25-lpkit.js
/* ---------- the low-poly style (lowpoly.html): things and figures modelled in code ---------- */
// Units are art pixels (PPU to a world unit), y up from the ground; x across the front, 0 at the thing's anchor column;
// z toward the front (+), 0 at the middle of its depth: where the sheet sprites stand, so collisions, doors and shadows
// stay where they were. A model (LPM) is a list of flat faces, each with a colour: the light comes from the scene (sun,
// sky, lamps, shadows); the kit adds a soft darkening near the ground (contact shade) and a slight variation per face,
// so surfaces read as made by hand rather than as plastic. Faces that glow at night (windows) carry glow.
// LP_MODELS[key]: () => LPM, built once. LP_FIGURES[key]: a figure with parts and a pose function (lpFigure).
const LP_MODELS = {}, LP_FIGURES = {}, lpCache = {};
let LP_CHEST = null, LP_TILES = null, LP_WALL = null;   // LP_WALL(colour, along, y): a wall's colour at a pixel, by the legend's wall colour   // the chest with its lid at an angle (radians); the ground tiles painted in code
// lowpoly.html: the figures' and effects' sheets at 2x: resampled from the original drawing when the sheet has its @2x
// frames, else enlarged by Scale2x (EPX, Eric Johnston 1992; Andrea Mazzoleni's
// Scale2x): each pixel becomes four, a corner taking a neighbour's colour where two neighbours agree, so diagonals and
// curves get twice the steps and nothing blurs. Same size in the world, twice the pixels. window.__px2 = false: off
const lpPx2 = {};
function lpSheetCanvas(sheet) {
  const SH = SHEETS[sheet]; if (!LP || window.__px2 === false) return SH.canvas;
  if (lpPx2[sheet]) return lpPx2[sheet];
  // frames resampled at 2x from the original drawing (tools/art.mjs): each put at twice its 1x place, so the frames'
  // rectangles, divided by the sheet's size, still find them
  if (SH.hi) {
    const c = document.createElement('canvas'); c.width = SH.w * 2; c.height = SH.h * 2; const x = c.getContext('2d');
    for (const r of Object.values(SH.meta.sprites)) if (r.hi) x.drawImage(SH.hi, r.hi.x, r.hi.y, r.hi.w, r.hi.h, r.x * 2, r.y * 2, r.w * 2, r.h * 2);
    return (lpPx2[sheet] = c);
  }
  const W = SH.w, H = SH.h, s = SH.px, c = document.createElement('canvas'); c.width = W * 2; c.height = H * 2;
  const x = c.getContext('2d'), im = x.createImageData(W * 2, H * 2), d = im.data;
  const at = (i, j) => { i = i < 0 ? 0 : i >= W ? W - 1 : i; j = j < 0 ? 0 : j >= H ? H - 1 : j; return (j * W + i) * 4; };
  const same = (a, b) => s[a] === s[b] && s[a + 1] === s[b + 1] && s[a + 2] === s[b + 2] && (s[a + 3] > 127) === (s[b + 3] > 127);
  const put = (o, k) => { d[o] = s[k]; d[o + 1] = s[k + 1]; d[o + 2] = s[k + 2]; d[o + 3] = s[k + 3]; };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const P0 = at(i, j), A2 = at(i, j - 1), B2 = at(i + 1, j), C2 = at(i - 1, j), D2 = at(i, j + 1), o = ((j * 2) * W * 2 + i * 2) * 4, row = W * 2 * 4;
    let e0 = P0, e1 = P0, e2 = P0, e3 = P0;
    if (!same(A2, D2) && !same(C2, B2)) { if (same(C2, A2)) e0 = C2; if (same(A2, B2)) e1 = B2; if (same(C2, D2)) e2 = C2; if (same(D2, B2)) e3 = B2; }
    put(o, e0); put(o + 4, e1); put(o + row, e2); put(o + row + 4, e3);
  }
  x.putImageData(im, 0, 0);
  return (lpPx2[sheet] = c);
}
const lpRGB = (c) => [c >> 16 & 255, c >> 8 & 255, c & 255];
const lpShade = (c, k) => { const [r, g, b] = lpRGB(c); const f = (v) => Math.max(0, Math.min(255, Math.round(v * k))); return f(r) << 16 | f(g) << 8 | f(b); };
const lpMix = (a, b, t) => { const A2 = lpRGB(a), B2 = lpRGB(b); return A2.map((v, i) => Math.round(v + (B2[i] - v) * t)).reduce((s, v) => s << 8 | v, 0); };
// a polygon's normal (Newell's method): counter-clockwise seen from the side it points to
function lpNormal(p) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]); }
  const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l];
}
const lpMid = (p) => p.reduce((m, q) => [m[0] + q[0] / p.length, m[1] + q[1] / p.length, m[2] + q[2] / p.length], [0, 0, 0]);

class LPM {
  constructor() { this.f = []; this.sg = 0; }   // sg: the last smoothing group handed out (see lpVN)
  // a flat face of 3 or 4 corners; o.from: a point inside the solid, the face is turned to look away from it
  face(pts, c, o = {}) {
    let p = pts.map((q) => q.slice());
    if (o.from) { const n = lpNormal(p), m = lpMid(p); if ((m[0] - o.from[0]) * n[0] + (m[1] - o.from[1]) * n[1] + (m[2] - o.from[2]) * n[2] < 0) p = p.reverse(); }
    const F = (q) => this.f.push({ p: q, c, g: o.glow ? 1 : 0, j: o.jit === undefined ? .035 : o.jit, ao: o.ao === undefined ? 1 : o.ao, s: o.s || 0 });
    if (p.length <= 4) F(p); else for (let i = 1; i + 1 < p.length; i++) F([p[0], p[i], p[i + 1]]);   // a convex polygon: a fan of triangles
    return this;
  }
  // another model's faces, moved: { x, y, z } and turned ry radians about the vertical
  add(m, t = {}) {
    const cy = Math.cos(t.ry || 0), sy = Math.sin(t.ry || 0), s = t.s || 1;
    const base = this.sg; let top = base;   // the added model's smoothing groups, renumbered after this one's
    for (const f of m.f) { if (f.s) top = Math.max(top, base + f.s); this.f.push(Object.assign({}, f, { s: f.s ? base + f.s : 0, p: f.p.map(([x, y, z]) => [(x * cy + z * sy) * s + (t.x || 0), y * s + (t.y || 0), (-x * sy + z * cy) * s + (t.z || 0)]) })); }
    this.sg = top;
    return this;
  }
  // a box; o: colours per face (top, front, back, left, right), skip: faces left out (bottom is left out by default)
  box(x0, y0, z0, x1, y1, z1, c, o = {}) {
    const from = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], skip = o.skip || ['bottom'], F = (k) => o[k] === undefined ? c : o[k], fo = Object.assign({ from }, o.f || {});
    const faces = {
      top: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], bottom: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
      front: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], back: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]],
      left: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], right: [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]],
    };
    for (const k of Object.keys(faces)) if (!skip.includes(k)) this.face(faces[k], F(k), Object.assign({}, fo, k === 'front' && o.glowFront ? { glow: 1 } : {}));
    return this;
  }
  // a convex polygon (u, y) extruded along x (axis 'x': u is z) or along z (axis 'z': u is x), from a0 to a1
  prism(poly, axis, a0, a1, c, o = {}) {
    const P3 = (u, y, a) => (axis === 'x' ? [a, y, u] : [u, y, a]), m = lpMid(poly.map(([u, y]) => [u, y, 0])), from = P3(m[0], m[1], (a0 + a1) / 2);
    if (o.caps !== false) for (const a of [a0, a1]) this.face(poly.map(([u, y]) => P3(u, y, a)), o.cap === undefined ? c : o.cap, { from });
    for (let i = 0; i < poly.length; i++) { const [u0, v0] = poly[i], [u1, v1] = poly[(i + 1) % poly.length]; if (o.skipEdge && o.skipEdge(i)) continue; this.face([P3(u0, v0, a0), P3(u1, v1, a0), P3(u1, v1, a1), P3(u0, v0, a1)], o.side ? o.side(i) : c, { from }); }
    return this;
  }
  // a frustum (a cone when r1 is 0) of n sides around (cx, cz), from y0 to y1; o.top: its lid's colour or false;
  // o.col(k): side k's colour; o.rot: the first side's angle. Round unless o.smooth is false: its sides share normals
  // (smooth shading) and, from 7 sides up, there are enough of them for its size (no side longer than 3 art px)
  frustum(cx, cz, r0, r1, y0, y1, n, c, o = {}) {
    const smooth = o.smooth !== false, sg = smooth ? (o.sg || ++this.sg) : 0;
    if (smooth && n >= 7) n = Math.max(n, Math.min(40, Math.ceil(Math.PI * 2 * Math.max(r0, r1) / 3)));
    const at = (k, r, y) => { const t = (o.rot || 0) + k / n * Math.PI * 2; return [cx + Math.sin(t) * r, y, cz + Math.cos(t) * r]; }, from = [cx, (y0 + y1) / 2, cz];
    for (let k = 0; k < n; k++) {
      const col = o.col ? o.col(k) : c;
      if (r1 > 0) this.face([at(k, r0, y0), at(k + 1, r0, y0), at(k + 1, r1, y1), at(k, r1, y1)], col, { from, glow: o.glow, s: sg });
      else this.face([at(k, r0, y0), at(k + 1, r0, y0), [cx, y1, cz]], col, { from, s: sg });
    }
    if (o.top !== false && r1 > 0) this.face(Array.from({ length: n }, (_, k) => at(k, r1, y1)), o.top === undefined ? c : o.top, { from: [cx, y0, cz] });
    if (o.bottom) this.face(Array.from({ length: n }, (_, k) => at(k, r0, y0)), o.bottom, { from: [cx, y1, cz] });
    return this;
  }
  // a turned shape: rings [[r, y], ...] from the bottom up, n sides; o.col(band, side) or c; o.top: lid colour or false
  lathe(cx, cz, rings, n, c, o = {}) {
    let sg = 0;
    if (o.smooth !== false && n >= 7) n = Math.max(n, Math.min(40, Math.ceil(Math.PI * 2 * Math.max(...rings.map((q) => q[0])) / 3)));
    for (let b = 0; b + 1 < rings.length; b++) {
      const [ra, ya] = rings[b], [rb, yb] = rings[b + 1];
      this.frustum(cx, cz, ra, rb, ya, yb, n, c, { top: false, rot: o.rot, col: o.col ? (k) => o.col(b, k) : undefined, smooth: o.smooth, sg: o.smooth === false ? 0 : (sg || (sg = ++this.sg)) });
    }
    const [rt, yt] = rings[rings.length - 1];
    if (o.top !== false && rt > 0) this.face(Array.from({ length: n }, (_, k) => { const a = (o.rot || 0) + k / n * Math.PI * 2; return [cx + Math.sin(a) * rt, yt, cz + Math.cos(a) * rt]; }), o.top === undefined ? c : o.top, { from: [cx, yt - 1, cz] });
    return this;
  }
  // a rounded blob: an icosahedron split once (80 faces), twice from 8 px across (320), its corners nudged by a seeded
  // amount, smooth unless o.facet (foliage keeps its facets); o.sx, o.sy, o.sz stretch it
  // vertically, o.col(face centre) colours it, o.flat cuts it flat below y (a canopy's underside)
  blob(cx, cy, cz, r, c, o = {}) {
    const t = (1 + Math.sqrt(5)) / 2, V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => { const l = Math.hypot(...v); return v.map((q) => q / l); });
    const F0 = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    const mid = new Map(), verts = V.slice(), M = (a, b) => { const k = a < b ? a + '_' + b : b + '_' + a; if (!mid.has(k)) { const v = verts[a].map((q, i) => (q + verts[b][i]) / 2), l = Math.hypot(...v); verts.push(v.map((q) => q / l)); mid.set(k, verts.length - 1); } return mid.get(k); };
    let F = F0; for (let lv = 0, nl = o.sub || (r * Math.max(o.sx || 1, o.sy || 1, o.sz || 1) >= 8 ? 2 : 1); lv < nl; lv++) { const G = []; for (const [a, b, d] of F) { const ab = M(a, b), bd = M(b, d), da = M(d, a); G.push([a, ab, da], [b, bd, ab], [d, da, bd], [ab, bd, da]); } F = G; }
    const sg = o.facet ? 0 : ++this.sg;
    const rnd = rng(o.seed || 7), j = o.jit === undefined ? .14 : o.jit, sy = o.sy || 1;
    const sx = o.sx || 1, sz = o.sz || 1, P3 = verts.map((v) => { const k = 1 + (rnd() * 2 - 1) * j; return [cx + v[0] * r * k * sx, cy + v[1] * r * k * sy, cz + v[2] * r * k * sz]; });
    if (o.flat !== undefined) for (const p of P3) p[1] = Math.max(p[1], o.flat);
    for (const tri of F) { const p = tri.map((i) => P3[i]); if (p.every((q) => o.flat !== undefined && q[1] <= o.flat + 1e-6)) continue; this.face(p, o.col ? o.col(lpMid(p)) : c, { from: [cx, cy, cz], jit: o.facej === undefined ? (sg ? 0 : .06) : o.facej, s: sg }); }
    return this;
  }
  // a roof over the rectangle x0-x1 by z0-z1 (back to front), eaves at yE, ridge at yR, along x or z; hip 0 a gable,
  // 1 a pyramid; over: overhang; t: thickness; courses of tiles every `row` px in two shades; a ridge cap on top.
  // A gable's end is left open with verge boards along its slopes, so the building's own wall gable shows under it;
  // o.ends draws a triangle there in the underside colour, for a roof with no wall gable under it (a well, a porch).
  roof(o) {
    const alongX = (o.ridge || 'x') === 'x', over = o.over === undefined ? 3 : o.over, t = o.t === undefined ? 2 : o.t, c = o.c, under = o.under === undefined ? lpShade(c, .55) : o.under;
    const [a0, a1] = alongX ? [o.x0, o.x1] : [o.z0, o.z1], [b0, b1] = alongX ? [o.z0, o.z1] : [o.x0, o.x1];
    const half = (b1 - b0) / 2, rise = o.yR - o.yE, drop = over * rise / half, A0 = a0 - over, A1 = a1 + over, B0 = b0 - over, B1 = b1 + over, bm = (b0 + b1) / 2, yE = o.yE - drop;
    const h = (o.hip || 0) * (half + over), ra0 = A0 + h, ra1 = A1 - h;
    const Q = (a, y, b) => (alongX ? [a, y, b] : [b, y, a]), from = Q((a0 + a1) / 2, o.yE - t - 1, bm);
    const fas = o.fascia === undefined ? lpShade(c, .7) : o.fascia, row = o.row || 4, len = Math.hypot(half + over, rise + drop), n = Math.max(1, Math.round(len / row)), dark = lpShade(c, .9);
    for (const [be, sgn] of [[B1, 1], [B0, -1]]) for (let i = 0; i < n; i++) {   // the two slopes, course by course from the eave up
      const f0 = i / n, f1 = (i + 1) / n, yy = (f) => yE + (o.yR - yE) * f, bb = (f) => be + (bm - be) * f, aa0 = (f) => A0 + (ra0 - A0) * f, aa1 = (f) => A1 + (ra1 - A1) * f;
      this.face([Q(aa0(f0), yy(f0), bb(f0)), Q(aa1(f0), yy(f0), bb(f0)), Q(aa1(f1), yy(f1), bb(f1)), Q(aa0(f1), yy(f1), bb(f1))], i % 2 ? dark : c, { from, jit: .02 });
    }
    for (const [ae, ra] of [[A0, ra0], [A1, ra1]]) {
      if (h > 0) for (let i = 0; i < n; i++) { const f0 = i / n, f1 = (i + 1) / n, yy = (f) => yE + (o.yR - yE) * f, aa = (f) => ae + (ra - ae) * f, bb0 = (f) => B0 + (bm - B0) * f, bb1 = (f) => B1 + (bm - B1) * f; this.face([Q(aa(f0), yy(f0), bb0(f0)), Q(aa(f0), yy(f0), bb1(f0)), Q(aa(f1), yy(f1), bb1(f1)), Q(aa(f1), yy(f1), bb0(f1))], i % 2 ? dark : lpShade(c, .96), { from, jit: .02 }); }
      else {
        if (o.ends) this.face([Q(ae, yE, B0), Q(ae, yE, B1), Q(ae, o.yR, bm)], under, { from });
        for (const be of [B0, B1]) this.face([Q(ae, yE, be), Q(ae, o.yR, bm), Q(ae, o.yR - t, bm), Q(ae, yE - t, be)], fas, { from });   // the verge
      }
    }
    // the fascia all round, the underside, the ridge cap
    const ring = [Q(A0, yE, B0), Q(A1, yE, B0), Q(A1, yE, B1), Q(A0, yE, B1)];
    for (let i = 0; i < 4; i++) { const p = ring[i], q = ring[(i + 1) % 4]; this.face([[p[0], p[1] - t, p[2]], [q[0], q[1] - t, q[2]], q, p], fas, { from }); }
    this.face(ring.map((p) => [p[0], p[1] - t, p[2]]), under, { from: Q((a0 + a1) / 2, o.yR, bm) });
    if (o.cap !== false && ra1 > ra0) { const w = 1.2; this.prism([[bm - w, o.yR - .5], [bm + w, o.yR - .5], [bm, o.yR + 1.6]], alongX ? 'x' : 'z', ra0 - .5, ra1 + .5, lpShade(c, .8)); }
    return this;
  }
}
const lpModel = (key) => lpCache[key] || (lpCache[key] = LP_MODELS[key] ? lpSettle(LP_MODELS[key]()) : null);   // (settled: lpSettle, below)
// each face's corner normals: its own normal, or, in a smoothing group, the mean of the group's faces meeting there
function lpVN(m) {
  if (m.vn && m.vn.length === m.f.length) return m.vn;
  const acc = new Map(), key = (s, q) => s + '|' + Math.round(q[0] * 64) + ',' + Math.round(q[1] * 64) + ',' + Math.round(q[2] * 64);
  const fn = m.f.map((f) => lpNormal(f.p));
  m.f.forEach((f, i) => { if (!f.s) return; const n = fn[i]; for (const q of f.p) { const k = key(f.s, q), a = acc.get(k); if (a) { a[0] += n[0]; a[1] += n[1]; a[2] += n[2]; } else acc.set(k, n.slice()); } });
  m.vn = m.f.map((f, i) => f.p.map((q) => { if (!f.s) return fn[i]; const a = acc.get(key(f.s, q)), l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }));
  return m.vn;
}

// a model set down in a builder (the chunk's B): at (x, z) on the ground o.y, turned o.rot quarter turns, o.flip
function lpPut(Bd, m, x, z, o = {}) {
  const rot = (((o.rot || 0) % 4) + 4) % 4, fl = o.flip ? -1 : 1, oy = o.y || 0, ox = Math.round(x * PPU) / PPU, oz = Math.round(z * PPU) / PPU;
  const tf = (X, Z) => { let a = X * fl, c = Z; for (let r = 0; r < rot; r++) { const t = a; a = c; c = -t; } return [a, c]; };
  const pts = new Array(12), cols = new Array(12), nrms = new Array(12), VN = lpVN(m);
  m.f.forEach((f, fi) => {
    const p = f.p.length === 3 ? [f.p[0], f.p[1], f.p[2], f.p[2]] : f.p, wp = p.map(([X, Y, Z]) => { const [a, c] = tf(X, Z); return [ox + a * P, oy + Y * P, oz + c * P]; });
    const n = lpNormal(f.p.map(([X, Y, Z]) => { const [a, c] = tf(X, Z); return [a, Y, c]; })), j = 1 + (hash2(fi * 7 + 3, m.f.length) * 2 - 1) * f.j, base = lpRGB(f.c);
    for (let k = 0; k < 4; k++) {
      const y = p[k][1], ao = f.ao ? .72 + .28 * Math.min(1, Math.max(0, y) / 14) : 1;   // contact shade: darker where it meets the ground
      for (let i = 0; i < 3; i++) { pts[k * 3 + i] = wp[k][i]; cols[k * 3 + i] = Math.max(0, Math.min(255, Math.round(base[i] * j * ao))); }
    }
    const vn = f.p.length === 3 ? [VN[fi][0], VN[fi][1], VN[fi][2], VN[fi][2]] : VN[fi];
    for (let k = 0; k < 4; k++) { const [a, c] = tf(vn[k][0], vn[k][2]); nrms[k * 3] = a; nrms[k * 3 + 1] = vn[k][1]; nrms[k * 3 + 2] = c; }
    Bd.quadC(pts, n[0], n[1], n[2], cols, f.g, nrms);
  });
}

/* ---- figures: the cat and the people as parts that move ---- */
// LP_FIGURES[key] = { parts: { name: { m: LPM (figure space, art px), pivot: [x, y, z], parent } }, pose(a, t) }
// pose returns per part { rx, ry, rz, x, y, z } (radians, art px) and may set root: { y, rx, rz, sy } for the whole body.
// One mesh per figure, its vertices moved on the CPU each frame (a few hundred): one draw call, real shadows.
function lpFigure(key, o) {
  const def = LP_FIGURES[key], names = Object.keys(def.parts), segs = [];
  let nv = 0; for (const k of names) { const m = def.parts[k].m; let n = 0; for (const f of m.f) n += f.p.length === 4 ? 6 : 3; segs.push({ k, from: nv, n }); nv += n; }
  const base = new Float32Array(nv * 3), bn = new Float32Array(nv * 3), col = new Uint8Array(nv * 4);
  let v = 0;
  for (const k of names) { const VN = lpVN(def.parts[k].m); for (const [fi, f] of def.parts[k].m.f.entries()) {
    const tris = f.p.length === 4 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 2]], n = lpNormal(f.p), j = 1 + (hash2(fi * 5 + 1, k.length) * 2 - 1) * f.j, c = lpRGB(f.c);
    for (const t of tris) for (const i of t) { base.set(f.p[i], v * 3); bn.set(VN[fi][i] || n, v * 3); col.set([...c.map((q) => Math.min(255, Math.round(q * j))), f.g ? 255 : 0], v * 4); v++; }
  } }
  const g = new THREE.BufferGeometry(), pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), lamp = new Uint8Array(nv);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 4, true)); g.setAttribute('aLamp', new THREE.BufferAttribute(lamp, 1, true));
  const mesh = new THREE.Mesh(g, matStatic); mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false; scene.add(mesh);
  const a = Object.assign({ x: 0, z: 0, fx: 0, fz: 1, step: 0, moving: false, anim: null, at: 0, fps: 10, lift: 0, blink: false, size: 1, face: 0 }, o || {});
  a.mesh = mesh;
  const M = {}, tmp = new THREE.Matrix4(), rot = new THREE.Matrix4(), e = new THREE.Euler(), V3 = new THREE.Vector3(), N3 = new THREE.Vector3(), root = new THREE.Matrix4(), nm = new THREE.Matrix3();
  a.pose = () => {
    const want = Math.atan2(a.fx, a.fz); let d = want - a.face; d = Math.atan2(Math.sin(d), Math.cos(d)); a.face += d * (a.anim ? 1 : .35);   // turn toward where it goes
    // (window.__still: the checks hold the idle motion, breathing and glancing, to compare frames)
    const t = window.__still ? 0 : typeof simTime !== 'undefined' ? simTime : performance.now() / 1000, P0 = def.pose(a, t) || {}, R = P0.root || {}, y = A.groundY(a.x, a.z) + a.lift;
    root.makeTranslation(a.x, y + (R.y || 0) * P, a.z).multiply(tmp.makeRotationY(a.face)).multiply(rot.makeRotationFromEuler(e.set(R.rx || 0, 0, R.rz || 0))).multiply(tmp.makeScale(P * a.size, P * a.size * (R.sy || 1), P * a.size));
    for (const k of names) {
      const part = def.parts[k], q = P0[k] || {}, pv = part.pivot || [0, 0, 0];
      const m = M[k] || (M[k] = new THREE.Matrix4());
      m.copy(part.parent ? M[part.parent] : root).multiply(tmp.makeTranslation(pv[0] + (q.x || 0), pv[1] + (q.y || 0), pv[2] + (q.z || 0))).multiply(rot.makeRotationFromEuler(e.set(q.rx || 0, q.ry || 0, q.rz || 0, 'YXZ'))).multiply(tmp.makeTranslation(-pv[0], -pv[1], -pv[2]));
    }
    for (const s of segs) {
      const m = M[s.k]; nm.getNormalMatrix(m);
      for (let i = s.from; i < s.from + s.n; i++) { V3.fromArray(base, i * 3).applyMatrix4(m).toArray(pos, i * 3); N3.fromArray(bn, i * 3).applyMatrix3(nm).normalize().toArray(nrm, i * 3); }
    }
    lamp.fill(Math.min(255, Math.round(A.lampLight(a.x, y + .6, a.z, 0, 1, 0) * 127.5)));
    g.attributes.position.needsUpdate = g.attributes.normal.needsUpdate = g.attributes.aLamp.needsUpdate = true;
    mesh.visible = !a.blink;
  };
  a.dispose = () => { scene.remove(mesh); g.dispose(); actors.splice(actors.indexOf(a), 1); };
  actors.push(a);
  return a;
}

// for the checks (tools/lp-check.mjs): pairs of faces of a model on one plane (same facing, within 0.05 px), different in
// colour, overlapping by more than a quarter of a square art px: they fight for the same pixels and flicker as the
// view moves. Returns [{ a, b, area, at }] with each face's colour and the overlap's middle
function lpCoplanar(m) {
  const F = m.f.map((f, i) => { const n = lpNormal(f.p), d = n[0] * f.p[0][0] + n[1] * f.p[0][1] + n[2] * f.p[0][2]; return { i, f, n, d }; });
  const ax = (n) => { const a = n.map(Math.abs); return a[0] >= a[1] && a[0] >= a[2] ? [1, 2] : a[1] >= a[2] ? [0, 2] : [0, 1]; };
  const buckets = new Map(); for (const q of F) { const k = q.n.map((v) => Math.round(v * 50)).join(',') + '|' + Math.round(q.d * 4); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(q); }
  // the area of the overlap of two convex polygons in 2D (Sutherland-Hodgman)
  const clip = (P, Q) => { let out = P; for (let i = 0; i < Q.length && out.length; i++) { const a = Q[i], b = Q[(i + 1) % Q.length], inside = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= -1e-9, inp = out; out = []; for (let j = 0; j < inp.length; j++) { const p = inp[j], q = inp[(j + 1) % inp.length], pi = inside(p), qi = inside(q); if (pi) out.push(p); if (pi !== qi) { const x1 = p[0], y1 = p[1], x2 = q[0], y2 = q[1], x3 = a[0], y3 = a[1], x4 = b[0], y4 = b[1], den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4); if (Math.abs(den) > 1e-12) { const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den; out.push([x1 + t * (x2 - x1), y1 + t * (y2 - y1)]); } } } } return out; };
  const area = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const ccw = (P) => (area(P) < 0 ? P.slice().reverse() : P);
  const out = [];
  for (const list of buckets.values()) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
    const A2 = list[x], B2 = list[y]; if (A2.f.c === B2.f.c || Math.abs(A2.d - B2.d) > .05 || A2.n[0] * B2.n[0] + A2.n[1] * B2.n[1] + A2.n[2] * B2.n[2] < .999) continue;
    const [u, v] = ax(A2.n), P = ccw(A2.f.p.map((p) => [p[u], p[v]])), Q = ccw(B2.f.p.map((p) => [p[u], p[v]])), I = clip(P, Q), s = Math.abs(area(I));
    if (s > .25) { const mid = I.reduce((m2, p) => [m2[0] + p[0] / I.length, m2[1] + p[1] / I.length], [0, 0]); out.push({ later: Math.max(A2.i, B2.i), n: B2.n, a: A2.f.c, b: B2.f.c, area: +s.toFixed(1), at: [u, v].map((k, i) => ['x', 'y', 'z'][k] + ' ' + mid[i].toFixed(1)).join(', ') + ', plane ' + A2.d.toFixed(1) }); }
  }
  return out;
}

// a model settled: of two faces fighting on one plane, the one added later (a door on a wall, a band on a body, a rail
// on a post) stands 0.2 art px out along its normal, and wins; again until none fight (three layers: twice)
function lpSettle(m) {
  for (let pass = 0; pass < 4; pass++) {
    const fights = lpCoplanar(m); if (!fights.length) break;
    const moved = new Set();
    for (const o of fights) { if (moved.has(o.later)) continue; moved.add(o.later); const f = m.f[o.later], n = lpNormal(f.p); f.p = f.p.map((q) => [q[0] + n[0] * .2, q[1] + n[1] * .2, q[2] + n[2] * .2]); }
    m.vn = null;
  }
  return m;
}

// ---- engine/30-render.js
/* ---------- render: renderer, lights, materials, post pass, camera, time of day (from the diorama kit) ---------- */
const canvas = $('gl');
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' }); } catch (e) { renderer = null; }
const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, .6); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1); sun.castShadow = settings.shadows;
const SHADOW_MAP = window.__shadowMap || (LP ? 2048 : 1024);   // lowpoly.html: finer, its picture is finer than an art pixel
//   // a texel about one art pixel: 2048 looked the same at 4 times the cost
sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP); sun.shadow.autoUpdate = false; sun.shadow.bias = -0.0004;
scene.add(sun); scene.add(sun.target);
if (renderer) { renderer.setPixelRatio(1); renderer.shadowMap.enabled = true; renderer.shadowMap.type = LP ? THREE.PCFSoftShadowMap : THREE.BasicShadowMap; renderer.info.autoReset = false; }

const nearest = (t) => { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t; };
let groundTex = null, heightTex = null, atlasTex = null, auxTex = null;   // ground: per area; atlas: once at boot
function makeAtlasTextures() {
  atlasTex = new THREE.DataTexture(atlasPx, AW2, AH, THREE.RGBAFormat, THREE.UnsignedByteType); atlasTex.encoding = THREE.sRGBEncoding; atlasFilter();
  auxTex = nearest(new THREE.DataTexture(auxPx, AW2, AH, THREE.RGBAFormat, THREE.UnsignedByteType)); auxTex.needsUpdate = true;
}

/* Materiale: colore per pixel, bagliore, e ombre lette al centro della cella da 1/16 (ombre a scalini sulla griglia) */
const uGlow = { value: 0 }, uLampCol = { value: new THREE.Vector3() }, diag = { flat: false, aa: window.__aa !== false }, allMats = [];
// things' and the ground's pixels sharp but smooth-edged ("sharp bilinear"): each texel is read whole, except within half a screen pixel
// of its border, where the filter blends the two. Slopes, curves and 45° views drew stair-stepped texel borders that
// crawled as the view turned; far away, where a texel is under a pixel, it is plain bilinear instead of a flicker.
// The cut-out (the layer test) still reads the exact texel, so outlines stay hard
const AA_MAP = '#ifdef USE_MAP\nvec2 vxT = vUv * uAtlas, vxS = floor(vxT + 0.5);\nvxT = vxS + clamp((vxT - vxS) / max(fwidth(vxT), vec2(1e-4)), -0.5, 0.5);\nvec4 texelColor = mapTexelToLinear(texture2D(map, vxT / uAtlas));\ndiffuseColor *= texelColor;\n#endif\n';
const aaFilter = (t) => { if (!t) return t; t.magFilter = t.minFilter = diag.aa ? THREE.LinearFilter : THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; };
function atlasFilter() { aaFilter(atlasTex); }
function setAA(on) { diag.aa = !!on; atlasFilter(); for (const m of allMats) { if (m.userData.aa) aaFilter(m.map); m.needsUpdate = true; } }
const LIGHTS = THREE.ShaderChunk.lights_fragment_begin.split('vDirectionalShadowCoord[ i ]').join('vxShadowCoord');
// layer CUT (300): discard the pixels the art left empty (aux r is 0 there); other layers: the old depth-layer test
const LAYER_TEST = 'vec4 vxA = texture2D(uAux, vUv); if (vLayer > 499.5) { if (abs(vxA.a * 255.0 - (754.0 - vLayer)) > 0.5) discard; } else if (vLayer > 399.5) { if (vxA.a < 0.5 / 255.0) discard; } else if (vLayer > 299.5) { if (vxA.r < 0.5 / 255.0) discard; } else if (abs(vLayer) > 0.5 && abs((vLayer < 0.0 ? vxA.g : vxA.r) * 255.0 - abs(vLayer)) > 0.5) discard;';
// 'card': the 2D style's cards (engine/34-bake.js), a slab whose texture is the pictures: cut out where their alpha is
// low, lit at night where it is 200 (a window)
const CARD_TEST = 'vec4 vxT = texture2D(map, vUv); if (vxT.a < 0.4) discard; vec4 vxA = vec4(0.0, 0.0, vxT.a < 0.9 ? 1.0 : 0.0, 0.0);';
function voxelMaterial(kind, o) {
  const ground = kind === 'ground', sprite = kind === 'sprite', card = kind === 'card', slab = kind === 'slab' || card;
  const m = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0x000000, shininess: 0, map: ground ? groundTex : sprite ? o.map : card ? cardTexture() : slab ? atlasTex : null, alphaTest: sprite ? .5 : 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uShadowMat = { value: sun.shadow.matrix };
    sh.uniforms.uGlow = uGlow;
    sh.uniforms.uLampCol = uLampCol;
    if (ground) sh.uniforms.uHeightTex = { value: heightTex };
    if (slab) sh.uniforms.uAux = { value: auxTex };
    if (slab || ground) { const im = m.map.image; sh.uniforms.uAtlas = { value: new THREE.Vector2(im.width, im.height) }; }
    if (sprite) { sh.uniforms.uProbe = { value: o.probe }; sh.uniforms.uRow = { value: o.row }; sh.uniforms.uLampL = o.lampL; }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;\n' + (ground || sprite ? '' : slab ? 'attribute float aLayer; varying float vLayer; attribute float aLamp; varying float vLamp;' : 'attribute vec4 aCol; varying vec4 vCol; attribute float aLamp; varying float vLamp;'))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * normal);\n' + (ground || sprite ? '' : slab ? 'vLayer = aLayer; vLamp = aLamp;' : 'vCol = aCol; vLamp = aLamp;'));
    let f = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm; uniform mat4 uShadowMat; uniform float uGlow; uniform vec3 uLampCol;\n' + (ground ? 'uniform sampler2D uHeightTex; uniform vec2 uAtlas;' : sprite ? 'uniform vec3 uProbe; uniform vec2 uRow; uniform float uLampL;' : slab ? 'uniform sampler2D uAux; uniform vec2 uAtlas; varying float vLayer; varying float vLamp;' : 'varying vec4 vCol; varying float vLamp;'));
    f = f.replace('void main() {', 'void main() {\n' + (ground ? 'float vxLamp = texture2D(uHeightTex, vUv).a * 2.0;' : sprite ? 'float vxLamp = uLampL;' : slab ? (card ? CARD_TEST : LAYER_TEST) + ' float vxLamp = vLamp * 2.0;' : 'float vxLamp = vLamp * 2.0;'));
    // a solid surface is opaque even where its texel is not: the post pass shows the sky through any alpha below 1
    if (slab) f = f.replace('#include <map_fragment>', (diag.aa && !card ? AA_MAP : '#include <map_fragment>') + '\ndiffuseColor.a = 1.0;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vxA.b * uGlow * 1.5;');
    else if (ground) f = f.replace('#include <map_fragment>', diag.aa ? AA_MAP : '#include <map_fragment>').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * texture2D(uHeightTex, vUv).r * uGlow * 1.6;');
    else if (!ground && !sprite) f = f.replace('#include <color_fragment>', '#include <color_fragment>\nvec3 vxBase = pow(vCol.rgb, vec3(2.2)); diffuseColor.rgb *= vxBase;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vxBase * vCol.a * uGlow * 1.5;');
    // things (slab) cast shadows on the ground but receive none: their shadow lookup falls outside the map, which reads
    // as lit (self-shadowing drew streaks on walls: the awning's hem, the chimney on the roof)
    const coord = slab ? 'vec4 vxShadowCoord = vec4(-1.0, -1.0, 0.5, 1.0);\n' : sprite
      ? 'vec4 vxShadowCoord = uShadowMat * vec4(uProbe.x, uProbe.y + (floor((vWPos.y - uProbe.y) / uRow.x) + 0.5) * uRow.y, uProbe.z, 1.0);\n'
      : 'vec3 vxP = vWPos + normalize(vWNrm) * 0.03125;\nvec4 vxShadowCoord = uShadowMat * vec4((floor(vxP * 16.0) + 0.5) * 0.0625, 1.0);\n';
    sh.fragmentShader = diag.flat
      ? f.replace('#include <lights_fragment_begin>', '').replace('#include <lights_fragment_maps>', '').replace('#include <lights_fragment_end>', '').replace(/vec3 outgoingLight = [^;]+;/, 'vec3 outgoingLight = diffuseColor.rgb * 0.8 + totalEmissiveRadiance;')
      : f.replace('#include <lights_fragment_begin>', coord + LIGHTS).replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directDiffuse += material.diffuseColor * uLampCol * vxLamp;');
  };
  if ((slab && !card) || ground) { m.extensions = { derivatives: true }; m.userData.aa = true; }   // fwidth, for AA_MAP (WebGL1: OES_standard_derivatives)
  m.customProgramCacheKey = () => 'vx-' + kind + (diag.flat ? '-flat' : '') + (m.userData.aa && diag.aa ? '-aa' : '');
  allMats.push(m);
  return m;
}
let matStatic = null, matSlab = null, slabDepth = null, matCard = null, cardDepth = null;
function makeMaterials() {
  matStatic = voxelMaterial('static'); matSlab = voxelMaterial('slab'); matCard = voxelMaterial('card');
  cardDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: cardTexture(), alphaTest: .5 });
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
if (LP) rt.texture.minFilter = rt.texture.magFilter = THREE.NearestFilter;   // lowpoly.html: hard pixels
const postU = { tColor: { value: rt.texture }, uTexel: { value: new THREE.Vector2() }, uShift: { value: new THREE.Vector2() }, uK: { value: 0 }, uSpread: { value: 1 }, uAspect: { value: 1 }, uTime: { value: 0 }, uStars: { value: 0 }, uAur: { value: 0 }, uAurT: { value: 0 }, uBgTop: { value: new THREE.Vector3() }, uBgBot: { value: new THREE.Vector3() } };
const postMat = new THREE.ShaderMaterial({
  uniforms: postU, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    precision highp float;
    uniform sampler2D tColor; uniform vec2 uTexel, uShift; uniform float uK, uSpread, uAspect, uTime, uStars, uAur, uAurT;
    uniform vec3 uBgTop, uBgBot; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec4 tap(vec2 o){ vec4 s = texture2D(tColor, vUv - uShift + o * uSpread * uTexel); vec3 c = s.a > 0.001 ? min(s.rgb / s.a, vec3(1.0)) : vec3(0.0); return vec4(c * c * s.a, s.a); }
    void main(){
      // (lowpoly.html, uK > 0: each screen pixel reads the picture's pixel it lies in, counted in whole screen pixels from
      // the corner, so the enlargement is exact even when the screen is not a whole number of picture pixels across)
      vec4 acc;
      if (uK > 0.0) { vec2 sp = floor(gl_FragCoord.xy - uShift / uTexel * uK); vec4 s = texture2D(tColor, (floor(sp / uK) + 0.5) * uTexel); vec3 c = s.a > 0.001 ? min(s.rgb / s.a, vec3(1.0)) : vec3(0.0); acc = vec4(c * c * s.a, s.a); }
      else acc = (tap(vec2(0.0)) * 2.0 + tap(vec2(0.375, 0.125)) + tap(vec2(-0.125, 0.375)) + tap(vec2(-0.375, -0.125)) + tap(vec2(0.125, -0.375))) / 6.0;
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
  const ce = Math.cos(cur.el); sun.position.set(A.sunX + Math.sin(cur.az) * ce * 48, (A.sunY || 0) + Math.sin(cur.el) * 48, A.sunZ + Math.cos(cur.az) * ce * 48);
  hemi.color.setRGB(cur.sky[0], cur.sky[1], cur.sky[2]); hemi.groundColor.setRGB(cur.gnd[0], cur.gnd[1], cur.gnd[2]); hemi.intensity = cur.hemiI;
  uGlow.value = cur.glow;
  uLampCol.value.set(cur.lamp, cur.lamp * .663, cur.lamp * .353);
  for (const h of lamps) h.material.opacity = Math.min(1, cur.lamp * .3);
}

/* ---------- camera: orthographic, pitched, follows the player inside the current area ---------- */
const CD = 60, cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 140), camT = new THREE.Vector3();
let yaw = 0, yawT = 0, Vz = 15, VT = 15, aspect = 1;
const minV = () => 13 / aspect;   // a phone held upright still sees 13 units across
// the view's height as drawn. lowpoly.html rounds it so one art pixel is a whole number of pixels of the picture (a
// texel's edge then falls on the same pixel wherever the camera stands, and the ground does not crawl as the cat walks):
// up to half again the asked height when zoomed out. The follow, the map-edge clamp and the streaming use this one,
// or the view showed the sky past the map's edge and through chunks never built
const viewV = (v) => (LP && rt.height > 2 ? rt.height / (PPU * Math.max(1, Math.round(rt.height / (PPU * v)))) : v);
function camGoal(vv) {
  vv = viewV(vv);
  if (A.W > 48 || A.D > 40) {   // the open world: follow the cat, but never show past the map's edge
    const k = aspect < .8 ? vv * .12 : 0;   // upright phones: the cat sits above the thumbs
    const x = player.x + Math.sin(yaw) * k, z = player.z - (A.camNorth || 1.5) + Math.cos(yaw) * k;
    const hz = vv / Math.sin(PITCH) / 2, hx = vv * aspect / 2, c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw)), ex = hx * c + hz * sn, ez = hz * c + hx * sn;
    return [clamp(x, Math.min(ex, A.W / 2), Math.max(A.W - ex, A.W / 2)), clamp(z, Math.min(ez, A.D / 2), Math.max(A.D - ez, A.D / 2))];
  }
  const W = A.W, D = A.D, f = clamp(1.45 - vv / 26, .4, .9); return [W / 2 + (player.x - W / 2) * f, D / 2 - (A.camNorth || 1.5) + (player.z - D / 2) * f * .6]; }
// the ground the view covers, as a box in world x/z: [x0, z0, x1, z1]. In view terms it grows by side units left and
// right, far units away from the camera and near units toward it (a tall tree standing below the view's bottom edge
// still reaches into it: a 7-unit tree up to 10 units out). The box is taken at the height the camera aims at (the cat's
// ground, halved); ground lower than that, down to 0, shows farther away at the view's top edge: far grows by the drop
// over the pitch's tangent, or a chunk just past the top edge stayed unbuilt and the sky showed through
function viewFoot(side, far, near) {
  far += Math.max(0, camT.y) / Math.tan(PITCH);
  const vv = viewV(Math.max(Vz, VT, minV())), hz = vv / Math.sin(PITCH) / 2, hx = vv * aspect / 2;
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), tx = Math.sin(yaw), tz = Math.cos(yaw);   // screen right; toward the camera
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const a of [-(hx + side), hx + side]) for (const b of [-(hz + far), hz + near]) {
    const x = camT.x + rx * a + tx * b, z = camT.z + rz * a + tz * b; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  }
  return [x0, z0, x1, z1];
}
// does the ground box [x0, z0, x1, z1] meet the view's footprint (turned with the view, grown as in viewFoot)?
// Measured in view terms (across the screen, toward the camera): on a diagonal view the box around the footprint
// takes in a third more ground than the view shows
function inView(box, side, far, near) {
  far += Math.max(0, camT.y) / Math.tan(PITCH);   // lower ground shows farther away, as in viewFoot
  const vv = viewV(Math.max(Vz, VT, minV())), hz = vv / Math.sin(PITCH) / 2, hx = vv * aspect / 2;
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), tx = Math.sin(yaw), tz = Math.cos(yaw);
  let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
  for (const x of [box[0], box[2]]) for (const z of [box[1], box[3]]) { const dx = x - camT.x, dz = z - camT.z, a = dx * rx + dz * rz, b = dx * tx + dz * tz; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
  return a1 >= -(hx + side) && a0 <= hx + side && b1 >= -(hz + far) && b0 <= hz + near;
}
// wireframe (an option): the triangle edges of every 3D thing drawn over it, also those whose pixels the material
// discards, since they cost the same. Applied to meshes as they are built (chunks, chests) and when the option changes
const wireMat = new THREE.MeshBasicMaterial({ color: 0xffe14a, wireframe: true, transparent: true, opacity: .85 });
function applyWire() {
  scene.traverse((m) => {
    if (!m.isMesh || m.material !== matSlab) return;
    if (!m.userData.wireOn && settings.wire) { const w = new THREE.Mesh(m.geometry, wireMat); m.add(w); m.userData.wireOn = w; }
    if (m.userData.wireOn) m.userData.wireOn.visible = settings.wire;
  });
}
const _camS = new THREE.Vector3();
function setCamera() {
  const cp = Math.cos(PITCH), spn = Math.sin(PITCH);
  const v = viewV(Math.max(Vz, minV()));
  // the camera moves by whole pixels of the render target: moving by a fraction of a pixel, thin lines (shadow edges,
  // window bars) fell on one pixel in a frame and on its neighbour in the next, and shimmered while walking
  const px = v / Math.max(1, rt.height), sy = Math.sin(yaw), cy = Math.cos(yaw);
  const X = [cy, 0, -sy], U = [-spn * sy, cp, -spn * cy];                   // the camera's right and up, in the world
  const a = camT.x * X[0] + camT.z * X[2], b = camT.x * U[0] + camT.y * U[1] + camT.z * U[2];
  const da = Math.round(a / px) * px - a, db = Math.round(b / px) * px - b;
  _camS.set(camT.x + da * X[0] + db * U[0], camT.y + db * U[1], camT.z + da * X[2] + db * U[2]);
  // drawn at half the screen (a 2x screen), a whole pixel of the scene is two of the screen: the post pass moves the
  // picture back by the snap's remainder in whole screen pixels, so it walks in steps of one screen pixel, not two
  const k = Math.max(1, Math.round(bh / Math.max(1, rt.height)));
  postU.uShift.value.set(Math.round(da / px * k) / k / Math.max(1, rt.width), Math.round(db / px * k) / k / Math.max(1, rt.height));
  cam.position.set(_camS.x + sy * cp * CD, _camS.y + spn * CD, _camS.z + cy * cp * CD); cam.lookAt(_camS);
  cam.top = v / 2; cam.bottom = -v / 2; cam.right = v / 2 * aspect; cam.left = -cam.right; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
}

let quality = 1, bw = 0, bh = 0;
function resize() {
  if (!renderer) return;
  const r = canvas.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * quality; bw = Math.max(2, Math.round(r.width * dpr)); bh = Math.max(2, Math.round(r.height * dpr));
  // the scene is drawn at the screen's resolution divided by a whole number (1, or 2 on a 2x screen) and enlarged by
  // exactly that number: at 1.25 or 0.75 the pixel pattern crawled while the camera moved, even by whole pixels
  // (lowpoly.html: about 600 rows, two or three picture pixels to an art pixel at the usual view, every one a block of
  // whole screen pixels)
  const ss = window.__ss || (LP ? 1 / Math.max(1, Math.round(bh / 600)) : 1 / Math.max(1, Math.floor(dpr + .01))); renderer.setSize(bw, bh, false); rt.setSize(Math.max(2, Math.round(bw * ss)), Math.max(2, Math.round(bh * ss)));
  aspect = r.width / r.height; postU.uTexel.value.set(1 / rt.width, 1 / rt.height); postU.uAspect.value = aspect; postU.uSpread.value = LP ? 0 : Math.max(ss, .75); postU.uK.value = LP ? Math.round(1 / ss) : 0;
}

// ---- engine/34-bake.js
/* ---------- the 2D style's pictures: each thing's own drawing, and the roof the camera sees above it ---------- */
// The 2D style (settings.flat) draws each thing as one card facing the fixed camera, the card showing the thing's front
// drawing pixel for pixel, as drawn. A drawing made for the 3D is a straight elevation: from the game's camera a roof
// shows much more than its edge. So a building also gets, above its drawing, the rest of its roof as the camera sees it,
// drawn in pixels: how far it rises over each column comes from the drawing and the side view (the depth the camera
// sees climbs tan(pitch) rows per pixel back), its tiles from the building's own roof tiles (the 3D roofs' texture),
// copied one for one, outlined. A building drawn in code (the bakery) gets its gable roof from its own roof data, and
// its chimney moves up by how far back it stands. Lit windows keep their glow (alpha 200 marks them).
// The card stands where the thing's front does (a crossed thing's through its trunk), so the cat walks in front of it and
// behind it as in 3D. The pictures share one texture, packed in rows.
const CARD_W = 1024, CARD_H = 1024, cardPx = new Uint8Array(CARD_W * CARD_H * 4), cardPics = new Map(), cardShelf = { x: 0, y: 0, h: 0 };
let cardTex = null, cardDirty = false;
// the 2D style's shadow casters: the 3D models, drawn into the shadow map only
const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
const cardTexture = () => { if (!cardTex) { cardTex = nearest(new THREE.DataTexture(cardPx, CARD_W, CARD_H, THREE.RGBAFormat, THREE.UnsignedByteType)); cardTex.encoding = THREE.sRGBEncoding; } return cardTex; };

const lumOf = (c) => (c >> 16 & 255) * .3 + (c >> 8 & 255) * .59 + (c & 255) * .11;
const modp = (a, n) => ((Math.floor(a) % n) + n) % n;
const tileAt = (s, u, v) => { const T = AP.sprites[s.key].tiles; if (!T) return 0x9a4a30; const k = ((T[1] + modp(v, T[3])) * AW2 + T[0] + modp(u, T[2])) * 4; return atlasPx[k] << 16 | atlasPx[k + 1] << 8 | atlasPx[k + 2]; };
const nearCol = (a, b) => Math.abs((a >> 16 & 255) - (b >> 16 & 255)) + Math.abs((a >> 8 & 255) - (b >> 8 & 255)) + Math.abs((a & 255) - (b & 255)) < 110;

// the picture: { w, h, x0 (its left column from the anchor), px: RGBA rows from the ground up }
function cardPicture(s, rot, lid) {
  // a building shaped from a spec (engine/24-shapes.js) shows the sheet's drawing it was shaped from
  const pic = s.pic.source || s.pic, sheet = s.pic.sourceSheet || s.sheet, coded = s.pixel && !s.pic.source;
  const side = rot % 2 && pic.side ? pic.side : null, W = side ? side.w : s.w, H0 = s.h;
  const src = side ? side.c : pic.c, ghost = (i) => !side && coded && (s.fl[i] & F_GHOST);
  const t = Math.tan(PITCH), cols = [];   // cols[x][y]: [colour, glow], y from the ground up
  let H = H0; const put = (x, y, c, g) => { if (x < 0 || x >= W || y < 0) return; const col = cols[x] || (cols[x] = []); col[y] = [c, g]; H = Math.max(H, y + 1); };
  const at = (x, y) => (x >= 0 && x < W && cols[x] && cols[x][y]) || null;
  // the drawing as drawn (a ghost pixel of a building drawn in code belongs to a smooth part: placed below)
  // (a building shaped from a spec: a body set back stands higher by how far back it is, so the card agrees with the 3D)
  const lift = (i) => !side && s.pic.ownZ && !isNaN(s.pic.ownZ[i]) ? Math.max(0, Math.round((s.pic.front - s.pic.ownZ[i]) * t)) : 0;
  for (let r = 0; r < H0; r++) for (let x = 0; x < W; x++) { const i = r * W + x, c = src[i]; if (c >= 0 && !ghost(i)) put(side && rot === 3 ? W - 1 - x : x, H0 - 1 - r + lift(i), c, !side && s.glow[i]); }
  const top = (x) => { const col = cols[x] || []; for (let y = col.length - 1; y >= 0; y--) if (col[y]) return y + 1; return 0; };
  let outline = 0x2a1d18, ol = 1e9; for (const col of cols) for (const p of col || []) if (p && lumOf(p[0]) < ol) { ol = lumOf(p[0]); outline = p[0]; }
  const roof = [];   // [x, y]: the pixels added for the roof, outlined at the end
  if (!side && s.pic.source && (s.pic.hroofs || s.pic.cones)) {
    // a building shaped from a spec: over each column, the highest its roofs reach on the card, a point z back from the
    // card's plane standing (front - z) tan(pitch) rows higher; tiles from the drawing's roof line up to there
    const zc = s.pic.front, hTop = new Float32Array(W).fill(-1);
    const roofY = (R, x, z) => {
      if (x < R.x0 || x > R.x1 || z < R.z0 || z > R.z1) return -1;
      const alongX = (R.ridge || 'x') === 'x', a = alongX ? x : z, b = alongX ? z : x, [a0, a1] = alongX ? [R.x0, R.x1] : [R.z0, R.z1], [b0, b1] = alongX ? [R.z0, R.z1] : [R.x0, R.x1];
      const rise = R.yR - R.yE;
      if (R.shed) { const inZ = R.shed[0] === 'z', v = inZ ? z : x, [v0, v1] = inZ ? [R.z0, R.z1] : [R.x0, R.x1], f = (v - v0) / (v1 - v0); return R.yE + rise * (R.shed[1] === '1' ? f : 1 - f); }
      const half = (b1 - b0) / 2, db = 1 - Math.abs(b - (b0 + b1) / 2) / half, hs = (R.hip || 0) * half, da = hs > 0 ? Math.min(1, Math.min(a - a0, a1 - a) / hs) : 1;
      return R.yE + rise * Math.max(0, Math.min(db, da));
    };
    for (let x = 0; x < W; x++) {
      let best = -1;
      for (const R of s.pic.hroofs || []) for (let z = R.z0; z <= R.z1; z += .5) { const y = roofY(R, x + .5, z); if (y >= 0) best = Math.max(best, y + (zc - z) * t); }
      for (const C of s.pic.cones || []) for (let z = C.cz - C.r; z <= C.cz + C.r; z += .5) { const d = Math.hypot(x + .5 - C.cx, z - C.cz); if (d <= C.r) best = Math.max(best, C.yE + (C.yR - C.yE) * (1 - d / C.r) + (zc - z) * t); }
      hTop[x] = best;
    }
    for (let x = 0; x < W; x++) { const from = top(x), to = Math.round(hTop[x]); for (let y = from; y < to; y++) { put(x, y, tileAt(s, x, to - y), 0); roof.push([x, y]); } }
  } else if (!side && pic.side && sheet && sheet.startsWith('buildings')) {
    // a building from the sheets: front and side seen together from the camera, above the drawing, over the columns
    // whose top is roof (a hanging sign or a lamp beside the walls gets nothing)
    const sd = pic.side, D = sd.w, hS = [], hF = [], base = roofColour(pic, s.key);
    for (let z = 0; z < D; z++) { let r = 0; while (r < sd.h && sd.c[r * D + z] < 0) r++; hS[z] = sd.h - r; }
    for (let x = 0; x < W; x++) {
      const h = top(x); let isRoof = false;
      for (let y = h - 1, n = 0; y >= 0 && n < 8; y--) { const p = at(x, y); if (!p) continue; n++; if (lumOf(p[0]) >= 42 && nearCol(p[0], base)) { isRoof = true; break; } }
      hF[x] = isRoof ? h : 0;
    }
    // one roof from its first column to its last: a chimney or a dark edge in between is still roof behind
    const roofCols = hF.map((h, x) => h ? x : -1).filter((x) => x >= 0);
    if (roofCols.length) for (let x = roofCols[0]; x <= roofCols[roofCols.length - 1]; x++) if (!hF[x]) hF[x] = top(x);
    const span = (a) => { const v = a.filter((q) => q > 0); return v.length ? Math.max(...v) - Math.min(...v) : 0; }, frontGable = span(hF) > span(hS);
    let ridge = 0; for (let x = 0; x < W; x++) if (hF[x] > hF[ridge]) ridge = x;
    for (let x = 0; x < W; x++) {
      if (!hF[x]) continue; let R = hF[x];
      for (let z = 0; z < D; z++) R = Math.max(R, Math.min(hF[x], hS[z]) + z * t);
      const E = Math.round(R - hF[x]);
      for (let k = 0; k < E; k++) {
        const c = tileAt(s, x, k);   // courses across, as a 2D roof is drawn
        put(x, hF[x] + k, frontGable && x > ridge ? shade(c, .84) : c, 0); roof.push([x, hF[x] + k]);
      }
    }
  } else if (!side && coded && pic.roofs) {
    // a building drawn in code: its gable roofs from their own data, the fascia under them, then its ghosts moved up
    for (const R of pic.roofs) {
      const run = R.cx - R.xl, E = Math.round((R.zf - R.zb) * t), len = Math.hypot(run, R.yR - R.yE);
      for (let x = Math.ceil(R.xl); x < R.xr; x++) {
        const d = Math.abs(x + .5 - R.cx), y0 = Math.round(R.yE + (R.yR - R.yE) * (1 - d / run) + 1), slope = Math.round((run - d) * len / run);
        for (let y = y0 - R.t; y < y0; y++) if (!at(x, y)) put(x, y, shade(tileAt(s, 0, 3), .8), 0);   // the fascia: the tiles' joint colour
        for (let k = 0; k < E; k++) { const c = tileAt(s, x, y0 + k); put(x, y0 + k, x + .5 > R.cx ? shade(c, .84) : c, 0); roof.push([x, y0 + k]); }   // courses across, as a 2D roof is drawn
      }
    }
    // the ghosts (the chimney, the sign): a pixel z back from the card's plane stands z tan(pitch) rows higher
    const zc = cardPlane(s, 0) / P;
    const moved = [];
    for (let r = 0; r < H0; r++) for (let x = 0; x < W; x++) { const i = r * W + x; if (src[i] < 0 || !ghost(i)) continue; const y = H0 - 1 - r + Math.max(0, Math.round((zc - s.zf[i]) * t)); put(x, y, src[i], 0); moved.push([x, y, y !== H0 - 1 - r]); }
    // a part moved up onto the roof gets an outline of its own, so it reads against the tiles
    const mv = new Set(moved.map(([x, y]) => x + ',' + y));
    for (const [x, y, up] of moved) if (up) for (const [a, b] of [[x - 1, y], [x + 1, y], [x, y + 1]]) if (!mv.has(a + ',' + b) && at(a, b)) put(a, b, 0x2a1d18, 0);
  }
  // the roof's outline: a roof pixel with nothing above it or beside it
  const edge = roof.filter(([x, y]) => !at(x, y + 1) || !at(x - 1, y) || !at(x + 1, y));
  for (const [x, y] of edge) put(x, y, outline, 0);
  // an open chest: its lid stands up behind the body, inside out (the lid's rows mirrored, darker), the body's top dark
  if (lid && !side) {
    const seam = H0 - CHEST.seam;
    for (let x = 0; x < W; x++) {
      const col = cols[x] || [], lidRows = col.slice(seam, H0); for (let y = seam; y < col.length; y++) col[y] = undefined;
      for (let k = 0; k < lidRows.length; k++) if (lidRows[k]) put(x, seam + 1 + (lidRows.length - 1 - k), shade(lidRows[k][0], .62), 0);
      for (let y = seam - 2; y < seam; y++) if (col[y]) col[y] = [shade(col[y][0], .4), 0];
    }
  }
  const x0 = side ? -Math.floor(W / 2) : -s.px, px = new Uint8Array(W * H * 4);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { const p = at(x, y); if (!p) continue; const k = (y * W + x) * 4; px[k] = p[0] >> 16 & 255; px[k + 1] = p[0] >> 8 & 255; px[k + 2] = p[0] & 255; px[k + 3] = p[1] ? 200 : 255; }
  return { w: W, h: H, x0, px };
}
// where the card stands, from the anchor: a crossed thing through its trunk; one drawn in code at its wall (its most
// common front depth); else the front of its footprint, as turned
function cardPlane(s, rot) {
  if (BUILD[s.key] === 'cross') return 0;
  if (s.pic.front !== undefined) return s.pic.front * P;   // a building shaped from a spec: its front wall
  if (s.pixel) { const n = new Map(); s.each((x, y, i) => { if (!(s.fl[i] & F_GHOST)) n.set(s.zf[i], (n.get(s.zf[i]) || 0) + 1); }); return [...n].sort((a, b) => b[1] - a[1])[0][0] * P; }
  return (rot % 2 ? (rot === 1 ? s.px : s.w - s.px) : s.depth / 2) * P;
}

// the card of thing s turned by rot quarter turns (a chest: lid open or not), as quads for putLow; null when the shared
// texture is full (then the thing is left out, and said so once)
function cardFor(s, rot, lid) {
  rot = ((rot || 0) % 4 + 4) % 4;
  const id = s.key + '|' + rot + '|' + (lid ? 1 : 0); if (cardPics.has(id)) return cardPics.get(id);
  const pc = cardPicture(s, rot, lid), W = pc.w, H = pc.h;
  if (cardShelf.x + W > CARD_W) { cardShelf.x = 0; cardShelf.y += cardShelf.h; cardShelf.h = 0; }
  if (W > CARD_W || cardShelf.y + H > CARD_H) { cardPics.set(id, null); console.warn('2D style: no room left for the picture of ' + s.key); return null; }
  const ax = cardShelf.x, ay = cardShelf.y; cardShelf.x += W; cardShelf.h = Math.max(cardShelf.h, H);
  for (let y = 0; y < H; y++) cardPx.set(pc.px.subarray(y * W * 4, (y + 1) * W * 4), ((ay + y) * CARD_W + ax) * 4);
  cardDirty = true;
  const zz = cardPlane(s, rot) / P, u = (c) => c / CARD_W, v = (r) => r / CARD_H, X0 = pc.x0;
  const card = [{ p: [[X0, 0, zz], [X0 + W, 0, zz], [X0 + W, H, zz], [X0, H, zz]], n: [0, 0, 1], uv: [u(ax), v(ay), u(ax + W), v(ay), u(ax + W), v(ay + H), u(ax), v(ay + H)], layer: 0 }];
  cardPics.set(id, card);
  return card;
}
// for the checks (tools/flat-check.mjs): how many rows tall thing s's 3D model stands on screen at the fixed view, in
// the card's rows (one art row at the card's plane)
function modelRows(s, rot) {
  const prevS = S, prevB = B; S = new SlabBuilder(256); B = new Builder(256);
  if (BUILD[s.key] === 'cross') putLow(flatOf(s), 0, 0, { y: 0 }); else { if (s.pixel) put(s, 0, 0, { rot, y: 0 }); if (s.low.length) putLow(s.low, 0, 0, { rot, y: 0 }); }
  const pos = S.pos.a, n = S.pos.n, cp = Math.cos(PITCH), sn = Math.sin(PITCH); S = prevS; B = prevB;
  let u0 = 1e9, u1 = -1e9; for (let i = 0; i < n; i += 3) { const u = pos[i + 1] * cp - pos[i + 2] * sn; u0 = Math.min(u0, u); u1 = Math.max(u1, u); }
  return n ? (u1 - u0) / (P * cp) : 0;
}
// after a batch of pictures: send the texture once
function cardUpload() { if (cardDirty && cardTex) { cardTex.needsUpdate = true; cardDirty = false; } }

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
  const wallCol = (t, a, y) => { const g = GT[t]; if (g.cliff) return edgeCol(t, a, y, g.h); const c = g.wall !== undefined ? g.wall : shade(avg(g), .62); if (LP) return LP_WALL ? LP_WALL(c, a, y) : Math.floor(y / 6) % 2 ? c : shade(c, .94); return (Math.floor(y / 4) + Math.floor(a / 8)) % 2 ? c : shade(c, .9); };
  const STRATA = [0x6b4a32, 0x5e4230, 0x6f5238, 0x52392a];
  const LP_STRATA = [0x8a6a4a, 0x7a5c40, 0x93745a, 0x6e5240];   // lowpoly.html: level strata, wide, a grass lip
  const edgeCol = (t, k, y, top) => LP ? (top - y <= 3 ? shade(avg(GT[t]), .78) : LP_STRATA[Math.floor((top - y + 6) / 11) % LP_STRATA.length]) : top - y <= 2 ? shade(avg(GT[t]), .8) : STRATA[Math.floor((top - y + (k % 7)) / 7) % STRATA.length];
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
    // things whose foot stands in this chunk (chests are not baked: they are props, see propMesh). In the 2D style a thing
    // is its card, and its 3D model is built as well, drawn only into the shadow map: the ground keeps the 3D's shadows
    let shadowS = null;
    for (const th of things) { const px = th.x * PPU, pz = th.z * PPU; if (th.o.chest || px < x0 || px >= x0 + w || pz < z0 || pz >= z0 + h) continue; const o = Object.assign({}, th.o); if (o.y === undefined) o.y = groundY(th.x, th.z) + (o.dy || 0); if (LP && lpModel(th.s.key)) { lpPut(B, lpModel(th.s.key), th.x, th.z, o); continue; } if (settings.flat) { const c = cardFor(th.s, o.rot); if (c) putLow(c, th.x, th.z, Object.assign({}, o, { rot: 0 })); const keep = S; S = shadowS = shadowS || new SlabBuilder(256); if (th.s.pixel) put(th.s, th.x, th.z, o); if (th.s.low.length) putLow(th.s.low, th.x, th.z, o); S = keep; continue; } if (th.s.pixel) put(th.s, th.x, th.z, o); if (th.s.low.length) putLow(th.s.low, th.x, th.z, o); }
    cardUpload();
    // baked light, meshes
    B.bakeLamps(chunkLight); S.bakeLamps(chunkLight);
    const gPack = new Uint8Array(w * h * 2);
    if (near.length) for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) gPack[(z * w + x) * 2 + 1] = Math.min(255, Math.round(chunkLight((x0 + x + .5) * P, hPx(x0 + x, z0 + z) * P, (z0 + z + .5) * P, 0, 1, 0) * 127.5));
    const gTex = aaFilter(new THREE.CanvasTexture(gCan)); gTex.flipY = false; gTex.encoding = THREE.sRGBEncoding;
    const hTex = nearest(new THREE.DataTexture(gPack, w, h, THREE.LuminanceAlphaFormat, THREE.UnsignedByteType)); hTex.unpackAlignment = 1; hTex.needsUpdate = true;
    groundTex = gTex; heightTex = hTex; const matGround = voxelMaterial('ground');
    // chunks are culled against the view (one kept off screen costs nothing); the bounds are padded a little
    const cull = (m) => { const g = m.geometry; if (!g.attributes.position || !g.attributes.position.count) { m.visible = false; return m; } g.computeBoundingSphere(); g.boundingSphere.radius += 1; return m; };
    const staticMesh = cull(new THREE.Mesh(B.geometry(), matStatic)); staticMesh.castShadow = staticMesh.receiveShadow = true; group.add(staticMesh);
    const slabMesh = cull(new THREE.Mesh(S.geometry(), settings.flat ? matCard : matSlab)); slabMesh.castShadow = !settings.flat; slabMesh.receiveShadow = true; slabMesh.customDepthMaterial = settings.flat ? cardDepth : slabDepth; group.add(slabMesh);
    if (shadowS) { const m = cull(new THREE.Mesh(shadowS.geometry(), shadowOnly)); m.castShadow = true; m.customDepthMaterial = slabDepth; group.add(m); }
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
    if (built) { sync(); if (settings.wire) applyWire(); }
  };
  let waterT = 0, waterTick = 0, sunX = -1e9, sunZ = -1e9;
  area.update = (dt, x, z) => {
    area.stream(x, z, false);
    if (def.keep) {   // all built: draw (and shadow) only the chunks under the view
      for (const c of chunks.values()) c.group.visible = inView([c.ci * cwu, c.cj * chu, (c.ci + 1) * cwu, (c.cj + 1) * chu], 3, 1, 9);
    }
    waterT += dt; if (waterT >= .4 && !reduceMotion) { waterT = 0; waterTick++; for (const c of chunks.values()) c.water(waterTick); }
    // the shadow box follows the view in steps of a few shadow texels, so shadows do not shimmer
    // snapped on the shadow map's own grid, in the sun's frame: a step in world x / z moved the slanted map by a fraction
    // of a texel, and every shadow edge jumped a pixel at each step while walking. Whole texels keep them still
    const ce = Math.cos(cur.el), L = [Math.sin(cur.az) * ce, Math.sin(cur.el), Math.cos(cur.az) * ce];   // toward the sun
    let rx = L[2], rz = -L[0]; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;                    // the map's x: up × L
    const ux = L[1] * rz, uy = L[2] * rx - L[0] * rz, uz = -L[1] * rx;                                     // the map's y: L × x
    const tex = 2 * SHADOW_HALF / SHADOW_MAP * 4, at = area.shadowPin || camT, a = at.x * rx + at.z * rz, b = at.x * ux + at.z * uz;   // shadowPin: the checks move the box alone
    const da = Math.round(a / tex) * tex - a, db = Math.round(b / tex) * tex - b;
    const sx = at.x + da * rx + db * ux, sy = db * uy, sz = at.z + da * rz + db * uz;
    if (Math.abs(sx - sunX) + Math.abs(sz - sunZ) + Math.abs(sy - area.sunY) > 1e-6) { sunX = sx; sunZ = sz; area.sunX = sx; area.sunY = sy; area.sunZ = sz; sun.target.position.set(sx, sy, sz); shadowHold = 3; }
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
  area.sunX = W / 2; area.sunY = 0; area.sunZ = D / 2;
  Object.assign(sun.shadow.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 160 }); sun.shadow.camera.updateProjectionMatrix();
  area.open = (x, z) => { const fresh = !chunks.size; area.stream(x, z, true); if (fresh) area.buildMs = Math.round(performance.now() - T0); };
  return area;
}
const SHADOW_HALF = 30;

// things outside the baked ground, as one small mesh: for things that change in play (chests that open).
// items: [[quads, x, z, o]]
function propMesh(items) {
  const prevS = S, prevB = B; S = new SlabBuilder(256); B = new Builder(256);
  for (const [quads, x, z, o] of items) { const oo = Object.assign({}, o || {}); if (oo.y === undefined) oo.y = A.groundY(x, z); if (quads instanceof LPM) lpPut(B, quads, x, z, oo); else putLow(quads, x, z, oo); }
  B.bakeLamps(A.lampLight); S.bakeLamps(A.lampLight);
  const group = new THREE.Group();
  cardUpload();
  for (const [bld, mat, depth] of [[B, matStatic], settings.flat ? [S, matCard, cardDepth] : [S, matSlab, slabDepth]]) {
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
  if (LP && settings.fig3d) { const k = views.down === 'cat_down' ? 'cat' : views.down; if (LP_FIGURES[k]) return lpFigure(k, o); }   // lowpoly.html: the figures modelled, when chosen (default: the sheet's pixel art)
  const SH = SHEETS[sheet]; if (!SH) throw new Error('actor: sheet "' + sheet + '" is not in the art');
  const idle0 = Array.isArray(anims.idle) ? anims.idle[0] : anims.idle.down[0], first = SH.meta.sprites[idle0.includes('.') ? idle0 : views.down + '.' + idle0];
  if (!first) throw new Error(`actor: frame "${views.down}.${idle0}" missing in ${sheet}`);
  const cw = first.w, ch = first.h, [L, U] = first.anchor || [Math.floor(cw / 2), ch];
  const a = Object.assign({ x: 0, z: 0, fx: 0, fz: 1, step: 0, moving: false, anim: null, at: 0, fps: 10, lift: 0, blink: false, size: 1, probe: new THREE.Vector3(), lampL: { value: 0 } }, o || {});
  a.tex = nearest(new THREE.CanvasTexture(lpSheetCanvas(sheet))); a.tex.encoding = THREE.sRGBEncoding;
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
  const t = nearest(new THREE.CanvasTexture(lpSheetCanvas(sheet))); t.encoding = THREE.sRGBEncoding;
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
/* chests: kept out of the baked ground, all of an area's chests in one mesh (rebuilt while a lid swings: a few chests,
   well under a millisecond); a closed chest shows a faint sparkle while something is inside, an opened one stands open */
const chests = new Map(); let chestMesh = null;
function chestProp(id, key, x, z, o) {
  const sparkle = G.opened[id] ? null : fx('sparkle', x, z, { loop: true, size: .7, fps: 3, y: A.groundY(x, z) + 1.5 });
  if (sparkle && player) sparkle.mesh.visible = Math.hypot(x - player.x, z - player.z) < 14;
  chests.set(id, { id, key, x, z, o, sparkle, lid: G.opened[id] ? CHEST.open : 0 });
}
function chestsBuild() {
  if (settings.wire) setTimeout(applyWire);   // after the mesh below exists
  if (chestMesh) chestMesh.dispose(); chestMesh = null; if (!chests.size) return;
  chestMesh = propMesh([...chests.values()].map((c) => LP && LP_CHEST ? [lpSettle(LP_CHEST(c.lid)), c.x, c.z, { rot: c.o.rot, flip: c.o.flip }] : settings.flat ? [cardFor(sp[c.key], c.o.rot, c.lid) || [], c.x, c.z, { flip: c.o.flip }] : [chestQuads(sp[c.key], c.lid), c.x, c.z, { rot: c.o.rot, flip: c.o.flip }]));
}
function openChestProp(id) {
  const c = chests.get(id); if (!c) return;
  if (c.sparkle) { c.sparkle.dispose(); c.sparkle = null; } c.swing = 0;   // the lid swings open over CHEST.time (chestsTick)
  fx('sparkle', c.x, c.z, { size: 1.2, fps: 8, y: A.groundY(c.x, c.z) + 1 });
}
function chestsTick(dt) {
  let moving = false;
  for (const c of chests.values()) if (c.swing !== undefined) { c.swing = Math.min(1, c.swing + dt / CHEST.time); const e = 1 - Math.pow(1 - c.swing, 3); c.lid = CHEST.open * (reduceMotion ? 1 : e); if (c.swing >= 1) delete c.swing; moving = true; }
  if (moving) chestsBuild();
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
  $('hint').textContent = a ? t(coarse ? 'hint.act.touch' : 'hint.act', { what: t(a.label) }) : t((coarse ? 'hint.touch' : 'hint.keys') + (settings.flat ? '.flat' : ''));   // the 2D style does not turn
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
  seg('optLang', () => settings.lang, (v) => { settings.lang = v; applyLang(); syncStyle(); hintState = null; hudKey = ''; if (A) $('areaName').textContent = t(A.name); if (ui.screen === 'menu') renderTab(); });
  seg('optFps', () => settings.fps, (v) => { settings.fps = +v; });
  seg('optStyle', () => settings.flat ? 'flat' : 'diorama', (v) => { settings.flat = v === 'flat'; restyle(); syncStyle(); });
  seg('optFig', () => settings.fig3d ? '3d' : 'pixel', (v) => setFigures(v === '3d'));
  seg('optWire', () => settings.wire ? 'on' : 'off', (v) => { settings.wire = v === 'on'; applyWire(); });
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
const TURN = Math.PI / 4;   // the view turns and settles in steps of 45 degrees
const rotate = (d) => { if (settings.flat) return; yawT = Math.round(yawT / TURN) * TURN + d * TURN; };   // the 2D style: a fixed view
// the style changed: every area is built again (the kept open world too), the cat where it stands
function restyle() {
  if (!A) return; const name = G ? G.area : A.def.id, at = [player.x, player.z], face = [player.fx, player.fz];
  for (const k of Object.keys(kept)) { if (kept[k] !== A) kept[k].dispose(); delete kept[k]; }
  if (A.def.keep) { A.dispose(); A = null; }
  if (settings.flat) yaw = yawT = 0;
  enterArea(name, at, face);
}
// lowpoly.html: the cat, the people and the monsters as the sheet's pixel art or modelled; the cat is made again where
// it stands, the area's people and monsters with the area
function setFigures(on) {
  settings.fig3d = !!on; saveSettings(); if (!player || !A) return;
  const keep = { x: player.x, z: player.z, fx: player.fx, fz: player.fz };
  player.dispose(); player = sheetActor('cat', { down: 'cat_down', up: 'cat_up', side: 'cat_side' }, CAT_ANIMS); Object.assign(player, keep);
  restyle();
}
// the style from the button by the menu (it names the style in use; a click swaps it) or from the options
function setStyle(flat) { settings.flat = !!flat; saveSettings(); restyle(); syncStyle(); }
function syncStyle() {
  const b = $('styleBtn'); if (b) { const now = settings.flat ? '2D' : '3D'; b.textContent = now; b.setAttribute('aria-label', t('btn.style') + ': ' + now); }
  document.querySelectorAll('#optStyle button').forEach((o) => o.setAttribute('aria-pressed', String(o.dataset.v === (settings.flat ? 'flat' : 'diorama'))));
}

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
  populate(def); unstick(def); playTrack(areaTrack()); if (settings.wire) applyWire();
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
  if (intro < 1) { intro = Math.min(1, intro + dt / 2.8); const e = 1 - Math.pow(1 - intro, 3); yaw = yawT + (settings.flat ? 0 : (1 - e) * -1.05); Vz = lerp(28, VT, e); }
  else { yaw += (yawT - yaw) * (1 - Math.exp(-dt * 9)); Vz += (VT - Vz) * (1 - Math.exp(-dt * 8)); }
  const vv = Math.max(Vz, minV()), [tx, tz] = camGoal(vv), kf = 1 - Math.exp(-dt * 5);
  camT.x += (tx - camT.x) * kf; camT.z += (tz - camT.z) * kf; camT.y += (A.groundY(player.x, player.z) * .5 - camT.y) * kf;
  setCamera();
  _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)); A.tris = A.visibleTris(_frustum);
  if (shakeT > 0) { shakeT = Math.max(0, shakeT - dt); const k = shakeT * .9; cam.position.x += (R() - .5) * k; cam.position.y += (R() - .5) * k; cam.updateMatrixWorld(); }
  for (const a of actors) a.pose();
  // the shadow box first, then the sun from it: the other way round, in the frame where the box moved the sun pointed
  // from the old box to the new one, and the shadows' edges jumped a pixel while walking
  A.update(dt, player.x, player.z);
  applyTod(1 - Math.exp(-dt * 2.2)); if (G && ui.screen === 'game') playTrack(areaTrack()); flatsDraw(dt); chestsTick(dt); floatsDraw(dt); hudDraw(); bossDraw(); toastTick(dt); musicTick();
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
  if (fpsT >= .5) { fps = frames / fpsT; frames = 0; fpsT = 0; if (!$('menu').hidden) $('diag').textContent = t('diag', { fps: Math.round(fps), ms: (1000 / Math.max(1, fps)).toFixed(1), tris: Math.round((A ? A.tris : 0) / 1000), verts: Math.round((A ? A.tris : 0) * 2 / 1000),   // every face is a quad of its own: 4 vertices, 2 triangles
 calls: calls + 1, build: A ? A.buildMs : 0 }); }
}

// ---- engine/88-qa.js
/* ---------- QA passes for the checks (tools/render-check.mjs): the scene drawn with flat stand-in materials, counted ---------- */
// idPass: every mesh of things (the slab material) in its own flat colour, cut by the slab's layer test, everything else
//   black; then the same view with the real material. Returns, per such mesh, its triangles, whether its centre is on
//   screen, the pixels it covers, and how many of them the real material draws (a material that discards or hides
//   everything once made every thing vanish: the flat pass alone would not see it).
// holePass: things in their front-facing colour, but any face seen from behind in magenta: through a hole in a closed
//   shape the camera sees the inside of the back wall. Returns the magenta pixels and where they are.
const qaTarget = new THREE.WebGLRenderTarget(640, 360, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
const qaFlat = (c) => new THREE.MeshBasicMaterial({ color: c });
const qaId = (c) => new THREE.ShaderMaterial({
  uniforms: { uCol: { value: new THREE.Color(c) }, uAux: { value: auxTex } },
  vertexShader: 'attribute float aLayer; varying float vLayer; varying vec2 vUv; void main(){ vLayer = aLayer; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 uCol; uniform sampler2D uAux; varying float vLayer; varying vec2 vUv; void main(){ ' + LAYER_TEST + ' gl_FragColor = vec4(uCol, 1.0); }',
});
const qaHole = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: { uView: { value: new THREE.Vector3() }, uAux: { value: null }, uC: { value: new THREE.Vector2() } },
  // a face whose stored normal points away from the camera, yet is seen: the camera looks inside through a hole. (Not
  // gl_FrontFacing: the builders orient faces by their normals, and the winding is no better witness than the normal.)
  // The slab's own layer test first: front and back layers are 16-pixel rectangles cut to the drawing per pixel, so
  // without it every rectangle's corners read as holes. Cards (layer CUT) are two faces back to back on purpose: never magenta.
  // A face seen from behind is red at full, its world x and z (around the camera's target, ±32) in green and blue: the
  // check names the thing nearest to the hole in the world, not on screen
  vertexShader: 'attribute float aLayer; varying float vLayer; varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ vLayer = aLayer; vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 uView; uniform vec2 uC; uniform sampler2D uAux; varying float vLayer; varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ ' + LAYER_TEST + ' gl_FragColor = (dot(vN, uView) > -0.05 || vLayer > 299.5) ? vec4(0.5, 0.5, 0.5, 1.0) : vec4(1.0, clamp((vW.x - uC.x) / 64.0 + 0.5, 0.0, 1.0), clamp((vW.z - uC.y) / 64.0 + 0.5, 0.0, 1.0), 1.0); }',
});
function qaRender(assign) {
  const swaps = [], hidden = [];
  scene.traverse((o) => {
    if (o.isSprite || o.userData.wire || (o.isMesh && o.parent && o.parent.userData && o.parent.userData.wireOn === o)) { if (o.visible) { hidden.push(o); o.visible = false; } return; }
    if (o.isMesh) { swaps.push([o, o.material]); o.material = assign(o); }
  });
  const prevBg = scene.background; scene.background = new THREE.Color(0);
  renderer.setRenderTarget(qaTarget); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, cam); renderer.setRenderTarget(null);
  const px = new Uint8Array(640 * 360 * 4); renderer.readRenderTargetPixels(qaTarget, 0, 0, 640, 360, px);
  for (const [o, m] of swaps) o.material = m; for (const o of hidden) o.visible = true; scene.background = prevBg;
  return px;
}
function idPass() {
  const things = []; scene.traverse((o) => { if (o.isMesh && o.material === matSlab && o.visible && (!o.parent || o.parent.visible)) things.push(o); });
  const black = qaFlat(0), cols = things.map((_, i) => ((i + 1) * 40503) & 0xffffff | 0x010101), mats = cols.map(qaId);
  const px = qaRender((o) => { const i = things.indexOf(o); return i >= 0 ? mats[i] : black; });
  const real = qaRender((o) => things.includes(o) ? o.material : black);
  const count = new Map(), shown = new Map();
  for (let k = 0; k < px.length; k += 4) { const c = (px[k] << 16) | (px[k + 1] << 8) | px[k + 2]; if (!c) continue; count.set(c, (count.get(c) || 0) + 1); if (real[k] | real[k + 1] | real[k + 2]) shown.set(c, (shown.get(c) || 0) + 1); }
  const v = new THREE.Vector3();
  const out = things.map((o, i) => {
    const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere();
    v.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld).project(cam);
    return { tris: g.index ? g.index.count / 3 : 0, onScreen: Math.abs(v.x) < .9 && Math.abs(v.y) < .9, px: count.get(cols[i]) || 0, shown: shown.get(cols[i]) || 0 };
  });
  mats.forEach((m) => m.dispose()); black.dispose();
  return out;
}
let qaLast = null;   // the last pass's pixels, for a picture (qaImage)
const qaImage = () => Array.from(qaLast || []);
function holePass() {
  cam.getWorldDirection(qaHole.uniforms.uView.value).negate();   // toward the camera
  qaHole.uniforms.uAux.value = auxTex; qaHole.uniforms.uC.value.set(camT.x, camT.z);
  const black = qaFlat(0), px = qaRender((o) => o.material === matSlab ? qaHole : black);
  // the seen-from-behind pixels, and where they are in the world: a count per whole world cell, the largest first
  let n = 0, sx = 0, sy = 0; const cells = new Map();
  for (let k = 0; k < px.length; k += 4) if (px[k] > 200) {
    n++; sx += (k / 4) % 640; sy += 359 - Math.floor(k / 4 / 640);
    const key = Math.round(camT.x + (px[k + 1] / 255 - .5) * 64) + ',' + Math.round(camT.z + (px[k + 2] / 255 - .5) * 64); cells.set(key, (cells.get(key) || 0) + 1);
  }
  black.dispose(); qaLast = px;
  return { magenta: n, at: n ? [Math.round(sx / n), Math.round(sy / n)] : null, spots: [...cells].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, m]) => [...c.split(',').map(Number), m]) };
}
// skyPass: every mesh white on black: what stays black is the sky, seen past the map's edge or through a chunk not built.
//   Returns the sky's pixels (of 640x360) and their box on screen, in fractions of the width and height from the top left
function skyPass() {
  const white = qaFlat(0xffffff), px = qaRender(() => white);
  let n = 0, x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (let k = 0; k < px.length; k += 4) if (!(px[k] | px[k + 1] | px[k + 2])) { n++; const x = ((k / 4) % 640) / 640, y = 1 - (Math.floor(k / 4 / 640) + 1) / 360; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  white.dispose(); qaLast = px;
  return { sky: n, box: n ? [x0, y0, x1, y1].map((v) => +v.toFixed(2)) : null };
}

/* ---------- fingerprints: what a thing is, as data, for the approvals (tools/approve-check.mjs, the viewer) ---------- */
// Four hashes per thing, computed on the CPU from data only (the same on any machine and GPU): its drawing (colours,
// depths, flags, back), its atlas regions (side, back, roof tiles…, wherever they lie), its model (every face's
// corners, normals and layer, built alone at the origin; not the UVs, which move when another thing's region moves),
// and its 2D card. Any change to any of them, from a spec, the art or the engine's code, changes the fingerprint.
function qaHash() {
  let a = 0x811c9dc5, b = 0x9e3779b9;
  const add = (v) => { v |= 0; for (let k = 0; k < 4; k++) { const byte = (v >>> (k * 8)) & 255; a = Math.imul(a ^ byte, 16777619); b = Math.imul(b ^ byte, 2246822519) ^ (b >>> 13); } };
  return { add, addArr: (arr, scale) => { add(arr.length); for (let i = 0; i < arr.length; i++) add(scale ? Math.round(arr[i] * scale) : arr[i]); }, hex: () => (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0') };
}
function qaFingerprint(s) {
  const pic = qaHash(), p = s.pic; for (const arr of [p.c, p.f, p.b, p.fl, p.back || []]) pic.addArr(arr);
  const reg = qaHash(), R = AP.sprites[s.key];
  for (const kind of Object.keys(R).filter((k) => Array.isArray(R[k]) && R[k].length === 4).sort()) {
    const [x0, y0, w, h] = R[kind]; reg.add(w); reg.add(h);
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const k = (y * AW2 + x) * 4; for (let c = 0; c < 4; c++) { reg.add(atlasPx[k + c]); reg.add(auxPx[k + c]); } }
  }
  const prevS = S, prevB = B; S = new SlabBuilder(256); B = new Builder(256);
  if (s.key === CHEST.key) putLow(chestQuads(s, 0), 0, 0, { y: 0 }); else { if (s.pixel) put(s, 0, 0, { y: 0 }); if (s.low.length) putLow(s.low, 0, 0, { y: 0 }); }
  const geo = qaHash(); geo.addArr(S.pos.a.subarray(0, S.pos.n), 1e4); geo.addArr(S.nrm.a.subarray(0, S.nrm.n)); geo.addArr(S.lay.a.subarray(0, S.lay.n)); geo.addArr(S.idx.a.subarray(0, S.idx.n));
  const tris = S.idx.n / 3; S = prevS; B = prevB;
  const card = qaHash(), cp = cardPicture(s, 0); card.add(cp.w); card.add(cp.h); card.addArr(cp.px);
  return { pic: pic.hex(), regions: reg.hex(), geo: geo.hex(), card: card.hex(), tris };
}
const qaFingerprints = () => Object.fromEntries(SPRITES.filter((s) => s.count || s.low.length || (s.pic && s.pic.source)).map((s) => [s.key, qaFingerprint(s)]));

// ---- content/edits/*.json
Object.assign(SHAPE_EDITS, {"church":{"note":"a nave with its gable to the front, a bell tower set back on the right with a pyramid roof and a cross, a low chapel on the left, a lean-to on the right behind the tower","parts":[{"block":[8,69,0,65],"z":[0,52],"roof":{"ridge":"z","yR":85,"over":3,"x":[13,76]}},{"block":[0,7,0,35],"z":[2,26],"roof":{"shed":"x1","yR":41,"over":1}},{"block":[93,99,0,21],"z":[50,86],"roof":{"shed":"x0","yR":31,"over":1}},{"block":[70,93,0,106],"z":[49,84],"roof":{"ridge":"x","hip":1,"yR":115,"over":2}},{"ring":[45,58,8.5,10.5],"in":2},{"open":[38,50,1,28],"in":4},{"open":[21,24,43,55],"in":2},{"open":[62,65,43,55],"in":2},{"open":[77,86,83,99],"in":5},{"open":[80,84,21,31],"in":2},{"card":[41,47,86,96],"z":4,"t":2},{"card":[79,85,116,126],"z":68,"t":2}]},"house_a":{"note":"a tall side-gabled house with a chimney on the left","parts":[{"block":[1,52,0,64],"z":[8,58],"roof":{"ridge":"x","yR":80,"over":2}},{"box":[5,11,70,87],"z":[12,20]},{"open":[10,25,39,53],"in":2},{"open":[31,45,39,53],"in":2},{"open":[21,32,1,24],"in":3}]},"house_b":{"note":"a cottage with its gable to the front, a round attic window, a little roof over the door; its chimney read as a lantern: erased","erase":[[13,23,38,60]],"parts":[{"block":[4,88,0,37],"z":[8,58],"roof":{"ridge":"z","yR":58,"over":3,"x":[6,93]}},{"ring":[46.5,42.5,4.5,6.5],"in":2},{"open":[15,29,12,25],"in":2},{"open":[63,77,12,25],"in":2},{"open":[40,52,1,24],"in":3},{"slope":[33,59,27,32],"out":5}]},"library":{"note":"two storeys under a hipped roof, a bell cote over the door, a cornice between the floors","parts":[{"block":[5,101,0,81],"z":[0,85],"roof":{"ridge":"z","hip":0.5,"yR":104,"over":4}},{"box":[3,104,41,46],"z":[-1,86]},{"block":[42,64,82,110],"z":[2,14],"roof":{"ridge":"z","yR":115,"over":1,"x":[40,66]}},{"open":[47,58,94,105],"in":4},{"open":[21,35,53,72],"in":3},{"open":[71,85,53,72],"in":3},{"open":[20,33,14,34],"in":3},{"open":[74,87,14,34],"in":3},{"open":[44,62,2,30],"in":4}]},"shop":{"note":"a side-gabled house, its chimney, two windows upstairs, the awning over the shop window, the door, the key hanging from its bracket","parts":[{"block":[11,92,0,58],"z":[6,68],"roof":{"ridge":"x","yR":73,"over":3}},{"box":[19,26,64,81],"z":[20,30]},{"open":[21,39,38,55],"in":2},{"open":[57,72,38,55],"in":2},{"open":[20,63,7,27],"in":4},{"open":[72,83,1,26],"in":3},{"slope":[17,69,28,34],"out":6},{"card":[0,9,31,53],"z":3,"t":2}]},"windmill":{"note":"a round stone tower under a conical cap, four sails across its front","parts":[{"cyl":[44,28,23,0,73],"z":38},{"cone":[44,32,74,113],"z":38},{"sails":{"hub":[44.5,82],"arms":[[6,106],[84,108],[6,33],[84,34]],"w":13},"z":2,"t":2}]}});

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
    ['well', 44, 44], ['market_stall', 53, 47], ['bench', 36, 48.5], ['reading_desk', 35.5, 36.6, undefined, undefined, { desk: true }],
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
    id: 'overworld', name: 'area.village', cell: 2, chunk: [16, 12], keep: true, tod: 'giorno', start: [44, 49], camNorth: 1.5, music: (x) => x > 64 ? 'road' : 'village',
    legend: { g: { tile: 'grass' }, f: { tile: 'grass_flowers' }, c: { tile: 'cobblestone' }, p: { tile: 'dirt_path' }, a: { tile: 'farmland' },
      w: { tile: 'water', water: true, h: -3 }, X: { tile: 'grass', h: 56, cliff: true }, Y: { tile: 'grass_flowers', h: 56, cliff: true } },
    map, things,
    npcs: [['shopkeeper', 53, 49.6, [0, 1]], ['child', 47.6, 45.2, [0, 1]], ['guard', 41.4, 26.2, [0, 1]]],
    spawns: [['blot', 70, 42], ['blot', 80, 43.6], ['blot', 100, 36], ['inkfly', 88, 41.5], ['inkfly', 93, 44.5], ['inkfly', 97, 31.5], ['blot', 76, 38.4]],
    lamps: [[38, 2.6, 39], [50, 2.6, 39], [38, 2.6, 51], [50, 2.6, 51]],
  };
})();

// ---- content/chapter1/buildings.js
/* ---------- buildings drawn in code (they replace the sheet drawings of the same key) ---------- */
// The bakery, after the ChatGPT design: a front-gable house in ochre plaster on a stone plinth, a shop window full of
// bread under a green and cream awning, an arched door, a round attic window, a bread sign on an iron bracket, a brick
// chimney near the back. 108 × 74 art pixels, 60 deep.
const SIGN_N = 12, SIGN_DISC = true, DOOR_RING = true, ATTIC_RING = true, BOXES = true;   // smooth parts (false: per pixel, for comparison)   // the round parts as smooth rings (false: per pixel, for comparison)
CODE_ART.bakery = () => {
  const W = 108, H = 74, p = new Pic(W, H), hd = 30, cx = 56;
  const PLASTER = 0xe6bf78, STONE = 0xb9ad96, WOOD = 0x6e4628, ROOF = 0xc2603a, BRICK = 0xa2553a, GREEN = 0x3f8650, CREAM = 0xf0e6cf;
  const plaster = (x, r) => jit(vnoise(x / 6, r / 6) > .72 ? shade(PLASTER, .94) : PLASTER, x >> 1, r >> 1, 3, .05);
  const stone = (x, r) => { const row = Math.floor(r / 3), xx = x + (row % 2) * 4; return r % 3 === 2 || xx % 8 === 0 ? shade(STONE, .74) : jit(STONE, Math.floor(xx / 8), row, 5, .12); };
  const x0 = 10, x1 = 101;                                          // the walls' outer columns

  // plinth, walls, quoins (one column in from the corner, so the side walls stay plaster)
  p.wall(x0, 0, x1 - x0 + 1, 5, stone, hd + 1, -hd);
  p.wall(x0, 5, x1 - x0 + 1, 35, plaster, hd, -hd);
  for (let r = 5; r < 40; r++) { const long = Math.floor((r - 5) / 4) % 2 === 0, n = long ? 5 : 3; for (let k = 1; k <= n; k++) { p.at(x0 + k, r, stone(x0 + k, r), hd, -hd); p.at(x1 - k, r, stone(x1 - k, r), hd, -hd); } }
  // the corner columns: their side faces are the side walls, in one plain colour each (F_OWN), plaster above the plinth
  for (let r = 0; r < 40; r++) for (const x of [x0, x1]) p.at(x, r, r < 5 ? STONE : PLASTER, r < 5 ? hd + 1 : hd, -hd, BOXES ? F_NOSIDE : F_OWN);
  const boxes = p.boxes = [];
  if (BOXES) { for (let r = 0; r < 5; r++) for (let x = x0; x <= x1; x++) p.fl[p.Y(r) * W + x] |= F_NOSIDE;   // plinth and side walls: two boxes' sides
    boxes.push({ x0, x1: x1 + 1, r0: 0, r1: 5, zf: hd + 1, zb: -hd, faces: 'sides' }, { x0, x1: x1 + 1, r0: 5, r1: 40, zf: hd, zb: -hd, faces: 'sides', skip: ['top', 'bottom'] }); }

  // the shop window: a wooden frame, mullions, bread on two shelves in a warm lit room, a stone sill
  const wx0 = 18, wx1 = 63, wr0 = 9, wr1 = 24;
  for (let r = wr0; r <= wr1; r++) for (let x = wx0; x <= wx1; x++) {
    const frame = x === wx0 || x === wx1 || r === wr0 || r === wr1, mull = (x - wx0) % 15 === 0;
    const nos = BOXES ? F_NOSIDE : 0;
    if (frame || mull) { p.at(x, r, mull && !frame ? shade(WOOD, .9) : WOOD, frame ? hd + 1 : hd - 1, -hd, nos); continue; }
    const shelf = r === 13 || r === 18, loaf = !shelf && ((r >= 14 && r <= 16) || (r >= 19 && r <= 21)) && ((x + (r > 17 ? 3 : 0)) % 6) < 4;
    const c = shelf ? 0x5a3a22 : loaf ? (r === 16 || r === 21 ? 0xc07e3a : 0xe0a454) : jit(0x6a4226, x, r, 9, .1);
    p.at(x, r, c, hd - 4, -hd, (loaf ? F_GLOW : 0) | nos);
  }
  if (BOXES) {   // the frame proud of the wall, the room set in, two mullions; the sill a ledge
    boxes.push({ x0: wx0, x1: wx1 + 1, r0: wr0, r1: wr1 + 1, zf: hd + 1, zb: hd, faces: 'sides' }, { x0: wx0 + 1, x1: wx1, r0: wr0 + 1, r1: wr1, zf: hd + 1, zb: hd - 4, faces: 'in' });
    for (const mx of [wx0 + 15, wx0 + 30]) boxes.push({ x0: mx, x1: mx + 1, r0: wr0 + 1, r1: wr1, zf: hd - 1, zb: hd - 4, faces: 'sides' });
    boxes.push({ x0: wx0 - 2, x1: wx1 + 3, r0: wr0 - 1, r1: wr0, zf: hd + 2, zb: hd, faces: 'all' });
  }
  for (let x = wx0 - 2; x <= wx1 + 2; x++) p.at(x, wr0 - 1, shade(STONE, 1.08), BOXES ? hd : hd + 2, -hd, BOXES ? F_NOSIDE : 0);

  // the awning: stripes 5 wide on one smooth sloping panel built by the engine (p.slopes: it reads these pixels, painted
  // flat on the wall behind it), two triangular ends, and the scalloped hem hanging from its lower edge as pixels
  const aw0 = wx0 - 4, aw1 = wx1 + 4, out = 9;
  for (let k = 0; k < 7; k++) {
    const r = 31 - k;
    for (let x = aw0; x <= aw1; x++) {
      const band = Math.floor((x - aw0) / 5), green = band % 2 === 0;
      if (k === 6 && (x - aw0) % 5 !== 2) continue;                 // the hem: one point per stripe
      const c = shade(green ? GREEN : CREAM, k === 0 ? 1.08 : 1 - k * .02);
      if (k < 6) p.at(x, r, c, hd, -hd); else p.at(x, r, c, hd + out, -hd, BOXES ? F_NOSIDE : 0);   // a hem point: a thin card hanging from the awning (it spans the wall too: one depth interval per pixel)
    }
  }
  p.slopes = [{ x0: aw0, x1: aw1 + 1, yTop: 32, yBot: 26, zTop: hd, zBot: hd + out }];

  // the door: arched, planked, set in, a stone frame, two small lit panes
  const dx0 = 76, dw = 15, dr0 = 5, dh = 23, ah = 8;
  for (let j = 0; j < dh + 1; j++) for (let i = -1; i <= dw; i++) {
    const jj = j - 1, inside = i >= 0 && i < dw && jj >= 0 && inArch(i, jj, dw, ah), frame = !inside && inArch(i + 1, j, dw + 2, ah + 1), r = dr0 + dh - 1 - jj;
    const arch = DOOR_RING && r >= dr0 + dh - ah, nos = arch ? F_NOSIDE : 0;          // the arch rows: the half ring draws their edges
    if (inside) { const pane = jj >= 7 && jj <= 10 && (i === 4 || i === 5 || i === 9 || i === 10); p.at(dx0 + i, r, pane ? 0xf2b552 : i % 3 === 0 ? shade(WOOD, .76) : jit(WOOD, i, jj >> 2, 12, .1), hd - 3, -hd, (pane ? F_GLOW : 0) | nos); }
    else if (frame) p.at(dx0 + i, r, shade(STONE, 1.05), arch ? hd : hd + 1, -hd, nos);
  }

  if (DOOR_RING) (p.rings = p.rings || []).push({ cx: dx0 + dw / 2, cy: dr0 + dh - ah, rx0: dw / 2 - .3, ry0: ah - .3, rx1: dw / 2 + 1.4, ry1: ah + 1.4, ru: dw / 2 + .5, a0: 0, a1: Math.PI, n: 10, zf: hd + 1, zw: hd, zi: hd - 3 });

  // cornice under the gable
  for (let x = x0 - 2; x <= x1 + 2; x++) { const o = BOXES ? F_NOSIDE : 0; p.at(x, 40, shade(STONE, .82), hd + 2, -hd - 2, o); p.at(x, 41, STONE, hd + 2, -hd - 2, o); }
  if (BOXES) boxes.push({ x0: x0 - 2, x1: x1 + 3, r0: 40, r1: 42, zf: hd + 2, zb: -hd - 2, faces: 'sides' });

  // the gable wall under the roof. The roof itself is two smooth slopes built by the engine (p.roofs, see roofQuads),
  // tiled like the other buildings' roofs, overhanging 3 px front and back and 4 px at the eaves
  const rise = 27, half0 = x1 - cx + 4;
  const roofLine = (x) => 42 + rise * (1 - Math.abs(x + .5 - cx) / half0);
  for (let r = 42; r < 42 + rise; r++) { const hw = (x1 - cx) * (1 - (r - 42) / rise); for (let x = Math.ceil(cx - hw); x <= Math.floor(cx + hw); x++) p.at(x, r, plaster(x, r), hd, -hd, F_NOSIDE); }   // no side faces: under the roof (their tops fought it near the ridge)
  p.roofs = [{ cx: cx + .5, xl: cx + .5 - half0, xr: cx + .5 + half0, yE: 42, yR: 42 + rise, zf: hd + 3, zb: -hd - 3, t: 3 }];

  // the round attic window, lit
  for (let r = 49; r <= 59; r++) for (let x = cx - 6; x <= cx + 5; x++) {
    const d = Math.hypot(x + .5 - cx, r + .5 - 54); if (d > 5.6) continue;
    const nos = ATTIC_RING ? F_NOSIDE : 0;   // the ring draws the edges
    p.at(x, r, d > 4.2 ? shade(STONE, 1.05) : (x === cx || r === 54) ? WOOD : 0xf2b552, d > 4.2 ? (ATTIC_RING ? hd : hd + 1) : hd - 2, -hd, (d > 4.2 ? 0 : F_GLOW) | nos);
  }
  if (ATTIC_RING) (p.rings = p.rings || []).push({ cx, cy: 54, rx0: 3.9, ry0: 3.9, rx1: 6, ry1: 6, ru: 4.8, a0: 0, a1: Math.PI * 2, n: 12, zf: hd + 1, zw: hd, zi: hd - 2 });


  // the chimney: bricks above the roof line, a stone cap; a straight block near the back
  for (let x = 82; x <= 90; x++) for (let r = Math.ceil(roofLine(x)) + 1; r <= 70; r++) {
    const cap = r >= 68, brick = (r % 3 === 0) || ((x + (Math.floor(r / 3) % 2) * 2) % 4 === 0);
    p.at(x, r, cap ? shade(STONE, r === 70 ? 1.1 : .9) : brick ? shade(BRICK, .78) : jit(BRICK, x, r, 7, .1), -10, -22, BOXES ? F_GHOST : 0);
  }
  for (let x = 81; x <= 91; x++) p.at(x, 70, shade(STONE, 1.1), -9, -23, BOXES ? F_GHOST : 0);
  if (BOXES) boxes.push({ x0: 82, x1: 91, r0: 56, r1: 70, zf: -10, zb: -22, faces: 'all' }, { x0: 81, x1: 92, r0: 70, r1: 71, zf: -9, zb: -23, faces: 'all' });   // body (its foot inside the roof), cap

  // the bread sign: an iron bracket from the corner, a round board with a loaf, a thin board at the front
  for (let x = 1; x <= x0 - 1; x++) p.at(x, 33, 0x2a2420, hd + 2, hd - 2);
  for (let r = 19; r <= 31; r++) for (let x = 0; x <= 9; x++) {
    const d = Math.hypot(x + .5 - 5, r + .5 - 25); if (d > 5.6) continue;
    const loaf = Math.abs(x + .5 - 5) < 3.2 && Math.abs(r + .5 - 25) < 1.6;
    p.at(x, r, d > 4.6 ? WOOD : loaf ? 0xe0a454 : 0xead7a8, hd + 3, hd + 1, SIGN_DISC ? F_GHOST : 0);   // the board's colours, for the disc
  }
  p.at(3, 32, 0x2a2420, hd + 2, hd); p.at(7, 32, 0x2a2420, hd + 2, hd);
  if (SIGN_DISC) p.discs = [{ cx: 5, cy: 25, r: 5.6, zf: hd + 3, zb: hd + 1, n: SIGN_N }];   // the board: a smooth disc

  // the back: the same outline, plain plaster with a back door and a small window, the plinth, the roof and chimney
  const back = Int32Array.from(p.c);
  for (let r = 5; r < 40; r++) for (let x = x0; x <= x1; x++) back[p.Y(r) * W + x] = plaster(x * 3 + 7, r);
  for (let r = 0; r < 5; r++) for (let x = x0; x <= x1; x++) back[p.Y(r) * W + x] = stone(x, r);
  for (let r = 5; r < 26; r++) for (let x = 20; x < 32; x++) back[p.Y(r) * W + x] = x === 20 || x === 31 || r === 25 ? shade(STONE, 1.05) : (x - 20) % 3 === 0 ? shade(WOOD, .76) : WOOD;
  for (let r = 16; r < 25; r++) for (let x = 66; x < 76; x++) back[p.Y(r) * W + x] = x === 66 || x === 75 || r === 16 || r === 24 ? shade(STONE, 1.05) : 0x3a2c26;
  p.back = back; p.tiles = true;
  return p.done();
};

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

// ---- content/chapter1/shapes.js
/* ---------- buildings shaped from a spec (engine/24-shapes.js) ---------- */
// The specs are content/edits/<key>.json, one per thing: what each piece of the sheet's drawing is, measured in columns x
// and rows from the ground (tools/shape-measure.mjs), depths z from the front. The editor (tools/editor.mjs) writes
// them; the build puts them in SHAPE_EDITS. A thing with a spec is built from it in place of its sheet extrusion.
Object.assign(SHAPES, SHAPE_EDITS);
for (const key of Object.keys(SHAPES)) { BUILD[key] = 'pixel'; CODE_ART[key] = (old) => shapeBuilding(old.pic, SHAPES[key], old.sheet); }

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

// ---- content/curate.js
/* ---------- curation: hand fixes per building, applied at load (see CURATE in engine/22-lowpoly.js) ---------- */
// Coordinates are art pixels of the sprite's own drawings: front (x, row), side view (depth from the front, row).
Object.assign(CURATE, {
  // the bakery is drawn in code now (content/chapter1/buildings.js)
  library: { back: { wall: 'stone' } },
  // the signpost: its drawing extruded 4 px (post and arrows), the stones at its foot 10 px
  signpost: { depth: { rules: [{ box: [0, 0, 23, 26], half: 2 }, { box: [0, 26, 23, 33], half: 5 }] } },
});

// ---- content/lowpoly/00-palette.js
/* ---------- lowpoly.html: the palette and the ground, painted in code ---------- */
// One warm palette for the whole village (an Italian hill town in late afternoon light): every model and tile takes its
// colours from here, so nothing clashes. The light, the shadows and the night come from the scene.
const LPC = {
  plaster: 0xe7c587, plasterHi: 0xf0d8a6, cream: 0xefe2c2, ochre: 0xd9a25a, rose: 0xdca58c,
  stone: 0xbdb29d, stoneDk: 0x958b78, stoneLt: 0xd3cab6, slate: 0x7d7a80,
  roof: 0xc65a3a, roofDk: 0xa9462c, roofLt: 0xd8754e, roofOld: 0xb06a46,
  wood: 0x8a5a34, woodDk: 0x5e3a22, woodLt: 0xa8774a, door: 0x6c3d22, doorDk: 0x4e2a17,
  shutter: 0x4f8a50, shutterDk: 0x3c6d3e, blue: 0x3f6aa8, blueDk: 0x2f5084, red: 0xb8433a, gold: 0xd7a83c,
  glass: 0xffd98a, glassDk: 0x6e5a48, iron: 0x3b3735, ironLt: 0x5a5450,
  awnGreen: 0x3e8a54, awnCream: 0xf3ead4, awnRed: 0xc0473b,
  leaf: 0x5e9a3c, leafDk: 0x447a2c, leafLt: 0x7db64c, cypress: 0x3f6e38, cypressDk: 0x2f5a2c, olive: 0x8aa05a, trunk: 0x6e4c2e,
  grape: 0x6a3f7a, hay: 0xd8b860, bread: 0xd99a4c, white: 0xf4efe6,
};

// the ground tiles, 128 x 128 art px each (the pattern repeats every 8 world units, not every 2), seamless: a few flat
// shades in soft patches, small details sparse
function lpTileSet() {
  const W = 128, H = 128, tile = (fn) => { const px = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = fn(x, y), o = (y * W + x) * 4; px[o] = c >> 16 & 255; px[o + 1] = c >> 8 & 255; px[o + 2] = c & 255; px[o + 3] = 255; } return { w: W, h: H, px }; };
  // seamless value noise with period 32 (cells of `s` px)
  const noise = (seed, s) => { const n = W / s, at = (i, j) => hash2(((i % n) + n) % n + seed * 131, ((j % n) + n) % n + seed * 71); return (x, y) => { const fx = x / s, fy = y / s, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, sm = (t) => t * t * (3 - 2 * t); const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1); return a + (b - a) * sm(u) + (c - a) * sm(v) + (a - b - c + d) * sm(u) * sm(v); }; };
  const n8 = noise(1, 8), n16 = noise(2, 16), n4 = noise(3, 4), n32 = noise(4, 32), n64 = noise(5, 64);
  const patch = (x, y) => n64(x, y) * .45 + n32(x, y) * .35 + n8(x, y) * .2;
  const grass = (x, y) => { const v = patch(x, y); let c = v < .4 ? 0x64a245 : v < .6 ? 0x6aa94a : 0x72b04f; if (hash2(x * 3 + 1, y * 5 + 2) < .035 && n4(x, y) > .5) c = 0x8cc35e; if (hash2(x * 7 + 5, y * 3 + 9) < .02) c = 0x548f3a; return c; };
  // flowers: a few 3 px blossoms in white, yellow and rose
  const FL = []; { const r = rng(57); for (let i = 0; i < 70; i++) FL.push([Math.floor(r() * 128), Math.floor(r() * 128), [0xf6f2ea, 0xf3d24e, 0xe9a3b6][i % 3]]); }
  const flowerAt = (x, y) => { for (const [fx, fy, c] of FL) { const dx = ((x - fx + 192) % 128) - 64, dy = ((y - fy + 192) % 128) - 64; if (Math.abs(dx) + Math.abs(dy) <= 1) return dx === 0 && dy === 0 ? 0xe2a13a : c; } return 0; };
  // cobbles: rounded stones from a seamless Voronoi, mortar between, a light edge toward the sun
  const seeds = []; { const r = rng(91); for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) seeds.push([i * 8 + 1.5 + r() * 5, j * 8 + 1.5 + r() * 5, r()]); }
  const cell = (x, y) => { let best = 1e9, second = 1e9, id = 0; for (const [sx, sy, k] of seeds) { if (Math.abs(((sx - x + 192) % 128) - 64) > 14 || Math.abs(((sy - y + 192) % 128) - 64) > 14) continue; for (const ox of [-128, 0, 128]) for (const oy of [-128, 0, 128]) { const d = Math.hypot(x + .5 - sx - ox, y + .5 - sy - oy); if (d < best) { second = best; best = d; id = k; } else if (d < second) second = d; } } return [second - best, id]; };
  const cobble = (x, y) => { const [edge, id] = cell(x, y); if (edge < 1.1) return 0x8a8478; const base = id < .33 ? 0xb9b1a2 : id < .66 ? 0xaaa293 : 0xc3bba9; const [e2] = cell(x + 1, y + 1); return e2 < 1.1 ? lpShade(base, 1.08) : base; };
  const dirt = (x, y) => { const v = patch(x, y); let c = v < .4 ? 0xbf9a62 : v < .7 ? 0xc9a56c : 0xd2b07a; if (hash2(x * 5 + 3, y * 9 + 1) < .02) c = 0xa58a66; return c; };
  const farm = (x, y) => { const row = y % 8; if (row < 2) return 0x6f4529; if (row === 2) return 0x7d5131; const v = n8(x, y); return v < .5 ? 0x8a5a36 : 0x93623c; };
  const water = (x, y) => { const v = n8(x, y) * .6 + n16(x, y) * .4, w = Math.sin((x + y * .5) / 128 * Math.PI * 16 + v * 3); return w > .92 ? 0x8fcbe6 : v < .45 ? 0x3f8fbd : 0x4a9cc8; };
  const planks = (x, y) => { const row = Math.floor(y / 6), off = (row * 11) % 32, xx = (x + off) % 32; if (y % 6 === 5 || y === 127) return 0x5e3a22; if (xx === 0) return 0x6a4227; const c = row % 2 ? 0x9a6b3e : 0xa57444; return (xx === 2 || xx === 29) && y % 6 === 2 ? 0x4e3020 : (n4(x, y) > .7 ? lpShade(c, 1.05) : c); };
  const crypt = (x, y) => { const bx = Math.floor(x / 16), by = Math.floor(y / 16), xx = x % 16, yy = y % 16; if (xx === 0 || yy === 0) return 0x3e3a44; const c = (bx + by) % 2 ? 0x6a6672 : 0x625e6a; return n4(x, y) > .75 ? lpShade(c, .92) : c; };
  return {
    grass: tile(grass), grass_flowers: tile((x, y) => flowerAt(x, y) || grass(x, y)), cobblestone: tile(cobble), dirt_path: tile(dirt),
    farmland: tile(farm), water: tile(water), wood_planks: tile(planks), crypt_floor: tile(crypt),
  };
}
LP_TILES = lpTileSet;

// the walls of the rooms, by the legend's wall colour: in the crypt cold stone in courses of blocks, each a shade of its
// own, mortar between; indoors warm plaster over a wainscot of dark planks
LP_WALL = (c, a, y) => {
  if (c === 0x4a4250) {
    const course = Math.floor(y / 8), u = a + (course % 2) * 7, block = Math.floor(u / 14);
    if (y % 8 === 0 || u % 14 === 0) return 0x2e2a34;
    return [0x5a5464, 0x524c5c, 0x625c6c, 0x4e4858][Math.floor(hash2(block * 3 + 1, course * 7 + 2) * 4)];
  }
  if (c === 0x6e5a48) {
    if (y < 16) return y === 15 ? 0x4a3020 : a % 6 === 0 ? 0x5a3a24 : 0x7a5032;   // the wainscot and its rail
    if (y === 16 || y === 17) return 0x8a6040;
    return y % 12 === 0 ? 0xd2bc98 : 0xdcc8a4;
  }
  return Math.floor(y / 6) % 2 ? c : lpShade(c, .94);
};

// ---- content/lowpoly/01-parts.js
/* ---------- lowpoly.html: the pieces buildings are made of ---------- */
// Each returns a small model facing +z with its back at z = 0, the plane of the wall it sits on, so a building puts
// it on any wall with LPM.add (ry: 0 front, PI back, PI/2 the right side, -PI/2 the left). No holes are cut: frames,
// sills and reveals stand proud of the wall, so the glass between them reads as set in.

// a window: glass that lights up at night, a frame, a cross of mullions, a sill, optional open shutters and arched top
function lpWindow(w, h, o = {}) {
  const m = new LPM(), x0 = -w / 2, x1 = w / 2, fr = o.frame === undefined ? LPC.woodDk : o.frame, t = 1.2, d = 1.4, arch = o.arch ? w / 2 : 0;
  const glass = arch ? [[x0, 0, .2], [x1, 0, .2], ...Array.from({ length: 7 }, (_, k) => { const a = k / 6 * Math.PI; return [Math.cos(a) * w / 2, h - arch + Math.sin(a) * arch, .2]; })] : [[x0, 0, .2], [x1, 0, .2], [x1, h, .2], [x0, h, .2]];
  m.face(glass, o.dark ? LPC.glassDk : LPC.glass, { glow: !o.dark, jit: 0 });
  m.box(x0 - t, -t, 0, x0, h - arch, d, fr).box(x1, -t, 0, x1 + t, h - arch, d, fr);
  if (arch) for (let k = 0; k < 6; k++) { const a0 = k / 6 * Math.PI, a1 = (k + 1) / 6 * Math.PI, P2 = (a, r) => [Math.cos(a) * r, h - arch + Math.sin(a) * r]; const [ax, ay] = P2(a0, arch), [bx, by] = P2(a1, arch), [cx, cy] = P2(a1, arch + t), [dx, dy] = P2(a0, arch + t); m.face([[ax, ay, d], [bx, by, d], [cx, cy, d], [dx, dy, d]], fr, { from: [0, h - arch, -5] }); m.face([[dx, dy, 0], [cx, cy, 0], [cx, cy, d], [dx, dy, d]], fr, { from: [0, h - arch, d / 2] }); }
  else m.box(x0 - t, h, 0, x1 + t, h + t, d, fr);
  m.box(-.45, 0, 0, .45, h - (arch ? arch * .2 : 0), .9, fr).box(x0, h * .55 - .45, 0, x1, h * .55 + .45, .9, fr);   // mullions
  m.box(x0 - t - 1, -t - 1.2, 0, x1 + t + 1, -t, d + 1.2, o.sill === undefined ? LPC.stoneLt : o.sill);   // sill
  if (o.shutters) for (const s of [-1, 1]) { const a = s < 0 ? x0 - t - w / 2 - .4 : x1 + t + .4, b = a + w / 2; m.box(a, 0, 0, b, h - arch, .9, o.shutters); for (let y = 2; y < h - arch - 1; y += 3) m.box(a + .4, y, .9, b - .4, y + .7, 1.2, lpShade(o.shutters, .82)); }
  if (o.flowers) { m.box(x0 - t, -t - 4, .2, x1 + t, -t - 1.2, 3.6, LPC.wood); for (let k = 0; k < 4; k++) m.blob(x0 + (k + .5) * w / 4, -t + 1.2, 2.4, 1.9, [0xe0503a, 0xf2d24a, 0xe7a0c0, 0xf4efe6][k], { seed: k + 3, jit: .2, sy: .8, facej: .02 }); }
  return m;
}
// a door: planks in two shades, a frame (stone or wood), a ring handle; o.arch: a round top; o.double: two leaves
function lpDoor(w, h, o = {}) {
  const m = new LPM(), x0 = -w / 2, x1 = w / 2, fr = o.frame === undefined ? LPC.stoneLt : o.frame, t = 2, arch = o.arch ? w / 2 : 0, c = o.col || LPC.door;
  const n = Math.max(3, Math.round(w / 3)), top = (x) => arch ? h - arch + Math.sqrt(Math.max(0, arch * arch - x * x)) : h;
  for (let i = 0; i < n; i++) { const a = x0 + i * w / n, b = x0 + (i + 1) * w / n; m.face([[a, 0, .3], [b, 0, .3], [b, top(b), .3], [a, top(a), .3]], i % 2 ? lpShade(c, .88) : c, { jit: .03 }); }
  if (o.double) m.box(-.5, 0, .3, .5, top(0), .8, LPC.doorDk);
  m.box(x0 - t, 0, 0, x0, h - arch, 2, fr).box(x1, 0, 0, x1 + t, h - arch, 2, fr);
  if (arch) for (let k = 0; k < 8; k++) { const a0 = k / 8 * Math.PI, a1 = (k + 1) / 8 * Math.PI, P2 = (a, r) => [Math.cos(a) * r, h - arch + Math.sin(a) * r]; const [ax, ay] = P2(a0, arch), [bx, by] = P2(a1, arch), [cx, cy] = P2(a1, arch + t), [dx, dy] = P2(a0, arch + t); m.face([[ax, ay, 2], [bx, by, 2], [cx, cy, 2], [dx, dy, 2]], k === 4 || k === 3 ? lpShade(fr, 1.06) : fr, { from: [0, h - arch, -5] }); m.face([[dx, dy, 0], [cx, cy, 0], [cx, cy, 2], [dx, dy, 2]], fr, { from: [0, h - arch, 1] }); }
  else m.box(x0 - t, h, 0, x1 + t, h + t, 2, fr);
  for (const s of o.double ? [-1, 1] : [1]) m.box(s * w / 4 - .6, h * .42, .3, s * w / 4 + .6, h * .42 + 1.2, 1.4, LPC.gold);
  m.box(x0 - t - 1, -.01, 0, x1 + t + 1, 1, 3.5, LPC.stoneDk);   // the step
  return m;
}
// an awning: a striped panel from the wall (top, at z 0) down and out, a scalloped hem, two side triangles
function lpAwning(w, drop, out, a, b, o = {}) {
  const m = new LPM(), n = Math.max(2, Math.round(w / (o.stripe || 5))), sw = w / n, x0 = -w / 2, hem = o.hem === undefined ? 2.5 : o.hem;
  for (let i = 0; i < n; i++) { const xa = x0 + i * sw, xb = xa + sw, c = i % 2 ? b : a; m.face([[xa, -drop, out], [xb, -drop, out], [xb, 0, 0], [xa, 0, 0]], c, { from: [0, -drop * 2, 0], jit: .02 }); m.face([[xa, -drop, out], [xb, -drop, out], [(xa + xb) / 2, -drop - hem, out]], c, { from: [0, -drop, -1] }); }
  for (const x of [x0, -x0]) m.face([[x, 0, 0], [x, -drop, out], [x, -drop, 0]], lpShade(a, .85), { from: [0, -drop / 2, out / 3] });
  m.box(x0 - .5, -.6, 0, -x0 + .5, .6, 1, LPC.ironLt);   // its iron rail
  return m;
}
// stones at a corner, every other one long (quoins), proud of the wall by 0.6
function lpQuoins(m, x, zf, zb, y0, y1, side, c) {
  for (let y = y0, k = 0; y < y1; y += 5, k++) {
    const long = k % 2 === 0, h = Math.min(4.4, y1 - y);
    m.box(side < 0 ? x - .6 : x - (long ? 7 : 4), y, zf - .01, side < 0 ? x + (long ? 7 : 4) : x + .6, y + h, zf + .6, c);
    m.box(side < 0 ? x - .6 : x - .01, y, zf - (long ? 4 : 7), side < 0 ? x + .01 : x + .6, y + h, zf, c);
  }
}
// a chimney of bricks with a stone cap
function lpChimney(m, x, z, w, d, y0, y1) {
  m.box(x - w / 2, y0, z - d / 2, x + w / 2, y1, z + d / 2, 0xa85a40, { top: 0x6a4436 });
  for (let y = y0 + 3; y < y1 - 2; y += 3) m.box(x - w / 2 - .2, y, z - d / 2 - .2, x + w / 2 + .2, y + .5, z + d / 2 + .2, 0x8e4a34);
  m.box(x - w / 2 - 1, y1, z - d / 2 - 1, x + w / 2 + 1, y1 + 1.6, z + d / 2 + 1, LPC.stoneLt, { top: LPC.stone });
}
// a house body: walls up to the eaves and, for a gable, its two end triangles, as one prism (ridge along x or z)
function lpBody(m, x0, x1, z0, z1, yE, yR, ridge, c, o = {}) {
  if (!yR || o.flat) return m.box(x0, 0, z0, x1, yE, z1, c, { top: o.top === undefined ? c : o.top });
  // (the gable a little under the roof: on the roof's own plane the two fought for the pixels, in stripes)
  const yA = yR - 4, yB = yE - .6;
  if (ridge === 'x') { const zm = (z0 + z1) / 2; return m.prism([[z0, 0], [z1, 0], [z1, yB], [zm, yA], [z0, yB]], 'x', x0, x1, c); }
  const xm = (x0 + x1) / 2; return m.prism([[x0, 0], [x1, 0], [x1, yB], [xm, yA], [x0, yB]], 'z', z0, z1, c);
}
// a stone plinth round a body, a little proud
function lpPlinth(m, x0, x1, z0, z1, h, c) { return m.box(x0 - .8, 0, z0 - .8, x1 + .8, h, z1 + .8, c || LPC.stoneDk, { top: lpShade(c || LPC.stoneDk, 1.1) }); }
// a band of stone (cornice, string course) round a body
function lpBand(m, x0, x1, z0, z1, y, h, out, c) { return m.box(x0 - out, y, z0 - out, x1 + out, y + h, z1 + out, c || LPC.stoneLt); }

// ---- content/lowpoly/02-buildings.js
/* ---------- lowpoly.html: the village's buildings ---------- */
// Each on the footprint of its sheet sprite (x from its anchor column, z from the middle of its depth, front +z), its
// door where the sprite's door is, so the doorways, collisions and shadows of the game stay as they were.

// a feature (window, door…) put on a wall: side front/back/left/right, u along the wall, y up, plane the wall's x or z
const lpOn = (m, f, side, u, y, plane) => m.add(f, side === 'front' ? { x: u, y, z: plane } : side === 'back' ? { x: u, y, z: plane, ry: Math.PI } : side === 'right' ? { x: plane, y, z: -u, ry: Math.PI / 2 } : { x: plane, y, z: u, ry: -Math.PI / 2 });
// a round window: glass disc and a stone ring, facing +z
function lpRound(r0, r1, o = {}) {
  const m = new LPM(), n = 12, at = (k, r) => [Math.cos(k / n * Math.PI * 2) * r, Math.sin(k / n * Math.PI * 2) * r];
  m.face(Array.from({ length: n }, (_, k) => [...at(k, r0), .2]), LPC.glass, { glow: 1, jit: 0 });
  for (let k = 0; k < n; k++) { const [ax, ay] = at(k, r0), [bx, by] = at(k + 1, r0), [cx, cy] = at(k + 1, r1), [dx, dy] = at(k, r1), c = o.c || LPC.stoneLt; m.face([[ax, ay, 1.6], [bx, by, 1.6], [cx, cy, 1.6], [dx, dy, 1.6]], k % 2 ? lpShade(c, .94) : c, { from: [0, 0, -5] }); m.face([[ax, ay, 0], [bx, by, 0], [bx, by, 1.6], [ax, ay, 1.6]], lpShade(c, .8), { from: [0, 0, 1] }); m.face([[dx, dy, 0], [cx, cy, 0], [cx, cy, 1.6], [dx, dy, 1.6]], c, { from: [0, 0, 1] }); }
  if (o.cross) m.box(-.5, -r0, .2, .5, r0, .9, LPC.woodDk).box(-r0, -.5, .2, r0, .5, .9, LPC.woodDk);
  return m;
}
// a disc facing +z (a sign board), n sides, thickness t
const lpDisc = (r, t, c, rim) => new LPM().prism(Array.from({ length: 14 }, (_, k) => [Math.cos(k / 14 * Math.PI * 2) * r, Math.sin(k / 14 * Math.PI * 2) * r]), 'z', 0, t, rim || c, { cap: c });

LP_MODELS.library = () => {
  const m = new LPM(), x0 = -50, x1 = 49, z0 = -38, z1 = 37, yE = 80, S = LPC.stone;
  lpBody(m, x0, x1, z0, z1, yE, 0, 'x', S, { top: LPC.stoneDk });
  lpPlinth(m, x0, x1, z0, z1, 5);
  lpBand(m, x0, x1, z0, z1, 39, 3, 1.2); lpBand(m, x0, x1, z0, z1, 76, 4, 2, LPC.stoneLt);
  for (const [x, s] of [[x0, -1], [x1, 1]]) { lpQuoins(m, x, z1, z0, 5, 76, s, LPC.stoneLt); }
  m.roof({ x0, x1, z0, z1, yE: 80, yR: 104, ridge: 'x', hip: .55, over: 4, t: 2.5, c: LPC.roof });
  lpOn(m, lpDoor(18, 28, { arch: 1, double: 1, frame: LPC.stoneLt }), 'front', 0, 5, z1);
  m.box(-14, 0, z1, 14, 2, z1 + 6, LPC.stoneDk, { top: LPC.stone });   // the steps
  m.box(-11, 2, z1, 11, 3.6, z1 + 3, LPC.stoneDk, { top: LPC.stone });
  for (const side of ['front', 'back']) for (const u of side === 'front' ? [-28, 28] : [-28, 0, 28]) { lpOn(m, lpWindow(10, 17, { arch: 1, frame: LPC.stoneLt, sill: LPC.stoneLt }), side, u, 14, side === 'front' ? z1 : z0); }
  for (const side of ['front', 'back']) for (const u of [-28, 0, 28]) lpOn(m, lpWindow(10, 16, { arch: 1, frame: LPC.stoneLt }), side, u, 52, side === 'front' ? z1 : z0);
  for (const side of ['left', 'right']) for (const u of [-18, 18]) for (const y of [14, 52]) lpOn(m, lpWindow(9, 15, { arch: 1, frame: LPC.stoneLt }), side, u, y, side === 'right' ? x1 : x0);
  // the bell cote over the door: a little gabled tower on the roof's front, its bell in an arch
  const bz0 = 22, bz1 = z1 + 1;
  m.box(-9, 74, bz0, 9, 98, bz1, LPC.stoneLt, { top: LPC.stone });
  m.roof({ x0: -9, x1: 9, z0: bz0, z1: bz1, yE: 98, yR: 107, ridge: 'z', over: 1.5, t: 1.5, c: LPC.roof, ends: 1 });
  m.prism([[-9, 98], [9, 98], [0, 107]], 'z', bz1 - 1, bz1, LPC.stoneLt);
  m.box(-5, 84, bz1 - 3, 5, 95, bz1 + .05, 0x2e2622);
  m.lathe(0, bz1 - 1.5, [[1, 86.5], [3.2, 87.5], [3.6, 89], [2.6, 92], [1.2, 93.2]], 8, LPC.gold, { top: LPC.gold });
  lpOn(m, lpRound(2.2, 3.4, { cross: 1 }), 'front', 0, 101.5, bz1);
  return m;
};

LP_MODELS.bakery = () => {
  const m = new LPM(), x0 = -44, x1 = 47, z0 = -30, z1 = 30, yE = 40, yR = 69, xm = (x0 + x1) / 2, W = LPC.plaster;
  lpBody(m, x0, x1, z0, z1, yE, yR, 'z', W);
  lpPlinth(m, x0, x1, z0, z1, 5);
  for (const [x, s] of [[x0, -1], [x1, 1]]) lpQuoins(m, x, z1, z0, 5, yE, s, LPC.stoneLt);
  lpBand(m, x0, x1, z0, z1, yE - 1, 2.5, 1.5, LPC.stoneLt);
  m.roof({ x0, x1, z0, z1, yE, yR, ridge: 'z', over: 4, t: 2.5, c: LPC.roof });
  // the shop window, bread on two shelves, lit from inside; its sill; the awning over it
  lpOn(m, lpWindow(44, 15, { frame: LPC.wood, sill: LPC.stoneLt }), 'front', -13.5, 9, z1);
  for (const [y, n] of [[10.2, 6], [15.8, 6]]) { m.box(-35, y - 1.2, z1 + .2, 8, y - .4, z1 + 2.2, LPC.woodDk); for (let i = 0; i < n; i++) m.blob(-32 + i * 7.2, y + 1.5, z1 + 3, 2.2, i % 2 ? LPC.bread : lpShade(LPC.bread, 1.1), { seed: i * 3 + y, sy: .6, jit: .1, facej: .02 }); }
  lpOn(m, lpAwning(54, 6, 9, LPC.awnGreen, LPC.awnCream), 'front', -13.5, 32, z1);
  lpOn(m, lpDoor(15, 23, { arch: 1, frame: LPC.stoneLt }), 'front', 29.5, 5, z1);
  lpOn(m, lpRound(4, 6, { cross: 1 }), 'front', xm, 54, z1);
  for (const side of ['left', 'right']) for (const u of [-14, 12]) lpOn(m, lpWindow(9, 11, { shutters: LPC.shutter }), side, u, 18, side === 'right' ? x1 : x0);
  lpOn(m, lpWindow(10, 12, { shutters: LPC.shutter }), 'back', 20, 18, z0);
  lpChimney(m, 32.5, -16, 9, 10, 50, 72);
  // the bread sign on an iron bracket at the corner: a round board with a loaf on it
  m.box(x0 - 9, 32.5, z1 - 2, x0, 33.6, z1 - 1, LPC.iron);
  m.box(x0 - 7.6, 30, z1 - 1.8, x0 - 7, 33, z1 - 1.2, LPC.iron).box(x0 - 2.6, 30, z1 - 1.8, x0 - 2, 33, z1 - 1.2, LPC.iron);
  m.add(lpDisc(5.6, 1.8, LPC.cream, LPC.wood), { x: x0 - 5, y: 25, z: z1 - 2.4 });
  m.blob(x0 - 5, 25, z1 - .2, 2.6, LPC.bread, { seed: 9, sy: .55, jit: .08 });
  return m;
};

LP_MODELS.shop = () => {
  const m = new LPM(), x0 = -38, x1 = 43, z0 = -32, z1 = 28, yE = 59, yR = 73, W = LPC.cream;
  lpBody(m, x0, x1, z0, z1, yE, yR, 'x', W);
  m.box(x0 - .3, 0, z0 - .3, x1 + .3, 30, z1 + .3, LPC.stoneLt, { top: LPC.stone });   // the stone ground floor
  lpPlinth(m, x0, x1, z0, z1, 4);
  lpBand(m, x0, x1, z0, z1, 30, 2, 1, LPC.stone);
  for (const [x, s] of [[x0, -1], [x1, 1]]) lpQuoins(m, x, z1, z0, 32, yE, s, LPC.stoneLt);
  m.roof({ x0, x1, z0, z1, yE, yR, ridge: 'x', over: 3.5, t: 2.5, c: LPC.roof });
  lpChimney(m, -26.5, 6, 7, 8, 62, 82);
  for (const u of [-19, 15.5]) lpOn(m, lpWindow(12, 13, { shutters: LPC.shutter, flowers: 1 }), 'front', u, 40, z1);
  for (const u of [-19, 15.5]) lpOn(m, lpWindow(11, 12, { shutters: LPC.shutter }), 'back', u, 40, z0);
  for (const side of ['left', 'right']) lpOn(m, lpWindow(10, 12, { shutters: LPC.shutter }), side, 0, 40, side === 'right' ? x1 : x0);
  // the shop window full of goods, the awning over it, the door
  lpOn(m, lpWindow(40, 18, { frame: LPC.woodDk, dark: 0 }), 'front', -7.5, 8, z1);
  const goods = [LPC.red, LPC.gold, LPC.awnGreen, LPC.bread, LPC.blue, LPC.cream, LPC.red, LPC.leaf];
  for (let i = 0; i < 8; i++) m.box(-26 + i * 4.6, 9, z1 + .3, -23 + i * 4.6, 12 + (i % 3), z1 + 2.4, goods[i]);
  for (let i = 0; i < 6; i++) m.blob(-24 + i * 6.4, 17.5, z1 + 1.2, 1.9, goods[(i + 3) % 8], { seed: i + 21, sy: .9, jit: .1 });
  lpOn(m, lpAwning(52, 6, 7, LPC.awnGreen, LPC.awnCream), 'front', -6, 34, z1);
  lpOn(m, lpDoor(11, 24, { frame: LPC.woodDk }), 'front', 28.5, 2, z1);
  // the key hanging from its bracket
  m.box(x0 - 10, 50, z1 - 2, x0, 51.2, z1 - 1, LPC.iron).box(x0 - 7.5, 45, z1 - 1.8, x0 - 7, 50, z1 - 1.2, LPC.iron);
  m.add(lpDisc(3.6, 1.4, LPC.gold, lpShade(LPC.gold, .8)), { x: x0 - 7.2, y: 42, z: z1 - 2.2 });
  m.box(x0 - 7.8, 31, z1 - 1.8, x0 - 6.6, 39, z1 - .8, LPC.gold).box(x0 - 6.6, 32, z1 - 1.8, x0 - 4.4, 33.2, z1 - .8, LPC.gold).box(x0 - 6.6, 34.6, z1 - 1.8, x0 - 5, 35.8, z1 - .8, LPC.gold);
  for (const [x, c] of [[x0 + 3, 0xe0503a], [x1 - 3, LPC.leaf]]) { m.frustum(x, z1 + 3, 2.4, 3.2, 0, 4.5, 8, 0xb5603c, { top: 0x5a3a24 }); m.blob(x, 7, z1 + 3, 3.2, c === LPC.leaf ? LPC.leaf : LPC.leafDk, { seed: x | 0, sy: 1.1 }); if (c !== LPC.leaf) m.blob(x, 8.5, z1 + 4.4, 1.2, c, { seed: 3 }); }
  m.lathe(x0 + 6, z1 + 6, [[3.4, 0], [4, 3], [4, 8], [3.4, 11]], 10, LPC.wood, { top: LPC.woodLt, col: (b, k) => (k % 2 ? LPC.wood : LPC.woodLt) });   // a barrel by the corner
  return m;
};

LP_MODELS.house_a = () => {
  const m = new LPM(), x0 = -26, x1 = 25, z0 = -28, z1 = 21, yE = 64, yR = 80, W = 0xe8bf62;
  lpBody(m, x0, x1, z0, z1, yE, yR, 'x', W);
  m.box(x0 - .3, 0, z0 - .3, x1 + .3, 9, z1 + .3, LPC.stone, { top: LPC.stoneLt });
  lpBand(m, x0, x1, z0, z1, 34, 1.6, .8, LPC.plasterHi);
  for (const [x, s] of [[x0, -1], [x1, 1]]) lpQuoins(m, x, z1, z0, 9, yE, s, LPC.stoneLt);
  m.roof({ x0, x1, z0, z1, yE, yR, ridge: 'x', over: 3, t: 2.5, c: LPC.roof });
  lpChimney(m, -19, 13, 6, 7, 66, 88);
  lpOn(m, lpDoor(11, 22, { arch: 1, frame: LPC.stoneLt }), 'front', -.5, 1, z1);
  for (const u of [-14, 13]) lpOn(m, lpWindow(9, 11, { shutters: LPC.shutter, flowers: u > 0 }), 'front', u, 40, z1);
  lpOn(m, lpWindow(9, 10, { shutters: LPC.shutter }), 'front', -14, 13, z1);
  for (const u of [-12, 12]) lpOn(m, lpWindow(8, 10, { shutters: LPC.shutter }), 'back', u, 40, z0);
  for (const side of ['left', 'right']) for (const y of [16, 42]) lpOn(m, lpWindow(8, 10, { shutters: LPC.shutter }), side, -4, y, side === 'right' ? x1 : x0);
  lpOn(m, lpWindow(6, 7, {}), 'front', 0, 52, z1);
  m.box(x1 - 3, 1, z1, x1 - 1, 30, z1 + 1.2, LPC.leafDk);   // a climbing vine at the corner, and a lamp by the door
  for (let y = 4; y < 30; y += 4.5) m.blob(x1 - 2 + Math.sin(y) * 1.5, y, z1 + 1.4, 2.2, y % 9 > 4 ? LPC.leaf : LPC.leafDk, { seed: y | 0, jit: .2 });
  m.box(10, 18, z1, 11, 22, z1 + 2.5, LPC.iron).box(9, 13.5, z1 + 1.5, 12, 17.5, z1 + 3.5, LPC.glass, { f: { glow: 1 } });
  m.frustum(18, z1 + 3, 2, 2.8, 0, 4, 8, 0xb5603c, { top: 0x5a3a24 }); m.blob(18, 6.6, z1 + 3, 3, LPC.leafDk, { seed: 4, sy: 1.3 });
  return m;
};

LP_MODELS.house_b = () => {
  const m = new LPM(), x0 = -43, x1 = 41, z0 = -22, z1 = 20, yE = 37, yR = 58, xm = (x0 + x1) / 2, W = LPC.cream;
  lpBody(m, x0, x1, z0, z1, yE, yR, 'z', W);
  lpPlinth(m, x0, x1, z0, z1, 4);
  for (const [x, s] of [[x0, -1], [x1, 1]]) lpQuoins(m, x, z1, z0, 4, yE, s, LPC.stone);
  m.roof({ x0, x1, z0, z1, yE, yR, ridge: 'z', over: 3, t: 2.5, c: LPC.roof });
  lpOn(m, lpRound(4.2, 6.2, { cross: 1 }), 'front', xm, 44, z1);
  for (const u of [-25, 23]) lpOn(m, lpWindow(11, 11, { shutters: LPC.shutter, flowers: 1 }), 'front', u, 13, z1);
  for (const u of [-24, 0, 22]) lpOn(m, lpWindow(10, 10, { shutters: LPC.shutter }), 'back', u, 13, z0);
  for (const side of ['left', 'right']) lpOn(m, lpWindow(9, 10, { shutters: LPC.shutter }), side, 0, 13, side === 'right' ? x1 : x0);
  lpOn(m, lpDoor(12, 22, { frame: LPC.stoneLt }), 'front', -1, 2, z1);
  // the little tiled roof over the door on two brackets
  m.roof({ x0: -14, x1: 12, z0: z1, z1: z1 + 7, yE: 28.5, yR: 32, ridge: 'x', over: 1, t: 1.5, c: LPC.roof, cap: false, ends: 1 });
  for (const x of [-12, 10]) m.box(x - .6, 26, z1, x + .6, 28.5, z1 + 6, LPC.woodDk);
  for (const [x, c] of [[-38, LPC.leaf], [-12, 0xe05a8a], [10, LPC.leafDk], [36, 0xf2d24a]]) { m.frustum(x, z1 + 3.5, 2.2, 3, 0, 4, 8, 0xb5603c, { top: 0x5a3a24 }); m.blob(x, 6.4, z1 + 3.5, 3, c === LPC.leaf || c === LPC.leafDk ? c : LPC.leaf, { seed: x + 50, sy: 1.1 }); if (c !== LPC.leaf && c !== LPC.leafDk) for (let k = 0; k < 3; k++) m.blob(x - 1.5 + k * 1.5, 8 + (k % 2), z1 + 5, .9, c, { seed: k }); }
  return m;
};

LP_MODELS.church = () => {
  const m = new LPM(), S = LPC.stoneLt, nx0 = -42, nx1 = 19, nz0 = -9, nz1 = 43, xm = (nx0 + nx1) / 2;
  // the nave, its gable to the front, buttresses at the corners, a pediment over the door
  lpBody(m, nx0, nx1, nz0, nz1, 65, 85, 'z', S);
  lpPlinth(m, nx0, nx1, nz0, nz1, 4, LPC.stone);
  m.roof({ x0: nx0, x1: nx1, z0: nz0, z1: nz1, yE: 65, yR: 85, ridge: 'z', over: 3, t: 2.5, c: LPC.roof });
  for (const x of [nx0 - 3, nx1]) m.box(x, 0, nz1 - 6, x + 3, 50, nz1 + 2, LPC.stone, { top: LPC.stoneDk });
  for (const z of [10, 26]) for (const x of [nx0 - 2.5, nx1]) m.box(x, 0, z, x + 2.5, 44, z + 4, LPC.stone, { top: LPC.stoneDk });
  lpOn(m, lpDoor(14, 26, { arch: 1, double: 1, frame: LPC.stone }), 'front', xm, 2, nz1);
  m.prism([[xm - 12, 33], [xm + 12, 33], [xm, 41]], 'z', nz1, nz1 + 2.5, LPC.stone);
  m.box(xm - 11, 31, nz1, xm + 11, 33, nz1 + 2.5, LPC.stone);
  for (const x of [xm - 10, xm + 10]) m.box(x - 1.3, 2, nz1, x + 1.3, 31, nz1 + 2.2, LPC.stone);
  lpOn(m, lpRound(7.5, 10.5, { cross: 1, c: LPC.stone }), 'front', xm, 54, nz1);
  for (const u of [xm - 17, xm + 17]) lpOn(m, lpWindow(4.5, 13, { arch: 1, frame: LPC.stone }), 'front', u, 42, nz1);
  for (const side of ['left', 'right']) for (const u of [-24, -2, 20]) lpOn(m, lpWindow(5, 16, { arch: 1, frame: LPC.stone }), side, side === 'left' ? u + 17 : -(u + 17), 28, side === 'right' ? nx1 : nx0);
  m.box(xm - .8, 85, nz1 - 1, xm + .8, 96, nz1 + .6, LPC.iron).box(xm - 3.5, 91, nz1 - 1, xm + 3.5, 92.6, nz1 + .6, LPC.iron);
  // the bell tower, set back on the right: openings with the bell, a pyramid roof and a cross
  const tx0 = 20, tx1 = 43, tz0 = -41, tz1 = -6, tm = (tx0 + tx1) / 2;
  m.box(tx0, 0, tz0, tx1, 106, tz1, S, { top: LPC.stone });
  lpPlinth(m, tx0, tx1, tz0, tz1, 4, LPC.stone);
  for (const y of [40, 80, 102]) lpBand(m, tx0, tx1, tz0, tz1, y, 2, .8, LPC.stone);
  m.roof({ x0: tx0, x1: tx1, z0: tz0, z1: tz1, yE: 106, yR: 122, ridge: 'x', hip: 1, over: 2.5, t: 2, c: LPC.roof });
  for (const side of ['front', 'back', 'left', 'right']) {
    // (u: the world x on the front and back, the world z on the left, minus it on the right: see lpOn)
    const plane = side === 'front' ? tz1 : side === 'back' ? tz0 : side === 'right' ? tx1 : tx0, zc = (tz0 + tz1) / 2, u = side === 'front' || side === 'back' ? tm : side === 'left' ? zc : -zc;
    lpOn(m, lpWindow(10, 14, { arch: 1, frame: LPC.stone, dark: 1 }), side, u, 84, plane);
    lpOn(m, lpWindow(3.5, 7, { arch: 1, frame: LPC.stone }), side, u, 56, plane);
  }
  m.lathe(tm, (tz0 + tz1) / 2, [[1.4, 85.5], [5.5, 86.5], [6, 89], [4.2, 94], [1.6, 96]], 10, LPC.gold, { top: LPC.gold });
  m.box(tm - .8, 121, (tz0 + tz1) / 2 - .8, tm + .8, 132, (tz0 + tz1) / 2 + .8, LPC.iron).box(tm - 3.5, 127, (tz0 + tz1) / 2 - .8, tm + 3.5, 128.6, (tz0 + tz1) / 2 + .8, LPC.iron);
  lpOn(m, lpDoor(7, 12, { arch: 1, frame: LPC.stone }), 'front', tm, 2, tz1);
  // a low chapel on the left, a lean-to behind the tower on the right
  m.box(-50, 0, 17, nx0, 35, 41, S); m.roof({ x0: -50, x1: nx0, z0: 17, z1: 41, yE: 35, yR: 41, ridge: 'z', over: 1.5, t: 1.5, c: LPC.roofOld, hip: 0, ends: 1 });
  lpOn(m, lpWindow(4, 10, { arch: 1, frame: LPC.stone }), 'left', 29, 14, -50);
  m.box(tx1, 0, -43, 49, 21, -10, S); m.roof({ x0: tx1, x1: 49, z0: -43, z1: -10, yE: 21, yR: 27, ridge: 'z', over: 1.5, t: 1.5, c: LPC.roofOld });
  return m;
};

LP_MODELS.windmill = () => {
  const m = new LPM(), cx = -1, cz = 0, n = 16, W = LPC.cream;
  // the tower: whitewashed stone, tapering, a band of darker stone at its foot and under the cap
  m.lathe(cx, cz, [[29, 0], [28.6, 6], [27, 30], [25, 56], [23.5, 73]], n, W, { top: false, col: (b, k) => (b === 0 ? LPC.stone : (k + b) % 5 === 0 ? lpShade(W, .95) : W) });
  m.frustum(cx, cz, 25, 24.5, 70, 74, n, LPC.stone, { top: false });
  // the cap: a cone of shingles in courses, a little finial
  const rings = [[32, 72.5], [28, 79], [23.5, 86], [18, 93], [12.5, 100], [7, 106], [2.5, 111], [0, 113]];
  for (let b = 0; b + 1 < rings.length; b++) m.frustum(cx, cz, rings[b][0], rings[b + 1][0], rings[b][1], rings[b + 1][1], n, b % 2 ? 0xa4583a : 0xb7683e, { top: false, rot: b % 2 ? Math.PI / n : 0 });
  m.frustum(cx, cz, 32, 32, 71, 72.5, n, 0x7a432c, { top: false });
  m.box(cx - .8, 112, cz - .8, cx + .8, 118, cz + .8, LPC.iron);
  // the door and windows on the round wall (set on the tangent plane)
  m.add(lpDoor(11, 19, { arch: 1, frame: LPC.stone }), { x: cx, y: 1, z: cz + 28.4 });
  for (const [a, y] of [[0, 44], [Math.PI * .75, 30], [-Math.PI * .7, 52], [Math.PI, 40]]) m.add(lpWindow(5, 7, { arch: 1, frame: LPC.stone }), { x: cx + Math.sin(a) * (26.6 - (y - 30) * .06), y, z: cz + Math.cos(a) * (26.6 - (y - 30) * .06), ry: a });
  // the sails: four lattice arms on a hub, cloth on one side of each, standing out on the front
  const hub = [cx, 82], zS = 33;
  m.prism(Array.from({ length: 8 }, (_, k) => [hub[0] + Math.cos(k / 8 * Math.PI * 2) * 3, hub[1] + Math.sin(k / 8 * Math.PI * 2) * 3]), 'z', 26, zS + 2, LPC.woodDk);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), L = 46, R2 = (u, v) => [hub[0] + ca * u - sa * v, hub[1] + sa * u + ca * v];
    const quad = (u0, u1, v0, v1, z, c, th) => { const p = [R2(u0, v0), R2(u1, v0), R2(u1, v1), R2(u0, v1)]; m.face(p.map(([x, y]) => [x, y, z + th]), c, { from: [hub[0], hub[1], z - 5], jit: .02 }); m.face(p.map(([x, y]) => [x, y, z]), lpShade(c, .85), { from: [hub[0], hub[1], z + 9] }); };
    quad(2, L, -1, 1, zS, LPC.woodDk, 1.4);                     // the spar
    quad(10, L - 1, 1, 11, zS - .6, LPC.awnCream, .4);          // the cloth
    for (let u = 12; u < L; u += 7) quad(u, u + .9, 1, 11.5, zS + .2, LPC.wood, .8);   // its battens
    quad(10, L - 1, 10.4, 11.6, zS + .2, LPC.wood, .8);
  }
  return m;
};

// ---- content/lowpoly/03-props.js
/* ---------- lowpoly.html: props and plants ---------- */
// Foliage is lit by its own height: lighter on top, darker underneath, as a canopy reads in late light.
const lpLeaf = (lo, hi, a, b, c) => (p) => { const t = (p[1] - lo) / Math.max(1, hi - lo); return t > .66 ? a : t > .33 ? b : c; };

LP_MODELS.oak = () => {
  const m = new LPM(), L = lpLeaf(30, 99, LPC.leafLt, LPC.leaf, LPC.leafDk);
  m.lathe(0, 0, [[6, 0], [4.6, 6], [3.6, 30], [3, 44]], 7, LPC.trunk, { top: false });
  for (const [x, y, z, r, s] of [[0, 72, 0, 26, 1], [-22, 60, 4, 18, 2], [22, 62, -2, 19, 3], [-8, 86, -4, 16, 4], [12, 82, 6, 15, 5], [0, 58, 12, 15, 6]]) m.blob(x, y, z, r, LPC.leaf, { seed: s * 13, sy: .82, jit: .16, col: L, flat: y - r * .6, facet: 1 });
  return m;
};
LP_MODELS.olive = () => {
  const m = new LPM(), L = lpLeaf(24, 70, 0xa9b874, LPC.olive, 0x6e8448);
  m.lathe(0, 0, [[5, 0], [3.4, 10], [3.8, 22], [2.4, 34]], 6, 0x7d6a54, { top: false });
  for (const [x, y, z, r, s] of [[0, 50, 0, 20, 1], [-16, 44, 3, 13, 2], [15, 46, -3, 14, 3], [3, 62, 2, 12, 4]]) m.blob(x, y, z, r, LPC.olive, { seed: s * 7, sy: .75, jit: .2, col: L, flat: y - r * .5, facet: 1 });
  return m;
};
LP_MODELS.cypress = () => {
  const m = new LPM(), n = 7;
  m.lathe(0, 0, [[2.6, 0], [2, 8]], 6, LPC.trunk, { top: false });
  const prof = [[4, 5], [8.5, 18], [10.5, 34], [10, 52], [8.4, 70], [6, 88], [3.4, 102], [0, 114]];
  for (let b = 0; b + 1 < prof.length; b++) m.frustum(0, 0, prof[b][0], prof[b + 1][0], prof[b][1], prof[b + 1][1], n, LPC.cypress, { top: false, smooth: false, rot: b * .45, col: (k) => ((k + b) % 3 === 0 ? LPC.cypressDk : (k + b) % 3 === 1 ? LPC.cypress : lpShade(LPC.cypress, 1.12)) });
  m.face(Array.from({ length: n }, (_, k) => { const t = k / n * Math.PI * 2; return [Math.sin(t) * 4, 5, Math.cos(t) * 4]; }), LPC.cypressDk, { from: [0, 20, 0] });
  return m;
};
LP_MODELS.bush = () => {
  const m = new LPM(), L = lpLeaf(0, 36, LPC.leafLt, LPC.leaf, LPC.leafDk);
  for (const [x, y, z, r, s] of [[-12, 13, 2, 14, 1], [11, 12, -2, 15, 2], [0, 20, 0, 15, 3], [-2, 11, 9, 11, 4]]) m.blob(x, y, z, r, LPC.leaf, { seed: s * 17, sy: .85, jit: .16, col: L, flat: 0, facet: 1 });
  for (const [x, y, z, c] of [[-14, 22, 10, 0xf4efe6], [6, 26, 8, 0xe9a3b6], [14, 18, 9, 0xf4efe6], [-4, 29, 3, 0xe9a3b6]]) m.blob(x, y, z, 1.4, c, { seed: x + 40, jit: .1 });
  return m;
};
LP_MODELS.vine_row = () => {
  const m = new LPM(), L = lpLeaf(10, 50, LPC.leafLt, LPC.leaf, LPC.leafDk);
  for (const x of [-62, 0, 62]) m.box(x - 1.3, 0, -1.3, x + 1.3, 46, 1.3, LPC.woodDk);
  for (const y of [24, 40]) m.box(-62, y - .4, -.4, 62, y + .4, .4, LPC.iron);
  for (let i = 0; i < 8; i++) { const x = -54 + i * 15.5; m.box(x - 1, 0, -1, x + 1, 26, 1, LPC.trunk); m.blob(x, 34, 0, 11, LPC.leaf, { seed: i * 11 + 2, sy: .8, jit: .18, col: L, flat: 18, facet: 1 }); for (let g = 0; g < 2; g++) m.blob(x - 4 + g * 7, 23, 7 - g * 2, 2.6, LPC.grape, { seed: i * 3 + g, sy: 1.3, jit: .12 }); }
  return m;
};
LP_MODELS.fence = () => {
  const m = new LPM(), W = LPC.woodLt;
  for (const x of [-19, 0, 19]) { m.box(x - 1.4, 0, -1.4, x + 1.4, 17, 1.4, W, { top: lpShade(W, .85) }); m.prism([[x - 1.4, 17], [x + 1.4, 17], [x, 19.5]], 'z', -1.4, 1.4, W); }
  for (const y of [6, 13]) m.box(-20.5, y - 1.2, -.6, 20.5, y + 1.2, 1.4, lpShade(W, .9));
  return m;
};
LP_MODELS.well = () => {
  const m = new LPM();
  m.lathe(0, 0, [[12.5, 0], [12.5, 13], [11, 14.5]], 12, LPC.stone, { top: false, col: (b, k) => (k % 2 ? LPC.stone : LPC.stoneLt) });
  m.frustum(0, 0, 9.5, 9.5, 10, 14.5, 12, LPC.stoneDk, { top: false });
  m.frustum(0, 0, 9.5, 9.5, 9.6, 10, 12, 0x2c5a78, { top: 0x356f92 });   // the water
  for (const x of [-11, 11]) m.box(x - 1.4, 13, -1.4, x + 1.4, 34, 1.4, LPC.woodDk);
  m.roof({ x0: -12, x1: 12, z0: -8, z1: 8, yE: 34, yR: 43, ridge: 'x', over: 2.5, t: 1.6, c: LPC.roof, ends: 1 });
  m.box(-11, 27, -.6, 11, 28.2, .6, LPC.wood);   // the axle, the rope, the bucket, the crank
  m.box(-.3, 17, -.3, .3, 27, .3, 0xc8b48a);
  m.lathe(0, 0, [[2.2, 14], [2.8, 18]], 8, LPC.wood, { top: 0x4a3020 });
  m.box(11, 26, -.5, 15, 27, .5, LPC.iron).box(14.4, 22, -.5, 15.4, 27, .5, LPC.iron);
  return m;
};
LP_MODELS.lamp_post = () => {
  const m = new LPM(), I = LPC.iron;
  m.lathe(0, 0, [[3.2, 0], [3.2, 2], [2, 3], [1.2, 5], [1, 32], [1.6, 33.5]], 8, I, { top: I });
  m.box(-2.6, 33.5, -2.6, 2.6, 34.5, 2.6, I);
  m.frustum(0, 0, 2.6, 3.4, 34.5, 40.5, 6, LPC.glass, { top: false, glow: 1, smooth: false });
  for (let k = 0; k < 6; k++) { const t = k / 6 * Math.PI * 2; m.box(Math.sin(t) * 3.1 - .35, 34.5, Math.cos(t) * 3.1 - .35, Math.sin(t) * 3.1 + .35, 40.5, Math.cos(t) * 3.1 + .35, I); }
  m.frustum(0, 0, 4.4, 0, 40.5, 44, 6, I, { smooth: false });
  return m;
};
LP_MODELS.bench = () => {
  const m = new LPM(), S = LPC.stoneLt;
  m.box(-17, 8, -6, 17, 10.5, 5, S, { top: lpShade(S, 1.06) });
  for (const x of [-13, 13]) m.box(x - 2.5, 0, -4.5, x + 2.5, 8, 3.5, LPC.stone);
  m.box(-17, 10.5, -7, 17, 18, -5, LPC.wood, { top: LPC.woodLt });
  return m;
};
LP_MODELS.market_stall = () => {
  const m = new LPM();
  for (const [x, z] of [[-18, -9], [18, -9], [-18, 9], [18, 9]]) m.box(x - 1, 0, z - 1, x + 1, z < 0 ? 34 : 28, z + 1, LPC.woodDk);
  m.box(-19, 12, -10, 19, 14, 10, LPC.wood, { top: LPC.woodLt });
  m.box(-19.2, 6, 9.6, 19.2, 14, 10.4, LPC.awnRed);   // the cloth hanging from the table's front
  for (let i = 0; i < 7; i++) m.face([[-19 + i * 38 / 7, 6, 10.4], [-19 + (i + 1) * 38 / 7, 6, 10.4], [-19 + (i + .5) * 38 / 7, 4.5, 10.4]], LPC.awnRed, { from: [0, 8, 0] });
  const fruit = [0xe0503a, 0xf2a83a, 0x8cc35e, 0xe0503a, 0xd99a4c, 0x6a3f7a];
  for (let i = 0; i < 12; i++) m.blob(-15 + (i % 6) * 6, 16.6, -4 + Math.floor(i / 6) * 7, 2.2, fruit[i % 6], { seed: i + 3, jit: .12, sy: .9 });
  m.box(-17, 14, -8, -9, 17, -3, LPC.hay).box(9, 14, 3, 17, 16.5, 8, LPC.woodLt);
  // a striped canopy, sloping to the front
  const n = 8, w = 44, out = 0;
  for (let i = 0; i < n; i++) { const xa = -w / 2 + i * w / n, xb = xa + w / n, c = i % 2 ? LPC.awnCream : LPC.awnRed; m.face([[xa, 28, 13], [xb, 28, 13], [xb, 35, -12], [xa, 35, -12]], c, { from: [0, 20, 0], jit: .02 }); m.face([[xa, 28, 13], [xb, 28, 13], [(xa + xb) / 2, 25.5, 13]], c, { from: [0, 30, 0] }); }
  m.face([[-w / 2, 28, 13], [-w / 2, 35, -12], [-w / 2, 28, -12]], lpShade(LPC.awnRed, .85), { from: [0, 30, 0] }).face([[w / 2, 28, 13], [w / 2, 35, -12], [w / 2, 28, -12]], lpShade(LPC.awnRed, .85), { from: [0, 30, 0] });
  return m;
};
LP_MODELS.reading_desk = () => {
  const m = new LPM(), W = LPC.wood, a = .62, ca = Math.cos(a), sa = Math.sin(a);
  m.box(-6, 0, -5, 6, 2.5, 5, LPC.woodDk).box(-2.2, 2.5, -2.2, 2.2, 15, 2.2, W);
  // the board in its own frame (x across, y out of the board, z down its slope toward the reader), then tilted
  const b = new LPM();
  b.box(-11, -1.6, -7, 11, 0, 7, LPC.woodLt, { skip: [] }).box(-11, 0, 5.6, 11, 1.6, 7, W);
  b.box(-9.6, 0, -5.6, -.3, 1, 5, 0xf6efdc, { f: { glow: 1 } }).box(.3, 0, -5.6, 9.6, 1, 5, 0xefe5cc, { f: { glow: 1 } }).box(-.5, 0, -5.8, .5, 1.3, 5.2, LPC.red);
  for (let k = 0; k < 4; k++) b.box(-8, 1, -3.6 + k * 2.2, -2, 1.1, -3.1 + k * 2.2, 0x9a8c74).box(2, 1, -3.6 + k * 2.2, 8, 1.1, -3.1 + k * 2.2, 0x9a8c74);
  for (const f of b.f) m.f.push(Object.assign({}, f, { p: f.p.map(([x, y, z]) => [x, 16.5 + y * ca - z * sa, y * sa + z * ca]) }));
  return m;
};
LP_MODELS.statue = () => {
  const m = new LPM(), S = 0xcfc6b3, D = LPC.stone;
  m.box(-10, 0, -9, 10, 4, 9, D, { top: lpShade(D, 1.08) }).box(-8, 4, -7, 8, 14, 7, S).box(-9, 14, -8, 9, 16, 8, D, { top: lpShade(D, 1.08) });
  // a scholar cat in stone, sitting, a book under its paw
  m.blob(0, 22, -1, 6.5, S, { seed: 31, sy: 1.15, jit: .06 });
  m.blob(0, 32, 0, 5.2, S, { seed: 32, jit: .06 });
  for (const s of [-1, 1]) m.face([[s * 4.5, 35, -.5], [s * 1.5, 36.5, -.5], [s * 3.6, 41, -1]], S, { from: [s * 3, 37, -4] }).face([[s * 4.5, 35, -.5], [s * 1.5, 36.5, -.5], [s * 3.6, 41, -1]], lpShade(S, .9), { from: [s * 3, 37, 4] });
  m.lathe(5, -6, [[2, 16], [1.6, 21], [1.2, 26]], 6, S, { top: false });
  m.box(-6, 16, 3, 2, 18, 9, LPC.stone, { top: S });
  return m;
};
LP_MODELS.barrel = () => {
  const m = new LPM();
  m.lathe(0, 0, [[7.6, 0], [8.8, 6], [9.2, 12.5], [8.8, 19], [7.6, 25]], 12, LPC.wood, { top: 0x6a4428, col: (b, k) => (k % 2 ? LPC.wood : LPC.woodLt) });
  for (const y of [3.5, 21]) m.frustum(0, 0, 8.4, 8.4, y, y + 1.2, 12, LPC.iron, { top: false });
  m.frustum(0, 0, 9.4, 9.4, 11.8, 13.2, 12, LPC.iron, { top: false });
  return m;
};
LP_MODELS.crate = () => {
  const m = new LPM(), W = LPC.woodLt, D = LPC.wood;
  m.box(-9, 0, -6.5, 9, 15, 6.5, W, { top: lpShade(W, 1.05) });
  for (const [x0, x1] of [[-9.4, -7], [7, 9.4]]) m.box(x0, 0, -6.9, x1, 15.4, 6.9, D);
  m.box(-9.4, 0, -6.9, 9.4, 2, 6.9, D).box(-9.4, 13.4, -6.9, 9.4, 15.4, 6.9, D);
  m.face([[-7, 2, 6.8], [-4.6, 2, 6.8], [7, 13.4, 6.8], [4.6, 13.4, 6.8]], D, { from: [0, 8, 0] });
  return m;
};
LP_MODELS.signpost = () => {
  const m = new LPM(), W = LPC.woodLt;
  m.box(-1.6, 0, -1.6, 1.6, 31, 1.6, LPC.woodDk);
  m.frustum(0, 0, 2.6, 0, 31, 34, 4, LPC.iron, { rot: Math.PI / 4, smooth: false });
  const arrow = (y, dir, len) => m.prism([[0, y], [dir * len, y], [dir * (len + 4), y + 2.8], [dir * len, y + 5.6], [0, y + 5.6]].map(([u, v]) => [u * 1, v]), 'z', 1.6, 3.2, W, { cap: W });
  arrow(22, 1, 9); arrow(14, -1, 8);
  return m;
};
LP_MODELS.lever = () => {
  const m = new LPM();
  m.box(-7, 0, -7, 7, 5, 7, LPC.stone, { top: LPC.stoneLt }).box(-3, 5, -2, 3, 9, 2, LPC.iron);
  const arm = (x, y, z) => [x, 7 + y * .82 - z * .57, z * .82 + y * .57];
  m.face([arm(-1, 0, -1), arm(1, 0, -1), arm(1, 20, -1), arm(-1, 20, -1)], LPC.wood, { from: arm(0, 10, 3) }).face([arm(-1, 0, 1), arm(1, 0, 1), arm(1, 20, 1), arm(-1, 20, 1)], LPC.wood, { from: arm(0, 10, -3) });
  m.face([arm(-1, 0, -1), arm(-1, 0, 1), arm(-1, 20, 1), arm(-1, 20, -1)], LPC.woodDk, { from: arm(3, 10, 0) }).face([arm(1, 0, -1), arm(1, 0, 1), arm(1, 20, 1), arm(1, 20, -1)], LPC.woodDk, { from: arm(-3, 10, 0) });
  m.blob(...arm(0, 21.5, 0), 2.6, LPC.red, { seed: 5, jit: .05 });
  return m;
};
// the chest, its lid opened `lid` radians about the hinge at the back of its top (the game swings it)
LP_CHEST = (lid) => {
  const m = new LPM(), W = 0x9a6334, I = 0x6d6157, G = LPC.gold, hy = 11, hz = -7;
  m.box(-11, 0, -7, 11, hy, 7, W, { top: 0x3a2618 });
  for (const x of [-8, 8]) m.box(x - 1.2, 0, -7.3, x + 1.2, hy, 7.3, I);
  m.box(-11.3, 0, -7.3, 11.3, 1.4, 7.3, I);
  const lidM = new LPM(), arc = Array.from({ length: 6 }, (_, k) => { const a = k / 5 * Math.PI; return [Math.cos(a) * 7, hy + Math.sin(a) * 5.5]; }).map(([z, y]) => [z, y]);
  lidM.prism(arc.map(([z, y]) => [z, y]), 'x', -11, 11, W, { cap: lpShade(W, .9) });
  for (const x of [-8, 8]) lidM.prism(arc.map(([z, y]) => [z * 1.04, hy + (y - hy) * 1.04]), 'x', x - 1.2, x + 1.2, I);
  lidM.box(-2, hy - 3.5, 7, 2, hy + 1.5, 8, G);
  const c = Math.cos(lid), s = Math.sin(lid);
  for (const f of lidM.f) m.f.push(Object.assign({}, f, { p: f.p.map(([x, y, z]) => [x, hy + (y - hy) * c - (z - hz) * s, hz + (y - hy) * s + (z - hz) * c]) }));
  if (lid) m.box(-9.5, hy - 3, -5.5, 9.5, hy - .2, 5.5, 0x2a1a12, { top: 0x2a1a12 });   // open: the dark inside
  return m;
};

// ---- content/lowpoly/04-figures.js
/* ---------- lowpoly.html: the cat and the people of the village, as parts that move ---------- */
// Figure space is art px: feet at the origin, facing +z. Poses are computed from the game's own state (moving and step,
// the current anim and its time), so nothing in the game logic changes; the same names as the sheet animations.
const lpSin = (t) => Math.sin(t), ease = (t) => t * t * (3 - 2 * t), clamp01 = (v) => Math.max(0, Math.min(1, v));

/* ---- the scholar cat: an orange tabby on two legs, round glasses, a quill for a sword ---- */
{
  const O = 0xe8963c, OD = 0xc46f28, CR = 0xf6e2c2, PK = 0xe79aa6, DK = 0x2e211c, GL = 0x3b2f2a;
  const legs = (s) => new LPM().lathe(s * 3, 0, [[1.5, .6], [1.9, 1.6], [1.8, 3.4], [1.4, 4.8]], 10, O, { top: false }).blob(s * 3, 1, 1.2, 1.7, CR, { seed: 20 + s, sx: 1.05, sy: .62, sz: 1.35, jit: .02 });
  const body = new LPM().blob(0, 8.8, 0, 4.8, O, { seed: 2, sy: 1.12, sz: .9, jit: .03 }).blob(0, 8.3, 2.4, 3.1, CR, { seed: 3, sy: 1.15, sz: .6, jit: .03 }).blob(0, 11.4, 2.6, 2.4, CR, { seed: 19, sx: 1.3, sy: .8, sz: .7, jit: .03 });
  for (const y of [6.5, 9, 11.5]) body.box(-4.4, y, -3.6, 4.4, y + .9, -2.6, OD);   // tabby stripes down the back
  const head = new LPM().blob(0, 17.2, .3, 6, O, { seed: 4, sx: 1.12, sy: .92, jit: .04 })
    .blob(0, 15.4, 4.6, 2.7, CR, { seed: 5, sx: 1.2, sy: .72, sz: .7, jit: .03 })
    .blob(0, 16.3, 6.4, .7, PK, { seed: 6, jit: 0 });
  for (const s of [-1, 1]) {
    head.face([[s * 6, 20, -.5], [s * 2, 21.6, -.5], [s * 4.8, 26, -1.2]], O, { from: [s * 4, 22, -4] }).face([[s * 6, 20, -.5], [s * 2, 21.6, -.5], [s * 4.8, 26, -1.2]], O, { from: [s * 4, 22, 4] });
    head.face([[s * 5.2, 20.6, -.3], [s * 2.8, 21.6, -.3], [s * 4.6, 24.6, -.6]], PK, { from: [s * 4, 22, -4] });
    head.box(s * 2.4 - .6, 17.4, 5.2, s * 2.4 + .6, 18.8, 5.9, DK);   // the eyes, and the round glasses over them
    for (let k = 0; k < 8; k++) { const a0 = k / 8 * Math.PI * 2, a1 = (k + 1) / 8 * Math.PI * 2, r = 2, cx = s * 2.4, cy = 18.1; head.face([[cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, 6.1], [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, 6.1], [cx + Math.cos(a1) * (r + .7), cy + Math.sin(a1) * (r + .7), 6.1], [cx + Math.cos(a0) * (r + .7), cy + Math.sin(a0) * (r + .7), 6.1]], GL, { from: [cx, cy, 0], jit: 0 }); }
    head.box(s * 4.6, 18, 3.8, s * 6.4, 18.5, 6, GL);
  }
  head.box(-.4, 18, 6, .4, 18.5, 6.2, GL);
  for (const s of [-1, 1]) for (let k = 0; k < 2; k++) head.box(s * 4.2 + s * k * .4, 15.2 + k * 1.1, 4.4, s * 7.6, 15.5 + k * 1.1, 4.6, 0xf6efe6);   // whiskers
  const tail = new LPM();
  { tail.sg = 1; const pts = [[0, 6, -3.6], [0, 7.4, -7], [0, 10.8, -9.4], [.4, 14.6, -9.8], [.8, 17.2, -8.4]]; for (let i = 0; i + 1 < pts.length; i++) { const [a, b] = [pts[i], pts[i + 1]], r0 = 1.6 - i * .2, r1 = 1.4 - i * .2, n = 10, ring = (p, r, k) => { const t = k / n * Math.PI * 2; return [p[0] + Math.cos(t) * r, p[1] + Math.sin(t) * r * .7, p[2] + Math.sin(t) * r * .5]; }; for (let k = 0; k < n; k++) tail.face([ring(a, r0, k), ring(a, r0, k + 1), ring(b, r1, k + 1), ring(b, r1, k)], i === 3 ? OD : O, { from: [(a[0] + b[0]) / 2 + 9, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], s: 1, jit: 0 }); } tail.blob(.8, 17.6, -8, 1.3, CR, { seed: 7, jit: 0 }); }
  const arm = (s) => new LPM().lathe(s * 4.2, 0, [[1, 7.4], [1.25, 8.6], [1.3, 11], [1.05, 12.4]], 10, O, { top: false }).blob(s * 4.2, 7.2, .3, 1.45, CR, { seed: 8 + s, jit: 0 });
  // the quill, held in the right paw: a white feather with a dark nib
  const quill = new LPM().box(-.3, 3.5, 1.2, .3, 7.5, 1.8, 0x6a5a48);
  for (let k = 0; k < 5; k++) { const y0 = 7 + k * 2.2, w = 1.4 + Math.sin((k + .5) / 5 * Math.PI) * 1.4; quill.face([[-w, y0, 1.5], [w, y0, 1.5], [w * .8, y0 + 2.4, 1.5 + (k + 1) * .5], [-w * .8, y0 + 2.4, 1.5 + (k + 1) * .5]], k % 2 ? 0xf2ede4 : 0xfaf7f0, { from: [0, y0 + 1, -4], jit: 0 }).face([[-w, y0, 1.4], [w, y0, 1.4], [w * .8, y0 + 2.4, 1.4 + (k + 1) * .5], [-w * .8, y0 + 2.4, 1.4 + (k + 1) * .5]], 0xe2dccf, { from: [0, y0 + 1, 6] }); }
  LP_FIGURES.cat = {
    parts: {
      legL: { m: legs(-1), pivot: [-3, 4.5, 0] }, legR: { m: legs(1), pivot: [3, 4.5, 0] },
      body: { m: body, pivot: [0, 4.5, 0] }, head: { m: head, pivot: [0, 12.5, 0], parent: 'body' }, tail: { m: tail, pivot: [0, 6, -3.6], parent: 'body' },
      armL: { m: arm(-1), pivot: [-4.2, 12, 0], parent: 'body' }, armR: { m: arm(1), pivot: [4.2, 12, 0], parent: 'body' },
      quill: { m: quill, pivot: [4.2, 7, 0], parent: 'armR' },
    },
    pose(a, t) {
      const P0 = {}, walk = a.moving ? a.step * Math.PI / 5 : 0, sw = a.moving ? lpSin(walk) : 0, br = lpSin(t * 2.2);
      P0.legL = { rx: sw * .7 }; P0.legR = { rx: -sw * .7 }; P0.armL = { rx: -sw * .5 }; P0.armR = { rx: sw * .5 - .25 };
      P0.body = { rx: a.moving ? .08 : 0, y: a.moving ? Math.abs(sw) * .7 : br * .15 }; P0.head = { rx: a.moving ? -.06 : br * .03, rz: a.moving ? 0 : lpSin(t * .7) * .05 };
      P0.tail = { rz: lpSin(t * (a.moving ? 6 : 1.8)) * .28, rx: a.moving ? .2 : 0 };
      P0.quill = { rx: .2 };
      const an = a.anim, at = a.at || 0;
      if (an && an.startsWith('attack')) {   // three swipes of the quill: right to left, left to right, overhead
        const p = ease(clamp01(at * (a.fps || 10) / 3)), k = +an.slice(6);
        if (k === 1) { P0.armR = { rx: -1.4, ry: 1.2 - p * 2.6 }; P0.body = { ry: .45 - p * .9 }; }
        else if (k === 2) { P0.armR = { rx: -1.4, ry: -1.3 + p * 2.6 }; P0.body = { ry: -.45 + p * .9 }; }
        else { P0.armR = { rx: -2.8 + p * 2.6 }; P0.body = { rx: -.15 + p * .4 }; P0.root = { y: Math.sin(p * Math.PI) * 2 }; }
        P0.armL = { rx: .3, rz: -.4 }; P0.quill = { rx: .5 };
      } else if (an === 'dodge') { const p = clamp01(at / .32); P0.root = { rx: Math.sin(p * Math.PI) * .5, sy: 1 - Math.sin(p * Math.PI) * .25 }; P0.legL = { rx: -.9 }; P0.legR = { rx: .6 }; P0.tail = { rx: .8 }; }
      else if (an === 'hurt') { const p = clamp01(at / .3); P0.root = { rx: -Math.sin(p * Math.PI) * .35, y: Math.sin(p * Math.PI) * 1.5 }; P0.head = { rx: -.3 }; P0.armL = { rz: -.9 }; P0.armR = { rz: .9 }; }
      else if (an === 'defeat' || an === 'over') { const p = clamp01(at / .6); P0.root = { rz: ease(p) * 1.45, y: p * 1.5 }; }
      return P0;
    },
  };
}

/* ---- the people: one builder, dressed differently ---- */
function lpPerson(o) {
  const H = o.h || 1, sk = o.skin || 0xe9c09c, top = o.top, dress = o.dress, legC = o.legs || 0x4a3a30, shoe = o.shoes || 0x3a2a20;
  const S = (v) => v * H;
  const legs = (s) => new LPM().lathe(s * 1.8, 0, [[1.05, 1.2], [1.25, S(3)], [1.35, S(6.5)], [1.4, S(9.2)]], 10, legC, { top: false }).blob(s * 1.8, .9, .7, 1.5, shoe, { seed: 30 + s, sx: .95, sy: .6, sz: 1.5, jit: .02 });
  const body = new LPM();
  if (dress) body.lathe(0, 0, [[o.wide ? 6.2 : 5.2, S(1.5)], [o.wide ? 5.4 : 4.4, S(8)], [3.6, S(13)], [3.4, S(19)]], 9, dress, { top: dress });
  else body.lathe(0, 0, [[3.4, S(8.4)], [o.wide ? 5.2 : 3.8, S(12)], [o.wide ? 4.8 : 3.6, S(16)], [3.3, S(19)]], 9, top, { top });
  if (o.apron) body.face([[-3.6, S(dress ? 3 : 8.6), o.wide ? 5.6 : 4.4], [3.6, S(dress ? 3 : 8.6), o.wide ? 5.6 : 4.4], [3, S(16.5), 3.9], [-3, S(16.5), 3.9]], o.apron, { from: [0, S(12), 0], jit: .02 });
  if (o.belt) body.frustum(0, 0, o.wide ? 5 : 3.9, o.wide ? 5 : 3.9, S(11.6), S(12.8), 9, o.belt, { top: false });
  if (o.emblem) body.box(-1.6, S(13.5), 3.5, 1.6, S(16.5), 4.1, o.emblem);
  const head = new LPM().blob(0, S(19) + 4.6, 0, 4.2, sk, { seed: 11, sy: 1.05, jit: .04 }).blob(0, S(19) + 1, 0, 1.6, sk, { seed: 12, jit: 0 });
  for (const s of [-1, 1]) head.box(s * 1.6 - .45, S(19) + 4.6, 3.9, s * 1.6 + .45, S(19) + 5.8, 4.3, 0x2a1e18);
  head.box(-.5, S(19) + 3.6, 4, .5, S(19) + 4.3, 4.4, lpShade(sk, .85));
  const hy = S(19) + 4.6;
  if (o.hair) { head.blob(0, hy + 1.2, -1, 4.6, o.hair, { seed: 13, sy: .9, sz: .95, jit: .08, flat: hy - 1 }); if (o.bun) head.blob(0, hy + 2.6, -4.2, 2.2, o.hair, { seed: 14 }); if (o.long) head.box(-4, hy - 5, -4.2, 4, hy + 1, -1, o.hair); }
  if (o.hat === 'chef') head.frustum(0, 0, 4.2, 5, hy + 2.4, hy + 7.5, 9, 0xf7f3ec, { top: false }).blob(0, hy + 8, 0, 5, 0xf7f3ec, { seed: 15, sy: .65, jit: .1 });
  if (o.hat === 'helmet') head.blob(0, hy + 1.6, 0, 4.9, 0x9aa0a8, { seed: 16, sy: .78, jit: .02, flat: hy - .2 }).frustum(0, 0, 5.6, 5.6, hy - .4, hy + .2, 10, 0x7c828a, { top: false }).box(-.5, hy + 3, -5.2, .5, hy + 6.3, 4.6, 0x7c828a);
  if (o.glasses) for (const s of [-1, 1]) head.box(s * 1.6 - 1.1, hy - .3, 4.3, s * 1.6 + 1.1, hy + .1, 4.5, 0x5a4a3a);
  const arm = (s) => new LPM().lathe(s * 4.3, 0, [[.95, S(11.8)], [1.15, S(13.5)], [1.25, S(16.5)], [1.3, S(18.6)]], 10, o.sleeves || dress || top, { top: false }).blob(s * 4.3, S(18.6), 0, 1.35, o.sleeves || dress || top, { seed: 18, jit: 0 }).blob(s * 4.3, S(11.2), .2, 1.3, sk, { seed: 17, jit: 0 });
  const item = new LPM();
  if (o.item === 'spear') item.box(-.5, -6, 1.6, .5, 30, 2.6, LPC.wood).frustum(0, 2.1, 1.4, 0, 30, 35, 4, 0xc8ccd2);
  if (o.item === 'sword') item.box(-.5, S(9), 1.6, .5, S(17.5), 2.4, LPC.woodLt).box(-2, S(10.6), 1.6, 2, S(11.4), 2.4, LPC.wood);
  if (o.item === 'book') item.box(-3.2, S(12.5), 2.8, 3.2, S(16.5), 4.4, LPC.red).box(-3, S(12.7), 4.4, 3, S(16.3), 4.6, 0xf2e8d0);
  if (o.item === 'basket') item.lathe(0, 3, [[2.6, S(9)], [3.4, S(12)]], 8, LPC.hay, { top: LPC.bread });
  const partsMap = {
    legL: { m: legs(-1), pivot: [-1.8, S(9), 0] }, legR: { m: legs(1), pivot: [1.8, S(9), 0] },
    body: { m: body, pivot: [0, S(9), 0] }, head: { m: head, pivot: [0, S(19), 0], parent: 'body' },
    armL: { m: arm(-1), pivot: [-4.3, S(18), 0], parent: 'body' }, armR: { m: arm(1), pivot: [4.3, S(18), 0], parent: 'body' },
    item: { m: item, pivot: [o.item === 'book' ? 0 : 4.3, S(11.5), 0], parent: o.item === 'book' ? 'body' : 'armR' },
  };
  return {
    parts: partsMap,
    pose(a, t) {
      const walk = a.moving ? a.step * Math.PI / 2 : 0, sw = a.moving ? lpSin(walk) : 0, br = lpSin(t * 1.9 + (o.phase || 0));
      const P0 = { legL: { rx: sw * .55 }, legR: { rx: -sw * .55 }, armL: { rx: -sw * .45, rz: -.08 }, armR: { rx: sw * .45, rz: .08 }, body: { y: a.moving ? Math.abs(sw) * .5 : br * .12 }, head: { rx: br * .03, ry: lpSin(t * .5 + (o.phase || 0)) * .12 } };
      if (o.item === 'book') { P0.armL = { rx: -.9, rz: .35 }; P0.armR = { rx: -.9, rz: -.35 }; }
      if (o.item === 'spear') P0.armR = { rx: -.15 };
      return P0;
    },
  };
}
LP_FIGURES.baker = lpPerson({ h: 1, top: 0xf2ebe0, wide: 1, apron: 0xfbf7f0, sleeves: 0xf2ebe0, hair: 0x6a4a34, hat: 'chef', legs: 0x8a4a34, belt: 0xc04a3a, phase: 1 });
LP_FIGURES.child = lpPerson({ h: .78, top: 0x8a5a36, hair: 0xc8482e, legs: 0x5a4030, item: 'sword', phase: 2 });
LP_FIGURES.guard = lpPerson({ h: 1.08, top: LPC.blue, sleeves: LPC.blueDk, emblem: LPC.gold, belt: 0x5a3a24, hat: 'helmet', legs: 0x4a4038, item: 'spear', phase: 3 });
LP_FIGURES.librarian = lpPerson({ h: .95, dress: 0x4e7a48, sleeves: 0x456c40, hair: 0xb8b4ac, bun: 1, glasses: 1, item: 'book', phase: 4 });
LP_FIGURES.shopkeeper = lpPerson({ h: .98, dress: 0xb2532e, apron: 0xefe2c2, hair: 0x6a4026, long: 1, item: 'basket', phase: 5 });

// ---- content/lowpoly/05-crypt.js
/* ---------- lowpoly.html: the crypt's stone ---------- */
const CRY = { st: 0x66607a, stLt: 0x7a748e, stDk: 0x4c4760, moss: 0x5a6a4a };

LP_MODELS.crypt_arch = () => {
  const m = new LPM(), z0 = -12, z1 = 12, S = CRY.st;
  // two piers with bases and capitals, a round arch of voussoirs, a keystone, a cornice over it
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -44 : 25, x1 = s < 0 ? -25 : 44;
    m.box(x0 - 1.5, 0, z0 - 1.5, x1 + 1.5, 6, z1 + 1.5, CRY.stDk, { top: CRY.st });
    m.box(x0, 6, z0, x1, 44, z1, S, { top: CRY.stLt });
    for (let y = 14; y < 44; y += 10) m.box(x0 - .3, y, z0 - .3, x1 + .3, y + 1, z1 + .3, CRY.stDk);
    m.box(x0 - 1.5, 44, z0 - 1.5, x1 + 1.5, 48, z1 + 1.5, CRY.stLt, { top: CRY.stLt });
  }
  const n = 9, rIn = 25, rOut = 40, cy = 48;
  for (let k = 0; k < n; k++) {
    const a0 = Math.PI - k / n * Math.PI, a1 = Math.PI - (k + 1) / n * Math.PI, P2 = (a, r) => [Math.cos(a) * r, cy + Math.sin(a) * r];
    const c = k === 4 ? CRY.stLt : k % 2 ? S : lpShade(S, 1.06), out = k === 4 ? 3 : 0;
    const [ax, ay] = P2(a0, rIn), [bx, by] = P2(a1, rIn), [cx, ccy] = P2(a1, rOut + out), [dx, dy] = P2(a0, rOut + out), from = [0, cy, 0];
    for (const z of [z0, z1]) m.face([[ax, ay, z], [bx, by, z], [cx, ccy, z], [dx, dy, z]], c, { from: [(ax + cx) / 2, (ay + ccy) / 2, 0] });
    m.face([[ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1]], lpShade(c, .8), { from });
    m.face([[dx, dy, z0], [cx, ccy, z0], [cx, ccy, z1], [dx, dy, z1]], c, { from });
    if (k === 0 || k === n - 1) { const [ex, ey] = k === 0 ? [ax, ay] : [bx, by], [fx, fy] = k === 0 ? [dx, dy] : [cx, ccy]; m.face([[ex, ey, z0], [fx, fy, z0], [fx, fy, z1], [ex, ey, z1]], c, { from }); }
  }
  // the spandrels up to a flat top, and a cornice
  for (const s of [-1, 1]) m.prism([[s * 25, 48], [s * 44, 48], [s * 44, 84], [s * 40 * Math.cos(Math.PI / 4), 48 + 40 * Math.sin(Math.PI / 4)]], 'z', z0 + 1, z1 - 1, S);
  m.box(-46, 84, z0 - 2, 46, 88, z1 + 2, CRY.stLt, { top: CRY.st });
  // the dark beyond the arch
  m.face([[-25, 0, z0 + 2], [25, 0, z0 + 2], [25, 48, z0 + 2], [-25, 48, z0 + 2]], 0x15121c, { jit: 0 });
  return m;
};

LP_MODELS.sarcophagus = () => {
  const m = new LPM(), S = CRY.st;
  for (const [x, z] of [[-40, -18], [40, -18], [-40, 18], [40, 18]]) m.box(x - 5, 0, z - 4, x + 5, 4, z + 4, CRY.stDk);
  m.box(-45, 4, -22, 45, 9, 22, CRY.stDk, { top: S });
  m.box(-42, 9, -20, 42, 36, 20, S, { top: S });
  m.box(-44, 34, -22, 44, 37, 22, CRY.stLt);
  // the lid: a low gable with a carved quill along it
  m.prism([[-22, 37], [22, 37], [16, 44], [-16, 44]], 'x', -44, 44, CRY.stLt, { cap: S });
  m.box(-30, 44, -1.5, 30, 45.2, 1.5, CRY.stDk);
  // carvings on the front: a quill and two sprigs, in shallow relief
  const quill = [[-12, 17], [14, 27], [16, 29], [-10, 19]];
  m.face(quill.map(([x, y]) => [x, y, 20.4]), CRY.stLt, { from: [0, 22, 0] });
  for (const s of [-1, 1]) { m.box(s * 30 - .6, 14, 20, s * 30 + .6, 28, 20.6, CRY.stDk); for (let k = 0; k < 3; k++) m.box(s * 30 - 3, 17 + k * 4, 20, s * 30 + 3, 18 + k * 4, 20.5, CRY.stDk); }
  m.blob(-38, 8, 21, 3, CRY.moss, { seed: 4, sy: .5, facet: 1 });
  return m;
};

LP_MODELS.crypt_wall = () => {
  const m = new LPM(), z0 = -11, z1 = 11;
  // a wall of blocks between two piers, a niche with a lit candle
  m.box(-50, 0, z0, 50, 58, z1, CRY.stDk, { top: CRY.st });
  for (let c = 0; c < 7; c++) for (let b = 0; b < 7; b++) {
    const y0 = c * 8 + .5, x0 = -50 + b * 15 - (c % 2) * 7.5 + .5, x1 = Math.min(50, x0 + 14), xa = Math.max(-50, x0);
    if (x1 - xa < 2 || (xa < 9 && x1 > -9 && y0 > 20 && y0 < 46)) continue;
    const sh = [CRY.st, lpShade(CRY.st, 1.06), lpShade(CRY.st, .94), CRY.stLt][Math.floor(hash2(b, c) * 4)];
    for (const z of [z0 - .6, z1]) m.box(xa, y0, z, x1, y0 + 7, z + .6, sh, { skip: ['bottom', z < 0 ? 'front' : 'back'] });
  }
  for (const s of [-1, 1]) m.box(s * 52 - 5, 0, z0 - 2, s * 52 + 5, 64, z1 + 2, CRY.st, { top: CRY.stLt });
  m.box(-9, 22, z1 - 6, 9, 46, z1 + .5, 0x1c1824, { skip: ['bottom', 'front'] });
  m.box(-10, 21, z1 - 6, 10, 23, z1 + 2, CRY.stLt);
  m.lathe(0, z1 - 2, [[1.8, 23], [1.6, 30], [1.4, 30.5]], 8, 0xf2e8cc, { top: 0xf2e8cc });
  const n0 = m.f.length; m.blob(0, 32.5, z1 - 2, 1.3, 0xffd27a, { seed: 3, sy: 1.6, facet: 1 }); for (let i = n0; i < m.f.length; i++) m.f[i].g = 1;   // the flame glows
  return m;
};

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
  applyLang(); syncStyle();
  $('styleBtn').onclick = () => setStyle(!settings.flat);
  if (!LP) for (const e of document.querySelectorAll('.lpOnly')) e.hidden = true;   // the figures option: lowpoly.html only
  if (LP) { settings.flat = false; $('styleBtn').hidden = true; for (const e of [$('optStyle'), $('optStyle').previousElementSibling]) e.hidden = true; }   // lowpoly.html: no 2D style
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
  // no browser menu on a right click or a long press, except in text fields (the save code is copied and pasted there)
  addEventListener('contextmenu', (e) => { if (!/^(TEXTAREA|INPUT)$/.test(e.target.tagName)) e.preventDefault(); });
  // drag turns the view, the wheel zooms (as in the dioramas)
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { id: e.pointerId, x: e.clientX }; canvas.setPointerCapture(e.pointerId); canvas.focus({ preventScroll: true }); });
  canvas.addEventListener('pointermove', (e) => { if (!drag || drag.id !== e.pointerId) return; const dx = e.clientX - drag.x; drag.x = e.clientX; if (settings.flat) return; yawT -= dx * .007; yaw = yawT; });
  const endDrag = (e) => { if (drag && drag.id === e.pointerId) { drag = null; yawT = Math.round(yawT / TURN) * TURN; } };
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
    spriteTris: () => Object.fromEntries(SPRITES.map((s) => [s.key, (s.pixel ? 2 * (s.layF.length + s.layB.length + s.strips.length) : 0) + 2 * s.low.length])),
    G: () => G, code: () => saveCode(), read: (c) => readCode(c), enter: (n, at) => enterArea(n, at),
    area: () => A,
    // for the checks: stop the frame loop, reseed, and run the 120 Hz simulation by hand (bot is called before each step)
    freeze: (on) => { frozen = !!on; if (!on) last = performance.now(); },
    reseed: (n) => reseed(n),
    sim: (secs, bot) => { const n = Math.round(secs / SIM); for (let i = 0; i < n; i++) { if (bot && bot(i * SIM) === false) return i * SIM; step(SIM); flatsDraw(SIM); } return secs; },
    clearEnemies: () => clearEnemies(),
    internals: () => ({ enemies, hazards, hero, player, ENEMIES, AREAS, stats, combatT, settings, input, ui, resetHero, SWINGS, DEFS, CODE_ART, scene, matSlab, cam }),
    view: (y) => { yaw = yawT = y; intro = 1; },
    idPass: () => idPass(), holePass: () => holePass(), skyPass: () => skyPass(), qaImage: () => qaImage(),
    rescale: (k) => { window.__ss = k; resize(); },
    camera: () => ({ t: [camT.x, camT.y, camT.z], p: [cam.position.x, cam.position.y, cam.position.z], v: viewV(Math.max(Vz, minV())), rt: [rt.width, rt.height] }),
    shadowAt: (x, z) => { A.shadowPin = x === undefined ? null : { x, z }; },
    // the triangle edges of every thing drawn over it (for the review): every triangle, also those whose pixels the
    // material discards, since they cost the same
    wire: (on) => { settings.wire = !!on; applyWire(); },
    aa: (on) => setAA(on),
    flat: (on) => { settings.flat = !!on; restyle(); syncStyle(); },
    fingerprints: () => qaFingerprints(),
    lpCoplanar: () => Object.fromEntries(Object.keys(LP_MODELS).map((k) => [k, lpCoplanar(lpModel(k))]).concat([['chest(open)', LP_CHEST ? lpCoplanar(lpSettle(LP_CHEST(CHEST.open))) : []]])),
    cards: () => {
      let shadows = 0; scene.traverse((o) => { if (o.isMesh && o.material === shadowOnly && o.visible) shadows++; });
      return { pics: [...cardPics].map(([k, c]) => { const [key, rot] = k.split('|'), s = sp[key]; return [k, !!c, c ? c[0].p[2][1] : 0, modelRows(s, +rot), (s.pic && s.pic.sourceSheet) || s.sheet || '', !!(s.pic && s.pic.roofs)]; }), shelf: Object.assign({}, cardShelf), size: [CARD_W, CARD_H], shadows };
    },
    strips: (k) => { const s = sp[k]; return s.strips.map((q) => { const xs = [0, 3, 6, 9].map((o) => q.p[o]), ys = [1, 4, 7, 10].map((o) => q.p[o]); return [(Math.min(...xs) + Math.max(...xs)) / 2 + s.px, s.base - (Math.min(...ys) + Math.max(...ys)) / 2, q.n[0], q.n[1]]; }); },
    parts: (k) => { const s = sp[k]; return s.pixel ? { front: 2 * s.layF.length, back: 2 * s.layB.length, sides: 2 * s.strips.length, roof: 2 * s.low.length } : { faces: 2 * s.low.length }; },
    low: (k) => sp[k].low.map((q) => ({ n: q.n.map((v) => +v.toFixed(2)), y: q.p.map((p) => p[1]), layer: q.layer })),
    atlas: () => ({ AW2, AH, sprites: AP.sprites, px: (x, y) => [...atlasPx.slice((y * AW2 + x) * 4, (y * AW2 + x) * 4 + 4)], aux: (x, y) => [...auxPx.slice((y * AW2 + x) * 4, (y * AW2 + x) * 4 + 4)] }),
    zoom: (v) => { VT = Vz = v; },
    draw: () => draw(1 / 60),
  };
})();
})();
