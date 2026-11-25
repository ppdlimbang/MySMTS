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
        detectSessionInUrl: true,
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

/**
 * Pastikan akaun pengesahan wujud untuk emel yang didaftarkan oleh pentadbir.
 * Kegagalan diabaikan secara senyap: langkah seterusnya (OTP / set semula)
 * akan melaporkan ralat yang sesuai.
 */
export async function sediakanAkaun(emel) {
  try {
    await sb.functions.invoke('sediakan-akaun', { body: { emel } });
  } catch (e) {
    console.warn('sediakan-akaun gagal:', e);
  }
}
