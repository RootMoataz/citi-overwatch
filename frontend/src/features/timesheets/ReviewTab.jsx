import { Box, Button, Chip, FormControlLabel, Paper, Skeleton, Stack, Switch, Typography } from '@mui/material'
import { useId, useState } from 'react'
import { useApprovals, useApproveWeek } from '../../api/queries.js'
import Critical from '../../components/Critical.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import ExportCsvButton from '../../components/ExportCsvButton.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { num } from '../../lib/csv.js'
import { formatDate, formatHours } from '../../lib/format.js'
import { groupByPersonWeek } from '../../lib/personWeeks.js'
import ApprovalRow from '../approvals/ApprovalRow.jsx'
import { FLAG_LABEL, SOURCE_LABEL, shareText } from '../timer/timerClock.js'

const CSV_COLUMNS = [
  { header: 'Person', value: (i) => i.user.name },
  { header: 'Project', value: (i) => i.project.name },
  { header: 'Milestone', value: (i) => i.milestone.name },
  { header: 'Date', value: (i) => i.entry.work_date },
  { header: 'Hours', value: (i) => num(i.entry.hours) },
  { header: 'Status', value: (i) => i.label },
  { header: 'Overtime', value: (i) => Boolean(i.entry.over_40) },
  { header: 'Edited after a decision', value: (i) => Boolean(i.entry.edited_after_decision) },
  { header: 'Changed after HR submission', value: (i) => Boolean(i.entry.changed_after_hr_submission) },
  { header: 'Week logged total (hours)', value: (i) => num(i.week_logged_total) },
  { header: 'Note', value: (i) => i.entry.note },
  { header: 'Source', value: (i) => SOURCE_LABEL[i.entry.source] ?? '' },
  { header: 'Tracked hours', value: (i) => num(i.entry.tracked_hours ?? 0) },
  { header: 'Red flags', value: (i) => (i.flags ?? []).map((f) => FLAG_LABEL[f.code] ?? f.code).join('; ') },
]

const flagged = (item) => Boolean(item.flags?.length)

function PersonWeek({ group }) {
  const titleId = useId()
  const approveWeek = useApproveWeek()
  const [failure, setFailure] = useState(null)
  const waiting = group.items.reduce((sum, i) => sum + Number(i.entry.hours), 0)
  const count = group.items.length
  const flags = group.items.reduce((sum, i) => sum + (i.flags?.length ?? 0), 0)
  const share = shareText(group.items.map((i) => i.entry))
  return (
    <Paper component="section" variant="outlined" aria-labelledby={titleId} sx={{ px: 2, pt: 2, pb: 0.5 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, alignItems: { sm: 'center' }, mb: 1 }}>
        <UserAvatar userId={group.user.id} name={group.user.name} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography id={titleId} variant="subtitle1" component="h2">
            <PersonLink person={group.user} context={{ managed: true }} />, week of {formatDate(group.week)}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            <Critical>{`${count} ${count === 1 ? 'entry' : 'entries'} · ${formatHours(waiting)} waiting`}</Critical>
            {` · ${formatHours(group.items[0].week_logged_total)} logged that week`}
            {share ? ` · ${share}` : ''}
          </Typography>
        </Box>
        {flags ? (
          <Chip size="small" color="warning" variant="outlined" label={`⚠ ${flags} red ${flags === 1 ? 'flag' : 'flags'}`}
            sx={{ flexShrink: 0 }} />
        ) : null}
        <Button variant="contained" disabled={approveWeek.isPending} sx={{ flexShrink: 0 }}
          onClick={async () => { setFailure(null); try { await approveWeek.mutateAsync(group.items) } catch (err) { setFailure(err) } }}>
          Approve week
        </Button>
      </Stack>
      <ErrorAlert error={failure} sx={{ mb: 1 }} />
      {group.items.map((item) => <ApprovalRow key={item.entry.id} item={item} />)}
    </Paper>
  )
}

/** Hours waiting for the viewer's decision. `filters` (user, project, milestone) come from alerts and links. */
export default function ReviewTab({ filters, onClearFilters }) {
  const approvals = useApprovals(filters)
  const items = approvals.data ?? []
  const [onlyFlagged, setOnlyFlagged] = useState(false)
  const all = groupByPersonWeek(items)
  // "Only flagged" keeps whole person-weeks (Approve week acts on the whole week) that have at least one red flag.
  const groups = onlyFlagged ? all.filter((g) => g.items.some(flagged)) : all
  return (
    <>
      <Stack direction="row" sx={{ gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1 }}>
          Every logged hour needs your approval before it counts toward the project budget. Rejecting needs a reason.
        </Typography>
        <FormControlLabel sx={{ mr: 0 }} label="Only flagged"
          control={<Switch checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} />} />
        {Object.keys(filters).length ? <Button onClick={onClearFilters}>Show everyone</Button> : null}
        <ExportCsvButton name="approvals" columns={CSV_COLUMNS} rows={items} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }} />
      </Stack>
      <ErrorAlert error={approvals.error} onRetry={() => approvals.refetch()} sx={{ mb: 2 }} />
      {approvals.isLoading ? <Skeleton variant="rounded" height={200} /> : null}
      {!approvals.isLoading && !approvals.error && items.length === 0 ? (
        <EmptyState title="Nothing waiting for approval" description="New hours from your team show up here." />
      ) : null}
      {onlyFlagged && items.length && !groups.length ? (
        <EmptyState title="No red flags" description="None of the hours waiting for you look unusual." />
      ) : null}
      <Stack sx={{ gap: 2 }}>
        {groups.map((g) => <PersonWeek key={g.key} group={g} />)}
      </Stack>
    </>
  )
}
