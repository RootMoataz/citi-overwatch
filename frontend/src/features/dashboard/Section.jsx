import { Box, Paper, Stack, Typography } from '@mui/material'
import { useId } from 'react'

/** A dashboard panel titled with the business question it answers (a labelled region for screen readers). */
export default function Section({ question, hint, action, children }) {
  const id = useId()
  return (
    <Paper component="section" variant="outlined" aria-labelledby={id} sx={{ p: 2, height: '100%' }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline', gap: 1, mb: 1.5 }}>
        <Typography id={id} variant="h3" component="h2">{question}</Typography>
        {action ? <Box sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{action}</Box> : null}
      </Stack>
      {hint ? <Typography variant="body2" sx={{ color: 'text.secondary', mt: -1, mb: 1.5 }}>{hint}</Typography> : null}
      {children}
    </Paper>
  )
}
