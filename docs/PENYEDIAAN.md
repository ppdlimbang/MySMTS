# Panduan Penyediaan Produksi MySMTS

Ikut langkah ini mengikut urutan. Anggaran masa: 45–60 minit.

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

## 3. Daftar pentadbir pertama

Di **SQL Editor**, jalankan arahan berikut. Gantikan emel dan nama dengan maklumat pentadbir sebenar:

```sql
insert into public.pentadbir (emel, nama)
values ('nama.pegawai@moe.gov.my', 'Nama Penuh Pegawai');
```

Pentadbir seterusnya boleh ditambah melalui tab **Pentadbir** dalam aplikasi.

## 4. Terbitkan fungsi Edge `sediakan-akaun`

Fungsi ini mencipta akaun log masuk **hanya** untuk emel yang didaftarkan dalam jadual `sekolah` atau `pentadbir`.

**Pilihan A: papan pemuka**

1. Pergi ke **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Namakan fungsi `sediakan-akaun` (ejaan mesti tepat).
3. Tampal kandungan fail `supabase/functions/sediakan-akaun/index.ts`, kemudian klik **Deploy**.
4. Buka **Details** fungsi tersebut dan **matikan "Enforce JWT Verification" / "Verify JWT"**. Fungsi ini dipanggil sebelum pengguna log masuk.

**Pilihan B: CLI**

```bash
supabase functions deploy sediakan-akaun --no-verify-jwt
```

**Rahsia fungsi** (Edge Functions → **Secrets**):

| Nama | Nilai | Wajib? |
|---|---|---|
| `ALLOWED_ORIGINS` | `https://ppdlimbang.github.io` | Disyorkan |
| `MYSMTS_SECRET_KEY` | Kunci `sb_secret_...` | Hanya jika kunci *service_role* lama telah dimatikan |

`SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` disediakan secara automatik oleh Supabase.

## 5. Tetapan pengesahan (Authentication)

### 5.1 Penyedia dan pendaftaran

Pergi ke **Authentication** → **Sign In / Providers**:

- **Allow new users to sign up:** **MATI**. Ini wajib. Akaun hanya dicipta oleh fungsi `sediakan-akaun`.
- **Allow anonymous sign-ins:** MATI
- **Email** provider: HIDUP
  - **Confirm email:** HIDUP
  - **Secure email change:** HIDUP
  - **Email OTP Expiration:** `600` saat (10 minit)
  - **Email OTP Length:** `6`
- Semua penyedia lain (Google, Phone dan sebagainya): MATI

### 5.2 Kata laluan

Pergi ke **Authentication** → **Policies** / **Password security**:

- **Minimum password length:** `12`
- **Password requirements:** huruf kecil, huruf besar dan digit
- **Leaked password protection:** HIDUP (pelan Pro)

### 5.3 URL

Pergi ke **Authentication** → **URL Configuration**:

- **Site URL:** `https://ppdlimbang.github.io/MySMTS/`
- **Redirect URLs:** tambah `https://ppdlimbang.github.io/MySMTS/kata-laluan.html`

### 5.4 SMTP: wajib untuk produksi

Pelayan emel lalai Supabase hanya menghantar emel kepada **ahli pasukan projek**, dan terhad kepada beberapa emel sejam. Emel sekolah **tidak akan menerima kod** sehingga SMTP sendiri dikonfigurasi.

Pergi ke **Authentication** → **Emails** → **SMTP Settings**, hidupkan **Custom SMTP**, kemudian isi butiran pembekal emel. Contoh pembekal: pelayan SMTP jabatan, Amazon SES, Brevo atau Resend.

- **Sender email:** contohnya `no-reply@domain-anda`
- **Sender name:** `MySMTS PPD Limbang`

Selepas itu, semak had kadar di **Authentication** → **Rate Limits**. Tetapkan *Rate limit for sending emails* supaya mencukupi untuk semua sekolah, contohnya 100 sejam.

### 5.5 Templat emel

Pergi ke **Authentication** → **Emails** → **Templates**.

**Magic Link** (digunakan untuk kod log masuk sekolah). Templat ini mesti mengandungi `{{ .Token }}`:

- Subjek: `Kod log masuk MySMTS`
- Kandungan:

```html
<h2>Kod log masuk MySMTS</h2>
<p>Gunakan kod berikut untuk log masuk ke Sistem Maklumbalas &amp; Tindakan Sekolah PPD Limbang:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>Kod ini sah selama 10 minit. Jangan kongsi kod ini dengan sesiapa, termasuk pegawai PPD.</p>
<p>Jika anda tidak meminta kod ini, abaikan emel ini.</p>
```

**Reset Password** (digunakan untuk menetapkan kata laluan pentadbir):

- Subjek: `Tetapkan kata laluan MySMTS`
- Kandungan:

```html
<h2>Tetapkan kata laluan pentadbir MySMTS</h2>
<p>Klik pautan di bawah untuk menetapkan kata laluan anda:</p>
<p><a href="{{ .ConfirmationURL }}">Tetapkan kata laluan</a></p>
<p>Pautan ini sah untuk tempoh terhad dan hanya boleh digunakan sekali.</p>
<p>Jika anda tidak meminta pautan ini, abaikan emel ini.</p>
```

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

1. Buka `https://ppdlimbang.github.io/MySMTS/` dan pilih tab **Pentadbir PPD**.
2. Klik **Tetapkan / lupa kata laluan?**, masukkan emel pentadbir dari langkah 3, kemudian klik **Hantar pautan**.
3. Buka emel, klik pautan, dan tetapkan kata laluan (sekurang-kurangnya 12 aksara).
4. Log masuk menggunakan emel dan kata laluan tersebut.
5. Pergi ke tab **Sekolah** dan isi **emel rasmi** serta **kod** bagi setiap sekolah. Sekolah tanpa emel tidak boleh log masuk.

Sekolah boleh log masuk dengan memilih tab **Sekolah**, memasukkan emel rasmi sekolah, dan memasukkan kod 6 digit yang diterima melalui emel.

## 8. Senarai semak sebelum digunakan

- [ ] Pendaftaran awam (**Allow new users to sign up**) dimatikan
- [ ] Custom SMTP dikonfigurasi, dan kod log masuk diterima di peti emel sekolah ujian
- [ ] Templat **Magic Link** mengandungi `{{ .Token }}`
- [ ] Fungsi `sediakan-akaun` diterbitkan dengan **Verify JWT dimatikan**
- [ ] **Site URL** dan **Redirect URLs** ditetapkan kepada URL GitHub Pages
- [ ] Pembolehubah `SUPABASE_URL` dan `SUPABASE_ANON_KEY` ditetapkan di GitHub, dan aliran kerja lulus
- [ ] Ujian sebenar dengan dua sekolah: sekolah A tidak dapat melihat rekod sekolah B
- [ ] Pentadbir yang log masuk melalui tab Sekolah (kod emel) ditolak
- [ ] Pelan Pro diaktifkan (sandaran harian, tiada jeda), atau pelan sandaran alternatif telah dipersetujui

## 9. Operasi harian

- **Sekolah baharu atau emel sekolah bertukar:** kemas kini di tab **Sekolah**. Akses mengikut emel baharu berkuat kuasa serta-merta.
- **Sekolah tidak lagi digunakan:** klik **Nyahaktif**. Rekod dikekalkan dan akses ditarik balik serta-merta.
- **Pentadbir bertukar jawatan:** nyahaktifkan atau padam di tab **Pentadbir**. Sistem sentiasa mengekalkan sekurang-kurangnya seorang pentadbir aktif.
- **Laporan:** gunakan **Eksport CSV**, yang mengikut penapis semasa, atau **Cetak A4** bagi setiap rekod.
- **Siasatan:** tab **Log Audit** menunjukkan siapa mengubah apa dan bila.

## 10. Kemas kini sistem

- Perubahan skema mesti ditambah sebagai fail migrasi **baharu** dalam `supabase/migrations/`. Jangan ubah fail migrasi yang telah dijalankan.
- Jalankan `npm run semak` sebelum menolak (push). Aliran kerja yang sama turut dijalankan secara automatik pada setiap *pull request*.
- Pustaka `web/vendor/supabase.js` ialah versi `@supabase/supabase-js@2.119.2` (UMD). Untuk mengemas kininya, muat turun versi baharu dari `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@<versi>/dist/umd/supabase.js`, kemudian jalankan ujian.
