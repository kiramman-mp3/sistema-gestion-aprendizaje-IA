# ADR-008: Creación de actividades mediante funciones externas del plugin

- **Estado:** Propuesta
- **Fecha:** 2026-11-09
- **Sprint:** S0 (implementación en S7)

## Contexto

Publicar una propuesta (RF-09) requiere crear secciones y actividades. Moodle no ofrece servicios web del núcleo para crear módulos como `assign`, `forum` o `quiz`.

## Decisión

El plugin expone funciones externas propias que crean secciones y módulos con las APIs internas de Moodle (`create_module()`), validando parámetros y la capacidad del docente.

## Alternativas consideradas

| Alternativa                   | Por qué no se eligió                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| Escribir en la base de Moodle | Prohibido por el documento de requisitos; omite cachés y eventos |
| Importar respaldos `.mbz`     | Poco control de errores por ítem y sin idempotencia              |

## Consecuencias

- Trabajo PHP adicional en el Sprint 7, con pruebas PHPUnit.
- Los tipos de actividad soportados dependen de D-05.
