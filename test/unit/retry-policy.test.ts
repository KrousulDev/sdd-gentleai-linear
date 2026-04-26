import { RetryPolicy } from "../../src/infrastructure/retry-policy";

describe("RetryPolicy", () => {
  it("returns ok when the operation eventually succeeds", async () => {
    const policy = new RetryPolicy({
      baseDelayMs: 1,
      sleep: async () => undefined,
    });
    let attempts = 0;

    const result = await policy.execute(async () => {
      attempts += 1;

      if (attempts < 3) {
        throw new Error("temporary failure");
      }

      return "ok";
    });

    expect(result).toEqual({
      status: "ok",
      attempts: 3,
      value: "ok",
    });
  });

  it("returns degraded after exhausting retries", async () => {
    const policy = new RetryPolicy({
      baseDelayMs: 1,
      sleep: async () => undefined,
    });

    const result = await policy.execute(async () => {
      throw new Error("mcp unavailable");
    });

    expect(result.status).toBe("degraded");
    expect(result.attempts).toBe(3);

    if (result.status !== "degraded") {
      throw new Error("Expected degraded retry result.");
    }

    expect(result.error.message).toBe("mcp unavailable");
  });
});
