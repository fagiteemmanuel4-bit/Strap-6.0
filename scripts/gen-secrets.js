// Run:  node scripts/gen-secrets.js   -> prints values for APP_SECRET and APP_ENCRYPTION_KEY
const c = require('crypto');
console.log('APP_SECRET=' + c.randomBytes(48).toString('base64url'));
console.log('APP_ENCRYPTION_KEY=' + c.randomBytes(32).toString('base64'));
console.log('CRON_SECRET=' + c.randomBytes(24).toString('base64url'));
console.log('FLW_WEBHOOK_SECRET_HASH=' + c.randomBytes(24).toString('base64url'));
