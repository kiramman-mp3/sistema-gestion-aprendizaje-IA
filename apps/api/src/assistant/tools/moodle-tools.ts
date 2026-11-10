import type { Grade, MoodleActivity, Submission } from "@smart-lms/contracts";
import { z } from "zod";
import { AnalyticsDataService } from "../../analytics/analytics-data.service";
import { computeCourseIndicators } from "../../analytics/indicators";
import { MoodleRead } from "../../integrations/moodle/moodle-read.service";
import type { AssistantTool, ChatSource, ToolContext, ToolOutput } from "./assistant-tool";

/** Fuente que el plugin enlaza al calificador del curso. */
const gradebook = (courseId: number): ChatSource => ({ type: "moodle_gradebook", id: courseId });
const activity = (cmid: number): ChatSource => ({ type: "moodle_activity", id: cmid });

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Seudónimos ordenados, para que la misma consulta dé siempre el mismo texto. */
function aliases(context: ToolContext, studentIds: number[]): string[] {
  return [...new Set(studentIds)]
    .sort((a, b) => a - b)
    .map((id) => context.pseudonymizer.alias(id));
}

/**
 * Actividades del curso del token. El curso no se pide al modelo: sale del token, así que el modelo
 * no puede consultar otro curso.
 */
export class GetCourseActivitiesTool implements AssistantTool<Record<string, never>> {
  readonly name = "get_course_activities";
  readonly description =
    "Lista las actividades del curso (tareas, foros, cuestionarios...) con su tipo, sección, fecha de entrega y si están visibles. Úsala para saber qué actividades existen o cuál es el id de una actividad.";
  readonly kind = "read" as const;
  readonly input = z.object({});

  constructor(private readonly moodle: MoodleRead) {}

  async execute({ auth }: ToolContext): Promise<ToolOutput> {
    const result = await this.moodle.listActivities(auth.moodleUserId, auth.courseId);
    return {
      intent: "course_activities",
      incomplete: result.truncated,
      criteria: [
        "Se listan las actividades que el docente ve en Moodle, en el orden del curso.",
        "La fecha de entrega es la que tiene configurada cada actividad en Moodle.",
      ],
      data: {
        count: result.activities.length,
        activities: result.activities.map((a: MoodleActivity) => ({
          cmid: a.cmid,
          type: a.modname,
          name: a.name,
          section: a.sectionnum,
          visible: a.visible,
          dueDate: a.duedate,
        })),
      },
      sources: [gradebook(auth.courseId)],
    };
  }
}

/** Entregas de una actividad: cuántas hay por estado y quiénes no entregaron o entregaron tarde. */
export class GetAssignmentSubmissionsTool implements AssistantTool<{ cmid: number }> {
  readonly name = "get_assignment_submissions";
  readonly description =
    "Resume las entregas de una actividad: cuántos estudiantes entregaron, cuántos no, cuántos entregaron tarde, y los seudónimos de quienes faltan. Necesita el id de la actividad (cmid).";
  readonly kind = "read" as const;
  readonly input = z.object({ cmid: z.number().int().positive() });

  constructor(private readonly moodle: MoodleRead) {}

  async execute(context: ToolContext, { cmid }: { cmid: number }): Promise<ToolOutput> {
    const { auth } = context;
    const result = await this.moodle.getSubmissions(auth.moodleUserId, auth.courseId, cmid);
    const rows: Submission[] = result.submissions;
    const byStatus = (status: Submission["status"]) => rows.filter((r) => r.status === status);
    const delivered = rows.filter((r) => r.status === "submitted" || r.status === "graded");

    return {
      intent: "assignment_submissions",
      incomplete: result.truncated,
      criteria: [
        "Entregó quien envió la tarea (enviada o calificada); un borrador no cuenta como entrega.",
        "Sin entrega es quien no envió nada, haya vencido el plazo o no.",
        "Tarde es una entrega enviada después de la fecha límite de la tarea.",
      ],
      data: {
        cmid,
        total: rows.length,
        delivered: delivered.length,
        notDelivered: byStatus("missing").length + byStatus("new").length,
        drafts: byStatus("draft").length,
        late: delivered.filter((r) => r.late).length,
        missingStudents: aliases(
          context,
          [...byStatus("missing"), ...byStatus("new")].map((r) => r.studentid),
        ),
        lateStudents: aliases(
          context,
          delivered.filter((r) => r.late).map((r) => r.studentid),
        ),
      },
      sources: [activity(cmid)],
    };
  }
}

/** Entregas recibidas que el docente todavía no calificó. */
export class GetPendingGradingTool implements AssistantTool<{ cmid?: number }> {
  readonly name = "get_pending_grading";
  readonly description =
    "Indica qué entregas están pendientes de calificar, por actividad y con los seudónimos de los estudiantes. Sin cmid revisa todo el curso.";
  readonly kind = "read" as const;
  readonly input = z.object({ cmid: z.number().int().positive().optional() });

  constructor(private readonly moodle: MoodleRead) {}

  async execute(context: ToolContext, { cmid }: { cmid?: number }): Promise<ToolOutput> {
    const { auth } = context;
    const result = await this.moodle.getPendingGrading(auth.moodleUserId, auth.courseId, cmid);

    const byActivity = new Map<number, number[]>();
    for (const row of result.pending) {
      byActivity.set(row.cmid, [...(byActivity.get(row.cmid) ?? []), row.studentid]);
    }
    const activities = [...byActivity.entries()]
      .sort(([a], [b]) => a - b)
      .map(([id, students]) => ({
        cmid: id,
        pending: new Set(students).size,
        students: aliases(context, students),
      }));

    return {
      intent: "pending_grading",
      incomplete: result.truncated,
      criteria: [
        "Pendiente de calificar es una entrega enviada que todavía no tiene nota; un borrador no cuenta.",
      ],
      data: { totalPending: result.pending.length, activities },
      sources:
        activities.length > 0
          ? activities.map((a) => activity(a.cmid))
          : [gradebook(auth.courseId)],
    };
  }
}

const gradeSummaryInput = z.object({
  cmid: z.number().int().positive().optional(),
  /** Si se indica, lista quiénes tienen una nota menor a este valor, sobre la nota máxima de la actividad. */
  belowPercent: z.number().min(0).max(100).optional(),
});

/** Resumen de notas por actividad: cuántas hay, promedio, rango y, si se pide, quiénes están por debajo de un umbral. */
export class GetGradeSummaryTool implements AssistantTool<z.infer<typeof gradeSummaryInput>> {
  readonly name = "get_grade_summary";
  readonly description =
    "Resume las notas de una actividad o de todo el curso: cuántas hay, el promedio, la nota mínima y máxima, y cuántos estudiantes no tienen nota. Con belowPercent lista los seudónimos de quienes están por debajo de ese porcentaje de la nota máxima.";
  readonly kind = "read" as const;
  readonly input = gradeSummaryInput;

  constructor(private readonly moodle: MoodleRead) {}

  async execute(
    context: ToolContext,
    input: z.infer<typeof gradeSummaryInput>,
  ): Promise<ToolOutput> {
    const { auth } = context;
    const result = await this.moodle.getGrades(auth.moodleUserId, auth.courseId, input.cmid);

    const byActivity = new Map<number, Grade[]>();
    for (const grade of result.grades) {
      byActivity.set(grade.cmid, [...(byActivity.get(grade.cmid) ?? []), grade]);
    }

    const activities = [...byActivity.entries()]
      .sort(([a], [b]) => a - b)
      .map(([cmid, rows]) => {
        // Una nota ausente (null) no cuenta como cero: no entra al promedio y se informa aparte.
        const graded = rows.filter((r): r is Grade & { grade: number } => r.grade !== null);
        const values = graded.map((r) => r.grade);
        const max = rows.find((r) => r.grademax !== null)?.grademax ?? null;
        const below =
          input.belowPercent !== undefined && max !== null && max > 0
            ? graded.filter((r) => (r.grade / max) * 100 < input.belowPercent!)
            : [];
        return {
          cmid,
          maxGrade: max,
          graded: graded.length,
          withoutGrade: rows.length - graded.length,
          average:
            values.length > 0 ? round(values.reduce((a, b) => a + b, 0) / values.length) : null,
          min: values.length > 0 ? Math.min(...values) : null,
          max: values.length > 0 ? Math.max(...values) : null,
          ...(input.belowPercent !== undefined
            ? {
                belowThreshold: aliases(
                  context,
                  below.map((r) => r.studentid),
                ),
              }
            : {}),
        };
      });

    return {
      intent: "grade_summary",
      incomplete: result.truncated,
      criteria: [
        "Se usan las notas visibles en el libro de calificaciones; una nota oculta no se cuenta.",
        "Un estudiante sin nota no entra al promedio ni cuenta como cero.",
        ...(input.belowPercent !== undefined
          ? [
              `Por debajo del umbral es una nota menor al ${input.belowPercent}% de la nota máxima de la actividad.`,
            ]
          : []),
      ],
      data: { activities },
      sources: [gradebook(auth.courseId), ...activities.map((a) => activity(a.cmid))],
    };
  }
}

/**
 * Rendimiento por unidad del sílabo revisado (RF-12), con la relación actividad ↔ unidad de
 * `activity_unit_mappings`. Usa los mismos cálculos que el panel del docente: la respuesta del chat y la
 * pantalla no pueden discrepar.
 */
export class GetUnitPerformanceTool implements AssistantTool<Record<string, never>> {
  readonly name = "get_unit_performance";
  readonly description =
    "Indica el rendimiento (promedio de notas en porcentaje) de cada unidad del sílabo revisado, según las actividades relacionadas con cada unidad. Una unidad sin notas o sin actividades relacionadas no tiene valor.";
  readonly kind = "read" as const;
  readonly input = z.object({});

  constructor(private readonly analytics: AnalyticsDataService) {}

  async execute({ auth }: ToolContext): Promise<ToolOutput> {
    const dataset = await this.analytics.load(auth);
    const units = computeCourseIndicators(dataset)
      .filter((indicator) => indicator.key.startsWith("unit_average:"))
      .map((indicator) => ({
        unit: indicator.label.replace(/^Rendimiento en /, ""),
        averagePercent: indicator.value,
      }));

    return {
      intent: "unit_performance",
      criteria: [
        "El rendimiento de una unidad es el promedio, en porcentaje de la nota máxima, de las actividades relacionadas con ella.",
        "Una unidad sin actividades relacionadas o sin notas no tiene valor.",
      ],
      // Sin sílabo revisado o sin notas legibles, la respuesta no puede ser completa.
      incomplete: dataset.grades === null || dataset.units.length === 0,
      data: {
        units,
        ...(dataset.units.length === 0 ? { note: "El curso no tiene un sílabo revisado." } : {}),
        ...(dataset.units.length > 0 && dataset.mappings.length === 0
          ? { note: "Las actividades no están relacionadas con unidades." }
          : {}),
      },
      sources: [gradebook(auth.courseId)],
    };
  }
}
