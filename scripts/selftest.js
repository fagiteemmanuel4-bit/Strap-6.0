'use strict';
/* Offline self-test (no database or internet needed):  npm run selftest */
process.env.APP_SECRET = process.env.APP_SECRET || 'test-secret-test-secret-test-secret';
process.env.APP_ENCRYPTION_KEY = process.env.APP_ENCRYPTION_KEY || Buffer.alloc(32, 7).toString('base64');
const assert = require('assert'); const C = require('../server/core'); const totp = require('../server/totp'); const { merge } = require('../server/routes/state'); const P = require('../server/plans');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n      ', e.message); process.exitCode = 1; } };
(async () => {
  await t('password hash + verify', async () => { const h = await C.hashSecret('Secret123'); assert(await C.checkSecret('Secret123', h)); assert(!(await C.checkSecret('wrong', h))); assert(!(await C.checkSecret('x', C.DUMMY_HASH))); });
  await t('encrypt/decrypt round trip', () => { const e = C.enc('flw-token'); assert.notStrictEqual(e, 'flw-token'); assert.strictEqual(C.dec(e), 'flw-token'); assert.throws(() => C.dec(e.slice(0, -4) + 'AAAA')); });
  await t('signed tokens expire and resist tampering', () => { const s = C.sign({ uid: 1 }, 60); assert.strictEqual(C.unsign(s).uid, 1); assert.strictEqual(C.unsign(s + 'x'), null); assert.strictEqual(C.unsign(C.sign({ uid: 1 }, -5)), null); });
  await t('TOTP matches the RFC 6238 test vector', () => { assert.strictEqual(totp.code('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082'); const s = totp.newSecret(); assert(totp.verify(s, totp.code(s))); assert(!totp.verify(s, '000000') || totp.code(s) === '000000'); });
  await t('phone / email / password rules', () => { assert.strictEqual(C.normPhone('0803 123 4567'), '2348031234567'); assert.strictEqual(C.normPhone('+234 803 123 4567'), '2348031234567'); assert(C.isEmail('a@b.co')); assert(!C.isEmail('a@b')); assert(C.pwProblem('short1')); assert(C.pwProblem('allletters')); assert(!C.pwProblem('goodpass1')); });
  await t('pricing: intro months then regular, server-side', () => { assert.strictEqual(P.amountFor('NGN', 0), 3000); assert.strictEqual(P.amountFor('NGN', 2), 3000); assert.strictEqual(P.amountFor('NGN', 3), 4000); assert.strictEqual(P.pickCurrency('xxx', 'GHS'), 'GHS'); assert.strictEqual(P.pickCurrency('xxx', 'ABC'), 'USD'); });
  await t('state merge: union by id, newest first, local wins', () => {
    const m = merge({ sales: [{ id: 'a', ts: 2, v: 'server' }, { id: 'b', ts: 1 }], n: 1 }, { sales: [{ id: 'a', ts: 2, v: 'local' }, { id: 'c', ts: 3 }], n: 2 });
    assert.deepStrictEqual(m.sales.map(x => x.id), ['c', 'a', 'b']); assert.strictEqual(m.sales[1].v, 'local'); assert.strictEqual(m.n, 2); });
  const handler = require('../api/[...path].js');
  const call = (method, url, headers = {}, body) => new Promise(resolve => { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { resolve({ status: this.statusCode, body: b ? JSON.parse(b) : null }); } }; handler({ method, url, headers, body, socket: {} }, res); });
  await t('router: 404, 405, CSRF block, webhook signature, cron auth', async () => {
    assert.strictEqual((await call('GET', '/api/nope')).status, 404); assert.strictEqual((await call('GET', '/api/auth/login')).status, 405);
    assert.strictEqual((await call('POST', '/api/auth/login', {}, {})).status, 403);
    assert.strictEqual((await call('POST', '/api/auth/login', { 'x-strap': '1' }, {})).status, 410);
    process.env.FLW_WEBHOOK_SECRET_HASH = 'abc'; assert.strictEqual((await call('POST', '/api/webhooks/flutterwave', { 'verif-hash': 'bad' }, {})).status, 401);
    process.env.CRON_SECRET = 'cron'; assert.strictEqual((await call('GET', '/api/cron/renew', { authorization: 'Bearer nope' })).status, 401); });
  await t('protected routes refuse anonymous requests', async () => { for (const [m, u] of [['GET', '/api/bootstrap'], ['PUT', '/api/state'], ['POST', '/api/billing/checkout'], ['POST', '/api/store/publish'], ['GET', '/api/orders/pull']]) assert.strictEqual((await call(m, u, { 'x-strap': '1' }, {})).status, 401, m + ' ' + u); });
  console.log(n + ' checks passed'); 
})();
