import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControl, FormControlLabel,
  FormHelperText, FormLabel, MenuItem, Radio, RadioGroup, Stack, TextField, Typography,
} from '@mui/material'
import { useEffect, useId, useRef, useState } from 'react'
import { useEditManualHours, useLogManualHours, useWeek } from '../../api/queries.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { formatDayShort, formatHours, mondayOfIso, nyTodayIso } from '../../lib/format.js'
import { DETAILS_MAX, REASONS, dayOptions, detailsProblem, hoursProblem, inWindow, noteProblem } from './manualHours.js'
import { NOTE_MAX } from './timerClock.js'

const COUNTED = new Set(['pending', 'approved'])
const phoneTarget = (t) => ({ [t.breakpoints.down('md')]: { minHeight: 44 } })
const OVERTIME = 'This takes your week over 40h, so it goes to your manager as overtime.'

/** What the person already has that day (pending and approved entries, timer drafts) and that week, leaving out the
 * entry being edited: the same sums the server checks the 24h day and the 40h week against. */
function useHints(day, entry) {
  const week = useWeek(mondayOfIso(day))
  const data = week.data
  if (!data || week.isPlaceholderData) return null
  const mine = (e) => e.id === entry?.id
  const entries = data.entries ?? []
  const dayHours = entries.filter((e) => e.work_date === day && COUNTED.has(e.status) && !mine(e))
    .reduce((sum, e) => sum + Number(e.hours), 0)
    + (data.drafts ?? []).filter((d) => d.work_date === day).reduce((sum, d) => sum + Number(d.hours), 0)
  const own = entries.find((e) => mine(e) && COUNTED.has(e.status))
  return { day: dayHours, week: Number(data.totals?.logged ?? 0) - (own ? Number(own.hours) : 0) }
}

/** Log hours without the timer (no `entry`), or edit and resubmit a manual request (`entry`). The reviewer decides
 * each request on its own. `milestone` = { id, name }, `project` = { name }. */
export default function ManualHoursDialog({ milestone, project, day: dayProp, entry, onClose }) {
  const titleId = useId()
  const log = useLogManualHours()
  const edit = useEditManualHours()
  const [today] = useState(() => nyTodayIso())
  const options = dayOptions(today)
  const editing = Boolean(entry)
  const [day, setDay] = useState(entry?.work_date ?? (dayProp && inWindow(dayProp, today) ? dayProp : today))
  const [hours, setHours] = useState(entry ? String(entry.hours) : '')
  const [reason, setReason] = useState(entry?.manual?.reason ?? '')
  const [details, setDetails] = useState(entry?.manual?.details ?? '')
  const [note, setNote] = useState(entry?.note ?? '')
  const [touched, setTouched] = useState({})
  const [failure, setFailure] = useState(null)
  const sending = useRef(false)
  // Focus starts on Hours, once the dialog's focus trap has settled. Not `autoFocus`: under StrictMode (`npm run dev`) the
  // trap's second run gives focus back to the button and on to the dialog box, and the Hours field would show its error
  // from the blur it never asked for. Nothing is taken from a control the person already reached.
  const hoursRef = useRef(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      const now = document.activeElement
      const inside = now?.closest('[role="dialog"]')?.contains(hoursRef.current)
      if (inside && now.matches('input, textarea, button, [role="combobox"]')) return
      hoursRef.current?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [])
  const pending = log.isPending || edit.isPending
  const hints = useHints(day, entry)

  const hoursError = hoursProblem(hours)
  const detailsError = detailsProblem(reason, details)
  const noteError = noteProblem(note)
  const valid = !hoursError && Boolean(reason) && !detailsError && !noteError
  const reasonError = Boolean(touched.reason && !reason)
  const touch = (field) => () => setTouched((t) => ({ ...t, [field]: true }))
  const overtime = hints && !hoursError && hints.week + Number(hours) > 40

  const send = async () => {
    if (!valid || sending.current) return
    sending.current = true
    setFailure(null)
    const fields = { hours: hours.trim().replace(/^\./, '0.'), reason, details: details.trim() || null, note: note.trim() }
    try {
      if (editing) await edit.mutateAsync({ id: entry.id, body: fields, name: milestone.name })
      else await log.mutateAsync({ body: { milestone_id: milestone.id, work_date: day, ...fields }, name: milestone.name })
      onClose()
    } catch (err) {
      setFailure(err)
    } finally {
      sending.current = false
    }
  }
  const rejected = editing && entry.status === 'rejected'
  const title = !editing ? 'Log hours manually' : rejected ? 'Fix and resubmit' : 'Edit manual hours'
  const submitLabel = !editing ? 'Send for review' : rejected ? 'Resubmit' : 'Save changes'

  return (
    <Dialog open onClose={pending ? undefined : onClose} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          <DialogContentText>{milestone.name} · {project.name}</DialogContentText>
          {rejected && entry.rejection_reason ? <Alert severity="warning">{entry.rejection_reason}</Alert> : null}
          <ErrorAlert error={failure} />
          {editing ? (
            <div>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>Day</Typography>
              <Typography>{formatDayShort(day)}</Typography>
            </div>
          ) : (
            <TextField select label="Day" value={day} onChange={(e) => setDay(e.target.value)} disabled={pending}>
              {options.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </TextField>
          )}
          <TextField label="Hours" value={hours} inputRef={hoursRef} required disabled={pending}
            onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, '').slice(0, 5))} onBlur={touch('hours')}
            error={Boolean(touched.hours && hoursError)} helperText={touched.hours && hoursError ? hoursError : ' '}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }} />
          <FormControl component="fieldset" error={reasonError} disabled={pending}>
            <FormLabel component="legend">Why not the timer?</FormLabel>
            <RadioGroup value={reason} aria-invalid={reasonError || undefined}
              aria-describedby={reasonError ? 'manual-reason-error' : undefined} onChange={(e) => setReason(e.target.value)}
              onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) touch('reason')() }}>
              {REASONS.map(([code, label]) => <FormControlLabel key={code} value={code} control={<Radio />} label={label}
                sx={(t) => ({ [t.breakpoints.down('md')]: { minHeight: 44 } })} />)}
            </RadioGroup>
            {reasonError ? <FormHelperText id="manual-reason-error">Pick a reason</FormHelperText> : null}
          </FormControl>
          <TextField label="Details (required for Other)" multiline minRows={2} value={details} disabled={pending}
            onChange={(e) => setDetails(e.target.value.slice(0, DETAILS_MAX))} onBlur={touch('details')}
            error={Boolean(touched.details && detailsError)}
            helperText={touched.details && detailsError ? detailsError : `${details.length}/${DETAILS_MAX}`}
            slotProps={{ htmlInput: { maxLength: DETAILS_MAX } }} />
          <TextField label="Work note" multiline minRows={2} value={note} disabled={pending}
            onChange={(e) => setNote(e.target.value.slice(0, NOTE_MAX))} onBlur={touch('note')}
            error={Boolean(touched.note && noteError)}
            helperText={touched.note && noteError ? noteError : `What you worked on · ${note.length}/${NOTE_MAX}`}
            slotProps={{ htmlInput: { maxLength: NOTE_MAX } }} />
          {hints ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Already logged that day: {formatHours(hints.day)} · that week: {formatHours(hints.week)}
            </Typography>
          ) : null}
          {overtime ? <Typography variant="body2" sx={{ color: 'warning.main' }}>{OVERTIME}</Typography> : null}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Your manager reviews manual hours one by one. They count toward the budget once approved.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={pending} sx={phoneTarget}>Cancel</Button>
        <Button variant="contained" onClick={send} disabled={pending || !valid} sx={phoneTarget}>
          {pending ? 'Sending…' : submitLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
