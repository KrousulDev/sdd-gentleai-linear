import type {
  ArchiveEvidence,
  ArchiveEvidenceAssertion,
  SddStage,
  WorkflowState,
} from "../domain/workflow-state";
import type { EngramRepository } from "../infrastructure/engram-repository";
import type {
  CreateParentInput,
  LinearAdapterResult,
  LinearIssueRef,
  LinearMcpAdapter,
  LinkParentInput,
} from "../infrastructure/linear-mcp-adapter";
import type { PluginEventName } from "./plugin-events";
import {
  clearWorkflowGateReasons,
  evaluateArchivePreparation,
  evaluateStageTransition,
  type WorkflowGuardDecision,
} from "./guards/verify-archive-guard";
import { StageMapper } from "./stage-mapper";
import {
  validateDualIdCommitMessage,
  type DualIdValidationResult,
} from "./dual-id-validator";
import { SplitPolicy, type SplitCandidate, type SplitDecision } from "./split-policy";

export interface PluginRuntimePolicies {
  taskSplitMode: "ask";
  reverseSync: false;
  backgroundJobs: false;
  degradedRetryStrategy: "inline-retry-then-mark-degraded";
  archiveTraceability: "dual-id";
  canonicalWriteRequirement: "engram-and-linear-mcp";
  unsupportedContextBehavior: "fail-closed";
}

export interface ArchiveEvidenceAssertionResult extends ArchiveEvidenceAssertion {
  sddId: string;
  linearIssueId: string;
  archiveStatus: WorkflowState["gates"]["archive"];
}

export interface PluginRuntimeOptions {
  splitPolicy?: SplitPolicy;
  workflowRepository?: EngramRepository;
  linearAdapter?: LinearMcpAdapter;
  stageMapper?: StageMapper;
  now?: () => string;
}

export interface ParentIssueOperationInput extends CreateParentInput {
  at?: string;
  stage?: SddStage;
}

export interface LinkParentOperationInput extends LinkParentInput {
  at?: string;
  stage?: SddStage;
}

export interface SyncStageOperationInput {
  sddId: string;
  stage: SddStage;
  at?: string;
  trigger?: PluginEventName | string;
}

export interface PublishSummaryOperationInput {
  sddId: string;
  summary: string;
  at?: string;
}

export interface ArchiveGuardOperationInput {
  sddId: string;
  evidence: ArchiveEvidence;
}

export interface RuntimeOperationResult<T> {
  state: WorkflowState;
  mirror?: LinearAdapterResult<T>;
}

export class WorkflowGateError extends Error {
  constructor(
    message: string,
    public readonly decision: WorkflowGuardDecision,
  ) {
    super(message);
    this.name = "WorkflowGateError";
  }
}

export class PluginRuntime {
  private readonly splitPolicy: SplitPolicy;
  private readonly workflowRepository: EngramRepository | undefined;
  private readonly linearAdapter: LinearMcpAdapter | undefined;
  private readonly stageMapper: StageMapper;
  private readonly now: () => string;

  constructor(options: PluginRuntimeOptions = {}) {
    this.splitPolicy = options.splitPolicy ?? new SplitPolicy();
    this.workflowRepository = options.workflowRepository;
    this.linearAdapter = options.linearAdapter;
    this.stageMapper = options.stageMapper ?? new StageMapper();
    this.now = options.now ?? (() => new Date().toISOString());
  }

  describePolicies(): PluginRuntimePolicies {
    return {
      taskSplitMode: this.splitPolicy.mode,
      reverseSync: false,
      backgroundJobs: false,
      degradedRetryStrategy: "inline-retry-then-mark-degraded",
      archiveTraceability: "dual-id",
      canonicalWriteRequirement: "engram-and-linear-mcp",
      unsupportedContextBehavior: "fail-closed",
    };
  }

  evaluateSplitRequest(
    candidates: SplitCandidate[],
    confirmation?: string,
  ): SplitDecision {
    return this.splitPolicy.evaluate(candidates, confirmation);
  }

  isOperational(): boolean {
    return Boolean(this.workflowRepository && this.linearAdapter);
  }

  validateArchiveEvidence(input: {
    sddId: string;
    linearIssueId: string | null;
    commitMessage: ArchiveEvidence["commitMessage"];
  }): DualIdValidationResult {
    return validateDualIdCommitMessage({
      trace: {
        sddId: input.sddId,
        linearIssueId: input.linearIssueId,
      },
      commitMessage: input.commitMessage,
    });
  }

  async queryArchiveEvidenceAssertion(
    sddId: string,
  ): Promise<ArchiveEvidenceAssertionResult | null> {
    const repository = this.requireRepository();
    const state = await repository.getBySddId(sddId);

    if (!state?.archiveEvidence || !state.linearIssueId) {
      return null;
    }

    return {
      sddId: state.sddId,
      linearIssueId: state.linearIssueId,
      archiveStatus: state.gates.archive,
      ...state.archiveEvidence,
    };
  }

  async enforceArchivePreparation(input: ArchiveGuardOperationInput): Promise<WorkflowState> {
    const repository = this.requireRepository();
    const state = await repository.ensureState({ sddId: input.sddId });
    const decision = evaluateArchivePreparation(state, input.evidence);

    const nextState = await this.persistGuardDecision(state, decision, {
      archive: decision.allowed ? "ready" : state.gates.archive,
    });

    if (!decision.allowed) {
      throw new WorkflowGateError(
        decision.blockingReasons.join(" "),
        decision,
      );
    }

    const archiveEvidence = this.buildArchiveEvidenceAssertion(nextState, input.evidence);

    return repository.recordArchiveEvidence(input.sddId, archiveEvidence);
  }

  async createParentIssue(
    input: ParentIssueOperationInput,
  ): Promise<RuntimeOperationResult<LinearIssueRef>> {
    const repository = this.requireRepository();
    const adapter = this.requireLinearAdapter();

    await repository.ensureState({
      sddId: input.sddId,
      ...(input.stage ? { stage: input.stage } : {}),
    });

    const mirror = await adapter.createParent(input);

    if (mirror.status === "degraded") {
      return {
        state: await repository.markSyncDegraded(input.sddId, {
          error: mirror.error.message,
          at: input.at ?? this.now(),
          operation: "parent.create",
        }),
        mirror,
      };
    }

    return {
      state: await repository.linkParentIssue(input.sddId, {
        linearIssueId: mirror.value.id,
        activity: {
          at: input.at ?? this.now(),
          kind: "parent.create",
          summary: `Created Linear parent ${mirror.value.id}.`,
        },
      }),
      mirror,
    };
  }

  async linkParentIssue(
    input: LinkParentOperationInput,
  ): Promise<RuntimeOperationResult<LinearIssueRef>> {
    const repository = this.requireRepository();
    const adapter = this.requireLinearAdapter();

    await repository.ensureState({
      sddId: input.sddId,
      linearIssueId: input.linearIssueId,
      ...(input.stage ? { stage: input.stage } : {}),
    });

    const mirror = await adapter.linkParent(input);

    if (mirror.status === "degraded") {
      return {
        state: await repository.markSyncDegraded(input.sddId, {
          linear: input.linearIssueId,
          error: mirror.error.message,
          at: input.at ?? this.now(),
          operation: "parent.link",
        }),
        mirror,
      };
    }

    return {
      state: await repository.linkParentIssue(input.sddId, {
        linearIssueId: input.linearIssueId,
        activity: {
          at: input.at ?? this.now(),
          kind: "parent.link",
          summary: `Linked Linear parent ${input.linearIssueId}.`,
        },
      }),
      mirror,
    };
  }

  async syncCanonicalStage(
    input: SyncStageOperationInput,
  ): Promise<RuntimeOperationResult<void>> {
    const repository = this.requireRepository();
    const state = await repository.ensureState({
      sddId: input.sddId,
    });
    const preparedState =
      input.stage === "done" && state.gates.archive === "ready"
        ? await repository.upsertState({
            ...state,
            gates: {
              ...state.gates,
              archive: "done",
            },
            gateReasons: clearWorkflowGateReasons(state.gateReasons, ["archive"]),
          })
        : state;
    const guardDecision = evaluateStageTransition(preparedState, input.stage);

    const guardedState = await this.persistGuardDecision(preparedState, guardDecision);

    if (!guardDecision.allowed) {
      throw new WorkflowGateError(guardDecision.blockingReasons.join(" "), guardDecision);
    }

    const transitionedState =
      guardedState.stage === input.stage
        ? guardedState
        : await repository.transitionStage(input.sddId, {
            at: input.at ?? this.now(),
            to: input.stage,
            trigger: input.trigger ?? "runtime.syncStage",
          });

    if (!transitionedState.linearIssueId) {
      return { state: transitionedState };
    }

    const linearStage = this.stageMapper.map(transitionedState.stage);
    const mirror = await this.requireLinearAdapter().syncStage({
      linearIssueId: transitionedState.linearIssueId,
      linearStage,
    });

    if (mirror.status === "degraded") {
      return {
        state: await repository.markSyncDegraded(input.sddId, {
          linear: transitionedState.linearIssueId,
          error: mirror.error.message,
          at: input.at ?? this.now(),
          operation: "stage.sync",
        }),
        mirror,
      };
    }

    await repository.markSyncOk(input.sddId, linearStage);

    return {
      state: await repository.appendActivity(input.sddId, {
        at: input.at ?? this.now(),
        kind: "stage.sync",
        summary: `Mirrored canonical stage ${transitionedState.stage} to Linear stage ${linearStage}.`,
      }),
      mirror,
    };
  }

  async publishCompactSummary(
    input: PublishSummaryOperationInput,
  ): Promise<RuntimeOperationResult<void>> {
    const repository = this.requireRepository();
    const state = await repository.ensureState({ sddId: input.sddId });
    const compactSummary = compactSummaryText(input.summary);
    const stateWithActivity = await repository.appendActivity(input.sddId, {
      at: input.at ?? this.now(),
      kind: "summary.publish",
      summary: compactSummary,
    });

    if (!stateWithActivity.linearIssueId) {
      return { state: stateWithActivity };
    }

    const mirror = await this.requireLinearAdapter().publishSummary({
      linearIssueId: stateWithActivity.linearIssueId,
      summary: compactSummary,
    });

    if (mirror.status === "degraded") {
      return {
        state: await repository.markSyncDegraded(input.sddId, {
          linear: stateWithActivity.linearIssueId,
          error: mirror.error.message,
          at: input.at ?? this.now(),
          operation: "summary.publish",
        }),
        mirror,
      };
    }

    return {
      state: await repository.markSyncOk(input.sddId, stateWithActivity.linearIssueId),
      mirror,
    };
  }

  private requireRepository(): EngramRepository {
    if (!this.workflowRepository) {
      throw new Error("Plugin runtime requires an Engram repository.");
    }

    return this.workflowRepository;
  }

  private requireLinearAdapter(): LinearMcpAdapter {
    if (!this.linearAdapter) {
      throw new Error("Plugin runtime requires a Linear MCP adapter.");
    }

    return this.linearAdapter;
  }

  private buildArchiveEvidenceAssertion(
    state: WorkflowState,
    evidence: ArchiveEvidence,
  ): ArchiveEvidenceAssertion {
    const validation = this.validateArchiveEvidence({
      sddId: state.sddId,
      linearIssueId: state.linearIssueId,
      commitMessage: evidence.commitMessage,
    });

    if (!validation.valid || !validation.expectedToken || !state.linearIssueId) {
      throw new Error("Cannot persist archive evidence without a validated dual-ID assertion.");
    }

    return {
      commitMessage: evidence.commitMessage,
      ...(evidence.commitSha ? { commitSha: evidence.commitSha } : {}),
      pushed: evidence.pushed,
      expectedToken: validation.expectedToken,
      assertedAt: this.now(),
    };
  }

  private async persistGuardDecision(
    state: WorkflowState,
    decision: WorkflowGuardDecision,
    gateOverrides?: Partial<WorkflowState["gates"]>,
  ): Promise<WorkflowState> {
    const repository = this.requireRepository();
    const nextState: WorkflowState = {
      ...state,
      gates: {
        ...state.gates,
        ...gateOverrides,
      },
      gateReasons: decision.allowed
        ? clearWorkflowGateReasons(state.gateReasons)
        : {
            ...clearWorkflowGateReasons(state.gateReasons),
            ...decision.gateReasons,
          },
    };

    return repository.upsertState(nextState);
  }
}

export function createPluginRuntime(options?: PluginRuntimeOptions): PluginRuntime {
  return new PluginRuntime(options);
}

function compactSummaryText(summary: string): string {
  return summary.trim().replace(/\s+/g, " ");
}
