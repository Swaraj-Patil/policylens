"""Public LLM-layer API.

Stable imports for the rest of the backend:

    from app.llm import answer_single, answer_compare        # RAG entry points
    from app.llm import generate_answer                      # generic helper
    from app.llm import get_llm_provider, check_llm_available
    from app.llm import FALLBACK_MESSAGE, call_with_retry, _is_retryable

The retrieval pipeline, citation logic, and response schema are all
unchanged — this package only abstracts the model call.
"""

from __future__ import annotations

import logging

from app.config import settings
from app.prompts import (
    CROSS_INSTITUTION_SYSTEM,
    SINGLE_INSTITUTION_SYSTEM,
    RetrievedChunk,
    build_user_message,
    format_context_block,
)

from .base import HealthCheckError, LLMProvider
from .engine import (
    FALLBACK_MESSAGE,
    _is_retryable,
    call_llm,
    call_with_retry,
)
from .factory import get_llm_provider, reset_provider_for_testing

logger = logging.getLogger(__name__)


__all__ = [
    "answer_single",
    "answer_compare",
    "generate_answer",
    "check_llm_available",
    "get_llm_provider",
    "reset_provider_for_testing",
    "LLMProvider",
    "HealthCheckError",
    "FALLBACK_MESSAGE",
    "call_with_retry",
    "_is_retryable",
]


# ---------------------------------------------------------------------------
# Generic single-prompt helper
# ---------------------------------------------------------------------------

def generate_answer(prompt: str, *, system: str = "") -> str:
    """Unified provider entry point for ad-hoc single-prompt usage.

    Wraps `call_llm` (cache + retry + fallback) around the active provider.
    The RAG callers below use the system/user split directly — this helper
    exists for callers that only have a single prompt string.
    """
    return call_llm(system, prompt)


# ---------------------------------------------------------------------------
# RAG entry points — unchanged signatures
# ---------------------------------------------------------------------------

def answer_single(
    question: str,
    chunks: list[RetrievedChunk],
    institution: str,
    high_difficulty_threshold: float | None = None,
) -> str:
    """Generate a cited answer for a single-institution query.

    If chunks is empty, the context block contains the "no relevant passages"
    marker and the model returns the prescribed "I don't have enough
    information" response. On persistent LLM failure, returns
    FALLBACK_MESSAGE rather than raising.
    """
    threshold = (
        high_difficulty_threshold
        if high_difficulty_threshold is not None
        else settings.high_reading_difficulty_threshold
    )
    context_block = format_context_block(chunks, high_difficulty_threshold=threshold)
    user_message = build_user_message(question, context_block)
    # `institution` is consumed by the prompt builder upstream; kept in this
    # signature for back-compat with callers/tests.
    _ = institution
    return call_llm(SINGLE_INSTITUTION_SYSTEM, user_message)


def answer_compare(question: str, chunks: list[RetrievedChunk]) -> str:
    """Generate a cross-institution comparison answer."""
    context_block = format_context_block(
        chunks,
        high_difficulty_threshold=settings.high_reading_difficulty_threshold,
    )
    user_message = build_user_message(question, context_block)
    return call_llm(CROSS_INSTITUTION_SYSTEM, user_message)


# ---------------------------------------------------------------------------
# Startup probe
# ---------------------------------------------------------------------------

def check_llm_available() -> None:
    """Probe the configured LLM provider at startup. Logs only — never raises.

    The factory has already logged provider/model info; this adds a
    reachability check so misconfigurations surface in the boot log rather
    than on the first /query request.
    """
    provider = get_llm_provider()
    try:
        info = provider.health_check()
        logger.info("LLM provider healthy: %s", info)
    except HealthCheckError as exc:
        logger.warning(
            "LLM provider %s not currently reachable: %s. "
            "/query will return fallback responses until the provider is restored.",
            provider.name,
            exc,
        )
    except Exception as exc:  # noqa: BLE001 — startup probe must not raise
        logger.warning(
            "LLM provider %s probe raised unexpectedly (%s: %s). "
            "Continuing startup.",
            provider.name,
            type(exc).__name__,
            exc,
        )
