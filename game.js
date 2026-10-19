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
const LP = window.__STYLE === 'lowpoly';            // the low-poly page: things and figures modelled in code (engine/25-lpkit.js)
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
const settings = Object.assign({ lang: (navigator.language || 'en').toLowerCase().startsWith('it') ? 'it' : 'en', fps: 0, shadows: true, wire: false, flat: false, shake: true, atmos: true, music: 2, sound: 2, showFps: false },
  (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } })());
if (typeof settings.sound === 'boolean') settings.sound = settings.sound ? 2 : 0;   // the first builds stored on/off
// settings saved before the frame rate's Auto (every refresh) held the old default, 60: they get Auto once
if (!settings.paced) { if (settings.fps === 60) settings.fps = 0; settings.paced = 1; }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* private mode: keep in memory */ } };

// every visible string comes from lang/<code>.json by key. A dialogue's words may move: [shake]..[/shake] tremble,
// [wave]..[/wave] ripple, [quake]..[/quake] tremble hard and shake the view as they are written (engine/70-ui.js),
// [key]..[/key] is a name the story turns on (a person, a place, a story item), in gold, still;
// tFx keeps the tags for the dialogue, t takes them out everywhere else
const FX_TAG = /\[(\/?)(shake|wave|quake|key)\]/g;
function tFx(key, vars) {
  const L = window.LANG || {}, s = (L[settings.lang] || {})[key] ?? (L.en || {})[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m) : s;
}
function t(key, vars) { return tFx(key, vars).replace(FX_TAG, ''); }
function applyLang() {
  document.documentElement.lang = settings.lang;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('[data-t-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.tAria)));
  document.title = t('title');
}

// ---- engine/10-art.js
/* ---------- art: the pipeline's atlases (window.ART, built by build.mjs) turned into pixels ---------- */
// ART = { <sheet>: { meta: { kind, sprites: { name: { x, y, w, h, depth?, anchor?, hi4? } }, w?, h? }, png?: 'data:image/png;base64,…', hi4? } }
// (a frames sheet carries hi4 and its 1x size, every other sheet its 1x png)
const SHEETS = {};     // sheet name → { meta, canvas, px (RGBA of the whole atlas), w, h }
const DEFS = [];       // depth sprites for the extruder: { key, name, pic: { w, h, c, f, b, fl } }
const TILES = {};      // tile name → { w, h, px }

function loadArt() {
  const names = Object.keys(window.ART || {});
  return Promise.all(names.map((name) => new Promise((ok, fail) => {
    const A = window.ART[name], img = new Image();
    const toCanvas = (im) => { const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); return c; };
    img.onload = () => {
      // a frames sheet comes as its @4x frames only (build.mjs): its 1x size is in its meta, its 1x pixels are not needed
      if (!A.png) { SHEETS[name] = { meta: A.meta, canvas: null, px: null, w: A.meta.w, h: A.meta.h, hi4: toCanvas(img) }; ok(); return; }
      const c = toCanvas(img);
      SHEETS[name] = { meta: A.meta, canvas: c, px: c.getContext('2d').getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
      if (!A.hi4) { ok(); return; }
      const hi = new Image(); hi.onload = () => { SHEETS[name].hi4 = toCanvas(hi); ok(); };
      hi.onerror = () => ok(); hi.src = A.hi4;
    };
    img.onerror = () => fail(new Error('art sheet not decodable: ' + name));
    img.src = A.png || A.hi4;
  }))).then(() => {
    for (const [sheet, S] of Object.entries(SHEETS)) {
      for (const [key, r] of Object.entries(S.meta.sprites)) {
        if (S.meta.kind === 'tiles') TILES[key] = { w: r.w, h: r.h, px: crop(S, r) };
        else if (r.depth) DEFS.push({ key, name: key, sheet, pic: applyDepthRules(key, depthPic(S, r)) });
      }
    }
    if (LP && LP_TILES) Object.assign(TILES, LP_TILES());   // the low-poly page: the ground painted in code
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
  constructor(cap) { this.pos = new Buf(Float32Array, cap * 12); this.nrm = new Buf(Int8Array, cap * 12); this.col = new Buf(Uint8Array, cap * 16); this.idx = new Buf(Uint32Array, cap * 6); this.fc = new Buf(Uint8Array, cap); this.v = 0; }
  quad(p, nx, ny, nz, r, g, b, gl, sx, sy, sz) {
    const order = flipped(p, nx, ny, nz) ? [0, 3, 2, 1] : [0, 1, 2, 3]; if (sx === undefined) { sx = nx; sy = ny; sz = nz; }
    this.pos.need(12); this.nrm.need(12); this.col.need(16); this.idx.need(6);
    const pa = this.pos.a, na = this.nrm.a, ca = this.col.a, ia = this.idx.a; let pn = this.pos.n, nn = this.nrm.n, cn = this.col.n;
    for (let k = 0; k < 4; k++) { const o = order[k] * 3; pa[pn++] = p[o]; pa[pn++] = p[o + 1]; pa[pn++] = p[o + 2]; na[nn++] = sx * 127; na[nn++] = sy * 127; na[nn++] = sz * 127; ca[cn++] = r; ca[cn++] = g; ca[cn++] = b; ca[cn++] = gl ? 255 : 0; }
    this.pos.n = pn; this.nrm.n = nn; this.col.n = cn;
    const v = this.v, i = this.idx.n; ia[i] = v; ia[i + 1] = v + 1; ia[i + 2] = v + 2; ia[i + 3] = v; ia[i + 4] = v + 2; ia[i + 5] = v + 3; this.idx.n += 6; this.v += 4;
    this.fc.need(1); this.fc.a[this.fc.n++] = 4;
  }
  // a face with its own colour at each corner (the low-poly kit bakes a contact shade into the colours); cols: 12 bytes.
  // c: its corners, 4 or 3 (a triangle goes as one triangle: as a quad with a corner repeated it cost a fourth corner
  // and an empty second triangle, and the kit's round things are all triangles)
  quadC(p, nx, ny, nz, cols, gl, nrms, c = 4) {   // nrms: 12 numbers, a normal per corner (smooth shading), else the face's
    const order = flipped(p, nx, ny, nz) ? (c === 3 ? [0, 2, 1] : [0, 3, 2, 1]) : [0, 1, 2, 3];
    this.pos.need(12); this.nrm.need(12); this.col.need(16); this.idx.need(6);
    const pa = this.pos.a, na = this.nrm.a, ca = this.col.a, ia = this.idx.a; let pn = this.pos.n, nn = this.nrm.n, cn = this.col.n;
    for (let k = 0; k < c; k++) { const o = order[k]; pa[pn++] = p[o * 3]; pa[pn++] = p[o * 3 + 1]; pa[pn++] = p[o * 3 + 2]; if (nrms) { na[nn++] = nrms[o * 3] * 127; na[nn++] = nrms[o * 3 + 1] * 127; na[nn++] = nrms[o * 3 + 2] * 127; } else { na[nn++] = nx * 127; na[nn++] = ny * 127; na[nn++] = nz * 127; } ca[cn++] = cols[o * 3]; ca[cn++] = cols[o * 3 + 1]; ca[cn++] = cols[o * 3 + 2]; ca[cn++] = gl ? 255 : 0; }
    this.pos.n = pn; this.nrm.n = nn; this.col.n = cn;
    const v = this.v, i = this.idx.n; ia[i] = v; ia[i + 1] = v + 1; ia[i + 2] = v + 2;
    if (c === 3) { this.idx.n += 3; this.v += 3; } else { ia[i + 3] = v; ia[i + 4] = v + 2; ia[i + 5] = v + 3; this.idx.n += 6; this.v += 4; }
    this.fc.need(1); this.fc.a[this.fc.n++] = c;
  }
  // luce dei lampioni calcolata una volta per faccia al caricamento, invece che per ogni pixel a ogni frame
  bakeLamps(light) {
    const n = this.v, out = new Uint8Array(n), p = this.pos.a, nr = this.nrm.a, fc = this.fc.a;
    for (let v = 0, f = 0; v < n; v += fc[f++]) {   // (face by face: 4 corners or 3)
      const c = fc[f]; let x = 0, y = 0, z = 0; for (let k = 0; k < c; k++) { x += p[(v + k) * 3]; y += p[(v + k) * 3 + 1]; z += p[(v + k) * 3 + 2]; }
      const b = Math.min(255, Math.round(light(x / c, y / c, z / c, nr[v * 3] / 127, nr[v * 3 + 1] / 127, nr[v * 3 + 2] / 127) * 127.5));
      for (let k = 0; k < c; k++) out[v + k] = b;
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
// hand curation per sprite (content/curate.json fills it), applied at load, so a redrawn sheet keeps its fixes:
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
  // drawing only its own pixels (layer 500 + its number, see layerTest)
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
// the shape specs in use (content/edits/<key>.json, SHAPE_EDITS): a thing with a spec is built from it in place of its
// sheet extrusion. Called by the build's edits chunk (tools/lib/edits.mjs), after every engine file has run
function useShapeEdits() { Object.assign(SHAPES, SHAPE_EDITS); for (const key of Object.keys(SHAPES)) { BUILD[key] = 'pixel'; CODE_ART[key] = (old) => shapeBuilding(old.pic, SHAPES[key], old.sheet); } }

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
/* ---------- the low-poly style (the low-poly page): things and figures modelled in code ---------- */
// Units are art pixels (PPU to a world unit), y up from the ground; x across the front, 0 at the thing's anchor column;
// z toward the front (+), 0 at the middle of its depth: where the sheet sprites stand, so collisions, doors and shadows
// stay where they were. A model (LPM) is a list of flat faces, each with a colour: the light comes from the scene (sun,
// sky, lamps, shadows); the kit adds a soft darkening near the ground (contact shade) and a slight variation per face,
// so surfaces read as made by hand rather than as plastic. Faces that glow at night (windows) carry glow.
// LP_MODELS[key]: () => LPM, built once.
const LP_MODELS = {}, lpCache = {};
let LP_CHEST = null, LP_TILES = null, LP_WALL = null;   // LP_WALL(colour, along, y): a wall's colour at a pixel, by the legend's wall colour   // the chest with its lid at an angle (radians); the ground tiles painted in code
// the figures' and effects' sheets (the frames sheets) at 4x on both pages: the game carries only their @4x frames
// (tools/art.mjs resamples them from the original drawing), each put at four times its 1x place, so the frames'
// rectangles, divided by the sheet's 1x size, still find them. A sheet without them (icons, tiles) is drawn as it is
const lpPx4 = {};
function lpSheetCanvas(sheet) {
  const SH = SHEETS[sheet]; if (!SH.hi4) return SH.canvas; if (lpPx4[sheet]) return lpPx4[sheet];
  const c = document.createElement('canvas'); c.width = SH.w * 4; c.height = SH.h * 4; const x = c.getContext('2d');
  for (const r of Object.values(SH.meta.sprites)) if (r.hi4) x.drawImage(SH.hi4, r.hi4.x, r.hi4.y, r.hi4.w, r.hi4.h, r.x * 4, r.y * 4, r.w * 4, r.h * 4);
  return (lpPx4[sheet] = c);
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
    if (m.isDoor && !t.ry) lpDoorAt(t.x || 0);   // (a door put on the front: lpDoor)
    const cy = Math.cos(t.ry || 0), sy = Math.sin(t.ry || 0), s = t.s || 1;
    const base = this.sg; let top = base;   // the added model's smoothing groups, renumbered after this one's
    for (const f of m.f) { if (f.s) top = Math.max(top, base + f.s); this.f.push(Object.assign({}, f, { s: f.s ? base + f.s : 0, p: f.p.map(([x, y, z]) => [(x * cy + z * sy) * s + (t.x || 0), y * s + (t.y || 0), (-x * sy + z * cy) * s + (t.z || 0)]) })); }
    this.sg = top;
    return this;
  }
  // a part that turns (a windmill's sails): the faces fn adds turn about hub ([x, y, z] in the model's px) round its axis
  // ('z': toward the front, 'x'), rate turns a second; lpPut leaves them out, engine/40-area.js lpSpinners builds them apart
  spin(hub, axis, rate, fn) {
    const i0 = this.f.length, k = (this.spins = this.spins || []).push({ hub, axis, rate }) - 1; fn(this);
    for (let i = i0; i < this.f.length; i++) this.f[i].sp = k;
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
    let F = F0; for (let lv = 0, nl = o.sub !== undefined ? o.sub : (r * Math.max(o.sx || 1, o.sy || 1, o.sz || 1) >= 8 ? 2 : 1); lv < nl; lv++) { const G = []; for (const [a, b, d] of F) { const ab = M(a, b), bd = M(b, d), da = M(d, a); G.push([a, ab, da], [b, bd, ab], [d, da, bd], [ab, bd, da]); } F = G; }
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
// where a building's door is (its first door on the front, x in its model's px), recorded as its model is built: an
// area puts the door's way in under the door drawn (engine/40-area.js), not at the building's middle
const LP_DOORS = {}; let lpKey = null;
const lpDoorAt = (x) => { if (lpKey && LP_DOORS[lpKey] === undefined) LP_DOORS[lpKey] = x; };
// what a model gives off, recorded as it is built (engine/59-ambient.js): smoke from a chimney's top, leaves from a canopy
// (its middle and radius), in the model's px
const LP_EMIT = {};
const lpEmit = (kind, x, y, z, r) => { if (lpKey) (LP_EMIT[lpKey] = LP_EMIT[lpKey] || []).push({ kind, x, y, z, r }); };
const lpModel = (key) => { if (lpCache[key] || !LP_MODELS[key]) return lpCache[key] || null; lpKey = key; try { lpCache[key] = lpSettle(LP_MODELS[key]()); } finally { lpKey = null; } return lpCache[key]; };   // (settled: lpSettle, below)
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
// a model's plan turned (o.rot quarter turns) and mirrored (o.flip): model px x, z → x, z as placed
const lpTf = (o = {}) => { const rot = (((o.rot || 0) % 4) + 4) % 4, fl = o.flip ? -1 : 1; return (X, Z) => { let a = X * fl, c = Z; for (let r = 0; r < rot; r++) { const t = a; a = c; c = -t; } return [a, c]; }; };
// o.only: just the faces of the model's turning part o.only, around o.pivot (its hub) put at x, o.y, z (engine/40-area.js
// lpSpinners); without it the turning parts are left out
function lpPut(Bd, m, x, z, o = {}) {
  const oy = o.y || 0, ox = Math.round(x * PPU) / PPU, oz = Math.round(z * PPU) / PPU, tf = lpTf(o), [hx, hy, hz] = o.pivot || [0, 0, 0];
  const pts = new Array(12), cols = new Array(12), nrms = new Array(12), VN = lpVN(m);
  m.f.forEach((f, fi) => {
    if (o.only === undefined ? f.sp !== undefined : f.sp !== o.only) return;
    const p = f.p, nc = p.length, wp = p.map(([X, Y, Z]) => { const [a, c] = tf(X - hx, Z - hz); return [ox + a * P, oy + (Y - hy) * P, oz + c * P]; });
    const n = lpNormal(f.p.map(([X, Y, Z]) => { const [a, c] = tf(X, Z); return [a, Y, c]; })), j = 1 + (hash2(fi * 7 + 3, m.f.length) * 2 - 1) * f.j, base = lpRGB(f.c);
    for (let k = 0; k < nc; k++) {
      const y = p[k][1], ao = f.ao ? .72 + .28 * Math.min(1, Math.max(0, y) / 14) : 1;   // contact shade: darker where it meets the ground
      for (let i = 0; i < 3; i++) { pts[k * 3 + i] = wp[k][i]; cols[k * 3 + i] = Math.max(0, Math.min(255, Math.round(base[i] * j * ao))); }
      // o.shade (0..1): spent, a container opened and emptied: toward its own grey by shade, darker by shade (0.5: half)
      if (o.shade) { const c = cols, q = k * 3, g = (c[q] + c[q + 1] + c[q + 2]) / 3, s = 1 - o.shade; for (let i = 0; i < 3; i++) c[q + i] = Math.round((c[q + i] + (g - c[q + i]) * o.shade) * s); }
    }
    const vn = VN[fi];
    for (let k = 0; k < nc; k++) { const [a, c] = tf(vn[k][0], vn[k][2]); nrms[k * 3] = a; nrms[k * 3 + 1] = vn[k][1]; nrms[k * 3 + 2] = c; }
    Bd.quadC(pts, n[0], n[1], n[2], cols, f.g, nrms, nc);
  });
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
// three.js r186: colours as written, unconverted, before any is made (since r152 three converts hex colours from sRGB to
// linear; the game's colours and lights were tuned without it, and lin() below squares the ones it wants linear)
THREE.ColorManagement.enabled = false;
const canvas = $('gl');
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' }); } catch (e) { renderer = null; }
const scene = new THREE.Scene();
// three r155 dropped the old light units: the same intensity now lights a surface 1/π as bright
const LIGHT_UNIT = Math.PI;
const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, .6 * LIGHT_UNIT); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, LIGHT_UNIT); sun.castShadow = settings.shadows;
const SHADOW_MAP = window.__shadowMap || (LP ? 2048 : 1024);   // the low-poly page: finer, its picture is finer than an art pixel
//   // a texel about one art pixel: 2048 looked the same at 4 times the cost
sun.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP); sun.shadow.autoUpdate = false; sun.shadow.bias = -0.0004;
// (radius 0: PCF's taps all on the shadow's own point, the hardware's 2×2 filter; above 0 they turn by a screen-space
// noise, which would crawl as the camera moves)
sun.shadow.radius = 0;
scene.add(sun); scene.add(sun.target);
// the low-poly page's shadows: PCF (three r186 removed PCFSoft, which it had)
if (renderer) { renderer.setPixelRatio(1); renderer.outputColorSpace = THREE.LinearSRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = LP ? THREE.PCFShadowMap : THREE.BasicShadowMap; renderer.info.autoReset = false; }

// r128's colour path, on which the game's look was tuned: textures stored as they are, decoded from sRGB after the
// filter, and each material's colour encoded to sRGB as it is written, so the picture blends and filters as stored.
// r186 does both in hardware instead (sRGB textures and targets), which filters and blends in linear light: texel
// borders and the lamps' halos came out different. legacy() sets it on the game's own colour materials: VX_SRGB_OUT
// encodes what the material writes, VX_SRGB_IN decodes its map (not for a map drawn linear, the halo's gradient).
// r186's two formulas are r128's (tools/test/vendor-three.test.mjs holds the chunks' text this patches)
THREE.ShaderChunk.map_fragment = THREE.ShaderChunk.map_fragment.replace('diffuseColor *= sampledDiffuseColor;', '#ifdef VX_SRGB_IN\n\tsampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );\n#endif\n\tdiffuseColor *= sampledDiffuseColor;');
THREE.ShaderChunk.colorspace_fragment = '#ifdef VX_SRGB_OUT\ngl_FragColor = sRGBTransferOETF( gl_FragColor );\n#else\n' + THREE.ShaderChunk.colorspace_fragment + '\n#endif';
const legacy = (m, mapIsSRGB = true) => { m.defines = Object.assign(m.defines || {}, { VX_SRGB_OUT: '' }, mapIsSRGB ? { VX_SRGB_IN: '' } : {}); return m; };

const nearest = (t) => { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t; };
let groundTex = null, heightTex = null, atlasTex = null, auxTex = null;   // ground: per area; atlas: once at boot
function makeAtlasTextures() {
  atlasTex = new THREE.DataTexture(atlasPx, AW2, AH, THREE.RGBAFormat, THREE.UnsignedByteType); atlasFilter();   // (sRGB, decoded in the shader: legacy())
  auxTex = nearest(new THREE.DataTexture(auxPx, AW2, AH, THREE.RGBAFormat, THREE.UnsignedByteType)); auxTex.needsUpdate = true;
}

/* Materiale: colore per pixel, bagliore, e ombre lette al centro della cella da 1/16 (ombre a scalini sulla griglia) */
const uGlow = { value: 0 }, uLampCol = { value: new THREE.Vector3() }, diag = { flat: false, aa: window.__aa !== false }, allMats = [];
// things' and the ground's pixels sharp but smooth-edged ("sharp bilinear"): each texel is read whole, except within half a screen pixel
// of its border, where the filter blends the two. Slopes, curves and 45° views drew stair-stepped texel borders that
// crawled as the view turned; far away, where a texel is under a pixel, it is plain bilinear instead of a flicker.
// The cut-out (the layer test) still reads the exact texel, so outlines stay hard
const AA_MAP = '#ifdef USE_MAP\nvec2 vxT = vMapUv * uAtlas, vxS = floor(vxT + 0.5);\nvxT = vxS + clamp((vxT - vxS) / max(fwidth(vxT), vec2(1e-4)), -0.5, 0.5);\nvec4 texelColor = sRGBTransferEOTF(texture2D(map, vxT / uAtlas));\ndiffuseColor *= texelColor;\n#endif\n';
const aaFilter = (t) => { if (!t) return t; t.magFilter = t.minFilter = diag.aa ? THREE.LinearFilter : THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; };
function atlasFilter() { aaFilter(atlasTex); }
function setAA(on) { diag.aa = !!on; atlasFilter(); for (const m of allMats) { if (m.userData.aa) aaFilter(m.map); m.needsUpdate = true; } }
const LIGHTS = THREE.ShaderChunk.lights_fragment_begin.split('vDirectionalShadowCoord[ i ]').join('vxShadowCoord');
// layer CUT (300): discard the pixels the art left empty (aux r is 0 there); other layers: the old depth-layer test
const layerTest = (uv) => `vec4 vxA = texture2D(uAux, ${uv}); if (vLayer > 499.5) { if (abs(vxA.a * 255.0 - (754.0 - vLayer)) > 0.5) discard; } else if (vLayer > 399.5) { if (vxA.a < 0.5 / 255.0) discard; } else if (vLayer > 299.5) { if (vxA.r < 0.5 / 255.0) discard; } else if (abs(vLayer) > 0.5 && abs((vLayer < 0.0 ? vxA.g : vxA.r) * 255.0 - abs(vLayer)) > 0.5) discard;`;
// 'card': the 2D style's cards (engine/34-bake.js), a slab whose texture is the pictures: cut out where their alpha is
// low, lit at night where it is 200 (a window)
const cardTest = (uv) => `vec4 vxT = texture2D(map, ${uv}); if (vxT.a < 0.4) discard; vec4 vxA = vec4(0.0, 0.0, vxT.a < 0.9 ? 1.0 : 0.0, 0.0);`;
function voxelMaterial(kind, o) {
  const ground = kind === 'ground', sprite = kind === 'sprite', card = kind === 'card', slab = kind === 'slab' || card;
  const m = new THREE.MeshPhongMaterial({ color: 0xffffff, specular: 0x000000, shininess: 0, map: ground ? groundTex : sprite ? o.map : card ? cardTexture() : slab ? atlasTex : null, alphaTest: sprite ? .5 : 0 });
  // the chunk's own height-and-lamp texture, taken now: the shader compiles at the first draw, after an area that builds
  // every chunk at once has built the last one, and all of them drew their ground with its lamps
  const ownHeight = ground ? heightTex : null;
  m.onBeforeCompile = (sh) => {
    m.userData.sh = sh;   // its uniforms, for the checks (tools/resource-check.mjs)
    sh.uniforms.uShadowMat = { value: sun.shadow.matrix };
    sh.uniforms.uGlow = uGlow;
    sh.uniforms.uLampCol = uLampCol;
    if (ground) sh.uniforms.uHeightTex = { value: ownHeight };
    if (slab) sh.uniforms.uAux = { value: auxTex };
    if (slab || ground) { const im = m.map.image; sh.uniforms.uAtlas = { value: new THREE.Vector2(im.width, im.height) }; }
    if (sprite) { sh.uniforms.uProbe = { value: o.probe }; sh.uniforms.uRow = { value: o.row }; sh.uniforms.uLampL = o.lampL; }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm;\n' + (ground || sprite ? '' : slab ? 'attribute float aLayer; varying float vLayer; attribute float aLamp; varying float vLamp;' : 'attribute vec4 aCol; varying vec4 vCol; attribute float aLamp; varying float vLamp;'))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * normal);\n' + (ground || sprite ? '' : slab ? 'vLayer = aLayer; vLamp = aLamp;' : 'vCol = aCol; vLamp = aLamp;'));
    let f = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNrm; uniform mat4 uShadowMat; uniform float uGlow; uniform vec3 uLampCol;\n' + (ground ? 'uniform sampler2D uHeightTex; uniform vec2 uAtlas;' : sprite ? 'uniform vec3 uProbe; uniform vec2 uRow; uniform float uLampL;' : slab ? 'uniform sampler2D uAux; uniform vec2 uAtlas; varying float vLayer; varying float vLamp;' : 'varying vec4 vCol; varying float vLamp;'));
    f = f.replace('void main() {', 'void main() {\n' + (ground ? 'float vxLamp = texture2D(uHeightTex, vMapUv).g * 2.0;' : sprite ? 'float vxLamp = uLampL;' : slab ? (card ? cardTest('vMapUv') : layerTest('vMapUv')) + ' float vxLamp = vLamp * 2.0;' : 'float vxLamp = vLamp * 2.0;'));
    // a solid surface is opaque even where its texel is not: the post pass shows the sky through any alpha below 1
    if (slab) f = f.replace('#include <map_fragment>', (diag.aa && !card ? AA_MAP : '#include <map_fragment>') + '\ndiffuseColor.a = 1.0;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vxA.b * uGlow * 1.5;');
    else if (ground) f = f.replace('#include <map_fragment>', diag.aa ? AA_MAP : '#include <map_fragment>').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * texture2D(uHeightTex, vMapUv).r * uGlow * 1.6;');
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
  if ((slab && !card) || ground) m.userData.aa = true;   // fwidth, for AA_MAP (built into WebGL2)
  m.customProgramCacheKey = () => 'vx-' + kind + (diag.flat ? '-flat' : '') + (m.userData.aa && diag.aa ? '-aa' : '');
  legacy(m); allMats.push(m); m.addEventListener('dispose', () => { const i = allMats.indexOf(m); if (i >= 0) allMats.splice(i, 1); });   // the list for the AA switch, not a hold on freed ones
  return m;
}
let matStatic = null, matSlab = null, slabDepth = null, matCard = null, cardDepth = null;
function makeMaterials() {
  matStatic = voxelMaterial('static'); matSlab = voxelMaterial('slab'); matCard = voxelMaterial('card');
  cardDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: cardTexture(), alphaTest: .5 });
  // three r186 gives a custom depth material the drawn material's map and alpha test before each shadow draw: the drawn
  // ones carry what their shadow needs (the card's cut-out, which its alpha set to 1 after the map never shows; the
  // atlas the 2D style's hidden 3D casters are cut by)
  matCard.alphaTest = .5; shadowOnly.map = atlasTex;
  slabDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlasTex });
  slabDepth.onBeforeCompile = (sh) => {
    sh.uniforms.uAux = { value: auxTex };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aLayer; varying float vLayer;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLayer = aLayer;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uAux; varying float vLayer;').replace('void main() {', 'void main() {\n' + layerTest('vMapUv'));
  };
}

/* ---------- passata finale: sfondo, antialias leggero, vignettatura ---------- */
const rt = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, stencilBuffer: false });
rt.texture.generateMipmaps = false;   // (sRGB as the materials wrote it: legacy())
if (LP) rt.texture.minFilter = rt.texture.magFilter = THREE.NearestFilter;   // the low-poly page: hard pixels
const postU = { tColor: { value: rt.texture }, uTexel: { value: new THREE.Vector2() }, uShift: { value: new THREE.Vector2() }, uK: { value: 0 }, uSpread: { value: 1 }, uAspect: { value: 1 }, uTime: { value: 0 }, uStars: { value: 0 }, uAur: { value: 0 }, uAurT: { value: 0 }, uBgTop: { value: new THREE.Vector3() }, uBgBot: { value: new THREE.Vector3() },
  tBlur: { value: null }, uHD: { value: 0 }, uBloom: { value: 0 }, uHaze: { value: 0 }, uThr: { value: .35 }, uSat: { value: 1.1 }, uDim: { value: 1 }, uKick: { value: 0 }, uPool: { value: 0 }, uPoolC: { value: new THREE.Vector2(.5, .5) } };   // (the atmosphere: engine/36-look.js)
const postMat = new THREE.ShaderMaterial({
  uniforms: postU, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    precision highp float;
    uniform sampler2D tColor; uniform vec2 uTexel, uShift; uniform float uK, uSpread, uAspect, uTime, uStars, uAur, uAurT;
    uniform vec3 uBgTop, uBgBot; varying vec2 vUv;
    uniform sampler2D tBlur; uniform float uHD, uBloom, uHaze, uThr, uSat, uDim, uKick, uPool; uniform vec2 uPoolC;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    vec4 tap(vec2 o){ vec4 s = texture2D(tColor, vUv - uShift + o * uSpread * uTexel); vec3 c = s.a > 0.001 ? min(s.rgb / s.a, vec3(1.0)) : vec3(0.0); return vec4(c * c * s.a, s.a); }
    void main(){
      // (the low-poly page, uK > 0: each screen pixel reads the picture's pixel it lies in, counted in whole screen pixels from
      // the corner, so the enlargement is exact even when the screen is not a whole number of picture pixels across)
      vec4 acc;
      vec2 fc = gl_FragCoord.xy; if (uKick > 0.0) fc = (fc - 0.5 / uTexel * uK) * (1.0 - uKick) + 0.5 / uTexel * uK;   // (a hit's zoom kick, the low-poly page)
      if (uK > 0.0) { vec2 sp = floor(fc - uShift / uTexel * uK); vec4 s = texture2D(tColor, (floor(sp / uK) + 0.5) * uTexel); vec3 c = s.a > 0.001 ? min(s.rgb / s.a, vec3(1.0)) : vec3(0.0); acc = vec4(c * c * s.a, s.a); }
      else acc = (tap(vec2(0.0)) * 2.0 + tap(vec2(0.375, 0.125)) + tap(vec2(-0.125, 0.375)) + tap(vec2(-0.375, -0.125)) + tap(vec2(0.125, -0.375))) / 6.0;
      vec2 q = vUv - 0.5;
      // the atmosphere (engine/36-look.js): the blurred copy, for the bloom
      vec4 bl = vec4(0.0);
      if (uHD > 0.0) bl = texture2D(tBlur, vUv - uShift);
      vec3 bg = mix(uBgBot, uBgTop, smoothstep(0.05, 0.95, vUv.y));
      bg += mix(uBgBot, uBgTop, 0.5) * 0.35 * exp(-dot(q, q) * 5.0);
      float h = hash(floor(vUv * vec2(uAspect, 1.0) * 170.0));
      bg += uStars * step(0.991, h) * (0.55 + 0.45 * sin(uTime * 1.6 + h * 90.0)) * vec3(0.8, 0.88, 1.0) * 0.7;
      vec3 col = (acc.rgb + (1.0 - acc.a) * bg) * mix(1.0, uDim, uHD);   // (uDim: a boss's dark, engine/56-combat.js lookDim; the bloom below still glows)
      // a pool of light around the cat in a dark place (the atmosphere's "pool", engine/36-look.js): away from it the picture
      // falls toward a tenth of its light (linear here: about half as seen, after the square root below), smoothly, and near it
      // is a little warmer, a lantern's; lamps and embers still glow through the bloom below
      if (uPool > 0.0) { float r = length((vUv - uPoolC) * vec2(uAspect, 1.0)), lit = 1.0 - smoothstep(0.12, 0.5, r); col *= mix(vec3(1.0), mix(0.1, 1.0, lit) * mix(vec3(1.0), vec3(1.1, 1.0, 0.86), lit), uPool); }
      if (uHD > 0.0) {
        // bloom: the bright part of the blurred copy added back; haze toward the far (upper) side; grading: a little
        // more colour, cool shadows, warm lights
        vec3 cb = bl.rgb + (1.0 - bl.a) * bg;
        col += max(cb - uThr, 0.0) * uBloom;
        col = mix(col, mix(uBgBot, uBgTop, 0.5) * 0.9, uHaze * smoothstep(0.5, 1.0, vUv.y));
        float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = max(mix(vec3(lum), col, uSat), 0.0) * mix(vec3(0.90, 0.88, 1.10), vec3(1.07, 1.0, 0.90), smoothstep(0.02, 0.5, lum));
      }
      col *= 1.0 - (0.5 + 0.15 * uHD) * smoothstep(0.42, 1.0, length(q * vec2(1.0, 1.12)) * 1.25);
      vec3 o = sqrt(max(col, 0.0));
      if (uHD > 0.0) { o = min(o, vec3(1.0)); o = mix(o, o * o * (3.0 - 2.0 * o), 0.22); }   // (a soft s-curve)
      gl_FragColor = vec4(o, 1.0);
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
  cripta: { sun: 0x8a90c0, sunI: .3, az: -.4, el: 1.2, sky: 0x6a6c90, gnd: 0x2e2834, hemiI: .6, glow: 1, lamp: 1.8, top: 0x07060a, bot: 0x120e16, stars: 0, aur: 0 },
  // the Ark (Chapter 2): cool white service light, and the red of the emergency lights; lamps a little cooler than a hearth
  nave: { sun: 0xcfe0ff, sunI: .35, az: -.4, el: 1.1, sky: 0x9aa8c0, gnd: 0x3a4250, hemiI: .62, glow: 1, lamp: 1.2, top: 0x05070c, bot: 0x0e1420, stars: 0, aur: 0 },
  emergenza: { sun: 0xff6a5a, sunI: .22, az: -.4, el: 1.1, sky: 0x8a4a4a, gnd: 0x2a1418, hemiI: .5, glow: 1, lamp: 1.6, top: 0x0a0405, bot: 0x180808, stars: 0, aur: 0 },
  interno: { sun: 0xffd9a0, sunI: .35, az: -.4, el: 1.1, sky: 0x9a7a5a, gnd: 0x3a2a20, hemiI: .62, glow: .9, lamp: 1.3, top: 0x0e0a0c, bot: 0x221816, stars: 0, aur: 0 },
  notte: { sun: 0x9cb6ff, sunI: .45, az: .6, el: 1.0, sky: 0x6a8cbc, gnd: 0x283654, hemiI: .5, glow: 1, lamp: 1.5, top: 0x04070f, bot: 0x101a30, stars: 1, aur: 0 },
};
let tod = 1, lamps = [];   // lamps: halo sprites of the current area
const TODS = ['alba', 'giorno', 'tramonto', 'notte', 'interno', 'cripta', 'nave', 'emergenza'].map((label) => {
  const o = Object.assign({}, TOD_BASE[label], null || {});
  for (const k of ['sun', 'sky', 'gnd', 'top', 'bot']) o[k] = lin(o[k]);
  o.label = label; return o;
});
const cur = JSON.parse(JSON.stringify(TODS[tod]));
function applyTod(k) {
  const T = TODS[tod];
  for (const key of ['sunI', 'az', 'el', 'hemiI', 'glow', 'lamp', 'stars', 'aur']) cur[key] = lerp(cur[key], T[key], k);
  for (const key of ['sun', 'sky', 'gnd', 'top', 'bot']) for (let i = 0; i < 3; i++) cur[key][i] = lerp(cur[key][i], T[key][i], k);
  sun.color.setRGB(cur.sun[0], cur.sun[1], cur.sun[2]); sun.intensity = cur.sunI * LIGHT_UNIT;
  const ce = Math.cos(cur.el); sun.position.set(A.sunX + Math.sin(cur.az) * ce * 48, (A.sunY || 0) + Math.sin(cur.el) * 48, A.sunZ + Math.cos(cur.az) * ce * 48);
  hemi.color.setRGB(cur.sky[0], cur.sky[1], cur.sky[2]); hemi.groundColor.setRGB(cur.gnd[0], cur.gnd[1], cur.gnd[2]); hemi.intensity = cur.hemiI * LIGHT_UNIT;
  uGlow.value = cur.glow;
  uLampCol.value.set(cur.lamp, cur.lamp * .663, cur.lamp * .353);
  for (const h of lamps) h.material.opacity = Math.min(1, cur.lamp * .3);
}

/* ---------- camera: orthographic, pitched, follows the player inside the current area ---------- */
const CD = 60, cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 140), camT = new THREE.Vector3();
let yaw = 0, yawT = 0, Vz = 15, VT = 15, aspect = 1;
// a dialogue's view: talkZ goes 0 → 1 over TALK_ZOOM seconds while one is open (engine/80-loop.js), back as it closes
let talkZ = 0; const TALK_ZOOM = .4;
// the share of the picture's height the dialogue box covers from the bottom (engine/80-loop.js): keepInView holds the
// cat above it (a long line with its choices grew the box over the cat)
let viewCover = 0;
// the dialogue's view for a view vv: the next whole step of pixels in (the low-poly page), else seven tenths of it
const talkView = (vv) => (LP && rt.height > 2 ? rt.height / (PPU * (Math.max(1, Math.round(rt.height / (PPU * vv))) + 1)) : vv * .7);
const minV = () => 13 / aspect;   // a phone held upright still sees 13 units across
// the view's height as drawn. the low-poly page rounds it so one art pixel is a whole number of pixels of the picture (a
// texel's edge then falls on the same pixel wherever the camera stands, and the ground does not crawl as the cat walks):
// up to half again the asked height when zoomed out. The follow, the map-edge clamp and the streaming use this one,
// or the view showed the sky past the map's edge and through chunks never built
const viewV = (v) => (LP && rt.height > 2 ? rt.height / (PPU * Math.max(1, Math.round(rt.height / (PPU * v)))) : v);
function camGoal(vv) {
  vv = viewV(vv);
  if (A.W > 48 || A.D > 40) {   // the open world: follow the cat, never showing past the map's edge while the cat stays in view
    const k = aspect < .8 ? vv * .12 : 0;   // upright phones: the cat sits above the thumbs
    const x = player.x + Math.sin(yaw) * k, z = player.z - (A.camNorth || 1.5) + Math.cos(yaw) * k;
    // (one pixel of the picture to spare: the camera's snap moves it up to half a pixel, and the last column past the
    // edge showed the sky)
    const m = vv / Math.max(1, rt.height), hz = vv / Math.sin(PITCH) / 2 + m * 2, hx = vv * aspect / 2 + m, c = Math.abs(Math.cos(yaw)), sn = Math.abs(Math.sin(yaw)), ex = hx * c + hz * sn, ez = hz * c + hx * sn;
    // (a turned view's box is wider than the view: held inside the map near an edge, it left the cat outside the
    // picture. The cat comes first: a strip past the edge shows instead, on a turned view only. A straight view keeps the
    // cat only just inside, a turned one with a room's margin (a cat pressed to the top edge hid under the HUD))
    return keepInView(clamp(x, Math.min(ex, A.W / 2), Math.max(A.W - ex, A.W / 2)), clamp(z, Math.min(ez, A.D / 2), Math.max(A.D - ez, A.D / 2)), vv, 1 - Math.abs(Math.sin(2 * yaw)));
  }
  // a room: framed whole, the camera following the cat by part of the way; then moved on as far as the cat needs to
  // stay inside the view with a margin (an upright phone sees 13 units across a room of 30: the cat walked out at the
  // walls). Measured in view terms, across the screen and toward the camera, so a turned view keeps it too
  const W = A.W, D = A.D, f = clamp(1.45 - vv / 26, .4, .9);
  return keepInView(W / 2 + (player.x - W / 2) * f, D / 2 - (A.camNorth || 1.5) + (player.z - D / 2) * f * .6, vv, 0); }
// a camera goal moved on as far as the cat needs to stay inside the view, in view terms: with a room's margin, or by
// tight (0 to 1) toward only just inside the picture, so a view kept off the map's edge moves past it as little as it can
function keepInView(gx, gz, vv, tight) {
  const mix = (room, edge) => room + (edge - room) * tight;
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), tx = Math.sin(yaw), tz = Math.cos(yaw);   // screen right; toward the camera
  const hx = vv * aspect / 2, hz = vv / Math.sin(PITCH) / 2, mx = Math.max(0, mix(Math.min(hx - 2, hx * .8), hx - 1.2)), dx = gx - player.x, dz = gz - player.z;
  // (the aim toward the camera from the cat puts the cat up the picture: in a room its head and 3 units more, or a fifth
  // of the picture, to the top edge; away, its feet 2 units or a fifth to the bottom: on a phone the HUD covers the top
  // and the thumbs the bottom. Tight, its head (2 units
  // up the picture) just under the top, its feet 1.2 over the bottom. The camera aims at half the cat's
  // ground: on raised ground the cat shows higher by e)
  const e = A.groundY(player.x, player.z) * .5 / Math.tan(PITCH);
  // (the dialogue box: the cat's feet 1.2 units over its top edge, so down may turn negative and push the aim the other way)
  const up = mix(Math.min(hz - 3, hz * .6 - 2), hz - 2), down = Math.min(mix(Math.min(hz - 2, hz * .6), hz - 1.2), viewCover ? hz - 1.2 - viewCover * 2 * hz : Infinity);
  const lo = -down, hi = Math.max(lo, up, 0);
  const a = clamp(dx * rx + dz * rz, -mx, mx), b = clamp(dx * tx + dz * tz + e, lo, hi) - e;
  return [player.x + a * rx + b * tx, player.z + a * rz + b * tz];
}
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
const wireMat = legacy(new THREE.MeshBasicMaterial({ color: 0xffe14a, wireframe: true, transparent: true, opacity: .85 }));
function applyWire() {
  scene.traverse((m) => {
    if (!m.isMesh || m.material !== matSlab) return;
    if (!m.userData.wireOn && settings.wire) { const w = new THREE.Mesh(m.geometry, wireMat); m.add(w); m.userData.wireOn = w; }
    if (m.userData.wireOn) m.userData.wireOn.visible = settings.wire;
  });
}
const _camS = new THREE.Vector3();
// the view's axes across the screen and up it, in the world, and the step of the figures' grid along them (setCamera)
const camView = { X: [1, 0, 0], U: [0, 1, 0], step: 0, la: 0, lb: 0 };   // (la, lb: the aim across and up the view at the last setCamera)
const _vo = [0, 0], viewOf = (x, y, z) => { _vo[0] = x * camView.X[0] + z * camView.X[2]; _vo[1] = x * camView.U[0] + y * camView.U[1] + z * camView.U[2]; return _vo; };   // (one kept pair: read it at once)
const snapView = (q) => (camView.step ? Math.round(q / camView.step) * camView.step : q);
function setCamera() {
  const cp = Math.cos(PITCH), spn = Math.sin(PITCH);
  // (kick: a hit's nudge in, engine/56-combat.js.) A dialogue brings the view in by one step: on the low-poly page, which
  // moves its view only by whole steps of pixels, the next step once there and the picture enlarged toward it in the post
  // pass on the way (both the same view at the swap); elsewhere the view itself, smoothly
  const e = talkZ * talkZ * (3 - 2 * talkZ), base = Math.max(Vz, minV());
  let v = 0, post = 1;
  if (LP && rt.height > 2) { const n = Math.max(1, Math.round(rt.height / (PPU * base))); v = talkZ >= 1 ? talkView(base) : viewV(base); post = talkZ >= 1 ? 1 : 1 + e / n; }
  else v = viewV(base * (1 - kick) * (1 - .3 * e));
  postU.uKick.value = LP ? 1 - (1 - kick) / post : 0;
  // the camera moves by whole pixels of the render target: moving by a fraction of a pixel, thin lines (shadow edges,
  // window bars) fell on one pixel in a frame and on its neighbour in the next, and shimmered while walking
  const px = v / Math.max(1, rt.height), sy = Math.sin(yaw), cy = Math.cos(yaw);
  const X = camView.X, U = camView.U; X[0] = cy; X[1] = 0; X[2] = -sy; U[0] = -spn * sy; U[1] = cp; U[2] = -spn * cy;   // the camera's right and up, in the world (kept arrays: no garbage a frame)
  const a = camT.x * X[0] + camT.z * X[2], b = camT.x * U[0] + camT.y * U[1] + camT.z * U[2];
  // drawn at half the screen (a 2x screen), a whole pixel of the scene is two of the screen: the post pass moves the
  // picture by a whole number of screen pixels (k to a picture pixel), so the view walks in steps of one screen pixel
  const k = Math.max(1, Math.round(bh / Math.max(1, rt.height))), sub = px / k;
  // figures stand on the picture's pixel grid (snapView). (On their own texels' grid instead, K / 2 or K pixels in
  // the low-poly page, the view followed the cat in steps of up to three pixels of the picture, six of a 2x screen: it lurched)
  camView.step = px;
  // where the view stands in effect (the camera's snap and the post pass's shift together): the cat's place on the
  // figures' grid, less the cat's distance from the camera's aim rounded to the shift's steps. The follow lags the cat
  // by a steady distance while it walks, so the cat keeps its place on screen; rounding the camera and the cat each on
  // its own, their difference stepped back and forth by a pixel as the two fractions crossed, and the cat trembled
  // Only along an axis where the aim is moving: where it stands still (held at the map's edge, or the whole map in view)
  // the cat's rounding moved the whole map instead, 1-2 pixels back and forth under the walking cat (tools/jitter-check.mjs,
  // the map still); there the view is the aim's own, and the cat steps across the still picture
  const ma = Math.abs(a - camView.la) > sub / 4, mb = Math.abs(b - camView.lb) > sub / 4; camView.la = a; camView.lb = b;
  let ea = Math.round(a / sub) * sub, eb = Math.round(b / sub) * sub;
  if (player && A && (ma || mb)) {
    const [pa, pb] = viewOf(player.x, A.groundY(player.x, player.z) + (player.lift || 0), player.z);
    if (ma) ea = snapView(pa) - Math.round((pa - a) / sub) * sub;
    if (mb) eb = snapView(pb) - Math.round((pb - b) / sub) * sub;
  }
  // the camera itself on the picture's own grid (the ground's texels fall on the same pixels wherever it stands); the
  // post pass shifts the picture by what is left, a whole number of screen pixels
  const sa = Math.round(ea / px) * px, sb = Math.round(eb / px) * px, da = sa - a, db = sb - b;
  _camS.set(camT.x + da * X[0] + db * U[0], camT.y + db * U[1], camT.z + da * X[2] + db * U[2]);
  postU.uShift.value.set((sa - ea) / px / Math.max(1, rt.width), (sb - eb) / px / Math.max(1, rt.height));
  cam.position.set(_camS.x + sy * cp * CD, _camS.y + spn * CD, _camS.z + cy * cp * CD); cam.lookAt(_camS);
  cam.top = v / 2; cam.bottom = -v / 2; cam.right = v / 2 * aspect; cam.left = -cam.right; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
}

// a phone showing the page as a desktop site lays it out about 980 px wide and shrinks it to fit the screen: the HUD came
// out at 40%, and the picture was drawn at six times the pixels the screen has (the owner's phone fell to 29 fps). The
// stage is then laid out at the phone's own width and enlarged back, so everything in it is as on the phone (pageS: the
// page's shrink, read off the browser's zoom and the screen's width; 1 everywhere else). The shell's widths are the
// stage's (container units and queries), not the page's
let pageS = 1;
function fitStage() {
  const vv = window.visualViewport, touch = matchMedia('(pointer:coarse)').matches;
  const s = Math.min(1, vv && vv.scale > 0 ? vv.scale : 1, touch && screen.width > 0 ? screen.width / innerWidth : 1);
  pageS = s > .85 ? 1 : s;
  const st = document.getElementById('stage').style, on = pageS < 1;
  st.transformOrigin = on ? '0 0' : ''; st.transform = on ? `scale(${1 / pageS})` : '';
  st.right = st.bottom = on ? 'auto' : ''; st.width = on ? innerWidth * pageS + 'px' : ''; st.height = on ? innerHeight * pageS + 'px' : '';
}

let quality = 1, bw = 0, bh = 0;
function resize() {
  if (!renderer) return;
  // (the canvas's size inside the stage: on a shrunk page its box on the page is the stage's enlargement of it)
  const b = canvas.getBoundingClientRect(), r = { width: b.width * pageS, height: b.height * pageS }; if (r.width < 2 || r.height < 2) return;
  // (the screen's own density, up to 3: capped at 2, a 2.75 phone got a canvas the browser stretched by 1.375 and the art's
  // pixels came out one or two screen pixels wide by turns; the picture keeps its ~600 rows, only the last pass grows)
  const dpr = Math.min(window.devicePixelRatio || 1, 3) * quality; bw = Math.max(2, Math.round(r.width * dpr)); bh = Math.max(2, Math.round(r.height * dpr));
  // the scene is drawn at the screen's resolution divided by a whole number (1, or 2 on a 2x screen) and enlarged by
  // exactly that number: at 1.25 or 0.75 the pixel pattern crawled while the camera moved, even by whole pixels
  // (the low-poly page: about 600 rows, two or three picture pixels to an art pixel at the usual view, every one a block of
  // whole screen pixels)
  const ss = window.__ss || (LP ? 1 / Math.max(1, Math.round(bh / 600)) : 1 / Math.max(1, Math.floor(dpr + .01))); renderer.setSize(bw, bh, false); rt.setSize(Math.max(2, Math.round(bw * ss)), Math.max(2, Math.round(bh * ss)));
  aspect = r.width / r.height; postU.uTexel.value.set(1 / rt.width, 1 / rt.height); postU.uAspect.value = aspect; postU.uSpread.value = LP ? 0 : Math.max(ss, .75); postU.uK.value = LP ? Math.round(1 / ss) : 0;
}

// what the GPU does the first time a thing is drawn (its textures and geometry sent up, its shader compiled) took a frame
// where it was first seen: a few ms here, tens on a phone, three of the farm's chunks at once as the cat walked toward
// them. warmUp does it when the things are made: they are drawn once into one pixel of the picture, in or out of view,
// seen by a camera that sees only them and the scene's lights (so the very shaders the view will use); the shadow map is
// left as it is
const WARM = 7, warmCam = new THREE.OrthographicCamera();
function warmUp(roots) {
  if (!renderer || !roots.length) return;
  scene.traverse((o) => { if (o.isLight) o.layers.enable(WARM); });
  const back = [], shown = roots.map((r) => r.visible);
  for (const r of roots) { r.visible = true; r.traverse((o) => { if (o.isMesh || o.isSprite || o.isPoints || o.isLine) { back.push([o, o.frustumCulled, o.layers.mask]); o.frustumCulled = false; o.layers.set(WARM); } }); }
  warmCam.copy(cam); warmCam.layers.set(WARM);
  const sh = sun.shadow.needsUpdate, target = renderer.getRenderTarget(); sun.shadow.needsUpdate = false;
  renderer.setRenderTarget(rt); renderer.setScissorTest(true); renderer.setScissor(0, 0, 1, 1); renderer.render(scene, warmCam);
  renderer.setScissorTest(false); renderer.setRenderTarget(target); sun.shadow.needsUpdate = sh;
  for (const [o, c, m] of back) { o.frustumCulled = c; o.layers.mask = m; }
  roots.forEach((r, i) => { r.visible = shown[i]; });
}

// ---- engine/31-flicker.js
/* ---------- flicker: a failing ship's lights (an area's "flicker": true) ---------- */
// The light level at game time t: full most of the time, now and then a short dip (to .7, rarely to .35), chosen per
// twelfth of a second by hash2 so the same moment always looks the same (the checks and a replay see one picture).
// A dip lasts one twelfth of a second and the next comes at least half a second later: about one dip every four
// seconds, never a strobe (two dips a second at most, below the three flashes a second that can harm; the test runs
// ten minutes of it: tools/test/shipkit.test.mjs)
const DIP = .02, DIP_GAP = 5;
function lampFlicker(t) {
  const s = Math.floor(t * 12), h = hash2(s, 77);
  if (h >= DIP) return 1;
  for (let k = 1; k <= DIP_GAP; k++) if (hash2(s - k, 77) < DIP) return 1;   // (a dip this soon after another: none)
  return h < DIP * .3 ? .35 : .7;
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
const cardTexture = () => { if (!cardTex) { cardTex = nearest(new THREE.DataTexture(cardPx, CARD_W, CARD_H, THREE.RGBAFormat, THREE.UnsignedByteType)); } return cardTex; };   // (sRGB, decoded in the shader: legacy())

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

// ---- engine/36-look.js
/* ---------- atmosphere: bloom, haze, grading and drifting motes, for areas whose data asks for them ---------- */
// One blurred copy of the picture at a quarter of its size; the post pass (engine/30-render.js) adds its bright part back
// (bloom), mixes toward the sky's colour at the far side (haze) and grades the colours. An area with no atmosphere
// pays nothing: no blur passes, no motes, the post pass as it was. The tilt-shift a first try had
// (the picture blurred above and below a band) was dropped: tiring to look at.
const ATMOS_DEFAULT = { bloom: .8, thr: .35, haze: .1, sat: 1.1 };
// a pool of light around the cat (the post pass): by default in the dark places, the areas whose time is a crypt's or a
// ship's emergency (Chapter 1's crypt, Chapter 3's mines, Chapter 2's failing decks); an atmosphere's "pool" sets its own
const POOL_DARK = { cripta: .8, emergenza: .8 }, _pool = new THREE.Vector3();
const MOTES_LOOK = { embers: [1, .6, .25, 1, 0], dust: [1, .95, .75, .5, 0], ink: [.55, .35, 1, .8, .35] };   // colour, opacity, fall speed
let atmosNow = null, atmosForced, lookSrc = null, lookVal = null;   // (atmosForced: a check's own atmosphere, g.atmos())
const lookOpt = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };
const lookA = new THREE.WebGLRenderTarget(4, 4, lookOpt), lookB = new THREE.WebGLRenderTarget(4, 4, lookOpt);
lookA.texture.generateMipmaps = lookB.texture.generateMipmaps = false; postU.tBlur.value = lookA.texture;
const lookQuad = (frag, uniforms) => {
  const m = new THREE.ShaderMaterial({ uniforms, depthTest: false, depthWrite: false, vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: frag });
  const s = new THREE.Scene(), q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m); q.frustumCulled = false; s.add(q); return { s, m };
};
// the picture made linear and premultiplied as the post pass's tap() reads it, 4x4 texels into one
const lookDown = lookQuad(`precision highp float; uniform sampler2D tSrc; uniform vec2 uT; varying vec2 vUv;
  vec4 lin(vec2 o){ vec4 s = texture2D(tSrc, vUv + o * uT); vec3 c = s.a > 0.001 ? min(s.rgb / s.a, vec3(1.0)) : vec3(0.0); return vec4(c * c * s.a, s.a); }
  void main(){ gl_FragColor = (lin(vec2(-1.0, -1.0)) + lin(vec2(1.0, -1.0)) + lin(vec2(-1.0, 1.0)) + lin(vec2(1.0, 1.0))) * 0.25; }`,
{ tSrc: { value: rt.texture }, uT: { value: new THREE.Vector2() } });
// a 9-tap gaussian in 5 fetches, one direction
const lookBlur = lookQuad(`precision highp float; uniform sampler2D tSrc; uniform vec2 uD; varying vec2 vUv;
  void main(){ vec4 c = texture2D(tSrc, vUv) * 0.2270270270;
    c += (texture2D(tSrc, vUv + uD * 1.3846153846) + texture2D(tSrc, vUv - uD * 1.3846153846)) * 0.3162162162;
    c += (texture2D(tSrc, vUv + uD * 3.2307692308) + texture2D(tSrc, vUv - uD * 3.2307692308)) * 0.0702702703; gl_FragColor = c; }`,
{ tSrc: { value: null }, uD: { value: new THREE.Vector2() } });

// motes: drawn into the picture (so the bloom takes them), drifting on the GPU in a box that follows the camera; ink falls.
// Only over the area itself (uBox): none in the dark around a room
// (Math.random, not R: the game's own random sequence stays as it was)
const MOTES = 180;
const lookMotes = (() => {
  const g = new THREE.BufferGeometry(), p = new Float32Array(MOTES * 3), r = new Float32Array(MOTES * 4), rnd = Math.random;
  for (let i = 0; i < MOTES; i++) { p.set([rnd() * 24, .3 + rnd() * 3.2, rnd() * 24], i * 3); r.set([rnd() * 6.28, .3 + rnd() * .7, (rnd() - .5) * .5, (rnd() - .5) * .5], i * 4); }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('aR', new THREE.BufferAttribute(r, 4));
  const u = { uC: { value: new THREE.Vector3() }, uT: { value: 0 }, uPx: { value: 3 }, uCol: { value: new THREE.Vector3(1, .6, .25) }, uOp: { value: 1 }, uFall: { value: 0 }, uBox: { value: new THREE.Vector4() } };
  const m = new THREE.ShaderMaterial({
    uniforms: u, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    vertexShader: `attribute vec4 aR; uniform vec3 uC; uniform vec4 uBox; uniform float uT, uPx, uFall; varying float vA;
      void main(){ vec3 q = position + vec3(aR.z, 0.0, aR.w) * uT; q.xz = mod(q.xz - uC.xz + 12.0, 24.0) - 12.0 + uC.xz;
        q.y = 0.3 + mod(position.y - 0.3 - uFall * uT, 3.2) + uC.y + sin(uT * 1.3 + aR.x * 3.0) * .25;
        vA = aR.y * (.55 + .45 * sin(uT * 2.1 + aR.x * 5.0)) * step(uBox.x, q.x) * step(q.x, uBox.z) * step(uBox.y, q.z) * step(q.z, uBox.w); gl_PointSize = uPx * (0.6 + aR.y); gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0); }`,
    fragmentShader: `precision highp float; uniform vec3 uCol; uniform float uOp; varying float vA;
      void main(){ float s = 1.0 - smoothstep(0.0, .5, length(gl_PointCoord - .5)); s *= s * vA * uOp; gl_FragColor = vec4(uCol * s, s); }`,
  });
  const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 10; pts.visible = false; scene.add(pts); return { pts, u };
})();

// before the scene is drawn: which atmosphere, its uniforms, the motes
function lookPre() {
  const a = atmosForced !== undefined ? atmosForced : A ? atmosOf(A.def, GAME, settings.atmos !== false) : null;
  atmosNow = a; postU.uHD.value = a ? 1 : 0; postU.uDim.value = dimNow; postU.uPool.value = 0;
  const mo = a && a.motes && MOTES_LOOK[a.motes]; lookMotes.pts.visible = !!mo;
  if (!a) return;
  if (a !== lookSrc) { lookSrc = a; lookVal = Object.assign({}, ATMOS_DEFAULT, a); } const v = lookVal;   // (merged once per atmosphere, not every frame)
  postU.uBloom.value = v.bloom; postU.uThr.value = v.thr; postU.uHaze.value = v.haze; postU.uSat.value = v.sat;
  const pool = v.pool !== undefined ? v.pool : POOL_DARK[A.def.tod] || 0;
  if (pool && player) { _pool.set(player.x, A.groundY(player.x, player.z) + .6, player.z).project(cam); postU.uPool.value = pool; postU.uPoolC.value.set((_pool.x + 1) / 2, (_pool.y + 1) / 2); }
  if (mo) {
    const u = lookMotes.u; u.uC.value.set(camT.x, camT.y * 2, camT.z); u.uT.value = time; u.uPx.value = Math.max(3, rt.height / 120);
    u.uBox.value.set(0, 0, A.W, A.D); u.uCol.value.set(mo[0], mo[1], mo[2]); u.uOp.value = mo[3]; u.uFall.value = mo[4];
  }
}
// after the scene is drawn into rt, before the post pass: the blurred copy
function lookPasses() {
  if (!atmosNow) return;
  const w = Math.max(2, Math.round(rt.width / 4)), h = Math.max(2, Math.round(rt.height / 4));
  if (lookA.width !== w || lookA.height !== h) { lookA.setSize(w, h); lookB.setSize(w, h); }
  lookDown.m.uniforms.uT.value.set(1 / rt.width, 1 / rt.height);
  renderer.setRenderTarget(lookA); renderer.render(lookDown.s, postCam);
  for (let i = 1; i <= 2; i++) {
    lookBlur.m.uniforms.tSrc.value = lookA.texture; lookBlur.m.uniforms.uD.value.set(i / w, 0); renderer.setRenderTarget(lookB); renderer.render(lookBlur.s, postCam);
    lookBlur.m.uniforms.tSrc.value = lookB.texture; lookBlur.m.uniforms.uD.value.set(0, i / h); renderer.setRenderTarget(lookA); renderer.render(lookBlur.s, postCam);
  }
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

// how tall a thing stands (world units): its low-poly model's top where it has one, else most of its picture's height
const thingTops = {};
function thingHeight(key) {
  if (thingTops[key] !== undefined) return thingTops[key];
  const m = lpModel(key); let top = 0;
  if (m) for (const f of m.f) for (const p of f.p) top = Math.max(top, p[1]);
  return (thingTops[key] = m ? top * P : AP.sprites[key].r[3] * P * .75);
}
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
  const tileAt = (x, z) => GT[tyPx(Math.floor(x * PPU), Math.floor(z * PPU))].tile;   // (the legend's tile there: engine/59-ambient.js)
  const ledgeAt = (x, z) => !!GT[tyPx(Math.floor(x * PPU), Math.floor(z * PPU))].ledge;   // (the legend's "ledge": jumped up onto and down off, engine/56-moves.js)
  const swimAt = (x, z) => !!GT[tyPx(Math.floor(x * PPU), Math.floor(z * PPU))].swim;   // (the legend's "swim": water the cat swims in)
  const harmAt = (x, z) => GT[tyPx(Math.floor(x * PPU), Math.floor(z * PPU))].harm || 0;   // (the legend's "harm": ink pools)
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
  const solids = [], acts = [], exits = (def.exits || []).slice(), things = [], blocks = [];   // (blocks: the things' boxes with their height, engine/50-actors.js hiddenShare)
  const solid = (x0, z0, x1, z1) => solids.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) });
  for (const [key, x, z, hx0, hz0, o0] of def.things || []) {
    if (o0 && o0.when && !o0.when()) continue;   // a thing that exists only in some states of the story (a closed gate)
    const s = sp[key]; if (!s) throw new Error(`area ${def.id}: sprite "${key}" is not in the art`);
    const o = Object.assign({}, o0 || {}), d = AP.sprites[key].d || 8;
    let hx = hx0, hz = hz0; if (hx === undefined) { hx = Math.max(.1, s.w * P / 2 - .15); hz = Math.max(.1, d * P / 2 - .15); }
    const px = Math.round(x * PPU) / PPU, pz = Math.round(z * PPU) / PPU;
    if (hx) { const sw = (o.rot || 0) % 2 ? [hz, hx] : [hx, hz]; solid(px - sw[0], pz - sw[1], px + sw[0], pz + sw[1]); blocks.push({ x0: px - sw[0] - .15, z0: pz - sw[1] - .15, x1: px + sw[0] + .15, z1: pz + sw[1] + .15, y0: o.y === undefined ? 0 : o.y, h: thingHeight(key) }); }
    // (the way in under the door its model draws, when it has one on its front: engine/25-lpkit.js LP_DOORS)
    const dx = !o.rot && lpModel(key) && LP_DOORS[key] !== undefined ? LP_DOORS[key] * P * (o.flip ? -1 : 1) : 0;
    if (o.door) { const fz = pz + d * P / 2; exits.push({ rect: [px + dx - .9, fz, px + dx + .9, fz + .7], to: o.door.to, at: o.door.at, face: o.door.face || [0, -1], need: o.door.need }); }
    if (o.look) acts.push({ x: px, z: pz + d * P / 2 + .6, r: 1.4, label: o.look.label, name: o.look.name, lines: o.look.lines });
    things.push({ s, x, z, o });
  }
  for (const [x0, z0, x1, z1] of def.solids || []) solid(x0, z0, x1, z1);

  // walking: map edges, solids, water (not for fliers) and steps higher than def.step art pixels block
  const STEP = (def.step || 3.5) * P;
  const inSolid = (x, z, r) => { for (const s of solids) if (x > s.x0 - r && x < s.x1 + r && z > s.z0 - r && z < s.z1 + r) return true; return false; };
  const FOOT = [[-.22, 0], [.22, 0], [0, -.18], [0, .18]];   // (kept: blocked runs for every mover every step)
  // fly: true over water and gaps (a dash, a flying enemy); 'swim': into the water the legend lets the cat swim in
  function blocked(x, z, fromX, fromZ, fly) {
    const r = .3; if (x < r || z < r || x > W - r || z > D - r) return true;
    if (inSolid(x, z, r)) return true;
    for (const [a, b] of FOOT) { if (fly !== true && isWater(x + a, z + b) && !(fly === 'swim' && swimAt(x + a, z + b))) return true; if (fromX !== undefined && Math.abs(groundY(x + a, z + b) - groundY(fromX, fromZ)) > STEP) return true; }
    return false;
  }
  // a round flies on while the ground stays within a step of where it was fired from (or falls away below it) and no solid
  // thing stands there: the same rule as clear below, so the aim and the rounds agree
  const shotBlocked = (x, z, y0) => x < 0 || z < 0 || x > W || z > D || groundY(x, z) - y0 > STEP || inSolid(x, z, 0);
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
  const LP_STRATA = [0x8a6a4a, 0x7a5c40, 0x93745a, 0x6e5240];   // the low-poly page: level strata, wide, a grass lip
  const LPS = def.strata || LP_STRATA, PXS = def.strata || STRATA;   // (an area may paint its own: content's "strata")
  const edgeCol = (t, k, y, top) => LP ? (top - y <= 3 ? shade(avg(GT[t]), .78) : LPS[Math.floor((top - y + 6) / 11) % LPS.length]) : top - y <= 2 ? shade(avg(GT[t]), .8) : PXS[Math.floor((top - y + (k % 7)) / 7) % PXS.length];
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
    // things whose foot stands in this chunk (the wooden chest is not baked: a prop with a lid, see propMesh; any other
    // container is baked as its model). In the 2D style a thing
    // is its card, and its 3D model is built as well, drawn only into the shadow map: the ground keeps the 3D's shadows
    let shadowS = null; const spins = [];
    for (const th of things) { const px = th.x * PPU, pz = th.z * PPU; if ((th.o.chest && (th.s.key === CHEST.key || (LP && lpModel(th.s.key)))) || px < x0 || px >= x0 + w || pz < z0 || pz >= z0 + h) continue; const o = Object.assign({}, th.o); if (o.y === undefined) o.y = groundY(th.x, th.z) + (o.dy || 0); if (LP && lpModel(th.s.key)) { lpPut(B, lpModel(th.s.key), th.x, th.z, o); spins.push(...lpSpinners(group, lpModel(th.s.key), th.x, th.z, o, chunkLight)); continue; } if (settings.flat) { const c = cardFor(th.s, o.rot); if (c) putLow(c, th.x, th.z, Object.assign({}, o, { rot: 0 })); const keep = S; S = shadowS = shadowS || new SlabBuilder(256); if (th.s.pixel) put(th.s, th.x, th.z, o); if (th.s.low.length) putLow(th.s.low, th.x, th.z, o); S = keep; continue; } if (th.s.pixel) put(th.s, th.x, th.z, o); if (th.s.low.length) putLow(th.s.low, th.x, th.z, o); }
    cardUpload();
    // baked light, meshes
    B.bakeLamps(chunkLight); S.bakeLamps(chunkLight);
    const gPack = new Uint8Array(w * h * 2);
    if (near.length) for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) gPack[(z * w + x) * 2 + 1] = Math.min(255, Math.round(chunkLight((x0 + x + .5) * P, hPx(x0 + x, z0 + z) * P, (z0 + z + .5) * P, 0, 1, 0) * 127.5));
    const gTex = aaFilter(new THREE.CanvasTexture(gCan)); gTex.flipY = false;   // (sRGB, decoded in the shader: legacy())
    const hTex = nearest(new THREE.DataTexture(gPack, w, h, THREE.RGFormat, THREE.UnsignedByteType)); hTex.unpackAlignment = 1; hTex.needsUpdate = true;   // (red: glow, green: lamps)
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
    const halos = lampSpots.filter((p) => p.x * PPU >= x0 && p.x * PPU < x0 + w && p.z * PPU >= z0 && p.z * PPU < z0 + h).map((p) => { const s = new THREE.Sprite(haloMat(def.halo)); s.position.set(p.x, p.y, p.z); s.scale.setScalar(p.r); group.add(s); return s; });
    const tris = B.tris + S.tris + idx.length / 3;
    S = prevS; B = prevB;
    warmUp([group]);   // (its textures and geometry sent up now, not on the frame it comes into view: engine/30-render.js)
    return {
      ci, cj, group, halos, tris, spins, meshes: [staticMesh, slabMesh, gm], wet: water.length > 0,
      // (only in view: every water chunk's whole texture, 768 KiB, went up every 0.4 s, seen or not)
      water(tick) { if (!water.length) return; if (!group.visible) { area.waterSkipped = (area.waterSkipped || 0) + 1; return; } area.waterUp = (area.waterUp || 0) + 1; for (const i of water) put1(i, waterColor(i, tick)); gCtx.putImageData(gImg, 0, 0); gTex.needsUpdate = true; },
      // its geometry, textures and own materials (the ground's, the halos'); the shared ones (things, cards, shadow casters) stay
      dispose() { scene.remove(group); group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); for (const s of halos) s.material.dispose(); gTex.dispose(); hTex.dispose(); matGround.dispose(); },
    };
  }

  /* streaming: the chunks under the view and around the cat stay built (one new chunk per frame); far ones are freed */
  const chunks = new Map(), ckey = (i, j) => i + ',' + j;
  let topH = 0; for (const h of cellH) if (h > topH) topH = h;   // (the map's tallest cell: where a ray toward the camera is past every wall)
  const area = { def, id: def.id, name: def.name, W, D, camNorth: def.camNorth, solids, blocks, top: topH * P, acts, exits, groundY, isWater, swimAt, tileAt, ledgeAt, harm: harmAt, blocked, shotBlocked, clear, lampLight, tris: 0, buildMs: 0, chunkMs: 0, chunks };
  const cwu = ccw * cell, chu = cch * cell;
  const span = ([x0, z0, x1, z1]) => [clamp(Math.floor(x0 / cwu), 0, NI - 1), clamp(Math.floor(z0 / chu), 0, NJ - 1), clamp(Math.floor(x1 / cwu), 0, NI - 1), clamp(Math.floor(z1 / chu), 0, NJ - 1)];
  const want = (x, z) => {
    const pi = Math.floor(x / cwu), pj = Math.floor(z / chu), [i0, j0, i1, j1] = span(viewFoot(3, 1, 9)), out = [];
    for (let j = Math.min(j0, pj); j <= Math.max(j1, pj); j++) for (let i = Math.min(i0, pi); i <= Math.max(i1, pi); i++) if (i >= 0 && j >= 0 && i < NI && j < NJ) out.push([i, j, Math.abs(i - pi) + Math.abs(j - pj)]);
    return out.sort((a, b) => a[2] - b[2]);
  };
  const sync = () => { lamps = [...chunks.values()].flatMap((c) => c.halos); area.allTris = [...chunks.values()].reduce((a, c) => a + c.tris, 0); };
  area.stream = (x, z, all) => {
    // a kept area (built whole and kept): the chunks the view shows at once, however many (a hitch is better than a
    // hole), the others one a frame (all sixteen at once cost some 400 ms on the way in)
    if (def.keep) {
      if (chunks.size >= NI * NJ) return;
      let spare = all ? 0 : 1, n = 0;
      for (let j = 0; j < NJ; j++) for (let i = 0; i < NI; i++) {
        if (chunks.has(ckey(i, j))) continue;
        const now = inView([i * cwu, j * chu, (i + 1) * cwu, (j + 1) * chu], 3, 1, 9); if (!now && !spare) continue; if (!now) spare--;
        const t0 = performance.now(); chunks.set(ckey(i, j), buildChunk(i, j)); area.chunkMs = Math.max(area.chunkMs, performance.now() - t0); n++;
      }
      if (n) { sync(); if (settings.wire) applyWire(); }
      return;
    }
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
// the turning parts of a placed model (LPM.spin), each its own mesh in the chunk's group pivoting on its hub, its lamps
// baked at rest. They cast no shadow (the shadow map is redrawn only when something moves) and turn only while drawn
// (spinStep): a sail out of view costs nothing
function lpSpinners(group, m, x, z, o, light) {
  if (!m.spins) return [];
  const tf = lpTf(o), ox = Math.round(x * PPU) / PPU, oz = Math.round(z * PPU) / PPU;
  return m.spins.map((s, k) => {
    const Bd = new Builder(256), [hx, hy, hz] = s.hub, [a, c] = tf(hx, hz), px = ox + a * P, py = (o.y || 0) + hy * P, pz = oz + c * P;
    lpPut(Bd, m, 0, 0, { rot: o.rot, flip: o.flip, only: k, pivot: s.hub });
    Bd.bakeLamps((X, Y, Z, nx, ny, nz, list) => light(X + px, Y + py, Z + pz, nx, ny, nz, list));
    const mesh = new THREE.Mesh(Bd.geometry(), matStatic), pivot = new THREE.Group(), [ax, az] = s.axis === 'x' ? tf(1, 0) : tf(0, 1);
    mesh.receiveShadow = true; pivot.position.set(px, py, pz); pivot.add(mesh); group.add(pivot);
    const sp = { pivot, axis: new THREE.Vector3(ax, 0, az).normalize(), rate: s.rate, seen: false };
    mesh.onBeforeRender = () => { sp.seen = true; };
    return sp;
  });
}
// turned by the clock (not by the frames: the same angle whenever it is seen again), only those drawn last frame
function spinStep() {
  if (!A || !A.chunks) return;
  for (const c of A.chunks.values()) for (const s of c.spins) if (s.seen) { s.seen = false; s.pivot.quaternion.setFromAxisAngle(s.axis, -time * s.rate * Math.PI * 2); }
}

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
// a lamp's halo, added to the picture as r128 added it: alpha too by its own alpha (r186's additive adds alpha whole,
// and the post pass reads alpha), its gradient drawn as stored and encoded on the way out like the rest (legacy)
const haloMat = (c) => legacy(new THREE.SpriteMaterial({ map: haloTex, color: c || 0xff9440, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.SrcAlphaFactor, blendDstAlpha: THREE.OneFactor, depthWrite: false, transparent: true, opacity: 0 }), false);

// ---- engine/50-actors.js
/* ---------- actors: flat figures from a frame atlas, always facing the camera, feet on the ground ---------- */
// views: { down, up, side } row names of a frames sheet (side faces right; left is the side view mirrored)
// anims: { name: [frames] or { down: [..], up: [..], side: [..] } }; a frame is a name inside the view's row or a full
// 'row.frame'. idle and walk are required; a.anim (with a.at, seconds into it, and a.fps) plays any other one.
const actors = [];
// a figure's shadow caster, drawn invisible: it carries its sheet and cut-out because three r186 gives the caster's
// depth material the drawn material's map and alpha test before each shadow draw (one per sheet, as the textures)
const casterMats = {};
const casterMat = (sheet, tex) => casterMats[sheet] || (casterMats[sheet] = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide, map: tex, alphaTest: .5 }));

// one texture per sheet for all its figures (each figure once uploaded its own copy of the whole sheet)
const sheetTexs = {};
function sheetTex(sheet) {
  if (!sheetTexs[sheet]) { const t = nearest(new THREE.CanvasTexture(lpSheetCanvas(sheet))); sheetTexs[sheet] = t; }   // (sRGB, decoded in the shader)
  return sheetTexs[sheet];
}
// a frame of the sheet on a figure's plane (PlaneGeometry's corners: top left, top right, bottom left, bottom right)
function setFrame(geo, r, SH) {
  const u0 = r.x / SH.w, u1 = (r.x + r.w) / SH.w, v0 = 1 - (r.y + r.h) / SH.h, v1 = 1 - r.y / SH.h, uv = geo.attributes.uv;
  uv.setXY(0, u0, v1); uv.setXY(1, u1, v1); uv.setXY(2, u0, v0); uv.setXY(3, u1, v0); uv.needsUpdate = true;
}
// the see-through: when walls or things hide half of a figure or more, it shows through them as a pale silhouette, on
// the hidden pixels only: its own frame drawn again after the scene, kept to the pixels whose depth is already nearer
// (GreaterDepth; pulled a hair toward the camera so the figure's own pixels never pass). A child of its mesh: it moves,
// turns, flips and blinks with it. One draw, and only while it shows
function xrayFigure(a, col) {
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthFunc: THREE.GreaterDepth, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    uniforms: { uMap: { value: a.tex }, uCol: { value: new THREE.Color(col === undefined ? 0xf4ecd8 : col) }, uA: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D uMap; uniform vec3 uCol; uniform float uA; varying vec2 vUv; void main(){ if (texture2D(uMap, vUv).a < 0.5) discard; gl_FragColor = vec4(uCol, uA); }' });
  const g = new THREE.Mesh(a.mesh.geometry, m); g.renderOrder = 8; g.userData.xray = true; g.visible = false; a.mesh.add(g);
  a.xray = { mesh: g, t: 0, on: false, share: 0 };
  return g;
}
// how much of a figure standing at (x, z) the map's walls and the area's things hide (pure: 0 to 1): a ray toward the
// camera (dir, a unit vector) from each of 15 points on its body (body: its drawn width and height, right: the screen's
// right in the world), against the map's heights (groundY, up to top) and the things' boxes (blocks). Figures never
// count: an enemy in front is no reason for an x-ray
function hiddenShare(x, z, dir, right, body, groundY, blocks, top) {
  const y0 = groundY(x, z), near = blocks.filter((b) => b.x1 > x - 12 && b.x0 < x + 12 && b.z1 > z - 12 && b.z0 < z + 12);
  let hid = 0;
  for (const sx of [.2, .5, .8]) for (const fy of [.1, .3, .5, .7, .9]) {
    const off = body.x0 + sx * (body.x1 - body.x0), px = x + right[0] * off, pz = z + right[2] * off, py = y0 + fy * body.h;
    let hit = false;
    for (let t = .1; !hit && py + dir[1] * t <= top; t += .1) { const qx = px + dir[0] * t, qz = pz + dir[2] * t; if (groundY(qx, qz) > py + dir[1] * t + 1e-3) hit = true; }
    for (const b of near) {
      if (hit) break;
      // the ray against the box (slabs): entered before it leaves, ahead of the point
      let t0 = 1e-3, t1 = 1e9;
      for (const [o, d, lo, hi] of [[px, dir[0], b.x0, b.x1], [py, dir[1], b.y0, b.y0 + b.h], [pz, dir[2], b.z0, b.z1]]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = 1; t1 = 0; } continue; }
        const ta = (lo - o) / d, tb = (hi - o) / d; t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
      }
      if (t0 < t1) hit = true;
    }
    if (hit) hid++;
  }
  return hid / 15;
}
// the x-ray's switch, a few times a second: on at half hidden, off under a third (no flicker at the edge), faded in
// and out over a fifth of a second
const _xd = new THREE.Vector3();
function xrayTick(a, dt) {
  const X = a.xray; if (!X || !A) return;
  if ((X.t -= dt) <= 0) {
    X.t = .1; cam.getWorldDirection(_xd).negate();
    const g = a.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox(); const bb = g.boundingBox, k = Math.abs(a.mesh.scale.x), w = (bb.max.x - bb.min.x) * k, h = (bb.max.y - bb.min.y) * a.mesh.scale.y;
    // (the cat's drawing fills about the middle third of its frame's width and four fifths of its height)
    const body = { x0: (bb.min.x * k) + .35 * w, x1: (bb.min.x * k) + .66 * w, h: .82 * h };
    X.share = hiddenShare(a.x, a.z, [_xd.x, _xd.y, _xd.z], [Math.cos(yaw), 0, -Math.sin(yaw)], body, A.groundY, A.blocks || [], A.top || 4);
    X.on = X.share >= .5 || (X.on && X.share >= .35);
  }
  const u = X.mesh.material.uniforms.uA; u.value = Math.max(0, Math.min(.55, u.value + (X.on ? 1 : -1) * dt * 2.75)); X.mesh.visible = u.value > .01;
}
function sheetActor(sheet, views, anims, o) {
  const SH = SHEETS[sheet]; if (!SH) throw new Error('actor: sheet "' + sheet + '" is not in the art');
  const idle0 = Array.isArray(anims.idle) ? anims.idle[0] : anims.idle.down[0], first = SH.meta.sprites[idle0.includes('.') ? idle0 : views.down + '.' + idle0];
  if (!first) throw new Error(`actor: frame "${views.down}.${idle0}" missing in ${sheet}`);
  const cw = first.w, ch = first.h, [L, U] = first.anchor || [Math.floor(cw / 2), ch];
  const a = Object.assign({ x: 0, z: 0, fx: 0, fz: 1, step: 0, moving: false, anim: null, at: 0, fps: 10, lift: 0, blink: false, size: 1, probe: new THREE.Vector3(), lampL: { value: 0 } }, o || {});
  a.tex = sheetTex(sheet);   // shared by every figure of the sheet: the frame is chosen in the plane's UVs (setFrame)
  const g = new THREE.PlaneGeometry(cw * P, ch * P); g.translate((cw / 2 - L) * P, (U - ch / 2) * P, 0);   // the anchor (feet) at the origin
  const gl = g.clone(), n = gl.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);   // normal up: light does not change when the view turns
  a.mesh = new THREE.Mesh(gl, voxelMaterial('sprite', { map: a.tex, probe: a.probe, lampL: a.lampL, row: new THREE.Vector2(SPR_Y * P, P) }));
  a.mesh.material.side = THREE.DoubleSide; a.mesh.receiveShadow = true;
  a.caster = new THREE.Mesh(g, casterMat(sheet, a.tex)); a.caster.castShadow = true;
  a.caster.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: a.tex, alphaTest: .5, side: THREE.DoubleSide });
  scene.add(a.mesh); scene.add(a.caster);

  const frame = (row, name) => SH.meta.sprites[name.includes('.') ? name : row + '.' + name] || first;
  const listOf = (name, view) => { const L = anims[name]; return !L ? null : Array.isArray(L) ? L : L[view]; };
  a.pose = () => {
    // far away (enemiesStep: over 40 units): not drawn, not casting, not posed
    if (a.far) { a.mesh.visible = a.caster.visible = false; return; }
    a.caster.visible = true;
    const side = a.fx * Math.cos(yaw) - a.fz * Math.sin(yaw), toward = a.fx * Math.sin(yaw) + a.fz * Math.cos(yaw);
    const sideView = Math.abs(side) > Math.abs(toward), view = sideView ? 'side' : toward > 0 ? 'down' : 'up', row = views[view], flip = sideView && side < 0;
    const own = a.anim && listOf(a.anim, view), list = own || (a.swim && listOf('swim', view)) || listOf(a.moving ? 'walk' : 'idle', view);
    const i = own ? Math.min(list.length - 1, Math.floor(a.at * a.fps)) : Math.floor(a.step) % list.length, r = frame(row, list[i]);
    if (a.frame !== r) { a.frame = r; setFrame(gl, r, SH); setFrame(g, r, SH); }
    const y = A.groundY(a.x, a.z), sx = Math.sin(cur.az), sz = Math.cos(cur.az), k = a.size;
    // on the figures' grid in the view (setCamera): placed anywhere, the figure's texels fell on the picture's pixels
    // differently from frame to frame, and its place on screen against the view's stepped back and forth
    const [va, vb] = viewOf(a.x, y + a.lift, a.z), ma = snapView(va) - va, mb = snapView(vb) - vb, X = camView.X, U = camView.U;
    a.mesh.visible = !a.blink; a.mesh.position.set(a.x + ma * X[0] + mb * U[0], y + a.lift + mb * U[1], a.z + ma * X[2] + mb * U[2]); a.mesh.rotation.y = yaw; a.mesh.scale.set((flip ? -1 : 1) * k, SPR_Y * k, k);
    // a hit's white flash (hitFx), else a gold glow (an item's card: engine/70-ui.js itemCard)
    const lit = a.flash > 0 ? 2 : a.glow ? 1 : 0;
    if (lit !== (a.lit || 0)) { a.lit = lit; if (lit === 2) a.mesh.material.emissive.setScalar(.9); else if (lit) a.mesh.material.emissive.setRGB(.2, .13, .02); else a.mesh.material.emissive.setScalar(0); }
    a.caster.position.set(a.x, y + a.lift, a.z); a.caster.rotation.y = cur.az; a.caster.scale.set((flip ? -1 : 1) * k, k, k);
    a.probe.set(a.x + sx * .2, y, a.z + sz * .2); a.lampL.value = A.lampLight(a.x, y + .6, a.z, 0, 1, 0);
  };
  a.dispose = () => { scene.remove(a.mesh); scene.remove(a.caster); a.mesh.geometry.dispose(); a.caster.geometry.dispose(); a.mesh.material.dispose(); a.caster.customDepthMaterial.dispose(); actors.splice(actors.indexOf(a), 1); };
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
  const t = nearest(new THREE.CanvasTexture(lpSheetCanvas(sheet)));   // (sRGB, decoded in the shader: legacy())
  return (flatTex[sheet] = legacy(new THREE.MeshBasicMaterial({ map: t, alphaTest: .5, side: THREE.DoubleSide })));
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
  const r = { width: canvas.clientWidth, height: canvas.clientHeight };   // (inside the stage, as the floats are placed)
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
// the levels (game.json "levels"): xp[n] the XP to reach level n, base.hp [at level 1, more a level]; the last level is the cap
const maxLevel = () => GAME.levels.xp.length - 1;
// each chapter keeps its own slot (game.json "chapter.save"; Chapter 1's is the first game's key, so its saves need no
// migration). A save code carries its chapter as a 16th field; codes made before chapters have 15: Chapter 1's
const SAVE_V = 1, LEGACY_CHAPTER = 'chapter1';
const saveKey = () => GAME.chapter.save;
let G = null;

function newGame() {
  G = { v: SAVE_V, area: GAME.start.area, x: null, z: null, hp: 1, ink: 0, xp: 0, level: 1, coins: 0, inv: {}, eq: Object.assign({}, GAME.hero.equip), quests: {}, flags: {}, opened: {}, seen: {} };
  const S = GAME.hero.start;   // a later chapter's hero starts where its story finds the cat (game.json "hero.start")
  if (S) { if (S.level) { G.level = Math.min(S.level, maxLevel()); G.xp = GAME.levels.xp[G.level]; } G.coins = S.coins || 0; for (const f of S.flags || []) G.flags[f] = true; Object.assign(G.inv, S.inv || {}); }
  G.hp = stats().hp; G.ink = stats().ink;
}
// the hero's numbers depend on the level and the three slots only: kept until one of them changes (read every frame by
// the HUD and the combat; the object is shared, read it, never write it)
let statsKey = '', statsVal = null;
function stats() {
  const key = G.level + '|' + G.eq.weapon + '|' + G.eq.armour + '|' + G.eq.charm; if (key === statsKey) return statsVal;
  const L = G.level - 1, eq = Object.values(G.eq).filter(Boolean).map((k) => ITEMS[k] || {});
  const sum = (f) => eq.reduce((a, i) => a + (i[f] || 0), 0);
  const b = GAME.levels.base, at = (k) => b[k][0] + L * b[k][1] + sum(k); statsKey = key; statsVal = Object.freeze({ hp: at('hp'), ink: at('ink'), atk: at('atk'), def: at('def') });
  return statsVal;
}
const xpToNext = () => G.level >= maxLevel() ? 0 : GAME.levels.xp[G.level + 1] - G.xp;
function gainXp(n) {
  G.xp += n;
  while (G.level < maxLevel() && G.xp >= GAME.levels.xp[G.level + 1]) {
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
  const s = stats(); G.hp = Math.min(G.hp, s.hp); G.ink = Math.min(G.ink, s.ink); if (hero.gun) clampGun(hero.gun); sfx('item'); return true;
}
// an item to wear against the one worn in its slot: { worn: id | null, diff: [[stat, change]] } (the stats that change),
// null for an item not worn
const BONUS_STATS = ['atk', 'def', 'hp', 'ink', 'mag'];   // (mag: rounds added to the cylinder)
function equipDiff(id) {
  const it = ITEMS[id]; if (!it || !it.slot) return null;
  const worn = G.eq[it.slot] || null, w = (worn && ITEMS[worn]) || {};
  return { worn, diff: BONUS_STATS.map((k) => [k, (it[k] || 0) - (w[k] || 0)]).filter(([, d]) => d) };
}
function useItem(id) {
  const it = ITEMS[id]; if (!it || !it.use || !G.inv[id]) return false;
  const s = stats(); if (it.use.hp && G.hp >= s.hp && !it.use.ink) return false;
  if (it.use.hp) G.hp = Math.min(s.hp, G.hp + it.use.hp); if (it.use.ink) G.ink = Math.min(s.ink, G.ink + it.use.ink);
  takeItem(id); sfx('item'); if (player) floatText('+' + (it.use.hp || it.use.ink), player.x, 2, player.z, it.use.hp ? 'heal' : 'ink'); return true;
}

/* the save: the browser keeps one slot; the code carries the same data as text a person can copy */
function snapshot() { const s = JSON.parse(JSON.stringify(G)); if (player && A) { s.area = A.def.id; s.x = +player.x.toFixed(2); s.z = +player.z.toFixed(2); } return s; }
function saveGame() { if (!G) return false; try { localStorage.setItem(saveKey(), JSON.stringify(snapshot())); return true; } catch (e) { return false; } }
function loadSave() { try { const s = JSON.parse(localStorage.getItem(saveKey())); return checkSave(s); } catch (e) { return null; } }
const hasSave = () => !!loadSave();
// the slot as the title shows it: none, ok, or broken (there, but unreadable or for areas this chapter does not have:
// New game starts the chapter afresh over it, the other chapters' slots untouched)
function saveState() { let raw = null; try { raw = localStorage.getItem(saveKey()); } catch (e) { return 'none'; } if (raw === null) return 'none'; try { return checkSave(JSON.parse(raw)) ? 'ok' : 'broken'; } catch (e) { return 'broken'; } }
function checkSave(s) {
  if (!s || typeof s !== 'object' || typeof s.v !== 'number' || s.v > SAVE_V || !AREAS[s.area]) return null;
  // older saves miss newer fields and a hand-edited or damaged one may hold anything: records that are not records and
  // numbers that are not numbers take the defaults
  const rec = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {}), num = (n, d) => (Number.isFinite(n) ? n : d);
  // a quest's state is { s: its step, n: its count }; any other shape (a hand-edited { main: 1 }) crashed the game at play
  // start, so the save is refused instead: the title calls it unreadable (saveState) and New game starts afresh
  if (Object.values(rec(s.quests)).some((q) => !q || typeof q !== 'object' || !Number.isInteger(q.s) || q.s < 0 || !Number.isFinite(q.n))) return null;
  return Object.assign({}, s, {
    inv: rec(s.inv), quests: rec(s.quests), flags: rec(s.flags), opened: rec(s.opened), seen: rec(s.seen), eq: Object.assign({}, GAME.hero.equip, rec(s.eq)),
    coins: Math.max(0, num(s.coins, 0)), xp: Math.max(0, num(s.xp, 0)), level: Math.min(maxLevel(), Math.max(1, Math.round(num(s.level, 1)))), hp: num(s.hp, 0), ink: num(s.ink, 0),
    x: Number.isFinite(s.x) ? s.x : null, z: Number.isFinite(s.z) ? s.z : null,
  });
}

// code: JSON → UTF-8 → base32 (no look-alike letters) with a CRC-32, in groups of five
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function crc32(bytes) { let c = ~0; for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; } return ~c >>> 0; }
function encodeCode(fields) {
  const data = new TextEncoder().encode(JSON.stringify(fields)), crc = crc32(data), bytes = new Uint8Array(data.length + 4);
  bytes.set(data); bytes.set([crc >>> 24, crc >>> 16 & 255, crc >>> 8 & 255, crc & 255], data.length);
  let bits = 0, acc = 0, out = '';
  for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { out += B32[(acc >>> (bits - 5)) & 31]; bits -= 5; } acc &= (1 << bits) - 1; }
  if (bits) out += B32[(acc << (5 - bits)) & 31];
  return out.match(/.{1,5}/g).join('-');
}
function saveCode() {
  const s = snapshot();
  return encodeCode([s.v, s.area, s.x, s.z, s.hp, s.ink, s.xp, s.level, s.coins, s.inv, s.eq, s.quests, Object.keys(s.flags), Object.keys(s.opened), Object.keys(s.seen), CHAPTER_ID]);
}
function decodeCode(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length < 16) return { error: 'code.short' };
  const bytes = []; let bits = 0, acc = 0;
  for (const ch of clean) { const v = B32.indexOf(ch); if (v < 0) return { error: 'code.char', ch }; acc = (acc << 5) | v; bits += 5; if (bits >= 8) { bytes.push((acc >>> (bits - 8)) & 255); bits -= 8; acc &= (1 << bits) - 1; } }
  const data = Uint8Array.from(bytes.slice(0, -4)), c = bytes.slice(-4), crc = crc32(data);
  if (((c[0] << 24 | c[1] << 16 | c[2] << 8 | c[3]) >>> 0) !== crc) return { error: 'code.crc' };
  try { const fields = JSON.parse(new TextDecoder().decode(data)); return Array.isArray(fields) ? { fields } : { error: 'code.crc' }; } catch (e) { return { error: 'code.crc' }; }
}
// another chapter's code comes back as { chapter } alone: it is checked once that chapter is loaded (engine/66-chapters.js)
function readCode(text) {
  const d = decodeCode(text); if (d.error) return d;
  const [v, area, x, z, hp, ink, xp, level, coins, inv, eq, quests, flags, opened, seen, chapter = LEGACY_CHAPTER] = d.fields;
  if (chapter !== CHAPTER_ID) return { chapter: String(chapter) };
  const set = (a) => Object.fromEntries((Array.isArray(a) ? a : []).map((k) => [k, true]));
  const s = checkSave({ v, area, x, z, hp, ink, xp, level, coins, inv, eq, quests, flags: set(flags), opened: set(opened), seen: set(seen) });
  return s ? { save: s, chapter } : { error: 'code.version' };
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
const SKILLS = { dash: { ink: 10 }, well: { ink: 15 }, scan: { ink: 8 }, fan: { ink: 12 } };
// the revolver (a chapter whose hero has a "gun"): held, it fires at its rate from a cylinder; empty, a full reload; a
// while after the last round, the rounds come back one by one (firing again stops that)
const GUN_IDLE = .8, GUN_REFILL = .15, GUN_CRIT = .1, GUN_NEAR = 5;   // (GUN_NEAR: with no one in the cone, the nearest this close, any side)
const gunOn = () => !!(GAME.hero && GAME.hero.gun) && (!GAME.hero.gun.flag || !!(G && G.flags[GAME.hero.gun.flag]));   // (a gun may wait for its story flag: the quill till then)
// one step of the cylinder: 1 when a round leaves. (Pure: st.reloaded tells the caller to play the reload)
function gunStep(st, dt, held, cfg) {
  st.cool = Math.max(0, st.cool - dt); st.idle += dt;
  if (st.reload > 0) { st.reload -= dt; if (st.reload <= 0) { st.reload = 0; st.mag = cfg.mag; st.reloaded = true; } return 0; }
  if (held) {
    if (st.cool > 0) return 0;
    if (st.mag <= 0) { st.reload = cfg.reload; return 0; }
    st.mag--; st.cool = 1 / cfg.rate; st.idle = 0; st.refill = 0; if (st.mag === 0) st.reload = cfg.reload; return 1;
  }
  if (st.idle >= GUN_IDLE && st.mag < cfg.mag) { st.refill += dt; if (st.refill >= GUN_REFILL) { st.refill -= GUN_REFILL; st.mag++; } }
  return 0;
}
// the gun as the gear makes it: an item worn may add rounds to the cylinder ("mag"); kept until the gear (or the chapter) changes
let gunKey = '', gunSrc = null, gunVal = null;
function gunCfg() {
  const eq = (G && G.eq) || {}, key = eq.weapon + '|' + eq.armour + '|' + eq.charm; if (key === gunKey && gunSrc === GAME.hero.gun && gunVal) return gunVal;
  const more = Object.values(eq).filter(Boolean).reduce((a, k) => a + ((ITEMS[k] || {}).mag || 0), 0);
  gunKey = key; gunSrc = GAME.hero.gun; gunVal = Object.create(GAME.hero.gun, { mag: { value: GAME.hero.gun.mag + more, enumerable: true } }); return gunVal;   // (the chapter's gun beneath: a later edit of it shows through)
}
const clampGun = (st) => { if (st && st.mag > gunCfg().mag) st.mag = gunCfg().mag; };   // (the gear that gave the rounds taken off)
const newGun = () => (gunOn() ? { mag: gunCfg().mag, cool: 0, reload: 0, idle: 0, refill: 0, reloaded: false } : null);
// ground that hurts (a legend's "harm", the ink pools): a first touch at once, then every HARM_EVERY while standing on it;
// never while safe (dodging, dead, a dialogue open). (Pure: true when it bites; the caller hurts the cat.) A little longer
// than the hurt i-frames: every bite lands, one a second or so
const HURT_INV = 1.1, HARM_EVERY = 1.15;
function harmStep(st, dt, harm, safe) {
  if (!harm || safe) { st.t = 0; return false; }
  st.t -= dt; if (st.t > 0) return false; st.t = HARM_EVERY; return true;
}
const SCAN_R = 6;   // how far the scanner reaches, in world units
const hero = { swing: -1, st: 0, queued: false, grace: 0, last: -1, hitSet: null, dodge: 0, cd: 0, dx: 0, dz: 0, dash: false, inv: 0, hurt: 0, kx: 0, kz: 0, dead: 0 };
let shakeT = 0, combatT = 0;
const INK_REGEN = 2;
const POISE_CD = 1.2;   // seconds after a stagger before the next one   // ink per second while nothing is fighting the cat

const dmgRoll = (atk, def, mult) => Math.max(1, Math.round((atk * (mult || 1) - def) * (.9 + R() * .2)));
const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// waiting: after BORED seconds without a move the cat turns to the camera, yawns, sits and now and then licks a paw (the
// hero's "bored" frames, seen from the front: GAME.hero.anims.bored.down, played at 2 a second, the yawn once, the rest
// over and over); any move, blow or dodge stands it up. Never while it swims (it sat on the water), and while it waits it
// keeps facing the camera, turned or not (turning the view showed a frame the front had not, and the wait was gone)
const BORED = 6, BORED_YAWN = 3;
function boredStep(dt) {
  const L = GAME.hero && GAME.hero.anims.bored && GAME.hero.anims.bored.down; if (!L) return;
  const waiting = player.anim === 'bored', still = !hero.dead && !hero.move && !player.moving && !player.swim && (!player.anim || waiting);
  hero.still = still ? (hero.still || 0) + dt : 0;
  if (!still) { if (waiting) player.anim = null; return; }
  if (!waiting && hero.still >= BORED) { player.anim = 'bored'; player.at = 0; player.fps = 2; player.fx = Math.sin(yaw); player.fz = Math.cos(yaw); }
  if (player.anim === 'bored') { player.fx = Math.sin(yaw); player.fz = Math.cos(yaw); if (player.at * player.fps >= L.length) player.at = BORED_YAWN / player.fps; }
}
function resetHero() { if (player) player.lift = 0; Object.assign(hero, { move: null, pushT: 0, swing: -1, st: 0, queued: false, grace: 0, last: -1, dodge: 0, cd: 0, inv: 0, hurt: 0, kx: 0, kz: 0, dead: 0, dash: false, gun: newGun(), shootT: 0, shootAnim: null, holdOff: false, lock: null }); if (player) player.anim = null; }

/* the cat */
function heroAttack() {
  if (hero.dead || hero.dodge > 0 || hero.hurt > 0 || player.swim || hero.move) return;
  if (hero.swing >= 0) { hero.queued = true; return; }   // remembered: the next swing starts when this one ends
  startSwing(hero.grace > 0 && hero.last < 2 ? hero.last + 1 : 0);
}
function startSwing(i) {
  hero.shootT = 0;   // (a shot's pose ends: it must not cut the swing short)
  const [ix, iy] = moveVector();
  if (Math.hypot(ix, iy) > .3) { const [mx, mz] = screenToWorld(ix, iy); const l = Math.hypot(mx, mz); player.fx = mx / l; player.fz = mz / l; }
  else { const e = nearestEnemy(2.4); if (e) { const l = near(e, player) || 1; player.fx = (e.x - player.x) / l; player.fz = (e.z - player.z) / l; } }
  Object.assign(hero, { swing: i, st: 0, queued: false, hitSet: new Set() });
  player.anim = 'attack' + (i + 1); player.at = 0; player.fps = 3 / SWINGS[i].dur; sfx(SWINGS[i].sfx);
}
function heroDodge(skill) {
  if (hero.dead || hero.hurt > 0 || hero.dodge > 0 || (!skill && hero.cd > 0) || player.swim || hero.move) return;
  if (skill) {
    if (!G.flags['skill_' + skill]) { toast(t('toast.locked')); sfx('no'); return; }
    if (skill === 'scan' && combatT > 0) { floatText(t('fx.scan.busy'), player.x, 1.8, player.z, 'ink'); sfx('no'); return; }   // (a find rebuilds the area: never in a fight)
    if (G.ink < SKILLS[skill].ink) { floatText(t('fx.noink'), player.x, 1.8, player.z, 'ink'); sfx('no'); return; }
    G.ink -= SKILLS[skill].ink;
    if (skill === 'well') { inkwell(); return; }
    if (skill === 'scan') { scan(); return; }
    if (skill === 'fan') { fan(); return; }
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
  for (const e of enemies) if (e.hp > 0 && near(e, player) < 3.4) { e.slow = 4; hitEnemy(e, dmgRoll(s.atk, e.T.def, .7), 4, false, false, false, HOLD.heavy); }
  crittersNear(player.x, player.z, 3.4);
}
// the scanner: a ring of ink; what is written in hidden ink nearby is found (its flag set) and the area shown again with it
function scan() {
  fx('ink_splash', player.x, player.z, { size: 3, fps: 9 }); sfx('notice');
  const found = scanAround(A.def.things || [], G.flags, player.x, player.z, SCAN_R);
  if (!found.length) { floatText(t('fx.scan.none'), player.x, 1.8, player.z, 'ink'); return; }
  for (const f of found) setFlag(f); toast(t('toast.scan', { n: found.length })); reopen();
}
function hurtHero(atk, fromX, fromZ) {
  if (hero.inv > 0 || hero.dead || !G) return;
  const d = dmgRoll(atk, stats().def); G.hp = Math.max(0, G.hp - d);
  const l = Math.hypot(player.x - fromX, player.z - fromZ) || 1;
  Object.assign(hero, { swing: -1, queued: false, dodge: 0, hurt: .28, inv: HURT_INV, kx: (player.x - fromX) / l * 7, kz: (player.z - fromZ) / l * 7 });
  player.anim = 'hurt'; player.at = 0; floatText('-' + d, player.x, 1.8, player.z, 'bad'); sfx('hurt'); shake(.25);
  if (G.hp <= 0) { hero.dead = 1.4; sfx('over'); clearShots(); }
}
const shake = (s) => { if (settings.shake) shakeT = Math.max(shakeT, s); };
// hit effects (a chapter's "hitFx"; screen shake off turns them off too): the simulation held a moment, the view nudged in
let hitstopT = 0, kick = 0;
const hitstop = (s) => { if (GAME.hitFx && settings.shake) hitstopT = Math.max(hitstopT, s); };
// how long each hit holds it (seconds): every hit, scaled by its weight as fighting games do (a round least, the combo's
// third blow and the dash more, a kill more again); all well under 0.2 s, past which a hold reads as lag
const HOLD = { shot: .02, blow: .045, heavy: .075, kill: .06, boss: .1 };
const zoomKick = (k) => { if (GAME.hitFx && settings.shake) kick = Math.max(kick, k); };   // (the low-poly page: the picture nudged in the post pass, its camera's pixel steps untouched)
// the lights going down (a boss's dark): the picture darkened toward lookDim's value, the bright things still glowing
// (engine/30-render.js's post pass, only with the atmosphere on: its tells read through the bloom); back up at once on
// every area built (engine/62-world.js populate) and on the title screen
let dimNow = 1, dimTo = 1;
const lookDim = (v) => { dimTo = v; };
const resetDim = () => { dimNow = dimTo = 1; };
const dimStep = (cur, to, dt) => (cur < to ? Math.min(to, cur + dt * 2.5) : Math.max(to, cur - dt * 2.5));

// screen-space stick → world direction (the same turn the walk uses)
const screenToWorld = (ix, iy) => [Math.cos(yaw) * ix - Math.sin(yaw) * iy, -Math.sin(yaw) * ix - Math.cos(yaw) * iy];

function heroStep(dt) {
  const s = stats();
  hero.inv = Math.max(0, hero.inv - dt); hero.cd = Math.max(0, hero.cd - dt); hero.grace = Math.max(0, hero.grace - dt);
  if (combatT <= 0 && !hero.dead && G.ink < s.ink) G.ink = Math.min(s.ink, G.ink + dt * INK_REGEN);   // ink seeps back out of combat, so a dash is never out of reach for good
  // the revolver: held (not since a dialogue opened under the finger), the cylinder turns; its rounds leave in the walk below
  const cfg = gunOn() && gunCfg();
  if (cfg && !hero.gun) hero.gun = newGun();
  if (cfg) clampGun(hero.gun);
  const harm = A.harm ? A.harm(player.x, player.z) : 0;   // (an attack strength, as an enemy's: defence and the hurt i-frames apply)
  if (harmStep(hero.harmSt || (hero.harmSt = { t: 0 }), dt, harm, hero.dodge > 0 || !!hero.dead || !!dlg)) hurtHero(harm, player.x, player.z);
  if (moveStep(dt)) return;   // (a jump or a climb under way: engine/56-moves.js)
  if (!fireHeld()) hero.holdOff = false;
  const firing = !!cfg && !dlg && !hero.holdOff && fireHeld() && !hero.dead && hero.hurt <= 0 && hero.dodge <= 0 && hero.swing < 0;
  const due = cfg ? gunStep(hero.gun, dt, firing, cfg) : 0;
  if (cfg && hero.gun.reloaded) { hero.gun.reloaded = false; sfx('reload'); }
  if (hero.shootT > 0 && (hero.shootT -= dt) <= 0 && player.anim === hero.shootAnim) player.anim = null;
  player.blink = hero.inv > 0 && hero.dodge <= 0 && Math.floor(hero.inv * 16) % 2 === 1;
  if (player.anim) player.at += dt;
  const go = (vx, vz) => { const nx = player.x + vx * dt, nz = player.z + vz * dt; if (!A.blocked(nx, player.z, player.x, player.z, 'swim')) player.x = nx; if (!A.blocked(player.x, nz, player.x, player.z, 'swim')) player.z = nz; };
  // swimming (the legend's "swim" water: engine/40-area.js): at 0.6 the speed, in the hero's "swim" frames, a splash going in
  const wet = A.isWater(player.x, player.z) && A.swimAt(player.x, player.z);
  if (wet !== !!player.swim) { player.swim = wet; sfx(wet ? 'splash' : 'step'); }
  if (hero.dead) { hero.dead -= dt; player.moving = false; if (hero.dead <= 0) gameOver(); return; }
  if (hero.hurt > 0) {
    hero.hurt -= dt; go(hero.kx, hero.kz); hero.kx *= Math.pow(.02, dt); hero.kz *= Math.pow(.02, dt); player.moving = false;
    if (hero.hurt <= 0) player.anim = null; return;
  }
  if (hero.dodge > 0) {
    hero.dodge -= dt; const v = hero.dash ? 19 : 15; player.moving = false;
    if (hero.dash) { const nx = player.x + hero.dx * v * dt, nz = player.z + hero.dz * v * dt; if (!A.blocked(nx, nz, player.x, player.z, true)) { player.x = nx; player.z = nz; } } else go(hero.dx * v, hero.dz * v);
    if (hero.dash) for (const e of enemies) if (e.hp > 0 && !hero.hitSet.has(e) && near(e, player) < e.T.r + .6) { hero.hitSet.add(e); hitEnemy(e, dmgRoll(s.atk, e.T.def, 1.3), 5, true, false, false, HOLD.heavy); }
    if (hero.dash) crittersNear(player.x, player.z, .9);
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
      hitEnemy(e, back ? 1 : dmgRoll(s.atk, e.T.def, sw.dmg), sw.push, true, back, false, hero.swing === 2 ? HOLD.heavy : HOLD.blow);
    }
    if (hero.st >= sw.hit) crittersSwing(sw.reach, sw.arc, hero.hitSet);
    if (hero.st >= sw.dur) {
      hero.last = hero.swing; const next = hero.queued && hero.swing < 2 ? hero.swing + 1 : -1;
      hero.swing = -1; player.anim = null; hero.grace = hero.last < 2 ? .16 : 0;
      if (next >= 0) startSwing(next); else if (hero.last === 2) hero.cd = .1;
    }
    return;
  }
  // walking; with the revolver held, at half speed, facing the target (the aim follows the stick, else the facing)
  const [ix, iy] = moveVector(), il = Math.hypot(ix, iy);
  let aimX = player.fx, aimZ = player.fz;
  if (il > .3) { const [mx, mz] = screenToWorld(ix, iy), l = Math.hypot(mx, mz); aimX = mx / l; aimZ = mz / l; }
  // the nearest in the cone around the stick or the facing (pointing at another enemy switches to it); with no one there,
  // the target aimed before while it lives, in sight and in reach (strafing around it with the stick keeps it)
  const L = hero.lock, keep = firing && L && L.hp > 0 && enemies.includes(L) && near(L, player) <= cfg.assist + 2 && A.clear(player.x, player.z, L.x, L.z);
  // (and with no one in the cone, the nearest close by on any side: backing away from a knife, the cat still answers it)
  const target = firing ? aimPick(player.x, player.z, aimX, aimZ, enemies, cfg.assist, cfg.cone, A.clear) || (keep ? L : aimPick(player.x, player.z, aimX, aimZ, enemies, GUN_NEAR, 360, A.clear)) : null;
  hero.lock = target;
  if (il > .15 && !dlg) {
    const [mx, mz] = screenToWorld(ix, iy), k = firing ? .5 : player.swim ? .6 : 1, ox = player.x, oz = player.z; go(mx * 9.6 * k, mz * 9.6 * k);
    if (!firing && moveTry(mx, mz, dt, Math.hypot(player.x - ox, player.z - oz) < 9.6 * k * dt * Math.min(1, il) * .2)) return;   // the owner asked for 3x the first 3.2 units/s
    const l = Math.hypot(mx, mz); if (!firing) { player.fx = mx / l; player.fz = mz / l; } player.step += dt * 18 * Math.min(1, il) * k; player.moving = true;
  } else { player.moving = false; player.step = 0; }
  if (firing) {
    if (target) { const l = near(target, player); if (l > 1e-3) { player.fx = (target.x - player.x) / l; player.fz = (target.z - player.z) / l; } } else { player.fx = aimX; player.fz = aimZ; }   // (a target on the very spot: the facing kept)
    if (due) shootOnce(cfg, s);
  }
}
// one round along the facing (turned to the target by the aim), or along (dirX, dirZ); now and then a crit; a flash at
// the muzzle. The target's defence is taken off where the round lands (engine/57-shots.js)
function shootOnce(cfg, s, dirX, dirZ, fanned) {
  const dx = dirX === undefined ? player.fx : dirX, dz = dirZ === undefined ? player.fz : dirZ, crit = R() < GUN_CRIT;
  const x = player.x + dx * .15, z = player.z + dz * .15;   // (from close by the cat: an enemy hugging it is in the first step's way)
  // seen from the muzzle as the frame draws it (the gun's "muzzle": art px from the feet, right and up, by view; the side
  // view mirrored when the cat faces left): that point of the figure in the world, where the tracer and the flash start
  const sd = dx * Math.cos(yaw) - dz * Math.sin(yaw), tw = dx * Math.sin(yaw) + dz * Math.cos(yaw), sideView = Math.abs(sd) > Math.abs(tw);
  const mz = (cfg.muzzle || {})[sideView ? 'side' : tw > 0 ? 'down' : 'up'] || [8, 12], k = player.size || 1;
  const mx = mz[0] * P * k * (sideView && sd < 0 ? -1 : 1), y = mz[1] * P * SPR_Y * k, show = [player.x + Math.cos(yaw) * mx, player.z - Math.sin(yaw) * mx];
  fireShot({ x, z, dx, dz, y, show, speed: cfg.speed, range: cfg.range, foe: false, crit, ink: !fanned, dmg: dmgRoll(s.atk, 0, cfg.dmg * (crit ? 1.5 : 1)) });   // (the Fan's rounds give no Nerve back: it would pay for itself)
  if (fanned && fanned > 1) return;   // (the Fan: one flash, one sound, one pose for its six rounds)
  fx('hit_spark', show[0] + dx * .1, show[1] + dz * .1, { y: A.groundY(x, z) + y - .2, size: .5 }); sfx('shot');
  hero.shootAnim = GAME.hero.anims.shoot ? 'shoot' : 'attack1'; player.anim = hero.shootAnim; player.at = 0; player.fps = 2 * cfg.rate; hero.shootT = 1 / cfg.rate;
}
// the Fan: six rounds at once in a spread around the facing (not from the cylinder)
function fan() {
  if (!gunOn()) return;
  const cfg = gunCfg(), s = stats(), a0 = Math.atan2(player.fz, player.fx);
  for (let i = 0; i < 6; i++) { const a = a0 + (i - 2.5) * .16; shootOnce(cfg, s, Math.cos(a), Math.sin(a), i + 1); }
  shake(.12);
}

function hitEnemy(e, d, push, inkGain, blocked, crit, hold) {
  e.hp -= d; const l = near(e, player) || 1;
  hitstop(hold || HOLD.blow);
  if (!e.T.poise) { e.kx = (e.x - player.x) / l * push; e.kz = (e.z - player.z) / l * push; }
  floatText(blocked ? t('fx.block') : String(d), e.x, 1.4 + (e.T.fly || 0), e.z, blocked ? 'dim' : crit ? 'crit' : '');
  if (GAME.hitFx) e.a.flash = .08;   // (a white flash: engine/50-actors.js)
  fx('hit_spark', e.x, e.z, { y: A.groundY(e.x, e.z) + .5 + (e.T.fly || 0), size: .9 }); sfx(blocked ? 'no' : 'hit'); shake(.08);
  if (inkGain && !blocked) G.ink = Math.min(stats().ink, G.ink + 3);
  if (e.hp <= 0) { dropTells(e); if (e.T.onDefeat) e.T.onDefeat(e); hitstop(e.T.boss ? HOLD.boss : HOLD.kill); if (e.T.boss) zoomKick(.06); setState(e, 'defeat', .55); e.a.anim = 'defeat'; sfx('defeat'); return; }
  // a stagger (which also cancels a tell) leaves the enemy unstaggerable for POISE_CD: hits still hurt, but pressing
  // Hit without pause no longer stun-locks it (tools/fair-check.mjs: mashing beat timing on every enemy before)
  if (!e.T.poise && simTime - (e.staggerAt ?? -9) >= POISE_CD && (!blocked || e.state === 'windup')) { setState(e, 'hurt', .24); e.staggerAt = simTime; tellLine(e, false); dropMark(e); }   // (a hit cancels a tell: its line, its mark)
  e.aware = true; if (e.T.onHit) e.T.onHit(e);
}

/* enemies: wander → notice → chase → windup (the tell) → strike → recover */
// an enemy's shot or throw is told at least this long ahead (the fairness rule: a person reacts in about a quarter second)
const SHOOT_TELL = .45;
const tellOf = (T) => (T.move === 'shoot' || T.move === 'throw' ? Math.max(SHOOT_TELL, T.windup || 0) : T.windup);
// a shot's tell: a red line on the ground along the coming burst, from the shooter toward where the cat stood
let tellGeo = null;
function tellMesh() {
  if (!tellGeo) { tellGeo = new THREE.PlaneGeometry(1, 1); tellGeo.rotateX(-Math.PI / 2); tellGeo.translate(.5, 0, 0); }
  const m = new THREE.Mesh(tellGeo, legacy(new THREE.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: .45, depthWrite: false, blending: THREE.AdditiveBlending }), false)); m.renderOrder = 8; scene.add(m); return m;
}
function tellLine(e, on, len) {   // (len: how far the told attack reaches, the data's range by default)
  if (!on) { if (e.line) e.line.visible = false; return; }
  if (!e.line) e.line = tellMesh();
  const dx = e.tx - e.x, dz = e.tz - e.z;
  e.line.position.set(e.x, A.groundY(e.x, e.z) + .05, e.z); e.line.rotation.y = Math.atan2(-dz, dx); e.line.scale.set(len || e.T.range || 12, 1, .12); e.line.visible = true;
  e.line.material.opacity = .25 + .3 * Math.abs(Math.sin(e.st * 18));
}
// a spread's tell (a shotgun): one line per angle, turned from the line toward (e.tx, e.tz) as Math.atan2(dz, dx) + angle
// turns (a plugin fires its rounds along the same angles)
const fanAngles = (n, spread) => Array.from({ length: n }, (_, i) => (n === 1 ? 0 : -spread / 2 + spread * i / (n - 1)));
function tellFan(e, angles, on) {
  if (!e.fan) e.fan = [];
  for (let i = 0; i < e.fan.length; i++) e.fan[i].visible = on && i < angles.length;
  if (!on) return;
  const a0 = Math.atan2(-(e.tz - e.z), e.tx - e.x), y = A.groundY(e.x, e.z) + .05, op = .25 + .3 * Math.abs(Math.sin(e.st * 18));
  angles.forEach((a, i) => { const m = e.fan[i] || (e.fan[i] = tellMesh()); m.position.set(e.x, y, e.z); m.rotation.y = a0 - a; m.scale.set(e.T.range || 12, 1, .12); m.material.opacity = op; m.visible = true; });
}
// a throw's tell: the mark where the dynamite will land, shown from the windup until it is thrown (or the thrower is hit)
const dropMark = (e) => { if (e.mark) { e.mark.dispose(); e.mark = null; } };
const dropTells = (e) => { dropMark(e); if (e.line) { scene.remove(e.line); e.line.material.dispose(); e.line = null; } if (e.fan) { for (const m of e.fan) { scene.remove(m); m.material.dispose(); } e.fan = null; } };
function spawnEnemy(type, x, z, o) {
  const T = ENEMIES[type]; if (!T) throw new Error('no enemy type "' + type + '"');
  const row = T.row, a = sheetActor(T.sheet, { down: row, up: row, side: row }, T.anims || { idle: ['walk1'], walk: ['walk1', 'walk2'], windup: ['windup'], attack: ['attack'], hurt: ['hurt'], defeat: ['defeat'] });
  if (T.size) a.size = T.size;
  const e = Object.assign({ type, T, a, x, z, hx: x, hz: z, hp: T.hp, fx: 1, fz: 0, state: 'wander', st: 1 + R() * 2, kx: 0, kz: 0, slow: 0, aware: false, tx: x, tz: z, sx: x, sz: z, done: false, id: null }, o || {});
  a.x = x; a.z = z; a.lift = T.fly || 0; enemies.push(e); return e;
}
function setState(e, s, time) { e.state = s; e.st = time; e.t0 = time; e.a.anim = null; e.a.at = 0; }
function nearestEnemy(r) { let best = null, bd = r; for (const e of enemies) { if (e.hp <= 0) continue; const d = near(e, player); if (d < bd) { bd = d; best = e; } } return best; }
function clearEnemies() { for (const e of enemies) { e.a.dispose(); dropTells(e); } enemies.length = 0; for (const p of pickups) p.f.dispose(); pickups.length = 0; hazards.length = 0; clearShots(); }

function enemiesStep(dt) {
  let engaged = false;
  for (let k = enemies.length - 1; k >= 0; k--) {
    const e = enemies[k], T = e.T, a = e.a, dist = near(e, player), sp = T.speed * (e.slow > 0 ? .45 : 1);
    if (a.flash) a.flash = Math.max(0, a.flash - dt);
    a.far = dist > 40 && e.state !== 'defeat'; if (a.far) continue;   // (the pose hides it: setting visible here, the pose undid it)
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
        if ((!e.hunt && (Math.hypot(e.x - e.hx, e.z - e.hz) > 16 || dist > T.sight * 1.8)) || hero.dead) { setState(e, 'return', 0); e.aware = false; break; }   // (a hunting enemy, a scripted ambush, is never leashed)
        if (T.keep && dist < T.keep[0] && A.clear(e.x, e.z, player.x, player.z) && move(-e.fx * sp * .8, -e.fz * sp * .8)) { a.moving = true; break; }   // a shooter backs off to its distance
        if (dist <= T.reach && A.clear(e.x, e.z, player.x, player.z)) {
          setState(e, 'windup', tellOf(T) * (e.slow > 0 ? 1.4 : 1)); a.anim = 'windup'; e.sx = e.x; e.sz = e.z; e.tx = player.x; e.tz = player.z;
          if (T.move === 'shoot') { tellLine(e, true); fx('hit_spark', e.x, e.z, { y: A.groundY(e.x, e.z) + .9, size: .5 }); sfx('click'); }
          if (T.move === 'throw') { dropMark(e); e.mark = fx('rain_mark', e.tx, e.tz, { loop: true, life: 99, size: 1.4, fps: 6 }); }
          break;
        }
        if (dist > .9) a.moving = move(e.fx * sp, e.fz * sp);
        break;
      }
      case 'windup': engaged = true; if (T.move !== 'smash') face(e.tx, e.tz); if (T.move === 'shoot') tellLine(e, true);
        if (e.st <= 0 && hero.dead) { tellLine(e, false); dropMark(e); setState(e, 'recover', T.recover ?? .6); break; }   // (the cat fallen: the attack told is not made)
        if (e.st <= 0) {
          // a burst's strike lasts as long as its rounds take; a throw lands on its mark, which goes on as the blast's fuse
          const strike = T.move === 'shoot' ? Math.max(T.strike || 0, ((T.burst || 3) - 1) * (T.gap || .18) + .05) : T.move === 'throw' ? T.strike || .3 : T.strike;
          setState(e, 'strike', strike); a.anim = 'attack'; e.hit = 0; e.sx = e.x; e.sz = e.z;
          if (T.move === 'throw') { dropMark(e); hazard(e.tx, e.tz, T.fuse || .6, T.blast || 1.3, T.atk); sfx('swing'); }
        }
        break;
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
        } else if (T.move === 'shoot') {   // the burst along the told line, a round every T.gap
          const n = T.burst || 3, gap = T.gap || .18, el = e.t0 - e.st, dx = e.tx - e.x, dz = e.tz - e.z, l = Math.hypot(dx, dz) || 1;
          while (e.hit < n && el >= e.hit * gap) { e.hit++; fireShot({ x: e.x + dx / l * .4, z: e.z + dz / l * .4, dx: dx / l, dz: dz / l, speed: T.shotSpeed || 9, range: T.range || 12, foe: true, atk: T.atk }); sfx('shot'); }
          tellLine(e, false);
        } else if (T.move === 'smash') {   // two blows in front, half the strike apart
          for (const [n, when] of [[1, 0], [2, .5]]) if (e.hit < n && p >= when) {
            e.hit = n; fx('dust', e.x + e.fx * 1.1, e.z + e.fz * 1.1, { size: 1.3 }); sfx('slam'); shake(.12);
            const dx = player.x - e.x, dz = player.z - e.z, d = Math.hypot(dx, dz);
            if (d < T.reach + .3 && (dx * e.fx + dz * e.fz) / (d || 1) > .2) hurtHero(T.atk, e.x, e.z);
          }
        }
        if (e.st <= 0) { a.lift = T.fly || 0; setState(e, 'recover', T.recover ?? .6); }   // (data may leave recover out: never an endless recovery)
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
        if (e.st <= 0) { enemyDefeated(e); a.dispose(); dropTells(e); enemies.splice(k, 1); continue; }
        break;
    }
    // keep a little room between enemies and around the cat
    for (const o of enemies) if (o !== e && o.hp > 0) { const dx = e.x - o.x, dz = e.z - o.z, d = Math.hypot(dx, dz), m = T.r + o.T.r; if (d < m && d > 1e-3) { const push = (m - d) * .5; if (!A.blocked(e.x + dx / d * push, e.z + dz / d * push, e.x, e.z, T.fly)) { e.x += dx / d * push; e.z += dz / d * push; } } }
    if (e.state !== 'strike' && dist <= 1e-3) { const a = R() * Math.PI * 2; if (!A.blocked(e.x + Math.cos(a) * .3, e.z + Math.sin(a) * .3, e.x, e.z, T.fly)) { e.x += Math.cos(a) * .3; e.z += Math.sin(a) * .3; } }   // (on the very spot the cat stands: off in some direction, there being none to push along)
    else if (e.state !== 'strike' && dist < T.r + .3 && dist > 1e-3 && A.blocked(e.x + (e.x - player.x) / dist * (T.r + .3 - dist), e.z + (e.z - player.z) / dist * (T.r + .3 - dist), e.x, e.z, T.fly)) {   // (pinned against a wall: off to one side instead)
      const push = T.r + .3 - dist, sx = -(e.z - player.z) / dist * push, sz = (e.x - player.x) / dist * push;
      if (!A.blocked(e.x + sx, e.z + sz, e.x, e.z, T.fly)) { e.x += sx; e.z += sz; } else if (!A.blocked(e.x - sx, e.z - sz, e.x, e.z, T.fly)) { e.x -= sx; e.z -= sz; }
    }
    else if (e.state !== 'strike' && dist < T.r + .3 && dist > 1e-3) { const push = (T.r + .3 - dist); if (!A.blocked(e.x + (e.x - player.x) / dist * push, e.z + (e.z - player.z) / dist * push, e.x, e.z, T.fly)) { e.x += (e.x - player.x) / dist * push; e.z += (e.z - player.z) / dist * push; } }
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
  const f = flat(sheetOf(GAME.sheets.items, id), [id], px, pz, { size: id === 'coin' ? .32 : .4, loop: true, bob: .25, fps: 1 });
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

// ---- engine/56-moves.js
/* ---------- moves beyond walking, taken by walking into them (no button: the thumbs keep the pad they have): a jump up
   onto or down off a ledge (the legend's "ledge": only those cells' edges, so a room's lip or the map's cliff stays a
   wall), and a ladder climbed (a thing with "climb": up to the ground it leans on, found behind it). The hero's "jump"
   and "climb" frames; nothing hits the cat and nothing stops it while it is in the air or on the rungs ---------- */
const JUMP = { up: 1.8, down: 4.2, reach: 1.6, dur: .46, push: .16, pushUp: .03, arc: .7 };
const CLIMB = { speed: 2.4, near: .75 };

// a jump from (x, z) heading (dx, dz): where it lands, or null. It lands reach units on, by a ledge (the ground it leaves
// or the one it lands on), up by at most JUMP.up or down by at most JUMP.down, more than a step apart, on a spot free and
// level under all four feet (landing half on a ledge's top, half against the cliff behind it, the cat was stuck there:
// every step from it still touched the cliff); nothing in between higher than the higher of the two
function jumpTarget(x, z, dx, dz) {
  const tx = x + dx * JUMP.reach, tz = z + dz * JUMP.reach, h0 = A.groundY(x, z), h1 = A.groundY(tx, tz);
  if (!A.ledgeAt(x, z) && !A.ledgeAt(tx, tz)) return null;
  if (h1 - h0 > JUMP.up || h0 - h1 > JUMP.down || Math.abs(h1 - h0) < .2) return null;
  if (A.blocked(tx, tz, tx, tz, 'swim') || A.isWater(tx, tz)) return null;
  for (let k = 1; k < 6; k++) { const s = k / 6; if (A.groundY(x + dx * JUMP.reach * s, z + dz * JUMP.reach * s) > Math.max(h0, h1) + .05) return null; }
  return [tx, tz];
}
// the ladders of the area: the foot in front of the thing, the top behind it where the ground has risen (scanned away from
// the camera's side, the way a ladder leans on a wall); a ladder with no rise behind it climbs nowhere and is left out
function laddersOf(def) {
  const out = [];
  for (const [key, x, z, , , o] of def.things || []) {
    if (!o || !o.climb || (o.when && !o.when())) continue;
    const h0 = A.groundY(x, z + .9);
    let zr = null;   // (where the ground first rises behind it: the top is a little way on from there)
    for (let d = .25; d < 8 && zr === null; d += .25) if (A.groundY(x, z - d) > h0 + .5) zr = z - d;
    if (zr === null) continue;
    out.push({ x, foot: z + .85, face: z + .35, top: zr - .7, h0, h1: A.groundY(x, zr - .7) });
  }
  return out;
}
let ladders = [];
const buildMoves = (def) => { ladders = laddersOf(def); };

// a move under way: hero.move = { kind, t, dur, ... }; true while it holds the cat
function moveStep(dt) {
  const m = hero.move; if (!m) return false;
  m.t += dt; const p = Math.min(1, m.t / m.dur);
  if (m.kind === 'jump') {
    player.x = m.sx + (m.tx - m.sx) * p; player.z = m.sz + (m.tz - m.sz) * p;
    const y = m.h0 + (m.h1 - m.h0) * p + Math.sin(p * Math.PI) * JUMP.arc;
    player.lift = y - A.groundY(player.x, player.z);
    player.anim = 'jump'; player.at = p < .15 || p > .9 ? 0 : 1 / player.fps;   // (crouched at the ends, in the air between)
  } else {
    // climbing: up the face, then a step over the top (or the reverse going down), the back to the camera
    const up = m.dir > 0, q = up ? p : 1 - p, onFace = q < .82;
    player.x = m.l.x; player.z = onFace ? m.l.face : m.l.face + (m.l.top - m.l.face) * (q - .82) / .18;
    const y = m.l.h0 + (m.l.h1 - m.l.h0) * Math.min(1, q / .82);
    player.lift = y - A.groundY(player.x, player.z);
    player.fx = -Math.sin(yaw); player.fz = -Math.cos(yaw); player.anim = 'climb'; player.at = (Math.floor(m.t * 6) % 2) / player.fps;
  }
  player.moving = false;
  if (p >= 1) {
    if (m.kind === 'climb') { player.x = m.l.x; player.z = m.dir > 0 ? m.l.top : m.l.foot; }
    player.lift = 0; player.anim = null; hero.move = null; sfx('step'); unstick(A.def);   // (a move that ended where the cat cannot stand: engine/80-loop.js)
  }
  return true;
}
// walking (mx, mz: the stick's direction on the ground): a ladder at hand, or a ledge pushed against long enough
function moveTry(mx, mz, dt, stuck) {
  if (player.swim || hero.dead) return false;
  const l = Math.hypot(mx, mz) || 1, dx = mx / l, dz = mz / l;
  for (const L of ladders) {
    if (Math.abs(player.x - L.x) > CLIMB.near) continue;
    const upward = dz < -.6 && Math.abs(player.z - L.foot) < CLIMB.near, down = dz > .6 && Math.abs(player.z - L.top) < CLIMB.near;
    if (!upward && !down) continue;
    hero.move = { kind: 'climb', t: 0, dur: Math.abs(L.h1 - L.h0) / CLIMB.speed + .35, dir: upward ? 1 : -1, l: L }; player.fps = 2; return true;
  }
  hero.pushT = stuck ? (hero.pushT || 0) + dt : 0;
  if (!stuck || !GAME.hero.anims.jump) return false;
  // (up onto a step: almost at once, as the cat meets it, the owner's ask; down off one: only after a push, so a cat
  // walking along a ledge's edge does not fall off it by a slip of the thumb)
  const t = jumpTarget(player.x, player.z, dx, dz); if (!t) return false;
  if (hero.pushT < (A.groundY(t[0], t[1]) > A.groundY(player.x, player.z) ? JUMP.pushUp : JUMP.push)) return false;
  hero.pushT = 0; player.fx = dx; player.fz = dz; player.fps = 2;
  hero.move = { kind: 'jump', t: 0, dur: JUMP.dur, sx: player.x, sz: player.z, tx: t[0], tz: t[1], h0: A.groundY(player.x, player.z), h1: A.groundY(t[0], t[1]) };
  sfx('dodge'); return true;
}

// ---- engine/57-shots.js
/* ---------- shots: the cat's bullets and the enemies', stepped in the simulation, drawn as one batch of streaks ---------- */
// A shot is tested along the segment it moves in a step, so none passes through a thin enemy. It stops where the cat
// could not walk, but flies over water and pits as a flyer does. The cat's shots hit enemies (their defence taken off
// there, the target unknown when it was fired); the enemies' shots hit the cat, unless a dodge makes it untouchable.
const SHOTS_MAX = 48, SHOT_R = .18, SHOW_JOIN = 2.5;
const shots = [];
function fireShot(o) {
  if (shots.length >= SHOTS_MAX || (!o.dx && !o.dz)) return null;   // (a round with no direction would hang in the air)
  // (show: where it is seen to leave, the muzzle as drawn: the tracer starts there and joins the round's own line within
  // SHOW_JOIN units; the round hits from where it really left, close by the shooter)
  const sx = o.show ? o.show[0] - o.x : 0, sz = o.show ? o.show[1] - o.z : 0;
  const s = { gy: A.groundY(o.x, o.z), x: o.x, z: o.z, ox: o.x, oz: o.z, sx, sz, y: o.y === undefined ? .8 : o.y, vx: o.dx * o.speed, vz: o.dz * o.speed, left: o.range, foe: !!o.foe, dmg: o.dmg || 0, atk: o.atk || 0, crit: !!o.crit, ink: o.ink !== false };
  shots.push(s); return s;
}
function clearShots() { shots.length = 0; }
// the enemies' rounds only (a dialogue opening, a boss falling: none left in the air to land afterwards)
function dropFoeShots() { for (let k = shots.length - 1; k >= 0; k--) if (shots[k].foe) shots.splice(k, 1); }
// the distance from (px, pz) to the segment a → b
function segDist(ax, az, bx, bz, px, pz) {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz, k = l2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / l2)) : 0;
  return Math.hypot(ax + vx * k - px, az + vz * k - pz);
}
function shotsStep(dt) {
  for (let k = shots.length - 1; k >= 0; k--) {
    const s = shots[k], v = Math.hypot(s.vx, s.vz) * dt, f = v > s.left ? s.left / v : 1, nx = s.x + s.vx * dt * f, nz = s.z + s.vz * dt * f;   // (the last step ends at the range)
    // whoever stands on the step's way first, then the wall it ends in (point blank against a wall: the enemy pinned there
    // is hit, the round no longer dying in the wall before reaching it)
    let done = false;
    if (s.foe) {
      if (!hero.dead && hero.inv <= 0 && segDist(s.x, s.z, nx, nz, player.x, player.z) < .35 + SHOT_R) { done = true; hurtHero(s.atk, s.x, s.z); }
    } else {
      let best = null, bd = 1e9;
      for (const e of enemies) {
        if (e.hp <= 0 || segDist(s.x, s.z, nx, nz, e.x, e.z) >= e.T.r + SHOT_R) continue;
        const d = Math.hypot(e.x - s.x, e.z - s.z); if (d < bd) { bd = d; best = e; }
      }
      if (best) { done = true; hitEnemy(best, Math.max(1, s.dmg - (best.T.def || 0)), 1.2, s.ink, false, s.crit, HOLD.shot); }
      for (const c of critters) if (segDist(s.x, s.z, nx, nz, c.x, c.z) < .45) critterHit(c, s.x, s.z);   // (a farm animal is scared off, the round flies on)
    }
    if (!done) done = A.shotBlocked(nx, nz, s.gy);   // (the aim's own rule, A.clear: a step down lets it on, a step up stops it)
    s.left -= v * f; s.x = nx; s.z = nz;
    if (done || s.left <= 1e-6) shots.splice(k, 1);
  }
}
// the assisted aim: the nearest living enemy in reach, inside the cone around (dx, dz), in sight
function aimPick(px, pz, dx, dz, list, maxD, coneDeg, clear) {
  const half = coneDeg * Math.PI / 360; let best = null, bd = 1e9;
  for (const e of list) {
    if (e.hp <= 0) continue;
    const ex = e.x - px, ez = e.z - pz, d = Math.hypot(ex, ez); if (d > maxD + e.T.r || d < 1e-4 || d >= bd) continue;
    if (Math.acos(Math.max(-1, Math.min(1, (ex * dx + ez * dz) / d))) > half) continue;
    if (clear(px, pz, e.x, e.z)) { bd = d; best = e; }
  }
  return best;
}
// drawn: each shot a streak along its way, added to the picture (an atmosphere's bloom takes it); the cat's warm white,
// the enemies' orange. (Made on the first draw: the logic above runs without three.js in the unit tests.)
let shotMesh = null, _sm, _sq, _sp, _ss, _sy, _sc;
function shotsDraw() {
  if (!shotMesh && !shots.length) return;   // (a chapter without guns never makes it)
  if (!shotMesh) {
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    const m = legacy(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), false);
    shotMesh = new THREE.InstancedMesh(g, m, SHOTS_MAX); shotMesh.frustumCulled = false; shotMesh.renderOrder = 9; scene.add(shotMesh);
    _sm = new THREE.Matrix4(); _sq = new THREE.Quaternion(); _sp = new THREE.Vector3(); _ss = new THREE.Vector3(); _sy = new THREE.Vector3(0, 1, 0); _sc = new THREE.Color();
  }
  shotMesh.count = shots.length; shotMesh.visible = shots.length > 0;
  for (let i = 0; i < shots.length; i++) {
    // the tracer between two points of the path as seen (the true path, plus the muzzle's offset fading over SHOW_JOIN)
    const s = shots[i], sp = Math.hypot(s.vx, s.vz) || 1, ux = s.vx / sp, uz = s.vz / sp, d = Math.hypot(s.x - s.ox, s.z - s.oz), t0 = Math.max(0, d - Math.min(.9, sp * .03 + .2));
    const at = (t) => { const f = Math.max(0, 1 - t / SHOW_JOIN); return [s.ox + ux * t + s.sx * f, s.oz + uz * t + s.sz * f]; };
    const [ax, az] = at(t0), [bx, bz] = at(d), len = Math.hypot(bx - ax, bz - az);
    _sq.setFromAxisAngle(_sy, Math.atan2(-(bz - az), bx - ax)); _sp.set((ax + bx) / 2, A.groundY(s.x, s.z) + s.y, (az + bz) / 2); _ss.set(len || 1e-4, 1, s.foe ? .16 : .1);
    _sm.compose(_sp, _sq, _ss); shotMesh.setMatrixAt(i, _sm); shotMesh.setColorAt(i, s.foe ? _sc.setRGB(1, .45, .12) : _sc.setRGB(1, .93, .7));
  }
  shotMesh.instanceMatrix.needsUpdate = true; if (shotMesh.instanceColor) shotMesh.instanceColor.needsUpdate = true;
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
  splash: (a, d) => { hiss(d, a, .3, .35, 1400, .8); tone(d, 'sine', 300, 120, a, .12, .12); },
  step: (a, d) => hiss(d, a, .08, .2, 900, .6),
  slam: (a, d) => { tone(d, 'sine', 120, 45, a, .2, .6); hiss(d, a, .12, .3, 400); },
  shot: (a, d) => { hiss(d, a, .07, .55, 3600, .5); tone(d, 'p1', 180, 60, a, .06, .35); },
  reload: (a, d) => { tone(d, 'p2', 1200, 0, a, .03, .1); tone(d, 'p2', 900, 0, a + .09, .03, .1); },
  click: (a, d) => tone(d, 'p2', 1500, 0, a, .02, .08),
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
  // the farm animals, when the cat scares them (critters)
  cluck: (a, d) => { [[900, 1300], [1100, 700], [1000, 1400]].forEach(([f0, f1], i) => tone(d, 'p3', f0, f1, a + i * .07, .06, .1)); hiss(d, a, .18, .2, 2600, 1.5); },
  bark: (a, d) => { tone(d, 'p1', 420, 210, a, .09, .2); tone(d, 'p1', 460, 230, a + .14, .09, .18); },
  oink: (a, d) => { tone(d, 'p1', 140, 110, a, .16, .25); hiss(d, a, .14, .3, 500, 2); },
  baa: (a, d) => tone(d, 'p2', 380, 330, a, .4, .16),
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

// ---- engine/59-ambient.js
/* ---------- the world's small life, read off what is already there: smoke from the chimneys the models built, leaves
   falling from the trees whose models drop them, butterflies over flowered grass and glints on the water by day, birds
   crossing the sky wherever there is one (an area whose time is a day's: never in a room, a ship or a mine), and the
   cat's pawprints in snow (the tile's name says so). Nothing
   to place: an area has them when it has those things. Square pixels like the art, one draw for all, never solid or saved ---------- */
const AMB = { max: 300, near: 26 };
// pawprints: the ground that keeps them, read off the tile's name (snow only: on dirt and after a swim they came and went
// with no reason a player could see); one every PAW.step units walked, for PAW.life seconds
const SOFT = /snow/, PAW = { step: .42, life: 5, side: .09 };
const amb = { parts: [], smoke: [], leaves: [], flowers: [], water: [], day: false, t: 0 };

// what an area gives: the models' emitters placed as the things are (engine/25-lpkit.js lpEmit), and the flowered and
// wet spots sampled once on a unit grid
function ambientBuild(def) {
  amb.parts.length = 0; amb.smoke.length = 0; amb.leaves.length = 0; amb.flowers.length = 0; amb.water.length = 0;
  amb.day = ['giorno', 'alba', 'tramonto'].includes(def.tod || 'giorno'); amb.birdT = 4 + Math.random() * 6;
  ambientMesh();   // (made now, not with the first part: its shader compiled with the area, while the screen is dark)
  for (const [key, x, z, , , o] of def.things || []) {
    if (!LP || !lpModel(key) || !LP_EMIT[key] || (o && o.when && !o.when())) continue;
    const tf = lpTf(o || {}), y0 = A.groundY(x, z) + ((o && o.dy) || 0);
    for (const e of LP_EMIT[key]) {
      const [a, c] = tf(e.x, e.z), p = { x: x + a * P, y: y0 + e.y * P, z: z + c * P, r: (e.r || 0) * P, t: Math.random() * 2 };
      (e.kind === 'smoke' ? amb.smoke : amb.leaves).push(p);
    }
  }
  if (!amb.day) return;
  for (let z = .5; z < A.D; z += 1) for (let x = .5; x < A.W; x += 1) {
    if (A.isWater(x, z)) { if (A.isWater(x + .7, z) && A.isWater(x - .7, z) && A.isWater(x, z + .7) && A.isWater(x, z - .7)) amb.water.push([x, z]); }
    else if (/flower/.test(A.tileAt(x, z))) amb.flowers.push([x, z]);
  }
}
const clearAmbient = () => { amb.parts.length = 0; amb.smoke.length = 0; amb.leaves.length = 0; amb.flowers.length = 0; amb.water.length = 0; };

// a part: position, velocity, life left and full, size in art pixels, colour [r, g, b], alpha, its kind's own motion
function ambPush(p) { if (amb.parts.length < AMB.max) amb.parts.push(p); }
const rnd = Math.random;   // (not R: the game's own random sequence stays as it was)
const nearCat = (x, z, d) => Math.abs(x - player.x) < d && Math.abs(z - player.z) < d;
const pickNear = (list, d) => { for (let k = 0; k < 6 && list.length; k++) { const s = list[Math.floor(rnd() * list.length)]; if (nearCat(s[0], s[1], d)) return s; } return null; };

function ambientStep(dt) {
  if (!A || !player) return;
  amb.t += dt;
  // smoke: a puff every half second from each chimney near the cat, rising, drifting with the wind, growing, fading
  for (const s of amb.smoke) {
    if (!nearCat(s.x, s.z, AMB.near) || (s.t -= dt) > 0) continue;
    s.t = .45 + rnd() * .25;
    ambPush({ k: 'smoke', x: s.x + (rnd() - .5) * .2, y: s.y, z: s.z, vx: .18, vy: .55, vz: -.05, life: 3.2, full: 3.2, size: 4, grow: 4, col: [.86, .84, .82], a: .75 });
  }
  // leaves: now and then one leaves a canopy, falls swaying, lies a moment on the ground
  for (const s of amb.leaves) {
    if (!nearCat(s.x, s.z, AMB.near) || (s.t -= dt) > 0) continue;
    s.t = 1.6 + rnd() * 2.4;
    const a = rnd() * Math.PI * 2, r = s.r * Math.sqrt(rnd()), autumn = rnd() < .3;
    ambPush({ k: 'leaf', x: s.x + Math.cos(a) * r, y: s.y - s.r * .3, z: s.z + Math.sin(a) * r * .6, vx: 0, vy: -.55, vz: 0, life: 9, full: 9, size: 3, grow: 0, col: autumn ? [.86, .62, .22] : [.45, .66, .24], a: 1, ph: rnd() * 6 });
  }
  // butterflies: a few over the flowers near the cat by day; they wander, flutter and keep away from the cat
  const flies = amb.parts.reduce((n, p) => n + (p.k === 'fly'), 0);
  if (amb.day && flies < 6 && amb.flowers.length && rnd() < dt * 1.5) {
    const s = pickNear(amb.flowers, 12), c = [[.98, .96, .9], [.98, .85, .3], [.95, .6, .75]][Math.floor(rnd() * 3)];
    if (s) ambPush({ k: 'fly', x: s[0], y: A.groundY(s[0], s[1]) + .4 + rnd() * .5, z: s[1], vx: 0, vy: 0, vz: 0, life: 14, full: 14, size: 2, grow: 0, col: c, a: 1, h: rnd() * 6.28, ph: rnd() * 6 });
  }
  // birds: now and then a flock of two to five crosses the sky, high, from beyond the view to beyond it, in a loose V
  if (amb.day && (amb.birdT -= dt) <= 0) {
    amb.birdT = 9 + rnd() * 14;
    const h = rnd() * Math.PI * 2, ux = Math.cos(h), uz = Math.sin(h), n = 2 + Math.floor(rnd() * 4), y = A.groundY(player.x, player.z) + 6.5 + rnd() * 2.5, sp = 3.2 + rnd() * 1.2;
    const sx = player.x - ux * 20 + uz * (rnd() - .5) * 8, sz = player.z - uz * 20 - ux * (rnd() - .5) * 8;
    for (let i = 0; i < n; i++) {
      const s = (i % 2 ? 1 : -1) * Math.ceil(i / 2), back = Math.abs(s) * 1.1;
      ambPush({ k: 'bird', x: sx - ux * back - uz * s * 1.2, y: y + (rnd() - .5) * .4, z: sz - uz * back + ux * s * 1.2, vx: ux * sp, vy: 0, vz: uz * sp, life: 14, full: 14, size: 7, grow: 0, col: [.16, .14, .18], a: .9, ph: rnd() * 6, fl: 7 + rnd() * 3 });
    }
  }
  // pawprints: as the cat walks (not swimming, jumping or climbing), left and right of its way in turn
  const mx = player.x - (amb.px ?? player.x), mz = player.z - (amb.pz ?? player.z), md = Math.hypot(mx, mz); amb.px = player.x; amb.pz = player.z;
  if (player.moving && !player.swim && !hero.move && md > 0 && md < 1) {
    amb.pawD = (amb.pawD || 0) + md;
    if (amb.pawD >= PAW.step) {
      amb.pawD = 0; amb.pawSide = -(amb.pawSide || 1);
      const ux = mx / md, uz = mz / md, x = player.x - uz * PAW.side * amb.pawSide, z = player.z + ux * PAW.side * amb.pawSide;
      if (SOFT.test(A.tileAt(x, z) || '')) ambPush({ k: 'paw', x, y: A.groundY(x, z) + .03, z, vx: 0, vy: 0, vz: 0, life: PAW.life, full: PAW.life, size: 3, grow: 0, col: [.13, .11, .22], a: .55 });
    }
  }
  // glints: on open water near the cat by day, a short white spark here and there
  if (amb.day && amb.water.length && rnd() < dt * 9) {
    const s = pickNear(amb.water, 14);
    if (s) { const x = s[0] + (rnd() - .5), z = s[1] + (rnd() - .5); ambPush({ k: 'glint', x, y: A.groundY(x, z) + .04, z, vx: 0, vy: 0, vz: 0, life: .5, full: .5, size: 2, grow: 2, col: [1, 1, 1], a: 1 }); }
  }
  for (let i = amb.parts.length - 1; i >= 0; i--) {
    const p = amb.parts[i];
    if ((p.life -= dt) <= 0 || !nearCat(p.x, p.z, AMB.near + 4)) { amb.parts.splice(i, 1); continue; }
    if (p.k === 'leaf') {
      const g = A.groundY(p.x, p.z);
      if (p.y > g + .02) { p.ph += dt * 3; p.x += Math.sin(p.ph) * .5 * dt; p.z += Math.cos(p.ph * .7) * .25 * dt; p.y = Math.max(g + .02, p.y + p.vy * dt); }
      else p.life = Math.min(p.life, 1.2);   // (on the ground: a moment, then gone)
    } else if (p.k === 'fly') {
      const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz);
      if (d < 2.2) p.h = Math.atan2(dz, dx) + (rnd() - .5) * .5; else p.h += (rnd() - .5) * dt * 4;
      const sp = d < 2.2 ? 2.4 : .8; p.x += Math.cos(p.h) * sp * dt; p.z += Math.sin(p.h) * sp * dt; p.ph += dt * 14;
      p.y = A.groundY(p.x, p.z) + .55 + Math.sin(amb.t * 2 + p.h) * .25;
    } else if (p.k === 'bird') { p.x += p.vx * dt; p.z += p.vz * dt; p.ph += dt * p.fl; p.y += Math.sin(p.ph * .23) * .08 * dt; }
    else { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
  }
}

// drawn: square points in art pixels (the picture's own pixel grid), the smoke and the glints fading, a butterfly's wings
// beating (its size flickering between 2 and 3); a bird is a 7 x 7 point holding its silhouette, one of three poses of
// the wings (aWing: 0 a plain square, else the pose 1 up, 2 level, 3 down), each pixel an art pixel; a pawprint a 3 x 3
// one (aWing 4: two toes over a pad)
let ambMesh = null, ambPos, ambCol, ambSize, ambWing;
function ambientMesh() {
  if (ambMesh || !scene) return;
  const g = new THREE.BufferGeometry(); ambPos = new Float32Array(AMB.max * 3); ambCol = new Float32Array(AMB.max * 4); ambSize = new Float32Array(AMB.max); ambWing = new Float32Array(AMB.max);
  g.setAttribute('position', new THREE.BufferAttribute(ambPos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(ambCol, 4)); g.setAttribute('aSize', new THREE.BufferAttribute(ambSize, 1)); g.setAttribute('aWing', new THREE.BufferAttribute(ambWing, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 2 } }, transparent: true, depthWrite: false,
    vertexShader: `attribute vec4 aCol; attribute float aSize, aWing; uniform float uPx; varying vec4 vC; varying float vW;
      void main(){ vC = aCol; vW = aWing; gl_PointSize = max(1.0, floor(aSize * uPx + .5)); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    // (a wing's row, top down, at each distance from the body: up a V, level a gull's M, down a roof)
    fragmentShader: `precision highp float; varying vec4 vC; varying float vW;
      void main(){
        if (vC.a < .01) discard;
        if (vW > 3.5) { vec2 c = floor(gl_PointCoord * 3.0); if (c.y < .5 ? c.x == 1.0 : c.y < 1.5 && c.x != 1.0) discard; }
        else if (vW > .5) {
          vec2 c = floor(gl_PointCoord * 7.0); float d = abs(c.x - 3.0), row;
          if (vW < 1.5) row = 4.0 - d; else if (vW < 2.5) row = d < .5 || d > 2.5 ? 3.0 : 2.0; else row = 2.0 + floor(d * .67 + .5);
          if (c.y != row && !(d < .5 && c.y == row + 1.0)) discard;
        }
        gl_FragColor = vec4(vC.rgb, vC.a);
      }`,
  });
  ambMesh = new THREE.Points(g, m); ambMesh.frustumCulled = false; ambMesh.renderOrder = 3; ambMesh.visible = false; scene.add(ambMesh);
}
function ambientDraw() {
  if (!ambMesh) return;
  const n = Math.min(amb.parts.length, AMB.max);
  for (let i = 0; i < n; i++) {
    const p = amb.parts[i], f = p.life / p.full, fade = p.k === 'smoke' ? Math.min(1, f * 1.6) * Math.min(1, (1 - f) * 8) : p.k === 'glint' ? Math.sin(f * Math.PI) : p.k === 'paw' ? Math.min(1, f * 2) : Math.min(1, p.life);
    ambPos.set([p.x, p.y, p.z], i * 3); ambCol.set([p.col[0], p.col[1], p.col[2], p.a * fade], i * 4);
    ambSize[i] = p.k === 'fly' ? (Math.sin(p.ph) > 0 ? 3 : 2) : p.size + p.grow * (1 - f);
    ambWing[i] = p.k === 'bird' ? 1 + Math.floor((Math.sin(p.ph) * .5 + .5) * 2.999) : p.k === 'paw' ? 4 : 0;   // (up, level, down: the beat)
  }
  ambMesh.geometry.setDrawRange(0, n); ambMesh.visible = n > 0;
  for (const a of ['position', 'aCol', 'aSize', 'aWing']) ambMesh.geometry.attributes[a].needsUpdate = true;
  ambMesh.material.uniforms.uPx.value = rt.height / (PPU * viewV(Math.max(Vz, minV())));   // (picture pixels to an art pixel)
}

// ---- engine/59-critters.js
'use strict';
/* ---------- critters: farm animals about an area (its "critters": [kind, x, z, n, r]); they wander near home and peck,
   run from the cat when it comes close, scatter crying when hit; never solid, never aimed at, never saved ---------- */
// kind → its figure (sheet, row), walking and running speed, how close the cat may come before it runs, how often a
// pause is spent pecking (or sniffing, grazing), its cry, whether it hops as it runs (the birds)
const CRITTERS = {
  hen: { sheet: 'animals-1', row: 'hen', speed: 1.1, run: 4.2, fear: 2.2, peck: .6, cry: 'cluck', hop: true },
  rooster: { sheet: 'animals-1', row: 'rooster', speed: 1.2, run: 4.4, fear: 2, peck: .4, cry: 'cluck', hop: true },
  chick: { sheet: 'animals-1', row: 'chick', speed: 1.4, run: 3.4, fear: 2.4, peck: .5, cry: 'cluck', hop: true },
  dog: { sheet: 'animals-2', row: 'dog', speed: 1.5, run: 5, fear: 1.2, peck: .5, cry: 'bark' },
  pig: { sheet: 'animals-2', row: 'pig', speed: .8, run: 3.2, fear: 1.6, peck: .7, cry: 'oink' },
  sheep: { sheet: 'animals-2', row: 'sheep', speed: .7, run: 3.4, fear: 2.4, peck: .8, cry: 'baa' },
};
const CRITTER_ANIMS = { idle: { down: ['down_idle'], up: ['up_idle'], side: ['side_idle'] }, walk: { down: ['down_walk1', 'down_walk2'], up: ['up_idle'], side: ['side_walk1', 'side_walk2'] }, peck: { side: ['side_peck'] } };
const critters = [];
let critterCry = -1;   // when the last cry was played: a flock hit at once cries once

// one step of a critter's mind (pure: the caller moves it by (c.vx, c.vz)): idle (a pause, pecking or not) → a short
// walk to a point near home → idle; the cat within its fear distance: running straight away from it, until a moment
// after it is gone
function critterThink(c, K, dt, px, pz, rnd) {
  c.st -= dt; c.peck = false;
  const dx = c.x - px, dz = c.z - pz, d = Math.hypot(dx, dz);
  if (d < K.fear) { if (c.mode !== 'flee' || c.st < .7) c.st = .7 + rnd() * .5; c.mode = 'flee'; c.dx = d > 1e-3 ? dx / d : 1; c.dz = d > 1e-3 ? dz / d : 0; }
  if (c.mode === 'flee') {
    if (c.st > 0) { c.vx = c.dx * K.run; c.vz = c.dz * K.run; return; }
    c.mode = 'idle'; c.st = .4 + rnd() * .8; c.pecking = false;
  }
  if (c.mode === 'walk') {
    const tx = c.tx - c.x, tz = c.tz - c.z, l = Math.hypot(tx, tz);
    if (l > .15 && c.st > 0) { c.vx = tx / l * K.speed; c.vz = tz / l * K.speed; return; }
    c.mode = 'idle'; c.st = 1 + rnd() * 2.5; c.pecking = rnd() < K.peck;
  }
  c.vx = c.vz = 0; c.peck = !!c.pecking;
  if (c.st <= 0) {   // somewhere near home (evenly over the disc), given time enough to get there
    const ang = rnd() * Math.PI * 2, r = c.r * Math.sqrt(rnd());
    c.tx = c.hx + Math.cos(ang) * r; c.tz = c.hz + Math.sin(ang) * r; c.mode = 'walk';
    c.st = 1 + Math.hypot(c.tx - c.x, c.tz - c.z) / K.speed;
  }
}
// hit (a blow, a round, a dash, a burst): it runs from where the hit came from, longer than from the cat alone, with
// a cry and a puff of dust
function critterHit(c, fx0, fz0) {
  const dx = c.x - fx0, dz = c.z - fz0, l = Math.hypot(dx, dz), again = c.mode === 'flee' && c.hit;
  c.mode = 'flee'; c.hit = true; c.st = Math.max(c.st, 1.6); c.pecking = false;
  c.dx = l > 1e-3 ? dx / l : 1; c.dz = l > 1e-3 ? dz / l : 0;
  if (again) return;
  if (c.a) c.a.flash = .1;
  if (time - critterCry > .3) { critterCry = time; sfx(c.K.cry); }
  fx('dust', c.x, c.z, { size: .7, fps: 12 });
}
function spawnCritters(kind, x, z, n, r) {
  const K = CRITTERS[kind]; if (!K) throw new Error('no critter "' + kind + '"');
  for (let i = 0; i < n; i++) {
    let cx = x, cz = z;   // a free spot around (x, z); its centre when a dozen tries all fall in a wall
    for (let k = 0; k < 12; k++) { const ang = R() * Math.PI * 2, d = r * Math.sqrt(R()); cx = x + Math.cos(ang) * d; cz = z + Math.sin(ang) * d; if (!A.blocked(cx, cz)) break; cx = x; cz = z; }
    const a = sheetActor(K.sheet, { down: K.row, up: K.row, side: K.row }, CRITTER_ANIMS);
    const ang = R() * Math.PI * 2; a.x = cx; a.z = cz; a.fx = Math.cos(ang); a.fz = Math.sin(ang);
    critters.push({ kind, K, a, x: cx, z: cz, hx: x, hz: z, r, mode: 'idle', st: R() * 2, vx: 0, vz: 0, dx: 1, dz: 0, peck: false });
  }
}
function clearCritters() { for (const c of critters) c.a.dispose(); critters.length = 0; }
// a step along (vx, vz), each axis on its own (sliding along a wall): false when neither moved
const critterGo = (c, vx, vz) => { let ok = false; if (vx && !A.blocked(c.x + vx, c.z, c.x, c.z)) { c.x += vx; ok = true; } if (vz && !A.blocked(c.x, c.z + vz, c.x, c.z)) { c.z += vz; ok = true; } return ok; };
function crittersStep(dt) {
  for (const c of critters) {
    const a = c.a; a.far = near(c, player) > 40; if (a.far) continue;   // (the pose hides it)
    if (a.flash) a.flash = Math.max(0, a.flash - dt);
    critterThink(c, c.K, dt, player.x, player.z, R);
    const vx = c.vx * dt, vz = c.vz * dt; let moved = false;
    if (vx || vz) {
      if (critterGo(c, vx, vz)) moved = true;
      else if (c.mode === 'flee' && (critterGo(c, -vz, vx) || critterGo(c, vz, -vx))) { moved = true; const mx = c.x - a.x, mz = c.z - a.z, l = Math.hypot(mx, mz); c.dx = mx / l; c.dz = mz / l; }   // a wall ahead: along it
      else { c.mode = 'idle'; c.st = .3 + R() * .6; }   // a walk into a wall ends there
    }
    if (moved) { const l = Math.hypot(c.x - a.x, c.z - a.z); if (l > 1e-4) { a.fx = (c.x - a.x) / l; a.fz = (c.z - a.z) / l; } }
    a.moving = moved; a.step += dt * (c.mode === 'flee' ? 12 : 6);
    a.anim = c.peck && Math.floor(time * 2.5 + c.hx * 7) % 2 === 0 ? 'peck' : null;
    a.lift = c.K.hop && c.mode === 'flee' && moved ? Math.abs(Math.sin(time * 14 + c.hx)) * .14 : 0;
    a.x = c.x; a.z = c.z;
    if (c.mode !== 'flee') c.hit = false;
  }
}
// the cat's blows: those in a swing's arc (once a swing: set is its hitSet), and all those around a point
function crittersSwing(reach, arc, set) {
  for (const c of critters) {
    if (set.has(c)) continue;
    const dx = c.x - player.x, dz = c.z - player.z, d = Math.hypot(dx, dz);
    if (d > reach + .3) continue;
    if (d > .5 && Math.acos(Math.max(-1, Math.min(1, (dx * player.fx + dz * player.fz) / d))) > arc / 2) continue;
    set.add(c); critterHit(c, player.x, player.z);
  }
}
function crittersNear(x, z, r) { for (const c of critters) if (Math.hypot(c.x - x, c.z - z) < r) critterHit(c, x, z); }

// ---- engine/59-fish.js
/* ---------- fish: dark shapes gliding just under a lake's surface (an area's "fish": how many); they drift, turn back
   at the shore, and dart away when the cat comes to the water's edge. Never solid, never saved; one draw for all ---------- */
const fish = [];
const FISH = { speed: .7, dart: 3.2, fear: 2.4, turn: 1.6 };

// one step of a fish (pure: the caller gives it the water test and the dice): a slow drift whose heading wanders; the
// water ahead ending, a turn away from it; the cat near, a dart straight away for a moment
function fishThink(f, dt, px, pz, wet, rnd) {
  f.st -= dt;
  const dx = f.x - px, dz = f.z - pz, d = Math.hypot(dx, dz);
  if (d < FISH.fear && f.dart <= 0) { f.dart = .5 + rnd() * .3; f.h = Math.atan2(dz, dx) + (rnd() - .5) * .6; }
  if (f.dart > 0) f.dart -= dt;
  else { if (f.st <= 0) { f.turn = (rnd() - .5) * FISH.turn; f.st = 1 + rnd() * 2.5; } f.h += f.turn * dt; }
  const sp = f.dart > 0 ? FISH.dart : FISH.speed;
  // the water ahead (half a unit on): none, a turn of a quarter or more toward open water, the step not taken
  const ahead = (h) => wet(f.x + Math.cos(h) * .6, f.z + Math.sin(h) * .6);
  if (!ahead(f.h)) { for (const k of [1, -1, 2, -2, 3, -3, 4]) if (ahead(f.h + k * Math.PI / 4)) { f.h += k * Math.PI / 4; break; } f.dart = 0; return; }
  f.x += Math.cos(f.h) * sp * dt; f.z += Math.sin(f.h) * sp * dt;
}
// n fish over the area's water, each on a wet spot (the dice pick among them)
function spawnFish(n) {
  const wet = [];
  for (let z = .5; z < A.D; z += 1) for (let x = .5; x < A.W; x += 1) if (A.isWater(x, z) && A.isWater(x + .6, z) && A.isWater(x - .6, z) && A.isWater(x, z + .6) && A.isWater(x, z - .6)) wet.push([x, z]);
  for (let i = 0; i < n && wet.length; i++) { const [x, z] = wet[Math.floor(R() * wet.length)]; fish.push({ x, z, h: R() * Math.PI * 2, turn: 0, st: R() * 2, dart: 0, size: 1.3 + R() * .6, w: R() * 6 }); }
}
const clearFish = () => { fish.length = 0; if (fishMesh) fishMesh.count = 0; };
function fishStep(dt) {
  for (const f of fish) { if (Math.hypot(f.x - player.x, f.z - player.z) > 40) continue; fishThink(f, dt, player.x, player.z, A.isWater, R); f.w += dt * (f.dart > 0 ? 18 : 6); }
}
// drawn: each fish a small dark shape on the water (body and tail, the tail swinging), one instanced mesh
let fishMesh = null, _fm, _fq, _fp, _fs, _fy;
function fishDraw() {
  if (!fishMesh && !fish.length) return;   // (an area without fish never makes it)
  if (!fishMesh) {
    // a fish along +x, nose at .32, tail fin at -.3 (flat, facing up)
    const p = [.32, 0, 0, .06, 0, .14, -.16, 0, .08, -.16, 0, -.08, .06, 0, -.14, -.14, 0, 0, -.32, 0, .13, -.32, 0, -.13];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 5, 6, 7]);
    const m = legacy(new THREE.MeshBasicMaterial({ color: 0x06202e, transparent: true, opacity: .7, depthWrite: false, side: THREE.DoubleSide }), false);
    fishMesh = new THREE.InstancedMesh(g, m, 32); fishMesh.frustumCulled = false; fishMesh.renderOrder = 2; scene.add(fishMesh);
    _fm = new THREE.Matrix4(); _fq = new THREE.Quaternion(); _fp = new THREE.Vector3(); _fs = new THREE.Vector3(); _fy = new THREE.Vector3(0, 1, 0);
  }
  const n = Math.min(fish.length, 32); fishMesh.count = n; fishMesh.visible = n > 0;
  for (let i = 0; i < n; i++) {
    const f = fish[i];
    _fq.setFromAxisAngle(_fy, -f.h + Math.sin(f.w) * .15); _fp.set(f.x, A.groundY(f.x, f.z) + .03, f.z); _fs.set(f.size, 1, f.size * (1 + Math.sin(f.w * 1.3) * .08));
    _fm.compose(_fp, _fq, _fs); fishMesh.setMatrixAt(i, _fm);
  }
  fishMesh.instanceMatrix.needsUpdate = true;
}

// ---- engine/60-input.js
/* ---------- input: keyboard, touch (stick + buttons) and gamepad feed one set of actions ---------- */
// move: a vector; pressed actions (attack, dodge, skill1, skill2, skill3, interact, menu, rotateL, rotateR) are queued once per
// press, never repeated by a held key
const input = { keys: new Set(), stickX: 0, stickY: 0, padX: 0, padY: 0, queue: [], padPrev: {}, held: new Set(), padA: false };   // (held: touch or mouse buttons pressed down now)
const KEYMAP = { ' ': 'interact', enter: 'interact', escape: 'menu', tab: 'menu', q: 'rotateL', e: 'rotateR', j: 'attack', z: 'attack', k: 'dodge', x: 'dodge', shift: 'dodge', f: 'quill', l: 'skill1', c: 'skill1', u: 'skill2', v: 'skill2', i: 'skill3', b: 'skill3' };

function inputSetup() {
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (isTyping(e) && e.key !== 'Escape')) return;
    const k = e.key.toLowerCase();
    if (k === 'tab' && ui.screen !== 'game') return;   // Tab moves focus in menus; in play it opens the menu
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'tab'].includes(k) && ui.screen === 'game') e.preventDefault();
    if (e.repeat) return;   // a held key acts once
    if (dlg && dlg.pad && (/^[0-9]$/.test(k) || k === 'backspace' || k === 'escape')) { e.preventDefault(); dlg.pad(k === 'backspace' ? '<' : k === 'escape' ? 'x' : k); return; }   // the keypad
    input.keys.add(k);
    const act = KEYMAP[k];
    if (act && !(act === 'interact' && document.activeElement && /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName))) input.queue.push(act);
  });
  addEventListener('keyup', (e) => input.keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => { input.keys.clear(); input.held.clear(); input.padA = false; input.stickX = input.stickY = 0; });
  // touch stick
  const st = $('stick'), kn = $('knob'); let id = null;
  const mv = (e) => { const r = st.getBoundingClientRect(); let x = (e.clientX - r.left - r.width / 2) / (r.width / 2), y = (e.clientY - r.top - r.height / 2) / (r.height / 2); const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } input.stickX = x; input.stickY = -y; kn.style.transform = `translate(${x * 30}px,${y * 30}px)`; };
  const up = () => { id = null; input.stickX = input.stickY = 0; kn.style.transform = ''; };
  st.addEventListener('pointerdown', (e) => { id = e.pointerId; st.setPointerCapture(id); mv(e); });
  st.addEventListener('pointermove', (e) => { if (e.pointerId === id) mv(e); });
  st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
  // a touch on the pad or the map is the game's alone: no long-press menu, selection or loupe (a phone's browser or a chat
  // app's; the presses and the drag that turns the view come as pointer events, untouched by this)
  for (const el of [$('touch'), $('gl')]) el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  // touch buttons act on press, not on release, so a combo keeps its rhythm
  document.querySelectorAll('[data-action]').forEach((b) => {
    b.addEventListener('pointerdown', (e) => { input.held.add(b.dataset.action); try { b.setPointerCapture(e.pointerId); } catch (x) { /* already gone */ } if (e.pointerType !== 'mouse') { e.preventDefault(); input.queue.push(b.dataset.action); } });
    const release = () => input.held.delete(b.dataset.action);   // lifted, or the press taken by the system (a slide off the button keeps it)
    b.addEventListener('pointerup', release); b.addEventListener('pointercancel', release); b.addEventListener('lostpointercapture', release);
    b.addEventListener('click', (e) => { if (e.detail === 0 || !coarse) input.queue.push(b.dataset.action); });
  });
}
const isTyping = (e) => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);

// gamepad: left stick moves; A hits (or talks), B dodges, X and Y are the skills, Start opens the menu, shoulders turn the view
// (a frame the gamepad is not granted to throws on getGamepads: no pad, the game goes on)
function pollPad() {
  let pads = []; try { if (navigator.getGamepads) pads = navigator.getGamepads(); } catch (e) { /* refused: no pad */ }
  const p = pads && [...pads].find(Boolean);
  input.padX = input.padY = 0; input.padA = false; if (!p) return;
  input.padA = !!(p.buttons[0] && p.buttons[0].pressed);
  const dz = (v) => Math.abs(v) < .2 ? 0 : v;
  input.padX = dz(p.axes[0] || 0); input.padY = -dz(p.axes[1] || 0);
  const edge = (i, act) => { const on = !!(p.buttons[i] && p.buttons[i].pressed); if (on && !input.padPrev[i]) input.queue.push(act); input.padPrev[i] = on; };
  edge(0, 'attack'); edge(1, 'dodge'); edge(2, 'skill1'); edge(3, 'skill2'); edge(6, 'skill3'); edge(9, 'menu'); edge(4, 'rotateL'); edge(5, 'rotateR'); edge(7, 'quill');
}

// the shoot button held (a chapter with a gun): the attack keys, the Hit button under a finger or the mouse, the pad's A
const fireHeld = () => input.keys.has('j') || input.keys.has('z') || input.held.has('attack') || input.padA;

// the move vector in screen terms: x right, y up
function moveVector() {
  let x = input.stickX + input.padX, y = input.stickY + input.padY; const k = input.keys;
  if (k.has('a') || k.has('arrowleft')) x -= 1; if (k.has('d') || k.has('arrowright')) x += 1;
  if (k.has('w') || k.has('arrowup')) y += 1; if (k.has('s') || k.has('arrowdown')) y -= 1;
  const l = Math.hypot(x, y); return l > 1 ? [x / l, y / l] : [x, y];
}

// ---- engine/61-exits.js
/* ---------- exit arrows: a soft double chevron on the ground at every way to another place (a door, a mine's mouth, a
   room's doorway, a path off the map), pointing through it; shown only near the cat and pulsing gently: easy to read,
   never in the way. Read off the area's exits: nothing placed by hand ---------- */
const exitArrows = [];   // { ex, x, z, a }
// where an exit's arrow lies and which way it points (pure: blocked is the area's walking test): the side of the exit's
// rectangle the cat cannot stand beyond (the house's wall, the map's edge) is where the exit leads; the arrow points
// there, and sits a little back from it, on the ground the cat comes over
function exitArrow(rect, blocked) {
  const [x0, z0, x1, z1] = rect, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  let to = null;
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const ex = dx > 0 ? x1 : dx < 0 ? x0 : cx, ez = dz > 0 ? z1 : dz < 0 ? z0 : cz; let n = 0;
    for (const d of [.4, .8, 1.2]) for (const s of [-.4, 0, .4]) if (!blocked(ex + dx * d + (dz ? s * (x1 - x0) : 0), ez + dz * d + (dx ? s * (z1 - z0) : 0))) n++;
    if (!to || n < to.n) to = { n, dx, dz };
  }
  return { x: cx - to.dx * .3, z: cz - to.dz * .3, a: Math.atan2(-to.dz, to.dx) };   // (a turn about y by a takes +x to (cos a, -sin a))
}
function exitsBuild() { exitArrows.length = 0; for (const ex of A.exits) exitArrows.push(Object.assign({ ex }, exitArrow(ex.rect, A.blocked))); }
const clearExits = () => { exitArrows.length = 0; if (exitMesh) exitMesh.count = 0; };
// drawn: two chevrons a arrow, added light (warm), brighter as the cat comes near, one instanced mesh for all
const EXIT_NEAR = 9;
let exitMesh = null, _em, _eq, _ep, _es, _ey, _ec;
function exitsDraw() {
  if (!exitMesh && !exitArrows.length) return;
  if (!exitMesh) {
    const pos = [], idx = [];
    // a chevron pointing along +x: two arms, each a thin quad, the second chevron behind the first
    const arm = (ax, az, bx, bz) => { const l = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / l * .05, nz = (bx - ax) / l * .05, v = pos.length / 3; pos.push(ax + nx, 0, az + nz, bx + nx, 0, bz + nz, bx - nx, 0, bz - nz, ax - nx, 0, az - nz); idx.push(v, v + 1, v + 2, v, v + 2, v + 3); };
    for (const o of [.2, -.15]) { arm(o - .22, -.26, o + .06, 0); arm(o + .06, 0, o - .22, .26); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m = legacy(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), false);
    exitMesh = new THREE.InstancedMesh(g, m, 24); exitMesh.frustumCulled = false; exitMesh.renderOrder = 3; scene.add(exitMesh);
    _em = new THREE.Matrix4(); _eq = new THREE.Quaternion(); _ep = new THREE.Vector3(); _es = new THREE.Vector3(1.3, 1, 1.3); _ey = new THREE.Vector3(0, 1, 0); _ec = new THREE.Color();
  }
  let n = 0; const pulse = .55 + .2 * Math.sin(time * 3);
  for (const e of exitArrows) {
    if (n >= 24 || (e.ex.when && !e.ex.when())) continue;
    const d = Math.hypot(e.x - player.x, e.z - player.z); if (d > EXIT_NEAR) continue;
    const k = Math.min(1, (EXIT_NEAR - d) / 3) * pulse;
    _eq.setFromAxisAngle(_ey, e.a); _ep.set(e.x, A.groundY(e.x, e.z) + .04, e.z); _em.compose(_ep, _eq, _es);
    exitMesh.setMatrixAt(n, _em); exitMesh.setColorAt(n, _ec.setRGB(k, k * .78, k * .42)); n++;
  }
  exitMesh.count = n; exitMesh.visible = n > 0; exitMesh.instanceMatrix.needsUpdate = true; if (exitMesh.instanceColor) exitMesh.instanceColor.needsUpdate = true;
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

// tips: def.tips = [{ rect: [x0, z0, x1, z1], text: () => key }]; shown once per visit when the cat steps into the rect.
// A thing that stands in the way until the story moves it ("shut": its line) gets one around its box, while it stands
let tipsShown = new Set(), shutTips = [];
function tipsStep() {
  if (dlg) return;
  for (const tip of A.def.tips ? A.def.tips.concat(shutTips) : shutTips) {
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
      const r = Q.reward || {}; if (r.coins) G.coins += r.coins; if (r.item) { addItem(r.item); itemCard(r.item, 1); } if (r.xp) gainXp(r.xp);
      sfx('quest'); toast(t('toast.questdone', { q: t(Q.name) }));
    } else toast(t('toast.questnext', { q: t(Q.name) }));
    saveGame(); questEvent(type === 'flag' ? 'flag' : 'none', null);   // a finished step may already satisfy the next one
  }
}

/* villagers: stand where the area puts them, turn to the cat when it talks to them */
function spawnNpc(id, x, z, face) {
  const N = NPCS[id]; if (!N) throw new Error('no npc "' + id + '"');
  const row = N.row, a = sheetActor(N.sheet || GAME.sheets.people, { down: row, up: row, side: row },
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
// a container's model (the low-poly page; not the wooden chest): drawn with the chests, so an opened one is redrawn spent
const chestModel = (c) => c.key !== CHEST.key && LP && lpModel(c.key);
// the top of a container's model above its ground, in world units (the sparkle stands over it, never inside a locker)
const modelTop = (m) => { let y = 0; for (const f of m.f) for (const q of f.p) y = Math.max(y, q[1]); return y * P; };
function chestProp(id, key, x, z, o) {
  const m = key !== CHEST.key && LP && lpModel(key), y = (o.y !== undefined ? o.y : A.groundY(x, z) + (o.dy || 0)) + Math.max(1.5, m ? modelTop(m) + .55 : 0);
  // something inside: a bright sparkle over it, quick enough to catch the eye; an opened one has none, and is drawn spent
  const sparkle = G.opened[id] ? null : fx('sparkle', x, z, { loop: true, size: 1.05, fps: 6, y });
  if (sparkle && player) sparkle.mesh.visible = Math.hypot(x - player.x, z - player.z) < 14;
  chests.set(id, { id, key, x, z, o, sparkle, lid: G.opened[id] ? CHEST.open : 0 });
}
function chestsBuild() {
  if (settings.wire) setTimeout(applyWire);   // after the mesh below exists
  if (chestMesh) chestMesh.dispose(); chestMesh = null; if (!chests.size) return;
  // the wooden chest with its lid; on the low-poly page a container with a model of its own (a locker, a crate, a safe)
  // too, drawn spent once opened (darker, greyer: lpPut's shade); any other is baked with the ground, only its sparkle here
  const list = [...chests.values()].filter((c) => c.key === CHEST.key || chestModel(c)); if (!list.length) return;
  chestMesh = propMesh(list.map((c) => chestModel(c) ? [lpModel(c.key), c.x, c.z, { rot: c.o.rot, flip: c.o.flip, y: c.o.y !== undefined ? c.o.y : A.groundY(c.x, c.z) + (c.o.dy || 0), shade: G.opened[c.id] ? .55 : 0 }]
    : LP && LP_CHEST ? [lpSettle(LP_CHEST(c.lid)), c.x, c.z, { rot: c.o.rot, flip: c.o.flip }] : settings.flat ? [cardFor(sp[c.key], c.o.rot, c.lid) || [], c.x, c.z, { flip: c.o.flip }] : [chestQuads(sp[c.key], c.lid), c.x, c.z, { rot: c.o.rot, flip: c.o.flip }]));
}
function openChestProp(id) {
  const c = chests.get(id); if (!c) return;
  if (c.sparkle) { c.sparkle.dispose(); c.sparkle = null; } if (c.key === CHEST.key) c.swing = 0; else if (chestModel(c)) chestsBuild();   // the lid swings open over CHEST.time (chestsTick); a model is redrawn spent at once
  fx('sparkle', c.x, c.z, { size: 1.2, fps: 8, y: A.groundY(c.x, c.z) + 1 });
}
function chestsTick(dt) {
  let moving = false;
  for (const c of chests.values()) if (c.swing !== undefined) { c.swing = Math.min(1, c.swing + dt / CHEST.time); const e = 1 - Math.pow(1 - c.swing, 3); c.lid = CHEST.open * (reduceMotion ? 1 : e); if (c.swing >= 1) delete c.swing; moving = true; }
  if (moving) { chestsBuild(); shadowHold = Math.max(shadowHold, 1); }   // the lid casts a shadow
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

// the scanner: things written in ink only it shows (a thing's "scan" flag), within reach of the cat and not found yet
function scanAround(things, flags, x, z, r) {
  const out = []; for (const [, tx, tz, , , o] of things) if (o && o.scan && !flags[o.scan] && Math.hypot(tx - x, tz - z) <= r) out.push(o.scan);
  return out;
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
    const c = act.chest, title = c.name || 'act.chest';   // (a container may name itself: a locker, a crate, a safe)
    if (G.opened[c.id]) { openDialogue({ name: title, lines: ['chest.empty'] }); return; }
    if (c.need && !has(c.need)) { sfx('no'); openDialogue({ name: title, lines: [c.needLine || 'chest.locked'] }); return; }
    G.opened[c.id] = true; addItem(c.item, c.n || 1); sfx('chest'); if (c.flag) G.flags[c.flag] = true; openChestProp(c.id);
    const done = () => { questEvent('collect', c.item); if (c.flag) questEvent('flag', c.flag); saveGame(); };
    if (c.item === 'coin') openDialogue({ name: title, lines: [t('chest.found', { item: t('item.coins', { n: c.n }) })].concat((c.lines || []).map((k) => t(k))), raw: true, after: done });
    else itemCard(c.item, c.n || 1, () => (c.lines && c.lines.length ? openDialogue({ name: title, lines: c.lines, after: done }) : done()));   // (engine/70-ui.js)
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

/* the area's living layer: villagers, farm animals, enemies, chests, desks, hooks; called after the ground is built */
function populate(def) {
  clearEnemies(); clearNpcs(); clearCritters(); clearFish(); clearAmbient(); clearFlats(); clearFloats(); clearChests(); clearMarks(); resetDim();
  A.show && A.show();
  for (const [key, x, z, , , o] of def.things || []) {
    if (!o || (o.when && !o.when())) continue;
    const d = AP.sprites[key].d || 8, front = z + d * P / 2 + .5, top = AP.sprites[key].r[3] * P * .75 + .4;   // (top: where a mark floats, engine/64-marks.js)
    if (o.chest) { A.acts.push({ x, z: front, r: 1.4, label: 'act.open', chest: o.chest, name: o.chest.name || 'act.chest', when: () => !G.opened[o.chest.id], mark: o.mark, at: [x, z, top] }); chestProp(o.chest.id, key, x, z, o); }
    if (o.desk) A.acts.push({ x, z: front, r: 1.4, label: 'act.read', desk: true, name: 'act.desk' });
    if (o.act) A.acts.push(Object.assign({ x, z: front, r: 1.4, mark: o.mark, at: [x, z, top] }, o.act));
  }
  chestsBuild();
  for (const [id, x, z, face, when] of def.npcs || []) if (!when || when()) spawnNpc(id, x, z, face);
  for (const [kind, x, z, n, r, when] of def.critters || []) if (!when || when()) spawnCritters(kind, x, z, n, r);
  if (def.fish) spawnFish(def.fish);
  ambientBuild(def); buildMoves(def);
  tipsShown = new Set();
  // (things that say the same line, a barricade of crates and barrels, share one place: the box around them all)
  const shut = new Map();
  for (const [, x, z, hx = 1, hz = 1, o] of def.things || []) {
    if (!o || !o.shut || (o.when && !o.when())) continue;
    const r = [x - hx - 1.5, z - hz - 1.5, x + hx + 1.5, z + hz + 1.5], s = shut.get(o.shutKey);
    if (s) s.rect = [Math.min(s.rect[0], r[0]), Math.min(s.rect[1], r[1]), Math.max(s.rect[2], r[2]), Math.max(s.rect[3], r[3])]; else shut.set(o.shutKey, { rect: r, text: o.shut });
  }
  shutTips = [...shut.values()];
  for (const [type, x, z, when] of def.spawns || []) if (!when || when()) spawnEnemy(type, x, z);
  exitsBuild();
  if (AREA_HOOKS[def.id]) AREA_HOOKS[def.id]();
  if (G) { G.seen[def.id] = true; questEvent('reach', def.id); }
}

// ---- engine/63-events.js
/* ---------- events: the conditions, values and command lists the game's data is written in ---------- */
// content/**/*.json holds no code. A condition, a value or a command list is compiled once, as the data loads, into
// the kind of small function the engine already calls (a thing's when(), a person's talk(), an area's music(), a
// lever's run()): nothing is interpreted per frame. A mistake is collected in errs with its place in the file, not
// thrown, so the build names every one at once; refs collects every name the data points at ([kind, name, place]) for
// the loader to check (engine/65-data.js), and the story's own names that are not records: ['flag', name] a flag
// read, ['set', name] / ['unset', name] one set or cleared, ['start', quest] a quest begun (the maker's map of the
// story: tools/maker.mjs).
const EVENTS = {};   // common events by name (story.json "events"), compiled; run by { "call": name }
let LOCAL = {};      // the area's scratch numbers ({ "set" } / { "add" }: the crypt's levers); never saved
const CMP = { '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b };
const isRec = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const unknownFields = (o, known, path, errs) => { for (const k of Object.keys(o)) if (!known.includes(k)) errs.push(`${path}: unknown field "${k}" (known: ${known.join(', ')})`); };

// a value: a string or a number; { t: key } (that text in the player's language); { count: [item, ...] } (how many of
// them the cat holds); { var: name } (a scratch number); { arg: name } (what a call passed); { choose: [[condition,
// value], ...], else: value } (the first whose condition holds). ref: what kind of name its strings are ('key' a
// language key, 'music' a track), recorded for the loader's check
function compileValue(v, path, errs, refs, ref) {
  if (typeof v === 'string') { if (ref) refs.push([ref, v, path]); return () => v; }
  if (typeof v === 'number') return () => v;
  const kind = isRec(v) && ['t', 'count', 'var', 'arg', 'choose'].find((k) => k in v);
  if (!kind) { errs.push(`${path}: not a value: ${JSON.stringify(v)}`); return () => undefined; }
  unknownFields(v, kind === 'choose' ? ['choose', 'else'] : [kind], path, errs);
  const w = v[kind];
  if (kind === 't') { refs.push(['key', w, path + '.t']); return () => t(w); }
  if (kind === 'count') { if (!Array.isArray(w)) { errs.push(`${path}.count: a list of items`); return () => 0; } w.forEach((id, i) => refs.push(['item', id, `${path}.count[${i}]`])); return () => w.filter((id) => has(id)).length; }
  if (kind === 'var') return () => LOCAL[w] || 0;
  if (kind === 'arg') return (sc) => (sc && sc.args ? sc.args[w] : undefined);
  if (!Array.isArray(w)) { errs.push(`${path}.choose: a list of [condition, value]`); return () => undefined; }
  const cases = w.map((c, i) => Array.isArray(c) && c.length === 2 ? [compileCond(c[0], `${path}.choose[${i}][0]`, errs, refs), compileValue(c[1], `${path}.choose[${i}][1]`, errs, refs, ref)] : (errs.push(`${path}.choose[${i}]: [condition, value]`), [() => false, () => undefined]));
  const other = 'else' in v ? compileValue(v.else, path + '.else', errs, refs, ref) : () => undefined;
  return (sc) => { for (const [c, f] of cases) if (c(sc)) return f(sc); return other(sc); };
}

// a comparison: a number (equal to it) or [op, value]
function compileCmp(spec, path, errs, refs) {
  if (typeof spec === 'number') return (a) => a === spec;
  if (Array.isArray(spec) && spec.length === 2 && CMP[spec[0]]) { const f = CMP[spec[0]], w = compileValue(spec[1], path + '[1]', errs, refs); return (a, sc) => f(a, w(sc)); }
  errs.push(`${path}: a comparison is a number or [op, value], op one of ${Object.keys(CMP).join(' ')}`); return () => false;
}

// a condition: true; { flag }; { has, n? }; { quest, step } (-1: not started); { var, is }; { area } (the area the cat is
// in); { touch } (a touch screen); { dialogue } (one is open); { enemies } (how many still stand); { x } (where the cat
// stands, west to east); { not }; { all: [...] }; { any: [...] }
const COND_KINDS = { flag: [], has: ['n'], quest: ['step'], var: ['is'], area: [], touch: [], dialogue: [], enemies: [], x: [], not: [], all: [], any: [] };
// the flags something reads (a condition, a quest step, the gun; the skills, read by the engine): only those count as
// news for the marks (engine/64-marks.js; a diary page's own "read" flag, which nothing asks about, is no story)
const FLAGS_READ = new Set();
function compileCond(c, path, errs, refs) {
  if (c === true) return () => true;
  const kind = isRec(c) && Object.keys(COND_KINDS).find((k) => k in c);
  if (!kind) { errs.push(`${path}: not a condition: ${JSON.stringify(c)}`); return () => false; }
  unknownFields(c, [kind, ...COND_KINDS[kind]], path, errs);
  const v = c[kind];
  switch (kind) {
    case 'flag': FLAGS_READ.add(v); refs.push(['flag', v, path + '.flag']); return () => !!G.flags[v];   // (a flag some condition asks about: one that matters, engine/64-marks.js)
    case 'has': refs.push(['item', v, path + '.has']); return () => has(v, c.n);
    case 'quest': { refs.push(['quest', v, path + '.quest']); const k = compileCmp(c.step, path + '.step', errs, refs); return (sc) => k(qStep(v), sc); }
    case 'var': { const k = compileCmp(c.is, path + '.is', errs, refs); return (sc) => k(LOCAL[v] || 0, sc); }
    case 'area': refs.push(['area', v, path + '.area']); return () => !!A && A.def.id === v;
    case 'touch': return () => !!coarse === !!v;
    case 'dialogue': return () => !!dlg === !!v;
    case 'enemies': { const k = compileCmp(v, path + '.enemies', errs, refs); return (sc) => k(enemies.filter((e) => e.hp > 0).length, sc); }
    case 'x': { const k = compileCmp(v, path + '.x', errs, refs); return (sc) => k(player.x, sc); }
    case 'not': { const k = compileCond(v, path + '.not', errs, refs); return (sc) => !k(sc); }
    default: {   // all, any
      if (!Array.isArray(v)) { errs.push(`${path}.${kind}: a list of conditions`); return () => false; }
      const ks = v.map((x, i) => compileCond(x, `${path}.${kind}[${i}]`, errs, refs));
      return kind === 'all' ? (sc) => ks.every((k) => k(sc)) : (sc) => ks.some((k) => k(sc));
    }
  }
}

// dialogue lines as openDialogue() takes them: a key (a value), or [speaker, key] / [speaker, key, { name: value }]
function compileLines(lines, path, errs, refs) {
  if (!Array.isArray(lines)) { errs.push(`${path}: a list of lines`); return () => []; }
  const fs = lines.map((l, i) => {
    const p = `${path}[${i}]`; if (!Array.isArray(l)) return compileValue(l, p, errs, refs, 'key');
    if (l.length < 2 || l.length > 3) errs.push(`${p}: [speaker, key] or [speaker, key, vars]`);
    refs.push(['speaker', l[0], p + '[0]']); const key = compileValue(l[1], p + '[1]', errs, refs, 'key'), vars = l[2] && compileVars(l[2], p + '[2]', errs, refs);
    return vars ? (sc) => [l[0], key(sc), vars(sc)] : (sc) => [l[0], key(sc)];
  });
  return (sc) => fs.map((f) => f(sc));
}
function compileVars(o, path, errs, refs) {
  if (!isRec(o)) { errs.push(`${path}: a record of values`); return () => ({}); }
  const fs = Object.entries(o).map(([k, w]) => [k, compileValue(w, `${path}.${k}`, errs, refs)]);
  return (sc) => Object.fromEntries(fs.map(([k, f]) => [k, f(sc)]));
}

// a command list: [{ "say": ... }, { "if": ... }, ...], each command named by its first field. A command compiles to
// (sc, next) => over: true when it is over at once; false when it waits (a dialogue, a pause), and then it calls next
// once it is. sc: { self: the enemy an onDefeat is about, args: what a call passed }
const CMD_FIELDS = { say: ['name', 'pic', 'voice', 'choices'], if: ['then', 'else'], call: ['args'], flag: [], unflag: [], take: ['n'], quest: [], drop: ['at', 'offset'], spawn: ['at', 'aware', 'hunt', 'onDefeat'], set: ['to'], add: ['n'], sfx: [], toast: ['vars'], shake: [], music: [], save: [], reopen: [], wait: [], end: [], keypad: ['name', 'then', 'else'], go: ['at', 'face'] };
function compileCmds(list, path, errs, refs) {
  if (!Array.isArray(list)) { errs.push(`${path}: a list of commands`); return []; }
  return list.map((c, i) => compileCmd(c, `${path}[${i}]`, errs, refs));
}
function compileCmd(c, path, errs, refs) {
  const kind = isRec(c) ? Object.keys(c)[0] : null;
  if (!CMD_FIELDS[kind]) { errs.push(`${path}: not a command: ${JSON.stringify(c)} (commands: ${Object.keys(CMD_FIELDS).join(', ')})`); return () => true; }
  unknownFields(c, [kind, ...CMD_FIELDS[kind]], path, errs);
  const v = c[kind], at = (f) => `${path}.${f}`, xz = (p, f) => (Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)) || (errs.push(`${at(f)}: [x, z]`), false);
  switch (kind) {
    case 'say': {
      if (c.name !== undefined) refs.push(['key', c.name, at('name')]);
      const lines = compileLines(v, at('say'), errs, refs), ch = c.choices && (Array.isArray(c.choices) ? c.choices : (errs.push(`${at('choices')}: a list of [key, commands]`), [])).map((x, j) => [compileValue(x[0], `${path}.choices[${j}][0]`, errs, refs, 'key'), compileCmds(x[1], `${path}.choices[${j}][1]`, errs, refs)]);
      return (sc, next) => {
        const o = { name: c.name, lines: lines(sc) }; if (c.pic) o.pic = c.pic; if (c.voice) o.voice = c.voice;
        // a choice closes the dialogue and runs its own commands, then this list goes on; without choices, closing goes on
        if (ch) o.choices = ch.map(([k, L]) => [k(sc), () => { if (runSub(L, sc, next)) next(); }]); else o.after = next;
        openDialogue(o); return false;
      };
    }
    case 'if': { const k = compileCond(v, at('if'), errs, refs), a = compileCmds(c.then || [], at('then'), errs, refs), b = compileCmds(c.else || [], at('else'), errs, refs); return (sc, next) => runSub(k(sc) ? a : b, sc, next); }
    case 'call': { refs.push(['event', v, at('call')]); const args = Object.entries(c.args || {}).map(([k, w]) => [k, compileValue(w, `${path}.args.${k}`, errs, refs)]); return (sc, next) => runSub(EVENTS[v], { self: sc.self, args: Object.fromEntries(args.map(([k, f]) => [k, f(sc)])) }, next); }
    case 'flag': refs.push(['set', v, at('flag')]); return () => { setFlag(v); return true; };
    case 'unflag': refs.push(['unset', v, at('unflag')]); return () => { delete G.flags[v]; return true; };
    case 'take': refs.push(['item', v, at('take')]); return () => { takeItem(v, c.n); return true; };
    case 'quest': refs.push(['quest', v, at('quest')], ['start', v, at('quest')]); return () => { startQuest(v); return true; };
    case 'drop': {
      refs.push(['item', v, at('drop')]); const off = c.offset || [0, 0]; if (c.at !== 'self') xz(c.at, 'at'); if (c.offset) xz(c.offset, 'offset');
      return (sc) => { const [x, z] = c.at === 'self' ? [sc.self.x, sc.self.z] : c.at; drop(v, x + off[0], z + off[1]); return true; };
    }
    case 'spawn': {
      refs.push(['enemy', v, at('spawn')]); xz(c.at, 'at'); const od = c.onDefeat && compileCmds(c.onDefeat, at('onDefeat'), errs, refs);
      return () => { const e = spawnEnemy(v, c.at[0], c.at[1]); if (c.aware || c.hunt) e.aware = true; if (c.hunt) e.hunt = true;   // (hunt: an ambush, the enemy never leashed back home)
        if (od) e.onDefeat = () => runCmds(od, { self: e }); return true; };
    }
    case 'set': { const f = compileValue(c.to, at('to'), errs, refs); return (sc) => { LOCAL[v] = f(sc); return true; }; }
    case 'add': return () => { LOCAL[v] = (LOCAL[v] || 0) + (c.n === undefined ? 1 : c.n); return true; };
    case 'sfx': refs.push(['sfx', v, at('sfx')]); return () => { sfx(v); return true; };
    case 'toast': { const k = compileValue(v, at('toast'), errs, refs, 'key'), vars = c.vars && compileVars(c.vars, at('vars'), errs, refs); return (sc) => { toast(vars ? t(k(sc), vars(sc)) : t(k(sc))); return true; }; }
    case 'shake': return () => { shake(v); return true; };
    // (while the cat plays, the area's own track takes over on the next frame: this is for the ending's screen)
    case 'music': refs.push(['music', v, at('music')]); return () => { playTrack(v); return true; };
    case 'save': return () => { saveGame(); return true; };
    // (the area is built again behind a fade; the list goes on at once, as the levers always did)
    case 'reopen': return () => { reopen(); return true; };
    // (real time, as the Scribe's line always waited; the frozen checks wait it out with a real sleep)
    case 'wait': if (!(v >= 0)) errs.push(`${at('wait')}: seconds`); return (sc, next) => { setTimeout(next, v * 1000); return false; };
    // another area, as walking through a door does (the lift's choices)
    case 'go': refs.push(['area', v, at('go')]); xz(c.at, 'at'); if (c.face) xz(c.face, 'face'); return () => { goTo({ to: v, at: c.at, face: c.face || [0, 1] }); return true; };
    // a keypad (a safe, a door): the code typed runs then, a wrong one else; closed without a code, neither
    case 'keypad': {
      if (typeof v !== 'string' || !/^\d{1,6}$/.test(v)) errs.push(`${at('keypad')}: a code of 1 to 6 digits`);
      if (c.name !== undefined) refs.push(['key', c.name, at('name')]);
      const a = compileCmds(c.then || [], at('then'), errs, refs), b = compileCmds(c.else || [], at('else'), errs, refs);
      return (sc, next) => { openKeypad({ name: c.name, len: String(v).length, done: (code) => { if (runSub(code === v ? a : b, sc, next)) next(); }, cancel: next }); return false; };
    }
    default: return () => { markDone(); ui.screen = 'end'; showScreen('end'); return true; };   // end (the chapter finished: the shared record)
  }
}

// runs a compiled list at once up to the first command that waits; that command's next goes on from there. next comes
// from the engine's own callback (a dialogue's after runs in the game step whose press closed it), so the story moves
// on in that very step: the checks drive the game by hand and read it straight after
function runCmds(list, sc, done) { let i = 0; const s = sc || {}; const go = () => { while (i < list.length) if (!list[i++](s, go)) return; if (done) done(); }; go(); }
// a branch, a choice or a call: over at once (true: the caller goes on in its own loop) or later (false: its end calls next)
function runSub(list, sc, next) { let now = true, over = false; runCmds(list, sc, () => { over = true; if (!now) next(); }); now = false; return over; }

// ---- engine/64-marks.js
/* ---------- marks: a "!" over whatever the story wants next, to catch a distracted player's eye ---------- */
// Read off the data and the state, never placed by hand (engine/65-data.js compileEffects): a person whose talk now
// would set a flag, start a quest or give an item not yet had, or whom a quest's current step asks to talk to; a thing
// whose act now would do the same (the statue's lesson, a lever, the cage down the mine); a closed chest holding what a
// quest's current step asks for. "mark": false in the data turns one off, "mark": a condition decides for it. None
// while a dialogue is open or off the play screen.
const marks = new Map();   // act → its "!" (made the first time it shows)
const clearMarks = () => { for (const el of marks.values()) el.remove(); marks.clear(); };

// what the quests' current steps ask for: people to talk to, items to have
function questWants() {
  const talk = new Set(), items = new Set();
  if (G) for (const [id, Q] of Object.entries(QUESTS)) {
    const q = G.quests[id]; if (!q || q.s >= Q.steps.length) continue;
    const st = Q.steps[q.s]; if (st.on[0] === 'talk') talk.add(st.on[1]);
    for (const i of st.items || []) if (!has(i)) items.add(i);
  }
  return { talk, items };
}
// whether an act of the area shows its mark now
function markedNow(a, wants) {
  if (a.when && !a.when()) return false;
  const own = a.npc ? a.npc.N.mark : a.mark;
  if (own === false) return false;
  if (own) return !!own({});
  if (a.npc) return wants.talk.has(a.npc.id) || a.npc.N.news();
  if (a.chest) return wants.items.has(a.chest.item);
  return !!a.fx && isNews(effectsOf(a.fx));
}
// the marks shown now, for the checks: [name, x, z]
function marksNow() {
  if (!A || !G) return [];
  const w = questWants(); return A.acts.filter((a) => markedNow(a, w)).map((a) => [a.npc ? a.npc.id : a.chest ? 'chest ' + a.chest.id : a.name, +(a.at ? a.at[0] : a.x).toFixed(1), +(a.at ? a.at[1] : a.z).toFixed(1)]);
}
const _mv = new THREE.Vector3();
function marksDraw() {
  if (!A || !G) return;
  const on = ui.screen === 'game' && !dlg, w = on && questWants(), r = { width: canvas.clientWidth, height: canvas.clientHeight };
  for (const a of A.acts) {
    const show = on && markedNow(a, w);
    let el = marks.get(a);
    if (!show) { if (el) el.style.display = 'none'; continue; }
    if (!el) { el = document.createElement('span'); el.className = 'float mark'; el.textContent = '!'; $('floats').appendChild(el); marks.set(a, el); }
    // over a person's head, over a thing's top; bobbing a little, every mark in step
    const x = a.npc ? a.npc.a.x : a.at ? a.at[0] : a.x, z = a.npc ? a.npc.a.z : a.at ? a.at[1] : a.z, y = A.groundY(x, z) + (a.npc ? 2.1 : a.at ? a.at[2] : 1.6) + Math.sin(time * 5) * .08;
    _mv.set(x, y, z).project(cam);
    el.style.display = ''; el.style.transform = `translate(${((_mv.x + 1) / 2 * r.width).toFixed(1)}px,${((1 - _mv.y) / 2 * r.height).toFixed(1)}px) translate(-50%,-100%)`;
  }
}

// ---- engine/65-data.js
/* ---------- the game's data: the content's JSON files upgraded, checked, and turned into what the engine runs ---------- */
// GAME_DATA = { files: { 'chapter1/items.json': { schema: 1, items: { ... } }, ... } }, put in game.js by the build
// (tools/lib/data.mjs, which also runs this file in node to check the data before it ships). Each file carries the
// schema it was written for: an older one is upgraded by DATA_MIGRATIONS in turn, a newer one refused. A file adds
// records to collections by id; one id in two places is an error. JSON is the public format, written to be read and
// edited (named fields, colours as '#rrggbb', no code); compileGameData() turns it into the shapes the engine always
// ran (tuples, functions), so the engine and the checks see what the content scripts used to make.
const DATA_SCHEMA = 2;
// n → (file) => void: rewrites a schema-n file's records as schema n + 1 (the loader then bumps its number; on disk:
// tools/migrate-data.mjs). 1 → 2: every placement in an area has an id (placeIds)
const DATA_MIGRATIONS = { 1: (f) => { for (const a of Object.values(f.areas || {})) placeIds(a); } };
// what an area places (things, people, spawns, critters, ways out), each with an id of its own in the area: a person's is
// the person; the rest are named from what they are (a thing's key, a spawn's enemy, a critter's kind, "to-" a way's
// area), "-1", "-2"... in order where one name is placed more than once. An id stays as it is when the list is
// reordered or grows, so a change made to a placement (an edit, a patch) still finds it
const PLACE_LISTS = ['things', 'npcs', 'spawns', 'critters', 'exits'];
const placeBase = (list, v) => list === 'things' ? v.key : list === 'spawns' ? v.type : list === 'critters' ? v.kind : list === 'exits' ? 'to-' + v.to : v.id;
function placeIds(a) {
  const n = {};
  for (const list of PLACE_LISTS) for (const v of a[list] || []) if (list !== 'npcs' && v.id === undefined) n[placeBase(list, v)] = (n[placeBase(list, v)] || 0) + 1;
  const i = {};
  for (const list of PLACE_LISTS) if (list !== 'npcs' && a[list]) a[list] = a[list].map((v) => {
    if (v.id !== undefined) return v;
    const b = placeBase(list, v); i[b] = (i[b] || 0) + 1;
    return Object.assign({ id: n[b] > 1 ? b + '-' + i[b] : b }, v);
  });
}
// an id for a placement added to an area: its name while the area has none of that name, else the name with the next
// number after those it has
function newPlaceId(a, list, v) {
  const b = placeBase(list, v), used = new Set(PLACE_LISTS.flatMap((l) => (a[l] || []).map((x) => x.id)));
  let k = 0; for (const id of used) { const m = typeof id === 'string' && id.startsWith(b + '-') && /^\d+$/.test(id.slice(b.length + 1)) ? +id.slice(b.length + 1) : 0; if (m > k) k = m; }
  return !used.has(b) && !k ? b : b + '-' + (k + 1);
}
const GAME = {};              // game.json's record: start, hero, levels, sheets, titleArt, map, intro, onPlay
const BEHAVIOURS = {};        // plugins (content/plugins/): enemy behaviours by name, { ai?, onHit?, onDefeat? }, named by enemies.json "behaviour"
// chapters: each top-level folder of the content holding a game.json is a chapter, its id the folder's name; a file at the
// content's root (curate.json) belongs to every chapter. A page plays one chapter: engine/90-boot.js sets CHAPTER_ID and
// loads chapterFiles(GAME_DATA, CHAPTER_ID) once (another chapter is another page load: engine/66-chapters.js)
let CHAPTER_ID = null;
const chapterOf = (data, id) => (((data && data.files && data.files[id + '/game.json']) || {}).game || {}).chapter || {};
const chapterIds = (data) => Object.keys((data && data.files) || {}).filter((f) => /^[^/]+\/game\.json$/.test(f)).map((f) => f.split('/')[0])
  .sort((a, b) => (chapterOf(data, a).order || 0) - (chapterOf(data, b).order || 0) || (a < b ? -1 : 1));
function chapterFiles(data, id) { const files = {}; for (const [f, v] of Object.entries(data.files)) if (!f.includes('/') || f.startsWith(id + '/')) files[f] = v; return { files }; }
// what no single chapter's compile can see: no chapter at all, one save slot shared by two, a folder name the address's
// hash (#next=) and the save code cannot carry as they are
function checkChapters(data) {
  const errs = [], ids = chapterIds(data), keys = {};
  if (!ids.length) errs.push('no chapter: a folder of content/ holding a game.json (content/chapter1/game.json)');
  for (const id of ids) {
    if (!/^[a-z0-9_-]+$/.test(id)) errs.push(`"${id}": a chapter folder's name is lower-case letters, digits, _ and -`);
    const k = chapterOf(data, id).save; if (!k) continue;
    if (keys[k]) errs.push(`save key "${k}" is used by ${keys[k]} and ${id}: each chapter keeps its own slot`); else keys[k] = id;
  }
  return errs;
}
const COLLECTIONS = { game: 'game', items: 'item', enemies: 'enemy', speakers: 'speaker', npcs: 'npc', quests: 'quest', events: null, music: 'music', areas: 'area', curate: null };
const REF_OF = { item: 'items', enemy: 'enemies', area: 'areas', npc: 'npcs', speaker: 'speakers', quest: 'quests', event: 'events', music: 'music' };

// a field's kind: 'num' 'int' 'str' 'bool' 'null' 'any' 'colour' ('#rrggbb') 'xz' ([x, z]) 'rect' ([x0, z0, x1, z1]);
// 'key' (a language key) or the name of another record ('item' 'enemy' 'area' 'npc' 'speaker' 'quest' 'event'
// 'music'); [values] (one of them); { field: kind } a record ('field!' is required); { list }, { map } (a record by
// id), { tuple }, { or }. 'cond', 'value', 'cmds', 'lines' and 'on' are checked by their compilers (engine/63-events.js)
// an atmosphere (engine/36-look.js): bloom over thr, haze toward the far side, saturation, drifting motes
const ATMOS_KIND = { bloom: 'num', thr: 'num', haze: 'num', sat: 'num', pool: 'num', motes: ['embers', 'dust', 'ink'] };
const DATA_SPEC = {
  game: {
    'start!': { 'area!': 'area' },
    'chapter!': { 'title!': 'key', 'blurb!': 'key', 'minutes!': 'int', 'order!': 'int', 'save!': 'str', 'styles!': { list: ['lowpoly', 'diorama'] }, card: { tuple: ['str', 'str'] }, doneFlag: 'str', hidden: 'bool' },
    'hero!': { 'sheet!': 'str', 'views!': { 'down!': 'str', 'up!': 'str', 'side!': 'str' }, 'anims!': { map: 'any' }, start: { level: 'int', coins: 'int', flags: { list: 'str' }, inv: { map: 'int' } }, 'equip!': { 'weapon!': { or: ['null', 'item'] }, 'armour!': { or: ['null', 'item'] }, 'charm!': { or: ['null', 'item'] } },
      gun: { 'mag!': 'int', 'rate!': 'num', 'reload!': 'num', 'dmg!': 'num', 'range!': 'num', 'speed!': 'num', 'cone!': 'num', 'assist!': 'num', flag: 'str', muzzle: { map: { tuple: ['num', 'num'] } } } },
    'levels!': { 'xp!': { list: 'num' }, 'base!': { 'hp!': { tuple: ['num', 'num'] }, 'ink!': { tuple: ['num', 'num'] }, 'atk!': { tuple: ['num', 'num'] }, 'def!': { tuple: ['num', 'num'] } } },
    'sheets!': { 'portraits!': { or: ['str', { list: 'str' }] }, 'items!': { or: ['str', { list: 'str' }] }, 'people!': 'str' }, 'titleArt!': { tuple: ['str', 'str'] },
    map: { 'area!': 'area', 'marks!': { list: 'str' } }, intro: 'event', onPlay: 'event',
    atmos: ATMOS_KIND, hitFx: 'bool', inkName: 'key',
  },
  item: { slot: ['weapon', 'armour', 'charm'], atk: 'num', def: 'num', hp: 'num', ink: 'num', use: { hp: 'num', ink: 'num' }, price: 'num', key: 'bool', mag: 'int' },
  enemy: { 'sheet!': 'str', 'row!': 'str', 'hp!': 'num', 'atk!': 'num', def: 'num', 'speed!': 'num', 'sight!': 'num', 'reach!': 'num', windup: 'num', strike: 'num', recover: 'num', xp: 'num', coins: { tuple: ['int', 'int'] }, 'r!': 'num',
    move: ['hop', 'lunge', 'smash', 'shoot', 'throw'], keep: { tuple: ['num', 'num'] }, burst: 'int', gap: 'num', shotSpeed: 'num', range: 'num', fuse: 'num', blast: 'num', fly: 'num', shield: 'bool', poise: 'bool', size: 'num', boss: 'key', anims: { map: 'any' }, drops: { list: { 'item!': 'item', 'chance!': 'num' } }, behaviour: 'str' },
  speaker: { 'name!': 'key', 'pic!': 'str', emote: ['surprise', 'joy', 'worry'] },   // (emote: engine/70-ui.js emote)
  npc: { 'row!': 'str', 'name!': 'key', 'pic!': 'str', voice: 'num', sheet: 'str', mark: 'cond', 'pages!': { list: { if: 'cond', 'lines!': 'lines', then: 'cmds', shop: { list: 'item' } } } },
  quest: { 'name!': 'key', main: 'bool', 'steps!': { list: { 'text!': 'key', 'on!': 'on', then: 'cmds' } }, reward: { xp: 'num', coins: 'num', item: 'item' } },
  music: { 'bpm!': 'num', 'voices!': { map: { list: 'str' } } },
  area: {
    'name!': 'key', cell: 'num', chunk: { tuple: ['int', 'int'] }, keep: 'bool', 'tod!': ['alba', 'giorno', 'tramonto', 'notte', 'interno', 'cripta', 'nave', 'emergenza'], 'start!': 'xz', camNorth: 'num', step: 'num', music: 'value', halo: 'colour', flicker: 'bool', strata: { list: 'colour' }, atmos: { or: ['null', ATMOS_KIND] },
    'legend!': { map: { 'tile!': 'str', h: 'num', water: 'bool', swim: 'bool', ledge: 'bool', wall: 'colour', cliff: 'bool', harm: 'num' } }, 'map!': { list: 'str' },
    things: { list: { 'id!': 'str', 'key!': 'str', 'at!': 'xz', box: 'xz', when: 'cond', mark: 'cond', shut: 'value', climb: 'bool', scan: 'str', rot: 'int', flip: 'bool', dy: 'num', desk: 'bool',
      door: { 'to!': 'area', 'at!': 'xz', face: 'xz', need: 'item' }, chest: { 'id!': 'str', 'item!': 'item', n: 'int', flag: 'str', lines: { list: 'key' }, need: 'item', needLine: 'key', name: 'key' },
      act: { 'label!': 'key', 'name!': 'key', 'run!': 'cmds' }, look: { 'label!': 'key', 'name!': 'key', 'lines!': { list: 'key' } } } },
    npcs: { list: { 'id!': 'npc', 'at!': 'xz', face: 'xz', when: 'cond' } }, spawns: { list: { 'id!': 'str', 'type!': 'enemy', 'at!': 'xz', when: 'cond' } },
    fish: 'int',   // (how many fish in the area's water: engine/59-fish.js)
    critters: { list: { 'id!': 'str', 'kind!': ['hen', 'rooster', 'chick', 'dog', 'pig', 'sheep'], 'at!': 'xz', n: 'int', r: 'num', when: 'cond' } },   // (farm animals: engine/59-critters.js)
    lamps: { list: { list: 'num' } }, solids: { list: 'rect' }, exits: { list: { 'id!': 'str', 'rect!': 'rect', 'to!': 'area', 'at!': 'xz', face: 'xz', need: 'item', when: 'cond' } },
    tips: { list: { 'rect!': 'rect', 'text!': 'value' } }, onEnter: 'cmds',
  },
};

// (a record kind may have a field named "map": { map: kind } is the map kind only when "map" is its only field)
function checkKind(v, k, path, errs, refs) {
  const bad = (what) => errs.push(`${path}: expected ${what}, got ${JSON.stringify(v)}`);
  if (Array.isArray(k)) { if (!k.includes(v)) bad('one of ' + k.join(', ')); return; }
  if (typeof k === 'object') {
    if (k.list) { if (!Array.isArray(v)) return bad('a list'); v.forEach((x, i) => checkKind(x, k.list, `${path}[${i}]`, errs, refs)); return; }
    if (k.map && Object.keys(k).length === 1) { if (!isRec(v)) return bad('a record'); for (const [id, x] of Object.entries(v)) checkKind(x, k.map, `${path}.${id}`, errs, refs); return; }
    if (k.tuple) { if (!Array.isArray(v) || v.length !== k.tuple.length) return bad(`a list of ${k.tuple.length}`); v.forEach((x, i) => checkKind(x, k.tuple[i], `${path}[${i}]`, errs, refs)); return; }
    if (k.or) { const fit = k.or.find((kk) => { const e = []; checkKind(v, kk, path, e, []); return !e.length; }); if (fit === undefined) bad(k.or.map((kk) => typeof kk === 'string' ? kk : 'a record').join(' or ')); else checkKind(v, fit, path, errs, refs); return; }
    if (!isRec(v)) return bad('a record');
    const spec = Object.fromEntries(Object.entries(k).map(([f, kk]) => [f.replace(/!$/, ''), kk]));
    for (const f of Object.keys(k)) if (f.endsWith('!') && !(f.slice(0, -1) in v)) errs.push(`${path}: missing "${f.slice(0, -1)}"`);
    for (const [f, x] of Object.entries(v)) { if (!(f in spec)) errs.push(`${path}: unknown field "${f}" (known: ${Object.keys(spec).join(', ')})`); else checkKind(x, spec[f], `${path}.${f}`, errs, refs); }
    return;
  }
  switch (k) {
    case 'num': if (typeof v !== 'number' || !Number.isFinite(v)) bad('a number'); return;
    case 'int': if (!Number.isInteger(v)) bad('a whole number'); return;
    case 'str': if (typeof v !== 'string') bad('a string'); return;
    case 'bool': if (typeof v !== 'boolean') bad('true or false'); return;
    case 'null': if (v !== null) bad('null'); return;
    case 'colour': if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) bad("a colour '#rrggbb'"); return;
    case 'xz': if (!Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite)) bad('[x, z]'); return;
    case 'rect': if (!Array.isArray(v) || v.length !== 4 || !v.every(Number.isFinite)) bad('[x0, z0, x1, z1]'); return;
    case 'any': case 'cond': case 'value': case 'cmds': case 'lines': case 'on': return;
    case 'key': if (typeof v !== 'string') return bad('a language key'); refs.push(['key', v, path]); return;
    default: if (!REF_OF[k]) throw new Error('DATA_SPEC: no kind ' + k); if (typeof v !== 'string') return bad(`the name of a${/^[aeiou]/.test(k) ? 'n' : ''} ${k}`); refs.push([k, v, path]);
  }
}

// the files merged, checked and compiled; errs gets every problem, each with its file and place
function compileGameData(data, errs) {
  const P = { game: null }, from = {}, refs = [], out = { refs };
  for (const c of Object.keys(COLLECTIONS)) if (c !== 'game') P[c] = {};
  for (const [name, f0] of Object.entries((data && data.files) || {})) {
    const f = JSON.parse(JSON.stringify(f0));   // (upgraded in place: the caller's copy stays as it was)
    if (!isRec(f) || !Number.isInteger(f.schema)) { errs.push(`${name}: no "schema" version`); continue; }
    if (f.schema > DATA_SCHEMA) { errs.push(`${name}: written for schema ${f.schema}; this engine reads up to ${DATA_SCHEMA} (made by a newer engine)`); continue; }
    while (f.schema < DATA_SCHEMA && DATA_MIGRATIONS[f.schema]) { DATA_MIGRATIONS[f.schema](f); f.schema++; }
    if (f.schema < DATA_SCHEMA) { errs.push(`${name}: no upgrade from schema ${f.schema}`); continue; }
    for (const [c, recs] of Object.entries(f)) {
      if (c === 'schema') continue;
      if (!(c in COLLECTIONS)) { errs.push(`${name}: unknown collection "${c}" (known: ${Object.keys(COLLECTIONS).join(', ')})`); continue; }
      if (c === 'game') { if (P.game) errs.push(`${name}: a second game record (the first is in ${from.game})`); else { P.game = recs; from.game = name; } continue; }
      if (!isRec(recs)) { errs.push(`${name}: ${c}: a record of ids`); continue; }
      for (const [id, r] of Object.entries(recs)) { const k = c + '.' + id; if (from[k]) errs.push(`${name}: ${k} is also in ${from[k]}`); else { P[c][id] = r; from[k] = name; } }
    }
  }
  const where = (c, id) => `${from[c + '.' + id]}: ${c}.${id}`;
  if (!P.game) errs.push('game.json: no "game" record (the start, the hero, the levels, the sheets, the title, the map)');
  if (P.game) checkKind(P.game, DATA_SPEC.game, `${from.game}: game`, errs, refs);
  for (const [c, kind] of Object.entries(COLLECTIONS)) if (kind && c !== 'game') for (const [id, r] of Object.entries(P[c])) checkKind(r, DATA_SPEC[kind], where(c, id), errs, refs);
  if (errs.length) return out;   // (compiling assumes the shapes are right)
  // every item's name and description are language keys too
  for (const id of Object.keys(P.items)) refs.push(['key', 'item.' + id, where('items', id)], ['key', 'desc.' + id, where('items', id)]);
  Object.assign(out, { game: P.game, items: P.items, speakers: P.speakers, curate: P.curate, events: {}, enemies: {}, behaviours: {}, npcs: {}, quests: {}, music: {}, areas: {}, hooks: {} });
  for (const [id, L] of Object.entries(P.events)) out.events[id] = compileCmds(L, where('events', id), errs, refs);
  for (const k of Object.keys(EFFECT_CALLS)) delete EFFECT_CALLS[k];
  if (P.game && P.game.hero && P.game.hero.gun && P.game.hero.gun.flag) { FLAGS_READ.add(P.game.hero.gun.flag); refs.push(['flag', P.game.hero.gun.flag, `${from.game}: game.hero.gun.flag`]); }
  for (const [i, f] of ((P.game && P.game.hero && P.game.hero.start && P.game.hero.start.flags) || []).entries()) refs.push(['set', f, `${from.game}: game.hero.start.flags[${i}]`]);
  if (P.game && P.game.chapter && P.game.chapter.doneFlag) refs.push(['flag', P.game.chapter.doneFlag, `${from.game}: game.chapter.doneFlag`]);   // (read by the chapters' record: engine/66-chapters.js)
  for (const [id, L] of Object.entries(P.events)) EFFECT_CALLS[id] = compileEffects(L);
  for (const [id, e] of Object.entries(P.enemies)) { const T = Object.assign({}, e); if (e.drops) T.drops = e.drops.map((d) => [d.item, d.chance]); if (e.behaviour) { out.behaviours[id] = e.behaviour; delete T.behaviour; } out.enemies[id] = T; }
  for (const [id, m] of Object.entries(P.music)) out.music[id] = { bpm: m.bpm, voices: Object.fromEntries(Object.entries(m.voices).map(([k, bars]) => [k, bars.join(' | ')])) };
  for (const [id, n] of Object.entries(P.npcs)) out.npcs[id] = compileNpc(n, where('npcs', id), errs, refs);
  for (const [id, q] of Object.entries(P.quests)) out.quests[id] = compileQuest(q, where('quests', id), errs, refs);
  for (const [id, a] of Object.entries(P.areas)) { const p = where('areas', id); out.areas[id] = compileArea(id, a, p, errs, refs); if (a.onEnter) { const L = compileCmds(a.onEnter, p + '.onEnter', errs, refs); out.hooks[id] = () => runCmds(L, {}); } }
  checkRefs(P, refs, errs);
  return out;
}

// every name the data points at must be in the data (the plugins add code, never records)
function checkRefs(P, refs, errs) {
  for (const [kind, id, path] of refs) {
    if (kind === 'key' || (kind === 'item' && id === 'coin')) continue;   // (language keys: the build checks them against lang/)
    if (kind === 'sfx') { if (typeof SFX !== 'undefined' && !SFX[id]) errs.push(`${path}: no sound "${id}"`); continue; }
    if (!REF_OF[kind]) continue;   // (a flag, a quest begun: the story's names, engine/63-events.js)
    const c = P[REF_OF[kind]];
    if (!(id in c)) errs.push(`${path}: no ${kind} "${id}"`);
  }
}

// what a list of commands would do now, for the marks (engine/64-marks.js): the flags it would set, the items it would
// drop, the quests it would start, along the branches its conditions take now (a choice: any of its answers; a keypad:
// the right code; a call: the event's own list, once). Deterministic: the data and the state, nothing else
const EFFECT_CALLS = {};   // event → its effects (filled as a chapter's events compile)
function compileEffects(list) {
  const fns = [], none = [];
  for (const c of Array.isArray(list) ? list : []) {
    if (!isRec(c)) continue;
    const kind = Object.keys(c)[0], v = c[kind];
    if (kind === 'flag') fns.push((o) => o.flags.add(v));
    else if (kind === 'drop' && v !== 'coin') fns.push((o) => o.items.add(v));
    else if (kind === 'quest') fns.push((o) => o.quests.add(v));
    else if (kind === 'if') { const k = compileCond(v, '', none, none), a = compileEffects(c.then), b = compileEffects(c.else); fns.push((o, sc) => (k(sc) ? a : b)(o, sc)); }
    else if (kind === 'say' && Array.isArray(c.choices)) { const ch = c.choices.map((x) => compileEffects(x[1])); fns.push((o, sc) => ch.forEach((g) => g(o, sc))); }
    else if (kind === 'keypad') fns.push(compileEffects(c.then));
    else if (kind === 'call') fns.push((o, sc) => { const g = EFFECT_CALLS[v]; if (g && !o.called.has(v)) { o.called.add(v); g(o, sc); } });
  }
  return (o, sc) => { for (const g of fns) g(o, sc || {}); return o; };
}
const effectsOf = (fx) => fx({ flags: new Set(), items: new Set(), quests: new Set(), called: new Set() });
// something new: a flag not yet set, a quest not yet begun, an item the cat does not have
const isNews = (e) => [...e.flags].some((f) => (FLAGS_READ.has(f) || f.startsWith('skill_')) && !G.flags[f]) || [...e.quests].some((q) => !G.quests[q]) || [...e.items].some((i) => !has(i));

// a person: talk() picks the first page whose condition holds, as things stand before the talk counts for a quest
// (interact() runs the quest event after talk()); its lines with their numbers as they are now; its commands once the
// dialogue is closed; its shop after that
function compileNpc(n, path, errs, refs) {
  const pages = n.pages.map((pg, i) => { const p = `${path}.pages[${i}]`; return { when: pg.if === undefined ? () => true : compileCond(pg.if, p + '.if', errs, refs), lines: compileLines(pg.lines, p + '.lines', errs, refs), then: pg.then && compileCmds(pg.then, p + '.then', errs, refs), shop: pg.shop, fx: compileEffects(pg.then) }; });
  if (!n.pages.length || n.pages[n.pages.length - 1].if !== undefined) errs.push(`${path}.pages: the last page must have no "if" (someone always answers)`);
  const N = { row: n.row, name: n.name, pic: n.pic }; if (n.voice !== undefined) N.voice = n.voice; if (n.sheet) N.sheet = n.sheet;
  // news: the page a talk would open now has something new to give (engine/64-marks.js); mark: false or a condition of its own
  N.news = () => { const pg = pages.find((q) => q.when({})); return !!pg && isNews(effectsOf(pg.fx)); };
  if (n.mark !== undefined) N.mark = n.mark === false ? false : compileCond(n.mark, path + '.mark', errs, refs);
  N.talk = () => { const pg = pages.find((q) => q.when({})), r = { lines: pg.lines({}) }; if (pg.then) r.after = () => runCmds(pg.then, {}); if (pg.shop) r.shop = pg.shop.slice(); return r; };
  return N;
}

// a quest step's event: { talk: person } { collect: item, n? } { defeat: enemy, n? } { reach: area } { flag: name }
// { check: condition }, as the tuple questEvent() reads: [event, what, count?]
const STEP_ON = { talk: 'npc', collect: 'item', defeat: 'enemy', reach: 'area', flag: null, check: null };
function compileQuest(q, path, errs, refs) {
  const Q = { name: q.name, steps: q.steps.map((s, i) => {
    const p = `${path}.steps[${i}]`, o = s.on, ev = isRec(o) && Object.keys(STEP_ON).find((k) => k in o), st = { text: s.text };
    if (!ev) { errs.push(`${p}.on: one of ${Object.keys(STEP_ON).join(', ')}`); st.on = ['none']; }
    else { unknownFields(o, [ev, 'n'], p + '.on', errs); if (STEP_ON[ev]) refs.push([STEP_ON[ev], o[ev], `${p}.on.${ev}`]); st.on = ev === 'check' ? ['check', compileCond(o.check, p + '.on.check', errs, refs)] : o.n !== undefined ? [ev, o[ev], o.n] : [ev, o[ev]];
      // (the items the step asks for, for the marks: what it collects, what its check asks the cat to have)
      if (ev === 'flag') { FLAGS_READ.add(o.flag); refs.push(['flag', o.flag, `${p}.on.flag`]); }
      const items = ev === 'collect' ? [o.collect] : ev === 'check' ? (JSON.stringify(o.check).match(/"has":"[^"]+"/g) || []).map((x) => x.slice(7, -1)) : [];
      if (items.length) st.items = items; }
    if (s.then) { const L = compileCmds(s.then, p + '.then', errs, refs); st.then = () => runCmds(L, {}); }
    return st;
  }) };
  if (q.main) Q.main = true; if (q.reward) Q.reward = q.reward;
  return Q;
}

// an area as openArea() and populate() take it: things [key, x, z, hx, hz, opts], people [id, x, z, face, when],
// spawns [type, x, z, when], critters [kind, x, z, n, r, when] (trailing blanks left off), colours as numbers, conditions and commands as functions
const trimTuple = (a) => { while (a.length && a[a.length - 1] === undefined) a.pop(); return a; };
const colourOf = (s) => parseInt(s.slice(1), 16);
function compileArea(id, a, path, errs, refs) {
  const D = { id };
  for (const f of ['name', 'cell', 'chunk', 'keep', 'tod', 'start', 'camNorth', 'step', 'map', 'lamps', 'solids', 'flicker', 'fish']) if (a[f] !== undefined) D[f] = a[f];
  if (a.halo !== undefined) D.halo = colourOf(a.halo);
  if (a.atmos !== undefined) D.atmos = a.atmos;   // (null: this area has none, whatever the chapter's)
  if (a.strata) D.strata = a.strata.map(colourOf);   // (the earth under the floor at the area's edges, in its own colours: a ship's hull)
  if (a.music !== undefined) { const m = compileValue(a.music, path + '.music', errs, refs, 'music'); D.music = typeof a.music === 'string' ? a.music : () => m({}); }
  D.legend = Object.fromEntries(Object.entries(a.legend).map(([ch, g]) => [ch, g.wall === undefined ? Object.assign({}, g) : Object.assign({}, g, { wall: colourOf(g.wall) })]));
  if (!a.map.length) errs.push(`${path}.map: no rows`);
  const w = a.map.length ? a.map[0].length : 0;
  a.map.forEach((row, r) => { for (const ch of new Set(row)) if (!(ch in a.legend)) errs.push(`${path}.map[${r}]: "${ch}" is not in the legend`); if (row.length !== w) errs.push(`${path}.map[${r}]: ${row.length} cells, the first row has ${w}`); });
  const seen = {};   // (each placement's id once in the area)
  for (const list of PLACE_LISTS) (a[list] || []).forEach((v, i) => { if (seen[v.id]) errs.push(`${path}.${list}[${i}]: id "${v.id}" is also ${seen[v.id]}`); else seen[v.id] = `${list}[${i}]`; });
  if (a.things) D.things = a.things.map((th, i) => compileThing(th, `${path}.things[${i}]`, errs, refs));
  if (a.npcs) D.npcs = a.npcs.map((n, i) => trimTuple([n.id, n.at[0], n.at[1], n.face, n.when === undefined ? undefined : compileCond(n.when, `${path}.npcs[${i}].when`, errs, refs)]));
  if (a.critters) D.critters = a.critters.map((c, i) => trimTuple([c.kind, c.at[0], c.at[1], c.n || 1, c.r || 2, c.when === undefined ? undefined : compileCond(c.when, `${path}.critters[${i}].when`, errs, refs)]));
  if (a.spawns) D.spawns = a.spawns.map((s, i) => trimTuple([s.type, s.at[0], s.at[1], s.when === undefined ? undefined : compileCond(s.when, `${path}.spawns[${i}].when`, errs, refs)]));
  if (a.exits) D.exits = a.exits.map((e, i) => { const o = Object.assign({}, e); delete o.id; if (e.when !== undefined) o.when = compileCond(e.when, `${path}.exits[${i}].when`, errs, refs); return o; });
  if (a.tips) D.tips = a.tips.map((tp, i) => { const f = compileValue(tp.text, `${path}.tips[${i}].text`, errs, refs, 'key'); return { rect: tp.rect, text: () => f({}) }; });
  return D;
}
// the atmosphere an area is drawn with: its own (null = none), else the chapter's; none when the player turned it off
function atmosOf(def, game, on) { return !on ? null : def && def.atmos !== undefined ? def.atmos : (game && game.atmos) || null; }
function compileThing(th, path, errs, refs) {
  const o = {};
  for (const [f, v] of Object.entries(th)) {
    if (f === 'id' || f === 'key' || f === 'at' || f === 'box') continue;
    if (f === 'when') o.when = compileCond(v, path + '.when', errs, refs);
    else if (f === 'shut') { const s = compileValue(v, path + '.shut', errs, refs, 'key'); o.shut = () => s({}); o.shutKey = JSON.stringify(v); }   // (what it says to the cat that walks up to it while it stands: engine/62-world.js tipsStep)
    else if (f === 'mark') o.mark = v === false ? false : compileCond(v, path + '.mark', errs, refs);
    else if (f === 'act') { const L = compileCmds(v.run, path + '.act.run', errs, refs); o.act = { label: v.label, name: v.name, run: () => runCmds(L, {}), fx: compileEffects(v.run) }; }
    else o[f] = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
  }
  // a thing written in hidden ink ("scan": a flag) is there only once the scanner has found it, and its own when holds
  if (th.scan) { const w = o.when, f = th.scan; o.when = () => !!G.flags[f] && (!w || w()); refs.push(['flag', f, path + '.scan']); }
  if (th.chest && th.chest.flag) refs.push(['set', th.chest.flag, path + '.chest.flag']);   // (set as the chest opens: engine/62-world.js)
  const box = th.box || [];
  return trimTuple([th.key, th.at[0], th.at[1], box[0], box[1], Object.keys(o).length ? o : undefined]);
}

// at boot (engine/90-boot.js): compiled and put into the engine's registries, after the plugins have registered; any
// problem stops the game with the list. A record a content script made too is a problem, not a quiet swap.
// again: the data loaded once more in place of what it put there before (the maker's play page after an edit,
// tools/maker.mjs); the records a content script made stay. Nothing is replaced when the data does not compile
const DATA_PUT = new Map();   // registry → the ids the data put in it
function loadGameData(data, again) {
  const errs = [], P = compileGameData(data, errs);
  if (!errs.length) {
    if (again) { for (const [reg, ids] of DATA_PUT) for (const id of ids) delete reg[id]; DATA_PUT.clear(); for (const k of Object.keys(GAME)) delete GAME[k]; }
    const put = (reg, recs, what) => { const ids = DATA_PUT.get(reg) || new Set(); DATA_PUT.set(reg, ids); for (const [id, r] of Object.entries(recs || {})) { if (id in reg) errs.push(`${what} "${id}" is defined twice: in the data and in a content script`); else { reg[id] = r; ids.add(id); } } };
    put(ITEMS, P.items, 'item'); put(ENEMIES, P.enemies, 'enemy'); put(SPEAKERS, P.speakers, 'speaker'); put(NPCS, P.npcs, 'person'); put(QUESTS, P.quests, 'quest'); put(MUSIC, P.music, 'track');
    put(EVENTS, P.events, 'event'); put(AREAS, P.areas, 'area'); put(AREA_HOOKS, P.hooks, 'area hook'); put(CURATE, P.curate, 'curation');
    for (const [id, b] of Object.entries(P.behaviours)) { if (BEHAVIOURS[b]) Object.assign(ENEMIES[id], BEHAVIOURS[b]); else errs.push(`enemies.${id}: no behaviour "${b}" (a plugin in content/plugins/ registers it)`); }
    if (P.game) { Object.assign(GAME, P.game); if (GAME.intro) CHAPTER.intro = (done) => runCmds(EVENTS[GAME.intro], {}, done); if (GAME.onPlay) CHAPTER.mend = () => runCmds(EVENTS[GAME.onPlay], {}); }
    // the names checked again against everything loaded (content scripts included), now the plugins have run
    const live = { item: ITEMS, enemy: ENEMIES, area: AREAS, npc: NPCS, speaker: SPEAKERS, quest: QUESTS, event: EVENTS, music: MUSIC };
    for (const [kind, id, path] of P.refs) if (live[kind] && !(id in live[kind]) && !(kind === 'item' && id === 'coin')) errs.push(`${path}: no ${kind} "${id}"`);
  }
  if (errs.length) throw new Error(`The game's data has ${errs.length} problem(s):\n` + errs.slice(0, 12).join('\n'));
}

// ---- engine/66-chapters.js
/* ---------- chapters: the shared record (finished chapters, the last played) and which chapter a page plays ---------- */
// The record is small and apart from the saves (each chapter's own slot, engine/54-game.js) and the settings
// (engine/00-core.js): { v: 1, done: [chapter ids], last: chapter id | null }. Read defensively, written whole; storage
// that throws (private mode) leaves it empty and the game playing
const PROGRESS_KEY = 'mdv-rpg-cat-progress';
function readProgress() {
  let p = null; try { p = JSON.parse(localStorage.getItem(PROGRESS_KEY)); } catch (e) { /* unreadable or blocked: empty */ }
  const ok = p && typeof p === 'object' && p.v === 1;
  return { v: 1, done: ok && Array.isArray(p.done) ? p.done.filter((d) => typeof d === 'string') : [], last: ok && typeof p.last === 'string' ? p.last : null };
}
function writeProgress(p) { try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); return true; } catch (e) { return false; } }
function markPlayed() { const p = readProgress(); p.last = CHAPTER_ID; writeProgress(p); }
function markDone() { const p = readProgress(); if (!p.done.includes(CHAPTER_ID)) p.done.push(CHAPTER_ID); p.last = CHAPTER_ID; writeProgress(p); }
// finished: in the record, or (saves from before the record) the chapter's own slot holds its done flag (game.json
// "chapter.doneFlag"); read raw, as another chapter's slot cannot be checked against areas this page has not loaded
// a game saved in that chapter's own slot (read raw: another chapter's areas are not loaded on this page; the chapters
// screen offers Continue on it, so going to another chapter never starts this one afresh by surprise)
function chapterSaved(id) { const k = chapterOf(GAME_DATA, id).save; try { return !!k && localStorage.getItem(k) !== null; } catch (e) { return false; } }
function chapterDone(id) {
  if (readProgress().done.includes(id)) return true;
  const c = chapterOf(GAME_DATA, id); if (!c.doneFlag || !c.save) return false;
  try { const s = JSON.parse(localStorage.getItem(c.save)); return !!(s && s.flags && s.flags[c.doneFlag]); } catch (e) { return false; }
}

// which chapter a page plays. One a page load: a chapter's data fills the engine's registries once, and switching is a
// reload, so nothing of the last chapter (records, actors, caches, timers) stays behind. The title's choice travels in
// the address's hash, #next=<json> (read once and cleared; it needs no storage, so it works in private mode), else the
// last chapter played, else the first; never one this page cannot draw (game.json "chapter.styles": Chapter 2 is
// low-poly only) or one marked hidden unless asked for (the skeleton, until it is a chapter)
let SHOW_HIDDEN = false;
const chapterOn = (id, style) => chapterIds(GAME_DATA).includes(id) && (chapterOf(GAME_DATA, id).styles || []).includes(style);
const visibleChapters = (style) => chapterIds(GAME_DATA).filter((id) => chapterOn(id, style) && (SHOW_HIDDEN || !chapterOf(GAME_DATA, id).hidden));
function pickChapter(next, style) {
  const ids = chapterIds(GAME_DATA).filter((id) => chapterOn(id, style)), last = readProgress().last;
  // (a hidden chapter opens when asked for, a link or its save code, never again as the last played: every later visit
  // would land in it, with New game starting it again and no card leading out)
  const want = next ? next.chapter : last && (SHOW_HIDDEN || !chapterOf(GAME_DATA, last).hidden) ? last : null;
  return ids.includes(want) ? want : ids[0];
}
// New game asks first when it would overwrite a game saved in that chapter (this page's slot checked whole: an
// unreadable one has nothing to lose; another chapter's read raw)
function newGameNeedsConfirm(id) { return id === CHAPTER_ID ? saveState() === 'ok' : chapterSaved(id); }
// The title's own choice rides on both the window's name and the hash, as no one of them survives a reload everywhere:
// a page shown inside a viewer (an iframe's srcdoc, a blob: address) loses the hash, a file opened from a phone's
// downloads may lose the name. Taken once from whichever arrives (the name first), both cleared; a #next= link works too
const NEXT_NAME = 'mdv-rpg-cat-next:';
function takeNext(loc, hist, win) {
  const name = win && typeof win.name === 'string' && win.name.startsWith(NEXT_NAME) ? win.name.slice(NEXT_NAME.length) : null;
  if (name !== null) win.name = '';
  const m = /^#next=(.+)$/.exec(loc.hash || '');
  if (m) try { hist.replaceState(null, '', loc.pathname + loc.search); } catch (e) { loc.hash = ''; }
  if (name === null && !m) return null;
  try { const n = JSON.parse(name !== null ? name : decodeURIComponent(m[1])); return n && typeof n === 'object' && typeof n.chapter === 'string' ? n : null; } catch (e) { return null; }
}
// then: 'new' | 'continue' | 'code' (with the code's text): what the next page load does once that chapter is loaded
function goChapter(chapter, then, code) {
  const n = JSON.stringify(code ? { chapter, then, code } : { chapter, then });
  window.name = NEXT_NAME + n;
  try { history.replaceState(null, '', '#next=' + encodeURIComponent(n)); } catch (e) { /* a viewer that keeps no history: the name carries it */ }
  location.reload();
}
// what the last page load handed over (goChapter), run once this chapter is loaded and the frame loop runs; a failure
// there leaves the title on screen (a throw inside the boot used to stop it before the frame loop and the hooks)
function handOver(next) {
  if (!next || next.chapter !== CHAPTER_ID) return;
  try { if (next.then === 'new') startGame(); else if (next.then === 'continue') continueGame(); else if (next.then === 'code') applyCode(next.code || ''); }
  catch (e) { console.error(e); toTitle(); }
}

// ---- engine/70-ui.js
/* ---------- ui: dialogue with portraits, hint, toast, HUD, fade (HTML over the canvas) ---------- */
let dlg = null, nearAct = null;
const ui = { screen: 'title' };   // title | game | menu | menu-title | shop | over

/* portraits: drawn from the portraits sheet into a small canvas */
// a chapter may draw its portraits and icons from several sheets (game.json "sheets": a name or a list): a picture
// comes from the first sheet that has it
const sheetOf = (sheets, name) => { const L = [].concat(sheets); return L.find((s) => SHEETS[s] && SHEETS[s].meta.sprites[name]) || L[0]; };
function drawPic(el, sheet, name) {
  const SH = SHEETS[sheetOf(sheet, name)], r = SH && name && SH.meta.sprites[name]; el.hidden = !r; if (!r) return;
  el.width = r.w; el.height = r.h; const x = el.getContext('2d'); x.imageSmoothingEnabled = false; x.clearRect(0, 0, r.w, r.h); x.drawImage(SH.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  // a whole number of screen pixels for each of its pixels, as near 72 CSS px wide as that allows (93 px shown at 72
  // were 2.3 screen pixels each on a phone: some lines doubled, some dropped, and the cat's smile read as a frown)
  const dpr = window.devicePixelRatio || 1, k = Math.max(1, Math.round(72 * dpr / r.w)); el.style.width = (r.w * k / dpr) + 'px';
}

/* dialogue: a line is a language key, or [speaker, key, vars?]; text scrolls with a blip, a press shows the rest, the next goes on */
// a line's moving words (engine/00-core.js tFx): the plain text, and [from, to, kind] for each tagged run
function parseFx(s) {
  const fx = []; let text = '', open = null;
  for (const part of s.split(/(\[\/?(?:shake|wave|quake|key)\])/)) {
    const m = /^\[(\/?)(shake|wave|quake|key)\]$/.exec(part);
    if (!m) { text += part; continue; }
    if (!m[1]) open = [text.length, m[2]]; else if (open && open[1] === m[2]) { fx.push([open[0], text.length, m[2]]); open = null; }
  }
  return { text, fx };
}
// the first n characters of a line into the box: the tagged runs letter by letter, each word kept whole on its line
function writeFx(el, L, n) {
  if (!L.fx || !L.fx.length) { el.textContent = L.text.slice(0, n); return; }
  el.textContent = ''; let at = 0;
  for (const [a, b, kind] of L.fx) {
    if (a >= n) break;
    if (a > at) el.append(L.text.slice(at, a));
    const end = Math.min(b, n);
    for (const word of L.text.slice(a, end).split(/( )/)) {
      if (word === ' ' || !word) { el.append(word); continue; }
      const w = document.createElement('span'); w.className = 'fxw';
      for (const ch of word) { const c = document.createElement('span'); c.className = 'fx fx-' + kind; c.style.setProperty('--i', at++); c.textContent = ch; w.append(c); }
      el.append(w);
    }
    at = end;
  }
  if (at < n) el.append(L.text.slice(at, n));
}
// a [quake] run shakes the view once, as its first letter is written (with screen shake on: the option holds it too)
function quakeAt(L, n) {
  if (!L.fx) return;
  for (const f of L.fx) if (f[2] === 'quake' && !f.done && n > f[0]) { f.done = true; shake(.45); sfx('slam'); }
}
// a speaker that moves as its line is said (its "emote" in the data): the cat when the speaker is the cat, else the person
// on screen whose id the speaker's starts with (a "baker_happy" speaks for the baker). surprise: a hop and a "!"; joy:
// two small hops; worry: it sinks a little, "..." over it. Turned by emoteStep, in or out of a dialogue
function emote(who) {
  const sp = SPEAKERS[who]; if (!sp || !sp.emote || !A) return;
  const n = sp.name === 'who.cat' ? null : npcs.find((p) => who === p.id || who.startsWith(p.id + '_')), a = n ? n.a : sp.name === 'who.cat' ? player : null;
  if (!a) return;
  a.emote = { kind: sp.emote, t: 0 };
  const y = A.groundY(a.x, a.z) + 2.3;
  if (sp.emote === 'surprise') floatText('!', a.x, y, a.z, 'mark'); else if (sp.emote === 'worry') floatText('...', a.x, y, a.z);
}
const EMOTE = {
  surprise: [.35, (t) => Math.sin(t / .35 * Math.PI) * .45],
  joy: [.5, (t) => Math.abs(Math.sin(t / .25 * Math.PI)) * .22],
  worry: [.6, (t) => -Math.sin(t / .6 * Math.PI) * .12],
};
function emoteStep(dt) {
  for (const a of [player, ...npcs.map((n) => n.a)]) {
    if (!a || !a.emote) continue;
    const [len, f] = EMOTE[a.emote.kind]; a.emote.t += dt;
    if (a.emote.t >= len) { a.lift = 0; a.emote = null; } else a.lift = f(a.emote.t);
  }
}
function showPage() {
  if (dlg.pad) return;   // (the keypad draws itself)
  const L = dlg.lines[dlg.i], page = L.text, n = Math.min(page.length, Math.floor(dlg.n));
  if (dlg.shown !== dlg.i) {
    dlg.shown = dlg.i; const sp = L.who ? SPEAKERS[L.who] || {} : {}; if (L.who) emote(L.who);
    $('dWho').textContent = t(sp.name || dlg.name); drawPic($('dPic'), GAME.sheets.portraits, L.who ? sp.pic : dlg.pic);
  }
  writeFx($('dText'), L, n); quakeAt(L, n); $('dMore').hidden = n < page.length || (dlg.choices && dlg.i === dlg.lines.length - 1);
  // choices: buttons under the last page, once its text is all out
  const box = $('dChoices'), want = dlg.choices && dlg.i === dlg.lines.length - 1 && n >= page.length;
  if (want && !box.childElementCount) {
    for (const [key, then] of dlg.choices) { const b = document.createElement('button'); b.type = 'button'; b.textContent = t(key); b.onclick = (e) => { e.stopPropagation(); sfx('ok'); box.textContent = ''; dlg = null; $('dialog').hidden = true; then(); }; box.append(b); }
    box.hidden = false; box.firstChild.focus({ preventScroll: true });
  } else if (!want && box.childElementCount) { box.textContent = ''; box.hidden = true; }
}
function openDialogue(a) {
  const raw = (typeof a.lines === 'function' ? a.lines() : a.lines);
  const lines = raw.map((l) => Array.isArray(l) ? Object.assign({ who: l[0] }, parseFx(tFx(l[1], l[2]))) : a.raw ? { text: l } : parseFx(tFx(l)));
  dropFoeShots();   // (a round in the air when the talk began would land as it ends)
  dlg = { lines, i: 0, n: reduceMotion ? 1e9 : 0, voice: a.voice || 330, last: 0, name: a.name, pic: a.pic, after: a.after, shown: -1, choices: a.choices };
  $('dChoices').textContent = ''; $('dChoices').hidden = true; $('dialog').hidden = false; showPage(); if (player) player.moving = false;
}
function advance() {
  if (!dlg) { if (nearAct) interact(nearAct); return; }
  if (dlg.pad) return;   // the keypad takes its digits, not a press
  if (dlg.card) { closeCard(); return; }
  const page = dlg.lines[dlg.i].text;
  if (dlg.n < page.length) dlg.n = page.length;
  else if (dlg.choices && dlg.i === dlg.lines.length - 1) return;   // a choice must be picked
  else if (++dlg.i < dlg.lines.length) dlg.n = reduceMotion ? 1e9 : 0;
  else { const after = dlg.after; dlg = null; $('dialog').hidden = true; if (after) after(); return; }
  showPage();
}
function tickDialogue(dt) {
  if (!dlg || dlg.pad || dlg.card) return; const page = dlg.lines[dlg.i].text;
  if (dlg.n < page.length) { dlg.n += dt * 42; const n = Math.floor(dlg.n); if (n !== dlg.last) { dlg.last = n; if (n % 2 === 0 && page[n - 1] !== ' ') blip(dlg.voice); showPage(); } }
}

/* an item the story gives (a chest's, a quest's reward): a card where the dialogue box stands, its picture, its name in
   gold and what it does; a dialogue of its own kind (the game held, the view brought in), the cat glowing gold while it
   shows. One given while a dialogue is open waits for it to close (a reward comes as the talk that earns it begins) */
const cards = [];
function itemCard(id, n, after) {
  if (dlg) { cards.push([id, n, after]); return; }
  dropFoeShots();
  dlg = { card: id, after }; $('dialog').hidden = true;
  drawPic($('icPic'), GAME.sheets.items, id);
  $('icName').textContent = t('item.' + id) + (n > 1 ? ' ×' + n : '');
  $('icDesc').textContent = t('desc.' + id);
  $('itemCard').hidden = false; sfx('item'); if (player) { player.moving = false; player.glow = 1; }
}
function closeCard() { const after = dlg.after; dlg = null; $('itemCard').hidden = true; if (player) player.glow = 0; sfx('ok'); if (after) after(); }
// (each frame: a waiting card shows once nothing else is open)
function cardsStep() { if (!dlg && cards.length && ui.screen === 'game') itemCard(...cards.shift()); }

/* the keypad: the dialogue box with the digits typed so far and a pad of buttons (keys 0-9, Backspace and Esc too); the
   data's then / else make the sound of the outcome */
function openKeypad(o) {
  let typed = '';
  const line = { text: '' }, show = () => { line.text = Array.from({ length: o.len }, (_, i) => typed[i] || '_').join(' '); $('dText').textContent = line.text; };
  const close = () => { dlg = null; $('dialog').hidden = true; const box = $('dChoices'); box.textContent = ''; box.hidden = true; box.classList.remove('keypad'); };
  const press = (k) => {
    if (k === 'x') { close(); sfx('no'); o.cancel(); return; }
    if (k === '<') typed = typed.slice(0, -1); else if (typed.length < o.len) typed += k;
    sfx('blip'); show();
    if (typed.length === o.len) { const code = typed; close(); o.done(code); }
  };
  dropFoeShots(); dlg = { lines: [line], i: 0, n: 1e9, voice: 330, last: 0, name: o.name, shown: 0, pad: press };
  $('dialog').hidden = false; $('dWho').textContent = t(o.name || 'act.keypad'); $('dPic').hidden = true; $('dMore').hidden = true; show();
  const box = $('dChoices'); box.textContent = ''; box.classList.add('keypad'); box.hidden = false;
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'x', '0', '<']) { const b = document.createElement('button'); b.type = 'button'; b.textContent = k === 'x' ? '✕' : k === '<' ? '⌫' : k; b.onclick = (e) => { e.stopPropagation(); press(k); }; box.append(b); }
  box.firstChild.focus({ preventScroll: true }); if (player) player.moving = false;
}

let hintState = null;
function setHint(a) {
  const scan = coarse || !G ? '' : gunOn() ? '.gun' : G.flags.skill_scan ? '.scan' : '', key = (a ? 'z:' + a.label : 'base' + scan) + (gunOn() ? ':gun' : '');   // (the scanner's key is named once the cat has it; a gun's keys in its chapter)
  if (key === hintState) return; hintState = key;
  $('hint').textContent = a ? t(coarse ? 'hint.act.touch' : 'hint.act', { what: t(a.label) }) : t((coarse ? 'hint.touch' : 'hint.keys' + scan) + (settings.flat ? '.flat' : ''));   // the 2D style does not turn
  $('bAtk').textContent = t(a ? 'btn.talk' : gunOn() ? 'btn.shoot' : 'btn.atk');
}

let toastT = 0;
// a line at the top, under the HUD (never over the health and ink it shows: two lines of it covered both), long enough
// to read: 15 characters a second
function toast(text) {
  const el = $('toast'), top = document.querySelector('.top'), r = top && top.getBoundingClientRect();
  el.textContent = text; el.hidden = false; toastT = Math.max(2.6, text.length / 15);
  el.style.top = r && r.height ? Math.round(r.bottom * pageS - 4) + 'px' : '';   // (inside the stage: engine/30-render.js fitStage)
}
function toastTick(dt) { if (toastT > 0 && (toastT -= dt) <= 0) $('toast').hidden = true; }

/* HUD: health, ink, level, coins; the DOM is touched only when a number changes */
let hudKey = '';
function hudDraw() {
  if (!G) return; const s = stats(), ink = Math.floor(G.ink), key = [G.hp, s.hp, ink, s.ink, G.level, G.coins, G.flags.skill_dash, G.flags.skill_well, G.flags.skill_scan, G.flags.skill_fan, gunOn(), settings.lang, hero.gun ? hero.gun.mag + ':' + (hero.gun.reload > 0) + ':' + gunCfg().mag : ''].join();
  if (key === hudKey) return; hudKey = key;
  $('hpBar').style.width = (100 * G.hp / s.hp).toFixed(1) + '%'; $('inkBar').style.width = (100 * ink / s.ink).toFixed(1) + '%';
  $('hpNum').textContent = G.hp + '/' + s.hp; $('inkNum').textContent = ink + '/' + s.ink;
  $('hLv').textContent = t('hud.lv', { n: G.level }); $('hCoins').textContent = t('hud.coins', { n: G.coins });
  $('bDash').hidden = !G.flags.skill_dash; $('bWell').hidden = !(G.flags.skill_well || G.flags.skill_fan); $('bScan').hidden = !G.flags.skill_scan;
  // a chapter with a gun: the quill on its own button, the cylinder's rounds, Fan in the second skill's place; the gauge's own name
  const gun = gunOn(); $('bQuill').hidden = !gun; $('hAmmo').hidden = !gun;
  if (gun) { const st = hero.gun || { mag: 0, reload: 0 }, m = gunCfg().mag; $('hAmmo').textContent = st.reload > 0 ? '· · ·' : '●'.repeat(st.mag) + '○'.repeat(Math.max(0, m - st.mag)); }
  if (G.flags.skill_fan) $('bWell').textContent = t('btn.fan');
  if (GAME.inkName) document.querySelector('#hud [data-t="hud.ink"]').textContent = t(GAME.inkName);
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
  for (const s of ['title', 'chapters', 'menu', 'shop', 'over', 'codeBox', 'end']) $(s).hidden = s !== id;
  const first = id && $(id).querySelector('button:not([hidden]):not([disabled]), textarea');
  if (first) first.focus({ preventScroll: true }); else canvas.focus({ preventScroll: true });
}
const iconCanvas = (id) => { const c = document.createElement('canvas'); c.className = 'icon'; drawPic(c, GAME.sheets.items, id); return c; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const btn = (text, on, cls) => { const b = el('button', cls, text); b.type = 'button'; b.onclick = () => { sfx('ok'); on(); }; return b; };

/* pause menu */
function openMenu(on, onlyOptions) {
  if (!on) { showScreen(null); ui.screen = ui.screen === 'menu-title' ? 'title' : 'game'; if (ui.screen === 'title') showScreen('title'); return; }
  ui.screen = onlyOptions ? 'menu-title' : 'menu'; menuTab = onlyOptions ? 'options' : menuTab === 'map' && !GAME.map ? 'items' : menuTab;
  document.querySelectorAll('#tabs button').forEach((b) => { b.hidden = (onlyOptions && b.dataset.tab !== 'options') || (b.dataset.tab === 'map' && !GAME.map); });   // (a chapter without a map has no Map tab)
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
  const bonusOf = (o) => BONUS_STATS.filter((k) => o[k]).map((k) => t('stat.' + k) + ' +' + o[k]).join(' · ');
  const bonus = bonusOf(it); if (bonus) info.append(el('p', 'dim', bonus));
  // to wear: against the one worn in its slot, and what changes (better in green, worse in red)
  const c = equipDiff(id);
  if (c) {
    info.append(el('p', 'dim', c.worn ? t('menu.worn', { item: t('item.' + c.worn), bonus: bonusOf(ITEMS[c.worn] || {}) || t('menu.nobonus') }) : t('menu.wornNone')));
    const p = el('p', 'cmp', t('menu.change') + ' ');
    if (!c.diff.length) p.append(el('span', 'dim', t('menu.nochange')));
    c.diff.forEach(([k, d], i) => p.append(i ? ' · ' : '', el('span', d > 0 ? 'up' : 'down', t('stat.' + k) + ' ' + (d > 0 ? '+' : '−') + Math.abs(d))));
    info.append(p);
  }
  const row = el('div', 'row');
  if (it.use) row.append(btn(t('menu.use'), () => { if (!useItem(id)) { sfx('no'); toast(t('toast.full')); } renderTab(); }));
  if (it.slot) row.append(btn(t('menu.equip'), () => { equip(id); renderTab(); }));
  info.append(row);
}
function renderEquip(box) {
  box.textContent = ''; const s = stats();
  box.append(el('p', 'line', t('menu.stats', { lv: G.level, hp: s.hp, ink: s.ink, atk: s.atk, def: s.def })), el('p', 'dim', G.level >= maxLevel() ? t('menu.maxlv') : t('menu.xp', { xp: G.xp, next: xpToNext() })));
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
  box.textContent = ''; const def = AREAS[GAME.map.area], rows = def.map.length, cols = def.map[0].length, k = 5;
  const c = document.createElement('canvas'); c.width = cols * k; c.height = rows * k; c.className = 'map'; const x = c.getContext('2d');
  const col = {}; for (const [ch, g] of Object.entries(def.legend)) { const T = TILES[g.tile], p = T.px; let r = 0, gg = 0, b = 0; for (let o = 0; o < p.length; o += 4) { r += p[o]; gg += p[o + 1]; b += p[o + 2]; } const n = p.length / 4; col[ch] = `rgb(${r / n * (g.h > 20 ? .6 : 1) | 0},${gg / n * (g.h > 20 ? .6 : 1) | 0},${b / n * (g.h > 20 ? .6 : 1) | 0})`; }
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) { x.fillStyle = col[def.map[r][q]]; x.fillRect(q * k, r * k, k, k); }
  x.fillStyle = '#2a2030'; for (const [key, tx, tz] of def.things || []) if (GAME.map.marks.includes(key)) x.fillRect(tx / 2 * k - 6, tz / 2 * k - 6, 12, 8);
  const inside = A && A.def.id !== GAME.map.area;
  const door = inside && (def.things || []).find((th) => th[5] && th[5].door && th[5].door.to === A.def.id), [px, pz] = inside ? (door ? [door[1], door[2]] : [-99, -99]) : [player.x, player.z];
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
  seg('optWire', () => settings.wire ? 'on' : 'off', (v) => { settings.wire = v === 'on'; applyWire(); });
  seg('optShadows', () => settings.shadows ? 'on' : 'off', (v) => { settings.shadows = v === 'on'; sun.castShadow = settings.shadows; shadowHold = 3; });
  seg('optShowFps', () => settings.showFps ? 'on' : 'off', (v) => { settings.showFps = v === 'on'; $('hFps').hidden = !settings.showFps; });
  seg('optShake', () => settings.shake ? 'on' : 'off', (v) => { settings.shake = v === 'on'; });
  seg('optAtmos', () => settings.atmos === false ? 'off' : 'on', (v) => { settings.atmos = v === 'on'; });
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
/* the chapters (New game with two or more on this page): a card each; this page's chapter starts here, another by a
   page load (engine/66-chapters.js goChapter) */
// a press that would overwrite a saved game asks again first: the button reads the warning, a second press goes on
function confirmNew(btn, need, go) {
  if (!need || btn.dataset.armed) { delete btn.dataset.armed; go(); return; }
  btn.dataset.armed = '1'; btn.textContent = t('confirm.new'); sfx('no');
}
function openChapters() { renderChapters(); ui.screen = 'chapters'; showScreen('chapters'); }
function renderChapters() {
  const box = $('chList'); box.textContent = '';
  for (const id of visibleChapters(STYLE)) {
    const c = chapterOf(GAME_DATA, id), b = el('div', 'chcard'), here = id === CHAPTER_ID;
    if (c.card) { const pic = document.createElement('canvas'); drawPic(pic, c.card[0], c.card[1]); b.append(pic); }
    // a chapter with a game saved offers Continue beside New game (this page's slot checked whole, another's read raw)
    const saved = here ? saveState() === 'ok' : chapterSaved(id), note = [t('chapters.minutes', { n: c.minutes })];
    if (chapterDone(id)) note.push(t('chapters.done')); if (saved) note.push(t('chapters.saved'));
    b.append(el('span', 'line', t(c.title)), el('span', 'dim', t(c.blurb)), el('span', 'dim', note.join(' · ')));
    const row = el('div', 'row'), act = (key, then, fn) => { const k = el('button', 'small', t(key)); k.type = 'button'; k.dataset.act = then; const go = () => { sfx('ok'); if (here) fn(); else goChapter(id, then); }; k.onclick = then === 'new' ? () => confirmNew(k, newGameNeedsConfirm(id), go) : go; row.append(k); };
    if (saved) act('menu.continue', 'continue', continueGame);
    act('menu.new', 'new', startGame);
    b.append(row); box.append(b);
  }
}
function submitCode() { applyCode($('codeIn').value); }
// a code from the box, or handed over by a page load (engine/90-boot.js): this chapter's starts play; another chapter's
// is refused here until the switch exists (Task 4 of the chapter plan)
function applyCode(text) {
  const r = readCode(text);
  if (r.error) { $('codeErr').textContent = t(r.error, { ch: r.ch }); sfx('no'); return; }
  // another chapter's code: its chapter is loaded by a page load and the code read again there (refused if this page
  // cannot draw that chapter: Chapter 2 on diorama.html)
  if (!r.save) { if (chapterOn(r.chapter, STYLE)) goChapter(r.chapter, 'code', text); else { $('codeErr').textContent = t('code.chapter'); sfx('no'); } return; }
  G = r.save; beginPlay(); saveGame();   // saved once the cat stands where the code says (the save takes its place from the scene)
}

// ---- engine/80-loop.js
/* ---------- loop: simulation at a fixed 120 Hz, drawing capped at the chosen 30 / 60 / 120 fps ---------- */
const SIM = 1 / 120;
const IDLE_FPS = 10;   // outside play (title, menu, shop...) the picture behind the screen's veil is drawn this often
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
  // the figures and effects the area starts with sent up now, every shader the scene holds compiled (the x-ray's, hidden
  // until the cat first stands behind something), while the screen is still dark
  const cg = new Set([...A.chunks.values()].map((c) => c.group)); warmUp(scene.children.filter((o) => !cg.has(o) && !o.isLight)); if (renderer) { renderer.compile(scene, cam); for (const s of ['fx-1', ...[].concat(GAME.sheets.items || [])]) if (SHEETS[s]) renderer.initTexture(flatMat(s).map); }   // (and the effects' and pickups' sheets: a fight's first spark sent one up)
}
// a save from an older layout (or any arrival) may put the cat inside something that moved there since: step out to
// the nearest free spot, searched in rings of a quarter unit out to 8 units; failing that, the area's start. Free means
// level under all four feet (a cat saved astride a step's edge, half against the cliff behind, passed the old test and
// stayed stuck after every load), the water it swims in counted as free
const standable = (x, z) => !A.blocked(x, z, x, z, 'swim');
function unstick(def) {
  if (standable(player.x, player.z)) return;
  const y0 = A.groundY(player.x, player.z);
  for (let r = .25; r <= 8; r += .25) for (let k = 0, n = Math.ceil(r * 8); k < n; k++) {
    const a = k / n * Math.PI * 2, x = player.x + Math.cos(a) * r, z = player.z + Math.sin(a) * r;
    const inExit = A.exits.some(({ rect: [x0, z0, x1, z1] }) => x >= x0 - .4 && x <= x1 + .4 && z >= z0 - .4 && z <= z1 + .4);
    if (standable(x, z) && !inExit && Math.abs(A.groundY(x, z) - y0) < .25) { player.x = x; player.z = z; return; }   // same level, not in a doorway
  }
  player.x = def.start[0]; player.z = def.start[1];
}
async function goTo(exit) {
  transitioning = true; player.moving = false; sfx('door');
  await fade(1); enterArea(exit.to, exit.at, exit.face); saveGame(); await fade(0);
  transitioning = false;
}
// build the current area again (a gate opened, { "reopen": true }): a short fade, the cat stays where it is
async function reopen() {
  const keep = pickups.map((p) => [p.id, p.x, p.z, p.n]);   // what lies on the floor stays (a dropped piece of the story is never lost)
  // (each one dropped again unless the area's entry has put it back already: a story item on the floor comes back on entry)
  transitioning = true; await fade(1); enterArea(A.def.id, [player.x, player.z]); for (const [id, x, z, n] of keep) if (!pickups.some((p) => p.id === id && Math.hypot(p.x - x, p.z - z) < 1)) drop(id, x, z, n); saveGame(); await fade(0); transitioning = false;
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
      else if (ui.screen === 'chapters') { ui.screen = 'title'; showScreen('title'); }
      continue;
    }
    if (ui.screen !== 'game' || transitioning) continue;
    if (dlg && dlg.pad) {   // the keypad from a gamepad: the shoulder buttons move along it, A presses, B closes it
      const bs = [...$('dChoices').children], i = bs.indexOf(document.activeElement);
      if (act === 'dodge') dlg.pad('x');
      else if (act === 'attack' || act === 'interact') { if (i >= 0) bs[i].click(); }
      else if (act === 'rotateL' || act === 'rotateR') bs[(Math.max(0, i) + (act === 'rotateR' ? 1 : bs.length - 1)) % bs.length].focus({ preventScroll: true });
      continue;
    }
    if (act === 'interact') { if (dlg || nearAct) advance(); }
    else if (act === 'attack') { if (dlg) advance(); else if (nearAct && !nearestEnemy(4)) advance(); else if (!gunOn()) heroAttack(); }   // (with a gun the button fires while held: heroStep)
    else if (act === 'quill') { if (!dlg && gunOn()) heroAttack(); }   // (its own key only beside a gun: Chapters 1 and 2 have none)
    else if (act === 'dodge') { if (!dlg) heroDodge(); }
    else if (act === 'skill1') { if (!dlg) heroDodge('dash'); }
    else if (act === 'skill2') { if (!dlg) heroDodge(gunOn() ? 'fan' : 'well'); }
    else if (act === 'skill3') { if (!dlg) heroDodge('scan'); }
    else if (act === 'rotateL') rotate(-1); else if (act === 'rotateR') rotate(1);
  }
  if (ui.screen !== 'game' || transitioning || !A) { if (player) player.moving = false; return; }
  if (hitstopT > 0) { hitstopT = Math.max(0, hitstopT - dt); return; }   // a hit's moment held (hitFx): nothing moves, the picture is drawn
  emoteStep(dt); ambientStep(dt);
  if (!dlg) { heroStep(dt); boredStep(dt); enemiesStep(dt); shotsStep(dt); hazardsStep(dt); pickupsStep(dt); npcsStep(dt); crittersStep(dt); fishStep(dt); tipsStep(); } else { player.moving = false; hero.holdOff = true; }
  if (!hero.dead && !dlg) for (const ex of A.exits) { if (ex.when && !ex.when()) continue; const [x0, z0, x1, z1] = ex.rect; if (player.x >= x0 && player.x <= x1 && player.z >= z0 && player.z <= z1) {
    if (ex.need && !has(ex.need)) { player.z += z1 - player.z + .25; sfx('no'); toast(t('toast.door', { item: t('item.' + ex.need) })); break; }   // a locked door pushes the cat back
    goTo(ex); break;
  } }
  nearAct = null; let best = 1e9;
  if (!hero.dead) for (const a of A.acts) { if (a.when && !a.when()) continue; const d = Math.hypot(a.x - player.x, a.z - player.z); if (d < a.r && d < best) { best = d; nearAct = a; } }
  tickDialogue(dt); cardsStep();
}

function draw(dt) {
  time += dt; drawCount++;
  if (!A) { renderer.setRenderTarget(null); renderer.setClearColor(0x17121c, 1); renderer.clear(); return; }
  setHint(dlg ? null : nearAct);
  if (intro < 1) { intro = Math.min(1, intro + dt / 2.8); const e = 1 - Math.pow(1 - intro, 3); yaw = yawT + (settings.flat ? 0 : (1 - e) * -1.05); Vz = lerp(28, VT, e); }
  else { yaw += (yawT - yaw) * (1 - Math.exp(-dt * 9)); Vz += (VT - Vz) * (1 - Math.exp(-dt * 8)); }
  // (a dialogue: the camera aims for the closer view at once, so a cat by a room's wall stays in it: setCamera)
  if (dlg) { const d = $(dlg.card ? 'itemCard' : 'dialog').getBoundingClientRect(), c = canvas.getBoundingClientRect(); viewCover = d.height && c.height ? clamp((c.bottom - d.top) / c.height, 0, .8) : 0; } else viewCover = 0;
  kick = Math.max(0, kick - dt * .5); talkZ = reduceMotion ? (dlg ? 1 : 0) : clamp(talkZ + (dlg && ui.screen === 'game' ? dt : -dt) / TALK_ZOOM, 0, 1); dimNow = dimStep(dimNow, dimTo, dt); const vv = Math.max(Vz, minV()) * (LP ? 1 : 1 - kick), [tx, tz] = camGoal(talkZ > 0 ? talkView(vv) : vv), kf = 1 - Math.exp(-dt * 5);
  camT.x += (tx - camT.x) * kf; camT.z += (tz - camT.z) * kf; camT.y += (A.groundY(player.x, player.z) * .5 - camT.y) * kf;
  setCamera();
  _frustum.setFromProjectionMatrix(_pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)); A.tris = A.visibleTris(_frustum);
  if (shakeT > 0) { shakeT = Math.max(0, shakeT - dt); const k = shakeT * .9; cam.position.x += (R() - .5) * k; cam.position.y += (R() - .5) * k; cam.updateMatrixWorld(); }
  for (const a of actors) a.pose();
  if (player) xrayTick(player, dt);
  spinStep();
  // the shadow box first, then the sun from it: the other way round, in the frame where the box moved the sun pointed
  // from the old box to the new one, and the shadows' edges jumped a pixel while walking
  A.update(dt, player.x, player.z);
  applyTod(1 - Math.exp(-dt * 2.2)); if (G && ui.screen === 'game') playTrack(areaTrack()); flatsDraw(dt); shotsDraw(); fishDraw(); ambientDraw(); exitsDraw(); chestsTick(dt); floatsDraw(dt); marksDraw(); hudDraw(); bossDraw(); toastTick(dt); musicTick();
  // a failing ship's lights (an area's "flicker"): the sun, the lamps and their halos dimmed together by lampFlicker;
  // none for a player who asked for less motion (the system's setting, or screen shake turned off)
  if (A && A.def.flicker && !reduceMotion && settings.shake !== false) { const f = lampFlicker(time); sun.intensity = cur.sunI * f * LIGHT_UNIT; uLampCol.value.set(cur.lamp * f, cur.lamp * .663 * f, cur.lamp * .353 * f); for (const h of lamps) h.material.opacity = Math.min(1, cur.lamp * f * .3); }
  // the shadow map is redrawn when what casts a shadow changed: a figure moved or showed another frame (castersSig), the
  // view turned, the sun moved, a chest's lid swung (chestsTick). It was redrawn every frame while any enemy, pickup or
  // dialogue existed, still or not
  const sig = castersSig(); if (sig !== lastCasters) { lastCasters = sig; shadowHold = Math.max(shadowHold, 1); }
  if (player.moving || player.anim || Math.abs(yaw - yawT) > 1e-3 || Math.abs(cur.az - TODS[tod].az) + Math.abs(cur.el - TODS[tod].el) > 1e-4) shadowHold = 3;
  if (shadowHold > 0) { shadowHold--; sun.shadow.needsUpdate = true; shadowDraws++; }
  postU.uTime.value = time; postU.uStars.value = cur.stars; postU.uBgTop.value.set(cur.top[0], cur.top[1], cur.top[2]); postU.uBgBot.value.set(cur.bot[0], cur.bot[1], cur.bot[2]);
  lookPre();
  renderer.info.reset();
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, cam);
  calls = renderer.info.render.calls;
  lookPasses();
  renderer.setRenderTarget(null); renderer.render(postScene, postCam);
}

let lastDraw = 0, ctxLost = false, shadowDraws = 0, lastCasters = '', drawCount = 0;   // (drawCount: the frames drawn, for the checks)
// what the figures' shadows depend on: where each stands and which frame it shows
function castersSig() { let s = ''; for (const a of actors) if (!a.far) s += (a.mesh && a.mesh.visible ? 1 : 0) + ',' + a.x.toFixed(3) + ',' + a.z.toFixed(3) + ',' + (a.lift || 0) + ',' + (a.frame ? a.frame.x + ':' + a.frame.y : a.at) + ',' + (a.caster ? a.caster.scale.x : 0) + ';'; return s; }   // (shadowDraws: the shadow map's redraws, for tools/perf-check.mjs)
// the GPU may drop the context (a driver reset, too many pages): the game waits for it, then draws from a clean slate
canvas.addEventListener('webglcontextlost', () => { ctxLost = true; });
canvas.addEventListener('webglcontextrestored', () => { ctxLost = false; last = performance.now(); acc = 0; drawAcc = 0; resize(); shadowHold = 8; });
function frame(now) {
  requestAnimationFrame(frame);
  // (never below 0: a frame's time stamp may come before a performance.now() read since, as freeze(false) sets last)
  const real = Math.max(0, Math.min(.25, (now - last) / 1000)); last = Math.max(last, now);
  // frozen: a check drives the simulation itself. ctxLost: the GPU dropped the WebGL context; nothing moves unseen
  if (document.hidden || frozen || ctxLost) { lastDraw = 0; return; }
  pollPad();
  // the simulation advances by the real time since the last frame, in equal steps of at most SIM (1/120 s). In whole
  // steps of SIM, frames of 7 or 14 ms moved things by 0, 1, 2 or 3 steps, and walking stuttered
  const n = Math.ceil(real / SIM - 1e-9); for (let i = 0; i < n; i++) step(real / n);
  // drawn on every refresh of the screen (settings.fps 0, the default: a cap that does not divide the screen's rate
  // shows the frames for uneven times, 14 and 21 ms for 60 on 144 Hz), or capped at 30 / 60 / 120 to save power; the
  // cap keeps its phase. Outside play the cap is IDLE_FPS: the screen's veil hides a picture that barely moves, and a
  // phone left on the title or the menu kept drawing it on every refresh
  const play = ui.screen === 'game', cap = play ? settings.fps : IDLE_FPS;
  drawAcc += real; let dt = drawAcc;
  if (cap) { const budget = 1 / cap; if (drawAcc + .002 < budget) return; dt = budget; drawAcc = Math.max(0, drawAcc - budget); if (drawAcc > budget) drawAcc = 0; } else drawAcc = 0;
  draw(dt);
  // the rate reported is the game's, drawn in play: the time between draws, not the cap's length (that reported the cap
  // always); the menu shows the rate measured before it opened, not its own IDLE_FPS
  if (play) { if (lastDraw) { frames++; fpsT += Math.min(.25, (now - lastDraw) / 1000); } lastDraw = now; } else lastDraw = 0;
  if (fpsT >= .5) { fps = frames / fpsT; frames = 0; fpsT = 0; if (settings.showFps) $('hFps').textContent = t('hud.fps', { n: Math.round(fps) }); }   // (the HUD's own count, an option: under the level)
  if ($('hFps').hidden === !!settings.showFps) $('hFps').hidden = !settings.showFps;
  if (!$('menu').hidden) $('diag').textContent = t('diag', { fps: Math.round(fps), ms: (1000 / Math.max(1, fps)).toFixed(1), tris: Math.round((A ? A.tris : 0) / 1000), verts: Math.round((A ? A.tris : 0) * 2 / 1000),   // every face is a quad of its own: 4 vertices, 2 triangles
 calls: calls + 1, build: A ? A.buildMs : 0 });
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
  fragmentShader: 'uniform vec3 uCol; uniform sampler2D uAux; varying float vLayer; varying vec2 vUv; void main(){ ' + layerTest('vUv') + ' gl_FragColor = vec4(uCol, 1.0); }',
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
  fragmentShader: 'uniform vec3 uView; uniform vec2 uC; uniform sampler2D uAux; varying float vLayer; varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ ' + layerTest('vUv') + ' gl_FragColor = (dot(vN, uView) > -0.05 || vLayer > 299.5) ? vec4(0.5, 0.5, 0.5, 1.0) : vec4(1.0, clamp((vW.x - uC.x) / 64.0 + 0.5, 0.0, 1.0), clamp((vW.z - uC.y) / 64.0 + 0.5, 0.0, 1.0), 1.0); }',
});
function qaRender(assign) {
  const swaps = [], hidden = [];
  scene.traverse((o) => {
    if (o.isSprite || o.userData.wire || o.userData.xray || (o.isMesh && o.parent && o.parent.userData && o.parent.userData.wireOn === o)) { if (o.visible) { hidden.push(o); o.visible = false; } return; }
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
// skyPass: the sky in the last drawn picture: the render target's alpha, which the post pass turns into the sky where
//   it is 0 (so real materials, sprites cut out by their alpha, shadow casters unseen, exactly as the player sees it).
//   Returns the sky's pixels (counted as in a 640x360 picture), their box on screen (fractions of the width and height
//   from the top left), and how many of them look down on the map itself (their line of sight meets the ground plane
//   inside it): a hole, where the rest is the view reaching past the board's edge. stride: every stride-th pixel each way
//   only (a missing chunk is thousands of pixels; the checks that look every frame of a turn use 4)
function skyPass(stride = 1) {
  const w = rt.width, h = rt.height, px = new Uint8Array(w * h * 4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), k = (640 * 360) / (w * h) * stride * stride;
  let n = 0, inside = 0, x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (let yy = 0; yy < h; yy += stride) for (let xx = 0; xx < w; xx += stride) { const i = yy * w + xx; if (px[i * 4 + 3] >= 3) continue;
    n++; const x = (i % w) / w, y = 1 - (Math.floor(i / w) + 1) / h; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    a.set(x * 2 - 1, 1 - y * 2, -1).unproject(cam); b.set(x * 2 - 1, 1 - y * 2, 1).unproject(cam);
    const t = a.y / (a.y - b.y), gx = a.x + (b.x - a.x) * t, gz = a.z + (b.z - a.z) * t; if (A && gx > .5 && gz > .5 && gx < A.W - .5 && gz < A.D - .5) inside++;
  }
  return { sky: Math.round(n * k), inside: Math.round(inside * k), box: n ? [x0, y0, x1, y1].map((v) => +v.toFixed(2)) : null, w, h };
}
// figurePass: the scene drawn with only one figure in it (everything else hidden for that one draw), and the picture's
//   pixels in a box around its feet read back (picture pixels, top row first): to see what the figure alone looks like
//   on screen, frame after frame (tools/sprite-check.mjs)
function figurePass(a, half) {
  const hidden = []; scene.traverse((o) => { if ((o.isMesh || o.isSprite) && o.visible && o !== a.mesh) { hidden.push(o); o.visible = false; } });
  draw(0); for (const o of hidden) o.visible = true;
  const v = a.mesh.position.clone().project(cam), cx = Math.round((v.x + 1) / 2 * rt.width), cy = Math.round((v.y + 1) / 2 * rt.height);
  const w = half * 2, x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half / 2), px = new Uint8Array(w * w * 4); renderer.readRenderTargetPixels(rt, x0, y0, w, w, px);
  const out = []; for (let y = w - 1; y >= 0; y--) { let row = ''; for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; row += px[o + 3] > 127 ? (px[o] >> 4).toString(16) + (px[o + 1] >> 4).toString(16) + (px[o + 2] >> 4).toString(16) : '...'; } out.push(row); }
  return { rows: out, cx, cy, rt: [rt.width, rt.height] };
}
// seenPass: how much of a figure the player sees from where the camera stands: the figure drawn in white (cut to its
//   frame) once alone, once with every opaque thing of the scene drawn black in front of it (things cut to their drawing
//   as the slab material cuts them; shadow casters, glows, see-through things and the other figures, who move, left
//   out), in a picture of the canvas's own shape; the share of its pixels left, 0 to 1 (seen). And where in its frame
//   the figure is drawn (body: [left, right, feet, head] as fractions of the frame's width from its left on screen and
//   of its height from its foot), for a test that works from the map alone (tools/sight-check.mjs: the default view of each
//   place, from every spot the cat can stand on)
let seenTarget = null;
function seenPass(a) {
  const w = 400, h = Math.round(w * canvas.height / Math.max(1, canvas.width));   // (the camera is orthographic: no aspect of its own)
  if (!seenTarget || seenTarget.height !== h) { if (seenTarget) seenTarget.dispose(); seenTarget = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }); }
  // (a shader of its own, as idPass's: no stock chunk, no colour path)
  const white = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { uMap: { value: a.tex } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D uMap; varying vec2 vUv; void main(){ if (texture2D(uMap, vUv).a < 0.5) discard; gl_FragColor = vec4(1.0); }' });
  const black = qaFlat(0), slabBlack = qaId(0), none = new THREE.MeshBasicMaterial({ visible: false }), others = new Set(actors.filter((x) => x !== a).map((x) => x.mesh));
  let box = null;
  const count = (front) => {
    const swaps = [], hidden = [];
    scene.traverse((o) => {
      if (o.isSprite || o.isPoints || o.isLine || o.userData.xray) { if (o.visible) { hidden.push(o); o.visible = false; } return; }
      if (!o.isMesh) return;
      const m = o.material, solid = !Array.isArray(m) && m.visible !== false && m.colorWrite !== false && !m.transparent;
      swaps.push([o, m]); o.material = o === a.mesh ? white : front && solid && !others.has(o) ? (m === matSlab ? slabBlack : black) : none;
    });
    const prevBg = scene.background; scene.background = new THREE.Color(0);
    renderer.setRenderTarget(seenTarget); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, cam); renderer.setRenderTarget(null);
    const px = new Uint8Array(w * h * 4); renderer.readRenderTargetPixels(seenTarget, 0, 0, w, h, px);
    for (const [o, m] of swaps) o.material = m; for (const o of hidden) o.visible = true; scene.background = prevBg;
    let n = 0, x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (let k = 0; k < px.length; k += 4) if (px[k] > 200) { n++; const i = k / 4, x = i % w, y = (i / w) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (!front && n) box = [x0, x1 + 1, y0, y1 + 1];   // (rows from the bottom)
    return n;
  };
  const all = count(false), seen = all ? count(true) : 0;
  white.dispose(); black.dispose(); slabBlack.dispose(); none.dispose();
  // the frame's corners on the same picture: the drawn box as fractions of it
  let body = null;
  if (box) {
    const g = a.mesh.geometry; if (!g.boundingBox) g.computeBoundingBox(); const bb = g.boundingBox, v = new THREE.Vector3(), xs = [], ys = [];
    for (const [x, y] of [[bb.min.x, bb.min.y], [bb.max.x, bb.min.y], [bb.min.x, bb.max.y], [bb.max.x, bb.max.y]]) { v.set(x, y, 0).applyMatrix4(a.mesh.matrixWorld).project(cam); xs.push((v.x + 1) / 2 * w); ys.push((v.y + 1) / 2 * h); }
    const fx0 = Math.min(...xs), fw = Math.max(...xs) - fx0, fy0 = Math.min(...ys), fh = Math.max(...ys) - fy0;
    body = [(box[0] - fx0) / fw, (box[1] - fx0) / fw, (box[2] - fy0) / fh, (box[3] - fy0) / fh].map((q) => +Math.max(0, Math.min(1, q)).toFixed(3));
  }
  return { px: all, seen: all ? +(seen / all).toFixed(3) : 0, body };
}
// lumaPass: the picture just drawn as the player sees it (the post pass's, on the canvas: bloom, kicks and the dark all
//   in), read back in the same task (before the page shows it the buffer is still there): the mean relative luminance
//   (WCAG's, from linear sRGB, 0 to 1) of the whole and of its four quarters, every 2nd pixel each way
//   (tools/access-check.mjs: flashes)
const lumaLin = Array.from({ length: 256 }, (_, v) => { const c = v / 255; return c <= .04045 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); });
function lumaPass() {
  const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const sum = [0, 0, 0, 0], n = [0, 0, 0, 0];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    const o = (y * w + x) * 4, q = (y < h / 2 ? 2 : 0) + (x < w / 2 ? 0 : 1);   // (rows from the bottom: 0 and 1 the top quarters)
    sum[q] += .2126 * lumaLin[px[o]] + .7152 * lumaLin[px[o + 1]] + .0722 * lumaLin[px[o + 2]]; n[q]++;
  }
  const all = sum.reduce((a, b) => a + b) / n.reduce((a, b) => a + b);
  return [all, ...sum.map((s, i) => s / (n[i] || 1))].map((v) => +v.toFixed(4));
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
useShapeEdits();

// ---- content/plugins/art/bakery.js
/* ---------- plugin: the bakery drawn in code (it replaces the sheet drawing of the same key) ---------- */
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

// ---- content/plugins/art/lowpoly/00-palette.js
/* ---------- plugin, the low-poly page (index.html): the palette and the ground, painted in code ---------- */
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

// ---- content/plugins/art/lowpoly/01-parts.js
/* ---------- plugin, the low-poly page (index.html): the pieces buildings are made of ---------- */
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
  m.isDoor = true;   // (where it is put on a front is the building's door: engine/25-lpkit.js LP_DOORS)
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
  lpEmit('smoke', x, y1 + 2, z);   // (its smoke: engine/59-ambient.js)
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

// ---- content/plugins/art/lowpoly/02-buildings.js
/* ---------- plugin, the low-poly page (index.html): the village's buildings ---------- */
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
  m.spin([cx, 82, zS], 'z', .12, () => {
    m.prism(Array.from({ length: 8 }, (_, k) => [hub[0] + Math.cos(k / 8 * Math.PI * 2) * 3, hub[1] + Math.sin(k / 8 * Math.PI * 2) * 3]), 'z', 26, zS + 2, LPC.woodDk);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + k * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), L = 46, R2 = (u, v) => [hub[0] + ca * u - sa * v, hub[1] + sa * u + ca * v];
      const quad = (u0, u1, v0, v1, z, c, th) => { const p = [R2(u0, v0), R2(u1, v0), R2(u1, v1), R2(u0, v1)]; m.face(p.map(([x, y]) => [x, y, z + th]), c, { from: [hub[0], hub[1], z - 5], jit: .02 }); m.face(p.map(([x, y]) => [x, y, z]), lpShade(c, .85), { from: [hub[0], hub[1], z + 9] }); };
      quad(2, L, -1, 1, zS, LPC.woodDk, 1.4);                     // the spar
      quad(10, L - 1, 1, 11, zS - .6, LPC.awnCream, .4);          // the cloth
      for (let u = 12; u < L; u += 7) quad(u, u + .9, 1, 11.5, zS + .2, LPC.wood, .8);   // its battens
      quad(10, L - 1, 10.4, 11.6, zS + .2, LPC.wood, .8);
    }
  });   // (turning slowly: engine/40-area.js lpSpinners)
  return m;
};

// ---- content/plugins/art/lowpoly/03-props.js
/* ---------- plugin, the low-poly page (index.html): props and plants ---------- */
// Foliage is lit by its own height: lighter on top, darker underneath, as a canopy reads in late light.
const lpLeaf = (lo, hi, a, b, c) => (p) => { const t = (p[1] - lo) / Math.max(1, hi - lo); return t > .66 ? a : t > .33 ? b : c; };

LP_MODELS.oak = () => {
  const m = new LPM(), L = lpLeaf(30, 99, LPC.leafLt, LPC.leaf, LPC.leafDk);
  lpEmit('leaves', 0, 70, 0, 26);   // (falling leaves: engine/59-ambient.js)
  m.lathe(0, 0, [[6, 0], [4.6, 6], [3.6, 30], [3, 44]], 7, LPC.trunk, { top: false });
  for (const [x, y, z, r, s] of [[0, 72, 0, 26, 1], [-22, 60, 4, 18, 2], [22, 62, -2, 19, 3], [-8, 86, -4, 16, 4], [12, 82, 6, 15, 5], [0, 58, 12, 15, 6]]) m.blob(x, y, z, r, LPC.leaf, { seed: s * 13, sy: .82, jit: .16, col: L, flat: y - r * .6, facet: 1 });
  return m;
};
LP_MODELS.olive = () => {
  const m = new LPM(), L = lpLeaf(24, 70, 0xa9b874, LPC.olive, 0x6e8448);
  lpEmit('leaves', 0, 50, 0, 18);
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
// seven smaller clumps, each once subdivided, the flowers bare icosahedra: a lumpier outline at 640 faces (four big clumps
// twice subdivided were 1,599, as much as a house, and 21 of them stood in the village)
LP_MODELS.bush = () => {
  const m = new LPM(), L = lpLeaf(0, 36, LPC.leafLt, LPC.leaf, LPC.leafDk);
  for (const [x, y, z, r, s] of [[-14, 11, 2, 10, 1], [-5, 15, -4, 11, 2], [7, 13, -3, 11, 3], [15, 10, 2, 9, 4], [-6, 22, 3, 10, 5], [6, 23, 2, 10, 6], [0, 10, 9, 9, 7]]) m.blob(x, y, z, r, LPC.leaf, { seed: s * 17, sy: .85, jit: .2, col: L, flat: 0, facet: 1, sub: 1 });
  for (const [x, y, z, c] of [[-14, 19, 10, 0xf4efe6], [6, 30, 8, 0xe9a3b6], [14, 17, 9, 0xf4efe6], [-4, 30, 6, 0xe9a3b6]]) m.blob(x, y, z, 1.4, c, { seed: x + 40, jit: .1, sub: 0 });
  return m;
};
// (a clump of leaves once subdivided, a bunch of grapes a bare icosahedron: at twice, 3,905 faces a row, more than a house,
// and the four rows made the farm the village's heaviest view, the frames dropping on the owner's phone while the cat walked by)
LP_MODELS.vine_row = () => {
  const m = new LPM(), L = lpLeaf(10, 50, LPC.leafLt, LPC.leaf, LPC.leafDk);
  for (const x of [-62, 0, 62]) m.box(x - 1.3, 0, -1.3, x + 1.3, 46, 1.3, LPC.woodDk);
  for (const y of [24, 40]) m.box(-62, y - .4, -.4, 62, y + .4, .4, LPC.iron);
  for (let i = 0; i < 8; i++) { const x = -54 + i * 15.5; m.box(x - 1, 0, -1, x + 1, 26, 1, LPC.trunk); m.blob(x, 34, 0, 11, LPC.leaf, { seed: i * 11 + 2, sy: .8, jit: .18, col: L, flat: 18, facet: 1, sub: 1 }); for (let g = 0; g < 2; g++) m.blob(x - 4 + g * 7, 23, 7 - g * 2, 2.6, LPC.grape, { seed: i * 3 + g, sy: 1.3, jit: .12, sub: 0 }); }
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

// ---- content/plugins/art/lowpoly/04-climb.js
/* ---------- plugin, the low-poly page: things the cat climbs (engine/56-moves.js) ---------- */
// a wooden ladder leaning on a rise: two rails and the rungs, 64 px tall (a cliff of 56 and its lip); its 2D card a plain
// board (the diorama page draws no climbing)
LP_MODELS.ladder = () => {
  const m = new LPM(), wood = 0x9a6a42, dark = 0x6e4a2e;
  for (const x of [-7, 5]) m.box(x, 0, -1, x + 2, 64, 1, wood, { top: dark });
  for (let y = 6; y < 62; y += 7) m.box(-5, y, -.6, 5, y + 1.6, .6, dark, { top: wood });
  return m;
};
BUILD.ladder = 'pixel';
CODE_ART.ladder = () => { const p = new Pic(16, 64); p.wall(0, 0, 16, 64, 0x9a6a42, 1, -1); return p.done(); };

// ---- content/plugins/art/lowpoly/05-crypt.js
/* ---------- plugin, the low-poly page (index.html): the crypt's stone ---------- */
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

// ---- content/plugins/art/lowpoly/10-ship-ground.js
/* ---------- plugin, the low-poly page (index.html): the Ark's palette, floors and walls (Chapter 2) ---------- */
// One palette for the whole ship (spec section 6: blue-grey metals, off-white panels, amber service lights, emergency
// red, greenhouse green, the blue-black of ink and void). The floors are painted in code like the village's: 128 art px
// square, seamless, a few flat shades and sparse details. LP_TILES and LP_WALL are wrapped, not replaced: the village's
// tiles and wall colours come through untouched (tools/test/shipkit.test.mjs holds that).
const SHP = {
  metal: 0x8a96a8, metalDk: 0x5c6678, metalLt: 0xb4bfcc, seam: 0x4e5868, rivet: 0xa8b2c0,
  panel: 0xd8dcd6, panelDk: 0xb0b4ae, amber: 0xf0b040, red: 0xd04a3a, green: 0x5fa05a, greenDk: 0x3f7a3e,
  ink: 0x1a1c2c, void: 0x0c1020, frost: 0xe4f2fa, screen: 0x7fe0c0, cushion: 0x6a7aa0, blanket: 0x5a6890, earth: 0x4a3424,
  wall: 0x8a96a8, wallWhite: 0xd8dcd6,
};
const lpVillageTiles = LP_TILES, lpVillageWall = LP_WALL;
function lpShipTiles() {
  const W = 128, H = 128, tile = (fn) => { const px = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = fn(x, y), o = (y * W + x) * 4; px[o] = c >> 16 & 255; px[o + 1] = c >> 8 & 255; px[o + 2] = c & 255; px[o + 3] = 255; } return { w: W, h: H, px }; };
  // seamless value noise with period 128 (cells of s px), as the village's
  const noise = (seed, s) => { const n = W / s, at = (i, j) => hash2(((i % n) + n) % n + seed * 131, ((j % n) + n) % n + seed * 71); return (x, y) => { const fx = x / s, fy = y / s, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, sm = (t) => t * t * (3 - 2 * t); const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1); return a + (b - a) * sm(u) + (c - a) * sm(v) + (a - b - c + d) * sm(u) * sm(v); }; };
  const n8 = noise(11, 8), n16 = noise(12, 16), n32 = noise(13, 32);
  // deck plates: 32 px plates, a dark seam, a rivet near each corner, each plate its own shade
  const plates = (x, y) => { const xx = x % 32, yy = y % 32, px = Math.floor(x / 32), py = Math.floor(y / 32); if (xx === 0 || yy === 0) return SHP.seam; if ((xx === 3 || xx === 29) && (yy === 3 || yy === 29)) return SHP.rivet; const c = [0x7c8798, 0x768192, 0x808b9c][Math.floor(hash2(px * 3 + 1, py * 5 + 2) * 3)]; return n8(x, y) > .8 ? lpShade(c, .95) : c; };
  // ink: blots of blue-black over the plates where the noise runs high (the stains grow on the floor too)
  const ink = (x, y) => { const v = n16(x, y) * .6 + n32(x, y) * .4; return v > .74 ? (v > .8 ? SHP.ink : 0x2a2e44) : plates(x, y); };
  const grating = (x, y) => (x % 4 === 0 || y % 4 === 0 ? (x % 16 === 0 || y % 16 === 0 ? SHP.metalDk : 0x6a7486) : 0x262c38);
  const carpet = (x, y) => { const v = n16(x, y) * .7 + n8(x, y) * .3; let c = v < .45 ? 0x56607a : v < .7 ? 0x5c6782 : 0x66708a; if (hash2(x * 7 + 1, y * 3 + 5) < .03) c = 0x4c5670; return c; };
  const soil = (x, y) => { const v = n8(x, y) * .5 + n32(x, y) * .5; let c = v < .4 ? 0x3e2c1e : v < .7 ? SHP.earth : 0x56402c; if (hash2(x * 5 + 2, y * 11 + 7) < .025) c = 0x7a6040; return c; };
  // the old parquet of the archive (the library's echo): staggered blocks 16 × 4, two warm shades, a dark joint; the
  // block index taken modulo the tile's 8 blocks, so the block across the edge is one block (no seam every 8 units)
  const parquet = (x, y) => { const row = Math.floor(y / 4), xx = (x + (row % 2) * 8) % 16; if (y % 4 === 3 || xx === 0) return 0x5e3a22; const c = hash2(Math.floor((x + (row % 2) * 8) / 16) % 8, row) < .5 ? 0x9a6b3e : 0xa57444; return n8(x, y) > .82 ? lpShade(c, .9) : c; };
  // dark glass over the stars: a few 1-px stars and rare 3-px ones, placed by a seeded list that wraps
  const ST = []; { const r = rng(311); for (let i = 0; i < 60; i++) ST.push([Math.floor(r() * 128), Math.floor(r() * 128), i % 9 === 0]); }
  const stars = (x, y) => { for (const [sx, sy, big] of ST) { const dx = ((x - sx + 192) % 128) - 64, dy = ((y - sy + 192) % 128) - 64; if (dx === 0 && dy === 0) return 0xf2f4ff; if (big && Math.abs(dx) + Math.abs(dy) === 1) return 0x8a92c0; } return n32(x, y) > .7 ? 0x101628 : SHP.void; };
  // hazard: amber and dark stripes on the diagonal, 16 px a pair (128 divides by 16: the stripes wrap)
  const hazard = (x, y) => (((x + y) % 16) < 8 ? SHP.amber : 0x2a2a30);
  return { deck_plates: tile(plates), deck_ink: tile(ink), grating: tile(grating), carpet: tile(carpet), soil: tile(soil), parquet_old: tile(parquet), star_glass: tile(stars), hazard: tile(hazard) };
}
LP_TILES = () => Object.assign({}, lpVillageTiles(), lpShipTiles());

// the ship's walls, by the legend's wall colour: panels 24 px wide and 32 high with a dark seam, a darker plinth, and an
// amber service strip at 22 px; blue-grey panels for corridors and machines, off-white for cabins and the infirmary
LP_WALL = (c, a, y) => {
  if (c !== SHP.wall && c !== SHP.wallWhite) return lpVillageWall(c, a, y);
  const base = c, dark = lpShade(base, .78);
  if (y < 6) return y === 5 ? SHP.seam : dark;
  if (y === 22) return SHP.amber;
  if (a % 24 === 0 || (y - 6) % 32 === 0) return SHP.seam;
  return hash2(Math.floor(a / 24), Math.floor((y - 6) / 32)) < .5 ? base : lpShade(base, .95);
};

// ---- content/plugins/art/lowpoly/11-ship-kit.js
/* ---------- plugin, the low-poly page (index.html): the Ark's things (Chapter 2), the story objects ---------- */
// A ship thing is two registrations: its model (LP_MODELS) and a plain card of the same size (CODE_ART). An area needs a
// sprite for every thing (its size is the collision box: engine/40-area.js); Chapter 2 is drawn on the low-poly page
// only, where the model replaces the card. Sizes in art px: w across, h tall, d deep; each model stays inside its card
// (tools/test/shipkit.test.mjs). Story objects first (spec section 6); the detail objects come with the kit's part B.
const SHIP_KEYS = [];
function shipThing(key, w, h, d, c, model) {
  SHIP_KEYS.push(key); LP_MODELS[key] = model; BUILD[key] = 'pixel';   // (the card extrudes as a pixel sprite: the editor and the diorama page need a geometry)
  CODE_ART[key] = () => { const p = new Pic(w, h), z = Math.round(d / 2); p.wall(0, 0, w, h, c, z, -z); return p.done(); };
}

// the cryo pod: an upright capsule, frosted glass in front lit from inside, a status light and a small screen
const cryoShell = (m) => {
  m.box(-13, 0, -11, 13, 4, 11, SHP.metalDk, { top: SHP.metal });
  m.box(-12, 4, -11, 12, 40, -4, SHP.panel, { top: SHP.panelDk });
  for (const [x0, x1] of [[-12, -10], [10, 12]]) m.box(x0, 4, -4, x1, 40, 8, SHP.metal);
  m.box(-12, 40, -11, 12, 44, 8, SHP.metalLt, { top: SHP.metal });
  m.box(10.5, 16, 8, 11.8, 22, 8.6, SHP.screen, { f: { glow: 1 } });
  return m;
};
shipThing('cryo_pod', 26, 44, 22, SHP.panel, () => { const m = cryoShell(new LPM()); m.box(-10, 6, 6, 10, 38, 8, SHP.frost, { f: { glow: 1 } }); m.box(-2, 41, 8, 2, 43, 8.6, SHP.amber, { f: { glow: 1 } }); return m; });
// open: the glass slid up into the top, the cushioned inside showing, the light gone red
shipThing('cryo_pod_open', 26, 44, 22, SHP.panel, () => { const m = cryoShell(new LPM()); m.box(-9, 6, -4, 9, 38, -3, SHP.cushion); m.box(-10, 4, -4, 10, 6, 8, SHP.metalDk); m.box(-2, 41, 8, 2, 43, 8.6, SHP.red, { f: { glow: 1 } }); return m; });

// the codex case: a pedestal, an open frame of thin posts, Chapter 1's codex inside, its pages glowing faintly
shipThing('codex_case', 20, 30, 20, SHP.metalDk, () => {
  const m = new LPM();
  m.box(-8, 0, -8, 8, 18, 8, SHP.metalDk, { top: SHP.metal });
  for (const [x, z] of [[-8, -8], [7, -8], [-8, 7], [7, 7]]) m.box(x, 18, z, x + 1, 29, z + 1, SHP.metalLt);
  for (const z of [-8, 7]) m.box(-8, 29, z, 8, 30, z + 1, SHP.metalLt);
  for (const x of [-8, 7]) m.box(x, 29, -7, x + 1, 30, 7, SHP.metalLt);
  m.box(-5, 18, -4, 5, 21, 4, LPC.red, { top: lpShade(LPC.red, 1.1) });
  m.box(-4.5, 21, -3.5, 4.5, 22, 3.5, 0xf0e6cc, { f: { glow: 1 } });
  return m;
});

// the console: a desk, a screen slanted toward the user and glowing, a row of buttons
shipThing('console', 32, 22, 18, SHP.metal, () => {
  const m = new LPM();
  m.box(-16, 0, -9, 16, 12, 9, SHP.metal, { top: SHP.metalDk });
  m.box(-15, 12, -9, 15, 21, -6, SHP.metalDk);
  m.face([[-14, 12.2, 2], [14, 12.2, 2], [14, 21, -5.9], [-14, 21, -5.9]], SHP.screen, { from: [0, 8, -9], glow: 1 });
  for (let k = 0; k < 4; k++) m.box(-12 + k * 7, 12, 4, -9 + k * 7, 13, 7, [SHP.amber, SHP.red, SHP.green, SHP.amber][k], { f: { glow: 1 } });
  return m;
});

// a crew member's locker: tall, a door seam, three vents, a handle
shipThing('crew_locker', 18, 40, 12, SHP.metal, () => {
  const m = new LPM();
  m.box(-9, 0, -6, 9, 40, 6, SHP.metal, { top: SHP.metalLt });
  m.box(-.4, 2, 6, .4, 38, 6.4, SHP.seam);
  for (let k = 0; k < 3; k++) m.box(-6, 32 + k * 2, 6, 6, 33 + k * 2, 6.3, SHP.metalDk);
  m.box(2, 18, 6, 3, 23, 7, SHP.metalDk);
  return m;
});

// a supply crate: dark metal, amber bands and a light lid
shipThing('supply_crate', 20, 14, 14, SHP.metalDk, () => {
  const m = new LPM();
  m.box(-10, 0, -7, 10, 14, 7, SHP.metalDk, { top: SHP.metal });
  for (const y of [3, 9]) m.box(-10.3, y, -7.3, 10.3, y + 2, 7.3, SHP.amber, { skip: ['bottom', 'top'] });
  return m;
});

// an archive shelf: a wooden case (the old library's), five shelves, books of every colour, a few gone black with ink
shipThing('archive_shelf', 48, 58, 12, LPC.wood, () => {
  const m = new LPM(), BOOKS = [0x8a3a2e, 0x2e5a7a, 0x5a7a3a, 0xb08a3a, 0x6a3a6a, 0x3a6a6a, 0x9a6a3a];
  for (const [x0, x1] of [[-24, -22], [22, 24]]) m.box(x0, 0, -6, x1, 58, 6, LPC.woodDk);
  m.box(-22, 0, -6, 22, 58, -4.5, LPC.wood);
  for (const y of [0, 14, 28, 42, 56]) m.box(-22, y, -4.5, 22, y + 1.5, 6, LPC.woodDk);
  for (const [s, y] of [0, 14, 28, 42].entries()) {
    let x = -21.5, i = 0;
    while (x < 20) {
      const w = 2 + Math.floor(hash2(i * 7 + s, s * 13) * 2), h = 8 + Math.floor(hash2(i * 3 + s * 5, 11) * 4), inked = hash2(i, s * 29 + 3) < .12;
      if (x + w > 21.5) break;
      m.box(x, y + 1.5, -4, x + w - .2, y + 1.5 + h, 4, inked ? SHP.ink : BOOKS[Math.floor(hash2(i * 5 + s, 7) * BOOKS.length)]);
      x += w; i++;
    }
  }
  return m;
});

// a plant tank: a metal tank of earth, the old village's olive growing in it, a grow light on two posts above
shipThing('plant_tank', 36, 35, 18, SHP.metal, () => {
  const m = new LPM();
  m.box(-18, 0, -9, 18, 10, 9, SHP.metal, { top: SHP.earth });
  m.box(-18.4, 9, -9.4, 18.4, 10.5, 9.4, SHP.metalDk, { skip: ['bottom', 'top'] });
  m.frustum(0, 0, 2, 1.4, 10, 20, 6, LPC.trunk, { top: false, smooth: false });
  m.blob(0, 24, 0, 8, LPC.olive, { facet: true, sy: .7, seed: 3 });
  for (const x of [-17, 16]) m.box(x, 10, -1, x + 1, 33, 1, SHP.metalDk);
  m.box(-17, 33, -2, 17, 35, 2, SHP.metalDk);
  m.box(-15, 32, -1.5, 15, 33, 1.5, 0xf8e8b0, { f: { glow: 1 } });
  return m;
});

// the observatory's telescope: a round foot, a column, a mount, the tube raised toward the window (tilted about x)
shipThing('telescope', 30, 48, 40, SHP.metalDk, () => {
  const m = new LPM(), a = .7, ca = Math.cos(a), sa = Math.sin(a);
  m.frustum(0, 0, 8, 5, 0, 6, 8, SHP.metalDk, { top: SHP.metal, smooth: false });
  m.box(-2, 6, -2, 2, 26, 2, SHP.metal);
  m.box(-4, 26, -4, 4, 30, 4, SHP.metalDk);
  const tube = new LPM().frustum(0, 0, 4, 3.2, -10, 22, 10, SHP.metalLt, { top: SHP.void, bottom: SHP.metalDk });
  for (const f of tube.f) m.f.push(Object.assign({}, f, { p: f.p.map(([x, y, z]) => [x, 30 + y * ca - z * sa, -(y * sa + z * ca)]) }));
  return m;
});

// a power switch panel: three levers with their lamps above, for the engine room's puzzle
shipThing('power_switch', 16, 26, 12, SHP.metalDk, () => {
  const m = new LPM();
  m.box(-8, 0, -4, 8, 26, 4, SHP.metalDk, { top: SHP.metal });
  m.box(-7, 4, 4, 7, 24, 4.4, SHP.metal);
  for (let k = 0; k < 3; k++) { const x = -5.5 + k * 4.5; m.box(x, 9, 4.4, x + 2, 15, 6, LPC.red); m.box(x, 18, 4.4, x + 2, 20, 4.8, SHP.amber, { f: { glow: 1 } }); }
  return m;
});

// a bunk in the quarters: a metal frame, a mattress under a blue blanket folded back, a pillow
shipThing('bunk', 40, 15, 22, SHP.metalDk, () => {
  const m = new LPM();
  m.box(-20, 0, -11, 20, 8, 11, SHP.metalDk, { top: SHP.metal });
  m.box(-19, 8, -10, 19, 12, 10, SHP.blanket, { top: SHP.cushion });
  m.box(-6, 12, -10, 19, 12.6, 10, SHP.blanket);
  m.box(-18, 12, -8, -10, 14.5, 8, 0xe8e8e0);
  return m;
});

// ---- content/plugins/art/lowpoly/12-ship-detail.js
/* ---------- plugin, the low-poly page (index.html): the Ark's things (Chapter 2), the detail objects ---------- */
// The furniture and the machinery around the story objects (11-ship-kit.js), on the same kit: shipThing() registers the
// model, its card (the collision, filling the model's footprint: tools/test/shipkit.test.mjs) and a pixel card build.
// A wall-mounted thing stands at the back of its card (z from -d/2): placed against a wall, it hangs on it.
// A thing the cat walks over (floor_vent, cable_coil) is placed with box [0, 0]: a card is otherwise a solid box.
// The lift and the door frame are solid across their whole card, opening included: an area puts its exit beside or in
// front of them (a thing's "door", whose exit stands before the solid), never through them.

// the mess table: a long top on two trestles, a tray and two cups left as they were
shipThing('mess_table', 40, 16, 18, SHP.metal, () => {
  const m = new LPM();
  m.box(-20, 11, -9, 20, 13, 9, SHP.panel, { top: SHP.panel });
  for (const x of [-15, 13]) m.box(x, 0, -7, x + 2, 11, 7, SHP.metalDk);
  m.box(-15, 3, -1, 15, 4.5, 1, SHP.metalDk);
  m.box(-8, 13, -4, 2, 13.6, 3, SHP.metalLt);
  for (const [x, z] of [[6, -2], [11, 3]]) m.frustum(x, z, 1.6, 1.8, 13, 16, 8, SHP.amber, { top: lpShade(SHP.amber, .7), smooth: false });
  return m;
});

// a chair: seat, back, four legs (a mess chair, pushed back from the table)
shipThing('chair', 12, 18, 12, SHP.metalDk, () => {
  const m = new LPM();
  for (const [x, z] of [[-6, -6], [4.5, -6], [-6, 4.5], [4.5, 4.5]]) m.box(x, 0, z, x + 1.5, 8, z + 1.5, SHP.metalDk);
  m.box(-6, 8, -6, 6, 9.5, 6, SHP.cushion, { top: SHP.cushion });
  m.box(-6, 9.5, -6, 6, 18, -4.5, SHP.metal);
  return m;
});

// the infirmary's bed: a white frame on a pedestal, a thin mattress, a raised head, a monitor arm with a green trace
shipThing('med_bed', 44, 26, 22, SHP.panel, () => {
  const m = new LPM();
  m.box(-6, 0, -6, 6, 8, 6, SHP.metalDk);
  m.box(-20, 8, -11, 22, 11, 11, SHP.panel, { top: SHP.panelDk });
  m.box(-19, 11, -10, 21, 13, 10, 0xe8eef0);
  m.prism([[-10, 13], [10, 13], [10, 18], [-10, 15]], 'x', -19, -12, 0xe8eef0);
  m.box(-22, 8, -2, -20, 24, 2, SHP.metal);
  m.box(-22, 20, -8, -20, 26, -2, SHP.metalDk);
  m.box(-21.9, 21, -7, -21.6, 25, -3, SHP.green, { f: { glow: 1 } });
  return m;
});

// the infirmary's cabinet: white, two glass doors with bottles behind, a red cross
shipThing('med_cabinet', 22, 36, 10, SHP.panel, () => {
  const m = new LPM();
  m.box(-11, 0, -5, 11, 36, 5, SHP.panel, { top: SHP.panelDk });
  m.box(-.4, 14, 5, .4, 34, 5.4, SHP.panelDk);
  for (const [x, c] of [[-8, 0x6aa0c0], [-5, 0xc06a5a], [3, 0x8ac06a], [6, 0x6aa0c0]]) m.box(x, 20, 4, x + 2, 25, 4.8, c);
  m.box(-2, 6, 5, 2, 12, 5.4, SHP.red); m.box(-4, 8, 5, 4, 10, 5.4, SHP.red);
  return m;
});

// the captain's safe: heavy, a dial and a small keypad lit amber
shipThing('safe', 18, 18, 16, SHP.metalDk, () => {
  const m = new LPM();
  m.box(-9, 0, -8, 9, 18, 8, SHP.metalDk, { top: SHP.metal });
  m.box(-7, 2, 8, 7, 16, 8.4, SHP.metal);
  m.box(-5, 7, 8.4, -1, 11, 9, SHP.metalLt, { top: SHP.metalLt });
  m.box(3, 6, 8.4, 6, 12, 8.9, SHP.amber, { f: { glow: 1 } });
  return m;
});

// the navigator's chart table: a slanted top under glass, a star chart drawn in gold lines on it (lit from below)
shipThing('chart_table', 34, 16, 22, SHP.metal, () => {
  const m = new LPM();
  m.box(-17, 0, -11, 17, 10, 11, SHP.metal, { top: SHP.metalDk });
  m.face([[-16, 10.2, 10], [16, 10.2, 10], [16, 15.8, -10], [-16, 15.8, -10]], SHP.void, { from: [0, 6, 0], glow: 1 });
  m.box(-17, 10, -11, 17, 16, -10, SHP.metalDk);
  for (let k = 0; k < 6; k++) { const x = -12 + k * 5, a = hash2(k, 5) * 8; m.face([[x, 10.6 + a * .05, 9 - a], [x + 1, 10.6 + a * .05, 9 - a], [x + 1, 11.2 + a * .05, 8 - a], [x, 11.2 + a * .05, 8 - a]], 0xe0c060, { glow: 1 }); }
  return m;
});

// the crew's group photo, on the mess wall (M4 stains its faces one by one): a frame, a pale picture
shipThing('photo_frame', 24, 30, 4, SHP.metalDk, () => {
  const m = new LPM();
  m.box(-12, 14, -2, 12, 30, 2, SHP.metalDk);
  m.box(-10.5, 15.5, 2, 10.5, 28.5, 2.4, 0xd8d0b8, { f: { glow: 1 } });
  for (let k = 0; k < 5; k++) m.box(-9 + k * 4, 19, 2.4, -7 + k * 4, 24, 2.7, [0x3a4a7a, 0x6a8ac0, 0xd07040, 0x5a8a4a, 0xe8e8e0][k]);
  return m;
});

// a toy in a cabin: a small tin robot, red and blue, one antenna (what a crew member kept from home)
shipThing('toy_robot', 8, 12, 6, SHP.red, () => {
  const m = new LPM();
  for (const x of [-3, 1]) m.box(x, 0, -2, x + 2, 3, 2, SHP.metalDk);
  m.box(-4, 3, -3, 4, 8, 3, SHP.red);
  m.box(-3, 8, -2.5, 3, 11, 2.5, 0x4a6aa8);
  m.box(-1.5, 9, 2.5, -.5, 10, 3, SHP.amber, { f: { glow: 1 } }); m.box(.5, 9, 2.5, 1.5, 10, 3, SHP.amber, { f: { glow: 1 } });
  m.box(-.3, 11, -.3, .3, 12, .3, SHP.metalLt);
  return m;
});

// pipes along a wall: three runs at different heights, brackets, a red valve wheel
shipThing('pipes', 48, 30, 6, SHP.metal, () => {
  const m = new LPM();
  for (const [y, r, c] of [[8, 1.6, SHP.metal], [16, 1.2, SHP.metalLt], [24, 2, SHP.metalDk]]) m.prism(Array.from({ length: 8 }, (_, k) => { const a = k / 8 * Math.PI * 2; return [-3 + 3 + Math.cos(a) * r - 1, y + Math.sin(a) * r]; }), 'x', -24, 24, c);
  for (const x of [-18, 0, 18]) m.box(x - 1, 4, -3, x + 1, 28, -2, SHP.metalDk);
  m.frustum(10, 0, 3.4, 3.4, 15, 16, 10, SHP.red, { top: SHP.red, smooth: false });
  return m;
});

// a coil of cable on the floor, a loose end running off
shipThing('cable_coil', 14, 4, 14, SHP.ink, () => {
  const m = new LPM();
  for (const r of [6.5, 5, 3.5]) m.frustum(0, 0, r, r, 0, 2.2 + (6.5 - r) * .3, 12, 0x2a2e3a, { top: 0x3a3e4a, smooth: false });
  m.box(5, 0, -.6, 7, 1.2, .6, 0x2a2e3a);
  return m;
});

// a floor vent: a raised grill, dark slots
shipThing('floor_vent', 16, 2, 16, SHP.metalDk, () => {
  const m = new LPM();
  m.box(-8, 0, -8, 8, 1, 8, SHP.metalDk, { top: 0x262c38 });
  for (let k = 0; k < 5; k++) m.box(-7, 1, -6.5 + k * 3, 7, 2, -5.5 + k * 3, SHP.metal);
  return m;
});

// the engine room's generator: a big drum on a plinth, cooling fins, a glowing core window, cables
shipThing('generator', 40, 40, 28, SHP.metalDk, () => {
  const m = new LPM();
  m.box(-20, 0, -14, 20, 6, 14, SHP.metalDk, { top: SHP.metal });
  m.lathe(0, 0, [[12, 6], [13, 10], [13, 32], [10, 38]], 16, SHP.metal, { top: SHP.metalDk, col: (b, k) => (k % 4 === 0 ? SHP.metalDk : SHP.metal) });
  m.box(-4, 16, 12.4, 4, 26, 13.6, 0x9fd8ff, { f: { glow: 1 } });
  for (const x of [-18, 15]) m.box(x, 6, -6, x + 3, 30, 6, SHP.metalDk);
  return m;
});

// a coolant tank: a tall cylinder, a level window, hazard band
shipThing('coolant_tank', 20, 44, 20, SHP.metal, () => {
  const m = new LPM();
  m.frustum(0, 0, 9.5, 9.5, 0, 40, 12, SHP.metalLt, { top: SHP.metal, smooth: false });
  m.frustum(0, 0, 10, 10, 6, 9, 12, SHP.amber, { top: false, smooth: false });
  m.frustum(0, 0, 6, 4, 40, 44, 8, SHP.metal, { top: SHP.metalDk, smooth: false });
  m.box(-2, 14, 9.4, 2, 34, 10, 0x6ac0e0, { f: { glow: 1 } });
  return m;
});

// a wall screen: a dark panel on the wall, lines of status in teal
shipThing('wall_screen', 30, 30, 3, SHP.metalDk, () => {
  const m = new LPM();
  m.box(-15, 12, -1.5, 15, 30, 1.5, SHP.metalDk);
  m.box(-13.5, 13.5, 1.5, 13.5, 28.5, 1.9, 0x0e1c24, { f: { glow: 1 } });
  for (let k = 0; k < 4; k++) m.box(-11, 16 + k * 3, 1.9, -11 + 8 + Math.floor(hash2(k, 3) * 12), 17 + k * 3, 2.2, SHP.screen, { f: { glow: 1 } });
  return m;
});

// a porthole: a round frame on the wall, stars behind dark glass
shipThing('porthole', 22, 34, 4, SHP.metal, () => {
  const m = new LPM(), cy = 23, n = 16;
  for (let k = 0; k < n; k++) { const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2, P = (r, a) => [Math.cos(a) * r, cy + Math.sin(a) * r]; const [p0, p1, q1, q0] = [P(11, a0), P(11, a1), P(8.5, a1), P(8.5, a0)]; m.face([[p0[0], p0[1], 2], [p1[0], p1[1], 2], [q1[0], q1[1], 2], [q0[0], q0[1], 2]], k % 2 ? SHP.metal : SHP.metalLt, { from: [0, cy, -2] }); }
  m.face(Array.from({ length: n }, (_, k) => { const a = k / n * Math.PI * 2; return [Math.cos(a) * 8.5, cy + Math.sin(a) * 8.5, 1.6]; }), SHP.void, { from: [0, cy, -2], glow: 1 });
  m.box(-11, 12, -2, 11, 34, 1.4, SHP.metalDk, { skip: ['bottom', 'front'] });
  for (const [x, y] of [[-3, 26], [4, 21], [1, 29]]) m.box(x, y, 1.6, x + 1, y + 1, 1.9, 0xf2f4ff, { f: { glow: 1 } });
  return m;
});

// a sector's door frame: two posts and a lintel with a light, the door itself open; the card is the whole frame, gap
// included (solid: the exit goes before it, as a thing's "door")
shipThing('door_frame', 36, 44, 8, SHP.metal, () => {
  const m = new LPM();
  for (const x of [-18, 12]) m.box(x, 0, -4, x + 6, 44, 4, SHP.metal, { top: SHP.metalDk });
  m.box(-12, 36, -4, 12, 44, 4, SHP.metalDk);
  m.box(-4, 38, 4, 4, 40, 4.4, SHP.amber, { f: { glow: 1 } });
  for (const x of [-18, 17.5]) m.box(x, 2, 4, x + .5, 34, 4.3, SHP.amber);
  return m;
});

// the central lift: a cage of posts and rails around a platform, a call panel lit green
shipThing('lift', 40, 50, 40, SHP.metalDk, () => {
  const m = new LPM();
  m.box(-20, 0, -20, 20, 2, 20, SHP.metalDk, { top: 0x6a7486 });
  for (const [x, z] of [[-20, -20], [18, -20], [-20, 18], [18, 18]]) m.box(x, 2, z, x + 2, 50, z + 2, SHP.metal);
  for (const y of [24, 48]) { m.box(-18, y, -20, 18, y + 2, -18, SHP.metalDk); m.box(-20, y, -18, -18, y + 2, 18, SHP.metalDk); m.box(18, y, -18, 20, y + 2, 18, SHP.metalDk); }
  m.box(14, 14, 18, 18, 20, 20, SHP.metalDk); m.box(15, 16, 20, 17, 18, 20.4, SHP.green, { f: { glow: 1 } });
  return m;
});

// ---- content/plugins/art/lowpoly/13-ship-ink.js
/* ---------- plugin, the low-poly page (index.html): the ink the crew left on the Ark (Chapter 2) ---------- */
// A person's shape on a wall, writing and footprints on the floor (the scanner's finds: placed with box [0, 0]), and the
// bridge's star map, torn and whole. Same kit and rules as 11-ship-kit.js and 12-ship-detail.js: the parts of a model
// stand at different depths or overlap in volume, never on one plane (tools/test/shipkit.test.mjs counts fights).
const INK_WET = 0x2c3350, INK_GLOW = 0x4a68b8;

// a person's shape in ink on a wall: legs, a body, arms a little open, a round head, two drips; flat against the wall
shipThing('ink_stain', 24, 40, 4, SHP.ink, () => {
  const m = new LPM();
  m.box(-6, 0, -2, -1.5, 17, .6, SHP.ink); m.box(1.5, 0, -2, 6, 17, .6, SHP.ink);
  m.box(-7, 16, -2, 7, 31, 1, SHP.ink);
  m.box(-12, 18, -2, -6.5, 29, .8, INK_WET); m.box(6.5, 18, -2, 12, 29, .8, INK_WET);
  m.prism(Array.from({ length: 8 }, (_, k) => { const a = k / 8 * Math.PI * 2; return [Math.cos(a) * 5, 35 + Math.sin(a) * 5]; }), 'z', -2, 1.2, SHP.ink);
  m.box(-11.6, 9, -2, -10.6, 18.5, .4, INK_WET); m.box(10.8, 12, -2, 11.6, 18.5, .4, INK_WET);
  return m;
});

// writing in hidden ink on the floor: strokes of an unknown hand, a few still glowing
shipThing('ink_writing', 28, 1, 16, SHP.ink, () => {
  const m = new LPM();
  const strokes = [[-14, -8, -8, -7], [-6, -8, 1, -7], [3, -7.5, 9, -6.5], [10.5, -8, 14, -7], [-13, -4, -9, -3], [-7.5, -4.5, -1, -3.5],
    [1, -4, 6, -3], [8, -4.5, 13, -3.5], [-12, 0, -5, 1], [-3, -.5, 4, .5], [6, 0, 11, 1], [-14, 4, -10, 5], [-8, 3.5, -2, 4.5], [0, 4, 7, 5],
    [9, 3.5, 14, 4.5], [-10, 7, -3, 8], [-1, 7, 5, 8]];
  strokes.forEach(([x0, z0, x1, z1], k) => m.box(x0, 0, z0, x1, .4 + (k % 3) * .1, z1, k % 4 === 1 ? INK_GLOW : SHP.ink, k % 4 === 1 ? { f: { glow: 1 } } : undefined));
  return m;
});

// footprints in wet ink: bare feet side by side, all going the same way
shipThing('ink_steps', 24, 1, 12, SHP.ink, () => {
  const m = new LPM();
  for (let p = 0; p < 5; p++) for (let s = 0; s < 2; s++) {
    const x = -12 + p * 5 + s * 2.2, z = -6 + ((p + s) % 2) * 6.5 + (s ? 0 : 1);
    m.box(x, 0, z, x + 1.8, .4 + s * .1, z + 3.5, s ? INK_WET : SHP.ink);
  }
  return m;
});

// the bridge's star map: a dark glass panel high on the wall, stars and the gold route; torn, four ragged holes
function starMap(torn) {
  const m = new LPM();
  m.box(-20, 12, -2, 20, 40, 1.5, SHP.metalDk);
  m.box(-18.5, 13.5, 1.5, 18.5, 38.5, 1.9, SHP.void, { f: { glow: 1 } });
  const holes = torn ? [[-16, 30, -9, 37], [-4, 15, 3, 22], [6, 28, 13, 36], [12, 15, 17, 21]] : [];
  const inHole = (x, y) => holes.some(([a, b, c, d]) => x > a - 1 && x < c + 1 && y > b - 1 && y < d + 1);
  for (let k = 0; k < 26; k++) { const x = -17 + hash2(k, 41) * 33, y = 15 + hash2(k, 42) * 22; if (!inHole(x, y)) m.box(x, y, 1.9, x + .7, y + .7, 2.1, 0xe8e8f0, { f: { glow: 1 } }); }
  const route = [[-15, 18], [-8, 24], [-1, 21], [6, 30], [14, 34]];
  for (let k = 0; k < route.length - 1; k++) {
    const [x0, y0] = route[k], [x1, y1] = route[k + 1];
    for (let s = 0; s < 6; s++) { const x = x0 + (x1 - x0) * s / 6, y = y0 + (y1 - y0) * s / 6; if (!inHole(x, y)) m.box(x, y, 2.1, x + 1, y + .6, 2.3, SHP.amber, { f: { glow: 1 } }); }
  }
  for (const [a, b, c, d] of holes) { m.box(a, b, 1.9, c, d, 2, 0x3a3e4a); m.box(a + 1, b + 1, 2, c - 1, d - 1, 2.05, 0x262a36); }
  return m;
}
shipThing('star_map_torn', 40, 40, 4, SHP.metalDk, () => starMap(true));
shipThing('star_map_whole', 40, 40, 4, SHP.metalDk, () => starMap(false));

// ---- content/plugins/art/lowpoly/20-west-ground.js
/* ---------- plugin, the low-poly page (index.html): Red Dust's palette, ground and walls (Chapter 3) ---------- */
// A frontier town at sunset over a mine (spec section 7): sun-baked planks, faded paint, adobe, sand, the mine's rock and
// the blue-black of ink. The ground is painted in code as the village's and the ship's are (128 art px square, seamless);
// LP_TILES and LP_WALL are wrapped again, the earlier tiles and wall colours handed on untouched.
const WST = {
  plank: 0x9a6a42, plankDk: 0x7a5032, plankLt: 0xb4844e, seam: 0x4e3220, trim: 0xe0d2b0,
  red: 0xa8463a, teal: 0x4f8a86, ochre: 0xc8963e, white: 0xd8ccb4, grey: 0x5a5458, black: 0x2c2628,
  adobe: 0xc88e62, adobeDk: 0xa8724c, tin: 0x8a8c90, tinDk: 0x6a6c70, sand: 0xd2a26a, sandDk: 0xb8864e,
  rock: 0x6e5a4c, rockDk: 0x54443a, rockLt: 0x8a7462, iron: 0x4a4648, ironLt: 0x7a7678, rope: 0xb09060,
  glass: 0xffd27a, dark: 0x1e1814, cactus: 0x5f8a4a, cactusDk: 0x466a38, water: 0x4a7a9a, ink: 0x1a1c2c, inkGlow: 0x7a4ad0,
  wallBoard: 0x8a5e3c, wallRock: 0x6a5648,
};
const lpOlderTiles = LP_TILES, lpOlderWall = LP_WALL;
function lpWestTiles() {
  const W = 128, H = 128, tile = (fn) => { const px = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = fn(x, y), o = (y * W + x) * 4; px[o] = c >> 16 & 255; px[o + 1] = c >> 8 & 255; px[o + 2] = c & 255; px[o + 3] = 255; } return { w: W, h: H, px }; };
  const noise = (seed, s) => { const n = W / s, at = (i, j) => hash2(((i % n) + n) % n + seed * 131, ((j % n) + n) % n + seed * 71); return (x, y) => { const fx = x / s, fy = y / s, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, sm = (t) => t * t * (3 - 2 * t); const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1); return a + (b - a) * sm(u) + (c - a) * sm(v) + (a - b - c + d) * sm(u) * sm(v); }; };
  const n8 = noise(21, 8), n16 = noise(22, 16), n32 = noise(23, 32);
  // sand: three warm shades by noise, a few pebbles
  // (close shades in wide patches: a busy, contrasted sand drew the eye from the figures on it)
  const sand = (x, y) => { const v = n32(x, y) * .7 + n16(x, y) * .3; let c = v < .38 ? 0xc89a62 : v < .7 ? WST.sand : 0xd8a870; if (hash2(x * 3 + 7, y * 5 + 1) < .008) c = 0xa88458; return c; };
  // the street: sand with two wheel ruts along x (the street runs east-west)
  const rut = (x, y) => { const yy = y % 64; return (yy >= 18 && yy <= 21) || (yy >= 42 && yy <= 45) ? (n8(x, y) > .5 ? 0x9a7046 : 0xa87a4c) : sand(x, y); };
  // the boardwalk: planks 8 px wide across, a dark gap, each plank its own shade, a nail now and then
  const boards = (x, y) => { if (y % 8 === 7) return WST.seam; const k = Math.floor(y / 8), c = [WST.plank, WST.plankDk, 0x8a5e3a][Math.floor(hash2(k, Math.floor(x / 64) + 3) * 3)]; if ((x % 32 === 3) && (y % 8 === 3)) return 0x3a2618; return n8(x, y) > .82 ? lpShade(c, .92) : c; };
  // the mine's floor: dark rock, cracks where the noise runs low, specks of ore
  const rock = (x, y) => { const v = n16(x, y) * .5 + n32(x, y) * .5; let c = v < .33 ? WST.rockDk : v < .7 ? WST.rock : WST.rockLt; if (Math.abs(n8(x, y) - .5) < .02) c = 0x3a2e26; if (hash2(x * 11 + 2, y * 7 + 9) < .006) c = 0xc8a050; return c; };
  // rails along x: sleepers every 16 px, two iron rails
  const rails = (x, y) => { const yy = y % 64; if (yy === 20 || yy === 21 || yy === 42 || yy === 43) return yy % 2 ? WST.iron : WST.ironLt; if (yy >= 16 && yy <= 47 && x % 16 < 5) return (x % 16 === 0) ? WST.seam : WST.plankDk; return rock(x, y); };
  // planks over rock (the mine's landings), as the boardwalk but darker
  const mineBoards = (x, y) => lpShade(boards(x, y), .78);
  // ink seeping through the rock: blue-black where the noise runs high
  const inkRock = (x, y) => { const v = n16(x, y) * .6 + n32(x, y) * .4; return v > .72 ? (v > .79 ? WST.ink : 0x2a2a44) : rock(x, y); };
  // a pool of ink (the flooded level's harmful floor): glossy black, ripples a shade lighter, violet glints; nothing of the
  // rock shows, so a pool reads as a pool from any distance
  const pool = (x, y) => { const v = n16(x, y) * .6 + n8(x, y) * .4; if (hash2(x * 5 + 3, y * 9 + 1) < .006) return WST.inkGlow; return v > .66 ? 0x34345a : v > .55 ? 0x26263e : WST.ink; };
  return { mine_pool: tile(pool), west_sand: tile(sand), west_street: tile(rut), west_boards: tile(boards), mine_rock: tile(rock), mine_rails: tile(rails), mine_boards: tile(mineBoards), mine_ink: tile(inkRock) };
}
LP_TILES = () => Object.assign({}, lpOlderTiles(), lpWestTiles());

// the walls by the legend's colour: boards (an interior: planks 6 px high, a skirting) and rock (the mine: rough bands)
LP_WALL = (c, a, y) => {
  if (c === WST.wallBoard) { if (y < 4) return y === 3 ? WST.seam : lpShade(WST.plankDk, .85); if (y % 6 === 0) return WST.seam; return hash2(Math.floor(a / 40), Math.floor(y / 6)) < .5 ? WST.wallBoard : lpShade(WST.wallBoard, .9); }
  if (c === WST.wallRock) { const v = hash2(Math.floor(a / 6), Math.floor(y / 5)); return v < .3 ? WST.rockDk : v < .8 ? WST.wallRock : WST.rockLt; }
  return lpOlderWall(c, a, y);
};

// ---- content/plugins/art/lowpoly/21-west-town.js
/* ---------- plugin, the low-poly page (index.html): Red Dust's things (Chapter 3), the town ---------- */
// A western thing is registered as a ship thing is (11-ship-kit.js): its model (LP_MODELS), a plain card of the same
// size for its collision (CODE_ART) and a pixel card build. Sizes in art px (16 to a unit): w across, h tall, d deep;
// each model fills its card (tools/test/westkit.test.mjs). Keys start west_: the village's barrel, crate and windmill
// keep theirs. A building front is a whole building seen from the street: its body, a false front, a porch under an
// awning at the front of its card, so an area places its door exit just in front of the card.
const WEST_KEYS = [];
function westThing(key, w, h, d, c, model) {
  WEST_KEYS.push(key); LP_MODELS[key] = model; BUILD[key] = 'pixel';
  CODE_ART[key] = () => { const p = new Pic(w, h), z = Math.round(d / 2); p.wall(0, 0, w, h, c, z, -z); return p.done(); };
}
// a window on a front at z: glass that glows at night, a frame standing proud of it, a sill
const westWindow = (m, x, y, w, h, z, lit) => {
  m.box(x - w / 2, y, z, x + w / 2, y + h, z + .4, lit === false ? WST.dark : WST.glass, { f: lit === false ? {} : { glow: 1 } });
  for (const [x0, x1] of [[x - w / 2 - 1, x - w / 2], [x + w / 2, x + w / 2 + 1]]) m.box(x0, y - 1, z, x1, y + h + 1, z + .9, WST.trim);
  m.box(x - w / 2, y + h, z, x + w / 2, y + h + 1, z + .9, WST.trim);
  m.box(x - w / 2 - 1.5, y - 1.6, z, x + w / 2 + 1.5, y - 1, z + 1.6, WST.trim);
  m.box(x - .4, y, z + .4, x + .4, y + h, z + .7, WST.trim);
};
// a door: a dark opening and its frame
const westDoor = (m, x, w, h, z, c) => {
  lpDoorAt(x);
  m.box(x - w / 2, 0, z, x + w / 2, h, z + .4, c || WST.dark);
  for (const [x0, x1] of [[x - w / 2 - 1.5, x - w / 2], [x + w / 2, x + w / 2 + 1.5]]) m.box(x0, 0, z, x1, h + 1.5, z + 1, WST.trim);
  m.box(x - w / 2 - 1.5, h, z, x + w / 2 + 1.5, h + 1.5, z + 1, WST.trim);
};
// a building seen from the street. o: { w, h (the body), front (the false front's height), d, porch (its depth), c (the
// paint), awning (colour), postH }. The facade's plane is at zf; returns it so the caller adds windows, doors, a sign
const westFront = (m, o) => {
  const W = o.w / 2, D = o.d / 2, zf = D - Math.max(o.porch, 2) - 2, c = o.c;   // (no porch: two px left for what stands proud of the front)
  m.box(-W + 1, 0, -D, W - 1, o.h, zf, lpShade(c, .86), { top: WST.tinDk });   // the body behind the front
  m.box(-W, 0, zf, W, o.front, zf + 2, c, { top: lpShade(c, 1.08) });             // the false front
  m.box(-W - .5, o.front, zf - .5, W + .5, o.front + 2, zf + 2.6, WST.trim);       // its cornice
  for (const x of [-W, W - 2]) m.box(x, 0, zf + 2, x + 2, o.front, zf + 2.6, lpShade(c, .8));   // corner boards
  if (o.porch > 0) {
    const ph = o.postH || 38;
    for (const x of [-W + 1, -1, W - 3]) m.box(x, 0, D - 2, x + 2, ph, D, WST.plankDk);
    m.prism([[zf + 2, ph + 7], [D, ph], [D, ph - 1.5], [zf + 2, ph + 5.5]], 'x', -W, W, o.awning || WST.tin);
  }
  return zf + 2;
};

// the saloon: two storeys under a tall false front, swing doors, a balcony over the porch, a long sign
westThing('west_saloon', 128, 108, 64, WST.red, () => {
  const m = new LPM(), z = westFront(m, { w: 128, h: 84, front: 104, d: 64, porch: 14, c: WST.red, awning: WST.plankLt, postH: 40 });
  westDoor(m, 0, 20, 34, z, WST.dark);
  for (const s of [-1, 1]) m.box(s < 0 ? -9 : 1, 8, z + .4, s < 0 ? -1 : 9, 26, z + 1.2, WST.plankLt);   // the swing doors
  for (const x of [-40, -22, 22, 40]) westWindow(m, x, 10, 10, 18, z, true);
  for (const x of [-40, -14, 14, 40]) westWindow(m, x, 56, 10, 16, z, x % 28 !== 0);
  m.box(-56, 86, z, 56, 98, z + 1.4, WST.ochre, { top: lpShade(WST.ochre, 1.1) });   // the sign board
  m.box(-52, 89, z + 1.4, 52, 95, z + 1.8, WST.dark);
  m.box(-60, 47, z, 60, 49, z + 13, WST.plank);   // the balcony's rail over the awning
  return m;
});
// the store: one storey, a wide window either side of the door, a striped awning
westThing('west_store', 96, 86, 56, WST.teal, () => {
  const m = new LPM(), z = westFront(m, { w: 96, h: 60, front: 82, d: 56, porch: 12, c: WST.teal, awning: WST.white, postH: 36 });
  westDoor(m, 0, 16, 32, z);
  for (const x of [-30, 30]) westWindow(m, x, 8, 22, 20, z, true);
  m.box(-36, 64, z, 36, 76, z + 1.4, WST.white, { top: WST.white });
  for (let k = 0; k < 6; k++) m.box(-46 + k * 16, 34.4, 26, -38 + k * 16, 36, 28, WST.red);   // the awning's stripes at its edge
  return m;
});
// the sheriff's office: adobe and planks, a barred window, a tin star over the door
westThing('west_sheriff', 84, 76, 56, WST.adobe, () => {
  const m = new LPM(), z = westFront(m, { w: 84, h: 56, front: 70, d: 56, porch: 12, c: WST.adobe, awning: WST.plank, postH: 34 });
  westDoor(m, -14, 16, 32, z, WST.plankDk);
  westWindow(m, 20, 10, 18, 16, z, true);
  for (let k = 0; k < 4; k++) m.box(13 + k * 4.4, 10, z + .9, 14 + k * 4.4, 26, z + 1.6, WST.iron);   // the bars
  // the star: a pentagon and five points, standing proud of the front
  const sx = -14, sy = 48, R = 6, r = 2.6, P = (k, rr) => [sx + Math.sin(k * Math.PI / 5) * rr, sy + Math.cos(k * Math.PI / 5) * rr, z + 1.2];
  m.face([0, 2, 4, 6, 8].map((k) => P(k, r)), WST.ochre, { from: [sx, sy, z] });
  for (let k = 0; k < 10; k += 2) m.face([P(k - 1, r), P(k, R), P(k + 1, r)].map((p) => [p[0], p[1], z + 1.2]), WST.ochre, { from: [sx, sy, z] });
  return m;
});
// the church: white planks, a steeple with a pointed roof and a bell window, a round window over the door
westThing('west_church', 80, 150, 64, WST.white, () => {
  const m = new LPM(), z = westFront(m, { w: 80, h: 64, front: 76, d: 64, porch: 0, c: WST.white });
  westDoor(m, 0, 18, 36, z, WST.plankDk);
  westWindow(m, 0, 48, 10, 10, z, true);
  for (const x of [-26, 26]) westWindow(m, x, 14, 8, 24, z, true);
  m.box(-12, 78, z - 22, 12, 112, z, WST.white, { top: WST.trim });   // the tower
  m.box(-6, 94, z, 6, 106, z + .4, WST.dark);                          // the bell window
  m.frustum(0, z - 11, 16, 0, 112, 142, 4, WST.tinDk, { rot: Math.PI / 4, smooth: false, top: false });
  m.box(-.8, 142, z - 11.8, .8, 150, z - 10.2, WST.trim); m.box(-3, 145, z - 11.8, 3, 146.6, z - 10.2, WST.trim);   // the cross
  return m;
});
// the undertaker's: dark grey paint, a coffin stood by the door
westThing('west_undertaker', 72, 78, 56, WST.grey, () => {
  const m = new LPM(), z = westFront(m, { w: 72, h: 56, front: 74, d: 56, porch: 12, c: WST.grey, awning: WST.tinDk, postH: 34 });
  westDoor(m, -10, 16, 32, z);
  westWindow(m, 20, 12, 14, 16, z, false);
  m.prism([[18, 0], [24, 0], [25, 26], [21, 30], [17, 26]].map(([x, y]) => [x - 6, y]), 'z', z + 1, z + 5, WST.plankDk);   // the coffin
  return m;
});
// a small house: plank walls under a gable roof, a door, a window
westThing('west_house', 72, 70, 56, WST.plank, () => {
  const m = new LPM();
  m.box(-34, 0, -26, 34, 40, 26, WST.plank, { top: WST.plankDk });
  m.roof({ x0: -34, x1: 34, z0: -26, z1: 26, yE: 40, yR: 66, c: WST.tinDk, ridge: 'x', over: 2 });
  westDoor(m, -12, 14, 30, 26);
  westWindow(m, 14, 14, 14, 14, 26, true);
  return m;
});
// the water tower: four legs and their braces, a round tank of staves, a conical lid
westThing('west_water_tower', 52, 128, 52, WST.plank, () => {
  const m = new LPM();
  for (const [x, z] of [[-22, -22], [19, -22], [-22, 19], [19, 19]]) m.box(x, 0, z, x + 3, 74, z + 3, WST.plankDk);
  for (const y of [24, 52]) { m.box(-22, y, -21.2, 22, y + 2, -20.2, WST.plankDk); m.box(-22, y, 20.2, 22, y + 2, 21.2, WST.plankDk); m.box(-21.2, y, -22, -20.2, y + 2, 22, WST.plankDk); m.box(20.2, y, -22, 21.2, y + 2, 22, WST.plankDk); }
  m.box(-26, 74, -26, 26, 77, 26, WST.plank, { top: WST.plankLt });
  m.frustum(0, 0, 21, 21, 77, 108, 14, WST.plank, { top: WST.plankLt, col: (k) => (k % 2 ? WST.plank : WST.plankDk) });
  for (const y of [84, 98]) m.frustum(0, 0, 21.6, 21.6, y, y + 1.6, 14, WST.iron, { top: false });
  m.frustum(0, 0, 24, 0, 108, 128, 14, WST.tinDk, { top: false });
  return m;
});
// the windmill: a lattice tower, a wheel of blades facing the street, a tail vane
westThing('west_windmill', 44, 136, 40, WST.iron, () => {
  const m = new LPM();
  m.frustum(0, 0, 14, 4, 0, 104, 4, WST.ironLt, { smooth: false, top: WST.iron, rot: Math.PI / 4 });
  m.spin([0, 114, 12.75], 'z', .25, () => { for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2, xs = [Math.sin(a) * 4, Math.sin(a) * 20], ys = [114 + Math.cos(a) * 4, 114 + Math.cos(a) * 20]; m.box(Math.min(...xs) - 1, Math.min(...ys) - 1, 12, Math.max(...xs) + 1, Math.max(...ys) + 1, 13.5, k % 2 ? WST.white : WST.trim, { skip: ['bottom'] }); } });
  m.frustum(0, 13.6, 4, 4, 112, 116, 8, WST.iron, { top: WST.ironLt });
  m.box(-1.5, 110, -20.6, 1.5, 118, 12, WST.iron);
  m.box(-.6, 106, -20.6, .6, 124, -13, WST.red);
  return m;
});
// the stagecoach: a box body on four wheels, a driver's bench, luggage on the roof
westThing('west_stagecoach', 96, 60, 40, WST.red, () => {
  const m = new LPM();
  m.box(-36, 14, -16, 30, 44, 16, WST.red, { top: WST.plankDk });
  for (const x of [-26, 6]) m.box(x, 22, 16, x + 14, 36, 16.5, WST.dark, { f: {} });
  m.box(30, 22, -14, 46, 26, 14, WST.plankDk, { top: WST.plank });   // the bench's footboard
  m.box(30, 26, -14, 34, 34, 14, WST.plankDk);
  m.box(-30, 44, -12, 22, 52, 12, WST.ochre, { top: lpShade(WST.ochre, 1.1) });   // the luggage
  m.box(-48, 16, -12, -36, 34, 12, WST.plankDk, { top: WST.plank });   // the rack at the back
  // a wheel: an iron tyre on a ring of 14 pieces, six ochre spokes, an iron hub standing out (a solid disc read as a rock)
  const wheel = (x, z, r) => {
    const at = (a, d) => [x + Math.sin(a) * d, r + Math.cos(a) * d], N = 14, ri = r - 2.2;
    for (let k = 0; k < N; k++) { const a0 = k / N * Math.PI * 2, a1 = (k + 1) / N * Math.PI * 2; m.prism([at(a0, ri), at(a0, r), at(a1, r), at(a1, ri)], 'z', z, z + 3, WST.iron); }
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + .3, s = Math.cos(a), c = -Math.sin(a), w = .9, [x0, y0] = at(a, 2), [x1, y1] = at(a, ri); m.prism([[x0 - s * w, y0 - c * w], [x1 - s * w, y1 - c * w], [x1 + s * w, y1 + c * w], [x0 + s * w, y0 + c * w]], 'z', z + .8, z + 2.2, WST.ochre); }
    m.prism(Array.from({ length: 8 }, (_, k) => at(k / 8 * Math.PI * 2, 2.6)), 'z', z - .6, z + 3.6, WST.iron, { cap: WST.ironLt });
  };
  for (const z of [-20, 17]) { wheel(-26, z, 13); wheel(22, z, 11); }
  m.box(46, 18, -2, 48, 20, 2, WST.plankDk);
  return m;
});
// a hitching post: two posts and a rail
westThing('west_hitch', 40, 18, 6, WST.plankDk, () => { const m = new LPM(); for (const x of [-20, 17]) m.box(x, 0, -3, x + 3, 16, 3, WST.plankDk); m.box(-20, 14, -2.5, 20, 18, 2.5, WST.plank); return m; });
// a barrel of staves and two iron hoops
westThing('west_barrel', 18, 22, 18, WST.plank, () => { const m = new LPM(); m.lathe(0, 0, [[8, 0], [9, 11], [8, 22]], 12, WST.plank, { top: WST.plankLt, col: (b, k) => (k % 2 ? WST.plank : WST.plankDk) }); for (const y of [4, 17]) m.frustum(0, 0, 8.7, 8.7, y, y + 1.4, 12, WST.iron, { top: false }); return m; });
// a crate of planks with a cross brace
westThing('west_crate', 20, 18, 20, WST.plankLt, () => { const m = new LPM(); m.box(-10, 0, -10, 10, 18, 10, WST.plankLt, { top: WST.plank }); m.face([[-9, 1, 10.3], [-7, 1, 10.3], [9, 16, 10.3], [7, 16, 10.3]], WST.plankDk, { from: [0, 9, 0] }); return m; });
// a water trough on legs
westThing('west_trough', 40, 12, 14, WST.plankDk, () => { const m = new LPM(); m.box(-20, 2, -7, 20, 12, 7, WST.plankDk, { top: WST.plank }); m.box(-18, 10.5, -5, 18, 12.2, 5, WST.water, { f: { glow: 0 } }); return m; });
// a tall saguaro with two arms
westThing('west_cactus', 30, 56, 10, WST.cactus, () => {
  const m = new LPM(); m.frustum(0, 0, 5, 4, 0, 56, 8, WST.cactus, { top: WST.cactusDk });
  m.box(-15, 22, -2.5, -4, 26, 2.5, WST.cactus); m.frustum(-13, 0, 2.5, 2.5, 26, 40, 6, WST.cactus, { top: WST.cactusDk });
  m.box(4, 30, -2.5, 15, 34, 2.5, WST.cactus); m.frustum(13, 0, 2.5, 2.5, 34, 46, 6, WST.cactus, { top: WST.cactusDk });
  return m;
});
// a prickly pear: flat pads in a clump
westThing('west_cactus_small', 22, 18, 16, WST.cactus, () => { const m = new LPM(); for (const [x, y, z, r] of [[-5, 6, 0, 6], [5, 7, 2, 6], [0, 13, -1, 5]]) m.blob(x, y, z, r, WST.cactus, { sz: .4, facet: true, seed: x + 9 }); m.box(-11, 0, -8, 11, 1, 8, WST.sandDk); return m; });
// a big rock, faceted
westThing('west_rock', 43, 26, 34, WST.rock, () => { const m = new LPM(); m.blob(0, 11, 0, 17, WST.rockLt, { sx: 1.15, sy: .8, sz: .95, facet: true, seed: 5, flat: 0 }); return m; });
// a mesa's edge: stepped rock that closes the map
westThing('west_mesa', 64, 96, 48, WST.rock, () => {
  const m = new LPM();
  m.box(-32, 0, -24, 32, 60, 24, WST.rock, { top: WST.rockLt, left: WST.rockDk, right: WST.rockDk });
  m.box(-28, 60, -20, 26, 84, 18, WST.adobeDk, { top: WST.adobe });
  m.box(-20, 84, -14, 18, 96, 12, WST.rockLt, { top: WST.sand });
  for (const y of [18, 40]) m.box(-32.5, y, -24.5, 32.5, y + 3, 24.5, WST.rockDk, { skip: ['bottom', 'top'] });
  return m;
});
// the wanted board: a board on two posts, three posters (no faces: plain paper with a dark square)
westThing('west_wanted', 40, 38, 6, WST.plank, () => {
  const m = new LPM(); for (const x of [-18, 15]) m.box(x, 0, -3, x + 3, 38, 0, WST.plankDk);
  m.box(-20, 14, 0, 20, 36, 2, WST.plank);
  for (const x of [-15, -3, 9]) { m.box(x, 17, 2, x + 9, 32, 2.5, WST.white); m.box(x + 2, 24, 2.5, x + 7, 30, 2.8, WST.grey); }
  return m;
});
// a lamp post with a glass lantern that glows
westThing('west_lamp', 10, 44, 10, WST.iron, () => { const m = new LPM(); m.box(-1.2, 0, -1.2, 1.2, 34, 1.2, WST.iron); m.box(-5, 0, -5, 5, 2, 5, WST.iron, { top: WST.ironLt }); m.box(-3.5, 34, -3.5, 3.5, 42, 3.5, WST.glass, { f: { glow: 1 } }); m.box(-4.5, 42, -4.5, 4.5, 44, 4.5, WST.iron); return m; });

/* interiors */
// the bar: a counter with a top and a brass foot rail
westThing('west_bar', 96, 30, 20, WST.plankDk, () => { const m = new LPM(); m.box(-48, 0, -8, 48, 26, 8, WST.plankDk); m.box(-48, 26, -10, 48, 30, 10, WST.plankLt, { top: WST.plank }); m.box(-46, 4, 8, 46, 6, 10, WST.ochre); return m; });
// a round saloon table with a bottle
westThing('west_table', 28, 26, 28, WST.plank, () => { const m = new LPM(); m.frustum(0, 0, 3, 3, 0, 16, 6, WST.plankDk, { top: false }); m.frustum(0, 0, 14, 14, 16, 18, 12, WST.plank, { top: WST.plankLt }); m.frustum(5, 2, 1.6, 1.6, 18, 26, 6, 0x3a5a2a, { top: WST.dark }); return m; });
// an upright piano with its keys
westThing('west_piano', 48, 40, 20, WST.dark, () => { const m = new LPM(); m.box(-24, 0, -10, 24, 40, 2, WST.dark, { top: WST.black }); m.box(-22, 18, 2, 22, 22, 10, WST.dark, { top: WST.white }); m.box(-20, 22, 2, 20, 23, 6, WST.black); return m; });
// the sheriff's desk with papers and a lamp
westThing('west_desk', 44, 26, 22, WST.plank, () => { const m = new LPM(); m.box(-22, 0, -11, 22, 16, 11, WST.plank, { top: WST.plankLt }); m.box(-14, 16, -4, -2, 16.6, 6, WST.white); m.box(10, 16, -6, 16, 26, 0, WST.glass, { f: { glow: 1 } }); return m; });
// the jail cell's front: a frame and iron bars (solid across: an area keeps the cat out)
westThing('west_cell', 56, 56, 8, WST.iron, () => {
  const m = new LPM(); m.box(-28, 0, -4, 28, 3, 4, WST.iron, { top: WST.ironLt }); m.box(-28, 53, -4, 28, 56, 4, WST.iron, { top: WST.ironLt });
  for (let k = 0; k <= 10; k++) m.box(-27 + k * 5.2, 3, -1, -25.6 + k * 5.2, 53, 1, WST.iron);
  for (const x of [-28, 25]) m.box(x, 3, -4, x + 3, 53, 4, WST.ironLt);
  return m;
});
// a gun rack on the wall: a board, two rifles (at the back of its card: placed against a wall, it hangs on it)
westThing('west_gunrack', 40, 40, 4, WST.plankDk, () => { const m = new LPM(); m.box(-20, 4, -2, 20, 40, 0, WST.plankDk); for (const x of [-10, 4]) { m.box(x, 8, 0, x + 2, 36, 1.5, WST.iron); m.box(x - 1, 8, 0, x + 3, 18, 2, WST.plank); } return m; });
// a shelf of bottles behind the bar (wall-backed)
westThing('west_shelf', 64, 44, 8, WST.plankDk, () => {
  const m = new LPM(); m.box(-32, 0, -4, 32, 44, -2, WST.plankDk);
  for (const y of [14, 28]) m.box(-32, y, -2, 32, y + 2, 4, WST.plank, { top: WST.plankLt });
  for (let k = 0; k < 10; k++) m.frustum(-27 + k * 6, 0, 1.6, 1.4, 16 + (k % 2) * 14, 23 + (k % 2) * 14, 6, [0x3a5a2a, 0x6a3a1a, 0x8a8a8a][k % 3], { top: WST.dark });
  return m;
});

// ---- content/plugins/art/lowpoly/22-west-mine.js
/* ---------- plugin, the low-poly page (index.html): Red Dust's things (Chapter 3), the mine ---------- */
// The mine's yard and its first level (westThing: 21-west-town.js). A wall thing stands at the back of its card, so
// placed against a wall it hangs on it. The lanterns glow; the area's lamps (baked into the ground and the walls) give
// their light.

// the headframe over the shaft: two A-frame legs, braces, a sheave wheel on top, a cable down
westThing('west_headframe', 84, 150, 48, WST.plankDk, () => {
  const m = new LPM();
  for (const z of [-24, 20]) {
    m.prism([[-42, 0], [-36, 0], [-3, 136], [-7, 136]], 'z', z, z + 4, WST.plankDk);
    m.prism([[36, 0], [42, 0], [7, 136], [3, 136]], 'z', z, z + 4, WST.plankDk);
    for (const y of [40, 88]) { const half = 38.5 - y * .25; m.box(-half, y, z + .5, half, y + 3, z + 3.5, WST.plank); }
  }
  m.box(-8, 136, -24, 8, 138, 24, WST.plank, { top: WST.plankLt });
  m.prism(Array.from({ length: 12 }, (_, k) => [Math.sin(k / 12 * Math.PI * 2) * 6, 144 + Math.cos(k / 12 * Math.PI * 2) * 6]), 'z', -1.5, 1.5, WST.iron);
  m.box(-.6, 30, -.6, .6, 138, .6, WST.ironLt);
  return m;
});
// an ore cart on its wheels, rock heaped inside
westThing('west_cart', 30, 24, 20, WST.iron, () => {
  const m = new LPM();
  m.prism([[-15, 6], [15, 6], [13, 20], [-13, 20]].map(([x, y]) => [x, y]), 'z', -10, 10, WST.iron, {});
  m.blob(0, 20, 0, 9, WST.rockLt, { sy: .45, sz: .9, facet: true, seed: 3 });
  for (const x of [-9, 9]) for (const z of [-10.5, 8.5]) m.prism(Array.from({ length: 8 }, (_, k) => [x + Math.sin(k / 8 * Math.PI * 2) * 4, 4 + Math.cos(k / 8 * Math.PI * 2) * 4]), 'z', z, z + 2, WST.dark);
  return m;
});
// a timber post against the tunnel wall, a beam stub over the tunnel (wall-backed)
westThing('west_post', 16, 60, 12, WST.plankDk, () => { const m = new LPM(); m.box(-8, 0, -6, -2, 56, 0, WST.plankDk); m.box(-8, 52, -6, 8, 60, 6, WST.plank, { top: WST.plankLt }); return m; });
// a lantern on its hook post: it glows (wall-backed)
westThing('west_lantern', 8, 44, 8, WST.iron, () => {
  const m = new LPM(); m.box(-4, 0, -4, -2, 40, -2, WST.plankDk); m.box(-4, 38, -4, 1, 40, -2, WST.iron);
  m.box(-2, 28, -2, 3, 36, 3, WST.glass, { f: { glow: 1 } }); m.box(-2.5, 36, -2.5, 3.5, 37.5, 3.5, WST.iron); m.box(-2.5, 26.5, -2.5, 3.5, 28, 3.5, WST.iron);
  return m;
});
// rubble: rocks fallen in a heap
westThing('west_rubble', 44, 22, 32, WST.rock, () => { const m = new LPM(); for (const [x, z, r, s] of [[-12, -4, 7.5, 1], [6, 2, 7.5, 2], [-2, -8, 7, 3], [14, -6, 6.5, 4], [-14, 8, 6.5, 5]]) m.blob(x, r * .95, z, r, [WST.rock, WST.rockLt, WST.rockDk][s % 3], { sy: .8, facet: true, seed: s }); m.box(-22, 0, -16, 22, 1, 16, WST.rockDk); return m; });
// the lift cage: a frame of iron, bars on three sides, a roof, the cable up (solid across: its exit stands before it)
westThing('west_lift', 48, 72, 40, WST.iron, () => {
  const m = new LPM();
  m.box(-24, 0, -20, 24, 3, 20, WST.plankDk, { top: WST.plank });
  for (const [x, z] of [[-24, -20], [21, -20], [-24, 17], [21, 17]]) m.box(x, 3, z, x + 3, 64, z + 3, WST.iron);
  for (let k = 1; k < 8; k++) { m.box(-21 + k * 5, 3, -19.5, -20 + k * 5, 64, -18.5, WST.ironLt); m.box(-23.5, 3, -18 + k * 4.5, -22.5, 64, -17 + k * 4.5, WST.ironLt); m.box(22.5, 3, -18 + k * 4.5, 23.5, 64, -17 + k * 4.5, WST.ironLt); }
  m.box(-24, 64, -20, 24, 68, 20, WST.iron, { top: WST.ironLt });
  m.box(-1, 68, -1, 1, 72, 1, WST.ironLt);
  m.box(-20, 30, 18, 20, 33, 20, WST.ochre);   // the gate's bar
  return m;
});
// a crate of dynamite: red sticks bundled on top
westThing('west_dynabox', 22, 20, 18, WST.plankLt, () => { const m = new LPM(); m.box(-11, 0, -9, 11, 14, 9, WST.plankLt, { top: WST.plank }); for (let k = 0; k < 5; k++) m.frustum(-8 + k * 4, 0, 1.6, 1.6, 14, 20, 6, WST.red, { top: WST.trim }); return m; });
// the black vein in the rock: ink seeping from a crack, its edge glowing faintly violet (wall-backed)
westThing('west_vein', 40, 48, 6, WST.ink, () => {
  const m = new LPM(); m.box(-20, 0, -3, 20, 48, -1, WST.rockDk);
  m.face([[-4, 2, -.6], [5, 2, -.6], [9, 46, -.6], [-8, 46, -.6]], WST.ink, { from: [0, 24, -3] });
  m.face([[-6, 18, -.4], [-1, 18, -.4], [-3, 40, -.4]], WST.inkGlow, { from: [0, 24, -3], glow: 1 });
  m.face([[3, 8, -.4], [7, 8, -.4], [6, 26, -.4]], WST.inkGlow, { from: [0, 24, -3], glow: 1 });
  m.box(-16, 0, -3, 16, 3, 3, WST.ink);
  return m;
});

// ---- content/plugins/art/lowpoly/23-west-deep.js
/* ---------- plugin, the low-poly page (index.html): Red Dust's things (Chapter 3), the deep mine and the undertaker's ---------- */
// The flooded level, the vein's cavern and the undertaker's house (westThing: 21-west-town.js). Flat things walked over
// or across (the ink pools, the blasted collapse) are placed with "box": [0, 0]; wall things stand at the back of their
// card, so placed against a wall they lie on it.

// a regular polygon of n corners, rx across and rz deep, at height y (for flat shapes on the floor)
const westDisc = (n, rx, rz, y, cx = 0, cz = 0, a0 = 0) => Array.from({ length: n }, (_, i) => { const a = a0 + i / n * Math.PI * 2; return [cx + Math.cos(a) * rx, y, cz + Math.sin(a) * rz]; });
// the same upright, on a wall plane z (an eye, a head)
const westDiscZ = (n, rx, ry, cx, cy, z) => Array.from({ length: n }, (_, i) => { const a = i / n * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z]; });

// a pool of ink on the rock floor: glossy black, its rim glowing faintly violet
westThing('west_ink_pool', 48, 1, 40, WST.ink, () => {
  const m = new LPM();
  m.face(westDisc(10, 24, 20, .2), WST.inkGlow, { from: [0, -1, 0], glow: 1 });
  m.face(westDisc(10, 20, 16, .5, 0, 0, .3), WST.ink, { from: [0, -1, 0] });
  m.face(westDisc(6, 6, 4, .8, -5, -3), 0x2a2a44, { from: [0, -1, 0] });   // a sheen
  return m;
});
// a miner's shape in ink on the rock, his pick raised (wall-backed); nobody drew it
westThing('west_silhouette', 28, 48, 2, WST.ink, () => {
  const m = new LPM(), z = -.6, F = (p, c, o) => m.face(p, c, Object.assign({ from: [0, 24, -2] }, o || {}));
  F(westDiscZ(8, 4.5, 4.5, -2, 40, z), WST.ink);                                     // the head
  F([[-7, 14, z], [3, 14, z], [4, 34, z], [-8, 34, z]], WST.ink);                    // the body
  F([[-7, 0, z], [-4, 0, z], [-3, 14, z], [-6, 14, z]], WST.ink); F([[0, 0, z], [3, 0, z], [3, 14, z], [0, 14, z]], WST.ink);   // the legs
  F([[3, 30, z], [6, 30, z], [12, 44, z], [9, 45, z]], WST.ink);                     // the arm up
  F([[6, 46, z], [14, 41, z], [14, 43, z], [8, 48, z]], WST.ink); F([[8, 40, z], [10, 39, z], [13, 46, z], [11, 47, z]], WST.ink);   // the pick
  F([[-14, 0, -.9], [14, 0, -.9], [12, 2, -.9], [-12, 2, -.9]], WST.inkGlow, { glow: 1 });   // ink pooled at his feet
  return m;
});
// a collapse: rock and broken timber filling a two-cell tunnel (solid)
westThing('west_collapse', 64, 44, 28, WST.rock, () => {
  const m = new LPM();
  m.box(-32, 0, -14, 32, 1, 14, WST.rockDk);
  for (const [x, y, z, r, s] of [[-20, 9.5, -4, 9, 1], [0, 10.5, 0, 10, 2], [20, 9.5, 3, 9, 3], [-10, 22, -2, 9, 4], [10, 22, 2, 9, 5], [0, 33, 0, 8, 6], [-22, 20, 6, 6, 7], [22, 21, -6, 6, 8]])
    m.blob(x, y, z, r, [WST.rock, WST.rockLt, WST.rockDk][s % 3], { sy: .85, facet: true, seed: s, sub: 1 });
  m.prism([[-28, 30], [-24, 30], [14, 6], [10, 6]], 'z', 9, 13, WST.plankDk);        // a fallen beam
  m.prism([[18, 40], [22, 40], [26, 2], [22, 2]], 'z', -12, -8, WST.plank);          // a broken post
  return m;
});
// the collapse blasted: low rubble left at the tunnel's sides, the middle clear (walked through: box [0, 0])
westThing('west_collapse_open', 64, 14, 28, WST.rock, () => {
  const m = new LPM();
  m.box(-32, 0, -14, 32, .6, 14, WST.rockDk);
  for (const [x, z, r, s] of [[-26, -6, 6, 1], [-24, 7, 5, 2], [26, 5, 6, 3], [24, -7, 5, 4], [-14, 10, 3.5, 5], [15, -10, 3.5, 6]]) m.blob(x, r * .8, z, r, [WST.rock, WST.rockLt, WST.rockDk][s % 3], { sy: .7, facet: true, seed: s });
  m.prism([[-10, 2], [12, 2], [12, 4], [-10, 4]], 'z', 4, 7, WST.plankDk);           // a splintered plank across
  return m;
});
// a stalagmite, a smaller one at its foot
westThing('west_stalagmite', 16, 36, 16, WST.rock, () => {
  const m = new LPM();
  m.frustum(0, 0, 8, 0, 0, 34, 7, WST.rock, { smooth: false, col: (k) => (k % 2 ? WST.rock : WST.rockLt) });
  m.frustum(4.5, 4.5, 3, 0, 0, 14, 5, WST.rockDk, { smooth: false });
  return m;
});
// an ore cart tipped over in a pool of ink, its rock spilled
westThing('west_flooded_cart', 40, 20, 28, WST.iron, () => {
  const m = new LPM();
  m.face(westDisc(10, 20, 14, .3), WST.ink, { from: [0, -1, 0] });
  m.prism([[-14, 1], [12, 1], [16, 16], [-10, 19]], 'z', -9, 7, WST.iron);           // the cart on its side
  m.box(-13, 1, 7, 13, 12, 8, WST.dark);                                              // its open mouth
  for (const [x, z, r, s] of [[-6, 11, 3, 1], [3, 12, 2.5, 2], [10, 10, 2.5, 3]]) m.blob(x, r * .8, z, r, WST.rockLt, { sy: .7, facet: true, seed: s });
  m.frustum(-10, -11, 3.5, 3.5, 4, 6, 8, WST.dark, { smooth: false });               // a wheel in the air
  return m;
});
// the vein's heart on the cavern's north wall: a black eye in the rock, its iris glowing violet (wall-backed)
westThing('west_vein_big', 94, 76, 6, WST.ink, () => {
  const m = new LPM(), F = (p, c, o) => m.face(p, c, Object.assign({ from: [0, 48, -4] }, o || {}));
  const eye = Array.from({ length: 14 }, (_, i) => { const a = i / 14 * Math.PI * 2; return [Math.cos(a) * 46, 52 + Math.sin(a) * 21, -1.6]; });
  F(eye, WST.ink);
  F(westDiscZ(12, 15, 15, 0, 52, -1.2), WST.inkGlow, { glow: 1 });                   // the iris
  F(westDiscZ(8, 6, 11, 0, 52, -.8), WST.ink);                                        // the pupil, slit
  for (const [x, w] of [[-30, 5], [-8, 4], [14, 6], [34, 4]]) F([[x - w / 2, 2, -1.6], [x + w / 2, 2, -1.6], [x + w / 4, 34, -1.6], [x - w / 4, 34, -1.6]], WST.ink);   // drips down
  m.box(-40, 0, -3, 40, 2, 1, WST.ink, { top: 0x2a2a44 });                            // the ink pooled below
  return m;
});
// an ink tendril out of the floor
westThing('west_tendril', 12, 32, 12, WST.ink, () => {
  const m = new LPM();
  m.frustum(0, 0, 6, 2, 0, 18, 7, WST.ink, { smooth: false, top: false });
  m.frustum(1, 1, 2, 0, 18, 30, 5, WST.inkGlow, { smooth: false, glow: 1 });
  return m;
});
// a strongbox (a chest: drawn spent once opened)
westThing('west_strongbox', 28, 20, 20, WST.iron, () => {
  const m = new LPM();
  m.box(-14, 0, -9, 14, 16, 9, WST.iron, { top: WST.ironLt });
  for (const x of [-10, 8]) m.box(x, 0, -9.6, x + 2, 16.6, 9.6, WST.dark, { skip: ['bottom', 'back'] });   // the bands
  m.box(-3, 8, 9.6, 3, 13, 10.4, WST.ochre);                                         // the lock
  m.box(-13, 16, -8, 13, 18, 8, lpShade(WST.iron, .9));                               // the lid's lip
  return m;
});
// a diary page pinned to a stake (a chest: the page taken, the stake left)
westThing('west_diary', 12, 32, 6, WST.plankDk, () => {
  const m = new LPM();
  m.box(-2, 0, -3.5, 2, 30, .5, WST.plankDk, { top: WST.plank });
  m.box(-5, 16, .5, 5, 28, 1, WST.white, { f: { glow: 1 } });                         // the page, pale in the dark
  m.box(-.6, 26, 1, .6, 27, 1.6, WST.iron);                                           // the nail
  return m;
});
// a coffin lying on the floor
westThing('west_coffin', 20, 12, 44, WST.plank, () => {
  const m = new LPM();
  m.prism([[-8, 0], [8, 0], [10, 9], [-10, 9]], 'z', -22, 22, WST.plank);
  m.box(-9, 9, -21, 9, 11, 21, WST.plankDk, { top: WST.plank });
  m.box(-1, 11, -12, 1, 11.6, 4, WST.trim); m.box(-5, 11, -6, 5, 11.6, -4, WST.trim);   // a cross on the lid
  return m;
});
// a coffin stood up against the wall (wall-backed)
westThing('west_coffin_up', 22, 48, 12, WST.plank, () => {
  const m = new LPM();
  m.prism([[-8, 0], [8, 0], [11, 32], [6, 46], [-6, 46], [-11, 32]], 'z', -6, 4, WST.plank);
  m.box(-6, 4, 4, 6, 40, 5, WST.plankDk);
  return m;
});
// the undertaker's wall: dozens of eyes drawn in ink with a finger, all turned toward the mine (wall-backed)
westThing('west_stained_wall', 56, 44, 2, WST.ink, () => {
  const m = new LPM(), F = (p, c, o) => m.face(p, c, Object.assign({ from: [0, 22, -2] }, o || {}));
  F([[-28, 4, -.9], [28, 4, -.9], [28, 44, -.9], [-28, 44, -.9]], lpShade(WST.white, .8));   // the plaster
  for (const [x, y, s] of [[-20, 34, 1], [-6, 38, .8], [10, 33, 1.1], [22, 39, .7], [-16, 20, .9], [2, 22, 1.2], [18, 18, .8], [-24, 10, .7], [-4, 9, .8], [14, 8, .9]]) {
    F(Array.from({ length: 8 }, (_, i) => { const a = i / 8 * Math.PI * 2; return [x + Math.cos(a) * 6 * s, y + Math.sin(a) * 2.6 * s, -.6]; }), WST.ink);
    F(westDiscZ(6, 1.4 * s, 1.6 * s, x + 2 * s, y, -.3), WST.inkGlow, { glow: 1 });  // the pupils, all looking the same way
  }
  return m;
});
// the undertaker's workbench: planks, a saw, a pot of black paint
westThing('west_workbench', 40, 24, 20, WST.plank, () => {
  const m = new LPM();
  m.box(-20, 16, -10, 20, 20, 10, WST.plank, { top: WST.plankLt });
  for (const x of [-18, 15]) for (const z of [-9, 6]) m.box(x, 0, z, x + 3, 16, z + 3, WST.plankDk);
  m.box(-12, 20, -4, 4, 21.5, 2, WST.plankLt);                                        // a board on top
  m.prism([[6, 20], [16, 20], [16, 23], [8, 22]], 'z', -6, -5, WST.ironLt);           // the saw
  m.frustum(12, 5, 3, 3, 20, 24, 8, WST.black, { top: WST.ink });                     // the paint pot
  return m;
});

// ---- content/plugins/behaviours/blot_scribe.js
/* ---------- plugin: the Blot Scribe's own behaviour (content/chapter1/enemies.json: "behaviour": "blot_scribe") ---------- */
// Phase 1 sweeps its quill and draws ink lines; below half health it splits off Blots and calls ink rain. Every attack
// is announced: the quill drawn back, ink marks on the floor 0.6 s before they burst. A boss is a small program, so it
// stays code: it drives the engine's combat (hazard, spawnEnemy, hurtHero, fx) as the content script did.
BEHAVIOURS.blot_scribe = {
  onHit(e) { if (!e.phase2 && e.hp < e.T.hp / 2) { e.phase2 = true; e.state = 'split'; e.st = .9; e.a.anim = 'split'; e.a.at = 0; toast(t('toast.boss2')); shake(.3); } },
  ai(e, dt, dist, move, face) {
    const T = e.T, a = e.a; e.cool = (e.cool || 1.5) - dt;   // (e.st and a.at run in enemiesStep: counted here too, they ran twice as fast)
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
      case 'windup': face(player.x, player.z); if (e.st <= 0) { e.state = 'sweep'; e.st = .4; a.anim = 'attack'; a.at = 0; e.hit = 0; sfx('swing3'); } break;
      case 'sweep': {   // a half-circle in front, quill's length
                if (!e.hit) { e.hit = 1; fx('slash', e.x + e.fx * 1.6, e.z + e.fz * 1.6, { size: 2.4, y: A.groundY(e.x, e.z) + .6 }); const dx = player.x - e.x, dz = player.z - e.z, d = Math.hypot(dx, dz); if (d < T.reach + .4 && (dx * e.fx + dz * e.fz) / (d || 1) > -.1) hurtHero(T.atk, e.x, e.z); }
        if (e.st <= 0) { e.state = 'chase'; e.cool = e.phase2 ? 1.2 : 1.7; }
        break;
      }
      case 'lines': {   // a line of marks from the Scribe toward the cat
                if (!e.done && e.st < .6) { e.done = true; const l = dist || 1, ux = (player.x - e.x) / l, uz = (player.z - e.z) / l; for (let i = 1; i <= 6; i++) hazard(e.x + ux * i * 1.3, e.z + uz * i * 1.3, .6 + i * .07, .8, T.atk - 2); }
        if (e.st <= 0) { e.state = 'chase'; e.cool = 1.6; }
        break;
      }
      case 'rain': {   // marks around and under the cat
                if (!e.done && e.st < .6) { e.done = true; hazard(player.x, player.z, .7, .9, T.atk - 2); for (let i = 0; i < 6; i++) { const an = R() * Math.PI * 2, r = 1.5 + R() * 3.5; hazard(player.x + Math.cos(an) * r, player.z + Math.sin(an) * r, .6 + R() * .5, .9, T.atk - 2); } }
        if (e.st <= 0) { e.state = 'chase'; e.cool = 1.4; }
        break;
      }
      case 'split': {   // phase 2 and then every so often: two Blots, never more than four
        a.anim = 'split';
        if (e.st <= 0) { if (enemies.filter((o) => o.type === 'blot' && o.hp > 0).length < 4) for (const s of [-1, 1]) { const b = spawnEnemy('blot', e.x + s * 1.6, e.z + 1.2); b.aware = true; b.T = Object.assign({}, b.T, { coins: [0, 0], xp: 1, drops: [] }); } e.state = 'chase'; e.cool = 1.2; e.splitT = 9; }
        break;
      }
    }
    if (e.phase2 && e.state === 'chase' && (e.splitT = (e.splitT || 9) - dt) <= 0) { e.state = 'split'; e.st = .8; a.anim = 'split'; a.at = 0; }
    return true;
  },
};

// ---- content/plugins/behaviours/ink_outlaw.js
/* ---------- plugin: the Ink Outlaw, Chapter 3's boss (content/chapter3/enemies.json: "behaviour": "ink_outlaw") ---------- */
// The gang's leader, fused with the vein, in the black cavern under the mine. Three phases, read from his health every
// tick (so a fight begun at any health plays that phase: tools/fair-check.mjs's "hpAt"):
//   the duel (over 2/3)  bursts of three along a red line, rolls aside, a fan of three up close (a dodge aside clears it)
//   the vein (over 1/3)  lines of ink tendrils from the ground toward the cat (their marks are the tell), a crawler called
//                        out of the ink now and then (never more than two of his), a burst when none is about
//   the dark             the lights go down (lookDim): a quick-draw, his eyes glinting under one red line, then a single
//                        fast round; tendrils between draws
// Every tell is the state 'windup' with e.kind (as the lieutenant's), its target frozen at its start; a recover after every
// attack; never two at once. On his defeat the light comes back and his crawlers go with him.
const IO_FAN = [-.45, 0, .45], IO_BURST = 3, IO_GAP = .16, IO_QUICK = 15;
const IO_PICK = {   // per phase: [kind, weight]
  1: [['burst', 4], ['fan', 3], ['roll', 3]],
  2: [['tendril', 4], ['summon', 2], ['burst', 2], ['fan', 1]],
  3: [['quick', 5], ['tendril', 3], ['fan', 1]],
};
const ioMinions = () => enemies.filter((o) => o.minion && o.hp > 0).length;
BEHAVIOURS.ink_outlaw = {
  onDefeat(e) {
    lookDim(1); for (const h of hazards) if (h.f) h.f.dispose(); hazards.length = 0;   // (the marks with them: none left glowing that never bursts)
    dropFoeShots();   // (his rounds in the air too: no death after the win)
    for (const o of enemies) if (o.minion && o.hp > 0) { o.hp = 0; dropTells(o); setState(o, 'defeat', .55); o.a.anim = 'defeat'; }
  },
  ai(e, dt, dist, move, face) {
    const T = e.T, a = e.a, f = e.hp / T.hp, phase = f > 2 / 3 ? 1 : f > 1 / 3 ? 2 : 3, sees = A.clear(e.x, e.z, player.x, player.z);
    if (phase !== e.phase) { if (e.phase) { toast(t('red.toast.out' + phase)); shake(.35); sfx('slam'); } e.phase = phase; }
    if (phase === 3 && !hero.dead) lookDim(.18);   // (every tick: a fight begun again finds the dark again)
    e.aware = true; e.cool = (e.cool ?? 1.4) - dt; e.summonT = (e.summonT ?? 0) - dt;
    switch (e.state) {
      case 'windup':
        if (hero.dead && e.st <= 0) { tellFan(e, [], false); tellLine(e, false); setState(e, 'recover', .6); return true; }   // (the cat fallen: nothing fired)
        face(e.tx, e.tz);
        if (e.kind === 'fan') tellFan(e, IO_FAN, true); else if (e.kind === 'burst' || e.kind === 'quick') tellLine(e, true);
        if (e.st > 0) return true;
        tellFan(e, [], false); tellLine(e, false); e.hit = 0;
        if (e.kind === 'fan') {
          const b = Math.atan2(e.tz - e.z, e.tx - e.x);
          for (const k of IO_FAN) { const dx = Math.cos(b + k), dz = Math.sin(b + k); fireShot({ x: e.x + dx * .6, z: e.z + dz * .6, dx, dz, speed: T.shotSpeed || 10, range: T.range || 12, foe: true, atk: T.atk }); }
          sfx('shot'); setState(e, 'strike', .3);
        } else if (e.kind === 'tendril') {   // a line of marks running out toward where the cat stood; each bursts 0.6 s after it shows
          const dx = e.tx - e.x, dz = e.tz - e.z, l = Math.hypot(dx, dz) || 1;
          for (let i = 1; i <= 7; i++) hazard(e.x + dx / l * i * 1.3, e.z + dz / l * i * 1.3, .6 + i * .05, .8, T.atk);
          sfx('swing3'); setState(e, 'strike', .5);
        } else if (e.kind === 'summon') {
          for (const s of [R() < .5 ? -1 : 1]) { if (ioMinions() >= 2) break; const x = e.x + s * 2.2, z = e.z + 1.2; if (A.blocked(x, z)) continue; const c = spawnEnemy('ink_crawler', x, z, { minion: true }); c.aware = true; c.hunt = true; c.T = Object.assign({}, c.T, { xp: 1, drops: [] }); }
          e.summonT = 12; setState(e, 'recover', .6);
        } else setState(e, 'strike', e.kind === 'burst' ? (IO_BURST - 1) * IO_GAP + .05 : .25);   // burst, quick
        a.anim = e.kind === 'summon' || e.kind === 'tendril' ? 'summon' : 'attack';
        return true;
      case 'strike': {
        const dx = e.tx - e.x, dz = e.tz - e.z, l = Math.hypot(dx, dz) || 1, el = e.t0 - e.st;
        if (e.kind === 'burst') while (e.hit < IO_BURST && el >= e.hit * IO_GAP) { e.hit++; fireShot({ x: e.x + dx / l * .6, z: e.z + dz / l * .6, dx: dx / l, dz: dz / l, speed: T.shotSpeed || 10, range: T.range || 12, foe: true, atk: T.atk }); sfx('shot'); }
        if (e.kind === 'quick' && !e.hit) { e.hit = 1; fireShot({ x: e.x + dx / l * .6, z: e.z + dz / l * .6, dx: dx / l, dz: dz / l, speed: IO_QUICK, range: T.range || 12, foe: true, atk: T.atk + 2 }); sfx('shot'); shake(.15); }
        if (e.st <= 0) setState(e, 'recover', phase === 3 ? .6 : .8);
        return true;
      }
      case 'roll': a.anim = 'roll'; a.moving = true; if (!move(e.rx * 7, e.rz * 7) || e.st <= 0) { setState(e, 'chase', 0); e.cool = .3; } return true;
      case 'recover': if (e.st <= 0) { setState(e, 'chase', 0); e.cool = [0, 1.5, 1.3, 1.1][phase] + R() * .4; } return true;
      default: {   // chase: keeps his distance (the data's keep), picks an attack when he sees the cat
        a.anim = null; face(player.x, player.z);
        if (sees && dist < T.keep[0]) a.moving = move(-e.fx * T.speed, -e.fz * T.speed);
        else if (!sees || dist > T.keep[1]) a.moving = move(e.fx * T.speed, e.fz * T.speed) || move(-e.fz * T.speed, e.fx * T.speed) || move(e.fz * T.speed, -e.fx * T.speed);   // (cover in the way: around it)
        if (e.cool > 0 || !sees || hero.dead) return true;
        const opts = IO_PICK[phase].filter(([k]) => (k !== 'summon' || (e.summonT <= 0 && ioMinions() < 2)) && (k !== 'fan' || dist < 5) && (phase !== 2 || (k !== 'burst' && k !== 'fan') || !ioMinions()));   // (his crawlers about: no rounds on top of their hops)
        let r = R() * opts.reduce((s, o) => s + o[1], 0), kind = opts[0][0]; for (const [k, w] of opts) { if ((r -= w) < 0) { kind = k; break; } }
        e.kind = kind; e.tx = player.x; e.tz = player.z;
        if (kind === 'roll') {   // no attack, nothing to tell: aside, across the cat's line, where there is room
          const ux = -(player.z - e.z) / (dist || 1), uz = (player.x - e.x) / (dist || 1), s = A.blocked(e.x + ux * 2.5, e.z + uz * 2.5) ? -1 : 1;
          e.rx = ux * s; e.rz = uz * s; setState(e, 'roll', .35); a.anim = 'roll'; return true;
        }
        setState(e, 'windup', kind === 'fan' ? .6 : kind === 'quick' ? .45 : kind === 'burst' ? .5 : .35);   // (tendrils: their marks are the tell)
        a.anim = kind === 'tendril' || kind === 'summon' ? 'summon' : 'windup'; sfx('click');
        if (kind === 'quick') fx('hit_spark', e.x, e.z, { y: A.groundY(e.x, e.z) + 1.7, size: .9 });   // his eyes glint
        return true;
      }
    }
  },
};

// ---- content/plugins/behaviours/lieutenant.js
/* ---------- plugin: Cole, the lieutenant, Chapter 3's mini-boss (content/chapter3/enemies.json: "behaviour": "lieutenant") ---------- */
// He holds the end chamber of the mine's first level with the lift key. He keeps his distance and either fires a
// sawn-off shotgun up close (five rounds in a fan, short: the data's range; told by a fan of red lines on the ground)
// or, from farther off, charges (told by pawing the ground under one long red line): a charge that meets a wall leaves
// him dazed a moment, the cat's opening. Both tells are the state 'windup' (as every enemy's, so tools/fair-check.mjs's bots see them), e.kind telling which.
const LT_FAN = [-.44, -.22, 0, .22, .44], LT_TELL = .6, LT_DASH = 11, LT_DASH_T = .7, LT_DAZE = 1.2;
BEHAVIOURS.lieutenant = {
  onHit(e) { if (!e.rage && e.hp < e.T.hp / 2) { e.rage = true; shake(.2); } },   // below half health: shorter gaps
  ai(e, dt, dist, move, face) {
    const T = e.T, a = e.a, sees = dist < T.sight && A.clear(e.x, e.z, player.x, player.z);
    e.cool = (e.cool ?? 1.2) - dt;
    switch (e.state) {
      case 'windup':
        if (hero.dead && e.st <= 0) { tellFan(e, [], false); tellLine(e, false); setState(e, 'recover', .6); return true; }   // (the cat fallen: nothing fired)
        face(e.tx, e.tz);
        if (e.kind === 'fan') tellFan(e, LT_FAN, true);
        else { tellLine(e, true, LT_DASH * LT_DASH_T + T.r + .5); if (R() < dt * 8) fx('dust', e.x - e.fx * .5, e.z - e.fz * .5, { size: .7 }); }
        if (e.st > 0) return true;
        if (e.kind === 'fan') {
          tellFan(e, [], false); const b = Math.atan2(e.tz - e.z, e.tx - e.x);
          for (const k of LT_FAN) { const dx = Math.cos(b + k), dz = Math.sin(b + k); fireShot({ x: e.x + dx * .5, z: e.z + dz * .5, dx, dz, speed: T.shotSpeed || 9, range: T.range || 12, foe: true, atk: T.atk }); }
          sfx('shot'); shake(.15); setState(e, 'strike', .35); a.anim = 'attack';
        } else { tellLine(e, false); setState(e, 'charge', LT_DASH_T); a.anim = 'charge'; e.hit = 0; sfx('swing3'); }
        return true;
      case 'charge':
        a.anim = 'charge'; a.moving = true;
        if (!move(e.fx * LT_DASH, e.fz * LT_DASH)) { setState(e, 'dazed', LT_DAZE); a.anim = 'hurt'; shake(.3); sfx('slam'); fx('dust', e.x + e.fx * .6, e.z + e.fz * .6, { size: 1.4 }); return true; }   // into a wall: dazed
        if (!e.hit && near(e, player) < T.r + .5) { e.hit = 1; hurtHero(T.atk + 3, e.x, e.z); }
        if (e.st <= 0) setState(e, 'recover', .6);
        return true;
      case 'strike': a.anim = 'attack'; if (e.st <= 0) setState(e, 'recover', .8); return true;
      case 'dazed': a.anim = 'hurt'; if (e.st <= 0) { setState(e, 'chase', 0); e.cool = .8; } return true;
      case 'recover': if (e.st <= 0) { setState(e, 'chase', 0); e.cool = e.rage ? 1.2 + R() * .4 : 1.6 + R() * .6; } return true;
      default: {   // wander, notice, chase: asleep until he sees the cat, then keeps the data's distance and picks an attack
        if (!e.aware && !sees) return false;
        e.aware = true; a.anim = null; face(player.x, player.z);
        if (sees && dist < T.keep[0]) a.moving = move(-e.fx * T.speed * .8, -e.fz * T.speed * .8);
        else if (!sees || dist > T.keep[1]) a.moving = move(e.fx * T.speed, e.fz * T.speed) || move(-e.fz * T.speed, e.fx * T.speed) || move(e.fz * T.speed, -e.fx * T.speed);   // (cover in the way: around it)
        if (e.cool <= 0 && sees && !hero.dead) {
          e.tx = player.x; e.tz = player.z; e.kind = dist > 3 && dist < 9 && (dist > T.range - .5 || R() < .35) ? 'charge' : dist < T.range - .5 ? 'fan' : null;
          if (!e.kind) { e.cool = .3; return true; }   // (too far for either: closer first)
          setState(e, 'windup', LT_TELL); a.anim = e.kind === 'fan' ? 'windup' : 'paw'; sfx('click');
        }
        return true;
      }
    }
  },
};

// ---- content/plugins/behaviours/what_remains.js
/* ---------- plugin: What Remains, Chapter 2's boss (content/chapter2/enemies.json: "behaviour": "what_remains") ---------- */
// The crew merged into one shape of ink, on the bridge. Phase 1 reaches for the cat (a line of ink marks toward it and a
// blow in front) and pulses (a ring of marks around itself); below half health it calls shadows off the walls (never
// more than three) and pulses twice as often. Every attack is announced: the arm drawn back, the marks on the floor
// 0.6 s before they burst. Built as the Blot Scribe's behaviour is (blot_scribe.js).
BEHAVIOURS.what_remains = {
  onHit(e) { if (!e.phase2 && e.hp < e.T.hp / 2) { e.phase2 = true; e.state = 'summon'; e.st = .9; e.a.anim = 'summon'; e.a.at = 0; toast(t('toast.boss2r')); shake(.3); } },
  ai(e, dt, dist, move, face) {
    const T = e.T, a = e.a; e.cool = (e.cool || 1.6) - dt;
    switch (e.state) {
      case 'wander': case 'notice': case 'chase': {
        a.anim = null; face(player.x, player.z);
        if (dist > T.reach * .8) a.moving = move(e.fx * T.speed, e.fz * T.speed);
        if (e.cool <= 0) {
          const pulse = e.phase2 ? R() < .5 : R() < .25 || dist < 2;
          if (pulse) { e.state = 'pulse'; e.st = .9; a.anim = 'pulse'; a.at = 0; e.done = false; }
          else { e.state = 'windup'; e.st = .7; a.anim = 'windup'; a.at = 0; }
        }
        break;
      }
      case 'windup': face(player.x, player.z); if (e.st <= 0) { e.state = 'reach'; e.st = .5; a.anim = 'attack'; a.at = 0; e.hit = 0; e.done = false; sfx('swing3'); } break;
      case 'reach': {   // a blow in front, the reach's length, and a line of marks running on toward the cat
        if (!e.hit) {
          e.hit = 1; fx('slash', e.x + e.fx * 1.8, e.z + e.fz * 1.8, { size: 2.6, y: A.groundY(e.x, e.z) + .6 });
          const dx = player.x - e.x, dz = player.z - e.z, d = Math.hypot(dx, dz); if (d < T.reach && (dx * e.fx + dz * e.fz) / (d || 1) > .55) hurtHero(T.atk, e.x, e.z);   // (a cone in front: a dodge to the side clears it)
        }
        if (!e.done) { e.done = true; for (let i = 3; i <= 7; i++) hazard(e.x + e.fx * i * 1.2, e.z + e.fz * i * 1.2, .6 + i * .06, .8, T.atk - 3); }
        if (e.st <= 0) { e.state = 'chase'; e.cool = e.phase2 ? 1.3 : 1.8; }
        break;
      }
      case 'pulse': {   // a ring of marks around itself
        if (!e.done && e.st < .6) { e.done = true; for (let i = 0; i < 10; i++) { const an = i / 10 * Math.PI * 2, r = 2.2 + (i % 2) * 1.6; hazard(e.x + Math.cos(an) * r, e.z + Math.sin(an) * r, .7, .9, T.atk - 3); } }
        if (e.st <= 0) { e.state = 'chase'; e.cool = e.phase2 ? 1.1 : 1.6; }
        break;
      }
      case 'summon': {   // phase 2 and then every so often: two shadows off the walls, never more than three alive
        a.anim = 'summon';
        if (e.st <= 0) {
          for (const s of [-1, 1]) {
            if (enemies.filter((o) => o.type === 'shadow' && o.hp > 0).length >= 3) break;
            const b = spawnEnemy('shadow', e.x + s * 2.4, e.z + 1.4); b.aware = true; b.hunt = true; b.T = Object.assign({}, b.T, { xp: 1, drops: [] });
          }
          e.state = 'chase'; e.cool = 1.2; e.summonT = 10;
        }
        break;
      }
    }
    if (e.phase2 && e.state === 'chase' && (e.summonT = (e.summonT || 10) - dt) <= 0) { e.state = 'summon'; e.st = .9; a.anim = 'summon'; a.at = 0; }
    return true;
  },
};

// ---- content/**/*.json
const GAME_DATA = {"files":{"chapter1/areas/bakery_in.json":{"schema":2,"areas":{"bakery_in":{"name":"area.bakery","cell":2,"tod":"interno","start":[11,11.4],"camNorth":1,"music":"library","legend":{"o":{"tile":"wood_planks"},"W":{"tile":"crypt_floor","h":48,"wall":"#6e5a48"},"V":{"tile":"crypt_floor","h":6,"wall":"#6e5a48"}},"map":["WWWWWWWWWW","WooooooooW","WooooooooW","WooooooooW","WooooooooW","WooooooooW","VVVVoooVVV"],"atmos":{"bloom":0.8,"thr":0.38,"haze":0.06,"sat":1.08,"motes":"dust"},"things":[{"id":"market_stall","key":"market_stall","at":[11,6]},{"id":"barrel-1","key":"barrel","at":[4,4.6]},{"id":"barrel-2","key":"barrel","at":[5.6,4.6]},{"id":"crate","key":"crate","at":[16,9.6]},{"id":"chest","key":"chest","at":[16,4.6],"chest":{"id":"bakery","item":"coin","n":12}}],"npcs":[{"id":"baker","at":[11,8.6],"face":[0,1]}],"lamps":[[10,3,7,3,1.3]],"exits":[{"id":"to-overworld","rect":[8,13.2,14,14],"to":"overworld","at":[46.8,35.6],"face":[0,1]}]}}},"chapter1/areas/crypt_boss.json":{"schema":2,"areas":{"crypt_boss":{"name":"area.boss","cell":2,"tod":"cripta","start":[14,21.4],"camNorth":1,"music":{"choose":[[{"flag":"boss_done"},"crypt"]],"else":"boss"},"halo":"#8fa8ff","legend":{"o":{"tile":"crypt_floor"},"W":{"tile":"crypt_floor","h":52,"wall":"#4a4250"},"V":{"tile":"crypt_floor","h":6,"wall":"#4a4250"},"w":{"tile":"water","water":true,"h":-3}},"map":["WWWWWWWWWWWWWW","WooooooooooooW","WooooooooooooW","WooooooooooooW","WooooooooooooW","WooooooooooooW","WooooooooooooW","WooooooooooooW","WooooooooooooW","WooooooooooooW","WooooooooooooW","VVVVVVooVVVVVV"],"atmos":{"bloom":1.2,"thr":0.3,"haze":0.1,"sat":1.12,"motes":"ink"},"things":[{"id":"sarcophagus-1","key":"sarcophagus","at":[5,4.4]},{"id":"sarcophagus-2","key":"sarcophagus","at":[23,4.4]}],"lamps":[[3,3,3,2.8,1.4],[25,3,3,2.8,1.4],[3,3,18,2.6,1.2],[25,3,18,2.6,1.2]],"exits":[{"id":"to-crypt_in","rect":[12,23.2,16,24],"to":"crypt_in","at":[16,6.8],"face":[0,1],"when":{"not":{"flag":"boss_done"}}},{"id":"to-overworld","rect":[12,23.2,16,24],"to":"overworld","at":[45,25.2],"face":[0,1],"when":{"flag":"boss_done"}}],"onEnter":[{"if":{"flag":"boss_done"},"then":[{"if":{"not":{"has":"page_3"}},"then":[{"drop":"page_3","at":[14,8]}]}],"else":[{"spawn":"blot_scribe","at":[14,7],"onDefeat":[{"flag":"boss_done"},{"drop":"page_3","at":"self","offset":[0,1]},{"toast":"toast.boss.done"}]},{"wait":0.7},{"if":{"all":[{"area":"crypt_boss"},{"dialogue":false}]},"then":[{"say":[["scribe","sc.1"],["cat_worried","sc.2"],["scribe","sc.3"]],"name":"who.scribe"}]}]}]}}},"chapter1/areas/crypt_in.json":{"schema":2,"areas":{"crypt_in":{"name":"area.crypt","cell":2,"tod":"cripta","start":[16,45.4],"camNorth":1,"music":"crypt","halo":"#8fa8ff","legend":{"o":{"tile":"crypt_floor"},"W":{"tile":"crypt_floor","h":52,"wall":"#4a4250"},"V":{"tile":"crypt_floor","h":6,"wall":"#4a4250"},"w":{"tile":"water","water":true,"h":-3}},"map":["WWWWWWWWWWWWWWWW","WooooooooooooooW","WooooooooooooooW","WooooooooooooooW","WooooooooooooooW","VVVVVVooooVVVVVV","WooooooooooooooW","WooooooooooooooW","WooooooooooooooW","WooooooooooooooW","VVVVVVooooVVVVVV","WwwwwwwwwwwwwwwW","WwwwwwwwwwwwwwwW","WooooooooooooooW","WooooooooooooooW","WooooooooooooooW","WooooooooooooooW","WooooooooooooooW","WooooooooooooooW","WooooooooooooooW","WooooooooooooooW","WooooooooooooooW","WooooooooooooooW","VVVVVVVooVVVVVVV"],"atmos":{"bloom":1.1,"thr":0.3,"haze":0.1,"sat":1.1,"motes":"dust"},"things":[{"id":"crypt_arch","key":"crypt_arch","at":[16,4],"box":[2.6,0.8],"door":{"to":"crypt_boss","at":[14,21.4],"face":[0,-1]}},{"id":"chest","key":"chest","at":[5,6.4],"chest":{"id":"crypt_well","item":"ink_potion","n":2,"flag":"skill_well","lines":["chest.well","chest.well2"]}},{"id":"sarcophagus-1","key":"sarcophagus","at":[25.5,5.8]},{"id":"crypt_wall","key":"crypt_wall","at":[16,10.6],"box":[4.2,0.8],"when":{"not":{"flag":"crypt_gate"}},"shut":"tip.crypt.wall"},{"id":"lever-1","key":"lever","at":[5,15.4],"box":[0.3,0.3],"act":{"label":"act.pull","name":"act.lever","run":[{"call":"crypt_lever","args":{"i":1}}]}},{"id":"lever-2","key":"lever","at":[27,15.4],"box":[0.3,0.3],"act":{"label":"act.pull","name":"act.lever","run":[{"call":"crypt_lever","args":{"i":2}}]}},{"id":"lever-3","key":"lever","at":[22.4,18.6],"box":[0.3,0.3],"act":{"label":"act.pull","name":"act.lever","run":[{"call":"crypt_lever","args":{"i":0}}]}},{"id":"signpost","key":"signpost","at":[9.6,18.4],"look":{"label":"act.read","name":"act.plaque","lines":["plaque.1","plaque.2"]}},{"id":"sarcophagus-2","key":"sarcophagus","at":[7,32]},{"id":"sarcophagus-3","key":"sarcophagus","at":[25,32]},{"id":"barrel","key":"barrel","at":[3.4,42.4]},{"id":"crate","key":"crate","at":[28.6,42.6]}],"spawns":[{"id":"bookworm-1","type":"bookworm","at":[10,36]},{"id":"bookworm-2","type":"bookworm","at":[22,38]},{"id":"wax_golem-1","type":"wax_golem","at":[16,16.4]},{"id":"wax_golem-2","type":"wax_golem","at":[22,7.6],"when":{"not":{"flag":"boss_done"}}}],"lamps":[[3,3,3,2.6,1.3],[29,3,3,2.6,1.3],[3,3,13,2.4,1.2],[29,3,13,2.4,1.2],[3,3,28,2.4,1.2],[29,3,28,2.4,1.2],[3,3,40,2.4,1.2],[29,3,40,2.4,1.2]],"exits":[{"id":"to-overworld","rect":[14,47.2,18,48],"to":"overworld","at":[44.3,25.2],"face":[0,1]}],"tips":[{"rect":[2,25.6,30,28.6],"text":{"choose":[[{"not":{"flag":"skill_dash"}},"tip.pool.nodash"],[{"touch":true},"tip.pool.touch"]],"else":"tip.pool"}},{"rect":[12,19,20,22],"text":{"choose":[[{"not":{"flag":"skill_dash"}},"tip.pool.nodash"],[{"touch":true},"tip.pool.touch"]],"else":"tip.pool"}}],"onEnter":[{"set":"levers","to":0}]}}},"chapter1/areas/library_in.json":{"schema":2,"areas":{"library_in":{"name":"area.library","cell":2,"tod":"interno","start":[13,13.4],"camNorth":1,"music":"library","legend":{"o":{"tile":"wood_planks"},"W":{"tile":"crypt_floor","h":48,"wall":"#6e5a48"},"V":{"tile":"crypt_floor","h":6,"wall":"#6e5a48"}},"map":["WWWWWWWWWWWW","WooooooooooW","WooooooooooW","WooooooooooW","WooooooooooW","WooooooooooW","WooooooooooW","VVVVVoooVVVV"],"atmos":{"bloom":0.8,"thr":0.38,"haze":0.06,"sat":1.08,"motes":"dust"},"things":[{"id":"reading_desk","key":"reading_desk","at":[13,7.6],"desk":true},{"id":"statue","key":"statue","at":[5,4.6],"act":{"label":"act.read","name":"who.statue","run":[{"call":"texttest"}]}},{"id":"chest","key":"chest","at":[19.6,5],"chest":{"id":"library","item":"milk","n":2}},{"id":"crate","key":"crate","at":[4.4,11.6]},{"id":"barrel","key":"barrel","at":[19.8,11.4]},{"id":"bench","key":"bench","at":[13,4.4]}],"npcs":[{"id":"librarian","at":[17.5,8.4],"face":[0,1]}],"lamps":[[6,3,8,3,1.2],[18,3,8,3,1.2]],"exits":[{"id":"to-overworld","rect":[10,15.2,16,16],"to":"overworld","at":[32,35.6],"face":[0,1]}]}}},"chapter1/areas/overworld.json":{"schema":2,"areas":{"overworld":{"name":"area.village","cell":2,"chunk":[16,12],"keep":true,"tod":"giorno","start":[44,49],"camNorth":1.5,"music":{"choose":[[{"x":[">",64]},"road"]],"else":"village"},"legend":{"g":{"tile":"grass"},"f":{"tile":"grass_flowers"},"c":{"tile":"cobblestone"},"p":{"tile":"dirt_path"},"a":{"tile":"farmland"},"w":{"tile":"water","water":true,"swim":true,"h":-3},"X":{"tile":"grass","h":56,"cliff":true},"Y":{"tile":"grass_flowers","h":56,"cliff":true},"x":{"tile":"grass","h":6,"cliff":true},"y":{"tile":"grass_flowers","h":6,"cliff":true},"T":{"tile":"grass_flowers","h":14,"ledge":true},"H":{"tile":"grass","h":48,"cliff":true}},"map":["XXYYYXXXXXYXXXXXXXYXXXXYXXXYXXXXYXYXYXXXXYXXYXYXXXXXXYXXXYXXXXXY","XXYXYXXXXXXXXXXXYYXXXXXXYXYXYXYXXXYYXYXXXXXXXXXXXXXXXXXXXYXXXYYX","XXXXYYXYXYXYXXXXXXXXXYXXXXXXYXXXXXXXXXXXXXXXXXXXXXXXYXXXXXXYXXYX","XXXXXXYXXYXXXXXYXXXXYXXYXXXXXYXXXXXXXXYXXYXYXXYXYXXXXXYXXXXXXXXY","XXXXXXXXXXXYYXXXYXYYXYYXXXXYXYXXXYXXXXXXXXXXXXYXXXYXXXXXXXXYXXXX","XXXXXXYXXYYXXXXYXXXYYXXYXYXYXXXXYXXYXYXXXYXYXXXXXXYXXXXXYXXXXYXX","XXXYXXXXXXXXXXXXXXXXYXXXXXXYYXXXYXXXXYYXYXXXYYYXXYXXXXXXXXXYXXXX","XXXXXXXXYYXXXXYXXYXXYXXXXXYXXXXXXXYYXYXXYYXXXXYXYYXXYXXXXXXXXXXX","XXXXXXXXXgggXYXXffggXXXXXYXXXXXXYXXXYXYXXXXXYXYXXXXXYXXXXXXXYXXX","YXXXXXXYXgggggggffggggggXXXXggfgggggggffHHHHTTTTXXXXYXXXXXYYXXXX","XXXXYYXYYgffgggggggccccccccgffggggggggggggggTTTTgggggfXXXXXYXYXX","XXYXXXXXXggfgggggggccccccccfffggggggaaaaaaaaaaagggggffXXXYYYXXXX","XXXYXYXXXggfggggffgccccccccgggggggggaaaaaaaaaaagggfgggXXYYXXXYXY","XXXXYXXXXggfggggffgccccccccfggggggggaaaaaaaaaaagggggggXXXXXXXXXX","YYXXXXYXXgffffgggggfgccgfgggggggggggaaaaaaaaaaagggggggXXXXXXYXXY","XXXXYXXXYggffgccccccccccccccccggggggaaaaaaaaaaagggggggXXXYXXXXXX","XXXYXXXXXyggggccccccccccccccccggggggaaaaaaaaaaagffgfgggYYYXXXXXX","XXYXXXYXXyggggccccccccccccccccfgggggaaaaaaaaaaagffffgggXXXXXXXXX","YXXXYXYXXxggggccccccccccccccccffggffggggggggggggggggfffXXXYXXXXX","XXXXYXXXXXggggccccccccccccccccgfggffggggggggggggggggffgXXXXYYXXX","XXXXXYXXYgppppccccccccccccccccpppppppppppppppppppppppppYYYXXXXXX","YXYXYXXXXgppppccccccccccccccccpppppppppppppppppppppppppXXXXYXYXY","YXXXXXXXYgggggccccccccccccccccggggggggggggggggffgggggggXYXXXYXXX","XXXXXXXYYgggggccccccccccccccccgggggggggggggggggggggggggXYXXXYXXX","XXXXXXXXggggggccccccccccccccccggggggggggfgggggggggffffgXXXXXXYXX","XXYXXXYXggggggccccccccccccccccggggggggggffgggggggggggfgXXXXXYYYX","XXXXXXYXggfgfgccccccccccccccccfgggfggggggggggggggggggggXXXYXYXYX","YXXYXXYXgggggfgggggggggfggggfgffggffgggggggggggggggggggXXXXYXXXX","XXYXYYXXxgggggggggggggggggggggffffggggffffggggfgggggfggXYXXXYXXY","XXYYYXXXxgggggffgggggggggggggggfffggggffffgggggfgggggfgXXYXXYXXY","YYXXYXXXyggggggggggggggggggggggwwwwwffgggggggggggggggggXXXXXXXXX","XXYYXXXXXggggggggggggggggggggwwwwwwwwwgggggggggggggggggXYYXXYYXX","XYXXXXXXggggggggggggggggggggfwwwfffwwwgfggggffggggggfgggYYXXXXXX","XXXYYXXXggggggggggggggggggggfwwwfffwwwffggggfgggggggfgffXXXXXXYX","XYXXYXXXggggggggggggffgggggggwwwfffwwwggggggggggggggggffXXYXXXXX","XXXXXXYXgggggggggggggfgggggggwwwwwwwwwggggggggggggggggffYXXXXXYX","XXXXXXXXxggggggggggggggfffgggggwwwwwggggfffgggggggggggxxXXXYYXXX","XXXXXXXYyggggggggggggggfffggggggggggggggfffgggggggggggxxXXXXXXXX","XXXXXXXXyfggggggggggggggffgggggfgggfgggggggfggfgggggxxxxXXXXXXYX","xyxxxxxxxxxxggggyxxyggggxxxxxxxxggffggggggfgxxxxxxxyxyyxxyxxxxxx","xxxxxxxxxxxxyxyxyxxxyxyxxxxxxxxyxyxxxxyxxyxxxyyxxxxxxxyxxyyxxxxx","xxxxxxxyxxxxyxxxyxxyxxxxxxxxxxxxxxxxxxxyxxxxxxyxxxxxxyxyxyyxxxxx","xxxxxxxxyxxxxxyyxyyxxyxxxxxyxyxyxxxxxxxxxxxxxxyyxyxyyxxxxyyyyxyx","xxxxxxyxxxxxxxxxxxxxxyxxxxxxxyyxxyxyxxxxxxxyxyxxyxyxxyyyxxxxyxyx","yxxxyxxxxxxxxxyxxyxxyxxyxyxxxxxxxxxxxyyxyxxxxxxyxxxxyxxxxxxxxxyx","xyxxxxxxyxxxxxxxxxyyxxxxyxyxxxxxxxxxxxxxxxxxxxxxxxyxxxyxxyxxyxyx","xxxxxxxxxxyxxxyxxyxxxxxxxxxxxxxxxxxyyxxxxxxxxxyyxxxxxxxxxyyxxxxx","yyxxxyxxxyxxxyxyxxxyxxxyxxxxxxxxxxxyxxxxyxyyxxxxyxxxxxxyxyxxxxxx"],"tips":[{"rect":[87,22,97,24.5],"text":"tip.ledge"},{"rect":[56,56.5,78,60.5],"text":"tip.swim"}],"things":[{"id":"ladder","key":"ladder","at":[85,20.3],"box":[0,0],"climb":true},{"id":"chest-1","key":"chest","at":[81.4,18.7],"chest":{"id":"lookout","item":"owl_charm","lines":["chest.owl"]}},{"id":"chest-2","key":"chest","at":[67,66.4],"chest":{"id":"isle","item":"fish","n":2,"lines":["chest.isle"]}},{"id":"library","key":"library","at":[32,31.5],"door":{"to":"library_in","at":[13,13.4],"face":[0,-1]}},{"id":"bakery","key":"bakery","at":[45,31.5],"door":{"to":"bakery_in","at":[11,11.4],"face":[0,-1]}},{"id":"shop","key":"shop","at":[56.5,31.5]},{"id":"house_a","key":"house_a","at":[22,37]},{"id":"house_b","key":"house_b","at":[20,50.5]},{"id":"church","key":"church","at":[45,21],"door":{"to":"crypt_in","at":[16,45.4],"face":[0,-1],"need":"crypt_key"}},{"id":"chest-3","key":"chest","at":[101,30.6],"chest":{"id":"mill","item":"hinge"}},{"id":"fence-1","key":"fence","at":[97.3,48]},{"id":"fence-2","key":"fence","at":[102.5,48]},{"id":"fence-3","key":"fence","at":[99.9,48],"box":[1.3,0.25],"when":{"not":{"flag":"gate_open"}},"shut":"tip.garden.gate"},{"id":"fence-4","key":"fence","at":[97.3,56]},{"id":"fence-5","key":"fence","at":[99.9,56]},{"id":"fence-6","key":"fence","at":[102.5,56]},{"id":"fence-7","key":"fence","at":[96,49.3],"rot":1},{"id":"fence-8","key":"fence","at":[96,51.9],"rot":1},{"id":"fence-9","key":"fence","at":[96,54.5],"rot":1},{"id":"fence-10","key":"fence","at":[104,49.3],"rot":1},{"id":"fence-11","key":"fence","at":[104,51.9],"rot":1},{"id":"fence-12","key":"fence","at":[104,54.5],"rot":1},{"id":"lever","key":"lever","at":[92.6,46.6],"box":[0.3,0.3],"act":{"label":"act.pull","name":"act.lever","run":[{"call":"road_lever"}]}},{"id":"chest-4","key":"chest","at":[98.5,51],"chest":{"id":"garden_page","item":"page_2"}},{"id":"chest-5","key":"chest","at":[101.6,51],"chest":{"id":"garden_key","item":"crypt_key","lines":["chest.cryptkey"]}},{"id":"statue","key":"statue","at":[86,47.2],"act":{"label":"act.read","name":"who.statue","run":[{"call":"statue"}]}},{"id":"windmill","key":"windmill","at":[101,25]},{"id":"vine_row-1","key":"vine_row","at":[78,26]},{"id":"vine_row-2","key":"vine_row","at":[88,26]},{"id":"vine_row-3","key":"vine_row","at":[78,31.5]},{"id":"vine_row-4","key":"vine_row","at":[88,31.5]},{"id":"well","key":"well","at":[44,44]},{"id":"market_stall","key":"market_stall","at":[53,47]},{"id":"bench","key":"bench","at":[36,48.5]},{"id":"reading_desk","key":"reading_desk","at":[35.5,36.6],"desk":true},{"id":"lamp_post-1","key":"lamp_post","at":[38,39],"box":[0.2,0.2]},{"id":"lamp_post-2","key":"lamp_post","at":[50,39],"box":[0.2,0.2]},{"id":"lamp_post-3","key":"lamp_post","at":[38,51],"box":[0.2,0.2]},{"id":"lamp_post-4","key":"lamp_post","at":[50,51],"box":[0.2,0.2]},{"id":"signpost","key":"signpost","at":[62,38.6],"look":{"label":"act.read","name":"act.sign","lines":["sign.1"]}},{"id":"barrel","key":"barrel","at":[59.4,37.6]},{"id":"crate","key":"crate","at":[60.8,38.2]},{"id":"fence-13","key":"fence","at":[72,36.6]},{"id":"fence-14","key":"fence","at":[74.6,36.6]},{"id":"fence-15","key":"fence","at":[77.2,36.6]},{"id":"fence-16","key":"fence","at":[92,36.6]},{"id":"fence-17","key":"fence","at":[94.6,36.6]},{"id":"cypress-1","key":"cypress","at":[19,13],"box":[0,0]},{"id":"bush-1","key":"bush","at":[95,13],"box":[0,0]},{"id":"bush-2","key":"bush","at":[37,15],"box":[0,0]},{"id":"cypress-2","key":"cypress","at":[67,15],"box":[0,0]},{"id":"cypress-3","key":"cypress","at":[115,15],"box":[0,0]},{"id":"cypress-4","key":"cypress","at":[31,17],"box":[0,0]},{"id":"cypress-5","key":"cypress","at":[71,17],"box":[0,0]},{"id":"bush-3","key":"bush","at":[83,17],"box":[0,0]},{"id":"bush-4","key":"bush","at":[61,19]},{"id":"cypress-6","key":"cypress","at":[113,19],"box":[0,0]},{"id":"cypress-7","key":"cypress","at":[15,23],"box":[0,0]},{"id":"cypress-8","key":"cypress","at":[21,23],"box":[0.6,0.5]},{"id":"oak-1","key":"oak","at":[33,23],"box":[0.6,0.5]},{"id":"cypress-9","key":"cypress","at":[15,25],"box":[0,0]},{"id":"cypress-10","key":"cypress","at":[67,25],"box":[0.6,0.5]},{"id":"oak-2","key":"oak","at":[65,27],"box":[0.6,0.5]},{"id":"cypress-11","key":"cypress","at":[111,29],"box":[0,0]},{"id":"bush-5","key":"bush","at":[13,31],"box":[0,0]},{"id":"bush-6","key":"bush","at":[13,43],"box":[0,0]},{"id":"bush-7","key":"bush","at":[83,47]},{"id":"cypress-12","key":"cypress","at":[85,47],"box":[0.6,0.5]},{"id":"cypress-13","key":"cypress","at":[15,55],"box":[0,0]},{"id":"bush-8","key":"bush","at":[115,55],"box":[0,0]},{"id":"bush-9","key":"bush","at":[45,57]},{"id":"bush-10","key":"bush","at":[33,59]},{"id":"cypress-14","key":"cypress","at":[87,59],"box":[0.6,0.5]},{"id":"cypress-15","key":"cypress","at":[109,61],"box":[0.6,0.5]},{"id":"bush-11","key":"bush","at":[17,63],"box":[0,0]},{"id":"bush-12","key":"bush","at":[81,63]},{"id":"cypress-16","key":"cypress","at":[15,65],"box":[0,0]},{"id":"oak-3","key":"oak","at":[41,65],"box":[0.6,0.5]},{"id":"bush-13","key":"bush","at":[93,65]},{"id":"cypress-17","key":"cypress","at":[107,65],"box":[0.6,0.5]},{"id":"cypress-18","key":"cypress","at":[35,67],"box":[0.6,0.5]},{"id":"cypress-19","key":"cypress","at":[29,69],"box":[0.6,0.5]},{"id":"oak-4","key":"oak","at":[35,69],"box":[0.6,0.5]},{"id":"oak-5","key":"oak","at":[111,69],"box":[0.6,0.5]},{"id":"bush-14","key":"bush","at":[113,69],"box":[0,0]},{"id":"cypress-20","key":"cypress","at":[115,69],"box":[0,0]},{"id":"oak-6","key":"oak","at":[21,71],"box":[0.6,0.5]},{"id":"cypress-21","key":"cypress","at":[35,71],"box":[0.6,0.5]},{"id":"oak-7","key":"oak","at":[43,73],"box":[0.6,0.5]},{"id":"bush-15","key":"bush","at":[49,73]},{"id":"bush-16","key":"bush","at":[43,75]},{"id":"cypress-22","key":"cypress","at":[81,75],"box":[0.6,0.5]},{"id":"bush-17","key":"bush","at":[85,75]},{"id":"cypress-23","key":"cypress","at":[33,77],"box":[0.6,0.5]},{"id":"cypress-24","key":"cypress","at":[73,77],"box":[0.6,0.5]},{"id":"bush-18","key":"bush","at":[113,77],"box":[0,0]},{"id":"bush-19","key":"bush","at":[89,79],"box":[0,0]},{"id":"cypress-25","key":"cypress","at":[73,81],"box":[0,0]},{"id":"bush-20","key":"bush","at":[85,81],"box":[0,0]},{"id":"cypress-26","key":"cypress","at":[89,81],"box":[0,0]},{"id":"bush-21","key":"bush","at":[99,81],"box":[0,0]},{"id":"cypress-27","key":"cypress","at":[43,83],"box":[0,0]},{"id":"cypress-28","key":"cypress","at":[47,83],"box":[0,0]},{"id":"cypress-29","key":"cypress","at":[95,83],"box":[0,0]}],"fish":7,"critters":[{"id":"hen-1","kind":"hen","at":[27,44],"n":3,"r":3},{"id":"rooster","kind":"rooster","at":[27,44],"n":1,"r":2},{"id":"chick","kind":"chick","at":[27,44],"n":2,"r":2},{"id":"hen-2","kind":"hen","at":[36,58],"n":2,"r":3},{"id":"sheep","kind":"sheep","at":[50,62],"n":3,"r":4},{"id":"pig","kind":"pig","at":[86,66],"n":2,"r":2.5},{"id":"dog","kind":"dog","at":[40,46],"n":1,"r":5}],"npcs":[{"id":"shopkeeper","at":[53,49.6],"face":[0,1]},{"id":"child","at":[47.6,45.2],"face":[0,1]},{"id":"guard","at":[41.4,26.2],"face":[0,1]}],"spawns":[{"id":"blot-1","type":"blot","at":[70,42]},{"id":"blot-2","type":"blot","at":[80,43.6]},{"id":"blot-3","type":"blot","at":[100,36]},{"id":"inkfly-1","type":"inkfly","at":[88,41.5]},{"id":"inkfly-2","type":"inkfly","at":[93,44.5]},{"id":"inkfly-3","type":"inkfly","at":[97,31.5]},{"id":"blot-4","type":"blot","at":[76,38.4]}],"lamps":[[38,2.6,39],[50,2.6,39],[38,2.6,51],[50,2.6,51]],"onEnter":[{"if":{"all":[{"quest":"glasses","step":0},{"not":{"has":"glasses_case"}}]},"then":[{"drop":"glasses_case","at":[104,31.4]}]},{"if":{"quest":"main","step":1},"then":[{"spawn":"blot","at":[40,50.5]},{"spawn":"blot","at":[48,50.5]}]}]}}},"chapter1/enemies.json":{"schema":2,"enemies":{"blot":{"sheet":"enemies-1","row":"blot","hp":30,"atk":6,"def":0,"speed":2.4,"sight":7,"reach":2.2,"windup":0.5,"strike":0.38,"recover":0.8,"xp":4,"coins":[0,2],"r":0.5,"move":"hop","drops":[{"item":"milk","chance":0.12}]},"inkfly":{"sheet":"enemies-1","row":"inkfly","hp":24,"atk":7,"def":0,"speed":3.1,"sight":9,"reach":4.2,"windup":0.55,"strike":0.42,"recover":1,"xp":5,"coins":[1,2],"r":0.45,"move":"lunge","fly":0.8,"drops":[{"item":"ink_potion","chance":0.15}]},"bookworm":{"sheet":"enemies-2","row":"bookworm","hp":38,"atk":9,"def":2,"speed":2,"sight":9,"reach":5.5,"windup":0.65,"strike":0.6,"recover":1.2,"xp":9,"coins":[1,3],"r":0.6,"move":"lunge","drops":[{"item":"bread","chance":0.2}]},"wax_golem":{"sheet":"enemies-2","row":"wax_golem","hp":60,"atk":12,"def":3,"speed":1.5,"sight":7,"reach":1.9,"windup":0.75,"strike":0.5,"recover":1.3,"xp":15,"coins":[2,5],"r":0.7,"move":"smash","shield":true,"drops":[{"item":"fish","chance":0.3}]},"blot_scribe":{"sheet":"boss","row":"blot_scribe","hp":900,"atk":13,"def":3,"speed":1.6,"sight":30,"reach":3.4,"xp":60,"coins":[8,12],"r":1.1,"poise":true,"size":1,"boss":"who.scribe","anims":{"idle":["idle1","idle2"],"walk":["idle1","idle2"],"windup":["sweep_windup"],"attack":["sweep"],"cast":["blot_scribe_b.rain_cast"],"split":["blot_scribe_b.split"],"hurt":["blot_scribe_b.hurt"],"defeat":["blot_scribe_b.defeat"]},"behaviour":"blot_scribe"}}},"chapter1/game.json":{"schema":2,"game":{"start":{"area":"library_in"},"hero":{"sheet":"cat","views":{"down":"cat_down","up":"cat_up","side":"cat_side"},"anims":{"idle":["idle"],"walk":["walk1","walk2","walk3","walk4","walk5"],"attack1":["attack1"],"attack2":["attack2"],"attack3":["attack3"],"hurt":{"down":["cat_extra.hurt_down"],"up":["cat_extra.hurt_up"],"side":["cat_extra.hurt_side"]},"dodge":{"down":["cat_extra.dodge_down"],"up":["cat_extra.dodge_up"],"side":["cat_extra.dodge_side"]},"bored":{"down":["bored1","bored1","bored1","bored2","bored2","bored2","bored2","bored2","bored2","bored3","bored3","bored2","bored3","bored3","bored2","bored2","bored2","bored2"]},"swim":{"down":["swim1","swim2"],"up":["swim1","swim2"],"side":["swim1","swim2"]},"jump":{"down":["jump1","jump2"],"up":["jump1","jump2"],"side":["jump1","jump2"]},"climb":{"up":["climb1","climb2"]}},"equip":{"weapon":"quill_sword","armour":null,"charm":null}},"levels":{"xp":[0,0,20,50,95,160],"base":{"hp":[24,6],"ink":[30,0],"atk":[5,2],"def":[1,1]}},"sheets":{"portraits":["portraits-1","portraits-cat"],"items":"items-1","people":"villagers"},"titleArt":["title","title"],"map":{"area":"overworld","marks":["library","bakery","shop","house_a","house_b","church","windmill"]},"intro":"intro","onPlay":"mend","chapter":{"title":"title.chapter","blurb":"chapter1.blurb","minutes":17,"order":1,"save":"mdv-rpg-cat-save","styles":["lowpoly","diorama"],"card":["title","title"],"doneFlag":"chapter_done"},"atmos":{"bloom":0.35,"thr":0.55,"haze":0.1,"sat":1.06,"motes":"dust"},"hitFx":true}},"chapter1/items.json":{"schema":2,"items":{"quill_sword":{"slot":"weapon","atk":0,"price":0},"steel_quill":{"slot":"weapon","atk":3,"price":60},"gold_quill":{"slot":"weapon","atk":6,"price":0},"scarf":{"slot":"armour","def":1,"hp":4,"price":30},"vest":{"slot":"armour","def":2,"price":55},"cloak":{"slot":"armour","def":3,"hp":6,"price":0},"bell_charm":{"slot":"charm","ink":10,"price":40},"clover_charm":{"slot":"charm","hp":8,"price":0},"owl_charm":{"slot":"charm","atk":2,"def":1,"price":0},"milk":{"use":{"hp":10},"price":6},"fish":{"use":{"hp":22},"price":14},"bread":{"use":{"hp":15},"price":9},"ink_potion":{"use":{"ink":20},"price":12},"page_1":{"key":true},"page_2":{"key":true},"page_3":{"key":true},"bronze_key":{"key":true},"crypt_key":{"key":true},"glasses_case":{"key":true},"letter":{"key":true},"flour_sack":{"key":true},"hinge":{"key":true}}},"chapter1/music.json":{"schema":2,"music":{"village":{"bpm":100,"voices":{"p1":["e5 - - - g5 - c6 - b5 - a5 - g5 - - -","a5 - - - c6 - e6 - d6 - c6 - a5 - - -","f5 - - - a5 - c6 - a5 - g5 - f5 - - -","g5 - - - b5 - d6 - b5 - a5 - g5 - - .","e5 - g5 - e5 - d5 - c5 - - - d5 - e5 -","a4 - c5 - e5 - c5 - a4 - - - . . . .","f4 - a4 - c5 - f5 - e5 - d5 - c5 - a4 -","g4 - b4 - d5 - g5 - - - . . . . . ."],"p2":["c4 . e4 . g4 . e4 . c4 . e4 . g4 . e4 .","a3 . c4 . e4 . c4 . a3 . c4 . e4 . c4 .","f3 . a3 . c4 . a3 . f3 . a3 . c4 . a3 .","g3 . b3 . d4 . b3 . g3 . b3 . d4 . b3 ."],"tri":["c3 - - - . . c3 . g2 - - - . . g2 .","a2 - - - . . a2 . e2 - - - . . e2 .","f2 - - - . . f2 . c3 - - - . . c3 .","g2 - - - . . g2 . d3 - - - b2 - - -"]}},"road":{"bpm":116,"voices":{"p1":["d5 - g5 - b5 - a5 g5 f#5 - g5 - a5 - - -","e5 - g5 - c6 - b5 a5 g5 - e5 - g5 - - -","b4 - e5 - g5 - f#5 e5 d5 - e5 - g5 - - -","a4 - d5 - f#5 - e5 d5 e5 - f#5 - a5 - - -"],"p2":[". g4 . b4 . g4 . b4 . g4 . b4 . g4 . b4",". e4 . g4 . e4 . g4 . e4 . g4 . e4 . g4",". e4 . g4 . e4 . g4 . e4 . g4 . e4 . g4",". f#4 . a4 . f#4 . a4 . f#4 . a4 . f#4 . a4"],"tri":["g2 . g2 . d3 . g2 . g2 . d3 . g2 . b2 .","c3 . c3 . g2 . c3 . c3 . g2 . c3 . e3 .","e2 . e2 . b2 . e2 . e2 . b2 . e2 . g2 .","d2 . d2 . a2 . d2 . d2 . a2 . d3 . c3 ."],"drums":["k . h . s . h . k . h . s . h h"]}},"library":{"bpm":84,"voices":{"p3":["e5 - - - g5 - c6 - b5 - a5 - g5 - - -","a5 - - - c6 - e6 - d6 - c6 - a5 - - -","f5 - - - a5 - c6 - a5 - g5 - f5 - - -","g5 - - - b5 - d6 - b5 - a5 - g5 - - ."],"tri":["c3 - - - - - - - g2 - - - - - - -","a2 - - - - - - - e2 - - - - - - -","f2 - - - - - - - c3 - - - - - - -","g2 - - - - - - - d3 - - - - - - -"]}},"crypt":{"bpm":80,"voices":{"p3":["a4 - - - - - c5 - b4 - - - g#4 - - -","a4 - - - e5 - - - d5 - c5 - b4 - - -","f4 - - - - - a4 - g4 - - - e4 - - -","e4 - - - g#4 - - - b4 - - - - - - -"],"p2":["a3 . c4 . e4 . . . a3 . c4 . e4 . . .","a3 . c4 . e4 . . . a3 . c4 . e4 . . .","f3 . a3 . c4 . . . f3 . a3 . c4 . . .","e3 . g#3 . b3 . . . e3 . g#3 . b3 . . ."],"tri":["a2 - - - - - - - - - - - - - - -","a2 - - - - - - - - - - - - - - -","f2 - - - - - - - - - - - - - - -","e2 - - - - - - - - - - - - - - -"]}},"battle":{"bpm":150,"voices":{"p1":["e5 . e5 g5 . e5 b5 . a5 g5 . f#5 e5 . d5 .","e5 . e5 g5 . e5 b5 . c6 b5 . a5 g5 . a5 .","c5 . c5 e5 . c5 g5 . f#5 e5 . d5 c5 . b4 .","b4 . b4 d#5 . f#5 b5 . a5 . g5 . f#5 . d#5 ."],"p2":["e4 b4 e4 b4 e4 b4 e4 b4 e4 b4 e4 b4 e4 b4 e4 b4","e4 b4 e4 b4 e4 b4 e4 b4 e4 b4 e4 b4 e4 b4 e4 b4","c4 g4 c4 g4 c4 g4 c4 g4 c4 g4 c4 g4 c4 g4 c4 g4","b3 f#4 b3 f#4 b3 f#4 b3 f#4 b3 f#4 b3 f#4 b3 f#4 b3 f#4"],"tri":["e2 . e3 . e2 . e3 . e2 . e3 . e2 . e3 .","e2 . e3 . e2 . e3 . e2 . e3 . e2 . e3 .","c2 . c3 . c2 . c3 . c2 . c3 . c2 . c3 .","b1 . b2 . b1 . b2 . b1 . b2 . b1 . b2 ."],"drums":["k . h . s . h k k . h . s . s h"]}},"boss":{"bpm":144,"voices":{"p1":["d5 d5 . d5 f5 . e5 d5 c5 . a4 . c5 d5 . .","d5 d5 . d5 f5 . g5 f5 e5 . c5 . e5 f5 . .","a#4 a#4 . a#4 d5 . c5 a#4 a4 . f4 . a4 a#4 . .","a4 a4 . a4 c#5 . e5 c#5 a4 . e5 . c#5 a4 . ."],"p2":["d4 . a4 . d4 . a4 . d4 . a4 . d4 . a4 .","c4 . g4 . c4 . g4 . c4 . g4 . c4 . g4 .","a#3 . f4 . a#3 . f4 . a#3 . f4 . a#3 . f4 .","a3 . e4 . a3 . e4 . a3 . c#4 . e4 . a4 ."],"tri":["d2 d3 d2 d3 d2 d3 d2 d3 d2 d3 d2 d3 d2 d3 d2 d3","c2 c3 c2 c3 c2 c3 c2 c3 c2 c3 c2 c3 c2 c3 c2 c3","a#1 a#2 a#1 a#2 a#1 a#2 a#1 a#2 a#1 a#2 a#1 a#2 a#1 a#2 a#1 a#2","a1 a2 a1 a2 a1 a2 a1 a2 a1 a2 a1 a2 c#2 c#3 e2 e3"],"drums":["k . h . s . h k k . h . s . s h"]}}}},"chapter1/people.json":{"schema":2,"speakers":{"cat":{"name":"who.cat","pic":"cat_neutral"},"cat_happy":{"name":"who.cat","pic":"cat_happy","emote":"joy"},"cat_worried":{"name":"who.cat","pic":"cat_worried","emote":"worry"},"cat_surprised":{"name":"who.cat","pic":"cat_surprised","emote":"surprise"},"librarian":{"name":"who.librarian","pic":"librarian"},"baker":{"name":"who.baker","pic":"baker"},"shopkeeper":{"name":"who.shopkeeper","pic":"shopkeeper"},"child":{"name":"who.child","pic":"child"},"guard":{"name":"who.guard","pic":"guard"},"scribe":{"name":"who.scribe","pic":"blot_scribe"}},"npcs":{"librarian":{"row":"librarian","name":"who.librarian","pic":"librarian","voice":260,"pages":[{"if":{"quest":"main","step":["<=",0]},"lines":[["librarian","l.intro1"],["cat_worried","l.intro2"],["librarian","l.intro3"],["librarian","l.intro4"],["cat","l.intro5"]]},{"if":{"quest":"main","step":1},"lines":[["librarian","l.blots"]]},{"if":{"quest":"main","step":2},"lines":[["librarian","l.pieces",{"n":{"count":["page_1","page_2","page_3"]}}],["librarian",{"choose":[[{"not":{"has":"page_1"}},"l.hint1"],[{"not":{"has":"page_2"}},"l.hint2"]],"else":"l.hint3"}]]},{"if":{"quest":"main","step":3},"lines":[["librarian","l.end1"],["cat_happy","l.end2"],["librarian","l.end3"],["librarian","l.end4"]],"then":[{"flag":"chapter_done"},{"save":true},{"sfx":"quest"},{"music":"village"},{"end":true}]},{"lines":[["librarian","l.after"]]}]},"baker":{"row":"baker","name":"who.baker","pic":"baker","voice":300,"pages":[{"if":{"quest":"flap","step":["<",0]},"lines":[["baker","b.hello1"],["baker","b.hello2"],["cat","b.hello3"]],"then":[{"quest":"flap"}]},{"if":{"quest":"flap","step":0},"lines":[["baker","b.wait"]],"shop":["bread","milk"]},{"if":{"quest":"flap","step":1},"lines":[["baker","b.thanks1"],["baker","b.thanks2"],["cat_happy","b.thanks3"]]},{"lines":[["baker","b.after"]],"shop":["bread","milk"]}]},"shopkeeper":{"row":"shopkeeper","name":"who.shopkeeper","pic":"shopkeeper","voice":220,"mark":false,"pages":[{"lines":[["shopkeeper",{"choose":[[{"flag":"met_shop"},"s.again"]],"else":"s.hello"}]],"then":[{"flag":"met_shop"}],"shop":["milk","fish","ink_potion","scarf","vest","steel_quill","bell_charm"]}]},"guard":{"row":"guard","name":"who.guard","pic":"guard","voice":200,"pages":[{"if":{"quest":"glasses","step":["<",0]},"lines":[["guard","g.hello1"],["guard","g.hello2"]],"then":[{"quest":"glasses"}]},{"if":{"quest":"glasses","step":0},"lines":[["guard","g.wait"]]},{"if":{"quest":"glasses","step":1},"lines":[["guard","g.thanks1"],["guard","g.thanks2"]]},{"lines":[["guard",{"choose":[[{"any":[{"has":"crypt_key"},{"flag":"boss_done"}]},"g.crypt2"]],"else":"g.crypt"}]]}]},"child":{"row":"child","name":"who.child","pic":"child","voice":420,"pages":[{"lines":[["child",{"choose":[[{"quest":"main","step":["<=",1]},"c.1"],[{"not":{"flag":"skill_dash"}},"c.2"],[{"not":{"flag":"skill_well"}},"c.3"]],"else":"c.4"}]]}]}}},"chapter1/story.json":{"schema":2,"quests":{"main":{"name":"q.main","main":true,"steps":[{"text":"q.main.0","on":{"talk":"librarian"}},{"text":"q.main.1","on":{"defeat":"blot","n":2}},{"text":"q.main.2","on":{"check":{"all":[{"has":"page_1"},{"has":"page_2"},{"has":"page_3"}]}}},{"text":"q.main.3","on":{"talk":"librarian"}}],"reward":{"xp":30}},"flap":{"name":"q.flap","steps":[{"text":"q.flap.0","on":{"collect":"hinge"}},{"text":"q.flap.1","on":{"talk":"baker"},"then":[{"take":"hinge"}]}],"reward":{"item":"page_1","coins":15,"xp":12}},"glasses":{"name":"q.glasses","steps":[{"text":"q.glasses.0","on":{"collect":"glasses_case"}},{"text":"q.glasses.1","on":{"talk":"guard"},"then":[{"take":"glasses_case"}]}],"reward":{"item":"clover_charm","xp":10}}},"events":{"intro":[{"say":[["cat_surprised","i.1"],["cat","i.2"]],"name":"who.cat"},{"quest":"main"}],"mend":[{"if":{"all":[{"flag":"intro"},{"quest":"main","step":["<",0]}]},"then":[{"unflag":"intro"}]}],"texttest":[{"say":[["cat","tt.1"],["cat_surprised","tt.2"],["cat_happy","tt.3"],["cat_worried","tt.4"],["librarian","tt.5"],["cat","tt.6"]],"name":"who.statue","choices":[["tt.again",[{"call":"texttest"}]],["tt.bye",[]]]}],"statue":[{"if":{"flag":"skill_dash"},"then":[{"say":["st.done"],"name":"who.statue"}],"else":[{"say":["st.1","st.2"],"name":"who.statue","choices":[["st.a1",[{"sfx":"no"},{"say":["st.wrong"],"name":"who.statue"}]],["st.a2",[{"flag":"skill_dash"},{"sfx":"level"},{"toast":"toast.skill","vars":{"s":{"t":"skill.dash"}}},{"say":["st.right",{"choose":[[{"touch":true},"st.how.touch"]],"else":"st.how"}],"name":"who.statue"}]],["st.a3",[{"sfx":"no"},{"say":["st.wrong"],"name":"who.statue"}]]]}]}],"road_lever":[{"if":{"flag":"gate_open"},"then":[{"say":["lever.done"],"name":"act.lever"}],"else":[{"sfx":"door"},{"flag":"gate_open"},{"toast":"toast.gate"},{"reopen":true}]}],"crypt_lever":[{"if":{"flag":"crypt_gate"},"then":[{"say":["lever.done"],"name":"act.lever"}],"else":[{"if":{"var":"levers","is":[">",{"arg":"i"}]},"then":[{"sfx":"no"}],"else":[{"if":{"var":"levers","is":["<",{"arg":"i"}]},"then":[{"set":"levers","to":0},{"sfx":"no"},{"toast":"toast.levers.wrong"},{"shake":0.2},{"if":{"enemies":["<",3]},"then":[{"spawn":"bookworm","at":[12,14],"aware":true}]}],"else":[{"add":"levers","n":1},{"sfx":"door"},{"toast":"toast.levers","vars":{"n":{"var":"levers"}}},{"if":{"var":"levers","is":["==",3]},"then":[{"flag":"crypt_gate"},{"set":"levers","to":0},{"reopen":true}]}]}]}]}]}},"chapter2/areas/archive.json":{"schema":2,"areas":{"archive":{"name":"area.archive","tod":"nave","start":[18,19.4],"camNorth":1,"music":"stacks","strata":["#5c6678","#4e5868","#6a7488","#454e5c"],"legend":{"W":{"tile":"deck_plates","h":52,"wall":"#8a96a8"},"V":{"tile":"deck_plates","h":6,"wall":"#8a96a8"},"f":{"tile":"parquet_old"}},"map":["WWWWWWWWWWWWWWWWWW","WffffffffffffffffW","WffffffffffffffffW","WffffffffffffffffW","WffffffffffffffffW","WffffffffffffffffW","WffffffffffffffffW","WffffffffffffffffW","WffffffffffffffffW","WffffffffffffffffW","VVVVVVVVffVVVVVVVV"],"things":[{"id":"archive_shelf-1","key":"archive_shelf","at":[5,2.8],"act":{"label":"act.pull","name":"act.atlas_deneb","run":[{"call":"atlas","args":{"i":2}}]}},{"id":"archive_shelf-2","key":"archive_shelf","at":[11,2.8],"act":{"label":"act.pull","name":"act.atlas_polaris","run":[{"call":"atlas","args":{"i":3}}]}},{"id":"archive_shelf-3","key":"archive_shelf","at":[25,2.8],"act":{"label":"act.pull","name":"act.atlas_vega","run":[{"call":"atlas","args":{"i":0}}]}},{"id":"archive_shelf-4","key":"archive_shelf","at":[31,2.8],"act":{"label":"act.pull","name":"act.atlas_altair","run":[{"call":"atlas","args":{"i":1}}]}},{"id":"codex_case","key":"codex_case","at":[18,3.4],"chest":{"id":"ar_codex","item":"archivist_lens","name":"act.codex","lines":["ark.ar.codex1","ark.ar.codex2"]}},{"id":"archive_shelf-5","key":"archive_shelf","at":[6,9]},{"id":"archive_shelf-6","key":"archive_shelf","at":[12,9]},{"id":"archive_shelf-7","key":"archive_shelf","at":[24,9]},{"id":"archive_shelf-8","key":"archive_shelf","at":[30,9]},{"id":"archive_shelf-9","key":"archive_shelf","at":[6,14]},{"id":"archive_shelf-10","key":"archive_shelf","at":[12,14]},{"id":"archive_shelf-11","key":"archive_shelf","at":[24,14]},{"id":"archive_shelf-12","key":"archive_shelf","at":[30,14]},{"id":"ink_writing","key":"ink_writing","at":[9,11.6],"box":[0,0],"scan":"ar_books","look":{"label":"act.read","name":"act.writing","lines":["ark.ar.books1","ark.ar.books2"]}},{"id":"supply_crate","key":"supply_crate","at":[33.4,17.6],"scan":"ar_crate","chest":{"id":"ar_shard","item":"dark_shard","name":"act.crate","lines":["ark.ar.shard"]}},{"id":"chart_table","key":"chart_table","at":[27,18.4],"act":{"label":"act.read","name":"diary.varga","run":[{"flag":"diary_varga_2"},{"say":["ark.d.varga2.1","ark.d.varga2.2"],"name":"diary.varga","pic":"navigator"}]}},{"id":"reading_desk","key":"reading_desk","at":[8,18.4],"desk":true}],"lamps":[[9,3,5,3],[27,3,5,3],[18,3,12,3],[18,3,18,2.6]],"exits":[{"id":"to-spine","rect":[16,21.2,20,22],"to":"spine","at":[42,4.4],"face":[0,1]}],"onEnter":[{"set":"atlas","to":0},{"if":{"all":[{"flag":"ar_done"},{"not":{"flag":"archive_clear"}}]},"then":[{"wait":0.8},{"set":"archive_clear","to":0},{"spawn":"shadow","at":[8,6],"onDefeat":[{"add":"archive_clear","n":1},{"if":{"var":"archive_clear","is":["==",2]},"then":[{"flag":"archive_clear"},{"toast":"ark.enc.archive"}]}],"hunt":true},{"spawn":"shadow","at":[28,6],"onDefeat":[{"add":"archive_clear","n":1},{"if":{"var":"archive_clear","is":["==",2]},"then":[{"flag":"archive_clear"},{"toast":"ark.enc.archive"}]}],"hunt":true}]},{"if":{"all":[{"flag":"ar_done"},{"not":{"flag":"map_whole"}},{"not":{"has":"map_piece_2"}}]},"then":[{"drop":"map_piece_2","at":[18,6.2]}]}]}}},"chapter2/areas/bridge.json":{"schema":2,"areas":{"bridge":{"name":"area.bridge","tod":"emergenza","start":[32,7.2],"camNorth":1,"music":{"choose":[[{"all":[{"flag":"map_whole"},{"not":{"flag":"boss_done"}}]},"boss"]],"else":"stars"},"strata":["#5c6678","#4e5868","#6a7488","#454e5c"],"legend":{"W":{"tile":"deck_plates","h":52,"wall":"#8a96a8"},"V":{"tile":"deck_plates","h":6,"wall":"#8a96a8"},"b":{"tile":"deck_ink"},"d":{"tile":"carpet"}},"map":["WWWWWWWWWWWWWWWWWW","WbbbbbbbbbbbbbbbbW","WbbbbbbbbbbbbbbbbW","WbbbbbbddddbbbbbbW","WbbbbbbddddbbbbbbW","WbbbbbbddddbbbbbbW","WbbbbbbddddbbbbbbW","WbbbbbbbbbbbbbbbbW","WbbbbbbbbbbbbbbbbW","VVVVVVVVVVVVVVVVVV"],"atmos":{"bloom":0.8,"thr":0.4,"haze":0.06,"sat":1.1},"things":[{"id":"lift","key":"lift","at":[32,4.4],"act":{"label":"act.use","name":"act.lift","run":[{"call":"lift"}]}},{"id":"star_map_torn","key":"star_map_torn","at":[18,2.1],"when":{"not":{"flag":"map_whole"}},"act":{"label":"act.use","name":"act.starmap","run":[{"call":"restore"}]}},{"id":"star_map_whole","key":"star_map_whole","at":[18,2.1],"when":{"flag":"map_whole"},"look":{"label":"act.look","name":"act.starmap","lines":["ark.br.whole_look"]}},{"id":"console-1","key":"console","at":[10,6.4],"act":{"label":"act.talk","name":"who.vesper","run":[{"call":"vesper_claim"}]}},{"id":"console-2","key":"console","at":[26,6.4],"act":{"label":"act.read","name":"diary.vesper","run":[{"flag":"diary_vesper_2"},{"say":["ark.vlog2.1","ark.vlog2.2","ark.vlog2.3"],"name":"diary.vesper","pic":"vesper_glitch"}]}},{"id":"chair","key":"chair","at":[14,7.8],"rot":2,"look":{"label":"act.look","name":"act.helm","lines":["ark.br.helm"]}},{"id":"chart_table","key":"chart_table","at":[7,14.4]},{"id":"door_frame","key":"door_frame","at":[4,2.3],"when":{"flag":"boss_done"},"door":{"to":"observatory","at":[14,13.4],"face":[0,-1]}},{"id":"ink_stain-1","key":"ink_stain","at":[11,2.1],"act":{"label":"act.read","name":"act.stain","run":[{"say":["ark.stain.br"],"name":"act.stain"},{"if":{"has":"archivist_lens"},"then":[{"flag":"lens_stain"},{"say":["ark.lens.stain"],"name":"item.archivist_lens"}]}]}},{"id":"ink_stain-2","key":"ink_stain","at":[25,2.1]},{"id":"ink_steps","key":"ink_steps","at":[6,5.6],"box":[0,0],"look":{"label":"act.read","name":"act.steps","lines":["ark.br.steps"]}}],"lamps":[[10,3,7,3],[26,3,7,3],[18,3,12,3]],"onEnter":[{"if":{"all":[{"flag":"map_whole"},{"not":{"flag":"boss_done"}}]},"then":[{"wait":0.6},{"call":"boss"}]}]}}},"chapter2/areas/captain_cabin.json":{"schema":2,"areas":{"captain_cabin":{"name":"area.captain_cabin","tod":"nave","start":[10,11.4],"camNorth":1,"music":"ark","strata":["#5c6678","#4e5868","#6a7488","#454e5c"],"legend":{"w":{"tile":"deck_plates","h":52,"wall":"#d8dcd6"},"V":{"tile":"deck_plates","h":6,"wall":"#d8dcd6"},"d":{"tile":"carpet"}},"map":["wwwwwwwwww","wddddddddw","wddddddddw","wddddddddw","wddddddddw","wddddddddw","VVVVddVVVV"],"things":[{"id":"bunk","key":"bunk","at":[4.4,3]},{"id":"wall_screen","key":"wall_screen","at":[10,2.1],"act":{"label":"act.read","name":"diary.hale","run":[{"flag":"diary_hale_2"},{"say":["ark.d.hale2.1","ark.d.hale2.2","ark.d.hale2.3"],"name":"diary.hale","pic":"captain"}]}},{"id":"crew_locker","key":"crew_locker","at":[16.6,2.9],"chest":{"id":"cab_suit","item":"eva_suit","name":"act.locker","lines":["ark.cab.suit"]}},{"id":"chart_table","key":"chart_table","at":[14,7.4],"act":{"label":"act.read","name":"diary.hale","run":[{"flag":"diary_hale_1"},{"say":["ark.d.hale1.1","ark.d.hale1.2"],"name":"diary.hale","pic":"captain"}]}},{"id":"safe","key":"safe","at":[3.4,8.6],"act":{"label":"act.use","name":"act.safe","run":[{"if":{"flag":"cab_safe"},"then":[{"say":["ark.cab.safe_empty"],"name":"act.safe"}],"else":[{"keypad":"4071","name":"act.keypad","then":[{"flag":"cab_safe"},{"sfx":"chest"},{"toast":"ark.toast.safe"},{"drop":"badge_captain","at":[3,10.6]},{"drop":"map_piece_4","at":[5,10.6]}],"else":[{"sfx":"no"}]}]}]}},{"id":"ink_writing","key":"ink_writing","at":[7.6,10.2],"box":[0,0],"scan":"cab_code","look":{"label":"act.read","name":"act.writing","lines":["ark.cab.code"]}},{"id":"photo_frame","key":"photo_frame","at":[7.2,2.1],"look":{"label":"act.look","name":"act.photo","lines":["ark.cab.photo"]}}],"lamps":[[6,3,5,2.6],[14,3,8,2.6]],"exits":[{"id":"to-quarters","rect":[8,13.2,12,14],"to":"quarters","at":[46,7.4],"face":[0,1]}],"onEnter":[{"if":{"all":[{"flag":"cab_safe"},{"not":{"has":"badge_captain"}}]},"then":[{"drop":"badge_captain","at":[3,10.6]}]},{"if":{"all":[{"flag":"cab_safe"},{"not":{"flag":"map_whole"}},{"not":{"has":"map_piece_4"}}]},"then":[{"drop":"map_piece_4","at":[5,10.6]}]}]}}},"chapter2/areas/cryo_bay.json":{"schema":2,"areas":{"cryo_bay":{"name":"area.cryo_bay","tod":"nave","flicker":true,"start":[16,5.2],"camNorth":1,"music":"ark","strata":["#5c6678","#4e5868","#6a7488","#454e5c"],"legend":{"W":{"tile":"deck_plates","h":52,"wall":"#8a96a8"},"V":{"tile":"deck_plates","h":6,"wall":"#8a96a8"},"a":{"tile":"deck_plates"},"h":{"tile":"hazard"}},"map":["WWWWWWWWWWWWWW","WaaaaaaaaaaaaW","WaaaaaaaaaaaaW","WaaaaaaaaaaaaW","WaaaaaaaaaaaaW","WaaaaaaaaaaaaW","WhhhhhhhhhhhhW","WaaaaaaaaaaaaW","VVVVVVaaVVVVVV"],"things":[{"id":"cryo_pod-1","key":"cryo_pod","at":[4,2.9],"act":{"label":"act.read","name":"act.pod","run":[{"say":["ark.pod.hale"],"name":"act.pod"},{"if":{"has":"archivist_lens"},"then":[{"flag":"lens_pod"},{"say":["ark.lens.pod"],"name":"item.archivist_lens"}]}]}},{"id":"cryo_pod-2","key":"cryo_pod","at":[8,2.9],"look":{"label":"act.read","name":"act.pod","lines":["ark.pod.varga"]}},{"id":"cryo_pod-3","key":"cryo_pod","at":[12,2.9],"look":{"label":"act.read","name":"act.pod","lines":["ark.pod.okafor"]}},{"id":"cryo_pod_open","key":"cryo_pod_open","at":[16,2.9],"look":{"label":"act.read","name":"act.pod","lines":["ark.pod.cat"]}},{"id":"cryo_pod-4","key":"cryo_pod","at":[20,2.9],"look":{"label":"act.read","name":"act.pod","lines":["ark.pod.lind"]}},{"id":"cryo_pod-5","key":"cryo_pod","at":[24,2.9],"look":{"label":"act.read","name":"act.pod","lines":["ark.pod.sato"]}},{"id":"crew_locker-1","key":"crew_locker","at":[5,9.4],"chest":{"id":"cryo_quill","item":"quill_sword","name":"act.locker","lines":["ark.cryo.locker1"]}},{"id":"crew_locker-2","key":"crew_locker","at":[7,9.4],"chest":{"id":"cryo_suit","item":"ship_suit","name":"act.locker","lines":["ark.cryo.locker2"]}},{"id":"reading_desk","key":"reading_desk","at":[23,9.6],"desk":true},{"id":"coolant_tank","key":"coolant_tank","at":[26.2,13.6]},{"id":"cable_coil","key":"cable_coil","at":[20,13],"box":[0,0]},{"id":"floor_vent","key":"floor_vent","at":[9,15.4],"box":[0,0]}],"lamps":[[8,3,6,3],[20,3,6,3],[14,3,13,3]],"exits":[{"id":"to-spine","rect":[12,17.2,16,18],"to":"spine","at":[8,11.6],"face":[0,-1]}]}}},"chapter2/areas/engine_room.json":{"schema":2,"areas":{"engine_room":{"name":"area.engine_room","tod":"emergenza","flicker":true,"start":[32,7.2],"camNorth":1,"music":"engine","strata":["#5c6678","#4e5868","#6a7488","#454e5c"],"legend":{"W":{"tile":"deck_plates","h":52,"wall":"#8a96a8"},"V":{"tile":"deck_plates","h":6,"wall":"#8a96a8"},"c":{"tile":"grating"},"h":{"tile":"hazard"},"a":{"tile":"deck_plates"}},"map":["WWWWWWWWWWWWWWWWWW","WccccccccccccaaaaW","WccccccccccccaaaaW","WccccccccccccaaaaW","WhhhhhhhhhhhhaaaaW","WaaaaaaaaaaaaaaaaW","WaaaaaaaaaaaaaaaaW","WaaaaaaaaaaaaaaaaW","WaaaaaaaaaaaaaaaaW","VVVVVVVVVVVVVVVVVV"],"atmos":{"bloom":0.9,"thr":0.38,"haze":0.08,"sat":1.1,"motes":"embers"},"things":[{"id":"lift","key":"lift","at":[32,4.4],"act":{"label":"act.use","name":"act.lift","run":[{"call":"lift"}]}},{"id":"generator-1","key":"generator","at":[6,4.2],"look":{"label":"act.look","name":"act.generator","lines":["ark.en.gen"]}},{"id":"generator-2","key":"generator","at":[14,4.2]},{"id":"pipes","key":"pipes","at":[22.6,2.1]},{"id":"wall_screen","key":"wall_screen","at":[19,2.1],"act":{"label":"act.read","name":"diary.okafor","run":[{"flag":"diary_okafor_2"},{"say":["ark.d.okafor2.1","ark.d.okafor2.2","ark.d.okafor2.3"],"name":"diary.okafor","pic":"engineer"}]}},{"id":"coolant_tank-1","key":"coolant_tank","at":[3.4,12.6]},{"id":"coolant_tank-2","key":"coolant_tank","at":[6,12.6]},{"id":"power_switch-1","key":"power_switch","at":[11,12.4],"act":{"label":"act.use","name":"act.breaker_a","run":[{"if":{"flag":"power_on"},"then":[{"say":["ark.en.done"],"name":"act.breaker_a"}],"else":[{"if":{"flag":"sw_a"},"then":[{"unflag":"sw_a"},{"add":"load","n":-3}],"else":[{"flag":"sw_a"},{"add":"load","n":3}]},{"sfx":"move"},{"if":{"var":"load","is":[">",9]},"then":[{"unflag":"sw_a"},{"unflag":"sw_b"},{"unflag":"sw_c"},{"unflag":"sw_d"},{"set":"load","to":0},{"sfx":"no"},{"shake":0.3},{"toast":"ark.en.trip"}],"else":[{"if":{"all":[{"flag":"sw_d"},{"var":"load","is":["==",9]}]},"then":[{"flag":"power_on"},{"sfx":"quest"},{"toast":"ark.en.power"},{"reopen":true},{"wait":0.8},{"say":[["vesper","ark.en.vesper1"],["vesper_glitch","ark.en.vesper2"]]}],"else":[{"toast":"ark.en.load","vars":{"n":{"var":"load"}}}]}]}]}]}},{"id":"power_switch-2","key":"power_switch","at":[15,12.4],"act":{"label":"act.use","name":"act.breaker_b","run":[{"if":{"flag":"power_on"},"then":[{"say":["ark.en.done"],"name":"act.breaker_b"}],"else":[{"if":{"flag":"sw_b"},"then":[{"unflag":"sw_b"},{"add":"load","n":-4}],"else":[{"flag":"sw_b"},{"add":"load","n":4}]},{"sfx":"move"},{"if":{"var":"load","is":[">",9]},"then":[{"unflag":"sw_a"},{"unflag":"sw_b"},{"unflag":"sw_c"},{"unflag":"sw_d"},{"set":"load","to":0},{"sfx":"no"},{"shake":0.3},{"toast":"ark.en.trip"}],"else":[{"if":{"all":[{"flag":"sw_d"},{"var":"load","is":["==",9]}]},"then":[{"flag":"power_on"},{"sfx":"quest"},{"toast":"ark.en.power"},{"reopen":true},{"wait":0.8},{"say":[["vesper","ark.en.vesper1"],["vesper_glitch","ark.en.vesper2"]]}],"else":[{"toast":"ark.en.load","vars":{"n":{"var":"load"}}}]}]}]}]}},{"id":"power_switch-3","key":"power_switch","at":[19,12.4],"act":{"label":"act.use","name":"act.breaker_c","run":[{"if":{"flag":"power_on"},"then":[{"say":["ark.en.done"],"name":"act.breaker_c"}],"else":[{"if":{"flag":"sw_c"},"then":[{"unflag":"sw_c"},{"add":"load","n":-2}],"else":[{"flag":"sw_c"},{"add":"load","n":2}]},{"sfx":"move"},{"if":{"var":"load","is":[">",9]},"then":[{"unflag":"sw_a"},{"unflag":"sw_b"},{"unflag":"sw_c"},{"unflag":"sw_d"},{"set":"load","to":0},{"sfx":"no"},{"shake":0.3},{"toast":"ark.en.trip"}],"else":[{"if":{"all":[{"flag":"sw_d"},{"var":"load","is":["==",9]}]},"then":[{"flag":"power_on"},{"sfx":"quest"},{"toast":"ark.en.power"},{"reopen":true},{"wait":0.8},{"say":[["vesper","ark.en.vesper1"],["vesper_glitch","ark.en.vesper2"]]}],"else":[{"toast":"ark.en.load","vars":{"n":{"var":"load"}}}]}]}]}]}},{"id":"power_switch-4","key":"power_switch","at":[23,12.4],"act":{"label":"act.use","name":"act.breaker_d","run":[{"if":{"flag":"power_on"},"then":[{"say":["ark.en.done"],"name":"act.breaker_d"}],"else":[{"if":{"flag":"sw_d"},"then":[{"unflag":"sw_d"},{"add":"load","n":-5}],"else":[{"flag":"sw_d"},{"add":"load","n":5}]},{"sfx":"move"},{"if":{"var":"load","is":[">",9]},"then":[{"unflag":"sw_a"},{"unflag":"sw_b"},{"unflag":"sw_c"},{"unflag":"sw_d"},{"set":"load","to":0},{"sfx":"no"},{"shake":0.3},{"toast":"ark.en.trip"}],"else":[{"if":{"all":[{"flag":"sw_d"},{"var":"load","is":["==",9]}]},"then":[{"flag":"power_on"},{"sfx":"quest"},{"toast":"ark.en.power"},{"reopen":true},{"wait":0.8},{"say":[["vesper","ark.en.vesper1"],["vesper_glitch","ark.en.vesper2"]]}],"else":[{"toast":"ark.en.load","vars":{"n":{"var":"load"}}}]}]}]}]}},{"id":"ink_writing","key":"ink_writing","at":[23,14.6],"box":[0,0],"scan":"en_hand","look":{"label":"act.read","name":"act.writing","lines":["ark.en.hand"]}},{"id":"crew_locker","key":"crew_locker","at":[28.6,12.2],"when":{"flag":"power_on"},"chest":{"id":"en_piece","item":"map_piece_3","name":"act.locker","lines":["ark.en.piece"]}},{"id":"supply_crate","key":"supply_crate","at":[33,15.4],"chest":{"id":"en_quill","item":"plasma_quill","name":"act.crate","lines":["ark.en.quill"]}},{"id":"cable_coil","key":"cable_coil","at":[24,9],"box":[0,0]},{"id":"floor_vent","key":"floor_vent","at":[10,16],"box":[0,0]}],"lamps":[[10,3,7,3],[26,3,7,3],[18,3,15,3]],"onEnter":[{"if":{"not":{"flag":"power_on"}},"then":[{"unflag":"sw_a"},{"unflag":"sw_b"},{"unflag":"sw_c"},{"unflag":"sw_d"},{"set":"load","to":0}]},{"if":{"not":{"flag":"engine_clear"}},"then":[{"wait":0.8},{"set":"engine_clear","to":0},{"spawn":"drone","at":[12,9],"onDefeat":[{"add":"engine_clear","n":1},{"if":{"var":"engine_clear","is":["==",2]},"then":[{"flag":"engine_clear"},{"toast":"ark.enc.engine"}]}],"hunt":true},{"spawn":"drone","at":[24,10],"onDefeat":[{"add":"engine_clear","n":1},{"if":{"var":"engine_clear","is":["==",2]},"then":[{"flag":"engine_clear"},{"toast":"ark.enc.engine"}]}],"hunt":true}]}]}}},"chapter2/areas/greenhouse.json":{"schema":2,"areas":{"greenhouse":{"name":"area.greenhouse","tod":"nave","start":[18,17.4],"camNorth":1,"music":"garden","strata":["#5c6678","#4e5868","#6a7488","#454e5c"],"legend":{"w":{"tile":"deck_plates","h":52,"wall":"#d8dcd6"},"V":{"tile":"deck_plates","h":6,"wall":"#d8dcd6"},"a":{"tile":"deck_plates"},"e":{"tile":"soil"}},"map":["wwwwwwwwwwwwwwwwww","weeeeaaaaaaaaeeeew","weeeeaaaaaaaaeeeew","weeeeaaeeeeaaeeeew","weeeeaaeeeeaaeeeew","weeeeaaeeeeaaeeeew","weeeeaaeeeeaaeeeew","waaaaaaaaaaaaaaaaw","waaaaaaaaaaaaaaaaw","VVVVVVVVaaVVVVVVVV"],"atmos":{"bloom":0.6,"thr":0.45,"haze":0.08,"sat":1.12,"motes":"dust"},"things":[{"id":"olive-1","key":"olive","at":[18,9],"when":{"not":{"flag":"gh_bloom"}},"act":{"label":"act.look","name":"act.olive","run":[{"say":["ark.gh.olive1","ark.gh.olive2"],"name":"act.olive"},{"if":{"has":"archivist_lens"},"then":[{"flag":"lens_olive"},{"say":["ark.lens.olive"],"name":"item.archivist_lens"}]}]}},{"id":"olive-2","key":"olive","at":[18,9],"when":{"flag":"gh_bloom"},"look":{"label":"act.look","name":"act.olive","lines":["ark.gh.bloomed"]}},{"id":"bush-1","key":"bush","at":[15.4,12.6],"when":{"flag":"gh_bloom"},"box":[0,0]},{"id":"bush-2","key":"bush","at":[20.6,12.6],"when":{"flag":"gh_bloom"},"box":[0,0]},{"id":"plant_tank-1","key":"plant_tank","at":[5,3.4],"act":{"label":"act.read","name":"diary.lind","run":[{"flag":"diary_lind_2"},{"say":["ark.d.lind2.1","ark.d.lind2.2","ark.d.lind2.3"],"name":"diary.lind","pic":"botanist"}]}},{"id":"plant_tank-2","key":"plant_tank","at":[31,3.4]},{"id":"bush-3","key":"bush","at":[4.4,8.6]},{"id":"bush-4","key":"bush","at":[31.6,8.6]},{"id":"bush-5","key":"bush","at":[4.4,12.4]},{"id":"bush-6","key":"bush","at":[31.6,12.4]},{"id":"ink_steps","key":"ink_steps","at":[18,15.2],"box":[0,0],"scan":"gh_steps","look":{"label":"act.read","name":"act.steps","lines":["ark.gh.steps"]}},{"id":"power_switch","key":"power_switch","at":[9,2.8],"act":{"label":"act.use","name":"act.lamp","run":[{"if":{"flag":"gh_lamp"},"then":[{"unflag":"gh_lamp"},{"sfx":"move"},{"toast":"ark.gh.lamp_off"}],"else":[{"flag":"gh_lamp"},{"sfx":"move"},{"toast":"ark.gh.lamp_on"}]},{"call":"gh_check"}]}},{"id":"lever-1","key":"lever","at":[11,15.4],"box":[0.3,0.3],"act":{"label":"act.turn","name":"act.valve_beds","run":[{"if":{"flag":"gh_w1"},"then":[{"unflag":"gh_w1"},{"sfx":"move"},{"toast":"ark.gh.w1_off"}],"else":[{"flag":"gh_w1"},{"sfx":"move"},{"toast":"ark.gh.w1_on"}]},{"call":"gh_check"}]}},{"id":"lever-2","key":"lever","at":[25,15.4],"box":[0.3,0.3],"act":{"label":"act.turn","name":"act.valve_olive","run":[{"if":{"flag":"gh_w2"},"then":[{"unflag":"gh_w2"},{"sfx":"move"},{"toast":"ark.gh.w2_off"}],"else":[{"flag":"gh_w2"},{"sfx":"move"},{"toast":"ark.gh.w2_on"}]},{"call":"gh_check"}]}}],"lamps":[[10,3,6,3],[26,3,6,3],[18,3,14,3]],"exits":[{"id":"to-spine","rect":[16,19.2,20,20],"to":"spine","at":[34,4.4],"face":[0,1]}],"onEnter":[{"if":{"not":{"flag":"gh_seen"}},"then":[{"flag":"gh_seen"},{"flag":"gh_w1"}]},{"if":{"all":[{"flag":"gh_bloom"},{"not":{"flag":"map_whole"}},{"not":{"has":"map_piece_1"}}]},"then":[{"drop":"map_piece_1","at":[18,15.6]}]}]}}},"chapter2/areas/infirmary.json":{"schema":2,"areas":{"infirmary":{"name":"area.infirmary","tod":"nave","flicker":true,"start":[12,11.4],"camNorth":1,"music":"ark","strata":["#5c6678","#4e5868","#6a7488","#454e5c"],"legend":{"w":{"tile":"deck_plates","h":52,"wall":"#d8dcd6"},"V":{"tile":"deck_plates","h":6,"wall":"#d8dcd6"},"a":{"tile":"deck_plates"}},"map":["wwwwwwwwwwww","waaaaaaaaaaw","waaaaaaaaaaw","waaaaaaaaaaw","waaaaaaaaaaw","waaaaaaaaaaw","VVVVVaaVVVVV"],"things":[{"id":"med_bed-1","key":"med_bed","at":[6,4.2],"look":{"label":"act.look","name":"act.bed","lines":["ark.inf.bed1","ark.inf.bed2"]}},{"id":"med_bed-2","key":"med_bed","at":[16,4.2]},{"id":"wall_screen","key":"wall_screen","at":[11,2.1],"act":{"label":"act.read","name":"diary.sato","run":[{"flag":"diary_sato_2"},{"say":["ark.d.sato2.1","ark.d.sato2.2","ark.d.sato2.3"],"name":"diary.sato","pic":"doctor"}]}},{"id":"med_cabinet","key":"med_cabinet","at":[21.6,2.8],"chest":{"id":"inf_cells","item":"ink_cell","n":2,"name":"act.cabinet"}},{"id":"ink_stain","key":"ink_stain","at":[3,2.1],"when":{"flag":"photo_3"},"look":{"label":"act.read","name":"act.stain","lines":["ark.stain.inf"]}}],"lamps":[[6,3,5,2.6],[16,3,5,2.6]],"exits":[{"id":"to-spine","rect":[10,13.2,14,14],"to":"spine","at":[26,4.4],"face":[0,1]}]}}},"chapter2/areas/kit.json":{"schema":2,"areas":{"kit":{"name":"area.kit","tod":"nave","start":[16,16],"camNorth":1,"legend":{"W":{"tile":"deck_plates","h":52,"wall":"#8a96a8"},"w":{"tile":"deck_plates","h":52,"wall":"#d8dcd6"},"a":{"tile":"deck_plates"},"b":{"tile":"deck_ink"},"c":{"tile":"grating"},"d":{"tile":"carpet"},"e":{"tile":"soil"},"f":{"tile":"parquet_old"},"g":{"tile":"star_glass"},"h":{"tile":"hazard"}},"map":["WWWWWWWWWWWWWWWW","WaaaabbbbccccddW","WaaaabbbbccccddW","WaaaabbbbccccddW","WeeeeffffgggghhW","WeeeeffffgggghhW","WeeeeffffgggghhW","WaaaaaaaaaaaaaaW","WaaaaaaaaaaaaaaW","wwwwwwwaawwwwwww"],"things":[{"id":"cryo_pod","key":"cryo_pod","at":[4,2.4]},{"id":"cryo_pod_open","key":"cryo_pod_open","at":[7,2.4]},{"id":"crew_locker","key":"crew_locker","at":[10,2.2]},{"id":"archive_shelf","key":"archive_shelf","at":[15,2.2]},{"id":"console","key":"console","at":[22,2.6]},{"id":"power_switch","key":"power_switch","at":[27,2.2]},{"id":"codex_case","key":"codex_case","at":[4,9]},{"id":"plant_tank","key":"plant_tank","at":[9,9]},{"id":"telescope","key":"telescope","at":[18,10]},{"id":"bunk","key":"bunk","at":[24,9]},{"id":"supply_crate","key":"supply_crate","at":[28,9]}],"lamps":[[8,3,6,3],[24,3,6,3],[16,3,14,3]]}}},"chapter2/areas/kit_b.json":{"schema":2,"areas":{"kit_b":{"name":"area.kit_b","tod":"nave","start":[16,16],"camNorth":1,"legend":{"W":{"tile":"deck_plates","h":52,"wall":"#8a96a8"},"w":{"tile":"deck_plates","h":52,"wall":"#d8dcd6"},"a":{"tile":"deck_plates"},"d":{"tile":"carpet"},"c":{"tile":"grating"}},"map":["WWWWWWWWWWWWWWWW","WddddddddccccccW","WddddddddccccccW","WddddddddccccccW","WaaaaaaaaaaaaaaW","WaaaaaaaaaaaaaaW","WaaaaaaaaaaaaaaW","WaaaaaaaaaaaaaaW","WaaaaaaaaaaaaaaW","wwwwwwwaawwwwwww"],"things":[{"id":"photo_frame","key":"photo_frame","at":[4,2.1]},{"id":"wall_screen","key":"wall_screen","at":[9,2.1]},{"id":"porthole","key":"porthole","at":[13,2.1]},{"id":"pipes","key":"pipes","at":[21,2.1]},{"id":"generator","key":"generator","at":[28,3.2]},{"id":"mess_table","key":"mess_table","at":[5,6]},{"id":"chair","key":"chair","at":[5,8.2]},{"id":"med_bed","key":"med_bed","at":[12,6.4]},{"id":"med_cabinet","key":"med_cabinet","at":[17,5.6]},{"id":"coolant_tank","key":"coolant_tank","at":[22,6.6]},{"id":"cable_coil","key":"cable_coil","at":[25.5,6.4],"box":[0,0]},{"id":"safe","key":"safe","at":[4,12],"act":{"label":"act.use","name":"act.keypad","run":[{"keypad":"4071","name":"act.keypad","then":[{"flag":"kit_safe"},{"sfx":"chest"},{"toast":"toast.safe.open"}],"else":[{"sfx":"no"}]}]}},{"id":"chart_table","key":"chart_table","at":[9,12]},{"id":"toy_robot-1","key":"toy_robot","at":[13,11.6]},{"id":"floor_vent","key":"floor_vent","at":[16,11.6],"box":[0,0]},{"id":"door_frame","key":"door_frame","at":[21,12]},{"id":"lift","key":"lift","at":[28,12.4]},{"id":"crew_locker","key":"crew_locker","at":[26,9],"chest":{"id":"kit_locker","item":"ration","n":1}},{"id":"toy_robot-2","key":"toy_robot","at":[20,14.6],"scan":"kit_scan"}],"lamps":[[8,3,6,3],[24,3,6,3],[16,3,13,3]],"strata":["#5c6678","#4e5868","#6a7488","#454e5c"]}}},"chapter2/areas/mess.json":{"schema":2,"areas":{"mess":{"name":"area.mess","tod":"nave","start":[16,13.4],"camNorth":1,"music":"ark","strata":["#5c6678","#4e5868","#6a7488","#454e5c"],"legend":{"w":{"tile":"deck_plates","h":52,"wall":"#d8dcd6"},"V":{"tile":"deck_plates","h":6,"wall":"#d8dcd6"},"a":{"tile":"deck_plates"},"d":{"tile":"carpet"}},"map":["wwwwwwwwwwwwwwww","waaaaaaaaaaaaaaw","waddddddddddddaw","waddddddddddddaw","waddddddddddddaw","waddddddddddddaw","waaaaaaaaaaaaaaw","VVVVVVVaaVVVVVVV"],"things":[{"id":"photo_frame","key":"photo_frame","at":[16,2.1],"act":{"label":"act.look","name":"act.photo","run":[{"call":"photo"}]}},{"id":"porthole-1","key":"porthole","at":[6,2.1]},{"id":"porthole-2","key":"porthole","at":[26,2.1]},{"id":"ink_stain-1","key":"ink_stain","at":[10,2.1],"when":{"flag":"photo_3"},"look":{"label":"act.read","name":"act.stain","lines":["ark.stain.mess"]}},{"id":"ink_stain-2","key":"ink_stain","at":[22,2.1],"when":{"flag":"photo_5"},"look":{"label":"act.read","name":"act.stain","lines":["ark.stain.mess"]}},{"id":"mess_table-1","key":"mess_table","at":[10,6.6],"look":{"label":"act.look","name":"act.table","lines":["ark.mess.table1","ark.mess.table2"]}},{"id":"mess_table-2","key":"mess_table","at":[22,6.6]},{"id":"mess_table-3","key":"mess_table","at":[16,10.4]},{"id":"chair-1","key":"chair","at":[8,5]},{"id":"chair-2","key":"chair","at":[12,8.2],"rot":2},{"id":"chair-3","key":"chair","at":[20,5]},{"id":"chair-4","key":"chair","at":[24,8.2],"rot":2},{"id":"chair-5","key":"chair","at":[14,9.1]},{"id":"toy_robot-1","key":"toy_robot","at":[26,10.6],"when":{"not":{"flag":"photo_2"}},"look":{"label":"act.look","name":"act.toy","lines":["ark.mess.toy"]}},{"id":"toy_robot-2","key":"toy_robot","at":[5,12.4],"when":{"all":[{"flag":"photo_2"},{"not":{"flag":"photo_4"}}]},"look":{"label":"act.look","name":"act.toy","lines":["ark.mess.toy2"]}},{"id":"toy_robot-3","key":"toy_robot","at":[17,3.4],"when":{"flag":"photo_4"},"look":{"label":"act.look","name":"act.toy","lines":["ark.mess.toy3"]}},{"id":"supply_crate","key":"supply_crate","at":[28,12.4],"chest":{"id":"mess_crate","item":"ration","n":2,"name":"act.crate"}}],"lamps":[[10,3,6,3],[22,3,6,3]],"exits":[{"id":"to-spine","rect":[14,15.2,18,16],"to":"spine","at":[18,4.4],"face":[0,1]}],"onEnter":[{"if":{"flag":"photo_5"},"else":[{"if":{"flag":"photo_4"},"then":[{"flag":"photo_5"}],"else":[{"if":{"flag":"photo_3"},"then":[{"flag":"photo_4"}],"else":[{"if":{"flag":"photo_2"},"then":[{"flag":"photo_3"}],"else":[{"if":{"flag":"photo_1"},"then":[{"flag":"photo_2"}],"else":[{"if":{"flag":"mess_seen"},"then":[{"flag":"photo_1"}],"else":[{"flag":"mess_seen"}]}]}]}]}]}]}]}}},"chapter2/areas/observatory.json":{"schema":2,"areas":{"observatory":{"name":"area.observatory","tod":"nave","start":[14,13.4],"camNorth":1,"music":"stars","strata":["#5c6678","#4e5868","#6a7488","#454e5c"],"legend":{"W":{"tile":"deck_plates","h":52,"wall":"#8a96a8"},"V":{"tile":"deck_plates","h":6,"wall":"#8a96a8"},"g":{"tile":"star_glass"}},"map":["WWWWWWWWWWWWWW","WggggggggggggW","WggggggggggggW","WggggggggggggW","WggggggggggggW","WggggggggggggW","WggggggggggggW","VVVVVVggVVVVVV"],"things":[{"id":"telescope","key":"telescope","at":[14,5.4],"look":{"label":"act.look","name":"act.telescope","lines":["ark.ob.tele"]}},{"id":"porthole-1","key":"porthole","at":[6,2.1]},{"id":"porthole-2","key":"porthole","at":[22,2.1]}],"lamps":[[14,3,9,2.6]],"exits":[{"id":"to-bridge","rect":[12,15.2,16,16],"to":"bridge","at":[4,4.4],"face":[0,1]}],"onEnter":[{"if":{"not":{"flag":"chapter2_done"}},"then":[{"wait":0.8},{"call":"last_scene"}]}]}}},"chapter2/areas/quarters.json":{"schema":2,"areas":{"quarters":{"name":"area.quarters","tod":"nave","start":[24,13.4],"camNorth":1,"music":"ark","strata":["#5c6678","#4e5868","#6a7488","#454e5c"],"legend":{"W":{"tile":"deck_plates","h":52,"wall":"#8a96a8"},"V":{"tile":"deck_plates","h":6,"wall":"#8a96a8"},"a":{"tile":"deck_plates"},"d":{"tile":"carpet"}},"map":["WWWWWWWWWWWWWWWWWWWWWWWWWW","WddddWddddWddddWddddWddddW","WddddWddddWddddWddddWddddW","WddddWddddWddddWddddWddddW","WaaaaaaaaaaaaaaaaaaaaaaaaW","WaaaaaaaaaaaaaaaaaaaaaaaaW","WaaaaaaaaaaaaaaaaaaaaaaaaW","VVVVVVVVVVVaaVVVVVVVVVVVVV"],"things":[{"id":"bunk-1","key":"bunk","at":[4.6,3],"act":{"label":"act.read","name":"diary.varga","run":[{"flag":"diary_varga_1"},{"say":["ark.d.varga1.1","ark.d.varga1.2","ark.d.varga1.3"],"name":"diary.varga","pic":"navigator"}]}},{"id":"crew_locker-1","key":"crew_locker","at":[8.6,2.9],"chest":{"id":"q_scanner","item":"scanner","flag":"skill_scan","name":"act.locker","lines":["ark.q.scanner1","ark.q.scanner2"]}},{"id":"supply_crate","key":"supply_crate","at":[8.2,6.4],"chest":{"id":"q_badge_nav","item":"badge_navigator","name":"act.crate"}},{"id":"ink_writing","key":"ink_writing","at":[6,10.6],"box":[0,0],"scan":"q_writing","look":{"label":"act.read","name":"act.writing","lines":["ark.q.writing"]}},{"id":"bunk-2","key":"bunk","at":[14.6,3],"act":{"label":"act.read","name":"diary.lind","run":[{"flag":"diary_lind_1"},{"say":["ark.d.lind1.1","ark.d.lind1.2"],"name":"diary.lind","pic":"botanist"}]}},{"id":"crew_locker-2","key":"crew_locker","at":[18.6,2.9],"chest":{"id":"q_badge_bot","item":"badge_botanist","name":"act.locker","lines":["ark.q.badge_bot"]}},{"id":"plant_tank","key":"plant_tank","at":[16,6.6]},{"id":"bunk-3","key":"bunk","at":[24.6,3],"act":{"label":"act.read","name":"diary.okafor","run":[{"flag":"diary_okafor_1"},{"say":["ark.d.okafor1.1","ark.d.okafor1.2"],"name":"diary.okafor","pic":"engineer"}]}},{"id":"crew_locker-3","key":"crew_locker","at":[28.6,2.9],"when":{"not":{"flag":"q_eng_open"}},"act":{"label":"act.use","name":"act.keypad","run":[{"keypad":"3219","name":"act.keypad","then":[{"flag":"q_eng_open"},{"sfx":"door"},{"toast":"ark.toast.open"},{"reopen":true}],"else":[{"sfx":"no"}]}]}},{"id":"crew_locker-4","key":"crew_locker","at":[28.6,2.9],"when":{"flag":"q_eng_open"},"chest":{"id":"q_badge_eng","item":"badge_engineer","name":"act.locker","lines":["ark.q.badge_eng"]}},{"id":"cable_coil","key":"cable_coil","at":[26.4,6.8],"box":[0,0]},{"id":"bunk-4","key":"bunk","at":[34.6,3],"act":{"label":"act.read","name":"diary.sato","run":[{"flag":"diary_sato_1"},{"say":["ark.d.sato1.1","ark.d.sato1.2"],"name":"diary.sato","pic":"doctor"}]}},{"id":"crew_locker-5","key":"crew_locker","at":[38.6,2.9],"chest":{"id":"q_badge_doc","item":"badge_doctor","name":"act.locker","lines":["ark.q.badge_doc"]}},{"id":"med_cabinet","key":"med_cabinet","at":[36,6.8]},{"id":"door_frame-1","key":"door_frame","at":[46,2.3],"when":{"not":{"flag":"captain_door"}},"act":{"label":"act.use","name":"act.keypad","run":[{"keypad":"0611","name":"act.keypad","then":[{"flag":"captain_door"},{"sfx":"door"},{"toast":"ark.toast.door"},{"reopen":true}],"else":[{"sfx":"no"}]}]}},{"id":"door_frame-2","key":"door_frame","at":[46,2.3],"when":{"flag":"captain_door"},"door":{"to":"captain_cabin","at":[10,11.4],"face":[0,-1]}},{"id":"ink_stain","key":"ink_stain","at":[42.6,2.1],"when":{"flag":"photo_2"},"look":{"label":"act.read","name":"act.stain","lines":["ark.stain.q"]}}],"lamps":[[6,3,5,2.6],[16,3,5,2.6],[26,3,5,2.6],[36,3,5,2.6],[46,3,5,2.6],[24,3,12,3]],"exits":[{"id":"to-spine","rect":[22,15.2,26,16],"to":"spine","at":[8,4.4],"face":[0,1]}]}}},"chapter2/areas/spine.json":{"schema":2,"areas":{"spine":{"name":"area.spine","tod":"emergenza","start":[8,11.6],"camNorth":1,"music":"ark","strata":["#5c6678","#4e5868","#6a7488","#454e5c"],"legend":{"W":{"tile":"deck_plates","h":52,"wall":"#8a96a8"},"V":{"tile":"deck_plates","h":6,"wall":"#8a96a8"},"a":{"tile":"deck_plates"},"c":{"tile":"grating"},"h":{"tile":"hazard"}},"map":["WWWWWWWWWWWWWWWWWWWWWWWWWWWWWW","WaaaaaaaaaaaaaaaaaaaaaaaaaaaaW","WaaaaaaaaaaaaaaaaaaaaaaaaaaaaW","WccccccccccccccccccccccccchhhW","WaaaaaaaaaaaaaaaaaaaaaaaaaaaaW","WaaaaaaaaaaaaaaaaaaaaaaaaaaaaW","VVVaaVVVVVVVVVVVVVVVVVVVVVVVVV"],"atmos":{"bloom":0.8,"thr":0.4,"haze":0.06,"sat":1.1},"things":[{"id":"door_frame-1","key":"door_frame","at":[8,2.3],"door":{"to":"quarters","at":[24,13.4],"face":[0,-1]}},{"id":"wall_screen","key":"wall_screen","at":[13,2.1],"act":{"label":"act.read","name":"diary.vesper","run":[{"call":"vlog1"}]}},{"id":"door_frame-2","key":"door_frame","at":[18,2.3],"door":{"to":"mess","at":[16,13.4],"face":[0,-1]}},{"id":"ink_stain-1","key":"ink_stain","at":[22,2.1],"when":{"any":[{"has":"map_piece_1"},{"has":"map_piece_2"},{"has":"map_piece_3"},{"has":"map_piece_4"}]},"look":{"label":"act.read","name":"act.stain","lines":["ark.stain.1"]}},{"id":"door_frame-3","key":"door_frame","at":[26,2.3],"door":{"to":"infirmary","at":[12,11.4],"face":[0,-1],"need":"badge_doctor"}},{"id":"ink_stain-2","key":"ink_stain","at":[30,2.1],"when":{"flag":"power_on"},"look":{"label":"act.read","name":"act.stain","lines":["ark.stain.2"]}},{"id":"door_frame-4","key":"door_frame","at":[34,2.3],"door":{"to":"greenhouse","at":[18,17.4],"face":[0,-1],"need":"badge_botanist"}},{"id":"ink_stain-3","key":"ink_stain","at":[38,2.1],"when":{"flag":"map_whole"},"look":{"label":"act.read","name":"act.stain","lines":["ark.stain.3"]}},{"id":"door_frame-5","key":"door_frame","at":[42,2.3],"door":{"to":"archive","at":[18,19.4],"face":[0,-1]}},{"id":"door_frame-6","key":"door_frame","at":[50,2.3],"door":{"to":"storeroom","at":[12,11.4],"face":[0,-1],"need":"badge_navigator"}},{"id":"lift","key":"lift","at":[56,4.4],"act":{"label":"act.use","name":"act.lift","run":[{"call":"lift"}]}},{"id":"crew_locker","key":"crew_locker","at":[53.4,10.4],"when":{"flag":"power_on"},"chest":{"id":"vesper_locker","item":"vesper_badge","name":"act.locker","lines":["ark.vbadge"]}},{"id":"reading_desk","key":"reading_desk","at":[30,10.8],"desk":true},{"id":"ink_steps-1","key":"ink_steps","at":[44,8.2],"box":[0,0],"scan":"spine_steps","look":{"label":"act.read","name":"act.steps","lines":["ark.steps.1"]}},{"id":"ink_steps-2","key":"ink_steps","at":[50,7.4],"box":[0,0],"scan":"spine_steps","look":{"label":"act.read","name":"act.steps","lines":["ark.steps.2"]}},{"id":"pipes","key":"pipes","at":[3.6,2.1]},{"id":"floor_vent","key":"floor_vent","at":[36,11.4],"box":[0,0]}],"lamps":[[8,3,7,3],[22,3,7,3],[38,3,7,3],[52,3,7,3]],"exits":[{"id":"to-cryo_bay","rect":[6,13.2,10,14],"to":"cryo_bay","at":[14,15.4],"face":[0,-1]}],"onEnter":[{"if":{"all":[{"flag":"power_on"},{"not":{"flag":"spine_power_said"}}]},"then":[{"flag":"spine_power_said"},{"wait":0.6},{"say":[["vesper","ark.sp.power"]]}]},{"if":{"all":[{"flag":"spine_power_said"},{"not":{"flag":"spine_clear"}}]},"then":[{"wait":0.8},{"set":"spine_clear","to":0},{"spawn":"shadow","at":[40,8],"onDefeat":[{"add":"spine_clear","n":1},{"if":{"var":"spine_clear","is":["==",2]},"then":[{"flag":"spine_clear"},{"toast":"ark.enc.spine"}]}],"hunt":true},{"spawn":"drone","at":[24,9],"onDefeat":[{"add":"spine_clear","n":1},{"if":{"var":"spine_clear","is":["==",2]},"then":[{"flag":"spine_clear"},{"toast":"ark.enc.spine"}]}],"hunt":true}]}]}}},"chapter2/areas/storeroom.json":{"schema":2,"areas":{"storeroom":{"name":"area.storeroom","tod":"emergenza","start":[12,11.4],"camNorth":1,"music":"ark","strata":["#5c6678","#4e5868","#6a7488","#454e5c"],"legend":{"W":{"tile":"deck_plates","h":52,"wall":"#8a96a8"},"V":{"tile":"deck_plates","h":6,"wall":"#8a96a8"},"a":{"tile":"deck_plates"}},"map":["WWWWWWWWWWWW","WaaaaaaaaaaW","WaaaaaaaaaaW","WaaaaaaaaaaW","WaaaaaaaaaaW","WaaaaaaaaaaW","VVVVVaaVVVVV"],"atmos":{"bloom":0.8,"thr":0.4,"haze":0.06,"sat":1.1},"things":[{"id":"supply_crate-1","key":"supply_crate","at":[4,3.4],"chest":{"id":"st_rations","item":"ration","n":2,"name":"act.crate"}},{"id":"supply_crate-2","key":"supply_crate","at":[6.6,3.4],"look":{"label":"act.look","name":"act.crate","lines":["ark.st.seeds"]}},{"id":"supply_crate-3","key":"supply_crate","at":[4,6.2],"chest":{"id":"st_cells","item":"ink_cell","n":2,"name":"act.crate"}},{"id":"safe","key":"safe","at":[19.4,3.2],"act":{"label":"act.use","name":"act.safe","run":[{"if":{"flag":"st_safe"},"then":[{"say":["ark.cab.safe_empty"],"name":"act.safe"}],"else":[{"keypad":"1874","name":"act.keypad","then":[{"flag":"st_safe"},{"sfx":"chest"},{"toast":"ark.toast.safe"},{"drop":"star_compass","at":[19.4,5.4]}],"else":[{"sfx":"no"}]}]}]}},{"id":"coolant_tank","key":"coolant_tank","at":[21.6,9.6]},{"id":"ink_writing","key":"ink_writing","at":[9,8.6],"box":[0,0],"scan":"st_writing","look":{"label":"act.read","name":"act.writing","lines":["ark.st.writing"]}}],"lamps":[[6,3,5,2.6],[18,3,5,2.6]],"exits":[{"id":"to-spine","rect":[10,13.2,14,14],"to":"spine","at":[50,4.4],"face":[0,1]}],"onEnter":[{"if":{"all":[{"flag":"st_safe"},{"not":{"has":"star_compass"}}]},"then":[{"drop":"star_compass","at":[19.4,5.4]}]}]}}},"chapter2/enemies.json":{"schema":2,"enemies":{"shadow":{"sheet":"enemies-3","row":"shadow","hp":52,"atk":11,"def":2,"speed":1.4,"sight":9,"reach":1.9,"windup":0.7,"strike":0.45,"recover":1.2,"xp":10,"coins":[0,0],"r":0.55,"move":"smash","drops":[{"item":"ration","chance":0.2}]},"drone":{"sheet":"enemies-3","row":"drone","hp":30,"atk":10,"def":0,"speed":3.6,"sight":10,"reach":4.6,"windup":0.5,"strike":0.4,"recover":1.1,"xp":8,"coins":[0,0],"r":0.45,"move":"lunge","fly":0.6,"drops":[{"item":"ink_cell","chance":0.2}]},"what_remains":{"sheet":"boss-2","row":"what_remains","hp":700,"atk":12,"def":3,"speed":1.3,"sight":30,"reach":3.6,"xp":60,"coins":[0,0],"r":1.1,"poise":true,"size":1,"boss":"who.what_remains","anims":{"idle":["idle1","idle2"],"walk":["idle1","idle2"],"windup":["reach_windup"],"attack":["reach"],"summon":["what_remains_b.summon"],"pulse":["what_remains_b.pulse"],"hurt":["what_remains_b.hurt"],"defeat":["what_remains_b.defeat"]},"behaviour":"what_remains"}}},"chapter2/game.json":{"schema":2,"game":{"start":{"area":"cryo_bay"},"hero":{"sheet":"cat","views":{"down":"cat_down","up":"cat_up","side":"cat_side"},"anims":{"idle":["idle"],"walk":["walk1","walk2","walk3","walk4","walk5"],"attack1":["attack1"],"attack2":["attack2"],"attack3":["attack3"],"hurt":{"down":["cat_extra.hurt_down"],"up":["cat_extra.hurt_up"],"side":["cat_extra.hurt_side"]},"dodge":{"down":["cat_extra.dodge_down"],"up":["cat_extra.dodge_up"],"side":["cat_extra.dodge_side"]},"bored":{"down":["bored1","bored1","bored1","bored2","bored2","bored2","bored2","bored2","bored2","bored3","bored3","bored2","bored3","bored3","bored2","bored2","bored2","bored2"]},"swim":{"down":["swim1","swim2"],"up":["swim1","swim2"],"side":["swim1","swim2"]},"jump":{"down":["jump1","jump2"],"up":["jump1","jump2"],"side":["jump1","jump2"]},"climb":{"up":["climb1","climb2"]}},"equip":{"weapon":null,"armour":null,"charm":null},"start":{"level":3,"flags":["skill_dash","skill_well"]}},"levels":{"xp":[0,0,20,50,95,160],"base":{"hp":[24,6],"ink":[30,0],"atk":[5,2],"def":[1,1]}},"sheets":{"portraits":["portraits-1","portraits-2","portraits-cat"],"items":["items-2","items-1"],"people":"villagers"},"titleArt":["title","title"],"chapter":{"title":"chapter2.title","blurb":"chapter2.blurb","minutes":35,"order":2,"save":"mdv-rpg-cat-save-ch2","styles":["lowpoly"],"card":["title-2","title-2"],"doneFlag":"chapter2_done"},"intro":"intro","atmos":{"bloom":0.5,"thr":0.5,"haze":0.05,"sat":1.05},"hitFx":true}},"chapter2/items.json":{"schema":2,"items":{"quill_sword":{"slot":"weapon","atk":0,"price":0},"plasma_quill":{"slot":"weapon","atk":4,"price":0},"star_compass":{"slot":"weapon","atk":6,"price":0},"ship_suit":{"slot":"armour","def":1,"hp":4,"price":0},"eva_suit":{"slot":"armour","def":3,"hp":8,"price":0},"vesper_badge":{"slot":"charm","ink":15,"price":0},"archivist_lens":{"slot":"charm","def":1,"price":0},"dark_shard":{"slot":"charm","atk":4,"price":0},"ration":{"use":{"hp":12},"price":0},"ink_cell":{"use":{"ink":20},"price":0},"scanner":{"key":true},"map_piece_1":{"key":true},"map_piece_2":{"key":true},"map_piece_3":{"key":true},"map_piece_4":{"key":true},"badge_captain":{"key":true},"badge_navigator":{"key":true},"badge_engineer":{"key":true},"badge_botanist":{"key":true},"badge_doctor":{"key":true}}},"chapter2/music.json":{"schema":2,"music":{"ark":{"bpm":60,"voices":{"tri":["c2 - - - - - - - - - - - - - - -","c2 - - - - - - - - - - - - - - -","a#1 - - - - - - - - - - - - - - -","g1 - - - - - - - - - - - - - - -"],"p3":[". . . . g4 - - - . . . . . . . .",". . . . . . . . d#4 - - - c4 - - -",". . . . f4 - - - . . . . . . . .",". . d4 - - - . . . . . . . . . ."],"p2":["c3 . . . . . . . g3 . . . . . . .","c3 . . . . . . . g3 . . . . . . .","a#2 . . . . . . . f3 . . . . . . .","g2 . . . . . . . d3 . . . . . . ."]}},"garden":{"bpm":72,"voices":{"tri":["f2 - - - - - - - c3 - - - - - - -","d2 - - - - - - - a2 - - - - - - -","a#1 - - - - - - - f2 - - - - - - -","c2 - - - - - - - g2 - - - - - - -"],"p3":["a4 - - - c5 - - - . . f5 - e5 - - -","d5 - - - . . a4 - . . . . . . . .","a#4 - - - d5 - - - f5 - - - d5 - - -","c5 - - - . . . . e4 - - - . . . ."],"p2":["f3 . a3 . c4 . . . f3 . a3 . c4 . . .","d3 . f3 . a3 . . . d3 . f3 . a3 . . .","a#2 . d3 . f3 . . . a#2 . d3 . f3 . . .","c3 . e3 . g3 . . . c3 . e3 . g3 . . ."]}},"stacks":{"bpm":66,"voices":{"tri":["d2 - - - - - - - - - - - - - - -","a#1 - - - - - - - - - - - - - - -","g1 - - - - - - - - - - - - - - -","a1 - - - - - - - - - - - - - - -"],"p3":["d5 - - - . . f5 - e5 - - - d5 - - -",". . . . a4 - - - . . . . . . . .","g4 - - - a#4 - d5 - c5 - - - a#4 - - -","a4 - - - . . . . c#5 - - - . . . ."],"p2":["d3 . . . f3 . . . a3 . . . f3 . . .","a#2 . . . d3 . . . f3 . . . d3 . . .","g2 . . . a#2 . . . d3 . . . a#2 . . .","a2 . . . c#3 . . . e3 . . . c#3 . . ."]}},"engine":{"bpm":84,"voices":{"tri":["e1 . e1 . e1 . e1 . e1 . e1 . e1 . e1 .","e1 . e1 . e1 . e1 . e1 . e1 . e1 . e1 .","c2 . c2 . c2 . c2 . c2 . c2 . c2 . c2 .","d2 . d2 . d2 . d2 . b1 . b1 . b1 . b1 ."],"p3":[". . . . . . . . b3 - - - . . . .",". . . . . . . . a#3 - - - g3 - - -",". . . . . . . . c4 - - - . . . .",". . . . d4 - - - . . . . b3 - - -"],"drums":["k . . . h . . . k . . . h . . .","k . . . h . . . k . k . h . . ."]}},"stars":{"bpm":54,"voices":{"tri":["a1 - - - - - - - - - - - - - - -","f1 - - - - - - - - - - - - - - -","c2 - - - - - - - - - - - - - - -","g1 - - - - - - - - - - - - - - -"],"p3":["e5 - - - - - - - . . . . a4 - - -","c5 - - - - - - - . . . . . . . .","g5 - - - - - - - e5 - - - . . . .","d5 - - - - - - - b4 - - - - - - -"],"p2":[". . a3 . . . e4 . . . a3 . . . c4 .",". . f3 . . . c4 . . . f3 . . . a3 .",". . c4 . . . g4 . . . c4 . . . e4 .",". . g3 . . . d4 . . . g3 . . . b3 ."]}},"battle":{"bpm":132,"voices":{"tri":["c2 . c2 . c2 . d#2 . c2 . c2 . f2 . d#2 .","c2 . c2 . c2 . d#2 . c2 . c2 . g1 . a#1 ."],"p1":["c5 . . . d#5 . . . d5 . . . c5 . a#4 .","g4 . . . c5 . . . d#5 . d5 . c5 . . ."],"drums":["k . h . s . h . k . h . s . h h","k . h . s . h . k k h . s . h ."]}},"boss":{"bpm":144,"voices":{"tri":["d2 . d2 . d2 . d2 . a#1 . a#1 . a#1 . a#1 .","g1 . g1 . g1 . g1 . a1 . a1 . a1 . c#2 .","d2 . d2 . d2 . d2 . a#1 . a#1 . a#1 . a#1 .","g1 . g1 . a1 . a1 . d2 . . . . . . ."],"p1":["d5 . . f5 . . a5 . g5 . f5 . e5 . . .","d5 . . f5 . . a#5 . a5 . g5 . f5 . e5 .","d5 . . f5 . . a5 . c6 . a#5 . a5 . . .","g5 . f5 . e5 . c#5 . d5 - - - . . . ."],"p2":["d4 . a3 . d4 . a3 . a#3 . f3 . a#3 . f3 .","g3 . d3 . g3 . d3 . a3 . e3 . a3 . c#4 .","d4 . a3 . d4 . a3 . a#3 . f3 . a#3 . f3 .","g3 . d3 . a3 . e3 . d4 . . . . . . ."],"drums":["k . h . s . h . k . h k s . h h","k . h . s . h . k k h . s . s s"]}}}},"chapter2/people.json":{"schema":2,"speakers":{"cat":{"name":"who.cat","pic":"cat_neutral"},"cat_happy":{"name":"who.cat","pic":"cat_happy","emote":"joy"},"cat_worried":{"name":"who.cat","pic":"cat_worried","emote":"worry"},"cat_surprised":{"name":"who.cat","pic":"cat_surprised","emote":"surprise"},"vesper":{"name":"who.vesper","pic":"vesper"},"vesper_glitch":{"name":"who.vesper","pic":"vesper_glitch"},"what_remains":{"name":"who.what_remains","pic":"what_remains"}}},"chapter2/story.json":{"schema":2,"quests":{"ark":{"name":"q.ark","main":true,"steps":[{"text":"q.ark.0","on":{"collect":"quill_sword"}},{"text":"q.ark.1","on":{"reach":"quarters"}},{"text":"q.ark.2","on":{"check":{"all":[{"has":"map_piece_1"},{"has":"map_piece_2"},{"has":"map_piece_3"},{"has":"map_piece_4"}]}}},{"text":"q.ark.3","on":{"flag":"map_whole"}},{"text":"q.ark.4","on":{"reach":"observatory"}}],"reward":{"xp":40}}},"events":{"intro":[{"say":[["vesper_glitch","ark.in.1"],["cat_worried","ark.in.2"],["vesper","ark.in.3"],["cat","ark.in.4"],["vesper_glitch","ark.in.5"],["vesper","ark.in.6"]]},{"quest":"ark"}],"lift":[{"say":[["vesper","ark.lift.ask"]],"choices":[["ark.lift.main",[{"go":"spine","at":[56,7.2],"face":[0,1]}]],["ark.lift.engine",[{"if":{"has":"badge_engineer"},"then":[{"go":"engine_room","at":[32,7.2],"face":[0,1]}],"else":[{"say":[["vesper","ark.lift.noeng"]]}]}]],["ark.lift.bridge",[{"if":{"not":{"flag":"power_on"}},"then":[{"say":[["vesper","ark.lift.nopower"]]}],"else":[{"if":{"has":"badge_captain"},"then":[{"go":"bridge","at":[32,7.2],"face":[0,1]}],"else":[{"say":[["vesper","ark.lift.nocap"]]}]}]}]]]}],"vlog1":[{"flag":"diary_vesper_1"},{"say":["ark.vlog1.1","ark.vlog1.2","ark.vlog1.3"],"name":"diary.vesper","pic":"vesper"}],"photo":[{"say":["ark.ph.0"],"name":"act.photo"},{"if":{"flag":"photo_1"},"then":[{"say":["ark.ph.varga.ink"],"name":"who.varga","pic":"ink_crew"}],"else":[{"say":["ark.ph.varga"],"name":"who.varga","pic":"navigator"}]},{"if":{"flag":"photo_2"},"then":[{"say":["ark.ph.okafor.ink"],"name":"who.okafor","pic":"ink_crew"}],"else":[{"say":["ark.ph.okafor"],"name":"who.okafor","pic":"engineer"}]},{"if":{"flag":"photo_3"},"then":[{"say":["ark.ph.lind.ink"],"name":"who.lind","pic":"ink_crew"}],"else":[{"say":["ark.ph.lind"],"name":"who.lind","pic":"botanist"}]},{"if":{"flag":"photo_4"},"then":[{"say":["ark.ph.sato.ink"],"name":"who.sato","pic":"ink_crew"}],"else":[{"say":["ark.ph.sato"],"name":"who.sato","pic":"doctor"}]},{"if":{"flag":"photo_5"},"then":[{"say":["ark.ph.hale.ink"],"name":"who.hale","pic":"ink_crew"}],"else":[{"say":["ark.ph.hale"],"name":"who.hale","pic":"captain"}]},{"if":{"flag":"photo_1"},"then":[{"say":[["cat_worried","ark.ph.cat1"]]}],"else":[{"say":[["cat","ark.ph.cat0"]]}]},{"if":{"has":"archivist_lens"},"then":[{"flag":"lens_photo"},{"say":["ark.lens.photo"],"name":"item.archivist_lens"}]}],"gh_check":[{"if":{"all":[{"flag":"gh_w2"},{"flag":"gh_lamp"},{"not":{"flag":"gh_w1"}},{"not":{"flag":"gh_bloom"}}]},"then":[{"flag":"gh_bloom"},{"sfx":"quest"},{"drop":"map_piece_1","at":[18,15.6]},{"reopen":true},{"wait":1.2},{"say":[["cat_happy","ark.gh.bloom1"],["vesper","ark.gh.bloom2"]]}]}],"atlas":[{"if":{"flag":"ar_done"},"then":[{"say":["ark.ar.done"],"name":"act.atlas"}],"else":[{"if":{"var":"atlas","is":["==",{"arg":"i"}]},"then":[{"add":"atlas","n":1},{"sfx":"door"},{"toast":"ark.ar.right","vars":{"n":{"var":"atlas"}}},{"if":{"var":"atlas","is":["==",4]},"then":[{"flag":"ar_done"},{"sfx":"quest"},{"drop":"map_piece_2","at":[18,6.2]},{"wait":0.6},{"say":[["cat_happy","ark.ar.piece1"],["vesper","ark.ar.piece2"]]},{"wait":0.4},{"say":[["cat_surprised","ark.enc.archive0"]]},{"set":"archive_clear","to":0},{"spawn":"shadow","at":[8,6],"onDefeat":[{"add":"archive_clear","n":1},{"if":{"var":"archive_clear","is":["==",2]},"then":[{"flag":"archive_clear"},{"toast":"ark.enc.archive"}]}],"hunt":true},{"spawn":"shadow","at":[28,6],"onDefeat":[{"add":"archive_clear","n":1},{"if":{"var":"archive_clear","is":["==",2]},"then":[{"flag":"archive_clear"},{"toast":"ark.enc.archive"}]}],"hunt":true}]}],"else":[{"set":"atlas","to":0},{"sfx":"no"},{"shake":0.2},{"toast":"ark.ar.wrong"}]}]}],"restore":[{"if":{"all":[{"has":"map_piece_1"},{"has":"map_piece_2"},{"has":"map_piece_3"},{"has":"map_piece_4"}]},"then":[{"take":"map_piece_1"},{"take":"map_piece_2"},{"take":"map_piece_3"},{"take":"map_piece_4"},{"flag":"map_whole"},{"sfx":"quest"},{"say":[["vesper","ark.br.whole1"],["cat_happy","ark.br.whole2"],["vesper_glitch","ark.br.whole3"]]},{"reopen":true}],"else":[{"say":["ark.br.torn"],"name":"act.starmap"},{"toast":"ark.br.pieces","vars":{"n":{"count":["map_piece_1","map_piece_2","map_piece_3","map_piece_4"]}}}]}],"vesper_claim":[{"if":{"flag":"claim_done"},"then":[{"say":[["vesper","ark.br.after"]]}],"else":[{"say":[["vesper","ark.br.v1"],["cat","ark.br.c1"],["vesper_glitch","ark.br.v2"]],"choices":[["ark.br.ch_vesper",[{"flag":"trust_vesper"},{"say":[["cat","ark.br.c_vesper"]]}]],["ark.br.ch_diary",[{"flag":"trust_diary"},{"say":[["cat","ark.br.c_diary"]]}]]]},{"flag":"claim_done"}]}],"last_scene":[{"say":[["vesper","ark.ob.1"],["cat","ark.ob.2"],["vesper","ark.ob.3"],["vesper_glitch","ark.ob.4"]]},{"if":{"flag":"trust_vesper"},"then":[{"say":[["vesper","ark.ob.5v"]]}],"else":[{"if":{"flag":"trust_diary"},"then":[{"say":[["vesper","ark.ob.5d"]]}],"else":[{"say":[["vesper","ark.ob.5n"]]}]}]},{"say":[["cat","ark.ob.6"]]},{"shake":0.4},{"say":["ark.ob.7"],"name":"act.telescope"},{"say":[["cat_worried","ark.ob.8"]]},{"flag":"chapter2_done"},{"save":true},{"sfx":"quest"},{"end":true}],"boss":[{"spawn":"what_remains","at":[18,9],"onDefeat":[{"flag":"boss_done"},{"toast":"ark.wr.done"},{"reopen":true},{"wait":1},{"say":[["vesper","ark.wr.after"]]}],"hunt":true},{"wait":0.7},{"if":{"all":[{"area":"bridge"},{"dialogue":false}]},"then":[{"say":[["what_remains","ark.wr.1"],["cat_worried","ark.wr.2"],["what_remains","ark.wr.3"]]}]}]}},"chapter3/areas/kit.json":{"schema":2,"areas":{"kit3":{"name":"area.town","tod":"giorno","start":[24,25],"camNorth":1,"music":"town","legend":{"s":{"tile":"west_sand"},"b":{"tile":"west_boards"},"r":{"tile":"mine_rock"},"t":{"tile":"mine_rails"},"i":{"tile":"mine_ink"}},"map":["ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssssssssssssssssssssssssssssssssssssssss","ssssssssssbbbbbbbbbbrrrrrrrrrrttttttttttiiiiiiii"],"things":[{"id":"west_saloon","key":"west_saloon","at":[6,6]},{"id":"west_store","key":"west_store","at":[14.5,5.75]},{"id":"west_sheriff","key":"west_sheriff","at":[21.63,5.75]},{"id":"west_church","key":"west_church","at":[28.25,6]},{"id":"west_undertaker","key":"west_undertaker","at":[34.5,5.75]},{"id":"west_house","key":"west_house","at":[40.5,5.75]},{"id":"west_water_tower","key":"west_water_tower","at":[3.63,11.63]},{"id":"west_windmill","key":"west_windmill","at":[8.13,11.25]},{"id":"west_stagecoach","key":"west_stagecoach","at":[14,11.25]},{"id":"west_hitch","key":"west_hitch","at":[19.75,10.19]},{"id":"west_barrel","key":"west_barrel","at":[23.06,10.56]},{"id":"west_crate","key":"west_crate","at":[25.75,10.63]},{"id":"west_trough","key":"west_trough","at":[29.13,10.44]},{"id":"west_cactus","key":"west_cactus","at":[32.81,10.31]},{"id":"west_cactus_small","key":"west_cactus_small","at":[35.94,10.5]},{"id":"west_rock","key":"west_rock","at":[39.47,11.06]},{"id":"west_mesa","key":"west_mesa","at":[4,16.75]},{"id":"west_wanted","key":"west_wanted","at":[8.75,15.44]},{"id":"west_lamp","key":"west_lamp","at":[11.81,15.56]},{"id":"west_bar","key":"west_bar","at":[16.63,15.88]},{"id":"west_table","key":"west_table","at":[22,16.13]},{"id":"west_piano","key":"west_piano","at":[25.88,15.88]},{"id":"west_desk","key":"west_desk","at":[30.25,15.94]},{"id":"west_cell","key":"west_cell","at":[34.88,15.5]},{"id":"west_gunrack","key":"west_gunrack","at":[39.38,15.38]},{"id":"west_shelf","key":"west_shelf","at":[4,20.5]},{"id":"west_headframe","key":"west_headframe","at":[10.13,21.75]},{"id":"west_cart","key":"west_cart","at":[15.19,20.88]},{"id":"west_post","key":"west_post","at":[18.13,20.63]},{"id":"west_lantern","key":"west_lantern","at":[20.38,20.5]},{"id":"west_rubble","key":"west_rubble","at":[23.5,21.25]},{"id":"west_lift","key":"west_lift","at":[27.88,21.5]},{"id":"west_dynabox","key":"west_dynabox","at":[31.56,20.81]},{"id":"west_vein","key":"west_vein","at":[35,20.44]},{"id":"west_ink_pool","key":"west_ink_pool","at":[4,26.5]},{"id":"west_silhouette","key":"west_silhouette","at":[8,25.6]},{"id":"west_collapse","key":"west_collapse","at":[13,26.5]},{"id":"west_collapse_open","key":"west_collapse_open","at":[19,26.5]},{"id":"west_stalagmite","key":"west_stalagmite","at":[23,26.5]},{"id":"west_flooded_cart","key":"west_flooded_cart","at":[26.5,26.5]},{"id":"west_vein_big","key":"west_vein_big","at":[34,25.8]},{"id":"west_tendril","key":"west_tendril","at":[40,26.5]},{"id":"west_strongbox","key":"west_strongbox","at":[43,26.5]},{"id":"west_diary","key":"west_diary","at":[4,31]},{"id":"west_coffin","key":"west_coffin","at":[8,31]},{"id":"west_coffin_up","key":"west_coffin_up","at":[12,30.4]},{"id":"west_stained_wall","key":"west_stained_wall","at":[17,30.1]},{"id":"west_workbench","key":"west_workbench","at":[23,31]}]}}},"chapter3/areas/mine_1.json":{"schema":2,"areas":{"mine_1":{"name":"area.mine_1","tod":"cripta","start":[12,37],"camNorth":1,"music":"mine","legend":{"R":{"tile":"mine_rock","h":52,"wall":"#6a5648"},"K":{"tile":"mine_rock","h":20,"wall":"#6a5648"},"L":{"tile":"mine_rock","h":6,"wall":"#6a5648"},"r":{"tile":"mine_rock"},"t":{"tile":"mine_rails"},"p":{"tile":"mine_boards"}},"map":["RRRRRRRRRRRRRR","RKKrrrrrrrrKKR","RKKrrrrrrrrKKR","RKKrrrrrrrrKKR","RKKKKKrrKKKKKR","RKKKKKrrKKKKKR","RrrrrrrrrrrrrR","RrrrKKKKKKrrrR","RrrrKKKKKKrrrR","RrrrrrrrrrrrrR","RKKKKKKKKKrrKR","RKKKKKKKKKrrKR","RrrrrrrrrrrrKR","RttttttttttrKR","RrrrrrrrrrrrKR","RrrKKKKKKKKKKR","RrrKKKKKKKKKKR","RrrrrrrrrrrrKR","RrrrrrrrrrrrKR","LLLLLppLLLLLLL"],"atmos":{"bloom":1.2,"thr":0.3,"haze":0.12,"sat":1.15,"motes":"embers"},"things":[{"id":"west_lantern-1","key":"west_lantern","at":[6.2,4],"rot":1},{"id":"west_lantern-2","key":"west_lantern","at":[21.8,7],"rot":3},{"id":"west_lantern-3","key":"west_lantern","at":[2.2,14],"rot":1},{"id":"west_lantern-4","key":"west_lantern","at":[25.8,13],"rot":3},{"id":"west_lantern-5","key":"west_lantern","at":[2.2,19],"rot":1},{"id":"west_lantern-6","key":"west_lantern","at":[23.8,21],"rot":3},{"id":"west_lantern-7","key":"west_lantern","at":[2.2,27],"rot":1},{"id":"west_lantern-8","key":"west_lantern","at":[23.8,25],"rot":3},{"id":"west_lantern-9","key":"west_lantern","at":[2.2,31],"rot":1},{"id":"west_lantern-10","key":"west_lantern","at":[2.2,36],"rot":1},{"id":"west_lantern-11","key":"west_lantern","at":[23.8,36],"rot":3},{"id":"west_cart-1","key":"west_cart","at":[10,26.6]},{"id":"west_cart-2","key":"west_cart","at":[17,26.6]},{"id":"west_dynabox","key":"west_dynabox","at":[21,24.6]},{"id":"west_rubble-1","key":"west_rubble","at":[20,35]},{"id":"west_cart-3","key":"west_cart","at":[20,15]},{"id":"west_rubble-2","key":"west_rubble","at":[8,16.6]},{"id":"west_post-1","key":"west_post","at":[11.2,9.4]},{"id":"west_post-2","key":"west_post","at":[16.8,9.4],"flip":true},{"id":"west_lift","key":"west_lift","at":[14,3.3],"act":{"label":"act.use","name":"act.lift","run":[{"if":{"has":"lift_key"},"then":[{"flag":"mine2_reached"},{"say":["red.lift.go2"],"name":"act.lift"},{"go":"mine_2","at":[5.8,29],"face":[0,-1]}],"else":[{"say":["red.lift.locked"],"name":"act.lift"}]}]}},{"id":"west_vein","key":"west_vein","at":[9.4,2.4],"look":{"label":"act.look","name":"act.vein","lines":["red.vein"]}},{"id":"reading_desk","key":"reading_desk","at":[5,35.6],"desk":true},{"id":"west_diary","key":"west_diary","at":[22,34.6],"chest":{"id":"page1","item":"diary_page","lines":["red.page.1"],"name":"act.page"}}],"lamps":[[6.6000000000000005,2.2,4,4.6,1.5],[21.400000000000002,2.2,7,4.6,1.5],[2.6,2.2,14,4.6,1.5],[25.400000000000002,2.2,13,4.6,1.5],[2.6,2.2,19,4.6,1.5],[23.400000000000002,2.2,21,4.6,1.5],[2.6,2.2,27,4.6,1.5],[23.400000000000002,2.2,25,4.6,1.5],[2.6,2.2,31,4.6,1.5],[2.6,2.2,36,4.6,1.5],[23.400000000000002,2.2,36,4.6,1.5]],"spawns":[{"id":"gunman-1","type":"gunman","at":[6,25.5]},{"id":"knifer-1","type":"knifer","at":[19,28.5]},{"id":"gunman-2","type":"gunman","at":[23,13]},{"id":"dynamiter","type":"dynamiter","at":[5,13]},{"id":"knifer-2","type":"knifer","at":[14,18.5]}],"exits":[{"id":"to-town","rect":[10,38.6,14,40],"to":"town","at":[53,12.4],"face":[0,1]}],"onEnter":[{"if":{"not":{"flag":"lt_done"}},"then":[{"spawn":"lieutenant","at":[14,6],"onDefeat":[{"flag":"lt_done"},{"drop":"lift_key","at":[14,7]},{"toast":"red.toast.lt"}]}]},{"if":{"all":[{"flag":"lt_done"},{"not":{"has":"lift_key"}}]},"then":[{"drop":"lift_key","at":[14,7]}]}]}}},"chapter3/areas/mine_2.json":{"schema":2,"areas":{"mine_2":{"name":"area.mine_2","tod":"cripta","start":[5.8,29],"camNorth":1,"music":"mine","legend":{"R":{"tile":"mine_rock","h":52,"wall":"#6a5648"},"K":{"tile":"mine_rock","h":20,"wall":"#6a5648"},"L":{"tile":"mine_rock","h":6,"wall":"#6a5648"},"r":{"tile":"mine_rock"},"t":{"tile":"mine_rails"},"p":{"tile":"mine_boards"},"i":{"tile":"mine_pool","harm":6}},"map":["RRRRRRRRRRRR","RKKrrrrrrKKR","RKKrrrrrrKKR","RKKKKrrKKKKR","RKKKKrrKKKKR","RrrrrrrrrrrR","RrriirrrriiR","RriiirrriirR","RrrrrrrrrrrR","RrrKKrrKKrrR","RrrKKrrKKrrR","RrrrrrrrKrrR","RttttttrKiiR","RrrrrrrrKrrR","RrrrrrrrKrrR","LLLLLLLLLLLL"],"atmos":{"bloom":1.3,"thr":0.28,"haze":0.14,"sat":1.12,"motes":"ink"},"things":[{"id":"west_lantern-1","key":"west_lantern","at":[6.2,3],"rot":1},{"id":"west_lantern-2","key":"west_lantern","at":[17.8,3],"rot":3},{"id":"west_lantern-3","key":"west_lantern","at":[2.2,12],"rot":1},{"id":"west_lantern-4","key":"west_lantern","at":[21.8,14],"rot":3},{"id":"west_lantern-5","key":"west_lantern","at":[2.2,20.4],"rot":1},{"id":"west_lantern-6","key":"west_lantern","at":[15.8,23],"rot":3},{"id":"west_lift","key":"west_lift","at":[3.6,26.2],"act":{"label":"act.use","name":"act.lift","run":[{"say":["red.lift.up"],"name":"act.lift"},{"go":"mine_1","at":[14,6.6],"face":[0,1]}]}},{"id":"west_dynabox","key":"west_dynabox","at":[7,22.6],"act":{"label":"act.look","name":"act.dynabox","run":[{"if":{"all":[{"not":{"has":"dynamite"}},{"not":{"flag":"collapse_open"}}]},"then":[{"say":["red.dynabox.give"],"name":"act.dynabox"},{"drop":"dynamite","at":[8.4,24.2]}],"else":[{"say":["red.dynabox.empty"],"name":"act.dynabox"}]}]}},{"id":"west_collapse","key":"west_collapse","at":[12,7],"when":{"not":{"flag":"collapse_open"}},"act":{"label":"act.use","name":"act.collapse","run":[{"if":{"has":"dynamite"},"then":[{"take":"dynamite"},{"say":["red.collapse.go"],"name":"act.collapse"},{"sfx":"slam"},{"shake":0.6},{"flag":"collapse_open"},{"reopen":true}],"else":[{"say":["red.collapse.no"],"name":"act.collapse"}]}]}},{"id":"west_collapse_open","key":"west_collapse_open","at":[12,7],"box":[0,0],"when":{"flag":"collapse_open"}},{"id":"west_silhouette-1","key":"west_silhouette","at":[5,10.07],"look":{"label":"act.look","name":"act.silhouette","lines":["red.silhouette"]}},{"id":"west_silhouette-2","key":"west_silhouette","at":[19,10.07],"flip":true,"look":{"label":"act.look","name":"act.silhouette","lines":["red.silhouette2"]}},{"id":"west_flooded_cart","key":"west_flooded_cart","at":[9,16.4]},{"id":"west_stalagmite-1","key":"west_stalagmite","at":[3.4,16.6]},{"id":"west_stalagmite-2","key":"west_stalagmite","at":[15.6,10.8]},{"id":"west_cart","key":"west_cart","at":[12,26.6]},{"id":"west_strongbox","key":"west_strongbox","at":[21,27],"chest":{"id":"c3_revolver","item":"revolver_long","lines":["red.chest.revolver"],"name":"act.strongbox"}},{"id":"west_diary-1","key":"west_diary","at":[20.6,17],"chest":{"id":"page2","item":"diary_page","lines":["red.page.2"],"name":"act.page"}},{"id":"west_diary-2","key":"west_diary","at":[7.4,3.6],"chest":{"id":"page3","item":"diary_page","lines":["red.page.3"],"name":"act.page"}},{"id":"reading_desk","key":"reading_desk","at":[16.5,4.6],"desk":true}],"lamps":[[6.6000000000000005,2.2,3,4.2,1.3],[17.400000000000002,2.2,3,4.2,1.3],[2.6,2.2,12,4.2,1.3],[21.400000000000002,2.2,14,4.2,1.3],[2.6,2.2,20.4,4.2,1.3],[15.4,2.2,23,4.2,1.3],[12,2,2.6,3,0.9]],"onEnter":[{"if":{"not":{"flag":"m2_hall"}},"then":[{"set":"m2_hall","to":0},{"spawn":"gunman","at":[12,22.6],"onDefeat":[{"add":"m2_hall","n":1},{"if":{"var":"m2_hall","is":["==",3]},"then":[{"flag":"m2_hall"},{"if":{"not":{"flag":"m2_deep"}},"then":[{"set":"m2_deep","to":0},{"spawn":"ink_crawler","at":[6,13],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_crawler","at":[14,11.4],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_crawler","at":[18,14.6],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_bat","at":[10,12],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_bat","at":[16,16.4],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"gunman","at":[20,10.6],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]}]}]}]},{"spawn":"knifer","at":[9,26],"onDefeat":[{"add":"m2_hall","n":1},{"if":{"var":"m2_hall","is":["==",3]},"then":[{"flag":"m2_hall"},{"if":{"not":{"flag":"m2_deep"}},"then":[{"set":"m2_deep","to":0},{"spawn":"ink_crawler","at":[6,13],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_crawler","at":[14,11.4],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_crawler","at":[18,14.6],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_bat","at":[10,12],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_bat","at":[16,16.4],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"gunman","at":[20,10.6],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]}]}]}]},{"spawn":"dynamiter","at":[14,27],"onDefeat":[{"add":"m2_hall","n":1},{"if":{"var":"m2_hall","is":["==",3]},"then":[{"flag":"m2_hall"},{"if":{"not":{"flag":"m2_deep"}},"then":[{"set":"m2_deep","to":0},{"spawn":"ink_crawler","at":[6,13],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_crawler","at":[14,11.4],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_crawler","at":[18,14.6],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_bat","at":[10,12],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_bat","at":[16,16.4],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"gunman","at":[20,10.6],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]}]}]}]}]},{"if":{"flag":"m2_hall"},"then":[{"if":{"not":{"flag":"m2_deep"}},"then":[{"set":"m2_deep","to":0},{"spawn":"ink_crawler","at":[6,13],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_crawler","at":[14,11.4],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_crawler","at":[18,14.6],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_bat","at":[10,12],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"ink_bat","at":[16,16.4],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]},{"spawn":"gunman","at":[20,10.6],"onDefeat":[{"add":"m2_deep","n":1},{"if":{"var":"m2_deep","is":["==",6]},"then":[{"flag":"m2_deep"}]}]}]}]}],"exits":[{"id":"to-mine_3","rect":[10,2,14,2.8],"to":"mine_3","at":[12,20.6],"face":[0,-1],"when":{"flag":"collapse_open"}}],"tips":[{"rect":[9,2,15,4.4],"text":"red.shaft"}]}}},"chapter3/areas/mine_3.json":{"schema":2,"areas":{"mine_3":{"name":"area.mine_3","tod":"cripta","start":[12,20.6],"camNorth":1,"music":"boss","halo":"#9a6aff","legend":{"R":{"tile":"mine_rock","h":52,"wall":"#6a5648"},"K":{"tile":"mine_rock","h":20,"wall":"#6a5648"},"L":{"tile":"mine_rock","h":6,"wall":"#6a5648"},"r":{"tile":"mine_rock"},"t":{"tile":"mine_rails"},"p":{"tile":"mine_boards"}},"atmos":{"bloom":1.5,"thr":0.25,"haze":0.1,"sat":1.2,"motes":"ink"},"map":["RRRRRRRRRRRR","RRRRRRRRRRRR","RrrrrrrrrrrR","RrrrrrrrrrrR","RrrrrrrrrrrR","RrrrrrrrrrrR","RrrrrrrrrrrR","RrrrrrrrrrrR","RrrrrrrrrrrR","RrrrrrrrrrrR","RrrrrrrrrrrR","LLLLLppLLLLL"],"things":[{"id":"west_vein_big","key":"west_vein_big","at":[12,4.2],"look":{"label":"act.look","name":"act.vein","lines":["red.vein"]}},{"id":"west_stalagmite-1","key":"west_stalagmite","at":[6.5,10]},{"id":"west_stalagmite-2","key":"west_stalagmite","at":[17.5,9.6]},{"id":"west_stalagmite-3","key":"west_stalagmite","at":[7,17]},{"id":"west_stalagmite-4","key":"west_stalagmite","at":[17,17.6]},{"id":"west_tendril-1","key":"west_tendril","at":[3.2,6],"box":[0,0]},{"id":"west_tendril-2","key":"west_tendril","at":[20.8,6.4],"box":[0,0]},{"id":"west_tendril-3","key":"west_tendril","at":[3,19.6],"box":[0,0]},{"id":"west_tendril-4","key":"west_tendril","at":[21,20],"box":[0,0]}],"exits":[{"id":"to-mine_2","rect":[10,23.2,14,24],"to":"mine_2","at":[12,4.8],"face":[0,1],"when":{"not":{"flag":"boss3_done"}}}],"lamps":[[12,3,5.4,6,1.4],[4,2.2,19,4,0.7],[20,2.2,19,4,0.7]],"onEnter":[{"if":{"not":{"flag":"chapter3_done"}},"then":[{"if":{"flag":"boss3_done"},"then":[{"call":"vein_end"}],"else":[{"call":"outlaw"}]}]}]}}},"chapter3/areas/saloon.json":{"schema":2,"areas":{"saloon":{"name":"area.saloon","tod":"interno","start":[12,13],"camNorth":1,"music":"town","legend":{"W":{"tile":"west_boards","h":52,"wall":"#8a5e3c"},"V":{"tile":"west_boards","h":6,"wall":"#8a5e3c"},"a":{"tile":"west_boards"}},"atmos":{"bloom":0.9,"thr":0.35,"haze":0.06,"sat":1.1,"motes":"dust"},"map":["WWWWWWWWWWWW","WaaaaaaaaaaW","WaaaaaaaaaaW","WaaaaaaaaaaW","WaaaaaaaaaaW","WaaaaaaaaaaW","WaaaaaaaaaaW","WVVVVaaVVVVW"],"things":[{"id":"west_shelf","key":"west_shelf","at":[12,2.3]},{"id":"west_bar","key":"west_bar","at":[12,5]},{"id":"west_piano","key":"west_piano","at":[19,2.7],"look":{"label":"act.look","name":"act.piano","lines":["red.piano"]}},{"id":"west_table-1","key":"west_table","at":[5,9]},{"id":"west_table-2","key":"west_table","at":[18,10]},{"id":"west_table-3","key":"west_table","at":[7,12.5]},{"id":"reading_desk","key":"reading_desk","at":[20.5,13],"desk":true},{"id":"west_diary","key":"west_diary","at":[20.8,9.5],"chest":{"id":"page6","item":"diary_page","lines":["red.page.6"],"name":"act.page"}}],"npcs":[{"id":"old_man","at":[17,6.8],"face":[0,1]}],"lamps":[[6,2.6,6,4,1],[18,2.6,6,4,1],[12,2.6,11,4,0.9]],"exits":[{"id":"to-town","rect":[10,14.6,14,16],"to":"town","at":[27.5,11.2],"face":[0,1]}]}}},"chapter3/areas/sheriff.json":{"schema":2,"areas":{"sheriff":{"name":"area.sheriff","tod":"interno","start":[10,11],"camNorth":1,"music":"town","legend":{"W":{"tile":"west_boards","h":52,"wall":"#8a5e3c"},"V":{"tile":"west_boards","h":6,"wall":"#8a5e3c"},"a":{"tile":"west_boards"}},"atmos":{"bloom":0.9,"thr":0.35,"haze":0.06,"sat":1.1,"motes":"dust"},"map":["WWWWWWWWWW","WaaaaaaaaW","WaaaaaaaaW","WaaaaaaaaW","WaaaaaaaaW","WaaaaaaaaW","WVVVaaVVVW"],"things":[{"id":"west_desk","key":"west_desk","at":[8,5.5],"look":{"label":"act.read","name":"act.desk","lines":["red.desk"]}},{"id":"west_cell","key":"west_cell","at":[15,3.4]},{"id":"west_gunrack","key":"west_gunrack","at":[4,2.2]},{"id":"reading_desk","key":"reading_desk","at":[3.5,10],"desk":true}],"npcs":[{"id":"deputy","at":[11,6.4],"face":[0,1]}],"lamps":[[8,2.4,5,4,1],[15,2.6,7,3,0.7]],"exits":[{"id":"to-town","rect":[8,12.6,12,14],"to":"town","at":[34.5,11.2],"face":[0,1]}]}}},"chapter3/areas/town.json":{"schema":2,"areas":{"town":{"name":"area.town","tod":"tramonto","start":[8,16],"camNorth":1,"music":"town","legend":{"M":{"tile":"west_sand","h":56,"cliff":true},"m":{"tile":"west_sand","h":8,"cliff":true},"s":{"tile":"west_sand"},"t":{"tile":"west_street"},"b":{"tile":"west_boards"},"F":{"tile":"west_sand","h":14,"wall":"#8a5e3c"}},"map":["MMMMMMMMMMMMMMMMMMMMMMMMMMMMMM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MbbbbbbbbbbbbbbbbbbbbbbFsssssM","MttttttttttttttttttttttttttttM","MttttttttttttttttttttttttttttM","MttttttttttttttttttttttttttttM","MttttttttttttttttttttttttttttM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","mmmmmmmmmmmmmmmmmmmmmmmmmmmmmm"],"things":[{"id":"west_church","key":"west_church","at":[5,8],"look":{"label":"act.look","name":"act.church","lines":["red.church"]}},{"id":"west_house","key":"west_house","at":[11.5,8.25]},{"id":"west_store","key":"west_store","at":[18.5,8.25],"look":{"label":"act.look","name":"act.store","lines":["red.store"]}},{"id":"west_saloon","key":"west_saloon","at":[27.5,8],"door":{"to":"saloon","at":[12,13],"face":[0,-1]}},{"id":"west_sheriff","key":"west_sheriff","at":[35.5,8.25],"door":{"to":"sheriff","at":[10,11],"face":[0,-1]}},{"id":"west_undertaker","key":"west_undertaker","at":[41.5,8.25],"door":{"to":"undertaker","at":[9,11],"face":[0,-1]}},{"id":"west_mesa-1","key":"west_mesa","at":[4,3]},{"id":"west_mesa-2","key":"west_mesa","at":[16,2.8]},{"id":"west_mesa-3","key":"west_mesa","at":[30,3]},{"id":"west_mesa-4","key":"west_mesa","at":[56,3.5]},{"id":"west_windmill","key":"west_windmill","at":[22.6,5]},{"id":"west_water_tower","key":"west_water_tower","at":[44.5,4.5]},{"id":"west_stagecoach","key":"west_stagecoach","at":[6,18.5]},{"id":"west_hitch-1","key":"west_hitch","at":[14,12.6]},{"id":"west_hitch-2","key":"west_hitch","at":[32,12.6]},{"id":"west_trough","key":"west_trough","at":[23,12.6]},{"id":"west_wanted","key":"west_wanted","at":[21,21.2],"look":{"label":"act.look","name":"act.wanted","lines":["red.wanted"]}},{"id":"west_lamp-1","key":"west_lamp","at":[9,11.2]},{"id":"west_lamp-2","key":"west_lamp","at":[26,11.2]},{"id":"west_lamp-3","key":"west_lamp","at":[39,11.2]},{"id":"west_cactus-1","key":"west_cactus","at":[12,23.5]},{"id":"west_cactus_small","key":"west_cactus_small","at":[27,23]},{"id":"west_cactus-2","key":"west_cactus","at":[38,22.5]},{"id":"west_rock","key":"west_rock","at":[31,24]},{"id":"west_barrel-1","key":"west_barrel","at":[16.5,11.3]},{"id":"west_crate-1","key":"west_crate","at":[40,11.5]},{"id":"west_crate-2","key":"west_crate","at":[47,13],"when":{"not":{"flag":"gun_got"}},"shut":"red.shut.barricade"},{"id":"west_barrel-2","key":"west_barrel","at":[47,15],"when":{"not":{"flag":"gun_got"}},"shut":"red.shut.barricade","look":{"label":"act.look","name":"act.barricade","lines":["red.barricade"]}},{"id":"west_crate-3","key":"west_crate","at":[47,17],"when":{"not":{"flag":"gun_got"}},"shut":"red.shut.barricade"},{"id":"west_barrel-3","key":"west_barrel","at":[47,19],"when":{"not":{"flag":"gun_got"}},"shut":"red.shut.barricade"},{"id":"west_headframe","key":"west_headframe","at":[53,9]},{"id":"west_cart","key":"west_cart","at":[50,15]},{"id":"west_dynabox","key":"west_dynabox","at":[57,13]},{"id":"west_rubble","key":"west_rubble","at":[56,20]},{"id":"west_crate-4","key":"west_crate","at":[49,21]},{"id":"west_lamp-4","key":"west_lamp","at":[50.5,11.2]},{"id":"reading_desk","key":"reading_desk","at":[43.5,14.5],"desk":true},{"id":"west_crate-5","key":"west_crate","at":[15,3.4],"chest":{"id":"c3_bandana","item":"bandana","lines":["red.chest.bandana"],"name":"act.crate"}},{"id":"west_diary","key":"west_diary","at":[2.5,12.8],"chest":{"id":"page5","item":"diary_page","lines":["red.page.5"],"name":"act.page"}}],"critters":[{"id":"hen","kind":"hen","at":[16,27],"n":3,"r":3},{"id":"rooster","kind":"rooster","at":[16,27],"n":1,"r":2},{"id":"chick","kind":"chick","at":[16,27],"n":2,"r":2},{"id":"dog","kind":"dog","at":[20,16],"n":1,"r":5}],"npcs":[{"id":"girl","at":[11,11.4],"face":[0,1]},{"id":"miner_wife","at":[19.5,12],"face":[0,1]}],"lamps":[[9,2.5,11.2,3,1],[26,2.5,11.2,3,1],[39,2.5,11.2,3,1],[50.5,2.5,11.2,3,1],[27.5,2.2,10.6,2.4,0.8],[35.5,2,10.6,2.2,0.7]],"exits":[{"id":"to-mine_1","rect":[51.6,10.6,54.4,11.8],"to":"mine_1","at":[12,37],"face":[0,-1],"when":{"flag":"yard_clear"}}],"tips":[{"rect":[50,10.4,56,13],"text":{"choose":[[{"not":{"flag":"yard_clear"}},"red.tip.yard"]],"else":"red.tip.mine"}}],"onEnter":[{"if":{"all":[{"flag":"gun_got"},{"not":{"flag":"yard_seen"}}]},"then":[{"flag":"yard_seen"},{"toast":"red.toast.yard"}]},{"if":{"flag":"gun_got"},"then":[{"if":{"not":{"flag":"yard_clear"}},"then":[{"set":"yard_clear","to":0},{"spawn":"gunman","at":[52,16],"onDefeat":[{"add":"yard_clear","n":1},{"if":{"var":"yard_clear","is":["==",3]},"then":[{"flag":"yard_clear"},{"toast":"red.toast.yard_clear"}]}]},{"spawn":"knifer","at":[55,18],"onDefeat":[{"add":"yard_clear","n":1},{"if":{"var":"yard_clear","is":["==",3]},"then":[{"flag":"yard_clear"},{"toast":"red.toast.yard_clear"}]}]},{"spawn":"gunman","at":[50,20],"onDefeat":[{"add":"yard_clear","n":1},{"if":{"var":"yard_clear","is":["==",3]},"then":[{"flag":"yard_clear"},{"toast":"red.toast.yard_clear"}]}]}]}]}]}}},"chapter3/areas/town_dawn.json":{"schema":2,"areas":{"town_dawn":{"name":"area.town_dawn","tod":"alba","start":[52,13],"camNorth":1,"music":"dawn","legend":{"M":{"tile":"west_sand","h":56,"cliff":true},"m":{"tile":"west_sand","h":8,"cliff":true},"s":{"tile":"west_sand"},"t":{"tile":"west_street"},"b":{"tile":"west_boards"},"F":{"tile":"west_sand","h":14,"wall":"#8a5e3c"}},"map":["MMMMMMMMMMMMMMMMMMMMMMMMMMMMMM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MbbbbbbbbbbbbbbbbbbbbbbFsssssM","MttttttttttttttttttttttttttttM","MttttttttttttttttttttttttttttM","MttttttttttttttttttttttttttttM","MttttttttttttttttttttttttttttM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","MssssssssssssssssssssssFsssssM","mmmmmmmmmmmmmmmmmmmmmmmmmmmmmm"],"atmos":{"bloom":0.45,"thr":0.5,"haze":0.08,"sat":1.1,"motes":"dust"},"things":[{"id":"west_church","key":"west_church","at":[5,8],"look":{"label":"act.look","name":"act.church","lines":["red.church"]}},{"id":"west_house","key":"west_house","at":[11.5,8.25]},{"id":"west_store","key":"west_store","at":[18.5,8.25],"look":{"label":"act.look","name":"act.store","lines":["red.store"]}},{"id":"west_saloon","key":"west_saloon","at":[27.5,8]},{"id":"west_sheriff","key":"west_sheriff","at":[35.5,8.25]},{"id":"west_undertaker","key":"west_undertaker","at":[41.5,8.25]},{"id":"west_mesa-1","key":"west_mesa","at":[4,3]},{"id":"west_mesa-2","key":"west_mesa","at":[16,2.8]},{"id":"west_mesa-3","key":"west_mesa","at":[30,3]},{"id":"west_mesa-4","key":"west_mesa","at":[56,3.5]},{"id":"west_windmill","key":"west_windmill","at":[22.6,5]},{"id":"west_water_tower","key":"west_water_tower","at":[44.5,4.5]},{"id":"west_stagecoach","key":"west_stagecoach","at":[6,18.5]},{"id":"west_hitch-1","key":"west_hitch","at":[14,12.6]},{"id":"west_hitch-2","key":"west_hitch","at":[32,12.6]},{"id":"west_trough","key":"west_trough","at":[23,12.6]},{"id":"west_wanted","key":"west_wanted","at":[21,21.2],"look":{"label":"act.look","name":"act.wanted","lines":["red.wanted"]}},{"id":"west_lamp-1","key":"west_lamp","at":[9,11.2]},{"id":"west_lamp-2","key":"west_lamp","at":[26,11.2]},{"id":"west_lamp-3","key":"west_lamp","at":[39,11.2]},{"id":"west_cactus-1","key":"west_cactus","at":[12,23.5]},{"id":"west_cactus_small","key":"west_cactus_small","at":[27,23]},{"id":"west_cactus-2","key":"west_cactus","at":[38,22.5]},{"id":"west_rock","key":"west_rock","at":[31,24]},{"id":"west_barrel","key":"west_barrel","at":[16.5,11.3]},{"id":"west_crate-1","key":"west_crate","at":[40,11.5]},{"id":"west_headframe","key":"west_headframe","at":[53,9]},{"id":"west_cart","key":"west_cart","at":[50,15]},{"id":"west_dynabox","key":"west_dynabox","at":[57,13]},{"id":"west_rubble","key":"west_rubble","at":[56,20]},{"id":"west_crate-2","key":"west_crate","at":[49,21]},{"id":"west_lamp-4","key":"west_lamp","at":[50.5,11.2]},{"id":"reading_desk","key":"reading_desk","at":[43.5,14.5],"desk":true},{"id":"west_crate-3","key":"west_crate","at":[15,3.4],"chest":{"id":"c3_bandana","item":"bandana","lines":["red.chest.bandana"],"name":"act.crate"}},{"id":"west_diary","key":"west_diary","at":[2.5,12.8],"chest":{"id":"page5","item":"diary_page","lines":["red.page.5"],"name":"act.page"}}],"critters":[{"id":"hen","kind":"hen","at":[16,27],"n":3,"r":3},{"id":"rooster","kind":"rooster","at":[16,27],"n":1,"r":2},{"id":"chick","kind":"chick","at":[16,27],"n":2,"r":2},{"id":"dog","kind":"dog","at":[20,16],"n":1,"r":5}],"npcs":[{"id":"girl","at":[24.2,14.2],"face":[1,0]},{"id":"miner_dad","at":[25.6,14.2],"face":[-1,0]},{"id":"miner_wife","at":[21.4,13.4],"face":[1,0]},{"id":"miner_a","at":[50,15.2],"face":[-1,0]},{"id":"miner_b","at":[54.5,15.6],"face":[-1,0]},{"id":"deputy","at":[36,12.2],"face":[0,1]},{"id":"old_man","at":[28.5,12.2],"face":[0,1]},{"id":"widow","at":[41.5,11.8],"face":[0,1]}],"lamps":[[9,2.5,11.2,3,1],[26,2.5,11.2,3,1],[39,2.5,11.2,3,1],[50.5,2.5,11.2,3,1],[27.5,2.2,10.6,2.4,0.8],[35.5,2,10.6,2.2,0.7]],"onEnter":[{"call":"ending3"}]}}},"chapter3/areas/undertaker.json":{"schema":2,"areas":{"undertaker":{"name":"area.undertaker","tod":"interno","flicker":true,"start":[9,11],"camNorth":1,"music":"town","legend":{"W":{"tile":"west_boards","h":52,"wall":"#8a5e3c"},"V":{"tile":"west_boards","h":6,"wall":"#8a5e3c"},"a":{"tile":"west_boards"}},"atmos":{"bloom":0.8,"thr":0.35,"haze":0.08,"sat":1,"motes":"dust"},"map":["WWWWWWWWW","WaaaaaaaW","WaaaaaaaW","WaaaaaaaW","WaaaaaaaW","WaaaaaaaW","WVVVaVVVW"],"things":[{"id":"west_coffin_up-1","key":"west_coffin_up","at":[3.6,2.45],"look":{"label":"act.look","name":"act.coffins","lines":["red.coffins"]}},{"id":"west_coffin_up-2","key":"west_coffin_up","at":[5.4,2.45]},{"id":"west_stained_wall","key":"west_stained_wall","at":[11.5,2.1],"box":[0,0],"look":{"label":"act.look","name":"act.stains","lines":["red.stains"]}},{"id":"west_coffin","key":"west_coffin","at":[13.5,8.5]},{"id":"west_workbench","key":"west_workbench","at":[5,8.5]},{"id":"west_crate","key":"west_crate","at":[14.6,4.6],"chest":{"id":"c3_hat","item":"hat","lines":["red.chest.hat"],"name":"act.hatbox"}},{"id":"west_diary","key":"west_diary","at":[3,5.5],"chest":{"id":"page4","item":"diary_page","lines":["red.page.4"],"name":"act.page"}}],"npcs":[{"id":"widow","at":[10,5.4],"face":[0,1]}],"lamps":[[9,2.4,6,3.6,0.8]],"exits":[{"id":"to-town","rect":[8,12.6,10,14],"to":"town","at":[40.9,11.2],"face":[0,1]}]}}},"chapter3/enemies.json":{"schema":2,"enemies":{"gunman":{"sheet":"enemies-4","row":"gunman","hp":56,"atk":8,"def":0,"speed":2.2,"sight":10,"reach":8,"windup":0.55,"strike":0.5,"recover":0.9,"xp":8,"coins":[1,3],"r":0.45,"move":"shoot","keep":[5,7],"burst":3,"gap":0.18,"shotSpeed":9,"range":11,"drops":[{"item":"sarsaparilla","chance":0.15}]},"knifer":{"sheet":"enemies-4","row":"knifer","hp":62,"atk":9,"def":1,"speed":3.4,"sight":9,"reach":4.2,"windup":0.5,"strike":0.35,"recover":1,"xp":7,"coins":[1,2],"r":0.45,"move":"lunge"},"dynamiter":{"sheet":"enemies-4","row":"dynamiter","hp":62,"atk":12,"def":1,"speed":1.8,"sight":10,"reach":7,"windup":0.6,"strike":0.3,"recover":1.2,"xp":9,"coins":[1,3],"r":0.5,"move":"throw","fuse":0.6,"blast":1.4,"drops":[{"item":"sarsaparilla","chance":0.2}]},"lieutenant":{"sheet":"boss-3","row":"lieutenant","hp":240,"atk":7,"def":2,"speed":1.6,"sight":14,"reach":9,"windup":0.7,"strike":0.6,"recover":1,"xp":40,"coins":[8,12],"r":0.7,"move":"shoot","keep":[4,6.5],"burst":4,"gap":0.14,"shotSpeed":9,"range":6.5,"poise":true,"boss":"who.lieutenant","anims":{"idle":["walk1"],"walk":["walk1","walk2"],"windup":["aim"],"attack":["fire"],"paw":["lieutenant_b.paw"],"charge":["lieutenant_b.charge"],"hurt":["lieutenant_b.hurt"],"defeat":["lieutenant_b.defeat"]},"behaviour":"lieutenant"},"ink_crawler":{"sheet":"enemies-5","row":"ink_crawler","hp":40,"atk":9,"def":0,"speed":2.4,"sight":9,"reach":4,"windup":0.55,"strike":0.5,"recover":1,"xp":6,"coins":[0,1],"r":0.45,"move":"hop","drops":[{"item":"sarsaparilla","chance":0.1}]},"ink_bat":{"sheet":"enemies-5","row":"ink_bat","hp":26,"atk":8,"def":0,"speed":3.4,"sight":10,"reach":4.6,"windup":0.5,"strike":0.4,"recover":1.1,"xp":6,"coins":[0,1],"r":0.4,"move":"lunge","fly":0.6},"ink_outlaw":{"sheet":"boss-3","row":"ink_outlaw","hp":700,"atk":9,"def":2,"speed":1.8,"sight":30,"reach":12,"xp":80,"coins":[0,0],"r":0.7,"move":"shoot","keep":[4,8],"shotSpeed":10,"range":12,"poise":true,"boss":"who.ink_outlaw","anims":{"idle":["idle1","idle2"],"walk":["idle1","idle2"],"windup":["aim"],"attack":["fire"],"roll":["ink_outlaw_b.roll"],"summon":["ink_outlaw_b.summon"],"hurt":["ink_outlaw_b.hurt"],"defeat":["ink_outlaw_b.defeat"]},"behaviour":"ink_outlaw"}}},"chapter3/game.json":{"schema":2,"game":{"start":{"area":"town"},"hero":{"sheet":"cat","views":{"down":"cat_down","up":"cat_up","side":"cat_side"},"anims":{"idle":["idle"],"walk":["walk1","walk2","walk3","walk4","walk5"],"attack1":["attack1"],"attack2":["attack2"],"attack3":["attack3"],"hurt":{"down":["cat_extra.hurt_down"],"up":["cat_extra.hurt_up"],"side":["cat_extra.hurt_side"]},"dodge":{"down":["cat_extra.dodge_down"],"up":["cat_extra.dodge_up"],"side":["cat_extra.dodge_side"]},"bored":{"down":["bored1","bored1","bored1","bored2","bored2","bored2","bored2","bored2","bored2","bored3","bored3","bored2","bored3","bored3","bored2","bored2","bored2","bored2"]},"swim":{"down":["swim1","swim2"],"up":["swim1","swim2"],"side":["swim1","swim2"]},"jump":{"down":["jump1","jump2"],"up":["jump1","jump2"],"side":["jump1","jump2"]},"climb":{"up":["climb1","climb2"]},"shoot":["shoot1","shoot2"]},"equip":{"weapon":"quill_sword","armour":null,"charm":null},"start":{"level":3,"flags":["skill_dash","skill_fan"]},"gun":{"mag":6,"rate":3,"reload":1,"dmg":0.6,"range":12,"speed":40,"cone":70,"assist":9,"flag":"gun_got","muzzle":{"side":[18,17.5],"down":[0,13.5],"up":[0,30]}}},"levels":{"xp":[0,0,20,50,95,160],"base":{"hp":[24,6],"ink":[30,0],"atk":[5,2],"def":[1,1]}},"sheets":{"portraits":["portraits-3","portraits-3b","portraits-1","portraits-cat"],"items":["items-3","items-2","items-1"],"people":"villagers-3a"},"titleArt":["title-3","title-3"],"chapter":{"title":"chapter3.title","blurb":"chapter3.blurb","minutes":25,"order":3,"save":"mdv-rpg-cat-save-ch3","styles":["lowpoly"],"card":["title-3","title-3"],"doneFlag":"chapter3_done"},"intro":"intro3","atmos":{"bloom":0.35,"thr":0.55,"haze":0.1,"sat":1.06,"motes":"dust"},"hitFx":true,"inkName":"hud.nerve"}},"chapter3/items.json":{"schema":2,"items":{"quill_sword":{"slot":"weapon","atk":0,"price":0},"revolver":{"key":true,"price":0},"sarsaparilla":{"use":{"hp":12},"price":4},"lift_key":{"key":true,"price":0},"lantern":{"slot":"charm","def":1,"ink":5,"price":0},"revolver_long":{"slot":"weapon","atk":3,"mag":2,"price":0},"hat":{"slot":"armour","def":2,"price":0},"bandana":{"slot":"charm","ink":8,"def":1,"price":0},"dynamite":{"key":true,"price":0},"diary_page":{"key":true,"price":0}}},"chapter3/music.json":{"schema":2,"music":{"town":{"bpm":84,"voices":{"tri":["c2 . . . g1 . . . c2 . . . g1 . . .","f1 . . . c2 . . . f1 . . . c2 . . .","g1 . . . d2 . . . g1 . . . d2 . . .","c2 . . . g1 . . . c2 . . . c2 . . ."],"p2":["e4 - g4 - c5 - - . b4 a4 g4 - e4 - - .","f4 - a4 - c5 - - . a4 g4 f4 - - - . .","d4 - g4 - b4 - - . a4 g4 f4 - d4 - - .","e4 - - - g4 - - - c4 - - - - - . ."]}},"mine":{"bpm":58,"voices":{"tri":["a1 - - - - - - - - - - - - - - -","a1 - - - - - - - - - - - - - - -","f1 - - - - - - - - - - - - - - -","e1 - - - - - - - - - - - - - - -"],"p3":[". . . . e4 - - - . . . . . . . .",". . . . . . . . c4 - - - b3 - - -",". . . . d4 - - - . . . . . . . .",". . b3 - - - . . . . . . . . . ."]}},"battle":{"bpm":132,"voices":{"tri":["c2 . c2 . c2 . d#2 . c2 . c2 . f2 . d#2 .","c2 . c2 . c2 . d#2 . c2 . c2 . g1 . a#1 ."],"p1":["c5 . . . d#5 . . . d5 . . . c5 . a#4 .","g4 . . . c5 . . . d#5 . d5 . c5 . . ."],"drums":["k . h . s . h . k . h . s . h h","k . h . s . h . k k h . s . h ."]}},"boss":{"bpm":144,"voices":{"tri":["d2 . d2 . d2 . d2 . a#1 . a#1 . a#1 . a#1 .","g1 . g1 . g1 . g1 . a1 . a1 . a1 . c#2 .","d2 . d2 . d2 . d2 . a#1 . a#1 . a#1 . a#1 .","g1 . g1 . a1 . a1 . d2 . . . . . . ."],"p1":["d5 . . f5 . . a5 . g5 . f5 . e5 . . .","d5 . . f5 . . a#5 . a5 . g5 . f5 . e5 .","d5 . . f5 . . a5 . c6 . a#5 . a5 . . .","g5 . f5 . e5 . c#5 . d5 - - - . . . ."],"p2":["d4 . a3 . d4 . a3 . a#3 . f3 . a#3 . f3 .","g3 . d3 . g3 . d3 . a3 . e3 . a3 . c#4 .","d4 . a3 . d4 . a3 . a#3 . f3 . a#3 . f3 .","g3 . d3 . a3 . e3 . d4 . . . . . . ."],"drums":["k . h . s . h . k . h k s . h h","k . h . s . h . k k h . s . s s"]}},"dawn":{"bpm":72,"voices":{"tri":["c2 - - - g1 - - - a1 - - - e1 - - -","f1 - - - c2 - - - g1 - - - g1 - - -"],"p2":["e4 - g4 - c5 - - - b4 - a4 - g4 - - -","a4 - c5 - f4 - a4 - g4 - - - - - . .","e4 - g4 - c5 - e5 - d5 - c5 - b4 - - -","c5 - - - g4 - - - c5 - - - - - . ."]}}}},"chapter3/people.json":{"schema":2,"speakers":{"cat":{"name":"who.cat","pic":"cat_neutral"},"cat_happy":{"name":"who.cat","pic":"cat_happy","emote":"joy"},"cat_worried":{"name":"who.cat","pic":"cat_worried","emote":"worry"},"cat_surprised":{"name":"who.cat","pic":"cat_surprised","emote":"surprise"},"girl":{"name":"who.girl","pic":"girl"},"miner_wife":{"name":"who.miner_wife","pic":"miner_wife"},"old_man":{"name":"who.old_man","pic":"old_man"},"deputy":{"name":"who.deputy","pic":"deputy"},"widow":{"name":"who.widow","pic":"widow"},"lieutenant":{"name":"who.lieutenant","pic":"lieutenant"},"ink_outlaw":{"name":"who.ink_outlaw","pic":"ink_outlaw"},"ink_outlaw_dark":{"name":"who.ink_outlaw","pic":"ink_outlaw_dark"},"miner_dad":{"name":"who.miner_dad","pic":"miner_dad"},"miner_a":{"name":"who.miner_a","pic":"miner_a"},"miner_b":{"name":"who.miner_b","pic":"miner_b"}},"npcs":{"girl":{"row":"girl","name":"who.girl","pic":"girl","voice":520,"pages":[{"if":{"flag":"boss3_done"},"lines":[["girl","red.girl.d"]]},{"if":{"not":{"flag":"met_girl"}},"lines":[["girl","red.girl.1"],["cat","red.girl.2"],["girl","red.girl.3"],["girl","red.girl.4"],["cat_worried","red.girl.5"],["girl","red.girl.6"]],"then":[{"flag":"met_girl"}]},{"if":{"not":{"flag":"gun_got"}},"lines":[["girl","red.girl.7"]]},{"if":{"not":{"flag":"lt_done"}},"lines":[["girl","red.girl.8"]]},{"lines":[["girl","red.girl.9"]]}]},"miner_wife":{"row":"miner_wife","name":"who.miner_wife","pic":"miner_wife","voice":380,"pages":[{"if":{"flag":"boss3_done"},"lines":[["miner_wife","red.wife.d"]]},{"if":{"not":{"flag":"gun_got"}},"lines":[["miner_wife","red.wife.1"],["miner_wife","red.wife.2"],["cat_worried","red.wife.3"]]},{"if":{"not":{"flag":"wife_lantern"}},"lines":[["miner_wife","red.wife.4"],["miner_wife","red.wife.5"],["cat","red.wife.6"]],"then":[{"flag":"wife_lantern"},{"drop":"lantern","at":[19.5,13.2]}]},{"lines":[["miner_wife","red.wife.7"]]}]},"old_man":{"row":"old_man","name":"who.old_man","pic":"old_man","voice":200,"pages":[{"if":{"flag":"boss3_done"},"lines":[["old_man","red.old.d"]],"shop":["sarsaparilla"]},{"if":{"not":{"flag":"met_old"}},"lines":[["old_man","red.old.1"],["old_man","red.old.2"],["old_man","red.old.3"],["cat","red.old.4"],["old_man","red.old.5"]],"then":[{"flag":"met_old"}]},{"lines":[["old_man","red.old.6"]],"shop":["sarsaparilla"]}]},"deputy":{"row":"deputy","name":"who.deputy","pic":"deputy","voice":330,"pages":[{"if":{"flag":"boss3_done"},"lines":[["deputy","red.dep.d"]]},{"if":{"not":{"flag":"gun_got"}},"lines":[["deputy","red.dep.1"],["deputy","red.dep.2"],["deputy","red.dep.3"],["cat_worried","red.dep.4"],["deputy","red.dep.5"]],"then":[{"flag":"gun_got"},{"toast":"red.toast.gun"},{"sfx":"reload"}]},{"if":{"not":{"flag":"yard_clear"}},"lines":[["deputy","red.dep.6"]]},{"lines":[["deputy","red.dep.7"]]}]},"widow":{"row":"widow","name":"who.widow","pic":"widow","voice":160,"pages":[{"if":{"flag":"boss3_done"},"lines":[["widow","red.widow.d"]]},{"lines":[["widow","red.widow.1"],["cat","red.widow.2"],["widow","red.widow.3"]]}]},"miner_dad":{"row":"miner_dad","sheet":"villagers-3b","name":"who.miner_dad","pic":"miner_dad","voice":260,"pages":[{"lines":[["miner_dad","red.dad.1"]]}]},"miner_a":{"row":"miner_a","sheet":"villagers-3b","name":"who.miner_a","pic":"miner_a","voice":300,"pages":[{"lines":[["miner_a","red.jake.1"]]}]},"miner_b":{"row":"miner_b","sheet":"villagers-3b","name":"who.miner_b","pic":"miner_b","voice":180,"pages":[{"lines":[["miner_b","red.gus.1"]]}]}}},"chapter3/story.json":{"schema":2,"quests":{"red":{"name":"q.red","main":true,"steps":[{"text":"q.red.0","on":{"flag":"met_girl"}},{"text":"q.red.1","on":{"flag":"gun_got"}},{"text":"q.red.2","on":{"flag":"yard_clear"}},{"text":"q.red.3","on":{"flag":"lt_done"}},{"text":"q.red.4","on":{"flag":"mine2_reached"}},{"text":"q.red.5","on":{"flag":"collapse_open"}},{"text":"q.red.6","on":{"flag":"boss3_done"}}],"reward":{"xp":60}}},"events":{"intro3":[{"say":[["cat","red.in.1"],["cat","red.in.2"],["cat","red.in.3"]]},{"quest":"red"}],"outlaw":[{"spawn":"ink_outlaw","at":[12,10],"hunt":true,"onDefeat":[{"flag":"boss3_done"},{"toast":"red.toast.out_done"},{"wait":1.2},{"call":"vein_end"}]},{"wait":0.6},{"if":{"all":[{"area":"mine_3"},{"dialogue":false}]},"then":[{"say":[["ink_outlaw","red.out.1"],["cat_worried","red.out.2"],["ink_outlaw","red.out.3"]]}]}],"vein_end":[{"if":{"area":"mine_3"},"then":[{"shake":0.4},{"say":["red.end.1","red.end.2"],"name":"act.vein"},{"say":[["cat_surprised","red.end.3"]]},{"say":["red.end.4"],"name":"act.vein"},{"go":"town_dawn","at":[52,13],"face":[-1,0]}]}],"ending3":[{"if":{"not":{"flag":"chapter3_done"}},"then":[{"wait":0.8},{"say":["red.dawn.1"],"name":"area.town_dawn"},{"say":[["girl","red.dawn.2"],["miner_dad","red.dawn.3"],["miner_wife","red.dawn.4"]]},{"say":[["miner_b","red.dawn.5"]]},{"say":[["miner_wife","red.dawn.6"],["deputy","red.dawn.7"]]},{"if":{"has":"diary_page","n":6},"then":[{"say":[["old_man","red.dawn.8"]]}]},{"say":[["cat_happy","red.dawn.9"]]},{"flag":"chapter3_done"},{"save":true},{"sfx":"quest"},{"end":true}]}]}},"curate.json":{"schema":2,"curate":{"library":{"back":{"wall":"stone"}},"signpost":{"depth":{"rules":[{"box":[0,0,23,26],"half":2},{"box":[0,26,23,33],"half":5}]}}}}}};

// ---- engine/90-boot.js
/* ---------- boot: art, atlas, materials, title screen; play starts from New game, Continue or a save code ---------- */
// the start, the hero and the title picture come from game.json (GAME, engine/65-data.js)
const STYLE = LP ? 'lowpoly' : 'diorama';   // the page's style, as game.json "chapter.styles" names it
function beginPlay() {
  ui.screen = 'game'; showScreen(null); $('hud').hidden = false; $('touch').hidden = false;
  if (!player) { player = sheetActor(GAME.hero.sheet, GAME.hero.views, GAME.hero.anims); xrayFigure(player); }
  if (G.hp <= 0) G.hp = stats().hp;
  resetHero(); hudKey = ''; audioInit(); markPlayed();
  enterArea(G.area, G.x !== null && G.x !== undefined ? [G.x, G.z] : null);
  intro = reduceMotion ? 1 : 0;
  canvas.focus({ preventScroll: true });
  // the opening dialogue gives the main quest: its flag is set once the dialogue is done, not when it is scheduled (a
  // save in between, the tab closed, skipped the quest for good); a save that lost it that way is mended first
  if (CHAPTER.mend) CHAPTER.mend();
  clearTimeout(introT); if (!G.flags.intro && CHAPTER.intro) introT = setTimeout(() => { if (ui.screen === 'game') CHAPTER.intro(() => { G.flags.intro = true; }); }, reduceMotion ? 50 : 2200);
}
let introT = 0;
function startGame() { newGame(); beginPlay(); }
function continueGame() { const s = loadSave(); if (!s) { refreshTitle(); return; } G = s; beginPlay(); }
function gameOver() { ui.screen = 'over'; resetDim(); showScreen('over'); }   // (a boss's dark not left behind the screen)
function toTitle() { clearTimeout(introT); ui.screen = 'title'; clearEnemies(); resetDim(); clearNpcs(); clearCritters(); clearFish(); clearAmbient(); clearMarks(); clearExits(); refreshTitle(); showScreen('title'); $('hud').hidden = true; $('touch').hidden = true; }
// Continue resumes this page's chapter (the last played: engine/66-chapters.js); a slot that cannot be read says so
function refreshTitle() { $('bContinue').hidden = !hasSave(); $('titleNote').hidden = saveState() !== 'broken'; delete $('bStart').dataset.armed; $('bStart').textContent = t('menu.new'); }
function closeShop() { ui.screen = 'game'; showScreen(null); }

(async function boot() {
  applyLang(); syncStyle();
  // the game's data (content/**/*.json, compiled into the registries after the plugins): a problem the build let
  // through stops here, listed on the page instead of a half-loaded game
  // the chapter this page plays (engine/66-chapters.js): the title's choice from the address, else the last played
  fitStage(); addEventListener('resize', fitStage); if (window.visualViewport) visualViewport.addEventListener('resize', fitStage);
  const next = takeNext(location, history, window);
  CHAPTER_ID = pickChapter(next, STYLE);
  try { loadGameData(chapterFiles(GAME_DATA, CHAPTER_ID)); } catch (e) { $('fallback').textContent = e.message; $('fallback').hidden = false; return; }
  $('styleBtn').onclick = () => setStyle(!settings.flat);
  if (LP) { settings.flat = false; $('styleBtn').hidden = true; for (const e of [$('optStyle'), $('optStyle').previousElementSibling]) e.hidden = true; }   // the low-poly page: no 2D style
  if (!renderer) { $('fallback').hidden = false; return; }
  // the Atmosphere option only for a chapter that has one (engine/36-look.js)
  if (!GAME.atmos && !Object.values(AREAS).some((a) => a.atmos)) for (const e of [$('optAtmos'), $('optAtmos').previousElementSibling]) e.hidden = true;
  inputSetup(); optionsSetup();
  try { await loadArt(); } catch (e) { $('fallback').textContent = e.message; $('fallback').hidden = false; return; }
  buildSprites(); makeAtlasTextures(); makeMaterials();
  new ResizeObserver(resize).observe(canvas); resize();
  drawPic($('titleArt'), ...GAME.titleArt);
  document.querySelector('#title .sub').setAttribute('data-t', GAME.chapter.title); applyLang();
  // New game starts this page's chapter again (asked twice over a saved game); Chapters goes to any chapter, a saved one
  // by its Continue
  $('bStart').onclick = () => confirmNew($('bStart'), newGameNeedsConfirm(CHAPTER_ID), () => { sfx('ok'); startGame(); });
  $('bChapters').onclick = () => { sfx('ok'); openChapters(); };
  // the pause menu's way back to the title: the game is saved first, where the cat stands (Continue resumes there)
  $('bMenuTitle').onclick = () => { saveGame(); toTitle(); };
  $('bContinue').onclick = () => { sfx('ok'); continueGame(); };
  $('bLoad').onclick = () => { sfx('ok'); openCodeBox(); };
  $('bOptions').onclick = () => openMenu(true, true);
  $('bCodeOk').onclick = submitCode; $('bCodeCancel').onclick = () => { ui.screen = 'title'; showScreen('title'); };
  $('bChBack').onclick = () => { ui.screen = 'title'; showScreen('title'); };
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
  canvas.addEventListener('pointermove', (e) => { if (!drag || drag.id !== e.pointerId) return; const dx = e.clientX - drag.x; drag.x = e.clientX; if (settings.flat) return; yawT -= dx * pageS * .007; yaw = yawT; });
  const endDrag = (e) => { if (drag && drag.id === e.pointerId) { drag = null; yawT = Math.round(yawT / TURN) * TURN; } };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); VT = clamp(VT * Math.exp(e.deltaY * .0012), 7, 26); }, { passive: false });
  addEventListener('pagehide', () => { if (ui.screen === 'game' && G && !hero.dead) saveGame(); });
  refreshTitle(); ui.screen = 'title'; showScreen('title');
  requestAnimationFrame(frame);
  // hooks for the headless checks
  const camOnMark = () => { if (!A || !player) return; const [tx, tz] = camGoal(Math.max(Vz, minV())); camT.set(tx, A.groundY(player.x, player.z) * .5, tz); };
  window.__game = {
    state: () => ({ screen: ui.screen, area: A && A.def.id, x: player && player.x, z: player && player.z, fps, tris: A && A.tris, buildMs: A && A.buildMs, sprites: SPRITES.length,
      calls, chunkMs: A && Math.round(A.chunkMs), hp: G && G.hp, ink: G && Math.floor(G.ink), xp: G && G.xp, level: G && G.level, coins: G && G.coins, enemies: enemies.map((e) => [e.type, e.state, e.hp, +e.x.toFixed(1), +e.z.toFixed(1)]), dlg: !!dlg, near: nearAct && nearAct.label, quests: G && G.quests }),
    chapter: () => CHAPTER_ID, showHidden: (on) => { SHOW_HIDDEN = !!on; },
    start: () => startGame(), equip: (id) => equip(id),
    place: (x, z) => { player.x = x; player.z = z; },
    walk: (x, y) => { input.stickX = x; input.stickY = y; },
    act: (a) => input.queue.push(a),
    spawn: (type, x, z) => spawnEnemy(type, x, z),
    drop: (id, x, z) => drop(id, x, z), combat: (s) => { combatT = s; },   // (for the checks: an item on the floor; the fight's timer)
    defeatAll: () => { for (const e of enemies) if (e.hp > 0) hitEnemy(e, e.hp + 999, 0, false); },   // (for the play checks: every fight won at once, its onDefeat run)
    flag: (f) => setFlag(f),
    spriteTris: () => Object.fromEntries(SPRITES.map((s) => [s.key, (s.pixel ? 2 * (s.layF.length + s.layB.length + s.strips.length) : 0) + 2 * s.low.length])),
    G: () => G, code: () => saveCode(), read: (c) => readCode(c), enter: (n, at) => enterArea(n, at),
    // the maker's play page (tools/maker.mjs): a new game in an area with the flags given (no opening dialogue); the data
    // compiled again after an edit and the place built again where the cat stands (the problems as text, else null)
    playAt: (area, at, flags) => { clearTimeout(introT); newGame(); G.flags.intro = true; for (const f of flags || []) G.flags[f] = true; G.area = area; G.x = at ? at[0] : null; G.z = at ? at[1] : null; beginPlay(); },
    reload: (data) => { try { loadGameData(chapterFiles(data, CHAPTER_ID), true); } catch (e) { return e.message; } restyle(); return null; },
    area: () => A,
    // for the checks: stop the frame loop, reseed, and run the 120 Hz simulation by hand (bot is called before each step)
    freeze: (on) => { frozen = !!on; if (!on) last = performance.now(); },
    reseed: (n) => reseed(n),
    sim: (secs, bot) => { const n = Math.round(secs / SIM); for (let i = 0; i < n; i++) { if (bot && bot(i * SIM) === false) return i * SIM; step(SIM); flatsDraw(SIM); } return secs; },
    clearEnemies: () => clearEnemies(),
    internals: () => ({ enemies, critters, fish, exitArrows, pickups, hazards, flats, toast, ambient: amb, jumpTarget, ladders: () => ladders, hero, player, ENEMIES, AREAS, stats, combatT, settings, input, ui, resetHero, SWINGS, DEFS, CODE_ART, scene, matSlab, cam, look: () => atmosNow, GAME, shots, fireHeld, hitstop: () => hitstopT, simTime: () => simTime, ITEMS, lookDim, dim: () => [dimNow, dimTo], gunCfg, fireShot, hazard, zoomKick, postKick: () => postU.uKick.value }),
    // view and zoom put the camera on its mark at once, as entering a place does (else it eases there over ~2 s)
    view: (y) => { yaw = yawT = y; intro = 1; camOnMark(); },
    idPass: () => idPass(), holePass: () => holePass(), skyPass: (s) => skyPass(s), figurePass: (half) => figurePass(player, half || 40), qaImage: () => qaImage(), luma: () => lumaPass(), seen: () => seenPass(player), marks: () => marksNow(),
    rescale: (k) => { window.__ss = k; resize(); },
    camera: () => ({ t: [camT.x, camT.y, camT.z], p: [cam.position.x, cam.position.y, cam.position.z], v: viewV(Math.max(Vz, minV())), rt: [rt.width, rt.height], k: Math.max(1, Math.round(bh / Math.max(1, rt.height))), shift: [postU.uShift.value.x * rt.width, postU.uShift.value.y * rt.height] }),
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
    zoom: (v) => { VT = Vz = v; camOnMark(); },
    say: (lines, o) => openDialogue(Object.assign({ lines }, o || {})),   // (a dialogue from the checks: its lines as the data writes them)
    draw: () => draw(1 / 60),
    atmos: (o) => { atmosForced = o; },   // a check's own atmosphere on the area (null: none; undefined: the data's)

    mem: () => ({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, materials: allMats.length, programs: renderer.info.programs.length }),
    // run: game time by hand as the frame loop runs it (the simulation at 120 Hz, a frame drawn every 1/60 s), as fast as
    // the machine goes: the checks play minutes of game in seconds, the same on any machine
    run: (secs) => { let d = 0; for (let t = 0; t < secs - 1e-9; t += SIM) { step(SIM); d += SIM; if (d >= 1 / 60 - 1e-9) { d -= 1 / 60; draw(1 / 60); } } },
    // introNow: the opening at once: its dialogue (else 2.2 s later) and the camera's zoom in (else 2.8 s)
    introNow: () => { intro = 1; clearTimeout(introT); if (!G.flags.intro && CHAPTER.intro) CHAPTER.intro(() => { G.flags.intro = true; }); },
    // (busy: a fade between places, timed by the page in real time)
    clock: () => time, drawn: () => drawCount, busy: () => transitioning, shadowDraws: () => shadowDraws, talk: () => openDialogue({ name: 'who.cat', lines: [['cat', 'i.2']] }),
    save: () => saveGame(), saved: () => loadSave(), resume: () => continueGame(), checkSave: (o) => checkSave(o), importCode: (c) => { $('codeIn').value = c; submitCode(); },
  };
  // a choice handed over by the last page load (goChapter), now its chapter is loaded, the frame loop runs and the hooks
  // exist (engine/66-chapters.js handOver)
  handOver(next);
})();
})();
