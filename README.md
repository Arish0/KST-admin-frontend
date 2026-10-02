# Deploy KST as three separate Cloudflare Workers

The customer and admin are independent repositories and independent sites. Their API requests go through private service bindings to a shared backend. The backend uses D1 for the catalogue, orders, sessions, and rate limits. Each frontend also authenticates with its own server-side proxy secret. Keep the backend's public routes disabled when everything is in the same account.

| Project folder | GitHub repository | Cloudflare Worker |
|---|---|---|
| `Deployment/customer` | `https://github.com/Arish0/KST-crack-frontned.git` | `kst-customer` |
| `Deployment/admin` | `https://github.com/Arish0/KST-admin-frontend.git` | `kst-admin` |
| `Deployment/backend` | `https://github.com/Arish0/KST-crack-backend.git` | `kst-backend` |

The admin can use `kst-admin.<your-account-subdomain>.workers.dev`; no second purchased domain is necessary. Your purchased domain will be attached to the customer Worker.

## 1. Prepare the repositories locally

From `D:\KST crakers`:

```powershell
node cloudflare/prepare-repositories.mjs
```

This creates the three independent projects listed above. It does not copy `.data`, existing orders, passwords, credentials, or `node_modules`. It does not push code or deploy anything. Rerunning it refreshes generated files; it leaves `.git` alone but replaces configuration, including the database ID unless you set `CLOUDFLARE_D1_DATABASE_ID` first. Once repositories are published, edit and work in those repositories directly instead of repeatedly regenerating them.

## 2. Set up the backend first

```powershell
cd 'D:\KST crakers\Deployment\backend'
npm install
npx wrangler login
npx wrangler d1 create kst-shop
```

The create command returns a database ID. Replace the zero UUID in `wrangler.jsonc` → `d1_databases[0].database_id` with that ID. Then:

```powershell
npm run migrate
npm run deploy
```

Set the admin password hash as a **Worker runtime secret**. The following prompts privately for a password of at least 12 characters, hashes it locally, and sends only the hash to Cloudflare. It does not store the plaintext password in a file or command history:

```powershell
$kstCredential = Read-Host 'Choose the shop admin password' -AsSecureString
$kstPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($kstCredential)
try {
  $env:KST_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($kstPasswordPointer)
  node create-password-hash.mjs | npx wrangler secret put ADMIN_PASSWORD_HASH --name kst-backend
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($kstPasswordPointer)
  Remove-Item Env:KST_ADMIN_PASSWORD -ErrorAction SilentlyContinue
}
```

Keep the password privately. Use it to log into the admin website. Never commit the hash, password, API tokens, or `.dev.vars` files.

Generate two independent random 32-byte proxy secrets locally. Set `CUSTOMER_PROXY_SECRET` and `ADMIN_PROXY_SECRET` as runtime secrets on `kst-backend`. Set the matching customer secret as `PROXY_SECRET` on `kst-customer`, and the matching admin secret as `PROXY_SECRET` on `kst-admin`. These authenticate server-to-server requests; they must never be placed in frontend source or public build variables. Customer and admin secrets must be different. Until these are set, API requests fail closed.

### If Workers are in different Cloudflare accounts

Service bindings require the Workers to be in the same account. For a frontend in another account, remove its `services` entry and set its runtime `BACKEND_URL` variable to the backend's HTTPS Worker URL. Enable `workers_dev` only on that backend when HTTPS forwarding is required. Keep both backend proxy secrets configured; requests with missing or incorrect proxy secrets return 404. Keep the site's own `PROXY_SECRET` configured in its account. You will need deployment authentication for each account. Requests still go through the frontend Worker, keeping cookies and browser API calls on the site's own origin.

D1 starts with the sample catalogue on its first API request. Existing local orders are NOT automatically migrated. Configure real products, shop contact numbers, hub coordinates, delivery fee, and the 15 km radius in the deployed admin before sharing the shop with customers.

## 3. Publish each repository to GitHub

Run these commands in `Deployment/backend` first, then repeat in `Deployment/customer` and `Deployment/admin`, using the matching repository URL from the table:

```powershell
git init -b main
git add .
git commit -m "Prepare separate Cloudflare deployment"
git remote add origin https://github.com/Arish0/KST-crack-backend.git
git push -u origin main
```

If Git asks for your identity, configure your own Git author name and email. If a remote already contains work, fetch and reconcile it instead of force-pushing. Run `npm install` in each project to generate its own lockfile, then commit that lockfile too.

## 4. Connect automatic deployments in Cloudflare

In **Workers & Pages**, connect each Worker to its matching GitHub repository under **Settings → Builds**. For a new site, create an application by importing its GitHub repository. Grant the Cloudflare GitHub integration access to these three repositories.

Use these settings:

| Setting | Customer | Admin | Backend |
|---|---|---|---|
| Worker name | `kst-customer` | `kst-admin` | `kst-backend` |
| Root directory | repository root | repository root | repository root |
| Production branch | `main` | `main` | `main` |
| Build command | `npm run build` | leave empty | leave empty |
| Deploy command | `npm run deploy` | `npm run deploy` | `npm run deploy` |

Install dependencies during builds. Use Node.js 22.14 or newer (set `NODE_VERSION` if needed). Keep both frontends' `BACKEND` service binding pointing to `kst-backend` in the same Cloudflare account. Keep the backend's D1 binding named `DB`. Do not put `ADMIN_PASSWORD_HASH` in a frontend or a build environment variable; it belongs in the backend's runtime Secrets.

The first backend deployment must exist before either frontend deploys, because service bindings refer to that Worker by name. Each later push to `main` will deploy only the Worker associated with that repository. Check the build log after the first push. Keep preview branches disabled initially so development builds do not write to the production D1 database. Apply future database schema migrations deliberately with `npm run migrate` using authentication that includes D1 write permission; the default Workers Builds token does not include that permission.

## 5. Attach the purchased customer domain

In Cloudflare, add your domain to the account and complete the DNS/nameserver setup if it is not already active. Open **Workers & Pages → kst-customer → Settings → Domains & Routes → Add → Custom Domain**, and enter your purchased domain. Add `www` separately if you want both addresses. Verify the HTTPS certificate is active.

Leave the admin on its separate `kst-admin.<your-account-subdomain>.workers.dev` URL. The customer site does not serve `/admin`.

## 6. Verify before accepting orders

- Open the customer domain and confirm the catalogue, discounts, bundles, and mobile animations load.
- Open the admin Worker URL and sign in using your chosen password.
- Configure real stock, contact numbers, hub coordinates, and delivery settings.
- Save a test pickup request and verify it appears in admin Orders.
- Check eligible and ineligible delivery locations around the 15 km boundary.
- Verify the WhatsApp quote excludes the delivery address and map coordinates.
- Redeploy the backend, then verify that orders remain stored and admin sessions remain valid.
- Push a small change to each repo and check that the correct Worker deploys automatically.

## Status of the prepared code

Local tests cover the D1 SQL schema with SQLite, persisted order/session logic, idempotency, delivery radius, endpoint isolation, and origin protection. An actual Cloudflare deployment and Worker-runtime validation are still required; local tests do not prove the production Free-plan CPU budget. The password check uses PBKDF2 and should be verified under that budget before taking orders. Free tiers have usage limits; this setup does not enable a paid plan.

References: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [HTTP service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/), [Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).
