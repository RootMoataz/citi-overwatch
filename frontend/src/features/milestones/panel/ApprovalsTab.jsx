import ExpandMore from '@mui/icons-material/ExpandMore'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import WarningAmber from '@mui/icons-material/WarningAmberOutlined'
import {
  Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Skeleton, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Tooltip, Typography, Link,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useId, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useMediaQuery } from 'react-responsive'
import { useApprovals, useApproveWeek, useBreakdowns, useManualHours, useRejectEntry } from '../../../api/queries.js'
import { useToast } from '../../../app/toast.js'
import Critical from '../../../components/Critical.jsx'
import EmptyState from '../../../components/EmptyState.jsx'
import ErrorAlert from '../../../components/ErrorAlert.jsx'
import { formatDate, formatHours, formatMoney, plural } from '../../../lib/format.js'
import { groupByPersonWeek, pendingHoursOf as hoursOf } from '../../../lib/personWeeks.js'
import { DESKTOP_QUERY } from '../../../lib/responsive.js'
import BreakdownPanel from '../../approvals/BreakdownPanel.jsx'
import EntryCueChips from '../../approvals/EntryCueChips.jsx'
import { weekTotalText } from '../../approvals/entryCues.js'
import FlagChips from '../../timer/FlagChips.jsx'
import SourceChip from '../../timer/SourceChip.jsx'
import { SOURCE_LABEL, shareText, weekSource } from '../../timer/timerClock.js'

const IMPACT_MAX = 20     // "up to 20 at a time": one breakdown request per selected entry
const REASON_MAX = 1000   // the server's limit on a rejection reason

/** Manual-hours requests on the milestone are decided in Timesheets, one at a time; this says how many wait. */
function ManualNote({ milestoneId }) {
  const n = useManualHours({ milestone: milestoneId }).data?.length ?? 0
  if (!n) return null
  return (
    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
      {`${n} manual-hours ${n === 1 ? 'request on this milestone is' : 'requests on this milestone are'} reviewed separately. `}
      <Link component={RouterLink} to={`/timesheets?tab=manual&milestone=${milestoneId}`}>Review manual hours</Link>
    </Typography>
  )
}

const idOf = (item) => String(item.entry.id)
const exact = (value) => formatMoney(value, { exact: true })
const titleOf = (group) => `${group.user.name} · Week of ${formatDate(group.week)} · `
  + `${plural(group.items.length, 'entry', 'entries')} · ${formatHours(hoursOf(group.items))}`
const entryName = (item) => `${item.user.name}, ${formatDate(item.entry.work_date)}, ${formatHours(item.entry.hours)}`
// 44 px touch targets (24 px box + 10 px each side).
const BOX_SX = { p: 1.25 }
// Narrow cells so the table fits the panel at its desktop width: the note and the chips wrap instead of scrolling.
const TABLE_SX = { '& .MuiTableCell-root': { px: 1, verticalAlign: 'top' }, '& .MuiTableCell-paddingCheckbox': { px: 0 } }

/** The flags, then the entry's cues (overtime, edited, changed after HR), wrapping inside their cell. */
function Flags({ item, sx }) {
  return (
    <Stack direction="row" useFlexGap sx={{ gap: 0.5, flexWrap: 'wrap', alignItems: 'center', ...sx }}>
      <FlagChips flags={item.flags} />
      <EntryCueChips item={item} />
    </Stack>
  )
}

/** The work note, else the day's progress update after "Update: ", else null. */
function workNote(item) {
  const note = (item.entry.note ?? '').trim()
  if (note) return note
  const update = (item.progress_update?.body ?? '').trim()
  return update ? `Update: ${update}` : null
}

/**
 * One person's week: a collapsible header (with the person's hours that week and the week's Tracked, Manual or Mixed
 * share) over its entries.
 * `isChosen(item)` says whether an entry is selected at the hours it shows now.
 */
function PersonWeek({ group, isChosen, onToggle, onToggleAll, desktop }) {
  const [open, setOpen] = useState(true)
  const headingId = useId()
  const bodyId = useId()
  const title = titleOf(group)
  const chosen = group.items.filter(isChosen).length
  const all = chosen === group.items.length
  const entries = group.items.map((i) => i.entry)
  const source = weekSource(entries)
  const delegatedFrom = group.items.find((i) => i.delegated_from)?.delegated_from
  // The person's whole week, shown only when it says more than the group's own hours already in the title.
  const weekTotal = group.items.find((i) => i.week_logged_total != null
    && Math.abs(Number(i.week_logged_total) - hoursOf(group.items)) > 0.001)
  const selectAll = (
    <Checkbox checked={all} indeterminate={chosen > 0 && !all} onChange={() => onToggleAll(group.items, !all)} sx={BOX_SX}
      slotProps={{ input: { 'aria-label': `Select all: ${title}` } }} />
  )

  const rows = group.items.map((item) => {
    const id = idOf(item)
    const checked = isChosen(item)
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
          <TableCell sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatHours(item.entry.hours)}</TableCell>
          <TableCell>{sourceChip}</TableCell>
          <TableCell sx={{ overflowWrap: 'anywhere', color: note ? 'text.primary' : 'text.secondary' }}>{note ?? '—'}</TableCell>
          <TableCell sx={{ width: '30%' }}><Flags item={item} /></TableCell>
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
          <Flags item={item} sx={{ mt: 0.5 }} />
        </Box>
      </Box>
    )
  })

  return (
    <Box component="section" aria-labelledby={headingId}>
      {/* One line: the title's words wrap inside it, so the select-all (phones) and the chips stay beside it. */}
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'nowrap' }}>
        {desktop ? null : selectAll}
        <Typography id={headingId} variant="subtitle2" component="h4" sx={{ m: 0, minWidth: 0, flex: '0 1 auto' }}>
          <Button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId} color="inherit"
            startIcon={<ExpandMore sx={{ transform: open ? 'none' : 'rotate(-90deg)' }} />}
            sx={{ minHeight: 44, px: 0.5, textAlign: 'left', fontWeight: 600, textTransform: 'none', justifyContent: 'flex-start' }}>
            {title}
          </Button>
        </Typography>
        {weekTotal ? <Typography variant="body2" sx={{ color: 'text.secondary', flexShrink: 0 }}>{weekTotalText(weekTotal)}</Typography> : null}
        {delegatedFrom ? <Chip size="small" variant="outlined" color="info" label={`Delegated from ${delegatedFrom.name}`}
          sx={{ flexShrink: 1, minWidth: 0 }} /> : null}
        {source ? (
          // Focusable, so keyboard users can read the share in the tooltip too.
          <Tooltip title={shareText(entries)} describeChild>
            <Chip size="small" variant="outlined" color={source === 'manual' ? 'default' : 'info'} label={SOURCE_LABEL[source]}
              tabIndex={0} sx={{ flexShrink: 0 }} />
          </Tooltip>
        ) : null}
      </Stack>
      {open && desktop ? (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" id={bodyId} aria-label={`Entries of ${title}`} sx={TABLE_SX}>
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

/**
 * "Request changes": one required reason for every selected entry (the server's reject rules). `failures` are shown
 * here when nothing could be rejected, with the reason kept for another try; there is nothing to send once `count` is 0.
 */
function RequestChangesDialog({ count, busy, failures, onSubmit, onClose }) {
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
        {failures.map((f) => <ErrorAlert key={f.key} error={f.error} title={f.title} sx={{ mb: 1 }} />)}
        <TextField label="Reason" required multiline minRows={3} fullWidth autoFocus value={reason} error={Boolean(error)}
          helperText={error || undefined} onChange={(e) => { setReason(e.target.value); setError('') }} disabled={busy}
          slotProps={{ htmlInput: { maxLength: REASON_MAX } }} sx={{ mt: 1 }} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy} sx={{ minHeight: 44 }}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={busy || !count} sx={{ minHeight: 44 }}>Request changes</Button>
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

const listFormat = new Intl.ListFormat('en', { type: 'conjunction' })

/**
 * The milestone panel's Approvals tab (spec §4.4), for people who decide hours: the milestone's pending entries by
 * person and week, oldest week first, with a sticky footer to act on the selected ones.
 *
 * - **Approve <N>h** sends one `POST /approvals/approve-week` per person-week in the selection, one after another, each
 *   with only that week's selected entries and the hours shown (the server's stale-entry guard). Each week is all or
 *   nothing on the server; a week that fails (stale `409`, already decided `400`) shows the server's message here
 *   while the other weeks' results stand, and the list is refetched. One toast covers what was approved:
 *   "Approved 41h for Gia Rossi" (or "… for Gia Rossi and Ada Lovelace"); none when nothing was.
 * - **Request changes** asks for one reason, then rejects each selected entry with it; one toast follows. When nothing
 *   could be rejected the dialog stays open with the reason and the errors.
 * - **View budget impact**: up to 20 entries, each breakdown fetched once.
 * - The selection remembers the hours each entry showed when it was ticked. After every refetch it keeps only entries
 *   still listed at those hours, so the counts match what is on screen and a changed entry must be ticked again.
 * The server never lists the viewer's own entries, so they can't be selected.
 */
export default function ApprovalsTab({ milestone }) {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const toast = useToast()
  const approvals = useApprovals({ milestone: milestone.id })
  const approveWeek = useApproveWeek({ success: null })
  const reject = useRejectEntry({ success: null })
  const [selected, setSelected] = useState(() => new Map())   // entry id → the hours it showed when ticked
  const [prunedFor, setPrunedFor] = useState(approvals.data)
  const [busy, setBusy] = useState(false)
  const [failures, setFailures] = useState([])
  const [rejectFailures, setRejectFailures] = useState([])
  const [dialog, setDialog] = useState(null)   // 'reject' | 'impact'

  const items = approvals.data ?? []
  // Every refetch (after a decision, or the 30-second refresh) drops from the selection the entries no longer listed
  // and those whose hours changed since they were ticked.
  if (approvals.data !== prunedFor) {
    setPrunedFor(approvals.data)
    const listed = new Map(items.map((i) => [idOf(i), Number(i.entry.hours)]))
    setSelected((prev) => {
      const next = new Map([...prev].filter(([id, h]) => listed.get(id) === h))
      return next.size === prev.size ? prev : next
    })
  }
  const isChosen = (item) => selected.get(idOf(item)) === Number(item.entry.hours)
  const chosen = items.filter(isChosen)
  const count = chosen.length
  const hours = hoursOf(chosen)

  const toggle = (item) => setSelected((prev) => {
    const next = new Map(prev)
    if (next.get(idOf(item)) === Number(item.entry.hours)) next.delete(idOf(item))
    else next.set(idOf(item), Number(item.entry.hours))
    return next
  })
  const toggleAll = (groupItems, on) => setSelected((prev) => {
    const next = new Map(prev)
    for (const item of groupItems) {
      if (on) next.set(idOf(item), Number(item.entry.hours))
      else next.delete(idOf(item))
    }
    return next
  })

  const approve = async () => {
    setBusy(true)
    setFailures([])
    const approved = []
    const failed = []
    for (const week of groupByPersonWeek(chosen)) {
      try {
        await approveWeek.mutateAsync(week.items)
        approved.push(week)
      } catch (error) {
        failed.push({ key: week.key, title: `${week.user.name} · Week of ${formatDate(week.week)}`, error })
      }
    }
    setFailures(failed)
    setBusy(false)
    if (approved.length) {
      const names = [...new Set(approved.map((w) => w.user.name))]
      toast.success(`Approved ${formatHours(hoursOf(approved.flatMap((w) => w.items)))} for ${listFormat.format(names)}`)
    }
    if (failed.length) approvals.refetch()
  }

  const requestChanges = async (reason) => {
    setBusy(true)
    setFailures([])
    setRejectFailures([])
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
    setBusy(false)
    if (done) {
      setFailures(failed)
      setDialog(null)
      toast.success(`Requested changes on ${plural(done, 'entry', 'entries')}`)
    } else {
      setRejectFailures(failed)   // nothing was rejected: keep the dialog and its reason
    }
    if (failed.length) approvals.refetch()
  }
  const closeDialog = () => { setDialog(null); setRejectFailures([]) }
  const rejectDialog = dialog === 'reject' ? (
    <RequestChangesDialog count={count} busy={busy} failures={rejectFailures} onSubmit={requestChanges} onClose={closeDialog} />
  ) : null

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
        <ManualNote milestoneId={milestone.id} />
        {rejectDialog}
      </>
    )
  }

  const tooMany = count > IMPACT_MAX
  const impact = (
    <Button startIcon={<InfoOutlined />} disabled={!count || tooMany || busy} onClick={() => setDialog('impact')}
      sx={{ minHeight: 44, whiteSpace: 'nowrap', px: 1, '& .MuiButton-startIcon': { mr: 0.5, display: { md: 'none', xs: 'inherit' } } }}>
      View budget impact
    </Button>
  )

  return (
    <Stack sx={{ gap: 2 }}>
      <Box>
        <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600 }}>
          <Critical>{`${plural(items.length, 'entry', 'entries')} · ${formatHours(hoursOf(items))} awaiting approval`}</Critical>
        </Typography>
        <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center', mt: 0.5 }}>
          <WarningAmber aria-hidden="true" fontSize="small" sx={{ color: 'warning.main' }} />
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>Milestone completion does not approve time entries.</Typography>
        </Stack>
        <ManualNote milestoneId={milestone.id} />
      </Box>
      {failures.map((f) => <ErrorAlert key={f.key} error={f.error} title={f.title} />)}
      {approvals.error ? <ErrorAlert error={approvals.error} onRetry={() => approvals.refetch()} /> : null}
      {groupByPersonWeek(items).map((g) => (
        <PersonWeek key={g.key} group={g} isChosen={isChosen} onToggle={toggle} onToggleAll={toggleAll} desktop={desktop} />
      ))}
      {/* Sticky at the bottom of the panel. On phones the sheet's scroller has 16 px of padding, which browsers keep
          between a sticky box and the scroller's edge, so the footer moves down by that much to sit flush. */}
      <Stack role="group" aria-label="Review selected entries" direction="row" useFlexGap
        sx={{ position: 'sticky', bottom: desktop ? 0 : (t) => t.spacing(-2), zIndex: 1, mx: -2, px: 2, py: 1, gap: 1,
          flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', bgcolor: 'background.paper', borderTop: 1,
          borderColor: 'divider' }}>
        <Typography variant="body2" role="status" sx={{ fontWeight: count ? 600 : 400, flex: '1 1 6rem', minWidth: 0 }}>
          {count ? `${count} selected · ${formatHours(hours)}` : 'Select entries to review'}
        </Typography>
        {/* One row at the panel's desktop width: the selection on the left, the three actions on the right; the phone
            sheet (narrower) lets the actions drop under the text. */}
        <Stack direction="row" useFlexGap sx={{ gap: 0.5, flexWrap: { xs: 'wrap', md: 'nowrap' }, alignItems: 'center', justifyContent: 'flex-end', flex: '0 0 auto' }}>
          {tooMany ? <Tooltip title="Select 20 entries or fewer to see the budget impact"><span>{impact}</span></Tooltip> : impact}
          <Button variant="outlined" disabled={!count || busy} onClick={() => setDialog('reject')} sx={{ minHeight: 44, whiteSpace: 'nowrap', px: 1.5 }}>
            Request changes
          </Button>
          <Button variant="contained" disabled={!count || busy} onClick={approve} sx={{ minHeight: 44, whiteSpace: 'nowrap', px: 1.5 }}>
            {count ? `Approve ${formatHours(hours)}` : 'Approve'}
          </Button>
        </Stack>
      </Stack>
      {rejectDialog}
      {dialog === 'impact' && count && !tooMany ? <BudgetImpactDialog items={chosen} onClose={() => setDialog(null)} /> : null}
    </Stack>
  )
}
