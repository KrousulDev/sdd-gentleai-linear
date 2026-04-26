import { afterEach, vi } from "vitest";

import { createWorkflowState, type ArchiveEvidence, type CreateWorkflowStateInput, type WorkflowState } from "../src/domain/workflow-state";
import type { EngramTopicStore } from "../src/infrastructure/engram-repository";

afterEach(() => {
  vi.restoreAllMocks();
});

export class InMemoryTopicStore implements EngramTopicStore {
  private readonly data = new Map<string, unknown>();

  async get<T>(topicKey: string): Promise<T | null> {
    return (this.data.get(topicKey) as T | undefined) ?? null;
  }

  async upsert<T>(topicKey: string, value: T): Promise<T> {
    this.data.set(topicKey, value);
    return value;
  }
}

export function createWorkflowStateFixture(
  input: CreateWorkflowStateInput,
  overrides: Partial<Omit<WorkflowState, keyof CreateWorkflowStateInput>> = {},
): WorkflowState {
  return {
    ...createWorkflowState(input),
    ...overrides,
  };
}

export function buildArchiveEvidenceFailureMessages(trace: {
  linearIssueId: string;
  sddId: string;
}): {
  token: string;
  missingCommitSha: string;
  missingPush: string;
  combined: string;
} {
  const token = `Commit message must include dual-ID token "(${trace.linearIssueId} | ${trace.sddId})".`;
  const missingCommitSha = "Archive evidence is missing commitSha.";
  const missingPush = "Archive evidence must confirm pushed=true before archive can proceed.";

  return {
    token,
    missingCommitSha,
    missingPush,
    combined: [token, missingCommitSha, missingPush].join(" "),
  };
}

export function createArchiveEvidenceFixture(
  trace: {
    linearIssueId: string;
    sddId: string;
  },
  options: {
    omitCommitSha?: boolean;
    overrides?: Partial<ArchiveEvidence>;
  } = {},
): ArchiveEvidence {
  const evidence: ArchiveEvidence = {
    commitMessage: `feat: archive workflow (${trace.linearIssueId} | ${trace.sddId})`,
    commitSha: "abc123",
    pushed: true,
    ...options.overrides,
  };

  if (options.omitCommitSha) {
    delete evidence.commitSha;
  }

  return evidence;
}
