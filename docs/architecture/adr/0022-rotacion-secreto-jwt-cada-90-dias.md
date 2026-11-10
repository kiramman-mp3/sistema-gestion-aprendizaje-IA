# ADR-022: Rotación del secreto JWT cada 90 días

- **Estado:** Aceptada (la periodicidad se puede ajustar con la política de seguridad de la institución)
- **Fecha:** 2026-11-10
- **Sprint:** S12 (hallazgo H-6 de la [revisión OWASP](../../security/revision-owasp.md))

## Contexto

El plugin firma con HS256 el token de 5 minutos y un solo uso que usa el backend (ADR-006). El secreto es compartido por
ambos extremos y la revisión de seguridad dejó abierto cada cuánto rotarlo.

## Decisión

1. **Se rota cada 90 días**, y de inmediato si se sospecha que se expuso (por ejemplo, un acceso indebido al servidor
   o una persona con acceso que deja el equipo).
2. **Procedimiento manual** (documentado en la [guía de instalación y operación](../../operacion/instalacion-y-operacion.md)):
   valor nuevo de 32 bytes o más (`openssl rand -hex 32`) en `PLUGIN_JWT_SECRET` del backend y en el ajuste del plugin
   **a la vez**; se reinicia el backend. Los tokens en vuelo (5 minutos) fallan una vez y el plugin pide uno nuevo.
3. Se anota la fecha de cada rotación en el registro de cambios del servidor; el recordatorio queda en el calendario del
   administrador.
4. El token de Moodle del usuario de integración (`setup_integration.php --rotate`) se rota con la misma periodicidad.

## Alternativas consideradas

| Alternativa                        | Por qué no se eligió                                                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Rotación automática con dos claves | Exige que el backend acepte dos secretos a la vez y un identificador de clave en el token; es más complejo y no se justifica con un sitio |
| Cambiar a firma asimétrica (RS256) | El plugin tendría que guardar una clave privada en Moodle; el riesgo es el mismo y se añade complejidad                                   |
| No rotar                           | Un secreto filtrado serviría indefinidamente                                                                                              |

## Consecuencias

- Una rotación cuesta un reinicio breve del backend y, como mucho, una petición fallida por usuario.
- La rotación automática con doble clave queda como mejora si la institución exige periodos más cortos.
