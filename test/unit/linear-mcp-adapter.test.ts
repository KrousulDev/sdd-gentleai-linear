import { LinearMcpAdapter } from "../../src/infrastructure/linear-mcp-adapter";
import { RetryPolicy } from "../../src/infrastructure/retry-policy";

describe("LinearMcpAdapter", () => {
  it("invokes the expected MCP operation for parent issue creation", async () => {
    const invoke = vi.fn().mockResolvedValue({ id: "ENG-300" });
    const adapter = new LinearMcpAdapter(
      { invoke },
      new RetryPolicy({ sleep: async () => undefined, baseDelayMs: 1 }),
    );

    const result = await adapter.createParent({
      sddId: "sdd_005",
      title: "Bootstrap plugin",
      description: "Create the parent issue in Linear.",
    });

    expect(invoke).toHaveBeenCalledWith("linear.createParent", {
      sddId: "sdd_005",
      title: "Bootstrap plugin",
      description: "Create the parent issue in Linear.",
    });
    expect(result).toEqual({
      status: "ok",
      attempts: 1,
      value: { id: "ENG-300" },
    });
  });

  it("surfaces degraded status when MCP retries are exhausted", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("linear offline"));
    const adapter = new LinearMcpAdapter(
      { invoke },
      new RetryPolicy({ sleep: async () => undefined, baseDelayMs: 1 }),
    );

    const result = await adapter.syncStage({
      linearIssueId: "ENG-301",
      linearStage: "In Progress",
    });

    expect(invoke).toHaveBeenCalledTimes(3);
    expect(result.status).toBe("degraded");

    if (result.status !== "degraded") {
      throw new Error("Expected degraded status after retry exhaustion.");
    }

    expect(result.error.message).toBe("linear offline");
  });
});
