import { randomBytes } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env";
import { Pseudonymizer } from "./pseudonymizer";

/**
 * Crea el seudonimizador de cada petición con la clave del entorno (ADR-010). Sin `PSEUDONYM_SECRET`
 * (solo se permite fuera de producción) usa una clave aleatoria de este proceso: los seudónimos son
 * válidos mientras el proceso viva, y un historial anterior a un reinicio tendrá otros seudónimos.
 */
@Injectable()
export class PseudonymizerFactory {
  private readonly secret: string;

  constructor(config: ConfigService<Env, true>) {
    const configured = config.get("PSEUDONYM_SECRET", { infer: true });
    if (configured) {
      this.secret = configured;
    } else {
      this.secret = randomBytes(32).toString("hex");
      new Logger(PseudonymizerFactory.name).warn(
        "PSEUDONYM_SECRET no está definida: los seudónimos cambiarán al reiniciar el servidor.",
      );
    }
  }

  create(courseId: number): Pseudonymizer {
    return new Pseudonymizer(this.secret, courseId);
  }
}
