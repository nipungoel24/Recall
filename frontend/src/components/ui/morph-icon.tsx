'use client'

/**
 * Recall MorphIcon integration
 *
 * Uses morphicons for meaningful state transitions.
 * Accepts Lucide React icon components and converts them to MorphIcon-compatible data.
 *
 * Approved use cases:
 *   Play ↔ Pause, Mic ↔ Stop, Menu ↔ Close, Expand ↔ Collapse,
 *   Sun ↔ Moon, Search ↔ Close, Panel open ↔ Panel closed
 */

import { forwardRef, useImperativeHandle, useRef } from 'react'
import { MorphIcon, type MorphIconProps, type MorphHandle, type SpringPreset, type IconNode } from 'morphicons/react'
import { icons } from 'lucide'
import type { LucideIcon } from 'lucide-react'

export interface RecallMorphIconProps extends Omit<MorphIconProps, 'from' | 'to' | 'icon'> {
  /** Current Lucide icon component (uncontrolled) */
  icon?: LucideIcon
  /** Source icon for controlled morphing */
  from?: LucideIcon
  /** Target icon for controlled morphing */
  to?: LucideIcon
  /** Spring physics preset */
  spring?: SpringPreset
  /** Reduced motion: "user" honors OS preference */
  reducedMotion?: 'never' | 'user' | 'always'
}

/**
 * Convert a Lucide React icon component to a MorphIcon-compatible IconNode.
 *
 * The lucide data package exports icons as IconNode-compatible structures
 * ([tag, attrs] lists). We look up by PascalCase name.
 */
function lucideIconToNode(icon: LucideIcon): IconNode | undefined {
  const iconName = icon.displayName || icon.name
  if (!iconName) return undefined
  // Lucide data package uses PascalCase keys (e.g. "Sun", "Moon", "Monitor")
  const key = iconName.replace(/-/g, '')
  const node = (icons as Record<string, IconNode>)[key]
  return node
}

/**
 * Animated icon for state transitions.
 *
 * Usage:
 *   <RecallMorphIcon icon={isPlaying ? Pause : Play} label={isPlaying ? 'Pause' : 'Play'} />
 */
export const RecallMorphIcon = forwardRef<MorphHandle, RecallMorphIconProps>(
  ({ icon, from, to, spring = 'snappy', reducedMotion = 'user', size = 20, label, ...props }, ref) => {
    const innerRef = useRef<MorphHandle>(null)

    useImperativeHandle(ref, () => ({
      morphTo: (targetIcon, springOrOpts) => innerRef.current?.morphTo(targetIcon, springOrOpts),
      set: (targetIcon) => innerRef.current?.set(targetIcon),
    }))

    // Convert Lucide components to MorphIcon-compatible IconInput
    const fromNode = from ? lucideIconToNode(from) : undefined
    const toNode = to ? lucideIconToNode(to) : undefined
    const iconNode = icon ? lucideIconToNode(icon) : undefined

    // If we have controlled from/to, use controlled mode
    if (fromNode && toNode) {
      return (
        <MorphIcon
          ref={innerRef}
          from={fromNode}
          to={toNode}
          spring={spring}
          reducedMotion={reducedMotion}
          size={size}
          label={label}
          {...props}
        />
      )
    }

    // Uncontrolled mode with a single icon
    return (
      <MorphIcon
        ref={innerRef}
        icon={iconNode}
        spring={spring}
        reducedMotion={reducedMotion}
        size={size}
        label={label}
        {...props}
      />
    )
  }
)

RecallMorphIcon.displayName = 'RecallMorphIcon'
