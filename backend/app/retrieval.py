"""Retrieval module: embed a query and fetch the top-k chunks from ChromaDB.

The collection is opened idempotently — if it doesn't exist (fresh deploy
without an ingested DB), we create it empty rather than raising. An empty
collection naturally yields zero chunks on `.query()`, which the rest of
the pipeline already handles as the "no relevant passages" fallback path.
This keeps `/query` working through the deploy → ingest gap.
"""

from __future__ import annotations

import logging
from functools import lru_cache

import chromadb
from sentence_transformers import SentenceTransformer

from app.config import settings
from app.prompts import RetrievedChunk

logger = logging.getLogger(__name__)

DEFAULT_COLLECTION = "governance"
# Must match ingestion.embed_and_store's metadata so retrieval and ingestion
# operate on the same logical collection regardless of which side creates it.
_COLLECTION_METADATA = {"hnsw:space": "cosine"}


@lru_cache(maxsize=1)
def _embedding_model() -> SentenceTransformer:
    return SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


@lru_cache(maxsize=1)
def _chroma_client() -> chromadb.PersistentClient:
    settings.chroma_persist_dir.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(path=str(settings.chroma_persist_dir))


def _open_collection(name: str = DEFAULT_COLLECTION):
    """Idempotent collection accessor. Mirrors ingestion's `get_or_create_collection`
    so a fresh deploy (no ingest yet) gets an empty collection instead of a
    crash on first query."""
    return _chroma_client().get_or_create_collection(
        name,
        metadata=_COLLECTION_METADATA,
    )


def ensure_collection_ready(name: str = DEFAULT_COLLECTION) -> dict:
    """Startup probe — verify (or create) the governance collection.

    Returns a small dict for logging / health reporting. Never raises:
    a corrupted persist dir surfaces as `existed=False, count=0` plus a
    warning log so the route still serves graceful no-data responses.
    """
    try:
        client = _chroma_client()
        existing = {c.name for c in client.list_collections()}
        existed = name in existing
        collection = _open_collection(name)
        count = collection.count()
        if existed:
            logger.info(
                "[PolicyLens] Chroma collection %r exists (%d chunks)", name, count
            )
        else:
            logger.warning(
                "[PolicyLens] Chroma collection %r was missing — created empty. "
                "Run ingestion to populate; /query will return 'no_results' until then.",
                name,
            )
        return {"name": name, "existed": existed, "count": count}
    except Exception as exc:  # noqa: BLE001 — startup probe must not raise
        logger.warning(
            "[PolicyLens] Could not initialize Chroma collection %r (%s: %s). "
            "/query will return graceful empty responses.",
            name,
            type(exc).__name__,
            exc,
        )
        return {"name": name, "existed": False, "count": 0, "error": str(exc)}


def retrieve(
    question: str,
    institution: str | None = None,
    top_k: int | None = None,
    collection_name: str = DEFAULT_COLLECTION,
) -> list[RetrievedChunk]:
    """Return top-k RetrievedChunk objects for a question.

    Returns an empty list (rather than raising) when the collection is empty
    — the LLM layer treats an empty context as "no relevant passages" and the
    frontend renders the no_results empty state.
    """
    k = top_k if top_k is not None else settings.retrieval_top_k
    model = _embedding_model()
    collection = _open_collection(collection_name)

    # Empty collection → return [] without round-tripping through query().
    # Cheap short-circuit; also avoids edge cases where Chroma returns
    # implementation-defined empty result shapes.
    if collection.count() == 0:
        return []

    query_embedding = model.encode(question).tolist()
    where = {"institution": institution} if institution else None

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=k,
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    docs = (results.get("documents") or [[]])[0]
    metas = (results.get("metadatas") or [[]])[0]

    chunks: list[RetrievedChunk] = []
    for doc, meta in zip(docs, metas):
        chunks.append(RetrievedChunk(
            text=doc,
            institution=meta["institution"],
            section_title=meta["section_title"],
            page_start=int(meta["page_start"]),
            page_end=int(meta["page_end"]),
            flesch_kincaid_grade=meta.get("flesch_kincaid_grade"),
        ))

    return chunks
