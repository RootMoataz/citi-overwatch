import { Grid, Paper, Stack, Typography } from '@mui/material'
import { useProjectSummary } from '../../api/queries.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PersonWithAvatar from '../../components/PersonWithAvatar.jsx'
import { RISK_LABELS, WORK_MODE } from '../../lib/labels.js'
import { formatDate, formatMoney, formatPct } from '../../lib/format.js'
import StatTile from '../../components/StatTile.jsx'
import { TONE_TEXT } from '../../app/chartColors.js'
import { projectEffort } from '../../lib/estimates.js'

/** Who else may approve this project's hours, and until when. */
function DelegateLine({ delegate }) {
  const text = delegate.active
    ? `Approvals delegated to ${delegate.name} ${delegate.until ? `until ${formatDate(delegate.until)}` : 'until further notice'}`
    : `Delegation to ${delegate.name} ended ${formatDate(delegate.until)}`
  return <Typography variant="body2" sx={{ color: delegate.active ? 'info.main' : 'text.secondary', mb: 0.5 }}>{text}</Typography>
}

export default function OverviewTab({ project }) {
  const summary = useProjectSummary(project.id)
  const s = summary.data
  const effort = projectEffort(s?.project ?? project)
  const tile = { xs: 6, md: 'grow' }
  return (
    <Stack sx={{ gap: 3 }}>
      <ErrorAlert error={summary.error} onRetry={() => summary.refetch()} />
      <Grid container spacing={2}>
        <Grid size={tile}><StatTile label="Progress" value={Number(s?.progress_pct ?? project.progress_pct)} format={formatPct}
          hint="Milestones done, weighted by difficulty" /></Grid>
        <Grid size={tile}><StatTile label="Budget used" value={Number(s?.budget_pct ?? project.budget_pct)} format={formatPct}
          hint={`${formatMoney(s?.consumed ?? project.consumed)} of ${formatMoney(project.budget)}`} /></Grid>
        <Grid size={tile}><StatTile label="Team" value={s?.member_count ?? '—'} hint="people on this project" /></Grid>
        <Grid size={tile}><StatTile label="Predicted end" value={formatDate(project.predicted_end_date)}
          hint={`Started ${formatDate(project.start_date)}`} /></Grid>
        <Grid size={tile}><StatTile label="Estimated effort" value={effort.value} hint={effort.hint}
          tone={effort.tone === 'ok' ? undefined : TONE_TEXT[effort.tone].split('.')[0]} /></Grid>
      </Grid>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h3" component="h2" sx={{ mb: 1 }}>About</Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{project.description || 'No description yet.'}</Typography>
        <Typography variant="body2" component="div" sx={{ color: 'text.secondary', mt: 2, mb: 0.5 }}>
          Manager: <PersonWithAvatar person={project.manager} sx={{ ml: 0.5, color: 'text.primary' }} />
        </Typography>
        {project.delegate ? <DelegateLine delegate={project.delegate} /> : null}
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>Department: {project.department?.name ?? 'None'}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {WORK_MODE[project.work_mode ?? 'push'].label} mode: {WORK_MODE[project.work_mode ?? 'push'].help.toLowerCase()}
        </Typography>
      </Paper>
      {project.at_risk_reasons.length ? (
        <Paper variant="outlined" sx={{ p: 2, borderColor: 'warning.main' }}>
          <Typography variant="h3" component="h2" sx={{ mb: 1 }}>Why it's at risk</Typography>
          <Stack component="ul" sx={{ m: 0, pl: 3 }}>
            {project.at_risk_reasons.map((r) => <Typography component="li" variant="body2" key={r}>{RISK_LABELS[r] ?? r}</Typography>)}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  )
}
