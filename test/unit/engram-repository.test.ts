import { pluginEventNames } from "../../src/application/plugin-events";
import { createWorkflowState } from "../../src/domain/workflow-state";
import { EngramRepository, type EngramTopicStore } from "../../src/infrastructure/engram-repository";
import { InMemoryTopicStore } from "../setup";

describe("EngramRepository", () => {
  it("stores and retrieves workflow state by stable topic key", async () => {
    const repository = new EngramRepository(new InMemoryTopicStore());
    const state = createWorkflowState({ sddId: "sdd_003", linearIssueId: "ENG-200" });

    await repository.upsertState(state);

    await expect(repository.getBySddId("sdd_003")).resolves.toEqual(state);
  });

  it("appends activity without losing existing canonical state", async () => {
    const repository = new EngramRepository(new InMemoryTopicStore());
    const state = createWorkflowState({ sddId: "sdd_004", stage: "implement" });
    const activity = {
      at: "2026-04-25T09:05:00.000Z",
      kind: "summary.publish",
      summary: "Published compact status summary.",
    };

    await repository.upsertState(state);

    const nextState = await repository.appendActivity("sdd_004", activity);

    expect(nextState.stage).toBe("implement");
    expect(nextState.activity).toEqual([activity]);
  });

  it("updates transition metadata, gate reasons, and degraded sync markers atomically", async () => {
    const repository = new EngramRepository(new InMemoryTopicStore());
    const state = createWorkflowState({ sddId: "sdd_005", stage: "tasks" });

    await repository.upsertState(state);
    await repository.setGateReason(
      "sdd_005",
      "verify",
      'Cannot enter "review" until verify has passed with status "success".',
    );
    await repository.markSyncPendingRetry("sdd_005", "ENG-555");
    await repository.transitionStage("sdd_005", {
      at: "2026-04-25T11:05:00.000Z",
      to: "implement",
      trigger: pluginEventNames.commandExecuteBefore,
    });

    const degradedState = await repository.markSyncDegraded("sdd_005", {
      linear: "ENG-555",
      error: "linear offline",
      at: "2026-04-25T11:06:00.000Z",
      operation: "stage.sync",
    });

    expect(degradedState.gateReasons.verify).toContain("Cannot enter \"review\"");
    expect(degradedState.lastTransition).toEqual({
      at: "2026-04-25T11:05:00.000Z",
      from: "tasks",
      to: "implement",
      trigger: "command.execute.before",
    });
    expect(degradedState.lastSync).toEqual({
      linear: "ENG-555",
      status: "degraded",
      pendingRetry: false,
      error: "linear offline",
    });
    expect(degradedState.activity.at(-1)).toEqual({
      at: "2026-04-25T11:06:00.000Z",
      kind: "stage.sync.degraded",
      summary: "linear offline",
    });
  });

  it("can ensure a state exists, link a parent issue, and reset sync status to ok", async () => {
    const repository = new EngramRepository(new InMemoryTopicStore());

    const state = await repository.ensureState({ sddId: "sdd_006", stage: "spec" });
    const linkedState = await repository.linkParentIssue("sdd_006", {
      linearIssueId: "ENG-600",
      activity: {
        at: "2026-04-25T11:10:00.000Z",
        kind: "parent.link",
        summary: "Linked Linear parent ENG-600.",
      },
    });

    await repository.markSyncDegraded("sdd_006", {
      linear: "ENG-600",
      error: "temporary issue",
      at: "2026-04-25T11:11:00.000Z",
      operation: "summary.publish",
    });

    const recoveredState = await repository.markSyncOk("sdd_006", "ENG-600");

    expect(state.linearIssueId).toBeNull();
    expect(linkedState.linearIssueId).toBe("ENG-600");
    expect(recoveredState.lastSync).toEqual({
      linear: "ENG-600",
      status: "ok",
      pendingRetry: false,
    });
  });

  it("persists archive evidence assertions on the workflow state topic", async () => {
    const repository = new EngramRepository(new InMemoryTopicStore());
    await repository.upsertState(
      createWorkflowState({
        sddId: "sdd_007",
        linearIssueId: "ENG-700",
        stage: "review",
      }),
    );

    const state = await repository.recordArchiveEvidence("sdd_007", {
      commitMessage: "feat: archive workflow (ENG-700 | sdd_007)",
      commitSha: "abc123",
      pushed: true,
      expectedToken: "(ENG-700 | sdd_007)",
      assertedAt: "2026-04-25T11:12:00.000Z",
    });

    expect(state.archiveEvidence).toEqual({
      commitMessage: "feat: archive workflow (ENG-700 | sdd_007)",
      commitSha: "abc123",
      pushed: true,
      expectedToken: "(ENG-700 | sdd_007)",
      assertedAt: "2026-04-25T11:12:00.000Z",
    });
  });
});
