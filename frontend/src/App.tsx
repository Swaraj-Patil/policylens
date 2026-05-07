import { useEffect, useState } from 'react'
import { LeftSidebar } from './components/LeftSidebar'
import { CenterPanel } from './components/CenterPanel'
import { RightInspector } from './components/RightInspector'

const PANEL_WIDTHS_KEY = 'policylens.panels.v1'

const LEFT_MIN = 180
const LEFT_MAX = 360
const LEFT_DEFAULT = 240

const RIGHT_MIN = 280
const RIGHT_MAX = 520
const RIGHT_DEFAULT = 360

const TRANSITION_MS = 220

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

function App() {
  const [leftWidth, setLeftWidth] = useState<number>(() => loadPanels().left)
  const [rightWidth, setRightWidth] = useState<number>(() => loadPanels().right)

  // Width transitions are disabled during drag to keep cursor 1:1 with the
  // panel edge; they're enabled briefly on programmatic resets so a "snap
  // back" feels animated rather than abrupt.
  const [animateLeft, setAnimateLeft] = useState(false)
  const [animateRight, setAnimateRight] = useState(false)

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

  return (
    <div className="flex h-full bg-canvas text-ink">
      <LeftSidebar
        width={leftWidth}
        minWidth={LEFT_MIN}
        maxWidth={LEFT_MAX}
        animate={animateLeft}
        setWidth={setLeftWidth}
        onResetWidth={resetLeft}
      />
      <main className="flex-1 min-w-0 overflow-y-auto">
        <CenterPanel />
      </main>
      <RightInspector
        width={rightWidth}
        minWidth={RIGHT_MIN}
        maxWidth={RIGHT_MAX}
        animate={animateRight}
        setWidth={setRightWidth}
        onResetWidth={resetRight}
      />
    </div>
  )
}

export default App
