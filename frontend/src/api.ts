import type { QueryResponse } from './types'

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
 * POST /api/query — proxied by Vite to http://localhost:8000/query.
 * Throws on non-2xx. Pass an AbortSignal to cancel an in-flight request.
 */
export async function query(
  question: string,
  institution: string,
  signal?: AbortSignal,
): Promise<QueryResponse> {
  console.info('[PolicyLens] POST /api/query →', { question, institution })

  const res = await fetch('/api/query', {
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
    console.error('[PolicyLens] /api/query failed:', res.status, detail)
    throw new QueryError(detail, res.status)
  }

  const data = (await res.json()) as QueryResponse
  console.info('[PolicyLens] /api/query ←', {
    sources: data.sources?.length ?? 0,
    answerChars: data.answer?.length ?? 0,
  })
  return data
}
