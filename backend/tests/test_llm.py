"""LLM tests: retry/fallback unit tests + end-to-end tests against the live provider.

Retry tests monkey-patch the provider invoker, so they always run.
End-to-end tests are skipped when the configured provider isn't reachable.
"""

from __future__ import annotations

import httpx
import pytest

from app.config import settings
from app.llm import answer_single
from app.prompts import RetrievedChunk, format_context_block

DECLINE_PHRASES = [
    "i don't have enough information",
    "not addressed",
    "not found",
    "no information",
    "cannot find",
    "does not contain",
]


def _response_declines(text: str) -> bool:
    lower = text.lower()
    return any(phrase in lower for phrase in DECLINE_PHRASES)


def _llm_available() -> bool:
    """True if the configured provider is reachable for live tests."""
    if settings.use_local_llm:
        try:
            httpx.get(f"{settings.ollama_base_url}/api/tags", timeout=2.0)
            return True
        except Exception:
            return False
    return bool(settings.gemini_api_key)


# ---------------------------------------------------------------------------
# Context formatting (no LLM call — pure unit test)
# ---------------------------------------------------------------------------

def test_empty_chunks_context_block():
    block = format_context_block([])
    assert "no relevant passages" in block.lower()


def test_high_difficulty_flag_appears_in_context():
    chunk = RetrievedChunk(
        text="The faculty member shall hereunder abide by the provisions set forth.",
        institution="Northeastern",
        section_title="Policy",
        page_start=5,
        page_end=5,
        flesch_kincaid_grade=16.0,
    )
    block = format_context_block([chunk], high_difficulty_threshold=14.0)
    assert "HIGH_READING_DIFFICULTY" in block


def test_below_threshold_chunk_has_no_flag():
    chunk = RetrievedChunk(
        text="Faculty may teach freely.",
        institution="Northeastern",
        section_title="Rights",
        page_start=2,
        page_end=2,
        flesch_kincaid_grade=8.0,
    )
    block = format_context_block([chunk], high_difficulty_threshold=14.0)
    assert "HIGH_READING_DIFFICULTY" not in block


# ---------------------------------------------------------------------------
# Retry / fallback (no real LLM call; monkey-patches the provider invoker)
# ---------------------------------------------------------------------------

class _FakeServiceUnavailable(Exception):
    """Mimics a 503 response (carries .code, like google-genai's APIError)."""
    code = 503

    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return "503 UNAVAILABLE"


class _FakeBadRequest(Exception):
    """Non-retryable 400-class error."""
    code = 400


def test_call_with_retry_succeeds_after_transient_failures(monkeypatch):
    from app import llm
    monkeypatch.setattr(llm.time, "sleep", lambda *_: None)

    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise _FakeServiceUnavailable()
        return "ok"

    result = llm.call_with_retry(flaky, base_delay=0.0)
    assert result == "ok"
    assert calls["n"] == 3


def test_call_with_retry_raises_after_exhausting_retries(monkeypatch):
    from app import llm
    monkeypatch.setattr(llm.time, "sleep", lambda *_: None)

    calls = {"n": 0}

    def always_fail():
        calls["n"] += 1
        raise _FakeServiceUnavailable()

    with pytest.raises(_FakeServiceUnavailable):
        llm.call_with_retry(always_fail, base_delay=0.0)
    assert calls["n"] == 4


def test_call_with_retry_skips_non_retryable_errors(monkeypatch):
    from app import llm
    monkeypatch.setattr(llm.time, "sleep", lambda *_: None)

    calls = {"n": 0}

    def fail_immediately():
        calls["n"] += 1
        raise _FakeBadRequest()

    with pytest.raises(_FakeBadRequest):
        llm.call_with_retry(fail_immediately, base_delay=0.0)
    assert calls["n"] == 1


def test_call_with_retry_records_exponential_backoff(monkeypatch):
    from app import llm
    sleeps: list[float] = []
    monkeypatch.setattr(llm.time, "sleep", lambda d: sleeps.append(d))

    def always_fail():
        raise _FakeServiceUnavailable()

    with pytest.raises(_FakeServiceUnavailable):
        llm.call_with_retry(always_fail, base_delay=1.0)
    assert sleeps == [1.0, 2.0, 4.0]


def test_call_llm_returns_fallback_after_persistent_failure(monkeypatch):
    """When all retries are exhausted, /query gets the fallback message."""
    from app import llm
    monkeypatch.setattr(llm.time, "sleep", lambda *_: None)
    monkeypatch.setattr(llm.settings, "llm_cache_enabled", False)
    monkeypatch.setattr(llm.settings, "use_local_llm", True)

    def always_fail(_system, _user):
        raise _FakeServiceUnavailable()

    monkeypatch.setattr(llm, "_invoke_ollama", always_fail)

    result = llm._call_llm("system", "user")
    assert result == llm.FALLBACK_MESSAGE


def test_call_llm_does_not_cache_fallback(monkeypatch, tmp_path):
    from app import llm
    monkeypatch.setattr(llm.time, "sleep", lambda *_: None)
    monkeypatch.setattr(llm.settings, "llm_cache_enabled", True)
    monkeypatch.setattr(llm.settings, "llm_cache_dir", tmp_path)
    monkeypatch.setattr(llm.settings, "use_local_llm", True)

    def always_fail(_system, _user):
        raise _FakeServiceUnavailable()

    monkeypatch.setattr(llm, "_invoke_ollama", always_fail)

    result = llm._call_llm("uniq_system", "uniq_user")
    assert result == llm.FALLBACK_MESSAGE
    assert not list(tmp_path.glob("*.json")), "Fallback should not be persisted to cache"


def test_call_llm_caches_successful_response(monkeypatch, tmp_path):
    from app import llm
    monkeypatch.setattr(llm.settings, "llm_cache_enabled", True)
    monkeypatch.setattr(llm.settings, "llm_cache_dir", tmp_path)
    monkeypatch.setattr(llm.settings, "use_local_llm", True)

    calls = {"n": 0}

    def succeed_once(_system, _user):
        calls["n"] += 1
        return "real answer"

    monkeypatch.setattr(llm, "_invoke_ollama", succeed_once)

    first = llm._call_llm("sys_cache_test", "user_cache_test")
    second = llm._call_llm("sys_cache_test", "user_cache_test")
    assert first == second == "real answer"
    assert calls["n"] == 1, "Second call should hit cache, not invoke the LLM"


def test_cache_key_differs_across_providers(monkeypatch):
    """Switching provider/model should invalidate the cache so we don't serve stale answers."""
    from app import llm
    monkeypatch.setattr(llm.settings, "use_local_llm", True)
    monkeypatch.setattr(llm.settings, "local_llm_model", "qwen2.5:7b-instruct")
    key_ollama = llm._cache_key("sys", "user")

    monkeypatch.setattr(llm.settings, "use_local_llm", False)
    monkeypatch.setattr(llm.settings, "gemini_model", "gemini-2.5-flash")
    key_gemini = llm._cache_key("sys", "user")

    assert key_ollama != key_gemini


# ---------------------------------------------------------------------------
# Ollama HTTP wire format
# ---------------------------------------------------------------------------

class _FakeOllamaResponse:
    def __init__(self, body: dict, status_code: int = 200):
        self._body = body
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            request = httpx.Request("POST", "http://test/api/generate")
            response = httpx.Response(self.status_code, request=request, json=self._body)
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}", request=request, response=response
            )

    def json(self):
        return self._body


def test_invoke_ollama_constructs_correct_request(monkeypatch):
    """Verify the Ollama request body matches the API spec."""
    from app import llm

    captured: dict = {}

    def fake_post(url, json, timeout):
        captured["url"] = url
        captured["json"] = json
        captured["timeout"] = timeout
        return _FakeOllamaResponse({"response": "ok", "done": True})

    monkeypatch.setattr(llm.httpx, "post", fake_post)
    monkeypatch.setattr(llm.settings, "local_llm_model", "qwen2.5:7b-instruct")
    monkeypatch.setattr(llm.settings, "ollama_base_url", "http://localhost:11434")
    monkeypatch.setattr(llm.settings, "ollama_num_ctx", 8192)
    monkeypatch.setattr(llm.settings, "ollama_timeout_seconds", 120.0)

    result = llm._invoke_ollama("system here", "user here")

    assert result == "ok"
    assert captured["url"] == "http://localhost:11434/api/generate"
    assert captured["json"]["model"] == "qwen2.5:7b-instruct"
    assert captured["json"]["system"] == "system here"
    assert captured["json"]["prompt"] == "user here"
    assert captured["json"]["stream"] is False
    assert captured["json"]["options"]["temperature"] == 0.0
    assert captured["json"]["options"]["num_ctx"] == 8192
    assert captured["timeout"] == 120.0


def test_invoke_ollama_raises_on_http_error(monkeypatch):
    """503 from Ollama must surface as HTTPStatusError so retry layer can act on it."""
    from app import llm

    monkeypatch.setattr(
        llm.httpx, "post",
        lambda *_a, **_kw: _FakeOllamaResponse({"error": "loading"}, status_code=503),
    )

    with pytest.raises(httpx.HTTPStatusError):
        llm._invoke_ollama("sys", "user")


def test_invoke_ollama_returns_empty_on_missing_response_field(monkeypatch):
    """If Ollama omits the 'response' field, return empty string rather than crashing."""
    from app import llm

    monkeypatch.setattr(
        llm.httpx, "post",
        lambda *_a, **_kw: _FakeOllamaResponse({"done": True}),
    )

    assert llm._invoke_ollama("sys", "user") == ""


# ---------------------------------------------------------------------------
# Retry-classification unit tests for _is_retryable
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("code", [408, 429, 500, 502, 503, 504])
def test_is_retryable_recognizes_transient_status_codes(code):
    from app.llm import _is_retryable

    class FakeErr(Exception):
        pass

    err = FakeErr("boom")
    err.code = code
    assert _is_retryable(err) is True


@pytest.mark.parametrize("code", [400, 401, 403, 404, 422])
def test_is_retryable_rejects_client_errors(code):
    from app.llm import _is_retryable

    class FakeErr(Exception):
        pass

    err = FakeErr("boom")
    err.code = code
    assert _is_retryable(err) is False


def test_is_retryable_recognizes_httpx_timeout():
    from app.llm import _is_retryable

    assert _is_retryable(httpx.ReadTimeout("slow")) is True
    assert _is_retryable(httpx.ConnectError("no route")) is True


def test_is_retryable_recognizes_httpx_status_error():
    """httpx.HTTPStatusError with retryable status code should be retryable."""
    from app.llm import _is_retryable

    request = httpx.Request("POST", "http://test/")
    response = httpx.Response(503, request=request)
    err = httpx.HTTPStatusError("503", request=request, response=response)
    assert _is_retryable(err) is True

    response_400 = httpx.Response(400, request=request)
    err_400 = httpx.HTTPStatusError("400", request=request, response=response_400)
    assert _is_retryable(err_400) is False


# ---------------------------------------------------------------------------
# Live LLM behavior (skipped when the configured provider isn't reachable)
# ---------------------------------------------------------------------------

_skip_no_llm = pytest.mark.skipif(
    not _llm_available(),
    reason="Configured LLM provider not reachable (Ollama not running, or Gemini key not set)",
)


@_skip_no_llm
def test_llm_declines_on_empty_context():
    """With no retrieved chunks, the LLM must use the prescribed decline template."""
    answer = answer_single(
        question="What is the faculty parking policy?",
        chunks=[],
        institution="Northeastern",
    )
    assert _response_declines(answer), (
        f"Expected a decline response for empty context; got:\n{answer[:400]}"
    )


@_skip_no_llm
def test_llm_declines_on_irrelevant_context():
    """With off-topic context (cooking), the LLM must decline the governance question."""
    irrelevant = RetrievedChunk(
        text=(
            "Sauté the onions over medium heat until translucent, approximately five minutes. "
            "Add garlic and stir for one minute. Season with salt, pepper, and thyme."
        ),
        institution="Northeastern",
        section_title="Culinary Guidelines",
        page_start=1,
        page_end=1,
        flesch_kincaid_grade=9.0,
    )
    answer = answer_single(
        question="What is the procedure for appealing a tenure decision?",
        chunks=[irrelevant],
        institution="Northeastern",
    )
    assert _response_declines(answer), (
        f"Expected decline on irrelevant context; got:\n{answer[:400]}"
    )


@_skip_no_llm
def test_llm_cites_institution_in_answer():
    """A real governance question should produce an answer that cites Northeastern."""
    from app.retrieval import retrieve
    chunks = retrieve(
        "How is academic freedom defined for faculty?",
        institution="Northeastern",
        top_k=5,
    )
    answer = answer_single(
        question="How is academic freedom defined for faculty?",
        chunks=chunks,
        institution="Northeastern",
    )
    assert "Northeastern" in answer, (
        f"Expected 'Northeastern' citation in answer; got:\n{answer[:400]}"
    )
    assert "[" in answer and "]" in answer, (
        f"Expected bracketed citations in answer; got:\n{answer[:400]}"
    )
