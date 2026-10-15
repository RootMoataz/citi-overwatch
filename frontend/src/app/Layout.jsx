import Check from '@mui/icons-material/Check'
import DarkMode from '@mui/icons-material/DarkModeOutlined'
import KeyboardDoubleArrowLeft from '@mui/icons-material/KeyboardDoubleArrowLeft'
import KeyboardDoubleArrowRight from '@mui/icons-material/KeyboardDoubleArrowRight'
import LightMode from '@mui/icons-material/LightModeOutlined'
import MenuIcon from '@mui/icons-material/Menu'
import SettingsBrightness from '@mui/icons-material/SettingsBrightnessOutlined'
import {
  AppBar, Badge, Box, Chip, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Menu,
  MenuItem, Stack, Toolbar, Tooltip, Typography,
} from '@mui/material'
import { motion } from 'framer-motion'
import { useId, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import BrandLogo from '../components/BrandLogo.jsx'
import ErrorBoundary from '../components/ErrorBoundary.jsx'
import UserAvatar from '../components/UserAvatar.jsx'
import AvatarDialog from '../features/avatar/AvatarDialog.jsx'
import PaletteButton from '../features/palette/PaletteButton.jsx'
import { DESKTOP_QUERY } from '../lib/responsive.js'
import { fullName } from '../lib/format.js'
import { ROLE_LABEL } from '../lib/labels.js'
import { EASE, useCalmMotion } from '../lib/motion.js'
import { can } from '../lib/permissions.js'
import { useColorMode } from './colorMode.js'
import { COLLAPSED_WIDTH, DRAWER_WIDTH, NAV } from './nav.jsx'
import { SIDEBAR_SHORTCUT, useSidebarCollapsed } from './sidebar.js'
import { AVATAR_SIZE } from '../lib/avatarLook.js'

// The sidebar's width change; the header and the page follow it at the same pace.
const SLIDE = '200ms cubic-bezier(0.4, 0, 0.2, 1)'
const fade = (collapsed) => ({ opacity: collapsed ? 0 : 1, transition: `opacity ${collapsed ? '120ms' : '200ms 60ms'} ease` })

const THEMES = [
  { value: 'light', label: 'Light', icon: <LightMode fontSize="small" /> },
  { value: 'dark', label: 'Dark', icon: <DarkMode fontSize="small" /> },
  { value: 'system', label: 'System', hint: 'Match this device', icon: <SettingsBrightness fontSize="small" /> },
]

const resolve = (value, user) => (typeof value === 'function' ? value(user) : value)

// Messages keeps one page instance while moving between conversations, so the inbox doesn't flash on every click.
const pageKey = (pathname) => (pathname.startsWith('/messages') ? '/messages' : pathname)

function NavItem({ item, user, onNavigate, badge, collapsed }) {
  const label = resolve(item.label, user)
  const meaning = item.badge?.label ?? 'waiting'
  const colour = item.badge?.color ?? 'warning'
  const link = (
    <ListItemButton component={NavLink} to={resolve(item.to, user)} end={item.end} onClick={onNavigate}
      aria-label={collapsed && badge ? `${label} (${badge} ${meaning})` : undefined}
      sx={{ borderRadius: 1.5, mb: 0.5, minHeight: 42, color: 'text.secondary', overflow: 'hidden',
        '& .MuiListItemIcon-root': { color: 'inherit' },
        '&:hover': { color: 'text.primary' },
        // The selected page: tinted background, primary text and a left accent bar (kept when collapsed).
        '&.active': { bgcolor: 'action.selected', color: 'primary.main', fontWeight: 600,
          '&::before': { content: '""', position: 'absolute', left: 0, top: 8, bottom: 8, width: 4, borderRadius: 2,
            bgcolor: 'primary.main' } } }}>
      <ListItemIcon sx={{ minWidth: 36 }}>
        {collapsed && badge ? (
          <Badge variant="dot" color={colour} overlap="circular">{item.icon}</Badge>
        ) : item.icon}
      </ListItemIcon>
      <ListItemText primary={label} sx={{ m: 0, whiteSpace: 'nowrap', ...fade(collapsed) }}
        slotProps={{ primary: { sx: { fontWeight: 'inherit' } } }} />
      {badge && !collapsed ? <Chip size="small" color={colour} label={badge} aria-label={`${badge} ${meaning}`} /> : null}
    </ListItemButton>
  )
  return collapsed ? <Tooltip title={label} placement="right">{link}</Tooltip> : link
}

function NavGroup({ title, items, user, onNavigate, badges, collapsed }) {
  const id = useId()
  return (
    <List aria-labelledby={id} sx={{ px: 1 }}
      subheader={<ListSubheader id={id} disableSticky sx={{ bgcolor: 'transparent', lineHeight: '32px', fontSize: '0.75rem',
        fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary', whiteSpace: 'nowrap',
        ...fade(collapsed) }}>{title}</ListSubheader>}>
      {items.map((item) => <NavItem key={resolve(item.to, user)} item={item} user={user} onNavigate={onNavigate}
        badge={badges[resolve(item.to, user)]} collapsed={collapsed} />)}
    </List>
  )
}

/** Work items first; for admins the admin-only pages sit in their own "Admin" group underneath. */
function NavList({ user, onNavigate, badges = {}, collapsed = false }) {
  const visible = NAV.filter((item) => !item.action || can(user, item.action))
  const grouped = user?.role === 'admin'
  const work = grouped ? visible.filter((item) => !item.admin) : visible
  const admin = grouped ? visible.filter((item) => item.admin) : []
  return (
    <Box component="nav" aria-label="Main navigation" sx={{ py: 1, flexGrow: 1, overflowY: 'auto', overflowX: 'hidden' }}>
      <NavGroup title="Work" items={work} user={user} onNavigate={onNavigate} badges={badges} collapsed={collapsed} />
      {admin.length ? (
        <>
          <Divider sx={{ mx: 2, my: 1 }} />
          <NavGroup title="Admin" items={admin} user={user} onNavigate={onNavigate} badges={badges} collapsed={collapsed} />
        </>
      ) : null}
    </Box>
  )
}

/** Shrinks the desktop sidebar to icons and back; "[" does the same. */
function CollapseToggle({ collapsed, onToggle }) {
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar'
  return (
    <Box sx={{ p: 1, borderTop: 1, borderColor: 'divider' }}>
      <Tooltip title={`${label} (${SIDEBAR_SHORTCUT})`} placement="right">
        <ListItemButton onClick={onToggle} aria-label={label} aria-expanded={!collapsed}
          sx={{ borderRadius: 1.5, minHeight: 40, color: 'text.secondary', overflow: 'hidden', '&:hover': { color: 'text.primary' } }}>
          <ListItemIcon sx={{ minWidth: 36, color: 'inherit' }}>
            {collapsed ? <KeyboardDoubleArrowRight /> : <KeyboardDoubleArrowLeft />}
          </ListItemIcon>
          <ListItemText primary="Collapse" sx={{ m: 0, whiteSpace: 'nowrap', ...fade(collapsed) }} />
          <Box component="kbd" aria-hidden sx={{ px: 0.75, borderRadius: 0.75, border: 1, borderColor: 'divider', fontSize: '0.75rem',
            fontFamily: 'inherit', lineHeight: 1.6, ...fade(collapsed) }}>{SIDEBAR_SHORTCUT}</Box>
        </ListItemButton>
      </Tooltip>
    </Box>
  )
}

/** App shell: permanent sidebar on desktop, a menu drawer on phones (React Responsive picks). */
export default function Layout({ user, onLogout, topBarExtras, badges }) {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const [photoOpen, setPhotoOpen] = useState(false)
  const location = useLocation()
  const colorMode = useColorMode()
  const calm = useCalmMotion()
  const [collapsedChoice, toggleCollapsed] = useSidebarCollapsed(desktop)
  const collapsed = desktop && collapsedChoice
  const sidebarWidth = collapsed ? COLLAPSED_WIDTH : DRAWER_WIDTH

  const brand = (compact) => (
    <Toolbar disableGutters sx={{ px: '18px', overflow: 'hidden' }}>
      <BrandLogo variant={compact ? 'glyph' : 'full'} size={36} animated />
    </Toolbar>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="fixed" color="inherit" elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider', width: desktop ? `calc(100% - ${sidebarWidth}px)` : '100%',
          ml: desktop ? `${sidebarWidth}px` : 0, transition: `width ${SLIDE}, margin ${SLIDE}` }}>
        <Toolbar sx={{ gap: 1 }}>
          {!desktop ? (
            <IconButton edge="start" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
              <MenuIcon />
            </IconButton>
          ) : null}
          {!desktop ? <BrandLogo size={30} /> : null}
          <Box sx={{ flexGrow: 1 }} />
          <Box sx={{ mr: { xs: 0, sm: 1 } }}><PaletteButton /></Box>
          {topBarExtras}
          <IconButton aria-label="Account menu" onClick={(e) => setMenuAnchor(e.currentTarget)} sx={{ p: 0.5 }}>
            <UserAvatar userId={user?.id} name={fullName(user)} size={AVATAR_SIZE.header} />
          </IconButton>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <Stack direction="row" sx={{ px: 2, py: 1, gap: 1.5, alignItems: 'center' }}>
              <UserAvatar userId={user?.id} name={fullName(user)} size={40} />
              <Box>
                <Typography variant="subtitle1">{fullName(user)}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {user?.username} · {ROLE_LABEL[user?.role] ?? user?.role}
                </Typography>
              </Box>
            </Stack>
            <Divider />
            <MenuItem component={NavLink} to="/profile" onClick={() => setMenuAnchor(null)}>My profile</MenuItem>
            <MenuItem onClick={() => { setMenuAnchor(null); setPhotoOpen(true) }}>Profile photo</MenuItem>
            <Divider />
            <ListSubheader disableSticky sx={{ lineHeight: '32px', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: 'text.secondary', bgcolor: 'transparent' }}>Theme</ListSubheader>
            {THEMES.map((t) => {
              const chosen = colorMode.preference === t.value
              return (
                <MenuItem key={t.value} role="menuitemradio" aria-checked={chosen} selected={chosen}
                  onClick={() => colorMode.setPreference(t.value)}>
                  <ListItemIcon>{t.icon}</ListItemIcon>
                  <ListItemText primary={t.label} secondary={t.hint} />
                  {chosen ? <Check fontSize="small" sx={{ ml: 2, color: 'primary.main' }} aria-hidden /> : null}
                </MenuItem>
              )
            })}
            <Divider />
            <MenuItem onClick={() => { setMenuAnchor(null); onLogout?.() }}>Sign out</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>
      {photoOpen ? <AvatarDialog open user={user} onClose={() => setPhotoOpen(false)} /> : null}

      {desktop ? (
        <Drawer variant="permanent" data-testid="sidebar" data-collapsed={String(collapsed)}
          sx={{ width: sidebarWidth, flexShrink: 0, transition: `width ${SLIDE}`,
            '& .MuiDrawer-paper': { width: sidebarWidth, boxSizing: 'border-box', overflowX: 'hidden', transition: `width ${SLIDE}`,
              display: 'flex', flexDirection: 'column' } }}>
          {brand(collapsed)}
          <Divider />
          <NavList user={user} badges={badges} collapsed={collapsed} />
          <CollapseToggle collapsed={collapsed} onToggle={toggleCollapsed} />
        </Drawer>
      ) : (
        <Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: false }} sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}>
          {brand(false)}
          <Divider />
          <NavList user={user} badges={badges} onNavigate={() => setMobileOpen(false)} />
        </Drawer>
      )}

      <Box component="main" key={pageKey(location.pathname)}
        sx={{ flexGrow: 1, minWidth: 0, px: { xs: 2, md: 4 }, pt: { xs: 10, md: 11 }, pb: 6, maxWidth: 1440 }}>
        {/* Each page fades and rises in; nothing waits for it, and reduced motion skips it. */}
        <motion.div initial={calm ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: EASE }}>
          <ErrorBoundary key={pageKey(location.pathname)}><Outlet /></ErrorBoundary>
        </motion.div>
      </Box>
    </Box>
  )
}
