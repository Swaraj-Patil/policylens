from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- LLM provider ----
    use_local_llm: bool = True
    local_llm_model: str = "qwen2.5:7b-instruct"
    ollama_base_url: str = "http://localhost:11434"
    ollama_timeout_seconds: float = 120.0
    ollama_num_ctx: int = 8192

    # ---- Gemini (optional cloud fallback when use_local_llm=False) ----
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"

    # ---- Chunking ----
    chunk_target_tokens: int = 400
    chunk_overlap_tokens: int = 50

    # ---- Retrieval ----
    retrieval_top_k: int = 8
    high_reading_difficulty_threshold: float = 14.0

    # ---- Storage paths ----
    chroma_persist_dir: Path = Path("./data/chroma_db")
    pdf_dir: Path = Path("./data/pdfs")

    # ---- Dev ----
    llm_cache_enabled: bool = True
    llm_cache_dir: Path = Path("./.llm_cache")


settings = Settings()
