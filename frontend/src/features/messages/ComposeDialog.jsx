import {
  Alert, Autocomplete, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Skeleton, Stack, TextField, Typography,
} from '@mui/material'
import { useId, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { useNavigate } from 'react-router-dom'
import { useContacts, useStartConversation } from '../../api/messages.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { ROLE_LABEL } from '../../lib/labels.js'
import { BODY_LIMIT, ONLY_MANAGERS, counterText } from '../../lib/messaging.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'

const same = (a, b) => a != null && b != null && String(a) === String(b)

const detail = (c) => c.relation ?? [ROLE_LABEL[c.role], c.job_title].filter(Boolean).join(' · ')

function Form({ contacts, initialTo, onClose, titleId }) {
  const navigate = useNavigate()
  const start = useStartConversation()
  const { items, can_group: canGroup } = contacts
  const preset = initialTo ? items.find((c) => same(c.id, initialTo)) : null
  const refused = Boolean(initialTo) && !preset
  const [picked, setPicked] = useState(preset ? [preset] : [])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [failure, setFailure] = useState(null)
  const [touched, setTouched] = useState(false)
  const text = body.trim()
  const counter = counterText(body)
  const group = canGroup && picked.length > 1
  const problem = !picked.length ? 'Pick who to message' : !text ? 'Write a message first'
    : text.length > BODY_LIMIT ? `Keep it under ${BODY_LIMIT} characters` : null

  const submit = async (e) => {
    e.preventDefault()
    setTouched(true)
    if (problem) return
    setFailure(null)
    try {
      const conversation = await start.mutateAsync({
        participant_ids: picked.map((p) => p.id), body: text, ...(group && subject.trim() ? { subject: subject.trim() } : {}),
      })
      onClose()
      navigate(`/messages/${conversation.id}`)
    } catch (err) {
      setFailure(err)
    }
  }

  return (
    <form noValidate onSubmit={submit}>
      <DialogTitle id={titleId}>New message</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          {refused ? <Alert severity="warning" role="alert">{canGroup ? "You can't message this person." : ONLY_MANAGERS}</Alert> : null}
          {!canGroup ? (
            <Alert severity="info" role="note">
              You can message your managers: the person you report to, the managers of your projects and their delegate approvers.
            </Alert>
          ) : null}
          <ErrorAlert error={failure} />
          <Autocomplete multiple={canGroup} options={items} value={canGroup ? picked : (picked[0] ?? null)}
            onChange={(_, value) => setPicked(canGroup ? value : (value ? [value] : []))}
            getOptionLabel={(c) => c.name} isOptionEqualToValue={(a, b) => same(a.id, b.id)} disabled={start.isPending}
            noOptionsText={canGroup ? 'Nobody matches' : 'No managers to message right now'}
            renderOption={(props, c) => {
              const { key, ...rest } = props
              return (
                <Box component="li" key={key} {...rest} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                  <UserAvatar userId={c.id} name={c.name} size={32} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" noWrap>{c.name}</Typography>
                    <Typography variant="caption" noWrap component="div" sx={{ color: 'text.secondary' }}>{detail(c)}</Typography>
                  </Box>
                </Box>
              )
            }}
            renderInput={(params) => (
              <TextField {...params} label={canGroup ? 'To' : 'To (one of your managers)'}
                error={touched && !picked.length} helperText={touched && !picked.length ? 'Pick who to message' : undefined} />
            )} />
          {group ? (
            <TextField label="Subject (optional)" value={subject} onChange={(e) => setSubject(e.target.value)}
              slotProps={{ htmlInput: { maxLength: 120 } }} disabled={start.isPending} helperText="Shown as the conversation's name" />
          ) : null}
          <TextField label="Message" multiline minRows={3} maxRows={10} value={body}
            onChange={(e) => setBody(e.target.value)} disabled={start.isPending}
            error={(touched && !text) || text.length > BODY_LIMIT}
            helperText={touched && !text ? 'Write a message first' : counter ?? undefined} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={start.isPending}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={start.isPending}>Send</Button>
      </DialogActions>
    </form>
  )
}

/** Start a conversation. Recipients come from /messages/contacts, so employees only ever see their managers.
 * `initialTo` preselects someone (the Message buttons); if they aren't someone the viewer may message, it says so. */
export default function ComposeDialog({ open, onClose, initialTo }) {
  const titleId = useId()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const contacts = useContacts(open)
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby={titleId} maxWidth="sm" fullWidth fullScreen={!desktop}>
      {contacts.data ? (
        <Form contacts={contacts.data} initialTo={initialTo} onClose={onClose} titleId={titleId} />
      ) : (
        <>
          <DialogTitle id={titleId}>New message</DialogTitle>
          <DialogContent>
            <ErrorAlert error={contacts.error} onRetry={() => contacts.refetch()} />
            {contacts.isLoading ? <Skeleton variant="rounded" height={120} /> : null}
          </DialogContent>
        </>
      )}
    </Dialog>
  )
}
