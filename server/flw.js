'use strict';
/* Flutterwave v3 — hosted checkout (card, bank transfer, USSD…) + server-side verification + token renewals. */
const { HttpError, env, appUrl, q, one, enc, dec } = require('./core');
const { amountFor } = require('./plans');
const BASE = 'https://api.flutterwave.com/v3';

async function call(path, { method = 'GET', body } = {}) {
  if (!env('FLW_SECRET_KEY')) throw new HttpError(503, 'Payments are not set up yet. Add FLW_SECRET_KEY to the server settings.');
  let r, j;
  try {
    r = await fetch(BASE + path, { method, headers: { Authorization: 'Bearer ' + env('FLW_SECRET_KEY'), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    j = await r.json().catch(() => ({}));
  } catch (e) { console.error('flutterwave network error', e.message); throw new HttpError(502, 'We could not reach the payment provider. Please try again.'); }
  return { status: r.status, json: j };
}

async function createCheckout({ tx_ref, amount, currency, customer, meta, title, description }) {
  const { status, json } = await call('/payments', { method: 'POST', body: {
    tx_ref, amount, currency, redirect_url: appUrl() + '/api/billing/return',
    customer: { email: customer.email, name: customer.name, phonenumber: customer.phone || undefined },
    meta, customizations: { title, description}
  } });
  if (status >= 400 || json.status !== 'success' || !json.data?.link) { console.error('flutterwave create failed', status, JSON.stringify(json).slice(0, 400)); throw new HttpError(502, 'We could not start the payment. Please try again.'); }
  return json.data.link;
}

/* Never trust a redirect or a webhook body alone: always ask Flutterwave for the truth. */
async function verifyByRef(tx_ref) {
  const { json } = await call('/transactions/verify_by_reference?tx_ref=' + encodeURIComponent(tx_ref));
  return json && json.status === 'success' ? json.data : null;
}

/* Settle a payment exactly once, and extend Premium in the SAME statement so they can never get out of step. */
async function settle(tx_ref) {
  const p = await one('select * from payments where tx_ref = $1', [tx_ref]);
  if (!p) return { ok: false, reason: 'unknown' };
  if (p.status === 'successful') return { ok: true, already: true, payment: p };
  const d = await verifyByRef(tx_ref);
  if (!d) return { ok: false, reason: 'not_found', payment: p };
  if (d.status !== 'successful') {
    if (['failed', 'cancelled'].includes(d.status)) await q("update payments set status = 'failed', raw = $2::jsonb where tx_ref = $1 and status = 'pending'", [tx_ref, JSON.stringify(slim(d))]);
    return { ok: false, reason: d.status || 'pending', payment: p };
  }
  const paidEnough = Number(d.amount) + 0.0001 >= Number(p.amount) && String(d.currency).toUpperCase() === String(p.currency).toUpperCase() && d.tx_ref === tx_ref;
  if (!paidEnough) { console.error('payment mismatch', tx_ref, d.amount, d.currency); await q("update payments set status = 'failed', raw = $2::jsonb where tx_ref = $1 and status = 'pending'", [tx_ref, JSON.stringify(slim(d))]); return { ok: false, reason: 'mismatch', payment: p }; }
  const token = d.card && d.card.token ? enc(d.card.token) : null;
  const res = await q(
    `with paid as (
        update payments set status = 'successful', paid_at = now(), flw_tx_id = $2, raw = $3::jsonb
         where tx_ref = $1 and status <> 'successful' returning store_id, currency)
     update subscriptions s set
        plan = 'premium', status = 'active', currency = paid.currency, cycle = s.cycle + 1, cancel_at_period_end = false, past_due_since = null,
        current_period_end = greatest(coalesce(s.current_period_end, now()), now()) + interval '1 month',
        card_token = coalesce($4, s.card_token), card_last4 = coalesce($5, s.card_last4), card_brand = coalesce($6, s.card_brand), updated_at = now()
       from paid where s.store_id = paid.store_id returning s.store_id`,
    [tx_ref, String(d.id || ''), JSON.stringify(slim(d)), token, d.card?.last_4digits || null, d.card?.type || null]);
  return { ok: true, extended: res.length > 0, payment: p };
}
const slim = d => ({ id: d.id, tx_ref: d.tx_ref, flw_ref: d.flw_ref, amount: d.amount, currency: d.currency, status: d.status, payment_type: d.payment_type, card: d.card ? { last_4digits: d.card.last_4digits, type: d.card.type, issuer: d.card.issuer, country: d.card.country } : undefined, created_at: d.created_at });

/* Monthly renewal with the saved card token (only if Flutterwave returned one). */
async function chargeToken(sub, user, store) {
  const currency = sub.currency || store.currency || 'NGN', amount = amountFor(currency, sub.cycle);
  const tx_ref = `strap_r_${store.id.slice(0, 8)}_${Date.now()}`;
  await q("insert into payments(tx_ref, store_id, user_id, purpose, amount, currency) values ($1,$2,$3,'renewal',$4,$5)", [tx_ref, store.id, user.id, amount, currency]);
  const { json } = await call('/tokenized-charges', { method: 'POST', body: { token: dec(sub.card_token), currency, amount, email: user.email, country: store.country_code || 'NG', tx_ref, first_name: (user.name || 'Customer').split(' ')[0], last_name: (user.name || '').split(' ').slice(1).join(' ') || '-' } });
  if (json.status !== 'success') return { ok: false, tx_ref };
  const r = await settle(tx_ref);
  return { ok: r.ok, tx_ref };
}

module.exports = { call, createCheckout, verifyByRef, settle, chargeToken };
