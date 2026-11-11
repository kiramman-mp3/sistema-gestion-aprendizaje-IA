import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../database/prisma.service";
import { FollowupsService } from "./followups.service";

const ID = "00000000-0000-4000-8000-000000000001";
const AUTH = { moodleUserId: 42, courseId: 7 };

function setup(recommendation: { moodleCourseId: number; requestedBy: number } | null) {
  const created: Record<string, unknown>[] = [];
  const prisma = {
    pedagogicalRecommendation: {
      findUnique: jest.fn(async () => (recommendation ? { id: ID, ...recommendation } : null)),
    },
    recommendationFollowup: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: "f1", recommendationId: ID, createdAt: new Date("2026-11-10T12:00:00Z") };
      }),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new FollowupsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, created, audit };
}

describe("FollowupsService", () => {
  it("registra el seguimiento de una recomendación propia del curso", async () => {
    const { service, created } = setup({ moodleCourseId: 7, requestedBy: 42 });

    const result = await service.add(AUTH, ID, {
      actionTaken: "Tutoría de 20 minutos",
      observedResult: "Entregó la actividad pendiente",
    });

    expect(result).toEqual({
      id: "f1",
      recommendationId: ID,
      createdAt: "2026-11-10T12:00:00.000Z",
    });
    expect(created[0]).toEqual({
      recommendationId: ID,
      teacherId: 42,
      actionTaken: "Tutoría de 20 minutos",
      observedResult: "Entregó la actividad pendiente",
    });
  });

  it("acepta un seguimiento sin resultado observado todavía", async () => {
    const { service, created } = setup({ moodleCourseId: 7, requestedBy: 42 });

    await service.add(AUTH, ID, { actionTaken: "Revisar la entrega", observedResult: "  " });

    expect(created[0]).toMatchObject({ observedResult: null });
  });

  it.each([
    ["sin acción", {}],
    ["acción vacía", { actionTaken: "   " }],
    ["acción demasiado larga", { actionTaken: "a".repeat(2001) }],
    ["resultado demasiado largo", { actionTaken: "x", observedResult: "a".repeat(2001) }],
  ])("responde 400 %s", async (_name, body) => {
    const { service, created } = setup({ moodleCourseId: 7, requestedBy: 42 });

    await expect(service.add(AUTH, ID, body)).rejects.toMatchObject({
      response: { code: "VALIDATION_ERROR" },
    });
    expect(created).toHaveLength(0);
  });

  it.each([
    ["no existe", null],
    ["es de otro curso", { moodleCourseId: 8, requestedBy: 42 }],
    ["es de otro docente", { moodleCourseId: 7, requestedBy: 43 }],
  ])("responde 404 si la recomendación %s", async (_name, recommendation) => {
    const { service, created } = setup(recommendation);

    await expect(service.add(AUTH, ID, { actionTaken: "x" })).rejects.toMatchObject({
      response: { code: "RECOMMENDATION_NOT_FOUND" },
    });
    expect(created).toHaveLength(0);
  });

  it("responde 404 si el id no es un uuid", async () => {
    const { service } = setup({ moodleCourseId: 7, requestedBy: 42 });

    await expect(service.add(AUTH, "no-uuid", { actionTaken: "x" })).rejects.toMatchObject({
      response: { code: "RECOMMENDATION_NOT_FOUND" },
    });
  });

  it("audita sin el texto que escribió el docente", async () => {
    const { service, audit } = setup({ moodleCourseId: 7, requestedBy: 42 });

    await service.add(AUTH, ID, { actionTaken: "Hablé con Ana Pérez" });

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "recommendation.followup", resourceId: ID }),
    );
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("Ana");
  });
});
