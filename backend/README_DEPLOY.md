# Backend deployment

End-to-end instructions for deploying the PolicyLens FastAPI backend.

The backend is a stateless HTTP service. Two deployment paths are supported
out of the box:

- **Render** — uses [`render.yaml`](./render.yaml) + [`Dockerfile`](./Dockerfile). Free web-service tier sleeps after inactivity (cold start ≈ 30s).
- **Railway** — uses [`railway.json`](./railway.json) + [`Dockerfile`](./Dockerfile). Always-on; free trial credits, then usage-based.

Both platforms read the same `Dockerfile` and the same env vars. Pick whichever you prefer.

---

## 1. Prerequisites

### Groq API key (required for production)

Production uses Groq for inference (Ollama is a local-dev convenience).

1. Sign in at <https://console.groq.com>.
2. Open <https://console.groq.com/keys> → **Create API Key**.
3. Copy the key (`gsk_…`). You'll paste it into the platform dashboard later — it must NOT be committed to the repo.

The free tier currently allows ~30 requests/minute on `llama3-70b-8192`. Check the dashboard for current limits.

### Frontend origin

Have the deployed frontend URL ready (e.g. `https://policylens.vercel.app`). The backend only allows CORS requests from this origin (plus localhost for dev).

### Vector database

The Docker image bakes `data/chroma_db/` into the build. **Ingest your handbooks locally before deploying:**

```bash
cd backend
source .venv/bin/activate
python -m app.ingestion ingest --institution "Northeastern" --pdf data/pdfs/northeastern_faculty_handbook_2026.pdf
# repeat for each institution
```

If `data/chroma_db/` is empty at build time, the container will start, `/health` will return 200, and `/query` will return "no relevant passages" for everything. Re-ingesting requires a rebuild.

---

## 2. Environment variables

Set these in your platform's environment panel (NOT in `.env`, NOT committed):

| Variable | Required | Value |
|---|---|---|
| `LLM_PROVIDER` | yes | `groq` |
| `GROQ_API_KEY` | yes | `gsk_…` (from console.groq.com/keys) |
| `GROQ_MODEL` | no | default `llama3-70b-8192` |
| `FRONTEND_ORIGIN` | yes | `https://<your-frontend>.vercel.app` |
| `LLM_CACHE_ENABLED` | no | default `false` in the production Dockerfile |
| `RETRIEVAL_TOP_K` | no | default `8` |
| `HIGH_READING_DIFFICULTY_THRESHOLD` | no | default `14.0` |

The Dockerfile already sets `LLM_PROVIDER=groq` and `LLM_CACHE_ENABLED=false` as defaults — you only strictly need to set `GROQ_API_KEY` and `FRONTEND_ORIGIN`.

---

## 3a. Deploy to Render

1. Push the repo to GitHub.
2. <https://dashboard.render.com> → **New** → **Blueprint**.
3. Connect the repo. Render reads `backend/render.yaml` and creates a `policylens-backend` web service.
4. Open **Environment** for the service and set:
   - `GROQ_API_KEY` = `gsk_…`
   - `FRONTEND_ORIGIN` = `https://<your-frontend>.vercel.app`
5. Click **Manual Deploy** → **Deploy latest commit**.
6. Wait ~3–5 minutes for the first build (it downloads the embedding model and pre-warms it).
7. Note the service URL, e.g. `https://policylens-backend.onrender.com`.

**Render free tier note:** the service sleeps after 15 minutes of inactivity. The first request after a sleep takes ~30s while the container cold-starts; subsequent requests are sub-second.

## 3b. Deploy to Railway

1. Push the repo to GitHub.
2. <https://railway.app> → **New Project** → **Deploy from GitHub repo**.
3. Select the repo. Railway picks up `backend/Dockerfile` and `backend/railway.json`.
4. Open **Variables** for the service and set:
   - `LLM_PROVIDER` = `groq`
   - `GROQ_API_KEY` = `gsk_…`
   - `FRONTEND_ORIGIN` = `https://<your-frontend>.vercel.app`
5. Open **Settings** → **Networking** → **Generate Domain** to expose a public URL.
6. Note the service URL, e.g. `https://policylens-backend-production.up.railway.app`.

Railway injects `$PORT` automatically; the Dockerfile / `railway.json` start command honors it.

---

## 4. Verify the deployment

```bash
# Liveness — does NOT touch the LLM.
curl https://<backend>/health
# → {"status":"ok"}

# Provider readiness — validates the Groq API key.
curl https://<backend>/health/llm
# → {"provider":"groq","status":"ok","model":"llama3-70b-8192"}

# End-to-end query.
curl -X POST https://<backend>/query \
  -H "Content-Type: application/json" \
  -d '{"question":"What is the policy on outside consulting?","institution":"Northeastern"}'
# → {"answer":"…","sources":[…]}
```

If `/health/llm` returns 503, the API key is missing or invalid — check the platform's env panel.

---

## 5. Operational notes

- **Logs.** Both Render and Railway stream stdout. The backend logs the active provider on startup:
  ```
  [PolicyLens] LLM provider: groq
  [PolicyLens] Groq model: llama3-70b-8192
  ```
- **Updating the corpus.** Re-ingest locally → commit a new image (or trigger a rebuild). Chroma state is baked in; there's no live database to mutate.
- **Switching providers in production.** Setting `LLM_PROVIDER=ollama` in the platform env will fail unless you also have an Ollama-compatible backend reachable at `OLLAMA_BASE_URL` from the container — generally not the case on Render/Railway free tiers. Stick with Groq.
- **Cost.** Render free + Groq free tier = $0 for development traffic. Both have rate limits; production traffic will require a paid plan on at least one side.
- **Rotating the API key.** Update `GROQ_API_KEY` in the platform env and redeploy. There is no in-image cache of the key.
