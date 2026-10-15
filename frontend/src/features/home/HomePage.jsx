import { Box, Typography } from '@mui/material'
import { useSession } from '../../auth/sessionContext.js'
import DashboardPage from '../dashboard/DashboardPage.jsx'
import ApprovalsPanel from './ApprovalsPanel.jsx'
import ControlCentre from './ControlCentre.jsx'
import MyWeekPage from './MyWeekPage.jsx'

/** Each role lands somewhere different: employees on their week, managers on the dashboard with their approvals
 * queue pinned on top, admins on a control centre above the organisation-wide dashboard. */
export default function HomePage() {
  const { user } = useSession()
  if (user.role === 'employee') return <MyWeekPage />
  if (user.role === 'manager') return <DashboardPage top={<ApprovalsPanel />} approvalsButton={false} />
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
