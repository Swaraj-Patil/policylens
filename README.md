# PolicyLens

A RAG-powered web app that makes university governance documents — faculty handbooks, policy manuals, board minutes — queryable in plain language, with strict citation enforcement and reading-difficulty flags on retrieved passages.

## Why

University governance documents are typically 100–400 pages of dense bureaucratic prose. Students (especially first-generation, international, and students with disabilities), faculty, and researchers studying higher-ed governance need to find specific information quickly and trust that what they read reflects the source. PolicyLens addresses three gaps:

1. **Findability.** Plain-language queries return the exact governing passage with a page citation.
2. **Trust.** Every claim is grounded in retrieved context. The system declines to answer rather than hallucinate.
3. **Accessibility.** Retrieved passages are scored on reading difficulty (Flesch–Kincaid). Hard-to-parse policies are flagged so users know when to read carefully.

## Status

Active development. Initial commit May 2026.

## Stack

- **Backend:** Python 3.12, FastAPI, ChromaDB
- **PDF parsing:** PyMuPDF (preserves section + page metadata)
- **Embeddings:** `sentence-transformers/all-MiniLM-L6-v2` (local, runs on Apple Silicon)
- **LLM:** Local inference via [Ollama](https://ollama.com) (default: `qwen2.5:7b-instruct`). Optional Gemini fallback via `google-genai`.
- **Frontend:** Vite + React + TypeScript + Tailwind + shadcn/ui

## Setup

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

### 2. Ollama (local LLM, no API key required)

PolicyLens runs its language model locally — answers stay on your machine and there's no API quota or external service dependency.

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

Set `LOCAL_LLM_MODEL` in `.env` to switch:

| Model                    | Notes                                                   |
| ------------------------ | ------------------------------------------------------- |
| `qwen2.5:7b-instruct`    | **Default.** Best instruction-following at 7B scale.    |
| `mistral:7b-instruct`    | Slightly faster, similar quality on extraction tasks.   |
| `llama3.1:8b-instruct`   | Meta's open model — strong general-purpose alternative. |

#### Hardware expectations on Apple Silicon

| Model       | RAM (Q4 quant) | Tokens/sec (M1/M2/M4) | First request |
| ----------- | -------------- | --------------------- | ------------- |
| qwen2.5:7b  | ~4.5 GB        | 25–40                 | 3–8s cold     |
| mistral:7b  | ~4.4 GB        | 25–40                 | 3–8s cold     |
| llama3.1:8b | ~5.0 GB        | 20–35                 | 4–10s cold    |

A typical RAG response (8 retrieved chunks, ~1500 tokens of context) takes 5–15 seconds end-to-end. The first request after `ollama serve` is slower because the model has to be loaded into memory; subsequent requests hit a warm model.

### 3. Optional: Gemini cloud fallback

If you'd rather use a hosted model (e.g., for benchmarking quality), set `USE_LOCAL_LLM=false` in `.env` and provide `GEMINI_API_KEY`. Get a free key (no credit card) at <https://aistudio.google.com/apikey>. Free tier: 10 RPM, 250 RPD on `gemini-2.5-flash`.

## Adding documents

```bash
# Drop a PDF into backend/data/pdfs/, then ingest:
python -m app.ingestion ingest \
  --institution "Northeastern" \
  --pdf data/pdfs/northeastern_faculty_handbook_2026.pdf
```

## Running

```bash
# Terminal 1: Ollama (skip if running as a service)
ollama serve

# Terminal 2: Backend
cd backend && uvicorn app.main:app --reload

# Terminal 3: Frontend (after Day 3 scaffolding)
cd frontend && npm run dev
```

On startup, the backend probes Ollama and logs which provider/model is in use. If Ollama is unreachable or the configured model isn't pulled, you'll see a warning at startup but the server still comes up — `/query` will return a fallback message until the LLM is available again.

## Sourcing documents

PolicyLens uses publicly-available governance documents. Faculty handbooks are typically published by university provost or HR offices and linked from public university websites. **Always verify a document is publicly published before ingesting; never ingest internal-only or confidential documents.**

## Design decisions and tradeoffs

See [`docs/design-choices.md`](docs/design-choices.md) for a running log of decisions made during development — chunking strategy, embedding choice, retrieval-k tuning, prompt iteration, the LLM-provider pivot, etc. This doc exists because evaluating computational tooling is a deliberate part of the project's purpose, not just engineering hygiene.

## License

To be determined. Currently a research/demonstration project — not yet licensed for redistribution.
