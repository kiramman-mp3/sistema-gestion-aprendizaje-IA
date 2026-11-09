# ADR-006: JWT de vida corta entre el plugin y el backend

- **Estado:** Propuesta
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
