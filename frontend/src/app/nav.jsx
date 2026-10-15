import AssignmentTurnedIn from '@mui/icons-material/AssignmentTurnedIn'
import Apartment from '@mui/icons-material/ApartmentOutlined'
import Chat from '@mui/icons-material/ChatOutlined'
import Dashboard from '@mui/icons-material/DashboardOutlined'
import Folder from '@mui/icons-material/FolderOutlined'
import Groups from '@mui/icons-material/GroupsOutlined'
import History from '@mui/icons-material/HistoryOutlined'
import Inventory from '@mui/icons-material/Inventory2Outlined'
import ManageHistory from '@mui/icons-material/ManageHistoryOutlined'
import PostAdd from '@mui/icons-material/PostAddOutlined'
import Schedule from '@mui/icons-material/ScheduleOutlined'
import ViewTimeline from '@mui/icons-material/ViewTimelineOutlined'

export const DRAWER_WIDTH = 248
export const COLLAPSED_WIDTH = 72

const HOME_LABEL = { employee: 'My week', admin: 'Control centre' }

// `to` and `label` can depend on who's signed in. Items marked `admin: true` sit in their own "Admin" group for admins;
// executives get the read-only ones (Archive, Audit log) with their work items. `badge` says what a count means
// (read aloud, e.g. "3 unread") and its colour; the default is "waiting" in the warning colour.
export const NAV = [
  { to: '/', label: (user) => HOME_LABEL[user?.role] ?? 'Dashboard', icon: <Dashboard />, end: true },
  { to: '/messages', label: 'Messages', icon: <Chat />, action: 'messages.use', badge: { label: 'unread', color: 'primary' } },
  { to: '/projects', label: 'Projects', icon: <Folder /> },
  // Employees; managers and admins only with "Tracks own hours" on.
  { to: '/timesheet', label: 'My timesheet', icon: <Schedule />, action: 'timesheet.use' },
  { to: (user) => `/people/${user.id}/profile`, label: 'My history', icon: <ManageHistory />, action: 'history.own' },
  // Managers and admins review and approve hours here; admins also send them to HR; executives read HR submissions.
  { to: '/timesheets', label: 'Timesheets', icon: <AssignmentTurnedIn />, action: 'timesheets.view' },
  { to: '/allocation', label: 'Allocation', icon: <ViewTimeline />, action: 'allocation.view' },
  { to: '/people', label: 'People', icon: <Groups />, action: 'people.view', admin: true },
  { to: '/departments', label: 'Departments', icon: <Apartment />, action: 'departments.manage', admin: true },
  { to: '/requests', label: 'Project requests', icon: <PostAdd />, action: 'requests.view', admin: true },
  { to: '/archive', label: 'Archive', icon: <Inventory />, action: 'archive.view', admin: true },
  { to: '/audit', label: 'Audit log', icon: <History />, action: 'audit.view', admin: true },
]
