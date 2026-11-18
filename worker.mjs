'use strict';

import apiHandler from './api/[...path].js';

async function nodeRequest(request) {
  const headers = Object.fromEntries(request.headers.entries());
  headers['x-forwarded-for'] = request.headers.get('CF-Connecting-IP') || '';
  const url = new URL(request.url);
  return {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
    socket: { remoteAddress: request.headers.get('CF-Connecting-IP') || '' }
  };
}

async function runApi(request) {
  const responseHeaders = new Headers();
  let responseBody = '';
  let statusCode = 200;
  const response = {
    setHeader(name, value) { responseHeaders.set(name, value); },
    end(body = '') { responseBody = body; }
  };

  await apiHandler(await nodeRequest(request), {
    ...response,
    get statusCode() { return statusCode; },
    set statusCode(value) { statusCode = value; }
  });
  return new Response(responseBody, { status: statusCode, headers: responseHeaders });
}

async function proxyNeonAuth(request, baseUrl) {
  if (!baseUrl) return new Response('Neon Auth is not configured.', { status: 503 });
  const incoming = new URL(request.url);
  const authBase = new URL(baseUrl);
  const prefix = '/api/neon-auth';
  authBase.pathname = authBase.pathname.replace(/\/+$/, '') + incoming.pathname.slice(prefix.length);
  authBase.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-host', incoming.host);
  headers.set('x-forwarded-proto', incoming.protocol.slice(0, -1));
  headers.delete('host');
  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.clone().arrayBuffer();
  return fetch(new Request(authBase.toString(), init));
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/api/neon-auth' || url.pathname.startsWith('/api/neon-auth/')) {
    return proxyNeonAuth(request, env.NEON_AUTH_BASE_URL);
  }
  if (url.pathname.startsWith('/api/')) return runApi(request);

  if (url.pathname === '/') {
    const baseDomain = String(env.BASE_DOMAIN || 'strap.store').toLowerCase();
    const host = url.hostname.toLowerCase();
    if (host.endsWith('.' + baseDomain) && host !== 'www.' + baseDomain) {
      url.pathname = '/shop.html';
      return env.ASSETS.fetch(new Request(url.toString(), {
        method: request.method,
        headers: request.headers,
        redirect: request.redirect
      }));
    }
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error('worker request failed', error && error.stack || error);
      return Response.json({ ok: false, msg: 'Something went wrong on our side. Please try again.' }, { status: 500 });
    }
  },
  async scheduled(controller, env, ctx) {
    const origin = 'https://worker.internal';
    const request = new Request(origin + '/api/cron/renew', {
      headers: { Authorization: 'Bearer ' + (env.CRON_SECRET || '') }
    });
    ctx.waitUntil(handleRequest(request, env).then(async response => {
      if (!response.ok) console.error('scheduled renewal failed', response.status, await response.text());
    }));
  }
};
