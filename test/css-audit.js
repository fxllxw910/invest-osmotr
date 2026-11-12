'use strict';
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync('public/assets/app.css', 'utf8');
const defined = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));

const files = ['lib/views.js', 'lib/views-inspect.js', 'lib/views-site.js', 'lib/views-legal.js'];
const used = new Map();
for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  for (const m of s.matchAll(/class="([^"]*)"/g)) {
    const raw = m[1]
      .replace(/\$\{[^}]*\}/g, ' ')
      .replace(/'[^']*'/g, ' ');
    for (const c of raw.split(/\s+/)) {
      if (!c || c.includes('?')) continue;
      if (!used.has(c)) used.set(c, f);
    }
  }
}

const jsFile = 'public/assets/inspect.js';
if (fs.existsSync(jsFile)) {
  const s = fs.readFileSync(jsFile, 'utf8');
  for (const m of s.matchAll(/setGeo\('([a-z]+)'/g)) {
    const cls = 'geo-status ' + m[1];
    for (const c of cls.split(' ')) if (!used.has(c)) used.set(c, jsFile);
  }
}

const missing = [...used.keys()].filter((c) => !defined.has(c)).sort();
console.log('classes used:', used.size, '| undefined:', missing.length);
if (missing.length) {
  console.log(missing.join(', '));
  process.exitCode = 1;
}

const brandLeaks = [];
for (const f of ['lib/views.js', 'lib/views-inspect.js', 'lib/views-site.js', 'lib/views-legal.js', 'lib/brand.js', 'public/assets/app.css', 'server.js']) {
  const s = fs.readFileSync(path.resolve(f), 'utf8');
  for (const bad of ['РОСОСМОТР', 'Рососмотр', 'rososmotr', 'ros_session']) {
    if (s.includes(bad)) brandLeaks.push(f + ' → ' + bad);
  }
}
console.log('old brand mentions:', brandLeaks.length);
if (brandLeaks.length) {
  console.log(brandLeaks.join('\n'));
  process.exitCode = 1;
}

// palette: gold #c8af64 only, no blue
function hslOf(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { h: hue, s, l };
}

const blueish = [];
for (const m of css.matchAll(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
  const { h, s, l } = hslOf(m[0]);
  if (s > 0.28 && l > 0.12 && l < 0.95 && h >= 185 && h <= 275) {
    blueish.push(m[0] + ' (h=' + Math.round(h) + ' s=' + s.toFixed(2) + ')');
  }
}
for (const m of css.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
  const r = +m[1], g = +m[2], b = +m[3];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (b > max - 4 && b - (r + g) / 2 > 30) blueish.push(m[0] + ')');
}
const uniqBlue = [...new Set(blueish)];
console.log('blue palette violations:', uniqBlue.length);
if (uniqBlue.length) {
  console.log(uniqBlue.join('\n'));
  process.exitCode = 1;
}

const goldToken = /--gold:\s*#c8af64/i.test(css);
console.log('gold token #c8af64:', goldToken ? 'present' : 'MISSING');
if (!goldToken) process.exitCode = 1;

const themeGold = fs.readFileSync('lib/views.js', 'utf8').includes('theme-color" content="#c8af64"');
console.log('theme-color gold:', themeGold ? 'present' : 'MISSING');
if (!themeGold) process.exitCode = 1;
