# SDD Linear Integration — Docs (v1.0.0)

## 📄 Documentación
- PRD: docs/prd/PRD-v1.0.0.md
- ADR: docs/adr/ADR-v1.0.0.md
- Technical Design: docs/Technical-Design-v1.0.0.md
- E2E Flow: docs/flows/E2E-Flow-v1.0.0.md
- Runtime Ops: docs/linear-plugin-mvp.md
- Manual Test Guide: docs/Manual-Test-Guide-v1.0.0.md
- Use Cases: docs/Use-Cases-v1.0.0.md

## 🧠 Fuente de verdad SDD
- **Artifact store activo y deseado:** `engram`
- Los artifacts SDD del cambio viven en Engram.
- Linear es espejo operativo.
- No usamos OpenSpec como fuente activa para este proyecto.

## 🎯 Descripción
Integración SDD + Linear con:
- sync de estados
- trazabilidad bidireccional
- verify/archive gates
- plugin nativo OpenCode en TypeScript

## ⚙️ MVP runtime actual
- Engram canónico; Linear espejo operativo.
- Solo hooks verificados de OpenCode.
- Clasificación explícita de contexto runtime: `full`, `partial`, `unsupported`.
- Fail-closed cuando falta Engram o Linear MCP; no hay canonical writes en contextos parciales/no soportados.
- Retry inline y luego `lastSync.status = degraded`.
- `test:coverage` produce evidencia V8 informativa en `.coverage/v8`; no reemplaza los gates `verify`/`archive`.
- Sin reverse sync, sin background jobs y sin sidebar/TUI en este batch.

## 🔗 Navegación
- PRD → qué
- ADR → cómo
- Technical Design → implementación
- E2E Flow → validación del recorrido completo
- Manual Test Guide → prueba manual paso a paso
- Use Cases → escenarios funcionales y operativos
