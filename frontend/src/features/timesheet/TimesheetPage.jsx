import ChevronLeft from '@mui/icons-material/ChevronLeft'
import ChevronRight from '@mui/icons-material/ChevronRight'
import {
  Alert, Box, Button, Chip, FormControlLabel, IconButton, Paper, Skeleton, Stack, Switch, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useMemo, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { useSearchParams } from 'react-router-dom'
import { useSaveWeek, useWeek } from '../../api/queries.js'
import { STATUS } from '../../app/theme.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { addDays, formatDate, formatDayLabel, formatHours, mondayOf } from '../../lib/format.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'

const CAP = 40
const key = (milestoneId, date) => `${milestoneId}|${date}`
const num = (v) => (v === '' || v == null ? 0 : Number(v))

function CellStatus({ entry }) {
  if (!entry) return null
  const meta = STATUS[entry.status] ?? STATUS.pending
  const label = (
    <Typography variant="caption" sx={{ display: 'block', color: meta.color, lineHeight: 1.2, mt: 0.5 }}>{entry.label}</Typography>
  )
  return (
    <>
      {entry.status === 'rejected' && entry.rejection_reason
        ? <Tooltip title={`Rejected: ${entry.rejection_reason}`}><span>{label}</span></Tooltip> : label}
      {entry.edited_after_decision ? <Chip size="small" label="Edited" variant="outlined" sx={{ mt: 0.5, height: 18 }} /> : null}
    </>
  )
}

export default function TimesheetPage() {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const [params, setParams] = useSearchParams()
  const week = params.get('week') ?? mondayOf(new Date())
  const [showWeekend, setShowWeekend] = useState(false)
  const sheet = useWeek(week)
  const save = useSaveWeek()
  const [drafts, setDrafts] = useState({})
  const [failure, setFailure] = useState(null)

  const allDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week])
  const days = desktop || showWeekend ? allDays : allDays.slice(0, 5)
  const entries = useMemo(() => Object.fromEntries((sheet.data?.entries ?? []).map((e) => [key(e.milestone_id, e.work_date), e])), [sheet.data])
  const valueOf = (k) => (k in drafts ? drafts[k] : entries[k] ? String(entries[k].hours) : '')
  const countsToward = (k) => (k in drafts ? true : entries[k] && entries[k].status !== 'rejected')

  const rows = sheet.data?.rows ?? []
  const cellKeys = rows.flatMap((r) => allDays.map((d) => key(r.milestone.id, d)))
  const total = cellKeys.reduce((s, k) => s + (countsToward(k) ? num(valueOf(k)) : 0), 0)
  const tooMany = cellKeys.some((k) => num(valueOf(k)) > 24) || allDays.some((d) => rows.reduce((s, r) => s + num(valueOf(key(r.milestone.id, d))), 0) > 24)
  const changed = Object.entries(drafts).filter(([k, v]) => num(v) !== num(entries[k]?.hours ?? 0) || (!entries[k] && v !== ''))

  const goTo = (target) => { setDrafts({}); setFailure(null); setParams({ week: target }, { replace: true }) }

  const onSave = async () => {
    setFailure(null)
    const body = { week, entries: changed.filter(([k, v]) => entries[k] || num(v) > 0).map(([k, v]) => {
      const [milestoneId, date] = k.split('|')
      return { milestone_id: milestoneId, work_date: date, hours: num(v) }
    }) }
    if (!body.entries.length) return
    try {
      await save.mutateAsync(body)
      setDrafts({})
    } catch (err) { setFailure(err) }
  }

  const groups = rows.reduce((acc, r) => {
    const g = acc.find((x) => x.project.id === r.project.id)
    if (g) g.rows.push(r)
    else acc.push({ project: r.project, rows: [r] })
    return acc
  }, [])

  return (
    <>
      <PageHeader title="My timesheet" subtitle="Log hours per day on the milestones you're assigned to. Every entry goes to the project manager for approval."
        actions={<Button variant="contained" onClick={onSave} disabled={!changed.length || tooMany || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save week'}</Button>} />
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, alignItems: { sm: 'center' }, mb: 2 }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <IconButton aria-label="Previous week" onClick={() => goTo(addDays(week, -7))}><ChevronLeft /></IconButton>
          <Typography variant="subtitle1" component="p">Week of {formatDate(week)}</Typography>
          <IconButton aria-label="Next week" onClick={() => goTo(addDays(week, 7))}><ChevronRight /></IconButton>
          <Button size="small" onClick={() => goTo(mondayOf(new Date()))}>This week</Button>
        </Stack>
        <Box sx={{ flexGrow: 1 }} />
        <Typography data-testid="week-total" variant="h3" component="p"
          sx={{ color: total > CAP ? 'warning.main' : 'text.primary' }}>
          {formatHours(total)} / {CAP}h
        </Typography>
        {!desktop ? <FormControlLabel control={<Switch checked={showWeekend} onChange={(e) => setShowWeekend(e.target.checked)} />} label="Weekend" /> : null}
      </Stack>
      {total > CAP ? <Alert severity="warning" sx={{ mb: 2 }}>Over 40 hours this week. Your manager is notified once and each entry over the mark shows as overtime.</Alert> : null}
      {tooMany ? <Alert severity="error" sx={{ mb: 2 }}>Hours over 24 in a day can't be saved.</Alert> : null}
      <ErrorAlert error={failure ?? sheet.error} onRetry={failure ? undefined : () => sheet.refetch()} sx={{ mb: 2 }} />
      {sheet.isLoading ? <Skeleton variant="rounded" height={240} /> : null}
      {!sheet.isLoading && !sheet.error && rows.length === 0 ? (
        <EmptyState title="You're not assigned to any milestones this week"
          description="Your project manager assigns you to milestones; they'll show up here as rows." />
      ) : null}
      {rows.length ? (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label={`Timesheet for the week of ${formatDate(week)}`}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ minWidth: 160 }}>Milestone</TableCell>
                {days.map((d) => <TableCell key={d} align="center" sx={{ minWidth: 84 }}>{formatDayLabel(d)}</TableCell>)}
                <TableCell align="right">Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {groups.map((g) => (
                <GroupRows key={g.project.id} group={g} days={days} allDays={allDays} valueOf={valueOf} entries={entries}
                  onChange={(k, v) => setDrafts((d) => ({ ...d, [k]: v }))} />
              ))}
              <TableRow sx={{ '& td, & th': { fontWeight: 700 } }}>
                <TableCell component="th" scope="row">Daily total</TableCell>
                {days.map((d) => {
                  const dayTotal = rows.reduce((s, r) => s + num(valueOf(key(r.milestone.id, d))), 0)
                  return <TableCell key={d} align="center" sx={{ color: dayTotal > 24 ? 'error.main' : undefined }}>{formatHours(dayTotal)}</TableCell>
                })}
                <TableCell align="right">{formatHours(total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}
    </>
  )
}

function GroupRows({ group, days, allDays, valueOf, entries, onChange }) {
  return (
    <>
      <TableRow>
        <TableCell colSpan={days.length + 2} sx={{ bgcolor: (t) => alpha(t.palette.primary.main, 0.06), fontWeight: 700 }}>
          {group.project.name}
        </TableCell>
      </TableRow>
      {group.rows.map((r) => {
        const rowTotal = allDays.reduce((s, d) => s + num(valueOf(key(r.milestone.id, d))), 0)
        return (
          <TableRow key={r.milestone.id}>
            <TableCell component="th" scope="row">{r.milestone.name}</TableCell>
            {days.map((d) => {
              const k = key(r.milestone.id, d)
              const value = valueOf(k)
              return (
                <TableCell key={d} align="center" sx={{ verticalAlign: 'top' }}>
                  <TextField value={value} onChange={(e) => onChange(k, e.target.value)} type="number"
                    error={num(value) > 24}
                    slotProps={{ htmlInput: { min: 0, max: 24, step: 0.25, 'aria-label': `${r.milestone.name}, ${formatDayLabel(d)}`,
                      style: { textAlign: 'center' } } }}
                    sx={{ width: 76 }} />
                  <CellStatus entry={entries[k]} />
                </TableCell>
              )
            })}
            <TableCell align="right">{formatHours(rowTotal)}</TableCell>
          </TableRow>
        )
      })}
    </>
  )
}
