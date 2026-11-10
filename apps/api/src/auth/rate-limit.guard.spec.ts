import { HttpException, type ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { Reflector } from "@nestjs/core";
import type { AuditService } from "../audit/audit.service";
import type { Env } from "../config/env";
import { InMemoryRateLimitStore, RateLimitGuard, RateLimitStore } from "./rate-limit.guard";

function setup(options: { limit?: number; store?: RateLimitStore; isPublic?: boolean } = {}) {
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const headers: Record<string, string> = {};
  const guard = new RateLimitGuard(
    { getAllAndOverride: () => options.isPublic ?? false } as unknown as Reflector,
    options.store ?? new InMemoryRateLimitStore(),
    audit as unknown as AuditService,
    { get: () => options.limit ?? 3 } as unknown as ConfigService<Env, true>,
  );
  const context = (auth: object | null = { moodleUserId: 42, courseId: 7 }) =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({
        getRequest: () => ({ auth: auth ?? undefined, method: "GET", path: "/api/v1/session" }),
        getResponse: () => ({
          setHeader: (name: string, value: string) => (headers[name] = value),
        }),
      }),
    }) as unknown as ExecutionContext;
  return { guard, context, audit, headers };
}

describe("RateLimitGuard", () => {
  it("deja pasar las peticiones hasta el límite", async () => {
    const { guard, context } = setup({ limit: 3 });

    for (let i = 0; i < 3; i++) await expect(guard.canActivate(context())).resolves.toBe(true);
  });

  it("responde 429 con Retry-After al pasar el límite", async () => {
    const { guard, context, headers } = setup({ limit: 2 });
    await guard.canActivate(context());
    await guard.canActivate(context());

    const error = await guard.canActivate(context()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect((error as HttpException).getResponse()).toMatchObject({ code: "RATE_LIMITED" });
    expect(Number(headers["Retry-After"])).toBeGreaterThanOrEqual(1);
    expect(Number(headers["Retry-After"])).toBeLessThanOrEqual(60);
  });

  it("cada usuario tiene su propio contador", async () => {
    const { guard, context } = setup({ limit: 1 });
    await guard.canActivate(context({ moodleUserId: 1, courseId: 7 }));

    await expect(guard.canActivate(context({ moodleUserId: 2, courseId: 7 }))).resolves.toBe(true);
    await expect(
      guard.canActivate(context({ moodleUserId: 1, courseId: 7 })),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("audita solo el primer rechazo de la ventana", async () => {
    const { guard, context, audit } = setup({ limit: 1 });
    await guard.canActivate(context());

    for (let i = 0; i < 4; i++) await guard.canActivate(context()).catch(() => undefined);

    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "rate.limited",
        outcome: "DENIED",
        actorMoodleId: 42,
        courseId: 7,
        metadata: expect.objectContaining({ limit: 1 }),
      }),
    );
  });

  it("con límite 0 está desactivado", async () => {
    const { guard, context } = setup({ limit: 0 });

    for (let i = 0; i < 50; i++) await expect(guard.canActivate(context())).resolves.toBe(true);
  });

  it("no limita las rutas públicas ni las peticiones sin identidad", async () => {
    const pub = setup({ limit: 1, isPublic: true });
    for (let i = 0; i < 5; i++)
      await expect(pub.guard.canActivate(pub.context())).resolves.toBe(true);

    const anonymous = setup({ limit: 1 });
    for (let i = 0; i < 5; i++)
      await expect(anonymous.guard.canActivate(anonymous.context(null))).resolves.toBe(true);
  });

  it("si el contador falla, deja pasar la petición en lugar de cortar el servicio", async () => {
    const broken = {
      hit: jest.fn().mockRejectedValue(new Error("Redis caído")),
    } as unknown as RateLimitStore;
    const { guard, context } = setup({ store: broken });

    await expect(guard.canActivate(context())).resolves.toBe(true);
  });
});
