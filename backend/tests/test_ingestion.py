"""Tests for the ingestion pipeline.

Uses the real Northeastern handbook if present; skips otherwise.
These are fast (no embedding/ChromaDB calls) — they only test parsing and chunking.
"""

from __future__ import annotations

import pytest
from pathlib import Path

from app.ingestion import Chunk, Section, chunk_sections, parse_pdf

NORTHEASTERN_PDF = Path("data/pdfs/northeastern_faculty_handbook_2026.pdf")


@pytest.fixture(scope="module")
def northeastern_sections() -> list[Section]:
    if not NORTHEASTERN_PDF.exists():
        pytest.skip("Northeastern PDF not present")
    return parse_pdf(NORTHEASTERN_PDF, "Northeastern")


@pytest.fixture(scope="module")
def northeastern_chunks(northeastern_sections) -> list[Chunk]:
    return chunk_sections(northeastern_sections)


# ---------------------------------------------------------------------------
# parse_pdf
# ---------------------------------------------------------------------------

def test_parse_returns_sections(northeastern_sections):
    assert len(northeastern_sections) > 10, "Expected at least 10 sections in the handbook"


def test_sections_have_required_fields(northeastern_sections):
    for s in northeastern_sections:
        assert s.institution == "Northeastern"
        assert isinstance(s.section_title, str) and s.section_title
        assert isinstance(s.text, str) and s.text
        assert isinstance(s.page_start, int) and s.page_start >= 1
        assert isinstance(s.page_end, int) and s.page_end >= s.page_start


def test_section_titles_are_not_purely_numeric(northeastern_sections):
    for s in northeastern_sections:
        assert any(c.isalpha() for c in s.section_title), (
            f"Purely-numeric section title slipped through: {s.section_title!r}"
        )


# ---------------------------------------------------------------------------
# chunk_sections
# ---------------------------------------------------------------------------

def test_chunks_are_non_empty(northeastern_chunks):
    assert len(northeastern_chunks) > 0


def test_chunks_have_required_metadata(northeastern_chunks):
    for c in northeastern_chunks:
        assert c.institution == "Northeastern"
        assert isinstance(c.section_title, str) and c.section_title
        assert isinstance(c.text, str) and c.text.strip()
        assert isinstance(c.page_start, int) and c.page_start >= 1
        assert isinstance(c.page_end, int) and c.page_end >= c.page_start
        assert isinstance(c.chunk_index, int) and c.chunk_index >= 0
        assert isinstance(c.flesch_kincaid_grade, float)


def test_chunk_indices_are_unique(northeastern_chunks):
    indices = [c.chunk_index for c in northeastern_chunks]
    assert len(indices) == len(set(indices)), "Duplicate chunk indices found"


def test_chunks_respect_target_token_size(northeastern_chunks):
    # Approximately 0.75 words per token; target is 400 tokens → ~300 words.
    # Allow 10% overshoot for the last chunk in a section.
    target_words = int(400 * 0.75 * 1.1)
    oversized = [
        c for c in northeastern_chunks
        if len(c.text.split()) > target_words
    ]
    assert not oversized, (
        f"{len(oversized)} chunk(s) exceed the token target by >10%: "
        + str([(c.chunk_index, len(c.text.split())) for c in oversized[:3]])
    )
