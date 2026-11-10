# Sílabos sintéticos

Doce programas analíticos **ficticios** para ejercitar la carga, la extracción de texto, el OCR y el medidor de F1 mientras
la institución entrega los sílabos reales (D-03). Tomaron como modelo **la estructura** de un programa analítico real
(portada, información general, objetivos, contenido por unidades con horas y resultado de aprendizaje, metodología,
evaluación por componentes, bibliografía y validación); todo el contenido es inventado: asignaturas genéricas,
docentes, códigos, editoriales y libros que no existen. El documento real que sirvió de modelo no está en el repositorio.

> [!WARNING]
> Las métricas que salgan de estos archivos **no son válidas para la tesis**. Sirven para comprobar que el flujo funciona
> y para detectar regresiones del worker. El F1 real se mide con los sílabos de la institución.

## Contenido

| Formato                | Cantidad | Qué prueba                                                                                   |
| ---------------------- | -------- | -------------------------------------------------------------------------------------------- |
| PDF con texto          | 8        | Encabezados por tamaño de letra, párrafos, varias páginas                                    |
| DOCX                   | 2        | Estilos de título y la tabla de unidades                                                     |
| PDF escaneado (imagen) | 2        | OCR con Tesseract; la extracción debe marcarse con confianza baja para que el docente revise |

Variaciones entre los sílabos (ver `manifest.json`): de 3 a 5 unidades, porcentajes de evaluación distintos (40/30/30,
35/35/30, 30/30/40…), cuatro con fechas por unidad y ocho sin ellas (la extracción no debe inventarlas), uno sin objetivo
general, dos con errores de codificación en la bibliografía (`SuÃ¡rez`, como los trae un documento real), cuatro marcados
«Borrador» y periodos académicos alternados.

Cada `NN-asignatura.expected.json` es la extracción correcta en el esquema v1 (validada con `syllabusExtractionSchema` y
`findConsistencyIssues` al generarla). Convención para un programa analítico sin parciales: un único periodo de
calificación con el nombre del periodo académico y sin ponderación, y las unidades dentro de él; los componentes de
evaluación (contacto con el docente, práctico experimental y autónomo) van como instrumentos de evaluación.

## Cómo se generan y se miden

```bash
pnpm synthetic:syllabi     # regenera los archivos (los escaneados necesitan Docker)
pnpm eval:text             # recall del texto extraído, PDF y DOCX, sin OCR
pnpm eval:text:docker      # lo mismo dentro de la imagen del worker, con OCR de los escaneados
```

`pnpm eval:text` mide qué parte de lo esperado llega al texto que extrae el worker (datos del curso, unidades, temas,
resultados, porcentajes, metodologías, fechas y bibliografía); no usa ningún modelo de IA. Para medir el F1 de la
extracción estructurada, `pnpm eval:extraction` necesita además un `NN-asignatura.actual.json` con lo que devolvió el
sistema (`GET /syllabi/:id/extraction`, campo `content`), que solo tiene sentido con un proveedor de IA real.
