import { Stack, Typography } from '@mui/material'

/** The line under a table or panel: "ⓘ <note>" on the left, an optional `end` (a date, a link) on the right.
 * `icon` (decorative, hidden from readers) replaces the "ⓘ". */
export default function FootNote({ note, end, icon }) {
  return (
    <Stack sx={{ flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { md: 'center' },
      gap: { xs: 0.5, md: 2 }, color: 'text.secondary', mt: 1.5 }}>
      <Typography variant="caption" component="p" sx={{ m: 0, display: 'flex', alignItems: 'center', gap: 0.75 }}>
        {icon ? <span aria-hidden="true" style={{ display: 'inline-flex' }}>{icon}</span> : <span aria-hidden="true">ⓘ</span>}
        <span>{note}</span>
      </Typography>
      {end ? <Typography variant="caption" component="div" sx={{ flexShrink: 0 }}>{end}</Typography> : null}
    </Stack>
  )
}
