# ADR-003: Worker documental en TypeScript

- **Estado:** Aceptada de forma provisional (implementada en el Sprint 4; falta confirmarla con los sílabos de D-03)
- **Fecha:** 2026-11-09
- **Sprint:** S0 (confirmar en S1 con los sílabos de D-03)

## Contexto

El documento de requisitos propone Python para procesar PDF y DOCX. Eso suma un tercer lenguaje (PHP, TypeScript y Python) para un equipo pequeño.

## Decisión

Escribir el worker en TypeScript (`apps/document-worker`) con bibliotecas de Node para PDF y DOCX, y OCR opcional. Se cambia a Python solo si los sílabos reales necesitan extracción de tablas u OCR que Node no resuelva bien.

## Alternativas consideradas

| Alternativa      | Por qué no se eligió                                      |
| ---------------- | --------------------------------------------------------- |
| Worker en Python | Mejores bibliotecas de tablas, pero añade un tercer stack |

## Consecuencias

- Contratos compartidos con el backend sin generar tipos entre lenguajes.
- Implementación del Sprint 4 (`apps/document-worker`):
  - PDF con pdf.js 6: texto por página, encabezados reconocidos por tamaño de letra y párrafos por separación vertical. pdf.js no reconstruye tablas: su contenido llega como párrafos.
  - DOCX con fflate y fast-xml-parser: encabezados por estilo (incluidos los nombres localizados de Word), párrafos y tablas. Las páginas se estiman con los saltos que guardó Word.
  - OCR con Poppler (`pdftoppm`) y Tesseract en español, instalados en la imagen. Solo pasan por OCR las páginas sin texto, y el documento se marca con confianza baja.
- Queda por medir la calidad con los sílabos reales; si las tablas de los PDF resultan críticas, se evalúa un extractor en Python solo para ese paso.
