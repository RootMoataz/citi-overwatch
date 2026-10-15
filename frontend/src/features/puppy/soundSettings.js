// Puppy's sound choices, kept per browser (like the theme). Reading never throws: blocked or broken storage gives
// the defaults, field by field.

export const SOUND_KEY = 'overwatch.puppy.sound'

export const SOUNDS = [
  { value: 'bark', label: 'Puppy bark' },
  { value: 'chime', label: 'Soft chime' },
  { value: 'ping', label: 'Ping' },
  { value: 'pop', label: 'Pop' },
  { value: 'none', label: 'None' },
]

export const DEFAULT_SETTINGS = Object.freeze({ sound: 'bark', volume: 0.6, muted: false, backgroundOnly: false, titleBadge: true })

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)

/** Any object → valid settings: unknown sounds and non-booleans fall back to the defaults, volume is clamped to 0–1. */
export function cleanSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  const volume = typeof s.volume === 'number' && Number.isFinite(s.volume) ? Math.min(Math.max(s.volume, 0), 1)
    : DEFAULT_SETTINGS.volume
  return {
    sound: SOUNDS.some((o) => o.value === s.sound) ? s.sound : DEFAULT_SETTINGS.sound,
    volume,
    muted: bool(s.muted, DEFAULT_SETTINGS.muted),
    backgroundOnly: bool(s.backgroundOnly, DEFAULT_SETTINGS.backgroundOnly),
    titleBadge: bool(s.titleBadge, DEFAULT_SETTINGS.titleBadge),
  }
}

export function readSoundSettings() {
  try {
    const stored = window.localStorage.getItem(SOUND_KEY)
    return cleanSettings(stored ? JSON.parse(stored) : null)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function storeSoundSettings(settings) {
  try {
    window.localStorage.setItem(SOUND_KEY, JSON.stringify(cleanSettings(settings)))
  } catch {
    // Storage blocked: the choice still applies until the page is closed.
  }
}
