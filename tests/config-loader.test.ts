import { describe, expect, it } from "vitest";

import {
  ConfigValidationError,
  createConfigLoader
} from "../src/config-loader.js";

const VALID_ENV = {
  DISCORD_TOKEN: "test-token",
  DISCORD_CLIENT_ID: "test-client-id"
};

const MINIMAL_YAML = `
discord:
  allowedGuildIds:
    - "111"
  allowedChannelIds: []
`;

const EMPTY_READ: (path: string) => Promise<string> = () =>
  Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

const yaml = (content: string) => (): Promise<string> =>
  Promise.resolve(content);

describe("ConfigLoader", () => {
  it("loads required secrets from .env when env is not injected", async () => {
    const env: Record<string, string | undefined> = {};
    const loader = createConfigLoader({
      env,
      envFilePath: ".test.env",
      loadEnvFile(path) {
        expect(path).toBe(".test.env");
        env["DISCORD_TOKEN"] = "env-file-token";
        env["DISCORD_CLIENT_ID"] = "env-file-client-id";
      },
      readFile: EMPTY_READ
    });

    const cfg = await loader.load();

    expect(cfg.discord.token).toBe("env-file-token");
    expect(cfg.discord.clientId).toBe("env-file-client-id");
  });

  it("loads valid env and YAML config into RuntimeConfig", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml(MINIMAL_YAML)
    });

    const cfg = await loader.load();

    expect(cfg.discord.token).toBe("test-token");
    expect(cfg.discord.clientId).toBe("test-client-id");
    expect(cfg.discord.allowedGuildIds).toEqual(["111"]);
    expect(cfg.discord.allowedChannelIds).toEqual([]);
  });

  it("loads non-secret runtime options from YAML config", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml(`
discord:
  allowedGuildIds: ["111"]
  allowedChannelIds: ["222"]
queue:
  concurrency: 2
  maxPendingJobs: 10
claude:
  binaryPath: "/usr/local/bin/claude"
  outputFormat: "json"
  tools: ""
  timeoutMs: 5000
  model: "claude-sonnet"
  systemPrompt: "Reply tersely."
  maxBudgetUsd: 0.25
prompt:
  maxCharacters: 500
session:
  scope: "thread-or-channel"
  storePath: "/tmp/sessions.json"
reply:
  maxChunkCharacters: 1500
  typingIndicator: false
logging:
  level: "debug"
  format: "json"
`)
    });

    const cfg = await loader.load();

    expect(cfg.discord.allowedGuildIds).toEqual(["111"]);
    expect(cfg.discord.allowedChannelIds).toEqual(["222"]);
    expect(cfg.queue).toEqual({ concurrency: 2, maxPendingJobs: 10 });
    expect(cfg.claude).toEqual({
      binaryPath: "/usr/local/bin/claude",
      outputFormat: "json",
      tools: "",
      timeoutMs: 5000,
      model: "claude-sonnet",
      systemPrompt: "Reply tersely.",
      maxBudgetUsd: 0.25
    });
    expect(cfg.prompt.maxCharacters).toBe(500);
    expect(cfg.session).toEqual({
      scope: "thread-or-channel",
      storePath: "/tmp/sessions.json"
    });
    expect(cfg.reply).toEqual({
      maxChunkCharacters: 1500,
      typingIndicator: false
    });
    expect(cfg.logging).toEqual({ level: "debug", format: "json" });
  });

  it("rejects missing DISCORD_TOKEN as a startup validation error", async () => {
    const loader = createConfigLoader({
      env: { DISCORD_CLIENT_ID: "cid" },
      readFile: EMPTY_READ
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("DISCORD_TOKEN");
  });

  it("rejects missing DISCORD_CLIENT_ID as a startup validation error", async () => {
    const loader = createConfigLoader({
      env: { DISCORD_TOKEN: "tok" },
      readFile: EMPTY_READ
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("DISCORD_CLIENT_ID");
  });

  it("reads YAML from CONFIG_PATH env when set", async () => {
    const calls: string[] = [];
    const loader = createConfigLoader({
      env: { ...VALID_ENV, CONFIG_PATH: "/custom/path/config.yaml" },
      readFile: (path) => {
        calls.push(path);
        return Promise.resolve(MINIMAL_YAML);
      }
    });

    await loader.load();

    expect(calls).toEqual(["/custom/path/config.yaml"]);
  });

  it("rejects missing YAML when CONFIG_PATH env is set", async () => {
    const loader = createConfigLoader({
      env: { ...VALID_ENV, CONFIG_PATH: "/missing/config.yaml" },
      readFile: EMPTY_READ
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("/missing/config.yaml");
  });

  it("rejects invalid YAML instead of silently using defaults", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("queue:\n  concurrency: [")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("Invalid config YAML");
  });

  it("applies documented defaults when YAML is absent", async () => {
    const loader = createConfigLoader({ env: VALID_ENV, readFile: EMPTY_READ });

    const cfg = await loader.load();

    expect(cfg.queue.concurrency).toBe(1);
    expect(cfg.queue.maxPendingJobs).toBe(50);
    expect(cfg.claude.timeoutMs).toBe(120_000);
    expect(cfg.claude.outputFormat).toBe("json");
    expect(cfg.claude.tools).toBe("");
    expect(cfg.claude.binaryPath).toBe("claude");
    expect(cfg.prompt.maxCharacters).toBe(12_000);
    expect(cfg.session.scope).toBe("thread-or-channel");
    expect(cfg.session.storePath).toBe(".data/sessions.json");
    expect(cfg.reply.maxChunkCharacters).toBe(1800);
    expect(cfg.reply.typingIndicator).toBe(true);
    expect(cfg.logging.level).toBe("info");
    expect(cfg.logging.format).toBe("json");
  });

  it("applies defaults for missing YAML fields while using provided fields", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("queue:\n  concurrency: 3")
    });

    const cfg = await loader.load();

    expect(cfg.queue.concurrency).toBe(3);
    expect(cfg.queue.maxPendingJobs).toBe(50);
  });

  it("rejects invalid allowedGuildIds shape", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("discord:\n  allowedGuildIds: not-an-array")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("allowedGuildIds");
  });

  it("rejects allowedGuildIds with non-string elements", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("discord:\n  allowedGuildIds:\n    - 123")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("allowedGuildIds");
  });

  it("rejects invalid allowedChannelIds shape", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml(
        "discord:\n  allowedGuildIds: []\n  allowedChannelIds: bad"
      )
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("allowedChannelIds");
  });

  it("rejects queue.concurrency below 1", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("queue:\n  concurrency: 0")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("concurrency");
  });

  it("rejects non-integer queue.concurrency", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("queue:\n  concurrency: 1.5")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
  });

  it("rejects queue.maxPendingJobs below 1", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("queue:\n  maxPendingJobs: 0")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("maxPendingJobs");
  });

  it("rejects claude.timeoutMs below 1", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("claude:\n  timeoutMs: 0")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("timeoutMs");
  });

  it("rejects non-integer claude.timeoutMs", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("claude:\n  timeoutMs: 1000.5")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
  });

  it("rejects invalid Claude output format", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("claude:\n  outputFormat: stream-json")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("outputFormat");
  });

  it("rejects enabled Claude tools", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml('claude:\n  tools: "Bash"')
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("tools");
  });

  it("rejects invalid Claude budget", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("claude:\n  maxBudgetUsd: 0")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("maxBudgetUsd");
  });

  it("rejects prompt.maxCharacters below 1", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("prompt:\n  maxCharacters: 0")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("maxCharacters");
  });

  it("rejects invalid session scope", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("session:\n  scope: channel-only")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("session.scope");
  });

  it("rejects invalid session store path", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("session:\n  storePath: 123")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("storePath");
  });

  it("rejects reply.maxChunkCharacters at Discord message limit (2000)", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("reply:\n  maxChunkCharacters: 2000")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("maxChunkCharacters");
  });

  it("rejects reply.maxChunkCharacters above Discord message limit", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("reply:\n  maxChunkCharacters: 2001")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
  });

  it("accepts reply.maxChunkCharacters below Discord message limit", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("reply:\n  maxChunkCharacters: 1999")
    });

    const cfg = await loader.load();
    expect(cfg.reply.maxChunkCharacters).toBe(1999);
  });

  it("rejects invalid typing indicator config", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("reply:\n  typingIndicator: sometimes")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("typingIndicator");
  });

  it("rejects invalid logging format", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml("logging:\n  format: pretty")
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
    await expect(loader.load()).rejects.toThrow("logging.format");
  });

  it("ignores discord.token in YAML and always uses DISCORD_TOKEN env", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml(
        'discord:\n  token: "yaml-secret-token"\n  allowedGuildIds: []'
      )
    });

    const cfg = await loader.load();

    expect(cfg.discord.token).toBe("test-token");
  });

  it("ignores discord.clientId in YAML and always uses DISCORD_CLIENT_ID env", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: yaml(
        'discord:\n  clientId: "yaml-client-id"\n  allowedGuildIds: []'
      )
    });

    const cfg = await loader.load();

    expect(cfg.discord.clientId).toBe("test-client-id");
  });

  it("sets responseMode to 'echo' when RESPONSE_MODE=echo", async () => {
    const loader = createConfigLoader({
      env: { ...VALID_ENV, RESPONSE_MODE: "echo" },
      readFile: EMPTY_READ
    });

    const cfg = await loader.load();

    expect(cfg.responseMode).toBe("echo");
  });

  it("sets responseMode to 'claude' when RESPONSE_MODE is absent", async () => {
    const loader = createConfigLoader({
      env: VALID_ENV,
      readFile: EMPTY_READ
    });

    const cfg = await loader.load();

    expect(cfg.responseMode).toBe("claude");
  });

  it("rejects unknown RESPONSE_MODE value", async () => {
    const loader = createConfigLoader({
      env: { ...VALID_ENV, RESPONSE_MODE: "invalid-mode" },
      readFile: EMPTY_READ
    });

    await expect(loader.load()).rejects.toThrow(ConfigValidationError);
  });
});
