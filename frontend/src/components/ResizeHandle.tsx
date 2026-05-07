import { useCallback, type PointerEvent } from 'react'

/**
 * A thin draggable handle for resizing a side panel.
 *
 * - Hit area is 4px wide, positioned slightly outside the panel edge so it
 *   overlaps the panel's existing border. Visually invisible at rest;
 *   accent-tinted on hover/drag so the affordance is discoverable but never
 *   imposes itself on the chrome.
 * - Uses pointer events (not mouse events) so it works for trackpad, mouse,
 *   pen, and touch uniformly, with pointer capture so the drag survives
 *   moving outside the handle.
 * - Emits raw `dx` deltas to the caller; sign interpretation lives where the
 *   width is owned (the sidebar adds dx, the inspector subtracts).
 */
export function ResizeHandle({
  edge,
  onDelta,
  onDragStart,
  onDragEnd,
}: {
  edge: 'left' | 'right'
  onDelta: (dx: number) => void
  onDragStart?: () => void
  onDragEnd?: () => void
}) {
  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      const target = e.currentTarget
      target.setPointerCapture(e.pointerId)
      onDragStart?.()
      let lastX = e.clientX

      function onMove(ev: globalThis.PointerEvent) {
        const dx = ev.clientX - lastX
        if (dx === 0) return
        lastX = ev.clientX
        onDelta(dx)
      }

      function onUp() {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        try {
          target.releasePointerCapture(e.pointerId)
        } catch {
          // pointer may already be released — non-fatal
        }
        onDragEnd?.()
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [onDelta, onDragStart, onDragEnd],
  )

  return (
    <div
      onPointerDown={handlePointerDown}
      role="separator"
      aria-orientation="vertical"
      className={
        'absolute top-0 z-10 h-full w-1 cursor-ew-resize ' +
        'bg-transparent hover:bg-accent/30 active:bg-accent/50 transition-colors ' +
        (edge === 'right' ? '-right-0.5' : '-left-0.5')
      }
    />
  )
}
