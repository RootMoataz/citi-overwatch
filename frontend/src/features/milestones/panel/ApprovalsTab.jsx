import ExpandMore from '@mui/icons-material/ExpandMore'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import WarningAmber from '@mui/icons-material/WarningAmberOutlined'
import {
  Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Skeleton, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useId, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { useApprovals, useApproveWeek, useBreakdowns, useRejectEntry } from '../../../api/queries.js'
import { useToast } from '../../../app/toast.js'
import EmptyState from '../../../components/EmptyState.jsx'
import ErrorAlert from '../../../components/ErrorAlert.jsx'
import { formatDate, formatHours, formatMoney } from '../../../lib/format.js'
import { groupByPersonWeek } from '../../../lib/personWeeks.js'
import { DESKTOP_QUERY } from '../../../lib/responsive.js'
import BreakdownPanel from '../../approvals/BreakdownPanel.jsx'
import FlagChips from '../../timer/FlagChips.jsx'
import SourceChip from '../../timer/SourceChip.jsx'
import { SOURCE_LABEL, shareText, weekSource } from '../../timer/timerClock.js'

const IMPACT_MAX = 20     // "up to 20 at a time": one breakdown request per selected entry
const REASON_MAX = 1000   // the server's limit on a rejection reason

const idOf = (item) => String(item.entry.id)
const hoursOf = (items) => items.reduce((sum, i) => sum + Number(i.entry.hours ?? 0), 0)
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const exact = (value) => formatMoney(value, { exact: true })
const titleOf = (group) => `${group.user.name} · Week of ${formatDate(group.week)} · `
  + `${plural(group.items.length, 'entry', 'entries')} · ${formatHours(hoursOf(group.items))}`
const entryName = (item) => `${item.user.name}, ${formatDate(item.entry.work_date)}, ${formatHours(item.entry.hours)}`
// 44 px touch targets (24 px box + 10 px each side).
const BOX_SX = { p: 1.25 }

/** The work note, else the day's progress update after "Update: ", else null. */
function workNote(item) {
  const note = (item.entry.note ?? '').trim()
  if (note) return note
  const update = (item.progress_update?.body ?? '').trim()
  return update ? `Update: ${update}` : null
}

/** One person's week: a collapsible header (with the week's Tracked, Manual or Mixed share) over its entries. */
function PersonWeek({ group, selected, onToggle, onToggleAll, desktop }) {
  const [open, setOpen] = useState(true)
  const headingId = useId()
  const bodyId = useId()
  const title = titleOf(group)
  const chosen = group.items.filter((i) => selected.has(idOf(i))).length
  const all = chosen === group.items.length
  const entries = group.items.map((i) => i.entry)
  const source = weekSource(entries)
  const delegatedFrom = group.items.find((i) => i.delegated_from)?.delegated_from
  const selectAll = (
    <Checkbox checked={all} indeterminate={chosen > 0 && !all} onChange={() => onToggleAll(group.items, !all)} sx={BOX_SX}
      slotProps={{ input: { 'aria-label': `Select all: ${title}` } }} />
  )

  const rows = group.items.map((item) => {
    const id = idOf(item)
    const checked = selected.has(id)
    const note = workNote(item)
    const box = (
      <Checkbox checked={checked} onChange={() => onToggle(item)} sx={BOX_SX}
        slotProps={{ input: { 'aria-label': `Select ${entryName(item)}` } }} />
    )
    const sourceChip = <SourceChip source={item.entry.source} hours={item.entry.hours} trackedHours={item.entry.tracked_hours} />
    if (desktop) {
      return (
        <TableRow key={id} selected={checked}>
          <TableCell padding="checkbox">{box}</TableCell>
          <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(item.entry.work_date)}</TableCell>
          <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatHours(item.entry.hours)}</TableCell>
          <TableCell>{sourceChip}</TableCell>
          <TableCell sx={{ overflowWrap: 'anywhere', minWidth: 140, color: note ? 'text.primary' : 'text.secondary' }}>{note ?? '—'}</TableCell>
          <TableCell><FlagChips flags={item.flags} /></TableCell>
        </TableRow>
      )
    }
    return (
      <Box component="li" key={id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, p: 0.5, border: 1, borderColor: 'divider',
        borderRadius: 1, bgcolor: checked ? (t) => alpha(t.palette.primary.main, 0.08) : 'transparent' }}>
        {box}
        <Box sx={{ flex: 1, minWidth: 0, py: 1 }}>
          <Stack direction="row" useFlexGap sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatDate(item.entry.work_date)}</Typography>
            <Typography variant="body2">{formatHours(item.entry.hours)}</Typography>
            {sourceChip}
          </Stack>
          {note ? <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, overflowWrap: 'anywhere' }}>{note}</Typography> : null}
          <FlagChips flags={item.flags} sx={{ mt: 0.5 }} />
        </Box>
      </Box>
    )
  })

  return (
    <Box component="section" aria-labelledby={headingId}>
      <Stack direction="row" useFlexGap sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        {desktop ? null : selectAll}
        <Typography id={headingId} variant="subtitle2" component="h4" sx={{ m: 0, minWidth: 0 }}>
          <Button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId} color="inherit"
            startIcon={<ExpandMore sx={{ transform: open ? 'none' : 'rotate(-90deg)' }} />}
            sx={{ minHeight: 44, px: 0.5, textAlign: 'left', fontWeight: 600, textTransform: 'none', justifyContent: 'flex-start' }}>
            {title}
          </Button>
        </Typography>
        {delegatedFrom ? <Chip size="small" variant="outlined" color="info" label={`Delegated from ${delegatedFrom.name}`} /> : null}
        {source ? (
          <Tooltip title={shareText(entries)} describeChild>
            <Chip size="small" variant="outlined" color={source === 'manual' ? 'default' : 'info'} label={SOURCE_LABEL[source]} />
          </Tooltip>
        ) : null}
      </Stack>
      {open && desktop ? (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" id={bodyId} aria-label={`Entries of ${title}`}>
            <TableHead>
              <TableRow sx={{ bgcolor: 'action.hover' }}>
                <TableCell padding="checkbox">{selectAll}</TableCell>
                {['Date', 'Hours', 'Source', 'Work note', 'Flags'].map((h) => <TableCell key={h}>{h}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>{rows}</TableBody>
          </Table>
        </Box>
      ) : null}
      {open && !desktop ? (
        <Stack component="ul" id={bodyId} aria-label={`Entries of ${title}`} sx={{ listStyle: 'none', p: 0, m: 0, mt: 0.5, gap: 1 }}>
          {rows}
        </Stack>
      ) : null}
    </Box>
  )
}

/** "Request changes": one required reason for every selected entry (the server's reject rules). */
function RequestChangesDialog({ busy, onSubmit, onClose }) {
  const titleId = useId()
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const submit = () => {
    const text = reason.trim()
    if (!text) { setError('Tell the employee why'); return }
    onSubmit(text)
  }
  return (
    <Dialog open onClose={busy ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>Request changes</DialogTitle>
      <DialogContent>
        <TextField label="Reason" required multiline minRows={3} fullWidth autoFocus value={reason} error={Boolean(error)}
          helperText={error || undefined} onChange={(e) => { setReason(e.target.value); setError('') }} disabled={busy}
          slotProps={{ htmlInput: { maxLength: REASON_MAX } }} sx={{ mt: 1 }} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} sx={{ minHeight: 44 }}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy} sx={{ minHeight: 44 }}>Request changes</Button>
      </DialogActions>
    </Dialog>
  )
}

/** Each selected entry's cost from its breakdown, and the total once every cost is in (never a partial total). */
function ImpactTable({ items }) {
  const results = useBreakdowns(items.map((i) => i.entry.id))
  const failed = results.find((r) => r.error)
  const total = results.every((r) => r.data) ? results.reduce((sum, r) => sum + Number(r.data.request_cost ?? 0), 0) : null
  const pending = <Skeleton width={72} sx={{ ml: 'auto' }} />
  return (
    <>
      <ErrorAlert error={failed?.error} sx={{ mb: 1 }}
        onRetry={() => results.forEach((r) => { if (r.error) r.refetch() })} />
      <Table size="small" aria-label="Budget impact of the selected entries">
        <TableHead>
          <TableRow>
            <TableCell>Entry</TableCell>
            <TableCell align="right">Hours</TableCell>
            <TableCell align="right">Cost</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {items.map((item, n) => {
            const r = results[n]
            return (
              <TableRow key={idOf(item)}>
                <TableCell component="th" scope="row">{`${item.user.name} · ${formatDate(item.entry.work_date)}`}</TableCell>
                <TableCell align="right">{formatHours(item.entry.hours)}</TableCell>
                <TableCell align="right">{r?.data ? exact(r.data.request_cost) : r?.error ? '—' : pending}</TableCell>
              </TableRow>
            )
          })}
          <TableRow sx={{ '& > *': { fontWeight: 600 } }}>
            <TableCell component="th" scope="row">Total</TableCell>
            <TableCell align="right">{formatHours(hoursOf(items))}</TableCell>
            <TableCell align="right">{total != null ? exact(total) : failed ? '—' : pending}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </>
  )
}

/** "Budget impact": today's breakdown for one entry, or each entry's cost and the total for several. */
function BudgetImpactDialog({ items, onClose }) {
  const titleId = useId()
  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} maxWidth="sm" fullWidth>
      <DialogTitle id={titleId}>Budget impact</DialogTitle>
      <DialogContent>
        {items.length === 1 ? <BreakdownPanel entryId={items[0].entry.id} /> : <ImpactTable items={items} />}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ minHeight: 44 }}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * The milestone panel's Approvals tab (spec §4.4), for people who decide hours: the milestone's pending entries by
 * person and week, oldest week first, with a sticky footer to act on the selected ones.
 *
 * - **Approve <N>h** sends one `POST /approvals/approve-week` per person-week in the selection, one after another, each
 *   with only that week's selected entries and the hours shown (the server's stale-entry guard). Each week is all or
 *   nothing on the server; a week that fails (stale `409`, already decided `400`) shows the server's message here
 *   while the other weeks' results stand, and the list is refetched. Each approved week toasts "Approved <N>h for <name>".
 * - **Request changes** asks for one reason, then rejects each selected entry with it; one toast follows.
 * - **View budget impact**: up to 20 entries, each breakdown fetched once.
 * - After every refetch the selection keeps only entries still listed, so the counts match what is on screen.
 * The server never lists the viewer's own entries, so they can't be selected.
 */
export default function ApprovalsTab({ milestone }) {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const toast = useToast()
  const approvals = useApprovals({ milestone: milestone.id })
  const approveWeek = useApproveWeek({ success: (_data, sent) => `Approved ${formatHours(hoursOf(sent))} for ${sent[0].user.name}` })
  const reject = useRejectEntry({ success: null })
  const [selected, setSelected] = useState(() => new Set())
  const [prunedFor, setPrunedFor] = useState(approvals.data)
  const [busy, setBusy] = useState(false)
  const [failures, setFailures] = useState([])
  const [dialog, setDialog] = useState(null)   // 'reject' | 'impact'

  const items = approvals.data ?? []
  // Every refetch (after a decision, or the 30-second refresh) drops entries no longer listed from the selection.
  if (approvals.data !== prunedFor) {
    setPrunedFor(approvals.data)
    const listed = new Set(items.map(idOf))
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => listed.has(id)))
      return next.size === prev.size ? prev : next
    })
  }
  const chosen = items.filter((i) => selected.has(idOf(i)))
  const count = chosen.length
  const hours = hoursOf(chosen)

  const toggle = (item) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(idOf(item))) next.delete(idOf(item))
    else next.add(idOf(item))
    return next
  })
  const toggleAll = (groupItems, on) => setSelected((prev) => {
    const next = new Set(prev)
    for (const item of groupItems) {
      if (on) next.add(idOf(item))
      else next.delete(idOf(item))
    }
    return next
  })

  const approve = async () => {
    setBusy(true)
    setFailures([])
    const failed = []
    for (const week of groupByPersonWeek(chosen)) {
      try {
        await approveWeek.mutateAsync(week.items)
      } catch (error) {
        failed.push({ key: week.key, title: `${week.user.name} · Week of ${formatDate(week.week)}`, error })
      }
    }
    setFailures(failed)
    setBusy(false)
    if (failed.length) approvals.refetch()
  }

  const requestChanges = async (reason) => {
    setBusy(true)
    setFailures([])
    const failed = []
    let done = 0
    for (const item of chosen) {
      try {
        await reject.mutateAsync({ id: item.entry.id, reason, expectedHours: item.entry.hours })
        done += 1
      } catch (error) {
        failed.push({ key: idOf(item), title: `${item.user.name} · ${formatDate(item.entry.work_date)}`, error })
      }
    }
    setFailures(failed)
    setBusy(false)
    setDialog(null)
    if (done) toast.success(`Requested changes on ${plural(done, 'entry', 'entries')}`)
    if (failed.length) approvals.refetch()
  }

  if (approvals.isLoading) {
    return <Stack sx={{ gap: 1 }}>{[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={44} />)}</Stack>
  }
  if (approvals.error && !approvals.data) {
    return <ErrorAlert error={approvals.error} onRetry={() => approvals.refetch()} />
  }
  if (!items.length) {
    return (
      <>
        {failures.map((f) => <ErrorAlert key={f.key} error={f.error} title={f.title} sx={{ mb: 1 }} />)}
        <EmptyState title="Nothing waiting" />
      </>
    )
  }

  const tooMany = count > IMPACT_MAX
  const impact = (
    <Button startIcon={<InfoOutlined />} disabled={!count || tooMany || busy} onClick={() => setDialog('impact')}
      sx={{ minHeight: 44 }}>
      View budget impact
    </Button>
  )

  return (
    <Stack sx={{ gap: 2 }}>
      <Box>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          {`${plural(items.length, 'entry', 'entries')} · ${formatHours(hoursOf(items))} awaiting approval`}
        </Typography>
        <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center', mt: 0.5 }}>
          <WarningAmber aria-hidden="true" fontSize="small" sx={{ color: 'warning.main' }} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Milestone completion does not approve time entries.</Typography>
        </Stack>
      </Box>
      {failures.map((f) => <ErrorAlert key={f.key} error={f.error} title={f.title} />)}
      {approvals.error ? <ErrorAlert error={approvals.error} onRetry={() => approvals.refetch()} /> : null}
      {groupByPersonWeek(items).map((g) => (
        <PersonWeek key={g.key} group={g} selected={selected} onToggle={toggle} onToggleAll={toggleAll} desktop={desktop} />
      ))}
      <Stack direction="row" useFlexGap sx={{ position: 'sticky', bottom: 0, zIndex: 1, mx: -2, px: 2, py: 1, gap: 1,
        flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', bgcolor: 'background.paper', borderTop: 1,
        borderColor: 'divider' }}>
        <Stack direction="row" useFlexGap sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Typography variant="body2" role="status" sx={{ fontWeight: count ? 600 : 400 }}>
            {count ? `${count} selected · ${formatHours(hours)}` : 'Select entries to review'}
          </Typography>
          {tooMany ? <Tooltip title="Select 20 entries or fewer to see the budget impact"><span>{impact}</span></Tooltip> : impact}
        </Stack>
        <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
          <Button variant="outlined" disabled={!count || busy} onClick={() => setDialog('reject')} sx={{ minHeight: 44 }}>
            Request changes
          </Button>
          <Button variant="contained" disabled={!count || busy} onClick={approve} sx={{ minHeight: 44 }}>
            {count ? `Approve ${formatHours(hours)}` : 'Approve'}
          </Button>
        </Stack>
      </Stack>
      {dialog === 'reject' && count ? (
        <RequestChangesDialog busy={busy} onSubmit={requestChanges} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'impact' && count ? <BudgetImpactDialog items={chosen} onClose={() => setDialog(null)} /> : null}
    </Stack>
  )
}
