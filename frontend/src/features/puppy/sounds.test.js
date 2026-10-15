import { describe, expect, test } from 'vitest'
import { FakeAudioContext } from './fakeAudio.js'
import { SYNTHS, synthesize } from './sounds.js'

const nodes = (ctx, kind) => ctx.created.filter((n) => n.kind === kind)

describe('generated sounds (Web Audio, no files)', () => {
  test('the bark is two short filtered noise bursts with a falling pitch, the second a little lower', () => {
    const ctx = new FakeAudioContext()
    const length = synthesize(ctx, 'bark', 0.5)
    const noise = nodes(ctx, 'buffer')
    expect(noise).toHaveLength(2)
    expect(noise.every((n) => n.started !== null)).toBe(true)
    expect(noise[1].started).toBeGreaterThan(noise[0].started)
    const voices = nodes(ctx, 'oscillator')
    expect(voices).toHaveLength(2)
    // Each woof slides down in pitch; the second starts lower than the first.
    const [first, second] = voices.map((v) => v.frequency.events.map((e) => e.value))
    expect(first[first.length - 1]).toBeLessThan(first[0])
    expect(second[0]).toBeLessThan(first[0])
    expect(nodes(ctx, 'biquad').length).toBeGreaterThanOrEqual(2)
    expect(length).toBeGreaterThan(0.25)
    expect(length).toBeLessThan(0.6)
  })

  test('the chime is two sine partials that fade out', () => {
    const ctx = new FakeAudioContext()
    synthesize(ctx, 'chime', 1)
    const partials = nodes(ctx, 'oscillator')
    expect(partials).toHaveLength(2)
    expect(partials.every((p) => p.type === 'sine')).toBe(true)
    const gains = nodes(ctx, 'gain').map((g) => g.gain.events.at(-1))
    expect(gains.every((e) => e.value <= 0.001)).toBe(true)
  })

  test('ping and pop are single short tones', () => {
    for (const sound of ['ping', 'pop']) {
      const ctx = new FakeAudioContext()
      const length = synthesize(ctx, sound, 1)
      expect(nodes(ctx, 'oscillator')).toHaveLength(1)
      expect(length).toBeLessThan(0.6)
    }
  })

  test('volume scales the loudest point; "none" and unknown sounds make nothing', () => {
    const loud = new FakeAudioContext()
    const quiet = new FakeAudioContext()
    synthesize(loud, 'ping', 1)
    synthesize(quiet, 'ping', 0.25)
    const peak = (ctx) => Math.max(...nodes(ctx, 'gain').flatMap((g) => g.gain.events.map((e) => e.value)))
    expect(peak(quiet)).toBeCloseTo(peak(loud) / 4)
    const none = new FakeAudioContext()
    expect(synthesize(none, 'none', 1)).toBe(0)
    expect(synthesize(none, 'trumpet', 1)).toBe(0)
    expect(none.created).toEqual([])
    expect(Object.keys(SYNTHS)).toEqual(['bark', 'chime', 'ping', 'pop'])
  })
})
