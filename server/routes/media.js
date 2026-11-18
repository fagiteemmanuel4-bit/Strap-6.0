'use strict';
const C = require('../core');
const { HttpError, q, one, sha256, rate } = C;
const MAX = 1.5 * 1024 * 1024;
const magicOk = (mime, b) => (mime === 'image/png' && b.slice(0, 4).toString('hex') === '89504e47') || (mime === 'image/jpeg' && b.slice(0, 3).toString('hex') === 'ffd8ff') ||
  (mime === 'image/gif' && b.slice(0, 4).toString() === 'GIF8') || (mime === 'image/webp' && b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP');

async function saveDataUrl(dataUrl, storeId) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'Use a PNG, JPG, WebP or GIF picture.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > MAX) throw new HttpError(413, 'That picture is too large (max 1.5 MB).');
  if (!magicOk(m[1], buf)) throw new HttpError(400, 'That file is not a valid picture.');
  const id = sha256(buf).slice(0, 40);
  await q("insert into media(id, store_id, mime, size, bytes) values ($1,$2,$3,$4, decode($5, 'hex')) on conflict (id) do nothing", [id, storeId, m[1], buf.length, buf.toString('hex')]);
  return (C.appUrl() || '') + '/api/media/' + id;
}
async function upload(c) {
  await rate('media:' + c.auth.user.id, 120, 3600, 'Too many uploads. Try again later.');
  return { ok: true, url: await saveDataUrl(c.body.dataUrl, c.auth.store.id) };
}
async function get(c) {
  const id = c.params.id; if (!/^[a-f0-9]{40}$/.test(id)) throw new HttpError(404, 'Not found.');
  const r = await one("select mime, encode(bytes, 'hex') as h from media where id = $1", [id]);
  if (!r) throw new HttpError(404, 'Not found.');
  return { __raw: true, status: 200, headers: { 'Content-Type': r.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" }, body: Buffer.from(r.h, 'hex') };
}
module.exports = { saveDataUrl, upload, get };
