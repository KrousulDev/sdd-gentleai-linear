import type { SddStage, WorkflowState } from "../../domain/workflow-state";
import type { ArchiveEvidence } from "../../domain/workflow-state";
import { validateArchiveEvidence } from "../dual-id-validator";
import { workflowGuardNames, type WorkflowGuardName } from "../plugin-events";

export interface WorkflowGuardDecision {
  allowed: boolean;
  gateReasons: Partial<Record<WorkflowGuardName, string>>;
  blockingReasons: string[];
}

export function evaluateStageTransition(
  state: WorkflowState,
  nextStage: SddStage,
): WorkflowGuardDecision {
  const gateReasons: Partial<Record<WorkflowGuardName, string>> = {};
  const blockingReasons: string[] = [];

  if (isForwardStageTransition(state.stage, nextStage) && state.gates.verify === "failed") {
    gateReasons.verify =
      'Cannot advance workflow while verify status is "failed".';
    blockingReasons.push(gateReasons.verify);
  }

  if (nextStage === "review" && state.gates.verify !== "success") {
    gateReasons.verify =
      'Cannot enter "review" until verify has passed with status "success".';
    blockingReasons.push(gateReasons.verify);
  }

  if (nextStage === "done" && state.gates.archive !== "done") {
    gateReasons.archive =
      'Cannot enter "done" until archive has completed with status "done".';
    blockingReasons.push(gateReasons.archive);
  }

  return {
    allowed: Object.keys(gateReasons).length === 0,
    gateReasons,
    blockingReasons,
  };
}

export function evaluateArchivePreparation(
  state: WorkflowState,
  evidence?: ArchiveEvidence,
): WorkflowGuardDecision {
  const gateReasons: Partial<Record<WorkflowGuardName, string>> = {};
  const blockingReasons: string[] = [];

  if (state.gates.verify !== "success") {
    gateReasons.verify =
      'Archive is blocked until verify passes with status "success".';
    blockingReasons.push(gateReasons.verify);
  }

  const archiveBlockingReasons: string[] = [];

  if (!state.linearIssueId) {
    archiveBlockingReasons.push(
      'Archive is blocked until a linked Linear parent issue exists.',
    );
  }

  if (evidence) {
    const validation = validateArchiveEvidence({
      trace: {
        sddId: state.sddId,
        linearIssueId: state.linearIssueId,
      },
      evidence,
    });

    archiveBlockingReasons.push(...validation.blockingReasons);
  }

  if (archiveBlockingReasons.length > 0) {
    gateReasons.archive = archiveBlockingReasons.join(" ");
    blockingReasons.push(...archiveBlockingReasons);
  }

  return {
    allowed: Object.keys(gateReasons).length === 0,
    gateReasons,
    blockingReasons,
  };
}

export function clearWorkflowGateReasons(
  gateReasons: WorkflowState["gateReasons"],
  gates: readonly WorkflowGuardName[] = workflowGuardNames,
): WorkflowState["gateReasons"] {
  const nextGateReasons = { ...gateReasons };

  for (const gate of gates) {
    delete nextGateReasons[gate];
  }

  return nextGateReasons;
}

function isForwardStageTransition(currentStage: SddStage, nextStage: SddStage): boolean {
  return stageOrder.indexOf(nextStage) > stageOrder.indexOf(currentStage);
}

const stageOrder: readonly SddStage[] = ["spec", "plan", "tasks", "implement", "review", "done"];
