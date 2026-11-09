# Procesamiento de sílabos

Implementación del Sprint 4: carga segura (RF-03) y extracción de texto (RF-04). Decisiones en
[ADR-003](adr/0003-worker-documental-typescript.md), [ADR-004](adr/0004-cola-bullmq-redis.md) y
[ADR-013](adr/0013-worker-sin-base-de-datos.md).

## Flujo

```mermaid
sequenceDiagram
    participant N as Navegador (página del asistente)
    participant B as Backend
    participant C as ClamAV
    participant A as Almacén de archivos
    participant R as Redis (BullMQ)
    participant W as Worker documental
    participant P as PostgreSQL
    N->>B: POST /syllabi (multipart, JWT del plugin)
    B->>B: guards, extensión, magic bytes, macros, bomba ZIP, SHA-256, duplicado
    B->>C: zINSTREAM
    C-->>B: OK o firma detectada
    B->>A: guarda syllabi/<uuid>.<ext>
    B->>P: syllabus_documents (UPLOADED)
    B->>R: flujo: padre document-text-results + hijo document-text
    B->>P: PROCESSING
    B-->>N: 202 con id y progreso 0
    W->>R: toma el hijo
    W->>A: lee el archivo (solo lectura)
    W->>W: pdf.js / DOCX; OCR de páginas sin texto
    W-->>R: resultado o código de error
    B->>R: procesa el padre con el resultado del hijo
    B->>B: valida con documentTextSchema
    B->>P: TEXT_READY con extracted_text, o FAILED con error_code
    loop cada 2 s
        N->>B: GET /syllabi/:id
        B-->>N: estado, progreso, páginas y confianza
    end
```

## Piezas

| Pieza                        | Ubicación                                                  | Responsabilidad                                                      |
| ---------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `detectDocumentKind`         | `apps/api/src/syllabi/file-signature.ts`                   | Tipo por contenido, extensión, macros y tamaño descomprimido de DOCX |
| `ClamavClient`               | `apps/api/src/antivirus/clamav.client.ts`                  | Protocolo `zINSTREAM` de clamd por TCP, sin dependencias             |
| `LocalFileStorage`           | `apps/api/src/storage/file-storage.ts`                     | Escritura atómica con claves aleatorias que no salen de la raíz      |
| `SyllabiService`             | `apps/api/src/syllabi/syllabi.service.ts`                  | Carga y consulta de estado                                           |
| `SyllabusProcessingService`  | `apps/api/src/syllabi/syllabus-processing.service.ts`      | Encola el flujo y lee el progreso                                    |
| `DocumentTextResultsHandler` | `apps/api/src/syllabi/document-text-results.handler.ts`    | Valida y guarda el resultado del worker                              |
| `SyllabusMaintenanceService` | `apps/api/src/maintenance/syllabus-maintenance.service.ts` | Borra archivos vencidos y vuelve a encolar cargas atascadas          |
| Contratos de la cola         | `packages/contracts/src/documents/text.ts`                 | Trabajo, resultado y códigos de error compartidos                    |
| `extractPdf`                 | `apps/document-worker/src/extract/pdf.ts`                  | Texto por página, encabezados por tamaño de letra y párrafos         |
| `extractDocx`                | `apps/document-worker/src/extract/docx.ts`                 | Encabezados por estilo, párrafos, tablas y páginas estimadas         |
| `TesseractPdfOcr`            | `apps/document-worker/src/extract/ocr.ts`                  | `pdftoppm` y `tesseract -l spa` con `execFile`, sin shell            |
| Pantalla de carga            | `moodle/local/ai_assistant/amd/src/syllabus.js`            | Envía el archivo, consulta el estado y muestra el resultado          |

## Estados del documento

| Estado       | Significado                                                                  |
| ------------ | ---------------------------------------------------------------------------- |
| `UPLOADED`   | Guardado, todavía sin encolar (Redis no respondió); se encola en ≤ 5 minutos |
| `PROCESSING` | En la cola o en el worker; el progreso va de 0 a 100                         |
| `TEXT_READY` | Texto extraído y guardado en `extracted_text`; listo para el Sprint 5        |
| `FAILED`     | El documento no se pudo procesar; `error_code` dice por qué                  |

Los archivos rechazados en la carga no se guardan ni crean fila: quedan solo en la auditoría
(`syllabus.rejected`).

## Resultado de la extracción

`extracted_text` cumple `documentTextSchema`: una lista de bloques `heading` (con nivel), `paragraph` y
`table` (filas de celdas) en orden de lectura, cada uno con su página. `pagesApproximate` es `true` en
DOCX y `confidence` es `low` si alguna página salió de OCR.

| Formato       | Páginas                                  | Encabezados           | Tablas                   |
| ------------- | ---------------------------------------- | --------------------- | ------------------------ |
| PDF digital   | Exactas                                  | Por tamaño de letra   | No; llegan como párrafos |
| PDF escaneado | Exactas                                  | No; todo es párrafo   | No                       |
| DOCX          | Estimadas por los saltos que guardó Word | Por estilo de párrafo | Sí                       |

## Códigos de error

| HTTP | `code`                  | Causa                                                          |
| ---- | ----------------------- | -------------------------------------------------------------- |
| 400  | `FILE_REQUIRED`         | Falta el archivo en el campo `file`                            |
| 403  | `FORBIDDEN_COURSE`      | `courseId` distinto del curso del token                        |
| 404  | `SYLLABUS_NOT_FOUND`    | El sílabo no existe o es de otro curso                         |
| 409  | `DUPLICATE_SYLLABUS`    | El mismo archivo ya se cargó en el curso; `details` trae su id |
| 413  | `PAYLOAD_TOO_LARGE`     | Más de 10 MB                                                   |
| 415  | `EXTENSION_NOT_ALLOWED` | La extensión no es `.pdf` ni `.docx`                           |
| 415  | `MIME_MISMATCH`         | El contenido no corresponde a la extensión                     |
| 415  | `MACROS_NOT_ALLOWED`    | DOCX con `vbaProject.bin`                                      |
| 415  | `ARCHIVE_TOO_LARGE`     | El DOCX declara más de 100 MB descomprimido                    |
| 422  | `MALWARE_DETECTED`      | ClamAV detectó una firma                                       |
| 503  | `ANTIVIRUS_UNAVAILABLE` | clamd no respondió; el archivo no se acepta                    |

Códigos de `error_code` cuando el procesamiento falla: `ENCRYPTED_DOCUMENT`, `CORRUPT_DOCUMENT`,
`EMPTY_DOCUMENT` (sin texto, ni con OCR), `DOCUMENT_TOO_COMPLEX` (más de 300 páginas o más de 40 para
OCR), `INVALID_WORKER_RESULT` y `TEXT_EXTRACTION_FAILED` (cualquier otro fallo tras 3 intentos).

## Retención

El archivo original se conserva `SYLLABUS_RETENTION_DAYS` días (30 por defecto, propuesta de
RNF-08 pendiente de D-08). Cada día a las 03:00 el backend borra los archivos vencidos y deja
`storage_key` en nulo; la fila y el texto extraído se conservan. Cada borrado se audita como
`syllabus.file_purged`.

## Evidencia

| Caso                                | Cómo se verificó                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| FUN-01 Carga de PDF y DOCX          | e2e y contra el backend real: 202, `PROCESSING` y luego `TEXT_READY`                                  |
| FUN-02 Extensión falsa              | e2e y real: 415 `MIME_MISMATCH`, sin archivo guardado y auditado                                      |
| SEC-05 Archivo malicioso            | DOCX con el archivo de prueba EICAR contra ClamAV 1.5.4: 422 y `syllabus.rejected` con la firma       |
| SEC-01 Sílabo de otro curso         | e2e: 404 `SYLLABUS_NOT_FOUND` con un token de otro curso                                              |
| RF-04 Páginas, encabezados y tablas | Pruebas del worker; PDF de 2 páginas y DOCX con tabla procesados por el worker en Docker              |
| RF-04 OCR con confianza baja        | PDF escaneado sintético procesado por Tesseract en el contenedor: texto exacto y `confidence: low`    |
| Reintento de cargas atascadas       | 4 documentos `UPLOADED` se encolaron al arrancar el backend                                           |
| Retención                           | Con `retain_until` vencido, 3 archivos borrados, filas conservadas y 3 eventos `syllabus.file_purged` |
| Pantalla de carga                   | Chrome como `docente1`: PDF escaneado subido, aviso de OCR, sin errores en consola                    |
