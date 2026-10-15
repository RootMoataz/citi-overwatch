import Send from '@mui/icons-material/SendRounded'
import { Box, IconButton, TextField, Tooltip } from '@mui/material'
import { useState } from 'react'
import { useSendMessage } from '../../api/messages.js'
import { useToast } from '../../app/toast.js'
import { BODY_LIMIT, counterText, shouldSendOnKey } from '../../lib/messaging.js'

/** Write and send: Enter sends, Shift+Enter starts a new line. A failed send keeps the text and says why. */
export default function Composer({ conversationId, onSent }) {
  const send = useSendMessage(conversationId)
  const toast = useToast()
  const [text, setText] = useState('')
  const body = text.trim()
  const over = body.length > BODY_LIMIT
  const counter = counterText(text)
  const blocked = !body || over || send.isPending

  const submit = async () => {
    if (blocked) return
    try {
      await send.mutateAsync(body)
      setText('')
      onSent?.()
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <Box component="form" noValidate onSubmit={(e) => { e.preventDefault(); submit() }}
      sx={{ display: 'flex', gap: 1, alignItems: 'flex-end', p: 1.5, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
      <TextField fullWidth multiline maxRows={6} size="small" placeholder="Write a message…" value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (shouldSendOnKey(e)) { e.preventDefault(); submit() } }}
        error={over} helperText={counter ?? undefined}
        slotProps={{ htmlInput: { 'aria-label': 'Message', readOnly: send.isPending },
          formHelperText: { 'aria-live': 'polite', sx: { textAlign: 'right', mx: 0.5 } } }} />
      <Tooltip title="Send (Enter)">
        <span>
          <IconButton type="submit" color="primary" aria-label="Send" disabled={blocked} sx={{ mb: counter ? 2.75 : 0.25 }}>
            <Send />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  )
}
