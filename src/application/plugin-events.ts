export const pluginEventNames = {
  commandExecuteBefore: "command.execute.before",
  toolExecuteBefore: "tool.execute.before",
  toolExecuteAfter: "tool.execute.after",
  experimentalSessionCompacting: "experimental.session.compacting",
} as const;

export type PluginEventName =
  (typeof pluginEventNames)[keyof typeof pluginEventNames];

export const observedPluginEvents = [
  pluginEventNames.commandExecuteBefore,
  pluginEventNames.toolExecuteBefore,
  pluginEventNames.toolExecuteAfter,
  pluginEventNames.experimentalSessionCompacting,
] as const satisfies readonly PluginEventName[];

export const linearPluginToolNames = [
  "createParent",
  "linkParent",
  "syncStage",
  "publishSummary",
] as const;

export type LinearPluginToolName = (typeof linearPluginToolNames)[number];

export const workflowGuardNames = ["verify", "archive"] as const;

export type WorkflowGuardName = (typeof workflowGuardNames)[number];
