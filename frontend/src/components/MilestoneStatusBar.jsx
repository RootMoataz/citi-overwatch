import { Box, Paper, Stack, Tooltip, Typography } from '@mui/material'
import { useEffect, useId, useState } from 'react'
import { STATUS, statusColor } from '../app/theme.js'
import { STRIPED, stripes } from './stateStripes.js'

// The order the states read in, left to right.
const ORDER = ['completed', 'ready_for_review', 'in_progress', 'not_started', 'waiting', 'blocked']
const GAP = 2
const MIN_LABEL = 24 // a count is printed inside a segment only when the segment is at least this wide, in px

/** The width in px of the element given the returned ref, or 0 where nothing can measure it (jsdom has no layout, and may
 * lack ResizeObserver). The node is held in state, so a bar that mounts after the first render is still measured, and
 * ResizeObserver reports the width as soon as it starts watching. */
function useWidth() {
  const [node, setNode] = useState(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!node) return undefined
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [node])
  return [setNode, width]
}

const plural = (n) => `${n} milestone${n === 1 ? '' : 's'}`

/** One bar for the whole project: its milestones by state, with the counts. Archived milestones are left out. */
export default function MilestoneStatusBar({ items }) {
  const headingId = useId()
  const [barRef, width] = useWidth()
  const live = (items ?? []).filter((m) => !m.is_archived)
  if (!live.length) return null

  const counts = Object.fromEntries(ORDER.map((key) => [key, 0]))
  for (const m of live) {
    const key = [m.display_status, m.status].find((s) => ORDER.includes(s)) ?? 'not_started'
    counts[key] += 1
  }
  const states = ORDER.filter((key) => counts[key] > 0)
  const total = live.length
  // The gaps come off the room the segments share, so a segment's px width is its share of what is left.
  const room = Math.max(width - GAP * (states.length - 1), 0)

  return (
    <Paper component="section" variant="outlined" aria-labelledby={headingId} sx={{ p: 2 }}>
      <Typography id={headingId} variant="subtitle1" component="h3" sx={{ mb: 1 }}>
        {`${counts.completed} of ${total} ${total === 1 ? 'milestone' : 'milestones'} done`}
      </Typography>
      <Stack ref={barRef} direction="row" sx={{ gap: `${GAP}px`, height: 28 }}>
        {states.map((key) => {
          const n = counts[key]
          const text = `${STATUS[key].label}: ${plural(n)}`
          return (
            <Tooltip key={key} title={text} describeChild>
              <Box role="img" aria-label={text} data-count={n}
                sx={{ width: `${(n / total) * 100}%`, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  bgcolor: (t) => statusColor(STATUS[key], t), color: (t) => t.palette.getContrastText(statusColor(STATUS[key], t)),
                  fontSize: '0.8125rem', fontWeight: 600, overflow: 'hidden', backgroundImage: STRIPED.has(key) ? stripes(6) : 'none' }}>
                {(n / total) * room >= MIN_LABEL ? n : null}
              </Box>
            </Tooltip>
          )
        })}
      </Stack>
      <Stack component="ul" direction="row" useFlexGap aria-label="Milestones by state"
        sx={{ listStyle: 'none', p: 0, m: 0, mt: 1.5, gap: 2, flexWrap: 'wrap' }}>
        {states.map((key) => (
          <Stack component="li" key={key} direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
            <Box aria-hidden sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: (t) => statusColor(STATUS[key], t),
              backgroundImage: STRIPED.has(key) ? stripes(3) : 'none' }} />
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{`${STATUS[key].label} ${counts[key]}`}</Typography>
          </Stack>
        ))}
      </Stack>
    </Paper>
  )
}
