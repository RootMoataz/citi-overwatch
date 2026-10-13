import { Route, Routes } from 'react-router-dom'
import RequireAuth from '../auth/RequireAuth.jsx'
import SessionProvider from '../auth/SessionProvider.jsx'
import { useSession } from '../auth/sessionContext.js'
import EmptyState from '../components/EmptyState.jsx'
import ForgotPasswordPage from '../features/login/ForgotPasswordPage.jsx'
import LoginPage from '../features/login/LoginPage.jsx'
import ProjectDetailPage from '../features/projects/ProjectDetailPage.jsx'
import ProjectsPage from '../features/projects/ProjectsPage.jsx'
import RequestsPage from '../features/requests/RequestsPage.jsx'
import ApprovalsPage from '../features/approvals/ApprovalsPage.jsx'
import TimesheetPage from '../features/timesheet/TimesheetPage.jsx'
import NotificationBell from '../components/NotificationBell.jsx'
import { useApprovals } from '../api/queries.js'
import { can } from '../lib/permissions.js'
import Layout from './Layout.jsx'
import NotFound from './NotFound.jsx'

function Shell() {
  const { user, logout } = useSession()
  const approver = can(user, 'approvals.view')
  const approvals = useApprovals({}, approver)
  const waiting = approvals.data?.length ?? 0
  return <Layout user={user} onLogout={logout} topBarExtras={approver ? <NotificationBell /> : null}
    badges={waiting ? { '/approvals': waiting } : undefined} />
}

function Welcome() {
  const { user } = useSession()
  return <EmptyState title={`Welcome, ${user.first_name}`} description="Pick a section from the menu to get started." />
}

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route element={<RequireAuth><Shell /></RequireAuth>}>
          <Route index element={<Welcome />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="timesheet" element={<TimesheetPage />} />
          <Route path="approvals" element={<RequireAuth roles={['admin', 'manager']}><ApprovalsPage /></RequireAuth>} />
          <Route path="requests" element={<RequireAuth roles={['admin', 'manager']}><RequestsPage /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </SessionProvider>
  )
}
