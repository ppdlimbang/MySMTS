// Laman utama awam: semua rekod lawatan boleh dilihat tanpa log masuk.
// Mengisi atau mengubah rekod memerlukan log masuk (dikuatkuasakan oleh RLS).
import { sb, konfigSah, dapatkanProfil, BALDI } from './klien.js';
import {
  $, $$, esc, formatTarikh, formatMasa, formatCapMasa, tarikhHariIni, kelasStatus,
  toast, mesejRalat, setSibuk, muatTurun, selCsv, bersihCarian, IKON_LOGO,
} from './util.js';
import { isiCetakan, cetakBekas } from './cetakan.js';

const SAIZ_HALAMAN = 20;
const TEMPOH_URL_SAAT = 3600;
const PILIH_REKOD = [
  'id', 'sekolah_id', 'tarikh', 'masa', 'nama_pegawai', 'jawatan', 'dapatan', 'maklumbalas', 'status',
  'dicipta_pada', 'maklumbalas_pada', 'lampiran(id,jenis,laluan,dicipta_pada)',
].join(',');

const keadaan = {
  profil: null,
  sekolah: new Map(), // id -> { id, nama, kod }
  penapis: { carian: '', status: 'SEMUA' },
  rekod: [],
  jumlah: 0,
  urlGambar: new Map(), // laluan -> { url, tamat }
};
let nomborMuat = 0;

// =====================================================================
// Kepala: jam, pengguna
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

const admin = () => keadaan.profil?.peranan === 'admin';
const sekolahSaya = () => (keadaan.profil?.peranan === 'sekolah' ? keadaan.profil.sekolah?.id : null);

function paparPengguna() {
  const p = keadaan.profil;
  const masuk = Boolean(p?.peranan);
  $('#btnBukaLogMasuk').hidden = masuk;
  $('#lencanaPengguna').hidden = !masuk;
  $('#btnRekodBaru').hidden = masuk && !admin();

  const kunci = $('#kunciBorang');
  kunci.classList.toggle('kunci-masuk', masuk);
  $('#btnKunciLogMasuk').hidden = masuk;
  $('#pautanBorang').hidden = !masuk;
  if (!masuk) {
    $('#kunciTajuk').textContent = 'Log masuk untuk mengisi borang';
    $('#kunciTeks').textContent = 'Semua rekod boleh dilihat oleh orang awam. Hanya pegawai PPD (Bahagian A) dan pihak sekolah (Bahagian B) yang log masuk boleh merekod atau mengisi maklumbalas.';
    return;
  }
  if (admin()) {
    $('#penggunaPeranan').textContent = 'Admin PPD';
    $('#penggunaNama').textContent = p.nama || p.emel;
    $('#kunciTajuk').textContent = 'Anda log masuk sebagai Admin PPD';
    $('#kunciTeks').textContent = 'Rekod lawatan baharu dan kemaskini dibuat dalam sistem.';
    $('#pautanBorang').textContent = 'Buka borang rekod baharu';
    $('#pautanBorang').href = 'app.html?baru=1';
  } else {
    $('#penggunaPeranan').textContent = 'Sekolah';
    $('#penggunaNama').textContent = p.sekolah?.nama || p.emel;
    $('#kunciTajuk').textContent = `Anda log masuk sebagai ${p.sekolah?.nama || 'sekolah'}`;
    $('#kunciTeks').textContent = 'Maklumbalas (Bahagian B) bagi rekod sekolah anda diisi dalam sistem.';
    $('#pautanBorang').textContent = 'Isi maklumbalas';
    $('#pautanBorang').href = 'app.html';
  }
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
// Data
// =====================================================================

async function muatSekolah() {
  const { data, error } = await sb.rpc('sekolah_awam');
  if (error) throw error;
  keadaan.sekolah = new Map((data || []).map((s) => [s.id, s]));
}

const namaSekolah = (id) => keadaan.sekolah.get(id)?.nama || '';
const kodSekolah = (id) => keadaan.sekolah.get(id)?.kod || '';

function terapPenapis(q, denganStatus) {
  const p = keadaan.penapis;
  if (denganStatus && p.status !== 'SEMUA') q = q.eq('status', p.status);
  const c = bersihCarian(p.carian);
  if (c) {
    const syarat = ['nama_pegawai', 'jawatan', 'dapatan', 'maklumbalas'].map((k) => `${k}.ilike.*${c}*`);
    const kecil = c.toLowerCase();
    const idSekolah = [...keadaan.sekolah.values()]
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
    const h = hasil[i];
    $(s).textContent = h.error ? '–' : String(h.count ?? 0);
  });
}

async function muatRekod({ tambah = false } = {}) {
  const nombor = ++nomborMuat;
  const senarai = $('#senaraiRekod');
  const btnLagi = $('#btnLagi');
  senarai.setAttribute('aria-busy', 'true');
  if (!tambah) {
    keadaan.rekod = [];
    senarai.innerHTML = '<div class="kad kosong"><p class="memuat">Memuatkan rekod</p></div>';
  }
  setSibuk(btnLagi, true);

  const dari = keadaan.rekod.length;
  const { data, error, count } = await terapPenapis(sb.from('rekod_lawatan').select(PILIH_REKOD, { count: 'exact' }), true)
    .order('tarikh', { ascending: false })
    .order('masa', { ascending: false, nullsFirst: false })
    .order('dicipta_pada', { ascending: false })
    .range(dari, dari + SAIZ_HALAMAN - 1);
  if (nombor !== nomborMuat) return;
  setSibuk(btnLagi, false);
  senarai.removeAttribute('aria-busy');

  if (error) {
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

// =====================================================================
// Paparan
// =====================================================================

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

function htmlTindakanMaklumbalas(r) {
  if (r.maklumbalas) return '';
  if (!keadaan.profil) return '<button type="button" class="btn-pautan" data-buka-log-masuk>Isi sekarang</button>';
  if (sekolahSaya() === r.sekolah_id) return '<a class="btn-pautan" href="app.html">Isi sekarang</a>';
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
      : 'Belum ada rekod lawatan.';
  }

  senarai.innerHTML = keadaan.rekod.map((r) => {
    const namaSek = namaSekolah(r.sekolah_id) || '—';
    const kod = kodSekolah(r.sekolah_id);
    const dapatan = r.lampiran.filter((l) => l.jenis === 'dapatan');
    const bukti = r.lampiran.filter((l) => l.jenis === 'maklumbalas');
    const masa = formatMasa(r.masa);
    const bolehUrus = admin() || sekolahSaya() === r.sekolah_id;
    return `
      <article class="kad rekod">
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
              : `<div class="teks-kosong"><span>Belum ada maklumbalas daripada sekolah.</span>${htmlTindakanMaklumbalas(r)}</div>`}
            ${htmlGaleri(bukti, 'Gambar bukti sekolah', namaSek)}
          </div>
        </div>
        <div class="rekod-kaki">
          <button type="button" class="btn btn-garis btn-kecil" data-tindakan="cetak" data-id="${esc(r.id)}">Cetak A4</button>
          ${bolehUrus ? `<a class="btn btn-utama btn-kecil" href="app.html">${admin() ? 'Kemaskini dalam sistem' : 'Isi maklumbalas'}</a>` : ''}
          <span class="cap-masa kanan">${r.maklumbalas_pada ? `Maklumbalas: ${esc(formatCapMasa(r.maklumbalas_pada))}` : `Direkod: ${esc(formatCapMasa(r.dicipta_pada))}`}</span>
        </div>
      </article>`;
  }).join('');

  $$('[data-buka-log-masuk]', senarai).forEach((b) => b.addEventListener('click', () => $('#btnBukaLogMasuk').click()));

  const lagi = keadaan.rekod.length < keadaan.jumlah;
  $('#btnLagi').hidden = !lagi;
  $('#infoRekod').textContent = keadaan.jumlah
    ? `Memaparkan ${keadaan.rekod.length} daripada ${keadaan.jumlah} rekod`
    : '';
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

async function cetakRekod(rekod, butang) {
  setSibuk(butang, true);
  try {
    await sediakanUrlGambar(rekod.lampiran.map((l) => l.laluan));
    const c = $('#cetakan');
    isiCetakan(c, rekod, {
      namaSekolah: namaSekolah(rekod.sekolah_id) || '-',
      kodSekolah: kodSekolah(rekod.sekolah_id),
      urlGambar,
    });
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
// Peristiwa & permulaan
// =====================================================================

function pasangPeristiwa() {
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

  $('#senaraiRekod').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tindakan]');
    if (!b) return;
    if (b.dataset.tindakan === 'gambar') bukaGambar(b.dataset.url, b.dataset.kapsyen);
    if (b.dataset.tindakan === 'cetak') {
      const rekod = keadaan.rekod.find((r) => r.id === b.dataset.id);
      if (rekod) cetakRekod(rekod, b);
    }
  });
  $$('#dialogGambar [data-tutup]').forEach((b) => b.addEventListener('click', () => $('#dialogGambar').close()));
  $('#dialogGambar').addEventListener('click', (e) => {
    if (e.target === $('#dialogGambar')) $('#dialogGambar').close();
  });

  $('#btnRekodBaru').addEventListener('click', () => {
    if (admin()) window.location.assign('app.html?baru=1');
    else $('#btnBukaLogMasuk').click();
  });
  $('#btnLogKeluar').addEventListener('click', async () => {
    setSibuk($('#btnLogKeluar'), true);
    await sb.auth.signOut();
    setSibuk($('#btnLogKeluar'), false);
    keadaan.profil = null;
    paparPengguna();
    paparRekod();
    toast('Anda telah log keluar.', 'info');
  });
}

async function mula() {
  $('#logo').innerHTML = IKON_LOGO;
  $('#tahun').textContent = String(new Date().getFullYear());
  mulaJam();
  if (!konfigSah) {
    $('#ralatKonfig').hidden = false;
    $('#senaraiRekod').innerHTML = '';
    return;
  }
  pasangPeristiwa();
  await muatPengguna();
  try {
    await muatSekolah();
  } catch (e) {
    console.warn('Senarai sekolah tidak dapat dimuatkan:', e);
  }
  await Promise.all([muatStatistik(), muatRekod()]);
}

mula().catch((e) => {
  console.error(e);
  toast(mesejRalat(e, 'Laman gagal dimuatkan. Muat semula halaman.'), 'ralat');
});
