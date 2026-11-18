/* Strap – shared store for sales, held sales, credit book, activity PIN, receipt template and preferences.
   Everything is kept in localStorage for now. Swap the `api` hooks (and the save() call) for real backend calls later. */
window.StrapStore = (() => {
  const KEY = 'strap.v1';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const blank = () => ({
    sales: [], payments: [], held: [], collections: [], credits: [], seq: 0, closed: null, pin: null, lock: { n: 0, until: 0 }, receipt: null, online: null, orders: [], oseq: 1000,
    prefs: { sound: true, vibrate: true, creditReminders: true, orderAlerts: true, lowStock: true }
  });
  let S = blank();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    S = Object.assign(blank(), raw); S.prefs = Object.assign(blank().prefs, raw.prefs || {});
  } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

  /* ===== Backend hooks – replace with real calls ===== */
  const A = () => window.StrapAPI;
  const cfgBase = () => (window.STRAP_CONFIG && window.STRAP_CONFIG.BASE_DOMAIN) || 'strap.store';
  const api = {
    DEMO: false, DEMO_CODE: '',
    async sendCode(email, purpose) { const r = await A().post('/api/auth/send-code', { target: email, purpose: purpose || 'pin' }); if (r.devCode) console.info('DEV code:', r.devCode); return r; },
    async verifyCode(email, code, purpose) { return A().post('/api/auth/verify-code', { target: email, code, purpose: purpose || 'pin' }); },
    async savePin(pin) { return A().post('/api/pin/set', { pin }); },
    async verifyPin(pin) { return A().post('/api/pin/verify', { pin }); },
    async changePassword(current, next) {
      if (!window.StrapNeonAuth) return { ok: false, msg: 'Authentication is still loading. Try again.' };
      const { error } = await window.StrapNeonAuth.changePassword({ currentPassword: current, newPassword: next });
      return error ? { ok: false, msg: error.message || 'Could not change your password.' } : { ok: true };
    },
    async scheduleCreditReminder(credit) { return { ok: true }; }, // phase 2: queue an SMS/email for the due date
    // ----- online store -----
    BASE_DOMAIN: cfgBase(),
    async checkSubdomain(name) { const r = await A().get('/api/shop/check?name=' + encodeURIComponent(name)); return r.ok ? r : { ok: true, available: false }; },
    async verifyDomain(host, token) { const r = await A().post('/api/store/domain/verify', { host, token }); return r.ok ? r : { ok: false, verified: false, msg: r.msg }; },
    async publish(config) { const products = await A().externalize((window.StrapFeatures && StrapFeatures.items()) || []); return A().post('/api/store/publish', { config, products }); },
    async createStore(config) { return api.publish(config); },
    async saveStore(config) { return api.publish(config); },
    async orderStatus(p) { return A().post('/api/orders/status', p); },
    async ackOrders(ids) { return A().post('/api/orders/ack', { ids }); },
    async pullOrders() { // new orders placed on the public storefront
      const r = await A().get('/api/orders/pull'); if (!r.ok || !r.orders.length) return [];
      const have = new Set((S.orders || []).map(o => o.id)), fresh = r.orders.filter(o => !have.has(o.id));
      fresh.forEach(o => (o.lines || []).forEach(l => { try { window.StrapFeatures && StrapFeatures.qtyDown(l.id, l.qty); } catch (e) {} }));
      setTimeout(() => api.ackOrders(r.orders.map(o => o.id)), 1500);
      return fresh;
    }
  };

  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const lineCount = s => s.lines.reduce((a, l) => a + l.qty, 0);

  // ---- hashing for the 4-digit PIN (the real check should live on your server) ----
  async function hashPin(pin, salt) {
    const data = new TextEncoder().encode(salt + ':' + pin);
    try { const buf = await crypto.subtle.digest('SHA-256', data); return [...new Uint8Array(buf)].map(b => pad(b.toString(16))).join(''); }
    catch (e) { let h = 5381; for (const c of salt + ':' + pin) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return 'x' + h.toString(16); }
  }

  // product collections – created on the Collections page, chosen when adding a product
  const collections = {
    all: () => S.collections,
    find: name => S.collections.find(c => c.name.toLowerCase() === String(name).trim().toLowerCase()),
    add(name, description = '') {
      const n = String(name).trim().slice(0, 40); if (!n) return null;
      const ex = collections.find(n); if (ex) return ex;
      const c = { id: uid('col'), name: n, description: String(description).trim().slice(0, 80), createdAt: Date.now() };
      S.collections.unshift(c); save(); return c;
    },
    remove(id) { S.collections = S.collections.filter(c => c.id !== id); save(); }
  };

  const credits = {
    balance: c => Math.max(0, Math.round((c.total - c.payments.reduce((a, p) => a + p.amount, 0)) * 100) / 100),
    paid: c => c.payments.reduce((a, p) => a + p.amount, 0),
    open: () => S.credits.filter(c => credits.balance(c) > 0).sort((a, b) => a.due.localeCompare(b.due)),
    settled: () => S.credits.filter(c => credits.balance(c) <= 0).sort((a, b) => b.createdAt - a.createdAt),
    owed: () => S.credits.reduce((a, c) => a + credits.balance(c), 0),
    // days until due: negative = overdue
    daysLeft: c => Math.round((new Date(c.due + 'T00:00:00') - new Date(dayKey() + 'T00:00:00')) / 864e5),
    due: (within = 0) => credits.open().filter(c => credits.daysLeft(c) <= within)
  };

  return {
    api, dayKey, credits, collections, lineCount, prefs: S.prefs,
    get state() { return S; },
    save,
    nextNo() { S.seq++; save(); return 'S-' + pad(S.seq, 4); },

    // ----- sales & money -----
    addSale(sale) { S.sales.unshift(sale); save(); return sale; },
    addPayment(p) { S.payments.push({ id: uid('pay'), ts: Date.now(), ...p }); save(); },
    sales(days = 0) {
      if (!days) return S.sales;
      const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (days - 1));
      return S.sales.filter(s => s.ts >= from.getTime());
    },
    earned(days = 1) {
      const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - (days - 1));
      return S.payments.filter(p => !days || p.ts >= from.getTime()).reduce((a, p) => a + p.amount, 0);
    },
    earnedAll() { return S.payments.reduce((a, p) => a + p.amount, 0); },
    dayStats() {
      const sales = S.sales.filter(s => dayKey(s.ts) === dayKey());
      const creditToday = sales.filter(s => s.method === 'credit');
      return {
        sales, count: sales.length, items: sales.reduce((a, s) => a + lineCount(s), 0),
        earned: S.payments.filter(p => dayKey(p.ts) === dayKey()).reduce((a, p) => a + p.amount, 0),
        creditGiven: creditToday.reduce((a, s) => a + s.total, 0), owedTotal: credits.owed()
      };
    },

    // ----- held sales -----
    addHeld(h) { S.held.unshift({ id: uid('h'), ts: Date.now(), ...h }); save(); },
    removeHeld(id) { S.held = S.held.filter(h => h.id !== id); save(); },

    // ----- credit book -----
    addCredit(c) { S.credits.unshift({ id: uid('c'), createdAt: Date.now(), payments: [], ...c }); save(); api.scheduleCreditReminder(S.credits[0]); return S.credits[0]; },
    payCredit(id, amount) {
      const c = S.credits.find(x => x.id === id); if (!c) return null;
      const amt = Math.min(Math.max(0, +amount || 0), credits.balance(c)); if (!amt) return c;
      c.payments.push({ ts: Date.now(), amount: amt });
      S.payments.push({ id: uid('pay'), ts: Date.now(), amount: amt, saleId: c.saleId, method: 'credit', type: 'credit' });
      save(); return c;
    },

    // ----- closing the day -----
    isClosed() { return !!(S.closed && S.closed.day === dayKey()); },
    closeDay(info) { S.closed = { day: dayKey(), ts: Date.now(), ...info }; save(); },
    reopenDay() { S.closed = null; save(); },

    // ----- activity PIN -----
    hasPin() { return !!(S.pin && S.pin.hash); },
    async setPin(pin) {
      const r = await api.savePin(pin); if (!r.ok) return r;
      S.pin = { salt: '', hash: 'server' }; S.lock = { n: 0, until: 0 }; save(); return { ok: true };
    },
    async checkPin(pin) { const r = await api.verifyPin(pin); return !!r.ok; },
    lockLeft() { return Math.max(0, Math.ceil((S.lock.until - Date.now()) / 1000)); },
    pinFail() { S.lock.n++; if (S.lock.n >= 5) { S.lock = { n: 0, until: Date.now() + 30000 }; } save(); return S.lock.n; },
    pinOk() { S.lock = { n: 0, until: 0 }; save(); },

    // ----- online store (one JSON config) & its orders -----
    online() { return S.online; },
    setOnline(c) { S.online = c; save(); if (c) api.saveStore(c); },
    removeOnline() { S.online = null; S.orders = []; save(); },
    orders() { return S.orders; },
    async placeOrder(p) {
      const c = S.online; if (!c) throw new Error('This store is not live yet.');
      const host = c.domain.type === 'custom' && c.domain.status === 'live' ? c.domain.host : (c.domain.temp || c.domain.host);
      const r = await A().post('/api/shop/order', { ...p, host }); if (!r.ok) throw new Error(r.msg || 'We could not place your order.');
      const ord = S.orders.find(x => x.id === r.order.id) || S.addOrder(r.order); api.ackOrders([r.order.id]); return ord;
    },
    addOrder(o) { S.oseq++; const now=Date.now(); const order = { id: 'O-' + S.oseq, ts: now, status: 'new', paid: false, channel: 'online', tracking: 'ST-' + now.toString(36).toUpperCase(), events: [{status:'new',at:now,note:'Order received'}], ...o }; S.orders.unshift(order); save(); return order; },
    setOrderStatus(id, status) { const o = S.orders.find(x => x.id === id); if (o) { try { api.orderStatus({ id, status }); } catch (e) {} o.status = status; o.events = o.events || []; o.events.push({status,at:Date.now(),note:({processing:'Order is being prepared',packed:'Order packaged',dispatched:'Order dispatched',delivered:'Order delivered',fulfilled:'Order marked fulfilled',cancelled:'Order cancelled'})[status]||'Order updated'}); save(); } return o; },
    setOrderPaid(id) { const o=S.orders.find(x=>x.id===id); if(o&&!o.paid){try{api.orderStatus({id,paid:true});}catch(e){} o.paid=true;o.events=o.events||[];o.events.push({status:'paid',at:Date.now(),note:'Payment confirmed by store'});save();} return o; },

    // ----- receipt template (JSON) & prefs -----
    getReceiptRaw() { return S.receipt; },
    setReceiptRaw(t) { S.receipt = t; save(); }
  };
})();
