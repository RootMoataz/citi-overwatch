import ChatOutlined from '@mui/icons-material/ChatOutlined'
import Flag from '@mui/icons-material/Flag'
import NotificationsActive from '@mui/icons-material/NotificationsActiveOutlined'
import { Box, Button, Link, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useId } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useMilestoneDiscussion } from '../../api/messages.js'
import EmptyState from '../../components/EmptyState.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { DIFFICULTY, PRIORITY } from '../../lib/labels.js'
import Section from '../dashboard/Section.jsx'
import { milestoneHref, stateKey } from '../timesheet/monthText.js'
import TimerButton from '../timer/TimerButton.jsx'
import { useLoggable } from '../timer/useLoggable.js'
import { ChevronLink, DateLine, NewChip, ProjectLink } from './MilestoneGroups.jsx'
import { dueLine, focusSummary, nowAndNext, upNextLabel } from './myWork.js'

/** One of the card's parts ("Now", "Next"), named by its overline. */
function Part({ label, children }) {
  const id = useId()
  return (
    <Box role="group" aria-labelledby={id}>
      <Typography id={id} variant="overline" component="p" sx={{ color: 'text.secondary', lineHeight: 2 }}>{label}</Typography>
      {children}
    </Box>
  )
}

const Words = ({ children, sx }) => <Typography variant="body2" component="span" sx={sx}>{children}</Typography>

/** Only the urgent priorities earn a line on the Now card; the flag pairs with the word, never colour alone. */
function PriorityFlag({ priority }) {
  if (priority !== 'critical' && priority !== 'high') return null
  const critical = priority === 'critical'
  return (
    <Words sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: critical ? 'error.main' : 'text.primary',
      fontWeight: critical ? 600 : 400 }}>
      <Flag aria-hidden="true" sx={{ fontSize: 16, color: critical ? 'error.main' : 'warning.main' }} />
      {`${PRIORITY[priority]} priority`}
    </Words>
  )
}

/** The milestone to work on now: a highlighted inner card, with an error-coloured left edge when overdue. */
function NowCard({ m, today, loggable }) {
  const due = dueLine(m, today)
  const discussion = useMilestoneDiscussion(m.id)
  const href = milestoneHref(m)
  return (
    <Box sx={(t) => ({
      border: 1, borderColor: 'divider', borderLeft: 4, borderLeftColor: due.overdue ? 'error.main' : 'primary.main',
      borderRadius: 1, p: 2, bgcolor: alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.08 : 0.03),
    })}>
      <Stack direction="row" useFlexGap sx={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h3" component="h3" sx={{ overflowWrap: 'anywhere' }}>{m.name}</Typography>
          <Typography variant="body2"><ProjectLink project={m.project} /></Typography>
        </Box>
        <StatusChip icon status={stateKey(m)} />
      </Stack>
      <Stack direction="row" useFlexGap sx={{ gap: { xs: 1, sm: 2 }, flexWrap: 'wrap', alignItems: 'center', mt: 1.5 }}>
        <DateLine text={due.text} overdue={due.overdue} />
        <PriorityFlag priority={m.priority} />
        {DIFFICULTY[m.difficulty] ? <Words>{`${DIFFICULTY[m.difficulty]} difficulty`}</Words> : null}
        {m.progress_percent != null ? <Words>{`${m.progress_percent}% done`}</Words> : null}
      </Stack>
      <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center', mt: 2 }}>
        <Button variant="outlined" component={RouterLink} to={href} sx={{ minHeight: 44 }}>View milestone</Button>
        {discussion.data ? (
          <Button component={RouterLink} to={`${href}&panel=discussion`} startIcon={<ChatOutlined />} sx={{ minHeight: 44 }}>
            Discuss
          </Button>
        ) : null}
        {loggable.has(String(m.id)) ? <TimerButton milestone={m} size="medium" touch /> : null}
      </Stack>
    </Box>
  )
}

function NextRow({ m, today }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle1" component="h3" sx={{ lineHeight: 1.3, overflowWrap: 'anywhere' }}>{m.name}</Typography>
        <Stack direction="row" useFlexGap sx={{ gap: 1.5, flexWrap: 'wrap' }}>
          <Words><ProjectLink project={m.project} /></Words>
          <Words sx={{ color: 'text.secondary' }}>{upNextLabel(m, today)}</Words>
        </Stack>
      </Box>
      <ChevronLink name={m.name} to={milestoneHref(m)} />
    </Stack>
  )
}

/** An urgent prediction, pointing at its row in "Might come your way". */
function HeadsUp({ item, onShow }) {
  const { milestone } = item
  const priority = PRIORITY[milestone.priority ?? item.priority] ?? PRIORITY.medium
  return (
    <Stack direction="row" useFlexGap sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap', borderTop: 1, borderColor: 'divider', pt: 1 }}>
      <NotificationsActive aria-hidden="true" sx={{ fontSize: 18, color: 'warning.main' }} />
      <Link component="button" type="button" variant="body2" onClick={() => onShow(milestone.id)}
        sx={{ textAlign: 'left', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
        {`Heads-up: ${milestone.name} (${priority} priority) may come your way`}
      </Link>
      {item.is_new ? <NewChip /> : null}
    </Stack>
  )
}

/** "Your focus": what to work on now, what comes next, and an urgent prediction, if any. */
export default function YourFocusCard({ groups, comingUp, today, sections, onShowComing, onShowPrediction }) {
  const loggable = useLoggable()
  const { now, next, startNext, headsUp } = nowAndNext(groups, comingUp, today)
  const nothing = !comingUp.length && Object.values(groups).every((list) => !list.length)
  return (
    <Section collapsible open={sections.isOpen('nowNext')} onToggle={() => sections.toggle('nowNext')} question="Your focus"
      hint={focusSummary(groups, today)}>
      {nothing ? (
        <EmptyState title="Nothing assigned to you right now"
          description="Milestones your manager gives you, or that you claim, show up here." />
      ) : (
        <Stack sx={{ gap: 2 }}>
          <Part label="Now">
            {now ? <NowCard m={now} today={today} loggable={loggable} /> : (
              <Stack direction="row" useFlexGap sx={{ gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                <Typography variant="body1">Nothing in progress</Typography>
                {startNext ? (
                  <Link component={RouterLink} to={milestoneHref(startNext)} underline="hover"
                    sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
                    {`Start ${startNext.name} next`}
                  </Link>
                ) : null}
              </Stack>
            )}
          </Part>
          <Part label="Next">
            {next ? <NextRow m={next} today={today} /> : (
              <Stack direction="row" useFlexGap sx={{ gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                <Typography variant="body1">Nothing else assigned yet</Typography>
                {comingUp.length ? <Button onClick={onShowComing} sx={{ minHeight: 44 }}>See what might come your way</Button> : null}
              </Stack>
            )}
          </Part>
          {headsUp ? <HeadsUp item={headsUp} onShow={onShowPrediction} /> : null}
        </Stack>
      )}
    </Section>
  )
}
