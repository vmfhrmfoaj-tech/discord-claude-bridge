import type { Runtime } from "./runtime.js";
import { createRuntime } from "./runtime.js";
import type { StructuredLogEvent, StructuredLogger } from "./modules.js";

export interface ScaffoldRuntimeOptions {
  log?: (event: StructuredLogEvent) => void;
}

export function createScaffoldRuntime(
  options: ScaffoldRuntimeOptions = {}
): Runtime {
  const logger = createScaffoldLogger(options);

  return createRuntime({
    discordIngress: {
      start() {
        logger.info({ event: "discordIngress.noop.started" });
        return Promise.resolve();
      },
      stop() {
        logger.info({ event: "discordIngress.noop.stopped" });
        return Promise.resolve();
      }
    },
    logger
  });
}

function createScaffoldLogger(
  options: ScaffoldRuntimeOptions
): StructuredLogger {
  return {
    info(event) {
      options.log?.(event);
    },
    error(event) {
      options.log?.(event);
    }
  };
}
