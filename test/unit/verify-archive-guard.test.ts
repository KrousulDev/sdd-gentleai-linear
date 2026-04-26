import { createWorkflowState } from "../../src/domain/workflow-state";
import {
  clearWorkflowGateReasons,
  evaluateArchivePreparation,
  evaluateStageTransition,
} from "../../src/application/guards/verify-archive-guard";
import {
  buildArchiveEvidenceFailureMessages,
  createArchiveEvidenceFixture,
} from "../setup";

describe("verify-archive-guard", () => {
  it("blocks review until verify succeeds", () => {
    const state = createWorkflowState({ sddId: "sdd_100", stage: "implement" });

    const result = evaluateStageTransition(state, "review");

    expect(result).toEqual({
      allowed: false,
      blockingReasons: [
        'Cannot enter "review" until verify has passed with status "success".',
      ],
      gateReasons: {
        verify:
          'Cannot enter "review" until verify has passed with status "success".',
      },
    });
  });

  it("blocks archive preparation until verify passes and a Linear issue is linked", () => {
    const state = createWorkflowState({ sddId: "sdd_101", stage: "review" });

    const result = evaluateArchivePreparation(state);

    expect(result).toEqual({
      allowed: false,
      blockingReasons: [
        'Archive is blocked until verify passes with status "success".',
        'Archive is blocked until a linked Linear parent issue exists.',
      ],
      gateReasons: {
        verify: 'Archive is blocked until verify passes with status "success".',
        archive: 'Archive is blocked until a linked Linear parent issue exists.',
      },
    });
  });

  it("blocks any forward transition when verify has already failed", () => {
    const state = {
      ...createWorkflowState({ sddId: "sdd_102", stage: "implement" }),
      gates: {
        verify: "failed" as const,
        archive: "locked" as const,
      },
    };

    const result = evaluateStageTransition(state, "review");

    expect(result).toEqual({
      allowed: false,
      blockingReasons: [
        'Cannot advance workflow while verify status is "failed".',
        'Cannot enter "review" until verify has passed with status "success".',
      ],
      gateReasons: {
        verify:
          'Cannot enter "review" until verify has passed with status "success".',
      },
    });
  });

  it("blocks archive when dual-ID evidence is malformed or incomplete", () => {
    const state = {
      ...createWorkflowState({
        sddId: "sdd_103",
        stage: "review",
        linearIssueId: "ENG-103",
      }),
      gates: {
        verify: "success" as const,
        archive: "locked" as const,
      },
    };

    const failures = buildArchiveEvidenceFailureMessages({
      linearIssueId: "ENG-103",
      sddId: "sdd_103",
    });

    const result = evaluateArchivePreparation(
      state,
      createArchiveEvidenceFixture({
        linearIssueId: "ENG-103",
        sddId: "sdd_103",
      }, {
        omitCommitSha: true,
        overrides: {
          commitMessage: "feat: archive workflow",
          pushed: false,
        },
      }),
    );

    expect(result).toEqual({
      allowed: false,
      blockingReasons: [
        failures.token,
        failures.missingCommitSha,
        failures.missingPush,
      ],
      gateReasons: {
        archive: failures.combined,
      },
    });
  });

  it("clears only the requested gate reasons", () => {
    const result = clearWorkflowGateReasons({
      verify: "verify blocked",
      archive: "archive blocked",
    }, ["verify"]);

    expect(result).toEqual({ archive: "archive blocked" });
  });
});
