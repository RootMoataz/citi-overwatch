import EventOutlined from '@mui/icons-material/EventOutlined'
import LinkIcon from '@mui/icons-material/Link'
import Lock from '@mui/icons-material/LockOutlined'
import { Box, Button, Chip, Link, Paper, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useId } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { STATUS, statusColor } from '../../app/theme.js'
import { formatDayFull, formatHours } from '../../lib/format.js'
import { closedLabel } from './useTimesheetWeek.js'
import { KIND, KIND_ICON, chipSx, daySummary, isOverdue, kindColor, kindText, milestoneHref, shortDate, sourceOf } from './monthText.js'

const LOCK_NOTE ='Timer hours are locked; your manager approves any change'
const term = { typography: 'body2', color: 'text.secondary' }
const value = { typography: 'body2', fontWeight: 600, m: 0, display: 'flex', alignItems: 'center', gap: 0.75 }

/** The line's approval status as a chip: icon and word, in the status colours. */
function StatusChip({ kind }) {
  const Icon = KIND_ICON[kind]
  return (
    <Box component="span" sx={[{ display: 'inline-flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.25, typography: 'caption',
      fontWeight: 600, whiteSpace: 'nowrap', color: (t) => kindText(kind, t) }, chipSx(kind)]}>
      <Icon sx={{ fontSize: 15, color: (t) => kindColor(kind, t) }} />{KIND[kind].panel}
    </Box>
  )
}

/** One hours line of the day: what it is, read-only, and what can be done about it. Timer hours are locked and changed
 * only through a request to the manager; any other line is edited in the Day view. */
function LineCard({ line, date, milestone, lock, onOpenDay, onRequest }) {
  const name = milestone?.name ?? 'Milestone'
  const closed = milestone ? closedLabel({ project: milestone.project }) : null
  const reason = line.kind === 'rejected' ? line.entry?.rejection_reason : null
  return (
    <Paper component="li" variant="outlined" sx={{ p: 2, listStyle: 'none' }}>
      <Stack direction="row" useFlexGap sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
        <Typography component="h4" variant="subtitle1" sx={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{name}</Typography>
        <StatusChip kind={line.kind} />
      </Stack>
      {milestone ? <Typography variant="body2" sx={{ color: 'text.secondary' }}>{`Project: ${milestone.project.name}`}</Typography> : null}
      <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 2, rowGap: 1.25, alignItems: 'center',
        m: 0, mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Box component="dt" sx={term}>Hours</Box>
        <Box component="dd" sx={value}>
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 1.25, py: 0.5, borderRadius: 1, border: 1,
            borderColor: 'divider', bgcolor: 'action.hover', fontVariantNumeric: 'tabular-nums' }}>
            {formatHours(line.hours)}
            {lock ? <Lock titleAccess="Locked" sx={{ fontSize: 16, color: 'text.secondary' }} /> : null}
          </Box>
        </Box>
        <Box component="dt" sx={term}>Timer-linked entry</Box>
        <Box component="dd" sx={value}><LinkIcon sx={{ fontSize: 18, color: 'text.secondary' }} />{lock ? 'Yes' : 'No'}</Box>
        <Box component="dt" sx={term}>Source</Box>
        <Box component="dd" sx={value}>{sourceOf(line)}</Box>
      </Box>
      {reason ? (
        <Typography variant="body2" sx={{ mt: 1.5, px: 1.25, py: 0.75, borderRadius: 1, bgcolor: (t) => alpha(statusColor(STATUS.rejected, t), 0.08) }}>
          {`Reason: ${reason}`}
        </Typography>
      ) : null}
      {lock ? (
        <>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1.5 }}>{LOCK_NOTE}</Typography>
          {closed ? <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>{closed}</Typography> : (
            <Button variant="outlined" size="small" disabled={Boolean(lock.request)} sx={{ mt: 1 }}
              onClick={() => onRequest({ milestoneId: line.milestone_id, date, hours: lock.hours, label: name })}>
              {lock.request ? 'Change requested' : 'Request a change'}
            </Button>
          )}
        </>
      ) : <Button variant="outlined" size="small" sx={{ mt: 1.5 }} onClick={() => onOpenDay(date)}>Edit in Day view</Button>}
    </Paper>
  )
}

/** The milestones due that day, each with its date, "Overdue" once past and unfinished, and a link to it. */
function MilestoneDates({ deadlines, today }) {
  return (
    <Box sx={{ mt: 2.5, pt: 2, borderTop: 1, borderColor: 'divider' }}>
      <Typography component="h4" variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>Milestone dates</Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1.25 }}>
        {deadlines.map((m) => (
          <Box component="li" key={m.id}>
            <Stack direction="row" useFlexGap sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <EventOutlined sx={{ fontSize: 18, color: 'text.secondary' }} />
              <Typography variant="body2" component="span">{`${m.name} · Due ${shortDate(m.end_date)}`}</Typography>
              {isOverdue(m, today) ? (
                <Typography component="span" variant="caption" sx={{ fontWeight: 700, color: (t) => kindText('rejected', t) }}>
                  <Box component="span" aria-hidden>⚠ </Box>Overdue
                </Typography>
              ) : null}
            </Stack>
            <Link component={RouterLink} to={milestoneHref(m)} variant="body2" underline="hover" sx={{ display: 'inline-block', ml: 3.25, mt: 0.25 }}>
              View milestones
            </Link>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/** The selected day: its date, a summary of its hours, one card per line, and the milestones due that day. A region named by
 * its date. A day with no line to edit (none, or only timer hours) still offers the Day view, to log other hours there. */
export default function MonthDayPanel({ date, isToday, info, names, locks, deadlines, today, onOpenDay, onRequest }) {
  const headingId = useId()
  const lines = info?.lines ?? []
  const lockOf = (l) => locks.get(`${l.milestone_id}|${date}`)
  return (
    <Paper component="section" aria-labelledby={headingId} variant="outlined" sx={{ p: { xs: 2, sm: 2.5 }, minWidth: 0 }}>
      <Stack direction="row" useFlexGap sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography id={headingId} component="h3" variant="h6" sx={{ fontWeight: 700 }}>{formatDayFull(date)}</Typography>
        {isToday ? <Chip label="Today" size="small" color="primary" variant="outlined" /> : null}
      </Stack>
      <Typography variant="subtitle1" component="p" sx={{ color: 'text.secondary', mb: 2 }}>{daySummary(lines, info?.total)}</Typography>
      {lines.length ? (
        <Box component="ul" aria-label="Entries" sx={{ m: 0, p: 0, display: 'grid', gap: 1.5 }}>
          {lines.map((l) => (
            <LineCard key={`${l.milestone_id}-${l.kind}`} line={l} date={date} milestone={names.get(l.milestone_id)} lock={lockOf(l)}
              onOpenDay={onOpenDay} onRequest={onRequest} />
          ))}
        </Box>
      ) : null}
      {lines.every(lockOf) ? (
        <Button variant="outlined" size="small" sx={{ mt: lines.length ? 1.5 : 0 }} onClick={() => onOpenDay(date)}>Edit in Day view</Button>
      ) : null}
      {deadlines.length ? <MilestoneDates deadlines={deadlines} today={today} /> : null}
    </Paper>
  )
}
