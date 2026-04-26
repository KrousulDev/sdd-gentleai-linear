import {
  GitAdapterError,
  normalizeGitAdapterError,
} from "../../src/infrastructure/git-adapter";

describe("git-adapter", () => {
  it("normalizes unknown commit failures into a typed adapter error", () => {
    const error = normalizeGitAdapterError("fatal: detached HEAD", "commit");

    expect(error).toBeInstanceOf(GitAdapterError);
    expect(error.message).toBe("fatal: detached HEAD");
    expect(error.operation).toBe("commit");
  });

  it("preserves existing typed push failures", () => {
    const original = new GitAdapterError("origin rejected", "push");

    expect(normalizeGitAdapterError(original, "push")).toBe(original);
  });
});
