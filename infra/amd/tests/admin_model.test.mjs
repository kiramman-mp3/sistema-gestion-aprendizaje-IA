import { describe, expect, it } from "vitest";
import {
  adminErrorKind,
  auditQuery,
  errorDetails,
  eventDetail,
  outcomeBadge,
  RULE_FIELDS,
  toIso,
  toRuleRequest,
  validateRuleForm,
} from "../../../moodle/local/ai_assistant/amd/src/admin_model.js";

describe("consulta de la auditoría", () => {
  it("pide siempre una página de 50 y no manda los filtros vacíos", () => {
    expect(auditQuery({ action: " ", actorId: "", outcome: "" })).toBe("limit=50");
  });

  it("manda los filtros escritos, sin espacios sobrantes", () => {
    const params = new URLSearchParams(
      auditQuery({ courseId: "7", actorId: " 4 ", action: "proposal.", outcome: "DENIED" }),
    );

    expect(Object.fromEntries(params)).toEqual({
      limit: "50",
      courseId: "7",
      actorId: "4",
      action: "proposal.",
      outcome: "DENIED",
    });
  });

  it("convierte las fechas de los campos datetime-local a ISO en UTC y descarta las inválidas", () => {
    const params = new URLSearchParams(auditQuery({ from: "2026-11-10T08:30", to: "ayer" }));

    expect(params.get("from")).toBe(new Date("2026-11-10T08:30").toISOString());
    expect(params.has("to")).toBe(false);
    expect(toIso("")).toBeNull();
    expect(toIso(undefined)).toBeNull();
  });

  it("la página siguiente lleva el cursor", () => {
    expect(new URLSearchParams(auditQuery({}, "abc")).get("cursor")).toBe("abc");
  });
});

describe("filas de la auditoría", () => {
  it("el detalle junta el recurso y los metadatos, con un guion para un valor nulo", () => {
    expect(
      eventDetail({
        resourceType: "proposal",
        resourceId: "p1",
        metadata: { items: 4, ok: true, note: null },
      }),
    ).toBe("proposal p1, items=4, ok=true, note=—");
    expect(eventDetail({ resourceType: "proposal", resourceId: null, metadata: null })).toBe(
      "proposal",
    );
    expect(eventDetail({ metadata: null })).toBe("");
  });

  it("cada resultado tiene su color", () => {
    expect(outcomeBadge("SUCCESS")).toContain("success");
    expect(outcomeBadge("DENIED")).toContain("warning");
    expect(outcomeBadge("ERROR")).toContain("danger");
    expect(outcomeBadge("OTRO")).toContain("secondary");
  });
});

describe("formulario de una regla", () => {
  const field = (rule, name) => RULE_FIELDS[rule].find((f) => f.name === name);

  it("las cuatro reglas del backend tienen campos", () => {
    expect(Object.keys(RULE_FIELDS)).toEqual([
      "MISSING_REQUIRED",
      "GRADE_BELOW_THRESHOLD",
      "SUSTAINED_DECLINE",
      "REPEATED_OUTCOME_DIFFICULTY",
    ]);
  });

  it("acepta valores válidos como números y omite el campo opcional vacío", () => {
    expect(
      validateRuleForm("GRADE_BELOW_THRESHOLD", {
        thresholdPercent: "65.5",
        minActivities: "3",
        windowDays: "",
      }),
    ).toEqual({ params: { thresholdPercent: 65.5, minActivities: 3 }, errors: {} });
  });

  it("incluye el campo opcional cuando se escribe", () => {
    expect(
      validateRuleForm("MISSING_REQUIRED", { minMissing: "2", windowDays: "30" }).params,
    ).toEqual({ minMissing: 2, windowDays: 30 });
  });

  it.each([
    ["GRADE_BELOW_THRESHOLD", "thresholdPercent", "101"],
    ["GRADE_BELOW_THRESHOLD", "thresholdPercent", "-1"],
    ["GRADE_BELOW_THRESHOLD", "minActivities", "1.5"],
    ["GRADE_BELOW_THRESHOLD", "minActivities", "0"],
    ["SUSTAINED_DECLINE", "consecutive", "2"],
    ["SUSTAINED_DECLINE", "consecutive", "11"],
    ["MISSING_REQUIRED", "minMissing", "abc"],
    ["MISSING_REQUIRED", "windowDays", "366"],
  ])("rechaza %s.%s = %s y dice el rango permitido", (rule, name, value) => {
    const base = { thresholdPercent: "60", minActivities: "2", consecutive: "3", minMissing: "2" };

    const { errors, params } = validateRuleForm(rule, { ...base, [name]: value });

    expect(errors[name]).toEqual({ min: field(rule, name).min, max: field(rule, name).max });
    expect(params[name]).toBeUndefined();
  });

  it("un campo obligatorio vacío es un error", () => {
    expect(Object.keys(validateRuleForm("SUSTAINED_DECLINE", { consecutive: "" }).errors)).toEqual([
      "consecutive",
    ]);
  });

  it("el cuerpo de la petición lleva el curso (o null para la institución)", () => {
    expect(toRuleRequest(null, true, { minMissing: 2 })).toEqual({
      courseId: null,
      enabled: true,
      params: { minMissing: 2 },
    });
  });
});

describe("errores de la administración", () => {
  it("clasifica los códigos y estados", () => {
    expect(adminErrorKind({ status: 403 })).toBe("forbidden");
    expect(adminErrorKind({ code: "FORBIDDEN_CAPABILITY" })).toBe("forbidden");
    expect(adminErrorKind({ status: 400 })).toBe("validation");
    expect(adminErrorKind({ code: "VALIDATION_ERROR" })).toBe("validation");
    expect(adminErrorKind({ code: "RULE_NOT_FOUND" })).toBe("notfound");
    expect(adminErrorKind({ status: 500 })).toBe("other");
  });

  it("lista hasta cinco campos rechazados", () => {
    const details = Array.from({ length: 7 }, (_, i) => ({ path: `c${i}`, message: "mal" }));

    expect(errorDetails({ details })).toHaveLength(5);
    expect(errorDetails({ details: [{ message: "solo" }, null, { path: "x" }] })).toEqual(["solo"]);
    expect(errorDetails({})).toEqual([]);
  });
});
