import { describe, expect, it } from "vitest";

import { createClaudeCliAdapter } from "../src/claude-cli-adapter.js";
import { createFakeDiscordIngress } from "../src/fake-discord-ingress.js";
import { createJobQueue } from "../src/job-queue.js";
import { createMentionParser } from "../src/mention-parser.js";
import type {
  DiscordMessageEvent,
  SessionStore,
  StructuredLogEvent,
  StructuredLogger
} from "../src/modules.js";
import { createNodeProcessRunner } from "../src/process-runner.js";
import { createReplyPublisher } from "../src/reply-publisher.js";
import type { DiscordMessageTarget } from "../src/reply-publisher.js";

const maybeIt = process.env["RUN_INTEGRATED_SMOKE"] === "1" ? it : it.skip;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOT_ID = "bot-999";
const GUILD_ID = "guild-1";
const CHANNEL_ID = "chan-100";

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

interface ReplyCapture {
  target: DiscordMessageTarget;
  replies: Array<{ messageId: string; channelId: string; text: string }>;
}

function createReplyCapture(): ReplyCapture {
  const replies: Array<{ messageId: string; channelId: string; text: string }> =
    [];
  return {
    replies,
    target: {
      sendTyping: () => Promise.resolve(),
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
      error: (ev) => events.push(ev)
    }
  };
}

function mention(
  overrides: Partial<DiscordMessageEvent> = {}
): DiscordMessageEvent {
  return {
    id: "msg-1",
    content: `<@${BOT_ID}> say hello in one word`,
    authorId: "user-42",
    authorIsBot: false,
    channelId: CHANNEL_ID,
    guildId: GUILD_ID,
    mentionsBot: true,
    ...overrides
  };
}

interface IntegratedSystem {
  ingress: ReturnType<typeof createFakeDiscordIngress>;
  queue: ReturnType<typeof createJobQueue>;
  replyCapture: ReplyCapture;
  logCapture: LogCapture;
}

function buildIntegratedSystem(opts: { binaryPath?: string } = {}): IntegratedSystem {
  const replyCapture = createReplyCapture();
  const logCapture = createLogCapture();
  const sessionStore = createInMemorySessionStore();

  const runner = createNodeProcessRunner();
  const adapter = createClaudeCliAdapter({
    runner,
    binaryPath: opts.binaryPath,
    logger: logCapture.logger
  });

  const parser = createMentionParser({
    botId: BOT_ID,
    allowedGuildIds: [GUILD_ID],
    allowedChannelIds: [CHANNEL_ID],
    maxCharacters: 4000
  });

  const publisher = createReplyPublisher({
    discord: replyCapture.target,
    config: { maxChunkCharacters: 1900 }
  });

  const queue = createJobQueue({
    adapter,
    publisher,
    sessionStore,
    config: {
      concurrency: 1,
      maxPendingJobs: 10,
      claude: { timeoutMs: 120_000 }
    },
    logger: logCapture.logger
  });

  const ingress = createFakeDiscordIngress({
    parser,
    queue,
    logger: logCapture.logger
  });

  return { ingress, queue, replyCapture, logCapture };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("integrated smoke: real Claude CLI through full pipeline", () => {
  maybeIt(
    "routes a mention through real Claude CLI and publishes a non-empty reply",
    async () => {
      const sys = buildIntegratedSystem();
      await sys.queue.start();
      await sys.ingress.receive(mention());
      await sys.queue.stop();

      expect(sys.replyCapture.replies.length).toBeGreaterThanOrEqual(1);
      expect(typeof sys.replyCapture.replies[0]?.text).toBe("string");
      expect((sys.replyCapture.replies[0]?.text ?? "").length).toBeGreaterThan(0);
    },
    120_000
  );

  maybeIt(
    "logs job.enqueued, job.completed with matching requestId across lifecycle",
    async () => {
      const sys = buildIntegratedSystem();
      await sys.queue.start();
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
    },
    120_000
  );

  maybeIt(
    "logs channelId in job events for full trace",
    async () => {
      const sys = buildIntegratedSystem();
      await sys.queue.start();
      await sys.ingress.receive(mention());
      await sys.queue.stop();

      const enqueued = sys.logCapture.events.find(
        (e) => e.event === "job.enqueued"
      );
      expect(enqueued?.channelId).toBe(CHANNEL_ID);
    },
    120_000
  );

  maybeIt(
    "publishes a failure reply with structured log when CLI is not available",
    async () => {
      const sys = buildIntegratedSystem({ binaryPath: "/nonexistent/claude" });
      await sys.queue.start();
      await sys.ingress.receive(mention());
      await sys.queue.stop();

      expect(sys.replyCapture.replies.length).toBeGreaterThanOrEqual(1);

      const failed = sys.logCapture.events.find(
        (e) => e.event === "job.failed"
      );
      expect(failed).toBeDefined();
      expect(failed?.errorCategory).toBeDefined();
    },
    30_000
  );

  maybeIt(
    "does not produce duplicate replies for a single mention",
    async () => {
      const sys = buildIntegratedSystem();
      await sys.queue.start();
      await sys.ingress.receive(mention());
      await sys.queue.stop();

      expect(sys.replyCapture.replies.length).toBe(1);
    },
    120_000
  );

  maybeIt(
    "does not route bot's own messages (self-reply guard)",
    async () => {
      const sys = buildIntegratedSystem();
      await sys.queue.start();
      await sys.ingress.receive(mention({ authorIsBot: true }));
      await sys.queue.stop();

      expect(sys.replyCapture.replies).toHaveLength(0);
    },
    10_000
  );
});
