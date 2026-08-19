import { beforeEach, describe, expect, mock, test } from "bun:test";

const invokeMock = mock(async () => null);

mock.module("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

const { configService } = await import("../../src/services/configService");

describe("configService request deduplication", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => null);
  });

  test("concurrent fetches for the same key share one backend call", async () => {
    let resolveBackend: (v: string | null) => void = () => {};
    invokeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBackend = resolve;
        }),
    );

    const first = configService.getApiKey("claude");
    const second = configService.getApiKey("claude");
    const third = configService.getApiKey("claude");

    resolveBackend("key-123");

    const results = await Promise.all([first, second, third]);
    expect(results).toEqual(["key-123", "key-123", "key-123"]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("api_get_api_key", { provider: "claude" });
  });

  test("different providers are fetched independently", async () => {
    invokeMock.mockImplementation(async (_cmd: string, args: { provider: string }) =>
      `key-${args.provider}`,
    );

    const [a, b] = await Promise.all([
      configService.getApiKey("claude"),
      configService.getApiKey("groq"),
    ]);
    expect(a).toBe("key-claude");
    expect(b).toBe("key-groq");
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  test("settled requests are not cached: a later call hits the backend again", async () => {
    invokeMock.mockResolvedValueOnce("old-key");
    await expect(configService.getApiKey("openai")).resolves.toBe("old-key");
    await new Promise((r) => setTimeout(r, 10)); // let the dedupe entry settle

    invokeMock.mockResolvedValueOnce("new-key");
    await expect(configService.getApiKey("openai")).resolves.toBe("new-key");
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  test("rejections are shared but not cached", async () => {
    invokeMock.mockRejectedValueOnce("backend down");
    const first = configService.getModelConfig();
    const second = configService.getModelConfig();
    const firstErr = await first.then(
      () => null,
      (e: unknown) => e,
    );
    const secondErr = await second.then(
      () => null,
      (e: unknown) => e,
    );
    expect(firstErr).toBe("backend down");
    expect(secondErr).toBe("backend down");
    expect(invokeMock).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 10));
    invokeMock.mockResolvedValueOnce({ provider: "builtin-ai", model: "qwen3.5:4b", whisperModel: "large-v3" });
    const retried = await configService.getModelConfig();
    expect(retried).toMatchObject({ provider: "builtin-ai" });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });
});
