# 2. Privacidad y seguridad

## 2.1 Principio

El sistema **no necesita saber quién es un estudiante** para ayudar al docente. Por eso el backend y el proveedor de IA solo
reciben identificadores de Moodle y seudónimos, y los nombres los pone la sesión de Moodle del docente en el navegador
([ADR-010](../architecture/adr/0010-seudonimizacion.md), [ADR-017](../architecture/adr/0017-lecturas-moodle-solo-ids.md),
[análisis de privacidad](../security/analisis-privacidad.md)).

## 2.2 Controles

| Riesgo                                       | Control                                                                                                                                                      | Evidencia                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Datos personales hacia la IA                 | Las funciones de lectura devuelven solo ids (esquemas estrictos); el modelo ve seudónimos derivados con HMAC; el texto libre pierde correos y números largos | `packages/contracts/src/moodle/read.ts`, `privacy/pseudonymizer.ts`, prueba SEC-07                        |
| Acceso a cursos o funciones sin permiso      | Cada petición pregunta a Moodle qué puede hacer el docente en el curso del token; 404 en lugar de 403 para recursos ajenos                                   | `CourseAccessGuard`, pruebas SEC-01 y SEC-02                                                              |
| Reutilización o falsificación de tokens      | JWT HS256 de 5 minutos y un solo uso (`jti` en Redis), emisor y audiencia verificados; el secreto se rota cada 90 días                                       | [ADR-022](../architecture/adr/0022-rotacion-secreto-jwt-cada-90-dias.md), SEC-03                          |
| Archivos maliciosos                          | Tipo real por contenido, sin macros, límite de descompresión, ClamAV; el worker corre sin acceso a la base y sin red                                         | SEC-05, `smoke:silabos`                                                                                   |
| Instrucciones maliciosas en documentos       | El texto del documento y los pasajes recuperados llegan como datos delimitados cuyas etiquetas no se pueden cerrar                                           | SEC-06 (`chat-attacks*.spec.ts`, `recommendations-documents.spec.ts`)                                     |
| Un modelo que actúa por su cuenta            | Solo existen herramientas de lectura; las de escritura no se le ofrecen; una herramienta que no existe no se ejecuta                                         | `ai-orchestrator.service.ts`                                                                              |
| Recomendaciones con diagnósticos o etiquetas | Validador de lenguaje con un reintento; si falla, no se guarda nada                                                                                          | `pedagogical-language.ts`                                                                                 |
| Abuso de uso y de costo                      | Límite de peticiones por minuto, tope diario de mensajes, tokens y recomendaciones por docente; alertas de consumo                                           | `rate-limit.guard.ts`, `usage-quota.service.ts`, `check-ai-usage.sh`                                      |
| Información de la auditoría                  | Solo metadatos escalares, sin nombres, notas, tokens ni texto de mensajes; la consulta exige la capacidad `administer`                                       | `audit.service.ts`, [ADR-020](../architecture/adr/0020-capacidad-administer-y-rutas-de-administracion.md) |
| Conservación excesiva                        | Archivos (30 días), conversaciones (90) y snapshots (365) se borran solos; plazos provisionales hasta la política D-08                                       | `maintenance/`                                                                                            |

## 2.3 Revisión OWASP

La [revisión del OWASP Top 10 (2021) y de los riesgos de API](../security/revision-owasp.md) encontró 8 hallazgos: 6 corregidos
(entre ellos una dependencia con una vulnerabilidad alta, la falta de límite de peticiones, las cabeceras de seguridad, el
secreto compartido sin política de rotación y las imágenes sin digest), 1 en curso (PHPUnit en el CI) y 1 aceptado (avisos de
herramientas de desarrollo que no llegan a producción). El CI falla con una vulnerabilidad alta o crítica en producción.

## 2.4 Lo que queda pendiente

- Repetir SEC-06 y SEC-07 con el proveedor de IA real: hoy se prueban con un modelo simulado que **obedece al atacante**.
- La política institucional de datos personales y de proveedores externos (D-08), el aval ético y el consentimiento del piloto
  (los borradores están en `docs/levantamiento/`).
- El tratamiento del texto libre que los estudiantes escriban en foros o entregas, que dependerá de esa política.
