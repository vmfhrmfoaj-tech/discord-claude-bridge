import { describe, expect, it } from "vitest";

import type { StructuredLogEvent, StructuredLogger } from "../src/modules.js";
import { runClaudeSmoke } from "../src/smoke-claude.js";

class MemoryLogger implements StructuredLogger {
  events: StructuredLogEvent[] = [];

  info(ev: StructuredLogEvent): void {
    this.events.push(ev);
  }

  warn(ev: StructuredLogEvent): void {
    this.events.push(ev);
  }

  error(ev: StructuredLogEvent): void {
    this.events.push(ev);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

const maybeIt = process.env["RUN_CLAUDE_SMOKE"] === "1" ? it : it.skip;

describe("real Claude CLI smoke", () => {
  maybeIt(
    "calls the real Claude CLI adapter path when explicitly enabled",
    async () => {
      const logger = new MemoryLogger();
      const output: string[] = [];

      const outcome = await runClaudeSmoke({
        logger,
        writeOutput: (text) => output.push(text)
      });

      expect([0, 1]).toContain(outcome.exitCode);
      expect(["success", "failure"]).toContain(outcome.report.result.kind);
      expect(typeof outcome.report.stdoutPreview).toBe("string");
      expect(typeof outcome.report.stderrPreview).toBe("string");
      expect(output.join("\n")).toContain('"result"');
      expect(logger.events.map((event) => event.event)).toContain(
        "smoke.claude.starting"
      );

      if (outcome.report.result.kind === "success") {
        expect(outcome.exitCode).toBe(0);
        expect(outcome.report.result.text.length).toBeGreaterThan(0);
        expect(outcome.report.exitCode).toBe(0);
      } else {
        expect(outcome.exitCode).toBe(1);
        expect(outcome.report.result.category.length).toBeGreaterThan(0);
        expect(
          logger.events.some((event) => event.event === "smoke.claude.failed")
        ).toBe(true);
      }
    },
    180_000
  );
});
