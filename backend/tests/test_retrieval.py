"""Integration tests for the retrieval module.

Requires ChromaDB collection to be populated (run ingestion first).
Skips if the collection is missing.
"""

from __future__ import annotations

import pytest
import chromadb

from app.config import settings
from app.prompts import RetrievedChunk
from app.retrieval import retrieve


def _collection_exists() -> bool:
    try:
        client = chromadb.PersistentClient(path=str(settings.chroma_persist_dir))
        client.get_collection("governance")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(
    not _collection_exists(),
    reason="ChromaDB 'governance' collection not found — run ingestion first",
)


def test_retrieve_returns_list():
    results = retrieve("What is the academic freedom policy?", institution="Northeastern")
    assert isinstance(results, list)
    assert len(results) > 0


def test_retrieve_results_have_required_fields():
    results = retrieve("What is the academic freedom policy?", institution="Northeastern")
    for chunk in results:
        assert isinstance(chunk, RetrievedChunk)
        assert chunk.institution == "Northeastern"
        assert isinstance(chunk.section_title, str) and chunk.section_title
        assert isinstance(chunk.text, str) and chunk.text
        assert isinstance(chunk.page_start, int) and chunk.page_start >= 1
        assert isinstance(chunk.page_end, int) and chunk.page_end >= chunk.page_start


def test_retrieve_respects_top_k():
    k = 3
    results = retrieve("faculty rights", institution="Northeastern", top_k=k)
    assert len(results) == k


def test_retrieve_faculty_senate_elections_returns_relevant_result():
    """Known-answer test: composition/elections section should be top-3 for this query."""
    results = retrieve(
        "How are members of the Faculty Senate elected?",
        institution="Northeastern",
        top_k=3,
    )
    top_titles = [r.section_title.lower() for r in results]
    assert any(
        "composition" in t or "senate" in t or "election" in t or "governance" in t
        for t in top_titles
    ), f"Expected a governance/composition result in top-3; got: {top_titles}"


def test_retrieve_institution_filter_works():
    """Results filtered by institution should only contain that institution."""
    results = retrieve("academic freedom", institution="Northeastern", top_k=5)
    for chunk in results:
        assert chunk.institution == "Northeastern"


def test_retrieve_no_institution_filter_returns_results():
    """Without an institution filter, retrieve should still return results."""
    results = retrieve("academic freedom", top_k=5)
    assert len(results) > 0
