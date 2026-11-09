import { Global, Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { FileStorage, LocalFileStorage } from "./file-storage";

@Global()
@Module({
  providers: [
    {
      provide: FileStorage,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new LocalFileStorage(config.get("STORAGE_DIR", { infer: true })),
    },
  ],
  exports: [FileStorage],
})
export class StorageModule {}
