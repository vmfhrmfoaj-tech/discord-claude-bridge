export const moduleSeams = [
  "Discord Ingress",
  "Mention Parser",
  "Job Queue",
  "Claude CLI Adapter",
  "Session Store",
  "Reply Publisher",
  "Config Loader",
  "Structured Logger"
] as const;

export type ModuleSeamName = (typeof moduleSeams)[number];

export interface DiscordIngress {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface DiscordMessageEvent {
  id: string;
  content: string;
  authorId: string;
  authorIsBot: boolean;
  channelId: string;
  guildId?: string;
  threadId?: string;
  mentionsBot: boolean;
}

export interface MentionRequest {
  messageId: string;
  authorId: string;
  channelId: string;
  prompt: string;
  sessionScopeKey: string;
  guildId?: string;
  threadId?: string;
}

export type MentionParseResult =
  | { kind: "accepted"; request: MentionRequest }
  | {
      kind: "ignored";
      reason:
        | "not-mentioned"
        | "bot-message"
        | "self-message"
        | "empty-prompt"
        | "too-large"
        | "disallowed-guild"
        | "disallowed-channel";
    };

export interface MentionParser {
  parse(message: DiscordMessageEvent): MentionParseResult;
}

export type EnqueueResult =
  | { kind: "accepted"; requestId: string }
  | { kind: "rejected"; reason: "queue-full" | "shutdown" | "invalid-job" };

export interface JobQueue {
  enqueue(request: MentionRequest): Promise<EnqueueResult>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ClaudeCliRequest {
  prompt: string;
  timeoutMs: number;
  sessionId?: string;
  model?: string;
  systemPrompt?: string;
  maxBudgetUsd?: number;
}

export type ClaudeCliResult =
  | { kind: "success"; text: string; sessionId?: string; exitCode: number }
  | {
      kind: "failure";
      category:
        | "timeout"
        | "missing-cli"
        | "auth-failure"
        | "non-zero-exit"
        | "invalid-json";
      exitCode?: number;
    };

export interface ClaudeCliAdapter {
  execute(request: ClaudeCliRequest): Promise<ClaudeCliResult>;
}

export interface SessionStore {
  getSessionId(scopeKey: string): Promise<string | undefined>;
  setSessionId(scopeKey: string, sessionId: string): Promise<void>;
}

export interface ReplyTarget {
  messageId: string;
  channelId: string;
  requestId?: string;
  guildId?: string;
  threadId?: string;
}

export interface ReplyPublisher {
  publishReaction(target: ReplyTarget): Promise<void>;
  publishTyping(target: ReplyTarget): Promise<void>;
  publishSuccess(target: ReplyTarget, text: string): Promise<void>;
  publishFailure(target: ReplyTarget, category: string): Promise<void>;
}

export interface RuntimeConfig {
  discord: {
    token: string;
    clientId: string;
    allowedGuildIds: string[];
    allowedChannelIds: string[];
  };
  queue: {
    concurrency: number;
    maxPendingJobs: number;
  };
  claude: {
    binaryPath: string;
    outputFormat: "json";
    tools: "";
    timeoutMs: number;
    model?: string;
    systemPrompt?: string;
    maxBudgetUsd?: number;
  };
  prompt: {
    maxCharacters: number;
  };
  session: {
    scope: "thread-or-channel";
    storePath: string;
  };
  reply: {
    maxChunkCharacters: number;
    typingIndicator: boolean;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
    format: "json";
  };
  responseMode: "claude" | "echo";
}

export interface ConfigLoader {
  load(): Promise<RuntimeConfig>;
}

export interface StructuredLogEvent {
  event: string;
  requestId?: string;
  guildId?: string;
  channelId?: string;
  threadId?: string;
  jobStatus?: string;
  durationMs?: number;
  exitCode?: number;
  errorCategory?: string;
}

export interface StructuredLogger {
  info(event: StructuredLogEvent): void;
  warn(event: StructuredLogEvent): void;
  error(event: StructuredLogEvent): void;
}
