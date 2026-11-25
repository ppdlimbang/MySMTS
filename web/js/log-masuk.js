import { sb, konfigSah, dapatkanProfil, logMasukSekolah } from './klien.js';
import { $, EMEL_SAH, normalEmel, mesejRalat, setSibuk, paparMesej, IKON_LOGO } from './util.js';

const el = {
  mesej: $('#mesej'),
  tabSekolah: $('#tabSekolah'),
  tabAdmin: $('#tabAdmin'),
  panelSekolah: $('#panelSekolah'),
  panelAdmin: $('#panelAdmin'),
  borangSekolah: $('#borangSekolah'),
  emelSekolah: $('#emelSekolah'),
  btnLogMasukSekolah: $('#btnLogMasukSekolah'),
  borangAdmin: $('#borangAdmin'),
  emelAdmin: $('#emelAdmin'),
  kataLaluan: $('#kataLaluan'),
  btnLogMasukAdmin: $('#btnLogMasukAdmin'),
};

$('#logo').innerHTML = IKON_LOGO;
$('#tahun').textContent = String(new Date().getFullYear());

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

/** Ralat dengan mesej mesra pengguna (dipaparkan terus). */
function ralatMesra(teks) {
  return Object.assign(new Error(teks), { mesra: true });
}

const TIDAK_BERDAFTAR = 'Emel ini tidak didaftarkan atau telah dinyahaktifkan. Hubungi pentadbir PPD.';

function keAplikasi() {
  window.location.replace('app.html');
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
      ? 'Emel ini ialah akaun pentadbir. Sila log masuk melalui tab "Pentadbir PPD" menggunakan kata laluan.'
      : TIDAK_BERDAFTAR);
  }
  keAplikasi();
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

async function mula() {
  if (!konfigSah) {
    $('#ralatKonfig').hidden = false;
    document.querySelectorAll('form button, form input').forEach((x) => { x.disabled = true; });
    return;
  }
  const param = new URLSearchParams(window.location.search);
  if (param.get('tab') === 'admin') pilihTab('admin');
  if (param.get('sebab') === 'tamat') mesej('Sesi anda telah tamat. Sila log masuk semula.', 'info');

  const { data } = await sb.auth.getSession();
  if (data.session) {
    try {
      const profil = await dapatkanProfil();
      if (profil?.peranan) {
        keAplikasi();
        return;
      }
      await sb.auth.signOut({ scope: 'local' });
    } catch {
      await sb.auth.signOut({ scope: 'local' });
    }
  }
}

mula();
