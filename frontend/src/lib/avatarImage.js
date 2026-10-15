// Profile photos are re-drawn in the browser before upload: the square the person framed in the crop editor is
// scaled to 256x256 on a canvas and exported as a brand-new PNG. Re-encoding keeps only pixels, so EXIF/GPS
// metadata and anything smuggled inside the original file never leave the device. The server still validates
// everything itself.
export const AVATAR_SIZE = 256
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024
export const MAX_UPLOAD_BYTES = 300 * 1024

/** A reason the chosen file can't be used, or null when it's fine to try. */
export function sourceProblem(file) {
  if (!file) return 'Choose a photo first.'
  if (!ACCEPTED_TYPES.includes(file.type)) return 'Choose a PNG, JPEG or WebP photo.'
  if (file.size > MAX_SOURCE_BYTES) return 'That photo is larger than 15 MB. Choose a smaller one.'
  return null
}

/** The largest centred square inside a width x height image: {sx, sy, side}. */
export function centerSquare(width, height) {
  const side = Math.min(width, height)
  return { sx: Math.floor((width - side) / 2), sy: Math.floor((height - side) / 2), side }
}

// Crop editor geometry. The photo is shown in a square FRAME (CSS pixels) at a "cover" scale: at zoom 1 its
// shorter side exactly fills the frame. `offset` is how far the photo's centre sits from the frame's centre, in
// frame pixels, and is always clamped so the photo covers the whole frame (no empty edges).
export const CROP_FRAME = 240
export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

/** `zoom` limited to MIN_ZOOM..MAX_ZOOM (anything not a number becomes MIN_ZOOM). */
export function clampZoom(zoom) {
  if (!Number.isFinite(zoom)) return MIN_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** Size in frame pixels of a `natural` {width, height} photo shown at `zoom` in a `frame`-pixel square. */
export function displaySize(zoom, natural, frame = CROP_FRAME) {
  const scale = (frame / Math.min(natural.width, natural.height)) * clampZoom(zoom)
  return { width: natural.width * scale, height: natural.height * scale, scale }
}

const limit = (value, max) => {
  const v = Number.isFinite(value) ? Math.min(max, Math.max(-max, value)) : 0
  return v === 0 ? 0 : v // never -0
}

/** `offset` {x, y} clamped so the photo, at `zoom`, still covers the whole frame. */
export function clampOffset(offset, zoom, natural, frame = CROP_FRAME) {
  const { width, height } = displaySize(zoom, natural, frame)
  return {
    x: limit(offset?.x ?? 0, Math.max(0, (width - frame) / 2)),
    y: limit(offset?.y ?? 0, Math.max(0, (height - frame) / 2)),
  }
}

/** The offset after zooming from `from` to `to` about the frame's centre, so the same spot stays in the middle. */
export function rezoomOffset(offset, from, to, natural, frame = CROP_FRAME) {
  const ratio = clampZoom(to) / clampZoom(from)
  return clampOffset({ x: (offset?.x ?? 0) * ratio, y: (offset?.y ?? 0) * ratio }, to, natural, frame)
}

/**
 * The square of the original photo that the frame shows, in the photo's own pixels: {sx, sy, side}.
 * This is exactly what gets drawn into the 256x256 avatar.
 */
export function cropRectFor(zoom, offset, natural, frame = CROP_FRAME) {
  const z = clampZoom(zoom)
  const { x, y } = clampOffset(offset, z, natural, frame)
  const { scale } = displaySize(z, natural, frame)
  const side = Math.min(natural.width, natural.height) / z
  const fit = (start, total) => Math.min(Math.max(0, start), Math.max(0, total - side))
  return {
    sx: fit(natural.width / 2 - (x + frame / 2) / scale, natural.width),
    sy: fit(natural.height / 2 - (y + frame / 2) / scale, natural.height),
    side,
  }
}

/**
 * Decode `file` the way the browser shows it (EXIF orientation applied). Resolves to {image, width, height};
 * `image` can be drawn on a canvas. Rejects with a friendly message.
 */
export async function decodeImage(file) {
  let image
  try {
    image = await loadImage(file)
  } catch {
    throw new Error("That file couldn't be read as an image. Choose another photo.")
  }
  const width = image.width
  const height = image.height
  if (Math.min(width, height) < 16) {
    image.close?.()
    throw new Error('That photo is too small. Choose one at least 16 pixels across.')
  }
  return { image, width, height }
}

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch (err) {
      // Older engines reject the options bag; they already decode as displayed, so try once without it.
      if (!(err instanceof TypeError)) throw err
      return createImageBitmap(file)
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')) }
    img.src = url
  })
}

/** Draw the {sx, sy, side} square of a decoded `image` into a fresh 256x256 PNG Blob. Rejects with a friendly message. */
export async function renderAvatarPng(image, rect) {
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, rect.sx, rect.sy, rect.side, rect.side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error("That photo couldn't be converted. Choose another one.")
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('That photo is too detailed to store. Choose a simpler one.')
  return blob
}

/** Base64 of a Blob's bytes (no "data:" prefix), for the JSON upload. */
export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
