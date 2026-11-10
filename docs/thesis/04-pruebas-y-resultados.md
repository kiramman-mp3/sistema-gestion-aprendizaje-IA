# 4. Pruebas y resultados

## 4.1 Estrategia

| Nivel             | Qué cubre                                                                                       | Herramienta                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Unitarias         | Funciones puras (indicadores, señales, generador de propuestas, fragmentos, seudonimización)    | Jest (backend), Vitest (contratos, worker, plugin)                                        |
| Integración       | Rutas con autorización negativa, concurrencia, idempotencia, límites                            | Jest + Supertest                                                                          |
| Plugin PHP        | Funciones externas, permisos (incluido un docente sin permiso), grupos separados, notas ocultas | PHPUnit sobre Moodle 5.1                                                                  |
| Plugin JavaScript | Modelos puros y pantallas en un DOM simulado                                                    | Vitest + jsdom                                                                            |
| Punta a punta     | Backend, Moodle, Redis, PostgreSQL, ClamAV y worker reales con datos sintéticos                 | `pnpm smoke:publicacion`, `smoke:asistente`, `smoke:silabos`                              |
| Seguridad         | SEC-01 a SEC-10 y la revisión OWASP                                                             | [Seguridad de la IA](../security/seguridad-ia.md), [OWASP](../security/revision-owasp.md) |
| Calidad de código | Estándar de código de Moodle, ESLint, Prettier, contrato OpenAPI, auditoría de dependencias     | `phpcs`, CI                                                                               |

## 4.2 Cifras verificadas (2026-11-10)

| Verificación                                    | Resultado                                                                                    |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Pruebas del backend                             | 756 correctas y 9 omitidas (opt-in con base real), 64 de 66 suites                           |
| Pruebas del JavaScript del plugin               | 321                                                                                          |
| Pruebas de los contratos / del worker           | 46 / 22                                                                                      |
| PHPUnit del plugin                              | 80 pruebas, 260 aserciones                                                                   |
| `phpcs` (moodle-cs)                             | 0 errores y 0 avisos                                                                         |
| Linter, formato, contrato OpenAPI, tipos, build | Sin errores                                                                                  |
| Verificaciones de punta a punta                 | `smoke:publicacion`, `smoke:asistente` y `smoke:silabos`: todas las comprobaciones correctas |
| Recall del texto extraído (sílabos sintéticos)  | 99,6 % (446 de 448)                                                                          |
| Prueba de carga `session`                       | 20 simultáneas durante 15 s: 1 236 peticiones por segundo, p95 20 ms, 0 errores              |

## 4.3 Lo que se encontró al verificar con sistemas reales

La verificación con Moodle real encontró errores que las pruebas unitarias y PHPUnit no mostraban: una petición de servicio web no carga
las bibliotecas de Moodle que sí carga la línea de comandos; una consulta de matriculados con una coma faltante; y que el
navegador ocultaba la cabecera `Retry-After` del 429 por falta de CORS. Los tres se corrigieron y quedaron cubiertos por pruebas.
Por eso cada bloque de trabajo se cerró con una verificación de punta a punta y no solo con pruebas unitarias.

## 4.4 Lo que falta medir

| Medición                                                  | Depende de                                     |
| --------------------------------------------------------- | ---------------------------------------------- |
| F1 de la extracción (IA-01, IA-02)                        | Sílabos reales (D-03) y proveedor de IA (D-07) |
| Calidad del chat y de las recomendaciones (IA-03 a IA-07) | Proveedor de IA real y docentes calificadores  |
| Latencia del chat (RNF-01 a RNF-03)                       | Proveedor de IA real                           |
| Ahorro de tiempo de planificación y encuesta SUS          | Piloto con docentes (D-09, D-10)               |
| SEC-06 y SEC-07 con el modelo real                        | Proveedor de IA real                           |
