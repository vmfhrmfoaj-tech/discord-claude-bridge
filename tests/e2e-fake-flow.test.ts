import { beforeEach, describe, expect, it } from "vitest";

import { createFakeDiscordIngress } from "../src/fake-discord-ingress.js";
import { createJobQueue } from "../src/job-queue.js";
import { createMentionParser } from "../src/mention-parser.js";
import type {
  ClaudeCliAdapter,
  ClaudeCliResult,
  DiscordMessageEvent,
  SessionStore,
  StructuredLogEvent,
  StructuredLogger
} from "../src/modules.js";
import { createReplyPublisher } from "../src/reply-publisher.js";
import type { DiscordMessageTarget } from "../src/reply-publisher.js";

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function createInMemorySessionStore(): SessionStore {
  const map = new Map<string, string>();
  return {
    getSessionId: (key) => Promise.resolve(map.get(key)),
    setSessionId: (key, id) => {
      map.set(key, id);
      return Promise.resolve();
    }
  };
}

function createFakeAdapter(responses: ClaudeCliResult[]): ClaudeCliAdapter & {
  calls: Array<{ prompt: string; sessionId?: string }>;
} {
  const calls: Array<{ prompt: string; sessionId?: string }> = [];
  let idx = 0;
  return {
    calls,
    execute(req) {
      calls.push({ prompt: req.prompt, sessionId: req.sessionId });
      const res = responses[idx++] ?? {
        kind: "failure" as const,
        category: "non-zero-exit" as const
      };
      return Promise.resolve(res);
    }
  };
}

interface ReplyCapture {
  target: DiscordMessageTarget;
  replies: Array<{ messageId: string; channelId: string; text: string }>;
  failures: Array<{ messageId: string; channelId: string; category: string }>;
  typing: string[];
}

function createReplyCapture(): ReplyCapture {
  const replies: Array<{ messageId: string; channelId: string; text: string }> =
    [];
  const failures: Array<{
    messageId: string;
    channelId: string;
    category: string;
  }> = [];
  const typing: string[] = [];
  return {
    replies,
    failures,
    typing,
    target: {
      sendTyping: (channelId) => {
        typing.push(channelId);
        return Promise.resolve();
      },
      replyToMessage: (messageId, channelId, text) => {
        replies.push({ messageId, channelId, text });
        return Promise.resolve();
      },
      sendMessage: (channelId, text) => {
        replies.push({ messageId: "", channelId, text });
        return Promise.resolve();
      }
    }
  };
}

interface LogCapture {
  logger: StructuredLogger;
  events: StructuredLogEvent[];
}

function createLogCapture(): LogCapture {
  const events: StructuredLogEvent[] = [];
  return {
    events,
    logger: {
      info: (ev) => events.push(ev),
      warn: (ev) => events.push(ev),
      error: (ev) => events.push(ev),
      close: () => Promise.resolve()
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOT_ID = "bot-999";
const GUILD_ID = "guild-1";
const CHANNEL_ID = "chan-100";

function mention(
  overrides: Partial<DiscordMessageEvent> = {}
): DiscordMessageEvent {
  return {
    id: "msg-1",
    content: `<@${BOT_ID}> hello world`,
    authorId: "user-42",
    authorIsBot: false,
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    mentionsBot: true,
    ...overrides
  };
}

interface System {
  ingress: ReturnType<typeof createFakeDiscordIngress>;
  queue: ReturnType<typeof createJobQueue>;
  adapter: ReturnType<typeof createFakeAdapter>;
  replyCapture: ReplyCapture;
  logCapture: LogCapture;
  sessionStore: SessionStore;
}

function buildSystem(
  responses: ClaudeCliResult[],
  opts: { maxChunk?: number } = {}
): System {
  const replyCapture = createReplyCapture();
  const logCapture = createLogCapture();
  const sessionStore = createInMemorySessionStore();
  const adapter = createFakeAdapter(responses);

  const parser = createMentionParser({
    botId: BOT_ID,
    allowedGuildIds: [GUILD_ID],
    allowedChannelIds: [CHANNEL_ID],
    maxCharacters: 4000
  });

  const publisher = createReplyPublisher({
    discord: replyCapture.target,
    config: { maxChunkCharacters: opts.maxChunk ?? 1900 }
  });

  const queue = createJobQueue({
    adapter,
    publisher,
    sessionStore,
    config: { concurrency: 1, maxPendingJobs: 10 },
    logger: logCapture.logger
  });

  const ingress = createFakeDiscordIngress({
    parser,
    queue,
    logger: logCapture.logger
  });

  return { ingress, queue, adapter, replyCapture, logCapture, sessionStore };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("E2E: fake adapter mention-to-reply flow", () => {
  let sys: System;

  beforeEach(async () => {
    sys = buildSystem([
      { kind: "success", text: "Hello!", sessionId: "sess-abc", exitCode: 0 }
    ]);
    await sys.queue.start();
  });

  // --- Tracer bullet ---

  it("routes a mention to an adapter call and publishes the reply", async () => {
    await sys.ingress.receive(mention());
    await sys.queue.stop();

    expect(sys.adapter.calls).toHaveLength(1);
    expect(sys.adapter.calls[0]?.prompt).toBe("hello world");
    expect(sys.replyCapture.replies).toHaveLength(1);
    expect(sys.replyCapture.replies[0]?.text).toBe("Hello!");
  });

  // --- Non-mention ignored ---

  it("ignores non-mention and does not enqueue a job", async () => {
    const result = await sys.ingress.receive(mention({ mentionsBot: false }));
    await sys.queue.stop();

    expect(result.kind).toBe("ignored");
    expect(sys.adapter.calls).toHaveLength(0);
    expect(sys.replyCapture.replies).toHaveLength(0);
  });

  it("ignores bot messages and does not enqueue a job", async () => {
    const result = await sys.ingress.receive(mention({ authorIsBot: true }));
    await sys.queue.stop();

    expect(result.kind).toBe("ignored");
    expect(sys.adapter.calls).toHaveLength(0);
  });

  // --- Session continuity ---

  it("preserves session across two mentions on the same channel", async () => {
    sys = buildSystem([
      { kind: "success", text: "First!", sessionId: "sess-xyz", exitCode: 0 },
      { kind: "success", text: "Second!", sessionId: "sess-xyz", exitCode: 0 }
    ]);
    await sys.queue.start();

    await sys.ingress.receive(mention({ id: "msg-1" }));
    await sys.ingress.receive(mention({ id: "msg-2" }));
    await sys.queue.stop();

    expect(sys.adapter.calls[0]?.sessionId).toBeUndefined();
    expect(sys.adapter.calls[1]?.sessionId).toBe("sess-xyz");
  });

  it("keeps separate sessions for thread vs channel scope", async () => {
    sys = buildSystem([
      {
        kind: "success",
        text: "Thread reply",
        sessionId: "sess-thread",
        exitCode: 0
      },
      {
        kind: "success",
        text: "Channel reply",
        sessionId: "sess-chan",
        exitCode: 0
      }
    ]);
    await sys.queue.start();

    await sys.ingress.receive(mention({ id: "msg-t", threadId: "thread-1" }));
    await sys.ingress.receive(mention({ id: "msg-c" }));
    await sys.queue.stop();

    // Thread uses threadId as scope key; channel uses channelId
    expect(sys.adapter.calls[0]?.sessionId).toBeUndefined();
    expect(sys.adapter.calls[1]?.sessionId).toBeUndefined();
  });

  // --- Long reply chunking ---

  it("splits a long reply into multiple chunks", async () => {
    const longText = "A".repeat(120);
    sys = buildSystem(
      [{ kind: "success", text: longText, sessionId: undefined, exitCode: 0 }],
      { maxChunk: 50 }
    );
    await sys.queue.start();

    await sys.ingress.receive(mention());
    await sys.queue.stop();

    expect(sys.replyCapture.replies.length).toBeGreaterThan(1);
    // Strip chunk markers like "[1/3]" and verify all content preserved
    const stripped = sys.replyCapture.replies
      .map((r) => r.text.replace(/\[\d+\/\d+\]$/, ""))
      .join("");
    expect(stripped).toBe(longText);
  });

  // --- Failure scenarios ---

  it("publishes a failure message when adapter returns timeout", async () => {
    sys = buildSystem([{ kind: "failure", category: "timeout" }]);
    await sys.queue.start();

    await sys.ingress.receive(mention());
    await sys.queue.stop();

    expect(sys.replyCapture.replies).toHaveLength(1);
    expect(sys.replyCapture.replies[0]?.text).toContain("⏱️");
  });

  it("publishes a failure message when adapter returns auth-failure", async () => {
    sys = buildSystem([{ kind: "failure", category: "auth-failure" }]);
    await sys.queue.start();

    await sys.ingress.receive(mention());
    await sys.queue.stop();

    expect(sys.replyCapture.replies[0]?.text).toContain("🔒");
  });

  // --- Structured logs ---

  it("logs job.enqueued and job.completed with requestId", async () => {
    await sys.ingress.receive(mention());
    await sys.queue.stop();

    const enqueued = sys.logCapture.events.find(
      (e) => e.event === "job.enqueued"
    );
    const completed = sys.logCapture.events.find(
      (e) => e.event === "job.completed"
    );

    expect(enqueued).toBeDefined();
    expect(enqueued?.requestId).toBeDefined();
    expect(completed).toBeDefined();
    expect(completed?.requestId).toBe(enqueued?.requestId);
  });

  it("logs channelId and guildId in job events", async () => {
    await sys.ingress.receive(mention());
    await sys.queue.stop();

    const enqueued = sys.logCapture.events.find(
      (e) => e.event === "job.enqueued"
    );
    expect(enqueued?.channelId).toBe(CHANNEL_ID);
    expect(enqueued?.guildId).toBe(GUILD_ID);
  });

  it("does not log Discord token or secrets in structured events", async () => {
    const SECRET = "my-secret-token-do-not-log";
    await sys.ingress.receive(mention({ content: `<@${BOT_ID}> ${SECRET}` }));
    await sys.queue.stop();

    // The prompt text must not appear in any log event key
    const serialized = JSON.stringify(sys.logCapture.events);
    expect(serialized).not.toContain(SECRET);
  });

  it("logs job.failed with errorCategory on adapter failure", async () => {
    sys = buildSystem([{ kind: "failure", category: "missing-cli" }]);
    await sys.queue.start();

    await sys.ingress.receive(mention());
    await sys.queue.stop();

    const failed = sys.logCapture.events.find((e) => e.event === "job.failed");
    expect(failed?.errorCategory).toBe("missing-cli");
    expect(failed?.requestId).toBeDefined();
  });
});
