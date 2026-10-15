import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import RequireAuth from '../auth/RequireAuth.jsx'
import SessionProvider from '../auth/SessionProvider.jsx'
import { useSession } from '../auth/sessionContext.js'
import ForgotPasswordPage from '../features/login/ForgotPasswordPage.jsx'
import LoginPage from '../features/login/LoginPage.jsx'
import ProjectDetailPage from '../features/projects/ProjectDetailPage.jsx'
import ProjectsPage from '../features/projects/ProjectsPage.jsx'
import RequestsPage from '../features/requests/RequestsPage.jsx'
import TimesheetPage from '../features/timesheet/TimesheetPage.jsx'
import TimesheetsPage from '../features/timesheets/TimesheetsPage.jsx'
import HomePage from '../features/home/HomePage.jsx'
import AllocationPage from '../features/allocation/AllocationPage.jsx'
import PeoplePage from '../features/people/PeoplePage.jsx'
import UserDetailPage from '../features/people/UserDetailPage.jsx'
import PersonProfilePage from '../features/people/PersonProfilePage.jsx'
import ProfilePage from '../features/profile/ProfilePage.jsx'
import ArchivePage from '../features/archive/ArchivePage.jsx'
import AuditPage from '../features/audit/AuditPage.jsx'
import DepartmentsPage from '../features/departments/DepartmentsPage.jsx'
import SkillsPage from '../features/skills/SkillsPage.jsx'
import MessagesPage from '../features/messages/MessagesPage.jsx'
import NotificationBell from '../components/NotificationBell.jsx'
import { useApprovals } from '../api/queries.js'
import { useUnreadMessages } from '../api/messages.js'
import { can } from '../lib/permissions.js'
import { ROUTE_CHECKS, ROUTE_ROLES } from './access.js'
import Layout from './Layout.jsx'
import NotFound from './NotFound.jsx'

function Shell() {
  const { user, logout } = useSession()
  const approver = can(user, 'approvals.view')
  const approvals = useApprovals({}, approver)
  const waiting = approvals.data?.length ?? 0
  // Unread messages refresh every few seconds while Messages is open, at the normal pace elsewhere.
  const onMessages = useLocation().pathname.startsWith('/messages')
  const unread = useUnreadMessages({ fast: onMessages }).data?.unread ?? 0
  const badges = { ...(waiting ? { '/timesheets': waiting } : {}), ...(unread ? { '/messages': unread } : {}) }
  // Everyone gets the bell: managers hear about overtime and routing, employees about rejected hours and support work.
  return <Layout user={user} onLogout={logout} topBarExtras={<NotificationBell />} badges={badges} />
}

/** The old Approvals address (bookmarks, older alerts) opens Timesheets with the same filters. */
export function ApprovalsRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/timesheets${search}`} replace />
}

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route element={<RequireAuth><Shell /></RequireAuth>}>
          <Route index element={<HomePage />} />
          <Route path="messages" element={<RequireAuth roles={ROUTE_ROLES.messages}><MessagesPage /></RequireAuth>} />
          <Route path="messages/:id" element={<RequireAuth roles={ROUTE_ROLES['messages/:id']}><MessagesPage /></RequireAuth>} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="timesheet" element={<RequireAuth roles={ROUTE_ROLES.timesheet} allow={ROUTE_CHECKS.timesheet}><TimesheetPage /></RequireAuth>} />
          <Route path="timesheets" element={<RequireAuth roles={ROUTE_ROLES.timesheets}><TimesheetsPage /></RequireAuth>} />
          <Route path="approvals" element={<ApprovalsRedirect />} />
          <Route path="requests" element={<RequireAuth roles={ROUTE_ROLES.requests}><RequestsPage /></RequireAuth>} />
          <Route path="allocation" element={<RequireAuth roles={ROUTE_ROLES.allocation}><AllocationPage /></RequireAuth>} />
          <Route path="people" element={<RequireAuth roles={ROUTE_ROLES.people}><PeoplePage /></RequireAuth>} />
          <Route path="people/:id" element={<RequireAuth roles={ROUTE_ROLES['people/:id']}><UserDetailPage /></RequireAuth>} />
          {/* Every role; the server returns 404 for anyone the viewer may not see, which sends them home. */}
          <Route path="people/:id/profile" element={<PersonProfilePage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="departments" element={<RequireAuth roles={ROUTE_ROLES.departments}><DepartmentsPage /></RequireAuth>} />
          <Route path="skills" element={<RequireAuth roles={ROUTE_ROLES.skills}><SkillsPage /></RequireAuth>} />
          <Route path="audit" element={<RequireAuth roles={ROUTE_ROLES.audit}><AuditPage /></RequireAuth>} />
          <Route path="archive" element={<RequireAuth roles={ROUTE_ROLES.archive}><ArchivePage /></RequireAuth>} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </SessionProvider>
  )
}
