import { randomUUID } from "node:crypto";
import { RedisRateLimitStore } from "../src/auth/rate-limit.guard";
import { RedisService } from "../src/redis/redis.service";

/**
 * Prueba contra un Redis real: el contador sube, no se mezcla entre claves y vence solo.
 * No corre por defecto, porque CI no tiene Redis. Para ejecutarla:
 *   RUN_DB_TESTS=1 REDIS_URL=redis://:clave@localhost:6379 pnpm --filter @smart-lms/api exec jest rate-limit.redis
 */
const describeWithRedis =
  process.env.RUN_DB_TESTS === "1" && process.env.REDIS_URL ? describe : describe.skip;

describeWithRedis("RedisRateLimitStore contra Redis real", () => {
  let redis: RedisService;
  let store: RedisRateLimitStore;

  beforeAll(() => {
    redis = RedisService.fromUrl(process.env.REDIS_URL!);
    store = new RedisRateLimitStore(redis);
  });

  afterAll(async () => {
    await redis.onModuleDestroy();
  });

  it("cuenta cada golpe y separa las claves", async () => {
    const a = `rl:test:${randomUUID()}`;
    const b = `rl:test:${randomUUID()}`;

    expect(await store.hit(a, 60)).toBe(1);
    expect(await store.hit(a, 60)).toBe(2);
    expect(await store.hit(a, 60)).toBe(3);
    expect(await store.hit(b, 60)).toBe(1);
  });

  it("el contador vence solo: no queda para siempre", async () => {
    const key = `rl:test:${randomUUID()}`;

    await store.hit(key, 60);

    const ttl = await redis.client.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
    await redis.client.del(key);
  });

  it("peticiones simultáneas no pierden golpes", async () => {
    const key = `rl:test:${randomUUID()}`;

    const counts = await Promise.all(Array.from({ length: 20 }, () => store.hit(key, 60)));

    expect(counts.sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    await redis.client.del(key);
  });
});
