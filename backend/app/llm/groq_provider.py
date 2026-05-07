"""Groq provider — production.

Uses the official `groq` Python SDK (chat-completions interface). System and
user prompts are sent as separate role-tagged messages so the model's
instruction tuning takes them at face value rather than seeing one mashed-
together prompt.

The SDK is imported lazily so a backend running with LLM_PROVIDER=ollama
doesn't pay an import cost (or fail on missing optional install) for groq.
"""

from __future__ import annotations

import logging
from typing import Any

from app.config import settings

from .base import HealthCheckError, LLMProvider

logger = logging.getLogger(__name__)


class GroqProvider(LLMProvider):
    name = "groq"

    def __init__(
        self,
        *,
        api_key: str | None = None,
        model: str | None = None,
        timeout_seconds: float | None = None,
    ) -> None:
        key = api_key or settings.groq_api_key
        if not key:
            raise RuntimeError(
                "GROQ_API_KEY is not set. Either set it or switch "
                "LLM_PROVIDER=ollama for local development."
            )
        self._api_key = key
        self.model = model or settings.groq_model
        self.timeout_seconds = timeout_seconds or settings.groq_timeout_seconds
        # Initialize the client lazily so the SDK import error (if the package
        # isn't installed) surfaces with a clear message rather than at
        # module-import time.
        self._client = self._build_client()

    def _build_client(self) -> Any:
        try:
            from groq import Groq
        except ImportError as exc:
            raise RuntimeError(
                "The `groq` package is not installed. Add it to "
                "requirements.txt (groq>=0.11) and reinstall."
            ) from exc
        return Groq(api_key=self._api_key, timeout=self.timeout_seconds)

    def generate(self, *, system: str, user: str) -> str:
        # Chat-completions: system + user as discrete messages preserves the
        # role separation that improves instruction-tuned output quality.
        completion = self._client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.0,
        )
        # The SDK returns a typed object with .choices[0].message.content.
        choices = getattr(completion, "choices", None) or []
        if not choices:
            return ""
        message = getattr(choices[0], "message", None)
        if message is None:
            return ""
        return getattr(message, "content", "") or ""

    def health_check(self) -> dict[str, Any]:
        # `models.list()` is the cheapest authenticated probe Groq exposes —
        # it validates the API key without consuming generation quota.
        try:
            self._client.models.list()
        except Exception as exc:
            raise HealthCheckError(
                f"Groq API unreachable or unauthorized: "
                f"{type(exc).__name__}: {exc}"
            ) from exc
        return {
            "provider": self.name,
            "status": "ok",
            "model": self.model,
        }

    def info(self) -> dict[str, Any]:
        return {"provider": self.name, "model": self.model}
