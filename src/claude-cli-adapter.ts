import type { ClaudeCliAdapter, ClaudeCliRequest, ClaudeCliResult } from "./modules.js";

export interface ProcessRunOptions {
  timeoutMs: number;
}

export interface ProcessRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export interface ProcessRunner {
  run(argv: string[], options: ProcessRunOptions): Promise<ProcessRunResult>;
}

interface ClaudeJsonOutput {
  result: string;
  session_id?: string;
}

interface ClaudeCliAdapterDeps {
  runner: ProcessRunner;
}

const AUTH_PATTERNS = ["authentication", "login", "auth", "unauthorized"];

function isAuthFailure(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return AUTH_PATTERNS.some((p) => lower.includes(p));
}

function buildArgv(request: ClaudeCliRequest): string[] {
  const argv: string[] = ["claude", "-p", request.prompt, "--output-format", "json", "--tools", ""];

  if (request.model !== undefined) {
    argv.push("--model", request.model);
  }

  if (request.systemPrompt !== undefined) {
    argv.push("--system-prompt", request.systemPrompt);
  }

  if (request.maxBudgetUsd !== undefined) {
    argv.push("--max-budget-usd", String(request.maxBudgetUsd));
  }

  if (request.sessionId !== undefined) {
    argv.push("--resume", request.sessionId);
  }

  return argv;
}

export function createClaudeCliAdapter(deps: ClaudeCliAdapterDeps): ClaudeCliAdapter {
  const { runner } = deps;

  return {
    async execute(request: ClaudeCliRequest): Promise<ClaudeCliResult> {
      const argv = buildArgv(request);
      const options: ProcessRunOptions = { timeoutMs: request.timeoutMs };

      let result: ProcessRunResult;
      try {
        result = await runner.run(argv, options);
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return { kind: "failure", category: "missing-cli" };
        }
        return { kind: "failure", category: "non-zero-exit" };
      }

      if (result.timedOut) {
        return { kind: "failure", category: "timeout" };
      }

      if (result.exitCode !== 0) {
        if (isAuthFailure(result.stderr)) {
          return { kind: "failure", category: "auth-failure" };
        }
        return { kind: "failure", category: "non-zero-exit", exitCode: result.exitCode };
      }

      let parsed: ClaudeJsonOutput;
      try {
        parsed = JSON.parse(result.stdout) as ClaudeJsonOutput;
      } catch {
        return { kind: "failure", category: "invalid-json" };
      }

      return {
        kind: "success",
        text: parsed.result,
        sessionId: parsed.session_id,
        exitCode: result.exitCode
      };
    }
  };
}
