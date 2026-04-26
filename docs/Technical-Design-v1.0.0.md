# Technical Design — SDD Linear Integration Plugin (MVP v1.0.0)

> Basado en [PRD v1.0.0](./prd/PRD-v1.0.0.md), [ADR v1.0.0](./adr/ADR-v1.0.0.md) y [E2E Flow v1.0.0](./flows/E2E-Flow-v1.0.0.md)

---

## 1. Objetivo

Definir el diseño técnico del MVP para implementar el plugin de OpenCode que sincroniza el workflow SDD de gentle-ai con Linear usando el MCP remoto oficial, manteniendo a Engram como store canónico y respetando los gates de `verify` y `archive`.

Este documento baja el PRD/ADR a decisiones ejecutables de ingeniería: componentes, contratos, hooks, flujo de datos, modelo de estado, estrategia de errores y secuencia de implementación.

---

## 2. Alcance del MVP

### Incluye
- Plugin local de OpenCode en TypeScript.
- Bootstrap del plugin y logging estructurado.
- Estado canónico del workflow en Engram.
- Mapping SDD → Linear.
- Create/link de issue padre.
- Task splitting en `mode=ask`.
- Sync de stages relevantes hacia Linear.
- Publicación de comentarios compactos en Linear.
- Bloqueo de `review` si `verify` falla.
- Bloqueo de `done` si `archive` no fue ejecutado.
- Commit/push con dual-ID en `archive`.
- Operación degradada con retry y reporte de sync.

### Excluye
- Sync inverso desde Linear.
- Edición directa del workflow desde UI.
- Dashboard avanzado.
- Integración TUI completa desde el día 1; la superficie visual en sidebar existente queda como incremento controlado.
- Cliente API custom de Linear paralelo al MCP.
- Publicación npm del plugin antes de cerrar el MVP 0.1.0.

---

## 3. Principios de diseño

1. **Source of truth único**: el estado real vive en Engram.
2. **Linear como espejo operativo**: muestra progreso, no gobierna el workflow.
3. **Plugin adapter, no orchestrator**: reacciona al flujo de gentle-ai/OpenCode; no inventa fases.
4. **Host-first**: usar capacidades oficiales de OpenCode (plugin hooks, MCP remoto, OAuth) antes de crear infraestructura paralela.
5. **Guards duros**: `verify` y `archive` son reglas del sistema.
6. **Degradación segura**: si Linear falla, el estado canónico no se corrompe.
7. **Trazabilidad explícita**: `sddId`, `linearIssueId` y commit dual-ID deben estar conectados extremo a extremo.

---

## 4. Arquitectura propuesta

## 4.1 Vista de runtime

```text
gentle-ai / OpenCode Orchestrator
        ↓
   OpenCode Plugin Hooks
        ↓
 Application Services
        ↓
 Domain Workflow State
        ↓
 ┌───────────────────────┬───────────────────────┐
 │ Engram Repository     │ Linear MCP Adapter    │
 │ (canónico)            │ (operacional)         │
 └───────────────────────┴───────────────────────┘
        ↓
   Git / host environment
```

## 4.2 Separación por capas

### Plugin layer
Responsable de:
- bootstrap del plugin,
- registro de hooks,
- logging estructurado,
- adaptación desde eventos OpenCode hacia servicios de aplicación.

### Application layer
Responsable de:
- decidir qué operación de sync corresponde,
- aplicar guards,
- orquestar Engram + Linear + Git,
- transformar eventos del host en casos de uso del dominio.

### Domain layer
Responsable de:
- representar `WorkflowState`,
- gates, stages y actividad,
- invariantes del workflow,
- funciones puras de transición.

### Infrastructure layer
Responsable de:
- persistencia Engram,
- llamadas al MCP de Linear,
- retry policy,
- adaptadores al entorno de ejecución.

---

## 5. Estructura de módulos

## 5.1 Estructura actual detectada

```text
.opencode/plugins/
  linear-plugin-mvp.ts
src/
  application/
    stage-mapper.ts
  domain/
    workflow-state.ts
  infrastructure/
    engram-repository.ts
    linear-mcp-adapter.ts
    retry-policy.ts
```

## 5.2 Estructura objetivo del MVP

```text
.opencode/plugins/
  linear-plugin-mvp.ts
src/
  application/
    commands/
      bootstrap-plugin.ts
      create-or-link-parent.ts
      sync-stage.ts
      split-tasks.ts
      publish-summary.ts
      verify-gate.ts
      archive-gate.ts
    services/
      workflow-sync-service.ts
      linear-summary-service.ts
    stage-mapper.ts
  domain/
    workflow-state.ts
    workflow-guards.ts
    workflow-events.ts
    archive-evidence.ts
  infrastructure/
    engram-repository.ts
    linear-mcp-adapter.ts
    git-adapter.ts
    retry-policy.ts
    opencode-log-adapter.ts
```

### Nota
No hace falta crear todo junto. Pero esta estructura marca la dirección correcta del MVP: separar casos de uso, dominio e infraestructura para que el plugin no se convierta en una bolsa de lógica acoplada.

---

## 6. Modelo de estado

## 6.1 Estado canónico

El modelo base ya está representado por `WorkflowState` en `src/domain/workflow-state.ts`:

```ts
interface WorkflowState {
  sddId: string
  linearIssueId: string | null
  stage: SddStage
  childIssueIds: string[]
  gates: {
    verify: VerifyGate
    archive: ArchiveGate
  }
  activity: WorkflowActivity[]
  lastSync: {
    linear?: string
    status: "ok" | "degraded"
  }
}
```

## 6.2 Extensiones sugeridas para MVP

Agregar sin romper compatibilidad:
- `parentIssueId` como alias explícito si hace falta distinguirlo de otros links.
- `archiveEvidence?: { commitMessage; commitSha; pushed }`
- `lastSync.error?: string` para operación degradada.
- `pendingTaskSplit?: boolean` si queremos rastrear que se pidió confirmación.

## 6.3 Topic key en Engram

Se mantiene la convención ya detectada:

```ts
workflowStateTopicKey(sddId) => `sdd/workflow-state/${sddId}`
```

---

## 7. Contratos técnicos

## 7.1 Plugin contract (OpenCode)

El plugin debe cumplir el contrato oficial de OpenCode:

```ts
import type { Plugin } from "@opencode-ai/plugin"

export const LinearPlugin: Plugin = async ({ client, project, directory, worktree, $ }) => {
  return {
    // hooks
  }
}
```

### Reglas
- export principal compatible con `Plugin`
- logging con `client.app.log()`
- cero polling arbitrario
- cero dependencia en orquestación paralela propia

## 7.2 Engram repository contract

Ya existe una interfaz base:

```ts
interface EngramTopicStore {
  get<T>(topicKey: string): Promise<T | null>
  upsert<T>(topicKey: string, value: T): Promise<T>
}
```

Se propone extenderla con operaciones auxiliares si hacen falta:
- `appendActivity`
- `markSyncDegraded`
- `recordArchiveEvidence`

## 7.3 Linear adapter contract

El adapter actual ya modela bien las operaciones candidatas del MVP:
- `createParent`
- `linkParent`
- `syncStage`
- `publishSummary`
- `createChild`

### Regla de diseño
El adapter no debe exponer semántica de OpenCode ni semántica de Engram. Solo operaciones de Linear con payloads claros y resultados con retry.

## 7.4 Git adapter contract

Agregar un adapter explícito para evitar meter shell suelto en el plugin:

```ts
interface GitAdapter {
  commit(message: string): Promise<{ sha: string }>
  push(): Promise<void>
}
```

Esto permite:
- testear archive sin shell real,
- desacoplar commit/push del hook,
- centralizar errores de Git.

---

## 8. Hooks de OpenCode para el MVP

## 8.1 Hooks mínimos aprobados

### `command.execute.before`
Uso:
- detectar comandos del flujo como `sdd-init`, `sdd-verify`, `sdd-archive`
- anotar intención operativa antes de la ejecución

### `tool.execute.before`
Uso:
- enriquecer contexto de operaciones del plugin si hace falta,
- validar precondiciones antes de tools custom futuras.

### `tool.execute.after`
Uso:
- reaccionar al resultado de operaciones que impactan el workflow,
- registrar sync o degradación.

### `experimental.session.compacting`
Uso:
- preservar contexto mínimo del workflow en compaction si hiciera falta.

## 8.2 Hooks no prioritarios en MVP

No meter de entrada salvo necesidad concreta:
- `chat.message`
- `chat.params`
- `provider`
- `auth`
- hooks TUI avanzados

¿Por qué? Porque el MVP necesita trazabilidad y guards, no una locura cósmica de extensibilidad prematura.

## 8.3 Superficie visual futura en sidebar existente

Cuando el core del plugin ya esté estable, la UI debe montarse sobre el **sidebar existente de OpenCode**, no creando un sidebar paralelo.

### Slots TUI relevantes
- `sidebar_title`
- `sidebar_content`
- `sidebar_footer`

### Estrategia recomendada
- Mantener el MVP inicial en modo conservador: logs + estado canónico + summaries.
- Agregar después un bloque visual mínimo dentro de `sidebar_content`.
- No editar el workflow desde la UI en MVP.

### Contenido sugerido del bloque
- `SDD ID`
- `Linear ID` + link al issue padre
- `Stage`
- `Verify gate`
- `Archive gate`
- `Sync status`
- últimas 3 actividades
- lista visible de `child issues` con key + link

### Mock conceptual del bloque

```text
┌──────────────────────────────────────────────┐
│ SDD Linear Plugin                            │
│ SDD ID:    sdd_001                           │
│ Linear:    ENG-123 → open                    │
│ Stage:     implement                         │
│ Verify:    success                           │
│ Archive:   ready                             │
│ Sync:      ok                                │
│                                              │
│ Child issues                                 │
│ • ENG-124 → open                             │
│ • ENG-125 → open                             │
│ • ENG-126 → open                             │
│ +2 more                                      │
└──────────────────────────────────────────────┘
```

### Shape de datos UI sugerido

```ts
interface WorkflowSidebarLink {
  id: string
  url: string
}

interface WorkflowSidebarViewModel {
  sddId: string
  parent: WorkflowSidebarLink | null
  stage: SddStage
  verify: VerifyGate
  archive: ArchiveGate
  syncStatus: SyncStatus
  childIssues: WorkflowSidebarLink[]
  recentActivity: Array<{
    at: string
    summary: string
  }>
}
```

### Regla de rendering
- Mostrar el issue padre por key (`ENG-123`) y con acción/link `open`.
- Mostrar child issues individualmente, no solo el conteo.
- Si hay muchos child issues, renderizar los primeros 3 y luego `+N more`.
- La URL debe derivarse de los datos persistidos/sincronizados, no hardcodearse en la vista.

### Regla
La UI del sidebar debe ser una **vista derivada** del estado canónico en Engram. Nunca una fuente alternativa de verdad.

---

## 9. Flujo técnico por caso de uso

## 9.1 Bootstrap del plugin

### Objetivo
Verificar que el plugin cargó y dejar trazabilidad operativa mínima.

### Pasos
1. OpenCode resuelve `plugin` desde config o `.opencode/plugins/`.
2. Ejecuta `LinearPlugin`.
3. El plugin crea su contract/config interna.
4. Emite `client.app.log()` con nombre, versión y capabilities base.
5. Devuelve hooks activos.

### Resultado
- confirmación de carga real,
- base para debug del MVP.

## 9.2 Create/link parent issue

### Trigger
Inicio del flujo SDD o explicitación del usuario.

### Secuencia
1. Resolver `sddId`.
2. Consultar Engram por estado existente.
3. Si no hay `linearIssueId`, decidir create vs link.
4. Llamar `LinearMcpAdapter.createParent()` o `.linkParent()`.
5. Persistir `linearIssueId` en Engram.
6. Publicar comentario inicial en Linear con `sddId`.
7. Registrar actividad local.

### Invariante
No debe quedar parent creado en Linear sin persistencia posterior en Engram. Si falla el upsert, el flujo queda degradado y debe registrarse.

## 9.3 Sync de stage

### Trigger
Cambio de `stage` del workflow.

### Secuencia
1. Leer estado canónico desde Engram.
2. Validar que el stage sea permitido por `StageMapper`.
3. Aplicar guardas antes de sync:
   - `review` requiere `verify = success`
   - `done` requiere `archive = done`
4. Mapear a estado Linear.
5. Llamar `LinearMcpAdapter.syncStage()`.
6. Registrar actividad resumida.
7. Actualizar `lastSync`.

### Resultado degradado
Si Linear falla:
- Engram mantiene stage canónico,
- `lastSync.status = degraded`,
- se registra error,
- no se revierte el dominio.

## 9.4 Task splitting en `mode=ask`

### Trigger
Fase `tasks` con subtareas detectadas.

### Secuencia
1. El flujo detecta tasks candidatas.
2. El plugin marca necesidad de confirmación.
3. Solo con respuesta afirmativa del usuario:
   - crear child issues,
   - persistir `childIssueIds`,
   - publicar resumen compacto.

### Regla
Nunca crear child issues automáticamente en MVP.

## 9.5 Verify gate

### Trigger
Resultado de `sdd-verify`.

### Resultado OK
- `verify = success`
- `archive = ready`
- habilitar sync a `review`

### Resultado FAIL
- `verify = failed`
- `archive = locked`
- bloquear sync a `review`
- mostrar causa visible en superficie del plugin

## 9.6 Archive gate

### Trigger
Ejecución de `sdd-archive`.

### Secuencia
1. Leer estado canónico.
2. Verificar `verify = success`.
3. Construir commit message dual-ID.
4. Ejecutar commit.
5. Ejecutar push.
6. Persistir `archiveEvidence`.
7. Pasar `archive = done`.
8. Sincronizar `done` en Linear.
9. Publicar resumen final compacto.

### Regla
Si commit o push fallan:
- NO marcar `archive = done`
- NO sync a `Done`
- registrar degradación

---

## 10. Mapping y guards

## 10.1 Mapping SDD → Linear

| Stage SDD | Estado Linear |
|-----------|---------------|
| `spec` | Backlog |
| `plan` | Todo |
| `tasks` | Todo |
| `implement` | In Progress |
| `review` | In Review |
| `done` | Done |

La clase `StageMapper` ya modela esto correctamente y permite override por configuración.

## 10.2 Guard matrix ejecutable

| Acción | Regla |
|--------|------|
| Sync a `review` | requiere `verify = success` |
| Ejecutar archive | requiere `verify = success` |
| Sync a `done` | requiere `archive = done` |
| Crear child issues | requiere confirmación explícita |

Esto debería terminar encapsulado en `workflow-guards.ts` como funciones puras.

---

## 11. Estrategia de errores y degradación

## 11.1 Retry policy

`RetryPolicy` actual:
- `maxAttempts = 3`
- `baseDelayMs = 100`
- `maxDelayMs = 400`

Está bien para MVP. No tocaría eso por ahora.

## 11.2 Casos degradados admitidos

- falla de red contra Linear MCP
- timeout del MCP
- issue ya existente / conflicto de link
- error en publicación de comentario

## 11.2.1 Clasificación explícita de contexto runtime

Antes de ejecutar hooks con efectos, el plugin clasifica el contexto:

- `full` → Engram + Linear MCP presentes
- `partial` → solo uno de los dos presente
- `unsupported` → ninguno presente

Regla conservadora del batch de hardening: cualquier contexto distinto de `full` queda en **fail-closed** y NO puede escribir estado canónico ni espejar a Linear.

## 11.3 Casos no admitidos

- archive exitoso sin commit/push real
- stage `review` con verify fallido
- Linear `Done` sin `archive = done`

## 11.4 Comportamiento deseado

Cuando falle infraestructura externa:
1. conservar Engram correcto
2. marcar `lastSync.status = degraded`
3. emitir log estructurado
4. permitir reintento futuro

---

## 12. Configuración

## 12.1 `opencode.json`

Durante desarrollo local se acepta referencia local en `plugin` porque ya fue verificada en runtime.

### Política de artifacts SDD
- El artifact store activo del proyecto es **Engram**.
- Proposal, spec, design, tasks y apply-progress deben leerse/escribirse en Engram.
- OpenSpec NO forma parte del flujo activo de este proyecto y no debe reutilizarse como fuente paralela.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./.opencode/plugins/linear-plugin-mvp.ts"],
  "mcp": {
    "linear": {
      "type": "remote",
      "url": "https://mcp.linear.app/mcp",
      "enabled": true
    }
  }
}
```

## 12.2 Publicación futura

Cuando se cierre el MVP `0.1.0`, el plugin debe publicarse en npm y la config debe migrar a:

```json
{
  "plugin": ["@scope/sdd-gentleai-linear"]
}
```

## 12.3 Tools por agente

Para no inflar contexto, el subset de tools de Linear debe quedar habilitado preferentemente para:
- agente principal/orchestrator de trabajo SDD,
- o agentes específicos del flujo donde haga sentido.

No dejar todas las tools abiertas indiscriminadamente si no hace falta.

---

## 13. Testing strategy

## 13.1 Tests unitarios

Cubrir:
- `StageMapper`
- transiciones de `WorkflowState`
- guards de verify/archive
- retry policy
- composición de commit message dual-ID

## 13.2 Tests de integración

Cubrir con fakes/mocks:
- `EngramRepository`
- `LinearMcpAdapter`
- `GitAdapter`
- flujo de create/link y sync de stage

## 13.3 Prueba E2E documental

El flujo fuente ya está en:
- `docs/flows/E2E-Flow-v1.0.0.md`

Ese documento manda sobre el flujo esperado de aceptación.

## 13.4 Cobertura como evidencia informativa

`test:coverage` se define como evidencia operativa local, no como gate duro adicional.

- produce artifacts V8 locales para inspección,
- no reemplaza `verify`,
- no desbloquea `archive`,
- y no introduce política nueva de aprobación por porcentaje en este MVP.

---

## 14. Plan de implementación sugerido

### Fase 1 — Base operativa
1. Consolidar `WorkflowState` y helpers de dominio.
2. Agregar `workflow-guards.ts`.
3. Agregar `GitAdapter`.
4. Mantener bootstrap/log del plugin.

### Fase 2 — Parent issue + estado canónico
5. Implementar caso de uso create/link parent.
6. Persistir `linearIssueId` y actividad en Engram.
7. Publicar comentario inicial.

### Fase 3 — Sync operativo
8. Implementar `sync-stage` con `StageMapper` + guards.
9. Marcar degradación cuando falle el MCP.
10. Publicar summary compacto.

### Fase 4 — Tasks / verify / archive
11. Implementar task split con confirmación.
12. Implementar verify gate.
13. Implementar archive gate + commit/push + dual-ID.
14. Sync final a `Done`.

### Fase 5 — Hardening
15. Afinar subset de tools por agente.
16. Completar tests unitarios/integración.
17. Validar el flujo completo contra el E2E documental.

---

## 15. Decisiones abiertas

1. ¿Qué tool names reales del MCP de Linear vamos a invocar exactamente desde el adapter?
2. ¿Cómo vamos a detectar de forma robusta los eventos del flujo SDD en OpenCode: por comando, por tool o por ambos?
3. ¿En qué iteración exacta entra la superficie TUI en `sidebar_content` una vez estable el core del plugin?
4. ¿El commit final siempre lo dispara el plugin o se delega parcialmente a la skill de archive?
5. ¿El paquete npm final llevará scope privado del usuario u organización?

---

## 16. Resumen ejecutivo técnico

La implementación recomendada para el MVP es una arquitectura simple y limpia:
- **plugin OpenCode TS** como capa de entrada,
- **servicios de aplicación** para reglas del flujo,
- **dominio explícito** para estado y guards,
- **Engram** como canónico,
- **Linear MCP** como espejo operativo,
- **Git** como evidencia final de cierre.

Si agregamos UI, será sobre el sidebar existente de OpenCode y como vista derivada del estado en Engram, no como una segunda fuente de control.

No hay que inventar otra plataforma. Hay que conectar bien las piezas reales que ya tenemos. Es así de fácil.
