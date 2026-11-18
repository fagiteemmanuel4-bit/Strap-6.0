# Strap v9 — Cloudflare, Neon, and Flutterwave

The app is a static site plus a Cloudflare Worker API. Neon provides PostgreSQL and Managed Better Auth. Flutterwave handles Strap Premium payments.

## What you need

- Node.js 20.19 or later
- A Cloudflare account and a domain (for production)
- A Neon project with PostgreSQL and Managed Better Auth enabled
- A Flutterwave account
- An SMTP provider configured in Neon for production auth emails

Neon Auth sends sign-up verification and password-reset emails. Neon itself is not a general-purpose email API: account-review and billing messages still use the optional Resend integration, while phone-code delivery uses the optional Termii integration.

## 1. Prepare Neon

1. In the Neon Console, enable **Better Auth** and email/password sign-up.
2. Enable **Verify at Sign-up** and select **Verification code**.
3. Configure a custom SMTP provider under Neon Auth settings before production. Add the exact production app origin under Auth trusted domains.
4. Copy the pooled PostgreSQL connection string for `DATABASE_URL` and the Managed Better Auth base URL for `NEON_AUTH_BASE_URL`.
5. Run all of `db/schema.sql` in the Neon SQL Editor. It is safe to run again after schema updates.

Users who previously had a Strap password must sign up through Neon Auth with the same email address, verify it, and finish the onboarding form. Their existing Strap store and records stay associated with that email. Neon Auth manages the password and session; Strap's user table keeps business-specific account state and TOTP settings.

## 2. Configure Flutterwave

1. Start with test API keys from Flutterwave.
2. Set `FLW_SECRET_KEY`, `FLW_PUBLIC_KEY`, and `FLW_WEBHOOK_SECRET_HASH` as Worker secrets.
3. Set the webhook URL to `https://YOUR-DOMAIN/api/webhooks/flutterwave` and use the same secret hash.
4. Enable the currencies you sell in. Server prices are in `server/plans.js`.
5. Saved-card renewals require Flutterwave tokenization. If your account cannot tokenize, customers receive a renewal reminder only when a separate transactional email sender is configured.

## 3. Configure Cloudflare

Install dependencies and run the offline tests/build:

```powershell
npm install
npm run selftest
npm run build
```

Authenticate Wrangler and deploy:

```powershell
npx wrangler login
npx wrangler secret put DATABASE_URL
npx wrangler secret put APP_URL
npx wrangler secret put APP_SECRET
npx wrangler secret put APP_ENCRYPTION_KEY
npx wrangler secret put CRON_SECRET
npx wrangler secret put NEON_AUTH_BASE_URL
npx wrangler secret put FLW_SECRET_KEY
npx wrangler secret put FLW_PUBLIC_KEY
npx wrangler secret put FLW_WEBHOOK_SECRET_HASH
npm run deploy
```

Wrangler prompts for each secret value. Generate application secrets with `node scripts/gen-secrets.js`. Do not commit `.env`, `.dev.vars`, or real credentials.

The Worker serves the built static files, routes `/api/*`, proxies `/api/neon-auth/*` to Neon Auth on the same origin, and runs the daily renewal task at 06:00 UTC. Set `APP_URL` to the final HTTPS origin and add that origin to Neon Auth's trusted domains.

For local development, create a private `.dev.vars` file from `.env.example`, fill it with test credentials, then run:

```powershell
npm run cf:dev
```

## 4. Verify

Open `https://YOUR-DOMAIN/api/health?key=YOUR_CRON_SECRET`. Confirm the database/schema checks pass, Neon Auth is configured, and Flutterwave reports the expected test/live mode.

Test sign-up and verification email, log in, password reset, TOTP if enabled, dashboard sync, a Flutterwave test payment, and a storefront order before launch.

## Deployment notes and current limitations

- Switch Flutterwave to live keys and set `DEV_SHOW_CODES=false` before launch. Rotate any credentials that were previously stored in a sample or public file.
- Configure Neon Auth custom SMTP and trusted domains before using real customers. Neon’s shared sender is for development/testing and is rate-limited.
- Email codes for contact/PIN features and non-auth transactional email still use Resend; SMS uses Termii. These do not use Neon Auth's email templates.
- Automatic merchant custom-domain provisioning is still Vercel-specific. Configure Cloudflare Worker custom domains manually; the app's Vercel API integration is not a Cloudflare integration.
- Storefront buyers currently pay by transfer, card-on-delivery, or merchant payment link. Direct payments to each merchant require Flutterwave subaccounts and merchant KYC.
- Staff sign-in and storefront customer accounts are not implemented. Multi-device document sync can still resurrect deleted records in a rare conflict.
- Product pictures are stored in Neon. Consider object storage as usage grows.
- Enable Neon backups/point-in-time restore and test a restore before production.
