import { describe, expect, it } from "vitest";

import { createJobQueue } from "../src/job-queue.js";
import type {
  ClaudeCliAdapter,
  ClaudeCliRequest,
  ClaudeCliResult,
  MentionRequest,
  ReplyPublisher,
  ReplyTarget,
  SessionStore
} from "../src/modules.js";

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
  typingCalls: ReplyTarget[] = [];
  successCalls: Array<{ target: ReplyTarget; text: string }> = [];
  failureCalls: Array<{ target: ReplyTarget; category: string }> = [];

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
}) {
  const adapter = options?.adapter ?? new FakeClaudeCliAdapter();
  const publisher = options?.publisher ?? new FakeReplyPublisher();
  const sessionStore = options?.sessionStore ?? new FakeSessionStore();
  const queue = createJobQueue({
    adapter,
    publisher,
    sessionStore,
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
});
