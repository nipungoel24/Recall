import { beforeEach, describe, expect, mock, test } from "bun:test";

const invokeMock = mock(async () => null);

mock.module("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const daily = await import("../../src/services/dailyService");
const { MeetingService } = await import("../../src/services/meetingService");

const COMMAND_NOT_FOUND = "command api_generate_daily_summary not found";

describe("requestDailyBrief (dedicated backend path)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("invokes the dedicated command with the date key and meeting ids", async () => {
    invokeMock.mockResolvedValueOnce({ processId: "p-1" });
    const result = await daily.requestDailyBrief("2026-08-15", ["meeting-a", "meeting-b"]);
    expect(result).toEqual({ processId: "p-1" });
    expect(invokeMock).toHaveBeenCalledWith("api_generate_daily_summary", {
      date: "2026-08-15",
      meetingIds: ["meeting-a", "meeting-b"],
    });
  });

  test("command-not-found is wrapped as DailyBriefCommandUnavailableError", async () => {
    invokeMock.mockRejectedValueOnce(COMMAND_NOT_FOUND);
    await expect(daily.requestDailyBrief("2026-08-15", ["m"])).rejects.toThrow(
      daily.DailyBriefCommandUnavailableError,
    );
  });

  test("non-missing-command errors pass through untouched", async () => {
    const boom = new Error("provider 500");
    invokeMock.mockRejectedValueOnce(boom);
    await expect(daily.requestDailyBrief("2026-08-15", ["m"])).rejects.toBe(boom);
  });
});

describe("getDailyBriefStatus", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("returns the status payload", async () => {
    invokeMock.mockResolvedValueOnce({ status: "completed", data: { markdown: "# x" } });
    const status = await daily.getDailyBriefStatus("2026-08-15");
    expect(status.status).toBe("completed");
    expect(invokeMock).toHaveBeenCalledWith("api_get_daily_summary", { date: "2026-08-15" });
  });

  test("command-not-found wraps with fallback signal", async () => {
    invokeMock.mockRejectedValueOnce("unknown command api_get_daily_summary");
    await expect(daily.getDailyBriefStatus("2026-08-15")).rejects.toThrow(
      daily.DailyBriefCommandUnavailableError,
    );
  });
});

describe("cancelDailyBrief", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("missing command is swallowed (fallback safe)", async () => {
    invokeMock.mockRejectedValueOnce(COMMAND_NOT_FOUND);
    await expect(daily.cancelDailyBrief("2026-08-15")).resolves.toBeUndefined();
  });

  test("other failures never throw to the UI", async () => {
    invokeMock.mockRejectedValueOnce("backend exploded");
    await expect(daily.cancelDailyBrief("2026-08-15")).resolves.toBeUndefined();
  });
});

describe("startLegacyDailyBrief (fallback pipeline)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("reuses the per-meeting summary pipeline with a synthetic meeting id", async () => {
    invokeMock.mockResolvedValueOnce({ process_id: "proc-7" });
    const { processId } = await daily.startLegacyDailyBrief(
      "2026-08-15",
      "combined transcript",
      "ollama",
      "llama3",
      "custom instructions",
    );
    expect(processId).toBe("proc-7");
    expect(invokeMock).toHaveBeenCalledWith("api_process_transcript", {
      text: "combined transcript",
      model: "ollama",
      modelName: "llama3",
      meetingId: "daily-brief-2026-08-15",
      chunkSize: 40000,
      overlap: 1000,
      customPrompt: "custom instructions",
      templateId: "daily_standup",
      summaryLanguage: null,
    });
  });

  test("accepts camelCase processId payloads too", async () => {
    invokeMock.mockResolvedValueOnce({ processId: "proc-8" });
    const { processId } = await daily.startLegacyDailyBrief(
      "2026-08-16",
      "text",
      "ollama",
      "llama3",
      "p",
    );
    expect(processId).toBe("proc-8");
  });
});

describe("getLegacyDailyBriefStatus", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("normalizes status case and parses string data", async () => {
    invokeMock.mockResolvedValueOnce({
      status: "COMPLETED",
      data: JSON.stringify({ markdown: "# done" }),
      error: null,
    });
    const status = await daily.getLegacyDailyBriefStatus("2026-08-15");
    expect(status.status).toBe("completed");
    expect(status.data?.markdown).toBe("# done");
    expect(status.error).toBeNull();
  });

  test("surfaces provider failures in the error field", async () => {
    invokeMock.mockResolvedValueOnce({ status: "failed", data: null, error: "provider down" });
    const status = await daily.getLegacyDailyBriefStatus("2026-08-15");
    expect(status.status).toBe("failed");
    expect(status.error).toBe("provider down");
    expect(status.data).toBeUndefined();
  });

  test("tolerates garbage data payloads", async () => {
    invokeMock.mockResolvedValueOnce({ status: "completed", data: "not json", error: null });
    const status = await daily.getLegacyDailyBriefStatus("2026-08-15");
    expect(status.data).toBeUndefined();
  });
});

describe("fetchTranscriptBounds", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("zero transcripts: single call, null bounds", async () => {
    invokeMock.mockResolvedValueOnce({ transcripts: [], total_count: 0, has_more: false });
    const bounds = await daily.fetchTranscriptBounds("meeting-1");
    expect(bounds).toEqual({ first: null, last: null, total: 0 });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("api_get_meeting_transcripts", {
      meetingId: "meeting-1",
      limit: 1,
      offset: 0,
    });
  });

  test("single transcript: last mirrors first, one call", async () => {
    const t = { id: "t1", text: "x", timestamp: "09:00:00" };
    invokeMock.mockResolvedValueOnce({ transcripts: [t], total_count: 1, has_more: false });
    const bounds = await daily.fetchTranscriptBounds("meeting-1");
    expect(bounds.total).toBe(1);
    expect(bounds.first?.id).toBe("t1");
    expect(bounds.last?.id).toBe("t1");
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  test("many transcripts: second call fetches the final row", async () => {
    invokeMock
      .mockResolvedValueOnce({ transcripts: [{ id: "t0", text: "a", timestamp: "09:00:00" }], total_count: 5, has_more: true })
      .mockResolvedValueOnce({ transcripts: [{ id: "t4", text: "e", timestamp: "09:30:00" }], total_count: 5, has_more: false });
    const bounds = await daily.fetchTranscriptBounds("meeting-1");
    expect(bounds.total).toBe(5);
    expect(bounds.first?.id).toBe("t0");
    expect(bounds.last?.id).toBe("t4");
    expect(invokeMock).toHaveBeenLastCalledWith("api_get_meeting_transcripts", {
      meetingId: "meeting-1",
      limit: 1,
      offset: 4,
    });
  });
});

describe("fetchAllTranscripts", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("empty meeting returns [] without a second call", async () => {
    invokeMock.mockResolvedValueOnce({ transcripts: [], total_count: 0, has_more: false });
    await expect(daily.fetchAllTranscripts("meeting-1")).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  test("fetches everything in one page sized by total_count", async () => {
    invokeMock
      .mockResolvedValueOnce({ transcripts: [], total_count: 3, has_more: true })
      .mockResolvedValueOnce({ transcripts: ["a", "b", "c"], total_count: 3, has_more: false });
    const all = await daily.fetchAllTranscripts("meeting-1");
    expect(all).toEqual(["a", "b", "c"]);
    expect(invokeMock).toHaveBeenLastCalledWith("api_get_meeting_transcripts", {
      meetingId: "meeting-1",
      limit: 3,
      offset: 0,
    });
  });
});

describe("fetchMeetingMetadata caching", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    daily.clearDailyMetadataCache();
  });

  test("caches metadata per session and invalidates via clearDailyMetadataCache", async () => {
    const meta = { id: "m1", title: "M1", created_at: "c", updated_at: "u", folder_path: null };
    invokeMock.mockResolvedValue(meta);
    await daily.fetchMeetingMetadata("m1");
    await daily.fetchMeetingMetadata("m1");
    expect(invokeMock).toHaveBeenCalledTimes(1);

    daily.clearDailyMetadataCache();
    await daily.fetchMeetingMetadata("m1");
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchMeetingSummary", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("keeps object data and defaults missing status to idle", async () => {
    invokeMock.mockResolvedValueOnce({ data: { markdown: "# s" } });
    const lookup = await daily.fetchMeetingSummary("meeting-1");
    expect(lookup.status).toBe("idle");
    expect(lookup.data?.markdown).toBe("# s");
  });

  test("parses stringified data payloads", async () => {
    invokeMock.mockResolvedValueOnce({ status: "completed", data: JSON.stringify({ markdown: "# s" }) });
    const lookup = await daily.fetchMeetingSummary("meeting-1");
    expect(lookup.data?.markdown).toBe("# s");
  });
});

describe("MeetingService.getMeetingsByDateRange", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  test("sends UTC ISO instants computed from local day boundaries", async () => {
    invokeMock.mockResolvedValueOnce([]);
    const start = new Date(2026, 7, 15, 0, 0, 0, 0);
    const end = new Date(2026, 7, 16, 0, 0, 0, 0);
    await new MeetingService().getMeetingsByDateRange(start, end);
    expect(invokeMock).toHaveBeenCalledWith("api_get_meetings_by_range", {
      startUtc: start.toISOString(),
      endUtc: end.toISOString(),
    });
  });

  test("surfaces backend range errors", async () => {
    invokeMock.mockRejectedValueOnce("start_date must be strictly before end_date");
    await expect(
      new MeetingService().getMeetingsByDateRange(new Date(), new Date()),
    ).rejects.toThrow("start_date must be strictly before end_date");
  });
});
