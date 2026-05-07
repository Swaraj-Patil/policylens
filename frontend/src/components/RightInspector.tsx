import {
  useEffect,
  useMemo,
  useRef,
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
  /** When the inspector is rendered as a sliding overlay (narrow viewports),
   *  the resize handle hides and a close affordance appears. */
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
  asDrawer = false,
  onClose,
}: Props) {
  const {
    currentResult,
    expandedSourceKey,
    setExpandedSourceKey,
    focusedSource,
  } = useApp()
  const sources = currentResult?.sources ?? []
  const grouped = useMemo(() => groupSources(sources), [sources])

  // Reset expanded card when the result changes — a stale "expanded" key from
  // a previous query shouldn't persist into a new one.
  useEffect(() => {
    setExpandedSourceKey(null)
  }, [currentResult, setExpandedSourceKey])

  // Listen for focusSource() requests originating from chip clicks. The
  // expandedSourceKey effect runs in state.tsx (focusSource sets it directly);
  // here we only handle the scroll into view.
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

  function handleResize(dx: number) {
    // Right panel grows when its left edge moves leftward (negative dx).
    setWidth((w) => Math.max(minWidth, Math.min(maxWidth, w - dx)))
  }

  return (
    <aside
      style={{ width: `${width}px` }}
      className={
        'shrink-0 border-l border-rule bg-surface flex flex-col relative h-full ' +
        (animate ? 'transition-[width] duration-200 ease-out' : '')
      }
    >
      {!asDrawer && (
        <ResizeHandle edge="left" onDelta={handleResize} onReset={onResetWidth} />
      )}

      <div className="px-5 py-5 border-b border-rule">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
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
                className="text-ink-muted hover:text-ink transition-colors cursor-pointer"
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
        <p className="text-[13px] font-medium text-ink mt-1.5">Citations and source passages</p>
      </div>

      {sources.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-10 text-center">
          <p className="text-sm text-ink-muted/90 leading-relaxed max-w-[240px] source-breath">
            Source passages cited in the answer will appear here.
          </p>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto divide-y divide-rule">
          {grouped.map((g, i) => {
            const key = matchKeyOf(g)
            const isExpanded = expandedSourceKey === key
            const isFocused = focusedSource?.key === key
            return (
              <SourceCard
                key={key}
                source={g}
                index={i}
                expanded={isExpanded}
                pulseKey={isFocused ? focusedSource!.nonce : undefined}
                onToggle={() =>
                  setExpandedSourceKey(isExpanded ? null : key)
                }
              />
            )
          })}
        </div>
      )}
    </aside>
  )
}

// CSS.escape polyfill-ish — section_title may contain quotes/colons/etc.
// We only need quote-safety for the attribute selector built above.
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value)
  }
  return value.replace(/["\\]/g, '\\$&')
}
