import {
  appendWorkflowActivity,
  createWorkflowState,
  linkWorkflowParent,
  markWorkflowSyncDegraded,
  markWorkflowSyncOk,
  markWorkflowSyncPendingRetry,
  recordWorkflowArchiveEvidence,
  recordWorkflowTransition,
  type ArchiveEvidenceAssertion,
  type WorkflowActivity,
  type WorkflowState,
  updateWorkflowGateReason,
  workflowStateTopicKey,
} from "../domain/workflow-state";
import type { PluginEventName, WorkflowGuardName } from "../application/plugin-events";
import type { CreateWorkflowStateInput, SddStage } from "../domain/workflow-state";

export interface EngramTopicStore {
  get<T>(topicKey: string): Promise<T | null>;
  upsert<T>(topicKey: string, value: T): Promise<T>;
}

export class EngramRepository {
  constructor(private readonly store: EngramTopicStore) {}

  getBySddId(sddId: string): Promise<WorkflowState | null> {
    return this.store.get<WorkflowState>(workflowStateTopicKey(sddId));
  }

  upsertState(state: WorkflowState): Promise<WorkflowState> {
    return this.store.upsert(workflowStateTopicKey(state.sddId), state);
  }

  async ensureState(input: CreateWorkflowStateInput): Promise<WorkflowState> {
    const topicKey = workflowStateTopicKey(input.sddId);
    const currentState = await this.store.get<WorkflowState>(topicKey);

    if (currentState) {
      return currentState;
    }

    const nextState = createWorkflowState(input);
    return this.store.upsert(topicKey, nextState);
  }

  async appendActivity(sddId: string, activity: WorkflowActivity): Promise<WorkflowState> {
    const topicKey = workflowStateTopicKey(sddId);
    const currentState = await this.store.get<WorkflowState>(topicKey);

    if (!currentState) {
      throw new Error(`Missing workflow state for sddId "${sddId}".`);
    }

    const nextState = appendWorkflowActivity(currentState, activity);
    return this.store.upsert(topicKey, nextState);
  }

  async transitionStage(
    sddId: string,
    input: {
      at: string;
      to: SddStage;
      trigger: PluginEventName | string;
      gateReasons?: Partial<Record<WorkflowGuardName, string>>;
    },
  ): Promise<WorkflowState> {
    const topicKey = workflowStateTopicKey(sddId);
    const currentState = await this.requireState(topicKey, sddId);

    let nextState = recordWorkflowTransition(currentState, {
      at: input.at,
      to: input.to,
      trigger: input.trigger,
    });

    if (input.gateReasons) {
      for (const [gate, reason] of Object.entries(input.gateReasons)) {
        nextState = updateWorkflowGateReason(nextState, gate as WorkflowGuardName, reason);
      }
    }

    return this.store.upsert(topicKey, nextState);
  }

  async setGateReason(
    sddId: string,
    gate: WorkflowGuardName,
    reason?: string,
  ): Promise<WorkflowState> {
    const topicKey = workflowStateTopicKey(sddId);
    const currentState = await this.requireState(topicKey, sddId);
    const nextState = updateWorkflowGateReason(currentState, gate, reason);

    return this.store.upsert(topicKey, nextState);
  }

  async linkParentIssue(
    sddId: string,
    input: { linearIssueId: string; activity?: WorkflowActivity },
  ): Promise<WorkflowState> {
    const topicKey = workflowStateTopicKey(sddId);
    const currentState = await this.requireState(topicKey, sddId);

    let nextState = markWorkflowSyncOk(
      linkWorkflowParent(currentState, { linearIssueId: input.linearIssueId }),
      input.linearIssueId,
    );

    if (input.activity) {
      nextState = appendWorkflowActivity(nextState, input.activity);
    }

    return this.store.upsert(topicKey, nextState);
  }

  async markSyncOk(sddId: string, linear?: string): Promise<WorkflowState> {
    const topicKey = workflowStateTopicKey(sddId);
    const currentState = await this.requireState(topicKey, sddId);
    const nextState = markWorkflowSyncOk(currentState, linear);

    return this.store.upsert(topicKey, nextState);
  }

  async markSyncPendingRetry(
    sddId: string,
    linear?: string,
  ): Promise<WorkflowState> {
    const topicKey = workflowStateTopicKey(sddId);
    const currentState = await this.requireState(topicKey, sddId);
    const nextState = markWorkflowSyncPendingRetry(currentState, linear);

    return this.store.upsert(topicKey, nextState);
  }

  async markSyncDegraded(
    sddId: string,
    input: { linear?: string; error: string; at: string; operation: string },
  ): Promise<WorkflowState> {
    const topicKey = workflowStateTopicKey(sddId);
    const currentState = await this.requireState(topicKey, sddId);
    const degradedInput = { error: input.error } as Parameters<
      typeof markWorkflowSyncDegraded
    >[1];

    if (input.linear) {
      degradedInput.linear = input.linear;
    }

    const nextState = appendWorkflowActivity(
      markWorkflowSyncDegraded(currentState, degradedInput),
      {
        at: input.at,
        kind: `${input.operation}.degraded`,
        summary: input.error,
      },
    );

    return this.store.upsert(topicKey, nextState);
  }

  async recordArchiveEvidence(
    sddId: string,
    archiveEvidence: ArchiveEvidenceAssertion,
  ): Promise<WorkflowState> {
    const topicKey = workflowStateTopicKey(sddId);
    const currentState = await this.requireState(topicKey, sddId);
    const nextState = recordWorkflowArchiveEvidence(currentState, archiveEvidence);

    return this.store.upsert(topicKey, nextState);
  }

  private async requireState(topicKey: string, sddId: string): Promise<WorkflowState> {
    const state = await this.store.get<WorkflowState>(topicKey);

    if (!state) {
      throw new Error(`Missing workflow state for sddId "${sddId}".`);
    }

    return state;
  }
}
