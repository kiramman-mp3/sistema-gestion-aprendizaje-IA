import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { MoodleModule } from "../integrations/moodle/moodle.module";
import { AccessService } from "./access.service";
import { CourseAccessGuard } from "./course-access.guard";
import { JtiStore, RedisJtiStore } from "./jti-store";
import { PluginAuthGuard } from "./plugin-auth.guard";
import { RateLimitGuard, RateLimitStore, RedisRateLimitStore } from "./rate-limit.guard";
import { SessionController } from "./session.controller";

@Module({
  imports: [MoodleModule],
  controllers: [SessionController],
  providers: [
    AccessService,
    { provide: JtiStore, useClass: RedisJtiStore },
    { provide: RateLimitStore, useClass: RedisRateLimitStore },
    // El orden importa: se verifica el token, se limita el ritmo y solo entonces se preguntan los permisos a
    // Moodle, para que una avalancha de peticiones no se convierta en una avalancha de llamadas a Moodle.
    { provide: APP_GUARD, useClass: PluginAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: CourseAccessGuard },
  ],
})
export class AuthModule {}
