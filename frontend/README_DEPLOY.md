# Frontend deployment

End-to-end instructions for deploying the PolicyLens frontend to Vercel.

The frontend is a static Vite + React + TypeScript bundle. Any static host
will work (Netlify, Cloudflare Pages, S3 + CloudFront), but Vercel is the
zero-config path and what these instructions assume.

The frontend talks to the backend over plain HTTPS. Its only build-time
dependency on the backend is the `VITE_API_BASE_URL` env var, which is
inlined into the bundle at build time.

---

## 1. Prerequisites

- The backend must already be deployed and reachable. See [`backend/README_DEPLOY.md`](../backend/README_DEPLOY.md).
- Have the backend URL ready, e.g. `https://policylens-backend.onrender.com`.

---

## 2. Environment variables

| Variable | Required | Value |
|---|---|---|
| `VITE_API_BASE_URL` | **yes** in production | Full backend URL, no trailing slash. e.g. `https://policylens-backend.onrender.com` |

**Why required.** The frontend's API layer (`src/api.ts`) throws at app load
if `VITE_API_BASE_URL` is missing in a production build — silent fallback
to `localhost` would only surface as broken queries on the live site.

In development you can leave it unset; the Vite dev server's proxy forwards
`/api/*` to `http://localhost:8000`.

---

## 3. Deploy to Vercel

1. Push the repo to GitHub.
2. <https://vercel.com/new> → **Import Git Repository** → select the repo.
3. **Configure Project:**
   - **Framework Preset:** Vite
   - **Root Directory:** `frontend`
   - **Build Command:** `npm run build` (default)
   - **Output Directory:** `dist` (default)
   - **Install Command:** `npm install` (default)
4. **Environment Variables:** add
   - Name: `VITE_API_BASE_URL`
   - Value: `https://<your-backend>.onrender.com`
   - Apply to: Production, Preview, and Development
5. Click **Deploy**. First build takes ~1–2 minutes.
6. Note the URL, e.g. `https://policylens.vercel.app`.

**Critical:** after the first deploy, copy the Vercel URL into the backend's
`FRONTEND_ORIGIN` env var (see [`backend/README_DEPLOY.md`](../backend/README_DEPLOY.md))
and redeploy the backend. Without this, the browser will reject responses
on CORS grounds.

---

## 4. Verify the deployment

Open the Vercel URL and check:

- The page loads with no console errors.
- The browser console logs `[PolicyLens] API_BASE_URL = https://<backend>` — confirms the env var was inlined.
- Submit any of the example queries. The answer should stream in with citation chips.
- Hovering a citation lights up the matching source card on the right.
- Clicking the citation expands and pulses the source card.
- Switching institutions (left sidebar) clears the timeline; switching back restores it.
- Reloading the page restores the active answer and the source inspector.
- Inspect the Network tab — the `/query` request goes directly to the backend host (not `/api/...`).

If `/query` fails with a CORS error, your backend's `FRONTEND_ORIGIN` doesn't match the Vercel URL exactly. The match is exact (no trailing slash, https vs http matters).

---

## 5. Updating the deployment

Vercel auto-deploys on every push to the configured branch (default `main`).
Preview deployments are created automatically for pull requests.

Changing `VITE_API_BASE_URL` requires a **rebuild**, not just a redeploy —
Vite inlines the value at build time. Use Vercel's "Redeploy → Use existing
Build Cache: off" option, or push an empty commit, to force a rebuild.

---

## 6. Operational notes

- **Bundle size.** Last measured: ~32 kB CSS / ~362 kB JS gzipped to ~114 kB. No analytics, no telemetry, no third-party fonts.
- **No cookies / no auth.** The frontend is fully unauthenticated; CORS is the only access control. Don't deploy this configuration on a backend that exposes private data.
- **Custom domain.** Add a domain in **Project Settings → Domains**. Update `FRONTEND_ORIGIN` on the backend to match.
- **Local dev against production backend.** Set `VITE_API_BASE_URL=https://<your-backend>` in `.env.local` (gitignored) before running `npm run dev`. Useful for debugging deploy-only issues.
