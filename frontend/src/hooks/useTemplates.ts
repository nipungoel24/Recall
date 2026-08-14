import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';
import type { TemplateInfo } from '@/lib/template-schema';
import {
  TemplateServiceError,
  listTemplates,
  saveTemplate as saveTemplateService,
  deleteTemplate as deleteTemplateService,
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
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

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

  // If the selected template disappears (e.g. deleted custom template),
  // fall back to the default template so summary generation keeps working.
  useEffect(() => {
    if (availableTemplates.length === 0) return;
    if (availableTemplates.some((template) => template.id === selectedTemplate)) return;

    const fallback = availableTemplates.some((template) => template.id === DEFAULT_TEMPLATE_ID)
      ? DEFAULT_TEMPLATE_ID
      : availableTemplates[0].id;

    setSelectedTemplate(fallback);
  }, [availableTemplates, selectedTemplate]);

  // Handle template selection
  const handleTemplateSelection = useCallback((templateId: string, templateName: string) => {
    setSelectedTemplate(templateId);
    toast.success('Template selected', {
      description: `Using "${templateName}" template for summary generation`,
    });
    Analytics.trackFeatureUsed('template_selected');
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
    isLoading,
    error,
    refreshTemplates,
    handleTemplateSelection,
    saveTemplate,
    deleteTemplate,
  };
}
