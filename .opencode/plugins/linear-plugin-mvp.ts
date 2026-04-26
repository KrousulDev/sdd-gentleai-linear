import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin";
import {
  linearPluginToolNames,
  observedPluginEvents,
  workflowGuardNames,
  type LinearPluginToolName,
  type PluginEventName,
} from "../../src/application/plugin-events";
import { createPluginRuntime, type PluginRuntimePolicies } from "../../src/application/plugin-runtime";
import { StageMapper } from "../../src/application/stage-mapper";
import { createWorkflowState, type ArchiveEvidence } from "../../src/domain/workflow-state";
import { EngramRepository, type EngramTopicStore } from "../../src/infrastructure/engram-repository";
import {
  LinearMcpAdapter,
  type LinearMcpClient,
} from "../../src/infrastructure/linear-mcp-adapter";

const PLUGIN_NAME = "linear-plugin-mvp";
const PLUGIN_VERSION = "0.1.0";

export interface LinearPluginTool {
  name: LinearPluginToolName;
  description: string;
}

export interface LinearPluginContract {
  name: typeof PLUGIN_NAME;
  version: string;
  capabilities: {
    canonicalStore: "engram";
    syncDirection: "sdd-to-linear";
    taskSplitMode: "ask";
  };
  hardGuards: Array<(typeof workflowGuardNames)[number]>;
  observedEvents: Array<PluginEventName>;
  tools: LinearPluginTool[];
  bootstrap: {
    initialStateStage: ReturnType<typeof createWorkflowState>["stage"];
    defaultLinearStage: string;
  };
  runtime: PluginRuntimePolicies;
}

export function createLinearPluginContract(): LinearPluginContract {
  const stageMapper = new StageMapper();
  const initialState = createWorkflowState({ sddId: "bootstrap" });
  const runtime = createPluginRuntime();

  return {
    name: PLUGIN_NAME,
    version: PLUGIN_VERSION,
    capabilities: {
      canonicalStore: "engram",
      syncDirection: "sdd-to-linear",
      taskSplitMode: "ask",
    },
    hardGuards: [...workflowGuardNames],
    observedEvents: [...observedPluginEvents],
    tools: [
      {
        name: linearPluginToolNames[0],
        description: "Create a parent Linear issue for an SDD workflow.",
      },
      {
        name: linearPluginToolNames[1],
        description: "Link an existing Linear parent issue to an SDD workflow.",
      },
      {
        name: linearPluginToolNames[2],
        description: "Mirror the canonical SDD stage into Linear.",
      },
      {
        name: linearPluginToolNames[3],
        description: "Publish a compact operational summary to Linear.",
      },
    ],
    bootstrap: {
      initialStateStage: initialState.stage,
      defaultLinearStage: stageMapper.map(initialState.stage),
    },
    runtime: runtime.describePolicies(),
  };
}

type PluginClient = Parameters<Plugin>[0]["client"];
type RuntimeReadyClient = PluginClient & {
  engram?: EngramTopicStore;
  mcp?: {
    linear?: LinearMcpClient;
  };
};

type VerifiedHooks = Pick<Hooks, PluginEventName>;

export type RuntimeContextStatus = "full" | "partial" | "unsupported";

export interface RuntimeContextClassification {
  status: RuntimeContextStatus;
  reason:
    | "ready"
    | "missing-linear-mcp"
    | "missing-engram"
    | "missing-both";
  hasEngram: boolean;
  hasLinearMcp: boolean;
  canWriteCanonical: boolean;
  canMirrorToLinear: boolean;
}

interface ResolvedRuntimeContext {
  classification: RuntimeContextClassification;
  runtime: ReturnType<typeof createPluginRuntime> | null;
}

export function createLinearPluginHooks(
  client: PluginClient,
  runtimeContext = resolveRuntimeContext(client),
): VerifiedHooks {
  return {
    [observedPluginEvents[0]]: async (input) => {
      await handleRuntimeCommandEvent(runtimeContext, input as Record<string, unknown>);

      await logPluginEvent(client, observedPluginEvents[0], {
        sessionID: input.sessionID,
        command: input.command,
      });
    },
    [observedPluginEvents[1]]: async (input) => {
      await logPluginEvent(client, observedPluginEvents[1], {
        sessionID: input.sessionID,
        tool: input.tool,
        callID: input.callID,
      });
    },
    [observedPluginEvents[2]]: async (input) => {
      await logPluginEvent(client, observedPluginEvents[2], {
        sessionID: input.sessionID,
        tool: input.tool,
        callID: input.callID,
      });

      const handled = await handleRuntimeToolEvent(runtimeContext, input as Record<string, unknown>);

      if (handled === "runtime-unavailable") {
        await logPluginEvent(client, observedPluginEvents[2], {
          tool: input.tool,
          status: "runtime-unavailable",
          classification: runtimeContext.classification,
        });
      }
    },
    [observedPluginEvents[3]]: async (input) => {
      await logPluginEvent(client, observedPluginEvents[3], {
        sessionID: input.sessionID,
      });
    },
  };
}

export const LinearPluginServer: Plugin = async ({ client }) => {
  const contract = createLinearPluginContract();
  const runtimeContext = resolveRuntimeContext(client);

  await client.app.log({
    body: {
      service: PLUGIN_NAME,
      level: "info",
      message: "plugin loaded",
      extra: {
        version: contract.version,
        canonicalStore: contract.capabilities.canonicalStore,
        syncDirection: contract.capabilities.syncDirection,
        observedEvents: contract.observedEvents,
        runtime: contract.runtime,
        runtimeAvailable: runtimeContext.runtime?.isOperational() ?? false,
        runtimeClassification: runtimeContext.classification,
      },
    },
  });

  return createLinearPluginHooks(client, runtimeContext);
};

export const linearPluginModule = {
  id: PLUGIN_NAME,
  server: LinearPluginServer,
} satisfies PluginModule;

async function logPluginEvent(
  client: PluginClient,
  event: PluginEventName,
  extra: Record<string, unknown>,
): Promise<void> {
  await client.app.log({
    body: {
      service: PLUGIN_NAME,
      level: "debug",
      message: `observed ${event}`,
      extra,
    },
  });
}

export function classifyRuntimeContext(client: PluginClient): RuntimeContextClassification {
  const runtimeClient = client as RuntimeReadyClient;
  const hasEngram = Boolean(runtimeClient.engram);
  const hasLinearMcp = Boolean(runtimeClient.mcp?.linear);

  if (hasEngram && hasLinearMcp) {
    return {
      status: "full",
      reason: "ready",
      hasEngram,
      hasLinearMcp,
      canWriteCanonical: true,
      canMirrorToLinear: true,
    };
  }

  if (hasEngram) {
    return {
      status: "partial",
      reason: "missing-linear-mcp",
      hasEngram,
      hasLinearMcp,
      canWriteCanonical: false,
      canMirrorToLinear: false,
    };
  }

  if (hasLinearMcp) {
    return {
      status: "partial",
      reason: "missing-engram",
      hasEngram,
      hasLinearMcp,
      canWriteCanonical: false,
      canMirrorToLinear: false,
    };
  }

  return {
    status: "unsupported",
    reason: "missing-both",
    hasEngram,
    hasLinearMcp,
    canWriteCanonical: false,
    canMirrorToLinear: false,
  };
}

function resolveRuntimeContext(client: PluginClient): ResolvedRuntimeContext {
  const classification = classifyRuntimeContext(client);
  const runtimeClient = client as RuntimeReadyClient;

  if (classification.status !== "full") {
    return {
      classification,
      runtime: null,
    };
  }

  return {
    classification,
    runtime: createPluginRuntime({
      workflowRepository: new EngramRepository(runtimeClient.engram as EngramTopicStore),
      linearAdapter: new LinearMcpAdapter(runtimeClient.mcp.linear as LinearMcpClient),
    }),
  };
}

async function handleRuntimeToolEvent(
  runtimeContext: ResolvedRuntimeContext,
  input: Record<string, unknown>,
): Promise<"handled" | "ignored" | "runtime-unavailable"> {
  const toolName = resolveToolName(input.tool);

  if (!toolName || !linearPluginToolNames.includes(toolName as LinearPluginToolName)) {
    return "ignored";
  }

  if (!runtimeContext.runtime) {
    return "runtime-unavailable";
  }

  const payload = resolveRuntimePayload(input);
  const runtime = runtimeContext.runtime;

  switch (toolName) {
    case "createParent": {
      if (!isCreateParentPayload(payload)) {
        return "ignored";
      }

      await runtime.createParentIssue(payload);
      return "handled";
    }
    case "linkParent": {
      if (!isLinkParentPayload(payload)) {
        return "ignored";
      }

      await runtime.linkParentIssue(payload);
      return "handled";
    }
    case "syncStage": {
      if (!isSyncStagePayload(payload)) {
        return "ignored";
      }

      await runtime.syncCanonicalStage(payload);
      return "handled";
    }
    case "publishSummary": {
      if (!isPublishSummaryPayload(payload)) {
        return "ignored";
      }

      await runtime.publishCompactSummary(payload);
      return "handled";
    }
  }

  return "ignored";
}

async function handleRuntimeCommandEvent(
  runtimeContext: ResolvedRuntimeContext,
  input: Record<string, unknown>,
): Promise<"handled" | "ignored" | "runtime-unavailable"> {
  const commandName = resolveCommandName(input.command);

  if (!commandName || !isArchiveCommand(commandName)) {
    return "ignored";
  }

  if (!runtimeContext.runtime) {
    throw new Error(
      `Archive guard is fail-closed because runtime context "${runtimeContext.classification.reason}" does not satisfy the required Engram + Linear MCP pairing.`,
    );
  }

  const payload = resolveRuntimePayload(input);

  if (!isArchiveGuardPayload(payload)) {
    throw new Error(
      'Archive guard requires an evidence payload with at least { sddId }.',
    );
  }

  await runtimeContext.runtime.enforceArchivePreparation({
    sddId: payload.sddId,
    evidence: buildArchiveEvidencePayload(payload),
  });

  return "handled";
}

function resolveToolName(tool: unknown): string | null {
  if (typeof tool === "string") {
    return tool;
  }

  if (tool && typeof tool === "object" && "name" in tool && typeof tool.name === "string") {
    return tool.name;
  }

  return null;
}

function resolveCommandName(command: unknown): string | null {
  if (typeof command === "string") {
    return command;
  }

  if (command && typeof command === "object" && "name" in command && typeof command.name === "string") {
    return command.name;
  }

  return null;
}

function resolveRuntimePayload(input: Record<string, unknown>): Record<string, unknown> {
  const candidates = [input.output, input.result, input.response, input.arguments, input.input, input.body];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      return candidate as Record<string, unknown>;
    }
  }

  return {};
}

function isCreateParentPayload(payload: Record<string, unknown>): payload is {
  sddId: string;
  title: string;
  description: string;
  at?: string;
} {
  return (
    typeof payload.sddId === "string" &&
    typeof payload.title === "string" &&
    typeof payload.description === "string"
  );
}

function isLinkParentPayload(payload: Record<string, unknown>): payload is {
  sddId: string;
  linearIssueId: string;
  at?: string;
} {
  return typeof payload.sddId === "string" && typeof payload.linearIssueId === "string";
}

function isSyncStagePayload(payload: Record<string, unknown>): payload is {
  sddId: string;
  stage: ReturnType<typeof createWorkflowState>["stage"];
  at?: string;
  trigger?: string;
} {
  return typeof payload.sddId === "string" && typeof payload.stage === "string";
}

function isPublishSummaryPayload(payload: Record<string, unknown>): payload is {
  sddId: string;
  summary: string;
  at?: string;
} {
  return typeof payload.sddId === "string" && typeof payload.summary === "string";
}

function isArchiveCommand(commandName: string): boolean {
  return ["archive", "sdd-archive"].includes(commandName);
}

function isArchiveGuardPayload(payload: Record<string, unknown>): payload is {
  sddId: string;
  commitMessage?: ArchiveEvidence["commitMessage"];
  commitSha?: string;
  pushed?: boolean;
} {
  return (
    typeof payload.sddId === "string" &&
    (payload.commitMessage === undefined || typeof payload.commitMessage === "string") &&
    (payload.commitSha === undefined || typeof payload.commitSha === "string") &&
    (payload.pushed === undefined || typeof payload.pushed === "boolean")
  );
}

function buildArchiveEvidencePayload(payload: {
  commitMessage?: string;
  commitSha?: string;
  pushed?: boolean;
}): ArchiveEvidence {
  return {
    commitMessage: payload.commitMessage ?? "",
    ...(payload.commitSha ? { commitSha: payload.commitSha } : {}),
    pushed: payload.pushed === true,
  };
}

export default linearPluginModule;
