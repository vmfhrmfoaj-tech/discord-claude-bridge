import { fileURLToPath } from "node:url";

import { createScaffoldRuntime } from "./scaffold-runtime.js";

export async function main(): Promise<void> {
  const runtime = createScaffoldRuntime({
    log(event) {
      console.log(JSON.stringify(event));
    }
  });

  await runtime.start();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
