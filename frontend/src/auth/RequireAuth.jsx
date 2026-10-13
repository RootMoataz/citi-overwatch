import { Box, CircularProgress } from '@mui/material'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import EmptyState from '../components/EmptyState.jsx'
import ForcePasswordChange from './ForcePasswordChange.jsx'
import { useSession } from './sessionContext.js'

/** Guards app routes: sign-in first, then the forced password change, then the role check. */
export default function RequireAuth({ roles, children }) {
  const { user, status } = useSession()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
        <CircularProgress aria-label="Loading your session" />
      </Box>
    )
  }
  if (status === 'anon') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  if (status === 'restricted') return <ForcePasswordChange />
  if (roles && !roles.includes(user.role)) {
    return <EmptyState title="You don't have access to this page"
      description="Ask an admin if you think you should." />
  }
  return children ?? <Outlet />
}
