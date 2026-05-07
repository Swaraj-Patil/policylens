import type { QueryResponse } from './types'

// ---------------------------------------------------------------------------
// API base URL resolution.
//
//   - Production: VITE_API_BASE_URL must be set at build time and point to
//     the deployed FastAPI backend (e.g. "https://policylens-api.example.com").
//     A missing/empty value is a hard error — we throw at module load so the
//     misconfiguration surfaces immediately rather than as a confusing
//     network error on the user's first query.
//
//   - Development: VITE_API_BASE_URL may be unset. We fall back to "/api",
//     which Vite's dev server proxies to http://localhost:8000 (see the
//     `server.proxy` block in vite.config.ts). The dev proxy remains the
//     local-development convenience path; production never relies on it.
//
//   - Trailing slashes are stripped so callers can write `${BASE_URL}/query`
//     without worrying about double slashes.
// ---------------------------------------------------------------------------

function resolveBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (raw && raw.trim()) {
    return raw.trim().replace(/\/+$/, '')
  }
  if (import.meta.env.DEV) {
    // Dev fallback — Vite proxy strips "/api" and forwards to localhost:8000.
    return '/api'
  }
  throw new Error(
    'PolicyLens: VITE_API_BASE_URL is not set. ' +
      'Production builds require this env var to point to the deployed backend ' +
      '(e.g. https://policylens-api.example.com). Set it in your hosting ' +
      'platform\'s environment configuration and rebuild.',
  )
}

export const API_BASE_URL = resolveBaseUrl()

// One-time startup log. Helps debugging "is the bundle pointing at the right
// backend?" without exposing the URL anywhere user-visible.
console.info('[PolicyLens] API_BASE_URL =', API_BASE_URL)

// ---------------------------------------------------------------------------
// /query
// ---------------------------------------------------------------------------

/** Thrown for any non-2xx response from the backend. Carries the status code. */
export class QueryError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'QueryError'
    this.status = status
  }
}

/**
 * POST {API_BASE_URL}/query.
 * Throws on non-2xx. Pass an AbortSignal to cancel an in-flight request.
 */
export async function query(
  question: string,
  institution: string,
  signal?: AbortSignal,
): Promise<QueryResponse> {
  const url = `${API_BASE_URL}/query`
  console.info('[PolicyLens] POST', url, '→', { question, institution })

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, institution }),
    signal,
  })

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.detail) detail = String(body.detail)
    } catch {
      // Response body wasn't JSON; keep generic detail.
    }
    console.error('[PolicyLens]', url, 'failed:', res.status, detail)
    throw new QueryError(detail, res.status)
  }

  const data = (await res.json()) as QueryResponse
  console.info('[PolicyLens]', url, '←', {
    sources: data.sources?.length ?? 0,
    answerChars: data.answer?.length ?? 0,
  })
  return data
}
