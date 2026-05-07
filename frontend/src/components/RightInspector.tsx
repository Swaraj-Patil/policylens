import { useApp } from '../state'
import { SourceCard } from './SourceCard'

export function RightInspector() {
  const { currentResult } = useApp()
  const sources = currentResult?.sources ?? []

  return (
    <aside className="w-[360px] shrink-0 border-l border-rule bg-surface flex flex-col">
      <div className="px-5 py-5 border-b border-rule">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[13px] font-semibold tracking-tight text-ink">Sources</h2>
          {sources.length > 0 && (
            <span className="text-[11px] font-mono text-ink-muted">{sources.length}</span>
          )}
        </div>
        <p className="text-xs text-ink-soft mt-0.5">Citations and source passages</p>
      </div>

      {sources.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-8 text-center">
          <p className="text-sm text-ink-muted leading-relaxed">
            Source passages will appear here after a search.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {sources.map((s, i) => (
            <SourceCard
              key={`${s.institution}::${s.section_title}::${i}`}
              source={s}
              index={i}
            />
          ))}
        </div>
      )}
    </aside>
  )
}
