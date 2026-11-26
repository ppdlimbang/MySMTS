// MySMTS — satu halaman untuk semua (reka bentuk asal).
//   * Orang awam: melihat semua rekod; borang dikunci.
//   * Sekolah: mengisi Bahagian B bagi rekod sekolahnya sendiri dalam borang kiri.
//   * Admin PPD: mencipta/mengemas kini/memadam rekod dalam borang kiri, serta
//     tab Sekolah dan Log Audit.
// Kebenaran sebenar dikuatkuasakan oleh RLS dalam pangkalan data.
import { sb, konfigSah, dapatkanProfil, tetapKataLaluanPentadbir, BALDI } from './klien.js';
import {
  $, $$, esc, formatTarikh, formatMasa, formatCapMasa, tarikhHariIni, masaSekarang, STATUS, kelasStatus,
  toast, mesejRalat, setSibuk, paparMesej, mampatGambar, muatTurun, selCsv, sahkan, bersihCarian,
  EMEL_SAH, normalEmel, IKON_LOGO, semakKekuatanKataLaluan,
} from './util.js';
import { isiCetakan, cetakBekas } from './cetakan.js';

const SAIZ_HALAMAN = 20;
const MAKS_GAMBAR = 10;
const TEMPOH_URL_SAAT = 3600;
const SAIZ_AUDIT = 50;
const PILIH_REKOD = [
  'id', 'sekolah_id', 'tarikh', 'masa', 'nama_pegawai', 'jawatan', 'dapatan', 'maklumbalas', 'status',
  'dicipta_pada', 'maklumbalas_pada', 'lampiran(id,jenis,laluan,dicipta_pada)',
].join(',');
const PILIH_REKOD_LOG_MASUK = PILIH_REKOD.replace('lampiran(id,jenis,laluan,dicipta_pada)', 'lampiran(id,jenis,laluan,dimuat_naik_oleh,dicipta_pada)');

const keadaan = {
  profil: null,
  sekolah: [], // admin: dengan emel & aktif; lain-lain: id, nama, kod sahaja
  penapis: { carian: '', status: 'SEMUA' },
  rekod: [],
  rekodSaya: [], // sekolah: rekod lawatan sekolah sendiri (untuk pilihan borang)
  jumlah: 0,
  urlGambar: new Map(), // laluan -> { url, tamat }
  auditDari: 0,
  paparan: 'rekod',
};
let nomborMuat = 0;
let logKeluarSendiri = false;
let borang = null; // keadaan borang kiri

const admin = () => keadaan.profil?.peranan === 'admin';
const sekolahSaya = () => (keadaan.profil?.peranan === 'sekolah' ? keadaan.profil.sekolah?.id || null : null);
const bolehUrus = (r) => admin() || (sekolahSaya() && sekolahSaya() === r.sekolah_id);
const muatSemulaHalaman = (cari = '') => window.location.replace(window.location.pathname + cari);

// =====================================================================
// Kepala: jam & pengguna
// =====================================================================

function mulaJam() {
  const kemas = () => {
    const kini = new Date();
    $('#jamMasa').textContent = kini.toLocaleTimeString('ms-MY');
    $('#jamTarikh').textContent = kini.toLocaleDateString('ms-MY', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    });
  };
  kemas();
  setInterval(kemas, 1000);
}

function paparPengguna() {
  const p = keadaan.profil;
  const masuk = Boolean(p?.peranan);
  $('#btnBukaLogMasuk').hidden = masuk;
  $('#lencanaPengguna').hidden = !masuk;
  $('#btnKataLaluanSaya').hidden = !admin();
  $('#btnRekodBaru').hidden = masuk && !admin();
  $('#navTab').hidden = !admin();
  if (!masuk) return;
  $('#penggunaPeranan').textContent = admin() ? 'Admin PPD' : 'Sekolah';
  $('#penggunaNama').textContent = admin() ? (p.nama || p.emel) : (p.sekolah?.nama || p.emel);
  $('#penggunaNama').title = p.emel || '';
}

async function muatPengguna() {
  keadaan.profil = null;
  const { data } = await sb.auth.getSession();
  if (data.session) {
    try {
      const profil = await dapatkanProfil();
      if (profil?.peranan) keadaan.profil = profil;
      else await sb.auth.signOut({ scope: 'local' });
    } catch {
      await sb.auth.signOut({ scope: 'local' });
    }
  }
  paparPengguna();
}

// =====================================================================
// Sekolah (rujukan)
// =====================================================================

async function muatSekolah() {
  if (admin()) {
    const { data, error } = await sb.from('sekolah').select('id,nama,kod,emel,aktif,dicipta_pada').order('nama');
    if (error) throw error;
    keadaan.sekolah = data;
  } else {
    const { data, error } = await sb.rpc('sekolah_awam');
    if (error) throw error;
    keadaan.sekolah = data || [];
  }
}

const cariSekolah = (id) => keadaan.sekolah.find((s) => s.id === id);
const namaSekolah = (id) => cariSekolah(id)?.nama || '';
const kodSekolah = (id) => cariSekolah(id)?.kod || '';

// =====================================================================
// Rekod lawatan
// =====================================================================

function terapPenapis(q, denganStatus) {
  const p = keadaan.penapis;
  if (denganStatus && p.status !== 'SEMUA') q = q.eq('status', p.status);
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
  const kira = (status) => {
    let q = sb.from('rekod_lawatan').select('id', { count: 'exact', head: true });
    if (status) q = q.eq('status', status);
    return q;
  };
  const hasil = await Promise.all([kira(null), kira('Menunggu Maklumbalas'), kira('Selesai')]);
  ['#statJumlah', '#statMenunggu', '#statSelesai'].forEach((s, i) => {
    $(s).textContent = hasil[i].error ? '–' : String(hasil[i].count ?? 0);
  });
}

async function muatRekod({ tambah = false } = {}) {
  const nombor = ++nomborMuat;
  const senarai = $('#senaraiRekod');
  const btnLagi = $('#btnLagi');
  senarai.setAttribute('aria-busy', 'true');
  if (!tambah && !keadaan.rekod.length) senarai.innerHTML = '<div class="kad kosong"><p class="memuat">Memuatkan rekod</p></div>';
  setSibuk(btnLagi, true);

  const dari = tambah ? keadaan.rekod.length : 0;
  const pilih = keadaan.profil ? PILIH_REKOD_LOG_MASUK : PILIH_REKOD;
  const { data, error, count } = await terapPenapis(sb.from('rekod_lawatan').select(pilih, { count: 'exact' }), true)
    .order('tarikh', { ascending: false })
    .order('masa', { ascending: false, nullsFirst: false })
    .order('dicipta_pada', { ascending: false })
    .range(dari, dari + SAIZ_HALAMAN - 1);
  if (nombor !== nomborMuat) return;
  setSibuk(btnLagi, false);
  senarai.removeAttribute('aria-busy');

  if (error) {
    keadaan.rekod = [];
    senarai.innerHTML = `<div class="kad kosong"><h3>Rekod tidak dapat dimuatkan</h3><p>${esc(mesejRalat(error))}</p></div>`;
    $('#rekodKosong').hidden = true;
    btnLagi.hidden = true;
    $('#infoRekod').textContent = '';
    return;
  }
  const baru = (data || []).map((r) => ({
    ...r,
    lampiran: [...(r.lampiran || [])].sort((a, b) => String(a.dicipta_pada).localeCompare(String(b.dicipta_pada))),
  }));
  await sediakanUrlGambar(baru.flatMap((r) => r.lampiran.map((l) => l.laluan)));
  if (nombor !== nomborMuat) return;
  keadaan.rekod = tambah ? [...keadaan.rekod, ...baru] : baru;
  keadaan.jumlah = count ?? keadaan.rekod.length;
  paparRekod();
}

async function muatSemula() {
  await Promise.all([muatStatistik(), muatRekod(), muatRekodSaya()]);
}

/** Sekolah: senarai rekod lawatan sekolah sendiri untuk dipilih dalam borang. */
async function muatRekodSaya() {
  const id = sekolahSaya();
  if (!id) return;
  const { data, error } = await sb.from('rekod_lawatan').select(PILIH_REKOD_LOG_MASUK)
    .eq('sekolah_id', id)
    .order('tarikh', { ascending: false })
    .range(0, 199);
  if (error) {
    console.warn('Rekod sekolah tidak dapat dimuatkan:', error);
    return;
  }
  // Rekod yang belum diberi maklumbalas dipaparkan dahulu.
  keadaan.rekodSaya = (data || []).sort((a, b) => Number(Boolean(a.maklumbalas)) - Number(Boolean(b.maklumbalas)));
  $('#pilihRekodSekolah').innerHTML = '<option value="">— Pilih rekod lawatan —</option>' + keadaan.rekodSaya.map((r) => `<option value="${esc(r.id)}">${esc(formatTarikh(r.tarikh))} · ${esc(r.nama_pegawai)} · ${esc(r.maklumbalas ? r.status : 'Menunggu maklumbalas')}</option>`).join('');
  if (!borang) paparPanelBorang();
}

async function sediakanUrlGambar(laluan) {
  const kini = Date.now();
  const perlu = [...new Set(laluan)].filter((l) => {
    const c = keadaan.urlGambar.get(l);
    return !c || c.tamat - kini < 5 * 60 * 1000;
  });
  for (let i = 0; i < perlu.length; i += 100) {
    const { data, error } = await sb.storage.from(BALDI).createSignedUrls(perlu.slice(i, i + 100), TEMPOH_URL_SAAT);
    if (error) {
      console.warn('URL gambar gagal dijana:', error);
      continue;
    }
    for (const d of data || []) {
      if (d.signedUrl && !d.error) keadaan.urlGambar.set(d.path, { url: d.signedUrl, tamat: kini + TEMPOH_URL_SAAT * 1000 });
    }
  }
}

const urlGambar = (laluan) => keadaan.urlGambar.get(laluan)?.url || '';

function htmlGaleri(lampiran, label, namaSek) {
  if (!lampiran.length) return '';
  return `<p class="galeri-label">${esc(label)} (${lampiran.length})</p><div class="galeri">${lampiran.map((l, i) => {
    const url = urlGambar(l.laluan);
    const kapsyen = `${label} #${i + 1} — ${namaSek}`;
    return url
      ? `<button type="button" class="gambar-kecil" data-tindakan="gambar" data-url="${esc(url)}" data-kapsyen="${esc(kapsyen)}"><img src="${esc(url)}" alt="${esc(kapsyen)}" loading="lazy"></button>`
      : '<span class="gambar-kecil" title="Gambar tidak dapat dimuatkan"></span>';
  }).join('')}</div>`;
}

function htmlIsiSekarang(r) {
  if (r.maklumbalas) return '';
  if (!keadaan.profil) return '<button type="button" class="btn-pautan" data-tindakan="log-masuk">Isi sekarang</button>';
  if (sekolahSaya() === r.sekolah_id) return `<button type="button" class="btn-pautan" data-tindakan="edit" data-id="${esc(r.id)}">Isi sekarang</button>`;
  return '';
}

function paparRekod() {
  const senarai = $('#senaraiRekod');
  const ada = keadaan.rekod.length > 0;
  $('#rekodKosong').hidden = ada;
  if (!ada) {
    const adaPenapis = keadaan.penapis.carian || keadaan.penapis.status !== 'SEMUA';
    $('#rekodKosongTeks').textContent = adaPenapis
      ? 'Tiada rekod lawatan yang sepadan dengan carian atau penapis semasa.'
      : (admin() ? 'Belum ada rekod lawatan. Isi borang di sebelah kiri untuk merekod lawatan pertama.' : 'Belum ada rekod lawatan.');
  }

  senarai.innerHTML = keadaan.rekod.map((r) => {
    const namaSek = namaSekolah(r.sekolah_id) || '—';
    const kod = kodSekolah(r.sekolah_id);
    const dapatan = r.lampiran.filter((l) => l.jenis === 'dapatan');
    const bukti = r.lampiran.filter((l) => l.jenis === 'maklumbalas');
    const masa = formatMasa(r.masa);
    const sedangDiedit = borang?.rekod?.id === r.id;
    let butangUrus = '';
    if (admin()) {
      butangUrus = `<button type="button" class="btn btn-utama btn-kecil" data-tindakan="edit" data-id="${esc(r.id)}">Kemaskini / Isi Sekolah</button>`;
    } else if (bolehUrus(r)) {
      butangUrus = `<button type="button" class="btn btn-emas btn-kecil" data-tindakan="edit" data-id="${esc(r.id)}">${r.maklumbalas ? 'Kemaskini maklumbalas' : 'Isi maklumbalas'}</button>`;
    }
    return `
      <article class="kad rekod${sedangDiedit ? ' sedang-diedit' : ''}" data-rekod="${esc(r.id)}">
        <div class="rekod-kepala">
          <div>
            <p class="rekod-meta">${esc(formatTarikh(r.tarikh))}${masa ? ` · ${esc(masa)}` : ''}${kod ? ` · ${esc(kod)}` : ''}</p>
            <h3>${esc(namaSek)}</h3>
          </div>
          <span class="lencana ${kelasStatus(r.status)}">${esc(r.status)}</span>
        </div>
        <div class="rekod-badan">
          <div class="pegawai">
            <div><small>Pegawai Lawatan PPD</small><strong>${esc(r.nama_pegawai)}</strong></div>
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
              : `<div class="teks-kosong"><span>Belum ada maklumbalas daripada sekolah.</span>${htmlIsiSekarang(r)}</div>`}
            ${htmlGaleri(bukti, 'Gambar bukti sekolah', namaSek)}
          </div>
        </div>
        <div class="rekod-kaki">
          ${butangUrus}
          <button type="button" class="btn btn-garis btn-kecil" data-tindakan="cetak" data-id="${esc(r.id)}">Cetak A4</button>
          <span class="cap-masa kanan">${r.maklumbalas_pada ? `Maklumbalas: ${esc(formatCapMasa(r.maklumbalas_pada))}` : `Direkod: ${esc(formatCapMasa(r.dicipta_pada))}`}</span>
          ${admin() ? `<button type="button" class="btn btn-bahaya-garis btn-kecil" data-tindakan="padam" data-id="${esc(r.id)}">Padam</button>` : ''}
        </div>
      </article>`;
  }).join('');

  $('#btnLagi').hidden = keadaan.rekod.length >= keadaan.jumlah;
  $('#infoRekod').textContent = keadaan.jumlah ? `Memaparkan ${keadaan.rekod.length} daripada ${keadaan.jumlah} rekod` : '';
}

function klikSenaraiRekod(e) {
  const b = e.target.closest('[data-tindakan]');
  if (!b) return;
  const t = b.dataset.tindakan;
  if (t === 'gambar') {
    bukaGambar(b.dataset.url, b.dataset.kapsyen);
    return;
  }
  if (t === 'log-masuk') {
    $('#btnBukaLogMasuk').click();
    return;
  }
  const rekod = keadaan.rekod.find((r) => r.id === b.dataset.id);
  if (!rekod) return;
  if (t === 'edit') editRekod(rekod);
  if (t === 'cetak') cetakRekod(rekod, b);
  if (t === 'padam') padamRekod(rekod);
}

function tetapStatus(status) {
  keadaan.penapis.status = status;
  $('#penapisStatus').value = status;
  $$('.stat').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.status === status)));
  muatRekod();
}

function bukaGambar(url, kapsyen) {
  if (!url) return;
  $('#gambarBesar').src = url;
  $('#gambarBesar').alt = kapsyen || 'Gambar lampiran';
  $('#kapsyenGambar').textContent = kapsyen || '';
  $('#dialogGambar').showModal();
}

// =====================================================================
// Borang kiri (cipta / kemaskini / maklumbalas sekolah)
// =====================================================================

/** Paparan panel borang mengikut peranan dan mod semasa. */
function paparPanelBorang() {
  const mod = borang?.mod || (keadaan.profil ? 'tunggu' : 'awam');
  const kunci = $('#kunciBorang');
  const tunjukKunci = mod === 'awam' || mod === 'tunggu';
  kunci.hidden = !tunjukKunci;
  kunci.classList.toggle('kunci-masuk', mod === 'tunggu');
  $('#btnKunciLogMasuk').hidden = mod !== 'awam';
  if (mod === 'awam') {
    $('#kunciTajuk').textContent = 'Log masuk untuk mengisi borang';
    $('#kunciTeks').textContent = 'Semua rekod boleh dilihat oleh orang awam. Hanya pegawai PPD (Bahagian A) dan pihak sekolah (Bahagian B) yang log masuk boleh merekod atau mengisi maklumbalas.';
  } else if (mod === 'tunggu') {
    const nama = keadaan.profil.sekolah?.nama || 'sekolah anda';
    const menunggu = keadaan.rekodSaya.filter((r) => !r.maklumbalas).length;
    $('#kunciTajuk').textContent = `Anda log masuk sebagai ${nama}`;
    $('#kunciTeks').textContent = keadaan.rekodSaya.length
      ? `${menunggu ? `${menunggu} rekod lawatan menunggu maklumbalas anda.` : 'Semua rekod lawatan telah diberi maklumbalas.'} Pilih rekod di bawah (atau klik "Isi maklumbalas" pada rekod dalam senarai) untuk mengisi Bahagian B.`
      : `Belum ada rekod lawatan untuk ${nama}. Borang maklumbalas (Bahagian B) akan dibuka selepas pegawai PPD merekod lawatan ke sekolah anda.`;
  }
  $('#pilihRekodBalut').hidden = !(mod === 'tunggu' && keadaan.rekodSaya.length);

  $('#borangSemua').disabled = tunjukKunci;
  // Bahagian A (dapatan pegawai) hanya untuk Admin PPD; sekolah & orang awam hanya melihat Bahagian B.
  $('#bahagianA').hidden = !admin();
  $('#bahagianA').disabled = !admin();
  const rujukan = $('#rujukanRekod');
  rujukan.hidden = mod !== 'sekolah';
  if (mod === 'sekolah') {
    const r = borang.rekod;
    rujukan.textContent = `Maklumbalas untuk lawatan ke ${namaSekolah(r.sekolah_id) || 'sekolah'} pada ${formatTarikh(r.tarikh)}${r.masa ? `, ${formatMasa(r.masa)}` : ''} (${r.nama_pegawai}).`;
  }
  $('[data-boleh-tambah="maklumbalas"]').hidden = tunjukKunci;
  $('#wajibMaklumbalas').hidden = mod !== 'sekolah';
  $('#fMaklumbalas').required = mod === 'sekolah';
  const opsMenunggu = $('#fStatus').querySelector('option[value="Menunggu Maklumbalas"]');
  opsMenunggu.hidden = mod === 'sekolah';
  opsMenunggu.disabled = mod === 'sekolah';

  $('#tajukBorang').textContent = {
    awam: 'Borang Maklumbalas Sekolah',
    tunggu: 'Maklumbalas Sekolah',
    'admin-baru': 'Borang Rekod Lawatan Baru',
    'admin-edit': 'Kemaskini / Isi Maklumbalas',
    sekolah: borang?.rekod?.maklumbalas ? 'Kemaskini Maklumbalas Sekolah' : 'Isi Maklumbalas Sekolah',
  }[mod];
  $('#kepalaBorang').classList.toggle('emas', mod === 'admin-edit' || mod === 'sekolah');
  $('#btnBatalEdit').hidden = !(mod === 'admin-edit' || mod === 'sekolah');
  $('#btnSimpanRekod').textContent = mod === 'sekolah' ? 'Hantar Maklumbalas' : (mod === 'admin-edit' ? 'Kemaskini Rekod' : 'Simpan Rekod');
  $$('#senaraiRekod .rekod').forEach((a) => a.classList.toggle('sedang-diedit', a.dataset.rekod === borang?.rekod?.id));
}

function isiPilihanSekolah(dipilih, mod) {
  const pilihan = keadaan.sekolah.filter((s) => s.aktif !== false || s.id === dipilih);
  $('#fSekolah').innerHTML = (mod === 'admin-baru' || mod === 'awam' || mod === 'tunggu' ? '<option value="">— Pilih sekolah —</option>' : '')
    + pilihan.map((s) => `<option value="${esc(s.id)}">${esc(s.nama)}${s.aktif === false ? ' (tidak aktif)' : ''}</option>`).join('');
  $('#fSekolah').value = dipilih || '';
}

/** Tetapkan borang kepada rekod (atau kosong). Tiada semakan perubahan. */
function tetapBorang(rekod) {
  if (borang) for (const j of ['dapatan', 'maklumbalas']) borang.baru[j].forEach((g) => URL.revokeObjectURL(g.url));

  let mod;
  if (admin()) mod = rekod ? 'admin-edit' : 'admin-baru';
  else if (rekod && bolehUrus(rekod)) mod = 'sekolah';
  else mod = null;

  const lampiran = rekod?.lampiran || [];
  borang = mod ? {
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
  } : null;

  paparMesej($('#mesejRekod'), '');
  isiPilihanSekolah(rekod?.sekolah_id || '', mod || (keadaan.profil ? 'tunggu' : 'awam'));
  $('#fTarikh').value = rekod?.tarikh || tarikhHariIni();
  $('#fMasa').value = rekod ? formatMasa(rekod.masa) : masaSekarang();
  $('#fPegawai').value = rekod?.nama_pegawai || '';
  $('#fJawatan').value = rekod?.jawatan || '';
  $('#fDapatan').value = rekod?.dapatan || '';
  $('#fMaklumbalas').value = rekod?.maklumbalas || '';
  let status = rekod?.status || 'Menunggu Maklumbalas';
  if (mod === 'sekolah' && status === 'Menunggu Maklumbalas') status = 'Dalam Tindakan';
  $('#fStatus').value = status;
  $('#btnSimpanRekod').disabled = false;

  paparPanelBorang();
  paparGaleriBorang('dapatan');
  paparGaleriBorang('maklumbalas');
}

async function bolehTinggalkanBorang() {
  if (!borang?.ubah) return true;
  if (borang.menyimpan) return false;
  return sahkan({
    tajuk: 'Buang perubahan?',
    mesej: 'Perubahan dalam borang yang belum disimpan akan hilang.',
    teksYa: 'Buang perubahan',
  });
}

async function editRekod(rekod) {
  if (!bolehUrus(rekod)) return;
  if (borang?.rekod?.id === rekod.id) {
    tatalKeBorang();
    return;
  }
  if (!(await bolehTinggalkanBorang())) return;
  tetapBorang(rekod);
  tatalKeBorang();
  (borang?.mod === 'sekolah' ? $('#fMaklumbalas') : $('#fDapatan')).focus({ preventScroll: true });
}

async function kosongkanBorang() {
  if (!(await bolehTinggalkanBorang())) return;
  tetapBorang(null);
}

function tatalKeBorang() {
  $('#panelBorang').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bolehBuangSedia(l) {
  if (admin()) return true;
  return l.jenis === 'maklumbalas' && l.dimuat_naik_oleh === keadaan.profil?.id;
}

function bilanganGambar(jenis) {
  return borang.sedia[jenis].filter((l) => !borang.buang.has(l.id)).length + borang.baru[jenis].length;
}

function paparGaleriBorang(jenis) {
  const galeri = jenis === 'dapatan' ? $('#galeriDapatan') : $('#galeriMaklumbalas');
  if (!borang) {
    galeri.innerHTML = '';
    return;
  }
  const label = jenis === 'dapatan' ? 'Gambar dapatan' : 'Gambar bukti sekolah';
  const boleh = jenis === 'maklumbalas' || borang.mod !== 'sekolah';
  const sedia = borang.sedia[jenis].filter((l) => !borang.buang.has(l.id));
  const html = [
    ...sedia.map((l, i) => {
      const url = urlGambar(l.laluan);
      const buang = boleh && bolehBuangSedia(l)
        ? `<button type="button" class="buang" data-buang-sedia="${esc(l.id)}" aria-label="Buang gambar">×</button>` : '';
      return `<div class="gambar-kecil">${url ? `<img src="${esc(url)}" alt="${esc(`${label} #${i + 1}`)}" data-url="${esc(url)}" data-kapsyen="${esc(`${label} #${i + 1}`)}">` : ''}${buang}</div>`;
    }),
    ...borang.baru[jenis].map((g) => `<div class="gambar-kecil baru" title="Gambar baharu (belum disimpan)"><img src="${esc(g.url)}" alt="Gambar baharu" data-url="${esc(g.url)}" data-kapsyen="Gambar baharu (belum disimpan)"><button type="button" class="buang" data-buang-baru="${esc(g.kunci)}" data-jenis="${jenis}" aria-label="Buang gambar">×</button></div>`),
  ];
  galeri.innerHTML = html.join('');
}

function klikGaleriBorang(e) {
  if (!borang) return;
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
  if (jenis === 'dapatan' && !admin()) return;

  const milik = borang;
  milik.memproses += 1;
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
        if (borang !== milik) return;
        milik.baru[jenis].push({ kunci: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) });
        milik.ubah = true;
      } catch (err) {
        console.warn(err);
        ditolak += 1;
      }
    }
  } finally {
    milik.memproses -= 1;
    if (borang === milik) {
      if (milik.memproses === 0 && !milik.menyimpan) $('#btnSimpanRekod').disabled = false;
      paparGaleriBorang(jenis);
    }
  }
  if (ditolak) toast(`${ditolak} fail tidak dapat diproses (bukan gambar atau format tidak disokong).`, 'amaran');
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
      const { error } = await sb.rpc('hantar_maklumbalas', { p_rekod_id: id, p_maklumbalas: n.maklumbalas, p_status: n.status });
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
  const mod = borang.mod;
  setSibuk(btn, false);
  borang.ubah = false;
  borang.menyimpan = false;
  tetapBorang(null);

  if (gagal) {
    toast(`Rekod disimpan, tetapi ${gagal} gambar gagal diproses. Kemaskini rekod sekali lagi untuk mencuba semula.`, 'amaran', 8000);
  } else {
    toast({ sekolah: 'Maklumbalas berjaya dihantar.', 'admin-baru': 'Rekod lawatan baharu berjaya disimpan.' }[mod] || 'Rekod berjaya dikemas kini.', 'berjaya');
  }
  await muatSemula();
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
    if (jenis === 'dapatan' && !admin()) continue;
    for (const g of borang.baru[jenis]) {
      const laluan = `${rekodId}/${jenis}/${crypto.randomUUID()}.jpg`;
      const { error: eu } = await sb.storage.from(BALDI).upload(laluan, g.blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false });
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
  if (!admin()) return;
  const ya = await sahkan({
    tajuk: 'Padam rekod lawatan?',
    mesej: `Rekod lawatan ke ${namaSekolah(rekod.sekolah_id) || 'sekolah'} pada ${formatTarikh(rekod.tarikh)} serta semua gambarnya akan dipadam secara kekal. Tindakan ini direkodkan dalam log audit.`,
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
  if (borang?.rekod?.id === rekod.id) tetapBorang(null);
  toast('Rekod berjaya dipadam.', 'berjaya');
  await muatSemula();
}

// =====================================================================
// Cetakan A4 & eksport CSV
// =====================================================================

async function cetakRekod(rekod, butang) {
  setSibuk(butang, true);
  try {
    await sediakanUrlGambar(rekod.lampiran.map((l) => l.laluan));
    const c = $('#cetakan');
    isiCetakan(c, rekod, { namaSekolah: namaSekolah(rekod.sekolah_id) || '-', kodSekolah: kodSekolah(rekod.sekolah_id), urlGambar });
    await cetakBekas(c);
  } catch (err) {
    toast(mesejRalat(err, 'Dokumen tidak dapat disediakan untuk cetakan.'), 'ralat');
  } finally {
    setSibuk(butang, false);
  }
}

async function eksportCsv() {
  const btn = $('#btnEksport');
  setSibuk(btn, true, 'Mengeksport…');
  try {
    const semua = [];
    const SAIZ = 1000;
    for (let dari = 0; dari < 100000; dari += SAIZ) {
      const { data, error } = await terapPenapis(sb.from('rekod_lawatan').select(
        'id,sekolah_id,tarikh,masa,nama_pegawai,jawatan,dapatan,maklumbalas,status,dicipta_pada,maklumbalas_pada,lampiran(jenis)',
      ), true)
        .order('tarikh', { ascending: false })
        .order('id', { ascending: true })
        .range(dari, dari + SAIZ - 1);
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
      namaSekolah(r.sekolah_id), kodSekolah(r.sekolah_id), r.tarikh, formatMasa(r.masa), r.nama_pegawai, r.jawatan, r.dapatan,
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
// Tab admin: Sekolah & Log Audit
// =====================================================================

async function tukarPaparan(nama) {
  if (!admin() && nama !== 'rekod') return;
  if (nama !== 'rekod' && !(await bolehTinggalkanBorang())) return;
  if (nama !== 'rekod' && borang?.ubah) tetapBorang(null);
  keadaan.paparan = nama;
  $$('#navTab [data-paparan]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.paparan === nama)));
  $$('[data-paparan-panel]').forEach((p) => { p.hidden = p.dataset.paparanPanel !== nama; });
  if (nama === 'sekolah') {
    paparSekolah();
    muatSekolah().then(paparSekolah).catch((e) => toast(mesejRalat(e), 'ralat'));
  }
  if (nama === 'audit') muatAudit(true);
  if (nama === 'rekod') {
    await muatSekolah().catch(() => {});
    if (!borang?.ubah) tetapBorang(borang?.rekod || null);
    muatSemula();
  }
}

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
        mesej: `${s.nama} tidak akan dapat log masuk sehingga diaktifkan semula. Rekod sedia ada dikekalkan.`,
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

// ---------- Kata laluan admin (tiada emel dihantar) ----------

function bukaBorangKataLaluan() {
  const p = keadaan.profil;
  paparMesej($('#mesejKataLaluan'), '');
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
    await tetapKataLaluanPentadbir(keadaan.profil.emel, baharu);
    $('#klBaharu').value = '';
    $('#klSahkan').value = '';
    $('#dialogKataLaluan').close();
    toast('Kata laluan anda telah ditukar.', 'berjaya', 7000);
  } catch (err) {
    paparMesej(m, mesejRalat(err));
  } finally {
    setSibuk(btn, false);
  }
}

// ---------- Log audit ----------

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
      .map((k) => ((k === 'status' || k === 'aktif') ? `${LABEL_MEDAN[k]}: ${a.data_lama[k]} → ${a.data_baru[k]}` : (LABEL_MEDAN[k] || k)));
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

// =====================================================================
// Peristiwa & permulaan
// =====================================================================

function pasangPeristiwa() {
  // Senarai & penapis
  let pemasa = null;
  $('#carian').addEventListener('input', () => {
    clearTimeout(pemasa);
    pemasa = setTimeout(() => {
      keadaan.penapis.carian = $('#carian').value;
      muatRekod();
    }, 350);
  });
  $('#penapisStatus').addEventListener('change', () => tetapStatus($('#penapisStatus').value));
  $$('.stat').forEach((b) => b.addEventListener('click', () => tetapStatus(b.dataset.status)));
  $('#btnLagi').addEventListener('click', () => muatRekod({ tambah: true }));
  $('#btnEksport').addEventListener('click', eksportCsv);
  $('#senaraiRekod').addEventListener('click', klikSenaraiRekod);

  // Borang kiri
  $('#borangRekod').addEventListener('submit', simpanRekod);
  $('#borangRekod').addEventListener('input', () => { if (borang) borang.ubah = true; });
  $('#failDapatan').addEventListener('change', (e) => tambahGambar(e.target, 'dapatan'));
  $('#failMaklumbalas').addEventListener('change', (e) => tambahGambar(e.target, 'maklumbalas'));
  $('#galeriDapatan').addEventListener('click', klikGaleriBorang);
  $('#galeriMaklumbalas').addEventListener('click', klikGaleriBorang);
  $('#btnKosongkan').addEventListener('click', kosongkanBorang);
  $('#btnBatalEdit').addEventListener('click', kosongkanBorang);
  $('#pilihRekodSekolah').addEventListener('change', async () => {
    const rekod = keadaan.rekodSaya.find((r) => r.id === $('#pilihRekodSekolah').value);
    $('#pilihRekodSekolah').value = '';
    if (!rekod) return;
    await sediakanUrlGambar((rekod.lampiran || []).map((l) => l.laluan));
    editRekod(rekod);
  });

  // Kepala
  $('#btnRekodBaru').addEventListener('click', async () => {
    if (!admin()) {
      $('#btnBukaLogMasuk').click();
      return;
    }
    if (keadaan.paparan !== 'rekod') await tukarPaparan('rekod');
    if (borang?.mod !== 'admin-baru') {
      if (!(await bolehTinggalkanBorang())) return;
      tetapBorang(null);
    }
    tatalKeBorang();
    $('#fSekolah').focus({ preventScroll: true });
  });
  $('#btnLogKeluar').addEventListener('click', async () => {
    if (!(await bolehTinggalkanBorang())) return;
    logKeluarSendiri = true;
    setSibuk($('#btnLogKeluar'), true);
    await sb.auth.signOut();
    muatSemulaHalaman();
  });
  $('#btnKataLaluanSaya').addEventListener('click', bukaBorangKataLaluan);
  $('#borangKataLaluan').addEventListener('submit', simpanKataLaluan);
  $('#dialogKataLaluan').addEventListener('close', () => {
    $('#klBaharu').value = '';
    $('#klSahkan').value = '';
  });

  // Tab admin
  $$('#navTab [data-paparan]').forEach((b) => b.addEventListener('click', () => tukarPaparan(b.dataset.paparan)));
  $('#btnSekolahBaru').addEventListener('click', () => bukaBorangSekolah(null));
  $('#jadualSekolah').addEventListener('click', klikJadualSekolah);
  $('#borangSekolah').addEventListener('submit', simpanSekolah);
  $('#btnMuatSemulaAudit').addEventListener('click', () => muatAudit(true));
  $('#btnAuditLagi').addEventListener('click', () => muatAudit(false));

  // Dialog (kecuali log masuk, diurus oleh log-masuk.js)
  for (const id of ['#dialogSekolah', '#dialogKataLaluan', '#dialogGambar']) {
    $$('[data-tutup]', $(id)).forEach((b) => b.addEventListener('click', () => $(id).close()));
  }
  $('#dialogGambar').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.close();
  });
}

async function mula() {
  $('#logo').innerHTML = IKON_LOGO;
  $('#tahun').textContent = String(new Date().getFullYear());
  mulaJam();
  if (!konfigSah) {
    $('#ralatKonfig').hidden = false;
    $('#senaraiRekod').innerHTML = '';
    paparPanelBorang();
    return;
  }
  pasangPeristiwa();
  await muatPengguna();
  if (keadaan.profil) {
    sb.auth.onAuthStateChange((peristiwa) => {
      if (peristiwa === 'SIGNED_OUT' && !logKeluarSendiri) muatSemulaHalaman('?sebab=tamat');
    });
  }
  try {
    await muatSekolah();
  } catch (e) {
    console.warn('Senarai sekolah tidak dapat dimuatkan:', e);
  }
  tetapBorang(null);
  await muatSemula();
}

mula().catch((e) => {
  console.error(e);
  toast(mesejRalat(e, 'Laman gagal dimuatkan. Muat semula halaman.'), 'ralat');
});
