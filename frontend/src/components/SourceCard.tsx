import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from '../state'
import { matchKeyOf } from '../citations'
import type { GroupedSource } from '../types'

const HIGH_DIFFICULTY_THRESHOLD = 14
const EASE_OUT_QUART: [number, number, number, number] = [0.16, 1, 0.3, 1]
const PULSE_MS = 1200

export function SourceCard({
  source,
  index,
  expanded,
  onToggle,
  pulseKey,
}: {
  source: GroupedSource
  index: number
  expanded: boolean
  onToggle: () => void
  /** Increments each time focusSource() targets this card. Drives the
   *  attention pulse without re-firing on first mount. */
  pulseKey?: number
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

  // Pulse only on subsequent focusSource() calls — not the initial render.
  // Tracking the last applied nonce in a ref guards against StrictMode's
  // double-invoke and against unrelated re-renders that don't change pulseKey.
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

  return (
    <motion.div
      data-source-key={key}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: active && !expanded ? -1 : 0 }}
      whileHover={!expanded ? { y: -1 } : undefined}
      transition={{
        opacity: { duration: 0.28, ease: EASE_OUT_QUART, delay: index * 0.04 },
        y: { duration: 0.15, ease: EASE_OUT_QUART },
      }}
      onMouseEnter={enter}
      onMouseLeave={leave}
      className={[
        'block w-full text-left border-l-2',
        'transition-colors duration-150',
        active || expanded
          ? 'bg-highlight border-accent'
          : 'border-transparent hover:bg-canvas',
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
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 text-[10px] uppercase tracking-[0.1em] text-ink-muted mb-2">
              <span>{source.institution}</span>
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
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="preview"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT_QUART }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 pt-1 space-y-3">
              {source.excerpts.length > 0 ? (
                source.excerpts.map((excerpt, i) => (
                  <p
                    key={i}
                    className="text-[13px] text-ink-soft leading-[1.65] line-clamp-5"
                    style={{
                      maskImage:
                        'linear-gradient(to bottom, black 70%, transparent 100%)',
                      WebkitMaskImage:
                        'linear-gradient(to bottom, black 70%, transparent 100%)',
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

// Affordance seed for a future PDF/document viewer. Disabled today; the
// styling and copy match how it'd render once wired up, so the layout doesn't
// shift when capability lands.
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
