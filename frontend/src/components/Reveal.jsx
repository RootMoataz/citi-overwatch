import { motion } from 'framer-motion'
import { EASE, staggerDelay, useCalmMotion } from '../lib/motion.js'

/** Fades and lifts its content in once on mount; `index` staggers cards in a grid. Static when motion is reduced. */
export default function Reveal({ index = 0, as = 'div', style, children, ...rest }) {
  const calm = useCalmMotion()
  const Tag = motion[as] ?? motion.div
  return (
    <Tag initial={calm ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE, delay: staggerDelay(index) }} style={{ height: '100%', ...style }} {...rest}>
      {children}
    </Tag>
  )
}
