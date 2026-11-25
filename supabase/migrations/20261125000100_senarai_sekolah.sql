-- MySMTS — Migrasi 2: senarai awal sekolah daerah Limbang.
-- Emel dan kod sekolah diisi oleh pentadbir melalui halaman "Sekolah"
-- dalam aplikasi. Sekolah tanpa emel tidak boleh log masuk.

insert into public.sekolah (nama) values
  ('SMK Limbang'),
  ('SMK Kubong'),
  ('SMK Agama Limbang'),
  ('SMK Seri Patiambun'),
  ('SMK Sundar'),
  ('SK Limbang'),
  ('SK Kubong'),
  ('SK St Mary Limbang'),
  ('SK St Edmund Limbang'),
  ('SK Mendamit'),
  ('SK Tedungan'),
  ('SK Batu Danau'),
  ('SK Meritim'),
  ('SK Ukong'),
  ('SK Lubok Piasau'),
  ('SK Melayu Pusat'),
  ('SJK (C) Chung Hwa Limbang')
on conflict (nama) do nothing;
