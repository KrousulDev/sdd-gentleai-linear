import {
  normalizeConfirmation,
  SplitPolicy,
} from "../../src/application/split-policy";

const candidates = [
  {
    title: "Create child issue",
    description: "Split one implementation task.",
  },
];

describe("split-policy", () => {
  it("keeps child issue creation blocked until the operator confirms", () => {
    const policy = new SplitPolicy();

    expect(policy.evaluate(candidates)).toEqual({
      mode: "ask",
      action: "await-confirmation",
      approved: false,
      requiresConfirmation: true,
      candidateCount: 1,
      reason:
        "Split candidates detected; explicit confirmation is required before creating child issues.",
    });
  });

  it("allows child issue creation only after an explicit positive confirmation", () => {
    const policy = new SplitPolicy();

    expect(policy.evaluate(candidates, "yes")).toEqual({
      mode: "ask",
      action: "create-child-issues",
      approved: true,
      requiresConfirmation: true,
      candidateCount: 1,
      reason: "Operator explicitly approved child issue creation.",
    });
  });

  it("skips child issue creation when the operator declines", () => {
    const policy = new SplitPolicy();

    expect(policy.evaluate(candidates, "no")).toEqual({
      mode: "ask",
      action: "skip",
      approved: false,
      requiresConfirmation: true,
      candidateCount: 1,
      reason: "Operator declined child issue creation.",
    });
  });

  it("treats ambiguous answers as still requiring confirmation", () => {
    const policy = new SplitPolicy();

    expect(policy.evaluate(candidates, "maybe later")).toEqual({
      mode: "ask",
      action: "await-confirmation",
      approved: false,
      requiresConfirmation: true,
      candidateCount: 1,
      reason: "Confirmation was ambiguous; child issue creation remains blocked.",
    });
  });

  it("normalizes common confirmation aliases", () => {
    expect(normalizeConfirmation("sí")).toBe(true);
    expect(normalizeConfirmation("declined")).toBe(false);
    expect(normalizeConfirmation("later")).toBeNull();
  });
});
