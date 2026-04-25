# PRD — SDD Linear Integration Plugin

> 📎 Ver decisiones de arquitectura: [ADR v1.0.0](../adr/ADR-v1.0.0.md)

---

## 0. Metadata

**Product Name:** SDD Linear Integration Plugin  
**Version:** v1.0.0  
**Author:** TBD  
**Date:** 2026-04-25  
**Status:** Draft  
**Stakeholders:** Product, Engineering, AI/Automation Workflows, Developers using gentle-ai/OpenCode SDD  
**Related Docs:** [ADR v1.0.0](../adr/ADR-v1.0.0.md), gentle-ai docs, OpenCode plugin docs, OpenCode MCP docs, Linear MCP docs

**Resumen:**  
El producto integra el flujo Spec-Driven Development (SDD) real de **gentle-ai sobre OpenCode** con Linear para convertir a Linear en el espejo operativo del ciclo de trabajo sin desplazar la fuente real de verdad. La solución usa Engram como store principal, aprovecha el orquestador y sub-agentes nativos que gentle-ai instala en OpenCode, y suma un plugin TypeScript alineado con la arquitectura oficial de plugins de OpenCode para sincronizar estados, tareas, comentarios y trazabilidad con Linear vía su MCP oficial.

En el MVP, el foco está en eliminar gestión manual de issues, reforzar gates obligatorios de verify y archive, y garantizar trazabilidad bidireccional entre SDD, Engram, Linear y Git. La integración debe respetar tres fronteras: **gentle-ai/orchestrator gobierna el workflow**, **Engram guarda el estado canónico**, y **Linear refleja operación vía MCP remoto**. El plugin no reemplaza el orquestador: actúa como adapter de OpenCode.

### Executive Summary
- **Problema:** el estado real del trabajo SDD y el estado visible en Linear pueden divergir.
- **Apuesta de producto:** usar Linear como espejo operativo, no como source of truth.
- **Resultado esperado:** menos coordinación manual, más confiabilidad operativa y trazabilidad completa.
- **Restricción clave del MVP:** no habrá edición desde la UI ni sync inverso desde Linear.
- **Constraint técnico clave:** la implementación debe usar el sistema oficial de plugins de OpenCode y el MCP remoto oficial de Linear.

---

## 1. Problem Statement

**Objetivo:**  
Definir claramente el problema que se está resolviendo.

### Estado actual
- El flujo SDD real ya existe dentro del ecosistema gentle-ai/OpenCode, con orquestación, skills, sub-agentes y memoria persistente.
- Linear se usa como capa operativa para seguimiento, pero no está integrado de forma nativa con el estado real del flujo SDD.
- La trazabilidad entre decisiones, tareas, cambios de estado y commits depende de disciplina manual o convenciones no reforzadas por el sistema.

### Problemas específicos
- Duplicación operativa: el equipo debe mantener información en más de un lugar.
- Riesgo de drift entre el estado del trabajo en SDD y el issue de Linear.
- Falta de enforcement operativo: verify y archive pueden omitirse si no hay controles automáticos.
- Baja observabilidad del progreso real: Linear puede mostrar un estado que no refleja el estado técnico efectivo.
- La relación entre issue, artefacto SDD y commit no queda garantizada de extremo a extremo.

### Impacto
- **Técnico:** pérdida de consistencia entre sistemas, dificultad para auditar el flujo y errores en transiciones de estado.
- **Negocio:** menor confiabilidad del seguimiento operativo y más costo de coordinación.
- **Usuario:** más fricción para developers y menor claridad sobre qué hacer, qué está bloqueado y qué ya fue validado.

### Coste de no resolverlo
- Más tiempo operativo dedicado a actualizar herramientas en paralelo.
- Mayor probabilidad de cerrar trabajo sin verify o sin trazabilidad suficiente.
- Menor confianza de producto e ingeniería en Linear como tablero operativo.

### Por qué ahora
- El flujo SDD necesita una capa operativa integrada para escalar sin depender de disciplina manual.
- OpenCode ya expone un sistema formal de plugins y soporte nativo para MCP remoto con OAuth.
- Linear ya ofrece un MCP oficial para buscar, crear y actualizar issues/comentarios.
- gentle-ai ya define el modelo operativo base, por lo que ahora conviene integrar SOBRE esa base y no inventar otra.

---

## 2. Vision

**Objetivo:**  
Describir el estado ideal después de resolver el problema.

El estado ideal es un flujo donde el SDD de gentle-ai/OpenCode sigue siendo el source of truth, pero Linear refleja automáticamente el progreso operativo del trabajo. El usuario inicia o vincula el trabajo una sola vez y el sistema se encarga de sincronizar estados, crear o relacionar issues, registrar actividad relevante y mantener trazabilidad técnica.

La solución final del MVP debe hacer visible qué etapa está activa, qué gates están pendientes y qué acciones están bloqueadas. Verify debe impedir avances inválidos y archive debe cerrar el ciclo operativo con commit, push y transición final de estado. Técnicamente, esto debe lograrse mediante un plugin oficial de OpenCode que coopera con el orquestador gentle-ai y usa el MCP remoto oficial de Linear.

### Before vs After
- **Before:** estado repartido, sincronización manual, riesgo de inconsistencia, trazabilidad parcial.
- **After:** estado centralizado en Engram, Linear sincronizado como espejo operativo, gates obligatorios y commits trazables con dual-ID.

### Diferenciadores clave
- Source of truth explícito en SDD/Engram.
- Trazabilidad bidireccional Engram ↔ Linear.
- Enforcement real de verify y archive.
- Superficie de estado del plugin consumiendo estado operativo sin introducir otra fuente de verdad.

### Resultado esperado para stakeholders
- **Engineering:** menos drift y menos trabajo manual.
- **Product/Delivery:** mayor confianza en el estado visible de cada iniciativa.
- **Leads:** auditoría clara entre flujo, issue y commit.

---

## 3. Target Users

**Objetivo:**  
Definir quién usa el producto.

### Primary Users
- **Developers que trabajan con SDD:** necesitan ejecutar el flujo completo sin administrar manualmente issues, estados y trazabilidad.
- **Technical leads / architects:** necesitan confiar en que el estado operativo visible en Linear corresponde al estado técnico real del trabajo.

### Secondary Users
- **Reviewers / maintainers:** necesitan visibilidad sobre verify, archive y estado del trabajo antes de aprobar o cerrar.
- **Product / delivery stakeholders:** necesitan seguimiento operativo en Linear sin depender de conocimiento profundo del flujo SDD.

### Casos de uso principales
- Iniciar un trabajo SDD y crear o vincular su issue padre en Linear.
- Pasar de etapa y reflejar automáticamente el cambio en Linear.
- Detectar tareas y decidir si se crean child issues.
- Ejecutar verify y bloquear avances si falla.
- Ejecutar archive para cerrar trazabilidad con commit/push y marcar el trabajo como Done.

### Qué significa éxito para cada usuario
- **Developer:** no tener que mantener manualmente estado, links y comentarios.
- **Lead técnico:** poder confiar en que review/done respetan gates reales.
- **Stakeholder de delivery:** ver progreso comprensible en Linear sin preguntar estado por Slack.

---

## 4. User Experience (UX)

**Objetivo:**  
Definir el flujo de interacción del usuario.

### Entry points
- Inicio del flujo desde `sdd-init` o desde el orquestador SDD ya configurado por gentle-ai.
- Cambio de etapa del flujo SDD.
- Ejecución de skills `sdd-tasks`, `sdd-implement`, `sdd-verify` y `sdd-archive`.
- Consulta visual desde el contexto/UI que OpenCode exponga para el plugin.

### Flujo principal
1. El usuario inicia o vincula un trabajo SDD.
2. El sistema crea o enlaza el issue padre en Linear.
3. Se persisten IDs y relaciones en Engram.
4. Se publica comentario inicial en Linear con referencia al SDD ID.
5. El usuario avanza por etapas del flujo.
6. El sistema sincroniza estado y actividad con Linear cuando corresponde.
7. En `sdd-tasks`, el sistema detecta tareas y pregunta si debe crear child issues (`mode=ask`).
8. En `sdd-implement`, la UI resalta el trabajo activo.
9. En `sdd-verify`, se ejecutan tests y se decide si se desbloquea archive.
10. En `sdd-archive`, si verify fue exitoso, se ejecuta commit/push y se marca Linear como Done.

### Flujo real esperado en el ecosistema
1. gentle-ai configura OpenCode con orquestador SDD, skills, Engram y perfiles si aplica.
2. El proyecto inicializa contexto con `sdd-init` y `skill-registry` cuando corresponde.
3. El plugin de OpenCode observa eventos del flujo y sincroniza operación hacia Linear.
4. Linear MCP se usa como canal oficial para create/search/update de objetos de Linear.

### Decisiones del usuario
- Crear o vincular issue padre.
- Aceptar o no el task splitting en child issues.
- Continuar o corregir según resultado de verify.

### Estados del sistema
- Stages SDD: `spec`, `plan`, `tasks`, `implement`, `review`, `done`.
- Gates: `verify = pending | failed | success`, `archive = locked | ready | done`.

### Principios UX
- El usuario debe entender en segundos si puede avanzar o está bloqueado.
- Los bloqueos deben explicarse con causa visible (`verify failed`, `archive locked`, etc.).
- La UI informa estado; no compite con Engram como fuente de verdad.
- El plugin no debe obligar al usuario a aprender un workflow nuevo distinto al de gentle-ai.

---

## 5. System / Feature Overview

**Objetivo:**  
Describir cómo funciona el sistema a alto nivel.

### Componentes principales
- **gentle-ai SDD Orchestrator en OpenCode:** coordina el flujo y dispara acciones por etapa.
- **Sub-agentes / skills de gentle-ai en OpenCode:** ejecutan fases y habilidades del proceso (`sdd-verify`, `sdd-archive`, etc.).
- **Engram:** store principal de estado, relaciones, gates y actividad.
- **Plugin TypeScript de OpenCode:** adapta el dominio SDD al ecosistema Linear/MCP usando hooks/eventos oficiales.
- **Linear Remote MCP:** canal de integración oficial para crear, actualizar y comentar issues.
- **Git / entorno local:** ejecuta trazabilidad final mediante commit y push.
- **UI/Contexto OpenCode del plugin:** muestra el estado operativo consumiendo Engram.

### Interacción entre componentes
gentle-ai configura el entorno SDD en OpenCode → el orquestador y sub-agentes ejecutan el workflow → Engram persiste estado → el plugin de OpenCode observa eventos oficiales y usa Linear MCP remoto para sincronizar operación → Git cierra la trazabilidad técnica → la UI/contexto del plugin refleja estado derivado.

### Responsabilidades
- **Engram:** persistencia principal y modelo operativo.
- **Plugin TS de OpenCode:** mapping, sincronización, retries, tool wrapping selectivo y comunicación con Linear MCP.
- **UI del plugin:** visualización de estado y bloqueos.
- **Orquestador gentle-ai/OpenCode:** control del flujo SDD.

### Principios arquitectónicos
- Separar claramente **fuente de verdad**, **capa operativa** y **capa de visualización**.
- Mantener el plugin como adapter, no como nuevo orquestador del dominio.
- Hacer que los gates sean reglas del sistema, no sugerencias de UX.
- Reutilizar capacidades oficiales del host (plugins, MCP remoto, OAuth) antes de crear infraestructura paralela.

---

## 6. Core Functionality

**Objetivo:**  
Describir las capacidades clave del sistema.

### Capacidades
- Crear o vincular issue padre en Linear al iniciar el flujo.
- Persistir trazabilidad bidireccional entre `sddId` y `linearIssueId`.
- Sincronizar cambios de etapa hacia estados de Linear.
- Detectar tareas y soportar task splitting opcional bajo `mode=ask`.
- Ejecutar verify como gate obligatorio antes de review/done.
- Ejecutar archive como gate final con commit/push y cierre operativo.
- Mostrar en UI IDs, stage, tasks, activity y gates.
- Publicar comentarios resumidos en Linear como bitácora operativa.
- Respetar el workflow nativo de gentle-ai/OpenCode sin redefinir fases.
- Consumir el MCP remoto oficial de Linear en vez de una integración API custom en el MVP.

### Inputs / outputs
- **Inputs:** eventos del flujo SDD, decisión del usuario sobre task splitting, resultados de verify, IDs de trazabilidad.
- **Outputs:** issues/child issues en Linear, comentarios, estado persistido en Engram, commits con dual-ID, estado visual en la superficie del plugin.

### Validaciones
- No avanzar a review si `verify != success`.
- No marcar done si archive no fue ejecutado.
- No sincronizar ciertos estados en Linear cuando verify falla.
- Todo commit final debe incluir `issueId` y `sddId`.

### Reglas de negocio
- El SDD real es el configurado por gentle-ai sobre OpenCode.
- SDD es el source of truth.
- Engram es el store principal.
- Linear funciona como espejo operativo y log resumido, no como fuente primaria.
- El task splitting no es automático: se consulta al usuario.
- El plugin no puede mutar arbitrariamente el flujo fuera de las reglas del orquestador y los gates.

### Capacidades por valor de negocio
| Capacidad | Valor principal |
|-----------|-----------------|
| Create/link issue en `sdd-init` | Reduce setup manual y asegura punto de entrada único |
| Sync de stages hacia Linear | Mantiene visibilidad operativa confiable |
| Verify gate | Evita avances de baja calidad |
| Archive gate con commit/push | Cierra trazabilidad técnica y operativa |
| Sidebar con gates y activity | Reduce ambigüedad durante la ejecución |

---

## 7. Technical Architecture

**Objetivo:**  
Explicar cómo se implementa el sistema.

### Componentes técnicos
- Orquestador SDD y sub-agentes nativos configurados por gentle-ai en OpenCode.
- Plugin TypeScript compatible con `@opencode-ai/plugin`.
- Hooks/eventos oficiales de OpenCode (`session.*`, `command.executed`, `todo.updated`, `tool.execute.*`, etc.).
- MCP remoto de Linear configurado en `opencode.json`.
- Engram como modelo persistente.
- UI/contexto del plugin consumiendo estado derivado.

### Interfaces
- **OpenCode Plugin API:** export de plugin JS/TS con acceso a `project`, `directory`, `worktree`, `client` y `$`.
- **OpenCode MCP config:** servidor remoto bajo `mcp.linear` con `type: "remote"`, `url: "https://mcp.linear.app/mcp"` y OAuth nativo cuando aplique.
- **gentle-ai workflow:** `sdd-init`, `skill-registry`, sub-agentes y skills del flujo.
- **Linear MCP:** creación de issue, actualización de estado, comentarios, lookup por ID.
- **Git:** commit y push delegados al entorno del host y al workflow SDD.

### Flujos internos
- **sdd-init:** create/link issue → persist links → comentar en Linear.
- **stage-change:** mapear stage → estado Linear → comentar actividad.
- **sdd-tasks:** detectar tareas → preguntar → crear child issues si aplica.
- **sdd-implement:** marcar In Progress y resaltar en UI.
- **sdd-verify:** ejecutar tests → actualizar gate → bloquear o habilitar archive.
- **sdd-archive:** validar verify success → commit/push → marcar Done.

### Eventos/hook candidates en OpenCode
- `session.created` / `session.updated`: inicialización y refresco de contexto operativo.
- `command.executed`: detección de comandos relevantes del flujo.
- `todo.updated`: sincronización de tasks o child issues cuando corresponda.
- `tool.execute.before` / `tool.execute.after`: observabilidad y enforcement selectivo.
- `session.compacted`: persistencia de contexto mínimo operativo si el flujo lo requiere.

### Mapping operativo SDD → Linear
| Stage SDD | Estado Linear | Condición |
|-----------|---------------|-----------|
| `spec` | Backlog | Issue creado o vinculado |
| `plan` | Todo | Flujo activo sin ejecución |
| `tasks` | Todo | A la espera de definición/división |
| `implement` | In Progress | Trabajo en ejecución |
| `review` | In Review | Solo si `verify = success` |
| `done` | Done | Solo si archive fue ejecutado |

### Guard matrix
| Acción | Precondición | Comportamiento si falla |
|--------|--------------|--------------------------|
| Pasar a `review` | `verify = success` | Bloquear transición y no sincronizar Linear |
| Ejecutar `archive` | `verify = success` | Rechazar acción y mantener `archive = locked` |
| Pasar a `done` | `archive = done` | Mantener issue fuera de Done |

### Diagrama lógico
`gentle-ai → OpenCode Orchestrator/Subagents → Engram → OpenCode Plugin TS → Linear Remote MCP + Git → Linear`

---

## 8. Data & Storage

**Objetivo:**  
Definir cómo se manejan los datos.

### Estructuras de datos
```json
{
  "sddId": "sdd_001",
  "linear": {
    "parentIssueId": "ENG-123",
    "childIssues": [],
    "stage": "implement",
    "activity": []
  },
  "gates": {
    "verify": "pending",
    "archive": "locked"
  },
  "links": {
    "linear": "ENG-123",
    "sdd": "sdd_001"
  }
}
```

### Persistencia
- Engram persiste el estado principal del workflow.
- Linear persiste el issue operativo y su bitácora resumida.
- OpenCode persiste configuración del plugin/MCP, pero no reemplaza el estado canónico del flujo.

### Formatos
- Estado estructurado en Engram.
- Comentarios en Linear con formato estable y parseable.
- Commits con convención de dual-ID.

### Ubicación de almacenamiento
- **Primario:** Engram.
- **Operativo externo:** Linear.
- **Trazabilidad de código:** Git.

---

## 9. Integrations

**Objetivo:**  
Definir integraciones con sistemas externos.

### Integraciones principales
- **gentle-ai:** proveedor del workflow SDD, skills, perfiles y memoria integrada.
- **OpenCode Plugins:** host oficial para la extensión.
- **OpenCode MCP:** mecanismo oficial para registrar y consumir herramientas externas.
- **Linear vía MCP remoto oficial:** gestión de issues, estados y comentarios.
- **Git:** commit y push de cierre.
- **Engram:** almacenamiento y lookup cruzado.

### Dependencias
- gentle-ai instalado/configurado para OpenCode.
- OpenCode con soporte de plugins y MCP remoto habilitado.
- Disponibilidad del endpoint `https://mcp.linear.app/mcp`.
- Entorno Git configurado para commit/push.
- Skills `sdd-verify` y `sdd-archive` accesibles en el workflow gentle-ai.

### Integraciones explícitamente fuera del MVP
- Sync inverso desde Linear como sistema originador.
- Automatizaciones externas de terceros que muten estado SDD.
- Cliente API custom de Linear paralelo al MCP oficial, salvo fallback futuro justificado.

---

## 10. Requirements

### 10.1 Functional Requirements

| ID | Requirement | Priority |
|----|------------|----------|
| FR-001 | El sistema debe crear o vincular un issue padre en Linear durante `sdd-init`. | High |
| FR-002 | El sistema debe persistir la relación entre `sddId` y `linearIssueId` en Engram. | High |
| FR-003 | El sistema debe publicar un comentario inicial en Linear con el SDD ID asociado. | High |
| FR-004 | El sistema debe sincronizar stages SDD a estados de Linear usando un mapping configurable. | High |
| FR-005 | El sistema debe detectar tareas en `sdd-tasks` y consultar al usuario si desea crear child issues. | High |
| FR-006 | El sistema debe reflejar `sdd-implement` como `In Progress` en Linear y en la UI. | High |
| FR-007 | El sistema debe ejecutar verify como precondición para pasar a review. | High |
| FR-008 | Si verify falla, el sistema no debe sincronizar la transición bloqueada en Linear. | High |
| FR-009 | El sistema debe habilitar archive solo cuando verify sea exitoso. | High |
| FR-010 | El sistema debe ejecutar archive con commit/push y luego marcar el issue en Linear como Done. | High |
| FR-011 | La superficie de estado del plugin en OpenCode debe mostrar SDD ID, Linear ID, stage, tasks, activity y gates. | Medium |
| FR-012 | El sistema debe soportar búsqueda cruzada Engram → Linear y Linear → Engram por IDs. | Medium |
| FR-013 | El sistema debe registrar actividad resumida en Linear durante el flujo. | Medium |
| FR-014 | Todo commit generado por el flujo debe usar formato con dual-ID. | High |
| FR-015 | La solución debe implementarse como plugin oficial de OpenCode en JavaScript/TypeScript. | High |
| FR-016 | La solución debe usar el MCP remoto oficial de Linear en `https://mcp.linear.app/mcp`. | High |
| FR-017 | La autenticación al MCP de Linear debe delegarse a OpenCode siempre que el flujo interactivo lo permita. | Medium |
| FR-018 | Las tools del MCP de Linear deben poder habilitarse selectivamente por agente o perfil para controlar contexto. | Medium |
| FR-019 | El plugin no debe reemplazar el orquestador SDD de gentle-ai ni redefinir sus fases. | High |

---

### 10.2 Non-Functional Requirements

- **Performance:** la superficie de estado del plugin debe responder en menos de 200 ms en condiciones normales de uso.
- **Escalabilidad:** el diseño debe soportar múltiples workflows SDD sin perder aislamiento por `sddId`.
- **Seguridad:** solo debe ejecutarse archive si las precondiciones del gate se cumplen; no se deben falsear estados operativos.
- **Confiabilidad:** el plugin debe implementar retry con máximo 3 intentos y fallback cuando aplique.
- **UX:** el usuario debe entender rápidamente qué etapa está activa, qué está bloqueado y qué acción sigue.
- **Auditabilidad:** toda transición relevante debe poder rastrearse entre Engram, Linear y Git.
- **Mantenibilidad:** el diseño debe permitir cambiar mappings o políticas sin reescribir la lógica central del dominio.
- **Compatibilidad:** la solución debe ajustarse al contrato oficial de plugins y MCP servers de OpenCode.
- **Eficiencia de contexto:** la integración no debe exponer innecesariamente todas las tools del MCP de Linear a todos los agentes.

---

## 11. Screens / Interfaces

### OpenCode Status Surface
- **Propósito:** visualizar el estado operativo del flujo SDD dentro de OpenCode.
- **Acciones:** consultar stage, revisar tasks, ver gates, entender actividad y bloqueos.

### OpenCode Plugin Surface
- **Propósito:** insertar comportamiento de sincronización y tooling dentro del host oficial.
- **Acciones:** registrar hooks, emitir logs, encapsular custom tools si hace falta, reaccionar a eventos del workflow.

### Linear Issue
- **Propósito:** actuar como espejo operativo del workflow.
- **Acciones:** visualizar estado, child issues y comentarios resumidos del proceso.

### Skill Interfaces
- **Propósito:** ejecutar verify y archive desde el flujo.
- **Acciones:** disparar skills, recibir resultados y actualizar estado persistido.

---

## 12. Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| Verify falla | El sistema bloquea review/archive y no sincroniza transición inválida en Linear. |
| Archive se intenta sin verify success | La operación debe rechazarse y la UI debe mostrar gate bloqueado. |
| Fallo temporal de integración con Linear | El plugin debe reintentar hasta 3 veces y registrar fallback o error operativo. |
| No se puede crear issue en `sdd-init` | El sistema debe permitir link manual o dejar el workflow en estado de error explícito. |
| El usuario rechaza task splitting | El flujo continúa sin crear child issues. |
| Comentario en Linear no contiene SDD ID parseable | La búsqueda inversa debe tratarse como no resuelta, sin inferencias ambiguas. |
| Commit sin IDs requeridos | Debe considerarse inválido para cierre automatizado del flujo. |
| OAuth del MCP remoto requiere reautenticación | El sistema debe delegar el flujo a OpenCode y evitar implementar auth paralela en el plugin. |
| Exceso de tools MCP causa ruido de contexto | Deben restringirse las tools por agente/perfil o deshabilitarse globalmente según la configuración de OpenCode. |

---

## 13. Success Metrics

- **0 operaciones manuales de gestión de issues** en el flujo objetivo del MVP.
- **100% de commits generados por el flujo** con `issueId` y `sddId`.
- **<200 ms** de respuesta en la superficie de estado del plugin para consultar estado.
- **100% de transiciones a review/done** validadas por gates obligatorios.
- **Trazabilidad bidireccional funcional** para lookup Engram ↔ Linear en todos los workflows creados por el sistema.

### Cómo se medirá
| Métrica | Método de medición |
|--------|---------------------|
| Operaciones manuales | Conteo de pasos manuales requeridos en el flujo estándar |
| Commits con dual-ID | Validación de formato en commits generados por archive |
| Tiempo de respuesta UI | Medición de lectura de estado en la superficie del plugin |
| Gates respetados | Registro de intentos bloqueados vs transiciones exitosas |
| Trazabilidad cruzada | Pruebas de lookup Engram ↔ Linear sobre workflows creados |

---

## 14. Implementation Notes

- Se adopta un adapter TypeScript sobre MCP en lugar de wrappers adicionales.
- Se aprovecha el sistema oficial de plugins de OpenCode, no un wrapper externo paralelo.
- El plugin se integra sobre el workflow real de gentle-ai en OpenCode.
- Git queda delegado al entorno y a la skill correspondiente, reduciendo acoplamiento del plugin.
- Se prioriza un modelo event-driven para responder a cambios de etapa.
- El task splitting usa `mode=ask` para evitar automatizaciones incorrectas o ruido operativo.
- Linear se integra vía MCP remoto oficial y no mediante API client custom en el MVP.
- La autenticación del MCP remoto se delega al soporte OAuth nativo de OpenCode cuando sea posible.

### Alineación explícita con ADR
| ADR | Decisión | Reflejo en este PRD |
|-----|----------|---------------------|
| ADR-001 / ADR-002 / ADR-003 | gentle-ai/OpenCode como workflow real + Engram store principal + Linear espejo operativo | Vision, Core Functionality, Closed Decisions |
| ADR-004 / ADR-005 / ADR-006 | Plugin nativo de OpenCode en TS y rol de adapter | Technical Architecture, Integrations |
| ADR-007 / ADR-008 / ADR-009 | Uso del MCP remoto oficial de Linear + OAuth/OpenCode + control de tools por agente | Integrations, Requirements |
| ADR-010 / ADR-011 / ADR-012 | Superficie/contexto del plugin + hooks oficiales + custom tools opcionales | UX, Screens / Interfaces, Technical Architecture |
| ADR-013 / ADR-014 | Dependencia del flujo `sdd-init`/`skill-registry` + task splitting `mode=ask` | UX, Requirements |
| ADR-015 / ADR-016 / ADR-017 | Verify/archive como gates reales y commits dual-ID | Technical Architecture, Edge Cases, Requirements |
| ADR-018 / ADR-019 / ADR-020 | Sin sync inverso, tolerancia a degradación y bitácora resumida en Linear | Risks, Edge Cases, Success Metrics |

### Secuencia sugerida de implementación
1. Persistencia y modelo de links/gates en Engram.
2. Adapter TS para create/link issue + comentarios en Linear.
3. Sync de stages y superficie de estado leyendo desde Engram.
4. Verify gate con bloqueo real de transiciones.
5. Archive gate con commit/push y cierre en Linear.
6. Lookup cruzado y hardening de retries/fallback.

---

## 15. Closed Decisions

- SDD es el source of truth.
- El SDD usado por este producto es el de gentle-ai aplicado a OpenCode.
- Engram es el store principal del estado.
- Linear actúa como espejo operativo y log resumido, no como fuente primaria.
- El plugin se implementa como plugin nativo de OpenCode en TypeScript.
- La integración con Linear usa el MCP remoto oficial `https://mcp.linear.app/mcp`.
- La autenticación al MCP se delega a OpenCode siempre que sea posible.
- La UI/contexto del plugin consume estado derivado y no ofrece edición libre del workflow en MVP.
- `verify` bloquea transiciones de estado inválidas.
- `archive` ejecuta commit/push y habilita el cierre operativo.
- Los commits usan dual-ID (`issueId` + `sddId`).
- No se sincroniza Linear cuando verify falla.
- Los state guards son obligatorios.
- Las tools del MCP de Linear pueden restringirse por agente/perfil para controlar contexto.

> Estas decisiones derivan del ADR v1.0.0 y se consideran cerradas para el alcance del MVP.

---

## 16. Risks & Assumptions

### Riesgos
- Dependencia operativa de Linear MCP para sincronización estable.
- Riesgo de inconsistencias si fallan retries y no hay manejo claro de recuperación.
- Riesgo de fricción si la UI no comunica bien los bloqueos y gates.
- Riesgo de acoplamiento excesivo entre stages SDD y estados de Linear si el mapping cambia frecuentemente.
- Riesgo de inflar el contexto de OpenCode si se habilitan demasiadas tools MCP globalmente.
- Riesgo de diseñar el plugin como pseudo-orquestador y entrar en conflicto con gentle-ai.

### Supuestos
- Engram puede persistir y consultar el estado requerido con latencia aceptable.
- El workflow gentle-ai/OpenCode puede ejecutar `sdd-verify` y `sdd-archive` con los parámetros esperados.
- El entorno Git tiene permisos y contexto suficientes para commit/push.
- Linear puede ser tratado como bitácora resumida sin necesidad de edición directa desde UI en el MVP.
- OpenCode puede cargar plugins JS/TS y manejar el MCP remoto de Linear como describe su documentación.
- El endpoint oficial `https://mcp.linear.app/mcp` seguirá siendo la vía recomendada de integración.

### Trade-offs asumidos
- Se privilegia consistencia operativa sobre flexibilidad manual desde la UI.
- Se evita sync inverso en MVP para reducir complejidad y ambigüedad de ownership.
- Se acepta una capa más de integración técnica para obtener auditabilidad end-to-end.

---

## 17. Roadmap / Future Work

### Out of scope (MVP)
- Edición de issues o estados directamente desde la UI.
- Dashboards avanzados o reporting analítico.
- Sync inverso desde Linear hacia SDD como origen.

### Mejoras futuras
- Dashboard de salud del workflow.
- Automatización más avanzada de child issues basada en heurísticas o reglas.
- Recuperación asistida ante fallos de sync.
- Métricas históricas de verify/archive y lead time por etapa.
- Evaluar custom tools más ricas o fallback API-level solo si el MCP oficial queda corto.

---

## 18. Open Questions

- ¿Qué campos exactos del issue de Linear deben sincronizarse además del estado y comentarios?
- ¿Cuál es la política de fallback cuando Git push falla después del commit?
- ¿Cómo se resolverán conflictos si el issue en Linear cambia manualmente fuera del flujo?
- ¿Qué nivel de detalle debe tener la actividad visible en la superficie de estado del plugin para no saturar al usuario?
- ¿Quién define el mapping final entre stages SDD y workflow states de Linear por workspace?
- ¿Qué subset de tools del MCP de Linear debe quedar habilitado por agente para minimizar contexto sin perder capacidad operativa?
- ¿Hace falta publicar el plugin por npm o alcanza con distribución project-level en `.opencode/plugins/` para el MVP?

---

## 19. Related Deliverables

- [ADR v1.0.0](../adr/ADR-v1.0.0.md)
- [gentle-ai README](https://github.com/Gentleman-Programming/gentle-ai)
- [gentle-ai Intended Usage](https://github.com/Gentleman-Programming/gentle-ai/blob/main/docs/intended-usage.md)
- [OpenCode Plugins](https://opencode.ai/docs/plugins/)
- [OpenCode MCP Servers](https://opencode.ai/docs/mcp-servers/)
- [Linear MCP](https://linear.app/docs/mcp)
- Futuro design doc de plugin/adapter TypeScript
- Futuro runbook de setup MCP + Linear + Git + OpenCode/gentle-ai
