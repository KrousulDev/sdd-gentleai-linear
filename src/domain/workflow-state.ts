import type { PluginEventName, WorkflowGuardName } from "../application/plugin-events";

export const sddStages = ["spec", "plan", "tasks", "implement", "review", "done"] as const;

export type SddStage = (typeof sddStages)[number];
export type VerifyGate = "pending" | "failed" | "success";
export type ArchiveGate = "locked" | "ready" | "done";
export type SyncStatus = "ok" | "degraded";

export interface WorkflowActivity {
  at: string;
  kind: string;
  summary: string;
}

export interface WorkflowTransition {
  at: string;
  from: SddStage;
  to: SddStage;
  trigger: PluginEventName | string;
}

export interface WorkflowState {
  sddId: string;
  linearIssueId: string | null;
  stage: SddStage;
  childIssueIds: string[];
  gates: {
    verify: VerifyGate;
    archive: ArchiveGate;
  };
  gateReasons: Partial<Record<WorkflowGuardName, string>>;
  activity: WorkflowActivity[];
  archiveEvidence?: ArchiveEvidenceAssertion;
  lastSync: {
    linear?: string;
    status: SyncStatus;
    pendingRetry: boolean;
    error?: string;
  };
  lastTransition?: WorkflowTransition;
}

export interface ArchiveEvidence {
  commitMessage: string;
  commitSha?: string;
  pushed: boolean;
}

export interface ArchiveEvidenceAssertion extends ArchiveEvidence {
  expectedToken: string;
  assertedAt: string;
}

export interface CreateWorkflowStateInput {
  sddId: string;
  linearIssueId?: string | null;
  stage?: SddStage;
}

export interface RecordWorkflowTransitionInput {
  at: string;
  to: SddStage;
  trigger: PluginEventName | string;
}

export function createWorkflowState(input: CreateWorkflowStateInput): WorkflowState {
  return {
    sddId: input.sddId,
    linearIssueId: input.linearIssueId ?? null,
    stage: input.stage ?? "spec",
    childIssueIds: [],
    gates: {
      verify: "pending",
      archive: "locked",
    },
    gateReasons: {},
    activity: [],
    lastSync: {
      status: "ok",
      pendingRetry: false,
    },
  };
}

export function appendWorkflowActivity(
  state: WorkflowState,
  activity: WorkflowActivity,
): WorkflowState {
  return {
    ...state,
    activity: [...state.activity, activity],
  };
}

export function linkWorkflowParent(
  state: WorkflowState,
  input: { linearIssueId: string },
): WorkflowState {
  return {
    ...state,
    linearIssueId: input.linearIssueId,
  };
}

export function recordWorkflowTransition(
  state: WorkflowState,
  transition: RecordWorkflowTransitionInput,
): WorkflowState {
  return {
    ...state,
    stage: transition.to,
    lastTransition: {
      at: transition.at,
      from: state.stage,
      to: transition.to,
      trigger: transition.trigger,
    },
  };
}

export function updateWorkflowGateReason(
  state: WorkflowState,
  gate: WorkflowGuardName,
  reason?: string,
): WorkflowState {
  const gateReasons = { ...state.gateReasons };

  if (reason) {
    gateReasons[gate] = reason;
  } else {
    delete gateReasons[gate];
  }

  return {
    ...state,
    gateReasons,
  };
}

export function markWorkflowSyncPendingRetry(
  state: WorkflowState,
  linear?: string,
): WorkflowState {
  const nextLastSync: WorkflowState["lastSync"] = {
    status: "ok",
    pendingRetry: true,
  };

  if (linear) {
    nextLastSync.linear = linear;
  }

  return {
    ...state,
    lastSync: nextLastSync,
  };
}

export function markWorkflowSyncDegraded(
  state: WorkflowState,
  input: { linear?: string; error: string },
): WorkflowState {
  const nextLastSync: WorkflowState["lastSync"] = {
    status: "degraded",
    pendingRetry: false,
    error: input.error,
  };

  if (input.linear) {
    nextLastSync.linear = input.linear;
  }

  return {
    ...state,
    lastSync: nextLastSync,
  };
}

export function markWorkflowSyncOk(
  state: WorkflowState,
  linear?: string,
): WorkflowState {
  const nextLastSync: WorkflowState["lastSync"] = {
    status: "ok",
    pendingRetry: false,
  };

  if (linear) {
    nextLastSync.linear = linear;
  }

  return {
    ...state,
    lastSync: nextLastSync,
  };
}

export function recordWorkflowArchiveEvidence(
  state: WorkflowState,
  archiveEvidence: ArchiveEvidenceAssertion,
): WorkflowState {
  return {
    ...state,
    archiveEvidence,
  };
}

export function workflowStateTopicKey(sddId: string): string {
  return `sdd/workflow-state/${sddId}`;
}
