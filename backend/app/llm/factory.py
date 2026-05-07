"""Provider factory — selects and caches the active LLM provider.

A single provider instance is built lazily on first access and reused for
the lifetime of the process. Callers should always go through
`get_llm_provider()` rather than instantiating providers directly so the
choice stays driven by configuration, not by the call site.
"""

from __future__ import annotations

import logging
from typing import Optional

from app.config import settings

from .base import LLMProvider
from .groq_provider import GroqProvider
from .ollama_provider import OllamaProvider

logger = logging.getLogger(__name__)


_provider: Optional[LLMProvider] = None
_logged_startup = False


def _build_provider() -> LLMProvider:
    name = (settings.llm_provider or "").strip().lower() or "ollama"
    if name == "ollama":
        return OllamaProvider()
    if name == "groq":
        return GroqProvider()
    raise RuntimeError(
        f"Unknown LLM_PROVIDER {name!r}. Expected 'ollama' or 'groq'."
    )


def get_llm_provider() -> LLMProvider:
    """Return the singleton LLM provider for the current process.

    First call initializes from `settings`; subsequent calls return the same
    instance. Re-importing settings doesn't rebuild the provider — restart
    the process to pick up env changes.
    """
    global _provider
    if _provider is None:
        _provider = _build_provider()
        _log_startup(_provider)
    return _provider


def reset_provider_for_testing() -> None:
    """Test helper — drops the cached singleton so a fresh provider is
    constructed on the next `get_llm_provider()` call. Production code
    should never need this."""
    global _provider, _logged_startup
    _provider = None
    _logged_startup = False


def _log_startup(provider: LLMProvider) -> None:
    """Emit the provider/model info once. Idempotent across multiple
    factory calls so re-imports don't spam the log."""
    global _logged_startup
    if _logged_startup:
        return
    _logged_startup = True

    info = provider.info()
    logger.info("[PolicyLens] LLM provider: %s", provider.name)
    if provider.name == "ollama":
        logger.info("[PolicyLens] Ollama URL: %s", info.get("base_url", "?"))
        logger.info("[PolicyLens] Model: %s", info.get("model", "?"))
    elif provider.name == "groq":
        logger.info("[PolicyLens] Groq model: %s", info.get("model", "?"))
