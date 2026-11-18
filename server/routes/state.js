'use strict';
const C = require('../core');
const { HttpError, q, one, str } = C;
const { LIMITS, INTRO_CYCLES, PRICES } = require('../plans');

const KEY_OK = k => k === 'strap.v1' || k === 'strap.f1' || /^strap\.f1\.items\.[A-Za-z0-9_-]{1,40}$/.test(k);
const MAX_BYTES = 3500000;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/* Is Premium really on? Decided here, from payments only — the browser can never grant it. */
async function planOf(storeId) {
  const s = await one('select * from subscriptions where store_id = $1', [storeId]);
  if (!s) return { plan: 'free', status: 'inactive', limits: LIMITS.free };
  const end = s.current_period_end ? new Date(s.current_period_end) : null;
  const grace = s.status === 'past_due' ? 3 * 864e5 : 0;
  const prem = s.plan === 'premium' && end && end.getTime() + grace > Date.now();
  return { plan: prem ? 'premium' : 'free', status: prem ? s.status : 'inactive', currency: s.currency, cycle: s.cycle, periodEnd: end ? end.toISOString() : null, cancelAtPeriodEnd: !!s.cancel_at_period_end, autoRenew: !!s.card_token && !s.cancel_at_period_end, card: s.card_last4 ? { last4: s.card_last4, brand: s.card_brand } : null, limits: LIMITS[prem ? 'premium' : 'free'] };
}

async function bootstrap(c) {
  const a = c.auth, [plan, rows, u] = await Promise.all([
    planOf(a.store.id),
    q('select key, value, version from kv_state where store_id = $1', [a.store.id]),
    one('select review_ticket, totp_enabled from users where id = $1', [a.user.id])
  ]);
  const state = {}; rows.forEach(r => { state[r.key] = { value: r.value, version: r.version }; });
  const p = a.store.profile || {};
  return {
    ok: true,
    session: { ...p, name: a.user.name, email: a.user.email, phone: a.user.phone || '', bizname: a.store.bizname, country: a.store.country, currency: a.store.currency, photoUrl: p.photoUrl || '' },
    account: { status: a.user.status, ticket: u.review_ticket || '' },
    twofa: { on: !!u.totp_enabled }, hasPin: a.user.hasPin, plan,
    pricing: { prices: PRICES, introCycles: INTRO_CYCLES }, state
  };
}

function merge(cur, inc) {
  if (Array.isArray(cur) && Array.isArray(inc)) {
    const withId = l => l.length > 0 && l.every(x => isObj(x) && x.id !== undefined);
    if ((cur.length === 0 || withId(cur)) && (inc.length === 0 || withId(inc)) && (cur.length || inc.length)) {
      const m = new Map(cur.map(x => [String(x.id), x])); inc.forEach(x => m.set(String(x.id), x));
      let out = [...m.values()], t = x => x.ts || x.createdAt || x.at;
      if (out.every(x => typeof t(x) === 'number')) out = out.sort((x, y) => t(y) - t(x));
      return out;
    }
    return inc;
  }
  if (isObj(cur) && isObj(inc)) { const o = { ...cur }; for (const k of Object.keys(inc)) o[k] = k in cur ? merge(cur[k], inc[k]) : inc[k]; return o; }
  return inc;
}

async function put(c) {
  const a = c.auth, key = str(c.body.key, 80); let v = c.body.value;
  if (!KEY_OK(key)) throw new HttpError(400, 'Invalid request.');
  if (a.user.status === 'suspended') throw new HttpError(403, 'Your account is suspended.', { code: 'suspended' });
  if (v === undefined || v === null || typeof v !== 'object') throw new HttpError(400, 'Invalid request.');
  if (JSON.stringify(v).length > MAX_BYTES) throw new HttpError(413, 'That data is too large to save. Remove large pictures and try again.');
  const plan = await planOf(a.store.id), lim = plan.limits;
  if (key === 'strap.f1') {
    if (!isObj(v)) throw new HttpError(400, 'Invalid request.');
    v = { ...v }; delete v.plan; delete v.account; delete v.twofa; // server owns these
    if (Array.isArray(v.branches) && v.branches.length > lim.branches) throw new HttpError(402, 'You have reached the branch limit on your plan.', { code: 'plan_limit' });
    if (Array.isArray(v.staff) && v.staff.length > lim.staff) throw new HttpError(402, 'You have reached the staff limit on your plan.', { code: 'plan_limit' });
  } else if (key === 'strap.v1') {
    if (!isObj(v)) throw new HttpError(400, 'Invalid request.');
    v = { ...v }; delete v.pin; delete v.lock; // the PIN lives on the server only
  } else {
    if (!Array.isArray(v)) throw new HttpError(400, 'Invalid request.');
    const o = await one("select coalesce(sum(jsonb_array_length(value)), 0)::int as n from kv_state where store_id = $1 and key like 'strap.f1.items.%' and key <> $2 and jsonb_typeof(value) = 'array'", [a.store.id, key]);
    if (o.n + v.length > lim.products) throw new HttpError(402, `Free plan allows up to ${lim.products} products. Go Premium to add more.`, { code: 'plan_limit' });
  }
  let merged = false, base = Number(c.body.base) || 0;
  for (let i = 0; i < 4; i++) {
    const cur = await one('select value, version from kv_state where store_id = $1 and key = $2', [a.store.id, key]);
    if (!cur) {
      const ins = await one('insert into kv_state(store_id, key, value) values ($1,$2,$3::jsonb) on conflict do nothing returning version', [a.store.id, key, JSON.stringify(v)]);
      if (ins) return { ok: true, version: ins.version, merged };
      continue;
    }
    let next = v;
    if (cur.version !== base) { next = merge(cur.value, v); merged = true; }
    if (key === 'strap.f1') { next = { ...next }; delete next.plan; delete next.account; delete next.twofa; }
    const up = await one('update kv_state set value = $3::jsonb, version = version + 1, updated_at = now() where store_id = $1 and key = $2 and version = $4 returning version', [a.store.id, key, JSON.stringify(next), cur.version]);
    if (up) return { ok: true, version: up.version, merged, ...(merged ? { value: next } : {}) };
    base = 0; // lost a race: re-read and merge again
  }
  throw new HttpError(409, 'Your data changed on another device. Refresh and try again.');
}

async function versions(c) {
  const rows = await q('select key, version from kv_state where store_id = $1', [c.auth.store.id]);
  const out = {}; rows.forEach(r => { out[r.key] = r.version; }); return { ok: true, versions: out };
}

module.exports = { planOf, bootstrap, put, versions, merge };
