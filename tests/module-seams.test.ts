import { describe, expect, it } from "vitest";

import { moduleSeams } from "../src/index.js";

describe("Module seam scaffold", () => {
  it("exposes the v1 core Module names as a stable public map", () => {
    expect(moduleSeams).toEqual([
      "Discord Ingress",
      "Mention Parser",
      "Job Queue",
      "Claude CLI Adapter",
      "Session Store",
      "Reply Publisher",
      "Config Loader",
      "Structured Logger"
    ]);
  });
});
