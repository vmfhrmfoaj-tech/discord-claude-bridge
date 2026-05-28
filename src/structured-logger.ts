import fs from "node:fs";
import path from "node:path";

import type {
  RuntimeConfig,
  StructuredLogEvent,
  StructuredLogger
} from "./modules.js";

export function redactToken(token: string): string {
  if (token.length <= 4) return "*".repeat(Math.max(4, token.length));
  return "*".repeat(token.length - 4) + token.slice(-4);
}

export function redactStderr(stderr: string): string {
  if (stderr.length <= 200) return stderr;
  return stderr.slice(0, 199) + "…";
}

function buildPayload(
  level: string,
  ev: StructuredLogEvent
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    event: ev.event
  };
  if (ev.requestId !== undefined) payload["requestId"] = ev.requestId;
  if (ev.guildId !== undefined) payload["guildId"] = ev.guildId;
  if (ev.channelId !== undefined) payload["channelId"] = ev.channelId;
  if (ev.threadId !== undefined) payload["threadId"] = ev.threadId;
  if (ev.jobStatus !== undefined) payload["jobStatus"] = ev.jobStatus;
  if (ev.durationMs !== undefined) payload["durationMs"] = ev.durationMs;
  if (ev.exitCode !== undefined) payload["exitCode"] = ev.exitCode;
  if (ev.errorCategory !== undefined)
    payload["errorCategory"] = ev.errorCategory;
  return payload;
}

function writeToStderr(payload: Record<string, unknown>): void {
  process.stderr.write(JSON.stringify(payload) + "\n");
}

export function createStructuredLogger(
  config?: RuntimeConfig["logging"]
): StructuredLogger {
  let fileStream: fs.WriteStream | null = null;

  if (config?.filePath) {
    const filePath = config.filePath;
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const stream = fs.createWriteStream(filePath, {
        flags: "a",
        encoding: "utf8"
      });
      stream.on("error", (err) => {
        const payload = buildPayload("warn", {
          event: "log_write_failed",
          errorCategory: (err as NodeJS.ErrnoException).code ?? err.message
        });
        writeToStderr(payload);
        fileStream = null;
      });
      fileStream = stream;
      const openedPayload = buildPayload("info", { event: "log_file_opened" });
      writeToStderr(openedPayload);
      stream.write(JSON.stringify(openedPayload) + "\n");
    } catch (err) {
      const payload = buildPayload("warn", {
        event: "log_write_failed",
        errorCategory: err instanceof Error ? err.message : String(err)
      });
      writeToStderr(payload);
    }
  } else {
    writeToStderr(
      buildPayload("warn", { event: "log_file_path_not_configured" })
    );
  }

  function writeLog(level: string, ev: StructuredLogEvent): void {
    const payload = buildPayload(level, ev);
    const line = JSON.stringify(payload) + "\n";
    process.stderr.write(line);
    if (fileStream !== null) {
      fileStream.write(line);
    }
  }

  return {
    info(ev: StructuredLogEvent): void {
      writeLog("info", ev);
    },
    warn(ev: StructuredLogEvent): void {
      writeLog("warn", ev);
    },
    error(ev: StructuredLogEvent): void {
      writeLog("error", ev);
    },
    close(): Promise<void> {
      if (fileStream === null) return Promise.resolve();
      const stream = fileStream;
      fileStream = null;
      return new Promise<void>((resolve) => {
        stream.end(() => {
          resolve();
        });
      });
    }
  };
}
