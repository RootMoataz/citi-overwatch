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

export const NAV = [
  { to: '/', label: 'Dashboard', icon: <Dashboard />, end: true },
  { to: '/projects', label: 'Projects', icon: <Folder /> },
  { to: '/timesheet', label: 'My timesheet', icon: <Schedule /> },
  // `to` can depend on who's signed in.
  { to: (user) => `/people/${user.id}/profile`, label: 'My history', icon: <ManageHistory />, action: 'history.own' },
  { to: '/approvals', label: 'Approvals', icon: <AssignmentTurnedIn />, action: 'approvals.view' },
  { to: '/allocation', label: 'Allocation', icon: <ViewTimeline />, action: 'allocation.view' },
  { to: '/requests', label: 'Project requests', icon: <PostAdd />, action: 'requests.view' },
  { to: '/people', label: 'People', icon: <Groups />, action: 'people.view' },
  { to: '/departments', label: 'Departments', icon: <Apartment />, action: 'departments.manage' },
  { to: '/audit', label: 'Audit log', icon: <History />, action: 'audit.view' },
  { to: '/archive', label: 'Archive', icon: <Inventory />, action: 'archive.view' },
]
