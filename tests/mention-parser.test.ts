import { describe, expect, it } from "vitest";

import { createFakeDiscordIngress, createMentionParser } from "../src/index.js";
import type {
  DiscordMessageEvent,
  EnqueueResult,
  JobQueue,
  MentionRequest
} from "../src/modules.js";

const BOT_ID = "bot-111";
const GUILD_ID = "guild-222";
const CHANNEL_ID = "chan-333";
const AUTHOR_ID = "user-444";

const BASE_CONFIG = {
  botId: BOT_ID,
  allowedGuildIds: [] as string[],
  allowedChannelIds: [] as string[],
  maxCharacters: 100
};

function mentionEvent(
  overrides: Partial<DiscordMessageEvent> = {}
): DiscordMessageEvent {
  return {
    id: "msg-001",
    content: `<@${BOT_ID}> hello`,
    authorId: AUTHOR_ID,
    authorIsBot: false,
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    mentionsBot: true,
    ...overrides
  };
}

function createFakeJobQueue(): JobQueue & {
  received: MentionRequest[];
} {
  const received: MentionRequest[] = [];
  return {
    received,
    enqueue(request) {
      received.push(request);
      return Promise.resolve({
        kind: "accepted",
        requestId: "fake-req-id"
      } satisfies EnqueueResult);
    },
    start() {
      return Promise.resolve();
    },
    stop() {
      return Promise.resolve();
    }
  };
}

describe("MentionParser", () => {
  describe("mention acceptance", () => {
    it("accepts a valid bot mention and returns normalized request", () => {
      const parser = createMentionParser(BASE_CONFIG);
      const result = parser.parse(mentionEvent());

      expect(result.kind).toBe("accepted");
      if (result.kind !== "accepted") return;

      expect(result.request.messageId).toBe("msg-001");
      expect(result.request.authorId).toBe(AUTHOR_ID);
      expect(result.request.channelId).toBe(CHANNEL_ID);
      expect(result.request.guildId).toBe(GUILD_ID);
      expect(result.request.prompt).toBe("hello");
      expect(result.request.sessionScopeKey).toBe(CHANNEL_ID);
    });
  });

  describe("ignore paths", () => {
    it("ignores message that does not mention the bot", () => {
      const parser = createMentionParser(BASE_CONFIG);
      const result = parser.parse(
        mentionEvent({ mentionsBot: false, content: "hello everyone" })
      );
      expect(result).toEqual({ kind: "ignored", reason: "not-mentioned" });
    });

    it("ignores message from a bot author", () => {
      const parser = createMentionParser(BASE_CONFIG);
      const result = parser.parse(mentionEvent({ authorIsBot: true }));
      expect(result).toEqual({ kind: "ignored", reason: "bot-message" });
    });

    it("ignores self-message where author is the bot itself", () => {
      const parser = createMentionParser(BASE_CONFIG);
      const result = parser.parse(
        mentionEvent({ authorId: BOT_ID, authorIsBot: true })
      );
      expect(result).toEqual({ kind: "ignored", reason: "self-message" });
    });

    it("ignores message from a disallowed guild", () => {
      const parser = createMentionParser({
        ...BASE_CONFIG,
        allowedGuildIds: ["guild-allowed"]
      });
      const result = parser.parse(mentionEvent({ guildId: "guild-other" }));
      expect(result).toEqual({ kind: "ignored", reason: "disallowed-guild" });
    });

    it("ignores message with no guildId when allowedGuildIds is non-empty", () => {
      const parser = createMentionParser({
        ...BASE_CONFIG,
        allowedGuildIds: ["guild-allowed"]
      });
      const result = parser.parse(mentionEvent({ guildId: undefined }));
      expect(result).toEqual({ kind: "ignored", reason: "disallowed-guild" });
    });

    it("ignores message from a disallowed channel", () => {
      const parser = createMentionParser({
        ...BASE_CONFIG,
        allowedChannelIds: ["chan-allowed"]
      });
      const result = parser.parse(mentionEvent({ channelId: "chan-other" }));
      expect(result).toEqual({ kind: "ignored", reason: "disallowed-channel" });
    });

    it("ignores message with empty prompt after stripping mention", () => {
      const parser = createMentionParser(BASE_CONFIG);
      const result = parser.parse(mentionEvent({ content: `<@${BOT_ID}>   ` }));
      expect(result).toEqual({ kind: "ignored", reason: "empty-prompt" });
    });
  });

  describe("prompt extraction", () => {
    it("trims whitespace from extracted prompt", () => {
      const parser = createMentionParser(BASE_CONFIG);
      const result = parser.parse(
        mentionEvent({ content: `<@${BOT_ID}>   trimmed   ` })
      );
      expect(result.kind).toBe("accepted");
      if (result.kind !== "accepted") return;
      expect(result.request.prompt).toBe("trimmed");
    });

    it("strips nickname mention format <@!botId>", () => {
      const parser = createMentionParser(BASE_CONFIG);
      const result = parser.parse(
        mentionEvent({ content: `<@!${BOT_ID}> nick mention` })
      );
      expect(result.kind).toBe("accepted");
      if (result.kind !== "accepted") return;
      expect(result.request.prompt).toBe("nick mention");
    });
  });

  describe("prompt size behavior", () => {
    it("accepts prompt exactly at maxCharacters limit", () => {
      const parser = createMentionParser({ ...BASE_CONFIG, maxCharacters: 5 });
      const result = parser.parse(
        mentionEvent({ content: `<@${BOT_ID}> hello` })
      );
      expect(result.kind).toBe("accepted");
      if (result.kind !== "accepted") return;
      expect(result.request.prompt).toBe("hello");
    });

    it("ignores prompt that exceeds maxCharacters with reject policy (default)", () => {
      const parser = createMentionParser({ ...BASE_CONFIG, maxCharacters: 3 });
      const result = parser.parse(
        mentionEvent({ content: `<@${BOT_ID}> hello` })
      );
      expect(result).toEqual({ kind: "ignored", reason: "too-large" });
    });

    it("trims prompt to maxCharacters with trim policy", () => {
      const parser = createMentionParser({
        ...BASE_CONFIG,
        maxCharacters: 3,
        oversizePolicy: "trim" as const
      });
      const result = parser.parse(
        mentionEvent({ content: `<@${BOT_ID}> hello` })
      );
      expect(result.kind).toBe("accepted");
      if (result.kind !== "accepted") return;
      expect(result.request.prompt).toBe("hel");
    });
  });

  describe("channel and thread metadata normalization", () => {
    it("sets sessionScopeKey to channelId when no threadId", () => {
      const parser = createMentionParser(BASE_CONFIG);
      const result = parser.parse(mentionEvent({ threadId: undefined }));
      expect(result.kind).toBe("accepted");
      if (result.kind !== "accepted") return;
      expect(result.request.threadId).toBeUndefined();
      expect(result.request.sessionScopeKey).toBe(CHANNEL_ID);
    });

    it("sets sessionScopeKey to threadId when message is in a thread", () => {
      const parser = createMentionParser(BASE_CONFIG);
      const result = parser.parse(mentionEvent({ threadId: "thread-999" }));
      expect(result.kind).toBe("accepted");
      if (result.kind !== "accepted") return;
      expect(result.request.threadId).toBe("thread-999");
      expect(result.request.sessionScopeKey).toBe("thread-999");
    });

    it("passes through guildId as optional field", () => {
      const parser = createMentionParser(BASE_CONFIG);
      const result = parser.parse(mentionEvent({ guildId: undefined }));
      expect(result.kind).toBe("accepted");
      if (result.kind !== "accepted") return;
      expect(result.request.guildId).toBeUndefined();
    });

    it("allows all guilds when allowedGuildIds is empty", () => {
      const parser = createMentionParser({
        ...BASE_CONFIG,
        allowedGuildIds: []
      });
      const result = parser.parse(mentionEvent({ guildId: "any-guild" }));
      expect(result.kind).toBe("accepted");
    });

    it("allows all channels when allowedChannelIds is empty", () => {
      const parser = createMentionParser({
        ...BASE_CONFIG,
        allowedChannelIds: []
      });
      const result = parser.parse(mentionEvent({ channelId: "any-channel" }));
      expect(result.kind).toBe("accepted");
    });
  });
});

describe("Fake Discord Ingress enqueue path", () => {
  it("enqueues normalized request to job queue for accepted mention", async () => {
    const parser = createMentionParser(BASE_CONFIG);
    const queue = createFakeJobQueue();
    const ingress = createFakeDiscordIngress({ parser, queue });

    const result = await ingress.receive(mentionEvent());

    expect(result.kind).toBe("enqueued");
    expect(queue.received).toHaveLength(1);
    expect(queue.received[0]?.authorId).toBe(AUTHOR_ID);
    expect(queue.received[0]?.prompt).toBe("hello");
  });

  it("does not enqueue ignored message", async () => {
    const parser = createMentionParser(BASE_CONFIG);
    const queue = createFakeJobQueue();
    const ingress = createFakeDiscordIngress({ parser, queue });

    const result = await ingress.receive(
      mentionEvent({ mentionsBot: false, content: "just chatting" })
    );

    expect(result).toEqual({ kind: "ignored", reason: "not-mentioned" });
    expect(queue.received).toHaveLength(0);
  });

  it("enqueue returns without blocking on Claude completion", async () => {
    const parser = createMentionParser(BASE_CONFIG);
    let enqueueDone = false;
    const queue: Pick<JobQueue, "enqueue"> = {
      enqueue() {
        enqueueDone = true;
        return Promise.resolve({
          kind: "accepted",
          requestId: "r1"
        } satisfies EnqueueResult);
      }
    };
    const ingress = createFakeDiscordIngress({ parser, queue });

    const result = await ingress.receive(mentionEvent());

    expect(result.kind).toBe("enqueued");
    expect(enqueueDone).toBe(true);
  });
});
