import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import type { TemplateInfo } from '@/lib/template-schema';
import {
  TemplateServiceError,
  getDefaultTemplateId as getDefaultTemplateIdService,
  listTemplates,
  saveTemplate as saveTemplateService,
  deleteTemplate as deleteTemplateService,
  setDefaultTemplateId as setDefaultTemplateIdService,
} from '@/services/templateService';

const DEFAULT_TEMPLATE_ID = 'standard_meeting';

/**
 * Shared template state used by summary generation (meeting details)
 * and the Custom Template Manager (settings).
 *
 * The template list is the single source of truth; consumers re-render
 * whenever a save/delete triggers a refresh.
 */
export function useTemplates() {
  const [availableTemplates, setAvailableTemplates] = useState<TemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>(DEFAULT_TEMPLATE_ID);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  // True once the persisted default has been applied, so loading the setting
  // never overrides a template the user explicitly picked in the meantime.
  const defaultAppliedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshTemplates = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const templates = await listTemplates();
      if (!mountedRef.current) return;
      setAvailableTemplates(templates);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
      if (mountedRef.current) {
        setError(err instanceof TemplateServiceError ? err.message : 'Failed to load templates');
      }
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Fetch available templates on mount
  useEffect(() => {
    refreshTemplates();
  }, [refreshTemplates]);

  // Load the persistent default template id once. When present and still
  // valid, preselect it unless the user already chose a template explicitly.
  useEffect(() => {
    let cancelled = false;
    getDefaultTemplateIdService()
      .then((storedId) => {
        if (cancelled || !mountedRef.current) return;
        setDefaultTemplateId(storedId);
        if (storedId) {
          defaultAppliedRef.current = true;
          setSelectedTemplate(storedId);
        }
      })
      .catch((err) => {
        console.error('Failed to load default template:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Persists the default summary template id. Local state updates
   * immediately so the Manager and pickers reflect the new default, and the
   * new default is preselected (users can still override per meeting).
   */
  const setDefaultTemplate = useCallback(
    async (templateId: string): Promise<void> => {
      await setDefaultTemplateIdService(templateId);
      if (!mountedRef.current) return;
      defaultAppliedRef.current = true;
      setDefaultTemplateId(templateId);
      setSelectedTemplate(templateId);
    },
    [],
  );

  // If the selected template disappears (e.g. deleted custom template),
  // fall back to the default template so summary generation keeps working.
  useEffect(() => {
    if (availableTemplates.length === 0) return;
    if (availableTemplates.some((template) => template.id === selectedTemplate)) return;

    const fallback =
      defaultTemplateId && availableTemplates.some((t) => t.id === defaultTemplateId)
        ? defaultTemplateId
        : availableTemplates.some((template) => template.id === DEFAULT_TEMPLATE_ID)
          ? DEFAULT_TEMPLATE_ID
          : availableTemplates[0].id;

    setSelectedTemplate(fallback);
  }, [availableTemplates, selectedTemplate, defaultTemplateId]);

  // Handle template selection
  const handleTemplateSelection = useCallback((templateId: string, templateName: string) => {
    setSelectedTemplate(templateId);
    toast.success('Template selected', {
      description: `Using "${templateName}" template for summary generation`,
    });
  }, []);

  /**
   * Saves a custom template (validated by the backend before writing) and
   * refreshes the shared template list. Throws TemplateServiceError on
   * failure so callers can surface field/useful errors.
   */
  const saveTemplate = useCallback(
    async (templateId: string, templateJson: string): Promise<TemplateInfo> => {
      const saved = await saveTemplateService(templateId, templateJson);
      await refreshTemplates();
      return saved;
    },
    [refreshTemplates],
  );

  /**
   * Deletes a custom template and refreshes the shared template list.
   * Throws TemplateServiceError on failure (including built-in rejects).
   */
  const deleteTemplate = useCallback(
    async (templateId: string): Promise<void> => {
      await deleteTemplateService(templateId);
      await refreshTemplates();
    },
    [refreshTemplates],
  );

  return {
    availableTemplates,
    selectedTemplate,
    defaultTemplateId,
    isLoading,
    error,
    refreshTemplates,
    handleTemplateSelection,
    saveTemplate,
    deleteTemplate,
    setDefaultTemplate,
  };
}
