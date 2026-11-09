# ADR-003: Worker documental en TypeScript

- **Estado:** Propuesta
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
- Se debe probar con los sílabos reales en el Sprint 4 antes de cerrar la decisión.
