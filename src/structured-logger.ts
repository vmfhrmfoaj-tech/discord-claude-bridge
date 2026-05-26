import type { StructuredLogEvent, StructuredLogger } from "./modules.js";

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

export function createStructuredLogger(): StructuredLogger {
  return {
    info(ev: StructuredLogEvent): void {
      console.log(JSON.stringify(buildPayload("info", ev)));
    },
    warn(ev: StructuredLogEvent): void {
      console.warn(JSON.stringify(buildPayload("warn", ev)));
    },
    error(ev: StructuredLogEvent): void {
      console.error(JSON.stringify(buildPayload("error", ev)));
    }
  };
}
