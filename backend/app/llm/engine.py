"""Retry / disk-cache / graceful-fallback wrapper around the active provider.

The provider classes are intentionally bare — they implement a single network
call and raise on failure. This module sits one level up and is the entry
point for actual answer generation: it adds exponential-backoff retries on
transient errors, an opt-in disk cache so repeat queries don't burn LLM
quota during dev, and a final fallback message so the API never raises into
the route handler when the LLM is unavailable.

Public surface:
    call_llm(system, user) -> str         # cached + retried + fallbacked
    call_with_retry(fn) -> Any            # retry primitive (used by tests)
    _is_retryable(exc) -> bool            # classification helper (tests too)
    FALLBACK_MESSAGE                      # surfaced when retries exhaust
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any, Callable

import httpx

from app.config import settings

from .factory import get_llm_provider

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Retry / timeout config
# ---------------------------------------------------------------------------

MAX_RETRIES = 3
BASE_DELAY_SECONDS = 1.0

_RETRYABLE_HTTP_CODES = {408, 429, 500, 502, 503, 504}

FALLBACK_MESSAGE = (
    "The language model is currently unavailable. Relevant source passages were "
    "retrieved (see sources below), but the model could not be reached after "
    "several attempts. Please try again in a moment."
)


def _is_retryable(exc: BaseException) -> bool:
    """Return True if the exception represents a transient failure worth retrying.

    Detects retryable conditions across providers:
      1. HTTP status codes on the exception (httpx.HTTPStatusError, or any
         exception exposing a `.code` / `.status_code` integer).
      2. httpx transport errors (timeouts, connection failures).
      3. Groq SDK rate-limit / server-error classes, when installed.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        if exc.response.status_code in _RETRYABLE_HTTP_CODES:
            return True

    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if isinstance(code, int) and code in _RETRYABLE_HTTP_CODES:
        return True

    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError, httpx.ConnectError)):
        return True

    # Groq SDK exception types — probed lazily so dev installs without the
    # SDK still get sensible classification on every other path.
    try:
        from groq import APIConnectionError, APITimeoutError, InternalServerError, RateLimitError

        if isinstance(
            exc,
            (APIConnectionError, APITimeoutError, InternalServerError, RateLimitError),
        ):
            return True
    except ImportError:
        pass

    return False


def call_with_retry(
    fn: Callable[[], Any],
    *,
    max_retries: int = MAX_RETRIES,
    base_delay: float = BASE_DELAY_SECONDS,
) -> Any:
    """Invoke a zero-arg callable with exponential-backoff retries on transient errors."""
    for attempt in range(max_retries + 1):
        try:
            return fn()
        except Exception as exc:
            retryable = _is_retryable(exc)

            if not retryable:
                logger.error(
                    "Non-retryable error during LLM call: %s: %s",
                    type(exc).__name__,
                    exc,
                )
                raise

            if attempt >= max_retries:
                logger.error(
                    "LLM call failed after %d attempts. Final error: %s: %s",
                    attempt + 1,
                    type(exc).__name__,
                    exc,
                )
                raise

            delay = base_delay * (2 ** attempt)
            logger.warning(
                "Transient error on LLM call (attempt %d/%d), retrying in %.1fs: %s: %s",
                attempt + 1,
                max_retries + 1,
                delay,
                type(exc).__name__,
                exc,
            )
            time.sleep(delay)


# ---------------------------------------------------------------------------
# Disk cache (provider-aware key)
# ---------------------------------------------------------------------------

def _provider_tag() -> str:
    info = get_llm_provider().info()
    return f"{info.get('provider', '?')}:{info.get('model', '?')}"


def _cache_key(system: str, user: str) -> str:
    return hashlib.sha256(f"{_provider_tag()}\n{system}\n{user}".encode()).hexdigest()


def _cache_get(key: str) -> str | None:
    if not settings.llm_cache_enabled:
        return None
    path = settings.llm_cache_dir / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))["response"]
    return None


def _cache_set(key: str, response: str) -> None:
    if not settings.llm_cache_enabled:
        return
    settings.llm_cache_dir.mkdir(parents=True, exist_ok=True)
    path = settings.llm_cache_dir / f"{key}.json"
    path.write_text(json.dumps({"response": response}), encoding="utf-8")


# ---------------------------------------------------------------------------
# Top-level call
# ---------------------------------------------------------------------------

def call_llm(system: str, user: str) -> str:
    """Provider-agnostic generation entry point.

    Cache hit → return cached. Otherwise call the active provider via
    `call_with_retry`; on persistent failure, return FALLBACK_MESSAGE rather
    than raising. The route handler can always count on a string back.
    """
    key = _cache_key(system, user)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    provider = get_llm_provider()
    try:
        text = call_with_retry(lambda: provider.generate(system=system, user=user))
    except Exception as exc:
        logger.error(
            "LLM call failed permanently via %s (%s: %s). Returning fallback response.",
            _provider_tag(),
            type(exc).__name__,
            exc,
        )
        return FALLBACK_MESSAGE

    _cache_set(key, text)
    return text
