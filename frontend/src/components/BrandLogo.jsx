import { Box } from '@mui/material'
import { motion } from 'framer-motion'
import { useId, useState } from 'react'
import { EASE, useCalmMotion } from '../lib/motion.js'

const BRAND_BLUE = '#0B5CAD'
const BRAND_BLUE_LIGHT = '#2B86E6'
const BLIP = '#FFB547'

/**
 * The ACME Scout mark: a radar scope on a rounded tile. A ring with compass ticks, a sweep wedge with its leading
 * edge, a centre point and an amber "blip": the thing Scout spots before it slips.
 * `tile` false drops the blue tile (for artwork on a blue surface); `ink` colours the strokes.
 * `animated` draws the ring, turns the sweep once and pulses the blip on load and on hover; reduced motion keeps it still.
 */
export function BrandGlyph({ size = 36, tile = true, ink = '#FFFFFF', animated = false, turns = 1 }) {
  const gradient = useId()
  const calm = useCalmMotion()
  const live = animated && !calm
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true" focusable="false" style={{ display: 'block', flexShrink: 0 }}>
      {tile ? (
        <>
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={BRAND_BLUE_LIGHT} />
              <stop offset="1" stopColor={BRAND_BLUE} />
            </linearGradient>
          </defs>
          <rect width="40" height="40" rx="11" fill={`url(#${gradient})`} />
        </>
      ) : null}
      <path d="M20 4.6v3M20 32.4v3M4.6 20h3M32.4 20h3" stroke={ink} strokeWidth="2.2" strokeLinecap="round" opacity="0.55" />
      <motion.circle cx="20" cy="20" r="12" fill="none" stroke={ink} strokeWidth="2.4"
        initial={live ? { pathLength: 0, rotate: -90 } : false} animate={{ pathLength: 1, rotate: -90 }}
        transition={{ duration: 0.7, ease: EASE }} />
      <circle cx="20" cy="20" r="6.5" fill="none" stroke={ink} strokeWidth="1.6" opacity="0.5" />
      <motion.g initial={live ? { rotate: 0 } : false} animate={{ rotate: live ? turns * 360 : 0 }}
        transition={{ duration: 1.1, ease: EASE }}>
        {/* An invisible full circle keeps the group's box centred, so it turns around the scope's middle. */}
        <circle cx="20" cy="20" r="12" fill="none" />
        <path d="M20 20 L20 8 A12 12 0 0 1 30.39 14 Z" fill={ink} opacity="0.28" />
        <path d="M20 20 L30.39 14" stroke={ink} strokeWidth="2.4" strokeLinecap="round" />
      </motion.g>
      <circle cx="20" cy="20" r="2.4" fill={ink} />
      {live ? (
        <motion.circle key={turns} cx="25.2" cy="13.3" fill="none" stroke={BLIP} strokeWidth="1.4"
          initial={{ r: 2.6, opacity: 0.8 }} animate={{ r: 7.5, opacity: 0 }} transition={{ duration: 0.9, delay: 0.55, ease: 'easeOut' }} />
      ) : null}
      <motion.circle cx="25.2" cy="13.3" r="2.6" fill={BLIP}
        initial={live ? { scale: 0, opacity: 0 } : false} animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.3, delay: 0.5, ease: EASE }} />
    </svg>
  )
}

/**
 * Logo with the "ACME" wordmark over the product name "Scout". `variant="glyph"` shows the mark only.
 * One accessible name ("ACME Scout") either way. `inverse` is white artwork for blue surfaces.
 */
export default function BrandLogo({ variant = 'full', size = 36, animated = false, inverse = false, sx }) {
  const [turns, setTurns] = useState(1)
  const calm = useCalmMotion()
  const replay = animated && !calm ? () => setTurns((t) => t + 1) : undefined
  return (
    <Box role="img" aria-label="ACME Scout" onMouseEnter={replay}
      sx={{ display: 'inline-flex', alignItems: 'center', gap: size / 28, minWidth: 0, ...sx }}>
      <BrandGlyph size={size} animated={animated} turns={turns} tile={!inverse} />
      {variant === 'full' ? (
        <Box aria-hidden sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1, whiteSpace: 'nowrap' }}>
          <Box component="span" sx={{ fontSize: size * 0.3, fontWeight: 800, letterSpacing: '0.24em', lineHeight: 1,
            color: inverse ? 'rgba(255,255,255,0.78)' : 'text.secondary', mb: `${size * 0.07}px` }}>ACME</Box>
          <Box component="span" sx={{ fontSize: size * 0.6, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1,
            color: inverse ? '#FFFFFF' : 'text.primary' }}>Scout</Box>
        </Box>
      ) : null}
    </Box>
  )
}
