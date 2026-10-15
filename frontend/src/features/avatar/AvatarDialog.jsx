import PhotoCamera from '@mui/icons-material/PhotoCameraOutlined'
import {
  Alert, Avatar, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography,
} from '@mui/material'
import { useEffect, useId, useRef, useState } from 'react'
import { useAvatarIndex, useRemoveAvatar, useSetAvatar } from '../../api/queries.js'
import ErrorAlert from '../../components/ErrorAlert.jsx'
import UserAvatar from '../../components/UserAvatar.jsx'
import { fullName } from '../../lib/format.js'
import { ACCEPTED_TYPES, blobToBase64, cropToSquarePng, sourceProblem } from '../../lib/avatarImage.js'

/**
 * Choose, preview and save your own profile photo (every role). The browser crops and re-draws the photo as a
 * new 256x256 PNG before anything is sent; the server checks and rebuilds it again.
 */
export default function AvatarDialog({ user, open, onClose }) {
  const titleId = useId()
  const inputRef = useRef(null)
  const index = useAvatarIndex()
  const save = useSetAvatar()
  const remove = useRemoveAvatar()
  const [preview, setPreview] = useState(null) // { blob, url }
  const [problem, setProblem] = useState(null)
  const [failure, setFailure] = useState(null)
  const busy = save.isPending || remove.isPending
  const hasPhoto = Boolean(user && index.data?.[String(user.id)])

  // Each preview's object URL is released when it's replaced or the dialog goes away.
  useEffect(() => {
    if (!preview) return undefined
    return () => URL.revokeObjectURL(preview.url)
  }, [preview])

  const close = () => {
    if (busy) return
    setPreview(null)
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
      const blob = await cropToSquarePng(file)
      setProblem(null)
      setPreview({ blob, url: URL.createObjectURL(blob) })
    } catch (err) {
      setProblem(err.message)
    }
  }

  const onSave = async () => {
    setFailure(null)
    try {
      await save.mutateAsync(await blobToBase64(preview.blob))
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
          {preview ? (
            <Avatar src={preview.url} alt="Preview of your new photo" sx={{ width: 128, height: 128 }} />
          ) : (
            <UserAvatar userId={user?.id} name={fullName(user)} size={128} label="Your current photo" />
          )}
          <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>
            PNG, JPEG or WebP. We crop it to a square and save a clean copy, without the photo&apos;s hidden details
            such as location.
          </Typography>
          <input ref={inputRef} type="file" accept={ACCEPTED_TYPES.join(',')} hidden onChange={choose}
            data-testid="avatar-file" aria-label="Photo file" />
          <Button variant="outlined" startIcon={<PhotoCamera />} onClick={() => inputRef.current?.click()} disabled={busy}>
            {preview || hasPhoto ? 'Choose a different photo' : 'Choose a photo'}
          </Button>
          {problem ? <Alert severity="warning" role="alert" sx={{ width: '100%' }}>{problem}</Alert> : null}
          <ErrorAlert error={failure} sx={{ width: '100%' }} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {hasPhoto && !preview ? (
          <Button color="error" onClick={onRemove} disabled={busy} sx={{ mr: 'auto' }}>Remove photo</Button>
        ) : null}
        <Button onClick={close} disabled={busy}>Cancel</Button>
        <Button variant="contained" onClick={onSave} disabled={!preview || busy}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}
