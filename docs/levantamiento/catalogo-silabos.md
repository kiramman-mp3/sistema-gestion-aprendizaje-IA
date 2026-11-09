# Catálogo de sílabos

Sprint 1 (D-03). Registro de los sílabos reunidos para diseñar la extracción y formar el conjunto de
referencia. Los archivos anonimizados se guardan en `tests/fixtures/syllabi/` con un código; los
originales no se suben al repositorio.

## Criterios de anonimización

- Quitar nombres, correos, teléfonos y firmas de docentes y autoridades.
- Conservar la estructura, las tablas, las fechas y las ponderaciones tal como aparecen.
- No incluir listas de estudiantes ni calificaciones.

## Registro

| Código | Formato | Páginas | Plantilla institucional | Texto seleccionable | Tablas | Fechas | Ponderaciones | Unidades | RA  | Observaciones |
| ------ | ------- | ------- | ----------------------- | ------------------- | ------ | ------ | ------------- | -------- | --- | ------------- |
| S01    |         |         |                         |                     |        |        |               |          |     |               |
| S02    |         |         |                         |                     |        |        |               |          |     |               |
| S03    |         |         |                         |                     |        |        |               |          |     |               |

Columnas: **Tablas**, **Fechas** y **Ponderaciones** indican si el sílabo las contiene (Sí/No/Parcial);
**Unidades** y **RA** indican cuántas tiene, contadas a mano. Ese conteo manual es la base para medir
IA-01 e IA-02.

## Conclusiones para el diseño (completar al cerrar D-03)

- Formatos predominantes:
- ¿Hace falta OCR? (ADR-003):
- Secciones comunes a todas las plantillas:
- Cambios necesarios en el esquema v1 (`packages/contracts`):
