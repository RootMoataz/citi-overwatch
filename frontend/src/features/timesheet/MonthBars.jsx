import { Box, Button, Link, Tooltip, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { STATUS, statusColor } from '../../app/theme.js'
import { STRIPED, stripes } from '../../components/stateStripes.js'
import { barName, isOverdue, milestoneHref, moreWords, stateKey } from './monthText.js'

const cell = { p: 0, border: 0, height: 22, verticalAlign: 'middle' }

function Bar({ bar, today }) {
  const { milestone: m, startsBefore, endsAfter, endsHere } = bar
  const key = stateKey(m)
  const overdue = isOverdue(m, today)
  // Wide enough to spell the state out; narrower bars keep the name and leave the state to the tooltip and the accessible name.
  const text = bar.endCol - bar.startCol >= 2 ? `${m.name} · ${STATUS[key].label}` : m.name
  const mark = overdue ? 'Overdue' : (endsHere ? 'Due' : null)
  return (
    <Tooltip describeChild disableInteractive title={barName(m, today)}>
    <Link component={RouterLink} to={milestoneHref(m)} aria-label={barName(m, today)} underline="none"
      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, height: 20, mx: '2px', px: 0.75, overflow: 'hidden', fontSize: '0.75rem',
        borderRadius: `${startsBefore ? 0 : 10}px ${endsAfter ? 0 : 10}px ${endsAfter ? 0 : 10}px ${startsBefore ? 0 : 10}px`,
        bgcolor: (t) => statusColor(STATUS[key], t), color: (t) => t.palette.getContrastText(statusColor(STATUS[key], t)),
        backgroundImage: STRIPED.has(key) ? stripes(5) : 'none', '&:hover': { filter: 'brightness(0.92)' } }}>
      <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</Box>
      {mark ? (
        <Box component="span" sx={{ flexShrink: 0, fontWeight: 700, fontSize: '0.6875rem' }}>
          {overdue ? <Box component="span" aria-hidden>⚠ </Box> : null}{mark}
        </Box>
      ) : null}
    </Link>
    </Tooltip>
  )
}

/** The bars across the top of one week: a table row per lane, then the "+N more" button for what didn't fit. */
export default function MonthBars({ lanes, hidden, today, onMore }) {
  return (
    <>
      {lanes.map((bars, lane) => {
        const cells = []
        let col = 0
        for (const bar of [...bars].sort((a, b) => a.startCol - b.startCol)) {
          if (bar.startCol > col) cells.push(<Box component="td" key={`gap${col}`} colSpan={bar.startCol - col} sx={cell} />)
          cells.push(
            <Box component="td" key={bar.milestone.id} colSpan={bar.endCol - bar.startCol + 1} sx={cell}>
              <Bar bar={bar} today={today} />
            </Box>,
          )
          col = bar.endCol + 1
        }
        if (col < 7) cells.push(<Box component="td" key="rest" colSpan={7 - col} sx={cell} />)
        return <Box component="tr" key={lane}>{cells}</Box>
      })}
      {hidden.length ? (
        <Box component="tr">
          <Box component="td" colSpan={7} sx={{ ...cell, textAlign: 'right', px: 0.5 }}>
            <Button size="small" aria-label={moreWords(hidden.length)} onClick={(e) => onMore(e.currentTarget, hidden)}
              sx={{ minHeight: 0, py: 0, fontSize: '0.75rem' }}>
              <Typography component="span" variant="caption">{`+${hidden.length} more`}</Typography>
            </Button>
          </Box>
        </Box>
      ) : null}
    </>
  )
}
