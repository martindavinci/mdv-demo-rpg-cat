// node .github/check.mjs [dir]
// A quick look at the published files, without a browser: the scripts parse, the files the page loads exist, and the
// game's own files name no outside address (three.js, in vendor/, is left out: it is copied as it is).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.argv[2] || '.';
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const problems = [];

for (const f of ['game.js', 'art.js', 'lang.js']) {
  try { new vm.Script(read(f), { filename: f }); } catch (e) { problems.push(`${f}: ${e.message}`); }
}

const page = read('index.html');
for (const [, ref] of page.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (/^[a-z]+:/i.test(ref)) continue;
  if (!fs.existsSync(path.join(ROOT, ref))) problems.push(`index.html: ${ref} is missing`);
}
const fonts = read('vendor/fonts/fonts.css');
for (const [, ref] of fonts.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)) {
  if (!fs.existsSync(path.join(ROOT, 'vendor/fonts', ref))) problems.push(`fonts.css: ${ref} is missing`);
}

for (const f of ['game.js', 'art.js', 'lang.js', 'index.html', 'vendor/fonts/fonts.css']) {
  const m = read(f).match(/https?:\/\/[^\s'"`)]+/);
  if (m) problems.push(`${f}: outside address ${m[0]}`);
}

for (const p of problems) console.error('FAIL ' + p);
console.log(problems.length ? `${problems.length} problem(s)` : 'ok: scripts parse, files present, no outside address');
process.exit(problems.length ? 1 : 0);
