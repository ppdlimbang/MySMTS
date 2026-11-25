// MySMTS — Fungsi Edge "sediakan-akaun"
//
// Sistem ini TIDAK menghantar sebarang emel. Fungsi ini menyediakan dua
// tindakan yang memerlukan kunci rahsia pelayan:
//
//  1. "log-masuk-sekolah": sekolah log masuk dengan emel rasmi sahaja.
//     Jika emel sepadan dengan sekolah AKTIF dalam jadual public.sekolah,
//     fungsi ini memastikan akaun pengesahan wujud dan memulangkan token
//     sekali guna (token_hash) yang ditukar oleh pelayar kepada sesi.
//     Emel pentadbir tidak pernah diterima di sini. Setiap log masuk
//     direkodkan dalam log_audit (masa, IP, pelayar).
//
//  2. "tetap-kata-laluan": pentadbir (sesi kata laluan) menetapkan kata
//     laluan bagi dirinya atau pentadbir lain yang berdaftar. Peranan
//     pemanggil disahkan oleh pangkalan data melalui profil_saya().
//
// Pembolehubah persekitaran:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (automatik)
//   MYSMTS_SECRET_KEY   (pilihan: kunci "sb_secret_..." jika kunci
//                        service_role lama telah dimatikan)
//   ALLOWED_ORIGINS     (pilihan: asal dibenarkan, dipisah koma,
//                        cth. https://ppdlimbang.github.io)

import { createClient } from 'npm:@supabase/supabase-js@2.119.2';

const EMEL_SAH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ASAL_DIBENARKAN = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);

function pengepalaCors(asal: string | null): Record<string, string> {
  const benarkan = ASAL_DIBENARKAN.length === 0
    ? '*'
    : (asal && ASAL_DIBENARKAN.includes(asal) ? asal : ASAL_DIBENARKAN[0]);
  return {
    'Access-Control-Allow-Origin': benarkan,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(data: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const url = Deno.env.get('SUPABASE_URL') ?? '';
const kunciAnon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const kunci = Deno.env.get('MYSMTS_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const pentadbiran = createClient(url, kunci, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

type Konteks = { req: Request; cors: Record<string, string>; badan: Record<string, unknown> };

Deno.serve(async (req) => {
  const cors = pengepalaCors(req.headers.get('Origin'));

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ ralat: 'Kaedah tidak dibenarkan.' }, 405, cors);
  if (!url || !kunci || !kunciAnon) {
    console.error('Konfigurasi fungsi tidak lengkap: SUPABASE_URL, SUPABASE_ANON_KEY atau kunci rahsia tiada.');
    return json({ ralat: 'Ralat konfigurasi pelayan.' }, 500, cors);
  }

  let badan: Record<string, unknown>;
  try {
    const b = await req.json();
    if (!b || typeof b !== 'object') throw new Error();
    badan = b as Record<string, unknown>;
  } catch {
    return json({ ralat: 'Permintaan tidak sah.' }, 400, cors);
  }

  try {
    const k: Konteks = { req, cors, badan };
    switch (badan.tindakan) {
      case 'log-masuk-sekolah': return await logMasukSekolah(k);
      case 'tetap-kata-laluan': return await tetapKataLaluan(k);
      default: return json({ ralat: 'Tindakan tidak diketahui.' }, 400, cors);
    }
  } catch (e) {
    console.error('Ralat fungsi:', e);
    return json({ ralat: 'Ralat pelayan. Cuba sebentar lagi.' }, 500, cors);
  }
});

function normalEmel(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

function ipPemanggil(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  return (xff ? xff.split(',')[0].trim() : req.headers.get('x-real-ip')) || null;
}

async function catatAudit(baris: {
  pelaku: string | null; emel: string; tindakan: string; data_baru: Record<string, unknown>;
}): Promise<void> {
  const { error } = await pentadbiran.from('log_audit').insert({ ...baris, jadual: 'auth' });
  if (error) throw error;
}

// ---------------------------------------------------------------------
// 1. Log masuk sekolah (emel sahaja)
// ---------------------------------------------------------------------

async function logMasukSekolah({ req, cors, badan }: Konteks): Promise<Response> {
  const emel = normalEmel(badan.emel);
  if (emel.length > 254 || !EMEL_SAH.test(emel)) {
    return json({ ok: false, sebab: 'format' }, 200, cors);
  }

  const { data: sekolah, error } = await pentadbiran
    .from('sekolah').select('id,nama').eq('emel', emel).eq('aktif', true).maybeSingle();
  if (error) throw error;
  if (!sekolah) return json({ ok: false, sebab: 'tidak-berdaftar' }, 200, cors);

  const pengguna = await pastikanAkaun(emel);

  const { data: pautan, error: ralatPautan } = await pentadbiran.auth.admin.generateLink({
    type: 'magiclink',
    email: emel,
  });
  if (ralatPautan) throw ralatPautan;
  const tokenHash = pautan?.properties?.hashed_token;
  if (!tokenHash) throw new Error('Token log masuk tidak dijana.');

  await catatAudit({
    pelaku: pengguna,
    emel,
    tindakan: 'LOG MASUK',
    data_baru: {
      sekolah_id: sekolah.id,
      sekolah: sekolah.nama,
      ip: ipPemanggil(req),
      pelayar: (req.headers.get('user-agent') ?? '').slice(0, 300) || null,
    },
  });

  return json({ ok: true, token_hash: tokenHash }, 200, cors);
}

// ---------------------------------------------------------------------
// 2. Pentadbir menetapkan kata laluan pentadbir
// ---------------------------------------------------------------------

function semakKekuatan(k: string): string {
  if (k.length < 12) return 'Kata laluan mesti sekurang-kurangnya 12 aksara.';
  if (k.length > 72) return 'Kata laluan terlalu panjang (maksimum 72 aksara).';
  if (!/[a-z]/.test(k) || !/[A-Z]/.test(k) || !/\d/.test(k)) {
    return 'Kata laluan mesti mengandungi huruf besar, huruf kecil dan nombor.';
  }
  return '';
}

async function tetapKataLaluan({ req, cors, badan }: Konteks): Promise<Response> {
  const kebenaran = req.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+/.test(kebenaran)) return json({ ralat: 'Sila log masuk semula.' }, 401, cors);

  // Peranan pemanggil ditentukan oleh pangkalan data (sesi kata laluan +
  // pentadbir aktif), bukan oleh fungsi ini.
  const klienPemanggil = createClient(url, kunciAnon, {
    global: { headers: { Authorization: kebenaran } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: profil, error: ralatProfil } = await klienPemanggil.rpc('profil_saya');
  if (ralatProfil || profil?.peranan !== 'admin') {
    return json({ ralat: 'Hanya pentadbir boleh menetapkan kata laluan.' }, 403, cors);
  }

  const sasaran = normalEmel(badan.emel);
  const kataLaluan = String(badan.kata_laluan ?? '');
  if (!EMEL_SAH.test(sasaran)) return json({ ralat: 'Format emel tidak sah.' }, 400, cors);
  const masalah = semakKekuatan(kataLaluan);
  if (masalah) return json({ ralat: masalah }, 400, cors);

  const { data: pentadbir, error } = await pentadbiran
    .from('pentadbir').select('emel').eq('emel', sasaran).maybeSingle();
  if (error) throw error;
  if (!pentadbir) return json({ ralat: 'Emel ini bukan pentadbir berdaftar.' }, 400, cors);

  const id = await pastikanAkaun(sasaran);
  const { error: ralatKemaskini } = await pentadbiran.auth.admin.updateUserById(id, { password: kataLaluan });
  if (ralatKemaskini) {
    if (ralatKemaskini.code === 'weak_password') {
      return json({ ralat: 'Kata laluan terlalu lemah atau pernah bocor. Pilih kata laluan lain.' }, 400, cors);
    }
    throw ralatKemaskini;
  }

  await catatAudit({
    pelaku: profil.id ?? null,
    emel: profil.emel ?? '',
    tindakan: 'TETAP KATA LALUAN',
    data_baru: { sasaran, ip: ipPemanggil(req) },
  });

  return json({ ok: true }, 200, cors);
}

// ---------------------------------------------------------------------
// Akaun pengesahan
// ---------------------------------------------------------------------

/**
 * Pastikan wujud SATU akaun pengesahan untuk emel ini yang disediakan oleh
 * sistem (bendera app_metadata.mysmts = 'disediakan', emel disahkan).
 * Akaun sedia ada tanpa bendera (cth. didaftar sendiri oleh pihak lain)
 * dipadam dan dicipta semula supaya kata laluan atau sesi pihak lain tidak
 * terwaris. Memulangkan id akaun.
 */
async function pastikanAkaun(emel: string): Promise<string> {
  const cari = async () => {
    const { data, error } = await pentadbiran
      .rpc('mysmts_akaun_ikut_emel', { p_emel: emel })
      .maybeSingle<{ id: string; disediakan: boolean }>();
    if (error) throw error;
    return data;
  };

  const sedia = await cari();
  if (sedia?.disediakan) return sedia.id;

  if (sedia) {
    const { error } = await pentadbiran.auth.admin.deleteUser(sedia.id);
    if (error) throw error;
    console.warn('Akaun tidak disediakan oleh sistem telah dipadam dan dicipta semula:', sedia.id);
  }

  const { data, error } = await pentadbiran.auth.admin.createUser({
    email: emel,
    email_confirm: true,
    app_metadata: { mysmts: 'disediakan' },
  });
  if (data?.user?.id) return data.user.id;

  // Permintaan serentak mungkin telah mencipta akaun yang sama.
  if (error && (error.code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message))) {
    const semula = await cari();
    if (semula?.disediakan) return semula.id;
  }
  throw error ?? new Error('Akaun tidak dapat disediakan.');
}
