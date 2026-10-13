import { zodResolver } from '@hookform/resolvers/zod'
import { Alert, Button, Link, Stack, Step, StepLabel, Stepper, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { api } from '../../api/client.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PasswordPolicyChecklist from '../../components/PasswordPolicyChecklist.jsx'
import { codeSchema, newPasswordSchema, usernameSchema } from '../../lib/schemas.js'
import AuthCard from './AuthCard.jsx'

const RESEND_SECONDS = 60
const STEPS = ['Username', 'Code', 'New password']

function UsernameStep({ onDone }) {
  const [failure, setFailure] = useState(null)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(usernameSchema), defaultValues: { username: '' },
  })
  const onSubmit = async ({ username }) => {
    setFailure(null)
    try {
      await api.post('/auth/forgot-password', { username })
      onDone(username)
    } catch (err) { setFailure(err) }
  }
  return (
    <Stack component="form" noValidate onSubmit={handleSubmit(onSubmit)} sx={{ gap: 2 }}>
      <ErrorAlert error={failure} />
      <TextField label="Username" autoComplete="username" autoFocus required {...register('username')}
        error={Boolean(errors.username)} helperText={errors.username?.message} disabled={isSubmitting} />
      <Button type="submit" variant="contained" disabled={isSubmitting}>{isSubmitting ? 'Sending…' : 'Next'}</Button>
    </Stack>
  )
}

function CodeStep({ username, onDone, onRestart }) {
  // A fixed deadline (not a chain of 1s timeouts) stays correct even if the tab sleeps.
  const [resendAt, setResendAt] = useState(() => Date.now() + RESEND_SECONDS * 1000)
  const [now, setNow] = useState(() => Date.now())
  const secondsLeft = Math.max(0, Math.ceil((resendAt - now) / 1000))
  const [failure, setFailure] = useState(null)
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(codeSchema), defaultValues: { code: '' },
  })

  useEffect(() => {
    if (secondsLeft <= 0) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [secondsLeft])

  const resend = async () => {
    setFailure(null)
    try {
      await api.post('/auth/forgot-password', { username })
      setResendAt(Date.now() + RESEND_SECONDS * 1000)
      setNow(Date.now())
    } catch (err) { setFailure(err) }
  }

  const onSubmit = async ({ code }) => {
    setFailure(null)
    try {
      const { reset_token: token } = await api.post('/auth/verify-reset-code', { username, code })
      onDone(token)
    } catch (err) {
      if (err.code === 'CODE_INVALID') setError('code', { message: "That code isn't right" })
      else setFailure(err)
    }
  }

  const terminal = failure && ['CODE_EXPIRED', 'CODE_LOCKED'].includes(failure.code)
  return (
    <Stack component="form" noValidate onSubmit={handleSubmit(onSubmit)} sx={{ gap: 2 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        If <strong>{username}</strong> has an account, we've emailed a 6-digit code. It expires in 15 minutes.
        No email? Ask an admin to reset your password.
      </Typography>
      {terminal ? (
        <Alert severity="error" role="alert" action={<Button color="inherit" size="small" onClick={onRestart}>Start again</Button>}>
          {failure.message}
        </Alert>
      ) : <ErrorAlert error={failure} />}
      <TextField label="6-digit code" autoComplete="one-time-code" autoFocus required
        slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}
        {...register('code')} error={Boolean(errors.code)} helperText={errors.code?.message} disabled={isSubmitting} />
      <Button type="submit" variant="contained" disabled={isSubmitting}>{isSubmitting ? 'Checking…' : 'Verify code'}</Button>
      <Button onClick={resend} disabled={secondsLeft > 0}>
        {secondsLeft > 0 ? `Resend code (${secondsLeft}s)` : 'Resend code'}
      </Button>
    </Stack>
  )
}

function PasswordStep({ token, onDone, onRestart }) {
  const [failure, setFailure] = useState(null)
  const { register, handleSubmit, control, setError, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(newPasswordSchema), defaultValues: { new_password: '', confirm_password: '' },
  })
  const newPassword = useWatch({ control, name: 'new_password' })

  const onSubmit = async ({ new_password: chosen }) => {
    setFailure(null)
    try {
      await api.post('/auth/reset-password', { reset_token: token, new_password: chosen })
      onDone()
    } catch (err) {
      if (err.code === 'PASSWORD_POLICY') setError('new_password', { message: "Doesn't meet the password rules yet" })
      else setFailure(err)
    }
  }
  return (
    <Stack component="form" noValidate onSubmit={handleSubmit(onSubmit)} sx={{ gap: 2 }}>
      {failure?.code === 'TOKEN_INVALID' || failure?.code === 'TOKEN_EXPIRED' ? (
        <Alert severity="error" role="alert" action={<Button color="inherit" size="small" onClick={onRestart}>Start again</Button>}>
          This reset has expired. Start again to get a new code.
        </Alert>
      ) : <ErrorAlert error={failure} />}
      <TextField label="New password" type="password" autoComplete="new-password" autoFocus required
        {...register('new_password')} error={Boolean(errors.new_password)} helperText={errors.new_password?.message}
        disabled={isSubmitting} />
      <PasswordPolicyChecklist value={newPassword} />
      <TextField label="Confirm new password" type="password" autoComplete="new-password" required
        {...register('confirm_password')} error={Boolean(errors.confirm_password)}
        helperText={errors.confirm_password?.message} disabled={isSubmitting} />
      <Button type="submit" variant="contained" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : 'Save password'}</Button>
    </Stack>
  )
}

export default function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [username, setUsername] = useState('')
  const [token, setToken] = useState('')
  const restart = () => { setStep(0); setToken('') }

  return (
    <AuthCard title="Reset your password" subtitle="We'll email you a code to confirm it's you.">
      <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>
        {STEPS.map((label) => <Step key={label}><StepLabel>{label}</StepLabel></Step>)}
      </Stepper>
      {step === 0 ? <UsernameStep onDone={(name) => { setUsername(name); setStep(1) }} /> : null}
      {step === 1 ? <CodeStep username={username} onRestart={restart} onDone={(t) => { setToken(t); setStep(2) }} /> : null}
      {step === 2 ? (
        <PasswordStep token={token} onRestart={restart}
          onDone={() => navigate('/login', { replace: true,
            state: { notice: 'Password updated. Sign in with your new password.' } })} />
      ) : null}
      <Link component={RouterLink} to="/login" variant="body2" sx={{ display: 'block', textAlign: 'center', mt: 2 }}>
        Back to sign in
      </Link>
    </AuthCard>
  )
}
