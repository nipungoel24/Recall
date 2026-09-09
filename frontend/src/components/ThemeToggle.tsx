'use client'

import { useTheme } from '@/contexts/ThemeContext'
import { Sun, Moon, Monitor } from 'lucide-react'
import { RecallMorphIcon } from '@/components/ui/morph-icon'
import { Button } from '@/components/ui/button'

const themeIcons = { system: Monitor, light: Sun, dark: Moon } as const
const themeLabels = { system: 'System', light: 'Light', dark: 'Dark' } as const

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  const cycle = () => {
    if (theme === 'system') setTheme('light')
    else if (theme === 'light') setTheme('dark')
    else setTheme('system')
  }

  const Icon = themeIcons[theme]

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={cycle}
      aria-label={`Theme: ${themeLabels[theme]}. Click to cycle.`}
      title={`Theme: ${themeLabels[theme]}`}
    >
      <RecallMorphIcon
        icon={Icon}
        size={16}
        spring="snappy"
        reducedMotion="user"
        label=""
      />
    </Button>
  )
}
