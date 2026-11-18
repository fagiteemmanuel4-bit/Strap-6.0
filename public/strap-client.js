/* Strap – browser client for the real backend.
   - StrapAPI.get/post/put : talks to /api/* (cookie session, CSRF header)
   - StrapAPI.boot(scripts): dashboard start-up – loads your account + data from the server, then starts the app
   - automatic sync: every save the dashboard makes to its local data is sent to the server (and pictures are uploaded) */
(function () {
  'use strict';
  const ls = window.localStorage, rawSet = ls.setItem.bind(ls), rawRemove = ls.removeItem.bind(ls);
  const SYNC = k => k === 'strap.v1' || k === 'strap.f1' || /^strap\.f1\.items\.[A-Za-z0-9_-]{1,40}$/.test(k);
  const V = {}, dirty = new Set(), imgCache = new Map(); let timer = null, busy = false, booted = false;

  async function call(method, path, body) {
    let r, j;
    try {
      r = await fetch(path, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Strap': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
      j = await r.json().catch(() => ({}));
    } catch (e) { return { ok: false, offline: true, msg: 'No internet connection. Check your network and try again.' }; }
    if (r.status === 401 && j.code === 'auth' && booted) { toastMsg('Your session ended. Please sign in again.'); setTimeout(() => { location.href = 'index.html'; }, 1200); }
    if (j.ok === undefined) j.ok = r.ok;
    j.status = r.status; return j;
  }
  const API = { get: p => call('GET', p), post: (p, b) => call('POST', p, b || {}), put: (p, b) => call('PUT', p, b || {}) };

  function toastMsg(m) { const t = document.getElementById('toast'); if (!t) return; t.textContent = m; t.classList.add('on'); clearTimeout(toastMsg.id); toastMsg.id = setTimeout(() => t.classList.remove('on'), 3200); }
  function banner(text, action) {
    let b = document.getElementById('strap-banner');
    if (!b) { b = document.createElement('button'); b.id = 'strap-banner'; b.type = 'button'; b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(88px + env(safe-area-inset-bottom,0px));z-index:9999;background:#0a0a0a;color:#e6f53a;border:0;border-radius:16px;padding:14px 16px;font:600 14px Sora,system-ui,sans-serif;text-align:left;box-shadow:0 8px 30px rgba(0,0,0,.25)'; document.body.appendChild(b); }
    b.textContent = text; b.onclick = action;
  }

  /* ---------- pictures: data URLs are uploaded once and replaced with a link ---------- */
  async function shrink(dataUrl) {
    if (dataUrl.length < 900000 && /^data:image\/(jpeg|webp|png|gif)/.test(dataUrl)) return dataUrl;
    return new Promise(res => {
      const im = new Image(); im.onload = () => { const s = Math.min(1, 1280 / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * s); c.height = Math.round(im.height * s); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .82)); };
      im.onerror = () => res(null); im.src = dataUrl;
    });
  }
  async function uploadImage(du) {
    if (imgCache.has(du)) return imgCache.get(du);
    const small = await shrink(du); if (!small) return null;
    const r = await API.post('/api/media', { dataUrl: small });
    const url = r.ok ? r.url : null; if (url) imgCache.set(du, url); return url;
  }
  async function externalize(v) {
    if (typeof v === 'string') {
      if (v.length > 2000 && v.startsWith('data:image/')) return (await uploadImage(v)) || '';
      if (v.length > 2000 && v.startsWith('data:')) return '';       // videos / files can't be stored in the data document
      return v;
    }
    if (Array.isArray(v)) { const o = []; for (const x of v) o.push(await externalize(x)); return o; }
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = await externalize(v[k]); return o; }
    return v;
  }

  /* ---------- sync every save to the server ---------- */
  function markDirty(k) { dirty.add(k); rawSet('strap.sync.dirty', JSON.stringify([...dirty])); clearTimeout(timer); timer = setTimeout(flush, 900); }
  async function flush() {
    if (busy || !booted) return; busy = true; let again = false;
    try {
      for (const k of [...dirty]) {
        let raw = ls.getItem(k); if (raw === null) { dirty.delete(k); continue; }
        let val; try { val = JSON.parse(raw); } catch (e) { dirty.delete(k); continue; }
        const clean = await externalize(val), r = await API.put('/api/state', { key: k, value: clean, base: V[k] || 0 });
        if (r.offline) { again = true; break; }
        if (r.ok) {
          V[k] = r.version; dirty.delete(k);
          if (r.merged) banner('Your data was updated on another device. Tap to refresh.', () => location.reload());
          if (/^strap\.f1\.items\./.test(k)) publishCatalogSoon();
        } else if (r.status === 402) { dirty.delete(k); toastMsg(r.msg || 'You have reached your plan limit.'); }
        else if (r.status === 403 && r.code === 'suspended') { dirty.delete(k); }
        else if (r.status === 401) { break; }
        else { toastMsg(r.msg || 'Could not save. We will retry.'); again = true; }
      }
    } finally { busy = false; rawSet('strap.sync.dirty', JSON.stringify([...dirty])); if (again || dirty.size) { clearTimeout(timer); timer = setTimeout(flush, again ? 15000 : 400); } }
  }
  ls.setItem = function (k, v) { rawSet(k, v); if (booted && SYNC(k)) markDirty(k); };
  window.addEventListener('online', () => { if (dirty.size) flush(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty.size) flush(); else if (document.visibilityState === 'visible') checkRemote(); });
  setInterval(() => { if (document.visibilityState === 'visible') checkRemote(); }, 45000);
  async function checkRemote() {
    if (!booted || dirty.size || busy) return; const r = await API.get('/api/state/versions'); if (!r.ok) return;
    if (Object.keys(r.versions).some(k => (r.versions[k] || 0) > (V[k] || 0))) banner('New data from another device. Tap to refresh.', () => location.reload());
  }
  let cat = null; function publishCatalogSoon() { clearTimeout(cat); cat = setTimeout(async () => { try { if (window.StrapStore && StrapStore.online() && window.StrapFeatures) await API.post('/api/store/catalog', { products: await externalize(StrapFeatures.items() || []) }); } catch (e) {} }, 1500); }

  /* ---------- dashboard start-up ---------- */
  async function boot(scripts) {
    const r = await API.get('/api/bootstrap');
    if (!r.ok) {
      if (r.status === 401) return location.replace('index.html');
      document.body.insertAdjacentHTML('beforeend', '<p style="font:600 15px Sora,system-ui;text-align:center;margin:40vh 24px 0">We couldn’t load your account. Check your connection and refresh.</p>'); return;
    }
    let keep = []; try { keep = JSON.parse(ls.getItem('strap.sync.dirty') || '[]'); } catch (e) {}
    const kept = {}; keep.forEach(k => { const x = ls.getItem(k); if (x !== null) kept[k] = x; });
    Object.keys(ls).filter(k => k.startsWith('strap')).forEach(k => rawRemove(k));      // never let one account's data leak into another on a shared browser
    try { sessionStorage.removeItem('strap.session'); } catch (e) {}
    Object.keys(r.state).forEach(k => { V[k] = r.state[k].version; rawSet(k, JSON.stringify(r.state[k].value)); });
    const f1 = r.state['strap.f1'] ? r.state['strap.f1'].value : {};     // server-owned fields, injected on every start
    f1.plan = r.plan.plan; f1.account = { status: r.account.status, ticket: r.account.ticket || '', at: Date.now() }; f1.twofa = { on: !!r.twofa.on, secret: '' };
    rawSet('strap.f1', JSON.stringify(f1));
    const v1 = r.state['strap.v1'] ? r.state['strap.v1'].value : {}; if (r.hasPin) v1.pin = { salt: '', hash: 'server' }; rawSet('strap.v1', JSON.stringify(v1));
    if (r.plan.plan === 'premium') rawSet('strap.plan', JSON.stringify({ status: 'active', currency: r.plan.currency || 'NGN', renewsOn: (r.plan.periodEnd || '').slice(0, 10), autoRenew: r.plan.autoRenew, cancelAtPeriodEnd: r.plan.cancelAtPeriodEnd, card: r.plan.card }));
    Object.keys(kept).forEach(k => { rawSet(k, kept[k]); dirty.add(k); });
    try { sessionStorage.setItem('strap.session', JSON.stringify(r.session)); } catch (e) {}
    window.__STRAP = r; booted = true;
    for (const src of scripts) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.async = false; s.onload = ok; s.onerror = () => { console.error('Could not load ' + src); ok(); }; document.body.appendChild(s); });
    if (dirty.size) flush();
    const q = new URLSearchParams(location.search); if (q.get('pay') === 'success') toastMsg('Premium is active. Thank you!');
  }
  function reset() { Object.keys(ls).filter(k => k.startsWith('strap')).forEach(k => rawRemove(k)); try { sessionStorage.clear(); } catch (e) {} }

  window.StrapAPI = { ...API, boot, reset, flush, toast: toastMsg, externalize, publishCatalogSoon, markReady() { booted = true; } };
})();
