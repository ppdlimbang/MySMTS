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

const masukAdmin = async (page, url = `${ASAL}/index.html?tab=admin`) => {
  await page.goto(url);
  await page.waitForSelector('#panelAdmin:not([hidden])');
  await page.fill('#emelAdmin', 'pentadbir@moe.gov.my');
  await page.fill('#kataLaluan', 'KataLaluan123');
  await page.click('#btnLogMasukAdmin');
  await page.waitForSelector('#lencanaPengguna:not([hidden])');
  await page.waitForSelector('#senaraiRekod article');
};
const kad = (nama) => `#senaraiRekod article:has-text("${nama}")`;

test('sekolah: log masuk dengan emel sahaja, kekal di laman utama dan isi maklumbalas dalam borang kiri', async (t) => {
  const page = await halamanBaru(t);
  if (!page) return;
  await page.goto(`${ASAL}/index.html`);
  await page.click('#btnBukaLogMasuk');
  await page.waitForSelector('#dialogLogMasuk[open]');

  // Emel tidak sah / tidak berdaftar
  await page.fill('#emelSekolah', 'bukan-emel');
  await page.click('#btnLogMasukSekolah');
  await page.waitForSelector('#mesej:not([hidden])');
  assert.match(await page.textContent('#mesej'), /emel rasmi sekolah yang sah/);
  await page.fill('#emelSekolah', 'orang@luar.com');
  await page.click('#btnLogMasukSekolah');
  await page.waitForFunction(() => /tidak didaftarkan/.test(document.querySelector('#mesej').textContent));

  // Emel berdaftar -> kekal di laman utama sebagai sekolah
  await page.fill('#emelSekolah', '  YBA0001@moe.edu.my ');
  await page.click('#btnLogMasukSekolah');
  await page.waitForSelector('#lencanaPengguna:not([hidden])');
  await page.waitForSelector('#senaraiRekod article');
  assert.match(page.url(), /\/index\.html$/);
  assert.equal(await page.textContent('#penggunaPeranan'), 'Sekolah');
  assert.equal(await page.textContent('#penggunaNama'), 'SK Limbang');
  assert.equal(await page.isVisible('#navTab'), false, 'tiada tab admin untuk sekolah');
  assert.equal(await page.isVisible('#btnRekodBaru'), false);
  assert.equal(await page.isVisible('#btnKataLaluanSaya'), false);
  const p1 = await panggilan(page);
  assert.ok(p1.some((x) => x.jenis === 'fn' && x.body.tindakan === 'log-masuk-sekolah' && x.body.emel === 'yba0001@moe.edu.my'));
  assert.ok(p1.some((x) => x.op === 'verifyOtp' && x.token_hash === 'hash:yba0001@moe.edu.my'));

  // Borang dikunci sehingga rekod sendiri dipilih
  assert.equal(await page.isDisabled('#fMaklumbalas'), true);
  assert.equal(await page.isVisible('#bahagianA'), false);
  assert.match(await page.textContent('#kunciTajuk'), /SK Limbang/);
  assert.equal(await page.locator(`${kad('SK Kubong')} [data-tindakan="edit"]`).count(), 0, 'tiada butang edit pada rekod sekolah lain');
  assert.equal(await page.locator('#senaraiRekod [data-tindakan="padam"]').count(), 0);

  // Pilihan rekod dalam borang: hanya rekod sekolah sendiri
  await page.waitForFunction(() => /1 rekod lawatan menunggu maklumbalas/.test(document.querySelector('#kunciTeks').textContent));
  assert.equal(await page.isVisible('#pilihRekodSekolah'), true);
  const opsyen = await page.$$eval('#pilihRekodSekolah option', (o) => o.map((x) => x.value));
  assert.deepEqual(opsyen, ['', 'r1'], 'hanya rekod sekolah sendiri');
  await page.selectOption('#pilihRekodSekolah', 'r1');
  await page.waitForFunction(() => !document.querySelector('#fMaklumbalas').matches(':disabled'));
  assert.equal(await page.isVisible('#pilihRekodSekolah'), false);
  await page.click('#btnBatalEdit');
  await page.waitForFunction(() => document.querySelector('#fMaklumbalas').matches(':disabled'));

  // Isi maklumbalas rekod sendiri (melalui butang pada kad)
  await page.click(`${kad('SK Limbang')} .rekod-kaki [data-tindakan="edit"]`);
  await page.waitForFunction(() => !document.querySelector('#fMaklumbalas').matches(':disabled'));
  assert.equal(await page.isVisible('#bahagianA'), false, 'Bahagian A tidak dipaparkan kepada sekolah');
  assert.match(await page.textContent('#rujukanRekod'), /SK Limbang pada 20 November 2026/);
  assert.equal(await page.isVisible('[data-boleh-tambah="dapatan"]'), false);
  assert.match(await page.textContent('#tajukBorang'), /Isi Maklumbalas Sekolah/);
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
  await page.waitForSelector('.toast-berjaya');
  await page.waitForFunction(() => document.querySelector('#fMaklumbalas').matches(':disabled'), null, { timeout: 5000 });

  const p2 = await panggilan(page);
  const rpc = p2.find((x) => x.jenis === 'rpc' && x.nama === 'hantar_maklumbalas');
  assert.deepEqual(rpc.arg, { p_rekod_id: 'r1', p_maklumbalas: 'Tindakan pembersihan telah dibuat.', p_status: 'Selesai' });
  const muatNaik = p2.find((x) => x.op === 'upload');
  assert.match(muatNaik.laluan, /^r1\/maklumbalas\/[0-9a-f-]{36}\.jpg$/);
  assert.ok(p2.some((x) => x.jadual === 'lampiran' && x.op === 'insert' && x.nilai.jenis === 'maklumbalas'));
  assert.ok(!p2.some((x) => x.jadual === 'rekod_lawatan' && x.op !== 'select'), 'sekolah tidak menulis terus ke rekod_lawatan');
  await page.waitForFunction(() => document.querySelector('#senaraiRekod').textContent.includes('Tindakan pembersihan'));
  await page.waitForFunction(() => /Semua rekod lawatan telah diberi maklumbalas/.test(document.querySelector('#kunciTeks').textContent));

  // Log keluar -> laman awam
  await page.click('#btnLogKeluar');
  await page.waitForSelector('#btnBukaLogMasuk:not([hidden])');
  assert.equal(await page.isVisible('#lencanaPengguna'), false);
  assert.deepEqual(page.ralat, []);
});

test('admin: log masuk kekal di laman utama; cipta, kemaskini, padam, cetak, eksport, sekolah dan audit', async (t) => {
  const page = await halamanBaru(t);
  if (!page) return;
  await page.goto(`${ASAL}/index.html?tab=admin`);
  await page.waitForSelector('#panelAdmin:not([hidden])');
  await page.fill('#emelAdmin', 'pentadbir@moe.gov.my');
  await page.fill('#kataLaluan', 'salah');
  await page.click('#btnLogMasukAdmin');
  await page.waitForFunction(() => /Emel atau kata laluan tidak sah/.test(document.querySelector('#mesej').textContent));
  await page.fill('#emelAdmin', 'yba0001@moe.edu.my');
  await page.fill('#kataLaluan', 'KataLaluan123');
  await page.click('#btnLogMasukAdmin');
  await page.waitForFunction(() => /tidak mempunyai akses pentadbir/.test(document.querySelector('#mesej').textContent));

  await masukAdmin(page);
  assert.match(page.url(), /\/index\.html$/);
  assert.equal(await page.textContent('#penggunaPeranan'), 'Admin PPD');
  assert.equal(await page.isVisible('#navTab'), true);
  assert.equal(await page.isVisible('#bahagianA'), true, 'Bahagian A untuk admin');
  assert.equal(await page.isDisabled('#fDapatan'), false, 'borang terbuka untuk admin');
  assert.equal(await page.isVisible('#rujukanRekod'), false);
  assert.equal(await page.isVisible('#kunciBorang'), false);

  // Cipta rekod baharu dalam borang kiri
  await page.click('#btnSimpanRekod');
  assert.match(await page.textContent('#mesejRekod'), /Sila pilih sekolah/);
  await page.selectOption('#fSekolah', 's2');
  await page.fill('#fPegawai', 'Pn. Rohana');
  await page.fill('#fJawatan', 'SIPartners+');
  await page.fill('#fDapatan', 'Kebersihan tandas perlu ditambah baik.');
  await page.setInputFiles('#failDapatan', [
    { name: 'a.png', mimeType: 'image/png', buffer: PNG_1PX },
    { name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('bukan gambar') },
  ]);
  await page.waitForSelector('#galeriDapatan .gambar-kecil.baru');
  await page.waitForSelector('.toast-amaran');
  await page.click('#btnSimpanRekod');
  await page.waitForFunction(() => document.querySelectorAll('#senaraiRekod article').length === 3);
  const p = await panggilan(page);
  const cipta = p.find((x) => x.jadual === 'rekod_lawatan' && x.op === 'insert');
  assert.equal(cipta.nilai.sekolah_id, 's2');
  assert.equal(cipta.nilai.status, 'Menunggu Maklumbalas');
  assert.equal(p.filter((x) => x.op === 'upload').length, 1);
  await page.waitForFunction(() => document.querySelector('#statJumlah').textContent === '3');
  assert.equal(await page.inputValue('#fDapatan'), '', 'borang dikosongkan selepas simpan');

  // Kemaskini rekod sedia ada (dimuatkan ke borang kiri) & buang gambar
  await page.click(`${kad('SK Limbang')} .rekod-kaki [data-tindakan="edit"]`);
  await page.waitForFunction(() => document.querySelector('#fDapatan').value.includes('Dapatan'));
  assert.match(await page.textContent('#tajukBorang'), /Kemaskini/);
  assert.equal(await page.isVisible('#btnBatalEdit'), true);
  await page.click('#galeriDapatan [data-buang-sedia="l1"]');
  await page.fill('#fDapatan', 'Dapatan dikemas kini');
  await page.click('#btnSimpanRekod');
  await page.waitForSelector('#btnBatalEdit', { state: 'hidden' });
  const p3 = await panggilan(page);
  assert.ok(p3.some((x) => x.jadual === 'rekod_lawatan' && x.op === 'update' && x.nilai.dapatan === 'Dapatan dikemas kini'));
  assert.ok(p3.some((x) => x.jadual === 'lampiran' && x.op === 'delete'));
  assert.ok(p3.some((x) => x.op === 'remove' && x.laluan[0].startsWith('r1/dapatan/')));

  // Perubahan belum disimpan -> minta pengesahan
  await page.click(`${kad('Pn. Siti Aminah')} .rekod-kaki [data-tindakan="edit"]`);
  await page.fill('#fDapatan', 'ubah tanpa simpan');
  await page.click('#btnBatalEdit');
  await page.waitForSelector('dialog.kecil[open] [data-jawapan="ya"]');
  await page.click('dialog.kecil[open] [data-jawapan="ya"]');
  await page.waitForSelector('#btnBatalEdit', { state: 'hidden' });
  assert.match(await page.textContent('#tajukBorang'), /Borang Rekod Lawatan Baru/);

  // Cetak & eksport
  await page.evaluate(() => { window.print = () => { window.__dicetak = true; }; });
  await page.click(`${kad('SK Limbang')} [data-tindakan="cetak"]`);
  await page.waitForFunction(() => window.__dicetak === true);
  assert.match(await page.textContent('#cetakan'), /SK Limbang[\s\S]*BAHAGIAN A[\s\S]*Dapatan dikemas kini/);
  const [muatTurun] = await Promise.all([page.waitForEvent('download'), page.click('#btnEksport')]);
  const csv = await readFile(await muatTurun.path(), 'utf8');
  assert.ok(csv.startsWith('﻿"Nama Sekolah"'));
  assert.equal(csv.trim().split('\r\n').length, 4);

  // Padam rekod
  await page.click(`${kad('Pn. Rohana')} [data-tindakan="padam"]`);
  await page.click('dialog.kecil[open] [data-jawapan="ya"]');
  await page.waitForFunction(() => document.querySelectorAll('#senaraiRekod article').length === 2);

  // Tab Sekolah
  await page.click('#navTab [data-paparan="sekolah"]');
  await page.waitForSelector('#jadualSekolah tr');
  assert.equal(await page.isVisible('#paparan-rekod'), false);
  await page.click('#btnSekolahBaru');
  await page.fill('#sNama', 'SK Limbang');
  await page.click('#btnSimpanSekolah');
  await page.waitForFunction(() => /telah wujud/.test(document.querySelector('#mesejSekolah').textContent));
  await page.fill('#sNama', 'SK Baharu');
  await page.fill('#sKod', 'yba9999');
  await page.fill('#sEmel', 'YBA9999@moe.edu.my');
  await page.click('#btnSimpanSekolah');
  await page.waitForFunction(() => document.querySelector('#jadualSekolah').textContent.includes('SK Baharu'));
  const pSek = (await panggilan(page)).findLast((x) => x.jadual === 'sekolah' && x.op === 'insert');
  assert.deepEqual(pSek.nilai, { nama: 'SK Baharu', kod: 'YBA9999', emel: 'yba9999@moe.edu.my', aktif: true });
  await page.click('#jadualSekolah tr:has-text("SK Limbang") [data-tindakan="padam"]');
  await page.click('dialog.kecil[open] [data-jawapan="ya"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-ralat')].some((x) => /masih digunakan/.test(x.textContent)));

  // Tab Log Audit, kembali ke rekod; '+ Rekod Lawatan Baru' membuka borang baharu
  await page.click('#navTab [data-paparan="audit"]');
  await page.waitForFunction(() => /status: Menunggu Maklumbalas → Selesai/.test(document.querySelector('#jadualAudit').textContent));
  await page.click('#btnRekodBaru');
  await page.waitForSelector('#paparan-rekod:not([hidden])');
  assert.match(await page.textContent('#tajukBorang'), /Borang Rekod Lawatan Baru/);
  assert.ok(await page.$eval('#fSekolah', (s) => [...s.options].some((o) => o.textContent === 'SK Baharu')), 'sekolah baharu dalam pilihan');
  assert.deepEqual(page.ralat, []);
});

test('emel admin atau sekolah tidak aktif ditolak di tab sekolah', async (t) => {
  const page = await halamanBaru(t);
  if (!page) return;
  await page.goto(`${ASAL}/index.html?log-masuk=1`);
  await page.waitForSelector('#dialogLogMasuk[open]');

  await page.fill('#emelSekolah', 'pentadbir@moe.gov.my');
  await page.click('#btnLogMasukSekolah');
  await page.waitForFunction(() => /tidak didaftarkan/.test(document.querySelector('#mesej').textContent));
  assert.ok(!(await panggilan(page)).some((x) => x.op === 'verifyOtp'), 'tiada sesi dicipta untuk emel admin');

  await page.evaluate(() => { window.__PALSU.db.sekolah[0].aktif = false; });
  await page.fill('#emelSekolah', 'yba0001@moe.edu.my');
  await page.click('#btnLogMasukSekolah');
  await page.waitForFunction(() => /dinyahaktifkan/.test(document.querySelector('#mesej').textContent));
  assert.equal(await page.isVisible('#lencanaPengguna'), false);
  assert.deepEqual(page.ralat, []);
});

test('admin menukar kata laluan sendiri; log audit memaparkan log masuk sekolah', async (t) => {
  const page = await halamanBaru(t);
  if (!page) return;
  await masukAdmin(page);
  await page.evaluate(() => {
    window.__PALSU.db.log_audit.unshift({ id: 2, pada: '2026-11-21T01:00:00Z', emel: 'yba0001@moe.edu.my', jadual: 'auth',
      tindakan: 'LOG MASUK', data_lama: null, data_baru: { sekolah: 'SK Limbang', ip: '203.0.113.5' } });
  });

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
  assert.equal(await page.inputValue('#klBaharu'), '');
  const fn = (await panggilan(page)).filter((x) => x.body?.tindakan === 'tetap-kata-laluan').map((x) => x.body.emel);
  assert.deepEqual(fn, ['pentadbir@moe.gov.my']);

  await page.click('#navTab [data-paparan="audit"]');
  await page.waitForFunction(() => /Akaun — Log masuk sekolah[\s\S]*SK Limbang · IP 203\.0\.113\.5/.test(document.querySelector('#jadualAudit').textContent));
  assert.deepEqual(page.ralat, []);
});

test('laman awam: semua rekod dipapar tanpa log masuk, borang dikunci', async (t) => {
  const page = await halamanBaru(t);
  if (!page) return;
  await page.goto(`${ASAL}/index.html`);
  await page.waitForSelector('#senaraiRekod article');

  assert.equal(await page.textContent('#statJumlah'), '2');
  assert.equal(await page.textContent('#statMenunggu'), '1');
  assert.equal(await page.textContent('#statSelesai'), '1');
  const html = await page.innerHTML('#senaraiRekod');
  assert.ok(html.includes('SK Limbang') && html.includes('YBA0001'), 'nama & kod sekolah daripada sekolah_awam');
  assert.ok(html.includes('&lt;script&gt;'), 'teks dapatan di-escape');
  assert.ok(!html.includes('<b>bin</b>'), 'nama pegawai di-escape');
  assert.ok(!html.includes('@moe.edu.my'), 'emel sekolah tidak dipaparkan');
  assert.equal(await page.locator('#senaraiRekod .gambar-kecil img').count(), 1);
  assert.equal(await page.locator('#senaraiRekod [data-tindakan="edit"], #senaraiRekod [data-tindakan="padam"]').count(), 0);

  assert.equal(await page.isVisible('#btnBukaLogMasuk'), true);
  assert.equal(await page.isVisible('#navTab'), false);
  assert.equal(await page.isVisible('#bahagianA'), false, 'Bahagian A tersembunyi daripada orang awam');
  assert.equal(await page.isDisabled('#fMaklumbalas'), true);
  assert.equal(await page.isDisabled('#btnSimpanRekod'), true);
  assert.match(await page.textContent('#kunciTajuk'), /Log masuk untuk mengisi/);
  assert.match(await page.textContent('#jamMasa'), /\d/);

  await page.click('#senaraiRekod .gambar-kecil');
  await page.waitForSelector('#dialogGambar[open]');
  assert.match(await page.textContent('#kapsyenGambar'), /Gambar dapatan #1 — SK Limbang/);
  await page.click('#dialogGambar [data-tutup]');

  await page.evaluate(() => { window.print = () => { window.__dicetak = true; }; });
  await page.click(`${kad('SK Limbang')} [data-tindakan="cetak"]`);
  await page.waitForFunction(() => window.__dicetak === true);
  const [muatTurun] = await Promise.all([page.waitForEvent('download'), page.click('#btnEksport')]);
  const csv = await readFile(await muatTurun.path(), 'utf8');
  assert.ok(csv.includes('"SK Limbang"') && !csv.includes('@moe.edu.my'));

  await page.click('.stat-selesai');
  await page.waitForFunction(() => document.querySelectorAll('#senaraiRekod article').length === 1);
  await page.click('.stat-jumlah');
  await page.waitForFunction(() => document.querySelectorAll('#senaraiRekod article').length === 2);

  await page.click('#senaraiRekod [data-tindakan="log-masuk"]');
  await page.waitForSelector('#dialogLogMasuk[open]');
  await page.click('#dialogLogMasuk [data-tutup]');
  await page.click('#btnRekodBaru');
  await page.waitForSelector('#dialogLogMasuk[open]');

  const p = await panggilan(page);
  assert.ok(!p.some((x) => x.jenis === 'db' && x.op !== 'select'), 'tiada penulisan pangkalan data');
  assert.ok(!p.some((x) => x.jenis === 'db' && x.jadual === 'sekolah'), 'jadual sekolah (dengan emel) tidak dibaca');
  assert.deepEqual(page.ralat, []);
});

test('sesi admin lama ditamatkan sebelum log masuk sekolah; sekolah tidak mendapat paparan admin', async (t) => {
  const page = await halamanBaru(t);
  if (!page) return;
  await masukAdmin(page);
  assert.equal(await page.isVisible('#navTab'), true);

  // Buka tetingkap log masuk semasa sesi admin masih aktif, kemudian log masuk sebagai sekolah.
  await page.goto(`${ASAL}/index.html?log-masuk=1`);
  await page.waitForSelector('#dialogLogMasuk[open]');
  await page.fill('#emelSekolah', 'yba0001@moe.edu.my');
  await page.click('#btnLogMasukSekolah');
  await page.waitForFunction(() => document.querySelector('#penggunaPeranan').textContent === 'Sekolah');
  await page.waitForSelector('#senaraiRekod article');
  assert.equal(await page.textContent('#penggunaNama'), 'SK Limbang');
  assert.equal(await page.isVisible('#navTab'), false, 'bukan paparan admin');
  assert.equal(await page.locator('#senaraiRekod [data-tindakan="padam"]').count(), 0);
  assert.equal(await page.isVisible('#btnKataLaluanSaya'), false);
  const p = await panggilan(page);
  const iSignOut = p.findLastIndex((x) => x.op === 'signOut');
  const iSekolah = p.findLastIndex((x) => x.body?.tindakan === 'log-masuk-sekolah');
  assert.ok(iSignOut >= 0 && iSignOut < iSekolah, 'sesi lama ditamatkan sebelum log masuk sekolah');
  assert.deepEqual(page.ralat, []);
});
