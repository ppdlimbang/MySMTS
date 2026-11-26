// Templat "Cetak Laporan" A4 bagi satu rekod lawatan.
// Reka bentuk: Borang Maklumbalas & Tindakan Sekolah (premium), mengikut warna sistem
// (biru tua + emas), logo MySMTS dan data sebenar rekod.
import { esc, formatTarikh, formatMasa, formatCapMasa, IKON_LOGO } from './util.js';
import { KONFIG } from './klien.js';

const svg = (isi) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${isi}</svg>`;
const IKON = {
  sekolah: svg('<path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/>'),
  tarikh: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  masa: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  pegawai: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
  jawatan: svg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>'),
  kamera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
};

const KELAS_STATUS = {
  'Menunggu Maklumbalas': 'menunggu',
  'Dalam Tindakan': 'tindakan',
  Selesai: 'selesai',
};

const dua = (n) => String(n).padStart(2, '0');

function medan(ikon, label, nilai, kelas = '') {
  return `<div class="cl-medan ${kelas}">
      <span class="cl-ikon">${ikon}</span>
      <div><span class="cl-label">${esc(label)}</span><span class="cl-nilai">${nilai}</span></div>
    </div>`;
}

/**
 * Isi bekas cetakan dengan laporan A4 bagi satu rekod.
 * @param {HTMLElement} bekas  Elemen #cetakan
 * @param {object} rekod       Rekod lawatan (dengan senarai lampiran)
 * @param {{ namaSekolah: string, kodSekolah?: string, urlGambar: (laluan: string) => string }} p
 */
export function isiCetakan(bekas, rekod, { namaSekolah, kodSekolah, urlGambar }) {
  const lampiran = rekod.lampiran || [];
  const galeri = (jenis, kapsyen) => {
    const senarai = lampiran.filter((l) => l.jenis === jenis && urlGambar(l.laluan));
    if (!senarai.length) {
      return `<p class="cl-tiada-gambar">${IKON.kamera}<span>Tiada lampiran gambar.</span></p>`;
    }
    return `<div class="cl-galeri">${senarai.map((l, i) => `
      <figure class="cl-foto">
        <div class="cl-bingkai"><img src="${esc(urlGambar(l.laluan))}" alt=""></div>
        <figcaption><strong>FOTO ${dua(i + 1)}</strong><span>${esc(kapsyen)}</span></figcaption>
      </figure>`).join('')}</div>`;
  };
  const teks = (nilai, ganti) => (nilai && String(nilai).trim()
    ? `<div class="cl-teks">${esc(nilai)}</div>`
    : `<div class="cl-teks cl-kosong">${esc(ganti)}</div>`);

  const status = String(rekod.status || '');
  const organisasi = KONFIG.namaOrganisasi;

  bekas.innerHTML = `
    <div class="cl-halaman">
      <header class="cl-kepala">
        <div class="cl-kepala-atas">
          <span class="cl-organisasi">${esc(organisasi.toUpperCase())} · SARAWAK, MALAYSIA</span>
          <span class="cl-pil">MySMTS</span>
        </div>
        <div class="cl-kepala-tajuk">
          <span class="cl-logo">${IKON_LOGO}</span>
          <h2>BORANG MAKLUMBALAS &amp; TINDAKAN SEKOLAH</h2>
        </div>
      </header>

      <div class="cl-maklumat">
        <div class="cl-baris cl-baris-3">
          ${medan(IKON.sekolah, 'Nama Sekolah', `${esc(namaSekolah || '-')}${kodSekolah ? ` <small>(${esc(kodSekolah)})</small>` : ''}`, 'emas')}
          ${medan(IKON.tarikh, 'Tarikh Lawatan', esc(formatTarikh(rekod.tarikh)))}
          ${medan(IKON.masa, 'Masa Lawatan', esc(formatMasa(rekod.masa) || '-'))}
        </div>
        <div class="cl-baris cl-baris-2">
          ${medan(IKON.pegawai, 'Nama Pegawai PPD', esc(rekod.nama_pegawai || '-'))}
          ${medan(IKON.jawatan, 'Jawatan Pegawai', esc(rekod.jawatan || '-'), 'emas')}
        </div>
      </div>

      <section class="cl-bahagian cl-a">
        <div class="cl-bahagian-kepala">
          <span class="cl-lencana">BAHAGIAN A</span>
          <h3>DAPATAN &amp; TEGURAN PEGAWAI PPD</h3>
          <span class="cl-nombor">01</span>
        </div>
        <div class="cl-bahagian-isi">
          ${teks(rekod.dapatan, '[Tiada dapatan direkodkan]')}
          <div class="cl-subtajuk"><span>Lampiran Gambar Dapatan</span></div>
          ${galeri('dapatan', 'Bukti Dapatan Lawatan')}
        </div>
      </section>

      <section class="cl-bahagian cl-b">
        <div class="cl-bahagian-kepala">
          <span class="cl-lencana">BAHAGIAN B</span>
          <h3>MAKLUMBALAS &amp; TINDAKAN PIHAK SEKOLAH</h3>
          <span class="cl-status ${KELAS_STATUS[status] || ''}">${esc(status.toUpperCase())}</span>
          <span class="cl-nombor">02</span>
        </div>
        <div class="cl-bahagian-isi">
          ${teks(rekod.maklumbalas, '[Belum ada maklumbalas daripada pihak sekolah]')}
          <div class="cl-subtajuk">
            <span>Lampiran Gambar Tindakan</span>
            <span class="cl-tarikh-tindakan">Tarikh Tindakan: <strong>${rekod.maklumbalas_pada ? esc(formatTarikh(rekod.maklumbalas_pada)) : '-'}</strong></span>
          </div>
          ${galeri('maklumbalas', 'Bukti Tindakan Sekolah')}
        </div>
      </section>

      <div class="cl-tandatangan">
        <div><span class="cl-label">Disediakan oleh (Pegawai PPD)</span><div class="cl-garis"><strong>${esc(String(rekod.nama_pegawai || '').toUpperCase())}</strong><span>${esc(rekod.jawatan || '')}</span></div></div>
        <div><span class="cl-label">Disahkan oleh (Pihak Sekolah)</span><div class="cl-garis"><strong>( Tandatangan &amp; Cop Rasmi )</strong><span>Pengetua / Guru Besar</span></div></div>
      </div>

      <footer class="cl-kaki">
        <span class="cl-kaki-jenama">MySMTS · ${esc(organisasi)}, Sarawak</span>
        <span class="cl-kaki-cetak">Dicetak pada ${esc(formatCapMasa(new Date().toISOString()))}</span>
      </footer>
    </div>`;
}

/** Tunggu semua gambar dalam bekas dimuatkan (maksimum 10 saat), kemudian cetak. */
export async function cetakBekas(bekas) {
  const imej = [...bekas.querySelectorAll('img')];
  await Promise.race([
    Promise.all(imej.map((img) => (img.complete ? null : new Promise((r) => { img.onload = r; img.onerror = r; })))),
    new Promise((r) => setTimeout(r, 10000)),
  ]);
  window.print();
}
