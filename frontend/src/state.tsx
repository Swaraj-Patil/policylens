import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { query, QueryError } from './api'
import type {
  AnswerEntry,
  ErrorKind,
  HistoryEntry,
  QueryResponse,
} from './types'

const DEFAULT_INSTITUTION = 'Northeastern'
const HISTORY_KEY = 'policylens.history.v1'
const SESSION_KEY = 'policylens.session.v1'
const HISTORY_LIMIT = 20
const ENTRIES_LIMIT = 30
const QUERY_TIMEOUT_MS = 90_000

type AppState = {
  institution: string
  setInstitution: (name: string) => void

  // Stacked timeline (newest first). Each entry is independent — backend is
  // still stateless. The list is the workspace's entire research session.
  entries: AnswerEntry[]
  activeEntryId: string | null
  setActiveEntryId: (id: string | null) => void
  /** Mark an entry as having finished its reveal animation. Persisted so a
   *  reload won't replay the stream. */
  markEntryStreamed: (id: string) => void
  /** Wipe the entire session — entries + active. Used by an audit-pass
   *  "Clear session" affordance. */
  clearSession: () => void

  // ---- Compatibility surface (derived from the active entry) ----
  // Existing consumers — RightInspector, CitationChip, SourceCard, App's
  // DrawerTrigger — read these as before. They always reflect the entry the
  // user is currently focused on, never some other entry in the stack.
  currentQuery: string | null
  currentResult: QueryResponse | null
  loading: boolean
  error: string | null
  errorKind: ErrorKind | null
  elapsedMs: number | null
  lastUpdatedAt: number | null

  runQuery: (question: string) => Promise<void>
  resetSession: () => void

  // Bidirectional hover linkage between citation chips and source cards.
  // Identifies a (institution, section_title) pair via citations.matchKeyOf().
  hoveredMatchKey: string | null
  setHoveredMatchKey: (key: string | null) => void
  focusedSource: { key: string; nonce: number } | null
  focusSource: (key: string) => void
  expandedSourceKey: string | null
  setExpandedSourceKey: (key: string | null) => void

  history: HistoryEntry[]
  /** If `onlyInstitution` is provided, clears only that institution's entries. */
  clearHistory: (onlyInstitution?: string) => void
}

const AppContext = createContext<AppState | null>(null)

// ---------------------------------------------------------------------------
// localStorage helpers — defensive (disabled storage / quota issues are silent)
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

type SessionShape = {
  institution: string
  /** Per-institution active entry pointer. Each institution behaves like an
   *  isolated workspace: switching to one with no recorded active entry
   *  drops the visible timeline to the empty state. */
  activeEntryIdByInstitution: Record<string, string | null>
  entries: AnswerEntry[]
}

function loadSession(): SessionShape | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.institution !== 'string') return null
    if (!Array.isArray(parsed.entries)) return null

    const entries: AnswerEntry[] = parsed.entries
      .filter(
        (e: unknown): e is AnswerEntry =>
          !!e &&
          typeof e === 'object' &&
          typeof (e as AnswerEntry).id === 'string' &&
          typeof (e as AnswerEntry).query === 'string' &&
          typeof (e as AnswerEntry).institution === 'string' &&
          (e as AnswerEntry).completedAt !== null,
      )
      .slice(0, ENTRIES_LIMIT)
      .map((e: AnswerEntry) => ({ ...e, streamed: true }))

    const validIds = new Set(entries.map((e) => e.id))
    const map: Record<string, string | null> = {}

    if (
      parsed.activeEntryIdByInstitution &&
      typeof parsed.activeEntryIdByInstitution === 'object'
    ) {
      // New schema — copy in, dropping any pointers that no longer resolve.
      for (const [k, v] of Object.entries(parsed.activeEntryIdByInstitution)) {
        if (typeof k !== 'string') continue
        if (v === null) {
          map[k] = null
        } else if (typeof v === 'string' && validIds.has(v)) {
          map[k] = v
        }
      }
    } else if (typeof parsed.activeEntryId === 'string') {
      // Backward compat: old single-pointer schema. Locate the entry's
      // institution and seed the map there.
      const owning = entries.find((e) => e.id === parsed.activeEntryId)
      if (owning) map[owning.institution] = owning.id
    }

    // Default each institution with entries to its newest entry as active
    // (entries[] is newest-first), but only where no pointer was recorded.
    for (const e of entries) {
      if (!(e.institution in map)) {
        map[e.institution] = e.id
      }
    }

    return {
      institution: parsed.institution,
      activeEntryIdByInstitution: map,
      entries,
    }
  } catch {
    return null
  }
}

function saveSession(s: SessionShape): void {
  try {
    // Drop in-flight entries on save (they'd be dangling on reload), and
    // prune any active-pointer that no longer resolves to a real entry.
    const cleaned = s.entries.filter((e) => e.completedAt !== null)
    const validIds = new Set(cleaned.map((e) => e.id))
    const cleanedMap: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(s.activeEntryIdByInstitution)) {
      if (v === null || validIds.has(v)) cleanedMap[k] = v
    }
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        institution: s.institution,
        activeEntryIdByInstitution: cleanedMap,
        entries: cleaned,
      }),
    )
  } catch {
    // non-fatal
  }
}

// ---------------------------------------------------------------------------
// Error classification — heuristic mapping from caught error → ErrorKind.
// ---------------------------------------------------------------------------

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
// Entry id generation — short, sortable, unique enough for session-scope use.
// ---------------------------------------------------------------------------

function newEntryId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AppProvider({ children }: { children: ReactNode }) {
  const initialSession = useMemo(() => loadSession(), [])

  const [institution, setInstitutionRaw] = useState<string>(
    initialSession?.institution ?? DEFAULT_INSTITUTION,
  )
  // `entries` is the global, flat union across all institutions. The visible
  // workspace is derived by filtering on the current `institution`. Storage
  // stays flat so switching institutions and back restores the prior slice
  // without an extra reconciliation step.
  const [entries, setEntries] = useState<AnswerEntry[]>(
    initialSession?.entries ?? [],
  )
  // Per-institution active-entry pointer. Each institution behaves as an
  // independent workspace; switching to one with no recorded pointer falls
  // through to the empty state.
  const [activeEntryIdByInstitution, setActiveEntryIdByInstitutionRaw] =
    useState<Record<string, string | null>>(
      initialSession?.activeEntryIdByInstitution ?? {},
    )
  const [hoveredMatchKey, setHoveredMatchKey] = useState<string | null>(null)
  const [focusedSource, setFocusedSource] = useState<
    { key: string; nonce: number } | null
  >(null)
  const [expandedSourceKey, setExpandedSourceKey] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory())

  const requestIdRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  // Persist history changes.
  useEffect(() => {
    saveHistory(history)
  }, [history])

  // Persist session changes (entries / active map / institution).
  useEffect(() => {
    saveSession({ institution, activeEntryIdByInstitution, entries })
  }, [institution, activeEntryIdByInstitution, entries])

  const pushHistory = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => {
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

  // Writes the active pointer for the *current* institution. Visible entries
  // are scoped to current institution, so any id callers pass in here always
  // belongs to it — no cross-institution writes happen through this path.
  const setActiveEntryId = useCallback(
    (id: string | null) => {
      setActiveEntryIdByInstitutionRaw((prev) => ({ ...prev, [institution]: id }))
      setExpandedSourceKey(null)
    },
    [institution],
  )

  const markEntryStreamed = useCallback((id: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id && !e.streamed ? { ...e, streamed: true } : e)),
    )
  }, [])

  const clearSession = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setEntries([])
    setActiveEntryIdByInstitutionRaw({})
    setExpandedSourceKey(null)
  }, [])

  const resetSession = useCallback(() => {
    // Legacy alias kept for any callers — equivalent to clearing the workspace
    // and any in-flight request.
    clearSession()
  }, [clearSession])

  const setInstitution = useCallback(
    (name: string) => {
      if (name === institution) return
      // Aborting any in-flight request and dropping its still-pending entry
      // prevents a half-finished entry from sitting forever in the prior
      // institution's slice (it would never reach completedAt and the next
      // submission cleanup wouldn't catch it if it happens in a different
      // institution).
      abortRef.current?.abort()
      abortRef.current = null
      setInstitutionRaw(name)
      setExpandedSourceKey(null)
      setEntries((prev) => prev.filter((e) => e.completedAt !== null))
      // The timeline itself (completed entries from other institutions) is
      // intentionally NOT wiped — each institution's slice persists for when
      // the user returns to it.
    },
    [institution],
  )

  const focusSource = useCallback(
    (key: string) => {
      // Scope the search to the current institution — chips outside the
      // visible workspace can't be clicked anyway, and a same matchKey
      // (institution + section) can't span institutions, so this is safe.
      const currentActive = activeEntryIdByInstitution[institution] ?? null
      const owning = entries.find(
        (e) =>
          e.institution === institution &&
          e.result?.sources.some(
            (s) => `${s.institution}::${s.section_title}` === key,
          ),
      )
      if (owning && owning.id !== currentActive) {
        setActiveEntryIdByInstitutionRaw((prev) => ({
          ...prev,
          [institution]: owning.id,
        }))
      }
      setExpandedSourceKey(key)
      setFocusedSource((prev) => ({ key, nonce: (prev?.nonce ?? 0) + 1 }))
    },
    [entries, institution, activeEntryIdByInstitution],
  )

  const runQuery = useCallback(
    async (question: string) => {
      const trimmed = question.trim()
      if (!trimmed) return

      // Abort any in-flight request and drop its still-pending entry from the
      // stack — half-finished entries shouldn't accumulate.
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const myId = ++requestIdRef.current

      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, QUERY_TIMEOUT_MS)

      const id = newEntryId()
      const startedAt = Date.now()
      const startedPerf = performance.now()
      const entry: AnswerEntry = {
        id,
        query: trimmed,
        institution,
        result: null,
        errorKind: null,
        startedAt,
        completedAt: null,
        elapsedMs: null,
        streamed: false,
      }

      setEntries((prev) => {
        // Drop any leading in-flight entry (only the latest can be in-flight),
        // then prepend the new one. Cap at ENTRIES_LIMIT.
        const cleaned = prev.filter((e) => e.completedAt !== null)
        return [entry, ...cleaned].slice(0, ENTRIES_LIMIT)
      })
      // Set this institution's active pointer to the new entry. Other
      // institutions' pointers are untouched.
      setActiveEntryIdByInstitutionRaw((prev) => ({ ...prev, [institution]: id }))
      setExpandedSourceKey(null)

      try {
        const result = await query(trimmed, institution, controller.signal)
        if (requestIdRef.current !== myId) return // superseded
        const elapsed = performance.now() - startedPerf

        if (!result.sources || result.sources.length === 0) {
          // 0-source success → no_results state. Don't store the model's
          // "I don't know" prose; let the empty-state copy handle it.
          setEntries((prev) =>
            prev.map((e) =>
              e.id === id
                ? {
                    ...e,
                    result: null,
                    errorKind: 'no_results',
                    elapsedMs: elapsed,
                    completedAt: Date.now(),
                    streamed: true,
                  }
                : e,
            ),
          )
        } else {
          setEntries((prev) =>
            prev.map((e) =>
              e.id === id
                ? {
                    ...e,
                    result,
                    errorKind: null,
                    elapsedMs: elapsed,
                    completedAt: Date.now(),
                  }
                : e,
            ),
          )
          pushHistory({
            query: trimmed,
            institution,
            timestamp: Date.now(),
          })
        }
      } catch (err) {
        if (controller.signal.aborted) {
          if (timedOut && requestIdRef.current === myId) {
            const elapsed = performance.now() - startedPerf
            setEntries((prev) =>
              prev.map((e) =>
                e.id === id
                  ? {
                      ...e,
                      errorKind: 'timeout',
                      elapsedMs: elapsed,
                      completedAt: Date.now(),
                      streamed: true,
                    }
                  : e,
              ),
            )
          } else if (requestIdRef.current !== myId) {
            // Superseded by a newer query. The old entry was already dropped
            // by the next runQuery call, so nothing to clean up here.
          }
          return
        }
        if (requestIdRef.current !== myId) return
        console.error('[PolicyLens] Query failed:', err)
        const elapsed = performance.now() - startedPerf
        setEntries((prev) =>
          prev.map((e) =>
            e.id === id
              ? {
                  ...e,
                  errorKind: classifyError(err),
                  elapsedMs: elapsed,
                  completedAt: Date.now(),
                  streamed: true,
                }
              : e,
          ),
        )
      } finally {
        clearTimeout(timer)
      }
    },
    [pushHistory, institution],
  )

  // ---- Derived compatibility surface ----
  // The visible entries are scoped to the current institution. Consumers
  // (CenterPanel timeline, RightInspector) iterate this — they never see
  // other institutions' entries. The flat `entries` underneath is the union.
  const visibleEntries = useMemo<AnswerEntry[]>(
    () => entries.filter((e) => e.institution === institution),
    [entries, institution],
  )
  const activeEntryId = activeEntryIdByInstitution[institution] ?? null
  const activeEntry = useMemo<AnswerEntry | null>(
    () => visibleEntries.find((e) => e.id === activeEntryId) ?? null,
    [visibleEntries, activeEntryId],
  )
  const currentQuery = activeEntry?.query ?? null
  const currentResult = activeEntry?.result ?? null
  const errorKind = activeEntry?.errorKind ?? null
  const elapsedMs = activeEntry?.elapsedMs ?? null
  const lastUpdatedAt = activeEntry?.completedAt ?? null
  // `loading` is true when the active entry hasn't completed and isn't in an
  // error state — i.e. the user is waiting for *this* answer.
  const loading =
    activeEntry !== null &&
    activeEntry.completedAt === null &&
    activeEntry.errorKind === null
  const error = errorKind ? `error:${errorKind}` : null

  return (
    <AppContext.Provider
      value={{
        institution,
        setInstitution,
        entries: visibleEntries,
        activeEntryId,
        setActiveEntryId,
        markEntryStreamed,
        clearSession,
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
