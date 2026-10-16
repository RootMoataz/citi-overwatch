import { Box, Button, Chip, Skeleton, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { useClaimMilestone, useMilestonesOf, useProjects } from '../../api/queries.js'
import DifficultyChip from '../../components/DifficultyChip.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PriorityChip from '../../components/PriorityChip.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { formatDate, nyTodayIso, plural } from '../../lib/format.js'
import Section from '../dashboard/Section.jsx'
import { ProjectLink } from './MilestoneGroups.jsx'
import { isOverdue, urgentFirst } from './myWork.js'

// Projects whose milestones can be claimed (the server also refuses claims on other statuses).
const CLAIMABLE_PROJECT = new Set(['planned', 'active'])

function MilestoneItem({ m, today, action }) {
  return (
    <Box component="li" sx={{ py: 1.5, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0, pt: 0 } }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, justifyContent: 'space-between', alignItems: { sm: 'center' } }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="h3" sx={{ lineHeight: 1.3 }}>{m.name}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            <ProjectLink project={m.project} /> · due {formatDate(m.end_date)}
          </Typography>
        </Box>
        <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
          {isOverdue(m, today) ? <Chip size="small" color="error" variant="outlined" label="Overdue" /> : null}
          <StatusChip status={m.status} />
          <PriorityChip priority={m.priority} hideDefault />
          <DifficultyChip difficulty={m.difficulty} />
          {action}
        </Stack>
      </Stack>
    </Box>
  )
}

function ClaimButton({ milestone }) {
  const claim = useClaimMilestone(milestone.project_id)
  const [failure, setFailure] = useState(null)
  const take = async () => {
    setFailure(null)
    try { await claim.mutateAsync(milestone.id) } catch (err) { setFailure(err) }
  }
  return (
    <>
      <Button size="small" variant="contained" aria-label={`Claim ${milestone.name}`} disabled={claim.isPending} onClick={take}
        sx={{ minHeight: 44 }}>
        Claim
      </Button>
      {failure ? <Box sx={{ flexBasis: '100%' }}><ErrorAlert error={failure} /></Box> : null}
    </>
  )
}

/** "Available to claim": ready, unowned milestones in pull-mode projects the employee is on. Collapses under `claim`. */
export default function Claimable({ sections }) {
  const projects = useProjects({})
  const pull = (projects.data?.items ?? []).filter((p) => p.work_mode === 'pull' && CLAIMABLE_PROJECT.has(p.status))
  const milestones = useMilestonesOf(pull.map((p) => p.id))
  const nameOf = new Map(pull.map((p) => [String(p.id), p.name]))
  const today = nyTodayIso()
  const open = milestones.data.filter((m) => m.can_claim)
    .map((m) => ({ ...m, project: { id: m.project_id, name: nameOf.get(String(m.project_id)) } })).sort(urgentFirst(today))
  const loading = projects.isLoading || milestones.isLoading
  const error = projects.error ?? milestones.error
  // The count is only shown once it's known: not while loading, and not after a failed read.
  const known = !loading && !error
  return (
    <Section collapsible open={sections.isOpen('claim')} onToggle={() => sections.toggle('claim')}
      question={known ? `Available to claim · ${open.length}` : 'Available to claim'}
      buttonLabel={known ? `Available to claim, ${plural(open.length, 'milestone')}` : 'Available to claim'}
      hint="Pull-mode projects you're on: take a ready milestone that nobody owns yet.">
      <ErrorAlert error={error} onRetry={() => { projects.refetch(); milestones.refetch() }} />
      {loading ? <Skeleton variant="rounded" height={64} /> : open.length ? (
        <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {open.map((m) => <MilestoneItem key={m.id} m={m} today={today} action={<ClaimButton milestone={m} />} />)}
        </Box>
      ) : known ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>No unassigned milestones available right now.</Typography>
      ) : null}
    </Section>
  )
}
