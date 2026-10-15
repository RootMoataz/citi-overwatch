import EditIcon from '@mui/icons-material/EditOutlined'
import {
  Autocomplete, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, TextField, Typography,
} from '@mui/material'
import { useId, useState } from 'react'
import { useSetUserSkills, useSkills } from '../../api/workflow.js'
import { useSession } from '../../auth/sessionContext.js'
import DemoLock from '../../components/DemoLock.jsx'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import SkillChips from '../../components/SkillChips.jsx'

function SkillsDialog({ person, skills, onClose }) {
  const titleId = useId()
  const catalogue = useSkills()
  const save = useSetUserSkills(person.id)
  const [picked, setPicked] = useState(skills)
  const [failure, setFailure] = useState(null)
  // Skills they already have stay listed even if an admin archived them since.
  const options = [...(catalogue.data?.items ?? []), ...skills]
    .filter((s, i, all) => all.findIndex((x) => String(x.id) === String(s.id)) === i)

  const submit = async (e) => {
    e.preventDefault()
    setFailure(null)
    try {
      await save.mutateAsync(picked.map((s) => s.id))
      onClose()
    } catch (err) { setFailure(err) }
  }

  return (
    <Dialog open onClose={save.isPending ? undefined : onClose} aria-labelledby={titleId} maxWidth="sm" fullWidth>
      <form noValidate onSubmit={submit}>
        <DialogTitle id={titleId}>Skills of {person.name}</DialogTitle>
        <DialogContent>
          <ErrorAlert error={failure} sx={{ mb: 2 }} />
          <ErrorAlert error={catalogue.error} onRetry={() => catalogue.refetch()} sx={{ mb: 2 }} />
          <Autocomplete multiple disableCloseOnSelect options={options} value={picked} loading={catalogue.isLoading}
            onChange={(_, value) => setPicked(value)} getOptionLabel={(s) => s.name}
            isOptionEqualToValue={(a, b) => String(a.id) === String(b.id)}
            renderOption={({ key, ...props }, option, { selected }) => (
              <li key={key} {...props}><Checkbox size="small" checked={selected} sx={{ mr: 1 }} />{option.name}</li>
            )}
            renderInput={(params) => <TextField {...params} label="Skills" sx={{ mt: 1 }}
              helperText="Auto-routing hands milestones to people with the skills they need." />} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

/** A person's skills on their profile; admins, and managers for the employees they manage, can change them. */
export default function SkillsCard({ person, skills = [], canEdit }) {
  const { user } = useSession()
  const [editing, setEditing] = useState(false)
  return (
    <Paper variant="outlined" component="section" aria-label="Skills" sx={{ p: 2, mb: 2 }}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1, gap: 1 }}>
        <Typography variant="subtitle1" component="h2">Skills</Typography>
        {canEdit ? (
          <DemoLock user={user} action="skills.edit">
            <Button size="small" startIcon={<EditIcon />} onClick={() => setEditing(true)}>Edit skills</Button>
          </DemoLock>
        ) : null}
      </Stack>
      <SkillChips skills={skills} label={`Skills of ${person.name}`} empty="No skills recorded yet." />
      {editing ? <SkillsDialog person={person} skills={skills} onClose={() => setEditing(false)} /> : null}
    </Paper>
  )
}
