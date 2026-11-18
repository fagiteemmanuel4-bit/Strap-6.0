'use strict';
const C = require('../core');
const { q, one, env } = C;
const REQUIRED = ['DATABASE_URL', 'APP_URL', 'APP_SECRET', 'APP_ENCRYPTION_KEY', 'NEON_AUTH_BASE_URL', 'FLW_SECRET_KEY', 'FLW_WEBHOOK_SECRET_HASH', 'CRON_SECRET'];
const OPTIONAL = ['RESEND_API_KEY', 'EMAIL_FROM', 'TERMII_API_KEY', 'TERMII_SENDER_ID', 'SUPPORT_EMAIL', 'BASE_DOMAIN', 'VERCEL_API_TOKEN', 'VERCEL_PROJECT_ID'];
const TABLES = ['users', 'stores', 'sessions', 'auth_mfa_sessions', 'verification_codes', 'rate_limits', 'kv_state', 'media', 'subscriptions', 'payments', 'webhook_events', 'stores_public', 'orders', 'staff', 'account_deletions', 'review_requests', 'audit_log'];

async function health(c) {
  const out = { ok: true, time: new Date().toISOString() };
  const detailed = env('CRON_SECRET') && c.query.key === env('CRON_SECRET');
  try { await one('select 1 as ok'); out.db = true; } catch (e) { out.db = false; out.ok = false; if (detailed) out.dbError = String(e.message).slice(0, 200); }
  if (out.db) { try { const r = await q("select table_name from information_schema.tables where table_schema = 'public'"); const have = new Set(r.map(x => x.table_name)); const miss = TABLES.filter(t => !have.has(t)); out.schema = miss.length === 0; if (detailed) out.missingTables = miss; if (miss.length) out.ok = false; } catch (e) { out.schema = false; } }
  if (detailed) {
    out.missingRequired = REQUIRED.filter(k => !env(k)); out.missingOptional = OPTIONAL.filter(k => !env(k));
    if (env('APP_ENCRYPTION_KEY')) { try { out.encryptionKeyValid = Buffer.from(env('APP_ENCRYPTION_KEY'), 'base64').length === 32; } catch (e) { out.encryptionKeyValid = false; } }
    out.appUrlIsHttps = env('APP_URL').startsWith('https://');
    out.neonAuthConfigured = !!env('NEON_AUTH_BASE_URL');
    out.transactionalEmailConfigured = !!env('RESEND_API_KEY');
    out.smsConfigured = !!env('TERMII_API_KEY'); out.devCodesOn = env('DEV_SHOW_CODES') === 'true';
    if (env('FLW_SECRET_KEY')) { try { const r = await fetch('https://api.flutterwave.com/v3/balances', { headers: { Authorization: 'Bearer ' + env('FLW_SECRET_KEY') } }); out.flutterwaveKey = r.status === 401 ? 'rejected' : 'accepted'; out.flutterwaveMode = /^FLWSECK_TEST/.test(env('FLW_SECRET_KEY')) ? 'test' : 'live'; } catch (e) { out.flutterwaveKey = 'unreachable'; } }
    if (out.missingRequired.length) out.ok = false;
  }
  return out;
}
module.exports = { health };
