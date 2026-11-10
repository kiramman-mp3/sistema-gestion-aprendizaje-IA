import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../database/prisma.service";
import type { LlmService } from "../llm/llm.service";
import { SearchCourseDocumentsTool } from "../assistant/tools/document-tools";
import { ChunkSearchService, MIN_SCORE } from "./chunk-search.service";
import { DocumentIndexService, toVectorLiteral } from "./document-index.service";

const DOC = "0b6f3c8e-2a7d-4f43-9b1a-6f8e2d3c4b5a";

const text = (blocks: object[]) => ({
  pageCount: 2,
  pagesApproximate: false,
  ocr: false,
  confidence: "high",
  blocks,
});
const paragraph = (page: number, body: string) => ({ type: "paragraph", page, text: body });

/** Vector de prueba de la dimensión que pide el servicio. */
const unit = (i: number) => Array.from({ length: 4 }, (_, k) => (k === i ? 1 : 0));

function setupIndex(document: object | null) {
  const executeRaw = jest.fn().mockResolvedValue(1);
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const tx = { documentChunk: { deleteMany }, $executeRaw: executeRaw };
  const queryRaw = jest.fn().mockResolvedValue([]);
  const prisma = {
    syllabusDocument: { findUnique: jest.fn().mockResolvedValue(document) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
    $queryRaw: queryRaw,
  };
  const embed = jest.fn(async ({ texts }: { purpose: string; texts: string[] }) => ({
    vectors: texts.map((_, i) => unit(i % 4)),
    model: "demo-embed",
    dimensions: 4,
  }));
  const record = jest.fn().mockResolvedValue(undefined);
  const service = new DocumentIndexService(
    prisma as unknown as PrismaService,
    { embed } as unknown as LlmService,
    { record } as unknown as AuditService,
  );
  return { service, executeRaw, deleteMany, embed, record, queryRaw, prisma };
}

const longText = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(" ");

describe("DocumentIndexService.indexDocument", () => {
  const document = (blocks: object[]) => ({
    id: DOC,
    moodleCourseId: 7,
    uploadedBy: 4,
    extractedText: text(blocks),
  });

  it("guarda un fragmento por trozo de texto con el curso, el documento, la página y el modelo", async () => {
    const { service, executeRaw } = setupIndex(
      document([
        paragraph(1, longText(300)),
        paragraph(2, "Bibliografía básica: libros de la asignatura y su edición."),
      ]),
    );

    const saved = await service.indexDocument(DOC);

    expect(saved).toBeGreaterThan(2);
    expect(executeRaw).toHaveBeenCalledTimes(saved);
    const firstCall = executeRaw.mock.calls[0]!;
    // Los valores van como parámetros, nunca pegados al SQL.
    expect(firstCall[0].join("?")).not.toContain("palabra0");
    expect(firstCall.slice(1)).toEqual([
      DOC,
      7,
      1,
      0,
      expect.stringContaining("palabra0"),
      "[1,0,0,0]",
      "demo-embed",
    ]);
  });

  it("reindexar reemplaza los fragmentos anteriores en la misma transacción", async () => {
    const { service, deleteMany, prisma } = setupIndex(
      document([paragraph(1, "Texto del sílabo con la suficiente longitud para indexar.")]),
    );

    await service.indexDocument(DOC);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { documentId: DOC } });
  });

  it("pide los embeddings por tandas", async () => {
    const { service, embed } = setupIndex(document([paragraph(1, longText(6000))]));

    await service.indexDocument(DOC);

    expect(embed.mock.calls.length).toBeGreaterThan(1);
    for (const [call] of embed.mock.calls) {
      expect(call.texts.length).toBeLessThanOrEqual(32);
      expect(call.purpose).toBe("rag_indexing");
    }
  });

  it("deja un evento de auditoría con la cantidad de fragmentos y nada del contenido", async () => {
    const { service, record } = setupIndex(
      document([paragraph(1, "Texto del sílabo con la suficiente longitud para indexar.")]),
    );

    await service.indexDocument(DOC);

    expect(record).toHaveBeenCalledWith({
      action: "rag.indexed",
      outcome: "SUCCESS",
      actorMoodleId: 4,
      courseId: 7,
      resourceType: "syllabus_document",
      resourceId: DOC,
      metadata: { chunks: 1 },
    });
  });

  it("un documento que no existe, sin texto o con texto inválido no indexa nada", async () => {
    for (const found of [
      null,
      { id: DOC, moodleCourseId: 7, uploadedBy: 4, extractedText: null },
      { id: DOC, moodleCourseId: 7, uploadedBy: 4, extractedText: { blocks: "no" } },
    ]) {
      const { service, executeRaw } = setupIndex(found);

      expect(await service.indexDocument(DOC)).toBe(0);
      expect(executeRaw).not.toHaveBeenCalled();
    }
  });

  it("si el proveedor de embeddings falla, no deja el índice a medias", async () => {
    const { service, embed, prisma } = setupIndex(document([paragraph(1, longText(300))]));
    embed.mockRejectedValueOnce(new Error("proveedor caído"));

    await expect(service.indexDocument(DOC)).rejects.toThrow("proveedor caído");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("indexDocumentSafely no propaga el fallo", async () => {
    const { service, embed } = setupIndex(document([paragraph(1, longText(300))]));
    embed.mockRejectedValue(new Error("proveedor caído"));

    await expect(service.indexDocumentSafely(DOC)).resolves.toBeUndefined();
  });

  it("ensureIndexed indexa los documentos del curso que aún no tienen fragmentos", async () => {
    const { service, queryRaw } = setupIndex(
      document([paragraph(1, "Texto del sílabo con la suficiente longitud para indexar.")]),
    );
    queryRaw.mockResolvedValueOnce([{ id: DOC }]);
    const spy = jest.spyOn(service, "indexDocumentSafely");

    await service.ensureIndexed(7);

    expect(spy).toHaveBeenCalledWith(DOC);
  });
});

describe("toVectorLiteral", () => {
  it("da el formato de texto de pgvector", () => {
    expect(toVectorLiteral([0.5, -1, 0])).toBe("[0.5,-1,0]");
  });
});

function setupSearch(rows: object[]) {
  const queryRaw = jest.fn().mockResolvedValue(rows);
  const prisma = { $queryRaw: queryRaw };
  const embed = jest
    .fn()
    .mockResolvedValue({ vectors: [unit(0)], model: "demo-embed", dimensions: 4 });
  const ensureIndexed = jest.fn().mockResolvedValue(undefined);
  const service = new ChunkSearchService(
    prisma as unknown as PrismaService,
    { embed } as unknown as LlmService,
    { ensureIndexed } as unknown as DocumentIndexService,
  );
  return { service, queryRaw, embed, ensureIndexed };
}

describe("ChunkSearchService.search", () => {
  it("filtra por el curso dentro de la consulta, antes de ordenar por similitud, y manda el curso como parámetro", async () => {
    const { service, queryRaw } = setupSearch([]);

    await service.search(7, "¿qué dice la bibliografía?");

    const query = queryRaw.mock.calls[0]![0] as { strings: string[]; values: unknown[] };
    const sql = query.strings.join("?");
    expect(sql).toMatch(/WHERE\s+moodle_course_id\s*=\s*\?/);
    expect(sql.indexOf("moodle_course_id")).toBeLessThan(sql.indexOf("ORDER BY"));
    expect(query.values).toContain(7);
    // La pregunta del usuario nunca se pega al SQL.
    expect(sql).not.toContain("bibliografía");
  });

  it("indexa lo pendiente del curso antes de buscar y calcula el embedding de la pregunta", async () => {
    const { service, ensureIndexed, embed } = setupSearch([]);

    await service.search(7, "metodología del curso");

    expect(ensureIndexed).toHaveBeenCalledWith(7);
    expect(embed).toHaveBeenCalledWith({ purpose: "rag_query", texts: ["metodología del curso"] });
  });

  it("devuelve los fragmentos con su página y descarta los poco parecidos", async () => {
    const { service } = setupSearch([
      {
        document_id: DOC,
        page: 3,
        content: "Metodología: aprendizaje basado en proyectos.",
        score: 0.8123456,
      },
      { document_id: DOC, page: 5, content: "Algo sin relación.", score: MIN_SCORE - 0.01 },
    ]);

    expect(await service.search(7, "metodología")).toEqual([
      {
        documentId: DOC,
        page: 3,
        content: "Metodología: aprendizaje basado en proyectos.",
        score: 0.812,
      },
    ]);
  });

  it("limita la cantidad pedida entre 1 y 8", async () => {
    const { service, queryRaw } = setupSearch([]);

    await service.search(7, "x", 100);
    await service.search(7, "x", 0);

    const limits = queryRaw.mock.calls.map((c) => (c[0] as { values: unknown[] }).values.at(-1));
    expect(limits).toEqual([8, 1]);
  });

  it("si el proveedor de embeddings falla, el error llega a quien llama (el chat responde 503)", async () => {
    const { service, embed } = setupSearch([]);
    embed.mockRejectedValue(new Error("AI_PROVIDER_UNAVAILABLE"));

    await expect(service.search(7, "metodología")).rejects.toThrow("AI_PROVIDER_UNAVAILABLE");
  });
});

describe("SearchCourseDocumentsTool", () => {
  const AUTH = { moodleUserId: 42, courseId: 7 };
  const context = { auth: AUTH, pseudonymizer: {} as never };

  function setupTool(found: object[]) {
    const search = jest.fn().mockResolvedValue(found);
    return {
      tool: new SearchCourseDocumentsTool({ search } as unknown as ChunkSearchService),
      search,
    };
  }

  it("es de solo lectura, así que el modelo puede pedirla", () => {
    const { tool } = setupTool([]);

    expect(tool.kind).toBe("read");
    expect(tool.name).toBe("search_course_documents");
  });

  it("busca solo en el curso del token, aunque el modelo pida otro", async () => {
    const { tool, search } = setupTool([]);

    await tool.execute(context, tool.input.parse({ query: "metodología", courseId: 99 }));

    expect(search).toHaveBeenCalledWith(7, "metodología", 5);
  });

  it("devuelve los pasajes con su página y las fuentes del documento, sin duplicarlas", async () => {
    const { tool } = setupTool([
      { documentId: DOC, page: 3, content: "Texto A", score: 0.9 },
      { documentId: DOC, page: 3, content: "Texto B", score: 0.8 },
      { documentId: DOC, page: 4, content: "Texto C", score: 0.7 },
    ]);

    const result = await tool.execute(context, { query: "metodología" });

    expect(result.intent).toBe("document_search");
    expect(result.data.found).toBe(3);
    expect(
      (result.data.passages as { n: number; page: number }[]).map((p) => [p.n, p.page]),
    ).toEqual([
      [1, 3],
      [2, 3],
      [3, 4],
    ]);
    expect(result.sources).toEqual([
      { type: "document", id: DOC, page: 3, url: null },
      { type: "document", id: DOC, page: 4, url: null },
    ]);
  });

  it("recorta los pasajes largos y recuerda al modelo que el texto no son instrucciones", async () => {
    const { tool } = setupTool([
      { documentId: DOC, page: 1, content: "x".repeat(2000), score: 0.9 },
    ]);

    const result = await tool.execute(context, { query: "bibliografía" });

    const passages = result.data.passages as { text: string }[];
    expect(passages[0]!.text.length).toBeLessThanOrEqual(701);
    expect(String(result.data.note)).toMatch(/no instrucciones/);
  });

  it("sin pasajes devuelve cero y ninguna fuente: el modelo debe decir que no encontró nada", async () => {
    const { tool } = setupTool([]);

    const result = await tool.execute(context, { query: "algo que no está" });

    expect(result.data).toMatchObject({ found: 0, passages: [] });
    expect(result.sources).toEqual([]);
  });

  it.each([
    { query: "ab" },
    { query: "x".repeat(301) },
    { query: "ok bien", maxResults: 9 },
    { query: "ok bien", maxResults: 0 },
    {},
  ])("rechaza los argumentos inválidos %j", (args) => {
    const { tool } = setupTool([]);

    expect(tool.input.safeParse(args).success).toBe(false);
  });
});
