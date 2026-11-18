/* Strap – Online store: promo panel, setup flow, Online store page, connected Orders page, settings and storefront preview.
   The store itself is one JSON config (see storefront.js) kept in StrapStore. Backend calls live in StrapStore.api. */
window.StrapOnline = (() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const U = StrapUI, ic = U.ic, esc = U.esc, K = StrapKit, F = StrapFront, S = StrapStore;
  const sleep = ms => new Promise(r => setTimeout(r, ms)), reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const BASE = () => S.api.BASE_DOMAIN;
  let CTX = null; const views = new Set(); const refresh = () => views.forEach(f => f());
  const products = () => { try { return StrapFeatures.items() || []; } catch (e) { return []; } };
  const activeCount = c => F.catalog(c, products()).length;
  const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
  const url = c => c.domain.type === 'custom' && c.domain.status !== 'live' ? (c.domain.temp || c.domain.host) : c.domain.host;
  const ago = t => { const m = Math.max(1, Math.round((Date.now() - t) / 6e4)); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' hr ago' : Math.round(m / 1440) + ' d ago'; };
  const copy = async t => { try { await navigator.clipboard.writeText(t); } catch (e) { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (_) {} a.remove(); } };
  const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
  const toast = m => CTX && CTX.toast(m);
  const save = c => { S.setOnline(c); refresh(); };

  /* ---------- loading screen that rolls out the next screen ---------- */
  async function cover(msg, fn) {
    const L = $('#loader'), M = $('#loader-msg'); M.textContent = msg; L.className = 'loader'; L.hidden = false; void L.offsetWidth; L.classList.add('on');
    await sleep(reduced() ? 0 : 650); try { await fn(); } finally { await sleep(60); L.classList.add('out'); await sleep(reduced() ? 0 : 800); L.hidden = true; L.className = 'loader'; }
  }
  function overlay(cls, html) {
    const el = document.createElement('section'); el.className = 'os-screen ' + cls; el.innerHTML = html; document.body.appendChild(el); document.body.classList.add('pm-open'); void el.offsetWidth; el.classList.add('on');
    el.close = () => { el.remove(); if (!$('.os-screen,.fx-screen,.pm-layer.on')) document.body.classList.remove('pm-open'); }; return el;
  }
  function sheet(title, html, wire) {
    const w = document.createElement('div'); w.className = 'pm-layer';
    w.innerHTML = `<div class="pm-scrim"></div><section class="pm-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="pm-grab"><i></i></div><div class="pm-sh"><h2>${esc(title)}</h2><button type="button" class="pm-x" data-c aria-label="Close">${ic('close', 20, 2.2)}</button></div><div class="os-sb">${html}</div></section>`;
    document.body.appendChild(w); document.body.classList.add('pm-open'); void w.offsetWidth; w.classList.add('on');
    const close = () => { w.classList.remove('on'); setTimeout(() => { w.remove(); if (!$('.os-screen,.fx-screen,.pm-layer.on')) document.body.classList.remove('pm-open'); }, 380); };
    w.addEventListener('click', e => { if (e.target.closest('.pm-scrim') || e.target.closest('[data-c]')) close(); });
    wire && wire(w, close); return { el: w, close };
  }
  const fit = root => $$('.os-mini', root).forEach(m => m.style.setProperty('--k', (m.clientWidth / 360).toFixed(4)));
  const mini = (c, cls = '') => `<div class="os-mini ${cls}">${F.wrap(c, products())}</div>`;

  /* ---------- illustrations ---------- */
  const ill = done => `<svg class="os-ill" viewBox="0 0 240 170" fill="none" stroke="#0a0a0a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <ellipse cx="120" cy="156" rx="80" ry="7" fill="#0a0a0a" fill-opacity=".08" stroke="none"/><circle cx="120" cy="84" r="64" fill="${done ? '#fff' : '#e6f53a'}" stroke="none"/>
    <g class="os-fl"><rect x="72" y="76" width="96" height="70" rx="5" fill="#fff"/><path d="M64 76 74 46h92l10 30z" fill="#0a0a0a"/><path d="M92 46l-1 30M120 46v30M148 46l1 30" stroke="#e6f53a" stroke-width="2"/>
      <path d="M64 76a14 14 0 0 0 28 0 14 14 0 0 0 28 0 14 14 0 0 0 28 0 14 14 0 0 0 28 0z" fill="#0a0a0a"/>
      <rect x="108" y="106" width="24" height="40" rx="3" fill="#e6f53a"/><rect x="81" y="100" width="19" height="20" rx="3" fill="#fff"/><rect x="140" y="100" width="19" height="20" rx="3" fill="#fff"/></g>
    ${done ? `<g class="os-pop"><circle cx="190" cy="42" r="19" fill="#0a0a0a" stroke="none"/><path d="M180.5 42l7 7 13-14" stroke="#e6f53a" stroke-width="3.6"/></g>
      <path class="os-cf" d="M34 40l5 5M44 28v7M206 92l6-3M30 100l6 2" stroke-width="2.6"/><circle class="os-cf" cx="214" cy="64" r="3" fill="#0a0a0a" stroke="none"/><circle class="os-cf" cx="26" cy="72" r="3" fill="#e6f53a" stroke="#0a0a0a"/>`
      : `<g class="os-tag"><rect x="150" y="20" width="62" height="28" rx="14" fill="#0a0a0a" stroke="none"/><circle class="os-pulse" cx="166" cy="34" r="4.5" fill="#e6f53a" stroke="none"/><text x="176" y="38.5" fill="#fff" stroke="none" font-family="Sora,sans-serif" font-size="12" font-weight="700">LIVE</text></g>
      <path class="os-sp" d="M34 56v10M29 61h10"/><path class="os-sp s2" d="M208 112v8M204 116h8"/><circle class="os-sp s3" cx="40" cy="116" r="3" fill="#0a0a0a" stroke="none"/>`}</svg>`;

  /* =====================================================================
     1. Promo: slide-up panel (every login until the person creates a store)
     ===================================================================== */
  function promo(ctx) {
    CTX = ctx;
    if (S.online() || sessionStorage.getItem('strap.os.promo')) return;
    setTimeout(() => {
      if (S.online() || $('.os-screen,.fx-screen,.pm-layer.on') || document.body.classList.contains('pm-open')) return;
      const w = document.createElement('div'); w.className = 'os-promo';
      w.innerHTML = `<div class="os-pscrim"></div><section class="os-pp" role="dialog" aria-label="Online store is live"><button type="button" class="os-px" aria-label="Close">${ic('close', 20, 2.4)}</button>
        ${ill(false)}<span class="os-new">New</span><h2>Online store is live</h2><p>Take your shop beyond the counter. Get your own storefront, a link to share, and orders that land right here in Strap.</p>
        <button type="button" class="os-pill" data-cta>Create online store${ic('arrow', 20, 2.4)}</button></section>`;
      document.body.appendChild(w); void w.offsetWidth; w.classList.add('on');
      const close = () => { sessionStorage.setItem('strap.os.promo', '1'); w.classList.remove('on'); setTimeout(() => w.remove(), 500); };
      w.addEventListener('click', e => {
        if (e.target.closest('.os-px') || e.target.closest('.os-pscrim')) return close();
        if (e.target.closest('[data-cta]')) { close(); ctx.go('online'); }
      });
    }, 1700);
  }

  /* =====================================================================
     2. Setup flow
     ===================================================================== */
  const CATS = ['Fashion', 'Beauty', 'Food & drinks', 'Electronics', 'Home & living', 'Health', 'Other'];
  const FIELD = { name: 'Store name', email: 'Store email', phone: 'Phone number', country: 'Country', address: 'City or address', tagline: 'Short description (optional)' };
  const dnsRows = (host, token) => [['A', '@', '76.76.21.21'], ['CNAME', 'www', 'stores.' + BASE()], ['TXT', '_strap-verify', 'strap-verify=' + token]]
    .map(([t, n, v]) => `<div class="os-rec"><span class="os-rt">${t}</span><div><small>Name</small><b>${esc(n)}</b></div><div class="os-rv"><small>Value</small><b>${esc(v)}</b></div><button type="button" class="os-cp" data-copy="${esc(v)}" aria-label="Copy value">${ic('copy', 18, 2)}</button></div>`).join('');
  const dnsHelp = `<details class="os-help"><summary>Where do I add these?${ic('chevD', 18, 2)}</summary><ol><li>Sign in to where you bought your domain (GoDaddy, Namecheap, Cloudflare, Whogohost and so on).</li><li>Open <b>DNS settings</b> or <b>Manage DNS</b>.</li><li>Add each record above. Remove any old A record for the same name.</li><li>Come back here and tap <b>Verify domain</b>. It usually takes a few minutes, sometimes up to 48 hours.</li></ol></details>`;
  const dnsStatus = st => st === 'checking' ? `<div class="os-dst"><i class="os-spin"></i><div><b>Checking your records</b><small>This only takes a moment.</small></div></div>`
    : st === 'ok' ? `<div class="os-dst ok"><span>${ic('check', 20, 3)}</span><div><b>Domain connected</b><small>We’re setting up your secure HTTPS certificate.</small></div></div>`
    : st === 'fail' ? `<div class="os-dst bad"><span>${ic('warn', 20, 2.2)}</span><div><b>We can’t see the records yet</b><small>DNS changes can take up to 48 hours. You can retry, or finish setup and verify later.</small></div></div>` : '';

  function setup(ctx) {
    CTX = ctx;
    cover('Getting things ready', async () => {
      const c = F.blank('fresh'); c.currency = ctx.cur || 'NGN'; c.contact.email = (ctx.store && (ctx.store.email || ctx.store.contactEmail)) || '';
      const D = { step: 'details', c, mode: 'sub', sub: slug(ctx.store && ctx.store.bizname), subState: 'idle', custom: '', dns: 'idle', token: rand(10), sync: 'auto', done: false };
      const el = overlay('os-flow', `<div class="os-in"><header class="os-top"><button type="button" class="os-bk" data-act="bk" aria-label="Back">${ic('back', 22, 2.4)}</button><div class="os-seg" id="os-seg"></div></header><div class="os-body" id="osb"></div></div>`);
      const body = $('#osb', el), order = () => D.mode === 'custom' ? ['details', 'template', 'domain', 'dns', 'products', 'review'] : ['details', 'template', 'domain', 'products', 'review'];
      const fld = (k, type = 'text', ph = '', extra = '') => `<div class="os-fg" data-fg="${k}"><label for="f-${k}">${FIELD[k]}</label><input class="os-fi" id="f-${k}" data-f="${k}" type="${type}" placeholder="${esc(ph)}" value="${esc(k === 'name' || k === 'tagline' ? c[k] : c.contact[k])}" autocomplete="off" ${extra}><p class="os-err"></p></div>`;
      const head = (h, p) => `<h1 class="os-h">${h}</h1><p class="os-p">${p}</p>`;
      const foot = (label, extra = '', dis = false) => `<div class="os-foot">${extra}<button type="button" class="os-pill" data-act="next" ${dis ? 'disabled' : ''}>${label}</button></div>`;
      const customHost = () => D.custom.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').trim().toLowerCase();
      const okCustom = () => /^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/.test(customHost());
      const canNext = () => D.step === 'domain' ? (D.mode === 'sub' ? D.subState === 'ok' : okCustom()) : D.step === 'dns' ? D.dns === 'ok' : true;
      const sync = () => { const b = $('[data-act=next]', el); if (b) b.disabled = !canNext(); };

      const ST = {
        details: () => head('Tell us about your store', 'We’ll use this to set up your storefront and let customers reach you.') + `<div class="os-fields">${fld('name', 'text', 'e.g. Ada’s Closet', 'maxlength="40"')}${fld('email', 'email', 'orders@example.com')}${fld('phone', 'tel', '+234 801 234 5678')}
          <div class="os-fg" data-fg="category"><label>What do you sell?</label><div class="os-chips">${CATS.map(x => `<button type="button" class="os-chip${c.contact.category === x ? ' on' : ''}" data-act="cat" data-v="${esc(x)}">${x}</button>`).join('')}</div><p class="os-err"></p></div>
          ${fld('country', 'text', 'e.g. Nigeria')}${fld('address', 'text', 'e.g. Lekki, Lagos')}${fld('tagline', 'text', 'Good things, delivered', 'maxlength="80"')}</div>` + foot('Continue'),
        template: () => head('Pick a look', 'Choose a starting point. You can change colours, fonts and layout any time in settings.') + `<div class="os-tpls">${Object.entries(F.TEMPLATES).map(([id, t]) => { const p = F.applyTemplate(JSON.parse(JSON.stringify(c)), id); return `<div role="button" tabindex="0" class="os-tpl${c.template === id ? ' on' : ''}" data-act="tpl" data-v="${id}">${mini(p)}<b>${t.name}</b><small>${t.note}</small></div>`; }).join('')}</div>` + foot('Continue'),
        domain: () => head('Where should your store live?', 'Use a free Strap address, or connect a domain you already own.') + `<div class="os-opts">
          <div class="os-opt${D.mode === 'sub' ? ' on' : ''}"><button type="button" class="os-ob" data-act="mode" data-v="sub"><i class="os-rd"></i><div><b>Free Strap address</b><small>Ready in seconds, no setup</small></div></button>${D.mode === 'sub' ? `<div class="os-rev"><div class="os-dom"><input class="os-fi" data-f="sub" id="f-sub" value="${esc(D.sub)}" placeholder="yourstore" maxlength="30" autocapitalize="off" autocomplete="off" spellcheck="false"><span>.${BASE()}</span></div><p class="os-st" id="sub-st"></p></div>` : ''}</div>
          <div class="os-opt${D.mode === 'custom' ? ' on' : ''}"><button type="button" class="os-ob" data-act="mode" data-v="custom"><i class="os-rd"></i><div><b>A domain I own</b><small>Like mybrand.com. We’ll guide you through it</small></div></button>${D.mode === 'custom' ? `<div class="os-rev"><div class="os-dom"><input class="os-fi" data-f="custom" id="f-custom" value="${esc(D.custom)}" placeholder="mybrand.com" autocapitalize="off" autocomplete="off" spellcheck="false"></div><p class="os-st" id="cu-st">Enter the domain without https:// or www.</p></div>` : ''}</div></div>` + foot(D.mode === 'custom' ? 'Continue to DNS setup' : 'Continue', '', !canNext()),
        dns: () => head('Connect ' + esc(customHost()), 'Add these three records at your domain provider so customers can reach your store.') + `<div class="os-recs">${dnsRows(customHost(), D.token)}</div>${dnsHelp}<div id="dns-st">${dnsStatus(D.dns)}</div>` +
          `<div class="os-foot"><button type="button" class="os-pill" data-act="${D.dns === 'ok' ? 'next' : 'verify'}" ${D.dns === 'checking' ? 'disabled' : ''}>${D.dns === 'ok' ? 'Continue' : D.dns === 'fail' ? 'Try again' : 'Verify domain'}</button>${D.dns === 'ok' ? '' : '<button type="button" class="os-link" data-act="later">I’ll verify later</button>'}</div>`,
        products: () => { const n = F.catalog({ sync: 'auto' }, products()).length; return head('Your products', 'Choose how products get into your online store.') + `<div class="os-opts">
          <button type="button" class="os-opt os-ob${D.sync === 'auto' ? ' on' : ''}" data-act="sync" data-v="auto"><i class="os-rd"></i><div><b>Add my products automatically</b><small>${n ? n + ' active product' + (n === 1 ? '' : 's') + ' will be added, and new ones sync as you create them' : 'New products sync to your store as you create them'}</small></div></button>
          <button type="button" class="os-opt os-ob${D.sync === 'manual' ? ' on' : ''}" data-act="sync" data-v="manual"><i class="os-rd"></i><div><b>I’ll add them myself</b><small>Start empty and pick which products appear in your store</small></div></button></div>` + foot('Continue'); },
        review: () => { const host = D.mode === 'sub' ? D.sub + '.' + BASE() : customHost(); return head('Ready to launch?', 'Check everything looks right. You can edit any of it later.') + `<div class="os-sum">
          ${[['Store', c.name, 'details'], ['Contact', c.contact.email + ' · ' + c.contact.phone, 'details'], ['Location', [c.contact.address, c.contact.country].join(', '), 'details'], ['Look', F.TEMPLATES[c.template].name, 'template'], ['Address', host + (D.mode === 'custom' && D.dns !== 'ok' ? ' (verify later)' : ''), 'domain'], ['Products', D.sync === 'auto' ? 'Added automatically' : 'Added manually', 'products']]
            .map(([l, v, s]) => `<div class="os-sr"><div><small>${l}</small><b>${esc(v)}</b></div><button type="button" data-act="edit" data-v="${s}">Edit</button></div>`).join('')}</div>` + foot('Launch my store'); },
      };

      const subPaint = () => { const p = $('#sub-st', el); if (!p) return sync(); const m = { idle: ['', ''], bad: ['Use 3 to 30 letters, numbers or hyphens.', 'bad'], checking: ['Checking availability…', ''], ok: [D.sub + '.' + BASE() + ' is available', 'ok'], taken: ['That address is taken. Try another.', 'bad'] }[D.subState]; p.textContent = m[0]; p.className = 'os-st ' + m[1]; sync(); };
      let rid = 0, tm = 0;
      const subCheck = async () => {
        const v = D.sub; if (!v) D.subState = 'idle'; else if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(v)) D.subState = 'bad';
        else { D.subState = 'checking'; subPaint(); const id = ++rid, r = await S.api.checkSubdomain(v); if (id !== rid) return; D.subState = r.available ? 'ok' : 'taken'; }
        subPaint();
      };

      function draw(dir = 'f') {
        const o = order(), i = o.indexOf(D.step);
        $('#os-seg', el).innerHTML = o.map((k, j) => `<i class="${j <= i ? 'on' : ''}"></i>`).join('');
        $('.os-top', el).hidden = D.done; body.className = 'os-body ' + dir; body.innerHTML = ST[D.step](); el.scrollTop = 0;
        if (D.step === 'template') fit(el);
        if (D.step === 'domain' && D.mode === 'sub') { if (D.sub && D.subState === 'idle') subCheck(); else subPaint(); }
      }
      const go = (s, dir) => { D.step = s; draw(dir); };
      const nextOf = () => order()[order().indexOf(D.step) + 1];

      function validate() {
        const v = { name: c.name.trim().length >= 2 ? '' : 'Enter your store name.', email: /^\S+@\S+\.\S+$/.test(c.contact.email) ? '' : 'Enter a valid email address.', phone: c.contact.phone.replace(/\D/g, '').length >= 7 ? '' : 'Enter a valid phone number.',
          category: c.contact.category ? '' : 'Choose what you sell.', country: c.contact.country.trim() ? '' : 'Enter your country.', address: c.contact.address.trim() ? '' : 'Enter your city or address.' };
        let first = null;
        Object.entries(v).forEach(([k, m]) => { const g = $(`[data-fg=${k}]`, el); if (!g) return; g.classList.toggle('bad', !!m); $('.os-err', g).textContent = m; if (m && !first) first = g; });
        if (first) { first.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); const i = $('input', first); i && i.focus({ preventScroll: true }); K.fx('err'); }
        return !first;
      }
      async function verify() { D.dns = 'checking'; draw('s'); const r = await S.api.verifyDomain(customHost(), D.token); D.dns = r.verified ? 'ok' : 'fail'; if (r.verified) K.fx('ok'); draw('s'); }

      async function launch() {
        c.sync = D.sync; c.productIds = []; c.createdAt = Date.now(); c.status = 'live';
        c.domain = D.mode === 'sub' ? { type: 'sub', host: D.sub + '.' + BASE(), status: 'live', token: '' } : { type: 'custom', host: customHost(), status: D.dns === 'ok' ? 'live' : 'pending', token: D.token, temp: (slug(c.name) || 'store') + '.' + BASE() };
        await cover('Launching your store', async () => {
          await S.api.createStore(c); S.setOnline(c); refresh(); D.done = true;
          const pend = c.domain.type === 'custom' && c.domain.status === 'pending';
          $('.os-top', el).hidden = true; body.className = 'os-body f done';
          body.innerHTML = `<div class="os-win">${ill(true)}<h1 class="os-h">Your store is live!</h1><p class="os-p">${pend ? 'Your domain is waiting on DNS. Until it’s verified, customers can shop at:' : 'Customers can now shop at:'}</p>
            <button type="button" class="os-url" data-copy="https://${esc(url(c))}"><span>${esc(url(c))}</span>${ic('copy', 18, 2)}</button>
            <div class="os-tags"><span>${F.TEMPLATES[c.template].name} look</span><span>${D.sync === 'auto' ? 'Products synced' : 'Add products manually'}</span>${pend ? '<span>Domain pending</span>' : ''}</div></div>
            <div class="os-foot"><button type="button" class="os-pill" data-act="open">Go to my online store${ic('arrow', 20, 2.4)}</button><button type="button" class="os-link" data-act="preview">Preview my store</button></div>`;
          el.scrollTop = 0; try { StrapFeatures.notify('account', 'Your online store is live', url(c)); } catch (e) {}
        });
        K.fx('ok');
      }

      async function leave() {
        if (D.step !== 'details' || c.name || c.contact.email || c.contact.phone) { if (!await K.confirm({ title: 'Leave setup?', body: 'Your answers won’t be saved.', ok: 'Leave', cancel: 'Keep going', icon: 'store' })) return; }
        cover('Going back', () => el.close());
      }

      el.addEventListener('click', async e => {
        const a = e.target.closest('[data-act]'), cp = e.target.closest('[data-copy]');
        if (cp) { await copy(cp.dataset.copy); return toast('Copied'); }
        if (!a) return; const act = a.dataset.act, v = a.dataset.v;
        if (act === 'bk') { const o = order(), i = o.indexOf(D.step); return i > 0 ? (D.dns === 'checking' ? 0 : go(o[i - 1], 'b')) : leave(); }
        if (act === 'cat') { c.contact.category = v; $$('.os-chip', el).forEach(x => x.classList.toggle('on', x.dataset.v === v)); $('[data-fg=category]', el).classList.remove('bad'); $('[data-fg=category] .os-err', el).textContent = ''; return; }
        if (act === 'tpl') { F.applyTemplate(c, v); $$('.os-tpl', el).forEach(x => x.classList.toggle('on', x.dataset.v === v)); return; }
        if (act === 'mode') { if (D.mode !== v) { D.mode = v; D.dns = 'idle'; draw('s'); const f = $('.os-opt.on input', el); f && f.focus(); } return; }
        if (act === 'sync') { D.sync = v; $$('.os-opt[data-act=sync]', el).forEach(x => x.classList.toggle('on', x.dataset.v === v)); return; }
        if (act === 'edit') return go(v, 'b');
        if (act === 'verify') return verify();
        if (act === 'later') { c.domain.status = 'pending'; return go('products'); }
        if (act === 'open') return cover('Opening your online store', () => { el.close(); ctx.go('online'); });
        if (act === 'preview') return preview(c);
        if (act === 'next') {
          if (D.step === 'details' && !validate()) return;
          if (D.step === 'review') return launch();
          if (D.step === 'domain' && D.mode === 'custom') { D.dns = 'idle'; D.custom = customHost(); }
          const n = nextOf(); if (n) go(n);
        }
      });
      el.addEventListener('input', e => {
        const f = e.target.dataset.f; if (!f) return; let v = e.target.value;
        if (f === 'name') { c.name = v; } else if (f === 'tagline') { c.tagline = v; } else if (f === 'sub') { v = D.sub = v.toLowerCase().replace(/[^a-z0-9-]/g, ''); D.subTouched = true; e.target.value = v; D.subState = 'idle'; clearTimeout(tm); tm = setTimeout(subCheck, 420); subPaint(); return; }
        else if (f === 'custom') { D.custom = v; sync(); const p = $('#cu-st', el); if (p) { const ok = okCustom() || !customHost(); p.className = 'os-st ' + (okCustom() ? 'ok' : ''); p.textContent = okCustom() ? customHost() + ' looks good' : 'Enter the domain without https:// or www.'; } return; }
        else c.contact[f] = v;
        const g = e.target.closest('.os-fg'); if (g) { g.classList.remove('bad'); $('.os-err', g).textContent = ''; }
        if (f === 'name' && !D.subTouched) { D.sub = slug(v); D.subState = 'idle'; }
      });
      el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.os-tpl')) { e.preventDefault(); return e.target.click(); } if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); const b = $('[data-act=next]', el); b && !b.disabled && b.click(); } });
      draw();
    });
  }

  /* =====================================================================
     3. Storefront preview (placing a test order here lands in Orders)
     ===================================================================== */
  function preview(c) {
    StrapShop.open(c, { products: products(), url: url(c), onOrder: () => refresh() });
  }

  /* =====================================================================
     4. Online store page
     ===================================================================== */
  function health(c) {
    const n = activeCount(c), o = S.orders(), d = c.domain;
    const rows = [
      ['Store is open', c.status === 'live', c.status === 'live' ? 'Taking orders' : 'Paused. Customers can’t order', 'Resume', 'resume'],
      ['Domain connected', d.type === 'sub' || d.status === 'live', d.type === 'sub' || d.status === 'live' ? 'Secure and reachable' : 'Waiting for DNS records', 'Verify', 'domain'],
      ['Products in store', n > 0, n > 0 ? n + ' product' + (n === 1 ? '' : 's') + ' showing' : 'Nothing to sell yet', 'Add', 'products'],
      ['Store details', !!(c.contact.email && c.contact.phone && c.contact.address), 'Contact and address', 'Fix', 'details'],
      ['First order', o.length > 0, o.length ? o.length + ' order' + (o.length === 1 ? '' : 's') + ' so far' : 'Share your link to get one', 'Share', 'share']
    ];
    const score = Math.round(rows.filter(r => r[1]).length / rows.length * 100);
    return { rows, score, label: score >= 80 ? 'Healthy' : score >= 50 ? 'Getting there' : 'Needs attention' };
  }
  const share = async c => { const u = 'https://' + url(c); if (navigator.share) { try { await navigator.share({ title: c.name, url: u }); return; } catch (e) { if (e && e.name === 'AbortError') return; } } await copy(u); toast('Store link copied'); };
  const setStatus = c => { c.status = c.status === 'live' ? 'paused' : 'live'; save(c); toast(c.status === 'live' ? 'Your store is open again' : 'Store paused'); };

  function page(root, ctx) {
    CTX = ctx; let menu = false;
    const hd = right => `<header class="pm-head"><h1 class="pm-title"><span class="pm-tico">${ic('store', 24, 1.8)}</span>Online store</h1>${right || ''}</header>`;
    function draw() {
      const c = S.online();
      if (!c) { root.innerHTML = hd() + `<div class="pg-empty os-empty">${ill(false)}<h2>Sell online with Strap</h2><p>Launch a storefront in a few minutes. Share one link, take orders, and manage everything from here.</p>
        <ul class="os-perks"><li>${ic('globe', 20, 1.9)}<span>Your own address or domain</span></li><li>${ic('layers', 20, 1.9)}<span>Beautiful templates, built from simple settings</span></li><li>${ic('inbox', 20, 1.9)}<span>Orders land in Strap automatically</span></li></ul>
        <button type="button" class="os-pill sm" data-act="create">Create online store${ic('arrow', 20, 2.4)}</button></div>`; return; }
      const h = health(c), r = 36, C = 2 * Math.PI * r, o = S.orders(), live = c.status === 'live', rev = o.filter(x => x.status !== 'cancelled').reduce((a, x) => a + x.total, 0), pend = o.filter(x => x.status === 'new').length;
      root.innerHTML = hd(`<button type="button" class="pm-round" data-act="menu" aria-haspopup="menu" aria-expanded="${menu}" aria-label="More options">${ic('dots', 22, 2)}</button>
        <div class="os-menu${menu ? ' on' : ''}" role="menu">${[['preview', 'eye', 'Preview store'], ['share', 'link', 'Share store link'], ['pause', live ? 'pause' : 'flash', live ? 'Pause store' : 'Resume store'], ['settings', 'gear', 'Settings']].map(([k, i, l]) => `<button type="button" role="menuitem" data-act="m-${k}">${ic(i, 20, 1.8)}<span>${l}</span></button>`).join('')}</div>`) + `
        <article class="os-hero"><div class="os-glow"></div><div class="os-ht"><div class="os-av">${esc((c.name.trim().charAt(0) || 'S').toUpperCase())}</div><div><b>${esc(c.name)}</b><span class="os-badge ${live ? 'on' : ''}">${live ? 'Live' : 'Paused'}</span></div></div>
          <div class="os-urlrow"><span>${esc(url(c))}</span><button type="button" data-copy="https://${esc(url(c))}" aria-label="Copy store link">${ic('copy', 18, 2)}</button><button type="button" data-act="m-preview" aria-label="Open preview">${ic('out', 18, 2)}</button></div>
          ${c.domain.type === 'custom' && c.domain.status !== 'live' ? `<button type="button" class="os-warn" data-act="fix-domain">${ic('warn', 16, 2.2)}<span>${esc(c.domain.host)} is waiting for DNS</span><em>Verify</em></button>` : ''}</article>
        <div class="os-stats"><div><small>Orders</small><b>${o.length}</b></div><div><small>Sales</small><b>${esc(ctx.money(rev))}</b></div><div><small>Products</small><b>${activeCount(c)}</b></div></div>
        <article class="os-card os-health"><div class="os-hh"><svg viewBox="0 0 88 88" class="os-ring"><circle cx="44" cy="44" r="${r}" fill="none" stroke="#ececea" stroke-width="9"/><circle cx="44" cy="44" r="${r}" fill="none" stroke="#0a0a0a" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - h.score / 100)}" transform="rotate(-90 44 44)"/><text x="44" y="50" text-anchor="middle" font-family="Sora,sans-serif" font-weight="700" font-size="20" fill="#0a0a0a">${h.score}</text></svg>
          <div><h2>Store health</h2><p>${h.label}</p></div></div>
          <ul>${h.rows.map(([t, ok, d, a, k]) => `<li class="${ok ? 'ok' : ''}"><span class="os-tick">${ok ? ic('check', 14, 3.2) : ''}</span><div><b>${t}</b><small>${d}</small></div>${ok ? '' : `<button type="button" data-act="fix-${k}">${a}</button>`}</li>`).join('')}</ul></article>
        <button type="button" class="os-link-card" data-act="orders"><span class="os-ic">${ic('inbox', 22, 1.8)}</span><div><b>Orders</b><small>${pend ? pend + ' new order' + (pend === 1 ? '' : 's') + ' to handle' : 'Orders from your store appear here'}</small></div>${ic('chevR', 18, 2)}</button>
        <button type="button" class="os-link-card" data-act="m-settings"><span class="os-ic">${ic('palette', 22, 1.8)}</span><div><b>${F.TEMPLATES[c.template] ? F.TEMPLATES[c.template].name : 'Custom'} look</b><small>Edit your name, fonts, colours and more</small></div>${ic('chevR', 18, 2)}</button>`;
    }
    root.addEventListener('click', async e => {
      const cp = e.target.closest('[data-copy]'); if (cp) { await copy(cp.dataset.copy); return toast('Store link copied'); }
      const a = e.target.closest('[data-act]'); if (!a) return; const act = a.dataset.act, c = S.online();
      if (act === 'create') return setup(ctx);
      if (act === 'menu') { menu = !menu; return draw(); }
      if (menu) { menu = false; }
      if (!c) return draw();
      if (act === 'm-preview') preview(c); else if (act === 'm-share' || act === 'fix-share') share(c);
      else if (act === 'm-pause' || act === 'fix-resume') setStatus(c);
      else if (act === 'm-settings') settings(ctx);
      else if (act === 'fix-domain') settings(ctx, 'domain'); else if (act === 'fix-products') settings(ctx, 'products'); else if (act === 'fix-details') settings(ctx, 'details');
      else if (act === 'orders') ctx.go('orders');
      draw();
    });
    document.addEventListener('click', e => { if (menu && !e.target.closest('.os-menu') && !e.target.closest('[data-act=menu]')) { menu = false; draw(); } });
    views.add(draw); draw();
    return { onShow: draw };
  }

  /* =====================================================================
     5. Orders (everything customers place on the storefront)
     ===================================================================== */
  const OST = { new: ['New', 'Start processing', 'processing'], processing: ['Processing', 'Mark as packaged', 'packed'], packed: ['Packaged', 'Mark as dispatched', 'dispatched'], dispatched: ['Dispatched', 'Mark as delivered', 'delivered'], delivered: ['Delivered'], fulfilled: ['Fulfilled'], cancelled: ['Cancelled'] };
  function orders(root, ctx) {
    CTX = ctx; let tab = 'all', query = '';
    const hd = right => `<header class="pm-head"><h1 class="pm-title"><span class="pm-tico">${ic('inbox', 24, 1.8)}</span>Orders</h1>${right || ''}</header>`;
    const lines = o => o.lines.map(l => `${l.qty} × ${l.title}`).join(', ');
    function draw() {
      const c = S.online(), all = S.orders();
      if (!c) { root.innerHTML = hd() + `<div class="pg-empty">${U.illus('orders')}<h2>Orders come from your online store</h2><p>Create your online store and every order your customers place will show up here.</p><button type="button" class="os-pill sm" data-act="create">Create online store${ic('arrow', 20, 2.4)}</button></div>`; return; }
      if (!all.length) { root.innerHTML = hd() + `<div class="pg-empty">${U.illus('orders')}<h2>No orders yet</h2><p>Share your store link. New orders from <b>${esc(url(c))}</b> show up here the moment they’re placed.</p><button type="button" class="os-pill sm" data-copy="https://${esc(url(c))}">Copy store link${ic('copy', 20, 2.2)}</button><button type="button" class="os-link" data-act="preview">Place a test order</button></div>`; return; }
      const cnt = k => k === 'all' ? all.length : all.filter(o => o.status === k).length, list = (tab === 'all' ? all : all.filter(o => o.status === tab)).filter(o=>!query||[o.id,o.tracking,o.customer?.name,o.customer?.phone,...(o.lines||[]).map(x=>x.title)].join(' ').toLowerCase().includes(query));
      root.innerHTML = hd(`<button type="button" class="pm-round" data-act="refresh" aria-label="Refresh orders">${ic('undo', 20, 2)}</button>`) + `<label class="os-lf"><span>Search orders</span><input data-order-search value="${esc(query)}" placeholder="Order number, customer, phone or product"></label><div class="os-tabs" role="tablist">${['all', 'new', 'processing', 'packed', 'dispatched', 'delivered', 'fulfilled', 'cancelled'].map(k => `<button type="button" role="tab" class="${tab === k ? 'on' : ''}" data-tab="${k}">${k === 'all' ? 'All' : OST[k][0]}<em>${cnt(k)}</em></button>`).join('')}</div>
        ${list.length ? `<ul class="os-olist">${list.map(o => `<li><button type="button" class="os-orow" data-o="${o.id}"><div class="os-oh"><b>${o.id}</b><span class="os-st-b ${o.status}">${OST[o.status][0]}</span></div><div class="os-ob2"><span>${esc(o.customer.name)}</span><strong>${esc(ctx.money(o.total))}</strong></div><small>${esc(lines(o))} · ${ago(o.ts)}</small></button></li>`).join('')}</ul>` : `<p class="os-none">No ${(OST[tab]?.[0]||'matching').toLowerCase()} orders.</p>`}`;
    }
    function detail(id) {
      const o = S.orders().find(x => x.id === id); if (!o) return; const st = OST[o.status];
      const s = sheet('Order ' + o.id, `<div class="os-od"><span class="os-st-b ${o.status}">${st[0]}</span><small>${new Date(o.ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · Online store</small><small>Tracking reference: <b>${esc(o.tracking||o.id)}</b></small></div>
        <div class="os-cust"><div><small>Customer</small><b>${esc(o.customer.name)}</b>${o.address?`<small>Delivery: ${esc(o.address)}</small>`:''}${o.note?`<small>Note: ${esc(o.note)}</small>`:''}${o.customer.email?`<small>Email: ${esc(o.customer.email)}</small>`:''}<small>Payment: ${esc(o.payment||'Not specified')} · ${o.paid?'Confirmed':'Awaiting confirmation'}</small><small>Payment reference: ${esc(o.paymentReference||'Not supplied')}</small></div><div class="os-ca"><a href="tel:${esc(o.customer.phone)}" aria-label="Call">${ic('phone', 20, 1.9)}</a><a href="https://wa.me/${esc(o.customer.phone.replace(/\D/g, ''))}" target="_blank" rel="noopener" aria-label="WhatsApp">${ic('chat', 20, 1.9)}</a></div></div>
        ${o.payment!=='cod'?`<div class="os-card"><b>Payment details</b><p>${esc(o.payment||'')}</p><p>Reference: ${esc(o.paymentReference||'Not supplied')}</p>${o.paymentProof?`<p>${esc(o.paymentProof.name||'Uploaded attachment')}</p>${o.paymentProof.data?`<a href="${o.paymentProof.data}" target="_blank" rel="noopener">View uploaded proof</a>`:''}`:''}${o.paid?'<span class="os-badge on">Payment confirmed</span>':`<button type="button" class="os-link" data-paid="${o.id}">Confirm payment received</button>`}</div>`:''}<div class="os-track"><b>Order timeline</b>${(o.events||[{status:o.status,at:o.ts,note:'Order received'}]).map(ev=>`<p><i></i><span>${esc(ev.note||ev.status)}<small>${new Date(ev.at).toLocaleString('en-GB')}</small></span></p>`).join('')}</div><ul class="os-ol">${o.lines.map(l => `<li><span>${l.qty} × ${esc(l.title)}</span><b>${esc(ctx.money(l.price * l.qty))}</b></li>`).join('')}<li class="t"><span>Total</span><b>${esc(ctx.money(o.total))}</b></li></ul>
        ${st[2] ? `<button type="button" class="pm-add wide" data-st="${st[2]}">${st[1]}</button>` : ''}${o.status === 'new' || o.status === 'processing' ? `<button type="button" class="os-link red" data-st="cancelled">Cancel order</button>` : ''}`, (w, close) => {
        w.addEventListener('click', async e => {
          const paid = e.target.closest('[data-paid]'); if(paid){S.setOrderPaid(o.id);close();draw();return toast('Payment confirmed');} const b = e.target.closest('[data-st]'); if (!b) return;
          if (b.dataset.st === 'cancelled' && !await K.confirm({ title: 'Cancel this order?', body: 'The customer won’t be notified automatically.', ok: 'Cancel order', cancel: 'Keep it', icon: 'warn', danger: true })) return;
          S.setOrderStatus(o.id, b.dataset.st); close(); draw(); refresh(); toast('Order ' + OST[b.dataset.st][0].toLowerCase());
        });
      });
    }
    root.addEventListener('click', async e => {
      const cp = e.target.closest('[data-copy]'); if (cp) { await copy(cp.dataset.copy); return toast('Store link copied'); }
      const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; return draw(); }
      const o = e.target.closest('[data-o]'); if (o) return detail(o.dataset.o);
      const a = e.target.closest('[data-act]'); if (!a) return;
      if (a.dataset.act === 'create') ctx.go('online'); else if (a.dataset.act === 'preview') preview(S.online());
      else if (a.dataset.act === 'refresh') { const n = (await S.api.pullOrders() || []).map(x => S.addOrder(x)).length; draw(); toast(n ? n + ' new order' + (n === 1 ? '' : 's') : 'You’re up to date'); }
    });
    root.addEventListener('input',e=>{if(e.target.matches('[data-order-search]')){query=e.target.value.trim().toLowerCase();const pos=e.target.selectionStart;draw();const q=$('[data-order-search]',root);if(q){q.focus();q.setSelectionRange(pos,pos);}}});
    views.add(draw); draw();
    return { onShow: async () => { draw(); try { const n = (await S.api.pullOrders() || []).map(x => S.addOrder(x)).length; if (n) draw(); } catch (e) {} } };
  }

  /* =====================================================================
     6. Settings
     ===================================================================== */
  function settings(ctx, start) {
    CTX = ctx; const c = S.online(); if (!c) return;
    const el = overlay('os-set', `<div class="os-sin" id="oss"></div>`), box = $('#oss', el), stack = start ? ['main', start] : ['main'];
    const Dm = { sub: '', state: 'idle', custom: '', dns: 'idle', adding: false };
    const hd = t => `<header class="pm-head"><button type="button" class="pm-round" data-act="back" aria-label="Back">${ic('back', 22, 2.2)}</button><h1 class="pm-title">${t}</h1></header>`;
    const row = (i, l, v, k) => `<button type="button" class="os-row" data-act="to" data-v="${k}"><span class="os-ic">${ic(i, 20, 1.8)}</span><span>${l}</span><b>${esc(v)}</b>${ic('chevR', 18, 2)}</button>`;
    const lf = (k, l, v, type = 'text') => `<label class="os-lf"><span>${l}</span><input data-s="${k}" type="${type}" value="${esc(v)}" autocomplete="off"></label>`;
    const seg = (key, opts, cur) => `<div class="os-segc">${opts.map(([v, l]) => `<button type="button" class="${String(cur) === String(v) ? 'on' : ''}" data-act="set" data-k="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;

    const V = {
      main: () => hd('Store settings') + `<div class="os-rows">${row('edit', 'Store details', c.name, 'details')}${row('palette', 'Appearance', (F.TEMPLATES[c.template] || { name: 'Custom' }).name + ' · ' + c.theme.font, 'appearance')}${row('globe', 'Domain', url(c), 'domain')}${row('bag', 'Products', c.sync === 'auto' ? 'Auto-sync' : 'Manual', 'products')}${row('wallet', 'Payments & checkout', c.payment?.mode || 'Configure', 'payments')}${row('users', 'Customer book', S.orders().length+' orders', 'customers')}${row('layers', 'Content & templates', 'Sections', 'tools')}</div>
        <div class="os-rows"><div class="os-row static"><span class="os-ic">${ic('store', 20, 1.8)}</span><span>Store is open</span><button type="button" class="os-sw${c.status === 'live' ? ' on' : ''}" data-act="live" role="switch" aria-checked="${c.status === 'live'}" aria-label="Store is open"></button></div></div>
        <button type="button" class="os-danger" data-act="del">${ic('trash', 20, 1.9)}Delete online store</button>`,
      details: () => hd('Store details') + lf('name', 'Store name', c.name) + lf('tagline', 'Short description', c.tagline) + lf('email', 'Store email', c.contact.email, 'email') + lf('phone', 'Phone number', c.contact.phone, 'tel') + lf('country', 'Country', c.contact.country) + lf('address', 'City or address', c.contact.address) + `<button type="button" class="pm-add wide" data-act="saved">Save changes</button>`,
      appearance: () => { const m = Object.keys(F.MODES).find(k => F.MODES[k].bg === c.theme.bg) || ''; return hd('Appearance') + mini(c, 'lg') + `
        <h2 class="pm-h">Template library · ${Object.keys(F.TEMPLATES).length} designs</h2><div class="os-template-grid">${Object.entries(F.TEMPLATES).map(([k,t])=>`<button type="button" class="os-template-card${c.template===k?' on':''}" data-act="set" data-k="template" data-v="${k}"><span class="os-template-swatch" style="--tpl:${t.theme.accent};--tplbg:${t.theme.bg}"><i></i><i></i><i></i></span><b>${t.name}</b><small>${t.note}</small>${c.template===k?'<em>Selected</em>':''}</button>`).join('')}</div>
        <h2 class="pm-h">Colours</h2>${seg('mode', Object.entries(F.MODES).map(([k, x]) => [k, x.l]), m)}<div class="os-sw-row">${F.ACCENTS.map(a => `<button type="button" class="os-dot${c.theme.accent === a ? ' on' : ''}" style="--c:${a}" data-act="set" data-k="accent" data-v="${a}" aria-label="Accent ${a}"></button>`).join('')}</div>
        <h2 class="pm-h">Font</h2><div class="os-chips2">${F.FONTS.map(f => `<button type="button" class="os-chip${c.theme.font === f ? ' on' : ''}" style="font-family:'${f}'" data-act="set" data-k="font" data-v="${f}">${f}</button>`).join('')}</div>
        <h2 class="pm-h">Corners</h2>${seg('radius', [[4, 'Sharp'], [12, 'Soft'], [20, 'Round']], c.theme.radius)}`; },
      tools: () => hd('Store content & templates') + `<p class="os-p2">Add or remove storefront sections, edit their text, and move them into the order customers see.</p><div class="os-rows">${c.sections.map((s,i)=>`<div class="os-row os-section-edit"><div><b>${esc(s.type)}</b><small>Section ${i+1}</small></div><button type="button" data-sec-up="${i}" aria-label="Move up">↑</button><button type="button" data-sec-down="${i}" aria-label="Move down">↓</button><button type="button" data-sec-del="${i}" aria-label="Remove section">×</button></div>${['title','text','cta','image','style','layout','question','answer'].filter(k=>s[k]!=null || (k==='title'&&s.type!=='footer')).slice(0,s.type==='billboard'?4:3).map(k=>`<label class="os-lf"><span>${k}</span><input data-section="${i}" data-field="${k}" value="${esc(s[k]||'')}"></label>`).join('')}`).join('')}</div><h2 class="pm-h">Add a section</h2><div class="os-chips2">${['announcement','billboard','banner','products','about','contact','testimonials','faq','policies','footer'].map(t=>`<button type="button" class="os-chip" data-add-section="${t}">+ ${t}</button>`).join('')}</div><h2 class="pm-h">Import / export template</h2><p class="os-p2">Import a Strap JSON or XML template. Your store name, products, domain, contact details and orders are kept; only the design (theme and sections) is applied.</p><input type="file" id="os-template-file" accept=".json,.xml,application/json,text/xml,application/xml"><div class="os-chips2"><button type="button" class="os-chip" data-export="json">Export JSON</button><button type="button" class="os-chip" data-export="xml">Export XML</button></div><details class="os-help"><summary>Template import rules</summary><ol><li>Use a Strap template exported as JSON or XML.</li><li>Required fields: version, theme and sections.</li><li>Up to 30 sections; each section must use a supported type.</li><li>Colours must be six-digit hex values (for example #e6f53a).</li><li>Imports change appearance and page sections only. They never replace products, orders, domain or account information.</li><li>Review the preview after importing. Unsupported or invalid files are rejected without changing your store.</li></ol></details>`,
      customers: () => { const all=S.orders(), by={}; all.forEach(o=>{const key=(o.customer?.email||o.customer?.phone||o.customer?.name||'').toLowerCase();if(!by[key])by[key]={customer:o.customer||{},orders:[]};by[key].orders.push(o);}); return hd('Customer book')+`<p class="os-p2">Customers who have placed an order with this store. Customer sign-in profiles are stored locally in this preview; connect a backend for a shared customer database.</p>${Object.values(by).length?`<div class="os-rows">${Object.values(by).map(x=>`<article class="os-row static"><span class="os-ic">${ic('user',20,1.8)}</span><span><b>${esc(x.customer.name||'Customer')}</b><small>${esc(x.customer.email||x.customer.phone||'')}</small><small>${x.orders.length} order${x.orders.length===1?'':'s'} · ${esc(x.orders.map(o=>o.id).join(', '))}</small></span></article>`).join('')}</div>`:'<div class="pg-empty"><h2>No customers yet</h2><p>Customers appear here after placing their first order.</p></div>'}`; },
      payments: () => { c.payment=c.payment||{mode:'transfer',allowProof:true}; const pm=c.payment; return hd('Payments & checkout')+`<p class="os-p2">Choose how customers pay. These are payment instructions and proof collection for the demo storefront; connect a payment provider for automatic charging.</p><h2 class="pm-h">Payment method</h2>${seg('paymode',[['transfer','Bank transfer'],['link','Payment link'],['both','Both methods'],['cod','Pay on delivery']],pm.mode||'transfer')}<h2 class="pm-h">Bank account details</h2>${lf('bankName','Bank name',pm.bankName||'')}${lf('accountName','Account name',pm.accountName||'')}${lf('accountNumber','Account number',pm.accountNumber||'')}<h2 class="pm-h">Payment link</h2>${lf('paymentLink','Checkout/payment URL',pm.paymentLink||'','url')}<div class="os-rows"><label class="os-row static"><span>Allow customers to upload payment proof</span><input type="checkbox" data-s="allowProof" ${pm.allowProof!==false?'checked':''}></label></div><button type="button" class="pm-add wide" data-act="savepayment">Save payment settings</button>`; },
      domain: () => {
        const cu = c.domain.type === 'custom';
        let h = hd('Domain') + `<article class="os-card"><small class="os-k">Your store address</small><b class="os-big">${esc(url(c))}</b>${cu ? `<span class="os-badge ${c.domain.status === 'live' ? 'on' : ''}">${c.domain.status === 'live' ? 'Domain connected' : 'Waiting for DNS'}</span>` : '<span class="os-badge on">Free Strap address</span>'}</article>`;
        if (cu && c.domain.status !== 'live') h += `<h2 class="pm-h">DNS records</h2><div class="os-recs">${dnsRows(c.domain.host, c.domain.token)}</div>${dnsHelp}<div id="dns-st">${dnsStatus(Dm.dns)}</div><button type="button" class="pm-add wide" data-act="verify" ${Dm.dns === 'checking' ? 'disabled' : ''}>Verify domain</button>`;
        if (!cu) h += `<h2 class="pm-h">Change address</h2><div class="os-dom light"><input class="os-fi" data-s="sub" value="${esc(Dm.sub)}" placeholder="${esc(c.domain.host.split('.')[0])}" maxlength="30" autocapitalize="off" spellcheck="false"><span>.${BASE()}</span></div><p class="os-st" id="sub-st"></p><button type="button" class="pm-add wide" data-act="savesub" ${Dm.state === 'ok' ? '' : 'disabled'}>Save address</button>`
          + `<h2 class="pm-h">Use a domain you own</h2>${Dm.adding ? `<div class="os-dom light"><input class="os-fi" data-s="custom" value="${esc(Dm.custom)}" placeholder="mybrand.com" autocapitalize="off" spellcheck="false"></div><button type="button" class="pm-add wide" data-act="addcustom">Continue to DNS setup</button>` : `<button type="button" class="pm-add wide alt" data-act="startcustom">Connect my domain</button>`}`;
        else h += `<button type="button" class="os-link" data-act="usesub">Switch back to a free Strap address</button>`;
        return h; },
      products: () => { const l = products().filter(p => !p.status || p.status === 'active'); return hd('Products') + `<p class="os-p2">Choose how products reach your online store.</p>` + seg('sync', [['auto', 'Auto-sync'], ['manual', 'Manual']], c.sync) +
        (c.sync === 'auto' ? `<p class="os-p2">Every active product is in your store, and new ones appear as you create them.</p>` : (l.length ? `<h2 class="pm-h">In your store <small>${(c.productIds || []).length} of ${l.length}</small></h2><ul class="os-pl">${l.map(p => `<li><button type="button" class="os-pr${(c.productIds || []).includes(p.id) ? ' on' : ''}" data-act="pick" data-v="${esc(p.id)}"><i>${ic('check', 14, 3.2)}</i><b>${esc(p.title)}</b><small>${esc(ctx.money(p.price || 0))}</small></button></li>`).join('')}</ul>` : `<p class="os-p2">You have no products yet. Add some from the Products page, then choose them here.</p>`)); }
    };
    const draw = () => { const y = el.scrollTop; box.innerHTML = V[stack[stack.length - 1]](); el.scrollTop = y; if (stack[stack.length - 1] === 'appearance') fit(el); if (stack[stack.length - 1] === 'domain') subPaint(); };
    const subPaint = () => { const p = $('#sub-st', el); if (!p) return; const m = { idle: ['', ''], bad: ['Use 3 to 30 letters, numbers or hyphens.', 'bad'], checking: ['Checking availability…', ''], ok: [Dm.sub + '.' + BASE() + ' is available', 'ok'], taken: ['That address is taken.', 'bad'] }[Dm.state]; p.textContent = m[0]; p.className = 'os-st ' + m[1]; const b = $('[data-act=savesub]', el); if (b) b.disabled = Dm.state !== 'ok'; };
    let tm = 0, rid = 0;

    el.addEventListener('click', async e => {
      const a = e.target.closest('[data-act], [data-sec-up], [data-sec-down], [data-sec-del], [data-add-section], [data-export]'); if (!a) return; const act = a.dataset.act, v = a.dataset.v;
      if (act === 'back') { if (stack.length > 1) { stack.pop(); return draw(); } return el.close(); }
      if (a.dataset.secUp != null || a.dataset.secDown != null || a.dataset.secDel != null) { const i=+(a.dataset.secUp??a.dataset.secDown??a.dataset.secDel); if(a.dataset.secDel!=null)c.sections.splice(i,1); else {const j=i+(a.dataset.secUp!=null?-1:1);if(j>=0&&j<c.sections.length)[c.sections[i],c.sections[j]]=[c.sections[j],c.sections[i]];} save(c);return draw(); }
      if (a.dataset.addSection) { const t=a.dataset.addSection, defaults={announcement:{type:t,text:'Welcome to our store'},billboard:{type:t,title:'A message worth noticing',text:'Share a promotion, launch or important update',cta:'Shop now'},banner:{type:t,title:'A little something special',text:'Discover our latest collection.'},products:{type:t,title:'Shop our products',layout:'grid'},about:{type:t,title:'About us',text:''},contact:{type:t,title:'Contact'},testimonials:{type:t,title:'What customers say',text:'Lovely quality and service.'},faq:{type:t,title:'FAQs',question:'How long does delivery take?',answer:'Contact us for delivery details.'},policies:{type:t,title:'Store policies',text:'Contact us for returns and delivery information.'},footer:{type:t}}; if(c.sections.length>=30)return toast('Maximum 30 sections');c.sections.push(defaults[t]);save(c);return draw();}
      if (a.dataset.export) { const data=a.dataset.export==='json'?JSON.stringify({format:'strap-template',version:1,config:{v:c.v||2,template:c.template,theme:c.theme,sections:c.sections}},null,2):F.toXml({v:c.v||2,template:c.template,theme:c.theme,sections:c.sections}); const blob=new Blob([data],{type:a.dataset.export==='json'?'application/json':'application/xml'}),u=URL.createObjectURL(blob),ln=document.createElement('a');ln.href=u;ln.download='strap-store-template.'+a.dataset.export;ln.click();URL.revokeObjectURL(u);return toast('Template exported');}
      if (act === 'savepayment') { const g=k=>$(`[data-s=${k}]`,el)?.value?.trim()||''; c.payment={...(c.payment||{}),mode:c.payment?.mode||'transfer',bankName:g('bankName'),accountName:g('accountName'),accountNumber:g('accountNumber'),paymentLink:g('paymentLink'),allowProof:$('[data-s=allowProof]',el)?.checked!==false}; save(c); toast('Payment settings saved'); return draw(); }
      if (act === 'to') { stack.push(v); el.scrollTop = 0; return draw(); }
      if (act === 'live') { setStatus(c); return draw(); }
      if (act === 'set') {
        const k = a.dataset.k;
        if (k === 'paymode') { c.payment=c.payment||{}; c.payment.mode=v; } else if (k === 'template') F.applyTemplate(c, v); else if (k === 'mode') { c.theme.bg = F.MODES[v].bg; c.theme.ink = F.MODES[v].ink; } else if (k === 'accent') c.theme.accent = v; else if (k === 'font') c.theme.font = v; else if (k === 'radius') c.theme.radius = +v;
        else if (k === 'sync') { c.sync = v; if (v === 'manual' && !(c.productIds || []).length) c.productIds = []; }
        save(c); return draw();
      }
      if (act === 'pick') { const s = new Set(c.productIds || []); s.has(v) ? s.delete(v) : s.add(v); c.productIds = [...s]; save(c); return draw(); }
      if (act === 'saved') {
        const g = k => $(`[data-s=${k}]`, el).value.trim();
        if (g('name').length < 2) return toast('Enter your store name');
        if (!/^\S+@\S+\.\S+$/.test(g('email'))) return toast('Enter a valid email address');
        if (g('phone').replace(/\D/g, '').length < 7) return toast('Enter a valid phone number');
        c.name = g('name'); c.tagline = g('tagline'); Object.assign(c.contact, { email: g('email'), phone: g('phone'), country: g('country'), address: g('address') }); save(c); K.fx('ok'); toast('Store details saved'); stack.pop(); return draw();
      }
      if (act === 'savesub') { c.domain.host = Dm.sub + '.' + BASE(); save(c); K.fx('ok'); toast('Store address updated'); Dm.sub = ''; Dm.state = 'idle'; return draw(); }
      if (act === 'usesub') { c.domain = { type: 'sub', host: c.domain.temp || slug(c.name) + '.' + BASE(), status: 'live', token: '' }; save(c); toast('Using your free Strap address'); return draw(); }
      if (act === 'startcustom') { Dm.adding = true; return draw(); }
      if (act === 'addcustom') {
        const h = Dm.custom.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').trim().toLowerCase();
        if (!/^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/.test(h)) { K.fx('err'); return toast('Enter a domain like mybrand.com'); }
        c.domain = { type: 'custom', host: h, status: 'pending', token: rand(10), temp: c.domain.host }; Dm.adding = false; Dm.dns = 'idle'; save(c); return draw();
      }
      if (act === 'verify') {
        Dm.dns = 'checking'; draw(); const r = await S.api.verifyDomain(c.domain.host, c.domain.token); Dm.dns = r.verified ? 'ok' : 'fail';
        if (r.verified) { c.domain.status = 'live'; save(c); K.fx('ok'); toast('Domain connected'); Dm.dns = 'idle'; } draw(); return;
      }
      if (act === 'del') {
        if (!await K.confirm({ title: 'Delete your online store?', body: 'Your store link stops working and its orders are removed from Strap. Your products stay.', ok: 'Delete store', cancel: 'Keep it', icon: 'trash', danger: true })) return;
        S.removeOnline(); refresh(); el.close(); toast('Online store deleted');
      }
    });
    el.addEventListener('input', e => {
      if (e.target.dataset.section != null) { const sec=c.sections[+e.target.dataset.section]; if(sec){sec[e.target.dataset.field]=e.target.value;save(c);} return; }
      const k = e.target.dataset.s;
      if(['bankName','accountName','accountNumber','paymentLink'].includes(k)){c.payment=c.payment||{};c.payment[k]=e.target.value;return;} if(k==='allowProof'){c.payment=c.payment||{};c.payment.allowProof=e.target.checked;return;}
      if (k === 'sub') { const v = Dm.sub = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); e.target.value = v; Dm.state = v ? (/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(v) ? 'checking' : 'bad') : 'idle'; subPaint(); clearTimeout(tm);
        if (Dm.state === 'checking') tm = setTimeout(async () => { const id = ++rid, r = await S.api.checkSubdomain(v); if (id !== rid) return; Dm.state = r.available ? 'ok' : 'taken'; subPaint(); }, 420); }
      else if (k === 'custom') Dm.custom = e.target.value;
    });
    el.addEventListener('change', async e=>{if(e.target.id!=='os-template-file'||!e.target.files[0])return;const f=e.target.files[0];try{box.classList.add('os-importing');const raw=await f.text();let obj=/\.xml$/i.test(f.name)?F.fromXml(raw):JSON.parse(raw);const t=F.validateImport(obj);c.theme={...c.theme,...t.theme};c.sections=JSON.parse(JSON.stringify(t.sections));if(t.template&&F.TEMPLATES[t.template])c.template=t.template;save(c);toast('Template imported. Preview your store.');draw();}catch(err){toast('Import failed: '+(err.message||'Invalid template'));}finally{box.classList.remove('os-importing');}e.target.value='';});
    window.addEventListener('resize', () => fit(el));
    draw();
  }

  return { promo, page, orders, setup, preview, settings };
})();
