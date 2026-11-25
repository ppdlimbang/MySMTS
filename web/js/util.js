// Fungsi utiliti dikongsi.

// Halang halaman dimuatkan dalam bingkai pihak lain (clickjacking).
if (window.top !== window.self) {
  document.documentElement.hidden = true;
  try { window.top.location.replace(window.self.location.href); } catch { /* diabaikan */ }
}

export const $ = (sel, akar = document) => akar.querySelector(sel);
export const $$ = (sel, akar = document) => Array.from(akar.querySelectorAll(sel));

const PETA_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export function esc(nilai) {
  return String(nilai ?? '').replace(/[&<>"'`]/g, (c) => PETA_ESC[c]);
}

export const EMEL_SAH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normalEmel(e) {
  return String(e ?? '').trim().toLowerCase();
}

const BULAN = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];

/** '2026-11-20' -> '20 November 2026' */
export function formatTarikh(iso) {
  if (!iso) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  return `${Number(m[3])} ${BULAN[Number(m[2]) - 1] ?? ''} ${m[1]}`;
}

/** '09:30:00' -> '09:30' */
export function formatMasa(masa) {
  return masa ? String(masa).slice(0, 5) : '';
}

/** Cap masa ISO -> '20 November 2026, 09:30' (waktu tempatan). */
export function formatCapMasa(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const jam = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}, ${jam}:${min}`;
}

export function tarikhHariIni() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function masaSekarang() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const STATUS = ['Menunggu Maklumbalas', 'Dalam Tindakan', 'Selesai'];
export function kelasStatus(status) {
  if (status === 'Selesai') return 'lencana-selesai';
  if (status === 'Dalam Tindakan') return 'lencana-tindakan';
  return 'lencana-menunggu';
}

// ---------- Toast ----------

export function toast(mesej, jenis = 'info', tempoh = 4500) {
  let bekas = $('#toast');
  if (!bekas) {
    bekas = document.createElement('div');
    bekas.id = 'toast';
    bekas.className = 'toast-bekas';
    bekas.setAttribute('role', 'status');
    bekas.setAttribute('aria-live', 'polite');
    document.body.append(bekas);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${jenis}`;
  el.textContent = mesej;
  bekas.append(el);
  setTimeout(() => el.remove(), tempoh);
}

// ---------- Mesej ralat ----------

/** Tukar ralat Supabase/rangkaian kepada mesej Bahasa Melayu yang jelas. */
export function mesejRalat(ralat, lalai = 'Ralat tidak dijangka berlaku. Sila cuba lagi.') {
  if (!ralat) return lalai;
  const kod = ralat.code || ralat.error_code || '';
  const mesej = String(ralat.message || ralat.error_description || ralat || '');
  const status = ralat.status;

  if (/Failed to fetch|NetworkError|Load failed|network/i.test(mesej) && !kod) {
    return 'Tiada sambungan ke pelayan. Semak sambungan internet anda dan cuba lagi.';
  }
  switch (kod) {
    case 'invalid_credentials': return 'Emel atau kata laluan tidak sah.';
    case 'email_not_confirmed': return 'Emel belum disahkan. Sila semak peti masuk emel anda.';
    case 'otp_expired': return 'Kod tidak sah atau telah tamat tempoh. Minta kod baharu.';
    case 'otp_disabled':
    case 'signup_disabled':
    case 'user_not_found': return 'Emel ini tidak didaftarkan dalam sistem. Hubungi pentadbir PPD.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
    case 'over_sms_send_rate_limit': return 'Terlalu banyak cubaan. Sila tunggu sebentar sebelum mencuba lagi.';
    case 'weak_password': return 'Kata laluan terlalu lemah. Gunakan sekurang-kurangnya 12 aksara dengan gabungan huruf, nombor dan simbol.';
    case 'same_password': return 'Kata laluan baharu mesti berbeza daripada kata laluan lama.';
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'bad_jwt': return 'Sesi anda telah tamat. Sila log masuk semula.';
    case '42501': return 'Akses ditolak. Anda tidak mempunyai kebenaran untuk tindakan ini.';
    case '23505': return 'Maklumat ini telah wujud (nama, kod atau emel pendua).';
    case '23503': return 'Tidak boleh dipadam kerana masih digunakan oleh rekod lain. Nyahaktifkan sahaja.';
    case '23514': return 'Data tidak sah. Semak format setiap medan.';
    case '22P02':
    case '22007':
    case '22008': return 'Format data tidak sah.';
    case 'PGRST116': return 'Rekod tidak dijumpai atau anda tiada akses.';
    case 'P0001': return mesej;
    default: break;
  }
  if (status === 429) return 'Terlalu banyak cubaan. Sila tunggu sebentar sebelum mencuba lagi.';
  if (/Signups not allowed/i.test(mesej)) return 'Emel ini tidak didaftarkan dalam sistem. Hubungi pentadbir PPD.';
  if (/row-level security/i.test(mesej)) return 'Akses ditolak. Anda tidak mempunyai kebenaran untuk tindakan ini.';
  if (/JWT expired|invalid JWT/i.test(mesej)) return 'Sesi anda telah tamat. Sila log masuk semula.';
  if (/Payload too large|exceeded the maximum allowed size/i.test(mesej)) return 'Saiz fail terlalu besar.';
  if (/mime type|invalid_mime_type/i.test(mesej)) return 'Jenis fail tidak dibenarkan. Gunakan gambar JPEG, PNG atau WebP.';
  console.error(ralat);
  return lalai;
}

// ---------- Keadaan butang ----------

export function setSibuk(butang, sibuk, teksSibuk) {
  if (!butang) return;
  if (sibuk) {
    butang.dataset.teksAsal = butang.textContent;
    butang.disabled = true;
    butang.classList.add('memuat');
    if (teksSibuk) butang.textContent = teksSibuk;
  } else {
    butang.disabled = false;
    butang.classList.remove('memuat');
    if (butang.dataset.teksAsal) butang.textContent = butang.dataset.teksAsal;
    delete butang.dataset.teksAsal;
  }
}

export function paparMesej(el, teks, jenis = 'ralat') {
  if (!el) return;
  if (!teks) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.className = `mesej mesej-${jenis}`;
  el.textContent = teks;
  el.hidden = false;
}

// ---------- Gambar ----------

const JENIS_GAMBAR = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/heic', 'image/heif'];

/**
 * Mampatkan gambar kepada JPEG (sisi terpanjang <= maks px).
 * Mengembalikan Blob JPEG. Fail bukan gambar ditolak.
 */
export async function mampatGambar(fail, maks = 1600, kualiti = 0.82) {
  if (!fail || (fail.type && !fail.type.startsWith('image/'))) {
    throw new Error('Fail bukan gambar.');
  }
  if (fail.type && !JENIS_GAMBAR.includes(fail.type)) {
    throw new Error('Format gambar tidak disokong.');
  }
  if (fail.size > 25 * 1024 * 1024) throw new Error('Gambar melebihi 25MB.');

  let sumber;
  try {
    sumber = await createImageBitmap(fail, { imageOrientation: 'from-image' });
  } catch {
    sumber = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(fail);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gambar tidak dapat dibaca.')); };
      img.src = url;
    });
  }
  const lebar = sumber.width;
  const tinggi = sumber.height;
  const nisbah = Math.min(1, maks / Math.max(lebar, tinggi));
  const kanvas = document.createElement('canvas');
  kanvas.width = Math.max(1, Math.round(lebar * nisbah));
  kanvas.height = Math.max(1, Math.round(tinggi * nisbah));
  const ctx = kanvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, kanvas.width, kanvas.height);
  ctx.drawImage(sumber, 0, 0, kanvas.width, kanvas.height);
  if (typeof sumber.close === 'function') sumber.close();
  const blob = await new Promise((resolve) => kanvas.toBlob(resolve, 'image/jpeg', kualiti));
  if (!blob) throw new Error('Gambar gagal dimampatkan.');
  return blob;
}

// ---------- Fail ----------

export function muatTurun(kandungan, namaFail, jenis) {
  const blob = kandungan instanceof Blob ? kandungan : new Blob([kandungan], { type: jenis });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = namaFail;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Sel CSV selamat: petik, gandakan petikan, halang suntikan formula Excel. */
export function selCsv(nilai) {
  let s = String(nilai ?? '').replace(/\r\n|\r|\n/g, ' ');
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// ---------- Dialog pengesahan ----------

/** Papar dialog pengesahan; selesai dengan true/false. */
export function sahkan({ tajuk = 'Sahkan tindakan', mesej = '', teksYa = 'Ya', bahaya = true } = {}) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'kecil';
    d.innerHTML = `
      <div class="dialog-isi">
        <div class="ikon-amaran" aria-hidden="true">!</div>
        <h2 class="teks-tengah"></h2>
        <p class="teks-tengah"></p>
      </div>
      <div class="dialog-kaki">
        <button type="button" class="btn btn-garis" data-jawapan="tidak">Batal</button>
        <button type="button" class="btn ${bahaya ? 'btn-bahaya' : 'btn-utama'}" data-jawapan="ya"></button>
      </div>`;
    d.querySelector('h2').textContent = tajuk;
    d.querySelector('p').textContent = mesej;
    d.querySelector('[data-jawapan="ya"]').textContent = teksYa;
    let jawapan = false;
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-jawapan]');
      if (!b) return;
      jawapan = b.dataset.jawapan === 'ya';
      d.close();
    });
    d.addEventListener('close', () => {
      d.remove();
      resolve(jawapan);
    });
    document.body.append(d);
    d.showModal();
    d.querySelector('[data-jawapan="tidak"]').focus();
  });
}

/** Bersihkan teks carian supaya selamat dalam penapis PostgREST or(). */
export function bersihCarian(teks) {
  return String(teks ?? '')
    .replace(/[,()*%\\:"'.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export const IKON_LOGO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/><path d="M12 5V2.5l3 1.2-3 1.3"/></svg>`;
