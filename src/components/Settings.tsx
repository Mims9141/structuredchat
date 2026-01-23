import { useState, useEffect } from 'react'

const STORAGE_KEY = 'soundEffects'
const DEFAULT_VALUE = 'on'

function getSoundEffects(): 'on' | 'off' {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return (stored === 'on' || stored === 'off') ? stored : DEFAULT_VALUE
  } catch {
    return DEFAULT_VALUE
  }
}

function setSoundEffects(value: 'on' | 'off'): void {
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // ignore
  }
}

export default function Settings() {
  const [soundEffects, setSoundEffectsState] = useState<'on' | 'off'>(() => getSoundEffects())

  useEffect(() => {
    setSoundEffects(soundEffects)
  }, [soundEffects])

  const toggleSoundEffects = () => {
    setSoundEffectsState(prev => prev === 'on' ? 'off' : 'on')
  }

  return (
    <div style={{ marginTop: '1rem', textAlign: 'center' }}>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.8)' }}>
        <input
          type="checkbox"
          checked={soundEffects === 'on'}
          onChange={toggleSoundEffects}
          style={{ cursor: 'pointer' }}
        />
        Sound effects
      </label>
    </div>
  )
}
