import Visibility from '@mui/icons-material/VisibilityOutlined'
import { Box, Chip, Grid, Stack, Typography } from '@mui/material'
import { useSession } from '../../auth/sessionContext.js'
import DashboardPage from '../dashboard/DashboardPage.jsx'
import LiveTimersCard from '../timer/LiveTimersCard.jsx'
import ApprovalsPanel from './ApprovalsPanel.jsx'
import ControlCentre from './ControlCentre.jsx'
import MyWeekPage from './MyWeekPage.jsx'
import ProjectStatusCard from './ProjectStatusCard.jsx'
import { isReadOnly } from '../../lib/permissions.js'

/** Each role lands somewhere different: employees on their week, managers on the dashboard with their approvals
 * queue and who's running a timer (Live now) pinned on top, admins on a control centre (with Live now) above the
 * organisation-wide dashboard, and executives (Live now read-only) on that
 * same organisation-wide dashboard, marked read-only, without the admin shortcuts. Admins and executives both get
 * projects by status (archived included) at the top. */
export default function HomePage() {
  const { user } = useSession()
  if (user.role === 'employee') return <MyWeekPage />
  if (user.role === 'manager') {
    return (
      <DashboardPage approvalsButton={false} top={(
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 6 }}><ApprovalsPanel /></Grid>
          <Grid size={{ xs: 12, md: 6 }}><LiveTimersCard /></Grid>
        </Grid>
      )} />
    )
  }
  if (isReadOnly(user)) {
    return (
      <DashboardPage title="Organisation dashboard"
        subtitle={(
          <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip size="small" variant="outlined" color="info" icon={<Visibility />} label="Read-only view" />
            <span>Hello, {user.first_name}. Live delivery health across the organisation.</span>
          </Stack>
        )}
        intro={<Box sx={{ mb: 3 }}><ProjectStatusCard /><Box sx={{ mt: 2 }}><LiveTimersCard /></Box></Box>} />
    )
  }
  return (
    <DashboardPage title="Control centre"
      subtitle={`Hello, ${user.first_name}. Admin shortcuts first, then live delivery health across the organisation.`}
      intro={(
        <Box sx={{ mb: 3 }}>
          <ControlCentre />
          <Box sx={{ mt: 2 }}><LiveTimersCard /></Box>
          <Box sx={{ mt: 2 }}><ProjectStatusCard /></Box>
          <Typography variant="h3" component="h2" sx={{ mt: 4 }}>Organisation dashboard</Typography>
        </Box>
      )} />
  )
}
