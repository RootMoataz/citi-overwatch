import { Box, Paper, Typography } from '@mui/material'
import { motion } from 'framer-motion'
import { EASE, useCalmMotion } from '../../lib/motion.js'
import BrandPanel from './BrandPanel.jsx'

/** Split sign-in layout used by the sign-in and password-reset pages: the brand panel on the left, the form on the
 * right. On phones the brand panel becomes a header above the form. */
export default function AuthCard({ title, subtitle, children }) {
  const calm = useCalmMotion()
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', bgcolor: 'background.default',
      gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1.15fr) minmax(0, 1fr)' } }}>
      <BrandPanel />
      <Box component="main" sx={{ display: 'grid', placeItems: 'center', px: 2, py: { xs: 3, md: 6 } }}>
        <motion.div style={{ width: '100%', maxWidth: 440 }} initial={calm ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE }}>
          <Paper variant="outlined" sx={{ p: { xs: 3, sm: 4 }, borderRadius: 3 }}>
            <Typography variant="h2" component="h1" sx={{ fontSize: '1.625rem' }}>{title}</Typography>
            {subtitle ? <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 3 }}>{subtitle}</Typography>
              : <Box sx={{ mb: 3 }} />}
            {children}
          </Paper>
        </motion.div>
      </Box>
    </Box>
  )
}
