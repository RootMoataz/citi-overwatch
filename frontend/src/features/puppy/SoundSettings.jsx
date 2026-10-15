import PlayArrow from '@mui/icons-material/PlayArrowRounded'
import VolumeDown from '@mui/icons-material/VolumeDownRounded'
import VolumeUp from '@mui/icons-material/VolumeUpRounded'
import {
  Box, FormControl, FormControlLabel, FormLabel, IconButton, Radio, RadioGroup, Slider, Stack, Switch, Tooltip, Typography,
} from '@mui/material'
import { useId } from 'react'
import { playSound, unlockAudio } from './audio.js'
import { SOUNDS } from './soundSettings.js'

/** The Sound tab: which sound plays for a new notification (each with a preview), how loud, and when. */
export default function SoundSettings({ settings, onChange }) {
  const labelId = useId()
  const volumeId = useId()
  const set = (patch) => onChange({ ...settings, ...patch })
  // A preview is a click, so it may also be the interaction that unlocks sound for the page.
  const preview = (sound) => {
    unlockAudio()
    playSound(sound, settings.volume || 0.6)
  }
  return (
    <Stack sx={{ gap: 2 }}>
      <FormControl>
        <FormLabel id={labelId} sx={{ typography: 'subtitle2', color: 'text.primary', mb: 0.5 }}>New notification sound</FormLabel>
        <RadioGroup aria-labelledby={labelId} value={settings.sound} onChange={(e) => set({ sound: e.target.value })}>
          {SOUNDS.map((s) => (
            <Stack key={s.value} direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <FormControlLabel value={s.value} control={<Radio size="small" />} label={s.label} />
              {s.value !== 'none' ? (
                <Tooltip title="Preview">
                  <IconButton size="small" aria-label={`Preview ${s.label}`} onClick={() => preview(s.value)}>
                    <PlayArrow fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : null}
            </Stack>
          ))}
        </RadioGroup>
      </FormControl>
      <Box>
        <Typography id={volumeId} variant="subtitle2">Volume</Typography>
        <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', px: 0.5 }}>
          <VolumeDown fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />
          <Slider size="small" min={0} max={100} step={10} value={Math.round(settings.volume * 100)}
            disabled={settings.muted} aria-labelledby={volumeId} getAriaValueText={(v) => `${v}%`}
            onChange={(_, v) => set({ volume: v / 100 })} />
          <VolumeUp fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />
        </Stack>
      </Box>
      <Stack>
        <FormControlLabel label="Mute Puppy"
          control={<Switch checked={settings.muted} onChange={(e) => set({ muted: e.target.checked })} />} />
        <FormControlLabel label="Only when the tab is in the background"
          control={<Switch checked={settings.backgroundOnly} onChange={(e) => set({ backgroundOnly: e.target.checked })} />} />
        <FormControlLabel label="Show the count in the tab title"
          control={<Switch checked={settings.titleBadge} onChange={(e) => set({ titleBadge: e.target.checked })} />} />
      </Stack>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Sounds are made in your browser and kept to one every 5 seconds. A toast and the badge always show new
        notifications too. These choices are saved in this browser only.
      </Typography>
    </Stack>
  )
}
