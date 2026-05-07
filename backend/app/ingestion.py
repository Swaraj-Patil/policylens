"""PDF ingestion pipeline: parse → chunk → embed → store in ChromaDB."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

import chromadb
import fitz  # PyMuPDF
import textstat
import typer
from sentence_transformers import SentenceTransformer
from tqdm import tqdm

from app.config import settings

cli = typer.Typer()


@cli.callback()
def _root() -> None:
    """PolicyLens ingestion CLI."""


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class Section:
    institution: str
    section_title: str
    text: str
    page_start: int
    page_end: int


@dataclass
class Chunk:
    institution: str
    section_title: str
    text: str
    page_start: int
    page_end: int
    chunk_index: int
    flesch_kincaid_grade: float = 0.0


# ---------------------------------------------------------------------------
# Heading detection
# ---------------------------------------------------------------------------

def _body_font_size(doc: fitz.Document) -> float:
    """Return the modal body-text font size across the whole document.

    Weighted by character count so that short decorative lines (headers,
    footers, pull-quotes) don't skew the result.
    """
    size_weight: dict[float, int] = {}
    for page in doc:
        page_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
        for block in page_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    size = round(span["size"], 1)
                    char_count = len(span["text"].strip())
                    if char_count > 0:
                        size_weight[size] = size_weight.get(size, 0) + char_count
    return max(size_weight, key=size_weight.get) if size_weight else 12.0


def _line_is_heading(line: dict, body_size: float) -> tuple[bool, str]:
    """Return (is_heading, stripped_text) for a PyMuPDF line dict.

    A line is treated as a heading if the majority of its characters meet
    either criterion:
      - font size >= 1.15× the document body size (clearly larger), or
      - bold AND font size >= 1.05× body size (bold + slightly larger).

    Errs on the side of inclusion per project spec; cap at 300 chars to
    exclude long bold paragraphs that aren't headings.
    """
    spans = line.get("spans", [])
    text = "".join(s["text"] for s in spans).strip()
    if not text or len(text) > 300:
        return False, text
    if not any(c.isalpha() for c in text):
        return False, text

    total_chars = 0
    heading_chars = 0
    for span in spans:
        chars = len(span["text"].strip())
        if chars == 0:
            continue
        total_chars += chars

        size = span["size"]
        is_bold = bool(span["flags"] & 16) or "bold" in span["font"].lower()
        is_large = size >= body_size * 1.15
        is_slightly_larger = size >= body_size * 1.05

        if is_large or (is_bold and is_slightly_larger):
            heading_chars += chars

    if total_chars == 0:
        return False, text

    return (heading_chars / total_chars) >= 0.5, text


# ---------------------------------------------------------------------------
# Core pipeline
# ---------------------------------------------------------------------------

def parse_pdf(path: Path, institution: str) -> list[Section]:
    """Parse a PDF into sections using font-size-based heading detection.

    Returns one Section per detected heading. Content before the first
    heading is collected under the title "Preamble".
    """
    doc = fitz.open(str(path))
    body_size = _body_font_size(doc)

    sections: list[Section] = []
    current_title = "Preamble"
    current_text: list[str] = []
    current_page_start = 1
    current_page_end = 1

    def _flush(page_end: int) -> None:
        text = " ".join(current_text).strip()
        if text:
            sections.append(Section(
                institution=institution,
                section_title=current_title,
                text=text,
                page_start=current_page_start,
                page_end=page_end,
            ))

    for page_num, page in enumerate(doc, start=1):
        page_dict = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)
        for block in page_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                is_heading, line_text = _line_is_heading(line, body_size)
                if not line_text:
                    continue
                if is_heading:
                    _flush(page_end=current_page_end)
                    current_title = line_text
                    current_text = []
                    current_page_start = page_num
                    current_page_end = page_num
                else:
                    current_text.append(line_text)
                    current_page_end = page_num

    _flush(page_end=current_page_end)
    doc.close()
    return sections


def _estimate_tokens(text: str) -> int:
    return int(len(text.split()) / 0.75)


def chunk_sections(
    sections: list[Section],
    target_tokens: int = 400,
    overlap_tokens: int = 50,
) -> list[Chunk]:
    """Split sections into token-limited chunks with overlap.

    Uses a word-count proxy (0.75 words ≈ 1 token). Each chunk inherits
    its parent section's full metadata; page range reflects the section,
    not the individual chunk (page-level tracking within a section is not
    preserved by PyMuPDF's block iteration).
    """
    target_words = int(target_tokens * 0.75)
    overlap_words = int(overlap_tokens * 0.75)

    chunks: list[Chunk] = []
    global_idx = 0

    for section in sections:
        words = section.text.split()
        if not words:
            continue

        if len(words) <= target_words:
            text = section.text
            chunks.append(Chunk(
                institution=section.institution,
                section_title=section.section_title,
                text=text,
                page_start=section.page_start,
                page_end=section.page_end,
                chunk_index=global_idx,
                flesch_kincaid_grade=textstat.flesch_kincaid_grade(text),
            ))
            global_idx += 1
        else:
            start = 0
            while start < len(words):
                end = min(start + target_words, len(words))
                text = " ".join(words[start:end])
                chunks.append(Chunk(
                    institution=section.institution,
                    section_title=section.section_title,
                    text=text,
                    page_start=section.page_start,
                    page_end=section.page_end,
                    chunk_index=global_idx,
                    flesch_kincaid_grade=textstat.flesch_kincaid_grade(text),
                ))
                global_idx += 1
                if end == len(words):
                    break
                start = end - overlap_words

    return chunks


def _chunk_id(chunk: Chunk) -> str:
    key = f"{chunk.institution}|{chunk.section_title}|{chunk.chunk_index}|{chunk.text[:100]}"
    return hashlib.md5(key.encode()).hexdigest()


def embed_and_store(chunks: list[Chunk], collection_name: str = "governance") -> None:
    """Embed chunks with MiniLM and upsert into ChromaDB (cosine space)."""
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    settings.chroma_persist_dir.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(settings.chroma_persist_dir))
    collection = client.get_or_create_collection(
        collection_name,
        metadata={"hnsw:space": "cosine"},
    )

    batch_size = 128
    for i in tqdm(range(0, len(chunks), batch_size), desc="Embedding & storing"):
        batch = chunks[i : i + batch_size]
        texts = [c.text for c in batch]
        embeddings = model.encode(texts, batch_size=64, show_progress_bar=False)

        collection.upsert(
            ids=[_chunk_id(c) for c in batch],
            embeddings=embeddings.tolist(),
            documents=texts,
            metadatas=[
                {
                    "institution": c.institution,
                    "section_title": c.section_title,
                    "page_start": c.page_start,
                    "page_end": c.page_end,
                    "chunk_index": c.chunk_index,
                    "flesch_kincaid_grade": c.flesch_kincaid_grade,
                }
                for c in batch
            ],
        )


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

@cli.command()
def ingest(
    institution: str = typer.Option(..., help="Institution name, e.g. 'Northeastern'"),
    pdf: Path = typer.Option(..., help="Path to the PDF file"),
    collection: str = typer.Option("governance", help="ChromaDB collection name"),
) -> None:
    """Parse a faculty handbook PDF and store embeddings in ChromaDB."""
    if not pdf.exists():
        typer.echo(f"Error: PDF not found: {pdf}", err=True)
        raise typer.Exit(1)

    typer.echo(f"Parsing {pdf.name} for '{institution}' ...")
    sections = parse_pdf(pdf, institution)
    typer.echo(f"  → {len(sections)} sections detected")

    typer.echo("Chunking ...")
    chunks = chunk_sections(
        sections,
        target_tokens=settings.chunk_target_tokens,
        overlap_tokens=settings.chunk_overlap_tokens,
    )
    typer.echo(f"  → {len(chunks)} chunks")

    typer.echo("Embedding and storing in ChromaDB ...")
    embed_and_store(chunks, collection_name=collection)
    typer.echo(f"Done. Collection '{collection}' updated.")


if __name__ == "__main__":
    cli()
