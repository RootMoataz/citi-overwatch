import { Chip, List, ListItem, ListItemText, Skeleton } from '@mui/material'
import { useMissingTimesheets } from '../../api/queries.js'
import EmptyState from '../../components/EmptyState.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PersonWithAvatar from '../../components/PersonWithAvatar.jsx'
import { formatDate } from '../../lib/format.js'
import Section from './Section.jsx'

// The server lists only the viewer's own people (the dashboard's scope), so a manager may open each profile.
const MANAGED = { managed: true }

/** Managers and admins: who in their scope is on an active project but has no pending or approved hours for the
 * week. From Friday 14:00 (New York time) it's this week, and those people also get a bell reminder; before that
 * it's last week. */
export default function MissingTimesheets({ department }) {
  const missing = useMissingTimesheets(department)
  const d = missing.data
  const week = d ? formatDate(d.week_start) : ''
  return (
    <Section question="Missing timesheets"
      hint={d ? `Nothing logged for the week of ${week}${d.due ? ' (this week; reminders sent)' : ' (last week)'}` : null}
      action={d?.people.length ? <Chip size="small" color="warning" label={`${d.people.length} missing`} /> : null}>
      {missing.isLoading ? <Skeleton variant="rounded" height={80} /> : null}
      <ErrorAlert error={missing.error} onRetry={() => missing.refetch()} />
      {d && d.people.length ? (
        <List dense disablePadding aria-label={`Missing timesheets for the week of ${week}`}
          sx={{ display: 'grid', columnGap: 2, // minmax(0, …): a long name ends in an ellipsis instead of widening the page
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
          {d.people.map((p) => (
            <ListItem key={p.id} disableGutters>
              <ListItemText primary={<PersonWithAvatar person={p} context={MANAGED} />}
                secondary={p.job_title || null} slotProps={{ secondary: { sx: { pl: 4 } } }} />
            </ListItem>
          ))}
        </List>
      ) : null}
      {d && !d.people.length ? <EmptyState title="Everyone has logged hours" description={`For the week of ${week}.`} /> : null}
    </Section>
  )
}
