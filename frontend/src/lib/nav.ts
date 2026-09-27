/**
 * Canonical Recall navigation model.
 *
 * This is the single source of truth for *where navigation can take you*. The
 * sidebar consumes it; nothing else may define a competing list.
 *
 * Scope — what belongs here and what does not:
 *
 *   NAVIGATION (here)   destinations the user can be *at*
 *   ACTIONS (not here)  Start Recording, Import Audio — they perform work
 *   UTILITY  (not here) About — an identity surface, reached from the brand
 *
 * Grouping and terminology follow `PRD.md` ("Core Product Areas" and the
 * Meetings/Home/Daily functional requirements). `Meetings` is the PRD's own
 * term for the meeting archive.
 *
 * This module is data only. It contains no JSX and no rendering logic, so the
 * nav model cannot drift into a second, view-specific navigation system.
 */

import {
  CalendarDays,
  Home,
  LayoutList,
  LayoutTemplate,
  Library,
  NotebookPen,
  Settings,
  Sun,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { routes } from '@/lib/routes';

/** Ordered navigation groups, as they should appear in the sidebar. */
export type NavGroupId = 'primary' | 'knowledge' | 'system';

export type NavItemId =
  | 'home'
  | 'meetings'
  | 'calendar'
  | 'daily'
  | 'contexts'
  | 'templates'
  | 'notes'
  | 'settings';

export interface NavItem {
  readonly id: NavItemId;
  /** Visible label. Also the accessible name in collapsed/icon-only mode. */
  readonly label: string;
  /** Resolved through `lib/routes.ts` — never a hand-built route string. */
  readonly href: string;
  readonly icon: LucideIcon;
  /**
   * Path prefixes that mark this item as the current destination. A prefix
   * matches its own path and any nested path beneath it, so `/context` stays
   * active for `/context?id=…`.
   */
  readonly activePrefixes: readonly string[];
}

export interface NavGroup {
  readonly id: NavGroupId;
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'primary',
    label: 'Meetings',
    items: [
      {
        id: 'home',
        label: 'Home',
        href: routes.home(),
        icon: Home,
        activePrefixes: ['/'],
      },
      {
        id: 'meetings',
        label: 'Meetings',
        href: routes.meetings(),
        icon: Library,
        activePrefixes: ['/meetings'],
      },
      {
        id: 'calendar',
        label: 'Calendar',
        href: routes.calendar(),
        icon: CalendarDays,
        activePrefixes: ['/calendar'],
      },
      {
        id: 'daily',
        label: 'Daily',
        href: routes.daily(),
        icon: Sun,
        activePrefixes: ['/daily'],
      },
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    items: [
      {
        id: 'contexts',
        label: 'Contexts',
        href: routes.contexts(),
        icon: LayoutList,
        activePrefixes: ['/context'],
      },
      {
        id: 'templates',
        label: 'Templates',
        href: routes.templates(),
        icon: LayoutTemplate,
        activePrefixes: ['/templates'],
      },
      {
        id: 'notes',
        label: 'Meeting Notes',
        href: routes.notes(),
        icon: NotebookPen,
        activePrefixes: ['/notes'],
      },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      {
        id: 'settings',
        label: 'Settings',
        href: routes.settings(),
        icon: Settings,
        activePrefixes: ['/settings'],
      },
    ],
  },
];

/** Flattened view of every navigation destination, in sidebar order. */
export const NAV_ITEMS: readonly NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function findNavItem(id: NavItemId): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.id === id);
}

/**
 * Whether a nav item represents the current location.
 *
 * Matching is exact-or-descendant, never a bare `startsWith`, so `/` does not
 * swallow `/settings` and `/context` does not swallow an unrelated `/contacts`.
 */
export function isNavItemActive(item: NavItem, pathname: string | null): boolean {
  if (!pathname) return false;
  return item.activePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
