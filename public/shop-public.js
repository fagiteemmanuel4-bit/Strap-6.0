/* Strap public storefront: loads a published store from the server and opens the buyer experience. */
(function () {
  const qs = new URLSearchParams(location.search), host = location.hostname.toLowerCase();
  const base = ((window.STRAP_CONFIG || {}).BASE_DOMAIN || 'strap.store').toLowerCase();
  const slug = qs.get('s') || (host.endsWith('.' + base) ? host.slice(0, -(base.length + 1)) : '');
  const isCustom = !qs.get('s') && !host.endsWith('.' + base) && host !== 'localhost';
  const msg = (t, s) => { document.body.innerHTML = `<div style="font-family:Sora,system-ui,sans-serif;text-align:center;padding:28vh 24px 0"><h2 style="margin:0 0 8px">${t}</h2><p style="color:#666;margin:0">${s || ''}</p></div>`; };
  // the buyer app expects a store object; on the public site it only needs to place orders
  window.StrapStore = {
    prefs: {}, orders: [], api: {}, online: () => null,
    async placeOrder(p) {
      const r = await StrapAPI.post('/api/shop/order', { ...p, slug, host: isCustom ? host : '' });
      if (!r.ok) throw new Error(r.msg || 'We could not place your order.'); return r.order;
    },
    addOrder(o) { return o; }
  };
  window.StrapFeatures = { notify() {}, items: () => [] };
  window.__openShop = async function () {
    if (!slug && !isCustom) return msg('Store not found', 'Check the link and try again.');
    const r = await StrapAPI.get('/api/shop/resolve?slug=' + encodeURIComponent(slug) + '&host=' + encodeURIComponent(isCustom ? host : ''));
    if (!r.ok) return msg('This store isn’t available', 'It may have moved or been closed.');
    document.title = r.name || 'Store';
    const url = (r.config.domain && r.config.domain.host) || host;
    StrapShop.open(r.config, { products: r.products, url, onOrder: () => {}, public: true });
  };
})();
