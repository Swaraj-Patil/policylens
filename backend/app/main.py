"""FastAPI entry point for PolicyLens."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.config import settings
from app.llm import answer_single, check_llm_available
from app.retrieval import retrieve

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    check_llm_available()
    yield


app = FastAPI(title="PolicyLens", version="0.1.0", lifespan=lifespan)


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


class QueryResponse(BaseModel):
    answer: str
    institution: str
    question: str
    sources: list[SourceInfo]


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/")
def health() -> dict:
    provider = "ollama" if settings.use_local_llm else "gemini"
    model = settings.local_llm_model if settings.use_local_llm else settings.gemini_model
    return {"status": "ok", "provider": provider, "model": model}


@app.post("/query", response_model=QueryResponse)
def query(req: QueryRequest) -> QueryResponse:
    """Answer a governance question about a single institution."""
    try:
        chunks = retrieve(
            question=req.question,
            institution=req.institution,
            top_k=req.top_k,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Retrieval failed: {exc}") from exc

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
            )
            for c in chunks
        ],
    )
