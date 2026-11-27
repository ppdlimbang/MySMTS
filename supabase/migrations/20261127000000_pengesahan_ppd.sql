-- MySMTS: aliran status dengan pengesahan PPD (2026-11-27)
--
--   Menunggu Maklumbalas  -> rekod baharu oleh PPD
--   Dalam Tindakan        -> sekolah sedang mengambil tindakan
--   Selesai               -> sekolah melaporkan tindakan selesai (menunggu pengesahan PPD)
--   Ditutup               -> PPD mengesahkan dan menutup tiket (pentadbir sahaja)
--
-- Setelah Ditutup, sekolah tidak lagi boleh mengubah Bahagian B atau gambar bukti.
-- Pentadbir boleh membuka semula rekod dengan menukar status.

-- 1. Status baharu + tarikh/pelaku pengesahan.
alter table public.rekod_lawatan drop constraint rekod_lawatan_status_check;
alter table public.rekod_lawatan add constraint rekod_lawatan_status_check
  check (status in ('Menunggu Maklumbalas', 'Dalam Tindakan', 'Selesai', 'Ditutup'));

alter table public.rekod_lawatan
  add column ditutup_oleh uuid references auth.users(id) on delete set null,
  add column ditutup_pada timestamptz;

-- Orang awam boleh melihat tarikh rekod ditutup (bukan pelakunya).
grant select (ditutup_pada) on public.rekod_lawatan to anon;

-- 2. Medan sistem: ditutup_oleh/ditutup_pada ditetapkan oleh pencetus sahaja.
create or replace function private.normal_rekod()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.nama_pegawai := btrim(regexp_replace(new.nama_pegawai, '[[:space:]]+', ' ', 'g'));
  new.jawatan      := btrim(regexp_replace(new.jawatan, '[[:space:]]+', ' ', 'g'));
  new.dapatan      := btrim(new.dapatan);
  new.maklumbalas  := nullif(btrim(coalesce(new.maklumbalas, '')), '');

  if tg_op = 'INSERT' then
    new.dicipta_oleh := auth.uid();
    new.dicipta_pada := now();
    if new.maklumbalas is not null then
      new.maklumbalas_oleh := auth.uid();
      new.maklumbalas_pada := now();
    else
      new.maklumbalas_oleh := null;
      new.maklumbalas_pada := null;
    end if;
  else
    new.id           := old.id;
    new.dicipta_oleh := old.dicipta_oleh;
    new.dicipta_pada := old.dicipta_pada;
    if new.maklumbalas is distinct from old.maklumbalas then
      new.maklumbalas_oleh := case when new.maklumbalas is null then null else auth.uid() end;
      new.maklumbalas_pada := case when new.maklumbalas is null then null else now() end;
    else
      new.maklumbalas_oleh := old.maklumbalas_oleh;
      new.maklumbalas_pada := old.maklumbalas_pada;
    end if;
  end if;

  if new.status = 'Ditutup' then
    if tg_op = 'INSERT' or old.status is distinct from 'Ditutup' then
      new.ditutup_oleh := auth.uid();
      new.ditutup_pada := now();
    else
      new.ditutup_oleh := old.ditutup_oleh;
      new.ditutup_pada := old.ditutup_pada;
    end if;
  else
    new.ditutup_oleh := null;
    new.ditutup_pada := null;
  end if;

  new.dikemaskini_pada := now();
  return new;
end;
$$;

-- 3. Rekod sekolah sendiri yang BELUM ditutup (untuk penulisan oleh sekolah).
create or replace function private.rekod_sekolah_saya_terbuka(p_rekod uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rekod_lawatan r
    where r.id = p_rekod
      and r.sekolah_id = private.sekolah_saya()
      and r.status <> 'Ditutup'
  )
$$;
revoke all on function private.rekod_sekolah_saya_terbuka(uuid) from public, anon;
grant execute on function private.rekod_sekolah_saya_terbuka(uuid) to authenticated;

-- 4. Bahagian B: sekolah hanya boleh mengemas kini rekod yang belum ditutup.
create or replace function public.hantar_maklumbalas(
  p_rekod_id uuid,
  p_maklumbalas text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sekolah uuid := private.sekolah_saya();
  v_teks text := btrim(coalesce(p_maklumbalas, ''));
  v_status text;
begin
  if v_sekolah is null then
    raise exception 'Akses ditolak.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('Dalam Tindakan', 'Selesai') then
    raise exception 'Status tindakan tidak sah.';
  end if;
  if char_length(v_teks) = 0 then
    raise exception 'Sila isi maklumbalas dan tindakan sekolah.';
  end if;
  if char_length(v_teks) > 10000 then
    raise exception 'Maklumbalas terlalu panjang (maksimum 10,000 aksara).';
  end if;

  select r.status into v_status
    from public.rekod_lawatan r
   where r.id = p_rekod_id and r.sekolah_id = v_sekolah
   for update;
  if not found then
    raise exception 'Rekod tidak dijumpai.';
  end if;
  if v_status = 'Ditutup' then
    raise exception 'Rekod ini telah disahkan dan ditutup oleh PPD.';
  end if;

  update public.rekod_lawatan
     set maklumbalas = v_teks,
         status = p_status
   where id = p_rekod_id;
end;
$$;

-- 5. Gambar bukti sekolah: tambah/padam hanya bagi rekod yang belum ditutup.
drop policy lampiran_tambah on public.lampiran;
create policy lampiran_tambah on public.lampiran
  for insert to authenticated
  with check (
    (select private.adalah_admin())
    or (jenis = 'maklumbalas'
        and dimuat_naik_oleh = (select auth.uid())
        and private.rekod_sekolah_saya_terbuka(rekod_id))
  );

drop policy lampiran_padam on public.lampiran;
create policy lampiran_padam on public.lampiran
  for delete to authenticated
  using (
    (select private.adalah_admin())
    or (jenis = 'maklumbalas'
        and dimuat_naik_oleh = (select auth.uid())
        and private.rekod_sekolah_saya_terbuka(rekod_id))
  );

drop policy mysmts_lampiran_muat_naik on storage.objects;
create policy mysmts_lampiran_muat_naik on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'lampiran'
    and name ~ '^[0-9a-f-]{36}/(dapatan|maklumbalas)/[0-9a-f-]{36}\.(jpg|png|webp)$'
    and (
      ((select private.adalah_admin())
        and private.rekod_wujud(private.uuid_selamat((storage.foldername(name))[1])))
      or ((storage.foldername(name))[2] = 'maklumbalas'
        and private.rekod_sekolah_saya_terbuka(private.uuid_selamat((storage.foldername(name))[1])))
    )
  );

drop policy mysmts_lampiran_padam on storage.objects;
create policy mysmts_lampiran_padam on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'lampiran'
    and (
      (select private.adalah_admin())
      or ((storage.foldername(name))[2] = 'maklumbalas'
        and owner_id = (select auth.uid())::text
        and private.rekod_sekolah_saya_terbuka(private.uuid_selamat((storage.foldername(name))[1])))
    )
  );
