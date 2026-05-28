import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createStructuredLogger,
  redactToken,
  redactStderr
} from "../src/structured-logger.js";
import type { StructuredLogEvent } from "../src/modules.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      if (typeof chunk === "string") lines.push(chunk);
      return true;
    });
  return {
    lines,
    restore: () => {
      spy.mockRestore();
    }
  };
}

function parseLog(line: string): Record<string, unknown> {
  return JSON.parse(line.trimEnd()) as Record<string, unknown>;
}

function parsedLines(lines: string[]): Array<Record<string, unknown>> {
  return lines.filter((l) => l.trim()).map(parseLog);
}

// ---------------------------------------------------------------------------
// Tests: createStructuredLogger — stderr-only (no filePath)
// ---------------------------------------------------------------------------

describe("StructuredLogger — stderr-only (no filePath)", () => {
  it("emits log_file_path_not_configured warn on stderr when created without config", () => {
    const { lines, restore } = captureStderr();
    createStructuredLogger();
    restore();

    const parsed = parsedLines(lines);
    const warn = parsed.find(
      (p) => p["event"] === "log_file_path_not_configured"
    );
    expect(warn).toBeDefined();
    expect(warn?.["level"]).toBe("warn");
  });

  it("emits log_file_path_not_configured warn on stderr when filePath is absent in config", () => {
    const { lines, restore } = captureStderr();
    createStructuredLogger({ level: "info", format: "json" });
    restore();

    const parsed = parsedLines(lines);
    const warn = parsed.find(
      (p) => p["event"] === "log_file_path_not_configured"
    );
    expect(warn).toBeDefined();
  });

  it("info() writes JSON with level=info to stderr", () => {
    const { lines, restore } = captureStderr();
    const logger = createStructuredLogger({ level: "info", format: "json" });

    logger.info({ event: "runtime.started" });

    restore();
    const parsed = parsedLines(lines);
    const entry = parsed.find((p) => p["event"] === "runtime.started");
    expect(entry).toBeDefined();
    expect(entry?.["level"]).toBe("info");
  });

  it("warn() writes JSON with level=warn to stderr", () => {
    const { lines, restore } = captureStderr();
    const logger = createStructuredLogger({ level: "info", format: "json" });

    logger.warn({ event: "session.corrupt" });

    restore();
    const parsed = parsedLines(lines);
    const entry = parsed.find((p) => p["event"] === "session.corrupt");
    expect(entry).toBeDefined();
    expect(entry?.["level"]).toBe("warn");
  });

  it("error() writes JSON with level=error to stderr", () => {
    const { lines, restore } = captureStderr();
    const logger = createStructuredLogger({ level: "info", format: "json" });

    logger.error({ event: "cli.execute.failure", errorCategory: "timeout" });

    restore();
    const parsed = parsedLines(lines);
    const entry = parsed.find((p) => p["event"] === "cli.execute.failure");
    expect(entry).toBeDefined();
    expect(entry?.["level"]).toBe("error");
    expect(entry?.["errorCategory"]).toBe("timeout");
  });

  it("emits correlation fields when present", () => {
    const { lines, restore } = captureStderr();
    const logger = createStructuredLogger({ level: "info", format: "json" });

    const ev: StructuredLogEvent = {
      event: "job.started",
      requestId: "req-abc",
      guildId: "guild-123",
      channelId: "chan-456",
      threadId: "thread-789"
    };
    logger.info(ev);

    restore();
    const parsed = parsedLines(lines);
    const entry = parsed.find((p) => p["event"] === "job.started");
    expect(entry?.["requestId"]).toBe("req-abc");
    expect(entry?.["guildId"]).toBe("guild-123");
    expect(entry?.["channelId"]).toBe("chan-456");
    expect(entry?.["threadId"]).toBe("thread-789");
  });

  it("emits jobStatus, durationMs, exitCode when present", () => {
    const { lines, restore } = captureStderr();
    const logger = createStructuredLogger({ level: "info", format: "json" });

    logger.info({
      event: "job.completed",
      jobStatus: "success",
      durationMs: 1234,
      exitCode: 0
    });

    restore();
    const parsed = parsedLines(lines);
    const entry = parsed.find((p) => p["event"] === "job.completed");
    expect(entry?.["jobStatus"]).toBe("success");
    expect(entry?.["durationMs"]).toBe(1234);
    expect(entry?.["exitCode"]).toBe(0);
  });

  it("includes a timestamp field", () => {
    const { lines, restore } = captureStderr();
    const logger = createStructuredLogger({ level: "info", format: "json" });

    logger.info({ event: "test.event" });

    restore();
    const parsed = parsedLines(lines);
    const entry = parsed.find((p) => p["event"] === "test.event");
    expect(typeof entry?.["ts"]).toBe("string");
  });

  it("omits undefined fields from output", () => {
    const { lines, restore } = captureStderr();
    const logger = createStructuredLogger({ level: "info", format: "json" });

    logger.info({ event: "test.event", requestId: undefined });

    restore();
    const parsed = parsedLines(lines);
    const entry = parsed.find((p) => p["event"] === "test.event");
    expect(entry && "requestId" in entry).toBe(false);
  });

  it("close() resolves immediately in stderr-only mode", async () => {
    const { restore } = captureStderr();
    const logger = createStructuredLogger({ level: "info", format: "json" });
    restore();

    await expect(logger.close()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: createStructuredLogger — file mode (filePath provided)
// ---------------------------------------------------------------------------

describe("StructuredLogger — file mode (filePath provided)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "structured-logger-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits log_file_opened info on stderr when filePath is set", () => {
    const filePath = path.join(tmpDir, "app.log");
    const { lines, restore } = captureStderr();
    createStructuredLogger({ level: "info", format: "json", filePath });
    restore();

    const parsed = parsedLines(lines);
    const opened = parsed.find((p) => p["event"] === "log_file_opened");
    expect(opened).toBeDefined();
    expect(opened?.["level"]).toBe("info");
  });

  it("creates parent directories automatically if they do not exist", () => {
    const filePath = path.join(tmpDir, "nested", "deep", "app.log");
    const { restore } = captureStderr();
    createStructuredLogger({ level: "info", format: "json", filePath });
    restore();

    expect(fs.existsSync(path.dirname(filePath))).toBe(true);
  });

  it("writes log entries to file AND stderr simultaneously", async () => {
    const filePath = path.join(tmpDir, "app.log");
    const { lines, restore } = captureStderr();
    const logger = createStructuredLogger({
      level: "info",
      format: "json",
      filePath
    });

    logger.info({ event: "test.dual" });
    await logger.close();
    restore();

    const stderrHasEntry = parsedLines(lines).some(
      (p) => p["event"] === "test.dual"
    );
    expect(stderrHasEntry).toBe(true);

    const fileContent = fs.readFileSync(filePath, "utf8");
    const fileParsed = parsedLines(fileContent.split("\n"));
    const fileHasEntry = fileParsed.some((p) => p["event"] === "test.dual");
    expect(fileHasEntry).toBe(true);
  });

  it("close() flushes the file stream before resolving", async () => {
    const filePath = path.join(tmpDir, "app.log");
    const { restore } = captureStderr();
    const logger = createStructuredLogger({
      level: "info",
      format: "json",
      filePath
    });

    logger.info({ event: "before.close" });
    await logger.close();
    restore();

    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("before.close");
  });
});

// ---------------------------------------------------------------------------
// Tests: stream error → stderr fallback
// ---------------------------------------------------------------------------

describe("StructuredLogger — stream error fallback", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "structured-logger-err-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits log_write_failed on stderr and continues logging to stderr after stream error", async () => {
    const stderrLines: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        if (typeof chunk === "string") stderrLines.push(chunk);
        return true;
      });

    const logger = createStructuredLogger({
      level: "info",
      format: "json",
      filePath: tmpDir
    });

    // Opening a directory as a file causes the write stream to emit an error.
    await new Promise((r) => setTimeout(r, 100));

    logger.info({ event: "after.fallback" });
    await logger.close();
    spy.mockRestore();

    const parsed = parsedLines(stderrLines);
    const writeFailed = parsed.find((p) => p["event"] === "log_write_failed");
    const afterFallback = parsed.find((p) => p["event"] === "after.fallback");
    expect(writeFailed).toBeDefined();
    expect(afterFallback).toBeDefined();
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
