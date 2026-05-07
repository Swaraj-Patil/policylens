import { useApp } from '../state'
import { matchKeyOf } from '../citations'
import type { Citation } from '../types'

export function CitationChip({
  citation,
  matched,
}: {
  citation: Citation
  matched: boolean
}) {
  const { hoveredMatchKey, setHoveredMatchKey } = useApp()
  const key = matchKeyOf(citation)
  const active = matched && hoveredMatchKey === key

  function enter() {
    if (matched) setHoveredMatchKey(key)
  }
  function leave() {
    if (matched) setHoveredMatchKey(null)
  }

  return (
    <button
      type="button"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      tabIndex={matched ? 0 : -1}
      aria-disabled={!matched}
      title={`${citation.institution}, ${citation.section_title}, ${citation.page_ref}`}
      className={[
        'inline-flex items-baseline gap-1 align-baseline',
        'px-1.5 py-[1px] rounded-sm border',
        'text-[12px] leading-tight',
        'transition-colors duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        matched
          ? active
            ? 'bg-highlight border-accent text-accent'
            : 'border-accent/30 text-accent hover:bg-accent/[0.05] hover:border-accent/55 cursor-pointer'
          : 'border-rule text-ink-muted/85 cursor-default',
      ].join(' ')}
    >
      <span className="font-sans">{citation.section_title}</span>
      <span className="font-mono">{citation.page_ref}</span>
    </button>
  )
}
