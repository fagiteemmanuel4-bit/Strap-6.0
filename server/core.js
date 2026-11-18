'use strict';
/* Strap server core: config, database, crypto, sessions, rate limits, HTTP helpers. */
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}

const env = (k, d = '') => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k]);
const appUrl = () => env('APP_URL').replace(/\/+$/, '');
const isSecure = () => appUrl().startsWith('https://');
const devCodes = () => env('DEV_SHOW_CODES') === 'true';

function neonSessionToken(req) {
  const found = Object.entries(parseCookies(req)).find(([name]) => /neon-auth\.session_token$/.test(name));
  return found ? sha256(found[0] + ':' + found[1]) : null;
}

/* ---------------- Neon Managed Auth ---------------- */
async function neonSession(req) {
  const base = env('NEON_AUTH_BASE_URL').replace(/\/+$/, '');
  const cookie = req.headers.cookie;
  if (!base || !cookie) return null;
  let response;
  try {
    response = await fetch(base + '/get-session', {
      headers: {
        cookie,
        origin: req.headers.origin || appUrl(),
        'x-forwarded-host': req.headers.host || '',
        'x-forwarded-proto': isSecure() ? 'https' : 'http'
      }
    });
  } catch (e) {
    console.error('neon auth session lookup failed', e.message);
    throw new HttpError(503, 'Authentication is temporarily unavailable.');
  }
  if (!response.ok) return null;
  const result = await response.json().catch(() => null);
  const user = result && (result.user || result.data?.user);
  if (!user || !user.email || user.emailVerified !== true) return null;
  return user;
}

/* ---------------- database (Neon over HTTPS) ---------------- */
let _sql = null;
function db() {
  if (_sql) return _sql;
  if (!env('DATABASE_URL')) throw new HttpError(500, 'Server is not configured: DATABASE_URL is missing.');
  const { neon } = require('@neondatabase/serverless');
  _sql = neon(env('DATABASE_URL'));
  return _sql;
}
const q = (text, params = []) => db().query(text, params);
const one = async (text, params = []) => (await q(text, params))[0] || null;

/* ---------------- crypto ---------------- */
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const secretKey = () => {
  const k = env('APP_SECRET');
  if (k.length < 24) throw new HttpError(500, 'Server is not configured: APP_SECRET must be at least 24 characters.');
  return k;
};
const hmac = s => crypto.createHmac('sha256', secretKey()).update(String(s)).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const code6 = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
async function hashSecret(pw) {
  const salt = crypto.randomBytes(16), h = await scrypt(String(pw), salt, 64, SCRYPT);
  return `s1$${salt.toString('base64')}$${h.toString('base64')}`;
}
async function checkSecret(pw, stored) {
  try {
    const [v, s, h] = String(stored || '').split('$'); if (v !== 's1') return false;
    const want = Buffer.from(h, 'base64'), got = await scrypt(String(pw), Buffer.from(s, 'base64'), want.length, SCRYPT);
    return crypto.timingSafeEqual(got, want);
  } catch (e) { return false; }
}
const DUMMY_HASH = 's1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64'); // equalises login timing for unknown emails

const encKey = () => {
  const k = Buffer.from(env('APP_ENCRYPTION_KEY'), 'base64');
  if (k.length !== 32) throw new HttpError(500, 'Server is not configured: APP_ENCRYPTION_KEY must be 32 random bytes, base64 encoded.');
  return k;
};
function enc(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const d = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return ['e1', iv.toString('base64'), c.getAuthTag().toString('base64'), d.toString('base64')].join('.');
}
function dec(s) {
  const [v, iv, tag, d] = String(s || '').split('.'); if (v !== 'e1') throw new Error('bad ciphertext');
  const c = crypto.createDecipheriv('aes-256-gcm', encKey(), Buffer.from(iv, 'base64')); c.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([c.update(Buffer.from(d, 'base64')), c.final()]).toString('utf8');
}
/* short-lived signed tokens (used for the 2FA step of signing in) */
function sign(payload, ttlSec) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  return body + '.' + hmac('tok:' + body);
}
function unsign(tok) {
  const [body, sig] = String(tok || '').split('.'); if (!body || !sig || !safeEq(sig, hmac('tok:' + body))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() / 1000 ? p : null; } catch (e) { return null; }
}

/* ---------------- http helpers ---------------- */
const ipOf = req => String((req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')).split(',')[0].trim() || 'unknown';
function parseCookies(req) {
  const out = {}; String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
const COOKIE = 'strap_sid', SESSION_DAYS = 30;
function setCookie(res, value, maxAgeSec) {
  const parts = [`${COOKIE}=${value ? encodeURIComponent(value) : ''}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
  if (isSecure()) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body); } catch (e) { throw new HttpError(400, 'Invalid request.'); } }
  return {};
}
const send = (res, status, body) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(body)); };

/* ---------------- validation ---------------- */
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normEmail = v => String(v || '').trim().toLowerCase();
const isEmail = v => emailRe.test(v) && v.length <= 254;
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const pwProblem = p => String(p || '').length < 8 ? 'Use at least 8 characters.' : (!/[a-z]/i.test(p) || !/\d/.test(p)) ? 'Include a letter and a number.' : String(p).length > 200 ? 'That password is too long.' : '';
function normPhone(v) {
  let d = String(v || '').replace(/[^\d+]/g, ''); if (d.startsWith('+')) return d.slice(1).replace(/\D/g, '');
  d = d.replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0') && d.length === 11) d = '234' + d.slice(1);
  return d;
}

/* ---------------- rate limiting (stored in Neon) ---------------- */
async function rate(key, max, windowSec, msg) {
  const r = await one(
    `insert into rate_limits(key, count, reset_at) values ($1, 1, now() + make_interval(secs => $2::int))
     on conflict (key) do update set
       count    = case when rate_limits.reset_at < now() then 1 else rate_limits.count + 1 end,
       reset_at = case when rate_limits.reset_at < now() then now() + make_interval(secs => $2::int) else rate_limits.reset_at end
     returning count`, [key, windowSec]);
  if (r && r.count > max) throw new HttpError(429, msg || 'Too many attempts. Please wait a few minutes and try again.');
}

/* ---------------- sessions ---------------- */
async function startSession(req, res, userId) {
  const token = rand(32);
  await q('insert into sessions(user_id, token_hash, expires_at, ip, ua) values ($1,$2, now() + make_interval(days => $3::int), $4, $5)',
    [userId, sha256(token), SESSION_DAYS, ipOf(req), str(req.headers['user-agent'], 300)]);
  setCookie(res, token, SESSION_DAYS * 86400);
}
async function endSession(req, res) {
  const t = parseCookies(req)[COOKIE]; if (t) await q('delete from sessions where token_hash = $1', [sha256(t)]);
  setCookie(res, '', 0);
}
/* returns { user, store } or null */
async function auth(req) {
  const identity = await neonSession(req); if (!identity) return null;
  const r = await one(
    `select u.id as user_id, u.email, u.name, u.phone, u.status, u.totp_enabled, u.backup_email, u.backup_phone, u.activity_pin is not null as has_pin,
            s.id as store_id, s.bizname, s.country, s.currency, s.profile
       from users u join stores s on s.owner_id = u.id and s.deleted_at is null
      where lower(u.email) = lower($1) and u.status <> 'deleted' limit 1`, [identity.email]);
  if (!r) return null;
  if (r.totp_enabled) {
    const token = neonSessionToken(req);
    if (!token || !(await one('select 1 from auth_mfa_sessions where token_hash = $1 and user_id = $2 and expires_at > now()', [token, r.user_id]))) return null;
  }
  return {
    user: { id: r.user_id, email: r.email, name: r.name, phone: r.phone, status: r.status, totp: r.totp_enabled, backupEmail: r.backup_email, backupPhone: r.backup_phone, hasPin: r.has_pin },
    store: { id: r.store_id, bizname: r.bizname, country: r.country, currency: r.currency, profile: r.profile || {} }
  };
}
async function audit(req, a, action, meta) {
  try { await q('insert into audit_log(store_id, user_id, action, meta, ip) values ($1,$2,$3,$4::jsonb,$5)', [a?.store?.id || null, a?.user?.id || null, action, JSON.stringify(meta || {}), ipOf(req)]); } catch (e) {}
}

module.exports = { HttpError, env, appUrl, isSecure, devCodes, neonSession, neonSessionToken, db, q, one, sha256, hmac, rand, code6, safeEq, hashSecret, checkSecret, DUMMY_HASH, enc, dec, sign, unsign,
  ipOf, parseCookies, COOKIE, setCookie, readJson, send, emailRe, normEmail, isEmail, str, pwProblem, normPhone, rate, startSession, endSession, auth, audit };
