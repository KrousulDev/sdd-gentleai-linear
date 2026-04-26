import {
  appendWorkflowActivity,
  createWorkflowState,
  linkWorkflowParent,
  markWorkflowSyncDegraded,
  markWorkflowSyncOk,
  markWorkflowSyncPendingRetry,
  recordWorkflowTransition,
  updateWorkflowGateReason,
  workflowStateTopicKey,
} from "../../src/domain/workflow-state";
import { pluginEventNames } from "../../src/application/plugin-events";

describe("workflow-state", () => {
  it("creates the default canonical state for a new sddId", () => {
    const state = createWorkflowState({ sddId: "sdd_001" });

    expect(state).toEqual({
      sddId: "sdd_001",
      linearIssueId: null,
      stage: "spec",
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
    });
  });

  it("appends activity immutably and derives a stable topic key", () => {
    const state = createWorkflowState({
      sddId: "sdd_002",
      linearIssueId: "ENG-123",
      stage: "tasks",
    });
    const activity = {
      at: "2026-04-25T09:00:00.000Z",
      kind: "stage.sync",
      summary: "Moved canonical stage to tasks.",
    };

    const nextState = appendWorkflowActivity(state, activity);

    expect(state.activity).toEqual([]);
    expect(nextState.activity).toEqual([activity]);
    expect(workflowStateTopicKey(state.sddId)).toBe("sdd/workflow-state/sdd_002");
  });

  it("links a parent issue and can recover sync status back to ok", () => {
    const state = createWorkflowState({ sddId: "sdd_010" });
    const linked = linkWorkflowParent(state, { linearIssueId: "ENG-010" });
    const recovered = markWorkflowSyncOk(
      markWorkflowSyncDegraded(linked, {
        linear: "ENG-010",
        error: "linear offline",
      }),
      "ENG-010",
    );

    expect(linked.linearIssueId).toBe("ENG-010");
    expect(recovered.lastSync).toEqual({
      linear: "ENG-010",
      status: "ok",
      pendingRetry: false,
    });
  });

  it("tracks guard reasons, retry state, and transition metadata without mutating the original state", () => {
    const state = createWorkflowState({ sddId: "sdd_003", stage: "plan" });

    const withGuard = updateWorkflowGateReason(
      state,
      "verify",
      'Cannot enter "review" until verify has passed with status "success".',
    );
    const withPendingRetry = markWorkflowSyncPendingRetry(withGuard, "ENG-500");
    const degraded = markWorkflowSyncDegraded(withPendingRetry, {
      linear: "ENG-500",
      error: "linear offline",
    });
    const transitioned = recordWorkflowTransition(degraded, {
      at: "2026-04-25T11:00:00.000Z",
      to: "tasks",
      trigger: pluginEventNames.commandExecuteBefore,
    });

    expect(state.gateReasons).toEqual({});
    expect(withGuard.gateReasons.verify).toContain("Cannot enter \"review\"");
    expect(withPendingRetry.lastSync).toEqual({
      linear: "ENG-500",
      status: "ok",
      pendingRetry: true,
      error: undefined,
    });
    expect(transitioned.lastSync).toEqual({
      linear: "ENG-500",
      status: "degraded",
      pendingRetry: false,
      error: "linear offline",
    });
    expect(transitioned.lastTransition).toEqual({
      at: "2026-04-25T11:00:00.000Z",
      from: "plan",
      to: "tasks",
      trigger: "command.execute.before",
    });
    expect(transitioned.stage).toBe("tasks");
  });
});
