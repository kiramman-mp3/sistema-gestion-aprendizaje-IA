# Prototipos de baja fidelidad

Sprint 1. Esquemas de las pantallas del plugin `local_ai_assistant` (sección 11 del documento de
requisitos), para validar con los docentes antes de construir. Todos los datos son ficticios. Las
pantallas se integran en la interfaz de Moodle (tema Boost) y usan sus componentes.

## P1 · Panel del docente

```text
┌─ Asistente IA ─────────────────────────────────────────────── Curso: [Ingeniería de Software ▾] ┐
│                                                                                                 │
│  Pendientes                     Indicadores del curso                     Alertas (3)          │
│  ┌──────────────────────────┐   ┌──────────────────────────────────────┐ ┌──────────────────┐  │
│  │ 12 entregas por calificar│   │ Entregas     78 %   (i)              │ │ ● 2 estudiantes  │  │
│  │  4 sin entregar (Tarea 3)│   │ Promedio     7.9/10 (i)              │ │   con 3 tareas   │  │
│  │ [Ver en Moodle]          │   │ Unidad baja  U2 · 6.4 (i)            │ │   sin entregar   │  │
│  └──────────────────────────┘   └──────────────────────────────────────┘ │ [Ver por qué]    │  │
│                                                                           └──────────────────┘  │
│  Planificación                                    Chat                                          │
│  ┌──────────────────────────────────────────┐    ┌──────────────────────────────────────────┐   │
│  │ Sílabo v2 · revisado     [Ver]           │    │ Pregunta algo sobre tu curso…     [→]    │   │
│  │ Propuesta · APROBADA     [Publicar]      │    └──────────────────────────────────────────┘   │
│  │ [+ Cargar sílabo]                        │                                                   │
│  └──────────────────────────────────────────┘    Historial de recomendaciones  [Ver]           │
│                                                                                                 │
│  ⓘ Este asistente usa IA. Sus sugerencias requieren tu revisión.                                │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

(i) abre la definición del indicador (RF-15). "Ver por qué" muestra la regla que activó la alerta (RF-16).

## P2 · Generación del curso (asistente por pasos)

```text
 ① Cargar ── ② Extraer ── ③ Revisar ── ④ Propuesta ── ⑤ Publicar
```

### Paso ① Cargar

```text
┌──────────────────────────────────────────────────────────────┐
│  Arrastra el sílabo aquí o [Elegir archivo]                   │
│  PDF o DOCX · máximo 10 MB                                    │
│                                                               │
│  ⚠ Este archivo ya se cargó el 12/11. [Usar el anterior]      │
└──────────────────────────────────────────────────────────────┘
```

### Paso ② Extraer

```text
  Extrayendo texto…   ██████████░░░░░░  62 %
  Página 9 de 14 · Puedes cerrar esta ventana; te avisaremos.
```

### Paso ③ Revisar la extracción

```text
┌─ Datos detectados ──────────────────────────────── Confianza: media ─┐
│ Asignatura   [Ingeniería de Software        ]                        │
│ Periodo      [2026-2027                     ]                        │
│                                                                      │
│ Resultados de aprendizaje                                    [+ RA]  │
│  RA1 [Especifica requisitos de software       ]  pág. 2 ↗            │
│  RA2 [Diseña la arquitectura de un sistema    ]  pág. 2 ↗            │
│                                                                      │
│ Primer parcial   Ponderación [ 50 ]%                                 │
│  ▸ U1 Requisitos   16/11 – 11/12                                     │
│      · Especificación de requisitos  Tarea  04/12  30 %  RA1         │
│ Segundo parcial  Ponderación [ 50 ]%                                 │
│  ▸ U2 Arquitectura   [fechas ⚠ no encontradas]                       │
│      · Documento de arquitectura  Proyecto  [fecha ⚠]  [peso ⚠]  RA2 │
│                                                                      │
│ ⚠ 3 campos pendientes de completar  · 0 inconsistencias              │
│                                     [Guardar revisión]  [Continuar]  │
└──────────────────────────────────────────────────────────────────────┘
```

⚠ marca `uncertainFields` y advertencias de `findConsistencyIssues`. "pág. 2 ↗" abre la cita de origen.

### Paso ④ Propuesta

```text
┌─ Vista previa del curso ────────────────────────────────────────────┐
│ ☑ Sección: U1 Requisitos                                            │
│    ☑ [Etiqueta] Objetivos de la unidad                              │
│    ☑ [Tarea]    Especificación de requisitos · 04/12 · 30 %  [✎]    │
│ ☑ Sección: U2 Arquitectura                                          │
│    ☑ [Tarea]    Documento de arquitectura · sin fecha        [✎]    │
│                                                                     │
│ Estado: EN REVISIÓN          [Rechazar]  [Aprobar propuesta]        │
└─────────────────────────────────────────────────────────────────────┘
```

### Paso ⑤ Publicar

```text
┌─ Confirmar publicación ──────────────────────────────────────┐
│ Se crearán en "Ingeniería de Software":                       │
│   2 secciones · 1 etiqueta · 2 tareas                         │
│ Los elementos sin marcar no se crearán.                       │
│                                [Cancelar]  [Publicar ahora]   │
└──────────────────────────────────────────────────────────────┘

  Resultado: 4 creados · 1 con error
  ✗ Tarea "Documento de arquitectura": falta fecha obligatoria  [Corregir y reintentar]
```

## P3 · Chat

```text
┌─ Chat · Ingeniería de Software ─────────────────────────────────────┐
│ Tú: ¿Quién no entregó la tarea 3?                                    │
│                                                                      │
│ Asistente: 4 estudiantes no tienen entrega registrada en "Tarea 3".  │
│   ┌───────────────────────────┬──────────────┐                       │
│   │ Estudiante                │ Estado       │                       │
│   ├───────────────────────────┼──────────────┤                       │
│   │ Ana P.                    │ Sin entrega  │                       │
│   │ Luis M.                   │ Borrador     │                       │
│   └───────────────────────────┴──────────────┘                       │
│   Criterio: estado de entrega en Moodle distinto de "enviada".       │
│   Consultado: 09/11/2026 14:00 · Fuente: Tarea 3 ↗                   │
│                                                                      │
│ [Escribe tu pregunta…                                        ] [→]   │
└──────────────────────────────────────────────────────────────────────┘
```

## P4 · Análisis individual

```text
┌─ Estudiante: Ana P. · Ingeniería de Software ───────────────────────┐
│ DATOS OBSERVADOS (Moodle)                                           │
│  · 2 tareas sin entregar: Tarea 2, Tarea 3                          │
│  · Cuestionario U2: 5.0/10 · Taller U2: 5.5/10                      │
│ CÁLCULOS DEL SISTEMA                                                │
│  · Entregas: 60 % (curso: 78 %)  (i)                                │
│  · Promedio U2: 5.3 (umbral configurado: 7.0)  (i)                  │
│ INFORMACIÓN DESCONOCIDA                                             │
│  · No hay datos de asistencia ni de tutorías previas                │
│ ─────────────────────────────────────────────────────────────────── │
│ SUGERENCIAS DE IA (revisar antes de aplicar)                        │
│  · Guía de refuerzo sobre los temas de U2                           │
│  · Actividad formativa de baja ponderación                          │
│  · Tutoría individual                                               │
│ Cómo comprobar si funcionó: actividad equivalente en 2 semanas      │
│                                                                     │
│ [Descartar]  [Registrar seguimiento]                                │
└─────────────────────────────────────────────────────────────────────┘
```

Las cinco zonas cumplen la sección 11.3: datos observados, cálculos, interpretaciones de IA,
información desconocida y acciones.

## Preguntas para validar con docentes

1. ¿El panel P1 muestra lo que necesitas ver primero al entrar?
2. En P2 ③, ¿es claro qué datos faltan y dónde se encontraron los demás?
3. ¿Prefieres revisar la propuesta como lista (P2 ④) o directamente sobre el curso?
4. En P3, ¿la respuesta te da suficiente confianza para actuar?
5. En P4, ¿falta o sobra alguna sección?
