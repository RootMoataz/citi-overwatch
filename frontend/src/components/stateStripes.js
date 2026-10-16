// Waiting on a predecessor, or kicked back and waiting for the manager: drawn striped wherever a state has a colour,
// so these never read as plain "not started" grey.
export const STRIPED = new Set(['waiting', 'blocked'])
export const stripes = (size) => `repeating-linear-gradient(45deg, rgba(255,255,255,.35) 0 ${size}px, transparent ${size}px ${size * 2}px)`
