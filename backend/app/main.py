"""FastAPI entry point for PolicyLens."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.config import settings
from app.llm import (
    HealthCheckError,
    answer_single,
    check_llm_available,
    get_llm_provider,
)
from app.retrieval import ensure_collection_ready, retrieve

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan + CORS
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Touch the factory once so the "[PolicyLens] LLM provider: …" startup
    # log fires before any request arrives.
    get_llm_provider()
    check_llm_available()
    # Verify (or create) the Chroma collection. A fresh deploy without an
    # ingested DB now lands in an empty-collection state instead of crashing
    # on the first /query.
    ensure_collection_ready()
    yield


app = FastAPI(title="PolicyLens", version="0.1.0", lifespan=lifespan)


def _cors_origins() -> list[str]:
    """Build the allowed-origins list.

    Production: only `FRONTEND_ORIGIN` (the deployed frontend URL).
    Development: localhost variants for `vite dev` and Storybook.
    Both: never `["*"]`, since we don't gain anything from it.
    """
    origins: list[str] = []
    if settings.frontend_origin:
        origins.append(settings.frontend_origin.rstrip("/"))
    # Local dev hosts — kept regardless of env so a prod backend can still be
    # exercised from a local frontend during deploy verification.
    origins.extend(
        [
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    )
    # Deduplicate while preserving order.
    seen = set()
    out = []
    for o in origins:
        if o and o not in seen:
            seen.add(o)
            out.append(o)
    return out


app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class QueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    institution: str = Field(min_length=1)
    top_k: int | None = Field(default=None, ge=1, le=20)


class SourceInfo(BaseModel):
    institution: str
    section_title: str
    page_start: int
    page_end: int
    flesch_kincaid_grade: float | None = None
    text: str = ""


class QueryResponse(BaseModel):
    answer: str
    institution: str
    question: str
    sources: list[SourceInfo]


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    """Cheap liveness check — confirms the process is up. Does NOT touch the
    LLM (use /health/llm for that)."""
    return {"status": "ok"}


@app.get("/health/llm")
def health_llm() -> dict:
    """Provider-specific readiness check. Returns 200 with provider metadata
    on success; 503 with a brief error string on failure. No stack traces
    are exposed to the client."""
    provider = get_llm_provider()
    try:
        info = provider.health_check()
    except HealthCheckError as exc:
        raise HTTPException(
            status_code=503,
            detail={"provider": provider.name, "status": "error", "error": str(exc)},
        )
    return info


# Backwards-compat: the old root endpoint kept for any existing consumers.
@app.get("/")
def root() -> dict:
    info = get_llm_provider().info()
    return {"status": "ok", **info}


# ---------------------------------------------------------------------------
# /query
# ---------------------------------------------------------------------------

@app.post("/query", response_model=QueryResponse)
def query(req: QueryRequest) -> QueryResponse:
    """Answer a governance question about a single institution.

    Robust to a missing/empty vector store: if retrieval can't run for any
    reason (collection not yet created, persist dir gone, embedding model
    failure), we log the cause and proceed with `chunks=[]`. The downstream
    LLM path treats that as the "no relevant passages" case, the response
    schema is preserved, and the frontend renders its no_results state.
    """
    try:
        chunks = retrieve(
            question=req.question,
            institution=req.institution,
            top_k=req.top_k,
        )
    except Exception as exc:  # noqa: BLE001 — graceful no-data fallback
        logger.warning(
            "Retrieval failed for institution=%r (%s: %s). "
            "Returning empty-sources response.",
            req.institution,
            type(exc).__name__,
            exc,
        )
        chunks = []

    answer = answer_single(
        question=req.question,
        chunks=chunks,
        institution=req.institution,
    )

    return QueryResponse(
        answer=answer,
        institution=req.institution,
        question=req.question,
        sources=[
            SourceInfo(
                institution=c.institution,
                section_title=c.section_title,
                page_start=c.page_start,
                page_end=c.page_end,
                flesch_kincaid_grade=c.flesch_kincaid_grade,
                text=c.text,
            )
            for c in chunks
        ],
    )
