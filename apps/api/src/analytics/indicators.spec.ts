import { buildDataset } from "./analytics.fixtures";
import { computeCourseIndicators, computeStudentIndicators, dueAssignments } from "./indicators";

const byKey = (indicators: { key: string; value: number | null }[], key: string) =>
  indicators.find((indicator) => indicator.key === key)?.value;

describe("computeCourseIndicators · hoja de verificación manual", () => {
  const indicators = computeCourseIndicators(buildDataset());

  it("solo cuenta como esperadas las tareas visibles y vencidas", () => {
    expect(dueAssignments(buildDataset()).map((a) => a.cmid)).toEqual([10, 11]);
  });

  it("entregas recibidas: 4 de 8 esperadas = 50 %", () => {
    expect(byKey(indicators, "delivery_rate")).toBe(50);
  });

  it("entregas por calificar: 2", () => {
    expect(byKey(indicators, "pending_grading")).toBe(2);
  });

  it("promedio de notas: (90 + 60 + 50 + 80) ÷ 4 = 70 %, sin contar la nota ausente como cero", () => {
    expect(byKey(indicators, "average_grade_percent")).toBe(70);
  });

  it("participación: 2 de 4 entraron en los últimos 14 días = 50 %", () => {
    expect(byKey(indicators, "participation_rate")).toBe(50);
  });

  it("finalización: 3 de 4 = 75 %", () => {
    expect(byKey(indicators, "completion_rate")).toBe(75);
  });

  it("rendimiento por unidad: la unidad con notas se calcula y la que no tiene actividades queda sin valor", () => {
    expect(byKey(indicators, "unit_average:gradingPeriods[0].units[0]")).toBe(70);
    expect(byKey(indicators, "unit_average:gradingPeriods[0].units[1]")).toBeNull();
  });

  it("cada indicador trae etiqueta, unidad y definición", () => {
    for (const indicator of indicators) {
      expect(indicator.label.length).toBeGreaterThan(0);
      expect(indicator.definition.length).toBeGreaterThan(20);
    }
  });
});

describe("computeCourseIndicators · datos faltantes", () => {
  it("un dato que no se pudo leer deja el indicador sin valor, nunca en cero", () => {
    const indicators = computeCourseIndicators(
      buildDataset({
        submissions: null,
        pending: null,
        grades: null,
        completion: null,
        lastAccess: null,
      }),
    );

    for (const key of [
      "delivery_rate",
      "pending_grading",
      "average_grade_percent",
      "participation_rate",
      "completion_rate",
      "unit_average:gradingPeriods[0].units[0]",
    ]) {
      expect(byKey(indicators, key)).toBeNull();
    }
  });

  it("sin estudiantes no inventa porcentajes", () => {
    const indicators = computeCourseIndicators(buildDataset({ studentIds: [] }));

    expect(byKey(indicators, "delivery_rate")).toBeNull();
    expect(byKey(indicators, "participation_rate")).toBeNull();
  });

  it("sin tareas vencidas el porcentaje de entregas queda sin valor", () => {
    const indicators = computeCourseIndicators(buildDataset({ activities: [] }));

    expect(byKey(indicators, "delivery_rate")).toBeNull();
  });

  it("cero entregas pendientes es un cero real cuando el dato existe", () => {
    expect(byKey(computeCourseIndicators(buildDataset({ pending: [] })), "pending_grading")).toBe(
      0,
    );
  });

  it("ignora las filas de quien ya no está matriculado", () => {
    const base = buildDataset();
    const indicators = computeCourseIndicators(
      buildDataset({
        studentIds: [1, 2],
        grades: [
          ...base.grades!,
          { cmid: 10, studentid: 99, grade: 0, grademax: 10, gradedat: null },
        ],
      }),
    );

    // Solo notas de 1 y 2: 90, 60 y 80 → 76,67
    expect(byKey(indicators, "average_grade_percent")).toBe(76.67);
  });

  it("una nota de cero sí cuenta", () => {
    const base = buildDataset();
    const indicators = computeCourseIndicators(
      buildDataset({
        grades: [
          ...base.grades!,
          { cmid: 11, studentid: 2, grade: 0, grademax: 10, gradedat: "2026-11-04T10:00:00Z" },
        ],
      }),
    );

    // (90 + 60 + 50 + 80 + 0) ÷ 5 = 56
    expect(byKey(indicators, "average_grade_percent")).toBe(56);
  });
});

describe("computeStudentIndicators", () => {
  it("estudiante 1: entregó las dos tareas vencidas, promedio 85, 1 día sin entrar", () => {
    const indicators = computeStudentIndicators(buildDataset(), 1);

    expect(byKey(indicators, "delivery_rate")).toBe(100);
    expect(byKey(indicators, "average_grade_percent")).toBe(85);
    expect(byKey(indicators, "completion_rate")).toBe(100);
    expect(byKey(indicators, "days_since_last_access")).toBe(1);
  });

  it("estudiante 3: ninguna entrega y sin notas", () => {
    const indicators = computeStudentIndicators(buildDataset(), 3);

    expect(byKey(indicators, "delivery_rate")).toBe(0);
    expect(byKey(indicators, "average_grade_percent")).toBeNull();
    expect(byKey(indicators, "completion_rate")).toBe(0);
    expect(byKey(indicators, "days_since_last_access")).toBe(40);
  });

  it("estudiante que nunca entró: sin valor en días desde el acceso", () => {
    expect(byKey(computeStudentIndicators(buildDataset(), 4), "days_since_last_access")).toBeNull();
  });

  it("un estudiante sin filas de notas queda sin promedio, no en cero", () => {
    expect(byKey(computeStudentIndicators(buildDataset(), 77), "average_grade_percent")).toBeNull();
  });
});
