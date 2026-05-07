# PolicyLens — Project Context for Claude Code

## Who and why

I'm Swaraj Patil, an MS Computer Science student at Northeastern. I'm building this project across roughly one week so I can list it on my resume for a Research Assistant position at Northeastern's Center for the Future of Higher Education and Work (College of Professional Studies). The position involves applying AI/data science to higher-education governance documents — this project is a working demonstration of exactly that.

## What we're building

PolicyLens is a RAG-powered web app that makes university governance documents queryable in plain language with strict citation enforcement.

- **Inputs:** PDFs of faculty handbooks (and similar governance documents) from 5 universities
- **Core capability:** Answer plain-language questions about a single institution OR compare across institutions, always with page-anchored citations to the source PDF
- **Accessibility hook:** Score each retrieved passage on Flesch–Kincaid grade level; flag passages above grade 14 as "high reading difficulty" so users know when to read carefully
- **Anti-hallucination:** If the indexed corpus doesn't contain the answer, the system says so. **This is non-negotiable** and is the project's primary quality bar.

## Stack (decided — don't propose alternatives unless I ask)

| Layer | Choice |
|---|---|
| Backend | Python **3.12** (not 3.13/3.14 — ML deps lag), FastAPI |
| PDF parsing | PyMuPDF (`fitz`) — preserves section headers and page numbers as metadata |
| Vector store | ChromaDB, persistent local |
| Embeddings | `sentence-transformers/all-MiniLM-L6-v2` (local, free, fast on M4) |
| LLM | Google **Gemini 2.5 Flash** via the `google-genai` Python SDK (free tier: 10 RPM, 250 RPD — fine for dev) |
| Default model | `gemini-2.5-flash` (configurable via `GEMINI_MODEL`; switch to `gemini-2.5-flash-lite` if you start hitting RPD limits) |
| Frontend | Vite + React + TypeScript + Tailwind + shadcn/ui (built Day 3) |
| Deploy (optional, Day 6) | Vercel for frontend, Railway free tier for backend |

**Note on the LLM choice:** The original plan was Claude (Anthropic). We pivoted to Gemini after discovering Anthropic removed free API credits in 2026 and Northeastern's "Premium Seat" only covers claude.ai chat, not API access. See `docs/design-choices.md` for the full tradeoff write-up. The system prompts in `prompts.py` are LLM-agnostic and work as-is with Gemini.

**SDK note (important — don't get this wrong):** Use the new unified `google-genai` SDK, NOT the deprecated `google-generativeai` package. The pattern is:

```python
from google import genai
from google.genai import types

client = genai.Client()  # auto-reads GEMINI_API_KEY from env

response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=user_message,
    config=types.GenerateContentConfig(
        system_instruction=SINGLE_INSTITUTION_SYSTEM,
        temperature=0.0,  # deterministic for citation tasks
    ),
)
print(response.text)
```

Reference: <https://googleapis.github.io/python-genai/>

## Repo layout

```
policylens/
├── CLAUDE.md                       # This file
├── README.md                       # Public-facing readme
├── .gitignore
├── backend/
│   ├── requirements.txt
│   ├── .env.example
│   └── app/
│       ├── __init__.py
│       ├── prompts.py              # Citation-enforcing system prompts (already written — the quality bar)
│       ├── config.py               # (you'll write Day 1)
│       ├── ingestion.py            # (you'll write Day 1)
│       ├── retrieval.py            # (you'll write Day 2)
│       ├── llm.py                  # (you'll write Day 2)
│       ├── readability.py          # (you'll write Day 2)
│       └── main.py                 # FastAPI entry (Day 2)
├── docs/
│   └── design-choices.md           # Running log of tool tradeoff decisions — UPDATE AS WE GO
└── frontend/                       # Scaffolded Day 3
```

## How I want to work

- **Read first.** Before writing any code, read `backend/app/prompts.py` so you know the citation-enforcement rules, and `docs/design-choices.md` so you see how I'm tracking decisions.
- **Incremental.** One milestone per session. Don't try to build everything at once.
- **Tests as we go**, especially for the retrieval+citation pipeline. I want to be able to verify ground-truth answers against citations.
- **Document tradeoffs.** For every meaningful technical choice (chunk size, top_k, embedding model swap, prompt iteration, etc.), append a short entry to `docs/design-choices.md`. This document is part of my application — the RA posting explicitly mentions "evaluate computational tools and resources." This doc is how I demonstrate that.
- **Ask, don't fabricate.** When you're unsure about a decision (especially something that affects retrieval quality), ask me before committing to it.

## Build plan

| Day | Goal |
|---|---|
| **1** | Ingestion pipeline: PDF → section-aware chunks → embeddings → Chroma. CLI entrypoint. Smoke-test retrieval quality on hardcoded queries before moving on. |
| **2** | Retrieval module + LLM wrapper + readability scorer. FastAPI endpoints: `/query` (single-institution) and `/compare` (cross-institution). End-to-end test on real queries. |
| **3** | Vite + React + Tailwind frontend. Institution selector, query box, answer pane with collapsible citations linking to source PDF page anchors. |
| **4** | Cross-institution comparison view. Readability badges on retrieved passages. Polish loading/error states. |
| **5** | Accessibility theming (high-contrast mode, ARIA labels, full keyboard nav — accessibility shows up in the code, not just the pitch). Record a 90-second demo video. |
| **6** | (Optional) Deploy publicly. |
| **7** | (Optional) Stretch: topic clustering across institutions. |

## Day 1 — START HERE

Build the ingestion pipeline. Concretely:

1. **`backend/app/config.py`** — `pydantic-settings` reading `.env` (Gemini key, model, chunk size, top_k, persist dir). Single `Settings` instance exported.
2. **`backend/app/ingestion.py`** with these functions:
   - `parse_pdf(path: Path, institution: str) -> list[Section]` — uses PyMuPDF. Returns a list of `Section` dataclasses with `institution`, `section_title`, `text`, `page_start`, `page_end`. Detect headings via font-size heuristics (PyMuPDF gives span-level font info via `page.get_text("dict")`).
   - `chunk_sections(sections, target_tokens=400, overlap_tokens=50) -> list[Chunk]` — splits long sections, preserves all metadata in every chunk. Use `tiktoken` or a simple word-count proxy (~0.75 words per token) for token estimation; we don't need exactness.
   - `embed_and_store(chunks, collection_name="governance") -> None` — batches embeddings, stores in Chroma with full metadata (institution, section_title, page_start, page_end, chunk_index).
3. **CLI entrypoint:** `python -m app.ingestion ingest --institution "Northeastern" --pdf data/pdfs/northeastern_handbook.pdf`. Use `argparse` or `typer`.
4. **`scripts/smoke_retrieval.py`** — runs 5 hardcoded queries against the collection and prints top-3 chunks with full metadata. Examples of queries:
   - "What is the procedure for appealing a final course grade?"
   - "How is academic freedom defined for faculty?"
   - "What accommodations are available for students with disabilities?"
   - "How are members of the Faculty Senate elected?"
   - "What is the policy on outside consulting work?"

**Don't move to Day 2 until I've eyeballed the smoke-test output and confirmed retrieval quality looks reasonable.**

## Sample documents

I'm dropping 3 PDFs into `backend/data/pdfs/` named like `<institution>_<doctype>_<year>.pdf`. The institution name should be inferred from the filename prefix or passed via the CLI flag.

Universities: **Northeastern, Boston University, Harvard.** Three is enough — the cross-institution comparison view actually reads better with 3 rows than 5, and we can always add more later.

## Constraints

- I'm on a MacBook Air M4. Avoid anything CUDA-only. `sentence-transformers` MiniLM runs in seconds on M4 — that's the baseline.
- **Python 3.12 only.** My system has 3.14 but ML deps don't ship wheels for 3.14 yet. The project venv is created via `uv venv --python 3.12` (uv downloads its own statically-built Python — sidesteps Homebrew library-mismatch issues we hit on macOS).
- Stay within Gemini's free tier during dev: 10 RPM, 250 RPD on `gemini-2.5-flash`. If we start hitting limits, swap to `gemini-2.5-flash-lite` (15 RPM, 1000 RPD) via `.env`.
- Cache LLM responses to disk during dev (already wired into `.env.example` via `LLM_CACHE_ENABLED=true`) so re-running the same query doesn't burn quota.
- The vector DB and PDFs go in `.gitignore`. Never commit handbooks.
- Quotes from source documents in LLM responses must be **under 20 words and rare** — paraphrase by default. This is enforced in `prompts.py`.

## Quality bar

Before merging anything to main, this must hold:

1. Every claim in an LLM response is followed by a citation `[Institution, Section, p.N]`.
2. When the corpus genuinely doesn't contain the answer, the model says so rather than guessing.
3. Tests in `backend/tests/` cover at least: ingestion produces non-empty chunks with metadata; retrieval returns expected top result for a known-answer query; LLM declines to answer when given irrelevant context.

If any of those slip, we fix them before adding features.
