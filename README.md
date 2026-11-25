# MySMTS

**MySMTS** ialah Sistem Maklumbalas dan Tindakan Sekolah untuk Pejabat Pendidikan Daerah Limbang.

## Status semasa

Repositori ini memulakan penyediaan sistem untuk produksi. Halaman dalam `halaman/` ialah prototaip statik: data disimpan dalam `localStorage` pelayar dan belum dikongsi antara pengguna. Supabase belum dikonfigurasi. Jangan masukkan data sekolah sebenar atau maklumat peribadi ke dalam prototaip ini.

Fail HTML demo lama di direktori utama tidak diterbitkan ke Git kerana ia mengandungi kata laluan demo yang ditanam dalam kod. Jangan gunakan log masuk demo itu sebagai kawalan akses.

## Fail aplikasi

- `halaman/index.html` — senarai rekod
- `halaman/borang.html` — borang rekod lawatan
- `halaman/laporan.html` — laporan, cetakan dan eksport CSV
- `halaman/app.js` — logik prototaip dan storan pelayar

Buka `halaman/index.html` dalam pelayar untuk pratonton prototaip. Ciri simpanan berfungsi hanya dalam pelayar dan peranti yang sama.

## Sasaran produksi

- **Pangkalan data dan pengesahan:** Supabase
- **Kod sumber:** GitHub, `ppdlimbang/MySMTS`
- **Hosting statik:** GitHub Pages selepas integrasi Supabase, polisi Row Level Security, dan aliran pengesahan disediakan serta disemak

Kunci `service_role` Supabase tidak boleh diletakkan dalam kod pelayar atau repositori. Gunakan hanya kunci anon/publishable di klien bersama polisi Row Level Security yang mengehadkan akses. Simpan rahsia deployment dalam GitHub Actions Secrets jika diperlukan.

## Pembangunan

Aplikasi semasa tidak memerlukan pemasangan pakej atau proses binaan. Integrasi Supabase dan migrasi skema akan didokumenkan apabila dilaksanakan.
