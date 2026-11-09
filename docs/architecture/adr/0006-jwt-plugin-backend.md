# ADR-006: JWT de vida corta entre el plugin y el backend

- **Estado:** Aceptada (implementada en el Sprint 3)
- **Fecha:** 2026-11-09
- **Sprint:** S0 (implementación en S3)

## Contexto

El backend llama a Moodle con un token de integración único. Con ese token Moodle no aplica los permisos del docente que hace la consulta, así que el backend necesita saber de forma fiable quién pide qué y en qué curso (RF-01, RF-02).

## Decisión

El plugin firma un JWT de vida corta (5 minutos como máximo) con `sub` (ID de usuario Moodle), `courseid`, `exp` y `jti`. El backend valida firma, expiración y que el `jti` no se haya usado antes.

## Alternativas consideradas

| Alternativa                               | Por qué no se eligió                                        |
| ----------------------------------------- | ----------------------------------------------------------- |
| Token de servicio web por usuario         | Gestión y rotación de muchos tokens; más superficie de fuga |
| Confiar en el ID enviado por el navegador | Suplantable                                                 |

## Consecuencias

- La clave de firma se guarda en la configuración del plugin y en el gestor de secretos del backend, nunca en el frontend.
- Se necesita guardar los `jti` usados (Redis) para evitar reutilización.

## Implementación

- Vida del token: 300 s, con 30 s de tolerancia de reloj. Emisor (`iss`): el `wwwroot` de Moodle, que el backend compara con `MOODLE_BASE_URL`. Audiencia: `smart-lms-api`.
- La verificación usa `node:crypto` en lugar de una biblioteca JWT: la versión vigente de `jose` es solo ESM y no funciona con Jest en CommonJS. Solo se acepta HS256.
- El navegador pide el token a Moodle con `local_ai_assistant_get_backend_token` (AJAX, sesión del usuario) antes de cada llamada.
- Detalle y evidencia: [`docs/architecture/autenticacion-autorizacion.md`](../autenticacion-autorizacion.md).
