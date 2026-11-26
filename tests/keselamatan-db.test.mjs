// Ujian keselamatan pangkalan data MySMTS.
// Menjalankan migrasi sebenar pada PostgreSQL (PGlite) dengan tiruan
// persekitaran Supabase, kemudian menguji setiap laluan akses mengikut peranan.
//
//   npm install && npm test

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

const akar = new URL('../', import.meta.url);
const baca = (p) => readFileSync(new URL(p, akar), 'utf8');

let db;

const ID = {
  admin: randomUUID(),
  adminOtp: randomUUID(),
  skA: randomUUID(),
  skB: randomUUID(),
  orangLuar: randomUUID(),
  daftarSendiri: randomUUID(),
  belumSah: randomUUID(),
};
const EMEL = {
  admin: 'pentadbir@moe.gov.my',
  skA: 'yba0001@moe.edu.my',
  skB: 'yba0002@moe.edu.my',
  orangLuar: 'penceroboh@contoh.com',
  skC: 'yba0003@moe.edu.my',
};

const tuntutan = {
  admin: { sub: ID.admin, email: EMEL.admin, role: 'authenticated', amr: [{ method: 'password', timestamp: 1 }] },
  adminOtp: { sub: ID.adminOtp, email: EMEL.admin.toUpperCase(), role: 'authenticated', amr: [{ method: 'otp', timestamp: 1 }] },
  skA: { sub: ID.skA, email: EMEL.skA, role: 'authenticated', amr: [{ method: 'otp', timestamp: 1 }] },
  skB: { sub: ID.skB, email: EMEL.skB, role: 'authenticated', amr: [{ method: 'otp', timestamp: 1 }] },
  orangLuar: { sub: ID.orangLuar, email: EMEL.orangLuar, role: 'authenticated', amr: [{ method: 'password', timestamp: 1 }] },
  daftarSendiri: { sub: ID.daftarSendiri, email: EMEL.skC, role: 'authenticated', amr: [{ method: 'password', timestamp: 1 }] },
  belumSah: { sub: ID.belumSah, email: EMEL.skC, role: 'authenticated', amr: [{ method: 'otp', timestamp: 1 }] },
};

/** Jalankan fn sebagai pengguna tertentu dalam transaksi yang di-rollback. */
async function sebagai(siapa, fn, { kekal = false } = {}) {
  let hasil;
  await db.transaction(async (tx) => {
    if (siapa === 'anon') {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: 'anon' })]);
      await tx.exec('set local role anon');
    } else {
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(tuntutan[siapa])]);
      await tx.exec('set local role authenticated');
    }
    hasil = await fn(tx);
    if (!kekal) await tx.rollback();
  });
  return hasil;
}

async function gagal(janji, corak) {
  await assert.rejects(janji, (e) => {
    if (corak && !corak.test(e.message)) {
      assert.fail(`Mesej ralat tidak dijangka: ${e.message}`);
    }
    return true;
  });
}

let sekolahA, sekolahB, rekodA, rekodB, lampiranAdminA;

before(async () => {
  db = new PGlite();
  await db.exec(baca('tests/supabase-tiruan.sql'));
  const migrasi = readdirSync(new URL('supabase/migrations/', akar)).filter((f) => f.endsWith('.sql')).sort();
  for (const f of migrasi) await db.exec(baca(`supabase/migrations/${f}`));

  // Akaun yang disediakan oleh fungsi Edge: emel disahkan + bendera app_metadata.
  for (const k of ['admin', 'adminOtp', 'skA', 'skB', 'orangLuar']) {
    await db.query(
      `insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data)
       values ($1, $2, now(), '{"mysmts":"disediakan"}')`, [ID[k], EMEL[k] ?? EMEL.admin]);
  }
  // Akaun didaftar sendiri (tiada bendera) dan akaun belum disahkan, kedua-duanya
  // menggunakan emel sekolah C yang berdaftar.
  await db.query(`insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`, [ID.daftarSendiri, EMEL.skC]);
  await db.query(
    `insert into auth.users (id, email, raw_app_meta_data) values ($1, $2, '{"mysmts":"disediakan"}')`, [ID.belumSah, EMEL.skC]);

  // Pentadbir pertama didaftarkan melalui SQL Editor (peranan postgres).
  await db.query(`insert into public.pentadbir (emel, nama) values ($1, 'Pentadbir Utama')`, ['  Pentadbir@MOE.gov.my ']);

  // Pentadbir menyediakan data asas.
  await sebagai('admin', async (tx) => {
    const a = await tx.query(`update public.sekolah set emel = $1, kod = ' yba0001 ' where nama = 'SK Limbang' returning id`, [EMEL.skA.toUpperCase()]);
    const b = await tx.query(`update public.sekolah set emel = $1, kod = 'YBA0002' where nama = 'SK Kubong' returning id`, [EMEL.skB]);
    await tx.query(`update public.sekolah set emel = $1 where nama = 'SK Mendamit'`, [EMEL.skC]);
    sekolahA = a.rows[0].id;
    sekolahB = b.rows[0].id;
    const ra = await tx.query(
      `insert into public.rekod_lawatan (sekolah_id, tarikh, masa, nama_pegawai, jawatan, dapatan)
       values ($1, '2026-11-20', '09:30', '  En.  Ali  ', 'SISC+', 'Dapatan A') returning id`, [sekolahA]);
    const rb = await tx.query(
      `insert into public.rekod_lawatan (sekolah_id, tarikh, nama_pegawai, jawatan, dapatan)
       values ($1, '2026-11-21', 'Pn. Siti', 'SIPartners+', 'Dapatan B') returning id`, [sekolahB]);
    rekodA = ra.rows[0].id;
    rekodB = rb.rows[0].id;
    const l = await tx.query(
      `insert into public.lampiran (rekod_id, jenis, laluan) values ($1::uuid, 'dapatan', $1::text || '/dapatan/' || $2::text || '.jpg') returning id`,
      [rekodA, randomUUID()]);
    lampiranAdminA = l.rows[0].id;
  }, { kekal: true });
});

test('migrasi memuatkan 17 sekolah dan menormalkan data', async () => {
  const r = await db.query('select count(*)::int n from public.sekolah');
  assert.equal(r.rows[0].n, 17);
  const s = await db.query('select kod, emel from public.sekolah where id = $1', [sekolahA]);
  assert.deepEqual(s.rows[0], { kod: 'YBA0001', emel: EMEL.skA });
  const p = await db.query('select emel from public.pentadbir');
  assert.equal(p.rows[0].emel, EMEL.admin);
  const rek = await db.query('select nama_pegawai, dicipta_oleh, status from public.rekod_lawatan where id = $1', [rekodA]);
  assert.equal(rek.rows[0].nama_pegawai, 'En. Ali');
  assert.equal(rek.rows[0].dicipta_oleh, ID.admin);
  assert.equal(rek.rows[0].status, 'Menunggu Maklumbalas');
});

test('orang awam (anon) boleh membaca rekod sahaja; emel sekolah dan data dalaman kekal tertutup', async () => {
  // Rekod & lampiran awam (lajur awam sahaja).
  const r = await sebagai('anon', (tx) => tx.query(
    'select id, sekolah_id, tarikh, masa, nama_pegawai, jawatan, dapatan, maklumbalas, status, dicipta_pada, dikemaskini_pada, maklumbalas_pada from public.rekod_lawatan order by tarikh'));
  assert.deepEqual(r.rows.map((x) => x.id), [rekodA, rekodB]);
  const l = await sebagai('anon', (tx) => tx.query('select id, rekod_id, jenis, laluan, dicipta_pada from public.lampiran'));
  assert.equal(l.rows.length, 1);
  await gagal(sebagai('anon', (tx) => tx.query('select dicipta_oleh from public.rekod_lawatan')), /permission denied/);
  await gagal(sebagai('anon', (tx) => tx.query('select * from public.rekod_lawatan')), /permission denied/);
  await gagal(sebagai('anon', (tx) => tx.query('select dimuat_naik_oleh from public.lampiran')), /permission denied/);

  // Emel sekolah, pentadbir dan log audit tidak boleh dibaca.
  for (const jadual of ['pentadbir', 'sekolah', 'log_audit']) {
    await gagal(sebagai('anon', (tx) => tx.query(`select * from public.${jadual}`)), /permission denied/);
  }
  await gagal(sebagai('anon', (tx) => tx.query('select emel from public.sekolah')), /permission denied/);
  const sek = await sebagai('anon', (tx) => tx.query('select * from public.sekolah_awam()'));
  assert.equal(sek.rows.length, 17);
  assert.deepEqual(Object.keys(sek.rows[0]).sort(), ['id', 'kod', 'nama']);
  assert.ok(sek.rows.every((x) => !JSON.stringify(x).includes('@')), 'tiada emel didedahkan');

  // Tiada penulisan.
  await gagal(sebagai('anon', (tx) => tx.query(
    `insert into public.rekod_lawatan (sekolah_id, tarikh, nama_pegawai, jawatan, dapatan) values ($1, '2026-01-01', 'Ab', 'Cd', 'x')`, [sekolahA])),
  /permission denied/);
  await gagal(sebagai('anon', (tx) => tx.query(`update public.rekod_lawatan set dapatan = 'x' where id = $1`, [rekodA])), /permission denied/);
  await gagal(sebagai('anon', (tx) => tx.query('delete from public.rekod_lawatan where id = $1', [rekodA])), /permission denied/);
  await gagal(sebagai('anon', (tx) => tx.query(`insert into public.lampiran (rekod_id, jenis, laluan) values ($1::uuid, 'dapatan', $1::text || '/dapatan/' || $2::text || '.jpg')`, [rekodA, randomUUID()])), /permission denied/);
  await gagal(sebagai('anon', (tx) => tx.query('delete from public.lampiran')), /permission denied/);
  await gagal(sebagai('anon', (tx) => tx.query('select public.profil_saya()')), /permission denied/);
  await gagal(sebagai('anon', (tx) => tx.query(`select public.hantar_maklumbalas($1, 'x', 'Selesai')`, [rekodA])), /permission denied/);
  await gagal(sebagai('anon', (tx) => tx.query(`insert into storage.objects (bucket_id, name) values ('lampiran', $1)`, [`${rekodA}/dapatan/${randomUUID()}.jpg`])), /row-level security/);
});

test('profil_saya menentukan peranan daripada pangkalan data', async () => {
  const p = (siapa) => sebagai(siapa, async (tx) => (await tx.query('select public.profil_saya() p')).rows[0].p);
  const admin = await p('admin');
  assert.equal(admin.peranan, 'admin');
  assert.equal(admin.nama, 'Pentadbir Utama');
  assert.equal(admin.admin_perlu_kata_laluan, false);

  const adminOtp = await p('adminOtp');
  assert.equal(adminOtp.peranan, null, 'pentadbir yang log masuk tanpa kata laluan tidak mendapat akses');
  assert.equal(adminOtp.admin_perlu_kata_laluan, true);

  const sk = await p('skA');
  assert.equal(sk.peranan, 'sekolah');
  assert.equal(sk.sekolah.id, sekolahA);
  assert.equal(sk.sekolah.kod, 'YBA0001');

  const luar = await p('orangLuar');
  assert.equal(luar.peranan, null);
  assert.equal(luar.sekolah, null);
});

test('pentadbir yang log masuk dengan OTP tiada akses pentadbir', async () => {
  const u = await sebagai('adminOtp', (tx) => tx.query(`update public.rekod_lawatan set dapatan = 'diubah' where id = $1`, [rekodA]));
  assert.equal(u.affectedRows, 0);
  const s = await sebagai('adminOtp', (tx) => tx.query('select * from public.sekolah'));
  assert.equal(s.rows.length, 0);
  await gagal(sebagai('adminOtp', (tx) => tx.query(
    `insert into public.rekod_lawatan (sekolah_id, tarikh, nama_pegawai, jawatan, dapatan) values ($1, '2026-01-01', 'Ab', 'Cd', 'x')`, [sekolahA])),
  /row-level security/);
});

test('pengguna tidak berdaftar hanya melihat data awam dan tidak boleh menulis', async () => {
  for (const jadual of ['pentadbir', 'sekolah', 'log_audit']) {
    const r = await sebagai('orangLuar', (tx) => tx.query(`select * from public.${jadual}`));
    assert.equal(r.rows.length, 0, jadual);
  }
  const r = await sebagai('orangLuar', (tx) => tx.query('select id from public.rekod_lawatan'));
  assert.equal(r.rows.length, 2, 'rekod adalah awam');
  const u = await sebagai('orangLuar', (tx) => tx.query(`update public.rekod_lawatan set dapatan = 'x' where id = $1`, [rekodA]));
  assert.equal(u.affectedRows, 0);
  const d = await sebagai('orangLuar', (tx) => tx.query('delete from public.lampiran'));
  assert.equal(d.affectedRows, 0);
});

test('akaun didaftar sendiri atau belum disahkan tiada akses walaupun emel sepadan', async () => {
  for (const siapa of ['daftarSendiri', 'belumSah']) {
    const p = await sebagai(siapa, async (tx) => (await tx.query('select public.profil_saya() p')).rows[0].p);
    assert.equal(p.peranan, null, siapa);
    assert.equal(p.emel, null, siapa);
    const s = await sebagai(siapa, (tx) => tx.query('select * from public.sekolah'));
    assert.equal(s.rows.length, 0, siapa);
  }
  // Akaun pentadbir palsu yang didaftar sendiri dengan emel pentadbir.
  await db.query(`update auth.users set email = $1 where id = $2`, [EMEL.admin, ID.daftarSendiri]);
  tuntutan.daftarSendiri.email = EMEL.admin;
  const p = await sebagai('daftarSendiri', async (tx) => (await tx.query('select public.profil_saya() p')).rows[0].p);
  assert.equal(p.peranan, null);
  const r = await sebagai('daftarSendiri', (tx) => tx.query(`update public.rekod_lawatan set dapatan = 'x' where id = $1`, [rekodA]));
  assert.equal(r.affectedRows, 0);
  const pen = await sebagai('daftarSendiri', (tx) => tx.query('select * from public.pentadbir'));
  assert.equal(pen.rows.length, 0);
});

test('fungsi carian akaun hanya untuk service_role', async () => {
  await gagal(sebagai('admin', (tx) => tx.query('select * from public.mysmts_akaun_ikut_emel($1)', [EMEL.skA])), /permission denied/);
  await gagal(sebagai('anon', (tx) => tx.query('select * from public.mysmts_akaun_ikut_emel($1)', [EMEL.skA])), /permission denied/);
  const r = await db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    return tx.query('select * from public.mysmts_akaun_ikut_emel($1)', ['  YBA0001@moe.edu.my ']);
  });
  assert.deepEqual(r.rows, [{ id: ID.skA, disediakan: true }]);
});

test('sekolah melihat semua rekod (awam) tetapi hanya maklumat sekolahnya sendiri', async () => {
  const rekod = await sebagai('skA', (tx) => tx.query('select id from public.rekod_lawatan order by tarikh'));
  assert.deepEqual(rekod.rows.map((r) => r.id), [rekodA, rekodB]);
  const sek = await sebagai('skA', (tx) => tx.query('select id from public.sekolah'));
  assert.deepEqual(sek.rows.map((r) => r.id), [sekolahA]);
  const pen = await sebagai('skA', (tx) => tx.query('select * from public.pentadbir'));
  assert.equal(pen.rows.length, 0);
  const log = await sebagai('skA', (tx) => tx.query('select * from public.log_audit'));
  assert.equal(log.rows.length, 0);
});

test('sekolah tidak boleh mencipta, mengubah terus atau memadam rekod', async () => {
  await gagal(sebagai('skA', (tx) => tx.query(
    `insert into public.rekod_lawatan (sekolah_id, tarikh, nama_pegawai, jawatan, dapatan) values ($1, '2026-01-01', 'Ab', 'Cd', 'x')`, [sekolahA])),
  /row-level security/);
  const u = await sebagai('skA', (tx) => tx.query(`update public.rekod_lawatan set dapatan = 'diubah', status = 'Selesai' where id = $1`, [rekodA]));
  assert.equal(u.affectedRows, 0);
  const d = await sebagai('skA', (tx) => tx.query('delete from public.rekod_lawatan where id = $1', [rekodA]));
  assert.equal(d.affectedRows, 0);
  const s = await sebagai('skA', (tx) => tx.query(`update public.sekolah set emel = 'lain@moe.edu.my' where id = $1`, [sekolahA]));
  assert.equal(s.affectedRows, 0);
  await gagal(sebagai('skA', (tx) => tx.query(`insert into public.pentadbir (emel, nama) values ('x@moe.gov.my', 'Penyamar')`)), /row-level security/);
});

test('sekolah menghantar maklumbalas melalui RPC sahaja untuk rekodnya', async () => {
  await sebagai('skA', async (tx) => {
    await tx.query(`select public.hantar_maklumbalas($1, '  Tindakan telah diambil.  ', 'Selesai')`, [rekodA]);
    const r = await tx.query('select maklumbalas, status, maklumbalas_oleh, maklumbalas_pada, dapatan from public.rekod_lawatan where id = $1', [rekodA]);
    assert.equal(r.rows[0].maklumbalas, 'Tindakan telah diambil.');
    assert.equal(r.rows[0].status, 'Selesai');
    assert.equal(r.rows[0].maklumbalas_oleh, ID.skA);
    assert.ok(r.rows[0].maklumbalas_pada);
    assert.equal(r.rows[0].dapatan, 'Dapatan A');
  });
  await gagal(sebagai('skA', (tx) => tx.query(`select public.hantar_maklumbalas($1, 'cuba', 'Selesai')`, [rekodB])), /tidak dijumpai/);
  await gagal(sebagai('skA', (tx) => tx.query(`select public.hantar_maklumbalas($1, 'cuba', 'Menunggu Maklumbalas')`, [rekodA])), /Status/);
  await gagal(sebagai('skA', (tx) => tx.query(`select public.hantar_maklumbalas($1, '   ', 'Selesai')`, [rekodA])), /Sila isi/);
  await gagal(sebagai('orangLuar', (tx) => tx.query(`select public.hantar_maklumbalas($1, 'cuba', 'Selesai')`, [rekodA])), /Akses ditolak/);
  await gagal(sebagai('adminOtp', (tx) => tx.query(`select public.hantar_maklumbalas($1, 'cuba', 'Selesai')`, [rekodA])), /Akses ditolak/);
});

test('jadual lampiran: sekolah hanya menambah/memadam gambar maklumbalas sendiri', async () => {
  const laluan = (rekod, jenis) => `${rekod}/${jenis}/${randomUUID()}.jpg`;
  await sebagai('skA', async (tx) => {
    const r = await tx.query(`insert into public.lampiran (rekod_id, jenis, laluan) values ($1, 'maklumbalas', $2) returning dimuat_naik_oleh`, [rekodA, laluan(rekodA, 'maklumbalas')]);
    assert.equal(r.rows[0].dimuat_naik_oleh, ID.skA);
    const lihat = await tx.query('select jenis from public.lampiran order by jenis');
    assert.deepEqual(lihat.rows.map((x) => x.jenis), ['dapatan', 'maklumbalas']);
  });
  await gagal(sebagai('skA', (tx) => tx.query(`insert into public.lampiran (rekod_id, jenis, laluan) values ($1, 'dapatan', $2)`, [rekodA, laluan(rekodA, 'dapatan')])), /row-level security/);
  await gagal(sebagai('skA', (tx) => tx.query(`insert into public.lampiran (rekod_id, jenis, laluan) values ($1, 'maklumbalas', $2)`, [rekodB, laluan(rekodB, 'maklumbalas')])), /row-level security/);
  await gagal(sebagai('skA', (tx) => tx.query(`insert into public.lampiran (rekod_id, jenis, laluan) values ($1, 'maklumbalas', $2)`, [rekodA, laluan(rekodB, 'maklumbalas')])), /lampiran_laluan_sah/);
  const d = await sebagai('skA', (tx) => tx.query('delete from public.lampiran where id = $1', [lampiranAdminA]));
  assert.equal(d.affectedRows, 0, 'sekolah tidak boleh memadam gambar dapatan pegawai');
  const b = await sebagai('skB', (tx) => tx.query('delete from public.lampiran where id = $1', [lampiranAdminA]));
  assert.equal(b.affectedRows, 0, 'sekolah lain tidak boleh memadam gambar');
});

test('had 10 gambar bagi setiap bahagian', async () => {
  await sebagai('admin', async (tx) => {
    for (let i = 0; i < 9; i++) {
      await tx.query(`insert into public.lampiran (rekod_id, jenis, laluan) values ($1::uuid, 'dapatan', $1::text || '/dapatan/' || $2::text || '.jpg')`, [rekodA, randomUUID()]);
    }
    await assert.rejects(
      tx.query(`insert into public.lampiran (rekod_id, jenis, laluan) values ($1::uuid, 'dapatan', $1::text || '/dapatan/' || $2::text || '.jpg')`, [rekodA, randomUUID()]),
      /Had maksimum 10/);
  });
});

test('storan: polisi baca, muat naik dan padam objek mengikut peranan', async () => {
  const objA = `${rekodA}/maklumbalas/${randomUUID()}.jpg`;
  const objAdmin = `${rekodA}/dapatan/${randomUUID()}.jpg`;
  await sebagai('admin', (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('lampiran', $1, $2)`, [objAdmin, ID.admin]), { kekal: true });

  await sebagai('skA', async (tx) => {
    await tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('lampiran', $1, $2)`, [objA, ID.skA]);
    const lihat = await tx.query(`select name from storage.objects where bucket_id = 'lampiran' order by name`);
    assert.equal(lihat.rows.length, 2);
    const p = await tx.query('delete from storage.objects where name = $1', [objA]);
    assert.equal(p.affectedRows, 1);
    const p2 = await tx.query('delete from storage.objects where name = $1', [objAdmin]);
    assert.equal(p2.affectedRows, 0, 'sekolah tidak boleh memadam gambar pegawai');
  });
  await gagal(sebagai('skA', (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('lampiran', $1, $2)`, [`${rekodA}/dapatan/${randomUUID()}.jpg`, ID.skA])), /row-level security/);
  await gagal(sebagai('skA', (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('lampiran', $1, $2)`, [`${rekodB}/maklumbalas/${randomUUID()}.jpg`, ID.skA])), /row-level security/);
  await gagal(sebagai('skA', (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('lampiran', $1, $2)`, [`../${rekodA}/maklumbalas/x.jpg`, ID.skA])), /row-level security/);
  await gagal(sebagai('admin', (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('lampiran', $1, $2)`, [`${randomUUID()}/dapatan/${randomUUID()}.jpg`, ID.admin])), /row-level security/);
  const awam = await sebagai('anon', (tx) => tx.query(`select name from storage.objects where bucket_id = 'lampiran'`));
  assert.deepEqual(awam.rows.map((x) => x.name), [objAdmin], 'gambar boleh dibaca umum (URL bertandatangan)');
  const b = await sebagai('skB', (tx) => tx.query('delete from storage.objects where name = $1', [objAdmin]));
  assert.equal(b.affectedRows, 0, 'sekolah lain tidak boleh memadam gambar');
  const anonPadam = await sebagai('anon', (tx) => tx.query('delete from storage.objects where name = $1', [objAdmin]));
  assert.equal(anonPadam.affectedRows, 0, 'orang awam tidak boleh memadam gambar');
  await gagal(sebagai('orangLuar', (tx) => tx.query(`insert into storage.objects (bucket_id, name, owner_id) values ('lampiran', $1, $2)`, [`${rekodA}/maklumbalas/${randomUUID()}.jpg`, ID.orangLuar])), /row-level security/);
});

test('sekolah yang dinyahaktifkan hilang akses serta-merta', async () => {
  await db.transaction(async (tx) => {
    await tx.query('update public.sekolah set aktif = false where id = $1', [sekolahA]);
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(tuntutan.skA)]);
    await tx.exec('set local role authenticated');
    const s = await tx.query('select * from public.sekolah');
    assert.equal(s.rows.length, 0);
    const p = await tx.query('select public.profil_saya() p');
    assert.equal(p.rows[0].p.peranan, null);
    await tx.rollback();
  });
});

test('pentadbir aktif terakhir tidak boleh dinyahaktif atau dipadam', async () => {
  await gagal(sebagai('admin', (tx) => tx.query('update public.pentadbir set aktif = false')), /Sekurang-kurangnya/);
  await gagal(sebagai('admin', (tx) => tx.query('delete from public.pentadbir')), /Sekurang-kurangnya/);
  await sebagai('admin', async (tx) => {
    await tx.query(`insert into public.pentadbir (emel, nama) values ('kedua@moe.gov.my', 'Pentadbir Kedua')`);
    const r = await tx.query(`update public.pentadbir set aktif = false where emel = $1`, [EMEL.admin]);
    assert.equal(r.affectedRows, 1);
  });
});

test('emel tidak boleh didaftar sebagai sekolah dan pentadbir serentak', async () => {
  await gagal(sebagai('admin', (tx) => tx.query(`insert into public.pentadbir (emel, nama) values ($1, 'Pertindihan')`, [EMEL.skA])), /emel sekolah/);
  await gagal(sebagai('admin', (tx) => tx.query(`update public.sekolah set emel = $1 where id = $2`, [EMEL.admin, sekolahB])), /emel pentadbir/);
  await gagal(sebagai('admin', (tx) => tx.query(`update public.sekolah set emel = 'bukan-emel' where id = $1`, [sekolahB])), /check constraint/);
});

test('rekod yang mempunyai lawatan tidak boleh memadam sekolahnya', async () => {
  await gagal(sebagai('admin', (tx) => tx.query('delete from public.sekolah where id = $1', [sekolahA])), /foreign key/);
});

test('medan sistem tidak boleh dipalsukan oleh pentadbir', async () => {
  await sebagai('admin', async (tx) => {
    await tx.query(`update public.rekod_lawatan set dicipta_oleh = $1, dicipta_pada = '2000-01-01', maklumbalas_oleh = $1 where id = $2`, [ID.skB, rekodB]);
    const r = await tx.query('select dicipta_oleh, dicipta_pada, maklumbalas_oleh from public.rekod_lawatan where id = $1', [rekodB]);
    assert.equal(r.rows[0].dicipta_oleh, ID.admin);
    assert.notEqual(new Date(r.rows[0].dicipta_pada).getUTCFullYear(), 2000);
    assert.equal(r.rows[0].maklumbalas_oleh, null);
  });
});

test('log audit merekod pelaku dan perubahan', async () => {
  const r = await sebagai('admin', (tx) => tx.query(`select jadual, tindakan, emel from public.log_audit where jadual = 'rekod_lawatan' and tindakan = 'INSERT'`));
  assert.equal(r.rows.length, 2);
  assert.ok(r.rows.every((x) => x.emel === EMEL.admin));
  await gagal(sebagai('admin', (tx) => tx.query(`insert into public.log_audit (jadual, tindakan) values ('x', 'y')`)), /permission denied/);
  await gagal(sebagai('admin', (tx) => tx.query(`delete from public.log_audit`)), /permission denied/);
});

test('log masuk sekolah direkod oleh fungsi Edge (service_role); sekolah tidak boleh membaca atau menulis log', async () => {
  await db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    await tx.query(
      `insert into public.log_audit (pelaku, emel, jadual, tindakan, data_baru)
       values ($1::uuid, $2::text, 'auth', 'LOG MASUK', jsonb_build_object('sekolah', 'SK Limbang', 'ip', '203.0.113.5'))`,
      [ID.skA, EMEL.skA]);
  });
  const r = await sebagai('admin', (tx) => tx.query(`select emel, data_baru->>'ip' as ip from public.log_audit where tindakan = 'LOG MASUK'`));
  assert.deepEqual(r.rows, [{ emel: EMEL.skA, ip: '203.0.113.5' }]);
  const s = await sebagai('skA', (tx) => tx.query('select * from public.log_audit'));
  assert.equal(s.rows.length, 0);
  await gagal(sebagai('skA', (tx) => tx.query(`insert into public.log_audit (jadual, tindakan) values ('auth', 'LOG MASUK')`)), /permission denied/);
});

test('fungsi skema private tidak boleh dipanggil oleh anon', async () => {
  await gagal(sebagai('anon', (tx) => tx.query('select private.adalah_admin()')), /permission denied/);
});
