import { describe, expect, it, vi } from "vitest";

import {
  createReplyPublisher,
  type DiscordMessageTarget,
  type DiscordSendError
} from "../src/reply-publisher.js";
import type {
  ReplyTarget,
  StructuredLogEvent,
  StructuredLogger
} from "../src/modules.js";

class FakeLogger implements StructuredLogger {
  infos: StructuredLogEvent[] = [];
  warns: StructuredLogEvent[] = [];
  errors: StructuredLogEvent[] = [];
  info(ev: StructuredLogEvent): void {
    this.infos.push(ev);
  }
  warn(ev: StructuredLogEvent): void {
    this.warns.push(ev);
  }
  error(ev: StructuredLogEvent): void {
    this.errors.push(ev);
  }
}

const TARGET: ReplyTarget = { messageId: "msg-001", channelId: "chan-111" };

class FakeDiscordMessageTarget implements DiscordMessageTarget {
  typingCalls: string[] = [];
  reactionCalls: Array<{
    messageId: string;
    channelId: string;
    emoji: string;
  }> = [];
  replyCalls: Array<{ messageId: string; channelId: string; content: string }> =
    [];
  sendCalls: Array<{ channelId: string; content: string }> = [];

  private replyError?: DiscordSendError;

  setReplyError(error: DiscordSendError) {
    this.replyError = error;
  }

  sendTyping(channelId: string): Promise<void> {
    this.typingCalls.push(channelId);
    return Promise.resolve();
  }

  reactToMessage(
    messageId: string,
    channelId: string,
    emoji: string
  ): Promise<void> {
    this.reactionCalls.push({ messageId, channelId, emoji });
    return Promise.resolve();
  }

  replyToMessage(
    messageId: string,
    channelId: string,
    content: string
  ): Promise<void> {
    if (this.replyError) {
      const err = new Error("Discord error") as Error & { code?: number };
      if (this.replyError.kind === "deleted-message") err.code = 10008;
      if (this.replyError.kind === "permission-failure") err.code = 50013;
      if (this.replyError.kind === "rate-limit") err.code = 429;
      return Promise.reject(err);
    }
    this.replyCalls.push({ messageId, channelId, content });
    return Promise.resolve();
  }

  sendMessage(channelId: string, content: string): Promise<void> {
    this.sendCalls.push({ channelId, content });
    return Promise.resolve();
  }
}

describe("ReplyPublisher", () => {
  describe("reaction behavior", () => {
    it("publishReaction reacts to the original message", async () => {
      const discord = new FakeDiscordMessageTarget();
      const publisher = createReplyPublisher({ discord });

      await publisher.publishReaction(TARGET);

      expect(discord.reactionCalls).toEqual([
        {
          messageId: TARGET.messageId,
          channelId: TARGET.channelId,
          emoji: "👀"
        }
      ]);
    });
  });

  describe("typing behavior", () => {
    it("publishTyping calls sendTyping with correct channelId", async () => {
      const discord = new FakeDiscordMessageTarget();
      const publisher = createReplyPublisher({ discord });

      await publisher.publishTyping(TARGET);

      expect(discord.typingCalls).toEqual([TARGET.channelId]);
    });
  });

  describe("final reply", () => {
    it("publishSuccess calls replyToMessage with correct messageId and channelId", async () => {
      const discord = new FakeDiscordMessageTarget();
      const publisher = createReplyPublisher({ discord });

      await publisher.publishSuccess(TARGET, "Hello, world!");

      expect(discord.replyCalls).toHaveLength(1);
      expect(discord.replyCalls[0]?.messageId).toBe(TARGET.messageId);
      expect(discord.replyCalls[0]?.channelId).toBe(TARGET.channelId);
      expect(discord.replyCalls[0]?.content).toBe("Hello, world!");
    });
  });

  describe("short text no split", () => {
    it("text under limit sends single reply with no chunk markers", async () => {
      const discord = new FakeDiscordMessageTarget();
      const publisher = createReplyPublisher({
        discord,
        config: { maxChunkCharacters: 1900 }
      });

      const text = "Short response";
      await publisher.publishSuccess(TARGET, text);

      expect(discord.replyCalls).toHaveLength(1);
      expect(discord.replyCalls[0]?.content).toBe(text);
      expect(discord.replyCalls[0]?.content).not.toContain("[1/");
    });
  });

  describe("split ordering", () => {
    it("text over limit splits into multiple replies with chunk markers in order", async () => {
      const discord = new FakeDiscordMessageTarget();
      const publisher = createReplyPublisher({
        discord,
        config: { maxChunkCharacters: 20 }
      });

      // 60 chars, split into 3 chunks of 20 chars each
      const text = "A".repeat(60);
      await publisher.publishSuccess(TARGET, text);

      expect(discord.replyCalls.length).toBeGreaterThan(1);

      // verify ordering markers
      const contents = discord.replyCalls.map((c) => c.content);
      const total = discord.replyCalls.length;
      contents.forEach((content, idx) => {
        const position = (idx + 1).toString();
        const count = total.toString();
        expect(content).toContain(`[${position}/${count}]`);
      });
    });

    it("each chunk is at or below maxChunkCharacters", async () => {
      const discord = new FakeDiscordMessageTarget();
      const maxChunkCharacters = 20;
      const publisher = createReplyPublisher({
        discord,
        config: { maxChunkCharacters }
      });

      const text = "B".repeat(100);
      await publisher.publishSuccess(TARGET, text);

      for (const call of discord.replyCalls) {
        expect(call.content.length).toBeLessThanOrEqual(maxChunkCharacters);
      }
    });
  });

  describe("failure reply - Korean messages", () => {
    it("publishFailure(timeout) sends Korean timeout message", async () => {
      const discord = new FakeDiscordMessageTarget();
      const publisher = createReplyPublisher({ discord });

      await publisher.publishFailure(TARGET, "timeout");

      expect(discord.replyCalls).toHaveLength(1);
      expect(discord.replyCalls[0]?.content).toBe(
        "⏱️ 요청 시간이 초과됐습니다. 다시 시도해주세요."
      );
    });

    it("publishFailure(missing-cli) sends Korean missing-cli message", async () => {
      const discord = new FakeDiscordMessageTarget();
      const publisher = createReplyPublisher({ discord });

      await publisher.publishFailure(TARGET, "missing-cli");

      expect(discord.replyCalls[0]?.content).toBe(
        "⚠️ Claude CLI를 찾을 수 없습니다. 운영자에게 문의해주세요."
      );
    });

    it("publishFailure(auth-failure) sends Korean auth-failure message", async () => {
      const discord = new FakeDiscordMessageTarget();
      const publisher = createReplyPublisher({ discord });

      await publisher.publishFailure(TARGET, "auth-failure");

      expect(discord.replyCalls[0]?.content).toBe(
        "🔒 인증에 실패했습니다. 운영자에게 문의해주세요."
      );
    });

    it("publishFailure(non-zero-exit) sends Korean non-zero-exit message", async () => {
      const discord = new FakeDiscordMessageTarget();
      const publisher = createReplyPublisher({ discord });

      await publisher.publishFailure(TARGET, "non-zero-exit");

      expect(discord.replyCalls[0]?.content).toBe(
        "❌ 요청 처리 중 오류가 발생했습니다. 다시 시도해주세요."
      );
    });

    it("publishFailure(invalid-json) sends Korean invalid-json message", async () => {
      const discord = new FakeDiscordMessageTarget();
      const publisher = createReplyPublisher({ discord });

      await publisher.publishFailure(TARGET, "invalid-json");

      expect(discord.replyCalls[0]?.content).toBe(
        "❌ 응답을 파싱하지 못했습니다. 다시 시도해주세요."
      );
    });

    it("publishFailure(queue-full) sends Korean queue-full message", async () => {
      const discord = new FakeDiscordMessageTarget();
      const publisher = createReplyPublisher({ discord });

      await publisher.publishFailure(TARGET, "queue-full");

      expect(discord.replyCalls[0]?.content).toBe(
        "⏳ 요청이 많아 처리할 수 없습니다. 잠시 후 다시 시도해주세요."
      );
    });

    it("publishFailure with unknown category sends generic Korean message", async () => {
      const discord = new FakeDiscordMessageTarget();
      const publisher = createReplyPublisher({ discord });

      await publisher.publishFailure(TARGET, "unexpected-category");

      expect(discord.replyCalls[0]?.content).toBe(
        "❌ 알 수 없는 오류가 발생했습니다. 다시 시도해주세요."
      );
    });

    it("failure reply does not expose raw internal error details", async () => {
      const discord = new FakeDiscordMessageTarget();
      const publisher = createReplyPublisher({ discord });

      await publisher.publishFailure(TARGET, "non-zero-exit");

      const content = discord.replyCalls[0]?.content ?? "";
      expect(content).not.toContain("Error");
      expect(content).not.toContain("stack");
      expect(content).not.toContain("stderr");
    });
  });

  describe("Discord error handling", () => {
    it("deleted message (10008) is caught, logged, and does not re-throw", async () => {
      const discord = new FakeDiscordMessageTarget();
      discord.setReplyError({ kind: "deleted-message" });

      const loggedErrors: string[] = [];
      const publisher = createReplyPublisher({
        discord,
        onDiscordError: (category) => {
          loggedErrors.push(category);
        }
      });

      // should not throw
      await expect(
        publisher.publishSuccess(TARGET, "hello")
      ).resolves.toBeUndefined();

      expect(loggedErrors).toContain("deleted-message");
    });

    it("permission failure (50013) is caught, logged, and does not re-throw", async () => {
      const discord = new FakeDiscordMessageTarget();
      discord.setReplyError({ kind: "permission-failure" });

      const loggedErrors: string[] = [];
      const publisher = createReplyPublisher({
        discord,
        onDiscordError: (category) => {
          loggedErrors.push(category);
        }
      });

      await expect(
        publisher.publishSuccess(TARGET, "hello")
      ).resolves.toBeUndefined();

      expect(loggedErrors).toContain("permission-failure");
    });

    it("rate limit (429) is caught, logged with rate-limit category, and does not re-throw", async () => {
      const discord = new FakeDiscordMessageTarget();
      discord.setReplyError({ kind: "rate-limit", retryAfterMs: 5000 });

      const loggedErrors: string[] = [];
      const publisher = createReplyPublisher({
        discord,
        onDiscordError: (category) => {
          loggedErrors.push(category);
        }
      });

      await expect(
        publisher.publishSuccess(TARGET, "hello")
      ).resolves.toBeUndefined();

      expect(loggedErrors).toContain("rate-limit");
    });

    it("default onDiscordError uses console.error and does not throw", async () => {
      const discord = new FakeDiscordMessageTarget();
      discord.setReplyError({ kind: "deleted-message" });

      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);

      const publisher = createReplyPublisher({ discord });

      await expect(
        publisher.publishSuccess(TARGET, "hello")
      ).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });
  });

  describe("logging", () => {
    it("logs reply.success on publishSuccess", async () => {
      const discord = new FakeDiscordMessageTarget();
      const logger = new FakeLogger();
      const publisher = createReplyPublisher({ discord, logger });

      await publisher.publishSuccess(TARGET, "hello");

      const ev = logger.infos.find((e) => e.event === "reply.success");
      expect(ev).toBeDefined();
      expect(ev?.channelId).toBe(TARGET.channelId);
    });

    it("logs reply.failure on publishFailure", async () => {
      const discord = new FakeDiscordMessageTarget();
      const logger = new FakeLogger();
      const publisher = createReplyPublisher({ discord, logger });

      await publisher.publishFailure(TARGET, "timeout");

      const ev = logger.infos.find((e) => e.event === "reply.failure");
      expect(ev).toBeDefined();
      expect(ev?.errorCategory).toBe("timeout");
    });

    it("logs discord.error with category when Discord send fails", async () => {
      const discord = new FakeDiscordMessageTarget();
      discord.setReplyError({ kind: "deleted-message" });
      const logger = new FakeLogger();
      const publisher = createReplyPublisher({ discord, logger });

      await publisher.publishSuccess(TARGET, "hello");

      const ev = logger.errors.find((e) => e.event === "discord.error");
      expect(ev).toBeDefined();
      expect(ev?.errorCategory).toBe("deleted-message");
    });
  });
});
