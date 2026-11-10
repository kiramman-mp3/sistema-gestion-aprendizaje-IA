import { z } from "zod";
import { AnalyticsService } from "../../analytics/analytics.service";
import { MoodleRead } from "../../integrations/moodle/moodle-read.service";
import type { AssistantTool, ToolContext, ToolOutput } from "./assistant-tool";

const input = z.object({ student: z.string().regex(/^Estudiante#\d{8}$/) });
type Input = z.infer<typeof input>;

/**
 * Evidencias de un estudiante del curso (RF-17): lo observado en Moodle, lo calculado con reglas fijas y lo que no
 * se sabe, por separado. Es la misma información de la pantalla de análisis del estudiante, así que exige la misma
 * capacidad (`viewanalytics`): sin ella la herramienta ni se le ofrece al modelo. El estudiante se nombra con su
 * seudónimo; el id de Moodle sale de la lista de estudiantes del curso del token, nunca de lo que escriba el modelo.
 */
export class GetStudentLearningEvidenceTool implements AssistantTool<Input> {
  readonly name = "get_student_learning_evidence";
  readonly description =
    "Entrega las evidencias de un estudiante del curso: datos observados en Moodle, indicadores calculados y lo que falta para concluir algo. Necesita el seudónimo del estudiante (Estudiante#12345678) que entregó otra herramienta. Son hechos observables, no un diagnóstico.";
  readonly kind = "read" as const;
  readonly requires = "viewanalytics" as const;
  readonly input = input;

  constructor(
    private readonly moodle: MoodleRead,
    private readonly analytics: AnalyticsService,
  ) {}

  async execute(context: ToolContext, { student }: Input): Promise<ToolOutput> {
    const { auth, pseudonymizer } = context;
    const students = await this.moodle.listStudents(auth.moodleUserId, auth.courseId);
    // `alias` registra el seudónimo de cada estudiante: sirve para encontrar al pedido y para restaurar la respuesta.
    const match = students.students.find((s) => pseudonymizer.alias(s.studentid) === student);
    if (!match) {
      return {
        intent: "student_evidence",
        incomplete: students.truncated,
        data: { found: false, note: "Ese seudónimo no corresponde a un estudiante de este curso." },
        sources: [],
      };
    }

    const evidence = await this.analytics.studentEvidence(auth, match.studentid);
    return {
      intent: "student_evidence",
      incomplete: evidence.unknown.length > 0,
      criteria: [
        "Lo observado son los datos tal como están en Moodle, sin interpretar.",
        "Lo calculado usa reglas fijas y cada indicador explica cómo se obtiene.",
        "Lo que falta se informa aparte; no se supone ni se rellena.",
      ],
      data: {
        found: true,
        student,
        observed: evidence.observed,
        computed: evidence.computed.map((i) => ({
          label: i.label,
          value: i.value,
          unit: i.unit,
          definition: i.definition,
        })),
        unknown: evidence.unknown,
      },
      sources: [{ type: "moodle_gradebook", id: auth.courseId }],
    };
  }
}
