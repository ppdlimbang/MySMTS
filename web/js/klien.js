// Sambungan Supabase. Hanya kunci awam (anon/publishable) digunakan di pelayar;
// semua kawalan akses dikuatkuasakan oleh polisi RLS dalam pangkalan data.

const konfig = window.KONFIG_MYSMTS || {};

export const KONFIG = Object.freeze({
  supabaseUrl: String(konfig.supabaseUrl || '').replace(/\/+$/, ''),
  supabaseAnonKey: String(konfig.supabaseAnonKey || ''),
  namaOrganisasi: konfig.namaOrganisasi || 'Pejabat Pendidikan Daerah Limbang',
});

export const BALDI = 'lampiran';

export const konfigSah = Boolean(
  KONFIG.supabaseUrl.startsWith('https://') && KONFIG.supabaseAnonKey && window.supabase?.createClient,
);

export const sb = konfigSah
  ? window.supabase.createClient(KONFIG.supabaseUrl, KONFIG.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: 'implicit',
        storageKey: 'mysmts-sesi',
      },
      global: { headers: { 'x-client-info': 'mysmts-web/1.0' } },
    })
  : null;

/** Dapatkan profil pengguna semasa daripada pangkalan data (peranan sebenar). */
export async function dapatkanProfil() {
  const { data, error } = await sb.rpc('profil_saya');
  if (error) throw error;
  return data;
}

/** Panggil fungsi Edge "sediakan-akaun"; ralat pelayan dipulangkan sebagai Error mesra. */
async function panggilFungsi(badan) {
  const { data, error } = await sb.functions.invoke('sediakan-akaun', { body: badan });
  if (error) {
    let teks = '';
    try { teks = (await error.context?.json())?.ralat || ''; } catch { /* bukan JSON */ }
    throw Object.assign(new Error(teks || 'Tidak dapat menghubungi pelayan. Semak sambungan internet dan cuba lagi.'), { mesra: true });
  }
  return data;
}

/**
 * Log masuk sekolah menggunakan emel rasmi sahaja. Pelayan menyemak emel
 * dengan senarai sekolah aktif dan memulangkan token sekali guna.
 * @returns {Promise<'ok'|'tidak-berdaftar'>}
 */
export async function logMasukSekolah(emel) {
  const data = await panggilFungsi({ tindakan: 'log-masuk-sekolah', emel });
  if (!data?.ok) return 'tidak-berdaftar';
  const { error } = await sb.auth.verifyOtp({ token_hash: data.token_hash, type: 'email' });
  if (error) throw error;
  return 'ok';
}

/** Pentadbir menetapkan kata laluan bagi dirinya atau pentadbir lain. */
export async function tetapKataLaluanPentadbir(emel, kataLaluan) {
  await panggilFungsi({ tindakan: 'tetap-kata-laluan', emel, kata_laluan: kataLaluan });
}
