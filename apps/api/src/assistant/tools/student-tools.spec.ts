import type { AnalyticsService, StudentEvidenceDto } from "../../analytics/analytics.service";
import type { MoodleRead } from "../../integrations/moodle/moodle-read.service";
import { Pseudonymizer } from "../../privacy/pseudonymizer";
import { GetStudentLearningEvidenceTool } from "./student-tools";

const SECRET = "una-clave-de-prueba-de-al-menos-32-caracteres";
const AUTH = { moodleUserId: 42, courseId: 7 };

const EVIDENCE: StudentEvidenceDto = {
  courseId: 7,
  studentId: 3,
  observed: [{ label: "Tarea 1", value: "Entregada a tiempo" }],
  computed: [
    {
      key: "delivery_rate",
      label: "Tasa de entrega",
      value: 50,
      unit: "%",
      definition: "Entregas / esperadas",
    },
  ],
  unknown: ["No hay notas de la unidad 2."],
};

function setup(options: { truncated?: boolean } = {}) {
  const listStudents = jest.fn().mockResolvedValue({
    truncated: options.truncated ?? false,
    students: [{ studentid: 3 }, { studentid: 5 }],
  });
  const studentEvidence = jest.fn().mockResolvedValue(EVIDENCE);
  const pseudonymizer = new Pseudonymizer(SECRET, 7);
  const tool = new GetStudentLearningEvidenceTool(
    { listStudents } as unknown as MoodleRead,
    { studentEvidence } as unknown as AnalyticsService,
  );
  return {
    tool,
    listStudents,
    studentEvidence,
    pseudonymizer,
    context: { auth: AUTH, pseudonymizer },
  };
}

describe("get_student_learning_evidence", () => {
  it("exige viewanalytics: sin ella la herramienta no se ofrece", () => {
    expect(setup().tool.requires).toBe("viewanalytics");
    expect(setup().tool.kind).toBe("read");
  });

  it("encuentra al estudiante por su seudónimo y entrega lo observado, lo calculado y lo que falta", async () => {
    const { tool, context, studentEvidence, pseudonymizer } = setup();
    const alias = pseudonymizer.alias(3);

    const result = await tool.execute(context, { student: alias });

    expect(studentEvidence).toHaveBeenCalledWith(AUTH, 3);
    expect(result.data).toEqual({
      found: true,
      student: alias,
      observed: EVIDENCE.observed,
      computed: [
        { label: "Tasa de entrega", value: 50, unit: "%", definition: "Entregas / esperadas" },
      ],
      unknown: EVIDENCE.unknown,
    });
    expect(result.criteria).toHaveLength(3);
    expect(result.incomplete).toBe(true);
    // El seudónimo queda registrado: el plugin podrá ponerle su nombre.
    expect(pseudonymizer.restore(`Habla de ${alias}`)).toEqual([{ alias, studentId: 3 }]);
  });

  it("el id de Moodle nunca sale de lo que escribe el modelo: un seudónimo inventado no encuentra a nadie", async () => {
    const { tool, context, studentEvidence } = setup();

    const result = await tool.execute(context, { student: "Estudiante#00000001" });

    expect(studentEvidence).not.toHaveBeenCalled();
    expect(result.data).toMatchObject({ found: false });
    expect(result.sources).toEqual([]);
  });

  it("no devuelve ids de Moodle ni nombres, solo el seudónimo", async () => {
    const { tool, context, pseudonymizer } = setup();

    const result = await tool.execute(context, { student: pseudonymizer.alias(5) });

    expect(JSON.stringify(result.data)).not.toMatch(/studentId|"id"|fullname|email/);
  });

  it("si Moodle recortó la lista de estudiantes y no lo encuentra, lo marca como incompleto", async () => {
    const { tool, context } = setup({ truncated: true });

    const result = await tool.execute(context, { student: "Estudiante#00000001" });

    expect(result.incomplete).toBe(true);
  });

  it.each(["", "Estudiante#1", "Ana Pérez", "3", "Estudiante#123456789"])(
    "rechaza «%s» como argumento",
    (student) => {
      expect(setup().tool.input.safeParse({ student }).success).toBe(false);
    },
  );
});
