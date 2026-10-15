import { Route, Routes } from 'react-router-dom'
import RequireAuth from '../auth/RequireAuth.jsx'
import SessionProvider from '../auth/SessionProvider.jsx'
import { useSession } from '../auth/sessionContext.js'
import ForgotPasswordPage from '../features/login/ForgotPasswordPage.jsx'
import LoginPage from '../features/login/LoginPage.jsx'
import ProjectDetailPage from '../features/projects/ProjectDetailPage.jsx'
import ProjectsPage from '../features/projects/ProjectsPage.jsx'
import RequestsPage from '../features/requests/RequestsPage.jsx'
import ApprovalsPage from '../features/approvals/ApprovalsPage.jsx'
import TimesheetPage from '../features/timesheet/TimesheetPage.jsx'
import HomePage from '../features/home/HomePage.jsx'
import AllocationPage from '../features/allocation/AllocationPage.jsx'
import PeoplePage from '../features/people/PeoplePage.jsx'
import UserDetailPage from '../features/people/UserDetailPage.jsx'
import PersonProfilePage from '../features/people/PersonProfilePage.jsx'
import ProfilePage from '../features/profile/ProfilePage.jsx'
import ArchivePage from '../features/archive/ArchivePage.jsx'
import AuditPage from '../features/audit/AuditPage.jsx'
import DepartmentsPage from '../features/departments/DepartmentsPage.jsx'
import NotificationBell from '../components/NotificationBell.jsx'
import { useApprovals } from '../api/queries.js'
import { can } from '../lib/permissions.js'
import { ROUTE_ROLES } from './access.js'
import Layout from './Layout.jsx'
import NotFound from './NotFound.jsx'

function Shell() {
  const { user, logout } = useSession()
  const approver = can(user, 'approvals.view')
  const approvals = useApprovals({}, approver)
  const waiting = approvals.data?.length ?? 0
  // Everyone gets the bell: managers hear about overtime and routing, employees about rejected hours and support work.
  return <Layout user={user} onLogout={logout} topBarExtras={<NotificationBell />}
    badges={waiting ? { '/approvals': waiting } : undefined} />
}

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route element={<RequireAuth><Shell /></RequireAuth>}>
          <Route index element={<HomePage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="timesheet" element={<TimesheetPage />} />
          <Route path="approvals" element={<RequireAuth roles={ROUTE_ROLES.approvals}><ApprovalsPage /></RequireAuth>} />
          <Route path="requests" element={<RequireAuth roles={ROUTE_ROLES.requests}><RequestsPage /></RequireAuth>} />
          <Route path="allocation" element={<RequireAuth roles={ROUTE_ROLES.allocation}><AllocationPage /></RequireAuth>} />
          <Route path="people" element={<RequireAuth roles={ROUTE_ROLES.people}><PeoplePage /></RequireAuth>} />
          <Route path="people/:id" element={<RequireAuth roles={ROUTE_ROLES['people/:id']}><UserDetailPage /></RequireAuth>} />
          {/* Every role; the server returns 404 for anyone the viewer may not see, which sends them home. */}
          <Route path="people/:id/profile" element={<PersonProfilePage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="departments" element={<RequireAuth roles={ROUTE_ROLES.departments}><DepartmentsPage /></RequireAuth>} />
          <Route path="audit" element={<RequireAuth roles={ROUTE_ROLES.audit}><AuditPage /></RequireAuth>} />
          <Route path="archive" element={<RequireAuth roles={ROUTE_ROLES.archive}><ArchivePage /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </SessionProvider>
  )
}
