import CheckBoxOutlineBlank from '@mui/icons-material/CheckBoxOutlineBlank'
import TaskAlt from '@mui/icons-material/TaskAlt'
import { Box, List, ListItem, ListItemIcon, ListItemText, Stack, Typography } from '@mui/material'
import SkillChips from '../../components/SkillChips.jsx'
import { criteriaLines } from '../../lib/workflow.js'

/** What the milestone is for and when it's done: objective, completion criteria as a checklist (ticked once the
 * milestone is completed) and the skills it needs. */
export default function MilestoneDetails({ milestone }) {
  const criteria = criteriaLines(milestone.completion_criteria)
  const done = milestone.status === 'completed'
  const Icon = done ? TaskAlt : CheckBoxOutlineBlank
  return (
    <Box component="section" aria-label={`Details of ${milestone.name}`} sx={{ mt: 1.5 }}>
      <Stack sx={{ gap: 1.25 }}>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Objective</Typography>
          <Typography variant="body2">{milestone.objective || 'No objective set yet.'}</Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Done when</Typography>
          {criteria.length ? (
            <List dense disablePadding aria-label="Completion criteria">
              {criteria.map((line) => (
                <ListItem key={line} disableGutters sx={{ py: 0 }}>
                  <ListItemIcon sx={{ minWidth: 28 }}>
                    <Icon fontSize="small" color={done ? 'success' : 'action'} />
                  </ListItemIcon>
                  <ListItemText primary={line} />
                </ListItem>
              ))}
            </List>
          ) : <Typography variant="body2">No completion criteria yet.</Typography>}
        </Box>
        <Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>Skills needed</Typography>
          <SkillChips skills={milestone.required_skills ?? []} label={`Skills needed for ${milestone.name}`}
            empty="Anyone on the team can take it." />
        </Box>
      </Stack>
    </Box>
  )
}
