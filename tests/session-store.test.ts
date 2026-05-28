import { describe, it, expect, beforeEach } from "vitest";
import { JsonSessionStore } from "../src/session-store.js";
import type { FileSystem } from "../src/session-store.js";
import type { StructuredLogEvent, StructuredLogger } from "../src/modules.js";

class FakeLogger implements StructuredLogger {
  warns: StructuredLogEvent[] = [];
  infos: StructuredLogEvent[] = [];
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
  close(): Promise<void> {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Fake filesystem seam — no real I/O in tests
// ---------------------------------------------------------------------------
class FakeFileSystem implements FileSystem {
  private files: Map<string, string> = new Map();
  private failPaths: Set<string> = new Set();
  mkdirCalls: Array<{ path: string; recursive: boolean }> = [];

  readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      return Promise.reject(
        Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" })
      );
    }
    return Promise.resolve(content);
  }

  writeFile(path: string, content: string): Promise<void> {
    if (this.failPaths.has(path)) {
      return Promise.reject(
        new Error(`EACCES: permission denied, open '${path}'`)
      );
    }
    this.files.set(path, content);
    return Promise.resolve();
  }

  mkdir(dirPath: string, opts: { recursive: boolean }): Promise<void> {
    this.mkdirCalls.push({ path: dirPath, recursive: opts.recursive });
    return Promise.resolve();
  }

  setFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  getFile(path: string): string | undefined {
    return this.files.get(path);
  }

  makeWriteFail(path: string): void {
    this.failPaths.add(path);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
const STORE_PATH = ".data/sessions.json";

describe("JsonSessionStore", () => {
  let fakeFs: FakeFileSystem;
  let store: JsonSessionStore;

  beforeEach(() => {
    fakeFs = new FakeFileSystem();
    store = new JsonSessionStore(STORE_PATH, fakeFs);
  });

  // 1. Missing file → undefined
  it("returns undefined when store file does not exist", async () => {
    const result = await store.getSessionId("any-key");
    expect(result).toBeUndefined();
  });

  // 2. Empty store → undefined
  it("returns undefined when store file is empty object", async () => {
    fakeFs.setFile(STORE_PATH, "{}");
    const result = await store.getSessionId("any-key");
    expect(result).toBeUndefined();
  });

  // 3. Read existing mapping
  it("returns existing sessionId for a known scopeKey", async () => {
    fakeFs.setFile(STORE_PATH, JSON.stringify({ key1: "sess-1" }));
    const result = await store.getSessionId("key1");
    expect(result).toBe("sess-1");
  });

  // 4. Write new mapping
  it("writes a new sessionId to the store file", async () => {
    await store.setSessionId("key2", "sess-2");
    const raw = fakeFs.getFile(STORE_PATH);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw as string) as Record<string, string>;
    expect(parsed["key2"]).toBe("sess-2");
  });

  // 5. Update mapping overwrites existing entry
  it("overwrites an existing sessionId for the same scopeKey", async () => {
    fakeFs.setFile(STORE_PATH, JSON.stringify({ key1: "sess-old" }));
    await store.setSessionId("key1", "sess-new");
    const raw = fakeFs.getFile(STORE_PATH);
    const parsed = JSON.parse(raw as string) as Record<string, string>;
    expect(parsed["key1"]).toBe("sess-new");
  });

  // 6. Invalid JSON → documented policy: recover as empty store, return undefined
  it("returns undefined (not throw) when store file contains invalid JSON [documented policy: recover-as-empty]", async () => {
    fakeFs.setFile(STORE_PATH, "not valid json {{{");
    // Must NOT throw — bot stays operational, no silent misrouting
    const result = await store.getSessionId("any-key");
    expect(result).toBeUndefined();
  });

  // 7. Write failure → propagates mapped error
  it("propagates a mapped error when writeFile fails", async () => {
    fakeFs.makeWriteFail(STORE_PATH);
    await expect(store.setSessionId("key", "sess")).rejects.toThrow();
  });

  // 8. Thread key policy — scopeKey derived from threadId
  it("stores and retrieves session using threadId as scopeKey", async () => {
    const threadId = "thread-999";
    await store.setSessionId(threadId, "sess-thread");
    const result = await store.getSessionId(threadId);
    expect(result).toBe("sess-thread");
  });

  // 9. Channel key policy — scopeKey derived from channelId when no threadId
  it("stores and retrieves session using channelId as scopeKey when no threadId", async () => {
    const channelId = "channel-123";
    await store.setSessionId(channelId, "sess-channel");
    const result = await store.getSessionId(channelId);
    expect(result).toBe("sess-channel");
  });

  // Extra: setSessionId ensures parent directory exists
  it("ensures parent directory exists before writing on first write", async () => {
    await store.setSessionId("key", "sess");
    expect(fakeFs.mkdirCalls.map((c) => c.path)).toContain(".data");
  });

  // Extra: setSessionId on missing file creates new store from scratch
  it("creates a new store file when none exists on first write", async () => {
    await store.setSessionId("new-key", "new-sess");
    const raw = fakeFs.getFile(STORE_PATH);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw as string) as Record<string, string>;
    expect(parsed["new-key"]).toBe("new-sess");
  });

  // Extra: invalid JSON on write path recovers and writes merged data
  it("recovers from invalid JSON on setSessionId and writes cleanly", async () => {
    fakeFs.setFile(STORE_PATH, "not valid json");
    // Should not throw — recovers as empty store then writes
    await store.setSessionId("key", "sess");
    const raw = fakeFs.getFile(STORE_PATH);
    const parsed = JSON.parse(raw as string) as Record<string, string>;
    expect(parsed["key"]).toBe("sess");
  });

  describe("logging", () => {
    it("logs session.corrupt warn when store file has invalid JSON", async () => {
      const logger = new FakeLogger();
      const corruptStore = new JsonSessionStore(STORE_PATH, fakeFs, logger);
      fakeFs.setFile(STORE_PATH, "not valid json {{{");

      await corruptStore.getSessionId("any-key");

      const ev = logger.warns.find((e) => e.event === "session.corrupt");
      expect(ev).toBeDefined();
    });

    it("does not log session.corrupt when file is missing (ENOENT)", async () => {
      const logger = new FakeLogger();
      const freshStore = new JsonSessionStore(STORE_PATH, fakeFs, logger);

      await freshStore.getSessionId("any-key");

      expect(logger.warns).toHaveLength(0);
    });
  });
});
