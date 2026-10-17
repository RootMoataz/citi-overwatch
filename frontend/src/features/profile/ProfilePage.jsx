import ManageHistory from '@mui/icons-material/ManageHistoryOutlined'
import { Box, Button, Grid, Paper, Skeleton, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { useDepartments, useMe, useProfile, useUpdateMe } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import DemoLock from '../../components/DemoLock.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { ROLE_LABEL } from '../../lib/labels.js'
import { demoBlocks } from '../../lib/permissions.js'
import { EMAIL_RE } from '../../lib/schemas.js'
import AvatarDialog from '../avatar/AvatarDialog.jsx'
import { EmploymentDetails } from '../people/ProfileCard.jsx'
import SkillsCard from '../people/SkillsCard.jsx'
import YourManagerCard from '../people/YourManagerCard.jsx'

function ReadOnly({ label, value }) {
  return (
    <Stack>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>{label}</Typography>
      <Typography variant="body1" sx={{ overflowWrap: 'anywhere' }}>{value || '—'}</Typography>
    </Stack>
  )
}

/** Your manager and Skills come from the full profile (`/me` doesn't carry them); while it loads or fails only these
 * two cards say so, the rest of the page works regardless. */
function ProfileCards({ profile, person }) {
  if (profile.isLoading) return (<><Skeleton variant="rounded" height={120} /><Skeleton variant="rounded" height={96} /></>)
  if (profile.error) {
    return ['Your manager', 'Skills'].map((title) => (
      <Paper key={title} variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h3" component="h2" sx={{ mb: 1.5 }}>{title}</Typography>
        <ErrorAlert error={profile.error} onRetry={() => profile.refetch()} />
      </Paper>
    ))
  }
  const { user: owner, skills, can_edit_skills: canEdit } = profile.data
  return (
    <>
      <YourManagerCard manager={owner?.manager} stacked />
      <SkillsCard person={person} skills={skills ?? []} canEdit={Boolean(canEdit)} mb={0} />
    </>
  )
}

/** People edit their own name and email; everything else is managed by an admin. The look follows My history's
 * profile card: who you are on the left, then your details and the read-only account facts. */
export default function ProfilePage() {
  const me = useMe()
  const departments = useDepartments()
  const update = useUpdateMe()
  const { user, setUser } = useSession()
  const locked = demoBlocks(user, 'profile.edit')
  const [draft, setDraft] = useState(null)
  const [failure, setFailure] = useState(null)
  const [photoOpen, setPhotoOpen] = useState(false)
  const profile = useProfile(user?.id, Boolean(user?.id))
  if (me.isLoading) return <Skeleton variant="rounded" height={280} />
  if (me.error) return <ErrorAlert error={me.error} onRetry={() => me.refetch()} />
  const p = me.data
  const name = `${p.first_name} ${p.last_name}`
  const department = departments.data?.items?.find((d) => d.id === p.department_id)?.name
  const where = [ROLE_LABEL[p.role], department].filter(Boolean).join(' · ')
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
        actions={<Button component={RouterLink} to={`/people/${p.id}/profile`} variant="outlined" startIcon={<ManageHistory />}
          sx={{ minHeight: 44 }}>My history</Button>} />
      <ErrorAlert error={failure} sx={{ mb: 2 }} />
      {/* One column on phones (profile, details, account, manager, skills); from md the profile card, manager and skills
          stack on the left beside the details and account. */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 2fr)' },
        gridTemplateAreas: { xs: '"profile" "details" "extra"', md: '"profile details" "extra details" ". details"' },
        gridTemplateRows: { md: 'auto auto 1fr' } }}>
        <Box sx={{ gridArea: 'profile', minWidth: 0 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack sx={{ gap: 0.5, alignItems: 'flex-start' }}>
              <UserAvatar userId={p.id} name={name} size={64} />
              <Typography variant="h3" component="h2" sx={{ mt: 1, overflowWrap: 'anywhere' }}>{name}</Typography>
              {p.job_title ? <Typography variant="body1" sx={{ color: 'text.secondary' }}>{p.job_title}</Typography> : null}
              {where ? <Typography variant="body2" sx={{ color: 'text.secondary' }}>{where}</Typography> : null}
              <DemoLock user={user} action="avatar.own">
                <Button variant="outlined" onClick={() => setPhotoOpen(true)} sx={{ mt: 1.5, minHeight: 44 }}>Profile photo</Button>
              </DemoLock>
            </Stack>
          </Paper>
          {photoOpen ? <AvatarDialog open user={p} onClose={() => setPhotoOpen(false)} /> : null}
        </Box>
        <Stack sx={{ gridArea: 'details', gap: 2, minWidth: 0 }}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h3" component="h2" sx={{ mb: 2 }}>Your details</Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}><TextField label="First name" value={form.first_name} onChange={set('first_name')} disabled={locked} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><TextField label="Last name" value={form.last_name} onChange={set('last_name')} disabled={locked} /></Grid>
              <Grid size={12}><TextField label="Email" type="email" value={form.email} onChange={set('email')} error={emailError} disabled={locked}
                helperText={emailError ? 'Enter a valid email address' : ' '} /></Grid>
            </Grid>
            <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 1 }}>
              {draft ? <Button onClick={() => setDraft(null)} sx={{ minHeight: 44 }}>Discard</Button> : null}
              <DemoLock user={user} action="profile.edit">
                <Button variant="contained" onClick={save} disabled={!draft || emailError || update.isPending} sx={{ minHeight: 44 }}>Save</Button>
              </DemoLock>
            </Stack>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h3" component="h2" sx={{ mb: 2 }}>Account</Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}><ReadOnly label="Username" value={p.username} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><ReadOnly label="Role" value={ROLE_LABEL[p.role]} /></Grid>
              <Grid size={{ xs: 12, sm: 6 }}><ReadOnly label="Job title" value={p.job_title} /></Grid>
            </Grid>
            {'salary' in p ? <EmploymentDetails salary={p.salary} /> : null}
          </Paper>
        </Stack>
        <Stack sx={{ gridArea: 'extra', gap: 2, minWidth: 0 }}>
          <ProfileCards profile={profile} person={{ id: p.id, name }} />
        </Stack>
      </Box>
    </>
  )
}
