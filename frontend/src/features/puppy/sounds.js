// Puppy's alert sounds, made in code with the Web Audio API: no audio files, nothing fetched. Each recipe schedules
// a few short-lived nodes on an AudioContext and returns how long the sound lasts (seconds). Volume (0–1) scales
// every envelope's peak directly, so 0.5 is half as loud as 1.
//
//   bark   two quick "woofs": a sawtooth voice through a low-pass filter whose pitch falls, plus a burst of
//          band-passed noise for the breathy start; the second woof is a little lower and softer
//   chime  two sine partials (C6 and G6) with a soft attack and a long fade, the upper one fading sooner
//   ping   one bright sine with a slight downward bend and a quick fade
//   pop    one sine that drops two octaves in 70 ms: a bubble popping

const SILENT = 0.0001

/** A gain envelope: silent → peak in `attack` s → fades to silence by `end`. */
function envelope(ctx, at, peak, attack, end) {
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(peak, at + attack)
  gain.gain.exponentialRampToValueAtTime(SILENT, end)
  gain.connect(ctx.destination)
  return gain
}

function tone(ctx, { at, type = 'sine', from, to, glide, peak, attack, end }) {
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(from, at)
  if (to && to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + glide)
  osc.connect(envelope(ctx, at, peak, attack, end))
  osc.start(at)
  osc.stop(end + 0.02)
  return osc
}

function noiseBuffer(ctx, seconds) {
  const length = Math.max(1, Math.ceil(ctx.sampleRate * seconds))
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1
  return buffer
}

/** One woof starting at `at`, pitched at `pitch` Hz; returns when it ends. */
function woof(ctx, at, pitch, volume, buffer) {
  const end = at + 0.15
  // The voice: a buzzy sawtooth sliding down about an octave, softened by a closing low-pass filter.
  const voice = ctx.createOscillator()
  voice.type = 'sawtooth'
  voice.frequency.setValueAtTime(pitch, at)
  voice.frequency.exponentialRampToValueAtTime(pitch * 0.55, at + 0.13)
  const lowpass = ctx.createBiquadFilter()
  lowpass.type = 'lowpass'
  lowpass.frequency.setValueAtTime(1600, at)
  lowpass.frequency.exponentialRampToValueAtTime(600, end)
  lowpass.Q.setValueAtTime(4, at)
  voice.connect(lowpass)
  lowpass.connect(envelope(ctx, at, 0.45 * volume, 0.012, end))
  voice.start(at)
  voice.stop(end + 0.02)
  // The breath: a short burst of noise through a band-pass filter that also falls.
  const breath = ctx.createBufferSource()
  breath.buffer = buffer
  const bandpass = ctx.createBiquadFilter()
  bandpass.type = 'bandpass'
  bandpass.frequency.setValueAtTime(1200, at)
  bandpass.frequency.exponentialRampToValueAtTime(500, at + 0.1)
  bandpass.Q.setValueAtTime(1.2, at)
  breath.connect(bandpass)
  bandpass.connect(envelope(ctx, at, 0.35 * volume, 0.005, at + 0.11))
  breath.start(at)
  breath.stop(at + 0.13)
  return end
}

function bark(ctx, at, volume) {
  const buffer = noiseBuffer(ctx, 0.14)
  woof(ctx, at, 520, volume, buffer)
  return woof(ctx, at + 0.19, 440, volume * 0.85, buffer) - at
}

function chime(ctx, at, volume) {
  tone(ctx, { at, from: 1046.5, peak: 0.28 * volume, attack: 0.01, end: at + 1.2 })
  tone(ctx, { at: at + 0.02, from: 1568, peak: 0.16 * volume, attack: 0.01, end: at + 0.8 })
  return 1.2
}

function ping(ctx, at, volume) {
  tone(ctx, { at, from: 1760, to: 1660, glide: 0.3, peak: 0.3 * volume, attack: 0.004, end: at + 0.45 })
  return 0.45
}

function pop(ctx, at, volume) {
  tone(ctx, { at, from: 620, to: 150, glide: 0.07, peak: 0.5 * volume, attack: 0.003, end: at + 0.1 })
  return 0.1
}

export const SYNTHS = { bark, chime, ping, pop }

/** Play `sound` on `ctx` now; returns its length in seconds (0 for "none" or an unknown name). */
export function synthesize(ctx, sound, volume = 1) {
  const recipe = SYNTHS[sound]
  if (!recipe) return 0
  return recipe(ctx, ctx.currentTime + 0.01, volume)
}
