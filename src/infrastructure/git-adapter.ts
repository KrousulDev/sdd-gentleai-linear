export interface GitCommitResult {
  sha: string;
}

export interface GitAdapter {
  commit(message: string): Promise<GitCommitResult>;
  push(): Promise<void>;
}

export class GitAdapterError extends Error {
  constructor(
    message: string,
    public readonly operation: "commit" | "push",
  ) {
    super(message);
    this.name = "GitAdapterError";
  }
}

export function normalizeGitAdapterError(
  error: unknown,
  operation: "commit" | "push",
): GitAdapterError {
  if (error instanceof GitAdapterError) {
    return error;
  }

  if (error instanceof Error) {
    return new GitAdapterError(error.message, operation);
  }

  return new GitAdapterError(
    typeof error === "string" ? error : `Unknown git ${operation} failure.`,
    operation,
  );
}
