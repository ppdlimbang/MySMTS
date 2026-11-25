import { sb, konfigSah, dapatkanProfil, tetapKataLaluanPentadbir, BALDI, KONFIG } from './klien.js';
import {
  $, $$, esc, formatTarikh, formatMasa, formatCapMasa, tarikhHariIni, masaSekarang, STATUS, kelasStatus,
  toast, mesejRalat, setSibuk, paparMesej, mampatGambar, muatTurun, selCsv, sahkan, bersihCarian,
  EMEL_SAH, normalEmel, IKON_LOGO, semakKekuatanKataLaluan,
} from './util.js';

const SAIZ_HALAMAN = 20;
const MAKS_GAMBAR = 10;
const TEMPOH_URL_SAAT = 3600;
const SAIZ_AUDIT = 50;

const PILIH_REKOD = [
  'id', 'sekolah_id', 'tarikh', 'masa', 'nama_pegawai', 'jawatan', 'dapatan', 'maklumbalas', 'status',
  'dicipta_pada', 'dikemaskini_pada', 'maklumbalas_pada',
  'sekolah:sekolah_id(id,nama,kod)',
  'lampiran(id,jenis,laluan,dimuat_naik_oleh,dicipta_pada)',
].join(',');

const keadaan = {
  profil: null,
  admin: false,
  sekolah: [],
  pentadbir: [],
  penapis: { carian: '', status: 'SEMUA', sekolahId: '', dari: '', hingga: '' },
  halaman: 0,
  jumlah: 0,
  rekod: [],
  urlGambar: new Map(), // laluan -> { url, tamat }
  auditDari: 0,
  paparan: 'rekod',
};

let nomborMuat = 0;
let logKeluarSendiri = false;
let borang = null;

// =====================================================================
// Permulaan
// =====================================================================

function ralatPemuat(teks, denganPautan = true) {
  $('#pemuatTeks').hidden = true;
  paparMesej($('#pemuatRalat'), teks, 'ralat');
  $('#pemuatPautan').hidden = !denganPautan;
}

function keLogMasuk(sebab) {
  window.location.replace(sebab ? `index.html?sebab=${encodeURIComponent(sebab)}` : 'index.html');
}

async function mula() {
  $('#logo').innerHTML = IKON_LOGO;
  $('#tahun').textContent = String(new Date().getFullYear());

  if (!konfigSah) {
    ralatPemuat('Sistem belum dikonfigurasi (config.js tiada atau tidak lengkap). Hubungi pentadbir sistem.', false);
    return;
  }

  const { data } = await sb.auth.getSession();
  if (!data.session) {
    keLogMasuk();
    return;
  }

  try {
    keadaan.profil = await dapatkanProfil();
  } catch (e) {
    ralatPemuat(mesejRalat(e, 'Profil pengguna tidak dapat dimuatkan.'));
    return;
  }
  if (!keadaan.profil?.peranan) {
    await sb.auth.signOut();
    keLogMasuk();
    return;
  }
  keadaan.admin = keadaan.profil.peranan === 'admin';

  sb.auth.onAuthStateChange((peristiwa) => {
    if (peristiwa === 'SIGNED_OUT' && !logKeluarSendiri) keLogMasuk('tamat');
  });

  paparPengguna();
  $$('[data-admin]').forEach((x) => { x.hidden = !keadaan.admin; });
  pasangPeristiwa();

  try {
    await muatSekolah();
  } catch (e) {
    ralatPemuat(mesejRalat(e, 'Senarai sekolah tidak dapat dimuatkan.'));
    return;
  }

  $('#pemuat').hidden = true;
  ['#kepala', '#navTab', '#utama', '#kaki'].forEach((s) => { $(s).hidden = false; });
  if (!keadaan.admin) $('#navTab').hidden = true;

  await muatRekod();
}

function paparPengguna() {
  const p = keadaan.profil;
  if (keadaan.admin) {
    $('#penggunaPeranan').textContent = 'Pentadbir PPD';
    $('#penggunaNama').textContent = p.nama || p.emel;
  } else {
    $('#penggunaPeranan').textContent = 'Sekolah';
    $('#penggunaNama').textContent = p.sekolah?.nama || p.emel;
  }
  $('#penggunaNama').title = p.emel || '';
}

// =====================================================================
// Peristiwa
// =====================================================================

function pasangPeristiwa() {
  $('#btnKeluar').addEventListener('click', async () => {
    logKeluarSendiri = true;
    setSibuk($('#btnKeluar'), true);
    await sb.auth.signOut();
    keLogMasuk();
  });

  $$('#navTab [data-paparan]').forEach((b) => b.addEventListener('click', () => tukarPaparan(b.dataset.paparan)));

  // Penapis
  let pemasaCarian = null;
  $('#carian').addEventListener('input', () => {
    clearTimeout(pemasaCarian);
    pemasaCarian = setTimeout(() => {
      keadaan.penapis.carian = $('#carian').value;
      keadaan.halaman = 0;
      muatRekod();
    }, 350);
  });
  $('#borangPenapis').addEventListener('submit', (e) => e.preventDefault());
  $('#penapisStatus').addEventListener('change', () => tetapStatus($('#penapisStatus').value));
  $('#penapisSekolah').addEventListener('change', () => {
    keadaan.penapis.sekolahId = $('#penapisSekolah').value;
    keadaan.halaman = 0;
    muatRekod();
  });
  for (const [id, kunci] of [['#penapisDari', 'dari'], ['#penapisHingga', 'hingga']]) {
    $(id).addEventListener('change', () => {
      keadaan.penapis[kunci] = $(id).value;
      keadaan.halaman = 0;
      muatRekod();
    });
  }
  $('#btnSetSemula').addEventListener('click', () => {
    keadaan.penapis = { carian: '', status: 'SEMUA', sekolahId: '', dari: '', hingga: '' };
    $('#carian').value = '';
    $('#penapisSekolah').value = '';
    $('#penapisDari').value = '';
    $('#penapisHingga').value = '';
    tetapStatus('SEMUA');
  });
  $$('.stat').forEach((b) => b.addEventListener('click', () => tetapStatus(b.dataset.status)));

  $('#btnSebelum').addEventListener('click', () => {
    if (keadaan.halaman > 0) {
      keadaan.halaman -= 1;
      muatRekod(true);
    }
  });
  $('#btnSeterusnya').addEventListener('click', () => {
    if ((keadaan.halaman + 1) * SAIZ_HALAMAN < keadaan.jumlah) {
      keadaan.halaman += 1;
      muatRekod(true);
    }
  });

  $('#btnEksport').addEventListener('click', eksportCsv);
  $('#btnRekodBaru').addEventListener('click', () => bukaBorangRekod(null));
  $('#senaraiRekod').addEventListener('click', klikSenaraiRekod);

  // Borang rekod
  $('#borangRekod').addEventListener('submit', simpanRekod);
  $('#borangRekod').addEventListener('input', () => { if (borang) borang.ubah = true; });
  $('#failDapatan').addEventListener('change', (e) => tambahGambar(e.target, 'dapatan'));
  $('#failMaklumbalas').addEventListener('change', (e) => tambahGambar(e.target, 'maklumbalas'));
  $('#galeriDapatan').addEventListener('click', klikGaleriBorang);
  $('#galeriMaklumbalas').addEventListener('click', klikGaleriBorang);
  $('#dialogRekod').addEventListener('cancel', (e) => {
    e.preventDefault();
    tutupBorangRekod();
  });
  $('#dialogRekod').addEventListener('close', bersihBorangRekod);

  // Dialog umum
  $$('dialog [data-tutup]').forEach((b) => b.addEventListener('click', () => {
    const d = b.closest('dialog');
    if (d.id === 'dialogRekod') tutupBorangRekod();
    else d.close();
  }));
  $('#dialogGambar').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });

  // Sekolah
  $('#btnSekolahBaru').addEventListener('click', () => bukaBorangSekolah(null));
  $('#jadualSekolah').addEventListener('click', klikJadualSekolah);
  $('#borangSekolah').addEventListener('submit', simpanSekolah);

  // Pentadbir
  $('#btnPentadbirBaru').addEventListener('click', () => bukaBorangPentadbir(null));
  $('#jadualPentadbir').addEventListener('click', klikJadualPentadbir);
  $('#borangPentadbir').addEventListener('submit', simpanPentadbir);

  // Kata laluan pentadbir
  $('#btnKataLaluanSaya').addEventListener('click', () => bukaBorangKataLaluan({
    emel: keadaan.profil.emel, nama: keadaan.profil.nama,
  }));
  $('#borangKataLaluan').addEventListener('submit', simpanKataLaluan);
  $('#dialogKataLaluan').addEventListener('close', () => {
    $('#klBaharu').value = '';
    $('#klSahkan').value = '';
  });

  // Audit
  $('#btnMuatSemulaAudit').addEventListener('click', () => muatAudit(true));
  $('#btnAuditLagi').addEventListener('click', () => muatAudit(false));
}

function tukarPaparan(nama) {
  if (!keadaan.admin && nama !== 'rekod') return;
  keadaan.paparan = nama;
  $$('#navTab [data-paparan]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.paparan === nama)));
  $$('[data-paparan-panel]').forEach((p) => { p.hidden = p.dataset.paparanPanel !== nama; });
  if (nama === 'sekolah') {
    paparSekolah();
    muatSekolah().then(paparSekolah).catch((e) => toast(mesejRalat(e), 'ralat'));
  }
  if (nama === 'pentadbir') muatPentadbir();
  if (nama === 'audit') muatAudit(true);
  if (nama === 'rekod') muatRekod(true);
}

function tetapStatus(status) {
  keadaan.penapis.status = status;
  keadaan.halaman = 0;
  $('#penapisStatus').value = status;
  $$('.stat').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === status)));
  muatRekod();
}

// =====================================================================
// Sekolah (senarai rujukan)
// =====================================================================

async function muatSekolah() {
  if (keadaan.admin) {
    const { data, error } = await sb.from('sekolah')
      .select('id,nama,kod,emel,aktif,dicipta_pada')
      .order('nama', { ascending: true });
    if (error) throw error;
    keadaan.sekolah = data;
  } else {
    keadaan.sekolah = keadaan.profil.sekolah ? [{ ...keadaan.profil.sekolah, aktif: true }] : [];
  }
  const pilihan = $('#penapisSekolah');
  const semasa = pilihan.value;
  pilihan.innerHTML = '<option value="">Semua sekolah</option>' + keadaan.sekolah
    .map((s) => `<option value="${esc(s.id)}">${esc(s.nama)}${s.aktif ? '' : ' (tidak aktif)'}</option>`)
    .join('');
  if (keadaan.sekolah.some((s) => s.id === semasa)) pilihan.value = semasa;
}

function namaSekolah(id) {
  return keadaan.sekolah.find((s) => s.id === id)?.nama || '';
}

// =====================================================================
// Rekod lawatan
// =====================================================================

function terapPenapis(q, denganStatus) {
  const p = keadaan.penapis;
  if (denganStatus && p.status !== 'SEMUA') q = q.eq('status', p.status);
  if (p.sekolahId) q = q.eq('sekolah_id', p.sekolahId);
  if (p.dari) q = q.gte('tarikh', p.dari);
  if (p.hingga) q = q.lte('tarikh', p.hingga);
  const c = bersihCarian(p.carian);
  if (c) {
    const syarat = ['nama_pegawai', 'jawatan', 'dapatan', 'maklumbalas'].map((k) => `${k}.ilike.*${c}*`);
    const kecil = c.toLowerCase();
    const idSekolah = keadaan.sekolah
      .filter((s) => s.nama.toLowerCase().includes(kecil) || (s.kod || '').toLowerCase().includes(kecil))
      .map((s) => s.id)
      .slice(0, 100);
    if (idSekolah.length) syarat.push(`sekolah_id.in.(${idSekolah.join(',')})`);
    q = q.or(syarat.join(','));
  }
  return q;
}

async function muatStatistik() {
  const asas = () => terapPenapis(sb.from('rekod_lawatan').select('id', { count: 'exact', head: true }), false);
  const hasil = await Promise.all([
    asas(),
    asas().eq('status', 'Menunggu Maklumbalas'),
    asas().eq('status', 'Dalam Tindakan'),
    asas().eq('status', 'Selesai'),
  ]);
  return hasil.map((h) => (h.error ? null : h.count ?? 0));
}

async function muatRekod(tatalAtas = false) {
  const nombor = ++nomborMuat;
  const senarai = $('#senaraiRekod');
  senarai.setAttribute('aria-busy', 'true');
  if (!keadaan.rekod.length) senarai.innerHTML = '<div class="kad kosong"><p class="memuat">Memuatkan rekod</p></div>';

  const dari = keadaan.halaman * SAIZ_HALAMAN;
  const q = terapPenapis(sb.from('rekod_lawatan').select(PILIH_REKOD, { count: 'exact' }), true)
    .order('tarikh', { ascending: false })
    .order('masa', { ascending: false, nullsFirst: false })
    .order('dicipta_pada', { ascending: false })
    .range(dari, dari + SAIZ_HALAMAN - 1);

  const [hasil, stat] = await Promise.all([q, muatStatistik()]);
  if (nombor !== nomborMuat) return;
  senarai.removeAttribute('aria-busy');

  ['#statJumlah', '#statMenunggu', '#statTindakan', '#statSelesai'].forEach((s, i) => {
    $(s).textContent = stat[i] == null ? '–' : String(stat[i]);
  });

  if (hasil.error) {
    if ((hasil.error.code === 'PGRST103' || hasil.status === 416) && keadaan.halaman > 0) {
      keadaan.halaman = 0;
      muatRekod();
      return;
    }
    keadaan.rekod = [];
    senarai.innerHTML = `<div class="kad kosong"><h3>Rekod tidak dapat dimuatkan</h3><p>${esc(mesejRalat(hasil.error))}</p></div>`;
    $('#rekodKosong').hidden = true;
    $('#penomboran').hidden = true;
    return;
  }

  keadaan.jumlah = hasil.count ?? hasil.data.length;
  if (!hasil.data.length && keadaan.halaman > 0) {
    keadaan.halaman = Math.max(0, Math.ceil(keadaan.jumlah / SAIZ_HALAMAN) - 1);
    muatRekod();
    return;
  }
  keadaan.rekod = hasil.data.map((r) => ({
    ...r,
    lampiran: [...(r.lampiran || [])].sort((a, b) => String(a.dicipta_pada).localeCompare(String(b.dicipta_pada))),
  }));
  await sediakanUrlGambar(keadaan.rekod.flatMap((r) => r.lampiran.map((l) => l.laluan)));
  if (nombor !== nomborMuat) return;
  paparRekod();
  if (tatalAtas) $('#paparan-rekod').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function sediakanUrlGambar(laluan) {
  const kini = Date.now();
  const perlu = [...new Set(laluan)].filter((l) => {
    const c = keadaan.urlGambar.get(l);
    return !c || c.tamat - kini < 5 * 60 * 1000;
  });
  for (let i = 0; i < perlu.length; i += 100) {
    const kumpulan = perlu.slice(i, i + 100);
    const { data, error } = await sb.storage.from(BALDI).createSignedUrls(kumpulan, TEMPOH_URL_SAAT);
    if (error) {
      console.warn('URL gambar gagal dijana:', error);
      continue;
    }
    for (const d of data || []) {
      if (d.signedUrl && !d.error) {
        keadaan.urlGambar.set(d.path, { url: d.signedUrl, tamat: kini + TEMPOH_URL_SAAT * 1000 });
      }
    }
  }
}

function urlGambar(laluan) {
  return keadaan.urlGambar.get(laluan)?.url || '';
}

function htmlGaleri(lampiran, label, namaSek) {
  if (!lampiran.length) return '';
  return `<p class="galeri-label">${esc(label)} (${lampiran.length})</p><div class="galeri">${lampiran.map((l, i) => {
    const url = urlGambar(l.laluan);
    const kapsyen = `${label} #${i + 1} — ${namaSek}`;
    return url
      ? `<button type="button" class="gambar-kecil" data-tindakan="gambar" data-url="${esc(url)}" data-kapsyen="${esc(kapsyen)}"><img src="${esc(url)}" alt="${esc(kapsyen)}" loading="lazy"></button>`
      : `<span class="gambar-kecil" title="Gambar tidak dapat dimuatkan"></span>`;
  }).join('')}</div>`;
}

function paparRekod() {
  const senarai = $('#senaraiRekod');
  const kosong = $('#rekodKosong');
  const ada = keadaan.rekod.length > 0;
  kosong.hidden = ada;
  if (!ada) {
    const adaPenapis = keadaan.penapis.carian || keadaan.penapis.status !== 'SEMUA' || keadaan.penapis.sekolahId
      || keadaan.penapis.dari || keadaan.penapis.hingga;
    $('#rekodKosongTeks').textContent = adaPenapis
      ? 'Tiada rekod lawatan yang sepadan dengan penapis semasa.'
      : (keadaan.admin ? 'Belum ada rekod lawatan. Klik "+ Rekod lawatan baharu" untuk bermula.' : 'Belum ada rekod lawatan untuk sekolah anda.');
  }

  senarai.innerHTML = keadaan.rekod.map((r) => {
    const namaSek = r.sekolah?.nama || namaSekolah(r.sekolah_id) || '—';
    const dapatan = r.lampiran.filter((l) => l.jenis === 'dapatan');
    const bukti = r.lampiran.filter((l) => l.jenis === 'maklumbalas');
    const masa = formatMasa(r.masa);
    const butangSekolah = r.maklumbalas ? 'Kemaskini maklumbalas' : 'Isi maklumbalas';
    return `
      <article class="kad rekod">
        <div class="rekod-kepala">
          <div>
            <p class="rekod-meta">${esc(formatTarikh(r.tarikh))}${masa ? ` · ${esc(masa)}` : ''}${r.sekolah?.kod ? ` · ${esc(r.sekolah.kod)}` : ''}</p>
            <h3>${esc(namaSek)}</h3>
          </div>
          <span class="lencana ${kelasStatus(r.status)}">${esc(r.status)}</span>
        </div>
        <div class="rekod-badan">
          <div class="pegawai">
            <div><small>Pegawai lawatan PPD</small><strong>${esc(r.nama_pegawai)}</strong></div>
            <span class="tag">${esc(r.jawatan)}</span>
          </div>
          <div class="blok-teks">
            <h4>Dapatan &amp; teguran pegawai</h4>
            <div class="teks">${esc(r.dapatan)}</div>
            ${htmlGaleri(dapatan, 'Gambar dapatan', namaSek)}
          </div>
          <div class="blok-teks b">
            <h4>Maklumbalas &amp; tindakan sekolah</h4>
            ${r.maklumbalas
              ? `<div class="teks">${esc(r.maklumbalas)}</div>`
              : '<div class="teks-kosong">Belum ada maklumbalas daripada pihak sekolah.</div>'}
            ${htmlGaleri(bukti, 'Gambar bukti sekolah', namaSek)}
          </div>
        </div>
        <div class="rekod-kaki">
          ${keadaan.admin
            ? `<button type="button" class="btn btn-utama btn-kecil" data-tindakan="edit" data-id="${esc(r.id)}">Kemaskini</button>`
            : `<button type="button" class="btn btn-emas btn-kecil" data-tindakan="edit" data-id="${esc(r.id)}">${butangSekolah}</button>`}
          <button type="button" class="btn btn-garis btn-kecil" data-tindakan="cetak" data-id="${esc(r.id)}">Cetak A4</button>
          <span class="cap-masa kanan">${r.maklumbalas_pada ? `Maklumbalas: ${esc(formatCapMasa(r.maklumbalas_pada))}` : `Direkod: ${esc(formatCapMasa(r.dicipta_pada))}`}</span>
          ${keadaan.admin ? `<button type="button" class="btn btn-bahaya-garis btn-kecil" data-tindakan="padam" data-id="${esc(r.id)}">Padam</button>` : ''}
        </div>
      </article>`;
  }).join('');

  const halamanAkhir = Math.max(1, Math.ceil(keadaan.jumlah / SAIZ_HALAMAN));
  $('#penomboran').hidden = keadaan.jumlah <= SAIZ_HALAMAN;
  const mula = keadaan.jumlah ? keadaan.halaman * SAIZ_HALAMAN + 1 : 0;
  const akhir = Math.min(keadaan.jumlah, (keadaan.halaman + 1) * SAIZ_HALAMAN);
  $('#infoHalaman').textContent = `Rekod ${mula}–${akhir} daripada ${keadaan.jumlah} · Halaman ${keadaan.halaman + 1}/${halamanAkhir}`;
  $('#btnSebelum').disabled = keadaan.halaman === 0;
  $('#btnSeterusnya').disabled = keadaan.halaman + 1 >= halamanAkhir;
}

function klikSenaraiRekod(e) {
  const b = e.target.closest('[data-tindakan]');
  if (!b) return;
  const t = b.dataset.tindakan;
  if (t === 'gambar') {
    bukaGambar(b.dataset.url, b.dataset.kapsyen);
    return;
  }
  const rekod = keadaan.rekod.find((r) => r.id === b.dataset.id);
  if (!rekod) return;
  if (t === 'edit') bukaBorangRekod(rekod);
  if (t === 'cetak') cetakRekod(rekod, b);
  if (t === 'padam') padamRekod(rekod);
}

function bukaGambar(url, kapsyen) {
  if (!url) return;
  const img = $('#gambarBesar');
  img.src = url;
  img.alt = kapsyen || 'Gambar lampiran';
  $('#kapsyenGambar').textContent = kapsyen || '';
  $('#dialogGambar').showModal();
}

// ---------------------------------------------------------------------
// Borang rekod (cipta / kemaskini / maklumbalas sekolah)
// ---------------------------------------------------------------------

function bukaBorangRekod(rekod) {
  const mod = keadaan.admin ? (rekod ? 'admin-edit' : 'admin-baru') : 'sekolah';
  if (mod === 'sekolah' && !rekod) return;

  const lampiran = rekod?.lampiran || [];
  borang = {
    mod,
    rekod,
    sedia: {
      dapatan: lampiran.filter((l) => l.jenis === 'dapatan'),
      maklumbalas: lampiran.filter((l) => l.jenis === 'maklumbalas'),
    },
    buang: new Set(),
    baru: { dapatan: [], maklumbalas: [] },
    memproses: 0,
    menyimpan: false,
    ubah: false,
  };

  paparMesej($('#mesejRekod'), '');
  const sekolahDipilih = rekod?.sekolah_id || '';
  const pilihanSekolah = keadaan.sekolah.filter((s) => s.aktif || s.id === sekolahDipilih);
  $('#fSekolah').innerHTML = (mod === 'admin-baru' ? '<option value="">— Pilih sekolah —</option>' : '')
    + pilihanSekolah.map((s) => `<option value="${esc(s.id)}">${esc(s.nama)}${s.aktif ? '' : ' (tidak aktif)'}</option>`).join('');
  $('#fSekolah').value = sekolahDipilih;
  $('#fTarikh').value = rekod?.tarikh || tarikhHariIni();
  $('#fMasa').value = rekod ? formatMasa(rekod.masa) : masaSekarang();
  $('#fPegawai').value = rekod?.nama_pegawai || '';
  $('#fJawatan').value = rekod?.jawatan || '';
  $('#fDapatan').value = rekod?.dapatan || '';
  $('#fMaklumbalas').value = rekod?.maklumbalas || '';

  const sekolah = mod === 'sekolah';
  $('#bahagianA').disabled = sekolah;
  $('#wajibMaklumbalas').hidden = !sekolah;
  $('#fMaklumbalas').required = sekolah;
  const opsMenunggu = $('#fStatus').querySelector('option[value="Menunggu Maklumbalas"]');
  opsMenunggu.hidden = sekolah;
  opsMenunggu.disabled = sekolah;
  let status = rekod?.status || 'Menunggu Maklumbalas';
  if (sekolah && status === 'Menunggu Maklumbalas') status = 'Dalam Tindakan';
  $('#fStatus').value = status;

  $('[data-boleh-tambah="dapatan"]').hidden = sekolah;
  $('[data-boleh-tambah="maklumbalas"]').hidden = false;

  $('#tajukRekod').textContent = {
    'admin-baru': 'Rekod lawatan baharu',
    'admin-edit': 'Kemaskini rekod lawatan',
    sekolah: rekod?.maklumbalas ? 'Kemaskini maklumbalas sekolah' : 'Isi maklumbalas sekolah',
  }[mod];
  $('#kepalaRekod').classList.toggle('emas', sekolah);
  $('#btnSimpanRekod').textContent = sekolah ? 'Hantar maklumbalas' : 'Simpan rekod';
  $('#btnSimpanRekod').disabled = false;

  paparGaleriBorang('dapatan');
  paparGaleriBorang('maklumbalas');
  $('#dialogRekod').showModal();
  (sekolah ? $('#fMaklumbalas') : (mod === 'admin-baru' ? $('#fSekolah') : $('#fDapatan'))).focus();
}

function bolehBuangSedia(l) {
  if (keadaan.admin) return true;
  return l.jenis === 'maklumbalas' && l.dimuat_naik_oleh === keadaan.profil.id;
}

function bilanganGambar(jenis) {
  return borang.sedia[jenis].filter((l) => !borang.buang.has(l.id)).length + borang.baru[jenis].length;
}

function paparGaleriBorang(jenis) {
  const galeri = jenis === 'dapatan' ? $('#galeriDapatan') : $('#galeriMaklumbalas');
  const label = jenis === 'dapatan' ? 'Gambar dapatan' : 'Gambar bukti sekolah';
  const sedia = borang.sedia[jenis].filter((l) => !borang.buang.has(l.id));
  const html = [
    ...sedia.map((l, i) => {
      const url = urlGambar(l.laluan);
      const buang = bolehBuangSedia(l)
        ? `<button type="button" class="buang" data-buang-sedia="${esc(l.id)}" aria-label="Buang gambar">×</button>` : '';
      return `<div class="gambar-kecil">${url ? `<img src="${esc(url)}" alt="${esc(`${label} #${i + 1}`)}" data-url="${esc(url)}" data-kapsyen="${esc(`${label} #${i + 1}`)}">` : ''}${buang}</div>`;
    }),
    ...borang.baru[jenis].map((g) => `<div class="gambar-kecil baru" title="Gambar baharu (belum disimpan)"><img src="${esc(g.url)}" alt="Gambar baharu" data-url="${esc(g.url)}" data-kapsyen="Gambar baharu (belum disimpan)"><button type="button" class="buang" data-buang-baru="${esc(g.kunci)}" data-jenis="${jenis}" aria-label="Buang gambar">×</button></div>`),
  ];
  galeri.innerHTML = html.length ? html.join('') : '<span class="nota">Tiada gambar.</span>';
}

function klikGaleriBorang(e) {
  const sedia = e.target.closest('[data-buang-sedia]');
  if (sedia) {
    const l = [...borang.sedia.dapatan, ...borang.sedia.maklumbalas].find((x) => x.id === sedia.dataset.buangSedia);
    if (l && bolehBuangSedia(l)) {
      borang.buang.add(l.id);
      borang.ubah = true;
      paparGaleriBorang(l.jenis);
    }
    return;
  }
  const baru = e.target.closest('[data-buang-baru]');
  if (baru) {
    const jenis = baru.dataset.jenis;
    const i = borang.baru[jenis].findIndex((g) => g.kunci === baru.dataset.buangBaru);
    if (i >= 0) {
      URL.revokeObjectURL(borang.baru[jenis][i].url);
      borang.baru[jenis].splice(i, 1);
      paparGaleriBorang(jenis);
    }
    return;
  }
  const img = e.target.closest('img[data-url]');
  if (img) bukaGambar(img.dataset.url, img.dataset.kapsyen);
}

async function tambahGambar(input, jenis) {
  const fail = Array.from(input.files || []);
  input.value = '';
  if (!borang || !fail.length) return;
  if (jenis === 'dapatan' && !keadaan.admin) return;

  borang.memproses += 1;
  $('#btnSimpanRekod').disabled = true;
  let ditolak = 0;
  try {
    for (const f of fail) {
      if (bilanganGambar(jenis) >= MAKS_GAMBAR) {
        toast(`Had maksimum ${MAKS_GAMBAR} gambar bagi bahagian ini telah dicapai.`, 'amaran');
        break;
      }
      try {
        const blob = await mampatGambar(f);
        if (!borang) return;
        borang.baru[jenis].push({ kunci: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) });
        borang.ubah = true;
      } catch (err) {
        console.warn(err);
        ditolak += 1;
      }
    }
  } finally {
    if (borang) {
      borang.memproses -= 1;
      if (borang.memproses === 0 && !borang.menyimpan) $('#btnSimpanRekod').disabled = false;
      paparGaleriBorang(jenis);
    }
  }
  if (ditolak) toast(`${ditolak} fail tidak dapat diproses (bukan gambar atau format tidak disokong).`, 'amaran');
}

async function tutupBorangRekod() {
  if (!borang) {
    $('#dialogRekod').close();
    return;
  }
  if (borang.menyimpan) return;
  if (borang.ubah) {
    const ya = await sahkan({
      tajuk: 'Buang perubahan?',
      mesej: 'Perubahan yang belum disimpan akan hilang.',
      teksYa: 'Buang perubahan',
    });
    if (!ya) return;
  }
  $('#dialogRekod').close();
}

function bersihBorangRekod() {
  if (!borang) return;
  for (const jenis of ['dapatan', 'maklumbalas']) borang.baru[jenis].forEach((g) => URL.revokeObjectURL(g.url));
  borang = null;
}

function nilaiBorangRekod() {
  return {
    sekolah_id: $('#fSekolah').value,
    tarikh: $('#fTarikh').value,
    masa: $('#fMasa').value || null,
    nama_pegawai: $('#fPegawai').value.trim(),
    jawatan: $('#fJawatan').value.trim(),
    dapatan: $('#fDapatan').value.trim(),
    maklumbalas: $('#fMaklumbalas').value.trim() || null,
    status: $('#fStatus').value,
  };
}

function sahkanBorangRekod(n) {
  if (borang.mod !== 'sekolah') {
    if (!n.sekolah_id) return ['Sila pilih sekolah.', '#fSekolah'];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(n.tarikh)) return ['Sila masukkan tarikh lawatan yang sah.', '#fTarikh'];
    if (n.nama_pegawai.length < 2) return ['Sila isi nama pegawai lawatan.', '#fPegawai'];
    if (n.jawatan.length < 2) return ['Sila isi jawatan pegawai.', '#fJawatan'];
    if (!n.dapatan) return ['Sila isi dapatan dan teguran lawatan.', '#fDapatan'];
    if (!STATUS.includes(n.status)) return ['Status tidak sah.', '#fStatus'];
  } else {
    if (!n.maklumbalas) return ['Sila isi maklumbalas dan tindakan sekolah.', '#fMaklumbalas'];
    if (!['Dalam Tindakan', 'Selesai'].includes(n.status)) return ['Sila pilih status tindakan.', '#fStatus'];
  }
  return null;
}

async function simpanRekod(e) {
  e.preventDefault();
  if (!borang || borang.menyimpan || borang.memproses) return;
  paparMesej($('#mesejRekod'), '');
  const n = nilaiBorangRekod();
  const masalah = sahkanBorangRekod(n);
  if (masalah) {
    paparMesej($('#mesejRekod'), masalah[0], 'ralat');
    $(masalah[1]).focus();
    return;
  }

  const btn = $('#btnSimpanRekod');
  borang.menyimpan = true;
  setSibuk(btn, true, 'Menyimpan…');
  let id = borang.rekod?.id;
  try {
    if (borang.mod === 'admin-baru') {
      const { data, error } = await sb.from('rekod_lawatan').insert(n).select('id').single();
      if (error) throw error;
      id = data.id;
    } else if (borang.mod === 'admin-edit') {
      const { data, error } = await sb.from('rekod_lawatan').update(n).eq('id', id).select('id');
      if (error) throw error;
      if (!data.length) throw Object.assign(new Error('Rekod tidak dijumpai.'), { code: 'PGRST116' });
    } else {
      const { error } = await sb.rpc('hantar_maklumbalas', {
        p_rekod_id: id,
        p_maklumbalas: n.maklumbalas,
        p_status: n.status,
      });
      if (error) throw error;
    }
  } catch (err) {
    borang.menyimpan = false;
    setSibuk(btn, false);
    paparMesej($('#mesejRekod'), mesejRalat(err, 'Rekod gagal disimpan. Sila cuba lagi.'), 'ralat');
    return;
  }

  btn.textContent = 'Memuat naik gambar…';
  const gagal = await prosesGambar(id);
  const baru = borang.mod === 'admin-baru';
  const sekolah = borang.mod === 'sekolah';
  borang.menyimpan = false;
  borang.ubah = false;
  setSibuk(btn, false);
  $('#dialogRekod').close();

  if (gagal) {
    toast(`Rekod disimpan, tetapi ${gagal} gambar gagal diproses. Buka semula rekod untuk mencuba lagi.`, 'amaran', 8000);
  } else {
    toast(sekolah ? 'Maklumbalas berjaya dihantar.' : (baru ? 'Rekod lawatan baharu berjaya disimpan.' : 'Rekod berjaya dikemas kini.'), 'berjaya');
  }
  if (baru) keadaan.halaman = 0;
  await muatRekod();
}

/** Padam gambar yang dibuang, kemudian muat naik gambar baharu. Pulangkan bilangan kegagalan. */
async function prosesGambar(rekodId) {
  let gagal = 0;
  const semuaSedia = [...borang.sedia.dapatan, ...borang.sedia.maklumbalas];

  for (const lid of borang.buang) {
    const l = semuaSedia.find((x) => x.id === lid);
    if (!l) continue;
    const { data, error } = await sb.from('lampiran').delete().eq('id', lid).select('id');
    if (error || !data?.length) {
      gagal += 1;
      continue;
    }
    const { error: e2 } = await sb.storage.from(BALDI).remove([l.laluan]);
    if (e2) console.warn('Objek storan tidak dipadam:', l.laluan, e2);
    keadaan.urlGambar.delete(l.laluan);
  }

  for (const jenis of ['dapatan', 'maklumbalas']) {
    if (jenis === 'dapatan' && !keadaan.admin) continue;
    for (const g of borang.baru[jenis]) {
      const laluan = `${rekodId}/${jenis}/${crypto.randomUUID()}.jpg`;
      const { error: eu } = await sb.storage.from(BALDI).upload(laluan, g.blob, {
        contentType: 'image/jpeg',
        cacheControl: '3600',
        upsert: false,
      });
      if (eu) {
        console.warn('Muat naik gagal:', eu);
        gagal += 1;
        continue;
      }
      const { error: ei } = await sb.from('lampiran').insert({ rekod_id: rekodId, jenis, laluan });
      if (ei) {
        console.warn('Lampiran gagal direkod:', ei);
        gagal += 1;
        await sb.storage.from(BALDI).remove([laluan]);
      }
    }
  }
  return gagal;
}

async function padamRekod(rekod) {
  if (!keadaan.admin) return;
  const ya = await sahkan({
    tajuk: 'Padam rekod lawatan?',
    mesej: `Rekod lawatan ke ${rekod.sekolah?.nama || 'sekolah'} pada ${formatTarikh(rekod.tarikh)} serta semua gambarnya akan dipadam secara kekal. Tindakan ini direkodkan dalam log audit.`,
    teksYa: 'Ya, padam rekod',
  });
  if (!ya) return;
  const laluan = rekod.lampiran.map((l) => l.laluan);
  const { data, error } = await sb.from('rekod_lawatan').delete().eq('id', rekod.id).select('id');
  if (error || !data?.length) {
    toast(error ? mesejRalat(error) : 'Rekod tidak dijumpai.', 'ralat');
    return;
  }
  if (laluan.length) {
    const { error: e2 } = await sb.storage.from(BALDI).remove(laluan);
    if (e2) console.warn('Sebahagian gambar tidak dipadam daripada storan:', e2);
  }
  toast('Rekod berjaya dipadam.', 'berjaya');
  await muatRekod();
}

// ---------------------------------------------------------------------
// Cetakan A4
// ---------------------------------------------------------------------

async function cetakRekod(rekod, butang) {
  setSibuk(butang, true);
  try {
    await sediakanUrlGambar(rekod.lampiran.map((l) => l.laluan));
    const namaSek = rekod.sekolah?.nama || namaSekolah(rekod.sekolah_id) || '-';
    const galeri = (jenis, label) => {
      const senarai = rekod.lampiran.filter((l) => l.jenis === jenis && urlGambar(l.laluan));
      if (!senarai.length) return '';
      return `<div class="gambar"><p>${esc(label)}</p><div>${senarai.map((l) => `<img src="${esc(urlGambar(l.laluan))}" alt="">`).join('')}</div></div>`;
    };
    const c = $('#cetakan');
    c.innerHTML = `
      <div class="cetak-kepala">
        <div class="organisasi">${esc(KONFIG.namaOrganisasi.toUpperCase())}</div>
        <div class="negeri">Sarawak, Malaysia</div>
        <h2>BORANG MAKLUMBALAS DAN TINDAKAN SEKOLAH</h2>
        <p>Rekod dapatan lawatan pegawai PPD dan maklumbalas pihak sekolah</p>
      </div>
      <table class="cetak-jadual">
        <tr><td class="l">NAMA SEKOLAH</td><td colspan="3"><strong>${esc(namaSek)}</strong>${rekod.sekolah?.kod ? ` (${esc(rekod.sekolah.kod)})` : ''}</td></tr>
        <tr><td class="l">TARIKH LAWATAN</td><td>${esc(formatTarikh(rekod.tarikh))}</td><td class="l">MASA LAWATAN</td><td>${esc(formatMasa(rekod.masa) || '-')}</td></tr>
        <tr><td class="l">NAMA PEGAWAI</td><td colspan="3">${esc(rekod.nama_pegawai)}</td></tr>
        <tr><td class="l">JAWATAN PEGAWAI</td><td colspan="3">${esc(rekod.jawatan)}</td></tr>
      </table>
      <div class="cetak-bahagian">
        <div class="tajuk">BAHAGIAN A: DAPATAN &amp; TEGURAN PEGAWAI PPD</div>
        <div class="isi">${esc(rekod.dapatan)}</div>
        ${galeri('dapatan', 'Lampiran gambar dapatan pegawai:')}
      </div>
      <div class="cetak-bahagian">
        <div class="tajuk">BAHAGIAN B: MAKLUMBALAS &amp; TINDAKAN PIHAK SEKOLAH <span>${esc(rekod.status.toUpperCase())}</span></div>
        <div class="isi">${esc(rekod.maklumbalas || '(Belum ada maklumbalas daripada pihak sekolah)')}</div>
        ${galeri('maklumbalas', 'Lampiran gambar bukti pihak sekolah:')}
      </div>
      <div class="cetak-tandatangan">
        <div><strong>Disediakan oleh (Pegawai PPD):</strong><div class="ruang"></div><div class="garis"><strong>${esc(rekod.nama_pegawai.toUpperCase())}</strong><br>${esc(rekod.jawatan)}</div></div>
        <div><strong>Disahkan oleh (Pihak Sekolah):</strong><div class="ruang"></div><div class="garis"><strong>( Tandatangan &amp; Cop Rasmi )</strong><br>Pengetua / Guru Besar</div></div>
      </div>
      <div class="cetak-kaki">
        <span>Dicetak daripada MySMTS — ${esc(KONFIG.namaOrganisasi)}</span>
        <span>Tarikh cetakan: ${esc(formatCapMasa(new Date().toISOString()))}</span>
      </div>`;
    const imej = $$('img', c);
    await Promise.race([
      Promise.all(imej.map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })))),
      new Promise((r) => setTimeout(r, 10000)),
    ]);
    window.print();
  } catch (err) {
    toast(mesejRalat(err, 'Dokumen tidak dapat disediakan untuk cetakan.'), 'ralat');
  } finally {
    setSibuk(butang, false);
  }
}

// ---------------------------------------------------------------------
// Eksport CSV
// ---------------------------------------------------------------------

async function eksportCsv() {
  const btn = $('#btnEksport');
  setSibuk(btn, true, 'Mengeksport…');
  try {
    const semua = [];
    const SAIZ = 1000;
    for (let dari = 0; dari < 100000; dari += SAIZ) {
      const q = terapPenapis(sb.from('rekod_lawatan').select(
        'id,tarikh,masa,nama_pegawai,jawatan,dapatan,maklumbalas,status,dicipta_pada,maklumbalas_pada,sekolah:sekolah_id(nama,kod),lampiran(jenis)',
      ), true)
        .order('tarikh', { ascending: false })
        .order('id', { ascending: true })
        .range(dari, dari + SAIZ - 1);
      const { data, error } = await q;
      if (error) throw error;
      semua.push(...data);
      if (data.length < SAIZ) break;
    }
    if (!semua.length) {
      toast('Tiada rekod untuk dieksport.', 'amaran');
      return;
    }
    const kepala = [
      'Nama Sekolah', 'Kod Sekolah', 'Tarikh Lawatan', 'Masa Lawatan', 'Nama Pegawai', 'Jawatan Pegawai',
      'Dapatan Pegawai', 'Bil. Gambar Dapatan', 'Maklumbalas Sekolah', 'Bil. Gambar Bukti', 'Status Tindakan',
      'Tarikh Maklumbalas', 'Tarikh Direkod',
    ];
    const baris = semua.map((r) => [
      r.sekolah?.nama, r.sekolah?.kod, r.tarikh, formatMasa(r.masa), r.nama_pegawai, r.jawatan, r.dapatan,
      (r.lampiran || []).filter((l) => l.jenis === 'dapatan').length,
      r.maklumbalas, (r.lampiran || []).filter((l) => l.jenis === 'maklumbalas').length,
      r.status, r.maklumbalas_pada ? formatCapMasa(r.maklumbalas_pada) : '', formatCapMasa(r.dicipta_pada),
    ].map(selCsv).join(','));
    const csv = `﻿${[kepala.map(selCsv).join(','), ...baris].join('\r\n')}`;
    muatTurun(csv, `MySMTS_PPD_Limbang_${tarikhHariIni()}.csv`, 'text/csv;charset=utf-8');
    toast(`${semua.length} rekod dieksport.`, 'berjaya');
  } catch (err) {
    toast(mesejRalat(err, 'Eksport gagal. Sila cuba lagi.'), 'ralat');
  } finally {
    setSibuk(btn, false);
  }
}

// =====================================================================
// Pengurusan sekolah (pentadbir)
// =====================================================================

let sekolahDiedit = null;

function paparSekolah() {
  const tb = $('#jadualSekolah');
  if (!keadaan.sekolah.length) {
    tb.innerHTML = '<tr><td colspan="5" class="redup">Tiada sekolah didaftarkan.</td></tr>';
    return;
  }
  tb.innerHTML = keadaan.sekolah.map((s) => `
    <tr>
      <td><strong>${esc(s.nama)}</strong></td>
      <td class="kod">${s.kod ? esc(s.kod) : '<span class="redup">—</span>'}</td>
      <td>${s.emel ? esc(s.emel) : '<span class="redup">Belum didaftarkan — tidak boleh log masuk</span>'}</td>
      <td><span class="lencana ${s.aktif ? 'lencana-aktif' : 'lencana-tidak-aktif'}">${s.aktif ? 'Aktif' : 'Tidak aktif'}</span></td>
      <td><div class="tindakan-sel">
        <button type="button" class="btn btn-garis btn-kecil" data-tindakan="edit" data-id="${esc(s.id)}">Kemaskini</button>
        <button type="button" class="btn btn-garis btn-kecil" data-tindakan="togol" data-id="${esc(s.id)}">${s.aktif ? 'Nyahaktif' : 'Aktifkan'}</button>
        <button type="button" class="btn btn-bahaya-garis btn-kecil" data-tindakan="padam" data-id="${esc(s.id)}">Padam</button>
      </div></td>
    </tr>`).join('');
}

function bukaBorangSekolah(s) {
  sekolahDiedit = s;
  paparMesej($('#mesejSekolah'), '');
  $('#tajukSekolah').textContent = s ? 'Kemaskini sekolah' : 'Tambah sekolah';
  $('#sNama').value = s?.nama || '';
  $('#sKod').value = s?.kod || '';
  $('#sEmel').value = s?.emel || '';
  $('#sAktif').checked = s ? s.aktif : true;
  $('#dialogSekolah').showModal();
  $('#sNama').focus();
}

async function simpanSekolah(e) {
  e.preventDefault();
  const n = {
    nama: $('#sNama').value.trim().replace(/\s+/g, ' '),
    kod: $('#sKod').value.trim().toUpperCase() || null,
    emel: normalEmel($('#sEmel').value) || null,
    aktif: $('#sAktif').checked,
  };
  const m = $('#mesejSekolah');
  if (n.nama.length < 2) return paparMesej(m, 'Sila isi nama sekolah.');
  if (n.kod && !/^[A-Z0-9]{3,12}$/.test(n.kod)) return paparMesej(m, 'Kod sekolah hanya boleh mengandungi huruf dan nombor (3–12 aksara).');
  if (n.emel && !EMEL_SAH.test(n.emel)) return paparMesej(m, 'Format emel tidak sah.');

  const btn = $('#btnSimpanSekolah');
  setSibuk(btn, true, 'Menyimpan…');
  try {
    const q = sekolahDiedit
      ? sb.from('sekolah').update(n).eq('id', sekolahDiedit.id).select('id')
      : sb.from('sekolah').insert(n).select('id');
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) throw Object.assign(new Error(''), { code: '42501' });
    $('#dialogSekolah').close();
    toast(sekolahDiedit ? 'Maklumat sekolah dikemas kini.' : 'Sekolah berjaya ditambah.', 'berjaya');
    await muatSekolah();
    paparSekolah();
  } catch (err) {
    paparMesej(m, mesejRalat(err));
  } finally {
    setSibuk(btn, false);
  }
}

async function klikJadualSekolah(e) {
  const b = e.target.closest('[data-tindakan]');
  if (!b) return;
  const s = keadaan.sekolah.find((x) => x.id === b.dataset.id);
  if (!s) return;
  if (b.dataset.tindakan === 'edit') {
    bukaBorangSekolah(s);
    return;
  }
  if (b.dataset.tindakan === 'togol') {
    if (s.aktif) {
      const ya = await sahkan({
        tajuk: 'Nyahaktifkan sekolah?',
        mesej: `${s.nama} tidak akan dapat log masuk atau melihat rekodnya sehingga diaktifkan semula. Rekod sedia ada dikekalkan.`,
        teksYa: 'Nyahaktifkan',
      });
      if (!ya) return;
    }
    setSibuk(b, true);
    const { data, error } = await sb.from('sekolah').update({ aktif: !s.aktif }).eq('id', s.id).select('id');
    setSibuk(b, false);
    if (error || !data?.length) {
      toast(mesejRalat(error || { code: '42501' }), 'ralat');
      return;
    }
    toast(s.aktif ? 'Sekolah dinyahaktifkan.' : 'Sekolah diaktifkan.', 'berjaya');
    await muatSekolah();
    paparSekolah();
    return;
  }
  if (b.dataset.tindakan === 'padam') {
    const ya = await sahkan({
      tajuk: 'Padam sekolah?',
      mesej: `${s.nama} akan dipadam. Sekolah yang mempunyai rekod lawatan tidak boleh dipadam — nyahaktifkan sahaja.`,
      teksYa: 'Padam',
    });
    if (!ya) return;
    const { data, error } = await sb.from('sekolah').delete().eq('id', s.id).select('id');
    if (error || !data?.length) {
      toast(mesejRalat(error || { code: '42501' }), 'ralat', 7000);
      return;
    }
    toast('Sekolah dipadam.', 'berjaya');
    await muatSekolah();
    paparSekolah();
  }
}

// =====================================================================
// Pengurusan pentadbir
// =====================================================================

let pentadbirDiedit = null;

async function muatPentadbir() {
  const tb = $('#jadualPentadbir');
  tb.innerHTML = '<tr><td colspan="5" class="redup">Memuatkan…</td></tr>';
  const { data, error } = await sb.from('pentadbir').select('emel,nama,aktif,dicipta_pada').order('nama');
  if (error) {
    tb.innerHTML = `<tr><td colspan="5">${esc(mesejRalat(error))}</td></tr>`;
    return;
  }
  keadaan.pentadbir = data;
  tb.innerHTML = data.map((p) => {
    const diri = p.emel === keadaan.profil.emel;
    return `
      <tr>
        <td><strong>${esc(p.nama)}</strong>${diri ? ' <span class="redup">(anda)</span>' : ''}</td>
        <td>${esc(p.emel)}</td>
        <td><span class="lencana ${p.aktif ? 'lencana-aktif' : 'lencana-tidak-aktif'}">${p.aktif ? 'Aktif' : 'Tidak aktif'}</span></td>
        <td>${esc(formatCapMasa(p.dicipta_pada))}</td>
        <td><div class="tindakan-sel">
          <button type="button" class="btn btn-garis btn-kecil" data-tindakan="edit" data-emel="${esc(p.emel)}">Kemaskini</button>
          <button type="button" class="btn btn-garis btn-kecil" data-tindakan="kata-laluan" data-emel="${esc(p.emel)}">Kata laluan</button>
          ${diri ? '' : `<button type="button" class="btn btn-garis btn-kecil" data-tindakan="togol" data-emel="${esc(p.emel)}">${p.aktif ? 'Nyahaktif' : 'Aktifkan'}</button>
          <button type="button" class="btn btn-bahaya-garis btn-kecil" data-tindakan="padam" data-emel="${esc(p.emel)}">Padam</button>`}
        </div></td>
      </tr>`;
  }).join('');
}

function bukaBorangPentadbir(p) {
  pentadbirDiedit = p;
  paparMesej($('#mesejPentadbir'), '');
  $('#tajukPentadbir').textContent = p ? 'Kemaskini pentadbir' : 'Tambah pentadbir';
  $('#pNama').value = p?.nama || '';
  $('#pEmel').value = p?.emel || '';
  $('#pEmel').readOnly = Boolean(p);
  $('#pAktif').checked = p ? p.aktif : true;
  $('#pAktif').disabled = Boolean(p && p.emel === keadaan.profil.emel);
  $('#dialogPentadbir').showModal();
  $('#pNama').focus();
}

async function simpanPentadbir(e) {
  e.preventDefault();
  const m = $('#mesejPentadbir');
  const nama = $('#pNama').value.trim().replace(/\s+/g, ' ');
  const emel = normalEmel($('#pEmel').value);
  const aktif = $('#pAktif').checked;
  if (nama.length < 2) return paparMesej(m, 'Sila isi nama penuh.');
  if (!EMEL_SAH.test(emel)) return paparMesej(m, 'Format emel tidak sah.');

  const btn = $('#btnSimpanPentadbir');
  setSibuk(btn, true, 'Menyimpan…');
  try {
    const q = pentadbirDiedit
      ? sb.from('pentadbir').update({ nama, aktif }).eq('emel', pentadbirDiedit.emel).select('emel')
      : sb.from('pentadbir').insert({ emel, nama, aktif }).select('emel');
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) throw Object.assign(new Error(''), { code: '42501' });
    $('#dialogPentadbir').close();
    toast(pentadbirDiedit
      ? 'Maklumat pentadbir dikemas kini.'
      : 'Pentadbir ditambah. Klik "Kata laluan" pada baris mereka untuk menetapkan kata laluan pertama, kemudian maklumkan kepada mereka secara peribadi.',
    'berjaya', pentadbirDiedit ? 4500 : 9000);
    await muatPentadbir();
  } catch (err) {
    paparMesej(m, mesejRalat(err));
  } finally {
    setSibuk(btn, false);
  }
}

async function klikJadualPentadbir(e) {
  const b = e.target.closest('[data-tindakan]');
  if (!b) return;
  const p = keadaan.pentadbir.find((x) => x.emel === b.dataset.emel);
  if (!p) return;
  if (b.dataset.tindakan === 'edit') {
    bukaBorangPentadbir(p);
    return;
  }
  if (b.dataset.tindakan === 'kata-laluan') {
    bukaBorangKataLaluan(p);
    return;
  }
  if (p.emel === keadaan.profil.emel) return;
  if (b.dataset.tindakan === 'togol') {
    const { data, error } = await sb.from('pentadbir').update({ aktif: !p.aktif }).eq('emel', p.emel).select('emel');
    if (error || !data?.length) {
      toast(mesejRalat(error || { code: '42501' }), 'ralat');
      return;
    }
    toast(p.aktif ? 'Pentadbir dinyahaktifkan.' : 'Pentadbir diaktifkan.', 'berjaya');
    await muatPentadbir();
    return;
  }
  if (b.dataset.tindakan === 'padam') {
    const ya = await sahkan({
      tajuk: 'Padam pentadbir?',
      mesej: `${p.nama} (${p.emel}) tidak lagi mempunyai akses pentadbir.`,
      teksYa: 'Padam',
    });
    if (!ya) return;
    const { data, error } = await sb.from('pentadbir').delete().eq('emel', p.emel).select('emel');
    if (error || !data?.length) {
      toast(mesejRalat(error || { code: '42501' }), 'ralat');
      return;
    }
    toast('Pentadbir dipadam.', 'berjaya');
    await muatPentadbir();
  }
}

// =====================================================================
// Kata laluan pentadbir (tiada emel dihantar; ditetapkan oleh pentadbir)
// =====================================================================

let sasaranKataLaluan = null;

function bukaBorangKataLaluan(p) {
  sasaranKataLaluan = p.emel;
  const diri = p.emel === keadaan.profil.emel;
  paparMesej($('#mesejKataLaluan'), '');
  $('#tajukKataLaluan').textContent = diri ? 'Tukar kata laluan saya' : 'Tetapkan kata laluan pentadbir';
  $('#sasaranKataLaluan').textContent = p.nama ? `${p.nama} (${p.emel})` : p.emel;
  $('#klNamaPengguna').value = p.emel;
  $('#klBaharu').value = '';
  $('#klSahkan').value = '';
  $('#dialogKataLaluan').showModal();
  $('#klBaharu').focus();
}

async function simpanKataLaluan(e) {
  e.preventDefault();
  const m = $('#mesejKataLaluan');
  const baharu = $('#klBaharu').value;
  const masalah = semakKekuatanKataLaluan(baharu);
  if (masalah) {
    paparMesej(m, masalah);
    $('#klBaharu').focus();
    return;
  }
  if (baharu !== $('#klSahkan').value) {
    paparMesej(m, 'Pengesahan kata laluan tidak sepadan.');
    $('#klSahkan').focus();
    return;
  }
  const btn = $('#btnSimpanKataLaluan');
  setSibuk(btn, true, 'Menyimpan…');
  try {
    await tetapKataLaluanPentadbir(sasaranKataLaluan, baharu);
    $('#dialogKataLaluan').close();
    toast(sasaranKataLaluan === keadaan.profil.emel
      ? 'Kata laluan anda telah ditukar.'
      : `Kata laluan untuk ${sasaranKataLaluan} telah ditetapkan. Maklumkan kepada pentadbir tersebut secara peribadi.`,
    'berjaya', 7000);
  } catch (err) {
    paparMesej(m, mesejRalat(err));
  } finally {
    setSibuk(btn, false);
  }
}

// =====================================================================
// Log audit
// =====================================================================

const LABEL_JADUAL = { rekod_lawatan: 'Rekod lawatan', sekolah: 'Sekolah', pentadbir: 'Pentadbir', lampiran: 'Gambar', auth: 'Akaun' };
const LABEL_TINDAKAN = {
  INSERT: 'Tambah', UPDATE: 'Kemaskini', DELETE: 'Padam', 'LOG MASUK': 'Log masuk sekolah', 'TETAP KATA LALUAN': 'Tetapkan kata laluan',
};
const LABEL_MEDAN = {
  sekolah_id: 'sekolah', tarikh: 'tarikh', masa: 'masa', nama_pegawai: 'nama pegawai', jawatan: 'jawatan',
  dapatan: 'dapatan', maklumbalas: 'maklumbalas', status: 'status', nama: 'nama', kod: 'kod', emel: 'emel', aktif: 'status aktif',
};
const MEDAN_ABAI = new Set(['dikemaskini_pada', 'maklumbalas_oleh', 'maklumbalas_pada']);

function ringkasanAudit(a) {
  const d = a.data_baru || a.data_lama || {};
  let asas = '';
  if (a.jadual === 'rekod_lawatan') asas = `${namaSekolah(d.sekolah_id) || 'Sekolah'} · ${formatTarikh(d.tarikh)} · ${d.status || ''}`;
  else if (a.jadual === 'sekolah') asas = d.nama || '';
  else if (a.jadual === 'pentadbir') asas = `${d.nama || ''} (${d.emel || ''})`;
  else if (a.jadual === 'lampiran') asas = `Gambar ${d.jenis || ''}`;
  else if (a.tindakan === 'LOG MASUK') asas = `${d.sekolah || ''}${d.ip ? ` · IP ${d.ip}` : ''}`;
  else if (a.tindakan === 'TETAP KATA LALUAN') asas = `untuk ${d.sasaran || ''}`;
  if (a.tindakan === 'UPDATE' && a.data_lama && a.data_baru) {
    const diubah = Object.keys(a.data_baru)
      .filter((k) => !MEDAN_ABAI.has(k) && JSON.stringify(a.data_baru[k]) !== JSON.stringify(a.data_lama[k]))
      .map((k) => {
        if (k === 'status' || k === 'aktif') return `${LABEL_MEDAN[k]}: ${a.data_lama[k]} → ${a.data_baru[k]}`;
        return LABEL_MEDAN[k] || k;
      });
    if (diubah.length) asas += ` — diubah: ${diubah.join(', ')}`;
  }
  return asas;
}

async function muatAudit(semula) {
  if (semula) keadaan.auditDari = 0;
  const tb = $('#jadualAudit');
  const btn = $('#btnAuditLagi');
  if (semula) tb.innerHTML = '<tr><td colspan="4" class="redup">Memuatkan…</td></tr>';
  setSibuk(btn, true);
  const { data, error } = await sb.from('log_audit')
    .select('id,pada,emel,jadual,tindakan,data_lama,data_baru')
    .order('id', { ascending: false })
    .range(keadaan.auditDari, keadaan.auditDari + SAIZ_AUDIT - 1);
  setSibuk(btn, false);
  if (error) {
    tb.innerHTML = `<tr><td colspan="4">${esc(mesejRalat(error))}</td></tr>`;
    return;
  }
  const html = data.map((a) => `
    <tr>
      <td>${esc(formatCapMasa(a.pada))}</td>
      <td>${a.emel ? esc(a.emel) : '<span class="redup">Sistem / SQL</span>'}</td>
      <td>${esc(LABEL_JADUAL[a.jadual] || a.jadual)} — ${esc(LABEL_TINDAKAN[a.tindakan] || a.tindakan)}</td>
      <td class="perubahan">${esc(ringkasanAudit(a))}</td>
    </tr>`).join('');
  if (semula) tb.innerHTML = html || '<tr><td colspan="4" class="redup">Tiada log.</td></tr>';
  else tb.insertAdjacentHTML('beforeend', html);
  keadaan.auditDari += data.length;
  btn.hidden = data.length < SAIZ_AUDIT;
  $('#infoAudit').textContent = `${keadaan.auditDari} entri dipaparkan`;
}

mula().catch((e) => {
  console.error(e);
  ralatPemuat(mesejRalat(e, 'Sistem gagal dimulakan. Muat semula halaman.'));
});
