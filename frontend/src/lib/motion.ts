/**
 * Recall Motion System
 *
 * Centralized motion tokens following Emil Kowalski's design-engineering principles:
 * - Purposeful, fast, interruptible
 * - transform/opacity preferred
 * - Spring motion for physical interactions
 * - Reduced motion support
 *
 * Usage with Framer Motion:
 *   import { motionTokens } from '@/lib/motion'
 *   <motion.div animate={{ opacity: 1 }} transition={motionTokens durations.standard} />
 *
 * Usage with CSS:
 *   transition: transform var(--duration-standard) var(--ease-out);
 */

export const durations = {
  instant: 0,
  fast: 120,
  standard: 200,
  slow: 350,
} as const

export const easings = {
  /** Strong ease-out for UI interactions — starts fast, feels responsive */
  out: [0.23, 1, 0.32, 1] as const,
  /** Strong ease-in-out for on-screen movement */
  inOut: [0.77, 0, 0.175, 1] as const,
  /** Spring-like for playful/physical interactions */
  spring: [0.34, 1.56, 0.64, 1] as const,
} as const

/** Pre-built transition objects for Framer Motion */
export const transitions = {
  instant: { duration: 0 },
  fast: { duration: durations.fast / 1000, ease: easings.out },
  standard: { duration: durations.standard / 1000, ease: easings.out },
  slow: { duration: durations.slow / 1000, ease: easings.out },
  spring: { type: 'spring' as const, duration: 0.5, bounce: 0.15 },
  springSnappy: { type: 'spring' as const, duration: 0.35, bounce: 0.1 },
} as const

/** Framer Motion page transition variants */
export const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
}

export const pageTransition = transitions.standard

/** Check if user prefers reduced motion */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
