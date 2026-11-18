'use strict';
const crypto = require('crypto');
const C = require('../core');
const { HttpError, q, one, rate, env, appUrl, safeEq, audit } = C;
const { PRICES, INTRO_CYCLES, pickCurrency, amountFor } = require('../plans');
const flw = require('../flw');
const { planOf } = require('./state');
const { sendEmail, shell } = require('../notify');

const COUNTRY = { nigeria: 'NG', ghana: 'GH', kenya: 'KE', 'south africa': 'ZA', 'united kingdom': 'GB', uganda: 'UG', tanzania: 'TZ', rwanda: 'RW', egypt: 'EG', senegal: 'SN', cameroon: 'CM' };
const cc = name => COUNTRY[String(name || '').toLowerCase()] || 'NG';

const plans = async () => ({ ok: true, prices: PRICES, introCycles: INTRO_CYCLES });

async function checkout(c) {
  const a = c.auth; if (a.user.status !== 'active') throw new HttpError(403, 'Your account cannot start a subscription right now.');
  await rate('checkout:' + a.user.id, 10, 3600, 'Too many payment attempts. Try again in an hour.');
  const sub = await one('select cycle, status, plan, current_period_end, cancel_at_period_end from subscriptions where store_id = $1', [a.store.id]);
  const info = await planOf(a.store.id);
  if (info.plan === 'premium' && sub.status === 'active' && !sub.cancel_at_period_end && new Date(sub.current_period_end).getTime() - Date.now() > 7 * 864e5)
    throw new HttpError(409, 'Premium is already active on your account.');
  const currency = pickCurrency(c.body.currency, a.store.currency), amount = amountFor(currency, sub.cycle);
  const tx_ref = `strap_${a.store.id.slice(0, 8)}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
  await q("insert into payments(tx_ref, store_id, user_id, purpose, amount, currency) values ($1,$2,$3,'subscription',$4,$5)", [tx_ref, a.store.id, a.user.id, amount, currency]);
  const link = await flw.createCheckout({ tx_ref, amount, currency, customer: { email: a.user.email, name: a.user.name, phone: a.user.phone },
    meta: { store_id: a.store.id, user_id: a.user.id, cycle: sub.cycle }, title: 'Strap Premium', description: sub.cycle < INTRO_CYCLES ? `Premium – introductory month ${sub.cycle + 1} of ${INTRO_CYCLES}` : 'Premium – monthly' });
  await audit(c.req, a, 'checkout_start', { tx_ref, amount, currency });
  return { ok: true, link, tx_ref, amount, currency };
}

/* Flutterwave sends the customer back here after paying (or cancelling). We verify with Flutterwave, then continue the Strap flow. */
async function ret(c) {
  const tx_ref = String(c.query.tx_ref || ''); let ok = false;
  if (tx_ref) { try { ok = (await flw.settle(tx_ref)).ok; } catch (e) { console.error('return settle failed', e.message); } }
  return { __raw: true, status: 302, headers: { Location: `/index.html?subscribe=1&paid=${ok ? 1 : 0}&ref=${encodeURIComponent(tx_ref)}`, 'Cache-Control': 'no-store' }, body: '' };
}

async function status(c) {
  const info = await planOf(c.auth.store.id);
  let last = null; const ref = String(c.query.ref || '');
  if (ref) { last = await one('select status, amount, currency from payments where tx_ref = $1 and store_id = $2', [ref, c.auth.store.id]); if (last && last.status === 'pending') { try { await flw.settle(ref); } catch (e) {} last = await one('select status, amount, currency from payments where tx_ref = $1', [ref]); } }
  return { ok: true, plan: info, payment: last, prices: PRICES, introCycles: INTRO_CYCLES };
}

async function cancel(c) {
  const r = await one("update subscriptions set cancel_at_period_end = true, status = 'cancelled', card_token = null, updated_at = now() where store_id = $1 and plan = 'premium' returning current_period_end", [c.auth.store.id]);
  await audit(c.req, c.auth, 'subscription_cancel', {});
  return { ok: true, periodEnd: r ? r.current_period_end : null };
}

/* Flutterwave webhook: verify the secret hash, then verify the transaction itself with Flutterwave before granting anything. */
async function webhook(c) {
  const want = env('FLW_WEBHOOK_SECRET_HASH'), got = c.req.headers['verif-hash'];
  if (!want || !got || !safeEq(got, want)) throw new HttpError(401, 'Invalid signature.');
  const ev = c.body || {}, d = ev.data || {};
  if (d.tx_ref) {
    await q('insert into webhook_events(provider, event_key, payload) values ($1,$2,$3::jsonb) on conflict do nothing', ['flutterwave', `${ev.event || ev.type || 'event'}:${d.id || d.tx_ref}:${d.status || ''}`, JSON.stringify({ event: ev.event || ev.type, tx_ref: d.tx_ref, id: d.id, status: d.status })]);
    if (String(d.tx_ref).startsWith('strap_')) await flw.settle(d.tx_ref); // throws on a temporary error so Flutterwave retries
  }
  return { ok: true };
}

/* Daily job (Vercel Cron): renew saved cards, remind everyone else, expire what has run out. */
async function cron(c) {
  const secret = env('CRON_SECRET'), h = String(c.req.headers.authorization || '');
  if (!secret || !safeEq(h, 'Bearer ' + secret)) throw new HttpError(401, 'Unauthorized.');
  const out = { renewed: 0, failed: 0, reminded: 0, expired: 0 };
  const due = await q(`select s.store_id, s.currency, s.cycle, s.card_token, u.id as user_id, u.email, u.name, st.country, st.id as sid from subscriptions s join stores st on st.id = s.store_id join users u on u.id = st.owner_id
     where s.plan = 'premium' and s.status = 'active' and s.cancel_at_period_end = false and s.card_token is not null and s.current_period_end < now() + interval '1 day' and u.status <> 'deleted' order by s.current_period_end limit 40`);
  for (const r of due) {
    try {
      const res = await flw.chargeToken({ currency: r.currency, cycle: r.cycle, card_token: r.card_token }, { id: r.user_id, email: r.email, name: r.name }, { id: r.sid, country_code: cc(r.country), currency: r.currency });
      if (res.ok) out.renewed++; else throw new Error('declined');
    } catch (e) {
      out.failed++;
      await q("update subscriptions set status = 'past_due', past_due_since = coalesce(past_due_since, now()), updated_at = now() where store_id = $1", [r.store_id]);
      try { await sendEmail({ to: r.email, subject: 'Your Strap Premium payment did not go through', text: `We could not renew your Premium plan. Open Strap and go to Premium to pay again: ${appUrl()}/dashboard.html`, html: shell('Payment did not go through', `<p>We could not renew your Premium plan with your saved card.</p><p><a href="${appUrl()}/dashboard.html" style="background:#0a0a0a;color:#e6f53a;padding:12px 18px;border-radius:99px;text-decoration:none;font-weight:700">Pay again</a></p>`) }); } catch (er) {}
    }
  }
  const soon = await q(`select u.email from subscriptions s join stores st on st.id = s.store_id join users u on u.id = st.owner_id
     where s.plan = 'premium' and s.card_token is null and s.current_period_end between now() + interval '2 days' and now() + interval '3 days' and u.status <> 'deleted' limit 200`);
  for (const r of soon) { try { await sendEmail({ to: r.email, subject: 'Your Strap Premium ends in 3 days', text: `Your Premium plan ends soon. Open Strap > Premium to renew: ${appUrl()}/dashboard.html` }); out.reminded++; } catch (e) {} }
  const exp = await q("update subscriptions set plan = 'free', status = 'inactive', updated_at = now() where plan = 'premium' and current_period_end + (case when status = 'past_due' then interval '3 days' else interval '0' end) < now() returning store_id");
  out.expired = exp.length;
  await q("delete from sessions where expires_at < now()"); await q("delete from verification_codes where created_at < now() - interval '2 days'"); await q("delete from rate_limits where reset_at < now()");
  await q('delete from auth_mfa_sessions where expires_at < now()');
  return { ok: true, ...out };
}

module.exports = { plans, checkout, ret, status, cancel, webhook, cron };
