import Check from '@mui/icons-material/Check'
import DarkMode from '@mui/icons-material/DarkModeOutlined'
import LightMode from '@mui/icons-material/LightModeOutlined'
import SettingsBrightness from '@mui/icons-material/SettingsBrightnessOutlined'
import { Box, Divider, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Stack, Typography } from '@mui/material'
import { useId, useState } from 'react'
import { NavLink } from 'react-router-dom'
import UserAvatar from '../components/UserAvatar.jsx'
import AvatarDialog from '../features/avatar/AvatarDialog.jsx'
import { fullName } from '../lib/format.js'
import { ROLE_LABEL } from '../lib/labels.js'
import { DEMO_DISABLED, demoBlocks } from '../lib/permissions.js'
import { useColorMode } from './colorMode.js'

const THEMES = [
  { value: 'light', label: 'Light', icon: <LightMode fontSize="small" /> },
  { value: 'dark', label: 'Dark', icon: <DarkMode fontSize="small" /> },
  { value: 'system', label: 'System', hint: 'Match this device', icon: <SettingsBrightness fontSize="small" /> },
]

const ABOVE = { anchorOrigin: { vertical: 'top', horizontal: 'left' }, transformOrigin: { vertical: 'bottom', horizontal: 'left' } }

/**
 * The account menu (the header avatar and the sidebar user chip both open it). Returns `openMenu(event, placement,
 * opener)` for the openers, `openedFrom` (the opener whose menu is open, or null) and `menuId` for their
 * aria-expanded / aria-controls, and `menu` to render once: the menu itself plus the profile photo dialog it can open.
 * `placement` is 'above' for an opener at the bottom of the screen; `onClosed` runs whenever the menu closes.
 * `puppy` ({ icon, open() }, narrow phones only) adds a "Puppy assistant" item that opens Puppy's panel.
 */
export function useAccountMenu({ user, onLogout, onClosed, puppy }) {
  const [anchor, setAnchor] = useState(null)
  const [placement, setPlacement] = useState('below')
  const [openedFrom, setOpenedFrom] = useState(null)
  const [photoOpen, setPhotoOpen] = useState(false)
  const colorMode = useColorMode()
  const menuId = useId()
  const photoLocked = demoBlocks(user, 'avatar.own')

  // On a phone the menu opens from the drawer's user chip. Every way out of the menu (an item, Esc, a click outside)
  // also shuts the drawer, which would otherwise stay open behind the page the person just picked; Layout passes
  // that as `onClosed`.
  const close = () => { setAnchor(null); setOpenedFrom(null); onClosed?.() }
  const openMenu = (event, where = 'below', opener = 'header') => {
    setPlacement(where)
    setOpenedFrom(opener)
    setAnchor(event.currentTarget)
  }

  const menu = (
    <>
      {/* variant "menu": opening puts focus on the first item (My profile), not on the selected theme. */}
      <Menu variant="menu" anchorEl={anchor} open={Boolean(anchor)} onClose={close} slotProps={{ list: { id: menuId } }}
        {...(placement === 'above' ? ABOVE : {})}>
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
        <MenuItem component={NavLink} to="/profile" onClick={close}>My profile</MenuItem>
        {photoLocked ? (
          <MenuItem disabled><ListItemText primary="Profile photo" secondary={DEMO_DISABLED} /></MenuItem>
        ) : (
          <MenuItem onClick={() => { close(); setPhotoOpen(true) }}>Profile photo</MenuItem>
        )}
        {/* An array, not a fragment: MUI menus don't take fragments as children. */}
        {puppy ? [
          <Divider key="puppy-divider" />,
          <MenuItem key="puppy" onClick={() => { close(); puppy.open() }}>
            <ListItemIcon>{puppy.icon}</ListItemIcon>
            <ListItemText primary="Puppy assistant" />
          </MenuItem>,
        ] : null}
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
        <MenuItem onClick={() => { close(); onLogout?.() }}>Sign out</MenuItem>
      </Menu>
      {photoOpen ? <AvatarDialog open user={user} onClose={() => setPhotoOpen(false)} /> : null}
    </>
  )
  return { openMenu, openedFrom, menuId, menu }
}
