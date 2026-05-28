import { fileURLToPath } from "node:url";

import { createLocalRuntime } from "./local-runtime.js";
import { createStructuredLogger } from "./structured-logger.js";

export async function main(): Promise<void> {
  const runtime = createLocalRuntime({
    loggerFactory: createStructuredLogger
  });

  let stopping = false;
  const shutdown = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    await runtime.stop();
  };

  process.once("SIGTERM", () => {
    void shutdown();
  });
  process.once("SIGINT", () => {
    void shutdown();
  });

  await runtime.start();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(String(error) + "\n");
    process.exitCode = 1;
  });
}
