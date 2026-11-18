'use strict';
/* One serverless function that routes every /api/* request (keeps you inside Vercel's free-plan function limit). */
const C = require('../server/core');
const A = require('../server/routes/auth'), S = require('../server/routes/state'), B = require('../server/routes/billing'),
  M = require('../server/routes/media'), SH = require('../server/routes/shop'), X = require('../server/routes/misc');

const R = []; // [method, pattern, handler, options]
const add = (m, p, fn, o = {}) => R.push([m, new RegExp('^' + p.replace(/:([a-z]+)/g, '(?<$1>[^/]+)') + '/?$'), fn, o]);
const AUTH = { auth: true }, OPT = { opt: true };

add('GET', '/health', X.health);
add('POST', '/auth/send-code', A.sendCodeRoute, OPT);       add('POST', '/auth/verify-code', A.verifyCodeRoute, OPT);
add('POST', '/auth/signup', A.signup);                      add('POST', '/auth/login', A.legacyAuthDisabled);
add('GET', '/auth/neon-status', A.neonStatus);
add('POST', '/auth/login-2fa', A.login2fa);                 add('POST', '/auth/logout', A.logout);
add('POST', '/auth/reset-password', A.legacyAuthDisabled);  add('POST', '/auth/change-password', A.legacyAuthDisabled, AUTH);
add('POST', '/2fa/setup', A.twofaSetup, AUTH);              add('POST', '/2fa/enable', A.twofaEnable, AUTH);   add('POST', '/2fa/disable', A.twofaDisable, AUTH);
add('POST', '/pin/set', A.pinSet, AUTH);                    add('POST', '/pin/verify', A.pinVerify, AUTH);
add('GET', '/bootstrap', S.bootstrap, AUTH);                add('PUT', '/state', S.put, AUTH);                 add('GET', '/state/versions', S.versions, AUTH);
add('POST', '/media', M.upload, AUTH);                      add('GET', '/media/:id', M.get);
add('GET', '/account/status', A.accountStatus, AUTH);       add('POST', '/account/review', A.requestReview, AUTH); add('POST', '/account/delete', A.deleteAccount, AUTH);
add('POST', '/account/profile', A.profileUpdate, AUTH);
add('POST', '/staff/create', A.staffCreate, AUTH);          add('POST', '/staff/remove', A.staffRemove, AUTH);
add('GET', '/billing/plans', B.plans);                      add('POST', '/billing/checkout', B.checkout, AUTH);  add('GET', '/billing/return', B.ret);
add('GET', '/billing/status', B.status, AUTH);              add('POST', '/billing/cancel', B.cancel, AUTH);
add('POST', '/webhooks/flutterwave', B.webhook, { nocsrf: true });  add('GET', '/cron/renew', B.cron);
add('GET', '/shop/check', SH.checkName, OPT);               add('POST', '/store/publish', SH.publish, AUTH);     add('POST', '/store/catalog', SH.publishCatalog, AUTH);
add('POST', '/store/domain/verify', SH.domainVerify, AUTH); add('GET', '/shop/resolve', SH.resolve);              add('POST', '/shop/order', SH.order);
add('GET', '/orders/pull', SH.pull, AUTH);                  add('POST', '/orders/ack', SH.ack, AUTH);            add('POST', '/orders/status', SH.setStatus, AUTH);

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'), path = url.pathname.replace(/^\/api/, '') || '/';
    let hit = null; for (const [m, re, fn, o] of R) { const mm = re.exec(path); if (mm && m === req.method) { hit = { fn, o, params: mm.groups || {} }; break; } }
    if (!hit) { const other = R.some(([, re]) => re.test(path)); throw new C.HttpError(other ? 405 : 404, other ? 'Method not allowed.' : 'Not found.'); }
    if (req.method !== 'GET' && req.method !== 'HEAD' && !hit.o.nocsrf && req.headers['x-strap'] !== '1') throw new C.HttpError(403, 'Blocked request.');
    const ctx = { req, res, params: hit.params, query: Object.fromEntries(url.searchParams), body: req.method === 'GET' ? {} : await C.readJson(req), auth: null };
    if (hit.o.auth) { ctx.auth = await C.auth(req); if (!ctx.auth) throw new C.HttpError(401, 'Please sign in.', { code: 'auth' }); }
    else if (hit.o.opt) ctx.auth = await C.auth(req);
    const out = await hit.fn(ctx);
    if (out && out.__raw) { res.statusCode = out.status; Object.entries(out.headers || {}).forEach(([k, v]) => res.setHeader(k, v)); return res.end(out.body); }
    C.send(res, 200, out);
  } catch (e) {
    if (e instanceof C.HttpError) return C.send(res, e.status, { ok: false, msg: e.message, ...e.extra });
    console.error('api error', req.method, req.url, e && e.stack || e);
    C.send(res, 500, { ok: false, msg: 'Something went wrong on our side. Please try again.' });
  }
};
