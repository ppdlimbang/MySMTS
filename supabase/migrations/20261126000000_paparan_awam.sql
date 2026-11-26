-- MySMTS: paparan awam (laman utama).
--
-- Keputusan pemilik sistem (26 Nov 2026): SEMUA rekod lawatan boleh dilihat
-- oleh orang awam tanpa log masuk, seperti reka bentuk asal: nama sekolah,
-- tarikh/masa, nama & jawatan pegawai, dapatan (Bahagian A), maklumbalas
-- sekolah (Bahagian B), status dan semua gambar.
--
-- Yang KEKAL tertutup:
--   * Emel sekolah. Sekolah log masuk dengan emel sahaja, jadi mendedahkan
--     emel bermakna sesiapa boleh log masuk sebagai mana-mana sekolah.
--     Orang awam hanya mendapat id, nama dan kod sekolah melalui
--     public.sekolah_awam().
--   * Jadual pentadbir dan log_audit.
--   * Medan dalaman (dicipta_oleh, maklumbalas_oleh, dimuat_naik_oleh).
--   * SEMUA penulisan: polisi tambah/ubah/padam tidak berubah.

-- Rekod lawatan: baca sahaja untuk semua orang.
create policy rekod_baca_awam on public.rekod_lawatan
  for select to anon, authenticated using (true);
grant select (id, sekolah_id, tarikh, masa, nama_pegawai, jawatan, dapatan, maklumbalas, status,
              dicipta_pada, dikemaskini_pada, maklumbalas_pada)
  on public.rekod_lawatan to anon;

-- Lampiran gambar: baca sahaja untuk semua orang.
create policy lampiran_baca_awam on public.lampiran
  for select to anon, authenticated using (true);
grant select (id, rekod_id, jenis, laluan, dicipta_pada) on public.lampiran to anon;

-- Senarai sekolah awam (tanpa emel).
create or replace function public.sekolah_awam()
returns table (id uuid, nama text, kod text)
language sql stable security definer
set search_path = ''
as $$
  select s.id, s.nama, s.kod from public.sekolah s order by s.nama
$$;
revoke all on function public.sekolah_awam() from public;
grant execute on function public.sekolah_awam() to anon, authenticated;

-- Fail gambar dalam baldi peribadi: boleh dibaca melalui URL bertandatangan.
create policy mysmts_lampiran_baca_awam on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'lampiran');
