const STORAGE_KEY = 'ppd_limbang_visit_records_v1';
let records = readRecords();
let formImages = { gambarDapatan: [], gambarMaklumbalas: [] };

function readRecords() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch (error) { console.error('Rekod tidak dapat dibaca:', error); return []; }
}
function saveRecords() { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function dateMs(value) { if (!value) return '-'; const [y,m,d] = value.split('-'); return `${Number(d)} ${['Januari','Februari','Mac','April','Mei','Jun','Julai','Ogos','September','Oktober','November','Disember'][Number(m)-1] || ''} ${y}`; }
function initList() {
  const container = document.getElementById('recordsContainer'); if (!container) return;
  const render = () => {
    const query = document.getElementById('searchInput').value.trim().toLowerCase();
    const status = document.getElementById('filterStatus').value;
    const found = records.filter(r => (status === 'SEMUA' || r.status === status) && [r.namaSekolah,r.namaPegawai,r.jawatan,r.dapatan,r.maklumbalas].some(v => String(v || '').toLowerCase().includes(query)));
    document.getElementById('statTotal').textContent = records.length;
    document.getElementById('statPending').textContent = records.filter(r => r.status === 'Menunggu Maklumbalas').length;
    document.getElementById('statDone').textContent = records.filter(r => r.status === 'Selesai').length;
    document.getElementById('emptyState').classList.toggle('hidden', found.length > 0);
    container.innerHTML = found.sort((a,b) => String(b.tarikh).localeCompare(String(a.tarikh))).map(r => `<article class="rounded-xl bg-white p-5 shadow-sm"><div class="flex flex-wrap items-start justify-between gap-2"><div><p class="text-xs text-slate-500">${dateMs(r.tarikh)} · ${esc(r.masa)}</p><h2 class="text-lg font-bold">${esc(r.namaSekolah)}</h2><p class="text-sm">${esc(r.namaPegawai)} · ${esc(r.jawatan)}</p></div><span class="rounded-full bg-blue-100 px-3 py-1 text-xs font-bold">${esc(r.status)}</span></div><h3 class="mt-3 text-sm font-bold">Dapatan</h3><p class="whitespace-pre-line text-sm">${esc(r.dapatan)}</p><h3 class="mt-3 text-sm font-bold">Maklumbalas</h3><p class="whitespace-pre-line text-sm">${esc(r.maklumbalas || 'Belum ada maklumbalas.')}</p><div class="mt-4 flex gap-2 border-t pt-3"><a class="rounded border px-3 py-1 text-sm" href="borang.html?id=${encodeURIComponent(r.id)}">Kemaskini</a><a class="rounded border px-3 py-1 text-sm" href="laporan.html?id=${encodeURIComponent(r.id)}">Cetak</a><button class="rounded border border-red-200 px-3 py-1 text-sm text-red-700" data-delete="${esc(r.id)}">Padam</button></div></article>`).join('');
    container.querySelectorAll('[data-delete]').forEach(btn => btn.addEventListener('click', () => { if (confirm('Padam rekod ini?')) { records = records.filter(r => r.id !== btn.dataset.delete); saveRecords(); render(); } }));
  };
  document.getElementById('searchInput').addEventListener('input', render); document.getElementById('filterStatus').addEventListener('change', render); render();
}
function compress(file) { return new Promise((resolve,reject) => { const reader = new FileReader(); reader.onerror = reject; reader.onload = () => { const image = new Image(); image.onerror = reject; image.onload = () => { const ratio = Math.min(1,800/image.width); const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width*ratio); canvas.height = Math.round(image.height*ratio); canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height); resolve(canvas.toDataURL('image/jpeg',0.7)); }; image.src=reader.result; }; reader.readAsDataURL(file); }); }
function initForm() {
  const form = document.getElementById('visitForm'); if (!form) return;
  const id = new URLSearchParams(location.search).get('id');
  const existing = records.find(r => r.id === id);
  if (existing) { for (const key of ['namaSekolah','tarikh','masa','namaPegawai','jawatan','status','dapatan','maklumbalas']) document.getElementById(key).value = existing[key] || ''; formImages.gambarDapatan = [...(existing.gambarDapatan || [])]; formImages.gambarMaklumbalas = [...(existing.gambarMaklumbalas || [])]; document.querySelector('h1').textContent = 'Kemaskini Rekod Lawatan'; }
  else { const now = new Date(); document.getElementById('tarikh').value = new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10); }
  for (const key of Object.keys(formImages)) { const input = document.getElementById(key); const preview = document.getElementById(key+'Preview'); const draw = () => preview.innerHTML = formImages[key].map((src,i) => `<img alt="Lampiran ${i+1}" class="h-16 w-16 rounded object-cover" src="${src}">`).join(''); draw(); input.addEventListener('change', async () => { for (const file of input.files) { try { formImages[key].push(await compress(file)); } catch { alert('Gambar gagal diproses.'); } } draw(); input.value=''; }); }
  form.addEventListener('submit', e => { e.preventDefault(); const value = Object.fromEntries(['namaSekolah','tarikh','masa','namaPegawai','jawatan','status','dapatan','maklumbalas'].map(key => [key,document.getElementById(key).value.trim()])); const rec = {...(existing || {}), ...value, id: existing?.id || 'REC-'+Date.now(), gambarDapatan: formImages.gambarDapatan, gambarMaklumbalas: formImages.gambarMaklumbalas, createdAt: existing?.createdAt || new Date().toISOString()}; if (existing) records = records.map(r => r.id === id ? rec : r); else records.unshift(rec); try { saveRecords(); location.href='index.html'; } catch { alert('Storan pelayar penuh. Kurangkan gambar dan cuba semula.'); } });
}
function initReports() {
  const list = document.getElementById('reportList'); if (!list) return;
  const id = new URLSearchParams(location.search).get('id'); const printRec = document.getElementById('printRecord');
  if (id) { const r = records.find(x => x.id === id); if (r) { list.classList.add('hidden'); document.getElementById('reportEmpty').classList.add('hidden'); printRec.classList.remove('hidden'); document.getElementById('printSekolah').textContent=r.namaSekolah; document.getElementById('printTarikh').textContent=`${dateMs(r.tarikh)} · ${r.masa || '-'}`; document.getElementById('printPegawai').textContent=r.namaPegawai; document.getElementById('printJawatan').textContent=r.jawatan; document.getElementById('printStatus').textContent=r.status; document.getElementById('printDapatan').textContent=r.dapatan; document.getElementById('printMaklumbalas').textContent=r.maklumbalas || 'Belum ada maklumbalas.'; document.getElementById('printImages').innerHTML=[...(r.gambarDapatan||[]),...(r.gambarMaklumbalas||[])].map(src=>`<img class="max-h-32 rounded border object-contain" src="${src}" alt="Lampiran rekod">`).join(''); document.getElementById('printButton').onclick=()=>window.print(); } }
  else { document.getElementById('reportEmpty').classList.toggle('hidden',records.length>0); list.innerHTML=records.map(r=>`<article class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm"><div><strong>${esc(r.namaSekolah)}</strong><p class="text-sm text-slate-500">${dateMs(r.tarikh)} · ${esc(r.status)}</p></div><a class="rounded bg-blue-900 px-3 py-2 text-sm font-semibold text-white" href="laporan.html?id=${encodeURIComponent(r.id)}">Buka cetakan</a></article>`).join(''); }
  const exportBtn=document.getElementById('exportCsv'); if(exportBtn) exportBtn.onclick=()=>{ if(!records.length){alert('Tiada rekod untuk dieksport.');return;} const headers=['ID Rekod','Nama Sekolah','Tarikh','Masa','Pegawai','Jawatan','Dapatan','Maklumbalas','Status']; const cell=v=>{let s=String(v??'').replace(/[\r\n]+/g,' ').replace(/"/g,'""'); if(/^[=+\-@]/.test(s))s="'"+s; return `"${s}"`;}; const csv='\uFEFF'+[headers.map(cell).join(','),...records.map(r=>[r.id,r.namaSekolah,r.tarikh,r.masa,r.namaPegawai,r.jawatan,r.dapatan,r.maklumbalas,r.status].map(cell).join(','))].join('\r\n'); const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); a.download='PPD_Limbang_Rekod.csv'; a.click(); URL.revokeObjectURL(a.href); };
}
document.addEventListener('DOMContentLoaded',()=>{initList();initForm();initReports();});
