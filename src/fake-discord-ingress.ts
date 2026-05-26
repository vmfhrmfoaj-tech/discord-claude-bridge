import type {
  DiscordIngress,
  DiscordMessageEvent,
  EnqueueResult,
  JobQueue,
  MentionParseResult,
  MentionParser,
  MentionRequest,
  StructuredLogger
} from "./modules.js";

export type FakeDiscordIngressMessageResult =
  | MentionParseResult
  | {
      kind: "enqueued";
      request: MentionRequest;
      enqueueResult: EnqueueResult;
    };

export interface FakeDiscordIngress extends DiscordIngress {
  receive(
    message: DiscordMessageEvent
  ): Promise<FakeDiscordIngressMessageResult>;
}

export interface FakeDiscordIngressDeps {
  parser: MentionParser;
  queue: Pick<JobQueue, "enqueue">;
  logger?: Pick<StructuredLogger, "info" | "error">;
}

export function createFakeDiscordIngress(
  deps: FakeDiscordIngressDeps
): FakeDiscordIngress {
  return {
    start() {
      deps.logger?.info({ event: "discordIngress.fake.started" });
      return Promise.resolve();
    },
    stop() {
      deps.logger?.info({ event: "discordIngress.fake.stopped" });
      return Promise.resolve();
    },
    async receive(message) {
      const parsed = deps.parser.parse(message);
      if (parsed.kind === "ignored") {
        deps.logger?.info({
          event: "discordIngress.message.ignored",
          guildId: message.guildId,
          channelId: message.channelId,
          threadId: message.threadId
        });
        return parsed;
      }

      const enqueueResult = await deps.queue.enqueue(parsed.request);
      if (enqueueResult.kind === "accepted") {
        deps.logger?.info({
          event: "discordIngress.message.enqueued",
          requestId: enqueueResult.requestId,
          guildId: parsed.request.guildId,
          channelId: parsed.request.channelId,
          threadId: parsed.request.threadId,
          jobStatus: "accepted"
        });
      } else {
        deps.logger?.error({
          event: "discordIngress.message.rejected",
          guildId: parsed.request.guildId,
          channelId: parsed.request.channelId,
          threadId: parsed.request.threadId,
          jobStatus: enqueueResult.reason
        });
      }

      return {
        kind: "enqueued",
        request: parsed.request,
        enqueueResult
      };
    }
  };
}
