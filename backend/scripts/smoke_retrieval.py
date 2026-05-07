"""Smoke test: run 5 hardcoded queries and print top-3 results with metadata.

Run from backend/:
    python scripts/smoke_retrieval.py

Optional: filter to one institution
    python scripts/smoke_retrieval.py --institution Northeastern
"""

from __future__ import annotations

import sys
from pathlib import Path

import typer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import chromadb
from sentence_transformers import SentenceTransformer

from app.config import settings

QUERIES = [
    "What is the procedure for appealing a final course grade?",
    "How is academic freedom defined for faculty?",
    "What accommodations are available for students with disabilities?",
    "How are members of the Faculty Senate elected?",
    "What is the policy on outside consulting work?",
]

cli = typer.Typer()


@cli.command()
def main(
    institution: str = typer.Option("", help="Filter results to this institution (leave blank for all)"),
    collection: str = typer.Option("governance", help="ChromaDB collection name"),
    top_k: int = typer.Option(3, help="Number of results per query"),
) -> None:
    """Query the ChromaDB collection with smoke-test questions and print results."""
    client = chromadb.PersistentClient(path=str(settings.chroma_persist_dir))
    try:
        col = client.get_collection(collection)
    except Exception:
        typer.echo(f"Collection '{collection}' not found. Run ingestion first.", err=True)
        raise typer.Exit(1)

    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    where = {"institution": institution} if institution else None

    for query in QUERIES:
        typer.echo("\n" + "=" * 80)
        typer.echo(f"QUERY: {query}")
        typer.echo("=" * 80)

        query_embedding = model.encode(query).tolist()
        results = col.query(
            query_embeddings=[query_embedding],
            n_results=top_k,
            where=where,
            include=["documents", "metadatas", "distances"],
        )

        docs = results["documents"][0]
        metas = results["metadatas"][0]
        distances = results["distances"][0]

        if not docs:
            typer.echo("  (no results)")
            continue

        for rank, (doc, meta, dist) in enumerate(zip(docs, metas, distances), start=1):
            fk = meta.get("flesch_kincaid_grade", "N/A")
            fk_str = f"{fk:.1f}" if isinstance(fk, float) else str(fk)
            page_range = (
                f"p.{meta['page_start']}"
                if meta["page_start"] == meta["page_end"]
                else f"pp.{meta['page_start']}–{meta['page_end']}"
            )
            typer.echo(f"\n  [{rank}] distance={dist:.4f}  FK-grade={fk_str}")
            typer.echo(f"       {meta['institution']} | {meta['section_title']} | {page_range}")
            preview = doc[:250].replace("\n", " ")
            typer.echo(f"       \"{preview}{'...' if len(doc) > 250 else ''}\"")


if __name__ == "__main__":
    cli()
