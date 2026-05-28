import { describe, expect, it } from "vitest";

import type {
  ProcessRunOptions,
  ProcessRunResult,
  ProcessRunner
} from "../src/claude-cli-adapter.js";
import type { StructuredLogEvent, StructuredLogger } from "../src/modules.js";
import { runClaudeSmoke } from "../src/smoke-claude.js";

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

  constructor(private readonly response: ProcessRunResult | Error) {}

  run(argv: string[], options: ProcessRunOptions): Promise<ProcessRunResult> {
    this.lastArgv = argv;
    this.lastOptions = options;
    if (this.response instanceof Error) {
      return Promise.reject(this.response);
    }
    return Promise.resolve(this.response);
  }
}

function successResult(text: string): ProcessRunResult {
  return {
    stdout: JSON.stringify({ result: text, session_id: "sess-smoke" }),
    stderr: "",
    exitCode: 0,
    timedOut: false
  };
}

describe("runClaudeSmoke", () => {
  it("prints visible success text, stdout, and exit code", async () => {
    const runner = new FakeProcessRunner(successResult("smoke ok"));
    const logger = new FakeLogger();
    const output: string[] = [];

    const outcome = await runClaudeSmoke({
      runner,
      logger,
      writeOutput: (text) => output.push(text)
    });

    expect(outcome.exitCode).toBe(0);
    expect(outcome.report.result.kind).toBe("success");
    expect(outcome.report.stdoutPreview).toContain("smoke ok");
    expect(outcome.report.stderrPreview).toBe("");
    expect(outcome.report.exitCode).toBe(0);
    expect(output.join("\n")).toContain("smoke ok");
    expect(output.join("\n")).toContain('"exitCode": 0');
  });

  it("prints non-zero failure category, stderr preview, and exit code", async () => {
    const runner = new FakeProcessRunner({
      stdout: "",
      stderr: "operator-visible failure",
      exitCode: 2,
      timedOut: false
    });
    const output: string[] = [];

    const outcome = await runClaudeSmoke({
      runner,
      logger: new FakeLogger(),
      writeOutput: (text) => output.push(text)
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.report.result).toEqual({
      kind: "failure",
      category: "non-zero-exit",
      exitCode: 2
    });
    expect(outcome.report.stderrPreview).toBe("operator-visible failure");
    expect(outcome.report.exitCode).toBe(2);
    expect(output.join("\n")).toContain("non-zero-exit");
  });

  it("prints timeout category and timedOut metadata", async () => {
    const runner = new FakeProcessRunner({
      stdout: "",
      stderr: "",
      exitCode: -1,
      timedOut: true
    });

    const outcome = await runClaudeSmoke({
      runner,
      logger: new FakeLogger(),
      writeOutput: () => undefined
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.report.result).toEqual({
      kind: "failure",
      category: "timeout"
    });
    expect(outcome.report.timedOut).toBe(true);
    expect(outcome.report.exitCode).toBe(-1);
  });

  it("maps missing CLI errors and prints an error preview", async () => {
    const error = Object.assign(new Error("spawn claude ENOENT"), {
      code: "ENOENT"
    });
    const runner = new FakeProcessRunner(error);

    const outcome = await runClaudeSmoke({
      runner,
      logger: new FakeLogger(),
      writeOutput: () => undefined
    });

    expect(outcome.exitCode).toBe(1);
    expect(outcome.report.result).toEqual({
      kind: "failure",
      category: "missing-cli"
    });
    expect(outcome.report.stderrPreview).toContain("ENOENT");
    expect(outcome.report.exitCode).toBeUndefined();
  });

  it("emits structured smoke lifecycle logs", async () => {
    const logger = new FakeLogger();

    await runClaudeSmoke({
      runner: new FakeProcessRunner(successResult("ok")),
      logger,
      writeOutput: () => undefined
    });

    expect(logger.infos.map((event) => event.event)).toContain(
      "smoke.claude.starting"
    );
    expect(logger.infos.map((event) => event.event)).toContain(
      "cli.execute.success"
    );
    expect(logger.infos.map((event) => event.event)).toContain(
      "smoke.claude.succeeded"
    );
  });
});
