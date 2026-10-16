import PanTool from '@mui/icons-material/PanToolOutlined'
import { Box, Button, LinearProgress, Stack, Tooltip, Typography } from '@mui/material'
import { useState } from 'react'
import { useClaimMilestone, useMilestoneStatus } from '../../../api/queries.js'
import DifficultyChip from '../../../components/DifficultyChip.jsx'
import ErrorAlert from '../../../components/ErrorAlert.jsx'
import EstimateLine from '../../../components/EstimateLine.jsx'
import PriorityChip from '../../../components/PriorityChip.jsx'
import StatusChip from '../../../components/StatusChip.jsx'
import { statusActions } from '../../../lib/milestoneActions.js'
import MilestonePendingHours from '../../approvals/MilestonePendingHours.jsx'
import TimerButton from '../../timer/TimerButton.jsx'
import { useLoggable } from '../../timer/useLoggable.js'
import KickbackDialog from '../KickbackDialog.jsx'
import KickbackPanel from '../KickbackPanel.jsx'
import MilestoneDetails from '../MilestoneDetails.jsx'
import { stateOf } from '../milestoneOrder.js'

const Label = ({ children }) => (
  <Typography variant="caption" component="h3" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>{children}</Typography>
)

/**
 * The Details tab: priority and difficulty, the estimate and progress, the open kickback, the viewer's actions
 * (Claim, the status moves, Kick back, the timer), the objective, criteria and skills, the dependencies with their
 * state (the assignees, with who only supports, are the panel's facts above the tabs). `onEdit` is the kickback's "Edit or reassign" (managers). `decides` adds the milestone's
 * pending entries here until the Approvals tab takes them over.
 */
export default function DetailsTab({ milestone: m, items, project, manage, decides = false, onEdit }) {
  const status = useMilestoneStatus(project.id)
  const claim = useClaimMilestone(project.id)
  const loggable = useLoggable()
  const [kicking, setKicking] = useState(false)
  const [failure, setFailure] = useState(null)
  const predecessors = (m.predecessors ?? []).map((id) => items.find((x) => String(x.id) === String(id))).filter(Boolean)
  const actions = statusActions(m, { manager: manage, assignee: m.is_assignee })

  const run = async (action) => {
    setFailure(null)
    try { await action() } catch (err) { setFailure(err) }
  }

  return (
    <Stack sx={{ gap: 1.5 }}>
      <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        <PriorityChip priority={m.priority} />
        <DifficultyChip difficulty={m.difficulty} />
      </Stack>
      <EstimateLine milestone={m} />
      {m.progress_percent != null && m.status !== 'completed' ? (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, maxWidth: 320 }}>
          <LinearProgress variant="determinate" value={m.progress_percent} sx={{ flex: 1, height: 6, borderRadius: 3 }}
            aria-label={`${m.name}: ${m.progress_percent}% complete, from the latest update`} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>{m.progress_percent}% done</Typography>
        </Stack>
      ) : null}
      <KickbackPanel milestone={m} onEdit={manage ? onEdit : undefined} />
      <ErrorAlert error={failure} />
      <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {m.can_claim ? (
          <Button size="small" variant="contained" aria-label={`Claim ${m.name}`} disabled={claim.isPending}
            onClick={() => run(() => claim.mutateAsync(m.id))}>
            Claim
          </Button>
        ) : null}
        {actions.map((a) => {
          const blocked = m.blocked && m.status === 'not_started'
          const button = (
            <Button key={a.target + a.label} size="small" variant={a.primary ? 'contained' : 'outlined'}
              disabled={blocked || status.isPending} onClick={() => run(() => status.mutateAsync({ id: m.id, status: a.target }))}>
              {a.label}
            </Button>
          )
          return blocked
            ? <Tooltip key={a.label} title={`Waiting on: ${predecessors.map((p) => p.name).join(', ')}`}><span>{button}</span></Tooltip>
            : button
        })}
        {m.can_kick_back ? (
          <Button size="small" color="error" variant="outlined" startIcon={<PanTool />} onClick={() => setKicking(true)}>Kick back</Button>
        ) : null}
        {loggable.has(String(m.id)) ? <TimerButton milestone={m} /> : null}
      </Stack>
      <MilestoneDetails milestone={m} />
      <Box>
        <Label>Dependencies</Label>
        {predecessors.length ? (
          <Stack component="ul" aria-label="Dependencies" sx={{ listStyle: 'none', p: 0, m: 0, gap: 0.5 }}>
            {predecessors.map((p) => (
              <Stack component="li" key={p.id} direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2">{p.name}</Typography>
                <StatusChip status={stateOf(p)} icon />
              </Stack>
            ))}
          </Stack>
        ) : <Typography variant="body2" sx={{ color: 'text.secondary' }}>None</Typography>}
      </Box>
      {decides ? <MilestonePendingHours milestone={m} /> : null}
      {kicking ? <KickbackDialog milestone={m} onClose={() => setKicking(false)} /> : null}
    </Stack>
  )
}
