/**
 * Sidebar layout — single source of truth for sidebar width.
 *
 * The width is declared once, as CSS custom properties in
 * `src/app/globals.css`:
 *
 *   --recall-sidebar-width-expanded   16rem
 *   --recall-sidebar-width-collapsed   4rem
 *
 * Every consumer (the sidebar panel, the `MainContent` offset, the fixed
 * status/recording overlays) resolves through `sidebarWidth()` so a change to
 * one variable moves all of them together. Previously the same two numbers
 * were restated four times — `w-16`/`w-64`, `ml-16`/`ml-64`, and two inline
 * `4rem`/`16rem` styles — which is how they drifted.
 */

/** Raw custom-property references. Prefer `sidebarWidth()` over these. */
export const SIDEBAR_WIDTH = {
  expanded: 'var(--recall-sidebar-width-expanded)',
  collapsed: 'var(--recall-sidebar-width-collapsed)',
} as const;

export type SidebarWidthToken = (typeof SIDEBAR_WIDTH)[keyof typeof SIDEBAR_WIDTH];

/** The width the sidebar occupies in the given state. */
export function sidebarWidth(isCollapsed: boolean): SidebarWidthToken {
  return isCollapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded;
}
