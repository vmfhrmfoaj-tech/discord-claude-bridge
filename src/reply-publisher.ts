import type {
  ReplyPublisher,
  ReplyTarget,
  StructuredLogger
} from "./modules.js";

export interface DiscordMessageTarget {
  sendTyping(channelId: string): Promise<void>;
  reactToMessage?(
    messageId: string,
    channelId: string,
    emoji: string
  ): Promise<void>;
  replyToMessage(
    messageId: string,
    channelId: string,
    content: string
  ): Promise<void>;
  sendMessage(channelId: string, content: string): Promise<void>;
}

export type DiscordSendError =
  | { kind: "deleted-message" }
  | { kind: "permission-failure" }
  | { kind: "rate-limit"; retryAfterMs: number }
  | { kind: "unknown"; message: string };

export interface ReplyPublisherConfig {
  maxChunkCharacters: number;
}

export interface ReplyPublisherDeps {
  discord: DiscordMessageTarget;
  config?: ReplyPublisherConfig;
  onDiscordError?: (category: string, retryAfterMs?: number) => void;
  logger?: StructuredLogger;
}

const DEFAULT_CONFIG: ReplyPublisherConfig = {
  maxChunkCharacters: 1900
};

const FAILURE_MESSAGES: Record<string, string> = {
  timeout: "⏱️ 요청 시간이 초과됐습니다. 다시 시도해주세요.",
  "missing-cli": "⚠️ Claude CLI를 찾을 수 없습니다. 운영자에게 문의해주세요.",
  "auth-failure": "🔒 인증에 실패했습니다. 운영자에게 문의해주세요.",
  "non-zero-exit": "❌ 요청 처리 중 오류가 발생했습니다. 다시 시도해주세요.",
  "invalid-json": "❌ 응답을 파싱하지 못했습니다. 다시 시도해주세요.",
  "queue-full": "⏳ 요청이 많아 처리할 수 없습니다. 잠시 후 다시 시도해주세요."
};

const UNKNOWN_FAILURE_MESSAGE =
  "❌ 알 수 없는 오류가 발생했습니다. 다시 시도해주세요.";
const DEFAULT_REACTION_EMOJI = "👀";

function splitIntoChunks(text: string, maxChunkCharacters: number): string[] {
  if (text.length <= maxChunkCharacters) {
    return [text];
  }

  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    chunks.push(text.slice(offset, offset + maxChunkCharacters));
    offset += maxChunkCharacters;
  }
  return chunks;
}

function markerString(index: number, total: number): string {
  return `[${index.toString()}/${total.toString()}]`;
}

function isObjectWithCode(
  err: unknown
): err is Record<string, unknown> & { code: unknown } {
  return err !== null && typeof err === "object" && "code" in err;
}

function classifyDiscordError(err: unknown): string {
  if (isObjectWithCode(err)) {
    if (err.code === 10008) return "deleted-message";
    if (err.code === 50013) return "permission-failure";
    if (err.code === 429) return "rate-limit";
  }
  return "unknown";
}

function defaultOnDiscordError(
  category: string,
  logger?: StructuredLogger
): void {
  if (logger !== undefined) {
    return;
  }
  process.stderr.write(`[reply-publisher] Discord error: ${category}\n`);
}

export function createReplyPublisher(deps: ReplyPublisherDeps): ReplyPublisher {
  const { discord, logger } = deps;
  const config = deps.config ?? DEFAULT_CONFIG;
  const onDiscordError =
    deps.onDiscordError ??
    ((category: string) => {
      defaultOnDiscordError(category, logger);
    });

  async function safeReply(
    messageId: string,
    channelId: string,
    content: string
  ): Promise<void> {
    try {
      await discord.replyToMessage(messageId, channelId, content);
    } catch (err) {
      const category = classifyDiscordError(err);
      logger?.error({ event: "discord.error", errorCategory: category });
      onDiscordError(category);
    }
  }

  return {
    async publishReaction(target: ReplyTarget): Promise<void> {
      if (discord.reactToMessage == null) {
        return;
      }

      try {
        await discord.reactToMessage(
          target.messageId,
          target.channelId,
          DEFAULT_REACTION_EMOJI
        );
      } catch (err) {
        const category = classifyDiscordError(err);
        logger?.error({ event: "discord.error", errorCategory: category });
        onDiscordError(category);
      }
    },

    async publishTyping(target: ReplyTarget): Promise<void> {
      await discord.sendTyping(target.channelId);
    },

    async publishSuccess(target: ReplyTarget, text: string): Promise<void> {
      const rawChunks = splitIntoChunks(text, config.maxChunkCharacters);

      if (rawChunks.length === 1) {
        await safeReply(target.messageId, target.channelId, rawChunks[0] ?? "");
        logger?.info({
          event: "reply.success",
          requestId: target.requestId,
          channelId: target.channelId,
          guildId: target.guildId,
          threadId: target.threadId
        });
        return;
      }

      // Multiple chunks — need markers. Markers like "[1/3]" take up to 6+ chars.
      // Re-split with room for markers: maxChunkCharacters - marker length overhead.
      const total = rawChunks.length;
      const markerLength = markerString(total, total).length;
      const effectiveMax = config.maxChunkCharacters - markerLength;

      const markedChunks = splitIntoChunks(text, effectiveMax);
      const actualTotal = markedChunks.length;

      for (let i = 0; i < markedChunks.length; i++) {
        const chunk = markedChunks[i];
        if (chunk === undefined) continue;
        const marker = markerString(i + 1, actualTotal);
        const content = `${chunk}${marker}`;
        await safeReply(target.messageId, target.channelId, content);
      }
      logger?.info({
        event: "reply.success",
        requestId: target.requestId,
        channelId: target.channelId,
        guildId: target.guildId,
        threadId: target.threadId
      });
    },

    async publishFailure(target: ReplyTarget, category: string): Promise<void> {
      const message = FAILURE_MESSAGES[category] ?? UNKNOWN_FAILURE_MESSAGE;
      await safeReply(target.messageId, target.channelId, message);
      logger?.info({
        event: "reply.failure",
        requestId: target.requestId,
        channelId: target.channelId,
        guildId: target.guildId,
        threadId: target.threadId,
        errorCategory: category
      });
    }
  };
}
