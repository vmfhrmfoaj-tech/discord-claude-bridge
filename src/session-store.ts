import { readFile, writeFile } from "node:fs/promises";
import type { SessionStore } from "./modules.js";

// ---------------------------------------------------------------------------
// Filesystem seam — injectable for tests, real fs/promises in production
// ---------------------------------------------------------------------------
export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

export const realFileSystem: FileSystem = {
  readFile: (path) => readFile(path, "utf8"),
  writeFile: (path, content) => writeFile(path, content, "utf8")
};

// ---------------------------------------------------------------------------
// Store type
// ---------------------------------------------------------------------------
type SessionMap = Record<string, string>;

// ---------------------------------------------------------------------------
// JsonSessionStore
//
// Documented invalid-JSON policy: treat corrupt file as empty store (recover).
// This prevents silent session misrouting while keeping the bot operational.
// A warning is logged so operators know the store was reset.
// ---------------------------------------------------------------------------
export class JsonSessionStore implements SessionStore {
  constructor(
    private readonly storePath: string,
    private readonly fs: FileSystem = realFileSystem
  ) {}

  async getSessionId(scopeKey: string): Promise<string | undefined> {
    const map = await this.load();
    return map[scopeKey];
  }

  async setSessionId(scopeKey: string, sessionId: string): Promise<void> {
    const map = await this.load();
    map[scopeKey] = sessionId;
    await this.fs.writeFile(this.storePath, JSON.stringify(map, null, 2));
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async load(): Promise<SessionMap> {
    let raw: string;
    try {
      raw = await this.fs.readFile(this.storePath);
    } catch (err) {
      if (isEnoent(err)) {
        // Missing file is normal on first run — start with empty store
        return {};
      }
      throw err;
    }

    try {
      return JSON.parse(raw) as SessionMap;
    } catch {
      // Documented policy: invalid JSON → recover as empty store.
      // Log a warning so operators are aware the store was corrupt.
      console.warn(
        `[session-store] WARNING: ${this.storePath} contains invalid JSON. ` +
          "Recovering as empty store to prevent session misrouting. " +
          "Previous session continuity is lost."
      );
      return {};
    }
  }
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as Record<string, unknown>)["code"] === "ENOENT"
  );
}
