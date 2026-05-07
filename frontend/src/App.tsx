import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { LeftSidebar } from './components/LeftSidebar'
import { CenterPanel } from './components/CenterPanel'
import { RightInspector } from './components/RightInspector'
import { useApp } from './state'

const PANEL_WIDTHS_KEY = 'policylens.panels.v1'

const LEFT_MIN = 180
const LEFT_MAX = 360
const LEFT_DEFAULT = 240

const RIGHT_MIN = 280
const RIGHT_MAX = 520
const RIGHT_DEFAULT = 360

const TRANSITION_MS = 220

// Breakpoints — matches Step 10 spec.
//   <  900: left sidebar collapses to a 56px icon rail
//   < 1100: right panel becomes an overlay drawer
//   1100+: standard 3-pane resizable layout
const BREAK_LEFT_RAIL = 900
const BREAK_RIGHT_DRAWER = 1100

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function loadPanels(): { left: number; right: number } {
  try {
    const raw = localStorage.getItem(PANEL_WIDTHS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.left === 'number' && typeof parsed.right === 'number') {
        return {
          left: clamp(parsed.left, LEFT_MIN, LEFT_MAX),
          right: clamp(parsed.right, RIGHT_MIN, RIGHT_MAX),
        }
      }
    }
  } catch {
    // localStorage may be disabled — fall through to defaults
  }
  return { left: LEFT_DEFAULT, right: RIGHT_DEFAULT }
}

// Tracks viewport width for responsive layout decisions. Throttled-ish via
// requestAnimationFrame so a fast resize doesn't thrash React state.
function useViewportWidth(): number {
  const [width, setWidth] = useState<number>(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth,
  )
  useEffect(() => {
    let raf = 0
    function onResize() {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setWidth(window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(raf)
    }
  }, [])
  return width
}

function App() {
  const [leftWidth, setLeftWidth] = useState<number>(() => loadPanels().left)
  const [rightWidth, setRightWidth] = useState<number>(() => loadPanels().right)

  // Width transitions are disabled during drag to keep cursor 1:1 with the
  // panel edge; they're enabled briefly on programmatic resets so a "snap
  // back" feels animated rather than abrupt.
  const [animateLeft, setAnimateLeft] = useState(false)
  const [animateRight, setAnimateRight] = useState(false)

  const viewportWidth = useViewportWidth()
  const isOverlayRight = viewportWidth < BREAK_RIGHT_DRAWER
  const isLeftRail = viewportWidth < BREAK_LEFT_RAIL

  const [drawerOpen, setDrawerOpen] = useState(false)

  // When the viewport grows back past the drawer breakpoint the standard
  // layout takes over — close any lingering drawer state to avoid the panel
  // appearing twice.
  useEffect(() => {
    if (!isOverlayRight) setDrawerOpen(false)
  }, [isOverlayRight])

  // Esc closes the overlay drawer (input-scoped Esc inside CenterPanel
  // returns early before this fires, so this won't fight the search bar).
  useEffect(() => {
    if (!drawerOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  useEffect(() => {
    try {
      localStorage.setItem(
        PANEL_WIDTHS_KEY,
        JSON.stringify({ left: leftWidth, right: rightWidth }),
      )
    } catch {
      // non-fatal
    }
  }, [leftWidth, rightWidth])

  function resetLeft() {
    setAnimateLeft(true)
    setLeftWidth(LEFT_DEFAULT)
    setTimeout(() => setAnimateLeft(false), TRANSITION_MS + 30)
  }

  function resetRight() {
    setAnimateRight(true)
    setRightWidth(RIGHT_DEFAULT)
    setTimeout(() => setAnimateRight(false), TRANSITION_MS + 30)
  }

  // Onboarding mount: stagger sidebar → center → right panel over ~500ms.
  // Initial-only animation (no key changes), so it runs once on first render
  // and never replays. Total budget kept short — premium-feeling onboarding
  // shouldn't make the UI feel sluggish to land.
  return (
    <div className="flex h-full bg-canvas text-ink relative overflow-hidden">
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: 0 }}
        className="flex shrink-0"
      >
        <LeftSidebar
          width={leftWidth}
          minWidth={LEFT_MIN}
          maxWidth={LEFT_MAX}
          animate={animateLeft}
          setWidth={setLeftWidth}
          onResetWidth={resetLeft}
          collapsed={isLeftRail}
        />
      </motion.div>

      <motion.main
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
        className="flex-1 min-w-0 overflow-y-auto"
      >
        <CenterPanel />
      </motion.main>

      {!isOverlayRight ? (
        <motion.div
          initial={{ opacity: 0, x: 8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
          className="flex shrink-0"
        >
          <RightInspector
            width={rightWidth}
            minWidth={RIGHT_MIN}
            maxWidth={RIGHT_MAX}
            animate={animateRight}
            setWidth={setRightWidth}
            onResetWidth={resetRight}
          />
        </motion.div>
      ) : (
        <>
          <DrawerTrigger onOpen={() => setDrawerOpen(true)} hidden={drawerOpen} />
          <AnimatePresence>
            {drawerOpen && (
              <>
                <motion.div
                  key="scrim"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => setDrawerOpen(false)}
                  className="fixed inset-0 z-40 bg-ink/20 backdrop-blur-[1px]"
                />
                <motion.div
                  key="drawer"
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="fixed top-0 right-0 bottom-0 z-50 shadow-card-hover"
                >
                  <RightInspector
                    width={Math.min(rightWidth, viewportWidth - 40)}
                    minWidth={RIGHT_MIN}
                    maxWidth={RIGHT_MAX}
                    animate={false}
                    setWidth={setRightWidth}
                    onResetWidth={resetRight}
                    asDrawer
                    onClose={() => setDrawerOpen(false)}
                  />
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  )
}

// Floating affordance to open the source drawer at narrow widths. Doubles as
// a source-count indicator so users know there's something to look at.
function DrawerTrigger({ onOpen, hidden }: { onOpen: () => void; hidden: boolean }) {
  const { currentResult } = useApp()
  const count = currentResult?.sources?.length ?? 0
  if (hidden) return null
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.4 }}
      className={
        'fixed top-4 right-4 z-30 inline-flex items-center gap-2 ' +
        'px-3 py-1.5 rounded-full bg-surface border border-rule shadow-card ' +
        'text-[12px] text-ink-soft hover:text-ink hover:border-rule-strong ' +
        'transition-colors cursor-pointer'
      }
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </svg>
      <span>Sources</span>
      {count > 0 && (
        <span className="font-mono text-[11px] text-ink-muted">{count}</span>
      )}
    </motion.button>
  )
}

export default App
