import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { query } from './api'
import type { HistoryEntry, QueryResponse } from './types'

const DEFAULT_INSTITUTION = 'Northeastern'
const HISTORY_KEY = 'policylens.history.v1'
const HISTORY_LIMIT = 20

type AppState = {
  institution: string
  setInstitution: (name: string) => void
  currentQuery: string | null
  currentResult: QueryResponse | null
  loading: boolean
  error: string | null
  runQuery: (question: string) => Promise<void>
  resetSession: () => void
  // Bidirectional hover linkage between citation chips and source cards.
  // Identifies a (institution, section_title) pair via citations.matchKeyOf().
  hoveredMatchKey: string | null
  setHoveredMatchKey: (key: string | null) => void
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
// Provider
// ---------------------------------------------------------------------------

export function AppProvider({ children }: { children: ReactNode }) {
  const [institution, setInstitutionRaw] = useState<string>(DEFAULT_INSTITUTION)
  const [currentQuery, setCurrentQuery] = useState<string | null>(null)
  const [currentResult, setCurrentResult] = useState<QueryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredMatchKey, setHoveredMatchKey] = useState<string | null>(null)
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
      // institution) key, then push the new entry to the head. This handles
      // both consecutive duplicates AND re-running an older history item.
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
    setLoading(false)
  }, [])

  // Switching institutions clears the in-flight request and the displayed
  // result. Sources retrieved for one institution would be visually
  // misleading next to a selector that now points elsewhere; rather than
  // mix institutions on screen, we drop to idle and force a fresh query.
  // Same-institution clicks are no-ops and never disturb the visible result.
  const setInstitution = useCallback(
    (name: string) => {
      if (name === institution) return
      abortRef.current?.abort()
      abortRef.current = null
      setInstitutionRaw(name)
      setCurrentQuery(null)
      setCurrentResult(null)
      setError(null)
      setLoading(false)
    },
    [institution],
  )

  const runQuery = useCallback(
    async (question: string) => {
      const trimmed = question.trim()
      if (!trimmed) return

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const myId = ++requestIdRef.current

      setCurrentQuery(trimmed)
      setLoading(true)
      setError(null)

      try {
        const result = await query(trimmed, institution, controller.signal)
        if (requestIdRef.current !== myId) return // superseded
        setCurrentResult(result)
        setLoading(false)
        pushHistory({
          query: trimmed,
          institution,
          timestamp: Date.now(),
        })
      } catch (err) {
        // We aborted this request because a newer one started — the new one owns state.
        if (controller.signal.aborted) return
        if (requestIdRef.current !== myId) return
        console.error('[PolicyLens] Query failed:', err)
        setCurrentResult(null)
        setError(err instanceof Error ? err.message : 'Network error')
        setLoading(false)
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
        runQuery,
        resetSession,
        hoveredMatchKey,
        setHoveredMatchKey,
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
