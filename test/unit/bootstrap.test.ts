import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import plugin, {
  classifyRuntimeContext,
  createLinearPluginContract,
  createLinearPluginHooks,
} from "../../.opencode/plugins/linear-plugin-mvp";
import {
  linearPluginToolNames,
  observedPluginEvents,
  workflowGuardNames,
} from "../../src/application/plugin-events";

describe("linear plugin bootstrap", () => {
  it("exposes the minimum plugin contract", () => {
    const contract = createLinearPluginContract();

    expect(plugin.id).toBe("linear-plugin-mvp");
    expect(typeof plugin.server).toBe("function");
    expect(contract.name).toBe("linear-plugin-mvp");
    expect(contract.version).toBe("0.1.0");
    expect(contract.capabilities.canonicalStore).toBe("engram");
    expect(contract.capabilities.syncDirection).toBe("sdd-to-linear");
    expect(contract.capabilities.taskSplitMode).toBe("ask");
    expect(contract.hardGuards).toEqual([...workflowGuardNames]);
    expect(contract.observedEvents).toEqual([...observedPluginEvents]);
    expect(contract.tools.map((tool) => tool.name)).toEqual([...linearPluginToolNames]);
    expect(contract.runtime).toEqual({
      taskSplitMode: "ask",
      reverseSync: false,
      backgroundJobs: false,
      degradedRetryStrategy: "inline-retry-then-mark-degraded",
      archiveTraceability: "dual-id",
      canonicalWriteRequirement: "engram-and-linear-mcp",
      unsupportedContextBehavior: "fail-closed",
    });
  });

  it("classifies runtime contexts explicitly and fail-closes partial environments", () => {
    expect(
      classifyRuntimeContext({
        app: { log: vi.fn() },
        engram: {},
        mcp: { linear: { invoke: vi.fn() } },
      } as never),
    ).toEqual({
      status: "full",
      reason: "ready",
      hasEngram: true,
      hasLinearMcp: true,
      canWriteCanonical: true,
      canMirrorToLinear: true,
    });

    expect(classifyRuntimeContext({ app: { log: vi.fn() } } as never)).toEqual({
      status: "unsupported",
      reason: "missing-both",
      hasEngram: false,
      hasLinearMcp: false,
      canWriteCanonical: false,
      canMirrorToLinear: false,
    });

    expect(
      classifyRuntimeContext({
        app: { log: vi.fn() },
        engram: {},
      } as never),
    ).toEqual({
      status: "partial",
      reason: "missing-linear-mcp",
      hasEngram: true,
      hasLinearMcp: false,
      canWriteCanonical: false,
      canMirrorToLinear: false,
    });

    expect(
      classifyRuntimeContext({
        app: { log: vi.fn() },
        mcp: { linear: { invoke: vi.fn() } },
      } as never),
    ).toEqual({
      status: "partial",
      reason: "missing-engram",
      hasEngram: false,
      hasLinearMcp: true,
      canWriteCanonical: false,
      canMirrorToLinear: false,
    });
  });

  it("registers the plugin and minimum Linear MCP", () => {
    const configPath = resolve(process.cwd(), "opencode.json");
    const rawConfig = readFileSync(configPath, "utf8");
    const config = JSON.parse(rawConfig) as {
      plugin?: string[];
      mcp?: {
        linear?: {
          type?: string;
          url?: string;
          enabled?: boolean;
        };
      };
    };

    expect(config.plugin).toContain("./.opencode/plugins/linear-plugin-mvp.ts");
    expect(config.mcp?.linear).toEqual({
      type: "remote",
      url: "https://mcp.linear.app/mcp",
      enabled: true,
    });
  });

  it("registers only the verified MVP hooks and logs through the server contract", async () => {
    const log = vi.fn().mockResolvedValue(undefined);

    const hooks = await plugin.server({
      client: {
        app: { log },
      },
    } as never);

    expect(Object.keys(hooks)).toEqual([...observedPluginEvents]);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          service: "linear-plugin-mvp",
          level: "info",
          message: "plugin loaded",
          extra: expect.objectContaining({
            runtime: expect.objectContaining({
              taskSplitMode: "ask",
              reverseSync: false,
            }),
            runtimeClassification: expect.objectContaining({
              status: "unsupported",
              reason: "missing-both",
            }),
          }),
        }),
      }),
    );

    const directHooks = createLinearPluginHooks({
      app: { log },
    } as never);

    expect(Object.keys(directHooks)).toEqual([...observedPluginEvents]);
  });

  it("fails closed for mirroring when the runtime context is unsupported", async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const invoke = vi.fn();

    const hooks = await plugin.server({
      client: {
        app: { log },
        mcp: {
          linear: { invoke },
        },
      },
    } as never);

    const toolExecuteAfter = hooks["tool.execute.after"]! as (
      input: unknown,
      ctx?: unknown,
    ) => Promise<void>;

    await expect(
      toolExecuteAfter({
        tool: "syncStage",
        result: {
          sddId: "sdd_unsupported",
          stage: "implement",
        },
      } as never, undefined),
    ).resolves.toBeUndefined();

    expect(invoke).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          message: "observed tool.execute.after",
          extra: expect.objectContaining({
            tool: "syncStage",
            status: "runtime-unavailable",
            classification: expect.objectContaining({
              status: "partial",
              reason: "missing-engram",
            }),
          }),
        }),
      }),
    );
  });

  it("fails closed without canonical writes when Engram exists but Linear MCP is missing", async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const engram = {
      get: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue(undefined),
    };

    const hooks = await plugin.server({
      client: {
        app: { log },
        engram,
      },
    } as never);

    const toolExecuteAfter = hooks["tool.execute.after"]! as (
      input: unknown,
      ctx?: unknown,
    ) => Promise<void>;

    await expect(
      toolExecuteAfter({
        tool: "createParent",
        result: {
          sddId: "sdd_partial",
          title: "Should not write",
          description: "Linear MCP is missing.",
        },
      } as never, undefined),
    ).resolves.toBeUndefined();

    expect(engram.get).not.toHaveBeenCalled();
    expect(engram.upsert).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          message: "observed tool.execute.after",
          extra: expect.objectContaining({
            tool: "createParent",
            status: "runtime-unavailable",
            classification: expect.objectContaining({
              status: "partial",
              reason: "missing-linear-mcp",
            }),
          }),
        }),
      }),
    );
  });

  it("blocks mirror writes in the missing-both unsupported runtime without side effects", async () => {
    const log = vi.fn().mockResolvedValue(undefined);

    const hooks = await plugin.server({
      client: {
        app: { log },
      },
    } as never);

    const toolExecuteAfter = hooks["tool.execute.after"]! as (
      input: unknown,
      ctx?: unknown,
    ) => Promise<void>;

    await expect(
      toolExecuteAfter({
        tool: "publishSummary",
        result: {
          sddId: "sdd_missing_both",
          summary: "Should never publish.",
        },
      } as never, undefined),
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          message: "observed tool.execute.after",
          extra: expect.objectContaining({
            tool: "publishSummary",
            status: "runtime-unavailable",
            classification: expect.objectContaining({
              status: "unsupported",
              reason: "missing-both",
              canWriteCanonical: false,
              canMirrorToLinear: false,
            }),
          }),
        }),
      }),
    );
  });

  it("rejects archive commands in the missing-both unsupported runtime before any state mutation", async () => {
    const log = vi.fn().mockResolvedValue(undefined);

    const hooks = await plugin.server({
      client: {
        app: { log },
      },
    } as never);

    const commandExecuteBefore = hooks["command.execute.before"]! as (
      input: unknown,
      ctx?: unknown,
    ) => Promise<void>;

    await expect(
      commandExecuteBefore({
        command: "archive",
        input: {
          sddId: "sdd_missing_both",
          commitMessage: "feat: archive workflow (ENG-999 | sdd_missing_both)",
          commitSha: "abc999",
          pushed: true,
        },
      } as never, undefined),
    ).rejects.toThrow(
      'Archive guard is fail-closed because runtime context "missing-both" does not satisfy the required Engram + Linear MCP pairing.',
    );
  });
});
