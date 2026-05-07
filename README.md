# PolicyLens

A RAG-powered web app that makes university governance documents - faculty handbooks, policy manuals, board minutes - queryable in plain language, with strict citation enforcement and reading-difficulty flags on retrieved passages.

## Why

University governance documents are typically 100–400 pages of dense bureaucratic prose. Students (especially first-generation, international, and students with disabilities), faculty, and researchers studying higher-ed governance need to find specific information quickly and trust that what they read reflects the source. PolicyLens addresses three gaps:

1. **Findability.** Plain-language queries return the exact governing passage with a page citation.
2. **Trust.** Every claim is grounded in retrieved context. The system declines to answer rather than hallucinate.
3. **Accessibility.** Retrieved passages are scored on reading difficulty (Flesch–Kincaid). Hard-to-parse policies are flagged so users know when to read carefully.

## Status

Active development. Initial commit May 2026.

## Screenshots

> _Screenshots / demo recording placeholder. Replace this section with rendered images once the demo is captured._

| | |
|---|---|
| ![Idle hero — composer + rotating example](docs/screenshots/idle-hero.png) | ![Active answer with citation chips](docs/screenshots/answer-with-citations.png) |
| ![Source inspector — ranked passages](docs/screenshots/source-inspector.png) | ![Stacked answer timeline](docs/screenshots/answer-timeline.png) |

A 90-second demo video lives at `docs/demo.mp4` (not committed; recorded per release).

---

## Architecture overview

PolicyLens is a 2-tier app: a stateless FastAPI backend in front of a local vector store, and a Vite + React frontend that talks to it over HTTPS. The backend has no database other than ChromaDB; there is no user auth and no cross-request state.

```
                                 ┌──────────────────────────────────┐
                                 │  Frontend (Vite + React + TS)     │
                                 │  ─ Search composer / answer stack │
                                 │  ─ Per-institution session in     │
                                 │    localStorage (no backend)      │
                                 └────────────────┬─────────────────┘
                                                  │  POST /query
                                                  │  (HTTPS, CORS-scoped)
                                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Backend (FastAPI, Python 3.12)                                          │
│                                                                          │
│   /query  ──►  Retriever  ──►  ChromaDB (sentence-transformers / MiniLM) │
│                                       │                                  │
│                                       ▼                                  │
│                              top-k retrieved chunks                      │
│                              + Flesch–Kincaid grade per chunk            │
│                                       │                                  │
│                                       ▼                                  │
│                          Prompt builder (citation rules)                 │
│                                       │                                  │
│                                       ▼                                  │
│                       LLM provider (factory + abstraction)               │
│                       ─ ollama  → http://localhost:11434  (dev)          │
│                       ─ groq    → api.groq.com           (prod)          │
└──────────────────────────────────────────────────────────────────────────┘
```

Key invariants:

- **No hallucinated citations.** Every claim in an answer is followed by `[Institution, Section, p.N]`. Citation grammar is enforced in the system prompt and the frontend's citation parser refuses brackets that don't match a retrieved source.
- **Stateless backend.** Every `/query` is independent. Conversation history, active answer, and the per-institution timeline live entirely in the browser's `localStorage`.
- **Provider-pluggable LLM.** The provider layer (`backend/app/llm/`) exposes a single `LLMProvider` interface. `LLM_PROVIDER` env var picks `ollama` (local) or `groq` (production). Adding a third provider is a new file + a one-line factory entry.
- **Reading-difficulty awareness.** Each retrieved chunk gets a Flesch–Kincaid grade. Chunks above grade 14 are flagged in the LLM context and badged in the UI so the reader knows to read carefully.

### Directory map

```
policylens/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI routes + CORS + lifespan probe
│   │   ├── config.py                # pydantic-settings, reads .env
│   │   ├── ingestion.py             # PDF → sections → chunks → Chroma
│   │   ├── retrieval.py             # Chroma query → top-k chunks
│   │   ├── prompts.py               # citation-enforcing system prompts
│   │   ├── readability.py           # Flesch–Kincaid scoring
│   │   └── llm/                     # provider abstraction
│   │       ├── base.py              # LLMProvider ABC
│   │       ├── ollama_provider.py   # local dev
│   │       ├── groq_provider.py     # production
│   │       ├── factory.py           # singleton + env-driven selection
│   │       └── engine.py            # retry / cache / fallback
│   ├── tests/                       # pytest suite (30 tests)
│   ├── Dockerfile                   # production image
│   ├── render.yaml                  # Render blueprint
│   ├── railway.json                 # Railway config
│   └── README_DEPLOY.md
├── frontend/
│   ├── src/
│   │   ├── App.tsx                  # 3-pane layout + responsive drawer
│   │   ├── state.tsx                # React Context: timeline, sessions
│   │   ├── api.ts                   # single fetch source-of-truth
│   │   ├── citations.ts             # citation tokenizer + source grouper
│   │   ├── institutions.ts          # tint/identity table
│   │   └── components/              # CenterPanel, RightInspector, …
│   ├── vite.config.ts               # dev proxy → localhost:8000
│   └── README_DEPLOY.md
├── docs/
│   └── design-choices.md            # running log of tradeoff decisions
└── README.md
```

---

## Stack

| Layer | Choice |
|---|---|
| Backend | Python 3.12, FastAPI, Uvicorn |
| PDF parsing | PyMuPDF (preserves section + page metadata) |
| Embeddings | `sentence-transformers/all-MiniLM-L6-v2` (local, runs on Apple Silicon CPU) |
| Vector DB | ChromaDB, persistent local directory |
| LLM (dev) | [Ollama](https://ollama.com), default `qwen2.5:7b-instruct` |
| LLM (prod) | [Groq](https://console.groq.com), default `llama3-70b-8192` |
| Frontend | Vite + React + TypeScript + Tailwind v4 + Framer Motion |
| Deployment | Backend → Render or Railway (Docker). Frontend → Vercel. |

---

## Local setup

### 1. Python backend

Requires Python 3.12 (newer versions don't yet have wheels for `sentence-transformers` / `chromadb`). The cleanest setup uses [`uv`](https://docs.astral.sh/uv/), which downloads its own statically-built Python and avoids macOS toolchain issues:

```bash
# Install uv (one time)
brew install uv
# or, without Homebrew: curl -LsSf https://astral.sh/uv/install.sh | sh

cd backend
uv venv --python 3.12          # downloads a clean Python 3.12 if needed
source .venv/bin/activate
uv pip install -r requirements.txt
cp .env.example .env
```

If you prefer the standard tooling, `python3.12 -m venv .venv && pip install -r requirements.txt` works too.

### 2. Ollama (local LLM, no API key required)

PolicyLens runs its language model locally during development - answers stay on your machine and there's no API quota or external service dependency.

```bash
# Install
brew install ollama
# or: curl -fsSL https://ollama.com/install.sh | sh

# Start the server (keep this running in a separate terminal,
# or `brew services start ollama` to run it as a background service)
ollama serve

# Pull the default model (~4.7 GB, one-time download)
ollama pull qwen2.5:7b-instruct
```

#### Alternative models

Set `OLLAMA_MODEL` in `.env` to switch (legacy `LOCAL_LLM_MODEL` is also accepted):

| Model | Notes |
|---|---|
| `qwen2.5:7b-instruct` | **Default.** Best instruction-following at 7B scale. |
| `mistral:7b-instruct` | Slightly faster, similar quality on extraction tasks. |
| `llama3.1:8b-instruct` | Meta's open model — strong general-purpose alternative. |

#### Hardware expectations on Apple Silicon

| Model | RAM (Q4 quant) | Tokens/sec (M1/M2/M4) | First request |
|---|---|---|---|
| qwen2.5:7b | ~4.5 GB | 25–40 | 3–8s cold |
| mistral:7b | ~4.4 GB | 25–40 | 3–8s cold |
| llama3.1:8b | ~5.0 GB | 20–35 | 4–10s cold |

A typical RAG response (8 retrieved chunks, ~1500 tokens of context) takes 5–15 seconds end-to-end. The first request after `ollama serve` is slower because the model has to be loaded into memory; subsequent requests hit a warm model.

### 3. Optional: Groq (cloud) for local benchmarking

If you'd rather use the production model locally (e.g. to benchmark answer quality without spinning up Ollama), set in `.env`:

```
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_…   # from https://console.groq.com/keys
```

Free key (no credit card). Free-tier quota is generous (~30 RPM on `llama3-70b-8192` at the time of writing).

### 4. Adding documents

```bash
# Drop a PDF into backend/data/pdfs/, then ingest:
python -m app.ingestion ingest \
  --institution "Northeastern" \
  --pdf data/pdfs/northeastern_faculty_handbook_2026.pdf
```

The vector DB and PDFs are gitignored — you must run ingestion locally before either local dev or production deploy.

### 5. Run

```bash
# Terminal 1: Ollama (skip if running as a service)
ollama serve

# Terminal 2: Backend
cd backend && uvicorn app.main:app --reload

# Terminal 3: Frontend
cd frontend && npm install && npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api/*` to the backend, so no frontend env config is needed for local dev.

On startup, the backend probes the configured LLM provider and logs which one is in use. If Ollama is unreachable or the configured model isn't pulled, the server still comes up — `/query` returns a fallback message until the LLM is available again.

---

## Deployment overview

PolicyLens has two deploy targets, both free for development traffic:

```
Frontend (static)               Backend (Docker)
┌──────────────┐                ┌──────────────────────┐
│   Vercel     │  ──── HTTPS ──►│  Render or Railway   │
│   Vite build │  CORS-scoped   │  FastAPI + Chroma    │
└──────────────┘                └──────────┬───────────┘
                                            │
                                    HTTPS   │
                                            ▼
                                ┌──────────────────────┐
                                │  Groq API            │
                                │  api.groq.com        │
                                └──────────────────────┘
```

Detailed instructions:

- **Backend** → [`backend/README_DEPLOY.md`](backend/README_DEPLOY.md). Render or Railway, both via the included `Dockerfile`. Required env: `LLM_PROVIDER=groq`, `GROQ_API_KEY`, `FRONTEND_ORIGIN`.
- **Frontend** → [`frontend/README_DEPLOY.md`](frontend/README_DEPLOY.md). Vercel, root directory `frontend`. Required env: `VITE_API_BASE_URL` (the deployed backend URL).

### Deploy order

1. Ingest your handbooks locally (`python -m app.ingestion ingest …`). The `data/chroma_db/` directory is baked into the backend Docker image at build time.
2. Deploy the **backend** first. Note its URL.
3. Deploy the **frontend** with `VITE_API_BASE_URL` pointing at that URL.
4. Add the frontend's URL to the backend's `FRONTEND_ORIGIN` env var and redeploy the backend (so CORS allows the frontend).
5. Verify with the checklist in `frontend/README_DEPLOY.md`.

---

## Production Deployment Guide

### Architecture

Frontend deploys to **Vercel** (static Vite build). Backend deploys to **Render** or **Railway** (FastAPI in Docker). Production LLM is **Groq**; **Ollama** is the local-dev provider only.

### Required environment variables

**Frontend (Vercel):**

| Variable | Required | Value |
|---|---|---|
| `VITE_API_BASE_URL` | yes | Full backend URL, no trailing slash |

**Backend (Render / Railway):**

| Variable | Required | Value |
|---|---|---|
| `LLM_PROVIDER` | yes | `groq` (production) or `ollama` (dev) |
| `GROQ_API_KEY` | yes (prod) | `gsk_…` from <https://console.groq.com/keys> |
| `GROQ_MODEL` | no | default `llama3-70b-8192` |
| `OLLAMA_BASE_URL` | no (dev only) | default `http://localhost:11434` |
| `FRONTEND_ORIGIN` | yes (prod) | Deployed frontend URL, exact match |

### Deployment steps

#### A. Backend (Render or Railway)

1. Push the repo to GitHub.
2. **Render:** New → Blueprint → select repo. It picks up `backend/render.yaml` + `Dockerfile`.
   **Railway:** New Project → Deploy from GitHub. It picks up `backend/railway.json` + `Dockerfile`.
3. In the platform's environment panel, set: `LLM_PROVIDER=groq`, `GROQ_API_KEY`, `FRONTEND_ORIGIN`.
4. Deploy. First build ~3–5 minutes (downloads embedding model).
5. Verify:
   ```bash
   curl https://<backend>/health        # → {"status":"ok"}
   curl https://<backend>/health/llm    # → {"provider":"groq","status":"ok",...}
   ```

#### B. Frontend (Vercel)

1. Vercel → Import Git Repo → set **Root Directory** to `frontend`, framework Vite.
2. Set env var: `VITE_API_BASE_URL` = `https://<your-backend>` (Production + Preview).
3. Deploy. ~1–2 minutes.
4. Copy the Vercel URL into the backend's `FRONTEND_ORIGIN` and redeploy the backend.

### Local development

```bash
# Terminal 1 — Ollama (optional; only when LLM_PROVIDER=ollama)
ollama serve
ollama pull qwen2.5:7b-instruct

# Terminal 2 — Backend
cd backend
uv venv --python 3.12 && source .venv/bin/activate
uv pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload

# Terminal 3 — Frontend
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api/*` to the backend in dev — no env config needed.

### Verification checklist

- [ ] `/health` returns 200
- [ ] `/health/llm` returns 200 with the expected provider/model
- [ ] Submitting a query returns an answer with citation chips
- [ ] Hovering / clicking a citation lights up the matching source card
- [ ] Switching institutions clears the visible timeline; switching back restores it
- [ ] Reloading the page restores the active answer and source inspector

### Common issues

- **CORS error in browser console** — backend `FRONTEND_ORIGIN` doesn't exactly match the Vercel URL (mind https vs http, no trailing slash). Update env, redeploy backend.
- **Frontend throws `VITE_API_BASE_URL is not set`** — Vercel env var missing or empty. Set it and trigger a rebuild (Vite inlines at build time, not runtime).
- **`/health/llm` returns 503** — `GROQ_API_KEY` missing or invalid. Rotate at <https://console.groq.com/keys>, update env, redeploy backend.

## Sourcing documents

PolicyLens uses publicly-available governance documents. Faculty handbooks are typically published by university provost or HR offices and linked from public university websites. **Always verify a document is publicly published before ingesting; never ingest internal-only or confidential documents.**

## Design decisions and tradeoffs

See [`docs/design-choices.md`](docs/design-choices.md) for a running log of decisions made during development - chunking strategy, embedding choice, retrieval-k tuning, prompt iteration, the LLM-provider pivots (Anthropic → Gemini → Ollama+Groq), etc. This doc exists because evaluating computational tooling is a deliberate part of the project's purpose, not just engineering hygiene.

## License

To be determined. Currently a research/demonstration project — not yet licensed for redistribution.
