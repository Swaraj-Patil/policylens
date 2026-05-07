import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { motion } from 'framer-motion'
import { useApp } from '../state'
import type { QueryResponse } from '../types'
import { matchKeyOf, parseAnswerBlocks, tokenizeAnswer } from '../citations'
import type { AnswerBlock } from '../types'
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
  const { loading, currentQuery, resetSession } = useApp()
  const inputRef = useRef<HTMLInputElement>(null)
  const [focused, setFocused] = useState(false)

  // Auto-focus the search input on first mount so the user can start typing
  // immediately. StrictMode runs effects twice in dev; focus() is idempotent.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Sync local input value with currentQuery so external triggers — clicking a
  // history item or chip — populate the input automatically. Skipping when
  // currentQuery is null leaves the user's typed text alone in idle state.
  useEffect(() => {
    if (currentQuery !== null && currentQuery !== value) {
      onChange(currentQuery)
    }
  }, [currentQuery, value, onChange])

  // Global keyboard shortcuts:
  //   "/"   focus the input (ignored while typing in another field)
  //   Esc   clear the input + return to idle (ignored while a request is in flight)
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === '/') {
        const tag = (document.activeElement?.tagName || '').toLowerCase()
        if (tag === 'input' || tag === 'textarea') return
        e.preventDefault()
        inputRef.current?.focus()
        return
      }
      if (e.key === 'Escape') {
        if (loading) return
        if (value === '' && currentQuery === null) return
        e.preventDefault()
        onChange('')
        resetSession()
        // Move focus back to the input so the user can immediately type again.
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [loading, value, currentQuery, onChange, resetSession])

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
          className="text-xs text-ink-soft px-3 py-1.5 rounded-md border border-rule bg-surface hover:border-rule-strong hover:bg-canvas hover:text-ink hover:-translate-y-px transition-all duration-150 cursor-pointer"
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
  // Two paragraph groups, separated by extra space, mimic the structure of a
  // real answer: a body paragraph followed by a shorter "Where to read more"
  // footer. The shimmer animation passes through each line in sequence via
  // staggered animation-delay, giving a calm wave instead of a noisy pulse.
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

function AnswerView({ result }: { result: QueryResponse }) {
  const blocks = useMemo(() => parseAnswerBlocks(result.answer), [result.answer])
  const sourceKeys = useMemo(
    () => new Set(result.sources.map(matchKeyOf)),
    [result.sources],
  )

  // Detect the trailing "Where to read more" footer block (a stable convention
  // in the prompt) so we can render it as a clearly demarcated metadata block
  // instead of mixing it into the body prose.
  const footerIdx = blocks.findIndex(
    (b) => b.type === 'paragraph' && b.text.toLowerCase().startsWith('where to read more'),
  )
  const hasFooter = footerIdx >= 0
  const body = hasFooter ? blocks.slice(0, footerIdx) : blocks
  const footer = hasFooter ? blocks[footerIdx] : null

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE_OUT_QUART }}
      className="text-[16px] leading-[1.75] text-ink"
    >
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
  return (
    <ul className="list-disc list-outside pl-5 space-y-1.5 marker:text-ink-muted">
      {block.items.map((item, i) => (
        <li key={i}>
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
