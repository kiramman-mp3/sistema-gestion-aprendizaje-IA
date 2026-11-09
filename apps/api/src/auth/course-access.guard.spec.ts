import type { ExecutionContext } from "@nestjs/common";
import type { AuditService } from "../audit/audit.service";
import { Reflector } from "@nestjs/core";
import { MoodleUnavailableError } from "../integrations/moodle/moodle.errors";
import type { CourseAccess } from "../integrations/moodle/moodle.types";
import type { AccessService } from "./access.service";
import type { AuthenticatedRequest } from "./auth-context";
import { CourseAccessGuard } from "./course-access.guard";
import { IS_PUBLIC } from "./public.decorator";
import { REQUIRED_CAPABILITIES } from "./require-capability.decorator";

const teacher: CourseAccess = {
  userid: 4,
  courseid: 2,
  courseexists: true,
  active: true,
  roles: ["teacher"],
  capabilities: { use: true, publish: false, viewanalytics: true },
};

function setup(access: CourseAccess | Error, metadata: Record<string, unknown> = {}) {
  const reflector = new Reflector();
  jest.spyOn(reflector, "getAllAndOverride").mockImplementation((key) => metadata[key as string]);
  const getAccess = jest.fn(async () => {
    if (access instanceof Error) throw access;
    return access;
  });
  const record = jest.fn().mockResolvedValue(undefined);
  const guard = new CourseAccessGuard(
    reflector,
    { getAccess } as unknown as AccessService,
    { record } as unknown as AuditService,
  );
  const request = {
    auth: { moodleUserId: 4, courseId: 2 },
    params: {},
    method: "GET",
    path: "/api/v1/session",
  } as unknown as AuthenticatedRequest;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { guard, request, context, getAccess, record };
}

const rejection = (code: string) =>
  expect.objectContaining({ response: expect.objectContaining({ code }) });

describe("CourseAccessGuard", () => {
  it("permite el acceso y adjunta roles y capacidades", async () => {
    const { guard, context, request } = setup(teacher);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.auth).toMatchObject({ roles: ["teacher"], capabilities: teacher.capabilities });
  });

  it("no consulta Moodle en rutas públicas", async () => {
    const { guard, context, getAccess } = setup(teacher, { [IS_PUBLIC]: true });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getAccess).not.toHaveBeenCalled();
  });

  it("SEC-02: rechaza a un usuario sin la capacidad use (por ejemplo, un estudiante)", async () => {
    const student = {
      ...teacher,
      roles: ["student"],
      capabilities: { use: false, publish: false, viewanalytics: false },
    };
    const { guard, context, record } = setup(student);

    await expect(guard.canActivate(context)).rejects.toEqual(rejection("FORBIDDEN_COURSE"));
    expect(record).toHaveBeenCalledWith({
      action: "access.denied",
      outcome: "DENIED",
      actorMoodleId: 4,
      courseId: 2,
      metadata: { code: "FORBIDDEN_COURSE", method: "GET", path: "/api/v1/session" },
    });
  });

  it.each([
    ["curso inexistente", { courseexists: false }],
    ["usuario suspendido", { active: false }],
  ])("rechaza un %s", async (_case, patch) => {
    const { guard, context } = setup({ ...teacher, ...patch });

    await expect(guard.canActivate(context)).rejects.toEqual(rejection("FORBIDDEN_COURSE"));
  });

  it("SEC-01: rechaza un courseId de la ruta distinto al del token sin consultar Moodle", async () => {
    const { guard, context, request, getAccess } = setup(teacher);
    request.params = { courseId: "3" };

    await expect(guard.canActivate(context)).rejects.toEqual(rejection("FORBIDDEN_COURSE"));
    expect(getAccess).not.toHaveBeenCalled();
  });

  it("acepta un courseId de la ruta igual al del token", async () => {
    const { guard, context, request } = setup(teacher);
    request.params = { courseId: "2" };

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("exige las capacidades pedidas con @RequireCapability", async () => {
    const { guard, context } = setup(teacher, { [REQUIRED_CAPABILITIES]: ["publish"] });

    await expect(guard.canActivate(context)).rejects.toEqual(rejection("FORBIDDEN_CAPABILITY"));
  });

  it("falla cerrado con 503 si Moodle no responde", async () => {
    const { guard, context } = setup(new MoodleUnavailableError("caído", "f"));

    await expect(guard.canActivate(context)).rejects.toEqual(rejection("MOODLE_UNAVAILABLE"));
  });
});
