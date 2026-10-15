import { zodResolver } from '@hookform/resolvers/zod'
import BusinessCenter from '@mui/icons-material/BusinessCenterOutlined'
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
}

// Public demo accounts (documented in the README). Admin is deliberately not here: its password is private.
const DEMO_PASSWORD = 'Demo123!'
const DEMOS = [
  { label: 'Employee', username: 'employee.demo', icon: <Person /> },
  { label: 'Manager', username: 'manager.demo', icon: <SupervisorAccount /> },
  { label: 'Executive', username: 'executive.demo', icon: <BusinessCenter /> },
]

/** One click signs in as a demo role. */
function DemoButtons({ pending, disabled, onPick }) {
  return (
    <Box role="group" aria-labelledby="demo-heading">
      <Divider sx={{ my: 3, color: 'text.secondary', fontSize: '0.8125rem' }}>
        <span id="demo-heading">Try the demo</span>
      </Divider>
      <Stack direction="row" sx={{ gap: 1 }}>
        {DEMOS.map((d) => (
          <Button key={d.username} variant="outlined" startIcon={d.icon} disabled={disabled} loading={pending === d.username}
            loadingPosition="start" onClick={() => onPick(d.username)}
            sx={{ flex: 1, minWidth: 0, px: 1, flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 0.25, sm: 0 },
              '& .MuiButton-startIcon': { m: { xs: 0, sm: '0 6px 0 -2px' } } }}>
            {d.label}
          </Button>
        ))}
      </Stack>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', textAlign: 'center', mt: 1.25 }}>
        Signs in with a public demo account, filled with sample projects.
      </Typography>
    </Box>
  )
}

export default function LoginPage() {
  const { status, login } = useSession()
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
    </AuthCard>
  )
}
