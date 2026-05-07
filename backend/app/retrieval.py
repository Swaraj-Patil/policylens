"""Retrieval module: embed a query and fetch the top-k chunks from ChromaDB."""

from __future__ import annotations

from functools import lru_cache

import chromadb
from sentence_transformers import SentenceTransformer

from app.config import settings
from app.prompts import RetrievedChunk


@lru_cache(maxsize=1)
def _embedding_model() -> SentenceTransformer:
    return SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


@lru_cache(maxsize=1)
def _chroma_client() -> chromadb.PersistentClient:
    return chromadb.PersistentClient(path=str(settings.chroma_persist_dir))


def retrieve(
    question: str,
    institution: str | None = None,
    top_k: int | None = None,
    collection_name: str = "governance",
) -> list[RetrievedChunk]:
    """Return top-k RetrievedChunk objects for a question.

    Args:
        question: plain-language user query
        institution: if provided, filter results to this institution only
        top_k: number of results; defaults to settings.retrieval_top_k
        collection_name: ChromaDB collection to query
    """
    k = top_k if top_k is not None else settings.retrieval_top_k
    model = _embedding_model()
    collection = _chroma_client().get_collection(collection_name)

    query_embedding = model.encode(question).tolist()
    where = {"institution": institution} if institution else None

    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=k,
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    chunks: list[RetrievedChunk] = []
    for doc, meta in zip(results["documents"][0], results["metadatas"][0]):
        chunks.append(RetrievedChunk(
            text=doc,
            institution=meta["institution"],
            section_title=meta["section_title"],
            page_start=int(meta["page_start"]),
            page_end=int(meta["page_end"]),
            flesch_kincaid_grade=meta.get("flesch_kincaid_grade"),
        ))

    return chunks
