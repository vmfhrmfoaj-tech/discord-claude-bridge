import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("npm runtime interface", () => {
  it("declares Node 22 ESM scripts for local runtime checks", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      type?: string;
      engines?: { node?: string };
      scripts?: Record<string, string>;
    };

    expect(packageJson.type).toBe("module");
    expect(packageJson.engines?.node).toBe(">=22");
    expect(packageJson.scripts).toMatchObject({
      build: "tsc -p tsconfig.build.json",
      start: "node dist/main.js",
      test: "vitest run",
      lint: "eslint .",
      typecheck: "tsc --noEmit"
    });
  });
});
