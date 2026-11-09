import { SYLLABUS_SCHEMA_VERSION, type SyllabusExtraction } from "./schema.js";

/** Extracción sintética válida para pruebas. No representa un sílabo real. */
export function buildSyllabusExtraction(
  overrides: Partial<SyllabusExtraction> = {},
): SyllabusExtraction {
  return {
    schemaVersion: SYLLABUS_SCHEMA_VERSION,
    course: {
      name: "Ingeniería de Software",
      code: "IS-501",
      period: "2026-2027",
      teacher: null,
      generalObjective: "Desarrollar software aplicando un proceso de ingeniería.",
    },
    learningOutcomes: [
      { id: "RA1", description: "Especifica requisitos de software." },
      { id: "RA2", description: "Diseña la arquitectura de un sistema." },
    ],
    gradingPeriods: [
      {
        name: "Primer parcial",
        weight: 50,
        units: [
          {
            title: "Requisitos",
            topics: ["Elicitación", "Historias de usuario"],
            learningOutcomeIds: ["RA1"],
            startDate: "2026-11-16",
            endDate: "2026-12-11",
            activities: [
              {
                title: "Especificación de requisitos",
                type: "assignment",
                description: null,
                suggestedDueDate: "2026-12-04",
                weight: 30,
                learningOutcomeIds: ["RA1"],
                requiresTeacherReview: true,
              },
            ],
          },
        ],
      },
      {
        name: "Segundo parcial",
        weight: 50,
        units: [
          {
            title: "Arquitectura",
            topics: ["Estilos arquitectónicos"],
            learningOutcomeIds: ["RA2"],
            startDate: null,
            endDate: null,
            activities: [
              {
                title: "Documento de arquitectura",
                type: "project",
                description: null,
                suggestedDueDate: null,
                weight: null,
                learningOutcomeIds: ["RA2"],
                requiresTeacherReview: true,
              },
            ],
          },
        ],
      },
    ],
    methodologies: ["Aprendizaje basado en proyectos"],
    resources: [],
    assessmentInstruments: [{ name: "Rúbrica de proyecto", weight: null }],
    bibliography: ["Sommerville, I. Ingeniería de Software."],
    uncertainFields: [
      {
        path: "gradingPeriods[1].units[0].activities[0].suggestedDueDate",
        reason: "missing",
        note: null,
      },
    ],
    sourceReferences: [{ path: "learningOutcomes[0]", page: 2, excerpt: null }],
    ...overrides,
  };
}
