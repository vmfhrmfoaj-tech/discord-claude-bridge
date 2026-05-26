import type {
  DiscordMessageEvent,
  MentionParser,
  MentionParseResult
} from "./modules.js";

export interface MentionParserConfig {
  botId: string;
  allowedGuildIds: string[];
  allowedChannelIds: string[];
  maxCharacters: number;
  oversizePolicy?: "reject" | "trim";
}

export function createMentionParser(
  config: MentionParserConfig
): MentionParser {
  const {
    botId,
    allowedGuildIds,
    allowedChannelIds,
    maxCharacters,
    oversizePolicy = "reject"
  } = config;

  return {
    parse(message: DiscordMessageEvent): MentionParseResult {
      if (!message.mentionsBot) {
        return { kind: "ignored", reason: "not-mentioned" };
      }

      if (message.authorId === botId) {
        return { kind: "ignored", reason: "self-message" };
      }

      if (message.authorIsBot) {
        return { kind: "ignored", reason: "bot-message" };
      }

      if (allowedGuildIds.length > 0) {
        if (!message.guildId || !allowedGuildIds.includes(message.guildId)) {
          return { kind: "ignored", reason: "disallowed-guild" };
        }
      }

      if (
        allowedChannelIds.length > 0 &&
        !allowedChannelIds.includes(message.channelId)
      ) {
        return { kind: "ignored", reason: "disallowed-channel" };
      }

      const prompt = extractPrompt(message.content, botId);

      if (prompt === "") {
        return { kind: "ignored", reason: "empty-prompt" };
      }

      if (prompt.length > maxCharacters) {
        if (oversizePolicy === "trim") {
          return {
            kind: "accepted",
            request: buildRequest(message, prompt.slice(0, maxCharacters))
          };
        }
        return { kind: "ignored", reason: "too-large" };
      }

      return { kind: "accepted", request: buildRequest(message, prompt) };
    }
  };
}

function extractPrompt(content: string, botId: string): string {
  return content
    .replace(new RegExp(`<@!?${escapeRegExp(botId)}>`, "g"), "")
    .trim();
}

function buildRequest(message: DiscordMessageEvent, prompt: string) {
  const sessionScopeKey = message.threadId ?? message.channelId;
  return {
    messageId: message.id,
    authorId: message.authorId,
    channelId: message.channelId,
    guildId: message.guildId,
    threadId: message.threadId,
    prompt,
    sessionScopeKey
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
