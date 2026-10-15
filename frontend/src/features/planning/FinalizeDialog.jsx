import CheckCircle from '@mui/icons-material/CheckCircle'
import Cancel from '@mui/icons-material/Cancel'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, List,
  ListItem, ListItemIcon, ListItemText,
} from '@mui/material'
import { useEffect, useId, useState } from 'react'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import { useFinalizePlan, usePlan } from './planningApi.js'

/** The finalize checklist: each check passes or lists what to fix. Finalizing is possible only when all pass. */
export default function FinalizeDialog({ project, onClose, onFinalized }) {
  const titleId = useId()
  const plan = usePlan(project.id)
  const finalize = useFinalizePlan(project.id)
  const [checks, setChecks] = useState(null)  // from a 422, newer than the plan query
  const [failure, setFailure] = useState(null)
  const { refetch } = plan

  useEffect(() => { refetch() }, [refetch])  // always check the plan as it is now

  const shown = checks ?? plan.data?.checks ?? []
  const ready = shown.length > 0 && shown.every((c) => c.ok)
  const failing = shown.filter((c) => !c.ok).length

  const go = async () => {
    setFailure(null)
    try {
      await finalize.mutateAsync()
      onFinalized()
    } catch (err) {
      if (err.code === 'PLAN_INVALID' && err.details?.checks) setChecks(err.details.checks)
      else setFailure(err)
    }
  }

  return (
    <Dialog open onClose={finalize.isPending ? undefined : onClose} aria-labelledby={titleId} maxWidth="sm" fullWidth>
      <DialogTitle id={titleId}>Finalize the plan for {project.name}?</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1 }}>
          Finalizing locks this board, moves the project from Planned to Active and tells the team which milestone they
          start with.
        </DialogContentText>
        <ErrorAlert error={plan.error ?? failure} sx={{ mb: 1 }} />
        {plan.isFetching && !shown.length ? <Box sx={{ textAlign: 'center', py: 2 }}><CircularProgress size={28} /></Box> : null}
        {shown.length ? (
          <List dense aria-label="Plan checks">
            {shown.map((c) => (
              <ListItem key={c.code} alignItems="flex-start" data-check={c.code}>
                <ListItemIcon sx={{ minWidth: 36, mt: 0.5 }}>
                  {c.ok ? <CheckCircle color="success" titleAccess="Passed" />
                    : <Cancel color="error" titleAccess="Needs fixing" />}
                </ListItemIcon>
                <ListItemText primary={c.label}
                  secondary={c.ok ? null : (
                    <Box component="ul" sx={{ m: 0, pl: 2 }}>{c.problems.map((p) => <li key={p.message}>{p.message}</li>)}</Box>
                  )}
                  slotProps={{ secondary: { component: 'div' } }} />
              </ListItem>
            ))}
          </List>
        ) : null}
        {shown.length && !ready ? (
          <Alert severity="warning" role="status">
            {failing === 1 ? '1 check needs' : `${failing} checks need`} fixing before the plan can be finalized. Move
            every card to Scheduled and fix the problems marked on the cards.
          </Alert>
        ) : null}
        {ready ? <Alert severity="success" role="status">Everything checks out. The plan is ready to finalize.</Alert> : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={finalize.isPending}>{ready ? 'Cancel' : 'Back to the board'}</Button>
        <Button variant="contained" onClick={go} disabled={!ready || finalize.isPending}>
          {finalize.isPending ? 'Finalizing…' : 'Finalize and start the project'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
