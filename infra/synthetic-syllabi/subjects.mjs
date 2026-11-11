// Asignaturas ficticias para generar sílabos sintéticos. No describen cursos reales ni docentes reales.
// Cada una trae 3 a 5 unidades con sus temas y el resultado de aprendizaje que se declara en esa unidad.

export const SUBJECTS = [
  {
    slug: "bases-de-datos",
    name: "BASES DE DATOS",
    level: "TERCERO",
    objective:
      "Diseñar, implementar y consultar bases de datos relacionales que den soporte a las necesidades de información de una organización.",
    units: [
      {
        title: "Modelo relacional",
        topics: [
          "Entidades y relaciones",
          "Claves primarias y foráneas",
          "Normalización hasta la tercera forma",
        ],
        outcome: "Modela un problema de información con el modelo entidad-relación y lo normaliza",
      },
      {
        title: "Lenguaje SQL",
        topics: [
          "Consultas con SELECT",
          "Combinación de tablas",
          "Funciones de agregación",
          "Subconsultas",
        ],
        outcome: "Escribe consultas SQL que responden preguntas de negocio",
      },
      {
        title: "Transacciones y concurrencia",
        topics: ["Propiedades ACID", "Bloqueos", "Niveles de aislamiento"],
        outcome: "Explica cómo el motor garantiza la consistencia ante operaciones simultáneas",
      },
      {
        title: "Administración y rendimiento",
        topics: ["Índices", "Planes de ejecución", "Respaldo y recuperación"],
        outcome: "Mejora el rendimiento de una base de datos y define su plan de respaldo",
      },
    ],
  },
  {
    slug: "redes-de-computadoras",
    name: "REDES DE COMPUTADORAS",
    level: "CUARTO",
    objective:
      "Comprender el funcionamiento de las redes de datos y configurar servicios básicos sobre la pila TCP/IP.",
    units: [
      {
        title: "Fundamentos de redes",
        topics: ["Modelo OSI y TCP/IP", "Medios de transmisión", "Topologías"],
        outcome: "Identifica las capas de una red y la función de cada una",
      },
      {
        title: "Direccionamiento IP",
        topics: ["Direcciones IPv4", "Subredes", "Introducción a IPv6"],
        outcome: "Diseña un plan de direccionamiento para una red local",
      },
      {
        title: "Enrutamiento y conmutación",
        topics: ["Tablas de enrutamiento", "Protocolos de enrutamiento", "VLAN"],
        outcome: "Configura el enrutamiento entre redes simples",
      },
      {
        title: "Servicios de red",
        topics: ["DNS", "DHCP", "HTTP y correo electrónico"],
        outcome: "Despliega servicios de red básicos y verifica su funcionamiento",
      },
      {
        title: "Seguridad básica",
        topics: ["Cortafuegos", "Listas de control de acceso", "VPN"],
        outcome: "Aplica medidas básicas de protección a una red",
      },
    ],
  },
  {
    slug: "estadistica-aplicada",
    name: "ESTADISTICA APLICADA",
    level: "SEGUNDO",
    objective:
      "Aplicar técnicas de estadística descriptiva e inferencial al análisis de datos de problemas reales.",
    units: [
      {
        title: "Estadística descriptiva",
        topics: ["Tablas de frecuencia", "Medidas de tendencia central", "Medidas de dispersión"],
        outcome: "Resume y presenta un conjunto de datos con medidas y gráficos",
      },
      {
        title: "Probabilidad",
        topics: [
          "Eventos y espacio muestral",
          "Probabilidad condicional",
          "Distribuciones discretas y continuas",
        ],
        outcome: "Calcula probabilidades de eventos con las distribuciones más usadas",
      },
      {
        title: "Inferencia estadística",
        topics: ["Intervalos de confianza", "Pruebas de hipótesis", "Prueba t y ji cuadrado"],
        outcome: "Contrasta hipótesis y valida conclusiones con datos",
      },
      {
        title: "Regresión",
        topics: ["Regresión lineal simple", "Correlación", "Regresión múltiple"],
        outcome: "Ajusta modelos de regresión e interpreta sus resultados",
      },
    ],
  },
  {
    slug: "programacion-web",
    name: "PROGRAMACION WEB",
    level: "QUINTO",
    objective:
      "Construir aplicaciones web con buenas prácticas de desarrollo, seguridad y despliegue.",
    units: [
      {
        title: "Fundamentos del desarrollo web",
        topics: ["HTML semántico", "CSS y diseño adaptable", "Accesibilidad"],
        outcome: "Maqueta páginas accesibles y adaptables",
      },
      {
        title: "JavaScript en el navegador",
        topics: ["El DOM", "Eventos", "Consumo de servicios con fetch"],
        outcome: "Programa interacciones en el cliente que consumen servicios web",
      },
      {
        title: "Servicios y persistencia",
        topics: ["API REST", "Autenticación", "Acceso a la base de datos"],
        outcome: "Implementa una API REST con autenticación y persistencia",
      },
      {
        title: "Calidad y despliegue",
        topics: ["Pruebas automatizadas", "Integración continua", "Contenedores"],
        outcome: "Automatiza las pruebas y el despliegue de una aplicación",
      },
    ],
  },
  {
    slug: "etica-profesional",
    name: "ETICA PROFESIONAL",
    level: "SEXTO",
    objective:
      "Analizar los dilemas éticos de la profesión informática y fundamentar decisiones responsables.",
    units: [
      {
        title: "Ética y profesión",
        topics: ["Conceptos de ética y moral", "Códigos de conducta profesional"],
        outcome: "Distingue los principios éticos que orientan el ejercicio profesional",
      },
      {
        title: "Privacidad y datos personales",
        topics: ["Derechos de las personas", "Tratamiento de datos", "Marco legal vigente"],
        outcome: "Evalúa el tratamiento de datos personales en un sistema de información",
      },
      {
        title: "Responsabilidad social",
        topics: ["Impacto de la tecnología", "Propiedad intelectual", "Software libre"],
        outcome: "Argumenta el impacto social de una decisión tecnológica",
      },
    ],
  },
  {
    slug: "gestion-de-proyectos",
    name: "GESTION DE PROYECTOS DE SOFTWARE",
    level: "SEPTIMO",
    objective:
      "Planificar, ejecutar y controlar proyectos de software con herramientas de gestión reconocidas.",
    units: [
      {
        title: "Inicio y alcance",
        topics: ["Acta de constitución", "Interesados", "Estructura de desglose del trabajo"],
        outcome: "Define el alcance de un proyecto de software",
      },
      {
        title: "Planificación",
        topics: ["Cronograma", "Estimación de esfuerzo", "Gestión de riesgos"],
        outcome: "Elabora el plan de un proyecto con cronograma y riesgos",
      },
      {
        title: "Ejecución y control",
        topics: ["Seguimiento del avance", "Gestión de cambios", "Indicadores de valor ganado"],
        outcome: "Controla el avance de un proyecto con indicadores",
      },
      {
        title: "Cierre y lecciones aprendidas",
        topics: ["Cierre administrativo", "Retrospectivas"],
        outcome: "Documenta las lecciones aprendidas de un proyecto",
      },
    ],
  },
  {
    slug: "inteligencia-artificial",
    name: "INTELIGENCIA ARTIFICIAL",
    level: "OCTAVO",
    objective:
      "Aplicar técnicas de inteligencia artificial para resolver problemas de clasificación, búsqueda y decisión.",
    units: [
      {
        title: "Búsqueda y resolución de problemas",
        topics: ["Búsqueda no informada", "Búsqueda heurística", "Juegos"],
        outcome: "Implementa algoritmos de búsqueda sobre problemas de decisión",
      },
      {
        title: "Aprendizaje supervisado",
        topics: ["Regresión y clasificación", "Árboles de decisión", "Evaluación de modelos"],
        outcome: "Entrena y evalúa modelos supervisados con datos reales",
      },
      {
        title: "Redes neuronales",
        topics: ["Perceptrón", "Retropropagación", "Redes convolucionales"],
        outcome: "Construye una red neuronal sencilla y explica su entrenamiento",
      },
      {
        title: "Ética y límites de la IA",
        topics: ["Sesgos", "Transparencia", "Uso responsable"],
        outcome: "Reconoce los sesgos y límites de un sistema de IA",
      },
      {
        title: "Proyecto integrador",
        topics: ["Definición del problema", "Preparación de datos", "Presentación de resultados"],
        outcome: "Resuelve un problema real aplicando un flujo completo de IA",
      },
    ],
  },
  {
    slug: "sistemas-operativos",
    name: "SISTEMAS OPERATIVOS",
    level: "TERCERO",
    objective: null,
    units: [
      {
        title: "Procesos y hilos",
        topics: ["Estados de un proceso", "Planificación", "Hilos"],
        outcome: "Explica cómo el sistema operativo gestiona procesos e hilos",
      },
      {
        title: "Memoria",
        topics: ["Paginación", "Memoria virtual", "Reemplazo de páginas"],
        outcome: "Analiza el uso de memoria de un sistema",
      },
      {
        title: "Archivos y almacenamiento",
        topics: ["Sistemas de archivos", "Permisos", "Entrada y salida"],
        outcome: "Administra archivos y permisos en un sistema operativo",
      },
    ],
  },
  {
    slug: "seguridad-informatica",
    name: "SEGURIDAD INFORMATICA",
    level: "SEPTIMO",
    objective:
      "Identificar amenazas y aplicar controles que protejan la información de una organización.",
    units: [
      {
        title: "Conceptos de seguridad",
        topics: [
          "Confidencialidad, integridad y disponibilidad",
          "Amenazas y vulnerabilidades",
          "Gestión de riesgos",
        ],
        outcome: "Identifica los riesgos de seguridad de un sistema",
      },
      {
        title: "Criptografía aplicada",
        topics: ["Cifrado simétrico y asimétrico", "Funciones hash", "Certificados"],
        outcome: "Aplica criptografía para proteger datos en reposo y en tránsito",
      },
      {
        title: "Seguridad de aplicaciones",
        topics: [
          "Vulnerabilidades web más comunes",
          "Validación de entradas",
          "Gestión de secretos",
        ],
        outcome: "Detecta y corrige vulnerabilidades comunes en una aplicación",
      },
      {
        title: "Respuesta a incidentes",
        topics: ["Detección", "Contención", "Recuperación"],
        outcome: "Plantea un procedimiento de respuesta a incidentes",
      },
    ],
  },
  {
    slug: "interaccion-humano-computador",
    name: "INTERACCION HUMANO COMPUTADOR",
    level: "QUINTO",
    objective:
      "Diseñar interfaces usables y accesibles a partir de las necesidades de las personas usuarias.",
    units: [
      {
        title: "Principios de usabilidad",
        topics: ["Heurísticas de Nielsen", "Modelos mentales"],
        outcome: "Evalúa la usabilidad de una interfaz con criterios reconocidos",
      },
      {
        title: "Investigación con usuarios",
        topics: ["Entrevistas", "Personas", "Mapas de recorrido"],
        outcome: "Levanta necesidades de usuarios con técnicas de investigación",
      },
      {
        title: "Prototipado y pruebas",
        topics: ["Prototipos de baja fidelidad", "Pruebas con usuarios", "Escala SUS"],
        outcome: "Prototipa una interfaz y la valida con usuarios",
      },
    ],
  },
  {
    slug: "arquitectura-de-software",
    name: "ARQUITECTURA DE SOFTWARE",
    level: "OCTAVO",
    objective:
      "Diseñar y documentar arquitecturas de software que satisfagan atributos de calidad.",
    units: [
      {
        title: "Atributos de calidad",
        topics: ["Rendimiento", "Disponibilidad", "Mantenibilidad"],
        outcome: "Relaciona los atributos de calidad con decisiones de arquitectura",
      },
      {
        title: "Estilos y patrones",
        topics: ["Capas", "Microservicios", "Orientada a eventos"],
        outcome: "Selecciona un estilo arquitectónico para un problema dado",
      },
      {
        title: "Documentación de arquitectura",
        topics: ["Vistas", "Diagramas C4", "Registros de decisiones"],
        outcome: "Documenta una arquitectura con vistas y registros de decisión",
      },
      {
        title: "Evaluación de arquitecturas",
        topics: ["Escenarios de calidad", "Análisis de compromisos"],
        outcome: "Evalúa una arquitectura frente a escenarios de calidad",
      },
    ],
  },
  {
    slug: "calculo-diferencial",
    name: "CALCULO DIFERENCIAL",
    level: "PRIMERO",
    objective:
      "Resolver problemas de variación y optimización con los conceptos del cálculo diferencial.",
    units: [
      {
        title: "Límites y continuidad",
        topics: ["Noción de límite", "Propiedades", "Continuidad"],
        outcome: "Calcula límites y analiza la continuidad de funciones",
      },
      {
        title: "La derivada",
        topics: ["Definición", "Reglas de derivación", "Regla de la cadena"],
        outcome: "Deriva funciones de una variable con las reglas básicas",
      },
      {
        title: "Aplicaciones de la derivada",
        topics: ["Máximos y mínimos", "Razones de cambio", "Optimización"],
        outcome: "Resuelve problemas de optimización y razones de cambio",
      },
    ],
  },
];

/** Libros ficticios; los autores y las editoriales no existen. */
export const BOOKS = [
  {
    authors: "Valdivieso Ramos, E.",
    year: 2021,
    title: "Fundamentos prácticos de la asignatura",
    publisher: "Editorial Andina Ficticia",
    kind: "Virtual",
  },
  {
    authors: "Montalvo Suárez, P.",
    year: 2019,
    title: "Guía de estudio aplicada",
    publisher: "Ediciones del Sur Ficticias",
    kind: "Físico",
  },
  {
    authors: "Reinoso Cabrera, L.",
    year: 2023,
    title: "Casos y ejercicios resueltos",
    publisher: "Universidad Andina Ficticia",
    kind: "Virtual",
  },
  {
    authors: "Paredes Ortiz, J.",
    year: 2018,
    title: "Manual de laboratorio",
    publisher: "Editorial Andina Ficticia",
    kind: "Físico",
  },
  {
    authors: "Salazar Beltrán, M.",
    year: 2022,
    title: "Buenas prácticas en la industria",
    publisher: "Ediciones del Sur Ficticias",
    kind: "Virtual",
  },
  {
    authors: "Cevallos Mena, R.",
    year: 2020,
    title: "Introducción a los fundamentos",
    publisher: "Editorial Andina Ficticia",
    kind: "Físico",
  },
];

export const METHODOLOGIES = [
  "Aprendizaje Basado en Problemas",
  "Aprendizaje Basado en Proyectos",
  "Método de Caso",
  "Método Expositivo",
  "Aprendizaje Colaborativo",
  "Talleres y simulaciones",
];

export const TEACHERS = [
  "Marcela Quispe Andrade",
  "Rodrigo Villacís Heredia",
  "Patricia Narváez Loor",
  "Esteban Mora Cisneros",
  "Daniela Cárdenas Yépez",
  "Hernán Bastidas Pozo",
];
