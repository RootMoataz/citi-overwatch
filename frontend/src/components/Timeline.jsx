import { Box, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useState } from 'react'
import { STATUS, statusColor } from '../app/theme.js'
import { formatDate } from '../lib/format.js'

const DAY = 86400000
const toTime = (iso) => Date.UTC(...String(iso).slice(0, 10).split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))))

/** Horizontal date bars scaled to the project's dates, with a "today" marker and the dependency chain. */
export default function Timeline({ items, range }) {
  const start = toTime(range.start)
  const span = Math.max(toTime(range.end) - start + DAY, DAY)
  const pct = (iso) => Math.min(Math.max(((toTime(iso) - start) / span) * 100, 0), 100)
  const [today] = useState(() => Date.now()) // read the clock once, not on every render
  const todayPct = ((today - start) / span) * 100
  const names = Object.fromEntries(items.map((i) => [String(i.id), i.name]))

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{formatDate(range.start)}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{formatDate(range.end)}</Typography>
      </Stack>
      <Box sx={{ position: 'relative' }}>
        {todayPct >= 0 && todayPct <= 100 ? (
          <Box aria-hidden sx={{ position: 'absolute', top: 0, bottom: 0, left: `${todayPct}%`, width: 2,
            bgcolor: 'error.main', opacity: 0.6, zIndex: 1 }}>
            <Typography variant="caption" sx={{ position: 'absolute', top: -18, left: 4, color: 'error.main' }}>Today</Typography>
          </Box>
        ) : null}
        <Box component="ul" aria-label="Milestone timeline" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.5 }}>
          {items.map((item) => {
            const meta = STATUS[item.display_status] ?? STATUS.not_started
            const left = pct(item.start_date)
            const width = Math.max(pct(item.end_date) - left + (DAY / span) * 100, 1.5)
            const after = item.predecessors.map((id) => names[String(id)]).filter(Boolean)
            const label = `${item.name}, ${formatDate(item.start_date)} to ${formatDate(item.end_date)}, ${meta.label}`
            return (
              <Box component="li" key={item.id} tabIndex={0} aria-label={label}
                sx={{ outline: 'none', '&:focus-visible .bar': { boxShadow: (t) => `0 0 0 3px ${alpha(t.palette.primary.main, 0.4)}` } }}>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }} aria-hidden>
                  {item.name}
                  {after.length ? <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
                    after {after.join(', ')}</Typography> : null}
                </Typography>
                <Box aria-hidden sx={{ position: 'relative', height: 14, bgcolor: 'action.hover', borderRadius: 7 }}>
                  <Tooltip title={label}>
                    <Box className="bar" sx={{ position: 'absolute', left: `${left}%`, width: `${Math.min(width, 100 - left)}%`,
                      top: 0, bottom: 0, borderRadius: 7, bgcolor: (t) => statusColor(meta, t),
                      backgroundImage: item.display_status === 'blocked'
                        ? 'repeating-linear-gradient(45deg, rgba(255,255,255,.35) 0 6px, transparent 6px 12px)' : 'none' }} />
                  </Tooltip>
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>
    </Paper>
  )
}
