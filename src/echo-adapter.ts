import type {
  ClaudeCliAdapter,
  ClaudeCliRequest,
  ClaudeCliResult
} from "./modules.js";

const DEFAULT_ECHO_DELAY_MS = 3000;

export interface EchoAdapterOptions {
  delayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
}

export function createEchoAdapter(
  options: EchoAdapterOptions = {}
): ClaudeCliAdapter {
  const delayMs = options.delayMs ?? DEFAULT_ECHO_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;

  return {
    async execute(request: ClaudeCliRequest): Promise<ClaudeCliResult> {
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      return {
        kind: "success",
        text: `[에코] ${request.prompt}`,
        exitCode: 0,
        sessionId: undefined
      };
    }
  };
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
