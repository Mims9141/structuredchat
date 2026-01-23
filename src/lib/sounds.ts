let matchSound: HTMLAudioElement | null = null
let isInitialized = false
let lastPlayTime = 0
const THROTTLE_MS = 2000

const STORAGE_KEY = 'soundEffects'
const DEFAULT_VALUE = 'on'

function getSoundEffectsEnabled(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? DEFAULT_VALUE === 'on' : stored === 'on'
  } catch {
    return DEFAULT_VALUE === 'on'
  }
}

export function initSounds(): void {
  if (isInitialized) {
    console.log('Sounds already initialized')
    return
  }
  
  try {
    const soundPath = '/sounds/match.mp3'
    console.log('Initializing sound from:', soundPath)
    matchSound = new Audio(soundPath)
    matchSound.preload = 'auto'
    matchSound.volume = 0.25
    
    matchSound.addEventListener('error', (e) => {
      console.error('Match sound load error:', e, matchSound?.error)
    })
    
    matchSound.addEventListener('canplaythrough', () => {
      console.log('Match sound ready to play')
    })
    
    matchSound.addEventListener('loadeddata', () => {
      console.log('Match sound data loaded')
    })
    
    isInitialized = true
    console.log('Sounds initialized, ready state:', matchSound.readyState)
  } catch (err) {
    console.warn('Failed to initialize match sound:', err)
  }
}

export function playMatchSound(): void {
  console.log('playMatchSound called', { 
    enabled: getSoundEffectsEnabled(), 
    hidden: document.hidden, 
    initialized: isInitialized 
  })
  
  if (!getSoundEffectsEnabled()) {
    console.log('Sound effects disabled')
    return
  }
  if (document.hidden) {
    console.log('Document hidden, skipping sound')
    return
  }
  
  const now = Date.now()
  if (now - lastPlayTime < THROTTLE_MS) {
    console.log('Sound throttled')
    return
  }
  
  if (!isInitialized) {
    console.log('Initializing sounds on demand')
    initSounds()
  }
  
  if (!matchSound) {
    console.warn('Match sound not available')
    return
  }
  
  try {
    matchSound.currentTime = 0
    const playPromise = matchSound.play()
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          console.log('Match sound played successfully')
        })
        .catch((err) => {
          console.warn('Failed to play match sound:', err)
        })
    }
    lastPlayTime = now
  } catch (err) {
    console.warn('Error playing match sound:', err)
  }
}
