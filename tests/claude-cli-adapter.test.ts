import { describe, expect, it } from "vitest";

import { createClaudeCliAdapter } from "../src/claude-cli-adapter.js";
import type {
  ProcessRunOptions,
  ProcessRunResult,
  ProcessRunner
} from "../src/claude-cli-adapter.js";
import type {
  ClaudeCliRequest,
  StructuredLogEvent,
  StructuredLogger
} from "../src/modules.js";

class FakeLogger implements StructuredLogger {
  infos: StructuredLogEvent[] = [];
  warns: StructuredLogEvent[] = [];
  errors: StructuredLogEvent[] = [];
  info(ev: StructuredLogEvent): void {
    this.infos.push(ev);
  }
  warn(ev: StructuredLogEvent): void {
    this.warns.push(ev);
  }
  error(ev: StructuredLogEvent): void {
    this.errors.push(ev);
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeProcessRunner implements ProcessRunner {
  lastArgv: string[] = [];
  lastOptions: ProcessRunOptions | undefined;
  private response: ProcessRunResult | Error;

  constructor(response: ProcessRunResult | Error) {
    this.response = response;
  }

  run(argv: string[], options: ProcessRunOptions): Promise<ProcessRunResult> {
    this.lastArgv = argv;
    this.lastOptions = options;
    if (this.response instanceof Error) {
      return Promise.reject(this.response);
    }
    return Promise.resolve(this.response);
  }
}

function makeSuccess(text: string, sessionId?: string): ProcessRunResult {
  const body = sessionId
    ? JSON.stringify({ result: text, session_id: sessionId })
    : JSON.stringify({ result: text });
  return { stdout: body, stderr: "", exitCode: 0, timedOut: false };
}

const BASE_REQUEST: ClaudeCliRequest = {
  prompt: "hello world",
  timeoutMs: 5000
};

describe("ClaudeCliAdapter", () => {
  describe("argv construction", () => {
    it("builds base argv with required flags", async () => {
      const runner = new FakeProcessRunner(makeSuccess("hi"));
      const adapter = createClaudeCliAdapter({ runner });

      await adapter.execute(BASE_REQUEST);

      expect(runner.lastArgv).toEqual([
        "claude",
        "-p",
        "hello world",
        "--output-format",
        "json",
        "--tools",
        ""
      ]);
    });

    it("no-tools default: --tools empty string always present", async () => {
      const runner = new FakeProcessRunner(makeSuccess("hi"));
      const adapter = createClaudeCliAdapter({ runner });

      await adapter.execute(BASE_REQUEST);

      const toolsIdx = runner.lastArgv.indexOf("--tools");
      expect(toolsIdx).toBeGreaterThan(-1);
      expect(runner.lastArgv[toolsIdx + 1]).toBe("");
    });

    it("never includes dangerous permission bypass flags", async () => {
      const runner = new FakeProcessRunner(makeSuccess("hi"));
      const adapter = createClaudeCliAdapter({ runner });

      await adapter.execute(BASE_REQUEST);

      const dangerous = [
        "--dangerously-skip-permissions",
        "--allow-all-tools",
        "--unsafe",
        "--no-sandbox"
      ];
      for (const flag of dangerous) {
        expect(runner.lastArgv).not.toContain(flag);
      }
    });

    it("appends --model when request.model is set", async () => {
      const runner = new FakeProcessRunner(makeSuccess("hi"));
      const adapter = createClaudeCliAdapter({ runner });

      await adapter.execute({
        ...BASE_REQUEST,
        model: "claude-3-5-sonnet-20241022"
      });

      expect(runner.lastArgv).toContain("--model");
      const idx = runner.lastArgv.indexOf("--model");
      expect(runner.lastArgv[idx + 1]).toBe("claude-3-5-sonnet-20241022");
    });

    it("does not append --model when request.model is absent", async () => {
      const runner = new FakeProcessRunner(makeSuccess("hi"));
      const adapter = createClaudeCliAdapter({ runner });

      await adapter.execute(BASE_REQUEST);

      expect(runner.lastArgv).not.toContain("--model");
    });

    it("appends --system-prompt when request.systemPrompt is set", async () => {
      const runner = new FakeProcessRunner(makeSuccess("hi"));
      const adapter = createClaudeCliAdapter({ runner });

      await adapter.execute({ ...BASE_REQUEST, systemPrompt: "Be concise." });

      expect(runner.lastArgv).toContain("--system-prompt");
      const idx = runner.lastArgv.indexOf("--system-prompt");
      expect(runner.lastArgv[idx + 1]).toBe("Be concise.");
    });

    it("does not append --system-prompt when request.systemPrompt is absent", async () => {
      const runner = new FakeProcessRunner(makeSuccess("hi"));
      const adapter = createClaudeCliAdapter({ runner });

      await adapter.execute(BASE_REQUEST);

      expect(runner.lastArgv).not.toContain("--system-prompt");
    });

    it("appends --max-budget-usd when request.maxBudgetUsd is set", async () => {
      const runner = new FakeProcessRunner(makeSuccess("hi"));
      const adapter = createClaudeCliAdapter({ runner });

      await adapter.execute({ ...BASE_REQUEST, maxBudgetUsd: 0.5 });

      expect(runner.lastArgv).toContain("--max-budget-usd");
      const idx = runner.lastArgv.indexOf("--max-budget-usd");
      expect(runner.lastArgv[idx + 1]).toBe("0.5");
    });

    it("does not append --max-budget-usd when request.maxBudgetUsd is absent", async () => {
      const runner = new FakeProcessRunner(makeSuccess("hi"));
      const adapter = createClaudeCliAdapter({ runner });

      await adapter.execute(BASE_REQUEST);

      expect(runner.lastArgv).not.toContain("--max-budget-usd");
    });

    it("appends --resume when request.sessionId is set", async () => {
      const runner = new FakeProcessRunner(makeSuccess("hi", "sess_abc"));
      const adapter = createClaudeCliAdapter({ runner });

      await adapter.execute({ ...BASE_REQUEST, sessionId: "sess_abc123" });

      expect(runner.lastArgv).toContain("--resume");
      const idx = runner.lastArgv.indexOf("--resume");
      expect(runner.lastArgv[idx + 1]).toBe("sess_abc123");
    });

    it("does not append --resume when request.sessionId is absent", async () => {
      const runner = new FakeProcessRunner(makeSuccess("hi"));
      const adapter = createClaudeCliAdapter({ runner });

      await adapter.execute(BASE_REQUEST);

      expect(runner.lastArgv).not.toContain("--resume");
    });

    it("passes prompt as argv element, not shell-interpolated string", async () => {
      const runner = new FakeProcessRunner(makeSuccess("hi"));
      const adapter = createClaudeCliAdapter({ runner });
      const dangerousPrompt = "$(rm -rf /)";

      await adapter.execute({ ...BASE_REQUEST, prompt: dangerousPrompt });

      // argv[0] must be "claude", NOT "sh" or "bash"
      expect(runner.lastArgv[0]).toBe("claude");
      // prompt must be a literal element, not embedded in sh -c string
      expect(runner.lastArgv).toContain(dangerousPrompt);
      expect(runner.lastArgv).not.toContain("sh");
      expect(runner.lastArgv).not.toContain("-c");
    });
  });

  describe("error mapping", () => {
    it("maps timedOut=true to { kind: failure, category: timeout }", async () => {
      const runner = new FakeProcessRunner({
        stdout: "",
        stderr: "",
        exitCode: -1,
        timedOut: true
      });
      const adapter = createClaudeCliAdapter({ runner });

      const result = await adapter.execute(BASE_REQUEST);

      expect(result).toEqual({ kind: "failure", category: "timeout" });
    });

    it("maps non-zero exit with no auth clue to non-zero-exit", async () => {
      const runner = new FakeProcessRunner({
        stdout: "",
        stderr: "something went wrong",
        exitCode: 1,
        timedOut: false
      });
      const adapter = createClaudeCliAdapter({ runner });

      const result = await adapter.execute(BASE_REQUEST);

      expect(result).toEqual({
        kind: "failure",
        category: "non-zero-exit",
        exitCode: 1
      });
    });

    it("maps exitCode=0 with invalid JSON stdout to invalid-json", async () => {
      const runner = new FakeProcessRunner({
        stdout: "not-valid-json",
        stderr: "",
        exitCode: 0,
        timedOut: false
      });
      const adapter = createClaudeCliAdapter({ runner });

      const result = await adapter.execute(BASE_REQUEST);

      expect(result).toEqual({ kind: "failure", category: "invalid-json" });
    });

    it("maps ENOENT-like error to missing-cli", async () => {
      const enoentError = Object.assign(new Error("spawn claude ENOENT"), {
        code: "ENOENT"
      });
      const runner = new FakeProcessRunner(enoentError);
      const adapter = createClaudeCliAdapter({ runner });

      const result = await adapter.execute(BASE_REQUEST);

      expect(result).toEqual({ kind: "failure", category: "missing-cli" });
    });

    it("maps non-zero exit with 'authentication' in stderr to auth-failure", async () => {
      const runner = new FakeProcessRunner({
        stdout: "",
        stderr: "authentication failed: invalid token",
        exitCode: 1,
        timedOut: false
      });
      const adapter = createClaudeCliAdapter({ runner });

      const result = await adapter.execute(BASE_REQUEST);

      expect(result).toEqual({ kind: "failure", category: "auth-failure" });
    });

    it("maps non-zero exit with 'login' in stderr to auth-failure", async () => {
      const runner = new FakeProcessRunner({
        stdout: "",
        stderr: "please login to continue",
        exitCode: 1,
        timedOut: false
      });
      const adapter = createClaudeCliAdapter({ runner });

      const result = await adapter.execute(BASE_REQUEST);

      expect(result).toEqual({ kind: "failure", category: "auth-failure" });
    });

    it("maps non-zero exit with 'unauthorized' in stderr to auth-failure", async () => {
      const runner = new FakeProcessRunner({
        stdout: "",
        stderr: "unauthorized access",
        exitCode: 1,
        timedOut: false
      });
      const adapter = createClaudeCliAdapter({ runner });

      const result = await adapter.execute(BASE_REQUEST);

      expect(result).toEqual({ kind: "failure", category: "auth-failure" });
    });
  });

  describe("stderr leakage prevention", () => {
    it("does not include raw stderr in failure result", async () => {
      const secretStderr = "SECRET_TOKEN=abc123 authentication failed";
      const runner = new FakeProcessRunner({
        stdout: "",
        stderr: secretStderr,
        exitCode: 1,
        timedOut: false
      });
      const adapter = createClaudeCliAdapter({ runner });

      const result = await adapter.execute(BASE_REQUEST);

      expect(JSON.stringify(result)).not.toContain("SECRET_TOKEN");
      expect(JSON.stringify(result)).not.toContain(secretStderr);
    });

    it("does not include raw stderr in non-zero-exit failure result", async () => {
      const secretStderr = "private credentials xyz";
      const runner = new FakeProcessRunner({
        stdout: "",
        stderr: secretStderr,
        exitCode: 2,
        timedOut: false
      });
      const adapter = createClaudeCliAdapter({ runner });

      const result = await adapter.execute(BASE_REQUEST);

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(secretStderr);
    });
  });

  describe("success path", () => {
    it("returns success with text from result field", async () => {
      const runner = new FakeProcessRunner(makeSuccess("Hello from Claude"));
      const adapter = createClaudeCliAdapter({ runner });

      const result = await adapter.execute(BASE_REQUEST);

      expect(result).toEqual({
        kind: "success",
        text: "Hello from Claude",
        sessionId: undefined,
        exitCode: 0
      });
    });

    it("extracts session_id from JSON output into result.sessionId", async () => {
      const runner = new FakeProcessRunner(
        makeSuccess("Answer text", "sess_abc123")
      );
      const adapter = createClaudeCliAdapter({ runner });

      const result = await adapter.execute(BASE_REQUEST);

      expect(result.kind).toBe("success");
      if (result.kind !== "success") return;
      expect(result.sessionId).toBe("sess_abc123");
      expect(result.text).toBe("Answer text");
      expect(result.exitCode).toBe(0);
    });

    it("passes timeoutMs to process runner options", async () => {
      const runner = new FakeProcessRunner(makeSuccess("hi"));
      const adapter = createClaudeCliAdapter({ runner });

      await adapter.execute({ ...BASE_REQUEST, timeoutMs: 12345 });

      expect(runner.lastOptions?.timeoutMs).toBe(12345);
    });
  });

  describe("logging", () => {
    it("logs cli.execute.success with durationMs and exitCode on success", async () => {
      const runner = new FakeProcessRunner(makeSuccess("hi"));
      const logger = new FakeLogger();
      const adapter = createClaudeCliAdapter({ runner, logger });

      await adapter.execute(BASE_REQUEST);

      const ev = logger.infos.find((e) => e.event === "cli.execute.success");
      expect(ev).toBeDefined();
      expect(typeof ev?.durationMs).toBe("number");
      expect(ev?.exitCode).toBe(0);
    });

    it("logs cli.execute.failure with errorCategory and durationMs on failure", async () => {
      const runner = new FakeProcessRunner({
        stdout: "",
        stderr: "timed out",
        exitCode: -1,
        timedOut: true
      });
      const logger = new FakeLogger();
      const adapter = createClaudeCliAdapter({ runner, logger });

      await adapter.execute(BASE_REQUEST);

      const ev = logger.errors.find((e) => e.event === "cli.execute.failure");
      expect(ev).toBeDefined();
      expect(ev?.errorCategory).toBe("timeout");
      expect(typeof ev?.durationMs).toBe("number");
    });

    it("does not log raw stderr content", async () => {
      const runner = new FakeProcessRunner({
        stdout: "",
        stderr: "SECRET_STDERR_DATA auth failure",
        exitCode: 1,
        timedOut: false
      });
      const logger = new FakeLogger();
      const adapter = createClaudeCliAdapter({ runner, logger });

      await adapter.execute(BASE_REQUEST);

      const allLogs = JSON.stringify([...logger.infos, ...logger.errors]);
      expect(allLogs).not.toContain("SECRET_STDERR_DATA");
    });
  });
});
