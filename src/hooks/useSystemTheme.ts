import { useEffect, useState } from 'react'

export type AppTheme = 'light' | 'dark'

export function useSystemTheme(): AppTheme {
  const [theme, setTheme] = useState<AppTheme>(() => getTheme())

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateTheme = (event: MediaQueryListEvent) => setTheme(event.matches ? 'dark' : 'light')
    media.addEventListener('change', updateTheme)
    return () => media.removeEventListener('change', updateTheme)
  }, [])

  return theme
}

function getTheme(): AppTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
