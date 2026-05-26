import type { DiscordIngress, StructuredLogger } from "./modules.js";

export interface Runtime {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface RuntimeDependencies {
  discordIngress: DiscordIngress;
  logger: StructuredLogger;
}

export function createRuntime(dependencies: RuntimeDependencies): Runtime {
  return {
    async start() {
      dependencies.logger.info({ event: "runtime.starting" });
      await dependencies.discordIngress.start();
      dependencies.logger.info({ event: "runtime.started" });
    },
    async stop() {
      dependencies.logger.info({ event: "runtime.stopping" });
      await dependencies.discordIngress.stop();
      dependencies.logger.info({ event: "runtime.stopped" });
    }
  };
}
