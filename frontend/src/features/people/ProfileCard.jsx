import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import LockOutlined from '@mui/icons-material/LockOutlined'
import { Box, ButtonBase, Divider, Paper, Stack, Typography } from '@mui/material'
import { useId, useState } from 'react'
import UserAvatar from '../../components/UserAvatar.jsx'
import { formatMoney } from '../../lib/format.js'
import { ROLE_LABEL } from '../../lib/labels.js'
import SkillsCard from './SkillsCard.jsx'
import YourManagerCard from './YourManagerCard.jsx'

/** Employment details: collapsed on every visit; the salary is only rendered once it is opened. */
function EmploymentDetails({ salary }) {
  const [open, setOpen] = useState(false)
  const bodyId = useId()
  return (
    <Box>
      <ButtonBase onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={bodyId}
        sx={{ width: '100%', minHeight: 44, justifyContent: 'flex-start', gap: 1, textAlign: 'left', borderRadius: 1 }}>
        <LockOutlined aria-hidden="true" fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography component="span" variant="subtitle1" sx={{ flexGrow: 1 }}>Employment details</Typography>
        <ExpandMoreIcon aria-hidden="true" sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </ButtonBase>
      <Typography variant="caption" component="p" sx={{ color: 'text.secondary', m: 0 }}>
        Annual salary and other employment details
      </Typography>
      <div id={bodyId} hidden={!open}>
        {open ? (
          <Stack sx={{ mt: 1.5 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>Annual salary</Typography>
            <Typography variant="body1">{salary == null ? '—' : formatMoney(salary)}</Typography>
          </Stack>
        ) : null}
      </div>
    </Box>
  )
}

/** Who this is: photo, name, title, skills, manager, and (only when the profile carries `salary`) Employment details. */
export default function ProfileCard({ person, skills = [], canEditSkills = false, own = false }) {
  const where = [ROLE_LABEL[person.role], person.department?.name].filter(Boolean).join(' · ')
  // Someone else's page names who they report to even when that account is archived; their own lists a manager to contact.
  const manager = person.manager
  const showsManager = Boolean(manager?.id) && (!manager.is_archived || !own)
  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack sx={{ gap: 0.5, alignItems: 'flex-start', mb: 2 }}>
        <UserAvatar userId={person.id} name={person.name} size={64} />
        <Typography variant="h3" component="h2" sx={{ mt: 1, overflowWrap: 'anywhere' }}>{person.name}</Typography>
        {person.job_title ? <Typography variant="body1" sx={{ color: 'text.secondary' }}>{person.job_title}</Typography> : null}
        {where ? <Typography variant="body2" sx={{ color: 'text.secondary' }}>{where}</Typography> : null}
      </Stack>
      <Divider sx={{ mb: 2 }} />
      <SkillsCard embedded person={person} skills={skills} canEdit={canEditSkills} />
      {showsManager ? <Divider sx={{ my: 2 }} /> : null}
      <YourManagerCard embedded manager={manager} title={own ? 'Your manager' : 'Reports to'} keepArchived={!own} />
      {'salary' in person ? (
        <>
          <Divider sx={{ my: 2 }} />
          <EmploymentDetails salary={person.salary} />
        </>
      ) : null}
    </Paper>
  )
}
