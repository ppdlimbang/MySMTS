-- =====================================================================
-- MySMTS — Sistem Maklumbalas dan Tindakan Sekolah, PPD Limbang
-- Migrasi 1: skema, keselamatan baris (RLS), storan lampiran dan log audit
--
-- Model akses:
--   * Pentadbir PPD  : emel dalam jadual public.pentadbir (aktif) DAN sesi
--                      log masuk menggunakan kata laluan. Akses penuh.
--   * Sekolah        : emel dalam jadual public.sekolah (aktif), log masuk
--                      dengan kod sekali guna (OTP) ke emel sekolah. Hanya
--                      boleh melihat rekod sekolah sendiri dan mengisi
--                      Bahagian B (maklumbalas, status, gambar bukti).
--   * Orang awam     : tiada akses.
-- =====================================================================

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------
-- Jadual
-- ---------------------------------------------------------------------

create table public.pentadbir (
  emel           text primary key
                 check (emel = lower(btrim(emel))
                        and char_length(emel) <= 254
                        and emel ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  nama           text not null check (char_length(nama) between 2 and 120),
  aktif          boolean not null default true,
  dicipta_pada   timestamptz not null default now(),
  dikemaskini_pada timestamptz not null default now()
);

create table public.sekolah (
  id             uuid primary key default gen_random_uuid(),
  kod            text unique check (kod is null or kod ~ '^[A-Z0-9]{3,12}$'),
  nama           text not null unique check (char_length(nama) between 2 and 150),
  emel           text unique
                 check (emel is null or (
                        emel = lower(btrim(emel))
                        and char_length(emel) <= 254
                        and emel ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
  aktif          boolean not null default true,
  dicipta_pada   timestamptz not null default now(),
  dikemaskini_pada timestamptz not null default now()
);

create table public.rekod_lawatan (
  id               uuid primary key default gen_random_uuid(),
  sekolah_id       uuid not null references public.sekolah(id) on delete restrict,
  tarikh           date not null check (tarikh between date '2000-01-01' and date '2100-12-31'),
  masa             time,
  nama_pegawai     text not null check (char_length(nama_pegawai) between 2 and 150),
  jawatan          text not null check (char_length(jawatan) between 2 and 150),
  dapatan          text not null check (char_length(dapatan) between 1 and 10000),
  maklumbalas      text check (maklumbalas is null or char_length(maklumbalas) between 1 and 10000),
  status           text not null default 'Menunggu Maklumbalas'
                   check (status in ('Menunggu Maklumbalas', 'Dalam Tindakan', 'Selesai')),
  dicipta_oleh     uuid references auth.users(id) on delete set null,
  dicipta_pada     timestamptz not null default now(),
  dikemaskini_pada timestamptz not null default now(),
  maklumbalas_oleh uuid references auth.users(id) on delete set null,
  maklumbalas_pada timestamptz
);

create index rekod_lawatan_sekolah_tarikh_idx on public.rekod_lawatan (sekolah_id, tarikh desc);
create index rekod_lawatan_status_idx on public.rekod_lawatan (status);
create index rekod_lawatan_tarikh_idx on public.rekod_lawatan (tarikh desc);

create table public.lampiran (
  id               uuid primary key default gen_random_uuid(),
  rekod_id         uuid not null references public.rekod_lawatan(id) on delete cascade,
  jenis            text not null check (jenis in ('dapatan', 'maklumbalas')),
  laluan           text not null unique,
  dimuat_naik_oleh uuid references auth.users(id) on delete set null,
  dicipta_pada     timestamptz not null default now(),
  constraint lampiran_laluan_sah
    check (laluan ~ ('^' || rekod_id::text || '/' || jenis || '/[0-9a-f-]{36}\.(jpg|png|webp)$'))
);

create index lampiran_rekod_idx on public.lampiran (rekod_id);

create table public.log_audit (
  id         bigint generated always as identity primary key,
  pada       timestamptz not null default now(),
  pelaku     uuid,
  emel       text,
  jadual     text not null,
  tindakan   text not null,
  data_lama  jsonb,
  data_baru  jsonb
);

create index log_audit_pada_idx on public.log_audit (pada desc);

-- ---------------------------------------------------------------------
-- Fungsi pembantu identiti (skema private: tidak didedahkan melalui API)
-- ---------------------------------------------------------------------

-- Emel pengguna semasa, HANYA jika akaun pengesahan itu:
--   * telah mengesahkan emelnya, dan
--   * disediakan oleh fungsi Edge "sediakan-akaun" (bendera app_metadata
--     yang tidak boleh ditetapkan oleh pengguna sendiri).
-- Ini menghalang akaun yang didaftar sendiri (jika pendaftaran awam
-- tersilap dihidupkan) daripada mendapat akses walaupun emelnya sepadan.
create or replace function private.emel_semasa()
returns text
language sql stable security definer
set search_path = ''
as $$
  select lower(u.email)
  from auth.users u
  where u.id = auth.uid()
    and u.email_confirmed_at is not null
    and u.raw_app_meta_data ->> 'mysmts' = 'disediakan'
    and lower(u.email) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
$$;

-- Benar jika sesi semasa dibuka menggunakan kata laluan (tuntutan "amr" JWT).
create or replace function private.log_masuk_kata_laluan()
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_array_elements(
           case when jsonb_typeof(auth.jwt() -> 'amr') = 'array'
                then auth.jwt() -> 'amr' else '[]'::jsonb end) as a(e)
    where (jsonb_typeof(a.e) = 'object' and a.e ->> 'method' = 'password')
       or (jsonb_typeof(a.e) = 'string' and a.e #>> '{}' = 'password')
  )
$$;

create or replace function private.emel_pentadbir_aktif()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.pentadbir p
    where p.emel = private.emel_semasa() and p.aktif
  )
$$;

create or replace function private.adalah_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.log_masuk_kata_laluan() and private.emel_pentadbir_aktif()
$$;

create or replace function private.sekolah_saya()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select s.id from public.sekolah s
  where s.emel = private.emel_semasa() and s.aktif
  limit 1
$$;

create or replace function private.rekod_sekolah_saya(p_rekod uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rekod_lawatan r
    where r.id = p_rekod and r.sekolah_id = private.sekolah_saya()
  )
$$;

create or replace function private.boleh_akses_rekod(p_rekod uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.adalah_admin() or private.rekod_sekolah_saya(p_rekod)
$$;

create or replace function private.rekod_wujud(p_rekod uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.rekod_lawatan r where r.id = p_rekod)
$$;

create or replace function private.uuid_selamat(p text)
returns uuid
language plpgsql immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Pencetus (trigger): normalisasi, integriti dan audit
-- ---------------------------------------------------------------------

create or replace function private.normal_pentadbir()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.emel := lower(btrim(new.emel));
  new.nama := btrim(regexp_replace(new.nama, '[[:space:]]+', ' ', 'g'));
  if tg_op = 'UPDATE' then
    new.dicipta_pada := old.dicipta_pada;
  end if;
  new.dikemaskini_pada := now();
  if exists (select 1 from public.sekolah s where s.emel = new.emel) then
    raise exception 'Emel ini telah didaftarkan sebagai emel sekolah.';
  end if;
  return new;
end;
$$;

create or replace function private.normal_sekolah()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.nama := btrim(regexp_replace(new.nama, '[[:space:]]+', ' ', 'g'));
  new.kod  := nullif(upper(btrim(coalesce(new.kod, ''))), '');
  new.emel := nullif(lower(btrim(coalesce(new.emel, ''))), '');
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.dicipta_pada := old.dicipta_pada;
  end if;
  new.dikemaskini_pada := now();
  if new.emel is not null and exists (select 1 from public.pentadbir p where p.emel = new.emel) then
    raise exception 'Emel ini telah didaftarkan sebagai emel pentadbir.';
  end if;
  return new;
end;
$$;

-- Sekurang-kurangnya seorang pentadbir aktif mesti kekal.
create or replace function private.kekal_satu_pentadbir()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.pentadbir where aktif) then
    raise exception 'Sekurang-kurangnya seorang pentadbir aktif diperlukan.';
  end if;
  return null;
end;
$$;

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
  new.dikemaskini_pada := now();
  return new;
end;
$$;

create or replace function private.normal_lampiran()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.dimuat_naik_oleh := auth.uid();
  new.dicipta_pada := now();
  -- Kunci baris rekod induk supaya had bilangan gambar tidak dilangkau
  -- oleh muat naik serentak.
  perform 1 from public.rekod_lawatan where id = new.rekod_id for update;
  if (select count(*) from public.lampiran l
      where l.rekod_id = new.rekod_id and l.jenis = new.jenis) >= 10 then
    raise exception 'Had maksimum 10 gambar bagi setiap bahagian telah dicapai.';
  end if;
  return new;
end;
$$;

create or replace function private.catat_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.log_audit (pelaku, emel, jadual, tindakan, data_lama, data_baru)
  values (
    auth.uid(),
    private.emel_semasa(),
    tg_table_name,
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end;
$$;

create trigger pentadbir_normal before insert or update on public.pentadbir
  for each row execute function private.normal_pentadbir();
create trigger pentadbir_kekal_satu after update or delete on public.pentadbir
  for each statement execute function private.kekal_satu_pentadbir();
create trigger sekolah_normal before insert or update on public.sekolah
  for each row execute function private.normal_sekolah();
create trigger rekod_normal before insert or update on public.rekod_lawatan
  for each row execute function private.normal_rekod();
create trigger lampiran_normal before insert on public.lampiran
  for each row execute function private.normal_lampiran();

create trigger pentadbir_audit after insert or update or delete on public.pentadbir
  for each row execute function private.catat_audit();
create trigger sekolah_audit after insert or update or delete on public.sekolah
  for each row execute function private.catat_audit();
create trigger rekod_audit after insert or update or delete on public.rekod_lawatan
  for each row execute function private.catat_audit();
create trigger lampiran_audit after insert or delete on public.lampiran
  for each row execute function private.catat_audit();

-- ---------------------------------------------------------------------
-- Fungsi RPC awam (dipanggil oleh aplikasi)
-- ---------------------------------------------------------------------

-- Profil pengguna yang sedang log masuk. Peranan ditentukan oleh pangkalan
-- data, bukan oleh pelayar.
create or replace function public.profil_saya()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', auth.uid(),
    'emel', private.emel_semasa(),
    'peranan',
      case
        when private.adalah_admin() then 'admin'
        when private.sekolah_saya() is not null then 'sekolah'
        else null
      end,
    'admin_perlu_kata_laluan',
      private.emel_pentadbir_aktif() and not private.log_masuk_kata_laluan(),
    'nama',
      (select p.nama from public.pentadbir p
       where p.emel = private.emel_semasa() and p.aktif),
    'sekolah',
      (select jsonb_build_object('id', s.id, 'nama', s.nama, 'kod', s.kod)
       from public.sekolah s where s.id = private.sekolah_saya())
  )
$$;

-- Sekolah menghantar atau mengemas kini Bahagian B bagi rekodnya sendiri.
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

  update public.rekod_lawatan
     set maklumbalas = v_teks,
         status = p_status
   where id = p_rekod_id
     and sekolah_id = v_sekolah;

  if not found then
    raise exception 'Rekod tidak dijumpai.';
  end if;
end;
$$;

-- Untuk fungsi Edge sahaja (service_role): cari akaun pengesahan ikut emel.
create or replace function public.mysmts_akaun_ikut_emel(p_emel text)
returns table (id uuid, disediakan boolean)
language sql stable security definer
set search_path = ''
as $$
  select u.id, coalesce(u.raw_app_meta_data ->> 'mysmts' = 'disediakan', false)
  from auth.users u
  where lower(u.email) = lower(btrim(p_emel))
  limit 1
$$;

-- ---------------------------------------------------------------------
-- Keselamatan peringkat baris (RLS)
-- ---------------------------------------------------------------------

alter table public.pentadbir     enable row level security;
alter table public.sekolah       enable row level security;
alter table public.rekod_lawatan enable row level security;
alter table public.lampiran      enable row level security;
alter table public.log_audit     enable row level security;

-- Pentadbir
create policy pentadbir_baca on public.pentadbir
  for select to authenticated using ((select private.adalah_admin()));
create policy pentadbir_tambah on public.pentadbir
  for insert to authenticated with check ((select private.adalah_admin()));
create policy pentadbir_ubah on public.pentadbir
  for update to authenticated
  using ((select private.adalah_admin())) with check ((select private.adalah_admin()));
create policy pentadbir_padam on public.pentadbir
  for delete to authenticated using ((select private.adalah_admin()));

-- Sekolah
create policy sekolah_baca on public.sekolah
  for select to authenticated
  using ((select private.adalah_admin()) or id = (select private.sekolah_saya()));
create policy sekolah_tambah on public.sekolah
  for insert to authenticated with check ((select private.adalah_admin()));
create policy sekolah_ubah on public.sekolah
  for update to authenticated
  using ((select private.adalah_admin())) with check ((select private.adalah_admin()));
create policy sekolah_padam on public.sekolah
  for delete to authenticated using ((select private.adalah_admin()));

-- Rekod lawatan (sekolah mengemas kini melalui public.hantar_maklumbalas sahaja)
create policy rekod_baca on public.rekod_lawatan
  for select to authenticated
  using ((select private.adalah_admin()) or sekolah_id = (select private.sekolah_saya()));
create policy rekod_tambah on public.rekod_lawatan
  for insert to authenticated with check ((select private.adalah_admin()));
create policy rekod_ubah on public.rekod_lawatan
  for update to authenticated
  using ((select private.adalah_admin())) with check ((select private.adalah_admin()));
create policy rekod_padam on public.rekod_lawatan
  for delete to authenticated using ((select private.adalah_admin()));

-- Lampiran
create policy lampiran_baca on public.lampiran
  for select to authenticated using (private.boleh_akses_rekod(rekod_id));
create policy lampiran_tambah on public.lampiran
  for insert to authenticated
  with check (
    (select private.adalah_admin())
    or (jenis = 'maklumbalas'
        and dimuat_naik_oleh = (select auth.uid())
        and private.rekod_sekolah_saya(rekod_id))
  );
create policy lampiran_padam on public.lampiran
  for delete to authenticated
  using (
    (select private.adalah_admin())
    or (jenis = 'maklumbalas'
        and dimuat_naik_oleh = (select auth.uid())
        and private.rekod_sekolah_saya(rekod_id))
  );

-- Log audit: baca sahaja untuk pentadbir; ditulis oleh pencetus.
create policy log_audit_baca on public.log_audit
  for select to authenticated using ((select private.adalah_admin()));

-- ---------------------------------------------------------------------
-- Keistimewaan (grants)
-- ---------------------------------------------------------------------

revoke all on public.pentadbir, public.sekolah, public.rekod_lawatan,
              public.lampiran, public.log_audit
  from public, anon, authenticated;

grant select, insert, update, delete on public.pentadbir     to authenticated;
grant select, insert, update, delete on public.sekolah       to authenticated;
grant select, insert, update, delete on public.rekod_lawatan to authenticated;
grant select, insert, delete         on public.lampiran      to authenticated;
grant select                         on public.log_audit     to authenticated;

-- Fungsi Edge "sediakan-akaun" menyemak senarai emel yang dibenarkan.
grant select on public.pentadbir, public.sekolah to service_role;

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on function
  private.emel_semasa(),
  private.log_masuk_kata_laluan(),
  private.emel_pentadbir_aktif(),
  private.adalah_admin(),
  private.sekolah_saya(),
  private.rekod_sekolah_saya(uuid),
  private.boleh_akses_rekod(uuid),
  private.rekod_wujud(uuid),
  private.uuid_selamat(text)
  to authenticated;

revoke all on function public.mysmts_akaun_ikut_emel(text) from public, anon, authenticated;
grant execute on function public.mysmts_akaun_ikut_emel(text) to service_role;

revoke all on function public.profil_saya() from public, anon;
revoke all on function public.hantar_maklumbalas(uuid, text, text) from public, anon;
grant execute on function public.profil_saya() to authenticated;
grant execute on function public.hantar_maklumbalas(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Storan lampiran gambar (baldi peribadi)
-- Laluan objek: <rekod_id>/<dapatan|maklumbalas>/<uuid>.<jpg|png|webp>
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lampiran', 'lampiran', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy mysmts_lampiran_baca on storage.objects
  for select to authenticated
  using (
    bucket_id = 'lampiran'
    and private.boleh_akses_rekod(private.uuid_selamat((storage.foldername(name))[1]))
  );

create policy mysmts_lampiran_muat_naik on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'lampiran'
    and name ~ '^[0-9a-f-]{36}/(dapatan|maklumbalas)/[0-9a-f-]{36}\.(jpg|png|webp)$'
    and (
      ((select private.adalah_admin())
        and private.rekod_wujud(private.uuid_selamat((storage.foldername(name))[1])))
      or ((storage.foldername(name))[2] = 'maklumbalas'
        and private.rekod_sekolah_saya(private.uuid_selamat((storage.foldername(name))[1])))
    )
  );

create policy mysmts_lampiran_padam on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'lampiran'
    and (
      (select private.adalah_admin())
      or ((storage.foldername(name))[2] = 'maklumbalas'
        and owner_id = (select auth.uid())::text
        and private.rekod_sekolah_saya(private.uuid_selamat((storage.foldername(name))[1])))
    )
  );
