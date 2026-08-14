'use client';

import { useCallback, useState } from 'react';
import { FileText, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';
import { useTemplates } from '@/hooks/useTemplates';
import { isCustomTemplate, type TemplateDefinition, type TemplateInfo } from '@/lib/template-schema';
import {
  TemplateServiceError,
  getTemplateDefinition,
} from '@/services/templateService';
import { Button } from '@/components/ui/button';
import { ConfirmationModal } from '@/components/ConfirmationModel/confirmation-modal';
import { TemplateEditor } from '@/components/templates/TemplateEditor';

type EditorTarget =
  | { mode: 'create' }
  | { mode: 'edit'; template: TemplateInfo };

export function SummaryTemplateManager() {
  const {
    availableTemplates,
    isLoading,
    error,
    saveTemplate,
    deleteTemplate,
  } = useTemplates();

  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [editorDefinition, setEditorDefinition] = useState<TemplateDefinition | undefined>(undefined);
  const [editorLoading, setEditorLoading] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<TemplateInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const customTemplates = availableTemplates.filter(isCustomTemplate);
  const readOnlyTemplates = availableTemplates.filter((template) => !isCustomTemplate(template));

  const openCreateEditor = useCallback(() => {
    setEditorDefinition(undefined);
    setEditorTarget({ mode: 'create' });
  }, []);

  const openEditEditor = useCallback(async (template: TemplateInfo) => {
    setEditorLoading(true);
    try {
      const definition = await getTemplateDefinition(template.id);
      setEditorDefinition(definition);
      setEditorTarget({ mode: 'edit', template });
    } catch (err) {
      console.error('Failed to load template for editing:', err);
      toast.error('Failed to load template', {
        description: err instanceof TemplateServiceError ? err.message : String(err),
      });
    } finally {
      setEditorLoading(false);
    }
  }, []);

  const handleEditorSave = useCallback(
    async (templateId: string, templateJson: string) => {
      const isEditing = editorTarget?.mode === 'edit';
      await saveTemplate(templateId, templateJson);
      Analytics.trackFeatureUsed(isEditing ? 'template_updated' : 'template_created');
      toast.success(isEditing ? 'Template updated' : 'Template created', {
        description: `"${templateId}" is ready to use for summary generation`,
      });
    },
    [editorTarget, saveTemplate],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!templateToDelete) return;

    setIsDeleting(true);
    try {
      await deleteTemplate(templateToDelete.id);
      Analytics.trackFeatureUsed('template_deleted');
      toast.success('Template deleted', {
        description: `"${templateToDelete.name}" was removed`,
      });
      setTemplateToDelete(null);
    } catch (err) {
      console.error('Failed to delete template:', err);
      toast.error('Failed to delete template', {
        description: err instanceof TemplateServiceError ? err.message : String(err),
      });
    } finally {
      setIsDeleting(false);
    }
  }, [deleteTemplate, templateToDelete]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Summary Templates</h3>
          <p className="text-sm text-gray-600">
            Custom templates appear in the template picker whenever you generate a
            summary. Built-in templates cannot be edited or deleted.
          </p>
        </div>
        <Button onClick={openCreateEditor}>
          <Plus /> New template
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-gray-600 mt-6">
          <Loader2 className="animate-spin" /> Loading templates...
        </div>
      ) : error ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <section>
            <h4 className="text-sm font-medium text-gray-700 mb-3">Custom templates</h4>
            {customTemplates.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-300 p-6 text-center">
                <FileText className="mx-auto h-8 w-8 text-gray-300 mb-2" />
                <p className="text-sm text-gray-600">
                  No custom templates yet. Create one to tailor summaries to your workflow.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                {customTemplates.map((template) => (
                  <li key={template.id} className="flex items-center justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{template.name}</span>
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          Custom
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 truncate" title={template.description}>
                        {template.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditEditor(template)}
                        disabled={editorLoading}
                        title={`Edit ${template.name}`}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setTemplateToDelete(template)}
                        title={`Delete ${template.name}`}
                      >
                        <Trash2 className="text-red-600" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {readOnlyTemplates.length > 0 && (
            <section>
              <h4 className="text-sm font-medium text-gray-700 mb-3">Built-in templates</h4>
              <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
                {readOnlyTemplates.map((template) => (
                  <li key={template.id} className="flex items-center justify-between gap-4 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{template.name}</span>
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          Built-in
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 truncate" title={template.description}>
                        {template.description}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <TemplateEditor
        open={editorTarget !== null && !editorLoading}
        onOpenChange={(open) => {
          if (!open) setEditorTarget(null);
        }}
        mode={editorTarget?.mode ?? 'create'}
        initialId={editorTarget?.mode === 'edit' ? editorTarget.template.id : undefined}
        initialDefinition={editorDefinition}
        onSave={handleEditorSave}
      />

      <ConfirmationModal
        isOpen={templateToDelete !== null}
        text={
          templateToDelete
            ? `Delete the custom template "${templateToDelete.name}"? Summaries already generated with it are not affected, but it will no longer be available for new summaries.`
            : ''
        }
        onConfirm={isDeleting ? () => {} : handleConfirmDelete}
        onCancel={() => !isDeleting && setTemplateToDelete(null)}
      />
    </div>
  );
}
