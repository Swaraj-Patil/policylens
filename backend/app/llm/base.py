"""Abstract LLM provider interface.

A provider is the smallest possible adapter — it owns nothing but the network
call to its backend and a self-check. Retry/cache/fallback live one layer up
(see `engine.py`) so all providers share a single resilience policy.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class HealthCheckError(Exception):
    """Raised by `health_check()` when the provider is unreachable or
    misconfigured. The caller (typically the /health/llm route) converts this
    into a non-200 response."""


class LLMProvider(ABC):
    """Stateless adapter around a single chat-style LLM endpoint.

    Implementations must be safe to construct once at import time and reuse
    for the lifetime of the process. The factory holds a single instance.
    """

    name: str  #: Short identifier — "ollama", "groq", etc.

    @abstractmethod
    def generate(self, *, system: str, user: str) -> str:
        """Return the model's plain-text completion for a system+user prompt.

        Providers raise on transport/HTTP/timeout errors — the engine layer
        decides whether to retry. They do NOT swallow errors silently.

        The return value is the raw completion text, never None.
        """

    @abstractmethod
    def health_check(self) -> dict[str, Any]:
        """Probe the underlying service. Returns provider/model metadata on
        success; raises `HealthCheckError` on failure.

        Implementations should keep this cheap (a model-list call, not a
        full generation) so it's safe to hit on every /health/llm request.
        """

    def info(self) -> dict[str, Any]:
        """Provider+model metadata used by startup logs and /health."""
        return {"provider": self.name}
