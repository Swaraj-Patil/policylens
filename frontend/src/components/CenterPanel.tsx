import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { useApp } from '../state'
import type { QueryResponse } from '../types'
import { matchKeyOf, tokenizeAnswer } from '../citations'
import { CitationChip } from './CitationChip'

const EXAMPLE_QUERIES = [
  'What is academic freedom?',
  'How do faculty promotions work?',
  'What is the grade appeal process?',
] as const

const EASE_OUT_QUART: [number, number, number, number] = [0.16, 1, 0.3, 1]

export function CenterPanel() {
  const { currentQuery, runQuery } = useApp()
  const [value, setValue] = useState('')
  const showIdle = currentQuery === null

  function submitQuery(query: string) {
    setValue(query)
    runQuery(query)
  }

  return (
    <div
      className={
        'min-h-full flex flex-col px-8 ' +
        (showIdle ? 'items-center justify-center py-16' : 'py-10')
      }
    >
      <div className="w-full max-w-[680px] mx-auto">
        {showIdle && <IdleHero />}

        <SearchBar
          value={value}
          onChange={setValue}
          onSubmit={(q) => submitQuery(q)}
        />

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
    <header className="text-center mb-10">
      <h2 className="text-[28px] leading-[1.25] font-semibold tracking-tight text-ink">
        Ask a question about university governance documents.
      </h2>
      <p className="text-sm text-ink-soft mt-3 leading-relaxed">
        Search across faculty handbooks. Every answer is grounded in retrieved
        passages with page-anchored citations.
      </p>
    </header>
  )
}

// ---------------------------------------------------------------------------
// Search bar
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
  const { loading } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  // Global "/" shortcut to focus the input (skips when an input is already focused)
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key !== '/') return
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea') return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const q = value.trim()
    if (!q || loading) return
    onSubmit(q)
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
        onChange={(e) => onChange(e.target.value)}
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
// Example chips (only shown in idle state)
// ---------------------------------------------------------------------------

function ExampleChips({ onSelect }: { onSelect: (q: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mt-5 justify-center">
      {EXAMPLE_QUERIES.map((q) => (
        <button
          key={q}
          type="button"
          onClick={() => onSelect(q)}
          className="text-xs text-ink-soft px-3 py-1.5 rounded-md border border-rule bg-surface hover:border-rule-strong hover:text-ink transition-colors"
        >
          {q}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Result area (loading | result | error)
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
  const widths = ['85%', '100%', '92%', '78%', '95%', '60%']
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {widths.map((w, i) => (
        <div
          key={i}
          className="h-4 bg-rule/70 rounded-md animate-pulse"
          style={{ width: w, animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  )
}

function AnswerView({ result }: { result: QueryResponse }) {
  const paragraphs = result.answer.split('\n\n')
  const sourceKeys = useMemo(
    () => new Set(result.sources.map(matchKeyOf)),
    [result.sources],
  )

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE_OUT_QUART }}
      className="text-[16px] leading-[1.75] text-ink"
    >
      {paragraphs.map((para, i) => (
        <p key={i} className="mb-4 last:mb-0">
          <RenderedParagraph text={para} sourceKeys={sourceKeys} />
        </p>
      ))}
    </motion.article>
  )
}

function RenderedParagraph({
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

function ErrorView() {
  return (
    <p className="text-sm text-ink-soft leading-relaxed">
      System temporarily unable to generate response. Retrieval results may
      still be available.
    </p>
  )
}

// ---------------------------------------------------------------------------
// Inline icon (no icon library — keeps deps minimal)
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
