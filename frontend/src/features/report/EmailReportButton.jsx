import Mail from '@mui/icons-material/ForwardToInboxOutlined'
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, TextField, Typography,
  useMediaQuery,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { api } from '../../api/client.js'
import { useDepartments } from '../../api/queries.js'
import { useToast } from '../../app/toast.js'
import { useSession } from '../../auth/sessionContext.js'
import { relayReport, reportRelayConfigured } from '../../lib/emailRelay.js'
import { buildReportHtml, reportSubject } from './reportHtml.js'

const REPORT_ROLES = ['admin', 'manager', 'executive']
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function NotConfigured({ onClose, titleId }) {
  return (
    <>
      <DialogTitle id={titleId}>Email isn't set up yet</DialogTitle>
      <DialogContent>
        <DialogContentText>
          Scout sends reports from your browser through EmailJS, and this copy of Scout doesn't have a report template yet.
          An admin can add one by setting VITE_EMAILJS_REPORT_TEMPLATE_ID (with the EmailJS service id and public key) and
          redeploying. Until then, Print / PDF saves the same dashboard as a file you can attach to an email.
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}><Button variant="contained" onClick={onClose}>OK</Button></DialogActions>
    </>
  )
}

function Compose({ dashboard, department, onClose, titleId }) {
  const { user } = useSession()
  const toast = useToast()
  const insights = useQuery({ queryKey: ['dashboard', 'smart', department], queryFn: () => api.get('/insights/smart', { department }) })
  const departments = useDepartments()
  const scope = (departments.data?.items ?? []).find((d) => String(d.id) === String(department))?.name ?? 'All departments'
  const fromName = `${user.first_name} ${user.last_name}`
  const [form, setForm] = useState({ to: '', toName: '', subject: reportSubject() })
  const [touched, setTouched] = useState(false)
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)
  const html = useMemo(() => buildReportHtml({ dashboard, insights: insights.data ?? [], scope, preparedBy: fromName }),
    [dashboard, insights.data, scope, fromName])
  const emailError = touched && !EMAIL.test(form.to.trim()) ? 'Enter an email address like name@acme.example' : ''
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const send = async (e) => {
    e.preventDefault()
    setTouched(true)
    if (!EMAIL.test(form.to.trim()) || !form.subject.trim()) return
    setSending(true)
    setFailed(false)
    const ok = await relayReport({ to: form.to.trim(), toName: form.toName.trim(), subject: form.subject.trim(), reportHtml: html, fromName })
    setSending(false)
    if (ok) {
      toast.success(`Report sent to ${form.to.trim()}`)
      onClose()
    } else setFailed(true)
  }

  return (
    <Box component="form" noValidate onSubmit={send}>
      <DialogTitle id={titleId}>Email this report</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          {failed ? <Alert severity="error">The email service didn't accept the report. Check the address and try again.</Alert> : null}
          <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2 }}>
            <TextField label="Recipient email" type="email" required autoFocus value={form.to} onChange={set('to')}
              onBlur={() => setTouched(true)} error={Boolean(emailError)} helperText={emailError || ' '} sx={{ flex: 1 }} />
            <TextField label="Recipient name" value={form.toName} onChange={set('toName')} helperText=" " sx={{ flex: 1 }} />
          </Stack>
          <TextField label="Subject" required value={form.subject} onChange={set('subject')} />
          <Box>
            <Typography variant="subtitle2" component="h3" sx={{ mb: 0.5 }}>Preview</Typography>
            <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mb: 1 }}>
              {scope}. Headline numbers, at-risk projects, top insights and the budget of every project.
            </Typography>
            {/* sandbox="" : the preview can't run anything, whatever the data says. */}
            <Box component="iframe" title="Report preview" sandbox="" srcDoc={html}
              sx={{ width: '100%', height: 360, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: '#fff' }} />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={sending}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={sending || insights.isLoading}>{sending ? 'Sending…' : 'Send'}</Button>
      </DialogActions>
    </Box>
  )
}

/** "Email this report" on the dashboard (managers, admins, executives): the report reflects the department filter. */
export default function EmailReportButton({ dashboard, department = '' }) {
  const { user } = useSession()
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const phone = useMediaQuery((theme) => theme.breakpoints.down('sm'))
  if (!REPORT_ROLES.includes(user?.role) || !dashboard) return null
  const close = () => setOpen(false)
  return (
    <>
      <Button size="small" variant="outlined" startIcon={<Mail />} onClick={() => setOpen(true)} data-print="hide">
        Email this report
      </Button>
      <Dialog open={open} onClose={close} aria-labelledby={titleId} fullWidth maxWidth="md" fullScreen={phone}>
        {open && reportRelayConfigured() ? <Compose dashboard={dashboard} department={department} onClose={close} titleId={titleId} /> : null}
        {open && !reportRelayConfigured() ? <NotConfigured onClose={close} titleId={titleId} /> : null}
      </Dialog>
    </>
  )
}
