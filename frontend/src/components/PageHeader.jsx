import { Box, Stack, Typography } from '@mui/material'

/** `avatar` (optional) sits left of the title, e.g. a person's photo on their profile. */
export default function PageHeader({ title, subtitle, actions, breadcrumb, avatar }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ mb: 3, gap: 2, alignItems: { sm: 'flex-end' },
      justifyContent: 'space-between' }}>
      <Stack direction="row" sx={{ minWidth: 0, gap: 2, alignItems: 'center' }}>
        {avatar}
        <Box sx={{ minWidth: 0 }}>
          {breadcrumb}
          {/* A name can be one long word: it breaks rather than push the page sideways. */}
          <Typography variant="h1" component="h1" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
          {subtitle ? <Typography variant="body2" component="div" sx={{ color: 'text.secondary', mt: 0.5 }}>{subtitle}</Typography> : null}
        </Box>
      </Stack>
      {actions ? <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>{actions}</Stack> : null}
    </Stack>
  )
}
