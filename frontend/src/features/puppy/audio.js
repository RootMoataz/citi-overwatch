// The one AudioContext Puppy plays through. Browsers only allow sound after the person has interacted with the page
// (a click, a key, a tap), so the context is created lazily: on the first interaction (armAudioUnlock), when a
// preview is clicked, or when the browser says the page has already been interacted with (the sign-in click).
import { synthesize } from './sounds.js'

let ctx = null
let unlocked = false

const AudioCtor = () => (typeof window === 'undefined' ? null : window.AudioContext ?? window.webkitAudioContext ?? null)
const activated = () => Boolean(typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive)

/** Create or wake the context. Call it from inside a user gesture; false when Web Audio isn't available. */
export function unlockAudio() {
  const Ctor = AudioCtor()
  if (!Ctor) return false
  try {
    ctx ??= new Ctor()
    if (ctx.state === 'suspended') ctx.resume?.()
    unlocked = true
    return true
  } catch {
    return false
  }
}

/** Unlock on the first click, key or tap anywhere; `onUnlock` runs once then. Returns a cleanup function. */
export function armAudioUnlock(onUnlock) {
  if (typeof window === 'undefined') return () => {}
  const events = ['pointerdown', 'keydown', 'touchstart']
  const handler = () => {
    if (unlockAudio()) onUnlock?.()
    cleanup()
  }
  const cleanup = () => events.forEach((e) => window.removeEventListener(e, handler, true))
  events.forEach((e) => window.addEventListener(e, handler, true))
  return cleanup
}

export const audioUnlocked = () => unlocked

/** 'played', 'silent' (no sound chosen or volume 0), 'blocked' (no interaction yet) or 'unavailable'. */
export function playSound(sound, volume) {
  if (!sound || sound === 'none' || !(volume > 0)) return 'silent'
  if (!unlocked && activated()) unlockAudio()
  if (!unlocked) return AudioCtor() ? 'blocked' : 'unavailable'
  try {
    if (ctx.state === 'suspended') ctx.resume?.()
    synthesize(ctx, sound, volume)
    return 'played'
  } catch {
    return 'unavailable'
  }
}

/** Tests only: forget the context so each test starts locked. */
export function resetAudio() {
  ctx = null
  unlocked = false
}
