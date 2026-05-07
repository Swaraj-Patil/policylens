import type { Dispatch, SetStateAction } from 'react'
import { useApp } from '../state'
import { ResizeHandle } from './ResizeHandle'
import { SourceCard } from './SourceCard'

type Props = {
  width: number
  minWidth: number
  maxWidth: number
  setWidth: Dispatch<SetStateAction<number>>
}

export function RightInspector({ width, minWidth, maxWidth, setWidth }: Props) {
  const { currentResult } = useApp()
  const sources = currentResult?.sources ?? []

  function handleResize(dx: number) {
    // Right panel grows when its left edge moves leftward (negative dx).
    setWidth((w) => Math.max(minWidth, Math.min(maxWidth, w - dx)))
  }

  return (
    <aside
      style={{ width: `${width}px` }}
      className="shrink-0 border-l border-rule bg-surface flex flex-col relative"
    >
      <ResizeHandle edge="left" onDelta={handleResize} />

      <div className="px-5 py-5 border-b border-rule">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-soft">
            Sources
          </h2>
          {sources.length > 0 && (
            <span className="text-[11px] font-mono text-ink-muted">{sources.length}</span>
          )}
        </div>
        <p className="text-[13px] font-medium text-ink mt-1.5">Citations and source passages</p>
      </div>

      {sources.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-10 text-center">
          <p className="text-sm text-ink-muted/90 leading-relaxed max-w-[240px]">
            Source passages cited in the answer will appear here.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-rule">
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
