import { Tooltip } from '@mui/material'
import { cloneElement } from 'react'
import { DEMO_DISABLED, demoBlocks } from '../lib/permissions.js'

/** Wraps one action button. For a public demo account that may not take `action` the button stays visible but
 * disabled, with "Disabled in the public demo" on hover and keyboard focus (a disabled button gets neither, so the
 * focusable wrapper carries the tooltip). Everyone else gets the button untouched. */
export default function DemoLock({ user, action, children }) {
  if (!demoBlocks(user, action)) return children
  return (
    <Tooltip title={DEMO_DISABLED}>
      <span tabIndex={0} style={{ display: 'inline-flex' }}>{cloneElement(children, { disabled: true })}</span>
    </Tooltip>
  )
}
