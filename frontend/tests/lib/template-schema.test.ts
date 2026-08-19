import { describe, expect, test } from "bun:test";

import {
  BUILTIN_TEMPLATE_IDS,
  createEmptyDefinition,
  createEmptySection,
  definitionToJson,
  isBuiltinTemplate,
  isCustomTemplate,
  isValidTemplateId,
  parseTemplateDefinition,
  slugifyTemplateId,
  validateTemplateDefinition,
} from "../../src/lib/template-schema";

const VALID_TEMPLATE_JSON = JSON.stringify({
  name: "Weekly Review",
  description: "End of week review",
  sections: [
    {
      title: "Summary",
      instruction: "Provide a summary",
      format: "paragraph",
    },
    {
      title: "Action Items",
      instruction: "List follow-ups",
      format: "list",
      item_format: "| **Owner** | **Item** |",
    },
  ],
});

describe("parseTemplateDefinition", () => {
  test("parses a valid template definition", () => {
    const result = parseTemplateDefinition(VALID_TEMPLATE_JSON);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("Weekly Review");
      expect(result.value.sections).toHaveLength(2);
      expect(result.value.sections[1].item_format).toBe("| **Owner** | **Item** |");
    }
  });

  test("rejects invalid JSON", () => {
    const result = parseTemplateDefinition("not json");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("JSON");
    }
  });

  test("rejects a JSON array", () => {
    const result = parseTemplateDefinition("[1, 2]");
    expect(result.ok).toBe(false);
  });

  test("rejects an empty name", () => {
    const result = parseTemplateDefinition(
      JSON.stringify({ name: "", description: "d", sections: [createEmptySection()] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("name");
    }
  });

  test("rejects an empty description", () => {
    const result = parseTemplateDefinition(
      JSON.stringify({ name: "n", description: "  ", sections: [createEmptySection()] }),
    );
    expect(result.ok).toBe(false);
  });

  test("rejects a template without sections", () => {
    const result = parseTemplateDefinition(
      JSON.stringify({ name: "n", description: "d", sections: [] }),
    );
    expect(result.ok).toBe(false);
  });

  test("rejects a section with a missing title", () => {
    const result = parseTemplateDefinition(
      JSON.stringify({
        name: "n",
        description: "d",
        sections: [{ instruction: "i", format: "list" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("title");
    }
  });

  test("rejects a section with a missing instruction", () => {
    const result = parseTemplateDefinition(
      JSON.stringify({
        name: "n",
        description: "d",
        sections: [{ title: "t", format: "list" }],
      }),
    );
    expect(result.ok).toBe(false);
  });

  test("rejects an unsupported section format", () => {
    const result = parseTemplateDefinition(
      JSON.stringify({
        name: "n",
        description: "d",
        sections: [{ title: "t", instruction: "i", format: "table" }],
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("format");
    }
  });

  test("ignores blank optional item formats", () => {
    const result = parseTemplateDefinition(
      JSON.stringify({
        name: "n",
        description: "d",
        sections: [
          {
            title: "t",
            instruction: "i",
            format: "list",
            item_format: "",
            example_item_format: "   ",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sections[0].item_format).toBeUndefined();
      expect(result.value.sections[0].example_item_format).toBeUndefined();
    }
  });
});

describe("validateTemplateDefinition", () => {
  test("returns no errors for a valid definition", () => {
    const errors = validateTemplateDefinition({
      name: "n",
      description: "d",
      sections: [{ title: "t", instruction: "i", format: "paragraph" }],
    });
    expect(errors).toEqual({});
  });

  test("reports field-level errors", () => {
    const errors = validateTemplateDefinition(createEmptyDefinition());
    expect(errors.name).toBeDefined();
    expect(errors.description).toBeDefined();
    expect(errors.sections?.[0]).toEqual({
      title: "Section title is required",
      instruction: "Instruction is required",
    });
  });

  test("reports an error when there are no sections", () => {
    const errors = validateTemplateDefinition({ name: "n", description: "d", sections: [] });
    expect(errors.form).toBeDefined();
    expect(errors.sections).toBeUndefined();
  });

  test("flags an invalid format per section", () => {
    const errors = validateTemplateDefinition({
      name: "n",
      description: "d",
      sections: [
        { title: "ok", instruction: "ok", format: "list" },
        { title: "bad", instruction: "bad", format: "table" as never },
      ],
    });
    expect(errors.sections?.[0]).toBeNull();
    expect(errors.sections?.[1]?.format).toBeDefined();
  });
});

describe("definitionToJson", () => {
  test("round-trips through parseTemplateDefinition", () => {
    const def = {
      name: "  Weekly Review  ",
      description: "End of week review",
      sections: [
        {
          title: "Summary",
          instruction: "Provide a summary",
          format: "paragraph" as const,
        },
        {
          title: "Action Items",
          instruction: "List follow-ups",
          format: "list" as const,
          item_format: "| **Owner** | **Item** |",
          example_item_format: "",
        },
      ],
    };

    const parsed = parseTemplateDefinition(definitionToJson(def));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.name).toBe("Weekly Review");
      expect(parsed.value.sections[1].item_format).toBe("| **Owner** | **Item** |");
      expect(parsed.value.sections[1].example_item_format).toBeUndefined();
    }
  });

  test("produces valid JSON accepted by the backend schema", () => {
    const def = createEmptyDefinition();
    def.name = "Test";
    def.description = "Test";
    def.sections[0].title = "Summary";
    def.sections[0].instruction = "Summarize";

    const raw = JSON.parse(definitionToJson(def));
    expect(raw.name).toBe("Test");
    expect(raw.sections[0].format).toBe("paragraph");
    expect(Object.keys(raw.sections[0])).not.toContain("item_format");
  });
});

describe("slugifyTemplateId", () => {
  test("lowercases and replaces separators", () => {
    expect(slugifyTemplateId("Weekly Review!")).toBe("weekly_review");
  });

  test("falls back for empty slugs", () => {
    expect(slugifyTemplateId("!!!")).toBe("custom_template");
  });

  test("collapses consecutive separators", () => {
    expect(slugifyTemplateId("A  B--C")).toBe("a_b_c");
  });
});

describe("isValidTemplateId", () => {
  test("accepts lowercase ids with underscores", () => {
    expect(isValidTemplateId("weekly_review_2")).toBe(true);
  });

  test("rejects uppercase, spaces, and dashes", () => {
    expect(isValidTemplateId("Weekly Review")).toBe(false);
    expect(isValidTemplateId("weekly-review")).toBe(false);
    expect(isValidTemplateId("weekly.review")).toBe(false);
  });
});

describe("template source helpers", () => {
  test("only custom templates are editable/deletable", () => {
    expect(isCustomTemplate({ source: "custom" })).toBe(true);
    expect(isCustomTemplate({ source: "builtin" })).toBe(false);
    expect(isCustomTemplate({ source: "bundled" })).toBe(false);
    expect(isCustomTemplate({ source: "unknown" })).toBe(false);
  });

  test("built-in ids are protected even when source is unknown", () => {
    for (const id of BUILTIN_TEMPLATE_IDS) {
      expect(isBuiltinTemplate({ id, source: "unknown" })).toBe(true);
    }
  });
});
