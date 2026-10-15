// A short confetti burst for real wins: a milestone completed, the approvals queue emptied, a project completed.
// Skipped for anyone whose system asks for reduced motion, and never allowed to break the action it follows.
// canvas-confetti is loaded on first use, so it costs nothing until someone has something to celebrate.

export function prefersReducedMotion() {
  try {
    return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  } catch {
    return false
  }
}

const COLOURS = ['#1E7D45', '#0B5CAD', '#F2B33D', '#6B3FA0', '#E4572E']

/** Fire the burst; resolves true when it ran, false when skipped or unavailable. */
export async function celebrate({ origin = { x: 0.5, y: 0.35 } } = {}) {
  if (prefersReducedMotion()) return false
  try {
    const { default: confetti } = await import('canvas-confetti')
    const shared = { origin, colors: COLOURS, disableForReducedMotion: true, zIndex: 2000 }
    confetti({ ...shared, particleCount: 90, spread: 70, startVelocity: 42, scalar: 0.95 })
    confetti({ ...shared, particleCount: 40, spread: 110, startVelocity: 30, decay: 0.92, scalar: 0.8 })
    return true
  } catch {
    return false
  }
}
