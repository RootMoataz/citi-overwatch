import { afterEach, describe, expect, test, vi } from 'vitest'

const confetti = vi.fn()
vi.mock('canvas-confetti', () => ({ default: (...args) => confetti(...args) }))

const { celebrate, prefersReducedMotion } = await import('./celebrate.js')

function motion(reduce) {
  const original = window.matchMedia
  window.matchMedia = (query) => ({ matches: /reduce/.test(query) ? reduce : false, media: query,
    addEventListener() {}, removeEventListener() {} })
  return () => { window.matchMedia = original }
}

describe('celebrate', () => {
  afterEach(() => confetti.mockReset())

  test('bursts confetti when motion is welcome', async () => {
    const restore = motion(false)
    try {
      expect(prefersReducedMotion()).toBe(false)
      await expect(celebrate()).resolves.toBe(true)
      expect(confetti).toHaveBeenCalled()
      expect(confetti.mock.calls[0][0]).toMatchObject({ disableForReducedMotion: true })
    } finally { restore() }
  })

  test('does nothing for people who ask for reduced motion', async () => {
    const restore = motion(true)
    try {
      await expect(celebrate()).resolves.toBe(false)
      expect(confetti).not.toHaveBeenCalled()
    } finally { restore() }
  })

  test('a failure never escapes', async () => {
    const restore = motion(false)
    confetti.mockImplementation(() => { throw new Error('no canvas') })
    try {
      await expect(celebrate()).resolves.toBe(false)
    } finally { restore() }
  })
})
