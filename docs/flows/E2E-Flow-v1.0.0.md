# E2E Test Case — SDD Linear Integration Plugin (MVP v1.0.0)

> Basado en [PRD v1.0.0](./prd/PRD-v1.0.0.md) y [ADR v1.0.0](./adr/ADR-v1.0.0.md)

---

## 1. Objetivo

Validar de punta a punta que un proyecto usando **gentle-ai sobre OpenCode** puede ejecutar un flujo SDD completo y que el plugin:

- crea o vincula el issue padre en Linear,
- persiste trazabilidad en Engram,
- sincroniza stages relevantes hacia Linear,
- respeta gates de `verify` y `archive`,
- genera commit con dual-ID,
- y cierra el trabajo en Linear como espejo operativo.

---

## 2. Tipo de prueba

- **Nivel:** E2E / aceptación funcional
- **Modo:** manual guiado hoy, automatizable más adelante
- **Cobertura:** happy path principal + desvío de verify fallido

---

## 3. Precondiciones

### Entorno
- OpenCode configurado con gentle-ai.
- `sdd-init` y `skill-registry` disponibles.
- Plugin del proyecto cargado en OpenCode.
- MCP remoto de Linear configurado en `opencode.json` con:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "linear": {
      "type": "remote",
      "url": "https://mcp.linear.app/mcp",
      "enabled": true
    }
  }
}
```

- Autenticación OAuth del MCP de Linear completada en OpenCode.
- Repositorio git inicializado y con permisos para commit/push.

### Datos iniciales
- No existe vínculo previo entre el trabajo SDD actual y un issue de Linear.
- No existen child issues para este flujo.
- `verify = pending`
- `archive = locked`

---

## 4. Escenario de negocio

Un developer inicia una feature nueva con SDD desde OpenCode. El plugin debe acompañar todo el ciclo operativo hasta cerrar el trabajo en Linear sin romper el source of truth en Engram.

---

## 5. Caso principal — Happy Path completo

### Paso 1 — Inicialización del contexto
**Acción**
- El usuario abre OpenCode en el proyecto.
- Ejecuta `sdd-init`.
- Ejecuta `skill-registry` si el proyecto todavía no tiene contexto actualizado.

**Resultado esperado**
- gentle-ai detecta stack y capacidades del proyecto.
- El workflow SDD queda listo para operar.
- El plugin puede observar eventos del flujo.

---

### Paso 2 — Inicio del trabajo SDD
**Acción**
- El usuario pide iniciar una nueva iniciativa SDD para una feature concreta.

**Resultado esperado**
- Se genera o asigna un `sddId` único.
- Engram crea el estado base del workflow.
- La superficie de estado del plugin muestra:
  - `sddId`
  - stage inicial
  - `verify = pending`
  - `archive = locked`

**Estado esperado en Engram**

```json
{
  "sddId": "sdd_001",
  "linear": {
    "parentIssueId": null,
    "childIssues": [],
    "stage": "spec",
    "activity": []
  },
  "gates": {
    "verify": "pending",
    "archive": "locked"
  }
}
```

---

### Paso 3 — Create/link issue en Linear
**Acción**
- El plugin crea o vincula el issue padre en Linear durante el inicio del flujo.

**Resultado esperado**
- Se obtiene un `linearIssueId` válido, por ejemplo `ENG-123`.
- Engram persiste la relación `sddId ↔ linearIssueId`.
- Linear recibe comentario inicial con referencia al SDD ID.

**Validaciones**
- El issue en Linear existe.
- El comentario inicial incluye `SDD ID: sdd_001`.
- El estado Linear queda alineado al stage inicial (`Backlog` para `spec`).

---

### Paso 4 — Avance de `spec` a `tasks`
**Acción**
- El usuario avanza normalmente por las fases tempranas del flujo.

**Resultado esperado**
- El plugin sincroniza stages a estados de Linear según mapping:
  - `spec` → `Backlog`
  - `plan` → `Todo`
  - `tasks` → `Todo`
- Linear registra actividad resumida sin volcar contexto completo.
- Engram sigue siendo el estado canónico.

---

### Paso 5 — Task splitting en modo ask
**Acción**
- En `sdd-tasks`, el sistema detecta tareas y pregunta si debe crear child issues.
- El usuario responde **sí**.

**Resultado esperado**
- Se crean child issues en Linear solo después de confirmación explícita.
- Engram guarda los IDs de child issues.
- La superficie del plugin refleja tasks y relación con el issue padre.

**Validación clave**
- Si no hubo confirmación del usuario, NO deben existir child issues nuevos.

---

### Paso 6 — Implementación
**Acción**
- El flujo entra en `implement`.

**Resultado esperado**
- Linear cambia a `In Progress`.
- Engram actualiza `linear.stage = implement`.
- La superficie del plugin resalta que el trabajo está en ejecución.

---

### Paso 7 — Verify exitoso
**Acción**
- El usuario ejecuta `sdd-verify`.
- Los tests/verificaciones pasan.

**Resultado esperado**
- `verify = success`
- `archive = ready`
- El sistema permite avanzar a `review`.
- Linear puede reflejar `In Review` solo después del verify exitoso.

**Validaciones**
- No hay bloqueo visible.
- El issue de Linear refleja review únicamente si verify fue exitoso.

**Estado esperado en Engram**

```json
{
  "gates": {
    "verify": "success",
    "archive": "ready"
  }
}
```

---

### Paso 8 — Archive exitoso
**Acción**
- El usuario ejecuta `sdd-archive`.

**Resultado esperado**
- El sistema valida que `verify = success`.
- Se ejecuta commit y push.
- El commit incluye dual-ID.
- El estado canónico conserva una evidencia queryable del dual-ID aceptado.
- `archive = done`.
- Linear cambia a `Done`.

**Validaciones**
- Commit con formato equivalente a:

```bash
git commit -m "feat: close workflow (ENG-123 | sdd_001)"
```

- El push termina sin error.
- La evidencia persistida conserva `commitMessage`, `commitSha`, `pushed`, `expectedToken` y `assertedAt`.
- El issue padre queda en `Done`.

---

## 6. Escenario alternativo — Verify fallido

### Paso A1 — Verify falla
**Acción**
- El usuario ejecuta `sdd-verify`.
- La validación falla.

**Resultado esperado**
- `verify = failed`
- `archive = locked`
- No debe sincronizarse el paso a `review` en Linear.
- La superficie del plugin debe mostrar el bloqueo y la causa.

**Validaciones**
- El issue en Linear NO pasa a `In Review`.
- `sdd-archive` no puede ejecutarse con éxito.

### Paso A2 — Intento inválido de archive
**Acción**
- El usuario intenta ejecutar `sdd-archive` sin corregir verify.

**Resultado esperado**
- La operación es rechazada.
- No se hace commit.
- No se hace push.
- Linear no pasa a `Done`.

---

## 7. Matriz resumida de validación

| Etapa | Acción | Estado Engram esperado | Estado Linear esperado | Gate esperado |
|------|--------|------------------------|------------------------|---------------|
| Init | `sdd-init` | contexto listo | sin issue o issue inicial | pending / locked |
| Spec | create/link issue | `sddId` + `linearIssueId` persistidos | Backlog | pending / locked |
| Tasks | confirmación de split | child issues persistidos si hubo confirmación | Todo | pending / locked |
| Implement | avanzar workflow | `stage = implement` | In Progress | pending / locked |
| Verify OK | `sdd-verify` exitoso | `verify = success` | In Review habilitado | success / ready |
| Archive OK | `sdd-archive` | `archive = done` | Done | success / done |
| Verify FAIL | `sdd-verify` fallido | `verify = failed` | no review | failed / locked |

---

## 8. Criterios de aceptación

Se considera aprobado el flujo E2E si se cumple TODO esto:

1. El flujo usa gentle-ai/OpenCode como orquestación real.
2. El plugin no redefine fases ni reemplaza al orquestador.
3. Engram mantiene el estado canónico durante todo el proceso.
4. Linear se comporta como espejo operativo.
5. Verify bloquea review cuando falla.
6. Archive no corre si verify no fue exitoso.
7. El commit final contiene `linearIssueId` y `sddId`.
8. El issue de Linear termina en `Done` solo después de archive exitoso.

---

## 9. Señales de fallo del sistema

El flujo se considera incorrecto si ocurre cualquiera de estas condiciones:

- Linear entra en `In Review` con `verify = failed`.
- Linear entra en `Done` sin archive ejecutado.
- El commit final no tiene dual-ID.
- Se crean child issues sin confirmación del usuario.
- Un contexto runtime parcial escribe en Engram o intenta espejar a Linear.
- El plugin muta el workflow por fuera de las reglas del orquestador.
- Engram y Linear quedan con IDs o stage inconsistentes.

---

## 10. Próximo uso de este documento

Este caso sirve como base para:

- un **design doc técnico** con contratos de hooks/eventos,
- una futura **suite e2e automatizada**,
- y las **tasks técnicas** del cambio cuando se baje a implementación.
