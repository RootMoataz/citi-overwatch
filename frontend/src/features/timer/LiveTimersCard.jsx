import StopCircle from '@mui/icons-material/StopCircleOutlined'
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Skeleton, Stack, TextField,
  Tooltip, Typography,
} from '@mui/material'
import { useEffect, useId, useMemo, useState } from 'react'
import { useLiveTimers, useStopRemote } from '../../api/queries.js'
import { useToast } from '../../app/toast.js'
import { useSession } from '../../auth/sessionContext.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { formatHours } from '../../lib/format.js'
import { DEMO_DISABLED, isPublicDemo } from '../../lib/permissions.js'
import Section from '../dashboard/Section.jsx'
import { LEVEL_CHIP, LIMIT_LABEL, clockOffset, formatDuration, formatElapsed, limitLevel, worstLevel } from './timerClock.js'

export const MESSAGE_MIN = 10
export const MESSAGE_MAX = 500

/** One clock for the whole card: the device's time, a tick a second while anything runs. */
function useTick(active) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

/** Stop someone's timer: the message (10-500 characters) goes to them in the bell and in Messages. */
export function RemoteStopDialog({ item, elapsed, onClose }) {
  const titleId = useId()
  const stop = useStopRemote()
  const toast = useToast()
  const [message, setMessage] = useState('')
  const [failure, setFailure] = useState(null)
  const trimmed = message.trim()
  const short = trimmed.length < MESSAGE_MIN
  const first = item.person.first_name ?? item.person.name.split(' ')[0]
  const confirm = async () => {
    setFailure(null)
    try {
      const result = await stop.mutateAsync({ id: item.id, message: trimmed })
      toast.success(`Stopped ${first}'s timer — ${formatHours(result.added_hours)} went to their timesheet as a draft. `
        + 'They got your message.')
      onClose()
    } catch (err) { setFailure(err) }
  }
  return (
    <Dialog open onClose={stop.isPending ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>Stop {first}&apos;s timer?</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <DialogContentText>
            {item.milestone.name} · {item.project.name} · running {formatDuration(elapsed)}. The time so far goes to
            {` ${first}'s`} timesheet as a draft they submit. {first} sees your message in the bell and in Messages.
          </DialogContentText>
          <ErrorAlert error={failure} />
          <TextField label={`Message to ${first}`} multiline minRows={3} value={message} autoFocus required
            onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
            error={trimmed.length > 0 && short}
            helperText={`${trimmed.length}/${MESSAGE_MAX} · at least ${MESSAGE_MIN} characters, e.g. why you stopped it`}
            slotProps={{ htmlInput: { maxLength: MESSAGE_MAX } }} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={stop.isPending}>Cancel</Button>
        <Button variant="contained" color="error" onClick={confirm} disabled={stop.isPending || short}>
          {stop.isPending ? 'Stopping…' : 'Stop timer and send'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function LiveRow({ item, serverNow, startedMs, readOnly, demo, onStop }) {
  const elapsed = Math.max(0, Math.floor((serverNow - startedMs) / 1000))
  const level = worstLevel(item.limits, serverNow)
  const today = Number(item.today_used_hours ?? 0) + elapsed / 3600
  const reached = item.limits.filter((l) => limitLevel(l, serverNow) !== 'ok')
  return (
    <Box component="li" sx={{ py: 1.25, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0, pt: 0 } }}>
      {/* Two lines at any card width: who and the clock, then today's total, warnings and Stop. */}
      <Stack direction="row" sx={{ gap: 1.25, alignItems: 'center', minWidth: 0 }}>
        <UserAvatar userId={item.person.id} name={item.person.name} size={36} />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="subtitle2" component="p" sx={{ lineHeight: 1.3 }}>
            <PersonLink person={item.person} context={{ managed: true }} />
          </Typography>
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
            {item.milestone.name} · {item.project.name}
          </Typography>
        </Box>
        <Typography component="span" aria-label={`${item.person.name}'s timer: ${formatElapsed(elapsed)}`}
          sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: '1.15rem', flexShrink: 0,
            color: level === 'over' ? 'error.main' : level === 'warning' ? 'warning.main' : 'text.primary' }}>
          {formatElapsed(elapsed)}
        </Typography>
      </Stack>
      <Stack direction="row" useFlexGap sx={{ gap: 1, alignItems: 'center', flexWrap: 'wrap', mt: 0.75, pl: { xs: 0, sm: 5.75 } }}>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{formatHours(Math.round(today * 4) / 4)} today</Typography>
        {level !== 'ok' ? (
          <Tooltip title={reached.map((l) => `${LIMIT_LABEL[l.kind]}: ${formatHours(l.limit_hours)} limit`).join(' · ')}>
            <Chip size="small" color={LEVEL_CHIP[level].color} label={`${LEVEL_CHIP[level].label}: ${reached.map((l) => LIMIT_LABEL[l.kind]).join(', ')}`} />
          </Tooltip>
        ) : null}
        <Box sx={{ flexGrow: 1 }} />
        {!readOnly && (item.can_stop !== false || demo) ? (
          <Tooltip title={demo ? DEMO_DISABLED : `Stop ${item.person.name}'s timer with a message`}>
            <span>
              <Button size="small" variant="outlined" color="error" startIcon={<StopCircle />} disabled={demo}
                aria-label={`Stop ${item.person.name}'s timer`} onClick={() => onStop(item, elapsed)}>
                Stop timer
              </Button>
            </span>
          </Tooltip>
        ) : null}
      </Stack>
    </Box>
  )
}

/** "Live now": the running timers the viewer oversees, each ticking here between refreshes, with a Warning (100%)
 * or Over (125%) chip against the 8h day, the milestone's estimate and the 40h week. Managers and admins can stop
 * one with a message; executives only watch (and the public demo admin sees Stop disabled). */
export default function LiveTimersCard({ hideWhenEmpty = false }) {
  const { user } = useSession()
  const live = useLiveTimers()
  const items = live.data?.items ?? []
  const offset = useMemo(() => clockOffset(live.data?.now, live.dataUpdatedAt), [live.data, live.dataUpdatedAt])
  const now = useTick(items.length > 0)
  const [stopping, setStopping] = useState(null)
  const readOnly = user?.role === 'executive'
  if (hideWhenEmpty && !live.isLoading && !items.length && !live.error) return null
  const count = items.length
  return (
    <Section question="Live now" hint={count ? `${count} ${count === 1 ? 'person is' : 'people are'} running a timer`
      : 'Nobody is running a timer right now.'}>
      <ErrorAlert error={live.error} onRetry={() => live.refetch()} />
      {live.isLoading ? <Skeleton variant="rounded" height={56} /> : null}
      {count ? (
        <Box component="ul" aria-label="Running timers" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {items.map((item) => (
            <LiveRow key={item.id} item={item} serverNow={now + offset} startedMs={Date.parse(item.started_at)}
              readOnly={readOnly} demo={isPublicDemo(user)} onStop={(i, elapsed) => setStopping({ item: i, elapsed })} />
          ))}
        </Box>
      ) : null}
      {stopping ? <RemoteStopDialog item={stopping.item} elapsed={stopping.elapsed} onClose={() => setStopping(null)} /> : null}
    </Section>
  )
}
