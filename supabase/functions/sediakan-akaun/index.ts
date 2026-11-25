// MySMTS — Fungsi Edge "sediakan-akaun"
//
// Pendaftaran awam Supabase dimatikan. Fungsi ini mencipta akaun pengesahan
// (tanpa kata laluan) hanya untuk emel yang telah didaftarkan oleh pentadbir
// dalam jadual public.sekolah atau public.pentadbir dan masih aktif.
// Ia dipanggil oleh halaman log masuk sebelum menghantar kod OTP atau
// pautan tetapan kata laluan. Respons sentiasa generik supaya senarai emel
// berdaftar tidak boleh diteka.
//
// Pembolehubah persekitaran:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (disediakan automatik oleh Supabase)
//   MYSMTS_SECRET_KEY   (pilihan: kunci rahsia baharu "sb_secret_..." jika
//                        kunci service_role lama telah dimatikan)
//   ALLOWED_ORIGINS     (pilihan: senarai asal dibenarkan, dipisah koma,
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
const kunci = Deno.env.get('MYSMTS_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const pentadbiran = createClient(url, kunci, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

Deno.serve(async (req) => {
  const cors = pengepalaCors(req.headers.get('Origin'));

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json({ ralat: 'Kaedah tidak dibenarkan.' }, 405, cors);
  if (!url || !kunci) {
    console.error('Konfigurasi fungsi tidak lengkap: SUPABASE_URL atau kunci rahsia tiada.');
    return json({ ralat: 'Ralat konfigurasi pelayan.' }, 500, cors);
  }

  let emel = '';
  try {
    const badan = await req.json();
    emel = String(badan?.emel ?? '').trim().toLowerCase();
  } catch {
    return json({ ralat: 'Permintaan tidak sah.' }, 400, cors);
  }
  if (emel.length > 254 || !EMEL_SAH.test(emel)) {
    return json({ ralat: 'Format emel tidak sah.' }, 400, cors);
  }

  const [sekolah, pentadbir] = await Promise.all([
    pentadbiran.from('sekolah').select('id').eq('emel', emel).eq('aktif', true).maybeSingle(),
    pentadbiran.from('pentadbir').select('emel').eq('emel', emel).eq('aktif', true).maybeSingle(),
  ]);
  if (sekolah.error || pentadbir.error) {
    console.error('Semakan senarai emel gagal:', sekolah.error ?? pentadbir.error);
    return json({ ralat: 'Ralat pelayan.' }, 500, cors);
  }

  if (sekolah.data || pentadbir.data) {
    try {
      await pastikanAkaun(emel);
    } catch (e) {
      console.error('Gagal menyediakan akaun:', e);
      return json({ ralat: 'Ralat pelayan.' }, 500, cors);
    }
  }

  return json({ ok: true }, 200, cors);
});

/**
 * Pastikan wujud SATU akaun pengesahan untuk emel ini yang disediakan oleh
 * fungsi ini (bendera app_metadata.mysmts = 'disediakan', emel disahkan,
 * tanpa kata laluan). Akaun sedia ada yang tidak disediakan oleh fungsi ini
 * (cth. didaftar sendiri oleh pihak lain dengan kata laluan mereka) dipadam
 * dan dicipta semula supaya kata laluan atau sesi pihak lain tidak terwaris.
 */
async function pastikanAkaun(emel: string): Promise<void> {
  const { data: sedia, error: ralatCari } = await pentadbiran
    .rpc('mysmts_akaun_ikut_emel', { p_emel: emel })
    .maybeSingle<{ id: string; disediakan: boolean }>();
  if (ralatCari) throw ralatCari;

  if (sedia?.disediakan) return;

  if (sedia && !sedia.disediakan) {
    const { error } = await pentadbiran.auth.admin.deleteUser(sedia.id);
    if (error) throw error;
    console.warn('Akaun tidak disediakan oleh sistem telah dipadam dan dicipta semula:', sedia.id);
  }

  const { error } = await pentadbiran.auth.admin.createUser({
    email: emel,
    email_confirm: true,
    app_metadata: { mysmts: 'disediakan' },
  });
  // Permintaan serentak mungkin telah mencipta akaun yang sama.
  if (error && !(error.code === 'email_exists' || /already (been )?registered|already exists/i.test(error.message))) {
    throw error;
  }
}
