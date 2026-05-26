import { describe, expect, it } from "vitest";

import { createDiscordIngress } from "../src/discord-ingress.js";
import type {
  DiscordMessageEvent,
  EnqueueResult,
  JobQueue,
  MentionParseResult,
  MentionParser,
  ReplyPublisher,
  ReplyTarget
} from "../src/modules.js";

class FakeDiscordClient {
  loginCalls: string[] = [];
  destroyed = false;
  listener?: (message: FakeDiscordMessage) => void;

  on(_event: "messageCreate", listener: (message: FakeDiscordMessage) => void) {
    this.listener = listener;
    return this;
  }

  login(token: string): Promise<string> {
    this.loginCalls.push(token);
    return Promise.resolve("logged-in");
  }

  destroy(): void {
    this.destroyed = true;
  }

  emitMessage(message: FakeDiscordMessage): void {
    this.listener?.(message);
  }
}

interface FakeDiscordMessage {
  id: string;
  content: string;
  author: { id: string; bot: boolean };
  channelId: string;
  guildId: string | null;
  mentions: { users: { has(id: string): boolean } };
}

class RecordingParser implements MentionParser {
  messages: DiscordMessageEvent[] = [];
  result: MentionParseResult = {
    kind: "accepted",
    request: {
      messageId: "msg-1",
      authorId: "user-1",
      channelId: "chan-1",
      guildId: "guild-1",
      prompt: "hello",
      sessionScopeKey: "chan-1"
    }
  };

  parse(message: DiscordMessageEvent): MentionParseResult {
    this.messages.push(message);
    return this.result;
  }
}

class RecordingQueue implements Pick<JobQueue, "enqueue"> {
  requests: Array<
    Extract<MentionParseResult, { kind: "accepted" }>["request"]
  > = [];
  result: EnqueueResult = { kind: "accepted", requestId: "req-1" };

  enqueue(
    request: Extract<MentionParseResult, { kind: "accepted" }>["request"]
  ): Promise<EnqueueResult> {
    this.requests.push(request);
    return Promise.resolve(this.result);
  }
}

class RecordingPublisher implements Pick<
  ReplyPublisher,
  "publishTyping" | "publishFailure"
> {
  typingTargets: ReplyTarget[] = [];
  failureTargets: Array<{ target: ReplyTarget; category: string }> = [];

  publishTyping(target: ReplyTarget): Promise<void> {
    this.typingTargets.push(target);
    return Promise.resolve();
  }

  publishFailure(target: ReplyTarget, category: string): Promise<void> {
    this.failureTargets.push({ target, category });
    return Promise.resolve();
  }
}

class RecordingReactionPublisher extends RecordingPublisher {
  reactionTargets: ReplyTarget[] = [];
  operations: string[] = [];

  publishReaction(target: ReplyTarget): Promise<void> {
    this.reactionTargets.push(target);
    this.operations.push("reaction");
    return Promise.resolve();
  }

  override publishTyping(target: ReplyTarget): Promise<void> {
    this.operations.push("typing");
    return super.publishTyping(target);
  }
}

function discordMessage(
  overrides: Partial<FakeDiscordMessage> = {}
): FakeDiscordMessage {
  return {
    id: "msg-1",
    content: "<@bot-1> hello",
    author: { id: "user-1", bot: false },
    channelId: "chan-1",
    guildId: "guild-1",
    mentions: { users: { has: (id) => id === "bot-1" } },
    ...overrides
  };
}

async function flushAsyncHandlers(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe("DiscordIngress", () => {
  it("logs in with the configured token and does not log the token", async () => {
    const client = new FakeDiscordClient();
    const parser = new RecordingParser();
    const loggerEvents: unknown[] = [];

    const ingress = createDiscordIngress({
      client,
      token: "super-secret-token",
      clientId: "bot-1",
      parser,
      queue: new RecordingQueue(),
      publisher: new RecordingPublisher(),
      logger: {
        info: (event) => loggerEvents.push(event),
        error: (event) => loggerEvents.push(event)
      }
    });

    await ingress.start();

    expect(client.loginCalls).toEqual(["super-secret-token"]);
    expect(JSON.stringify(loggerEvents)).not.toContain("super-secret-token");
  });

  it("passes accepted mention messages through parser, queue, and typing feedback", async () => {
    const client = new FakeDiscordClient();
    const parser = new RecordingParser();
    const queue = new RecordingQueue();
    const publisher = new RecordingPublisher();

    const ingress = createDiscordIngress({
      client,
      token: "token",
      clientId: "bot-1",
      parser,
      queue,
      publisher
    });

    await ingress.start();
    client.emitMessage(discordMessage());
    await flushAsyncHandlers();

    expect(parser.messages).toEqual([
      {
        id: "msg-1",
        content: "<@bot-1> hello",
        authorId: "user-1",
        authorIsBot: false,
        channelId: "chan-1",
        guildId: "guild-1",
        mentionsBot: true
      }
    ]);
    expect(queue.requests).toHaveLength(1);
    expect(publisher.typingTargets).toEqual([
      {
        messageId: "msg-1",
        channelId: "chan-1",
        requestId: "req-1",
        guildId: "guild-1",
        threadId: undefined
      }
    ]);
  });

  it("publishes optional reaction feedback before typing", async () => {
    const client = new FakeDiscordClient();
    const parser = new RecordingParser();
    const queue = new RecordingQueue();
    const publisher = new RecordingReactionPublisher();

    const ingress = createDiscordIngress({
      client,
      token: "token",
      clientId: "bot-1",
      parser,
      queue,
      publisher
    });

    await ingress.start();
    client.emitMessage(discordMessage());
    await flushAsyncHandlers();

    const target = {
      messageId: "msg-1",
      channelId: "chan-1",
      requestId: "req-1",
      guildId: "guild-1",
      threadId: undefined
    };
    expect(publisher.reactionTargets).toEqual([target]);
    expect(publisher.typingTargets).toEqual([target]);
    expect(publisher.operations).toEqual(["reaction", "typing"]);
  });

  it("returns control to Discord without waiting for enqueue completion", async () => {
    const client = new FakeDiscordClient();
    const parser = new RecordingParser();
    let enqueueCalled = false;
    const queue: Pick<JobQueue, "enqueue"> = {
      enqueue() {
        enqueueCalled = true;
        return new Promise<EnqueueResult>(() => {});
      }
    };

    const ingress = createDiscordIngress({
      client,
      token: "token",
      clientId: "bot-1",
      parser,
      queue,
      publisher: new RecordingPublisher()
    });

    await ingress.start();

    expect(() => {
      client.emitMessage(discordMessage());
    }).not.toThrow();
    expect(enqueueCalled).toBe(true);
  });

  it("ignores slash commands and DM messages before parsing", async () => {
    const client = new FakeDiscordClient();
    const parser = new RecordingParser();
    const queue = new RecordingQueue();

    const ingress = createDiscordIngress({
      client,
      token: "token",
      clientId: "bot-1",
      parser,
      queue,
      publisher: new RecordingPublisher()
    });

    await ingress.start();
    client.emitMessage(discordMessage({ content: "/bridge hello" }));
    client.emitMessage(discordMessage({ guildId: null }));
    await flushAsyncHandlers();

    expect(parser.messages).toHaveLength(0);
    expect(queue.requests).toHaveLength(0);
  });
});
