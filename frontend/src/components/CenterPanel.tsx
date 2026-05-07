import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useApp } from '../state'
import type { AnswerBlock, QueryResponse } from '../types'
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

// Char-per-second target for the answer stream-in. ~25 chars/frame at 60fps.
const STREAM_CHARS_PER_SECOND = 1500

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

        {showIdle && <ExampleChips onSelect={submitQuery} />}
        {!showIdle && <ResultArea />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Idle hero
// ---------------------------------------------------------------------------

function IdleHero() {
  return (
    <header className="text-center mb-12">
      <h2 className="text-[30px] leading-[1.18] font-semibold tracking-tight text-ink">
        Ask a question about university governance documents.
      </h2>
      <p className="text-[15px] text-ink-soft mt-4 leading-relaxed max-w-[480px] mx-auto">
        Plain-language search across institutional governance documents. Answers
        cite the exact section and page they come from.
      </p>
    </header>
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

  // Only the current institution's history is navigable from the input —
  // matches what's shown in the sidebar so Up/Down maps to "what I see".
  const scopedHistory = useMemo(
    () => history.filter((e) => e.institution === institution),
    [history, institution],
  )

  // History navigation state. -1 means "user's current input", 0..N indexes
  // into scopedHistory. savedValue holds whatever the user had typed so we
  // can restore it when they navigate back past index 0.
  const [historyIndex, setHistoryIndex] = useState(-1)
  const savedValueRef = useRef('')

  // Auto-focus input on first mount.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Sync local input with currentQuery on external triggers (history click,
  // chip click). Skip when typing locally — onChange handles that path.
  useEffect(() => {
    if (currentQuery !== null && currentQuery !== value) {
      onChange(currentQuery)
    }
  }, [currentQuery, value, onChange])

  // Reset history-nav state whenever the result changes — a new submission
  // ends the navigation session.
  useEffect(() => {
    setHistoryIndex(-1)
    savedValueRef.current = ''
  }, [currentQuery])

  // Global shortcuts:
  //   "/"               focus input (skipped while another input is focused)
  //   Cmd/Ctrl + K      focus input from anywhere
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

  // Input-local keyboard handling. Esc + arrows are scoped to the input so
  // they don't fight with the rest of the page.
  function handleInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      // Two-step Esc: first press clears any text; second press blurs.
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
      if (next >= scopedHistory.length) return // already at oldest
      e.preventDefault()
      if (historyIndex === -1) savedValueRef.current = value
      setHistoryIndex(next)
      onChange(scopedHistory[next].query)
      return
    }

    if (e.key === 'ArrowDown') {
      if (loading) return
      if (historyIndex === -1) return // nothing to walk back to
      e.preventDefault()
      const next = historyIndex - 1
      setHistoryIndex(next)
      onChange(next === -1 ? savedValueRef.current : scopedHistory[next].query)
      return
    }
  }

  // User-initiated typing resets history-nav so subsequent Up starts fresh.
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
// Example chips with institution-aware preview
// ---------------------------------------------------------------------------

function ExampleChips({ onSelect }: { onSelect: (q: string) => void }) {
  const { institution } = useApp()
  return (
    <div className="flex flex-wrap gap-2 mt-5 justify-center">
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
    </div>
  )
}

// ---------------------------------------------------------------------------
// Result area
// ---------------------------------------------------------------------------

function ResultArea() {
  const { loading, currentResult, error } = useApp()

  return (
    <div className="mt-8">
      {loading && <AnswerSkeleton />}
      {!loading && error && <ErrorView />}
      {!loading && !error && currentResult && <AnswerView result={currentResult} />}
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
  const [revealedLength, setRevealedLength] = useState(
    reducedMotion ? fullAnswer.length : 0,
  )

  // Client-side streaming reveal. Even though the backend doesn't stream, the
  // reveal makes the answer feel like it's being composed rather than dumped.
  // On `prefers-reduced-motion`, render instantly.
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

  // Only promote the "Where to read more" footer once the stream completes —
  // otherwise the footer heading would pop into a divided block mid-reveal.
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

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE_OUT_QUART }}
      className="group relative text-[16px] leading-[1.75] text-ink"
    >
      <CopyButton text={fullAnswer} disabled={!fullyRevealed} />
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

function ErrorView() {
  return (
    <p className="text-sm text-ink-soft leading-relaxed">
      System temporarily unable to generate response. Retrieval results may
      still be available.
    </p>
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
