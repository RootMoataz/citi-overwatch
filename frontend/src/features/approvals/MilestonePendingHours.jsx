import { Box, Typography } from '@mui/material'
import { useApprovals } from '../../api/queries.js'
import ApprovalRow from './ApprovalRow.jsx'

/** Inside a milestone, its manager sees the hours waiting for approval and what each would cost. */
export default function MilestonePendingHours({ milestone }) {
  const approvals = useApprovals({ milestone: milestone.id })
  const items = approvals.data ?? []
  if (!items.length) return null
  return (
    <Box data-pending-hours sx={{ mt: 2, p: 1.5, borderRadius: 1, bgcolor: 'action.hover' }}>
      <Typography variant="subtitle2" component="p">
        {items.length} {items.length === 1 ? 'entry' : 'entries'} waiting for approval
      </Typography>
      {items.map((item) => <ApprovalRow key={item.entry.id} item={item} showContext={false} />)}
    </Box>
  )
}
