// Ujian asap antara muka (pelayar sebenar + klien Supabase palsu).
// Menggunakan Chrome/Edge yang sedia terpasang (tiada muat turun pelayar).
// Dilangkau secara automatik jika tiada pelayar ditemui.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const ASAL = 'http://localhost:4599';
const WEB = new URL('../web/', import.meta.url);
const PALSU = new URL('./ui/supabase-palsu.js', import.meta.url);
const JENIS = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' };
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let pelayar;
let tiadaPelayar = false;

before(async () => {
  for (const channel of ['chrome', 'msedge']) {
    try {
      pelayar = await chromium.launch({ channel, headless: true });
      return;
    } catch { /* cuba seterusnya */ }
  }
  tiadaPelayar = true;
});

after(async () => { await pelayar?.close(); });

async function halamanBaru(t) {
  if (tiadaPelayar) {
    t.skip('Tiada Chrome/Edge dipasang');
    return null;
  }
  const konteks = await pelayar.newContext({ acceptDownloads: true });
  await konteks.route(`${ASAL}/**`, async (route) => {
    const laluan = new URL(route.request().url()).pathname.replace(/^\//, '') || 'index.html';
    if (laluan === 'vendor/supabase.js') {
      return route.fulfill({ body: await readFile(PALSU), contentType: JENIS.js });
    }
    if (laluan === 'config.js') {
      return route.fulfill({ body: 'window.KONFIG_MYSMTS={supabaseUrl:"https://palsu.supabase.co",supabaseAnonKey:"anon"};', contentType: JENIS.js });
    }
    try {
      const isi = await readFile(new URL(laluan, WEB));
      return route.fulfill({ body: isi, contentType: JENIS[laluan.split('.').pop()] || 'application/octet-stream' });
    } catch {
      return route.fulfill({ status: 404, body: 'x' });
    }
  });
  const page = await konteks.newPage();
  const ralat = [];
  page.on('pageerror', (e) => ralat.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') ralat.push(`console: ${m.text()}`);
  });
  page.ralat = ralat;
  t.after(() => konteks.close());
  return page;
}

const panggilan = (page) => page.evaluate(() => window.__PALSU.panggilan);

test('log masuk sekolah dengan emel sahaja dan isi maklumbalas', async (t) => {
  const page = await halamanBaru(t);
  if (!page) return;
  await page.goto(`${ASAL}/index.html`);

  // Emel tidak sah
  await page.fill('#emelSekolah', 'bukan-emel');
  await page.click('#btnLogMasukSekolah');
  await page.waitForSelector('#mesej:not([hidden])');
  assert.match(await page.textContent('#mesej'), /emel rasmi sekolah yang sah/);

  // Emel tidak berdaftar
  await page.fill('#emelSekolah', 'orang@luar.com');
  await page.click('#btnLogMasukSekolah');
  await page.waitForFunction(() => /tidak didaftarkan/.test(document.querySelector('#mesej').textContent));
  assert.equal(await page.isEnabled('#btnLogMasukSekolah'), true);

  // Emel berdaftar -> terus ke aplikasi
  await page.fill('#emelSekolah', '  YBA0001@moe.edu.my ');
  await Promise.all([page.waitForURL('**/app.html'), page.click('#btnLogMasukSekolah')]);
  const p1 = await panggilan(page);
  assert.ok(p1.some((x) => x.jenis === 'fn' && x.nama === 'sediakan-akaun'
    && x.body.tindakan === 'log-masuk-sekolah' && x.body.emel === 'yba0001@moe.edu.my'));
  assert.ok(p1.some((x) => x.op === 'verifyOtp' && x.token_hash === 'hash:yba0001@moe.edu.my' && x.type === 'email'));

  // Aplikasi: paparan sekolah
  await page.waitForSelector('#utama:not([hidden])');
  assert.equal(await page.textContent('#penggunaNama'), 'SK Limbang');
  assert.equal(await page.isVisible('#navTab'), false, 'tab pentadbir tidak dipaparkan kepada sekolah');
  assert.equal(await page.isVisible('#btnRekodBaru'), false);
  assert.equal(await page.isVisible('#btnKataLaluanSaya'), false, 'sekolah tiada kata laluan');
  await page.waitForSelector('#senaraiRekod article');
  const kad = await page.innerHTML('#senaraiRekod');
  assert.ok(kad.includes('&lt;script&gt;'), 'teks dapatan di-escape');
  assert.ok(!kad.includes('<b>bin</b>'), 'nama pegawai di-escape');
  assert.equal(await page.textContent('#statJumlah'), '1');

  // Isi maklumbalas
  await page.click('[data-tindakan="edit"]');
  await page.waitForSelector('#dialogRekod[open]');
  assert.equal(await page.isDisabled('#fDapatan'), true, 'Bahagian A dikunci untuk sekolah');
  assert.equal(await page.isVisible('[data-boleh-tambah="dapatan"]'), false);
  const pilihan = await page.$$eval('#fStatus option:not([disabled])', (o) => o.map((x) => x.value));
  assert.deepEqual(pilihan, ['Dalam Tindakan', 'Selesai']);
  await page.click('#btnSimpanRekod');
  await page.waitForSelector('#mesejRekod:not([hidden])');
  assert.match(await page.textContent('#mesejRekod'), /Sila isi maklumbalas/);

  await page.fill('#fMaklumbalas', 'Tindakan pembersihan telah dibuat.');
  await page.selectOption('#fStatus', 'Selesai');
  await page.setInputFiles('#failMaklumbalas', { name: 'bukti.png', mimeType: 'image/png', buffer: PNG_1PX });
  await page.waitForSelector('#galeriMaklumbalas .gambar-kecil.baru');
  await page.click('#btnSimpanRekod');
  await page.waitForSelector('#dialogRekod', { state: 'hidden' });
  await page.waitForSelector('.toast-berjaya');

  const p2 = await panggilan(page);
  const rpc = p2.find((x) => x.jenis === 'rpc' && x.nama === 'hantar_maklumbalas');
  assert.deepEqual(rpc.arg, { p_rekod_id: 'r1', p_maklumbalas: 'Tindakan pembersihan telah dibuat.', p_status: 'Selesai' });
  const muatNaik = p2.find((x) => x.op === 'upload');
  assert.match(muatNaik.laluan, /^r1\/maklumbalas\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(muatNaik.opsyen.contentType, 'image/jpeg');
  assert.ok(p2.some((x) => x.jadual === 'lampiran' && x.op === 'insert' && x.nilai.jenis === 'maklumbalas'));
  assert.ok(!p2.some((x) => x.jadual === 'rekod_lawatan' && x.op !== 'select'), 'sekolah tidak menulis terus ke rekod_lawatan');
  await page.waitForFunction(() => document.querySelector('#senaraiRekod').textContent.includes('Tindakan pembersihan'));

  // Log keluar
  await Promise.all([page.waitForURL('**/index.html'), page.click('#btnKeluar')]);
  assert.deepEqual(page.ralat, []);
});

test('pentadbir: log masuk kata laluan, CRUD rekod, cetak, eksport dan pengurusan', async (t) => {
  const page = await halamanBaru(t);
  if (!page) return;
  await page.goto(`${ASAL}/index.html?tab=admin`);
  await page.waitForSelector('#panelAdmin:not([hidden])');

  await page.fill('#emelAdmin', 'pentadbir@moe.gov.my');
  await page.fill('#kataLaluan', 'salah');
  await page.click('#btnLogMasukAdmin');
  await page.waitForFunction(() => /Emel atau kata laluan tidak sah/.test(document.querySelector('#mesej').textContent));

  // Sekolah cuba guna tab pentadbir
  await page.fill('#emelAdmin', 'yba0001@moe.edu.my');
  await page.fill('#kataLaluan', 'KataLaluan123');
  await page.click('#btnLogMasukAdmin');
  await page.waitForFunction(() => /tidak mempunyai akses pentadbir/.test(document.querySelector('#mesej').textContent));

  await page.fill('#emelAdmin', 'pentadbir@moe.gov.my');
  await page.fill('#kataLaluan', 'KataLaluan123');
  await Promise.all([page.waitForURL('**/app.html'), page.click('#btnLogMasukAdmin')]);
  await page.waitForSelector('#senaraiRekod article');
  assert.equal(await page.isVisible('#navTab'), true);
  assert.equal(await page.isVisible('#btnRekodBaru'), true);

  // Cipta rekod baharu dengan gambar
  await page.click('#btnRekodBaru');
  await page.waitForSelector('#dialogRekod[open]');
  await page.click('#btnSimpanRekod');
  assert.match(await page.textContent('#mesejRekod'), /Sila pilih sekolah/);
  await page.selectOption('#fSekolah', 's2');
  await page.fill('#fPegawai', 'Pn. Siti');
  await page.fill('#fJawatan', 'SIPartners+');
  await page.fill('#fDapatan', 'Kebersihan tandas perlu ditambah baik.');
  await page.setInputFiles('#failDapatan', [
    { name: 'a.png', mimeType: 'image/png', buffer: PNG_1PX },
    { name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('bukan gambar') },
  ]);
  await page.waitForSelector('#galeriDapatan .gambar-kecil.baru');
  await page.waitForSelector('.toast-amaran');
  await page.click('#btnSimpanRekod');
  await page.waitForSelector('#dialogRekod', { state: 'hidden' });
  const p = await panggilan(page);
  const cipta = p.find((x) => x.jadual === 'rekod_lawatan' && x.op === 'insert');
  assert.equal(cipta.nilai.sekolah_id, 's2');
  assert.equal(cipta.nilai.status, 'Menunggu Maklumbalas');
  assert.equal(p.filter((x) => x.op === 'upload').length, 1);
  await page.waitForFunction(() => document.querySelectorAll('#senaraiRekod article').length === 2);
  assert.equal(await page.textContent('#statJumlah'), '2');

  // Kemaskini rekod sedia ada & buang gambar
  await page.click('#senaraiRekod article:has-text("SK Limbang") [data-tindakan="edit"]');
  await page.waitForSelector('#dialogRekod[open]');
  assert.equal(await page.isDisabled('#fDapatan'), false);
  await page.click('#galeriDapatan [data-buang-sedia="l1"]');
  await page.fill('#fDapatan', 'Dapatan dikemas kini');
  await page.click('#btnSimpanRekod');
  await page.waitForSelector('#dialogRekod', { state: 'hidden' });
  const p3 = await panggilan(page);
  assert.ok(p3.some((x) => x.jadual === 'rekod_lawatan' && x.op === 'update' && x.nilai.dapatan === 'Dapatan dikemas kini'));
  assert.ok(p3.some((x) => x.jadual === 'lampiran' && x.op === 'delete'));
  assert.ok(p3.some((x) => x.op === 'remove' && x.laluan[0].startsWith('r1/dapatan/')));

  // Tutup borang yang ada perubahan -> minta pengesahan
  await page.click('#senaraiRekod article:has-text("SK Kubong") [data-tindakan="edit"]');
  await page.fill('#fDapatan', 'ubah tanpa simpan');
  await page.click('#dialogRekod .dialog-kaki [data-tutup]');
  await page.waitForSelector('dialog.kecil[open]');
  await page.click('dialog.kecil [data-jawapan="ya"]');
  await page.waitForSelector('#dialogRekod', { state: 'hidden' });

  // Cetak
  await page.evaluate(() => { window.print = () => { window.__dicetak = true; }; });
  await page.click('#senaraiRekod article:has-text("SK Limbang") [data-tindakan="cetak"]');
  await page.waitForFunction(() => window.__dicetak === true);
  assert.match(await page.textContent('#cetakan'), /SK Limbang[\s\S]*BAHAGIAN A[\s\S]*Dapatan dikemas kini/);

  // Eksport CSV
  const [muatTurun] = await Promise.all([page.waitForEvent('download'), page.click('#btnEksport')]);
  const csv = await readFile(await muatTurun.path(), 'utf8');
  assert.ok(csv.startsWith('﻿"Nama Sekolah"'));
  assert.equal(csv.trim().split('\r\n').length, 3);

  // Penapis status
  await page.click('.stat-selesai');
  await page.waitForFunction(() => !document.querySelector('#rekodKosong').hidden);

  // Padam rekod
  await page.click('.stat-jumlah');
  await page.waitForFunction(() => document.querySelectorAll('#senaraiRekod article').length === 2);
  await page.click('#senaraiRekod article:has-text("SK Kubong") [data-tindakan="padam"]');
  await page.click('dialog.kecil [data-jawapan="ya"]');
  await page.waitForFunction(() => document.querySelectorAll('#senaraiRekod article').length === 1);

  // Sekolah: tambah, pendua, padam yang ada rekod
  await page.click('#navTab [data-paparan="sekolah"]');
  await page.waitForSelector('#jadualSekolah tr');
  await page.click('#btnSekolahBaru');
  await page.fill('#sNama', 'SK Limbang');
  await page.click('#btnSimpanSekolah');
  await page.waitForFunction(() => /telah wujud/.test(document.querySelector('#mesejSekolah').textContent));
  await page.fill('#sNama', 'SK Baharu');
  await page.fill('#sKod', 'yba9999');
  await page.fill('#sEmel', 'emel-salah');
  await page.click('#btnSimpanSekolah');
  await page.waitForFunction(() => /Format emel/.test(document.querySelector('#mesejSekolah').textContent));
  await page.fill('#sEmel', 'YBA9999@moe.edu.my');
  await page.click('#btnSimpanSekolah');
  await page.waitForFunction(() => document.querySelector('#jadualSekolah').textContent.includes('SK Baharu'));
  const pSek = (await panggilan(page)).findLast((x) => x.jadual === 'sekolah' && x.op === 'insert');
  assert.deepEqual(pSek.nilai, { nama: 'SK Baharu', kod: 'YBA9999', emel: 'yba9999@moe.edu.my', aktif: true });
  await page.click('#jadualSekolah tr:has-text("SK Limbang") [data-tindakan="padam"]');
  await page.click('dialog.kecil [data-jawapan="ya"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-ralat')].some((x) => /masih digunakan/.test(x.textContent)));

  // Tiada halaman Pentadbir; log audit
  assert.equal(await page.$('#navTab [data-paparan="pentadbir"]'), null, 'halaman Pentadbir telah dibuang');
  await page.click('#navTab [data-paparan="audit"]');
  await page.waitForFunction(() => /status: Menunggu Maklumbalas → Selesai/.test(document.querySelector('#jadualAudit').textContent));

  assert.deepEqual(page.ralat, []);
});

test('emel pentadbir atau sekolah tidak aktif ditolak di tab sekolah; tanpa sesi dihantar ke log masuk', async (t) => {
  const page = await halamanBaru(t);
  if (!page) return;
  await page.goto(`${ASAL}/app.html`);
  await page.waitForURL('**/index.html');

  await page.fill('#emelSekolah', 'pentadbir@moe.gov.my');
  await page.click('#btnLogMasukSekolah');
  await page.waitForFunction(() => /tidak didaftarkan/.test(document.querySelector('#mesej').textContent));
  assert.ok(page.url().endsWith('/index.html'));
  assert.ok(!(await panggilan(page)).some((x) => x.op === 'verifyOtp'), 'tiada sesi dicipta untuk emel pentadbir');

  await page.evaluate(() => { window.__PALSU.db.sekolah[0].aktif = false; });
  await page.fill('#emelSekolah', 'yba0001@moe.edu.my');
  await page.click('#btnLogMasukSekolah');
  await page.waitForFunction(() => /dinyahaktifkan/.test(document.querySelector('#mesej').textContent));
  assert.ok(page.url().endsWith('/index.html'));
  assert.deepEqual(page.ralat, []);
});

test('pentadbir menukar kata laluan sendiri; log audit memaparkan log masuk', async (t) => {
  const page = await halamanBaru(t);
  if (!page) return;
  await page.goto(`${ASAL}/index.html?tab=admin`);
  await page.waitForSelector('#panelAdmin:not([hidden])');
  await page.fill('#emelAdmin', 'pentadbir@moe.gov.my');
  await page.fill('#kataLaluan', 'KataLaluan123');
  await Promise.all([page.waitForURL('**/app.html'), page.click('#btnLogMasukAdmin')]);
  await page.waitForSelector('#btnKataLaluanSaya:not([hidden])');
  await page.evaluate(() => {
    window.__PALSU.db.log_audit.unshift({ id: 2, pada: '2026-11-21T01:00:00Z', emel: 'yba0001@moe.edu.my', jadual: 'auth',
      tindakan: 'LOG MASUK', data_lama: null, data_baru: { sekolah: 'SK Limbang', ip: '203.0.113.5' } });
  });

  // Tukar kata laluan sendiri
  await page.click('#btnKataLaluanSaya');
  await page.waitForSelector('#dialogKataLaluan[open]');
  assert.match(await page.textContent('#sasaranKataLaluan'), /pentadbir@moe\.gov\.my/);
  await page.fill('#klBaharu', 'pendek');
  await page.click('#btnSimpanKataLaluan');
  assert.match(await page.textContent('#mesejKataLaluan'), /12 aksara/);
  await page.fill('#klBaharu', 'tiadahurufbesar123');
  await page.click('#btnSimpanKataLaluan');
  assert.match(await page.textContent('#mesejKataLaluan'), /huruf besar/);
  await page.fill('#klBaharu', 'KataLaluanKuat2026');
  await page.fill('#klSahkan', 'KataLaluanLain2026');
  await page.click('#btnSimpanKataLaluan');
  assert.match(await page.textContent('#mesejKataLaluan'), /tidak sepadan/);
  await page.fill('#klSahkan', 'KataLaluanKuat2026');
  await page.click('#btnSimpanKataLaluan');
  await page.waitForSelector('#dialogKataLaluan', { state: 'hidden' });
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-berjaya')].some((x) => /anda telah ditukar/.test(x.textContent)));
  assert.equal(await page.evaluate(() => window.__PALSU.kataLaluan['pentadbir@moe.gov.my']), 'KataLaluanKuat2026');
  assert.equal(await page.inputValue('#klBaharu'), '', 'medan dikosongkan selepas ditutup');

  const fn = (await panggilan(page)).filter((x) => x.body?.tindakan === 'tetap-kata-laluan').map((x) => x.body.emel);
  assert.deepEqual(fn, ['pentadbir@moe.gov.my']);

  // Log audit memaparkan log masuk sekolah
  await page.click('#navTab [data-paparan="audit"]');
  await page.waitForFunction(() => /Akaun — Log masuk sekolah[\s\S]*SK Limbang · IP 203\.0\.113\.5/.test(document.querySelector('#jadualAudit').textContent));
  assert.deepEqual(page.ralat, []);
});
