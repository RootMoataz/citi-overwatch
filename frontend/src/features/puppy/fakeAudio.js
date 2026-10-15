// A stand-in for the browser's AudioContext, for tests only (jsdom has no Web Audio). It records every node a sound
// creates and every value scheduled on its parameters, so tests can check a sound's shape without hearing it.

class FakeParam {
  constructor(value = 0) {
    this.value = value
    this.events = []
  }

  setValueAtTime(value, time) { this.events.push({ type: 'set', value, time }); return this }
  linearRampToValueAtTime(value, time) { this.events.push({ type: 'linear', value, time }); return this }
  exponentialRampToValueAtTime(value, time) { this.events.push({ type: 'exp', value, time }); return this }
}

class FakeNode {
  constructor(ctx, kind) {
    this.kind = kind
    this.connections = []
    this.started = null
    this.stopped = null
    ctx.created.push(this)
  }

  connect(target) { this.connections.push(target); return target }
  disconnect() { this.connections = [] }
  start(time = 0) { this.started = time }
  stop(time = 0) { this.stopped = time }
}

export class FakeAudioContext {
  constructor() {
    this.created = []
    this.currentTime = 0
    this.sampleRate = 8000
    this.state = 'running'
    this.destination = { kind: 'destination' }
    this.resumed = 0
  }

  resume() { this.resumed += 1; this.state = 'running'; return Promise.resolve() }

  createGain() {
    const node = new FakeNode(this, 'gain')
    node.gain = new FakeParam(1)
    return node
  }

  createOscillator() {
    const node = new FakeNode(this, 'oscillator')
    node.type = 'sine'
    node.frequency = new FakeParam(440)
    return node
  }

  createBiquadFilter() {
    const node = new FakeNode(this, 'biquad')
    node.type = 'lowpass'
    node.frequency = new FakeParam(350)
    node.Q = new FakeParam(1)
    return node
  }

  createBuffer(channels, length, sampleRate) {
    const data = new Float32Array(length)
    return { length, sampleRate, numberOfChannels: channels, getChannelData: () => data }
  }

  createBufferSource() {
    const node = new FakeNode(this, 'buffer')
    node.buffer = null
    return node
  }
}
