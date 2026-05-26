import { randomUUID } from "node:crypto";

import type {
  ClaudeCliAdapter,
  EnqueueResult,
  JobQueue,
  MentionRequest,
  ReplyPublisher,
  SessionStore
} from "./modules.js";

export interface QueueConfig {
  concurrency: number;
  maxPendingJobs: number;
}

export interface JobQueueDeps {
  adapter: ClaudeCliAdapter;
  publisher: ReplyPublisher;
  sessionStore: SessionStore;
  config: QueueConfig;
}

interface Job {
  requestId: string;
  request: MentionRequest;
}

export function createJobQueue(deps: JobQueueDeps): JobQueue {
  const { adapter, publisher, sessionStore, config } = deps;

  let shuttingDown = false;

  const pending: Job[] = [];
  let inFlightCount = 0;
  let drainResolvers: Array<() => void> = [];

  function notifyDrainIfIdle(): void {
    if (inFlightCount === 0 && pending.length === 0) {
      const resolvers = drainResolvers;
      drainResolvers = [];
      for (const resolve of resolvers) {
        resolve();
      }
    }
  }

  async function processJob(job: Job): Promise<void> {
    inFlightCount++;
    try {
      const { request } = job;
      const target = { messageId: request.messageId, channelId: request.channelId };

      const sessionId = await sessionStore.getSessionId(request.sessionScopeKey);

      const result = await adapter.execute({
        prompt: request.prompt,
        timeoutMs: 30_000,
        sessionId
      });

      if (result.kind === "success") {
        if (result.sessionId) {
          await sessionStore.setSessionId(request.sessionScopeKey, result.sessionId);
        }
        await publisher.publishSuccess(target, result.text);
      } else {
        await publisher.publishFailure(target, result.category);
      }
    } finally {
      inFlightCount--;
      scheduleNext();
    }
  }

  function scheduleNext(): void {
    if (shuttingDown && pending.length === 0) {
      notifyDrainIfIdle();
      return;
    }
    while (inFlightCount < config.concurrency && pending.length > 0) {
      const job = pending.shift() as Job;
      void processJob(job);
    }
    notifyDrainIfIdle();
  }

  function enqueue(request: MentionRequest): Promise<EnqueueResult> {
    if (shuttingDown) {
      return Promise.resolve({ kind: "rejected", reason: "shutdown" });
    }

    if (pending.length >= config.maxPendingJobs) {
      return Promise.resolve({ kind: "rejected", reason: "queue-full" });
    }

    const requestId = randomUUID();
    const job: Job = { requestId, request };

    if (inFlightCount < config.concurrency) {
      void processJob(job);
    } else {
      pending.push(job);
    }

    return Promise.resolve({ kind: "accepted", requestId });
  }

  function start(): Promise<void> {
    shuttingDown = false;
    return Promise.resolve();
  }

  async function stop(): Promise<void> {
    shuttingDown = true;

    if (inFlightCount === 0 && pending.length === 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      drainResolvers.push(resolve);
    });
  }

  return { enqueue, start, stop };
}
