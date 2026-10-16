import CalendarToday from '@mui/icons-material/CalendarTodayOutlined'
import CheckCircle from '@mui/icons-material/CheckCircle'
import ChevronRight from '@mui/icons-material/ChevronRight'
import { Box, Chip, IconButton, Link, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { STATUS, statusColor } from '../../app/theme.js'
import DifficultyChip from '../../components/DifficultyChip.jsx'
import PriorityChip from '../../components/PriorityChip.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import SupportingChip from '../../components/SupportingChip.jsx'
import { formatDate, plural } from '../../lib/format.js'
import Section from '../dashboard/Section.jsx'
import { milestoneHref, stateKey } from '../timesheet/monthText.js'
import TimerButton from '../timer/TimerButton.jsx'
import { useLoggable } from '../timer/useLoggable.js'
import { comingLabel, dueLine, skillsSentence, upNextLabel } from './myWork.js'

/** "See what might come your way" and the heads-up scroll to this section and its rows. */
export const COMING_ID = 'myweek-coming'
const INTRO = 'When the milestone before one of these is completed, auto-routing picks someone on the team with the right '
  + "skills. It's a likely pick, not a promise."

export function ProjectLink({ project }) {
  return (
    <Link component={RouterLink} to={`/projects/${project.id}?tab=milestones`} underline="hover">{project.name}</Link>
  )
}

/** A row's way into the milestone's panel on its project page; no visible text, so it carries the milestone's name. */
export function ChevronLink({ name, to }) {
  return (
    <IconButton component={RouterLink} to={to} aria-label={`View milestone ${name}`}
      sx={{ width: 44, height: 44, flexShrink: 0, color: 'text.secondary' }}>
      <ChevronRight aria-hidden="true" />
    </IconButton>
  )
}

/** A calendar icon and a date line, in the error colour when overdue (the words say so too). */
export function DateLine({ text, overdue = false }) {
  return (
    <Typography variant="body2" component="span"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: overdue ? 'error.main' : 'text.secondary' }}>
      <CalendarToday aria-hidden="true" sx={{ fontSize: 16 }} />
      {text}
    </Typography>
  )
}

export function NewChip() {
  return <Chip size="small" color="primary" label="New" sx={{ height: 20, '& .MuiChip-label': { px: 0.75 } }} />
}

const Words = ({ children, muted = false }) => (
  <Typography variant="body2" component="span" sx={muted ? { color: 'text.secondary' } : undefined}>{children}</Typography>
)

/** One milestone: an optional lead icon, the name (H3) and project link, its details (wrapping under the name on
 * narrow screens), and the chevron into its panel. */
function Row({ name, project, to, lead, details, id, focusable = false }) {
  return (
    <Box component="li" id={id} tabIndex={focusable ? -1 : undefined}
      sx={(t) => ({
        display: 'flex', alignItems: 'center', gap: 1.5, py: 1.25, borderTop: 1, borderColor: 'divider',
        '&:first-of-type': { borderTop: 0, pt: 0 },
        '&:focus-visible': { outline: `2px solid ${t.palette.primary.main}`, outlineOffset: 2, borderRadius: 1 },
      })}>
      {lead}
      <Stack direction="row" useFlexGap sx={{ flex: 1, minWidth: 0, flexWrap: 'wrap', gap: { xs: 0.75, sm: 2 },
        alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ minWidth: 0, flex: '1 1 12rem' }}>
          <Typography variant="subtitle1" component="h3" sx={{ lineHeight: 1.3, overflowWrap: 'anywhere' }}>{name}</Typography>
          <Typography variant="body2"><ProjectLink project={project} /></Typography>
        </Box>
        <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}>
          {details}
        </Stack>
      </Stack>
      <ChevronLink name={name} to={to} />
    </Box>
  )
}

const List = ({ children }) => <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>{children}</Box>

/** A collapsible group, remembered under `k`; an empty group isn't shown at all. */
function Group({ k, sections, title, label, count, id, children }) {
  if (!count) return null
  return (
    <Section collapsible id={id} open={sections.isOpen(k)} onToggle={() => sections.toggle(k)} question={title}
      buttonLabel={`${label}, ${plural(count, 'milestone')}`}>
      {children}
    </Section>
  )
}

/** My week's groups: In progress, Upcoming, With your manager, Might come your way and Completed. */
export default function MilestoneGroups({ groups, comingUp, today, sections }) {
  const loggable = useLoggable()
  const { inProgress, upNext, review, done } = groups
  return (
    <>
      <Group k="inProgress" sections={sections} title={`In progress (${inProgress.length})`} label="In progress"
        count={inProgress.length}>
        <List>
          {inProgress.map((m) => (
            <Row key={m.id} name={m.name} project={m.project} to={milestoneHref(m)} details={(
              <>
                <DateLine {...dueLine(m, today)} />
                {m.progress_percent != null ? <Words>{`${m.progress_percent}% done`}</Words> : null}
                <StatusChip icon status={stateKey(m)} />
                <PriorityChip priority={m.priority} hideDefault />
                <DifficultyChip difficulty={m.difficulty} />
                {m.role === 'supporting' ? <SupportingChip /> : null}
                {loggable.has(String(m.id)) ? <TimerButton milestone={m} touch /> : null}
              </>
            )} />
          ))}
        </List>
      </Group>

      <Group k="upNext" sections={sections} title={`Upcoming (${upNext.length})`} label="Upcoming" count={upNext.length}>
        <List>
          {upNext.map((m) => (
            <Row key={m.id} name={m.name} project={m.project} to={milestoneHref(m)} details={(
              <>
                <DateLine {...dueLine(m, today)} />
                <StatusChip icon status={stateKey(m)} />
                <Words muted>{upNextLabel(m, today)}</Words>
                {loggable.has(String(m.id)) ? <TimerButton milestone={m} touch /> : null}
              </>
            )} />
          ))}
        </List>
      </Group>

      <Group k="review" sections={sections} title={`With your manager (${review.length})`} label="With your manager"
        count={review.length}>
        <List>
          {review.map((m) => (
            <Row key={m.id} name={m.name} project={m.project} to={milestoneHref(m)}
              details={<Words muted>Submitted for review. Your manager completes the milestone.</Words>} />
          ))}
        </List>
      </Group>

      <Group k="coming" id={COMING_ID} sections={sections} title={`Might come your way (${comingUp.length})`}
        label="Might come your way" count={comingUp.length}>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>{INTRO}</Typography>
        <List>
          {comingUp.map((c) => (
            <Row key={c.milestone.id} id={`${COMING_ID}-${c.milestone.id}`} focusable name={c.milestone.name}
              project={c.project} to={milestoneHref({ id: c.milestone.id, project: c.project })} details={(
                <>
                  {c.skills?.length ? <Words>{skillsSentence(c.skills)}</Words> : null}
                  <Words muted>{comingLabel(c)}</Words>
                  <PriorityChip priority={c.milestone.priority} />
                  {c.is_new ? <NewChip /> : null}
                  <Chip size="small" variant="outlined" label="Prediction"
                    sx={{ height: 20, borderStyle: 'dashed', '& .MuiChip-label': { px: 0.75 } }} />
                </>
              )} />
          ))}
        </List>
      </Group>

      <Group k="done" sections={sections} title={`Completed · ${done.length}`} label="Completed" count={done.length}>
        <List>
          {done.map((m) => (
            <Row key={m.id} name={m.name} project={m.project} to={milestoneHref(m)}
              lead={<CheckCircle aria-hidden="true" sx={(t) => ({ color: statusColor(STATUS.completed, t) })} />}
              details={<DateLine text={`Planned due ${formatDate(m.end_date)}`} />} />
          ))}
        </List>
      </Group>
    </>
  )
}
