import { afterEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_SETTINGS, SOUND_KEY, SOUNDS, cleanSettings, readSoundSettings, storeSoundSettings } from './soundSettings.js'

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('sound settings', () => {
  test('the puppy bark is the default, at a moderate volume, not muted, in any tab, with the title count on', () => {
    expect(DEFAULT_SETTINGS).toEqual({ sound: 'bark', volume: 0.6, muted: false, backgroundOnly: false, titleBadge: true })
    expect(readSoundSettings()).toEqual(DEFAULT_SETTINGS)
  })

  test('offers bark, chime, ping, pop and none, in that order', () => {
    expect(SOUNDS.map((s) => s.value)).toEqual(['bark', 'chime', 'ping', 'pop', 'none'])
    expect(SOUNDS[0].label).toBe('Puppy bark')
  })

  test('a stored choice comes back', () => {
    storeSoundSettings({ ...DEFAULT_SETTINGS, sound: 'chime', volume: 0.3, backgroundOnly: true })
    expect(readSoundSettings()).toEqual({ ...DEFAULT_SETTINGS, sound: 'chime', volume: 0.3, backgroundOnly: true })
  })

  test('garbage in storage falls back to the defaults field by field', () => {
    window.localStorage.setItem(SOUND_KEY, JSON.stringify({ sound: 'trumpet', volume: 7, muted: 'yes', titleBadge: false }))
    expect(readSoundSettings()).toEqual({ ...DEFAULT_SETTINGS, volume: 1, titleBadge: false })
    window.localStorage.setItem(SOUND_KEY, '{not json')
    expect(readSoundSettings()).toEqual(DEFAULT_SETTINGS)
  })

  test('cleanSettings clamps the volume between 0 and 1 and ignores unknown fields', () => {
    expect(cleanSettings({ volume: -2, extra: 1 })).toEqual({ ...DEFAULT_SETTINGS, volume: 0 })
    expect(cleanSettings({ volume: Number.NaN })).toEqual(DEFAULT_SETTINGS)
    expect(cleanSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  test('blocked storage (private windows, strict settings) still gives the defaults and never throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readSoundSettings()).toEqual(DEFAULT_SETTINGS)
    expect(() => storeSoundSettings({ ...DEFAULT_SETTINGS, muted: true })).not.toThrow()
  })
})
