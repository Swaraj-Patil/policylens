import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useApp } from '../state'
import type { AnswerBlock, AnswerEntry, ErrorKind, QueryResponse } from '../types'
import { matchKeyOf, parseAnswerBlocks, tokenizeAnswer } from '../citations'
import { institutionByKey } from '../institutions'
import { CitationChip } from './CitationChip'
import { SearchComposer } from './SearchComposer'
import { MOTION } from '../motion'

const EXAMPLE_QUERIES = [
  'What are the rules for outside consulting?',
  'How are faculty senate elections conducted?',
  'What protections exist for academic freedom?',
  'What is the grievance procedure for tenure disputes?',
  'What accommodations are available for students with disabilities?',
] as const

const STATUS_PHASES_FAST = [
  'Searching governance documents…',
  'Analyzing relevant passages…',
  'Synthesizing grounded answer…',
] as const

const STATUS_PHASE_LONG =
  'Large language model is reasoning over retrieved passages…'
const STATUS_PHASE_VERY_LONG =
  'Still working — some institutional documents are lengthy.'

// Char-per-second target for the answer stream-in. ~25 chars/frame at 60fps.
const STREAM_CHARS_PER_SECOND = 1500

const FALLBACK_PHRASE_RE =
  /\b(i (don'?t|do not) have (enough|specific)|could not (determine|find)|no (relevant|information)|insufficient (information|context)|cannot (determine|answer))\b/i

type ConfidenceLevel = 'high' | 'moderate' | 'limited'

// ---------------------------------------------------------------------------
// CenterPanel — composer + idle hero OR composer + answer stack.
// ---------------------------------------------------------------------------

export function CenterPanel() {
  const { entries, runQuery, institution } = useApp()
  const [composerValue, setComposerValue] = useState('')
  const showIdle = entries.length === 0

  // Clear the composer when the user switches institutions. The timeline and
  // active entry are preserved (each entry remembers its own institution),
  // but the in-progress draft belongs to the prior context and shouldn't
  // bleed into the new one.
  const prevInstRef = useRef(institution)
  useEffect(() => {
    if (prevInstRef.current !== institution) {
      setComposerValue('')
      prevInstRef.current = institution
    }
  }, [institution])

  const submitQuery = useCallback(
    (q: string) => {
      setComposerValue(q)
      runQuery(q)
    },
    [runQuery],
  )

  return (
    <div
      className={
        'min-h-full flex flex-col px-8 ' +
        (showIdle ? 'items-center justify-center py-16' : 'py-10')
      }
    >
      <div className="w-full max-w-[720px] mx-auto">
        {showIdle && <IdleHero onSelect={submitQuery} />}

        <SearchComposer
          value={composerValue}
          onChange={setComposerValue}
          onSubmit={submitQuery}
        />

        <StatusLine />

        {!showIdle && <AnswerStack />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Idle hero — rotating example queries with institution tag. "Try asking…"
// presentation, ambient breath. Single visible query at a time so the eye
// doesn't have to scan a chip cloud.
// ---------------------------------------------------------------------------

function IdleHero({ onSelect }: { onSelect: (q: string) => void }) {
  const reducedMotion = useReducedMotion()
  const { institution } = useApp()
  const inst = institutionByKey(institution)
  const [exampleIdx, setExampleIdx] = useState(0)

  // Rotate every 4.5s. Reduced-motion users see the static first example
  // (no rotation, no breathing).
  useEffect(() => {
    if (reducedMotion) return
    const id = setInterval(() => {
      setExampleIdx((i) => (i + 1) % EXAMPLE_QUERIES.length)
    }, 4500)
    return () => clearInterval(id)
  }, [reducedMotion])

  const example = EXAMPLE_QUERIES[exampleIdx]

  return (
    <motion.header
      className="text-center mb-10"
      initial={{ opacity: 0 }}
      animate={
        reducedMotion ? { opacity: 1 } : { opacity: 1, y: [0, -2, 0] }
      }
      transition={
        reducedMotion
          ? { duration: 0.45, ease: MOTION.ease }
          : {
              opacity: { duration: 0.45, ease: MOTION.ease },
              y: { duration: 6, ease: MOTION.easeInOut, repeat: Infinity },
            }
      }
    >
      <h2 className="text-[30px] leading-[1.18] font-semibold tracking-tight text-ink">
        Ask a question about university governance documents.
      </h2>
      <p className="text-[15px] text-ink-soft mt-4 leading-relaxed max-w-[480px] mx-auto">
        Plain-language search across institutional governance documents. Answers
        cite the exact section and page they come from.
      </p>

      <div className="mt-9">
        <p className="text-[10px] uppercase tracking-[0.18em] text-ink-muted mb-3">
          Try asking
        </p>
        <div className="h-12 relative" aria-live="polite">
          <AnimatePresence mode="wait">
            <motion.button
              key={example}
              type="button"
              onClick={() => onSelect(example)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.35, ease: MOTION.ease }}
              className="group absolute inset-0 inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <span className="text-[15px] text-ink-soft group-hover:text-ink transition-colors duration-150 italic">
                "{example}"
              </span>
              {inst && (
                <span
                  aria-hidden
                  className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border border-rule text-ink-muted opacity-70 group-hover:opacity-100 transition-opacity duration-150"
                >
                  <span
                    className="inline-block w-1 h-1 rounded-full"
                    style={{ backgroundColor: inst.tintDot }}
                  />
                  {inst.short}
                </span>
              )}
            </motion.button>
          </AnimatePresence>
        </div>
      </div>
    </motion.header>
  )
}

// ---------------------------------------------------------------------------
// Smart status line — phases react to elapsed time. <8s cycles the original
// three; 8–20s settles on the "model is reasoning" line; 20s+ acknowledges
// the wait.
// ---------------------------------------------------------------------------

function StatusLine() {
  const { loading } = useApp()
  const [phase, setPhase] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const startedAtRef = useRef<number>(0)

  useEffect(() => {
    if (!loading) {
      setPhase(0)
      setElapsed(0)
      return
    }
    startedAtRef.current = Date.now()
    setElapsed(0)
    setPhase(0)
    const phaseTimer = setInterval(() => {
      setPhase((p) => (p + 1) % STATUS_PHASES_FAST.length)
    }, 1800)
    const elapsedTimer = setInterval(() => {
      setElapsed(Date.now() - startedAtRef.current)
    }, 500)
    return () => {
      clearInterval(phaseTimer)
      clearInterval(elapsedTimer)
    }
  }, [loading])

  const message = useMemo(() => {
    if (elapsed >= 20_000) return STATUS_PHASE_VERY_LONG
    if (elapsed >= 8_000) return STATUS_PHASE_LONG
    return STATUS_PHASES_FAST[phase]
  }, [elapsed, phase])

  return (
    <div className="h-5 mt-3 text-center" aria-live="polite">
      <AnimatePresence mode="wait">
        {loading && (
          <motion.p
            key={message}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={MOTION.quick}
            className="text-[12px] text-ink-muted tracking-wide"
          >
            {message}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Answer stack — newest at top. Active entry expanded; older ones collapse
// into a one-line glance card that activates on click.
// ---------------------------------------------------------------------------

function AnswerStack() {
  const { entries, activeEntryId } = useApp()
  return (
    <div className="mt-8 space-y-4">
      <AnimatePresence initial={false}>
        {entries.map((entry, i) => (
          <motion.div
            key={entry.id}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{
              ...MOTION.enter,
              delay: i === 0 ? 0 : Math.min(i * MOTION.stagger, 0.2),
            }}
          >
            <AnswerCard
              entry={entry}
              isActive={entry.id === activeEntryId}
              isNewest={i === 0}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

function AnswerCard({
  entry,
  isActive,
}: {
  entry: AnswerEntry
  isActive: boolean
  isNewest: boolean
}) {
  const { setActiveEntryId } = useApp()
  const inst = institutionByKey(entry.institution)
  const borderColor = isActive ? inst?.tintAccent : 'transparent'

  if (!isActive) {
    return <CollapsedAnswerCard entry={entry} onActivate={() => setActiveEntryId(entry.id)} />
  }

  return (
    <motion.section
      layout
      style={{ borderLeftColor: borderColor }}
      className={
        'relative rounded-md bg-surface border border-rule shadow-card ' +
        'border-l-2 px-7 py-6 ' +
        'transition-shadow duration-200'
      }
    >
      <ActiveQueryHeader entry={entry} />
      <ActiveAnswerBody entry={entry} />
    </motion.section>
  )
}

function ActiveQueryHeader({ entry }: { entry: AnswerEntry }) {
  return (
    <div className="mb-5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">
        Question
      </p>
      <h3 className="text-[18px] font-semibold tracking-tight text-ink leading-snug mt-1.5">
        {entry.query}
      </h3>
      <QueryMetaStrip entry={entry} />
    </div>
  )
}

function ActiveAnswerBody({ entry }: { entry: AnswerEntry }) {
  const { loading } = useApp()
  if (loading && !entry.result && !entry.errorKind) {
    return <AnswerSkeleton />
  }
  if (entry.errorKind) {
    return <EmptyView kind={entry.errorKind} />
  }
  if (entry.result) {
    return <AnswerView entry={entry} />
  }
  return null
}

// ---------------------------------------------------------------------------
// Collapsed card — shows query + small confidence dot + source count + when.
// One row, clickable, subtle hover lift. Reads as a research-session log row
// rather than a chat bubble.
// ---------------------------------------------------------------------------

function CollapsedAnswerCard({
  entry,
  onActivate,
}: {
  entry: AnswerEntry
  onActivate: () => void
}) {
  const inst = institutionByKey(entry.institution)
  const sourceCount = entry.result?.sources?.length ?? 0
  const confidence = entry.result ? computeConfidence(entry.result) : null
  const dotColor =
    confidence === 'high'
      ? 'bg-accent'
      : confidence === 'moderate'
        ? 'bg-ink-muted'
        : 'bg-ink-muted/40'

  const elapsedLabel = entry.elapsedMs !== null ? formatElapsed(entry.elapsedMs) : null
  const tag =
    entry.errorKind === 'no_results'
      ? 'no sources'
      : entry.errorKind
        ? 'error'
        : `${sourceCount} source${sourceCount === 1 ? '' : 's'}`

  return (
    <motion.button
      type="button"
      onClick={onActivate}
      whileHover={{ y: -1 }}
      transition={MOTION.quick}
      className={
        'group block w-full text-left rounded-md bg-surface/80 border border-rule ' +
        'px-5 py-3 cursor-pointer ' +
        'hover:border-rule-strong hover:bg-surface hover:shadow-card ' +
        'transition-[background,border,box-shadow] duration-200'
      }
      title="Open this answer"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1 flex items-center gap-3">
          {confidence ? (
            <span
              aria-hidden
              className={'inline-block w-1.5 h-1.5 rounded-full shrink-0 ' + dotColor}
            />
          ) : (
            <span aria-hidden className="inline-block w-1.5 h-1.5 rounded-full shrink-0 bg-ink-muted/30" />
          )}
          <span className="text-[14px] text-ink truncate group-hover:text-ink">
            {entry.query}
          </span>
        </div>
        <div className="shrink-0 flex items-center gap-2 text-[11px] text-ink-muted font-mono">
          {inst && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-rule"
              title={inst.label}
            >
              <span
                aria-hidden
                className="inline-block w-1 h-1 rounded-full"
                style={{ backgroundColor: inst.tintDot }}
              />
              <span className="uppercase tracking-wider">{inst.short}</span>
            </span>
          )}
          <span>{tag}</span>
          {elapsedLabel && (
            <>
              <span aria-hidden className="text-ink-muted/40">·</span>
              <span>{elapsedLabel}</span>
            </>
          )}
        </div>
      </div>
    </motion.button>
  )
}

// ---------------------------------------------------------------------------
// Query metadata strip — institution · sources · elapsed · last updated.
// Lives inside each ActiveQueryHeader (per-entry) so its info doesn't slide
// when the active entry changes.
// ---------------------------------------------------------------------------

function QueryMetaStrip({ entry }: { entry: AnswerEntry }) {
  const sourceCount = entry.result?.sources?.length ?? 0
  const elapsedLabel = entry.elapsedMs !== null ? formatElapsed(entry.elapsedMs) : null
  const relativeLabel =
    entry.completedAt !== null ? formatRelative(entry.completedAt) : null

  const parts: string[] = [entry.institution]
  if (entry.errorKind === null && sourceCount > 0) {
    parts.push(`${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'} retrieved`)
  } else if (entry.errorKind === 'no_results') {
    parts.push('no sources retrieved')
  }
  if (elapsedLabel) parts.push(`searched in ${elapsedLabel}`)
  if (relativeLabel && entry.errorKind === null) parts.push(relativeLabel)

  if (entry.completedAt === null && entry.errorKind === null) {
    // In-flight — strip is empty. The status line covers state.
    return null
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: MOTION.ease, delay: 0.4 }}
      className="mt-3 text-[11px] text-ink-muted tracking-wide select-none"
    >
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden className="mx-2 text-ink-muted/50">·</span>}
          <span>{p}</span>
        </Fragment>
      ))}
    </motion.div>
  )
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 30_000) return 'just now'
  if (diff < 60_000) return 'less than a minute ago'
  const min = Math.floor(diff / 60_000)
  if (min < 60) return `${min} min ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} hr ago`
  return 'earlier'
}

// ---------------------------------------------------------------------------
// Skeleton (loading)
// ---------------------------------------------------------------------------

function AnswerSkeleton() {
  const main = ['92%', '100%', '88%', '76%']
  const footer = ['54%', '38%']
  let delay = 0
  return (
    <div className="space-y-7" aria-busy="true" aria-live="polite">
      <div className="space-y-3">
        {main.map((w, i) => {
          const d = delay
          delay += 80
          return <SkeletonLine key={`m-${i}`} width={w} delay={d} />
        })}
      </div>
      <div className="space-y-3">
        {footer.map((w, i) => {
          const d = delay
          delay += 80
          return <SkeletonLine key={`f-${i}`} width={w} delay={d} />
        })}
      </div>
    </div>
  )
}

function SkeletonLine({ width, delay }: { width: string; delay: number }) {
  return (
    <div
      className="h-3 rounded-md skeleton-line"
      style={{ width, animationDelay: `${delay}ms` }}
    />
  )
}

// ---------------------------------------------------------------------------
// Streaming answer view — per-entry. Streams once (via entry.streamed flag),
// then renders fully revealed on every subsequent activation/reload.
// ---------------------------------------------------------------------------

function AnswerView({ entry }: { entry: AnswerEntry }) {
  const reducedMotion = useReducedMotion()
  const { markEntryStreamed } = useApp()
  const result = entry.result!
  const fullAnswer = result.answer
  const articleRef = useRef<HTMLElement>(null)

  const skipReveal = reducedMotion || entry.streamed
  const [revealedLength, setRevealedLength] = useState(
    skipReveal ? fullAnswer.length : 0,
  )

  useEffect(() => {
    if (skipReveal) {
      setRevealedLength(fullAnswer.length)
      return
    }
    setRevealedLength(0)
    let raf = 0
    let startTime: number | null = null

    function tick(now: number) {
      if (startTime === null) startTime = now
      const elapsed = (now - startTime) / 1000
      const target = Math.min(
        Math.ceil(elapsed * STREAM_CHARS_PER_SECOND),
        fullAnswer.length,
      )
      setRevealedLength(target)
      if (target < fullAnswer.length) {
        raf = requestAnimationFrame(tick)
      } else {
        markEntryStreamed(entry.id)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [fullAnswer, skipReveal, entry.id, markEntryStreamed])

  const visibleAnswer = useMemo(
    () => fullAnswer.slice(0, revealedLength),
    [fullAnswer, revealedLength],
  )
  const blocks = useMemo(
    () => parseAnswerBlocks(visibleAnswer),
    [visibleAnswer],
  )
  const sourceKeys = useMemo(
    () => new Set(result.sources.map(matchKeyOf)),
    [result.sources],
  )

  const fullyRevealed = revealedLength >= fullAnswer.length
  const footerIdx = fullyRevealed
    ? blocks.findIndex(
        (b) =>
          b.type === 'paragraph' && b.text.toLowerCase().startsWith('where to read more'),
      )
    : -1
  const hasFooter = footerIdx >= 0
  const body = hasFooter ? blocks.slice(0, footerIdx) : blocks
  const footer = hasFooter ? blocks[footerIdx] : null

  const confidence = useMemo(() => computeConfidence(result), [result])

  return (
    <motion.article
      ref={articleRef}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={MOTION.enter}
      className="group relative text-[16px] leading-[1.78] text-ink"
    >
      <div className="mb-5 flex items-center justify-between gap-3">
        <ConfidencePill level={confidence} />
        <CopyButton text={fullAnswer} disabled={!fullyRevealed} />
      </div>

      <EvidenceRail
        articleRef={articleRef}
        revealedLength={revealedLength}
        enabled={fullyRevealed}
      />

      <div className="space-y-6">
        {body.map((block, i) => (
          <BlockView key={`b-${i}`} block={block} sourceKeys={sourceKeys} />
        ))}
      </div>

      {footer !== null && (
        <div className="mt-8 pt-5 border-t border-rule">
          <div className="text-[13px] text-ink-soft leading-[1.7]">
            <BlockView block={footer} sourceKeys={sourceKeys} />
          </div>
        </div>
      )}
    </motion.article>
  )
}

function BlockView({
  block,
  sourceKeys,
}: {
  block: AnswerBlock
  sourceKeys: Set<string>
}) {
  if (block.type === 'paragraph') {
    return (
      <p>
        <InlineRender text={block.text} sourceKeys={sourceKeys} />
      </p>
    )
  }
  if (block.type === 'heading') {
    return (
      <h3 className="text-[18px] font-semibold tracking-[-0.005em] text-ink mt-2 leading-snug font-serif-display">
        <InlineRender text={block.text} sourceKeys={sourceKeys} />
      </h3>
    )
  }
  return (
    <ul className="list-disc list-outside pl-5 space-y-2.5 marker:text-ink-muted">
      {block.items.map((item, i) => (
        <li key={i} className="pl-1">
          <InlineRender text={item} sourceKeys={sourceKeys} />
        </li>
      ))}
    </ul>
  )
}

function InlineRender({
  text,
  sourceKeys,
}: {
  text: string
  sourceKeys: Set<string>
}) {
  const tokens = useMemo(() => tokenizeAnswer(text), [text])
  return (
    <>
      {tokens.map((token, ti) => {
        if (token.type === 'text') {
          return <span key={ti}>{token.text}</span>
        }
        if (token.type === 'bold') {
          return (
            <strong key={ti} className="font-semibold text-ink">
              {token.text}
            </strong>
          )
        }
        return (
          <Fragment key={ti}>
            {token.items.map((cit, ci) => (
              <CitationChip
                key={ci}
                citation={cit}
                matched={sourceKeys.has(matchKeyOf(cit))}
              />
            ))}
          </Fragment>
        )
      })}
    </>
  )
}

// ---------------------------------------------------------------------------
// Confidence pill
// ---------------------------------------------------------------------------

function computeConfidence(result: QueryResponse): ConfidenceLevel {
  const ans = result.answer
  if (FALLBACK_PHRASE_RE.test(ans)) return 'limited'
  const citationCount = (ans.match(/\[[^\]]+\]/g) || []).length
  const sourceCount = result.sources.length
  const ansLen = ans.length
  if (citationCount === 0 || sourceCount === 0) return 'limited'
  if (sourceCount >= 3 && citationCount >= 2 && ansLen > 200) return 'high'
  return 'moderate'
}

function ConfidencePill({ level }: { level: ConfidenceLevel }) {
  const label =
    level === 'high'
      ? 'High confidence'
      : level === 'moderate'
        ? 'Moderate confidence'
        : 'Limited evidence'

  const cls =
    level === 'high'
      ? 'bg-accent/10 text-accent-strong border-accent/20'
      : level === 'moderate'
        ? 'bg-canvas text-ink-soft border-rule-strong'
        : 'bg-transparent text-ink-muted border-rule'

  const tooltip =
    level === 'high'
      ? 'Multiple sources retrieved with strong citation density.'
      : level === 'moderate'
        ? 'Answer is grounded but evidence is partial.'
        : 'Limited supporting evidence — read carefully or rephrase.'

  return (
    <span
      title={tooltip}
      className={
        'inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase ' +
        'tracking-[0.1em] px-2 py-0.5 rounded-full border ' +
        cls
      }
    >
      <span
        aria-hidden
        className={
          'inline-block w-1.5 h-1.5 rounded-full ' +
          (level === 'high'
            ? 'bg-accent'
            : level === 'moderate'
              ? 'bg-ink-muted'
              : 'bg-ink-muted/40')
        }
      />
      {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Evidence rail
// ---------------------------------------------------------------------------

type RailMarker = { key: string; top: number }

function EvidenceRail({
  articleRef,
  revealedLength,
  enabled,
}: {
  articleRef: RefObject<HTMLElement | null>
  revealedLength: number
  enabled: boolean
}) {
  const { focusSource, hoveredMatchKey, setHoveredMatchKey } = useApp()
  const [markers, setMarkers] = useState<RailMarker[]>([])

  useLayoutEffect(() => {
    if (!enabled) {
      setMarkers([])
      return
    }
    const root = articleRef.current
    if (!root) return

    function recompute() {
      if (!root) return
      const chips = root.querySelectorAll<HTMLElement>('[data-cite-key]')
      const articleRect = root.getBoundingClientRect()
      const next: RailMarker[] = []
      chips.forEach((chip) => {
        const r = chip.getBoundingClientRect()
        const top = r.top - articleRect.top + r.height / 2
        const key = chip.getAttribute('data-cite-key')
        if (key) next.push({ key, top })
      })
      setMarkers(next)
    }

    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(root)
    window.addEventListener('resize', recompute)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', recompute)
    }
  }, [enabled, revealedLength, articleRef])

  if (!enabled || markers.length === 0) return null

  return (
    <div
      aria-hidden
      className="hidden lg:block absolute -right-7 top-0 bottom-0 w-3"
    >
      <div className="absolute top-1 bottom-1 left-1 w-px bg-rule" />
      {markers.map((m, i) => {
        const active = hoveredMatchKey === m.key
        return (
          <button
            key={`${m.key}-${i}`}
            type="button"
            onClick={() => focusSource(m.key)}
            onMouseEnter={() => setHoveredMatchKey(m.key)}
            onMouseLeave={() => setHoveredMatchKey(null)}
            title={m.key.split('::')[1] ?? 'Source'}
            style={{ top: m.top }}
            className="absolute left-0 -translate-y-1/2 w-3 h-3 flex items-center justify-center cursor-pointer"
          >
            <span
              className={
                'block w-1.5 h-1.5 rounded-full transition-all duration-150 ' +
                (active
                  ? 'bg-accent scale-125'
                  : 'bg-accent/45 hover:bg-accent/80')
              }
            />
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

function CopyButton({ text, disabled = false }: { text: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (disabled) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      console.error('[PolicyLens] Copy failed:', err)
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      aria-label="Copy answer"
      className={
        'text-[11px] font-mono uppercase tracking-wider ' +
        'px-2 py-1 rounded-md border border-rule bg-surface text-ink-muted ' +
        'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 ' +
        'hover:text-ink hover:border-rule-strong ' +
        'transition-opacity duration-150 cursor-pointer ' +
        'disabled:opacity-0 disabled:cursor-default'
      }
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Empty / error states
// ---------------------------------------------------------------------------

const EMPTY_COPY: Record<
  ErrorKind,
  { headline: string; helper: string }
> = {
  no_results: {
    headline: 'No relevant passages were retrieved for this query.',
    helper:
      'Try rephrasing in plain language, or broaden the question — the indexed handbook may not cover this topic directly.',
  },
  backend_unavailable: {
    headline: 'The backend service is not reachable.',
    helper: 'Start the FastAPI server (uvicorn app.main:app) and retry.',
  },
  llm_unavailable: {
    headline: 'The local language model is unavailable.',
    helper:
      'Start Ollama (ollama serve) and verify the model is pulled, then retry.',
  },
  timeout: {
    headline: 'The query took too long to complete.',
    helper:
      'Local inference can be slow on cold starts. Retry — the second attempt is usually faster.',
  },
  unknown: {
    headline: 'Something went wrong while answering this query.',
    helper: 'Retry the query. If the issue persists, check the server logs.',
  },
}

function EmptyView({ kind }: { kind: ErrorKind }) {
  const copy = EMPTY_COPY[kind]
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={MOTION.enter}
      className="text-center max-w-[440px] mx-auto py-8"
    >
      <p className="text-[15px] text-ink leading-snug source-breath">{copy.headline}</p>
      <p className="text-[13px] text-ink-soft leading-relaxed mt-3">{copy.helper}</p>
    </motion.div>
  )
}
