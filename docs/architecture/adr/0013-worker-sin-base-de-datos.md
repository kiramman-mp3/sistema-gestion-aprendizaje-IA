# ADR-013: Worker documental sin acceso a la base de datos

- **Estado:** Aceptada (implementada en el Sprint 4)
- **Fecha:** 2026-11-09
- **Sprint:** S4

## Contexto

El worker documental abre archivos que suben los docentes con pdf.js, un analizador de ZIP y XML, Poppler y Tesseract. Es la parte del sistema más expuesta a archivos maliciosos. Si tuviera la cadena de conexión de PostgreSQL, un fallo en cualquiera de esos analizadores daría acceso a todos los datos de la capa inteligente.

## Decisión

El worker no recibe credenciales de la base de datos ni de Moodle. Solo tiene Redis y el almacén de archivos en solo lectura.

- El backend encola un **flujo de BullMQ**: un trabajo padre en `document-text-results` (lo procesa el backend) con un hijo en `document-text` (lo procesa el worker).
- El worker devuelve el texto como resultado del hijo. Los errores del documento se informan con `UnrecoverableError` y solo un código del contrato (`ENCRYPTED_DOCUMENT`, `CORRUPT_DOCUMENT`, `EMPTY_DOCUMENT`, `DOCUMENT_TOO_COMPLEX`), sin reintentos.
- Con `ignoreDependencyOnFailure`, el padre se procesa también cuando el hijo agota sus reintentos. El backend valida el resultado con `documentTextSchema` de `@smart-lms/contracts` antes de guardarlo; un resultado que no cumple el contrato se guarda como `INVALID_WORKER_RESULT`.
- En Docker Compose el worker corre con el sistema de archivos en solo lectura, sin capacidades de Linux, con `no-new-privileges` y con 1 GB de memoria como máximo.

## Alternativas consideradas

| Alternativa                                    | Por qué no se eligió                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| Worker con Prisma y acceso a la base           | Un analizador comprometido tendría acceso a todos los datos              |
| Backend escucha eventos `completed` de BullMQ  | Los eventos se pierden si el backend está caído; el flujo es persistente |
| Worker llama a un endpoint interno del backend | Suma otra credencial y otra superficie HTTP                              |

## Consecuencias

- El texto viaja por Redis una vez; un sílabo extraído ocupa pocos cientos de KB.
- Los trabajos son idempotentes: el backend solo actualiza documentos en `PROCESSING`.
- El progreso se lee del trabajo hijo en Redis mientras existe; después, del estado en PostgreSQL.
