'use strict';
const C = require('../core');
const { HttpError, q, one, rate, ipOf, str, normEmail, isEmail, normPhone, pwProblem, hashSecret, checkSecret, DUMMY_HASH, hmac, code6, safeEq, startSession, endSession, audit } = C;
const { sendCode, sendEmail, shell } = require('../notify');
const totp = require('../totp');
const { LIMITS } = require('../plans');
const { saveDataUrl } = require('./media');

const PURPOSES = ['signup', 'reset', 'contact', 'pin'];
const kindOf = t => (String(t).includes('@') ? 'email' : 'phone');
const normTarget = t => (kindOf(t) === 'email' ? normEmail(t) : normPhone(t));

/* ---------- verification codes ---------- */
async function issueCode(target, purpose) {
  const code = code6();
  await q("update verification_codes set consumed_at = now() where target = $1 and purpose = $2 and consumed_at is null", [target, purpose]);
  await q("insert into verification_codes(target, purpose, code_hash, expires_at) values ($1,$2,$3, now() + interval '10 minutes')", [target, purpose, hmac(`${purpose}:${target}:${code}`)]);
  return code;
}
async function checkCode(target, purpose, code, consume) {
  const row = await one("select id, code_hash, attempts from verification_codes where target = $1 and purpose = $2 and consumed_at is null and expires_at > now() order by id desc limit 1", [target, purpose]);
  if (!row || row.attempts >= 5) return false;
  if (!safeEq(hmac(`${purpose}:${target}:${String(code).replace(/\D/g, '')}`), row.code_hash)) { await q('update verification_codes set attempts = attempts + 1 where id = $1', [row.id]); return false; }
  await q('update verification_codes set verified_at = coalesce(verified_at, now()), consumed_at = case when $2::boolean then now() else consumed_at end where id = $1', [row.id, !!consume]);
  return true;
}
const isVerified = async (target, purpose) => !!(await one("select id from verification_codes where target = $1 and purpose = $2 and verified_at is not null and consumed_at is null and verified_at > now() - interval '30 minutes' order by id desc limit 1", [target, purpose]));
const consumeVerified = (target, purpose) => q("update verification_codes set consumed_at = now() where target = $1 and purpose = $2 and consumed_at is null", [target, purpose]);

async function sendCodeRoute(c) {
  const purpose = str(c.body.purpose || 'signup', 20); if (!PURPOSES.includes(purpose)) throw new HttpError(400, 'Invalid request.');
  let target = normTarget(c.body.email || c.body.phone || c.body.target);
  if (!target) throw new HttpError(400, 'Enter a valid email or phone number.');
  if (kindOf(target) === 'email' && !isEmail(target)) throw new HttpError(400, 'That email doesn’t look right.');
  if (kindOf(target) === 'phone' && target.length < 8) throw new HttpError(400, 'Enter a valid phone number.');
  if (purpose === 'contact' || purpose === 'pin') { if (!c.auth) throw new HttpError(401, 'Please sign in first.'); }
  if (purpose === 'pin') target = c.auth.user.email;
  await rate('code-ip:' + ipOf(c.req), 25, 3600); await rate('code-t:' + target, 6, 900, 'Too many codes requested. Try again in a few minutes.');
  const last = await one("select created_at > now() - interval '25 seconds' as fresh from verification_codes where target = $1 and purpose = $2 order by id desc limit 1", [target, purpose]);
  if (last && last.fresh) throw new HttpError(429, 'Please wait a few seconds before asking for another code.');
  if (purpose === 'signup') { if (await one('select 1 from users where email = $1 and status <> $2', [target, 'deleted'])) return { ok: false, msg: 'An account with this email already exists. Log in instead.' }; }
  if (purpose === 'reset') { const u = await one("select 1 from users where email = $1 and status <> 'deleted'", [target]); if (!u) return { ok: true }; } // same answer either way
  const code = await issueCode(target, purpose);
  await sendCode(target, code, purpose);
  return { ok: true, ...(C.devCodes() ? { devCode: code } : {}) };
}
async function verifyCodeRoute(c) {
  const purpose = str(c.body.purpose || 'signup', 20), target = normTarget(c.body.email || c.body.phone || c.body.target);
  if (!PURPOSES.includes(purpose) || !target) throw new HttpError(400, 'Invalid request.');
  await rate('verify-ip:' + ipOf(c.req), 40, 900);
  if (purpose === 'pin' && c.auth) { const ok = await checkCode(c.auth.user.email, 'pin', c.body.code, false); return { ok }; }
  if (purpose === 'contact') {
    if (!c.auth) throw new HttpError(401, 'Please sign in first.');
    const ok = await checkCode(target, 'contact', c.body.code, true);
    if (ok) { if (kindOf(target) === 'email') await q('update users set backup_email = $2, updated_at = now() where id = $1', [c.auth.user.id, target]); else await q('update users set phone = $2, updated_at = now() where id = $1', [c.auth.user.id, target]); }
    return { ok };
  }
  return { ok: await checkCode(target, purpose, c.body.code, false) };
}

/* ---------- sign up / sign in ---------- */
const adult = dob => { const [y, m, d] = String(dob).split('-').map(Number); if (!y || !m || !d) return false; const n = new Date(); let a = n.getFullYear() - y; if (n.getMonth() + 1 < m || (n.getMonth() + 1 === m && n.getDate() < d)) a--; return y > 1900 && a >= 18; };

async function signup(c) {
  const d = c.body, identity = await C.neonSession(c.req), email = normEmail(identity && identity.email);
  if (!identity) throw new HttpError(401, 'Verify your email and sign in first.', { code: 'auth' });
  if (!isEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (normEmail(d.email) !== email) throw new HttpError(403, 'The signed-in email does not match this account.');
  const name = str(d.name, 80), bizname = str(d.bizname, 80);
  if (name.length < 2 || bizname.length < 2) throw new HttpError(400, 'Enter your name and business name.');
  if (!adult(d.dob)) throw new HttpError(400, 'You must be 18 or older.');
  await rate('signup-ip:' + ipOf(c.req), 10, 3600);
  const existing = await one("select id from users where lower(email) = $1 and status <> 'deleted'", [email]);
  if (existing) return { ok: true, existing: true };
  const currency = /^[A-Z]{3}$/.test(String(d.currency || '').toUpperCase()) ? String(d.currency).toUpperCase() : 'NGN';
  const profile = {};
  ['registered', 'regno', 'mode', 'branches', 'bcountry', 'state', 'city', 'street', 'landmark', 'postcode', 'hasSite', 'site', 'wantSite'].forEach(k => { if (d[k] !== undefined && d[k] !== null && d[k] !== '') profile[k] = typeof d[k] === 'string' ? str(d[k], 200) : d[k]; });
  let photoUrl = ''; if (d.photoUrl && String(d.photoUrl).startsWith('data:image/')) { try { photoUrl = await saveDataUrl(d.photoUrl, null); } catch (e) { photoUrl = ''; } }
  if (photoUrl) profile.photoUrl = photoUrl;
  let row;
  try {
    row = await one(
      `with u as (insert into users(email, name, password_hash, dob) values ($1,$2,'neon-auth-managed',$3) returning id),
            s as (insert into stores(owner_id, bizname, country, currency, profile) select id, $4, $5, $6, $7::jsonb from u returning id),
            sub as (insert into subscriptions(store_id) select id from s)
       select u.id as user_id, s.id as store_id from u, s`,
      [email, name, String(d.dob), bizname, str(d.country, 80), currency, JSON.stringify(profile)]);
  } catch (e) { if (e && (e.code === '23505' || /duplicate key/i.test(e.message || ''))) throw new HttpError(409, 'An account with this email already exists. Log in instead.'); throw e; }
  if (photoUrl) await q('update media set store_id = $1 where id = $2 and store_id is null', [row.store_id, photoUrl.split('/').pop()]);
  await audit(c.req, { user: { id: row.user_id }, store: { id: row.store_id } }, 'signup', {});
  return { ok: true };
}

async function login(c) {
  const email = normEmail(c.body.email), pw = String(c.body.password || '');
  await rate('login-ip:' + ipOf(c.req), 40, 900); await rate('login-e:' + email, 8, 900, 'Too many sign-in attempts. Wait 15 minutes or reset your password.');
  const u = await one("select id, password_hash, status, totp_enabled from users where email = $1", [email]);
  const good = await checkSecret(pw, u ? u.password_hash : DUMMY_HASH);
  if (!u || !good || u.status === 'deleted') throw new HttpError(401, 'Email or password is incorrect.');
  if (u.totp_enabled) return { ok: true, needs2fa: true, challenge: C.sign({ uid: u.id, t: '2fa' }, 300) };
  await startSession(c.req, c.res, u.id); await audit(c.req, { user: { id: u.id } }, 'login', {});
  return { ok: true };
}
async function login2fa(c) {
  const identity = await C.neonSession(c.req);
  if (!identity) throw new HttpError(401, 'Sign in again to continue.');
  const u = await one("select id, totp_secret, totp_enabled from users where lower(email) = lower($1) and status <> 'deleted'", [identity.email]);
  if (!u) throw new HttpError(404, 'Your Strap account has not been set up yet.');
  await rate('2fa:' + u.id, 8, 900, 'Too many attempts. Wait 15 minutes.');
  if (!u || !u.totp_enabled || !totp.verify(C.dec(u.totp_secret), c.body.code)) return { ok: false, msg: 'That code is not right. Check your authenticator app.' };
  const token = C.neonSessionToken(c.req);
  if (!token) throw new HttpError(401, 'Your Neon Auth session is missing. Sign in again.');
  await q('insert into auth_mfa_sessions(token_hash, user_id, expires_at) values ($1,$2,now() + interval \'30 days\') on conflict (token_hash) do update set user_id = excluded.user_id, expires_at = excluded.expires_at', [token, u.id]);
  await audit(c.req, { user: { id: u.id } }, 'login_2fa', {});
  return { ok: true };
}
async function logout(c) {
  const token = C.neonSessionToken(c.req);
  if (token) await q('delete from auth_mfa_sessions where token_hash = $1', [token]);
  await endSession(c.req, c.res);
  return { ok: true };
}

async function neonStatus(c) {
  const identity = await C.neonSession(c.req);
  if (!identity) return { ok: false, msg: 'Please sign in again.' };
  const user = await one("select id, totp_enabled from users where lower(email) = lower($1) and status <> 'deleted'", [identity.email]);
  return { ok: true, provisioned: !!user, needs2fa: !!(user && user.totp_enabled) };
}

async function legacyAuthDisabled() {
  throw new HttpError(410, 'Sign-in and password management now use Neon Auth.');
}

async function resetPassword(c) {
  const email = normEmail(c.body.email); const pw = pwProblem(c.body.password); if (pw) throw new HttpError(400, pw);
  await rate('reset-ip:' + ipOf(c.req), 15, 3600);
  if (!(await checkCode(email, 'reset', c.body.code, true))) return { ok: false, msg: 'That code is not valid. Request a new one.' };
  const u = await one("update users set password_hash = $2, updated_at = now() where email = $1 and status <> 'deleted' returning id", [email, await hashSecret(c.body.password)]);
  if (u) { await q('delete from sessions where user_id = $1', [u.id]); await audit(c.req, { user: { id: u.id } }, 'password_reset', {}); }
  return { ok: true };
}
async function changePassword(c) {
  const a = c.auth; const pw = pwProblem(c.body.next); if (pw) return { ok: false, msg: pw };
  await rate('chpw:' + a.user.id, 6, 900);
  const u = await one('select password_hash from users where id = $1', [a.user.id]);
  if (!(await checkSecret(c.body.current, u.password_hash))) return { ok: false, msg: 'Your current password is not correct.' };
  await q('update users set password_hash = $2, updated_at = now() where id = $1', [a.user.id, await hashSecret(c.body.next)]);
  const keep = C.parseCookies(c.req)[C.COOKIE]; await q('delete from sessions where user_id = $1 and token_hash <> $2', [a.user.id, C.sha256(keep || '')]);
  await audit(c.req, a, 'password_change', {}); return { ok: true };
}

/* ---------- two-factor (authenticator app) ---------- */
async function twofaSetup(c) {
  const secret = totp.newSecret();
  await q('update users set totp_secret = $2, totp_enabled = false, updated_at = now() where id = $1', [c.auth.user.id, C.enc(secret)]);
  return { ok: true, secret, uri: totp.uri(secret, `${c.auth.store.bizname}:${c.auth.user.email}`) };
}
async function twofaEnable(c) {
  await rate('2fa-en:' + c.auth.user.id, 10, 900);
  const u = await one('select totp_secret from users where id = $1', [c.auth.user.id]);
  if (!u || !u.totp_secret || !totp.verify(C.dec(u.totp_secret), c.body.code)) return { ok: false, msg: 'That code is not right.' };
  await q('update users set totp_enabled = true, updated_at = now() where id = $1', [c.auth.user.id]); await audit(c.req, c.auth, '2fa_on', {}); return { ok: true };
}
async function twofaDisable(c) {
  await rate('2fa-dis:' + c.auth.user.id, 6, 900);
  const u = await one('select password_hash, totp_secret from users where id = $1', [c.auth.user.id]);
  const byPw = c.body.password && await checkSecret(c.body.password, u.password_hash), byCode = c.body.code && u.totp_secret && totp.verify(C.dec(u.totp_secret), c.body.code);
  if (!byPw && !byCode) return { ok: false, msg: 'Confirm with your password or a code from your app.' };
  await q('update users set totp_enabled = false, totp_secret = null, updated_at = now() where id = $1', [c.auth.user.id]); await audit(c.req, c.auth, '2fa_off', {}); return { ok: true };
}

/* ---------- activity PIN (checked on the server, never in the browser) ---------- */
async function pinSet(c) {
  const pin = String(c.body.pin || ''); if (!/^\d{4}$/.test(pin)) throw new HttpError(400, 'Use a 4 digit PIN.');
  if (!(await isVerified(c.auth.user.email, 'pin'))) throw new HttpError(403, 'Verify the emailed code first.');
  await q('update users set activity_pin = $2, updated_at = now() where id = $1', [c.auth.user.id, await hashSecret(pin)]); await consumeVerified(c.auth.user.email, 'pin');
  await audit(c.req, c.auth, 'pin_set', {}); return { ok: true };
}
async function pinVerify(c) {
  await rate('pin:' + c.auth.user.id, 12, 900, 'Too many wrong PINs. Try again in a few minutes.');
  const u = await one('select activity_pin from users where id = $1', [c.auth.user.id]);
  return { ok: !!u && !!u.activity_pin && await checkSecret(String(c.body.pin || ''), u.activity_pin) };
}

/* ---------- account status, review, deletion ---------- */
async function accountStatus(c) { const u = await one('select status, review_ticket from users where id = $1', [c.auth.user.id]); return { ok: true, status: u.status, ticket: u.review_ticket || '' }; }
async function requestReview(c) {
  await rate('review:' + c.auth.user.id, 3, 86400, 'You already sent a request today.');
  const ticket = 'RV-' + String(Math.floor(10000 + Math.random() * 89999));
  await q('insert into review_requests(user_id, ticket, note, email, phone) values ($1,$2,$3,$4,$5)', [c.auth.user.id, ticket, str(c.body.note, 1000), str(c.body.email, 200), str(c.body.phone, 40)]);
  await q("update users set status = case when status = 'suspended' then 'review' else status end, review_ticket = $2 where id = $1", [c.auth.user.id, ticket]);
  try { if (C.env('SUPPORT_EMAIL')) await sendEmail({ to: C.env('SUPPORT_EMAIL'), subject: `Account review request ${ticket}`, text: `User ${c.auth.user.email} asked for a review.\n\n${str(c.body.note, 1000)}\n\nReply to: ${str(c.body.email, 200)} ${str(c.body.phone, 40)}` }); } catch (e) {}
  return { ok: true, ticket };
}
async function deleteAccount(c) {
  const a = c.auth; await rate('del:' + a.user.id, 5, 3600);
  const snap = { bizname: a.store.bizname, country: a.store.country, currency: a.store.currency, profile: a.store.profile, plan: (await one('select plan, status, current_period_end from subscriptions where store_id = $1', [a.store.id])) };
  await q('insert into account_deletions(user_id, store_id, email, snapshot, survey) values ($1,$2,$3,$4::jsonb,$5::jsonb)', [a.user.id, a.store.id, a.user.email, JSON.stringify(snap), JSON.stringify({ reasons: c.body.survey || [], note: str(c.body.note, 1000) })]);
  await q("update users set status = 'deleted', deleted_at = now(), email = 'deleted+' || id::text || '@deleted.invalid', phone = null, backup_email = null, backup_phone = null, totp_secret = null, totp_enabled = false, activity_pin = null where id = $1", [a.user.id]);
  await q('update stores set deleted_at = now() where id = $1', [a.store.id]);
  await q("update subscriptions set card_token = null, status = 'cancelled', cancel_at_period_end = true where store_id = $1", [a.store.id]);
  await q('update stores_public set published = false where store_id = $1', [a.store.id]);
  await q('delete from kv_state where store_id = $1', [a.store.id]); await q('delete from staff where store_id = $1', [a.store.id]);
  await q('delete from sessions where user_id = $1', [a.user.id]);
  C.setCookie(c.res, '', 0); return { ok: true };
}

async function profileUpdate(c) {
  const bizname = str(c.body.bizname, 80); if (bizname.length < 2) throw new HttpError(400, 'Enter a business name.');
  await q('update stores set bizname = $2 where id = $1', [c.auth.store.id, bizname]); return { ok: true };
}

/* ---------- staff ---------- */
async function staffCreate(c) {
  const a = c.auth, s = c.body, sub = await one('select plan, status, current_period_end from subscriptions where store_id = $1', [a.store.id]);
  const prem = sub && sub.plan === 'premium' && sub.status !== 'inactive' && new Date(sub.current_period_end) > new Date();
  const n = await one('select count(*)::int as n from staff where store_id = $1 and active', [a.store.id]);
  if (n.n >= LIMITS[prem ? 'premium' : 'free'].staff) throw new HttpError(402, 'You have reached the staff limit on your plan.', { code: 'plan_limit' });
  const id = str(s.id, 40), email = normEmail(s.email), pin = String(s.pin || '');
  if (!id || !isEmail(email) || str(s.name, 80).length < 2) throw new HttpError(400, 'Enter the staff name and email.');
  try { await q('insert into staff(id, store_id, name, email, role, branch_id, pin_hash) values ($1,$2,$3,$4,$5,$6,$7)', [id, a.store.id, str(s.name, 80), email, str(s.role, 40), str(s.branch, 40), /^\d{6}$/.test(pin) ? await hashSecret(pin) : null]); }
  catch (e) { if (e && (e.code === '23505' || /duplicate key/i.test(e.message || ''))) throw new HttpError(409, 'That staff email is already taken.'); throw e; }
  await audit(c.req, a, 'staff_add', { id }); return { ok: true };
}
async function staffRemove(c) { await q('delete from staff where store_id = $1 and id = $2', [c.auth.store.id, str(c.body.id, 40)]); return { ok: true }; }

module.exports = { sendCodeRoute, verifyCodeRoute, signup, login, login2fa, logout, neonStatus, legacyAuthDisabled, resetPassword, changePassword, twofaSetup, twofaEnable, twofaDisable, pinSet, pinVerify, accountStatus, requestReview, deleteAccount, profileUpdate, staffCreate, staffRemove };
