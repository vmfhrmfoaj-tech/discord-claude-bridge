import { describe, expect, it } from "vitest";

import { createJobQueue } from "../src/job-queue.js";
import type {
  ClaudeCliAdapter,
  ClaudeCliRequest,
  ClaudeCliResult,
  MentionRequest,
  ReplyPublisher,
  ReplyTarget,
  SessionStore,
  StructuredLogEvent,
  StructuredLogger
} from "../src/modules.js";

// ---------------------------------------------------------------------------
// Fake logger
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeClaudeCliAdapter implements ClaudeCliAdapter {
  calls: ClaudeCliRequest[] = [];
  result: ClaudeCliResult = {
    kind: "success",
    text: "Hello from Claude",
    sessionId: "session-abc",
    exitCode: 0
  };

  execute(request: ClaudeCliRequest): Promise<ClaudeCliResult> {
    this.calls.push(request);
    return Promise.resolve(this.result);
  }
}

class FakeReplyPublisher implements ReplyPublisher {
  reactionCalls: ReplyTarget[] = [];
  typingCalls: ReplyTarget[] = [];
  successCalls: Array<{ target: ReplyTarget; text: string }> = [];
  failureCalls: Array<{ target: ReplyTarget; category: string }> = [];

  publishReaction(target: ReplyTarget): Promise<void> {
    this.reactionCalls.push(target);
    return Promise.resolve();
  }

  publishTyping(target: ReplyTarget): Promise<void> {
    this.typingCalls.push(target);
    return Promise.resolve();
  }

  publishSuccess(target: ReplyTarget, text: string): Promise<void> {
    this.successCalls.push({ target, text });
    return Promise.resolve();
  }

  publishFailure(target: ReplyTarget, category: string): Promise<void> {
    this.failureCalls.push({ target, category });
    return Promise.resolve();
  }
}

class FakeSessionStore implements SessionStore {
  store: Map<string, string> = new Map();

  getSessionId(scopeKey: string): Promise<string | undefined> {
    return Promise.resolve(this.store.get(scopeKey));
  }

  setSessionId(scopeKey: string, sessionId: string): Promise<void> {
    this.store.set(scopeKey, sessionId);
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMentionRequest(
  overrides: Partial<MentionRequest> = {}
): MentionRequest {
  return {
    messageId: "msg-001",
    authorId: "user-111",
    channelId: "chan-222",
    prompt: "hello",
    sessionScopeKey: "chan-222",
    ...overrides
  };
}

function makeQueue(options?: {
  concurrency?: number;
  maxPendingJobs?: number;
  adapter?: ClaudeCliAdapter;
  publisher?: ReplyPublisher;
  sessionStore?: SessionStore;
  logger?: StructuredLogger;
}) {
  const adapter = options?.adapter ?? new FakeClaudeCliAdapter();
  const publisher = options?.publisher ?? new FakeReplyPublisher();
  const sessionStore = options?.sessionStore ?? new FakeSessionStore();
  const queue = createJobQueue({
    adapter,
    publisher,
    sessionStore,
    logger: options?.logger,
    config: {
      concurrency: options?.concurrency ?? 1,
      maxPendingJobs: options?.maxPendingJobs ?? 10
    }
  });
  return { queue, adapter, publisher, sessionStore };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("JobQueue", () => {
  describe("enqueue acceptance", () => {
    it("returns accepted with a requestId string", async () => {
      const { queue } = makeQueue();
      await queue.start();

      const result = await queue.enqueue(makeMentionRequest());

      expect(result.kind).toBe("accepted");
      if (result.kind !== "accepted") return;
      expect(typeof result.requestId).toBe("string");
      expect(result.requestId.length).toBeGreaterThan(0);

      await queue.stop();
    });

    it("returns unique requestId for each enqueue", async () => {
      const { queue } = makeQueue();
      await queue.start();

      const r1 = await queue.enqueue(
        makeMentionRequest({ messageId: "msg-001" })
      );
      const r2 = await queue.enqueue(
        makeMentionRequest({ messageId: "msg-002" })
      );

      expect(r1.kind).toBe("accepted");
      expect(r2.kind).toBe("accepted");
      if (r1.kind !== "accepted" || r2.kind !== "accepted") return;
      expect(r1.requestId).not.toBe(r2.requestId);

      await queue.stop();
    });
  });

  describe("queue-full rejection", () => {
    it("rejects with queue-full when pending jobs exceed maxPendingJobs", async () => {
      // Use deferred promises so we can unblock adapter calls on demand
      const makeDeferred = () => {
        let resolve!: () => void;
        const promise = new Promise<ClaudeCliResult>((res) => {
          resolve = () => {
            res({ kind: "success", text: "ok", exitCode: 0 });
          };
        });
        return { promise, resolve };
      };

      const deferred1 = makeDeferred();
      const deferred2 = makeDeferred();
      let callCount = 0;

      const slowAdapter: ClaudeCliAdapter = {
        execute: () => {
          callCount++;
          return callCount === 1 ? deferred1.promise : deferred2.promise;
        }
      };

      const { queue } = makeQueue({
        concurrency: 1,
        maxPendingJobs: 1,
        adapter: slowAdapter
      });
      await queue.start();

      // First job — dispatched immediately (concurrency=1, in-flight=0)
      await queue.enqueue(makeMentionRequest({ messageId: "msg-001" }));
      // Let the event loop tick so processJob starts and callCount becomes 1
      await new Promise((r) => {
        setTimeout(r, 0);
      });

      // Second job — goes into pending slot (in-flight=1, pending=0 -> 1)
      await queue.enqueue(makeMentionRequest({ messageId: "msg-002" }));
      // Third job — pending is now full (maxPendingJobs=1)
      const result = await queue.enqueue(
        makeMentionRequest({ messageId: "msg-003" })
      );

      expect(result).toEqual({ kind: "rejected", reason: "queue-full" });

      // Unblock both jobs so queue drains
      deferred1.resolve();
      deferred2.resolve();
      await queue.stop();
    });
  });

  describe("shutdown behavior", () => {
    it("rejects new enqueue with shutdown after stop() is called", async () => {
      const { queue } = makeQueue();
      await queue.start();
      await queue.stop();

      const result = await queue.enqueue(makeMentionRequest());
      expect(result).toEqual({ kind: "rejected", reason: "shutdown" });
    });

    it("in-flight job completes after stop() is called", async () => {
      const publisher = new FakeReplyPublisher();
      let resolveAdapter!: () => void;
      const slowAdapter: ClaudeCliAdapter = {
        execute: () =>
          new Promise<ClaudeCliResult>((res) => {
            resolveAdapter = () => {
              res({ kind: "success", text: "done", exitCode: 0 });
            };
          })
      };

      const { queue } = makeQueue({ adapter: slowAdapter, publisher });
      await queue.start();

      await queue.enqueue(makeMentionRequest());

      // stop() without waiting
      const stopPromise = queue.stop();

      // resolve the in-flight adapter call
      resolveAdapter();

      // stop() should resolve once in-flight work finishes
      await stopPromise;

      expect(publisher.successCalls).toHaveLength(1);
    });
  });

  describe("worker: job success", () => {
    it("calls adapter with prompt from MentionRequest", async () => {
      const adapter = new FakeClaudeCliAdapter();
      const { queue } = makeQueue({ adapter });
      await queue.start();

      await queue.enqueue(makeMentionRequest({ prompt: "what is 2+2?" }));

      // Drain queue
      await queue.stop();

      expect(adapter.calls).toHaveLength(1);
      expect(adapter.calls[0]?.prompt).toBe("what is 2+2?");
    });

    it("calls publishSuccess with adapter text on success", async () => {
      const publisher = new FakeReplyPublisher();
      const adapter = new FakeClaudeCliAdapter();
      adapter.result = { kind: "success", text: "four", exitCode: 0 };

      const { queue } = makeQueue({ adapter, publisher });
      await queue.start();

      await queue.enqueue(
        makeMentionRequest({ messageId: "msg-x", channelId: "chan-y" })
      );
      await queue.stop();

      expect(publisher.successCalls).toHaveLength(1);
      expect(publisher.successCalls[0]?.text).toBe("four");
      expect(publisher.successCalls[0]?.target.messageId).toBe("msg-x");
      expect(publisher.successCalls[0]?.target.channelId).toBe("chan-y");
    });

    it("saves sessionId to SessionStore when adapter returns one", async () => {
      const sessionStore = new FakeSessionStore();
      const adapter = new FakeClaudeCliAdapter();
      adapter.result = {
        kind: "success",
        text: "hi",
        sessionId: "sess-xyz",
        exitCode: 0
      };

      const { queue } = makeQueue({ adapter, sessionStore });
      await queue.start();

      await queue.enqueue(makeMentionRequest({ sessionScopeKey: "chan-222" }));
      await queue.stop();

      expect(sessionStore.store.get("chan-222")).toBe("sess-xyz");
    });

    it("completes session save before publishing success", async () => {
      const events: string[] = [];
      let resolveSave!: () => void;
      const adapter = new FakeClaudeCliAdapter();
      adapter.result = {
        kind: "success",
        text: "saved before reply",
        sessionId: "sess-new",
        exitCode: 0
      };
      const sessionStore: SessionStore = {
        getSessionId: () => Promise.resolve(undefined),
        async setSessionId() {
          events.push("save:start");
          await new Promise<void>((resolve) => {
            resolveSave = resolve;
          });
          events.push("save:done");
        }
      };
      const publisher: ReplyPublisher = {
        publishReaction: () => Promise.resolve(),
        publishTyping: () => Promise.resolve(),
        publishSuccess: () => {
          events.push("publish:success");
          return Promise.resolve();
        },
        publishFailure: () => Promise.resolve()
      };

      const { queue } = makeQueue({ adapter, publisher, sessionStore });
      await queue.start();

      await queue.enqueue(makeMentionRequest());
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(events).toEqual(["save:start"]);

      resolveSave();
      await queue.stop();

      expect(events).toEqual(["save:start", "save:done", "publish:success"]);
    });

    it("loads existing sessionId from SessionStore and passes to adapter", async () => {
      const sessionStore = new FakeSessionStore();
      await sessionStore.setSessionId("chan-222", "existing-sess");

      const adapter = new FakeClaudeCliAdapter();

      const { queue } = makeQueue({ adapter, sessionStore });
      await queue.start();

      await queue.enqueue(makeMentionRequest({ sessionScopeKey: "chan-222" }));
      await queue.stop();

      expect(adapter.calls[0]?.sessionId).toBe("existing-sess");
    });

    it("waits for session lookup before invoking adapter", async () => {
      let resolveLookup!: (sessionId: string) => void;
      const adapter = new FakeClaudeCliAdapter();
      const sessionStore: SessionStore = {
        getSessionId: () =>
          new Promise<string>((resolve) => {
            resolveLookup = resolve;
          }),
        setSessionId: () => Promise.resolve()
      };

      const { queue } = makeQueue({ adapter, sessionStore });
      await queue.start();

      await queue.enqueue(makeMentionRequest());
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });

      expect(adapter.calls).toHaveLength(0);

      resolveLookup("sess-after-lookup");
      await queue.stop();

      expect(adapter.calls).toHaveLength(1);
      expect(adapter.calls[0]?.sessionId).toBe("sess-after-lookup");
    });

    it("passes undefined sessionId to adapter when no session mapping exists", async () => {
      const adapter = new FakeClaudeCliAdapter();
      const sessionStore: SessionStore = {
        getSessionId: () => Promise.resolve(undefined),
        setSessionId: () => Promise.resolve()
      };

      const { queue } = makeQueue({ adapter, sessionStore });
      await queue.start();

      await queue.enqueue(makeMentionRequest());
      await queue.stop();

      expect(adapter.calls).toHaveLength(1);
      expect(adapter.calls[0]?.sessionId).toBeUndefined();
    });

    it("treats ENOENT from SessionStore lookup as no resumable session", async () => {
      const adapter = new FakeClaudeCliAdapter();
      const publisher = new FakeReplyPublisher();
      const sessionStore: SessionStore = {
        getSessionId: () =>
          Promise.reject(
            Object.assign(new Error("missing"), { code: "ENOENT" })
          ),
        setSessionId: () => Promise.resolve()
      };

      const { queue } = makeQueue({ adapter, publisher, sessionStore });
      await queue.start();

      await queue.enqueue(makeMentionRequest());
      await queue.stop();

      expect(adapter.calls).toHaveLength(1);
      expect(adapter.calls[0]?.sessionId).toBeUndefined();
      expect(publisher.successCalls).toHaveLength(1);
    });
  });

  describe("worker: job failure", () => {
    it("calls publishFailure when adapter returns failure", async () => {
      const publisher = new FakeReplyPublisher();
      const adapter = new FakeClaudeCliAdapter();
      adapter.result = { kind: "failure", category: "timeout" };

      const { queue } = makeQueue({ adapter, publisher });
      await queue.start();

      await queue.enqueue(
        makeMentionRequest({ messageId: "msg-fail", channelId: "chan-fail" })
      );
      await queue.stop();

      expect(publisher.failureCalls).toHaveLength(1);
      expect(publisher.failureCalls[0]?.category).toBe("timeout");
      expect(publisher.failureCalls[0]?.target.messageId).toBe("msg-fail");
    });

    it("does not call publishSuccess when adapter returns failure", async () => {
      const publisher = new FakeReplyPublisher();
      const adapter = new FakeClaudeCliAdapter();
      adapter.result = { kind: "failure", category: "missing-cli" };

      const { queue } = makeQueue({ adapter, publisher });
      await queue.start();

      await queue.enqueue(makeMentionRequest());
      await queue.stop();

      expect(publisher.successCalls).toHaveLength(0);
    });

    it("does not save a session and preserves trace target when adapter returns failure", async () => {
      const publisher = new FakeReplyPublisher();
      const adapter = new FakeClaudeCliAdapter();
      adapter.result = { kind: "failure", category: "auth-failure" };
      let saveCalls = 0;
      const sessionStore: SessionStore = {
        getSessionId: () => Promise.resolve("existing-session"),
        setSessionId: () => {
          saveCalls++;
          return Promise.resolve();
        }
      };

      const { queue } = makeQueue({ adapter, publisher, sessionStore });
      await queue.start();

      const enqueueResult = await queue.enqueue(
        makeMentionRequest({
          guildId: "guild-fail",
          threadId: "thread-fail"
        })
      );
      await queue.stop();

      expect(enqueueResult.kind).toBe("accepted");
      if (enqueueResult.kind !== "accepted") return;
      expect(saveCalls).toBe(0);
      expect(publisher.failureCalls).toHaveLength(1);
      expect(publisher.failureCalls[0]?.target).toEqual({
        messageId: "msg-001",
        channelId: "chan-222",
        requestId: enqueueResult.requestId,
        guildId: "guild-fail",
        threadId: "thread-fail"
      });
    });
  });

  describe("worker: unexpected error", () => {
    it("calls publishFailure with internal-error when setSessionId throws unexpectedly", async () => {
      const adapter = new FakeClaudeCliAdapter(); // returns success
      const publisher = new FakeReplyPublisher();
      const sessionStore: SessionStore = {
        getSessionId: () => Promise.resolve(undefined),
        setSessionId: () => Promise.reject(new Error("disk full"))
      };

      const { queue } = makeQueue({ adapter, publisher, sessionStore });
      await queue.start();
      await queue.enqueue(makeMentionRequest({ messageId: "msg-err" }));
      await queue.stop();

      expect(publisher.failureCalls).toHaveLength(1);
      expect(publisher.failureCalls[0]?.category).toBe("internal-error");
      expect(publisher.failureCalls[0]?.target.messageId).toBe("msg-err");
      expect(publisher.successCalls).toHaveLength(0);
    });
  });

  describe("concurrency", () => {
    it("processes only one job at a time with concurrency=1", async () => {
      const executionOrder: string[] = [];
      let resolveFirst!: () => void;

      const adapter: ClaudeCliAdapter = {
        execute: async (req) => {
          if (req.prompt === "job-1") {
            await new Promise<void>((res) => {
              resolveFirst = res;
            });
          }
          executionOrder.push(req.prompt);
          return { kind: "success", text: "ok", exitCode: 0 };
        }
      };

      const { queue } = makeQueue({ concurrency: 1, adapter });
      await queue.start();

      const p1 = queue.enqueue(
        makeMentionRequest({ messageId: "m1", prompt: "job-1" })
      );
      const p2 = queue.enqueue(
        makeMentionRequest({ messageId: "m2", prompt: "job-2" })
      );

      await p1;
      await p2;

      // At this point job-1 is in-flight but not done; job-2 is pending
      // job-2 should not start until job-1 finishes
      expect(executionOrder).toHaveLength(0);

      resolveFirst();
      await queue.stop();

      expect(executionOrder).toEqual(["job-1", "job-2"]);
    });
  });

  describe("requestId propagation", () => {
    it("passes requestId, guildId, and threadId to the success publisher target", async () => {
      const publisher = new FakeReplyPublisher();
      const { queue } = makeQueue({ publisher });
      await queue.start();

      const result = await queue.enqueue(
        makeMentionRequest({
          guildId: "guild-123",
          threadId: "thread-456",
          prompt: "trace me"
        })
      );

      expect(result.kind).toBe("accepted");
      if (result.kind !== "accepted") return;
      expect(result.requestId).toMatch(/^[0-9a-f-]{8,}$/i);

      await queue.stop();

      expect(publisher.successCalls).toHaveLength(1);
      expect(publisher.successCalls[0]?.target).toEqual({
        messageId: "msg-001",
        channelId: "chan-222",
        requestId: result.requestId,
        guildId: "guild-123",
        threadId: "thread-456"
      });
    });
  });

  describe("logging", () => {
    it("logs job.enqueued with requestId and channelId on accept", async () => {
      const logger = new FakeLogger();
      const { queue } = makeQueue({ logger });
      await queue.start();

      await queue.enqueue(
        makeMentionRequest({ channelId: "chan-log", guildId: "guild-log" })
      );
      await queue.stop();

      const enqueued = logger.infos.find((e) => e.event === "job.enqueued");
      expect(enqueued).toBeDefined();
      expect(typeof enqueued?.requestId).toBe("string");
      expect(enqueued?.channelId).toBe("chan-log");
      expect(enqueued?.guildId).toBe("guild-log");
    });

    it("logs job.completed with durationMs and jobStatus=success on success", async () => {
      const logger = new FakeLogger();
      const { queue } = makeQueue({ logger });
      await queue.start();

      await queue.enqueue(makeMentionRequest());
      await queue.stop();

      const completed = logger.infos.find((e) => e.event === "job.completed");
      expect(completed).toBeDefined();
      expect(completed?.jobStatus).toBe("success");
      expect(typeof completed?.durationMs).toBe("number");
    });

    it("logs job.failed with errorCategory on adapter failure", async () => {
      const logger = new FakeLogger();
      const adapter = new FakeClaudeCliAdapter();
      adapter.result = { kind: "failure", category: "timeout" };

      const { queue } = makeQueue({ logger, adapter });
      await queue.start();

      await queue.enqueue(makeMentionRequest());
      await queue.stop();

      const failed = logger.errors.find((e) => e.event === "job.failed");
      expect(failed).toBeDefined();
      expect(failed?.errorCategory).toBe("timeout");
      expect(failed?.jobStatus).toBe("failure");
    });

    it("logs queue.full with channelId when queue rejects", async () => {
      const logger = new FakeLogger();
      const makeDeferred = () => {
        let resolve!: () => void;
        const promise = new Promise<ClaudeCliResult>((res) => {
          resolve = () => {
            res({ kind: "success", text: "ok", exitCode: 0 });
          };
        });
        return { promise, resolve };
      };
      const d1 = makeDeferred();
      const d2 = makeDeferred();
      let callCount = 0;
      const slowAdapter: ClaudeCliAdapter = {
        execute: () => (++callCount === 1 ? d1.promise : d2.promise)
      };

      const { queue } = makeQueue({
        logger,
        adapter: slowAdapter,
        concurrency: 1,
        maxPendingJobs: 1
      });
      await queue.start();

      await queue.enqueue(makeMentionRequest({ messageId: "m1" }));
      await new Promise((r) => setTimeout(r, 0));
      await queue.enqueue(makeMentionRequest({ messageId: "m2" }));
      await queue.enqueue(
        makeMentionRequest({ messageId: "m3", channelId: "chan-full" })
      );

      const fullLog = logger.warns.find((e) => e.event === "queue.full");
      expect(fullLog).toBeDefined();
      expect(fullLog?.channelId).toBe("chan-full");

      d1.resolve();
      d2.resolve();
      await queue.stop();
    });

    it("does not include prompt text in any log event", async () => {
      const logger = new FakeLogger();
      const { queue } = makeQueue({ logger });
      await queue.start();

      await queue.enqueue(
        makeMentionRequest({ prompt: "SECRET_PROMPT_CONTENT" })
      );
      await queue.stop();

      const allLogs = JSON.stringify([
        ...logger.infos,
        ...logger.warns,
        ...logger.errors
      ]);
      expect(allLogs).not.toContain("SECRET_PROMPT_CONTENT");
    });
  });
});
