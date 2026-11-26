// Templat cetakan A4 rekod lawatan (dikongsi oleh laman utama dan aplikasi).
import { esc, formatTarikh, formatMasa, formatCapMasa } from './util.js';
import { KONFIG } from './klien.js';

/**
 * Isi bekas cetakan dengan dokumen A4 bagi satu rekod.
 * @param {HTMLElement} bekas  Elemen #cetakan
 * @param {object} rekod       Rekod lawatan (dengan senarai lampiran)
 * @param {{ namaSekolah: string, kodSekolah?: string, urlGambar: (laluan: string) => string }} p
 */
export function isiCetakan(bekas, rekod, { namaSekolah, kodSekolah, urlGambar }) {
  const lampiran = rekod.lampiran || [];
  const galeri = (jenis, label) => {
    const senarai = lampiran.filter((l) => l.jenis === jenis && urlGambar(l.laluan));
    if (!senarai.length) return '';
    return `<div class="gambar"><p>${esc(label)}</p><div>${senarai.map((l) => `<img src="${esc(urlGambar(l.laluan))}" alt="">`).join('')}</div></div>`;
  };
  bekas.innerHTML = `
    <div class="cetak-kepala">
      <div class="organisasi">${esc(KONFIG.namaOrganisasi.toUpperCase())}</div>
      <div class="negeri">Sarawak, Malaysia</div>
      <h2>BORANG MAKLUMBALAS DAN TINDAKAN SEKOLAH</h2>
      <p>Rekod dapatan lawatan pegawai PPD dan maklumbalas pihak sekolah</p>
    </div>
    <table class="cetak-jadual">
      <tr><td class="l">NAMA SEKOLAH</td><td colspan="3"><strong>${esc(namaSekolah || '-')}</strong>${kodSekolah ? ` (${esc(kodSekolah)})` : ''}</td></tr>
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
      <div class="tajuk">BAHAGIAN B: MAKLUMBALAS &amp; TINDAKAN PIHAK SEKOLAH <span>${esc(String(rekod.status).toUpperCase())}</span></div>
      <div class="isi">${esc(rekod.maklumbalas || '(Belum ada maklumbalas daripada pihak sekolah)')}</div>
      ${galeri('maklumbalas', 'Lampiran gambar bukti pihak sekolah:')}
    </div>
    <div class="cetak-tandatangan">
      <div><strong>Disediakan oleh (Pegawai PPD):</strong><div class="ruang"></div><div class="garis"><strong>${esc(String(rekod.nama_pegawai).toUpperCase())}</strong><br>${esc(rekod.jawatan)}</div></div>
      <div><strong>Disahkan oleh (Pihak Sekolah):</strong><div class="ruang"></div><div class="garis"><strong>( Tandatangan &amp; Cop Rasmi )</strong><br>Pengetua / Guru Besar</div></div>
    </div>
    <div class="cetak-kaki">
      <span>Dicetak daripada MySMTS — ${esc(KONFIG.namaOrganisasi)}</span>
      <span>Tarikh cetakan: ${esc(formatCapMasa(new Date().toISOString()))}</span>
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
