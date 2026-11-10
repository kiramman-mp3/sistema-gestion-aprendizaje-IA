import { buildSyllabusExtraction } from "@smart-lms/contracts";
import { generateProposalItems } from "./proposal-generator";
import { DEFAULT_PROPOSAL_POLICY, type ProposalPolicy } from "./proposal-policy";
import { findProposalIssues, periodOf, type ProposalItemData } from "./proposal-validation";

/** Convierte el borrador del generador en elementos con id, como los devuelve la base. */
function items(overrides: (draft: ProposalItemData[]) => void = () => {}): ProposalItemData[] {
  const drafts = generateProposalItems(buildSyllabusExtraction());
  const ids = new Map(drafts.map((draft, i) => [draft.key, `id-${i}`]));
  const data = drafts.map((draft) => ({
    id: ids.get(draft.key)!,
    parentId: draft.parentKey ? ids.get(draft.parentKey)! : null,
    itemType: draft.itemType,
    title: draft.title,
    position: draft.position,
    unitRef: draft.unitRef,
    learningOutcomeIds: draft.learningOutcomeIds,
    weight: draft.weight,
  }));
  overrides(data);
  return data;
}

const codes = (issues: { code: string }[]) => issues.map((issue) => issue.code);

describe("findProposalIssues", () => {
  it("una propuesta generada de una extracción coherente no tiene errores", () => {
    const issues = findProposalIssues(items(), DEFAULT_PROPOSAL_POLICY);

    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("rechaza una propuesta sin secciones", () => {
    expect(findProposalIssues([], DEFAULT_PROPOSAL_POLICY)).toEqual([
      expect.objectContaining({ code: "EMPTY_PROPOSAL", severity: "error" }),
    ]);
  });

  it("marca como error un título vacío", () => {
    const data = items((list) => {
      list[1]!.title = "   ";
    });

    expect(findProposalIssues(data, DEFAULT_PROPOSAL_POLICY)).toContainEqual(
      expect.objectContaining({ code: "EMPTY_TITLE", severity: "error", itemId: "id-1" }),
    );
  });

  it("avisa de la actividad sin resultado de aprendizaje (RF-07)", () => {
    const data = items((list) => {
      list[1]!.learningOutcomeIds = [];
    });

    expect(findProposalIssues(data, DEFAULT_PROPOSAL_POLICY)).toContainEqual(
      expect.objectContaining({
        code: "ACTIVITY_WITHOUT_OUTCOME",
        severity: "warning",
        itemId: "id-1",
      }),
    );
  });

  it("no pide resultado de aprendizaje a una sección", () => {
    const data = items((list) => {
      list[0]!.learningOutcomeIds = [];
    });

    expect(codes(findProposalIssues(data, DEFAULT_PROPOSAL_POLICY))).not.toContain(
      "ACTIVITY_WITHOUT_OUTCOME",
    );
  });

  it("avisa de una sección sin actividades", () => {
    const data = items((list) => {
      list.pop();
    });

    expect(findProposalIssues(data, DEFAULT_PROPOSAL_POLICY)).toContainEqual(
      expect.objectContaining({ code: "SECTION_WITHOUT_ACTIVITIES", itemId: "id-2" }),
    );
  });

  describe("ponderaciones (D-04)", () => {
    it("es error que las ponderaciones de un periodo superen el total", () => {
      const data = items((list) => {
        list[1]!.weight = 70;
        list.push({ ...list[1]!, id: "extra", weight: 40, position: 4 });
      });

      expect(findProposalIssues(data, DEFAULT_PROPOSAL_POLICY)).toContainEqual(
        expect.objectContaining({
          code: "PERIOD_WEIGHTS_EXCEED_TOTAL",
          severity: "error",
          message: "Las ponderaciones de el periodo 1 suman 110, más de 100.",
        }),
      );
    });

    it("avisa si todas están definidas pero no suman el total", () => {
      const data = items((list) => {
        list[1]!.weight = 30;
      });

      expect(findProposalIssues(data, DEFAULT_PROPOSAL_POLICY)).toContainEqual(
        expect.objectContaining({ code: "PERIOD_WEIGHTS_NOT_TOTAL", severity: "warning" }),
      );
    });

    it("no avisa si falta alguna ponderación: el docente aún debe completarla", () => {
      const data = items((list) => {
        list[1]!.weight = 30;
        list.push({ ...list[1]!, id: "extra", weight: null, position: 4 });
      });

      const found = codes(findProposalIssues(data, DEFAULT_PROPOSAL_POLICY));

      expect(found).not.toContain("PERIOD_WEIGHTS_NOT_TOTAL");
      expect(found).not.toContain("PERIOD_WEIGHTS_EXCEED_TOTAL");
    });

    it("acepta exactamente el total, con tolerancia de decimales", () => {
      const data = items((list) => {
        list[1]!.weight = 33.33;
        list.push({ ...list[1]!, id: "b", weight: 33.33, position: 4 });
        list.push({ ...list[1]!, id: "c", weight: 33.34, position: 5 });
      });

      const found = codes(findProposalIssues(data, DEFAULT_PROPOSAL_POLICY));

      expect(found).not.toContain("PERIOD_WEIGHTS_NOT_TOTAL");
      expect(found).not.toContain("PERIOD_WEIGHTS_EXCEED_TOTAL");
    });

    it("usa el total de la política institucional", () => {
      const policy: ProposalPolicy = { ...DEFAULT_PROPOSAL_POLICY, periodWeightTotal: 20 };
      const data = items((list) => {
        list[1]!.weight = 30;
      });

      expect(codes(findProposalIssues(data, policy))).toContain("PERIOD_WEIGHTS_EXCEED_TOTAL");
    });

    it("calcula cada periodo por separado", () => {
      const data = items((list) => {
        list[1]!.weight = 100;
        list[3]!.weight = 100;
      });

      expect(codes(findProposalIssues(data, DEFAULT_PROPOSAL_POLICY))).not.toContain(
        "PERIOD_WEIGHTS_EXCEED_TOTAL",
      );
    });
  });

  describe("tipos permitidos (D-05)", () => {
    it("es error crear un tipo que la institución no habilitó", () => {
      const policy: ProposalPolicy = {
        ...DEFAULT_PROPOSAL_POLICY,
        enabledItemTypes: ["SECTION", "FORUM"],
      };

      expect(findProposalIssues(items(), policy)).toContainEqual(
        expect.objectContaining({
          code: "ITEM_TYPE_NOT_ENABLED",
          severity: "error",
          itemId: "id-1",
        }),
      );
    });
  });
});

describe("periodOf", () => {
  it("extrae el periodo de la ruta de la unidad", () => {
    expect(periodOf("gradingPeriods[2].units[0]")).toBe("gradingPeriods[2]");
    expect(periodOf("custom")).toBe("other");
  });
});
