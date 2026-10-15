import Insights from '@mui/icons-material/InsightsOutlined'
import Groups from '@mui/icons-material/GroupsOutlined'
import Savings from '@mui/icons-material/SavingsOutlined'
import { Box, Stack, Typography } from '@mui/material'
import { motion } from 'framer-motion'
import { useMediaQuery } from 'react-responsive'
import BrandLogo from '../../components/BrandLogo.jsx'
import { EASE, useCalmMotion } from '../../lib/motion.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'

const SLOGAN = 'See every project, person and dollar — before it slips.'

const VALUES = [
  { icon: <Insights />, title: 'Spot risk early', text: 'Overdue milestones and fast budget burn are flagged for you.' },
  { icon: <Groups />, title: 'Know who is stretched', text: 'Planned against logged hours for every person, every week.' },
  { icon: <Savings />, title: 'Watch the money', text: 'Live spend and an end-date forecast against every budget.' },
]

const RINGS = [0, 1, 2]

/** Slow radar rings and a turning sweep behind the brand copy. Transform and opacity only, so the GPU does the work;
 * reduced motion leaves a still picture. */
function RadarBackdrop() {
  const calm = useCalmMotion()
  return (
    <Box aria-hidden sx={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {/* A faint grid, fading out towards the copy. */}
      <Box sx={{ position: 'absolute', inset: 0, opacity: 0.18,
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)',
        backgroundSize: '44px 44px', maskImage: 'radial-gradient(circle at 85% 85%, black, transparent 70%)',
        WebkitMaskImage: 'radial-gradient(circle at 85% 85%, black, transparent 70%)' }} />
      <Box sx={{ position: 'absolute', right: { xs: '-45%', md: '-22%' }, bottom: { xs: '-90%', md: '-26%' },
        width: { xs: 420, md: 640 }, aspectRatio: '1' }}>
        {RINGS.map((i) => (
          <motion.div key={i}
            style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.32)' }}
            initial={calm ? { scale: 0.45 + i * 0.25, opacity: 0.5 } : { scale: 0.2, opacity: 0 }}
            animate={calm ? undefined : { scale: [0.2, 1], opacity: [0, 0.55, 0] }}
            transition={calm ? undefined : { duration: 7.5, delay: i * 2.5, repeat: Infinity, ease: 'easeOut' }} />
        ))}
        <motion.div
          style={{ position: 'absolute', inset: '12%', borderRadius: '50%',
            background: 'conic-gradient(from 0deg, rgba(255,255,255,0.22), rgba(255,255,255,0) 70deg, rgba(255,255,255,0) 360deg)' }}
          animate={calm ? undefined : { rotate: 360 }}
          transition={calm ? undefined : { duration: 9, repeat: Infinity, ease: 'linear' }} />
        <Box sx={{ position: 'absolute', inset: '12%', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.22)' }} />
        <Box sx={{ position: 'absolute', inset: '31%', borderRadius: '50%', border: '1px dashed rgba(255,255,255,0.2)' }} />
      </Box>
    </Box>
  )
}

/** The left half of the sign-in pages: animated logo, slogan and what Scout does. On phones it shrinks to a header. */
export default function BrandPanel() {
  const calm = useCalmMotion()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const rise = (i) => ({
    initial: calm ? false : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, delay: 0.1 + i * 0.07, ease: EASE },
  })
  return (
    <Box component="aside" aria-label="About ACME Scout"
      sx={{ position: 'relative', overflow: 'hidden', color: '#FFFFFF', px: { xs: 3, sm: 5, md: 7 }, py: { xs: 3, md: 7 },
        display: 'flex', flexDirection: 'column', justifyContent: { md: 'space-between' }, gap: { xs: 2, md: 4 },
        minHeight: { md: '100vh' },
        background: 'radial-gradient(120% 90% at 0% 0%, #1D7BE0 0%, rgba(29,123,224,0) 55%), linear-gradient(150deg, #0B5CAD 0%, #083F7A 55%, #06264A 100%)' }}>
      <RadarBackdrop />
      <Box sx={{ position: 'relative' }}>
        <BrandLogo inverse animated size={desktop ? 44 : 34} />
      </Box>
      <Box sx={{ position: 'relative', maxWidth: 520 }}>
        <motion.div {...rise(0)}>
          <Typography component="p" sx={{ fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.12,
            fontSize: { xs: '1.375rem', sm: '1.75rem', md: '2.5rem' } }}>
            {SLOGAN}
          </Typography>
        </motion.div>
        <motion.div {...rise(1)}>
          <Typography sx={{ mt: { xs: 1, md: 2 }, color: 'rgba(255,255,255,0.82)', fontSize: { xs: '0.9rem', md: '1.0625rem' } }}>
            One live view of delivery, people, hours and budgets for every team at ACME.
          </Typography>
        </motion.div>
        <Stack component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 4, gap: 2.25, display: { xs: 'none', md: 'flex' } }}>
          {VALUES.map((v, i) => (
            <motion.li key={v.title} {...rise(i + 2)}>
              <Stack direction="row" sx={{ gap: 1.75, alignItems: 'flex-start' }}>
                <Box aria-hidden sx={{ display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 2, flexShrink: 0,
                  bgcolor: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.2)', backdropFilter: 'blur(4px)' }}>
                  {v.icon}
                </Box>
                <Box>
                  <Typography sx={{ fontWeight: 700 }}>{v.title}</Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.78)' }}>{v.text}</Typography>
                </Box>
              </Stack>
            </motion.li>
          ))}
        </Stack>
      </Box>
      <Typography variant="caption" sx={{ position: 'relative', color: 'rgba(255,255,255,0.6)', display: { xs: 'none', md: 'block' } }}>
        ACME Scout · project tracking for ACME
      </Typography>
    </Box>
  )
}
