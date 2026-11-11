import { findLanguageViolations } from "../recommendations/pedagogical-language";
import { buildDataset } from "./analytics.fixtures";
import { defaultRules, resolveRules, ruleParamsSchemas, type RuleConfig } from "./difficulty-rules";
import { evaluateSignals } from "./difficulty-signals";

const only = (rule: RuleConfig["rule"], params: object = {}): RuleConfig[] =>
  [{ rule, enabled: true, params: ruleParamsSchemas[rule].parse(params) }] as RuleConfig[];

const grade = (cmid: number, studentid: number, value: number, gradedat: string) => ({
  cmid,
  studentid,
  grade: value,
  grademax: 10,
  gradedat,
});

describe("resolveRules", () => {
  it("sin reglas guardadas usa las de por defecto, todas activas", () => {
    const rules = resolveRules([], 7);

    expect(rules.map((r) => r.rule)).toEqual([
      "MISSING_REQUIRED",
      "GRADE_BELOW_THRESHOLD",
      "SUSTAINED_DECLINE",
      "REPEATED_OUTCOME_DIFFICULTY",
    ]);
    expect(rules.every((r) => r.enabled)).toBe(true);
    expect(rules).toEqual(defaultRules());
    expect(rules[1]!.params).toMatchObject({ thresholdPercent: 60, minActivities: 2 });
  });

  it("la regla del curso reemplaza a la institucional, y esta a la de por defecto", () => {
    const rules = resolveRules(
      [
        {
          rule: "GRADE_BELOW_THRESHOLD",
          moodleCourseId: null,
          enabled: true,
          params: { thresholdPercent: 50 },
        },
        {
          rule: "GRADE_BELOW_THRESHOLD",
          moodleCourseId: 7,
          enabled: true,
          params: { thresholdPercent: 70 },
        },
        { rule: "MISSING_REQUIRED", moodleCourseId: null, enabled: false, params: {} },
        { rule: "SUSTAINED_DECLINE", moodleCourseId: 99, enabled: false, params: {} },
      ],
      7,
    );

    expect(rules.find((r) => r.rule === "GRADE_BELOW_THRESHOLD")!.params).toMatchObject({
      thresholdPercent: 70,
    });
    expect(rules.find((r) => r.rule === "MISSING_REQUIRED")!.enabled).toBe(false);
    // La regla de otro curso no afecta a este.
    expect(rules.find((r) => r.rule === "SUSTAINED_DECLINE")!.enabled).toBe(true);
  });

  it("descarta parámetros inválidos y usa los de por defecto en vez de romper", () => {
    const rules = resolveRules(
      [
        {
          rule: "GRADE_BELOW_THRESHOLD",
          moodleCourseId: 7,
          enabled: true,
          params: { thresholdPercent: 500, otro: 1 },
        },
      ],
      7,
    );

    expect(rules.find((r) => r.rule === "GRADE_BELOW_THRESHOLD")!.params).toMatchObject({
      thresholdPercent: 60,
    });
  });
});

describe("evaluateSignals · MISSING_REQUIRED", () => {
  it("avisa solo a quien no entregó ninguna de las dos tareas vencidas", () => {
    const signals = evaluateSignals(buildDataset(), only("MISSING_REQUIRED"));

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ studentId: 3, rule: "MISSING_REQUIRED" });
    expect(signals[0]!.explanation).toContain("2 de 2 tareas");
    expect(signals[0]!.explanation).toContain("Tarea 10");
  });

  it("respeta el mínimo configurado y las actividades obligatorias", () => {
    const data = buildDataset();

    expect(
      evaluateSignals(data, only("MISSING_REQUIRED", { minMissing: 1 })).map((s) => s.studentId),
    ).toEqual([2, 3, 4]);
    expect(
      evaluateSignals(data, only("MISSING_REQUIRED", { minMissing: 1, requiredCmids: [10] })).map(
        (s) => s.studentId,
      ),
    ).toEqual([3]);
  });

  it("cuenta como no entregado a quien no tiene fila de entrega", () => {
    const data = buildDataset({ studentIds: [1, 2, 3, 4, 5] });

    expect(evaluateSignals(data, only("MISSING_REQUIRED")).map((s) => s.studentId)).toEqual([3, 5]);
  });

  it("no genera señales si no se pudieron leer las entregas", () => {
    expect(evaluateSignals(buildDataset({ submissions: null }), only("MISSING_REQUIRED"))).toEqual(
      [],
    );
  });

  it("la ventana deja fuera las tareas vencidas hace más tiempo", () => {
    // La tarea 10 venció hace 9 días y la 11 hace 5: con ventana de 7 solo cuenta la 11.
    const signals = evaluateSignals(
      buildDataset(),
      only("MISSING_REQUIRED", { minMissing: 1, windowDays: 7 }),
    );

    expect(signals.map((s) => s.studentId)).toEqual([2, 3, 4]);
    expect(signals[0]!.explanation).toContain("1 de 1 tareas");
  });
});

describe("evaluateSignals · GRADE_BELOW_THRESHOLD", () => {
  it("con los valores por defecto nadie del curso de ejemplo se activa (60 % y 2 notas)", () => {
    expect(evaluateSignals(buildDataset(), only("GRADE_BELOW_THRESHOLD"))).toEqual([]);
  });

  it("avisa a quien tiene notas por debajo del umbral configurado, con las notas en la explicación", () => {
    const signals = evaluateSignals(
      buildDataset(),
      only("GRADE_BELOW_THRESHOLD", { thresholdPercent: 70, minActivities: 1 }),
    );

    expect(signals.map((s) => s.studentId)).toEqual([2, 4]);
    expect(signals[1]!.explanation).toContain("Tarea 10: 50 %");
  });

  it("una nota exactamente en el umbral no cuenta, y una ausente tampoco", () => {
    const signals = evaluateSignals(
      buildDataset(),
      only("GRADE_BELOW_THRESHOLD", { thresholdPercent: 60, minActivities: 1 }),
    );

    // Estudiante 2 tiene 60 % (no es menor que 60); estudiante 3 no tiene nota.
    expect(signals.map((s) => s.studentId)).toEqual([4]);
  });
});

describe("evaluateSignals · SUSTAINED_DECLINE", () => {
  const withGrades = (rows: ReturnType<typeof grade>[]) =>
    buildDataset({ studentIds: [1], grades: rows });

  it("avisa cuando las últimas notas bajan una tras otra", () => {
    const signals = evaluateSignals(
      withGrades([
        grade(10, 1, 9, "2026-10-01T10:00:00Z"),
        grade(11, 1, 8, "2026-10-15T10:00:00Z"),
        grade(12, 1, 6, "2026-11-01T10:00:00Z"),
      ]),
      only("SUSTAINED_DECLINE"),
    );

    expect(signals).toHaveLength(1);
    expect(signals[0]!.explanation).toContain("90 % → 80 % → 60 %");
  });

  it("ordena por fecha de calificación, no por el orden en que llegan", () => {
    const signals = evaluateSignals(
      withGrades([
        grade(12, 1, 6, "2026-11-01T10:00:00Z"),
        grade(10, 1, 9, "2026-10-01T10:00:00Z"),
        grade(11, 1, 8, "2026-10-15T10:00:00Z"),
      ]),
      only("SUSTAINED_DECLINE"),
    );

    expect(signals).toHaveLength(1);
  });

  it("no avisa si una nota repite o sube, ni con menos notas de las pedidas", () => {
    const flat = withGrades([
      grade(10, 1, 9, "2026-10-01T10:00:00Z"),
      grade(11, 1, 9, "2026-10-15T10:00:00Z"),
      grade(12, 1, 6, "2026-11-01T10:00:00Z"),
    ]);
    const short = withGrades([
      grade(10, 1, 9, "2026-10-01T10:00:00Z"),
      grade(11, 1, 6, "2026-10-15T10:00:00Z"),
    ]);

    expect(evaluateSignals(flat, only("SUSTAINED_DECLINE"))).toEqual([]);
    expect(evaluateSignals(short, only("SUSTAINED_DECLINE"))).toEqual([]);
  });

  it("solo mira las últimas notas: una caída antigua que se recuperó no cuenta", () => {
    const signals = evaluateSignals(
      withGrades([
        grade(10, 1, 9, "2026-09-01T10:00:00Z"),
        grade(11, 1, 7, "2026-09-15T10:00:00Z"),
        grade(12, 1, 5, "2026-10-01T10:00:00Z"),
        grade(13, 1, 8, "2026-10-20T10:00:00Z"),
      ]),
      only("SUSTAINED_DECLINE"),
    );

    expect(signals).toEqual([]);
  });
});

describe("evaluateSignals · REPEATED_OUTCOME_DIFFICULTY", () => {
  it("avisa cuando dos actividades del mismo resultado tienen notas bajas", () => {
    const base = buildDataset();
    const data = buildDataset({
      grades: [...base.grades!, grade(11, 4, 4, "2026-11-04T10:00:00Z")],
    });

    const signals = evaluateSignals(data, only("REPEATED_OUTCOME_DIFFICULTY"));

    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ studentId: 4, rule: "REPEATED_OUTCOME_DIFFICULTY" });
    expect(signals[0]!.explanation).toContain("resultado de aprendizaje RA1");
  });

  it("no avisa con una sola nota baja ni sin relación actividad ↔ unidad", () => {
    expect(evaluateSignals(buildDataset(), only("REPEATED_OUTCOME_DIFFICULTY"))).toEqual([]);
    expect(
      evaluateSignals(buildDataset({ mappings: [] }), only("REPEATED_OUTCOME_DIFFICULTY")),
    ).toEqual([]);
  });
});

describe("evaluateSignals · general", () => {
  it("no evalúa las reglas desactivadas", () => {
    const rules = defaultRules().map((r) => ({ ...r, enabled: false }));

    expect(evaluateSignals(buildDataset(), rules)).toEqual([]);
  });

  it("devuelve las señales ordenadas por estudiante y regla", () => {
    const signals = evaluateSignals(buildDataset(), [
      ...only("GRADE_BELOW_THRESHOLD", { thresholdPercent: 70, minActivities: 1 }),
      ...only("MISSING_REQUIRED", { minMissing: 1 }),
    ]);

    expect(signals.map((s) => `${s.studentId}:${s.rule}`)).toEqual([
      "2:GRADE_BELOW_THRESHOLD",
      "2:MISSING_REQUIRED",
      "3:MISSING_REQUIRED",
      "4:GRADE_BELOW_THRESHOLD",
      "4:MISSING_REQUIRED",
    ]);
  });

  it("toda explicación describe hechos: sin diagnósticos, etiquetas ni juicios", () => {
    const signals = evaluateSignals(
      buildDataset({
        grades: [
          grade(10, 1, 9, "2026-10-01T10:00:00Z"),
          grade(11, 1, 8, "2026-10-15T10:00:00Z"),
          grade(12, 1, 3, "2026-11-01T10:00:00Z"),
          grade(11, 4, 4, "2026-11-04T10:00:00Z"),
          grade(10, 4, 5, "2026-11-03T10:00:00Z"),
        ],
      }),
      defaultRules(),
    );

    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) {
      expect(signal.explanation.length).toBeGreaterThan(30);
      expect(findLanguageViolations(signal.explanation)).toEqual([]);
    }
  });

  it("la señal solo lleva el id del estudiante, la regla y la explicación", () => {
    const [signal] = evaluateSignals(buildDataset(), only("MISSING_REQUIRED"));

    expect(Object.keys(signal!).sort()).toEqual(["explanation", "rule", "studentId"]);
  });
});
