import { Client, GatewayIntentBits } from "discord.js";

import type { ProcessRunner } from "./claude-cli-adapter.js";
import { createClaudeCliAdapter } from "./claude-cli-adapter.js";
import { createConfigLoader } from "./config-loader.js";
import {
  createDiscordIngress,
  type DiscordIngressClient
} from "./discord-ingress.js";
import { createJobQueue } from "./job-queue.js";
import { createMentionParser } from "./mention-parser.js";
import type {
  ConfigLoader,
  DiscordIngress,
  JobQueue,
  ReplyPublisher,
  SessionStore,
  StructuredLogEvent,
  StructuredLogger
} from "./modules.js";
import { createNodeProcessRunner } from "./process-runner.js";
import {
  createReplyPublisher,
  type DiscordMessageTarget
} from "./reply-publisher.js";
import type { Runtime } from "./runtime.js";
import { JsonSessionStore } from "./session-store.js";

interface DiscordChannelClient extends DiscordIngressClient {
  channels: {
    fetch(channelId: string): Promise<DiscordChannelLike | null>;
  };
}

interface DiscordChannelLike {
  sendTyping?: () => Promise<unknown>;
  send?: (content: string) => Promise<unknown>;
  messages?: {
    fetch(messageId: string): Promise<DiscordFetchedMessageLike>;
  };
}

interface DiscordFetchedMessageLike {
  reply(content: string): Promise<unknown>;
}

export interface LocalRuntimeOptions {
  configLoader?: ConfigLoader;
  client?: DiscordIngressClient;
  discordTarget?: DiscordMessageTarget;
  processRunner?: ProcessRunner;
  sessionStore?: SessionStore;
  log?: (event: StructuredLogEvent) => void;
}

export function createLocalRuntime(options: LocalRuntimeOptions = {}): Runtime {
  const logger = createLogger(options);
  const configLoader = options.configLoader ?? createConfigLoader();
  const client = options.client ?? createDefaultDiscordClient();
  const processRunner = options.processRunner ?? createNodeProcessRunner();

  let started:
    | {
        ingress: DiscordIngress;
        queue: JobQueue;
      }
    | undefined;

  return {
    async start(): Promise<void> {
      logger.info({ event: "runtime.starting" });
      const config = await configLoader.load();

      const publisher = createPublisher({
        client,
        discordTarget: options.discordTarget,
        logger,
        maxChunkCharacters: config.reply.maxChunkCharacters
      });
      const queue = createJobQueue({
        adapter: createClaudeCliAdapter({
          runner: processRunner,
          binaryPath: config.claude.binaryPath
        }),
        publisher,
        sessionStore:
          options.sessionStore ??
          new JsonSessionStore(config.session.storePath),
        config: {
          concurrency: config.queue.concurrency,
          maxPendingJobs: config.queue.maxPendingJobs,
          claude: {
            timeoutMs: config.claude.timeoutMs,
            model: config.claude.model,
            systemPrompt: config.claude.systemPrompt,
            maxBudgetUsd: config.claude.maxBudgetUsd
          }
        }
      });
      const ingress = createDiscordIngress({
        client,
        token: config.discord.token,
        clientId: config.discord.clientId,
        parser: createMentionParser({
          botId: config.discord.clientId,
          allowedGuildIds: config.discord.allowedGuildIds,
          allowedChannelIds: config.discord.allowedChannelIds,
          maxCharacters: config.prompt.maxCharacters
        }),
        queue,
        publisher: config.reply.typingIndicator
          ? publisher
          : withoutTyping(publisher),
        logger
      });

      await queue.start();
      try {
        await ingress.start();
      } catch (error) {
        await queue.stop();
        throw error;
      }

      started = { ingress, queue };
      logger.info({ event: "runtime.started" });
    },

    async stop(): Promise<void> {
      logger.info({ event: "runtime.stopping" });
      if (started != null) {
        await started.ingress.stop();
        await started.queue.stop();
        started = undefined;
      }
      logger.info({ event: "runtime.stopped" });
    }
  };
}

function createDefaultDiscordClient(): DiscordChannelClient {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });
  return client as unknown as DiscordChannelClient;
}

function createPublisher(options: {
  client: DiscordIngressClient;
  discordTarget?: DiscordMessageTarget;
  logger: StructuredLogger;
  maxChunkCharacters: number;
}): ReplyPublisher {
  return createReplyPublisher({
    discord:
      options.discordTarget ??
      createDiscordJsMessageTarget(asChannelClient(options.client)),
    config: { maxChunkCharacters: options.maxChunkCharacters },
    onDiscordError: (category) => {
      options.logger.error({
        event: "replyPublisher.discordError",
        errorCategory: category
      });
    }
  });
}

function withoutTyping(
  publisher: ReplyPublisher
): Pick<ReplyPublisher, "publishTyping" | "publishFailure"> {
  return {
    publishTyping: () => Promise.resolve(),
    publishFailure: (target, category) =>
      publisher.publishFailure(target, category)
  };
}

function createDiscordJsMessageTarget(
  client: DiscordChannelClient
): DiscordMessageTarget {
  async function fetchChannel(channelId: string): Promise<DiscordChannelLike> {
    const channel = await client.channels.fetch(channelId);
    if (channel == null) {
      throw new Error(`Discord channel not found: ${channelId}`);
    }
    return channel;
  }

  return {
    async sendTyping(channelId: string): Promise<void> {
      const channel = await fetchChannel(channelId);
      if (channel.sendTyping == null) {
        throw new Error(`Discord channel cannot type: ${channelId}`);
      }
      await channel.sendTyping();
    },

    async replyToMessage(
      messageId: string,
      channelId: string,
      content: string
    ): Promise<void> {
      const channel = await fetchChannel(channelId);
      if (channel.messages == null) {
        throw new Error(`Discord channel has no messages: ${channelId}`);
      }
      const message = await channel.messages.fetch(messageId);
      await message.reply(content);
    },

    async sendMessage(channelId: string, content: string): Promise<void> {
      const channel = await fetchChannel(channelId);
      if (channel.send == null) {
        throw new Error(`Discord channel cannot send: ${channelId}`);
      }
      await channel.send(content);
    }
  };
}

function asChannelClient(client: DiscordIngressClient): DiscordChannelClient {
  if (!("channels" in client)) {
    throw new Error("Discord client must expose channels for reply publishing");
  }
  return client as DiscordChannelClient;
}

function createLogger(options: LocalRuntimeOptions): StructuredLogger {
  return {
    info(event) {
      options.log?.(event);
    },
    warn(event) {
      options.log?.(event);
    },
    error(event) {
      options.log?.(event);
    }
  };
}
