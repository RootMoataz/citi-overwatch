import ArrowBack from '@mui/icons-material/ArrowBack'
import Edit from '@mui/icons-material/EditOutlined'
import { Box, Button, Link, Skeleton, Stack, Tab, Tabs } from '@mui/material'
import { useState } from 'react'
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useArchiveProject, useProject, useRestoreProject, useUpdateProject } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import DemoLock from '../../components/DemoLock.jsx'
import { useRedirectOnDenied } from '../../app/access.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import RiskBadges from '../../components/RiskBadges.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { can } from '../../lib/permissions.js'
import { useBreadcrumb } from '../../app/breadcrumbs.js'
import { projectTabs } from './tabs.js'
import ProjectForm from './ProjectForm.jsx'

export default function ProjectDetailPage() {
  const { id } = useParams()
  const { user } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const project = useProject(id)
  const update = useUpdateProject(id)
  const archive = useArchiveProject(id)
  const restore = useRestoreProject(id)
  const [editing, setEditing] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const leaving = useRedirectOnDenied(project.error)
  useBreadcrumb(project.data?.name, { failed: Boolean(project.error) })

  const back = <Link component={RouterLink} to="/projects" underline="hover"
    sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, mb: 1 }}><ArrowBack fontSize="small" /> Projects</Link>

  if (leaving) return null
  if (project.isLoading) return <Box>{back}<Skeleton variant="text" width={320} height={48} /><Skeleton variant="rounded" height={240} /></Box>
  if (project.error) return <Box>{back}<ErrorAlert error={project.error} onRetry={() => project.refetch()} /></Box>

  const p = project.data
  const resource = { managerId: p.manager.id }
  const manage = can(user, 'project.manage', resource) && !p.is_archived
  const { tabs, current: tab } = projectTabs(p, params.get('tab'))
  const ActiveTab = tabs.find((t) => t.value === tab).Component

  return (
    <>
      <PageHeader breadcrumb={back} title={p.name}
        subtitle={<Stack component="span" direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <StatusChip status={p.status} />{p.is_archived ? <StatusChip status="blocked" label="Archived" /> : null}
          <RiskBadges reasons={p.at_risk_reasons} />
        </Stack>}
        actions={<>
          {manage ? <Button variant="outlined" startIcon={<Edit />} onClick={() => setEditing(true)}>Edit</Button> : null}
          {can(user, 'project.archive') && !p.is_archived ? (
            <DemoLock user={user} action="project.archive">
              <Button color="error" onClick={() => setConfirmArchive(true)}>Archive</Button>
            </DemoLock>
          ) : null}
          {can(user, 'project.archive') && p.is_archived ? (
            <DemoLock user={user} action="project.archive">
              <Button variant="contained" onClick={() => restore.mutate()}>Restore</Button>
            </DemoLock>
          ) : null}
        </>} />
      <Tabs value={tab} onChange={(_, value) => setParams({ tab: value }, { replace: true })} variant="scrollable"
        allowScrollButtonsMobile aria-label="Project sections" sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        {tabs.map((t) => <Tab key={t.value} value={t.value} label={t.label} id={`tab-${t.value}`}
          aria-controls={`panel-${t.value}`} />)}
      </Tabs>
      <Box role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <ActiveTab project={p} manage={manage} user={user} />
      </Box>
      {editing ? (
        <ProjectForm open project={p} onClose={() => setEditing(false)}
          onSave={async (body) => { await update.mutateAsync(body); setEditing(false) }} />
      ) : null}
      <ConfirmDialog open={confirmArchive} title="Archive this project?" confirmLabel="Archive" busy={archive.isPending}
        body="It disappears for everyone except admins and stops counting toward budgets and workloads. An admin can restore it later."
        onClose={() => setConfirmArchive(false)}
        onConfirm={async () => { await archive.mutateAsync(); setConfirmArchive(false); navigate('/projects') }} />
    </>
  )
}
