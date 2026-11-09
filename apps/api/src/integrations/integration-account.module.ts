import { Global, Module } from "@nestjs/common";
import { IntegrationAccountService } from "./integration-account.service";

@Global()
@Module({
  providers: [IntegrationAccountService],
  exports: [IntegrationAccountService],
})
export class IntegrationAccountModule {}
