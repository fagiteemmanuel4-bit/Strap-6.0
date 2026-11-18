'use strict';
/* RFC 6238 TOTP (Google Authenticator / Authy / 1Password compatible). */
const crypto = require('crypto');
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32encode = buf => { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += A[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
const b32decode = s => { let bits = ''; for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) bits += A.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const newSecret = () => b32encode(crypto.randomBytes(20));
function code(secret, t = Date.now()) {
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(ctr).digest(), o = h[h.length - 1] & 15;
  return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1000000).padStart(6, '0');
}
const verify = (secret, input) => { const c = String(input || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(c)) return false; return [-1, 0, 1].some(d => crypto.timingSafeEqual(Buffer.from(code(secret, Date.now() + d * 30000)), Buffer.from(c))); };
const uri = (secret, label) => `otpauth://totp/Strap:${encodeURIComponent(label)}?secret=${secret}&issuer=Strap&digits=6&period=30`;
module.exports = { newSecret, code, verify, uri, b32encode, b32decode };
