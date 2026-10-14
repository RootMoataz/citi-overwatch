import { Button, Grid, Paper, Skeleton, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useMe, useUpdateMe } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import { formatMoney } from '../../lib/format.js'
import { EMAIL_RE } from '../../lib/schemas.js'

const ROLE = { admin: 'Admin', manager: 'Manager', employee: 'Employee' }

function ReadOnly({ label, value }) {
  return (
    <Stack>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body1">{value || '—'}</Typography>
    </Stack>
  )
}

/** People edit their own name and email; everything else is managed by an admin. */
export default function ProfilePage() {
  const me = useMe()
  const update = useUpdateMe()
  const { setUser } = useSession()
  const [draft, setDraft] = useState(null)
  const [failure, setFailure] = useState(null)
  if (me.isLoading) return <Skeleton variant="rounded" height={280} />
  if (me.error) return <ErrorAlert error={me.error} onRetry={() => me.refetch()} />
  const p = me.data
  const form = draft ?? { first_name: p.first_name, last_name: p.last_name, email: p.email }
  const set = (k) => (e) => setDraft({ ...form, [k]: e.target.value })
  const emailError = !EMAIL_RE.test(form.email.trim())

  const save = async () => {
    setFailure(null)
    try {
      const saved = await update.mutateAsync({ first_name: form.first_name.trim(), last_name: form.last_name.trim(), email: form.email.trim() })
      setUser({ first_name: saved.first_name, last_name: saved.last_name, email: saved.email })
      setDraft(null)
    } catch (err) { setFailure(err) }
  }

  return (
    <>
      <PageHeader title="My profile" subtitle="You can change your name and email. An admin manages everything else."
        actions={<Button component={RouterLink} to={`/people/${p.id}/profile`}>My history</Button>} />
      <ErrorAlert error={failure} sx={{ mb: 2 }} />
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}><TextField label="First name" value={form.first_name} onChange={set('first_name')} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><TextField label="Last name" value={form.last_name} onChange={set('last_name')} /></Grid>
          <Grid size={12}><TextField label="Email" type="email" value={form.email} onChange={set('email')} error={emailError}
            helperText={emailError ? 'Enter a valid email address' : ' '} /></Grid>
        </Grid>
        <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 1 }}>
          {draft ? <Button onClick={() => setDraft(null)}>Discard</Button> : null}
          <Button variant="contained" onClick={save} disabled={!draft || emailError || update.isPending}>Save</Button>
        </Stack>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}><ReadOnly label="Username" value={p.username} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><ReadOnly label="Role" value={ROLE[p.role]} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><ReadOnly label="Job title" value={p.job_title} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><ReadOnly label="Annual salary" value={p.salary == null ? null : formatMoney(p.salary)} /></Grid>
        </Grid>
      </Paper>
    </>
  )
}
