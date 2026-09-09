'use client';

import { useCallback, useState } from 'react';
import { Copy, FileText, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTemplates } from '@/hooks/useTemplates';
import { isCustomTemplate, type TemplateDefinition, type TemplateInfo } from '@/lib/template-schema';
import {
  TemplateServiceError,
  duplicateTemplate,
  getTemplateDefinition,
} from '@/services/templateService';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
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
    defaultTemplateId,
    saveTemplate,
    deleteTemplate,
    setDefaultTemplate,
    refreshTemplates,
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

  const handleDuplicate = useCallback(
    async (template: TemplateInfo) => {
      try {
        const duplicated = await duplicateTemplate(template.id, `${template.id}_copy`);
        toast.success('Template duplicated', {
          description: `"${duplicated.name}" is ready to use.`,
        });
        await refreshTemplates();
      } catch (err) {
        toast.error('Failed to duplicate template', {
          description:
            err instanceof TemplateServiceError
              ? err.message
              : 'A copy of this template may already exist.',
        });
      }
    },
    [refreshTemplates],
  );

  const handleSetDefault = useCallback(
    async (template: TemplateInfo) => {
      try {
        await setDefaultTemplate(template.id);
        toast.success('Default template updated', {
          description: `New meeting summaries will use "${template.name}" by default.`,
        });
      } catch (err) {
        toast.error('Failed to set default template', {
          description:
            err instanceof TemplateServiceError ? err.message : 'Please try again.',
        });
      }
    },
    [setDefaultTemplate],
  );

  const handleEditorSave = useCallback(
    async (templateId: string, templateJson: string) => {
      const isEditing = editorTarget?.mode === 'edit';
      await saveTemplate(templateId, templateJson);
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
    <div className="bg-surface rounded-xl border border-border shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-border p-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Summary Templates</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Built-in templates are read-only. Your templates can be edited, duplicated, or
            deleted.
          </p>
        </div>
        <Button variant="default" onClick={openCreateEditor}>
          <Plus /> New Template
        </Button>
      </div>

      <div className="p-6">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : (
          <div className="space-y-8">
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-3">
                My Templates
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {customTemplates.length}
                </span>
              </h3>
              {customTemplates.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-6 text-center">
                  <FileText className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No custom templates yet. Create one to tailor summaries to your workflow.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {customTemplates.map((template) => (
                    <li key={template.id} className="flex items-center justify-between gap-4 p-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{template.name}</span>
                          <Badge variant="secondary">Custom</Badge>
                          {defaultTemplateId === template.id && <Badge variant="success">Default</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground truncate mt-0.5" title={template.description}>
                          {template.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {defaultTemplateId !== template.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void handleSetDefault(template)}
                            title={`Use ${template.name} as the default template`}
                            aria-label={`Set ${template.name} as default`}
                          >
                            <Star />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditEditor(template)}
                          disabled={editorLoading}
                          title={`Edit ${template.name}`}
                          aria-label={`Edit ${template.name}`}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void handleDuplicate(template)}
                          title={`Duplicate ${template.name}`}
                          aria-label={`Duplicate ${template.name}`}
                        >
                          <Copy />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setTemplateToDelete(template)}
                          title={`Delete ${template.name}`}
                          aria-label={`Delete ${template.name}`}
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
                <h3 className="text-sm font-semibold text-foreground mb-3">
                  Built-in Templates
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {readOnlyTemplates.length}
                  </span>
                </h3>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {readOnlyTemplates.map((template) => (
                    <li key={template.id} className="flex items-center justify-between gap-4 p-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-foreground">{template.name}</span>
                          <Badge variant="default">Built-in</Badge>
                          {defaultTemplateId === template.id && <Badge variant="success">Default</Badge>}
                        </div>
                        <p className="text-sm text-muted-foreground truncate mt-0.5" title={template.description}>
                          {template.description}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {defaultTemplateId !== template.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => void handleSetDefault(template)}
                            title={`Use ${template.name} as the default template`}
                            aria-label={`Set ${template.name} as default`}
                          >
                            <Star />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => void handleDuplicate(template)}
                          title={`Duplicate ${template.name} as a custom template`}
                          aria-label={`Duplicate ${template.name}`}
                        >
                          <Copy />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>

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
