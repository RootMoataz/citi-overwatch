import FactCheck from '@mui/icons-material/FactCheckOutlined'
import { Box, Paper, Stack, Typography } from '@mui/material'

/** Centered card used by the sign-in and password-reset pages. */
export default function AuthCard({ title, subtitle, children }) {
  return (
    <Box component="main" sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', px: 2, py: 6,
      background: (t) => `radial-gradient(circle at 20% 0%, ${t.palette.primary.main}22, transparent 55%), ${t.palette.background.default}` }}>
      <Paper variant="outlined" sx={{ width: '100%', maxWidth: 420, p: { xs: 3, sm: 4 }, borderRadius: 2 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 3 }}>
          <FactCheck color="primary" aria-hidden />
          <Typography variant="h3" component="p" sx={{ fontWeight: 800 }}>Citi Overwatch</Typography>
        </Stack>
        <Typography variant="h2" component="h1">{title}</Typography>
        {subtitle ? <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, mb: 3 }}>{subtitle}</Typography>
          : <Box sx={{ mb: 3 }} />}
        {children}
      </Paper>
    </Box>
  )
}
