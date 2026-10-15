import Send from '@mui/icons-material/SendRounded'
import { Alert, Box, Button, Chip, IconButton, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ROUTE_ROLES } from '../../app/access.js'
import { useColorMode } from '../../app/colorMode.js'
import { useSession } from '../../auth/sessionContext.js'
import { askPuppy } from './ask.js'
import ConfirmAction from './ConfirmAction.jsx'

const mayOpen = (user, to) => {
  const route = String(to ?? '').replace(/^\//, '').split(/[/?]/)[0]
  return !ROUTE_ROLES[route] || ROUTE_ROLES[route].includes(user?.role)
}

/** Reads one question once the viewer's data is in, shows how it was read, and acts on palette phrases (once). */
function Answer({ question, user, data, actions, onRun, onAsk, go }) {
  const navigate = useNavigate()
  const { setPreference } = useColorMode()
  const { logout } = useSession()
  const result = useMemo(() => (data.loading ? null : askPuppy(question.text, { user, projects: data.projects,
    people: data.people, departments: data.departments })), [question.text, user, data])
  const done = useRef(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!result || done.current === question.id) return
    done.current = question.id
    if (result.kind === 'navigate') navigate(result.to)
    else if (result.kind === 'theme') setPreference(result.mode)
    else if (result.kind === 'signout') logout()
  }, [result, question.id, navigate, setPreference, logout])

  if (!result) return <Typography variant="body2" sx={{ color: 'text.secondary' }}>Puppy is sniffing around…</Typography>
  if (result.kind === 'refuse') return <Alert severity="info" variant="outlined">{result.text}</Alert>
  if (result.kind === 'help') {
    return (
      <Box>
        {result.title ? <Typography variant="subtitle2">{result.title}</Typography> : null}
        <Typography variant="body2">{result.text}</Typography>
        {result.to && mayOpen(user, result.to) ? (
          <Button size="small" sx={{ mt: 0.5, px: 0 }} onClick={() => go(result.to)}>{result.link ?? 'Open'}</Button>
        ) : null}
      </Box>
    )
  }
  if (result.kind === 'action') {
    const action = actions.find((a) => a.id === result.action)
    if (!action) {
      return <Typography variant="body2" sx={{ color: 'text.secondary' }}>That isn&apos;t something Puppy can do for you right now.</Typography>
    }
    if (dismissed) return <Typography variant="body2" sx={{ color: 'text.secondary' }}>Okay, Puppy left it alone.</Typography>
    return <ConfirmAction action={action} onConfirm={() => onRun(action)} onCancel={() => setDismissed(true)} />
  }
  if (result.kind === 'unknown' || result.kind === 'empty') {
    return (
      <Box>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Puppy doesn&apos;t have a rule for that. It understands short phrases like these:
        </Typography>
        <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: 'wrap', mt: 0.75 }}>
          {result.examples?.map((p) => <Chip key={p} size="small" variant="outlined" label={p} onClick={() => onAsk(p)} />)}
        </Stack>
      </Box>
    )
  }
  return (
    <Box>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>Puppy read that as</Typography>
      <Box><Chip size="small" color="primary" label={result.answer} sx={{ mt: 0.25 }} /></Box>
      <Typography variant="body2" sx={{ mt: 0.5 }}>{result.label}</Typography>
    </Box>
  )
}

const SUGGESTIONS = ["what's at risk?", 'how is progress calculated?', 'who can I message?', 'mark all read']

/**
 * "Ask Puppy": a small question box. The text is matched in this browser by ask.js and never sent, stored or logged;
 * `data` is the viewer's own allow-listed projects, people and departments.
 */
export default function AskPuppy({ user, data, actions, onRun, go }) {
  const [draft, setDraft] = useState('')
  const [question, setQuestion] = useState(null)
  const ask = (text) => {
    if (!text.trim()) return
    setQuestion((q) => ({ id: (q?.id ?? 0) + 1, text }))
  }
  const askNow = (text) => { setDraft(text); ask(text) }
  return (
    <Box component="form" role="search" aria-label="Ask Puppy" onSubmit={(e) => { e.preventDefault(); ask(draft) }}>
      <TextField size="small" fullWidth value={draft} onChange={(e) => setDraft(e.target.value)}
        placeholder="Ask: “why is Atlas at risk?”" autoComplete="off"
        slotProps={{
          htmlInput: { 'aria-label': 'Ask Puppy', maxLength: 120 },
          input: { endAdornment: (
            <InputAdornment position="end">
              <IconButton type="submit" size="small" edge="end" aria-label="Ask"><Send fontSize="small" /></IconButton>
            </InputAdornment>
          ) },
        }} />
      {!question ? (
        <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
          {SUGGESTIONS.map((p) => <Chip key={p} size="small" variant="outlined" label={p} onClick={() => askNow(p)} />)}
        </Stack>
      ) : (
        <Box aria-live="polite" sx={{ mt: 1 }}>
          <Answer key={question.id} question={question} user={user} data={data} actions={actions} onRun={onRun}
            onAsk={askNow} go={go} />
        </Box>
      )}
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>
        Your question stays in this browser: Puppy matches it against fixed rules and never sends, stores or logs it.
      </Typography>
    </Box>
  )
}
