import React, { createContext, useContext, useState, useEffect } from 'react'
import '../styles/themes/dark.css'
import '../styles/themes/light.css'
import '../styles/themes/high-contrast.css'

type Theme = 'dark' | 'light' | 'high-contrast'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [theme, setThemeState] = useState<Theme>('dark')

  useEffect(() => {
    // Load saved theme from settings on mount
    window.settings.get('appearance.theme').then((saved) => {
      if (saved === 'dark' || saved === 'light' || saved === 'high-contrast') {
        setThemeState(saved)
      }
    }).catch(() => {/* ignore */})
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const setTheme = (t: Theme): void => {
    setThemeState(t)
  }

  const toggleTheme = (): void => {
    setThemeState((prev) => {
      if (prev === 'dark') return 'light'
      if (prev === 'light') return 'high-contrast'
      return 'dark'
    })
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
