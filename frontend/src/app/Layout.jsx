import AccountCircle from '@mui/icons-material/AccountCircle'
import FactCheck from '@mui/icons-material/FactCheckOutlined'
import MenuIcon from '@mui/icons-material/Menu'
import {
  AppBar, Box, Chip, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Menu,
  MenuItem, Toolbar, Typography,
} from '@mui/material'
import { useId, useState } from 'react'
import { useMediaQuery } from 'react-responsive'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import ErrorBoundary from '../components/ErrorBoundary.jsx'
import { DESKTOP_QUERY } from '../lib/responsive.js'
import { fullName } from '../lib/format.js'
import { can } from '../lib/permissions.js'
import { DRAWER_WIDTH, NAV } from './nav.jsx'

const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', employee: 'Employee' }

const resolve = (value, user) => (typeof value === 'function' ? value(user) : value)

function NavItem({ item, user, onNavigate, badge }) {
  const label = resolve(item.label, user)
  return (
    <ListItemButton component={NavLink} to={resolve(item.to, user)} end={item.end} onClick={onNavigate}
      sx={{ borderRadius: 1, mb: 0.5, color: 'text.secondary', '& .MuiListItemIcon-root': { color: 'inherit' },
        '&:hover': { color: 'text.primary' },
        // The selected page: tinted background, primary text and a left accent bar.
        '&.active': { bgcolor: 'action.selected', color: 'primary.main', fontWeight: 600,
          '&::before': { content: '""', position: 'absolute', left: 0, top: 6, bottom: 6, width: 4, borderRadius: 2,
            bgcolor: 'primary.main' } } }}>
      <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
      <ListItemText primary={label} slotProps={{ primary: { sx: { fontWeight: 'inherit' } } }} />
      {badge ? <Chip size="small" color="warning" label={badge} aria-label={`${badge} waiting`} /> : null}
    </ListItemButton>
  )
}

function NavGroup({ title, items, user, onNavigate, badges }) {
  const id = useId()
  return (
    <List aria-labelledby={id} sx={{ px: 1 }}
      subheader={<ListSubheader id={id} disableSticky sx={{ bgcolor: 'transparent', lineHeight: '32px', fontSize: '0.75rem',
        fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'text.secondary' }}>{title}</ListSubheader>}>
      {items.map((item) => <NavItem key={resolve(item.to, user)} item={item} user={user} onNavigate={onNavigate}
        badge={badges[resolve(item.to, user)]} />)}
    </List>
  )
}

/** Work items first; for admins the admin-only pages sit in their own "Admin" group underneath. */
function NavList({ user, onNavigate, badges = {} }) {
  const visible = NAV.filter((item) => !item.action || can(user, item.action))
  const grouped = user?.role === 'admin'
  const work = grouped ? visible.filter((item) => !item.admin) : visible
  const admin = grouped ? visible.filter((item) => item.admin) : []
  return (
    <Box component="nav" aria-label="Main navigation" sx={{ py: 1 }}>
      <NavGroup title="Work" items={work} user={user} onNavigate={onNavigate} badges={badges} />
      {admin.length ? (
        <>
          <Divider sx={{ mx: 2, my: 1 }} />
          <NavGroup title="Admin" items={admin} user={user} onNavigate={onNavigate} badges={badges} />
        </>
      ) : null}
    </Box>
  )
}

/** App shell: permanent sidebar on desktop, a menu drawer on phones (React Responsive picks). */
export default function Layout({ user, onLogout, topBarExtras, badges }) {
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [menuAnchor, setMenuAnchor] = useState(null)
  const location = useLocation()

  const brand = (
    <Toolbar sx={{ gap: 1 }}>
      <FactCheck color="primary" aria-hidden />
      <Typography variant="h3" component="span" sx={{ fontWeight: 800 }}>Citi Overwatch</Typography>
    </Toolbar>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="fixed" color="inherit" elevation={0}
        sx={{ borderBottom: 1, borderColor: 'divider', width: desktop ? `calc(100% - ${DRAWER_WIDTH}px)` : '100%',
          ml: desktop ? `${DRAWER_WIDTH}px` : 0 }}>
        <Toolbar sx={{ gap: 1 }}>
          {!desktop ? (
            <IconButton edge="start" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
              <MenuIcon />
            </IconButton>
          ) : null}
          {!desktop ? <Typography variant="h3" component="span" sx={{ fontWeight: 800 }}>Citi Overwatch</Typography> : null}
          <Box sx={{ flexGrow: 1 }} />
          {topBarExtras}
          <IconButton aria-label="Account menu" onClick={(e) => setMenuAnchor(e.currentTarget)}>
            <AccountCircle />
          </IconButton>
          <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle1">{fullName(user)}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {user?.username} · {ROLE_LABEL[user?.role] ?? user?.role}
              </Typography>
            </Box>
            <Divider />
            <MenuItem component={NavLink} to="/profile" onClick={() => setMenuAnchor(null)}>My profile</MenuItem>
            <MenuItem onClick={() => { setMenuAnchor(null); onLogout?.() }}>Sign out</MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {desktop ? (
        <Drawer variant="permanent"
          sx={{ width: DRAWER_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}>
          {brand}
          <Divider />
          <NavList user={user} badges={badges} />
        </Drawer>
      ) : (
        <Drawer variant="temporary" open={mobileOpen} onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: false }} sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}>
          {brand}
          <Divider />
          <NavList user={user} badges={badges} onNavigate={() => setMobileOpen(false)} />
        </Drawer>
      )}

      <Box component="main" key={location.pathname}
        sx={{ flexGrow: 1, minWidth: 0, px: { xs: 2, md: 4 }, pt: { xs: 10, md: 11 }, pb: 6, maxWidth: 1440 }}>
        <ErrorBoundary key={location.pathname}><Outlet /></ErrorBoundary>
      </Box>
    </Box>
  )
}
