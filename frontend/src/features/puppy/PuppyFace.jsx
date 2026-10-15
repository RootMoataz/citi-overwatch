import { motion } from 'framer-motion'
import { useCalmMotion } from '../../lib/motion.js'

// Puppy's look: an original drawing made for Scout (a round tan face, floppy brown ears, a patch over one eye and a
// wagging tail). The colours are fixed, like a logo, and read on both the light and the dark header.
const FUR = '#E2A66B'
const EAR = '#9A5B2E'
const PATCH = '#C4834C'
const MUZZLE = '#F7E2CB'
const INK = '#2A1A10'
const TONGUE = '#EF7D8B'

const SPRING = { type: 'spring', stiffness: 320, damping: 16 }

/**
 * `perked`: ears up and tongue out (something is waiting). `excitedAt`: changes when a new alert arrives, and Puppy
 * hops once. The tail wags every few seconds (faster when perked). Reduced motion keeps Puppy still; the ears still
 * show the state, just without the movement.
 */
export default function PuppyFace({ size = 30, perked = false, excitedAt = 0, title }) {
  const calm = useCalmMotion()
  const earTurn = perked ? 52 : 0
  const ear = (side) => ({
    style: { transformBox: 'view-box', transformOrigin: side === 'left' ? '15px 14px' : '33px 14px' },
    initial: false,
    animate: { rotate: side === 'left' ? earTurn : -earTurn },
    transition: calm ? { duration: 0 } : SPRING,
  })
  const wag = calm ? { rotate: 0 } : { rotate: [0, 24, -6, 24, 0] }
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}
      focusable="false" style={{ display: 'block', overflow: 'visible' }}>
      {title ? <title>{title}</title> : null}
      <motion.g key={excitedAt} initial={false} animate={calm || !excitedAt ? { y: 0 } : { y: [0, -4, 0, -2, 0] }}
        transition={{ duration: 0.6 }}>
        {/* Tail, behind the head, wagging from its base. */}
        <motion.path d="M36 37 C42 37 45 33 44 27" fill="none" stroke={EAR} strokeWidth="3.6" strokeLinecap="round"
          style={{ transformBox: 'view-box', transformOrigin: '36px 37px' }} initial={false} animate={wag}
          transition={calm ? { duration: 0 } : { duration: perked ? 0.5 : 0.7, repeat: Infinity, repeatDelay: perked ? 1.2 : 4,
            ease: 'easeInOut' }} />
        <circle cx="24" cy="26" r="14.5" fill={FUR} />
        <ellipse cx="29.5" cy="22.5" rx="5" ry="4.4" fill={PATCH} />
        {/* Ears hang down beside the face; perked, they swing out and up. */}
        <motion.path d="M15 13 C8 14 5 25 8.5 31 C11.5 30.5 14.5 25 17 16 Z" fill={EAR} {...ear('left')} />
        <motion.path d="M33 13 C40 14 43 25 39.5 31 C36.5 30.5 33.5 25 31 16 Z" fill={EAR} {...ear('right')} />
        <ellipse cx="24" cy="32" rx="7.5" ry="5.6" fill={MUZZLE} />
        <circle cx="18.6" cy="24" r="2.2" fill={INK} />
        <circle cx="29.4" cy="24" r="2.2" fill={INK} />
        <circle cx="19.3" cy="23.3" r="0.7" fill="#fff" />
        <circle cx="30.1" cy="23.3" r="0.7" fill="#fff" />
        <ellipse cx="24" cy="29.2" rx="2.6" ry="1.8" fill={INK} />
        <path d="M24 31 L24 32.6 M24 32.6 C22.8 34 21 34 20.2 33 M24 32.6 C25.2 34 27 34 27.8 33" fill="none" stroke={INK}
          strokeWidth="1" strokeLinecap="round" />
        {perked ? <path d="M22.4 33.6 C22.4 36.6 25.6 36.6 25.6 33.6 Z" fill={TONGUE} /> : null}
      </motion.g>
    </svg>
  )
}
