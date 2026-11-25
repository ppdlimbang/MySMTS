// Klien Supabase PALSU (dalam memori) untuk ujian antara muka sahaja.
// Menggantikan vendor/supabase.js semasa ujian pelayar. Ia tidak menguji
// keselamatan (itu diuji oleh tests/keselamatan-db.test.mjs) tetapi
// memastikan aliran UI berfungsi tanpa ralat JavaScript.
(() => {
  const SIMPAN = 'palsu-keadaan';
  const simpanan = JSON.parse(sessionStorage.getItem(SIMPAN) || 'null');
  const P = (window.__PALSU = {
    // Log panggilan kekal merentas halaman (log masuk -> app.html).
    panggilan: JSON.parse(sessionStorage.getItem("palsu-panggilan") || "[]"),
    sesi: simpanan?.sesi ?? null,
    profil: simpanan?.profil ?? null,
    pendengar: [],
    db: {
      sekolah: [
        { id: 's1', nama: 'SK Limbang', kod: 'YBA0001', emel: 'yba0001@moe.edu.my', aktif: true, dicipta_pada: '2026-11-01T00:00:00Z' },
        { id: 's2', nama: 'SK Kubong', kod: null, emel: null, aktif: true, dicipta_pada: '2026-11-01T00:00:00Z' },
      ],
      pentadbir: [
        { emel: 'pentadbir@moe.gov.my', nama: 'Pentadbir Utama', aktif: true, dicipta_pada: '2026-11-01T00:00:00Z' },
      ],
      rekod_lawatan: [
        {
          id: 'r1', sekolah_id: 's1', tarikh: '2026-11-20', masa: '09:30:00', nama_pegawai: 'En. Ali <b>bin</b> Abu',
          jawatan: 'SISC+', dapatan: 'Dapatan <script>alert(1)</script>', maklumbalas: null,
          status: 'Menunggu Maklumbalas', dicipta_pada: '2026-11-20T01:00:00Z', dikemaskini_pada: '2026-11-20T01:00:00Z', maklumbalas_pada: null,
        },
      ],
      lampiran: [
        { id: 'l1', rekod_id: 'r1', jenis: 'dapatan', laluan: 'r1/dapatan/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg', dimuat_naik_oleh: 'u-admin', dicipta_pada: '2026-11-20T01:00:00Z' },
      ],
      log_audit: [
        { id: 1, pada: '2026-11-20T01:00:00Z', emel: 'pentadbir@moe.gov.my', jadual: 'rekod_lawatan', tindakan: 'UPDATE',
          data_lama: { sekolah_id: 's1', tarikh: '2026-11-20', status: 'Menunggu Maklumbalas' },
          data_baru: { sekolah_id: 's1', tarikh: '2026-11-20', status: 'Selesai' } },
      ],
    },
  });

  const simpan = () => sessionStorage.setItem(SIMPAN, JSON.stringify({ sesi: P.sesi, profil: P.profil }));
  const catat = (x) => {
    P.panggilan.push(x);
    sessionStorage.setItem("palsu-panggilan", JSON.stringify(P.panggilan));
  };
  const uuid = () => crypto.randomUUID();
  const GAMBAR = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22/%3E';

  const PROFIL = {
    'pentadbir@moe.gov.my': { id: 'u-admin', emel: 'pentadbir@moe.gov.my', peranan: 'admin', admin_perlu_kata_laluan: false, nama: 'Pentadbir Utama', sekolah: null },
    'yba0001@moe.edu.my': { id: 'u-s1', emel: 'yba0001@moe.edu.my', peranan: 'sekolah', admin_perlu_kata_laluan: false, nama: null, sekolah: { id: 's1', nama: 'SK Limbang', kod: 'YBA0001' } },
  };

  function lanjut(jadual, r) {
    if (jadual !== 'rekod_lawatan') return { ...r };
    const s = P.db.sekolah.find((x) => x.id === r.sekolah_id);
    return {
      ...r,
      sekolah: s ? { id: s.id, nama: s.nama, kod: s.kod } : null,
      lampiran: P.db.lampiran.filter((l) => l.rekod_id === r.id).map((l) => ({ ...l })),
    };
  }

  class Pembina {
    constructor(jadual) {
      this.jadual = jadual;
      this.op = 'select';
      this.penapis = [];
      this.opsyen = {};
    }
    select(_lajur, opsyen) { if (this.op === 'select' && opsyen) this.opsyen = opsyen; return this; }
    insert(v) { this.op = 'insert'; this.nilai = v; return this; }
    update(v) { this.op = 'update'; this.nilai = v; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(k, v) { this.penapis.push((r) => r[k] === v); return this; }
    gte(k, v) { this.penapis.push((r) => r[k] >= v); return this; }
    lte(k, v) { this.penapis.push((r) => r[k] <= v); return this; }
    or(s) { this.atau = s; return this; }
    order() { return this; }
    range(a, b) { this.julat = [a, b]; return this; }
    single() { this.satu = true; return this; }
    maybeSingle() { this.satu = true; return this; }
    then(ok, gagal) { return Promise.resolve().then(() => this.laksana()).then(ok, gagal); }
    laksana() {
      catat({ jenis: 'db', jadual: this.jadual, op: this.op, nilai: this.nilai, atau: this.atau });
      const baris = P.db[this.jadual];
      const padan = baris.filter((r) => this.penapis.every((f) => f(r)));
      if (this.op === 'select') {
        if (this.opsyen.head) return { data: null, count: padan.length, error: null };
        let d = padan.map((r) => lanjut(this.jadual, r));
        if (this.julat) d = d.slice(this.julat[0], this.julat[1] + 1);
        return { data: this.satu ? (d[0] ?? null) : d, count: padan.length, error: null, status: 200 };
      }
      if (this.op === 'insert') {
        const nilai = Array.isArray(this.nilai) ? this.nilai : [this.nilai];
        if (this.jadual === 'sekolah' && nilai.some((n) => baris.some((b) => b.nama === n.nama))) {
          return { data: null, error: { code: '23505', message: 'duplicate key value' } };
        }
        const baru = nilai.map((n) => ({ id: uuid(), dicipta_pada: new Date().toISOString(), ...n }));
        baris.push(...baru);
        return { data: this.satu ? baru[0] : baru, error: null };
      }
      if (this.op === 'update') {
        padan.forEach((r) => Object.assign(r, this.nilai));
        return { data: padan.map((r) => ({ ...r })), error: null };
      }
      if (this.op === 'delete') {
        if (this.jadual === 'sekolah' && padan.some((s) => P.db.rekod_lawatan.some((r) => r.sekolah_id === s.id))) {
          return { data: null, error: { code: '23503', message: 'foreign key violation' } };
        }
        P.db[this.jadual] = baris.filter((r) => !padan.includes(r));
        if (this.jadual === 'rekod_lawatan') {
          P.db.lampiran = P.db.lampiran.filter((l) => !padan.some((r) => r.id === l.rekod_id));
        }
        return { data: padan.map((r) => ({ ...r })), error: null };
      }
      return { data: null, error: { message: 'op tidak disokong' } };
    }
  }

  function tetapSesi(emel, kaedah) {
    P.sesi = { access_token: 'palsu', user: { id: PROFIL[emel]?.id || 'u-x', email: emel }, kaedah };
    P.profil = PROFIL[emel] ? { ...PROFIL[emel] } : { id: 'u-x', emel, peranan: null, admin_perlu_kata_laluan: false, nama: null, sekolah: null };
    if (emel === 'pentadbir@moe.gov.my' && kaedah !== 'password') {
      P.profil.peranan = null;
      P.profil.admin_perlu_kata_laluan = true;
    }
    simpan();
  }

  const klien = {
    auth: {
      async getSession() { return { data: { session: P.sesi }, error: null }; },
      onAuthStateChange(cb) { P.pendengar.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async signOut() {
        catat({ jenis: 'auth', op: 'signOut' });
        P.sesi = null; P.profil = null; simpan();
        P.pendengar.forEach((cb) => cb('SIGNED_OUT', null));
        return { error: null };
      },
      async verifyOtp({ token_hash, type }) {
        catat({ jenis: 'auth', op: 'verifyOtp', token_hash, type });
        const emel = String(token_hash || '').replace(/^hash:/, '');
        if (!PROFIL[emel]) return { data: null, error: { code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' } };
        tetapSesi(emel, 'otp');
        return { data: { session: P.sesi }, error: null };
      },
      async signInWithPassword({ email, password }) {
        catat({ jenis: 'auth', op: 'signInWithPassword', email });
        if (password !== 'KataLaluan123') return { data: null, error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } };
        tetapSesi(email, 'password');
        return { data: { session: P.sesi }, error: null };
      },
    },
    from: (jadual) => new Pembina(jadual),
    async rpc(nama, arg) {
      catat({ jenis: 'rpc', nama, arg });
      if (nama === 'profil_saya') return { data: P.profil, error: null };
      if (nama === 'hantar_maklumbalas') {
        const r = P.db.rekod_lawatan.find((x) => x.id === arg.p_rekod_id);
        if (!r) return { data: null, error: { code: 'P0001', message: 'Rekod tidak dijumpai.' } };
        r.maklumbalas = arg.p_maklumbalas;
        r.status = arg.p_status;
        r.maklumbalas_pada = new Date().toISOString();
        return { data: null, error: null };
      }
      return { data: null, error: { message: 'rpc tidak diketahui' } };
    },
    storage: {
      from: () => ({
        async createSignedUrls(laluan) { return { data: laluan.map((p) => ({ path: p, signedUrl: GAMBAR, error: null })), error: null }; },
        async upload(laluan, blob, opsyen) { catat({ jenis: 'storage', op: 'upload', laluan, saiz: blob.size, opsyen }); return { data: { path: laluan }, error: null }; },
        async remove(laluan) { catat({ jenis: 'storage', op: 'remove', laluan }); return { data: [], error: null }; },
      }),
    },
    functions: {
      // Meniru fungsi Edge "sediakan-akaun".
      async invoke(nama, { body }) {
        catat({ jenis: 'fn', nama, body: { ...body, kata_laluan: body.kata_laluan ? '***' : undefined } });
        const gagal = (status, ralat) => ({
          data: null,
          error: { name: 'FunctionsHttpError', context: { json: async () => ({ ralat }) }, status },
        });
        if (body.tindakan === 'log-masuk-sekolah') {
          const sekolah = P.db.sekolah.find((x) => x.emel === body.emel && x.aktif);
          return { data: sekolah ? { ok: true, token_hash: `hash:${body.emel}` } : { ok: false, sebab: 'tidak-berdaftar' }, error: null };
        }
        if (body.tindakan === 'tetap-kata-laluan') {
          if (P.profil?.peranan !== 'admin') return gagal(403, 'Hanya pentadbir boleh menetapkan kata laluan.');
          if (!P.db.pentadbir.some((x) => x.emel === body.emel)) return gagal(400, 'Emel ini bukan pentadbir berdaftar.');
          P.kataLaluan = { ...(P.kataLaluan || {}), [body.emel]: body.kata_laluan };
          return { data: { ok: true }, error: null };
        }
        return gagal(400, 'Tindakan tidak diketahui.');
      },
    },
  };

  window.supabase = { createClient: () => klien };
})();
