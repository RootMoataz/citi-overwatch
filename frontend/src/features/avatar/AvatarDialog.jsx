import PhotoCamera from '@mui/icons-material/PhotoCameraOutlined'
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography,
} from '@mui/material'
import { useEffect, useId, useRef, useState } from 'react'
import { useAvatarIndex, useRemoveAvatar, useSetAvatar } from '../../api/queries.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { fullName } from '../../lib/format.js'
import {
  ACCEPTED_TYPES, MIN_ZOOM, blobToBase64, cropRectFor, decodeImage, renderAvatarPng, sourceProblem,
} from '../../lib/avatarImage.js'
import CropEditor from './CropEditor.jsx'

const START = { zoom: MIN_ZOOM, offset: { x: 0, y: 0 } }

/**
 * Choose, frame and save your own profile photo (every role). The person drags and zooms the photo inside a
 * circle; on Save the browser re-draws exactly that square as a new 256x256 PNG before anything is sent, and the
 * server checks and rebuilds it again.
 */
export default function AvatarDialog({ user, open, onClose }) {
  const titleId = useId()
  const inputRef = useRef(null)
  const index = useAvatarIndex()
  const save = useSetAvatar()
  const remove = useRemoveAvatar()
  const [source, setSource] = useState(null) // { image, width, height, url }
  const [crop, setCrop] = useState(START)
  const [problem, setProblem] = useState(null)
  const [failure, setFailure] = useState(null)
  const busy = save.isPending || remove.isPending
  const hasPhoto = Boolean(user && index.data?.[String(user.id)])

  // Each chosen photo's object URL and decoded pixels are released when it's replaced or the dialog goes away.
  useEffect(() => {
    if (!source) return undefined
    return () => {
      URL.revokeObjectURL(source.url)
      source.image.close?.()
    }
  }, [source])

  const close = () => {
    if (busy) return
    setSource(null)
    setProblem(null)
    setFailure(null)
    onClose()
  }

  const choose = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    setFailure(null)
    const reason = sourceProblem(file)
    if (reason) { setProblem(reason); return }
    try {
      const decoded = await decodeImage(file)
      setProblem(null)
      setCrop(START)
      setSource({ ...decoded, url: URL.createObjectURL(file) })
    } catch (err) {
      setProblem(err.message)
    }
  }

  const onSave = async () => {
    setFailure(null)
    let blob
    try {
      const natural = { width: source.width, height: source.height }
      blob = await renderAvatarPng(source.image, cropRectFor(crop.zoom, crop.offset, natural))
    } catch (err) {
      setProblem(err.message)
      return
    }
    setProblem(null)
    try {
      await save.mutateAsync(await blobToBase64(blob))
      close()
    } catch (err) { setFailure(err) }
  }

  const onRemove = async () => {
    setFailure(null)
    try {
      await remove.mutateAsync()
      close()
    } catch (err) { setFailure(err) }
  }

  return (
    <Dialog open={open} onClose={close} aria-labelledby={titleId} maxWidth="xs" fullWidth>
      <DialogTitle id={titleId}>Profile photo</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, alignItems: 'center', pt: 1 }}>
          {source ? (
            <CropEditor src={source.url} natural={{ width: source.width, height: source.height }} value={crop}
              onChange={setCrop} />
          ) : (
            <UserAvatar userId={user?.id} name={fullName(user)} size={128} label="Your current photo" />
          )}
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            PNG, JPEG or WebP. You choose the circle and we save a clean copy, without the photo&apos;s hidden details
            such as location.
          </Typography>
          <input ref={inputRef} type="file" accept={ACCEPTED_TYPES.join(',')} hidden onChange={choose}
            data-testid="avatar-file" aria-label="Photo file" />
          <Button variant="outlined" startIcon={<PhotoCamera />} onClick={() => inputRef.current?.click()} disabled={busy}>
            {source || hasPhoto ? 'Choose a different photo' : 'Choose a photo'}
          </Button>
          {problem ? <Alert severity="warning" role="alert" sx={{ width: '100%' }}>{problem}</Alert> : null}
          <ErrorAlert error={failure} sx={{ width: '100%' }} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {hasPhoto && !source ? (
          <Button color="error" onClick={onRemove} disabled={busy} sx={{ mr: 'auto' }}>Remove photo</Button>
        ) : null}
        <Button onClick={close} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={onSave} disabled={!source || busy}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}
