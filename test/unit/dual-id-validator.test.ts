import {
  buildDualIdToken,
  validateArchiveEvidence,
  validateDualIdCommitMessage,
} from "../../src/application/dual-id-validator";
import {
  buildArchiveEvidenceFailureMessages,
  createArchiveEvidenceFixture,
} from "../setup";

describe("dual-id-validator", () => {
  it("builds the expected dual-ID token", () => {
    expect(buildDualIdToken({ linearIssueId: "ENG-123", sddId: "sdd_001" })).toBe(
      "(ENG-123 | sdd_001)",
    );
  });

  it("accepts commit messages that include the expected dual-ID token", () => {
    const result = validateDualIdCommitMessage({
      trace: {
        linearIssueId: "ENG-123",
        sddId: "sdd_001",
      },
      commitMessage: "feat: close workflow (ENG-123 | sdd_001)",
    });

    expect(result).toEqual({
      valid: true,
      missingFields: [],
      blockingReasons: [],
      expectedToken: "(ENG-123 | sdd_001)",
    });
  });

  it("rejects validation when one of the required IDs is missing", () => {
    const result = validateDualIdCommitMessage({
      trace: {
        linearIssueId: null,
        sddId: "sdd_001",
      },
      commitMessage: "feat: close workflow",
    });

    expect(result).toEqual({
      valid: false,
      missingFields: ["linearIssueId"],
      blockingReasons: ["Missing dual-ID fields: linearIssueId."],
      reason: "Missing dual-ID fields: linearIssueId.",
    });
  });

  it("rejects commit messages that omit the exact dual-ID token", () => {
    const result = validateDualIdCommitMessage({
      trace: {
        linearIssueId: "ENG-123",
        sddId: "sdd_001",
      },
      commitMessage: "feat: close workflow ENG-123 sdd_001",
    });

    expect(result).toEqual({
      valid: false,
      missingFields: [],
      blockingReasons: ['Commit message must include dual-ID token "(ENG-123 | sdd_001)".'],
      expectedToken: "(ENG-123 | sdd_001)",
      reason:
        'Commit message must include dual-ID token "(ENG-123 | sdd_001)".',
    });
  });

  it("rejects archive evidence when commit metadata or push proof is missing", () => {
    const failures = buildArchiveEvidenceFailureMessages({
      linearIssueId: "ENG-123",
      sddId: "sdd_001",
    });

    const result = validateArchiveEvidence({
      trace: {
        linearIssueId: "ENG-123",
        sddId: "sdd_001",
      },
      evidence: createArchiveEvidenceFixture(
        {
          linearIssueId: "ENG-123",
          sddId: "sdd_001",
        },
        {
          omitCommitSha: true,
          overrides: {
            pushed: false,
          },
        },
      ),
    });

    expect(result).toEqual({
      valid: false,
      missingFields: [],
      blockingReasons: [
        failures.missingCommitSha,
        failures.missingPush,
      ],
      expectedToken: "(ENG-123 | sdd_001)",
      reason: failures.missingCommitSha,
    });
  });
});
