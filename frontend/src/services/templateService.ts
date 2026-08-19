/**
 * Template Service
 *
 * Frontend service layer for the Custom Template Manager, implemented
 * against the template CONTRACT API (Tauri commands owned by the Rust
 * backend). The contract is documented here so backend and frontend stay
 * in lockstep.
 *
 * CONTRACT
 * --------
 * 1. `api_list_templates()`
 *      -> Array<{ id: string; name: string; description: string;
 *                 source: 'builtin' | 'bundled' | 'custom' }>
 *    Lists built-in (embedded), bundled (resource dir) and custom
 *    (user data dir) templates. `source` identifies the origin so the
 *    frontend can hide destructive actions for non-custom templates.
 *
 * 2. `api_get_template_json(template_id: string)` -> string
 *    Returns the raw JSON definition of any template (custom or built-in)
 *    so the editor can round-trip full section definitions.
 *
 * 3. `api_validate_template(template_json: string)`
 *      -> Ok(name: string) | Err(message: string)
 *    Backend-side schema validation. The frontend MUST call this before
 *    saving and MUST surface the returned error to the user.
 *
 * 4. `api_create_custom_template(template_id: string, template_json: string)`
 *      -> Ok({ id, name, description, source: 'custom' }) | Err(message)
 *    Validates the JSON, then writes it to the user custom templates
 *    directory as `<template_id>.json`. Rejects ids reserved for
 *    built-in/bundled templates.
 *
 * 5. `api_delete_custom_template(template_id: string)` -> Ok(()) | Err(message)
 *    Deletes `<template_id>.json` from the user custom templates
 *    directory. MUST reject built-in/bundled template ids.
 *
 * Until the backend merges `source` in `api_list_templates` (and the
 * save/delete commands), this service degrades honestly: templates whose
 * origin is unknown are treated as read-only and save/delete surface the
 * backend error instead of pretending to work.
 */

import { invoke } from '@tauri-apps/api/core';
import {
  BUILTIN_TEMPLATE_IDS,
  parseTemplateDefinition,
  type TemplateDefinition,
  type TemplateInfo,
} from '@/lib/template-schema';

export type TemplateOrigin = TemplateInfo['source'];

export interface RawTemplateInfoDto {
  id?: string;
  name?: string;
  description?: string;
  source?: string;
}

export interface TemplateServiceResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

export class TemplateServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateServiceError';
  }
}

function isCommandNotFound(error: unknown): boolean {
  const message = typeof error === 'string' ? error : String(error);
  return /command .* not found|not found/i.test(message);
}

function friendlyCommandError(command: string, error: unknown): string {
  if (isCommandNotFound(error)) {
    return `Template management is not available yet (backend command "${command}" not found). Please update the app.`;
  }
  return typeof error === 'string' ? error : String(error);
}

/**
 * Normalizes a raw backend template entry into a TemplateInfo.
 *
 * When `source` is absent (backend not yet merged), falls back to the
 * known built-in id list; anything else becomes 'unknown' and is treated
 * as read-only by the UI. 'unknown' is never treated as deletable.
 */
export function normalizeTemplateInfo(raw: RawTemplateInfoDto): TemplateInfo {
  const id = typeof raw?.id === 'string' ? raw.id : '';
  const name = typeof raw?.name === 'string' ? raw.name : id;
  const description = typeof raw?.description === 'string' ? raw.description : '';

  let source: TemplateOrigin = 'unknown';
  if (raw?.source === 'builtin' || raw?.source === 'bundled' || raw?.source === 'custom') {
    source = raw.source;
  } else if ((BUILTIN_TEMPLATE_IDS as readonly string[]).includes(id)) {
    source = 'builtin';
  }

  return { id, name, description, source };
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  try {
    const raw = await invoke<RawTemplateInfoDto[]>('api_list_templates');
    if (!Array.isArray(raw)) {
      return [];
    }
    return raw.map(normalizeTemplateInfo);
  } catch (error) {
    throw new TemplateServiceError(friendlyCommandError('api_list_templates', error));
  }
}

export async function getTemplateJson(templateId: string): Promise<string> {
  try {
    return await invoke<string>('api_get_template_json', { templateId });
  } catch (error) {
    throw new TemplateServiceError(friendlyCommandError('api_get_template_json', error));
  }
}

export async function getTemplateDefinition(
  templateId: string,
): Promise<TemplateDefinition> {
  const json = await getTemplateJson(templateId);
  const parsed = parseTemplateDefinition(json);
  if (!parsed.ok) {
    throw new TemplateServiceError(parsed.error);
  }
  return parsed.value;
}

export async function validateTemplateOnBackend(templateJson: string): Promise<string> {
  try {
    return await invoke<string>('api_validate_template', { templateJson });
  } catch (error) {
    throw new TemplateServiceError(friendlyCommandError('api_validate_template', error));
  }
}

/**
 * Saves a template definition. Client-side parsing happens first so a
 * malformed definition is never sent to the backend; the backend remains
 * the source of truth and validates again.
 */
export async function saveTemplate(
  templateId: string,
  templateJson: string,
): Promise<TemplateInfo> {
  const parsed = parseTemplateDefinition(templateJson);
  if (!parsed.ok) {
    throw new TemplateServiceError(parsed.error);
  }

  let isUpdate = false;
  try {
    const existing = await listTemplates();
    isUpdate = existing.some((t) => t.id === templateId && t.source === 'custom');
  } catch {
    // If listing fails, we assume it might be a new template creation
  }

  try {
    if (isUpdate) {
      const saved = await invoke<RawTemplateInfoDto>('api_update_custom_template', {
        templateId,
        templateJson,
      });
      return normalizeTemplateInfo({ ...saved, id: templateId, source: 'custom' });
    } else {
      const saved = await invoke<RawTemplateInfoDto>('api_create_custom_template', {
        templateId,
        templateJson,
      });
      return normalizeTemplateInfo({ ...saved, id: templateId, source: 'custom' });
    }
  } catch (error) {
    const cmd = isUpdate ? 'api_update_custom_template' : 'api_create_custom_template';
    throw new TemplateServiceError(friendlyCommandError(cmd, error));
  }
}

export async function deleteTemplate(templateId: string): Promise<void> {
  try {
    await invoke<void>('api_delete_custom_template', { templateId });
  } catch (error) {
    throw new TemplateServiceError(friendlyCommandError('api_delete_custom_template', error));
  }
}

export async function duplicateTemplate(
  templateId: string,
  newTemplateId: string,
): Promise<TemplateInfo> {
  try {
    const duplicated = await invoke<RawTemplateInfoDto>('api_duplicate_template', {
      templateId,
      newTemplateId,
    });
    return normalizeTemplateInfo(duplicated);
  } catch (error) {
    throw new TemplateServiceError(friendlyCommandError('api_duplicate_template', error));
  }
}

/**
 * The persistent default summary template id, or null when unset (the UI
 * falls back to `standard_meeting`). The backend re-validates the stored id
 * and clears it when the template no longer exists.
 */
export async function getDefaultTemplateId(): Promise<string | null> {
  try {
    const id = await invoke<string | null>('api_get_default_template');
    return id && id.trim() ? id : null;
  } catch (error) {
    throw new TemplateServiceError(friendlyCommandError('api_get_default_template', error));
  }
}

/** Persists the default summary template id (stores the ID, not contents). */
export async function setDefaultTemplateId(templateId: string): Promise<void> {
  try {
    await invoke<void>('api_set_default_template', { templateId });
  } catch (error) {
    throw new TemplateServiceError(friendlyCommandError('api_set_default_template', error));
  }
}
