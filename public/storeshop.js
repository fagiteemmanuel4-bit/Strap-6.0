/* Strap – buyer app for the online store: home (JSON storefront) → product detail → cart → checkout → confirmation.
   Everything is themed by the store JSON (colours, font, corners). Orders are saved with StrapStore.addOrder.
   Buyer experience: orders are sent to the server through S.placeOrder. */
window.StrapShop = (() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const F = StrapFront, S = StrapStore, U = StrapUI, K = StrapKit, esc = U.esc, sleep = ms => new Promise(r => setTimeout(r, ms));
  const IC = {
    heart: '<path d="M12 20s-7-4.6-9-9.2C1.6 7.4 3.8 4 7 4c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.2 0 5.4 3.4 4 6.8C19 15.4 12 20 12 20z"/>',
    truck: '<path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/>',
    returns: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>', play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
    tag: '<path d="M20 12 12 20 4 12V4h8z"/><circle cx="8.5" cy="8.5" r="1.2"/>', bagx: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/>', note: '<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4"/>'
  };
  const ico = (k, s = 22, w = 1.9) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k] || U.P[k] || ''}</svg>`;
  const DEFAULT_PROMOS = [{ code: 'WELCOME10', type: 'pct', value: 10 }];

  // keep only harmless formatting from the product description editor
  const OK = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'UL', 'OL', 'LI', 'DIV', 'SPAN', 'H1', 'H2', 'H3']);
  const clean = html => {
    const d = new DOMParser().parseFromString('<body>' + (html || '') + '</body>', 'text/html');
    const walk = n => [...n.childNodes].forEach(c => {
      if (c.nodeType === 3) return; if (c.nodeType !== 1 || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED)$/.test(c.tagName)) return c.remove();
      if (OK.has(c.tagName)) { [...c.attributes].forEach(a => c.removeAttribute(a.name)); walk(c); } else { walk(c); c.replaceWith(...c.childNodes); }
    });
    walk(d.body); const t = d.body.innerHTML.trim(); return t && !/<(p|ul|ol|div|h\d)/i.test(t) ? '<p>' + t + '</p>' : t;
  };
  const isImg = u => /^(https?:|data:image|blob:)/.test(u || '');

  function open(cfg, o = {}) {
    const all = o.products || [], money = n => F.money(n, cfg.currency), ship = cfg.shipping || {};
    const prods = () => F.catalog(cfg, all), find = id => prods().find(p => String(p.id) === String(id));
    const soldOut = p => !!(p.tracked && !p.sellWhenOut && (+p.qty || 0) <= 0), maxQty = p => p.tracked && !p.sellWhenOut ? Math.max(0, +p.qty || 0) : 99;
    const groups = p => (p.options || []).filter(g => g && g.name && g.values && g.values.length);
    const media = p => { const m = (p.files || []).filter(f => f.url).map(f => ({ t: /^video/.test(f.type) ? 'video' : 'image', u: f.url })).filter(f => f.t === 'video' || isImg(f.u)); if (!m.some(x => x.t === 'image') && isImg(p.image)) m.unshift({ t: 'image', u: p.image }); return m; };
    const first = p => (media(p).find(x => x.t === 'image') || {}).u;
    const host = (cfg.domain && cfg.domain.host) || 'store', CK = 'strap.shop.cart.' + host, WK = 'strap.shop.wish.' + host;
    const cart = new Map(), wish = new Set(); let promo = null, note = '', method = 'delivery', pay = (cfg.payment?.mode==='cod'?'cod':cfg.payment?.mode==='link'?'link':'transfer'), proofFile = null; const form = { name: '', phone: '', email: '', addr: '', city: '' }; const CUSTOMER_KEY='strap.shop.customers.'+host; const customerBook=()=>{try{return JSON.parse(localStorage.getItem(CUSTOMER_KEY)||'[]')}catch(e){return[]}}; const saveCustomerBook=a=>{try{localStorage.setItem(CUSTOMER_KEY,JSON.stringify(a))}catch(e){toast('Customer storage is full on this preview device')}}; const digest=async v=>{try{const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}catch(e){return 'demo-'+v}};
    try { JSON.parse(sessionStorage.getItem(CK) || '[]').forEach(l => { const p = find(l.id); if (p) cart.set(l.k, { k: l.k, p, v: l.v || {}, qty: Math.min(l.qty, maxQty(p)) || 1 }); }); JSON.parse(sessionStorage.getItem(WK) || '[]').forEach(x => wish.add(x)); } catch (e) {}
    const persist = () => { try { sessionStorage.setItem(CK, JSON.stringify([...cart.values()].map(l => ({ k: l.k, id: l.p.id, v: l.v, qty: l.qty })))); sessionStorage.setItem(WK, JSON.stringify([...wish])); } catch (e) {} };
    const lines = () => [...cart.values()], count = () => lines().reduce((n, l) => n + l.qty, 0), sub = () => lines().reduce((n, l) => n + (+l.p.price || 0) * l.qty, 0);
    const promos = () => cfg.promos || DEFAULT_PROMOS;
    const disc = () => !promo ? 0 : Math.min(sub(), promo.type === 'pct' ? Math.round(sub() * promo.value / 100) : promo.value), net = () => sub() - disc();
    const freeOver = +ship.freeOver || 0, isFree = () => freeOver > 0 && net() >= freeOver, fee = () => isFree() ? 0 : (+ship.fee || 0), total = () => net() + (method === 'delivery' ? fee() : 0);
    const vtxt = v => Object.values(v).join(' · ');

    const app = document.createElement('section'); app.className = 'sh-app'; app.setAttribute('style', F.vars(cfg.theme || {}));
    app.innerHTML = `<div class="sh-sc sh-home on"><header class="sh-bar">${o.public ? '' : `<button type="button" class="sh-bx" data-act="close" aria-label="Close preview">${ico('close', 18, 2.4)}</button>`}<div class="sh-url">${ico('lock', 13, 2.4)}<span>${esc(o.url || host)}</span></div>${o.public ? '' : '<span class="sh-pv">Preview</span>'}</header><div class="sh-hbody">${F.wrap(cfg, all)}</div></div>`;
    document.body.appendChild(app); document.body.classList.add('pm-open'); void app.offsetWidth; app.classList.add('on');
    const stack = [];
    const paint = () => { const n = count(); $$('[data-cart-count]', app).forEach(e => { e.textContent = n; e.classList.toggle('z', !n); e.classList.remove('bump'); void e.offsetWidth; e.classList.add('bump'); }); };
    const toast = (msg, act) => { $$('.sh-toast', app).forEach(t => t.remove()); const t = document.createElement('div'); t.className = 'sh-toast'; t.innerHTML = `<span>${msg}</span>${act ? `<button type="button" data-act="cart">${act}</button>` : ''}`; app.appendChild(t); void t.offsetWidth; t.classList.add('on'); setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 300); }, 2600); };
    function mount(cls, htmlFn, after) {
      const el = document.createElement('section'); el.className = 'sh-sc ' + cls; app.appendChild(el);
      el.draw = () => { const sc = $('.sh-scroll', el), y = sc ? sc.scrollTop : 0; el.innerHTML = htmlFn(); const n = $('.sh-scroll', el); if (n) n.scrollTop = y; after && after(el); paint(); };
      el.draw(); void el.offsetWidth; el.classList.add('on'); stack.push(el); return el;
    }
    const pop = () => { const el = stack.pop(); if (!el) return; el.classList.remove('on'); el.classList.add('out'); setTimeout(() => el.remove(), 420); };
    const popTo = n => { while (stack.length > n) pop(); };
    const hd = (title, right = '') => `<header class="sh-hd"><button type="button" class="sh-ib" data-act="back" aria-label="Back">${ico('back', 22, 2.3)}</button><span class="sh-ht">${title}</span>${right}</header>`;
    const cartBtn = `<button type="button" class="sh-ib" data-act="cart" aria-label="Cart">${ico('bagx', 22, 1.9)}<em data-cart-count class="z">0</em></button>`;
    const thumb = (p, c = '') => `<div class="sh-th ${c}">${first(p) ? `<img src="${esc(first(p))}" alt="">` : `<span>${esc((p.title || '?').charAt(0).toUpperCase())}</span>`}</div>`;
    const big = (label, right = '', act = '', extra = '') => `<button type="button" class="sh-big" data-act="${act}" ${extra}><span>${label}</span>${right}</button>`;
    const arrow = `<i class="sh-ar">${ico('arrow', 20, 2.4)}</i>`;

    function addLine(p, v, qty) {
      const k = p.id + '|' + JSON.stringify(Object.keys(v).sort().map(x => [x, v[x]])), ex = cart.get(k), mx = maxQty(p), want = (ex ? ex.qty : 0) + qty;
      if (mx <= 0) return toast('This product is sold out');
      const q = Math.min(want, mx); if (want > mx) toast('Only ' + mx + ' available');
      cart.set(k, { k, p, v: { ...v }, qty: q }); persist(); paint(); K.fx('ok'); if (want <= mx) toast('Added to cart', 'View cart');
    }

    /* ---------------- product detail ---------------- */
    function detail(p) {
      const s = { sel: {}, qty: 1 }, md = media(p), gs = groups(p), out = soldOut(p), mx = maxQty(p), cmp = +p.compareAt > +p.price, off = cmp ? Math.round((1 - p.price / p.compareAt) * 100) : 0;
      const low = p.tracked && !p.sellWhenOut && p.qty > 0 && p.qty <= 5, desc = clean(p.description);
      const pol = (cfg.sections || []).find(x => x.type === 'policies'), rel = prods().filter(x => String(x.id) !== String(p.id)).slice(0, 6);
      const facts = [['Brand', p.vendor], ['Category', p.category], ['Menu type',p.foodType],['Portion',p.servingSize],['Preparation time',p.prepTime],['Ingredients',p.ingredients],['Dietary / allergens',p.dietary],['SKU', p.sku], ['Weight', p.weight ? p.weight + (p.weightUnit ? ' ' + p.weightUnit : '') : '']].filter(x => x[1]);
      const slides = md.length ? md.map(m => m.t === 'video' ? `<div class="sh-sl"><video src="${esc(m.u)}" controls playsinline preload="metadata" ${first(p) ? `poster="${esc(first(p))}"` : ''}></video></div>` : `<div class="sh-sl"><img src="${esc(m.u)}" alt="${esc(p.title)}"></div>`).join('') : `<div class="sh-sl ph"><span>${esc((p.title || '?').charAt(0).toUpperCase())}</span></div>`;
      const html = () => `${hd(esc(cfg.name || ''), `<button type="button" class="sh-ib heart${wish.has(p.id) ? ' on' : ''}" data-act="heart" aria-label="Save">${ico('heart', 22, 1.9)}</button>${cartBtn}`)}
        <div class="sh-scroll"><div class="sh-gal"><div class="sh-track">${slides}</div>${off && !out ? `<i class="sh-badge">-${off}%</i>` : ''}${out ? '<i class="sh-badge dk">Sold out</i>' : ''}${md.length > 1 ? `<span class="sh-ctr"><b>1</b> / ${md.length}</span><div class="sh-dots">${md.map((m, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}</div>
        <div class="sh-body"><div class="sh-meta"><span class="sh-brand">${esc(p.vendor || cfg.name || '')}</span><span class="sh-stock ${out ? 'no' : low ? 'low' : 'ok'}">${out ? 'Sold out' : low ? 'Only ' + p.qty + ' left' : 'In stock'}</span></div>
          <h1 class="sh-title">${esc(p.title)}</h1>
          <div class="sh-price"><b>${money(p.price)}</b>${cmp ? `<s>${money(p.compareAt)}</s><i>Save ${off}%</i>` : ''}</div>
          ${gs.map(g => `<div class="sh-opt" data-g="${esc(g.name)}"><div class="sh-oh"><b>${esc(g.name)}</b><em data-sel>Select</em></div><div class="sh-chips">${g.values.map(v => `<button type="button" class="sh-chip" data-act="opt" data-g="${esc(g.name)}" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div></div>`).join('')}
          <div class="sh-perks"><div>${ico('truck', 20)}<span><b>Delivery</b>${esc(ship.note || 'Calculated at checkout')}</span></div><div>${ico('returns', 20)}<span><b>Easy to ask</b>Questions or returns? Message the store.</span></div></div>
          ${desc ? `<details class="sh-acc" open><summary>Description${ico('chevD', 18, 2.2)}</summary><div class="sh-rich">${desc}</div></details>` : ''}
          ${facts.length ? `<details class="sh-acc"><summary>Product details${ico('chevD', 18, 2.2)}</summary><dl class="sh-facts">${facts.map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('')}</dl></details>` : ''}
          <details class="sh-acc"><summary>Delivery &amp; returns${ico('chevD', 18, 2.2)}</summary><div class="sh-rich"><p>${esc(ship.note || 'Delivery fees and times are confirmed at checkout.')}</p><p>${esc((pol && pol.text) || 'Contact the store for returns, exchanges and delivery information.')}</p></div></details>
          ${rel.length ? `<h2 class="sh-h2">You may also like</h2><div class="sh-rail">${rel.map(x => `<button type="button" class="sh-mini" data-act="open" data-id="${esc(x.id)}">${thumb(x)}<b>${esc(x.title)}</b><small>${money(x.price)}</small></button>`).join('')}</div>` : ''}
        </div></div>
        <div class="sh-cta"><div class="sh-qty"><button type="button" data-act="dq" data-d="-1" aria-label="Less">${ico('minus', 18, 2.4)}</button><b data-q>1</b><button type="button" data-act="dq" data-d="1" aria-label="More">${ico('plus', 18, 2.4)}</button></div>
          <button type="button" class="sh-big" data-act="add" ${out ? 'disabled' : ''}><span data-lab>${out ? 'Sold out' : 'Add to cart'}</span>${out ? '' : `<b data-tot>${money(p.price)}</b>`}</button></div>`;
      const el = mount('sh-pd', html, e => {
        const tr = $('.sh-track', e); if (!tr) return;
        tr.addEventListener('scroll', () => { const i = Math.round(tr.scrollLeft / tr.clientWidth); $$('.sh-dots i', e).forEach((d, j) => d.classList.toggle('on', j === i)); const c = $('.sh-ctr b', e); if (c) c.textContent = i + 1; }, { passive: true });
        $$('.sh-dots i', e).forEach((d, j) => d.addEventListener('click', () => tr.scrollTo({ left: j * tr.clientWidth, behavior: 'smooth' })));
      });
      el._d = { p, s, mx, gs };
    }

    /* ---------------- cart ---------------- */
    function cartScreen() {
      mount('sh-cart', () => {
        const ls = lines(), n = count();
        if (!ls.length) return hd('Cart') + `<div class="sh-scroll"><div class="sh-empty"><div class="sh-eb">${ico('bagx', 46, 1.5)}</div><h2>Your cart is empty</h2><p>Browse the store and add something you love.</p>${big('Start shopping', arrow, 'home')}</div></div>`;
        const left = Math.max(0, freeOver - net()), pct = freeOver ? Math.min(100, net() / freeOver * 100) : 0, more = prods().filter(x => !soldOut(x) && !ls.some(l => l.p.id === x.id)).slice(0, 6);
        return `${hd('Cart <em class="sh-cn">' + n + '</em>', `<button type="button" class="sh-ib" data-act="clear" aria-label="Clear cart">${ico('trash', 20, 1.9)}</button>`)}<div class="sh-scroll">
          ${freeOver ? `<div class="sh-free${isFree() ? ' ok' : ''}"><div class="sh-ft">${ico('truck', 18, 2)}<span>${isFree() ? 'You’ve unlocked <b>free delivery</b>' : 'Add <b>' + money(left) + '</b> more for free delivery'}</span></div><div class="sh-fb"><i style="width:${pct}%"></i></div></div>` : ''}
          <ul class="sh-lines">${ls.map(l => `<li class="sh-line" data-k="${esc(l.k)}">${thumb(l.p)}<div class="sh-li"><small>${esc(l.p.vendor || cfg.name || '')}</small><b>${esc(l.p.title)}</b>${Object.keys(l.v).length ? `<div class="sh-vcs">${Object.values(l.v).map(v => `<span>${esc(v)}</span>`).join('')}</div>` : ''}
            <div class="sh-lr"><div class="sh-qty sm"><button type="button" data-act="lq" data-k="${esc(l.k)}" data-d="-1" aria-label="Less">${ico('minus', 16, 2.4)}</button><b>${l.qty}</b><button type="button" data-act="lq" data-k="${esc(l.k)}" data-d="1" aria-label="More">${ico('plus', 16, 2.4)}</button></div><strong>${money(l.p.price * l.qty)}</strong></div></div>
            <button type="button" class="sh-rm" data-act="lrm" data-k="${esc(l.k)}" aria-label="Remove">${ico('close', 16, 2.4)}</button></li>`).join('')}</ul>
          ${more.length ? `<h2 class="sh-h2">Complete your order</h2><div class="sh-rail">${more.map(x => `<div class="sh-mini">${`<button type="button" class="sh-mo" data-act="open" data-id="${esc(x.id)}">${thumb(x)}<b>${esc(x.title)}</b></button>`}<div class="sh-mr"><small>${money(x.price)}</small><button type="button" class="sh-plus" data-act="up" data-id="${esc(x.id)}" aria-label="Add">${ico('plus', 16, 2.6)}</button></div></div>`).join('')}</div>` : ''}
          <div class="sh-box"><div class="sh-pr"><span>${ico('tag', 18, 2)}</span>${promo ? `<div class="sh-applied"><b>${esc(promo.code)}</b><small>${promo.type === 'pct' ? promo.value + '% off' : money(promo.value) + ' off'} applied</small></div><button type="button" class="sh-lnk" data-act="prm">Remove</button>` : `<input id="sh-code" placeholder="Promo code" autocapitalize="characters" autocomplete="off" spellcheck="false"><button type="button" class="sh-ap" data-act="pra">Apply</button>`}</div><p class="sh-pm" id="sh-pm">${promo ? '' : (cfg.promos ? '' : 'Preview tip: try WELCOME10')}</p>
            <details class="sh-acc flat" ${note ? 'open' : ''}><summary>${ico('note', 18, 2)}Add a note for the seller${ico('chevD', 18, 2.2)}</summary><textarea id="sh-note" rows="2" placeholder="Colour, gift message, delivery instructions…">${esc(note)}</textarea></details></div>
          <div class="sh-sum"><div><span>Subtotal</span><b>${money(sub())}</b></div>${disc() ? `<div class="ok"><span>Discount${promo ? ' · ' + esc(promo.code) : ''}</span><b>-${money(disc())}</b></div>` : ''}<div><span>Delivery</span><b>${isFree() ? 'Free' : (+ship.fee ? money(ship.fee) : 'At checkout')}</b></div><div class="t"><span>Total</span><b>${money(net() + (isFree() ? 0 : (+ship.fee || 0)))}</b></div></div>
          <div class="sh-trust"><span>${ico('shield', 16, 2)}Secure ordering</span><span>${ico('returns', 16, 2)}Easy returns</span><span>${ico('chat', 16, 2)}Seller support</span></div></div>
        <div class="sh-cta"><div class="sh-ctp"><small>${n} item${n === 1 ? '' : 's'}</small><b>${money(net() + (isFree() ? 0 : (+ship.fee || 0)))}</b></div>${big('Checkout', arrow, 'checkout')}</div>`;
      }, el => { const nt = $('#sh-note', el); if (nt) nt.addEventListener('input', () => { note = nt.value; }); });
    }
    const refreshCart = () => { const c = stack.find(e => e.classList.contains('sh-cart')); c && c.draw(); persist(); paint(); };

    /* ---------------- checkout ---------------- */
    const PAY = [['cod', 'Pay on delivery', 'Pay in cash or transfer when your order arrives'], ['transfer', 'Bank transfer', 'We’ll send the account details after you order']];
    function checkout() {
      const fld = (id, label, type, ph, val, ac = 'off') => `<label class="sh-f" data-f="${id}"><span>${label}</span><input id="ck-${id}" type="${type}" placeholder="${ph}" value="${esc(val)}" autocomplete="${ac}"><em></em></label>`;
      mount('sh-co', () => `${hd('Checkout')}<div class="sh-scroll"><div class="sh-steps"><span class="on"><i>${ico('check', 12, 3.4)}</i>Cart</span><b></b><span class="on"><i>2</i>Details</span><b></b><span><i>3</i>Done</span></div>
        <section class="sh-card"><h3>Contact</h3>${fld('name', 'Full name', 'text', 'e.g. Chioma Eze', form.name, 'name')}${fld('phone', 'Phone number', 'tel', '+234 …', form.phone, 'tel')}${fld('email', 'Email (optional)', 'email', 'you@example.com', form.email, 'email')}</section>
        <section class="sh-card"><h3>Delivery</h3><div class="sh-seg">${[['delivery', 'truck', 'Delivery', ship.note || 'To your door'], ['pickup', 'bagx', 'Pickup', (cfg.contact && cfg.contact.address) || 'From the store']].map(([k, i, t, d]) => `<button type="button" class="${method === k ? 'on' : ''}" data-act="meth" data-v="${k}">${ico(i, 22, 1.8)}<b>${t}</b><small>${esc(d)}</small></button>`).join('')}</div>
          <div id="ck-addr" ${method === 'delivery' ? '' : 'hidden'}><label class="sh-f" data-f="addr"><span>Delivery address</span><textarea id="ck-addr-i" rows="2" placeholder="Street, area and city">${esc(form.addr)}</textarea><em></em></label></div></section>
        <section class="sh-card"><h3>Payment</h3><div class="sh-pays">${(cfg.payment?.mode==='cod'?[['cod','Pay on delivery','Pay when your order arrives']]:cfg.payment?.mode==='link'?[['link','Payment link','Continue to the seller’s payment page']]:cfg.payment?.mode==='both'?[['transfer','Bank transfer','Pay to the store account'],['link','Payment link','Continue to the seller’s payment page'],['cod','Pay on delivery','Pay when your order arrives']]:[['transfer','Bank transfer','Pay to the store account']]).map(([k,t,d])=>`<button type="button" class="sh-pay${pay===k?' on':''}" data-act="pay" data-v="${k}"><i class="sh-rd"></i><div><b>${t}</b><small>${d}</small></div></button>`).join('')}</div>${pay==='transfer'&&cfg.payment?.bankName?`<div class="sh-payment-info"><b>Transfer details</b><p>${esc(cfg.payment.bankName)} · ${esc(cfg.payment.accountName||'')} · ${esc(cfg.payment.accountNumber||'')}</p><small>Use your order number as the transfer narration.</small></div>`:''}${pay==='link'&&cfg.payment?.paymentLink?`<a class="sh-payment-link" href="${esc(cfg.payment.paymentLink)}" target="_blank" rel="noopener">Open payment link</a>`:''}${pay!=='cod'?`<label class="sh-f"><span>Payment reference (optional)</span><input id="ck-payref" placeholder="Transfer narration or reference"></label>`:''}${cfg.payment?.allowProof!==false&&pay!=='cod'?`<label class="sh-f sh-upload"><span>Upload payment proof (optional)</span><input id="ck-proof" type="file" accept="image/*,.pdf"><em>JPG, PNG or PDF · max 2 MB</em></label>`:''}</section>
        <section class="sh-card"><h3>Create your customer profile</h3><p class="sh-muted">Use your email and password to return, view order history and track orders on this device.</p>${fld('password','Create password','password','At least 6 characters','','new-password')}</section>
        <section class="sh-card"><h3>Your order</h3><ul class="sh-ol">${lines().map(l => `<li>${thumb(l.p, 'xs')}<div><b>${esc(l.p.title)}</b><small>${l.qty} × ${esc(vtxt(l.v) || 'Standard')}</small></div><strong>${money(l.p.price * l.qty)}</strong></li>`).join('')}</ul>
          <div class="sh-sum flat"><div><span>Subtotal</span><b>${money(sub())}</b></div>${disc() ? `<div class="ok"><span>Discount</span><b>-${money(disc())}</b></div>` : ''}<div><span>Delivery</span><b id="ck-fee">${method === 'pickup' ? 'Free' : (isFree() ? 'Free' : (+ship.fee ? money(ship.fee) : 'Confirmed by the store'))}</b></div><div class="t"><span>Total</span><b id="ck-total">${money(total())}</b></div></div></section>
        <p class="sh-demo">Your order goes straight to the store. They’ll confirm payment and delivery with you.</p></div>
        <div class="sh-cta"><div class="sh-ctp"><small>Total</small><b data-ct>${money(total())}</b></div>${big('Place order', arrow, 'place')}</div>`,
        el => { const proof=$('#ck-proof',el); if(proof)proof.addEventListener('change',()=>{const file=proof.files[0];if(file&&file.size>2*1024*1024){proof.value='';proofFile=null;toast('Payment proof must be 2 MB or less');}else proofFile=file||null;}); $$('input,textarea', el).forEach(i => i.addEventListener('input', () => { const m = { 'ck-name': 'name', 'ck-phone': 'phone', 'ck-email': 'email', 'ck-addr-i': 'addr' }[i.id]; if (m) form[m] = i.value; const f = i.closest('.sh-f'); f && f.classList.remove('bad'); })); });
    }
    async function place(btn) {
      const el = stack[stack.length - 1], bad = (id, m) => { const f = $(`[data-f=${id}]`, el); f.classList.add('bad'); $('em', f).textContent = m; return f; };
      $$('.sh-f', el).forEach(f => f.classList.remove('bad'));
      const e = [!(form.name.trim().length >= 2) && bad('name', 'Enter your name'), form.phone.replace(/\D/g, '').length < 7 && bad('phone', 'Enter a valid phone number'), !/^\S+@\S+\.\S+$/.test(form.email.trim()) && bad('email', 'Enter a valid email'), method === 'delivery' && form.addr.trim().length < 5 && bad('addr', 'Enter your delivery address'), (($('#ck-password',el)||{}).value||'').length<6 && bad('password','Create a password with at least 6 characters')].filter(Boolean);
      if (e.length) { K.fx('err'); e[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
      btn.disabled = true; btn.classList.add('load'); $('span', btn).textContent = 'Placing order…'; await sleep(1100);
      const rows = lines().map(l => ({ id: l.p.id, title: l.p.title + (Object.keys(l.v).length ? ' · ' + vtxt(l.v) : ''), price: +l.p.price || 0, qty: l.qty, image: first(l.p) && !/^data:/.test(first(l.p)) ? first(l.p) : '' }));
      let proof=null; if(proofFile){proof=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve({name:proofFile.name,type:proofFile.type,data:r.result});r.onerror=()=>resolve({name:proofFile.name,type:proofFile.type});r.readAsDataURL(proofFile);});}
      const passHash=await digest((form.email.trim().toLowerCase())+':'+($('#ck-password',el).value));
      let ord; try {
        ord = await S.placeOrder({ customer: { name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() }, address: method === 'delivery' ? form.addr.trim() : 'Pickup at store', note, method, payment: pay, paymentProof: proof, paymentReference: ($('#ck-payref', el)?.value || '').trim(), lines: lines().map(l => ({ id: l.p.id, qty: l.qty, v: l.v })), promo: promo ? promo.code : '' });
      } catch (er) { btn.disabled = false; btn.classList.remove('load'); $('span', btn).textContent = 'Place order'; toast(er.message || 'We could not place your order.'); return; }
      const book=customerBook(), existing=book.find(x=>x.email===form.email.trim().toLowerCase()); const customer={id:existing?.id||('C-'+Date.now().toString(36).toUpperCase()),name:form.name.trim(),email:form.email.trim().toLowerCase(),phone:form.phone.trim(),passwordHash:passHash,orders:[...(existing?.orders||[]),ord.id],notifications:[...(existing?.notifications||[]),{title:'Order received',message:'Your order '+ord.id+' has been received.',at:Date.now()}],updatedAt:Date.now()}; if(existing)book[book.indexOf(existing)]=customer;else book.push(customer);saveCustomerBook(book);
      try { StrapFeatures.notify('sale', 'New online order ' + ord.id, `${form.name.trim()} ordered ${count()} item${count() === 1 ? '' : 's'} (${money(ord.total)}).`); } catch (er) {}
      const snap = { ord, lines: lines().map(l => ({ ...l })), name: form.name.trim().split(/\s+/)[0] };
      cart.clear(); promo = null; note = ''; proofFile=null; persist(); paint(); o.onOrder && o.onOrder(ord); K.fx('ok'); done(snap);
    }
    function done({ ord, lines: ls, name }) {
      mount('sh-done', () => `<div class="sh-scroll"><div class="sh-win"><svg class="sh-ok" viewBox="0 0 120 120" aria-hidden="true"><circle class="a" cx="60" cy="60" r="52" fill="var(--a)"/><circle class="b" cx="60" cy="60" r="52" fill="none" stroke="var(--ink)" stroke-width="3"/><path class="c" d="M38 62l15 15 30-33" fill="none" stroke="var(--ac)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <h1>Thank you, ${esc(name)}!</h1><p>Your order is in. ${esc(cfg.name || 'The store')} will contact you on ${esc(ord.customer.phone)} to confirm.</p>
        <button type="button" class="sh-ref" data-copy="${esc(ord.tracking)}"><small>Order</small><b>${ord.id}</b><i></i><small>Tracking</small><b>${esc(ord.tracking)}</b>${ico('copy', 16, 2)}</button>
        <ol class="sh-tl"><li class="on"><i></i><div><b>Order received</b><small>Just now</small></div></li><li><i></i><div><b>Being prepared</b><small>The store is getting it ready</small></div></li><li><i></i><div><b>${ord.method === 'pickup' ? 'Ready for pickup' : 'Out for delivery'}</b><small>${ord.method === 'pickup' ? esc((cfg.contact && cfg.contact.address) || 'At the store') : esc(ord.address)}</small></div></li></ol>
        <div class="sh-card flat"><ul class="sh-ol">${ls.map(l => `<li>${thumb(l.p, 'xs')}<div><b>${esc(l.p.title)}</b><small>${l.qty} × ${esc(vtxt(l.v) || 'Standard')}</small></div><strong>${money(l.p.price * l.qty)}</strong></li>`).join('')}</ul><div class="sh-sum flat"><div class="t"><span>Total · ${ord.payment === 'cod' ? 'Pay on delivery' : 'Bank transfer'}</span><b>${money(ord.total)}</b></div></div></div>
        <p class="sh-demo">The store has your order and will contact you to confirm payment and delivery.</p></div></div><div class="sh-cta">${big('Continue shopping', arrow, 'home')}</div>`);
    }

    function customerAccount(){
      const el=mount('sh-account',()=>`${hd('Customer account')}<div class="sh-scroll"><section class="sh-card"><h3>Sign in to your profile</h3><label class="sh-f"><span>Email</span><input id="ca-email" type="email" placeholder="you@example.com"></label><label class="sh-f"><span>Password</span><input id="ca-pass" type="password" placeholder="Your password"></label><button type="button" class="sh-big" data-act="customer-login"><span>Sign in</span>${arrow}</button><p class="sh-muted">Profiles created at checkout are stored on this preview device. A production launch needs secure server-side accounts.</p><div id="ca-result"></div></section></div>`);
      el.addEventListener('click',async e=>{const b=e.target.closest('[data-act=customer-login]');if(!b)return;const email=($('#ca-email',el).value||'').trim().toLowerCase(),pass=$('#ca-pass',el).value||'',c=customerBook().find(x=>x.email===email);if(!c||c.passwordHash!==await digest(email+':'+pass)){toast('Email or password is incorrect');return;}const orders=(S.orders()||[]).filter(o=>(c.orders||[]).includes(o.id));$('#ca-result',el).innerHTML=`<div class="sh-account-welcome"><b>Welcome back, ${esc(c.name)}</b><p>${orders.length} order${orders.length===1?'':'s'} found</p>${orders.map(o=>`<article class="sh-account-order"><b>${esc(o.id)}</b><span>${esc(o.status)}</span><small>${esc(o.tracking)} · ${money(o.total)}</small></article>`).join('')||'<p>No orders found on this device.</p>'}</div>`;});
    }

    /* ---------------- events ---------------- */
    const quick = p => { if (soldOut(p)) return toast('This product is sold out'); if (groups(p).length) return detail(p); addLine(p, {}, 1); };
    const close = () => { app.classList.remove('on'); setTimeout(() => { app.remove(); if (!$('.os-screen,.fx-screen,.pm-layer.on')) document.body.classList.remove('pm-open'); o.close && o.close(); }, 380); };
    const top = () => stack[stack.length - 1];
    const goCart = () => { const i = stack.findIndex(x => x.classList.contains('sh-cart')); if (i >= 0) return popTo(i + 1); if (top() && top().classList.contains('sh-done')) return; cartScreen(); };
    app.addEventListener('input',e=>{if(!e.target.matches('[data-store-search]'))return;const q=e.target.value.trim().toLowerCase();let visible=0;$$('.stf-p',app).forEach(card=>{const ok=!q||(card.dataset.search||'').toLowerCase().includes(q);card.hidden=!ok;if(ok)visible++;});let msg=$('[data-search-empty]',app);if(q&&!visible){if(!msg){msg=document.createElement('p');msg.dataset.searchEmpty='1';msg.className='stf-empty';msg.textContent='No products match your search.';$('.stf-sec',app)?.appendChild(msg);}}else if(msg)msg.remove();});
    app.addEventListener('click', async e => {
      const cp = e.target.closest('[data-copy]'); if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); } catch (er) {} return toast('Copied'); }
      const anc = e.target.closest('a[href^="#"]'); if (anc) { e.preventDefault(); const t = $(anc.getAttribute('href'), app); t && t.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (e.target.closest('[data-cart]')) return goCart(); if(e.target.closest('[data-customer-account]'))return customerAccount();
      const ad = e.target.closest('[data-add]'); if (ad) { const p = find(ad.dataset.add); return p && quick(p); }
      const pb = e.target.closest('[data-p]'); if (pb) { const p = find(pb.dataset.p); return p && detail(p); }
      const a = e.target.closest('[data-act]'); if (!a) return; const act = a.dataset.act, el = top(), d = el && el._d;
      if (act === 'close') return close(); if (act === 'back') return pop(); if (act === 'home') return popTo(0);
      if (act === 'cart') return goCart();
      if (act === 'open') { const p = find(a.dataset.id); return p && detail(p); }
      if (act === 'up') { const p = find(a.dataset.id); if (!p) return; if (groups(p).length) return detail(p); addLine(p, {}, 1); return refreshCart(); }
      if (act === 'heart') { const id = d.p.id; wish.has(id) ? wish.delete(id) : wish.add(id); a.classList.toggle('on', wish.has(id)); persist(); return toast(wish.has(id) ? 'Saved to your wishlist' : 'Removed from wishlist'); }
      if (act === 'opt') { d.s.sel[a.dataset.g] = a.dataset.v; const g = a.closest('.sh-opt'); $$('.sh-chip', g).forEach(c => c.classList.toggle('on', c === a)); $('[data-sel]', g).textContent = a.dataset.v; g.classList.remove('bad'); return; }
      if (act === 'dq') { d.s.qty = Math.max(1, Math.min(d.mx, d.s.qty + +a.dataset.d)); if (d.s.qty === d.mx && +a.dataset.d > 0 && d.mx < 99) toast('Only ' + d.mx + ' available'); $('[data-q]', el).textContent = d.s.qty; const t = $('[data-tot]', el); if (t) t.textContent = money(d.p.price * d.s.qty); return; }
      if (act === 'add') {
        const miss = d.gs.find(g => !d.s.sel[g.name]); if (miss) { const g = $(`.sh-opt[data-g="${CSS.escape(miss.name)}"]`, el); g.classList.remove('bad'); void g.offsetWidth; g.classList.add('bad'); g.scrollIntoView({ block: 'center', behavior: 'smooth' }); K.fx('err'); return toast('Choose a ' + miss.name.toLowerCase()); }
        addLine(d.p, d.s.sel, d.s.qty); a.classList.add('added'); $('[data-lab]', a).textContent = 'Added'; setTimeout(() => { a.classList.remove('added'); const l = $('[data-lab]', a); l && (l.textContent = 'Add to cart'); }, 1300); return;
      }
      if (act === 'lq') { const l = cart.get(a.dataset.k); if (!l) return; const n = l.qty + +a.dataset.d, mx = maxQty(l.p); if (n < 1) return; if (n > mx) return toast('Only ' + mx + ' available'); l.qty = n; return refreshCart(); }
      if (act === 'lrm') { const li = a.closest('.sh-line'); li.classList.add('gone'); await sleep(280); cart.delete(a.dataset.k); return refreshCart(); }
      if (act === 'clear') { if (!cart.size || !await K.confirm({ title: 'Clear your cart?', body: 'All items will be removed.', ok: 'Clear', cancel: 'Keep', icon: 'trash', danger: true })) return; cart.clear(); promo = null; return refreshCart(); }
      if (act === 'pra') { const v = ($('#sh-code', el).value || '').trim().toUpperCase(), m = promos().find(x => x.code.toUpperCase() === v), msg = $('#sh-pm', el); if (!v) return; if (!m) { K.fx('err'); msg.textContent = 'That code isn’t valid.'; msg.className = 'sh-pm bad'; return; } promo = m; K.fx('ok'); return refreshCart(); }
      if (act === 'prm') { promo = null; return refreshCart(); }
      if (act === 'checkout') { note = ($('#sh-note', el) || {}).value || note; return checkout(); }
      if (act === 'meth') { method = a.dataset.v; $$('.sh-seg button', el).forEach(b => b.classList.toggle('on', b === a)); $('#ck-addr', el).hidden = method !== 'delivery'; $('#ck-total', el).textContent = $('[data-ct]', el).textContent = money(total()); $('#ck-fee', el).textContent = method === 'pickup' || isFree() ? 'Free' : (+ship.fee ? money(ship.fee) : 'Confirmed by the store'); return; }
      if (act === 'pay') { pay = a.dataset.v; $$('.sh-pay[data-act]', el).forEach(b => b.classList.toggle('on', b === a)); return; }
      if (act === 'place') return place(a);
    });
    app.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'sh-code') { e.preventDefault(); $('[data-act=pra]', top()).click(); } });
    paint();
  }
  return { open };
})();
