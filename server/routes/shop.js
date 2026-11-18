'use strict';
const dns = require('dns').promises;
const crypto = require('crypto');
const C = require('../core');
const { HttpError, q, one, rate, ipOf, str, env, isEmail, normEmail } = C;
const { sendEmail, shell } = require('../notify');

const RESERVED = ['www', 'app', 'api', 'admin', 'mail', 'shop', 'store', 'stores', 'strap', 'support', 'demo', 'test', 'dashboard', 'login', 'help', 'status', 'blog'];
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])$/;
const BASE = () => env('BASE_DOMAIN', 'strap.store').toLowerCase();
const PRIVATE_KEYS = /^(cost|costprice|supplier|margin|profit|internal|notes?|barcode)$/i;

const slugFromHost = h => { h = String(h || '').toLowerCase(); return h.endsWith('.' + BASE()) ? h.slice(0, -(BASE().length + 1)) : ''; };
const publicProduct = p => { const o = {}; Object.keys(p || {}).forEach(k => { if (!PRIVATE_KEYS.test(k) && k !== 'media') o[k] = p[k]; }); return o; };
const cleanCatalog = list => (Array.isArray(list) ? list : []).filter(p => p && p.id !== undefined && (!p.status || p.status === 'active')).slice(0, 2000).map(publicProduct);

async function checkName(c) {
  const name = str(c.query.name, 40).toLowerCase();
  if (!SLUG.test(name) || RESERVED.includes(name)) return { ok: true, available: false };
  const r = await one('select store_id from stores_public where slug = $1', [name]);
  return { ok: true, available: !r || (c.auth && r.store_id === c.auth.store.id) };
}

async function publish(c) {
  const a = c.auth, cfg = c.body.config;
  if (!cfg || typeof cfg !== 'object' || JSON.stringify(cfg).length > 1500000) throw new HttpError(400, 'Invalid store settings.');
  const dm = cfg.domain || {}, host = str(dm.host, 120).toLowerCase();
  const slug = dm.type === 'custom' ? slugFromHost(dm.temp) : slugFromHost(host);
  if (!slug || !SLUG.test(slug) || RESERVED.includes(slug)) throw new HttpError(400, 'Choose a different store address.');
  const pub = JSON.parse(JSON.stringify(cfg)); if (pub.domain) delete pub.domain.token;
  const catalog = Array.isArray(c.body.products) ? cleanCatalog(c.body.products) : null;
  try {
    await q(`insert into stores_public(store_id, slug, config, catalog) values ($1,$2,$3::jsonb, coalesce($4::jsonb, '[]'::jsonb))
             on conflict (store_id) do update set slug = excluded.slug, config = excluded.config, catalog = coalesce($4::jsonb, stores_public.catalog), published = true, updated_at = now()`,
      [a.store.id, slug, JSON.stringify(pub), catalog ? JSON.stringify(catalog) : null]);
  } catch (e) { if (e && (e.code === '23505' || /duplicate key/i.test(e.message || ''))) throw new HttpError(409, 'That store address is already taken.'); throw e; }
  const row = await one('select custom_domain, domain_verified from stores_public where store_id = $1', [a.store.id]);
  return { ok: true, slug, shopUrl: `${C.appUrl()}/shop.html?s=${slug}`, domainVerified: !!(row && row.domain_verified) };
}

async function publishCatalog(c) {
  const list = cleanCatalog(c.body.products);
  const r = await one('update stores_public set catalog = $2::jsonb, updated_at = now() where store_id = $1 returning slug', [c.auth.store.id, JSON.stringify(list)]);
  return { ok: true, published: !!r, count: list.length };
}

async function loadShop(slug, host) {
  host = String(host || '').toLowerCase();
  return one(`select sp.store_id, sp.config, sp.catalog, sp.updated_at, s.bizname, s.currency, s.owner_id, u.email as owner_email
                from stores_public sp join stores s on s.id = sp.store_id and s.deleted_at is null join users u on u.id = s.owner_id and u.status in ('active','review')
               where sp.published and ((sp.slug = $1 and $1 <> '') or (sp.custom_domain = $2 and sp.domain_verified and $2 <> '')) limit 1`, [str(slug, 40).toLowerCase(), host]);
}
async function resolve(c) {
  const slug = c.query.slug || slugFromHost(c.query.host);
  const r = await loadShop(slug, c.query.host); if (!r) throw new HttpError(404, 'This store is not available.');
  const cfg = r.config || {}; if (cfg.domain) delete cfg.domain.token;
  return { ok: true, config: cfg, products: r.catalog || [], name: r.bizname };
}

const money = n => Math.round((+n || 0) * 100) / 100;
async function order(c) {
  await rate('order-ip:' + ipOf(c.req), 12, 3600, 'Too many orders from this device. Try again later.');
  const b = c.body, shop = await loadShop(b.slug || slugFromHost(b.host), b.host); if (!shop) throw new HttpError(404, 'This store is not available.');
  const cfg = shop.config || {}, cat = new Map((shop.catalog || []).map(p => [String(p.id), p]));
  const name = str(b.customer && b.customer.name, 80), phone = str(b.customer && b.customer.phone, 30), email = normEmail(b.customer && b.customer.email);
  if (name.length < 2 || phone.replace(/\D/g, '').length < 7 || !isEmail(email)) throw new HttpError(400, 'Check your name, phone and email.');
  const method = b.method === 'pickup' ? 'pickup' : 'delivery', address = method === 'delivery' ? str(b.address, 300) : 'Pickup at store';
  if (method === 'delivery' && address.length < 5) throw new HttpError(400, 'Enter your delivery address.');
  const payMode = cfg.payment && cfg.payment.mode, pay = ['cod', 'transfer', 'link'].includes(b.payment) ? b.payment : (payMode === 'cod' ? 'cod' : payMode === 'link' ? 'link' : 'transfer');
  if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 60) throw new HttpError(400, 'Your cart is empty.');
  const lines = []; let subtotal = 0; const want = new Map();
  for (const l of b.lines) {
    const p = cat.get(String(l.id)); if (!p) throw new HttpError(409, 'An item in your cart is no longer available.');
    const qty = Math.max(1, Math.min(99, parseInt(l.qty, 10) || 1)); want.set(String(p.id), (want.get(String(p.id)) || 0) + qty);
    const v = l.v && typeof l.v === 'object' ? Object.entries(l.v).slice(0, 5).map(([k, x]) => `${str(k, 20)}: ${str(x, 30)}`).join(', ') : '';
    const price = money(p.price); subtotal += price * qty;
    lines.push({ id: p.id, title: str(p.title, 120) + (v ? ' · ' + v : ''), price, qty, image: (p.files && p.files[0] && /\/api\/media\/[a-f0-9]{40}$/.test(p.files[0].url || '')) ? p.files[0].url : '' });
  }
  for (const [id, n] of want) { const p = cat.get(id); if (p.tracked && !p.sellWhenOut && n > (+p.qty || 0)) throw new HttpError(409, `${str(p.title, 60)} is out of stock (only ${Math.max(0, +p.qty || 0)} left).`); }
  subtotal = money(subtotal);
  const promos = Array.isArray(cfg.promos) ? cfg.promos : [{ code: 'WELCOME10', type: 'pct', value: 10 }];
  const pr = b.promo ? promos.find(x => String(x.code).toUpperCase() === String(b.promo).toUpperCase()) : null;
  const discount = pr ? money(pr.type === 'pct' ? subtotal * Math.min(100, +pr.value || 0) / 100 : Math.min(subtotal, +pr.value || 0)) : 0;
  const ship = cfg.shipping || {}, net = money(subtotal - discount), freeOver = +ship.freeOver || 0;
  const delivery = method === 'delivery' ? (freeOver > 0 && net >= freeOver ? 0 : money(+ship.fee || 0)) : 0, total = money(net + delivery);
  let proof = null; const pp = b.paymentProof;
  if (pp && typeof pp.data === 'string' && /^data:(image\/(png|jpeg|webp|gif)|application\/pdf);base64,/.test(pp.data) && pp.data.length < 2900000) proof = { name: str(pp.name, 80), type: str(pp.type, 40), data: pp.data };
  const seq = await one('update stores set order_seq = order_seq + 1 where id = $1 returning order_seq', [shop.store_id]);
  const no = 'O-' + seq.order_seq, now = Date.now(), tracking = 'ST-' + now.toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase();
  const events = [{ status: 'new', at: now, note: 'Order received' }];
  await q(`insert into orders(store_id, order_no, tracking, customer, address, note, method, payment, payment_ref, proof, lines, subtotal, discount, delivery, total, promo, events)
           values ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17::jsonb)`,
    [shop.store_id, no, tracking, JSON.stringify({ name, phone, email }), address, str(b.note, 500), method, pay, str(b.paymentReference, 80), proof ? JSON.stringify(proof) : null, JSON.stringify(lines), subtotal, discount, delivery, total, pr ? pr.code : '', JSON.stringify(events)]);
  // keep the public stock honest (a second order can't oversell what the first one took)
  try { const next = (shop.catalog || []).map(p => want.has(String(p.id)) && p.tracked ? { ...p, qty: Math.max(0, (+p.qty || 0) - want.get(String(p.id))) } : p); await q('update stores_public set catalog = $2::jsonb where store_id = $1 and updated_at = $3', [shop.store_id, JSON.stringify(next), shop.updated_at]); } catch (e) {}
  try { await sendEmail({ to: shop.owner_email, subject: `New order ${no} – ${name}`, text: `${name} (${phone}) placed order ${no} for ${total} ${shop.currency}. Open Strap > Orders to see it.` }); } catch (e) {}
  try { await sendEmail({ to: email, subject: `We received your order ${no}`, text: `Hi ${name.split(' ')[0]}, thanks for your order ${no} from ${shop.bizname}. Tracking reference: ${tracking}.`, html: shell('Order received', `<p>Hi ${esc(name.split(' ')[0])}, thanks for ordering from <b>${esc(shop.bizname)}</b>.</p><p>Order <b>${no}</b><br>Tracking reference <b>${tracking}</b></p>`) }); } catch (e) {}
  return { ok: true, order: { id: no, ts: now, status: 'new', paid: false, channel: 'online', tracking, events, customer: { name, phone, email }, address, note: str(b.note, 500), method, payment: pay, paymentProof: proof ? { name: proof.name, type: proof.type } : null, paymentReference: str(b.paymentReference, 80), lines, subtotal, discount, promo: pr ? pr.code : '', delivery, total } };
}
const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/* ---------- merchant side: pull new orders, update status ---------- */
const toLocal = r => ({ id: r.order_no, ts: new Date(r.created_at).getTime(), status: r.status, paid: r.paid, channel: 'online', tracking: r.tracking, events: r.events, customer: r.customer, address: r.address, note: r.note, method: r.method, payment: r.payment, paymentProof: r.proof || null, paymentReference: r.payment_ref || '', lines: r.lines, subtotal: +r.subtotal, discount: +r.discount, promo: r.promo || '', delivery: +r.delivery, total: +r.total });
async function pull(c) { const rows = await q('select * from orders where store_id = $1 and not pulled order by created_at asc limit 10', [c.auth.store.id]); return { ok: true, orders: rows.map(toLocal) }; }
async function ack(c) { const ids = (Array.isArray(c.body.ids) ? c.body.ids : []).map(x => str(x, 20)).slice(0, 50); if (ids.length) await q('update orders set pulled = true where store_id = $1 and order_no = any($2::text[])', [c.auth.store.id, ids]); return { ok: true }; }
const STATUSES = ['new', 'processing', 'packed', 'dispatched', 'delivered', 'fulfilled', 'cancelled'];
async function setStatus(c) {
  const id = str(c.body.id, 20), st = c.body.status ? str(c.body.status, 20) : null; if (st && !STATUSES.includes(st)) throw new HttpError(400, 'Invalid status.');
  const ev = JSON.stringify([{ status: c.body.paid ? 'paid' : st, at: Date.now(), note: str(c.body.note, 100) }]);
  const r = await one(`update orders set status = coalesce($3, status), paid = paid or $4::boolean, events = events || $5::jsonb where store_id = $1 and order_no = $2 returning order_no`, [c.auth.store.id, id, st, !!c.body.paid, ev]);
  return { ok: !!r };
}

/* ---------- custom domain: the owner proves control with a DNS TXT record ---------- */
async function domainVerify(c) {
  const host = str(c.body.host, 120).toLowerCase(), token = str(c.body.token, 40);
  if (!/^(?=.{4,120}$)([a-z0-9-]+\.)+[a-z]{2,}$/.test(host) || host.endsWith('.' + BASE()) || !token) throw new HttpError(400, 'Enter a valid domain.');
  await rate('dom:' + c.auth.user.id, 20, 3600);
  const recs = (await dns.resolveTxt('_strap-verify.' + host).catch(() => [])).map(r => r.join(''));
  if (!recs.includes('strap-verify=' + token)) return { ok: true, verified: false };
  try { const r = await one('update stores_public set custom_domain = $2, domain_verified = true, updated_at = now() where store_id = $1 returning store_id', [c.auth.store.id, host]); if (!r) return { ok: true, verified: true, attached: false, note: 'Publish your store first.' }; }
  catch (e) { if (e && (e.code === '23505' || /duplicate key/i.test(e.message || ''))) throw new HttpError(409, 'That domain is already connected to another store.'); throw e; }
  let attached = false;
  if (env('VERCEL_API_TOKEN') && env('VERCEL_PROJECT_ID')) {
    try { const r = await fetch(`https://api.vercel.com/v10/projects/${env('VERCEL_PROJECT_ID')}/domains${env('VERCEL_TEAM_ID') ? '?teamId=' + env('VERCEL_TEAM_ID') : ''}`, { method: 'POST', headers: { Authorization: 'Bearer ' + env('VERCEL_API_TOKEN'), 'Content-Type': 'application/json' }, body: JSON.stringify({ name: host }) }); attached = r.ok || r.status === 409; } catch (e) {}
  }
  return { ok: true, verified: true, attached };
}

module.exports = { checkName, publish, publishCatalog, resolve, order, pull, ack, setStatus, domainVerify };
