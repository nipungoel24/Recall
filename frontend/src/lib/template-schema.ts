// Pure schema/transform helpers for summary templates.
//
// These mirror the Rust template schema in
// `frontend/src-tauri/src/summary/templates/types.rs` so validation and
// serialization stay aligned with the backend CONTRACT API.

export type TemplateSource = 'builtin' | 'bundled' | 'custom';

export type SectionFormat = 'paragraph' | 'list' | 'string';

export const SECTION_FORMATS: SectionFormat[] = ['paragraph', 'list', 'string'];

export interface TemplateSection {
  title: string;
  instruction: string;
  format: SectionFormat;
  item_format?: string;
  example_item_format?: string;
}

export interface TemplateDefinition {
  name: string;
  description: string;
  sections: TemplateSection[];
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  /** 'unknown' means the backend did not report an origin; treat as read-only. */
  source: TemplateSource | 'unknown';
}

export interface SectionFieldErrors {
  title?: string;
  instruction?: string;
  format?: string;
}

export interface TemplateFieldErrors {
  name?: string;
  description?: string;
  sections?: (SectionFieldErrors | null)[];
  form?: string;
}

export function createEmptySection(): TemplateSection {
  return { title: '', instruction: '', format: 'paragraph' };
}

export function createEmptyDefinition(): TemplateDefinition {
  return {
    name: '',
    description: '',
    sections: [createEmptySection()],
  };
}

const isBlank = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim().length === 0;

function parseSection(raw: unknown, index: number): TemplateSection | string {
  if (typeof raw !== 'object' || raw === null) {
    return `Section ${index + 1} must be an object`;
  }

  const candidate = raw as Record<string, unknown>;

  if (isBlank(candidate.title)) {
    return `Section ${index + 1} is missing a title`;
  }
  if (isBlank(candidate.instruction)) {
    return `Section ${index + 1} is missing an instruction`;
  }
  if (
    candidate.format !== 'paragraph' &&
    candidate.format !== 'list' &&
    candidate.format !== 'string'
  ) {
    return `Section ${index + 1} has an invalid format`;
  }

  const section: TemplateSection = {
    title: String(candidate.title),
    instruction: String(candidate.instruction),
    format: candidate.format,
  };

  if (typeof candidate.item_format === 'string' && candidate.item_format.trim().length > 0) {
    section.item_format = candidate.item_format;
  }
  if (
    typeof candidate.example_item_format === 'string' &&
    candidate.example_item_format.trim().length > 0
  ) {
    section.example_item_format = candidate.example_item_format;
  }

  return section;
}

/**
 * Parses and validates a raw template JSON string.
 *
 * Mirrors `templates::validate_and_parse_template` on the backend: a template
 * must have a non-empty name/description and at least one section with a
 * non-empty title/instruction and one of the supported formats.
 */
export function parseTemplateDefinition(
  json: string,
): { ok: true; value: TemplateDefinition } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Template is not valid JSON' };
  }

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Template must be a JSON object' };
  }

  const candidate = raw as Record<string, unknown>;

  if (isBlank(candidate.name)) {
    return { ok: false, error: 'Template name cannot be empty' };
  }
  if (isBlank(candidate.description)) {
    return { ok: false, error: 'Template description cannot be empty' };
  }
  if (!Array.isArray(candidate.sections) || candidate.sections.length === 0) {
    return { ok: false, error: 'Template must have at least one section' };
  }

  const sections: TemplateSection[] = [];
  for (let i = 0; i < candidate.sections.length; i++) {
    const section = parseSection(candidate.sections[i], i);
    if (typeof section === 'string') {
      return { ok: false, error: section };
    }
    sections.push(section);
  }

  return {
    ok: true,
    value: {
      name: String(candidate.name),
      description: String(candidate.description),
      sections,
    },
  };
}

/**
 * Returns field-level validation errors for an in-progress editor state.
 *
 * Kept in lockstep with `parseTemplateDefinition` so the editor surfaces
 * the same rules the backend enforces, but attributed to individual fields.
 */
export function validateTemplateDefinition(def: TemplateDefinition): TemplateFieldErrors {
  const errors: TemplateFieldErrors = {};

  if (def.name.trim().length === 0) {
    errors.name = 'Name is required';
  }

  if (def.description.trim().length === 0) {
    errors.description = 'Description is required';
  }

  if (def.sections.length === 0) {
    errors.form = 'Add at least one section';
    return errors;
  }

  const sectionErrors: (SectionFieldErrors | null)[] = def.sections.map((section) => {
    const sectionError: SectionFieldErrors = {};
    if (section.title.trim().length === 0) {
      sectionError.title = 'Section title is required';
    }
    if (section.instruction.trim().length === 0) {
      sectionError.instruction = 'Instruction is required';
    }
    if (!SECTION_FORMATS.includes(section.format)) {
      sectionError.format = 'Choose paragraph, list, or string';
    }
    return Object.keys(sectionError).length > 0 ? sectionError : null;
  });

  if (sectionErrors.some((error) => error !== null)) {
    errors.sections = sectionErrors;
  }

  return errors;
}

/**
 * Serializes a template definition to backend-compatible JSON.
 *
 * Blank optional fields are dropped to match the Rust serde
 * `skip_serializing_if = "Option::is_none"` behaviour.
 */
export function definitionToJson(def: TemplateDefinition): string {
  const sections = def.sections.map((section) => {
    const serialized: Record<string, unknown> = {
      title: section.title.trim(),
      instruction: section.instruction.trim(),
      format: section.format,
    };

    if (section.item_format && section.item_format.trim().length > 0) {
      serialized.item_format = section.item_format.trim();
    }
    if (
      section.example_item_format &&
      section.example_item_format.trim().length > 0
    ) {
      serialized.example_item_format = section.example_item_format.trim();
    }

    return serialized;
  });

  return JSON.stringify(
    {
      name: def.name.trim(),
      description: def.description.trim(),
      sections,
    },
    null,
    2,
  );
}

/**
 * Generates a filesystem-safe template id from a display name.
 *
 * Matches the backend convention of `<id>.json` files in the custom
 * templates directory.
 */
export function slugifyTemplateId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return slug.length > 0 ? slug : 'custom_template';
}

export function isValidTemplateId(id: string): boolean {
  return /^[a-z0-9_]+$/.test(id);
}

export function isCustomTemplate(info: Pick<TemplateInfo, 'source'>): boolean {
  return info.source === 'custom';
}

/** Built-in template ids shipped with the app (never editable/deletable). */
export const BUILTIN_TEMPLATE_IDS = ['daily_standup', 'standard_meeting'] as const;

export function isBuiltinTemplate(info: Pick<TemplateInfo, 'id' | 'source'>): boolean {
  return (
    info.source === 'builtin' ||
    info.source === 'bundled' ||
    (BUILTIN_TEMPLATE_IDS as readonly string[]).includes(info.id)
  );
}
