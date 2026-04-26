import plugin from "../../.opencode/plugins/linear-plugin-mvp";
import { workflowStateTopicKey, type WorkflowState } from "../../src/domain/workflow-state";
import {
  buildArchiveEvidenceFailureMessages,
  createWorkflowStateFixture,
  InMemoryTopicStore,
} from "../setup";

describe("plugin flow integration", () => {
  it("creates the parent, syncs the canonical stage one-way, and publishes a compact summary", async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const store = new InMemoryTopicStore();
    const invoke = vi.fn(async (operation: string, payload: Record<string, unknown>) => {
      switch (operation) {
        case "linear.createParent":
          return { id: "ENG-400" };
        case "linear.syncStage":
        case "linear.publishSummary":
          return undefined;
        default:
          throw new Error(`Unexpected operation: ${operation} with ${JSON.stringify(payload)}`);
      }
    });

    const hooks = await plugin.server({
      client: {
        app: { log },
        engram: store,
        mcp: {
          linear: { invoke },
        },
      },
    } as never);
    const toolExecuteAfter = hooks["tool.execute.after"]! as (
      input: unknown,
      ctx?: unknown,
    ) => Promise<void>;

    await toolExecuteAfter({
      tool: "createParent",
      result: {
        sddId: "sdd_300",
        title: "Mirror workflow",
        description: "Create the canonical parent issue.",
        at: "2026-04-25T21:00:00.000Z",
      },
    } as never, undefined);

    await toolExecuteAfter({
      tool: "syncStage",
      result: {
        sddId: "sdd_300",
        stage: "implement",
        at: "2026-04-25T21:01:00.000Z",
      },
    } as never, undefined);

    await toolExecuteAfter({
      tool: "publishSummary",
      result: {
        sddId: "sdd_300",
        summary: "  Runtime   summary   stays compact.  ",
        at: "2026-04-25T21:02:00.000Z",
      },
    } as never, undefined);

    const state = await store.get<WorkflowState>(workflowStateTopicKey("sdd_300"));

    expect(state).toMatchObject({
      sddId: "sdd_300",
      linearIssueId: "ENG-400",
      stage: "implement",
      lastSync: {
        status: "ok",
        pendingRetry: false,
        linear: "ENG-400",
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(1, "linear.createParent", {
      sddId: "sdd_300",
      title: "Mirror workflow",
      description: "Create the canonical parent issue.",
      at: "2026-04-25T21:00:00.000Z",
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "linear.syncStage", {
      linearIssueId: "ENG-400",
      linearStage: "In Progress",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "linear.publishSummary", {
      linearIssueId: "ENG-400",
      summary: "Runtime summary stays compact.",
    });
    expect(state?.activity).toEqual([
      {
        at: "2026-04-25T21:00:00.000Z",
        kind: "parent.create",
        summary: "Created Linear parent ENG-400.",
      },
      {
        at: "2026-04-25T21:01:00.000Z",
        kind: "stage.sync",
        summary: "Mirrored canonical stage implement to Linear stage In Progress.",
      },
      {
        at: "2026-04-25T21:02:00.000Z",
        kind: "summary.publish",
        summary: "Runtime summary stays compact.",
      },
    ]);
  });

  it("marks sync as degraded after retry exhaustion without rolling back canonical stage progress", async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const store = new InMemoryTopicStore();
    await store.upsert(
      workflowStateTopicKey("sdd_301"),
      createWorkflowStateFixture(
        {
          sddId: "sdd_301",
          stage: "implement",
        },
        {
          gates: {
            verify: "success",
            archive: "locked",
          },
        },
      ) satisfies WorkflowState,
    );
    const invoke = vi.fn(async (operation: string) => {
      if (operation === "linear.linkParent") {
        return { id: "ENG-401" };
      }

      throw new Error("linear offline");
    });

    const hooks = await plugin.server({
      client: {
        app: { log },
        engram: store,
        mcp: {
          linear: { invoke },
        },
      },
    } as never);
    const toolExecuteAfter = hooks["tool.execute.after"]! as (
      input: unknown,
      ctx?: unknown,
    ) => Promise<void>;

    await toolExecuteAfter({
      tool: "linkParent",
      result: {
        sddId: "sdd_301",
        linearIssueId: "ENG-401",
        at: "2026-04-25T21:05:00.000Z",
      },
    } as never, undefined);

    await toolExecuteAfter({
      tool: "syncStage",
      result: {
        sddId: "sdd_301",
        stage: "review",
        at: "2026-04-25T21:06:00.000Z",
      },
    } as never, undefined);

    const state = await store.get<WorkflowState>(workflowStateTopicKey("sdd_301"));

    expect(invoke).toHaveBeenCalledTimes(4);
    expect(state).toMatchObject({
      sddId: "sdd_301",
      linearIssueId: "ENG-401",
      stage: "review",
      lastSync: {
        status: "degraded",
        pendingRetry: false,
        linear: "ENG-401",
        error: "linear offline",
      },
    });
    expect(state?.activity.at(-1)).toEqual({
      at: "2026-04-25T21:06:00.000Z",
      kind: "stage.sync.degraded",
      summary: "linear offline",
    });
  });

  it("ignores reverse-sync style manual edits coming back from Linear responses", async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const store = new InMemoryTopicStore();
    await store.upsert(
      workflowStateTopicKey("sdd_301b"),
      createWorkflowStateFixture({
        sddId: "sdd_301b",
        linearIssueId: "ENG-401B",
        stage: "tasks",
      }) satisfies WorkflowState,
    );
    const invoke = vi.fn(async (operation: string) => {
      if (operation === "linear.syncStage") {
        return {
          stage: "Todo",
          title: "Manual edit from Linear",
          labels: ["edited-outside-sdd"],
        };
      }

      return undefined;
    });

    const hooks = await plugin.server({
      client: {
        app: { log },
        engram: store,
        mcp: {
          linear: { invoke },
        },
      },
    } as never);
    const toolExecuteAfter = hooks["tool.execute.after"]! as (
      input: unknown,
      ctx?: unknown,
    ) => Promise<void>;

    await toolExecuteAfter({
      tool: "syncStage",
      result: {
        sddId: "sdd_301b",
        stage: "implement",
        at: "2026-04-25T21:07:00.000Z",
      },
    } as never, undefined);

    const state = await store.get<WorkflowState>(workflowStateTopicKey("sdd_301b"));

    expect(invoke).toHaveBeenCalledWith("linear.syncStage", {
      linearIssueId: "ENG-401B",
      linearStage: "In Progress",
    });
    expect(state).toMatchObject({
      sddId: "sdd_301b",
      linearIssueId: "ENG-401B",
      stage: "implement",
      lastSync: {
        status: "ok",
        pendingRetry: false,
        linear: "In Progress",
      },
    });
    expect(state).not.toHaveProperty("labels");
    expect(state).not.toHaveProperty("title");
  });

  it("blocks archive commands through the real command guard path when dual-ID evidence is invalid", async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const store = new InMemoryTopicStore();
    await store.upsert(
      workflowStateTopicKey("sdd_302"),
      createWorkflowStateFixture(
        {
          sddId: "sdd_302",
          linearIssueId: "ENG-402",
          stage: "review",
        },
        {
          gates: {
            verify: "success",
            archive: "locked",
          },
        },
      ) satisfies WorkflowState,
    );
    const failures = buildArchiveEvidenceFailureMessages({
      linearIssueId: "ENG-402",
      sddId: "sdd_302",
    });

    const hooks = await plugin.server({
      client: {
        app: { log },
        engram: store,
        mcp: {
          linear: { invoke: vi.fn() },
        },
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
          sddId: "sdd_302",
          commitMessage: "feat: archive workflow",
          pushed: false,
        },
      } as never, undefined),
    ).rejects.toThrow(
      failures.combined,
    );

    const state = await store.get<WorkflowState>(workflowStateTopicKey("sdd_302"));

    expect(state?.gateReasons.archive).toBe(failures.combined);
  });

  it("persists queryable dual-ID evidence across the archive-ready to done path", async () => {
    const log = vi.fn().mockResolvedValue(undefined);
    const store = new InMemoryTopicStore();
    await store.upsert(
      workflowStateTopicKey("sdd_303"),
      createWorkflowStateFixture(
        {
          sddId: "sdd_303",
          linearIssueId: "ENG-403",
          stage: "review",
        },
        {
          gates: {
            verify: "success",
            archive: "locked",
          },
        },
      ) satisfies WorkflowState,
    );
    const invoke = vi.fn(async () => undefined);

    const hooks = await plugin.server({
      client: {
        app: { log },
        engram: store,
        mcp: {
          linear: { invoke },
        },
      },
    } as never);
    const commandExecuteBefore = hooks["command.execute.before"]! as (
      input: unknown,
      ctx?: unknown,
    ) => Promise<void>;
    const toolExecuteAfter = hooks["tool.execute.after"]! as (
      input: unknown,
      ctx?: unknown,
    ) => Promise<void>;

    await commandExecuteBefore({
      command: "archive",
      input: {
        sddId: "sdd_303",
        commitMessage: "feat: archive workflow (ENG-403 | sdd_303)",
        commitSha: "abc123",
        pushed: true,
      },
    } as never, undefined);
    await toolExecuteAfter({
      tool: "syncStage",
      result: {
        sddId: "sdd_303",
        stage: "done",
        at: "2026-04-25T21:10:00.000Z",
      },
    } as never, undefined);

    const state = await store.get<WorkflowState>(workflowStateTopicKey("sdd_303"));

    expect(state).toMatchObject({
      gates: {
        verify: "success",
        archive: "done",
      },
      archiveEvidence: {
        commitMessage: "feat: archive workflow (ENG-403 | sdd_303)",
        commitSha: "abc123",
        pushed: true,
        expectedToken: "(ENG-403 | sdd_303)",
      },
    });
  });
});
