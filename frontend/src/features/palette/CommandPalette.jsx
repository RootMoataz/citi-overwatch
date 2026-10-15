import AutoAwesome from '@mui/icons-material/AutoAwesomeOutlined'
import Bolt from '@mui/icons-material/BoltOutlined'
import DarkMode from '@mui/icons-material/DarkModeOutlined'
import Flag from '@mui/icons-material/FlagOutlined'
import Folder from '@mui/icons-material/FolderOutlined'
import LightMode from '@mui/icons-material/LightModeOutlined'
import Logout from '@mui/icons-material/Logout'
import NorthEast from '@mui/icons-material/NorthEast'
import Search from '@mui/icons-material/Search'
import {
  Box, Chip, Dialog, InputAdornment, InputBase, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Stack,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useColorMode } from '../../app/colorMode.js'
import { useSession } from '../../auth/sessionContext.js'
import UserAvatar from '../../components/UserAvatar.jsx'
import { formatDate } from '../../lib/format.js'
import { PRIORITY, priorityRank } from '../../lib/labels.js'
import { canViewProfile } from '../../lib/permissions.js'
import { examplePhrases, parsePhrase } from './phrases.js'
import { actionsFor, pagesFor, rank } from './search.js'
import usePaletteData from './usePaletteData.js'

const today = () => new Date().toISOString().slice(0, 10)
const isOverdue = (m) => m.status !== 'completed' && String(m.end_date).slice(0, 10) < today()
// "critical milestones" lists the open critical ones; "high priority milestones" adds the high ones, most important first.
const PRIORITY_LEVELS = { critical: ['critical'], high: ['critical', 'high'] }

function ItemIcon({ item }) {
  if (item.group === 'People') return <UserAvatar userId={item.personId} name={item.label} size={24} />
  const Icon = item.kind === 'intent' ? AutoAwesome : item.kind === 'theme' ? (item.mode === 'dark' ? DarkMode : LightMode)
    : item.kind === 'signout' ? Logout : { Projects: Folder, Milestones: Flag, Actions: Bolt }[item.group] ?? NorthEast
  return <Icon fontSize="small" />
}

/** Everything the viewer can jump to, plus the plain-English intent when the text reads as one. */
function useResults(query) {
  const { user } = useSession()
  const { mode } = useColorMode()
  const data = usePaletteData(user)
  return useMemo(() => {
    const intent = parsePhrase(query, { user, projects: data.projects, people: data.people, departments: data.departments })
    const intentItem = intent ? { ...intent, id: 'intent', group: 'Interpreted', kind: intent.kind === 'navigate' ? 'intent' : intent.kind } : null
    const projectName = new Map(data.projects.map((p) => [String(p.id), p.name]))
    const milestones = data.milestones.map((m) => ({
      id: `milestone:${m.id}`, group: 'Milestones', kind: 'navigate', label: m.name, overdue: isOverdue(m),
      priority: m.priority, open: m.status !== 'completed', end: String(m.end_date),
      detail: [projectName.get(String(m.project_id)) ?? '', `due ${formatDate(m.end_date)}`,
        ['critical', 'high'].includes(m.priority) ? `${PRIORITY[m.priority]} priority` : null].filter(Boolean).join(' · '),
      to: `/projects/${m.project_id}?tab=milestones`,
    }))
    if (intent?.milestones === 'overdue') {
      return { intent, items: [intentItem, ...milestones.filter((m) => m.overdue).slice(0, 8)] }
    }
    if (PRIORITY_LEVELS[intent?.milestones]) {
      const picked = milestones.filter((m) => m.open && PRIORITY_LEVELS[intent.milestones].includes(m.priority))
        .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.end.localeCompare(b.end))
      return { intent, items: [intentItem, ...picked.slice(0, 8)] }
    }
    const projects = data.projects.map((p) => ({
      id: `project:${p.id}`, group: 'Projects', kind: 'navigate', label: p.name, to: `/projects/${p.id}`,
      detail: [p.department?.name, p.manager?.name].filter(Boolean).join(' · '),
    }))
    const people = data.people.filter((p) => canViewProfile(user, p.id, p.context)).map((p) => ({
      id: `person:${p.id}`, personId: p.id, group: 'People', kind: 'navigate', label: p.name,
      detail: p.job_title ?? '', to: `/people/${p.id}/profile`,
    }))
    const searchable = query.trim()
      ? [...pagesFor(user), ...projects, ...people, ...milestones, ...actionsFor(user, mode)]
      : [...pagesFor(user), ...projects, ...actionsFor(user, mode)]
    return { intent, items: [...(intentItem ? [intentItem] : []), ...rank(query, searchable)] }
  }, [query, user, mode, data])
}

function PaletteBody({ onClose }) {
  const navigate = useNavigate()
  const { user, logout } = useSession()
  const { setPreference } = useColorMode()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const { items } = useResults(query)
  const listId = useId()
  const listRef = useRef(null)
  const current = Math.min(active, Math.max(items.length - 1, 0))

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${current}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [current])

  const run = (item) => {
    if (!item) return
    onClose()
    if (item.kind === 'theme') setPreference(item.mode)
    else if (item.kind === 'signout') logout()
    else navigate(item.to)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((current + 1) % Math.max(items.length, 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((current - 1 + items.length) % Math.max(items.length, 1)) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(items.length - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); run(items[current]) }
  }

  const optionId = (i) => `${listId}-option-${i}`
  return (
    <>
      <InputBase autoFocus fullWidth value={query} placeholder="Search or ask: “at-risk projects in Technology”"
        onChange={(e) => { setQuery(e.target.value); setActive(0) }} onKeyDown={onKeyDown}
        inputProps={{ role: 'combobox', 'aria-label': 'Search Scout', 'aria-expanded': true, 'aria-controls': listId,
          'aria-activedescendant': items.length ? optionId(current) : undefined, 'aria-autocomplete': 'list' }}
        startAdornment={<InputAdornment position="start"><Search /></InputAdornment>}
        sx={{ px: 2, py: 1.5, fontSize: 17, borderBottom: 1, borderColor: 'divider' }} />
      {!query.trim() ? (
        <Stack direction="row" useFlexGap sx={{ gap: 1, flexWrap: 'wrap', px: 2, pt: 1.5, alignItems: 'center' }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Try</Typography>
          {examplePhrases(user).map((p) => (
            <Chip key={p} size="small" variant="outlined" label={p} onClick={() => { setQuery(p); setActive(0) }} />
          ))}
        </Stack>
      ) : null}
      <List id={listId} ref={listRef} role="listbox" aria-label="Results" dense
        sx={{ maxHeight: { xs: '60vh', sm: 420 }, overflowY: 'auto', py: 1 }}>
        {items.map((item, i) => {
          const header = item.group !== items[i - 1]?.group ? item.group : null
          return (
            <Fragment key={item.id}>
              {header ? (
                <ListSubheader role="presentation" disableSticky
                  sx={{ lineHeight: '28px', fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', bgcolor: 'transparent' }}>
                  {header}
                </ListSubheader>
              ) : null}
              <ListItemButton id={optionId(i)} data-index={i} role="option" aria-selected={i === current}
                selected={i === current} onMouseMove={() => i !== current && setActive(i)} onClick={() => run(item)}
                sx={(theme) => ({ mx: 1, borderRadius: 1.5,
                  ...(item.id === 'intent' ? { bgcolor: alpha(theme.palette.primary.main, 0.06) } : {}) })}>
                <ListItemIcon sx={{ minWidth: 36, color: item.id === 'intent' ? 'primary.main' : 'text.secondary' }}>
                  <ItemIcon item={item} />
                </ListItemIcon>
                {item.id === 'intent' ? (
                  <ListItemText primary={<Chip size="small" color="primary" label={item.chips.join(' · ')} />}
                    secondary={item.label} slotProps={{ secondary: { sx: { mt: 0.5 } } }} />
                ) : (
                  <ListItemText primary={item.label} secondary={item.detail || null}
                    slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }} />
                )}
              </ListItemButton>
            </Fragment>
          )
        })}
        {!items.length ? (
          <Typography variant="body2" sx={{ px: 3, py: 2, color: 'text.secondary' }}>
            Nothing matches “{query.trim()}”. Try a page, a project, a person or a phrase like “on hold”.
          </Typography>
        ) : null}
      </List>
      <Box sx={{ display: { xs: 'none', sm: 'flex' }, gap: 2, px: 2, py: 1, borderTop: 1, borderColor: 'divider',
        color: 'text.secondary', fontSize: 12 }}>
        <span>↑ ↓ to move</span><span>Enter to open</span><span>Esc to close</span>
      </Box>
    </>
  )
}

/** The Ctrl/Cmd+K command palette: search pages, projects, people and milestones, or type a phrase. */
export default function CommandPalette({ open, onClose }) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" aria-label="Search Scout"
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-start' } }}
      slotProps={{ paper: { sx: { mt: { xs: 2, sm: '12vh' }, mx: 2, width: 'calc(100% - 32px)', borderRadius: 3, overflow: 'hidden' } } }}>
      {open ? <PaletteBody onClose={onClose} /> : null}
    </Dialog>
  )
}
