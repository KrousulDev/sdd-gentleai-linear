import {
  createPluginRuntime,
  WorkflowGateError,
} from "../../src/application/plugin-runtime";
import { EngramRepository } from "../../src/infrastructure/engram-repository";
import { LinearMcpAdapter } from "../../src/infrastructure/linear-mcp-adapter";
import { RetryPolicy } from "../../src/infrastructure/retry-policy";
import {
  buildArchiveEvidenceFailureMessages,
  createArchiveEvidenceFixture,
  createWorkflowStateFixture,
  InMemoryTopicStore,
} from "../setup";

describe("plugin-runtime", () => {
  it("describes the conservative MVP runtime policies", () => {
    const runtime = createPluginRuntime();

    expect(runtime.describePolicies()).toEqual({
      taskSplitMode: "ask",
      reverseSync: false,
      backgroundJobs: false,
      degradedRetryStrategy: "inline-retry-then-mark-degraded",
      archiveTraceability: "dual-id",
      canonicalWriteRequirement: "engram-and-linear-mcp",
      unsupportedContextBehavior: "fail-closed",
    });
  });

  it("delegates split confirmation decisions through the ask-mode policy", () => {
    const runtime = createPluginRuntime();

    expect(
      runtime.evaluateSplitRequest([
        {
          title: "Task 1",
          description: "Split candidate",
        },
      ]),
    ).toEqual(
      expect.objectContaining({
        mode: "ask",
        action: "await-confirmation",
      }),
    );
  });

  it("validates archive commit messages against the required dual-ID token", () => {
    const runtime = createPluginRuntime();

    expect(
      runtime.validateArchiveEvidence({
        sddId: "sdd_001",
        linearIssueId: "ENG-123",
        commitMessage: "feat: close workflow (ENG-123 | sdd_001)",
      }),
    ).toEqual({
      valid: true,
      missingFields: [],
      blockingReasons: [],
      expectedToken: "(ENG-123 | sdd_001)",
    });

    expect(
      runtime.validateArchiveEvidence({
        sddId: "sdd_001",
        linearIssueId: null,
        commitMessage: "feat: close workflow",
      }),
    ).toEqual({
      valid: false,
      missingFields: ["linearIssueId"],
      blockingReasons: ["Missing dual-ID fields: linearIssueId."],
      reason: "Missing dual-ID fields: linearIssueId.",
    });
  });

  it("blocks archive preparation when dual-ID evidence is incomplete", async () => {
    const store = new InMemoryTopicStore();
    const repository = new EngramRepository(store);
    await repository.upsertState({
      ...createWorkflowStateFixture({
        sddId: "sdd_010",
        linearIssueId: "ENG-010",
        stage: "review",
      }),
      gates: {
        verify: "success",
        archive: "locked",
      },
    });

    const failures = buildArchiveEvidenceFailureMessages({
      linearIssueId: "ENG-010",
      sddId: "sdd_010",
    });

    const invoke = vi.fn().mockResolvedValue(undefined);
    const runtime = createPluginRuntime({
      workflowRepository: repository,
      linearAdapter: new LinearMcpAdapter(
        { invoke },
        new RetryPolicy({ sleep: async () => undefined, baseDelayMs: 1 }),
      ),
    });

    await expect(
      runtime.enforceArchivePreparation({
        sddId: "sdd_010",
        evidence: createArchiveEvidenceFixture(
          { linearIssueId: "ENG-010", sddId: "sdd_010" },
          {
            omitCommitSha: true,
            overrides: {
              commitMessage: "feat: archive workflow",
              pushed: false,
            },
          },
        ),
      }),
    ).rejects.toMatchObject({
      name: "WorkflowGateError",
      message: failures.combined,
      decision: {
        gateReasons: {
          archive: failures.combined,
        },
      },
    });

    await expect(repository.getBySddId("sdd_010")).resolves.toMatchObject({
      gateReasons: {
        archive: failures.combined,
      },
    });
  });

  it("marks archive as ready when verify has passed and evidence is valid", async () => {
    const store = new InMemoryTopicStore();
    const repository = new EngramRepository(store);
    await repository.upsertState({
      ...createWorkflowStateFixture({
        sddId: "sdd_011",
        linearIssueId: "ENG-011",
        stage: "review",
      }),
      gates: {
        verify: "success",
        archive: "locked",
      },
      gateReasons: {
        archive: "stale reason",
      },
    });

    const invoke = vi.fn().mockResolvedValue(undefined);
    const runtime = createPluginRuntime({
      workflowRepository: repository,
      linearAdapter: new LinearMcpAdapter(
        { invoke },
        new RetryPolicy({ sleep: async () => undefined, baseDelayMs: 1 }),
      ),
    });

    await expect(
      runtime.enforceArchivePreparation({
        sddId: "sdd_011",
        evidence: createArchiveEvidenceFixture({
          linearIssueId: "ENG-011",
          sddId: "sdd_011",
        }),
      }),
    ).resolves.toMatchObject({
      gates: {
        verify: "success",
        archive: "ready",
      },
      archiveEvidence: {
        commitMessage: "feat: archive workflow (ENG-011 | sdd_011)",
        commitSha: "abc123",
        expectedToken: "(ENG-011 | sdd_011)",
        pushed: true,
      },
      gateReasons: {},
    });
  });

  it("exposes persisted dual-ID archive evidence through a queryable assertion path", async () => {
    const store = new InMemoryTopicStore();
    const repository = new EngramRepository(store);
    await repository.upsertState({
      ...createWorkflowStateFixture({
        sddId: "sdd_011a",
        linearIssueId: "ENG-011A",
        stage: "review",
      }),
      gates: {
        verify: "success",
        archive: "locked",
      },
    });

    const runtime = createPluginRuntime({
      workflowRepository: repository,
      linearAdapter: new LinearMcpAdapter(
        { invoke: vi.fn().mockResolvedValue(undefined) },
        new RetryPolicy({ sleep: async () => undefined, baseDelayMs: 1 }),
      ),
      now: () => "2026-04-25T22:00:30.000Z",
    });

    await runtime.enforceArchivePreparation({
      sddId: "sdd_011a",
      evidence: createArchiveEvidenceFixture({
        linearIssueId: "ENG-011A",
        sddId: "sdd_011a",
      }),
    });
    await runtime.syncCanonicalStage({
      sddId: "sdd_011a",
      stage: "done",
      at: "2026-04-25T22:01:00.000Z",
    });

    await expect(runtime.queryArchiveEvidenceAssertion("sdd_011a")).resolves.toEqual({
      sddId: "sdd_011a",
      linearIssueId: "ENG-011A",
      archiveStatus: "done",
      commitMessage: "feat: archive workflow (ENG-011A | sdd_011a)",
      commitSha: "abc123",
      expectedToken: "(ENG-011A | sdd_011a)",
      pushed: true,
      assertedAt: "2026-04-25T22:00:30.000Z",
    });
  });

  it("completes the explicit archive path to done after archive preparation succeeds", async () => {
    const store = new InMemoryTopicStore();
    const repository = new EngramRepository(store);
    await repository.upsertState({
      ...createWorkflowStateFixture({
        sddId: "sdd_011b",
        linearIssueId: "ENG-011B",
        stage: "review",
      }),
      gates: {
        verify: "success",
        archive: "locked",
      },
    });

    const invoke = vi.fn().mockResolvedValue(undefined);
    const runtime = createPluginRuntime({
      workflowRepository: repository,
      linearAdapter: new LinearMcpAdapter(
        { invoke },
        new RetryPolicy({ sleep: async () => undefined, baseDelayMs: 1 }),
      ),
    });

    await runtime.enforceArchivePreparation({
      sddId: "sdd_011b",
      evidence: createArchiveEvidenceFixture({
        linearIssueId: "ENG-011B",
        sddId: "sdd_011b",
      }),
    });

    await expect(
      runtime.syncCanonicalStage({
        sddId: "sdd_011b",
        stage: "done",
        at: "2026-04-25T22:01:00.000Z",
      }),
    ).resolves.toMatchObject({
      state: {
        stage: "done",
        gates: {
          verify: "success",
          archive: "done",
        },
        lastTransition: {
          from: "review",
          to: "done",
        },
      },
    });
    expect(invoke).toHaveBeenCalledWith("linear.syncStage", {
      linearIssueId: "ENG-011B",
      linearStage: "Done",
    });
  });

  it("uses StageMapper + LinearMcpAdapter for one-way stage sync while preserving canonical state", async () => {
    const store = new InMemoryTopicStore();
    const repository = new EngramRepository(store);
    await repository.upsertState(
      createWorkflowStateFixture({
        sddId: "sdd_020",
        linearIssueId: "ENG-020",
        stage: "tasks",
      }),
    );

    const invoke = vi.fn().mockResolvedValue(undefined);
    const runtime = createPluginRuntime({
      workflowRepository: repository,
      linearAdapter: new LinearMcpAdapter(
        { invoke },
        new RetryPolicy({ sleep: async () => undefined, baseDelayMs: 1 }),
      ),
      now: () => "2026-04-25T22:00:00.000Z",
    });

    const result = await runtime.syncCanonicalStage({
      sddId: "sdd_020",
      stage: "implement",
    });

    expect(invoke).toHaveBeenCalledWith("linear.syncStage", {
      linearIssueId: "ENG-020",
      linearStage: "In Progress",
    });
    expect(result.state.stage).toBe("implement");
    expect(result.state.lastSync).toEqual({
      status: "ok",
      pendingRetry: false,
      linear: "In Progress",
    });
  });

  it("blocks forward stage sync when verify has failed", async () => {
    const store = new InMemoryTopicStore();
    const repository = new EngramRepository(store);
    await repository.upsertState({
      ...createWorkflowStateFixture({
        sddId: "sdd_020b",
        linearIssueId: "ENG-020B",
        stage: "implement",
      }),
      gates: {
        verify: "failed",
        archive: "locked",
      },
    });

    const invoke = vi.fn().mockResolvedValue(undefined);
    const runtime = createPluginRuntime({
      workflowRepository: repository,
      linearAdapter: new LinearMcpAdapter(
        { invoke },
        new RetryPolicy({ sleep: async () => undefined, baseDelayMs: 1 }),
      ),
    });

    await expect(
      runtime.syncCanonicalStage({
        sddId: "sdd_020b",
        stage: "review",
      }),
    ).rejects.toBeInstanceOf(WorkflowGateError);

    expect(invoke).not.toHaveBeenCalled();
    await expect(repository.getBySddId("sdd_020b")).resolves.toMatchObject({
      stage: "implement",
      gateReasons: {
        verify:
          'Cannot enter "review" until verify has passed with status "success".',
      },
    });
  });

  it("does not create a guarded canonical stage before validation on first contact", async () => {
    const store = new InMemoryTopicStore();
    const repository = new EngramRepository(store);
    const invoke = vi.fn().mockResolvedValue(undefined);
    const runtime = createPluginRuntime({
      workflowRepository: repository,
      linearAdapter: new LinearMcpAdapter(
        { invoke },
        new RetryPolicy({ sleep: async () => undefined, baseDelayMs: 1 }),
      ),
    });

    await expect(
      runtime.syncCanonicalStage({
        sddId: "sdd_020c",
        stage: "review",
      }),
    ).rejects.toBeInstanceOf(WorkflowGateError);

    expect(invoke).not.toHaveBeenCalled();
    await expect(repository.getBySddId("sdd_020c")).resolves.toMatchObject({
      stage: "spec",
      gates: {
        verify: "pending",
        archive: "locked",
      },
      gateReasons: {
        verify:
          'Cannot enter "review" until verify has passed with status "success".',
      },
    });
  });

  it("keeps canonical stage authority when Linear reports divergent stage data", async () => {
    const store = new InMemoryTopicStore();
    const repository = new EngramRepository(store);
    await repository.upsertState(
      createWorkflowStateFixture({
        sddId: "sdd_020d",
        linearIssueId: "ENG-020D",
        stage: "tasks",
      }),
    );

    const invoke = vi.fn().mockResolvedValue({
      stage: "Todo",
      manuallyEdited: true,
    });
    const runtime = createPluginRuntime({
      workflowRepository: repository,
      linearAdapter: new LinearMcpAdapter(
        { invoke },
        new RetryPolicy({ sleep: async () => undefined, baseDelayMs: 1 }),
      ),
    });

    const result = await runtime.syncCanonicalStage({
      sddId: "sdd_020d",
      stage: "implement",
    });

    expect(invoke).toHaveBeenCalledWith("linear.syncStage", {
      linearIssueId: "ENG-020D",
      linearStage: "In Progress",
    });
    expect(result.state.stage).toBe("implement");
    expect(result.state.lastSync.linear).toBe("In Progress");
    expect(result.state).not.toHaveProperty("manuallyEdited");
  });

  it("creates and links a parent issue through Engram canonical state", async () => {
    const store = new InMemoryTopicStore();
    const repository = new EngramRepository(store);
    const invoke = vi.fn().mockResolvedValue({ id: "ENG-777" });
    const runtime = createPluginRuntime({
      workflowRepository: repository,
      linearAdapter: new LinearMcpAdapter(
        { invoke },
        new RetryPolicy({ sleep: async () => undefined, baseDelayMs: 1 }),
      ),
      now: () => "2026-04-25T22:05:00.000Z",
    });

    const result = await runtime.createParentIssue({
      sddId: "sdd_021",
      title: "Parent title",
      description: "Create parent.",
    });

    expect(result.state.linearIssueId).toBe("ENG-777");
    expect(result.state.activity).toEqual([
      {
        at: "2026-04-25T22:05:00.000Z",
        kind: "parent.create",
        summary: "Created Linear parent ENG-777.",
      },
    ]);
  });

  it("publishes a compact summary and marks degraded sync when retries exhaust", async () => {
    const store = new InMemoryTopicStore();
    const repository = new EngramRepository(store);
    await repository.upsertState(
      createWorkflowStateFixture({
        sddId: "sdd_022",
        linearIssueId: "ENG-022",
        stage: "review",
      }),
    );

    const invoke = vi.fn().mockRejectedValue(new Error("linear offline"));
    const runtime = createPluginRuntime({
      workflowRepository: repository,
      linearAdapter: new LinearMcpAdapter(
        { invoke },
        new RetryPolicy({ sleep: async () => undefined, baseDelayMs: 1 }),
      ),
      now: () => "2026-04-25T22:10:00.000Z",
    });

    const result = await runtime.publishCompactSummary({
      sddId: "sdd_022",
      summary: "  Keep   this summary compact.  ",
    });

    expect(invoke).toHaveBeenCalledTimes(3);
    expect(result.state.activity[0]).toEqual({
      at: "2026-04-25T22:10:00.000Z",
      kind: "summary.publish",
      summary: "Keep this summary compact.",
    });
    expect(result.state.lastSync).toEqual({
      linear: "ENG-022",
      status: "degraded",
      pendingRetry: false,
      error: "linear offline",
    });
  });
});
