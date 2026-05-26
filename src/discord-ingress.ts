import type {
  DiscordIngress,
  DiscordMessageEvent,
  JobQueue,
  MentionParser,
  ReplyPublisher,
  ReplyTarget,
  StructuredLogger
} from "./modules.js";

export interface DiscordIngressClient {
  on(
    event: "messageCreate",
    listener: (message: DiscordMessageLike) => void
  ): DiscordIngressClient;
  login(token: string): Promise<unknown>;
  destroy(): void;
}

export interface DiscordMessageLike {
  id: string;
  content: string;
  author: {
    id: string;
    bot: boolean;
  };
  channelId: string;
  guildId: string | null;
  mentions?: {
    users?: {
      has(id: string): boolean;
    };
  };
  channel?: {
    id?: string;
    isThread?: () => boolean;
  };
}

export interface DiscordIngressDeps {
  client: DiscordIngressClient;
  token: string;
  clientId: string;
  parser: MentionParser;
  queue: Pick<JobQueue, "enqueue">;
  publisher: Pick<ReplyPublisher, "publishTyping" | "publishFailure"> &
    Partial<Pick<ReplyPublisher, "publishReaction">>;
  logger?: Pick<StructuredLogger, "info" | "error">;
}

export function createDiscordIngress(deps: DiscordIngressDeps): DiscordIngress {
  async function handleMessage(message: DiscordMessageLike): Promise<void> {
    if (message.guildId == null) {
      deps.logger?.info({
        event: "discordIngress.message.ignored",
        channelId: message.channelId
      });
      return;
    }

    if (message.content.trimStart().startsWith("/")) {
      deps.logger?.info({
        event: "discordIngress.message.ignored",
        guildId: message.guildId,
        channelId: message.channelId
      });
      return;
    }

    const parsed = deps.parser.parse(
      toDiscordMessageEvent(message, deps.clientId)
    );
    if (parsed.kind === "ignored") {
      deps.logger?.info({
        event: "discordIngress.message.ignored",
        guildId: message.guildId,
        channelId: message.channelId,
        threadId: threadIdFor(message)
      });
      return;
    }

    const enqueueResult = await deps.queue.enqueue(parsed.request);
    const target: ReplyTarget = {
      messageId: parsed.request.messageId,
      channelId: parsed.request.channelId,
      requestId:
        enqueueResult.kind === "accepted" ? enqueueResult.requestId : undefined,
      guildId: parsed.request.guildId,
      threadId: parsed.request.threadId
    };

    if (enqueueResult.kind === "accepted") {
      await deps.publisher.publishReaction?.(target);
      await deps.publisher.publishTyping(target);
      deps.logger?.info({
        event: "discordIngress.message.enqueued",
        requestId: enqueueResult.requestId,
        guildId: parsed.request.guildId,
        channelId: parsed.request.channelId,
        threadId: parsed.request.threadId,
        jobStatus: "accepted"
      });
      return;
    }

    await deps.publisher.publishFailure(target, enqueueResult.reason);
    deps.logger?.error({
      event: "discordIngress.message.rejected",
      guildId: parsed.request.guildId,
      channelId: parsed.request.channelId,
      threadId: parsed.request.threadId,
      jobStatus: enqueueResult.reason
    });
  }

  return {
    async start(): Promise<void> {
      deps.client.on("messageCreate", (message) => {
        void handleMessage(message).catch(() => {
          deps.logger?.error({ event: "discordIngress.message.failed" });
        });
      });
      deps.logger?.info({ event: "discordIngress.login.starting" });
      await deps.client.login(deps.token);
      deps.logger?.info({ event: "discordIngress.login.succeeded" });
    },
    stop(): Promise<void> {
      deps.client.destroy();
      deps.logger?.info({ event: "discordIngress.stopped" });
      return Promise.resolve();
    }
  };
}

function toDiscordMessageEvent(
  message: DiscordMessageLike,
  clientId: string
): DiscordMessageEvent {
  return {
    id: message.id,
    content: message.content,
    authorId: message.author.id,
    authorIsBot: message.author.bot,
    channelId: message.channelId,
    guildId: message.guildId ?? undefined,
    threadId: threadIdFor(message),
    mentionsBot: mentionsClient(message, clientId)
  };
}

function mentionsClient(
  message: DiscordMessageLike,
  clientId: string
): boolean {
  return message.mentions?.users?.has(clientId) ?? false;
}

function threadIdFor(message: DiscordMessageLike): string | undefined {
  if (message.channel?.isThread?.() === true) {
    return message.channel.id ?? message.channelId;
  }
  return undefined;
}
