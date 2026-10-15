import { describe, expect, test } from 'vitest'
import {
  CROP_FRAME, MAX_ZOOM, MIN_ZOOM, centerSquare, clampOffset, clampZoom, cropRectFor, displaySize, rezoomOffset,
} from './avatarImage.js'

const landscape = { width: 1200, height: 800 }
const portrait = { width: 600, height: 900 }
const square = { width: 500, height: 500 }

describe('clampZoom', () => {
  test('keeps zoom between 1x and 4x', () => {
    expect(clampZoom(0.2)).toBe(MIN_ZOOM)
    expect(clampZoom(2.5)).toBe(2.5)
    expect(clampZoom(9)).toBe(MAX_ZOOM)
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM)
  })
})

describe('displaySize', () => {
  test('at zoom 1 the shorter side exactly fills the frame', () => {
    expect(displaySize(1, landscape, 240)).toMatchObject({ width: 360, height: 240 })
    expect(displaySize(1, portrait, 240)).toMatchObject({ width: 240, height: 360 })
    expect(displaySize(2, square, 240)).toMatchObject({ width: 480, height: 480 })
  })
})

describe('clampOffset', () => {
  test('a landscape photo at zoom 1 slides sideways only, up to its overhang', () => {
    // 360x240 shown in a 240 frame: 60px spare on each side horizontally, none vertically.
    expect(clampOffset({ x: 500, y: 500 }, 1, landscape, 240)).toEqual({ x: 60, y: 0 })
    expect(clampOffset({ x: -500, y: -500 }, 1, landscape, 240)).toEqual({ x: -60, y: 0 })
    expect(clampOffset({ x: 25, y: 0 }, 1, landscape, 240)).toEqual({ x: 25, y: 0 })
  })

  test('a portrait photo at zoom 1 slides up and down only', () => {
    expect(clampOffset({ x: 30, y: -999 }, 1, portrait, 240)).toEqual({ x: 0, y: -60 })
  })

  test('zooming in gives room to move both ways; a square at zoom 1 cannot move', () => {
    expect(clampOffset({ x: 10, y: 10 }, 1, square, 240)).toEqual({ x: 0, y: 0 })
    // 2x on a square: 480px shown, 120px spare each way.
    expect(clampOffset({ x: 999, y: -999 }, 2, square, 240)).toEqual({ x: 120, y: -120 })
  })

  test('zoom beyond the limits is clamped first; junk offsets become centred', () => {
    // MAX_ZOOM 4 on a square: 960px shown, 360px spare.
    expect(clampOffset({ x: 9999, y: 0 }, 50, square, 240)).toEqual({ x: 360, y: 0 })
    expect(clampOffset({ x: Number.NaN }, 1, landscape, 240)).toEqual({ x: 0, y: 0 })
    expect(clampOffset(undefined, 1, landscape, 240)).toEqual({ x: 0, y: 0 })
  })
})

describe('rezoomOffset', () => {
  test('keeps the same spot in the middle, then clamps for the new zoom', () => {
    expect(rezoomOffset({ x: 50, y: 20 }, 2, 4, square, 240)).toEqual({ x: 100, y: 40 })
    expect(rezoomOffset({ x: 120, y: -120 }, 2, 1, square, 240)).toEqual({ x: 0, y: 0 })
  })
})

describe('cropRectFor', () => {
  test('zoom 1 with no offset is the centred square', () => {
    expect(cropRectFor(1, { x: 0, y: 0 }, landscape, 240)).toEqual({ sx: 200, sy: 0, side: 800 })
    expect(cropRectFor(1, { x: 0, y: 0 }, portrait, 240)).toEqual({ sx: 0, sy: 150, side: 600 })
    const centred = centerSquare(1200, 800)
    expect(cropRectFor(1, { x: 0, y: 0 }, landscape)).toEqual(centred)
  })

  test('dragging the photo right shows its left edge; fully right is sx 0', () => {
    // Landscape: 1200/360 = 3.333 source px per frame px at zoom 1.
    expect(cropRectFor(1, { x: 60, y: 0 }, landscape, 240)).toEqual({ sx: 0, sy: 0, side: 800 })
    expect(cropRectFor(1, { x: -60, y: 0 }, landscape, 240)).toEqual({ sx: 400, sy: 0, side: 800 })
    expect(cropRectFor(1, { x: 30, y: 0 }, landscape, 240).sx).toBeCloseTo(100)
  })

  test('dragging past the edge never reaches outside the photo', () => {
    for (const natural of [landscape, portrait, square]) {
      for (const zoom of [1, 1.7, 4]) {
        for (const offset of [{ x: 1e6, y: 1e6 }, { x: -1e6, y: -1e6 }, { x: 1e6, y: -1e6 }]) {
          const { sx, sy, side } = cropRectFor(zoom, offset, natural, CROP_FRAME)
          expect(sx).toBeGreaterThanOrEqual(0)
          expect(sy).toBeGreaterThanOrEqual(0)
          expect(sx + side).toBeLessThanOrEqual(natural.width + 1e-9)
          expect(sy + side).toBeLessThanOrEqual(natural.height + 1e-9)
        }
      }
    }
  })

  test('zoom shrinks the square: 4x of a portrait is a quarter of its width, at the limits', () => {
    expect(cropRectFor(4, { x: 0, y: 0 }, portrait, 240)).toEqual({ sx: 225, sy: 375, side: 150 })
    expect(cropRectFor(10, { x: 0, y: 0 }, portrait, 240)).toEqual({ sx: 225, sy: 375, side: 150 })
    expect(cropRectFor(0.5, { x: 0, y: 0 }, portrait, 240)).toEqual({ sx: 0, sy: 150, side: 600 })
    // Zoomed 2x into a portrait and pushed to the top-left corner of the photo.
    expect(cropRectFor(2, { x: 1e6, y: 1e6 }, portrait, 240)).toEqual({ sx: 0, sy: 0, side: 300 })
    expect(cropRectFor(2, { x: -1e6, y: -1e6 }, portrait, 240)).toEqual({ sx: 300, sy: 600, side: 300 })
  })

  test('the result does not depend on the frame size, only on the framing', () => {
    const small = cropRectFor(2, { x: 10, y: -5 }, landscape, 120)
    const big = cropRectFor(2, { x: 20, y: -10 }, landscape, 240)
    expect(small.sx).toBeCloseTo(big.sx)
    expect(small.sy).toBeCloseTo(big.sy)
    expect(small.side).toBeCloseTo(big.side)
  })
})
