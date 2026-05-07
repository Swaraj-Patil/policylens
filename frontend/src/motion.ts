/**
 * Unified motion timings shared across the workspace. Keeping these in one
 * file means the entry stagger, drawer slide, panel resize settle, and idle
 * fade-ins all read from the same scale — small differences in duration
 * register as inconsistency, not richness.
 *
 * All timings are tuned for "calm alive": fast enough to stay responsive,
 * slow enough to register as deliberate. No bounces, no overshoots — every
 * easing here is monotonic.
 */

/** Snappy ease-out for most enter/leave transitions. */
export const EASE_OUT_QUART: [number, number, number, number] = [0.16, 1, 0.3, 1]

/** Symmetric ease-in-out for ambient (looping) motion. */
export const EASE_INOUT_SOFT: [number, number, number, number] = [0.42, 0, 0.58, 1]

export const MOTION = {
  ease: EASE_OUT_QUART,
  easeInOut: EASE_INOUT_SOFT,
  /** Standard enter for a new piece of content (cards, headers). */
  enter: { duration: 0.32, ease: EASE_OUT_QUART },
  /** Faster transition for inline state changes (hover-derived motion). */
  quick: { duration: 0.18, ease: EASE_OUT_QUART },
  /** Slower transition for layout-affecting changes (drawer, height). */
  layout: { duration: 0.4, ease: EASE_OUT_QUART },
  /** Per-item stagger delay used by the answer stack and source list. */
  stagger: 0.05,
  /** Resize "settle" window — width transitions are enabled briefly after
   *  the user releases the drag handle so the final tick interpolates. */
  resizeSettleMs: 220,
} as const
