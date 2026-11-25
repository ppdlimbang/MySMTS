import { sb, konfigSah } from './klien.js';
import { $, mesejRalat, setSibuk, paparMesej, IKON_LOGO } from './util.js';

// Baca serpihan URL sebelum pustaka Supabase memprosesnya.
const serpihan = new URLSearchParams(window.location.hash.replace(/^#/, ''));
const daripadaPautan = ['recovery', 'invite', 'signup', 'magiclink'].includes(serpihan.get('type'));
const ralatPautan = serpihan.get('error_code') || serpihan.get('error');

const el = {
  mesej: $('#mesej'),
  subtajuk: $('#subtajuk'),
  borang: $('#borang'),
  kataLaluan: $('#kataLaluan'),
  sahkan: $('#sahkanKataLaluan'),
  btnSimpan: $('#btnSimpan'),
  pautan: $('#pautanLogMasuk'),
};

$('#logo').innerHTML = IKON_LOGO;

function gagal(teks) {
  el.subtajuk.textContent = 'Pautan tidak sah';
  paparMesej(el.mesej, teks, 'ralat');
  el.borang.hidden = true;
  el.pautan.hidden = false;
}

function semakKekuatan(k) {
  if (k.length < 12) return 'Kata laluan mesti sekurang-kurangnya 12 aksara.';
  if (!/[a-z]/.test(k) || !/[A-Z]/.test(k) || !/\d/.test(k)) {
    return 'Kata laluan mesti mengandungi huruf besar, huruf kecil dan nombor.';
  }
  return '';
}

el.borang.addEventListener('submit', async (e) => {
  e.preventDefault();
  paparMesej(el.mesej, '');
  const k = el.kataLaluan.value;
  const masalah = semakKekuatan(k);
  if (masalah) {
    paparMesej(el.mesej, masalah, 'ralat');
    el.kataLaluan.focus();
    return;
  }
  if (k !== el.sahkan.value) {
    paparMesej(el.mesej, 'Pengesahan kata laluan tidak sepadan.', 'ralat');
    el.sahkan.focus();
    return;
  }
  setSibuk(el.btnSimpan, true, 'Menyimpan…');
  try {
    const { error } = await sb.auth.updateUser({ password: k });
    if (error) throw error;
    el.kataLaluan.value = '';
    el.sahkan.value = '';
    // Log keluar supaya pentadbir log masuk semula menggunakan kata laluan
    // (akses pentadbir memerlukan sesi kata laluan).
    await sb.auth.signOut();
    window.location.replace('index.html?tab=admin&sebab=kata-laluan');
  } catch (err) {
    paparMesej(el.mesej, mesejRalat(err), 'ralat');
    setSibuk(el.btnSimpan, false);
  }
});

async function mula() {
  if (!konfigSah) {
    gagal('Sistem belum dikonfigurasi. Hubungi pentadbir sistem.');
    return;
  }
  if (ralatPautan) {
    gagal('Pautan telah tamat tempoh atau telah digunakan. Minta pautan baharu melalui "Tetapkan / lupa kata laluan?" di halaman log masuk.');
    return;
  }
  const { data, error } = await sb.auth.getSession();
  if (error || !data.session || !daripadaPautan) {
    gagal('Pautan tidak sah atau telah tamat tempoh. Minta pautan baharu melalui "Tetapkan / lupa kata laluan?" di halaman log masuk.');
    return;
  }
  el.subtajuk.textContent = data.session.user?.email || '';
  el.borang.hidden = false;
  el.kataLaluan.focus();
}

mula();
