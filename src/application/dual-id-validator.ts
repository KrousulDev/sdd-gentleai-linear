import type { ArchiveEvidence } from "../domain/workflow-state";

export type DualIdField = "sddId" | "linearIssueId";

export interface DualIdTrace {
  sddId: string | null | undefined;
  linearIssueId: string | null | undefined;
}

export interface DualIdValidationResult {
  valid: boolean;
  missingFields: DualIdField[];
  blockingReasons: string[];
  expectedToken?: string;
  reason?: string;
}

export interface ArchiveEvidenceValidationInput {
  trace: DualIdTrace;
  evidence: ArchiveEvidence;
}

interface DualIdValidationCandidate {
  valid: boolean;
  missingFields: DualIdField[];
  blockingReasons: string[];
  expectedToken?: string;
  reason?: string | undefined;
}

export function buildDualIdToken(input: {
  sddId: string;
  linearIssueId: string;
}): string {
  return `(${input.linearIssueId} | ${input.sddId})`;
}

export function validateDualIdCommitMessage(input: {
  trace: DualIdTrace;
  commitMessage: ArchiveEvidence["commitMessage"];
}): DualIdValidationResult {
  const missingFields = collectMissingFields(input.trace);
  const blockingReasons: string[] = [];

  if (missingFields.length > 0) {
    blockingReasons.push(`Missing dual-ID fields: ${missingFields.join(", ")}.`);

    return withOptionalReason({
      valid: false,
      missingFields,
      blockingReasons,
      reason: blockingReasons[0],
    });
  }

  const expectedToken = buildDualIdToken({
    sddId: input.trace.sddId as string,
    linearIssueId: input.trace.linearIssueId as string,
  });

  if (!input.commitMessage.includes(expectedToken)) {
    blockingReasons.push(`Commit message must include dual-ID token \"${expectedToken}\".`);

    return withOptionalReason({
      valid: false,
      missingFields: [],
      blockingReasons,
      expectedToken,
      reason: blockingReasons[0],
    });
  }

  return {
    valid: true,
    missingFields: [],
    blockingReasons: [],
    expectedToken,
  };
}

export function validateArchiveEvidence(
  input: ArchiveEvidenceValidationInput,
): DualIdValidationResult {
  const commitValidation = validateDualIdCommitMessage({
    trace: input.trace,
    commitMessage: input.evidence.commitMessage,
  });

  const blockingReasons = [...commitValidation.blockingReasons];

  if (!input.evidence.commitMessage.trim()) {
    blockingReasons.push("Archive evidence is missing commitMessage.");
  }

  if (!input.evidence.commitSha?.trim()) {
    blockingReasons.push("Archive evidence is missing commitSha.");
  }

  if (!input.evidence.pushed) {
    blockingReasons.push("Archive evidence must confirm pushed=true before archive can proceed.");
  }

  return withOptionalReason({
    ...commitValidation,
    valid: blockingReasons.length === 0,
    blockingReasons,
    reason: blockingReasons[0],
  });
}

function collectMissingFields(trace: DualIdTrace): DualIdField[] {
  const missingFields: DualIdField[] = [];

  if (!trace.sddId) {
    missingFields.push("sddId");
  }

  if (!trace.linearIssueId) {
    missingFields.push("linearIssueId");
  }

  return missingFields;
}

function withOptionalReason(result: DualIdValidationCandidate): DualIdValidationResult {
  if (result.reason) {
    return {
      ...result,
      reason: result.reason,
    };
  }

  const { reason: _reason, ...withoutReason } = result;
  return withoutReason;
}
