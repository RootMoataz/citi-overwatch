import { zodResolver } from '@hookform/resolvers/zod'
import AdminPanelSettings from '@mui/icons-material/AdminPanelSettingsOutlined'
import BusinessCenter from '@mui/icons-material/BusinessCenterOutlined'
import GitHub from '@mui/icons-material/GitHub'
import OpenInNew from '@mui/icons-material/OpenInNew'
import Person from '@mui/icons-material/PersonOutlined'
import SupervisorAccount from '@mui/icons-material/SupervisorAccountOutlined'
import { Alert, Box, Button, Divider, Link, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import { useSession } from '../../auth/sessionContext.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { loginSchema } from '../../lib/schemas.js'
import AuthCard from './AuthCard.jsx'

const KNOWN = {
  INVALID_CREDENTIALS: () => 'Incorrect username or password.',
  TEMP_PASSWORD_EXPIRED: () => 'Temporary password expired — ask an admin to reset it.',
  ACCOUNT_LOCKED: (err) => {
    const until = err.details?.until ? new Date(err.details.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null
    return `Too many failed attempts. Try again${until ? ` after ${until}` : ' in 15 minutes'}.`
  },
  RATE_LIMITED: () => 'Too many demo sign-ins from your network. Wait a minute and try again.',
}

// Public demo accounts (documented in the README). Admin is the public demo admin demo.admin, never the real admin
// account (its password is private): the server disables its risky actions and ends its session after 5 minutes.
const DEMO_PASSWORD = 'Demo123!'
const DEMOS = [
  { label: 'Employee', username: 'employee.demo', icon: <Person /> },
  { label: 'Manager', username: 'manager.demo', icon: <SupervisorAccount /> },
  { label: 'Executive', username: 'executive.demo', icon: <BusinessCenter /> },
  { label: 'Admin', username: 'demo.admin', icon: <AdminPanelSettings /> },
]
const DEMO_ENDED = 'Your 5-minute demo session has ended.'

/** One click signs in as a demo role. Four roles sit in a two-by-two grid so every label fits on a phone. */
function DemoButtons({ pending, disabled, onPick }) {
  return (
    <Box role="group" aria-labelledby="demo-heading">
      <Divider sx={{ my: 3, color: 'text.secondary', fontSize: '0.8125rem' }}>
        <span id="demo-heading">Try the demo</span>
      </Divider>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
        {DEMOS.map((d) => (
          <Button key={d.username} variant="outlined" startIcon={d.icon} disabled={disabled} loading={pending === d.username}
            loadingPosition="start" onClick={() => onPick(d.username)} sx={{ minWidth: 0, px: 1 }}>
            {d.label}
          </Button>
        ))}
      </Box>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', textAlign: 'center', mt: 1.25 }}>
        Signs in with a public demo account, filled with sample projects. The Admin demo signs you out after 5 minutes
        and has some actions disabled.
      </Typography>
    </Box>
  )
}

const REPO_URL = 'https://github.com/RootMoataz/citi-overwatch'

/** A pill that opens the project's source code on GitHub in a new tab. */
function SourceLink() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2.5 }}>
      <Button component="a" href={REPO_URL} target="_blank" rel="noopener noreferrer" size="small"
        startIcon={<GitHub />} endIcon={<OpenInNew sx={{ fontSize: '0.9rem !important' }} />}
        sx={{
          borderRadius: 999, px: 2, py: 0.75, textTransform: 'none', fontWeight: 600, color: 'text.primary',
          border: 1, borderColor: 'divider', bgcolor: 'action.hover',
          transition: 'transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease',
          '&:hover': { bgcolor: 'action.selected', borderColor: 'primary.main', transform: 'translateY(-1px)', boxShadow: 3 },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
        }}>
        View the source on GitHub
      </Button>
    </Box>
  )
}

export default function LoginPage() {
  const { status, login, ended } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const [failure, setFailure] = useState(null)
  const [demo, setDemo] = useState(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(loginSchema), defaultValues: { username: '', password: '' },
  })

  if (status === 'ready' || status === 'restricted') return <Navigate to={location.state?.from ?? '/'} replace />

  const onSubmit = async ({ username, password }) => {
    setFailure(null)
    try {
      await login(username, password)
      navigate(location.state?.from ?? '/', { replace: true })
    } catch (err) {
      setFailure(err)
    }
  }

  const signInAsDemo = async (username) => {
    setFailure(null)
    setDemo(username)
    try {
      await login(username, DEMO_PASSWORD)
      navigate(location.state?.from ?? '/', { replace: true })
    } catch (err) {
      setFailure(err)
      setDemo(null)
    }
  }

  const busy = isSubmitting || Boolean(demo)
  const known = failure && KNOWN[failure.code]
  return (
    <AuthCard title="Sign in" subtitle="Welcome back. Sign in with your ACME account.">
      <Stack component="form" noValidate onSubmit={handleSubmit(onSubmit)} sx={{ gap: 2 }}>
        {location.state?.notice ? <Alert severity="success">{location.state.notice}</Alert> : null}
        {ended === 'demo' && !failure ? <Alert severity="info" role="status">{DEMO_ENDED}</Alert> : null}
        {known ? <Alert severity="error" role="alert">{known(failure)}</Alert> : <ErrorAlert error={failure} />}
        <TextField label="Username" autoComplete="username" autoFocus required {...register('username')}
          error={Boolean(errors.username)} helperText={errors.username?.message} disabled={busy} />
        <TextField label="Password" type="password" autoComplete="current-password" required {...register('password')}
          error={Boolean(errors.password)} helperText={errors.password?.message} disabled={busy} />
        <Button type="submit" variant="contained" size="large" disabled={busy}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
        <Link component={RouterLink} to="/forgot-password" variant="body2" sx={{ alignSelf: 'center' }}>
          Forgot password?
        </Link>
      </Stack>
      <DemoButtons pending={demo} disabled={busy} onPick={signInAsDemo} />
      <SourceLink />
    </AuthCard>
  )
}
