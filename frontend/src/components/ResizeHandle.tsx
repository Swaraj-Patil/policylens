import { useCallback, type PointerEvent } from 'react'

/**
 * A thin draggable handle for resizing a side panel.
 *
 * - Hit area is 8px wide, positioned slightly outside the panel edge so it
 *   overlaps the panel's existing border. Visually invisible at rest;
 *   accent-tinted on hover/drag so the affordance is discoverable but never
 *   imposes itself on the chrome.
 * - Pointer events (not mouse events) so it works for trackpad, mouse, pen,
 *   and touch uniformly. setPointerCapture means the drag survives moving
 *   outside the handle.
 * - Emits raw `dx` deltas to the caller; sign interpretation lives where the
 *   width is owned (the sidebar adds dx, the inspector subtracts).
 * - Double-click → onReset() so the caller can snap back to a default width.
 */
export function ResizeHandle({
  edge,
  onDelta,
  onDragStart,
  onDragEnd,
  onReset,
}: {
  edge: 'left' | 'right'
  onDelta: (dx: number) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  onReset?: () => void
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
          // already released — non-fatal
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
      onDoubleClick={onReset}
      role="separator"
      aria-orientation="vertical"
      title={onReset ? 'Drag to resize · double-click to reset' : 'Drag to resize'}
      // The wrapper is the 8px hit area (subtle generous click target).
      // The inner span is the 1px visible line that lights up on hover/drag.
      className={
        'group absolute top-0 z-10 h-full w-2 cursor-ew-resize ' +
        (edge === 'right' ? '-right-1' : '-left-1')
      }
    >
      <span
        className={
          'absolute top-0 bottom-0 w-px ' +
          'bg-transparent group-hover:bg-accent/40 group-active:bg-accent/60 ' +
          'transition-colors duration-150 ' +
          (edge === 'right' ? 'right-1' : 'left-1')
        }
      />
    </div>
  )
}
