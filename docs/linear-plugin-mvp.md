# Linear Plugin MVP — Runtime Operations

## Purpose

This document describes the conservative MVP runtime that mirrors canonical SDD workflow state from Engram into Linear through the native OpenCode TypeScript plugin.

## Canonical Ownership

- **Canonical state:** Engram only.
- **Operational mirror:** Linear only.
- **Sync direction:** SDD/Engram -> Linear.
- **Artifact store in this project:** Engram.

Manual edits in Linear are never imported back into canonical workflow state in this MVP.

## Supported Hooks

The plugin registers only these verified OpenCode hooks:

- `command.execute.before`
- `tool.execute.before`
- `tool.execute.after`
- `experimental.session.compacting`

These hooks back the minimum runtime operations for:

- parent create/link
- stage mirroring
- compact summary publication
- hard gate enforcement before guarded commands

## Runtime Policies

- **Task split mode:** `ask`
- **Reverse sync:** disabled
- **Background jobs:** disabled
- **Degraded retry strategy:** immediate inline retry with the existing retry policy, then mark degraded
- **Archive traceability:** dual-ID required
- **Unsupported context behavior:** fail closed
- **Canonical write requirement:** Engram + Linear MCP must both be present

## Runtime Context Classification

The plugin classifies its runtime before handling guarded commands or mirroring tools:

| Status | Reason | Behavior |
|---|---|---|
| `full` | `ready` | Canonical writes and Linear mirroring are enabled. |
| `partial` | `missing-linear-mcp` | Fail closed: no canonical write, no Linear mirror. |
| `partial` | `missing-engram` | Fail closed: no canonical write, no Linear mirror. |
| `unsupported` | `missing-both` | Fail closed: no guarded runtime operations run. |

When the runtime is not `full`, the plugin emits structured logs with the classification and does not mutate canonical Engram state.

## Hard Gate Rules

`verify` and `archive` are system gates, not UX suggestions.

### Verify gate

- Entering `review` requires `verify = success`.
- If `verify = failed`, forward stage movement is blocked.
- Blocking reason is persisted into canonical `gateReasons.verify`.

Canonical failure message examples:

- `Cannot advance workflow while verify status is "failed".`
- `Cannot enter "review" until verify has passed with status "success".`

### Archive gate

- Archive preparation requires `verify = success`.
- Archive preparation requires a linked `linearIssueId`.
- Archive evidence must include commit traceability metadata before archive can be marked ready.
- Blocking reason is persisted into canonical `gateReasons.archive`.

Canonical failure message examples:

- `Archive is blocked until verify passes with status "success".`
- `Archive is blocked until a linked Linear parent issue exists.`
- `Cannot enter "done" until archive has completed with status "done".`

## Degraded Sync Semantics

When a Linear MCP operation fails:

1. the plugin retries immediately using the existing inline retry policy
2. if retries still fail, canonical progress remains persisted in Engram
3. `lastSync.status` becomes `degraded`
4. `lastSync.pendingRetry` remains `false`
5. the last error is recorded in `lastSync.error`
6. an activity entry is appended with the degraded operation

This MVP does **not** enqueue background recovery jobs or deferred workers.

## Supported Runtime Scope

Included in the MVP runtime:

- create parent Linear issue
- link existing parent Linear issue
- mirror canonical stage to Linear
- publish compact summary comments to Linear
- enforce verify/archive hard gates
- validate archive dual-ID evidence

## Explicit Non-Goals

This batch and MVP do **not** implement:

- reverse sync from Linear into canonical SDD state
- sidebar or TUI workflows
- automatic child issue creation without confirmation
- background jobs, retry queues, or cron-style reconciliation
- a second orchestrator outside gentle-ai/OpenCode
- OpenSpec as an active artifact source

## Archive Evidence and Dual-ID Traceability

Archive evidence must preserve both identifiers:

- `linearIssueId`
- `sddId`

Expected commit token format:

```text
(ENG-123 | sdd_001)
```

Valid commit message example:

```text
feat: archive workflow (ENG-123 | sdd_001)
```

Valid archive evidence example:

```json
{
  "commitMessage": "feat: archive workflow (ENG-123 | sdd_001)",
  "commitSha": "abc123",
  "pushed": true
}
```

The canonical workflow topic now persists a queryable archive evidence assertion containing:

- `commitMessage`
- `commitSha`
- `pushed`
- `expectedToken`
- `assertedAt`

That assertion stays attached to the workflow state after archive reaches `done`, so post-archive verification can prove the final dual-ID token that was accepted.

Canonical failure messages when evidence is incomplete:

- `Commit message must include dual-ID token "(ENG-123 | sdd_001)".`
- `Archive evidence is missing commitSha.`
- `Archive evidence must confirm pushed=true before archive can proceed.`

Combined archive gate failure example:

```text
Commit message must include dual-ID token "(ENG-123 | sdd_001)". Archive evidence is missing commitSha. Archive evidence must confirm pushed=true before archive can proceed.
```

## Operator Test Evidence

- `npm test` remains the primary local regression check.
- `npm run test:coverage` captures raw V8 coverage data under `.coverage/v8` as informational evidence only.
- Coverage output does **not** override or relax the hard `verify` / `archive` gates.
