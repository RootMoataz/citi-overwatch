// Profile photos are re-drawn in the browser before upload: centre-cropped to a square, scaled to 256x256 on a
// canvas and exported as a brand-new PNG. Re-encoding keeps only pixels, so EXIF/GPS metadata and anything
// smuggled inside the original file never leave the device. The server still validates everything itself.

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

function loadImage(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')) }
    img.src = url
  })
}

/** Decode `file`, centre-crop it and return a fresh 256x256 PNG Blob. Rejects with a friendly message. */
export async function cropToSquarePng(file) {
  let image
  try {
    image = await loadImage(file)
  } catch {
    throw new Error("That file couldn't be read as an image. Choose another photo.")
  }
  const { sx, sy, side } = centerSquare(image.width, image.height)
  if (side < 16) throw new Error('That photo is too small. Choose one at least 16 pixels across.')
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const context = canvas.getContext('2d')
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  image.close?.()
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
