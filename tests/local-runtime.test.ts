import { describe, expect, it } from "vitest";

import { ConfigValidationError } from "../src/config-loader.js";
import { createLocalRuntime } from "../src/local-runtime.js";
import type { ProcessRunner } from "../src/claude-cli-adapter.js";
import type {
  ConfigLoader,
  RuntimeConfig,
  StructuredLogEvent
} from "../src/modules.js";
import type { DiscordMessageTarget } from "../src/reply-publisher.js";
import type {
  DiscordIngressClient,
  DiscordMessageLike
} from "../src/discord-ingress.js";

class FakeDiscordClient implements DiscordIngressClient {
  loginCalls: string[] = [];
  destroyed = false;
  private handlers: Array<(message: DiscordMessageLike) => void> = [];

  on(
    _event: "messageCreate",
    listener: (message: DiscordMessageLike) => void
  ): this {
    this.handlers.push(listener);
    return this;
  }

  login(token: string): Promise<string> {
    this.loginCalls.push(token);
    return Promise.resolve("logged-in");
  }

  destroy(): void {
    this.destroyed = true;
  }

  emit(message: DiscordMessageLike): void {
    for (const handler of this.handlers) {
      handler(message);
    }
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
  logging: { level: "info", format: "json" },
  responseMode: "claude"
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

  it("creates configured logger from loaded logging config and closes it on stop", async () => {
    const client = new FakeDiscordClient();
    const loggerCalls: string[] = [];
    const config: RuntimeConfig = {
      ...VALID_CONFIG,
      logging: {
        level: "info",
        format: "json",
        filePath: ".data/runtime.log"
      }
    };
    const runtime = createLocalRuntime({
      configLoader: configLoader(config),
      client,
      processRunner,
      discordTarget,
      loggerFactory(loggingConfig) {
        loggerCalls.push(`filePath:${loggingConfig.filePath ?? ""}`);
        return {
          info: (event) => loggerCalls.push(`info:${event.event}`),
          warn: (event) => loggerCalls.push(`warn:${event.event}`),
          error: (event) => loggerCalls.push(`error:${event.event}`),
          close: () => {
            loggerCalls.push("close");
            return Promise.resolve();
          }
        };
      }
    });

    await runtime.start();
    await runtime.stop();

    expect(loggerCalls).toContain("filePath:.data/runtime.log");
    expect(loggerCalls).toContain("info:runtime.started");
    expect(loggerCalls).toContain("close");
  });

  describe("echo mode (RESPONSE_MODE=echo)", () => {
    const ECHO_CONFIG: RuntimeConfig = {
      ...VALID_CONFIG,
      responseMode: "echo"
    };

    it("does not call processRunner when a mention is received", async () => {
      let runnerCallCount = 0;
      const echoProcessRunner: ProcessRunner = {
        run() {
          runnerCallCount++;
          return Promise.resolve({
            stdout: "",
            stderr: "",
            exitCode: 0,
            timedOut: false
          });
        }
      };

      const replies: string[] = [];
      const echoTarget: DiscordMessageTarget = {
        sendTyping: () => Promise.resolve(),
        reactToMessage: () => Promise.resolve(),
        replyToMessage: (_msgId, _chanId, text) => {
          replies.push(text);
          return Promise.resolve();
        },
        sendMessage: (_chanId, text) => {
          replies.push(text);
          return Promise.resolve();
        }
      };

      const client = new FakeDiscordClient();
      const runtime = createLocalRuntime({
        configLoader: configLoader(ECHO_CONFIG),
        client,
        processRunner: echoProcessRunner,
        discordTarget: echoTarget,
        echoDelayMs: 0
      });

      await runtime.start();

      const mention: DiscordMessageLike = {
        id: "msg-1",
        content: `<@bot-1> hello echo`,
        author: { id: "user-42", bot: false },
        channelId: "chan-1",
        guildId: "guild-1",
        mentions: { users: { has: (id) => id === "bot-1" } }
      };

      client.emit(mention);

      await new Promise((resolve) => setTimeout(resolve, 50));
      await runtime.stop();

      expect(runnerCallCount).toBe(0);
    });

    it("replies with [에코] prefix when a mention is received", async () => {
      const replies: string[] = [];
      const reactions: Array<{
        messageId: string;
        channelId: string;
        emoji: string;
      }> = [];
      const typingCalls: string[] = [];
      const echoTarget: DiscordMessageTarget = {
        sendTyping: (channelId) => {
          typingCalls.push(channelId);
          return Promise.resolve();
        },
        reactToMessage: (messageId, channelId, emoji) => {
          reactions.push({ messageId, channelId, emoji });
          return Promise.resolve();
        },
        replyToMessage: (_msgId, _chanId, text) => {
          replies.push(text);
          return Promise.resolve();
        },
        sendMessage: (_chanId, text) => {
          replies.push(text);
          return Promise.resolve();
        }
      };

      const client = new FakeDiscordClient();
      const logs: StructuredLogEvent[] = [];
      const runtime = createLocalRuntime({
        configLoader: configLoader(ECHO_CONFIG),
        client,
        processRunner,
        discordTarget: echoTarget,
        log: (event) => logs.push(event),
        echoDelayMs: 0
      });

      await runtime.start();

      const mention: DiscordMessageLike = {
        id: "msg-1",
        content: `<@bot-1> hello echo`,
        author: { id: "user-42", bot: false },
        channelId: "chan-1",
        guildId: "guild-1",
        mentions: { users: { has: (id) => id === "bot-1" } }
      };

      client.emit(mention);

      await new Promise((resolve) => setTimeout(resolve, 50));
      await runtime.stop();

      expect(replies).toHaveLength(1);
      expect(replies[0]).toContain("[에코]");
      expect(replies[0]).toContain("hello echo");
      expect(reactions).toEqual([
        { messageId: "msg-1", channelId: "chan-1", emoji: "👀" }
      ]);
      expect(typingCalls).toEqual(["chan-1"]);
      expect(logs.some((event) => event.event === "job.completed")).toBe(true);
    });

    it("does not react in claude mode", async () => {
      const reactions: Array<{
        messageId: string;
        channelId: string;
        emoji: string;
      }> = [];
      const echoTarget: DiscordMessageTarget = {
        sendTyping: () => Promise.resolve(),
        reactToMessage: (messageId, channelId, emoji) => {
          reactions.push({ messageId, channelId, emoji });
          return Promise.resolve();
        },
        replyToMessage: () => Promise.resolve(),
        sendMessage: () => Promise.resolve()
      };

      const client = new FakeDiscordClient();
      const runtime = createLocalRuntime({
        configLoader: configLoader(VALID_CONFIG),
        client,
        processRunner,
        discordTarget: echoTarget
      });

      await runtime.start();
      client.emit({
        id: "msg-1",
        content: `<@bot-1> hello claude`,
        author: { id: "user-42", bot: false },
        channelId: "chan-1",
        guildId: "guild-1",
        mentions: { users: { has: (id) => id === "bot-1" } }
      });

      await new Promise((resolve) => setTimeout(resolve, 50));
      await runtime.stop();

      expect(reactions).toEqual([]);
    });
  });
});
