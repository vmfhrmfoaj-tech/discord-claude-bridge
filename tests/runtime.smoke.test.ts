import { describe, expect, it } from "vitest";

import { createRuntime, type RuntimeDependencies } from "../src/runtime.js";

describe("runtime scaffold", () => {
  it("starts and stops through fake Module Interfaces without Discord or Claude calls", async () => {
    const calls: string[] = [];
    const dependencies: RuntimeDependencies = {
      discordIngress: {
        start: () => {
          calls.push("discordIngress.start");
          return Promise.resolve();
        },
        stop: () => {
          calls.push("discordIngress.stop");
          return Promise.resolve();
        }
      },
      logger: {
        info: (event) => {
          calls.push(`log:${event.event}`);
        },
        warn: (event) => {
          calls.push(`warn:${event.event}`);
        },
        error: (event) => {
          calls.push(`error:${event.event}`);
        }
      }
    };

    const runtime = createRuntime(dependencies);

    await runtime.start();
    await runtime.stop();

    expect(calls).toEqual([
      "log:runtime.starting",
      "discordIngress.start",
      "log:runtime.started",
      "log:runtime.stopping",
      "discordIngress.stop",
      "log:runtime.stopped"
    ]);
  });
});
