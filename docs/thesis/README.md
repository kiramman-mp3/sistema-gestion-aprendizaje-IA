# Material de tesis: capítulos técnicos

Borradores de los capítulos técnicos del trabajo de titulación, escritos a partir de lo construido y verificado en el repositorio.
Cada afirmación remite a su fuente (código, ADR, prueba o documento); los números salen de las pruebas y de git, no se inventan.
Lo que depende de la institución o de un proveedor de IA real **no** aparece como resultado: figura como pendiente.

| Capítulo                                                         | Contenido                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [1. Arquitectura](01-arquitectura.md)                            | Componentes, flujos, decisiones (ADR) y modelo de datos                   |
| [2. Privacidad y seguridad](02-privacidad-y-seguridad.md)        | Seudonimización, permisos, auditoría, revisión OWASP y seguridad de la IA |
| [3. Inteligencia artificial y evaluación](03-ia-y-evaluacion.md) | Extracción, asistente, analítica, recomendaciones, RAG y su evaluación    |
| [4. Pruebas y resultados](04-pruebas-y-resultados.md)            | Estrategia de pruebas, cifras verificadas y lo que falta medir            |

## Cómo usarlos

1. Los capítulos son una base: se completan con el marco teórico, el levantamiento (entrevistas, sílabos reales) y el piloto.
2. Las métricas de calidad de IA (F1 de extracción, pertinencia de las recomendaciones, RNF-01 a RNF-03) y la encuesta SUS se
   agregan cuando existan los sílabos reales (D-03), un proveedor de IA (D-07) y los docentes del piloto (D-09).
3. Al cambiar el código, actualizar el capítulo afectado en la misma rama `docs/*`.
