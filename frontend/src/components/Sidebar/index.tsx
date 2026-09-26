'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, File, Settings, ChevronLeftCircle, ChevronRightCircle, Calendar, CalendarDays, StickyNote, Home, Trash2, Mic, Square, Plus, Search, Pencil, NotebookPen, SearchIcon, X, Upload, LayoutList, LayoutTemplate, Sun } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useSidebar } from './SidebarProvider';
import type { CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import { ConfirmationModal } from '../ConfirmationModel/confirmation-modal';
  import { ModelConfig } from '@/components/ModelSettingsModal';
  import { SettingTabs } from '../SettingTabs';
  import { TranscriptModelProps } from '@/components/TranscriptSettings';
  import { invoke } from '@tauri-apps/api/core';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useConfig } from '@/contexts/ConfigContext';
import { configService } from '@/services/configService';
import { localDateKey } from '@/lib/calendar';
import { routes } from '@/lib/routes';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"

import { MessageToast } from '../MessageToast';
import Logo from '../Logo';
import Info from '../Info';
import { ComplianceNotification } from '../ComplianceNotification';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../ui/input-group';

interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  created_at?: string;
  children?: SidebarItem[];
}

interface HistoryGroup {
  label: string;
  items: SidebarItem[];
}

/**
 * Bucket meeting history items into Today / Yesterday / Earlier based on
 * their LOCAL calendar day (created_at is a UTC instant, converted locally).
 */
const groupChildrenByHistory = (children: SidebarItem[]): HistoryGroup[] => {
  const today = new Date();
  const todayKey = localDateKey(today);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const yesterdayKey = localDateKey(yesterday);

  const groups: HistoryGroup[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Earlier', items: [] },
  ];

  for (const child of children) {
    if (child.type !== 'file') continue;
    let bucketIndex = 2; // Earlier by default (e.g. missing created_at)
    if (child.created_at) {
      const key = localDateKey(new Date(child.created_at));
      if (key === todayKey) bucketIndex = 0;
      else if (key === yesterdayKey) bucketIndex = 1;
    }
    groups[bucketIndex].items.push(child);
  }

  return groups.filter(group => group.items.length > 0);
};

/*
 * Sidebar row system.
 *
 * Every navigable row in the sidebar is built from these tokens so that height,
 * icon box, text baseline, inset, hover and focus are identical everywhere.
 * A row that is defined inline drifts; a row that is derived from one constant
 * cannot. Active state is a restrained accent wash plus a 2px accent bar
 * (absolutely positioned, so activating a row never shifts the layout).
 */
const ROW_BASE =
  'group/row relative flex w-full items-center gap-2.5 rounded-md text-sm ' +
  'transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-ring';

const ROW_IDLE = 'text-foreground hover:bg-muted';
const ROW_ACTIVE = 'bg-accent/20 text-foreground font-medium';

/** Height of a primary navigation row. */
const ROW_H = 'h-9';

/** Height of a footer utility row — deliberately smaller than navigation. */
const ROW_H_UTILITY = 'h-8';

const SECTION_LABEL = 'px-3 pt-5 pb-1.5 text-label text-muted-foreground';

/** The 2px marker that makes the active row unmistakable without a layout shift. */
const ACTIVE_BAR = (
  <span
    aria-hidden="true"
    className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r-sm bg-accent"
  />
);

const Sidebar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentMeeting,
    setCurrentMeeting,
    sidebarItems,
    isCollapsed,
    toggleCollapse,
    handleRecordingToggle,
    searchTranscripts,
    searchResults,
    isSearching,
    meetings,
    setMeetings,
    serverAddress
  } = useSidebar();

  // Get recording state from RecordingStateContext (single source of truth)
  const { isRecording } = useRecordingState();
  const { openImportDialog } = useImportDialog();
  const { betaFeatures } = useConfig();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['meetings']));
  const [searchQuery, setSearchQuery] = useState<string>('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [pendingSearchFocus, setPendingSearchFocus] = useState(false);
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: 'ollama',
    model: '',
    whisperModel: '',
    apiKey: null,
    ollamaEndpoint: null
  });
  const [transcriptModelConfig, setTranscriptModelConfig] = useState<TranscriptModelProps>({
    provider: 'parakeet',
    model: 'parakeet-tdt-0.6b-v3-int8',
  });
  const [settingsSaveSuccess, setSettingsSaveSuccess] = useState<boolean | null>(null);

  // State for edit modal
  const [editModalState, setEditModalState] = useState<{ isOpen: boolean; meetingId: string | null; currentTitle: string }>({
    isOpen: false,
    meetingId: null,
    currentTitle: ''
  });
  const [editingTitle, setEditingTitle] = useState<string>('');

  // Ensure 'meetings' folder is always expanded
  useEffect(() => {
    if (!expandedFolders.has('meetings')) {
      const newExpanded = new Set(expandedFolders);
      newExpanded.add('meetings');
      setExpandedFolders(newExpanded);
    }
  }, [expandedFolders]);

  // useEffect(() => {
  //   if (settingsSaveSuccess !== null) {
  //     const timer = setTimeout(() => {
  //       setSettingsSaveSuccess(null);
  //     }, 3000);
  //   }
  // }, [settingsSaveSuccess]);


  const [deleteModalState, setDeleteModalState] = useState<{ isOpen: boolean; itemId: string | null }>({ isOpen: false, itemId: null });

  useEffect(() => {
    // Note: Don't set hardcoded defaults - let DB be the source of truth
    const fetchModelConfig = async () => {
      // Only make API call if serverAddress is loaded
      if (!serverAddress) {
        console.log('Waiting for server address to load before fetching model config');
        return;
      }

      try {
        const data = await invoke('api_get_model_config') as any;
        if (data && data.provider !== null) {
          // Fetch API key if not included and provider requires it
          if (data.provider !== 'ollama' && !data.apiKey) {
            try {
              const apiKeyData = await configService.getApiKey(data.provider);
              data.apiKey = apiKeyData;
            } catch (err) {
              console.error('Failed to fetch API key:', err);
            }
          }
          setModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch model config:', error);
      }
    };

    fetchModelConfig();
  }, [serverAddress]);


  useEffect(() => {
    // Note: Don't set hardcoded defaults - let DB be the source of truth
    const fetchTranscriptSettings = async () => {
      // Only make API call if serverAddress is loaded
      if (!serverAddress) {
        console.log('Waiting for server address to load before fetching transcript settings');
        return;
      }

      try {
        const data = await invoke('api_get_transcript_config') as any;
        if (data && data.provider !== null) {
          setTranscriptModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch transcript settings:', error);
      }
    };
    fetchTranscriptSettings();
  }, [serverAddress]);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        console.log('Sidebar received model-config-updated event:', event.payload);
        setModelConfig(event.payload);
      });

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(fn => cleanup = fn);

    return () => {
      cleanup?.();
    };
  }, []);



  // Handle model config save
  const handleSaveModelConfig = async (config: ModelConfig) => {
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey,
        ollamaEndpoint: config.ollamaEndpoint,
      });

      setModelConfig(config);
      console.log('Model config saved successfully');
      setSettingsSaveSuccess(true);

      // Emit event to sync other components
      const { emit } = await import('@tauri-apps/api/event');
        await emit('model-config-updated', config);
      } catch (error) {
      console.error('Error saving model config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  const handleSaveTranscriptConfig = async (updatedConfig?: TranscriptModelProps) => {
    try {
      const configToSave = updatedConfig || transcriptModelConfig;
      const payload = {
        provider: configToSave.provider,
        model: configToSave.model,
        apiKey: configToSave.apiKey ?? null
      };
      console.log('Saving transcript config with payload:', payload);

      await invoke('api_save_transcript_config', {
        provider: payload.provider,
        model: payload.model,
        apiKey: payload.apiKey,
      });


      setSettingsSaveSuccess(true);

        // Track settings change
        const transcriptConfigToSave = updatedConfig || transcriptModelConfig;
      } catch (error) {
      console.error('Failed to save transcript config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  // Handle search input changes.
  // Title filtering is local and instant; the backend transcript search is
  // debounced so it only runs after the user pauses typing (and stale
  // responses are dropped by the provider's sequence guard).
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }

    // If search query is empty, just return to normal view
    if (!value.trim()) return;

    // Make sure the meetings folder is expanded when searching
    if (!expandedFolders.has('meetings')) {
      const newExpanded = new Set(expandedFolders);
      newExpanded.add('meetings');
      setExpandedFolders(newExpanded);
    }

    // Search through transcripts after a short typing pause
    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null;
      searchTranscripts(value);
    }, 300);
  }, [expandedFolders, searchTranscripts]);

  // Combine search results with sidebar items
  const filteredSidebarItems = useMemo(() => {
    if (!searchQuery.trim()) return sidebarItems;

    // If we have search results, highlight matching meetings
    if (searchResults.length > 0) {
      // Get the IDs of meetings that matched in transcripts
      const matchedMeetingIds = new Set(searchResults.map(result => result.id));

      return sidebarItems
        .map(folder => {
          // Always include folders in the results
          if (folder.type === 'folder') {
            if (!folder.children) return folder;

            // Filter children based on search results or title match
            const filteredChildren = folder.children.filter(item => {
              // Include if the meeting ID is in our search results
              if (matchedMeetingIds.has(item.id)) return true;

              // Or if the title matches the search query
              return item.title.toLowerCase().includes(searchQuery.toLowerCase());
            });

            return {
              ...folder,
              children: filteredChildren
            };
          }

          // For non-folder items, check if they match the search
          return (matchedMeetingIds.has(folder.id) ||
            folder.title.toLowerCase().includes(searchQuery.toLowerCase()))
            ? folder : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined); // Type-safe filter
    } else {
      // Fall back to title-only filtering if no transcript results
      return sidebarItems
        .map(folder => {
          // Always include folders in the results
          if (folder.type === 'folder') {
            if (!folder.children) return folder;

            // Filter children based on search query
            const filteredChildren = folder.children.filter(item =>
              item.title.toLowerCase().includes(searchQuery.toLowerCase())
            );

            return {
              ...folder,
              children: filteredChildren
            };
          }

          // For non-folder items, check if they match the search
          return folder.title.toLowerCase().includes(searchQuery.toLowerCase()) ? folder : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined); // Type-safe filter
    }
  }, [sidebarItems, searchQuery, searchResults, expandedFolders]);


  const handleDelete = async (itemId: string) => {
    console.log('Deleting item:', itemId);
    const payload = {
      meetingId: itemId
    };

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('api_delete_meeting', {
        meetingId: itemId,
      });
      console.log('Meeting deleted successfully');
      const updatedMeetings = meetings.filter((m: CurrentMeeting) => m.id !== itemId);
        setMeetings(updatedMeetings);

        // Show success toast
        toast.success("Meeting deleted successfully", {
        description: "All associated data has been removed"
      });

      // If deleting the active meeting, navigate to home
      if (currentMeeting?.id === itemId) {
        setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
        router.push('/');
      }
    } catch (error) {
      console.error('Failed to delete meeting:', error);
      toast.error("Failed to delete meeting", {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteModalState.itemId) {
      handleDelete(deleteModalState.itemId);
    }
    setDeleteModalState({ isOpen: false, itemId: null });
  };

  // Handle modal editing of meeting names
  const handleEditStart = (meetingId: string, currentTitle: string) => {
    setEditModalState({
      isOpen: true,
      meetingId: meetingId,
      currentTitle: currentTitle
    });
    setEditingTitle(currentTitle);
  };

  const handleEditConfirm = async () => {
    const newTitle = editingTitle.trim();
    const meetingId = editModalState.meetingId;

    if (!meetingId) return;

    // Prevent empty titles
    if (!newTitle) {
      toast.error("Meeting title cannot be empty");
      return;
    }

    try {
      await invoke('api_save_meeting_title', {
        meetingId: meetingId,
        title: newTitle,
      });

      // Update local state
      const updatedMeetings = meetings.map((m: CurrentMeeting) =>
        m.id === meetingId ? { ...m, title: newTitle } : m
      );
      setMeetings(updatedMeetings);

      // Update current meeting if it's the one being edited
      if (currentMeeting?.id === meetingId) {
        setCurrentMeeting({ id: meetingId, title: newTitle });
        }

        toast.success("Meeting title updated successfully");

      // Close modal and reset state
      setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
      setEditingTitle('');
    } catch (error) {
      console.error('Failed to update meeting title:', error);
      toast.error("Failed to update meeting title", {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const handleEditCancel = () => {
    setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
    setEditingTitle('');
  };

  const toggleFolder = (folderId: string) => {
    // Normal toggle behavior for all folders
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  // Expose setShowModelSettings to window for Rust tray to call
  useEffect(() => {
    (window as any).openSettings = () => {
      setShowModelSettings(true);
    };

    // Cleanup on unmount
    return () => {
      delete (window as any).openSettings;
    };
  }, []);

  // Global Ctrl+K / Cmd+K shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (isCollapsed) {
          // Search input not mounted yet — expand first, focus after mount
          setPendingSearchFocus(true);
          toggleCollapse();
        } else {
          searchInputRef.current?.focus();
        }
      }
      // Escape blurs search input
      if (e.key === 'Escape' && document.activeElement === searchInputRef.current) {
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isCollapsed, toggleCollapse]);

  // Focus search input after deferred expansion (Ctrl+K from collapsed state)
  useEffect(() => {
    if (pendingSearchFocus && !isCollapsed && searchInputRef.current) {
      searchInputRef.current.focus();
      setPendingSearchFocus(false);
    }
  }, [pendingSearchFocus, isCollapsed]);

  const renderCollapsedIcons = () => {
    if (!isCollapsed) return null;

    const isHomePage = pathname === '/';
    const isMeetingPage = pathname?.includes('/meeting-details');
    const isSettingsPage = pathname === '/settings';
    const isCalendarPage = pathname === '/calendar';

    return (
      <TooltipProvider>
        <div className="flex flex-col items-center gap-1 pt-3 pb-2">
          <Logo isCollapsed={isCollapsed} />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push('/')}
                aria-label="Home"
                aria-current={isHomePage ? 'page' : undefined}
                className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isHomePage ? 'bg-accent/25 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
                  }`}
              >
                <Home className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Home</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleRecordingToggle}
                disabled={isRecording}
                aria-label={isRecording ? 'Stop Recording' : 'Start Recording'}
                className={`${isRecording ? 'bg-destructive text-destructive-foreground' : 'bg-destructive/10 text-destructive hover:bg-destructive/20'} transition-colors duration-100`}
              >
                {isRecording ? (
                  <Square className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Mic className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>{isRecording ? "Recording in progress..." : "Start Recording"}</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push('/calendar')}
                aria-label="Calendar"
                aria-current={isCalendarPage ? 'page' : undefined}
                className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isCalendarPage ? 'bg-accent/25 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
                  }`}
              >
                <CalendarDays className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Calendar</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push('/daily')}
                aria-label="Daily"
                aria-current={pathname === '/daily' ? 'page' : undefined}
                className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${pathname === '/daily' ? 'bg-accent/25 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
                  }`}
              >
                <Sun className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Daily</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push('/context')}
                aria-label="Contexts"
                aria-current={pathname?.includes('/context') ? 'page' : undefined}
                className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${pathname?.includes('/context') ? 'bg-accent/25 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
                  }`}
              >
                <LayoutList className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Contexts</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push('/templates')}
                aria-label="Templates"
                aria-current={pathname === '/templates' ? 'page' : undefined}
                className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${pathname === '/templates' ? 'bg-accent/25 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
                  }`}
              >
                <LayoutTemplate className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Templates</p>
            </TooltipContent>
          </Tooltip>

          {betaFeatures.importAndRetranscribe && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => openImportDialog()}
                  aria-label="Import Audio"
                  className="p-2 rounded-lg transition-colors duration-150 text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Upload className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Import Audio</p>
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    if (isCollapsed) toggleCollapse();
                    toggleFolder('meetings');
                  }}
                  aria-label="Meeting Notes"
                  className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isMeetingPage ? 'bg-accent/25 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                >
                <NotebookPen className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Meeting Notes</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => router.push('/settings')}
                aria-label="Settings"
                aria-current={isSettingsPage ? 'page' : undefined}
                className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isSettingsPage ? 'bg-accent/25 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}
                  }`}
              >
                <Settings className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Settings</p>
            </TooltipContent>
          </Tooltip>

          <Info isCollapsed={isCollapsed} />
        </div>
      </TooltipProvider>
    );
  };

  // Find matching transcript snippet for a meeting item
  const findMatchingSnippet = (itemId: string) => {
    if (!searchQuery.trim() || !searchResults.length) return null;
    return searchResults.find(result => result.id === itemId);
  };

  const renderItem = (item: SidebarItem, depth = 0) => {
    const isExpanded = expandedFolders.has(item.id);
    const paddingLeft = `${depth * 12 + 12}px`;
    const isActive = item.type === 'file' && currentMeeting?.id === item.id;
    const isMeetingItem = item.id.includes('-') && !item.id.startsWith('intro-call');

    // Check if this item has a matching transcript snippet
    const matchingResult = isMeetingItem ? findMatchingSnippet(item.id) : null;
    const hasTranscriptMatch = !!matchingResult;

    if (isCollapsed) return null;

    // Meeting rows are a fixed height with a single truncated line. A long title
    // must never grow the row, because the history list is the only scrollable
    // region and variable heights make it impossible to scan.
    const rowTone =
      item.type === 'folder' && depth === 0
        ? 'flex items-center h-9 px-3 text-sm font-medium text-muted-foreground'
        : `${ROW_BASE} ${ROW_H} ${
            isActive
              ? ROW_ACTIVE
              : hasTranscriptMatch
                ? 'text-foreground bg-warning/10 hover:bg-warning/15'
                : ROW_IDLE
          }`;

    return (
      <div key={item.id} className="group/row">
        <div
          className={`${rowTone} ${item.type === 'folder' && depth === 0 ? '' : 'mx-2'}`}
          style={item.type === 'folder' && depth === 0 ? {} : { paddingLeft: `${depth * 10 + 10}px` }}
        >
          {item.type === 'folder' ? (
            <button
              type="button"
              onClick={() => toggleFolder(item.id)}
              aria-expanded={isExpanded}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              {item.id === 'meetings' || item.id === 'notes' ? (
                <Calendar className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : null}
              <span className={depth === 0 ? "" : "font-medium truncate"}>{item.title}</span>
              <span className="ml-auto">
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                )}
              </span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  setCurrentMeeting({ id: item.id, title: item.title });
                  const basePath = item.id.startsWith('intro-call')
                    ? routes.home()
                    : routes.meeting(item.id);
                  router.push(basePath);
                }}
                aria-current={isActive ? 'page' : undefined}
                title={item.title}
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
              >
                {isActive && ACTIVE_BAR}
                {isMeetingItem ? (
                  <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-sm bg-muted">
                    <File className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                  </span>
                ) : (
                  <span className="flex-shrink-0 flex items-center justify-center w-5 h-5 rounded-sm bg-primary/10">
                    <Plus className="h-3 w-3 text-primary" aria-hidden="true" />
                  </span>
                )}
                <span className="flex-1 truncate">{item.title}</span>
              </button>
              {isMeetingItem && (
                /* Absolutely positioned so the hidden state costs the title no
                   width — `opacity-0` alone would keep reserving ~60px and
                   truncate every meeting name to a few characters. */
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded bg-surface px-0.5 opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => handleEditStart(item.id, item.title)}
                    className="hover:text-primary p-1 rounded-md hover:bg-accent flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Edit title for ${item.title}`}
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteModalState({ isOpen: true, itemId: item.id })}
                    className="hover:text-destructive p-1 rounded-md hover:bg-destructive/10 flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Delete ${item.title}`}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        {item.type === 'file' && hasTranscriptMatch && matchingResult && (
          <div
            className="mt-1 ml-8 text-xs text-muted-foreground bg-warning/10 p-1.5 rounded-md border border-warning/20 line-clamp-2"
            style={depth === 0 ? {} : { marginLeft: `${depth * 12 + 44}px` }}
          >
            <span className="font-medium text-warning">Match:</span> {matchingResult.matchContext}
          </div>
        )}
        {item.type === 'folder' && isExpanded && item.children && (
          <div className="ml-1">
            {item.children.map(child => renderItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed top-0 left-0 h-screen z-40">
      {/* Floating collapse button */}
      <button
        onClick={toggleCollapse}
        aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute -right-6 top-20 z-50 p-1 bg-surface hover:bg-accent rounded-full shadow-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ transform: 'translateX(50%)' }}
      >
        {isCollapsed ? (
          <ChevronRightCircle className="w-6 h-6" />
        ) : (
          <ChevronLeftCircle className="w-6 h-6" />
        )}
      </button>

      <div
        className={`h-screen bg-surface border-r border-border flex flex-col transition-all duration-300 ${isCollapsed ? 'w-16' : 'w-64'
          }`}
      >
        {/*  Header with traffic light spacing */}
        <div className="flex-shrink-0 flex items-center">

          {/* Title container */}



          <div className="flex-1 min-w-0">
            {!isCollapsed && (
              <div className="px-3 pt-3 pb-2">
                <Logo isCollapsed={isCollapsed} />

                <div className="relative mt-2">
                  <InputGroup >
                    <InputGroupInput placeholder='Search meeting content...' value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      ref={searchInputRef}
                      aria-label="Search meeting content"
                    />
                    <InputGroupAddon>
                      <SearchIcon />
                    </InputGroupAddon>
                    {searchQuery &&
                      <InputGroupAddon align={'inline-end'}>
                        <InputGroupButton
                          onClick={() => handleSearchChange('')}
                          size="sm"
                          aria-label="Clear search"
                          title="Clear search"
                        >
                          <X aria-hidden="true" />
                        </InputGroupButton>
                      </InputGroupAddon>
                    }
                  </InputGroup>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Main content - scrollable area */}
        {/* Main content — the only region allowed to flex. `overflow-hidden`
            is a hard guarantee: even if a child misbehaves, it can never paint
            into the footer strip below. */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Fixed navigation items */}
          <div className="flex-shrink-0">
            {!isCollapsed && (
              <>
                <div className="px-3 pt-2 pb-1">
                  <button
                    type="button"
                    onClick={() => router.push('/')}
                    aria-current={pathname === '/' ? 'page' : undefined}
                    className={`${ROW_BASE} ${ROW_H} px-3 ${pathname === '/' ? ROW_ACTIVE : ROW_IDLE}`}
                  >
                    {pathname === '/' && ACTIVE_BAR}
                    <Home className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">Home</span>
                  </button>
                </div>

                <div className={SECTION_LABEL}>Meetings</div>
                <div className="px-3 space-y-0.5">
                  <button
                    type="button"
                    onClick={handleRecordingToggle}
                    className={`${ROW_BASE} ${ROW_H} px-3 ${ROW_IDLE}`}
                  >
                    <Mic className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                    <span className="truncate">Record / New Meeting</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/calendar')}
                    aria-current={pathname === '/calendar' ? 'page' : undefined}
                    className={`${ROW_BASE} ${ROW_H} px-3 ${pathname === '/calendar' ? ROW_ACTIVE : ROW_IDLE}`}
                  >
                    {pathname === '/calendar' && ACTIVE_BAR}
                    <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">Calendar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/daily')}
                    aria-current={pathname === '/daily' ? 'page' : undefined}
                    className={`${ROW_BASE} ${ROW_H} px-3 ${pathname === '/daily' ? ROW_ACTIVE : ROW_IDLE}`}
                  >
                    {pathname === '/daily' && ACTIVE_BAR}
                    <Sun className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">Daily</span>
                  </button>
                </div>

                <div className={SECTION_LABEL}>Knowledge</div>
                <div className="px-3 space-y-0.5">
                  <button
                    type="button"
                    onClick={() => router.push('/context')}
                    aria-current={pathname?.includes('/context') ? 'page' : undefined}
                    className={`${ROW_BASE} ${ROW_H} px-3 ${pathname?.includes('/context') ? ROW_ACTIVE : ROW_IDLE}`}
                  >
                    {pathname?.includes('/context') && ACTIVE_BAR}
                    <LayoutList className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">Contexts</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/templates')}
                    aria-current={pathname === '/templates' ? 'page' : undefined}
                    className={`${ROW_BASE} ${ROW_H} px-3 ${pathname === '/templates' ? ROW_ACTIVE : ROW_IDLE}`}
                  >
                    {pathname === '/templates' && ACTIVE_BAR}
                    <LayoutTemplate className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">Templates</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Content area */}
          <div className="flex-1 flex flex-col min-h-0">
            {renderCollapsedIcons()}
            {/* Meeting Notes folder header - fixed */}
            {!isCollapsed && (
              <div className="flex-shrink-0">
                {filteredSidebarItems.filter(item => item.type === 'folder').map(item => (
                  <div key={item.id}>
                    <div
                      className="flex items-center transition-all duration-150 p-3 text-sm font-medium h-10 mx-3 mt-3 rounded-lg"
                    >
                      <NotebookPen className="w-4 h-4 mr-2 text-muted-foreground" />
                      <span className="text-foreground">{item.title}</span>
                      {searchQuery && item.id === 'meetings' && isSearching && (
                        <span className="ml-2 text-xs text-primary animate-pulse motion-reduce:animate-none">Searching...</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Scrollable meeting items */}
            {!isCollapsed && (
              <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
                {filteredSidebarItems
                  .filter(item => item.type === 'folder' && expandedFolders.has(item.id) && item.children)
                  .map(item => {
                    const children = item.children ?? [];
                    // Group meeting history by local day when not searching.
                    const historyGroups = !searchQuery.trim() && item.id === 'meetings'
                      ? groupChildrenByHistory(children)
                      : null;

                    return (
                      <div key={`${item.id}-children`} className="mx-3">
                        {historyGroups
                          ? historyGroups.map(group => (
                              <div key={group.label}>
                                <div className="px-3 pt-3 pb-1 text-label text-muted-foreground">
                                  {group.label}
                                </div>
                                {group.items.map(child => renderItem(child, 1))}
                              </div>
                            ))
                          : children.map(child => renderItem(child, 1))}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        {/* Footer — primary action, then secondary, then utilities.
            The history list above is the only scrollable region, so these
            controls are structurally guaranteed to stay above the fold. */}
        {!isCollapsed && (
          <div className="flex-shrink-0 border-t border-border bg-surface px-3 py-2.5 relative z-10">
            <button
              type="button"
              onClick={handleRecordingToggle}
              disabled={isRecording}
              aria-label={isRecording ? 'Recording in progress' : 'Start Recording'}
              className={`flex w-full items-center justify-center gap-2 ${ROW_H_UTILITY} rounded-md px-3 text-sm font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
                isRecording
                  ? 'bg-destructive/10 text-destructive border border-destructive/40 cursor-default'
                  : 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              }`}
            >
              {isRecording ? (
                <>
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-destructive motion-safe:animate-pulse motion-reduce:animate-none"
                  />
                  <span>Recording in progress…</span>
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" aria-hidden="true" />
                  <span>Start Recording</span>
                </>
              )}
            </button>

            {betaFeatures.importAndRetranscribe && (
              <button
                type="button"
                onClick={() => openImportDialog()}
                className={`mt-1 flex w-full items-center gap-2 ${ROW_H_UTILITY} rounded-md px-3 text-sm transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${ROW_IDLE}`}
              >
                <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">Import Audio</span>
              </button>
            )}

            <div className="mt-1 flex items-center gap-1">
              <button
                type="button"
                onClick={() => router.push('/settings')}
                aria-current={pathname === '/settings' ? 'page' : undefined}
                className={`flex min-w-0 flex-1 items-center gap-2 ${ROW_H_UTILITY} rounded-md px-2.5 text-sm transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  pathname === '/settings' ? ROW_ACTIVE : ROW_IDLE
                }`}
              >
                <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">Settings</span>
              </button>
              <Info isCollapsed={isCollapsed} />
            </div>

            <p className="mt-2 text-center text-caption text-muted-foreground">
              Recall v0.4.0
            </p>
          </div>
        )}
      </div>

      {/* Confirmation Modal for Delete */}
      <ConfirmationModal
        isOpen={deleteModalState.isOpen}
        text="Are you sure you want to delete this meeting? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModalState({ isOpen: false, itemId: null })}
      />

      {/* Edit Meeting Title Modal */}
      <Dialog open={editModalState.isOpen} onOpenChange={(open) => {
        if (!open) handleEditCancel();
      }}>
        <DialogContent className="sm:max-w-md">
          <div className="py-2">
            <DialogTitle className="text-section-title text-foreground">Edit Meeting Title</DialogTitle>
            <div className="mt-4">
              <label htmlFor="meeting-title" className="block text-label text-muted-foreground mb-2">
                Meeting Title
              </label>
              <Input
                id="meeting-title"
                type="text"
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleEditConfirm();
                  } else if (e.key === 'Escape') {
                    handleEditCancel();
                  }
                }}
                placeholder="Enter meeting title"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={handleEditCancel}>
              Cancel
            </Button>
            <Button type="button" onClick={handleEditConfirm} disabled={editingTitle.trim() === ''}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Sidebar;
