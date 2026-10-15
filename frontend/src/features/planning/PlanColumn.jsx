import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import Add from '@mui/icons-material/Add'
import { Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useState } from 'react'

/** Quick add: type a name, press Enter (Escape cancels). */
function QuickAdd({ column, busy, onAdd }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    await onAdd(trimmed)
    setName('')
    setOpen(false)
  }
  if (!open) {
    return (
      <Button size="small" startIcon={<Add />} onClick={() => setOpen(true)} sx={{ alignSelf: 'flex-start' }}>
        Add a card
      </Button>
    )
  }
  return (
    <Box component="form" noValidate onSubmit={(e) => { e.preventDefault(); submit() }}>
      <TextField size="small" autoFocus fullWidth label={`New card in ${column.label}`} value={name} disabled={busy}
        inputProps={{ maxLength: 120 }} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setName('') } }} />
      <Stack direction="row" sx={{ gap: 1, mt: 1 }}>
        <Button type="submit" size="small" variant="contained" disabled={busy || !name.trim()}>{busy ? 'Adding…' : 'Add'}</Button>
        <Button size="small" onClick={() => { setOpen(false); setName('') }} disabled={busy}>Cancel</Button>
      </Stack>
    </Box>
  )
}

/** One planning column: a drop target holding its cards in order, with quick add at the bottom when editable. */
export default function PlanColumn({ column, ids, editable, adding, onAdd, children }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: !editable })
  const headingId = `plan-column-${column.id}`
  return (
    <Paper component="section" variant="outlined" aria-labelledby={headingId} data-column={column.id}
      sx={(t) => ({ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, scrollSnapAlign: 'start',
        bgcolor: alpha(t.palette.text.primary, t.palette.mode === 'dark' ? 0.04 : 0.025),
        borderColor: isOver ? 'primary.main' : 'divider', transition: 'border-color 150ms' })}>
      <Box>
        <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1 }}>
          <Typography id={headingId} variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>{column.label}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }} aria-label={`${ids.length} cards`}>{ids.length}</Typography>
        </Stack>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>{column.hint}</Typography>
      </Box>
      <SortableContext id={column.id} items={ids} strategy={verticalListSortingStrategy}>
        <Stack ref={setNodeRef} component="ol" sx={{ listStyle: 'none', p: 0, m: 0, gap: 1, minHeight: 72, flexGrow: 1 }}>
          {children}
          {ids.length === 0 ? (
            <Box component="li" sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: 1, p: 2, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {editable ? 'Drop cards here' : 'Nothing here'}
              </Typography>
            </Box>
          ) : null}
        </Stack>
      </SortableContext>
      {editable ? <QuickAdd column={column} busy={adding === column.id} onAdd={onAdd} /> : null}
    </Paper>
  )
}
