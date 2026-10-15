import ArrowBack from '@mui/icons-material/ArrowBackRounded'
import Close from '@mui/icons-material/CloseRounded'
import Delete from '@mui/icons-material/DeleteOutlined'
import Edit from '@mui/icons-material/EditOutlined'
import Send from '@mui/icons-material/SendRounded'
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, InputAdornment, MenuItem, Stack, Table, TableBody, TableCell,
  TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../../api/client.js'
import { useDepartments, useManagers } from '../../api/queries.js'
import { relayConfigured, relayCredentials } from '../../lib/emailRelay.js'
import { fullName } from '../../lib/format.js'
import { ROLE_LABEL, ROLE_OPTIONS } from '../../lib/labels.js'
import { EMAIL_RE, generatePassword } from '../../lib/schemas.js'
import ShowOnceDialog from '../people/ShowOnceDialog.jsx'
import {
  SAY, checkEmails, timing, doneMessage, matchChoice, matchRole, parseEmails, parseLastName, parseNames, pickUsername,
} from './createUsers.js'
import PuppyFace from './PuppyFace.jsx'

const pause = () => (timing.paceMs ? new Promise((r) => { setTimeout(r, timing.paceMs) }) : Promise.resolve())

const USERNAME_RE = /^[a-z0-9._]{3,20}$/
const INPUT_STEPS = new Set(['names', 'lastName', 'emails', 'role', 'manager', 'department'])
const ROLE_ORDER = ['employee', 'manager', 'executive', 'admin']
const SAME = /\bsame\b/i
const SKIP = /^(?:skip|none|no|no department|nothing)$/i
const SHOW_NOTICE = "Copy these now and hand them over securely — the password won't be shown again."

const checkUsername = (username, first, last) => api.get('/users/username-availability', { username, first, last })

/** Whether an existing account (active or archived) already uses this email, from the admin's people list. */
async function emailTaken(email) {
  const lower = email.toLowerCase()
  for (const archived of [undefined, 'true']) {
    const page = await api.get('/users', { q: email, page_size: 100, archived })
    if ((page?.items ?? []).some((u) => String(u.email ?? '').toLowerCase() === lower)) return true
  }
  return false
}

const nameOf = (p) => `${p.first} ${p.last}`.trim()
const row = (p) => ({ key: p.key, first: p.first, last: p.last, typedUsername: p.typedUsername, username: '', email: '',
  role: '', manager_id: '', department_id: '', status: 'ready', error: null, userId: null, emailedBy: null })

const STATUS = {
  ready: 'Waiting', creating: 'Creating…', emailing: 'Created ✓ · Emailing…', created: 'Created ✓',
  emailed: 'Created ✓ · Emailed ✓', 'email-failed': 'Created ✓ · Email failed',
}

function PuppyBubble({ children, id, focusRef, label }) {
  return (
    <Stack direction="row" sx={{ gap: 1, alignItems: 'flex-start', maxWidth: '100%' }}>
      <Box aria-hidden sx={{ flexShrink: 0, mt: 0.25 }}><PuppyFace size={28} /></Box>
      <Box id={id} ref={focusRef} tabIndex={focusRef ? -1 : undefined} aria-label={label}
        sx={(theme) => ({ minWidth: 0, flex: '0 1 auto', px: 1.5, py: 1, borderRadius: 2, borderTopLeftRadius: 4,
          bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.07), outline: 'none',
          '&:focus-visible': { boxShadow: `0 0 0 2px ${theme.palette.primary.main}` } })}>
        {children}
      </Box>
    </Stack>
  )
}

function MyBubble({ children }) {
  return (
    <Box sx={{ position: 'relative', alignSelf: 'flex-end', maxWidth: '85%', px: 1.5, py: 1, borderRadius: 2, borderTopRightRadius: 4,
      bgcolor: 'primary.main', color: 'primary.contrastText', typography: 'body2', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>You: </Box>
      {children}
    </Box>
  )
}

/** Change one username: valid, not used twice in this batch, and free on the server. */
function UsernameEditor({ person, people, onSave, onCancel }) {
  const [value, setValue] = useState(person.username)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const u = value.trim().toLowerCase()
    if (!USERNAME_RE.test(u)) return setError('3-20 lowercase letters, digits, . or _')
    if (people.some((p) => p.key !== person.key && p.username === u)) return setError('Someone in this list already has it')
    if (u !== person.username) {
      setBusy(true)
      try {
        if (!(await checkUsername(u, person.first, person.last)).available) return setError('Already taken — try another')
      } catch (err) { return setError(err.message) } finally { setBusy(false) }
    }
    return onSave(u)
  }
  return (
    <Box component="form" onSubmit={(e) => { e.preventDefault(); save() }} sx={{ mt: 1 }}>
      <TextField size="small" fullWidth autoFocus label={`Username for ${nameOf(person)}`} value={value}
        onChange={(e) => { setValue(e.target.value.toLowerCase()); setError(null) }} error={Boolean(error)}
        helperText={error ?? '3-20 lowercase letters, digits, . or _'} />
      <Stack direction="row" sx={{ gap: 1, mt: 0.5, justifyContent: 'flex-end' }}>
        <Button size="small" onClick={onCancel}>Cancel</Button>
        <Button size="small" variant="contained" type="submit" disabled={busy}>Save username</Button>
      </Stack>
    </Box>
  )
}

/** Edit one row of the summary: names, username, email, role, manager and department. */
function RowEditor({ person, people, managers, departments, onSave, onCancel }) {
  const [form, setForm] = useState(person)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setError(null) }
  const others = people.filter((p) => p.key !== person.key)
  const save = async () => {
    const first = parseLastName(form.first)
    const last = parseLastName(form.last)
    const username = form.username.trim().toLowerCase()
    const email = form.email.trim()
    if (!first || !last) return setError('First and last name are needed (letters, spaces, hyphens, apostrophes).')
    if (!USERNAME_RE.test(username)) return setError('Usernames are 3-20 lowercase letters, digits, . or _')
    if (others.some((p) => p.username === username)) return setError('Someone in this list already has that username.')
    if (!EMAIL_RE.test(email)) return setError("That email address doesn't look right.")
    if (others.some((p) => p.email.toLowerCase() === email.toLowerCase())) return setError('Someone in this list already has that email.')
    if (form.role === 'employee' && !form.manager_id) return setError('Employees need a reporting manager.')
    setBusy(true)
    try {
      if (username !== person.username && !(await checkUsername(username, first, last)).available) {
        return setError('That username is already taken.')
      }
      if (email.toLowerCase() !== person.email.toLowerCase() && await emailTaken(email)) {
        return setError(`${email} is already used by another Scout account.`)
      }
    } catch (err) { return setError(err.message) } finally { setBusy(false) }
    return onSave({ ...form, first, last, username, email })
  }
  return (
    <Box component="form" aria-label={`Edit ${nameOf(person)}`} onSubmit={(e) => { e.preventDefault(); save() }}
      sx={{ p: 1.5, mt: 1, border: 1, borderColor: 'divider', borderRadius: 2 }}>
      <Stack sx={{ gap: 1.25 }}>
        <Stack direction="row" sx={{ gap: 1 }}>
          <TextField size="small" label="First name" value={form.first} autoFocus onChange={(e) => set({ first: e.target.value })} />
          <TextField size="small" label="Last name" value={form.last} onChange={(e) => set({ last: e.target.value })} />
        </Stack>
        <TextField size="small" label="Username" value={form.username} onChange={(e) => set({ username: e.target.value.toLowerCase() })} />
        <TextField size="small" label="Email" value={form.email} onChange={(e) => set({ email: e.target.value })} />
        <TextField size="small" select label="Role" value={form.role} onChange={(e) => set({ role: e.target.value })}>
          {ROLE_OPTIONS.map((r) => <MenuItem key={r.value} value={r.value}>{r.label}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Reports to" value={form.manager_id} onChange={(e) => set({ manager_id: e.target.value })}
          helperText={form.role === 'employee' ? 'Employees need a reporting manager' : 'Optional'}>
          <MenuItem value="">Nobody</MenuItem>
          {managers.map((m) => <MenuItem key={m.id} value={m.id}>{m.label}</MenuItem>)}
        </TextField>
        <TextField size="small" select label="Department" value={form.department_id} onChange={(e) => set({ department_id: e.target.value })}>
          <MenuItem value="">None</MenuItem>
          {departments.map((d) => <MenuItem key={d.id} value={d.id}>{d.label}</MenuItem>)}
        </TextField>
        {error ? <Alert severity="error" variant="outlined">{error}</Alert> : null}
        <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end' }}>
          <Button size="small" onClick={onCancel}>Cancel</Button>
          <Button size="small" variant="contained" type="submit" disabled={busy}>Save changes</Button>
        </Stack>
      </Stack>
    </Box>
  )
}

/** The people table: the summary (with Edit and Remove), then live progress while creating and after. */
function PeopleTable({ people, managers, departments, editable, progress, onEdit, onRemove }) {
  const label = (list, id) => list.find((x) => String(x.id) === String(id))?.label
  return (
    <Box sx={{ overflowX: 'auto', mt: 1 }}>
      <Table size="small" aria-label={progress ? 'Account progress' : 'Accounts to create'}
        sx={{ '& td, & th': { px: 0.75, py: 0.5, typography: 'caption', verticalAlign: 'top' } }}>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell><TableCell>Email</TableCell><TableCell>Role</TableCell>
            <TableCell>{progress ? 'Status' : <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>Changes</Box>}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {people.map((p) => (
            <TableRow key={p.key} data-testid={`row-${p.username}`}>
              <TableCell>
                <Box sx={{ fontWeight: 600 }}>{nameOf(p)}</Box>
                <Box sx={{ color: 'text.secondary' }}>{p.username}</Box>
              </TableCell>
              <TableCell sx={{ wordBreak: 'break-all' }}>{p.email}</TableCell>
              <TableCell>
                <Box>{ROLE_LABEL[p.role] ?? '—'}</Box>
                <Box sx={{ color: 'text.secondary' }}>
                  {[p.manager_id ? `Reports to ${label(managers, p.manager_id) ?? '—'}` : null,
                    p.department_id ? label(departments, p.department_id) : null].filter(Boolean).join(' · ') || null}
                </Box>
              </TableCell>
              <TableCell sx={{ whiteSpace: progress ? 'normal' : 'nowrap' }}>
                {progress ? (
                  <Box data-testid={`status-${p.username}`} sx={{ color: p.status === 'failed' || p.status === 'email-failed' ? 'error.main'
                    : p.status === 'emailed' || p.status === 'created' ? 'success.main' : 'text.secondary' }}>
                    {p.status === 'failed' ? `Failed: ${p.error}` : STATUS[p.status]}
                  </Box>
                ) : null}
                {editable(p) ? (
                  <>
                    <IconButton size="small" aria-label={`Edit ${nameOf(p)}`} onClick={() => onEdit(p.key)}><Edit fontSize="small" /></IconButton>
                    {onRemove ? (
                      <IconButton size="small" aria-label={`Remove ${nameOf(p)}`} onClick={() => onRemove(p.key)}><Delete fontSize="small" /></IconButton>
                    ) : null}
                  </>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  )
}

/**
 * "Create user accounts": a conversation inside the Puppy panel, for real admins only (the panel never mounts it for
 * anyone else, and the server refuses POST /users to everyone but admins and to the public demo admin). Puppy asks
 * for names, then emails, then each person's role, manager and department, shows a summary, and creates nothing until
 * the admin says yes or picks another option. Accounts are created one at a time through POST /users, the same call
 * the People page makes, so validation, the password policy, must-change-password and the audit log all apply.
 * Temporary passwords live only in memory (a ref, never state or the screen) until they are emailed or shown once.
 *
 * guardRef: the panel asks it before closing (Esc, a click outside); it answers false and asks to discard instead
 * while there is something to lose. onExit: back to the Do it tab. onLeave(to): close the panel and open a page.
 */
export default function CreateUsersChat({ guardRef, onExit, onLeave, onClosePanel }) {
  const queryClient = useQueryClient()
  const managersQuery = useManagers()
  const departmentsQuery = useDepartments()
  // The public demo admin is a shared presentation login, never someone's real manager.
  const managers = (managersQuery.data ?? []).filter((m) => !m.is_public_demo)
    .map((m) => ({ id: String(m.id), label: fullName(m) }))
  const departments = (departmentsQuery.data?.items ?? []).map((d) => ({ id: String(d.id), label: d.name }))

  const [step, setStep] = useState({ name: 'names', idx: 0 })
  const [people, setPeople] = useState([])
  const [entries, setEntries] = useState([])
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState(null)
  const [editing, setEditing] = useState(null)
  const [editingUsername, setEditingUsername] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [notice, setNotice] = useState(null)
  const [showing, setShowing] = useState(null)
  // Which rows still hold a password (for the buttons); the passwords themselves stay in `secrets`.
  const [secretKeys, setSecretKeys] = useState([])
  const secrets = useRef(new Map())
  const peopleRef = useRef(people)
  useLayoutEffect(() => { peopleRef.current = people }, [people])

  const questionId = useId()
  const inputRef = useRef(null)
  const questionRef = useRef(null)
  const logRef = useRef(null)
  const keepRef = useRef(null)

  const running = step.name === 'running'
  const finished = step.name === 'done' || step.name === 'cancelled'
  const holdSecrets = (fn) => { fn(secrets.current); setSecretKeys([...secrets.current.keys()]) }

  // Passwords never outlive the conversation.
  useEffect(() => {
    const held = secrets.current
    return () => held.clear()
  }, [])

  const lost = () => secrets.current.size > 0 || (!finished && (people.length > 0 || draft.trim() !== ''))
  // The panel asks before closing: never mid-creation, and only after a confirm when something would be lost.
  const latest = useRef(null)
  useLayoutEffect(() => { latest.current = { running, lost } })
  useEffect(() => {
    if (!guardRef) return undefined
    guardRef.current = () => {
      if (latest.current.running) { setNotice(SAY.waitClose); return false }
      if (latest.current.lost()) { setConfirm({ kind: 'close' }); return false }
      return true
    }
    return () => { guardRef.current = null }
  }, [guardRef])

  const leave = (kind, to) => {
    if (running) return setNotice(SAY.waitClose)
    if (lost()) return setConfirm({ kind, to })
    return finishLeaving({ kind, to })
  }
  const finishLeaving = ({ kind, to }) => {
    holdSecrets((m) => m.clear())
    if (guardRef && kind !== 'restart') guardRef.current = null
    if (kind === 'restart') startOver()
    else if (kind === 'close') onClosePanel()
    else if (kind === 'leave') onLeave(to)
    else onExit()
  }

  // Focus follows the conversation: the answer box (named by the question) or the question itself.
  const focusKey = `${step.name}:${step.idx}:${entries.length}`
  useEffect(() => {
    if (editing || editingUsername) return
    if (INPUT_STEPS.has(step.name)) inputRef.current?.focus()
    else questionRef.current?.focus()
  }, [focusKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (confirm) keepRef.current?.focus() }, [confirm])
  useLayoutEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  })

  const advance = (answer, next, nextPeople = people, { text, then } = {}) => {
    setEntries((list) => [...list, { id: list.length + 1, step, answer, text, then, prevPeople: people }])
    setPeople(nextPeople)
    setStep(next)
    setDraft('')
    setProblem(null)
    setNotice(null)
  }

  const back = () => {
    const last = entries.at(-1)
    if (!last) return
    setEntries(entries.slice(0, -1))
    setStep(last.step)
    setPeople(last.prevPeople)
    setDraft(last.text ?? '')
    setProblem(null)
    setEditing(null)
    setEditingUsername(null)
  }

  // ---------- names → last names → usernames → emails ----------
  const withUsernames = async (list) => {
    const batch = new Set()
    const out = []
    for (const p of list) {
      const username = await pickUsername(p, batch, checkUsername)
      batch.add(username)
      out.push({ ...p, username })
    }
    return out
  }
  const afterNames = async (answer, list, text) => {
    const missing = list.findIndex((p) => !p.last)
    if (missing >= 0) return advance(answer, { name: 'lastName', idx: missing }, list, { text })
    setBusy(true)
    try {
      const named = await withUsernames(list)
      return advance(answer, { name: 'emails', idx: 0 }, named, { text, then: 'usernames' })
    } catch (err) {
      return setProblem(`I couldn't check usernames just now: ${err.message} Please try again.`)
    } finally { setBusy(false) }
  }

  const submitNames = (text) => {
    const parsed = parseNames(text)
    if (parsed.problem) return setProblem(parsed.problem)
    return afterNames(text.trim(), parsed.people.map(row), text)
  }
  const submitLastName = (text) => {
    const last = parseLastName(text)
    if (!last) return setProblem(SAY.noLastName)
    const list = people.map((p, i) => (i === step.idx ? { ...p, last } : p))
    return afterNames(last, list, text)
  }
  const submitEmails = async (text) => {
    const emails = parseEmails(text)
    const check = checkEmails(emails, people)
    if (check.problem) return setProblem({ text: check.problem, pairing: check.pairing })
    setBusy(true)
    try {
      for (const e of emails) {
        if (await emailTaken(e)) return setProblem(`${e} is already used by another Scout account. Please use a different address.`)
      }
    } catch (err) {
      return setProblem(`I couldn't check the emails just now: ${err.message} Please try again.`)
    } finally { setBusy(false) }
    return advance(emails.join(', '), { name: 'role', idx: 0 }, people.map((p, i) => ({ ...p, email: emails[i] })),
      { text, then: 'pairing' })
  }

  // ---------- each person: role → manager (employees) → department ----------
  const nextPerson = (idx) => (idx + 1 < people.length ? { name: 'role', idx: idx + 1 } : { name: 'review', idx: 0 })
  const afterManager = (idx) => (departments.length ? { name: 'department', idx } : nextPerson(idx))
  const patch = (idx, values) => people.map((p, i) => (i === idx ? { ...p, ...values } : p))

  const chooseRole = (role) => {
    const idx = step.idx
    if (role === 'employee') return advance(ROLE_LABEL[role], { name: 'manager', idx }, patch(idx, { role }))
    return advance(ROLE_LABEL[role], afterManager(idx), patch(idx, { role, manager_id: '' }))
  }
  const sameForRest = () => {
    const prev = people[step.idx - 1]
    const list = people.map((p, i) => (i >= step.idx
      ? { ...p, role: prev.role, manager_id: prev.manager_id, department_id: prev.department_id } : p))
    advance(SAY.sameForRest, { name: 'review', idx: 0 }, list)
  }
  const chooseManager = (id) => advance(managers.find((m) => m.id === id)?.label ?? '', afterManager(step.idx),
    patch(step.idx, { manager_id: id }))
  const chooseDepartment = (id) => advance(id ? departments.find((d) => d.id === id)?.label ?? '' : 'Skip',
    nextPerson(step.idx), patch(step.idx, { department_id: id }))

  const prev = people[step.idx - 1]
  const submitTyped = (text) => {
    const t = text.trim()
    if (step.name === 'role') {
      if (SAME.test(t) && step.idx > 0) return sameForRest()
      const role = matchRole(t)
      return role ? chooseRole(role) : setProblem('Pick one of the roles: Employee, Manager, Executive or Admin.')
    }
    if (step.name === 'manager') {
      if (SAME.test(t) && prev?.manager_id) return chooseManager(prev.manager_id)
      const id = matchChoice(t, managers)
      return id ? chooseManager(id) : setProblem("I couldn't find that manager. Pick one from the list.")
    }
    if (step.name === 'department') {
      if (SKIP.test(t)) return chooseDepartment('')
      if (SAME.test(t) && step.idx > 0) return chooseDepartment(prev.department_id)
      const id = matchChoice(t, departments)
      return id ? chooseDepartment(id) : setProblem("I couldn't find that department. Pick one from the list, or Skip.")
    }
    return undefined
  }

  const submit = () => {
    if (busy || !draft.trim()) return
    if (step.name === 'names') submitNames(draft)
    else if (step.name === 'lastName') submitLastName(draft)
    else if (step.name === 'emails') submitEmails(draft)
    else submitTyped(draft)
  }

  // ---------- creating ----------
  const create = async (chosenMode, rows) => {
    setMode(chosenMode)
    setStep({ name: 'running', idx: 0 })
    setProblem(null)
    setNotice(null)
    let list = peopleRef.current
    const update = (key, values) => {
      list = list.map((p) => (p.key === key ? { ...p, ...values } : p))
      setPeople(list)
    }
    for (const [i, p] of rows.entries()) {
      if (i > 0) await pause()
      update(p.key, { status: 'creating', error: null })
      // A random temporary password that meets the policy, created here and held only in this loop or `secrets`.
      const password = generatePassword()
      const body = { first_name: p.first, last_name: p.last, email: p.email, role: p.role, username: p.username, password }
      if (p.manager_id) body.manager_id = p.manager_id
      if (p.department_id) body.department_id = p.department_id
      let result
      try {
        result = await api.post('/users', body)
      } catch (err) {
        update(p.key, { status: 'failed', error: err.message })
        continue
      }
      const secret = { username: result.user.username, password: result.temp_password ?? password, name: nameOf(p) }
      const created = { userId: result.user.id, username: result.user.username, emailedBy: result.email_sent ? 'server' : null }
      if (chosenMode === 'email') {
        if (result.email_sent) { update(p.key, { ...created, status: 'emailed' }); continue }
        update(p.key, { ...created, status: 'emailing' })
        const sent = await relayCredentials({ to: p.email, name: nameOf(p), username: secret.username, password: secret.password,
          kind: 'welcome' })
        if (sent) update(p.key, { status: 'emailed', emailedBy: 'browser' })
        else {
          holdSecrets((m) => m.set(p.key, secret))
          update(p.key, { status: 'email-failed' })
        }
      } else {
        if (chosenMode === 'show') holdSecrets((m) => m.set(p.key, secret))
        update(p.key, { ...created, status: result.email_sent ? 'emailed' : 'created' })
      }
    }
    queryClient.invalidateQueries({ queryKey: ['users'] })
    setStep({ name: 'done', idx: 0 })
    if (chosenMode === 'show') showNext(null, list)
  }

  const retryEmails = async () => {
    setStep({ name: 'running', idx: 0 })
    let list = peopleRef.current
    for (const p of list.filter((x) => x.status === 'email-failed' && secrets.current.has(x.key))) {
      const secret = secrets.current.get(p.key)
      list = list.map((x) => (x.key === p.key ? { ...x, status: 'emailing' } : x)); setPeople(list)
      const sent = await relayCredentials({ to: p.email, name: secret.name, username: secret.username, password: secret.password,
        kind: 'welcome' })
      if (sent) holdSecrets((m) => m.delete(p.key))
      list = list.map((x) => (x.key === p.key ? { ...x, status: sent ? 'emailed' : 'email-failed', emailedBy: sent ? 'browser' : null } : x))
      setPeople(list)
    }
    setStep({ name: 'done', idx: 0 })
  }

  const retryFailed = async () => {
    if (peopleRef.current.some((p) => p.status === 'email-failed') && mode === 'email') await retryEmails()
    const failed = peopleRef.current.filter((p) => p.status === 'failed')
    if (failed.length) await create(mode, failed)
  }

  // The show-once dialog, one account at a time; a password leaves memory as soon as "I've saved it" + Done.
  const showNext = (doneKey, list = peopleRef.current) => {
    if (doneKey) holdSecrets((m) => m.delete(doneKey))
    const created = list.filter((p) => p.userId)
    const next = created.find((p) => secrets.current.has(p.key))
    if (!next) {
      setShowing(null)
      if (doneKey) setNotice(SAY.allShown)
      return
    }
    const secret = secrets.current.get(next.key)
    setShowing({ key: next.key, username: secret.username, password: secret.password,
      progress: `${created.indexOf(next) + 1} of ${created.length} · ${nameOf(next)}` })
  }

  const startOver = () => {
    holdSecrets((m) => m.clear())
    setPeople([]); setEntries([]); setDraft(''); setProblem(null); setMode(null); setNotice(null); setConfirm(null)
    setStep({ name: 'names', idx: 0 })
  }

  // ---------- rendering ----------
  const person = people[step.idx]
  const header = person && ['role', 'manager', 'department'].includes(step.name)
    ? `${SAY.person(step.idx + 1, people.length)} · ${nameOf(person)} · ${person.email}` : null
  const question = {
    names: SAY.names, lastName: person ? SAY.lastName(person.first) : '', emails: SAY.emails,
    role: person ? SAY.role(nameOf(person)) : '', manager: person ? SAY.manager(nameOf(person)) : '',
    department: person ? SAY.department(nameOf(person)) : '', review: SAY.review(people.length), options: SAY.options,
  }[step.name]
  const askedAt = (s) => {
    const p = people[s.idx]
    return { names: SAY.names, lastName: SAY.lastName(p?.first ?? ''), emails: SAY.emails, role: SAY.role(p ? nameOf(p) : ''),
      manager: SAY.manager(p ? nameOf(p) : ''), department: SAY.department(p ? nameOf(p) : ''), review: SAY.review(people.length), options: SAY.options }[s.name]
  }
  const editable = !running && !finished
  const counts = {
    total: people.length,
    created: people.filter((p) => p.userId).length,
    emailed: people.filter((p) => p.status === 'emailed').length,
    serverEmailed: people.filter((p) => p.emailedBy === 'server').length,
  }

  const choiceChips = []
  if (step.name === 'role') {
    ROLE_ORDER.forEach((r) => choiceChips.push({ key: r, label: ROLE_LABEL[r], onClick: () => chooseRole(r) }))
    if (step.idx > 0) choiceChips.push({ key: 'rest', label: SAY.sameForRest, onClick: sameForRest, color: 'primary' })
  }
  if (step.name === 'manager') {
    if (prev?.manager_id) choiceChips.push({ key: 'same', label: SAY.sameAsPrevious, onClick: () => chooseManager(prev.manager_id), color: 'primary' })
    managers.forEach((m) => choiceChips.push({ key: m.id, label: m.label, onClick: () => chooseManager(m.id) }))
  }
  if (step.name === 'department') {
    if (step.idx > 0) choiceChips.push({ key: 'same', label: SAY.sameAsPrevious, onClick: () => chooseDepartment(prev.department_id), color: 'primary' })
    departments.forEach((d) => choiceChips.push({ key: d.id, label: d.label, onClick: () => chooseDepartment(d.id) }))
    choiceChips.push({ key: 'skip', label: 'Skip', onClick: () => chooseDepartment('') })
  }

  const usernameChips = (
    <Box>
      <Typography variant="body2">{SAY.usernames(people.length)}</Typography>
      <Stack direction="row" useFlexGap sx={{ gap: 0.5, flexWrap: 'wrap', mt: 0.75 }} aria-label="Usernames">
        {people.map((p) => (
          <Chip key={p.key} size="small" variant="outlined" label={`${nameOf(p)} → ${p.username}`}
            aria-label={`${nameOf(p)}: username ${p.username}${editable ? '. Change it' : ''}`}
            onClick={editable ? () => setEditingUsername(p.key) : undefined} />
        ))}
      </Stack>
      {editingUsername && people.find((p) => p.key === editingUsername) ? (
        <UsernameEditor person={people.find((p) => p.key === editingUsername)} people={people}
          onCancel={() => setEditingUsername(null)}
          onSave={(u) => { setPeople(people.map((p) => (p.key === editingUsername ? { ...p, username: u } : p))); setEditingUsername(null) }} />
      ) : null}
    </Box>
  )
  const pairingTable = (pairs) => (
    <Table size="small" aria-label="Who gets which email" sx={{ mt: 0.75, '& td, & th': { px: 0.75, py: 0.25, typography: 'caption' } }}>
      <TableHead><TableRow><TableCell>Name</TableCell><TableCell>Email</TableCell></TableRow></TableHead>
      <TableBody>
        {pairs.map(([n, e], i) => (
          <TableRow key={i}>
            <TableCell sx={{ color: n ? undefined : 'error.main' }}>{n ?? '(extra)'}</TableCell>
            <TableCell sx={{ color: e ? undefined : 'error.main', wordBreak: 'break-all' }}>{e ?? '(missing)'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  const pushAnswer = (answer) => setEntries((l) => [...l, { id: l.length + 1, step, answer, prevPeople: people }])

  const remove = (key) => {
    const list = people.filter((p) => p.key !== key)
    if (!list.length) { setPeople([]); setEntries([]); setStep({ name: 'names', idx: 0 }); setProblem(SAY.everyoneRemoved); return }
    setPeople(list)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }} data-testid="create-users-chat">
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, py: 1 }}>
        <Button size="small" startIcon={<ArrowBack />} onClick={back}
          disabled={running || finished || busy || (!entries.length && step.name !== 'options')}>Back</Button>
        <Typography variant="subtitle2" component="h3" sx={{ flex: 1, textAlign: 'center' }}>Create user accounts</Typography>
        {finished ? (
          <Button size="small" startIcon={<Close />} onClick={() => leave('exit')}>Close</Button>
        ) : (
          <Button size="small" startIcon={<Close />} onClick={() => leave('exit')} disabled={running}>Cancel</Button>
        )}
      </Stack>

      <Stack ref={logRef} role="log" aria-live="polite" aria-label="Conversation with Puppy"
        sx={{ gap: 1, position: 'relative', overflowY: 'auto', overflowX: 'hidden', maxHeight: { xs: '42vh', sm: 'min(360px, calc(100vh - 440px))' }, minHeight: 120, pr: 0.5, pb: 1 }}>
        {entries.map((e) => (
          <Stack key={e.id} sx={{ gap: 1 }}>
            <PuppyBubble><Typography variant="body2">{askedAt(e.step)}</Typography></PuppyBubble>
            <MyBubble>{e.answer}</MyBubble>
            {e.then === 'usernames' ? <PuppyBubble>{usernameChips}</PuppyBubble> : null}
            {e.then === 'pairing' ? (
              <PuppyBubble>
                <Typography variant="body2">{SAY.pairing}</Typography>
                {pairingTable(people.map((p) => [nameOf(p), p.email]))}
              </PuppyBubble>
            ) : null}
          </Stack>
        ))}

        {question ? (
          <PuppyBubble id={questionId} focusRef={INPUT_STEPS.has(step.name) ? undefined : questionRef}>
            {header ? <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mb: 0.25 }}>{header}</Typography> : null}
            <Typography variant="body2">{question}</Typography>
            {step.name === 'review' || step.name === 'options' ? (
              <>
                <PeopleTable people={people} managers={managers} departments={departments}
                  editable={() => step.name === 'review'} onEdit={setEditing} onRemove={remove} />
                {!relayConfigured() ? <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>{SAY.relayMissing}</Typography> : null}
              </>
            ) : null}
          </PuppyBubble>
        ) : null}

        {running || finished ? (
          step.name === 'cancelled' ? (
            <PuppyBubble focusRef={questionRef}><Typography variant="body2">{SAY.cancelled}</Typography></PuppyBubble>
          ) : (
            <PuppyBubble focusRef={questionRef}>
              <Typography variant="body2">
                {running ? SAY.running : doneMessage({ ...counts, mode })}
              </Typography>
              <PeopleTable people={people} managers={managers} departments={departments} progress
                editable={(p) => finished && p.status === 'failed'} onEdit={setEditing} />
              {finished && counts.created ? (
                <Stack sx={{ mt: 1, alignItems: 'flex-start' }}>
                  {people.filter((p) => p.userId).map((p) => (
                    <Button key={p.key} size="small" sx={{ px: 0.5, minWidth: 0 }} onClick={() => leave('leave', `/people/${p.userId}`)}>
                      Open {nameOf(p)}&apos;s profile
                    </Button>
                  ))}
                </Stack>
              ) : null}
            </PuppyBubble>
          )
        ) : null}

        {problem ? (
          <PuppyBubble>
            <Typography variant="body2" sx={{ color: 'error.main' }}>{typeof problem === 'string' ? problem : problem.text}</Typography>
            {typeof problem === 'object' && problem.pairing ? pairingTable(problem.pairing) : null}
          </PuppyBubble>
        ) : null}
        {notice ? <PuppyBubble><Typography variant="body2">{notice}</Typography></PuppyBubble> : null}
        {busy ? (
          <PuppyBubble><Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}><CircularProgress size={14} aria-hidden />
            <Typography variant="body2">One moment…</Typography></Stack></PuppyBubble>
        ) : null}
      </Stack>

      {editing && people.find((p) => p.key === editing) ? (
        <RowEditor key={editing} person={people.find((p) => p.key === editing)} people={people} managers={managers}
          departments={departments} onCancel={() => setEditing(null)}
          onSave={(p) => { setPeople(people.map((x) => (x.key === p.key ? p : x))); setEditing(null) }} />
      ) : null}

      {confirm ? (
        <Box role="alertdialog" aria-label="Discard?" sx={{ p: 1.5, mt: 1, borderRadius: 2, border: 1, borderColor: 'warning.main' }}>
          <Typography variant="body2">
            {secretKeys.length
              ? "Some passwords haven't been emailed or shown yet. If you leave now they're gone for good — you can still use Reset password on each profile later."
              : "Discard what you've entered? Nothing has been created yet."}
          </Typography>
          <Stack direction="row" sx={{ gap: 1, mt: 1, justifyContent: 'flex-end' }}>
            <Button size="small" ref={keepRef} onClick={() => setConfirm(null)}>Keep going</Button>
            <Button size="small" color="warning" variant="contained" onClick={() => { const c = confirm; setConfirm(null); finishLeaving(c) }}>
              {confirm.kind === 'close' ? 'Discard and close' : 'Discard'}
            </Button>
          </Stack>
        </Box>
      ) : null}

      {!confirm && !editing ? (
        <Box sx={{ pt: 1 }}>
          {choiceChips.length ? (
            <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: 'wrap', mb: 1 }} aria-label="Quick replies">
              {choiceChips.map((c) => (
                <Chip key={c.key} label={c.label} clickable color={c.color} variant={c.color ? 'filled' : 'outlined'}
                  onClick={c.onClick} disabled={busy} />
              ))}
            </Stack>
          ) : null}
          {INPUT_STEPS.has(step.name) ? (
            <Box component="form" onSubmit={(e) => { e.preventDefault(); submit() }}>
              <TextField size="small" fullWidth multiline maxRows={5} value={draft} inputRef={inputRef} disabled={busy}
                onChange={(e) => setDraft(e.target.value)} autoComplete="off"
                placeholder={step.name === 'names' ? 'e.g. John Doe, Jane Roe' : step.name === 'emails' ? 'e.g. john@example.com, jane@example.com' : 'Type or pick an answer'}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                slotProps={{
                  htmlInput: { 'aria-labelledby': questionId, maxLength: 4000 },
                  input: { endAdornment: (
                    <InputAdornment position="end">
                      <IconButton type="submit" size="small" edge="end" aria-label="Send answer" disabled={busy}><Send fontSize="small" /></IconButton>
                    </InputAdornment>
                  ) },
                }} />
              <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 0.5 }}>
                Nothing is created until you say yes. Shift+Enter for a new line.
              </Typography>
            </Box>
          ) : null}
          {step.name === 'review' ? (
            <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Button size="small" variant="outlined" onClick={() => advance('No, other options', { name: 'options', idx: 0 })}>No, other options</Button>
              <Button size="small" variant="contained" onClick={() => { pushAnswer('Yes, create and email'); create('email', people) }}>
                Yes, create and email
              </Button>
            </Stack>
          ) : null}
          {step.name === 'options' ? (
            <Stack sx={{ gap: 0.75 }} aria-label="Other options">
              <Button size="small" variant="outlined" sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => { pushAnswer('Show each password once'); create('show', people) }}>Show each password once so I can hand it over myself</Button>
              <Button size="small" variant="outlined" sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => { pushAnswer('Create without sending passwords'); create('none', people) }}>Create the accounts without sending passwords — I&apos;ll use Reset password later</Button>
              <Button size="small" variant="outlined" sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={back}>Go back and change something</Button>
              <Button size="small" variant="outlined" color="warning" sx={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => { pushAnswer('Cancel — create nothing'); setStep({ name: 'cancelled', idx: 0 }) }}>Cancel — create nothing</Button>
            </Stack>
          ) : null}
          {finished ? (
            <Stack direction="row" useFlexGap sx={{ gap: 1, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {people.some((p) => p.status === 'failed' || (p.status === 'email-failed' && mode === 'email')) && step.name === 'done' ? (
                <Button size="small" variant="outlined" onClick={retryFailed}>Retry failed</Button>
              ) : null}
              {secretKeys.length && !showing ? (
                <Button size="small" variant="outlined" onClick={() => showNext(null)}>Show passwords once</Button>
              ) : null}
              <Button size="small" variant="contained" onClick={() => (secretKeys.length ? setConfirm({ kind: 'restart' }) : startOver())}>
                {step.name === 'cancelled' ? 'Start over' : 'Create more'}
              </Button>
            </Stack>
          ) : null}
        </Box>
      ) : null}

      {showing ? (
        <ShowOnceDialog key={showing.key} requireAck notice={SHOW_NOTICE} progress={showing.progress}
          username={showing.username} password={showing.password} onClose={() => showNext(showing.key)} />
      ) : null}
    </Box>
  )
}
