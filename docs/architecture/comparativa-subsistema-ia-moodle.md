# Comparativa: subsistema de IA de Moodle frente a backend propio

Entregable del Sprint 1 para [ADR-012](adr/0012-subsistema-ia-moodle.md). Las capacidades del
subsistema de Moodle se deben verificar en la documentación de la versión 5.1 instalada
(<https://moodledev.io/docs/5.1/apis/subsystems/ai>); esta tabla resume el diseño general del
subsistema, no una prueba sobre la instancia del proyecto.

## Necesidades del proyecto

| Necesidad                                        | Subsistema de IA de Moodle                 | Backend propio                 |
| ------------------------------------------------ | ------------------------------------------ | ------------------------------ |
| Configurar proveedor LLM desde la administración | Sí: proveedores y acciones configurables   | Hay que construirlo            |
| Acciones simples (generar o resumir texto)       | Sí                                         | Sí                             |
| Salida estructurada validada contra un esquema   | No es su propósito                         | Sí (Zod, `packages/contracts`) |
| Tool calling sobre datos del curso               | No                                         | Sí (RF-10)                     |
| RAG con filtros por curso y versión              | No                                         | Sí (ADR-005)                   |
| Trabajos largos con progreso y reintentos        | Limitado                                   | Sí (ADR-004)                   |
| Cálculos deterministas y snapshots               | No                                         | Sí (RF-15)                     |
| Seudonimización antes de llamar al LLM           | No                                         | Sí (ADR-010)                   |
| Políticas y registro de uso de IA en Moodle      | Sí: política de uso y registro de acciones | Hay que construirlo            |
| Evaluación como aporte de tesis                  | Poco aporte propio                         | Contribución principal         |

## Conclusión

El backend propio es necesario para lo que diferencia el proyecto: tool calling, RAG, extracción
estructurada, analítica y seudonimización. El subsistema de Moodle aporta dos ideas que conviene
reutilizar en el plugin:

1. **Aceptación de la política de uso de IA** antes de usar el asistente, alineada con la sección 6 del [análisis de privacidad](../security/analisis-privacidad.md).
2. **Configuración del proveedor desde la administración de Moodle**, si resulta más simple para el administrador que configurarlo en el backend.

Se propone pasar ADR-012 a **Aceptada** con esta decisión: backend propio, más revisar en el Sprint 3 si
la política de uso del subsistema se puede reutilizar desde el plugin.
