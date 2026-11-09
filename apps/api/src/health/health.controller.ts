import { Controller, Get } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { HealthService, type HealthReport } from "./health.service";

@Public()
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): Promise<HealthReport> {
    return this.health.check();
  }
}
