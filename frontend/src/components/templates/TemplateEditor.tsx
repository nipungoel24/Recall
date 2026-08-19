'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SECTION_FORMATS,
  createEmptyDefinition,
  createEmptySection,
  definitionToJson,
  isValidTemplateId,
  slugifyTemplateId,
  validateTemplateDefinition,
  type SectionFieldErrors,
  type SectionFormat,
  type TemplateDefinition,
  type TemplateFieldErrors,
  type TemplateSection,
} from '@/lib/template-schema';
import {
  TemplateServiceError,
  validateTemplateOnBackend,
} from '@/services/templateService';

interface TemplateEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'create' | 'edit';
  /** Fixed template id when editing (create mode lets the user pick one). */
  initialId?: string;
  initialDefinition?: TemplateDefinition;
  /**
   * Persists the template. The editor validates both client-side and
   * against the backend before invoking this.
   */
  onSave: (templateId: string, templateJson: string) => Promise<void>;
}

interface EditorState {
  templateId: string;
  definition: TemplateDefinition;
}

function initialState(input: Pick<TemplateEditorProps, 'initialId' | 'initialDefinition'>): EditorState {
  return {
    templateId: input.initialId ?? '',
    definition: input.initialDefinition
      ? structuredClone(input.initialDefinition)
      : createEmptyDefinition(),
  };
}

export function TemplateEditor({
  open,
  onOpenChange,
  mode,
  initialId,
  initialDefinition,
  onSave,
}: TemplateEditorProps) {
  const [state, setState] = useState<EditorState>(() => initialState({ initialId, initialDefinition }));
  const [submittedOnce, setSubmittedOnce] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Reset the form whenever the dialog (re)opens for a new target.
  useEffect(() => {
    if (open) {
      setState(initialState({ initialId, initialDefinition }));
      setSubmittedOnce(false);
      setFormError(null);
      setIsSaving(false);
    }
  }, [open, mode, initialId, initialDefinition]);

  const fieldErrors: TemplateFieldErrors = submittedOnce
    ? validateTemplateDefinition(state.definition)
    : {};

  const idError = (() => {
    if (mode === 'edit') return undefined;
    if (state.templateId.trim().length === 0) {
      return submittedOnce ? 'Template id is required' : undefined;
    }
    if (!isValidTemplateId(state.templateId)) {
      return 'Only lowercase letters, numbers, and underscores are allowed';
    }
    return undefined;
  })();

  const updateDefinition = useCallback((patch: Partial<TemplateDefinition>) => {
    setState((prev) => ({ ...prev, definition: { ...prev.definition, ...patch } }));
    setFormError(null);
  }, []);

  const updateSection = useCallback((index: number, patch: Partial<TemplateSection>) => {
    setState((prev) => {
      const sections = [...prev.definition.sections];
      sections[index] = { ...sections[index], ...patch };
      return { ...prev, definition: { ...prev.definition, sections } };
    });
    setFormError(null);
  }, []);

  const addSection = useCallback(() => {
    setState((prev) => ({
      ...prev,
      definition: { ...prev.definition, sections: [...prev.definition.sections, createEmptySection()] },
    }));
  }, []);

  const removeSection = useCallback((index: number) => {
    setState((prev) => {
      if (prev.definition.sections.length <= 1) return prev;
      return {
        ...prev,
        definition: {
          ...prev.definition,
          sections: prev.definition.sections.filter((_, i) => i !== index),
        },
      };
    });
    setFormError(null);
  }, []);

  const moveSection = useCallback((index: number, direction: -1 | 1) => {
    setState((prev) => {
      const sections = [...prev.definition.sections];
      const target = index + direction;
      if (target < 0 || target >= sections.length) return prev;
      [sections[index], sections[target]] = [sections[target], sections[index]];
      return { ...prev, definition: { ...prev.definition, sections } };
    });
  }, []);

  const handleSubmit = async () => {
    setSubmittedOnce(true);
    setFormError(null);

    const errors = validateTemplateDefinition(state.definition);
    if (Object.keys(errors).length > 0) return;

    let templateId = state.templateId.trim();
    if (mode === 'create') {
      if (templateId.length === 0) return;
      if (!isValidTemplateId(templateId)) return;
    } else {
      templateId = initialId ?? templateId;
    }

    const templateJson = definitionToJson(state.definition);

    try {
      // Backend is the source of truth for validation; never save a
      // template the backend rejects.
      await validateTemplateOnBackend(templateJson);
    } catch (error) {
      setFormError(error instanceof TemplateServiceError ? error.message : String(error));
      return;
    }

    setIsSaving(true);
    try {
      await onSave(templateId, templateJson);
      onOpenChange(false);
    } catch (error) {
      setFormError(error instanceof TemplateServiceError ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'New Summary Template' : 'Edit Summary Template'}
          </DialogTitle>
          <DialogDescription>
            Each section becomes a heading in the generated summary, and its instruction
            tells the AI what to extract there.
            {mode === 'edit' && ' The template id cannot be changed.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mode === 'create' && (
            <div className="space-y-2">
              <Label htmlFor="template-id">Template id</Label>
              <Input
                id="template-id"
                value={state.templateId}
                onChange={(event) => {
                  setState((prev) => ({ ...prev, templateId: event.target.value }));
                  setFormError(null);
                }}
                placeholder="e.g. weekly_review"
                aria-invalid={!!idError}
              />
              {idError && <p className="text-[0.8rem] font-medium text-red-600">{idError}</p>}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              value={state.definition.name}
              onChange={(event) => {
                const name = event.target.value;
                setState((prev) => ({
                  ...prev,
                  templateId:
                    mode === 'create' && prev.templateId.length === 0
                      ? slugifyTemplateId(name)
                      : prev.templateId,
                  definition: { ...prev.definition, name },
                }));
                setFormError(null);
              }}
              placeholder="e.g. Weekly Review"
              aria-invalid={!!fieldErrors.name}
            />
            {fieldErrors.name && <p className="text-[0.8rem] font-medium text-red-600">{fieldErrors.name}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-description">Description</Label>
            <Textarea
              id="template-description"
              value={state.definition.description}
              onChange={(event) => updateDefinition({ description: event.target.value })}
              placeholder="Briefly describe when this template should be used"
              rows={2}
              aria-invalid={!!fieldErrors.description}
            />
            {fieldErrors.description && (
              <p className="text-[0.8rem] font-medium text-red-600">{fieldErrors.description}</p>
            )}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Sections</Label>
              <Button type="button" variant="outline" size="sm" onClick={addSection}>
                <Plus /> Add section
              </Button>
            </div>
            {fieldErrors.form && <p className="text-[0.8rem] font-medium text-red-600">{fieldErrors.form}</p>}

            {state.definition.sections.map((section, index) => {
              const sectionErrors: SectionFieldErrors | null | undefined = fieldErrors.sections?.[index];
              return (
                <div
                  key={index}
                  className="rounded-md border border-gray-200 p-4 space-y-3 bg-gray-50/50"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">Section {index + 1}</span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => moveSection(index, -1)}
                        disabled={index === 0}
                        title="Move up"
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => moveSection(index, 1)}
                        disabled={index === state.definition.sections.length - 1}
                        title="Move down"
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeSection(index)}
                        disabled={state.definition.sections.length <= 1}
                        title="Remove section"
                      >
                        <Trash2 className="text-red-600" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`section-title-${index}`}>Title</Label>
                    <Input
                      id={`section-title-${index}`}
                      value={section.title}
                      onChange={(event) => updateSection(index, { title: event.target.value })}
                      placeholder="e.g. Action Items"
                      aria-invalid={!!sectionErrors?.title}
                    />
                    {sectionErrors?.title && (
                      <p className="text-[0.8rem] font-medium text-red-600">{sectionErrors.title}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor={`section-instruction-${index}`}>Instruction</Label>
                    <Textarea
                      id={`section-instruction-${index}`}
                      value={section.instruction}
                      onChange={(event) => updateSection(index, { instruction: event.target.value })}
                      placeholder="What should the AI extract for this section?"
                      rows={2}
                      aria-invalid={!!sectionErrors?.instruction}
                    />
                    {sectionErrors?.instruction && (
                      <p className="text-[0.8rem] font-medium text-red-600">{sectionErrors.instruction}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-2">
                    <div className="space-y-2">
                      <Label>Format</Label>
                      <Select
                        value={section.format}
                        onValueChange={(value) => updateSection(index, { format: value as SectionFormat })}
                      >
                        <SelectTrigger aria-invalid={!!sectionErrors?.format}>
                          <SelectValue placeholder="Select format" />
                        </SelectTrigger>
                        <SelectContent>
                          {SECTION_FORMATS.map((format) => (
                            <SelectItem key={format} value={format}>
                              {format}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {sectionErrors?.format && (
                        <p className="text-[0.8rem] font-medium text-red-600">{sectionErrors.format}</p>
                      )}
                    </div>

                    {section.format === 'list' && (
                      <div className="space-y-2">
                        <Label htmlFor={`section-item-format-${index}`}>
                          Item format (optional)
                        </Label>
                        <Input
                          id={`section-item-format-${index}`}
                          value={section.item_format ?? ''}
                          onChange={(event) =>
                            updateSection(index, { item_format: event.target.value })
                          }
                          placeholder="e.g. | **Owner** | **Item** |"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {formError && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {formError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isSaving}>
            {isSaving && <Loader2 className="animate-spin" />}
            {mode === 'create' ? 'Create template' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
