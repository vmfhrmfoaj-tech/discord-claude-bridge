import { describe, expect, it } from "vitest";

import { createScaffoldRuntime } from "../src/index.js";

describe("scaffold runtime", () => {
  it("starts and stops with no-op Adapters for local smoke runs", async () => {
    const events: string[] = [];
    const runtime = createScaffoldRuntime({
      log: (event) => {
        events.push(event.event);
      }
    });

    await runtime.start();
    await runtime.stop();

    expect(events).toEqual([
      "runtime.starting",
      "discordIngress.noop.started",
      "runtime.started",
      "runtime.stopping",
      "discordIngress.noop.stopped",
      "runtime.stopped"
    ]);
  });
});
