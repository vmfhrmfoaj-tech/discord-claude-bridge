import { describe, expect, it, vi } from "vitest";

import {
  createStructuredLogger,
  redactToken,
  redactStderr
} from "../src/structured-logger.js";
import type { StructuredLogEvent } from "../src/modules.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureConsoleLogs(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((msg: string) => {
    logs.push(msg);
  });
  return {
    logs,
    restore: () => {
      spy.mockRestore();
    }
  };
}

function captureConsoleWarn(): { warns: string[]; restore: () => void } {
  const warns: string[] = [];
  const spy = vi.spyOn(console, "warn").mockImplementation((msg: string) => {
    warns.push(msg);
  });
  return {
    warns,
    restore: () => {
      spy.mockRestore();
    }
  };
}

function captureConsoleError(): { errors: string[]; restore: () => void } {
  const errors: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((msg: string) => {
    errors.push(msg);
  });
  return {
    errors,
    restore: () => {
      spy.mockRestore();
    }
  };
}

function parseLog(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests: createStructuredLogger
// ---------------------------------------------------------------------------

describe("StructuredLogger", () => {
  describe("info level", () => {
    it("emits JSON line with event field via console.log", () => {
      const { logs, restore } = captureConsoleLogs();
      const logger = createStructuredLogger();

      logger.info({ event: "runtime.started" });

      restore();
      expect(logs).toHaveLength(1);
      const parsed = parseLog(logs[0] ?? "");
      expect(parsed["event"]).toBe("runtime.started");
      expect(parsed["level"]).toBe("info");
    });

    it("emits correlation fields when present", () => {
      const { logs, restore } = captureConsoleLogs();
      const logger = createStructuredLogger();

      const ev: StructuredLogEvent = {
        event: "job.started",
        requestId: "req-abc",
        guildId: "guild-123",
        channelId: "chan-456",
        threadId: "thread-789"
      };
      logger.info(ev);

      restore();
      const parsed = parseLog(logs[0] ?? "");
      expect(parsed["requestId"]).toBe("req-abc");
      expect(parsed["guildId"]).toBe("guild-123");
      expect(parsed["channelId"]).toBe("chan-456");
      expect(parsed["threadId"]).toBe("thread-789");
    });

    it("emits jobStatus, durationMs, exitCode, errorCategory when present", () => {
      const { logs, restore } = captureConsoleLogs();
      const logger = createStructuredLogger();

      logger.info({
        event: "job.completed",
        jobStatus: "success",
        durationMs: 1234,
        exitCode: 0,
        errorCategory: undefined
      });

      restore();
      const parsed = parseLog(logs[0] ?? "");
      expect(parsed["jobStatus"]).toBe("success");
      expect(parsed["durationMs"]).toBe(1234);
      expect(parsed["exitCode"]).toBe(0);
    });

    it("includes a timestamp field", () => {
      const { logs, restore } = captureConsoleLogs();
      const logger = createStructuredLogger();

      logger.info({ event: "test.event" });

      restore();
      const parsed = parseLog(logs[0] ?? "");
      expect(typeof parsed["ts"]).toBe("string");
    });

    it("omits undefined fields from output", () => {
      const { logs, restore } = captureConsoleLogs();
      const logger = createStructuredLogger();

      logger.info({ event: "test.event", requestId: undefined });

      restore();
      const parsed = parseLog(logs[0] ?? "");
      expect("requestId" in parsed).toBe(false);
    });
  });

  describe("warn level", () => {
    it("emits JSON line with level=warn via console.warn", () => {
      const { warns, restore } = captureConsoleWarn();
      const logger = createStructuredLogger();

      logger.warn({ event: "session.corrupt" });

      restore();
      expect(warns).toHaveLength(1);
      const parsed = parseLog(warns[0] ?? "");
      expect(parsed["event"]).toBe("session.corrupt");
      expect(parsed["level"]).toBe("warn");
    });
  });

  describe("error level", () => {
    it("emits JSON line with level=error via console.error", () => {
      const { errors, restore } = captureConsoleError();
      const logger = createStructuredLogger();

      logger.error({ event: "cli.execute.failure", errorCategory: "timeout" });

      restore();
      expect(errors).toHaveLength(1);
      const parsed = parseLog(errors[0] ?? "");
      expect(parsed["event"]).toBe("cli.execute.failure");
      expect(parsed["level"]).toBe("error");
      expect(parsed["errorCategory"]).toBe("timeout");
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: redactToken
// ---------------------------------------------------------------------------

describe("redactToken", () => {
  it("masks all but last 4 chars of a long token", () => {
    const token = "Bot abcdefghijklmnopqrstuvwxyz1234";
    const result = redactToken(token);
    expect(result.endsWith("1234")).toBe(true);
    expect(result).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });

  it("uses * for masked characters", () => {
    const token = "abcdefgh";
    const result = redactToken(token);
    const stars = result.slice(0, result.length - 4);
    expect(stars).toMatch(/^\*+$/);
  });

  it("shows last 4 chars unchanged", () => {
    const token = "supersecrettoken1234";
    const result = redactToken(token);
    expect(result.slice(-4)).toBe("1234");
  });

  it("fully masks tokens of 4 chars or fewer", () => {
    const result = redactToken("abcd");
    expect(result).toMatch(/^\*+$/);
  });

  it("returns all stars for empty string", () => {
    const result = redactToken("");
    expect(result).toBe("****");
  });
});

// ---------------------------------------------------------------------------
// Tests: redactStderr
// ---------------------------------------------------------------------------

describe("redactStderr", () => {
  it("passes through stderr under 200 chars unchanged", () => {
    const short = "some error output";
    expect(redactStderr(short)).toBe(short);
  });

  it("truncates stderr exceeding 200 chars to exactly 200 chars", () => {
    const long = "X".repeat(300);
    const result = redactStderr(long);
    expect(result.length).toBe(200);
  });

  it("appends truncation marker when stderr is truncated", () => {
    const long = "X".repeat(300);
    const result = redactStderr(long);
    expect(result.endsWith("…")).toBe(true);
  });
});
