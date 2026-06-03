# Production Readiness Report — Reyansh ERP (Vercel)

**Stack:** Create React App 5 (`react-scripts`) · React 18 · MUI · Supabase · React Router 6  
**Deploy target:** Vercel (static SPA, `build/` output)  
**Date:** 2026-05-29

---

## Executive summary

The project is configured for **production-safe Vercel deployment** as a client-side SPA. Build passes locally with `npm run build`. Environment variables are centralized; hardcoded production URLs were removed from OAuth/config paths. Vercel SPA rewrites and Node LTS pinning are in place.

**Readiness score: 8/10** — deploy-ready after you set Vercel env vars and Supabase OAuth redirect URLs.

---

## 1. What was changed

| Area | Change | Why it matters |
|------|--------|----------------|
| **`src/config/env.js`** | New central module for all `REACT_APP_*` vars | Single source of truth; local + Vercel stay in sync |
| **OAuth / config** | `oauthCallbackParams.js`, `oauthConfig.js`, `config.js` use `env.js` | No hardcoded Vercel URLs; runtime uses `window.location.origin` |
| **`supabaseClient.ts`** | Reads Supabase keys via `appEnv` | Consistent env handling |
| **`.env.example`** | Documented all required vars | Onboarding + Vercel dashboard checklist |
| **`.env.local`** | Template for local dev (gitignored) | Safe local setup without committing secrets |
| **`.nvmrc`** | Node `20` LTS | Matches Vercel recommended runtime |
| **`package.json`** | `engines`, `build:ci` script | Predictable Node/npm; optional strict CI build |
| **`.gitignore`** | Secrets, `.vercel`, caches, logs | Prevents accidental secret commits |
| **`vercel.json`** | `buildCommand`, `outputDirectory`, `installCommand`, SPA rewrites | Explicit Vercel contract for CRA |
| **`tsconfig.json`** | Path aliases `@/*`, `@components/*`, etc. | Maintainable imports (optional; existing relative imports unchanged) |
| **`src/react-app-env.d.ts`** | Typed env vars | IDE safety for new env keys |

**Not changed (intentionally):** Business logic, RBAC, routing, auth flow, database layer, UI components. No mass import refactor.

---

## 2. Project foundation

| Item | Status |
|------|--------|
| Framework | CRA SPA — correct for Vercel static hosting |
| SSR | None (client-only) — no hydration/SSR conflicts |
| Routing | React Router + `vercel.json` rewrites → `/index.html` |
| Data | Supabase client-side (PKCE OAuth, RLS) |
| Build output | `build/` |

**Architecture note:** This is a large monolithic CRA bundle (~1 MB gzip). It deploys fine but load time may be high; code-splitting is a future optimization, not required for deploy.

---

## 3. Environment variables

### Required in Vercel (Production + Preview)

| Variable | Description |
|----------|-------------|
| `REACT_APP_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `REACT_APP_SUPABASE_ANON_KEY` | Supabase anon/publishable key |
| `REACT_APP_APP_URL` | Canonical app URL, e.g. `https://erp-final-update-guje.vercel.app` (no trailing slash) |

### Optional

| Variable | Default |
|----------|---------|
| `REACT_APP_LOCAL_DEV_ORIGIN` | `http://localhost:3000` |
| `REACT_APP_WHATSAPP_LINK` | `https://wa.me/` |

### Local setup

```powershell
copy .env.example .env.local
# Edit .env.local with your Supabase keys
npm start
```

**Important:** CRA bakes env vars at **build time**. Changing Vercel env vars requires a **redeploy**.

---

## 4. Dependency & runtime

| Item | Value |
|------|-------|
| Node (`.nvmrc`) | `20` |
| `package.json` engines | `node >=20 <=22`, `npm >=9` |
| Package manager | npm (`package-lock.json` present) |
| Vercel install | `npm ci` (via `vercel.json`) |
| Build | `cross-env CI=false react-scripts build` (lint warnings non-fatal) |

---

## 5. Build stability audit

| Check | Result |
|-------|--------|
| Production build | ✅ `npm run build` succeeds |
| Case-sensitive imports | ✅ `forceConsistentCasingInFileNames` in tsconfig |
| SSR / window usage | ✅ Browser APIs guarded with `typeof window` in auth helpers |
| ESLint in CI | ✅ `CI=false` on default build (Vercel) |
| Missing `jsconfig` + `tsconfig` conflict | ✅ Fixed — aliases only in `tsconfig.json` |

### Remaining build risks

1. **ESLint warnings** — suppressed for deploy via `CI=false`; run `npm run build:ci` locally to see strict failures.
2. **Supabase RLS / missing tables** — runtime errors, not build errors (e.g. `stock`, RBAC SQL not applied).
3. **Google OAuth** — must match Supabase + Google Cloud redirect URLs for each deployed domain.
4. **Bundle size** — may hit Vercel limits only on very large assets; current build is within normal CRA range.

---

## 6. Path aliases

Configured in `tsconfig.json` (CRA reads this for JS + TS):

- `@/*` → `src/*`
- `@components/*`, `@services/*`, `@config/*`, `@lib/*`, etc.

Existing code uses relative imports; new code may use aliases. No breaking changes.

---

## 7. Vercel configuration

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "build",
  "installCommand": "npm ci",
  "framework": null,
  "rewrites": [{ "source": "/((?!static/).*)", "destination": "/index.html" }]
}
```

**Vercel project settings (dashboard):**

- Framework Preset: **Other** (or Create React App if offered)
- Root Directory: `.`
- Build Command: `npm run build` (or leave default if `vercel.json` is used)
- Output Directory: `build`
- Node.js Version: **20.x**

---

## 8. Manual steps you must complete

### A. Supabase

1. Run SQL migrations if not already: `supabase_rbac_setup.sql`, `erp_rbac_tasks_complete.sql`
2. **Auth → URL Configuration → Redirect URLs:**
   - `http://localhost:3000`
   - `https://<your-vercel-domain>.vercel.app`
3. **Google provider:** Web Client ID + secret; callback URL = Supabase auth callback

### B. Google Cloud Console

- Authorized JavaScript origins: localhost + Vercel URL + Supabase project origin
- Authorized redirect URI: `https://<project-ref>.supabase.co/auth/v1/callback`

### C. Vercel

1. Import GitHub repo
2. Set all `REACT_APP_*` env vars (Production + Preview)
3. Deploy branch `production-audit-fix` or `main`
4. After deploy, add preview URL to Supabase redirect URLs if using preview deployments

### D. Local

1. Copy `.env.example` → `.env.local` and fill Supabase keys
2. Set `REACT_APP_APP_URL=http://localhost:3000` for local OAuth docs

---

## 9. Deploy commands

### Push to GitHub

```powershell
cd "c:\Users\GAURAV\Downloads\erp-final-with-all-the-changes--main\erp-final-with-all-the-changes--main"

git status
git add .
git commit -m "chore(production): Vercel env centralization and deployment config"
git push erp-update production-audit-fix
```

(Replace remote/branch if using `origin` / `main`.)

### Deploy via Vercel CLI (optional)

```powershell
npm i -g vercel
vercel login
vercel --prod
```

Or connect the repo in [vercel.com/new](https://vercel.com/new) — auto-deploys on push.

### Verify locally before push

```powershell
npm ci
npm run build
npx serve -s build -l 3000
```

---

## 10. Files touched in this production setup

- `src/config/env.js` (new)
- `src/config/config.js`
- `src/config/oauthConfig.js`
- `src/lib/oauthCallbackParams.js`
- `src/lib/supabaseClient.ts`
- `src/react-app-env.d.ts`
- `.env.example`, `.env.local` (local only, gitignored)
- `.nvmrc`, `.gitignore`, `vercel.json`, `package.json`, `tsconfig.json`

---

## 11. What could still fail in production

| Failure | Mitigation |
|---------|------------|
| Blank app / Supabase error on load | Set `REACT_APP_SUPABASE_*` in Vercel; redeploy |
| Google login 400 / audience mismatch | Align Google Client ID in Supabase with Google Cloud |
| Access denied after login | Employee row + `employee_permissions` in Supabase |
| Inventory CRUD fails | Ensure `public.stock` table + RLS policies exist |
| Deep link 404 | Confirm `vercel.json` rewrites are deployed |
| Preview deploy auth fails | Add preview URL to Supabase redirect URLs |

---

## 12. Related docs

- `PRODUCTION_CHECKLIST.md` — QA flows (CEO, employee, CRUD)
- `database_audit.sql` — idempotent DB validation
- `OAUTH_TROUBLESHOOTING.md` — Google OAuth debugging
