import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { motion } from 'framer-motion'
import { useApp } from '../state'
import { institutionByKey } from '../institutions'
import { MOTION } from '../motion'

// Auto-grow caps. The composer expands from ~24px (single line) up to 5
// lines, then the textarea internally scrolls. 24px line-height here
// matches `leading-6` plus the [15px] font-size we use.
const LINE_HEIGHT_PX = 24
const MIN_LINES = 1
const MAX_LINES = 5

type Props = {
  value: string
  onChange: (v: string) => void
  onSubmit: (q: string) => void
}

export function SearchComposer({ value, onChange, onSubmit }: Props) {
  const { loading, currentQuery, history, institution } = useApp()
  const inst = institutionByKey(institution)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [focused, setFocused] = useState(false)

  // Only the current institution's history is navigable from the input —
  // matches what the sidebar shows so Up/Down maps to "what I see".
  const scopedHistory = useMemo(
    () => history.filter((e) => e.institution === institution),
    [history, institution],
  )

  // History navigation state. -1 = "user's current input"; 0..N indexes into
  // scopedHistory. savedValue keeps whatever the user had typed so we can
  // restore it on the way back.
  const [historyIndex, setHistoryIndex] = useState(-1)
  const savedValueRef = useRef('')

  // Auto-grow: every value change recomputes the textarea height up to MAX_LINES.
  // useLayoutEffect prevents a one-frame flash where the textarea is wrong-sized.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = MAX_LINES * LINE_HEIGHT_PX
    const min = MIN_LINES * LINE_HEIGHT_PX
    const next = Math.max(min, Math.min(max, el.scrollHeight))
    el.style.height = `${next}px`
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
  }, [value])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Sync the composer with `currentQuery` *only* when an external trigger
  // changes it — history clicks, sidebar re-runs, activating an older entry.
  //   - `value` is intentionally NOT a dep: including it caused every
  //     keystroke to retrigger the effect and revert local edits (the
  //     backspace/typing-after-submit bug).
  //   - The first run is skipped so a restored session doesn't pre-fill the
  //     composer with the active entry's query on reload.
  const initialMountRef = useRef(true)
  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false
      return
    }
    if (currentQuery !== null) {
      onChange(currentQuery)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuery])

  useEffect(() => {
    setHistoryIndex(-1)
    savedValueRef.current = ''
  }, [currentQuery])

  // Switching institutions resets transient draft state: history-nav cursor,
  // saved typed-value buffer. (Composer text itself is owned by CenterPanel
  // and reset there.) The timeline, persisted history, and active entry are
  // intentionally NOT touched here.
  const prevInstRef = useRef(institution)
  useEffect(() => {
    if (prevInstRef.current !== institution) {
      setHistoryIndex(-1)
      savedValueRef.current = ''
      prevInstRef.current = institution
    }
  }, [institution])

  // Global shortcuts: "/" and Cmd/Ctrl+K both focus the input.
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

  const submit = useCallback(() => {
    const q = value.trim()
    if (!q || loading) return
    setHistoryIndex(-1)
    savedValueRef.current = ''
    onSubmit(q)
  }, [value, loading, onSubmit])

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    submit()
  }

  function handleInputKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    // Enter submits; Shift+Enter inserts a newline (default behavior).
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      submit()
      return
    }

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

    // History navigation only when the textarea is single-line content —
    // multiline drafts use ↑/↓ for cursor movement.
    const isMultiline = value.includes('\n')
    if (e.key === 'ArrowUp' && !isMultiline) {
      if (loading || scopedHistory.length === 0) return
      const next = historyIndex + 1
      if (next >= scopedHistory.length) return
      e.preventDefault()
      if (historyIndex === -1) savedValueRef.current = value
      setHistoryIndex(next)
      onChange(scopedHistory[next].query)
      return
    }
    if (e.key === 'ArrowDown' && !isMultiline) {
      if (loading) return
      if (historyIndex === -1) return
      e.preventDefault()
      const next = historyIndex - 1
      setHistoryIndex(next)
      onChange(next === -1 ? savedValueRef.current : scopedHistory[next].query)
      return
    }
  }

  function handleInputChange(e: ChangeEvent<HTMLTextAreaElement>) {
    if (historyIndex !== -1) setHistoryIndex(-1)
    onChange(e.target.value)
  }

  const hasText = value.trim().length > 0
  const focusBorderStyle = inst
    ? { boxShadow: focused ? `0 0 0 1px ${inst.tintAccent}, var(--shadow-card-hover)` : undefined }
    : undefined

  return (
    <motion.form
      onSubmit={handleSubmit}
      animate={{ scale: focused ? 1.003 : 1 }}
      transition={{ duration: 0.18, ease: MOTION.ease }}
      style={focusBorderStyle}
      className={
        'relative rounded-xl bg-surface border ' +
        'flex items-start px-4 py-3 gap-3 ' +
        'transition-shadow duration-200 ' +
        (focused
          ? 'border-rule-strong shadow-card-hover'
          : 'border-rule shadow-card')
      }
    >
      <SearchIcon className="w-4 h-4 text-ink-muted shrink-0 mt-1" />
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        onChange={handleInputChange}
        onKeyDown={handleInputKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Ask a question about university governance…"
        spellCheck={false}
        autoComplete="off"
        className={
          'flex-1 bg-transparent outline-none text-[15px] leading-6 text-ink ' +
          'placeholder:text-ink-muted resize-none ' +
          'scrollbar-thin'
        }
      />
      <div className="flex items-center gap-2 shrink-0 mt-0.5">
        {inst && (
          <span
            title={inst.label}
            className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-2 py-1 rounded-md border border-rule text-ink-soft transition-colors duration-150"
          >
            <span
              aria-hidden
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: inst.tintDot }}
            />
            <span>{inst.short}</span>
          </span>
        )}
        {hasText ? (
          <SendButton disabled={loading} />
        ) : (
          <kbd className="hidden sm:inline-flex text-[11px] font-mono text-ink-muted px-1.5 py-1 rounded border border-rule select-none">
            /
          </kbd>
        )}
      </div>
    </motion.form>
  )
}

function SendButton({ disabled }: { disabled: boolean }) {
  return (
    <motion.button
      type="submit"
      disabled={disabled}
      aria-label="Submit query"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.15, ease: MOTION.ease }}
      className={
        'inline-flex items-center justify-center w-8 h-8 rounded-md ' +
        'bg-accent text-white ' +
        'hover:bg-accent-strong transition-colors duration-150 cursor-pointer ' +
        'disabled:opacity-60 disabled:cursor-not-allowed'
      }
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </svg>
    </motion.button>
  )
}

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
