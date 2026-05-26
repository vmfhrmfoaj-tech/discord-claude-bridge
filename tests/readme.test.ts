import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf-8");

describe("README acceptance criteria", () => {
  it("explains how to install dependencies", () => {
    expect(readme).toMatch(/npm install/);
  });

  it("explains how to configure .env", () => {
    expect(readme).toMatch(/cp \.env\.example \.env/);
    expect(readme).toMatch(/DISCORD_TOKEN/);
  });

  it("explains how to configure YAML runtime options", () => {
    expect(readme).toMatch(/cp config\.example\.yaml config\.yaml/);
  });

  it("explains how to run the Local Node Process", () => {
    expect(readme).toMatch(/npm run build/);
    expect(readme).toMatch(/npm start/);
  });

  it("documents how to run tests", () => {
    expect(readme).toMatch(/npm test/);
  });

  it("documents how to run lint", () => {
    expect(readme).toMatch(/npm run lint/);
  });

  it("documents how to run format check", () => {
    expect(readme).toMatch(/npm run format:check/);
  });

  it("documents the local fake smoke flow", () => {
    expect(readme).toMatch(/e2e-fake/i);
  });

  it("explains Claude CLI Adapter with host auth", () => {
    expect(readme).toMatch(/claude auth/i);
    expect(readme).toMatch(/Claude Code CLI/);
  });

  it("explains no-tools policy by default", () => {
    expect(readme).toMatch(/--tools\s+""/);
  });

  it("clarifies Anthropic API key is out of scope", () => {
    expect(readme).toMatch(/Anthropic API key/i);
    expect(readme).toMatch(/out of scope|non-goal|v1 제외|v1 non-goal/i);
  });

  it("clarifies Docker, Redis, SQLite, slash commands, DM, web dashboard are out of scope", () => {
    expect(readme).toMatch(/Docker/);
    expect(readme).toMatch(/Redis/);
    expect(readme).toMatch(/SQLite/);
    expect(readme).toMatch(/[Ss]lash command/);
    expect(readme).toMatch(/DM/);
    expect(readme).toMatch(/[Ww]eb [Dd]ashboard/);
  });

  it("includes issue-sized branch naming examples with real issue numbers", () => {
    expect(readme).toMatch(/issue-\d+-[a-z]/);
  });

  it("includes local smoke guidance for missing config detection", () => {
    expect(readme).toMatch(/smoke/i);
    expect(readme).toMatch(/DISCORD_TOKEN|CONFIG_PATH/);
    expect(readme).toMatch(/claude --version|claude auth status/);
  });
});
