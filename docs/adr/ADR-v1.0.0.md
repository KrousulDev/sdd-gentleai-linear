# ADR — SDD Linear Integration Plugin (MVP v1.0.0)

> 📎 Ver requerimientos de producto: [PRD v1.0.0](../prd/PRD-v1.0.0.md)

---

## 0. Metadata

**Title:** SDD Linear Integration Plugin aligned with gentle-ai + OpenCode + Linear MCP  
**Version:** v1.0.0  
**Status:** Accepted  
**Date:** 2026-04-25  
**Scope:** MVP  
**Related Docs:** [PRD v1.0.0](../prd/PRD-v1.0.0.md)

---

## 1. Context

El producto busca integrar el workflow SDD con Linear sin romper el modelo operativo real del stack que se está usando.

La base de trabajo NO es un SDD genérico inventado ad hoc. El SDD real es el de **gentle-ai aplicado a OpenCode**. Según la documentación de gentle-ai, este stack actúa como *ecosystem configurator*: agrega memoria persistente con Engram, workflow SDD, skills, MCP servers y perfiles por fase para OpenCode. También deja explícito que:

- SDD ocurre de forma orgánica y el agente decide cuándo usarlo.
- En OpenCode, el orquestador usa **sub-agentes nativos** por fase.
- `/sdd-init` detecta stack y capacidades del proyecto.
- `skill-registry` construye el registro de skills y convenciones del proyecto.
- Engram es memoria persistente automática del ecosistema.

En paralelo, OpenCode define un modelo técnico concreto para extensibilidad:

- Un plugin es un **módulo JavaScript/TypeScript**.
- Puede cargarse desde `.opencode/plugins/`, `~/.config/opencode/plugins/` o desde npm.
- El plugin recibe contexto (`project`, `directory`, `worktree`, `client`, `$`) y responde a hooks/eventos.
- OpenCode soporta **MCP local y remoto** desde `opencode.json`.
- Para MCP remotos, OpenCode maneja OAuth automáticamente y permite gestión por agente para reducir ruido de contexto.

Por último, Linear ofrece un **MCP remoto oficial** en `https://mcp.linear.app/mcp`, soporta Streamable HTTP y OAuth 2.1 con Dynamic Client Registration, y expone herramientas para buscar, crear y actualizar issues, comentarios y otros objetos.

Conclusión: el plugin debe alinearse con el ecosistema REAL, no con una arquitectura imaginaria. Tiene que respetar el rol del orquestador gentle-ai, integrarse como plugin de OpenCode y usar el MCP remoto oficial de Linear.

---

## 2. Decision Drivers

1. Mantener compatibilidad con el workflow SDD real de gentle-ai en OpenCode.
2. Evitar crear una segunda capa de orquestación que compita con el orquestador SDD existente.
3. Usar puntos de extensión soportados oficialmente por OpenCode.
4. Aprovechar el MCP oficial de Linear en lugar de un cliente custom innecesario.
5. Preservar source of truth, trazabilidad y gates del workflow.
6. Minimizar sobrecarga de contexto y complejidad operativa dentro de OpenCode.

---

## 3. Architecture Decisions

### ADR-001 — El SDD source of truth sigue siendo gentle-ai sobre OpenCode
**Decision**  
El workflow y sus etapas (`explore`, `propose`, `spec`, `design`, `implement`, `verify`) se consideran parte del ecosistema gentle-ai/OpenCode. El plugin no redefine el workflow.

**Why**  
gentle-ai ya resuelve orquestación, skills, sub-agentes y memoria. Duplicarlo sería meter otra cocina arriba de una cocina.

---

### ADR-002 — Engram se mantiene como store principal del estado SDD
**Decision**  
El estado canónico del workflow, links de trazabilidad, gates y actividad relevante viven en Engram.

**Why**  
gentle-ai define Engram como memoria persistente del ecosistema. Linear debe reflejar, no gobernar.

---

### ADR-003 — Linear será espejo operativo, no source of truth
**Decision**  
Linear se usa para visibilidad operativa, tracking y bitácora resumida.

**Why**  
Esto evita conflictos de ownership y mantiene la autoridad del workflow dentro del stack SDD real.

---

### ADR-004 — La integración se implementa como plugin nativo de OpenCode
**Decision**  
La solución se implementa como plugin JavaScript/TypeScript compatible con el sistema oficial de plugins de OpenCode.

**Why**  
La documentación oficial de OpenCode define plugins como la extensión soportada para hooks, custom tools y comportamiento contextual. Hacer un wrapper externo degradaría la integración.

---

### ADR-005 — El plugin se diseña como adapter, no como nuevo orquestador
**Decision**  
El plugin reacciona a eventos, consulta estado, sincroniza con Linear y expone utilidades; no reemplaza el control de flujo del orquestador gentle-ai.

**Why**  
OpenCode ya tiene agentes/sub-agentes y gentle-ai ya define el comportamiento SDD. Si el plugin también decide fases, terminás con doble autoridad.

---

### ADR-006 — El lenguaje base del plugin será TypeScript
**Decision**  
El plugin se implementa en TypeScript usando el tipo `Plugin` de `@opencode-ai/plugin` cuando convenga.

**Why**  
OpenCode soporta plugins TS de forma oficial. TypeScript mejora mantenibilidad, contratos de hooks y tooling.

---

### ADR-007 — Se usará el MCP remoto oficial de Linear
**Decision**  
La integración con Linear usará `https://mcp.linear.app/mcp` como servidor MCP remoto principal.

**Why**  
Es el endpoint oficial soportado por Linear, con herramientas ya expuestas para issues y comments. Implementar cliente API propio en el MVP agrega complejidad sin ventaja clara.

---

### ADR-008 — La autenticación del MCP remoto se delega a OpenCode siempre que sea posible
**Decision**  
La autenticación hacia Linear MCP se apoya en el manejo OAuth nativo de OpenCode para servidores remotos. Solo se considerarán headers manuales para casos especiales (tokens restringidos, entornos no interactivos o service users).

**Why**  
OpenCode ya detecta 401, maneja OAuth y persiste credenciales. Rehacer ese flujo en el plugin sería técnica innecesaria.

---

### ADR-009 — Las herramientas de Linear MCP se habilitan de forma selectiva
**Decision**  
Las tools del MCP de Linear no deben quedar indiscriminadamente abiertas para todos los agentes. Deben poder restringirse por agente o perfil cuando haga falta reducir costo de contexto.

**Why**  
La documentación de OpenCode advierte que los MCP agregan contexto y pueden disparar consumo innecesario. El MVP debe privilegiar herramientas de Linear en agentes/fases donde aportan valor operativo real.

---

### ADR-010 — La UI/visualización vive en el contexto OpenCode, consumiendo estado derivado de Engram
**Decision**  
La visualización del estado del plugin (sidebar, summary o representación equivalente dentro de OpenCode) debe leer estado derivado desde Engram y/o resultados sincronizados, nunca convertirse en base de edición directa del workflow en el MVP.

**Why**  
La UI debe mostrar, no gobernar. Si puede mutar arbitrariamente el flujo, rompe la disciplina del source of truth.

---

### ADR-011 — El plugin usará hooks/eventos oficiales de OpenCode
**Decision**  
La automatización se apoyará en eventos oficiales como `session.*`, `todo.updated`, `command.executed`, `tool.execute.before/after`, `tui.*` y los que resulten necesarios para sincronizar actividad.

**Why**  
Los hooks son la forma oficial de reaccionar a cambios dentro de OpenCode. Es la integración correcta, no polling arbitrario ni monkey patching.

---

### ADR-012 — El plugin puede exponer custom tools cuando el workflow lo necesite
**Decision**  
Si se necesita encapsular operaciones como “link issue”, “sync stage” o “append Linear summary”, el plugin podrá exponer custom tools de OpenCode.

**Why**  
OpenCode soporta tools personalizadas dentro del plugin. Esto permite encapsular comportamiento sin inflar el prompt con instrucciones manuales repetidas.

---

### ADR-013 — /sdd-init y skill-registry siguen siendo puntos de arranque del contexto
**Decision**  
El plugin se diseña asumiendo que el proyecto ya corre sobre el flujo normal de gentle-ai: `sdd-init` detecta contexto y `skill-registry` consolida skills y convenciones.

**Why**  
No tiene sentido que el plugin vuelva a descubrir stack, test frameworks o skills si el ecosistema ya lo resuelve.

---

### ADR-014 — Task splitting se mantiene en modo ask
**Decision**  
La división de tareas hacia child issues en Linear requiere confirmación explícita del usuario.

**Why**  
Automatizar splitting sin confirmación puede crear ruido operativo y issues basura.

---

### ADR-015 — Verify gate bloquea transiciones operativas
**Decision**  
No se debe reflejar `review` ni habilitar cierre operativo si verify no fue exitoso.

**Why**  
El gate no puede ser cosmético. Si Linear muestra “review” cuando verify falló, todo el sistema pierde credibilidad.

---

### ADR-016 — Archive gate ejecuta trazabilidad final, no solo cambio de estado
**Decision**  
Archive implica commit/push y cierre operativo, no solo marcar Done en Linear.

**Why**  
Cerrar sin traza técnica real sería mentirle al sistema.

---

### ADR-017 — Los commits automáticos deben llevar dual-ID
**Decision**  
Todo commit generado por el flujo debe incluir `linearIssueId` y `sddId`.

**Why**  
Es la manera más simple y fuerte de sostener trazabilidad extremo a extremo.

---

### ADR-018 — No habrá sincronización inversa desde Linear en el MVP
**Decision**  
Cambios manuales en Linear no reescriben el estado canónico del workflow SDD durante el MVP.

**Why**  
El sync inverso agrega resolución de conflictos, ownership ambiguo y mucha complejidad demasiado temprano.

---

### ADR-019 — El plugin debe tolerar operación degradada
**Decision**  
La integración debe contemplar retries, errores de red y fallas parciales del MCP de Linear sin corromper el estado canónico.

**Why**  
Cuando un sistema depende de un MCP remoto, la degradación es un escenario normal, no una excepción exótica.

---

### ADR-020 — El resumen en Linear será intencionalmente compacto
**Decision**  
Los comentarios y updates en Linear deben actuar como bitácora resumida, no como volcado completo del contexto SDD.

**Why**  
Linear es para visibilidad operativa. Si copiamos todo el contexto, aumentamos ruido y costo cognitivo.

---

## 4. Integration Contract

### 4.1 OpenCode plugin model
- Se implementa como plugin JS/TS.
- Puede vivir en `.opencode/plugins/` para desarrollo del proyecto o publicarse vía npm.
- Recibe `project`, `directory`, `worktree`, `client` y `$`.
- Puede registrar hooks y custom tools.

### 4.2 OpenCode MCP model
- Linear se configura bajo `mcp` en `opencode.json`.
- Tipo esperado: `remote`.
- URL esperada: `https://mcp.linear.app/mcp`.
- OAuth nativo preferido.
- Posibilidad de habilitar tools por agente para minimizar contexto.

### 4.3 Linear MCP contract
- Servidor remoto oficial de Linear.
- Streamable HTTP.
- OAuth 2.1 + Dynamic Client Registration.
- Herramientas para buscar, crear y actualizar issues/comentarios.

### 4.4 gentle-ai contract
- El plugin se monta sobre el ecosistema ya configurado por gentle-ai.
- No sustituye SDD phases, ni skill loading, ni Engram.
- Colabora con el orquestador y sus sub-agentes nativos en OpenCode.

---

## 5. Alternatives Considered

### Opción A — Cliente API de Linear escrito a mano
**Rejected**  
Más control, sí. Pero también más superficie de mantenimiento, auth custom y divergencia respecto del camino soportado por Linear/OpenCode.

### Opción B — Wrapper externo fuera del sistema de plugins
**Rejected**  
Perdés hooks oficiales, integración contextual y acabás parcheando comportamientos alrededor de OpenCode en vez de dentro de él.

### Opción C — Sync inverso Linear → SDD en MVP
**Rejected**  
Demasiada complejidad para una primera versión. Ownership ambiguo y resolución de conflictos desde el día uno.

### Opción D — Habilitar todas las tools del MCP a todos los agentes
**Rejected**  
Fácil de configurar, pésimo para contexto, costo y foco.

---

## 6. Consequences

### Positive
- Alineación real con gentle-ai y OpenCode.
- Menor complejidad de autenticación al reaprovechar OAuth nativo.
- Menor deuda técnica al usar Linear MCP oficial.
- Mejor separación entre source of truth, espejo operativo y UI.

### Negative
- Dependencia fuerte de capacidades y estabilidad del MCP remoto de Linear.
- Mayor cuidado en diseño de contexto para no inflar herramientas innecesarias.
- Algunas necesidades futuras podrían requerir custom tools adicionales o fallback API-level si el MCP no expone suficiente superficie.

---

## 7. Risks

- Que el MCP de Linear no exponga exactamente todas las operaciones requeridas por el flujo final.
- Que el costo de contexto aumente si las tools del MCP se habilitan globalmente.
- Que la gente intente usar Linear como sistema autoritativo por costumbre operativa.
- Que el plugin crezca demasiado y termine invadiendo responsabilidades del orquestador SDD.

---

## 8. Implementation Notes for MVP

1. Configurar Linear como MCP remoto en OpenCode.
2. Restringir herramientas de Linear por agente/perfil si hace falta.
3. Implementar plugin TS con hooks mínimos para sincronización y logging operativo.
4. Conectar estado derivado de Engram con resumen/visualización dentro de OpenCode.
5. Encapsular acciones repetibles en custom tools solo si reducen fricción real.
6. Mantener verify/archive como guards duros, no como sugerencias.

---

## 9. Final Decision Summary

La arquitectura aprobada para el MVP es:

- **SDD real:** gentle-ai sobre OpenCode.
- **Store principal:** Engram.
- **Extensión del host:** plugin nativo OpenCode en TypeScript.
- **Integración con Linear:** MCP remoto oficial `https://mcp.linear.app/mcp`.
- **Auth:** OAuth manejado por OpenCode, salvo excepciones controladas.
- **Rol de Linear:** espejo operativo y log resumido.
- **Rol del plugin:** adapter reactivo + utilidades, NO nuevo orquestador.

Es así de simple: si el diseño no respeta estas fronteras, el sistema se vuelve inconsistente.
