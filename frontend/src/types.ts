export type SourceInfo = {
  institution: string
  section_title: string
  page_start: number
  page_end: number
  flesch_kincaid_grade: number | null
  /** Raw chunk text for in-panel preview. Older backends omit this. */
  text?: string
}

export type QueryResponse = {
  answer: string
  institution: string
  question: string
  sources: SourceInfo[]
}

export type Citation = {
  institution: string
  section_title: string
  page_ref: string // raw page text, e.g. "p.77" or "pp.77-78"
}

export type AnswerToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'citations'; items: Citation[] }

export type AnswerBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'heading'; level: number; text: string }

export type HistoryEntry = {
  query: string
  institution: string
  timestamp: number // Date.now() at the moment the query succeeded
}

/**
 * Discriminated kinds of recoverable failure surfaced to the user. Drives the
 * error/empty-state copy in CenterPanel. `no_results` is *not* a transport
 * failure — it represents a 200 OK with an empty source list (the model
 * declined to answer because retrieval found nothing relevant).
 */
export type ErrorKind =
  | 'no_results'
  | 'backend_unavailable'
  | 'llm_unavailable'
  | 'timeout'
  | 'unknown'

/**
 * Multiple chunks from the same (institution, section_title) collapse into one
 * card so the inspector shows distinct passages rather than near-duplicate
 * fragments. Aggregation is shallow — page span is the union of starts/ends,
 * the FK score is the max of the underlying chunks (worst-case readability).
 */
export type GroupedSource = {
  institution: string
  section_title: string
  page_start: number
  page_end: number
  flesch_kincaid_grade: number | null
  excerpts: string[]
  count: number
}
