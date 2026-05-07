from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- LLM provider selection ---------------------------------------
    # `ollama` (default — local dev) | `groq` (production).
    llm_provider: str = "ollama"

    # ---- Ollama (local development) -----------------------------------
    ollama_base_url: str = "http://localhost:11434"
    # Accepts the legacy LOCAL_LLM_MODEL alias so existing .env files keep
    # working without edits.
    ollama_model: str = Field(
        default="qwen2.5:7b-instruct",
        validation_alias=AliasChoices("OLLAMA_MODEL", "LOCAL_LLM_MODEL"),
    )
    ollama_timeout_seconds: float = 120.0
    ollama_num_ctx: int = 8192

    # ---- Groq (production) --------------------------------------------
    # Get a free API key at https://console.groq.com/keys (no credit card).
    groq_api_key: str = ""
    groq_model: str = "llama3-70b-8192"
    groq_timeout_seconds: float = 60.0

    # ---- CORS ---------------------------------------------------------
    # Production frontend origin (e.g. "https://policylens.vercel.app").
    # Empty in dev → falls through to localhost-only allowlist.
    frontend_origin: str = ""

    # ---- Chunking -----------------------------------------------------
    chunk_target_tokens: int = 400
    chunk_overlap_tokens: int = 50

    # ---- Retrieval ----------------------------------------------------
    retrieval_top_k: int = 8
    high_reading_difficulty_threshold: float = 14.0

    # ---- Storage paths ------------------------------------------------
    chroma_persist_dir: Path = Path("./data/chroma_db")
    pdf_dir: Path = Path("./data/pdfs")

    # ---- Dev ----------------------------------------------------------
    llm_cache_enabled: bool = True
    llm_cache_dir: Path = Path("./.llm_cache")


settings = Settings()
