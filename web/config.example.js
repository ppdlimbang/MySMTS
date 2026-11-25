// Salin fail ini kepada web/config.js untuk pembangunan setempat.
// Dalam produksi, GitHub Actions menjana config.js daripada pemboleh ubah
// repositori SUPABASE_URL dan SUPABASE_ANON_KEY (lihat docs/PENYEDIAAN.md).
//
// Hanya gunakan kunci AWAM (anon / "sb_publishable_..."). JANGAN sekali-kali
// letakkan kunci service_role atau "sb_secret_..." di sini.
window.KONFIG_MYSMTS = {
  supabaseUrl: 'https://PROJEK-ANDA.supabase.co',
  supabaseAnonKey: 'KUNCI-ANON-ATAU-PUBLISHABLE',
};
