export const splitPolicyMode = "ask" as const;

const positiveConfirmations = new Set(["y", "yes", "ok", "okay", "confirm", "confirmed", "si", "sí"]);
const negativeConfirmations = new Set(["n", "no", "deny", "denied", "decline", "declined", "cancel"]);

export interface SplitCandidate {
  title: string;
  description: string;
}

export type SplitDecisionAction =
  | "skip"
  | "await-confirmation"
  | "create-child-issues";

export interface SplitDecision {
  mode: typeof splitPolicyMode;
  action: SplitDecisionAction;
  approved: boolean;
  requiresConfirmation: boolean;
  candidateCount: number;
  reason: string;
}

export class SplitPolicy {
  readonly mode = splitPolicyMode;

  evaluate(
    candidates: SplitCandidate[],
    confirmation?: string,
  ): SplitDecision {
    if (candidates.length === 0) {
      return {
        mode: this.mode,
        action: "skip",
        approved: false,
        requiresConfirmation: false,
        candidateCount: 0,
        reason: "No split candidates detected.",
      };
    }

    if (confirmation === undefined) {
      return {
        mode: this.mode,
        action: "await-confirmation",
        approved: false,
        requiresConfirmation: true,
        candidateCount: candidates.length,
        reason: "Split candidates detected; explicit confirmation is required before creating child issues.",
      };
    }

    const normalizedConfirmation = normalizeConfirmation(confirmation);

    if (normalizedConfirmation === true) {
      return {
        mode: this.mode,
        action: "create-child-issues",
        approved: true,
        requiresConfirmation: true,
        candidateCount: candidates.length,
        reason: "Operator explicitly approved child issue creation.",
      };
    }

    return {
      mode: this.mode,
      action: normalizedConfirmation === false ? "skip" : "await-confirmation",
      approved: false,
      requiresConfirmation: true,
      candidateCount: candidates.length,
      reason:
        normalizedConfirmation === false
          ? "Operator declined child issue creation."
          : "Confirmation was ambiguous; child issue creation remains blocked.",
    };
  }
}

export function normalizeConfirmation(input: string): boolean | null {
  const normalized = input.trim().toLowerCase();

  if (positiveConfirmations.has(normalized)) {
    return true;
  }

  if (negativeConfirmations.has(normalized)) {
    return false;
  }

  return null;
}
