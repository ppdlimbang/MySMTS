import { sb, konfigSah, dapatkanProfil, sediakanAkaun } from './klien.js';
import { $, EMEL_SAH, normalEmel, mesejRalat, setSibuk, paparMesej, IKON_LOGO } from './util.js';

const TEMPOH_HANTAR_SEMULA = 60;

const el = {
  mesej: $('#mesej'),
  tabSekolah: $('#tabSekolah'),
  tabAdmin: $('#tabAdmin'),
  panelSekolah: $('#panelSekolah'),
  panelAdmin: $('#panelAdmin'),
  borangEmelSekolah: $('#borangEmelSekolah'),
  borangKodSekolah: $('#borangKodSekolah'),
  emelSekolah: $('#emelSekolah'),
  emelDihantar: $('#emelDihantar'),
  kodOtp: $('#kodOtp'),
  btnHantarKod: $('#btnHantarKod'),
  btnSahkanKod: $('#btnSahkanKod'),
  btnTukarEmel: $('#btnTukarEmel'),
  btnHantarSemula: $('#btnHantarSemula'),
  borangAdmin: $('#borangAdmin'),
  emelAdmin: $('#emelAdmin'),
  kataLaluan: $('#kataLaluan'),
  btnLogMasukAdmin: $('#btnLogMasukAdmin'),
  btnLupa: $('#btnLupa'),
  borangLupa: $('#borangLupa'),
  emelLupa: $('#emelLupa'),
  btnHantarPautan: $('#btnHantarPautan'),
  btnKembaliAdmin: $('#btnKembaliAdmin'),
};

let emelOtp = '';
let pemasaHantarSemula = null;

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
  (sekolah ? (el.borangKodSekolah.hidden ? el.emelSekolah : el.kodOtp) : el.emelAdmin).focus();
}

/** Ralat dengan mesej mesra pengguna (dipaparkan terus). */
function ralatMesra(teks) {
  return Object.assign(new Error(teks), { mesra: true });
}

function teksRalat(err) {
  return err?.mesra ? err.message : mesejRalat(err);
}

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
  if (peranDijangka === 'sekolah' && profil?.admin_perlu_kata_laluan) {
    await sb.auth.signOut();
    throw ralatMesra('Emel ini ialah akaun pentadbir. Sila log masuk melalui tab "Pentadbir PPD" menggunakan kata laluan.');
  }
  if (!profil?.peranan) {
    await sb.auth.signOut();
    throw ralatMesra('Emel ini tidak didaftarkan atau telah dinyahaktifkan. Hubungi pentadbir PPD.');
  }
  keAplikasi();
}

// ---------- Sekolah ----------

function mulaPemasaHantarSemula() {
  let baki = TEMPOH_HANTAR_SEMULA;
  clearInterval(pemasaHantarSemula);
  el.btnHantarSemula.disabled = true;
  el.btnHantarSemula.textContent = `Hantar semula kod (${baki}s)`;
  pemasaHantarSemula = setInterval(() => {
    baki -= 1;
    if (baki <= 0) {
      clearInterval(pemasaHantarSemula);
      el.btnHantarSemula.disabled = false;
      el.btnHantarSemula.textContent = 'Hantar semula kod';
    } else {
      el.btnHantarSemula.textContent = `Hantar semula kod (${baki}s)`;
    }
  }, 1000);
}

async function hantarKod(emel) {
  await sediakanAkaun(emel);
  const { error } = await sb.auth.signInWithOtp({
    email: emel,
    options: { shouldCreateUser: false },
  });
  if (error) throw error;
}

el.borangEmelSekolah.addEventListener('submit', async (e) => {
  e.preventDefault();
  mesej('');
  const emel = normalEmel(el.emelSekolah.value);
  if (!EMEL_SAH.test(emel)) {
    mesej('Sila masukkan emel rasmi sekolah yang sah.');
    el.emelSekolah.focus();
    return;
  }
  setSibuk(el.btnHantarKod, true, 'Menghantar…');
  try {
    await hantarKod(emel);
    emelOtp = emel;
    el.emelDihantar.textContent = emel;
    el.borangEmelSekolah.hidden = true;
    el.borangKodSekolah.hidden = false;
    el.kodOtp.value = '';
    el.kodOtp.focus();
    mulaPemasaHantarSemula();
  } catch (err) {
    mesej(mesejRalat(err));
  } finally {
    setSibuk(el.btnHantarKod, false);
  }
});

el.borangKodSekolah.addEventListener('submit', async (e) => {
  e.preventDefault();
  mesej('');
  const kod = el.kodOtp.value.replace(/\s+/g, '');
  if (!/^\d{6,10}$/.test(kod)) {
    mesej('Masukkan kod pengesahan yang diterima melalui emel.');
    el.kodOtp.focus();
    return;
  }
  setSibuk(el.btnSahkanKod, true, 'Mengesahkan…');
  try {
    const { error } = await sb.auth.verifyOtp({ email: emelOtp, token: kod, type: 'email' });
    if (error) throw error;
    await semakSelepasLogMasuk('sekolah');
  } catch (err) {
    mesej(teksRalat(err));
    setSibuk(el.btnSahkanKod, false);
  }
});

el.btnTukarEmel.addEventListener('click', () => {
  clearInterval(pemasaHantarSemula);
  el.borangKodSekolah.hidden = true;
  el.borangEmelSekolah.hidden = false;
  mesej('');
  el.emelSekolah.focus();
});

el.btnHantarSemula.addEventListener('click', async () => {
  mesej('');
  el.btnHantarSemula.disabled = true;
  try {
    await hantarKod(emelOtp);
    mesej('Kod baharu telah dihantar.', 'berjaya');
    mulaPemasaHantarSemula();
  } catch (err) {
    mesej(mesejRalat(err));
    el.btnHantarSemula.disabled = false;
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
    mesej(teksRalat(err));
    setSibuk(el.btnLogMasukAdmin, false);
  }
});

el.btnLupa.addEventListener('click', () => {
  el.borangAdmin.hidden = true;
  el.borangLupa.hidden = false;
  el.emelLupa.value = normalEmel(el.emelAdmin.value);
  mesej('');
  el.emelLupa.focus();
});

el.btnKembaliAdmin.addEventListener('click', () => {
  el.borangLupa.hidden = true;
  el.borangAdmin.hidden = false;
  mesej('');
  el.emelAdmin.focus();
});

el.borangLupa.addEventListener('submit', async (e) => {
  e.preventDefault();
  mesej('');
  const emel = normalEmel(el.emelLupa.value);
  if (!EMEL_SAH.test(emel)) {
    mesej('Sila masukkan emel rasmi yang sah.');
    el.emelLupa.focus();
    return;
  }
  setSibuk(el.btnHantarPautan, true, 'Menghantar…');
  try {
    await sediakanAkaun(emel);
    const redirectTo = new URL('kata-laluan.html', window.location.href).href;
    const { error } = await sb.auth.resetPasswordForEmail(emel, { redirectTo });
    if (error) throw error;
    mesej('Jika emel ini didaftarkan sebagai pentadbir, pautan untuk menetapkan kata laluan telah dihantar. Pautan sah untuk tempoh terhad.', 'berjaya');
  } catch (err) {
    mesej(mesejRalat(err));
  } finally {
    setSibuk(el.btnHantarPautan, false);
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
  if (param.get('sebab') === 'kata-laluan') mesej('Kata laluan berjaya ditetapkan. Sila log masuk.', 'berjaya');

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
