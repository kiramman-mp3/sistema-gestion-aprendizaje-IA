# ADR-011: Entorno Moodle de desarrollo con moodle-docker

- **Estado:** Aceptada
- **Fecha:** 2026-11-09
- **Sprint:** S0

## Contexto

D-01 y D-02 fijan una instancia nueva de Moodle 5.1 en local. El ejemplo de Docker Compose del documento de requisitos usa `bitnami/moodle:latest`, que no tiene versión fija y cuyo catálogo gratuito fue retirado por Bitnami.

## Decisión

Usar el entorno oficial `moodlehq/moodle-docker` con el código de Moodle 5.1 en una versión fijada y datos sintéticos generados por script.

## Alternativas consideradas

| Alternativa             | Por qué no se eligió                           |
| ----------------------- | ---------------------------------------------- |
| `bitnami/moodle:latest` | Sin versión fija y con disponibilidad incierta |
| Instalación manual      | Difícil de reproducir entre equipos y en CI    |

## Consecuencias

- Moodle 5.1 usa el directorio `public/`; la ruta del plugin se verifica en el Sprint 2.
- El entorno de producción se define aparte en el Sprint 13.
