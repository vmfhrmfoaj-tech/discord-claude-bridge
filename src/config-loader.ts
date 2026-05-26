import { readFile as nodeReadFile } from "node:fs/promises";
import { loadEnvFile as nodeLoadEnvFile } from "node:process";

import { load as parseYaml } from "js-yaml";

import type { ConfigLoader, RuntimeConfig } from "./modules.js";

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export interface ConfigLoaderDeps {
  env?: Record<string, string | undefined>;
  envFilePath?: string;
  loadEnvFile?: (path: string) => void;
  readFile?: (path: string) => Promise<string>;
}

const DEFAULT_ENV_FILE_PATH = ".env";
const DEFAULT_CONFIG_PATH = "config.yaml";
const DISCORD_MESSAGE_LIMIT = 2000;

const DEFAULTS = {
  queue: { concurrency: 1, maxPendingJobs: 50 },
  claude: {
    binaryPath: "claude",
    outputFormat: "json" as const,
    tools: "" as const,
    timeoutMs: 120_000
  },
  prompt: { maxCharacters: 12_000 },
  session: {
    scope: "thread-or-channel" as const,
    storePath: ".data/sessions.json"
  },
  reply: { maxChunkCharacters: 1800, typingIndicator: true },
  logging: { level: "info" as const, format: "json" as const }
};

export function createConfigLoader(deps: ConfigLoaderDeps = {}): ConfigLoader {
  const env = deps.env ?? process.env;
  const envFilePath = deps.envFilePath ?? DEFAULT_ENV_FILE_PATH;
  const loadEnvFile = deps.loadEnvFile ?? nodeLoadEnvFile;
  const readFile = deps.readFile ?? ((p: string) => nodeReadFile(p, "utf8"));

  return {
    async load(): Promise<RuntimeConfig> {
      if (deps.loadEnvFile || deps.env == null) {
        try {
          loadEnvFile(envFilePath);
        } catch (error: unknown) {
          if (!isMissingFileError(error)) {
            throw new ConfigValidationError(
              `Unable to load env file at ${envFilePath}: ${errorMessage(error)}`
            );
          }
        }
      }

      const token = env["DISCORD_TOKEN"];
      if (!token) {
        throw new ConfigValidationError("Missing required env: DISCORD_TOKEN");
      }

      const clientId = env["DISCORD_CLIENT_ID"];
      if (!clientId) {
        throw new ConfigValidationError(
          "Missing required env: DISCORD_CLIENT_ID"
        );
      }

      const configuredConfigPath = env["CONFIG_PATH"];
      const hasExplicitConfigPath =
        configuredConfigPath != null && configuredConfigPath !== "";
      const configPath = hasExplicitConfigPath
        ? configuredConfigPath
        : DEFAULT_CONFIG_PATH;
      let raw: unknown = {};
      let content: string | undefined;
      try {
        content = await readFile(configPath);
      } catch (error: unknown) {
        if (!isMissingFileError(error) || hasExplicitConfigPath) {
          throw new ConfigValidationError(
            `Unable to load config YAML at ${configPath}: ${errorMessage(error)}`
          );
        }
      }

      if (content != null) {
        try {
          raw = parseYaml(content) ?? {};
        } catch (error: unknown) {
          throw new ConfigValidationError(
            `Invalid config YAML at ${configPath}: ${errorMessage(error)}`
          );
        }
      }

      if (!isRecord(raw)) {
        throw new ConfigValidationError("config YAML root must be an object");
      }

      const cfg = raw;
      const discord = sectionRecord(cfg, "discord");
      const queue = sectionRecord(cfg, "queue");
      const claude = sectionRecord(cfg, "claude");
      const prompt = sectionRecord(cfg, "prompt");
      const session = sectionRecord(cfg, "session");
      const reply = sectionRecord(cfg, "reply");
      const logging = sectionRecord(cfg, "logging");

      const allowedGuildIds = discord["allowedGuildIds"] ?? [];
      const allowedChannelIds = discord["allowedChannelIds"] ?? [];

      if (!isStringArray(allowedGuildIds)) {
        throw new ConfigValidationError(
          "discord.allowedGuildIds must be an array of strings"
        );
      }
      if (!isStringArray(allowedChannelIds)) {
        throw new ConfigValidationError(
          "discord.allowedChannelIds must be an array of strings"
        );
      }

      const concurrency = queue["concurrency"] ?? DEFAULTS.queue.concurrency;
      if (!isPositiveInteger(concurrency)) {
        throw new ConfigValidationError(
          "queue.concurrency must be a positive integer"
        );
      }

      const maxPendingJobs =
        queue["maxPendingJobs"] ?? DEFAULTS.queue.maxPendingJobs;
      if (!isPositiveInteger(maxPendingJobs)) {
        throw new ConfigValidationError(
          "queue.maxPendingJobs must be a positive integer"
        );
      }

      const timeoutMs = claude["timeoutMs"] ?? DEFAULTS.claude.timeoutMs;
      if (!isPositiveInteger(timeoutMs)) {
        throw new ConfigValidationError(
          "claude.timeoutMs must be a positive integer"
        );
      }

      const binaryPath = claude["binaryPath"] ?? DEFAULTS.claude.binaryPath;
      if (!isNonEmptyString(binaryPath)) {
        throw new ConfigValidationError(
          "claude.binaryPath must be a non-empty string"
        );
      }

      const outputFormat =
        claude["outputFormat"] ?? DEFAULTS.claude.outputFormat;
      if (outputFormat !== DEFAULTS.claude.outputFormat) {
        throw new ConfigValidationError("claude.outputFormat must be json");
      }

      const tools = claude["tools"] ?? DEFAULTS.claude.tools;
      if (tools !== DEFAULTS.claude.tools) {
        throw new ConfigValidationError("claude.tools must be an empty string");
      }

      const model = optionalString(claude["model"], "claude.model");
      const systemPrompt = optionalString(
        claude["systemPrompt"],
        "claude.systemPrompt"
      );
      const maxBudgetUsd = optionalPositiveNumber(
        claude["maxBudgetUsd"],
        "claude.maxBudgetUsd"
      );

      const maxCharacters =
        prompt["maxCharacters"] ?? DEFAULTS.prompt.maxCharacters;
      if (!isPositiveInteger(maxCharacters)) {
        throw new ConfigValidationError(
          "prompt.maxCharacters must be a positive integer"
        );
      }

      const sessionScope = session["scope"] ?? DEFAULTS.session.scope;
      if (sessionScope !== DEFAULTS.session.scope) {
        throw new ConfigValidationError(
          "session.scope must be thread-or-channel"
        );
      }

      const storePath = session["storePath"] ?? DEFAULTS.session.storePath;
      if (!isNonEmptyString(storePath)) {
        throw new ConfigValidationError(
          "session.storePath must be a non-empty string"
        );
      }

      const maxChunkCharacters =
        reply["maxChunkCharacters"] ?? DEFAULTS.reply.maxChunkCharacters;
      if (
        !isPositiveInteger(maxChunkCharacters) ||
        (maxChunkCharacters as number) >= DISCORD_MESSAGE_LIMIT
      ) {
        throw new ConfigValidationError(
          "reply.maxChunkCharacters must be a positive integer below 2000"
        );
      }

      const typingIndicator =
        reply["typingIndicator"] ?? DEFAULTS.reply.typingIndicator;
      if (typeof typingIndicator !== "boolean") {
        throw new ConfigValidationError(
          "reply.typingIndicator must be boolean"
        );
      }

      const logLevel = logging["level"] ?? DEFAULTS.logging.level;
      if (!isLogLevel(logLevel)) {
        throw new ConfigValidationError(
          "logging.level must be one of: debug, info, warn, error"
        );
      }
      const logFormat = logging["format"] ?? DEFAULTS.logging.format;
      if (logFormat !== DEFAULTS.logging.format) {
        throw new ConfigValidationError("logging.format must be json");
      }

      return {
        discord: {
          token,
          clientId,
          allowedGuildIds: allowedGuildIds as string[],
          allowedChannelIds: allowedChannelIds as string[]
        },
        queue: {
          concurrency: concurrency as number,
          maxPendingJobs: maxPendingJobs as number
        },
        claude: {
          binaryPath,
          outputFormat,
          tools,
          timeoutMs: timeoutMs as number,
          model,
          systemPrompt,
          maxBudgetUsd
        },
        prompt: { maxCharacters: maxCharacters as number },
        session: {
          scope: sessionScope,
          storePath
        },
        reply: {
          maxChunkCharacters: maxChunkCharacters as number,
          typingIndicator
        },
        logging: {
          level: logLevel,
          format: logFormat
        }
      };
    }
  };
}

function sectionRecord(
  root: Record<string, unknown>,
  sectionName: string
): Record<string, unknown> {
  const value = root[sectionName];
  if (value == null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new ConfigValidationError(`${sectionName} must be an object`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new ConfigValidationError(`${name} must be a string`);
  }
  return value;
}

function optionalPositiveNumber(
  value: unknown,
  name: string
): number | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ConfigValidationError(`${name} must be a positive number`);
  }
  return value;
}

function isLogLevel(
  value: unknown
): value is "debug" | "info" | "warn" | "error" {
  return (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
