# Decisiones del Sprint 0

Registro de las decisiones de la sección 19 del
[documento de requisitos](../requisitos/implementacion_lms_inteligente_ia.md). Cada decisión cerrada
indica la fecha en que se tomó. Las pendientes bloquean las tareas indicadas en la última columna.

| ID   | Decisión                                   | Estado    | Resultado                                                                                 | Fecha      | Bloquea          |
| ---- | ------------------------------------------ | --------- | ----------------------------------------------------------------------------------------- | ---------- | ---------------- |
| D-01 | Versión de Moodle                          | Cerrada   | Moodle 5.1                                                                                | 2026-11-09 | —                |
| D-02 | Moodle nuevo o instancia existente         | Cerrada   | Instancia nueva local en Docker con datos sintéticos                                      | 2026-11-09 | —                |
| D-03 | Tipos y formatos de sílabo                 | Pendiente | Reunir de 10 a 20 sílabos reales anonimizados                                             | —          | S1, S4, S5       |
| D-04 | Estructura de parciales y ponderaciones    | Parcial   | Régimen universitario (LOES); falta el reglamento de la institución con parciales y pesos | 2026-11-09 | S6               |
| D-05 | Tipos de actividad que se crearán          | Pendiente | Propuesta: `assign`, `forum`, `quiz` vacío, `label`/`page`                                | —          | S6, S7           |
| D-06 | Servicios web y permisos administrativos   | Cerrada   | Disponibles en la instancia local (administración propia)                                 | 2026-11-09 | —                |
| D-07 | Proveedor de IA y presupuesto              | Pendiente | Sin definir; se mantiene la capa `LlmProvider` (ADR-009)                                  | —          | S5               |
| D-08 | Política de datos personales y proveedores | Pendiente | Consultar a la institución; mientras tanto, solo datos sintéticos                         | —          | S5, piloto (S12) |
| D-09 | Docentes, cursos y estudiantes del piloto  | Pendiente | —                                                                                         | —          | S1, S12          |
| D-10 | Calendario de desarrollo y validación      | Pendiente | Plan base de 14 sprints desde 2026-11-16                                                  | —          | Todas            |

## Consecuencias

- **D-01/D-02:** el entorno de desarrollo se levanta con `moodlehq/moodle-docker` (ADR-011). Al ser
  Moodle 5.1, el código del plugin se ubica según la estructura con directorio `public/`; se verifica
  en el Sprint 2.
- **D-04:** el esquema del sílabo y el generador de propuestas modelan periodos académicos
  universitarios con parciales. Los pesos no se asumen: se configuran por institución.
- **D-06:** se cierra para el entorno local. Si más adelante se integra una instancia institucional,
  esta decisión se reabre.
- **D-07:** hasta elegir proveedor, el código usa solo la interfaz `LlmProvider` y las pruebas usan un
  proveedor simulado.
