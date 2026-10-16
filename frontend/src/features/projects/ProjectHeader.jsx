import Edit from '@mui/icons-material/EditOutlined'
import MoreHoriz from '@mui/icons-material/MoreHoriz'
import { Box, Button, IconButton, Menu, MenuItem, Stack, Typography } from '@mui/material'
import { useId, useState } from 'react'
import DemoLock from '../../components/DemoLock.jsx'
import PageHeader from '../../components/PageHeader.jsx'
import PersonLink from '../../components/PersonLink.jsx'
import RiskText from '../../components/RiskText.jsx'
import StatusChip from '../../components/StatusChip.jsx'
import { formatDate, formatDateRange, nyTodayIso } from '../../lib/format.js'
import { can } from '../../lib/permissions.js'

const LONG_LINES = 3
const LONG_CHARS = 240

/** Who else may approve this project's hours, and until when. */
function DelegateLine({ delegate }) {
  const text = delegate.active
    ? `Approvals delegated to ${delegate.name} ${delegate.until ? `until ${formatDate(delegate.until)}` : 'until further notice'}`
    : `Delegation to ${delegate.name} ended ${formatDate(delegate.until)}`
  return <Typography variant="body2" sx={{ color: delegate.active ? 'info.main' : 'text.secondary' }}>{text}</Typography>
}

/** The description, clamped to three lines with "More" when it is long (jsdom can't measure overflow, so length decides). */
function Description({ text }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const long = text.split('\n').length > LONG_LINES || text.length > LONG_CHARS
  return (
    <Box>
      <Typography id={id} variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.primary', overflowWrap: 'anywhere',
        ...(long && !open ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: LONG_LINES, overflow: 'hidden' } : {}) }}>
        {text}
      </Typography>
      {long ? (
        <Button size="small" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={id}
          sx={{ minHeight: 44, px: 0.5 }}>{open ? 'Less' : 'More'}</Button>
      ) : null}
    </Box>
  )
}

/** The project's header, the same on every tab: name, status and health, who and when, the description, and the
 * actions. Edit is for whoever manages a live project; the "⋯" menu (Archive / Restore) is for admins. */
export default function ProjectHeader({ project: p, user, view, onEdit, onArchive, onRestore, busy = false }) {
  const [anchor, setAnchor] = useState(null)
  const menuId = useId()
  const admin = can(user, 'project.archive')
  const healthy = !p.is_archived && p.status !== 'completed'
  const parts = [
    <PersonLink key="m" person={p.manager} context={{ project: p }}>{p.manager.name}</PersonLink>,
    p.department?.name ? <span key="d">{p.department.name}</span> : null,
    <span key="r">{formatDateRange(p.start_date, p.predicted_end_date)}</span>,
  ].filter(Boolean)
  const run = (fn) => () => { setAnchor(null); fn() }

  return (
    <PageHeader title={p.name}
      subtitle={(
        <Stack sx={{ gap: 1 }}>
          <Stack component="span" direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusChip status={p.status} />
            {p.is_archived ? <StatusChip status="blocked" label="Archived" /> : null}
            {healthy ? <RiskText project={p} today={nyTodayIso()} variant="chip" /> : null}
          </Stack>
          <Stack direction="row" useFlexGap sx={{ gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
            {parts.map((part, i) => (
              <Stack key={part.key} direction="row" sx={{ gap: 0.75 }}>
                {i ? <span aria-hidden>·</span> : null}{part}
              </Stack>
            ))}
          </Stack>
          {p.description ? <Description text={p.description} /> : null}
          {p.delegate ? <DelegateLine delegate={p.delegate} /> : null}
        </Stack>
      )}
      actions={<>
        {view.manage ? <Button variant="outlined" startIcon={<Edit />} onClick={onEdit}>Edit project</Button> : null}
        {admin ? (
          <>
            <IconButton aria-label="More project actions" aria-haspopup="menu" aria-controls={anchor ? menuId : undefined}
              aria-expanded={anchor ? true : undefined} onClick={(e) => setAnchor(e.currentTarget)}
              sx={{ width: 44, height: 44 }}><MoreHoriz /></IconButton>
            <Menu id={menuId} anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
              {p.is_archived ? (
                <DemoLock user={user} action="project.archive">
                  <MenuItem disabled={busy} onClick={run(onRestore)}>Restore project</MenuItem>
                </DemoLock>
              ) : (
                <DemoLock user={user} action="project.archive">
                  <MenuItem disabled={busy} onClick={run(onArchive)} sx={{ color: 'error.main' }}>Archive project</MenuItem>
                </DemoLock>
              )}
            </Menu>
          </>
        ) : null}
      </>} />
  )
}
