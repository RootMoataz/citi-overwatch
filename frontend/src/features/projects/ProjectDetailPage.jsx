import { Box, Skeleton, Tab, Tabs } from '@mui/material'
import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useArchiveProject, useProject, useRestoreProject, useUpdateProject } from '../../api/queries.js'
import { useSession } from '../../auth/sessionContext.js'
import ConfirmDialog from '../../components/ConfirmDialog.jsx'
import { useRedirectOnDenied } from '../../app/access.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { useBreadcrumb } from '../../app/breadcrumbs.js'
import { projectTabs } from './tabs.js'
import ProjectForm from './ProjectForm.jsx'
import ProjectHeader from './ProjectHeader.jsx'
import { projectView } from './viewer.js'

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

  if (leaving) return null
  if (project.isLoading) return <Box><Skeleton variant="text" width={320} height={48} /><Skeleton variant="rounded" height={240} /></Box>
  if (project.error) return <Box><ErrorAlert error={project.error} onRetry={() => project.refetch()} /></Box>

  const p = project.data
  const view = projectView(user, p)
  const { manage } = view
  const { tabs, current: tab } = projectTabs(p, params.get('tab'))
  const ActiveTab = tabs.find((t) => t.value === tab).Component

  return (
    <>
      <ProjectHeader project={p} user={user} view={view} onEdit={() => setEditing(true)}
        onArchive={() => setConfirmArchive(true)} onRestore={() => restore.mutate()} busy={archive.isPending || restore.isPending} />
      <Tabs value={tab} onChange={(_, value) => setParams({ tab: value }, { replace: true })} variant="scrollable"
        allowScrollButtonsMobile aria-label="Project sections" sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        {tabs.map((t) => <Tab key={t.value} value={t.value} label={t.label} id={`tab-${t.value}`}
          aria-controls={`panel-${t.value}`} />)}
      </Tabs>
      <Box role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        <ActiveTab project={p} manage={manage} user={user} view={view} />
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
