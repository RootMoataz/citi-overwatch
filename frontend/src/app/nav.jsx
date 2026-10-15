import AssignmentTurnedIn from '@mui/icons-material/AssignmentTurnedIn'
import Apartment from '@mui/icons-material/ApartmentOutlined'
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

const HOME_LABEL = { employee: 'My week', admin: 'Control centre' }

// `to` and `label` can depend on who's signed in. Items marked `admin: true` sit in their own "Admin" group for admins.
export const NAV = [
  { to: '/', label: (user) => HOME_LABEL[user?.role] ?? 'Dashboard', icon: <Dashboard />, end: true },
  { to: '/projects', label: 'Projects', icon: <Folder /> },
  { to: '/timesheet', label: 'My timesheet', icon: <Schedule /> },
  { to: (user) => `/people/${user.id}/profile`, label: 'My history', icon: <ManageHistory />, action: 'history.own' },
  { to: '/approvals', label: 'Approvals', icon: <AssignmentTurnedIn />, action: 'approvals.view' },
  { to: '/allocation', label: 'Allocation', icon: <ViewTimeline />, action: 'allocation.view' },
  { to: '/people', label: 'People', icon: <Groups />, action: 'people.view', admin: true },
  { to: '/departments', label: 'Departments', icon: <Apartment />, action: 'departments.manage', admin: true },
  { to: '/requests', label: 'Project requests', icon: <PostAdd />, action: 'requests.view', admin: true },
  { to: '/archive', label: 'Archive', icon: <Inventory />, action: 'archive.view', admin: true },
  { to: '/audit', label: 'Audit log', icon: <History />, action: 'audit.view', admin: true },
]
