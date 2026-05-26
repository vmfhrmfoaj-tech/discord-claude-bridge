import { describe, expect, it } from "vitest";

import { ConfigValidationError } from "../src/config-loader.js";
import { createLocalRuntime } from "../src/local-runtime.js";
import type { ProcessRunner } from "../src/claude-cli-adapter.js";
import type { ConfigLoader, RuntimeConfig } from "../src/modules.js";
import type { DiscordMessageTarget } from "../src/reply-publisher.js";

class FakeDiscordClient {
  loginCalls: string[] = [];
  destroyed = false;

  on() {
    return this;
  }

  login(token: string): Promise<string> {
    this.loginCalls.push(token);
    return Promise.resolve("logged-in");
  }

  destroy(): void {
    this.destroyed = true;
  }
}

const VALID_CONFIG: RuntimeConfig = {
  discord: {
    token: "runtime-token",
    clientId: "bot-1",
    allowedGuildIds: ["guild-1"],
    allowedChannelIds: ["chan-1"]
  },
  queue: { concurrency: 1, maxPendingJobs: 10 },
  claude: {
    binaryPath: "claude",
    outputFormat: "json",
    tools: "",
    timeoutMs: 120_000
  },
  prompt: { maxCharacters: 12_000 },
  session: {
    scope: "thread-or-channel",
    storePath: ".data/sessions.json"
  },
  reply: { maxChunkCharacters: 1800, typingIndicator: true },
  logging: { level: "info", format: "json" }
};

function configLoader(result: RuntimeConfig | Error): ConfigLoader {
  return {
    load() {
      if (result instanceof Error) {
        return Promise.reject(result);
      }
      return Promise.resolve(result);
    }
  };
}

const processRunner: ProcessRunner = {
  run() {
    return Promise.resolve({
      stdout: JSON.stringify({ result: "ok" }),
      stderr: "",
      exitCode: 0,
      timedOut: false
    });
  }
};

const discordTarget: DiscordMessageTarget = {
  sendTyping: () => Promise.resolve(),
  replyToMessage: () => Promise.resolve(),
  sendMessage: () => Promise.resolve()
};

describe("LocalRuntime", () => {
  it("validates config before logging in to Discord", async () => {
    const client = new FakeDiscordClient();
    const runtime = createLocalRuntime({
      configLoader: configLoader(VALID_CONFIG),
      client,
      processRunner,
      discordTarget
    });

    await runtime.start();

    expect(client.loginCalls).toEqual(["runtime-token"]);

    await runtime.stop();
    expect(client.destroyed).toBe(true);
  });

  it("does not log in when config validation fails", async () => {
    const client = new FakeDiscordClient();
    const runtime = createLocalRuntime({
      configLoader: configLoader(new ConfigValidationError("bad config")),
      client,
      processRunner,
      discordTarget
    });

    await expect(runtime.start()).rejects.toThrow(ConfigValidationError);
    expect(client.loginCalls).toEqual([]);
  });
});
