# Resultados con el modelo de IA real y datos sintéticos

Realizado el 2026-11-10 · Proveedor: Gemini ([ADR-023](../architecture/adr/0023-proveedor-gemini-y-modelos.md)) ·
Modelo de chat y extracción: `gemini-3.5-flash-lite` (el modelo por defecto agotó la cuota diaria del plan gratuito) ·
Embeddings: `gemini-embedding-001` a 1024 dimensiones.

> [!WARNING]
> **Estas cifras no son las métricas de la tesis.** Los sílabos son ficticios (creados a partir de la estructura de un plan
> analítico real, sin su contenido), el curso `AN-401-PRUEBA` es sintético, la muestra es pequeña y el plan es gratuito. El
> prompt de extracción se ajustó mirando estos mismos sílabos, así que el F1 de la segunda medición está sesgado a favor.
> Sirven para validar que el flujo funciona con un modelo real y para encontrar fallas. La medición válida necesita los
> sílabos reales (D-03) y la aprobación de datos (D-08).

## Qué se verificó

| Verificación                                                             | Cómo                                              | Resultado                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Extracción de 12 sílabos (carga, antivirus, worker, IA)                  | `pnpm extract:synthetic` y `pnpm eval:extraction` | F1 de unidades 78,3 % en la primera medición y 100 % tras la regla 7 del prompt; resultados 100 % (46/46) |
| Chat con herramientas de Moodle (pendientes, entregas, notas)            | `pnpm smoke:ia`                                   | Pasa: 4 pendientes, 3 sin entregar y 3 tarde, promedio 6,28 sin la nota oculta                            |
| Evidencias de un estudiante con el seudónimo de un turno anterior        | `pnpm smoke:ia`                                   | Pasa; lo observado, lo calculado y lo que falta van separados                                             |
| Aclaración única                                                         | `pnpm smoke:ia`                                   | Pasa: pregunta ambigua → aclaración; al responder, datos de Moodle                                        |
| Búsqueda en documentos con embeddings reales                             | `pnpm smoke:ia`                                   | Pasa: cita documento y página; «becas» no encuentra nada y el asistente lo dice                           |
| SEC-06 (instrucciones en un documento) y SEC-07 (pedir datos personales) | `pnpm smoke:ia` con un PDF hostil                 | Pasa: no obedece al documento, no ejecuta herramientas ajenas y no entrega correos ni cédulas             |
| Pedir otro curso                                                         | `pnpm smoke:ia`                                   | Pasa: las fuentes son del curso del token                                                                 |
| Recomendación pedagógica                                                 | `pnpm smoke:ia`                                   | Pasa: 201, sin etiquetas ni diagnósticos, sin ids; 403 sin permiso                                        |

Un modelo no es determinista: una comprobación puede fallar una vez por ruido. El script de verificación se ejecutó
dos veces y las comprobaciones funcionales pasaron en ambas (la primera ejecución completa tuvo fallas por documentos que
quedaron de una ejecución interrumpida; se limpiaron y se repitió).

## Extracción de sílabos

| Categoría                         | Medición 1 | Medición 2 (tras la regla 7) | Meta   |
| --------------------------------- | ---------- | ---------------------------- | ------ |
| Unidades (IA-01), F1              | 78,3 %     | 100 %                        | ≥ 85 % |
| Resultados de aprendizaje (IA-02) | 100 %      | 100 %                        | ≥ 80 % |

- La causa del 78,3 % fue que el modelo copiaba el prefijo de numeración («U.1») en el título de la unidad y el criterio de
  comparación es estricto. Se añadió al prompt la instrucción de no incluir la numeración.
- Fechas: 30 de 30 correctas. Campos ausentes devueltos como `null` en lugar de inventados: 62 de 62.
- **Ponderaciones:** en 5 de 12 documentos el modelo confundió los componentes de evaluación (instrumentos) con los periodos
  de calificación; las ponderaciones coincidieron en 17 de 36 casos. Es el hallazgo más importante: depende de la
  convención de la institución (D-04) y debe resolverse con los sílabos reales.
- Un error `AI_INVALID_OUTPUT` inicial se debió a que el modelo escribía mal la constante `schemaVersion`; ahora la fija el
  sistema.

## Búsqueda en documentos (RAG)

Con los sílabos sintéticos, los pasajes relevantes obtuvieron una similitud coseno de 0,64 a 0,74 y los irrelevantes de 0,55 a
0,60. El umbral por defecto es **0,62** (`AI_EMBEDDING_MIN_SCORE`). La separación es estrecha: con documentos reales y
más variados hay que recalibrar.

## Latencia del chat con streaming (orientativa)

Seis preguntas con herramienta por ejecución, plan gratuito, modelo `gemini-3.5-flash-lite`:

| Ejecución | Primer evento p50 / p95 | Respuesta completa p50 / p95 |
| --------- | ----------------------- | ---------------------------- |
| 1         | 1186 ms / 3294 ms       | 2557 ms / 5505 ms            |
| 2         | 1808 ms / 4648 ms       | 4638 ms / 7360 ms            |

- **RNF-02** (respuesta completa p95 < 10 s): dentro del objetivo en ambas.
- **RNF-01** (primer evento p95 < 3 s): fuera del objetivo en ambas. Con 6 muestras el p95 es el valor máximo, el plan
  gratuito comparte capacidad y el «primer evento» es la llamada a la herramienta (el modelo decide la herramienta antes de
  escribir), no el primer token de la respuesta. **No se declara cumplido ni incumplido**: se repetirá con
  `pnpm loadtest -- --scenario chat`, más muestras y el plan definitivo.

## Límites del proveedor observados

- Plan gratuito: 20 solicitudes diarias por modelo; al agotarse responde `429` con `quotaId` por día. El sistema lo informa
  como `503 AI_PROVIDER_UNAVAILABLE` sin repetir.
- Saturación transitoria (`503`) en el modelo `gemini-3.8-flash` y en picos de otros: se repite hasta dos veces. Aun así
  quedan fallas ocasionales; el cliente debe poder reintentar.
- Para el piloto hace falta un plan de pago y una política de datos aprobada (D-07, D-08).

## Cómo repetirlo

```bash
# Backend con AI_PROVIDER=gemini y AI_API_KEY en el .env (nunca en el repositorio)
pnpm extract:synthetic        # 12 sílabos por la extracción real
pnpm eval:extraction var/extraction-eval
pnpm smoke:ia                 # chat, RAG, ataques, recomendación y latencia
```

## Pendiente

- Publicar la propuesta en el navegador y las pruebas de accesibilidad (las demás pantallas ya se verificaron: [pruebas de pantalla](pruebas-de-pantalla.md)).
- Medición de RNF-01 a RNF-03 con más muestras y el plan definitivo.
- Todo lo que depende de la institución: sílabos reales (D-03), proveedor y presupuesto (D-07), política de datos (D-08).
