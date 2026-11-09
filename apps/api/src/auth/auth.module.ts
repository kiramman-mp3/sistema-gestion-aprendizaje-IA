import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { MoodleModule } from "../integrations/moodle/moodle.module";
import { AccessService } from "./access.service";
import { CourseAccessGuard } from "./course-access.guard";
import { JtiStore, RedisJtiStore } from "./jti-store";
import { PluginAuthGuard } from "./plugin-auth.guard";
import { SessionController } from "./session.controller";

@Module({
  imports: [MoodleModule],
  controllers: [SessionController],
  providers: [
    AccessService,
    { provide: JtiStore, useClass: RedisJtiStore },
    // El orden importa: primero se verifica el token y después los permisos en Moodle.
    { provide: APP_GUARD, useClass: PluginAuthGuard },
    { provide: APP_GUARD, useClass: CourseAccessGuard },
  ],
})
export class AuthModule {}
