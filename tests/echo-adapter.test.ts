import { describe, expect, it } from "vitest";

import { createEchoAdapter } from "../src/echo-adapter.js";

describe("createEchoAdapter", () => {
  it("returns success with [에코] prefix", async () => {
    const adapter = createEchoAdapter({ delayMs: 0 });
    const result = await adapter.execute({
      prompt: "hello world",
      timeoutMs: 5000
    });

    expect(result).toEqual({
      kind: "success",
      text: "[에코] hello world",
      exitCode: 0,
      sessionId: undefined
    });
  });

  it("echoes prompt exactly as given", async () => {
    const adapter = createEchoAdapter({ delayMs: 0 });
    const result = await adapter.execute({
      prompt: "테스트 메시지",
      timeoutMs: 5000
    });

    expect(result.kind).toBe("success");
    if (result.kind === "success") {
      expect(result.text).toBe("[에코] 테스트 메시지");
    }
  });

  it("ignores sessionId and model params — always returns success", async () => {
    const adapter = createEchoAdapter({ delayMs: 0 });
    const result = await adapter.execute({
      prompt: "ping",
      timeoutMs: 5000,
      sessionId: "some-session",
      model: "claude-opus"
    });

    expect(result.kind).toBe("success");
  });

  it("waits 3 seconds by default using the injected sleeper", async () => {
    const sleepCalls: number[] = [];
    const adapter = createEchoAdapter({
      sleep(delayMs) {
        sleepCalls.push(delayMs);
        return Promise.resolve();
      }
    });

    await adapter.execute({ prompt: "ping", timeoutMs: 5000 });

    expect(sleepCalls).toEqual([3000]);
  });
});
