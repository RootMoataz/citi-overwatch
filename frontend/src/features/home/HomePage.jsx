import Visibility from '@mui/icons-material/VisibilityOutlined'
import { Box, Chip, Stack, Typography } from '@mui/material'
import { useSession } from '../../auth/sessionContext.js'
import DashboardPage from '../dashboard/DashboardPage.jsx'
import ApprovalsPanel from './ApprovalsPanel.jsx'
import ControlCentre from './ControlCentre.jsx'
import MyWeekPage from './MyWeekPage.jsx'
import { isReadOnly } from '../../lib/permissions.js'

/** Each role lands somewhere different: employees on their week, managers on the dashboard with their approvals
 * queue pinned on top, admins on a control centre above the organisation-wide dashboard, and executives on that
 * same organisation-wide dashboard, marked read-only, without the admin shortcuts. */
export default function HomePage() {
  const { user } = useSession()
  if (user.role === 'employee') return <MyWeekPage />
  if (user.role === 'manager') return <DashboardPage top={<ApprovalsPanel />} approvalsButton={false} />
  if (isReadOnly(user)) {
    return (
      <DashboardPage title="Organisation dashboard"
        subtitle={(
          <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip size="small" variant="outlined" color="info" icon={<Visibility />} label="Read-only view" />
            <span>Hello, {user.first_name}. Live delivery health across the organisation.</span>
          </Stack>
        )} />
    )
  }
  return (
    <DashboardPage title="Control centre"
      subtitle={`Hello, ${user.first_name}. Admin shortcuts first, then live delivery health across the organisation.`}
      intro={(
        <Box sx={{ mb: 3 }}>
          <ControlCentre />
          <Typography variant="h3" component="h2" sx={{ mt: 4 }}>Organisation dashboard</Typography>
        </Box>
      )} />
  )
}
