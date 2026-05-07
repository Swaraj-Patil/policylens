import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import { query } from './api'
import type { QueryResponse } from './types'

type AppState = {
  currentQuery: string | null
  currentResult: QueryResponse | null
  loading: boolean
  error: string | null
  runQuery: (question: string) => Promise<void>
  // Bidirectional hover linkage between citation chips and source cards.
  // Identifies a (institution, section_title) pair via citations.matchKeyOf().
  hoveredMatchKey: string | null
  setHoveredMatchKey: (key: string | null) => void
}

const AppContext = createContext<AppState | null>(null)

const DEFAULT_INSTITUTION = 'Northeastern'

export function AppProvider({ children }: { children: ReactNode }) {
  const [currentQuery, setCurrentQuery] = useState<string | null>(null)
  const [currentResult, setCurrentResult] = useState<QueryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredMatchKey, setHoveredMatchKey] = useState<string | null>(null)

  // Stale-response guard: each submit increments requestId, and any in-flight
  // request is aborted before a new one starts. Only a response whose myId
  // still matches the latest requestId is allowed to update state.
  const requestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  async function runQuery(question: string) {
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
      const result = await query(trimmed, DEFAULT_INSTITUTION, controller.signal)
      if (requestIdRef.current !== myId) return // superseded
      setCurrentResult(result)
      setLoading(false)
    } catch (err) {
      // We aborted this request because a newer one started — let the new one own state.
      if (controller.signal.aborted) return
      if (requestIdRef.current !== myId) return
      console.error('[PolicyLens] Query failed:', err)
      setCurrentResult(null)
      setError(err instanceof Error ? err.message : 'Network error')
      setLoading(false)
    }
  }

  return (
    <AppContext.Provider
      value={{
        currentQuery,
        currentResult,
        loading,
        error,
        runQuery,
        hoveredMatchKey,
        setHoveredMatchKey,
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
