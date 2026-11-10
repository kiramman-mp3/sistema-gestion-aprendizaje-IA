import { syllabusExtractionSchema, type DocumentText } from "@smart-lms/contracts";
import { z } from "zod";
import {
  recommendationContentSchema,
  validateRecommendationLanguage,
} from "../../recommendations/pedagogical-language";
import { AiOrchestratorService } from "../../assistant/ai-orchestrator.service";
import { ToolRegistry, type AssistantTool } from "../../assistant/tools/assistant-tool";
import { Pseudonymizer } from "../../privacy/pseudonymizer";
import { SyllabusExtractorService } from "../../syllabi/extraction/syllabus-extractor.service";
import { LlmService } from "../llm.service";
import { DEMO_NOTICE, DemoLlmProvider } from "./demo-llm.provider";

const LIMITS = { maxInputTokens: 32_000, maxOutputTokens: 8_192, timeoutMs: 5_000 };
const SECRET = "una-clave-de-prueba-de-al-menos-32-caracteres";

function llm(): LlmService {
  return new LlmService(new DemoLlmProvider(), { record: () => undefined }, LIMITS);
}

const TEXT: DocumentText = {
  pageCount: 1,
  pagesApproximate: false,
  ocr: false,
  confidence: "high",
  blocks: [{ type: "paragraph", page: 1, text: "Sílabo de Ingeniería de Software" }],
};

function tool(name: string, data: Record<string, unknown>): AssistantTool {
  return {
    name,
    description: name,
    kind: "read",
    input: z.object({}),
    execute: async () => ({ data, sources: [] }),
  };
}

function assistant(tools: AssistantTool[]) {
  const service = new AiOrchestratorService(llm(), new ToolRegistry(tools));
  return (message: string) =>
    service.run({
      auth: { moodleUserId: 42, courseId: 7 },
      history: [],
      message,
      pseudonymizer: new Pseudonymizer(SECRET, 7),
    });
}

describe("DemoLlmProvider · extracción", () => {
  it("devuelve una extracción que cumple el esquema v1, pasando por la verificación contra el texto", async () => {
    const result = await new SyllabusExtractorService(llm()).extract(TEXT);

    expect(syllabusExtractionSchema.safeParse(result.extraction).success).toBe(true);
    expect(result.model).toBe("demo-1");
    // El documento no trae las fechas ni las ponderaciones del ejemplo: se anulan y quedan para revisión.
    const unit = result.extraction.gradingPeriods[0]!.units[0]!;
    expect(unit.startDate).toBeNull();
    expect(result.droppedPaths.length).toBeGreaterThan(0);
    expect(result.extraction.uncertainFields.length).toBeGreaterThan(0);
  });

  it("no sabe responder a un esquema que no conoce, en vez de inventar", async () => {
    await expect(
      llm().generateStructured({
        purpose: "otro",
        system: "s",
        prompt: "p",
        schema: z.object({ x: z.string() }),
        schemaName: "otro",
      }),
    ).rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE" });
  });
});

describe("DemoLlmProvider · recomendación", () => {
  it("devuelve una recomendación válida y en lenguaje aceptable, marcada como demostración", async () => {
    const result = await llm().generateStructured({
      purpose: "pedagogical_recommendation",
      system: "s",
      prompt: "p",
      schema: recommendationContentSchema,
      schemaName: "pedagogical_recommendation_v1",
    });

    expect(validateRecommendationLanguage(result.data)).toEqual([]);
    expect(result.data.evidenceSummary[0]).toContain(DEMO_NOTICE);
  });
});

describe("DemoLlmProvider · chat", () => {
  it.each([
    ["¿Qué entregas están pendientes de calificar?", "get_pending_grading"],
    ["Dame el promedio de notas", "get_grade_summary"],
    ["¿Qué actividades tiene el curso?", "get_course_activities"],
    ["¿Cómo va el rendimiento por unidad?", "get_unit_performance"],
  ])("«%s» consulta %s y resume lo que devolvió", async (question, expectedTool) => {
    const run = assistant([
      tool("get_pending_grading", { totalPending: 3 }),
      tool("get_grade_summary", { average: 7.5 }),
      tool("get_course_activities", { count: 4 }),
      tool("get_unit_performance", { units: [] }),
    ]);

    const result = await run(question);

    expect(result.toolsUsed).toEqual([expectedTool]);
    expect(result.answer).toContain(DEMO_NOTICE);
    expect(result.answer).toContain(expectedTool);
  });

  it("la búsqueda en documentos recibe la pregunta y cita la página del pasaje", async () => {
    const run = assistant([
      tool("search_course_documents", {
        found: 1,
        passages: [{ page: 2, text: "Bibliografía básica: libros." }],
      }),
    ]);

    const result = await run("¿Qué dice el sílabo sobre la bibliografía?");

    expect(result.toolsUsed).toEqual(["search_course_documents"]);
    expect(result.answer).toContain("página 2");
    expect(result.answer).toContain("Bibliografía básica: libros.");
  });

  it("si la búsqueda no encuentra nada, lo dice y no inventa", async () => {
    const run = assistant([tool("search_course_documents", { found: 0, passages: [] })]);

    const result = await run("¿Qué dice el documento sobre becas?");

    expect(result.answer).toContain("No encontré esa información");
  });

  it("deja claro que es una demostración en toda respuesta", async () => {
    const result = await assistant([])("Hola");

    expect(result.answer).toContain(DEMO_NOTICE);
    expect(result.toolsUsed).toEqual([]);
  });

  it("dice la verdad cuando la herramienta falla, sin inventar datos", async () => {
    const failing: AssistantTool = {
      name: "get_course_activities",
      description: "x",
      kind: "read",
      input: z.object({}),
      execute: async () => {
        throw new Error("Moodle no tiene la función");
      },
    };

    const result = await assistant([failing])("¿Qué actividades hay?");

    expect(result.answer).toContain("No pude consultar");
    expect(result.incompleteData).toBe(true);
  });

  it("no consulta una herramienta que no se le ofreció", async () => {
    const result = await assistant([tool("get_course_activities", {})])("Promedio de notas");

    expect(result.toolsUsed).toEqual([]);
    expect(result.answer).toContain("No tengo una herramienta");
  });

  it("entrega la respuesta por trozos, como un proveedor con streaming", async () => {
    const pieces: string[] = [];
    const provider = new DemoLlmProvider();

    const response = await provider.generateChat({
      system: "s",
      messages: [{ role: "user", content: "hola" }],
      tools: [],
      maxOutputTokens: 100,
      signal: new AbortController().signal,
      onToken: (text) => pieces.push(text),
    });

    expect(response.kind).toBe("text");
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join("")).toBe((response as { text: string }).text);
  });
});
