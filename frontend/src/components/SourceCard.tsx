import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '../state'
import { matchKeyOf } from '../citations'
import { institutionByKey } from '../institutions'
import type { GroupedSource } from '../types'
import { MOTION } from '../motion'

const HIGH_DIFFICULTY_THRESHOLD = 14
const PULSE_MS = 1200

export function SourceCard({
  source,
  rank,
  expanded,
  onToggle,
  pulseKey,
}: {
  source: GroupedSource
  /** 1-based ranking from the retriever — surfaced as a small marker so the
   *  reader knows which result is most relevant without ordering having to
   *  be inferred from layout. */
  rank: number
  expanded: boolean
  onToggle: () => void
  /** Increments each time focusSource() targets this card. */
  pulseKey?: number
}) {
  const { hoveredMatchKey, setHoveredMatchKey } = useApp()
  const key = matchKeyOf(source)
  const inst = institutionByKey(source.institution)
  const active = hoveredMatchKey === key

  const pageRef =
    source.page_start === source.page_end
      ? `p.${source.page_start}`
      : `pp.${source.page_start}–${source.page_end}`

  const fk = source.flesch_kincaid_grade
  const isHighDifficulty = fk !== null && fk > HIGH_DIFFICULTY_THRESHOLD
  const rankLabel = String(rank).padStart(2, '0')

  const [isPulsing, setIsPulsing] = useState(false)
  const lastPulseRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (pulseKey === undefined) return
    if (pulseKey === lastPulseRef.current) return
    lastPulseRef.current = pulseKey
    setIsPulsing(true)
    const t = setTimeout(() => setIsPulsing(false), PULSE_MS)
    return () => clearTimeout(t)
  }, [pulseKey])

  function enter() {
    setHoveredMatchKey(key)
  }
  function leave() {
    setHoveredMatchKey(null)
  }

  // Subtle institution-tinted left edge when the card is the active or
  // hovered document. At rest it's transparent so the inspector reads as a
  // clean list rather than a colored stack.
  const leftEdgeStyle =
    (active || expanded) && inst
      ? { boxShadow: `inset 3px 0 0 ${inst.tintAccent}` }
      : undefined

  return (
    <motion.div
      data-source-key={key}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: active && !expanded ? -1 : 0 }}
      whileHover={!expanded ? { y: -1 } : undefined}
      transition={{
        opacity: { ...MOTION.enter, delay: rank * MOTION.stagger },
        y: MOTION.quick,
      }}
      onMouseEnter={enter}
      onMouseLeave={leave}
      style={leftEdgeStyle}
      className={[
        'block w-full text-left',
        'transition-colors duration-150',
        active || expanded
          ? 'bg-highlight/70'
          : 'hover:bg-canvas/60',
        isPulsing ? 'source-pulse' : '',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onToggle}
        onFocus={enter}
        onBlur={leave}
        aria-expanded={expanded}
        className="block w-full text-left px-5 py-4 cursor-pointer focus:outline-none focus-visible:bg-highlight/40"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="font-mono text-[10px] text-ink-muted/70 leading-snug pt-[3px] select-none w-5 shrink-0"
          >
            {rankLabel}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 text-[10px] uppercase tracking-[0.1em] text-ink-muted mb-2">
              {inst && (
                <span className="inline-flex items-center gap-1">
                  <span
                    aria-hidden
                    className="inline-block w-1 h-1 rounded-full"
                    style={{ backgroundColor: inst.tintDot }}
                  />
                  <span>{source.institution}</span>
                </span>
              )}
              <span aria-hidden className="text-ink-muted/50">·</span>
              <span className="font-mono normal-case tracking-normal">{pageRef}</span>
              {source.count > 1 && (
                <>
                  <span aria-hidden className="text-ink-muted/50">·</span>
                  <span
                    className="font-mono normal-case tracking-normal"
                    title={`${source.count} chunks from this section`}
                  >
                    ×{source.count}
                  </span>
                </>
              )}
            </div>
            <h4 className="text-[14px] font-semibold text-ink leading-snug font-serif-display">
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
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="preview"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={MOTION.layout}
            className="overflow-hidden source-unfold"
          >
            <div className="pl-[44px] pr-5 pb-5 pt-1 space-y-3">
              {source.excerpts.length > 0 ? (
                source.excerpts.map((excerpt, i) => (
                  <p
                    key={i}
                    className="text-[13px] text-ink-soft leading-[1.7] line-clamp-6"
                    style={{
                      maskImage:
                        'linear-gradient(to bottom, black 75%, transparent 100%)',
                      WebkitMaskImage:
                        'linear-gradient(to bottom, black 75%, transparent 100%)',
                    }}
                  >
                    {excerpt}
                  </p>
                ))
              ) : (
                <p className="text-[12px] text-ink-muted italic leading-relaxed">
                  Preview unavailable — open the source document for full context.
                </p>
              )}
              <OpenSourceButton />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function OpenSourceButton() {
  return (
    <button
      type="button"
      disabled
      title="Document viewer coming soon"
      className={
        'inline-flex items-center gap-1.5 mt-1 text-[11px] font-mono uppercase tracking-wider ' +
        'px-2 py-1 rounded-md border border-rule text-ink-muted/85 ' +
        'cursor-not-allowed select-none'
      }
    >
      <span aria-hidden>↗</span>
      <span>Open source section</span>
    </button>
  )
}
