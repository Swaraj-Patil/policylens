"""Ollama provider — local development.

Talks to `${OLLAMA_BASE_URL}/api/generate` directly via httpx. No SDK
dependency: Ollama's REST API is small and stable enough that an SDK adds
weight without buying anything.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import settings

from .base import HealthCheckError, LLMProvider

logger = logging.getLogger(__name__)


class OllamaProvider(LLMProvider):
    name = "ollama"

    def __init__(
        self,
        *,
        base_url: str | None = None,
        model: str | None = None,
        timeout_seconds: float | None = None,
        num_ctx: int | None = None,
    ) -> None:
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self.model = model or settings.ollama_model
        self.timeout_seconds = timeout_seconds or settings.ollama_timeout_seconds
        # Ollama's default num_ctx is 2048 — too small for our top-k context
        # block. Set explicitly so the full prompt fits regardless of model.
        self.num_ctx = num_ctx or settings.ollama_num_ctx

    def generate(self, *, system: str, user: str) -> str:
        payload = {
            "model": self.model,
            "system": system,
            "prompt": user,
            "stream": False,
            "options": {
                "temperature": 0.0,
                "num_ctx": self.num_ctx,
            },
        }
        response = httpx.post(
            f"{self.base_url}/api/generate",
            json=payload,
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        body = response.json()
        return body.get("response") or ""

    def health_check(self) -> dict[str, Any]:
        url = f"{self.base_url}/api/tags"
        try:
            response = httpx.get(url, timeout=5.0)
            response.raise_for_status()
        except Exception as exc:
            raise HealthCheckError(
                f"Ollama unreachable at {self.base_url}: {type(exc).__name__}: {exc}"
            ) from exc

        models = [m.get("name", "") for m in response.json().get("models", [])]
        if self.model not in models:
            raise HealthCheckError(
                f"Ollama is up but model {self.model!r} is not pulled. "
                f"Run: ollama pull {self.model}"
            )
        return {
            "provider": self.name,
            "status": "ok",
            "model": self.model,
            "base_url": self.base_url,
        }

    def info(self) -> dict[str, Any]:
        return {
            "provider": self.name,
            "model": self.model,
            "base_url": self.base_url,
        }
