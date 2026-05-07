import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useApp } from '../state'
import type { AnswerBlock, ErrorKind, QueryResponse } from '../types'
import { matchKeyOf, parseAnswerBlocks, tokenizeAnswer } from '../citations'
import { CitationChip } from './CitationChip'

const EXAMPLE_QUERIES = [
  'What are the rules for outside consulting?',
  'How are faculty senate elections conducted?',
  'What protections exist for academic freedom?',
  'What is the grievance procedure for tenure disputes?',
] as const

const STATUS_PHASES = [
  'Searching governance documents…',
  'Analyzing relevant passages…',
  'Synthesizing grounded answer…',
] as const

const EASE_OUT_QUART: [number, number, number, number] = [0.16, 1, 0.3, 1]
const EASE_INOUT_SOFT: [number, number, number, number] = [0.42, 0, 0.58, 1]

// Char-per-second target for the answer stream-in. ~25 chars/frame at 60fps.
const STREAM_CHARS_PER_SECOND = 1500

// Confidence heuristic — phrases that imply the model declined to answer.
// Kept liberal so a soft "I don't have specific information" still de-rates
// the answer's confidence. Matched case-insensitively.
const FALLBACK_PHRASE_RE =
  /\b(i (don'?t|do not) have (enough|specific)|could not (determine|find)|no (relevant|information)|insufficient (information|context)|cannot (determine|answer))\b/i

type ConfidenceLevel = 'high' | 'moderate' | 'limited'

export function CenterPanel() {
  const { currentQuery, runQuery } = useApp()
  const [value, setValue] = useState('')
  const showIdle = currentQuery === null

  const submitQuery = useCallback(
    (q: string) => {
      setValue(q)
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
      <div className="w-full max-w-[680px] mx-auto">
        {showIdle && <IdleHero />}

        <SearchBar value={value} onChange={setValue} onSubmit={submitQuery} />

        <StatusLine />
        <QueryMetaStrip />

        {showIdle && <ExampleChips onSelect={submitQuery} />}
        {!showIdle && <ResultArea />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Idle hero — with a barely-there ambient float
// ---------------------------------------------------------------------------

function IdleHero() {
  const reducedMotion = useReducedMotion()

  // ~6s loop, ±2px — at the edge of perception. Anything more becomes
  // distracting in peripheral vision while a user is reading. Entry fade is
  // opacity-only so the breathing can own the y axis without a "jump-in".
  return (
    <motion.header
      className="text-center mb-12"
      initial={{ opacity: 0 }}
      animate={
        reducedMotion ? { opacity: 1 } : { opacity: 1, y: [0, -2, 0] }
      }
      transition={
        reducedMotion
          ? { duration: 0.45, ease: EASE_OUT_QUART }
          : {
              opacity: { duration: 0.45, ease: EASE_OUT_QUART },
              y: { duration: 6, ease: EASE_INOUT_SOFT, repeat: Infinity },
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
    </motion.header>
  )
}

// ---------------------------------------------------------------------------
// Search bar (with keyboard-first workflow)
// ---------------------------------------------------------------------------

function SearchBar({
  value,
  onChange,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: (q: string) => void
}) {
  const { loading, currentQuery, history, institution } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  const scopedHistory = useMemo(
    () => history.filter((e) => e.institution === institution),
    [history, institution],
  )

  const [historyIndex, setHistoryIndex] = useState(-1)
  const savedValueRef = useRef('')

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (currentQuery !== null && currentQuery !== value) {
      onChange(currentQuery)
    }
  }, [currentQuery, value, onChange])

  useEffect(() => {
    setHistoryIndex(-1)
    savedValueRef.current = ''
  }, [currentQuery])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey

      if (isMod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        inputRef.current?.select()
        return
      }
      if (e.key === '/') {
        const tag = (document.activeElement?.tagName || '').toLowerCase()
        if (tag === 'input' || tag === 'textarea') return
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const q = value.trim()
    if (!q || loading) return
    setHistoryIndex(-1)
    savedValueRef.current = ''
    onSubmit(q)
  }

  function handleInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      if (loading) return
      if (value !== '') {
        e.preventDefault()
        onChange('')
        setHistoryIndex(-1)
        savedValueRef.current = ''
        return
      }
      e.preventDefault()
      inputRef.current?.blur()
      return
    }

    if (e.key === 'ArrowUp') {
      if (loading || scopedHistory.length === 0) return
      const next = historyIndex + 1
      if (next >= scopedHistory.length) return
      e.preventDefault()
      if (historyIndex === -1) savedValueRef.current = value
      setHistoryIndex(next)
      onChange(scopedHistory[next].query)
      return
    }

    if (e.key === 'ArrowDown') {
      if (loading) return
      if (historyIndex === -1) return
      e.preventDefault()
      const next = historyIndex - 1
      setHistoryIndex(next)
      onChange(next === -1 ? savedValueRef.current : scopedHistory[next].query)
      return
    }
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (historyIndex !== -1) setHistoryIndex(-1)
    onChange(e.target.value)
  }

  return (
    <motion.form
      onSubmit={handleSubmit}
      animate={{ scale: focused ? 1.005 : 1 }}
      transition={{ duration: 0.18, ease: EASE_OUT_QUART }}
      className={
        'relative h-14 rounded-lg bg-surface border ' +
        'flex items-center px-4 gap-3 ' +
        'transition-shadow duration-200 ' +
        (focused
          ? 'border-rule-strong shadow-card-hover'
          : 'border-rule shadow-card')
      }
    >
      <SearchIcon className="w-4 h-4 text-ink-muted shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Ask a question about university governance…"
        spellCheck={false}
        autoComplete="off"
        className="flex-1 bg-transparent outline-none text-[15px] text-ink placeholder:text-ink-muted"
      />
      {!focused && value === '' && (
        <kbd className="hidden sm:inline-flex text-[11px] font-mono text-ink-muted px-1.5 py-0.5 rounded border border-rule select-none">
          /
        </kbd>
      )}
    </motion.form>
  )
}

// ---------------------------------------------------------------------------
// Loading status line — cycles through phases beneath the search bar.
// ---------------------------------------------------------------------------

function StatusLine() {
  const { loading } = useApp()
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    if (!loading) {
      setPhase(0)
      return
    }
    const id = setInterval(() => {
      setPhase((p) => (p + 1) % STATUS_PHASES.length)
    }, 1800)
    return () => clearInterval(id)
  }, [loading])

  return (
    <div className="h-5 mt-3 text-center" aria-live="polite">
      <AnimatePresence mode="wait">
        {loading && (
          <motion.p
            key={STATUS_PHASES[phase]}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: EASE_OUT_QUART }}
            className="text-[12px] text-ink-muted tracking-wide"
          >
            {STATUS_PHASES[phase]}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Query metadata strip — institution · sources · elapsed · last updated.
// Sits below the search bar once a query has resolved (success OR error).
// ---------------------------------------------------------------------------

function QueryMetaStrip() {
  const { loading, currentQuery, currentResult, errorKind, elapsedMs, lastUpdatedAt, institution } =
    useApp()

  // Show after a query has been fired and is no longer loading. This covers
  // the success path AND error/empty states — the strip is always informative.
  const visible = !loading && currentQuery !== null

  if (!visible) return null

  const sourceCount = currentResult?.sources?.length ?? 0
  const elapsedLabel = elapsedMs !== null ? formatElapsed(elapsedMs) : null
  const relativeLabel = lastUpdatedAt !== null ? formatRelative(lastUpdatedAt) : null

  const parts: string[] = [institution]
  if (errorKind === null && sourceCount > 0) {
    parts.push(`${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'} retrieved`)
  } else if (errorKind === 'no_results') {
    parts.push('no sources retrieved')
  }
  if (elapsedLabel) parts.push(`searched in ${elapsedLabel}`)
  if (relativeLabel && errorKind === null) parts.push(relativeLabel)

  return (
    <motion.div
      key={`${currentQuery}-${lastUpdatedAt}`}
      initial={{ opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT_QUART, delay: 0.4 }}
      className="mt-3 text-center text-[11px] text-ink-muted tracking-wide select-none"
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
  return 'earlier'
}

// ---------------------------------------------------------------------------
// Example chips with institution-aware preview
// ---------------------------------------------------------------------------

function ExampleChips({ onSelect }: { onSelect: (q: string) => void }) {
  const { institution } = useApp()
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: EASE_OUT_QUART, delay: 0.25 }}
      className="flex flex-wrap gap-2 mt-5 justify-center"
    >
      {EXAMPLE_QUERIES.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => onSelect(q)}
          title={`Search ${institution}`}
          className="group relative text-xs text-ink-soft px-3 py-1.5 rounded-md border border-rule bg-surface hover:border-rule-strong hover:bg-canvas hover:text-ink hover:-translate-y-px transition-all duration-150 cursor-pointer"
        >
          {q}
          <span
            className="pointer-events-none absolute -top-2 -right-2 text-[9px] font-mono uppercase tracking-wider px-1.5 py-px rounded bg-surface text-ink-soft border border-rule opacity-0 group-hover:opacity-100 transition-opacity duration-150"
            aria-hidden
          >
            {institution}
          </span>
        </button>
      ))}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Result area — dispatches between skeleton, error, empty, and answer.
// ---------------------------------------------------------------------------

function ResultArea() {
  const { loading, currentResult, errorKind } = useApp()

  return (
    <div className="mt-8">
      {loading && <AnswerSkeleton />}
      {!loading && errorKind && <EmptyView kind={errorKind} />}
      {!loading && !errorKind && currentResult && <AnswerView result={currentResult} />}
    </div>
  )
}

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
// Streaming answer view
// ---------------------------------------------------------------------------

function AnswerView({ result }: { result: QueryResponse }) {
  const reducedMotion = useReducedMotion()
  const fullAnswer = result.answer
  const articleRef = useRef<HTMLElement>(null)
  const [revealedLength, setRevealedLength] = useState(
    reducedMotion ? fullAnswer.length : 0,
  )

  useEffect(() => {
    if (reducedMotion) {
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
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [fullAnswer, reducedMotion])

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
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE_OUT_QUART }}
      className="group relative text-[16px] leading-[1.75] text-ink"
    >
      <div className="mb-5">
        <ConfidencePill level={confidence} />
      </div>
      <CopyButton text={fullAnswer} disabled={!fullyRevealed} />

      <EvidenceRail
        articleRef={articleRef}
        revealedLength={revealedLength}
        enabled={fullyRevealed}
      />

      <div className="space-y-5">
        {body.map((block, i) => (
          <BlockView key={`b-${i}`} block={block} sourceKeys={sourceKeys} />
        ))}
      </div>

      {footer !== null && (
        <div className="mt-8 pt-5 border-t border-rule">
          <div className="text-[13px] text-ink-soft leading-[1.65]">
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
      <h3 className="text-[17px] font-semibold tracking-tight text-ink mt-1 leading-snug">
        <InlineRender text={block.text} sourceKeys={sourceKeys} />
      </h3>
    )
  }
  return (
    <ul className="list-disc list-outside pl-5 space-y-2 marker:text-ink-muted">
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

  // Editorial palette — indigo tint = high, slate fill = moderate, faint
  // outline = limited. No green/yellow/red, no percentages, no AI language.
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
// Evidence rail — minimap-style margin annotation aligned to citation Y-pos.
// Renders dots at the vertical position of each matched citation chip in the
// article. Hovering a dot lights up the corresponding source-card link;
// clicking it opens that source. Hidden until the answer fully reveals so
// dots don't shift around mid-stream.
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
            className={
              'absolute left-0 -translate-y-1/2 w-3 h-3 flex items-center justify-center ' +
              'cursor-pointer'
            }
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
// Copy button (top-right of answer, hover-revealed)
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
        'absolute -top-1 right-0 text-[11px] font-mono uppercase tracking-wider ' +
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
// Empty / error states — differentiated by ErrorKind. Each case has its own
// tone and helper line; we never expose stack traces or HTTP codes.
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
  // Entry fade is JS (so it can be staggered later if needed), but the
  // ambient breathing is CSS — keeps the animation type-clean and respects
  // prefers-reduced-motion via the global media query in index.css.
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE_OUT_QUART }}
      className="text-center max-w-[440px] mx-auto py-10"
    >
      <p className="text-[15px] text-ink leading-snug source-breath">{copy.headline}</p>
      <p className="text-[13px] text-ink-soft leading-relaxed mt-3">{copy.helper}</p>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Inline icon
// ---------------------------------------------------------------------------

function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}
