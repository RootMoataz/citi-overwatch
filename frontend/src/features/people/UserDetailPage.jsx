import ArrowBack from '@mui/icons-material/ArrowBack'
import {
  Alert, Box, Button, FormControlLabel, FormHelperText, Grid, InputAdornment, Link, List, ListItem, ListItemText, MenuItem, Paper,
  Skeleton, Stack, Switch, TextField,
} from '@mui/material'
import { useState } from 'react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import {
  useArchiveUser, useDepartments, useManagers, useResetUserPassword, useRestoreUser, useUpdateUser, useUser,
} from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import DemoLock from '../../components/DemoLock.jsx'
import { useRedirectOnDenied } from '../../app/access.js'
import { demoBlocks } from '../../lib/permissions.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { fullName } from '../../lib/format.js'
import ShowOnceDialog from './ShowOnceDialog.jsx'
import { relayCredentials } from '../../lib/emailRelay.js'
import { useToast } from '../../app/toast.js'
import { ROLE_OPTIONS } from '../../lib/labels.js'

const FIELDS = ['first_name', 'last_name', 'email', 'username', 'role', 'job_title', 'salary', 'manager_id', 'department_id']
// Who keeps a personal timesheet: employees always; a manager or admin only with this on (executives never log).
const TRACKS_ROLES = ['manager', 'admin']
const tracksByDefault = (role) => role === 'employee'

function Dependents({ error }) {
  if (error?.code !== 'HAS_DEPENDENTS') return <ErrorAlert error={error} sx={{ mb: 2 }} />
  const { projects = [], direct_reports: reports = [] } = error.details ?? {}
  return (
    <Alert severity="error" role="alert" sx={{ mb: 2 }}>
      {error.message}
      <List dense>
        {projects.map((p) => <ListItem key={p.id} disableGutters><ListItemText primary={`Manages ${p.name}`} /></ListItem>)}
        {reports.map((r) => <ListItem key={r.id} disableGutters><ListItemText primary={`${r.name} reports to them`} /></ListItem>)}
      </List>
    </Alert>
  )
}

export default function UserDetailPage() {
  const { id } = useParams()
  const { user: me, setUser } = useSession()
  const person = useUser(id)
  const managers = useManagers()
  const departments = useDepartments({ includeArchived: true })
  const update = useUpdateUser(id)
  const archive = useArchiveUser(id)
  const restore = useRestoreUser(id)
  const reset = useResetUserPassword(id)
  const toast = useToast()
  const [draft, setDraft] = useState(null)
  const [failure, setFailure] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [shown, setShown] = useState(null)
  const leaving = useRedirectOnDenied(person.error)
  const back = <Link component={RouterLink} to="/people" underline="hover" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
    <ArrowBack fontSize="small" /> People</Link>

  if (leaving) return null
  if (person.isLoading) return <Box>{back}<Skeleton variant="rounded" height={320} /></Box>
  if (person.error) return <Box>{back}<ErrorAlert error={person.error} /></Box>
  const p = person.data
  const form = draft ?? { ...Object.fromEntries(FIELDS.map((f) => [f, p[f] == null ? '' : String(p[f])])),
    tracks_own_hours: Boolean(p.tracks_own_hours) }
  // A new role starts from its own timesheet default (the server does the same).
  const set = (k) => (e) => setDraft({ ...form, [k]: e.target.value,
    ...(k === 'role' ? { tracks_own_hours: e.target.value === p.role ? Boolean(p.tracks_own_hours) : tracksByDefault(e.target.value) } : {}) })
  const self = String(p.id) === String(me.id)

  const save = async () => {
    setFailure(null)
    const body = {}
    for (const f of FIELDS) if (form[f] !== (p[f] == null ? '' : String(p[f]))) body[f] = f === 'salary' ? Number(form[f]) : form[f] || null
    if (form.tracks_own_hours !== Boolean(p.tracks_own_hours)) body.tracks_own_hours = form.tracks_own_hours
    if (!Object.keys(body).length) return
    try {
      const saved = await update.mutateAsync(body)
      if (self) setUser?.({ tracks_own_hours: Boolean(saved?.tracks_own_hours) }) // My timesheet shows or hides now
      setDraft(null)
    } catch (err) { setFailure(err) }
  }
  const run = async (action) => {
    setFailure(null)
    try {
      if (action === 'archive') await archive.mutateAsync()
      if (action === 'restore') await restore.mutateAsync()
      if (action === 'reset') {
        const result = await reset.mutateAsync()
        const relayed = !result.email_sent && await relayCredentials({ to: p.email, name: fullName(p), username: p.username,
          password: result.temp_password, kind: 'reset' })
        if (relayed) toast.success(`New sign-in details emailed to ${p.email}`)
        else if (!result.email_sent) setShown({ username: p.username, password: result.temp_password })
      }
    } catch (err) { setFailure(err) }
    setConfirm(null)
  }

  return (
    <>
      <PageHeader breadcrumb={back} title={fullName(p)} subtitle={p.is_archived ? <StatusChip status="blocked" label="Archived" /> : p.email}
        actions={<>
          <Button component={RouterLink} to={`/people/${p.id}/profile`}>History</Button>
          {!p.is_archived ? <DemoLock user={me} action="user.manage">
            <Button onClick={() => setConfirm('reset')}>Reset password</Button></DemoLock> : null}
          {!p.is_archived && !self ? <DemoLock user={me} action="user.manage">
            <Button color="error" onClick={() => setConfirm('archive')}>Archive</Button></DemoLock> : null}
          {p.is_archived ? <DemoLock user={me} action="user.manage">
            <Button variant="contained" onClick={() => run('restore')}>Restore</Button></DemoLock> : null}
        </>} />
      {demoBlocks(me, 'user.manage')
        ? <Alert severity="info" sx={{ mb: 2 }}>Changing people is disabled in the public demo. You can look around.</Alert>
        : null}
      <Dependents error={failure} />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6 }}><TextField label="First name" value={form.first_name} onChange={set('first_name')} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><TextField label="Last name" value={form.last_name} onChange={set('last_name')} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><TextField label="Email" value={form.email} onChange={set('email')} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}><TextField label="Username" value={form.username} onChange={set('username')}
            helperText="Only admins can change usernames" /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField select label="Role" value={form.role} onChange={set('role')} disabled={self} helperText={self ? "You can't change your own role" : ' '}>
              {ROLE_OPTIONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField select label="Reports to" value={form.manager_id} onChange={set('manager_id')}>
              <MenuItem value="">Nobody</MenuItem>
              {(managers.data ?? []).filter((m) => String(m.id) !== String(p.id)).map((m) => <MenuItem key={m.id} value={String(m.id)}>{fullName(m)}</MenuItem>)}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}><TextField label="Job title" value={form.job_title} onChange={set('job_title')} /></Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            {/* Archived departments are listed only so a person still in one shows it; they can't be picked. */}
            <TextField select label="Department" value={form.department_id} onChange={set('department_id')}>
              <MenuItem value="">No department</MenuItem>
              {(departments.data?.items ?? []).filter((d) => !d.is_archived || String(d.id) === form.department_id).map((d) => (
                <MenuItem key={d.id} value={String(d.id)} disabled={d.is_archived}>{d.name}{d.is_archived ? ' (archived)' : ''}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField label="Annual salary" type="number" value={form.salary} onChange={set('salary')} disabled={self}
              helperText={self ? "You can't change your own salary" : 'Used for project cost (salary ÷ 2,080 per hour)'}
              slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> } }} />
          </Grid>
          {TRACKS_ROLES.includes(form.role) ? (
            <Grid size={12}>
              <FormControlLabel label="Tracks own hours" control={
                <Switch checked={form.tracks_own_hours} onChange={(e) => setDraft({ ...form, tracks_own_hours: e.target.checked })} />} />
              <FormHelperText sx={{ mt: 0 }}>
                Gives this {form.role === 'admin' ? 'admin' : 'manager'} a personal timesheet (My timesheet) to log hours on the
                milestones they work on. Off by default: managing isn't logged.
              </FormHelperText>
            </Grid>
          ) : null}
        </Grid>
        <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 1, mt: 2 }}>
          {draft ? <Button onClick={() => setDraft(null)}>Discard</Button> : null}
          <DemoLock user={me} action="user.manage">
            <Button variant="contained" onClick={save} disabled={!draft || update.isPending}>Save changes</Button>
          </DemoLock>
        </Stack>
      </Paper>
      <ConfirmDialog open={confirm === 'archive'} title="Archive this account?" confirmLabel="Archive" busy={archive.isPending}
        body="They can't sign in until an admin restores the account. Their history stays on record." onClose={() => setConfirm(null)} onConfirm={() => run('archive')} />
      <ConfirmDialog open={confirm === 'reset'} title="Reset their password?" confirmLabel="Reset" destructive={false} busy={reset.isPending}
        body="They get a new temporary password and must change it at their next sign-in. Their current sessions end." onClose={() => setConfirm(null)} onConfirm={() => run('reset')} />
      {shown ? <ShowOnceDialog username={shown.username} password={shown.password} onClose={() => setShown(null)} /> : null}
    </>
  )
}
