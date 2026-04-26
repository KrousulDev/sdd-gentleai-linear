# Manual Test Guide — SDD Linear Plugin (MVP v1.0.0)

> Complementa `docs/linear-plugin-mvp.md`, `docs/flows/E2E-Flow-v1.0.0.md` y `docs/Technical-Design-v1.0.0.md`.

---

## 1. Objetivo

Validar manualmente, paso a paso, que el plugin local de OpenCode:

- carga correctamente,
- clasifica bien su contexto runtime,
- respeta el modelo canónico Engram → Linear,
- bloquea operaciones cuando faltan precondiciones,
- conserva trazabilidad dual-ID en archive,
- y mantiene degradación conservadora sin side-effects ocultos.

---

## 2. Precondiciones

### Configuración local
- `opencode.json` debe apuntar al plugin local:

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

### Tooling esperado
- `npm test`
- `npm run typecheck`
- `npm run test:coverage`
- `opencode debug config`
- `opencode debug wait --print-logs --log-level INFO`

### Fuente de verdad
- Artifact store activo: **Engram**
- OpenSpec no participa del flujo activo

---

## 3. Smoke test de carga del plugin

### Paso 1
Ejecutar:

```bash
opencode debug config
```

### Esperado
Debe resolverse el plugin local en la configuración final, equivalente a:

```json
"plugin": ["file:///.../.opencode/plugins/linear-plugin-mvp.ts"]
```

### Paso 2
Ejecutar:

```bash
opencode debug wait --print-logs --log-level INFO
```

### Esperado
Buscar logs equivalentes a:

```text
service=plugin path=file:///.../.opencode/plugins/linear-plugin-mvp.ts loading plugin
service=linear-plugin-mvp ... plugin loaded
```

---

## 4. Validación automática mínima

Ejecutar:

```bash
npm test
npm run typecheck
npm run test:coverage
```

### Esperado
- Tests en verde
- TypeScript sin errores
- Cobertura V8 generada en `.coverage/v8`

### Nota
`test:coverage` es **evidencia informativa**, no gate duro.

---

## 5. Runtime context classification

El plugin usa esta clasificación:

| Status | Reason | Comportamiento |
|---|---|---|
| `full` | `ready` | Puede escribir en Engram y espejar a Linear |
| `partial` | `missing-linear-mcp` | Fail-closed: no canonical write, no mirror |
| `partial` | `missing-engram` | Fail-closed: no canonical write, no mirror |
| `unsupported` | `missing-both` | Fail-closed total |

### Prueba recomendada
Tomar como evidencia estos tests:
- `test/unit/bootstrap.test.ts`
- casos `missing-linear-mcp`, `missing-engram`, `missing-both`

### Esperado
En contextos no `full`:
- no se escribe estado canónico,
- no se llama al MCP de Linear,
- se emite logging estructurado,
- el plugin falla cerrado.

---

## 6. Caso manual A — parent create/link + sync one-way

### Evidencia base
`test/integration/plugin-flow.test.ts`

### Qué valida
1. `createParent`
2. `syncStage`
3. `publishSummary`

### Esperado
- se crea o vincula el parent issue,
- `linearIssueId` queda persistido en Engram,
- el stage canónico se espeja a Linear,
- el summary queda compactado,
- el estado resultante permanece canónico.

### Señales correctas
- stage `implement` termina espejado como `In Progress`
- `lastSync.status = ok`
- activity incluye:
  - `parent.create`
  - `stage.sync`
  - `summary.publish`

---

## 7. Caso manual B — degraded sync sin rollback canónico

### Evidencia base
`test/integration/plugin-flow.test.ts`

### Qué valida
- cuando Linear falla,
- Engram conserva el progreso,
- el sync se marca `degraded`.

### Esperado
- `stage` canónico NO vuelve atrás,
- `lastSync.status = degraded`,
- `lastSync.error` contiene el error,
- se agrega actividad con `*.degraded`.

---

## 8. Caso manual C — reverse sync prohibido

### Evidencia base
`test/integration/plugin-flow.test.ts`

### Qué valida
Aunque Linear devuelva datos “editados manualmente”, el canon no se pisa.

### Esperado
- el plugin ignora campos ajenos del mirror,
- el estado canónico sigue gobernado por Engram,
- no aparece reverse sync implícito.

---

## 9. Caso manual D — verify/archive hard gates

### Verify gate
Validar con:
- `test/unit/verify-archive-guard.test.ts`
- `test/unit/plugin-runtime.test.ts`

### Esperado
- `review` requiere `verify = success`
- `verify = failed` bloquea avance
- se persiste `gateReasons.verify`

### Archive gate
Validar con:
- `test/unit/dual-id-validator.test.ts`
- `test/integration/plugin-flow.test.ts`

### Esperado
- archive requiere:
  - `verify = success`
  - `linearIssueId`
  - `commitMessage` con token dual-ID
  - `commitSha`
  - `pushed = true`
- al faltar algo, la operación se bloquea con mensaje explícito.

---

## 10. Caso manual E — dual-ID post-archive queryable

### Evidencia base
- `test/integration/plugin-flow.test.ts`
- `src/application/plugin-runtime.ts` (`queryArchiveEvidenceAssertion`)

### Esperado
Después del camino `archive ready -> done`:
- `archiveEvidence` queda persistida,
- contiene:
  - `commitMessage`
  - `commitSha`
  - `pushed`
  - `expectedToken`
  - `assertedAt`
- sigue siendo queryable por `sddId`.

---

## 11. Checklist rápido de aceptación manual

- [ ] OpenCode resuelve el plugin local
- [ ] El plugin emite log de bootstrap
- [ ] `npm test` pasa
- [ ] `npm run typecheck` pasa
- [ ] `npm run test:coverage` genera evidencia
- [ ] Contextos `partial` / `unsupported` fallan cerrado
- [ ] Parent create/link persiste `linearIssueId`
- [ ] Stage sync es one-way Engram -> Linear
- [ ] Degraded sync no hace rollback del canon
- [ ] Reverse sync sigue prohibido
- [ ] Verify bloquea `review` cuando corresponde
- [ ] Archive bloquea sin dual-ID/evidence completa
- [ ] Archive evidence queda queryable post-archive

---

## 12. Qué NO prueba esta guía

Esta guía no cubre:
- publicación a npm
- sidebar/TUI
- reverse sync
- background jobs
- heurísticas avanzadas de child splitting

---

## 13. Pendiente importante

Cuando el MVP `0.1.0` quede listo para release:

- publicar el plugin en **npm**,
- dejar de apuntar localmente desde `opencode.json`,
- migrar a:

```json
{
  "plugin": ["@scope/sdd-gentleai-linear"]
}
```
