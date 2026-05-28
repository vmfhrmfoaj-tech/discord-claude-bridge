import { fileURLToPath } from "node:url";

import {
  createClaudeCliAdapter,
  type ProcessRunner,
  type ProcessRunOptions,
  type ProcessRunResult
} from "./claude-cli-adapter.js";
import type {
  ClaudeCliResult,
  StructuredLogEvent,
  StructuredLogger
} from "./modules.js";
import { createNodeProcessRunner } from "./process-runner.js";
import { createStructuredLogger } from "./structured-logger.js";

export const DEFAULT_SMOKE_PROMPT =
  "Reply with one short sentence confirming the Claude CLI adapter smoke path works.";
export const DEFAULT_SMOKE_TIMEOUT_MS = 120_000;
const PREVIEW_LIMIT = 1_000;

export interface SmokeClaudeReport {
  result: ClaudeCliResult;
  stdoutPreview: string;
  stderrPreview: string;
  exitCode?: number;
  timedOut?: boolean;
}

export interface SmokeClaudeOutcome {
  exitCode: number;
  report: SmokeClaudeReport;
}

export interface SmokeClaudeOptions {
  runner?: ProcessRunner;
  logger?: StructuredLogger;
  binaryPath?: string;
  prompt?: string;
  timeoutMs?: number;
  writeOutput?: (text: string) => void;
}

class CapturingProcessRunner implements ProcessRunner {
  lastResult: ProcessRunResult | undefined;
  lastError: unknown;

  constructor(private readonly inner: ProcessRunner) {}

  async run(
    argv: string[],
    options: ProcessRunOptions
  ): Promise<ProcessRunResult> {
    try {
      const result = await this.inner.run(argv, options);
      this.lastResult = result;
      return result;
    } catch (error: unknown) {
      this.lastError = error;
      throw error;
    }
  }
}

export async function runClaudeSmoke(
  options: SmokeClaudeOptions = {}
): Promise<SmokeClaudeOutcome> {
  const logger = options.logger ?? createStructuredLogger();
  const prompt = options.prompt ?? DEFAULT_SMOKE_PROMPT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SMOKE_TIMEOUT_MS;
  const binaryPath = options.binaryPath ?? "claude";
  const writeOutput =
    options.writeOutput ??
    ((text: string): void => {
      console.log(text);
    });
  const runner = new CapturingProcessRunner(
    options.runner ?? createNodeProcessRunner()
  );
  const adapter = createClaudeCliAdapter({ runner, binaryPath, logger });

  logger.info({ event: "smoke.claude.starting" });
  const result = await adapter.execute({ prompt, timeoutMs });

  const report = buildReport(result, runner);
  const exitCode = result.kind === "success" ? 0 : 1;
  const finalEvent: StructuredLogEvent =
    result.kind === "success"
      ? {
          event: "smoke.claude.succeeded",
          exitCode: report.exitCode
        }
      : {
          event: "smoke.claude.failed",
          exitCode: report.exitCode,
          errorCategory: result.category
        };

  if (result.kind === "success") {
    logger.info(finalEvent);
  } else {
    logger.error(finalEvent);
  }

  writeOutput(JSON.stringify(report, null, 2));
  return { exitCode, report };
}

function buildReport(
  result: ClaudeCliResult,
  runner: CapturingProcessRunner
): SmokeClaudeReport {
  const processResult = runner.lastResult;
  if (processResult !== undefined) {
    return {
      result,
      stdoutPreview: preview(processResult.stdout),
      stderrPreview: preview(processResult.stderr),
      exitCode: processResult.exitCode,
      timedOut: processResult.timedOut
    };
  }

  return {
    result,
    stdoutPreview: "",
    stderrPreview: preview(errorMessage(runner.lastError)),
    exitCode: undefined,
    timedOut: undefined
  };
}

function preview(value: string): string {
  if (value.length <= PREVIEW_LIMIT) return value;
  return `${value.slice(0, PREVIEW_LIMIT - 3)}...`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function main(): Promise<void> {
  const outcome = await runClaudeSmoke();
  process.exitCode = outcome.exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(String(error) + "\n");
    process.exitCode = 1;
  });
}
