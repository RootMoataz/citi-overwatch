// Shared motion settings. Everything animated stays short (300ms or less), never blocks input, and is skipped
// entirely for people who ask their system for reduced motion.
import { useReducedMotion } from 'framer-motion'

/** A soft "ease out" that settles quickly. */
export const EASE = [0.22, 1, 0.36, 1]

/** Stagger step between cards appearing in a grid, capped so long lists don't wait. */
export const STAGGER = 0.04
const MAX_STAGGER_STEPS = 8

export const staggerDelay = (index = 0) => Math.min(index, MAX_STAGGER_STEPS) * STAGGER

/** True when motion should be skipped (the operating system's "reduce motion" setting). */
export function useCalmMotion() {
  return Boolean(useReducedMotion())
}
