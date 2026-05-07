# PolicyLens backend — production image.
#
# Build context is the `backend/` directory:
#   docker build -t policylens-backend ./backend
#
# Notes:
#   - Python 3.12 (sentence-transformers + chromadb wheels lag on 3.13).
#   - The MiniLM embedding model is pre-downloaded into the image so the
#     first /query after deploy doesn't pay a 90MB cold-start fetch.
#   - data/chroma_db must exist in the build context — ingest your handbooks
#     locally before building. The chroma DB is baked in; switching corpora
#     requires a rebuild.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/app/.cache/huggingface

# Minimal system deps. sentence-transformers / pymupdf / chromadb all ship
# manylinux wheels for cpython 3.12, so we don't need a compiler toolchain.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgomp1 \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so subsequent code edits don't bust the layer.
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Pre-fetch the sentence-transformers model so the first request after
# container start is fast. ~90 MB.
RUN python -c "from sentence_transformers import SentenceTransformer; \
    SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')"

# Application code.
COPY app ./app
# Optional: pre-ingested vector store. Comment out if you persist via a volume.
# COPY data ./data  # removed: runtime-generated / optional volumeCOPY data ./data

EXPOSE 8000

# Production defaults — overridable via the platform's env panel.
ENV LLM_PROVIDER=groq \
    LLM_CACHE_ENABLED=false

# Single uvicorn worker is correct for Render/Railway free tiers (RAM-bound
# by the embedding model + chroma index). Scale by replicas, not workers.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
