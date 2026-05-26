import { spawn } from "node:child_process";

import type {
  ProcessRunner,
  ProcessRunOptions,
  ProcessRunResult
} from "./claude-cli-adapter.js";

export function createNodeProcessRunner(): ProcessRunner {
  return {
    run(argv: string[], options: ProcessRunOptions): Promise<ProcessRunResult> {
      const [command, ...args] = argv;
      if (command == null) {
        return Promise.reject(new Error("Process argv must include command"));
      }

      return new Promise<ProcessRunResult>((resolve, reject) => {
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        let settled = false;

        const child = spawn(command, args, {
          stdio: ["ignore", "pipe", "pipe"]
        });
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
        }, options.timeoutMs);

        child.stdout.on("data", (chunk: string | Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk: string | Buffer) => {
          stderr += chunk.toString();
        });

        child.once("error", (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });

        child.once("close", (exitCode) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            stdout,
            stderr,
            exitCode: exitCode ?? 1,
            timedOut
          });
        });
      });
    }
  };
}
