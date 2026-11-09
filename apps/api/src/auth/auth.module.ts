import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JtiStore, RedisJtiStore } from "./jti-store";
import { PluginAuthGuard } from "./plugin-auth.guard";
import { SessionController } from "./session.controller";

@Module({
  controllers: [SessionController],
  providers: [
    { provide: JtiStore, useClass: RedisJtiStore },
    { provide: APP_GUARD, useClass: PluginAuthGuard },
  ],
})
export class AuthModule {}
