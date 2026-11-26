// Tetingkap log masuk pada laman utama (Sekolah: emel sahaja; Admin PPD: emel + kata laluan).
import { sb, konfigSah, dapatkanProfil, logMasukSekolah } from './klien.js';
import { $, $$, EMEL_SAH, normalEmel, mesejRalat, setSibuk, paparMesej, alamatLaman, kemasAlamat } from './util.js';

const el = {
  dialog: $('#dialogLogMasuk'),
  mesej: $('#mesej'),
  tabSekolah: $('#tabSekolah'),
  tabAdmin: $('#tabAdmin'),
  panelSekolah: $('#panelSekolah'),
  panelAdmin: $('#panelAdmin'),
  borangSekolah: $('#borangSekolahLogMasuk'),
  emelSekolah: $('#emelSekolah'),
  btnLogMasukSekolah: $('#btnLogMasukSekolah'),
  borangAdmin: $('#borangAdmin'),
  emelAdmin: $('#emelAdmin'),
  kataLaluan: $('#kataLaluan'),
  btnLogMasukAdmin: $('#btnLogMasukAdmin'),
};

const TIDAK_BERDAFTAR = 'Emel ini tidak didaftarkan atau telah dinyahaktifkan. Hubungi pentadbir PPD.';

function mesej(teks, jenis = 'ralat') {
  paparMesej(el.mesej, teks, jenis);
}

function pilihTab(peranan) {
  const sekolah = peranan === 'sekolah';
  el.tabSekolah.setAttribute('aria-selected', String(sekolah));
  el.tabAdmin.setAttribute('aria-selected', String(!sekolah));
  el.panelSekolah.hidden = !sekolah;
  el.panelAdmin.hidden = sekolah;
  mesej('');
  (sekolah ? el.emelSekolah : el.emelAdmin).focus();
}

/** Buka tetingkap log masuk. */
export function bukaLogMasuk(peranan = 'sekolah', teks = '', jenis = 'info') {
  if (!el.dialog.open) el.dialog.showModal();
  pilihTab(peranan);
  if (teks) mesej(teks, jenis);
}

/** Ralat dengan mesej mesra pengguna (dipaparkan terus). */
function ralatMesra(teks) {
  return Object.assign(new Error(teks), { mesra: true });
}

/**
 * Tamatkan sesi sedia ada dalam pelayar ini sebelum log masuk baharu, supaya
 * log masuk sebagai sekolah tidak tersangkut pada sesi pentadbir terdahulu
 * (atau sebaliknya).
 */
async function tamatkanSesiLama() {
  const { data } = await sb.auth.getSession();
  if (data.session) await sb.auth.signOut({ scope: 'local' });
}

/** Sahkan peranan selepas log masuk; log keluar jika tidak dibenarkan. */
async function semakSelepasLogMasuk(peranDijangka) {
  let profil;
  try {
    profil = await dapatkanProfil();
  } catch (e) {
    await sb.auth.signOut({ scope: 'local' });
    throw e;
  }
  if (peranDijangka === 'admin' && profil?.peranan !== 'admin') {
    await sb.auth.signOut();
    throw ralatMesra('Akaun ini tidak mempunyai akses pentadbir.');
  }
  if (peranDijangka === 'sekolah' && profil?.peranan !== 'sekolah') {
    await sb.auth.signOut();
    throw ralatMesra(profil?.admin_perlu_kata_laluan
      ? 'Emel ini ialah akaun pentadbir. Sila log masuk melalui tab "Admin PPD" menggunakan kata laluan.'
      : TIDAK_BERDAFTAR);
  }
  // Kekal di laman yang sama; muat semula supaya laman dipaparkan mengikut peranan.
  window.location.replace(alamatLaman());
}

// ---------- Sekolah ----------

el.borangSekolah.addEventListener('submit', async (e) => {
  e.preventDefault();
  mesej('');
  const emel = normalEmel(el.emelSekolah.value);
  if (!EMEL_SAH.test(emel)) {
    mesej('Sila masukkan emel rasmi sekolah yang sah.');
    el.emelSekolah.focus();
    return;
  }
  setSibuk(el.btnLogMasukSekolah, true, 'Log masuk…');
  try {
    await tamatkanSesiLama();
    const hasil = await logMasukSekolah(emel);
    if (hasil !== 'ok') throw ralatMesra(TIDAK_BERDAFTAR);
    await semakSelepasLogMasuk('sekolah');
  } catch (err) {
    mesej(mesejRalat(err));
    setSibuk(el.btnLogMasukSekolah, false);
  }
});

// ---------- Pentadbir ----------

el.borangAdmin.addEventListener('submit', async (e) => {
  e.preventDefault();
  mesej('');
  const emel = normalEmel(el.emelAdmin.value);
  const kataLaluan = el.kataLaluan.value;
  if (!EMEL_SAH.test(emel)) {
    mesej('Sila masukkan emel rasmi yang sah.');
    el.emelAdmin.focus();
    return;
  }
  if (!kataLaluan) {
    mesej('Sila masukkan kata laluan.');
    el.kataLaluan.focus();
    return;
  }
  setSibuk(el.btnLogMasukAdmin, true, 'Log masuk…');
  try {
    await tamatkanSesiLama();
    const { error } = await sb.auth.signInWithPassword({ email: emel, password: kataLaluan });
    if (error) throw error;
    el.kataLaluan.value = '';
    await semakSelepasLogMasuk('admin');
  } catch (err) {
    mesej(mesejRalat(err));
    setSibuk(el.btnLogMasukAdmin, false);
  }
});

// ---------- Permulaan ----------

el.tabSekolah.addEventListener('click', () => pilihTab('sekolah'));
el.tabAdmin.addEventListener('click', () => pilihTab('admin'));
$$('[data-buka-log-masuk]').forEach((b) => b.addEventListener('click', () => bukaLogMasuk()));
$$('[data-tutup]', el.dialog).forEach((b) => b.addEventListener('click', () => el.dialog.close()));
el.dialog.addEventListener('close', () => {
  el.kataLaluan.value = '';
  mesej('');
});

function mula() {
  const param = new URLSearchParams(window.location.search);
  kemasAlamat();
  if (!konfigSah) {
    document.querySelectorAll('#dialogLogMasuk form button, #dialogLogMasuk form input').forEach((x) => { x.disabled = true; });
    return;
  }
  if (param.get('sebab') === 'tamat') bukaLogMasuk('sekolah', 'Sesi anda telah tamat. Sila log masuk semula.');
  else if (param.get('tab') === 'admin') bukaLogMasuk('admin');
  else if (param.has('log-masuk')) bukaLogMasuk();
}

mula();
