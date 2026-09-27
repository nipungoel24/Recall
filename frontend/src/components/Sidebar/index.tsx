'use client';

/**
 * Recall sidebar.
 *
 * A2 rebuilds this as a composition of small, predictable parts:
 *
 *   nav
 *    ├── header   Recall identity · search · collapse control
 *    ├── nav      Primary / Knowledge / System, from lib/nav.ts
 *    └── footer   Start Recording (primary) · Import Audio · About
 *
 * Design decisions that matter:
 *
 * - The meeting archive is GONE from here. It lives at /meetings, which has
 *   the room to be a real library. The sidebar answers "where am I going?".
 * - One navigation model (lib/nav.ts) and one row primitive (ui/list-row.tsx).
 *   Expanded and collapsed are the same tree rendered two ways, not two
 *   hand-maintained lists — which is what the old 1174-line file was.
 * - Exactly ONE recording control, in the footer, in both modes. The old file
 *   had three, with two opposite active/idle polarities.
 * - The collapse control lives INSIDE the panel. It used to be a sibling
 *   floating over the main workspace on an absolute offset.
 * - The nav region is the only scrollable area, and the footer is a
 *   non-shrinking sibling. That is what keeps the footer reachable in a short
 *   window; previously the nav pushed the archive and footer below the fold.
 * - Nothing here clicks a coordinate or starts a recording on render.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Mic, PanelLeftClose, PanelLeftOpen, Search, Square, Upload, X } from 'lucide-react';

import { ListRow } from '@/components/ui/list-row';
import { NavSection } from '@/components/ui/nav-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useSidebar } from './SidebarProvider';
import { NAV_GROUPS, isNavItemActive } from '@/lib/nav';
import { routes } from '@/lib/routes';
import { sidebarWidth } from '@/lib/sidebar-layout';
import { cn } from '@/lib/utils';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useConfig } from '@/contexts/ConfigContext';
import Logo from '../Logo';
import Info from '../Info';

const SEARCH_DEBOUNCE_MS = 250;

const Sidebar: React.FC = () => {
  const {
    isCollapsed,
    toggleCollapse,
    searchTranscripts,
    isSearching,
    handleRecordingToggle,
    searchQuery,
    setSearchQuery,
  } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const { isRecording } = useRecordingState();
  const { openImportDialog } = useImportDialog();
  const { betaFeatures } = useConfig();

  const searchRef = useRef<HTMLInputElement>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  /*
   * Ctrl/Cmd+K from the collapsed rail has to expand the panel before it can
   * focus a field that does not exist yet. A pending flag plus an effect is used
   * rather than a timeout, so focus happens when the panel has actually
   * mounted instead of after a guessed delay.
   */
  const [pendingSearchFocus, setPendingSearchFocus] = useState(false);

  useEffect(() => {
    if (pendingSearchFocus && !isCollapsed) {
      searchRef.current?.focus();
      setPendingSearchFocus(false);
    }
  }, [pendingSearchFocus, isCollapsed]);

  // Ctrl/Cmd+K focuses search, expanding the sidebar first if the rail is
  // showing, because a collapsed rail has no visible field to focus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (isCollapsed) {
          setPendingSearchFocus(true);
          toggleCollapse();
        } else {
          searchRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCollapsed, toggleCollapse]);

  useEffect(
    () => () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    },
    [],
  );

  /**
   * Search is a route, not a sidebar list. Typing filters meetings and takes
   * the user to /meetings, which is the one surface that renders results. This
   * keeps the sidebar a navigation surface and avoids a second result list.
   */
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (searchDebounce.current) {
        clearTimeout(searchDebounce.current);
        searchDebounce.current = null;
      }
      if (!value.trim()) return;

      searchDebounce.current = setTimeout(() => {
        searchDebounce.current = null;
        searchTranscripts(value);
        if (pathname !== '/meetings') router.push(routes.meetings());
      }, SEARCH_DEBOUNCE_MS);
    },
    [pathname, router, searchTranscripts, setSearchQuery],
  );

  const focusSearch = useCallback(() => searchRef.current?.focus(), []);

  /**
   * The single recording entry point in the sidebar. The provider owns the
   * start/navigate behaviour; this only forwards it, so collapsed and expanded
   * cannot diverge.
   */
  const startRecording = useCallback(() => {
    handleRecordingToggle();
  }, [handleRecordingToggle]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    if (searchDebounce.current) {
      clearTimeout(searchDebounce.current);
      searchDebounce.current = null;
    }
    focusSearch();
  }, [focusSearch]);

  return (
    <div
      className="fixed left-0 top-0 z-40 h-dvh"
      // Width comes from lib/sidebar-layout.ts, the single shared source.
      style={{ width: sidebarWidth(isCollapsed) }}
    >
      <nav
        aria-label="Primary"
        data-slot="sidebar"
        className="flex h-full flex-col border-r border-border bg-surface"
      >
        {/* ── Header: identity, search, collapse ───────────────────────── */}
        <header
          data-slot="sidebar-header"
          className="flex flex-shrink-0 flex-col gap-2 border-b border-border p-2"
        >
          {/* Row 1: identity and the collapse control. Row 2: search. Keeping
              search on its own row gives the field the panel's full width —
              sharing one row with the wordmark left it unusably narrow. */}
          <div className={cn('flex gap-1', isCollapsed ? 'flex-col items-center' : 'items-center')}>
            <Logo isCollapsed={isCollapsed} />

            <div
              className={cn(
                'flex gap-1',
                isCollapsed ? 'flex-col items-center' : 'ml-auto items-center',
              )}
            >
              <ListRow
                as="button"
                collapsed={isCollapsed}
                icon={isCollapsed ? PanelLeftOpen : PanelLeftClose}
                label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                tooltip={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={toggleCollapse}
                aria-expanded={!isCollapsed}
                aria-controls="recall-sidebar-navigation"
                className={cn(isCollapsed ? '' : 'h-9 w-9 shrink-0 justify-center')}
              />
            </div>
          </div>

          {isCollapsed ? (
            <ListRow
              as="button"
              collapsed
              icon={Search}
              label="Search meetings"
              tooltip="Search meetings"
              onClick={focusSearch}
            />
          ) : (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                ref={searchRef}
                value={searchQuery}
                onChange={(event) => handleSearchChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    clearSearch();
                  }
                }}
                placeholder="Search meetings"
                aria-label="Search meetings"
                className="h-9 pl-8 pr-8"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          )}
        </header>

        {/* ── Navigation: the only scrollable region ───────────────────── */}
        <div
          id="recall-sidebar-navigation"
          data-slot="sidebar-nav"
          className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-1 pb-2"
        >
          {NAV_GROUPS.map((group, index) =>
            isCollapsed ? (
              // Collapsed: the same items as icon-only rows, separated by a quiet
              // rule instead of a word the rail cannot show. The destinations
              // must not disappear just because the panel got narrow.
              <React.Fragment key={group.id}>
                {index > 0 ? (
                  <div
                    aria-hidden="true"
                    data-slot="sidebar-group-divider"
                    className="mx-2 border-t border-border"
                  />
                ) : null}
                <div className="flex flex-col gap-0.5" data-slot="sidebar-group-items">
                  {group.items.map((item) => (
                    <ListRow
                      key={item.id}
                      as="a"
                      href={item.href}
                      icon={item.icon}
                      label={item.label}
                      tooltip={item.label}
                      collapsed
                      active={isNavItemActive(item, pathname)}
                    />
                  ))}
                </div>
              </React.Fragment>
            ) : (
              <NavSection key={group.id} label={group.label} flush={index === 0}>
                {group.items.map((item) => (
                  <ListRow
                    key={item.id}
                    as="a"
                    href={item.href}
                    icon={item.icon}
                    label={item.label}
                    active={isNavItemActive(item, pathname)}
                  />
                ))}
              </NavSection>
            ),
          )}

          {isSearching && !isCollapsed ? (
            <p
              role="status"
              aria-live="polite"
              className="px-4 pt-2 text-caption text-muted-foreground"
            >
              Searching meeting transcripts…
            </p>
          ) : null}
        </div>

        {/* ── Footer: actions and identity, never scrolled away ─────────── */}
        <footer
          data-slot="sidebar-footer"
          className="flex flex-shrink-0 flex-col gap-1 border-t border-border p-2"
        >
          {isRecording ? (
            <div
              role="status"
              aria-live="polite"
              className={cn(
                'flex h-9 items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 text-sm text-destructive',
                isCollapsed && 'w-9 justify-center px-0',
              )}
            >
              <Square className="h-4 w-4 shrink-0" aria-hidden="true" />
              {isCollapsed ? null : <span className="truncate">Recording in progress</span>}
              <span className="sr-only">Recording in progress</span>
            </div>
          ) : isCollapsed ? (
            <ListRow
              as="button"
              collapsed
              icon={Mic}
              label="Start Recording"
              tooltip="Start Recording"
              onClick={startRecording}
              data-start-recording="true"
            />
          ) : (
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              onClick={startRecording}
              data-start-recording="true"
            >
              <Mic className="h-4 w-4" aria-hidden="true" />
              Start Recording
            </Button>
          )}

          {betaFeatures.importAndRetranscribe ? (
            <ListRow
              as="button"
              collapsed={isCollapsed}
              icon={Upload}
              label="Import Audio"
              tooltip="Import Audio"
              onClick={() => openImportDialog()}
            />
          ) : null}

          <div className={cn('flex gap-1', isCollapsed ? 'flex-col items-center' : 'items-center')}>
            <Info isCollapsed={isCollapsed} />
          </div>
        </footer>
      </nav>
    </div>
  );
};

export default Sidebar;
