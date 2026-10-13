import { Box, Button, List, ListItem, ListItemText, Skeleton, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { useAddNote, useNotes } from '../../api/queries.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'

const MAX = 2000

/** Append-only progress notes; assignees and the project's manager can post. */
export default function MilestoneNotes({ milestoneId, canPost }) {
  const notes = useNotes(milestoneId)
  const add = useAddNote(milestoneId)
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  const post = async () => {
    const body = text.trim()
    if (!body) { setError('Write something first'); return }
    if (body.length > MAX) { setError(`Keep it under ${MAX} characters`); return }
    try { await add.mutateAsync(body); setText('') } catch (err) { setError(err.message) }
  }

  return (
    <Box sx={{ mt: 1 }}>
      <ErrorAlert error={notes.error} onRetry={() => notes.refetch()} />
      {notes.isLoading ? <Skeleton variant="rounded" height={48} /> : null}
      {notes.data?.length === 0 ? <Typography variant="body2" sx={{ color: 'text.secondary' }}>No notes yet.</Typography> : null}
      {notes.data?.length ? (
        <List dense aria-label="Progress notes" disablePadding>
          {notes.data.map((n) => (
            <ListItem key={n.id} disableGutters alignItems="flex-start">
              <ListItemText primary={n.body} slotProps={{ primary: { sx: { whiteSpace: 'pre-wrap' } } }}
                secondary={<><span>{n.author.name}</span> · {new Date(n.created_at).toLocaleString()}</>} />
            </ListItem>
          ))}
        </List>
      ) : null}
      {canPost ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, mt: 1, alignItems: { sm: 'flex-start' } }}>
          <TextField label="Add a progress note" multiline minRows={1} value={text} disabled={add.isPending}
            onChange={(e) => { setText(e.target.value); setError('') }} error={Boolean(error)}
            helperText={error || `${text.length}/${MAX}`} />
          <Button variant="outlined" onClick={post} disabled={add.isPending} sx={{ flexShrink: 0, mt: { sm: 0.25 } }}>Post note</Button>
        </Stack>
      ) : null}
    </Box>
  )
}
