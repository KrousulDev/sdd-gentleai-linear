# Use Cases — SDD Linear Plugin (MVP v1.0.0)

> Complementa `docs/prd/PRD-v1.0.0.md`, `docs/linear-plugin-mvp.md` y `docs/flows/E2E-Flow-v1.0.0.md`.

---

## 1. Objetivo

Documentar los casos de uso principales del plugin en términos de actor, intención, flujo esperado y reglas de negocio.

---

## 2. Actores

- **Developer usando gentle-ai/OpenCode**
- **Tech lead / reviewer**
- **Stakeholder operativo en Linear**
- **Plugin runtime de OpenCode** (actor técnico)

---

## 3. Casos de uso funcionales

## UC-01 — Cargar el plugin en OpenCode

**Actor:** Plugin runtime de OpenCode  
**Objetivo:** Inicializar el plugin y exponer hooks verificados.

### Flujo esperado
1. OpenCode resuelve `opencode.json`.
2. Carga `./.opencode/plugins/linear-plugin-mvp.ts`.
3. El plugin registra solo hooks verificados.
4. Emite log estructurado de bootstrap.

### Reglas
- no crear un segundo orquestador
- no depender de OpenSpec

---

## UC-02 — Clasificar el contexto runtime

**Actor:** Plugin runtime  
**Objetivo:** Decidir si el plugin puede operar o debe fallar cerrado.

### Estados posibles
- `full`
- `partial`
- `unsupported`

### Reglas
- si falta Engram o Linear MCP, no hay canonical writes
- si faltan ambos, no corre ninguna operación guardada

---

## UC-03 — Crear issue padre en Linear

**Actor:** Developer / plugin runtime  
**Objetivo:** Crear el issue padre de un workflow SDD.

### Flujo esperado
1. El runtime recibe una operación `createParent`.
2. Asegura estado canónico mínimo en Engram.
3. Invoca el adapter de Linear MCP.
4. Persiste `linearIssueId`.
5. Registra actividad `parent.create`.

### Resultado
- parent issue creado
- `linearIssueId` persistido

---

## UC-04 — Vincular issue padre existente

**Actor:** Developer / plugin runtime  
**Objetivo:** Asociar un `linearIssueId` existente a un `sddId`.

### Flujo esperado
1. El runtime recibe `linkParent`.
2. Asegura estado canónico.
3. Invoca el adapter de link.
4. Persiste el vínculo.
5. Registra actividad `parent.link`.

---

## UC-05 — Espejar stage canónico a Linear

**Actor:** Plugin runtime  
**Objetivo:** Reflejar el stage actual del workflow en Linear.

### Flujo esperado
1. Lee el estado canónico.
2. Aplica guards.
3. Usa `StageMapper`.
4. Invoca `syncStage` hacia Linear.
5. Marca `lastSync = ok` o `degraded`.

### Reglas
- sync one-way solamente
- no importar cambios manuales desde Linear

---

## UC-06 — Publicar summary compacto

**Actor:** Plugin runtime  
**Objetivo:** Dejar un resumen operativo breve en Linear.

### Flujo esperado
1. Recibe un summary bruto.
2. Lo compacta.
3. Lo registra como actividad canónica.
4. Si existe parent issue, lo publica en Linear.

### Regla
- el summary no reemplaza el estado canónico

---

## UC-07 — Bloquear review cuando verify no pasó

**Actor:** Plugin runtime / reviewer  
**Objetivo:** Impedir transición inválida a `review`.

### Reglas
- `review` requiere `verify = success`
- si `verify = failed`, se bloquea avance
- se persiste `gateReasons.verify`

---

## UC-08 — Bloquear archive cuando falta evidencia dual-ID

**Actor:** Developer / plugin runtime  
**Objetivo:** Impedir archive incompleto o no trazable.

### Reglas
Archive requiere:
- `verify = success`
- `linearIssueId`
- `commitMessage` con token dual-ID
- `commitSha`
- `pushed = true`

### Resultado esperado
- si falta algo: error explícito y `gateReasons.archive`
- si todo está bien: archive puede avanzar a `ready`

---

## UC-09 — Persistir evidencia dual-ID queryable

**Actor:** Plugin runtime / auditor técnico  
**Objetivo:** Poder consultar después del archive la evidencia aceptada.

### Flujo esperado
1. Se valida evidencia dual-ID.
2. Se persiste `archiveEvidence` en el workflow state.
3. Queda queryable por `sddId`.

### Valor
- auditoría técnica
- trazabilidad post-archive

---

## UC-10 — Marcar degradación sin perder progreso canónico

**Actor:** Plugin runtime  
**Objetivo:** Sobrevivir a fallos del MCP sin corromper Engram.

### Flujo esperado
1. Falla una operación de Linear.
2. Se aplican retries inline.
3. Si sigue fallando, no se revierte el canon.
4. `lastSync.status = degraded`
5. se registra actividad `*.degraded`

### Regla
- no hay background jobs en el MVP

---

## UC-11 — Rechazar reverse sync

**Actor:** Plugin runtime  
**Objetivo:** Garantizar que Linear no pisa Engram.

### Regla
- manual edits en Linear no se importan al canon
- el plugin solo refleja desde Engram hacia Linear

---

## UC-12 — Mantener task splitting en `mode=ask`

**Actor:** Developer / plugin runtime  
**Objetivo:** Evitar child issues automáticos sin aprobación.

### Reglas
- por defecto: `await-confirmation`
- si respuesta positiva: `create-child-issues`
- si respuesta negativa: `skip`

---

## 4. Casos de uso operativos

## UO-01 — Validar el runtime local
Usar:
- `opencode debug config`
- `opencode debug wait --print-logs --log-level INFO`

## UO-02 — Ejecutar checks locales
Usar:
- `npm test`
- `npm run typecheck`
- `npm run test:coverage`

## UO-03 — Probar fail-closed
Evidencia en:
- `test/unit/bootstrap.test.ts`

## UO-04 — Probar archive evidence persistida
Evidencia en:
- `test/integration/plugin-flow.test.ts`

---

## 5. No-casos de uso del MVP

Esto NO pertenece a este MVP:
- reverse sync
- sidebar/TUI
- background jobs
- auto split sin confirmación
- publicación npm todavía en ejecución diaria

---

## 6. Pendiente post-MVP

Cuando quede cerrada la release `0.1.0`:
- publicar en npm
- migrar `opencode.json` del path local al package npm
- mantener el recordatorio vivo hasta hacerlo
