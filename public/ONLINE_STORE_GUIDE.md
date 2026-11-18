# Strap online store additions

This is an additive update. The existing dashboard pages, visual styling, product manager and setup flow have been retained. The storefront renderer now uses the real active products in Strap rather than inserting sample products when the catalogue is empty.

## Added in this build

- Twenty-one built-in looks spanning general retail, restaurants (Restaurant, Bistro and Takeaway), fashion, beauty, electronics, grocery, furniture, digital products, services, bakery, fitness, books, jewellery and pets.
- Active-product auto-sync and manual product selection.
- Real product cards with image, price, description and stock-aware add-to-cart controls.
- Cart quantities, removal, totals and a multi-item test checkout.
- Customer name, phone, delivery address and order note capture in checkout.
- Local order references and tracking references, status timeline and order status transitions.
- Order search by order number, tracking reference, customer, phone or product.
- Store sections: announcement, hero, billboard, banner, products, about, contact, testimonials, FAQ, policies and footer.
- Merchant payment settings for bank transfer instructions, external payment links, pay-on-delivery and optional payment-proof uploads.
- Expanded order workflow: new → processing → packaged → dispatched → delivered, with payment proof and manual payment confirmation.
- Customer profile and customer-book demo flows for returning buyers and order history.
- Add, remove, reorder and edit section text in Store settings → Store content & templates.
- JSON and XML template import/export.
- Import validation and visible rules explaining what an imported template may change.
- Imported templates change only theme and page sections. They do not overwrite products, domain, contact details, orders or account data.

## Template import rules

1. Use a template exported by Strap or follow `store-template.schema.json`.
2. JSON may be a template object or an exported object with a `config` property. XML must use a `<strap-template><config>…</config></strap-template>` root.
3. The template must contain `v`, `theme` and `sections`.
4. A template may contain no more than 30 sections.
5. Section types must be one of: `announcement`, `hero`, `banner`, `products`, `about`, `contact`, `testimonials`, `faq`, `policies`, `footer`.
6. Theme colours must be six-digit hex values such as `#e6f53a`.
7. Invalid files are rejected; the current storefront configuration remains in place.
8. Preview the store after importing. Only import templates from sources you trust.

## Important deployment limitation

This project currently contains demo/local persistence hooks. `StrapStore` saves to the browser's `localStorage`; `createStore`, `saveStore`, `pullOrders`, domain verification and product API methods are demo stubs. The cart and checkout implemented here are working in the local preview and create local test orders, collect optional payment-proof attachments and create device-local demo customer profiles, but they do **not** charge payments or create a publicly hosted customer storefront by themselves. Real multi-device customer ordering, public hosting, payment processing, email/SMS notifications, secure customer tracking links and live inventory reservation require a production backend, database, hosting/domain service and payment provider integration. Do not treat a browser-local test order as a paid or fulfilled order.

## Files added

- `store-template.schema.json` — JSON Schema reference for portable templates.
- `template-example.xml` — importable XML template example.
- `ONLINE_STORE_GUIDE.md` — this guide.

## Buyer app (storeshop.js + storeshop.css)

Opening **Preview store** now launches a full buyer experience themed by the store JSON (accent, font, corners, light/dark):

- **Home**: the JSON storefront. Product cards show sale % and "Sold out" tags, compare-at price, and "Choose options" when a product has size/colour options.
- **Product detail**: swipeable picture gallery with counter and dots, video slide when a video was uploaded, brand (vendor), stock chip ("Only N left"), big price with compare-at and savings, option chips (size, colour and so on, required before adding), quantity stepper, delivery perks, collapsible description / product details / delivery & returns, "You may also like", wishlist heart, sticky big Add to cart bar showing the live total.
- **Cart**: free-delivery progress bar (set `shipping.freeOver` in the store JSON), line items with variant chips and steppers, stock caps, remove animation, "Complete your order" upsell, promo codes (`promos` array in the store JSON, e.g. `{ "code": "WELCOME10", "type": "pct", "value": 10 }`; preview falls back to WELCOME10), seller note, itemised summary and sticky Checkout bar. The cart persists for the browser session.
- **Checkout**: contact, delivery or pickup, payment choice (pay on delivery / bank transfer), validation, order summary.
- **Confirmation**: animated check, order and tracking references, status timeline. The order lands in Orders with variants, discount, delivery and payment details.

Optional store JSON fields: `shipping: { note, fee, freeOver }`, `promos: [ { code, type: "pct" | "fixed", value } ]`.
Product descriptions are sanitised before display (only basic formatting is kept). Still a demo: no real payment, no public hosting.


## Production requirements for customer accounts and payments

Customer profiles, uploaded proof, order history and the customer book in this preview are stored in browser-local storage and are not shared across devices. Do not use this local demo as an authentication system: production accounts require server-side password hashing, sessions, email verification, rate limiting and account recovery. Bank instructions and external payment links are merchant-configured; Strap does not verify transfers automatically. A production payment integration should use a supported provider with server-side webhook verification before setting an order to paid. Uploaded proof is limited to 2 MB in this preview and is retained locally.
