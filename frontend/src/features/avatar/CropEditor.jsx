import { Box, Button, Slider, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useEffect, useId, useRef } from 'react'
import { AVATAR_SIZE } from '../../lib/avatarLook.js'
import {
  CROP_FRAME, MAX_ZOOM, MIN_ZOOM, clampOffset, clampZoom, displaySize, rezoomOffset,
} from '../../lib/avatarImage.js'

const PAN_STEP = 8
const PAN_STEP_BIG = 40
const ZOOM_STEP = 0.25
const WHEEL_SENSITIVITY = 0.0015

/** The photo positioned exactly as the crop frame shows it, scaled to a `size`-pixel square. */
function PlacedPhoto({ src, natural, zoom, offset, size, frame }) {
  const ratio = size / frame
  const { width, height } = displaySize(zoom, natural, frame)
  const left = (frame / 2 + offset.x - width / 2) * ratio
  const top = (frame / 2 + offset.y - height / 2) * ratio
  return (
    <Box component="img" src={src} alt="" draggable={false}
      sx={{
        position: 'absolute', left: 0, top: 0, width: width * ratio, height: height * ratio,
        maxWidth: 'none', transform: `translate(${left}px, ${top}px)`, transformOrigin: '0 0',
        imageOrientation: 'from-image', userSelect: 'none', pointerEvents: 'none',
      }} />
  )
}

/** A small round preview of the framed photo, the same size as the header avatar. */
function SmallPreview(props) {
  const size = AVATAR_SIZE.header
  return (
    <Box role="img" aria-label="Preview of your new photo"
      sx={{ position: 'relative', width: size, height: size, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
        bgcolor: 'action.hover', boxShadow: (t) => `0 0 0 1px ${t.palette.divider}` }}>
      <PlacedPhoto {...props} size={size} />
    </Box>
  )
}

/**
 * Frame a photo inside a circle: drag (mouse, pen or touch) to move it, pinch / mouse wheel / slider to zoom,
 * or use the keyboard (arrows pan, Shift for bigger steps, + and - zoom). The photo always covers the frame.
 * Controlled: `value` is {zoom, offset}; every change goes through `onChange` already clamped.
 */
export default function CropEditor({ src, natural, value, onChange, frame = CROP_FRAME }) {
  const hintId = useId()
  const frameRef = useRef(null)
  const latest = useRef({ value, natural, onChange, frame })
  const pointers = useRef(new Map())
  const pinch = useRef(null)

  useEffect(() => {
    latest.current = { value, natural, onChange, frame }
  })

  const zoomTo = (next) => {
    const { value: v, natural: n, onChange: change, frame: f } = latest.current
    const zoom = clampZoom(next)
    change({ zoom, offset: rezoomOffset(v.offset, v.zoom, zoom, n, f) })
  }

  const panBy = (dx, dy) => {
    const { value: v, natural: n, onChange: change, frame: f } = latest.current
    change({ zoom: v.zoom, offset: clampOffset({ x: v.offset.x + dx, y: v.offset.y + dy }, v.zoom, n, f) })
  }

  // React listens to wheel events passively, so the page would scroll too; a native listener can stop that.
  useEffect(() => {
    const node = frameRef.current
    if (!node) return undefined
    const onWheel = (event) => {
      event.preventDefault()
      const { value: v, natural: n, onChange: change, frame: f } = latest.current
      const zoom = clampZoom(v.zoom * Math.exp(-event.deltaY * WHEEL_SENSITIVITY))
      change({ zoom, offset: rezoomOffset(v.offset, v.zoom, zoom, n, f) })
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [])

  const spread = () => {
    const [a, b] = [...pointers.current.values()]
    return Math.hypot(a.x - b.x, a.y - b.y) || 1
  }

  const onPointerDown = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) pinch.current = { spread: spread(), zoom: latest.current.value.zoom }
  }

  const onPointerMove = (event) => {
    const last = pointers.current.get(event.pointerId)
    if (!last) return
    const now = { x: event.clientX, y: event.clientY }
    pointers.current.set(event.pointerId, now)
    if (pointers.current.size >= 2 && pinch.current) {
      zoomTo(pinch.current.zoom * (spread() / pinch.current.spread))
    } else if (pointers.current.size === 1) {
      panBy(now.x - last.x, now.y - last.y)
    }
  }

  const onPointerEnd = (event) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null
  }

  const onKeyDown = (event) => {
    const step = event.shiftKey ? PAN_STEP_BIG : PAN_STEP
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (moves[event.key]) {
      panBy(...moves[event.key])
    } else if (event.key === '+' || event.key === '=') {
      zoomTo(latest.current.value.zoom + ZOOM_STEP)
    } else if (event.key === '-' || event.key === '_') {
      zoomTo(latest.current.value.zoom - ZOOM_STEP)
    } else {
      return
    }
    event.preventDefault()
  }

  const placed = { src, natural, zoom: value.zoom, offset: value.offset, frame }

  return (
    <Stack sx={{ gap: 1.5, alignItems: 'center', width: '100%' }}>
      <Box ref={frameRef} role="group" aria-label="Photo crop area" aria-describedby={hintId} tabIndex={0}
        data-testid="avatar-crop-area"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd} onLostPointerCapture={onPointerEnd} onKeyDown={onKeyDown}
        sx={{
          position: 'relative', width: frame, height: frame, flexShrink: 0, overflow: 'hidden', borderRadius: 2,
          bgcolor: 'action.hover', touchAction: 'none', userSelect: 'none', cursor: 'grab',
          '&:active': { cursor: 'grabbing' },
          '&:focus-visible': { outline: (t) => `3px solid ${t.palette.primary.main}`, outlineOffset: 2 },
        }}>
        <PlacedPhoto {...placed} size={frame} />
        {/* Everything outside the circle is dimmed; the ring marks exactly what becomes the photo. */}
        <Box aria-hidden sx={{
          position: 'absolute', inset: 0, borderRadius: '50%', pointerEvents: 'none',
          boxShadow: `0 0 0 ${frame}px ${alpha('#000', 0.55)}`,
          border: `2px solid ${alpha('#fff', 0.9)}`,
        }} />
      </Box>
      <Typography id={hintId} variant="caption" sx={{ color: 'text.secondary', textAlign: 'center' }}>
        Drag to reposition, use the slider to zoom. Arrow keys move the photo (Shift for bigger steps); + and − zoom.
      </Typography>
      <Stack direction="row" sx={{ gap: 2, alignItems: 'center', width: '100%', maxWidth: frame + 40 }}>
        <Slider aria-label="Zoom" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={value.zoom}
          onChange={(_, next) => zoomTo(next)} getAriaValueText={(v) => `${v.toFixed(1)}×`}
          valueLabelDisplay="auto" valueLabelFormat={(v) => `${v.toFixed(1)}×`} sx={{ flex: 1 }} />
        <SmallPreview {...placed} />
      </Stack>
      <Button size="small" onClick={() => onChange({ zoom: MIN_ZOOM, offset: { x: 0, y: 0 } })}
        disabled={value.zoom === MIN_ZOOM && value.offset.x === 0 && value.offset.y === 0}>
        Reset
      </Button>
    </Stack>
  )
}
