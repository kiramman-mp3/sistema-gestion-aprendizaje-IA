import { describe, expect, it } from "vitest";
import {
  analyticsErrorKind,
  canSaveFollowup,
  formatIndicator,
  historyTable,
  groupSignals,
  MAX_FOLLOWUP_LENGTH,
  nameLookup,
  observedRows,
  recommendationParts,
  ruleKey,
  studentLabel,
  toFollowupBody,
} from "../../../moodle/local/ai_assistant/amd/src/analytics_model.js";

describe("indicadores", () => {
  it("formatea el valor con su unidad", () => {
    expect(formatIndicator({ value: 72.456, unit: "%" }, "en")).toBe("72.46%");
    expect(formatIndicator({ value: 7.5, unit: "puntos" }, "en")).toBe("7.5 puntos");
    expect(formatIndicator({ value: 12, unit: null }, "en")).toBe("12");
    expect(formatIndicator({ value: 0, unit: "%" }, "en")).toBe("0%");
  });

  it("un valor que falta se muestra como guion, nunca como cero", () => {
    expect(formatIndicator({ value: null, unit: "%" })).toBe("—");
    expect(formatIndicator({ value: undefined })).toBe("—");
    expect(formatIndicator({ value: Number.NaN })).toBe("—");
  });
});

describe("señales", () => {
  const names = nameLookup([
    { id: 1, fullname: "Beatriz Zambrano" },
    { id: 2, fullname: "Andrés Álvarez" },
    { id: 3, fullname: "Carla Cedeño" },
  ]);
  const signal = (studentId, rule, explanation = "x") => ({ studentId, rule, explanation });

  it("agrupa por estudiante, con más señales primero y luego por nombre", () => {
    const groups = groupSignals(
      [
        signal(1, "MISSING_REQUIRED"),
        signal(3, "SUSTAINED_DECLINE"),
        signal(3, "GRADE_BELOW_THRESHOLD"),
        signal(2, "MISSING_REQUIRED"),
      ],
      names,
    );

    expect(groups.map((g) => [g.studentId, g.signals.length])).toEqual([
      [3, 2],
      [2, 1],
      [1, 1],
    ]);
  });

  it("sin señales no hay grupos", () => {
    expect(groupSignals([], names)).toEqual([]);
  });

  it("usa el id si Moodle no lista al estudiante", () => {
    expect(studentLabel(names, 1, "Student 1")).toBe("Beatriz Zambrano");
    expect(studentLabel(names, 99, "Student 99")).toBe("Student 99");
    expect(groupSignals([signal(99, "MISSING_REQUIRED")], names)).toHaveLength(1);
  });

  it("reconoce las reglas del contrato y deja pasar las desconocidas", () => {
    expect(ruleKey("MISSING_REQUIRED")).toBe("missing_required");
    expect(ruleKey("GRADE_BELOW_THRESHOLD")).toBe("grade_below_threshold");
    expect(ruleKey("SUSTAINED_DECLINE")).toBe("sustained_decline");
    expect(ruleKey("REPEATED_OUTCOME_DIFFICULTY")).toBe("repeated_outcome_difficulty");
    expect(ruleKey("REGLA_NUEVA")).toBeNull();
  });
});

describe("evidencias observadas", () => {
  it("muestra {label, value} como una fila", () => {
    expect(observedRows({ label: "Tareas entregadas", value: 3 })).toEqual([
      { label: "Tareas entregadas", value: "3" },
    ]);
  });

  it("muestra un objeto plano campo por campo, sin adivinar qué significa", () => {
    expect(observedRows({ tarea: "Tarea 3", estado: "tarde", nota: null })).toEqual([
      { label: "tarea", value: "Tarea 3" },
      { label: "estado", value: "tarde" },
      { label: "nota", value: "—" },
    ]);
  });

  it("un valor anidado se muestra como texto", () => {
    expect(observedRows({ intentos: [1, 2] })).toEqual([{ label: "intentos", value: "[1,2]" }]);
  });
});

describe("recomendaciones", () => {
  it("devuelve las partes con contenido, en el orden de la pantalla", () => {
    const parts = recommendationParts({
      strategies: ["Tutoría breve"],
      evidenceSummary: ["Dos entregas tardías"],
      strengths: [],
      followUpIndicators: ["Entregas a tiempo"],
    });

    expect(parts.map((p) => p.key)).toEqual([
      "evidenceSummary",
      "strategies",
      "followUpIndicators",
    ]);
  });

  it("una recomendación sin partes no genera nada", () => {
    expect(recommendationParts({})).toEqual([]);
  });
});

describe("seguimiento docente", () => {
  it("la acción es obligatoria y hay un máximo", () => {
    expect(canSaveFollowup("")).toBe(false);
    expect(canSaveFollowup("   ")).toBe(false);
    expect(canSaveFollowup("Hablé con el estudiante")).toBe(true);
    expect(canSaveFollowup("x".repeat(MAX_FOLLOWUP_LENGTH))).toBe(true);
    expect(canSaveFollowup("x".repeat(MAX_FOLLOWUP_LENGTH + 1))).toBe(false);
    expect(canSaveFollowup("ok", "y".repeat(MAX_FOLLOWUP_LENGTH + 1))).toBe(false);
  });

  it("un resultado vacío se envía como null", () => {
    expect(toFollowupBody("  Tutoría  ", "")).toEqual({
      actionTaken: "Tutoría",
      observedResult: null,
    });
    expect(toFollowupBody("Tutoría", "  Mejoró  ")).toEqual({
      actionTaken: "Tutoría",
      observedResult: "Mejoró",
    });
  });
});

describe("errores", () => {
  it("clasifica los errores de la API", () => {
    expect(analyticsErrorKind({ status: 403 })).toBe("forbidden");
    expect(analyticsErrorKind({ status: 422 })).toBe("insufficient");
    expect(analyticsErrorKind({ status: 503 })).toBe("unavailable");
    expect(analyticsErrorKind({ code: "AI_PROVIDER_UNAVAILABLE" })).toBe("unavailable");
    expect(analyticsErrorKind({ status: 500, code: "X" })).toBe("other");
  });
});

describe("evolución de los indicadores (ADR-018)", () => {
  const indicators = [
    { key: "submission_rate", label: "Tasa de entrega", unit: "%" },
    { key: "average_grade", label: "Promedio", unit: null },
  ];
  const snapshot = (takenAt, values, signals = 1) => ({
    takenAt,
    signals,
    indicators: Object.entries(values).map(([key, value]) => ({ key, value })),
  });

  it("arma una fila por visita con una columna por indicador del panel, en el mismo orden", () => {
    const table = historyTable(
      {
        snapshots: [
          snapshot("2026-11-03T15:00:00Z", { average_grade: 6, submission_rate: 60 }, 4),
          snapshot("2026-11-10T15:00:00Z", { submission_rate: 70.5, average_grade: 6.4 }, 2),
        ],
      },
      indicators,
      "en",
    );

    expect(table.columns.map((c) => c.label)).toEqual(["Tasa de entrega", "Promedio"]);
    expect(table.rows.map((r) => [r.cells, r.signals])).toEqual([
      [["60%", "6"], 4],
      [["70.5%", "6.4"], 2],
    ]);
  });

  it("un indicador sin dato en esa visita se muestra como guion, no como cero", () => {
    const table = historyTable(
      {
        snapshots: [
          snapshot("2026-11-03T15:00:00Z", { submission_rate: 60, average_grade: null }),
          snapshot("2026-11-10T15:00:00Z", { submission_rate: 70 }),
        ],
      },
      indicators,
      "en",
    );

    expect(table.rows[0].cells[1]).toBe("—");
    expect(table.rows[1].cells[1]).toBe("—");
  });

  it("un indicador que ya no está en el panel no tiene columna", () => {
    const table = historyTable(
      {
        snapshots: [
          snapshot("2026-11-03T15:00:00Z", { submission_rate: 60, viejo: 1 }),
          snapshot("2026-11-10T15:00:00Z", { submission_rate: 70, viejo: 2 }),
        ],
      },
      [indicators[0]],
      "en",
    );

    expect(table.columns.map((c) => c.key)).toEqual(["submission_rate"]);
    expect(table.rows[0].cells).toEqual(["60%"]);
  });

  it("con menos de dos visitas, o sin indicadores, no hay evolución que mostrar", () => {
    const one = { snapshots: [snapshot("2026-11-10T15:00:00Z", { submission_rate: 70 })] };

    expect(historyTable(one, indicators)).toBeNull();
    expect(historyTable({ snapshots: [] }, indicators)).toBeNull();
    expect(historyTable(undefined, indicators)).toBeNull();
    expect(historyTable({ snapshots: [one.snapshots[0], one.snapshots[0]] }, [])).toBeNull();
  });
});
