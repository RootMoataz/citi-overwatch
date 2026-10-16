import { createContext } from 'react'

/**
 * Under 375 px the phone top bar has no room for Puppy's button, so Puppy moves into the account menu. Layout provides a
 * setter; Puppy (still mounted, so its alerts keep working) hands it `{ icon, open(anchorEl) }` while it is docked there,
 * and null when its button is back in the bar.
 */
export const PuppyDock = createContext(null)
