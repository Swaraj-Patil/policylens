import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { useApp } from '../state'
import { groupSources, matchKeyOf } from '../citations'
import { ResizeHandle } from './ResizeHandle'
import { SourceCard } from './SourceCard'

type Props = {
  width: number
  minWidth: number
  maxWidth: number
  animate: boolean
  setWidth: Dispatch<SetStateAction<number>>
  onResetWidth: () => void
  /** Briefly enables width transition on drag-release for a smooth settle. */
  onDragEnd?: () => void
  asDrawer?: boolean
  onClose?: () => void
}

export function RightInspector({
  width,
  minWidth,
  maxWidth,
  animate,
  setWidth,
  onResetWidth,
  onDragEnd,
  asDrawer = false,
  onClose,
}: Props) {
  const {
    currentResult,
    expandedSourceKey,
    setExpandedSourceKey,
    focusedSource,
    activeEntryId,
  } = useApp()
  const sources = currentResult?.sources ?? []
  const grouped = useMemo(() => groupSources(sources), [sources])

  // Reset expanded card when the active entry changes — a stale "expanded"
  // key from a previous entry's source set is a UX trap.
  useEffect(() => {
    setExpandedSourceKey(null)
  }, [activeEntryId, setExpandedSourceKey])

  // Scroll-into-view for chip-driven focus.
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusedSource) return
    const root = scrollRef.current
    if (!root) return
    const el = root.querySelector<HTMLElement>(
      `[data-source-key="${cssEscape(focusedSource.key)}"]`,
    )
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [focusedSource])

  // Subtle scroll-shadow on the sticky header. Drives the affordance that
  // the source list scrolls below — without an aggressive divider.
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    function onScroll() {
      if (!el) return
      setScrolled(el.scrollTop > 4)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [sources.length])

  function handleResize(dx: number) {
    setWidth((w) => Math.max(minWidth, Math.min(maxWidth, w - dx)))
  }

  return (
    <aside
      style={{ width: `${width}px` }}
      className={
        'shrink-0 border-l border-rule/70 bg-surface/95 flex flex-col relative h-full ' +
        (animate ? 'transition-[width] duration-200 ease-out' : '')
      }
    >
      {!asDrawer && (
        <ResizeHandle
          edge="left"
          onDelta={handleResize}
          onReset={onResetWidth}
          onDragEnd={onDragEnd}
        />
      )}

      <div
        className={
          'sticky top-0 z-10 px-5 py-5 bg-surface ' +
          'transition-shadow duration-200 ' +
          (scrolled ? 'shadow-[0_4px_12px_-8px_rgba(15,23,42,0.18)] border-b border-rule' : 'border-b border-rule/60')
        }
      >
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-soft">
            Sources
          </h2>
          <div className="flex items-center gap-2">
            {sources.length > 0 && (
              <span className="text-[11px] font-mono text-ink-muted">
                {grouped.length}
                {grouped.length !== sources.length && (
                  <span className="text-ink-muted/60"> / {sources.length}</span>
                )}
              </span>
            )}
            {asDrawer && onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close source panel"
                className="text-ink-muted hover:text-ink transition-colors duration-150 cursor-pointer"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <p className="text-[13px] font-medium text-ink mt-1.5 font-serif-display">
          Citations and source passages
        </p>
      </div>

      {sources.length === 0 ? (
        <SourcesEmptyState />
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto divide-y divide-rule scrollbar-thin">
          {grouped.map((g, i) => {
            const key = matchKeyOf(g)
            const isExpanded = expandedSourceKey === key
            const isFocused = focusedSource?.key === key
            return (
              <SourceCard
                key={key}
                source={g}
                rank={i + 1}
                expanded={isExpanded}
                pulseKey={isFocused ? focusedSource!.nonce : undefined}
                onToggle={() => setExpandedSourceKey(isExpanded ? null : key)}
              />
            )
          })}
        </div>
      )}
    </aside>
  )
}

function SourcesEmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center px-10 text-center">
      <div className="max-w-[240px]">
        <div className="mx-auto w-10 h-10 rounded-full border border-rule flex items-center justify-center text-ink-muted source-breath">
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M9 14h6" />
            <path d="M9 18h4" />
          </svg>
        </div>
        <p className="text-[13px] text-ink-soft leading-relaxed mt-4">
          Source passages cited in the answer will appear here.
        </p>
        <p className="text-[12px] text-ink-muted/85 leading-relaxed mt-2">
          Each result links back to its section and page in the original document.
        </p>
      </div>
    </div>
  )
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, '\\$&')
}
