import {
  Box, Button, LinearProgress, Skeleton, Stack, TextField, Typography,
} from '@mui/material'
import { useState } from 'react'
import { useMilestoneUpdates, usePostUpdate } from '../../api/workflow.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { relativeTime } from '../../lib/relativeTime.js'
import { parsePercent } from '../../lib/workflow.js'

const MAX = 2000

/** The milestone's work log: progress updates, newest first, with who posted them; assignees and the manager post. */
export default function WorkLog({ milestone }) {
  const updates = useMilestoneUpdates(milestone.id)
  const post = usePostUpdate(milestone.project_id, milestone.id)
  const [text, setText] = useState('')
  const [percent, setPercent] = useState('')
  const [errors, setErrors] = useState({})
  const [failure, setFailure] = useState(null)
  const items = updates.data ?? []

  const submit = async (e) => {
    e.preventDefault()
    const body = text.trim()
    const pct = parsePercent(percent)
    const found = {}
    if (!body) found.body = 'Write what changed'
    else if (body.length > MAX) found.body = `Keep it under ${MAX} characters`
    if (pct.error) found.percent = pct.error
    setErrors(found)
    if (Object.keys(found).length) return
    setFailure(null)
    try {
      await post.mutateAsync({ body, percent_complete: pct.value })
      setText('')
      setPercent('')
    } catch (err) { setFailure(err) }
  }

  return (
    <Box component="section" aria-label={`Work log for ${milestone.name}`} sx={{ mt: 1.5 }}>
      <Typography variant="subtitle2" component="h4" sx={{ mb: 1 }}>Work log</Typography>
      {milestone.can_post_update ? (
        <Stack component="form" noValidate onSubmit={submit} direction={{ xs: 'column', sm: 'row' }}
          sx={{ gap: 1, mb: 1.5, alignItems: { sm: 'flex-start' } }}>
          <TextField label="Post a progress update" multiline minRows={1} value={text} disabled={post.isPending}
            onChange={(e) => { setText(e.target.value); setErrors((x) => ({ ...x, body: undefined })) }}
            error={Boolean(errors.body)} helperText={errors.body || `${text.length}/${MAX}`} />
          <TextField label="% complete" value={percent} disabled={post.isPending} sx={{ width: { sm: 130 }, flexShrink: 0 }}
            onChange={(e) => { setPercent(e.target.value); setErrors((x) => ({ ...x, percent: undefined })) }}
            error={Boolean(errors.percent)} helperText={errors.percent || 'Optional'}
            slotProps={{ htmlInput: { inputMode: 'numeric', 'aria-label': 'Percent complete' } }} />
          <Button type="submit" variant="outlined" disabled={post.isPending} sx={{ flexShrink: 0, mt: { sm: 1 } }}>
            Post update
          </Button>
        </Stack>
      ) : null}
      <ErrorAlert error={failure} sx={{ mb: 1 }} />
      <ErrorAlert error={updates.error} onRetry={() => updates.refetch()} />
      {updates.isLoading ? <Skeleton variant="rounded" height={56} /> : null}
      {!updates.isLoading && !updates.error && !items.length ? (
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>No updates yet.</Typography>
      ) : null}
      {items.length ? (
        <Box component="ol" aria-label="Progress updates" sx={{ listStyle: 'none', p: 0, m: 0, position: 'relative',
          '&::before': { content: '""', position: 'absolute', left: 13, top: 8, bottom: 8, width: 2, bgcolor: 'divider' } }}>
          {items.map((u) => (
            <Box component="li" key={u.id} sx={{ display: 'flex', gap: 1.25, py: 0.75, position: 'relative' }}>
              <UserAvatar userId={u.author.id} name={u.author.name} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {u.author.name}
                  <Typography component="span" variant="caption" sx={{ color: 'text.secondary', fontWeight: 400, ml: 1 }}>
                    <time dateTime={u.created_at} title={new Date(u.created_at).toLocaleString()}>{relativeTime(u.created_at)}</time>
                  </Typography>
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{u.body}</Typography>
                {u.percent_complete != null ? (
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mt: 0.5, maxWidth: 260 }}>
                    <LinearProgress variant="determinate" value={u.percent_complete} sx={{ flex: 1, height: 6, borderRadius: 3 }}
                      aria-label={`${u.percent_complete}% complete`} />
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>{u.percent_complete}%</Typography>
                  </Stack>
                ) : null}
              </Box>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}
