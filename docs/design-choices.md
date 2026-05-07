# Design choices and tradeoffs

A running log of technical decisions made during PolicyLens development.

Each entry follows the same shape:

- **Choice** — what we picked
- **Alternatives** — what we considered
- **Why** — the tradeoff in 1–3 sentences
- **To revisit** — what would make us change our mind (optional)

This document is part of the project's purpose, not just engineering hygiene. The Research Assistant role this project is built around explicitly calls for the ability to "research, evaluate, and advise on computational tools and resources" — this doc is how we demonstrate that work.

---

## LLM provider — pivoted from Claude to Gemini

**Choice:** Google Gemini 2.5 Flash via the `google-genai` Python SDK.

**Originally planned:** Anthropic Claude (Opus 4.7).

**Why we pivoted:** Anthropic removed free API credits as of 2026; Northeastern's institutional "Premium Seat" covers claude.ai chat usage but does not extend to API tokens. Building a credible RAG demo requires hundreds of API calls during development (smoke tests, prompt iteration, comparison-mode tuning), and out-of-pocket costs on Opus 4.7 would run into double digits before the MVP ships.

**Why Gemini specifically:** Google AI Studio offers a no-credit-card free tier with 10 RPM and 250 RPD on `gemini-2.5-flash` — enough headroom for a single-developer dev cycle without throttling. Gemini 2.5 Flash handles citation-grounded extraction tasks reliably on benchmarks. It also has a 1M-token context window, which is overkill for our top-k=8 retrieval but useful headroom if we expand to longer-context comparison queries.

**What stayed the same:** The system prompts in `prompts.py` are LLM-agnostic. Switching providers required ~30 lines of adapter code in `llm.py`; the citation rules, anti-hallucination template, and context-block format all carry over.

**What it cost us:** Slight quality drop vs. Opus 4.7 on long-instruction following. Mitigation: keep the prompt rules tight and explicit (which they already are), and run a regression test set after Day 2 to verify no citation drift.

**To revisit:** If we ever land an Anthropic research credits grant or move to a paid tier, swap back to Claude — the architecture supports it cleanly. Document the cross-provider quality delta if we do.

---

## Chunking strategy

**Choice:** Section-aware chunking with token-based splitting, target 400 tokens, 50-token overlap.

**Alternatives:** Fixed-size chunks (e.g., 500 tokens with no respect for section boundaries); semantic chunking via topic-shift detection.

**Why:** Governance documents have strong section structure (Article III, Section 4, etc.). Section-aware chunking preserves that structure as metadata, which is critical for citations. Fixed-size chunking produces "headless" mid-sentence chunks that retrieve poorly. Semantic chunking is overkill for the consistency of these documents.

**To revisit:** If retrieval misses cross-section answers (e.g., a policy that spans two articles), explore hierarchical retrieval — retrieve sections first, then chunks within them.

---

## Embedding provider

**Choice:** `sentence-transformers/all-MiniLM-L6-v2` (local).

**Alternatives:** Voyage AI `voyage-3` (cloud, paid); Google Gemini embedding model (cloud, free tier available).

**Why local:** Free; runs in seconds on M4 (Apple Silicon — no CUDA needed); sufficient quality for the relatively narrow domain of governance language. Lets the project run end-to-end without depending on a network call for every chunk.

**Why not Gemini embeddings (despite already using Gemini for the LLM):** Keeping embeddings local makes ingestion deterministic and offline-capable. We can re-index without burning RPM quota. Worth comparing later, but not the right default for a dev cycle.

**To revisit:** After Day 2 smoke tests, if MiniLM misses on policies with synonym-heavy phrasing, run the same test set through Gemini embeddings (free tier, separate quota from generation) and record the side-by-side delta.

---

## Vector store

**Choice:** ChromaDB, persistent local.

**Alternatives:** Pinecone, Qdrant Cloud, FAISS (raw, no metadata layer).

**Why:** Zero-ops, persists to a folder on disk, no network dependency, and the metadata-filter API is good enough for our needs (filter by institution). Pinecone is the obvious cloud upgrade if multi-user serving becomes a goal; Qdrant is a strong middle ground with better filtering than Chroma.

**To revisit:** If we want to deploy a public demo with multiple concurrent users, a managed vector DB (Pinecone or Qdrant Cloud) becomes worth the cost.

---

## Retrieval top-k

**Choice (initial):** 8.

**Why:** Empirical guess — too few (e.g., 3) and the model misses corroborating context for nuanced policies; too many (e.g., 20) and the context window fills with weakly-relevant chunks that increase hallucination risk.

**To revisit:** Day 1 smoke test will reveal whether 8 is right. If top results are uniformly relevant, try lowering to 5; if relevant chunks frequently appear in positions 6–10, raise to 12.

---

## Anti-hallucination strategy

**Choice:** System-prompt-level rules + a context-block format that makes provenance explicit + an "I don't know" template the model is instructed to use verbatim.

**Alternatives considered:** Self-consistency / multi-sample voting; secondary verification model that checks every claim against retrieved context.

**Why:** The system-prompt approach is the cheapest way to get most of the way there, and it's what reads in the prompt itself — the rules are auditable. A verification pass would catch residual hallucinations but doubles the LLM cost (and burns 2x the free-tier quota); we'll add it only if smoke tests reveal a real failure rate.

**To revisit:** If during Day 2 testing we see fabricated citations or paraphrases that drift from the source, add a second-pass verification call.

---

## Readability scoring

**Choice:** Flesch-Kincaid Grade Level via the `textstat` library, computed once at ingestion time and stored as chunk metadata.

**Why:** Free, well-understood, computed in milliseconds, and the grade-level interpretation ("written at a 16th-grade level") is something users intuitively get. Threshold for the "high difficulty" flag is 14 (configurable via env var) — that's roughly upper-undergraduate reading level, above which most users will struggle.

**To revisit:** Flesch-Kincaid is sentence-length-and-syllable-count heuristic; it doesn't penalize jargon directly. If we have time, complement it with a jargon-density score (% of words not in a general-English frequency list).

---

## Python version

**Choice:** Python 3.12.

**Why not 3.13 / 3.14:** Both `sentence-transformers` (via PyTorch) and `chromadb` lag mainline Python releases by 6–12 months on wheel availability. Trying to install on 3.14 in May 2026 fails with build-from-source errors that are not worth debugging for a project where 3.12 works perfectly.

**Why not 3.11:** 3.12 has measurably better startup time and improved error messages, and is the current recommended baseline for new ML projects.

---

(Add new entries below as decisions arise.)

---

## Heading detection threshold — tuned from 1.5× to 1.15× body font size

**Choice:** Flag a span as a heading if its font size is ≥ 1.15× the document's modal body font size (or bold AND ≥ 1.05×). Reject headings composed entirely of digits.

**Originally:** 1.5× threshold (≥ 19.5pt on a 13pt body).

**Why we lowered it:** The real Northeastern Faculty Handbook (149 pages) uses 13.0pt body text with 15.1–16.1pt section headings — a ratio of 1.16–1.24×. Headings in this PDF are not bold (bold=False on all spans); the only signal is size. The 1.5× threshold missed every sub-section heading, producing only 41 coarse sections (including a single "Governance" block spanning 31 pages and 9,373 words). After lowering to 1.15×, the same document produces 143 sections with meaningful titles ("(2) Composition", "2. Regular Grievance Procedure", etc.) and 206 chunks — retrieval on "Faculty Senate elections" improved from distance 0.48 (noise) to 0.22 (exact match).

**Why not lower further (e.g., 1.05×):** The modal body size is the most common size by character count, but PDFs often contain a secondary size band just below body (typically 12pt footnotes/captions on a 13pt document). A 1.05× threshold (13.65pt) could pull those in as headings. 1.15× sits cleanly above the footnote band.

**Digit-only filter:** Section numbers like "13" or "17" appeared as heading-sized text in the Harvard summary PDF. Rejecting any heading whose text contains no alphabetic characters prevents numeric chapter markers from polluting section titles and citations.

**To revisit:** If a future PDF has a body/heading ratio below 1.15× (unusual but possible in dense legal-style documents), the threshold can be lowered further or made per-document by analyzing the bimodal gap in the font-size distribution rather than using a fixed ratio.

---

## Token estimation — word-count proxy over tiktoken

**Choice:** `int(len(text.split()) / 0.75)` — approximately 1.33 tokens per word.

**Alternative:** `tiktoken` (exact BPE token count matching GPT-4/Claude tokenizers).

**Why proxy:** `tiktoken` is not in `requirements.txt` and adds a non-trivial dependency. For chunking governance documents (dense English prose, minimal code), the word-count approximation is accurate to within ±10% and produces consistent chunk sizes. The 400-token target is itself an empirical guess, so sub-token precision in estimation adds no value.

**To revisit:** If we ever switch to a model with a very different tokenizer (e.g., a character-level model) or need to stay under a hard token budget for context packing, replace with exact tokenizer counts.

---

## LLM resilience — retry, timeout, and graceful fallback

**Choice:** Wrap every Gemini call in `call_with_retry`, a reusable helper that:
- retries up to 3 times (4 total attempts) on transient errors with exponential backoff (1s → 2s → 4s);
- treats HTTP 408/429/500/502/503/504, `httpx` timeout/network errors, and `google.api_core` `ServiceUnavailable`/`TooManyRequests`/`DeadlineExceeded`/`InternalServerError`/`GatewayTimeout` as retryable;
- logs each retry attempt at WARNING and final failure at ERROR with the exception type and message;
- applies a 60-second per-request timeout via `types.HttpOptions(timeout=60_000)` on the `genai.Client`.

If retries are exhausted (or a non-retryable error occurs), `_call_gemini` returns a fixed `FALLBACK_MESSAGE` string instead of raising, so `/query` always returns a structured response with the retrieved sources still populated.

**Why retry transparently:** Free-tier Gemini occasionally returns `503 UNAVAILABLE` and rate-limit `429`s under load. Treating these as terminal errors made the demo brittle — a single transient hiccup crashed the request even though a retry would have succeeded. Exponential backoff (rather than constant or linear) is the standard pattern when many clients might be hitting the same overloaded endpoint; the 1s/2s/4s schedule converges quickly enough for a single-user dev tool while giving the upstream room to recover.

**Why fallback instead of HTTP 503:** The retrieval layer already produced relevant sources before the LLM was called. Returning those sources alongside a "service temporarily unavailable" answer lets the frontend show *something* useful — the user can read the source passages directly. A bare HTTP 503 from `/query` would discard work that already succeeded.

**Why we don't cache the fallback:** The cache key is `sha256(system_prompt + user_message)`. If we cached the fallback, every subsequent identical query would short-circuit to the fallback even after Gemini recovered. Cache is set only on success.

**Why retries don't re-run retrieval:** Retrieval is deterministic given the corpus and embedding model — it can't be the source of a 503. Re-running it would waste 100ms per retry on the embedding model and a Chroma query for no benefit.

**To revisit:** If we ever see persistent rate-limiting that retries can't paper over, switch the default model to `gemini-2.5-flash-lite` (15 RPM, 1000 RPD vs. 10/250) or add jittered backoff. For multi-user deployment, consider a per-user circuit breaker so a sustained outage doesn't have every request waiting through the full retry budget.

---

## LLM provider — pivoted again, from Gemini to local Ollama

**Choice:** Local LLM inference via [Ollama](https://ollama.com), default model `qwen2.5:7b-instruct`. Configurable via `LOCAL_LLM_MODEL`. Gemini support is preserved as an opt-in fallback (`USE_LOCAL_LLM=false` + `GEMINI_API_KEY`).

**Originally:** Google Gemini 2.5 Flash via `google-genai`.

**Why we pivoted:** Two pressures converged:
1. **Reliability under free-tier load.** Gemini's free tier returned intermittent `503 UNAVAILABLE` responses during dev. The retry/fallback layer covered most of these, but every hiccup added 7+ seconds of latency (1s+2s+4s backoff) and the project still depended on someone else's uptime.
2. **The deliverable should be self-contained.** This is a portfolio project for a research-assistant role; reviewers shouldn't have to set up a Google API key to run it locally, and a live demo shouldn't break if Google rate-limits during a presentation.

**Why Ollama specifically:** Ollama is the lowest-friction way to run a quantized open-weights model on Apple Silicon — `brew install ollama && ollama pull <model>` and you have a localhost HTTP API. No Python ML stack to wrangle, no per-model integration code, Metal acceleration handled automatically.

**Why `qwen2.5:7b-instruct`:** Of the 7B-class instruction-tuned models that fit comfortably in <5 GB of unified memory, Qwen 2.5 has the strongest published instruction-following scores and the cleanest behavior on extraction tasks like "answer only from this context, with citations." `mistral:7b-instruct` and `llama3.1:8b-instruct` are documented as drop-in alternatives; switching is a one-line `.env` change.

**What stayed the same:** The system prompts in `prompts.py` — citation rules, decline templates, readability flagging, comparison structure — apply to any instruction-following model. Retrieval, embeddings, and ChromaDB are unchanged. The retry/cache/fallback architecture in `llm.py` is provider-agnostic; Ollama errors flow through the same classifier (`httpx.HTTPStatusError` for 5xx, `httpx.ConnectError` for "Ollama not running", `httpx.TimeoutException` for slow inference).

**What changed:**
- `_invoke_ollama` is now the default provider; `_invoke_gemini` still exists and is picked at call time by `settings.use_local_llm`.
- `google-genai` is imported lazily inside `_invoke_gemini` so the default path doesn't load the SDK at all.
- Cache key now includes the provider tag (`ollama:qwen2.5:7b-instruct` vs `gemini:gemini-2.5-flash`) so switching models doesn't return stale answers.
- FastAPI startup runs `check_llm_available()` via the `lifespan` hook — probes `GET /api/tags`, logs the resolved model, and warns if Ollama is down or the model isn't pulled. Startup is non-fatal; the server comes up either way and `/query` returns the fallback message until Ollama is reachable.
- `num_ctx=8192` is set explicitly in the Ollama request options — Ollama's default of 2048 truncates the context block (8 chunks × ~400 tokens + system prompt ≈ 4K).

**Trade-offs we accepted:**
- **Latency.** End-to-end query latency goes from ~2s (Gemini cloud) to ~5–15s warm / ~30s cold-start (local 7B model on M-series). Acceptable for a single-user demo; would need rethinking for a multi-user public deployment.
- **Quality on long-instruction following.** Empirically, `qwen2.5:7b` follows the citation format `[Institution, Section, p.N]` faithfully but smaller/older models occasionally drift to `[Citing: ...]` or omit the page number — observed once on `llama3:latest` during smoke testing. Mitigation: the system prompt in `prompts.py` is explicit about format, and the frontend will tolerate format variations when parsing citations (planned for Day 3+).
- **Cold-start latency.** First request after `ollama serve` takes 5–10s to load the model into memory. Subsequent requests are warm.

**To revisit:** If citation-format drift becomes an issue, evaluate `qwen2.5:14b-instruct` (~9 GB RAM, still runs on M3/M4 with 16+ GB) or add an output-validation layer that re-prompts on malformed citations. For deployment, the architecture supports swapping in any OpenAI-compatible endpoint (vLLM, TGI, OpenRouter) by adding one more `_invoke_*` function and updating the dispatcher.
