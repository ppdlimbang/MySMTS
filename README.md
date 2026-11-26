# MySMTS

**MySMTS** ialah Sistem Maklumbalas dan Tindakan Sekolah untuk Pejabat Pendidikan Daerah (PPD) Limbang. Pegawai PPD merekod dapatan lawatan ke sekolah (Bahagian A), dan pihak sekolah menghantar maklumbalas serta bukti tindakan (Bahagian B).

- **Hosting:** GitHub Pages (laman statik dalam `web/`)
- **Pangkalan data, pengesahan dan storan gambar:** Supabase
- **Panduan penyediaan produksi:** [docs/PENYEDIAAN.md](docs/PENYEDIAAN.md)

## Peranan dan log masuk

| Peranan | Cara log masuk | Akses |
|---|---|---|
| **Pentadbir PPD** | Emel rasmi + kata laluan | Cipta, kemas kini dan padam rekod lawatan; urus senarai sekolah; lihat log audit; eksport CSV; tukar kata laluan sendiri |
| **Sekolah** | Emel rasmi sekolah sahaja (tiada kod, tiada kata laluan) | Lihat rekod sekolah sendiri sahaja; isi maklumbalas, status dan gambar bukti (Bahagian B) |

Hanya emel yang didaftarkan oleh pentadbir boleh log masuk. Pendaftaran awam dimatikan. Sistem tidak menghantar emel.

> Oleh kerana sekolah log masuk dengan emel sahaja, sesiapa yang mengetahui emel rasmi sekolah boleh log masuk sebagai sekolah itu. Setiap log masuk sekolah direkodkan dalam Log Audit (masa, IP, pelayar). Pentadbir didaftarkan melalui papan pemuka Supabase (lihat panduan penyediaan) dan menukar kata laluan sendiri dalam aplikasi.

## Keselamatan

- Semua kawalan akses dikuatkuasakan dalam pangkalan data melalui **Row Level Security (RLS)**, bukan dalam pelayar. Peranan ditentukan oleh jadual `pentadbir` dan `sekolah`.
- Akses pentadbir memerlukan sesi yang dibuka **dengan kata laluan**. Emel pentadbir tidak boleh log masuk melalui tab Sekolah.
- Akaun yang tidak disediakan oleh sistem (cth. didaftar sendiri) tidak diiktiraf walaupun emelnya sepadan.
- Sekolah hanya boleh mengubah Bahagian B melalui fungsi `hantar_maklumbalas`, dan tidak boleh mengubah dapatan pegawai.
- Gambar disimpan dalam baldi storan **peribadi** dan dipaparkan melalui URL bertandatangan yang tamat tempoh dalam 1 jam.
- Setiap perubahan direkodkan dalam `log_audit`, yang tidak boleh diubah atau dipadam.
- Halaman menggunakan Content-Security-Policy yang ketat (tiada skrip sebaris dan tiada CDN luar). Pustaka `supabase-js` disimpan dalam `web/vendor/`.
- Hanya kunci **awam** (anon/publishable) digunakan di pelayar. Kunci rahsia hanya digunakan dalam fungsi Edge.

## Struktur repositori

```
web/                         Laman yang diterbitkan ke GitHub Pages
  index.html                 Log masuk (sekolah: emel sahaja, pentadbir: kata laluan)
  app.html                   Aplikasi utama (rekod, sekolah, log audit)
  js/  css/  img/  vendor/
  config.example.js          Templat konfigurasi (config.js dijana semasa deploy)
supabase/
  migrations/                Skema, RLS, storan, audit, senarai awal sekolah
  functions/sediakan-akaun/  Fungsi Edge: log masuk sekolah (emel sahaja) dan tukar kata laluan pentadbir
tests/                       Ujian keselamatan pangkalan data dan ujian antara muka
.github/workflows/           Uji, kemudian terbit ke GitHub Pages
```

## Pembangunan dan ujian

Keperluan: Node.js 20 atau lebih baharu. Ujian antara muka menggunakan Chrome atau Edge yang sedia terpasang.

```bash
npm install
npm test          # ujian keselamatan RLS (PostgreSQL sebenar melalui PGlite) + ujian antara muka
npm run semak     # ujian + semakan statik (sintaks, rujukan ID, pematuhan CSP)
```

Pratonton setempat dengan projek Supabase sebenar:

```bash
cp web/config.example.js web/config.js   # isi URL dan kunci anon projek
npm run serve                            # http://localhost:8080
```

