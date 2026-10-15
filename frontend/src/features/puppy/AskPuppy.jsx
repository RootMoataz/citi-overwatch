import Send from '@mui/icons-material/SendRounded'
import { Box, Chip, IconButton, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useColorMode } from '../../app/colorMode.js'
import { useSession } from '../../auth/sessionContext.js'
import usePaletteData from '../palette/usePaletteData.js'
import { askPuppy } from './ask.js'

/** Loads the palette's records (projects, people, departments) ahead of the first question; renders nothing. */
function Warm({ user }) {
  usePaletteData(user)
  return null
}

/** Reads one question once its data is in, shows how it was read, and acts on it (once per question). */
function Answer({ question, user, onAsk }) {
  const navigate = useNavigate()
  const { setPreference } = useColorMode()
  const { logout } = useSession()
  const data = usePaletteData(user)
  const result = useMemo(() => (data.loading ? null : askPuppy(question.text, { user, ...data })),
    [question.text, user, data])
  const done = useRef(null)

  useEffect(() => {
    if (!result || done.current === question.id) return
    done.current = question.id
    if (result.kind === 'navigate') navigate(result.to)
    else if (result.kind === 'theme') setPreference(result.mode)
    else if (result.kind === 'signout') logout()
  }, [result, question.id, navigate, setPreference, logout])

  if (!result) return <Typography variant="body2" sx={{ color: 'text.secondary' }}>Puppy is sniffing around…</Typography>
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

/** "Ask Puppy": a small question box using the command palette's phrase rules. */
export default function AskPuppy() {
  const { user } = useSession()
  const [draft, setDraft] = useState('')
  const [question, setQuestion] = useState(null)
  const [warm, setWarm] = useState(false)
  const ask = (text) => {
    if (!text.trim()) return
    setWarm(true)
    setQuestion((q) => ({ id: (q?.id ?? 0) + 1, text }))
  }
  return (
    <Box component="form" role="search" aria-label="Ask Puppy" onSubmit={(e) => { e.preventDefault(); ask(draft) }}>
      {warm ? <Warm user={user} /> : null}
      <TextField size="small" fullWidth value={draft} onChange={(e) => setDraft(e.target.value)} onFocus={() => setWarm(true)}
        placeholder="Ask: “what's at risk?”" autoComplete="off"
        slotProps={{
          htmlInput: { 'aria-label': 'Ask Puppy', maxLength: 120 },
          input: { endAdornment: (
            <InputAdornment position="end">
              <IconButton type="submit" size="small" edge="end" aria-label="Ask"><Send fontSize="small" /></IconButton>
            </InputAdornment>
          ) },
        }} />
      {question ? (
        <Box aria-live="polite" sx={{ mt: 1 }}>
          <Answer key={question.id} question={question} user={user} onAsk={(text) => { setDraft(text); ask(text) }} />
        </Box>
      ) : null}
    </Box>
  )
}
