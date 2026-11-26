// Semakan statik bahagian hadapan:
//  1. Sintaks setiap modul JavaScript sah.
//  2. Setiap import bernama wujud sebagai eksport dalam modul sumbernya.
//  3. Setiap '#id' yang dirujuk oleh skrip halaman wujud dalam HTML halaman itu.
//  4. Tiada skrip sebaris, pengendali peristiwa sebaris atau atribut style
//     (dilarang oleh Content-Security-Policy) dan setiap halaman mempunyai CSP.

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = new URL('../web/', import.meta.url);
const baca = (p) => readFileSync(new URL(p, WEB), 'utf8');
const ralat = [];

// 1. Sintaks
for (const f of readdirSync(new URL('js/', WEB))) {
  if (!f.endsWith('.js')) continue;
  try {
    execFileSync(process.execPath, ['--check', join(fileURLToPath(new URL('js/', WEB)), f)], { stdio: 'pipe' });
  } catch (e) {
    ralat.push(`Sintaks ${f}: ${e.stderr?.toString() || e.message}`);
  }
}

// 2. Import/eksport
const eksport = {};
for (const f of ['klien.js', 'util.js', 'cetakan.js', 'log-masuk.js']) {
  const s = baca(`js/${f}`);
  eksport[f] = new Set([...s.matchAll(/export\s+(?:async\s+)?(?:const|function|let|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
}
for (const f of ['aplikasi.js', 'log-masuk.js', 'laman.js', 'cetakan.js']) {
  const s = baca(`js/${f}`);
  for (const m of s.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([\w-]+\.js)'/g)) {
    for (const nama of m[1].split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!eksport[m[2]]?.has(nama)) ralat.push(`${f}: '${nama}' tidak dieksport oleh ${m[2]}`);
    }
  }
}

// 3. Rujukan ID
const halaman = { 'aplikasi.js': 'app.html', 'log-masuk.js': 'index.html', 'laman.js': 'index.html' };
for (const [js, html] of Object.entries(halaman)) {
  const s = baca(`js/${js}`);
  const h = baca(html);
  const id = new Set([...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const dirujuk = new Set([...s.matchAll(/\$\('#([A-Za-z][\w-]*)/g)].map((m) => m[1]));
  for (const x of dirujuk) {
    if (!id.has(x)) ralat.push(`${js}: #${x} tidak wujud dalam ${html}`);
  }
  const ganda = [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).filter((x, i, a) => a.indexOf(x) !== i);
  if (ganda.length) ralat.push(`${html}: id pendua ${[...new Set(ganda)].join(', ')}`);
}

// 4. Pematuhan CSP
for (const html of ['index.html', 'app.html']) {
  const h = baca(html);
  if (!/http-equiv="Content-Security-Policy"/.test(h)) ralat.push(`${html}: tiada CSP`);
  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(h)) ralat.push(`${html}: skrip sebaris ditemui`);
  if (/\son[a-z]+\s*=/i.test(h)) ralat.push(`${html}: pengendali peristiwa sebaris ditemui`);
  if (/\sstyle\s*=/i.test(h)) ralat.push(`${html}: atribut style sebaris ditemui`);
  for (const m of h.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
    const u = m[1];
    if (/^(https?:|\/\/|#|mailto:)/.test(u)) continue;
    const laluan = u.split('?')[0];
    if (laluan === 'config.js') continue;
    try { readFileSync(new URL(laluan, WEB)); } catch { ralat.push(`${html}: fail '${u}' tidak wujud`); }
  }
}
for (const js of readdirSync(new URL('js/', WEB))) {
  const s = baca(`js/${js}`);
  if (/\sstyle="/.test(s)) ralat.push(`js/${js}: atribut style sebaris dalam templat HTML`);
  if (/\son[a-z]+="/.test(s)) ralat.push(`js/${js}: pengendali peristiwa sebaris dalam templat HTML`);
  if (/\beval\(|new Function\(/.test(s)) ralat.push(`js/${js}: eval/new Function`);
}

if (ralat.length) {
  console.error(`✖ Semakan statik gagal (${ralat.length}):\n - ${ralat.join('\n - ')}`);
  process.exit(1);
}
console.log('✔ Semakan statik bahagian hadapan lulus.');
