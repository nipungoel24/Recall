import { beforeEach, describe, expect, mock, test } from "bun:test";

const invokeMock = mock(async () => null);

mock.module("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const {
  TemplateServiceError,
  deleteTemplate,
  getTemplateDefinition,
  listTemplates,
  normalizeTemplateInfo,
  saveTemplate,
  validateTemplateOnBackend,
} = await import("../../src/services/templateService");

const VALID_TEMPLATE_JSON = JSON.stringify({
  name: "Weekly Review",
  description: "End of week review",
  sections: [{ title: "Summary", instruction: "Summarize", format: "paragraph" }],
});

describe("normalizeTemplateInfo", () => {
  test("passes through a known source", () => {
    expect(
      normalizeTemplateInfo({ id: "x", name: "X", description: "d", source: "custom" }),
    ).toEqual({ id: "x", name: "X", description: "d", source: "custom" });
  });

  test("falls back to builtin for known built-in ids", () => {
    expect(normalizeTemplateInfo({ id: "daily_standup", name: "n", description: "d" })).toMatchObject({
      source: "builtin",
    });
  });

  test("treats unknown sources as read-only", () => {
    expect(normalizeTemplateInfo({ id: "mystery", name: "n", description: "d" })).toMatchObject({
      source: "unknown",
    });
  });

  test("tolerates a malformed entry", () => {
    const info = normalizeTemplateInfo({});
    expect(info.id).toBe("");
    expect(info.source).toBe("unknown");
  });
});

describe("listTemplates", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("maps raw dtos into normalized templates", async () => {
    invokeMock.mockResolvedValueOnce([
      { id: "daily_standup", name: "Daily Standup", description: "d" },
      { id: "my_own", name: "My Own", description: "c", source: "custom" },
    ]);

    const templates = await listTemplates();
    expect(templates).toEqual([
      { id: "daily_standup", name: "Daily Standup", description: "d", source: "builtin" },
      { id: "my_own", name: "My Own", description: "c", source: "custom" },
    ]);
  });

  test("returns an empty list for a non-array response", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await expect(listTemplates()).resolves.toEqual([]);
  });

  test("wraps backend errors", async () => {
    invokeMock.mockRejectedValueOnce("boom");
    await expect(listTemplates()).rejects.toThrow(TemplateServiceError);

    invokeMock.mockRejectedValueOnce("boom");
    await expect(listTemplates()).rejects.toThrow("boom");
  });
});

describe("saveTemplate", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("rejects malformed templates client-side without calling the backend", async () => {
    await expect(saveTemplate("x", "{ not json")).rejects.toThrow(TemplateServiceError);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  test("normalizes the saved template as custom", async () => {
    invokeMock.mockResolvedValueOnce([]);
    invokeMock.mockResolvedValueOnce({ id: "weekly_review", name: "Weekly Review", description: "d" });

    const saved = await saveTemplate("weekly_review", VALID_TEMPLATE_JSON);
    expect(saved).toMatchObject({ id: "weekly_review", source: "custom" });
    expect(invokeMock).toHaveBeenCalledWith("api_create_custom_template", {
      templateId: "weekly_review",
      templateJson: VALID_TEMPLATE_JSON,
    });
  });

  test("updates an existing custom template via the update command", async () => {
    invokeMock.mockResolvedValueOnce([
      { id: "weekly_review", name: "Weekly Review", description: "d", source: "custom" },
    ]);
    invokeMock.mockResolvedValueOnce({ id: "weekly_review", name: "Weekly Review", description: "d" });

    const saved = await saveTemplate("weekly_review", VALID_TEMPLATE_JSON);
    expect(saved).toMatchObject({ id: "weekly_review", source: "custom" });
    expect(invokeMock).toHaveBeenCalledWith("api_update_custom_template", {
      templateId: "weekly_review",
      templateJson: VALID_TEMPLATE_JSON,
    });
  });

  test("surfaces backend validation errors", async () => {
    invokeMock.mockResolvedValueOnce([]);
    invokeMock.mockRejectedValueOnce("Template name cannot be empty");
    await expect(saveTemplate("x", VALID_TEMPLATE_JSON)).rejects.toThrow(
      "Template name cannot be empty",
    );
  });
});

describe("validateTemplateOnBackend", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("returns the validated template name", async () => {
    invokeMock.mockResolvedValueOnce("Weekly Review");
    await expect(validateTemplateOnBackend(VALID_TEMPLATE_JSON)).resolves.toBe("Weekly Review");
  });

  test("surfaces backend validation errors", async () => {
    invokeMock.mockRejectedValueOnce("Section 0 has empty title");
    await expect(validateTemplateOnBackend(VALID_TEMPLATE_JSON)).rejects.toThrow(
      "Section 0 has empty title",
    );
  });
});

describe("getTemplateDefinition", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("parses the raw template JSON from the backend", async () => {
    invokeMock.mockResolvedValueOnce(VALID_TEMPLATE_JSON);
    const def = await getTemplateDefinition("weekly_review");
    expect(def.name).toBe("Weekly Review");
    expect(def.sections).toHaveLength(1);
  });

  test("rejects a malformed backend payload", async () => {
    invokeMock.mockResolvedValueOnce("{}");
    await expect(getTemplateDefinition("weekly_review")).rejects.toThrow(TemplateServiceError);
  });
});

describe("deleteTemplate", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("calls the backend delete command", async () => {
    invokeMock.mockResolvedValueOnce(null);
    await deleteTemplate("weekly_review");
    expect(invokeMock).toHaveBeenCalledWith("api_delete_custom_template", {
      templateId: "weekly_review",
    });
  });

  test("surfaces backend rejects for built-in templates", async () => {
    invokeMock.mockRejectedValueOnce("Cannot delete built-in template 'daily_standup'");
    await expect(deleteTemplate("daily_standup")).rejects.toThrow(
      "Cannot delete built-in template 'daily_standup'",
    );
  });
});
