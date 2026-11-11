# 3. Inteligencia artificial y evaluación

## 3.1 Qué hace la IA y qué no

| Función               | La IA hace                                                   | El sistema, con reglas fijas, hace                                                                                  |
| --------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Extracción del sílabo | Pasar el texto al esquema v1 y marcar lo dudoso              | Verificar cada dato contra el texto, anular fechas y ponderaciones que el documento no trae, detectar incoherencias |
| Chat                  | Elegir herramientas y redactar la respuesta                  | Consultar Moodle, calcular entregas y notas, citar fuentes y criterios                                              |
| Recomendaciones       | Redactar estrategias a partir de las evidencias y del sílabo | Reunir las evidencias, rechazar diagnósticos y etiquetas, declarar lo desconocido                                   |
| Analítica             | Nada                                                         | Todos los indicadores y las señales de dificultad                                                                   |

Una nota ausente no cuenta como cero, un dato que falta se muestra como guion y una lectura recortada deja el indicador sin valor
([ADR-018](../architecture/adr/0018-analitica-sin-snapshots-lecturas-completas.md)).

## 3.2 Proveedor de IA

El código no depende de ningún proveedor: `LlmProvider` y `EmbeddingProvider` son interfaces y `LlmService` aplica a toda llamada el
tope de tokens, el tiempo límite, la validación de la salida y el registro de consumo ([ADR-009](../architecture/adr/0009-abstraccion-proveedor-llm.md)).
Con `AI_PROVIDER=mock` hay un proveedor de demostración (extrae el sílabo de ejemplo, elige herramientas por palabras clave y
responde con los datos que obtuvo, avisándolo en cada respuesta) y embeddings por _feature hashing_. La elección del proveedor y su
presupuesto (D-07) está pendiente.

## 3.3 Recuperación de documentos (RAG)

Fragmentos de unos 900 caracteres con solapamiento y página, vectores de 1024 dimensiones en `pgvector` con índice HNSW, y una
búsqueda que filtra por el curso **dentro** de la consulta ([ADR-019](../architecture/adr/0019-rag-embeddings-pgvector.md)). Se probó con la
base real que el documento se indexa solo, que cada fragmento lleva su curso y su página, que el chat cita el documento con su
página, que cuando nada se parece lo dice y que un curso no ve los pasajes de otro.

## 3.4 Cómo se evaluará la calidad

Plan completo en el [plan de pruebas](../testing/plan-pruebas.md) (sección 13.3 del documento de requisitos):

| ID    | Métrica                                       | Meta   | Estado                                                                                                                       |
| ----- | --------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| IA-01 | F1 de extracción de unidades                  | ≥ 0.85 | Medidor listo (`pnpm eval:extraction`); espera sílabos reales (D-03) y un proveedor                                          |
| IA-02 | F1 de extracción de resultados de aprendizaje | ≥ 0.80 | Ídem                                                                                                                         |
| IA-03 | Exactitud de identificación de entregas       | ≥ 95 % | Función de Moodle verificada contra el curso de prueba; falta el conjunto de preguntas con respuesta verificada por docentes |
| IA-04 | Exactitud de cálculos académicos              | 100 %  | Pruebas unitarias de las funciones puras                                                                                     |
| IA-05 | Recomendaciones calificadas como pertinentes  | ≥ 70 % | Requiere un modelo real y la calificación de docentes                                                                        |
| IA-06 | Respuestas sin evidencia                      | ≤ 5 %  | Requiere un modelo real                                                                                                      |
| IA-07 | Abstención correcta cuando faltan datos       | ≥ 90 % | Requiere un modelo real                                                                                                      |

> [!WARNING]
> Los sílabos sintéticos ([README](../../tests/fixtures/synthetic-syllabi/README.md)) y el proveedor de demostración sirven
> para ejercitar el flujo y detectar regresiones. **No son una medida de la calidad de la IA** y no deben citarse como tal.

## 3.5 Lo medido hasta ahora (sin modelo real)

- **Extracción de texto del worker** sobre 12 sílabos sintéticos: 99,6 % de los datos esperados llegan al texto (100 % en PDF y DOCX,
  97,3 % en escaneados con OCR). El OCR leyó mal un porcentaje en los dos escaneados: por eso el texto de OCR se marca con
  «confianza baja».
- **Flujo completo con el proveedor de demostración:** carga, antivirus, worker, extracción que cumple el esquema v1, rechazo
  de archivos inválidos, búsqueda en documentos, chat con criterio y aclaración, analítica, snapshots y administración
  (`pnpm smoke:*`).
