import EditOutlined from '@mui/icons-material/EditOutlined'
import { Box, Button, Chip, Stack, Tooltip, Typography } from '@mui/material'
import { useState } from 'react'
import { useWithdrawManualHours } from '../../api/queries.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { formatDayShort, formatHours } from '../../lib/format.js'
import ManualHoursDialog from '../timer/ManualHoursDialog.jsx'
import { REASONS } from '../timer/manualHours.js'

/** The label of a manual request's reason code ("Forgot to start the timer"). */
// eslint-disable-next-line react-refresh/only-export-components -- the panels print the same label
export const reasonLabel = (code) => REASONS.find(([c]) => c === code)?.[1] ?? code

/** "Manual request": the tag on hours logged without the timer. Focusable, named "Manual request: <reason>"; its
 * tooltip adds the details. */
export function ManualRequestChip({ manual }) {
  const label = reasonLabel(manual.reason)
  return (
    <Tooltip title={manual.details ? `${label}: ${manual.details}` : label}>
      <Chip size="small" variant="outlined" role="group" tabIndex={0} aria-label={`Manual request: ${label}`}
        icon={<EditOutlined aria-hidden="true" />} label="Manual request" sx={{ maxWidth: '100%' }} />
    </Tooltip>
  )
}

// Below md a small button is 44 px tall (the theme); keep it 44 px wide too.
const ACTION = (t) => ({ px: 0.5, minWidth: 0, [t.breakpoints.down('md')]: { minWidth: 44 } })

/** What can be done to a manual request: Edit (pending or approved) or Fix and resubmit (rejected), and with `withdraw`
 * Withdraw while it is pending and unedited since a decision. Nothing on a closed row; `unassigned` (the person left the milestone) hides the edit, which the server refuses, and keeps Withdraw. `row` = { milestone, project }. */
export function ManualActions({ entry, row, label, closed, unassigned = false, withdraw = false, onWithdrawn }) {
  const [dialog, setDialog] = useState(null)   // 'edit' | 'withdraw' | null
  const [failure, setFailure] = useState(null)
  const remove = useWithdrawManualHours()
  if (closed) return null
  const rejected = entry.status === 'rejected'
  const canWithdraw = withdraw && entry.status === 'pending' && !entry.edited_after_decision
  const confirm = async () => {
    setFailure(null)
    try {
      await remove.mutateAsync({ id: entry.id, hours: entry.hours, name: row.milestone.name, date: entry.work_date })
      setDialog(null)
      onWithdrawn?.()
    } catch (err) { setFailure(err) }
  }
  return (
    <>
      <Stack direction="row" useFlexGap sx={{ gap: 0.5, flexWrap: 'wrap', justifyContent: 'inherit' }}>
        {unassigned ? null : (
          <Button size="small" onClick={() => setDialog('edit')} sx={ACTION}
            aria-label={`${rejected ? 'Fix and resubmit' : 'Edit manual hours'}, ${label}`}>
            {rejected ? 'Fix and resubmit' : 'Edit'}
          </Button>
        )}
        {canWithdraw ? (
          <Button size="small" color="error" onClick={() => { setFailure(null); setDialog('withdraw') }} sx={ACTION}
            aria-label={`Withdraw, ${label}`}>
            Withdraw
          </Button>
        ) : null}
      </Stack>
      {dialog === 'edit' && !unassigned ? (
        <ManualHoursDialog milestone={row.milestone} project={row.project} day={entry.work_date} entry={entry}
          onClose={() => setDialog(null)} />
      ) : null}
      {canWithdraw && dialog === 'withdraw' ? (
        <ConfirmDialog open title="Withdraw these hours?" confirmLabel="Withdraw" busy={remove.isPending}
          body={`${formatHours(entry.hours)} on ${row.milestone.name}, ${formatDayShort(entry.work_date)}, are removed and your manager won't see them.`}
          onConfirm={confirm} onClose={() => setDialog(null)}>
          <ErrorAlert error={failure} sx={{ mt: 2 }} />
        </ConfirmDialog>
      ) : null}
    </>
  )
}

/** The hours of a manual request, read-only: the cell's box, as LockedCell draws a locked one, with a pencil. */
export function ManualBox({ entry, label }) {
  return (
    <Box role="group" aria-label={`${label}: ${formatHours(entry.hours)}, manual request`}
      sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, width: 76, height: 40,
        borderRadius: 1, border: 1, borderColor: 'divider', fontVariantNumeric: 'tabular-nums', bgcolor: 'action.hover', fontWeight: 600 }}>
      <EditOutlined aria-hidden="true" sx={{ fontSize: 15, color: 'text.secondary' }} />
      {formatHours(entry.hours)}
    </Box>
  )
}

/** A week-grid cell holding a manual request: the read-only box, the chip, the actions and, once rejected, the reason. */
export default function ManualCell({ entry, label, row, closed }) {
  return (
    <Box>
      <ManualBox entry={entry} label={label} />
      <Box sx={{ mt: 0.5 }}><ManualRequestChip manual={entry.manual} /></Box>
      <ManualActions entry={entry} row={row} label={label} closed={closed} unassigned={row.role === null} />
      {entry.status === 'rejected' && entry.rejection_reason ? (
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.2, mt: 0.25 }}>
          Reason: {entry.rejection_reason}
        </Typography>
      ) : null}
    </Box>
  )
}
