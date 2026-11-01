export const QUEUE_NAMES = ['discovery', 'analysis', 'publish', 'maintenance'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export interface QueueStats {
  name: QueueName;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

export interface FailedJobInfo {
  queue: QueueName;
  id: string;
  name: string;
  failedReason: string;
  finishedOn: string | null;
}

export interface JobQueues {
  enqueueDiscovery(requestedBy: string | null): Promise<string | null>;
  enqueueAnalysis(conversationId: string): Promise<void>;
  /** jobId = attemptId, so the same attempt can never be queued twice. */
  enqueuePublish(attemptId: string): Promise<void>;
  /** Kill switch: remove publish jobs that have not started yet. Returns number removed. */
  removePendingPublishJobs(): Promise<number>;
  stats(): Promise<QueueStats[]>;
  failedJobs(limit: number): Promise<FailedJobInfo[]>;
  ping(): Promise<number>;
  close(): Promise<void>;
}

/** In-process queue for tests and for running without Redis. Jobs are recorded, not executed. */
export class InMemoryQueues implements JobQueues {
  discovery: (string | null)[] = [];
  analysis: string[] = [];
  publish: string[] = [];

  async enqueueDiscovery(requestedBy: string | null) {
    this.discovery.push(requestedBy);
    return `mem-discovery-${this.discovery.length}`;
  }
  async enqueueAnalysis(conversationId: string) {
    if (!this.analysis.includes(conversationId)) this.analysis.push(conversationId);
  }
  async enqueuePublish(attemptId: string) {
    if (!this.publish.includes(attemptId)) this.publish.push(attemptId);
  }
  async removePendingPublishJobs() {
    const n = this.publish.length;
    this.publish = [];
    return n;
  }
  async stats(): Promise<QueueStats[]> {
    return [
      { name: 'discovery', waiting: this.discovery.length, active: 0, delayed: 0, failed: 0, completed: 0 },
      { name: 'analysis', waiting: this.analysis.length, active: 0, delayed: 0, failed: 0, completed: 0 },
      { name: 'publish', waiting: this.publish.length, active: 0, delayed: 0, failed: 0, completed: 0 },
      { name: 'maintenance', waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 },
    ];
  }
  async failedJobs() {
    return [];
  }
  async ping() {
    return 0;
  }
  async close() {}
}
