import { motion } from 'framer-motion'
import { useApp } from '../state'
import { matchKeyOf } from '../citations'
import type { SourceInfo } from '../types'

const HIGH_DIFFICULTY_THRESHOLD = 14
const EASE_OUT_QUART: [number, number, number, number] = [0.16, 1, 0.3, 1]

export function SourceCard({
  source,
  index,
}: {
  source: SourceInfo
  index: number
}) {
  const { hoveredMatchKey, setHoveredMatchKey } = useApp()
  const key = matchKeyOf(source)
  const active = hoveredMatchKey === key

  const pageRef =
    source.page_start === source.page_end
      ? `p.${source.page_start}`
      : `pp.${source.page_start}–${source.page_end}`

  const fk = source.flesch_kincaid_grade
  const isHighDifficulty = fk !== null && fk > HIGH_DIFFICULTY_THRESHOLD

  function enter() {
    setHoveredMatchKey(key)
  }
  function leave() {
    setHoveredMatchKey(null)
  }

  return (
    <motion.button
      type="button"
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: active ? -1 : 0 }}
      whileHover={{ y: -1 }}
      transition={{
        opacity: { duration: 0.28, ease: EASE_OUT_QUART, delay: index * 0.04 },
        y: { duration: 0.15, ease: EASE_OUT_QUART },
      }}
      className={[
        'block w-full text-left px-5 py-4 border-l-2',
        'transition-colors duration-150',
        'focus:outline-none',
        active
          ? 'bg-highlight border-accent'
          : 'border-transparent hover:bg-canvas',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-[10px] uppercase tracking-[0.1em] text-ink-muted mb-2">
            <span>{source.institution}</span>
            <span aria-hidden className="text-ink-muted/50">·</span>
            <span className="font-mono normal-case tracking-normal">{pageRef}</span>
          </div>
          <h4 className="text-[14px] font-semibold text-ink leading-snug">
            {source.section_title}
          </h4>
        </div>
        {isHighDifficulty && (
          <span
            className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border border-rule text-ink-muted"
            title={`Flesch-Kincaid grade ${fk!.toFixed(1)} — high reading difficulty`}
          >
            FK&nbsp;{fk!.toFixed(0)}
          </span>
        )}
      </div>
    </motion.button>
  )
}
