import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SessionStore, StructuredLogger } from "./modules.js";

// ---------------------------------------------------------------------------
// Filesystem seam — injectable for tests, real fs/promises in production
// ---------------------------------------------------------------------------
export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  mkdir(dirPath: string, opts: { recursive: boolean }): Promise<void>;
}

export const realFileSystem: FileSystem = {
  readFile: (path) => readFile(path, "utf8"),
  writeFile: (path, content) => writeFile(path, content, "utf8"),
  mkdir: (dirPath, opts) => mkdir(dirPath, opts).then(() => undefined)
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
    private readonly fs: FileSystem = realFileSystem,
    private readonly logger?: StructuredLogger
  ) {}

  async getSessionId(scopeKey: string): Promise<string | undefined> {
    const map = await this.load();
    return map[scopeKey];
  }

  async setSessionId(scopeKey: string, sessionId: string): Promise<void> {
    const map = await this.load();
    map[scopeKey] = sessionId;
    await this.fs.mkdir(dirname(this.storePath), { recursive: true });
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
      this.logger?.warn({ event: "session.corrupt" });
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
