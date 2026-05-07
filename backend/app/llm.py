"""LLM wrapper with disk cache, retry, and graceful fallback.

Default provider is local Ollama (http://localhost:11434/api/generate). Set
USE_LOCAL_LLM=false in .env to use Google Gemini via google-genai instead.

The retry/cache/fallback layers are provider-agnostic — they sit above a single
`_invoke_*` function selected at call time. Adding a third provider is a matter
of writing one more `_invoke_x` and adding it to the dispatch.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any, Callable

import httpx

from app.config import settings
from app.prompts import (
    CROSS_INSTITUTION_SYSTEM,
    SINGLE_INSTITUTION_SYSTEM,
    RetrievedChunk,
    build_user_message,
    format_context_block,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Retry / timeout config
# ---------------------------------------------------------------------------

MAX_RETRIES = 3                     # retries on top of the initial attempt → 4 attempts max
BASE_DELAY_SECONDS = 1.0            # exponential backoff: 1s, 2s, 4s
GEMINI_TIMEOUT_MS = 60_000          # Gemini per-call timeout (ms)

_RETRYABLE_HTTP_CODES = {408, 429, 500, 502, 503, 504}

FALLBACK_MESSAGE = (
    "The language model is currently unavailable. Relevant source passages were "
    "retrieved (see sources below), but the model could not be reached after "
    "several attempts. Please try again in a moment."
)


# ---------------------------------------------------------------------------
# Retry helper
# ---------------------------------------------------------------------------

def _is_retryable(exc: BaseException) -> bool:
    """Return True if the exception represents a transient failure worth retrying.

    Detects retryable conditions across providers:
      1. HTTP status codes on the exception (Ollama: via httpx.HTTPStatusError;
         google-genai: surfaced as `.code` on the APIError).
      2. httpx transport errors (timeouts, connection failures).
      3. google.api_core exceptions, in case they bubble up from the Gemini path.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        if exc.response.status_code in _RETRYABLE_HTTP_CODES:
            return True

    code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
    if isinstance(code, int) and code in _RETRYABLE_HTTP_CODES:
        return True

    if isinstance(exc, (httpx.TimeoutException, httpx.NetworkError, httpx.ConnectError)):
        return True

    try:
        from google.api_core import exceptions as gax_exc

        if isinstance(
            exc,
            (
                gax_exc.ServiceUnavailable,
                gax_exc.TooManyRequests,
                gax_exc.DeadlineExceeded,
                gax_exc.InternalServerError,
                gax_exc.GatewayTimeout,
            ),
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
    if settings.use_local_llm:
        return f"ollama:{settings.local_llm_model}"
    return f"gemini:{settings.gemini_model}"


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
# Provider implementations
# ---------------------------------------------------------------------------

def _invoke_ollama(system: str, user: str) -> str:
    """POST to Ollama /api/generate. Raises on HTTP, network, or timeout errors.

    Ollama's default num_ctx is 2048 — too small for our top-k retrieval. We
    set 8192 explicitly so the full context block fits regardless of model default.
    """
    payload = {
        "model": settings.local_llm_model,
        "system": system,
        "prompt": user,
        "stream": False,
        "options": {
            "temperature": 0.0,
            "num_ctx": settings.ollama_num_ctx,
        },
    }
    response = httpx.post(
        f"{settings.ollama_base_url}/api/generate",
        json=payload,
        timeout=settings.ollama_timeout_seconds,
    )
    response.raise_for_status()
    body = response.json()
    return body.get("response") or ""


def _invoke_gemini(system: str, user: str) -> str:
    """Single Gemini API call. Raises on any error. google-genai imported lazily."""
    from google import genai
    from google.genai import types

    client = genai.Client(
        api_key=settings.gemini_api_key,
        http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_MS),
    )
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=user,
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=0.0,
        ),
    )
    return response.text or ""


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------

def _call_llm(system: str, user: str) -> str:
    """Call the configured LLM provider with cache + retry + graceful fallback. Never raises."""
    key = _cache_key(system, user)
    cached = _cache_get(key)
    if cached is not None:
        return cached

    invoke_fn: Callable[[str, str], str] = (
        _invoke_ollama if settings.use_local_llm else _invoke_gemini
    )

    try:
        text = call_with_retry(lambda: invoke_fn(system, user))
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


# ---------------------------------------------------------------------------
# Startup validation
# ---------------------------------------------------------------------------

def check_llm_available() -> None:
    """Probe the configured LLM provider at startup. Logs only — never raises."""
    if settings.use_local_llm:
        _check_ollama_available()
    else:
        if settings.gemini_api_key:
            logger.info("LLM provider: Gemini (model=%s)", settings.gemini_model)
        else:
            logger.warning(
                "USE_LOCAL_LLM=false but GEMINI_API_KEY is not set. "
                "/query will return fallback responses."
            )


def _check_ollama_available() -> None:
    url = f"{settings.ollama_base_url}/api/tags"
    try:
        response = httpx.get(url, timeout=5.0)
        response.raise_for_status()
    except Exception as exc:
        logger.warning(
            "Ollama not reachable at %s (%s: %s). "
            "Start it with `ollama serve` — /query will return fallback responses until then.",
            settings.ollama_base_url,
            type(exc).__name__,
            exc,
        )
        return

    available_models = [m.get("name", "") for m in response.json().get("models", [])]
    if settings.local_llm_model in available_models:
        logger.info(
            "LLM provider: Ollama (model=%s, base_url=%s)",
            settings.local_llm_model,
            settings.ollama_base_url,
        )
    else:
        logger.warning(
            "Ollama is running but model %r is not pulled. Available: %s. "
            "Run: ollama pull %s",
            settings.local_llm_model,
            available_models or "(none)",
            settings.local_llm_model,
        )


# ---------------------------------------------------------------------------
# Public interface
# ---------------------------------------------------------------------------

def answer_single(
    question: str,
    chunks: list[RetrievedChunk],
    institution: str,
    high_difficulty_threshold: float | None = None,
) -> str:
    """Generate a cited answer for a single-institution query.

    If chunks is empty, the context block contains the "no relevant passages" marker
    and the model returns the prescribed "I don't have enough information" response.
    On persistent LLM failure, returns FALLBACK_MESSAGE rather than raising.
    """
    threshold = (
        high_difficulty_threshold
        if high_difficulty_threshold is not None
        else settings.high_reading_difficulty_threshold
    )
    context_block = format_context_block(chunks, high_difficulty_threshold=threshold)
    user_message = build_user_message(question, context_block)
    return _call_llm(SINGLE_INSTITUTION_SYSTEM, user_message)


def answer_compare(
    question: str,
    chunks: list[RetrievedChunk],
) -> str:
    """Generate a cross-institution comparison answer."""
    context_block = format_context_block(
        chunks,
        high_difficulty_threshold=settings.high_reading_difficulty_threshold,
    )
    user_message = build_user_message(question, context_block)
    return _call_llm(CROSS_INSTITUTION_SYSTEM, user_message)
