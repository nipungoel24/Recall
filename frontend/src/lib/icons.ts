/**
 * Recall Icon Registry
 *
 * Central ownership layer for icons.
 * - Lucide: standard static/action icons (default)
 * - Morphicons: state-transition icons (Play/Pause, Mic/Stop, etc.)
 * - TheSVG: brand/provider marks only
 *
 * Standard sizes: 16, 18, 20, 24
 */

import {
  // Navigation
  Home, Calendar, Settings, Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  // Actions
  Plus, Trash2, Copy, Download, Upload, RefreshCw, Save, Pencil, ExternalLink,
  // Status
  AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2,
  // Media
  Mic, Play, Pause, Square, Volume2, FileAudio,
  // Content
  FileText, File, StickyNote, NotebookPen, Layers, LayoutList, LayoutTemplate,
  // Communication
  Globe, Users, Tag, Clock, BrainCircuit, Sparkles,
  // UI
  X, Eye, EyeOff, Lock, Unlock, Database, Cpu, HardDrive,
  // Sidebar
  Sun, Moon, Monitor,
  // Misc
  FlaskConical, FolderOpen, FolderPlus, Clipboard, Pin, BadgeAlert, ArrowLeft, ArrowRight,
  ArrowUpRight, ChevronsUpDown, Check, Circle, ChevronRight as ChevronRightIcon,
  type LucideIcon,
} from 'lucide-react'

export type IconSize = 16 | 18 | 20 | 24

export const iconSizes: Record<IconSize, string> = {
  16: 'h-4 w-4',
  18: 'h-[18px] w-[18px]',
  20: 'h-5 w-5',
  24: 'h-6 w-6',
}

// Re-export commonly used icons for convenience
export {
  Home, Calendar, Settings, Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Plus, Trash2, Copy, Download, Upload, RefreshCw, Save, Pencil, ExternalLink,
  AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2,
  Mic, Play, Pause, Square, Volume2, FileAudio,
  FileText, File, StickyNote, NotebookPen, Layers, LayoutList, LayoutTemplate,
  Globe, Users, Tag, Clock, BrainCircuit, Sparkles,
  X, Eye, EyeOff, Lock, Unlock, Database, Cpu, HardDrive,
  Sun, Moon, Monitor,
  FlaskConical, FolderOpen, FolderPlus, Clipboard, Pin, BadgeAlert, ArrowLeft, ArrowRight,
  ArrowUpRight, ChevronsUpDown, Check, Circle,
}

export type { LucideIcon }
