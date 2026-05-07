import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { query, QueryError } from './api'
import type { ErrorKind, HistoryEntry, QueryResponse } from './types'

const DEFAULT_INSTITUTION = 'Northeastern'
const HISTORY_KEY = 'policylens.history.v1'
const HISTORY_LIMIT = 20
const QUERY_TIMEOUT_MS = 90_000

type AppState = {
  institution: string
  setInstitution: (name: string) => void
  currentQuery: string | null
  currentResult: QueryResponse | null
  loading: boolean
  /** Human-readable error string for logs/debug. UI keys off `errorKind`. */
  error: string | null
  /** Discriminated reason the last query failed or returned nothing. */
  errorKind: ErrorKind | null
  /** Wall-clock duration of the last completed query, in ms. */
  elapsedMs: number | null
  /** Timestamp at which the last query completed (ms since epoch). */
  lastUpdatedAt: number | null
  runQuery: (question: string) => Promise<void>
  resetSession: () => void
  // Bidirectional hover linkage between citation chips and source cards.
  // Identifies a (institution, section_title) pair via citations.matchKeyOf().
  hoveredMatchKey: string | null
  setHoveredMatchKey: (key: string | null) => void
  /** Imperative request to expand + scroll the SourceCard for `key`.
   *  The nonce changes on each call so re-clicking the same chip re-pulses. */
  focusedSource: { key: string; nonce: number } | null
  focusSource: (key: string) => void
  /** Which grouped source is currently expanded in the inspector. Owned here
   *  (not in RightInspector) so chip clicks can drive it. */
  expandedSourceKey: string | null
  setExpandedSourceKey: (key: string | null) => void
  history: HistoryEntry[]
  /** If `onlyInstitution` is provided, clears only that institution's entries. */
  clearHistory: (onlyInstitution?: string) => void
}

const AppContext = createContext<AppState | null>(null)

// ---------------------------------------------------------------------------
// localStorage helpers (defensive — disabled storage / quota issues are silent)
// ---------------------------------------------------------------------------

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (e): e is HistoryEntry =>
          e &&
          typeof e === 'object' &&
          typeof e.query === 'string' &&
          typeof e.institution === 'string' &&
          typeof e.timestamp === 'number',
      )
      .slice(0, HISTORY_LIMIT)
  } catch {
    return []
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries))
  } catch {
    // localStorage may be unavailable or full — non-fatal
  }
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

// Heuristic: 5xx bodies that mention the local model runtime get tagged as
// LLM-unavailable so the user sees "start Ollama and retry" rather than a
// generic outage message.
function classifyError(err: unknown): ErrorKind {
  if (err instanceof TypeError) return 'backend_unavailable'
  if (err instanceof QueryError) {
    if (err.status && err.status >= 500) {
      const m = err.message.toLowerCase()
      if (m.includes('ollama') || m.includes('llm') || m.includes('model')) {
        return 'llm_unavailable'
      }
      return 'unknown'
    }
    return 'unknown'
  }
  return 'unknown'
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AppProvider({ children }: { children: ReactNode }) {
  const [institution, setInstitutionRaw] = useState<string>(DEFAULT_INSTITUTION)
  const [currentQuery, setCurrentQuery] = useState<string | null>(null)
  const [currentResult, setCurrentResult] = useState<QueryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<ErrorKind | null>(null)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [hoveredMatchKey, setHoveredMatchKey] = useState<string | null>(null)
  const [focusedSource, setFocusedSource] = useState<
    { key: string; nonce: number } | null
  >(null)
  const [expandedSourceKey, setExpandedSourceKey] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory())

  // Stale-response guard: each submit increments requestId, and any in-flight
  // request is aborted before a new one starts. Only a response whose myId
  // still matches the latest requestId is allowed to update state.
  const requestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  // Persist history changes to localStorage.
  useEffect(() => {
    saveHistory(history)
  }, [history])

  const pushHistory = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => {
      // Move-to-front dedup: drop any prior entry with the same (query,
      // institution) key, then push the new entry to the head.
      const dedup = prev.filter(
        (e) => e.query !== entry.query || e.institution !== entry.institution,
      )
      return [entry, ...dedup].slice(0, HISTORY_LIMIT)
    })
  }, [])

  const clearHistory = useCallback((onlyInstitution?: string) => {
    if (onlyInstitution) {
      setHistory((prev) => prev.filter((e) => e.institution !== onlyInstitution))
    } else {
      setHistory([])
    }
  }, [])

  const resetSession = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setCurrentQuery(null)
    setCurrentResult(null)
    setError(null)
    setErrorKind(null)
    setElapsedMs(null)
    setLastUpdatedAt(null)
    setExpandedSourceKey(null)
    setLoading(false)
  }, [])

  // Switching institutions clears the in-flight request and the displayed
  // result. Sources retrieved for one institution would be visually
  // misleading next to a selector that now points elsewhere; rather than
  // mix institutions on screen, we drop to idle and force a fresh query.
  const setInstitution = useCallback(
    (name: string) => {
      if (name === institution) return
      abortRef.current?.abort()
      abortRef.current = null
      setInstitutionRaw(name)
      setCurrentQuery(null)
      setCurrentResult(null)
      setError(null)
      setErrorKind(null)
      setElapsedMs(null)
      setLastUpdatedAt(null)
      setExpandedSourceKey(null)
      setLoading(false)
    },
    [institution],
  )

  const focusSource = useCallback((key: string) => {
    setExpandedSourceKey(key)
    setFocusedSource((prev) => ({ key, nonce: (prev?.nonce ?? 0) + 1 }))
  }, [])

  const runQuery = useCallback(
    async (question: string) => {
      const trimmed = question.trim()
      if (!trimmed) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const myId = ++requestIdRef.current

      // The timeout flag distinguishes "we aborted because too slow" from
      // "user submitted a newer query" — the former is a user-facing error,
      // the latter is silent. Both go through controller.abort().
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, QUERY_TIMEOUT_MS)

      const startedAt = performance.now()
      setCurrentQuery(trimmed)
      setLoading(true)
      setError(null)
      setErrorKind(null)
      setExpandedSourceKey(null)

      try {
        const result = await query(trimmed, institution, controller.signal)
        if (requestIdRef.current !== myId) return // superseded
        const elapsed = performance.now() - startedAt
        setElapsedMs(elapsed)
        setLastUpdatedAt(Date.now())
        setLoading(false)

        // 0 sources → backend's RAG fallback. Surface as a dedicated empty
        // state rather than printing the model's "I don't know" prose, which
        // reads as a non-answer when shown alone.
        if (!result.sources || result.sources.length === 0) {
          setCurrentResult(null)
          setErrorKind('no_results')
        } else {
          setCurrentResult(result)
          pushHistory({
            query: trimmed,
            institution,
            timestamp: Date.now(),
          })
        }
      } catch (err) {
        if (controller.signal.aborted) {
          if (timedOut && requestIdRef.current === myId) {
            setCurrentResult(null)
            setError('Request timed out')
            setErrorKind('timeout')
            setElapsedMs(performance.now() - startedAt)
            setLoading(false)
          }
          return
        }
        if (requestIdRef.current !== myId) return
        console.error('[PolicyLens] Query failed:', err)
        setCurrentResult(null)
        setError(err instanceof Error ? err.message : 'Network error')
        setErrorKind(classifyError(err))
        setElapsedMs(performance.now() - startedAt)
        setLoading(false)
      } finally {
        clearTimeout(timer)
      }
    },
    [pushHistory, institution],
  )

  return (
    <AppContext.Provider
      value={{
        institution,
        setInstitution,
        currentQuery,
        currentResult,
        loading,
        error,
        errorKind,
        elapsedMs,
        lastUpdatedAt,
        runQuery,
        resetSession,
        hoveredMatchKey,
        setHoveredMatchKey,
        focusedSource,
        focusSource,
        expandedSourceKey,
        setExpandedSourceKey,
        history,
        clearHistory,
      }}
    >
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
