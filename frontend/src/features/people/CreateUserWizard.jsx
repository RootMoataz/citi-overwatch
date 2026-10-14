import CheckCircle from '@mui/icons-material/CheckCircle'
import Cancel from '@mui/icons-material/Cancel'
import {
  Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Grid, InputAdornment, MenuItem,
  Stack, Step, StepLabel, Stepper, Table, TableBody, TableCell, TableRow, TextField, Typography,
} from '@mui/material'
import { useEffect, useId, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { useCreateUser, useManagers, useUsernameCheck } from '../../api/queries.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import PasswordPolicyChecklist from '../../components/PasswordPolicyChecklist.jsx'
import { formatMoney, fullName } from '../../lib/format.js'
import { DESKTOP_QUERY } from '../../lib/responsive.js'
import { relayCredentials } from '../../lib/emailRelay.js'
import { EMAIL_RE, generatePassword, passwordRuleErrors } from '../../lib/schemas.js'
import { useToast } from '../../app/toast.js'
import ShowOnceDialog from './ShowOnceDialog.jsx'

const STEPS = ['Name', 'Email & role', 'Username', 'Password', 'Review']
const ROLES = [{ value: 'employee', label: 'Employee' }, { value: 'manager', label: 'Manager' }, { value: 'admin', label: 'Admin' }]
const USERNAME_RE = /^[a-z0-9._]{3,20}$/

/** Debounce a value so the username check doesn't fire on every key press. */
function useDebounced(value, ms = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => { const t = setTimeout(() => setDebounced(value), ms); return () => clearTimeout(t) }, [value, ms])
  return debounced
}

function UsernameStep({ form, set }) {
  const typed = form.username.trim().toLowerCase()
  const debounced = useDebounced(typed)
  const check = useUsernameCheck({ username: debounced, first: form.first_name, last: form.last_name })
  const settled = check.data && check.data.username === typed && debounced === typed
  const status = !settled ? 'checking' : check.data.available ? 'available' : 'taken'

  useEffect(() => { // start from the first free suggestion
    if (!form.username && check.data?.suggestions?.length) set({ username: check.data.suggestions[0] })
  }, [check.data, form.username, set])
  useEffect(() => set({ usernameOk: status === 'available' }), [status, set])

  const icon = status === 'checking' ? <CircularProgress size={18} aria-label="Checking" />
    : status === 'available' ? <CheckCircle color="success" aria-label="Available" /> : <Cancel color="error" aria-label="Taken" />
  return (
    <Stack sx={{ gap: 2 }}>
      <TextField label="Username" value={form.username} autoFocus
        onChange={(e) => set({ username: e.target.value.toLowerCase() })}
        error={status === 'taken'}
        helperText={status === 'taken' ? (USERNAME_RE.test(typed) ? 'Already taken — pick a suggestion' : '3-20 lowercase letters, digits, . or _')
          : '3-20 lowercase letters, digits, . or _. Unique, regardless of capitals.'}
        slotProps={{ input: { endAdornment: <InputAdornment position="end">{icon}</InputAdornment> } }} />
      <Box>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>Available suggestions</Typography>
        <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap' }}>
          {(check.data?.suggestions ?? []).map((s) => <Chip key={s} label={s} clickable onClick={() => set({ username: s })} />)}
        </Stack>
      </Box>
    </Stack>
  )
}

export default function CreateUserWizard({ onClose, onCreated }) {
  const titleId = useId()
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const managers = useManagers()
  const create = useCreateUser()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [failure, setFailure] = useState(null)
  const [shown, setShown] = useState(null)
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', role: '', manager_id: '', job_title: '',
    salary: '', username: '', usernameOk: false, password: '' })
  const set = useState(() => (patch) => setForm((f) => ({ ...f, ...patch })))[0]

  const valid = [
    form.first_name.trim() && form.last_name.trim(),
    EMAIL_RE.test(form.email.trim()) && form.role && (form.role !== 'employee' || form.manager_id),
    form.usernameOk,
    passwordRuleErrors(form.password).length === 0,
    true,
  ]

  const submit = async () => {
    setFailure(null)
    const body = { first_name: form.first_name.trim(), last_name: form.last_name.trim(), email: form.email.trim(),
      role: form.role, job_title: form.job_title.trim(), username: form.username.trim(), password: form.password }
    if (form.salary !== '') body.salary = Number(form.salary)
    if (form.manager_id) body.manager_id = form.manager_id
    try {
      const result = await create.mutateAsync(body)
      const password = result.temp_password ?? form.password
      // The server couldn't email: try the browser relay, and only show the details on screen if that fails too.
      const relayed = !result.email_sent && await relayCredentials({ to: body.email, name: `${body.first_name} ${body.last_name}`,
        username: result.user.username, password, kind: 'welcome' })
      if (!result.email_sent && !relayed) setShown({ username: result.user.username, password, user: result.user })
      else {
        if (relayed) toast.success(`Sign-in details emailed to ${body.email}`)
        onCreated?.(result.user); onClose()
      }
    } catch (err) {
      setFailure(err)
      if (err.details?.username) setStep(2)
      else if (err.details?.email) setStep(1)
    }
  }

  if (shown) {
    return <ShowOnceDialog username={shown.username} password={shown.password}
      onClose={() => { onCreated?.(shown.user); onClose() }} />
  }

  const manager = (managers.data ?? []).find((m) => String(m.id) === form.manager_id)
  return (
    <Dialog open onClose={create.isPending ? undefined : onClose} aria-labelledby={titleId} fullScreen={!desktop} maxWidth="sm" fullWidth>
      <DialogTitle id={titleId}>New account</DialogTitle>
      <DialogContent>
        <Stepper activeStep={step} alternativeLabel sx={{ mb: 3 }}>
          {STEPS.map((label, i) => <Step key={label} completed={i < step}><StepLabel>{label}</StepLabel></Step>)}
        </Stepper>
        <ErrorAlert error={failure} sx={{ mb: 2 }} />
        {step === 0 ? (
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="First name" required autoFocus value={form.first_name} onChange={(e) => set({ first_name: e.target.value })} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Last name" required value={form.last_name} onChange={(e) => set({ last_name: e.target.value })} /></Grid>
          </Grid>
        ) : null}
        {step === 1 ? (
          <Grid container spacing={2}>
            <Grid size={12}>
              <TextField label="Email" type="email" required autoFocus value={form.email} onChange={(e) => set({ email: e.target.value })}
                error={Boolean(form.email) && !EMAIL_RE.test(form.email.trim())}
                helperText={form.email && !EMAIL_RE.test(form.email.trim()) ? 'Enter a valid email address' : 'Sign-in details are sent here'} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField select label="Role" required value={form.role} onChange={(e) => set({ role: e.target.value })}>
                {ROLES.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField select label="Reports to" required={form.role === 'employee'} value={form.manager_id}
                onChange={(e) => set({ manager_id: e.target.value })} helperText={form.role === 'employee' ? 'Employees need a reporting manager' : 'Optional'}>
                <MenuItem value="">Nobody</MenuItem>
                {(managers.data ?? []).map((m) => <MenuItem key={m.id} value={String(m.id)}>{fullName(m)}</MenuItem>)}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}><TextField label="Job title" value={form.job_title} onChange={(e) => set({ job_title: e.target.value })} /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Annual salary" type="number" value={form.salary} onChange={(e) => set({ salary: e.target.value })}
                helperText="Only admins and the person see it"
                slotProps={{ input: { startAdornment: <InputAdornment position="start">$</InputAdornment> }, htmlInput: { min: 0 } }} />
            </Grid>
          </Grid>
        ) : null}
        {step === 2 ? <UsernameStep form={form} set={set} /> : null}
        {step === 3 ? (
          <Stack sx={{ gap: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 1, alignItems: { sm: 'flex-start' } }}>
              <TextField label="Temporary password" value={form.password} autoFocus onChange={(e) => set({ password: e.target.value })}
                helperText="The person must change it at first sign-in. It expires in 72 hours." />
              <Button variant="outlined" onClick={() => set({ password: generatePassword() })} sx={{ flexShrink: 0, mt: { sm: 0.25 } }}>
                Generate password
              </Button>
            </Stack>
            <PasswordPolicyChecklist value={form.password} />
          </Stack>
        ) : null}
        {step === 4 ? (
          <Table size="small" aria-label="Review the new account">
            <TableBody>
              {[['Name', `${form.first_name} ${form.last_name}`], ['Email', form.email], ['Role', ROLES.find((r) => r.value === form.role)?.label],
                ['Reports to', manager ? fullName(manager) : '—'], ['Job title', form.job_title || '—'],
                ['Salary', form.salary === '' ? '—' : formatMoney(form.salary)], ['Username', form.username]].map(([k, v]) => (
                <TableRow key={k}><TableCell component="th" scope="row" sx={{ color: 'text.secondary' }}>{k}</TableCell><TableCell>{v}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={create.isPending}>Cancel</Button>
        <Box sx={{ flexGrow: 1 }} />
        {step > 0 ? <Button onClick={() => setStep((s) => s - 1)} disabled={create.isPending}>Back</Button> : null}
        {step < STEPS.length - 1 ? (
          <Button variant="contained" disabled={!valid[step]} onClick={() => setStep((s) => s + 1)}>Next</Button>
        ) : (
          <Button variant="contained" onClick={submit} disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create account'}</Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
