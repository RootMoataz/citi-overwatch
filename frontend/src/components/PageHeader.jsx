import { Box, Stack, Typography } from '@mui/material'

export default function PageHeader({ title, subtitle, actions, breadcrumb }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ mb: 3, gap: 2, alignItems: { sm: 'flex-end' },
      justifyContent: 'space-between' }}>
      <Box sx={{ minWidth: 0 }}>
        {breadcrumb}
        <Typography variant="h1" component="h1">{title}</Typography>
        {subtitle ? <Typography variant="body2" component="div" sx={{ color: 'text.secondary', mt: 0.5 }}>{subtitle}</Typography> : null}
      </Box>
      {actions ? <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>{actions}</Stack> : null}
    </Stack>
  )
}
