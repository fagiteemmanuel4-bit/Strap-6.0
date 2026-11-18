'use strict';
/* Email (Resend) and SMS (Termii). With no keys set the message is only logged, and only if DEV_SHOW_CODES=true. */
const { HttpError, env, devCodes, normPhone } = require('./core');

async function sendEmail({ to, subject, text, html }) {
  if (!env('RESEND_API_KEY')) {
    if (devCodes()) { console.log('[dev email]', to, '|', subject, '|', text); return { ok: true, dev: true }; }
    throw new HttpError(503, 'Email sending is not set up yet. Add RESEND_API_KEY to the server settings.');
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: 'Bearer ' + env('RESEND_API_KEY'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env('EMAIL_FROM', 'Strap <onboarding@resend.dev>'), to: [to], subject, text, html: html || undefined })
  });
  if (!r.ok) { console.error('resend failed', r.status, (await r.text()).slice(0, 300)); throw new HttpError(502, 'We could not send the email. Please try again.'); }
  return { ok: true };
}

async function sendSms(to, text) {
  const num = normPhone(to);
  if (!env('TERMII_API_KEY')) {
    if (devCodes()) { console.log('[dev sms]', num, '|', text); return { ok: true, dev: true }; }
    throw new HttpError(503, 'SMS sending is not set up yet. Add TERMII_API_KEY to the server settings.');
  }
  const r = await fetch((env('TERMII_BASE_URL', 'https://api.ng.termii.com')).replace(/\/+$/, '') + '/api/sms/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: num, from: env('TERMII_SENDER_ID', 'Strap'), sms: text, type: 'plain', channel: env('TERMII_CHANNEL', 'generic'), api_key: env('TERMII_API_KEY') })
  });
  if (!r.ok) { console.error('termii failed', r.status, (await r.text()).slice(0, 300)); throw new HttpError(502, 'We could not send the SMS. Please try again.'); }
  return { ok: true };
}

const shell = (title, body) => `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#0a0a0a"><div style="font-weight:700;font-size:20px;margin-bottom:18px">Strap</div><h2 style="margin:0 0 12px;font-size:20px">${title}</h2>${body}<p style="color:#777;font-size:12px;margin-top:28px">If you didn't expect this email you can ignore it.</p></div>`;

const sendCode = (target, code, purpose) => {
  const why = { signup: 'verify your email and finish creating your account', reset: 'reset your password', contact: 'confirm your contact details', pin: 'set your activity PIN' }[purpose] || 'continue';
  if (target.includes('@')) return sendEmail({ to: target, subject: `${code} is your Strap code`, text: `Your Strap code is ${code}. Use it to ${why}. It expires in 10 minutes. Never share it with anyone.`,
    html: shell('Your Strap code', `<p>Use this code to ${why}:</p><p style="font-size:34px;letter-spacing:8px;font-weight:700;background:#e6f53a;display:inline-block;padding:10px 16px;border-radius:12px">${code}</p><p style="color:#555">It expires in 10 minutes. Never share it with anyone.</p>`) });
  return sendSms(target, `Your Strap code is ${code}. It expires in 10 minutes. Never share it.`);
};

module.exports = { sendEmail, sendSms, sendCode, shell };
