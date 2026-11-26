# Panduan Penyediaan Produksi MySMTS

Ikut langkah ini mengikut urutan. Anggaran masa: 30–45 minit.

> **Model log masuk:** sekolah log masuk dengan **emel rasmi sahaja** (tiada kod, tiada kata laluan). Pentadbir log masuk dengan **emel + kata laluan**. Sistem **tidak menghantar sebarang emel**, jadi SMTP tidak diperlukan.
>
> **Risiko yang diterima:** sesiapa yang mengetahui emel rasmi sebuah sekolah boleh log masuk sebagai sekolah itu (melihat rekodnya dan mengisi Bahagian B). Mereka tidak boleh melihat sekolah lain atau mengubah dapatan pegawai. Setiap log masuk sekolah direkodkan dalam **Log Audit** (masa, IP, pelayar) supaya penyalahgunaan dapat dikesan.

Nilai contoh yang digunakan dalam panduan ini:

- Repositori: `ppdlimbang/MySMTS`
- URL laman: `https://ppdlimbang.github.io/MySMTS/`
- Projek Supabase: `https://naejrcjjighsppfeqecm.supabase.co`

---

## 1. Cipta projek Supabase

1. Log masuk ke <https://supabase.com/dashboard> dan klik **New project**.
2. **Region:** pilih **Southeast Asia (Singapore)** supaya lebih dekat dengan pengguna di Sarawak.
3. Simpan kata laluan pangkalan data di tempat yang selamat, seperti pengurus kata laluan jabatan.

> **Pelan:** Projek pelan *Free* akan **dijeda selepas 7 hari tanpa aktiviti** dan **tidak mempunyai sandaran harian**. Untuk produksi, gunakan pelan **Pro** supaya sistem sentiasa aktif dan disandarkan setiap hari.

## 2. Jalankan migrasi pangkalan data

Di papan pemuka Supabase, buka **SQL Editor**. Tampal dan jalankan setiap fail berikut **mengikut urutan**, satu fail setiap kali:

1. `supabase/migrations/20261125000000_skema_awal.sql`: jadual, RLS, storan dan audit
2. `supabase/migrations/20261125000100_senarai_sekolah.sql`: 17 sekolah awal daerah Limbang

Jika anda menggunakan Supabase CLI, jalankan:

```bash
supabase link --project-ref naejrcjjighsppfeqecm
supabase db push
```

## 3. Daftar pentadbir

Pentadbir didaftarkan melalui papan pemuka Supabase (aplikasi tidak mempunyai halaman pengurusan pentadbir). Ulang langkah ini bagi setiap pentadbir.

1. **SQL Editor**: daftarkan emel dan nama pentadbir.

   ```sql
   insert into public.pentadbir (emel, nama)
   values ('nama.pegawai@moe.gov.my', 'Nama Penuh Pegawai');
   ```

2. **Authentication → Users → Add user → Create new user**: isi emel yang sama dan kata laluan (sekurang-kurangnya 12 aksara, dengan huruf besar, huruf kecil dan nombor). Tandakan **Auto Confirm User**.

3. **SQL Editor**: tandakan akaun itu sebagai akaun yang disediakan oleh sistem. Tanpa langkah ini, akaun tidak diiktiraf.

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"mysmts":"disediakan"}'::jsonb
   where lower(email) = 'nama.pegawai@moe.gov.my' and email_confirmed_at is not null;
   ```

Selepas log masuk, pentadbir boleh menukar kata laluan sendiri melalui butang **Kata laluan** di bahagian atas aplikasi.

## 4. Terbitkan fungsi Edge `sediakan-akaun`

Fungsi ini (a) membenarkan sekolah aktif log masuk dengan emel sahaja dan merekodkan log masuk itu, dan (b) membenarkan pentadbir menukar kata laluan sendiri. Ia menggunakan kunci rahsia pelayan yang tidak pernah sampai ke pelayar.

```bash
npx supabase login
npx supabase functions deploy sediakan-akaun --remote=<ref-projek> --no-verify-jwt --use-api
npx supabase secrets set ALLOWED_ORIGINS=https://ppdlimbang.github.io --remote=<ref-projek>
```

Jika menggunakan papan pemuka, namakan fungsi tepat `sediakan-akaun` dan **matikan "Verify JWT"** dalam tab **Settings** fungsi itu.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` dan `SUPABASE_SERVICE_ROLE_KEY` disediakan secara automatik oleh Supabase. Tetapkan `MYSMTS_SECRET_KEY` (kunci `sb_secret_...`) hanya jika kunci *service_role* lama telah dimatikan.

## 5. Tetapan pengesahan (Authentication)

Tetapan ini disimpan dalam `supabase/config.toml` dan ditolak dengan:

```bash
npx supabase config diff --remote=<ref-projek>
npx supabase config push --remote=<ref-projek>
```

Hasilnya (boleh disemak di **Authentication → Sign In / Providers** dan **URL Configuration**):

- **Allow new users to sign up:** MATI (wajib). Akaun hanya dicipta oleh fungsi `sediakan-akaun`.
- **Allow anonymous sign-ins:** MATI
- **Email** provider: HIDUP (diperlukan untuk log masuk kata laluan dan token sekolah)
- **Phone** dan penyedia lain: MATI
- **Minimum password length:** 12, dengan huruf besar, huruf kecil dan digit
- **Site URL:** `https://ppdlimbang.github.io/MySMTS/`

**SMTP dan templat emel tidak diperlukan**, kerana sistem tidak menghantar emel.

## 6. Sediakan GitHub Pages

1. Pada repositori GitHub, pergi ke **Settings** → **Pages** → **Build and deployment** → **Source**, kemudian pilih **GitHub Actions**.
2. Pergi ke **Settings** → **Secrets and variables** → **Actions** → tab **Variables** → **New repository variable**, dan tambah:

   | Nama | Nilai |
   |---|---|
   | `SUPABASE_URL` | `https://naejrcjjighsppfeqecm.supabase.co` |
   | `SUPABASE_ANON_KEY` | Kunci **anon** atau **publishable** (Project Settings → API Keys) |

   > Jangan sekali-kali gunakan kunci `service_role` atau `sb_secret_...` di sini. Aliran kerja deploy akan menolak kunci rahsia.

3. Tolak (push) ke cabang `main`. Aliran kerja **Uji dan terbit ke GitHub Pages** akan menjalankan semua ujian dahulu. Laman hanya diterbitkan jika semua ujian lulus.

> GitHub Pages pada pelan percuma memerlukan repositori **awam**. Ini selamat kerana tiada rahsia dalam kod. Kunci anon memang bersifat awam, dan semua akses dikawal oleh RLS.

## 7. Log masuk kali pertama

1. Buka `https://ppdlimbang.github.io/MySMTS/`, pilih tab **Pentadbir PPD**, dan log masuk dengan emel serta kata laluan dari langkah 3.
2. Pergi ke tab **Sekolah** dan isi **emel rasmi** serta **kod** bagi setiap sekolah. Sekolah tanpa emel tidak boleh log masuk.
3. Uji dengan satu sekolah: log keluar, pilih tab **Sekolah**, masukkan emel sekolah itu dan klik **Log masuk sekolah**.
4. Semak tab **Log Audit**: log masuk tersebut sepatutnya dipaparkan bersama alamat IP.

## 8. Senarai semak sebelum digunakan

- [ ] Pendaftaran awam (**Allow new users to sign up**) dimatikan
- [ ] Fungsi `sediakan-akaun` diterbitkan dengan **Verify JWT dimatikan**
- [ ] Pembolehubah `SUPABASE_URL` dan `SUPABASE_ANON_KEY` ditetapkan di GitHub, dan aliran kerja lulus
- [ ] Ujian sebenar dengan dua sekolah: sekolah A tidak dapat melihat rekod sekolah B
- [ ] Emel pentadbir yang dimasukkan di tab Sekolah ditolak
- [ ] Log masuk sekolah muncul dalam **Log Audit**
- [ ] Pelan Pro diaktifkan (sandaran harian, tiada jeda), atau pelan sandaran alternatif telah dipersetujui

## 9. Operasi harian

- **Sekolah baharu atau emel sekolah bertukar:** kemas kini di tab **Sekolah**. Akses mengikut emel baharu berkuat kuasa serta-merta. Akaun log masuk sekolah (di **Authentication → Users**) hanya dicipta secara automatik semasa sekolah itu log masuk kali pertama.
- **Sekolah tidak lagi digunakan:** klik **Nyahaktif**. Rekod dikekalkan dan akses ditarik balik serta-merta.
- **Pentadbir bertukar jawatan:** di **SQL Editor**, jalankan `update public.pentadbir set aktif = false where emel = '...';` (atau `delete`). Sistem sentiasa mengekalkan sekurang-kurangnya seorang pentadbir aktif.
- **Pentadbir lupa kata laluan:** di **Authentication → Users**, padam akaun tersebut, kemudian ulang langkah 3 (bahagian 2 dan 3) dengan kata laluan baharu.
- **Disyaki penyalahgunaan log masuk sekolah:** semak tab **Log Audit** (Akaun — Log masuk sekolah). Nyahaktifkan sekolah tersebut serta-merta jika perlu.
- **Laporan:** gunakan **Cetak Laporan** pada setiap rekod untuk mencetak atau menyimpan laporan A4 (PDF).
- **Siasatan:** tab **Log Audit** menunjukkan siapa mengubah apa dan bila, serta setiap log masuk sekolah dan pertukaran kata laluan.

## 10. Kemas kini sistem

- Perubahan skema mesti ditambah sebagai fail migrasi **baharu** dalam `supabase/migrations/`. Jangan ubah fail migrasi yang telah dijalankan.
- Jalankan `npm run semak` sebelum menolak (push). Aliran kerja yang sama turut dijalankan secara automatik pada setiap *pull request*.
- Pustaka `web/vendor/supabase.js` ialah versi `@supabase/supabase-js@2.119.2` (UMD). Untuk mengemas kininya, muat turun versi baharu dari `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@<versi>/dist/umd/supabase.js`, kemudian jalankan ujian.
