import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { validateEnv, type Env } from "./config/env";
import { buildLoggerParams } from "./config/logger";
import { DatabaseModule } from "./database/database.module";
import { HealthModule } from "./health/health.module";
import { MoodleModule } from "./integrations/moodle/moodle.module";
import { RedisModule } from "./redis/redis.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        buildLoggerParams({
          NODE_ENV: config.get("NODE_ENV", { infer: true }),
          LOG_LEVEL: config.get("LOG_LEVEL", { infer: true }),
        }),
    }),
    HealthModule,
    DatabaseModule,
    RedisModule,
    MoodleModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class AppModule {}
