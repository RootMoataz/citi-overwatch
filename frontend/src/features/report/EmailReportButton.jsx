import Mail from '@mui/icons-material/ForwardToInboxOutlined'
import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, Stack, TextField, Typography,
  useMediaQuery,
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useId, useMemo, useState } from 'react'
import { api } from '../../api/client.js'
import { useDepartments, useMe } from '../../api/queries.js'
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

/** One send per recipient: [{to, ok}]. */
async function sendToEach(recipients, message) {
  return Promise.all(recipients.map(async (r) => ({ to: r.to, ok: await relayReport({ ...message, to: r.to, toName: r.toName }) })))
}

function Compose({ dashboard, department, onClose, titleId, toMe, setToMe }) {
  const { user } = useSession()
  const toast = useToast()
  const me = useMe()
  const insights = useQuery({ queryKey: ['dashboard', 'smart', department], queryFn: () => api.get('/insights/smart', { department }) })
  const departments = useDepartments()
  const scope = (departments.data?.items ?? []).find((d) => String(d.id) === String(department))?.name ?? 'All departments'
  const fromName = `${user.first_name} ${user.last_name}`
  const myEmail = (me.data?.email ?? user.email ?? '').trim()
  const sendToMe = toMe && Boolean(myEmail)
  const [form, setForm] = useState({ to: '', toName: '', subject: reportSubject() })
  const [touched, setTouched] = useState(false)
  const [sending, setSending] = useState(false)
  const [results, setResults] = useState(null)
  const html = useMemo(() => buildReportHtml({ dashboard, insights: insights.data ?? [], scope, preparedBy: fromName }),
    [dashboard, insights.data, scope, fromName])
  const other = form.to.trim()
  // Someone else is optional while "Send to me" is on; otherwise it's needed. Whatever is typed must look like an email.
  let emailError = ''
  if (other && !EMAIL.test(other)) emailError = 'Enter an email address like name@acme.example'
  else if (!other && !sendToMe) emailError = 'Enter who should get the report, or send it to yourself'
  const showError = touched && Boolean(emailError)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const send = async (e) => {
    e.preventDefault()
    setTouched(true)
    if (emailError || !form.subject.trim()) return
    const recipients = [
      ...(sendToMe ? [{ to: myEmail, toName: fromName }] : []),
      ...(other && other.toLowerCase() !== (sendToMe ? myEmail.toLowerCase() : '') ? [{ to: other, toName: form.toName.trim() }] : []),
    ]
    setSending(true)
    setResults(null)
    const sent = await sendToEach(recipients, { subject: form.subject.trim(), reportHtml: html, fromName })
    setSending(false)
    if (sent.every((r) => r.ok)) {
      toast.success(`Report sent to ${sent.map((r) => r.to).join(' and ')}`)
      onClose()
    } else setResults(sent)
  }

  return (
    <Box component="form" noValidate onSubmit={send}>
      <DialogTitle id={titleId}>Email this report</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 1 }}>
          {results ? (
            <Alert severity={results.some((r) => r.ok) ? 'warning' : 'error'}>
              <Box component="ul" aria-label="Delivery results" sx={{ m: 0, pl: 2 }}>
                {results.map((r) => (
                  <li key={r.to}>{r.ok ? `Sent to ${r.to}` : `Not sent to ${r.to}: the email service didn't accept it. Check the address and try again.`}</li>
                ))}
              </Box>
            </Alert>
          ) : null}
          <Box>
            <FormControlLabel label={myEmail ? `Send to me (${myEmail})` : 'Send to me'} disabled={!myEmail}
              control={<Checkbox checked={sendToMe} onChange={(e) => setToMe(e.target.checked)} />} />
            {!myEmail && !me.isLoading ? (
              <Typography variant="caption" component="p" sx={{ color: 'text.secondary', ml: 4, mt: -0.5 }}>
                Add an email in your profile to send reports to yourself.
              </Typography>
            ) : null}
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ gap: 2 }}>
            <TextField label={sendToMe ? 'Also send to (optional)' : 'Recipient email'} type="email" required={!sendToMe}
              value={form.to} onChange={set('to')} onBlur={() => setTouched(true)}
              error={showError} helperText={showError ? emailError : ' '} sx={{ flex: 1 }} />
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
  // "Send to me" starts on; the choice is kept for the next time the dialog opens.
  const [toMe, setToMe] = useState(true)
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
        {open && reportRelayConfigured() ? <Compose dashboard={dashboard} department={department} onClose={close} titleId={titleId} toMe={toMe} setToMe={setToMe} /> : null}
        {open && !reportRelayConfigured() ? <NotConfigured onClose={close} titleId={titleId} /> : null}
      </Dialog>
    </>
  )
}
